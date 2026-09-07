// Google Play Billing — web half of the BillingBridge (window.VergrBilling).
//
// Only present on the Play STORE build. Web, desktop and sideload keep PayRam,
// so every export here degrades to "unsupported" rather than throwing, and the
// caller falls back to the existing checkout.
//
// THE PURCHASE CONTRACT (do not reorder — see BillingBridge.kt):
//   1. buyCoinPack()  → Play collects payment, returns a purchaseToken
//   2. redeemPlayPurchase (server) verifies with Google and credits coins
//   3. consume()      → only now is the pack re-purchasable
//
// Consuming before the credit lands would take the user's money with no way to
// retry. Anything interrupted between 1 and 2 is recovered by restorePurchases()
// on next launch, which is safe because the server keys idempotency on the
// purchase token.

import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';

const bridge = () =>
  (typeof window !== 'undefined' && window.VergrBilling) || null;

/** Play Billing is only wired on the Android store build. */
export function isPlayBillingSupported() {
  const b = bridge();
  if (!b) return false;
  try { return b.supported() === true; } catch { return false; }
}

let reqSeq = 0;
const nextReqId = () => `pb_${Date.now()}_${++reqSeq}`;

// Resolve a one-shot native event by reqId. Times out rather than hanging: the
// billing sheet is modal, so a promise that never settles freezes the buy UI.
function awaitEvent(eventName, reqId, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const onEvent = (e) => {
      const d = e?.detail;
      if (!d || d.reqId !== reqId) return;
      done = true;
      window.removeEventListener(eventName, onEvent);
      clearTimeout(timer);
      resolve(d);
    };
    const timer = setTimeout(() => {
      if (done) return;
      window.removeEventListener(eventName, onEvent);
      reject(new Error('billing_timeout'));
    }, timeoutMs);
    window.addEventListener(eventName, onEvent);
  });
}

/**
 * Localized prices straight from Play. Never display our own EUR constants on
 * the store build: Play sets the price per market, and showing a different
 * number than the purchase sheet is both confusing and a policy problem.
 */
export async function fetchPlayPrices(productIds) {
  if (!isPlayBillingSupported() || !productIds?.length) return {};
  const reqId = nextReqId();
  try {
    const p = awaitEvent('vergr:billing-products', reqId, 20000);
    bridge().products(reqId, productIds.join(','));
    const detail = await p;
    const map = {};
    for (const item of detail.items || []) map[item.productId] = item;
    return map;
  } catch {
    return {};
  }
}

/**
 * Buy a coin pack. Resolves with the credited coin total, or throws with a
 * `code` of 'cancelled' | 'pending' | 'failed' | 'redeem_failed'.
 */
export async function buyCoinPack(productId, uid) {
  if (!isPlayBillingSupported()) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
  if (!uid) throw Object.assign(new Error('not signed in'), { code: 'failed' });

  const reqId = nextReqId();
  const pending = awaitEvent('vergr:billing-purchase', reqId);
  bridge().buy(reqId, productId, uid);
  const result = await pending;

  if (!result.ok) {
    throw Object.assign(new Error(result.error || 'Purchase failed'), { code: result.code || 'failed' });
  }
  return redeemAndConsume(result.productId, result.purchaseToken, result.orderId);
}

/**
 * Server-verify then consume. Split out because restorePurchases() needs the
 * identical path for a purchase that was interrupted before crediting.
 */
async function redeemAndConsume(productId, purchaseToken, orderId) {
  const redeem = httpsCallable(functions, 'redeemPlayPurchase');
  let res;
  try {
    res = await redeem({ productId, purchaseToken, orderId });
  } catch (err) {
    // Deliberately do NOT consume here. The purchase stays owned, so
    // restorePurchases() retries it on next launch instead of the user paying
    // for nothing.
    throw Object.assign(new Error(err?.message || 'Could not credit your coins'), { code: 'redeem_failed' });
  }
  try { bridge().consume(purchaseToken); } catch { /* server already credited; a failed consume self-heals on restore */ }
  return res?.data || { coins: 0 };
}

/**
 * Re-redeem anything Play still considers owned. Call once after sign-in.
 * Returns the number of purchases recovered.
 */
export async function restorePurchases() {
  if (!isPlayBillingSupported()) return 0;
  const reqId = nextReqId();
  let detail;
  try {
    const p = awaitEvent('vergr:billing-restore', reqId, 20000);
    bridge().restore(reqId);
    detail = await p;
  } catch {
    return 0;
  }
  let recovered = 0;
  for (const item of detail.items || []) {
    try {
      await redeemAndConsume(item.productId, item.purchaseToken, item.orderId);
      recovered++;
    } catch { /* leave it owned; the next launch tries again */ }
  }
  return recovered;
}

/**
 * Play product id for a coin pack. Must match the in-app product ids created
 * in Play Console exactly, or queryProductDetails returns nothing and the buy
 * button reports "Product not loaded".
 */
export const playProductIdFor = (packId) => `coins_${packId}`;

/**
 * Play product id for a VP bonus pack or a boost.
 *
 * ⚠ The prefix is load-bearing. `stream_boost` as a bare id is indistinguishable
 * from a coin SKU, and `PLAY_ITEM_PRODUCTS` in functions/playBilling.js is keyed
 * on exactly these strings. They must also match docs/play/play-products.csv, or
 * queryProductDetails returns nothing and the card reports "not loaded".
 */
export const playItemIdFor = (kind, id) => (kind === 'bonus' ? `vpb_${id}` : `boost_${id}`);

/**
 * Buy a VP bonus pack or a boost with CASH, through Play Billing.
 *
 * Identical machinery to `buyCoinPack` (buy → server-verify → consume), and
 * deliberately so: the redeem call is the same callable and the same
 * idempotency ledger, it just grants the item rather than coins. Resolves with
 * `{ itemKind, itemId, granted }`.
 */
export async function buyStoreItem(productId, uid) {
  return buyCoinPack(productId, uid);
}

// ─────────────────────────────────────────────────────────────────────
// Subscriptions (platform Lite/Pro).
//
// Separate from coins: acknowledged server-side rather than consumed, and
// renewed by Google on its own schedule, so the tier is reconciled daily by
// syncPlaySubscriptions rather than granted once.
//
// Creator memberships are NOT this. They stay on coins.
// ─────────────────────────────────────────────────────────────────────

/** Play subscription id for a platform tier. Must match Play Console exactly. */
export const playSubIdFor = (tier) => `sub_${tier}`;

/** Localized subscription prices, keyed by Play product id. */
export async function fetchPlaySubPrices(tiers) {
  if (!isPlayBillingSupported() || !tiers?.length) return {};
  const reqId = nextReqId();
  try {
    const p = awaitEvent('vergr:billing-subs-products', reqId, 20000);
    bridge().subsProducts(reqId, tiers.map(playSubIdFor).join(','));
    const detail = await p;
    const map = {};
    for (const item of detail.items || []) map[item.productId] = item;
    return map;
  } catch {
    return {};
  }
}

/**
 * Subscribe to a platform tier through Play. Resolves once the server has
 * verified with Google and applied the tier.
 */
export async function buySubscription(tier, uid) {
  if (!isPlayBillingSupported()) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
  if (!uid) throw Object.assign(new Error('not signed in'), { code: 'failed' });

  const reqId = nextReqId();
  const pending = awaitEvent('vergr:billing-purchase', reqId);
  bridge().buySub(reqId, playSubIdFor(tier), uid);
  const result = await pending;

  if (!result.ok) {
    throw Object.assign(new Error(result.error || 'Purchase failed'), { code: result.code || 'failed' });
  }
  return redeemSubscription(result.purchaseToken);
}

async function redeemSubscription(purchaseToken) {
  const redeem = httpsCallable(functions, 'redeemPlaySubscription');
  const res = await redeem({ purchaseToken });
  return res?.data || {};
}

/**
 * Re-apply any subscription Play still considers owned. Covers a reinstall or
 * a new device, where the entitlement exists at Google but not on our user doc.
 * Returns how many were applied.
 */
export async function restoreSubscriptions() {
  if (!isPlayBillingSupported()) return 0;
  const reqId = nextReqId();
  let detail;
  try {
    const p = awaitEvent('vergr:billing-subs-restore', reqId, 20000);
    bridge().restoreSubs(reqId);
    detail = await p;
  } catch {
    return 0;
  }
  let applied = 0;
  for (const item of detail.items || []) {
    try { await redeemSubscription(item.purchaseToken); applied++; } catch { /* retried next launch */ }
  }
  return applied;
}
