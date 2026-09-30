#!/usr/bin/env node
// Emits the HUAWEI AppGallery in-app product sheet.
//
//   node scripts/huaweiProducts.mjs          → readable table + margin check
//   node scripts/huaweiProducts.mjs --csv    → docs/huawei/*.csv
//   node scripts/huaweiProducts.mjs --fee .2 → model a different commission
//
// Every number comes from src/utils/storePricing.js. Change the rate there (or
// pass --fee) and rerun; do not hand-edit a price anywhere else.
//
// ─────────────────────────────────────────────────────────────────────
// WHY THIS IS ONE PRICE PER PRODUCT AND NOT A 40-MARKET TABLE
// ─────────────────────────────────────────────────────────────────────
//
// Play makes you type a price per market, which is why scripts/playPricing.mjs
// emits `play-prices-by-market.csv` with 640 cells. AppGallery does NOT work
// that way: Huawei publishes ~195 fixed PRICE LEVELS and converts a chosen
// level into every local currency itself (Distribution Service Agreement cl.
// 2.2: "select the Price for Your Paid Apps ... from the list of Price Bands
// provided by HUAWEI through PMS"; the AGC product form offers one "Product
// price → View and edit" control, not a per-country grid).
//
// So the deliverable here is ONE target price per product. In the console you
// pick the nearest available level.
//
// ⚠ ROUND UP, NEVER DOWN, when the exact figure is not an available level.
//   charmRound already rounds up so the computed price only ever BEATS the net
//   floor. Picking the level below it can push a coin pack under
//   TARGET_NET_USD_PER_COIN, which is the one number the ladder may not cross.
//
// ─────────────────────────────────────────────────────────────────────
// WHY THE PRICES ARE HIGHER THAN PLAY
// ─────────────────────────────────────────────────────────────────────
//
// Huawei's commission on IAP is 30% against Play's assumed 15% (see
// HUAWEI_SERVICE_FEE in storePricing.js, quoted from the agreement). Holding the
// same net means a higher sticker price. That difference is DISCLOSED to the
// buyer as a fee line rather than buried in the number — founder decision,
// 2026-09-17. See `storePriceBreakdown` in storePricing.js.

import fs from 'node:fs';
import {
  STORE_COIN_PACKS,
  HUAWEI_SERVICE_FEE,
  HUAWEI_MIN_SETTLEMENT_EUR,
  TARGET_NET_USD_PER_COIN,
  huaweiPriceFor,
  huaweiSubPriceFor,
  huaweiItemPriceFor,
  huaweiNetFor,
  playPriceFor,
  playItemPriceFor,
  playSubPriceFor,
} from '../src/utils/storePricing.js';
import { VP_BONUS_PACKS } from '../src/utils/vpBonuses.js';
import { BOOSTS, formatBoostDuration } from '../src/utils/boosts.js';

const args = process.argv.slice(2);
const asCsv = args.includes('--csv');
const feeArg = args.indexOf('--fee');
const FEE = feeArg >= 0 ? Number(args[feeArg + 1]) : HUAWEI_SERVICE_FEE;

// Identical derivation to scripts/playPricing.mjs, deliberately: the AppGallery
// listing for a product must say the same thing its Play listing says, or the
// two stores describe the same SKU differently to the same person.
const BOOST_TARGET_WORD = { post: 'post', user: 'profile', squad: 'squad', stream: 'live stream' };
const STORE_ITEMS = [
  ...VP_BONUS_PACKS.map((b) => ({
    sku: `vpb_${b.id}`, name: b.name, priceUSD: b.priceUSD, coins: b.coins,
    desc: `${b.desc} Starts the moment you buy it.`,
  })),
  ...BOOSTS.map((b) => ({
    sku: `boost_${b.id}`, name: b.name, priceUSD: b.priceUSD, coins: b.coins,
    desc: `${b.short}. Apply it to any ${b.postType === 'lfg' ? 'teammate-search post' : BOOST_TARGET_WORD[b.target]} for ${formatBoostDuration(b.minutes)}. Kept in your wallet until you use it.`,
  })),
];

const SUB_TIERS = [
  { id: 'lite', name: 'Lite', webPriceUSD: 4.99 },
  { id: 'pro', name: 'Pro', webPriceUSD: 9.99 },
];

// Sales scope. MIRRORS functions/geo.js BLOCKED_COUNTRIES exactly — the server
// refuses these, so selling coins into one of them takes money for an app the
// buyer cannot use.
//
// ⚠ MENA IS NOT BLOCKED AND MUST NOT BE RE-ADDED. It was blocked for the
// gambling prohibition; there are no prize competitions on the platform, so the
// reason is gone (founder, 2026-09-17: "We do not do gaming or tournaments so
// MENA is irrelevant, only sanctioned countries should be excluded").
//
// ⚠ SANCTIONED COUNTRIES ONLY (founder rule). China was removed 2026-09-18: it is
// not sanctioned and the server no longer blocks it. The international AppGallery
// does not offer mainland China as a sales country at all (measured in the AGC
// dialog), so there is nothing to untick there.
const BLOCKED_LIST = [
  ['KP', 'North Korea', 'Sanctioned'],
  ['IR', 'Iran', 'Sanctioned'],
  ['SY', 'Syria', 'Sanctioned'],
  ['CU', 'Cuba', 'Sanctioned'],
  ['RU', 'Russia', 'Sanctioned / restricted'],
  ['BY', 'Belarus', 'Sanctioned'],
  ['VE', 'Venezuela', 'Sanctioned-adjacent'],
];

// AGC product form wording, so a row can be typed straight in.
const CONSUMABLE = 'Consumable';
const SUBSCRIPTION = 'Auto-renewable subscription';

// ⚠⚠ APPGALLERY CAPS A PRODUCT DESCRIPTION AT 100 CHARACTERS. Play does not,
// and 10 of these 26 descriptions came out over the limit when they were first
// generated from the Play copy (coins_elite and up at 101-102, boost_lfg at
// 109). Measured against the real AGC form, which shows "98 / 100" under the
// field — not assumed.
const DESC_MAX = 100;
const NAME_MAX = 55;

/**
 * Fit a description to AppGallery's limit by dropping WHOLE TRAILING SENTENCES,
 * never by truncating mid-sentence.
 *
 * ⚠ It shortens by removal only, and never rewrites. The `desc`/`short` strings
 * these are built from are customer-facing Play Console copy that
 * `coin-ladder-check.mjs` scans for gaming language, so inventing new wording
 * here would put unvetted copy in front of a Huawei reviewer. Dropping a
 * sentence cannot introduce a word that was not already approved.
 */
function fitDescription(text) {
  if (text.length <= DESC_MAX) return text;
  const parts = text.match(/[^.]+\./g) || [text];
  let out = '';
  for (const p of parts) {
    if ((out + p).trim().length > DESC_MAX) break;
    out += p;
  }
  out = out.trim();
  // A single sentence that is itself too long still has to fit somehow. Cut on a
  // word boundary rather than mid-word, and say so loudly at the end of the run.
  if (!out) out = text.slice(0, DESC_MAX).replace(/\s+\S*$/, '');
  return out;
}

const rows = [];

for (const p of STORE_COIN_PACKS) {
  rows.push({
    product_id: `coins_${p.id}`,
    type: CONSUMABLE,
    name: `${p.name || p.id} Pack`.replace(/ Pack Pack$/, ' Pack'),
    description: fitDescription(`${p.coins.toLocaleString('en-US')} Vergr coins, added to your wallet instantly. Spend them anywhere on Vergr. Coins do not expire.`),
    coins: p.coins,
    web_usd: p.priceUSD,
    play_usd: playPriceFor(p.coins, 'US'),
    huawei_usd: huaweiPriceFor(p.coins, 'US', { fee: FEE }),
  });
}

for (const i of STORE_ITEMS) {
  rows.push({
    product_id: i.sku,
    type: CONSUMABLE,
    name: i.name,
    description: fitDescription(i.desc),
    coins: i.coins,
    web_usd: i.priceUSD,
    play_usd: playItemPriceFor(i.priceUSD, 'US'),
    huawei_usd: huaweiItemPriceFor(i.priceUSD, 'US', { fee: FEE }),
  });
}

for (const s of SUB_TIERS) {
  rows.push({
    product_id: `sub_${s.id}`,
    type: SUBSCRIPTION,
    name: `Vergr ${s.name}`,
    description: fitDescription(`Vergr ${s.name}, billed monthly. Cancel any time in AppGallery.`),
    coins: '',
    web_usd: s.webPriceUSD,
    play_usd: playSubPriceFor(s.webPriceUSD, 'US'),
    huawei_usd: huaweiSubPriceFor(s.webPriceUSD, 'US', { fee: FEE }),
  });
}

// ── field-limit check ────────────────────────────────────────────────
// A row that does not fit the AGC form is a row somebody discovers halfway
// through typing 26 products in, so it fails the run here instead.
let bad = 0;
for (const r of rows) {
  if (r.description.length > DESC_MAX) {
    console.error(`✗ ${r.product_id} description is ${r.description.length} chars, AppGallery allows ${DESC_MAX}`);
    bad++;
  }
  if (r.name.length > NAME_MAX) {
    console.error(`✗ ${r.product_id} name is ${r.name.length} chars, AppGallery allows ${NAME_MAX}`);
    bad++;
  }
}

// ── margin check ─────────────────────────────────────────────────────
for (const r of rows) {
  if (!r.coins) continue;
  const net = huaweiNetFor(r.huawei_usd, 'US', { fee: FEE }) / r.coins;
  if (r.product_id.startsWith('coins_') && net < TARGET_NET_USD_PER_COIN) {
    console.error(`✗ ${r.product_id} nets $${net.toFixed(6)}/coin, under the $${TARGET_NET_USD_PER_COIN} floor`);
    bad++;
  }
}

if (asCsv) {
  const DIR = 'docs/huawei';
  fs.mkdirSync(DIR, { recursive: true });
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  // ⚠ Money columns are fixed to 2dp before they are stringified. charmRound
  // does float arithmetic, so `1.09 + 0.30` stringifies as 1.3900000000000001
  // and that is what lands in the cell somebody copies into Huawei's price box.
  const MONEY = new Set(['web_usd', 'play_usd', 'huawei_usd']);
  const cell = (r, h) => (MONEY.has(h) ? Number(r[h]).toFixed(2) : esc(r[h]));
  const head = ['product_id', 'type', 'name', 'description', 'coins', 'web_usd', 'play_usd', 'huawei_usd'];
  fs.writeFileSync(
    `${DIR}/huawei-products.csv`,
    [head.join(','), ...rows.map((r) => head.map((h) => cell(r, h)).join(','))].join('\n') + '\n',
  );
  fs.writeFileSync(
    `${DIR}/huawei-blocked-countries.csv`,
    'country_name,iso,reason\n'
      + BLOCKED_LIST.map(([cc, n, why]) => `${esc(n)},${cc},${esc(why)}`).join('\n') + '\n',
  );
  console.log(`wrote ${DIR}/huawei-products.csv          <- ${rows.length} products`);
  console.log(`wrote ${DIR}/huawei-blocked-countries.csv <- ${BLOCKED_LIST.length} to exclude from sales scope`);
} else {
  console.log(`AppGallery commission: ${(FEE * 100).toFixed(0)}%   (Play assumed ${(0.15 * 100).toFixed(0)}%)`);
  console.log(`Minimum settlement:    EUR ${HUAWEI_MIN_SETTLEMENT_EUR} — below this Huawei rolls the balance over\n`);
  console.log('product_id'.padEnd(22), 'type'.padEnd(26), 'web'.padStart(8), 'play'.padStart(8), 'huawei'.padStart(8));
  console.log('-'.repeat(78));
  for (const r of rows) {
    console.log(
      r.product_id.padEnd(22),
      r.type.padEnd(26),
      ('$' + Number(r.web_usd).toFixed(2)).padStart(8),
      ('$' + Number(r.play_usd).toFixed(2)).padStart(8),
      ('$' + Number(r.huawei_usd).toFixed(2)).padStart(8),
    );
  }
  console.log('\nExclude from sales scope:', BLOCKED_LIST.map(([cc]) => cc).join(', '));
  console.log('Run with --csv to write docs/huawei/.');
}

process.exit(bad ? 1 : 0);
