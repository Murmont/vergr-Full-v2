# 02 — Ambilight

**STATUS: BUILT, FIXED AND LIVE.** The two defects this header called "open"
were fixed in the same session that wrote §5.3 — that section describes the fix
"as actually shipped" and gives the measurements from it, so the header
contradicted the body. Verified against source 2026-08-25:
`Ambilight.jsx` carries the `ResizeObserver` blur (`(w / SAMPLE_W) * 0.75`, :111),
`ctx.filter='blur(1px)'` at source scale (:136), `inset: 0` (:171) and
`feather={false}` support (:80). Corrected rather than left standing, because a
stale "open defect" gets re-fixed by the next session.

Rules: [00-RULES.md](00-RULES.md) · Code: `src/components/effects/visual/Ambilight.jsx`

---

## 1. Research

Source: [Smashing Magazine — Recreating YouTube's Ambient Mode Glow Effect](https://www.smashingmagazine.com/2023/07/recreating-youtube-ambient-mode-glow-effect/)

The effect is four things. Getting any one wrong turns it into "a blurred copy
behind the video", which was rejected three times.

| Property | Reference value | Why |
|---|---|---|
| Canvas | **10x6** | Downscaling that far discards every detail and keeps only dominant colour. This IS the effect (R4). At 32x18 the picture is still legible. |
| Blur | `ctx.filter = "blur(1px)"` **before** `drawImage` | 1px on a 10px-wide canvas covers a tenth of the image. The same 1px after upscale covers nothing (R5). |
| Extent | canvas LARGER than the video, video inset via `padding: 7rem` | The light occupies space the layout reserved. Reaching outside washes siblings (R1). |
| Edges | `box-shadow: inset 0 0 4rem 4.5rem` on the wrapper | The glow must die before its own boundary or the eye reads a rectangle. |
| Opacity | `0.4` | |
| Sync | `requestAnimationFrame` loop, plus `play`/`pause`/`seeked`/`loadeddata`/`ended` listeners | |

**Two things NOT to repeat, both invented rather than researched:**

- Per-edge "zone glows" computed with `getImageData`. They cannot produce a
  corner, so they always read as four gradients meeting. They also forced a
  `crossOrigin` read-back and a cache-busting workaround, all of which vanished
  when the technique was done correctly — `drawImage` works on a tainted canvas.
- A fixed CSS blur. See R3 and §5.2.

## 2. Hard limit — never file this as a bug

**A YouTube embed is a cross-origin iframe. Its pixels cannot be read by
canvas.** No flag, proxy, or permission changes this; it is a browser security
boundary.

Embeds therefore sample the **poster frame**
(`img.youtube.com/vi/<id>/hqdefault.jpg`, which `EmbedVideoPlayer` already
resolves) and their glow is **static** — the video's real colours, not following
playback. Our own videos sample live because we own the pixels.

## 3. Surfaces — complete inventory

| Surface | File | State |
|---|---|---|
| Own profile banner | `src/screens/profile/ProfileScreen.jsx` | live |
| Public profile banner | `src/screens/profile/PublicProfileScreen.jsx` | live |
| Native profile banner | `src/screens/profile/native/NativeProfileScreens.jsx` | live |
| Feed video (ours) | `src/components/PostCard.jsx` (2 sites) | live, needs §5 |
| YouTube / Twitch embed | `src/components/EmbedVideoPlayer.jsx` | live, needs §5 |
| Lightbox | `src/components/MediaLightbox.jsx` | live |
| Shared player (prop-gated, currently off) | `src/components/media/InlineVideoPlayer.jsx` — used by 15 files: `PostCard`, `MediaLightbox`, `monetization/LockedMedia`, `VergrMeView`, `streams/MobileLiveViewer`, `media/InlineAudioPlayer`, `ErrorBoundary`, `screens/create/native/NativeCreateScreens`, `screens/home/native/NativeHomeScreens`, and others | off by default |

**Founder decision 2026-08-24, option (b):** the profile banner stays
**full-bleed**. It touches the top of the page and both content edges, so light
can only travel downward. Do not propose insetting it again.

## 4. Parameters as built

| Parameter | Value |
|---|---|
| Canvas | 10x6 |
| Source blur | `ctx.filter='blur(1px)'` |
| Video sample rate | 12/sec (not rAF: at 10x6 blurred, extra frames are invisible work) |
| Image sample | once (a still frame cannot change) |
| Layer | `inset: 0`, `z-index: -1` |
| Profile reserved box | 400px tall against a 220px banner — owns the 180px below |

## 5. The two open defects, and the approved fix

### 5.1 The darkened border (R2)

Wrapper padding **44px** against a feather of `inset 0 0 31px 35px` = **~66px**
inward. The dark ring consumed the entire padding band and lapped over the video
edge, so the glow was killed exactly where it should be brightest.

### 5.2 The pixelation (R3)

Canvas is 10 cells wide. Across a ~1060px box that is **~106px per cell**. The
CSS blur is a fixed **28px**, which cannot blend 106px cells. What is visible is
bilinear interpolation between 10 samples.

### 5.3 The fix, as actually shipped

1. ⚠ **The glow is anchored to the MEDIA, not to the card.** An intermediate
   version put one glow at `inset: 0` on the whole `PostCard`. That was WRONG
   and was rejected on sight: a 16:9 sample stretched across a tall card loses
   any resemblance to the picture it came from and floods the entire card with
   one colour. Founder: *"it shouldn't keep a resemblance of the share, not
   stretch out over the entire card."*

   `MediaGlow` in `PostCard.jsx` wraps each media block, so the wrapper is
   sized BY the media and the glow box is `media + bleed` on every side,
   preserving the media's aspect ratio. **Measured after the fix:** glow
   982x601 around media 870x489 — exactly 56px on each side — inside a card of
   990x716, so it covers 601 of 716px rather than all of it.

2. **Containment comes from a CLIP, not from padding.** The card sets
   `overflow: hidden`, so a glow that bleeds past its media still cannot reach
   the card above or below. This is why `bleed > 0` is legitimate here while a
   negative inset was not: R1's requirement is that the light never reaches a
   sibling, and a clip satisfies it without padding fighting the layout.

3. **Blur from a `ResizeObserver`:** `blur = (width / 10) * 0.75`. Measured
   live: a 990px box gives 99px cells and a **74px** blur. This is the
   pixelation fix; a constant cannot be right at two different widths.

4. **No feather in card mode** (`feather={false}`). An inset shadow inside a
   card paints a dark ring rather than softening an outer edge — that was the
   "darkened border".

5. **Reverted** the padded wrappers added to `EmbedVideoPlayer` and
   `InlineVideoPlayer`. The embed only publishes its poster URL; the card draws
   the light. `InlineVideoPlayer` keeps its padded path for the LIGHTBOX, where
   the video is the subject of the screen and there is no card to clip it.

### 5.4 The rule this leaves behind

> The glow box must have the SAME SHAPE as the source. Anchor it to the media
> and expand uniformly. Never stretch it to fill a container of a different
> aspect ratio — the result has no resemblance to the content and reads as a
> colour wash, which is the single most common way this effect is done badly.

## 6. Verification

- **Numeric, not visual:** sample the rendered canvas at cell boundaries and
  assert the luminance step between adjacent cells is below threshold. This is a
  measurable test for "not blocky" that runs without a screenshot.
- Assert the glow layer's rect equals its reserved box (containment, R1).
- Assert no post text or link card overlaps the glow rect.
- Check every row of §3, not just the profile.
