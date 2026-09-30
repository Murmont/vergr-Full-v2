// Local price for a Codapay purchase, per payment method.
//
// FOUNDER RULE (2026-09-25): a Coda sale must never lose money or have its profit
// eaten. Coda charges the buyer exactly the price we send, then deducts the tax
// and its fee for that payment method before paying Vergr. So the price we send
// is grossed up until what Vergr RECEIVES is at least the web USD price, the same
// as a direct web sale. The creator share and Vergr's margin are therefore
// identical whichever method the buyer picks. There is no separate fee line: it
// reads as the local price.
//
//   received = price / (1 + tax) x (1 - fee) - fixed          (local currency)
//   need     received >= webUSD x rate x (1 + FX_BUFFER)
//   => price = (webUSD x rate x (1 + FX_BUFFER) + fixed) x (1 + tax) / (1 - fee),
//      then rounded UP to a tidy local price.
//
// FX_BUFFER covers the rate moving between checkout and Coda's monthly USD
// settlement, and Coda's currency conversion (agreement 4.4(d)). It applies ONLY
// when the buyer pays in another currency: a USD sale has no conversion, and
// charging it there was an error (founder caught it, 2026-09-25). The live rate is
// fetched at checkout, never stored in a table, so prices do not drift.

const { COUNTRY_CURRENCY, WHOLE_CURRENCIES } = require('./codaMethods');

const FX_BUFFER = 0.02;
const RATE_URL = 'https://open.er-api.com/v6/latest/USD';
const RATE_TTL_MS = 60 * 60 * 1000;

let rateCache = { at: 0, rates: null };

/** Live USD -> local rates, cached for an hour. Throws when unavailable (fail closed). */
async function usdRates(fetchImpl = fetch) {
  if (rateCache.rates && Date.now() - rateCache.at < RATE_TTL_MS) return rateCache.rates;
  const r = await fetchImpl(RATE_URL);
  const j = await r.json();
  if (j?.result !== 'success' || !j.rates?.EUR) throw new Error('fx rates unavailable');
  rateCache = { at: Date.now(), rates: j.rates };
  return j.rates;
}

/**
 * Round UP to the nearest tidy local price, as SMALL a step as reads naturally.
 * The first version reused the Play tables' coarse steps and turned $104.63 into
 * $109.99; every extra cent here is the buyer's, not a cost of ours.
 *   cents currencies: under 10 -> next .x4 or .x9 (5-cent steps), otherwise -> next whole .99
 *   whole currencies: next 1 under 1,000, next 10 under 100,000, else next 100
 */
function tidyUp(v, currency) {
  if (WHOLE_CURRENCIES.has(currency)) {
    if (v >= 100000) return Math.ceil(v / 100) * 100;
    if (v >= 1000) return Math.ceil(v / 10) * 10;
    return Math.ceil(v);
  }
  if (v >= 10) {
    const c = Math.ceil(v) - 0.01;
    return c >= v ? c : c + 1;
  }
  const c = Math.ceil((v + 0.01) * 20) / 20 - 0.01;
  return Math.max(0.99, Math.round(c * 100) / 100);
}

/** Whole-cent or whole-unit value as Coda should receive it. */
function asAmount(v, currency) {
  return WHOLE_CURRENCIES.has(currency) ? Math.round(v) : Math.round(v * 100) / 100;
}

/**
 * The local price for one purchase on one method.
 * @returns {{ price:number, currency:string, rate:number }}
 */
function localPrice({ usd, method, rates }) {
  const currency = COUNTRY_CURRENCY[method.country];
  if (!currency) throw new Error(`no currency for ${method.country}`);
  const rate = currency === 'USD' ? 1 : rates[currency];
  if (!(rate > 0)) throw new Error(`no fx rate for ${currency}`);
  if (!(method.fee >= 0 && method.fee < 1)) throw new Error('bad method fee');
  const target = usd * rate * (currency === 'USD' ? 1 : 1 + FX_BUFFER);
  const raw = (target + (method.fixed || 0)) * (1 + (method.tax || 0)) / (1 - method.fee);
  let price = tidyUp(raw, currency);
  // Belt and braces: the rounding only ever goes up, but prove it before returning.
  while (receivedUsd({ price, method, rate }) < usd) price = tidyUp(price * 1.01, currency);
  return { price: asAmount(price, currency), currency, rate };
}

/**
 * The line items the buyer sees under "Taxes & fees", in LOCAL currency. They sum
 * to the price exactly: the tax is what Coda deducts for the government, the base
 * is the web price converted at today's rate, and the payment fee is everything
 * else (the method's % and fixed fee, the currency buffer, the rounding).
 */
function breakdown({ usd, price, method, rate, currency }) {
  const round = (v) => (WHOLE_CURRENCIES.has(currency) ? Math.round(v) : Math.round(v * 100) / 100);
  const base = round(usd * rate);
  const tax = round(price - price / (1 + (method.tax || 0)));
  const fee = round(price - base - tax);
  return { price: base, tax, fee, total: price };
}

/** What Vergr receives, in USD, from a sale at `price` on `method` (before FX buffer). */
function receivedUsd({ price, method, rate }) {
  const local = price / (1 + (method.tax || 0)) * (1 - method.fee) - (method.fixed || 0);
  return local / rate;
}

module.exports = { FX_BUFFER, usdRates, localPrice, receivedUsd, tidyUp, breakdown, _reset: () => { rateCache = { at: 0, rates: null }; } };
