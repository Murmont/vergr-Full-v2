/**
 * Keep the screen awake (Android shell) via the Kotlin VergrWake bridge, so the
 * display doesn't dim while watching a live stream, broadcasting, or on a call.
 * No-op on web/desktop (bridge absent).
 */
import { useEffect } from 'react';

export function setKeepAwake(on) {
  try {
    if (typeof window !== 'undefined' && window.VergrWake?.keepAwake) {
      window.VergrWake.keepAwake(!!on);
    }
  } catch { /* ignore */ }
}

/** Keep the screen awake while `active` and this component is mounted. */
export function useKeepAwake(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    setKeepAwake(true);
    return () => setKeepAwake(false);
  }, [active]);
}
