# 03 — Animated name gradient

**STATUS: SHIPPED + DEPLOYED 2026-08-24.** Three user-chosen colours, a real
colour picker, and a loop that is seamless by arithmetic. Verified on the live
`@vergr` account by measurement and by pixel comparison, not by inspection.

Rules: [00-RULES.md](00-RULES.md)

---

## 0. WHAT SHIPPED, AND THE FOUR THINGS THAT WERE WRONG FIRST

| | |
|---|---|
| Where it lives | `.vg-name-sweep` in `src/styles/surface.css`, applied ONLY by `<UserName>` |
| Colours | `users/{uid}.cosmetics.nameGradient = { a, b, c }`, free hex |
| Picker | `src/components/prestige/ColorPicker.jsx` (SV field + hue slider + hex input + presets) |
| Resolver | `nameGradientFor()` in `rankUnlocks.js` — the ONLY place colours resolve |
| Unlock | L63 `name_effect`, unchanged |
| Surfaces | every surface `<UserName>` renders on |

### 0.1 The loop glitched, and it was arithmetic, not easing

The original was `background-size: 220%` animated `220% → -20%`: a **240%
journey across a 220% image**. That is not a whole number of periods, so every
cycle snapped to a new phase. No timing function can hide that.

The rule: **translate by exactly one period of a periodic image.**

- image is `200%` wide and holds **two** identical A→B→C→A cycles ⇒ one period
  is exactly one element width
- it starts and ends on A, so the default `repeat` tiling has no seam
- `background-position: 0% → 100%` moves by `(element − image)` = one element
  width = exactly one period

⚠ The gradient is **`90deg`, deliberately**. An angled gradient has a vertical
component, so a horizontal translation would not land on the same pixels and the
seam returns. A tilt is worth less than a clean loop.

**Proved, not asserted:** paused via `getAnimations()`, computed
`background-position` at t=0 and the final keyframe both render identically, and
a zoomed screenshot at `0%` and at `100%` is pixel-identical.

### 0.2 Two colours could not read on a short name

`from 0%, to 45%, from 90%` at 220% meant the element showed ~45% of the ramp,
so a name picked as Ember→Mint rendered almost entirely Ember with a thin mint
glint. Two full cycles of three stops fixes it: measured on a 5-character name at
22px, which is the worst case.

### 0.3 The user picks the colours

Founder: *"users should be allowed to choose the colours for their gradient, it
is after all their achievement and not our choice"*, then *"forcing the user to
select from swatches is bad UX."* So the **unlock** is earned; the **colours**
are free hex, and the accents survive as presets inside the picker.

⚠ **Every value is hex-validated before it reaches CSS**, in `isHexColor()` and
again in `firestore.rules` (`hexOrAbsent`). These strings are interpolated into
a `linear-gradient()` through a custom property, which can carry arbitrary
tokens, so an unvalidated value would rewrite the gradient rather than colour it.
The picker is not the boundary.

### 0.4 Two defects found only by driving the real UI

- **Writing one stop did nothing.** `nameGradientFor()` requires all three, so
  the input showed the new colour while the preview ignored it. The picker now
  always persists a complete triple seeded from what is on screen.
- **`cosmetics.nameEffect` was inert.** The Prestige toggle had existed for a
  while and NOTHING read it — not the old inline ChatPanel version, not the first
  pass of `<UserName>`. Now read as an opt-out (undefined = on), so no one loses
  an effect they already had.

---

## 1.5 ⚠ WHAT THIS DOCUMENT GOT WRONG (verified against source 2026-08-24)

This document was written before `<UserName>` existed and assumed the effect was
new. It is not. Checking the source first, per the standing rule that a claim
this file makes must be verified on disk before anything is architected around it:

### 1. THE EFFECT ALREADY EXISTS AND IS LIVE

`src/components/streams/ChatPanel.jsx:634` and `:732`. An inline gradient sweep,
chat only, with `WebkitBackgroundClip` already correct. **It must be MOVED into
`<UserName>`, never rebuilt** — a second implementation is precisely the failure
`src/components/effects/README.md` was written to stop.

### 2. THE UNLOCK LEVEL IS 63, NOT 22 — AND THAT IS A FOUNDER DECISION

| | Says |
|---|---|
| This doc + `00-RULES.md` | Rival LV2, i.e. **level 22** |
| Live code + the levels screen | `RANK_UNLOCKS` row `name_effect`, **level 63** |

There are **two parallel unlock systems in `rankUnlocks.js`**, and this effect
sits in the older one:

- `RANK_UNLOCKS` + `isUnlocked(id, level)` — the flat 100-level ladder the
  levels screen renders. Holds `chatcolor` (L3), `name_effect` (L63),
  `name_glow` (L100).
- `EFFECTS` + `isEffectOn(id, profile)` — the newer registry with per-user
  opt-outs. Holds only `orbit` (L6) and `ambilight` (L21).

Moving it to level 22 would **grant a reward to everyone between L22 and L63 who
has not earned it**, and would leave the levels screen still promising the same
thing at L63. That is the same retroactive-grant hazard as `PUBLIC_LAUNCH_MS`.
**Do not move the level without the founder saying so.** Unifying the
implementation does not require moving it, so that work proceeds at L63.

### 3. `vpLevel` IS NOT FREE ON EVERY SURFACE — SO §3's LIST IS WRONG

This is the constraint that decides the real scope, and the original §3 ("every
MUST row in 01 §3.1") ignored it.

| Surface | `vpLevel` available? | Cost |
|---|---|---|
| Live chat | ✅ relay stamps it per message (`ChatPanel.jsx:375`) | zero |
| Profiles (own / public / native) | ✅ the full `users/{uid}` doc is loaded | zero |
| Follow list, search results, member lists | ✅ real user docs | zero |
| **Feed post cards + comments** | ❌ **NO** | **a read per author** |

A post's denormalised author is
`{ id, displayName, username, avatar, isVerified, tier }`
(`CreateComposer.jsx:989`). **There is no `vpLevel` on it.** So the feed either
costs a read per author, which breaks the zero-cost rule this whole ladder is
built on, or it silently does nothing there.

⚠ Adding `vpLevel` to that snapshot is free at write time but **goes stale**: the
post would show the level you held when you posted, so levelling up would not
light your old posts. That is a founder call, not a default. Until it is made,
**the feed is OUT OF SCOPE for this effect** and the doc must not pretend
otherwise.

## 1. Research

Sources: [web.dev — Speedy CSS Tip: Animated Gradient Text](https://web.dev/articles/speedy-css-tip-animated-gradient-text),
[ElevenLabs UI — Shimmering Text](https://ui.elevenlabs.io/docs/components/shimmering-text)

Pure CSS. No JavaScript, no canvas, no per-message work.

```css
.vg-name-anim{
  background-image: linear-gradient(90deg, var(--a), var(--b), var(--a));
  background-size: 200% 100%;
  -webkit-background-clip: text;
          background-clip: text;
  color: transparent;
  animation: vg-name-sweep 3s linear infinite;
}
@keyframes vg-name-sweep { to { background-position: -200% 0; } }
```

### The three findings that matter

1. ⚠ **`-webkit-background-clip` is STILL required in 2026** (Safari and older
   Chrome). Omitting it does not degrade to un-animated text — it renders
   **invisible text**, because `color: transparent` still applies. This would
   erase every username on affected browsers.

2. ⚠ **Animating `background-position` in percentages is jerky.** Percentages
   cannot be interpolated with sub-pixel precision. The smooth technique
   animates a **registered `@property`** — which is exactly the mechanism
   `.vg-beam` and `.vg-orbit` already use in `src/styles/surface.css` via
   `--vg-angle`. **Reuse that registration. Do not add a second one.**

3. Animating only `background-position` / `background-size` stays on the
   compositor thread. Anything that triggers layout does not.

### Restraint is a requirement, not taste

The cited guidance: animated text gradients work when motion stays restrained
and contrast stays high. This renders on names in a fast-scrolling live chat, so
an aggressive sweep is a legibility failure, not a style choice.

`prefers-reduced-motion` must drop to the static gradient — not to plain text,
which would remove the unlock the user earned.

## 2. Cost

**Zero.** Resolves from `vpLevel`, which the relay already places on every
message (`infra/chat/src/main.go`, R9). No read, no lookup, no relay change.

## 3. Surfaces — CORRECTED (see §1.5.3)

**IN, because `vpLevel` costs nothing there:**

| Surface | Where the level comes from |
|---|---|
| Live stream chat | `m.vpLevel`, stamped by the relay per message |
| Own profile | the loaded `users/{uid}` doc |
| Public profile (web + native) | the loaded `users/{uid}` doc |
| Follow list, search results, squad members, user picker | real user docs |

**OUT, and this is deliberate:** the feed and comments. Their author is a
denormalised snapshot with no `vpLevel`, so including them would cost a read per
author. Blocked on a founder decision, not on effort.

**OUT permanently**, per 01 §3.2: `src/screens/admin/**`, onboarding, auth,
settings, marketing, and any Vanguard-masked persona.

The effect is one branch inside `<UserName>`. It must never be applied at a call
site — that is what produced the duplicate this work removes.

## 4. Implementation — a MOVE, not a build

1. `.vg-name-sweep` in `src/styles/surface.css`, carrying exactly what
   `ChatPanel.jsx:732` renders inline today, so nothing changes visually.
2. `<UserName>` applies it when `isUnlocked('name_effect', level)` and a level
   is actually available. **No level ⇒ no effect, silently** — that is what
   keeps the feed free rather than broken.
3. `ChatPanel` passes `user={{ displayName: m.name, vpLevel: m.vpLevel }}` and
   **drops its inline block**. Its parent span keeps the flat-colour branch,
   which is a different unlock (`chatcolor`, L3).
4. The level stays **63** until the founder rules otherwise (§1.5.2).

**Compose order inside `<UserName>`:** mask → colour → gradient. The gradient
REPLACES the flat colour; the two never stack.

⚠ The mask wins over both. A Vanguard persona gets no colour and no sweep.

## 5. Verification

- Assert the computed style has BOTH `-webkit-background-clip: text` and
  `background-clip: text`. A missing prefix is an invisible-name bug, so this is
  the single most important assertion in this document.
- Assert `color` computes to `transparent` only when the gradient is active.
- Under `prefers-reduced-motion`, assert `animation-name` is `none` and the
  gradient still paints.
- Measure a name's rendered width with and without the effect: it must not
  change (a layout shift means the technique is wrong).
- Check on all four chat surfaces, both profiles, and the entry ribbon.
