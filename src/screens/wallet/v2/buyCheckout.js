// Shared PayRam checkout logic for the Buy screen.
//
// There is exactly ONE checkout/polling implementation (money flow — never
// duplicate it). Both the web/desktop BuyScreen and the native NativeBuyScreen
// import this hook and render their own presentation around it.
//
//   • WEB: open a blank popup synchronously inside the click handler (so the
//     browser doesn't block it), then point it at the PayRam URL.
//   • NATIVE: the Android WebView can't host a popup (window.open about:blank
//     goes white), so open the real URL in the system browser via plugin-opener
//     once the payment exists.

import { useEffect, useRef, useState } from 'react';
import { createPayramPayment, getPayramOrderStatus } from '../../../firebase/firestore';
import { isTauri } from '../../../utils/platform';

// ⚠ MIRRORS functions/payram.js → CUSTOM_COIN_PRICE_USD and CUSTOM_MIN_USD.
// Keep them identical.
//
// These two decide what the custom-amount tab DISPLAYS. The server decides what
// is CHARGED, and it charges `customCoins * CUSTOM_COIN_PRICE_USD`. So when
// these drift apart the user is quoted one number and billed another: while this
// still said 0.009 against the server's 0.0127, typing $10 showed 1,111 coins
// and would have charged $14.11 for them.
//
// The custom rate is deliberately the ladder's WORST per-coin rate (Starter,
// $0.99 / 78 coins), so a custom amount can never undercut a pack and make the
// bulk curve pointless.
export const MIN_CUSTOM_USD = 10;
export const COIN_PRICE_USD = 0.0127;

/** @deprecated EUR-named aliases. Use the USD names; delete once nothing reads these. */
export const MIN_CUSTOM_EUR = MIN_CUSTOM_USD;
export const COIN_PRICE_EUR = COIN_PRICE_USD;
const POLL_MS = 3000;
const CHECKOUT_TIMEOUT_MS = 12 * 60 * 1000;

// Open a URL in the EXTERNAL browser (native). Same pattern the working
// NativeUpdateBanner uses.
export async function openExternalUrl(url) {
  try {
    const opener = await import('@tauri-apps/plugin-opener').catch(() => null);
    if (opener?.openUrl) { await opener.openUrl(url); return true; }
  } catch { /* fall through */ }
  return !!window.open(url, '_blank', 'noopener,noreferrer');
}

// opts.onSettled(status) — override the default "coins added" success handling
// (e.g. the gem transfer sheet). Keeping this hook as the ONE checkout+polling
// implementation is deliberate: it is the money flow, never fork it.
export function useBuyCheckout(showToast, opts = {}) {
  const [checkout, setCheckout] = useState(null); // { status, label, referenceId }
  const popupRef = useRef(null);
  const pollRef = useRef(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };
  const closePopup = () => { try { popupRef.current?.close(); } catch { /* cross-origin */ } popupRef.current = null; };

  useEffect(() => () => { stopPolling(); }, []);

  /**
   * Launch checkout.
   *
   * Returns TRUE once the payment page has actually opened, FALSE if it never
   * did. The cart relies on this: it empties itself only on true, because
   * clearing on the click would lose a basket to a blocked popup or a PayRam
   * outage. Every early return below is therefore explicit rather than a bare
   * \`return\`, which used to come back as undefined and read as success.
   */
  async function startCheckout(payload, label) {
    if (checkout?.status === 'waiting') return false;
    // Any Tauri shell (Android app AND the desktop app) must hand off to the
    // SYSTEM browser — a webview popup renders blank/blocked there. Plain
    // web/PWA keeps the in-page popup so the user never leaves Vergr.
    const native = isTauri();

    if (!native) {
      const popup = window.open(
        'about:blank',
        'vergr_checkout',
        'width=480,height=760,menubar=no,toolbar=no,location=no,status=no',
      );
      if (!popup) {
        showToast('Allow popups for vergr.app to complete your purchase.', 'error');
        return false;
      }
      popupRef.current = popup;
    }
    setCheckout({ status: 'opening', label });

    let res;
    try {
      res = await createPayramPayment(payload);
    } catch (err) {
      closePopup();
      setCheckout(null);
      showToast(err?.message || 'Could not start checkout. Try again.', 'error');
      return false;
    }

    if (!res?.ok || !res.paymentUrl) {
      closePopup();
      setCheckout(null);
      showToast(res?.message || 'PayRam is not available right now.', 'error');
      return false;
    }

    if (native) {
      await openExternalUrl(res.paymentUrl);
    } else {
      try { popupRef.current.location.href = res.paymentUrl; } catch { /* ignore */ }
    }
    setCheckout({ status: 'waiting', label, referenceId: res.referenceId });

    const startedAt = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > CHECKOUT_TIMEOUT_MS) {
        stopPolling(); closePopup(); setCheckout(null);
        showToast("Checkout timed out. If you paid, your coins will arrive shortly.", 'info');
        return;
      }
      let s;
      try { s = await getPayramOrderStatus(res.referenceId); } catch { return; }
      if (s?.status === 'settled') {
        stopPolling(); closePopup(); setCheckout(null);
        if (opts.onSettled) opts.onSettled(s);
        else showToast(`Added ${Number(s.coins || 0).toLocaleString()} coins to your wallet!`, 'success');
      } else if (s?.status === 'expired') {
        stopPolling(); closePopup(); setCheckout(null);
        showToast('Payment expired or was cancelled.', 'info');
      }
    }, POLL_MS);

    // The payment page is open. Whether it is PAID is a separate question the
    // poller answers; the basket is safe to empty either way, because the order
    // now exists server-side and settles on its own.
    return true;
  }

  const cancelCheckout = () => { stopPolling(); closePopup(); setCheckout(null); };

  return { checkout, startCheckout, cancelCheckout };
}

/**
 * Buy a basket through Google Play.
 *
 * Play Billing has no concept of a cart: it buys ONE product per sheet, so a
 * basket is bought as a sequence of purchases and there is no way to make that
 * one tap. That is a platform constraint, not a design choice, and the UI says
 * so rather than pretending a five-line basket will be a single confirmation.
 *
 * Stops at the first failure instead of ploughing on. A user who cancels sheet
 * two of five has said something, and charging them for sheets three to five
 * would be ignoring it.
 *
 * Returns { bought, total, cancelled } so the caller can clear only what
 * actually went through.
 */
export async function checkoutCartViaPlay(lines, uid, showToast) {
  const { buyCoinPack, playProductIdFor } = await import('../../../utils/nativeBilling');
  const { isStoreItemSku } = await import('../../../utils/storeItems');

  const total = lines.reduce((n, l) => n + l.qty, 0);
  let bought = 0;

  for (const line of lines) {
    for (let i = 0; i < line.qty; i += 1) {
      try {
        // ⚠ A store item's SKU IS its Play product id (`vpb_flash`,
        // `boost_post`). Running it through playProductIdFor() would ask Play
        // for `coins_vpb_flash`, which does not exist, and the sheet reports
        // "product not loaded" rather than failing usefully.
        await buyCoinPack(
          isStoreItemSku(line.sku) ? line.sku : playProductIdFor(line.sku),
          uid,
        );
        bought += 1;
      } catch (err) {
        const code = err?.code;
        if (code === 'cancelled' || code === 'canceled') {
          return { bought, total, cancelled: true };
        }
        showToast?.(err?.message || 'Google Play could not complete that purchase.', 'error');
        return { bought, total, cancelled: false };
      }
    }
  }

  if (bought > 0) {
    showToast?.(
      bought === total
        ? 'Purchase complete — coins are on their way.'
        : `${bought} of ${total} purchases completed.`,
      'success',
    );
  }
  return { bought, total, cancelled: false };
}
