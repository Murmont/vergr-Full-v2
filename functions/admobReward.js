// functions/admobReward.js — AdMob Rewarded ads → boost coins
// ─────────────────────────────────────────────────────────────────────
// AdMob Rewarded ads support Server-Side Verification (SSV): when a user
// genuinely finishes a rewarded ad, Google calls THIS endpoint with a signed
// payload. Nothing is ever credited from a client signal.
//
// Every verified view moves wallets/{uid}.adProgress on by one. The last view
// of a set (3, founder 2026-09-26) credits wallets/{uid}.boostCoins, which buy
// ONLY boosts and VP packs (functions/boostCoins.js). Normal coins are never
// credited here, and nothing here accrues revenue share.
//
// SECURITY:
//   - Amounts are FIXED server-side (adRewardConfig), never taken from the
//     callback's reward_amount.
//   - Idempotent on transaction_id (admob_rewards/{txId}): Google may retry.
//   - Per-UTC-day cap on completed sets, counted on the wallet the transaction
//     already reads, so a view costs no extra document.
//   - Paid tiers (lite/pro) are skipped: paying removes ads everywhere.
//   - Only users whose users.geoCountry is on the reward list.
//
// AdMob console setup (founder): per Rewarded ad unit → Server-side
// verification → set the callback URL to this function's HTTPS trigger.
// Verifier keys: https://www.gstatic.com/admob/reward/verifier-keys.json

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('node:crypto');
const axios = require('axios');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';

// Watch 3 ads, get boost coins (founder, 2026-09-26). Every verified view moves
// the counter on; the Nth view in a set pays BOOST COINS, which buy only boosts
// and VP packs (functions/boostCoins.js). Normal coins are never credited here:
// a tipped coin becomes revenue share Vergr owes, and ads must never feed that.
//
// Live overrides in app_config/general (all read below):
//   adAdsPerReward      — verified views per reward (founder: 3)
//   adRewardBoostCoins  — boost coins per completed set
//   adRewardsPerDay     — completed sets per UTC day
//   adRewardCountries   — ISO codes where ad rewards run (users.geoCountry)
const DEFAULT_ADS_PER_REWARD = 3;
const DEFAULT_REWARD_BOOST_COINS = 75;
const DEFAULT_REWARDS_PER_DAY = 3;
// Markets where a rewarded view pays well enough to be worth offering. Replace
// with our own AdMob earnings by country once real views exist.
const DEFAULT_REWARD_COUNTRIES = [
  'US', 'CA', 'GB', 'IE', 'AU', 'NZ', 'DE', 'AT', 'CH', 'NL', 'BE', 'FR',
  'DK', 'SE', 'NO', 'FI', 'JP', 'KR', 'AE', 'SA', 'QA', 'KW',
];

function adRewardConfig(cfg) {
  const c = cfg || {};
  const pos = (v, d) => (Number(v) > 0 ? Math.floor(Number(v)) : d);
  const list = Array.isArray(c.adRewardCountries) && c.adRewardCountries.length
    ? c.adRewardCountries.map((x) => String(x).toUpperCase())
    : DEFAULT_REWARD_COUNTRIES;
  return {
    adsPerReward: pos(c.adAdsPerReward, DEFAULT_ADS_PER_REWARD),
    rewardCoins: pos(c.adRewardBoostCoins, DEFAULT_REWARD_BOOST_COINS),
    rewardsPerDay: pos(c.adRewardsPerDay, DEFAULT_REWARDS_PER_DAY),
    countries: list,
  };
}

// Pure: what one verified view does to the counter. Exported for the guard.
function nextAdProgress(prev, day, conf) {
  const p = prev && prev.day === day ? prev : { day, watched: 0, rewardsToday: 0 };
  if (p.rewardsToday >= conf.rewardsPerDay) return { status: 'capped', progress: p, coins: 0 };
  const watched = (Number(p.watched) || 0) + 1;
  if (watched >= conf.adsPerReward) {
    return {
      status: 'rewarded',
      coins: conf.rewardCoins,
      progress: { day, watched: 0, rewardsToday: (Number(p.rewardsToday) || 0) + 1 },
    };
  }
  return { status: 'counted', coins: 0, progress: { day, watched, rewardsToday: Number(p.rewardsToday) || 0 } };
}

const VERIFIER_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';

// Verifier keys change rarely; cache in-process between invocations.
let _keyCache = { at: 0, keys: null };
async function getVerifierKeys() {
  const fresh = Date.now() - _keyCache.at < 6 * 60 * 60 * 1000; // 6h
  if (fresh && _keyCache.keys) return _keyCache.keys;
  const { data } = await axios.get(VERIFIER_KEYS_URL, { timeout: 8000 });
  const map = {};
  for (const k of (data && data.keys) || []) {
    // Each entry: { keyId (number), pem (PEM string), base64 }
    map[String(k.keyId)] = k.pem;
  }
  _keyCache = { at: Date.now(), keys: map };
  return map;
}

// AdMob signs the query string up to (but excluding) "&signature=...&key_id=...".
// Those two params are always last, in that order. The content to verify is the
// raw query substring before "&signature=".
function extractSignedContent(rawQuery) {
  const idx = rawQuery.indexOf('signature=');
  if (idx < 1) return null;
  // Drop the trailing "&" before "signature=".
  return rawQuery.substring(0, idx - 1);
}

function base64UrlToBuffer(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

// AdMob signs the query string EXACTLY as it put it on the wire, where reserved
// characters are percent-encoded (custom_data's "|" ships as "%7C"). Some HTTP
// layers normalise those escapes back to the literal character before our
// handler sees the URL — and then the bytes we hash no longer match what Google
// signed, so a perfectly genuine callback fails to verify and the user never
// gets their coins. That is the exact failure this endpoint was hitting.
//
// So we verify against the content as received AND against a re-encoded variant
// that restores the escapes Google would have sent. Only a signature that
// matches one of these forms is accepted — this widens the accepted ENCODING of
// the same bytes, never the set of valid signers.
const NORMALISABLE = /[|^{}[\]`"<>\\ ]/g;
function reEncodeReserved(s) {
  return s.replace(NORMALISABLE, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

function verifyOne(pem, content, sigBuf) {
  try {
    const verifier = crypto.createVerify('SHA256');
    verifier.update(content);
    verifier.end();
    return verifier.verify(pem, sigBuf);
  } catch (_) {
    return false;
  }
}

async function verifySignature(rawQuery, signature, keyId) {
  const content = extractSignedContent(rawQuery);
  if (!content) return false;
  const keys = await getVerifierKeys();
  const pem = keys[String(keyId)];
  if (!pem) return false;
  const sigBuf = base64UrlToBuffer(signature);

  const candidates = [content];
  const reEncoded = reEncodeReserved(content);
  if (reEncoded !== content) candidates.push(reEncoded);

  return candidates.some((c) => verifyOne(pem, c, sigBuf));
}

function utcDayKey(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

exports.admobSsvCallback = functions.https.onRequest(
  { region: REGION, cors: false, maxInstances: 5, memory: '256MiB' },
  async (req, res) => {
    // Google sends a GET. Be tolerant of probes.
    if (req.method === 'HEAD' || req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'GET') { res.status(405).send('method not allowed'); return; }

    const q = req.query || {};
    const signature = (q.signature || '').toString();
    const keyId = (q.key_id || '').toString();
    const txId = (q.transaction_id || '').toString();
    const userId = (q.user_id || '').toString();
    const customData = (q.custom_data || '').toString();

    // Raw query is required for signature verification (param order matters).
    const rawQuery = (req.originalUrl || req.url || '').split('?')[1] || '';

    // AdMob's console "verify callback URL" button pings this endpoint and
    // expects a 200. A bare probe carries no signature, so ACK it without
    // crediting (no signature = nothing is ever credited).
    if (!signature) {
      res.status(200).send('ok');
      return;
    }

    // A signature is present → it MUST verify. The AdMob verify test sends a
    // genuinely Google-signed message (often without a transaction_id), so a
    // valid signature with no reward payload is the verification ping → 200.
    if (!keyId || !rawQuery) {
      res.status(403).send('invalid signature');
      return;
    }
    const ok = await verifySignature(rawQuery, signature, keyId);
    if (!ok) {
      // Log the signed content so a future mismatch is diagnosable without
      // another round of live testing. This is Google's own callback payload
      // (ad metadata + our uid), not user secrets.
      functions.logger.warn('admobSsv: signature verify failed', {
        keyId, txId,
        signedContent: (extractSignedContent(rawQuery) || '').slice(0, 500),
      });
      res.status(403).send('invalid signature');
      return;
    }

    // Resolve the user. user_id is always set by the bridge. Older APKs also
    // packed "uid|nonce" into custom_data, so keep that as a fallback — but only
    // when the separator is actually present. Newer builds send a bare nonce as
    // custom_data (see AdMobBridge), which must never be mistaken for a uid.
    let uid = userId;
    if (!uid && customData.includes('|')) uid = customData.split('|')[0];

    // Valid signature but no real reward payload (txId/uid) = the console's
    // verification ping. Acknowledge so the URL verifies; nothing to credit.
    if (!txId || !uid) {
      res.status(200).send('verified');
      return;
    }

    try {
      const rewardRef = db.collection('admob_rewards').doc(txId);
      const cfgSnap = await db.collection('app_config').doc('general').get();
      const conf = adRewardConfig(cfgSnap.exists ? cfgSnap.data() : {});

      const userRef = db.collection('users').doc(uid);
      const walletRef = db.collection('wallets').doc(uid);
      const day = utcDayKey();

      const result = await db.runTransaction(async (tx) => {
        const [rewardDoc, userDoc, walletDoc] = await Promise.all([
          tx.get(rewardRef), tx.get(userRef), tx.get(walletRef),
        ]);

        if (rewardDoc.exists) return { status: 'duplicate' };
        if (!userDoc.exists) return { status: 'no_user' };

        // Free-tier only — paid plans never earn from ads.
        const u = userDoc.data() || {};
        const s = u.subscription;
        const tier = (typeof s === 'string' ? s : (s && s.tier)) || u.tier || 'free';
        if (tier === 'lite' || tier === 'pro') return { status: 'paid_tier' };

        // Only where a view pays enough. The card is hidden elsewhere too.
        const country = String(u.geoCountry || '').toUpperCase();
        if (!conf.countries.includes(country)) return { status: 'country' };

        const w = walletDoc.exists ? walletDoc.data() : {};
        const step = nextAdProgress(w.adProgress, day, conf);
        if (step.status === 'capped') return { status: 'capped' };

        const walletWrite = { adProgress: step.progress, updatedAt: FieldValue.serverTimestamp() };
        if (step.coins > 0) walletWrite.boostCoins = FieldValue.increment(step.coins);
        tx.set(walletRef, walletWrite, { merge: true });

        tx.set(rewardRef, {
          uid, txId, day, boostCoins: step.coins,
          step: step.status === 'rewarded' ? conf.adsPerReward : step.progress.watched,
          adNetwork: (q.ad_network || '').toString(),
          adUnit: (q.ad_unit || '').toString(),
          createdAt: FieldValue.serverTimestamp(),
        });
        if (step.coins > 0) {
          tx.set(db.collection('transactions').doc(), {
            userId: uid,
            type: 'ad_reward_boost_coins',
            amount: step.coins,
            currency: 'boost_coins',
            description: `Watched ${conf.adsPerReward} ads`,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
        return { status: step.status, boostCoins: step.coins };
      });

      functions.logger.info('admobSsv', { uid, txId, ...result });
      // Always 200 to Google on a valid signature so it stops retrying; the
      // body is for our own logs only.
      res.status(200).send(result.status);
    } catch (err) {
      functions.logger.error('admobSsv credit failed', { txId, uid, error: err.message });
      // 500 so Google retries (transient Firestore error).
      res.status(500).send('error');
    }
  }
);

module.exports._internal = { nextAdProgress, adRewardConfig };
