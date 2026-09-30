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
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
// The ONE sanctioned-country list (geo.js), so payouts, sign-up and the
// published AML policy can never name different countries.
const { BLOCKED_COUNTRIES } = require('./geo');
// Mercury: pure rules (mercuryPayouts) and the box 1 relay that makes the calls,
// because Mercury only accepts our tokens from box 1's whitelisted IP.
const mercury = require('./mercuryPayouts');
const { relayCall } = require('./mercuryRelayClient');
const { authEmailFor } = require('./authEmails');

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

/**
 * The countries on record for a user: the profile selection, then the Didit ID
 * country.
 *
 * ⚠ `users/{uid}.kyc.country` is read for accounts verified BEFORE the Didit
 * result was split (audit A30), which moved `country` to the owner-only
 * `users/{uid}/private/kyc`. After the split that field is never written, so
 * the ID-country half of the sanctions check was silently dead. Payout setup
 * (connectPayoutAccount) now copies the verified country onto
 * `payout_accounts/{uid}.verifiedCountry`, which the run already reads, so the
 * check works again at zero extra reads.
 */
function countriesOf(userData, account = null) {
  // account.country is the bank recipient's address country from Mercury
  // (refreshPayoutOnboarding), a third signal that also costs no read.
  return [userData?.country, userData?.kyc?.country, account?.verifiedCountry, account?.country];
}

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

/**
 * Micro-USD already paid (or in flight) to this creator in the current calendar
 * month, UTC.
 *
 * The AML policy (section 2) caps what VERGR pays "in a calendar month" and says
 * caps are enforced "against the calendar month". This used to be a trailing 30
 * days, which broke the Standard monthly schedule: the run fires on the 1st at
 * 06:00, so in any month of 30 days or fewer last month's statement was still
 * inside the window by a few seconds, and a capped creator was skipped every
 * other month.
 *
 * Ordered by createdAt DESC so the one (uid ASC, createdAt DESC) index serves
 * this, lastStatementMs and the creator's own statement list.
 */
async function paidThisCalendarMonth(uid, now = Date.now()) {
  const d = new Date(now);
  const since = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const until = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const snap = await db.collection('payout_statements')
    .where('uid', '==', uid)
    .where('createdAt', '>=', since)
    .where('createdAt', '<', until)
    .orderBy('createdAt', 'desc')
    .get();
  let total = 0;
  for (const doc of snap.docs) {
    const st = doc.data();
    // queued = sitting in the Mercury dashboard for approval: already debited.
    if (st.status === 'paid' || st.status === 'pending' || st.status === 'queued') total += Number(st.amountMicroUsd || 0);
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
function blockingReason(account, wallet, kycLevel, now = Date.now(), ageDays = null, countries = []) {
  if (activeStrikeCount(account, now) >= STRIKE_SUSPEND_THRESHOLD) {
    return 'suspended_strikes';
  }
  if (account?.frozen) return 'frozen';
  // Sanctioned-country block (AML policy section 3). Checks the country the
  // creator selected on their profile AND the country on their Didit-verified
  // ID. Both sit on the users doc the caller ALREADY read for kycLevel and
  // account age, so this costs no extra read. Didit itself already refuses a
  // document issued by a blocked country (didit.js).
  if (countries.some((c) => c && BLOCKED_COUNTRIES.has(String(c).trim().toUpperCase()))) {
    return 'sanctioned_country';
  }
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
 * Ask Mercury to send one payment, through the box 1 relay.
 *
 * A success means QUEUED, not sent: the request lands in the Mercury dashboard
 * as `pendingApproval` and the founder approves it. Only reconcileQueuedPayouts()
 * turns it into `paid`.
 *
 * Returns, never throws for a known outcome:
 *   { outcome: 'queued', requestId, mercuryStatus, needsLookup }
 *   { outcome: 'not_sent', reason }   Mercury certainly never created it:
 *                                     safe to put the money back.
 *   { outcome: 'unknown', reason, detail }
 *                                     we cannot tell a timeout or a Mercury
 *                                     error from an accepted payment, so a human
 *                                     reconciles and nothing is re-credited.
 *
 * Idempotent on `idempotencyKey` (the statement id). ⚠ Mercury documents
 * idempotency and 409-as-replay on createTransaction, not on this endpoint;
 * verify with a deliberate repeat before trusting it.
 */
async function disbursePayout({ payeeId, amountMicroUsd, idempotencyKey, paymentMethod, legalName }) {
  const { cents, carryMicroUsd } = mercury.splitPayable(amountMicroUsd);
  if (carryMicroUsd !== 0) return { outcome: 'not_sent', reason: 'amount_not_whole_cents' };

  let res;
  try {
    res = await relayCall('send', { recipientId: payeeId, cents, paymentMethod, idempotencyKey, legalName });
  } catch (e) {
    const msg = String(e?.message || e);
    // No identity token means the request never left this function.
    if (msg.startsWith('relay_identity_')) return { outcome: 'not_sent', reason: msg };
    return { outcome: 'unknown', reason: 'relay_unreachable', detail: msg.slice(0, 300) };
  }

  if (!res.ok) {
    // The relay refused BEFORE calling Mercury: bad body, auth, missing config.
    // A 502 means the relay tried Mercury and could not tell what happened.
    if ([400, 401, 403, 404, 413, 503].includes(res.httpStatus)) {
      return { outcome: 'not_sent', reason: res.error || `relay_${res.httpStatus}` };
    }
    return { outcome: 'unknown', reason: res.error || `relay_${res.httpStatus}` };
  }

  const c = res.classification || mercury.classifySendResponse(res.mercuryStatus, res.body);
  if (c.outcome === 'accepted') {
    return {
      outcome: 'queued', requestId: c.requestId, mercuryStatus: c.mercuryStatus, needsLookup: !!c.needsLookup,
      // Which account it left from, so a return can be traced even after the
      // payout account is switched (MERCURY_PAYOUT_ACCOUNT_ID on box 1).
      accountId: res.body?.accountId || null,
    };
  }
  if (c.outcome === 'retry_later') return { outcome: 'not_sent', reason: c.reason };
  return { outcome: 'unknown', reason: c.reason, detail: c.detail };
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
      countriesOf(userSnap.exists ? userSnap.data() : null, account),
    );
    if (reason) { skipped.push({ uid, reason, cadence: cadence.key }); continue; }

    // Enforce the published KYC monthly cap. Rather than skipping the creator
    // entirely, pay up to the remaining headroom and let the excess roll over:
    // a cap is a limit on how fast money may leave, not a reason to withhold
    // money that is legitimately payable within it.
    const owedTotal = owedMicroUsd(wallet);
    let amountMicroUsd = owedTotal;
    const capMicro = KYC_MONTHLY_CAP_MICRO_USD[Math.min(kycLevel, 3)] ?? 0;
    const alreadyPaidMicro = await paidThisCalendarMonth(uid, now.getTime());
    const headroomMicro = Math.max(0, capMicro - alreadyPaidMicro);

    if (amountMicroUsd > headroomMicro) amountMicroUsd = headroomMicro;
    // The $100 minimum applies to the ACCRUED BALANCE, not to the capped payment.
    // ToS 8.4: "If your accrued balance is below the minimum on a scheduled date,
    // no payment is made". That balance test is blockingReason() -> below_minimum.
    // The AML policy (section 2) caps what is paid per month by verification level
    // and says "Earnings above the cap remain owed and carry into a later run".
    // So a Level 1 creator owed $150 is paid $50 now and $100 carries forward.
    //
    // ⚠ This used to skip any CAPPED payment under $100. The Level 1 cap is $50,
    // so that made every Level 1 creator unpayable forever, which contradicts
    // ToS 8.2 ("at least Level 1") and the help centre. No published rule says it.
    if (amountMicroUsd <= 0) {
      skipped.push({ uid, reason: 'kyc_monthly_cap_reached', cadence: cadence.key, kycLevel });
      continue;
    }

    // Mercury is paid in whole cents. Round DOWN here, so the amount reserved
    // is exactly the amount sent and the sub-cent remainder stays owed and
    // rolls into the next payout.
    amountMicroUsd = mercury.splitPayable(amountMicroUsd).sendMicroUsd;
    if (amountMicroUsd <= 0) {
      skipped.push({ uid, reason: 'kyc_monthly_cap_reached', cadence: cadence.key, kycLevel });
      continue;
    }

    const paymentMethod = account.mercuryPaymentMethod;
    if (paymentMethod !== 'ach' && paymentMethod !== 'internationalWire') {
      skipped.push({ uid, reason: 'payment_method_missing', cadence: cadence.key });
      continue;
    }

    plan.push({
      uid,
      amountMicroUsd,
      cadence: cadence.key,
      payeeId: account.partnerPayeeId,
      paymentMethod,
      // The supplier's verified name, carried on a wire's purpose. Mercury's
      // bank-account name is the fallback; the two already matched to get here.
      legalName: account.verifiedLegalName || account.legalName || null,
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

  // 2. Ask Mercury. Nothing here counts as a payout or tells the creator they
  // are paid: that happens only when the founder approves (markStatementPaid).
  let result;
  try {
    result = await disbursePayout({
      payeeId, amountMicroUsd, idempotencyKey: statementRef.id,
      paymentMethod: entry.paymentMethod, legalName: entry.legalName,
    });
  } catch (e) {
    result = { outcome: 'unknown', reason: 'exception', detail: String(e?.message || e).slice(0, 300) };
  }

  if (result.outcome === 'queued') {
    await statementRef.update({
      status: 'queued',
      mercuryRequestId: result.requestId || null,
      mercuryStatus: result.mercuryStatus || null,
      needsLookup: !!result.needsLookup,
      mercuryAccountId: result.accountId || null,
      queuedAt: FieldValue.serverTimestamp(),
    });
    await recordMercuryUse('send');
    // An org whose approval rules auto-approve comes back approved at once.
    if (result.mercuryStatus === 'approved' && await markStatementPaid(statementRef.id)) {
      return { uid, status: 'paid', amountMicroUsd };
    }
    return { uid, status: 'queued', amountMicroUsd };
  }

  if (result.outcome === 'not_sent') {
    // Mercury never created it, so the reservation is undone now. Quietly: this
    // is our retry, not something the creator needs to act on.
    await reverseStatement(statementRef.id, result.reason, { notify: false });
    console.warn('[payouts] not sent, re-credited', runId, uid, result.reason);
    return { uid, status: 'not_sent', reason: result.reason };
  }

  // Unknown. Leave the payable debited: refunding here could double-credit if
  // Mercury did in fact accept it. A failed statement is the signal for a human.
  await statementRef.update({
    status: 'failed',
    error: String([result.reason, result.detail].filter(Boolean).join(': ')).slice(0, 500),
    failedAt: FieldValue.serverTimestamp(),
  }).catch(() => {});
  console.error('payOne failed', runId, uid, result.reason);
  return { uid, status: 'failed', error: result.reason };
}

// ── Statement transitions ─────────────────────────────────────────────

/**
 * queued -> paid, once Mercury reports the request approved.
 *
 * THIS is where a payout counts. successfulPayouts and firstPayoutAt drive the
 * cadence ladder (resolveCadence), so advancing them on a payment that was never
 * approved would promote a creator to faster payouts on money that never moved.
 * `firstPayoutAt` is written once and never moves. Returns true only for the
 * call that made the transition, so the notification goes out exactly once.
 */
async function markStatementPaid(statementId) {
  const statementRef = db.collection('payout_statements').doc(statementId);
  const flipped = await db.runTransaction(async (tx) => {
    const st = await tx.get(statementRef);
    if (!st.exists || st.data().status !== 'queued') return null;
    const { uid } = st.data();
    const accountRef = db.collection('payout_accounts').doc(uid);
    const acc = await tx.get(accountRef);
    tx.update(statementRef, {
      status: 'paid', mercuryStatus: 'approved', paidAt: FieldValue.serverTimestamp(),
      // Watched for a returned wire until this time (checkReturnedPayouts).
      returnWatch: true,
      returnWatchUntilMs: Date.now() + RETURN_WATCH_DAYS * 86_400_000,
    });
    const fields = {
      successfulPayouts: FieldValue.increment(1),
      lastPayoutAt: FieldValue.serverTimestamp(),
    };
    if (!acc.exists || !acc.data()?.firstPayoutAt) fields.firstPayoutAt = FieldValue.serverTimestamp();
    tx.set(accountRef, fields, { merge: true });
    return st.data();
  });
  if (!flipped) return false;
  await db.collection('notifications').add({
    recipientId: flipped.uid,
    type: 'revenue_share_paid',
    title: 'You have been paid',
    body: `${microUsdToStr(flipped.amountMicroUsd)} is on its way to your payout account.`,
    read: false,
    data: { runId: flipped.runId, amountMicroUsd: flipped.amountMicroUsd },
    createdAt: FieldValue.serverTimestamp(),
  });
  return true;
}

/**
 * pending|queued -> reversed: put the money back into owedMicroUsd.
 *
 * Only from states where the money has NOT left. A paid statement is never
 * reversed here; a returned wire is build step 6 and has its own evidence.
 * Idempotent: a second call finds `reversed` and does nothing.
 */
async function reverseStatement(statementId, reason, { notify = true } = {}) {
  const statementRef = db.collection('payout_statements').doc(statementId);
  const done = await db.runTransaction(async (tx) => {
    const st = await tx.get(statementRef);
    if (!st.exists) return null;
    const d = st.data();
    if (d.status !== 'pending' && d.status !== 'queued') return null;
    const amount = Math.floor(Number(d.amountMicroUsd || 0));
    tx.update(db.collection('wallets').doc(d.uid), {
      owedMicroUsd: FieldValue.increment(amount),
      totalPaidMicroUsd: FieldValue.increment(-amount),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(statementRef, {
      status: 'reversed', reverseReason: String(reason || 'unknown').slice(0, 120),
      reversedAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection('transactions').doc(), {
      userId: d.uid,
      type: 'revenue_share_payout_reversed',
      currency: 'usd',
      amountMicroUsd: amount,
      amount,
      description: `Payout not sent, ${microUsdToStr(amount)} returned to your balance`,
      meta: { runId: d.runId, statementId, reason: String(reason || '').slice(0, 120) },
      createdAt: FieldValue.serverTimestamp(),
    });
    return d;
  });
  if (!done) return false;
  if (notify) {
    await db.collection('notifications').add({
      recipientId: done.uid,
      type: 'revenue_share_payout_reversed',
      title: 'Your payout was not sent',
      body: `${microUsdToStr(done.amountMicroUsd)} is back in your balance and will be included in your next payout.`,
      read: false,
      data: { runId: done.runId, amountMicroUsd: done.amountMicroUsd },
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return true;
}

// ── Returned payments (build step 6) ─────────────────────────────────

/** How long after approval a paid statement is watched for a returned wire. */
const RETURN_WATCH_DAYS = 45;

/**
 * paid -> reversed, because the receiving bank sent the money back.
 *
 * The debt to the creator was never discharged, so the FULL statement amount is
 * re-credited, whatever the bank deducted on the way (that loss is Vergr's).
 * The payout stops counting toward the cadence ladder, and the payee id is
 * cleared: the bank refused those details, so paying them again would only
 * bounce again. The creator is told and reconnects.
 */
async function reverseReturnedPayout(statementId, verdict) {
  const statementRef = db.collection('payout_statements').doc(statementId);
  const done = await db.runTransaction(async (tx) => {
    const st = await tx.get(statementRef);
    if (!st.exists || st.data().status !== 'paid') return null;
    const d = st.data();
    const accountRef = db.collection('payout_accounts').doc(d.uid);
    const acc = await tx.get(accountRef);
    const amount = Math.floor(Number(d.amountMicroUsd || 0));
    tx.update(db.collection('wallets').doc(d.uid), {
      owedMicroUsd: FieldValue.increment(amount),
      totalPaidMicroUsd: FieldValue.increment(-amount),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(statementRef, {
      status: 'reversed',
      reverseReason: 'returned_by_bank',
      returnReason: String(verdict?.reason || '').slice(0, 120),
      returnDetail: verdict?.detail ? String(verdict.detail).slice(0, 300) : null,
      returnedTransactionId: verdict?.transactionId || null,
      returnWatch: false,
      reversedAt: FieldValue.serverTimestamp(),
    });
    const accFields = {
      partnerPayeeId: FieldValue.delete(),
      notPayableReason: 'bank_returned_payment',
      mercuryInviteStatus: 'returned',
      payoutAccountReturnedAt: FieldValue.serverTimestamp(),
    };
    if (Number(acc.data()?.successfulPayouts || 0) > 0) accFields.successfulPayouts = FieldValue.increment(-1);
    tx.set(accountRef, accFields, { merge: true });
    tx.set(db.collection('transactions').doc(), {
      userId: d.uid,
      type: 'revenue_share_payout_reversed',
      currency: 'usd',
      amountMicroUsd: amount,
      amount,
      description: `Payout returned by your bank, ${microUsdToStr(amount)} back in your balance`,
      meta: { runId: d.runId, statementId, reason: 'returned_by_bank' },
      createdAt: FieldValue.serverTimestamp(),
    });
    return d;
  });
  if (!done) return false;
  await db.collection('notifications').add({
    recipientId: done.uid,
    type: 'revenue_share_payout_returned',
    title: 'Your bank sent your payout back',
    body: `${microUsdToStr(done.amountMicroUsd)} is back in your balance. Reconnect your payout account with correct details to be paid.`,
    read: false,
    data: { runId: done.runId, amountMicroUsd: done.amountMicroUsd },
    createdAt: FieldValue.serverTimestamp(),
  });
  return true;
}

/**
 * The second reconciliation layer. For every paid statement still on the watch
 * list, read the transactions Mercury created for its request and act:
 *   returned                       -> reverseReturnedPayout
 *   delivered, watch window over   -> off the list
 *   nothing found, window over     -> off the list and surfaced to staff, because
 *                                     an approved payment with no transaction is
 *                                     something a human should look at
 * Queries only watched statements (single-field equality, no index), so the
 * daily cost stays bounded by recent payouts, never by all payouts ever.
 */
async function checkReturnedPayouts(limit = 500) {
  const snap = await db.collection('payout_statements').where('returnWatch', '==', true).limit(limit).get();
  const out = { watched: snap.size, returned: 0, closed: 0, unconfirmed: 0, errors: 0 };
  const now = Date.now();
  const unconfirmed = [];
  for (const doc of snap.docs) {
    const st = doc.data();
    if (!st.mercuryRequestId) { out.errors++; continue; }
    try {
      const sinceMs = (tsMs(st.queuedAt) || tsMs(st.paidAt) || now) - 7 * 86_400_000;
      const r = await relayCall('transactions', {
        requestId: st.mercuryRequestId,
        accountId: st.mercuryAccountId || undefined,
        start: mercury.mercuryDate(sinceMs),
      });
      if (!r.ok || r.mercuryStatus !== 200) { out.errors++; continue; }
      const v = mercury.returnVerdict(r.body?.transactions);
      if (v.state === 'returned') {
        if (await reverseReturnedPayout(doc.id, v)) out.returned++;
        console.warn('[payouts] payout returned by bank', doc.id, v.reason);
        continue;
      }
      const windowOver = now > Number(st.returnWatchUntilMs || 0);
      if (!windowOver) continue;
      if (v.state === 'delivered') {
        await doc.ref.update({ returnWatch: false, deliveredTransactionId: v.transactionId || null, deliveryConfirmedAt: FieldValue.serverTimestamp() });
        out.closed++;
      } else {
        await doc.ref.update({ returnWatch: false, deliveryUnconfirmed: true });
        unconfirmed.push(doc.id);
        out.unconfirmed++;
      }
    } catch (e) {
      out.errors++;
      console.error('[payouts] return check failed', doc.id, String(e?.message || e).slice(0, 200));
    }
  }
  if (unconfirmed.length) {
    await alertStaff('payout_delivery_unconfirmed', 'Payouts approved but never seen leaving Mercury',
      `${unconfirmed.length} approved payout(s) have no sent transaction after ${RETURN_WATCH_DAYS} days. Check them in the Mercury dashboard.`,
      { statementIds: unconfirmed.slice(0, 20) });
  }
  return out;
}

// ── Reconcile + Mercury health (run at the start of every daily run) ─

/** A queued request older than this is surfaced to staff. Not a money number. */
const APPROVAL_STALE_DAYS = 3;

/**
 * Mercury deletes a token unused for 45 days and DOWNGRADES one whose scopes
 * outrun its use for 45 days. The keep-alive call keeps both tokens' READ use
 * current, but only a real send uses Token A's send scope and only a real
 * invite uses Token B's create scopes, so those are tracked and warned about.
 * Both tokens were created 2026-09-24.
 */
const MERCURY_TOKENS_CREATED_MS = Date.parse('2026-09-24T00:00:00Z');
const MERCURY_SCOPE_IDLE_LIMIT_DAYS = 45;
const MERCURY_SCOPE_WARN_DAYS = 35;
const healthRef = () => db.collection('payout_health').doc('mercury');

/** Stamp the last real use of a write scope: 'send' (Token A) or 'invite' (Token B). */
async function recordMercuryUse(kind) {
  const field = kind === 'send' ? 'lastSendRequestAt' : 'lastInviteCreatedAt';
  await healthRef().set({ [field]: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
}

async function alertStaff(type, title, body, data = {}) {
  const admins = await db.collection('users').where('staff', '==', true).limit(20).get();
  if (admins.empty) return;
  const batch = db.batch();
  for (const a of admins.docs) {
    batch.set(db.collection('notifications').doc(), {
      recipientId: a.id, type, title, body, read: false, data,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

/** Pure: which write scopes are close to being stripped. Exported for the guard. */
function scopeIdleWarnings(health, nowMs = Date.now()) {
  const out = [];
  for (const [kind, field, token] of [['send', 'lastSendRequestAt', 'A'], ['invite', 'lastInviteCreatedAt', 'B']]) {
    const since = Math.max(tsMs(health?.[field]) || 0, MERCURY_TOKENS_CREATED_MS);
    const idleDays = Math.floor((nowMs - since) / 86_400_000);
    if (idleDays >= MERCURY_SCOPE_WARN_DAYS) {
      out.push({ kind, token, idleDays, daysLeft: Math.max(0, MERCURY_SCOPE_IDLE_LIMIT_DAYS - idleDays), since });
    }
  }
  return out;
}

async function checkMercuryHealth() {
  let keepaliveOk = false;
  try {
    const r = await relayCall('accounts', {});
    keepaliveOk = r.ok && r.mercuryStatus === 200;
    if (!keepaliveOk) console.error('[payouts] Mercury keep-alive failed', r.httpStatus, r.error || '', r.mercuryStatus || '');
  } catch (e) {
    console.error('[payouts] Mercury keep-alive unreachable', String(e?.message || e).slice(0, 200));
  }
  const snap = await healthRef().get();
  const health = snap.exists ? snap.data() : {};
  const warnings = scopeIdleWarnings(health);
  const update = { lastKeepaliveAt: FieldValue.serverTimestamp(), keepaliveOk };

  // One alert per idle stretch per token, never one per day.
  for (const w of warnings) {
    const key = `${w.kind}_${w.since}`;
    if (health[`alerted_${w.kind}`] === key) continue;
    await alertStaff(
      'payout_token_idle',
      `Mercury Token ${w.token} is about to lose its ${w.kind === 'send' ? 'send' : 'invite'} permission`,
      w.kind === 'send'
        ? `No payout has been requested for ${w.idleDays} days. Mercury removes Token A's send permission at 45 days (${w.daysLeft} left). After that it must be recreated before anyone can be paid.`
        : `No creator has connected a payout account for ${w.idleDays} days. Mercury removes Token B at 45 days (${w.daysLeft} left). After that it must be recreated before anyone can connect.`,
      { token: w.token, idleDays: w.idleDays },
    );
    update[`alerted_${w.kind}`] = key;
  }
  if (!keepaliveOk && !health.keepaliveAlerted) {
    await alertStaff('payout_mercury_unreachable', 'Payouts cannot reach Mercury',
      'The daily payout run could not reach Mercury through the box 1 relay. Check vergr-mercury-relay and the Mercury tokens.');
    update.keepaliveAlerted = true;
  }
  if (keepaliveOk) update.keepaliveAlerted = false;
  await healthRef().set(update, { merge: true });
  return { keepaliveOk, warnings: warnings.length };
}

/**
 * Walk every queued statement and apply Mercury's decision.
 *   approved              -> paid (counts, notifies)
 *   rejected / cancelled  -> reversed (money back, notifies)
 *   pendingApproval       -> left alone; older than APPROVAL_STALE_DAYS is
 *                            surfaced once, because the creator's balance is
 *                            debited while it waits
 * Single-field equality query, so no composite index.
 */
async function reconcileQueuedPayouts(limit = 500) {
  const snap = await db.collection('payout_statements').where('status', '==', 'queued').limit(limit).get();
  const out = { queued: snap.size, paid: 0, reversed: 0, stale: 0, errors: 0 };
  const stale = [];
  for (const doc of snap.docs) {
    const st = doc.data();
    if (!st.mercuryRequestId) { out.errors++; continue; }
    try {
      const r = await relayCall('send/get', { requestId: st.mercuryRequestId });
      if (!r.ok || r.mercuryStatus !== 200) { out.errors++; continue; }
      const status = r.body?.status || null;
      const next = mercury.statementTransitionFor(status);
      if (next === 'paid') { if (await markStatementPaid(doc.id)) out.paid++; continue; }
      if (next === 'reversed') { if (await reverseStatement(doc.id, `mercury_${status}`)) out.reversed++; continue; }
      if (next === 'unknown') { console.error('[payouts] unrecognised Mercury status', doc.id, status); out.errors++; continue; }
      const queuedMs = tsMs(st.queuedAt);
      if (queuedMs && Date.now() - queuedMs > APPROVAL_STALE_DAYS * 86_400_000 && !st.approvalStaleAlertedAt) {
        stale.push({ id: doc.id, amountMicroUsd: st.amountMicroUsd });
      }
    } catch (e) {
      out.errors++;
      console.error('[payouts] reconcile failed', doc.id, String(e?.message || e).slice(0, 200));
    }
  }
  if (stale.length) {
    const total = stale.reduce((a, x) => a + Number(x.amountMicroUsd || 0), 0);
    await alertStaff('payout_approval_stale', 'Payouts are waiting for your approval in Mercury',
      `${stale.length} payout(s) totalling ${microUsdToStr(total)} have waited over ${APPROVAL_STALE_DAYS} days. Creators' balances are debited while they wait.`,
      { count: stale.length, totalMicroUsd: total });
    const batch = db.batch();
    for (const x of stale) batch.update(db.collection('payout_statements').doc(x.id), { approvalStaleAlertedAt: FieldValue.serverTimestamp() });
    await batch.commit();
    out.stale = stale.length;
  }
  return out;
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

  // Keep the Mercury tokens alive and apply the founder's approvals from the
  // Mercury dashboard. Both run even when there is nobody to pay today, and
  // neither is allowed to block the run.
  let mercuryHealth = null;
  let reconcile = null;
  try { mercuryHealth = await checkMercuryHealth(); } catch (e) {
    console.error('[payouts] Mercury health check failed', String(e?.message || e).slice(0, 200));
  }
  try {
    reconcile = await reconcileQueuedPayouts();
    if (reconcile.queued) console.log('[payouts] reconcile', reconcile);
  } catch (e) {
    console.error('[payouts] reconcile failed', String(e?.message || e).slice(0, 200));
  }

  // Returned wires: re-credit before this run reads anyone's balance.
  let returns = null;
  try {
    returns = await checkReturnedPayouts();
    if (returns.watched) console.log('[payouts] return check', returns);
  } catch (e) {
    console.error('[payouts] return check failed', String(e?.message || e).slice(0, 200));
  }

  // Read back finished Mercury onboardings first, so a creator who completed
  // the form yesterday can be paid today. Never allowed to block the run.
  try {
    const sweep = await sweepPayoutOnboarding();
    if (sweep.pending) console.log('[payouts] onboarding sweep', sweep);
  } catch (e) {
    console.error('[payouts] onboarding sweep failed', String(e?.message || e).slice(0, 200));
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
  const queued = results.filter((r) => r.status === 'queued');
  const notSent = results.filter((r) => r.status === 'not_sent');
  const failed = results.filter((r) => r.status === 'failed');

  await runRef.set({
    status: failed.length ? 'complete_with_errors' : 'complete',
    // paid = approved at once; queued = waiting for approval in Mercury.
    paidCount: paid.length,
    paidMicroUsd: paid.reduce((s, r) => s + (r.amountMicroUsd || 0), 0),
    queuedCount: queued.length,
    queuedMicroUsd: queued.reduce((s, r) => s + (r.amountMicroUsd || 0), 0),
    notSentCount: notSent.length,
    failedCount: failed.length,
    mercuryHealth, reconcile, returns,
    completedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return { runId, paid: paid.length, queued: queued.length, notSent: notSent.length, failed: failed.length, skipped: skipped.length };
}

// ── Exports ───────────────────────────────────────────────────────────

// Runs inside a dispatcher cron in index.js (it was its own Cloud Scheduler
// job, and every job past the first three is billed monthly).
exports.runCreatorPayouts = async function runCreatorPayouts() {
    const out = await executeRun(new Date());
    console.log('runCreatorPayouts', JSON.stringify(out));
  };

/**
 * Admin dry run. Shows exactly who would be paid and who would be skipped, with
 * reasons, and moves nothing. This is the thing to look at before the first
 * real run rather than finding out from the ledger afterwards.
 */
exports.previewCreatorPayoutRun = functions.https.onCall(
  { region: REGION },
  async (request) => {
    // ⚠ Was requireAdmin, which is operator-only now that role:'admin' is gone,
    // so a sub-admin granted Economy saw this button and got 'Admin only'. It is
    // a DRY RUN that moves nothing, so the Economy grant is the right gate.
    const { requireAdminScreen } = require('./adminAccess');
    await requireAdminScreen(request.auth?.uid, 'economy');
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

    const [accSnap, walletSnap, userSnap, upgradeSnap, paidThisMonth] = await Promise.all([
      db.collection('payout_accounts').doc(uid).get(),
      db.collection('wallets').doc(uid).get(),
      db.collection('users').doc(uid).get(),
      // The Level 2 / 3 request, so the screen can say where it stands.
      db.collection('kyc_upgrades').doc(uid).get(),
      // What this calendar month's cap has already used. Only when someone opens
      // the screen, never in a loop.
      paidThisCalendarMonth(uid).catch(() => 0),
    ]);

    let account = accSnap.exists ? accSnap.data() : null;
    // A creator who just finished Mercury's form comes back to this screen, so
    // this is where the verdict is read. One relay call, only while an invite is
    // pending and at most every 30s. A failure never breaks the screen.
    try {
      const refreshed = await refreshPayoutOnboarding(uid, account);
      if (refreshed) account = { ...account, ...refreshed };
    } catch (e) {
      console.error('[payouts] onboarding refresh failed', uid, String(e?.message || e).slice(0, 200));
    }
    const wallet = walletSnap.exists ? walletSnap.data() : {};
    const kycLevel = Number(userSnap.exists ? (userSnap.data()?.kycLevel || 0) : 0);
    const now = Date.now();
    const cadence = resolveCadence(account || {}, kycLevel, now);
    const inviteExpiresMs = tsMs(account?.mercuryInviteExpiresAt);
    const inviteLive = account?.mercuryInviteStatus === 'created' && inviteExpiresMs && inviteExpiresMs > now;

    return {
      enrolled: !!account?.enrolled,
      kycLevel,
      taxFormStatus: account?.taxFormStatus || 'required',
      taxFormType: account?.taxFormType || null,
      payoutAccountConnected: !!account?.partnerPayeeId,
      // Monthly limit by verification level (AML policy section 2). Earnings above
      // it carry forward; the screen explains that and offers the next level.
      limits: (() => {
        const cap = KYC_MONTHLY_CAP_MICRO_USD[Math.min(kycLevel, 3)] ?? 0;
        const owed = owedMicroUsd(wallet);
        const remaining = Math.max(0, cap - paidThisMonth);
        const nextLevel = kycLevel >= 1 && kycLevel < 3 ? kycLevel + 1 : null;
        return {
          level: kycLevel,
          monthlyCapMicroUsd: cap,
          paidThisMonthMicroUsd: paidThisMonth,
          remainingThisMonthMicroUsd: remaining,
          // Owed now but above what this month's cap can pay: it waits.
          aboveCapMicroUsd: Math.max(0, owed - remaining),
          nextLevel,
          nextLevelCapMicroUsd: nextLevel ? KYC_MONTHLY_CAP_MICRO_USD[nextLevel] : null,
        };
      })(),
      upgrade: upgradeSnap.exists ? {
        status: upgradeSnap.data().status || null,
        targetLevel: upgradeSnap.data().targetLevel || null,
        docType: upgradeSnap.data().docType || null,
        rejectionReason: upgradeSnap.data().rejectionReason || null,
        submittedAtMs: tsMs(upgradeSnap.data().submittedAt),
        reviewedAtMs: tsMs(upgradeSnap.data().reviewedAt),
      } : null,
      // Mercury onboarding state (build step 4). The screen renders each one as
      // a person who is stuck and what they do next.
      onboarding: {
        inviteStatus: account?.mercuryInviteStatus || null,
        onboardingUrl: inviteLive ? account.mercuryInviteUrl : null,
        expiresAtMs: inviteLive ? inviteExpiresMs : null,
        nameMatch: account?.nameMatch || null,
        notPayableReason: account?.notPayableReason || null,
        taxFormReason: account?.taxFormReason || null,
      },
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
        countriesOf(userSnap.exists ? userSnap.data() : null, account),
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
    if (!request.data?.connectPayoutAccount) return { enrolled: true };
    return { enrolled: true, onboarding: await connectPayoutAccount(uid) };
  },
);

// ── Payout account onboarding (Mercury recipient invite) ─────────────
//
// Hosted on enrollForPayouts ({ connectPayoutAccount: true }) rather than a new
// callable, because every new Cloud Function is a new Artifact Registry image.
//
// The creator enters their bank details AND uploads their W-9 / W-8BEN on
// Mercury's own hosted page (onboardingUrl). Vergr never sees the bank details.
// Mercury's verdict on the finished invite is read back in build step 4.

/** Creator-facing copy for every refusal. Kept here so the screen and server agree. */
const ONBOARDING_REFUSALS = {
  not_enrolled: 'Start payout setup first.',
  kyc_required: 'Verify your identity first.',
  frozen: 'Payouts are paused on your account. Contact support.',
  name_mismatch_review: 'The name on your bank account did not match your verified identity. Contact support to fix it.',
  verified_name_missing: 'We need to re-check your identity before you can connect a payout account. Contact support.',
  country_unknown: 'Set your country in your profile first.',
  sanctioned_country: 'Payouts are not available in your country.',
  mercury_unsupported_country: 'Our payments partner cannot send money to your country yet.',
  in_progress: 'Your payout setup is already starting. Try again in a minute.',
  email_missing: 'Your account needs an email address to connect a payout account.',
  not_open: 'Connecting a payout account is not open yet.',
  partner_error: 'We could not reach our payments partner. Try again shortly.',
};

function refuse(reason) {
  return new functions.https.HttpsError('failed-precondition', ONBOARDING_REFUSALS[reason] || 'Payout setup is unavailable.', { reason });
}

async function connectPayoutAccount(uid) {
  const accountRef = db.collection('payout_accounts').doc(uid);
  const [userSnap, kycSnap] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('users').doc(uid).collection('private').doc('kyc').get(),
  ]);
  const userData = userSnap.exists ? userSnap.data() : null;
  const privateKyc = kycSnap.exists ? kycSnap.data() : null;

  // Decide and claim inside one transaction, so two taps cannot create two invites.
  const decision = await db.runTransaction(async (tx) => {
    const snap = await tx.get(accountRef);
    const d = mercury.onboardingDecision({
      account: snap.exists ? snap.data() : null, userData, privateKyc, blocked: BLOCKED_COUNTRIES,
    });
    if (d.action === 'create') {
      tx.set(accountRef, {
        mercuryInvitePendingAt: FieldValue.serverTimestamp(),
        // Copied from the server-written Didit result: the name the bank account
        // must match, and the ID country the payout run checks for sanctions.
        verifiedLegalName: d.legalName,
        verifiedCountry: d.verifiedCountry || null,
      }, { merge: true });
    }
    return d;
  });

  if (decision.action === 'refuse') throw refuse(decision.reason);
  if (decision.action === 'connected') return { status: 'connected' };
  if (decision.action === 'reuse') {
    return { status: 'invite', onboardingUrl: decision.onboardingUrl, expiresAtMs: decision.expiresAtMs };
  }

  const clearPending = () => accountRef.set({ mercuryInvitePendingAt: FieldValue.delete() }, { merge: true });

  const contactEmail = await authEmailFor(uid);
  if (!contactEmail) { await clearPending(); throw refuse('email_missing'); }

  let res;
  try {
    res = await relayCall('invites/create', {
      contactEmail,
      legalName: decision.legalName,
      country: decision.country,
      organizationName: mercury.OPERATOR_LEGAL_NAME,
    });
  } catch (e) {
    await clearPending();
    console.error('[payouts] relay unreachable', uid, String(e?.message || e).slice(0, 200));
    throw refuse('partner_error');
  }

  if (!res.ok || (res.mercuryStatus !== 200 && res.mercuryStatus !== 201)) {
    await clearPending();
    // Never log the email or the name; the status codes are enough to diagnose.
    console.error('[payouts] invite refused', uid, res.httpStatus, res.error || '', res.mercuryStatus || '');
    throw refuse(res.error === 'token_b_missing' ? 'not_open' : 'partner_error');
  }

  const inv = mercury.inviteState(res.body);
  if (!inv.inviteId || !inv.onboardingUrl) {
    await clearPending();
    console.error('[payouts] invite response missing id or url', uid);
    throw refuse('partner_error');
  }

  await accountRef.set({
    mercuryInviteId: inv.inviteId,
    mercuryInviteStatus: inv.status,
    mercuryInviteUrl: inv.onboardingUrl,
    mercuryInviteExpiresAt: inv.expiresAtMs ? Timestamp.fromMillis(inv.expiresAtMs) : null,
    mercuryInviteCreatedAt: FieldValue.serverTimestamp(),
    mercuryInvitePendingAt: FieldValue.delete(),
  }, { merge: true });
  await recordMercuryUse('invite');

  return { status: 'invite', onboardingUrl: inv.onboardingUrl, expiresAtMs: inv.expiresAtMs };
}

function tsMs(t) {
  if (!t) return null;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t === 'number') return t;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

const INVITE_REFRESH_MIN_MS = 30 * 1000;

/**
 * Read Mercury's verdict on a pending invite and record it (build step 4).
 *
 * Returns the PLAIN fields written (so a caller can show them without a
 * re-read), or null when there was nothing to do.
 *
 * partnerPayeeId is the field blockingReason() treats as "payout account
 * connected". It is set ONLY when recipientVerdict() says the recipient is
 * payable: active, the bank account's name matches the Didit-verified name,
 * a country Mercury can pay, and a method we can send. A mismatch is recorded
 * for review and never auto-resolved: paying an account in someone else's name
 * is exactly what the identity gate exists to stop.
 *
 * Tax status comes from Mercury's own classification of the uploaded form, never
 * from the creator, which is the rule applyPartnerAccountState() documents.
 */
async function refreshPayoutOnboarding(uid, account, { force = false } = {}) {
  if (!account?.mercuryInviteId || account.mercuryInviteStatus !== 'created') return null;
  const checkedAt = tsMs(account.mercuryInviteCheckedAt);
  if (!force && checkedAt && Date.now() - checkedAt < INVITE_REFRESH_MIN_MS) return null;

  const ref = db.collection('payout_accounts').doc(uid);
  const stamp = { mercuryInviteCheckedAt: FieldValue.serverTimestamp() };

  const inviteRes = await relayCall('invites/get', { inviteId: account.mercuryInviteId });
  if (inviteRes.ok && inviteRes.mercuryStatus === 404) {
    await ref.set({ ...stamp, mercuryInviteStatus: 'expired' }, { merge: true });
    return { mercuryInviteStatus: 'expired' };
  }
  if (!inviteRes.ok || inviteRes.mercuryStatus !== 200) {
    console.error('[payouts] invite read failed', uid, inviteRes.httpStatus, inviteRes.error || '', inviteRes.mercuryStatus || '');
    await ref.set(stamp, { merge: true });
    return null;
  }

  const inv = mercury.inviteState(inviteRes.body);
  if (inv.status === 'expired') {
    await ref.set({ ...stamp, mercuryInviteStatus: 'expired' }, { merge: true });
    return { mercuryInviteStatus: 'expired' };
  }
  if (inv.status !== 'completed' || !inv.recipientId) {
    await ref.set({
      ...stamp,
      ...(inv.expiresAtMs ? { mercuryInviteExpiresAt: Timestamp.fromMillis(inv.expiresAtMs) } : {}),
    }, { merge: true });
    return null;
  }

  const recRes = await relayCall('recipient', { recipientId: inv.recipientId });
  if (!recRes.ok || recRes.mercuryStatus !== 200) {
    console.error('[payouts] recipient read failed', uid, recRes.httpStatus, recRes.error || '', recRes.mercuryStatus || '');
    await ref.set(stamp, { merge: true });
    return null;
  }

  const v = mercury.recipientVerdict(recRes.body, account.verifiedLegalName);
  const plain = {
    mercuryInviteStatus: 'completed',
    mercuryRecipientId: inv.recipientId,
    taxFormStatus: v.taxFormStatus || 'submitted',
    taxFormType: v.taxFormType || null,
    taxFormReason: v.taxFormReason || null,
    legalName: v.legalName || null,
    country: v.country || null,
    mercuryPaymentMethod: v.mercuryPaymentMethod || null,
    isBusiness: v.isBusiness ?? null,
    nameMatch: v.nameMatch || null,
    notPayableReason: v.notPayableReason || null,
    partnerPayeeId: v.partnerPayeeId || null,
  };
  await ref.set({
    ...plain,
    ...stamp,
    mercuryVerdictAt: FieldValue.serverTimestamp(),
    // A null payee must REMOVE the field, not store null, so a recipient that
    // stops being payable can never keep an old id by accident.
    partnerPayeeId: v.partnerPayeeId || FieldValue.delete(),
  }, { merge: true });

  if (v.notPayableReason) {
    // Uid and reason only; never the name, which is personal data in a log.
    console.warn('[payouts] onboarding completed but not payable', uid, v.notPayableReason);
  }
  return plain;
}

/**
 * Sweep for creators who finished Mercury's form and never reopened the payout
 * screen. Runs inside the existing daily run, so it adds no Cloud Function and
 * no Scheduler job. A single-field equality query, so no composite index.
 */
async function sweepPayoutOnboarding(limit = 200) {
  const snap = await db.collection('payout_accounts')
    .where('mercuryInviteStatus', '==', 'created')
    .limit(limit)
    .get();
  let refreshed = 0;
  for (const doc of snap.docs) {
    try {
      if (await refreshPayoutOnboarding(doc.id, doc.data(), { force: true })) refreshed++;
    } catch (e) {
      console.error('[payouts] sweep refresh failed', doc.id, String(e?.message || e).slice(0, 200));
    }
  }
  return { pending: snap.size, refreshed };
}

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
    const { requireAdmin, requireFreshStepUp, auditAdminAction } = require('./adminSecurity');
    const actor = request.auth?.uid;
    await requireAdmin(actor);
    // Every one of these moves when or whether a creator is paid.
    await requireFreshStepUp(actor);
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
    const { requireAdmin, requireFreshStepUp, auditAdminAction } = require('./adminSecurity');
    const actor = request.auth?.uid;
    await requireAdmin(actor);
    // Every one of these moves when or whether a creator is paid.
    await requireFreshStepUp(actor);
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
    const { requireAdmin, requireFreshStepUp, auditAdminAction } = require('./adminSecurity');
    const actor = request.auth?.uid;
    await requireAdmin(actor);
    // Every one of these moves when or whether a creator is paid.
    await requireFreshStepUp(actor);
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
  paidThisCalendarMonth,
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
  countriesOf,
  connectPayoutAccount,
  refreshPayoutOnboarding,
  sweepPayoutOnboarding,
  disbursePayout,
  payOne,
  markStatementPaid,
  reverseStatement,
  reconcileQueuedPayouts,
  checkMercuryHealth,
  scopeIdleWarnings,
  reverseReturnedPayout,
  checkReturnedPayouts,
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
