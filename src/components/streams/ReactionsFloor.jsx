// ReactionsFloor — heart reactions floating up the right edge of the stream
// view (TikTok Live model: the ONLY reaction is a heart/like).
//
// This component renders the floating trail only — there is no on-screen
// reaction rail. Hearts are triggered by tapping the video / the heart
// button in the composer row; remote viewers' reactions also render here.
//
// Trigger source: `events` array of { id } — caller injects each new
// reaction. We render motion.span hearts that float up with random drift
// + fade. (Legacy callers may still pass emoji per event; it is ignored —
// hearts only, per founder mandate.)

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { prefersReducedMotion } from '../primitives/springs';

let nextId = 0;

export default function ReactionsFloor({
  events = [],            // [{ id, originX? }]
  position = 'right',     // 'right' | 'bottom' — float origin
}) {
  const [floats, setFloats] = useState([]);

  useEffect(() => {
    if (!events.length) return;
    const reduced = prefersReducedMotion();
    const fresh = events.map((e) => ({
      id: e.id ?? ++nextId,
      // Float drift parameters per particle.
      tx: reduced ? 0 : (Math.random() * 80 - 40),
      delay: reduced ? 0 : Math.random() * 0.05,
      scale: 0.85 + Math.random() * 0.5,
      originX: e.originX ?? null,
    }));
    setFloats((prev) => [...prev, ...fresh]);
    const t = setTimeout(() => {
      setFloats((prev) => prev.filter((f) => !fresh.find((x) => x.id === f.id)));
    }, 2400);
    return () => clearTimeout(t);
  }, [events]);

  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 6,
    }}>
      <AnimatePresence>
        {floats.map((f) => (
          <motion.span
            key={f.id}
            initial={{ opacity: 0.95, y: 0, x: 0, scale: 0.6 }}
            animate={{ opacity: 0, y: -220, x: f.tx, scale: f.scale }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2.2, ease: [0.16, 1, 0.3, 1], delay: f.delay }}
            style={{
              position: 'absolute',
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)',
              left: f.originX != null ? f.originX : (position === 'right' ? 'calc(100% - 44px)' : '50%'),
              fontSize: 26, transform: 'translateX(-50%)',
              filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))',
            }}
          >❤️</motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
