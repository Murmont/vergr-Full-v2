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

export const MIN_CUSTOM_EUR = 10;
export const COIN_PRICE_EUR = 0.009;
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

  async function startCheckout(payload, label) {
    if (checkout?.status === 'waiting') return;
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
        return;
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
      return;
    }

    if (!res?.ok || !res.paymentUrl) {
      closePopup();
      setCheckout(null);
      showToast(res?.message || 'PayRam is not available right now.', 'error');
      return;
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
  }

  const cancelCheckout = () => { stopPolling(); closePopup(); setCheckout(null); };

  return { checkout, startCheckout, cancelCheckout };
}
