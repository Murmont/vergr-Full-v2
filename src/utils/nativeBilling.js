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
import { IS_HUAWEI_BUILD } from './platform';
import { blockGuestPurchase } from './guestPrompt';
import { recordClientAttempt } from './paymentAttempts';

// ─────────────────────────────────────────────────────────────────────
// TWO STORES, ONE BRIDGE CONTRACT.
// ─────────────────────────────────────────────────────────────────────
//
// On the AppGallery build `window.VergrBilling` is HuaweiIapBridge.kt instead
// of BillingBridge.kt. It registers under the SAME name and emits the SAME
// events with the same fields, so everything in this module — the reqId
// handshake, the buy → verify → consume ordering, restore — is shared.
//
// Exactly two things differ, and both are compile-time constants so the Play
// bundle tree-shakes the Huawei branch away entirely:
//
//   1. WHICH CALLABLE verifies the purchase.
//   2. WHAT PROVES IT. Google gives us a purchaseToken that the server looks up
//      against the Play Developer API. Huawei gives us a SIGNED BLOB —
//      `purchaseData` plus its RSA `signature` — which the server verifies
//      against the IAP public key. There is no token to look up, so the payload
//      is not interchangeable.
//
// ⚠ Do NOT "simplify" this by always sending every field. The server keys
// idempotency on the purchase token it reads out of the SIGNED data, never out
// of a loose field, because a patched client can set a loose field to anything.
const REDEEM_PURCHASE_FN = IS_HUAWEI_BUILD ? 'redeemHuaweiPurchase' : 'redeemPlayPurchase';
const REDEEM_SUB_FN = IS_HUAWEI_BUILD ? 'redeemHuaweiSubscription' : 'redeemPlaySubscription';

// A failed / cancelled / pending attempt, for Admin → Economy → Payments.
// Fire-and-forget (recordClientAttempt never throws and is not awaited).
function noteFailedAttempt(route, productId, result) {
  const code = result?.code || 'failed';
  recordClientAttempt({
    route, productId, code, message: result?.error || '', playCode: result?.playCode ?? null,
    stage: code === 'launch_failed' ? 'launch' : code === 'no_product' ? 'load' : 'sheet',
  });
}

/** Pull the purchase token out of Huawei's signed JSON, for the consume call. */
function huaweiToken(purchaseData) {
  try { return JSON.parse(purchaseData || '{}').purchaseToken || ''; } catch { return ''; }
}

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
  // Guests may not buy: shows the log in / create account prompt and exits
  // quietly (every caller already ignores 'cancelled') BEFORE the store sheet.
  if (blockGuestPurchase()) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
  if (!uid) throw Object.assign(new Error('not signed in'), { code: 'failed' });

  const reqId = nextReqId();
  const pending = awaitEvent('vergr:billing-purchase', reqId);
  bridge().buy(reqId, productId, uid);
  const result = await pending;

  if (!result.ok) {
    noteFailedAttempt(IS_HUAWEI_BUILD ? 'appgallery' : 'google_play', productId, result);
    throw Object.assign(new Error(result.error || 'Purchase failed'), { code: result.code || 'failed' });
  }
  return redeemAndConsume(result);
}

// ─────────────────────────────────────────────────────────────────────
// Our own checkout (Coda) inside the Play app. See BillingBridge.kt.
//
// mode: 'developer'   we draw the choice: Coda form + Google Play option
//       'alternative' alternative billing only (US / EEA): Coda form, Play
//                     still offered beside it
//       'google'      Google draws the choice on the Play button
//       'user_choice' same, the older user choice billing program
//       'none'        plain Play billing, exactly as before
// Everything is inert until Google approves the enrolment: the probes report
// 'none' and the basket stays the Play-only basket.
// ─────────────────────────────────────────────────────────────────────

/** Whether this build's bridge has the choice calls (the Huawei bridge does not). */
export function billingChoiceSupported() {
  const b = bridge();
  return !!(b && typeof b.choiceMode === 'function' && isPlayBillingSupported());
}

let modePromise = null;
/** The choice mode for this user, asked once per session. Never throws. */
export function getBillingChoiceMode(allowUserChoice = false) {
  if (!billingChoiceSupported()) return Promise.resolve({ mode: 'none' });
  if (!modePromise) {
    const reqId = nextReqId();
    modePromise = (async () => {
      try {
        const p = awaitEvent('vergr:billing-choice-mode', reqId, 20000);
        bridge().choiceMode(reqId, !!allowUserChoice);
        const d = await p;
        return { mode: d.mode || 'none', playImage: d.playImage || '', playLoyalty: d.playLoyalty || '' };
      } catch {
        modePromise = null; // ask again next time rather than cache a timeout
        return { mode: 'none' };
      }
    })();
  }
  return modePromise;
}

/**
 * Before a Coda payment in 'developer' / 'alternative' mode: Google's
 * information dialog, then the transaction token the server reports the sale
 * with. Resolves { token, program }; throws with code 'cancelled' or 'failed'.
 */
export async function prepareAltBilling() {
  if (!billingChoiceSupported()) throw Object.assign(new Error('unsupported'), { code: 'failed' });
  const reqId = nextReqId();
  const p = awaitEvent('vergr:billing-choice-token', reqId, 120000);
  bridge().choicePrepare(reqId);
  const d = await p;
  if (!d.ok || !d.token) {
    const cancelled = d.code === 'cancelled';
    throw Object.assign(new Error(cancelled ? 'cancelled' : 'Google Play could not start this checkout. Try Google Play instead.'), { code: cancelled ? 'cancelled' : 'failed' });
  }
  return { token: d.token, program: d.program || 'alternative' };
}

/**
 * The basket's Google Play button. Same as buyCoinPack, except that where
 * Google draws a choice screen the buyer may pick Vergr there: that resolves
 * { choice: { token, program, productId } } and the basket opens the Coda form.
 * A Play purchase resolves the redeemed result exactly as buyCoinPack does.
 */
export async function buyWithChoice(productId, uid) {
  if (!isPlayBillingSupported()) throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
  if (blockGuestPurchase()) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
  if (!uid) throw Object.assign(new Error('not signed in'), { code: 'failed' });
  if (typeof bridge().buyChoice !== 'function') return buyCoinPack(productId, uid);

  const reqId = nextReqId();
  const purchase = awaitEvent('vergr:billing-purchase', reqId);
  const choice = awaitEvent('vergr:billing-choice', reqId).catch(() => null);
  bridge().buyChoice(reqId, productId, uid);
  const first = await Promise.race([
    purchase.then((d) => ({ kind: 'purchase', d }), () => ({ kind: 'timeout' })),
    choice.then((d) => (d ? { kind: 'choice', d } : new Promise(() => {}))),
  ]);
  const asChoice = (d) => {
    if (!d?.ok || !d.token) throw Object.assign(new Error('Google Play could not start this checkout.'), { code: 'failed' });
    return { choice: { token: d.token, program: d.program || 'user_choice', productId: d.productId || productId } };
  };
  if (first.kind === 'choice') return asChoice(first.d);
  if (first.kind === 'timeout') throw Object.assign(new Error('Purchase timed out'), { code: 'failed' });
  const result = first.d;
  if (!result.ok) {
    // Google does not promise which callback fires first when the buyer picks
    // Vergr on its screen, so a "cancelled" gets a moment for the choice to land.
    if (result.code === 'cancelled') {
      const late = await Promise.race([choice, new Promise((r) => setTimeout(() => r(null), 1500))]);
      if (late) return asChoice(late);
    }
    noteFailedAttempt(IS_HUAWEI_BUILD ? 'appgallery' : 'google_play', productId, result);
    throw Object.assign(new Error(result.error || 'Purchase failed'), { code: result.code || 'failed' });
  }
  return redeemAndConsume(result);
}

/**
 * Server-verify then consume. Split out because restorePurchases() needs the
 * identical path for a purchase that was interrupted before crediting.
 *
 * Takes the whole purchase record rather than three loose arguments, because
 * the two stores prove a purchase with different fields — see the note at the
 * top of this file.
 */
async function redeemAndConsume(p) {
  const { productId, orderId } = p;
  const purchaseToken = IS_HUAWEI_BUILD
    ? (p.purchaseToken || huaweiToken(p.purchaseData))
    : p.purchaseToken;
  const redeem = httpsCallable(functions, REDEEM_PURCHASE_FN);
  let res;
  try {
    res = await redeem(IS_HUAWEI_BUILD
      ? { productId, purchaseData: p.purchaseData, signature: p.signature }
      : { productId, purchaseToken, orderId });
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
      await redeemAndConsume(item);
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
  if (blockGuestPurchase()) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
  if (!uid) throw Object.assign(new Error('not signed in'), { code: 'failed' });

  const reqId = nextReqId();
  const pending = awaitEvent('vergr:billing-purchase', reqId);
  bridge().buySub(reqId, playSubIdFor(tier), uid);
  const result = await pending;

  if (!result.ok) {
    noteFailedAttempt(IS_HUAWEI_BUILD ? 'appgallery_sub' : 'google_play_sub', playSubIdFor(tier), result);
    throw Object.assign(new Error(result.error || 'Purchase failed'), { code: result.code || 'failed' });
  }
  return redeemSubscription(result);
}

async function redeemSubscription(p) {
  const redeem = httpsCallable(functions, REDEEM_SUB_FN);
  const res = await redeem(IS_HUAWEI_BUILD
    ? { purchaseData: p.purchaseData, signature: p.signature }
    : { purchaseToken: p.purchaseToken });
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
    try { await redeemSubscription(item); applied++; } catch { /* retried next launch */ }
  }
  return applied;
}
