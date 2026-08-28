# Effects — shared rules and build order

One document per effect, in this directory. Do not start an effect until its
own document is complete: research with cited sources, an exhaustive surface
inventory, an implementation plan, and a measurable verification step.

Architecture and the level→effect split: `src/components/effects/README.md`.

## The complete set

⚠ **This table is the scope. If an effect is not on it, it is not being built;
if it is on it without a doc, it is NOT ready to build.** The first version of
this index listed only 13 and silently dropped ten more from the founder's list
and the approved ladder — that is the same "discover it later" failure the
per-effect documents exist to prevent.

### Documented

| # | Effect | Ladder slot | Doc |
|---|---|---|---|
| 01 | `<UserName>` component | infrastructure | [01](01-username-component.md) ✅ SHIPPED |
| 02 | Ambilight | Contender L2 | [02](02-ambilight.md) built, reworked, ✅ LIVE |
| 03 | Animated name gradient | L63 `name_effect` | [03](03-name-gradient.md) ✅ SHIPPED |
| 04 | Name colour + font | L12 colour / L3 font | [04](04-name-colour-font.md) ✅ SHIPPED |
| 05 | Voice-note modulators | Champion L1 | [05](05-voice-modulators.md) |
| 06 | Custom typing indicator | Challenger L2 = **L32** | [06](06-typing-indicator.md) ✅ SHIPPED + DEPLOYED, live pass outstanding |
| 07 | Golden Thread | Legend L2 | [07](07-golden-thread.md) build LAST |
| 08 | Notification sounds | Veteran L1 | [08](08-notification-sounds.md) |
| 09 | Profile ambiance audio | Mythic L1 | [09](09-profile-ambiance.md) |
| 10 | Custom reaction packs | Elite L2 / Veteran L3 | [10](10-reaction-packs.md) |
| 11 | Squad environments | Champion L2 / Legend L3 | [11](11-squad-environments.md) |
| 12 | Chat bubble themes | Rival L3 / Mythic L2 | [12](12-bubble-themes.md) |
| 13 | TTS on stream | Ascendant L2 | [13](13-tts-on-stream.md) |

### NOT YET DOCUMENTED — do not build any of these

| # | Effect | Ladder slot | Note |
|---|---|---|---|
| 14 | Profile accent + gradient | Rookie L1 / L2 | **BUILT AND LIVE**, never documented. See [25](25-public-profile.md) — it does NOT work on the public profile |
| 15 | Avatar orbit | Rookie L6 | [15](15-avatar-orbit.md) ✅ documented; was invisible to visitors until 2026-08-24 |
| 16 | Animated profile banner | Contender L3 = **L13** | ✅ SHIPPED + DEPLOYED 2026-08-27. `canUseAnimatedBanner` + 8s/6MB cap + `ProfileBanner` on all four profile views |
| ~~17~~ | ~~Post-card accent~~ | ~~Rival L1~~ | ❌ **CUT 2026-08-27 by the founder.** Post authors already carry their name colour, gradient and typeface via `<UserName>`; a second accent on the same card would give a rainbow feed. See below. |
| 18 | Milestone badge ART | Elite L1 | system built, **art rejected by founder** |
| 19 | Profile signature flourish | Elite L3 | |
| 20 | Animated avatar | **L45** | ✅ SHIPPED + DEPLOYED 2026-08-27. `canUseAnimatedAvatar` (level OR Pro) in `uploadAvatar`. The table said "unplaced" for a day after it shipped — the row existed the whole time. |
| 21 | Animated crest in chat | Veteran L2 = **L62** | [21](21-animated-crest.md) ✅ SHIPPED + DEPLOYED |
| 22 | Accent presence | Ascendant L3 -> proposed **L94** | [22](22-accent-presence.md) ⚠ DOCUMENTED, NOT BUILT. The doc argues "app-wide" IS the deleted theme system and that the effect-17 cut extends to it, and proposes one-owner surfaces (= the live stream) instead. **Needs a founder answer on scope before any code.** |
| 23 | Animated entry ribbon | Immortal L2 | needs art |
| 24 | Top Supporter display | not an unlock | founder: creator-toggled, shows tips given |

### Awaiting a founder decision — proposed for cutting, not yet confirmed

| Effect | Why proposed for cutting |
|---|---|
| Ephemeral "bomb" messages | DMs are the dispute trail; a self-deleting message is a harassment vehicle with the evidence removed |
| IoT / smart-light takeover | third-party OAuth, remote control of a home, for ~0 users |
| Change username | identity operation with an index, impersonation and squatting risk — not a cosmetic |

---

## The rules — each one is a defect that shipped

### R1. A light layer must never reach outside its own box

`inset: -spread` means the glow covers whatever in-flow siblings sit above and
below it: the post text above a video, the link card below it. `isolation:
isolate` on the wrapper makes it worse — the wrapper then paints as one unit
above every PRECEDING sibling.

> Effect layers are `inset: 0`. The CALLER reserves the space.

### R2. The feather must be smaller than the padding it lives in

Measured on the rejected version: padding **44px**, feather
`inset 0 0 31px 35px` = **~66px** inward. 66 > 44, so the dark ring consumed the
padding band and lapped over the video — the "darkened border". The reference
uses 112px padding, ~2.5x its feather.

> `padding >= 2.5 x (blur + spread)`, or no feather at all.

### R3. Blur must scale with cell size, never be a constant

A 10x6 canvas across a 1060px box renders cells **~106px wide**. A fixed 28px
blur cannot blend them; the result is bilinear interpolation between 10 samples,
which reads as pixelation.

> `blur = (renderedWidth / cells) * 0.75`, from a `ResizeObserver`. Never
> hardcoded.

### R3b. An effect box must have the SAME SHAPE as its source

Anchor it to the media and expand uniformly. Stretching a 16:9 sample across a
tall post card destroys any resemblance to the picture and floods the card with
one colour — the most common way this effect is done badly, and it was shipped
once before being caught.

Containment then comes from a CLIP on an ancestor (`overflow: hidden` on the
card), not from padding. That satisfies R1 — the light never reaches a sibling —
without a padded box fighting the layout.

### R4. Downscale IS the effect, not an optimisation

10x6 for ambilight. At 32x18 the picture is still legible, so it reads as a
blurred photo rather than as light.

### R5. Filter at source scale, not on the result

`ctx.filter='blur(1px)'` before `drawImage` at 10px wide covers a tenth of the
image. The same 1px after upscaling covers nothing.

### R6. `z-index: -1` needs a stacking context or the effect vanishes silently

A negative-z child paints above its parent's background ONLY if that parent
forms a stacking context. `position: relative` + `z-index: auto` does not. The
profile ambilight measured as present in the DOM and was invisible on screen —
both true at once.

> Any wrapper holding a `z-index: -1` effect gets `isolation: isolate`.

### R7. Never touch the element being decorated

`crossOrigin` on the visible banner does not merely taint the canvas when CORS
is absent — the browser REFUSES THE IMAGE and the banner disappears.

> Effects read their own copy, or read nothing.

### R8. Inventory before implementing

Ambilight was "done" three times because each pass covered one more surface. The
surface list belongs in the effect's document BEFORE the first line of code.

### R9. Chat effects resolve from `vpLevel` and nothing else

The `vergr-chat` relay loads the sender's user doc **once per connection** and
puts `vpLevel` on every message (`infra/chat/src/main.go`). Anything needing a
second lookup per message is a per-message Firestore read at stream-chat volume.

---

## Build order

1. **`<UserName>` + migration + guard** (01) — unblocks 03 and 04.
2. **Ambilight rework** (02) — fixes what is live and wrong now.
3. Name gradient, colour, font (03, 04) — one file each once 01 lands.
4. ~~Typing indicator (06)~~ — DONE. ⚠ It was NOT "2 files": the doc had grepped
   for the component's own consumers instead of for surfaces that draw an
   indicator, and missed three that hand-roll their own. Six surfaces, and one
   of them had never rendered at all. Grep for the THING, not for the name of
   the component you expect to find.
5. Voice modulators (05) — decide the pitch question first.
6. Bubble themes (12), reactions (10), squad environments (11).
7. Notification sounds (08) — batches with the next APK.
8. **Golden Thread (07) — LAST.** The only one that can degrade the core
   product if it is wrong.

---

## Definition of done

No effect ships until all seven pass:

1. Does it reach outside its own box? (R1) — must be no
2. Is `padding >= 2.5 x feather`, or no feather? (R2)
3. Does every blur scale with its cell size? (R3)
4. Does its wrapper have `isolation: isolate`? (R6)
5. Does it modify the element it decorates? (R7) — must be no
6. Does it render nothing when disabled, and degrade under
   `prefers-reduced-motion`?
7. Has it been RENDERED and MEASURED — a numeric assertion, not a glance — on
   **every** surface in its inventory?


---

## Effect 17 (post-card accent): recommended for cutting, 2026-08-27

⚠ **IT IS LARGELY ALREADY SHIPPED, AND THE REST WOULD MAKE THE FEED WORSE.**

The author name on a post already renders through `<UserName context="feed">`,
and `UserName.jsx:137` sets
`cosmetic = !!level && !handle && !isVanguardPersona && context !== 'plain'`.
So a post author ALREADY carries their name colour, gradient and typeface on the
feed. A "post-card accent" would be a SECOND accent on the same card.

Looked at the live feed before concluding this. It is deliberately monochrome
and text-forward: white names, violet as the single accent (New Post, verified
ticks, Follow). Measured `distinctColors: 1` across 30 posts. Per-author card
tints would give a rainbow feed and read as badly off-brand.

⚠ **AND THERE IS NO NEUTRAL SURFACE LEFT TO ACCENT.** Colour on a post card is
already either IDENTITY (the name) or SEMANTIC — `AchievementContent` encodes
the achievement TYPE in colour (win gold, rank violet, record red;
`PostCard.jsx:342`). Repainting those with the author's accent would destroy
meaning, not personalise it.

Every comparable product does name-colour only: X, Discord and Twitch all colour
the NAME and never the message container.

**Recommendation:** cut it and release the Rival L1 slot. If a post-level accent
is still wanted it needs a specific surface named by the founder — not a
treatment invented to fill the row. Inventing one is exactly what produced the
rejected Golden Thread path the day before.
