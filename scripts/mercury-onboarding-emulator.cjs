// Emulator integration test for creator payouts: onboarding (steps 3-4) and the
// queued -> paid / reversed payment lifecycle (step 5).
// Runs the REAL functions/creatorPayouts.js code against the Firestore emulator,
// with the Mercury relay and the Auth email lookup faked. NOT in npm run check,
// because it needs a running emulator.
//
// Run (Java 17 works with emulator v1.19.8; v1.20.4 needs Java 21):
//   start: java -jar "%USERPROFILE%/.cache/firebase/emulators/cloud-firestore-emulator-v1.19.8.jar" --host=127.0.0.1 --port=8089
//   then:  set FIRESTORE_EMULATOR_HOST=127.0.0.1:8089 && node scripts/mercury-onboarding-emulator.cjs
//   stop the emulator BY PID afterwards; never kill every java.exe.
//
// Uses the Admin SDK, so rules are not involved. For RULES probes note that
// emulator v1.19.8 does not enforce rules on a NAMED database: use (default).
const path = require('path');
const root = path.join(__dirname, '..');
const fn = (f) => path.join(root, 'functions', f);
process.env.GCLOUD_PROJECT = 'vergr-int-test';

const freq = require('module').createRequire(fn('index.js'));
const admin = freq('firebase-admin');
admin.initializeApp({ projectId: 'vergr-int-test' });

// ── fakes, injected before creatorPayouts loads them ──
const relayCalls = [];
let relayScript = {};
require.cache[require.resolve(fn('mercuryRelayClient.js'))] = {
  id: 'fake', filename: fn('mercuryRelayClient.js'), loaded: true,
  exports: {
    relayCall: async (route, body) => {
      relayCalls.push({ route, body });
      const h = relayScript[route];
      if (!h) return { ok: false, httpStatus: 599, error: 'unscripted' };
      return typeof h === 'function' ? h(body) : h;
    },
  },
};
let email = 'creator@example.com';
require.cache[require.resolve(fn('authEmails.js'))] = {
  id: 'fake2', filename: fn('authEmails.js'), loaded: true,
  exports: { authEmailFor: async () => email, authEmailsFor: async () => ({}), uidForEmail: async () => null },
};

const cp = require(fn('creatorPayouts.js'))._internal;
const { getFirestore } = freq('firebase-admin/firestore');
const db = getFirestore('vgrdb');

let total = 0; const fails = [];
const check = (c, l) => { total++; if (!c) fails.push(l); };
const acct = async (uid) => (await db.collection('payout_accounts').doc(uid).get()).data() || {};
async function expectThrow(p, reason, label) {
  try { await p; check(false, label + ' (did not throw)'); } catch (e) { check(e?.details?.reason === reason, `${label} (got ${e?.details?.reason || e.message})`); }
}

const recipient = (over = {}) => ({
  id: 'rec-1', status: 'active', name: 'Thandi Mokoena', isBusiness: false,
  defaultPaymentMethod: 'internationalWire', address: { country: 'ZA' },
  attachments: [{ formType: 'w8BEN', uploadedAt: '2026-09-24T10:00:00Z' }], ...over,
});

(async () => {
  // ── connectPayoutAccount ──
  const U = 'u-connect';
  await db.collection('users').doc(U).set({ kycLevel: 1, country: 'ZA' });
  await db.collection('users').doc(U).collection('private').doc('kyc').set({ legalName: 'Thandi Mokoena', country: 'ZA' });
  await db.collection('payout_accounts').doc(U).set({ enrolled: true });

  relayScript = { 'invites/create': { ok: false, httpStatus: 503, error: 'token_b_missing' } };
  await expectThrow(cp.connectPayoutAccount(U), 'not_open', 'token B missing -> not open yet');
  let a = await acct(U);
  check(!a.mercuryInvitePendingAt, 'lock cleared after a refused create');
  check(a.verifiedLegalName === 'Thandi Mokoena' && a.verifiedCountry === 'ZA', 'verified name + country copied onto payout_accounts');

  relayScript = { 'invites/create': (b) => ({ ok: true, mercuryStatus: 201, body: { id: 'inv-1', status: 'created', onboardingUrl: 'https://mercury.test/onb/1', expiresAt: new Date(Date.now() + 7 * 86400e3).toISOString(), recipientId: null, echo: b } }) };
  relayCalls.length = 0;
  const r1 = await cp.connectPayoutAccount(U);
  check(r1.status === 'invite' && r1.onboardingUrl === 'https://mercury.test/onb/1', 'CONTROL: invite created and URL returned');
  const sent = relayCalls[0]?.body || {};
  check(sent.contactEmail === 'creator@example.com' && sent.legalName === 'Thandi Mokoena' && sent.country === 'ZA' && sent.organizationName === 'Vergr LLC', 'relay receives Auth email, verified name, country, operator name');
  a = await acct(U);
  check(a.mercuryInviteId === 'inv-1' && a.mercuryInviteStatus === 'created' && !a.mercuryInvitePendingAt, 'invite fields stored, lock cleared');
  check(typeof a.mercuryInviteExpiresAt?.toMillis === 'function', 'expiry stored as a Timestamp');

  relayCalls.length = 0;
  const r2 = await cp.connectPayoutAccount(U);
  check(r2.onboardingUrl === 'https://mercury.test/onb/1' && relayCalls.length === 0, 'second tap reuses the live invite, no Mercury call');

  const U2 = 'u-noemail';
  await db.collection('users').doc(U2).set({ kycLevel: 1, country: 'US' });
  await db.collection('users').doc(U2).collection('private').doc('kyc').set({ legalName: 'Sam Lee', country: 'US' });
  await db.collection('payout_accounts').doc(U2).set({ enrolled: true });
  email = null;
  await expectThrow(cp.connectPayoutAccount(U2), 'email_missing', 'no Auth email refused');
  check(!(await acct(U2)).mercuryInvitePendingAt, 'lock cleared after email refusal');
  email = 'creator@example.com';

  const U3 = 'u-noname';
  await db.collection('users').doc(U3).set({ kycLevel: 1, country: 'ZA' });
  await db.collection('payout_accounts').doc(U3).set({ enrolled: true });
  relayCalls.length = 0;
  await expectThrow(cp.connectPayoutAccount(U3), 'verified_name_missing', 'no verified name refused');
  check(relayCalls.length === 0, 'no Mercury call without a verified name');

  // ── refreshPayoutOnboarding ──
  const refresh = async (uid, opts) => cp.refreshPayoutOnboarding(uid, await acct(uid), opts);

  relayScript = { 'invites/get': { ok: true, mercuryStatus: 200, body: { id: 'inv-1', status: 'created', expiresAt: new Date(Date.now() + 86400e3).toISOString() } } };
  check((await refresh(U, { force: true })) === null, 'still-pending invite changes nothing');
  a = await acct(U);
  check(!a.partnerPayeeId && a.mercuryInviteStatus === 'created' && a.mercuryInviteCheckedAt, 'pending: no payee, check stamped');
  relayCalls.length = 0;
  check((await refresh(U)) === null && relayCalls.length === 0, 'throttled: no Mercury call within 30s');

  relayScript = {
    'invites/get': { ok: true, mercuryStatus: 200, body: { id: 'inv-1', status: 'completed', recipientId: 'rec-1' } },
    recipient: { ok: true, mercuryStatus: 200, body: recipient() },
  };
  const done = await refresh(U, { force: true });
  a = await acct(U);
  check(done && a.partnerPayeeId === 'rec-1', 'CONTROL: matching completed recipient becomes the payee');
  check(a.taxFormStatus === 'on_file' && a.taxFormType === 'W-8BEN', 'tax form from Mercury classification');
  check(a.nameMatch === 'ok' && a.country === 'ZA' && a.mercuryPaymentMethod === 'internationalWire' && a.mercuryInviteStatus === 'completed', 'verdict fields recorded');
  check(cp.blockingReason(a, { owedMicroUsd: 500e6 }, 1, Date.now(), 90, cp.countriesOf({ country: 'ZA' }, a)) === null, 'blockingReason now passes (tax on file + payee)');

  // Payable, then the recipient turns out to be someone else: payee must be REMOVED.
  const U4 = 'u-mismatch';
  await db.collection('payout_accounts').doc(U4).set({
    enrolled: true, partnerPayeeId: 'stale-id', mercuryInviteId: 'inv-4', mercuryInviteStatus: 'created', verifiedLegalName: 'Thandi Mokoena',
  });
  relayScript = {
    'invites/get': { ok: true, mercuryStatus: 200, body: { id: 'inv-4', status: 'completed', recipientId: 'rec-4' } },
    recipient: { ok: true, mercuryStatus: 200, body: recipient({ id: 'rec-4', name: 'Someone Else' }) },
  };
  await refresh(U4, { force: true });
  a = await acct(U4);
  check(!('partnerPayeeId' in a), 'name mismatch REMOVES any payee id');
  check(a.nameMatch === 'mismatch' && a.notPayableReason === 'name_mismatch', 'mismatch recorded for review');
  check(cp.blockingReason(a, { owedMicroUsd: 500e6 }, 1, Date.now(), 90, []) === 'payout_account_required', 'mismatched creator stays blocked');

  const U5 = 'u-unknownform';
  await db.collection('payout_accounts').doc(U5).set({ enrolled: true, mercuryInviteId: 'inv-5', mercuryInviteStatus: 'created', verifiedLegalName: 'Thandi Mokoena' });
  relayScript = {
    'invites/get': { ok: true, mercuryStatus: 200, body: { id: 'inv-5', status: 'completed', recipientId: 'rec-5' } },
    recipient: { ok: true, mercuryStatus: 200, body: recipient({ id: 'rec-5', attachments: [{ formType: 'unknown', uploadedAt: '2026-09-24T10:00:00Z' }] }) },
  };
  await refresh(U5, { force: true });
  a = await acct(U5);
  check(a.partnerPayeeId === 'rec-5' && a.taxFormStatus === 'submitted', 'unreadable form: payee set but tax NOT on file');
  check(cp.blockingReason(a, { owedMicroUsd: 500e6 }, 1, Date.now(), 90, []) === 'tax_form_required', 'unreadable form still blocks payout');

  const U6 = 'u-yemen';
  await db.collection('payout_accounts').doc(U6).set({ enrolled: true, mercuryInviteId: 'inv-6', mercuryInviteStatus: 'created', verifiedLegalName: 'Thandi Mokoena' });
  relayScript = {
    'invites/get': { ok: true, mercuryStatus: 200, body: { id: 'inv-6', status: 'completed', recipientId: 'rec-6' } },
    recipient: { ok: true, mercuryStatus: 200, body: recipient({ id: 'rec-6', address: { country: 'YE' } }) },
  };
  await refresh(U6, { force: true });
  a = await acct(U6);
  check(!a.partnerPayeeId && a.notPayableReason === 'mercury_unsupported_country', 'bank in a Mercury-blocked country is not payable');

  const U7 = 'u-expired';
  await db.collection('payout_accounts').doc(U7).set({ enrolled: true, mercuryInviteId: 'inv-7', mercuryInviteStatus: 'created' });
  relayScript = { 'invites/get': { ok: true, mercuryStatus: 200, body: { id: 'inv-7', status: 'expired' } } };
  await refresh(U7, { force: true });
  check((await acct(U7)).mercuryInviteStatus === 'expired', 'expired invite recorded');

  const U8 = 'u-relaydown';
  await db.collection('payout_accounts').doc(U8).set({ enrolled: true, mercuryInviteId: 'inv-8', mercuryInviteStatus: 'created' });
  relayScript = { 'invites/get': { ok: false, httpStatus: 502, error: 'mercury_unreachable' } };
  check((await refresh(U8, { force: true })) === null, 'relay failure returns null');
  a = await acct(U8);
  check(a.mercuryInviteStatus === 'created' && !a.partnerPayeeId && a.mercuryInviteCheckedAt, 'relay failure changes only the check stamp');

  // ── sweep ──
  const U9 = 'u-sweep';
  await db.collection('payout_accounts').doc(U9).set({ enrolled: true, mercuryInviteId: 'inv-9', mercuryInviteStatus: 'created', verifiedLegalName: 'Thandi Mokoena' });
  relayScript = {
    'invites/get': (b) => (b.inviteId === 'inv-9'
      ? { ok: true, mercuryStatus: 200, body: { id: 'inv-9', status: 'completed', recipientId: 'rec-9' } }
      : { ok: true, mercuryStatus: 200, body: { id: b.inviteId, status: 'created' } }),
    recipient: { ok: true, mercuryStatus: 200, body: recipient({ id: 'rec-9' }) },
  };
  const sw = await cp.sweepPayoutOnboarding();
  check(sw.pending >= 1 && (await acct(U9)).partnerPayeeId === 'rec-9', 'daily sweep completes a creator who never reopened the screen');

  // ── countriesOf reads the new signals ──
  const cs = cp.countriesOf({ country: 'ZA', kyc: {} }, { verifiedCountry: 'IR', country: 'ZA' });
  check(cp.blockingReason({ enrolled: true }, {}, 1, Date.now(), 90, cs) === 'sanctioned_country', 'verified ID country now reaches the sanctions check');

  // ══ Step 5: requesting payments ══
  const { Timestamp } = freq('firebase-admin/firestore');
  const old = Timestamp.fromMillis(Date.parse('2026-01-01T00:00:00Z'));
  const wallet = async (uid) => (await db.collection('wallets').doc(uid).get()).data() || {};
  const stmt = async (id) => (await db.collection('payout_statements').doc(id).get()).data() || {};
  const notes = async (uid, type) => (await db.collection('notifications').where('recipientId', '==', uid).where('type', '==', type).get()).size;
  async function payable(uid, owed, over = {}) {
    const { kycLevel: _kyc, ...accOver } = over; // kycLevel lives on the users doc
    // Level 2 ($2,500/month cap) so these amounts are paid in full.
    await db.collection('users').doc(uid).set({ kycLevel: over.kycLevel || 2, country: 'ZA', createdAt: old });
    await db.collection('wallets').doc(uid).set({ owedMicroUsd: owed, totalPaidMicroUsd: 0 });
    await db.collection('payout_accounts').doc(uid).set({
      enrolled: true, taxFormStatus: 'on_file', taxFormType: 'W-8BEN', partnerPayeeId: 'rec-' + uid,
      mercuryPaymentMethod: 'internationalWire', verifiedLegalName: 'Thandi Mokoena', verifiedCountry: 'ZA', ...accOver,
    });
  }
  const RUN_DATE = new Date('2026-10-01T06:00:00Z'); // 1st of the month: standard cadence is due
  const planFor = async (uid) => (await cp.buildRunPlan(RUN_DATE)).plan.find((e) => e.uid === uid);

  // Plan rounds to whole cents and carries the method + supplier name.
  const P1 = 'p-approve';
  await payable(P1, 150_123_456);
  const e1 = await planFor(P1);
  check(e1 && e1.amountMicroUsd === 150_120_000, 'plan floors to whole cents (150.123456 -> 150.12)');
  check(e1?.paymentMethod === 'internationalWire' && e1?.legalName === 'Thandi Mokoena', 'plan carries method and verified name');

  // No method: skipped, never reserved.
  const P0 = 'p-nomethod';
  await payable(P0, 200e6, { mercuryPaymentMethod: null });
  const { skipped } = await cp.buildRunPlan(RUN_DATE);
  check(skipped.some((x) => x.uid === P0 && x.reason === 'payment_method_missing'), 'no payment method: skipped');

  // Accepted -> QUEUED, not paid.
  relayCalls.length = 0;
  relayScript = { send: { ok: true, mercuryStatus: 200, body: { requestId: 'req-1', status: 'pendingApproval' }, classification: { outcome: 'accepted', requestId: 'req-1', mercuryStatus: 'pendingApproval', needsLookup: false } } };
  const r1q = await cp.payOne('run_2026-10-01', e1);
  const sid1 = 'run_2026-10-01__' + P1;
  check(r1q.status === 'queued', 'accepted request is QUEUED, not paid');
  const sentBody = relayCalls.find((c) => c.route === 'send')?.body || {};
  check(sentBody.cents === 15012 && sentBody.idempotencyKey === sid1 && sentBody.recipientId === 'rec-' + P1, 'relay gets cents, statement-id key, recipient');
  let st = await stmt(sid1);
  check(st.status === 'queued' && st.mercuryRequestId === 'req-1', 'statement queued with request id');
  check((await wallet(P1)).owedMicroUsd === 3_456, 'wallet keeps the sub-cent remainder, debited the rest');
  check(!(await acct(P1)).successfulPayouts && !(await acct(P1)).firstPayoutAt, 'queued does NOT count toward cadence');
  check((await notes(P1, 'revenue_share_paid')) === 0, 'queued sends no "You have been paid"');
  // Statements are stamped with the REAL time, so the cap is read for the real month.
  check((await cp.paidThisCalendarMonth(P1, Date.now())) === 150_120_000, 'KYC cap counts queued money');
  check((await cp.payOne('run_2026-10-01', e1)).status === 'skipped', 'same statement cannot be paid twice');

  // Reconcile: still pending, then approved.
  relayScript = { 'send/get': { ok: true, mercuryStatus: 200, body: { requestId: 'req-1', status: 'pendingApproval' } } };
  await cp.reconcileQueuedPayouts();
  check((await stmt(sid1)).status === 'queued', 'pendingApproval leaves it queued');
  relayScript = { 'send/get': { ok: true, mercuryStatus: 200, body: { requestId: 'req-1', status: 'approved' } } };
  await cp.reconcileQueuedPayouts();
  st = await stmt(sid1);
  a = await acct(P1);
  check(st.status === 'paid' && st.paidAt, 'CONTROL: approved becomes PAID');
  check(a.successfulPayouts === 1 && a.firstPayoutAt, 'paid counts toward cadence, firstPayoutAt set');
  check((await notes(P1, 'revenue_share_paid')) === 1, '"You have been paid" sent once, on approval');
  await cp.reconcileQueuedPayouts();
  check((await notes(P1, 'revenue_share_paid')) === 1 && (await acct(P1)).successfulPayouts === 1, 're-running reconcile does not double-count');

  // Rejected in the dashboard -> reversed, money back, creator told.
  const P2 = 'p-reject';
  await payable(P2, 120e6);
  relayScript = { send: { ok: true, mercuryStatus: 200, body: { requestId: 'req-2', status: 'pendingApproval' }, classification: { outcome: 'accepted', requestId: 'req-2', mercuryStatus: 'pendingApproval' } } };
  await cp.payOne('run_2026-10-01', await planFor(P2));
  check((await wallet(P2)).owedMicroUsd === 0, 'reserved before rejection');
  relayScript = { 'send/get': { ok: true, mercuryStatus: 200, body: { requestId: 'req-2', status: 'rejected' } } };
  await cp.reconcileQueuedPayouts();
  const w2 = await wallet(P2);
  check((await stmt('run_2026-10-01__' + P2)).status === 'reversed', 'rejected becomes REVERSED');
  check(w2.owedMicroUsd === 120e6 && w2.totalPaidMicroUsd === 0, 'rejected: full amount back in the balance');
  check((await notes(P2, 'revenue_share_payout_reversed')) === 1 && !(await acct(P2)).successfulPayouts, 'rejected: creator told, nothing counted');
  const rev = await db.collection('transactions').where('userId', '==', P2).where('type', '==', 'revenue_share_payout_reversed').get();
  check(rev.size === 1 && rev.docs[0].data().amountMicroUsd === 120e6, 'reversing ledger row written once');
  await cp.reverseStatement('run_2026-10-01__' + P2, 'again');
  check((await wallet(P2)).owedMicroUsd === 120e6, 'reversing twice does not double-credit');

  // Relay refused before Mercury -> not sent, re-credited quietly.
  const P3 = 'p-notsent';
  await payable(P3, 110e6);
  relayScript = { send: { ok: false, httpStatus: 503, error: 'payout_account_not_configured' } };
  const r3 = await cp.payOne('run_2026-10-01', await planFor(P3));
  check(r3.status === 'not_sent' && (await wallet(P3)).owedMicroUsd === 110e6, 'relay refusal: not sent, balance restored');
  check((await notes(P3, 'revenue_share_payout_reversed')) === 0, 'internal retry does not notify the creator');

  // Mercury's 24h duplicate guard -> not sent, re-credited.
  const P4 = 'p-dup';
  await payable(P4, 130e6);
  relayScript = { send: { ok: true, mercuryStatus: 400, body: { message: 'duplicate' }, classification: { outcome: 'retry_later', reason: 'duplicate_within_24h' } } };
  check((await cp.payOne('run_2026-10-01', await planFor(P4))).status === 'not_sent' && (await wallet(P4)).owedMicroUsd === 130e6, 'duplicate within 24h: re-credited for the next run');

  // Unknown outcome -> failed, stays debited for a human.
  const P5 = 'p-unknown';
  await payable(P5, 140e6);
  relayScript = { send: { ok: false, httpStatus: 502, error: 'mercury_unreachable' } };
  const r5 = await cp.payOne('run_2026-10-01', await planFor(P5));
  check(r5.status === 'failed' && (await wallet(P5)).owedMicroUsd === 0, 'unknown outcome: FAILED, stays debited (no auto refund)');
  check((await stmt('run_2026-10-01__' + P5)).status === 'failed', 'failed statement left for a human');

  // Stale approvals alert staff once.
  await db.collection('users').doc('staff-1').set({ staff: true });
  const P6 = 'p-stale';
  await db.collection('payout_statements').doc('run_2026-09-01__' + P6).set({
    runId: 'run_2026-09-01', uid: P6, amountMicroUsd: 100e6, status: 'queued', mercuryRequestId: 'req-6',
    queuedAt: Timestamp.fromMillis(Date.now() - 4 * 86400e3),
  });
  relayScript = { 'send/get': { ok: true, mercuryStatus: 200, body: { status: 'pendingApproval' } } };
  await cp.reconcileQueuedPayouts();
  await cp.reconcileQueuedPayouts();
  check((await notes('staff-1', 'payout_approval_stale')) === 1, 'stale approval alerts staff exactly once');

  // Mercury health: keep-alive and one alert when unreachable.
  relayScript = { accounts: { ok: true, mercuryStatus: 200, body: { accounts: [] } } };
  const h1 = await cp.checkMercuryHealth();
  check(h1.keepaliveOk === true, 'keep-alive call succeeds');
  check(relayCalls.some((c) => c.route === 'accounts'), 'keep-alive hits GET /accounts');
  relayScript = { accounts: { ok: false, httpStatus: 502, error: 'mercury_unreachable' } };
  await cp.checkMercuryHealth();
  await cp.checkMercuryHealth();
  check((await notes('staff-1', 'payout_mercury_unreachable')) === 1, 'unreachable Mercury alerts staff once');

  const created = Date.parse('2026-09-24T00:00:00Z');
  check(cp.scopeIdleWarnings({}, created + 10 * 86400e3).length === 0, 'no idle warning at day 10');
  const w36 = cp.scopeIdleWarnings({}, created + 36 * 86400e3);
  check(w36.length === 2 && w36.find((x) => x.token === 'A').daysLeft === 9, 'both tokens warned at day 36, 9 days left');
  check(cp.scopeIdleWarnings({ lastSendRequestAt: created + 30 * 86400e3 }, created + 36 * 86400e3).map((x) => x.token).join() === 'B', 'a recent send clears Token A warning only');

  // ══ Level 1 cap ($50/month) vs the $100 minimum, per ToS 8.4 + AML policy 2 ══
  const L1 = 'p-level1';
  await payable(L1, 150e6, { kycLevel: 1 });
  const eL1 = await planFor(L1);
  check(eL1 && eL1.amountMicroUsd === 50e6, 'Level 1 owed $150: paid $50 (the cap), not skipped');
  relayScript = { send: { ok: true, mercuryStatus: 200, body: { requestId: 'req-L1', status: 'pendingApproval' }, classification: { outcome: 'accepted', requestId: 'req-L1', mercuryStatus: 'pendingApproval' } } };
  await cp.payOne('run_2026-10-01', eL1);
  check((await wallet(L1)).owedMicroUsd === 100e6, 'Level 1: the other $100 stays owed and carries forward');
  // The L1 statement carries today's real timestamp, so ask about the real month.
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 7));
  const againL1 = await cp.buildRunPlan(monthStart);
  check(againL1.skipped.some((x) => x.uid === L1 && x.reason === 'kyc_monthly_cap_reached'), 'Level 1: nothing more that month (queued counts against the cap)');
  const L1low = 'p-level1-low';
  await payable(L1low, 80e6, { kycLevel: 1 });
  check((await cp.buildRunPlan(RUN_DATE)).skipped.some((x) => x.uid === L1low && x.reason === 'below_minimum'), 'Level 1 owed $80: below the $100 balance minimum, not paid');

  // Calendar month, not a rolling 30 days: last month's run a few seconds under
  // 30 days ago must NOT count against this month (Feb 1 06:00:05 vs Mar 1 06:00).
  await db.collection('payout_statements').doc('m-feb').set({ uid: 'p-month', amountMicroUsd: 50e6, status: 'paid', createdAt: Timestamp.fromMillis(Date.parse('2026-02-01T06:00:05Z')) });
  await db.collection('payout_statements').doc('m-mar').set({ uid: 'p-month', amountMicroUsd: 7e6, status: 'queued', createdAt: Timestamp.fromMillis(Date.parse('2026-03-01T06:00:01Z')) });
  await db.collection('payout_statements').doc('m-rev').set({ uid: 'p-month', amountMicroUsd: 9e6, status: 'reversed', createdAt: Timestamp.fromMillis(Date.parse('2026-03-01T06:00:02Z')) });
  check((await cp.paidThisCalendarMonth('p-month', Date.parse('2026-03-01T06:00:00Z') + 60e3)) === 7e6, 'March run ignores the Feb 1 payment; reversed does not count');
  check((await cp.paidThisCalendarMonth('p-month', Date.parse('2026-02-15T00:00:00Z'))) === 50e6, 'mid-February counts the Feb 1 payment');

  // ══ Step 6: returned wires ══
  // P1 was approved in step 5, so it is on the watch list.
  st = await stmt(sid1);
  check(st.returnWatch === true && st.returnWatchUntilMs > Date.now(), 'paid statement is watched for a return');
  relayScript = { transactions: (b) => ({ ok: true, mercuryStatus: 200, body: { transactions: [{ id: 'tx-1', status: 'pending', requestId: b.requestId }] } }) };
  relayCalls.length = 0;
  await cp.checkReturnedPayouts();
  const tq = relayCalls.find((c) => c.route === 'transactions')?.body || {};
  check(tq.requestId === 'req-1' && /^\d{4}-\d{2}-\d{2}$/.test(tq.start), 'looks up by requestId with an explicit start date');
  check((await stmt(sid1)).status === 'paid' && (await stmt(sid1)).returnWatch === true, 'in flight: still paid, still watched');

  relayScript = { transactions: { ok: true, mercuryStatus: 200, body: { transactions: [{ id: 'tx-1', status: 'sent' }] } } };
  await cp.checkReturnedPayouts();
  check((await stmt(sid1)).returnWatch === true, 'delivered inside the window: keep watching (a return can come later)');

  const beforeRet = await wallet(P1);
  relayScript = { transactions: { ok: true, mercuryStatus: 200, body: { transactions: [{ id: 'tx-1', status: 'sent', relatedTransactions: [{ relationKind: 'OriginalTransactionToReturn', id: 'tx-r' }] }] } } };
  await cp.checkReturnedPayouts();
  st = await stmt(sid1);
  a = await acct(P1);
  const afterRet = await wallet(P1);
  check(st.status === 'reversed' && st.reverseReason === 'returned_by_bank' && st.returnWatch === false, 'returned wire: statement reversed, off the watch list');
  check(afterRet.owedMicroUsd === beforeRet.owedMicroUsd + 150_120_000, 'returned wire: full amount back in the balance');
  check((a.successfulPayouts || 0) === 0, 'returned payout no longer counts toward cadence');
  check(!('partnerPayeeId' in a) && a.notPayableReason === 'bank_returned_payment', 'bank details cleared: creator must reconnect');
  check((await notes(P1, 'revenue_share_payout_returned')) === 1, 'creator told once');
  await cp.checkReturnedPayouts();
  check((await wallet(P1)).owedMicroUsd === afterRet.owedMicroUsd, 'a second check does not re-credit again');

  // Window over: delivered closes; nothing found is surfaced once.
  const mkPaid = async (id, uid) => db.collection('payout_statements').doc(id).set({
    runId: 'run_x', uid, amountMicroUsd: 100e6, status: 'paid', mercuryRequestId: 'req-' + id,
    returnWatch: true, returnWatchUntilMs: Date.now() - 1000, queuedAt: Timestamp.fromMillis(Date.now() - 50 * 86400e3),
  });
  await mkPaid('w-deliv', 'p-w1');
  await mkPaid('w-none', 'p-w2');
  relayScript = { transactions: (b) => ({ ok: true, mercuryStatus: 200, body: { transactions: b.requestId === 'req-w-deliv' ? [{ id: 'tx-d', status: 'sent' }] : [] } }) };
  await cp.checkReturnedPayouts();
  const d1 = await stmt('w-deliv');
  const d2 = await stmt('w-none');
  check(d1.returnWatch === false && d1.deliveredTransactionId === 'tx-d', 'delivered after the window: closed with the transaction id');
  check(d2.returnWatch === false && d2.deliveryUnconfirmed === true && d2.status === 'paid', 'never seen leaving: flagged, not reversed');
  check((await notes('staff-1', 'payout_delivery_unconfirmed')) === 1, 'unconfirmed delivery alerts staff');

  // Relay down: nothing changes.
  await mkPaid('w-down', 'p-w3');
  relayScript = { transactions: { ok: false, httpStatus: 502, error: 'mercury_unreachable' } };
  await cp.checkReturnedPayouts();
  check((await stmt('w-down')).returnWatch === true && (await stmt('w-down')).status === 'paid', 'relay failure changes nothing');

  // ══ Payout verification: Level 2 / 3 by document review ══
  const pv = require(fn('payoutVerification.js'));
  const upg = async (uid) => (await db.collection('kyc_upgrades').doc(uid).get()).data() || {};
  const user = async (uid) => (await db.collection('users').doc(uid).get()).data() || {};
  const V = 'v-creator';
  await db.collection('users').doc(V).set({ kycLevel: 1, country: 'ZA', createdAt: old });
  const pendingReq = (level, docType) => db.collection('kyc_upgrades').doc(V).set({
    uid: V, targetLevel: level, docType, status: 'pending', submittedAt: Timestamp.now(),
    files: [{ path: `upgrade-docs/${V}/1-0.pdf`, contentType: 'application/pdf', size: 1000 }],
  });

  await pendingReq(2, 'utility_bill');
  const listed = (await pv.listRequests('pending')).requests.find((x) => x.uid === V);
  check(listed && listed.targetLevel === 2 && listed.fileCount === 1 && listed.kycLevel === 1, 'pending request listed for review');

  let threwReason = false;
  try { await pv.decideRequest('op', V, 'rejected', 'made_up'); } catch { threwReason = true; }
  check(threwReason, 'a rejection needs a known reason');

  await pv.decideRequest('op', V, 'rejected', 'too_old', 'bill from 2024');
  let u = await upg(V);
  check(u.status === 'rejected' && u.rejectionReason === 'too_old' && u.files.length === 0 && u.reviewedBy === 'op', 'rejected: reason recorded, file list removed');
  check((await user(V)).kycLevel === 1, 'rejected: level unchanged');
  check((await notes(V, 'payout_level_rejected')) === 1, 'rejected: creator told why');

  await pendingReq(2, 'bank_statement');
  await pv.decideRequest('op', V, 'approved');
  u = await upg(V);
  check(u.status === 'approved' && u.files.length === 0, 'CONTROL: approved, file list removed');
  check((await user(V)).kycLevel === 2 && (await wallet(V)).kycLevel === 2, 'approved: Level 2 on the user and the wallet');
  check((await notes(V, 'payout_level_approved')) === 1, 'approved: creator told');
  let again = false;
  try { await pv.decideRequest('op', V, 'approved'); } catch { again = true; }
  check(again, 'a decided request cannot be decided twice');

  await pendingReq(3, 'utility_bill');
  let wrongDoc = false;
  try { await pv.decideRequest('op', V, 'approved'); } catch (e) { wrongDoc = /bad_doc_type/.test(e.message); }
  check(wrongDoc && (await user(V)).kycLevel === 2, 'a proof of address cannot grant Level 3');
  await pv.decideRequest('op', V, 'rejected', 'wrong_document');

  const V1 = 'v-level1';
  await db.collection('users').doc(V1).set({ kycLevel: 1 });
  await db.collection('kyc_upgrades').doc(V1).set({
    uid: V1, targetLevel: 3, docType: 'payslips', status: 'pending', submittedAt: Timestamp.now(),
    files: [{ path: `upgrade-docs/${V1}/1-0.pdf`, contentType: 'application/pdf' }],
  });
  let skip = false;
  try { await pv.decideRequest('op', V1, 'approved'); } catch (e) { skip = /level_changed/.test(e.message); }
  check(skip && (await user(V1)).kycLevel === 1, 'no skipping from Level 1 to Level 3');

  const V0 = 'v-level0';
  await db.collection('users').doc(V0).set({ kycLevel: 0 });
  await db.collection('kyc_upgrades').doc(V0).set({
    uid: V0, targetLevel: 2, docType: 'utility_bill', status: 'pending', submittedAt: Timestamp.now(),
    files: [{ path: `upgrade-docs/${V0}/1-0.pdf`, contentType: 'application/pdf' }],
  });
  let noDidit = false;
  try { await pv.decideRequest('op', V0, 'approved'); } catch (e) { noDidit = /level_changed/.test(e.message); }
  check(noDidit && (await user(V0)).kycLevel === 0, 'an upload never replaces the Didit identity check');

  // The payout screen's limits block, through the real callable handler.
  const gpa = require(fn('creatorPayouts.js')).getPayoutAccount;
  if (typeof gpa?.run === 'function') {
    const L = 'v-limits';
    await db.collection('users').doc(L).set({ kycLevel: 1, createdAt: old });
    await db.collection('wallets').doc(L).set({ owedMicroUsd: 180e6 });
    await db.collection('payout_statements').doc('lim-1').set({ uid: L, amountMicroUsd: 20e6, status: 'paid', createdAt: Timestamp.now() });
    const res = await gpa.run({ auth: { uid: L }, data: {} });
    const lim = res.limits || {};
    check(lim.level === 1 && lim.monthlyCapMicroUsd === 50e6 && lim.paidThisMonthMicroUsd === 20e6 && lim.remainingThisMonthMicroUsd === 30e6, 'limits: $50 cap, $20 used, $30 left this month');
    check(lim.aboveCapMicroUsd === 150e6 && lim.nextLevel === 2 && lim.nextLevelCapMicroUsd === 2500e6, 'limits: $150 waiting above the cap, next level offers $2,500');
    check(res.upgrade === null, 'no request yet');
  } else {
    check(false, 'getPayoutAccount.run is not available to test the limits block');
  }

  if (fails.length) { fails.forEach((f) => console.error('FAIL', f)); console.error(`${fails.length} of ${total} failed`); process.exit(1); }
  console.log(`onboarding integration: ${total} assertions green`);
  process.exit(0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
