// IS_HUAWEI_BUILD is a compile-time constant and platform.js imports nothing,
// so this cannot become a cycle. It is what `adUnitFor()` at the bottom of this
// file branches on.
import { IS_HUAWEI_BUILD } from '../utils/platform';

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
  // REAL slots, created 2026-09-17 in Petal Publisher Center under app
  // Vergr(APK) 118257437. Both publisher agreements are signed (Merchant
  // 2026-08-04, Petal Ads Publisher 2026-09-17), and all three units read
  // "Enabled".
  //
  // ⚠ Their APP status reads "Inactive" until Vergr is actually RELEASED on
  // AppGallery, and an inactive app does not get filled. So a pre-release
  // build will see no-fill on every one of these, which is correct behaviour
  // and NOT an integration fault. Flip `useTestSlots` to true to tell the two
  // apart: Huawei's test slots always fill, so if a test slot fills and a real
  // one does not, the integration is fine and the app is simply not live yet.
  petal: {
    useTestSlots: false,
    rewardedSlotId: 'u3ahi3x1j8',
    bannerSlotId: 'd63128ivt1',
    nativeFeedSlotId: 'j71bbgou0y',
    // Huawei's own published test slots. Kept so the swap above is one edit.
    testRewardedSlotId: 'testx9dtjwj8hp',
    testBannerSlotId: 'testw6vs28auh3',
    testNativeFeedSlotId: 'testu7m3hc4gvm',
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

// ────────────────────────────────────────────────────────────
// THE ONE PLACE THAT DECIDES WHICH SLOT ID A BUILD USES.
// ────────────────────────────────────────────────────────────
//
// ⚠⚠ THIS EXISTS BECAUSE THE PETAL IDS WERE DEAD CONFIG. Before 2026-09-17,
// `ADS_CONFIG.petal.bannerSlotId` and `.nativeFeedSlotId` had ZERO readers, and
// `useTestSlots` had zero readers, so:
//
//   • nativeBanner.js gated on `admob.bannerUnitId`, which is null, so the
//     Huawei build NEVER showed a banner even though a Petal banner slot
//     existed for it;
//   • nativeFeedAd.js handed `admob.nativeFeedUnitId` — a `ca-app-pub-…`
//     string — to the PETAL SDK, which can never fill it;
//   • flipping `useTestSlots` changed nothing at all.
//
// Only the rewarded path branched, and it did so inline in admob.js. Three
// call sites, three different answers to one question, which is exactly how
// the boost surfaces and the avatar orbit drifted apart. There is now ONE
// answer, and every caller asks it.
//
// Returns null when this build has no slot for that format — callers already
// treat a falsy id as "do not mount", so an unconfigured format stays silent
// rather than rendering an empty hole.
export function adUnitFor(kind) {
  const p = ADS_CONFIG.petal;
  if (IS_HUAWEI_BUILD) {
    if (kind === 'rewarded') return p.useTestSlots ? p.testRewardedSlotId : p.rewardedSlotId;
    if (kind === 'banner') return p.useTestSlots ? p.testBannerSlotId : p.bannerSlotId;
    if (kind === 'nativeFeed') return p.useTestSlots ? p.testNativeFeedSlotId : p.nativeFeedSlotId;
    return null;
  }
  const a = ADS_CONFIG.admob;
  if (kind === 'rewarded') return a.rewardedUnitId || null;
  if (kind === 'banner') return a.bannerUnitId || null;
  if (kind === 'nativeFeed') return (a.useTestIds ? TEST_NATIVE_UNIT_ID : a.nativeFeedUnitId) || null;
  return null;
}

/**
 * The always-fills diagnostic in-feed unit for THIS build, used by the remote
 * `adsUseTestIds` switch. On Huawei that has to be Petal's test slot — handing
 * Google's `ca-app-pub-3940…` test unit to the Petal SDK reproduces the exact
 * blank slot the switch exists to rule out.
 */
export const testNativeFeedUnit = () =>
  (IS_HUAWEI_BUILD ? ADS_CONFIG.petal.testNativeFeedSlotId : TEST_NATIVE_UNIT_ID);

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
