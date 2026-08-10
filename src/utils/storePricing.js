// Google Play store-build coin ladder + per-country price model.
//
// WHY THIS FILE EXISTS
// ────────────────────
// On Google Play we do not receive the sticker price. Two deductions apply:
//
//   1. Play service fee, taken on the NET (ex-tax) price.
//   2. VAT/GST in every market where Play prices are TAX-INCLUSIVE. For EU +
//      UK customers Google is the merchant of record: it charges, collects and
//      remits the VAT, then pays us the remainder. We never file in the EU for
//      Play revenue, but we also never see that money.
//
// So the developer receipt is:
//
//   net = price ÷ (1 + vat) × (1 − fee)
//
// A single global price therefore yields wildly different margins: at a 15%
// fee, €0.99 nets €0.8415 in the US (tax added on top of our price) but only
// €0.6955 in a 21% VAT market. Ignoring this is how you sell coins below the
// €0.0090 floor without noticing.
//
// THE MODEL
// ─────────
// Coin counts are GLOBAL (a Play IAP product carries one quantity worldwide);
// only PRICE varies by country. So:
//
//   • STORE_COIN_PACKS sets the coin quantity, cut ~15% vs the web ladder in
//     src/utils/vpSystem.js. That cut is the "more coins on vergr.app"
//     promotion, and it is deliberate, not an accident of rounding.
//   • playPriceFor(coins, countryCode) computes the price that holds our net
//     at or above TARGET_NET_EUR_PER_COIN in that specific market.
//
// Run `node scripts/playPricing.mjs` to emit the full per-country table for
// pasting into Play Console.
//
// ⚠ PLAY_SERVICE_FEE is an ASSUMPTION until the real rate is visible in Play
// Console (Monetise → Pricing). The 9%/20% tier structure from the Epic
// settlement was still before the court as of July 2026, and an additional
// market-specific rate may apply in the EEA/UK/US. Change the constant here
// and rerun the script; nothing else needs editing.

// NOTE: explicit .js extension so scripts/playPricing.mjs can import this
// module directly under plain Node ESM. Vite resolves it identically.
import { COIN_PACKS } from './vpSystem.js';

// ─────────────────────────────────────────────────────────────────────
// Tunables — the only numbers you should ever need to touch.
// ─────────────────────────────────────────────────────────────────────

/** Play's cut, taken on the ex-tax price. Verify in Play Console. */
export const PLAY_SERVICE_FEE = 0.15;

/**
 * Minimum acceptable net revenue per coin, in EUR, AFTER Play's fee and
 * after VAT is stripped out. This is the locked €0.0090 purchase floor
 * (see CLAUDE.md "Locked economic/product facts") — a coin sold below it
 * loses money once the holder converts to gems at the 15% commission floor.
 */
export const TARGET_NET_EUR_PER_COIN = 0.0090;

// ─────────────────────────────────────────────────────────────────────
// Tax-inclusive markets.
//
// In these countries the Play price the user sees INCLUDES tax, and Google
// remits it. Rate = standard VAT/GST on electronically supplied services.
//
// Markets NOT listed here are treated as tax-EXCLUSIVE (rate 0): the US and
// Canada add sales tax on top of our price at checkout, so our net is the
// full price less the fee.
//
// ⚠ Rates move. Verify against Play Console's own tax table before a price
// update; an understated rate silently eats margin in that market.
// ─────────────────────────────────────────────────────────────────────

export const TAX_INCLUSIVE_MARKETS = {
  // ── European Union ──
  AT: 0.20, BE: 0.21, BG: 0.20, HR: 0.25, CY: 0.19, CZ: 0.21,
  DK: 0.25, EE: 0.24, FI: 0.255, FR: 0.20, DE: 0.19, GR: 0.24,
  HU: 0.27, IE: 0.23, IT: 0.22, LV: 0.21, LT: 0.21, LU: 0.17,
  MT: 0.18, NL: 0.21, PL: 0.23, PT: 0.23, RO: 0.21, SK: 0.23,
  SI: 0.22, ES: 0.21, SE: 0.25,
  // ── Rest of world, digital-services regimes ──
  GB: 0.20, NO: 0.25, CH: 0.081, AU: 0.10, NZ: 0.15,
  JP: 0.10, KR: 0.10, ZA: 0.15, SG: 0.09, IN: 0.18,
  TR: 0.20, MX: 0.16,
};

/** VAT/GST rate for a market. Unlisted = tax added on top, so 0 here. */
export function taxRateFor(countryCode) {
  return TAX_INCLUSIVE_MARKETS[String(countryCode || '').toUpperCase()] || 0;
}

// ─────────────────────────────────────────────────────────────────────
// The store ladder.
//
// Coins ≈ 85% of the web pack, rounded to clean numbers. Rounding is always
// DOWN or to a rounder figure, never up: rounding up erodes margin, and the
// difference is what funds the "more coins on the web" promotion.
//
// VP bonuses are kept IDENTICAL to web. VP costs us nothing real, so it is
// free goodwill that stops the top Play packs feeling thin.
// ─────────────────────────────────────────────────────────────────────

const STORE_COIN_OVERRIDES = {
  starter:   85,
  gamer:     425,
  pro:       1000,
  elite:     2100,
  legend:    4250,
  champion:  8500,
  titan:     12500,
  ascendant: 21000,
};

/**
 * The coin packs shown inside the Play build. Same ids, taglines and VP
 * bonuses as web so the rest of the wallet UI needs no special-casing —
 * only `coins` differs, plus a `webCoins` field for the comparison badge.
 */
export const STORE_COIN_PACKS = COIN_PACKS.map((pack) => {
  const coins = STORE_COIN_OVERRIDES[pack.id];
  if (!coins) return pack; // new web pack with no store mapping yet: pass through
  return {
    ...pack,
    coins,
    webCoins: pack.coins,
    webBonusPct: Math.round(((pack.coins / coins) - 1) * 100),
  };
});

// ─────────────────────────────────────────────────────────────────────
// Price computation.
// ─────────────────────────────────────────────────────────────────────

/**
 * Round up to the nearest "charm" price point (x.99 below 100, whole tens
 * above) so the ladder does not read as machine-generated. Always rounds UP,
 * so the returned price can only ever beat the target net, never miss it.
 */
function charmRound(value) {
  // Below €5 use 10c granularity (1.09, 1.19, …). A whole-euro step here is
  // brutal on the entry pack: €1.09 becomes €1.99, doubling the price of the
  // cheapest SKU over a rounding artefact.
  if (value < 5) return Math.ceil((value - 0.09) * 10) / 10 + 0.09;
  if (value < 100) return Math.floor(value) + 0.99 >= value
    ? Math.floor(value) + 0.99
    : Math.floor(value) + 1.99;
  return Math.ceil(value / 10) * 10 - 0.01;
}

/**
 * Price to charge in `countryCode` so that, after VAT and Play's fee, we net
 * at least TARGET_NET_EUR_PER_COIN per coin.
 *
 *   net = price ÷ (1 + vat) × (1 − fee)  ⟹  price = net × (1 + vat) ÷ (1 − fee)
 *
 * Returned in EUR. Play Console converts to local currency, or you paste the
 * per-country figures from scripts/playPricing.mjs directly.
 */
export function playPriceFor(coins, countryCode, {
  fee = PLAY_SERVICE_FEE,
  targetNet = TARGET_NET_EUR_PER_COIN,
} = {}) {
  const vat = taxRateFor(countryCode);
  const raw = (coins * targetNet) * (1 + vat) / (1 - fee);
  return charmRound(raw);
}

/** What we actually receive, in EUR, for a given price in a given market. */
export function playNetFor(priceEUR, countryCode, { fee = PLAY_SERVICE_FEE } = {}) {
  return priceEUR / (1 + taxRateFor(countryCode)) * (1 - fee);
}

/** Net revenue per coin. Must stay ≥ TARGET_NET_EUR_PER_COIN. */
export function playNetPerCoin(priceEUR, coins, countryCode, opts) {
  if (!coins) return 0;
  return playNetFor(priceEUR, countryCode, opts) / coins;
}
