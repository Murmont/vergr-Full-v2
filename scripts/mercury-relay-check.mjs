// Guard for infra/mercury-relay/server.cjs (creator payouts, build step 2).
//
//   node scripts/mercury-relay-check.mjs
//
// Starts the REAL relay handler on a localhost port, with a fake Mercury and a
// throwaway RSA key standing in for Google's. No network, no token, no box 1.
//
// Every refusal is paired with a CONTROL: the same request, changed in exactly
// one thing, that must SUCCEED. A refusal check with no control can pass because
// everything is refused, which proves nothing.

import { createRequire } from 'node:module';
import http from 'node:http';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const { createRelay, fetchV4Factory } = require('../infra/mercury-relay/server.cjs');

const AUD = 'https://sfu.vergr.app/payouts';
const SA = 'fn@vergr-44494.iam.gserviceaccount.com';
const TOKEN_A = 'secret-token:mercury_production_AAAA_test';
const ACCOUNT = 'acct-from-config';

const google = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const forger = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...google.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(over = {}, { key = google.privateKey, header = {} } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = { alg: 'RS256', kid: 'k1', typ: 'JWT', ...header };
  const c = { iss: 'https://accounts.google.com', aud: AUD, email: SA, email_verified: true, iat: now, exp: now + 3600, ...over };
  const signing = `${b64(h)}.${b64(c)}`;
  const sig = h.alg === 'none' ? '' : crypto.sign('RSA-SHA256', Buffer.from(signing), key).toString('base64url');
  return `${signing}.${sig}`;
}

const mercuryCalls = [];
async function fakeMercury(url, init) {
  mercuryCalls.push({ url, init });
  const path = new URL(url).pathname;
  let body = { ok: true };
  if (path.endsWith('/accounts')) body = { accounts: [{ id: 'a', type: 'mercury' }] };
  if (path.endsWith('/request-send-money')) body = { requestId: 'q1', status: 'pendingApproval' };
  return { status: 200, text: async () => JSON.stringify(body) };
}

const logs = [];
function start(configOver = {}) {
  const handler = createRelay({
    config: { tokenA: TOKEN_A, tokenB: null, payoutAccountId: ACCOUNT, audience: AUD, allowedServiceAccounts: [SA], ...configOver },
    mercuryFetch: fakeMercury,
    fetchJwks: async () => ({ keys: [jwk] }),
    log: (l) => logs.push(l),
  });
  return new Promise((resolve) => {
    const srv = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function call(srv, path, { method = 'POST', token, body, raw } = {}) {
  const { port } = srv.address();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers, body: method === 'GET' ? undefined : (raw ?? JSON.stringify(body ?? {})),
  });
  let json = null;
  try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
}

let total = 0;
const failures = [];
const check = (cond, label) => { total++; if (!cond) failures.push(label); };

const srv = await start();
const good = idToken();

// Health
let r = await call(srv, '/payouts/healthz', { method: 'GET' });
check(r.status === 200 && r.json.tokenA === true && r.json.tokenB === false && r.json.payoutAccount === true, 'healthz reports config without values');
check(!JSON.stringify(r.json).includes(TOKEN_A), 'healthz never contains a token');

// Control: a correct token works.
let before = mercuryCalls.length;
r = await call(srv, '/payouts/v1/accounts', { token: good });
check(r.status === 200 && r.json.body.accounts.length === 1, 'CONTROL: valid Google token reaches Mercury');
check(mercuryCalls.length === before + 1, 'CONTROL: exactly one Mercury call');
check(mercuryCalls.at(-1).init.headers.Authorization === `Bearer ${TOKEN_A}`, 'Mercury is called with token A');
check(mercuryCalls.at(-1).url === 'https://api.mercury.com/api/v1/accounts', 'Mercury accounts URL');

// Refusals. Each differs from `good` in ONE thing.
const refusals = [
  ['no token', undefined],
  ['garbage token', 'abc.def'],
  ['signed by another key', idToken({}, { key: forger.privateKey })],
  ['alg none', idToken({}, { header: { alg: 'none' } })],
  ['unknown kid', idToken({}, { header: { kid: 'k9' } })],
  ['wrong audience', idToken({ aud: 'https://evil.example' })],
  ['wrong issuer', idToken({ iss: 'https://evil.example' })],
  ['expired', idToken({ exp: Math.floor(Date.now() / 1000) - 3600 })],
  ['issued in the future', idToken({ iat: Math.floor(Date.now() / 1000) + 3600 })],
  ['service account not allowed', idToken({ email: 'other@x.iam.gserviceaccount.com' })],
  ['email not verified', idToken({ email_verified: false })],
];
for (const [label, tok] of refusals) {
  before = mercuryCalls.length;
  r = await call(srv, '/payouts/v1/accounts', { token: tok });
  check(r.status === 401, `refused: ${label}`);
  check(mercuryCalls.length === before, `no Mercury call on: ${label}`);
}

// Control for the allow list: the refused email passes once it is allowed,
// proving the refusal came from the list and not from something else.
const srvAllow = await start({ allowedServiceAccounts: [SA, 'other@x.iam.gserviceaccount.com'] });
r = await call(srvAllow, '/payouts/v1/accounts', { token: idToken({ email: 'other@x.iam.gserviceaccount.com' }) });
check(r.status === 200, 'CONTROL: allow list is what decides the caller');
srvAllow.close();

// Tampering with claims after signing must break the signature.
const [h, , s] = good.split('.');
const tampered = `${h}.${b64({ iss: 'https://accounts.google.com', aud: AUD, email: SA, email_verified: true, exp: 9999999999 })}.${s}`;
r = await call(srv, '/payouts/v1/accounts', { token: tampered });
check(r.status === 401, 'refused: claims edited after signing');

// Send: source account is fixed by config; caller cannot pick it.
before = mercuryCalls.length;
r = await call(srv, '/payouts/v1/send', {
  token: good,
  body: { accountId: 'ATTACKER', recipientId: 'r1', cents: 10000, paymentMethod: 'internationalWire', idempotencyKey: 'run__u1', legalName: 'Damien Ashton' },
});
check(r.status === 200 && r.json.classification.outcome === 'accepted', 'send accepted and classified');
const sent = mercuryCalls.at(-1);
check(sent.url === `https://api.mercury.com/api/v1/account/${ACCOUNT}/request-send-money`, 'send goes FROM the configured account');
check(!sent.url.includes('ATTACKER'), 'caller-supplied accountId is ignored');
const sentBody = JSON.parse(sent.init.body);
check(sentBody.amount === 100 && sentBody.chargeType === 'shared' && sentBody.purpose.simple.category === 'contractor', 'send body built by mercuryPayouts rules');
check(!('accountId' in sentBody), 'no stray fields forwarded to Mercury');

r = await call(srv, '/payouts/v1/send', { token: good, body: { recipientId: 'r1', cents: 0, paymentMethod: 'ach', idempotencyKey: 'k' } });
check(r.status === 400, 'invalid send refused before Mercury');
check(mercuryCalls.length === before + 1, 'no Mercury call for an invalid send');

const srvNoAcct = await start({ payoutAccountId: null });
r = await call(srvNoAcct, '/payouts/v1/send', { token: good, body: { recipientId: 'r1', cents: 100, paymentMethod: 'ach', idempotencyKey: 'k' } });
check(r.status === 503 && r.json.error === 'payout_account_not_configured', 'send refused until the source account is configured');
srvNoAcct.close();

// Invite needs token B, which does not exist yet.
before = mercuryCalls.length;
r = await call(srv, '/payouts/v1/invites/create', { token: good, body: { contactEmail: 'c@x.co', legalName: 'A B', country: 'US', organizationName: 'O' } });
check(r.status === 503 && r.json.error === 'token_b_missing', 'invite refused without token B');
check(mercuryCalls.length === before, 'no Mercury call without token B');
const srvB = await start({ tokenB: 'secret-token:BBBB' });
r = await call(srvB, '/payouts/v1/invites/create', { token: good, body: { contactEmail: 'c@x.co', legalName: 'A B', country: 'US', organizationName: 'O' } });
check(r.status === 200 && mercuryCalls.at(-1).init.headers.Authorization === 'Bearer secret-token:BBBB', 'CONTROL: invite uses token B once present');
check(JSON.parse(mercuryCalls.at(-1).init.body).sendEmail === false, 'invite is white-label');
r = await call(srvB, '/payouts/v1/invites/create', { token: good, body: { contactEmail: 'c@x.co', legalName: 'A B', country: 'YE', organizationName: 'O' } });
check(r.status === 400, 'invite refused for a Mercury-blocked country');
srvB.close();

// Transactions (read only): default account, caller may name another, bad id refused.
before = mercuryCalls.length;
r = await call(srv, '/payouts/v1/transactions', { token: good, body: { requestId: 'req-1', start: '2026-09-01' } });
const tu = new URL(mercuryCalls.at(-1).url);
check(r.status === 200 && tu.pathname === `/api/v1/account/${ACCOUNT}/transactions`, 'transactions default to the payout account');
check(tu.searchParams.get('requestId') === 'req-1' && tu.searchParams.get('start') === '2026-09-01', 'transactions filtered by requestId + start');
check(mercuryCalls.at(-1).init.method === 'GET', 'transactions route is a GET to Mercury');
const OTHER = '11111111-2222-3333-4444-555555555555';
r = await call(srv, '/payouts/v1/transactions', { token: good, body: { requestId: 'req-1', accountId: OTHER } });
check(r.status === 200 && mercuryCalls.at(-1).url.includes(`/account/${OTHER}/transactions`), 'an older account can be READ');
before = mercuryCalls.length;
r = await call(srv, '/payouts/v1/transactions', { token: good, body: { requestId: 'req-1', accountId: '../accounts' } });
check(r.status === 400 && mercuryCalls.length === before, 'a malformed account id is refused before Mercury');
r = await call(srv, '/payouts/v1/transactions', { token: good, body: { requestId: 'req-1', start: 'yesterday' } });
check(r.status === 400, 'a malformed start date is refused');
r = await call(srv, '/payouts/v1/transactions', { body: { requestId: 'req-1' } });
check(r.status === 401, 'transactions need a caller token too');

// Routing and body handling.
r = await call(srv, '/payouts/v1/accounts', { method: 'GET', token: good });
check(r.status === 404, 'GET on an action route is refused');
for (const bad of ['constructor', '__proto__', 'toString', 'nope']) {
  r = await call(srv, `/payouts/v1/${bad}`, { token: good });
  check(r.status === 404, `unknown route refused: ${bad}`);
}
r = await call(srv, '/payouts/v1/recipient', { token: good, raw: '{not json' });
check(r.status === 400, 'bad JSON refused');
r = await call(srv, '/payouts/v1/recipient', { token: good, raw: JSON.stringify({ recipientId: 'x'.repeat(20000) }) });
check(r.status === 413, 'oversized body refused');
r = await call(srv, '/payouts/v1/recipient', { token: good, body: {} });
check(r.status === 400, 'missing recipientId refused');

// Nothing sensitive in the logs.
const allLogs = logs.join('\n');
check(!allLogs.includes(TOKEN_A) && !allLogs.includes('BBBB'), 'logs never contain a Mercury token');
check(!allLogs.includes(good.split('.')[2]), 'logs never contain the caller token');
check(!allLogs.includes('c@x.co') && !allLogs.includes('Damien'), 'logs never contain an email or a name');

srv.close();

// Transport: every Mercury call is forced over IPv4.
const seen = [];
const fakeHttps = {
  request(opts, cb) {
    seen.push(opts);
    const res = { statusCode: 200, on(ev, fn) { if (ev === 'data') fn(Buffer.from('{}')); if (ev === 'end') fn(); } };
    queueMicrotask(() => cb(res));
    return { on() {}, write() {}, end() {}, destroy() {} };
  },
};
await fetchV4Factory(fakeHttps)('https://api.mercury.com/api/v1/accounts', { headers: { a: 1 } });
check(seen[0]?.family === 4, 'transport forces IPv4 (family 4)');
check(seen[0]?.hostname === 'api.mercury.com' && seen[0]?.path === '/api/v1/accounts', 'transport targets the right host and path');

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`mercury-relay-check: ${failures.length} of ${total} failed`);
  process.exit(1);
}
console.log(`mercury-relay-check: ${total} assertions green`);
