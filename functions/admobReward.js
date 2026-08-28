// functions/admobReward.js — AdMob Rewarded ads → Watch-to-Earn COINS
// ─────────────────────────────────────────────────────────────────────
// Why this exists: coins are a CASHABLE currency, so we must never credit
// them on a forgeable client signal (the old web Watch-to-Earn pays VP for
// exactly this reason). AdMob Rewarded ads support Server-Side Verification
// (SSV): when a user genuinely finishes a rewarded ad, Google calls THIS
// endpoint with a cryptographically signed payload. A valid signature means
// the ad really played to completion — i.e. we earned ad revenue — so it is
// safe to credit coins. Coins are only ever credited from here, never from
// the client.
//
// Flow:
//   1. Native AdMobBridge shows a rewarded ad with ServerSideVerificationOptions
//      { userId: <uid>, customData: "<uid>|<nonce>" }.
//   2. User finishes the ad → Google GETs this URL with the signed query.
//   3. We verify the ECDSA-SHA256 signature against Google's published verifier
//      keys, then credit a fixed (server-controlled) coin amount to the uid,
//      idempotently keyed on transaction_id, under a per-day cap.
//
// SECURITY:
//   - Coin value is FIXED server-side (admobRewardCoins), NOT taken from the
//     callback's reward_amount, so an AdMob-console misconfig can't inflate the
//     economy.
//   - Idempotent on transaction_id (admob_rewards/{txId}) — Google may retry.
//   - Per-UTC-day cap so a user can't farm unlimited coins.
//   - Paid tiers (lite/pro) are skipped — ads + ad rewards are a free-tier-only
//     experience (paying removes ads everywhere).
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

// Server-controlled defaults. Override live via app_config/general:
//   admobRewardCoins   — coins per verified rewarded view
//   admobDailyCap      — max verified views credited per UTC day per user
const DEFAULT_REWARD_COINS = 2;
const DEFAULT_DAILY_CAP = 20;

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

      // Read config + user + idempotency atomically.
      const cfgSnap = await db.collection('app_config').doc('general').get();
      const cfg = cfgSnap.exists ? cfgSnap.data() : {};
      const rewardCoins = Number(cfg.admobRewardCoins) > 0 ? Number(cfg.admobRewardCoins) : DEFAULT_REWARD_COINS;
      const dailyCap = Number(cfg.admobDailyCap) > 0 ? Number(cfg.admobDailyCap) : DEFAULT_DAILY_CAP;

      const userRef = db.collection('users').doc(uid);
      const walletRef = db.collection('wallets').doc(uid);
      const day = utcDayKey();
      const counterRef = db.collection('admob_reward_counters').doc(`${uid}_${day}`);

      const result = await db.runTransaction(async (tx) => {
        const [rewardDoc, userDoc, counterDoc] = await Promise.all([
          tx.get(rewardRef), tx.get(userRef), tx.get(counterRef),
        ]);

        if (rewardDoc.exists) return { status: 'duplicate' };
        if (!userDoc.exists) return { status: 'no_user' };

        // Free-tier only — paid plans never earn from ads.
        const u = userDoc.data() || {};
        // `subscription` is written as a plain string by the purchase flows;
        // also accept the legacy object/`tier` shapes.
        const s = u.subscription;
        const tier = (typeof s === 'string' ? s : (s && s.tier)) || u.tier || 'free';
        if (tier === 'lite' || tier === 'pro') return { status: 'paid_tier' };

        const used = counterDoc.exists ? (counterDoc.data().count || 0) : 0;
        if (used >= dailyCap) return { status: 'capped' };

        // Credit coins (cashable balance) + record the verified watch.
        // convertible: ad-reward coins are platform income to the user, not a
        // purchase, so they may accrue revenue share — see coinLedger.js
        tx.set(walletRef, {
          // earnedCoinCredit supplies balance + earnedBalance +
          // totalEarnedCoinsGross, the last of which drives the revenue share
          // ladder and was missing from this hand-rolled write.
          ...require('./coinLedger').earnedCoinCredit(rewardCoins),
        }, { merge: true });
        tx.set(rewardRef, {
          uid, coins: rewardCoins, txId, day,
          adNetwork: (q.ad_network || '').toString(),
          adUnit: (q.ad_unit || '').toString(),
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.set(counterRef, {
          uid, day, count: FieldValue.increment(1),
          coins: FieldValue.increment(rewardCoins),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        return { status: 'credited', coins: rewardCoins };
      });

      // AUTO-CONVERT AT RECEIPT: rewarded-ad coins are income from the
      // platform, so they follow the same rule as every other earned credit and
      // accrue at the user's current rate. Post-commit, guarded, idempotent
      // on the AdMob transaction id, so Google's retries cannot convert twice.
      if (result.status === 'credited' && result.coins > 0) {
        const { settleEarnedShare } = require('./coinLedger');
        await settleEarnedShare(db, {
          uid, coins: result.coins, source: 'ad_reward', sourceId: `ad:${txId}`,
        });
      }

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
