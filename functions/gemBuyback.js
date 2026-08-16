// Gems -> coins, flat 1:1.
//
// The other half of auto-convert-at-receipt (functions/coinLedger.js →
// earnedGemCredit). Neither may ship without the other: earned value now lands
// as gems, and gems cannot be spent in-app, so without this a creator who wants
// to tip someone, buy a subscription or unlock content has no way to do it with
// money they earned.
//
// This is exactly TikTok's shape. Diamonds are withdrawal-only; a creator who
// wants to send gifts buys Coins. The difference is that we let them convert
// back rather than forcing a fresh card payment, which is friendlier and still
// profitable, for the reason below.
//
// ── WHY 1:1 IS SAFE, AND WHERE THE LINE IS ───────────────────────────
//
// The founder's worry was: hold gems, level up, THEN buy back and profit. Run it
// through. Receive 1,000 coins at 30% -> 700 gems. Level to 20%. Buy back 700
// coins. Convert -> 560 gems. The user is 140 gems DOWN.
//
// Levelling up cannot help, because the buyback rate does not depend on rank.
// The round trip is `G -> G coins -> G*(1-commission) gems`, which loses money
// for every commission above zero.
//
// It only flips if the buyback pays more than `1 / (1 - commission)` coins per
// gem. At the best rank (15%) that line is 1.176. At 1:1 the margin is wide.
//
//   ⚠ NEVER make BUYBACK_COINS_PER_GEM depend on rank, VP, tier or anything
//   ⚠ else about the user, and NEVER raise it above 1.15.
//
// It is also quietly in the platform's favour: a gem is a USD 0.01 liability and
// buys back USD 0.0127 of coins at the ladder's entry rate, so we extinguish a
// cent of debt for slightly less than a cent of spendable credit, and take
// commission again on anything that comes back out.

const functions = require('firebase-functions/v2');
const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

/**
 * Flat, rank-independent, and deliberately not configurable from Firestore.
 *
 * A remotely-tunable buyback rate is a money pump one typo away from running:
 * push it past 1.176 and the round trip becomes profitable for users, silently,
 * with no deploy and no review. Changing this requires a code change and
 * therefore a diff someone reads.
 */
const BUYBACK_COINS_PER_GEM = 1;

/** Above this the round trip turns profitable at the best rank. Never exceed. */
const EXPLOIT_CEILING = 1.15;
if (BUYBACK_COINS_PER_GEM > EXPLOIT_CEILING) {
  throw new Error('BUYBACK_COINS_PER_GEM exceeds the exploit ceiling. Refusing to load.');
}

/** Stop dust conversions from filling the ledger with 1-gem rows. */
const MIN_GEMS = 10;

/**
 * ── DISABLED 2026-08-15 ──────────────────────────────────────────────
 * Buying coins with accrued revenue share treats it as a currency the user
 * holds and spends, which is the balance/stored-value shape the principal
 * model exists to remove (docs/REVENUE_SHARE_PLAN.md §1.5, §3.1). Revenue
 * share is owed and paid out on a schedule; it is not a wallet.
 * Body retained, not deleted.
 */
const BUYBACK_DISABLED = () => new functions.https.HttpsError(
  'failed-precondition',
  'This is no longer available. Your revenue share is paid out to you on a schedule.',
);

exports.buyCoinsWithGems = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    throw BUYBACK_DISABLED();

    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
    if (request.auth?.token?.firebase?.sign_in_provider === 'anonymous') {
      throw new HttpsError('permission-denied', 'Guest accounts cannot convert gems.');
    }

    const gems = Math.floor(Number(request.data?.gems) || 0);
    if (gems < MIN_GEMS) {
      throw new HttpsError('invalid-argument', `Minimum is ${MIN_GEMS} gems.`);
    }

    const coins = Math.floor(gems * BUYBACK_COINS_PER_GEM);
    if (coins <= 0) throw new HttpsError('invalid-argument', 'Nothing to convert.');

    return db.runTransaction(async (tx) => {
      const walletRef = db.collection('wallets').doc(uid);
      const snap = await tx.get(walletRef);
      if (!snap.exists) throw new HttpsError('failed-precondition', 'Wallet not found.');

      const held = Math.floor(snap.data().gems || 0);
      if (held < gems) {
        throw new HttpsError('failed-precondition', `You have ${held} gems, not ${gems}.`);
      }

      // Coins bought back are EARNED, not purchased.
      //
      // Classifying them as purchased would trap the money permanently: the user
      // could never convert it back out, and would rightly report it as stolen.
      // Earned is safe precisely because the round trip is lossy (see the header),
      // so nobody can cycle it for gain. It also keeps the Play wall intact:
      // these coins originated as RECEIVED value, never as a card purchase, so
      // purchased coins still have no route to gems.
      tx.update(walletRef, {
        gems: FieldValue.increment(-gems),
        balance: FieldValue.increment(coins),
        earnedBalance: FieldValue.increment(coins),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(db.collection('transactions').doc(), {
        userId: uid,
        type: 'gem_buyback',
        currency: 'coins',
        amount: coins,
        description: `Converted ${gems.toLocaleString()} gems to ${coins.toLocaleString()} coins`,
        meta: { gems, coins, rate: BUYBACK_COINS_PER_GEM },
        createdAt: FieldValue.serverTimestamp(),
      });

      return { ok: true, gems, coins, rate: BUYBACK_COINS_PER_GEM };
    });
  },
);

exports._buybackConfig = { BUYBACK_COINS_PER_GEM, EXPLOIT_CEILING, MIN_GEMS };
