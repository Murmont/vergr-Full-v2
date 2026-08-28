# 10 — Custom reaction packs

**STATUS: ⛔ DROPPED, 2026-08-26.** Founder: *"reaction packs, which I cannot
actually create myself"*. The system was buildable; the ART was never sourceable,
and generating it blind is what got the milestone badges rejected (§18 of the
scope table). Its Elite L2 / Veteran L3 slots are released for effects that need
no art. Do not revive without an art source in hand FIRST.
Elite LV2 (tier 1), Veteran LV3 (tier 2). Rules: [00-RULES.md](00-RULES.md)

---

## 1. Research — format choice

Sources: [Not Everything Should Be Lottie (2026)](https://dev.to/louisbuilds/not-everything-should-be-lottie-choosing-the-right-animation-format-in-2026-en1),
[Animated Images in 2025: WebP vs APNG vs GIF](https://webp-to-png.tools/blog/animated-images-in-2025-webp-vs-apng-vs-gif-real-world-use-cases/)

| Format | Size (5s loop, cited) | Render cost | Needs a library |
|---|---|---|---|
| Lottie | **~40KB** | ⚠ **CPU by default** | yes (~250KB) |
| WebM | ~300KB | GPU video decode | no |
| GIF | ~9MB | cheap, ugly | no |
| Animated WebP | small, strong | GPU image decode | no |
| APNG | varies — **not always smaller than WebP** | GPU image decode | no |

### ⚠ The finding that decides it

> "Lottie renders on the CPU by default, so ten simultaneous complex animations
> will make a page feel sluggish on mid-range phones even though the files are
> tiny. Size is not the only cost — render cost matters too."

A reaction pack's whole purpose is that **a scrolling feed shows many at once**.
That is precisely the "ten simultaneous animations" case, on precisely the
device class (mid-range Android in a WebView) where Vergr is weakest.

**Decision: animated WebP.** Full alpha, GPU-decoded as an image, no runtime
library, no CPU rasterisation per frame. Lottie's file-size win is irrelevant
when the constraint is simultaneous render cost, not download.

⚠ **Do not add `lottie-web` for this.** It is a ~250KB dependency to solve a
problem animated WebP solves with zero bytes of JavaScript. (Note: Lottie
already appears in the app for animated emoji via Noto — that is a different,
bounded use. This is not a reason to route reactions through it.)

## 2. Surfaces

| Surface | File |
|---|---|
| Shared reaction component | `src/components/ReactionEmoji.jsx` |

`grep -rl 'ReactionEmoji' src --include=*.jsx` → **5 files**. Like the typing
indicator, the component already exists and is already shared, so this is small.

### The 5 consumers to verify

Run the grep at build time and check each renders correctly; they are the feed
and post-detail surfaces where reactions appear.

⚠ **The reaction must be visible to everyone, not just the sender** — that is
the stated point of the unlock ("when someone scrolls the feed, that user's
unique reaction is visible to everyone"). So the pack id must be stored **on the
reaction record**, not read from the reactor's profile at render time. Reading
the reactor's profile per reaction in a feed is a per-row Firestore read, which
is the exact cost pattern R9 forbids.

**Store `packId` on the reaction document when it is created.** It is already
being written; one more field is free.

## 3. Implementation

1. Art as animated WebP at 2 densities (`@1x`, `@2x`), same pattern as the entry
   ribbons (`scripts/build-entry-banners.mjs`).
2. `/brand/reactions/{packId}/{emojiId}.webp`. ⚠ `firebase.json`'s catch-all
   `**` rule is `no-store`; `/brand/**` already has cache headers, so keeping
   them under `/brand/` is deliberate — do not create a new top-level directory.
3. `ReactionEmoji.jsx` resolves `packId` → URL, falling back to the current
   static emoji when absent or on `onError`. No art is load-bearing.
4. ⚠ Animated WebP cannot be paused per-element. Under `prefers-reduced-motion`,
   serve a STATIC WebP of the first frame — so build both at export time.

## 4. Verification

- Total byte weight of a pack, measured, against a stated budget before it
  ships.
- A feed with 20 visible reactions: measure frame time against the same feed
  with static emoji. A number, not an impression.
- Assert `packId` comes from the reaction record, not from a profile read —
  instrument Firestore reads while scrolling a feed and assert the count does
  not scale with the number of reactions.
- Assert the static fallback renders under `prefers-reduced-motion` and on
  `onError`.
