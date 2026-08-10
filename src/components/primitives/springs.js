// Spring tokens used across the streaming UI.
//
// Bias: physical-feel. Linear easings are banned (CLAUDE working notes).
// Every animation in streaming code should reference one of these. If a
// motion doesn't fit, add a token here rather than inventing inline values
// at the call site — keeps the entire app's motion language consistent.
//
// Usage:
//   import { motion } from 'framer-motion';
//   import { spring } from '@/components/primitives/springs';
//   <motion.div animate={{ y: 0 }} transition={spring.gentle}/>
//
// Reduced-motion: callers should check `prefersReducedMotion()` and pass
// `instant` instead of any spring when true.

export const spring = {
  /** Default for most UI transitions: 250-350ms, smooth, no overshoot. */
  gentle:    { type: 'spring', stiffness: 260, damping: 28, mass: 0.6 },
  /** Faster for taps + toggles. ~200ms, snaps in. */
  snappy:    { type: 'spring', stiffness: 420, damping: 32, mass: 0.5 },
  /** Bouncy: panel drops, drawer reveals. Slight overshoot. */
  bouncy:    { type: 'spring', stiffness: 380, damping: 22, mass: 0.7 },
  /** Celebrate: tip arrival, achievement. Pronounced overshoot. */
  celebrate: { type: 'spring', stiffness: 320, damping: 14, mass: 0.5 },
  /** Slow drift: ambient particles, gentle floats. */
  drift:     { type: 'spring', stiffness: 60,  damping: 18, mass: 1.0 },
};

/** Tween fallbacks when a spring isn't appropriate (e.g. continuous loops). */
export const ease = {
  out:    { duration: 0.24, ease: [0.16, 1, 0.3, 1] }, // expo-out
  inOut:  { duration: 0.32, ease: [0.65, 0, 0.35, 1] },
};

/** Instant transition for prefers-reduced-motion users. */
export const instant = { duration: 0 };

export function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Pick the right transition based on reduced-motion preference. */
export function motionOr(transition) {
  return prefersReducedMotion() ? instant : transition;
}
