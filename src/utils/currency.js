// Local-currency display.
// ─────────────────────────────────────────────────────────────────────────
// Base value currency = EUR (coin floor €0.009, subscriptions €4.99/€9.99,
// coin packs priceEUR). Every EUR amount in the UI — prices AND wallet balance
// valuations — is shown converted to the user's local currency. Actual checkout
// is always processed in USD/USDT (PayRam → USDC on Base); this is display only
// and is NEVER used to charge.
//
// `initLocalCurrency({country})` runs once on app start (when the profile loads)
// to resolve the target currency + prefetch rates, so the synchronous
// `formatMoneyFromEur()` / `convertFromEur()` used by formatters everywhere can
// convert during render. Rates come from a free, no-key FX feed
// (open.er-api.com) cached 24h in localStorage. If anything is missing we fall
// back to plain EUR — we never invent or hardcode a rate.

import { COUNTRIES } from './countries';

const BASE = 'EUR';
const FEED_URL = `https://open.er-api.com/v6/latest/${BASE}`;
const CACHE_KEY = 'vergr.fxRates.v1';
const CACHE_CUR_KEY = 'vergr.fxCurrency.v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// ISO region → currency code. Majors only; anything not listed (or a region we
// can't detect) falls back to EUR, which means "no conversion shown".
const REGION_CURRENCY = {
  US: 'USD', GB: 'GBP', IN: 'INR', CA: 'CAD', AU: 'AUD', NZ: 'NZD',
  JP: 'JPY', CN: 'CNY', HK: 'HKD', SG: 'SGD', KR: 'KRW', TW: 'TWD',
  CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK',
  HU: 'HUF', RO: 'RON', BG: 'BGN', UA: 'UAH', TR: 'TRY', RU: 'RUB',
  BR: 'BRL', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN',
  ZA: 'ZAR', NG: 'NGN', EG: 'EGP', KE: 'KES', MA: 'MAD', GH: 'GHS',
  AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', IL: 'ILS', PK: 'PKR',
  BD: 'BDT', LK: 'LKR', ID: 'IDR', MY: 'MYR', TH: 'THB', PH: 'PHP',
  VN: 'VND',
};

// Eurozone ISO-2 codes → EUR (the base price currency, so "no conversion").
const EUROZONE = ['AT', 'BE', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES', 'HR'];
// ISO-2 → currency. Non-EUR majors from REGION_CURRENCY + eurozone → EUR.
const CODE_CURRENCY = { ...REGION_CURRENCY };
EUROZONE.forEach((c) => { CODE_CURRENCY[c] = 'EUR'; });

// Resolve a profile country value (ISO-2 code OR full country name) to an ISO-2
// code, using the shared COUNTRIES list so legacy name-based values still map.
function isoFromValue(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const hit = COUNTRIES.find((c) => c.name.toLowerCase() === s.toLowerCase());
  return hit ? hit.code : '';
}

// Currency for a country value. Returns 'EUR' for eurozone (caller treats as
// no-conversion), the mapped currency for non-EUR, or null when the value can't
// be resolved to a country we know (caller then falls back to locale detection).
export function currencyForCountry(v) {
  const iso = isoFromValue(v);
  if (!iso) return null;
  return CODE_CURRENCY[iso] || null;
}

// Best-effort detection of the visitor's currency from their locale region.
export function detectCurrency() {
  try {
    const lang = (typeof navigator !== 'undefined' && (navigator.language || navigator.languages?.[0])) || '';
    if (!lang) return null;
    const loc = new Intl.Locale(lang);
    const region = (loc.maximize ? loc.maximize().region : loc.region) || '';
    return REGION_CURRENCY[region.toUpperCase()] || null;
  } catch {
    return null;
  }
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.rates || !parsed?.fetchedAt) return null;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed.rates;
  } catch {
    return null;
  }
}

let inflight = null;
// Synchronous module state so formatters can convert during render. _rates is
// warm-loaded from localStorage at import; _currency is resolved by
// initLocalCurrency() once the profile is known.
let _rates = readCache();
let _currency = (() => { try { return localStorage.getItem(CACHE_CUR_KEY) || null; } catch { return null; } })();
const _subs = new Set();
const _emit = () => { _subs.forEach((cb) => { try { cb(); } catch { /* ignore */ } }); };

// Subscribe to currency-state changes (rates loaded / target resolved). Returns
// an unsubscribe fn. Used by React via a version bump so the UI re-renders once
// conversion becomes available on a cold load.
export const subscribeCurrency = (cb) => { _subs.add(cb); return () => _subs.delete(cb); };

// Returns { [currencyCode]: rateFromEUR } or null. Cached 24h; one request
// at a time across all callers.
export async function getRates() {
  const cached = readCache();
  if (cached) { _rates = cached; return cached; }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(FEED_URL, { headers: { accept: 'application/json' } });
      const data = await res.json();
      if (data?.result !== 'success' || !data?.rates) return null;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ rates: data.rates, fetchedAt: Date.now() })); } catch { /* private mode */ }
      _rates = data.rates;
      return data.rates;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Resolve the target currency from the user's profile country (ISO-2 or name),
// falling back to browser locale only when no country is set, then prefetch
// rates. Call once when the profile loads. Idempotent-ish (safe to re-call when
// the country changes). Notifies subscribers so the UI re-renders.
export async function initLocalCurrency({ country } = {}) {
  let currency;
  if (country) currency = currencyForCountry(country) || detectCurrency();
  else currency = detectCurrency();
  _currency = (currency && currency !== BASE) ? currency : null;
  try { if (_currency) localStorage.setItem(CACHE_CUR_KEY, _currency); else localStorage.removeItem(CACHE_CUR_KEY); } catch { /* private mode */ }
  _emit();
  if (_currency) {
    const rates = await getRates();
    if (rates) _emit();
  }
}

// Plain EUR formatting (the base currency / fallback).
export function formatEur(n) {
  if (n == null || isNaN(n)) return '€0.00';
  try { return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(n); }
  catch { return `€${Number(n).toFixed(2)}`; }
}

// Synchronous convert. Returns { currency, amount } or null when no conversion
// applies (EUR target, rates not ready). Uses the module state set by init.
export function convertFromEur(eur) {
  if (eur == null || isNaN(eur)) return null;
  if (!_currency || !_rates) return null;
  const rate = _rates[_currency];
  if (!rate) return null;
  return { currency: _currency, amount: Number(eur) * rate };
}

// ── USDC ────────────────────────────────────────────────────────────
// Withdrawals actually settle in USDC on Base, so for wallet surfaces USDC is
// the honest unit to lead with — it is what the user will really receive.
// The internal base currency is still EUR, so this is a real FX conversion and
// the number moves with the rate. Returns null when rates aren't loaded yet;
// callers should fall back to EUR rather than printing a wrong figure.
export function eurToUsdc(eur) {
  if (eur == null || isNaN(eur)) return null;
  const rate = _rates?.USD;
  if (!rate) return null;
  return Number(eur) * rate;
}

/** "54.00 USDC" — or null if the rate isn't available. */
export function formatUsdc(eur) {
  const v = eurToUsdc(eur);
  if (v == null) return null;
  return `${v.toFixed(2)} USDC`;
}

/** USDC amount → EUR, for the reverse direction of a dual-currency input. */
export function usdcToEur(usdc) {
  if (usdc == null || isNaN(usdc)) return null;
  const rate = _rates?.USD;
  if (!rate) return null;
  return Number(usdc) / rate;
}

// ── USD-priced things ───────────────────────────────────────────────
// Coin packs went native USD on 2026-08-11: USD is the currency displayed AND
// charged, and the local figure beside it is an ESTIMATE only, never the charged
// amount. The rate table here is keyed off EUR, so a USD amount has to be routed
// back through EUR to reach the buyer's currency.
//
// Returns null when rates are not loaded. Callers must fall back to showing the
// plain USD price rather than printing a wrong local figure: an estimate that is
// silently wrong is worse than no estimate, because it is the number the buyer
// will quote back when the statement disagrees.

/** USD → the user's local currency. `{ currency, amount }` or null. */
export function convertFromUsd(usd) {
  if (usd == null || isNaN(usd)) return null;
  if (!_currency || !_rates) return null;
  const usdRate = _rates.USD;
  const target = _rates[_currency];
  if (!usdRate || !target) return null;
  return { currency: _currency, amount: (Number(usd) / usdRate) * target };
}

/** "≈ £7.85" for a USD amount, or null when no conversion applies. */
export function formatMoneyFromUsd(usd, { prefix = '' } = {}) {
  const c = convertFromUsd(usd);
  if (!c) return null;
  try {
    return prefix + new Intl.NumberFormat(navigator.language || 'en', {
      style: 'currency', currency: c.currency,
    }).format(c.amount);
  } catch {
    return null;
  }
}

/** "$9.99". The charged figure for anything priced in USD. */
export function formatUsd(n) {
  if (n == null || isNaN(n)) return '$0.00';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n); }
  catch { return `$${Number(n).toFixed(2)}`; }
}

// Synchronous "format a EUR amount in the user's currency", falling back to
// plain EUR. This is what the app-wide money formatters delegate to.
export function formatMoneyFromEur(eur, { prefix = '' } = {}) {
  const c = convertFromEur(eur);
  if (!c) return formatEur(eur);
  try {
    // No fraction override — Intl uses each currency's standard precision
    // (2 for GBP/USD/EUR, 0 for JPY/KRW), so conversions stay exact (£432.51).
    return prefix + new Intl.NumberFormat(navigator.language || 'en', {
      style: 'currency', currency: c.currency,
    }).format(c.amount);
  } catch {
    return formatEur(eur);
  }
}

// Convert a EUR amount to the visitor's local currency and format it.
// Returns null when no conversion applies (EUR users, undetected region, or a
// feed failure) so callers render nothing rather than a broken value.
// `country` (optional) is the user's profile country (ISO-2 code or name). When
// given, it takes priority over locale detection — this is what makes the
// estimate match the user's real country instead of their browser language
// (e.g. an en-US browser in the UK). Unresolvable values fall back to locale.
export async function getLocalPriceEstimate(eurAmount, country) {
  if (!(eurAmount > 0)) return null;
  let currency;
  if (country) {
    currency = currencyForCountry(country) || detectCurrency();
  } else {
    currency = detectCurrency();
  }
  if (!currency || currency === BASE) return null;
  const rates = await getRates();
  const rate = rates?.[currency];
  if (!rate) return null;
  const amount = eurAmount * rate;
  let formatted;
  try {
    formatted = new Intl.NumberFormat(navigator.language || 'en', {
      style: 'currency', currency,
      maximumFractionDigits: amount >= 100 ? 0 : 2,
    }).format(amount);
  } catch {
    return null;
  }
  return { currency, amount, formatted };
}
