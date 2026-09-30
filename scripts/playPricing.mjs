#!/usr/bin/env node
// Emits the Google Play per-country price table for the coin packs.
//
//   node scripts/playPricing.mjs            → readable table + margin check
//   node scripts/playPricing.mjs --csv      → CSV for Play Console bulk import
//   node scripts/playPricing.mjs --fee 0.20 → model a different service fee
//
// Every number comes from src/utils/storePricing.js. To change the ladder or
// the assumed fee, edit that file (or pass --fee) and rerun. Do not hand-edit
// prices anywhere else: this script is the source of the Play Console table.

import fs from 'node:fs';
import {
  STORE_COIN_PACKS,
  TAX_INCLUSIVE_MARKETS,
  PLAY_SERVICE_FEE,
  TARGET_NET_USD_PER_COIN,
  playPriceFor,
  playSubPriceFor,
  playItemPriceFor,
  playNetFor,
  playNetPerCoin,
  taxRateFor,
} from '../src/utils/storePricing.js';
import { VP_BONUS_PACKS } from '../src/utils/vpBonuses.js';
import { BOOSTS, formatBoostDuration } from '../src/utils/boosts.js';

// ⚠ BOOSTS AND VP BONUS PACKS ARE PRODUCTS, NOT COIN PACKS. Their Play price is
// grossed up from their OWN priceUSD via playItemPriceFor(), never from their
// coin cost — pricing them at the coin rate made a 75-coin boost cost the same
// as a 78-coin pack. See docs/play/BOOST_BONUS_PRICING_PLAN.md.
const BOOST_TARGET_WORD = { post: 'post', user: 'profile', squad: 'squad', stream: 'live stream' };
const STORE_ITEMS = [
  ...VP_BONUS_PACKS.map((b) => ({ sku: `vpb_${b.id}`, name: b.name, priceUSD: b.priceUSD, coins: b.coins,
    // ⚠ USE THE AUTHORED `desc`, NOT mult+hours. Synthesising it from the
    // multiplier and duration produced THE SAME SENTENCE for creator, community
    // and watcher (all 3x for 24h) — two of them at the same price and coin cost
    // too, so the three focused packs were indistinguishable in Play Console, in
    // the purchase sheet and to a reviewer. `scope` is what separates them, and
    // only the authored copy mentions it.
    desc: `${b.desc} Starts the moment you buy it.` })),
  ...BOOSTS.map((b) => ({ sku: `boost_${b.id}`, name: b.name, priceUSD: b.priceUSD, coins: b.coins,
    desc: `${b.short}. Apply it to any ${b.postType === 'lfg' ? 'teammate-search post' : BOOST_TARGET_WORD[b.target]} for ${formatBoostDuration(b.minutes)}. Kept in your wallet until you use it.` })),
];

// Platform subscriptions. Hard-coded here rather than imported from
// tierSystem.js because that module pulls in browser-only dependencies; these
// two prices are locked product facts and a mismatch would be caught the moment
// anybody compared this table with the pricing page.
const SUB_TIERS = [
  { id: 'lite', name: 'Lite', webPriceEUR: 4.99 },
  { id: 'pro', name: 'Pro', webPriceEUR: 9.99 },
];

const args = process.argv.slice(2);
const asCsv = args.includes('--csv');

// ⚠ PLAY CONSOLE REMOVED CSV IMPORT/EXPORT ON 19 MAY 2025.
//
// There is no longer any "upload a CSV" button for in-app products. The only
// bulk path is the Google Play Developer API; everything else is hand entry.
//
// So `--csv` is now a REFERENCE artefact: a file to read while typing, to diff
// against what is live, or to feed the API script. It is written to DISK rather
// than printed, because printing a hundred lines into a terminal and calling it
// a CSV was useless.
const OUT_DIR = 'docs/play';
const feeArg = args.indexOf('--fee');
const fee = feeArg >= 0 ? Number(args[feeArg + 1]) : PLAY_SERVICE_FEE;

if (!Number.isFinite(fee) || fee < 0 || fee >= 1) {
  console.error('--fee must be a decimal between 0 and 1, e.g. --fee 0.20');
  process.exit(1);
}

// ── Output currency ────────────────────────────────────────────────────────
//
// THE MODEL NOW COMPUTES IN USD (2026-08-11). The catalogue went native USD, so
// the coin floor is $0.011628/coin and there is nothing left to convert for the
// Play Console and Stripe setup, which are both USD.
//
// ⚠ `--usd` used to convert EUR figures into dollars. Passing it now would
// DOUBLE-CONVERT and produce prices ~8% too high, so it is accepted and ignored
// rather than silently honoured. `--eur <rate>` goes the other way for anyone
// who still needs a euro view.
//
// The rate is a CLI argument and is printed with the table, because a rate baked
// into a script silently goes stale and nobody notices until the margin does.
// Rounding is always UP, so a converted price can only ever beat the floor.
if (args.includes('--usd')) {
  console.log('note: --usd is a no-op now; the model is already USD. Ignoring.\n');
}
const eurArg = args.indexOf('--eur');
const asEur = eurArg >= 0;
const RATE = asEur && Number(args[eurArg + 1]) > 0 ? Number(args[eurArg + 1]) : 1.08;

/** Nearest charm point at or above `v`, in whichever currency is in play. */
function charm(v) {
  if (v < 5) return Math.ceil((v - 0.09) * 10) / 10 + 0.09;
  if (v < 100) return Math.floor(v) + 0.99 >= v ? Math.floor(v) + 0.99 : Math.floor(v) + 1.99;
  return Math.ceil(v / 10) * 10 - 0.01;
}

/** USD figure from the model, converted to the output currency. */
const out = (usdValue) => (asEur ? charm(usdValue / RATE) : usdValue);
const sym = () => (asEur ? '€' : '$');

// US first (tax-exclusive baseline / Play default price), then every
// tax-inclusive market sorted by rate so the worst cases are visible.
const MARKETS = [
  ['US', 0],
  ...Object.entries(TAX_INCLUSIVE_MARKETS).sort((a, b) => a[1] - b[1]),
];

const eur = (n) => sym() + out(n).toFixed(2);
const pad = (s, n) => String(s).padEnd(n);

if (asCsv) {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ── FILE 1: what you actually TYPE into Play Console ──────────────
  // One row per product. Play auto-converts a base price into every other
  // market, so the base price is the only number that gets entered by hand.
  // Countries the SERVER refuses (functions/geo.js BLOCKED_COUNTRIES). Play must
  // agree, or a buyer in one of them purchases coins they can never withdraw.
  //
  // Names are spelled as Play Console's country picker lists them, because that
  // field is searched by NAME, not by ISO code. A bare "KP" is unsearchable.
  // MENA (SA AE QA KW IQ) removed 2026-08-12: it existed for the gambling
  // prohibition, and there are no prize competitions on the platform any more.
  //
  // SANCTIONED COUNTRIES ONLY (founder rule). China was removed 2026-09-18: it
  // is not sanctioned. Play does not operate there anyway, which is Google's
  // decision, not a Vergr block, so it does not belong on this list.
  const BLOCKED_LIST = [
    ['KP', 'North Korea', 'Sanctioned'],
    ['IR', 'Iran', 'Sanctioned'],
    ['SY', 'Syria', 'Sanctioned'],
    ['CU', 'Cuba', 'Sanctioned'],
    ['RU', 'Russia', 'Sanctioned / restricted'],
    ['BY', 'Belarus', 'Sanctioned'],
    ['VE', 'Venezuela', 'Sanctioned-adjacent'],
  ];
  const BLOCKED = BLOCKED_LIST.map(([cc, name]) => `${name} (${cc})`).join('; ');

  // Its own file too: a 13-row checklist is far easier to work through in the
  // Play Console picker than one long semicolon-separated cell.
  fs.writeFileSync(
    `${OUT_DIR}/play-blocked-countries.csv`,
    'country_name,iso,reason\n' + BLOCKED_LIST
      .map(([cc, name, why]) => `${name},${cc},"${why}"`).join('\n') + '\n',
  );

  const HEAD = [
    'product_id', 'name', 'product_type', 'purchase_option_id', 'purchase_type',
    'consumable', 'multi_quantity', 'digital_classification', 'tax_category',
    'age_rating', 'blocked_countries', 'base_plan_id', 'billing_period',
    'coins', 'vp_bonus', 'base_price_usd', 'tags', 'locale', 'description',
  ];

  const productRows = [
    HEAD,
    ...STORE_COIN_PACKS.map((p) => ([
      `coins_${p.id}`,
      p.name,
      'one-time product',
      // Purchase options are CHILDREN of a product, so this id only has to be
      // unique WITHIN each product. `buy` on coins_starter and `buy` on
      // coins_gamer are different objects and do not collide. Keeping it
      // identical means the billing bridge never branches per pack.
      // Hyphens allowed, underscores are NOT, so `coins_starter` is invalid here.
      'buy',
      'Buy',
      // ⚠ redeemAndConsume() consumes the token after crediting, so a buyer can
      // repurchase. Non-consumable = each pack buyable ONCE per account, ever.
      'yes',
      // Billing 9.1.0 supports it, but nativeBilling.js passes no quantity, so
      // enabling it buys nothing until the bridge does.
      'no',
      'Digital content',
      'Digital app sales',
      '18+',
      BLOCKED,
      '', '',
      p.coins,
      p.vpBonus || 0,
      out(playPriceFor(p.coins, 'US', { fee })).toFixed(2),
      '',
      'en-US',
      `${Number(p.coins).toLocaleString('en-US')} Vergr coins${p.vpBonus ? `, plus a ${Number(p.vpBonus).toLocaleString('en-US')} VP bonus that raises your rank` : ''}, added to your wallet instantly. Spend them anywhere on Vergr. Coins do not expire.`,
    ])),
    ...SUB_TIERS.map((t) => ([
      `sub_${t.id}`,
      `Vergr ${t.name}`,
      'subscription',
      '', '',        // subscriptions use a base plan, not a purchase option
      '', '',
      // Google files subscription-based offerings and streaming platforms under
      // Service, which is what Lite/Pro are.
      'Service',
      'Digital app sales',
      '18+',
      BLOCKED,
      'monthly',
      'Monthly, auto-renewing',
      '', '',
      out(playSubPriceFor(t.webPriceEUR, 'US', { fee })).toFixed(2),
      '',
      'en-US',
      `Vergr ${t.name}, billed monthly. Cancel any time.`,
    ])),
    // ── BOOSTS AND VP BONUS PACKS ──────────────────────────────────
    // Consumable one-time products, like the coin packs: a user buys the same
    // boost repeatedly. `coins` is recorded for reference only — it is the
    // ALTERNATIVE payment when the wallet covers it, never the basis of the
    // Play price. base_price_usd comes from the item's own priceUSD.
    ...STORE_ITEMS.map((i) => ([
      i.sku,
      i.name,
      'one-time product',
      'buy',
      'Buy',
      'yes',
      'no',
      'Digital content',
      'Digital app sales',
      '18+',
      BLOCKED,
      '', '',
      i.coins,
      0,
      out(playItemPriceFor(i.priceUSD, 'US', { fee })).toFixed(2),
      '',
      'en-US',
      i.desc,
    ])),
  ];

  // ── FILE 2: per-market VERIFICATION table ─────────────────────────
  // NOT for entry. Play generates local prices from the base price; this is the
  // table to spot-check those against, because an auto-converted price that
  // lands under the floor loses money in that market silently.
  // Full country names, spelled as Play Console lists them. The picker is
  // searched by NAME; an ISO column means looking up 40 codes by hand.
  // ⚠ SPELL THESE EXACTLY AS PLAY CONSOLE DOES, DIACRITICS INCLUDED. The
  // picker is searched by NAME, so a near-miss means hunting for the row by
  // hand on every one of the 26 products. Türkiye is the one that bites:
  // Google renamed it from Turkey, and 'Turkey' does not find it.
  const COUNTRY_NAME = {
    US: 'United States', AT: 'Austria', BE: 'Belgium', BG: 'Bulgaria',
    HR: 'Croatia', CY: 'Cyprus', CZ: 'Czechia', DK: 'Denmark',
    EE: 'Estonia', FI: 'Finland', FR: 'France', DE: 'Germany',
    GR: 'Greece', HU: 'Hungary', IE: 'Ireland', IT: 'Italy',
    LV: 'Latvia', LT: 'Lithuania', LU: 'Luxembourg', MT: 'Malta',
    NL: 'Netherlands', PL: 'Poland', PT: 'Portugal', RO: 'Romania',
    SK: 'Slovakia', SI: 'Slovenia', ES: 'Spain', SE: 'Sweden',
    GB: 'United Kingdom', NO: 'Norway', CH: 'Switzerland',
    AU: 'Australia', NZ: 'New Zealand', JP: 'Japan', KR: 'South Korea',
    ZA: 'South Africa', SG: 'Singapore', IN: 'India', TR: 'Türkiye',
    MX: 'Mexico',
  };

  // ── LOCAL CURRENCY, NOT USD ────────────────────────────────────────
  //
  // ⚠ THE BUG THIS EXISTS TO PREVENT.
  //
  // Play Console's per-country price field is denominated in THAT COUNTRY'S
  // CURRENCY. An earlier version of this table emitted USD figures with no
  // currency column, and typing them in meant, for example, entering ¥1.29 in
  // Japan when $1.19 was intended — a pack worth $0.008 against coins that cost
  // $0.91 to redeem. Every sale in that market would have been a direct loss.
  //
  // Euro markets hid it, because EUR 1.29 and USD 1.29 are close enough to look
  // plausible (it was a ~15% OVERCHARGE, which is safe and therefore silent).
  // The currencies far from USD are where a units bug becomes catastrophic.
  //
  // So: every price below is in the market's own currency, the currency is a
  // COLUMN, and a floor assertion at the end converts each one back to USD and
  // refuses to write the file if any lands under the floor.
  const CURRENCY = {
    US: 'USD',
    AT: 'EUR', BE: 'EUR', CY: 'EUR', DE: 'EUR', EE: 'EUR', ES: 'EUR',
    FI: 'EUR', FR: 'EUR', GR: 'EUR', IE: 'EUR', IT: 'EUR', LT: 'EUR',
    LU: 'EUR', LV: 'EUR', MT: 'EUR', NL: 'EUR', PT: 'EUR', SI: 'EUR',
    SK: 'EUR', HR: 'EUR', BG: 'EUR' /* euro from 2026-01-01; Play rejects BGN at regionsVersion 2025/03 */,
    CZ: 'CZK', DK: 'DKK', HU: 'HUF', PL: 'PLN', RO: 'RON', SE: 'SEK',
    GB: 'GBP', NO: 'NOK', CH: 'CHF',
    AU: 'AUD', NZ: 'NZD', JP: 'JPY', KR: 'KRW', ZA: 'ZAR', SG: 'SGD',
    IN: 'INR', TR: 'TRY', MX: 'MXN',
  };

  // Currencies with no minor unit. Writing 119.99 where the currency has no
  // cents is meaningless and Play will snap it somewhere unpredictable.
  const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'HUF']);

  let RATES = null;
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const j = await r.json();
    if (j?.result === 'success' && j.rates?.EUR) RATES = j.rates;
  } catch { /* handled below */ }
  if (!RATES) {
    console.error('✗ Could not fetch FX rates. Refusing to write a price table');
    console.error('  with guessed rates — that is exactly how the USD/local mixup');
    console.error('  happened. Retry when the rate feed is reachable.');
    process.exit(1);
  }

  /**
   * Round UP to a tidy price point in the local currency.
   * ALWAYS up, so conversion can only ever beat the floor, never miss it.
   */
  function localCharm(v, cur) {
    if (ZERO_DECIMAL.has(cur)) {
      if (v >= 10000) return Math.ceil(v / 1000) * 1000;
      if (v >= 1000) return Math.ceil(v / 100) * 100;
      if (v >= 100) return Math.ceil(v / 10) * 10;
      return Math.ceil(v);
    }
    if (v >= 1000) return Math.ceil(v / 100) * 100 - 0.01;
    if (v >= 100) return Math.ceil(v / 10) * 10 - 0.01;
    if (v >= 10) return Math.ceil(v) - 0.01;
    return Math.ceil(v * 10) / 10 - 0.01;
  }

  const localPrice = (usd, cc) => {
    const cur = CURRENCY[cc] || 'USD';
    const rate = cur === 'USD' ? 1 : RATES[cur];
    if (!rate) return null;
    return localCharm(usd * rate, cur);
  };
  const fmtLocal = (v, cur) => (v == null ? '' : (ZERO_DECIMAL.has(cur) ? String(Math.round(v)) : v.toFixed(2)));

  const marketRows = [
    ['country', 'iso', 'currency', 'vat_pct',
      ...STORE_COIN_PACKS.map((p) => `coins_${p.id}`),
      ...SUB_TIERS.map((t) => `sub_${t.id}`),
      ...STORE_ITEMS.map((i) => i.sku)],
    ...MARKETS.map(([cc]) => {
      const cur = CURRENCY[cc] || 'USD';
      return [
        COUNTRY_NAME[cc] || cc,
        cc,
        cur,
        (taxRateFor(cc) * 100).toFixed(1),
        ...STORE_COIN_PACKS.map((p) => fmtLocal(localPrice(playPriceFor(p.coins, cc, { fee }), cc), cur)),
        ...SUB_TIERS.map((t) => fmtLocal(localPrice(playSubPriceFor(t.webPriceEUR, cc, { fee }), cc), cur)),
        ...STORE_ITEMS.map((i) => fmtLocal(localPrice(playItemPriceFor(i.priceUSD, cc, { fee }), cc), cur)),
      ];
    }),
  ];

  // ── FLOOR ASSERTION ────────────────────────────────────────────────
  // Convert every local price BACK to USD, strip VAT, take the fee, and check
  // net-per-coin. Refuses to write rather than emit a table that loses money.
  const breaches = [];
  for (const [cc] of MARKETS) {
    const cur = CURRENCY[cc] || 'USD';
    const rate = cur === 'USD' ? 1 : RATES[cur];
    for (const p of STORE_COIN_PACKS) {
      const local = localPrice(playPriceFor(p.coins, cc, { fee }), cc);
      const usd = local / rate;
      const net = (usd / (1 + taxRateFor(cc))) * (1 - fee) / p.coins;
      if (net < TARGET_NET_USD_PER_COIN) {
        breaches.push(`${cc} ${p.id}: ${cur} ${fmtLocal(local, cur)} -> $${net.toFixed(6)}/coin`);
      }
    }
  }
  // Items are checked against their OWN priceUSD, not the per-coin floor: a
  // boost is a product, so the invariant is "never net less than the product's
  // USD price", the same rule subscriptions follow.
  for (const [cc] of MARKETS) {
    const cur = CURRENCY[cc] || 'USD';
    const rate = cur === 'USD' ? 1 : RATES[cur];
    for (const it of STORE_ITEMS) {
      const local = localPrice(playItemPriceFor(it.priceUSD, cc, { fee }), cc);
      if (local == null) continue;
      const net = ((local / rate) / (1 + taxRateFor(cc))) * (1 - fee);
      if (net < it.priceUSD - 0.005) {
        breaches.push(`${cc} ${it.sku}: ${cur} ${fmtLocal(local, cur)} -> nets ${net.toFixed(2)} vs ${it.priceUSD}`);
      }
    }
  }

  if (breaches.length) {
    console.error('✗ FLOOR BREACH — refusing to write:');
    breaches.slice(0, 10).forEach((b) => console.error('  ' + b));
    process.exit(1);
  }

  // Fail loudly rather than silently emitting an ISO code as a "name".
  const missing = MARKETS.map(([cc]) => cc).filter((cc) => !COUNTRY_NAME[cc]);
  if (missing.length) {
    console.error(`✗ No country name for: ${missing.join(', ')}. Add them to COUNTRY_NAME.`);
    process.exit(1);
  }

  const toCsv = (rows) => rows
    .map((r) => r.map((c) => {
      const s = String(c ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\n') + '\n';

  const f1 = `${OUT_DIR}/play-products.csv`;
  const f2 = `${OUT_DIR}/play-prices-by-market.csv`;
  fs.writeFileSync(f1, toCsv(productRows));
  fs.writeFileSync(f2, toCsv(marketRows));

  console.log('');
  console.log('Wrote:');
  console.log(`  ${f1}              <- the ${productRows.length - 1} products to create`);
  console.log(`  ${f2}   <- per-market check (${MARKETS.length} markets)`);
  console.log(`  ${OUT_DIR}/play-blocked-countries.csv    <- ${BLOCKED_LIST.length} to mark unavailable`);
  console.log('');
  console.log('⚠ Play Console REMOVED CSV import on 19 May 2025. These are');
  console.log('  reference files, not an upload. Create products in the UI using');
  console.log('  file 1, or use the Play Developer API for bulk.');
  console.log('');
  process.exit(0);
}

console.log('');
console.log('GOOGLE PLAY COIN PRICING');
console.log('════════════════════════');
console.log(`Assumed Play service fee : ${(fee * 100).toFixed(1)}%`);
console.log(`Target net per coin      : ${sym()}${out(TARGET_NET_USD_PER_COIN).toFixed(4)}`);
if (asEur) {
  console.log(`Output currency          : EUR at ${RATE} USD/EUR (pass --eur <rate> to change)`);
  console.log('                           Converted then re-charmed, always rounding UP.');
}
console.log('');

console.log('LADDER — SAME COINS AS WEB. Only the price differs, because Play');
console.log('takes a service fee. A second coin quantity would mean the shelf and');
console.log('the Play sheet disagree about what is being sold, which is a');
console.log('rejection risk; see the header of src/utils/storePricing.js.');
console.log('');
console.log(pad('Play product id', 20) + pad('Coins', 10) + 'VP bonus');
console.log('─'.repeat(52));
for (const p of STORE_COIN_PACKS) {
  console.log(
    pad(`coins_${p.id}`, 20) +
    pad(p.coins.toLocaleString(), 10) +
    (p.vpBonus > 0 ? `+${p.vpBonus.toLocaleString()} VP` : '—')
  );
}

console.log('');
console.log('ONE-TIME PRODUCT PRICES BY MARKET (Play Console → In-app products)');
console.log(pad('CC', 5) + pad('VAT', 7) + STORE_COIN_PACKS.map((p) => pad(p.id, 11)).join(''));
console.log('─'.repeat(5 + 7 + STORE_COIN_PACKS.length * 11));

let worst = { netPerCoin: Infinity };
for (const [cc] of MARKETS) {
  const cells = STORE_COIN_PACKS.map((p) => {
    const price = playPriceFor(p.coins, cc, { fee });
    const net = playNetPerCoin(price, p.coins, cc, { fee });
    if (net < worst.netPerCoin) worst = { cc, pack: p.id, price, netPerCoin: net };
    return pad(eur(price), 11);
  });
  console.log(pad(cc, 5) + pad((taxRateFor(cc) * 100).toFixed(1) + '%', 7) + cells.join(''));
}

// ── Subscriptions ──────────────────────────────────────────────────────────
//
// Different target from coins: hold the same NET as the web sale, rather than a
// per-unit floor. A subscription is not a redeemable balance, so there is no
// arbitrage to guard against; the only requirement is that Play does not earn
// us less than our own rail does.
console.log('');
console.log('SUBSCRIPTION PRICES BY MARKET (Play Console → Subscriptions)');
console.log('Target: match the web NET. Web prices ' +
  SUB_TIERS.map((t) => `${t.name} ${eur(t.webPriceEUR)}`).join(', ') + '.');
console.log(pad('CC', 5) + pad('VAT', 7) +
  SUB_TIERS.map((t) => pad(`sub_${t.id}`, 12)).join('') + 'net vs web');
console.log('─'.repeat(5 + 7 + SUB_TIERS.length * 12 + 12));

let subWorst = { delta: Infinity };
for (const [cc] of MARKETS) {
  const cells = SUB_TIERS.map((t) => {
    const price = playSubPriceFor(t.webPriceEUR, cc, { fee });
    const net = playNetFor(price, cc, { fee });
    const delta = net - t.webPriceEUR;
    if (delta < subWorst.delta) subWorst = { cc, tier: t.id, price, net, web: t.webPriceEUR, delta };
    return pad(eur(price), 12);
  });
  const worstHere = SUB_TIERS
    .map((t) => playNetFor(playSubPriceFor(t.webPriceEUR, cc, { fee }), cc, { fee }) - t.webPriceEUR)
    .reduce((a, b) => Math.min(a, b));
  console.log(
    pad(cc, 5) + pad((taxRateFor(cc) * 100).toFixed(1) + '%', 7) + cells.join('') +
    (worstHere >= 0 ? `+${eur(worstHere).slice(1)}` : `-${eur(-worstHere).slice(1)}`)
  );
}
console.log('');
console.log(`Thinnest subscription row : ${subWorst.tier} in ${subWorst.cc} at ${eur(subWorst.price)}`);
console.log(`Nets ${eur(subWorst.net)} against a web price of ${eur(subWorst.web)}`);
if (subWorst.delta < 0) {
  console.log('✗ FAIL — that market earns LESS through Play than on the web.');
  process.exit(1);
}
console.log('✓ PASS — every market nets at least the web price.');

console.log('');
// Prices are DERIVED from the target, so this is an invariant check on the
// charm rounding, not an independent audit: it proves charmRound only ever
// rounds UP. It fails loudly if someone edits that function to round to
// nearest, which would silently push the thinnest markets below the floor.
console.log('INVARIANT CHECK (charm rounding must never land below the floor)');
console.log('─'.repeat(52));
console.log(`Thinnest row : ${worst.pack} in ${worst.cc} at ${eur(worst.price)}`);
console.log(`Net per coin : ${sym()}${out(worst.netPerCoin).toFixed(5)} (floor ${sym()}${out(TARGET_NET_USD_PER_COIN).toFixed(4)})`);

if (worst.netPerCoin < TARGET_NET_USD_PER_COIN) {
  console.log('');
  console.log('✗ FAIL — at least one market nets BELOW the floor. Do not ship this table.');
  process.exit(1);
}
console.log('');
console.log('✓ PASS — every market clears the floor at this fee.');
console.log('');
