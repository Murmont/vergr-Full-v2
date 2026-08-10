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

import {
  STORE_COIN_PACKS,
  TAX_INCLUSIVE_MARKETS,
  PLAY_SERVICE_FEE,
  TARGET_NET_EUR_PER_COIN,
  playPriceFor,
  playNetPerCoin,
  taxRateFor,
} from '../src/utils/storePricing.js';

const args = process.argv.slice(2);
const asCsv = args.includes('--csv');
const feeArg = args.indexOf('--fee');
const fee = feeArg >= 0 ? Number(args[feeArg + 1]) : PLAY_SERVICE_FEE;

if (!Number.isFinite(fee) || fee < 0 || fee >= 1) {
  console.error('--fee must be a decimal between 0 and 1, e.g. --fee 0.20');
  process.exit(1);
}

// US first (tax-exclusive baseline / Play default price), then every
// tax-inclusive market sorted by rate so the worst cases are visible.
const MARKETS = [
  ['US', 0],
  ...Object.entries(TAX_INCLUSIVE_MARKETS).sort((a, b) => a[1] - b[1]),
];

const eur = (n) => '€' + n.toFixed(2);
const pad = (s, n) => String(s).padEnd(n);

if (asCsv) {
  console.log(['country', 'vat_pct', ...STORE_COIN_PACKS.map((p) => p.id)].join(','));
  for (const [cc] of MARKETS) {
    console.log([
      cc,
      (taxRateFor(cc) * 100).toFixed(1),
      ...STORE_COIN_PACKS.map((p) => playPriceFor(p.coins, cc, { fee }).toFixed(2)),
    ].join(','));
  }
  process.exit(0);
}

console.log('');
console.log('GOOGLE PLAY COIN PRICING');
console.log('════════════════════════');
console.log(`Assumed Play service fee : ${(fee * 100).toFixed(1)}%`);
console.log(`Target net per coin      : €${TARGET_NET_EUR_PER_COIN.toFixed(4)}`);
console.log('');

console.log('LADDER (coin quantity is global; only price varies by market)');
console.log(pad('Pack', 12) + pad('Play coins', 12) + pad('Web coins', 12) + 'Extra on web');
console.log('─'.repeat(52));
for (const p of STORE_COIN_PACKS) {
  console.log(
    pad(p.id, 12) +
    pad(p.coins.toLocaleString(), 12) +
    pad((p.webCoins ?? p.coins).toLocaleString(), 12) +
    (p.webBonusPct != null ? `+${p.webBonusPct}%` : '—')
  );
}

console.log('');
console.log('PRICES BY MARKET');
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

console.log('');
// Prices are DERIVED from the target, so this is an invariant check on the
// charm rounding, not an independent audit: it proves charmRound only ever
// rounds UP. It fails loudly if someone edits that function to round to
// nearest, which would silently push the thinnest markets below the floor.
console.log('INVARIANT CHECK (charm rounding must never land below the floor)');
console.log('─'.repeat(52));
console.log(`Thinnest row : ${worst.pack} in ${worst.cc} at ${eur(worst.price)}`);
console.log(`Net per coin : €${worst.netPerCoin.toFixed(5)} (floor €${TARGET_NET_EUR_PER_COIN.toFixed(4)})`);

if (worst.netPerCoin < TARGET_NET_EUR_PER_COIN) {
  console.log('');
  console.log('✗ FAIL — at least one market nets BELOW the floor. Do not ship this table.');
  process.exit(1);
}
console.log('');
console.log('✓ PASS — every market clears the floor at this fee.');
console.log('');
