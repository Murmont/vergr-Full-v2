// functions/playExternalTx.js — Coda sales made INSIDE the Google Play app,
// reported to Google Play (alternative billing / user choice billing).
//
// Google, both programs: "All transactions made through an alternative billing
// system must be reported to Google Play by calling the Google Play Developer API
// from your backend within 24 hours, providing an externalTransactionToken"
// (developer.android.com/google/play/billing/alternative/...). The app gets that
// token from Play Billing before the Coda form opens and hands it to
// createCheckout, which stores it on the checkout_orders row. orders.settleOrder
// marks the paid row `playReportPending`; this module reports it. The report is
// idempotent on our order id (externalTransactionId), so a retry is safe.
//
// Google's service fee on these sales is ADDED TO THE PRICE (founder rule: fees
// always on top, never a loss). See playFeeFor().

const { GoogleAuth } = require('google-auth-library');

const PACKAGE_NAME = 'com.vergr.desktop';

// Google's service fee on a sale through our own billing (Google 16954621,
// 13821247): 10% from 30 Jun 2026 in the US, UK and EEA (Australia and Japan
// from 30 Sep 2026); elsewhere the old pilot rule, the service fee (15% on the
// first $1M) reduced by 4 points = 11%. Charging the higher figure where unsure
// only ever costs the buyer a cent, never Vergr its margin.
const EEA = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV',
  'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO']);
const TEN_PERCENT = new Set(['US', 'GB', 'AU', 'JP', ...EEA]);
function playFeeFor(country) {
  return TEN_PERCENT.has(String(country || '').toUpperCase()) ? 0.10 : 0.11;
}

const PROGRAMS = new Set(['alternative', 'user_choice']);

/** Validate the Play fields the app sends with an in-app Coda checkout. */
function parsePlay(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const token = String(raw.token || '');
  const program = String(raw.program || '');
  if (!PROGRAMS.has(program) || token.length < 8 || token.length > 2048) return null;
  return { token, program };
}

let _auth = null;
async function accessToken() {
  if (!_auth) _auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
  const client = await _auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

const micros = (v) => String(Math.round(Number(v) * 1e6));

/** The request body for one settled order (pure, for the guard). */
function reportBody(order) {
  const price = Number(order.localPrice);
  const tax = price - price / (1 + (Number(order.codaTax) || 0));
  const settled = order.settledAt?.toDate ? order.settledAt.toDate() : new Date();
  return {
    originalPreTaxAmount: { priceMicros: micros(price - tax), currency: order.localCurrency },
    originalTaxAmount: { priceMicros: micros(tax), currency: order.localCurrency },
    transactionTime: settled.toISOString(),
    userTaxAddress: { regionCode: String(order.codaCountryCode || '').toUpperCase() },
    oneTimeTransaction: { externalTransactionToken: order.playExternalToken },
  };
}

/**
 * Report one order. Returns 'reported' | 'already' | 'failed:<reason>'.
 * A 409 means Google already has it (a retry after a lost reply).
 */
async function reportOrder(order, orderId, fetchImpl = fetch) {
  const url = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
    `${encodeURIComponent(PACKAGE_NAME)}/externalTransactions?externalTransactionId=${encodeURIComponent(orderId)}`;
  const r = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(reportBody(order)),
  });
  if (r.ok) return 'reported';
  if (r.status === 409) return 'already';
  const text = await r.text().catch(() => '');
  return `failed:${r.status}:${text.slice(0, 200)}`;
}

module.exports = { playFeeFor, parsePlay, reportBody, reportOrder, PACKAGE_NAME };
