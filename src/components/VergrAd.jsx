import { useEffect, useRef } from 'react';
import { ADS_CONFIG, isAdZoneReady, testNativeFeedUnit } from '../config/ads';
import useTier from '../hooks/useTier';
import useAdsTestMode from '../hooks/useAdsTestMode';
import { IS_NATIVE_BUILD } from '../utils/platform';
import { attachFeedAd, isNativeFeedAdAvailable } from '../utils/nativeFeedAd';

// Reserved height (CSS px) for the native in-feed ad card. Must match the
// layout in res/layout/native_feed_ad.xml (icon row + body + 160dp media +
// CTA + padding) so the overlay lands exactly on the gap the feed leaves.
const NATIVE_AD_HEIGHT = 300;

// ────────────────────────────────────────────────────────────
// VergrAd — Google AdSense in-feed ad unit
// ────────────────────────────────────────────────────────────
// Drops a single AdSense <ins> block styled to match PostCard. The
// AdSense loader script is injected exactly once per page; every
// mounted <VergrAd /> just calls `adsbygoogle.push({})` to request a
// fill for its own slot.
//
// IMPORTANT policy boundaries (do NOT relax these without reading the
// AdSense program policies):
//
//   1. Never render this component on /earn, /quests or anywhere that
//      also prompts the user to watch ads for rewards. That's an
//      incentivised-traffic violation and AdSense will ban the account.
//   2. Never auto-click, hover-click, or encourage users to click. No
//      "click this ad for VP" copy anywhere nearby.
//   3. Until the account + domain is approved, `publisherId` / `slots.feed`
//      stay blank and this component renders nothing — no blank grey
//      boxes, no "Sponsored" placeholder. Clean feed while in review.
//
// Props:
//   zone — "inpage" is the only supported value today. Kept so callers
//          don't have to change when a secondary slot (e.g. profile)
//          is added later.

const SCRIPT_FLAG = '__vergr_adsense_loaded__';

function loadAdSenseOnce(publisherId) {
  if (typeof window === 'undefined') return;
  if (window[SCRIPT_FLAG]) return;
  window[SCRIPT_FLAG] = true;
  try {
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(publisherId)}`;
    document.head.appendChild(s);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[VergrAd] AdSense loader failed:', err && err.message);
  }
}

export default function VergrAd({ zone = 'inpage' }) {
  const insRef = useRef(null);
  const pushedRef = useRef(false);

  // Ads are a FREE-tier-only experience. Lite/Pro (and admins) never see a
  // third-party ad anywhere — paying to remove ads is a core paid perk.
  const { isFree } = useTier();

  // NATIVE: AdSense is a web-pages-only program — it never fills inside the app
  // shell and running it there risks the account that also serves the website.
  // The app instead reserves this slot and Kotlin positions a real AdMob NATIVE
  // ad card over it (utils/nativeFeedAd.js + FeedAdBridge.kt), so the ad sits
  // BETWEEN feed posts rather than being pinned to the screen edge.
  const nativeSlotRef = useRef(null);
  const nativeAdOn = isFree && IS_NATIVE_BUILD && isNativeFeedAdAvailable();
  // The slot KEEPS its reserved height whether or not an ad fills — the point
  // of the slot is to earn, so we hold the space and retry rather than hiding
  // the inventory. The callback exists purely so a no-fill is DIAGNOSABLE:
  // before this, a blank slot and a broken slot looked identical from the
  // outside, with no logging anywhere in the chain.
  // Remote diagnostic switch (app_config/general.adsUseTestIds). Test units
  // always fill, so flipping it proves whether a blank slot is AdMob having
  // nothing to serve or our rendering being broken — no rebuild needed.
  const testAds = useAdsTestMode();
  useEffect(() => {
    if (!nativeAdOn || !nativeSlotRef.current) return undefined;
    return attachFeedAd(
      nativeSlotRef.current,
      (filled, code) => {
        if (filled) return;
        // eslint-disable-next-line no-console
        console.warn('[VergrAd] native feed ad did not fill, AdMob code =', code);
        try { window.__vergrFeedAdLastCode = code; } catch { /* ignore */ }
      },
      testAds ? testNativeFeedUnit() : undefined,
    );
  }, [nativeAdOn, testAds]);

  // WEB: AdSense in-feed unit.
  const ready = isFree && !IS_NATIVE_BUILD && isAdZoneReady('adsense-feed');
  const { publisherId, slots } = ADS_CONFIG.adsense;
  const slotId = zone === 'inpage' ? slots.feed : null;

  useEffect(() => {
    if (!ready || !slotId) return;
    loadAdSenseOnce(publisherId);
    if (pushedRef.current) return;
    pushedRef.current = true;
    // Defer the push so the <ins> has been laid out before AdSense reads
    // its width. Without this, the first request on SPA route change can
    // arrive with width=0 and return nothing.
    const t = setTimeout(() => {
      try {
        // eslint-disable-next-line no-undef
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[VergrAd] adsbygoogle.push failed:', err && err.message);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [ready, publisherId, slotId]);

  // NATIVE: reserve the gap the Android NativeAdView is positioned over. The
  // card itself is drawn by the AdMob SDK on top of this space.
  if (nativeAdOn) {
    return (
      <div
        ref={nativeSlotRef}
        className="mb-3 rounded-2xl overflow-hidden bg-surface-1 border border-white/[0.06]"
        style={{ height: NATIVE_AD_HEIGHT }}
        aria-hidden="true"
      />
    );
  }

  // Not configured yet → render nothing. Clean feed during review.
  if (!ready || !slotId) return null;

  return (
    <div className="mb-3 overflow-hidden rounded-2xl border border-white/[0.06] bg-surface-1">
      <ins
        ref={insRef}
        className="adsbygoogle block"
        style={{ display: 'block' }}
        data-ad-client={publisherId}
        data-ad-slot={slotId}
        data-ad-format="fluid"
        data-ad-layout-key="-6t+ed+2i-1n-4w"
        data-full-width-responsive="true"
      />
    </div>
  );
}
