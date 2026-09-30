import { IS_NATIVE_BUILD } from './platform';
import { adUnitFor } from '../config/ads';

// TRUE in-feed AdMob native ads on the native shell.
//
// AdMob creatives are drawn by its SDK into a real Android view, so they can't
// be placed inside the HTML flow. Instead the feed reserves an empty slot of a
// known height and this module reports that slot's DOCUMENT-absolute position
// to Kotlin, which positions a NativeAdView over it.
//
// We deliberately do NOT report on scroll. A bridge call per scroll frame lags
// visibly; Kotlin re-derives the on-screen position from the WebView's own
// scrollY, so the ad moves on the same signal the content does. We only re-send
// when the slot's position in the DOCUMENT actually changes (images above it
// loading, new posts prepended, resize).

let seq = 0;

// ⚠ `adUnitFor('nativeFeed')` — NOT `ADS_CONFIG.admob.nativeFeedUnitId`. On the
// Huawei build that field is an AdMob `ca-app-pub-…` string, which the Petal SDK
// can never fill, so the slot would have collapsed on every impression forever.
export const isNativeFeedAdAvailable = () =>
  IS_NATIVE_BUILD
  && !!window.VergrFeedAd?.available?.()
  && !!adUnitFor('nativeFeed');

/** Document-absolute rect in CSS px. */
function docRect(el) {
  const r = el.getBoundingClientRect();
  return {
    x: r.left + window.scrollX,
    y: r.top + window.scrollY,
    w: r.width,
    h: r.height,
  };
}

/**
 * Attach a feed ad to a reserved slot element. Returns a cleanup function.
 * Safe to call on web/desktop — it no-ops.
 *
 * `onState(filled, code)` fires when the SDK reports back. A NO-FILL IS THE
 * NORMAL CASE (a new unit serves nothing for hours, and demand is thin at low
 * volume), so the caller MUST collapse its reserved space when filled=false —
 * otherwise the user stares at an empty 300px card in the middle of the feed.
 */
export function attachFeedAd(el, onState, unitIdOverride) {
  if (!el || !isNativeFeedAdAvailable()) return () => {};
  const slotId = `feed-ad-${++seq}`;
  const unitId = unitIdOverride || adUnitFor('nativeFeed');

  // Report the SDK's verdict exactly once. `noReplyTimer` is declared BEFORE
  // settle() closes over it — a const declared after would be a temporal dead
  // zone if the event ever raced ahead of it.
  let answered = false;
  let noReplyTimer = 0;
  const settle = (filled, code) => {
    if (answered) return;
    answered = true;
    clearTimeout(noReplyTimer);
    try { onState?.(filled, code); } catch { /* never break the feed */ }
  };
  const onAdState = (e) => {
    const d = e?.detail;
    if (!d || d.slotId !== slotId) return;
    settle(!!d.filled, d.code);
  };
  window.addEventListener('vergr:feed-ad-state', onAdState);

  // Safety net: an APK older than this change never dispatches the event, and
  // a wedged SDK may never call back at all. Either way we must not leave a
  // permanent hole in the feed, so an unanswered slot collapses on its own.
  noReplyTimer = setTimeout(() => settle(false, -2), 8000);

  let last = { x: -1, y: -1, w: -1, h: -1 };
  let raf = 0;

  const push = () => {
    raf = 0;
    try {
      const r = docRect(el);
      if (!r.w || !r.h) return;
      // Sub-pixel churn would spam the bridge; only send real movement.
      if (Math.abs(r.x - last.x) < 1 && Math.abs(r.y - last.y) < 1
        && Math.abs(r.w - last.w) < 1 && Math.abs(r.h - last.h) < 1) return;
      last = r;
      window.VergrFeedAd.place(slotId, unitId, r.x, r.y, r.w, r.h);
    } catch { /* an ad must never break the feed */ }
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(push); };

  schedule();

  // Anything that can move the slot within the DOCUMENT (not the viewport).
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
  ro?.observe(el);
  // The feed grows above the slot as posts load/prepend, which shifts it down.
  const mo = typeof MutationObserver !== 'undefined'
    ? new MutationObserver(schedule)
    : null;
  const feedRoot = el.closest('[data-feed-root]') || el.parentElement;
  if (feedRoot && mo) mo.observe(feedRoot, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('load', schedule);
  // Images finishing above the slot reflow it.
  const onMediaLoad = () => schedule();
  document.addEventListener('load', onMediaLoad, true);

  return () => {
    try {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('load', schedule);
      window.removeEventListener('vergr:feed-ad-state', onAdState);
      clearTimeout(noReplyTimer);
      document.removeEventListener('load', onMediaLoad, true);
      window.VergrFeedAd?.remove?.(slotId);
    } catch { /* ignore */ }
  };
}

/** Tear every feed ad down (leaving the feed). */
export function clearFeedAds() {
  try { window.VergrFeedAd?.clear?.(); } catch { /* ignore */ }
}
