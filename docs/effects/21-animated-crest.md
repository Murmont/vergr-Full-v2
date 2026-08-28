# 21 — Animated crest in chat

**Ladder slot:** Veteran L2 = **L62**. Level only, no Pro half.
**Surface:** live stream chat, and only there.
**Status:** doc complete 2026-08-27.

---

## 1. What is already there

The crest is `src/components/RankBadge.jsx`: a `<img>` of
`getCurrentBadge(level).art`, 13px, with a static
`drop-shadow(0 0 4px <rankRing>66)`.

It has exactly **one** mount point in the whole app:

```
src/components/streams/ChatPanel.jsx:890
  <RankBadge level={vpLevel} size={13} style={{ marginRight: 4, verticalAlign: '-2px' }} />
```

⚠ **That is a feature, not a gap.** The locked rule in CLAUDE.md is that rank
shows in LIVE CHAT and the STREAM ENTRANCE RIBBON only, never on an avatar ring.
`RankBadge`'s own header records why: "painting one on every avatar in every list
made the whole app look permanently on fire." Do not widen this inventory.

---

## 2. Surface inventory (R8)

One component, five mounts, all of which come free because they all render the
same `<ChatPanel>`:

| # | Screen | Mount | Layout |
|---|---|---|---|
| 1 | `ViewerStreamScreen.jsx:1063` | side panel | `side` |
| 2 | `BroadcasterScreen.jsx:921` | over the video | `overlay` |
| 3 | `BroadcasterScreen.jsx:1098` | side panel | `side` |
| 4 | `MobileLiveViewer.jsx:791` | over the video | `overlay` |
| 5 | `MobileLiveViewer.jsx:1060` | sheet | `side` |
| 6 | `native/NativeBroadcasterScreen.jsx:440` | native | `overlay` |

⚠ Both `overlay` and `side` must be checked. `overlay` sits on top of live video,
so a white sheen there competes with whatever is on screen behind it, and the
row backgrounds differ (`rgba(0,0,0,0.38)` vs `transparent`).

**NOT in the inventory, deliberately:** DM threads, squad chat, comments,
profiles, followers lists. None of them render a crest today and the locked rule
says none of them should.

---

## 3. Research

### 3.1 Twitch does not allow animated chat badges at all

Twitch's own requirement for custom subscriber badges: **PNG, transparent
background, 25 KB maximum, animation not supported**
([Twitch badges guide](https://kudos.tv/blogs/stream-blog/twitch-badges-guide),
[badge types and how-to](https://alive-project.com/en/streamer-magazine/article/10863/)).
Hype Train conductor badges are temporary but still static.

That is the biggest live-chat product in the world having considered animated
badges and refused. It does **not** mean the effect cannot ship, but it does mean
the bar is "so restrained a chat reader would not call it noise", not "look what
it can do".

### 3.2 Where animation IS allowed, it ships as FRAMES OF ART

Discord's animated assets (emoji GIF, stickers APNG/Lottie, avatars and banners
GIF) are all authored art files, gated behind Nitro or boost level
([Discord asset sizes](https://www.imageresizers.net/discord-image-sizes)).

⚠ **THAT ROUTE IS CLOSED HERE AND THE REASON IS ON RECORD.** It would need 30 new
animated files, one per badge band. The founder cannot author art ("reaction packs
which i cant actually create myself") and has already rejected the existing static
badge art ("those look like shit", CLAUDE.md 2026-08-24). Effects 10 and 18 are
both parked on exactly this. **Effect 21 must therefore add motion WITHOUT new
art, or it is blocked on the same wall.**

### 3.3 Animated `filter` promotes a compositor layer for the animation's whole life

Chromium triggers the GPU filter path "for filters which are animated, only for
the duration of the animation", and every promoted layer costs GPU memory; the
documented failure mode is long lists whose GPU memory "grows without quickly
coming down"
([Chromium image filters](https://www.chromium.org/developers/design-documents/image-filters/),
[optimising CSS filter animations](https://cssmonster.com/optimizing-css-filter-animations-for-improved-performance-in-chrome/)).

An `infinite` animation never ends, so the layer never demotes. A pulsing
`drop-shadow` on every crest in a 100-row chat is therefore 100 permanent
layers, in the busiest surface in the app.

> **Ruling: the moving property is `transform` on a small pseudo-element.
> Nothing animates `filter`.**

---

## 4. The design: an intermittent specular sweep, masked to the crest

The "holo card" pattern — a narrow bright band crossing a shape, clipped to that
shape's own silhouette. It needs no art, because the art it clips to already
exists.

| Property | Value | Why |
|---|---|---|
| Band | ~38% of the crest, 20deg tilt | narrower reads as a glitch at 13px |
| Travel | `translateX(-130% → 130%)` | fully off both edges, so idle is truly invisible |
| Sweep | 900ms | slower reads as a wipe, faster as a flicker |
| Cycle | 5.6s | **the sweep is 16% of the cycle; 84% of the time nothing moves** |
| Phase | per-uid hash → negative `animation-delay` | two crests almost never sweep together |
| Clip | `mask-image: url(<crest art>)` | the light lands on the crest, never on a box around it |

The intermittency is the whole answer to the founder's standing question about
"multiple users who have unlocked it" (asked of the Golden Thread, and the reason
that one was rejected). With a 16% duty cycle and a per-user phase, three L62+
users in one chat collide for a fraction of a second, rarely.

### 4.1 Sheen colour: measured, not assumed

The name sweep shipped white-on-white at L100 and was invisible; that was found
by measurement, so this one was measured first. Mean luminance of opaque pixels
in the badge art:

| Art | Mean | Max |
|---|---|---|
| `rival21-23.webp` | 83.1 | 255 |
| `legend71-73.webp` | 56.3 | 255 |
| `veteran61-63.webp` | 49.4 | 255 |

All well under mid-grey, so **white reads on every rank**. No per-rank sheen
colour is needed and none is added.

### 4.2 Reduced motion leaves something behind, never nothing

There are TWO switches and they behave differently (CLAUDE.md): the media query,
and `html[data-reduced-motion="true"]` from Settings, which sets
`animation-duration: 0.001ms; iteration-count: 1` and therefore **fast-forwards
to the final keyframe** rather than stopping.

Final keyframe here is "band fully off the right edge" = invisible, which is the
correct resting pose and needs no special case. But invisible-and-nothing-else
would mean the reward disappears for that user, and the name-sweep precedent is
explicit: "drops to the STATIC gradient, never to plain text: the user earned
this, so it must still be visibly different, just not moving."

> So the unlock is TWO things: a **static** lift of the existing halo, always on,
> plus the **sweep**, which is the part motion settings kill.

---

## 5. The defect found while measuring this

**The badge art is 1024x1024 and averages 171 KB, to draw a 13-pixel icon.**

```
30 files, 5,124,234 bytes total, avg 170,807 bytes
veteran61-63.webp  1024x1024  125,932 bytes
```

A chat with eight distinct rank bands present downloads **~1.4 MB** and decodes
eight 1024x1024 surfaces (4 MB of RGBA each) to draw eight 13px icons.

⚠ **This effect makes it worse if left alone**, because `mask-image` on the same
URL is a second decode of the same 1024x1024 source per crest.

Fixed as part of this effect: `scripts/build-badge-sizes.mjs` emits a 64px
variant per badge (13px at 4x, covering 3x DPR phones) to `public/badges/sm/`.
`RankBadge` uses the small one; `RankCrest` on `/prestige` renders at 96px and
keeps the full-size art.

---

## 6. Implementation plan

1. `scripts/build-badge-sizes.mjs` → `public/badges/sm/*.webp` at 64px.
2. `badgeSystem.js`: `smallBadgeArt(art)` deriving the `sm/` path.
3. `surface.css`: `.vg-crest` (static lift) + `.vg-crest-sheen` (the band) +
   `@keyframes vgCrestSheen`. Reduced motion kills only the sheen.
4. `rankUnlocks.js`: `row(62, 'animated_crest', 'crest', ...)` and
   `ANIMATED_CREST_LEVEL = 62`.
5. `RankBadge.jsx`: takes `uid` for the phase hash, renders the sheen when
   `level >= ANIMATED_CREST_LEVEL`.
6. `ChatPanel.jsx`: pass `uid={m.uid}`.
7. `vp-mirror-check.mjs`: `REWARD_OWNERS['animated_crest']`, plus assertions for
   the level, the duty cycle, and the existence of every `sm/` file.

**No relay change.** `vpLevel` is already on every message (R9), and there is no
opt-out flag — see §7.

---

## 7. Decisions taken, with reasons

**No per-user opt-out.** It would need a new field on the relay's `UserProfile`
plus a settings row. The two reduced-motion switches already give any *reader*
who dislikes motion a global off, which is the right granularity; an owner
switch for "do not animate my own crest" is a control nobody asks for.

**Level only, no Pro.** Every other `crest_*` row is level-only, and Pro does not
advertise it. TTS is level-OR-Pro because the founder said so explicitly; nothing
was said here, so the ladder's own convention wins.

**Not registered in `EFFECTS`.** That registry drives `cosmetics.fx` opt-outs,
which chat cannot read per message without a Firestore read per sender (R9).

---

## 8. Verification

`node scripts/crest-preview.mjs --measure` — **24/24, duty cycle 0.125.**
Serves the real `surface.css` and the real art, drives headless Chrome over CDP,
and reads the framebuffer. `node scripts/crest-preview.mjs` serves it to look at.

- [x] sheen exists at L62, absent at L61, and L61 has no wrapper at all
- [x] the sweep runs and `effect.getTiming().duration` equals `CREST_CYCLE_MS`
- [x] duty cycle measured **0.125** (ceiling 0.20), sweep 700ms vs 900ms declared
- [x] four uids, four distinct negative `animation-delay`s, stable per uid
- [x] R1 in pixels: peak beside the crest **11.6**, control with the mask removed
      **73.4** — so the containment is real and the probe can see its absence
- [x] no hard edge at the clip boundary: step **0**, and **74.2** with the
      padding removed (negative-tested)
- [x] `overlay` and `side` layouts, plus a 64px blow-up, all rendered
- [x] reduced motion: sweep gone, static lift still present
- [x] every crest URL contains `/sm/`, and every decoded image is 64px, not 1024

`npm run check` is **1,844** assertions.

---

## 9. Three defects that a green run did not catch

All three passed every number being checked at the time. All three were found by
rendering the thing and looking at it.

**1. A hard grey square behind every living crest.** `overflow: hidden` on a
wrapper sized exactly to the icon cut the crest's own `drop-shadow(0 0 4px)` off
at the edge, and a soft glow with four hard edges is a filled rectangle. Every
probe read OUTSIDE the box; the damage was inside it. Fixed with
`--vg-crest-pad` plus a cancelling negative margin, so the paint box grows and
the layout box does not.

**2. A white cut-out of the badge sliding over the badge.** The gradient and the
mask were on one element, and a transform moves an element's mask with it. So
the thing travelling across the screen was a white copy of the crest silhouette.
Passed: animation running, duty cycle correct, mask applied, nothing escaping.
Fixed by putting the mask on a static parent and the moving band on
`::before` — a mask applies to the whole subtree, so the band is still clipped
to the crest's shape and the animated property is still `transform`.

**3. A grey sticker instead of light.** Semi-transparent white over dark art
averages to grey under normal blending, so the sheen occluded the crest rather
than lighting it. `.vg-bloom` in this same stylesheet already records the fix
("a semi-transparent blurred copy just averages with the backdrop and reads as
smudge") and it had not been applied here. Now `mix-blend-mode: screen`,
upgraded to `plus-lighter` where supported, at a peak of 0.26 rather than 0.85.

Also corrected along the way: the band's falloff was expressed in percentages,
which on a 13px box is ~1.5 real pixels of ramp, so the "soft" band had hard
edges. **R3 in another costume: a ramp expressed as a fraction of the box does
not survive a tiny box.** The gradient now spans the whole element.

⚠ And the tests were wrong three times, each time failing on correct code: rects
compared where pixels were meant (R1), an absolute corner threshold, then a
living-vs-plain corner comparison. The signature of a filled square is a **hard
edge at the boundary**, not brightness — a glow falls off smoothly across it.
Every probe here now carries a control run that proves it can see the fault it
exists to catch; the first R1 probe reported 255 in both runs because it was
reading the white username glyphs next to the crest.
