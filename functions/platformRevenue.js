// platform_revenue — the profit ledger.
//
// WHY THIS FILE EXISTS
// ────────────────────
// Until 2026-08-11 there was NO record of profit anywhere in this codebase.
// CLAUDE.md described a live three-bucket ledger (`user_balances` /
// `platform_revenue` / `insurance_reserve`) with a daily reconciliation
// invariant. That ledger was never built. `platform_revenue` was written by
// nothing and read by nothing; the only mention in the whole repo was a
// document describing it as if it existed.
//
// The practical consequence: a coin sale produced cash in the bank and no entry
// anywhere saying how much of that cash was actually ours. The margin could only
// be reconstructed by hand from constants scattered across six files, which is
// exactly what several sessions kept re-deriving and getting different answers
// for. This file ends that.
//
// WHAT IT RECORDS
// ───────────────
// One row per money event, in INTEGER MICRO-USD (1 USD = 1_000_000). Integers
// because a ledger that drifts by floating-point rounding is worse than no
// ledger: it looks authoritative and is quietly wrong.
//
//   amountMicroUsd > 0   money that is ours
//   amountMicroUsd < 0   money that is not (processor fees, minted liabilities)
//
// Plus a per-day rollup so the admin screen never has to scan the rows.
//
// WHAT IT DELIBERATELY DOES NOT DO
// ────────────────────────────────
// It does not touch wallets, it does not gate anything, and every write is
// wrapped so it can never throw into a real purchase. A bookkeeping failure
// must never fail a payment. If a row is lost it is logged and dropped; the
// money already moved and the rollup will be short, which is a reporting bug,
// not a financial one.

const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore('vgrdb');

/** 1 USD in the integer unit this ledger stores. */
const MICRO = 1_000_000;

/**
 * PayRam's own fee, verified from their FAQ on 2026-08-11:
 * "PayRam charges a flat 1%-5% fee on settlement, when funds are withdrawn to
 * the cold wallet. PayRam does NOT charge any other fees."
 *
 * This is OURS to pay and it was accounted for nowhere. On $100 of sales it is
 * $1 to $5 straight off the margin. The default sits at the middle of the
 * published band until the real contracted rate is known; override without a
 * deploy via app_config/general.payramSettlementFeePct.
 */
const DEFAULT_PAYRAM_SETTLEMENT_PCT = 0.03;

/**
 * What one earned coin actually costs us when it leaves.
 *
 * A coin only becomes real money via coins -> gems -> USDC. That path applies
 * the rank commission (30% Rookie down to 15% Immortal) and then the 2%
 * withdrawal spread, against a gem worth EUR 0.01.
 *
 * We book the WORST case (Immortal, 15%) because a liability you have
 * understated is the one that hurts. Being pleasantly surprised later is fine.
 */
const WORST_CASE_COMMISSION = 0.15;
const WITHDRAWAL_SPREAD     = 0.02;
const GEM_EUR               = 0.01;

/** Cost in EUR of one minted/earned coin eventually being withdrawn. */
const COIN_PAYOUT_COST_EUR =
  GEM_EUR * (1 - WORST_CASE_COMMISSION) * (1 - WITHDRAWAL_SPREAD);

const dayKeyOf = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

/** USD float -> integer micro-USD. Rounds, never truncates. */
const toMicro = (usd) => Math.round((Number(usd) || 0) * MICRO);

/**
 * Book one line to the ledger.
 *
 * Idempotency is by document id, built from `sourceId` + `kind`. Both settlement
 * rails (webhook and the reconciler cron) call this with the SAME sourceId for
 * the same order, exactly as `creditReferralPurchaseBonus` does, so a double
 * settlement can never double-book. Firestore ids cannot contain '/', so it is
 * stripped rather than left to fail at write time.
 *
 * @param {object}  entry
 * @param {string}  entry.kind      what this line is, e.g. 'coin_sale_gross'
 * @param {number}  entry.usd       signed USD. Positive is ours, negative is not
 * @param {string}  entry.sourceId  stable unique id for the originating event
 * @param {string} [entry.uid]      the user the event relates to, if any
 * @param {object} [entry.meta]     anything worth being able to check later
 */
async function bookRevenue({ kind, usd, sourceId, uid = null, meta = {} }) {
  try {
    if (!kind || !sourceId) return;
    const amountMicroUsd = toMicro(usd);
    if (!Number.isFinite(amountMicroUsd) || amountMicroUsd === 0) return;

    const safeSource = String(sourceId).replace(/\//g, '_');
    const docId = `${safeSource}__${kind}`;
    const ref = db.collection('platform_revenue').doc(docId);
    const dayKey = dayKeyOf();

    await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) return; // already booked

      tx.create(ref, {
        kind,
        uid,
        amountMicroUsd,
        sourceId,
        dayKey,
        meta,
        createdAt: FieldValue.serverTimestamp(),
      });

      // Rollup so the admin screen reads one doc per day instead of scanning.
      tx.set(db.collection('platform_revenue_daily').doc(dayKey), {
        dayKey,
        netMicroUsd: FieldValue.increment(amountMicroUsd),
        [`byKind.${kind}`]: FieldValue.increment(amountMicroUsd),
        [`countByKind.${kind}`]: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  } catch (e) {
    // Never throw into a payment path.
    console.error('bookRevenue failed', kind, sourceId, e?.message || e);
  }
}

/**
 * Book a completed coin purchase: what we charged, what the rails took, and the
 * payout liability the sale created.
 *
 * Called POST-COMMIT from the settlement paths, never inside the wallet
 * transaction — the money is already credited by the time this runs and must not
 * be able to roll back because a ledger write failed.
 *
 * @param {object} p
 * @param {string} p.uid            buyer
 * @param {number} p.grossUsd       what the buyer was actually charged, ex fees
 * @param {number} p.coins          coins credited
 * @param {string} p.sourceId       `order:<referenceId>` — same id both rails use
 * @param {string} p.gateway        'payram' | 'circle' | 'play' (historic rows
 *        may carry 'stripe'; that rail was removed 2026-08-13)
 * @param {number} [p.buyerFeesUsd] fees ADDED to the buyer and passed straight
 *                                  to the processor. Net zero to us, recorded so
 *                                  the gross the buyer saw can be reconstructed
 * @param {number} [p.processorFeeUsd] what the processor actually kept
 */
async function bookCoinPurchase({
  uid, grossUsd, coins, sourceId, gateway,
  buyerFeesUsd = 0, processorFeeUsd = 0,
}) {
  try {
    if (!sourceId || !(grossUsd > 0)) return;

    await bookRevenue({
      kind: 'coin_sale_gross', usd: grossUsd, sourceId, uid,
      meta: { coins, gateway },
    });

    // Fees the buyer paid on top. They pass through us to the processor, so
    // they are booked in and straight back out. Recording both sides keeps the
    // ledger reconcilable against the card statement rather than against a net
    // figure nobody can tie back.
    if (buyerFeesUsd > 0) {
      await bookRevenue({
        kind: 'buyer_fees_collected', usd: buyerFeesUsd, sourceId, uid,
        meta: { gateway },
      });
    }
    if (processorFeeUsd > 0) {
      await bookRevenue({
        kind: 'processor_fee', usd: -processorFeeUsd, sourceId, uid,
        meta: { gateway },
      });
    }

    // PayRam's settlement fee. Ours, published, and previously untracked.
    if (gateway === 'payram') {
      let pct = DEFAULT_PAYRAM_SETTLEMENT_PCT;
      try {
        const snap = await db.doc('app_config/general').get();
        const raw = Number(snap.data()?.payramSettlementFeePct);
        if (Number.isFinite(raw) && raw >= 0 && raw <= 0.2) pct = raw;
      } catch { /* keep the default */ }
      await bookRevenue({
        kind: 'payram_settlement_fee',
        usd: -(grossUsd + buyerFeesUsd) * pct,
        sourceId, uid, meta: { pct },
      });
    }

    // The liability this sale created. Not a cash cost today, but booking it at
    // sale time is the entire point: it is what turns "cash in the bank" into
    // "cash that is safe to spend". Without it a purchase looks like 100% profit
    // for however many months it takes the recipient to withdraw.
    if (coins > 0) {
      await bookRevenue({
        kind: 'payout_liability_accrued',
        usd: -coinsToPayoutUsd(coins),
        sourceId, uid,
        meta: { coins, basis: 'worst_case_immortal' },
      });
    }
  } catch (e) {
    console.error('bookCoinPurchase failed', sourceId, e?.message || e);
  }
}

/**
 * Book the cost of a referral bonus at the moment it is minted.
 *
 * These coins are NEW. Nothing was deducted from the buyer or from revenue to
 * create them, so the whole face value is a fresh liability, and it skips the
 * 10% tip fee that every other earned coin pays. That makes a referral coin the
 * most expensive coin we issue, which is not obvious from the rate alone and is
 * why it gets its own line rather than being folded into the purchase.
 */
async function bookReferralCost({ referrerUid, bonusCoins, sourceId, rate }) {
  if (!(bonusCoins > 0) || !sourceId) return;
  await bookRevenue({
    kind: 'referral_cost',
    usd: -coinsToPayoutUsd(bonusCoins),
    sourceId, uid: referrerUid,
    meta: { bonusCoins, rate },
  });
}

/**
 * Coins spent on the PLATFORM rather than on a person.
 *
 * Subscriptions and stream boosts are the only two sinks that exist today. A
 * coin that goes here never becomes anyone's withdrawable balance, so it is
 * 100% margin: the liability accrued at purchase is released in full.
 *
 * Same coin tipped to a creator returns 22-36%. Same coin spent on Lite returns
 * everything. That gap is the cheapest margin available and nothing was counting
 * it, so nobody could tell whether it mattered.
 */
async function bookPlatformSink({ uid, coins, sink, sourceId }) {
  // NEGATIVE `coins` is legitimate and must not be filtered out: it reverses a
  // sink that was refunded (a Stream Boost returned because the stream earned
  // 50 coins of tips). Rejecting it would leave the release booked and
  // permanently overstate margin on the best-performing streams.
  if (!coins || !sourceId) return;
  await bookRevenue({
    kind: 'platform_sink',
    usd: coinsToPayoutUsd(coins), // positive: liability released. negative: re-accrued
    sourceId, uid,
    meta: { coins, sink },
  });
}

/** EUR->USD is deliberately NOT live here: a ledger must be re-derivable. */
const LEDGER_EUR_USD = 1.08;

/** What `coins` will cost us if they are all eventually withdrawn, in USD. */
function coinsToPayoutUsd(coins) {
  return (Number(coins) || 0) * COIN_PAYOUT_COST_EUR * LEDGER_EUR_USD;
}

module.exports = {
  bookRevenue,
  bookCoinPurchase,
  bookReferralCost,
  bookPlatformSink,
  coinsToPayoutUsd,
  MICRO,
  _config: {
    DEFAULT_PAYRAM_SETTLEMENT_PCT,
    WORST_CASE_COMMISSION,
    WITHDRAWAL_SPREAD,
    GEM_EUR,
    COIN_PAYOUT_COST_EUR,
    LEDGER_EUR_USD,
  },
};
