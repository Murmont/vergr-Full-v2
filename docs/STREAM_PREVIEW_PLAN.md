# Stream Preview simulator — plan

Written 2026-08-31, after the founder asked for a plan document three times and
got a chat message three times. This file is the plan; chat is not.

---

## 1. Why this exists

**To screenshot every stream surface without going live.** That is the whole
requirement and it is the test for every decision below. Vergr has no real
users, no second account to stream from, and no way to stage a real broadcast on
demand, so the alternative to this tool is not "worse screenshots" — it is no
screenshots at all.

Two consequences fall straight out of that purpose and were both missed on the
first pass:

- **A surface nobody can screenshot is not covered**, however well the live
  surfaces work. Go Live and Stream Ending were left out entirely because the
  build started from "which preview files exist" instead of from "which screens
  does a stream pass through".
- **A screenshot that does not match the product is worse than none**, because it
  gets used. The first pass drew the dock with Material glyphs when the shipped
  dock renders five `.webp` assets, so the preview showed icons that appear
  nowhere in Vergr.

## 2. What the simulator is, and is not

| | |
|---|---|
| IS | a copy of the shipped design, driven by fake state, that can be fired at |
| IS NOT | a second implementation of streaming |

⚠ **NOTHING HERE MAY TOUCH PRODUCTION BEHAVIOUR.** No Firestore, no relay
socket, no callable, no camera, no wallet. Founder instruction, and it is also
what keeps the tool cheap to maintain.

⚠ **IMPORT WHAT IS PURE, COPY WHAT IS NOT.** A component that takes props and
nothing else is imported: that is read-only, changes no production file, and
unlike a copy it cannot drift. A component that reaches for a socket or a
Firestore document is copied, and the copy records the file and line it came
from. The entry ribbon in particular must be imported, because it draws the
founder's real banner art and the point of the tool is to trust the capture.

| Imported (pure) | Copied (has a data dependency) |
|---|---|
| `JoinAnnouncer` | chat rows (`ChatPanel` overlay + side) |
| `StreamGoalBar` | `TipModal` |
| `TipAlertOverlay` | `UserQuickSheet` |
| `SubAlertOverlay` | the broadcaster dock |

## 3. Surface inventory

Taken from `src/screens/streams/` and `src/components/streams/` on disk, not
from memory. **This section is the coverage contract**: a surface is either
listed as done or listed as a gap, and there is no third state.

### 3.1 Screens a stream passes through

| # | Surface | Real source | State |
|---|---|---|---|
| 1 | Go Live setup | `GoLiveSetupScreen.jsx` | ✅ incl. follower-gated state |
| 2 | Go Live setup, native | `native/NativeGoLiveScreen.jsx` | ✅ incl. gate meter |
| 3 | Broadcaster live, desktop | `BroadcasterScreen.jsx` | ✅ |
| 4 | Broadcaster pre-live | `BroadcasterScreen.jsx` (`live=false`) | ✅ |
| 5 | Broadcaster, mobile | `native/NativeBroadcasterScreen.jsx` | ✅ |
| 6 | Viewer, mobile immersive | `MobileLiveViewer.jsx` | ✅ |
| 7 | Viewer, mobile split | `MobileLiveViewer.jsx` (`useSplit`) | ✅ |
| 8 | Viewer, mobile landscape | `MobileLiveViewer.jsx` | ✅ |
| 9 | Viewer, desktop | `ViewerStreamScreen.jsx` | ✅ |
| 10 | Co-host stage, 2/3/4 guests | `CoHostStage.jsx` | ✅ |
| 11 | Co-host invite / setup | `CoStreamingScreen.jsx` | ✅ |
| 12 | **Stream ending** | `StreamEndingScreen.jsx` | ✅ |
| 13 | Stream analytics | `StreamAnalyticsScreen.jsx` | ✅ populated |
| 14 | Stream moderation | `StreamModerationScreen.jsx` | ✅ populated |
| 15 | Squad stream | `SquadStreamScreen.jsx` | ✅ |

### 3.2 Overlays fired over a live stream

| Overlay | Real source | State |
|---|---|---|
| Entry ribbon | `JoinAnnouncer.jsx` | ✅ imported, fireable, per-rank |
| Tip alert | `StreamGoalAndAlerts.jsx` | ✅ imported, fireable |
| Sub alert | `StreamGoalAndAlerts.jsx` | ✅ imported, fireable |
| Tip goal | `StreamGoalAndAlerts.jsx` | ✅ imported, adjustable |
| Live chat | `ChatPanel.jsx` | ✅ copied, rolling, rate-controlled |
| Poll | `StreamPoll.jsx` | ✅ imported, fireable |
| Reactions floor | `ReactionsFloor.jsx` | ✅ imported, fireable |
| Now playing | `NowPlayingCard.jsx` | ✅ imported, toggleable |
| Boost timer | `BoostStreamSheet.jsx` | ✅ imported, fireable |
| Vergr.me banner | `VergrMeStreamBanner.jsx` | ✅ imported |

### 3.3 Sheets

| Sheet | Real source | State |
|---|---|---|
| Tip / gift (with Boost tab) | `MobileLiveViewer.jsx:1518` | ✅ copied, openable |
| Profile quick sheet | `UserQuickSheet.jsx` | ✅ copied, openable |
| Share | `StreamShareSheet.jsx` | ✅ copied |
| Boost | `boost/BoostSheet.jsx` | ✅ copied, prices read from utils/boosts.js |
| Top gifters | `MobileLiveViewer` `GiftersSheet` | ✅ copied |
| "…" more sheet | `MobileLiveViewer` | ✅ copied |

## 4. Build order

Ordered by how badly a screenshot is needed, not by ease.

1. ~~Stream ending (#12)~~ — done 2026-08-31.
2. ~~Go Live setup, web + native (#1, #2)~~ — done 2026-08-31.
3. ~~Share sheet + top gifters + "…"~~ — done 2026-08-31.
4. ~~Poll, reactions, boost timer, now playing~~ — done 2026-08-31. All four
   were prop-only, so they are imported rather than copied.
5. ~~Co-host invite, analytics, moderation, squad stream~~ — done 2026-08-31.

**§3 has no gaps left.** Everything a stream passes through, every overlay and
every sheet is capturable without going live.

## 5. The fidelity checklist

⚠ **THIS IS THE STEP THE FIRST PLAN DID NOT HAVE, AND ITS ABSENCE IS WHY THE
DOCK SHIPPED WITH THE WRONG ICONS.** The first plan covered plumbing — which
files, which components, what order — and nothing in it asked whether what a
surface DRAWS matches what ships. A wiring plan produces a correctly wired thing
that looks wrong.

Before any surface is called done:

1. **Asset diff.** The `assets/` import list in the preview must match the real
   screen's. Mechanical and repeatable:
   ```
   diff <(grep -oE "assets/stream/[a-z-]+\.webp" src/components/streams/MobileLiveViewer.jsx | sort -u) \
        <(grep -oE "assets/stream/[a-z-]+\.webp" src/screens/admin/streamPreview/PreviewMobileViewer.jsx | sort -u)
   ```
   ⚠ Do NOT grep the built bundle for asset names. The first attempt at this
   searched for `send` and `like`, which match ordinary words in any JavaScript,
   and reported success for assets it had not checked.
2. **Component diff.** Every icon, badge and pill in the copy exists in the
   original. No Material glyph may stand in for an image asset.
3. **Prop-shape check.** A copied component that takes an object must be given
   the shape the original reads. `JoinRibbon` reads `ev.user` / `ev.kind` /
   `ev.level` / `ev.rankId`; a flat `{name, avatar}` does not throw, it renders
   an empty ribbon with a fallback banner — a silent lie about the exact thing
   being previewed.
4. **Copy-site comment.** Each copied block names the file and line it came
   from, so a future edit can diff it.
5. **Name and trademark sweep.** See §6.

## 6. The copy on this screen is shipped

Play store screenshots are captured here, so everything visible is published
material. Already found and removed once:

- `navi`, `NiKo`, `Zonic`, `Ilja` — real players and teams, in the desktop
  preview's chat.
- `ZERO_taeyeon` — references a real performer. It came from the original
  fixtures and was carried into the new cast before being noticed.
- `Counter-Strike` — as the game-name fallback and in the About card.
- "6.5M followers" — puffery about platform scale on a platform with ~2 real
  accounts.

⚠ Invented handles and an invented game title (`Nightfall Protocol`) are the
rule, not a preference. A real handle is impersonation and a real title is a
trademark on a listing we have no licence for.

## 7. Known gaps that are not code

- **The backdrop is a gradient.** It will read as a mockup in any screenshot.
  Drop a real frame at `public/brand/live/preview-scene.webp` (9:16) or
  `preview-scene-wide.webp` (16:9) and it is used automatically, no code change.
- **Avatars are empty circles.** There are no user photos to draw.
- **Nobody has looked at this screen.** `/admin/*` is auth-gated, so it cannot
  be screenshotted from a headless browser or the in-app browser. Every claim of
  "done" here is structural — lint, build, asset diff, live chunk — and none of
  it is visual. That is a real limit on the confidence of this document.

## 8. Production changes made from this work

Kept separate because they leave the simulator and affect real streams.

| Change | File | Why |
|---|---|---|
| Entry ribbon narrowed, `min(280, 70vw)` → `min(224, 54vw)` | `JoinAnnouncer.jsx` | Founder: it took up half the screen and did not look professional next to TikTok's. It was 262px on a 375px phone, i.e. 70% of the width. |

⚠ The ribbon's art and name follow the width automatically — the banner is
`object-fit: cover` at a fixed 4:1, and `nameSizeFor()` MEASURES the string
against the width it is handed rather than scaling by a constant — so narrowing
cannot truncate a name. That measurement is the fix that took three attempts
originally; do not replace it with a constant.

## 9. Open defects found while building this

Not caused by this work, not fixed by it.

- **`TipModal` is duplicated**, defined separately in `MobileLiveViewer.jsx:1518`
  and `ViewerStreamScreen.jsx:1459`, neither exported. Two copies of the tip
  sheet are free to drift apart.
- **`TipModal` and `SubAlertOverlay` render in Inter**, which is not a Vergr font
  and is not loaded, so they fall back to system-ui while everything around them
  is DM Sans. Likely part of why the subscribe alert looks wrong.
- **The one-coin dock send has never been exercised** against a real broadcast.

## 10. Responsiveness and capture (founder, 2026-08-31)

### 10.1 The chat/composer overlap — a real defect, now fixed

The newest chat message sat **under** the composer on the viewer, and it was not
a cosmetic squeeze: it made every viewer capture taken before 2026-08-31 subtly
wrong.

Cause: in the real viewer the composer lives INSIDE `ChatPanel`, inside a single
`height: CHAT_FEED_HEIGHT` box (`MobileLiveViewer.jsx:1096`), so the feed and the
input share that 30vh. The preview gave the **feed** 30vh and then placed the
composer beneath it, so the two together overflowed the dock.

⚠ **THE FEED MUST FLEX INSIDE THE BOX, NEVER OWN THE BOX.** One 30vh container,
feed `flex: 1, minHeight: 0`, composer at natural height and `flexShrink: 0`.

This is the class of bug the fidelity checklist in §5 does not catch, because
every asset and every prop was right — only the box model was wrong. §5 checks
*what is drawn*; it does not check *how it is laid out*. See 10.4.

### 10.2 Real device sizes, not invented ones

The frame was a fixed 402x770, which is no real phone. A capture at 402x874 and
one at 390x844 lay out differently — the 30vh chat, the safe-area inset and every
`clamp()` all move — so an invented size produces a screenshot of a device nobody
owns.

`DEVICES` in `AdminStreamPreviewScreen.jsx` carries real CSS-pixel viewports:
iPhone 15 Pro (393x852), 15 Pro Max (430x932), iPhone SE (375x667), Pixel 8
(412x915), Galaxy S24 (360x780), iPad mini (744x1133). Landscape swaps the
chosen device's own axes rather than using a separate fixed size.

⚠ iPhone SE at 375x667 is the shortest and is the one that will break first. Any
layout that only works on a 15 Pro is not finished.

### 10.3 No drawn phone frame

Founder: captures get composited into a real device frame afterwards, the way
`/platform` does its hero art. A bezel drawn here would end up nested inside a
second bezel. The stage is now a clean rectangle at true device pixels, no
radius, no border.

### 10.4 What §5 does not cover

The fidelity checklist verifies assets, components and prop shapes — *what is
drawn*. It does not verify *layout*, which is how the chat/composer overlap got
through with every asset and prop correct.

Before calling a surface done, additionally:

1. Render it at the **shortest** device in `DEVICES` (iPhone SE, 375x667), not
   the largest. Overflow shows up there first.
2. Check nothing in a fixed-height dock overlaps: the feed, the composer, the
   like button and the goal all share that space.
3. Compare the box model against the real screen, not just the elements. A
   fixed height on the wrong element is invisible to an asset diff.

## 11. Nothing renders empty (founder, 2026-08-31)

**The rail exists to POPULATE, not only to fire events.** Anything that would
draw as a hole — an avatar, a backdrop, an analytics chart — has content by
default, because a capture with holes in it is unusable.

⚠ **REPRODUCING AN EMPTY STATE WAS THE WRONG CALL.** Analytics and moderation
were first copied faithfully as the empty states they are in the product ("No
stream data yet"), on the reasoning that the tool must show what ships. That
reasoning is right for LAYOUT and wrong for DATA: those screens are empty
because the account has never streamed, not because the feature is empty. Both
are now populated, and analytics reads its headline numbers off the same `doc`
the live phase uses, so a capture of the stream and a capture of its analytics
agree with each other.

⚠ **UPLOADS ARE THE MECHANISM. GENERATORS ARE ONLY THE FALLBACK.** The rail
carries a file picker per cast member and one for the streamer's video, and
that is how real content gets in. The first build shipped generated identicons
and a drawn backdrop INSTEAD of upload controls, which is the opposite of what
was asked for: a generator can never produce the founder's own art, so a capture
made with it is still a mock-up. What the generators are for is the state
BEFORE anything is uploaded, so no surface is ever a grey disc or a flat panel.

| Upload | Rail panel | Reaches |
|---|---|---|
| Per-person avatar | Avatars | chat rows (overlay, docked, split, landscape), supporters cluster, profile sheet, gifters board, squad grid, moderation queue, entrance ribbon |
| Streamer video | Streamer video | mobile viewer stage, desktop stage, broadcaster stage, split + landscape stages. Muted, looping, object-fit cover |

⚠ **BOTH LIVE IN `simProps`, NEVER ON ONE SCREEN.** A face uploaded for Riven has
to appear on every surface Riven appears on. The first pass threaded them into
`PreviewMobileViewer` alone, so the desktop viewer, the broadcaster and both solo
views kept drawing identicons beside a mobile capture that showed the real face.
Two captures of the same fictional person that do not match are worse than two
that are both placeholder.

⚠ **`SoloChatRow` HAD `src={null}` HARDCODED.** Every row in the split and
landscape views drew an empty disc, and an uploaded face was discarded silently.
It reads like the upload feature is broken on those two surfaces specifically,
which is the most expensive kind of defect to diagnose from a screenshot.

⚠ **EVERY UPLOAD IS A BLOB URL, LOCAL TO THE TAB.** Nothing is sent anywhere,
nothing is persisted, and the hook revokes on replace, on clear and on unmount.
Reloading the tab clears them, which is intended: this is a capture tool, not an
asset library. Creating the URL happens in the change handler, never in a render
body. [[reference-object-url-in-render]]

⚠ **AVATAR FALLBACK IS A DETERMINISTIC IDENTICON, NEVER A FACE.**
`previewFaces.js` draws a two-stop gradient plus an initial as an inline SVG data
URI, keyed on uid so a person keeps the same face between renders. Not a real
photo (a likeness we have no release for), not a generated face (still a claim
about a user who does not exist), no network request, no file to ship.

⚠ **BACKDROP FALLBACK IS DRAWN, NOT A GRADIENT.** `SceneFallback` renders either
a gameplay scene or a lit streamer room with a rim-lit silhouette, selectable
from the Content panel. Deliberately not a face, for the same reason as above. A
still frame at `public/brand/live/preview-scene.webp` (9:16) or
`preview-scene-wide.webp` (16:9) also takes over with no code change; an
uploaded video outranks both.

### 11.1 Placement is a decision, not a dumping ground

⚠ **THE BOOST COUNTDOWN WAS PUT IN THE HEADER ROW AND SQUASHED IT.** On a 375px
screen that row already carries the host card, the supporters cluster, the
viewer pill and two icon buttons; adding a countdown crushed all of them. A
running boost is STATUS, not a control, and every live platform puts status on
its own line under the top bar — which is where it now sits, alongside Now
Playing.

`BoostTimer` has no shipped placement to copy: it is imported by both real
viewers and rendered by neither. That made its position a judgement call, and a
judgement call is exactly the thing that must not be resolved by appending to
whichever row is nearest.

**Before adding any element to a surface: decide where it belongs in the
hierarchy, then check the row it lands in at the SHORTEST device (375x667).**
