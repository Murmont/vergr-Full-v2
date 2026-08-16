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
// THE MODEL: SAME COINS, DIFFERENT PRICE
// ──────────────────────────────────────
// A Play IAP product has ONE fixed quantity and one Play-set price per market.
// So the store build sells the SAME pack as the web (1,200 coins is 1,200 coins
// everywhere) and charges more for it, because Play takes a cut of the sale.
//
//   • STORE_COIN_PACKS carries the web coin quantities, unchanged.
//   • playPriceFor(coins, countryCode) computes the price that holds our net at
//     or above TARGET_NET_USD_PER_COIN in that specific market.
//
// ## Why it is not the other way round
//
// This file used to cut the coin count ~15% on Play and hold the price. That
// was the dangerous version, for two separate reasons:
//
//   1. Play's alternative-billing rules require the user to be able to compare
//      the two payment options FAIRLY, with no thumb on the scale. Expressing
//      the penalty in the product itself (you get fewer coins if you pay Google)
//      is the least defensible form of that.
//   2. It forced a second SKU quantity, so the shelf showed one number and the
//      Play sheet charged for another. That displayed-versus-charged mismatch is
//      a documented rejection reason.
//
// Charging more on Play is an ordinary, disclosable consequence of the store
// fee. The Play product reads "1,200 coins, $14.99", the Console agrees with the
// UI exactly, and the user compares two prices for the same thing.
//
// ⚠ NEVER DISPLAY A PRICE THIS FILE COMPUTED as the Play price. These figures
// exist to decide what to TYPE INTO Play Console. At runtime the UI must show
// Play's own formatted string from `fetchPlayPrices()`, because Play rounds to
// its own price points per market and applies its own tax display rules. If
// that fetch fails, disable the Play option rather than guess.
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
 * Minimum acceptable net revenue per coin, in USD, AFTER Play's fee and after
 * VAT is stripped out.
 *
 * NOW USD (2026-08-11), because the catalogue is natively USD. The number is the
 * ladder's floor rate: Ascendant, $249.99 / 21,500 coins = $0.011628.
 *
 * Why the floor is where it is: an earned coin costs us EUR 0.0075 (~$0.0081) to
 * pay out at the worst rank (Immortal 15% commission, then the 2% withdrawal
 * spread), and the payout does NOT move when the sale price does. Selling below
 * this loses money the moment the holder converts to gems.
 */
export const TARGET_NET_USD_PER_COIN = 0.011628;

/**
 * @deprecated EUR alias, kept only so a missed callsite fails visibly at review
 * rather than silently pricing off a number that no longer means anything.
 * Do not add new uses.
 */
export const TARGET_NET_EUR_PER_COIN = TARGET_NET_USD_PER_COIN;

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
// IDENTICAL to the web ladder. There is no separate store quantity and there
// must never be one again: a Play IAP product carries a fixed quantity, so a
// second ladder means the shelf and the Play sheet disagree about what is being
// sold. See the header for why the old ~15% coin cut was removed.
//
// Only the PRICE differs on Play, and that price comes from Play at runtime,
// never from this file.
// ─────────────────────────────────────────────────────────────────────

/**
 * The coin packs shown inside the Play build.
 *
 * Re-exported rather than aliased so every existing import keeps working and
 * so there is one obvious place to look when someone asks "does the store sell
 * something different?". The answer is no, and this is where it says so.
 */
export const STORE_COIN_PACKS = COIN_PACKS;

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
 * at least TARGET_NET_USD_PER_COIN per coin.
 *
 *   net = price ÷ (1 + vat) × (1 − fee)  ⟹  price = net × (1 + vat) ÷ (1 − fee)
 *
 * Returned in USD. Play Console converts to local currency, or you paste the
 * per-country figures from scripts/playPricing.mjs directly.
 */
export function playPriceFor(coins, countryCode, {
  fee = PLAY_SERVICE_FEE,
  targetNet = TARGET_NET_USD_PER_COIN,
} = {}) {
  const vat = taxRateFor(countryCode);
  const raw = (coins * targetNet) * (1 + vat) / (1 - fee);
  return charmRound(raw);
}

/**
 * Play price for a SUBSCRIPTION, holding the same net as the web sale.
 *
 * A subscription is not coins, so the per-coin floor does not apply. The target
 * is simply "do not earn less through Play than we do on our own rail": the web
 * price is the benchmark, and the Play price is whatever recovers Google's fee
 * and, in tax-inclusive markets, the VAT that Google collects and remits before
 * paying us.
 *
 *   net = price ÷ (1 + vat) × (1 − fee)  ⟹  price = webPrice × (1 + vat) ÷ (1 − fee)
 *
 * This deliberately does NOT model our own processor cost on the web rail. Doing
 * so would raise the Play price further on an assumption nobody has verified,
 * and erring toward the smaller Play price is the safer direction: it protects
 * the fair-comparison requirement rather than quietly widening the gap.
 *
 * Same rule as everywhere else in this file: the figure is for typing into Play
 * Console. At runtime, display Play's own string from `fetchPlaySubPrices()`.
 */
export function playSubPriceFor(webPriceEUR, countryCode, { fee = PLAY_SERVICE_FEE } = {}) {
  const vat = taxRateFor(countryCode);
  return charmRound(webPriceEUR * (1 + vat) / (1 - fee));
}

/** What we actually receive, in USD, for a given price in a given market. */
export function playNetFor(priceUSD, countryCode, { fee = PLAY_SERVICE_FEE } = {}) {
  return priceUSD / (1 + taxRateFor(countryCode)) * (1 - fee);
}

/** Net revenue per coin. Must stay >= TARGET_NET_USD_PER_COIN. */
export function playNetPerCoin(priceUSD, coins, countryCode, opts) {
  if (!coins) return 0;
  return playNetFor(priceUSD, countryCode, opts) / coins;
}
