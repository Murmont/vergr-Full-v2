// functions/checkout.js — Vergr's own web checkout, paid through Coda.
// ─────────────────────────────────────────────────────────────────────
// Buyer picks a payment method in the basket; the order is priced per method in
// their local currency (codaPricing.js) so Vergr always nets the web price; Coda's
// form opens inside the basket; the order settles through orders.settleOrder.
//
// Coda's API key lives on box 1, so every Coda call goes through the relay
// (mercuryRelayClient), which needs no stored secret here.
//
// Deliberately independent of payram.js (founder, 2026-09-26): PayRam is removed
// once Coda is live, and nothing here may break when it goes.
//
// Callables:
//   createCheckout      { options: true, ...basket } -> methods priced for this basket
//                       { payType, ...basket }       -> start a Coda order
//   getCheckoutStatus   { referenceId }              -> settled | awaiting | expired
//   getCoinPriceQuote   (pricing for the buy screens; rail-neutral)
// Job:
//   pollCheckoutOrders  run by the EXISTING cron5Min (no new scheduler job)

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const functions = require('firebase-functions/v2');
const orders = require('./orders');
const { regionalPrice } = require('./geoPricing');
const codaPay = require('./codaPay');
const codaMethods = require('./codaMethods');
const codaPricing = require('./codaPricing');
const codaLogos = require('./codaLogos');
const { relayCall } = require('./mercuryRelayClient');
const { isStaffDoc } = require('./staff');
const playTx = require('./playExternalTx');
const PR = require('./paymentRecords');

// Inside the Google Play app, Google takes its service fee on a Coda sale too.
// It is added ON TOP of the price like Coda's own fee (founder rule), so the
// method's fee grows by Google's share and everything downstream (price, fee
// line, what Vergr receives) follows automatically.
const withPlayFee = (method, country, play) => (
  play ? { ...method, fee: method.fee + playTx.playFeeFor(country) } : method
);

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const COLLECTION = 'checkout_orders';

// An unverified email may browse the methods above but may not pay (founder,
// 2026-09-29). Read off the ID token Auth issues, so it costs nothing.
function requireVerifiedEmail(request) {
  if (request.auth?.token?.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'email_unverified: Verify your email before buying.');
  }
}

function requireBuyer(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Login required');
  if (request.auth?.token?.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('permission-denied', 'Anonymous accounts cannot buy coins.');
  }
  return uid;
}

// ════════════════════════════════════════════════════════════════════
// Coda order (rail 'coda')
// ════════════════════════════════════════════════════════════════════
//
// Written into checkout_orders with rail:'coda' and credited by orders.settleOrder:
// one definition of what a paid order grants, whichever rail took the money. The order id is ours (coda_...), Coda's txnId is stored beside
// it as a STRING (it is larger than 2^53 and a JS number would corrupt it).
//
// Gates, in order, all before Coda is ever called:
//   app_config/general.codaCheckout  'on' (default, founder 2026-09-25) | 'staff' | 'off'
//   ⚠⚠ STAFF ONLY WHILE CODA IS IN SANDBOX. A sandbox payment is fake, and a
//   "paid" sandbox order would credit REAL coins, so a non-staff buyer is refused
//   until the relay reports production. app_config/general.codaEnv records what
//   the relay last reported (written here, only when it changes) so the picker
//   hides the row from the public for free, on the listener it already has.
//   the buyer's PROFILE country must be one Coda serves (codaPay.CODA_COUNTRIES)
//   no fee is added (checkoutFees 'coda_card', agreement clause 4.1)
// Same gates for listing methods and for paying (see header above).
async function codaGate(uid) {
  const [cfgSnap, userSnap] = await Promise.all([
    db.doc('app_config/general').get(),
    db.collection('users').doc(uid).get(),
  ]);
  const cfg = cfgSnap.exists ? (cfgSnap.data() || {}) : {};
  const user = userSnap.exists ? (userSnap.data() || {}) : {};
  const mode = ['off', 'staff', 'on'].includes(cfg.codaCheckout) ? cfg.codaCheckout : 'on';
  const staff = isStaffDoc(user);
  const knownEnv = cfg.codaEnv === 'production' ? 'production' : 'sandbox';
  if (mode === 'off' || (mode === 'staff' && !staff) || (knownEnv !== 'production' && !staff)) {
    throw new HttpsError('failed-precondition', 'This payment option is not available yet.');
  }
  // Blocked from buying after a refund or chargeback (paymentRefunds.js /
  // Payments tab). Read off the user doc this gate already loads: no extra read.
  if (Number(user.purchaseBanUntil) > Date.now()) {
    throw new HttpsError('permission-denied', `Buying is blocked on this account until ${new Date(Number(user.purchaseBanUntil)).toISOString().slice(0, 10)}. Contact support@vergr.app.`);
  }
  // The DETECTED country (users.geoCountry, saved once from Cloudflare by
  // functions/geo.js), never the client and never the optional profile field,
  // which buyers type themselves. It decides the methods, currency and tax.
  const country = String(user.geoCountry || '').toUpperCase();
  if (!country) {
    throw new HttpsError('failed-precondition', 'We could not confirm your country yet. Try again in a moment.');
  }
  const countryNumeric = codaPay.codaCountry(country);
  const methods = codaMethods.methodsFor(country);
  if (!countryNumeric || !methods.length) {
    throw new HttpsError('failed-precondition', 'This payment option is not available in your country yet.');
  }
  return { staff, knownEnv, country, countryNumeric, methods, extras: codaExtras(cfg) };
}

// "+ free boost" on every Coda payment and "save card for next time"
// (founder, 2026-09-27). Both live in app_config/general:
//   codaFreeBoostId   boost id granted with every Coda order (default 'post';
//                     'none' switches it off). Granted by orders.settleOrder.
//   codaSaveCards     true once Coda has enabled saved cards for our account.
//                     Until then Coda would refuse the request, so it is off.
const DEFAULT_FREE_BOOST_ID = 'post';
function codaExtras(cfg) {
  const id = typeof cfg.codaFreeBoostId === 'string' ? cfg.codaFreeBoostId : DEFAULT_FREE_BOOST_ID;
  const { BOOSTS } = require('./boosts');
  const boost = id !== 'none' ? BOOSTS.find((b) => b.id === id) : null;
  return {
    freeBoost: boost ? { id: boost.id, qty: 1 } : null,
    saveCards: cfg.codaSaveCards === true,
  };
}

// EMBEDDED Codapay order for ONE payment method (payType), in the buyer's local
// currency. The price is grossed up for that method's fee, fixed fee and tax
// (codaPricing.js), so Vergr receives at least the web USD subtotal whatever the
// buyer picks: founder rule 2026-09-25, never lose money or have profit eaten.
async function startCodaOrder({ uid, email, order, subtotalUSD, amountEUR, rate, buffer, payType, play = null }) {
  const gate = await codaGate(uid);
  const baseMethod = gate.methods.find((m) => m.payType === payType);
  if (!baseMethod) throw new HttpsError('invalid-argument', 'Choose a payment method.');
  const method = withPlayFee(baseMethod, gate.country, play);

  let local;
  try {
    local = codaPricing.localPrice({ usd: subtotalUSD, method, rates: await codaPricing.usdRates() });
  } catch (e) {
    functions.logger.error('coda local price failed; refusing rather than guessing', { uid, err: e?.message || e });
    throw new HttpsError('unavailable', 'This payment option is not available right now.');
  }
  const currencyNumeric = codaMethods.CURRENCY_NUMERIC[local.currency];
  const chargedUSD = +(local.price / local.rate).toFixed(2);

  const orderId = codaPay.codaOrderId(uid);

  const promo = await orders.applyOrderPromo(order, uid, orderId);

  // Saved cards apply to card methods only. If Coda refuses the request with
  // the saved-card fields (not enabled yet), the order is retried without them
  // rather than failing the sale.
  const initArgs = {
    countryNumeric: gate.countryNumeric, payType, currencyNumeric,
    orderId, uid, itemName: codaPay.itemNameFor(order), price: local.price,
  };
  const wantSave = gate.extras.saveCards && method.kind === 'card';
  let res;
  try {
    res = await relayCall('coda/component-init', wantSave ? { ...initArgs, shopper: { email: email || null } } : initArgs);
    if (wantSave && (!res.ok || !res.body?.ok)) {
      functions.logger.warn('coda saved-card init refused; retrying without it', { uid, code: res.body?.resultCode ?? null });
      res = await relayCall('coda/component-init', initArgs);
    }
  } catch (e) {
    functions.logger.error('coda relay unreachable', { uid, err: String(e?.message || e).slice(0, 200) });
    throw new HttpsError('unavailable', 'The payment provider is unreachable. Try again shortly.');
  }
  if (!res.ok || !res.body?.ok) {
    functions.logger.error('coda component init refused', {
      uid, payType, http: res.httpStatus, err: res.error || null, code: res.body?.resultCode ?? null, desc: res.body?.resultDesc || null,
    });
    throw new HttpsError('unavailable', 'This payment method is not available right now. Choose another one.');
  }
  const liveEnv = res.body.env === 'production' ? 'production' : 'sandbox';
  if (liveEnv !== gate.knownEnv) {
    try { await db.doc('app_config/general').set({ codaEnv: liveEnv }, { merge: true }); } catch { /* next order retries */ }
  }
  // The relay went back to sandbox after the config said production: a public
  // buyer must not get a fake payment that would credit real coins.
  if (liveEnv === 'sandbox' && !gate.staff) {
    throw new HttpsError('failed-precondition', 'This payment option is not available yet.');
  }

  await db.collection(COLLECTION).doc(orderId).set({
    referenceId: orderId,
    rail: 'coda',
    ...orders.baseOrderFields({ uid, order, promo, amountEUR }),
    // What the buyer pays, in their currency, and its USD value at checkout.
    localPrice: local.price,
    localCurrency: local.currency,
    amountUSD: chargedUSD,
    // What Vergr must receive: the web price. The difference covers Coda.
    subtotalUSD,
    buyerFeesUSD: +(chargedUSD - subtotalUSD).toFixed(2),
    usdLocalRate: local.rate,
    eurUsdRate: rate || null,
    fxBufferPct: buffer || 0,
    codaPayType: payType,
    codaMethod: method.name,
    codaMethodFee: method.fee,
    codaMethodFixed: method.fixed,
    codaTax: method.tax,
    codaCountryCode: gate.country,
    ...(play ? {
      playExternalToken: play.token,
      playProgram: play.program,
      playFee: playTx.playFeeFor(gate.country),
    } : {}),
    codaTxnId: String(res.body.txnId),
    codaCountry: gate.countryNumeric,
    codaEnv: res.body.env || null,
    ...(gate.extras.freeBoost ? { freeBoost: gate.extras.freeBoost } : {}),
    status: 'awaiting_settlement',
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    ok: true, referenceId: orderId, clientSecret: res.body.clientSecret,
    sdk: method.kind === 'card' ? 'card' : 'component',
    method: method.name, price: local.price, currency: local.currency,
    freeBoost: gate.extras.freeBoost ? gate.extras.freeBoost.id : null,
    lines: codaPricing.breakdown({ usd: subtotalUSD, price: local.price, method, rate: local.rate, currency: local.currency }),
  };
}

// The payment methods open to this buyer, each priced for this basket.
//
// Served by createCheckout ({ options: true }), not its own callable: one
// fewer function image to store.
async function codaCheckoutOptions(uid, data) {
  const gate = await codaGate(uid);
  // Priced for the Play app when the app says so; the real token comes with the order.
  const inPlay = data?.inPlay === true;
  const { amountUSD } = await orders.resolvePaymentOrder(uid, data || {});
  let rates;
  try { rates = await codaPricing.usdRates(); } catch {
    throw new HttpsError('unavailable', 'Prices are unavailable right now. Try again shortly.');
  }
  const ORDER = { card: 0, wallet: 1, bank: 2, cash: 3, voucher: 4, carrier: 5 };
  // Each method carries its own "Taxes & fees" lines, so the basket shows the
  // full total for whichever method the buyer selects BEFORE they press Pay
  // (founder, 2026-09-25: a total that jumps at payment loses the sale).
  const methods = gate.methods.map((base) => {
    const m = withPlayFee(base, gate.country, inPlay);
    const p = codaPricing.localPrice({ usd: amountUSD, method: m, rates });
    const lines = codaPricing.breakdown({ usd: amountUSD, price: p.price, method: m, rate: p.rate, currency: p.currency });
    return {
      payType: m.payType, name: m.name, kind: m.kind, logo: codaLogos.logoFor(gate.country, m.payType),
      price: p.price, currency: p.currency, lines,
    };
  }).sort((a, b) => (ORDER[a.kind] - ORDER[b.kind]) || (a.price - b.price) || a.name.localeCompare(b.name));
  return {
    country: gate.country, currency: methods[0]?.currency || null, subtotalUSD: amountUSD, methods,
    freeBoost: gate.extras.freeBoost ? gate.extras.freeBoost.id : null,
  };
}

/** Ask Coda (through the relay) what happened to a Coda order: 'paid' | 'pending' | 'failed' | 'unknown'. */
async function codaOrderState(order) {
  if (!order?.codaTxnId || !order?.codaCountry) return 'unknown';
  try {
    const r = await relayCall('coda/inquiry', { countryNumeric: order.codaCountry, txnId: order.codaTxnId });
    if (!r.ok) return 'unknown';
    return r.body?.state || 'unknown';
  } catch {
    return 'unknown';
  }
}

exports.createCheckout = onCall({ region: REGION }, async (request) => {
  const uid = requireBuyer(request);
  const data = request.data || {};
  if (data.options === true) return codaCheckoutOptions(uid, data);
  requireVerifiedEmail(request);
  try {
    // The client names WHAT and which method, never an amount.
    const { order, amountUSD, rate, buffer } = await orders.resolvePaymentOrder(uid, data);
    // In the Google Play app the order MUST carry Play's transaction token, or the
    // sale could not be reported to Google as its programs require.
    const play = data.play != null ? playTx.parsePlay(data.play) : null;
    if (data.play != null && !play) throw new HttpsError('invalid-argument', 'Missing Google Play transaction details.');
    return await startCodaOrder({
      uid, email: request.auth?.token?.email || null, order, subtotalUSD: amountUSD,
      amountEUR: order.priceEUR, rate, buffer, payType: Number(data.payType), play,
    });
  } catch (err) {
    // The buyer tried and never reached Coda's form: a Payments-tab record.
    await PR.recordIncident({
      route: PR.ROUTES.CODA, uid, stage: 'create_checkout', err,
      productId: String(data.sku || data.packId || data.subscriptionTier || (Array.isArray(data.cart) ? 'cart' : '') || '') || null,
      detail: { payType: data.payType ?? null, inPlay: data.play != null },
    });
    throw err;
  }
});

const settledReply = (order) => ({ status: 'settled', coins: order.coinsToCredit, vpBonus: order.vpBonus || 0 });

// Polled by the basket while Coda's form is open. Asks Coda (through the relay)
// so a paid order resolves at once instead of waiting for the 5-minute job.
exports.getCheckoutStatus = onCall({ region: REGION, secrets: require('./receipts').RECEIPT_SECRETS }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Login required');
  const referenceId = String(request.data?.referenceId || '');
  if (!referenceId) throw new HttpsError('invalid-argument', 'referenceId required');

  const ref = db.collection(COLLECTION).doc(referenceId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Order not found');
  const order = snap.data();
  if (order.uid !== uid) throw new HttpsError('permission-denied', 'Not your order');

  if (order.status === 'settled') return settledReply(order);
  if (order.status === 'expired') return { status: 'expired' };
  if (order.status !== 'awaiting_settlement' || order.rail !== 'coda') return { status: 'awaiting' };

  const codaState = await codaOrderState(order);
  if (codaState === 'paid') {
    const result = await orders.settleOrder(COLLECTION, referenceId, { source: 'coda-status' });
    if (result.credited) await PR.markCredited({ route: PR.ROUTES.CODA, orderId: referenceId, detail: 'settled by getCheckoutStatus' });
    if (result.credited && order.playExternalToken) await reportPlaySale(referenceId);
    if (result.credited || result.reason === 'already-settled') return settledReply(order);
  } else if (codaState === 'failed') {
    await ref.set({ status: 'expired', lastStatus: 'FAILED', expiredAt: FieldValue.serverTimestamp() }, { merge: true });
    await recordCodaEnd(referenceId, order, 'payment_failed');
    return { status: 'expired' };
  }
  return { status: 'awaiting' };
});

/**
 * A Coda order that ended without a credit, on the Payments tab.
 *   payment_failed   Coda declined it: nothing charged, no alert
 *   abandoned        the buyer never paid: no alert
 *   settle_failed    Coda says PAID and we did not credit: needs attention
 *   play_unreported  in-app sale Google has not been told about after 20h: needs attention
 */
async function recordCodaEnd(orderId, order, kind, err = null) {
  const attention = {
    settle_failed: 'Coda says paid but coins were not credited',
    play_unreported: 'In-app Coda sale not reported to Google Play after 20 hours',
  }[kind] || null;
  const status = { payment_failed: 'failed', abandoned: 'abandoned' }[kind] || 'failed';
  await PR.recordIncident({
    route: order?.rail === 'codashop' ? PR.ROUTES.CODASHOP : PR.ROUTES.CODA,
    uid: order?.uid || null, orderId, stage: kind, err, status, attention,
    productId: order?.subscriptionTier ? `plan:${order.subscriptionTier}`
      : (Array.isArray(order?.lines) && order.lines.map((l) => l && l.sku).filter(Boolean).join(','))
        || order?.packSku || order?.codashopSku || order?.kind || null,
    detail: { codaTxnId: order?.codaTxnId || null, payType: order?.payType ?? null },
  });
}

// Reconciler, run by cron5Min. Settles paid orders whose status call never came
// (buyer closed the tab) and expires dead ones.
//
// Coda: some local methods (bank transfer, over the counter) settle hours after
// the buyer leaves and Coda reports them PENDING meanwhile. So an order expires
// ONLY on a definitive failure from Coda, or once it is a day old and Coda has
// answered; never because the relay could not answer ('unknown'), which would
// drop a real late payment. A week old expires regardless.
//
// Codashop: Coda calls top-up only AFTER payment, so an unsettled Codashop order
// means our side failed mid-way. Settle it.
//
// No orderBy, so no composite index: the pending set is small and sorted here.
async function pollCheckoutOrders() {
  const now = Date.now();
  const minAgeMs = 2 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;
  const pending = await db.collection(COLLECTION).where('status', '==', 'awaiting_settlement').limit(200).get();
  const docs = pending.docs
    .map((d) => ({ d, created: d.data().createdAt?.toMillis ? d.data().createdAt.toMillis() : 0 }))
    .sort((a, b) => a.created - b.created);
  let settled = 0;
  let expired = 0;
  for (const { d, created } of docs) {
    const order = d.data();
    const age = created ? now - created : Infinity;
    if (age < minAgeMs) continue;
    if (order.rail === 'codashop') {
      try {
        const r = await orders.settleOrder(COLLECTION, d.id, { source: 'codashop-poll' });
        if (r.credited) { settled++; await PR.markCredited({ route: order.rail === 'codashop' ? PR.ROUTES.CODASHOP : PR.ROUTES.CODA, orderId: d.id, detail: 'settled by pollCheckoutOrders' }); }
      } catch (err) {
        functions.logger.error('pollCheckoutOrders codashop settle failed', { refId: d.id, message: err.message });
        await recordCodaEnd(d.id, order, 'settle_failed', err);
      }
      continue;
    }
    if (order.rail !== 'coda') continue;
    const state = await codaOrderState(order);
    if (state === 'paid') {
      try {
        const r = await orders.settleOrder(COLLECTION, d.id, { source: 'coda-poll' });
        if (r.credited) { settled++; await PR.markCredited({ route: order.rail === 'codashop' ? PR.ROUTES.CODASHOP : PR.ROUTES.CODA, orderId: d.id, detail: 'settled by pollCheckoutOrders' }); }
      } catch (err) {
        functions.logger.error('pollCheckoutOrders coda settle failed', { refId: d.id, message: err.message });
        await recordCodaEnd(d.id, order, 'settle_failed', err);
      }
    } else if (state === 'failed' || (age > dayMs && state !== 'unknown') || age > 7 * dayMs) {
      await d.ref.set({
        status: 'expired', lastStatus: state === 'failed' ? 'FAILED' : 'TIMEOUT',
        expiredAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      await recordCodaEnd(d.id, order, state === 'failed' ? 'payment_failed' : 'abandoned');
      expired++;
    }
  }
  if (settled || expired) functions.logger.info('pollCheckoutOrders', { settled, expired, pending: docs.length });

  // Coda sales made in the Google Play app that Google has not been told about
  // yet. Single-field query, no index. Google wants each within 24 hours; a row
  // still pending after 20 hours is logged as an error so it gets seen.
  const unreported = await db.collection(COLLECTION).where('playReportPending', '==', true).limit(50).get();
  for (const d of unreported.docs) {
    const r = await reportPlaySale(d.id);
    const settledMs = d.data().settledAt?.toMillis ? d.data().settledAt.toMillis() : now;
    if (r.startsWith('failed') && now - settledMs > 20 * 60 * 60 * 1000) {
      functions.logger.error('Play external transaction still unreported after 20h', { refId: d.id, result: r });
      if (!d.data().playUnreportedRecorded) {
        await recordCodaEnd(d.id, d.data(), 'play_unreported', Object.assign(new Error(r), { code: 'internal' }));
        await d.ref.set({ playUnreportedRecorded: true }, { merge: true });
      }
    }
  }
}

// Report one settled in-app Coda sale to Google Play and clear the flag.
async function reportPlaySale(referenceId) {
  const ref = db.collection(COLLECTION).doc(referenceId);
  const snap = await ref.get();
  const o = snap.data() || {};
  if (!o.playExternalToken || o.playReportedAt) return 'already';
  let r;
  try { r = await playTx.reportOrder(o, referenceId); } catch (e) { r = 'failed:' + String(e?.message || e).slice(0, 200); }
  if (r === 'reported' || r === 'already') {
    await ref.set({ playReportPending: false, playReportedAt: FieldValue.serverTimestamp(), playReportResult: r }, { merge: true });
  } else {
    await ref.set({ playReportLastError: r, playReportTries: FieldValue.increment(1) }, { merge: true });
    functions.logger.warn('Play external transaction report failed', { refId: referenceId, result: r });
  }
  return r;
}

exports.pollCheckoutOrders = pollCheckoutOrders;
exports._internal_coda = { startCodaOrder, codaOrderState, codaCheckoutOptions, COLLECTION };

/**
 * What will this actually cost me, in the currency I will actually be charged.
 *
 * The buy screen used to show a EUR figure with "billed in USD/USDT" beneath
 * it, which meant the number on the button was never the number on the card
 * statement. That is the exact thing a payment processor objects to at
 * underwriting, and it is also just bad manners.
 *
 * So this runs the SAME two steps the payment path runs, in the same order,
 * against the same live rate: regional price first, FX second. The client
 * renders what comes back. There is no second calculation anywhere that could
 * drift from this one.
 *
 * Fails closed on FX exactly like the payment does: if no trustworthy rate is
 * available the quote errors rather than guessing, because a quote that
 * disagreed with the charge would be worse than no quote at all.
 */
exports.getCoinPriceQuote = onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

    const { packSku, customCoins, subscriptionTier, all, cart, method, itemSku } = request.data || {};

    // Fees and tax are quoted by the SERVER, on the same call that prices the
    // basket, so the breakdown and the total can never come from two different
    // calculations. `method` is the rail the buyer has selected; omitted means
    // "price only, no fee lines yet" (the pack grid, before a rail is chosen).
    const feesFor = async (subtotalUsd) => {
      if (!method || !(subtotalUsd > 0)) return null;
      try {
        const { quoteCheckout } = require('./checkoutFees');
        return await quoteCheckout({ subtotalUsd, method, uid });
      } catch (e) {
        // A fee-quote failure must not break the price quote: the buyer can
        // still see what the coins cost. It DOES mean we must not present a
        // total, which the client handles by falling back to the subtotal and
        // saying fees are shown at checkout.
        functions.logger.warn('checkout fee quote failed', { method, err: e?.message });
        return null;
      }
    };

    // The whole ladder in ONE call. The buy screen shows eight packs, and eight
    // round trips to price a single screen is how you make a wallet feel slow.
    // Region and FX are resolved once and applied across the ladder.
    if (all) {
      // No regional multiplier here. Coins are sold at ONE global per-coin rate
      // because they redeem at one global rate; see the note on the payment
      // path. This call exists to convert EUR to the USD the buyer is charged,
      // nothing more.
      // Native USD: the pack price IS the charged figure. No FX call, so this
      // can no longer fail because a rate provider is down.
      const entries = Object.entries(orders.COIN_PACKS).map(([sku, pack]) => (
        [sku, { coins: pack.coins, priceUSD: pack.priceUSD, amountUSD: pack.priceUSD }]
      ));
      return { currency: 'USD', packs: Object.fromEntries(entries) };
    }

    // CART TOTAL. Same server-side re-pricing as the payment path: the client
    // names packs and quantities, never an amount. One quote for the basket, so
    // the total on the cart button is the total on the statement.
    if (Array.isArray(cart) && cart.length) {
      let coinsTotal = 0;
      let usdTotal = 0;
      let itemCount = 0;
      const lines = [];
      for (const raw of cart.slice(0, 20)) {
        const sku = String(raw?.sku || '');
        const qty = Math.min(99, Math.max(1, Math.floor(Number(raw?.qty) || 0)));
        const pack = orders.COIN_PACKS[sku];
        if (pack) {
          coinsTotal += pack.coins * qty;
          usdTotal   += pack.priceUSD * qty;
          lines.push({ sku, qty, coins: pack.coins * qty, priceUSD: +(pack.priceUSD * qty).toFixed(2) });
          continue;
        }
        // Store items (VP bonuses, boosts) price off their own USD price, NEVER
        // off their coin cost. See the orders.STORE_ITEMS header.
        const it = orders.STORE_ITEMS[sku];
        if (!it) continue;
        itemCount += qty;
        usdTotal += it.priceUSD * qty;
        lines.push({
          sku, qty, coins: 0, kind: it.kind, name: it.name,
          priceUSD: +(it.priceUSD * qty).toFixed(2),
        });
      }
      if (!coinsTotal && !itemCount) throw new HttpsError('invalid-argument', 'Cart is empty.');
      const usd = +usdTotal.toFixed(2);
      return {
        coins: coinsTotal, priceUSD: usd, amountUSD: usd,
        currency: 'USD', fxRate: null, lines,
        checkout: await feesFor(usd),
      };
    }

    // COINS: native USD, no conversion. SUBSCRIPTIONS: still EUR, because they
    // carry regional multipliers and those are safe only on something consumed
    // rather than redeemed.
    // A single store item, for the Quick Buy sheet: it needs the fee lines
    // without building a basket first.
    if (itemSku) {
      const it = orders.STORE_ITEMS[String(itemSku)];
      if (!it) throw new HttpsError('invalid-argument', 'Unknown item');
      const qty = Math.min(99, Math.max(1, Math.floor(Number(request.data?.qty) || 1)));
      const usd = +(it.priceUSD * qty).toFixed(2);
      return {
        coins: 0, priceUSD: usd, amountUSD: usd, currency: 'USD', fxRate: null,
        item: { sku: String(itemSku), kind: it.kind, id: it.id, name: it.name, qty },
        checkout: await feesFor(usd),
      };
    }

    if (!subscriptionTier) {
      let coins = 0;
      let priceUSD = 0;
      if (packSku && packSku !== 'custom') {
        const pack = orders.COIN_PACKS[packSku];
        if (!pack) throw new HttpsError('invalid-argument', 'Unknown pack');
        priceUSD = pack.priceUSD;
        coins = pack.coins;
      } else {
        coins = Math.floor(Number(customCoins) || 0);
        priceUSD = +(coins * orders.CUSTOM_COIN_PRICE_USD).toFixed(2);
        if (!coins || priceUSD < orders.CUSTOM_MIN_USD) {
          throw new HttpsError('invalid-argument', `Minimum is $${orders.CUSTOM_MIN_USD}.`);
        }
      }
      return {
        coins,
        priceUSD,
        // THE NUMBER ON THE CARD STATEMENT (before fees and tax; `checkout.total`
        // is the figure the buyer actually pays once a rail is chosen).
        amountUSD: priceUSD,
        currency: 'USD',
        fxRate: null,
        checkout: await feesFor(priceUSD),
      };
    }

    const baseEUR = orders.TIER_EUR_PRICE[subscriptionTier];
    if (!baseEUR) throw new HttpsError('invalid-argument', 'Unknown subscription tier');
    const priceEUR = (await regionalPrice(uid, baseEUR)).priceEUR;
    const { amountUSD, rate } = await orders.priceEurToUsd(priceEUR);

    return {
      coins: 0,
      priceEUR,
      // THE NUMBER ON THE CARD STATEMENT.
      amountUSD,
      currency: 'USD',
      fxRate: rate,
    };
  },
);
