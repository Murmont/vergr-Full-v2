import React from 'react';
import ReactDOM from 'react-dom/client';
import AppRouter from './router/AppRouter';
import DesktopUpdateGate from './components/DesktopUpdateGate';
import ErrorBoundary from './components/ErrorBoundary';
import { runMobileOtaUpdate } from './utils/otaUpdate';
import { installClientTelemetry } from './utils/clientTelemetry';
import { isTauri } from './utils/platform';
import { initNativeShare } from './utils/nativeShare';
import { seedSelfAvatar } from './utils/selfProfileCache';
import { initFileCache, runCacheEviction } from './utils/fileMediaCache';
import './index.css';

// Read the on-device media manifest into memory BEFORE React renders anything.
// This is what lets a render decide what to paint without awaiting: by the time
// the first frame is built, we already know which files we hold. It has to run
// at module scope, because useState initialisers read it during that first
// render and no effect fires early enough.
initFileCache();
// Your own avatar, resolvable with no await, on the very first frame.
seedSelfAvatar();
// Housekeeping: trim the reclaimable tier and age out orphaned files (an avatar
// someone replaced months ago). Fire and forget, never awaited, never blocks boot.
runCacheEviction();

// I4: surface silent client failures (blank screens / uncaught errors) to us.
installClientTelemetry();

// Desktop/native shell: stable "VERGR" title from the first frame. The WebView2
// renderer is labelled in Task Manager by document.title, so the static
// index.html marketing title showed up as the process name. seo.js keeps this
// pinned on route changes; this just covers the pre-mount / no-useSeo case. Web
// keeps the full SEO title for crawlers.
if (isTauri()) { try { document.title = 'VERGR'; } catch { /* noop */ } }

// Native Android: route the Web Share API through the system share sheet. The
// Kotlin bridge lands via addJavascriptInterface at WebView create; try now and
// once more shortly after in case it isn't attached yet at module eval.
if (isTauri()) {
  initNativeShare();
  setTimeout(initNativeShare, 1500);
}

// ─── Firestore SDK noise filter ────────────────────────────────
// The Firestore SDK auto-retries snapshot listeners across auth-state
// handoffs (sign-in, token refresh). For a few hundred ms the listener's
// previous auth context is invalid and the server returns permission-denied
// — which the SDK logs as an uncaught error before its own retry resolves
// the listener. The error is harmless (the listener recovers on its own)
// but pollutes the console. Filtering at console.error level catches every
// instance regardless of which listener generated it.
(function silenceFirestoreAuthRace() {
  // The Firestore SDK surfaces permission-denied two ways during the brief
  // auth handoff window (sign-in / token refresh): (1) onSnapshot listeners
  // without an error callback log "Uncaught Error in snapshot listener", and
  // (2) one-shot getDoc/getDocs that reject produce an "Uncaught (in promise)"
  // rejection. Both are harmless (the call retries once auth settles) but
  // paint the console red. Catch BOTH channels.
  const isFirestoreAuthRace = (msg) =>
    typeof msg === 'string' &&
    (msg.includes('@firebase/firestore') ||
      msg.includes('FirebaseError') ||
      msg.includes('Firestore')) &&
    (msg.includes('permission-denied') ||
      msg.includes('Missing or insufficient permissions'));

  const origError = console.error;
  console.error = function (...args) {
    // Firebase's logger splits the line across args:
    //   args[0] = "[<ts>]  @firebase/firestore:"
    //   args[1] = "Firestore (10.x): Uncaught Error ... permission-denied ..."
    // so the tag and the code live in DIFFERENT args. Join everything into
    // one string before matching, otherwise the combined check never fires.
    const joined = args
      .map((a) => (typeof a === 'string' ? a : (a && a.message) || ''))
      .join(' ');
    if (isFirestoreAuthRace(joined)) return;
    return origError.apply(console, args);
  };

  // Swallow the matching unhandled-promise-rejection noise from rejected
  // getDoc/getDocs during the same auth-handoff window.
  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (e) => {
      const r = e && e.reason;
      const msg = (r && (r.message || String(r))) || '';
      const code = r && r.code;
      if (code === 'permission-denied' || isFirestoreAuthRace(msg)) {
        e.preventDefault();
      }
    });
  }
})();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Desktop only: a loading-screen "update available" gate (Update now /
        Later, or required) shown before the app renders. Pure pass-through in
        the browser / PWA / native Android. */}
    <DesktopUpdateGate>
      {/* Last line of defence (audit A50). React unmounts the entire tree on an
          uncaught render error, so before this a single leaf component could
          blank the whole app to a black page. Route-level boundaries in
          AppRouter catch most things first and keep the nav alive; this one
          catches whatever gets past them. */}
      <ErrorBoundary label="root">
        <AppRouter />
      </ErrorBoundary>
    </DesktopUpdateGate>
  </React.StrictMode>
);

// Mobile native only: silently fetch + stage the latest signed OTA frontend
// bundle (applies on next launch). No-op in the browser / PWA / desktop.
runMobileOtaUpdate();