// STORE ITEMS: the ONE place a cart SKU turns back into a VP bonus or a boost.
//
// Coin packs are `starter`, `gamer`, … . A store item is `vpb_<packId>` or
// `boost_<boostId>`, deliberately the SAME string as its Google Play product id
// (functions/playBilling.js PLAY_ITEM_PRODUCTS) and its card-rail SKU
// (functions/payram.js STORE_ITEMS). One namespace across all three rails, so a
// cart line, a Play IAP and a ledger row all name the item identically.
//
// ⚠ THE PREFIX IS LOAD-BEARING. `stream_boost` as a bare SKU is
// indistinguishable from a coin pack id, and the cart stores nothing but SKUs.
//
// ⚠⚠ TWO PRICES, AND NEITHER IS DERIVED FROM THE OTHER.
//
//   coins    what it costs out of the wallet
//   priceUSD what it costs in cash, when the wallet cannot cover it
//
// Founder, 2026-08-28: a boost charges coins ONLY if the wallet covers it,
// otherwise it charges USD. The rule for the cash price is
// `charmRound(max(2 x coin-equivalent, $0.99))`, so paying with coins is always
// about half the cash price. That is what makes coins worth holding.
//
// Pricing a boost at `playPriceFor(its coin count)` instead put a 75-coin bonus
// at $1.09, which is exactly what a 78-coin pack costs: nobody would ever buy
// it, and it says a coin is worth nothing. Do not reintroduce that derivation.
//
// ⚠ NOTHING HERE IS AUTHORITATIVE. The server re-prices every line from its own
// mirror before it charges anything (the client sends WHAT, never HOW MUCH).
// This module exists so the UI can render a basket, not so it can set a price.
// ⚠ Extensions are explicit, unlike the rest of src/. Vite does not care either
// way, but raw node does, and `scripts/coin-ladder-check.mjs` imports this module
// to prove every SKU resolves to a complete row. Drop the `.js` and that guard
// stops being able to load the file it is guarding.
import { VP_BONUS_PACKS, formatDuration, bonusArt } from './vpBonuses.js';
import { BOOSTS, formatBoostDuration, boostArt } from './boosts.js';

export const BONUS_SKU_PREFIX = 'vpb_';
export const BOOST_SKU_PREFIX = 'boost_';

/** Cart/Play SKU for a catalogue entry. */
export const bonusSku = (packId) => `${BONUS_SKU_PREFIX}${packId}`;
export const boostSku = (boostId) => `${BOOST_SKU_PREFIX}${boostId}`;

/**
 * Resolve a cart SKU to a renderable item, or null when it is not one of ours.
 *
 * Returns a shape deliberately close to a coin pack's, so the cart can render a
 * mixed basket without branching on kind at every field.
 */
export function storeItemBySku(sku) {
  const s = String(sku || '');

  if (s.startsWith(BONUS_SKU_PREFIX)) {
    const id = s.slice(BONUS_SKU_PREFIX.length);
    const p = VP_BONUS_PACKS.find((x) => x.id === id);
    if (!p) return null;
    return {
      sku: s,
      kind: 'bonus',
      id: p.id,
      name: p.name,
      coins: p.coins,
      priceUSD: p.priceUSD,
      // "3x VP for 6 hours" reads as a product; "flash" does not.
      detail: `${p.mult}x VP for ${formatDuration(p.hours)}`,
      art: bonusArt(p),
      artSrcSet: bonusArt(p, true),
      tone: 'violet',
    };
  }

  if (s.startsWith(BOOST_SKU_PREFIX)) {
    const id = s.slice(BOOST_SKU_PREFIX.length);
    const b = BOOSTS.find((x) => x.id === id);
    if (!b) return null;
    return {
      sku: s,
      kind: 'boost',
      id: b.id,
      name: b.name,
      coins: b.coins,
      priceUSD: b.priceUSD,
      detail: formatBoostDuration(b.minutes),
      art: boostArt(b),
      artSrcSet: boostArt(b, true),
      tone: 'ember',
    };
  }

  return null;
}

/** True when this SKU is a store item rather than a coin pack. */
export const isStoreItemSku = (sku) => storeItemBySku(sku) !== null;

/**
 * Money formatter for a shelf price.
 *
 * Whole dollars keep the cents ($5.00, not $5) because the price sits directly
 * beside a coin figure, and a number that changes shape between cards reads as
 * two different kinds of thing.
 */
export const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
