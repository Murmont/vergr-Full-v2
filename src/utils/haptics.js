// Haptics util — wraps the Vibration API for mobile.
// No-op on desktop or if the user has reduced motion preference (we use the
// reduced-motion media query as a proxy for "this user doesn't want extra
// sensory feedback"). Patterns are short and intentionally subtle.

import { prefersReducedMotion } from '../components/primitives/springs';

// On native Android the Kotlin VergrHaptics bridge gives richer, tuned haptics
// (amplitude + waveform patterns) than navigator.vibrate; prefer it, and fall
// back to the Vibration API on the web / PWA.
function nativeHaptics() {
  return (typeof window !== 'undefined' && window.VergrHaptics?.impact) ? window.VergrHaptics : null;
}

function allowed() {
  // Reduced-motion is our proxy for "no extra sensory feedback".
  return !prefersReducedMotion();
}

// kind = native bridge tier; pattern = web navigator.vibrate fallback.
function fire(kind, pattern) {
  if (!allowed()) return;
  const nh = nativeHaptics();
  if (nh) { try { nh.impact(kind); return; } catch {} }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try { navigator.vibrate(pattern); } catch {}
  }
}

export const haptic = {
  /** Soft tap acknowledgement — used on button presses, toggles. */
  light:   () => fire('light', 8),
  /** Slightly stronger — used on confirmation, navigation. */
  medium:  () => fire('medium', 14),
  /** Strong — used on tip arrival (broadcaster), level-up, error. */
  strong:  () => fire('heavy', 24),
  /** Triple short — used on success (tip sent confirmation). */
  success: () => fire('success', [6, 40, 6, 40, 12]),
  /** Long-short-short — used on alert / important notification. */
  alert:   () => fire('warning', [22, 60, 8, 60, 8]),
  /** Cancel everything if a pattern is mid-flight (web only). */
  cancel:  () => { try { navigator.vibrate?.(0); } catch {} },
};
