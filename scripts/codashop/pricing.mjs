// Codashop per-country prices. Coda takes 15% of the TAX-INCLUSIVE price and remits
// the tax out of it, so for us to net at least the web price W in a country with
// tax rate t:  P >= W / (1/(1+t) - 0.15), in USD, then converted at Coda's own rate.
import { storeItemBySku } from '../../src/utils/storeItems.js';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const DIR = path.dirname(fileURLToPath(import.meta.url)) + path.sep;
// Run: node scripts/codashop/pricing.mjs  (writes prices.json; exits 1 if any cell nets below web)
// fx-*.txt = each country's local price at a 1.29 USD default, read from the Coda portal.

const FEE = 0.15;
const SAFETY = 1.005; // Coda's displayed local prices are rounded; never let that eat the margin.

// Tax Coda deducts, from CODA'S OWN DATA (portal payment-methods fee endpoint, read 2026-09-28):
// the highest "applicableTax" on any Codashop channel in that country, raised to Coda's Codapay
// figure for the same country where that is higher (docs/processors/coda-payment-method-fees.md).
// "country-wise tax" rows (KH, JP, KR, MN) take Coda's Codapay figure (10% each).
// Countries with NO Codashop channel (nobody can buy there today) take 27%, the highest rate
// Coda deducts anywhere, so a channel opening later can never sell at a loss.
const NO_CHANNEL = 0.27;
const TAX = {
  Argentina: 0, Australia: .10, Austria: .20, Bahrain: 0, Bangladesh: 0, Belgium: .21, Bolivia: 0,
  Brazil: 0, Cambodia: .10, Canada: 0, Chile: 0, Colombia: .19, 'Czech Republic': .21, Denmark: .25,
  Ecuador: 0, Egypt: 0, Finland: .255, France: .20, Germany: .19, 'Great Britain (UK, Scotland, Wales)': .20,
  Greece: .24, Guatemala: 0, 'Hong Kong (香港地區)': 0, Hungary: .27, India: .18, Indonesia: .2515,
  Israel: 0, Italy: .22, Japan: .10, Kazakhstan: 0, Kuwait: 0, Laos: .10, Malaysia: .08, Mexico: 0,
  Mongolia: .10, Morocco: 0, Myanmar: .05, Netherlands: .21, 'New Zealand': 0, Nigeria: 0, Norway: .25,
  Pakistan: 0, Palestine: 0, Paraguay: 0, Peru: 0, Philippines: .12, Poland: .23, Portugal: .23,
  'Puerto Rico': 0, Qatar: 0, 'Republic of Ireland': .23, Romania: .21, 'Saudi Arabia': .15,
  Singapore: .09, Slovakia: .23, 'South Africa': 0, 'South Korea': .10, Spain: .21, 'Sri Lanka': 0,
  Sweden: .25, Switzerland: .081, 'Taiwan (台灣地區)': .05, Thailand: .07, Turkey: .20,
  'United Arab Emirates': .05, 'United States of America': 0, Uruguay: 0, Vietnam: 0,
  // no Codashop channel
  Algeria: NO_CHANNEL, China: NO_CHANNEL, Cyprus: NO_CHANNEL, 'Dominican Republic': NO_CHANNEL,
  Estonia: NO_CHANNEL, Ghana: NO_CHANNEL, Iraq: NO_CHANNEL, Kenya: NO_CHANNEL, Lithuania: NO_CHANNEL,
  Luxembourg: NO_CHANNEL, Latvia: NO_CHANNEL, Malta: NO_CHANNEL, Nepal: NO_CHANNEL, Slovenia: NO_CHANNEL,
  'Timor Leste': NO_CHANNEL, Tunisia: NO_CHANNEL, Ukraine: NO_CHANNEL, Uzbekistan: NO_CHANNEL,
};

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

// Local prices shown at a 1.29 USD default, read from the portal: "Country|CUR|value".
const fxLines = fs.readFileSync(DIR + 'fx-2026-09-28.txt', 'utf8').trim().split('\n');
const FX = {};
for (const l of fxLines) {
  const [country, cur, v] = l.split('|');
  if (!(country in TAX)) throw new Error('no tax rate for ' + country);
  const dec = (v.split('.')[1] || '').length;
  FX[country] = { cur, rate: Number(v) / 1.29, dec };
}
for (const c of Object.keys(TAX)) if (!FX[c]) throw new Error('no FX for ' + c);

const netFactor = t => 1 / (1 + t) - FEE;

function niceUp(x, dec) {
  if (dec === 0) {
    const step = x >= 100000 ? 100 : x >= 1000 ? 10 : 1;
    return Math.ceil(x / step) * step;
  }
  if (dec >= 3) return Math.ceil(x * 1000) / 1000;
  // two decimals: round up to the next value ending in 9 (x.x9)
  let p = Math.ceil((x + 0.01) * 10) / 10 - 0.01;
  if (p < x - 1e-9) p += 0.1;
  return Number(p.toFixed(2));
}

const plan = {};
const failures = [];
for (const [name, w] of Object.entries(WEB)) {
  const prices = {};
  for (const [country, { cur, rate, dec }] of Object.entries(FX)) {
    const usd = (w / netFactor(TAX[country])) * SAFETY;
    const local = niceUp(usd * rate, dec);
    prices[country] = local;
    // guard: net in USD at Coda's rate must be at least the web price
    const net = (local / rate) * netFactor(TAX[country]);
    if (net < w) failures.push(`${name} ${country} nets ${net.toFixed(4)} < ${w}`);
  }
  const us = prices['United States of America'];
  plan[name] = { web: w, def: us, prices };
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
fs.writeFileSync(DIR + 'prices.json', JSON.stringify(plan));
for (const [n, p] of Object.entries(plan)) {
  console.log(n.padEnd(24), 'web', p.web, '| US', p.def, '| GB', p.prices['Great Britain (UK, Scotland, Wales)'],
    'GBP | HU', p.prices.Hungary, 'HUF | ZA', p.prices['South Africa'], 'ZAR');
}
console.log('guard: every cell nets >= web price');
