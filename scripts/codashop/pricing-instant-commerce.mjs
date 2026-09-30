// Coda Instant commerce ("Custom Commerce") per-country SKU prices.
// Coda's own data (portal payment-methods fee endpoint, integrationType
// 'Custom Commerce', read 2026-09-28, 169 channel rows): per channel a
// percentage fee, a FIXED fee per transaction in local currency, and the tax Coda
// deducts from the price. Worst channel per country, so no channel can lose money:
//   net = P/(1+t) - f*P - F  >=  W   =>   P >= (W + F) / (1/(1+t) - f)
// (fee taken on the tax-inclusive price: the larger deduction.)
// Run: node scripts/codashop/pricing-instant-commerce.mjs   (exits 1 if any cell nets below web)
import { storeItemBySku } from '../../src/utils/storeItems.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const DIR = path.dirname(fileURLToPath(import.meta.url)) + path.sep;
const SAFETY = 1.005;

// [tax, max fee %, max fixed fee in LOCAL currency], from Coda's Custom Commerce rows.
const CC = {
  Argentina: [0, 11.6, 360], Australia: [10, 7.7, 0.37], Austria: [20, 6.3, 0.33], Bangladesh: [0, 32.0, 0],
  Belgium: [21, 7.4, 0.23], Bolivia: [0, 10.2, 1.8], Canada: [0, 7.7, 0.36], Chile: [0, 10.3, 235],
  Colombia: [19, 8.7, 940], 'Czech Republic': [21, 6.1, 5.40], Denmark: [25, 7.0, 1.95], Ecuador: [0, 10.65, 0.25],
  Egypt: [0, 10.75, 14], Finland: [25.5, 6.1, 0.23], France: [20, 6.1, 0.23], Germany: [19, 16.8, 0.23],
  'Great Britain (UK, Scotland, Wales)': [20, 7.4, 0.20], Greece: [24, 6.1, 0.23], Guatemala: [0, 9.7, 2],
  'Hong Kong (香港地區)': [0, 8.1, 2.05], Hungary: [27, 6.1, 81], India: [18, 6.8, 0], Indonesia: [11, 9.5, 4450],
  Israel: [0, 0, 0], Italy: [22, 6.1, 0.23], Japan: [10, 11.2, 42], Kazakhstan: [0, 10.75, 125],
  Malaysia: [8, 8.0, 1.05], Mexico: [0, 16.8, 7], Mongolia: [10, 27.7, 0], Morocco: [0, 8.4, 2.40],
  Myanmar: [5, 39.0, 0], Netherlands: [21, 6.6, 0.48], 'New Zealand': [0, 8.0, 0.45], Nigeria: [0, 10.2, 365],
  Norway: [25, 7.0, 2.5], Pakistan: [0, 10.5, 72], Palestine: [0, 0, 0], Paraguay: [0, 10.75, 1700],
  Peru: [0, 8.2, 0.90], Philippines: [12, 8.4, 16], Poland: [23, 6.6, 0.95], Portugal: [23, 9.0, 0.33],
  'Puerto Rico': [0, 0, 0], Qatar: [0, 8.2, 0.95], 'Republic of Ireland': [23, 6.1, 0.23], Romania: [21, 5.6, 1.15],
  Slovakia: [23, 6.1, 0.23], 'South Africa': [0, 8.5, 4.30], 'South Korea': [10, 15.4, 155], Spain: [21, 6.1, 0.23],
  Sweden: [25, 6.1, 2.45], Switzerland: [8.1, 8.1, 0.21], 'Taiwan (台灣地區)': [5, 21.7, 0], Thailand: [7, 27.0, 8.30],
  Turkey: [20, 6.7, 12], 'United States of America': [0, 7.8, 0.28], Uruguay: [0, 10.3, 11], Vietnam: [0, 25.0, 6800],
};
// Coda's tax from its OTHER lists (Codashop + Codapay), used when higher (same rule as pricing.mjs).
const OTHER_TAX = { Indonesia: 25.15, Japan: 10, Cambodia: 10, 'South Korea': 10, Mongolia: 10, Laos: 10, 'United Arab Emirates': 5, 'Saudi Arabia': 15, Singapore: 9, Colombia: 19 };

const fxLines = fs.readFileSync(DIR + 'fx-2026-09-28.txt', 'utf8').trim().split('\n');
const FX = {};
for (const l of fxLines) {
  const [country, cur, v] = l.split('|');
  FX[country] = { cur, rate: Number(v) / 1.29, dec: (v.split('.')[1] || '').length };
}

// Countries with NO Custom Commerce channel today (nobody can buy there): the worst
// case Coda shows anywhere, so a channel opening later cannot sell at a loss.
const fees = Object.values(CC);
const WORST_FEE = Math.max(...fees.map((x) => x[1]));
const WORST_TAX = Math.max(27, ...fees.map((x) => x[0]));
const WORST_FIXED_USD = Math.max(...Object.entries(CC).map(([c, x]) => (FX[c] ? x[2] / FX[c].rate : 0)));

function params(country) {
  const cc = CC[country];
  if (!cc) return { t: WORST_TAX / 100, f: WORST_FEE / 100, F: WORST_FIXED_USD * FX[country].rate, channel: false };
  const t = Math.max(cc[0], OTHER_TAX[country] || 0) / 100;
  return { t, f: cc[1] / 100, F: cc[2], channel: true };
}

function niceUp(x, dec) {
  if (dec === 0) { const step = x >= 100000 ? 100 : x >= 1000 ? 10 : 1; return Math.ceil(x / step) * step; }
  if (dec >= 3) return Math.ceil(x * 1000) / 1000;
  let p = Math.ceil((x + 0.01) * 10) / 10 - 0.01;
  if (p < x - 1e-9) p += 0.1;
  return Number(p.toFixed(2));
}

const WEB = {
  'Starter Pack': 0.99, 'Gamer Pack': 4.99, 'Pro Pack': 9.99, 'Elite Pack': 19.99, 'Legend Pack': 49.99,
  'Champion Pack': 99.99, 'Titan Pack': 149.99, 'Ascendant Pack': 249.99,
  'Vergr Lite (1 month)': 4.99, 'Vergr Pro (1 month)': 9.99,
};
const ITEMS = {
  'Happy Hour': 'vpb_happy_hour', 'Flash Surge': 'vpb_flash', 'Half-Day Surge': 'vpb_half_day', 'Day Surge': 'vpb_day',
  'Weekend Surge': 'vpb_weekend', 'Long Surge': 'vpb_long', 'Creator Surge': 'vpb_creator',
  'Community Surge': 'vpb_community', 'Watcher Surge': 'vpb_watcher', 'Post Boost': 'boost_post',
  'Teammate Search Boost': 'boost_lfg', 'Profile Boost': 'boost_profile', 'Squad Boost': 'boost_squad',
  'Stream Boost': 'boost_stream_boost', 'Super Boost': 'boost_stream_super', 'Mega Boost': 'boost_stream_mega',
};
for (const [name, sku] of Object.entries(ITEMS)) {
  const it = storeItemBySku(sku);
  const w = it?.priceUSD ?? it?.item?.priceUSD;
  if (!w) throw new Error('no web price for ' + sku);
  WEB[name] = w;
}

const countries = Object.keys(FX);
const plan = {};
const failures = [];
for (const [name, w] of Object.entries(WEB)) {
  const prices = [];
  for (const c of countries) {
    const { rate, dec } = FX[c];
    const { t, f, F } = params(c);
    const k = 1 / (1 + t) - f;
    if (k <= 0) throw new Error('impossible margin for ' + c);
    const local = niceUp(((w * rate * SAFETY) + F) / k, dec);
    prices.push(local);
    const netUsd = (local / (1 + t) - f * local - F) / rate;
    if (netUsd < w) failures.push(`${name} ${c} nets ${netUsd.toFixed(4)} < ${w}`);
  }
  plan[name] = [prices[countries.indexOf('United States of America')], prices];
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
fs.writeFileSync(DIR + 'prices-instant-commerce.json', JSON.stringify({ C: countries, P: plan }));
const show = (n, c) => plan[n][1][countries.indexOf(c)];
for (const n of Object.keys(plan)) {
  console.log(n.padEnd(24), 'web', WEB[n], '| US', show(n, 'United States of America'), '| GB', show(n, 'Great Britain (UK, Scotland, Wales)'),
    '| DE', show(n, 'Germany'), '| ZA', show(n, 'South Africa'));
}
console.log(`no-channel countries use fee ${WORST_FEE}%, tax ${WORST_TAX}%, fixed $${WORST_FIXED_USD.toFixed(3)}`);
console.log('guard: every cell nets >= web price');
