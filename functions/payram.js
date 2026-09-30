// functions/payram.js — PayRam inbound rail (buy coins). PayRam ONLY.
// ─────────────────────────────────────────────────────────────────────
// PayRam is a self-hosted crypto payment node (Docker container on Hetzner,
// reverse-proxied at PAYRAM_NODE_URL). It onramps the user's card/Apple Pay/
// bank into USDC on Base and forwards it to our Circle omnibus (the deposit
// contract's cold-wallet field = the Circle omnibus address). See CLAUDE.md
// "[Option 1 / SNAPSHOT]" + the PayRam node ops notes.
//
// API spec (verified against https://docs.payram.com 2026-05-21):
//   Create payment   POST {node}/api/v1/payment
//                     headers: API-Key: <key>, Content-Type: application/json
//                     body:    { customerEmail, customerID, amountInUSD }
//                     resp:    { host, reference_id, url }
//   Payment status   GET  {node}/api/v1/payment/reference/{reference_id}
//                     resp field: paymentState
//   Webhook          PayRam sends a GET to the URL registered in
//                     Dashboard → Developer → Webhook → Add Endpoint.
//                     fields: reference_id, customer_id, invoice_id, status,
//                             amount, currency, filled_amount,
//                             filled_amount_in_usd, timestamp
//                     statuses: OPEN | CANCELLED | FILLED | PARTIALLY_FILLED |
//                               OVER_FILLED   (paid = FILLED | OVER_FILLED)
//                     auth: PayRam echoes the API-Key header back; the merchant
//                           compares it to its own key. There is NO separate
//                           HMAC webhook secret in PayRam's model (despite the
//                           CLAUDE.md placeholder PAYRAM_WEBHOOK_SECRET note —
//                           that is not a real PayRam concept).
//
// Crediting authority + idempotency:
//   payram_orders/{reference_id} holds { uid, coinsToCredit, vpBonus, status }.
//   status starts 'awaiting_settlement'. THREE rails can settle an order:
//     1. payramWebhook (primary — fires on FILLED/OVER_FILLED)
//     2. pollPayramOrders (belt-and-suspenders — polls PayRam status endpoint)
//     3. circleWallets.processInboundDeposit (fallback — IF the Circle deposit
//        surfaces the refId; credits balance + vpBonus too)
//   All three credit only when status === 'awaiting_settlement' inside a
//   Firestore transaction that flips it to 'settled', so crediting is
//   exactly-once regardless of ordering / duplicate webhook delivery.
//
// Required Firebase secrets:
//   PAYRAM_API_KEY    (project API key from PayRam admin → Connect App → API Keys)
//   PAYRAM_NODE_URL   (e.g. https://payram.vergr.app)

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret, defineString } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const functions = require('firebase-functions/v2');
const axios = require('axios');
const crypto = require('node:crypto');
// What a purchase is and how it settles is shared with the Coda checkout and
// lives in orders.js. This file is ONLY PayRam, so it can be deleted whole when
// PayRam is removed (founder, 2026-09-26) without touching any other rail.
const orders = require('./orders');
const settlePayramOrder = (referenceId, ctx) => orders.settleOrder('payram_orders', referenceId, ctx);

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';

const PAYRAM_API_KEY  = defineSecret('PAYRAM_API_KEY');
const PAYRAM_NODE_URL = defineString('PAYRAM_NODE_URL');
const SECRETS = [PAYRAM_API_KEY, ...require('./receipts').RECEIPT_SECRETS];

// CLAUDE.md flags secrets set via `echo` landing with a trailing \n that breaks
// HTTP headers. Trim every read.
const trimEnv = (name) => (process.env[name] || '').replace(/[\s\r\n]+$/g, '').trim();
const payramApiKey  = () => trimEnv('PAYRAM_API_KEY');
const payramNodeUrl = () => trimEnv('PAYRAM_NODE_URL').replace(/\/+$/, '');

const isPlaceholder = (v) => !v || typeof v !== 'string' || v.startsWith('placeholder');
function isConfigured() {
  return !isPlaceholder(payramApiKey()) && !isPlaceholder(payramNodeUrl());
}

const PAID_STATES = new Set(['FILLED', 'OVER_FILLED']);

// ════════════════════════════════════════════════════════════════════
// createPayramPayment — inbound (buy coins)
// ════════════════════════════════════════════════════════════════════
exports.createPayramPayment = onCall({ region: REGION, secrets: SECRETS }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Login required');
  if (request.auth?.token?.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('permission-denied', 'Anonymous accounts cannot buy coins.');
  }
  if (request.auth?.token?.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'email_unverified: Verify your email before buying.');
  }


  // Resolve order — a fixed pack, a custom coin amount, or a subscription.
  // `gemQuoteId` and the whole buy-and-send branch were removed on 2026-08-16.
  // It let a buyer pay by card to mint value directly into another user's
  // wallet, which is the clearest money-transmission shape the product had.
  const resolved = await orders.resolvePaymentOrder(uid, request.data || {});
  const { order, rate, buffer } = resolved;
  let amountUSD = resolved.amountUSD;

  if (!isConfigured()) {
    return {
      ok: false,
      placeholder: true,
      message: 'PayRam is not configured. Set PAYRAM_API_KEY + PAYRAM_NODE_URL to enable.',
    };
  }

  // ── Fees and tax, ADDED to the buyer (founder decision 2026-08-11) ──
  //
  // `amountUSD` above is the SUBTOTAL: what we intend to net. The buyer is
  // charged that plus the rail's processing fee and any tax. Without this the
  // Starter pack nets $0.66 on a $0.99 sale, because Stripe-class flat fees are
  // 30% of a 99-cent charge.
  //
  // Quoted here rather than trusted from the client, on the same server call
  // that priced the order, so the number on the button and the number on the
  // statement come from one calculation. If the quote fails we charge the
  // subtotal and eat the fee: undercharging is recoverable, overcharging a buyer
  // on a guessed number is not.
  const subtotalUSD = amountUSD;
  let buyerFeesUSD = 0;
  try {
    const { quoteCheckout } = require('./checkoutFees');
    const q = await quoteCheckout({ subtotalUsd: subtotalUSD, method: 'payram_card', uid });
    if (q && q.total > 0) {
      amountUSD = q.total;
      buyerFeesUSD = +(q.total - subtotalUSD).toFixed(2);
    }
  } catch (e) {
    functions.logger.warn('checkout fee quote failed on payment path; charging subtotal', {
      uid, err: e?.message || e,
    });
  }

  const customerEmail = request.auth?.token?.email || `${uid}@users.vergr.app`;

  let resp;
  try {
    resp = await axios.post(
      `${payramNodeUrl()}/api/v1/payment`,
      { customerEmail, customerID: uid, amountInUSD: amountUSD },
      {
        headers: { 'API-Key': payramApiKey(), 'Content-Type': 'application/json' },
        timeout: 15000,
        validateStatus: () => true,
      }
    );
  } catch (err) {
    functions.logger.error('payram createPayment threw', { message: err.message, code: err.code });
    throw new HttpsError('unavailable', 'PayRam is unreachable. Try again shortly.');
  }

  if (resp.status >= 400 || !resp.data?.reference_id || !resp.data?.url) {
    functions.logger.error('payram createPayment non-2xx / malformed', {
      status: resp.status, body: resp.data,
    });
    throw new HttpsError('internal', `PayRam create payment failed (${resp.status}).`);
  }

  const referenceId = String(resp.data.reference_id);

  const promo = await orders.applyOrderPromo(order, uid, referenceId);

  // Doc id = PayRam reference_id so circleWallets.processInboundDeposit can
  // match a Circle deposit's refId straight to payram_orders/{refId}.
  await db.collection('payram_orders').doc(referenceId).set({
    referenceId,
    rail: 'payram',
    ...orders.baseOrderFields({ uid, order, promo, amountEUR: order.priceEUR }),
    // `amountUSD` is what the buyer is CHARGED (subtotal + fees + tax).
    // `subtotalUSD` is what we intend to net. platformRevenue.js books the two
    // separately so the ledger reconciles against the card statement rather than
    // against a net figure nothing can be tied back to.
    amountUSD,
    subtotalUSD,
    buyerFeesUSD,
    eurUsdRate: rate,
    fxBufferPct: buffer,
    paymentUrl: resp.data.url,
    payramHost: resp.data.host || null,
    status: 'awaiting_settlement',
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, referenceId, paymentUrl: resp.data.url };
});

// ════════════════════════════════════════════════════════════════════
// payramWebhook — GET callback from PayRam (Dashboard → Developer → Webhook)
// ════════════════════════════════════════════════════════════════════
exports.payramWebhook = onRequest(
  { region: REGION, secrets: SECRETS, cors: false, maxInstances: 4, memory: '256MiB' },
  async (req, res) => {
    // PayRam sends GET. Accept POST too defensively, and read fields from
    // either the query string (GET) or the body (POST).
    const p = { ...(req.query || {}), ...(req.body || {}) };

    // Auth: PayRam echoes the API-Key header. Compare timing-safely.
    const presentedKey = (req.headers['api-key'] || req.headers['API-Key'] || '').toString().trim();
    const ourKey = payramApiKey();
    if (isConfigured()) {
      let ok = false;
      try {
        ok = !!presentedKey && presentedKey.length === ourKey.length &&
          crypto.timingSafeEqual(Buffer.from(presentedKey), Buffer.from(ourKey));
      } catch { ok = false; }
      if (!ok) {
        functions.logger.warn('payramWebhook bad API-Key header', {
          hasKey: !!presentedKey, refId: p.reference_id || null,
        });
        res.status(401).send('unauthorized');
        return;
      }
    } else {
      functions.logger.warn('payramWebhook: PayRam not configured, accepting unverified (bring-up only)');
    }

    const referenceId = (p.reference_id || p.referenceId || '').toString();
    const status = (p.status || p.paymentState || '').toString().toUpperCase();
    if (!referenceId) {
      res.status(400).send('missing reference_id');
      return;
    }

    functions.logger.info('payramWebhook received', {
      referenceId, status, invoiceId: p.invoice_id || null,
      filledUsd: p.filled_amount_in_usd || null,
    });

    try {
      if (PAID_STATES.has(status)) {
        const result = await settlePayramOrder(referenceId, {
          source: 'webhook',
          invoiceId: p.invoice_id || null,
          filledAmountUSD: p.filled_amount_in_usd != null ? Number(p.filled_amount_in_usd) : null,
        });
        functions.logger.info('payramWebhook settle result', { referenceId, ...result });
      } else {
        // Non-terminal / unpaid — record last seen status for visibility.
        await db.collection('payram_orders').doc(referenceId).set({
          lastStatus: status,
          lastEventAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    } catch (err) {
      // Idempotency makes retries safe, so prefer 200 over a 5xx retry storm.
      functions.logger.error('payramWebhook handler error', { referenceId, message: err.message });
    }

    res.status(200).json({ ok: true, received: referenceId });
  }
);

// ════════════════════════════════════════════════════════════════════
// pollPayramOrders — belt-and-suspenders reconciler (every 5 min)
// ════════════════════════════════════════════════════════════════════
// PayRam webhooks are unsigned GETs and delivery isn't guaranteed. This polls
// the status endpoint for any order still awaiting settlement and credits it
// if PayRam reports FILLED/OVER_FILLED. Orders older than 1h that are still
// unpaid are marked expired.
// Runs inside a dispatcher cron in index.js (it was its own Cloud Scheduler
// job, and every job past the first three is billed monthly).
exports.pollPayramOrders = async function pollPayramOrders() {
    const payramReady = isConfigured();

    // Only check orders at least 2 min old (give the webhook first crack) and
    // not older than 24h (stale links).
    const now = Date.now();
    const minAgeMs = 2 * 60 * 1000;
    const maxAgeMs = 24 * 60 * 60 * 1000;
    const expireMs = 60 * 60 * 1000;

    let pending;
    try {
      pending = await db.collection('payram_orders')
        .where('status', '==', 'awaiting_settlement')
        .orderBy('createdAt', 'asc')
        .limit(40)
        .get();
    } catch (err) {
      functions.logger.error('pollPayramOrders query failed', err.message);
      return;
    }

    for (const doc of pending.docs) {
      const order = doc.data();
      const createdMs = order.createdAt?.toMillis ? order.createdAt.toMillis() : 0;
      const age = createdMs ? now - createdMs : Infinity;
      if (age < minAgeMs) continue;

      // Coda orders written here before 2026-09-26 (sandbox, staff only) now
      // belong to checkout.js. Expire them once stale so they cannot fill this
      // query's 40-row window and starve real PayRam orders.
      if (order.rail && order.rail !== 'payram') {
        if (age > maxAgeMs) {
          await doc.ref.set({ status: 'expired', lastStatus: 'LEGACY_RAIL', expiredAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        continue;
      }
      if (age > maxAgeMs) continue;
      if (!payramReady) continue;

      let state = '';
      try {
        const resp = await axios.get(
          `${payramNodeUrl()}/api/v1/payment/reference/${encodeURIComponent(doc.id)}`,
          { headers: { 'API-Key': payramApiKey() }, timeout: 12000, validateStatus: () => true }
        );
        state = (resp.data?.paymentState || resp.data?.status || '').toString().toUpperCase();
      } catch (err) {
        functions.logger.warn('pollPayramOrders status fetch failed', { refId: doc.id, message: err.message });
        continue;
      }

      if (PAID_STATES.has(state)) {
        try {
          const result = await settlePayramOrder(doc.id, { source: 'poll' });
          functions.logger.info('pollPayramOrders settled', { refId: doc.id, ...result });
        } catch (err) {
          functions.logger.error('pollPayramOrders settle failed', { refId: doc.id, message: err.message });
        }
      } else if (state === 'CANCELLED' || age > expireMs) {
        await doc.ref.set({
          status: 'expired',
          lastStatus: state || 'TIMEOUT',
          expiredAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }
  };

// ════════════════════════════════════════════════════════════════════
// getPayramOrderStatus — polled by the in-app popup checkout
// ════════════════════════════════════════════════════════════════════
// The buy popup opens PayRam's hosted page on a different origin, so the app
// can't postMessage from it — it polls this callable instead. To make success
// instant (not wait on the webhook or the 5-min cron), if the order is still
// awaiting we query PayRam's status endpoint live and settle on the spot.
exports.getPayramOrderStatus = onCall({ region: REGION, secrets: SECRETS }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Login required');
  const { referenceId } = request.data || {};
  if (!referenceId) throw new HttpsError('invalid-argument', 'referenceId required');

  const ref = db.collection('payram_orders').doc(String(referenceId));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Order not found');
  const order = snap.data();
  if (order.uid !== uid) throw new HttpsError('permission-denied', 'Not your order');

  if (order.status === 'settled') {
    return { status: 'settled', coins: order.coinsToCredit, vpBonus: order.vpBonus || 0 };
  }
  if (order.status === 'expired') return { status: 'expired' };

  // Still awaiting — ask PayRam directly so the popup can resolve immediately.
  if (order.status === 'awaiting_settlement' && isConfigured()) {
    try {
      const resp = await axios.get(
        `${payramNodeUrl()}/api/v1/payment/reference/${encodeURIComponent(referenceId)}`,
        { headers: { 'API-Key': payramApiKey() }, timeout: 12000, validateStatus: () => true }
      );
      const state = (resp.data?.paymentState || resp.data?.status || '').toString().toUpperCase();
      if (PAID_STATES.has(state)) {
        const result = await settlePayramOrder(referenceId, { source: 'status-poll' });
        if (result.credited || result.reason === 'already-settled') {
          return { status: 'settled', coins: order.coinsToCredit, vpBonus: order.vpBonus || 0 };
        }
      }
    } catch (err) {
      functions.logger.warn('getPayramOrderStatus live check failed', { referenceId, message: err.message });
    }
  }

  return { status: 'awaiting' };
});

exports._settlePayramOrder = settlePayramOrder;
