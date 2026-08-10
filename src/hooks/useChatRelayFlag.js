// useChatRelayFlag — reads `app_config/general.chatRelayEnabled` and exposes a
// boolean that decides whether chat screens route via the relay (no Firestore
// message bodies) or fall back to the legacy Firestore path.
//
// CRITICAL: the initial state on first render comes from localStorage (sync),
// not from a Firestore subscription that hasn't fired yet. Without this, a
// user who sends a message in the first ~100ms of mounting a chat thread
// would hit the LEGACY path (relayEnabled=false default) and write to
// Firestore — exactly what we're trying to avoid. After the Firestore
// subscription returns, the cached value updates and is persisted back to
// localStorage for next load.

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';

const LS_KEY = 'vergr.chatRelayEnabled';

function readLS() {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
    return null;
  } catch { return null; }
}
function writeLS(v) {
  try { localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch {/* ignore */}
}

let cached = readLS();    // sync init from localStorage
const listeners = new Set();
let unsub = null;

function ensureSubscription() {
  if (unsub) return;
  try {
    unsub = onSnapshot(
      doc(db, 'app_config', 'general'),
      (snap) => {
        const next = snap.exists() ? !!snap.data()?.chatRelayEnabled : false;
        if (next !== cached) {
          cached = next;
          writeLS(next);
          for (const cb of listeners) try { cb(next); } catch {/* ignore */}
        }
      },
      () => { /* error → keep last cached value */ },
    );
  } catch {/* ignore */}
}

export default function useChatRelayFlag() {
  // Initial state from localStorage so the FIRST render after mount already
  // knows the right answer for users who've loaded the app before.
  const [enabled, setEnabled] = useState(cached === true);
  useEffect(() => {
    ensureSubscription();
    if (cached !== null) setEnabled(cached);
    const cb = (v) => setEnabled(v);
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, []);
  return enabled;
}
