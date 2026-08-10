// useHeaderCollapse — profile header parallax + docked mini-header (B8.1).
// Attach bannerRef to the banner's INNER content wrapper (parent must be
// overflow-hidden). On scroll the banner parallaxes down + scales + blurs
// (transform/opacity/filter only — no layout thrash), and `docked` flips true
// past the threshold so the screen can fade in a fixed mini-header with the
// user's name. Listens on window; if a layout scrolls a container instead,
// this is a graceful no-op.

import { useEffect, useRef, useState } from 'react';

export default function useHeaderCollapse({ dockAt = 190 } = {}) {
  const bannerRef = useRef(null);
  const [docked, setDocked] = useState(false);

  useEffect(() => {
    let raf = 0;
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = Math.max(0, window.scrollY || 0);
        const el = bannerRef.current;
        if (el && !reduced) {
          if (y > 0) {
            const scale = Math.min(1 + y / 900, 1.12);
            el.style.transform = `translateY(${(y * 0.42).toFixed(1)}px) scale(${scale.toFixed(3)})`;
            el.style.filter = y > 50 ? `blur(${Math.min((y - 50) / 28, 7).toFixed(1)}px)` : '';
          } else {
            el.style.transform = '';
            el.style.filter = '';
          }
        }
        setDocked(y > dockAt);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [dockAt]);

  return { bannerRef, docked };
}
