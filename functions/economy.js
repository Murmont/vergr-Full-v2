// Server-side economy guards.
//
// Rate-limit + daily-cap helpers shared by tipping and payouts so a single user
// cannot drain the system through volume.
//
// This file used to own convertCoinsToGems as well. That went with the gem unit
// on 2026-08-16; see the note further down.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { convertibleCoins, shareForEarnings } = require('./coinLedger');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';

// ── REVENUE SHARE + LIMITS ────────────────────────────────────────────
// The rate ladder lives in ./coinLedger.js and is imported, NOT re-declared.
// It used to be copy-pasted into this file, which meant three hand-maintained
// mirrors of the same array and a silent split-brain the first time one moved.
// See docs/REVENUE_SHARE_PLAN.md.
//
// The client mirror in src/utils/vpSystem.js still has to be kept equal by hand
// (it cannot require a functions/ module), so any change to the ladder is a
// TWO-file change: coinLedger.js and vpSystem.js.

/**
 * @deprecated VP-keyed commission. Superseded by shareForEarnings(). Retained
 * only so anything still importing it from this module keeps working.
 */
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
// with the balance update); we read first, then increment in a write.
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

// convertCoinsToGems REMOVED 2026-08-16, along with the gem unit.
//
// It was a USER-INVOKED conversion of earned coins into a second currency the
// user then held. docs/REVENUE_SHARE_PLAN.md is explicit that conversion is
// "automatic accrual at the moment revenue is earned", not an action someone
// takes, and a balance a customer converts and calls on is the deposit shape
// the whole revenue-share model exists to avoid.
//
// Revenue share now accrues in micro-USD at the moment value is received, in
// coinLedger.js (earnedShareCredit / settleEarnedShare). Nothing replaces this
// callable, because nothing should.

// Exported for other modules (nowpayments.js will use these for rate limits
// on payouts and the daily-cap on tips).
exports.LIMITS = LIMITS;
exports.commissionForVP = commissionForVP;
exports.checkRateLimit = checkRateLimit;
