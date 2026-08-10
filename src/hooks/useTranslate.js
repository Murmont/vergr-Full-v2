// useTranslate — shared on-demand translation state for posts + chat.
//
// Returns everything a caller needs to render an X/Telegram-style translate
// control that REPLACES the text in place (not appended):
//   canTranslate  show the control at all (app-only + likely-foreign gate)
//   busy          request in flight
//   showing       currently displaying the translation (toggle state)
//   translated    the translated string (once fetched)
//   detected      detected source language code
//   upgrade       true if the surface is Lite/Pro-gated and the user is free
//   error         translation failed
//   toggle()      translate (or revert to original)
//
// The translation is fetched once and cached for the session; toggling after
// that just swaps display without re-calling the backend.

import { useState, useCallback } from 'react';
import { useUser } from '../context/UserContext';
import { translateContent } from '../firebase/firestore';
import { translateTarget, looksForeign } from '../utils/localePrefs';

export default function useTranslate(text, { kind = 'post', refId = null, knownLang = null } = {}) {
  const { profile } = useUser();
  const [busy, setBusy] = useState(false);
  const [showing, setShowing] = useState(false);
  const [translated, setTranslated] = useState(null);
  const [detected, setDetected] = useState(null);
  const [error, setError] = useState(false);
  const [upgrade, setUpgrade] = useState(false);

  const target = translateTarget(profile);
  // Show the translate control on every surface (native app AND web) whenever the
  // content is likely in a different language than the viewer's. (Previously gated
  // to the native app only; enabled on web too so the feature works everywhere.)
  const canTranslate = looksForeign(text, target, knownLang);

  const toggle = useCallback(async () => {
    if (showing) { setShowing(false); return; }       // revert to original
    if (translated) { setShowing(true); return; }      // cached
    setBusy(true); setError(false); setUpgrade(false);
    try {
      const r = await translateContent({ text: String(text), target, kind, refId, knownLang });
      setTranslated(r.translatedText);
      setDetected(r.detected || null);
      setShowing(true);
    } catch (e) {
      if (String(e?.message || '').includes('UPGRADE_REQUIRED')) setUpgrade(true);
      else setError(true);
    } finally {
      setBusy(false);
    }
  }, [showing, translated, text, target, kind, refId]);

  return { canTranslate, busy, showing, translated, detected, upgrade, error, target, toggle };
}
