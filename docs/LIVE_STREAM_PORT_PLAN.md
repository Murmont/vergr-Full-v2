# Live stream: preview to production port plan

Written 2026-09-04, after the preview audit closed its state pass. This is the
execution document for moving the rebuilt `/admin/stream-preview` design onto the
real stream screens.

**The standard this document is held to** (founder, 2026-09-04): *"the doc needs to
be so detailed, researched!, and perfect that when it is complete it will be perfect
and ready for the port with 100% certainty, no doubts no ifs or buts or maybes. I
will not accept any reason for needing to go back and fix something you missed."*

So every claim below was checked against the source on 2026-09-04 and carries the
file and line where it was checked. Nothing here is inherited from CLAUDE.md,
memory, or an earlier session without re-verification. Where an earlier claim of
mine turned out to be wrong, the correction is stated in place rather than quietly
fixed.

---

## 0. THE ONE THING THAT MAKES THIS PORT DANGEROUS

**The preview is not a copy of the real screens, and the real screens are not a
subset of the preview. Each has things the other does not.** A port that treats
this as "replace the old screen with the new one" deletes shipped, working
features. The founder said this explicitly on 2026-09-04:

> *"the go live in the preview doesn't have all the stuff that the real screen has,
> so we cant just go and delete the real screen and replace it with the preview"*

Section 4 and section 5 are the two directions of that delta. **Read both before
touching a file.**

---

## 1. The port surface, verified

`AppRouter.jsx:1047-1060`. Note the third column: it decides how many times each
change has to be made.

| Route | Web implementation | Native implementation | Shared? |
|---|---|---|---|
| `/go-live` | `GoLiveSetupScreen.jsx` (1611 lines) | `native/NativeGoLiveScreen.jsx` (696) | **NO. Two separate implementations.** |
| `/broadcast/:streamId` | `BroadcasterScreen.jsx` (1408) | `native/NativeBroadcasterScreen.jsx` (701) | **NO. Two separate implementations.** |
| `/watch/:streamId` | `ViewerStreamScreen.jsx` (1573), which delegates mobile to `components/streams/MobileLiveViewer.jsx` (1583) | `native/NativeViewerStreamScreen.jsx` (7 lines) | **YES.** The native file is a bare `export { default } from MobileLiveViewer`. |
| `/go-live/co-stream` | `CoStreamingScreen.jsx` (429) | `NativeStreamScreens.jsx:91` | NO |
| `/co-stream/invite/:inviteId` | `CoStreamInviteScreen.jsx` (131) | `NativeStreamScreens.jsx:290` | NO |
| `/stream/ended` | `StreamEndingScreen.jsx` (126) | `NativeStreamScreens.jsx:369` | NO |
| `/stream/analytics` | `StreamAnalyticsScreen.jsx` | `NativeStreamScreens.jsx:407` | NO |
| `/stream/:streamId` | `LiveStreamScreen.jsx` | none | old mockup, see 7.3 |
| `/stream/:streamId/moderation` | `StreamModerationScreen.jsx` | none | NO |

⚠⚠ **THE BROADCASTER AND GO LIVE EACH EXIST TWICE AND THE VIEWER DOES NOT.** Every
broadcaster or go-live change in this port must be made in two files or it ships to
one platform only. This is the same shape as the "four profile views" error
CLAUDE.md already records, and it is the single most likely way this port ships
half-done.

Shared components both sides already use: `ChatPanel.jsx` (1059), `StreamPoll.jsx`
(283), `StreamGoalAndAlerts.jsx` (278), `JoinAnnouncer.jsx` (280),
`ReactionsFloor.jsx` (173), `RaidControls.jsx` (173), `HlsPlayer.jsx` (296),
`UserQuickSheet.jsx` (260), `BoostStreamSheet.jsx` (209), `NowPlayingCard.jsx` (138).

The preview is 20 files under `src/screens/admin/streamPreview/` plus the harness
`src/screens/admin/AdminStreamPreviewScreen.jsx`.

---

## 2. Rules the port must not break

These are founder rulings and locked constraints, not preferences. Each one has
already caused a rejection.

1. **Never remove a feature, screen, route, button or link without explicit
   permission.** If the preview has no equivalent for something the real screen
   does, the real thing stays and the preview grows, not the reverse.
2. **No semi-transparent pill backgrounds.** Founder: *"I FUCKING HATE THE SEMI
   TRANSPARENT PILL BACKGROUNDS IT IS GROSS STOP USING IT."* Solid fills from the
   `S` palette. The only allowed transparency is a full-bleed scrim.
3. **No outline lighter than its own fill.** The one exception is a text input's
   border, which is what says "type here".
4. **A pill is not a switch.** A switch is a track with a sliding knob.
5. **No brand cyan (`#4DFFD4`)** anywhere in this surface.
6. **Never invent or change a price, rate, limit, duration, cap or fee.** Economy
   values are founder-only. Import them; never restate them.
7. **No em dashes in any user-facing string.** 20 shipped sites were fixed on
   2026-09-04; a guard now blocks new ones.
8. **Revenue-share language only.** Never "fee", "commission" or "platform cut" to
   a creator. The existing tip sheet is the correct model: *"Vergr pays the host
   their revenue share of this tip."*
9. **Chat rides the relay, not Firestore.** `infra/chat/src/`. Do not move stream
   chat to Firestore during this port.

---

## 3. What the preview surfaces are, and which real screen each maps to

| Preview file | Simulates | Ports into |
|---|---|---|
| `PreviewBroadcasterScreen.jsx` | 3 branches: mobile immersive solo, mobile co-host, desktop studio | `BroadcasterScreen.jsx` **and** `NativeBroadcasterScreen.jsx` |
| `PreviewMobileViewer.jsx` | immersive mobile viewer | `MobileLiveViewer.jsx` (covers web mobile **and** native) |
| `PreviewDesktopViewer.jsx` | desktop viewer, solo and co-host | `ViewerStreamScreen.jsx` |
| `PreviewViewerScreen.jsx` | viewer, 3 branches | `ViewerStreamScreen.jsx` / `MobileLiveViewer.jsx` |
| `PreviewSoloPortrait.jsx` / `PreviewSoloLandscape.jsx` | immersive and landscape viewer | `MobileLiveViewer.jsx` |
| `PreviewStreamStages.jsx` | co-host tile grids | `CoHostStage.jsx` |
| `PreviewEndAndSetup.jsx` | Go Live and Ended phases | `GoLiveSetupScreen.jsx`, `StreamEndingScreen.jsx` |
| `previewStates.jsx` | every state overlay | new shared components, see 6.1 |
| `previewChrome.jsx` | 17 sheets, chat | `ChatPanel.jsx` plus new sheets |
| `previewSoloParts.jsx` | dock, PiP, `MovableGoal` | `MobileLiveViewer.jsx`, `BroadcasterScreen.jsx` |

---

## 4. DELTA A: the preview has it, production does not

⚠⚠ **THIS SECTION WAS REWRITTEN 2026-09-04, BECAUSE THE FIRST VERSION WAS BUILT
THE WRONG WAY AND THE PORT KEPT DISCOVERING IT.**

The first draft grepped the real files for COMPONENT NAMES. That answers "is this
component present?" and nothing else. It does not answer:

- does the capability already exist under a different name? (A17 did: `GiftersSheet`)
- should it be ported at all? (A13 must not: the gate is deliberately disabled)
- is there anything behind it? (A4 and A16 have no writer and no backend)
- what does it need before it is safe on a real screen? (dead CTAs, hardcoded
  literals, prop plumbing, two mounts not one)

CLAUDE.md's own first rule is that **a source grep is not an audit**, and the first
draft of this section was a source grep. Founder, 2026-09-04: *"what was the point
in creating a doc if you didnt pick up on all of this before even starting"*.

**Every row below is now classified by what the work actually is, verified against
behaviour:**

| Class | Meaning |
|---|---|
| **PORT** | the capability is absent and the preview version can move across |
| **UPGRADE** | it EXISTS in production, thinner. The port improves it, and must not delete what is there |
| **BUILD** | nothing behind it. Needs a feature built, which is a founder decision |
| **DO NOT** | porting it would re-enable something deliberately switched off |
| **DONE** | shipped during this port |

| # | Feature | Class | Verified state of production |
|---|---|---|---|
| A1 | Zero-viewer state | **PORT** | Nothing renders a 0-viewer state on any surface. The broadcaster shows the digit `0`. |
| A2 | Broadcast health warning | **UPGRADE** | ⚠ CORRECTED. It EXISTS: `BroadcasterScreen.jsx:901` and `:1031` render a `netWarn` pill reading **"Quality lowered to keep you live"**. That copy is arguably better than the preview's, because it says what the system DID. The upgrade is the card and the action, keeping that message. |
| A3 | Empty-chat state | **DONE** | Ported into `ChatPanel`, gated on `connState === 'open'`. |
| A4 | Audio-only broadcast | **BUILD** | ⚠ CORRECTED. `StreamEndingScreen.jsx:53` READS `v.audioOnly`, and **nothing writes it** outside the preview simulator. Founder approved the feature 2026-09-02, but there is no broadcaster control and no doc field: this is a build, not a port. Same shape as Now playing. |
| A5 | VP earned, HOST only | **PORT** | No VP appears on any stream surface. Host-only: nothing awards `watch_stream_hour`, so a viewer chip must never be ported. |
| A6 | Chat-state banners | **DONE** | In `ChatPanel`, so every surface got it at once. |
| A7 | Composer reflects chat state | **DONE** | Only `muted`/`banned` lock the input. |
| A8 | Playback states | **PART DONE** | `offline` ported into `MobileLiveViewer`. `reconnecting` already existed. `hostdropped` and ended-while-watching still need a SIGNAL to drive them, which does not exist yet. |
| A9 | Four replay states | **DONE, ALREADY** | ⚠⚠ CORRECTED TWICE. The first draft grepped, the second measured the WRONG FILE. `StreamEndingScreen` is the BROADCASTER's post-stream screen (it holds the raid picker). The viewer's ended branch is `MobileLiveViewer.jsx:690`, and it already has all four states with the same copy the preview uses: replay ready, `vodPending`, `vodExpired`, and none. |
| A10 | Share replay / up next / stats | **PART DONE** | Share-the-replay added to the viewer's ended branch, gated on `replayUrl` so it never offers a dead page. ⚠ The sheet had to be MOUNTED IN THAT BRANCH: it returns early, so the one in the main return is unreachable and the button would have set state and rendered nothing. Still missing: watch-time and peak-viewer stats, and UP NEXT. |
| A11 | Appeal path | **DONE** | Real `submitAppeal` wired, server's 20-char minimum enforced client-side. |
| A12 | Guidelines link from chat | **DONE** | Added to the report sheet, pointing at the real `/platform/acceptable-use`. |
| A13 | Region and age gates | **DO NOT** | See 7b. The age filter is a deliberate no-op and no stream surface geo-blocks. |
| A14 | Movable, resizable goal | **UPGRADE** | ⚠ CORRECTED. The goal EXISTS and renders at a FIXED position (`BroadcasterScreen.jsx:919, :1034`). The port makes it movable; it does not add a goal. |
| A15 | Who can watch / who can clip | **BUILD** | Zero hits for `clipPolicy`, `whoCanClip` anywhere in `src/` or `functions/`. |
| A16 | Gift a sub | **BUILD** | Zero hits for `giftSub` outside the preview. Founder-approved 2026-09-02, never built. |
| A17 | Top supporters | **DONE, ALREADY** | ⚠ CORRECTED. `GiftersSheet` is mounted at `MobileLiveViewer.jsx:1213`, defined at :1442, fed by `topGifters`. Never was a gap. |

⚠ **A THIRD EM DASH WAS FOUND IN SHIPPED PRODUCTION COPY** while doing A10:
`MobileLiveViewer` told a viewer "The replay is still processing — check back in a
few minutes." The preview guard never covered it because the guard enumerates the
PREVIEW directory. **As each production file is ported it must be added to the
em-dash rule**, or the rule keeps defending the simulator and not the product.

**Recount after the corrections: 8 done or already present, 2 real ports left
(A1 zero viewers, A5 host VP), 1 part done (A10), 2 upgrades (A2, A14), 3 builds
needing a founder decision (A4, A15, A16), 1 that must not be done (A13).** The first draft implied 17
ports, which is why it read as a bigger and simpler job than it is.

### Port progress, 2026-09-04

All shipped, deployed and **artifact-verified** (a string only the new code contains,
checked in `dist/`, plus the old string confirmed gone).

**6.1 state layer** — `src/components/streams/states/` now owns the pure state
components, the palettes, both stream overlays, `PlaybackStateView`,
`HealthWarningView` and `MovableGoal`. The preview imports them back and re-exports,
so no preview call site changed.

**6.2 mobile viewer + ChatPanel**
- chat-state banner and composer lock (only `muted`/`banned` lock the input)
- empty chat, gated on the socket being open
- appeal path on both ChatPanel mounts, real `submitAppeal`, server's 20-char minimum
- guidelines link in the report sheet, real `/platform/acceptable-use`
- offline state on both overlay mounts, taking precedence over stalled
- share the replay, with the sheet mounted INSIDE the early-returning ended branch
- honest watch time on the ended card

**6.3 broadcaster, all three layouts** (2 web + 1 native)
- zero-viewer state
- host VP chip, guarded against a viewer version ever being added
- broadcast-health CARD carrying the pill's own accurate message
- movable, resizable tip goal with a real entry point and per-host persistence

**6.4 desktop viewer** — offline state and the appeal route, which it could not
inherit from ChatPanel because both live in MobileLiveViewer.

**6.5 Go Live** — copy and solid-fill pass done on BOTH files. The structural
restyle is not started, and per section 5 it is a restyle in place: all 37 state
variables stay.

### The three BUILD rows are built (2026-09-04)

Founder: *"i have already answered all of those before do them"*. Correct: all three
were answered on 2026-09-02 and I had been listing answered decisions as open.

**A4 audio-only.** `createStreamSession` now writes `audioOnly`; the field was READ
in two places and written by nothing, so the viewer could never draw the stage.
Toggle on Go Live, `AudioStageView` mounted at the MEDIA layer (z=1, under every
control) in both viewers.

**A15 who can clip.** `clipPolicy` (everyone / followers / subscribers) on the
stream doc, picker on Go Live, and **enforced in `requestStreamClip`**, because a
client check is a suggestion. ⚠ The two limits stay SEPARATE: the host picks WHO,
the clipper's own plan still decides HOW MUCH (free 30s/3, lite 60s/5, pro
90s/unlimited), so a Pro subscriber on a followers-only stream still gets 90s.
Conflating them would silently re-price every plan.

⚠ **CLAUDE.md's membership path is wrong and would have failed silently.** It says
`memberships/{sub}_{creator}`; the real collection is `member_subscriptions` and the
id is `{creatorId}_{uid}`, the opposite order. Both halves wrong means the
subscriber check would have passed for nobody, and failing closed would have looked
like a policy bug rather than a bad path.

**A16 gift a sub.** New `giftMembership` callable, deployed. No gifter gate, no
renewal (`autoRenew: false`, because the recipient never entered payment details),
and **bulk is qty x price with no discount, enforced by the shape**: the total is
`price * granted.length` and there is no quantity table anywhere in the function, so
there is nowhere for a discount to appear by accident. Recipients already holding an
active membership are filtered out and **not charged for**, since gifting to them
cannot grant anything. Shared `GiftSubSheet` mounted in both viewers, reached from
the viewer quick sheet.

⚠ **Still half done:** the sheet gifts to ONE named recipient. The callable already
accepts up to 25, so bulk is a UI addition (a multi-select), not a backend one.

### Em dashes removed from SHIPPED PRODUCTION COPY: 28

Two in ChatPanel, one in MobileLiveViewer, one in ViewerStreamScreen, eight across
the two broadcasters, seventeen across the two Go Live screens. **None of these were
visible to the guard before**, because the copy rules enumerated the preview
directory only. Production files now join `PORTED_PATHS` as the port reaches them,
and every widening of that list has immediately found more.

Two of them were an em dash used as a "no value yet" placeholder, which is still
user-facing output.

### Guard fixes that were defects in the guard itself

- **`countTag()`** — five rules passed while their component had been renamed out
  of existence, because `<ZeroViewersX>` contains `<ZeroViewers`.
- **`stripComments` was blind to JSX prose** — an apostrophe in "the broadcaster's
  stream" opened a fake string that swallowed a real comment fifteen lines later,
  producing a false em-dash report. A JS string literal never spans a raw newline.
  This was corrupting every rule that used it on a JSX file.

### The rule every ported component now follows

**A component must degrade when the surface cannot act.** The appeal CTA, the
offline Leave, the zero-viewer actions, the VP chip and the health card action each
used to render a control whether or not a handler existed. Fixed at the component,
so no call site has to remember.

## 5. DELTA B: production has it, the preview does not

**This is the direction that destroys work if it is missed.** The preview's Go Live
is a design sketch; the real one is a 1611-line screen with 37 pieces of state.

`GoLiveSetupScreen.jsx` state, read from source 2026-09-04:

```
accessPrice accessSheet advancedOpen audience audioDevices camDeviceId camOn
coverBusy coverHistory coverUrl description gateEnabled ingestMode isNsfwStream
micDeviceId micLevel micOn mirrorToTwitch notifyFollowers previewError previewReady
previewStarted promotedEventId promotedEventName scheduleOn scheduledAt scheduling
screenSharing showEventPicker showPromotePicker starting streamLang tagInput tags
ticketedEventId ticketedEventName tipGoalCoins tipGoalOn tipGoalReason
title twitchNudgeOn twitchNudgeText videoDevices
```

| # | Real Go Live feature | In the preview? |
|---|---|---|
| B1 | Cover image upload, with reusable history (`coverHistory`, "Use again") | no |
| B2 | Camera and mic **device pickers** (`videoDevices`, `audioDevices`) | no |
| B3 | Live local preview with error state (`previewStarted/Ready/Error`) | placeholder only |
| B4 | Mic level meter (`micLevel`) | no |
| B5 | Screen sharing (`screenSharing`) | no |
| B6 | **Ingest mode picker: Browser or OBS / RTMP** (`:1240-1253`) | no |
| B7 | Audience / follower gate (`audience`, `gateEnabled`) | partial |
| B8 | **Paid access price** (`accessPrice`, `accessSheet`) | no |
| B9 | **Link to a ticketed event** (`ticketedEventId`) | no |
| B10 | **Promote an event** (`promotedEventId`) | no |
| B11 | **Schedule for later**, validated to 30 days (`scheduleOn`, `scheduledAt`) | no |
| B12 | Notify followers toggle | no |
| B13 | **Stream language** (`streamLang`) | no |
| B14 | NSFW marker (`isNsfwStream`) | no |
| B15 | **Twitch mirror + nudge text** (`mirrorToTwitch`, `twitchNudgeText`) | no |
| B16 | Tags (`tags`, `tagInput`) | no |
| B17 | Plan upsell ("Upgrade for 720p / 1080p", `:1163-1174`) | no |
| B18 | Per-tier bitrate guidance for OBS (`:1155-1161`) | no |
| B19 | Invite Squad, Share Stream, Clip Moment, Community Guidelines | no |

Real broadcaster state the preview does not simulate: `camFx`, `camLook`, `camMask`,
`cameraFacing`, `clipping`, `clipsUsed`, `pipCorner`, `postingStory`,
`tipCatalogOpen`, `tipEvents`, `bannedWordsOpen`, `editInfoOpen`, `endedStats`,
`chunkLatencyMs`.

Real viewer state the preview does not simulate: `coHostTiles`, `linkedStreamDocs`,
`membershipTiers`, `paidAccess`, `sourceAspect`, `volume`, `heartBurst`, `drift`,
`exploreOpen`, `giftSoonOpen`.

⚠⚠ **CONCLUSION: THE GO LIVE SCREEN IS NOT PORTED FROM THE PREVIEW. IT IS RESTYLED
IN PLACE.** The preview contributes its visual language to it and nothing else. Any
plan that swaps the file loses 19 features.

---

## 6. The port, screen by screen, in order

Order is chosen so that each step is independently shippable and each one's
verification is possible before the next begins.

### 6.0 STEP ZERO, before any screen work

**Commit the untracked files first.** 48 files in this feature area are untracked,
including `scripts/stream-preview-check.mjs`, which `npm run check` and `prebuild`
both invoke. A `git checkout`, `reset` or `clean` deletes the lot and the build
then fails outright. CLAUDE.md already records this exact exposure destroying the
four `src-tauri/tauri.*.conf.json` files and shipping a web-mode APK.
**Committing is a founder call and has not been done.**

### 6.1 Extract the state layer into shared components DONE 2026-09-04

**Shipped and deployed.** `src/components/streams/states/` now holds the eight
PURE state components (Centred, ChatStateBanner, TtsStrip, ZeroViewers, EmptyChat,
VpEarnedChip, PreviewLevelUp, StreamPaywall) plus `tokens.js` with the S and C
palettes. `previewStates.jsx` imports and RE-EXPORTS them, so not one call site
changed and the step was invisible to the preview.

Verified live after deploy, all eight rendered: no ErrorBoundary, the chat-state
banner, the spoken-chat strip, the age gate, the ended screen, the host VP chip,
the empty chat, and the zero-viewer state (Viewers slider to 0).

⚠ **22 guard rules failed the moment the files moved**, every one of them reading
`previewStates.jsx` by name. That is the guard working. The fix was `readState()`,
a CONCATENATION of the preview file and the shared ones, so a rule about
ZeroViewers no longer needs to know which file holds it; absence assertions got
stricter for free. The em-dash rule was extended to the shared files too, because
they are now SHIPPED copy and `FILES` (which enumerates the preview directory)
stopped covering them.

⚠ **The five sim-reading components stay behind** until their context reads are
lifted to props: PlaybackState, HealthWarning, ComposerPill, AudioStage,
ModChannelSwitch. Do that at the boundary (shared component takes props, a thin
preview wrapper binds the sim), never by importing the preview context into
production.

**Next: 6.2, the mobile viewer.**



The single highest-value step, and it touches no existing screen.

`previewStates.jsx` currently holds `ZeroViewers`, `HealthWarning`, `EmptyChat`,
`AudioStage`, `VpEarnedChip`, `ChatStateBanner`, `ComposerPill`, `PlaybackState`,
`StreamPaywall`, `TtsStrip`, `ModChannelSwitch`. These are pure presentational
components that take props.

Move them to `src/components/streams/states/`, then have the preview IMPORT them
rather than own them. That inverts today's dependency and gives the property
CLAUDE.md already demands of `ReconnectingOverlay` and `StreamLoadingCover`:
**one definition, so the preview and production cannot drift.**

- Verification: `npm run check` stays green, and the preview renders identically.
  Diff a screenshot of each state before and after.
- ⚠ Do NOT edit the shipped components while moving them. Move, then change.

### 6.2 Mobile viewer (`MobileLiveViewer.jsx`)

Highest traffic surface and the only one that is genuinely shared (native
re-exports it), so one edit covers web mobile and native.

Port in: A1 (n/a, viewer), A3, A6, A7, A8 (the three missing states), A9, A10,
A11, A12, A13 (region and age), A17.

- ⚠ **The loading cover must sit BELOW the chrome.** Measured layer map of that
  frame: video (auto) < cover < header 6 < chat 8 < dock 9/10. The preview shipped
  it at z7, which buried the Leave button under an opaque `#0a0a14` and left a
  viewer with no visible exit during Connecting. Production is already correct
  because the cover is mounted INSIDE the video box and the top bar is a later
  sibling. **Preserve that.**
- ⚠ **Every blocking state needs a visible Leave.** Gates, playback failures and
  the loading cover all count.
- Verification: fire all six playback states, all six chat states and all five
  gates, and confirm by measurement that a Leave control is both hit-testable and
  visible in each.

#### 6.2a ChatPanel: chat state is shown BEFORE you type. DONE 2026-09-04

Shipped, deployed, artifact-verified. Put in `ChatPanel.jsx` rather than per
surface, so the mobile viewer, the desktop viewer and the broadcaster all got it
from one edit.

**The defect it fixes:** being muted or banned was only discoverable by FAILING.
The relay rejects the send and the panel showed a toast (`ChatPanel.jsx:219`), so
a timed-out viewer typed a whole message, pressed send, and only then found out.
The state is now remembered from the rejection and shown above the composer.

⚠ **ONLY `muted` and `banned` lock the input, and this is not a detail.**
`followersOnly` and slow mode are properties of the ROOM: a follower can chat in a
followers-only room, and slow mode rate-limits rather than blocks. Locking on
either would silence people who are allowed to speak. The banner still states the
room rule, because that is true for everyone. A guard asserts the lock derives
from `chatBlock` and not from `chatState`.

Two fixes the shared component needed before it was safe on a real screen:
- its own comment said "an appeal CTA that goes nowhere is worse than no appeal"
  and **the code rendered the button regardless of whether a handler existed**.
  The CTA now requires the handler it needs, so a surface with no sheet plumbing
  can mount it safely.
- the muted row hardcoded "4:32 left". `remaining` is a prop now; with no value it
  omits the clock rather than inventing one.

Also fixed in passing: two em dashes in shipped production copy in the rejection
strings.

### 6.3 Broadcaster, BOTH files

`BroadcasterScreen.jsx` **and** `NativeBroadcasterScreen.jsx`. Port in: A1, A2, A4,
A5 (host only), A14, A15.

- ⚠⚠ **`MovableGoal`'s default position must MEASURE its floor, not use a
  constant.** This was got wrong twice. The chrome above the goal is a flow column
  whose height depends on state: the VP chip row sits at 8% normally and at
  18.5-21.8% once the health card appears above it and pushes it down. `yPct 14`
  let the health card cover 80% of the goal; `yPct 20` cleared the health card and
  then overlapped the VP row by 37%. The shipped preview version finds the top
  chrome actually on screen and sits below the lowest of it, excludes backgrounds
  (a full-stage video has `topPct 0` and would report a floor of 100), caps at 45%,
  and only ever moves the DEFAULT. Port that logic, not a number.
- Verification: for each of the three broadcaster branches, with health healthy and
  with health "ingest lost", measure the goal's rect against every other chrome
  box and assert zero overlap.

### 6.4 Desktop viewer (`ViewerStreamScreen.jsx`)

Port in: the same state set as 6.2, plus co-host layout parity from
`PreviewDesktopViewer.jsx` and `PreviewStreamStages.jsx`.

- ⚠ Badges move to top-right in co-host mode, or they collide with the tile labels.
- ⚠ Tile role labels belong WITH the name at the tile bottom, never at `top:10
  left:10`, which is where every surface puts its own header chrome. Measured: HOST
  was covered by the LIVE pill at 29x9.

### 6.5 Go Live, RESTYLE IN PLACE, both files

`GoLiveSetupScreen.jsx` **and** `NativeGoLiveScreen.jsx`.

**Do not replace. Do not port structure.** Apply only: the solid-fill palette, the
switch treatment, the divider fade, the section rhythm. Every one of B1 to B19 stays.

- Verification: enumerate the 37 state variables before and after; all 37 must
  still be reachable from the UI.

### 6.6 Ended (`StreamEndingScreen.jsx` + `NativeStreamScreens.jsx:369`)

Port in: A9, A10. The preview version is materially better and the real one is 126
lines, so this is the one screen where the preview is close to a drop-in.

### 6.7 Co-streaming (`CoStreamingScreen.jsx`)

⚠ **Verify its state before planning.** CLAUDE.md calls it a "74-line stub"; it is
**429 lines** today. That entry is stale. Re-audit before touching it.

---

## 7. OBS and Twitch: what is real, and the one gap that blocks it

### 7.1 The backend is real

- `functions/streaming.js` `createStreamSession` returns an `ingestUrl` and a
  per-session `streamKey`.
- `vergr-rtmp-auth` (Go, `infra/rtmp-auth/src/main.go`, `127.0.0.1:8093`) validates
  the key on nginx-rtmp `on_publish` and runs a 5s watchdog that disconnects a
  stream over its cap for 15s. Free 4 / Lite 6 / Pro 9 Mbps.
- Twitch mirror exists end to end: `mirrorToTwitch` on the Go Live screen, server
  validation of the RTMP path and mirror secrets (`GoLiveSetupScreen.jsx:404`), and
  a Go chat bridge in `infra/chat/src/twitch.go`.

### 7.2 The gap, corrected

**An earlier statement of mine in this session was wrong and is corrected here.** I
said OBS had no UI at all. It has a mode picker: `GoLiveSetupScreen.jsx:1240-1253`
offers "Browser" and "OBS / RTMP" with the description *"Push from OBS, Streamlabs,
or any RTMP encoder. Best quality + game capture."*, and `:1155-1161` gives
per-tier bitrate and keyframe guidance.

What is actually missing is narrower and worse:

- **`rtmp://` appears nowhere in `src/`.** Verified by grep.
- **`streamKey` is never displayed.** In `BroadcasterScreen.jsx` it is used only to
  start browser ingest (`:492-498`) and to probe the uplink (`:534`). The only
  clipboard call in that file is sharing a recap (`:1313`).

So a broadcaster selects "OBS / RTMP", is told what bitrate to use, and is then
given **neither the server URL nor the stream key**. There is nothing to paste into
OBS. The feature is selectable and unusable.

⚠ **The stream key is a credential** (memory `reference-stream-key-is-a-credential`):
it must never be written to the public `streams` doc. It lives in `stream_keys`.
Any UI that reveals it must read it through the callable, mask it by default, and
offer a regenerate.

**This is a prerequisite for the port, not part of it.** Deciding what that UI is
and where it lives is a founder call.

### 7.3 What OBS gives a broadcaster that Vergr does not account for

Researched against the shipped surfaces, not assumed:

| OBS capability | Vergr today |
|---|---|
| Scene switching, sources, transitions | not surfaced. Broadcaster has `scene` state but no scene UI. |
| Game / window / display capture | the browser path has `screenSharing`; OBS does its own. |
| Overlays and alerts as browser sources | ⚠ **the only overlay routes are tournament-era** (`TournamentOverlayNeon`, `/overlay/battle/...`). Tournaments are retired, so an OBS user has **no supported alert or goal overlay URL**. This is a real gap for the exact users OBS attracts. |
| Local recording | none |
| Multi-track audio, filters, noise gate | none |
| Stream deck / hotkeys | none |
| Bitrate and keyframe control | guidance given, enforced by the watchdog |

⚠ **The overlay gap is the notable one.** A broadcaster on OBS expects a browser
source URL for tip alerts and the goal bar. Vergr renders both in-page instead, so
they exist for browser broadcasters and not for OBS ones. Whether to build an
overlay route is a founder decision and is out of scope for this port.

---

## 7b. A13 IS NOT A PORT. Do not do it without a founder decision.

Delta A row 13 lists the region and age gates as preview-only. **Both would be NEW
ENFORCEMENT, not a port**, and one of them was deliberately switched off.

**Age.** `assertNsfwViewerAllowed` in `functions/entitlements.js:184` is a
documented **no-op since 2026-08-14**, kept only so its two call sites stay wired.
`feedRank.js:189` is `const passesRating = () => true`. CLAUDE.md states the three
filters were switched off together and get **restored all three or none**. Porting
an age gate into the viewer would silently re-enable one of them.

**Region.** No stream surface geo-blocks at all: `geoBlocks.js` is used by nothing
under `components/streams/` or `screens/streams/`. Adding the gate would be adding
region enforcement to live streaming for the first time.

**What IS correct today and should not be "improved":** a server denial renders
"That session is not available." with no reason, and that is deliberate.
`MobileLiveViewer:609` treats `not-found` as denial precisely so that probing a
stream id cannot tell a stranger whether a private session exists.

So the preview keeps drawing these states, because a design surface should show
what the product would look like if they existed, and the real viewer does not get
them until the founder says so.

## 8. Open items, all founder decisions

| # | Item | Why it is not a session decision |
|---|---|---|
| O1 | **Commit the 48 untracked files** | Losing them breaks the build. |
| O2 | **OBS server URL + stream key UI** | Reveals a credential; needs a masking and regeneration policy. |
| O3 | **OBS overlay browser-source route** | New public surface, and the only existing ones are tournament-era. |
| O4 | **Now playing** | `streams/{id}.nowPlaying` is read in 3 places and written by nothing. `NowPlayingCard.jsx`'s header cites `functions/spotifyNowPlaying.js` and `functions/spotifyAuth.js`; **neither file exists**. No Creator Studio music section, no music route, and `BroadcasterScreen.jsx` has zero music references. The preview simulation was removed 2026-09-04 on founder instruction. Locked plan (memory `project-music-integration`) is Last.fm plus Pretzel Rocks; the alternative is Audius, which is already shipped for profile music (`utils/audius.js`, `ProfileAudio.jsx`, and `audius.js:73` already emits `source: 'audius'`). **Do not build either without a decision.** |
| O5 | **"GOING LIVE" shown to a viewer** | `StreamLoadingCover` shows it while a viewer waits for the first frame of an already-live stream, so it reads as if the viewer is going live. Production component; changing shipped copy is a founder call. |
| O6 | **Native parity timing** | Founder, 2026-09-04: native comes after the port. Batch it into one build. |

---

## 9. Guard strategy for the real screens

The preview is protected by `scripts/stream-preview-check.mjs`, **1223 assertions**
as of 2026-09-04, wired into `npm run check` so `npm run build` fails on a
regression. **The real screens have zero equivalent coverage.**

The port must extend the guard to the production files as each one lands, or the
design regresses the first time somebody edits a stream screen without opening it.
Minimum rules to carry across:

- no fake glass, no hairline lighter than its fill, no cyan
- no em dash in shipped copy (code only; comments are stripped by the bundler,
  verified absent from `dist/`)
- every button carries a handler
- a prop the surface reads is actually passed
- the composer placeholder comes from one definition
- the loading cover's z-index stays below the chrome
- the goal's default clears the chrome column

⚠ **Every rule must be negative-tested in both directions before it is believed.**
Rules written during this audit failed their first control run for: matching the
comment explaining their own fix; a fixed-width window bleeding into the next
statement; a substring that a different token satisfied; and a slice terminating
inside a template literal because `${X},` contains `},`.

---

## 10. Traps, measured

Each of these produced a wrong conclusion during the audit.

- ⚠⚠ **Hit-testing proves clickability, never visibility.** `StreamLoadingCover`
  carries `pointerEvents: 'none'`, so `elementFromPoint` skips it and returns the
  button underneath. The probe reported Leave `reachable: true` in all five
  playback states while an opaque layer was painted over it. Enumerate what PAINTS
  over a rect, ignoring pointer-events, and confirm with a zoom.
- **Screenshot coordinates are not CSS coordinates.** 1568x701 against 2048x915, a
  factor of 1.306. Convert with `innerWidth / screenshotFrameWidth`.
- **"The box with the most controls" is not the device frame.** It picked the
  198x2784 control rail three times. Anchor on geometry: walk up from a point known
  to be inside the phone.
- **Transients expire before a sweep runs.** Fire each one, let it settle, then
  measure. A dead poll sat in the frame of several minutes of captures.
- **State bleeds between measurements.** An undismissed poll contaminated a rank
  ribbon capture; an unfinished level-up polluted six later events.
- **`grep -E` alternation is `|`, not `\|`.** Four checks in this document's own
  research falsely reported 0/3 before this was caught.
- **Git Bash `/tmp` is `C:\tmp` to node.** A negative test whose backup never
  existed ran the unmodified file four times and reported four clean passes.
- **The guard writes failures to stderr.** A harness filtering stdout reported PASS
  on a rule that had fired.
- **A green build proves the syntax parsed, never that the app works.** JSX legally
  accepts an element as an attribute value.

---

## 10b. VERIFY THE ARTIFACT, NOT THE COMMAND

⚠⚠ **A build and deploy that exits 0 does not prove your change shipped.** On
2026-09-04 the ChatPanel port was edited, guarded, negative-tested, built and
deployed, all green, and **the deployed bundle still carried the old copy**.

The cause: the negative test mutates the real source file and restores it, and
that restore raced the build. Measured, which is the only reason it was caught:
`dist/index.html` was written at 21:11 while `ChatPanel.jsx` was last written at
21:28, and the shipped chunk still held the em-dash string the edit had removed.

**So every ported change gets an artifact check before it is called done:**

```bash
grep -rl "<a string only the new code contains>" dist/assets/*.js
```

and, for a removal, confirm the OLD string is gone. This is the same rule
CLAUDE.md already states for the Android APK ("verify the ARTIFACT, never the
command you typed"); it applies to the web bundle for exactly the same reason.

⚠ **Do not run a mutate-and-restore negative test while a build is in flight.**
Run negative tests to completion first, then build.

## 11. Definition of done

The port is complete when, for every row of the table in section 1:

1. Both implementations of that route carry the change (or the route is verified
   shared).
2. Every Delta A item assigned to it renders, measured on the live site, not
   grepped.
3. Every Delta B item still works; for Go Live that means all 37 state variables
   remain reachable.
4. A guard rule covers each rule from section 9 on that file, negative-tested both
   ways.
5. The surface has been screenshotted in every state, transient and overlay, and
   the founder has seen the captures.
