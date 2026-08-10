// HeartBurst — emits N heart particles from a tap point with spring drift.
// Triggered by double-tap on a stream viewport (TikTok-style heart-react).
//
// Usage:
//   <HeartBurst trigger={burstCount} originX={x} originY={y}/>
// Each time `trigger` changes, a fresh burst spawns at (originX, originY).
//
// Reduced-motion: renders a single static heart that fades, no drift.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { prefersReducedMotion } from './springs';

let id = 0;

export default function HeartBurst({
  trigger = 0,
  originX = '50%',
  originY = '50%',
  color = '#ff3366',
  count = 6,
}) {
  const [bursts, setBursts] = useState([]);
  useEffect(() => {
    if (trigger === 0) return;
    const reduced = prefersReducedMotion();
    const n = reduced ? 1 : count;
    const next = Array.from({ length: n }).map(() => ({
      id: ++id,
      // Each heart drifts to a slightly different end point.
      dx: reduced ? 0 : (Math.random() * 80 - 40),
      dy: reduced ? -40 : -(80 + Math.random() * 80),
      rotate: reduced ? 0 : (Math.random() * 60 - 30),
      scale: 0.85 + Math.random() * 0.5,
      delay: reduced ? 0 : Math.random() * 0.08,
    }));
    setBursts((prev) => [...prev, ...next]);
    const t = setTimeout(() => {
      setBursts((prev) => prev.filter((b) => !next.find((n) => n.id === b.id)));
    }, 1400);
    return () => clearTimeout(t);
  }, [trigger, count]);

  return (
    <div style={{
      position: 'absolute', left: originX, top: originY,
      pointerEvents: 'none', zIndex: 5,
    }}>
      <AnimatePresence>
        {bursts.map((b) => (
          <motion.svg
            key={b.id}
            width="42" height="42" viewBox="0 0 24 24"
            initial={{ opacity: 1, x: 0, y: 0, scale: 0.4, rotate: 0 }}
            animate={{ opacity: 0, x: b.dx, y: b.dy, scale: b.scale, rotate: b.rotate }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: b.delay }}
            style={{ position: 'absolute', left: -21, top: -21 }}
          >
            <path
              d="M12 21s-7-4.35-9.5-9C1 8.5 3 5 6.5 5c2 0 3.4 1 5.5 3 2.1-2 3.5-3 5.5-3 3.5 0 5.5 3.5 4 7-2.5 4.65-9.5 9-9.5 9z"
              fill={color}
            />
          </motion.svg>
        ))}
      </AnimatePresence>
    </div>
  );
}
