# 12 — Chat themes (was: bubble themes)

**STATUS: SHIPPED + DEPLOYED 2026-08-25. 8 themes, 5 motions, themed bubbles.**
**Verified live on two accounts. See §9 and §10 for what shipped and what was corrected.**
Rival LV3 (presets), Mythic LV2 (builder). Rules: [00-RULES.md](00-RULES.md)

---

## 0. Telegram chat themes — how they ACTUALLY work

Founder instruction, 2026-08-25: *"first please research how telegram chat
themes work so we can copy them"*. Everything in this section is read from
Telegram's own open-source client or its own blog, not from impressions of the
app. File paths and constants are quoted so the next session can re-check them.

### 0.1 What a chat theme IS

Source: [Telegram — Chat Themes](https://telegram.org/blog/chat-themes-interactive-emoji-read-receipts/)

- **8 preset themes**, each carrying three things together: **gradient message
  bubbles**, an **animated background**, and an optional **pattern**.
- Each theme ships a **day and a night version**, switched by the device
  setting, not chosen separately.
- **It is per CHAT and it applies to BOTH people.** Either participant can set
  it and the other one sees it. Private chats only, not groups.
- Set from the chat header menu ("Change Colors").

### 0.2 The animated gradient, exactly

Source: [Telegram — Animated Backgrounds](https://telegram.org/blog/animated-backgrounds/) for the
behaviour; the algorithm below is read from the client source:
`TMessagesProj/jni/image.cpp` → `Java_org_telegram_messenger_Utilities_generateGradient`,
and `TMessagesProj/src/main/java/org/telegram/ui/Components/MotionBackgroundDrawable.java`.

**It is not a CSS gradient and it is not a video. It is a ~4,800-pixel bitmap
recomputed per frame and scaled up.**

| Property | Value, from source |
|---|---|
| Bitmap size | **60 x 80** (80x80 in square mode), `ARGB_8888`, drawn with `FILTER_BITMAP_FLAG` so the upscale is bilinear |
| Colours | **3 or 4**. Default palette `0xff426D57, 0xffF7E48B, 0xff87A284, 0xffFDF6CA` |
| Positions | **8 fixed points** on the unit square: `(.80,.10) (.60,.20) (.35,.25) (.25,.60) (.20,.90) (.40,.80) (.65,.75) (.75,.40)` |
| Which 4 are live | `gatherPositions`: `pos = phase + i*2 (mod 8)`, and **y is flipped** (`1 - y`). Stride 2, so the four colours always sit at alternating slots |
| Animation | Advancing `phase` by 1 moves every colour to the next slot. Positions are LERPed from the previous phase to the current one by `progress` 0→1 |
| Duration | `dt / 500ms` normally, `dt / 300ms` fast, eased by `CubicBezierInterpolator(0.33, 0, 0, 1)` |
| Trigger | one phase step **per message sent**. `phase` cycles 0..7 |
| Caching | `ANIMATION_CACHE_BITMAPS_COUNT = 3` |

**The per-pixel colour is inverse-distance weighting with a cutoff and a 4th
power** (this is the part that makes it look like light rather than a blur):

```c
d = max(0, 0.9 - hypot(px - cx, py - cy));   // 0.9 = radius cutoff
w = d * d * d * d;                            // sharp falloff
colour = SUM(w_i * colour_i) / SUM(w_i);
```

**And every pixel is SWIRLED before it is weighted**, which is why the blobs
curve instead of reading as four radial gradients:

```c
centerDistance = hypot(x - .5, y - .5);
swirl = 0.35 * centerDistance;
theta = swirl * swirl * 0.8 * 8.0;            // 6.4 * (0.35d)^2
// rotate (x-.5, y-.5) by theta about the centre, clamp to [0,1]
```

The swirl depends only on the pixel, not on phase or colour, so Telegram caches
it (`pixelCache`) and recomputes only the weighting each frame.

⚠ **The tiny bitmap IS the technique, exactly as with the ambilight
([02](02-ambilight.md) R4).** A widely-cited write-up of the Telegram contest
notes the naive full-resolution version is ~171,000 pixels per frame on an
iPhone 11 and cannot hold 60fps. At 60x80 it is 4,800, i.e. **36x less work**,
and the upscale does the smoothing for free. Do not "improve" the resolution.

### 0.3 The bubble gradient is anchored to the THREAD, not the bubble

Read from `TMessagesProj/src/main/java/org/telegram/ui/ActionBar/MessageDrawable.java`:

```java
gradientShader = new LinearGradient(0, blurredViewTopOffset, 0, backgroundHeight, colors, null, CLAMP);
...
topY = top - (gradientShader instanceof BitmapShader ? heightOffset : 0);
```

The shader spans `0 → backgroundHeight`, the height of the whole chat
background, and each bubble draws the **slice of it at its own scroll
position** (`setTop(top, backgroundWidth, backgroundHeight, ...)`). So outgoing
bubbles near the top of the thread are a different colour from ones near the
bottom, and the colour shifts as you scroll.

This is the single most recognisable detail of a Telegram chat theme, it is
cheap in CSS (`background-attachment`-style positioning, or one gradient on the
list with per-bubble masking), and it is the thing that gets missed if you copy
"gradient bubbles" literally by putting a gradient on each bubble.

### 0.3b The pattern layer — the icons ARE transparent holes

Founder, 2026-08-25: *"the icons are transparent and behind them is the
animation"*. **Correct, and Telegram's API documentation says it in those
words.** Source: [core.telegram.org/api/wallpapers](https://core.telegram.org/api/wallpapers).

- A pattern wallpaper is a file, **PNG or TGV** ("gzipped subset of SVG",
  `application/x-tgwallpattern`), and it is *"completely transparent, except for
  the pattern itself which should be shades of black."*
- `intensity` **positive** (0-100): the black pattern is laid over the colour
  fill, 100 = fully visible.
- `intensity` **negative** (-1 to -100): *"pattern should be inverted (black
  background, transparent pattern) before overlaying on top of the color
  fill"*.

So the dark-mode look is **one black sheet with the icons punched out of it,
sitting on the animated fill**. The icons are holes. Nothing about the icons
moves; the light behind them does.

Confirmed in the client, `MotionBackgroundDrawable.java`: for `intensity < 0`
it draws `Color.BLACK` and then composites
`ComposeShader(gradientShader, patternShader, PorterDuff.Mode.DST_IN)` — the
gradient survives only where the pattern has alpha.

⚠ **There IS still a file. It is just the right KIND of file: alpha shapes,
usually vector.** That is the practical difference from what Vergr has today
(§0.4a).

### 0.4a Our background art is the WRONG KIND OF FILE (measured)

Every one of the 7 wallpapers is an **opaque colour raster with no alpha**:

```
bg_1..bg_7.png   1024x1536   8-bit   colourType=2 (RGB, NO ALPHA)   2.0-3.0 MB each
```

`grep`ped for a vector source: there is **none** in the repo. So they cannot be
used as Telegram uses a pattern, because there is no alpha channel to punch
holes with.

**They can still be used, because they are already a luminance mask**: bright
icons on a near-black ground. Measured over the art:

| File | mean luminance | fraction above 32 | 99.5th pct |
|---|---|---|---|
| bg_1 | 9.4 | ~3% | 152 |
| bg_2 | 26.1 | ~31% | 250 |
| bg_4 | 37.6 | ~44% | 255 |
| bg_5 | 35.8 | ~42% | 226 |

So the alpha is DERIVED at bake time. ⚠ **Not by greyscale luminance**: the
icons are coloured neon, so Rec.709 weights a violet icon far below a cyan one
and half the pattern comes out invisible. Rendered proof of exactly that is the
`bg_1 · lum` cell in the lab. The derivation that works is
**`max(r,g,b)`, black point lifted, stretched against the 99.5th percentile,
then gamma 0.65** (`soft` in the lab).

**Consequences to accept or fix, founder's call:**

1. The masks are RASTER, so at desktop width the 1024px art is upscaled and the
   icon edges soften. Telegram's are vector and stay crisp.
2. We ship 2-3 MB per wallpaper today. A vector pattern would be a few KB, and a
   derived single-channel mask is far smaller than the colour original.
3. `settings.motion` in Telegram's API also tilts the pattern slightly for
   parallax on device tilt. Not proposed here; noted so nobody thinks it was
   missed.

### 0.4b Built from scratch: the TILE, and why it fixes crispness

Founder, 2026-08-25: *"we will need to do this from scratch (and i dont want you
messing with the existing backgrounds since users will still need them)"*.

⚠ **`public/backgrounds/static/` IS NOT TOUCHED.** The 7 wallpapers are a
shipped feature and stay. Chat-theme patterns are new assets in their own
directory. Nothing in this effect writes over the wallpapers.

**The crispness problem has one cause and one fix.** The existing wallpapers are
ONE 1024x1536 image stretched to cover, so on a 900px desktop thread every icon
is upscaled and softens. A **seamless tile** is drawn at roughly 1:1 and
repeated, so it never stretches. That is how Telegram's PNG patterns stay sharp
without being huge.

Proven, not argued: `scripts/chat-pattern-tile.mjs` builds a seamless 512px
tile (78 glyphs, rendered at 2x) and `scripts/chat-gradient-lab.mjs` renders it
beside the stretched art at identical sizes. The tile is visibly sharper at
both 390 and 900 wide.

**Seamlessness is one trick and it is in the generator:** every icon is drawn
NINE times, at its position and all eight wrapped offsets, and the rejection
test that keeps icons apart measures distance WITH wrapping. Anything crossing
an edge reappears on the opposite one, so the tile butts against itself with no
seam.

### 0.4c The art: three routes, and what each needs from the founder

The technique is settled and free. What is missing is **art direction** — the
generated scatter is even and crisp but reads as an algorithm, not a design.

| Route | What it is | Cost | Needs from founder |
|---|---|---|---|
| **1. Material Symbols** | Compose tiles from the icon font already shipped (`public/fonts/material-symbols-outlined.woff2`, Apache 2.0) | £0, works today | nothing |
| **2. game-icons.net** ⭐ | 4,170+ SVGs, **CC BY 3.0**, and the site exports **black on transparent**, which IS Telegram's pattern spec. Swords, dice, controllers, potions: actually gaming, not UI glyphs | £0 | approve, plus **one attribution line** somewhere public ("Icons made by [author], available on game-icons.net") |
| **3. Bespoke art** | Founder makes or commissions it | his time | the spec in §0.4d |

Recommendation: **route 2**. It is free, legal for commercial use, already in the
right format, and it looks like a gaming product rather than a settings screen.
The only obligation is the attribution line.

### 0.4d ART SPEC, if the founder supplies the pattern

Hand this to whoever makes it. Every line is a requirement, not a preference.

1. **Format: SVG.** One file per pattern. Raster only as a fallback, and then
   PNG with a REAL alpha channel at 1024x1024 minimum.
   ⚠ The existing wallpapers fail this: they are opaque RGB with no alpha.
2. **Transparent background, solid black shapes.** Not white on black, not
   coloured, no gradients, no shadows. Telegram's own words: *"completely
   transparent, except for the pattern itself which should be shades of
   black."* The shapes become the holes the light comes through.
3. **Square and seamlessly tileable.** The right edge must continue into the
   left, the bottom into the top. 512x512 design units.
   ⚠ **This is the one AI image generators get wrong.** If the art comes back
   non-tiling, it can still be used, but it must then be a SCATTER with no
   composition, and it gets made seamless by the wrap trick in the generator.
4. **Even density.** No large empty areas, no clumps. Roughly 60-90 shapes per
   512 tile.
5. **Stroke weight >= 2 units at 512 scale**, so a 24px icon on a phone does not
   disappear.
6. **Mixed sizes** (roughly 22-48 units) reads better than one uniform size.
7. **No text**, no small lettering: it turns to mush at phone scale.
8. One pattern per theme, so 8, or a smaller set usable with any palette (§2c).

### 0.4e THE ANIMATION, planned in full

Every value is Telegram's, read from their source, not chosen by taste.

| Property | Value | Source / reason |
|---|---|---|
| Trigger | **one phase step per message SENT** | Telegram's rule. Receiving does not animate |
| Duration | **500ms** (300ms fast) | `MotionBackgroundDrawable`, `dt / 500f` |
| Easing | **cubic-bezier(0.33, 0, 0, 1)** | their `CubicBezierInterpolator` |
| Phase | 0..7, wraps | their `if (phase > 7) phase = 0` |
| What moves | **only the light behind the mask.** The icons never move | this is the whole look |
| Idle | **continuous drift, one phase per 12s** (96s per revolution) | ⚠ CORRECTED, founder 2026-08-25: *"why would it only animate on send"*. The first build moved ONLY on send, which is what Telegram's chat background does. But their own drawable has a continuous mode and it supplies the constant: `posAnimationProgress += (dt / 12000f) * indeterminateSpeedScale`. Sending still kicks it onto the fast 500ms curve, then the drift resumes |
| Paused when | `document.hidden` | a continuous animation is the one thing that could make this expensive. A frame is 0.32ms, which is nothing while visible and pure waste while not |
| Cost | **0.32ms per frame**, ~10ms of main thread for a whole transition | measured, not estimated. 2% of a 60fps budget, so no WebGL and no worker |
| Reduced motion | render phase 0 once, no rAF at all | ⚠ BOTH switches: the media query AND `html[data-reduced-motion]` ([06](06-typing-indicator.md) §8.2.2) |
| Position | fixed to the thread viewport | or it scrolls away |
| Off-screen | no rAF when the thread is not visible | cost discipline |

Recorded for review: `node scripts/chat-gradient-lab.mjs --anim`.

### 0.4f AUDIT — is it Telegram quality, or just good enough?

Founder asked for this explicitly. Answering honestly, in both directions.

**Telegram-grade, verified line by line against their own source:**

- the 60x80 bitmap, the 8 positions, the stride-2 y-flipped selection, the
  `max(0, 0.9 - d)^4` weighting and the `6.4·(0.35d)²` swirl are theirs exactly
- timing, easing, phase cycle and trigger are theirs exactly
- the pattern format is their documented spec: black shapes on transparent,
  inverted to a black sheet with the icons punched out, gradient behind
- **correctness fixture:** run their own default palette through our renderer
  and it reproduces Telegram's signature green/cream wash

**Better than what Vergr ships today:** the pattern is a repeating tile drawn at
about 1:1 rather than one 1024px image stretched to cover, so it stays crisp on
a 900px desktop thread.

**NOT yet Telegram quality, and these are real:**

1. ⚠ **The icon vocabulary is a UI font.** Material Symbols are interface
   glyphs, so the field reads "tech settings screen" rather than "games
   product". Telegram's patterns are drawn. **This is the single biggest gap**
   and it is fixed by the art route in §0.4c, not by more geometry.
2. The bubble fill in the prototype is a flat per-bubble gradient. Telegram
   anchors it to the whole thread (§0.3), which is the detail that sells it.
3. No day/night variants yet.
4. Intensity is pinned at 100%. Telegram exposes 0-100 and the render is hot.
5. Blank-spot ratio sits at 0.660. Higher would be better; getting there needs
   either smaller filler or accepting some ink collisions, and collisions look
   worse than slight unevenness (measured: at 0.720 the nearest-neighbour floor
   fell to 1.2 units and icons merged into blobs).

**Verdict: the technique is there, the art is not.** Geometry is measurable and
now measures well. Art direction is the open question.

### 0.4 What Vergr ALREADY has — this is not greenfield

Measured before proposing anything:

| Piece | Where | State |
|---|---|---|
| Per-chat background | `conversations/{id}.chatBackground` (+ `chatBackgroundImage`) | **live**, written by `ChatSettingsScreen.jsx:85 applyBackground()` |
| 7 preset wallpapers + custom upload | `src/utils/Chatbackgrounds.js` `CHAT_BACKGROUNDS` | **live**, mobile + desktop variants |
| Style resolver | `getChatBgStyle(bgId, customImageUrl, { isDesktop })` | **live**, one function |
| Entry point | chat header menu → "Change Wallpaper" → `/messages/:id/settings` | **live** (`ChatThreadScreen.jsx:3405`) |
| Native mirror | `NativeChatSettingsScreen.jsx` | **live** |

⚠ **The background is already stored ON THE CONVERSATION DOC, so both
participants already see it.** That is Telegram's model, already in place. A
chat theme is therefore an EXTENSION of an existing per-chat setting, not a new
system, and the work is: bundle the background with bubble colours, make the
background algorithmic instead of a PNG, and add day/night.

⚠ It also means the current wallpapers are **7 image files served to every
viewer**, while a Telegram-style gradient theme is **four hex values on a
document**. The algorithmic version is cheaper than what ships today.

## 1. Research — the legibility problem is the whole problem

Sources: [Axess Lab — Glassmorphism meets accessibility](https://axesslab.com/glassmorphism-meets-accessibility-can-frosted-glass-be-inclusive/),
[New Target — Glassmorphism with accessibility in mind](https://www.newtarget.com/web-insights-blog/glassmorphism/)

### ⚠ Finding 1: contrast over a translucent bubble is DYNAMIC

> "If the background happens to be dark in one spot and light in another, the
> text might be perfectly legible on the left side of the card and completely
> invisible on the right."

This is not a hypothetical here: doc 11 puts arbitrary squad environments behind
these bubbles. A translucent bubble over a user-chosen backdrop has **no
knowable contrast ratio**.

WCAG: **4.5:1** normal text, **3:1** large text.

### ⚠ Finding 2: the fix is a floor, not a tweak

> "A glass card must have a foundational fill colour set to at least 40% to 60%
> opacity. This guarantees a baseline level of contrast, regardless of what
> vibrant imagery is passing behind it."

And the lighter variant: layering a semi-opaque colour (black at 20–30%) beneath
the text stabilises contrast while keeping translucency.

**Therefore: a bubble theme may choose hue, radius and border. It may NOT choose
an opacity below the floor.** The floor is a system constraint, not a preset
value a user can override — including in the Mythic tier-2 "builder", where the
opacity control must be clamped rather than free.

### ⚠ Finding 3: `backdrop-filter` is expensive and must be bounded

> "The CSS backdrop-filter property is notoriously expensive... It forces the
> GPU to calculate the blur of every pixel behind the element, in real-time, 60
> times a second as the user scrolls."

Guidance: avoid `blur(20px)` and above, and restrict blur to small, localised
containers.

⚠ **A chat thread is the worst possible case**: dozens of bubbles, each its own
backdrop-filtered surface, all scrolling. Recommendation: **no `backdrop-filter`
on message bubbles at all.** Use a semi-opaque fill (which the contrast floor
already requires) and reserve blur for single large surfaces such as a header.

## 2. Surfaces: which ones actually render a bubble

⚠ **THIS TABLE WAS WRONG AND SENT WORK AT A FILE THAT HAS NO BUBBLES.** It used
to list four "chat renderers" including `ChatDetailScreen` as a "DM thread,
compact". Checked 2026-08-25: that file contains **no `isMe` and no
`senderId` anywhere**. It is the details panel (mute, block, shared media).
Corrected list, each verified by grepping for the thing rather than assuming:

| Surface | File | Renders bubbles? | Themed |
|---|---|---|---|
| DM thread | `src/screens/messages/ChatThreadScreen.jsx` | yes | ✅ |
| DM thread, native | `native/NativeChatThreadScreen.jsx` | **re-exports the web thread** | ✅ free |
| DM details panel | `src/screens/messages/ChatDetailScreen.jsx` | **no** | n/a |
| Messages inbox | `native/NativeMessageScreens.jsx` | no (list rows) | n/a |
| Squad chat | `src/screens/squads/SquadChatThreadScreen.jsx` | yes | ❌ out of scope, DMs only |

So the DM thread is ONE file on both web and native, because
`NativeChatThreadScreen.jsx` is eight lines that re-export it. That is the
opposite of the four-profile-views trap ([[handover]] §1) and worth knowing:
here, doing the work once genuinely covers both.

Related surfaces that render message-shaped content and must be checked:

- `src/components/messages/ChatPollBubble.jsx` — a poll inside a thread
- `src/components/monetization/LockedMedia.jsx` — locked media in a thread
- `src/components/monetization/OneToOneCard.jsx`
- `src/components/MessagesListPanel.jsx` — inbox preview rows
- `src/components/Messagecontextmenu.jsx` — the long-press menu, which sits over
  a bubble and must remain legible against every theme

⚠ **Live stream chat (`ChatPanel.jsx`) is NOT in scope.** It renders rows, not
bubbles, and it is the surface doc 07 already targets. Do not extend this there.

## 2b. PROPOSAL — how I suggest we proceed (awaiting founder sign-off)

### The shape

A **chat theme** is one id on the conversation doc, next to the wallpaper that
is already there:

```
conversations/{id}.chatTheme = 'ember'          // alongside chatBackground
```

A theme resolves to: **4 gradient colours (day) + 4 (night) + outgoing bubble
colours + incoming bubble colour + accent**. That is data, in one file, the way
`PROFILE_ACCENTS` and `TYPING_STYLES` already work.

**Cost: zero.** No image assets (today's 7 wallpapers are files we serve; a
theme is four hex values), no extra reads (the conversation doc is already
subscribed on every one of these surfaces), no new listener, no relay change.

### The four pieces to build

1. **`<ChatGradient>`** — a 60x80 canvas upscaled to fill the thread, running
   the §0.2 algorithm: 8 slots, 4 colours on stride 2, swirl cached, inverse
   4th-power distance weighting. Phase advances **one step per message sent**,
   500ms, cubic-bezier eased. Static first frame under either reduced-motion
   switch (both of them, per the lesson in [06](06-typing-indicator.md) §8.2.2).
2. **Bubble fill anchored to the THREAD** (§0.3), not per bubble. This is the
   detail that makes it read as Telegram rather than as "bubbles with a
   gradient on them".
3. **Day/night** from the existing theme setting, one theme id covering both.
4. **Picker**, as a second tab beside the existing Wallpapers in chat settings.
   ⚠ The 7 wallpapers and custom upload STAY. Nothing is removed.

### Suggested order

Gradient first, standalone and measurable against the constants in §0.2, before
any of it touches a chat screen. Then bubbles, then the picker, then native.

### ✅ DECIDED (founder, 2026-08-25)

1. **A theme applies to BOTH people.** Matches Telegram and matches the
   wallpaper behaviour already shipped.
2. **The SETTER's unlock decides.** Their theme shows to someone who has not
   earned it, which is the point of an unlock being visible.
3. **DMs only.** Squad chat is out of scope.
4. **Presets AND user-chosen colours**, as Telegram does (§0.5).
5. **Pro unlocks it too**, not only the level (§0.6).

### 0.5 Can we copy their method, and their colours?

**The method: yes, and it is fully written down in §0.2.**

⚠ **One legal line, and it is the only one.** The Telegram client is **GPLv2**.
Copying their *source* into Vergr would put Vergr under GPL. We are
reimplementing a *published algorithm* from the description in §0.2, which is a
different thing and is fine. **Read their code to understand it; write ours.**
Do not paste theirs.

**Their 8 palettes: NOT AVAILABLE, and this is a real finding rather than a
preference.** They are not in the open-source client. The client fetches them at
runtime:

```
ChatThemeController.java:123   TL_account.getChatThemes request = new TL_account.getChatThemes();
EmojiThemes.java              themes are keyed by EMOJI and filled from the server response
```

The only palettes hardcoded in the client are defaults:

| Where | Colours |
|---|---|
| `MotionBackgroundDrawable` default | `#426D57 #F7E48B #87A284 #FDF6CA` |
| `EmojiThemes.java:710` fallback wallpaper | `#dbddbb #6ba587 #d5d88d #88b884` |

So "copy their colours" would mean lifting a competitor's curated brand palettes
off their servers or out of screenshots. **Recommendation: same method, our
colours.** `PROFILE_ACCENTS` already gives twelve named, level-laddered Vergr
colours to build 8 themes from, and the brand rule against cyan
([[project-brand-no-cyan]]) means a straight copy would fight it anyway. The two
palettes above are recorded so the algorithm can be verified against Telegram's
own default output.

**User-chosen colours: yes, and most of it is already built.** Telegram lets you
"choose three or four colors to unlock the animation" and recolour the bubble
gradient. Vergr already has the picker, built for the animated name gradient in
[03](03-name-gradient.md): `GradientEditor` (2-6 stops, add/remove, live ramp),
`ColorField` and `ColorPopover` with a **screen eyedropper**. For a chat theme
it is clamped to **3 or 4 stops**, because the §0.2 algorithm takes exactly 3 or
4 colour points.

### 0.6 Pro, as well as the level (founder, 2026-08-25)

Gate: **`isUnlocked('chat_theme', level) || resolveTier(profile) === 'pro'`.**

⚠ Two rules this has to respect:

- **A Pro bullet must be genuinely enforced.** The 2026-08-19 audit deleted a
  list of Pro claims that nothing gated. Do not add the line to `TIERS` until
  the gate is real, and do not describe it as anything other than what it does.
- **`firestore.rules` must mirror it**, and can: `subscription` is a top-level
  string on the user doc, so `cosmeticsAllowed()`-style validation reads it off
  `resource.data` with no extra document read, exactly like `vpLevel` today.

**Downgrade behaviour: resolve at READ time, never at write time.** The theme id
stays on the conversation doc, and the resolver returns the default when the
setter no longer qualifies. That is how `typingStyleFor()` already works
([06](06-typing-indicator.md) §4.1), it needs no cleanup job, and it means an
expired Pro subscription stops showing the theme by itself.

### ⚠ ANSWERED — the three that needed the founder

1. **Does a theme apply to BOTH people?** Telegram: yes, either side sets it and
   both see it. Vergr's existing wallpaper: **also yes already** (it is on the
   conversation doc). Recommend keeping that, since it matches both.
2. **If yes, whose unlock counts?** Telegram has no levels so the question does
   not arise there. If the SETTER's unlock decides, a Rival L3 user shows their
   theme to someone who has not earned it, which is the whole point of an
   unlock being visible to other people. The alternative is each side seeing
   only what they have unlocked, which makes the reward invisible.
   **Recommend: the setter's unlock decides.**
3. **DMs only, or squad chat too?** Telegram is private chats only. Squad chat
   is a different renderer with a different background. **Recommend DMs first**,
   and squad chat only if you want it, since it doubles the surface work.

## 3. Implementation

1. `data-bubble-theme` on the message container, with CSS custom properties
   supplying hue, radius, border and fill. One CSS file, four call sites.
2. ⚠ The theme is the **SENDER's**, applied to their bubbles only, so a thread
   shows both parties' identities. Resolve from `vpLevel` on the message, never
   a per-message profile read (R9).
3. Opacity is clamped in code (`Math.max(FLOOR, chosen)`), not merely documented.
4. No `backdrop-filter` (see §1 finding 3).
5. `prefers-reduced-motion` is irrelevant here (no motion), but
   `prefers-contrast: more` should force the fill to full opacity.

## 4. Verification

- **Automated contrast sweep:** for every theme x every squad environment
  (doc 11) x light and dark message text, sample the rendered text against its
  bubble and assert >= 4.5:1. This is the test that matters and it must be a
  script, not a spot check.
- Assert no `backdrop-filter` appears in computed styles on any message bubble.
- Assert bubble opacity never computes below the floor, including via the
  tier-2 builder.
- Render all four surfaces plus the six related components in §2.

---

## 9. BUILD STATE: 8 themes SHIPPED + DEPLOYED 2026-08-25

Founder approved all eight after reviewing every icon rendered per theme.

| Theme | Mood | Icons | Phosphor | game-icons |
|---|---|---|---|---|
| Arcade | Retro gaming | 25 | 18 | 7 |
| Dracula | Gothic, red and black | 25 | 12 | 13 |
| Gaia | Nature | 25 | 16 | 9 |
| Chatter | Everyday | 22 | 22 | 0 |
| Cosmos | Space | 20 | 8 | 12 |
| Neon | Synthwave | 18 | 13 | 5 |
| Vault | Prestige, gold | 19 | 11 | 8 |
| Studio | Creator | 20 | 20 | 0 |

### The icon source changed, and it carries a licence obligation

174 icons, **120 Phosphor (MIT)** + **54 game-icons.net (CC BY 3.0)**.

⚠ **CC BY 3.0 REQUIRES THE ARTISTS BE CREDITED PUBLICLY.** `/platform/credits`
(`CreditsScreen` in `PublicMarketingScreens.jsx`) names Lorc, Delapouite, Skoll,
Caro Asercion and Darkzaitzev. **This is not decoration.** `chat-contrast-check.mjs`
reads `scripts/chat-pattern-icons/manifest.json`, collects every artist whose work
actually ships, and FAILS THE BUILD if the page does not name them, so the credit
cannot drift when the icon set changes. Negative-tested by deleting a name.

⚠ **Phosphor is taken at the FILL weight, never `regular`.** Regular is a thin
outline, and sparse ink measured 6.4% coverage against a 15.8% target. Fill also
matches game-icons' solid style so the two sources read as one set.

Source SVGs live in `scripts/chat-pattern-icons/`, **not** `public/` — they are
build inputs, and only the generated tile is ever served.

### The generator draws Path2D now, not font glyphs

Every icon is exactly one `<path>` in one of two square viewBoxes, with no
transform, group or fill-rule (audited across all 174). So the change was two
regexes plus `new Path2D(d)`. **The packing, banding, rotation, ink measurement
and toroidal wrapping are untouched** and the tiles measure in line with the
approved font-based build (blank-spot ratio 0.52-0.69 against 0.66).

⚠ **A patch script writing regexes through a template literal ATE ONE ESCAPE
LEVEL** and silently turned `\s` into `s`. The regexes here are deliberately
written with character classes (`[ ]`, `[0-9]`) so they contain no backslashes
and cannot be mangled again.

⚠ **DO NOT RETUNE THE PACKING.** Swapping the icon source is not licence to
touch `BANDS`, the void-fill loop or the palettes. That was tried in this
session and the founder rejected it: *"all you needed to do was copy and then
replace the icons why are you trying to redo every theme"*. Reverted to the
approved values.

### Bubbles

A theme resolves to gradient colours **plus** `out` (2-stop outgoing), `in`
(incoming) and `accent`, per §2b. Wired in `ChatThreadScreen`, replacing a
hardcoded `linear-gradient(160deg, #9D4EFF, #6E1FD1)`.

**§0.3 thread-anchoring** is `background-attachment: fixed` on the outgoing
bubble: the gradient lays out against the viewport, so each bubble paints the
slice it happens to sit over and the colour shifts as you scroll.
⚠ WebKit treats `fixed` as `scroll`, so on iOS the gradient is per-bubble. That
is a graceful degradation, not a bug to chase.

**No `backdrop-filter` anywhere on a bubble** (§1 finding 3).

⚠ **THE CONTRAST FLOOR IS ENFORCED IN CODE, NOT TRUSTED TO THE PALETTE.**
`chatBubbleColors()` runs every colour through `ensureContrast(c, '#FFFFFF', 4.5)`.
Custom colours come from a free hex picker, so a user can pick pale yellow;
measured, an all-pale custom set clamps to 4.71-4.97:1. An unreadable bubble is
not expressible. Custom colours also now drive the BUBBLES, not just the
gradient, which previously left the preset's bubbles behind and read as a bug.

Two preset accents were caught by the guard and raised: arcade `#C87FFF` measured
2.84:1 on its own outgoing bubble and neon `#F0479B` 2.81:1, both under the 3:1
floor for link and timestamp text.

### `scripts/chat-contrast-check.mjs`: 134 assertions, in `npm run check`

Asserts per theme: pattern tile exists, 4 valid hex per appearance, every
outgoing stop and the incoming bubble >= 4.5:1 against white, accent >= 3:1
against both bubbles, ids unique, and `firestore.rules` accepts every id (the
nameFont class of bug: a picker offering what the server refuses).

⚠ **It also guards the 7 wallpapers.** Founder: *"i dont want you messing with
the existing backgrounds since users will still need them"*. Chat themes are
ADDITIVE. Verified: `git status public/backgrounds/` is clean and all seven still
serve 200.

Negative-tested three ways (unreadable bubble, dropped artist, deleted wallpaper);
all three fail correctly.

### Verified live 2026-08-25

All 8 tiles serve 200 from `vergr.app/chat-patterns/` with the `/brand/**`-style
cache headers (7d browser, 30d CDN), NOT the catch-all `no-store`.
`/platform/credits` serves 200 and renders all five artists. `npm run check` is
354 assertions across four guards.

**Still to verify by hand:** the picker and bubbles on a real thread across two
accounts, and the three non-DM surfaces in §2 (`ChatDetailScreen`,
`SquadChatThreadScreen`, `NativeMessageScreens`) which are DM-only by design but
should be confirmed not to regress.

---

## 10. Three founder corrections, 2026-08-25 (all SHIPPED + DEPLOYED)

### 10.1 Empty circles: the metric could not see the defect

Founder: *"i see empty spaces that look like circles"*. Correct, and I had
reported the tiles as fine.

⚠ **`measureTile()`'s "blank-spot ratio" BLURS over a neighbourhood, so a ring of
dense specks around a round hole still averages fine.** It scored 0.52-0.69
against 0.66 for the approved build while real holes were present. The metric
was structurally incapable of detecting what was being reported.

The honest measurement is the **largest inscribed empty circle**, wrap-aware:

| | before | after |
|---|---|---|
| cosmos | **24.7** | 11.5 |
| dracula | 18.7 | 11.5 |
| neon / vault | 18.0 | 11.5 |
| gaia | 17.0 | 12.7 |
| studio | 17.5 | 11.5 |
| arcade / chatter | 15.7 / 15.0 | 12.0 / 11.5 |

(radius in tile units, 768 tile; 24.7 is a ~23px bald patch on a phone)

⚠ **THE FIRST FIX MEASURED THE WRONG THING AND CHANGED NOTHING.** It computed
distance to the nearest circle EDGE and produced byte-identical output, because
**the holes are INSIDE the packing circles**: a large bubble holding a sparse
glyph is mostly empty, and no amount of circle geometry can see that.

`closeInkVoids()` rasterises what is actually DRAWN, distance-transforms the ink
on a torus, and places icons on the deepest points, in rounds. Only ink can see
an ink problem.

⚠ This is an ADDITIVE pass. `BANDS`, the random sweep and the palettes are
untouched.

### 10.2 The tiles moved to R2, because Hosting egress is billed

Founder: *"its on R2 right? not hosting? because hosting costs me money"*. It was
on Hosting. It is not now.

A tile is ~300KB and exactly one is fetched per themed conversation, so a few
thousand chat opens would eat the Hosting daily transfer allowance on their own.
R2 egress is $0. `chatPatternUrl()` points at `cdn.vergr.app/chat-patterns/`.

Publish with `node scripts/publish-chat-patterns.mjs` (same R2 credentials path
as `publish-apk.mjs`; the AWS SDK resolves out of `functions/node_modules`).

⚠ **FIREBASE'S `ignore` GLOBS DID NOT WORK.** `chat-patterns/**` in hosting
`ignore` left the files deployed and still answering from `vergr.app`. The
reliable fix is to keep them OUT OF `public/` entirely: the generator now writes
to **`chat-pattern-tiles/`** at the repo root, so nothing copies them into
`dist/`. `vp-mirror-check.mjs` and `chat-contrast-check.mjs` both point there.

⚠ **A 200 FROM HOSTING PROVED NOTHING.** The SPA rewrite answers any unmatched
path with `index.html` at HTTP 200. Verified by `content-type`: Hosting returns
`text/html` (36KB shell), R2 returns `image/png`. Same trap CLAUDE.md already
records; check the type, never the status.

⚠ Cross-origin is fine for a mask. CSS `mask-image` never exposes pixels to
script, so no CORS header is needed, and the native CSP already carries a bare
`https:` in `img-src`.

### 10.3 The motion was still a circle, and the "fix" had been fake

Founder, twice: *"your gradient animations all move in a circle, how creative of
you"*, then *"they all still move in a circular motion, create a few different
options to choose from so that they aren't all the same"*.

⚠ **THE FIRST FIX WAS COSMETIC AND I PRESENTED IT AS REAL.** It replaced
Telegram's ring rotation with "Lissajous paths" at frequency ratios of 1.32,
0.61, 1.45 and 1.34. **A Lissajous at a ratio near 1:1 with a phase offset IS AN
ELLIPSE.** It swapped a circle for a squashed circle.

Five structurally different MODELS now, not five tunings of one, chosen per
conversation (`chatThemeMotion`, `CHAT_MOTIONS`, picker in `ChatSettingsScreen`):

| id | model | measured radius min/max | aspect | closed |
|---|---|---|---|---|
| `drift` | Lissajous at 3:2, 5:3, 7:4, 4:7 (real lobes) | 0.119 | 1.05 | yes |
| `tide` | dominantly one axis, slides across and back | 0.011 | 4.86 | no |
| `pulse` | purely RADIAL on a fixed bearing, no angular term | 0.001 | inf | yes |
| `wander` | 3 incommensurate sines per axis, no period | 0.021 | 1.09 | **no** |
| `orbit` | a circle, kept ON PURPOSE | **0.912** | 1.07 | yes |

The metric is validated by `orbit` scoring 0.912 (a circle holds a constant
radius from its own centroid). The old paths would have scored like `orbit`.
`scripts/../paths` plot renders each trajectory; `orbit` visibly draws one
circle with all four colours on it, which is exactly what shipped before.

⚠ **Motion is a SEPARATE choice from the theme.** The complaint was that every
theme moved identically, so a per-theme preset the user cannot change would not
answer it. Switching preset does not reset motion.

Each picker chip previews itself LIVE with no pattern mask, because the only
thing separating these is how they move and a static swatch says nothing.

`npm run check` is now **367 assertions**.

### 10.4 The theme reaches INSIDE the bubble (2026-08-25)

Founder screenshotted this twice and I recognised it once: the poll result bar
AND the voice-note play button were both brand violet on a crimson Dracula
bubble.

⚠ **FIXING CALL SITES ONE AT A TIME WAS THE WRONG SHAPE.** A live probe kept
proving it: 8 violet elements, then 6, then 6 again. Two root causes, neither
visible from reading the source:

1. **`noBubble` messages got `style={undefined}`.** Media, location and file
   cards render without bubble chrome, so they received NONE of the theme's
   custom properties and everything inside them fell back to brand violet. The
   scoped CSS rule was correct the whole time; the variable was not there to
   read. Fixed with `bubbleVarsOnly`.
2. **A shared `shell` string fed THREE cards** (location, coin, contact) the same
   hardcoded glow. Found by printing the class list of `.vg-beam-violet`
   elements on the LIVE page: four cards, two components. Grepping for the
   component name would have missed it entirely.

The durable fix is one scoped block in `surface.css`
(`[data-msg-bubble] .text-brand-violet-light`, the `bg-brand-violet/*` variants,
and `.vg-beam-violet::after`), covering every current AND future in-bubble use.
Chasing individual call sites is exactly how the profile-theme system failed.

⚠ **THE MAP IS REAL AND IS NOT TOUCHED.** It is built from each message's own
lat/lng via `/maptile` with an OSM tile fallback. I described the card as
"bespoke art" and the founder correctly pushed back: only OUR CHROME over the
map was hardcoded (card glow, beam border, pin gradient, "Open map" pill ring,
footer badge, dot-grid). All of it now follows the accent.

⚠ **THE STATIC RING MUST SIT WELL BELOW THE ORBITING BEAM.** Mapping the 1.5px
ring to `--vg-chat-accent-70` while the beam also peaks at 0.70 made the card
read as a solid border and hid the travelling light. Founder: "its not a solid
border it should still be orbit, just change the colour". Ring is now 0.28
against a 0.70 beam peak.

⚠ **`vg-brandmark` OPTS OUT.** `VERGR SENT YOU` is the platform's name in the
platform's colour, so it stays violet. Same reasoning as LockedMedia's paywall
wash and OneToOneCard's purchase CTA.

Verified live on the VIEWER account (verion, who did not set the theme): 39/39
bubbles carry `--vg-chat-accent`, and the only violet left is the two brand marks.

⚠ **ANIMATION CANNOT BE MEASURED IN A HIDDEN TAB.** Chrome freezes animation
timelines when `visibilityState === 'hidden'`, so `Animation.currentTime` stops
advancing and a running animation looks dead. Check `document.visibilityState`
before concluding an animation is broken.
