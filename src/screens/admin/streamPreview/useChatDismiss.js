// Dismissing the chat so the viewer can just watch.
//
// ⚠ THE GESTURE IS NOT THE SAME ON BOTH SURFACES, AND THAT IS DELIBERATE.
// Founder, 2026-09-01: swipe right in the native app, hold-for-menu in the
// browser — "most browsers if you swipe left to right it will open another
// browser tab etc". A left-to-right swipe at the screen edge is the browser's
// own back gesture on iOS Safari and Chrome Android, so binding chat dismissal
// to it means the viewer leaves the stream instead of hiding the chat. The app
// owns its gestures; the browser does not.
//
// Native  → swipe right (no browser gesture to collide with)
// Browser → long press (600ms), which no browser claims
import { useCallback, useRef } from 'react';

const SWIPE_PX = 60;      // far enough that a tap or a scroll is not a swipe
const HOLD_MS = 600;      // long enough not to fire on a tap

export default function useChatDismiss(onToggle, { native = false } = {}) {
  const start = useRef(null);
  const holdTimer = useRef(0);

  const clearHold = useCallback(() => {
    clearTimeout(holdTimer.current);
    holdTimer.current = 0;
  }, []);

  const onPointerDown = useCallback((e) => {
    start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    if (!native) {
      clearTimeout(holdTimer.current);
      holdTimer.current = setTimeout(() => { onToggle(); start.current = null; }, HOLD_MS);
    }
  }, [native, onToggle]);

  const onPointerUp = useCallback((e) => {
    clearHold();
    const s = start.current;
    start.current = null;
    if (!s || !native) return;
    const dx = e.clientX - s.x;
    const dy = Math.abs(e.clientY - s.y);
    // horizontal, rightward, and not a vertical scroll that drifted
    if (dx > SWIPE_PX && dy < Math.abs(dx)) onToggle();
  }, [native, onToggle, clearHold]);

  // A drag that turns into a scroll must not also count as a long press.
  const onPointerMove = useCallback((e) => {
    const s = start.current;
    if (!s || !holdTimer.current) return;
    if (Math.abs(e.clientX - s.x) > 10 || Math.abs(e.clientY - s.y) > 10) clearHold();
  }, [clearHold]);

  return {
    onPointerDown, onPointerUp, onPointerMove,
    onPointerCancel: clearHold, onPointerLeave: clearHold,
    // the browser's own long-press menu would fight ours
    onContextMenu: (e) => { if (!native) e.preventDefault(); },
  };
}
