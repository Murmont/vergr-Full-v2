# Co-host layout — measured cause, researched answer, decisions made

No open questions. Squad voice is not in scope and is not mentioned again: it is
a different product surface and has nothing to do with a live stream.

---

## 1. The gap — measured at 366x786, not guessed

| | measured |
|---|---|
| video region | **346px — hardcoded `flex: 0 0 44%`** |
| one tile | **181 x 171, aspect 1.06** |
| dead band under the grid | **36px** |
| grid height if cells were 16:9 | **207px** |

**Fault A.** `44%` is a percentage of SCREEN HEIGHT. Nothing about a video grid
is that. It yields a 1.06:1 cell — a shape no camera produces — and the cell
changes shape with the phone.

**Fault B.** The chat is `justify-content: flex-end` rendering exactly
`slice(-4)`. Four messages are 250px in a 314px box, so 64px of slack collects at
the TOP of the chat panel, directly under the grid. That is the visible gap.

⚠ **Fixing A alone makes it worse:** correct 16:9 cells drop the region to 207px
and the gap grows by 139px. They must be fixed together, and neither is fixed by
moving anything.

---

## 2. What TikTok actually does (researched, sources at the bottom)

- **Up to 9 guests.**
- **Two layout settings, host-selectable, changeable before or during the LIVE:**
  - **Panel** — the host stays on the main screen, guests sit secondary. TikTok
    recommends it for one-on-one **and for guest audio chatting**.
  - **Grid** — equal exposure for everyone. Recommended for performances and
    gameplay.
- **Fixed vs adaptive.** A fixed layout stays the same regardless of participant
  count; otherwise the layout adapts automatically to the number of
  participants.
- Newer named layouts exist (Roundtable, Side by side) up to 9 boxes.

### ⚠ The thing this changes about our design

I had been treating "what if someone has no camera" as a problem to auto-detect
and reflow around. **TikTok does not solve it that way.** Audio guests are what
**Panel** layout is FOR. The host picks the mode; the product does not try to
guess. Seats are boxes that guests move up and down between, so a quiet guest
does not silently restructure everyone else's screen mid-stream.

That is a better answer than auto-collapsing, because a grid that reshuffles
every time somebody's camera drops is unusable for the host and disorienting for
viewers.

---

## 3. Decisions

### 3.1 Cell shape is fixed; the video covers it. Both aspect ratios, always.

A co-host stream mixes a desktop/OBS publisher (16:9) with a phone publisher
(9:16) in the same room. Picking one is wrong by construction.

**The CELL has a shape. Every publisher's video fills it with `object-fit:
cover`, whatever they are sending.** 16:9 gets cropped left and right, 9:16 gets
cropped top and bottom, and neither ever letterboxes into black bars. This is
what the existing `Tile` already does for video; the bug was only that the cell
shape came from a screen-height percentage instead of a defined aspect.

Cell aspect per layout:
- **Grid, 2 cells:** each 3:4 (portrait-ish, side by side reads as two people)
- **Grid, 3-4 cells:** each 1:1 — a square cell is the honest neutral between a
  16:9 and a 9:16 source, cropping both symmetrically
- **Panel:** host cell 16:9, guest strip cells 1:1

Region height then falls out of the cells, and no percentage of viewport height
appears anywhere.

### 3.2 Two layouts, matching the reference

- **Grid** — equal cells, 2 / 3 (big-left + two stacked) / 4 (2x2). This is what
  exists today; it keeps its shapes.
- **Panel** — host at full width, guests in a small strip along the bottom edge
  of the host cell. This is the audio-chat and one-on-one mode and we do not
  have it at all.

Host-selectable, exposed in the preview rail so both are capturable.

### 3.3 Camera-off keeps its seat

A guest with the camera off keeps their box and shows their avatar centred on it
with their name, not a `videocam` glyph and not a collapsed grid. The seat model
is what TikTok uses and it avoids the mid-stream reshuffle.

### 3.4 The chat can never sit in a hole

- Render **more messages than fit** rather than `slice(-4)`. The panel already
  has a top fade mask whose entire purpose is to cut off an overflowing list;
  rendering exactly four gives the mask nothing to fade and the slack shows.
- Keep `justify-content: flex-end` — newest at the bottom is right.

With the region sized from its cells and the chat overflowing, there is no
arrangement of heights where an empty band can appear. It is fixed by
construction rather than by tuning a number.

---

## 4. Scope

Co-host **viewer** mobile and co-host **broadcaster** mobile — both carry the
same `flex: 0 0 44%` and the same `slice(-4)`. Desktop co-host uses a different
structure and is untouched.

## Sources

- https://tiktok.newhopeuk.co.uk/tiktok-how-to-manage-your-multi-guest-layout-settings/
- https://www.tiktok.com/live/creators/en-US/article/Multi-guest_Introduction_en-US
- https://blog.push.fm/10071/tiktok-live-multi-guest-get-started/
