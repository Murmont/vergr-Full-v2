import { MotionConfig } from 'framer-motion';
// Applies the user's Settings → Appearance preferences (font size, reduced
// motion, theme) to the document, app-wide. Mounted once inside UserProvider +
// UIProvider so it can read profile.settings and drive the theme. Renders null.
//
// - fontSize  -> scales the root font-size, so all rem-based (Tailwind) text resizes.
// - reducedMotion -> sets html[data-reduced-motion], consumed by index.css.
// - theme -> syncs the saved theme from the profile so it follows the user across
//   devices (UIContext otherwise only restores from localStorage).
import { useEffect, useRef } from 'react';
import { useUser } from '../context/UserContext';
import { useUI } from '../context/UIContext';

const FONT_SCALE = { small: '14px', medium: '16px', large: '18px' };

/**
 * ⚠⚠ FRAMER-MOTION RESPECTED NEITHER REDUCED-MOTION SWITCH. index.css claims
 * "framer-motion respects the same flag through usePrefersReducedMotion" — measured
 * 2026-09-03, that hook appears in the codebase EXACTLY ONCE, inside that comment. It is
 * used nowhere. Thirteen live-stream files animate with framer-motion and none of them
 * honoured either switch:
 *
 *   - the APP toggle sets `html[data-reduced-motion]`, and the CSS rule behind it caps
 *     `animation-duration`, which only touches CSS animations. Framer-motion animates by
 *     writing inline styles from rAF, so the rule never reaches it.
 *   - the OS `prefers-reduced-motion` query was answered in CSS in nine places and by
 *     three components in JS — and by no motion component at all.
 *
 * `MotionConfig` is the supported way to do this globally. `"always"` when the user has
 * asked us directly; otherwise `"user"`, which follows the OS. Wrapping is what makes it
 * apply to every `motion.*` in the tree, so no component has to remember.
 */
export function MotionPrefs({ children }) {
  const { profile } = useUser();
  return (
    <MotionConfig reducedMotion={profile?.settings?.reducedMotion ? 'always' : 'user'}>
      {children}
    </MotionConfig>
  );
}

export default function DisplaySettingsApplier() {
  const { profile } = useUser();
  const { theme, setTheme } = useUI();
  const settings = profile?.settings;
  const lastTheme = useRef(null);

  // Font size
  useEffect(() => {
    const size = FONT_SCALE[settings?.fontSize] || FONT_SCALE.medium;
    document.documentElement.style.fontSize = size;
    return () => { document.documentElement.style.fontSize = ''; };
  }, [settings?.fontSize]);

  // Reduced motion
  useEffect(() => {
    const root = document.documentElement;
    if (settings?.reducedMotion) root.setAttribute('data-reduced-motion', 'true');
    else root.removeAttribute('data-reduced-motion');
  }, [settings?.reducedMotion]);

  // Theme sync (profile -> UI). Apply only when the stored theme actually
  // changes, so a local toggle isn't immediately overwritten by a stale read.
  useEffect(() => {
    const saved = settings?.theme;
    if (!saved || saved === lastTheme.current) return;
    lastTheme.current = saved;
    if (saved !== theme) setTheme(saved);
  }, [settings?.theme, theme, setTheme]);

  return null;
}
