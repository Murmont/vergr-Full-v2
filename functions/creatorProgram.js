// functions/creatorProgram.js
//
// The Creator Program. Anyone can USE Vergr; only a creator can MONETIZE.
// Users are not creators by default, they apply and a human reviews it.
// Plan + founder decisions: docs/CREATOR_PROGRAM_PLAN.md.
//
// Why this exists at all, beyond product tidiness: the principal model in
// docs/REVENUE_SHARE_PLAN.md says Vergr buys content services from suppliers.
// A supplier relationship needs someone who AGREED to be one, on a date, from
// an identified account. Implicit creator status quietly undermines the whole
// argument, and gross-revenue tax accounting means reporting on people who
// must have agreed to be contractors.

const functions = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

// ⚠ The NAMED database. admin.firestore() opens (default), which holds no users,
// wallets or applications, so until 2026-09-19 every eligibility check read an
// empty profile and every application landed where the admin screen never looks.
// raids.js had the same bug.
const db = getFirestore('vgrdb');
const { FieldValue } = admin.firestore;
const REGION = 'europe-west1';

const err = (code, msg) => new functions.https.HttpsError(code, msg);

// ── Eligibility ───────────────────────────────────────────────────────
//
// Always required, no alternatives. KYC does double duty: it is the fraud
// control AND what the payout partner (Trolley) will demand anyway, so making
// it the entry price means nobody hits a surprise wall later at payout time.
//
// Then ONE qualifying path from a menu. A single threshold on a platform this
// size locks out people who would be good creators by a different route, and
// Twitch's concurrency test is impossible below a few thousand users, so it is
// dropped and the rest are scaled down.
//
// DELIBERATELY NOT a criterion: account age. That gates revenue-share PAYOUT
// (MIN_ACCOUNT_AGE_DAYS in creatorPayouts.js), which is a separate, later step.

const PATHS = {
  audience: {
    label: 'Audience',
    describe: 'Reach 100 followers',
    target: 100,
    unit: 'followers',
  },
  streamer: {
    label: 'Streamer',
    describe: 'Stream on 5 separate days, 120 minutes total, in the last 30 days',
    target: 5,
    unit: 'stream days',
  },
  builder: {
    // Founder decision 2026-08-15: invites made BEFORE applying count, or early
    // supporters are penalised for having helped sooner.
    label: 'Builder',
    describe: 'Invite 5 friends who join and are still active after 7 days',
    target: 5,
    unit: 'active referrals',
  },
  contributor: {
    label: 'Contributor',
    describe: 'Publish 20 posts in the last 30 days',
    target: 20,
    unit: 'posts',
  },
};

const STREAM_MINUTES_REQUIRED = 120;
const REFERRAL_SURVIVAL_DAYS = 7;
const WINDOW_DAYS = 30;

/**
 * Cooldown after a rejection. Twitch lets you reapply after 30 days; same here,
 * because the criteria are things that take roughly that long to move.
 * A rejection for fraud or strikes is NOT on a timer: it stays until the strike
 * expires or an appeal succeeds, which is what `blockedUntilClean` expresses.
 */
const REAPPLY_COOLDOWN_DAYS = 30;
const HARD_REJECT_REASONS = new Set(['fraud', 'strikes', 'impersonation', 'underage']);

const daysAgoMs = (d) => Date.now() - d * 86_400_000;
const toMs = (t) => (typeof t?.toMillis === 'function' ? t.toMillis() : (t ? new Date(t).getTime() : 0));

/** Measure every path. Returns progress for ALL of them so the UI can show a menu. */
async function measurePaths(uid) {
  const since = new Date(daysAgoMs(WINDOW_DAYS));
  const out = {};

  const userSnap = await db.collection('users').doc(uid).get();
  const user = userSnap.exists ? userSnap.data() : {};

  out.audience = { ...PATHS.audience, progress: Number(user.followerCount || 0) };

  // Streams: distinct days broadcast + total minutes, in the window.
  try {
    const streams = await db.collection('streams')
      .where('hostUid', '==', uid).where('createdAt', '>=', since).limit(200).get();
    const days = new Set();
    let minutes = 0;
    streams.forEach((d) => {
      const s = d.data();
      const start = toMs(s.createdAt);
      if (start) days.add(new Date(start).toISOString().slice(0, 10));
      const end = toMs(s.endedAt);
      if (start && end && end > start) minutes += (end - start) / 60_000;
    });
    out.streamer = {
      ...PATHS.streamer,
      progress: days.size,
      minutes: Math.round(minutes),
      minutesRequired: STREAM_MINUTES_REQUIRED,
    };
  } catch { out.streamer = { ...PATHS.streamer, progress: 0, minutes: 0, minutesRequired: STREAM_MINUTES_REQUIRED }; }

  // Referrals that STUCK. The survival window is what kills invite farming.
  try {
    const refs = await db.collection('users').where('referredBy', '==', uid).limit(200).get();
    let active = 0;
    refs.forEach((d) => {
      const r = d.data();
      const joined = toMs(r.createdAt);
      const seen = toMs(r.lastSeen);
      if (joined && seen && seen - joined >= REFERRAL_SURVIVAL_DAYS * 86_400_000) active++;
    });
    out.builder = { ...PATHS.builder, progress: active };
  } catch { out.builder = { ...PATHS.builder, progress: 0 }; }

  try {
    const posts = await db.collection('posts')
      .where('authorId', '==', uid).where('createdAt', '>=', since).limit(100).get();
    out.contributor = { ...PATHS.contributor, progress: posts.size };
  } catch { out.contributor = { ...PATHS.contributor, progress: 0 }; }

  for (const k of Object.keys(out)) {
    const p = out[k];
    p.met = k === 'streamer'
      ? p.progress >= p.target && p.minutes >= STREAM_MINUTES_REQUIRED
      : p.progress >= p.target;
  }
  return out;
}

/** Hard requirements, all mandatory. */
function measureRequired(user) {
  const kyc = Number(user?.kycLevel || 0);
  const strikes = Number(user?.creator?.strikes || user?.activeStrikes || 0);
  const dob = toMs(user?.dob || user?.dateOfBirth);
  const is18 = dob ? (Date.now() - dob) / 31_557_600_000 >= 18 : null;
  return {
    identity: { label: 'Identity verified', met: kyc >= 1, detail: kyc >= 1 ? 'Verified' : 'Required' },
    adult:    { label: '18 or over', met: is18 !== false, detail: is18 === null ? 'From your date of birth' : (is18 ? 'Confirmed' : 'Not eligible') },
    clean:    { label: 'No active strikes', met: strikes === 0, detail: strikes ? `${strikes} active` : 'Clear' },
  };
}

/** Everything the "become a creator" screen needs, in one call. */
exports.getCreatorEligibility = functions.https.onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw err('unauthenticated', 'Sign in first.');

  const userSnap = await db.collection('users').doc(uid).get();
  const user = userSnap.exists ? userSnap.data() : {};
  const creator = user.creator || { status: 'none' };

  const required = measureRequired(user);
  const paths = await measurePaths(uid);

  const requiredMet = Object.values(required).every((r) => r.met);
  const pathMet = Object.values(paths).some((p) => p.met);

  // Cooldown after a soft rejection.
  const decidedAt = toMs(creator.decidedAt);
  const hardBlocked = creator.status === 'rejected' && HARD_REJECT_REASONS.has(creator.reasonCode);
  const cooldownEndsMs = decidedAt && !hardBlocked
    ? decidedAt + REAPPLY_COOLDOWN_DAYS * 86_400_000 : 0;
  const inCooldown = cooldownEndsMs > Date.now();

  return {
    status: creator.status || 'none',
    required, paths,
    requiredMet, pathMet,
    canApply: requiredMet && pathMet && creator.status !== 'pending'
      && creator.status !== 'active' && !inCooldown && !hardBlocked,
    inCooldown, cooldownEndsMs, hardBlocked,
    reapplyCooldownDays: REAPPLY_COOLDOWN_DAYS,
    // Value already received while not a creator. This is the number that makes
    // the case to them, per founder decision 3: a tip is never refused, it is
    // counted and shown back.
    pendingCoins: Number(user.pendingCreatorCoins || 0),
  };
});

/** Apply. Manual review (founder decision 1), so this only ever sets 'pending'. */
exports.applyForCreator = functions.https.onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw err('unauthenticated', 'Sign in first.');
  const agreed = request.data?.agreedToTerms === true;
  if (!agreed) throw err('failed-precondition', 'You must accept the Creator Agreement.');

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const user = userSnap.exists ? userSnap.data() : {};
  const creator = user.creator || { status: 'none' };

  if (creator.status === 'active') throw err('failed-precondition', 'You are already a creator.');
  if (creator.status === 'pending') throw err('failed-precondition', 'Your application is already being reviewed.');
  if (creator.status === 'rejected' && HARD_REJECT_REASONS.has(creator.reasonCode)) {
    throw err('failed-precondition', 'This account is not eligible. Contact support.');
  }
  const decidedAt = toMs(creator.decidedAt);
  if (decidedAt && Date.now() < decidedAt + REAPPLY_COOLDOWN_DAYS * 86_400_000) {
    throw err('failed-precondition', `You can reapply ${REAPPLY_COOLDOWN_DAYS} days after a decision.`);
  }

  const required = measureRequired(user);
  if (!Object.values(required).every((r) => r.met)) {
    throw err('failed-precondition', 'You do not meet the basic requirements yet.');
  }
  const paths = await measurePaths(uid);
  const qualified = Object.entries(paths).filter(([, p]) => p.met).map(([k]) => k);
  if (!qualified.length) throw err('failed-precondition', 'You do not meet any qualifying path yet.');

  const now = FieldValue.serverTimestamp();
  await userRef.set({
    creator: { status: 'pending', appliedAt: now, qualifiedVia: qualified, agreedToTermsAt: now },
  }, { merge: true });

  // The application doc is the reviewer's record. A SNAPSHOT of the measurements
  // is stored, not a live recompute, so the reviewer sees what was true when the
  // person applied and the decision can be audited later.
  await db.collection('creator_applications').doc(uid).set({
    uid,
    username: user.username || null,
    displayName: user.displayName || null,
    avatar: user.avatar || null,
    status: 'pending',
    appliedAt: now,
    qualifiedVia: qualified,
    snapshot: { required, paths },
    followerCount: Number(user.followerCount || 0),
    kycLevel: Number(user.kycLevel || 0),
    pendingCoins: Number(user.pendingCreatorCoins || 0),
  }, { merge: true });

  return { status: 'pending', qualifiedVia: qualified };
});

// ── Admin review ──────────────────────────────────────────────────────

async function assertAdmin(uid) {
  if (!uid) throw err('unauthenticated', 'Sign in first.');
  const s = await db.collection('users').doc(uid).get();
  if (!s.exists || s.data()?.role !== 'admin') throw err('permission-denied', 'Admins only.');
}

exports.adminListCreatorApplications = functions.https.onCall({ region: REGION }, async (request) => {
  await assertAdmin(request.auth?.uid);
  const status = request.data?.status || 'pending';
  const limit = Math.min(Number(request.data?.limit) || 50, 200);
  const snap = await db.collection('creator_applications')
    .where('status', '==', status).orderBy('appliedAt', 'desc').limit(limit).get();
  return {
    applications: snap.docs.map((d) => {
      const a = d.data();
      return { ...a, id: d.id, appliedAtMs: toMs(a.appliedAt), decidedAtMs: toMs(a.decidedAt) };
    }),
  };
});

/**
 * Approve or reject. `reasonCode` matters: a hard reason (fraud, strikes,
 * impersonation, underage) blocks reapplication entirely; anything else starts
 * the 30-day cooldown.
 */
exports.adminDecideCreatorApplication = functions.https.onCall({ region: REGION }, async (request) => {
  const adminUid = request.auth?.uid;
  await assertAdmin(adminUid);

  const { targetUid, decision, reasonCode = 'not_ready', notes = '' } = request.data || {};
  if (!targetUid || typeof targetUid !== 'string') throw err('invalid-argument', 'targetUid required.');
  if (!['approve', 'reject'].includes(decision)) throw err('invalid-argument', 'decision must be approve or reject.');

  const status = decision === 'approve' ? 'active' : 'rejected';
  const now = FieldValue.serverTimestamp();

  // On approval, everything they received while not a creator converts at their
  // current rate. Founder decision 2026-08-15: farming before approval does not
  // matter, because a new creator is on tier 1 and keeps 50%, so the platform
  // still earns on it either way.
  //
  // Atomic and idempotent: the pending pot is read and zeroed inside the same
  // transaction, so approving twice cannot double-credit.
  // Required at function scope, not inside the approve branch: the approval
  // notification below formats the amount and runs outside that branch.
  const { shareForEarnings, COIN_MICRO_USD, microUsdToStr } = require('./coinLedger');

  let converted = null;
  if (decision === 'approve') {
    converted = await db.runTransaction(async (tx) => {
      const wRef = db.collection('wallets').doc(targetUid);
      const uRef = db.collection('users').doc(targetUid);
      const [wSnap, uSnap] = await Promise.all([tx.get(wRef), tx.get(uRef)]);
      const w = wSnap.exists ? wSnap.data() : {};
      const u = uSnap.exists ? uSnap.data() : {};
      const pending = Math.floor(Number(u.pendingCreatorCoins || 0));
      if (pending <= 0) return null;

      const share = shareForEarnings(Number(w.totalEarnedCoinsGross || 0));

      // The pending coins are STILL SITTING IN THE WALLET. settleEarnedShare's
      // non-creator branch only records the amount on pendingCreatorCoins; it
      // deliberately leaves the coins alone so a non-creator can still spend
      // them. Accruing the share here without removing them paid this creator
      // twice: once as spendable coins, once as revenue share owed. Clamp to
      // what is actually there, exactly as settleEarnedShare does, because they
      // may have spent some of it while waiting for approval.
      const movable = Math.min(
        pending,
        Math.max(0, Math.floor(w.earnedBalance || 0)),
        Math.max(0, Math.floor(w.balance || 0)),
      );
      const owedForMovable = Math.floor(movable * share * COIN_MICRO_USD);

      tx.set(wRef, {
        balance: FieldValue.increment(-movable),
        earnedBalance: FieldValue.increment(-movable),
        owedMicroUsd: FieldValue.increment(owedForMovable),
        totalOwedMicroUsd: FieldValue.increment(owedForMovable),
        // NOT incremented: earnedCoinCredit already counted these coins into
        // totalEarnedCoinsGross when they were received. Counting again here
        // would double this creator's progress up the rate ladder.
        updatedAt: now,
      }, { merge: true });
      tx.set(uRef, { pendingCreatorCoins: 0 }, { merge: true });

      // Type is on the Earnings screen allowlist, so it shows as real income.
      tx.set(db.collection('transactions').doc(), {
        userId: targetUid,
        type: 'earned_auto_converted',
        earning: true,
        currency: 'usd',
        amountMicroUsd: owedForMovable,
        amount: owedForMovable,
        description: `Earned ${microUsdToStr(owedForMovable)} — your ${Math.round(share * 100)}% share of ${movable} coins received before you became a creator`,
        meta: { coins: movable, owedMicroUsd: owedForMovable, share, source: 'creator_approval' },
        createdAt: now,
      });

      return { coins: movable, owedMicroUsd: owedForMovable, share };
    });
  }

  await db.collection('users').doc(targetUid).set({
    creator: {
      status,
      decidedAt: now,
      decidedBy: adminUid,
      reasonCode: decision === 'reject' ? reasonCode : null,
    },
  }, { merge: true });

  await db.collection('creator_applications').doc(targetUid).set({
    status, decidedAt: now, decidedBy: adminUid, reasonCode, notes,
  }, { merge: true });

  await db.collection('notifications').add({
    recipientId: targetUid,
    type: decision === 'approve' ? 'creator_approved' : 'creator_rejected',
    title: decision === 'approve' ? 'You are a Vergr creator' : 'Creator application update',
    body: decision === 'approve'
      ? (converted
        ? `Approved. The ${converted.coins} coins you received before applying now earn you ${microUsdToStr(converted.owedMicroUsd)}.`
        : 'Your application was approved. You can now earn a revenue share on Vergr.')
      : `Your application was not approved this time. You can apply again in ${REAPPLY_COOLDOWN_DAYS} days.`,
    read: false,
    actionUrl: decision === 'approve' ? '/creator/earnings' : '/creator/apply',
    createdAt: now,
  });

  return { status, converted };
});

module.exports.PATHS = PATHS;
module.exports.REAPPLY_COOLDOWN_DAYS = REAPPLY_COOLDOWN_DAYS;
module.exports.HARD_REJECT_REASONS = HARD_REJECT_REASONS;
