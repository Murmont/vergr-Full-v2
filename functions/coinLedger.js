// Coin ledger — the purchased/earned split.
//
// WHY THIS EXISTS (do not collapse the two fields back into one):
// Google Play's Payments policy requires that in-app virtual currency is only
// used within the app it was bought in. A user who buys coins with Play Billing
// and then converts them to gems and withdraws USDC has turned Play's billing
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
//                         This is the only pool that may convert to gems.
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
 * and are therefore convertible to gems (and so withdrawable).
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
    // Deliberately NOT incremented again in settleEarnedToGems: that helper
    // only moves coins already counted here into the gem pool, and counting at
    // both sites would double every non-tip earner's progress.
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
 * How many coins this wallet may convert to gems right now.
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
// AUTO-CONVERT AT RECEIPT (founder approved 2026-08-11)
// ════════════════════════════════════════════════════════════════════
//
// Earned value converts to GEMS the moment it is received, at the recipient's
// commission rate AT THAT MOMENT. This is the TikTok model: gifts land as
// Diamonds, and a creator who wants to send gifts buys Coins with cash like
// anyone else.
//
// ## What it closes
//
// Under the old model a Rookie could sit on earned coins, grind to Immortal, and
// convert the whole stored balance at 15% instead of 30%. On 1,000 coins that is
// 850 gems paid instead of 700, i.e. EUR 1.50 per 1,000 coins straight off the
// margin, on money that was earned while the low rank applied.
//
// ## Why this does NOT kill in-app spending
//
// It would, on its own. `buyCoinsWithGems` (functions/gemBuyback.js) is the other
// half and MUST ship with it: gems buy coins back at a flat 1:1. Auto-convert
// without the buyback strands every creator who wants to spend.
//
// ## Why the round trip is not an exploit
//
// Buying back is flat and rank-independent, and converting charges commission
// again. Receive 1,000 at 30% -> 700 gems; buy back 700 coins; convert at 20% ->
// 560 gems. The user is 140 down. It is only profitable if the buyback ever pays
// more than `1 / (1 - commission)` coins per gem, which is 1.18 at the best rank.
// At 1:1 there is a wide margin. NEVER make the buyback rank-dependent, and never
// let it exceed 1.15.
//
// ## The cost, accepted knowingly
//
// The commission ladder stops being retroactive: levelling up helps future
// earnings only, never a balance already earned.

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
 * Mirrors the check in economy.js → convertCoinsToGems. Suspended and retired
 * Vanguard fall back to tier commission like anyone else.
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
 * Wallet fields for earned value arriving as GEMS, converted at receipt.
 *
 * Returns the increments to merge into the wallet write the caller was already
 * making, plus the numbers for the ledger row, so a caller cannot convert and
 * forget to record the rate it converted at.
 *
 * @param {number}  coins       gross coins earned, BEFORE the share is applied
 * @param {number}  earnedGross recipient's LIFETIME gross coins earned before
 *        this credit (`wallets/{uid}.totalEarnedCoinsGross`). Drives the rate.
 *        This replaced VP on 2026-08-14; passing VP here silently prices a
 *        creator at tier 1, because VP values are far below the coin thresholds.
 * @param {object} [opts]
 * @param {boolean} [opts.vanguardExempt] active Vanguard earn at 100%. Pass
 *        `isVanguardExempt(userDoc)`. Vanguard is being redone separately; this
 *        flag is carried through untouched by the revenue-share migration.
 * @returns {{fields: object, gems: number, share: number, commission: number, coins: number}}
 */
function earnedGemCredit(coins, earnedGross, opts = {}) {
  const gross = Math.floor(Number(coins) || 0);
  if (gross <= 0) return { fields: {}, gems: 0, share: 0, commission: 0, coins: 0 };

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
      gems: 0, share: 0, commission: 1, coins: gross, pending: true,
    };
  }

  const share = opts.vanguardExempt ? 1 : shareForEarnings(earnedGross);
  // Floor, never round: rounding up would pay out fractions of a cent we never
  // collected, on every single receipt.
  const gems = Math.floor(gross * share);

  return {
    fields: {
      gems: FieldValue.increment(gems),
      // Lifetime gross, for the creator's own "you have earned X" figure. NOT a
      // balance and never spendable: the spendable result is `gems` above.
      // ALSO the input to the rate ladder, so it must be incremented on every
      // earning path or a creator never climbs a tier.
      totalEarnedCoinsGross: FieldValue.increment(gross),
      updatedAt: FieldValue.serverTimestamp(),
    },
    gems,
    share,
    // Retained so existing ledger rows and admin reporting keep their shape.
    commission: 1 - share,
    coins: gross,
  };
}

/**
 * Convert coins that were JUST credited as earned into gems, at the recipient's
 * current rate. Runs POST-COMMIT, outside the transaction that credited them.
 *
 * ## Why two shapes exist
 *
 * Where the crediting transaction already reads the recipient's wallet (sendTip
 * does), converting INLINE is strictly better: it is atomic, and the coins never
 * exist as coins. Use `earnedGemCredit` there.
 *
 * Most sites do not. They write the creator's wallet with `set(..., {merge:true})`
 * and never read it, so there is no VP to price with and no cheap way to get one
 * without reshaping the transaction and its read-before-write ordering. This
 * helper is for those: it runs immediately after the commit, exactly like
 * `creditReferralPurchaseBonus` and `bookCoinPurchase` already do.
 *
 * ## The failure mode is deliberately benign
 *
 * If this throws or never runs, the coins simply stay coins under the old model.
 * The user keeps every unit of value; they just hold it in the spendable pool
 * instead of the withdrawable one, and can still convert manually. Nothing is
 * lost and nothing is double-counted, which is why it is safe to fire-and-forget.
 *
 * ## Clamping
 *
 * Converts `min(coins, earnedBalance, balance)`. If the user spent between the
 * credit and this call, the clamp stops us moving coins that are no longer there
 * and turning a wallet negative.
 *
 * @param {import('firebase-admin/firestore').Firestore} db
 * @param {object} p
 * @param {string} p.uid       recipient
 * @param {number} p.coins     coins just credited as earned
 * @param {string} p.source    'membership' | 'ticket' | 'ad_reward' | ...
 * @param {string} p.sourceId  stable unique id, for idempotency
 */
async function settleEarnedToGems(db, { uid, coins, source, sourceId }) {
  try {
    const want = Math.floor(Number(coins) || 0);
    if (!uid || want <= 0 || !sourceId) return;

    const markerRef = db.collection('earned_gem_settlements')
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

      // Only a CREATOR accrues revenue share. Same rule as earnedGemCredit:
      // the value is never refused, it moves to pendingCreatorCoins and is shown
      // back to them as the reason to apply, then converts on approval.
      // This is the path memberships, event tickets, season passes, locked
      // content, ad rewards and referral revenue all use, so without it the
      // gate only covered tips.
      const u = userSnap.exists ? userSnap.data() : null;
      if ((u?.creator?.status || 'none') !== 'active') {
        tx.set(db.collection('users').doc(uid), {
          pendingCreatorCoins: FieldValue.increment(movable),
        }, { merge: true });
        tx.set(markerRef, {
          uid, coins: movable, gems: 0, pending: true, source, sourceId,
          createdAt: FieldValue.serverTimestamp(),
        });
        return;
      }

      const exempt = isVanguardExempt(u);
      // Rate comes from lifetime gross earned, not VP (2026-08-14). The coins
      // being settled here were already counted into totalEarnedCoinsGross by
      // earnedCoinCredit at the moment they were credited, so this figure
      // already includes them — the creator is priced at the tier they are in
      // once this earning is counted, which is the generous reading and the one
      // that matches what the Earnings screen shows them.
      const share = exempt ? 1 : shareForEarnings(w.totalEarnedCoinsGross || 0);
      const commission = 1 - share;
      const gems = Math.floor(movable * share);

      tx.update(walletRef, {
        balance: FieldValue.increment(-movable),
        earnedBalance: FieldValue.increment(-movable),
        gems: FieldValue.increment(gems),
        totalGemsEarned: FieldValue.increment(gems),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(db.collection('transactions').doc(), {
        userId: uid,
        type: 'earned_auto_converted',
        currency: 'gems',
        amount: gems,
        description: `${movable.toLocaleString()} coins earned, your ${Math.round(share * 100)}% share is ${gems.toLocaleString()} gems`,
        meta: { coins: movable, gems, share, commission, source, sourceId, vanguardExempt: exempt },
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(markerRef, {
        uid, coins: movable, gems, commission, source, sourceId,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (e) {
    // Never throw into the path that credited the money.
    console.error('settleEarnedToGems failed', source, sourceId, e?.message || e);
  }
}

module.exports = {
  earnedCoinCredit,
  purchasedCoinCredit,
  convertibleCoins,
  earnedGemCredit,
  settleEarnedToGems,
  // Revenue share ladder — the live rate model.
  shareForEarnings,
  REVENUE_SHARE_RATES,
  REVENUE_SHARE_THRESHOLDS,
  // Deprecated VP ladder, exported only until the last callsite moves.
  commissionForVP,
  isVanguardExempt,
};
