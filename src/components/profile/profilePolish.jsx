// Profile polish shared bits (10-doc B8):
//  - bannerGradient(uid): deterministic on-brand gradient for bannerless
//    profiles so no profile ever looks broken (B8.4).
//  - CountUpNumber: stats count up on load, tabular-nums (B8.3).
//  - MiniDockHeader: fixed top bar that fades in when the profile header
//    collapses past the threshold (B8.1, pairs with useHeaderCollapse).

import { useEffect, useRef, useState } from 'react';
import CachedImg from '../CachedImg';
import Icon from '../Icon';
import UserName from '../UserName';

// Deterministic per-uid banner gradient. Hues constrained to the brand family
// (violet → blue → pink range, never cyan/green) so every fallback stays
// on-brand while still feeling personal.
export function bannerGradient(uid) {
  let h = 0;
  for (let i = 0; i < (uid || '').length; i++) h = ((h << 5) - h + uid.charCodeAt(i)) | 0;
  const a = 250 + (Math.abs(h) % 70);        // 250–319: violet→pink
  const b = 215 + (Math.abs(h >> 4) % 45);   // 215–259: blue→violet
  const angle = 115 + (Math.abs(h >> 8) % 50);
  return `linear-gradient(${angle}deg, hsl(${b} 65% 12%) 0%, hsl(${a} 70% 22%) 45%, hsl(${a} 75% 14%) 100%), radial-gradient(ellipse at 70% 40%, hsl(${a} 80% 30% / 0.45) 0%, transparent 60%)`;
}

// Counts 0 → value over ~650ms on first sight, then snaps to live updates.
// `format` receives the intermediate integer (e.g. formatCount).
export function CountUpNumber({ value = 0, format = (n) => n.toLocaleString(), className = '', style }) {
  const [shown, setShown] = useState(0);
  const doneRef = useRef(false);
  useEffect(() => {
    if (doneRef.current) { setShown(value); return; }
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !value) { doneRef.current = true; setShown(value); return; }
    let raf = 0;
    const t0 = performance.now();
    const DUR = 650;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / DUR);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(value * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else doneRef.current = true;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={`tabular-nums ${className}`} style={style}>{format(shown)}</span>;
}

// Fixed mini-header shown once the big header scrolls away. transform/opacity
// only; pointer-events disabled while hidden so it never blocks taps.
// `user` carries the identity so the docked name gets the same cosmetics as the
// big header. `name` stays a STRING and is still required: it seeds the initial
// letter of the fallback avatar, which needs a character, not an element.
export function MiniDockHeader({ show, avatar, name, user, onBack }) {
  return (
    <div
      className="fixed top-0 left-0 right-0 z-40 flex items-center gap-3 px-3 h-12 transition-all duration-200"
      style={{
        background: 'rgba(11,11,20,0.88)', backdropFilter: 'blur(14px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        opacity: show ? 1 : 0,
        transform: show ? 'translateY(0)' : 'translateY(-100%)',
        pointerEvents: show ? 'auto' : 'none',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      {onBack && (
        <button onClick={onBack} className="w-8 h-8 flex items-center justify-center rounded-full text-white shrink-0">
          <Icon name="arrow_back" size={18} />
        </button>
      )}
      {avatar
        ? <CachedImg src={avatar} permanent alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
        : <span className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[12px] font-black text-white" style={{ background: 'linear-gradient(135deg,#7b1fff,#3b82f6)' }}>{(name?.[0] || 'V').toUpperCase()}</span>}
      <span className="text-[14px] font-extrabold text-white truncate">
        {user ? <UserName user={user} masked context="profile" fallback={name} /> : name}
      </span>
    </div>
  );
}
