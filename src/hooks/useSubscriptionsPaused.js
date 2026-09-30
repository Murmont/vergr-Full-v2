// useSubscriptionsPaused — reads app_config/general.subscriptions.newSubscriptionsPaused.
//
// Set from Vergr Admin → Subscriptions → Settings. The server refuses a new
// plan on the rails it controls (coins, card) by itself; this hook is what
// stops a Google Play or AppGallery purchase, which the store charges BEFORE
// Vergr is asked, so the buy buttons must not be offered at all while paused.
//
// ⚠ One module-level listener shared by every mount, on the same document the
// ads and chat flags already listen to. The Firestore SDK serves identical
// document listeners from one target, so on a client that already has one of
// those open this costs no extra read.

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';

let current = false;
let unsub = null;
const listeners = new Set();

function ensureSubscription() {
  if (unsub) return;
  try {
    unsub = onSnapshot(
      doc(db, 'app_config', 'general'),
      (snap) => {
        const next = snap.exists() ? snap.data()?.subscriptions?.newSubscriptionsPaused === true : false;
        if (next !== current) {
          current = next;
          for (const cb of listeners) { try { cb(next); } catch { /* ignore */ } }
        }
      },
      () => { /* keep the last value; the server still refuses coins and card */ },
    );
  } catch { /* ignore */ }
}

export default function useSubscriptionsPaused() {
  const [paused, setPaused] = useState(current);
  useEffect(() => {
    ensureSubscription();
    listeners.add(setPaused);
    setPaused(current);
    return () => { listeners.delete(setPaused); };
  }, []);
  return paused;
}
