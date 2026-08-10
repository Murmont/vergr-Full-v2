// src/context/CartContext.jsx
//
// A basket for coin packs, and the reason it exists is not merchandising.
//
// PayRam already takes cards, so this is not about being able to charge. It is
// about what a Stripe underwriter sees when they open the site: a normal
// storefront with an itemised basket, quantities, a subtotal, a stated
// currency, and the terms visible at the point of payment. "Click a tile and a
// payment popup appears" is technically a checkout and reads, to a reviewer, as
// something rather less than one.
//
// ## The cart holds SKUs and quantities. Nothing else.
//
// No prices are stored here. Totals come from `getCoinPriceQuote`, which
// re-prices every line server-side from the same catalogue the payment path
// uses. A cart that carried its own prices would be a cart an attacker could
// edit, and it would drift from the charge the moment a price changed.
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

const KEY = 'vergr.cart.v1';
const MAX_LINES = 20;
const MAX_QTY = 99;

const CartContext = createContext(null);

/** Survives a reload and the round trip out to the payment page and back. */
function readStored() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((l) => l && typeof l.sku === 'string')
      .slice(0, MAX_LINES)
      .map((l) => ({ sku: l.sku, qty: Math.min(MAX_QTY, Math.max(1, Math.floor(Number(l.qty) || 1))) }));
  } catch {
    return [];
  }
}

export function CartProvider({ children }) {
  const [lines, setLines] = useState(readStored);
  // Opening the basket is UI state, not cart state: a reload should not reopen
  // the drawer over whatever the user came back to.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* private mode */ }
  }, [lines]);

  const add = useCallback((sku, qty = 1) => {
    setLines((prev) => {
      const found = prev.find((l) => l.sku === sku);
      if (found) {
        return prev.map((l) => (l.sku === sku
          ? { ...l, qty: Math.min(MAX_QTY, l.qty + qty) }
          : l));
      }
      if (prev.length >= MAX_LINES) return prev;
      return [...prev, { sku, qty: Math.min(MAX_QTY, Math.max(1, qty)) }];
    });
  }, []);

  const setQty = useCallback((sku, qty) => {
    const n = Math.floor(Number(qty) || 0);
    // Dropping to zero removes the line. A basket showing "0 ×" is a basket
    // asking a question nobody wants to answer.
    if (n <= 0) { setLines((prev) => prev.filter((l) => l.sku !== sku)); return; }
    setLines((prev) => prev.map((l) => (l.sku === sku ? { ...l, qty: Math.min(MAX_QTY, n) } : l)));
  }, []);

  const remove = useCallback((sku) => setLines((prev) => prev.filter((l) => l.sku !== sku)), []);
  const clear = useCallback(() => setLines([]), []);

  const count = useMemo(() => lines.reduce((n, l) => n + l.qty, 0), [lines]);

  const value = useMemo(
    () => ({ lines, count, add, setQty, remove, clear, open, setOpen }),
    [lines, count, add, setQty, remove, clear, open],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/** Safe outside the provider: returns an inert cart rather than throwing, so a
 *  screen rendered in isolation (or a native shell) does not crash. */
export function useCart() {
  return useContext(CartContext) || {
    lines: [], count: 0, open: false,
    add: () => {}, setQty: () => {}, remove: () => {}, clear: () => {}, setOpen: () => {},
  };
}
