// Mercury payout client — build step 1 of docs/launch/creator-payouts-flow.md.
//
// PURE BY DESIGN. This file imports nothing from firebase, reads no secret and
// touches no database, so it loads and runs under plain `node` and every rule in
// it is testable with no API token (scripts/mercury-payouts-check.mjs). It also
// means creatorPayouts.js can require it without a load cycle.
//
// What lives here: every decision about Mercury's shapes (amount conversion,
// tax-form classification, payment method, response classification, the name
// match) plus a thin HTTP client that takes its fetch as an argument.
// What does NOT live here: Firestore writes, the statement state machine's
// persistence, and anything that decides WHETHER a creator is payable. That is
// `blockingReason()` in creatorPayouts.js and stays there.
//
// Shapes verified against docs.mercury.com/reference on 2026-09-24:
//   POST /recipients/invites                       -> 201, invite
//   GET  /recipients/invites/{inviteId}            -> invite
//   GET  /recipient/{recipientId}                  -> recipient
//   GET  /accounts                                 -> { accounts: [...] }
//   POST /account/{accountId}/request-send-money   -> 200, approval request
//   GET  /request-send-money/{requestId}           -> approval request
//
// ⚠ Creators are INDEPENDENT SUPPLIERS paid a share of Vergr's revenue
// (ToS §11.1, docs/REVENUE_SHARE_PLAN.md §1.4). That is why every wire carries
// purpose category `contractor`. Do not re-characterise it.

const MERCURY_API_BASE = 'https://api.mercury.com/api/v1';

/**
 * The name Mercury shows the creator on its onboarding page ("... is requesting
 * your payment details"). MIRRORS OPERATOR.legalName in
 * src/screens/marketing/legal/legalContent.js, which is the one place the
 * company name is decided. functions/ cannot import that ESM file, so
 * scripts/mercury-payouts-check.mjs fails the build if the two ever differ.
 */
const OPERATOR_LEGAL_NAME = 'Vergr LLC';

/** An unexpired invite is reused only if it has at least this long left. */
const INVITE_REUSE_MIN_REMAINING_MS = 60 * 60 * 1000;
/** A second tap within this window is told setup is already starting. */
const INVITE_CREATE_LOCK_MS = 60 * 1000;

/** Same unit as creatorPayouts.js. Duplicated, not imported, to keep this file pure. */
const MICRO_USD = 1_000_000;
const MICRO_PER_CENT = 10_000;

/**
 * Countries Mercury will not send to (Mercury help centre, read 2026-09-23).
 * WIDER than Vergr's own sanctioned list in geo.js: MM, SD and YE are
 * additions. Checked at ONBOARDING so a creator learns on day one, not after
 * accruing a balance that cannot reach them.
 *
 * ⚠ Mercury also refuses "sanctioned regions of Ukraine". A region cannot be
 * expressed as an ISO country code and blocking all of UA would refuse people
 * Mercury would pay, so it is NOT here. A wire to one of those regions surfaces
 * as a rejected request and is reversed like any other.
 */
const MERCURY_BLOCKED_COUNTRIES = new Set(['BY', 'CU', 'IR', 'KP', 'MM', 'RU', 'SD', 'SY', 'VE', 'YE']);

/** Mercury `attachments[].formType` -> the value `applyPartnerAccountState` already accepts. */
const TAX_FORM_TYPES = { w9: 'W-9', w8BEN: 'W-8BEN', w8BENE: 'W-8BEN-E' };

/** Forms that only an entity files, and only an individual files. W-9 is either. */
const ENTITY_ONLY_FORMS = new Set(['W-8BEN-E']);
const INDIVIDUAL_ONLY_FORMS = new Set(['W-8BEN']);

// ── Amounts ───────────────────────────────────────────────────────────

/**
 * Split a micro-USD payable into what we send (whole cents) and what rolls over.
 *
 * Mercury's `amount` is a USD double. The ledger is micro-USD. Converting with
 * a float divide and letting the result stand would let floating point decide
 * what a creator is paid, so the conversion goes through INTEGER cents and
 * rounds DOWN: Vergr never sends a fraction of a cent it did not debit. The
 * sub-cent remainder is not lost, it carries into the next run exactly as a
 * balance under the $100 minimum does. Step 5 must therefore reserve
 * `sendMicroUsd`, not the whole payable.
 */
function splitPayable(microUsd) {
  if (!Number.isSafeInteger(microUsd) || microUsd < 0) {
    throw new Error(`splitPayable: expected a non-negative integer micro-USD amount, got ${microUsd}`);
  }
  const cents = Math.floor(microUsd / MICRO_PER_CENT);
  const sendMicroUsd = cents * MICRO_PER_CENT;
  return { cents, sendMicroUsd, carryMicroUsd: microUsd - sendMicroUsd, amount: centsToAmount(cents) };
}

/** Integer cents -> the dollar number Mercury expects. Asserts it round-trips. */
function centsToAmount(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error(`centsToAmount: expected non-negative integer cents, got ${cents}`);
  }
  const amount = Number((cents / 100).toFixed(2));
  if (Math.round(amount * 100) !== cents) {
    throw new Error(`centsToAmount: ${cents} cents did not round-trip (got ${amount})`);
  }
  return amount;
}

/** The statement doc id, reused as the idempotency key so a retry cannot double-pay. */
function idempotencyKeyFor(runId, uid) {
  if (!runId || !uid) throw new Error('idempotencyKeyFor: runId and uid are both required');
  return `${runId}__${uid}`;
}

// ── Country + payment method ──────────────────────────────────────────

function normCountry(country) {
  const c = String(country || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

/**
 * ACH for a US account, an international wire for everyone else.
 *
 * Throws on an unreadable country rather than guessing: sending a US account an
 * international wire, or the reverse, fails at the bank days later.
 *
 * ⚠ US territories (PR, GU, VI, AS, MP) have their own ISO codes and therefore
 * get `internationalWire` here. Whether Mercury ACHs to a territory bank is not
 * established; revisit if a creator there ever onboards.
 */
function paymentMethodFor(country) {
  const c = normCountry(country);
  if (!c) throw new Error(`paymentMethodFor: unreadable country "${country}"`);
  return c === 'US' ? 'ach' : 'internationalWire';
}

/** Null when Mercury can pay this country, else a reason code the screen can render. */
function mercuryCountryBlock(country) {
  const c = normCountry(country);
  if (!c) return 'country_unknown';
  return MERCURY_BLOCKED_COUNTRIES.has(c) ? 'mercury_unsupported_country' : null;
}

// ── Request bodies ────────────────────────────────────────────────────

/**
 * `POST /recipients/invites`. `sendEmail: false` is what makes it white-label:
 * no Mercury email reaches the creator, the app opens `onboardingUrl` itself.
 *
 * `organizationName` is a parameter, not a literal, because the company name
 * has ONE home (OPERATOR in legalContent.js) and must never be hardcoded.
 * `contactEmail` must come from functions/authEmails.js, never users/{uid},
 * which no longer carries an email.
 */
function buildRecipientInvite({ contactEmail, legalName, country, organizationName }) {
  if (!contactEmail || !String(contactEmail).includes('@')) {
    throw new Error('buildRecipientInvite: contactEmail is required (read it through authEmails.js)');
  }
  const name = String(legalName || '').trim();
  if (!name) throw new Error('buildRecipientInvite: the verified legal name is required');
  if (!organizationName) throw new Error('buildRecipientInvite: organizationName is required');
  const block = mercuryCountryBlock(country);
  if (block) throw new Error(`buildRecipientInvite: ${block} (${country})`);
  return {
    contactEmail: String(contactEmail).trim(),
    name,
    paymentMethods: [paymentMethodFor(country)],
    requireTaxDocument: true,
    sendEmail: false,
    organizationNameOnRequest: organizationName,
  };
}

/**
 * `POST /account/{accountId}/request-send-money`.
 *
 * Wires need `purpose`; ACH does not take one. `chargeType` is set to `shared`
 * on EVERY international wire, deliberately: Mercury documents that omitting it
 * on a USD international wire defaults to `ours`, a silent $15 per payout. We
 * cannot know at request time whether the recipient's bank is USD (currency
 * follows the recipient's own bank details), so it is always sent. ToS §8.6
 * already tells creators their own bank's charges are theirs.
 */
function buildSendMoneyRequest({ recipientId, cents, paymentMethod, idempotencyKey, legalName }) {
  if (!recipientId) throw new Error('buildSendMoneyRequest: recipientId is required');
  if (!idempotencyKey) throw new Error('buildSendMoneyRequest: idempotencyKey is required');
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error(`buildSendMoneyRequest: cents must be a positive integer, got ${cents}`);
  }
  if (paymentMethod !== 'ach' && paymentMethod !== 'internationalWire') {
    throw new Error(`buildSendMoneyRequest: unsupported paymentMethod "${paymentMethod}"`);
  }
  const body = { recipientId, amount: centsToAmount(cents), paymentMethod, idempotencyKey };
  if (paymentMethod === 'internationalWire') {
    const name = String(legalName || '').trim();
    if (!name) throw new Error('buildSendMoneyRequest: legalName is required on a wire');
    body.purpose = { simple: { category: 'contractor', additionalInfo: name.slice(0, 140) } };
    body.chargeType = 'shared';
  }
  return body;
}

// ── Response classification ──────────────────────────────────────────

/**
 * Classify a `request-send-money` HTTP result.
 *
 *   accepted     200/201, or 409. Statement -> `queued`.
 *   retry_later  400 naming a duplicate: same recipient, account and amount
 *                inside 24h, even under a new key. Not a failure; next run.
 *   failed       anything else. Statement -> `failed`, human reconciles, and
 *                the payable is deliberately NOT re-credited: a timeout cannot
 *                be told apart from an accepted payment.
 *
 * ⚠ UNVERIFIED on this endpoint: the 409-means-already-accepted rule and the
 * 24h duplicate guard are documented on `createTransaction`. The
 * request-send-money reference lists only 200 / 400 / 404. Both are handled as
 * the spec says; confirm with a deliberate repeat call before trusting either.
 * A 409 whose body has no requestId is still accepted but flagged
 * `needsLookup`, so the caller finds it via List send money approval requests
 * rather than leaving a queued statement it can never reconcile.
 */
function classifySendResponse(httpStatus, body) {
  const b = body && typeof body === 'object' ? body : {};
  const requestId = b.requestId || null;
  if (httpStatus === 200 || httpStatus === 201 || httpStatus === 409) {
    return {
      outcome: 'accepted',
      requestId,
      mercuryStatus: b.status || null,
      needsLookup: !requestId,
      replayed: httpStatus === 409,
    };
  }
  if (httpStatus === 400 && /duplicate/i.test(errorText(b))) {
    return { outcome: 'retry_later', reason: 'duplicate_within_24h', requestId: null };
  }
  return { outcome: 'failed', reason: `http_${httpStatus}`, detail: errorText(b).slice(0, 500), requestId };
}

function errorText(b) {
  if (!b || typeof b !== 'object') return String(b || '');
  const parts = [b.message, b.error, b.errors && JSON.stringify(b.errors)].filter(Boolean);
  return parts.length ? parts.join(' ') : JSON.stringify(b);
}

/**
 * Mercury approval status -> statement transition.
 *   pendingApproval  -> null  (leave it `queued`)
 *   approved         -> 'paid'      (NOW increment successfulPayouts, set
 *                                    firstPayoutAt, send "You have been paid")
 *   rejected         -> 'reversed'  (re-credit owedMicroUsd)
 *   cancelled        -> 'reversed'
 * Anything unrecognised -> 'unknown', which the caller surfaces and never acts on.
 *
 * ⚠ `approved` is not the end: a wire can still be RETURNED by the receiving
 * bank and this status never changes when it is. That needs the second
 * reconciliation layer over Fetch Transactions (build step 6).
 */
function statementTransitionFor(mercuryStatus) {
  switch (mercuryStatus) {
    case 'pendingApproval': return null;
    case 'approved': return 'paid';
    case 'rejected':
    case 'cancelled': return 'reversed';
    default: return 'unknown';
  }
}

/** Invite -> { status, recipientId, onboardingUrl, expiresAtMs }. */
function inviteState(invite) {
  const status = ['created', 'completed', 'expired'].includes(invite?.status) ? invite.status : 'unknown';
  const expiresAtMs = invite?.expiresAt ? Date.parse(invite.expiresAt) : null;
  return {
    status,
    inviteId: invite?.id || null,
    recipientId: status === 'completed' ? (invite?.recipientId || null) : null,
    onboardingUrl: invite?.onboardingUrl || null,
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
  };
}

// ── Tax form ──────────────────────────────────────────────────────────

/**
 * Mercury's classification of the tax document -> `taxFormStatus` + `taxFormType`.
 *
 * Only the NEWEST attachment counts: a creator whose first upload was
 * unreadable re-uploads, and the re-upload is the one that stands. If the newest
 * is `unknown`, an older readable form is NOT used, because we cannot tell which
 * one the creator intends to be current. Fails closed.
 *
 * Also fails closed when the form contradicts `isBusiness`: a W-8BEN-E from an
 * individual or a W-8BEN from a business is the wrong form, and paying against
 * it documents the wrong tax status.
 *
 * `on_file` is the ONLY value `blockingReason()` treats as payable.
 */
function taxFormVerdict(recipient) {
  const atts = Array.isArray(recipient?.attachments) ? recipient.attachments : [];
  if (!atts.length) return { taxFormStatus: 'submitted', taxFormType: null, reason: 'no_attachment' };

  const newest = [...atts].sort((a, b) => (Date.parse(b?.uploadedAt) || 0) - (Date.parse(a?.uploadedAt) || 0))[0];
  const taxFormType = TAX_FORM_TYPES[newest?.formType] || null;
  if (!taxFormType) return { taxFormStatus: 'submitted', taxFormType: null, reason: 'unreadable_form' };

  if (recipient?.isBusiness === false && ENTITY_ONLY_FORMS.has(taxFormType)) {
    return { taxFormStatus: 'submitted', taxFormType, reason: 'form_does_not_match_individual' };
  }
  if (recipient?.isBusiness === true && INDIVIDUAL_ONLY_FORMS.has(taxFormType)) {
    return { taxFormStatus: 'submitted', taxFormType, reason: 'form_does_not_match_business' };
  }
  return { taxFormStatus: 'on_file', taxFormType, reason: null };
}

// ── Name match (AML) ─────────────────────────────────────────────────

function nameTokens(name) {
  return String(name || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/['-]/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Does the name on the bank account belong to the Didit-verified person?
 *
 * Paying an account in someone else's name is exactly the hole the KYC gate
 * exists to close, and both names are already in hand, so this costs nothing.
 *
 * Tolerant of: word order ("ASHTON DAMIEN"), case, accents, punctuation, and a
 * bank that drops middle names. NOT tolerant of anything else: the bank's words
 * must all appear in the verified name, there must be at least two of them, and
 * both the verified first AND last name must be among them. Initials, nicknames
 * and a business-named account all come back `mismatch`, which is a review, not
 * a ban: a human looks at it.
 */
function nameMatches(bankName, verifiedName) {
  const bank = nameTokens(bankName);
  const verified = nameTokens(verifiedName);
  if (bank.length < 2 || verified.length < 2) return false;
  const pool = [...verified];
  for (const t of bank) {
    const i = pool.indexOf(t);
    if (i === -1) return false;
    pool.splice(i, 1);
  }
  return bank.includes(verified[0]) && bank.includes(verified[verified.length - 1]);
}

/**
 * Everything Vergr learns from a completed recipient, as the fields to write
 * onto payout_accounts/{uid}. `partnerPayeeId` is set ONLY when the recipient
 * is active, the country is payable and the name matches; otherwise it is null
 * and the creator stays blocked at `payout_account_required`.
 *
 * `verifiedLegalName` is passed in rather than read here, so this file never
 * needs to know the shape of users/{uid}.kyc.
 */
function recipientVerdict(recipient, verifiedLegalName) {
  if (!recipient || recipient.status === 'deleted') {
    return { partnerPayeeId: null, recipientDeleted: true, notPayableReason: 'recipient_deleted' };
  }
  const country = normCountry(recipient.address?.country);
  const tax = taxFormVerdict(recipient);
  const nameMatch = nameMatches(recipient.name, verifiedLegalName) ? 'ok' : 'mismatch';
  const countryBlock = mercuryCountryBlock(country);
  // Only the two methods buildSendMoneyRequest can send. The invite offers one,
  // so anything else means the recipient was edited in the dashboard.
  const method = recipient.defaultPaymentMethod;
  const methodOk = method === 'ach' || method === 'internationalWire';
  // First failing reason wins, in the order a human should fix them.
  const notPayableReason = recipient.status !== 'active' ? 'recipient_inactive'
    : nameMatch !== 'ok' ? 'name_mismatch'
      : countryBlock ? countryBlock
        : !methodOk ? 'unsupported_payment_method'
          : null;
  const payable = !notPayableReason;
  return {
    notPayableReason,
    partnerPayeeId: payable ? recipient.id : null,
    taxFormStatus: tax.taxFormStatus,
    taxFormType: tax.taxFormType,
    taxFormReason: tax.reason,
    legalName: recipient.name || null,
    country,
    countryBlock,
    mercuryPaymentMethod: recipient.defaultPaymentMethod || null,
    isBusiness: recipient.isBusiness ?? null,
    nameMatch,
    recipientDeleted: false,
  };
}

// ── Onboarding decision ──────────────────────────────────────────────

/**
 * Decide what "connect my payout account" should do, from data already read.
 *
 * Returns one of:
 *   { action: 'refuse', reason }
 *   { action: 'connected' }                                 already has a payee
 *   { action: 'reuse', onboardingUrl, expiresAtMs }         live invite exists
 *   { action: 'create', legalName, country, verifiedCountry }
 *
 * Inputs:
 *   account      payout_accounts/{uid}
 *   userData     users/{uid}            (kycLevel, profile country)
 *   privateKyc   users/{uid}/private/kyc (legalName, country; server-written)
 *   blocked      the Vergr sanctioned set (geo.js BLOCKED_COUNTRIES)
 *
 * The verified name comes ONLY from Didit's result. A creator cannot type it:
 * it is the name the bank account must match (recipientVerdict), so letting
 * the creator choose it would make the match meaningless.
 *
 * The PAYMENT METHOD follows the profile country (where they live, so where
 * their bank most likely is), falling back to the ID country. Both countries
 * are checked against both block lists.
 */
function onboardingDecision({ account, userData, privateKyc, blocked, now = Date.now() }) {
  const acc = account || {};
  if (!acc.enrolled) return { action: 'refuse', reason: 'not_enrolled' };
  if (Number(userData?.kycLevel || 0) < 1) return { action: 'refuse', reason: 'kyc_required' };
  if (acc.frozen) return { action: 'refuse', reason: 'frozen' };
  if (acc.nameMatch === 'mismatch') return { action: 'refuse', reason: 'name_mismatch_review' };
  if (acc.partnerPayeeId) return { action: 'connected' };

  const legalName = String(privateKyc?.legalName || '').trim();
  if (!legalName) return { action: 'refuse', reason: 'verified_name_missing' };

  const profileCountry = normCountry(userData?.country);
  const verifiedCountry = normCountry(privateKyc?.country);
  const countries = [profileCountry, verifiedCountry].filter(Boolean);
  if (!countries.length) return { action: 'refuse', reason: 'country_unknown' };
  const blockedSet = blocked instanceof Set ? blocked : new Set(blocked || []);
  if (countries.some((c) => blockedSet.has(c))) return { action: 'refuse', reason: 'sanctioned_country' };
  if (countries.some((c) => mercuryCountryBlock(c))) return { action: 'refuse', reason: 'mercury_unsupported_country' };

  const expiresAtMs = tsToMs(acc.mercuryInviteExpiresAt);
  if (acc.mercuryInviteStatus === 'created' && acc.mercuryInviteUrl
    && expiresAtMs && expiresAtMs - now > INVITE_REUSE_MIN_REMAINING_MS) {
    return { action: 'reuse', onboardingUrl: acc.mercuryInviteUrl, expiresAtMs };
  }
  const pendingAt = tsToMs(acc.mercuryInvitePendingAt);
  if (pendingAt && now - pendingAt < INVITE_CREATE_LOCK_MS) return { action: 'refuse', reason: 'in_progress' };

  return { action: 'create', legalName, country: profileCountry || verifiedCountry, verifiedCountry };
}

function tsToMs(t) {
  if (!t) return null;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t === 'number') return t;
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

// ── Returned payments (build step 6) ─────────────────────────────────

/**
 * An APPROVED request can still come back: the receiving bank returns a wire
 * days later. The approval request keeps saying `approved` forever, so the only
 * evidence is the transaction Mercury created for it, found by filtering the
 * account's transactions on our `requestId`.
 *
 * Transaction status enum (docs.mercury.com, 2026-09-24):
 *   pending | sent | cancelled | failed | reversed | blocked
 * relatedTransactions[].relationKind includes OriginalTransactionToReturn and
 * FailedPaymentToPaymentRefund, the two that mean "this payment came back".
 */
const RETURNED_STATUSES = new Set(['cancelled', 'failed', 'reversed', 'blocked']);
const RETURN_RELATION_KINDS = new Set(['OriginalTransactionToReturn', 'FailedPaymentToPaymentRefund']);

/**
 * Classify the transactions Mercury linked to one request.
 *   none       no transaction yet (just approved, or not found)
 *   in_flight  pending
 *   delivered  sent, with no return attached
 *   returned   failed / cancelled / reversed / blocked, or a return is linked
 * `returned` wins over everything: one returned transaction means the money came
 * back, whatever else the list says.
 */
function returnVerdict(transactions) {
  const txs = Array.isArray(transactions) ? transactions.filter(Boolean) : [];
  if (!txs.length) return { state: 'none', reason: null, transactionId: null };
  for (const t of txs) {
    if (RETURNED_STATUSES.has(t.status)) {
      return { state: 'returned', reason: `transaction_${t.status}`, transactionId: t.id || null, detail: t.reasonForFailure || null };
    }
    const rel = (Array.isArray(t.relatedTransactions) ? t.relatedTransactions : [])
      .find((r) => RETURN_RELATION_KINDS.has(r?.relationKind));
    if (rel) return { state: 'returned', reason: `related_${rel.relationKind}`, transactionId: t.id || null, detail: null };
  }
  if (txs.some((t) => t.status === 'sent')) {
    return { state: 'delivered', reason: null, transactionId: (txs.find((t) => t.status === 'sent') || {}).id || null };
  }
  return { state: 'in_flight', reason: null, transactionId: txs[0].id || null };
}

/** YYYY-MM-DD for Mercury's `start` filter, which otherwise defaults to 30 days back. */
function mercuryDate(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) throw new Error(`mercuryDate: bad time ${ms}`);
  return d.toISOString().slice(0, 10);
}

/** `GET /accounts` returns recipients' accounts too. Keep only our own. */
function mercuryAccounts(body) {
  return (Array.isArray(body?.accounts) ? body.accounts : []).filter((a) => a?.type === 'mercury');
}

// ── HTTP client ───────────────────────────────────────────────────────

/**
 * Thin client. `fetchImpl` is injected so the guard can drive it with no token
 * and no network. Returns `{ status, body }` and NEVER throws on an HTTP error
 * status: classification is the caller's job, through the functions above,
 * because a 409 is a success and a thrown error would hide that.
 *
 * Which token calls what (docs/launch/creator-payouts-flow.md §3.3):
 *   Cloud Functions token (no IP allowlist): getAccounts, getRecipient,
 *     getRecipientInvite, requestSendMoney, getSendMoneyRequest.
 *   Box 1 token (IP allowlisted, asterisked scopes): createRecipientInvite.
 */
function createMercuryClient({ token, fetchImpl = globalThis.fetch, baseUrl = MERCURY_API_BASE } = {}) {
  if (!token) throw new Error('createMercuryClient: token is required');
  if (typeof fetchImpl !== 'function') throw new Error('createMercuryClient: no fetch available');

  async function call(method, path, body) {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text.slice(0, 500) }; }
    return { status: res.status, body: parsed };
  }

  const seg = (v, what) => {
    if (!v) throw new Error(`mercury: ${what} is required`);
    return encodeURIComponent(v);
  };

  return {
    getAccounts: () => call('GET', '/accounts'),
    getRecipient: (id) => call('GET', `/recipient/${seg(id, 'recipientId')}`),
    getRecipientInvite: (id) => call('GET', `/recipients/invites/${seg(id, 'inviteId')}`),
    createRecipientInvite: (body) => call('POST', '/recipients/invites', body),
    requestSendMoney: (accountId, body) => call('POST', `/account/${seg(accountId, 'accountId')}/request-send-money`, body),
    getSendMoneyRequest: (id) => call('GET', `/request-send-money/${seg(id, 'requestId')}`),
    /** Transactions Mercury created for one send request. `start` is YYYY-MM-DD. */
    listTransactionsForRequest: (accountId, requestId, start) => {
      const q = new URLSearchParams({ requestId: String(requestId || ''), limit: '50' });
      if (!requestId) throw new Error('mercury: requestId is required');
      if (start) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error('mercury: start must be YYYY-MM-DD');
        q.set('start', start);
      }
      return call('GET', `/account/${seg(accountId, 'accountId')}/transactions?${q}`);
    },
  };
}

module.exports = {
  MERCURY_API_BASE,
  OPERATOR_LEGAL_NAME,
  INVITE_REUSE_MIN_REMAINING_MS,
  INVITE_CREATE_LOCK_MS,
  onboardingDecision,
  returnVerdict,
  mercuryDate,
  RETURNED_STATUSES,
  RETURN_RELATION_KINDS,
  MERCURY_BLOCKED_COUNTRIES,
  MICRO_USD,
  TAX_FORM_TYPES,
  splitPayable,
  centsToAmount,
  idempotencyKeyFor,
  paymentMethodFor,
  mercuryCountryBlock,
  buildRecipientInvite,
  buildSendMoneyRequest,
  classifySendResponse,
  statementTransitionFor,
  inviteState,
  taxFormVerdict,
  nameMatches,
  recipientVerdict,
  mercuryAccounts,
  createMercuryClient,
};
