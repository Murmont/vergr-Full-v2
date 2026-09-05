# Live-stream audit — open items and method

> ⚠⚠ **READ `docs/AUDIT_RULES.md` FIRST.** An audit is not cosmetic and it is not
> technical — it is both, plus UI/UX, plus what would make the thing better. That file is
> the standard; this one is the running record against it.

The running record of the 2026-09-03 pixel audit. **Nothing here is closed by being
listed.** Items in §1 are deliberate deferrals awaiting a founder decision; §2 is what
the audit cannot yet see; §3 is the method, so the next pass does not repeat the holes
that let three defects survive a "finished" audit.

Fixed items are in `docs/UPDATE_LOG.md`, newest entry.

---

## 0. FOUNDER DIRECTIVE, 2026-09-03

> **All preview work is to be COMPLETE tonight. No excuses.** This has run two days.

Read with `docs/AUDIT_RULES.md`. The scope is the PREVIEW (`/admin/stream-preview`) and
the components it renders — not the real screens.

⚠⚠ **THE PREVIEW EXISTS TO CAPTURE STORE SCREENSHOTS.** That is the test for every
decision here. Anything that lands in a frame the founder cannot remove is a defect, not a
nicety: a facecam placeholder with no off switch, a goal bar stretched across the picture,
instructional filler text where a real tagline belongs, components floating over a face.
A control being *present* is not the bar; the shot being *usable* is.

⚠ **CHECK WHETHER THE CONTROL ALREADY EXISTS BEFORE ADDING ONE.** `Game + cam / Camera
only` already turned the facecam PiP off on mobile; it was simply never passed to the
desktop viewer. A second toggle was added and had to be taken back out. Two controls doing
one job is worse than the one that was missing.

---

## 1. Deferred items — CLOSED 2026-09-04

⚠⚠ **THESE WERE NOT FOUNDER DECISIONS AND LABELLING THEM AS SUCH WAS WRONG.** Founder,
2026-09-04: *"these all seem like you know what to do already since none of them are
phrased as questions"*. He was right — eight of the nine were statements with an obvious
answer that I had parked behind a "needs a decision" label.

**The line, going forward: a decision is the founder's only if it changes an ECONOMY
NUMBER (price, rate, limit, cap, duration) or a DESIGN VALUE HE AUTHORED. Everything
else is mine to make and record.** "It touches something he cares about" is not the same
as "he has to decide it".

| # | Item | Call | Why |
|---|---|---|---|
| D1 | Entry ribbon "LIVE" at 4.04-4.41:1 | **ACCEPTED, closed** | Measured live: the text is **8px**, weight 700, in `rank.ring`. This is not a colour problem — **no hue passes 4.5:1 at 8px**, so lightening the rank colours would not fix it. The only real fix is a BIGGER RIBBON, and its proportions (`line2Size = h * 0.15`) come from the founder's own measured art spec. It is a ~3s decorative transient and the word LIVE also appears in the header pill, so no information is lost when it is hard to read. ⚠ **Reopen only if the ribbon is resized** — then re-measure rather than assuming it passes. |
| D2 | Scrub track `rgba(255,255,255,0.3)` | **NO CHANGE, closed** | A translucent scrub track is the conventional player affordance: it is *supposed* to let the video read through. I flagged it because it matched the banned-wash pattern BY SHAPE, which was pedantry, not a defect. Making it solid would look worse. |
| D3 | Placeholder scaffolding at 1.81-3.38:1 | **NO CHANGE, closed** | Deliberately dim: it is the measuring stand-in that real footage replaces, and it prints its own pixel size so the founder can size a capture. It never ships to a user. |
| D4 | `glass`/`glassDark` solid in the SHIPPED viewer | **DONE, closed** | Done on founder instruction. It was a RECORD, never a pending question. Revert path if ever wanted: one line each in `previewChrome.jsx`, `MobileLiveViewer.jsx`, `previewSoloParts.jsx`. |
| D5 | The panel-border token | **FIXED** 2026-09-03 | Seven copies, not four. See wave 6. |
| D6 | Crest at a scroll boundary (24x18) | **NO CHANGE, closed** | Inherent to ANY control at the edge of a scroll box — its pseudo-element target is clipped by the scroller. Resolves as the row moves. Not fixable without giving the chat list padding it should not have. |
| D7 | Reduced motion, spot-checked only | **VERIFIED, closed** | Both switches now checked, not one. **App switch:** `data-reduced-motion="true"` set, all seven transients fired — every one renders, `belowFullOpacity: 0`. This is the failure mode that mattered: `index.css` answers the app switch with `animation-duration: 0.001ms`, which does not stop an animation, it FAST-FORWARDS it to its final keyframe, so anything ending in "gone" becomes invisible. Nothing did. **OS switch:** `@media (prefers-reduced-motion: reduce)` in five places (`index.css` x3, `surface.css` x2) plus framer-motion's `reducedMotion="user"` in `MotionPrefs`, which defers to the OS query. |
| D8 | The app SHELL breaks the same two rules | **OPEN — queued work, NOT a question** | Measured on `/settings/privacy`: ghost outlines and glass on the left nav, header and three chrome pills. The rules are app-wide so this is real, but sweeping the shell changes every screen in the product and the founder scoped this session to the preview. It sits in the queue until he widens the scope. Nothing to decide — only to schedule. |
| D9 | Retired tournament files declare `Inter` | **WON'T FIX, closed** | 6 declarations across 5 files, all unrouted dead code (tournaments retired 2026-08-09). Editing files nothing renders is churn with zero user effect. ⚠ The note exists so a future grep for `Inter` is not read as an incomplete font fix. |

## 2. Not yet audited

- **The real screens.** Everything measured so far is `/admin/stream-preview` plus the
  shipped components it imports (`MobileLiveViewer`, `ChatPanel`, `StreamPoll`,
  `StreamGoalAndAlerts`, `NowPlayingCard`, `JoinAnnouncer`, `UserAvatar`,
  `RankBadge`). `ViewerStreamScreen`, `BroadcasterScreen` and `GoLiveSetupScreen` have
  NOT been probed — they need a live stream, or the router state injected.
- **Native.** Every measurement is the web build in Chrome. The Tauri WebView has its
  own safe-area insets and font fallbacks.
- **The mobile preview's composer is a styled `<div>`**, not a real input, so it cannot be
  focused or typed in — while the DESKTOP preview's composer is real and typable. Two
  surfaces solving the same thing differently. The real `ChatPanel` composer IS a real
  input, so this is a simulator-fidelity gap rather than a product defect.
- **Reduced motion, observed vs inferred.** `MotionPrefs` is verified mounted and carrying
  `reducedMotion: "user"` (§2b), but the OS query cannot be emulated from this harness, so
  the reduced BEHAVIOUR is inferred from the provider value rather than watched. The
  app-toggle branch is likewise unobserved — flipping it would write to a real profile.
- ~~**RTL beyond the name.**~~ **DONE in wave 5.** `dir="auto"` now also covers stream
  titles (preview + `ViewerStreamScreen` + the shipped `StreamPaywall`), bios
  (`UserQuickSheet`), and poll questions AND poll option labels (`StreamPoll`). Guard
  rule 49 walks back to each element's opening tag rather than testing the file for the
  substring, because a file-wide `includes` passes as soon as ONE element carries it —
  `StreamPoll` would have gone green on the question alone while every option row stayed
  LTR.

---

## 2b. Found after the founder reopened the audit

All four were invisible to every earlier sweep for the same reason — the thing was not on
screen when the sweep ran.

- **The poll CARD kept a ghost hairline** (`1px rgba(255,255,255,0.10)` over its own
  `rgb(15,15,26)`). I fixed the option rows and left the card. The founder caught it from
  a screenshot. Fixed, along with the create-poll modal.
- **`NowPlayingCard` was `rgba(18,18,30,0.75)` with a brighter hairline** — found only by
  FIRING the now-playing event and measuring while it was up.
- **`LevelUpCelebration` escaped the device frame entirely.** It is `fixed inset-0`, which
  is correct on a phone and means "the browser window" inside a simulator: measured
  2043x915, centred on the viewport (card centre 1021 = exact viewport centre), spilling
  777px left and 873px right and dimming the admin sidebar. The one screen that exists to
  be captured could not be captured.
- **No global keyboard focus style existed.** 51 focusable controls on one surface, and the
  UA default computes to `outline: auto 1px rgb(16,16,16)` — a near-black ring on a
  near-black UI. All 33 focus rules in the app were component-scoped.

### Also found and fixed in wave 2

- **No sheet trapped focus.** Measured with one open: **46 controls behind the scrim were
  still keyboard-reachable**, and focus really landed on them — the sheet stays visually
  on top while the keyboard walks around behind it. None carried `role="dialog"` or
  `aria-modal`, so a screen reader never announced one had opened. One `SheetHost` now
  covers all sixteen kinds: `inert` on the siblings (which removes them from the tab order
  AND the accessibility tree, unlike a Tab-cycling keydown handler that has to guess the
  order), focus moved in on open, restored on close, Escape to dismiss.

### Wave 3 — keyboard, direction and motion

- **35 of 45 tab stops on the stream were chat rank crests**, 21 of them scrolled out of
  view. In a real chat that is hundreds of stops before the dock or the composer.
  `RankBadge` gained `feed`, which sets `tabIndex={-1}`: still clickable and
  programmatically focusable, only out of SEQUENTIAL navigation, and only in chat.
  Measured after: **45 → 10 tab stops, 0 crests in the order, 0 off-screen stops.**
- **Not one element in the app set `dir`.** An Arabic or Hebrew display name rendered
  inside an LTR box — the glyphs shape correctly, which is why it passes a glance, but the
  ellipsis lands on the wrong side and mixed content orders wrongly against it.
  `dir="auto"` added to `UserName` and chat message bodies.
- ⚠⚠ **framer-motion RESPECTED NEITHER REDUCED-MOTION SWITCH, AND `index.css` CLAIMED IT
  DID.** The comment asserted *"framer-motion respects the same flag through
  usePrefersReducedMotion"*. That hook appeared in the codebase **exactly once — inside
  that sentence**, used nowhere, and there was no `MotionConfig` either. Capping
  `animation-duration` only touches CSS animations; framer-motion writes inline styles from
  rAF and never sees it. **13 live-stream files animate with it and honoured neither
  switch.** Added `<MotionPrefs>` wrapping the app (`always` when the user asked directly,
  `user` otherwise, which follows the OS), and corrected the comment in place so the false
  claim is not repeated.
- CJK, emoji and long names all truncate correctly with nothing escaping the frame, proven
  against a control run.

### Wave 4 — the font fix had never reached the real screens

⚠⚠ **THE SAME SHAPE, A THIRD TIME: A FIX LANDED ON THE SURFACE I WAS LOOKING AT WHILE ITS
SIBLINGS KEPT THE DEFECT.** Wave 2 fixed `Inter` in the simulator and the shared components
and I reported it done. Auditing a REAL screen (`/settings/privacy`) showed `Inter` still
declared, and tracing it back:

| File | Broken declarations |
|---|---|
| `ViewerStreamScreen.jsx` — the real viewer | **7** |
| `NativeBroadcasterScreen.jsx` | 3 |
| `BroadcasterScreen.jsx` | 2 |
| `LiveInviteBanner.jsx` | 2 |
| `CoStreamInviteScreen.jsx` | 1 |
| `HudOverlay.jsx` | 1 |

All rendering in the OS font. 20 declarations fixed — 16 on the broken chain plus 4 of the
`Inter, "DM Sans"` form, which resolves correctly but is the line people copy, and dropping
its DM Sans half is exactly how the broken ones came to exist.

⚠ **The guard rule only covered the simulator and the shared components**, which is why it
stayed green through an entire wave. Widened to the six real screens and negative-tested.

The three instances of this shape so far: the rank crest (fixed on one of four profile
views), `glass`/`glassDark` (fixed in two of three copies), and now the font. **Count the
definitions, and check the siblings, before believing a fix landed.**

### Wave 5 — two whole phases and all sixteen sheets had never been swept

⚠⚠ **EVERY EARLIER WAVE DROVE THE LIVE PHASE.** Go Live and Ended were never measured,
and the sheets were only ever seen when a button on the current surface happened to open
one. Driving all sixteen through the React sheet opener, and both other phases through
the rail, found more in one pass than waves 2-4 combined.

**The worst of it: a full-bleed state had no way out.** `Centred` backs every gate and
every failure state, and it laid a scrim over the entire UI with at most one CTA. The
host row, Viewers, More and **Leave** were all covered. On **Region blocked, which has no
CTA by design, NOTHING on the screen was reachable at all** — a viewer with no button
that does anything and no way back. It also sat at z-7 against the dock's z-8, so a live
poll painted over "The stream has ended" and covered its own "Watch the replay".

Fixed: a `Leave stream` control inside the overlay, blocking states raised above the
dock, and **host-dropped and offline made non-blocking, because their own copy says the
room is still there** ("the stream is still open", "you will not lose your place in
chat"). Blocking chat while promising the viewer keeps their place is a contradiction on
screen. Verified after: Region blocked went from **0 reachable controls to a working
Leave**, and all five gates reach Leave plus their CTA.

⚠ **THE PREVIEW HAD DROPPED A CONTROL THE REAL PRODUCT PASSES.** `MobileLiveViewer`
gives the shipped `StreamPaywall` an `onBack`; the preview's copy of it did not. So this
was parity, not invention — the simulator-fidelity gap class again.

| Also found | Measured |
|---|---|
| **The poll's dismiss did nothing** | `onClose={() => {}}`. `StreamPollCard` renders its close button only when `onClose` is truthy, so it drew a control that swallowed the tap — on the surface the Play screenshots come from. It also poisoned this audit: the poll stayed up through every reset and made five later surfaces report their own CTA as blocked. |
| **`LevelUpCelebration` broke three rules at once** | Control run: **0 ghost outlines before firing it, 4 after.** Card hairline over its own fill; badge, both unlock rows and **Continue** each a tint under a brighter ring. Continue is the primary action of the screen and its label measured 4.41:1. |
| **`#ef4444` fails in both directions** | **3.76:1 under white as a fill** (End Stream, every LIVE pill, Clear chat) and **4.29:1 as text on a dark panel** (the TTS muted strip). One value cannot serve both, so it is now `red` (ink) and `redFill`. |
| **The panel co-host buried the host's action rail** | Solo reached all four controls, Grid reached all four, **Panel reached none**: 2 buried at 2 guests, all four at 3 and 4. The guest column is `right:8 / width:32%` and the rail is `right:10` with 46px pills — the same band by construction. The column's geometry is measured off the founder's own TikTok reference, so the RAIL moved, to the left, in panel layout only. |
| **The Studio toggle broke both rules, one per state** | OFF a `rgba(255,255,255,0.06)` wash under a BRIGHTER `0.09` hairline; ON a tint under a solid purple ring. |
| **Go Live** | wash inputs; back button and "Later" pill drawn as a **ring over nothing**; follower-gate notice an amber tint under an amber ring; locked CTA a wash. |
| **Ended, all four replay states** | six body strings at **4.05:1 and 3.78:1**; stat and up-next cards under hairlines; Share-the-replay and Schedule-next as transparent fills with a hairline. |
| **The sheets** | **MOD badge 1.87:1** — the worst reading of the whole audit, caused by setting no colour of its own so near-white inherited onto bright green. `Pin message` 2.92:1, **`Clear chat` 3.76:1 on a destructive confirm**, nine viewer handles at 3.84:1, the tip chip 4.19:1 and a fill under a solid ring. The banned-word remove button was **15x22 AND unnamed**. |

⚠ **A GUARD FOUND WHAT THE SWEEP COULD NOT.** Rule 56 flagged `'1px solid ' + C.border`
and led to the replay player's own Share and Back buttons — a translucent wash under a
hairline, on a state **no sweep had ever opened**. It also caught four `#6B7280` literals
I had missed after changing the token. Both are the "count the definitions" lesson.

**Performance**, measured on a genuinely visible tab: idle **59fps, p99 16.8ms, zero long
tasks**; five transients fired at once **59fps, p99 33.3ms, 4 dropped of ~236, one 51ms
long task** at the moment five components mount together, which cannot happen in reality.

**Coverage this wave**: 6 device presets at true size (all clean), 3 viewer roles, solo /
split / landscape, co-host grid and panel at 2/3/4 guests, broadcaster live and pre-live
on both devices, all 6 playback states, 6 chat states, 5 access gates, 4 TTS states, 9
transients fired and measured while up, 10 sheets, both Go Live variants, all 4 replay
states on the ended screen.

⚠ **THREE OF MY OWN READINGS WERE WRONG AND EACH LOOKED LIKE A DEFECT.** `Continue`
looked inert (my MessageChannel waits were right for a backgrounded tab and far too short
once it became visible — animations run in real time again); desktop co-host `Viewers`
looked blocked (state bleed); and five surfaces reported their CTA blocked twice because
my reset clicked the poll dismiss I had just proven inert. Every one was caught by a
control run, which is the only reason none of them turned into a code change.

## 2c. Found in the STATE pass, 2026-09-04

The ten live surfaces were all captured and clean. These six came out of the states,
which had never been screenshotted at all: the blocking gates are full-screen takeovers
and nobody had ever looked at one.

| # | Defect | How it was found | Status |
|---|---|---|---|
| S1 | **An em dash in shipped copy, 20 sites across 14 strings.** The region-blocked gate read "not on your account — everything else on Vergr still works." CLAUDE.md bans the character in every user-facing output, and this one was in a full-screen takeover bound for a store screenshot. | rendered the gate | fixed + guarded |
| S2 | **The loading cover buried the only way out.** Connecting painted an opaque #0a0a14 over the whole 244x528 frame, header included. A zoom of the header strip was solid black while the Leave button still sat under it at (1087,123). | zoomed the header | fixed + guarded |
| S3 | **The composer contradicted its own banner.** `chatState` drove `ChatStateBanner` and nothing else, so "You are banned from this chat" sat directly above "Add a comment...", dock and all. Five sites each held their own literal; two disagreed on the ellipsis. | read the frame | fixed + guarded |
| S4 | **"Spoken chat is a Pro feature" is only half true.** `canUseStreamTts()` passes on level OR Pro (founder, 2026-08-26). Pro-only copy hides the earned path and turns a ladder reward into a paywall. Now names level 92, imported from `RANK_UNLOCKS`, never restated. | checked the claim against the gate | fixed + guarded |
| S5 | **Losing ingest also lost the tip goal.** The health card covered **80% of the goal card** and painted over its centre. The goal fallbacks had been derived from the VP chip row alone, because the health warning is a transient and was not on screen when they were measured. | measured overlap under "Ingest lost" | fixed + guarded |
| S6 | **"GOING LIVE" on a viewer surface.** `StreamLoadingCover` shows it while a viewer waits for the first frame of an already-live stream. It reads as if the VIEWER is going live. Production component, so it belongs to the port, not the preview. | rendered Connecting | OPEN, port item |

Guard: 1148 -> 1223 assertions, every new rule negative-tested in both directions.

## 2c-2. The screenshot pass is COMPLETE (2026-09-04)

Every surface, state, transient, sheet and phase has now been rendered and looked at.

**Covered:** 10 live surfaces; 5 access gates; 6 playback states; 6 chat states; 2
formats; 4 spoken-chat states; 3 broadcast-health states; 6 fired events; poll,
reactions, boost, entrance, tip and sub transients; 17 sheets; Go Live; Ended plus
all 4 replay states; Moderator and Vanguard roles; Immersive, Split and Landscape
layouts; desktop solo and co-host.

**Checked and found CORRECT, recorded so nobody re-opens them:**

| Suspected | Verdict |
|---|---|
| Landscape chat colliding with the floating heart | **Clean.** 6 rows measured, rightmost text edge 837 of an 852 stage; the heart sits at y343 while chat occupies y126-213. Non-vacuous: the row count was asserted. |
| 4 unlabelled dock buttons in landscape | **Clean.** Named via `title` + `img alt`: Invite, Tips & VC, Gift Box, Share. My probe read only `aria-label`, so "(icon)" was a probe artifact. |
| Two sheets stacking (mod panel under the tip sheet) | **Clean, and unreachable by a real pointer.** With the mod panel open, the only hit-testable controls are its own 10 rows and **11 buttons behind it are covered**. The stack was an artifact of synthetic `.click()` bypassing the scrim. `openSheet` is a single state, so two SHEETS cannot co-exist by construction. |
| Membership tiers being invented prices/perks | **Clean.** Tiers are creator-defined (`creators/{uid}.membershipTiers`, free-text perks). The preview's Supporter 100 / VIP 500 / Legend 1000 match the shipped defaults at `MembershipTiersScreen.jsx:29-31` exactly, perk strings included. The perks are creator promises, not platform features. ⚠ Weakness: the preview RESTATES them instead of importing, so they can drift. |
| Gift-sub bulk pricing | **Correct and founder-compliant.** qty 1 gives "Gift Supporter · 100 coins"; qty 10 gives "Top up 760c" (10 x 100 = 1000 against a 240c balance). **No bulk discount**, exactly as specified, and the shortfall maths is exact. |
| Tip sheet with an unaffordable amount | **Correct.** At 1000c on a 240c balance the CTA becomes "Top up 760c" rather than an unaffordable Send. |
| The tip incrementing the goal by the wrong amount | **Clean.** Measured +100 against a chat line reading "sent 100 coins". My earlier +13 vs 12 reading was two overlapping events. |
| Escape dismissing sheets | **Works.** |

⚠ **Still uncaptured and deliberately so:** the 8 per-rank entrance ribbons. They are
covered by `scripts/entry-ribbon-preview.mjs`, which renders all 11 at the real
280x70 against the real art and re-measures in the browser.

## 2d. Now playing: REMOVED from the preview, unbuilt in the product (2026-09-04)

Founder: *"you have a now playing but i dont see a way for the broadcaster to actually
fucking play anything."* Correct, and it went further than a missing control.

- `streams/{id}.nowPlaying` is **read in 3 places** (`MobileLiveViewer.jsx:1082`,
  `ViewerStreamScreen.jsx:929`, and the preview) and **written by nothing**. No
  callable, no cron, no client writer.
- `NowPlayingCard.jsx`'s own header says it is populated by
  `functions/spotifyNowPlaying.js` with auth in `functions/spotifyAuth.js`.
  **Neither file exists.** Stale comment.
- There is no Creator Studio music section, no music route, and
  `BroadcasterScreen.jsx` has zero music references.

So the preview was fabricating a card the product cannot populate, which is worse than
showing nothing: it puts an unbuilt feature into a store screenshot. **The simulator for
it is removed** (founder-instructed). The card itself stays in the shipped viewers,
inert, because nothing writes the field.

**OPEN, founder decision, not a session one.** The pieces exist and were never joined:
`utils/audius.js` returns CORS-open MP3s a plain `<audio>` plays, `ProfileAudio.jsx`
already does that for profiles, and `audius.js:73` already emits `source: 'audius'`.
The locked plan (memory `project-music-integration`, 2026-05-23) is Last.fm for metadata
plus Pretzel Rocks for licensed playback, in Creator Studio. Nothing here should be built
without the founder choosing between that plan and an Audius-based one.

## 2e. The port plan

`docs/LIVE_STREAM_PORT_PLAN.md`, written 2026-09-04. It carries the verified
port surface (the broadcaster and Go Live each exist TWICE, web and native; the
viewer is shared), both directions of the preview/production delta, the ordered
port steps with a verification for each, the OBS gap, and the open founder
decisions. Read it before touching a real stream screen.

## 3. Method — the holes that let defects survive a "finished" audit

Each of these produced a false clean bill on 2026-09-03.

⚠ **A source grep is not an audit.** The fake-glass and ghost-outline rules had only
ever been checked against preview SOURCE, so every shipped component the preview imports
was invisible. The founder found both still on screen minutes after the audit reported
clean. Measure the rendered page.

⚠⚠ **TRANSIENTS EXPIRE BEFORE THE SWEEP RUNS.** The poll card, tip and sub alerts, the
entry ribbon, level-up, the raid banner, the boost timer and now-playing all carry a
countdown. A sweep that walks the DOM sees whichever of them happens to be up — usually
none. **The poll card kept a ghost hairline through the entire audit for this reason,
and the founder caught it from a screenshot.** Fire each event, then measure while it is
still on screen.

⚠ **An occlusion probe that skips ancestors cannot see a badge losing to its own
wrapper.** That is exactly the shape of "the verified tick is under the broadcaster
avatar". Compare a badge's rect against the avatar's rect directly.

⚠ **The device frame is taller than the viewport.** 852px at y=178 in a 915px window
means the bottom 115px — the composer and every sheet's action row — is below the fold,
where `elementFromPoint` returns null and reads as "not reachable". Scroll first.

⚠ **Reset state between measurements.** A sheet left open by an earlier step reports the
NEXT surface's primary actions as blocked.

⚠ **Clip against every scroll ancestor.** A chat row scrolled out of its own list still
has a rect; probing it returns the page behind. First run: 20 phantom occluders, none real.

⚠ **Know what the detector cannot see.**
- `scrollWidth` ignores transforms — the rotated landscape stage reported a phantom 229px overflow.
- `backgroundColor` is transparent when the fill is a **gradient**, so a deliberately
  glossy badge (the sub alert) looks like a ring over nothing.
- `document.fonts.check()` returns **true** for a family that will actually fall back.
  Measure glyph widths instead: `Inter, system-ui` rendered 215.99px where DM Sans renders 224.18px.
- `title` is a valid accessible name, and `<Icon>` is `aria-hidden`, so a titled icon
  button is correctly named.
- The browser extension's own `claude-agent-glow-border` sits at z 2147483646 and will be
  audited as product UI unless scoped out. Scope to the device frame, not `#root`.

⚠ **A token can exist in more than one copy.** `glass`/`glassDark` were defined THREE
times. Fixing two left two whole surfaces still washed. Count the definitions.

⚠⚠ **HIT-TESTING PROVES CLICKABILITY, NEVER VISIBILITY.** `StreamLoadingCover` carries
`pointerEvents: 'none'`, so `elementFromPoint` skips it and returns the button underneath.
The reachability probe reported Leave `reachable: true` in all five playback states while
an opaque cover was painted over it. An overlay that does not take pointer events is
invisible to every hit test and fully visible to the eye. **Enumerate what PAINTS over a
rect, ignoring pointer-events, and confirm with a zoom.**

⚠ **Screenshot coordinates are not CSS coordinates.** The viewport was 2048x915 CSS
against a 1568x701 screenshot frame, a factor of 1.306. Passing screenshot coordinates to
`elementFromPoint` read a point 230px away and returned the wrong element. Convert with
`innerWidth / <screenshot frame width>`, and never assume they are the same.

⚠ **"The box with the most controls" is not the device frame.** That detector picked the
198x2784 control rail three times. Anchor on the geometry instead: walk UP from a point
known to be inside the phone and keep the ancestor with a phone aspect.

⚠ **A slice that ends at the next `},` can end inside a template literal.**
`${TTS_LEVEL},` terminated the slice mid-string, so a guard reported a missing word that
was two characters past the cut. Slice to end of line.

⚠ **A backup written by `cp` to `/tmp` in Git Bash is not `/tmp` to node**, which
resolves `C:	mp`. A negative test whose backup never existed ran the unmodified file
four times and reported four clean passes. **A negative test that cannot fail is a
control run wearing a disguise.**

⚠ **The guard writes failures to stderr.** A harness filtering `stdout` saw an empty
result and reported PASS on a rule that had fired correctly.

⚠ **Guards must be scoped and negative-tested.** Two written during this audit had to be
re-scoped: one matched the comment explaining its own fix, another used a fixed 200-char
window that bled into the next statement. A third used the substring `'S,'`, which
`LAYOUT_PRESETS,` satisfies.
