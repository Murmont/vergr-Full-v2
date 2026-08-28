// Coin ledger — the purchased/earned split.
//
// WHY THIS EXISTS (do not collapse the two fields back into one):
// Google Play's Payments policy requires that in-app virtual currency is only
// used within the app it was bought in. A user who buys coins with Play Billing
// and then has that value paid out to them in cash has turned Play's billing
// system into a cash-out rail. That is an account-level violation, not a
// listing rejection.
//
// TikTok, Twitch and Tango all allow cash-out and are compliant because of one
// separation: the person who BUYS never withdraws, and only the person who
// RECEIVES does. This module is that separation.
//
// THE MODEL
//   wallet.balance        total spendable coins. Unchanged — every spend site
//                         keeps using it, so nothing about spending moved.
//   wallet.earnedBalance  the subset of `balance` that arrived as RECEIVED
//                         value (tips received, prize payouts, creator income,
//                         ticket and membership revenue, referral share).
//                         This is the only pool that may accrue revenue share.
//
//   convertible = min(earnedBalance, balance)
//
// The min() is what keeps the invariant true without touching a single spend
// site. Spends only ever decrement `balance`, so after a big spend the clamp
// pulls the convertible figure down on its own. It also means spends are
// treated as coming out of PURCHASED coins first, which is the user-favourable
// reading and the one that matches how people actually think about it:
//
//   buy 1000            balance 1000  earned    0  convertible    0
//   receive tip +500    balance 1500  earned  500  convertible  500
//   spend 500           balance 1000  earned  500  convertible  500
//   spend 700           balance  300  earned  500  convertible  300  (clamped)
//
// CLASSIFICATION RULES
//   earned = true   value that arrived FROM SOMEONE ELSE or from the platform
//                   as income: tips received, tournament prizes, mod cut,
//                   ticket and membership revenue, vergr.me sales, referral
//                   revenue share, rewarded-ad coins, treasury distributions.
//   earned = false  coins the user bought (PayRam, Circle, Play Billing) AND
//                   refunds. A refund returns coins that were spent, and the
//                   coins behind that spend may well have been purchased, so
//                   refunds stay non-convertible. That errs toward NOT letting
//                   value out, which is the safe direction to be wrong in.
//
// If you add a new site that credits coins, you must decide which of the two it
// is. Defaulting to `balance` alone is the safe choice when unsure.

const { FieldValue } = require('firebase-admin/firestore');

/**
 * Fields to merge into a wallet write for coins that arrived as RECEIVED value
 * and may therefore accrue revenue share to the creator who received them.
 *
 * Spread it into the update you were already making:
 *   tx.update(walletRef, {
 *     ...earnedCoinCredit(amount),
 *     totalReceived: FieldValue.increment(amount),
 *   });
 *
 * @param {number} amount positive coin amount
 */
function earnedCoinCredit(amount) {
  const n = Math.floor(Number(amount) || 0);
  if (n <= 0) return {};
  return {
    balance: FieldValue.increment(n),
    earnedBalance: FieldValue.increment(n),
    // Counted HERE, at the moment value is earned, because the revenue-share
    // ladder is keyed to it (shareForEarnings). Before 2026-08-14 only the tip
    // path maintained this field, so a creator earning through memberships,
    // tickets, ad rewards or locked content would have sat at tier 1 forever.
    //
    // Deliberately NOT incremented again in settleEarnedShare: that helper only
    // splits coins already counted here into the creator share and Vergr's, and
    // counting at both sites would double every non-tip earner's progress.
    totalEarnedCoinsGross: FieldValue.increment(n),
  };
}

/**
 * Fields for coins that are NOT convertible: purchases and refunds.
 * Exists so a credit site reads as a deliberate classification rather than an
 * omission — `...purchasedCoinCredit(n)` says "considered, not convertible".
 *
 * @param {number} amount positive coin amount
 */
function purchasedCoinCredit(amount) {
  const n = Math.floor(Number(amount) || 0);
  if (n <= 0) return {};
  return { balance: FieldValue.increment(n) };
}

/**
 * How many coins in this wallet are still awaiting a revenue-share split.
 * Clamped to the live balance so a spend can never leave earnedBalance
 * overstating what is actually there.
 *
 * @param {object} wallet raw wallet doc data
 */
function convertibleCoins(wallet) {
  const balance = Math.max(0, Math.floor(wallet?.balance || 0));
  const earned = Math.max(0, Math.floor(wallet?.earnedBalance || 0));
  return Math.min(earned, balance);
}

// ════════════════════════════════════════════════════════════════════
// ACCRUAL AT RECEIPT (founder approved 2026-08-11, re-denominated 2026-08-16)
// ════════════════════════════════════════════════════════════════════
//
// Revenue share is calculated and owed the MOMENT value is received, at the
// creator's rate AT THAT MOMENT. It is never a user-invoked conversion, and
// there is never a second currency sitting in between.
//
// ## What accruing at receipt closes
//
// Under the old model a creator could sit on earned coins, climb the ladder,
// and settle the whole stored balance at the top rate instead of the rate that
// applied while the money was actually earned. Pricing at receipt removes that
// entirely: the rate that applied when the revenue happened is the rate paid.
//
// ## The cost, accepted knowingly
//
// The ladder stops being retroactive. Climbing a tier improves future earnings
// only, never a share already accrued.
//
// ## Why in-app spending still works
//
// It was previously argued that accruing at receipt would strand creators who
// wanted to spend, and that a gems-to-coins buyback had to ship alongside to
// fix it. That reasoning died with gems. A creator spends the same way anyone
// else does: they buy coins. Accrued revenue share is money Vergr owes them and
// pays on Vergr's schedule, not a wallet they shop from. Turning it back into
// spendable credit is precisely the round trip that made it look like a held
// balance, which is the thing being removed.

// ── REVENUE SHARE LADDER — SINGLE SOURCE OF TRUTH ─────────────────────
//
// See docs/REVENUE_SHARE_PLAN.md. Vergr is the PRINCIPAL in every transaction:
// a buyer buys coins from Vergr, spends them on Vergr products, and Vergr owes
// the creator a share of the revenue their content generated. The creator is a
// supplier paid a revenue share, NOT an account holder with a balance.
//
// Two things follow, and both matter more than they look:
//
// 1. ONE RATE, NOT TWO. The old model deducted twice — a 10% fee at send, then
//    a VP-tier commission at conversion — so a "flat 10% fee" really took
//    24-37%. Two deductions against a held balance is the shape of *fees charged
//    on the user's money*, which is exactly the custody framing this model
//    exists to escape. One number, expressed as what the creator EARNS.
//
// 2. KEYED TO EARNINGS, NOT VP. A supplier rate card scaled to volume delivered
//    is what every commercial contract looks like. One scaled to how much the
//    supplier played our game is arbitrary, and arbitrary reads as a fee. It was
//    also backwards on its own terms: GIFT_COINS_PER_VP meant a heavy tipper who
//    created nothing could out-rank a real creator and get paid better for it.
//
// Thresholds are LIFETIME GROSS COINS EARNED (`wallets/{uid}.totalEarnedCoinsGross`),
// which this file already maintains. At 1 coin = $0.01 they are $0 / $50 / $250 /
// $1,000 / $5,000 / $15,000 / $50,000.
//
/** Mirrors src/utils/vpSystem.js and functions/economy.js. Keep all three equal. */
const REVENUE_SHARE_RATES      = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80];
const REVENUE_SHARE_THRESHOLDS = [0, 5_000, 25_000, 100_000, 500_000, 1_500_000, 5_000_000];

/**
 * The creator's share of revenue, as a fraction they KEEP (0.50 - 0.80).
 *
 * Note the inversion from the old `commissionForVP`: that returned what was
 * TAKEN, this returns what is KEPT. Anything reading one as the other is off by
 * (1 - x), which at these rates still looks like a plausible number, so it will
 * not throw. Check the sign of any call you touch.
 *
 * @param {number} earnedGross lifetime gross coins earned, BEFORE this credit
 */
function shareForEarnings(earnedGross = 0) {
  for (let i = REVENUE_SHARE_THRESHOLDS.length - 1; i >= 0; i--) {
    if (earnedGross >= REVENUE_SHARE_THRESHOLDS[i]) return REVENUE_SHARE_RATES[i];
  }
  return REVENUE_SHARE_RATES[0];
}

/**
 * @deprecated The VP-keyed commission ladder. Superseded by shareForEarnings().
 * Kept only so a missed callsite returns a number instead of throwing while the
 * migration settles. Do not add new uses. Delete once §14 of the plan is done.
 */
const COMMISSION_RATES = [0.30, 0.28, 0.25, 0.22, 0.20, 0.18, 0.15];
const VP_THRESHOLDS    = [0,    500,  2000, 5000, 15000, 40000, 100000];

function commissionForVP(vp = 0) {
  for (let i = VP_THRESHOLDS.length - 1; i >= 0; i--) {
    if (vp >= VP_THRESHOLDS[i]) return COMMISSION_RATES[i];
  }
  return 0.30;
}

/**
 * Is this user an ACTIVE Vanguard, and therefore exempt from commission?
 *
 * Suspended and retired Vanguard fall back to the normal share ladder like
 * anyone else.
 *
 * This exists as a shared helper specifically because auto-convert made it easy
 * to lose: every earning site now decides a commission rate, and a site that
 * forgets this check silently charges an active Vanguard the 15-30% they are
 * exempt from, on income they earned. That is a perk deletion nobody would
 * notice from the code, only from a moderator complaining.
 *
 * @param {object} userData raw users/{uid} doc data
 */
function isVanguardExempt(userData) {
  const v = userData?.vanguard;
  return !!(v?.rank && v.status !== 'suspended' && v.status !== 'retired');
}

/**
 * 1 coin = $0.01 = 10,000 micro-USD. The ONLY unit conversion in the money path.
 *
 * There is deliberately no second currency here any more. The accrued revenue
 * share used to be denominated in "gems", an integer unit worth exactly $0.01
 * that existed only to be turned back into dollars by creatorPayouts.js before
 * anything was actually paid. A unit created solely to be converted away is a
 * unit that can drift from the number it represents, and one that reads as a
 * balance the user holds. Both problems disappear by storing the payable as
 * what it is: money Vergr owes, in micro-USD.
 */
const COIN_MICRO_USD = 10_000;

/** Money for humans. One formatter, so no caller invents its own. */
function microUsdToStr(micro) {
  return `$${((Number(micro) || 0) / 1e6).toLocaleString(undefined, {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

/**
 * Wallet fields for revenue share accrued INLINE, inside the transaction that
 * received the value.
 *
 * Returns the increments to merge into the wallet write the caller was already
 * making, plus the numbers for the ledger row, so a caller cannot accrue and
 * forget to record the rate it accrued at.
 *
 * @param {number}  coins       gross coins earned, BEFORE the share is applied
 * @param {number}  earnedGross recipient's LIFETIME gross coins earned before
 *        this credit (`wallets/{uid}.totalEarnedCoinsGross`). Drives the rate.
 * @param {object} [opts]
 * @param {boolean} [opts.vanguardExempt] active Vanguard earn at 100%.
 * @param {boolean} [opts.creatorActive] false routes the value to
 *        `pendingCreatorCoins` instead of accruing.
 * @returns {{fields: object, owedMicroUsd: number, share: number, coins: number}}
 */
function earnedShareCredit(coins, earnedGross, opts = {}) {
  const gross = Math.floor(Number(coins) || 0);
  if (gross <= 0) return { fields: {}, owedMicroUsd: 0, share: 0, coins: 0 };

  // Only a CREATOR accrues revenue share. A tip to a non-creator is NEVER
  // refused (founder decision 3): the value is counted on pendingCreatorCoins
  // and shown back to them as the reason to apply. Nothing accrues, because
  // revenue share without an accepted agreement is the exact thing the
  // principal model cannot have. See docs/CREATOR_PROGRAM_PLAN.md.
  if (opts.creatorActive === false) {
    return {
      fields: {
        pendingCreatorCoins: FieldValue.increment(gross),
        updatedAt: FieldValue.serverTimestamp(),
      },
      owedMicroUsd: 0, share: 0, coins: gross, pending: true,
    };
  }

  const share = opts.vanguardExempt ? 1 : shareForEarnings(earnedGross);

  // Full micro-USD precision. The old gem unit was an integer cent, so every
  // accrual truncated to a whole cent and the platform silently kept the
  // remainder. That was an artifact of the unit, not a policy: the RATE is
  // unchanged, the creator just stops losing the sub-cent tail.
  const owedMicroUsd = Math.floor(gross * share * COIN_MICRO_USD);

  return {
    fields: {
      // The accrued payable: revenue share owed to this creator, not yet paid.
      owedMicroUsd: FieldValue.increment(owedMicroUsd),
      // Lifetime share owed, for "what you kept, all time".
      totalOwedMicroUsd: FieldValue.increment(owedMicroUsd),
      // Lifetime GROSS, for "you earned X before your share". ALSO the input to
      // the rate ladder, so it must be incremented on every earning path or a
      // creator never climbs a tier.
      totalEarnedCoinsGross: FieldValue.increment(gross),
      updatedAt: FieldValue.serverTimestamp(),
    },
    owedMicroUsd,
    share,
    coins: gross,
  };
}

/**
 * Accrue revenue share on coins that were JUST credited as earned. Runs
 * POST-COMMIT, outside the transaction that credited them.
 *
 * ## Why two shapes exist
 *
 * Where the crediting transaction already reads the recipient wallet (sendTip
 * does), accruing INLINE is strictly better because it is atomic. Use
 * `earnedShareCredit` there. Most sites write the creator wallet with
 * set/merge and never read it, so this helper runs right after their commit.
 *
 * ## The failure mode is deliberately benign
 *
 * If this throws or never runs, the coins simply stay coins. The user keeps
 * every unit of value; it has just not been split into the creator share and
 * Vergr share yet, and a later call with the same sourceId still will. Nothing
 * is lost and nothing is double-counted, which is why it is fire-and-forget.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {object} p
 * @param {string} p.uid       recipient
 * @param {number} p.coins     coins just credited as earned
 * @param {string} p.source    'membership' | 'ticket' | 'ad_reward' | ...
 * @param {string} p.sourceId  stable unique id, for idempotency
 */
async function settleEarnedShare(db, { uid, coins, source, sourceId }) {
  try {
    const want = Math.floor(Number(coins) || 0);
    if (!uid || want <= 0 || !sourceId) return;

    // Admin kill switch. `conversionsPaused` is offered on /admin/config and
    // /admin/economy as "Pause revenue-share accrual" and was read by NOTHING
    // until 2026-08-19 — an operator could flip it during an economy
    // investigation and accrual would carry on regardless.
    //
    // Nothing is lost while paused: the settlement marker is only written on a
    // successful pass, so once the switch is cleared the next settle for this
    // same sourceId accrues normally. It defers, it does not discard.
    const cfg = await db.collection('app_config').doc('general').get();
    if (cfg.exists && cfg.data()?.conversionsPaused === true) {
      console.warn('settleEarnedShare skipped: conversionsPaused', source, sourceId);
      return;
    }

    const markerRef = db.collection('revenue_share_settlements')
      .doc(String(sourceId).replace(/\//g, '_'));

    await db.runTransaction(async (tx) => {
      const marker = await tx.get(markerRef);
      if (marker.exists) return; // already settled

      const walletRef = db.collection('wallets').doc(uid);
      const wallet = await tx.get(walletRef);
      if (!wallet.exists) return;
      const userSnap = await tx.get(db.collection('users').doc(uid));

      const w = wallet.data();
      const movable = Math.min(
        want,
        Math.max(0, Math.floor(w.earnedBalance || 0)),
        Math.max(0, Math.floor(w.balance || 0)),
      );
      if (movable <= 0) return;

      // Only a CREATOR accrues revenue share. Same rule as earnedShareCredit:
      // the value is never refused, it moves to pendingCreatorCoins and is
      // shown back to them as the reason to apply, then accrues on approval.
      const u = userSnap.exists ? userSnap.data() : null;
      if ((u?.creator?.status || 'none') !== 'active') {
        tx.set(db.collection('users').doc(uid), {
          pendingCreatorCoins: FieldValue.increment(movable),
        }, { merge: true });
        tx.set(markerRef, {
          uid, coins: movable, owedMicroUsd: 0, pending: true, source, sourceId,
          createdAt: FieldValue.serverTimestamp(),
        });
        return;
      }

      const exempt = isVanguardExempt(u);
      // Rate comes from lifetime gross earned. The coins being settled here
      // were counted into totalEarnedCoinsGross by earnedCoinCredit when they
      // were credited, so this reads the tier the creator is in once this
      // earning counts, which is the generous reading and the one the Earnings
      // screen shows them.
      const share = exempt ? 1 : shareForEarnings(w.totalEarnedCoinsGross || 0);
      const owedMicroUsd = Math.floor(movable * share * COIN_MICRO_USD);

      tx.update(walletRef, {
        balance: FieldValue.increment(-movable),
        earnedBalance: FieldValue.increment(-movable),
        owedMicroUsd: FieldValue.increment(owedMicroUsd),
        totalOwedMicroUsd: FieldValue.increment(owedMicroUsd),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(db.collection('transactions').doc(), {
        userId: uid,
        type: 'revenue_share_accrued',
        // `earning: true` is stamped by the SERVER on every row that is real
        // creator income. The Earnings screen used to infer this from a
        // hand-kept list of type strings, which was wrong for four of the eight
        // types it listed. A fact beats a name.
        earning: true,
        currency: 'usd',
        amountMicroUsd: owedMicroUsd,
        description: `${movable.toLocaleString()} coins earned, your ${Math.round(share * 100)}% share is ${microUsdToStr(owedMicroUsd)}`,
        meta: { coins: movable, owedMicroUsd, share, source, sourceId, vanguardExempt: exempt },
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(markerRef, {
        uid, coins: movable, owedMicroUsd, share, source, sourceId,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (e) {
    // Never throw into the path that credited the money.
    console.error('settleEarnedShare failed', source, sourceId, e?.message || e);
  }
}

module.exports = {
  earnedCoinCredit,
  purchasedCoinCredit,
  convertibleCoins,
  earnedShareCredit,
  settleEarnedShare,
  microUsdToStr,
  COIN_MICRO_USD,
  // Revenue share ladder — the live rate model.
  shareForEarnings,
  REVENUE_SHARE_RATES,
  REVENUE_SHARE_THRESHOLDS,
  // Deprecated VP ladder, exported only until the last callsite moves.
  commissionForVP,
  isVanguardExempt,
};
