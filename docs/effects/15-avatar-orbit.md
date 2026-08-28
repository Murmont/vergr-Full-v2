# 15 — Avatar orbit

**STATUS: BUILT AND LIVE.** Rookie L6, `orbit` in `EFFECTS`.
Rules: [00-RULES.md](00-RULES.md)

This document is written AFTER the fact. The effect shipped without one, which is
why it appeared in the index as "BUILT AND LIVE, never documented" — a gap worth
closing, because the next person to touch the avatar needs the locked rule in §2.

---

## 1. Research — what makes this readable rather than noise

A static accent ring next to the LIVE ring is unreadable: same form, same place,
and the eye cannot tell which one is carrying information. Two rings competing is
worse than one ring plus nothing.

The resolution is a **behavioural** split, not a colour one:

| | Means | Chosen by |
|---|---|---|
| static stroke | STATE — live now, unseen status | the system |
| travelling light | IDENTITY — your accent | the user |

⚠ **This is a LOCKED rule** (CLAUDE.md): rank and cosmetics never touch the
avatar ring, because the ring belongs to live and status. The orbit is allowed
precisely because it is NOT a ring — it is a moving highlight that reads as a
different channel.

### Technique

A conic gradient rotated through a **registered `@property --vg-angle`**. The
registration is load-bearing: a plain custom property is a string, so the browser
cannot interpolate it and the rotation would snap between keyframes instead of
sweeping. With `@property` the angle is a typed value and animates smoothly.

Ring shape comes from **mask compositing**, not a border: a content-box mask is
XOR'd against a full-box mask, leaving a 1px band. That keeps the corner radius
inherited from the avatar for free, which a border cannot do on a non-circular
crop.

Sources: MDN `@property`, MDN `mask-composite`.

**Degradation is deliberate.** Without `@property` support the conic still
paints, it simply does not rotate — a static accent edge, not a broken one.

## 1.5 ⚠ IT WAS INVISIBLE TO EVERYONE EXCEPT ITS OWNER (fixed 2026-08-24)

Found by inventorying mount points while writing this document, not from a bug
report — which is the argument for writing the document at all.

`grep -rn 'AvatarOrbit' src` returned **one** file: `ProfileScreen.jsx`, your
OWN profile. `PublicProfileScreen` and `NativeProfileScreens` had no orbit at
all. So a cosmetic whose entire purpose is to be seen by other people was seen
by nobody, for its whole life.

**Two things were needed, and either alone still looks broken:**

1. the orbit has to RENDER on the visitor-facing screen, and
2. the accent tokens it reads have to EXIST there. `.vg-orbit` consumes
   `--vg-accent-faint` / `-dim` / `-bloom`, which only `themeTokens()` produces,
   and `PublicProfileScreen` never called it. A mounted orbit with no tokens
   draws an uncoloured ring.

⚠ **And the hook placement matters.** `useEffectEnabled` calls `useMemo`, so
putting it next to the accent (where it reads better) placed it AFTER
`if (loading) return <ProfileSkeleton/>`. It then ran on one render and not the
other, React threw **#310 "rendered more hooks than during the previous
render"**, and the whole screen went to ErrorBoundary. It now sits with the
other hooks at the top, and the Vanguard mask is applied at the USE site as a
plain boolean, because a mask must never gate a hook.

Verified as a DIFFERENT signed-in account, navigating through the app (squad →
member → profile) rather than by pasting a URL: orbit mounted, accent
`#f04060`, `animation-name: vg-orbit`, no crash.

`NativeProfileScreens` still has no orbit. That is the remaining gap.

## 2. Files

| File | Role |
|---|---|
| `src/components/effects/visual/AvatarOrbit.jsx` | the wrapper; renders children untouched when disabled |
| `src/styles/surface.css` `.vg-orbit` | the whole visual, `::after` + conic + mask |
| `src/utils/rankUnlocks.js` `EFFECTS` | WHEN you get it (level 6) |
| `src/components/effects/useEffectEnabled.js` | reads the OWNER's profile |
| `ProfileScreen.jsx`, `PublicProfileScreen.jsx`, `NativeProfileScreens.jsx` | the three mount points |

## 3. Cost

**Zero.** One CSS pseudo-element, GPU-composited, no JS per frame, no asset, no
read. The accent arrives via `--vg-accent`, already set on the profile root.

⚠ The accent comes from an **ancestor custom property, never a prop**. That is
what keeps the orbit and the name resolving to the same colour; a prop would be
a second source of truth. Since 2026-08-24 that token is produced by
`accentFor()`, which also honours a free-hex accent.

## 4. Timing

11s per revolution, deliberately slower than `.vg-beam`'s 7s on panels: this sits
on a face at the top of a profile, where 7s reads as agitated. `prefers-reduced-motion`
stops the animation and keeps the edge.

## 5. Verification

- The orbit colour equals the name accent on all three profile screens (one
  resolver, so this is a regression test for `accentFor`).
- With `prefers-reduced-motion`, `animation-name` is `none` and the ring is still
  painted.
- Disabled renders children with **no wrapper element at all** — assert the DOM
  has no `.vg-orbit` node rather than an invisible one.
- The LIVE ring is still visible and distinguishable while the orbit runs. This
  is the assertion that protects the locked rule.
