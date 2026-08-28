// AVATAR ORBIT — a light that travels the avatar's border, in the user's accent.
//
// ── WHY THIS IS NOT A RING ──────────────────────────────────────────
//
// A static accent ring is unreadable next to the LIVE ring, because they are
// the same form and the eye cannot tell which one is telling it something. The
// split is deliberate and locked:
//
//     static stroke    = STATE     (live, unseen status)   not yours to choose
//     travelling light = IDENTITY  (your accent)           yours
//
// Two different behaviours, so they never compete, and the status ring keeps
// meaning exactly one thing.
//
// The mechanism already existed as `.vg-orbit` in `src/styles/surface.css`,
// built during the theme work and measured off the founder's mockups. Themes
// are gone; this is the same treatment isolated into its own unlockable, which
// is what it should have been from the start.
//
// ── HOW IT WORKS ────────────────────────────────────────────────────
//
// A conic gradient rotated through a registered `@property --vg-angle` (so the
// browser can interpolate an angle, which it cannot do for a plain custom
// property), masked to a 1px ring by compositing a content-box mask against a
// full-box mask with `xor`. Without `@property` it degrades to a static accent
// edge rather than snapping between keyframes.
//
// 11s per revolution, not the 7s used by `.vg-beam` on panels: this sits on a
// face at the top of a profile, where 7s reads as agitated.

import '../../../styles/surface.css';

/**
 * Wraps any avatar. Renders its children untouched when disabled, so a caller
 * never needs to branch.
 *
 * The accent comes from `--vg-accent` on an ancestor (the profile root sets it
 * from the equipped cosmetic), NOT from a prop. That keeps one source of truth
 * for the accent and means this component never learns what a level is.
 *
 * @param {boolean} props.enabled  false renders children with no wrapper cost
 * @param {string}  props.className extra classes for the wrapper (sizing, radius)
 */
export default function AvatarOrbit({ enabled = true, className = '', children }) {
  if (!enabled) return children;
  return (
    <div className={`vg-orbit ${className}`}>
      {children}
    </div>
  );
}
