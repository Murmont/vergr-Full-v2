// Creator payouts — scheduled revenue-share settlement.
//
// See docs/REVENUE_SHARE_PLAN.md. This module is the piece that makes the
// principal model true in practice rather than only on paper.
//
// ## Why this replaces on-demand withdrawal
//
// The old model let a creator press Withdraw for any amount, at any time, to a
// crypto address they nominated. That is a customer calling on a balance we hold
// for them, which is the fact pattern that makes us look like a money
// transmitter. Nothing about the arithmetic changes here; what changes is WHO
// decides when money moves. Vergr computes what it owes its suppliers and pays
// them on Vergr's schedule, which is what accounts payable is.
//
// `functions/withdrawals.js` is deliberately NOT deleted or modified by this
// file. Cutting over is a separate, explicit step: two systems that can both
// move the same payable must never be live at once, so the switch is a single
// change to which cron is scheduled, made when the partner is wired.
//
// ## Where the money lives
//
// `wallets/{uid}.owedMicroUsd` IS the accrued payable, in micro-USD. It is not
// a parallel ledger,
// deliberately: a second per-creator balance would be a thing that can drift
// from the first, and reconciling two internal ledgers against each other is a
// class of bug with no upside. It is already credited at the creator's
// revenue-share rate by coinLedger.js, so the number is already correct.
//
// What did NOT exist is the PLATFORM-side aggregate, which is what answers "how
// much of the float is ours and how much is owed out". That is `platform_ledger/totals`.
//
// ## The partner seam
//
// `disbursePayout()` is the only partner-specific function. Everything else —
// eligibility, cadence, batching, statements, the ledger — runs and is testable
// without a partner. Until one is chosen it throws, and a run that cannot
// disburse marks itself `blocked` and moves nothing rather than debiting value
// it cannot actually send.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';

// ── Constants ─────────────────────────────────────────────────────────

/**
 * $100 in micro-USD. The payable is stored in micro-USD on
 * `wallets/{uid}.owedMicroUsd`, so there is no unit conversion left in this
 * file: it used to hold the amount in "gems" and translate every threshold
 * back into dollars, which meant the minimum was written as 10,000 of a unit
 * that only ever meant $100.
 */
const MICRO_USD = 1_000_000;

/**
 * $100 minimum, flat at every cadence stage. Founder decision 2026-08-14.
 * Below this the balance ROLLS OVER — it is never lost, never expired, and
 * never swept. A creator who earns $40 in January is paid $140 in February if
 * they earn $100 more, not $100 with $40 forfeited.
 */
const MIN_PAYOUT_MICRO_USD = 100 * MICRO_USD;

/**
 * Cadence stages. A stage only ever changes what DAYS a creator is paid on; the
 * minimum is the same at every stage, so moving up is purely a speed benefit
 * and can never reduce what someone receives.
 */
const CADENCE = {
  standard:    { key: 'standard',    label: 'Monthly',        days: 'month_start' },
  established: { key: 'established', label: 'Twice monthly',  days: 'twice_month' },
  priority:    { key: 'priority',    label: 'Weekly',         days: 'weekly_monday' },
};

/** Requirements to REACH a stage. Checked at run time, never cached. */
const CADENCE_REQUIREMENTS = {
  established: { minDaysSinceFirstPayout: 90,  minSuccessfulPayouts: 3,  minKyc: 2 },
  priority:    { minDaysSinceFirstPayout: 180, minSuccessfulPayouts: 12, minKyc: 2 },
};

/**
 * Minimum account age before ANY payout may leave, in days.
 *
 * Founder-instructed 2026-08-15. The reasoning is fraud timing, not bureaucracy:
 * abuse (DM scams, chargeback rings) surfaces days after signup, not on day one,
 * so a brand-new account clearing every other requirement and withdrawing
 * immediately is exactly the pattern this blocks. The account must also be old
 * enough for a report against it to have been filed and actioned.
 *
 * Applied in blockingReason(), so it gates the payout RUN and not just the UI.
 */
const MIN_ACCOUNT_AGE_DAYS = 30;

/** Account age in whole days from the user doc, or null if unreadable. */
function accountAgeDays(userData, now = Date.now()) {
  const c = userData?.createdAt;
  const ms = typeof c?.toMillis === 'function' ? c.toMillis()
    : typeof c === 'number' ? c
      : c ? new Date(c).getTime() : null;
  if (!ms || Number.isNaN(ms)) return null;
  return Math.floor((now - ms) / 86_400_000);
}

/** 3 active strikes suspends payouts. Strikes expire after 180 days. */
const STRIKE_SUSPEND_THRESHOLD = 3;

/** Safety rail: never move more than this many creators in one run. */
const MAX_PAYEES_PER_RUN = 500;

/**
 * KYC-tiered payment caps, in micro-USD (1 USD = 1,000,000 micro).
 *
 * These are a PUBLISHED AML control: the figures appear in the AML policy
 * (compliancePolicies.js, "Graduated verification") and in the ToS KYC table.
 * A control we publish and do not enforce is the one we get held to, so the
 * payout engine enforces them rather than inheriting them from the withdrawal
 * flow it replaces.
 *
 * Mirrors KYC_LIMITS in functions/withdrawals.js. Keep the two equal until that
 * file is retired at cutover.
 */
// ⚠ The unit is MICRO-USD, so these are DOLLARS. The comments used to read
// "€50/mo", "€2,500/mo", "€15,000/mo" on a constant literally named
// _MICRO_USD, and that mismatch propagated outward: the wallet KYC screen and
// SIX statements in the published AML policy and ToS all quoted euros for a
// control enforced in dollars (audit A28). Since €15,000 > $15,000, the
// published figure OVERSTATED the cap, which is exactly the shape this file's
// own comment warns about ("a control we publish and do not enforce is the one
// we get held to"). All of them now say US dollars.
const KYC_MONTHLY_CAP_MICRO_USD = {
  0: 0,               // no payment at all
  1: 50_000_000,      // $50/mo     — ID + selfie
  2: 2_500_000_000,   // $2,500/mo  — adds proof of address
  3: 15_000_000_000,  // $15,000/mo — adds source of funds
};

/**
 * Per-source breakdown of what a creator earned since their last payout.
 *
 * Written onto every statement because the statement is a tax record and a
 * remittance advice: "we paid you $144" with no composition is not something a
 * creator can check, reconcile, or hand to an accountant.
 *
 * Read from `transactions` rows the server stamped `earning: true`, which is the
 * same ledger the Earnings screen charts, so the statement and the charts can
 * never disagree about where money came from.
 */
const STATEMENT_SOURCES = [
  { key: 'Tips',           match: ['tip', 'gift'] },
  { key: 'Memberships',    match: ['member', 'sub'] },
  { key: 'Locked content', match: ['entitlement', 'unlock', 'pack'] },
  { key: 'Paid access',    match: ['paid_stream', 'ticket', 'season_pass'] },
  { key: 'Vergr.me',       match: ['vergrme', 'shop', 'product'] },
];

async function buildStatementBreakdown(uid, sinceMs) {
  try {
    let q = db.collection('transactions')
      .where('userId', '==', uid)
      .where('earning', '==', true)
      .orderBy('createdAt', 'desc')
      .limit(2000);
    if (sinceMs) q = q.where('createdAt', '>=', new Date(sinceMs));

    const snap = await q.get();
    const totals = {};
    for (const d of snap.docs) {
      const t = d.data();
      const micro = Number(t.amountMicroUsd || 0);
      if (micro <= 0) continue; // payouts are negative; only count earnings
      const type = String(t.type || '').toLowerCase();
      const hit = STATEMENT_SOURCES.find((s) => s.match.some((m) => type.includes(m)));
      const key = hit ? hit.key : 'Other';
      const entry = totals[key] || (totals[key] = { key, micro: 0, grossCoins: 0 });
      entry.micro += micro;
      // meta.coins / meta.grossCoins is the pre-share figure where the crediting
      // site recorded it. Absent on older rows, which is why it is not derived
      // by dividing by the rate: the rate may have changed since.
      entry.grossCoins += Number(t.meta?.grossCoins || t.meta?.coins || 0);
    }

    return Object.values(totals)
      .map((e) => ({
        key: e.key,
        shareMicroUsd: e.micro,
        grossMicroUsd: e.grossCoins > 0 ? e.grossCoins * 10_000 : null,
      }))
      .sort((a, b) => b.shareMicroUsd - a.shareMicroUsd);
  } catch (e) {
    // A breakdown that cannot be built must never block a payment. The creator
    // gets paid; the statement just carries a null breakdown and says so.
    console.error('buildStatementBreakdown failed', uid, e?.message || e);
    return null;
  }
}

/** When this creator was last paid, so a statement covers only new earnings. */
async function lastStatementMs(uid) {
  try {
    const snap = await db.collection('payout_statements')
      .where('uid', '==', uid).orderBy('createdAt', 'desc').limit(1).get();
    if (snap.empty) return null;
    const t = snap.docs[0].data().createdAt;
    return typeof t?.toMillis === 'function' ? t.toMillis() : null;
  } catch (e) { console.error('lastStatementMs', e?.message || e); return null; }
}

/** Micro-USD already paid to this creator in the trailing 30 days. */
async function paidLast30Days(uid, now = Date.now()) {
  const since = new Date(now - 30 * 86_400_000);
  const snap = await db.collection('payout_statements')
    .where('uid', '==', uid)
    .where('createdAt', '>=', since)
    .get();
  let total = 0;
  for (const d of snap.docs) {
    const s = d.data();
    // Count pending as spent: a payment in flight has left the cap's budget.
    if (s.status === 'paid' || s.status === 'pending') total += Number(s.amountMicroUsd || 0);
  }
  return total;
}

// ── Helpers ───────────────────────────────────────────────────────────

const owedMicroUsd = (wallet) => Math.max(0, Math.floor(wallet?.owedMicroUsd || 0));
const microUsdToStr = (m) => `$${(m / 1_000_000).toFixed(2)}`;

/**
 * Active strikes only. A strike stops counting when it EXPIRES or when it is
 * REVERSED on appeal.
 *
 * The reversed check is load-bearing: reverseStrike() marks rather than deletes,
 * so that the audit trail of what was decided and then undone survives. Without
 * this filter a successful appeal would restore nothing, and the creator would
 * keep the reduced payout speed the appeal was supposed to undo.
 */
function activeStrikeCount(account, now = Date.now()) {
  const strikes = Array.isArray(account?.strikes) ? account.strikes : [];
  return strikes.filter((s) => {
    if (s?.reversed) return false;
    const exp = typeof s?.expiresAt?.toMillis === 'function' ? s.expiresAt.toMillis() : s?.expiresAt;
    return !exp || exp > now;
  }).length;
}

/**
 * Which cadence stage this account has EARNED.
 *
 * Computed from facts every time rather than stored, so a stored stage can
 * never drift from the conditions that justified it, and so a strike takes
 * effect immediately instead of at the next write.
 */
function resolveCadence(account, kycLevel, now = Date.now()) {
  const strikes = activeStrikeCount(account, now);
  // Any active strike drops the account to Standard. The stage clock restarts
  // because minDaysSinceFirstPayout is measured from firstPayoutAt, which a
  // strike does not reset — see the plan: a strike costs speed, not history.
  if (strikes > 0) return CADENCE.standard;

  const successful = Number(account?.successfulPayouts || 0);
  const firstAt = typeof account?.firstPayoutAt?.toMillis === 'function'
    ? account.firstPayoutAt.toMillis()
    : account?.firstPayoutAt;
  const daysSince = firstAt ? Math.floor((now - firstAt) / 86_400_000) : 0;

  const meets = (r) => daysSince >= r.minDaysSinceFirstPayout
    && successful >= r.minSuccessfulPayouts
    && kycLevel >= r.minKyc;

  if (meets(CADENCE_REQUIREMENTS.priority)) return CADENCE.priority;
  if (meets(CADENCE_REQUIREMENTS.established)) return CADENCE.established;
  return CADENCE.standard;
}

/** Is a given cadence due on this UTC date? */
function cadenceDueToday(cadenceKey, date) {
  const dom = date.getUTCDate();
  const dow = date.getUTCDay(); // 0 Sun, 1 Mon
  if (cadenceKey === 'standard')    return dom === 1;
  if (cadenceKey === 'established') return dom === 1 || dom === 15;
  if (cadenceKey === 'priority')    return dow === 1;
  return false;
}

/**
 * Everything that must be true before a creator can be paid.
 * Returns null when payable, or a string reason when not.
 *
 * Order matters for the message the creator sees: report the thing they can
 * act on first, not the first thing that happens to fail.
 */
function blockingReason(account, wallet, kycLevel, now = Date.now(), ageDays = null) {
  if (activeStrikeCount(account, now) >= STRIKE_SUSPEND_THRESHOLD) {
    return 'suspended_strikes';
  }
  if (account?.frozen) return 'frozen';
  // Unreadable age is treated as too new: this fails CLOSED, because the cost of
  // holding a legitimate payout for a cycle is far lower than releasing one to a
  // fresh account that turns out to be fraudulent.
  if (ageDays == null || ageDays < MIN_ACCOUNT_AGE_DAYS) return 'account_too_new';
  if (kycLevel < 1) return 'kyc_required';
  if (account?.taxFormStatus !== 'on_file') return 'tax_form_required';
  if (!account?.partnerPayeeId) return 'payout_account_required';
  if (owedMicroUsd(wallet) < MIN_PAYOUT_MICRO_USD) return 'below_minimum';
  return null;
}

// ── Partner seam ──────────────────────────────────────────────────────

/**
 * Send one payment through the payout partner.
 *
 * THE ONLY PARTNER-SPECIFIC FUNCTION IN THIS FILE. Implement against whichever
 * partner is chosen (Tipalti / Trolley / Dots / Payoneer) and return a stable
 * reference id. Everything above this line is partner-agnostic.
 *
 * It MUST be idempotent on `idempotencyKey`: a run that times out after the
 * partner accepted the payment but before we recorded it will retry, and
 * paying twice is much worse than paying late.
 *
 * @returns {Promise<{reference: string, status: string}>}
 */
async function disbursePayout({ payeeId, amountMicroUsd, idempotencyKey }) {
  throw new Error(
    'PAYOUT_PARTNER_NOT_CONFIGURED: no payout partner is wired yet. '
    + `Would have sent ${microUsdToStr(amountMicroUsd)} to payee ${payeeId} (key ${idempotencyKey}).`
  );
}

/**
 * Is a payout partner actually wired?
 *
 * Checked BEFORE any balance is reserved. `disbursePayout` is the seam and it
 * throws until a partner exists, so without this gate every run debited the
 * creator's accrued share and then failed to send it, permanently, because the
 * failure handler deliberately leaves the debit in place (it cannot tell a
 * network timeout from a real send). A run that cannot pay must move nothing.
 *
 * Flip this to `true` in the same commit that implements `disbursePayout`.
 */
const PAYOUT_PARTNER_CONFIGURED = false;

// ── The run ───────────────────────────────────────────────────────────

/**
 * Build the list of creators due to be paid today, with amounts.
 *
 * Split out from execution on purpose: this half is pure and can be run as a
 * dry run against live data to see exactly what a payout would do before any
 * money moves. `previewCreatorPayoutRun` below exposes it to admins.
 */
async function buildRunPlan(now = new Date()) {
  const accountsSnap = await db.collection('payout_accounts')
    .where('enrolled', '==', true)
    .limit(MAX_PAYEES_PER_RUN * 4)
    .get();

  const plan = [];
  const skipped = [];

  for (const doc of accountsSnap.docs) {
    const account = doc.data();
    const uid = doc.id;

    const [walletSnap, userSnap] = await Promise.all([
      db.collection('wallets').doc(uid).get(),
      db.collection('users').doc(uid).get(),
    ]);
    if (!walletSnap.exists) { skipped.push({ uid, reason: 'no_wallet' }); continue; }

    const wallet = walletSnap.data();
    const kycLevel = Number(userSnap.exists ? (userSnap.data()?.kycLevel || 0) : 0);
    const cadence = resolveCadence(account, kycLevel, now.getTime());

    if (!cadenceDueToday(cadence.key, now)) {
      skipped.push({ uid, reason: 'not_due', cadence: cadence.key });
      continue;
    }

    const reason = blockingReason(
      account, wallet, kycLevel, now.getTime(),
      accountAgeDays(userSnap.exists ? userSnap.data() : null, now.getTime()),
    );
    if (reason) { skipped.push({ uid, reason, cadence: cadence.key }); continue; }

    // Enforce the published KYC monthly cap. Rather than skipping the creator
    // entirely, pay up to the remaining headroom and let the excess roll over:
    // a cap is a limit on how fast money may leave, not a reason to withhold
    // money that is legitimately payable within it.
    const owedTotal = owedMicroUsd(wallet);
    let amountMicroUsd = owedTotal;
    const capMicro = KYC_MONTHLY_CAP_MICRO_USD[Math.min(kycLevel, 3)] ?? 0;
    const alreadyPaidMicro = await paidLast30Days(uid, now.getTime());
    const headroomMicro = Math.max(0, capMicro - alreadyPaidMicro);

    if (amountMicroUsd > headroomMicro) amountMicroUsd = headroomMicro;
    // Capping can push the payment under the minimum, in which case nothing goes
    // out this run and the whole balance carries forward.
    if (amountMicroUsd < MIN_PAYOUT_MICRO_USD) {
      skipped.push({
        uid,
        reason: headroomMicro <= 0 ? 'kyc_monthly_cap_reached' : 'below_minimum_after_cap',
        cadence: cadence.key,
        kycLevel,
      });
      continue;
    }

    plan.push({
      uid,
      amountMicroUsd,
      cadence: cadence.key,
      payeeId: account.partnerPayeeId,
      cappedByKyc: amountMicroUsd < owedTotal,
    });

    if (plan.length >= MAX_PAYEES_PER_RUN) break;
  }

  return { plan, skipped };
}

/**
 * Pay one creator. Own transaction per creator so one bad payee cannot roll
 * back a whole run, and so a partial run is always a set of complete payments
 * rather than a half-written batch.
 *
 * Ordering is deliberate: debit FIRST, then call the partner. The reverse would
 * risk paying and failing to debit, which pays twice on retry. This way the
 * failure mode is a debit with no payment, which is visible and caught by the
 * `pending` statement status.
 *
 * That ordering is only safe once a partner EXISTS. With no partner wired,
 * `disbursePayout` throws every time, so debiting first meant zeroing a
 * creator's accrued share and sending nothing, on every run, with the error
 * handler deliberately leaving it debited to avoid double-paying a partner
 * that had never been called. `assertPartnerConfigured()` below is checked
 * before anything is reserved so that cannot happen.
 */
async function payOne(runId, entry) {
  const { uid, amountMicroUsd, payeeId, cadence } = entry;
  // Built BEFORE the reserve transaction: it reads the transactions ledger, and
  // a Firestore transaction may not run queries. Also means a slow breakdown
  // cannot hold a write lock on the wallet.
  const lastPaid = await lastStatementMs(uid);
  const sources = await buildStatementBreakdown(uid, lastPaid);
  const statementRef = db.collection('payout_statements').doc(`${runId}__${uid}`);
  const walletRef = db.collection('wallets').doc(uid);
  const accountRef = db.collection('payout_accounts').doc(uid);

  // 1. Reserve: debit the payable and write the statement as pending, atomically.
  const reserved = await db.runTransaction(async (tx) => {
    const existing = await tx.get(statementRef);
    if (existing.exists) return false; // already handled in an earlier attempt

    const walletSnap = await tx.get(walletRef);
    if (!walletSnap.exists) return false;
    const live = Math.max(0, Math.floor(walletSnap.data().owedMicroUsd || 0));
    // Re-check against the LIVE payable: the plan was built earlier and the
    // creator may have accrued or been paid since. Never pay more than is
    // actually owed.
    if (live < MIN_PAYOUT_MICRO_USD || live < amountMicroUsd) return false;

    tx.update(walletRef, {
      owedMicroUsd: FieldValue.increment(-amountMicroUsd),
      totalPaidMicroUsd: FieldValue.increment(amountMicroUsd),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(statementRef, {
      runId, uid, amountMicroUsd, cadence, payeeId,
      sources: sources || null,
      periodFromMs: lastPaid || null,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(db.collection('transactions').doc(), {
      userId: uid,
      type: 'revenue_share_payout',
      currency: 'usd',
      amountMicroUsd: -amountMicroUsd,
      amount: -amountMicroUsd,
      description: `Revenue share payout ${microUsdToStr(amountMicroUsd)}`,
      meta: { runId, cadence, amountMicroUsd },
      createdAt: FieldValue.serverTimestamp(),
    });

    return true;
  });

  if (!reserved) return { uid, status: 'skipped' };

  // 2. Send.
  try {
    const result = await disbursePayout({
      payeeId, amountMicroUsd, idempotencyKey: `${runId}__${uid}`,
    });

    await statementRef.update({
      status: 'paid',
      partnerReference: result.reference,
      partnerStatus: result.status || null,
      paidAt: FieldValue.serverTimestamp(),
    });

    // `firstPayoutAt` is the clock the cadence ladder is measured against, so it
    // must be written ONCE and never move. A plain set/merge with a server
    // timestamp would rewrite it on every run, pinning daysSinceFirstPayout at
    // 0 and quietly making Established and Priority unreachable forever.
    // Transaction so the read and the conditional write cannot interleave.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(accountRef);
      const fields = {
        successfulPayouts: FieldValue.increment(1),
        lastPayoutAt: FieldValue.serverTimestamp(),
      };
      if (!snap.exists || !snap.data()?.firstPayoutAt) {
        fields.firstPayoutAt = FieldValue.serverTimestamp();
      }
      tx.set(accountRef, fields, { merge: true });
    });

    await db.collection('notifications').add({
      recipientId: uid,
      type: 'revenue_share_paid',
      title: 'You have been paid',
      body: `${microUsdToStr(amountMicroUsd)} is on its way to your payout account.`,
      read: false,
      data: { runId, amountMicroUsd },
      createdAt: FieldValue.serverTimestamp(),
    });

    return { uid, status: 'paid', amountMicroUsd };
  } catch (e) {
    // Leave the statement `pending` and the payable debited. A pending statement
    // is the signal for a human to reconcile, and refunding automatically here
    // could double-credit if the partner actually did accept the payment.
    await statementRef.update({
      status: 'failed',
      error: String(e?.message || e).slice(0, 500),
      failedAt: FieldValue.serverTimestamp(),
    }).catch(() => {});
    console.error('payOne failed', runId, uid, e?.message || e);
    return { uid, status: 'failed', error: String(e?.message || e) };
  }
}

/**
 * The scheduled run. Daily, because which cadences are due depends on the date
 * and a single daily job is simpler to reason about than three separate crons
 * that can overlap on the 1st.
 */
async function executeRun(now = new Date()) {
  const dayKey = now.toISOString().slice(0, 10);
  const runId = `run_${dayKey}`;
  const runRef = db.collection('payout_runs').doc(runId);

  const already = await runRef.get();
  if (already.exists && already.data()?.status === 'complete') {
    return { runId, status: 'already_complete' };
  }

  // Admin kill switch. `payoutsPaused` is offered as a toggle on BOTH
  // /admin/config and /admin/economy and, until 2026-08-19, was read by nothing
  // at all: an operator could flip "Pause creator payouts", believe money had
  // stopped, and the next run would pay everyone anyway. A safety control that
  // does nothing is worse than no control, because it is trusted.
  //
  // Checked BEFORE buildRunPlan so a pause costs nothing to honour, and it
  // records itself as a blocked run so the reason is visible on the Economy
  // screen rather than looking like a run that silently never happened.
  const cfgSnap = await db.collection('app_config').doc('general').get();
  if (cfgSnap.exists && cfgSnap.data()?.payoutsPaused === true) {
    await runRef.set({
      runId, dayKey,
      status: 'blocked',
      blockedReason: 'payouts_paused_by_admin',
      startedAt: FieldValue.serverTimestamp(),
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    console.warn('runCreatorPayouts BLOCKED: payoutsPaused is set in app_config/general.');
    return { runId, status: 'blocked', reason: 'payouts_paused' };
  }

  const { plan, skipped } = await buildRunPlan(now);

  // A run that cannot disburse moves NOTHING. Reserving first and discovering
  // the partner is missing is how a creator's accrued share gets zeroed with no
  // payment made, so this is checked before a single wallet is touched.
  if (plan.length && !PAYOUT_PARTNER_CONFIGURED) {
    await runRef.set({
      runId, dayKey,
      status: 'blocked',
      blockedReason: 'payout_partner_not_configured',
      plannedCount: plan.length,
      plannedMicroUsd: plan.reduce((s, p) => s + p.amountMicroUsd, 0),
      skippedCount: skipped.length,
      startedAt: FieldValue.serverTimestamp(),
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    console.warn('runCreatorPayouts BLOCKED: no payout partner wired.',
      `${plan.length} creator(s) were due. Nothing was debited.`);
    return { runId, status: 'blocked', wouldPay: plan.length };
  }

  await runRef.set({
    runId, dayKey,
    status: plan.length ? 'running' : 'empty',
    plannedCount: plan.length,
    plannedMicroUsd: plan.reduce((s, p) => s + p.amountMicroUsd, 0),
    skippedCount: skipped.length,
    startedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  if (!plan.length) {
    await runRef.set({ status: 'empty', completedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { runId, status: 'empty', skipped: skipped.length };
  }

  const results = [];
  for (const entry of plan) {
    results.push(await payOne(runId, entry));
  }

  const paid = results.filter((r) => r.status === 'paid');
  const failed = results.filter((r) => r.status === 'failed');

  await runRef.set({
    status: failed.length ? 'complete_with_errors' : 'complete',
    paidCount: paid.length,
    paidMicroUsd: paid.reduce((s, r) => s + (r.amountMicroUsd || 0), 0),
    failedCount: failed.length,
    completedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { runId, paid: paid.length, failed: failed.length, skipped: skipped.length };
}

// ── Exports ───────────────────────────────────────────────────────────

exports.runCreatorPayouts = functions.scheduler.onSchedule(
  { schedule: 'every day 06:00', timeZone: 'UTC', region: REGION },
  async () => {
    const out = await executeRun(new Date());
    console.log('runCreatorPayouts', JSON.stringify(out));
  },
);

/**
 * Admin dry run. Shows exactly who would be paid and who would be skipped, with
 * reasons, and moves nothing. This is the thing to look at before the first
 * real run rather than finding out from the ledger afterwards.
 */
exports.previewCreatorPayoutRun = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const { requireAdmin } = require('./adminSecurity');
    await requireAdmin(request.auth?.uid);  // takes a uid, not the request
    const when = request.data?.date ? new Date(request.data.date) : new Date();
    const { plan, skipped } = await buildRunPlan(when);
    return {
      date: when.toISOString().slice(0, 10),
      wouldPay: plan.length,
      wouldPayMicroUsd: plan.reduce((s, p) => s + p.amountMicroUsd, 0),
      plan: plan.map(({ uid, amountMicroUsd, cadence }) => ({ uid, amountMicroUsd, cadence })),
      skipped,
    };
  },
);

// ── Enrolment and payout setup ────────────────────────────────────────
//
// Nothing else creates a `payout_accounts/{uid}` doc, and buildRunPlan only
// looks at `enrolled == true`, so without this a creator can accrue forever and
// never be paid. Enrolment is explicit rather than automatic on first earning:
// being paid requires the creator to give us identity, tax and bank details, and
// silently creating a payout record for someone who has not asked to be paid is
// both pointless and a data-minimisation problem.

/** Payout setup state for the Earnings screen. Creates nothing. */
exports.getPayoutAccount = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');

    const [accSnap, walletSnap, userSnap] = await Promise.all([
      db.collection('payout_accounts').doc(uid).get(),
      db.collection('wallets').doc(uid).get(),
      db.collection('users').doc(uid).get(),
    ]);

    const account = accSnap.exists ? accSnap.data() : null;
    const wallet = walletSnap.exists ? walletSnap.data() : {};
    const kycLevel = Number(userSnap.exists ? (userSnap.data()?.kycLevel || 0) : 0);
    const now = Date.now();
    const cadence = resolveCadence(account || {}, kycLevel, now);

    return {
      enrolled: !!account?.enrolled,
      kycLevel,
      taxFormStatus: account?.taxFormStatus || 'required',
      taxFormType: account?.taxFormType || null,
      payoutAccountConnected: !!account?.partnerPayeeId,
      cadence: cadence.key,
      cadenceLabel: cadence.label,
      successfulPayouts: Number(account?.successfulPayouts || 0),
      // Strike COUNT only. The reasons are moderation data and are deliberately
      // not returned to the creator here; they see the effect and the appeal
      // route, not the internal notes.
      activeStrikes: activeStrikeCount(account || {}, now),
      // Progress toward the NEXT cadence, so the client can render the real
      // requirements instead of restating copy. The gate is days since FIRST
      // PAYOUT (not account age) plus successful payouts plus KYC level, which
      // is exactly what resolveCadence() above enforces.
      daysSinceFirstPayout: (() => {
        const f = typeof account?.firstPayoutAt?.toMillis === 'function'
          ? account.firstPayoutAt.toMillis() : account?.firstPayoutAt;
        return f ? Math.floor((now - f) / 86_400_000) : null;
      })(),
      nextCadence: (() => {
        const order = ['standard', 'established', 'priority'];
        const nextKey = order[order.indexOf(cadence.key) + 1] || null;
        if (!nextKey) return null;
        const r = CADENCE_REQUIREMENTS[nextKey];
        return { key: nextKey, label: CADENCE[nextKey].label, ...r };
      })(),
      suspended: activeStrikeCount(account || {}, now) >= STRIKE_SUSPEND_THRESHOLD,
      availableMicroUsd: owedMicroUsd(wallet),
      minimumMicroUsd: MIN_PAYOUT_MICRO_USD,
      accountAgeDays: accountAgeDays(userSnap.exists ? userSnap.data() : null, now),
      minAccountAgeDays: MIN_ACCOUNT_AGE_DAYS,
      blockedBy: blockingReason(
        account || {}, wallet, kycLevel, now,
        accountAgeDays(userSnap.exists ? userSnap.data() : null, now),
      ),
    };
  },
);

/** Begin payout setup. Idempotent: re-enrolling never resets earned progress. */
exports.enrollForPayouts = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');

    const ref = db.collection('payout_accounts').doc(uid);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.data()?.enrolled) return; // already enrolled, leave alone
      // merge, never overwrite: a re-enrol must not clear strikes, payout
      // counts, or firstPayoutAt, all of which gate cadence.
      tx.set(ref, {
        enrolled: true,
        enrolledAt: snap.exists && snap.data()?.enrolledAt
          ? snap.data().enrolledAt
          : FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    return { enrolled: true };
  },
);

/**
 * Record tax-form and payee state from the payments partner.
 *
 * PARTNER-FED, not user-fed. The creator completes the tax interview inside the
 * partner's own flow (Tipalti and Trolley both collect and validate W-9 /
 * W-8BEN and handle year-end reporting, which is most of the reason to pick one
 * that does). We only ever record the partner's verdict.
 *
 * VERGR must never accept a client-asserted "my tax form is fine": that would
 * let anyone unlock payouts by calling a function, and tax status is exactly the
 * kind of claim that has to come from the party that validated it.
 *
 * Wire this to the partner's webhook when the partner is chosen.
 */
async function applyPartnerAccountState(uid, { taxFormStatus, taxFormType, partnerPayeeId, legalName, country }) {
  const fields = { updatedAt: FieldValue.serverTimestamp() };
  if (taxFormStatus) fields.taxFormStatus = taxFormStatus; // 'required' | 'submitted' | 'on_file'
  if (taxFormType) fields.taxFormType = taxFormType;       // 'W-9' | 'W-8BEN' | 'W-8BEN-E'
  if (partnerPayeeId) fields.partnerPayeeId = partnerPayeeId;
  if (legalName) fields.legalName = legalName;
  if (country) fields.country = country;
  await db.collection('payout_accounts').doc(uid).set(fields, { merge: true });
  return fields;
}

/** Admin override, for correcting a partner sync or unblocking a stuck account. */
exports.adminSetPayoutAccountState = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const { requireAdmin, auditAdminAction } = require('./adminSecurity');
    const actor = request.auth?.uid;
    await requireAdmin(actor);
    const { uid, ...state } = request.data || {};
    if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid is required.');
    const applied = await applyPartnerAccountState(uid, state);
    await auditAdminAction({
      actor, action: 'payout_account_state_set', target: uid,
      meta: { ...applied, updatedAt: null },
    });
    return { ok: true };
  },
);

// ── Strikes ───────────────────────────────────────────────────────────

/** 180 days. Longer than YouTube's 90 because the risk here is financial. */
const STRIKE_TTL_MS = 180 * 86_400_000;

/**
 * Reasons a Strike may be recorded. Anything not on this list is not a Strike.
 *
 * The list is closed on purpose. "Record a strike for whatever seems bad" is how
 * a payment-affecting penalty becomes arbitrary, and arbitrary penalties are
 * exactly what the Creator Revenue Share Agreement promises this is not.
 * ToS Section 8.8 enumerates these; keep the two in step.
 */
const STRIKE_REASONS = new Set([
  'moderation_upheld',    // upheld after the appeal window closed
  'chargeback_rate',      // ABOVE the rate threshold, never a single chargeback
  'fraud_review_upheld',
  'payout_details_false', // payment failed on false or mismatched details
  'circumvention',        // RMT, off-platform solicitation, multi-accounting
]);

/**
 * Record a Strike against a creator.
 *
 * Idempotent on `sourceId`, because the events that cause strikes (a moderation
 * decision, a payout failure) can be retried or re-delivered, and striking twice
 * for one offence would skip a whole cadence stage.
 *
 * Never called automatically from a raw signal. A strike follows a DECISION:
 * an upheld moderation action, an upheld fraud review, a threshold breach that
 * has been evaluated. Wiring this to a bare report or a single chargeback would
 * let any user cost a creator their payout speed.
 *
 * @param {string} uid       the creator
 * @param {string} reason    one of STRIKE_REASONS
 * @param {string} sourceId  stable id of the deciding event, for idempotency
 * @param {string} [notes]   free text shown to admins, never to the creator
 */
async function recordStrike(db_, { uid, reason, sourceId, notes = null }) {
  if (!uid || !sourceId) throw new Error('recordStrike: uid and sourceId are required');
  if (!STRIKE_REASONS.has(reason)) throw new Error(`recordStrike: unknown reason "${reason}"`);

  const accountRef = db_.collection('payout_accounts').doc(uid);
  const now = Date.now();

  const applied = await db_.runTransaction(async (tx) => {
    const snap = await tx.get(accountRef);
    const data = snap.exists ? snap.data() : {};
    const strikes = Array.isArray(data.strikes) ? data.strikes : [];

    if (strikes.some((s) => s.sourceId === sourceId)) return null; // already recorded

    const strike = { reason, sourceId, notes, at: now, expiresAt: now + STRIKE_TTL_MS, reversed: false };
    // Drop strikes that expired more than a year ago so the array cannot grow
    // without bound, while keeping recent expired ones for admin context.
    const kept = strikes.filter((s) => (s.expiresAt || 0) > now - 365 * 86_400_000);

    tx.set(accountRef, { strikes: [...kept, strike] }, { merge: true });
    return { strike, activeAfter: [...kept, strike].filter((s) => !s.reversed && (s.expiresAt || 0) > now).length };
  });

  if (!applied) return { recorded: false };

  // Tell the creator. A penalty they cannot see is one they cannot appeal, and
  // the agreement gives them an appeal.
  const suspended = applied.activeAfter >= STRIKE_SUSPEND_THRESHOLD;
  await db_.collection('notifications').add({
    recipientId: uid,
    type: 'payout_strike',
    title: suspended ? 'Payouts paused' : 'Payout speed reduced',
    body: suspended
      ? 'Your account is under review, so payments are paused. You are still earning and nothing has been lost.'
      : 'Your payout schedule has been reduced. It returns automatically when the strike expires.',
    read: false,
    data: { reason, activeStrikes: applied.activeAfter },
    createdAt: FieldValue.serverTimestamp(),
  });

  return { recorded: true, activeStrikes: applied.activeAfter };
}

/**
 * Reverse a Strike, on a successful appeal or an admin correction.
 *
 * Marks rather than deletes, so the audit trail of what was decided and then
 * undone survives. `activeStrikeCount` already ignores reversed entries.
 */
async function reverseStrike(db_, { uid, sourceId, reversedBy, reason = null }) {
  const accountRef = db_.collection('payout_accounts').doc(uid);

  const ok = await db_.runTransaction(async (tx) => {
    const snap = await tx.get(accountRef);
    if (!snap.exists) return false;
    const strikes = Array.isArray(snap.data().strikes) ? snap.data().strikes : [];
    let found = false;
    const next = strikes.map((s) => {
      if (s.sourceId !== sourceId || s.reversed) return s;
      found = true;
      return { ...s, reversed: true, reversedAt: Date.now(), reversedBy: reversedBy || null, reversalReason: reason };
    });
    if (!found) return false;
    tx.set(accountRef, { strikes: next }, { merge: true });
    return true;
  });

  if (ok) {
    await db_.collection('notifications').add({
      recipientId: uid,
      type: 'payout_strike_reversed',
      title: 'Strike removed',
      body: 'A strike on your account has been removed and your payout schedule is restored.',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return { reversed: ok };
}

/** Admin: record a strike. Audited through the standard admin wrapper. */
exports.adminRecordPayoutStrike = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const { requireAdmin, auditAdminAction } = require('./adminSecurity');
    const actor = request.auth?.uid;
    await requireAdmin(actor);
    const { uid, reason, sourceId, notes } = request.data || {};
    const out = await recordStrike(db, { uid, reason, sourceId: sourceId || `admin_${actor}_${Date.now()}`, notes });
    await auditAdminAction({ actor, action: 'payout_strike_recorded', target: uid, reason, meta: { notes } });
    return out;
  },
);

/** Admin: reverse a strike, e.g. on a successful appeal. */
exports.adminReversePayoutStrike = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const { requireAdmin, auditAdminAction } = require('./adminSecurity');
    const actor = request.auth?.uid;
    await requireAdmin(actor);
    const { uid, sourceId, reason } = request.data || {};
    const out = await reverseStrike(db, { uid, sourceId, reversedBy: actor, reason });
    await auditAdminAction({ actor, action: 'payout_strike_reversed', target: uid, reason, meta: { sourceId } });
    return out;
  },
);

exports.recordStrike = (args) => recordStrike(db, args);
exports.reverseStrike = (args) => reverseStrike(db, args);

exports.applyPartnerAccountState = applyPartnerAccountState;

exports._internal = {
  KYC_MONTHLY_CAP_MICRO_USD,
  paidLast30Days,
  applyPartnerAccountState,
  recordStrike,
  reverseStrike,
  STRIKE_REASONS,
  MIN_ACCOUNT_AGE_DAYS,
  accountAgeDays,
  STRIKE_TTL_MS,
  resolveCadence,
  cadenceDueToday,
  blockingReason,
  activeStrikeCount,
  buildRunPlan,
  executeRun,
  owedMicroUsd,
  CADENCE,
  CADENCE_REQUIREMENTS,
  MIN_PAYOUT_MICRO_USD,
  STRIKE_SUSPEND_THRESHOLD,
  // Exposed so the admin Economy screen reads the LIVE flag instead of
  // restating it. A hardcoded copy in the UI is how a screen ends up claiming a
  // payout partner is wired when the code still refuses to send anything.
  PAYOUT_PARTNER_CONFIGURED,
};
