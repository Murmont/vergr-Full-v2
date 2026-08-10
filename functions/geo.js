// Geo-blocking — server-authoritative region check.
//
// VERGR is a skill-based competitive gaming platform with cash-equivalent
// prizes. The legal status of skill-gaming-for-prizes varies by jurisdiction;
// this module enforces a blocklist for jurisdictions that prohibit or heavily
// restrict the model so that processor compliance reviews can verify we make
// a good-faith effort to comply.
//
// Two enforcement paths:
//   1. HTTPS endpoint `getRegionStatus` — reads Cloudflare's `cf-ipcountry`
//      and `cf-region-code` headers. Used by the frontend on signup, wallet,
//      tournaments, and payout pages.
//   2. Callable helper `assertRegionAllowed(request)` — invoked at the top
//      of every wallet/tournament/payout callable as a defense-in-depth
//      server-side check. Throws HttpsError('permission-denied') if blocked.
//
// VPN bypass is accepted — this is a compliance signal, not DRM.

const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');
const admin = require('firebase-admin');

if (admin.apps.length === 0) admin.initializeApp();
const db = getFirestore('vgrdb');

// ────────────────────────────────────────────────────────────────────────
// Blocklists — keep in sync with `src/utils/geoBlocks.js` on the frontend.
// ────────────────────────────────────────────────────────────────────────

// Countries where we cannot legally operate the real-money / crypto-withdrawal
// side of the app. Conservative list; expand as counsel advises.
//
// 2026-07-08: the 11 countries blocked ONLY for "skill-gaming-for-cash"
// (Turkey, India, Singapore, Thailand, Vietnam, Indonesia, Malaysia, Sri Lanka,
// Bangladesh, Pakistan, Brunei) were UNBLOCKED after tournaments moved to the
// ticketed-events model (competitors register FREE, never stake, are never
// prize-eligible from their own money), which removes the wager/gambling basis.
// The countries below remain blocked for reasons the ticketed pivot does NOT
// change: sanctions, an outright crypto-withdrawal ban, or MENA gambling law.
const BLOCKED_COUNTRIES = new Set([
  // Sanctions / crypto-withdrawal prohibited — Circle + USDC cannot serve these.
  'CN',  // China — crypto trading + withdrawals prohibited (also separate ICP-licensed distribution)
  'KP',  // North Korea (sanctioned)
  'IR',  // Iran (sanctioned)
  'SY',  // Syria (sanctioned)
  'CU',  // Cuba (sanctioned)
  'RU',  // Russia (sanctioned/restricted)
  'BY',  // Belarus (sanctioned)
  'VE',  // Venezuela (sanctioned-adjacent)
  // MENA — Islamic-law gambling prohibition (maisir) can extend to paid prize
  // competitions even with free competitor entry; several also restrict crypto.
  // Held pending counsel.
  'SA',  // Saudi Arabia
  'AE',  // UAE (without local licence)
  'QA',  // Qatar (also bans crypto)
  'KW',  // Kuwait
  'IQ',  // Iraq
]);

// 2026-07-08: emptied. These 12 states (AZ AR CT DE LA MT SD SC TN WA ID ME)
// were blocked ONLY for skill-based-gaming-for-cash, which the ticketed-events
// model removes (competitors register free, never stake). No US state is
// currently blocked; NY (the strictest money-transmission regime) was already
// allowed, so this is consistent. Kept as an (empty) Set so evaluateBlock and
// the exports are unchanged. Re-add codes here if counsel later advises.
const BLOCKED_US_STATES = new Set([]);

// ────────────────────────────────────────────────────────────────────────
// Header extraction helpers — Cloudflare adds these on requests routed
// through the Cloudflare proxy. When called locally (no Cloudflare) the
// headers are absent and we treat the request as "unknown" (allowed by
// default — fail-open in dev, override with an env var for prod testing).
// ────────────────────────────────────────────────────────────────────────

// Geo headers are only believed when they arrive via the Cloudflare Worker in
// infra/cf-geo-proxy, which attaches the shared secret VERGR_GEO_TOKEN.
//
// Without this check the gate would be theatre: anyone can call the Functions
// origin directly with a hand-written `cf-ipcountry: US` and walk straight
// through. An unsigned header is therefore treated as NO header (country
// unknown), which callers on sensitive paths must fail closed on.
//
// If the secret is unset (local dev, or before the Worker is deployed) we do
// not enforce the signature, because doing so would make every caller unknown
// and hard-block the whole platform on a missing config value.
// True once the Cloudflare geo proxy is really configured (a token that is
// neither missing nor the seeded placeholder). Everything that FAILS CLOSED
// keys off this, so the strict behaviour switches itself on with the secret
// instead of needing a second code change — and, critically, cannot break
// live payouts during the window where the token exists but the Worker or the
// client rebuild does not.
function geoEnforcementActive() {
  const v = (process.env.VERGR_GEO_TOKEN || '').trim();
  return Boolean(v) && v !== 'placeholder';
}

// Fail-closed switch for money-movement paths, kept SEPARATE from the token.
//
// Arming the token does two things: it rejects forged geo headers (safe to
// turn on immediately, no user-visible effect) and it makes an unresolvable
// country meaningful. Only the second one is dangerous, because a native
// install on an older APK still calls the Functions origin directly, sends no
// token, and therefore resolves to unknown. Tying both to the token would
// refuse withdrawals for every phone that has not updated yet, and you cannot
// force phones to update.
//
// So: leave this false until the geo-proxy APK has real adoption, then flip it
// to true and redeploy. Same reasoning as the gatedVodUrl split.
const STRICT_UNKNOWN_COUNTRY = false;

function geoHeadersTrusted(h) {
  let expected = (process.env.VERGR_GEO_TOKEN || '').trim();
  // Seeded as 'placeholder' so the secret can be DECLARED on functions before
  // the Worker exists (a v2 function cannot bind a secret that is absent, and
  // an undeclared secret never reaches process.env at all). Treat it as unset.
  if (expected === 'placeholder') expected = '';
  if (!expected) return true; // not yet configured: legacy behaviour
  const got = String(h['x-vergr-geo-token'] || '').trim();
  return got.length > 0 && got === expected;
}

function readCountryAndState(rawHeaders) {
  const h = rawHeaders || {};
  if (!geoHeadersTrusted(h)) return { country: '', region: '' };
  // x-vergr-* comes from the Cloudflare Worker (infra/cf-geo-proxy) and is the
  // ONLY path that works today: Cloudflare strips cf-prefixed request headers
  // on Worker subrequests, so a cf-ipcountry stamped by the Worker never
  // arrives. The cf-* reads are kept as a fallback for any request that is
  // genuinely proxied by Cloudflare directly rather than via the Worker.
  const country = String(
    h['x-vergr-country'] || h['cf-ipcountry'] || h['CF-IPCountry'] || ''
  ).toUpperCase();
  // ISO 3166-2 region code without the country prefix.
  const region = String(
    h['x-vergr-region'] || h['cf-region-code'] || h['CF-Region-Code'] || ''
  ).toUpperCase();
  return { country, region };
}

function evaluateBlock(country, region) {
  if (!country) {
    return { blocked: false, country: null, region: null, reason: 'unknown_region' };
  }
  if (BLOCKED_COUNTRIES.has(country)) {
    return { blocked: true, country, region: region || null, reason: 'country_blocked' };
  }
  if (country === 'US' && region && BLOCKED_US_STATES.has(region)) {
    return { blocked: true, country, region, reason: 'state_blocked' };
  }
  return { blocked: false, country, region: region || null, reason: 'allowed' };
}

// ────────────────────────────────────────────────────────────────────────
// HTTPS endpoint — frontend calls this to learn its region status.
// CORS-enabled; no auth required (the page may be pre-signup).
// ────────────────────────────────────────────────────────────────────────

exports.getRegionStatus = onRequest({ region: 'europe-west1', cors: true, secrets: ['VERGR_GEO_TOKEN'] }, async (req, res) => {
  const { country, region } = readCountryAndState(req.headers);
  const status = evaluateBlock(country, region);
  res.set('Cache-Control', 'no-store');
  res.json(status);
});

// ────────────────────────────────────────────────────────────────────────
// Callable defense-in-depth — invoke at the top of any wallet, tournament,
// or payout callable. Throws if blocked; returns the resolved region
// otherwise so the caller can log it on the transaction.
//
// Usage:
//   const { country } = await assertRegionAllowed(request);
//   ...rest of callable...
// ────────────────────────────────────────────────────────────────────────

// `requireKnownCountry: true` makes the check FAIL CLOSED when the country
// cannot be resolved. Use it on money-movement paths: a caller who bypasses
// the Cloudflare Worker resolves to "unknown", and on a payout that must be a
// refusal, not a free pass. Leave it false for browsing-level gates, where an
// unresolvable country should not lock a legitimate user out of the app.
exports.assertRegionAllowed = async function assertRegionAllowed(request, opts = {}) {
  // Founder/ops bypass — the platform owner dogfoots every gated flow regardless
  // of region. Compliance signal, not DRM (VPN bypass is already accepted).
  const uid = request?.auth?.uid;
  if (uid) {
    try {
      const u = await db.collection('users').doc(uid).get();
      const d = u.exists ? u.data() : {};
      if (d.role === 'admin' || (d.email || '').toLowerCase() === 'vergenerd@gmail.com') {
        return { country: 'ZZ', region: null, founder: true };
      }
    } catch { /* fall through to normal check */ }
  }
  const rawHeaders = (request && request.rawRequest && request.rawRequest.headers) || {};
  const { country, region } = readCountryAndState(rawHeaders);
  const status = evaluateBlock(country, region);
  if (status.blocked) {
    throw new HttpsError(
      'permission-denied',
      'This action is not available in your region.'
    );
  }
  if (opts.requireKnownCountry && STRICT_UNKNOWN_COUNTRY && geoEnforcementActive() && !country) {
    throw new HttpsError(
      'failed-precondition',
      'We could not confirm your location. Please disable any VPN or proxy and try again.'
    );
  }
  return { country, region };
};

// ────────────────────────────────────────────────────────────────────────
// Standalone callable — used by signup screens that don't yet have the
// user authenticated. Same result as the HTTPS endpoint but reachable via
// the callable convention so it can be invoked through `httpsCallable`.
// ────────────────────────────────────────────────────────────────────────

exports.checkRegion = onCall({ region: 'europe-west1', secrets: ['VERGR_GEO_TOKEN'] }, async (request) => {
  const rawHeaders = (request && request.rawRequest && request.rawRequest.headers) || {};
  const { country, region } = readCountryAndState(rawHeaders);
  return evaluateBlock(country, region);
});

// Exported so other modules in this codebase can reuse the constants
// (e.g. analytics-side counters that exclude blocked regions).
exports.BLOCKED_COUNTRIES = BLOCKED_COUNTRIES;
exports.BLOCKED_US_STATES = BLOCKED_US_STATES;
exports.evaluateBlock     = evaluateBlock;
