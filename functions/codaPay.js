// Codapay (Coda Payments) — the browser checkout rail beside PayRam.
//
// PURE: no firebase, no secret, no network. Used by the Cloud Functions
// (functions/payram.js) AND copied to box 1 beside the relay
// (infra/mercury-relay/server.cjs), because Coda's API key lives on box 1
// (founder, 2026-09-24: free, next to the Mercury tokens) and every call that
// needs the key is made there.
//
// What Codapay is, from docs.coda.co (read 2026-09-24):
// - Hosted Payment Page. We POST init.json with the item name and price, get a
//   txnId + redirectUrl, and send the buyer to Coda's page. "You do not need to
//   pre-create inventory SKUs": nothing is created in the Coda portal per product.
// - Prices may be sent in USD (currency 840); Coda converts to the buyer's local
//   currency at mid-market. User payments are always in the local currency of
//   the COUNTRY sent, so country decides the payment methods shown.
// - US and Canada accept ONE item per payment, so we always send exactly one.
// - No managed subscriptions yet ("coming soon", cards only). Lite/Pro are sold
//   as a one-off month, the same way PayRam already sells them (founder decision).
// - The completion notification is a GET with
//   Checksum = md5(txnId + apiKey + orderId + resultCode), lowercase hex.

const crypto = require('node:crypto');

const CODA_URLS = {
  sandbox: {
    init: 'https://sandbox.codapayments.com/airtime/api/restful/v2.0/Payment/init.json',
    inquiry: 'https://sandbox.codapayments.com/airtime/api/restful/v2.0/Payment/inquiryPaymentResult.json',
    componentInit: 'https://sandbox.codapayments.com/airtime/api/restful/v2.0/Payment/Component/init.json',
  },
  production: {
    init: 'https://airtime.codapayments.com/airtime/api/restful/v2.0/Payment/init.json',
    inquiry: 'https://airtime.codapayments.com/airtime/api/restful/v2.0/Payment/inquiryPaymentResult.json',
    componentInit: 'https://airtime.codapayments.com/airtime/api/restful/v2.0/Payment/Component/init.json',
  },
};

/** ISO 4217 numeric for USD. Every price we send is USD; Coda converts. */
const CURRENCY_USD = 840;

/** payType 0 = Coda's channel selection page (cards and local methods for the country). */
const PAY_TYPE_SELECTION = 0;

/**
 * Countries Codapay supports, alpha-2 -> Coda's numeric country code, from
 * docs.coda.co "Country and Currency Codes" (2026-09-24). Russia (643) is on
 * Coda's list and deliberately NOT here: it is on Vergr's sanctioned list
 * (functions/geo.js BLOCKED_COUNTRIES).
 */
const CODA_COUNTRIES = {
  DZ: 12, AR: 32, AU: 36, AT: 40, BH: 48, BD: 50, BE: 56, BO: 68, BR: 76, KH: 116,
  CL: 152, CO: 170, CA: 124, CZ: 203, DK: 208, DO: 214, EC: 218, EG: 818, FR: 250,
  FI: 246, DE: 276, GR: 300, GT: 320, HK: 344, HU: 348, IN: 356, ID: 360, IQ: 368,
  IE: 372, IL: 376, IT: 380, JP: 392, KZ: 398, KE: 404, KR: 410, KW: 414, LA: 418,
  MY: 458, MX: 484, MN: 496, MA: 504, NL: 528, NP: 524, NZ: 554, NG: 566, NO: 578,
  PK: 586, PY: 600, PE: 604, PH: 608, PL: 616, PT: 620, PR: 630, QA: 634, RO: 642,
  SA: 682, SG: 702, SK: 703, ZA: 710, ES: 724, LK: 144, SE: 752, CH: 756, TW: 158,
  TH: 764, TL: 626, TR: 792, AE: 784, GB: 826, US: 840, UY: 858, UZ: 860, VN: 704,
  MM: 104,
};

/** Null when Coda does not serve this country. */
function codaCountry(alpha2) {
  const c = String(alpha2 || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CODA_COUNTRIES, c) ? CODA_COUNTRIES[c] : null;
}

/** Our order id: 4-64 chars, unique, and recognisable as Coda in payram_orders. */
function codaOrderId(uid, now = Date.now(), rand = crypto.randomBytes(4).toString('hex')) {
  const u = String(uid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'anon';
  return `coda_${u}_${now}_${rand}`;
}

/**
 * The init.json body. Always ONE item: US and Canada accept only one, and a
 * basket is one purchase anyway. The price is USD with two decimals.
 */
function buildInitBody({ apiKey, projectId, countryNumeric, orderId, uid, itemName, priceUSD, returnUrl }) {
  if (!apiKey) throw new Error('coda: apiKey is required');
  if (!projectId) throw new Error('coda: projectId is required');
  if (!Number.isInteger(countryNumeric)) throw new Error('coda: countryNumeric is required');
  if (!orderId || orderId.length < 4 || orderId.length > 64) throw new Error('coda: orderId must be 4-64 chars');
  if (!uid) throw new Error('coda: uid is required');
  const cents = Math.round(Number(priceUSD) * 100);
  if (!Number.isFinite(cents) || cents <= 0) throw new Error('coda: priceUSD must be positive');
  const body = {
    initRequest: {
      country: countryNumeric,
      payType: PAY_TYPE_SELECTION,
      apiKey,
      projectId: Number(projectId),
      orderId,
      currency: CURRENCY_USD,
      items: [{ code: '1', name: String(itemName || 'Vergr purchase').slice(0, 80), price: cents / 100 }],
      profile: { entry: [{ key: 'user_id', value: String(uid) }] },
    },
  };
  // Key is `return_url` inside profile.entry (docs.coda.co, "Redirect URLs for
  // Transaction Status"); it overrides the portal's landing URL, and Coda
  // appends TxnId + OrderId when it sends the buyer back.
  if (returnUrl) body.initRequest.profile.entry.push({ key: 'return_url', value: String(returnUrl) });
  return body;
}

/** init.json response -> { ok, txnId, redirectUrl, resultCode }. txnId stays a STRING (it exceeds 2^53). */
function parseInitResponse(text) {
  const txnMatch = /"txnId"\s*:\s*"?(\d+)"?/.exec(String(text || ''));
  let json = null;
  try { json = JSON.parse(text); } catch { /* handled below */ }
  const r = json?.initResult || {};
  const resultCode = Number(r.resultCode);
  const txnId = txnMatch ? txnMatch[1] : null;
  return {
    ok: resultCode === 0 && !!txnId && typeof r.redirectUrl === 'string' && r.redirectUrl.startsWith('https://'),
    resultCode: Number.isFinite(resultCode) ? resultCode : null,
    resultDesc: r.resultDesc || null,
    txnId,
    redirectUrl: typeof r.redirectUrl === 'string' ? r.redirectUrl : null,
  };
}

/** inquiryPaymentResult.json body. */
function buildInquiryBody({ apiKey, projectId, countryNumeric, txnId }) {
  if (!apiKey || !projectId || !txnId || !Number.isInteger(countryNumeric)) {
    throw new Error('coda: apiKey, projectId, countryNumeric and txnId are required');
  }
  // txnId is sent as a bare number without passing through a JS double.
  return `{"inquiryPaymentRequest":{"apiKey":${JSON.stringify(apiKey)},"txnId":${/^\d+$/.test(String(txnId)) ? String(txnId) : '0'},"projectId":${JSON.stringify(String(projectId))},"country":${countryNumeric},"needStatusFinal":"true"}}`;
}

/**
 * inquiry response -> 'paid' | 'pending' | 'failed'.
 * resultCode 0 = success; 431 or 216 = pending; anything else = failed
 * (docs.coda.co "Check a transaction status").
 */
function inquiryState(text) {
  let json = null;
  try { json = JSON.parse(text); } catch { return { state: 'unknown' }; }
  const r = json?.paymentResult || {};
  const code = Number(r.resultCode);
  if (!Number.isFinite(code)) return { state: 'unknown' };
  if (code === 0) return { state: 'paid', resultCode: code };
  if (code === 431 || code === 216) return { state: 'pending', resultCode: code };
  return { state: 'failed', resultCode: code, resultDesc: r.resultDesc || null };
}

/**
 * Is a completion notification genuinely from Coda?
 * Checksum = md5(TxnId + apiKey + OrderId + ResultCode), lowercase hex. Compared
 * in constant time. A notification that fails this is ignored entirely.
 */
function notificationValid({ TxnId, OrderId, ResultCode, Checksum }, apiKey) {
  if (!apiKey || !TxnId || !OrderId || ResultCode == null || !Checksum) return false;
  const expected = crypto.createHash('md5').update(`${TxnId}${apiKey}${OrderId}${ResultCode}`).digest('hex');
  const got = String(Checksum).toLowerCase();
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/**
 * EMBEDDED CHECKOUT (Coda "Hosted Component"). Coda's form is mounted inside
 * Vergr's own page, so the buyer never leaves (a few wallets, e.g. GCash, still
 * hand off to their own app and come back). One payment METHOD per request
 * (payType), priced in LOCAL currency: codaPricing.js grosses the price up for
 * that method's fee, fixed fee and tax, so Vergr receives the full web price.
 * Verified in the sandbox 2026-09-25 (ZAR, GBP, PHP, BRL all return a session).
 */
function buildComponentInitBody({ apiKey, projectId, countryNumeric, payType, currencyNumeric, orderId, uid, itemName, price, shopper }) {
  if (!apiKey) throw new Error('coda: apiKey is required');
  if (!projectId) throw new Error('coda: projectId is required');
  if (!Number.isInteger(countryNumeric)) throw new Error('coda: countryNumeric is required');
  if (!Number.isInteger(payType) || payType <= 0) throw new Error('coda: payType is required');
  if (!Number.isInteger(currencyNumeric)) throw new Error('coda: currencyNumeric is required');
  if (!orderId || orderId.length < 4 || orderId.length > 64) throw new Error('coda: orderId must be 4-64 chars');
  if (!uid) throw new Error('coda: uid is required');
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('coda: price must be positive');
  return {
    initRequest: {
      country: countryNumeric,
      payType,
      apiKey,
      projectId: Number(projectId),
      orderId,
      currency: currencyNumeric,
      items: [{ code: '1', name: String(itemName || 'Vergr purchase').slice(0, 80), price: amount }],
      profile: { entry: [{ key: 'user_id', value: String(uid) }] },
      // Saved cards (docs.coda.co "Saving Card Details", Hosted Component):
      // Coda's form shows "save this card" and lists the buyer's saved cards.
      // partnerShopperId is our uid, so a returning buyer is recognised.
      ...(shopper ? {
        enableSavePaymentMethod: true,
        displaySavedPaymentMethodList: true,
        userInitiated: true,
        shopper: {
          entry: [
            { key: 'partnerShopperId', value: String(uid) },
            ...(shopper.email ? [{ key: 'email', value: String(shopper.email).slice(0, 120) }] : []),
          ],
        },
      } : {}),
    },
  };
}

/** component init response -> { ok, txnId (STRING), clientSecret, resultCode, resultDesc }. */
function parseComponentInitResponse(text) {
  const txnMatch = /"txnId"\s*:\s*"?(\d+)"?/.exec(String(text || ''));
  let json = null;
  try { json = JSON.parse(text); } catch { /* handled below */ }
  const r = json?.initResult || {};
  const resultCode = Number(r.resultCode);
  const txnId = txnMatch && txnMatch[1] !== '0' ? txnMatch[1] : null;
  const clientSecret = typeof r.clientSecret === 'string' ? r.clientSecret : null;
  return {
    ok: resultCode === 0 && !!txnId && !!clientSecret,
    resultCode: Number.isFinite(resultCode) ? resultCode : null,
    resultDesc: r.resultDesc || null,
    txnId,
    clientSecret,
  };
}

/** A readable one-line item name for Coda's page and the buyer's statement. */
function itemNameFor(order) {
  if (order.kind === 'subscription') return `Vergr ${order.tier === 'pro' ? 'Pro' : 'Lite'} (1 month)`;
  const parts = [];
  if (order.coins > 0) parts.push(`${Number(order.coins).toLocaleString('en-US')} Coins`);
  const items = Array.isArray(order.items) ? order.items.length : 0;
  if (items) parts.push(items === 1 ? '1 extra' : `${items} extras`);
  return `Vergr ${parts.join(' + ') || 'purchase'}`;
}

module.exports = {
  CODA_URLS, CURRENCY_USD, PAY_TYPE_SELECTION, CODA_COUNTRIES,
  codaCountry, codaOrderId, buildInitBody, parseInitResponse,
  buildInquiryBody, inquiryState, notificationValid, itemNameFor,
  buildComponentInitBody, parseComponentInitResponse,
};
