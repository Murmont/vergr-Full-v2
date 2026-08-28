# 07 — Golden Thread

**STATUS: SHIPPED + DEPLOYED + VERIFIED LIVE ON TWO ACCOUNTS (2026-08-26).**
`golden_thread` at **L72** (Legend is 71-80, so Legend LV2 = 72). Rules: [00-RULES.md](00-RULES.md)

---

## 1. What it is

A VIP's messages in a fast-moving live chat are visually linked by a curve that
follows them as they scroll, so the streamer can track that person's thread
without losing it in the flow.

## 2. Research

Sources: [Josh Comeau — How to update SVG bezier curves on scroll](https://www.joshwcomeau.com/animation/dynamic-bezier-curves/),
[WICG — Idea: ClientRectObserver](https://discourse.wicg.io/t/idea-clientrectobserver/6095/)

### ⚠ Trap 1: `getBoundingClientRect()` per scroll event is the documented cost

Stated plainly in the source: calling it on every scroll event is the expensive
part of this effect; browsers recalculate bounds on every call. **Live stream
chat scrolls continuously**, so a naive implementation forces layout on every
frame of the busiest surface in the application.

### ⚠ Trap 2: `ResizeObserver` does NOT solve it

`ResizeObserver` reports **size** changes only. There is **no position
observer** — this is an acknowledged platform gap, which is why the WICG thread
above exists proposing one. Scroll handling is unavoidable; it can only be made
cheap.

### The correct construction

- ONE batched read of all tracked rects inside a single `requestAnimationFrame`
  callback. Never per element, never per event.
- A hard cap on tracked nodes (the newest N messages from that user).
- `IntersectionObserver` to drop nodes that have left the viewport, so the path
  only ever spans what is on screen.
- The path itself is a `<path>` with cubic béziers connecting the left edge of
  each tracked node, in one `<svg>` overlay positioned over the chat container.

## 3. Surface — exactly one

| Surface | File |
|---|---|
| Live stream chat | `src/components/streams/ChatPanel.jsx` (781 lines) |

That is the whole inventory. It must NOT be added to DMs or squad chat: the
effect solves "I am losing this person in a fast flow", which is a live-chat
problem. A thread in a 1:1 DM is decoration with a performance cost.

## 4. Implementation, in order

**Phase A — the harness FIRST, before any product code.**
A scratch page that renders a synthetic chat scrolling at a realistic live-chat
rate with a realistic message count, with the thread attached. Measure frame
time with and without. If it cannot hold frame budget in the harness, it will
not hold it on a real stream, and the effect should be abandoned rather than
shipped degraded.

**Phase B — the component.**
`src/components/effects/visual/GoldenThread.jsx`, taking the chat container ref
and the tracked uid. Renders `null` when disabled (R-6: zero cost when off).

**Phase C — wire into `ChatPanel` only.**

## 5. Verification — stricter than any other effect

- Frame time in the harness, thread on vs off, at a realistic scroll rate. A
  measured number, recorded in this document when it exists.
- Assert exactly ONE `rAF` loop exists regardless of tracked node count.
- Assert `getBoundingClientRect` call count per frame is bounded by the node cap
  (instrument by wrapping it during the test).
- Assert tracked nodes drop to zero when the chat is scrolled away.
- Assert `prefers-reduced-motion` renders the path statically without animating.

## 6. Why last

Every other effect on the ladder is cosmetic and self-contained: if it is wrong,
something looks bad. This one runs continuous work on the surface that carries
live chat during a broadcast. If it is wrong, the product degrades while a
creator is live in front of an audience.

---

## 7. ⚠ THE MULTI-USER PROBLEM — researched 2026-08-26, DESIGN DECIDED

Founder, 2026-08-26: *"still not actually sure how this will be done in a live
stream chat without looking messy or getting confusing with multiple users who
have unlocked it."*

**He is right, and §1-§6 never addressed it.** The whole doc says "the tracked
uid", singular, and never asks who chooses it or what happens when ten Legends
are in one chat. That is the actual design risk, and it is bigger than the
frame-budget risk everything above worries about.

### What the industry actually does

Source: [Twitch — chat highlights and cues](https://blog.twitch.tv/en/2022/09/29/identify-quicker-and-engage-smarter-with-chat-highlights-and-cues/),
[Streamlabs chat highlight widget](https://streamlabs.com/stream-widgets/chat-highlight)

Twitch ships highlights for mods, subs, mentions and VIPs, and states plainly
that they **"will never be visible to other viewers, giving you control of your
chat experience."** The highlight is a property of the READER's client, not a
decoration broadcast to everyone.

⚠ **AND NOBODY DRAWS CONNECTING CURVES IN LIVE CHAT.** Every shipped product
solves "find this person in the flow" with a background tint, a badge, a name
colour or a pin. Not one links messages with a path. That is worth taking
seriously: it is either genuinely novel or a known-bad idea, and novel on the
busiest realtime surface in the product is exactly what §6 says to fear.

### The decision

**ONE thread renders at a time, and it renders in the BROADCASTER's chat only.**

This is not a tuning choice, it removes the collision by construction:

| Rule | Why |
|---|---|
| Renders on the **host's** chat panel only | §1's own stated purpose is *"so the streamer can track that person's thread"*. It was never a viewer-facing decoration. Matches Twitch: not visible to other viewers. |
| **Exactly one** path may exist | Two curves crossing in a 360px column is the spaghetti the founder predicted. A hard cap of 1 makes it impossible rather than unlikely. |
| The host picks, or it defaults to the most recent holder who spoke | Deterministic. No arbitration between ten Legends. |
| The path lives in the **left gutter**, never across message text | A curve through the text column crosses other people's messages and makes them harder to read — it would degrade chat to decorate it. |

### ⚠ What the holder gets, and the honest tension

CLAUDE.md's rule is that an unlock only you can see is not a reward — that is the
avatar-orbit lesson. Here the inversion: the holder CANNOT see their own thread,
only the streamer can.

That is still a real reward, and arguably the most valuable one on the ladder:
**the scarce thing in a fast chat is the streamer's attention**, and this buys
exactly that. But the holder needs to know it is working, so they get a small
mark on their OWN messages on their OWN screen confirming the host is tracking
them. That mark is not the path and costs nothing.

### What this changes in §3 and §4

§3's surface inventory stands (`ChatPanel.jsx` only) but must be read as **the
host's instance of it** — `ChatPanel` renders for viewers too, and the path must
not mount there. The `iAmMod` / host check already exists in that file.

§4 Phase A still comes first, unchanged: build the harness and measure before
any product code. The cap of one path makes the budget dramatically easier than
the doc assumed — it was implicitly sized for N.

---

## 8. PHASE A RESULT — MEASURED 2026-08-26. GATE PASSED.

§4 says the harness comes first and the effect is abandoned if it cannot hold
frame budget. It holds it comfortably.

Harness: `scripts/golden-thread-preview.mjs`, running THE SHIPPING ENGINE
(`src/utils/goldenThread.js`) against a synthetic chat at ~4 messages/second,
8 speakers, 120-row prune, bottom-anchored — measured in real Chrome.

| Metric | Measured | Verdict |
|---|---|---|
| Cost of one draw, thread ON | **0.105 ms** | |
| Share of a 16.67 ms frame | **0.63 %** | comfortable |
| Cost with no uid tracked | **0.001 ms** | R-6 satisfied: ~zero when off |
| Tracked nodes | 12 | at MAX_NODES, cap holds |
| `getBoundingClientRect` per draw | **13** | exactly cap + 1 container read |

⚠ **THE rAF-BASED BENCHMARK DOES NOT WORK AND WAS REPLACED.** The first attempt
sampled frame time across rAF and simply hung: rAF is throttled to a stop in an
unfocused or background tab, so the promise never resolved and the CDP call
timed out after 45s. `drawNow()` was added to the engine and the bench measures
the cost of ONE DRAW synchronously instead.

That is also the better question. Frames-per-second depends on whatever else the
machine is doing; **cost per draw is deterministic and attributable to us.**
Anyone re-running this: use `window.cost()`, not `window.bench()`.

⚠ **A TRACKED USER'S MESSAGES ARE SPARSE ON SCREEN, and that is expected.**
At ~4 msg/s across 8 speakers, only 2-3 of the tracked user's messages are
visible at once, so the path is often a short curve joining two points rather
than a long ribbon. The design is right — the thread spans only what is on
screen, by `IntersectionObserver` — but do not expect a dramatic ribbon in a
busy chat. Its job is to draw the eye, not to decorate.

### Shape

A SPINE IN THE GUTTER, not a curve between arbitrary points: x is pinned to
`gutter`, and only a small bulge varies between rows
(`M x y0  C x+6 mid  x+6 mid  x y1`). The path therefore **cannot** wander into
the text column regardless of row layout — §7's "never across text" rule is
structural rather than a tuning choice.

## 9. Remaining: Phase B + C

- **B** `src/components/effects/visual/GoldenThread.jsx` — thin React wrapper
  over the engine, `null` when disabled.
- **C** wire into `ChatPanel.jsx` **for the host's instance only** (§7), plus
  the host's control to choose whose thread is shown, and the holder's own
  small "the host is tracking you" mark.

---

## 10. PHASE B + C SHIPPED — VERIFIED LIVE 2026-08-26

| File | Role |
|---|---|
| `src/utils/goldenThread.js` | the engine, React-free, benchmarked by the harness |
| `src/components/effects/visual/GoldenThread.jsx` | thin wrapper, renders `null` with no uid |
| `src/styles/surface.css` | `.vg-thread path` + `.vg-thread-own` |
| `src/components/streams/ChatPanel.jsx` | host-only mount, row attribute, host control, holder mark |
| `src/utils/rankUnlocks.js` | `golden_thread` row at L72 |

### Verified on a real broadcast, @vergr hosting and @Verion watching

| Assertion | Result |
|---|---|
| Rows carry the uid attribute | ✅ 5 rows, 2 distinct uids |
| Host sees the control on OTHER holders' rows only | ✅ 3 controls on Verion's rows, none on the host's own 2 |
| Control renders as a GLYPH, not literal text | ✅ `Material Symbols Outlined`, 13px |
| Clicking it draws the thread | ✅ `M 10 107 C 16 126 …`, stroke `rgb(245,200,66)` |
| Path stays in the gutter | ✅ x is 10, bulging to 16 — never near the text column |
| Holder sees their own mark | ✅ 2 on the host's messages, 3 on Verion's own screen |
| **A VIEWER NEVER SEES THE THREAD** | ✅ `svg.vg-thread` absent on Verion's watch page |
| Viewers get no host control | ✅ 0 |

⚠ **THE TEST REQUIRED TEMPORARILY DROPPING THE UNLOCK TO L1**, because no test
account is near L72 and the gate reads `m.vpLevel` off the message, not the
admin flag (admin resolves `isEffectOn`, not `isUnlocked`). Set to 1, deployed,
verified, then **restored to 72, rebuilt and redeployed** — confirmed by
`grep -c "row(1, 'golden_thread'"` returning 0. If you repeat this, restore it in
the same session; a ladder row silently left at L1 grants a Legend reward to
everybody.

⚠ **`position: relative; isolation: isolate` ON THE MESSAGE SCROLLER IS
LOAD-BEARING.** The svg is `z-index: -1`; without a stacking context on the
scroller it escapes to the nearest one and paints behind the whole panel. Squad
environments cost two rebuilds to learn exactly this.

⚠ **The first icon choice was `linked_services`, which appears NOWHERE ELSE in
the app.** An unproven Material Symbols name renders as its literal ligature
TEXT. Swapped to `link`, which is used 23 times and is therefore proven in the
bundled font. Check any new glyph the same way.

### Honest read on the visual

It is subtle — thin gold dashes in a narrow gutter. That is the right call for
something that sits on live chat during a broadcast, and it does draw the eye,
but do not expect drama. See §8 on why a tracked user's on-screen messages are
sparse in a busy chat.

---

## 11. ⛔ THE DRAWN PATH WAS REJECTED. THE REWARD IS A HIGHLIGHT. (2026-08-27)

Founder, shown the shipped path: *"that looks professional ui to you? is this
how it looks on twitch?"* No, and no. It rendered as a jagged gold squiggle in a
narrow gutter and read as a rendering artefact, not a designed element.

⚠ **THE RESEARCH IN §7 ALREADY SAID THIS AND IT WAS NOT ACTED ON.** That section,
written the day before, records: *"nobody draws connecting curves in live chat.
Every shipped product solves 'find this person in the flow' with a background
tint, a badge, a name colour or a pin. Not one links messages with a path."*
The finding was correct, was written down, and was then overridden by §1's word
"curve". **Doing the research and not letting it change the build is the same as
not doing it.**

⚠ **AND THE HOUSE PATTERN WAS IN THE SAME FILE.** `ChatPanel` already highlights
a tip with `borderLeft: 3px solid amber` plus a tinted background — which is
also exactly what a Twitch highlighted message looks like. The answer was
fifteen lines above where the path was being mounted.

### What ships instead

The followed viewer's rows get a **tint + accent bar**, constructed identically
to the tip highlight beside it:

```
background:  rgba(245,200,66,0.10)   (overlay: rgba(120,95,0,0.50))
borderLeft:  3px solid #F5C842
```

⚠ Ranked BELOW `m.flagged` in that ternary on purpose: a moderation signal must
never be hidden by a cosmetic one.

Verified live 2026-08-27, @vergr hosting and @Verion watching: all three of the
followed viewer's rows carried `rgba(245,200,66,0.1)` and a `2.4px rgb(245,200,66)`
left border, and `svg.vg-thread` was absent.

### What this deletes

Everything §2 and §8 worried about. There is **no rAF loop, no
`getBoundingClientRect`, no `IntersectionObserver`, no node cap** — the cost is
a CSS property on rows that were rendering anyway. The Phase A budget question
is moot rather than answered.

`src/utils/goldenThread.js`, `src/components/effects/visual/GoldenThread.jsx`
and `scripts/golden-thread-preview.mjs` are kept on disk under the no-deletion
rule and are headed **NOT USED BY THE APP**. `REWARD_OWNERS` now points
`golden_thread` at `ChatPanel.jsx`, because pointing it at the dead engine would
let the guard pass while nothing implemented the reward.

⚠ Do not wire the path back in without a design that has been LOOKED AT first.
