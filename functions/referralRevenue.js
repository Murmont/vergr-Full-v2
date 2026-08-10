// Referral revenue-share — pays a referrer a % (in COINS) of every coin
// purchase their referred users make, for 2 years from the referred user's
// signup. This is ON TOP of the one-time +5,000 VP signup reward.
//
// Rate = 1% base + 0.5% per referral who currently holds an active Lite/Pro
// subscription (pool-wide across ALL your referrals' purchases), capped at 5%.
// A lapsed subscription drops the rate back down (the daily downgrade cron
// flips those users to `subscription:'free'`, so they stop counting here).
//
// Affordability: a coin only becomes real cash via coins→gems→USDC, and that
// path loses 15-30% commission, so even a fully-withdrawn bonus costs well
// under its face %. Wash-referral is strictly unprofitable for the same reason.
//
// This helper is called STRICTLY POST-COMMIT from the two coin-purchase credit
// sites (payram.js settlePayramOrder + circleWallets.js attributed path) and is
// wrapped so it can NEVER throw into — or slow — a real purchase. If a bonus
// fails it is logged and dropped; the purchase is already committed.

const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore('vgrdb');

const WINDOW_MS       = 2 * 365 * 24 * 3600 * 1000; // 2 years from signup
const BASE_RATE       = 0.01;   // 1% floor for every referrer
// Creator sweetener (founder decision 2026-07-15): purchases by referrals who
// have STREAMED on Vergr at least once pay a 2% base instead of 1% — the
// Twitch-acquisition wedge rewards recruiting creators specifically. The 5%
// ceiling is unchanged.
const STREAMER_BASE_RATE = 0.02;
const SUB_BONUS_RATE  = 0.005;  // +0.5% per active-subbed referral
const MAX_RATE        = 0.05;   // 5% ceiling
// Number of active-subbed referrals needed to reach the ceiling. We only ever
// need to COUNT up to this, so the subbed-referral read is bounded (≤ this).
const SUB_CAP_COUNT   = Math.round((MAX_RATE - BASE_RATE) / SUB_BONUS_RATE); // 8

const toMs = (t) => {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  const n = Date.parse(t);
  return Number.isNaN(n) ? 0 : n;
};

// buyerUid bought `coins` coins in a single purchase identified by `sourceId`
// (stable + unique per order, e.g. `order:<orderId>` — both payment rails pass
// the SAME id for the same order so they can never double-pay).
async function creditReferralPurchaseBonus({ buyerUid, coins, sourceId }) {
  try {
    if (!buyerUid || !(coins > 0) || !sourceId) return;

    const buyerSnap = await db.collection('users').doc(buyerUid).get();
    if (!buyerSnap.exists) return;
    const buyer = buyerSnap.data();

    const referrerUid = buyer.referredBy;
    if (!referrerUid || referrerUid === buyerUid) return; // no referrer / self-referral

    // 2-year window from the referred user's signup.
    const createdAtMs = toMs(buyer.createdAt);
    if (createdAtMs && (Date.now() - createdAtMs) > WINDOW_MS) return;

    // Rate: 1% + 0.5% per active-subbed referral (pool-wide), capped 5%.
    // Bounded read — stop counting once we could only be at/over the cap.
    const subbedSnap = await db.collection('users')
      .where('referredBy', '==', referrerUid)
      .where('subscription', 'in', ['lite', 'pro'])
      .limit(SUB_CAP_COUNT)
      .get();
    // Streamer sweetener: a buyer who has ever streamed pays the 2% base.
    // First hit is one bounded streams read; the result is stamped on the
    // buyer doc so later purchases skip the query.
    let base = BASE_RATE;
    if (buyer.hasStreamed === true) {
      base = STREAMER_BASE_RATE;
    } else {
      try {
        const streamSnap = await db.collection('streams')
          .where('hostUid', '==', buyerUid).limit(1).get();
        if (!streamSnap.empty) {
          base = STREAMER_BASE_RATE;
          // Only stamp TRUE — a false stamp would freeze a user at 1% even
          // after they start streaming; the per-purchase re-check is 1 read.
          await buyerSnap.ref.set({ hasStreamed: true }, { merge: true });
        }
      } catch { /* rate stays at the 1% base on a failed check */ }
    }
    const rate  = Math.min(MAX_RATE, base + SUB_BONUS_RATE * subbedSnap.size);
    const bonus = Math.floor(coins * rate);
    if (bonus <= 0) return;

    // Idempotent: one marker per purchase. If it exists, we've already paid.
    const markerRef = db.collection('referral_purchase_bonuses').doc(sourceId);
    await db.runTransaction(async (tx) => {
      const m = await tx.get(markerRef);
      if (m.exists) return;

      const walletRef = db.collection('wallets').doc(referrerUid);
      tx.set(walletRef, {
        balance: FieldValue.increment(bonus),
        // convertible: referral revenue share (received value) — see coinLedger.js
        earnedBalance: FieldValue.increment(bonus),
        referralRevenueCoins: FieldValue.increment(bonus), // lifetime rollup for the UI
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      tx.create(db.collection('transactions').doc(), {
        userId: referrerUid,
        type: 'referral_revenue',
        currency: 'coins',
        amount: bonus,
        description: `Referral revenue: ${(rate * 100).toFixed(1)}% of a friend's coin purchase`,
        meta: { buyerUid, coins, rate, sourceId },
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(markerRef, {
        referrerUid, buyerUid, coins, rate, bonus, sourceId,
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(db.collection('notifications').doc(), {
        recipientId: referrerUid,
        type: 'referral_revenue',
        title: `+${bonus} coins from a referral`,
        body: `You earned ${(rate * 100).toFixed(1)}% of a friend's coin purchase.`,
        read: false,
        data: { bonus, rate },
        createdAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (e) {
    // A bonus failure must never affect the already-committed purchase.
    console.error('creditReferralPurchaseBonus failed', sourceId, e?.message || e);
  }
}

exports.creditReferralPurchaseBonus = creditReferralPurchaseBonus;
exports._referralRevenueConfig = { WINDOW_MS, BASE_RATE, STREAMER_BASE_RATE, SUB_BONUS_RATE, MAX_RATE, SUB_CAP_COUNT };
