/**
 * Platform detection for VERGR
 * Detects whether the app is running in a browser or Tauri desktop shell.
 */

export const isTauri = () => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

/**
 * BUILD-TIME native flag (Option B). Injected by vite.config.js `define` as a
 * boolean literal: true only for the Android build (`vite build --mode native`,
 * run by `npm run build:android`), false for the web/desktop build.
 *
 * Use this — NOT the runtime isMobileApp() — to select native screen variants
 * in the router. The native APK bundles the native screens baked in; the web
 * build never includes them. The textual `define` replace makes the `typeof`
 * guard safe even if a future entrypoint somehow skips the define.
 */
export const IS_NATIVE_BUILD =
  typeof __VERGR_NATIVE__ !== 'undefined' ? __VERGR_NATIVE__ : false;

/**
 * STORE-variant build (`vite build --mode native-store`): the native app with
 * the in-app APK self-updater DISABLED (AppGallery / Play policy forbids apps
 * that update themselves). Store users get updates via the store instead.
 * false on every current sideload/web/desktop build.
 */
export const IS_STORE_BUILD =
  typeof __VERGR_STORE_BUILD__ !== 'undefined' ? __VERGR_STORE_BUILD__ : false;

/**
 * HUAWEI AppGallery variant (`vite build --mode native-huawei`). It is also a
 * store build, so it inherits every policy gate IS_STORE_BUILD applies.
 *
 * The one thing it changes is PAYMENTS. Huawei devices ship without Google Play
 * Services, so the Play Billing bridge can never connect there — the store
 * build's "fail closed" behaviour would leave a Huawei user with a coin pack
 * that reports "temporarily unavailable" forever. On this build coins are sold
 * through PayRam instead, which is exactly what the web build does.
 *
 * false on the Play build, so the Play bundle is unaffected: this is a
 * compile-time constant and the Huawei branches tree-shake away entirely.
 */
export const IS_HUAWEI_BUILD =
  typeof __VERGR_HUAWEI_BUILD__ !== 'undefined' ? __VERGR_HUAWEI_BUILD__ : false;

/**
 * The Google PLAY build (store build that is not Huawei; the dev channel counts,
 * on purpose, so the playground behaves like Play). It sells through Google Play
 * Billing ONLY: our own card/crypto checkout is not offered inside it until Vergr
 * enrolls in Google's alternative-billing programs (founder, 2026-09-11, once the
 * EIN arrives). See the header of components/wallet/PaymentMethodPicker.jsx.
 */
export const IS_PLAY_BUILD = IS_STORE_BUILD && !IS_HUAWEI_BUILD;

/**
 * The name of the store whose OWN billing this build must sell through, or null
 * when we are the merchant (web, desktop, sideload).
 *
 * ⚠⚠ USE `IS_STORE_BUILD` — NOT `IS_PLAY_BUILD` — TO DECIDE WHETHER TO OFFER
 * OUR OWN CARD CHECKOUT. Until 2026-09-17 every such gate read `IS_PLAY_BUILD`,
 * which was correct only while the Huawei build had no IAP: `IS_PLAY_BUILD` is
 * false on Huawei, so the AppGallery build rendered the "Card or crypto" row and
 * would have gone to review selling premium content outside HUAWEI IAP. That is
 * AppGallery Review Guideline 6.2, and it is a rejection.
 *
 * `IS_PLAY_BUILD` still has legitimate uses: anything that is true of GOOGLE
 * specifically (the Play prism asset, the Play-only help articles, copy naming
 * Google). Ask which question you mean.
 */
export const STORE_NAME = IS_STORE_BUILD ? (IS_HUAWEI_BUILD ? 'AppGallery' : 'Google Play') : null;

/**
 * DEV-CHANNEL build (`vite build --mode native-dev`): the founder's private
 * playground APK. Never published to /platform, never uploaded to a store.
 *
 * It is ALSO a store build (IS_STORE_BUILD is true here), deliberately, so the
 * playground behaves exactly like the Play build: same policy gates, same Play
 * Billing routing, same withdrawal handoff. Testing on a sideload build instead
 * would prove nothing about the bundle Play actually ships.
 *
 * The single behavioural difference is the updater: dev builds self-update from
 * a SEPARATE manifest + APK object, so the public download and every existing
 * sideload install stay pinned to the released version. See NativeUpdateBanner.
 *
 * The one thing it still cannot exercise is a real Play Billing purchase, which
 * requires a Play-installed build (internal testing track).
 */
export const IS_DEV_CHANNEL =
  typeof __VERGR_DEV_CHANNEL__ !== 'undefined' ? __VERGR_DEV_CHANNEL__ : false;

const ua = () =>
  (typeof navigator !== 'undefined' && navigator.userAgent) || '';

/** Running inside the native MOBILE shell (Tauri Android/iOS WebView). */
export const isMobileApp = () => isTauri() && /android|iphone|ipad|ipod/i.test(ua());

/** Running inside the native DESKTOP shell (Tauri Windows/macOS/Linux). */
export const isDesktopApp = () => isTauri() && !isMobileApp();

/** Native Android shell specifically (where direct-download + native FCM live). */
export const isAndroidApp = () => isMobileApp() && /android/i.test(ua());

/** Native iOS shell specifically (WKWebView: no getDisplayMedia). */
export const isIosApp = () => isMobileApp() && /iphone|ipad|ipod/i.test(ua());

export const getPlatform = () => {
  if (isMobileApp()) return 'mobile-app';
  if (isTauri()) return 'desktop';
  if (/Mobi|Android/i.test(ua())) return 'mobile';
  return 'web';
};

/**
 * Reload the app safely. With clean (BrowserRouter) URLs, the bundled native
 * shell has no SPA server fallback, so reloading a sub-path (e.g.
 * tauri://localhost/watch/123) would 404 the asset protocol → blank screen.
 * In the native shell we therefore reload from the ROOT, which always serves
 * index.html and re-boots the SPA. On the web, the Firebase rewrite serves
 * index.html for any path, so a normal in-place reload is fine.
 */
export const safeReload = () => {
  if (typeof window === 'undefined') return;
  if (IS_NATIVE_BUILD || isTauri()) window.location.href = '/';
  else window.location.reload();
};
