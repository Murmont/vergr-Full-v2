// RollingNumber — animates a number change with momentum.
// Never snaps. Used for viewer count, tip totals, follower count, earnings.
//
// Strategy: spring-driven motion value that walks from old to new; we round
// each frame to the nearest int and render. For very small deltas (1-2),
// the spring is barely perceptible — still feels alive without being noisy.
//
// Reduced-motion: snaps directly to the new value.

import { useEffect, useRef } from 'react';
import { motionValue, useSpring, useMotionValueEvent } from 'framer-motion';
import { prefersReducedMotion } from './springs';

export default function RollingNumber({
  value,
  format = (n) => n.toLocaleString(),
  className = '',
  style,
  stiffness = 90,
  damping = 22,
}) {
  const ref = useRef(null);
  const mv = useRef(motionValue(typeof value === 'number' ? value : 0)).current;
  const spring = useSpring(mv, {
    stiffness, damping, mass: 1,
    // Snap directly for reduced-motion users.
    restDelta: 0.5,
  });

  useEffect(() => {
    if (typeof value !== 'number' || Number.isNaN(value)) return;
    if (prefersReducedMotion()) {
      mv.set(value);
      spring.jump(value);
      if (ref.current) ref.current.textContent = format(value);
      return;
    }
    mv.set(value);
  }, [value, mv, spring, format]);

  useMotionValueEvent(spring, 'change', (latest) => {
    if (ref.current) {
      ref.current.textContent = format(Math.round(latest));
    }
  });

  // Initial render before the effect runs.
  return (
    <span ref={ref} className={className} style={style}>
      {format(typeof value === 'number' ? value : 0)}
    </span>
  );
}
