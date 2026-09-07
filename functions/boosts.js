// Boosts — server side. Buy into inventory, apply from inventory.
//
// ⚠ MIRROR of src/utils/boosts.js. Every id, price, duration and target must
// match; vp-mirror-check fails the build on drift. The client shows the price,
// this file charges it.
//
// ⚠ TWO SEPARATE ACTIONS, AND THAT IS THE WHOLE POINT. `purchaseBoostPack` only
// ever adds to `wallets/{uid}.boosts`. `applyBoost` only ever spends from it.
// The previous build fused them — you chose a target at checkout and it fired
// immediately — which is why there was nothing to hold and nothing to look at.
//
// ⚠ APPLYING TO SOMEONE ELSE'S CONTENT IS ALLOWED AND IS NOT A BUG. Founder,
// 2026-08-28: *"I should be able to apply a boost to my own or anyone else's
// content if I want to."* There is deliberately NO ownership check in
// applyBoost. The earlier one was written for a model where the boost was bought
// FOR a target; it is wrong for a model where you own the token.

const functions = require('firebase-functions/v2');
const { HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = () => getFirestore('vgrdb');

/** MIRROR of BOOSTS in src/utils/boosts.js. */
//
// ⚠ TWO PRICES, AND THEY ARE NOT DERIVED FROM EACH OTHER.
//
//   coins    what it costs from the wallet
//   priceUSD what it costs in cash, when the wallet cannot cover it
//
// The rule, set 2026-08-28: priceUSD = charmRound(max(2 x coin-equivalent,
// $0.99)). Paying with coins is therefore always about HALF the cash price,
// which is what makes coins worth holding.
//
// ⚠⚠ NEVER price a boost at its coin count through playPriceFor(). That is the
// COIN REDEMPTION rate, and it priced a 75-coin boost at $1.09, exactly what a
// 78-coin pack costs. Nobody would ever buy that. The $0.99 term is Google
// Play's US minimum and only binds on the two 25-coin items.
const BOOSTS = [
  { id: 'post',          target: 'post',   minutes: 1440, coins: 50,  priceUSD: 0.99,  reach: 3 },
  { id: 'lfg',           target: 'post',   minutes: 720,  coins: 25,  priceUSD: 0.99,  reach: 3, postType: 'lfg' },
  { id: 'profile',       target: 'user',   minutes: 2880, coins: 100, priceUSD: 1.29 },
  { id: 'squad',         target: 'squad',  minutes: 2880, coins: 75,  priceUSD: 0.99 },
  { id: 'stream_boost',  target: 'stream', minutes: 15,   coins: 50,  priceUSD: 0.99,  reach: 1.5 },
  { id: 'stream_super',  target: 'stream', minutes: 30,   coins: 150, priceUSD: 1.99,  reach: 2.5 },
  { id: 'stream_mega',   target: 'stream', minutes: 60,   coins: 500, priceUSD: 6.99, reach: 4 },
];

const boostById = (id) => BOOSTS.find((b) => b.id === id) || null;

/**
 * ⚠ The catalogue id and the STREAM TIER id are different strings, and they have
 * to be. streamBoost.js has shipped `tier: 'boost' | 'super' | 'mega'` on live
 * documents, and hasFeedRail() matches `'mega'` exactly; renaming those would
 * silently un-boost every stream already running. So the catalogue keeps its
 * unambiguous ids and maps here.
 */
const STREAM_TIER = { stream_boost: 'boost', stream_super: 'super', stream_mega: 'mega' };

/** Which collection a target kind lives in. */
const COLLECTION = { post: 'posts', user: 'users', squad: 'squads', stream: 'streams' };

/** Most you can buy in one go. Stops a fat-fingered qty draining a wallet. */
const MAX_QTY = 25;

// ⚠ NEVER WRITE `{ 'boosts.<id>': increment() }` WITH set(). Firestore only
// treats a dotted key as a field PATH in update(); in set() it is a literal field
// name, so that form creates a top-level field called "boosts.post" and the real
// `boosts` map never changes. Found live on 2026-08-28 after a purchase debited
// 50 coins and the inventory stayed empty. Always nest: `{ boosts: { [id]: ... } }`.

/**
 * Buy boosts into inventory.
 *
 * ⚠ The price comes from the table here, never from the client. The client sends
 * WHAT and HOW MANY, never HOW MUCH.
 */
exports.purchaseBoostPack = functions.https.onCall(
  { region: 'europe-west1' },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');

    const boost = boostById(String((request.data && request.data.boostId) || ''));
    if (!boost) throw new HttpsError('invalid-argument', 'Unknown boost.');

    const qty = Math.floor(Number((request.data && request.data.qty) || 1));
    if (!(qty >= 1 && qty <= MAX_QTY)) {
      throw new HttpsError('invalid-argument', `Choose between 1 and ${MAX_QTY}.`);
    }

    const cost = boost.coins * qty;
    const d = db();
    const walletRef = d.collection('wallets').doc(uid);

    await d.runTransaction(async (tx) => {
      const snap = await tx.get(walletRef);
      const balance = Math.floor((snap.exists ? snap.data().balance : 0) || 0);
      if (balance < cost) {
        throw new HttpsError('failed-precondition',
          `Not enough coins. That costs ${cost} and you have ${balance}.`);
      }
      tx.set(walletRef, {
        balance: FieldValue.increment(-cost),
        totalSpent: FieldValue.increment(cost),
        boosts: { [boost.id]: FieldValue.increment(qty) },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      tx.set(d.collection('transactions').doc(), {
        userId: uid,
        type: 'boost_purchase',
        amount: -cost,
        currency: 'coins',
        description: `${qty}x ${boost.id} boost`,
        boostId: boost.id,
        qty,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return { ok: true, boostId: boost.id, qty, coins: cost };
  },
);

/**
 * Spend one boost from inventory onto a target.
 *
 * ⚠ NO OWNERSHIP CHECK. See the header. Anyone may boost anyone.
 *
 * ⚠ EXTENDS, never shortens. Applying a second boost while one runs adds its
 * time on top rather than replacing a longer window with a shorter one.
 */
exports.applyBoost = functions.https.onCall(
  { region: 'europe-west1' },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');

    const boost = boostById(String((request.data && request.data.boostId) || ''));
    if (!boost) throw new HttpsError('invalid-argument', 'Unknown boost.');

    const targetId = String((request.data && request.data.targetId) || '');
    if (!targetId) throw new HttpsError('invalid-argument', 'Choose what to boost.');

    const col = COLLECTION[boost.target];
    const d = db();
    const walletRef = d.collection('wallets').doc(uid);
    const targetRef = d.collection(col).doc(targetId);

    const result = await d.runTransaction(async (tx) => {
      const [wSnap, tSnap] = await Promise.all([tx.get(walletRef), tx.get(targetRef)]);
      if (!tSnap.exists) throw new HttpsError('not-found', 'That is no longer there.');

      const w = wSnap.exists ? wSnap.data() : {};
      // Legacy `boostTokens` counts as stream_boost inventory, matching
      // boostInventory() on the client, so ladder-earned tokens still spend.
      const owned = Number((w.boosts || {})[boost.id]) || 0;
      const legacy = boost.id === 'stream_boost' ? (Number(w.boostTokens) || 0) : 0;
      if (owned + legacy < 1) {
        throw new HttpsError('failed-precondition', 'You do not have that boost.');
      }

      // An LFG boost is for a looking-for-teammates post and a Post Boost is for
      // anything else, so neither can be spent on the wrong kind by accident.
      if (boost.target === 'post') {
        const isLfg = tSnap.data().type === 'lfg';
        if (!!boost.postType !== isLfg) {
          throw new HttpsError('failed-precondition', boost.postType
            ? 'That boost is for looking-for-teammates posts.'
            : 'Use a Teammate Search Boost on that post.');
        }
      }
      if (boost.target === 'stream' && tSnap.data().status !== 'live') {
        throw new HttpsError('failed-precondition', 'That stream is not live.');
      }

      const now = Date.now();
      const expiresAt = now + boost.minutes * 60000;

      // Spend from the typed inventory first, only then the legacy counter.
      if (owned > 0) {
        tx.set(walletRef, { boosts: { [boost.id]: FieldValue.increment(-1) } }, { merge: true });
      } else {
        tx.set(walletRef, { boostTokens: FieldValue.increment(-1) }, { merge: true });
      }

      // ⚠ A RANDOM BUCKET IS WHAT MAKES DELIVERY FAIR. Readers query one bucket,
      // so every live boost has an equal chance of being the one served rather
      // than the pool always returning whichever expires soonest.
      // MIRROR of BOOST_BUCKETS in src/utils/boostDelivery.js.
      const boostBucket = Math.floor(Math.random() * 100);

      if (boost.target === 'stream') {
        // ⚠ STREAMS KEEP AN ARRAY, and it is load-bearing. boostReach() sums
        // each entry's `reach` to stack additively on the excess, and
        // hasFeedRail() looks for a `tier === 'mega'` entry. Writing only
        // boostExpiresAt would give the stream a countdown while ranking it
        // exactly as before — a boost that buys a badge, which is the defect
        // this feature exists to undo.
        //
        // Shape mirrors what boostStream() writes, deliberately, so the two
        // entry points produce identical documents.
        const existing = (Array.isArray(tSnap.data().boosts) ? tSnap.data().boosts : [])
          .filter((x) => Number(x && x.expiresAt) > now);
        const entry = {
          tier: STREAM_TIER[boost.id],
          reach: boost.reach,
          by: uid,
          startedAt: now,
          expiresAt,
        };
        tx.set(targetRef, {
          boosts: [...existing, entry],
          boosted: true,
          boostExpiresAt: Math.max(...existing.map((x) => x.expiresAt), expiresAt),
        }, { merge: true });
      } else {
        // Everything else only needs "is it boosted, and until when". Extends
        // rather than resets: a second boost adds its time on top.
        const base = Math.max(Number(tSnap.data().boostExpiresAt) || 0, now);
        tx.set(targetRef, {
          boostExpiresAt: base + boost.minutes * 60000,
          boostedAt: now,
          boostedBy: uid,
          boostBucket,
        }, { merge: true });
      }

      tx.set(d.collection('boosts').doc(), {
        userId: uid, boostId: boost.id, target: boost.target, targetId,
        // startedAt is a plain millis so the client can compare it without a
        // Timestamp round-trip; followers-gained counts from here.
        startedAt: now,
        expiresAt, createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { expiresAt };
    });

    return { ok: true, boostId: boost.id, targetId, ...result };
  },
);

/**
 * Record a BATCH of boost impressions.
 *
 * ⚠ Batched because one write per impression is unaffordable: Spark allows
 * 20,000 writes a day and a single popular item would eat all of them. The
 * client accumulates for ~20s and sends one call.
 *
 * ⚠ ONLY counts items with a LIVE boost. That is what bounds the cost — by the
 * number of live boosts, which is a business input we control, rather than by
 * content volume, which is not. An expired or absent boost is silently ignored
 * rather than rejected, because by the time a batch lands the boost may
 * legitimately have run out mid-scroll.
 *
 * ⚠ The counters are SERVER-ONLY in firestore.rules. A client-writable
 * impression count is a vanity number anyone can inflate, which is worse than
 * no number: `viewCount` was exactly that until 2026-08-28.
 */
exports.recordBoostImpressions = functions.https.onCall(
  { region: 'europe-west1' },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');

    const raw = (request.data && request.data.entries) || [];
    if (!Array.isArray(raw) || raw.length === 0) return { ok: true, counted: 0 };

    // Hard cap so a malicious client cannot turn one call into a write storm.
    const entries = raw.slice(0, 40).filter((e) => e && COLLECTION[e.target] && e.targetId);
    const d = db();
    const now = Date.now();
    let counted = 0;

    await Promise.all(entries.map(async (e) => {
      const ref = d.collection(COLLECTION[e.target]).doc(String(e.targetId));
      const snap = await ref.get();
      if (!snap.exists) return;
      // The gate: no live boost, no counting. This is the cost bound.
      if (!(Number(snap.data().boostExpiresAt) > now)) return;

      // Clamped: a client claiming 10,000 impressions in one batch is lying.
      const imp = Math.max(0, Math.min(50, Math.floor(Number(e.impressions) || 0)));
      const views = Math.max(0, Math.min(50, Math.floor(Number(e.views) || 0)));
      // ⚠ ENGAGEMENT IS AN INTERACTION (profile opened from the card, or a follow
      // from it), NOT a render. The receipt briefly labelled impressions
      // "engagement", which is simply not what the word means. Clamped hardest of
      // the three because it is the rarest and therefore the most suspicious in
      // volume: nobody legitimately clicks one card 50 times in 20 seconds.
      const eng = Math.max(0, Math.min(20, Math.floor(Number(e.engagements) || 0)));
      if (imp === 0 && views === 0 && eng === 0) return;

      await ref.set({
        boostImpressions: FieldValue.increment(imp),
        boostViews: FieldValue.increment(views),
        boostEngagements: FieldValue.increment(eng),
      }, { merge: true });
      counted += 1;
    }));

    return { ok: true, counted };
  },
);

/**
 * Add boosts to inventory INSIDE a caller's transaction.
 *
 * Exported so a CASH purchase (Google Play IAP, or the PayRam card rail) writes
 * the identical inventory shape a coin purchase writes. A second grant path
 * would be a second definition of what owning a boost means.
 *
 * ⚠ The map is NESTED, never a dotted key. `set()` with `'boosts.post'`
 * creates a top-level field whose NAME is that string and the real map never
 * changes. That bug cost 50 coins and produced an invisible inventory.
 */
const creditBoosts = (tx, walletRef, boostId, qty) => {
  tx.set(walletRef, {
    boosts: { [boostId]: FieldValue.increment(qty) },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
};

exports.creditBoosts = creditBoosts;
exports.BOOSTS = BOOSTS;
exports.boostById = boostById;
