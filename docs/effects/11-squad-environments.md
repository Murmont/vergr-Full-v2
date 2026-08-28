# 11 — Immersive squad environments

**STATUS: SHIPPED + DEPLOYED + LIVE-VERIFIED ON TWO ACCOUNTS, 2026-08-26.**
`squad_environment` L52 (Champion LV2), `squad_weather` L73 (Legend LV3).
Rules: [00-RULES.md](00-RULES.md)

| File | Role |
|---|---|
| `src/utils/squadEnvironments.js` | the six environments, as DATA + `environmentBackdrop()` |
| `src/utils/squadWeather.js` | the particle engine, deliberately React-free |
| `src/components/effects/visual/SquadEnvironment.jsx` | thin React wrapper over that engine |
| `scripts/squad-environment-preview.mjs` | harness rendering THE SHIPPING ENGINE |
| `src/screens/squads/SquadChatThreadScreen.jsx` | reads it, mounts it |
| `src/styles/squad.css` | `isolation: isolate` on `.sqd .messages` — load-bearing |
| `src/components/BackgroundPickerModal.jsx` | the picker, third tab |
| `firestore.rules` | `envWriteOk()` + `myVpLevel()` |

### ✅ Verified live, measured not eyeballed

Set as @vergr (admin, resolves L100) on the Vanguard squad, read as @Verion (L1):

| §4 assertion | Result |
|---|---|
| Field does not scroll away | canvas top **identical at scrollTop 0, mid and bottom** |
| Covers the full scroller | `canvasTopOffset: 0` against `padding-top: 14px` |
| Weather actually renders | **0.93-1.01% lit pixels**, peak alpha 128 |
| Field is moving | lit count + alpha sum both change across 800ms |
| Loop stops when hidden | tab `hidden` froze it; flipping to `visible` restarted it |
| Two members see the SAME room | @Verion at **L1** sees Downpour ink `#070A0C`, grain layer, canvas, 0.932% lit |
| Rules gate accepts a legitimate write | `chatBackgroundWeather: true` persisted through the picker |

⚠ **NOT NEGATIVE-TESTED LIVE: the rules gate refusing an under-levelled setter.**
It is written and deployed, but proving it REFUSES needs an account that is a
squad admin AND below L52. @vergr is admin (resolves 100) and @Verion is not a
squad admin, so neither can exercise that path. Do not record this as verified.

⚠ **`isolation: isolate` ON `.sqd .messages` IS THE WHOLE FEATURE.** Without it
the `z-index:-1` canvas escapes to the root stacking context and paints BEHIND
the section's own background: the weather renders perfectly and is completely
invisible. It cost two rebuilds and two screenshots that looked like bare
gradients. Removing that one declaration silently disables every environment.

### Not done

- Overview / detail / members surfaces (§2 lists them; only the chat thread is wired)
- Native squad screens
- Tier 2 parallax (§1 leaves it conditional on measurement; not attempted)

---

## 1. Research — parallax without a scroll listener

Sources: [Chrome for Developers — Performant Parallaxing](https://developer.chrome.com/blog/performant-parallaxing),
[All in Perspective: Pure CSS Parallax](https://medium.com/@johnearle/all-in-perspective-2996ee463509)

### The CSS-only technique (Keith Clark, 2014)

```css
.scroller { perspective: 1px; overflow-y: auto; height: 100%; }
.layer-back  { transform: translateZ(-2px) scale(3); }
.layer-front { transform: translateZ(0); }
```

Elements at different `translateZ` scroll at different rates **automatically**,
handled inside the browser's own scroll machinery. No scroll event, no
`background-position` write, no JS on the critical path.

The cited advantage: "in ditching JS, it's nearly impossible to mess up
performance."

### ⚠ The trade-off that decides it here

The technique requires the **scroll container itself** to carry `perspective`,
and every child to sit in that 3D context. The `scale(3)` compensation is
needed because `translateZ(-2px)` shrinks the layer.

Squad chat is a **virtualised, bottom-anchored, dynamically-growing** scroller
(`SquadChatThreadScreen.jsx`, 1642 lines). Imposing a 3D perspective context on
it risks: stacking-context changes across every message row, blurry text on some
GPUs from fractional 3D transforms, and interference with scroll-to-bottom.

The sources acknowledge this: "two pure-CSS approaches exist, both with
tradeoffs significant enough that some developers prefer a small JS scroll
listener instead."

### Decision

**Tier 1 (Champion L2): a static full-bleed environment. No parallax.**
A fixed, non-scrolling backdrop behind the chat. Zero risk to the scroller,
delivers most of the visual value.

**Tier 2 (Legend L3): parallax, and ONLY IF** a `rAF`-throttled scroll listener
measures acceptable on the existing scroller. Do not impose `perspective` on the
chat scroll container. Measure before committing (§4).

### ⚠ Decision 2026-08-26: the backdrop is PROCEDURAL, and there is no art file

§3.2 below said "a single WebP". That was written as though an environment were
a picture, and it is not — §3.3 already describes the atmosphere layer, which is
the half that makes it a *place* rather than a wallpaper.

An environment is **three composed layers, none of which is a supplied asset**:

| Layer | What it is |
|---|---|
| Backdrop | a multi-stop CSS scene — sky, horizon, ground glow — not a flat fill |
| Atmosphere | the capped canvas particle system of §3.3 |
| Light | a colour cast on the chat surface, so the bubbles sit IN the room |

Generating it costs nothing and ships nothing: no WebP, no R2 object, no hosting
egress. The precedent is `scripts/build-chat-patterns.mjs`, which generated all
eight chat tiles procedurally rather than waiting on art.

⚠ **Motion models must be STRUCTURALLY different, not re-parameterised.** The
chat-pattern motions were rejected for exactly this: five "different" models that
were all ellipses because their frequency ratios sat near 1:1. Six models here,
and one of them (Void) deliberately has NO translation at all, which is the
control that proves the others are doing something.

### ⚠ Decision 2026-08-26: it reuses `chatBackground`, NOT a new field

§2 below proposes `squads/{id}.environment`. **`squads/{id}.chatBackground`
already exists**, is already squad-level, already has `color` and `image` kinds,
and is already written by `BackgroundPickerModal.jsx` via
`setSquadChatBackground()` and read by `SquadChatThreadScreen.jsx:793`.

A second field painting the same surface is the two-sources-of-truth bug that
killed `rankCollections.js` and that was found live on `PublicProfileScreen.jsx`
on 2026-08-26 (two accent resolvers, each painting half the page). So
`environment` becomes a THIRD KIND on the existing field, and precedence is
settled by construction because there is only one field to read.

## 2. Surfaces

| Surface | File |
|---|---|
| Squad chat thread | `src/screens/squads/SquadChatThreadScreen.jsx` (1642 lines) |
| Squad detail / overview | `src/screens/squads/SquadDetailScreen.jsx` |
| Squad members | `src/screens/squads/SquadMembersScreen.jsx` |
| Native squad screens | `src/screens/squads/native/` — verify with a grep at build time |

⚠ **Whose environment is it?** The unlock belongs to a user, but a squad is
shared. The environment must be a property of the **SQUAD**, applied by an owner
who has the unlock — not of whoever happens to be viewing. Otherwise two members
see different rooms and it stops being a shared space. Store on
`squads/{id}.environment`, gated on the setter's `vpLevel`.

⚠ **Legibility.** This puts arbitrary art behind chat text. See
[12-bubble-themes.md](12-bubble-themes.md) §1 for the contrast requirement —
the same 4.5:1 rule applies, and a translucent bubble over a bright environment
is the failure mode.

## 3. Implementation

1. `src/components/effects/visual/SquadEnvironment.jsx`, `inset: 0`,
   `z-index: -1`, `pointer-events: none`, inside a wrapper with
   `isolation: isolate` (R1, R6).
2. Tier 1: a single WebP, `object-fit: cover`, plus a scrim ensuring the message
   area retains contrast.
3. Weather / motion (tier 2): a lightweight canvas particle layer, NOT a DOM
   element per particle. Capped particle count, and stopped entirely when the
   tab is hidden (`visibilitychange`) — a particle loop running in a background
   tab is pure waste.
4. `prefers-reduced-motion`: static image, no particles.

## 4. Verification

- Frame time while scrolling squad chat, environment on vs off. A number.
- Assert scroll-to-bottom on new message still works with the environment
  mounted (the most likely regression).
- Contrast: sample the rendered message text against the environment behind it
  at several points and assert >= 4.5:1 everywhere (see doc 12).
- Assert the particle loop stops when the tab is hidden.
- Assert two different members viewing the same squad see the same environment.
