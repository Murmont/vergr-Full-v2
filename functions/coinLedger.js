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

module.exports = { earnedCoinCredit, purchasedCoinCredit, convertibleCoins };
