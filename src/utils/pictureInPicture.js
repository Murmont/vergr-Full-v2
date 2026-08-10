/**
 * Picture-in-Picture (native Android only).
 *
 * Bridges to the Kotlin `window.VergrPiP` interface (PiPBridge.kt). Lets a live
 * stream keep playing in a floating system window when the user leaves the app
 * (Home press), and offers an explicit "pop out" action. MainActivity fires
 * `vergr:pip-changed` when the PiP state flips so the viewer can hide its chrome
 * and show only the video.
 *
 * On web / desktop there is no Android PiP, so `isPipSupported()` is false and
 * callers simply do nothing.
 */

import { useEffect, useState } from 'react';
import { isAndroidApp } from './platform';

export function isPipSupported() {
  if (!isAndroidApp() || typeof window === 'undefined' || !window.VergrPiP) return false;
  try {
    return typeof window.VergrPiP.supported === 'function' ? !!window.VergrPiP.supported() : true;
  } catch {
    return true;
  }
}

/** Enter PiP immediately with a source aspect ratio (w:h). */
export function enterPip(w = 9, h = 16) {
  try { window.VergrPiP?.enter?.(Math.round(w) || 9, Math.round(h) || 16); } catch { /* ignore */ }
}

/** Arm/disarm auto-enter-on-Home while a stream is visible, with its aspect. */
export function setPipAutoEnter(on, w = 9, h = 16) {
  try { window.VergrPiP?.setAuto?.(!!on, Math.round(w) || 9, Math.round(h) || 16); } catch { /* ignore */ }
}

/**
 * Stream-viewer hook. Arms auto-PiP-on-Home for the lifetime of the component
 * (updating the window aspect as the real source aspect resolves) and returns
 * whether the app is currently IN a PiP window (so the viewer can strip chrome).
 */
export function useStreamPip(aspectW = 9, aspectH = 16) {
  const [pipActive, setPipActive] = useState(false);

  useEffect(() => {
    if (!isPipSupported()) return undefined;
    setPipAutoEnter(true, aspectW, aspectH);
    const onChange = (e) => setPipActive(!!e?.detail?.active);
    window.addEventListener('vergr:pip-changed', onChange);
    return () => {
      window.removeEventListener('vergr:pip-changed', onChange);
      setPipAutoEnter(false);
    };
  }, [aspectW, aspectH]);

  return pipActive;
}
