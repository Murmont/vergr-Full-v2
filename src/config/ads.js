// ────────────────────────────────────────────────────────────
// Ads configuration
// ────────────────────────────────────────────────────────────
// Two ad networks, strictly partitioned by page to stay policy-safe:
//
//   • AdSense (Google)  — in-feed display ads. Lives on content pages
//     ONLY (feed, profile, clip viewer). AdSense forbids sharing a page
//     with incentivised or misleading ads, so the Earn screen must
//     never render an AdSense unit.
//
//   • Monetag (PropellerAds) — Direct Link for Watch-to-Earn, and a
//     pending Banner zone for inline feed units once Monetag approves
//     the publisher. Direct Link is the ONLY Monetag format allowed on
//     the Earn screen; In-Page Push (corner popups) is disabled because
//     it looks spammy and also conflicts with AdSense policy.
//
// While AdSense is in review, `adsense.publisherId` and `adsense.slots`
// stay blank and the in-feed component renders nothing (no ugly empty
// placeholders). Set the values from the AdSense dashboard to go live.

// Google's official TEST native-advanced unit. It ALWAYS fills, which makes it
// the only reliable way to tell "AdMob has no ad to serve" apart from "our
// rendering path is broken". Used when app_config/general.adsUseTestIds is
// true (see hooks/useAdsTestMode.js). Test ads earn nothing — diagnosis only.
export const TEST_NATIVE_UNIT_ID = 'ca-app-pub-3940256099942544/2247696110';

export const ADS_CONFIG = {
  // ── Google AdSense (non-incentivised display) ──────────────────────
  adsense: {
    // From AdSense → Account information. Format: ca-pub-XXXXXXXXXXXXXXXX
    publisherId: 'ca-pub-6563780861093445',
    slots: {
      // From AdSense → Ads → By ad unit → In-feed ads
      feed: '6484617485',
    },
  },

  // ── Google AdMob (NATIVE app only) ─────────────────────────────────
  // AdSense is for web; embedding it in the native app violates AdSense
  // policy. The Android shell uses AdMob via the AdMobBridge Kotlin class.
  // Today we use ONE format: Rewarded ads → server-side-verified COINS
  // (watch-to-earn). Inline native feed/comment ads are NOT possible
  // cleanly inside a WebView under AdMob policy — they await the eventual
  // native rewrite.
  //
  // These default to Google's official TEST IDs so a test APK works
  // end-to-end. Swap in the real AdMob App ID + Rewarded unit ID before a
  // production APK, and set the SSV callback URL in the AdMob console to the
  // admobSsvCallback Cloud Function. The App ID also lives in
  // AndroidManifest.xml meta-data (must match) — update both.
  // PETAL ADS (HUAWEI Ads Kit) — the AppGallery build only.
  //
  // Huawei devices ship without Google Play Services, so AdMob can never fill
  // there. The Huawei build registers HuaweiAdsBridge under the same
  // `window.VergrAds` name and reads the slot IDs below instead of the AdMob
  // unit IDs.
  //
  // The `test*` values are HUAWEI's own published test slots: they always fill,
  // and they earn nothing. Replace each with a real slot from Petal Publisher
  // Center once the publisher account is approved (Petal Publisher Center →
  // Monetise → Ad Slots). Leave them as test IDs until then — a real slot that
  // does not exist yet returns a load error, which is indistinguishable from a
  // broken integration.
  petal: {
    useTestSlots: true,
    rewardedSlotId: 'testx9dtjwj8hp',
    bannerSlotId: 'testw6vs28auh3',
    nativeFeedSlotId: 'testu7m3hc4gvm',
  },

  admob: {
    // ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY  (also in AndroidManifest.xml)
    appId: 'ca-app-pub-4584066602378782~6999622802',
    rewardedUnitId: 'ca-app-pub-4584066602378782/8267596734',
    // Anchored adaptive banner shown above the bottom nav on native. AdSense is
    // a web-pages-only program, so it must not render inside the app shell —
    // AdMob is the sanctioned way to monetise the native feed, and it is the
    // same account already serving the rewarded ads.
    //
    // FOUNDER: create a Banner unit in AdMob (Apps → VERGR → Ad units → Banner)
    // and paste its id here. Until then bannerUnitId stays null and the native
    // banner simply doesn't mount — no blank space, no policy risk.
    bannerUnitId: null,
    // TRUE IN-FEED ad: an AdMob "Native advanced" unit. The feed reserves a
    // slot and FeedAdBridge.kt positions a real NativeAdView over it, so the
    // ad sits BETWEEN posts instead of being pinned above the nav. Native
    // assets must be rendered by the SDK (impression/click tracking + policy),
    // which is why this is an Android view and not HTML.
    //
    // Native advanced unit, created 2026-07-23. Media type: image + video,
    // eCPM floor "All prices" (maximise fill while volume is low — a floor
    // makes "no fill" indistinguishable from "integration broken").
    nativeFeedUnitId: 'ca-app-pub-4584066602378782/4328450757',
    useTestIds: false,
  },

  // ── Monetag ────────────────────────────────────────────────────────
  // In-Page Push intentionally removed (see sw.js comment).
  // Banner zone pending Monetag approval — add here when it lands:
  //   banner: { zoneId: '...', scriptSrc: '...' },
  banner: null,

  // Vignette (fullscreen pre-roll) — kept in config but DISABLED in
  // favour of a policy-clean experience while AdSense is the primary
  // monetisation path. Flip `enabled: true` only on pages that have no
  // AdSense unit on them.
  vignette: {
    enabled: false,
    zoneId: '10851366',
    scriptSrc: 'https://n6wxm.com/vignette.min.js',
  },

  // Direct Link opened by the Watch-to-Earn daily quest on /earn only
  directLinkUrl: 'https://omg10.com/4/10851371',

  // ── Tunable knobs ──────────────────────────────────────────────────

  // Feed posts between in-feed AdSense placements. AdSense requires a
  // healthy content-to-ad ratio; one ad per 10 posts.
  feedAdInterval: 10,

  // Comments between in-thread AdSense placements (X-style ads in replies).
  // Threads are shorter than feeds, so a tighter interval; still policy-safe.
  commentAdInterval: 6,

  // Watch-to-Earn (Earn screen only)
  watchToEarnSeconds: 30,
  watchToEarnVp: 100,
  dailyAdBonusThreshold: 10,
  dailyAdBonusVp: 250,
};

/** Returns true if the given zone has been configured AND is enabled. */
export const isAdZoneReady = (zone) => {
  if (zone === 'adsense-feed') {
    return !!(ADS_CONFIG.adsense.publisherId && ADS_CONFIG.adsense.slots.feed);
  }
  if (zone === 'banner') {
    return !!(ADS_CONFIG.banner && ADS_CONFIG.banner.zoneId && ADS_CONFIG.banner.scriptSrc);
  }
  if (zone === 'interstitial' || zone === 'vignette') {
    return !!(ADS_CONFIG.vignette.enabled && ADS_CONFIG.vignette.zoneId && ADS_CONFIG.vignette.scriptSrc);
  }
  if (zone === 'directlink') return !!ADS_CONFIG.directLinkUrl;
  return false;
};
