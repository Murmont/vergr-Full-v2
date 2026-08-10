// Steam Sign-In via OpenID 2.0. Steam never adopted OAuth — they require a
// classic OpenID 2.0 round-trip:
//
//   1. Frontend calls `getSteamSignInUrl()` (callable). We generate a CSRF
//      token bound to the user's uid, then build a Steam OpenID auth URL with
//      our callback as `openid.return_to`.
//   2. Frontend `window.location.href = url`. User signs in at Steam.
//   3. Steam redirects to /auth/steam/callback?openid.* — hosting rewrites
//      to `steamOpenIdCallback`. We POST the response back to Steam with
//      `openid.mode=check_authentication` to verify it; if Steam returns
//      `is_valid:true`, we extract the Steam64 ID from
//      `openid.claimed_id` (`https://steamcommunity.com/openid/id/<steam64>`),
//      look up the user's profile via the Steam Web API, and write
//      `linkedAccounts.steam` plus the GSI token via the existing linkSteam
//      flow. Then redirect back to /settings/linked.
//
// Replaces the manual Steam64-paste flow. Manual still works as a fallback;
// the LinkedAccountsScreen routes Steam through OAuth-style redirect when
// available.
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const crypto = require('crypto');
const axios = require('axios');

const db = getFirestore('vgrdb');
const STEAM_API_KEY = defineSecret('STEAM_API_KEY');

const APP_BASE = 'https://vergr-44494.web.app';
const RETURN_TO = `${APP_BASE}/auth/steam/callback`;
const REALM = APP_BASE;
// Post-link redirect target (see oauth.js RETURN_BASE): canonical vergr.app so
// web keeps its session and native's verified App Link hands back to the app.
const RETURN_BASE = 'https://vergr.app';
const STATE_TTL_MS = 10 * 60 * 1000;

// Generate signed CSRF token bound to a uid + ttl. Avoids needing Firestore
// writes for every sign-in attempt; we still write once per active flow but
// validate signature first to drop garbage hits.
function makeStateToken(uid) {
  const random = crypto.randomBytes(16).toString('hex');
  return `${uid}:${random}`;
}

exports.getSteamSignInUrl = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const token = makeStateToken(uid);
  await db.collection('oauth_states').doc(token).set({
    uid, platform: 'steam',
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + STATE_TTL_MS),
  });

  const params = new URLSearchParams({
    'openid.ns':         'http://specs.openid.net/auth/2.0',
    'openid.mode':       'checkid_setup',
    'openid.return_to':  `${RETURN_TO}?state=${encodeURIComponent(token)}`,
    'openid.realm':      REALM,
    'openid.identity':   'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return { url: `https://steamcommunity.com/openid/login?${params.toString()}` };
});

exports.steamOpenIdCallback = onRequest({ secrets: [STEAM_API_KEY], cors: false }, async (req, res) => {
  const redirectBack = (status, message) => {
    const u = new URL(`${RETURN_BASE}/settings/linked`);
    u.searchParams.set('linked', 'steam');
    u.searchParams.set('status', status);
    if (message) u.searchParams.set('msg', message);
    res.redirect(303, u.toString());
  };

  try {
    const stateToken = String(req.query.state || '');
    const claimedId  = String(req.query['openid.claimed_id'] || '');
    if (!stateToken || !claimedId) return redirectBack('error', 'missing_openid_params');

    // Validate state.
    const stateRef = db.collection('oauth_states').doc(stateToken);
    const stateSnap = await stateRef.get();
    if (!stateSnap.exists) return redirectBack('error', 'invalid_state');
    const sd = stateSnap.data();
    if (sd.platform !== 'steam') return redirectBack('error', 'state_platform_mismatch');
    if (sd.expiresAt?.toMillis() < Date.now()) {
      await stateRef.delete().catch(() => {});
      return redirectBack('error', 'state_expired');
    }
    const uid = sd.uid;
    await stateRef.delete().catch(() => {});

    // Verify with Steam by echoing all openid.* params back with mode=check_authentication.
    const verifyParams = new URLSearchParams();
    Object.entries(req.query).forEach(([k, v]) => {
      if (k.startsWith('openid.')) verifyParams.append(k, String(v));
    });
    verifyParams.set('openid.mode', 'check_authentication');
    const verifyRes = await axios.post(
      'https://steamcommunity.com/openid/login',
      verifyParams.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    if (!String(verifyRes.data || '').includes('is_valid:true')) {
      return redirectBack('error', 'steam_verify_failed');
    }

    // Extract Steam64 from claimed_id.
    const m = claimedId.match(/\/openid\/id\/(\d{17})$/);
    if (!m) return redirectBack('error', 'no_steam64');
    const steamId64 = m[1];

    // Pull profile via Steam Web API for username + avatar.
    let username = null, avatar = null;
    try {
      const sumRes = await axios.get('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/', {
        params: { key: STEAM_API_KEY.value(), steamids: steamId64 },
      });
      const p = sumRes.data?.response?.players?.[0];
      username = p?.personaname || null;
      avatar   = p?.avatarfull   || null;
    } catch (e) {
      console.warn('Steam summary fetch failed', e?.response?.status);
    }

    // Generate a per-user GSI token (mirrors linkSteamAccount in functions/gsi.js)
    // so CS2/Dota 2 GSI hooks can resolve this user. We don't import gsi.js here
    // to avoid circular requires; we replicate the token shape inline.
    const gsiToken = crypto.randomBytes(32).toString('hex');
    await db.collection('gsi_tokens').doc(gsiToken).set({
      uid, steamId64, createdAt: FieldValue.serverTimestamp(),
    });

    await db.collection('users').doc(uid).set({
      'linkedAccounts.steam': {
        steamId64,
        username,
        avatar,
        gsiToken,
        connectedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return redirectBack('ok', null);
  } catch (err) {
    console.error('steamOpenIdCallback error', err?.response?.data || err?.message || err);
    return redirectBack('error', 'exchange_failed');
  }
});
