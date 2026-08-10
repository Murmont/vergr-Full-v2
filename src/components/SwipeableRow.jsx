// SwipeableRow — horizontal swipe wrapper for list rows (WhatsApp gestures):
// swipe RIGHT reveals one action (e.g. pin), swipe LEFT another (e.g.
// archive). Vertical scrolling stays native via touch-action: pan-y; the row
// only commits an action past the threshold, and the click that follows a
// swipe release is suppressed. Used by the web AND native inbox.
import { useState, useRef } from 'react';
import Icon from './Icon';

const SWIPE_THRESHOLD = 72;

export default function SwipeableRow({ onSwipeRight, onSwipeLeft, rightLabel, rightIcon, leftLabel, leftIcon, children }) {
  const [dx, setDx] = useState(0);
  const drag = useRef(null);
  const swiped = useRef(false); // suppress the click that follows a swipe release

  const onPointerDown = (e) => {
    drag.current = { x: e.clientX, y: e.clientY, active: false, captured: false };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const moveX = e.clientX - d.x;
    const moveY = e.clientY - d.y;
    if (!d.active) {
      // Only claim the gesture once it is clearly horizontal.
      if (Math.abs(moveX) > 12 && Math.abs(moveX) > Math.abs(moveY) * 1.4) {
        d.active = true;
        if (!d.captured) { try { e.currentTarget.setPointerCapture(e.pointerId); d.captured = true; } catch {/* ignore */} }
      } else if (Math.abs(moveY) > 12) {
        drag.current = null; // vertical scroll wins
        return;
      } else return;
    }
    setDx(Math.max(-120, Math.min(120, moveX)));
  };
  const finish = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.active) {
      swiped.current = true;
      setTimeout(() => { swiped.current = false; }, 150);
      if (dx >= SWIPE_THRESHOLD) onSwipeRight?.();
      else if (dx <= -SWIPE_THRESHOLD) onSwipeLeft?.();
    }
    setDx(0);
  };

  return (
    <div className="relative overflow-hidden" style={{ touchAction: 'pan-y' }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={finish} onPointerCancel={finish}
      onClickCapture={(e) => { if (swiped.current) { e.preventDefault(); e.stopPropagation(); } }}>
      {/* Action backplates */}
      <div className={`absolute inset-y-0 left-0 w-28 flex items-center pl-5 bg-brand-violet/80 transition-opacity ${dx > 8 ? 'opacity-100' : 'opacity-0'}`}>
        <div className="flex flex-col items-center gap-0.5 text-white">
          <Icon name={rightIcon} size={20} />
          <span className="text-[9px] font-bold uppercase tracking-wider">{rightLabel}</span>
        </div>
      </div>
      <div className={`absolute inset-y-0 right-0 w-28 flex items-center justify-end pr-5 bg-surface-2 transition-opacity ${dx < -8 ? 'opacity-100' : 'opacity-0'}`}>
        <div className="flex flex-col items-center gap-0.5 text-text-secondary">
          <Icon name={leftIcon} size={20} />
          <span className="text-[9px] font-bold uppercase tracking-wider">{leftLabel}</span>
        </div>
      </div>
      <div style={{ transform: `translateX(${dx}px)`, transition: drag.current?.active ? 'none' : 'transform 0.18s ease' }}
        className="relative bg-bg-dark">
        {children}
      </div>
    </div>
  );
}
