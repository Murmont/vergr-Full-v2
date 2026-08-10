// Native boot splash handshake.
//
// On the Android shell the splash is a KOTLIN view (SplashController), not HTML:
// it is already on screen before the WebView paints anything, and it stays up
// until we call ready(). So the web layer's only job at boot is to say when it
// has genuinely painted.
//
// TIMING IS THE WHOLE POINT. Call this after a real committed frame, never on
// mount and never on a timer. Signalling early hands the screen back before
// there is anything to show, which is exactly the blank-frame bug the native
// splash exists to remove.

let signalled = false;

/**
 * Tell the native splash it can lift. Idempotent; a no-op on web/desktop, where
 * the bridge does not exist.
 */
export function signalAppPainted() {
  if (signalled) return;
  signalled = true;
  try { window.VergrSplash?.ready?.(); } catch { /* not the native shell */ }
}

/**
 * Wait for two animation frames, then signal. One rAF fires BEFORE the browser
 * paints the current commit; the second guarantees that commit has actually been
 * put on screen. A single rAF would hand back a frame too early.
 */
export function signalAppPaintedAfterFrame() {
  if (signalled) return;
  if (typeof requestAnimationFrame !== 'function') { signalAppPainted(); return; }
  requestAnimationFrame(() => requestAnimationFrame(() => signalAppPainted()));
}
