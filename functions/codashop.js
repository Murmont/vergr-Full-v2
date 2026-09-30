// Codashop fulfilment (Coda's storefront selling Vergr items on codashop.com).
//
// Founder, 2026-09-26: list Vergr on Codashop as an EXTRA place to buy, without
// stopping anyone checking out on Vergr. Nothing inside Vergr changes: this only
// answers Coda's two server calls for orders placed ON codashop.com.
//
//   validate  before payment: is this a real Vergr account that may buy this SKU?
//   topup     after payment: credit it, exactly once.
//
// Spec: docs.coda.co/codashop-and-distribution/integration-guides (Validate,
// Top-Up, Authorization). JSON-RPC 2.0 over POST, 5-second budget, HTTP 200 with
// either `result` or `error` ({code, message}; codes from Coda's appendix).
//
// Served by its own HTTP function, codashopFulfilment (paths /validate and
// /topup), and built only on orders.js, so it has nothing to do with PayRam and
// survives PayRam's removal. The shared secret lives in Firestore
// (private_config/codashop, no client rule), not Secret Manager, which bills per
// secret.
//
// A top-up is credited through orders.settleOrder, the same path every Vergr
// purchase uses, so coins, VP bonus, boosts, plans and the ledger behave exactly
// as they do for a purchase made inside Vergr. Orders live in checkout_orders.
const crypto = require('crypto');

const ERR = {
  USER: -100,       // user not found
  SKU: -101,        // unknown / unavailable SKU
  NOT_ELIGIBLE: -102,
  CANNOT: -103,     // cannot process (bad signature, maintenance, ...)
  COUNTRY: -200,    // cannot top up in this country
};

/** Coda SKU -> what resolvePaymentOrder sells. Play-style ids, as uploaded to the portal. */
function mapSku(sku, quantity, { COIN_PACKS, STORE_ITEMS }) {
  const s = String(sku || '');
  const qty = Math.min(99, Math.max(1, Math.floor(Number(quantity) || 1)));
  if (s === 'plan_lite_month' || s === 'plan_pro_month') {
    if (qty !== 1) return null;
    return { subscriptionTier: s === 'plan_lite_month' ? 'lite' : 'pro' };
  }
  if (s.startsWith('coins_')) {
    const pack = s.slice('coins_'.length);
    return COIN_PACKS[pack] ? { cart: [{ sku: pack, qty }] } : null;
  }
  if (STORE_ITEMS[s]) return { cart: [{ sku: s, qty }] };
  return null;
}

/**
 * The string Coda signs (Authorization page): id + jsonrpc + method +
 * serviceProvider + txnId + orderId + userId + zoneId + currency + amount + sku +
 * quantity + paymentChannelId + isForTest (+ roleId). Values exactly as sent.
 */
function signatureBase(rpc) {
  const p = (rpc && Array.isArray(rpc.params) ? rpc.params[0] : rpc && rpc.params) || {};
  const u = p.user || {};
  const price = p.price || {};
  const part = (v) => (v === undefined || v === null ? '' : String(v));
  return [
    rpc.id, rpc.jsonrpc, rpc.method, p.serviceProvider, p.txnId, p.orderId,
    u.userId, u.zoneId, price.currency, price.amount, p.sku, p.quantity,
    p.paymentChannelId, p.isForTest,
  ].map(part).join('') + (u.roleId ? String(u.roleId) : '');
}

function sign(secret, rpc) {
  return crypto.createHmac('sha256', String(secret)).update(signatureBase(rpc)).digest('hex');
}

function signatureValid(secret, rpc) {
  const p = (rpc && Array.isArray(rpc.params) ? rpc.params[0] : null) || {};
  const got = String(p.signature || '');
  if (!secret || !/^[0-9a-f]{64}$/i.test(got)) return false;
  const want = sign(secret, rpc);
  return crypto.timingSafeEqual(Buffer.from(want.toLowerCase()), Buffer.from(got.toLowerCase()));
}

const COLLECTION = 'checkout_orders';

const rpcResult = (id, result) => ({ id, jsonrpc: '2.0', result });
const rpcError = (id, code, message) => ({ id, jsonrpc: '2.0', error: { code, message } });

/**
 * handler factory. deps: db, resolvePaymentOrder, settleOrder, isStaffDoc,
 * BLOCKED_COUNTRIES, COIN_PACKS, STORE_ITEMS, logger.
 */
function makeCodashopHandler(deps) {
  const { db, logger } = deps;
  let secretCache = { at: 0, value: null };

  async function getSecret() {
    if (secretCache.value && Date.now() - secretCache.at < 10 * 60 * 1000) return secretCache.value;
    const snap = await db.collection('private_config').doc('codashop').get();
    const value = snap.exists ? String(snap.data().secretKey || '') : '';
    secretCache = { at: Date.now(), value: value || null };
    return secretCache.value;
  }

  // A Codashop buyer types their Vergr @username (or their user id).
  async function findUser(userId) {
    const raw = String(userId || '').trim().replace(/^@/, '');
    if (!raw || raw.length > 64) return null;
    if (/^[A-Za-z0-9]{20,40}$/.test(raw)) {
      const byId = await db.collection('users').doc(raw).get();
      if (byId.exists) return { uid: byId.id, user: byId.data() };
    }
    const q = await db.collection('users').where('usernameLower', '==', raw.toLowerCase()).limit(1).get();
    return q.empty ? null : { uid: q.docs[0].id, user: q.docs[0].data() };
  }

  // Everything validate checks; topup re-runs it (the ids may differ between the two calls).
  async function check(p) {
    const found = await findUser(p.user && p.user.userId);
    if (!found) return { error: [ERR.USER, 'Vergr account not found. Enter your Vergr @username.'] };
    const { uid, user } = found;
    if (user.isGuest) return { error: [ERR.NOT_ELIGIBLE, 'Guest accounts cannot buy. Create a Vergr account first.'] };
    if (user.banned) return { error: [ERR.NOT_ELIGIBLE, 'This account cannot make purchases.'] };
    const origin = String(p.purchaseOrigin || '').toUpperCase();
    const home = String(user.geoCountry || user.country || '').toUpperCase();
    if (deps.BLOCKED_COUNTRIES.has(origin) || deps.BLOCKED_COUNTRIES.has(home)) {
      return { error: [ERR.COUNTRY, 'Purchases are not available in this country.'] };
    }
    const mapped = mapSku(p.sku, p.quantity, deps);
    if (!mapped) return { error: [ERR.SKU, 'This item is not available.'] };
    // A Coda TEST order (isForTest=1) is paid with fake money. It is accepted for
    // any real account, so Coda's review and API Test pass whatever user id they
    // type, but it credits real coins ONLY to a staff test account. For anyone
    // else the top-up is recorded and answered as a success with nothing granted.
    const testNoCredit = Number(p.isForTest) === 1 && !deps.isStaffDoc(user);
    return { uid, user, mapped, region: home || origin || null, testNoCredit };
  }

  return async function handleCodashop(req, res, action) {
    const rpc = req.body && typeof req.body === 'object' ? req.body : {};
    const id = rpc.id != null ? String(rpc.id) : null;
    const p = (Array.isArray(rpc.params) ? rpc.params[0] : null) || {};
    const reply = (body) => res.status(200).json(body);
    try {
      if (rpc.jsonrpc !== '2.0' || rpc.method !== action) return reply(rpcError(id, ERR.CANNOT, 'Bad request'));
      const secret = await getSecret();
      if (!secret) {
        logger.error('codashop: secret not configured');
        return reply(rpcError(id, ERR.CANNOT, 'Service not configured'));
      }
      if (!signatureValid(secret, rpc)) {
        logger.warn('codashop: bad signature', { action, orderId: p.orderId || null });
        return reply(rpcError(id, ERR.CANNOT, 'Invalid signature'));
      }

      const c = await check(p);
      if (c.error) {
        logger.info('codashop refused', { action, orderId: p.orderId || null, code: c.error[0] });
        return reply(rpcError(id, c.error[0], c.error[1]));
      }

      if (action === 'validate') {
        // Price and plan checks run here too (e.g. new plans paused), so a buyer
        // is refused BEFORE paying rather than after.
        try { await deps.resolvePaymentOrder(c.uid, c.mapped); } catch (e) {
          return reply(rpcError(id, ERR.NOT_ELIGIBLE, (e && e.message) || 'This item cannot be bought right now.'));
        }
        return reply(rpcResult(id, {
          username: c.user.displayName || c.user.username || 'Vergr user',
          accountRegionCode: c.region || undefined,
        }));
      }

      // ── topup: record the order once, then settle through the shared path ──
      const orderId = String(p.orderId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
      const txnId = String(p.txnId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
      if (!orderId) return reply(rpcError(id, ERR.CANNOT, 'Missing orderId'));
      const ref = `codashop_${orderId}`;
      const orderRef = db.collection(COLLECTION).doc(ref);

      const existing = await orderRef.get();
      if (!existing.exists) {
        let resolved;
        try { resolved = await deps.resolvePaymentOrder(c.uid, c.mapped); } catch (e) {
          return reply(rpcError(id, ERR.NOT_ELIGIBLE, (e && e.message) || 'This item cannot be bought right now.'));
        }
        const { order, amountUSD } = resolved;
        try {
          await orderRef.create({
            referenceId: ref,
            rail: 'codashop',
            uid: c.uid,
            kind: order.kind,
            packSku: order.sku,
            subscriptionTier: order.tier || null,
            coinsToCredit: order.coins,
            vpBonus: order.vpBonus,
            ...(Array.isArray(order.items) && order.items.length ? { items: order.items } : {}),
            ...(Array.isArray(order.lines) && order.lines.length ? { lines: order.lines } : {}),
            amountEUR: typeof order.priceEUR === 'number' ? order.priceEUR : null,
            // The web price of what was bought. Coda settles monthly in USD, net of its 15%.
            amountUSD,
            codashopSku: String(p.sku || ''),
            codashopQuantity: Number(p.quantity) || 1,
            localPrice: p.price ? String(p.price.amount || '') : null,
            localCurrency: p.price ? String(p.price.currency || '') : null,
            codashopOrderId: orderId,
            codashopTxnId: txnId || null,
            paymentChannelId: Number(p.paymentChannelId) || null,
            purchaseOrigin: String(p.purchaseOrigin || '').toUpperCase() || null,
            isForTest: Number(p.isForTest) === 1,
            // test_no_credit is terminal: settleOrder and the poller only act on
            // awaiting_settlement, so this can never grant anything.
            status: c.testNoCredit ? 'test_no_credit' : 'awaiting_settlement',
            createdAt: deps.serverTimestamp(),
          });
        } catch (e) {
          // ALREADY_EXISTS: a concurrent retry created it first. Fall through to settle.
          if (!(e && (e.code === 6 || /already exists/i.test(String(e.message))))) throw e;
        }
      } else if (existing.data().uid !== c.uid) {
        return reply(rpcError(id, ERR.CANNOT, 'Order belongs to a different account'));
      }

      const current = (await orderRef.get()).data() || {};
      if (current.status === 'test_no_credit') {
        logger.info('codashop test topup (no credit)', { ref });
        return reply(rpcResult(id, 0));
      }

      const result = await deps.settleOrder(COLLECTION, ref, { source: 'codashop' });
      if (result.credited || result.reason === 'already-settled') {
        logger.info('codashop topup', { ref, credited: !!result.credited, reason: result.reason || null });
        return reply(rpcResult(id, 0));
      }
      logger.error('codashop topup not settled', { ref, reason: result.reason });
      return reply(rpcError(id, ERR.CANNOT, 'Top-up could not be completed. It will be retried.'));
    } catch (e) {
      logger.error('codashop handler error', { action, message: String((e && e.message) || e).slice(0, 200) });
      return reply(rpcError(id, ERR.CANNOT, 'Temporarily unable to process. Please retry.'));
    }
  };
}

// ── The HTTP function Coda calls ──────────────────────────────────────
// Registered lazily so the pure helpers above load in tests without Firebase.
function buildHandler() {
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const functions = require('firebase-functions/v2');
  const orders = require('./orders');
  return makeCodashopHandler({
    db: getFirestore('vgrdb'),
    resolvePaymentOrder: orders.resolvePaymentOrder,
    settleOrder: orders.settleOrder,
    isStaffDoc: require('./staff').isStaffDoc,
    BLOCKED_COUNTRIES: require('./geo').BLOCKED_COUNTRIES,
    COIN_PACKS: orders.COIN_PACKS,
    STORE_ITEMS: orders.STORE_ITEMS,
    serverTimestamp: () => FieldValue.serverTimestamp(),
    logger: functions.logger,
  });
}

let handler = null;
const { onRequest } = require('firebase-functions/v2/https');
async function route(req, res) {
  const m = /\/(validate|topup)\/?$/.exec(req.path || '');
  if (!m) { res.status(404).send('not found'); return; }
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
  if (!handler) handler = buildHandler();
  await handler(req, res, m[1]);
}
const codashopFulfilment = onRequest(
  { region: 'europe-west1', cors: false, maxInstances: 4, memory: '256MiB', timeoutSeconds: 30,
    secrets: require('./receipts').RECEIPT_SECRETS },
  route,
);

module.exports = { ERR, mapSku, signatureBase, sign, signatureValid, makeCodashopHandler, codashopFulfilment, _route: route };
