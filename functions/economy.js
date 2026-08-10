// Server-side economy guards.
//
// Phase 3 — convertCoinsToGems callable: moves the coin→gem conversion off
// the client. Atomic gem credit + platform-commission ledger entry + rate
// limiting + idempotency.
//
// Phase 4 — rate-limit + daily-cap helpers shared by tipping, conversion,
// and payouts so a single user can't drain the system through volume.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { convertibleCoins } = require('./coinLedger');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';

// ── COMMISSION + LIMITS (mirrors src/utils/vpSystem.js) ───────────────
const COMMISSION_RATES = [0.30, 0.28, 0.25, 0.22, 0.20, 0.18, 0.15];
const VP_THRESHOLDS    = [0,    500,  2000, 5000, 15000, 40000, 100000];

const commissionForVP = (vp = 0) => {
  for (let i = VP_THRESHOLDS.length - 1; i >= 0; i--) {
    if (vp >= VP_THRESHOLDS[i]) return COMMISSION_RATES[i];
  }
  return 0.30;
};

const LIMITS = {
  // Conversions
  CONVERT_PER_HOUR:    5,
  CONVERT_PER_DAY:     20,
  CONVERT_DAILY_COINS: 100_000, // 100k coins/day (≈ €1,000 worth)
  // Payouts
  PAYOUT_DAILY_EUR:    1_000,   // €1,000 across all currencies / 24h
  PAYOUT_AUTO_APPROVE_EUR: 500, // single payout > €500 needs admin approval
  // Tips
  TIP_PER_HOUR:        30,
  TIP_PER_DAY:         200,
};

const requireAuth = (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  return uid;
};

// ════════════════════════════════════════════════════════════════════
// Rate limiter — increments a per-user counter inside a transaction.
// ════════════════════════════════════════════════════════════════════
// Stored at `rate_limits/{uid}/{action}/{windowKey}` where windowKey is
// either an hour key (`YYYYMMDDHH`) or day key (`YYYYMMDD`). We reset
// implicitly because each window has its own doc — older docs go cold.
//
// Caller passes a transaction `tx` (so the counter increment is atomic
// with the gem/coin update); we read first, then increment in a write.
async function checkRateLimit(tx, uid, action, { perHour, perDay, sumField, sumLimit, sumValue }) {
  const now = new Date();
  const hourKey = now.toISOString().slice(0, 13).replace(/[-T:]/g, '');
  const dayKey  = now.toISOString().slice(0, 10).replace(/-/g, '');

  const hourRef = db.collection('rate_limits').doc(uid).collection(action).doc(`h_${hourKey}`);
  const dayRef  = db.collection('rate_limits').doc(uid).collection(action).doc(`d_${dayKey}`);

  const [hourSnap, daySnap] = await Promise.all([tx.get(hourRef), tx.get(dayRef)]);
  const hourCount = hourSnap.exists ? (hourSnap.data().count || 0) : 0;
  const dayCount  = daySnap.exists  ? (daySnap.data().count  || 0) : 0;
  const daySum    = (daySnap.exists && sumField) ? (daySnap.data()[sumField] || 0) : 0;

  if (perHour && hourCount >= perHour) {
    throw new functions.https.HttpsError('resource-exhausted',
      `Rate limit reached (${perHour} ${action.replace(/_/g, ' ')}/hour). Try again later.`);
  }
  if (perDay && dayCount >= perDay) {
    throw new functions.https.HttpsError('resource-exhausted',
      `Daily limit reached (${perDay} ${action.replace(/_/g, ' ')}/day). Try again tomorrow.`);
  }
  if (sumField && sumLimit && (daySum + (sumValue || 0)) > sumLimit) {
    throw new functions.https.HttpsError('resource-exhausted',
      `Daily volume limit reached. Try again tomorrow.`);
  }

  // Schedule writes (we're inside the caller's transaction)
  tx.set(hourRef, {
    count: hourCount + 1,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  tx.set(dayRef, {
    count: dayCount + 1,
    ...(sumField ? { [sumField]: daySum + (sumValue || 0) } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

// ════════════════════════════════════════════════════════════════════
// 1. convertCoinsToGems — server-side conversion callable
// ════════════════════════════════════════════════════════════════════
// Input:  { amount: number (coins), idempotencyKey?: string }
// Output: { gemsCredited, platformCut, commission, newCoinBalance, newGemBalance }

exports.convertCoinsToGems = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = requireAuth(request);
    const amount = Math.floor(Number(request.data?.amount) || 0);
    const idempotencyKey = String(request.data?.idempotencyKey || '').slice(0, 64);
    if (amount <= 0) {
      throw new functions.https.HttpsError('invalid-argument', 'Amount must be positive');
    }
    if (amount > 100_000) {
      throw new functions.https.HttpsError('invalid-argument', 'Max 100,000 coins per conversion');
    }

    return db.runTransaction(async (tx) => {
      // Idempotency guard
      if (idempotencyKey) {
        const idRef = db.collection('idempotency').doc(`convert_${uid}_${idempotencyKey}`);
        const idSnap = await tx.get(idRef);
        if (idSnap.exists) {
          return idSnap.data().result;
        }
      }

      // Rate limits
      await checkRateLimit(tx, uid, 'convert', {
        perHour: LIMITS.CONVERT_PER_HOUR,
        perDay:  LIMITS.CONVERT_PER_DAY,
        sumField: 'coinsConverted',
        sumLimit: LIMITS.CONVERT_DAILY_COINS,
        sumValue: amount,
      });

      // Wallet read + balance check
      const walletRef = db.collection('wallets').doc(uid);
      const walletSnap = await tx.get(walletRef);
      if (!walletSnap.exists) {
        throw new functions.https.HttpsError('failed-precondition', 'Wallet not found');
      }
      const w = walletSnap.data();
      if ((w.balance || 0) < amount) {
        throw new functions.https.HttpsError('failed-precondition', 'Insufficient coin balance');
      }

      // Only RECEIVED value converts to gems. Coins the user bought are
      // spendable in-app but never convertible, because converting them and
      // withdrawing would turn Play Billing into a cash-out rail. See
      // coinLedger.js for the full reasoning — this check is the enforcement
      // point for the whole split, so it must stay server-side.
      const convertible = convertibleCoins(w);
      if (convertible < amount) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Only coins you have earned can be converted to gems. You can convert ${convertible} right now. Coins you purchased can be spent anywhere in VERGR, but not cashed out.`
        );
      }

      // Vanguard perk: active Vanguard members convert coins → gems at 0%
      // commission. Read inside the transaction so a rank flip mid-write
      // is still consistent. Suspended/retired Vanguard fall back to tier
      // commission like any other user.
      const userSnap = await tx.get(db.collection('users').doc(uid));
      const userData = userSnap.exists ? userSnap.data() : {};
      const vanguardActive = userData.vanguard?.rank
        && userData.vanguard?.status !== 'suspended'
        && userData.vanguard?.status !== 'retired';
      const commission = vanguardActive ? 0 : commissionForVP(w.vp || 0);
      const gemsCredited = Math.floor(amount * (1 - commission));
      const platformCut  = amount - gemsCredited;
      const newCoinBalance = (w.balance || 0) - amount;
      const newGemBalance  = (w.gems || 0) + gemsCredited;

      tx.update(walletRef, {
        balance: FieldValue.increment(-amount),
        // Converting consumes the earned pool as well, or the same earned
        // coins could be converted repeatedly as new purchases topped the
        // balance back up.
        earnedBalance: FieldValue.increment(-amount),
        gems: FieldValue.increment(gemsCredited),
        totalGemsEarned: FieldValue.increment(gemsCredited),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Two ledger entries: debit coin side + credit gem side
      tx.set(db.collection('transactions').doc(), {
        userId: uid, type: 'coin_to_gem_conversion',
        amount: -amount, currency: 'coins',
        description: `Converted ${amount} coins → ${gemsCredited} gems (${Math.round((1 - commission) * 100)}% rate)`,
        meta: { coinsSpent: amount, gemsCredited, commission, platformCut },
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('transactions').doc(), {
        userId: uid, type: 'coin_to_gem_conversion',
        amount: gemsCredited, currency: 'gems',
        description: `Received ${gemsCredited} gems from conversion`,
        createdAt: FieldValue.serverTimestamp(),
      });

      // Platform-side commission ledger (admin-only readable)
      tx.set(db.collection('platform_commissions').doc(), {
        type: 'conversion_commission',
        userId: uid,
        coinsSpent: amount,
        gemsCredited,
        commission,
        platformCut,
        createdAt: FieldValue.serverTimestamp(),
      });

      const result = { gemsCredited, platformCut, commission, newCoinBalance, newGemBalance };

      // Persist idempotency result for 24h (retention via scheduled cleanup)
      if (idempotencyKey) {
        tx.set(db.collection('idempotency').doc(`convert_${uid}_${idempotencyKey}`), {
          result, createdAt: FieldValue.serverTimestamp(),
        });
      }

      return result;
    });
  }
);

// Exported for other modules (nowpayments.js will use these for rate limits
// on payouts and the daily-cap on tips).
exports.LIMITS = LIMITS;
exports.commissionForVP = commissionForVP;
exports.checkRateLimit = checkRateLimit;
