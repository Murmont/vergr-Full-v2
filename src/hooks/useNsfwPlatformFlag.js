// useNsfwPlatformFlag — reads `app_config/general.nsfwVisibleOnAndroid`.
//
// This is the switch that decides whether the Android / Play build may show
// adult content at all. It exists as a REMOTE flag rather than a build constant
// for one reason: if Google ever asks, the answer has to be "already done",
// not "we shipped a fix to the store and are waiting on review". Flipping this
// in the Firebase console takes seconds and reaches every installed copy.
//
// It is deliberately ONE-WAY-SAFE. The default, and the answer whenever the
// document has not loaded, has not been written, or the read failed, is FALSE.
// Adult content stays hidden on store builds unless somebody has explicitly
// turned it on. An outage or a typo can only ever make the app more
// conservative, never less.
//
// Same shape as useChatRelayFlag: a module-level cache seeded synchronously
// from localStorage, one shared snapshot listener, and subscribers notified on
// change. The sync seed matters here for the same reason it does there. The
// first feed frame renders before any Firestore read lands, and a first frame
// that guesses "allowed" would flash adult content on screen for a moment,
// which is the exact failure this whole system exists to prevent. Guessing
// "hidden" is invisible if wrong.

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';

const LS_KEY = 'vergr.nsfwVisibleOnAndroid';

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
        const next = snap.exists() ? snap.data()?.nsfwVisibleOnAndroid === true : false;
        if (next !== cached) {
          cached = next;
          writeLS(next);
          for (const cb of listeners) { try { cb(next); } catch { /* ignore */ } }
        }
      },
      () => { /* error → keep the last cached value, which defaults to false */ },
    );
  } catch { /* ignore */ }
}

export default function useNsfwPlatformFlag() {
  const [on, setOn] = useState(cached === true);
  useEffect(() => {
    ensureSubscription();
    if (cached !== null) setOn(cached);
    const cb = (v) => setOn(v);
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, []);
  return on;
}

/** The shape `viewerAllowsNsfw` / `platformAllowsNsfw` expect for `cfg`. */
export const nsfwCfgFrom = (flag) => ({ nsfwVisibleOnAndroid: flag === true });
