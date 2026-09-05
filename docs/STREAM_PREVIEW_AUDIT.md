# Stream simulator — full screen audit (2026-09-01)

Every combination on `/admin/stream-preview` was opened in Chrome and **measured**,
not eyeballed: role × device × solo/co-host × grid/panel × 2/3/4 seats × live /
pre-live / ended / other. 20 states. Numbers below come from
`getBoundingClientRect()` against the phone frame, not from reading source.

Driver: the founder's broadcaster screenshot, and the fact that I had been fixing
one screen at a time. **Two of the defects below are ones already fixed on the
viewer and never carried across to the broadcaster.**

---

## NOT defects — checked so nobody has to ask again

**The grey "Rootute" text and the red/orange bar across the top of the stage are
BAKED INTO THE UPLOADED CLIP, not our UI.** Queried every DOM node whose top is
within 95px of the frame top: nothing wider than 60px exists there. They move
with the video because they are the video. No action.

---

## A. BROADCASTER — MOBILE

| # | Defect | Measured |
|---|---|---|
| A1 | **Co-host tiles are stretched to the full frame height.** | 2 seats: `177x826` = **0.215**. 3–4 seats: `177x407` = **0.436**. Reference is 2:3 = **0.667**, which the VIEWER already renders (`195x295` = 0.66). |
| A2 | **Tile name labels land inside the composer row.** | "Riven" and "nova_kill" both at `y=803`; the composer starts at `y=800`. A consequence of A1 — the tiles run to the frame bottom, so their bottom-pinned labels do too. |
| A3 | **Chat draws through the composer.** | Chat rows at `y=808`, composer band `800–842`. On the founder's screenshot this is "tomruns streaming again tomorrow" sitting under the mic button. |
| A4 | **The last chat row is cut mid-glyph at the frame edge, and the top of the list has no fade.** | The only `overflow:hidden` ancestor of a chat row is the FRAME itself (`y 0 → 852`). The list has no bounded, masked container of its own. |
| A5 | **`30vh` is 30% of the ADMIN'S BROWSER WINDOW, not of the phone frame.** | Frame is a fixed `393x852`; browser viewport was `915` tall, so `30vh` = 274px instead of 255px. Resizing the browser changes the layout of a screenshot tool. Three sites: `PreviewBroadcasterScreen:164`, `:200`, `PreviewMobileViewer:154`, `:187–190`. |
| A6 | **The live header has no stream title.** | Pre-live shows "Ranked grind, road to Diamond"; live shows the LIVE pill, the timer, then ~180px of nothing before the viewer count. |
| A7 | **No mic level meter while live.** | `AudioMeter` renders in pre-live only. A broadcaster's most-wanted live readout is "is my mic being heard". |

### A3/A4 root cause (one line, two screens)

`previewChrome.jsx:224` — `height: height || (overlay ? '30vh' : '100%')`.

In overlay mode `PreviewChat` claims `30vh` for the message list, and then renders
the composer **underneath it, inside the same box**. The broadcaster wraps that in
another `height:'30vh'` div, so parent height == child height and the composer has
nowhere to go: it is pushed past the container's bottom edge and lands on top of
the chat's own last rows. `PreviewMobileViewer.jsx:147` has a comment saying
exactly this must not happen, and it is happening.

---

## B. BROADCASTER — DESKTOP

| # | Defect | Measured |
|---|---|---|
| B1 | **The chat panel is not bounded — it is 1,133px taller than the frame.** | Scroller runs `y=67 → 1753` inside a `620`-tall frame. The composer exists in the DOM but sits ~1,100px below the visible area, so the desktop broadcaster appears to have no way to type, and the last visible row is sliced by the frame edge. |
| B2 | **The tip goal bar is drawn over the bottom of both video tiles** rather than below them. | Overlays the lower ~40px of a `301x415` tile. |
| B3 | **The LIVE pill and timer overlap the top edge of the left tile.** | Header is absolutely positioned over the grid instead of above it. |

---

## C. VIEWER — MOBILE

| # | Defect | Measured |
|---|---|---|
| C1 | **Immersive: chat draws through the composer** — same A3 root cause, via `PreviewMobileViewer`'s own `30vh` box. | Rows at `y=808`, band top `738`. |
| C2 | **The panel host tile changes shape with the guest count.** | 2 guests: `393x295` (**1.333**). 4 guests: `393x590` (**0.667**). At 2 the host is a letterbox with a large dead band under it. |

Co-host grid on the viewer is correct and stays: `195x295` (0.66) at every seat
count, panel guests `126x157` (0.8 = 4:5), guest column 32% of the width — all
matching the TikTok measurements in `docs/COHOST_LAYOUT_PLAN.md`.

---

## D. SHARED SCREENS

| # | Defect | Measured |
|---|---|---|
| D1 | **Stream Ended draws coins with the Material `paid` glyph and a bullet** — `paid | ● 2450`. | `fontFamily: "Material Symbols Outlined"`, zero `<img>` on the screen. Rule 6 of the guard exists to stop exactly this and **missed it**, because the icon is passed as data (`icon: 'paid'` in a `cells` array) rather than as a literal `name="paid"`. |
| D2 | **Ended and Co-Stream-Setup are byte-identical for broadcaster and viewer.** | A VIEWER is shown *"Great stream! Here is your summary."* with DURATION / PEAK VIEWERS / **NEW FOLLOWERS** / **TIPS EARNED**. Those are the broadcaster's numbers and a viewer must never see them. |

---

## The class, and the guard that has to encode it

Three of these (A1, A3, C1) are **fixes that landed on one screen and were never
carried to its sibling**. That is the same failure as the avatar orbit, the PiP
video, the reactions and the combo meter. Counting screens by hand does not work.

New guard rules to add with the fixes:

1. No `vh` unit anywhere under `streamPreview/` — the frame is a fixed pixel box,
   so a viewport unit is always wrong there.
2. A surface that renders a chat overlay must bound it: an `overflow:hidden`
   ancestor that is NOT the frame.
3. Rule 6 must resolve icon names passed as data, not only literal props.
4. Co-host tile geometry must come from one shared helper, so the broadcaster
   cannot render a different aspect from the viewer.

---

## STATUS: ALL FIXED, MEASURED AGAIN ON THE LIVE SITE (2026-09-01)

| # | Fix |
|---|---|
| A1 | Broadcaster grid routed through the shared `stageAspect()`. Tiles measure **0.66** at every seat count (were 0.215 / 0.436). |
| A2 | Gone with A1 — and the PANEL host label moved to the top, because that tile IS the screen and a bottom-pinned name lands in the composer. |
| A3/A4 | `PreviewChat` no longer names its own height. Mobile co-host is now a real COLUMN (header / grid / rail / goal / chat / composer) instead of absolute overlays. |
| A5 | Every `vh` under `streamPreview/` is gone. |
| A6 | Live header carries the stream title, truncating. |
| A7 | Live mic meter beside the clock. |
| B1 | Desktop chat bounded — composer visible. |
| C1 | Mobile viewer chat clipped and absolutely filled. |
| C2 | `PANEL_ASPECT` — the panel host holds **0.667** at every guest count (was 1.333 at two). |
| D1 | `<CoinIcon>` on Stream Ended. |
| D2 | A viewer gets their own ending screen. |

### Two I listed and then judged NOT defects, having looked again

**B2 (tip goal over the tiles) and B3 (LIVE pill over the left tile) stay.** Both
are standard broadcaster overlays — the mobile viewer draws its goal on the video
too, and every streaming tool puts LIVE + elapsed time on the preview. Changing
them would be redesigning something nobody objected to. Recorded here so the
question does not get re-opened from the list above.

### Verified after the fixes, all 20 states

- **Zero** text overlapping any composer input, on any surface.
- **Zero** text sliced by the frame edge.
- **Zero** buttons overlapping a tile name label.
- Chat rows and the composer both visible on every live surface, broadcaster and viewer, mobile and desktop.
- Tile aspects: grid **0.66** everywhere, panel guests **0.80** (4:5), panel host **0.667**.

### Four defects found while fixing these, each worth its own line

1. **A splice dropped `messages={messages}` and the build was green.** The whole
   admin route went to the ErrorBoundary. Guard rule 24 + an empty-array default.
2. **`30%` was a worse substitute for `30vh` than leaving it alone.** The parent
   was `bottom: 10` with an AUTO height, so the percentage resolved to nothing and
   the chat collapsed to 50px with rows at y=-478. A percentage is only definite
   if its parent height is.
3. **`flex: 1` in a BLOCK parent is ignored silently.** The desktop chat column
   measured 20px and every row sat 1,285px above the frame — the panel looked
   empty rather than broken.
4. **`` in a generated regex became a literal BACKSPACE character**, so two new
   guard rules matched nothing and reported green. Third time this session; the
   fix is an explicit character class, which has no escape to lose.

Guard is **495 assertions**, negative-tested both directions on the vh rule and
the chat-bound rule.
