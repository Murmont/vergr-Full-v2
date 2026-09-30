import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs'; // used by vergr-inline-splash-art (this config is ESM: no require)
import { fileURLToPath } from 'url';

// package.json has "type": "module", so this file is REAL ESM and __dirname does
// not exist. Referencing it throws a ReferenceError inside whichever hook uses
// it, and Vite swallows a failing transformIndexHtml hook silently: the build
// still exits 0 and just emits an untransformed index.html. Define it properly.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Detect Tauri dev mode
const isTauriDev = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig(({ mode }) => {
  // DEMO builds (`--mode demo` = web, `--mode demo-native` = native screens).
  // Both alias firebase/* + a couple internal modules to in-memory shims in
  // src/demo/* so the bundle makes ZERO real-backend calls and renders from
  // src/demo/fixtures.js. `demo-native` additionally sets the native screen
  // flag so /watch, go-live, etc. use the real mobile app screens (correct
  // mobile viewer). Output goes to dist-demo[-native]/ so a normal build is
  // never affected.
  const isDemo = mode === 'demo' || mode === 'demo-native';
  // STORE builds (`--mode native-store`) = the native app minus the in-app APK
  // self-updater (AppGallery / Play policy forbids self-updating). Everything
  // else identical to `--mode native`; store users update via the store.
  // HUAWEI builds (`--mode native-huawei`) = an AppGallery variant. It inherits
  // every store policy gate (self-updater off, no betting, no buy-and-send,
  // withdrawals handed to the browser) because AppGallery's rules on those are
  // the same shape as Play's — hence isStore is true for it too. The ONE
  // difference is payments: Huawei devices have no Google Play Services, so
  // Play Billing can never work there and coins are sold through PayRam.
  //
  // Keep this a SEPARATE MODE. The Play build must stay byte-identical, and it
  // does: __VERGR_HUAWEI__ is a compile-time false there, so every Huawei
  // branch is tree-shaken out of the Play bundle.
  // DEV CHANNEL builds (`--mode native-dev`) = the founder's private playground
  // APK. It is a STORE build in every respect (isStore is true for it) so that
  // what he tests is what Play will ship: same gates, same Play Billing routing,
  // same withdrawal handoff. It changes exactly ONE thing: the in-app updater is
  // switched back on and pointed at a SEPARATE manifest (version-dev.json) and a
  // separate R2 object (downloads/VERGR-dev.apk).
  //
  // That separation is the whole point. The public sideload APK and the stable
  // version.json must stay frozen at the released build, so anyone downloading
  // from /platform (or any existing sideload install polling for updates) never
  // sees an unreleased build. Only a device that already has a dev-channel APK
  // installed reads the dev manifest, and the only way to get one is to install
  // it by hand from the unlisted URL once.
  //
  // Re-enabling self-update here is NOT a store-policy problem: dev-channel
  // builds are never distributed through Play or AppGallery.
  // ADMIN build (`--mode admin`) = Vergr Admin, the operator console, as its
  // own desktop application. It has its OWN html entry (admin.html), its own
  // React root (src/admin/main.jsx) and its own output directory, so it shares
  // the admin SCREENS with the app and nothing else. It is never deployed to
  // hosting: the founder's rule is that the admin must not be reachable from
  // the web at all.
  const isAdmin = mode === 'admin';
  // VANGUARD build (`--mode vanguard`) = Vergr Vanguard, the moderation app,
  // built exactly like Vergr Admin: its own html entry (vanguard.html), its own
  // React root (src/vanguard/main.jsx), its own output directory, never deployed
  // to hosting. It shares the Vanguard SCREENS with nothing else: the web app no
  // longer routes them (2026-09-21).
  const isVanguardApp = mode === 'vanguard';
  const isDevChannel = mode === 'native-dev';
  const isHuawei = mode === 'native-huawei';
  const isStore = mode === 'native-store' || isHuawei || isDevChannel;
  const isNative = mode === 'native' || mode === 'demo-native' || isStore;
  const demoAlias = isDemo
    ? {
        'firebase/firestore': path.resolve(__dirname, 'src/demo/mockFirestore.js'),
        'firebase/auth': path.resolve(__dirname, 'src/demo/mockAuth.js'),
        'firebase/database': path.resolve(__dirname, 'src/demo/mockDatabase.js'),
        'firebase/functions': path.resolve(__dirname, 'src/demo/mockFunctions.js'),
        'firebase/app': path.resolve(__dirname, 'src/demo/mockMisc.js'),
        'firebase/app-check': path.resolve(__dirname, 'src/demo/mockMisc.js'),
        'firebase/storage': path.resolve(__dirname, 'src/demo/mockMisc.js'),
        'firebase/messaging': path.resolve(__dirname, 'src/demo/mockMisc.js'),
      }
    : {};
  const outDir = mode === 'demo' ? 'dist-demo'
    : mode === 'demo-native' ? 'dist-demo-native'
    : isAdmin ? 'dist-admin'
    : isVanguardApp ? 'dist-vanguard'
    : 'dist';

  return {
    // Option B native build flag. `npm run build:android` runs `vite build
    // --mode native`. The router reads this (via IS_NATIVE_BUILD) to bundle
    // native screens. `demo-native` also turns it on for correct mobile UI.
    define: {
      __VERGR_NATIVE__: JSON.stringify(isNative),
      __VERGR_DEMO__: JSON.stringify(isDemo),
      __VERGR_STORE_BUILD__: JSON.stringify(isStore),
      __VERGR_HUAWEI_BUILD__: JSON.stringify(isHuawei),
      __VERGR_DEV_CHANNEL__: JSON.stringify(isDevChannel),
      __VERGR_ADMIN__: JSON.stringify(isAdmin),
      __VERGR_VANGUARD_APP__: JSON.stringify(isVanguardApp),
    },
    plugins: [
      react(),
      // DEMO: redirect specific internal modules to in-memory demo stubs. Vite
      // alias-by-absolute-path doesn't match relative imports, so match by
      // suffix in resolveId instead.
      isDemo && {
        name: 'vergr-demo-modules',
        enforce: 'pre',
        resolveId(source) {
          if (/(^|\/)utils\/chatRelay(\.js)?$/.test(source)) return path.resolve(__dirname, 'src/demo/mockChatRelay.js');
          if (/(^|\/)utils\/messageCache(\.js)?$/.test(source)) return path.resolve(__dirname, 'src/demo/mockMessageCache.js');
          // /watch mobile viewer → populated founder Solo Stream design
          if (/streams\/ViewerStreamScreen(\.jsx)?$/.test(source)) return path.resolve(__dirname, 'src/demo/DemoLiveViewer.jsx');
          if (/streams\/native\/NativeViewerStreamScreen(\.jsx)?$/.test(source)) return path.resolve(__dirname, 'src/demo/DemoLiveViewer.jsx');
          return null;
        },
      },
      // The boot-splash art used to be inlined here as data: URIs on native.
      // THAT PLUGIN IS GONE ON PURPOSE — do not bring it back.
      //
      // The native boot screen is a Kotlin view (SplashController) drawing
      // compiled APK drawables, and the HTML boot splash is display:none on the
      // shell (`html.vergr-native #boot-splash`, applied by an inline script in
      // <head> before the element is even parsed, so it never paints). Inlining
      // ~270KB of nebula and mark into index.html for an element that is never
      // shown only made the document slower to parse on exactly the cold start
      // it was meant to help.
      //
      // Web builds were never inlined either: the HTML shell is served no-cache
      // (firebase.json), so inlining would re-download the art on every page
      // load. The preload links in <head> cover web.
    ].filter(Boolean),
    base: isTauriDev ? './' : '/',
    server: { port: 5173, host: true, strictPort: isTauriDev },
    clearScreen: false,
    build: {
      outDir,
      sourcemap: false,
      rollupOptions: {
        // The admin app boots from admin.html, not index.html, so the consumer
        // shell (and everything it pulls in) is not in this bundle at all.
        ...(isAdmin ? { input: path.resolve(__dirname, 'admin.html') } : {}),
        ...(isVanguardApp ? { input: path.resolve(__dirname, 'vanguard.html') } : {}),
        // See history: only externalize specifiers that can't resolve at build
        // time; keep @tauri-apps/api/core + /event bundled for the OTA path.
        external: [
          '@tauri-apps/plugin-opener',
          '@tauri-apps/api/fs',
          '@tauri-apps/api/dialog',
        ],
      },
    },
    resolve: { alias: { '@': '/src', ...demoAlias } },
    envPrefix: ['VITE_', 'TAURI_'],
  };
});
