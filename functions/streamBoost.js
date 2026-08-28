// boostStream — pay coins (or spend an earned VP token) to push a live stream.
//
// ⚠ THE BOOST THIS REPLACES DID NOTHING. `streams/{id}.boosted` was read only to
// draw a badge; the 1.5x multiplier lived in `getLiveDiscoveryFeed`, which no
// screen ever called. Users were charged 50 coins for a badge while the help
// centre told them it pushed their stream in discovery. Full account in
// src/utils/streamBoost.js.
//
// ⚠ MIRROR OF src/utils/streamBoost.js. The tier table lives in both because
// the client prices the buttons and the server charges the wallet, and a drift
// means the UI advertises a price the server does not take.
// `scripts/vp-mirror-check.mjs` fails the build if they disagree.
const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

/** MIRROR of BOOST_TIERS in src/utils/streamBoost.js. */
const BOOST_TIERS = [
  { id: 'boost', name: 'Boost',       coins: 50,  reach: 1.5, minutes: 15 },
  { id: 'super', name: 'Super Boost', coins: 150, reach: 2.5, minutes: 30 },
  { id: 'mega',  name: 'Mega Boost',  coins: 500, reach: 4.0, minutes: 60 },
];
const TOKEN_TIER_ID = 'boost';
/** How many boosts one stream will record. Stops an unbounded array. */
const MAX_BOOSTS_PER_STREAM = 40;

const tierById = (id) => BOOST_TIERS.find((t) => t.id === id) || null;

exports.boostStream = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { streamId, tierId = 'boost', useToken = false } = req.data || {};

  if (!streamId || typeof streamId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Which stream?');
  }
  // ⚠ A TOKEN ALWAYS REDEEMS AS THE ENTRY TIER. Letting `useToken` be paired
  // with `mega` would turn a free reward into the 500-coin product.
  const tier = tierById(useToken ? TOKEN_TIER_ID : tierId);
  if (!tier) throw new functions.https.HttpsError('invalid-argument', 'Unknown boost tier.');

  const streamRef = db.collection('streams').doc(streamId);
  const walletRef = db.collection('wallets').doc(uid);

  return db.runTransaction(async (tx) => {
    const [streamSnap, walletSnap] = await Promise.all([tx.get(streamRef), tx.get(walletRef)]);
    if (!streamSnap.exists) throw new functions.https.HttpsError('not-found', 'That stream has ended.');
    const stream = streamSnap.data();

    // ⚠ LIVE ONLY. Boosting an ended stream would take coins for reach that can
    // never be delivered — the same "charged for nothing" defect being fixed.
    if (stream.status !== 'live') {
      throw new functions.https.HttpsError('failed-precondition', 'That stream is not live.');
    }
    // An unlisted stream is hidden from discovery by design, so a boost on one
    // buys literally nothing. Refuse rather than take the coins.
    if (stream.unlisted || ['followers', 'friends', 'unlisted'].includes(stream.audience)) {
      throw new functions.https.HttpsError('failed-precondition',
        'This stream is not public, so a boost would not reach anyone.');
    }

    const now = Date.now();
    const existing = Array.isArray(stream.boosts) ? stream.boosts : [];
    const active = existing.filter((b) => Number(b?.expiresAt) > now);
    if (active.length >= MAX_BOOSTS_PER_STREAM) {
      throw new functions.https.HttpsError('resource-exhausted',
        'This stream is already boosted as far as it goes right now.');
    }

    const w = walletSnap.exists ? walletSnap.data() : {};
    let paidWith;

    if (useToken) {
      // ⚠ THE WHOLE POINT OF THE FOUNDER'S CHANGE: an earned token spends on
      // ANY stream, not only your own. Somebody who levels up but does not
      // broadcast can hand their boost to a creator they like.
      const tokens = Number(w.boostTokens) || 0;
      if (tokens < 1) {
        throw new functions.https.HttpsError('failed-precondition', 'No Boost tokens left.');
      }
      tx.update(walletRef, { boostTokens: FieldValue.increment(-1) });
      paidWith = 'token';
    } else {
      const balance = Number(w.balance) || 0;
      if (balance < tier.coins) {
        throw new functions.https.HttpsError('failed-precondition',
          `${tier.name} costs ${tier.coins} coins. You have ${balance}.`);
      }
      tx.update(walletRef, {
        balance: FieldValue.increment(-tier.coins),
        totalSpent: FieldValue.increment(tier.coins),
      });
      paidWith = 'coins';
    }

    const entry = {
      uid,
      tier: tier.id,
      reach: tier.reach,
      at: now,
      expiresAt: now + tier.minutes * 60 * 1000,
      paidWith,
    };

    // ⚠ EXPIRED ENTRIES ARE DROPPED ON WRITE, so the array cannot grow without
    // bound over a long broadcast and no cleanup cron is needed. Expiry is still
    // evaluated at READ time — this is housekeeping, not the mechanism.
    tx.update(streamRef, {
      boosts: [...active, entry],
      boosted: true,               // kept: the badge still reads this
      boostExpiresAt: Math.max(...active.map((b) => b.expiresAt), entry.expiresAt),
      boostCount: FieldValue.increment(1),
    });

    // The sink ledger. A boost is spend, never earnings — it must never reach
    // a creator's revenue share.
    tx.set(db.collection('transactions').doc(), {
      userId: uid,
      type: 'stream_boost',
      amount: paidWith === 'coins' ? -tier.coins : 0,
      currency: 'coins',
      description: `${tier.name} on a live stream`,
      streamId,
      boostTier: tier.id,
      paidWith,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, tier: tier.id, expiresAt: entry.expiresAt, paidWith };
  });
});

exports._internal = { BOOST_TIERS, TOKEN_TIER_ID, MAX_BOOSTS_PER_STREAM };
