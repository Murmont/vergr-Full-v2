import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, OAuthProvider } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager, persistentMultipleTabManager } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import { getDatabase } from 'firebase/database';
import { getMessaging, isSupported } from 'firebase/messaging';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { IS_NATIVE_BUILD, isTauri } from '../utils/platform';

const firebaseConfig = {
  apiKey: "AIzaSyCuwlEMPFzhmXx_FqdWiYWlshuRT_EIkoI",
  authDomain: "vergr-44494.firebaseapp.com",
  databaseURL: "https://vergr-44494-default-rtdb.firebaseio.com",
  projectId: "vergr-44494",
  storageBucket: "vergr-44494.firebasestorage.app",
  messagingSenderId: "674096624319",
  appId: "1:674096624319:web:a01744f81795f15b354c0a",
  measurementId: "G-674096624319"
};

// Check if Firebase is configured (has a real API key)
export const isFirebaseConfigured = !!firebaseConfig.apiKey && firebaseConfig.apiKey !== 'demo-key';

const app = initializeApp(firebaseConfig);

// ─── App Check (reCAPTCHA Enterprise) ─────────────────────────────
// Token is attached automatically to all Firestore / Functions / Storage calls.
// To enable the debug token during local dev, set VITE_APPCHECK_DEBUG=true in .env.local
// then grab the printed token from the browser console and allow-list it in the
// Firebase console → App Check → Apps → Debug tokens.
//
// ANY TAURI SHELL: App Check is DISABLED. reCAPTCHA Enterprise cannot validate
// inside the Android/Tauri WebView (its site key is domain-locked to vergr.app,
// and the WebView origin isn't a real allow-listed web origin), so the provider
// never yields a token. With App Check initialised, the Firestore SDK waits on
// that token for its Listen/Get channel and every read then fails with
// `unavailable` — the exact symptom on device (empty profile/feed, "You").
// App Check is NOT enforced server-side, so skipping it here costs no
// security and restores Firestore connectivity. Web/PWA keeps App Check.
//
// THIS MUST BE isTauri(), NOT IS_NATIVE_BUILD. IS_NATIVE_BUILD is the ANDROID
// build flag only, so the DESKTOP Tauri app kept initialising App Check and
// every Firestore read silently stalled. With persistence on, the SDK then
// serves the on-disk cache forever — no error, no offline indicator, just a
// feed and inbox frozen at whenever the cache was last populated. That was the
// real cause of "desktop shows messages/posts from weeks ago"; the transport
// setting below is secondary.
try {
  if (!IS_NATIVE_BUILD && !isTauri() && typeof window !== 'undefined' && isFirebaseConfigured) {
    if (import.meta.env.DEV && import.meta.env.VITE_APPCHECK_DEBUG === 'true') {
      // eslint-disable-next-line no-undef
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider('6LeJdbksAAAAAPARHuVkmwui1xGN37vuz3DLxCXu'),
      isTokenAutoRefreshEnabled: true,
    });
  }
} catch (err) {
  // App Check init failures should not crash the app — log and move on.
  console.warn('App Check init failed:', err?.message || err);
}

// IMPORTANT: Your Firestore uses custom database ID 'vgrdb', not '(default)'.
//
// Transport: web/PWA uses the SDK default (WebChannel). Native (Android WebView)
// forces long-polling — WebChannel's streaming can fail to establish inside the
// WebView. The real native blocker was App Check (see above); long-polling is
// kept as the more WebView-compatible transport. Do not enable the
// `experimentalAutoDetectLongPolling` probe here — its auto-detect handshake is
// itself flaky in the WebView.
//
// ON-DEVICE PERSISTENCE (Telegram-style): `persistentLocalCache` stores every
// read in IndexedDB on the phone. Without it the app re-fetched the profile,
// chat list and messages from the server on EVERY cold open — so a reopen showed
// a blank "You" profile + empty inbox until the network round-trip landed, and
// airplane mode showed nothing at all. It also starved the image cache: a cold
// open didn't know an avatar's URL (it lives on the not-yet-loaded profile doc)
// so the picture couldn't be pulled from the on-device blob store. With the cache
// on, the profile/inbox/messages paint INSTANTLY from disk on reopen (and work
// offline), which is what finally makes avatars appear immediately.
//
// TAB MANAGER: web/PWA uses persistentMultipleTabManager (Firebase's
// recommended web default). The single-tab manager with forceOwnership was
// wrong for the browser: when the app is open in >1 tab (e.g. testing two
// accounts) the newest tab STEALS the IndexedDB lease and every other tab's
// Firestore then floods "INTERNAL ASSERTION FAILED: Unexpected state" and its
// reads/writes wedge (a post silently failing to save was this). The multi-tab
// manager instead shares ONE coordinated cache across tabs, so no tab fights
// for a lease. Native is a single WebView (no competing tabs) and its
// long-polling transport is happiest with the single-tab owner, so it keeps
// persistentSingleTabManager({ forceOwnership: true }).
// GATE ON isTauri(), NOT IS_NATIVE_BUILD. IS_NATIVE_BUILD is the Android build
// flag only, so the DESKTOP Tauri shell was falling into the browser branch —
// but it is an embedded WebView (WebView2), not a browser. It got Firestore's
// default WebChannel transport, which can stall silently inside a webview: the
// SDK then serves the persistent cache forever and the app looks "synced" while
// showing stale posts and stale chats with no error. Long polling is the same
// transport that fixed this on Android. The single-tab owner is likewise right
// for any Tauri shell (one webview, no competing tabs); plain web/PWA keeps the
// multi-tab manager because real browser tabs DO fight over the cache lease.
const isTauriShell = IS_NATIVE_BUILD || isTauri();
const firestoreSettings = {
  ...(isTauriShell ? { experimentalForceLongPolling: true } : {}),
  localCache: persistentLocalCache({
    tabManager: isTauriShell
      ? persistentSingleTabManager({ forceOwnership: true })
      : persistentMultipleTabManager(),
  }),
};
export const db = isFirebaseConfigured
  ? initializeFirestore(app, firestoreSettings, 'vgrdb')
  : null;

export const auth = getAuth(app);
export const storage = getStorage(app);
// ─────────────────────────────────────────────────────────────────────
// Callables: region vs geo proxy.
//
// Passing a region sends callables straight to
// europe-west1-vergr-44494.cloudfunctions.net, which Cloudflare never sees.
// That is why every geo gate in the platform failed open (functions/geo.js
// reads Cloudflare's cf-ipcountry header, which was never present).
//
// Passing a URL instead routes them through the Worker in
// infra/cf-geo-proxy, which stamps the real country before forwarding.
//
// FLIP THIS TO true ONLY AFTER api.vergr.app answers:
//   curl https://api.vergr.app/__geo   →   {"ok":true,"country":"ZA",...}
//
// Turning it on before the Worker is live points EVERY callable in the app
// at a dead host. Deploy the Worker first, verify, then flip.
// ─────────────────────────────────────────────────────────────────────
// Live since 2026-07-28. Verified: https://api.vergr.app/getRegionStatus
// returns a real country, the direct origin still returns unknown_region.
const USE_GEO_PROXY = true;
const FUNCTIONS_TARGET = USE_GEO_PROXY ? 'https://api.vergr.app' : 'europe-west1';

export const functions = isFirebaseConfigured ? getFunctions(app, FUNCTIONS_TARGET) : null;
export const rtdb = getDatabase(app);

// Auth providers
export const googleProvider = new GoogleAuthProvider();

// FCM messaging — only available in supported browsers
export let messaging = null;
isSupported().then(supported => {
  if (supported && isFirebaseConfigured) {
    messaging = getMessaging(app);
  }
}).catch(() => {});

export default app;