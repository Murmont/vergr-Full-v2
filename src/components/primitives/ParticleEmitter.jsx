// ParticleEmitter — generic small particle accent for "something good
// happened" moments (new tip arriving in chat, link-up confirmed, etc.).
// Tiny, tasteful — NOT a confetti cannon. Max ~10 particles per emit.
//
// Usage:
//   <ParticleEmitter trigger={n} color="#F0A500" shape="coin"/>
// Each tick of `trigger` spawns one fresh burst at component center.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { prefersReducedMotion } from './springs';

let id = 0;

const SHAPES = {
  coin: (
    <circle cx="6" cy="6" r="5" fill="currentColor"/>
  ),
  star: (
    <path d="M6 1 L7.5 4.5 L11 4.8 L8.4 7.2 L9.2 11 L6 9.2 L2.8 11 L3.6 7.2 L1 4.8 L4.5 4.5 Z" fill="currentColor"/>
  ),
  dot: (
    <circle cx="6" cy="6" r="3" fill="currentColor"/>
  ),
};

export default function ParticleEmitter({
  trigger = 0,
  color = '#F0A500',
  shape = 'coin',
  count = 8,
}) {
  const [particles, setParticles] = useState([]);

  useEffect(() => {
    if (trigger === 0) return;
    const reduced = prefersReducedMotion();
    const n = reduced ? 0 : count;
    if (n === 0) return;
    const fresh = Array.from({ length: n }).map(() => {
      const angle = Math.random() * Math.PI * 2;
      const dist = 26 + Math.random() * 22;
      return {
        id: ++id,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist - 14, // bias slightly upward
        rot: Math.random() * 360 - 180,
        scale: 0.7 + Math.random() * 0.5,
        delay: Math.random() * 0.08,
      };
    });
    setParticles((p) => [...p, ...fresh]);
    const t = setTimeout(() => {
      setParticles((p) => p.filter((q) => !fresh.find((f) => f.id === q.id)));
    }, 900);
    return () => clearTimeout(t);
  }, [trigger, count]);

  return (
    <div style={{
      position: 'absolute', left: '50%', top: '50%',
      pointerEvents: 'none', zIndex: 4,
    }}>
      <AnimatePresence>
        {particles.map((p) => (
          <motion.svg
            key={p.id}
            width="12" height="12" viewBox="0 0 12 12"
            initial={{ opacity: 1, x: 0, y: 0, scale: 0.2, rotate: 0 }}
            animate={{ opacity: 0, x: p.dx, y: p.dy, scale: p.scale, rotate: p.rot }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1], delay: p.delay }}
            style={{ position: 'absolute', left: -6, top: -6, color }}
          >
            {SHAPES[shape] || SHAPES.dot}
          </motion.svg>
        ))}
      </AnimatePresence>
    </div>
  );
}
