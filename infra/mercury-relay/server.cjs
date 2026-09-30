// vergr-mercury-relay — box 1 (91.98.79.244), 127.0.0.1:8098, behind nginx at
// https://sfu.vergr.app/payouts/.
//
// WHY THIS EXISTS. Mercury only accepts our tokens from a whitelisted IP. Cloud
// Functions have no fixed egress IP; box 1 does. So every Mercury call the payout
// run makes goes through here. Build step 2 of docs/launch/creator-payouts-flow.md,
// widened on 2026-09-24 when Mercury's token modal required an IP for Token A too.
//
// NO SHARED SECRET. The caller (a Cloud Function) sends a Google-signed OIDC
// identity token for its own service account, fetched free from the metadata
// server. This relay verifies Google's RS256 signature, the issuer, the audience,
// expiry and that the service account email is on the allow list. Nothing is
// stored in Secret Manager and there is no password to leak.
//
// WHAT IT WILL NOT DO:
// - let the caller pick the SOURCE account. It is fixed by MERCURY_PAYOUT_ACCOUNT_ID.
// - log a token, an email, or a request body.
// - talk to Mercury over IPv6. The whitelist is IPv4; measured 2026-09-24, box 1
//   defaults to IPv6 and Mercury answers 401 ipNotWhitelisted.
// - cap amounts. Every send lands as `pendingApproval` in the Mercury dashboard,
//   and the founder's approval is the control. A cap would be a financial number
//   nobody has chosen.
//
// CONFIG, /etc/vergr-payouts/mercury.env (root 600, loaded by systemd):
//   MERCURY_TOKEN_A               Custom token, 6 scopes (saved by vergr-set-mercury-token A)
//   MERCURY_TOKEN_B               Create Recipients + Create Recipient Invites (not yet created)
//   MERCURY_PAYOUT_ACCOUNT_ID     the Mercury account payouts are sent FROM. Founder decides.
//   MERCURY_RELAY_AUDIENCE        e.g. https://sfu.vergr.app/payouts
//   MERCURY_RELAY_ALLOWED_SA      comma-separated service account emails
//   PORT                          8098
//   CODA_API_KEY                  Codapay API key (saved by vergr-set-mercury-token CODA)
//   CODA_PROJECT_ID               Codapay project id (from the Coda portal, not a secret)
//   CODA_ENV                      sandbox | production (default sandbox)
//
// CODA. The same relay holds the Codapay key (founder, 2026-09-24: free, on box 1).
// Cloud Functions send the ORDER; the relay adds the key and calls Coda, and
// never returns the key. The completion notification is public (Coda cannot
// send a Google token), so it is verified by Coda's own checksum instead.
//
// INSTALL (not done; needs the founder's go-ahead):
//   scp server.cjs functions/mercuryPayouts.js -> /opt/vergr-mercury-relay/
//   scp vergr-mercury-relay.service -> /etc/systemd/system/
//   add nginx-payouts.conf's block to the sfu.vergr.app server, nginx -t, reload
//   systemctl enable --now vergr-mercury-relay

const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');

let mp;
try { mp = require('./mercuryPayouts.js'); } catch { mp = require('../../functions/mercuryPayouts.js'); }
let coda;
try { coda = require('./codaPay.js'); } catch { coda = require('../../functions/codaPay.js'); }

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const MAX_BODY_BYTES = 16 * 1024;
const CLOCK_SKEW_S = 300;

// ── Transport: Mercury over IPv4, always ─────────────────────────────

/**
 * A minimal fetch over https.request with `family: 4`. Node's global fetch has
 * no per-request address-family option without an extra dependency, and the
 * whitelist is IPv4, so this is the one way out of the box.
 * `mod` is injectable so the guard can prove `family: 4` is actually passed.
 */
function fetchV4Factory(mod = https) {
  return function fetchV4(url, init = {}) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const req = mod.request({
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
        method: init.method || 'GET',
        headers: init.headers || {},
        family: 4,
        timeout: 20_000,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, text: async () => text });
        });
      });
      req.on('timeout', () => req.destroy(new Error('mercury_timeout')));
      req.on('error', reject);
      if (init.body) req.write(init.body);
      req.end();
    });
  };
}

// ── Google OIDC verification ─────────────────────────────────────────

function b64urlJson(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

/** JWKS cache. Refetches on an unknown kid, at most once a minute. */
function jwksCache(fetchJwks) {
  let keys = new Map();
  let fetchedAt = 0;
  return async function keyFor(kid) {
    const now = Date.now();
    if (!keys.has(kid) && now - fetchedAt > 60_000) {
      const jwks = await fetchJwks();
      keys = new Map((jwks?.keys || []).filter((k) => k.kid && k.kty === 'RSA').map((k) => [k.kid, k]));
      fetchedAt = now;
    }
    const jwk = keys.get(kid);
    return jwk ? crypto.createPublicKey({ key: jwk, format: 'jwk' }) : null;
  };
}

/**
 * Returns the verified claims, or throws with a short reason. Every check fails
 * closed; the reason is logged, never returned to the caller in detail.
 */
async function verifyGoogleIdToken(token, { keyFor, audience, allowedEmails, nowS = Math.floor(Date.now() / 1000) }) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed');
  let header; let claims;
  try { header = b64urlJson(parts[0]); claims = b64urlJson(parts[1]); } catch { throw new Error('malformed'); }
  if (header.alg !== 'RS256' || !header.kid) throw new Error('bad_alg');
  const key = await keyFor(header.kid);
  if (!key) throw new Error('unknown_kid');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new Error('bad_signature');
  if (!GOOGLE_ISSUERS.has(claims.iss)) throw new Error('bad_issuer');
  if (claims.aud !== audience) throw new Error('bad_audience');
  if (typeof claims.exp !== 'number' || claims.exp < nowS - CLOCK_SKEW_S) throw new Error('expired');
  if (typeof claims.iat === 'number' && claims.iat > nowS + CLOCK_SKEW_S) throw new Error('future_token');
  if (claims.email_verified !== true || !allowedEmails.includes(claims.email)) throw new Error('caller_not_allowed');
  return claims;
}

// ── The relay ─────────────────────────────────────────────────────────

/**
 * Pure factory: every outside dependency is passed in, so the guard runs the
 * whole relay against a fake Mercury and a fake Google key with no backdoor
 * in the production path.
 */
function createRelay({ config, mercuryFetch, fetchJwks, log = () => {} }) {
  const audience = config.audience;
  const allowedEmails = (config.allowedServiceAccounts || []).filter(Boolean);
  if (!audience) throw new Error('MERCURY_RELAY_AUDIENCE is required');
  if (!allowedEmails.length) throw new Error('MERCURY_RELAY_ALLOWED_SA is required');
  const keyFor = jwksCache(fetchJwks);

  const clientA = config.tokenA ? mp.createMercuryClient({ token: config.tokenA, fetchImpl: mercuryFetch }) : null;
  const codaEnv = config.codaEnv === 'production' ? 'production' : 'sandbox';
  const codaReady = !!(config.codaApiKey && config.codaProjectId);
  const codaPost = async (url, bodyText) => {
    const r = await mercuryFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: bodyText,
    });
    return r.text();
  };
  const clientB = config.tokenB ? mp.createMercuryClient({ token: config.tokenB, fetchImpl: mercuryFetch }) : null;

  const need = (v, what) => { if (!v) { const e = new Error(`${what} is required`); e.http = 400; throw e; } return v; };
  const unavailable = (code) => { const e = new Error(code); e.http = 503; throw e; };

  const routes = {
    async accounts() {
      if (!clientA) unavailable('token_a_missing');
      return clientA.getAccounts();
    },
    async recipient(b) {
      if (!clientA) unavailable('token_a_missing');
      return clientA.getRecipient(need(b.recipientId, 'recipientId'));
    },
    async 'invites/get'(b) {
      if (!clientA) unavailable('token_a_missing');
      return clientA.getRecipientInvite(need(b.inviteId, 'inviteId'));
    },
    async 'invites/create'(b) {
      if (!clientB) unavailable('token_b_missing');
      let body;
      try { body = mp.buildRecipientInvite(b); } catch (e) { e.http = 400; throw e; }
      return clientB.createRecipientInvite(body);
    },
    async send(b) {
      if (!clientA) unavailable('token_a_missing');
      if (!config.payoutAccountId) unavailable('payout_account_not_configured');
      let body;
      try { body = mp.buildSendMoneyRequest(b); } catch (e) { e.http = 400; throw e; }
      const res = await clientA.requestSendMoney(config.payoutAccountId, body);
      log(`send key=${body.idempotencyKey} http=${res.status}`);
      return { ...res, classification: mp.classifySendResponse(res.status, res.body) };
    },
    // CODA: start a hosted payment. Returns { ok, txnId, redirectUrl, resultCode }.
    async 'coda/init'(b) {
      if (!codaReady) unavailable('coda_not_configured');
      let body;
      try {
        body = coda.buildInitBody({
          apiKey: config.codaApiKey, projectId: config.codaProjectId,
          countryNumeric: b.countryNumeric, orderId: b.orderId, uid: b.uid,
          itemName: b.itemName, priceUSD: b.priceUSD, returnUrl: b.returnUrl,
        });
      } catch (e) { e.http = 400; throw e; }
      const text = await codaPost(coda.CODA_URLS[codaEnv].init, JSON.stringify(body));
      const parsed = coda.parseInitResponse(text);
      log(`coda init order=${b.orderId} ok=${parsed.ok} code=${parsed.resultCode}`);
      return { status: 200, body: { ...parsed, env: codaEnv } };
    },
    // CODA: start an EMBEDDED payment for one method, in local currency.
    // Returns { ok, txnId, clientSecret, resultCode }. The client secret is a
    // short-lived session token for Coda's in-page form, not the API key.
    async 'coda/component-init'(b) {
      if (!codaReady) unavailable('coda_not_configured');
      let body;
      try {
        body = coda.buildComponentInitBody({
          apiKey: config.codaApiKey, projectId: config.codaProjectId,
          countryNumeric: b.countryNumeric, payType: b.payType, currencyNumeric: b.currencyNumeric,
          orderId: b.orderId, uid: b.uid, itemName: b.itemName, price: b.price,
          shopper: b.shopper && typeof b.shopper === 'object' ? { email: b.shopper.email || null } : null,
        });
      } catch (e) { e.http = 400; throw e; }
      const text = await codaPost(coda.CODA_URLS[codaEnv].componentInit, JSON.stringify(body));
      const parsed = coda.parseComponentInitResponse(text);
      log(`coda component-init order=${b.orderId} payType=${b.payType} ok=${parsed.ok} code=${parsed.resultCode}`);
      return { status: 200, body: { ...parsed, env: codaEnv } };
    },
    // CODA: what happened to a payment. Returns { state: paid|pending|failed|unknown }.
    async 'coda/inquiry'(b) {
      if (!codaReady) unavailable('coda_not_configured');
      let bodyText;
      try {
        bodyText = coda.buildInquiryBody({
          apiKey: config.codaApiKey, projectId: config.codaProjectId,
          countryNumeric: b.countryNumeric, txnId: b.txnId,
        });
      } catch (e) { e.http = 400; throw e; }
      const text = await codaPost(coda.CODA_URLS[codaEnv].inquiry, bodyText);
      return { status: 200, body: coda.inquiryState(text) };
    },
    async 'send/get'(b) {
      if (!clientA) unavailable('token_a_missing');
      return clientA.getSendMoneyRequest(need(b.requestId, 'requestId'));
    },
    // READ-ONLY: the transactions Mercury created for one send request, used to
    // spot a wire the receiving bank returned (build step 6). The caller may name
    // the account, because a payout sent before MERCURY_PAYOUT_ACCOUNT_ID was
    // switched lives on the old account. Sending never accepts an account.
    async transactions(b) {
      if (!clientA) unavailable('token_a_missing');
      // Only CALLER input is format-checked; the configured account is trusted.
      if (b.accountId && !/^[0-9a-f-]{36}$/i.test(String(b.accountId))) {
        const e = new Error('accountId is invalid'); e.http = 400; throw e;
      }
      const accountId = b.accountId || config.payoutAccountId;
      if (!accountId) unavailable('payout_account_not_configured');
      try {
        return await clientA.listTransactionsForRequest(accountId, need(b.requestId, 'requestId'), b.start || null);
      } catch (e) {
        // Our own validation is a 400; a failure to reach Mercury stays a 502.
        if (!e.http && String(e.message).startsWith('mercury:')) e.http = 400;
        throw e;
      }
    },
  };

  const reply = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  return async function handler(req, res) {
    const path = new URL(req.url, 'http://x').pathname.replace(/^\/payouts/, '');

    if (req.method === 'GET' && path === '/healthz') {
      return reply(res, 200, {
        ok: true, tokenA: !!clientA, tokenB: !!clientB, payoutAccount: !!config.payoutAccountId,
        coda: codaReady, codaEnv,
      });
    }

    // CODA completion notification: a public GET. Accepted ONLY with a valid
    // checksum. It changes nothing by itself: the Cloud Functions settle an order
    // by asking Coda (coda/inquiry) when the buyer returns, or in the 5-minute
    // sweep, so this endpoint cannot credit anything even if it were spoofed.
    // Answering "ResultCode=0" stops Coda's three retries.
    if (req.method === 'GET' && path === '/coda/notify') {
      const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      const valid = codaReady && coda.notificationValid(q, config.codaApiKey);
      log(`coda notify order=${String(q.OrderId || '').slice(0, 64)} result=${String(q.ResultCode || '')} valid=${valid}`);
      res.writeHead(valid ? 200 : 400, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      return res.end(valid ? 'ResultCode=0' : 'ResultCode=1');
    }

    const m = /^\/v1\/(.+)$/.exec(path);
    const route = m && Object.prototype.hasOwnProperty.call(routes, m[1]) ? routes[m[1]] : null;
    if (req.method !== 'POST' || !route) return reply(res, 404, { error: 'not_found' });

    const auth = req.headers.authorization || '';
    try {
      await verifyGoogleIdToken(auth.startsWith('Bearer ') ? auth.slice(7) : '', { keyFor, audience, allowedEmails });
    } catch (e) {
      log(`auth refused route=${m[1]} reason=${e.message}`);
      return reply(res, 401, { error: 'unauthorized' });
    }

    let raw = '';
    let tooBig = false;
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) { tooBig = true; break; }
    }
    if (tooBig) return reply(res, 413, { error: 'too_large' });
    let body;
    try { body = raw ? JSON.parse(raw) : {}; } catch { return reply(res, 400, { error: 'bad_json' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(res, 400, { error: 'bad_json' });

    try {
      const out = await route(body);
      log(`ok route=${m[1]} mercury=${out.status}`);
      return reply(res, 200, out);
    } catch (e) {
      const code = e.http || 502;
      log(`error route=${m[1]} code=${code} reason=${String(e.message).slice(0, 120)}`);
      return reply(res, code, { error: code === 502 ? 'mercury_unreachable' : e.message });
    }
  };
}

function start() {
  const env = process.env;
  const handler = createRelay({
    config: {
      tokenA: env.MERCURY_TOKEN_A || null,
      tokenB: env.MERCURY_TOKEN_B || null,
      payoutAccountId: env.MERCURY_PAYOUT_ACCOUNT_ID || null,
      codaApiKey: env.CODA_API_KEY || null,
      codaProjectId: env.CODA_PROJECT_ID || null,
      codaEnv: env.CODA_ENV || 'sandbox',
      audience: env.MERCURY_RELAY_AUDIENCE,
      allowedServiceAccounts: String(env.MERCURY_RELAY_ALLOWED_SA || '').split(',').map((s) => s.trim()),
    },
    mercuryFetch: fetchV4Factory(),
    fetchJwks: async () => {
      const r = await fetchV4Factory()(GOOGLE_JWKS_URL);
      return JSON.parse(await r.text());
    },
    log: (line) => console.log(`[mercury-relay] ${line}`),
  });
  const port = Number(env.PORT || 8098);
  http.createServer(handler).listen(port, '127.0.0.1', () => {
    console.log(`[mercury-relay] listening on 127.0.0.1:${port}`);
  });
}

module.exports = { createRelay, verifyGoogleIdToken, fetchV4Factory, jwksCache };

if (require.main === module) start();
