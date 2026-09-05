# HANDOVER — continuing the live-stream audit

You are picking up an audit that is **in progress, not finished**. Four waves are done and
deployed; the open items and the remaining scope are recorded. Read the files in §1 before
touching anything, and follow §2 without exception.

---

## 1. What to read, in this order

### Must read before you touch anything

| # | File | Why |
|---|---|---|
| 1 | `docs/AUDIT_RULES.md` | **The standard.** An audit is technical AND cosmetic AND UI/UX AND improvements. Five mandatory sections, the traps that produce false results, and the definition of done. |
| 2 | `docs/LIVE_STREAM_AUDIT.md` | **The running record.** §1 open items awaiting a founder decision (D1–D9), §2 what is still unaudited, §2b/wave sections what has been found, §3 method. |
| 3 | `docs/UPDATE_LOG.md` — the top 3 entries only | What the last four waves actually changed and why. Newest first. |
| 4 | `CLAUDE.md` — the first ~60 lines, then the live-stream sections | Project-wide iron rules. The audit-rules pointer is at line 7. ⚠ This file has a documented history of going stale: **when it and the source disagree, the source wins.** |
| 5 | `scripts/audit-harness.js` | Paste into the browser console. Every probe carries a comment naming the false result it produces if used wrongly — all of them were real wrong answers. Do not rebuild these from scratch. |
| 6 | `scripts/stream-preview-check.mjs` | The guard, **962 assertions**, wired into `npm run check` → `prebuild`. A failing rule blocks the build. Skim the rule headers; each names the defect it exists for. |

### The simulator — what is being audited

`/admin/stream-preview`. Read as you touch them:

- `src/screens/admin/AdminStreamPreviewScreen.jsx` — the control rail that drives every state
- `src/screens/admin/streamPreview/previewStates.jsx` — playback/chat/TTS/health states, `AudioStage`, `VpEarnedChip`, `ModChannelSwitch`, the solid palette `S`
- `src/screens/admin/streamPreview/previewChrome.jsx` — chat rows, all 16 sheets, `SheetHost`, `glass`/`glassDark`
- `PreviewBroadcasterScreen.jsx` — **three render branches** (mobile co-host, mobile immersive, desktop studio)
- `PreviewMobileViewer.jsx`, `PreviewViewerScreen.jsx`, `PreviewSoloPortrait.jsx`, `PreviewSoloLandscape.jsx`, `PreviewDesktopViewer.jsx`
- `previewSoloParts.jsx` — shared solo parts, **and a third copy of `glass`/`glassDark`**
- `previewRoles.js`, `previewAssetsContext.jsx`, `PreviewStreamStages.jsx`, `PreviewEndAndSetup.jsx`

### Shipped components the simulator imports — a fix here changes the PRODUCT

- `src/components/streams/MobileLiveViewer.jsx` — the real mobile viewer
- `src/components/streams/ChatPanel.jsx` — the real chat, both viewers
- `src/components/streams/StreamPoll.jsx`, `StreamGoalAndAlerts.jsx`, `NowPlayingCard.jsx`, `JoinAnnouncer.jsx`, `RaidControls.jsx`
- `src/components/UserAvatar.jsx`, `RankBadge.jsx`, `UserName.jsx`, `Icon.jsx`
- `src/components/DisplaySettingsApplier.jsx` — also exports `MotionPrefs`, which wraps the app

### The real screens — largely UNAUDITED (§2 of the audit doc)

- `src/screens/streams/ViewerStreamScreen.jsx`
- `src/screens/streams/BroadcasterScreen.jsx`
- `src/screens/streams/GoLiveSetupScreen.jsx`
- `src/screens/streams/StreamEndingScreen.jsx` — reachable at `/stream/ended` by injecting router state

### Styles

- `src/index.css` — the global `:focus-visible` ring and the reduced-motion rules live here
- `src/styles/surface.css` — `.vg-crest-hit`, the material system

---

## 2. IRON-CLAD RULES

### Working method

1. **MEASURE THE RENDERED PAGE. A source grep is not an audit.** Rules checked in source miss
   every shipped component the surface imports and every value the browser computes. This
   exact mistake let fake glass and the wrong typeface survive a "clean" report.
2. **EVERY PROBE NEEDS A CONTROL RUN.** Measure with the thing and without it. Three findings
   in one session were artifacts of the harness, not the product, and each would have sent a
   session rewriting working code.
3. **FIRE EVERY TRANSIENT AND MEASURE WHILE IT IS UP.** Alerts, ribbons, toasts,
   celebrations, poll cards, countdown banners all expire. A DOM sweep sees whichever happens
   to be present — usually none. **This single hole hid four defects behind a finished audit.**
4. **CHECK THE SIBLINGS BEFORE BELIEVING A FIX LANDED.** Three times in one session a fix went
   to the surface being looked at while its siblings kept the defect: the rank crest (1 of 4
   profile views), `glass`/`glassDark` (2 of 3 copies), the font (the simulator, not the real
   screens — `ViewerStreamScreen` alone had 7). **Count the definitions.**
5. **VERIFY ON THE DEPLOYED URL**, not on a local build and not by reading the diff.
6. **RESET STATE BETWEEN MEASUREMENTS** and scroll the frame fully into view first.

### Design laws — founder has stated each of these more than once

7. **NO FAKE GLASS.** No semi-transparent pill, chip, row, card or button background. Use a
   solid hex a real value step off its surface. The ONLY exception is a full-bleed scrim.
8. **NO OUTLINE LIGHTER THAN ITS OWN FILL.** Composite both against the painted backdrop. The
   only exception is an input's border — that IS the affordance.
9. **A SELECTED STATE IS A SOLID ACCENT FILL**, never a tint plus a ring.
10. **A PILL IS NOT A SWITCH.** A switch is a track with a sliding knob.
11. **NO BRAND CYAN** (`#4DFFD4`). Violet, pink, gold.
12. **NEVER DECLARE A FONT THE APP DOES NOT LOAD.** Loaded: Syne, DM Sans, DM Mono, Baloo 2,
    Material Symbols. `Inter` is NOT loaded and silently falls to the OS font.
13. **Tap targets ≥ 24×24.** Widen with a pseudo-element so layout does not move.

### Scope and authority

14. **NEVER remove a feature, screen, route, button or link without explicit permission.**
    Broken or unbuilt → build it or stub "Coming soon". When in doubt, ASK.
15. **NEVER invent or change a price, rate, limit, duration, cap or fee.** Every economy
    number is a founder decision. Record it as an open item; do not implement it.
16. **DEFERRED ITEMS GO IN `docs/LIVE_STREAM_AUDIT.md` §1 AND STAY OPEN.** Listing something
    does not close it, and a deferral never ends the audit.
17. **Do not silently narrow scope.** If a section could not be done, write it into §2 as
    **not done**, with what was tried.
18. **Zero out-of-pocket cost.** No new paid services.
19. **No em dashes in any output.** Commas, periods, parentheses, colons.

### Before you call anything done

20. **Every fix that could regress gets a guard rule in `scripts/stream-preview-check.mjs`,
    and the guard must be NEGATIVE-TESTED** — break the thing on purpose and confirm the rule
    fails with the right message. A guard that has never failed has not been shown to work.
    Five self-matching guards were written in one session; see §3 of the audit doc.
21. **Build AND deploy**, then re-measure on the live URL.
22. **Log to `docs/UPDATE_LOG.md`** (newest first) and update `docs/LIVE_STREAM_AUDIT.md`.

---

## 3. Practical setup

**Browser.** The founder has a second window logged into admin on the account tied to your
Claude in Chrome. Work on `https://vergr.app/admin/stream-preview`. If the extension reports
"not connected", say so and stop — do NOT keep auditing and report results you could not
measure. `list_connected_browsers` returning `[]` means the server is up but no browser is
attached.

**Harness.** Paste `scripts/audit-harness.js` into the console. It is cleared by every
navigation, so re-paste after each one.

**Build and deploy.**

```bash
npm run build && firebase deploy --only hosting
```

`npm run build` runs `prebuild` (eslint + all guards) first, so a guard failure blocks the
build. A build takes ~30-60s and a deploy ~30s; run them in the background and wait rather
than polling.

⚠ **Do not edit source while a build is running** — it reads the files mid-parse and fails.

**Guards.** `node scripts/stream-preview-check.mjs` on its own is the fast check (962
assertions). `npm run check` runs every guard.

⚠ **Files are MIXED LINE ENDINGS.** `MobileLiveViewer.jsx`, `UserAvatar.jsx`, `chatRelay.js`,
`playBilling.js`, `payram.js` and others are CRLF while most of the repo is LF. A multi-line
patch anchor silently matches nothing across that boundary — read the file's own endings and
normalise your anchor to them.

⚠ **A JSX comment is an expression.** Putting `{/* … */}` before the element a `map` callback
or a `&&` returns makes two children and the file stops parsing. Put it ABOVE the `map` or the
gate. This happened seven times in one session.

⚠ **Generated regex loses its backslashes** through the shell and heredoc layers. Guard rules
and codemods use `indexOf` / `includes` / `split` instead.

---

## 4. What is already done — do NOT redo it

Fixed, deployed and guarded across four waves: audio-only escaping its layer, the broadcaster
Share button, the VP chip row and status band eating taps, the top-gifters strip, rank crest
tap targets, the poll card and its dismiss, `UserAvatar`'s per-instance `<style>`, `glass` in
all three copies, the tip-goal bar, `NowPlayingCard`, the verified tick placement, the font in
both the simulator and the real screens, the level-up escaping the device frame, the global
focus ring, sheet focus trapping, chat crests owning the tab order, `dir="auto"`, and
`MotionPrefs`.

Full detail is in the top entries of `docs/UPDATE_LOG.md`. **Read them before re-fixing
anything** — several of these look absent from the source if you only grep for the old value.

## 5. Where to pick up

`docs/LIVE_STREAM_AUDIT.md` §2 lists what is not yet audited. In rough priority:

1. **The real screens** — `ViewerStreamScreen`, `BroadcasterScreen`, `GoLiveSetupScreen`. They
   need a live stream or injected router state. This is the largest remaining gap: everything
   measured so far is the simulator plus the shipped components it imports.
2. **`dir="auto"`** on stream titles, bios, poll questions and sheet copy.
3. **Reduced-motion behaviour** — `MotionPrefs` is verified mounted, but the OS query could
   not be emulated from the harness.
4. **Native** — every measurement so far is the web build in Chrome.
5. **D8** (the app shell breaks the same two design rules) is a scope decision for the
   founder, not a technical one. Do not start it without his say-so.
