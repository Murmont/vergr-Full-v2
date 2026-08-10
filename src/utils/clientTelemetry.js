// I4 (NATIVE_APP_PLAN Part I): lightweight client error capture so silent
// failures (blank screens, failed loads, uncaught exceptions) surface to us
// instead of only to the founder. Near-zero cost: hard per-session cap + dedupe
// keep Firestore writes to a trickle, and only for users actually hitting
// errors. A capped ring buffer in localStorage keeps the last few for support.
//
// Deliberately NOT capturing the Firestore auth-race noise that main.jsx
// already filters (those are harmless retries, not real failures).

import { addDoc, collection, getFirestore } from 'firebase/firestore';
import { APP_VERSION } from './appVersion';

const SESSION_CAP = 5;          // max Firestore writes per page session
const RING_KEY = 'vergr.clientErrors';
const RING_MAX = 20;

let writes = 0;
const seen = new Set();         // dedupe within the session by message signature

function isIgnorable(msg = '') {
  return (
    msg.includes('permission-denied') ||
    msg.includes('Missing or insufficient permissions') ||
    msg.includes('@firebase/firestore') ||
    msg.includes('ResizeObserver loop') ||      // benign browser noise
    msg.includes('Script error.')               // opaque cross-origin, no detail
  );
}

function pushRing(entry) {
  try {
    const raw = localStorage.getItem(RING_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    arr.push(entry);
    while (arr.length > RING_MAX) arr.shift();
    localStorage.setItem(RING_KEY, JSON.stringify(arr));
  } catch { /* quota / private mode */ }
}

function record(kind, message, stack) {
  const msg = String(message || '').slice(0, 500);
  if (!msg || isIgnorable(msg)) return;

  const sig = `${kind}:${msg}`;
  const entry = {
    kind,
    message: msg,
    stack: String(stack || '').slice(0, 2000),
    route: (typeof location !== 'undefined' && location.pathname + location.hash) || '',
    ua: (typeof navigator !== 'undefined' && navigator.userAgent) || '',
    appVersion: APP_VERSION,
    ts: Date.now(),
  };
  pushRing(entry);

  if (writes >= SESSION_CAP || seen.has(sig)) return;
  seen.add(sig);
  writes += 1;

  // Capture the signed-in uid lazily so we don't import the auth context here.
  try {
    entry.uid = window.__VERGR_UID__ || null;
    addDoc(collection(getFirestore('vgrdb'), 'client_errors'), entry).catch(() => {});
  } catch { /* never let telemetry throw */ }
}

let installed = false;
export function installClientTelemetry() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (e) => {
    // Resource-load errors (img/script) have no e.error; capture the target src.
    if (e?.error) record('error', e.error.message || e.message, e.error.stack);
    else if (e?.target && (e.target.src || e.target.href)) {
      record('resource', `Failed to load: ${e.target.src || e.target.href}`, '');
    } else if (e?.message) {
      record('error', e.message, '');
    }
  }, true);

  window.addEventListener('unhandledrejection', (e) => {
    const r = e?.reason;
    if (r?.code === 'permission-denied') return; // auth-race, handled in main.jsx
    record('promise', (r && (r.message || String(r))) || 'Unhandled rejection', r?.stack);
  });
}
