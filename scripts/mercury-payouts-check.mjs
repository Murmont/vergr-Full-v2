// Guard for functions/mercuryPayouts.js (creator payouts, build step 1).
//
//   node scripts/mercury-payouts-check.mjs              run every check
//   node scripts/mercury-payouts-check.mjs --self-test  prove each suite FAILS
//                                                       against a sabotaged module
//
// No token, no network, no Firestore: the module is pure and the HTTP client is
// driven with a fake fetch. Every suite takes the module as an argument so the
// self-test can hand it a broken copy; a suite that still passes against its
// own fault is a guard that cannot see anything.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const real = require('../functions/mercuryPayouts.js');
const realRelay = require('../functions/mercuryRelayClient.js');
// payoutVerification.js calls getFirestore() at load, which needs an app. A
// throwaway app with a fake project id; nothing here touches the network.
const functionsRequire = createRequire(new URL('../functions/index.js', import.meta.url));
const fbAdmin = functionsRequire('firebase-admin');
if (!fbAdmin.apps.length) fbAdmin.initializeApp({ projectId: 'guard-no-network' });
const pv = require('../functions/payoutVerification.js');
import { readFileSync } from 'node:fs';

const SUITES = {
  amounts(m, check, throws) {
    const s = m.splitPayable(100_009_999);
    check(s.cents === 10000 && s.amount === 100 && s.carryMicroUsd === 9_999, 'sub-cent remainder carries, never rounds up');
    check(s.sendMicroUsd + s.carryMicroUsd === 100_009_999, 'send + carry equals the payable exactly');
    const t = m.splitPayable(123_450_000);
    check(t.amount === 123.45 && t.carryMicroUsd === 0, '$123.45 converts exactly');
    // Every cent value from $0.00 to $5,000.00 must round-trip through the double.
    let ok = true;
    for (let c = 0; c <= 500_000; c++) {
      const a = m.centsToAmount(c);
      if (Math.round(a * 100) !== c || Number(a.toFixed(2)) !== a) { ok = false; break; }
    }
    check(ok, 'every cent to $5,000 round-trips through the USD double');
    check(m.splitPayable(1_000_000_000_000).amount === 1_000_000, '$1,000,000 converts exactly');
    throws(() => m.splitPayable(-1), 'negative payable refused');
    throws(() => m.splitPayable(1.5), 'fractional micro-USD refused');
    throws(() => m.splitPayable('100'), 'string payable refused');
    check(m.idempotencyKeyFor('run1', 'u1') === 'run1__u1', 'idempotency key is the statement doc id');
    throws(() => m.idempotencyKeyFor('', 'u1'), 'idempotency key needs a runId');
  },

  country(m, check, throws) {
    check(m.paymentMethodFor('US') === 'ach' && m.paymentMethodFor(' us ') === 'ach', 'US is ACH');
    check(m.paymentMethodFor('ZA') === 'internationalWire', 'non-US is an international wire');
    throws(() => m.paymentMethodFor(''), 'empty country refused, never guessed');
    throws(() => m.paymentMethodFor('USA'), 'three-letter code refused');
    for (const c of ['BY', 'CU', 'IR', 'KP', 'MM', 'RU', 'SD', 'SY', 'VE', 'YE']) {
      check(m.mercuryCountryBlock(c) === 'mercury_unsupported_country', `Mercury refuses ${c}`);
    }
    for (const c of ['US', 'ZA', 'GB', 'UA', 'CN', 'AE']) {
      check(m.mercuryCountryBlock(c) === null, `Mercury can pay ${c}`);
    }
    check(m.mercuryCountryBlock(null) === 'country_unknown', 'unknown country is a block, not a pass');
  },

  bodies(m, check, throws) {
    const inv = m.buildRecipientInvite({
      contactEmail: 'a@b.co', legalName: ' Damien Ashton ', country: 'ZA', organizationName: 'Org',
    });
    check(inv.sendEmail === false, 'invite is white-label (sendEmail false)');
    check(inv.requireTaxDocument === true, 'invite requires a tax document');
    check(inv.paymentMethods.length === 1 && inv.paymentMethods[0] === 'internationalWire', 'invite method follows country');
    check(inv.name === 'Damien Ashton' && inv.organizationNameOnRequest === 'Org', 'invite name trimmed, org passed through');
    throws(() => m.buildRecipientInvite({ contactEmail: '', legalName: 'A B', country: 'US', organizationName: 'O' }), 'invite needs an email');
    throws(() => m.buildRecipientInvite({ contactEmail: 'a@b.co', legalName: 'A B', country: 'MM', organizationName: 'O' }), 'invite refused for a Mercury-blocked country');
    throws(() => m.buildRecipientInvite({ contactEmail: 'a@b.co', legalName: 'A B', country: 'US' }), 'invite needs the org name passed in');

    const ach = m.buildSendMoneyRequest({ recipientId: 'r', cents: 10001, paymentMethod: 'ach', idempotencyKey: 'k' });
    check(ach.amount === 100.01 && !('purpose' in ach) && !('chargeType' in ach), 'ACH carries no purpose or chargeType');
    const wire = m.buildSendMoneyRequest({ recipientId: 'r', cents: 10000, paymentMethod: 'internationalWire', idempotencyKey: 'k', legalName: 'D A' });
    check(wire.chargeType === 'shared', 'every international wire sets chargeType shared (omitted = $15 ours)');
    check(wire.purpose?.simple?.category === 'contractor', 'wire purpose is contractor (independent supplier)');
    check(wire.purpose?.simple?.additionalInfo === 'D A', 'wire purpose names the supplier');
    check(Object.keys(wire).every((k) => ['recipientId', 'amount', 'paymentMethod', 'idempotencyKey', 'purpose', 'chargeType'].includes(k)), 'no currency or undocumented field on the body');
    throws(() => m.buildSendMoneyRequest({ recipientId: 'r', cents: 0, paymentMethod: 'ach', idempotencyKey: 'k' }), 'zero amount refused');
    throws(() => m.buildSendMoneyRequest({ recipientId: 'r', cents: 100, paymentMethod: 'ach', idempotencyKey: '' }), 'missing idempotency key refused');
    throws(() => m.buildSendMoneyRequest({ recipientId: 'r', cents: 100, paymentMethod: 'internationalWire', idempotencyKey: 'k' }), 'wire without a supplier name refused');
    throws(() => m.buildSendMoneyRequest({ recipientId: 'r', cents: 100, paymentMethod: 'check', idempotencyKey: 'k' }), 'unsupported method refused');
  },

  responses(m, check) {
    const ok = m.classifySendResponse(200, { requestId: 'q1', status: 'pendingApproval' });
    check(ok.outcome === 'accepted' && ok.requestId === 'q1' && !ok.needsLookup, '200 is accepted');
    const dup = m.classifySendResponse(409, { requestId: 'q1', status: 'pendingApproval' });
    check(dup.outcome === 'accepted' && dup.replayed === true, '409 is SUCCESS, not failure');
    check(m.classifySendResponse(409, {}).needsLookup === true, '409 with no body is accepted but flagged for lookup');
    check(m.classifySendResponse(400, { message: 'Duplicate transaction detected' }).outcome === 'retry_later', '400 duplicate retries next run');
    check(m.classifySendResponse(400, { errors: { amount: 'invalid' } }).outcome === 'failed', 'other 400 fails');
    check(m.classifySendResponse(500, null).outcome === 'failed', '500 fails');
    check(m.classifySendResponse(404, {}).outcome === 'failed', '404 fails');

    check(m.statementTransitionFor('pendingApproval') === null, 'pending stays queued');
    check(m.statementTransitionFor('approved') === 'paid', 'approved becomes paid');
    check(m.statementTransitionFor('rejected') === 'reversed', 'rejected reverses');
    check(m.statementTransitionFor('cancelled') === 'reversed', 'cancelled reverses');
    check(m.statementTransitionFor('weird') === 'unknown', 'unknown status is never acted on');

    const created = m.inviteState({ id: 'i', status: 'created', recipientId: 'r', expiresAt: '2026-10-01T00:00:00Z', onboardingUrl: 'u' });
    check(created.recipientId === null, 'a recipientId on an unfinished invite is ignored');
    check(created.expiresAtMs === Date.parse('2026-10-01T00:00:00Z'), 'invite expiry parsed');
    check(m.inviteState({ status: 'completed', recipientId: 'r' }).recipientId === 'r', 'completed invite yields the recipient');
    check(m.inviteState({ status: 'nope' }).status === 'unknown', 'unrecognised invite status is unknown');

    const accts = m.mercuryAccounts({ accounts: [{ id: 1, type: 'mercury' }, { id: 2, type: 'recipient' }, { id: 3, type: 'external' }] });
    check(accts.length === 1 && accts[0].id === 1, 'only our own Mercury accounts are kept');
  },

  tax(m, check) {
    const att = (formType, uploadedAt) => ({ formType, uploadedAt, fileName: 'f', url: 'x' });
    const v = (r) => m.taxFormVerdict(r);
    check(v({ attachments: [att('w9', '2026-01-01T00:00:00Z')] }).taxFormType === 'W-9', 'w9 maps to W-9');
    check(v({ isBusiness: false, attachments: [att('w8BEN', '2026-01-01T00:00:00Z')] }).taxFormType === 'W-8BEN', 'w8BEN maps to W-8BEN');
    check(v({ isBusiness: true, attachments: [att('w8BENE', '2026-01-01T00:00:00Z')] }).taxFormStatus === 'on_file', 'w8BENE from a business is on file');
    check(v({ attachments: [att('w9', '2026-01-01T00:00:00Z')] }).taxFormStatus === 'on_file', 'classified form is on file');
    check(v({ attachments: [att('unknown', '2026-01-01T00:00:00Z')] }).taxFormStatus === 'submitted', 'unknown form is NOT on file');
    check(v({ attachments: [] }).taxFormStatus === 'submitted', 'no attachment is NOT on file');
    check(v({}).taxFormStatus === 'submitted', 'missing attachments is NOT on file');
    check(v({ attachments: [att('w9', '2026-01-01T00:00:00Z'), att('unknown', '2026-02-01T00:00:00Z')] }).taxFormStatus === 'submitted', 'newest unreadable upload wins over an older valid one');
    check(v({ attachments: [att('unknown', '2026-01-01T00:00:00Z'), att('w9', '2026-02-01T00:00:00Z')] }).taxFormStatus === 'on_file', 'a readable re-upload clears an unreadable one');
    check(v({ isBusiness: false, attachments: [att('w8BENE', '2026-01-01T00:00:00Z')] }).taxFormStatus === 'submitted', 'entity form from an individual fails closed');
    check(v({ isBusiness: true, attachments: [att('w8BEN', '2026-01-01T00:00:00Z')] }).taxFormStatus === 'submitted', 'individual form from a business fails closed');
  },

  names(m, check) {
    const n = m.nameMatches;
    check(n('Damien Ashton', 'Damien Ashton'), 'exact name matches');
    check(n('ASHTON DAMIEN', 'Damien Ashton'), 'word order ignored');
    check(n('Damien Ashton', 'Damien William Ashton'), 'bank may drop a middle name');
    check(n('José Núñez', 'Jose Nunez'), 'accents ignored');
    check(n("Siobhan O'Neill", 'Siobhan ONeill'), 'apostrophes ignored');
    check(!n('John Smith', 'Damien Ashton'), 'different person is a mismatch');
    check(!n('Damien', 'Damien Ashton'), 'first name alone is a mismatch');
    check(!n('D Ashton', 'Damien Ashton'), 'an initial is a mismatch (review, not a guess)');
    check(!n('Damien Ashton Smith', 'Damien Ashton'), 'an extra word on the bank side is a mismatch');
    check(!n('Damien William', 'Damien William Ashton'), 'missing surname is a mismatch');
    check(!n('Vergr LLC', 'Damien Ashton'), 'business-named account is a mismatch');
    check(!n('', ''), 'empty names never match');

    const rec = {
      id: 'r1', status: 'active', name: 'Damien Ashton', isBusiness: false, defaultPaymentMethod: 'internationalWire',
      address: { country: 'za' }, attachments: [{ formType: 'w8BEN', uploadedAt: '2026-01-01T00:00:00Z' }],
    };
    const good = m.recipientVerdict(rec, 'Damien Ashton');
    check(good.partnerPayeeId === 'r1' && good.nameMatch === 'ok' && good.country === 'ZA', 'matching active recipient becomes the payee');
    check(good.taxFormStatus === 'on_file' && good.taxFormType === 'W-8BEN', 'verdict carries the tax form');
    check(m.recipientVerdict(rec, 'Someone Else').partnerPayeeId === null, 'name mismatch withholds the payee id');
    check(m.recipientVerdict({ ...rec, address: { country: 'YE' } }, 'Damien Ashton').partnerPayeeId === null, 'Mercury-blocked country withholds the payee id');
    check(m.recipientVerdict({ ...rec, status: 'deleted' }, 'Damien Ashton').recipientDeleted === true, 'deleted recipient is reported');
    check(m.recipientVerdict(null, 'Damien Ashton').partnerPayeeId === null, 'missing recipient is never payable');
    check(good.notPayableReason === null, 'payable recipient has no reason');
    check(m.recipientVerdict(rec, 'Someone Else').notPayableReason === 'name_mismatch', 'mismatch reason named');
    check(m.recipientVerdict({ ...rec, defaultPaymentMethod: 'check' }, 'Damien Ashton').notPayableReason === 'unsupported_payment_method', 'a method we cannot send is not payable');
    check(m.recipientVerdict({ ...rec, defaultPaymentMethod: 'check' }, 'Damien Ashton').partnerPayeeId === null, 'unsupported method withholds the payee id');
    check(m.recipientVerdict({ ...rec, status: 'pending' }, 'Damien Ashton').notPayableReason === 'recipient_inactive', 'inactive recipient is not payable');
    check(m.recipientVerdict({ ...rec, status: 'deleted' }, 'Damien Ashton').notPayableReason === 'recipient_deleted', 'deleted reason named');
  },

  onboarding(m, check) {
    const BLOCKED = new Set(['KP', 'IR', 'SY', 'CU', 'RU', 'BY', 'VE']);
    const now = Date.parse('2026-09-24T12:00:00Z');
    const base = {
      account: { enrolled: true },
      userData: { kycLevel: 1, country: 'ZA' },
      privateKyc: { legalName: 'Damien Ashton', country: 'ZA' },
      blocked: BLOCKED,
      now,
    };
    const d = (over) => m.onboardingDecision({ ...base, ...over });
    const reason = (over) => d(over).reason;

    const ok = d({});
    check(ok.action === 'create' && ok.legalName === 'Damien Ashton' && ok.country === 'ZA', 'CONTROL: eligible creator gets an invite');
    check(reason({ account: {} }) === 'not_enrolled', 'not enrolled refused');
    check(reason({ userData: { kycLevel: 0, country: 'ZA' } }) === 'kyc_required', 'unverified refused');
    check(reason({ account: { enrolled: true, frozen: true } }) === 'frozen', 'frozen refused');
    check(reason({ account: { enrolled: true, nameMatch: 'mismatch' } }) === 'name_mismatch_review', 'name mismatch goes to support');
    check(d({ account: { enrolled: true, partnerPayeeId: 'r1' } }).action === 'connected', 'already connected is not re-invited');
    check(reason({ privateKyc: { country: 'ZA' } }) === 'verified_name_missing', 'no verified name refused (never typed by the creator)');
    check(reason({ privateKyc: { legalName: '  ', country: 'ZA' } }) === 'verified_name_missing', 'blank verified name refused');
    check(reason({ userData: { kycLevel: 1, country: 'RU' } }) === 'sanctioned_country', 'sanctioned profile country refused');
    check(reason({ privateKyc: { legalName: 'A B', country: 'IR' } }) === 'sanctioned_country', 'sanctioned ID country refused');
    check(reason({ userData: { kycLevel: 1, country: 'YE' } }) === 'mercury_unsupported_country', 'Mercury-blocked country refused at onboarding');
    check(reason({ userData: { kycLevel: 1 }, privateKyc: { legalName: 'A B' } }) === 'country_unknown', 'no country at all refused');
    check(d({ userData: { kycLevel: 1, country: 'US' }, privateKyc: { legalName: 'A B', country: 'ZA' } }).country === 'US', 'method follows where they live, not the ID');
    check(d({ userData: { kycLevel: 1 }, privateKyc: { legalName: 'A B', country: 'GB' } }).country === 'GB', 'ID country used when profile country is unset');

    const live = { enrolled: true, mercuryInviteStatus: 'created', mercuryInviteUrl: 'https://m/x', mercuryInviteExpiresAt: now + 3 * 3600_000 };
    const reuse = d({ account: live });
    check(reuse.action === 'reuse' && reuse.onboardingUrl === 'https://m/x', 'live invite is reused, not duplicated');
    check(d({ account: { ...live, mercuryInviteExpiresAt: now + 10 * 60_000 } }).action === 'create', 'nearly expired invite is replaced');
    check(d({ account: { ...live, mercuryInviteStatus: 'expired' } }).action === 'create', 'expired invite is replaced');
    check(d({ account: { ...live, mercuryInviteExpiresAt: { toMillis: () => now + 3 * 3600_000 } } }).action === 'reuse', 'Firestore Timestamp expiry understood');
    check(reason({ account: { enrolled: true, mercuryInvitePendingAt: now - 10_000 } }) === 'in_progress', 'double tap within a minute refused');
    check(d({ account: { enrolled: true, mercuryInvitePendingAt: now - 120_000 } }).action === 'create', 'stale pending lock does not block forever');

    // The company name has one home. The server copy must match it.
    const legal = readFileSync(new URL('../src/screens/marketing/legal/legalContent.js', import.meta.url), 'utf8');
    const mm = /legalName:\s*'([^']+)'/.exec(legal);
    check(!!mm && mm[1] === m.OPERATOR_LEGAL_NAME, 'OPERATOR_LEGAL_NAME matches OPERATOR.legalName in legalContent.js');
  },

  async relay(m, check) {
    const relayClient = m.__relayClient || realRelay;
    const calls = [];
    const mk = (routes) => async (url, init = {}) => {
      calls.push({ url, init });
      for (const [match, res] of routes) if (url.includes(match)) return { status: res[0], text: async () => res[1] };
      return { status: 404, text: async () => '' };
    };
    const good = mk([
      ['metadata.google.internal', [200, 'aaa.bbb.ccc']],
      ['/payouts/v1/', [200, JSON.stringify({ status: 201, body: { id: 'i1' } })]],
    ]);
    calls.length = 0;
    const r = await relayClient.relayCall('invites/create', { a: 1 }, { fetchImpl: good });
    check(r.ok && r.mercuryStatus === 201 && r.body.id === 'i1', 'CONTROL: relay call succeeds');
    const meta = calls[0];
    check(meta.url.includes('audience=' + encodeURIComponent(relayClient.RELAY_AUDIENCE)), 'identity token requested for the relay audience');
    check(meta.init.headers['Metadata-Flavor'] === 'Google', 'metadata server header sent');
    check(calls[1].url === relayClient.RELAY_BASE + '/v1/invites/create', 'relay route URL');
    check(calls[1].init.headers.Authorization === 'Bearer aaa.bbb.ccc', 'identity token sent as bearer');
    check(relayClient.RELAY_AUDIENCE === 'https://sfu.vergr.app/payouts', 'audience matches what box 1 is configured with');

    const b = await relayClient.relayCall('invites/create', {}, { fetchImpl: mk([
      ['metadata.google.internal', [200, 'aaa.bbb.ccc']],
      ['/payouts/v1/', [503, JSON.stringify({ error: 'token_b_missing' })]],
    ]) });
    check(!b.ok && b.error === 'token_b_missing', 'relay 503 surfaces its reason, not a throw');

    let threw = false;
    try { await relayClient.relayCall('x', {}, { fetchImpl: mk([['metadata.google.internal', [404, '']]]) }); } catch { threw = true; }
    check(threw, 'no identity token means no call');
    threw = false;
    try { await relayClient.relayCall('x', {}, { fetchImpl: mk([['metadata.google.internal', [200, 'not-a-jwt']]]) }); } catch { threw = true; }
    check(threw, 'malformed identity token means no call');
  },

  async returns(m, check, throws) {
    const v = (txs) => m.returnVerdict(txs).state;
    check(v([]) === 'none' && v(null) === 'none', 'no transaction yet is none');
    check(v([{ id: 't', status: 'pending' }]) === 'in_flight', 'pending is in flight');
    check(v([{ id: 't', status: 'sent' }]) === 'delivered', 'CONTROL: sent is delivered');
    for (const st of ['failed', 'cancelled', 'reversed', 'blocked']) {
      check(v([{ id: 't', status: st }]) === 'returned', `${st} transaction is returned`);
    }
    check(v([{ id: 't', status: 'sent', relatedTransactions: [{ relationKind: 'OriginalTransactionToReturn' }] }]) === 'returned', 'a sent wire with a linked return is returned');
    check(v([{ id: 't', status: 'sent', relatedTransactions: [{ relationKind: 'FailedPaymentToPaymentRefund' }] }]) === 'returned', 'payment refund link is returned');
    check(v([{ id: 't', status: 'sent', relatedTransactions: [{ relationKind: 'OriginalTransactionToFeePayment' }] }]) === 'delivered', 'a fee link is NOT a return');
    check(v([{ id: 'a', status: 'sent' }, { id: 'b', status: 'failed' }]) === 'returned', 'any returned transaction wins');
    const r = m.returnVerdict([{ id: 'tx9', status: 'failed', reasonForFailure: 'account closed' }]);
    check(r.transactionId === 'tx9' && r.reason === 'transaction_failed' && r.detail === 'account closed', 'return carries id, reason, bank detail');
    check(m.mercuryDate(Date.parse('2026-09-24T23:59:00Z')) === '2026-09-24', 'Mercury date is UTC YYYY-MM-DD');
    throws(() => m.mercuryDate(NaN), 'bad date refused');

    const calls = [];
    const c = m.createMercuryClient({ token: 't', fetchImpl: async (url) => { calls.push(url); return { status: 200, text: async () => '{"transactions":[]}' }; } });
    await c.listTransactionsForRequest('acc-1', 'req-1', '2026-09-01');
    const u = new URL(calls[0]);
    check(u.pathname === '/api/v1/account/acc-1/transactions', 'transactions path');
    check(u.searchParams.get('requestId') === 'req-1' && u.searchParams.get('start') === '2026-09-01', 'filtered by requestId, start set (default is only 30 days)');
    throws(() => c.listTransactionsForRequest('acc-1', 'req-1', '01/09/2026'), 'bad start format refused');
    throws(() => c.listTransactionsForRequest('acc-1', '', null), 'requestId required');
  },

  verification(m, check) {
    const v = m.__pv || pv;
    const good = {
      uid: 'u1', status: 'pending', targetLevel: 2, docType: 'utility_bill',
      files: [{ path: 'upgrade-docs/u1/1-0.pdf', contentType: 'application/pdf' }],
    };
    check(v.approvalProblem(good, 1) === null, 'CONTROL: a valid Level 2 request can be approved');
    check(v.approvalProblem({ ...good, targetLevel: 3, docType: 'payslips' }, 2) === null, 'CONTROL: Level 3 from Level 2');
    check(v.approvalProblem(good, 0) === 'level_changed', 'Level 2 needs Level 1 first (Didit)');
    check(v.approvalProblem(good, 2) === 'level_changed', 'no approving a level already held');
    check(v.approvalProblem({ ...good, targetLevel: 3, docType: 'payslips' }, 1) === 'level_changed', 'no skipping from 1 to 3');
    check(v.approvalProblem({ ...good, targetLevel: 1 }, 0) === 'bad_target', 'Level 1 can never come from an upload');
    check(v.approvalProblem({ ...good, docType: 'payslips' }, 1) === 'bad_doc_type', 'a Level 3 document does not prove an address');
    check(v.approvalProblem({ ...good, status: 'approved' }, 1) === 'not_pending', 'decided requests cannot be re-approved');
    check(v.approvalProblem({ ...good, files: [] }, 1) === 'bad_files', 'no files, no approval');
    check(v.approvalProblem({ ...good, files: [{ path: 'upgrade-docs/OTHER/1.pdf', contentType: 'application/pdf' }] }, 1) === 'bad_files', "another creator's file is refused");
    check(v.approvalProblem({ ...good, files: [{ path: 'upgrade-docs/u1/../x.pdf', contentType: 'application/pdf' }] }, 1) === 'bad_files', 'path traversal refused');
    check(v.approvalProblem({ ...good, files: [{ path: 'upgrade-docs/u1/a.exe', contentType: 'application/x-msdownload' }] }, 1) === 'bad_files', 'wrong content type refused');
    check(v.approvalProblem({ ...good, files: Array(4).fill(good.files[0]) }, 1) === 'bad_files', 'more than 3 files refused');

    // Client and server must agree on every list the two share.
    const client = readFileSync(new URL('../src/utils/payoutVerification.js', import.meta.url), 'utf8');
    const keysFor = (lvl) => {
      const block = client.split(`  ${lvl}: [`)[1]?.split('],')[0] || '';
      return [...block.matchAll(/key: '([a-z_]+)'/g)].map((x) => x[1]);
    };
    check(JSON.stringify(keysFor(2)) === JSON.stringify(pv.DOC_TYPES[2]), 'Level 2 document types match client/server');
    check(JSON.stringify(keysFor(3)) === JSON.stringify(pv.DOC_TYPES[3]), 'Level 3 document types match client/server');
    const copyBlock = client.split('export const REJECT_COPY = {')[1]?.split('};')[0] || '';
    const copyKeys = [...copyBlock.matchAll(/^\s+([a-z_]+):/gm)].map((x) => x[1]);
    check(JSON.stringify(copyKeys) === JSON.stringify(pv.REJECT_REASONS), 'rejection reasons match client/server');
    check(client.includes('MAX_FILES = ' + pv.MAX_FILES + ';') && client.includes('MAX_FILE_BYTES = 5 * 1024 * 1024;') && pv.MAX_FILE_BYTES === 5 * 1024 * 1024, 'file limits match');
    for (const t of pv.ALLOWED_TYPES) check(client.includes(`'${t}'`), `client allows ${t}`);

    // The rules keep their locks.
    const storage = readFileSync(new URL('../storage.rules', import.meta.url), 'utf8');
    const up = storage.split('match /upgrade-docs/{userId}/{fileName}')[1]?.split('}')[0] || '';
    check(up.includes('allow read, update, delete: if false;'), 'nobody can read uploaded documents from the app');
    check(up.includes('5 * 1024 * 1024'), 'storage enforces the 5 MB cap');
    const fsr = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
    const ku = fsr.split('match /kyc_upgrades/{uid}')[1]?.split('allow delete')[0] || '';
    check(ku.includes("request.resource.data.status == 'pending'") && ku.includes("resource.data.status in ['approved', 'rejected']"), 'creator can only file a pending request, never one under review');
    check(ku.includes('hasOnly('), 'creator cannot write decision fields');

    // Vergr Admin CSP = base CSP + blob: frames (for PDFs), nothing else.
    const base = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')).app.security.csp;
    const adminCsp = JSON.parse(readFileSync(new URL('../src-tauri/tauri.admin.conf.json', import.meta.url), 'utf8')).app.security?.csp;
    // The consumer app loads Coda's checkout SDKs; the admin app sells nothing, so it must NOT.
    const baseNoCoda = base.replace(' https://js.codapayments.com https://hosted-component.codapayments.com', '');
    check(baseNoCoda !== base, 'CONTROL: the consumer CSP carries the Coda SDK hosts');
    check(adminCsp === baseNoCoda.replace("frame-src 'self' https:;", "frame-src 'self' https: blob:;"), 'admin CSP is the base CSP plus blob: frames only (and no checkout scripts)');
    check(!base.includes('frame-src \'self\' https: blob:'), 'the consumer app CSP is NOT widened');
  },

  async client(m, check, throws) {
    const calls = [];
    const fake = async (url, init) => {
      calls.push({ url, init });
      const status = url.endsWith('/request-send-money') ? 409 : 200;
      return { status, text: async () => (url.includes('/accounts') ? '{"accounts":[]}' : 'not json') };
    };
    const c = m.createMercuryClient({ token: 'tok', fetchImpl: fake });
    const a = await c.getAccounts();
    check(a.status === 200 && Array.isArray(a.body.accounts), 'GET /accounts parsed');
    check(calls[0].url === 'https://api.mercury.com/api/v1/accounts', 'base URL is api.mercury.com/api/v1');
    check(calls[0].init.headers.Authorization === 'Bearer tok', 'bearer auth header');
    const s = await c.requestSendMoney('acc/1', { amount: 1 });
    check(s.status === 409, '409 is returned, not thrown');
    check(calls[1].url.endsWith('/account/acc%2F1/request-send-money'), 'path segments are encoded');
    check(calls[1].init.method === 'POST' && JSON.parse(calls[1].init.body).amount === 1, 'body sent as JSON');
    check(s.body && s.body.raw === 'not json', 'non-JSON body survives as raw text');
    await c.getRecipientInvite('i1');
    check(calls[2].url.endsWith('/recipients/invites/i1'), 'invite path is /recipients/invites/{id}');
    await c.getSendMoneyRequest('q1');
    check(calls[3].url.endsWith('/request-send-money/q1'), 'approval path is /request-send-money/{id}');
    throws(() => m.createMercuryClient({ fetchImpl: fake }), 'client refuses to build without a token');
  },
};

async function runAll(m) {
  const out = {};
  for (const [name, fn] of Object.entries(SUITES)) {
    const failures = [];
    let count = 0;
    const check = (cond, label) => { count++; if (!cond) failures.push(label); };
    const throws = (f, label) => { let t = false; try { f(); } catch { t = true; } check(t, label); };
    try { await fn(m, check, throws); } catch (e) { failures.push(`suite threw: ${e.message}`); }
    out[name] = { count, failures };
  }
  return out;
}

// One fault per suite. Each must make its own suite fail.
const SABOTAGE = {
  amounts: { centsToAmount: (c) => c / 100 + 0.001, splitPayable: (x) => ({ ...real.splitPayable(x), cents: Math.ceil(x / 10000) }) },
  country: { mercuryCountryBlock: (c) => (['BY', 'CU', 'IR', 'KP', 'RU', 'SY', 'VE'].includes(c) ? 'mercury_unsupported_country' : null) },
  bodies: { buildSendMoneyRequest: (a) => { const b = real.buildSendMoneyRequest(a); delete b.chargeType; return b; } },
  responses: { classifySendResponse: (s, b) => (s === 409 ? { outcome: 'failed' } : real.classifySendResponse(s, b)) },
  tax: { taxFormVerdict: (r) => ({ taxFormStatus: (r?.attachments || []).length ? 'on_file' : 'submitted', taxFormType: null }) },
  names: { nameMatches: (a, b) => String(a).length > 0 && String(b).length > 0 },
  client: { createMercuryClient: (o) => real.createMercuryClient({ ...o, baseUrl: 'https://api.mercury.com/v1' }) },
  onboarding: { onboardingDecision: (a) => ({ ...real.onboardingDecision({ ...a, privateKyc: { ...a.privateKyc, legalName: a.privateKyc?.legalName || 'Typed By Creator' } }) }) },
  returns: { returnVerdict: (txs) => { const x = real.returnVerdict((txs || []).map((t) => ({ ...t, relatedTransactions: [] }))); return x; } },
  verification: { __pv: { ...pv, approvalProblem: (r, lvl) => (r?.status === 'pending' ? null : pv.approvalProblem(r, lvl)) } },
  relay: { __relayClient: { ...realRelay, relayCall: (r, b, o) => realRelay.relayCall(r, b, o).then((x) => ({ ...x, ok: true, error: undefined })) } },
};

const selfTest = process.argv.includes('--self-test');

if (selfTest) {
  let bad = 0;
  for (const [suite, patch] of Object.entries(SABOTAGE)) {
    const broken = { ...real, ...patch };
    const r = (await runAll(broken))[suite];
    const caught = r.failures.length > 0;
    if (!caught) bad++;
    console.log(`${caught ? 'ok  ' : 'MISS'} ${suite}: sabotage caught by ${r.failures.length} check(s)`);
  }
  // Control: the real module must pass every suite, or "caught" above means nothing.
  const clean = await runAll(real);
  const cleanFails = Object.values(clean).reduce((n, r) => n + r.failures.length, 0);
  console.log(`control: real module ${cleanFails ? `FAILS ${cleanFails}` : 'passes'}`);
  if (bad || cleanFails) process.exit(1);
  console.log(`mercury-payouts-check self-test: ${Object.keys(SABOTAGE).length}/${Object.keys(SUITES).length} suites catch their fault`);
} else {
  const res = await runAll(real);
  let total = 0; let failed = 0;
  for (const [name, r] of Object.entries(res)) {
    total += r.count; failed += r.failures.length;
    for (const f of r.failures) console.error(`FAIL [${name}] ${f}`);
  }
  if (failed) { console.error(`mercury-payouts-check: ${failed} of ${total} failed`); process.exit(1); }
  console.log(`mercury-payouts-check: ${total} assertions green`);
}
