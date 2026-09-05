# Stream simulator — audit #3 (complete)

**Audit only. Nothing here has been fixed.**

Supersedes the first version of this file, which stopped before the admin rail,
the Go Live screens and the event→surface matrix. This version records what I
checked, what I found, **what I got wrong**, and — at the end — **what I have
still not checked**, so the boundary is explicit rather than implied.

---

## Why the two earlier audits both passed a broken screen

| Audit | Question it asked | Blind to |
|---|---|---|
| #1 | Is the geometry right? | permissions, dead controls, false labels |
| #2 | Does this control have an `onClick`? | **whether the click leads anywhere** |
| #3 | Can I finish the task the control names? | — |

Audit #2's question was the trap: all ten moderation rows answer "yes". Every
one is wired to `onClose`. A menu of labels that dismiss themselves passes an
onClick check perfectly.

**And the biggest gap in #2 was that I never touched the admin rail** — the part
you actually use. I had not fired a single event at a single surface.

---

## TWO FINDINGS I RETRACT (my probes were wrong, not the app)

1. **"Poll never renders."** False. My detector looked for a `%` — with no vote
   cast the card correctly shows options, not results. Poll works on the
   immersive viewer.
2. **"Entrance-by-rank fires the wrong rank."** False. `JoinAnnouncer` queues
   ribbons and drip-feeds them on its own timer, so rapid clicks read the queue,
   not the click. Tested on a fresh page: `ascendant` → `ascendant.webp`. Correct.

Recording these because a check that cries wolf gets ignored, and I produced two.

---

# PART A — NEW CRITICAL FINDINGS (this round)

### A1. "Now playing" CRASHES the entire admin route ⛔ — and it is a PRODUCTION bug

Clicking **Now playing** in the rail throws and drops the whole screen to the
ErrorBoundary:

```
TypeError: Cannot read properties of undefined (reading 'color')
    at NowPlayingCard
```

Cause: `useStreamSim.js:301` writes `source: 'audius'`. `NowPlayingCard.jsx:27`
defines `SOURCE_META` with only `spotify | apple | youtube | other`, then does
`SOURCE_META[nowPlaying.source || 'other'].color`. **The `|| 'other'` fallback
catches a MISSING source, not an UNKNOWN one.**

⚠ **This is not confined to the simulator.** `NowPlayingCard` is mounted in
`MobileLiveViewer.jsx` and `ViewerStreamScreen.jsx` — both real live viewers —
and `src/utils/audius.js:73` writes `source: 'audius'` in production. **The first
real stream that plays an Audius track crashes the live viewer the same way.**

### A2. Three overlays are mounted on ONE surface out of six ⛔

Measured by enumerating every mount, not by grep-and-hope:

| Overlay | PreviewMobileViewer | SoloPortrait | SoloLandscape | ViewerScreen | DesktopViewer | Broadcaster |
|---|---|---|---|---|---|---|
| JoinAnnouncer | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| GiftFeed | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| SubAlertOverlay | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ReactionsFloor | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| StreamGoalBar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **StreamPollCard** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **BoostTimer** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **NowPlayingCard** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

So **three of the seven rail events are invisible on five of six surfaces.**
Firing a Poll or a Boost on the split view, the landscape view, the co-host
viewer, the desktop viewer or either broadcaster shows nothing at all.

Verified live: boost countdown `2.5x 29:38` renders on immersive; split and
landscape show no countdown after the same click.

### A3. My own guard could never have caught A2 ⛔

`stream-preview-check.mjs` rule 15 is *"a live surface carries the whole live
kit"*. Its `LIVE_KIT` array has five entries: GiftFeed, SubAlertOverlay,
JoinAnnouncer, ReactionsFloor, PreviewSheets. **StreamPollCard, BoostTimer and
NowPlayingCard are not in it.** I built the list from the components you had
already complained about, so it defends yesterday's bug and nothing else. The
list must be derived from *what the rail can fire*.

### A4. The landscape flag leaks into every other phase ⛔

`landscape = showSoloView && soloView === 'landscape'`. Nothing resets
`soloView` when the phase changes, so after viewing the landscape solo view:

| Phase | Frame | Result |
|---|---|---|
| Go Live (mobile) | **819×461** | content overflows, 0 controls reachable |
| Ended (mobile) | **852×393** | rendered sideways |
| Other — all six | **852×393** | rendered sideways |

Return to Live and pick Immersive and they are correct again (393×852). You
would hit this the moment you captured a landscape shot and then moved on.

### A5. Go Live — both devices are static pictures ⛔

| | Controls | Working |
|---|---|---|
| Desktop | 5 | 1 (the Advanced accordion) |
| Mobile | 5 | **0** |

- **`Go Live` is dead on both.** The phase never advances.
- Title, description, goal amount and goal reason are all `readOnly`.
- **"Advanced options (description, tags, cover, audience, quality, tips,
  source)" expands to two dead inputs.** None of the seven things it names are
  there. That label is false on the screen you would use for a Play listing
  "how to go live" capture.
- Mic / camera / Flip / "Later" / back arrow are `<span>`s, not buttons.

---

# PART B — CARRIED FORWARD FROM THE FIRST PASS (still true, re-verified)

### B1. `onOpenProfile` can never fire — no way to act on a person ⛔
`previewChrome.jsx:226` reads `e.target.dataset.uid`. **Measured `[data-uid]`
count = 0 on all four surfaces.** `ChatRow` never emits it. So tapping a name in
chat does nothing anywhere, which is why these are all impossible:
timeout/ban/mute a specific viewer · appoint a specific moderator · gift a sub to
someone you saw in chat · open any participant's profile.

### B2. All ten moderation rows only close the sheet ⛔
Timeout, Ban, Pin, Clear chat, Slow mode, Followers-only, Subscribers-only,
Banned words, **Appoint a moderator** — every one is `onClick={onClose}`. None
opens a viewer picker, a value input, a word editor, or a destructive confirm.
(Only "Verified accounts only" toggles, because I wired it last pass.)

### B3. Stream Moderation screen: ZERO clickable elements ⛔
A real review queue — "Kai · Scam link", "Yves_SB · Spam · repeated" — with
`Allow / Delete / Timeout` on each. All nine are `<span>`s.

### B4. Co-host fits only the iPhone 15 Pro ⛔
Composer overflow beyond the frame:

| | iPhone SE | iPad mini | 15 Pro |
|---|---|---|---|
| Viewer grid 4 | **+70px** | **+158px** | fits |
| Viewer panel 4 | **+70px** | **+158px** | fits |
| Broadcaster grid 4 | **+118px** | **+206px** | fits |

iPad mini panel 4: the **stage itself** ends 104px past the frame. Confirmed
visually on SE — no composer on screen, chat drawn over the lower tiles and
sliced by the frame edge.

### B5. Other confirmed defects
- Tip sheet **`Send` fires nothing** — no tip reaches the feed ⛔
- **Boost tab tiers are not selectable**, no confirm ⛔
- **Viewer Ended screen unreachable** — role toggle is gated on `phase === 'live'` ⛔
- **Mobile viewer has no Subscribe / Gift-a-Sub entry at all** ⛔
- **Gift a Sub has no search** — 6 hardcoded cast members, not the people in chat ⛔
- **No viewer list on the broadcaster** ⛔
- Desktop identity / emote / chat-settings panels: rows not clickable ⚠
- Host profile sheet: `Follow` + `Message` dead ⚠
- Mobile co-host **pre-live renders the live screen** ⚠
- `Start Stream` / `Go Live` / `End Stream` / `Back Home` / `close` / `Leave` dead ⚠
- Broadcaster More: poll / clip / share rows only close the sheet ⚠
- Desktop viewer `Chat` send button has an empty handler ⚠
- Co-Stream Setup: 2 controls, both dead · Squad Hangout: 3, all dead ⚠
- Boost sheet (Other): **zero controls** ⚠
- Moderator / Vanguard identity is not shown anywhere in chat ⚠
- Stream Analytics has no date-range control ▫

---

# PART C — WHAT PASSED (do not disturb when fixing)

- **All six rail "open a sheet" buttons work on all six surfaces** (Tip sheet,
  Creator profile, Viewer profile, Top supporters, Share, More menu).
- **Chat rail controls work**: One now grows the chat, Clear empties it, Hide
  chat hides it.
- **Entrance / Tip / Subscribe / Reactions render correctly** on the immersive viewer.
- **Entrance-by-rank is correct** when tested on a clean queue.
- **Landscape is correct on all four devices tested** — composer inside the frame
  at 15 Pro, SE, iPad mini and Galaxy S24.
- **Solo layouts correct on all six device presets.**
- Role gating (plain / moderator / vanguard), all four transitions.
- Two-tier moderation split matches the server's `loadStream` vs `loadStreamForMod`.
- Co-host tile aspects: grid 0.66, panel guests 0.80, panel host 0.667, every seat count.
- Camera-off: avatar + mic badge, seat holds position.
- Real membership tiers and prices; no invented rates; no unbuilt-feature copy.

---

# PART D — WHAT I HAVE **NOT** CHECKED

Stated plainly so you are not relying on silence:

1. The other **10 rank buttons individually** on a clean queue (I verified 1 of 11).
2. The **desktop preview at narrow admin-window widths** (frame is `100%`, max 1000px).
3. **Each of the 5 video upload slots** against every surface that should consume it.
4. **Squad Hangout / Analytics / Boost-sheet screens at the six device sizes.**
5. **Split-view control inventory** in the same depth as immersive.
6. **Keyboard focus order, tab traps and screen-reader labels** — many controls
   have only a Material ligature as their accessible name (`more_horiz`, `close`).
7. **Subscribe-alert timing per surface** — it renders and fades; I confirmed it
   on immersive but the fade may outrun a capture on others.
8. **`streamType === 'tournament'`** — the code path exists (`PreviewTournamentCard`)
   but no control reaches it. Dead code, and tournaments are retired per CLAUDE.md.
9. Whether the **"Not subscribed" toggle** changes anything downstream beyond its
   own label.

---

# PART E — HONEST ANSWER

**Not ready for the real live screens.** Two reasons, both structural:

1. **The simulator cannot act on a person** (B1). Moderating, gifting,
   promoting and reporting are almost the whole of a live stream, and every one
   of them needs "which person?" — a question no screen can currently ask.
2. **Three of the seven things you can fire only appear on one screen** (A2), and
   the guard that was supposed to prevent exactly that omits them (A3).

Plus one bug that must be fixed regardless of this project: **A1 crashes the
real live viewer**, not just the preview.

**Defect count: 30. Blocking: 13.**
