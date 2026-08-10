// useAdsTestMode — reads `app_config/general.adsUseTestIds`.
//
// WHY THIS EXISTS: when a feed ad slot renders blank there are exactly two
// possible causes, and from the outside they look identical —
//   (a) AdMob has no ad to serve (normal for a young unit), or
//   (b) our overlay/rendering path is broken and would never show an ad.
//
// Google's TEST ad units ALWAYS fill. So flipping this flag makes the native
// feed slot request the test unit: if a card appears, the whole pipeline
// (bridge → AdLoader → NativeAdView → overlay positioning) is proven correct
// and the blank is purely AdMob-side. If it still doesn't appear, the bug is
// ours. One boolean, one answer, no APK rebuild — which is the point of it
// living in Firestore rather than in the bundle.
//
// LEAVE IT OFF in normal operation: test ads earn nothing.

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';

const LS_KEY = 'vergr.adsUseTestIds';

function readLS() {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
    return null;
  } catch { return null; }
}
function writeLS(v) {
  try { localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch { /* ignore */ }
}

let cached = readLS();
const listeners = new Set();
let unsub = null;

function ensureSubscription() {
  if (unsub) return;
  try {
    unsub = onSnapshot(
      doc(db, 'app_config', 'general'),
      (snap) => {
        const next = snap.exists() ? !!snap.data()?.adsUseTestIds : false;
        if (next !== cached) {
          cached = next;
          writeLS(next);
          for (const cb of listeners) { try { cb(next); } catch { /* ignore */ } }
        }
      },
      () => { /* error → keep the last cached value */ },
    );
  } catch { /* ignore */ }
}

export default function useAdsTestMode() {
  const [on, setOn] = useState(cached === true);
  useEffect(() => {
    ensureSubscription();
    if (cached !== null) setOn(cached);
    const cb = (v) => setOn(v);
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  }, []);
  return on;
}
