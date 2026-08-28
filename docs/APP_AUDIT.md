# Live app audit, 2026-08-18

Findings from driving the **live** app (`vergr.app`) as a signed-in user
(account **Verion**) in Chrome. Not from reading code, not from a build passing.

**This document is written to be EXECUTED by a session with no prior context.**
Every finding carries the file, the current code, the replacement, and how to
verify it. If you find yourself investigating rather than editing, that is a
defect in this document, not in your approach.

---

## Read this first (applies to every fix below)

**Build and deploy**

```bash
npm run build
firebase deploy --only hosting
```

Functions deploy by name, never all at once:

```bash
firebase deploy --only functions:<name>,functions:<name>
```

The first functions deploy of a session often fails with `Timeout after 10000`
during source discovery. **Run it again**; the code is fine, cold discovery is
slow.

**Three rules learned the hard way during this audit**

1. **Never patch JSX with a shell script.** Bash silently ate template literals
   three times and an entire `const` declaration once. That last one
   white-screened `/messages` in production for four minutes: it compiled, it
   deployed, the page was blank. Use the Edit tool.
2. **Screenshot the live page after every deploy that touches a screen**, before
   calling it done.
3. **Wait 8-10 seconds before judging a screen.** This app renders in stages
   (icons as text, then blank avatars, then complete). Four apparent findings
   during this audit were mid-render states that resolved on their own.

**Verify in the live app, not the bundle.** A passing build is not evidence.

---

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| A1 | Wallet displayed VP as coins | high | ✅ fixed |
| A2 | 3.9 MB icon font, UI renders as words | high | ✅ 8.6x smaller + deployed 2026-08-19 (name-subset not possible here, see note) |
| A3 | Buy screen prints the price twice | low | ✅ fixed + deployed 2026-08-19 |
| A4 | Support ticket exposes Invite Members + group UI | high (privacy) | ✅ fixed + deployed 2026-08-19 |
| A5 | Channels invisible on desktop | high | ✅ fixed |
| A6 | What's New page unreachable | medium, CONFIRMED live 2026-08-21 (renders fine, zero entries, zero inbound links) | 🔴 open |
| A7 | Deletion page contradicts the app | **high (Play)** | ✅ fixed 2026-08-19 — **but the finding was BACKWARDS, see below** |
| A8 | Deletion screen lists tournaments | medium | ✅ superseded, see the A8 row below (fixed with A54) |
| A9 | Poll form opens behind the toolbar | medium | ✅ fixed + deployed 2026-08-19 |
| A10 | Explore recommends you to yourself | high | ✅ fixed + deployed 2026-08-19 |
| A11 | Profile completion tracked in localStorage | medium | ✅ fixed + deployed 2026-08-19 |
| A12 | Discovery shows squads you are already in | medium | ✅ fixed + deployed 2026-08-19 |
| A13 | Vergr.me shows Share/Follow twice | medium | ✅ fixed + deployed 2026-08-19 |
| A14 | Vergr.me default theme is off-brand cyan | low | ✅ confirmed + fixed 2026-08-19 |
| A15 | `/watch` hangs on "Loading stream…" forever | medium | ✅ fixed + deployed 2026-08-19 (mobile twin too) |
| A16 | Settings advertises tournaments (2 more places) | medium | ✅ superseded, see the A16 row below (fixed with A54) |
| A17 | Settings promises sessions + trusted devices that do not exist | medium | ✅ fixed + deployed 2026-08-19 |
| A18 | Four privacy controls are wired to nothing | **high (privacy)** | ✅ fixed + deployed 2026-08-19 (1 enforced, 3 removed) |
| A19 | Opening the Vergr.me editor publishes a public page | **high (privacy)** | ✅ fixed + deployed 2026-08-19 |
| A20 | 5 of 7 Leaderboard categories can never have data | high | ✅ fixed + deployed 2026-08-19 (3 fixed incl. Top Earners, 2 removed) |
| A21 | Unknown URLs silently drop you on the home feed | low | ✅ fixed + verified live 2026-08-19 |
| A22 | "VERGR" shouted at users in 749 places | low | 🔴 open |
| A23 | `claimQuestReward` pays any quest id at a client-set price | **critical** | ✅ fixed, deployed 2026-08-19 |
| A24 | Anyone can join any squad, self-promote to president, write its treasury | **critical** | ✅ fixed, deployed 2026-08-19 |
| A25 | "For debugging" rule lets anyone vote in any squad | **high** | ✅ fixed, deployed 2026-08-19 |
| A26 | "Become a creator" modal reopens on every Studio screen | medium | ✅ fixed + deployed 2026-08-19 |
| A27 | Buy → Custom amount shows 3 different prices for one purchase | **high (money)** | ✅ fixed + deployed 2026-08-19 (it was 4, and the CTA was the correct one) |
| A28 | Memberships, KYC caps and a fake receipt still in euros | medium | ✅ fully fixed + deployed 2026-08-19 (incl. published AML policy) |
| A29 | Anyone can list, read and hijack every voice/video call | **critical** | ✅ fixed, deployed 2026-08-19 |
| A30 | `read: if true` on user docs; Vergr.me drafts are public | **high (privacy)** | ✅ fully fixed + deployed 2026-08-19 (profileVis now enforced at the data layer) |
| A31 | `/boost` is unlinked and every purchase fails | medium | ✅ fixed + deployed 2026-08-19 |
| A32 | Users can forge their own ledger rows | high | ✅ fixed, deployed 2026-08-19 |
| A33 | Paywall quotes 2-2.5x the real price; its CTA is off-screen | **high**, but **re-split 2026-08-21**: the off-screen CTA is CONFIRMED live and is the real bug; the wrong price is real in source but **renders nowhere** (every call site passes title+description) | 🔴 open, measured on a free account |
| A34 | Content library empty state blames filters that are not set | low | ✅ fixed + deployed 2026-08-19 |
| A35 | Squads section still sells tournaments; chat embed links to a dead route | medium | ✅ superseded, see the A35 row below (fixed with A54) |
| A36 | "Vergr Support" listed twice, under two headings | medium | ✅ fixed + deployed 2026-08-19 |
| A37 | Latest message of every DM readable by any account | **critical** | ✅ fixed, deployed 2026-08-19 |
| A38 | Notifications page drops the title, so rewards read as "Profile banner" | medium | ✅ fixed + deployed 2026-08-19 |
| A39 | Explore recommends unflagged guest accounts as creators | low → **medium** | 🔴 open, CONFIRMED live 2026-08-21: **30 of 40 recommended "creators" have zero followers**, incl. 6 abandoned anonymous sessions and 2 test accounts |
| A40 | In-app Help Centre crashed to a black screen | high | ✅ fixed |
| A41 | Undefined-identifier crashes; #1 (enlarge video) blanks whole app — CONFIRMED | **critical** | ✅ all 5 fixed + deployed 2026-08-19 |
| A42 | "Free Link in Bio" in the public footer is a dead link | low | ✅ fixed + verified live 2026-08-19 |
| A43 | Everyone in a group chat shows permanently Offline | medium | 🔴 open, **CONFIRMED live 2026-08-21 with root cause**: `MessagesMasterDetail.jsx:31` hardcodes `online: false` |
| A44 | **Live streaming produces no video at all** — "LIVE" is a DB flag | **critical** | ✅ root cause fixed on the box + client 2026-08-19 |
| A45 | hls.js never loaded; HLS cannot play outside Safari | **critical** | 🔴 open |
| A46 | Viewer claims 1080p60 for a 480p stream; Go Live still shows Gems | low → **medium** | 🔴 open, CONFIRMED live 2026-08-21 and **worse**: all three "Earnings · Today" fields are written nowhere, so the panel can only ever read 0 / 0 / 0 |
| A47 | Call screen crops/stretches remote video instead of letterboxing | medium | 🔴 open, **CONFIRMED on a live video call 2026-08-21 with measurements**: remote loses **16.6%** of the frame (142px of 857), self-view PiP loses **~61% of its width** (portrait box, landscape source). Both `object-cover` at `CallScreen.jsx:195,212` |
| A48 | Ending a call flashes blank, then dumps you on the empty message list | medium | 🟡 **half confirmed 2026-08-21.** The blank flash did NOT reproduce (60ms transition logger saw no empty frame). Landing on `/messages` instead of the conversation IS confirmed |
| A49 | Video send: legacy path shows no upload progress; indicator too subtle | medium | 🟡 **re-scoped 2026-08-21, see A63** — the progress ring IS built and wired on the live relay path; nobody sees it because the thread does not scroll to it |
| A50 | No error boundary — one render error blanks the whole app | **high** | ✅ fixed + deployed 2026-08-19 |
| A51 | Creating a poll in a DM hangs forever on "Creating…" | high | 🟡 **did NOT reproduce 2026-08-21** (posted in under 2s). Code is unchanged, so the unguarded `await` is still there: intermittent, not fixed. See the retest below |
| A52 | Squad chat: "Members — 2" but "No members yet" (member list not loaded) | medium | 🟡 **did NOT reproduce 2026-08-21**; both halves still in the code (swallowed `.catch`, count from the doc), so intermittent, not fixed |
| A53 | Sign-in + invite pages led with "Tournaments" (NEW, not in the original audit) | medium | ✅ fixed + deployed 2026-08-19 |
| A8 | Deletion screen lists tournaments | medium | ✅ fixed + deployed 2026-08-19 (with A54) |
| A16 | Settings advertises tournaments (2 more places) | medium | ✅ fixed + deployed 2026-08-19 (with A54) |
| A35 | Squads section sells tournaments; chat embed links to a dead route | medium | ✅ fixed + deployed 2026-08-19 (with A54) |
| A54 | Tournament sweep: every remaining user-visible trace removed (NEW) | medium | ✅ fixed + deployed 2026-08-19 |
| A55 | **Every user's raw phone number was world-readable** (NEW) | **high (PII)** | ✅ fixed + deployed 2026-08-19 |
| A56 | Adding a phone minted 1000 COINS (~$12.70), not VP (NEW) | **high (money)** | ✅ fixed + deployed 2026-08-19 |
| A57 | **Support threads could be voice/video called, ringing agents' personal accounts** (NEW) | **high (abuse)** | ✅ fixed + deployed 2026-08-21 |
| A58 | Support + community channel avatars never rendered (`groupIcon` vs `groupAvatar`) (NEW) | medium | ✅ fixed + deployed + **verified live 2026-08-21** (both render, 34x34, opacity 1) |
| A59 | Mobile nav showed unlabelled dots, not counts; bell count wrong; Calls read the wrong collection (NEW) | medium | ✅ fixed + deployed 2026-08-21 |
| A60 | Squads hub had no mobile layout at all (NEW) | medium | ✅ fixed + deployed 2026-08-21 |
| A61 | No back navigation on ANY squad screen on mobile web; oversized floating hamburger (NEW) | medium | ✅ fixed + deployed 2026-08-21 |
| A62 | Play Console "5 actions recommended" on the 1.0.201 bundle (NEW, native) | medium | 🟡 **2 fixed IN SOURCE, not in any build** |
| A63 | **Sending media does not scroll the thread to it, so the sender sees nothing happen** (NEW) | **high** | 🔴 open, CONFIRMED live 2026-08-21 |
| A64 | Video messages render as a black 300x150 box reading 0:00 / 0:00 until you play them (NEW) | medium | 🔴 open, CONFIRMED live 2026-08-21 |
| A65 | Composer video preview sits on a bare spinner for several seconds with no label (NEW) | low | 🔴 open, observed 2026-08-21 |
| A66 | **Squad Announcements composer is white text on a white box, you cannot see what you type** (NEW) | **high** | 🔴 open, CONFIRMED live 2026-08-21 (`.composer` vs `.composer-box`) |
| A67 | "View Treasury" 404s from every squad screen; no route and no screen exists (NEW) | medium | 🔴 open, CONFIRMED live 2026-08-21 |
| A68 | **Admin reports USD revenue in euros** (MRR "€9.99" for a $9.99 sub), plus a stale `100c ≈ €0.90` conversion in the revenue total (NEW) | **high (money reporting)** | 🔴 open, CONFIRMED live 2026-08-21 |
| A69 | **Change plan modal quotes $5.81 / $11.64 instead of $4.99 / $9.99** (USD price fed into a EUR→USD converter); regional multiplier not applied; Free shown as "€0" (NEW) | **high (money)** | 🔴 open, CONFIRMED live 2026-08-21 on a free account |
| A70 | **Vergr Support loses its verified badge the moment you use it** (badge gated on `isOfficial`, which only exists on client-built synthetic rows; the real doc has `supportThread` instead) (NEW, founder-spotted) | **high (trust)** | 🔴 open, CONFIRMED against the stored document 2026-08-21 |
| A71 | Three of four in-feed ad slots are never processed by AdSense and each leaves a **631px empty card** in the For You feed (NEW) | medium | 🔴 open, CONFIRMED live 2026-08-21 on a free account |
| A72 | Notifications page prints the sender's name twice ("Vergr Vergr"); **regression introduced by the A38 fix**, the drawer gets it right (NEW) | medium | 🔴 open, CONFIRMED live 2026-08-21 |
| A73 | `@xboxwire` published xbox.com's navigation bar as a post body, and it is the top post in For You (1 of 28 sampled, so not systemic) (NEW) | low | 🔴 open, CONFIRMED live 2026-08-21 |
| A74 | Composer sells **Schedule as PRO when Lite already unlocks it** (gate is right, badge is wrong), steering free users to the $9.99 plan (NEW) | medium (money) | 🔴 open, CONFIRMED live 2026-08-21 |
| A75 | At 500px the composer toolbar is drawn **through** the Topics section (19px overlap); same family as A9, different instance (NEW) | medium | 🔴 open, CONFIRMED live 2026-08-21 |
| A76 | Wallet subtitle still reads "Your wallet, your earnings" on web and native, in the one surface the founder deliberately stripped of every earnings affordance (NEW) | low (but a locked decision) | 🔴 open, CONFIRMED live 2026-08-21 |
| A77 | **Chat/Community badge sums four different UNITS** (messages + squads + calls + requests), so the number matches nothing the user can open. **This is the answer to the founder's open "what is the 16 count" question** (NEW) | medium | 🔴 open, CONFIRMED live + in source 2026-08-21 |
| A78 | Admin "Free Users" reads 0 forever: it queries `subscription == 'free'`, but free users have **no such field** (never written at signup) (NEW) | medium | 🔴 open, CONFIRMED live 2026-08-21 |
| A79 | **9 of 11 admin "HEALTHY" status pills are hardcoded green**; the Dashboard's five have no status value at all and would read HEALTHY during an outage (NEW) | medium | 🔴 open, CONFIRMED live 2026-08-21 |
| A80 | Live Stats **Active Now / WAU / MAU / all device counts are always 0** — Timestamp compared to a raw number. **The same bug was fixed in `adminDashboard.js` and `adminUsers.js` on 2026-08-21 and missed in `adminStats.js`** (NEW) | **high** | 🔴 open, CONFIRMED live 2026-08-21 |
| A81 | "Total Users" reads **52** on Live Stats and **18** on the Dashboard and Users screen (different populations, identical label) (NEW) | medium | 🔴 open, CONFIRMED live 2026-08-21 |
| A82 | **Incoming calls show the caller's GOOGLE account name and photo** ("Verge Nerd" + a googleusercontent URL) instead of their Vergr identity; leaks the caller's real name, breaks the Vanguard mask, and reaches the push too (NEW, founder-spotted) | **high (privacy)** | 🔴 open, CONFIRMED from the stored call document 2026-08-21 |
| A83 | 1:1 calls never connect (founder-reported from his phone) | was **critical** | 🟢 **DID NOT REPRODUCE on web 2026-08-21.** A real voice call connected browser-to-browser: answer SDP written 1.1s after accept, `status: active`, timer running, two live audio tracks, zero console errors. Most likely his **stale APK**. The un-timed-out wait in `answerCall` is still worth hardening |
| A85 | **Accept and Decline have no accessible name** — their text is the raw ligature `"call"` / `"call_end"` and there is no `aria-label` (NEW) | medium (a11y) | 🔴 open, CONFIRMED live 2026-08-21 |
| A86 | **No call entries in the conversation thread** (WhatsApp shows them in both places). `calls_history` already stores `chatId`, `type`, `answered`, `durationSec`; the `/calls` tab renders them well; the thread renders nothing (NEW, founder-spotted) | medium | 🔴 open, CONFIRMED live 2026-08-21 |
| A87 | `getCallHistory` fetches the whole `calls_history` collection with no query `limit` and sorts client-side; the list took ~16s to paint. Missed calls also print a duration of "0" (NEW) | low | 🔴 open, CONFIRMED live 2026-08-21 |
| A88 | **Calls right panel drifts below the fold and clips** ("Schedule a Call" invisible): `justify-center h-full` centres inside a `min-h-screen` shell that stretches to the CALL LIST height (1345px vs a 714px viewport), so it worsens with every call made (NEW, founder-spotted) | medium | ✅ FIXED + DEPLOYED 2026-08-22, verified live (all ancestors now 732px = viewport, all 3 cards visible) |
| A89 | **Missed calls render a literal `0` duration** — JSX falsy render, `{call.duration && ...}` prints `0` (NEW) | low | ✅ FIXED + DEPLOYED 2026-08-22, verified live |
| A90 | **Call list took 13.3s cold** — `getCallHistory` fetched EVERY row with no orderBy/limit, plus an N+1 that refetched the SAME user doc 20x sequentially (NEW) | high | ✅ FIXED + DEPLOYED 2026-08-22, measured 13,331ms → 4,785ms |
| A91 | ⚠ **Crossing the mobile/desktop breakpoint REMOUNTS the call screen and kills a live call** — ResponsiveLayout returns 5 different trees; timer reset 1:21→0:02, remote tracks MUTED, videoWidth 0, while the doc still read status:active. Same signature as A83 (NEW, reproduced both directions) | **critical** | ✅ FIXED + DEPLOYED 2026-08-22 (call routes moved outside MainLayout). ⚠ Underlying ResponsiveLayout remount hazard REMAINS for other screens |
| A92 | **15 nav controls stayed keyboard-focusable behind the full-screen call overlay** — Tab+Enter navigates away mid-call (NEW) | medium | ✅ FIXED + DEPLOYED 2026-08-22, verified `shellFocusableCount: 0` |
| A93 | **Call screen typography**: callee name 12.25px (smaller than a 13px nav label), timer 10.5px, "P2P ENCRYPTED" 8px at 30% opacity (the only trust signal, effectively invisible) (NEW) | medium | ✅ FIXED + DEPLOYED 2026-08-22 |
| A94 | **Mobile: "Calls" title and new-call button rendered TWICE** (TopBar + panel header both draw them) (NEW) | medium | ✅ FIXED + DEPLOYED 2026-08-22, verified dupTitles 2→1 |
| A86 | **Calls never appeared in the conversation thread** (WhatsApp shows them) — built as a live render-time merge of `calls_history`, so all PAST calls appear too and thread/Calls tab cannot disagree | high | ✅ FIXED + DEPLOYED 2026-08-22, verified live |
| A82 | **Incoming calls showed a bare "V"** — `auth.currentUser.displayName` won over `profile.displayName` in `startCall` | medium | ✅ FIXED + DEPLOYED 2026-08-22 |
| A95 | ⚠ **Squad shell was taller than the viewport, so the DOCUMENT scrolled** — `.sqd-mtop` (56px) sits above a `height:100vh` `.app`; measured 786px in a 730px viewport. Header AND composer scrolled away; `.messages` never got a bounded parent, so it was not a functional chat (NEW, founder-reported) | **high** | ✅ FIXED + DEPLOYED 2026-08-22, verified only `SECTION.messages` scrolls |
| A96 | **Squad composer sat under the phone's navigation bar on the APK** — safe-area inset applied at the top but never at the bottom (NEW, founder-reported) | high | ✅ FIXED, source; ships in 1.0.203 |
| A97 | **Squad composer had 14 controls at rest**, two of them near-duplicates ("Share an event" vs "Share event") (NEW, founder-reported) | medium | ✅ REDESIGNED + DEPLOYED 2026-08-22 → 4 controls, nothing removed, every action now labelled |
| A98 | **Native squad chrome is a different component from the web** — `NativeSquadScaffold` used a generic TopBar plus a floating bottom hamburger, the exact antipattern SquadShell's own comment says it removed (NEW, founder-reported) | medium | ✅ FIXED + SHIPPED in 1.0.203 (2026-08-22) |
| A99 | ⚠ **SECURITY: any signed-in user could write a message into ANY conversation** — the messages CREATE rule checked only `senderId == uid`, not participant membership (read/update/delete all did). DM ids are derivable + uids world-read, so it bypassed blocks, privacy tiers and the stranger-media gate (NEW) | **critical** | ✅ FIXED + DEPLOYED 2026-08-22, verified live (foreign write 403, own DM 200) |
| A100 | ⚠ **DM "Choose on Map" was broken AND paid** — loaded Google Maps JS API with undefined key (hung) and Google Maps is billing-required (NEW, founder-requested test) | high | ✅ FIXED + DEPLOYED 2026-08-22 — rewritten as free Leaflet+OSM picker (no key), verified live (tap→pin→reverse-geocode→send) |
| A101 | **DM location bubble was raw coordinates + NOT tappable** (NEW) | medium | ✅ FIXED + DEPLOYED 2026-08-22 → FINAL STATE is the pixel-matched map card with a **Google Static Maps** dark thumbnail via the `/maptile` proxy (see "COIN + MAP CARDS" section at end). Tappable → phone Google Maps. |
| A102 | **Chat relay dropped structured message payloads** (`location`/`wallet`/`contact`) — `sendMsg` forwarded a fixed field list AND `mediaKind` returned '' for non-media types, so the payload never reached the recipient and echoed back as `text` (NEW) | high | ✅ FIXED + DEPLOYED 2026-08-22 — relay now carries the structured objects end to end |
| A103 | **Sending coins from a DM left no thread record**, then rendered as a lazy text bubble with a money emoji (NEW, founder-requested) | high | ✅ FIXED + DEPLOYED 2026-08-22 → FINAL STATE is the pixel-matched `CoinCard` (small <1000 / grand ≥1000), VC medallion, Baloo gold number, optional note, traveling glow (see "COIN + MAP CARDS" section at end). Small verified live; large harness-verified. |
| A104 | **Tips never pushed** — `type:'tip'` absent from `PUSHABLE_NOTIFICATION_TYPES` (which was 100% dead tournament types) and `sendTip` does no inline push (NEW) | medium | ✅ FIXED + DEPLOYED 2026-08-22 (added 'tip'); founder can veto |
| A105 | **Tip notification says "Someone tipped you", not the sender's name** (NEW) | low | 🟡 FLAGGED — possible privacy intent, founder call |
| A106 | **Send-coins default amount is 500 coins** (~$5.80), a steep one-tap default (NEW) | low | 🟡 FLAGGED — product call |
| A84 | **No ringtone.** `/sounds/ringtone.mp3` does not exist, so every call falls back to a notification chime, and both `play()` calls are swallowed against autoplay blocking. `IncomingCallManager` is a second, unmounted copy of the whole feature (NEW, founder-reported) | medium | 🔴 open, CONFIRMED 2026-08-21 |
| — | ⚠ **SCOPE GAP: this entire audit is WEB.** Nothing has been executed inside the APK, and the installed APK predates the 2026-08-21 deploy. See the scope note at the end of the 2026-08-21 session. | — | ⚠ open limitation |

⚠ **A45 status is STALE, not confirmed.** The table below still says 🔴 open, but
`src/components/streams/HlsPlayer.jsx:10` now imports `hls.js`, branches on
`canPlayType('application/vnd.apple.mpegurl')` for Safari (line 105) and otherwise
runs `loadSource`/`attachMedia` (lines 210-211), with `hls.js ^1.6.16` and
`p2p-media-loader-hlsjs ^2.2.2` both in `package.json`. **This was not fixed by the
2026-08-21 session and has NOT been verified live**, which per A45's own Verify step
needs a real stream played in Chrome. Someone should confirm and then close it.
Left as open deliberately rather than marked done off a source read.

**Suggested order.** The six rules/server findings first: they are the shortest
diffs in the whole list and the only ones an attacker can reach without the UI.
**A37** (every DM's latest message readable by anyone), **A29** (call
interception + IP leak), **A24** (mints coins via the Vanguard treasury cron),
**A23** (mints VP), **A32** (forgeable ledger), **A25** (squad vote stuffing).
Five of the six are edits to `firestore.rules` and can ship as one deploy:
`firebase deploy --only firestore:rules`.

⚠ A37 and A29 both need care rather than a blanket deny: each open rule is
load-bearing for a real flow (public-group self-join, and the incoming-call
query). Both findings spell out what to preserve. Read them before editing.

Then **A7** (Play blocker, copy only) → **A27** (wrong price on the live
checkout) → **A30, A19, A4, A18** (privacy) → A15, A10, A12 (small, contained)
→ A20, A26, A31 → A11 → A9, A3, A6, A8, A13, A14, A16, A17, A21, A28 → **A2
last** (largest).

**Copy-only fixes, if you want a fast first pass:** A7, A8, A16, A17. Four
files, no logic, and A7 is the Play blocker.

---

### ✅ The six rules/server findings are DONE and deployed (2026-08-19)

A37, A29, A24, A25, A32 (`firestore.rules`) and A23 (`functions/index.js`
+ one new index) are live. **Three of them do NOT match the fix this document
proposed, because the proposal would have broken a working flow. Read these
before "correcting" the rules back:**

1. **A29 — `allow list: if false` was NOT used.** This document claimed the
   `participants array-contains` query in `IncomingCallManager` is "satisfied by
   the `get` rule's condition". It is not: an `array-contains` query is a LIST
   and is evaluated against the `list` rule, so denying list outright would stop
   every incoming call from ringing. Shipped as a participant-gated `list`,
   which closes enumeration just as effectively (an unconstrained
   `getDocs(collection('calls'))` cannot satisfy it) and is the same pattern
   `conversations` and `calls_history` already use.
   Also: the proposed `request.resource.data.participants == resource.data.participants`
   on update would have broken group calls. The call doc id is the stable chat
   id and the client `setDoc`s it whole on every new call, so a group whose
   roster changed since the last call would be refused. There is an explicit
   "restart a finished call" branch instead.
2. **A37 — `get` could not be closed to participants only.** A NON-participant
   legitimately reads a group's doc on the invite landing page
   (`getGroupForJoin`, `firestore.js:3202`), for PRIVATE groups too. Shipped as:
   participants always, plus group previews except support threads (whose ids
   are guessable as `support_<channelId>_<uid>`; ordinary group ids are addDoc
   auto-ids). Verified `supportChannel.js:157` sets `visibility: 'private'`.
3. **A25 — the vote doc is NOT one per voter.** This document suggested
   `voteId == request.auth.uid`; the actual shape is one auto-id doc per POLL
   with a `voterIds` array, so that would have broken voting outright. One
   ballot per member is enforced on `voterIds` instead.

Three things worth knowing about A23:

- `add_phone` was **double-paying**. `savePhoneNumber` already awards its 1000
  VP against the one-time claim `${uid}_add_phone`, while this callable keyed
  the same quest per-DAY, so it was a fresh 1000 VP (2000 on Pro) every day.
  The registry's `oneTime` flag closes it.
- **This document's list of seven unverified quests was missing an eighth.**
  `first_event` ("Host an Event", 100 VP) is offered by the NATIVE `/earn`
  screen only (`NativeHomeScreens.jsx:279`) and had no server handling at all,
  so it paid for nothing like the rest. Found by cross-checking every id in
  both `QUEST_DEFS` copies against the registry, which is a check worth
  re-running after any quest change:

  ```bash
  # every client card must have a server entry, or it is a button that can only fail
  grep -o "id: '[a-z_0-9]*'" src/screens/home/EarnCoinsScreen.jsx src/screens/home/native/NativeHomeScreens.jsx
  ```
  Verified: all 17 client cards now have a registry entry AND the card's
  advertised amount equals the server's.
- `daily_like` needed a new `likes` COLLECTION_GROUP index (`userId`,
  `createdAt`), added and deployed. The other verifiers reuse indexes that
  already existed.

### ✅ The five rules findings are PROVEN, not just deployed

`tests/rules/` is a Firestore-emulator harness added for this (`cd tests/rules
&& npm install && npm test`). **46 assertions, all passing.** It is
self-contained — its own `package.json` and its own pinned `firebase-tools@13`,
because firebase-tools 14+ needs JDK 21 and this machine has 17 — so it cannot
affect the app build or the deploy CLI. It reads the real `firestore.rules`, so
it can never test a stale snapshot.

It asserts both halves: that each hole is closed, AND that the flow behind it
still works (incoming call rings/answers/ends, public-group self-join, private
group invite page, public-squad join, squad vote casting, reading your own
ledger). **Run it before and after any future `firestore.rules` change** — A30
and A19 both touch that file.

⚠ Still NOT proven: **A23**, the quest registry. Rules are provable offline;
that callable is not, without a functions-emulator harness. It was verified
statically instead (syntax, claim-id keying against the previous behaviour,
full client/server id and amount coverage). The remaining live check is cheap:
on `/earn`, press a daily quest you have NOT done and confirm it now refuses
with a specific reason, then do the task and confirm it pays.

---

## ✅ A1. Wallet displayed VP as coins — FIXED

Context only, no action needed.

Recent activity showed `5-day login streak: +50 VP` with the amount reading
`+50 c`. The server writes `currency: 'vp'` (`functions/index.js:1091`) and every
wallet surface printed `currency === 'usd' ? '' : 'c'`, treating any non-USD row
as coins.

Fixed with a shared `txUnit()` in `src/components/wallet/primitives.jsx`, applied
in `wallet/v2/HomeScreen.jsx`, `wallet/v2/HistoryScreen.jsx` and two places in
`wallet/native/NativeWalletScreens.jsx`. Unknown currencies return an empty
suffix rather than guessing. Verified live.

---

## 🟡 A2. Icon font is 3.9 MB; the UI renders as words while it loads

**Files:** `public/fonts/material-symbols-outlined.woff2` (the asset to replace),
the `@font-face` in `index.html`, and every `<Icon name=...>` call site in `src/`
(the name set to subset against).

**Largest job on the list. Do it last, do not rush it.**

### Evidence

| | |
|---|---|
| decoded size | 3,856 KB |
| processing time | 1,930 ms **from cache** |
| `font-display` | `block` |

`block` hides glyphs ~3s then falls back to the ligature source text. The font
exceeds that window, so pages paint as literal words. Captured on the home feed,
wallet, profile and deletion screen. The profile page rendered its **entire**
icon set as text at once: `menu_open`, `home`, `check_circle`, `notifications`,
`visibility`, `favorite`, `expand_more`.

`font-display: block` is the correct value for an icon font. **The size is the
problem.** Do not switch to `swap`; that shows the raw words immediately and is
worse.

### Why the obvious fix is dangerous

275 distinct icons appear as string literals, but **456 usages pass a variable**:

```jsx
<Icon name={BOOST_ICONS[type]} />
<Icon name={KIND_ICON[row.kind] || 'inbox'} />
<Icon name={`format_align_${a}`} />
<Icon name={archivedView ? 'unarchive' : 'archive'} />
```

A subset built only from literals would silently turn hundreds of icons into raw
text: worse than today, and it would look like a regression.

### **Fix.** How to do it safely

1. **Collect the full name set** from three sources into one list:
   - literals: `grep -rhoE '<Icon\s+name="[a-z0-9_]+"' src/`
   - lookup tables: every object whose values are icon names (`BOOST_ICONS`,
     `KIND_ICON`, `TYPE_ICONS`, `MEDIA_ICON`, `SOURCE_ICON`, `CALL_TYPE_ICONS`,
     `ICONS`, `STEPS[].icon`, plus the `a.icon` / `b.icon` shapes)
   - interpolated: `format_align_*` and any other template-literal names, which
     must be enumerated by hand
2. **Generate the subset.** Google Fonts supports an `icon_names` parameter:
   ```
   https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&icon_names=<comma,separated,list>
   ```
   Fetch with a browser User-Agent or you get TTF instead of WOFF2. Extract the
   `url(...)` from the returned CSS, download to
   `public/fonts/material-symbols-outlined.woff2`.
3. **Verify before shipping.** Render every collected name against the new font
   in a scratch page and confirm none falls back to text. Width is the reliable
   check: a working ligature is ONE glyph, so at `font-size:48px` a name measures
   ~48px; a broken one measures 100px+.
4. Confirm the file still starts with the magic bytes `wOF2`.
5. Deploy, hard-reload the live site, screenshot.

**Expected:** ~40 KB instead of 3,856 KB.

**Keep the gstatic fallback** already present as the second `src` in the
`@font-face`, so a missing glyph degrades to the full CDN font rather than text.

**Verify.** Steps 3 to 5 above are the verification, and none of them is
optional. In addition, after deploying, walk the app with a cold cache and
confirm no screen shows an icon name as words: Home, Explore, Messages, Wallet,
Settings, Creator Studio and the composer are the dense ones.

---

## 🔴 A3. Buy screen prints the price twice

**File:** `src/screens/wallet/v2/BuyScreen.jsx`

A pack renders `$0.99` and directly beneath it `≈ $0.99 · charged in USD`. The
second line shows a local-currency estimate, but when the viewer's currency is
already USD it repeats the number and reads as a rendering fault.

**Fix.** In `PackCard`, suppress the estimate line when the local currency equals
the charged currency. The component already has both values; this is a
conditional, not new logic.

**Verify.** `/wallet/buy` shows one price per card.

---

## 🔴 A4. A support ticket is rendered as a full group chat

**Files:** `src/screens/messages/ChatThreadScreen.jsx` and the screens it links
to (`ChatDetailScreen.jsx`, `GroupInfoScreen.jsx`, `ChatSettingsScreen.jsx`).
Support threads are group `conversations` docs created by
`functions/supportChannel.js` (`resolveSupportChannel`), so they inherit every
group affordance unless the thread type is checked.

**Privacy. Fix early.**

### What the user gets

Settings → Message support creates the thread correctly, then hands the user the
whole group-chat affordance set:

| Offered | Why it is wrong |
|---|---|
| **Invite Members** | The user can add a stranger to their own private support conversation, who then reads the entire history |
| **MEMBERS panel** (OWNER / ADMIN) | Exposes support staffing to the person raising a ticket |
| **Auto-delete** | Lets the user set their own support record to self-destruct |
| **Report** | Points at the support team they are talking to |
| Listed under **GROUPS** with `#` | Should read as an official channel |

### Why

A support thread is deliberately a **group** `conversations` document (see
`functions/supportChannel.js`: the DM relay path is ciphertext so only the two
endpoints can read it, and support must be readable by whichever agent picks it
up next). **That decision is correct, do not revert it.** What was never done is
suppressing the group UI it inherits.

### **Fix.**

The thread carries `supportThread: true` and `supportUserId`. Key everything off
that flag.

1. **`src/screens/messages/ChatThreadScreen.jsx`** — there is already a
   `supportUserId` derived value from the agent-masking work; add beside it:
   ```js
   const isSupportThread = chatInfo?.supportThread === true;
   ```
   Then hide, when `isSupportThread`: the members panel, the Invite Members
   button, the roster, and the **Auto-delete**, **Report** and rename entries in
   the overflow menu. Keep Search, Mute and Clear chat.
2. **All three inboxes** — `src/components/MessagesListPanel.jsx` (desktop),
   `src/screens/messages/MessagesInboxScreen.jsx` (mobile web),
   `src/screens/messages/native/NativeMessageScreens.jsx` (native).
   A support conversation has `isGroup === true`, so it lands in the Groups
   section **as well as** appearing as its official channel row. Confirmed live:
   **"Vergr Support" appears twice in the list.** Filter it out of the groups
   list with `c.supportThread !== true`.
3. **Delete Chat** on a support thread should follow the channel rule (hide until
   the next message) rather than orphaning the thread while the agent's queue row
   survives.

**Verify.** Open support as a normal user: no Invite Members, no members panel,
no Auto-delete, and exactly ONE "Vergr Support" row in the inbox.

---

## ✅ A5. Official channels were invisible on desktop — FIXED

Context only. Desktop `/messages` renders `src/components/MessagesListPanel.jsx`,
which had zero channel support while the mobile and native inboxes had it. Added
the same helpers (`subscribeOfficialChannels`, `subscribeChannelState`,
`buildOfficialRows`, `resolveChannelTarget`, `syncChannelPushSubscriptions`), the
verified badge, and routed pin/archive to `setChannelPinned` /
`setChannelArchived` — an official row's id is synthetic
(`official:<channelId>`) with no conversation document behind it, so
`setChatPinned` would have written to nothing. Verified live.

---

## 🔴 A6. The What's New page is linked from nowhere

**Files:** `src/screens/marketing/PublicMarketingScreens.jsx` (footer),
`src/screens/settings/SettingsScreen.jsx` (About row). The page itself is fine
and needs no change.

`/whats-new` renders, is prerendered and is in `sitemap.xml`. Nothing links to
it, so it is reachable only by typing the URL or from a search engine.

**Fix.** Two links:

1. **Marketing footer** — rendered by the marketing shell in
   `src/screens/marketing/PublicMarketingScreens.jsx`. Add "What's new" to the
   **COMPANY** column beside About / Careers / Contact / Delete Account.
2. **Settings → About** — in `src/screens/settings/SettingsScreen.jsx` the
   `about` card links to `/settings/about`; add a row navigating to `/whats-new`.

**Verify.** `/platform` footer link resolves.

---

## ✅ A7. Deletion copy contradicted the app — FIXED 2026-08-19

> ⚠ **THIS FINDING WAS BACKWARDS, AND ACTING ON IT AS WRITTEN WOULD HAVE MADE
> THINGS WORSE.** Everything below the line was written on the assumption that
> the in-app 30-day grace period is the real behaviour and the public page is
> the lie. **It is the other way round.** Read from code on 2026-08-19:
>
> - `AccountDeletionScreen.jsx` `handleDelete` calls Firebase **`deleteUser()`
>   directly**. The auth account is destroyed synchronously.
> - `onUserDeleted` (`functions/index.js:2699`) then immediately soft-deletes
>   the user doc and **nulls username, email, avatar, banner and bio**.
> - `grep`ing `functions/` for a scheduled deletion, `deletionRequestedAt`, a
>   purge cron or any undelete path returns **nothing**. No grace period exists
>   anywhere, and there is no way to "log back in to cancel" because the account
>   you would log in with is already gone.
>
> So the public page's "Deletion begins immediately" was **correct**, and the
> IN-APP screen was the false one: a 30-day timeline, "your username can be
> claimed by others after 30 days" (it is released instantly), and an explicit
> promise that you can cancel by signing back in.
>
> Following this document's instruction — "Correct the public page to describe
> [the grace period]. Do not change the app to match the page." — would have
> published a **false statement about data handling onto the exact page Google
> Play reviews**, and left real users believing a permanent action was
> reversible. **This is the clearest example in this audit of why a finding gets
> re-derived from code before it is actioned.**
>
> **What shipped instead** (founder decision 2026-08-19, asked because building a
> real grace period versus correcting copy are opposite work): match the copy to
> the code. In-app timeline is now Now / Immediately / Permanent, the header
> reads "This happens immediately, and cannot be undone", and the InfoBar says
> there is no grace period and no cancellation, pointing users who just want a
> break at Sign out instead. The public page gained "and cannot be cancelled or
> undone", and its email route now spells out that the 30-day figure is a
> processing SLA, **not** a grace period — the ambiguity this document correctly
> flagged.
>
> **Verified:** public page read live in a browser, both sentences serving. The
> in-app screen is behind auth so it was verified from the shipped bundle: the
> three false strings are absent from `dist/`, the three corrected ones present.
> Worth one visual check at `/settings/delete-account` next time someone is
> signed in.
>
> ⚠ **A real 30-day grace period is still a reasonable thing to WANT** — this
> document called it good design and it is what the screen promised for months.
> It is not built. If it is ever built, it is a feature (scheduled deletion,
> keeping the auth account alive so login can cancel, a purge cron) and **both
> surfaces move back together**, never one without the other.
>
> ⚠ Note for verification generally: this document's suggested
> `curl -s https://vergr.app/platform/delete-account | grep -i "30 days"` cannot
> work. `scripts/prerenderHelp.mjs` emits only an SEO stub (h1, title,
> description) for marketing routes; the body renders client-side. `curl` sees
> the SPA shell. Load the page in a browser to check marketing copy.

---

<details>
<summary>Original finding as written (premise incorrect, kept for the record)</summary>

**Do this first. Copy only, and the only genuine risk here to a Play submission.**

**Public page** (`/platform/delete-account`), in the footer, what a reviewer
reads:

> Confirm. Re-enter your password (and your second factor, if enabled) to
> confirm. **Deletion begins immediately.**

**In-app** (`/settings/delete-account`), what actually happens:

> **We'll delete your account in 30 days.** Today: you started account deletion.
> In 30 days: your account and data will be permanently deleted. During this
> 30-day period, you can cancel the deletion process by logging back in.

The 30-day grace period is a good design. **Correct the public page to describe
it. Do not change the app to match the page.**

**File:** `src/screens/marketing/PublicMarketingScreens.jsx`, the
`DeleteAccountScreen` component. Search for `Deletion begins immediately`.

**Fix.** Replace that step's body with the real behaviour, e.g.:

> Confirm. Re-enter your password (and your second factor, if enabled). Your
> account is then scheduled for deletion in 30 days. You can cancel at any time
> during those 30 days by signing back in. After 30 days everything below is
> permanently removed.

Check the email route in the same file at the same time: it promises action
"within 30 days", a different mechanism with a coincidentally similar number.
Make both read consistently so a reviewer is not left guessing which applies.

**Verify.**
`curl -s https://vergr.app/platform/delete-account | grep -i "30 days"` and read
the rendered page.

</details>

---

## 🔴 A8. The deletion screen still lists tournaments

**File:** `src/screens/settings/AccountDeletionScreen.jsx`

Under "What will be deleted":

> Your activity and progress — **Match history, tournament entries**, squad
> activity, and stats

Tournaments were retired 2026-08-09 and their content deleted 2026-08-16;
`public/llms.txt` states publicly that Vergr has no prize competitions. A
compliance-adjacent screen must not describe data from a feature that does not
exist.

**Fix.** Replace with what the account actually holds, e.g. "Your posts, clips,
squad activity, VP and stats." Grep the same file for other tournament wording.

**Verify.** Load `/settings/delete-account` and confirm no tournament or match
wording appears. `grep -in "tournament\|match history" src/screens/settings/AccountDeletionScreen.jsx`
must return nothing.

---

## 🔴 A9. The poll form opens behind the composer toolbar

**File:** `src/components/composer/CreateComposer.jsx`

Clicking **Poll** expands the composer but the modal does not adjust its scroll
position, and the tool row (Media / GIF / Poll / Clip / …) is pinned to the
bottom of the modal. The toolbar is drawn **on top of the Poll Question input and
the Quick templates**, placeholder text showing through it. One scroll fixes it;
everything below is correct. The field you must fill in first is the obscured one.

**Fix, either works:**

- Add bottom padding to the modal's scroll container equal to the toolbar height
  so content can never sit under it. More robust, and protects every other mode.
- Or scroll the newly revealed section into view when the composer mode changes.

**Verify.** Open the composer, click Poll, confirm the Poll Question field is
fully visible without scrolling.

---

## 🔴 A10. Explore recommends the signed-in user to themselves

**Files:** `src/screens/explore/ExploreScreen.jsx` (the `realCreators` effect,
~line 181) **and** `src/screens/explore/native/NativeExploreScreen.jsx`. Fix both.

Observed signed in as Verion: "Recommended Creators" listed **Verion**, plus
`playerxn8k`, `playera07n`, `vvttvtvtitvt`, `yoiuyt`, `apptester115` — all 0
followers, no avatar.

Current filter:

```js
.filter((u) => u.username
  && u.isGuest !== true
  && !/^guest_/i.test(u.username)
  && u.hideFromEnumeration !== true
  && !hiddenFromDiscovery(u, 'suggested'))
```

Misses two things:

1. **The viewer** — no `u.uid !== me` check.
2. **The `player####` accounts** — abandoned anonymous sessions documented in
   `CLAUDE.md`: `baseHandle()` falls back to `'player'` when a doc has no
   displayName and no email; `'player'` is in `RESERVED`, so the generator emits
   `player` + 4 random characters. They carry neither `isGuest: true` nor a
   `guest_` prefix, so both existing guards miss them.

**Fix.** Add self-exclusion, and rather than adding a third prefix to a denylist
that has already failed twice, require a minimum signal before an account can be
*recommended*:

```js
.filter((u) => u.uid !== meUid
  && u.username
  && u.isGuest !== true
  && !/^guest_/i.test(u.username)
  && u.hideFromEnumeration !== true
  && !hiddenFromDiscovery(u, 'suggested')
  // No picture, no followers and no posts is not a creator anyone benefits from
  // seeing. This also removes the abandoned `player####` sessions without
  // needing to name them.
  && (!!(u.avatar || u.photoURL) || (u.followerCount || 0) > 0 || (u.postCount || 0) > 0))
```

`meUid` comes from `auth.currentUser?.uid`. **Confirm the post-count field name
on the user doc before relying on it**; if it does not exist, drop that clause
and keep avatar-or-followers.

**Verify.** `/explore` signed in: you are not listed, no `player####` handles.

---

## 🔴 A11. Profile completion lives in localStorage, so it reads 0% everywhere

**File:** `src/components/profile/ProfileCompletionCard.jsx`

### What the user sees

Profile picture ✅ and Profile banner ✅ with filled check icons and
"Claim +500 VP" / "Claim +300 VP", while the ring reads **0%**. The notification
drawer meanwhile says "+500 VP earned! Profile picture — Jul 16", so the VP was
granted a month ago.

### Why

Claim state never leaves the browser:

```js
const CLAIMS_KEY = 'vergr_profile_claims_v1';
const readClaims = () => JSON.parse(localStorage.getItem(CLAIMS_KEY)) || {};
```

and the ring derives from it:

```js
const remaining = items.filter((i) => !i.done || !claims[i.id]);
const pct = Math.round(((items.length - remaining.length) / items.length) * 100);
```

The ring measures "buttons pressed in this browser", not profile completeness. On
a new device, or after clearing site data, it is 0% regardless. The tick icons use
`item.done`, which is real profile data, hence the on-screen contradiction.

**NOT an exploit — verified.** `claimQuestReward` (`functions/index.js:1117`)
treats profile quests as one-time (`claimId = ${uid}_${questId}`, no date) and
refuses a second claim inside the transaction. VP cannot be farmed by clearing
localStorage.

### **Fix.**

1. **Read the truth from the server.** `quest_claims` holds it. Add a callable
   (or extend an existing profile call) returning which of the six profile quest
   ids are claimed, and seed `claims` from it on mount. Keep localStorage only as
   a first-paint cache so the card does not flash.
2. **Make the ring measure completeness.** The heading says "Complete your
   profile", so it must follow `i.done`:
   ```js
   const completed = items.filter((i) => i.done).length;
   const pct = Math.round((completed / items.length) * 100);
   ```
   Unclaimed VP is already communicated by the Claim buttons and the "VP left"
   line.
3. **Stop swallowing the already-claimed response.** Currently:
   ```js
   if (code.includes('already-exists')) { markClaim(item.id); setClaims(readClaims()); }
   ```
   The row silently vanishes and a user who just pressed a button offering 500 VP
   is told nothing. Show a toast such as "Already added to your VP".

**Verify.** In a private window with a complete profile, the ring must not read 0%.

---

## 🔴 A12. Discovery shows squads you are already in

**File:** `src/screens/squads/SquadsScreen.jsx`

Headed "Find Squads — Discover public squads recruiting now" and lists
**Vanguard**, which the viewer is a member of (visible in "Your squads" in the
sidebar at the same moment). The query fetches public squads then filters only by
game and search text.

**Fix.**

```js
const meUid = auth.currentUser?.uid;
list = list.filter((s) => !(s.memberIds || []).includes(meUid));
```

`memberIds` exists — the card already reads `squad.memberIds?.length`.

**Together with A10 this is one pattern:** discovery surfaces never subtract the
viewer's existing relationships. Worth fixing as a shared rule.

**Verify.** Load `/squads` signed in. A squad listed in "Your squads" in the
sidebar must not also appear under "Find Squads".

**Minor, same screen:** the game filter chips are hardcoded (Valorant, Apex, Call
of Duty, Fortnite, Rocket League, CS2, Dota 2) while the only squad is "Other",
so seven of eight filters are guaranteed empty. Deriving chips from games that
actually have squads avoids handing a new user dead filters.

---

## 🔴 A13. The public Vergr.me page shows Share and Follow twice

**File:** `src/components/VergrMeView.jsx`

Two components render the same controls, both gated on the same flags
(`data.showShare !== false`, `data.showSubscribe !== false`), so with defaults
every visitor sees both:

| Component | Line | Position |
|---|---|---|
| `ActionRow` | ~507 | `absolute; top:10; right:12` (horizontal, 34px) |
| `FloatingActions` | ~196 | `fixed; right:16; bottom:20` (vertical, 44px) |

This is the page a creator hands to an audience who have never used Vergr.

**Fix.** Decide which placement is canonical and gate the other. Simplest correct
behaviour: keep `ActionRow` in the header and render `FloatingActions` only once
`ActionRow` has scrolled out of view (`IntersectionObserver` on the header, or a
scroll threshold). If that is more than wanted, remove one outright.

**Verify.** `/u/<handle>` shows one Share and one Follow.

---

## 🔴 A14. Vergr.me renders in the off-brand cyan

**File:** `src/utils/vergrmeThemes.js`

The live page renders cyan/teal. The first theme in the file is
`accent: '#4DFFD4'`, the exact colour the brand rule excludes (cyan is aliased
away in `tailwind.config.js`; the palette is violet / pink / gold).

⚠ **Confirm before changing.** I verified the page is cyan and that `#4DFFD4` is
the first theme. I did **not** trace the default-selection path to prove that
theme is assigned by default rather than inherited. Themes are user-selectable,
so cyan may be an intended *option*.

**Fix.**

1. First establish how a brand-new vergr.me page picks its theme. Grep for where
   the theme key is read with a fallback, e.g. `themes[data.theme || …]` in
   `src/components/VergrMeView.jsx`, and check what a user document with no
   vergr.me theme set resolves to.
2. If that resolves to the cyan theme, change **only the default selection** to
   the violet theme (`#7B1FFF`). Do **not** delete the cyan theme: it is a
   legitimate user choice, and the brand rule governs Vergr's own surfaces rather
   than a colour a creator deliberately picks for their own page.
3. If the default is already violet and this page is cyan because the account
   chose it, there is nothing to fix — close this finding.

**Verify.** Create or reset a vergr.me page with no theme set and confirm it
renders violet.

---

## 🔴 A15. `/watch` hangs on "Loading stream…" forever

**File:** `src/screens/streams/ViewerStreamScreen.jsx`

Held 35 seconds on a clean console: no timeout, no error, no empty state, no way
out.

```js
const [loading, setLoading] = useState(true);        // line 103

useEffect(() => {
  if (!streamId) return;                             // line 197 — bails out here
  const unsub = onSnapshot(doc(db, 'streams', streamId), (snap) => {
    setLoading(false);                               // the ONLY place it clears
    setStreamDoc(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  }, () => setLoading(false));
  return unsub;
}, [streamId]);

if (loading) return <Centered label="Loading stream…" />;   // line 630
```

`loading` starts `true` and clears only inside the snapshot callback. With no
`streamId` the effect returns before subscribing, so nothing clears it. The guard
meant to protect the missing-id case is what causes the hang.

Both routes point at this component, so `/watch` is real and reachable:

```jsx
<Route path="/watch"           element={<ViewerStreamScreen />} />
<Route path="/watch/:streamId" element={<ViewerStreamScreen />} />
```

**Fix.** Treat a missing id as a terminal state, not an early return:

```js
useEffect(() => {
  if (!streamId) { setLoading(false); return; }   // fall through to "not found"
  ...
}, [streamId]);
```

The component already renders a not-found branch when `streamDoc` is null, so
clearing the flag is enough. Confirm that branch offers a route out (Explore or
the live list) and add one if it does not.

**Verify.** `https://vergr.app/watch` resolves to a real state within seconds.

### Checked: is this pattern widespread? Mostly no.

A sweep found nine other screens whose loading effect early-returns before
clearing the flag. **Each guard was checked, and they are not the same bug:**

```
CreatorAudienceScreen        if (!currentUser) return;
AdCenterScreen               if (!auth.currentUser) return;
NativeMessageRequestsScreen  if (!auth.currentUser) return;
```

Those guard on being **signed out**, and all sit behind `ProtectedRoute`, so the
user is redirected before the spinner renders. `/watch` is the genuine one
because its guard is on a **route parameter** that can legitimately be absent
while everything else is valid.

**Recorded so nobody "fixes" nine screens that are not broken.**

---

## 🔴 A16. Settings still advertises tournaments (two more places)

**Files:** `src/screens/settings/SettingsScreen.jsx:126`,
`src/screens/settings/LinkedAccountsScreen.jsx:65`

Same class as A8, different screens. The Settings hub prints the Free plan's
feature bullets as:

```js
: ['Free tier', 'Core + tournaments', '480p streaming', 'Community support']
```

so every free user (which is every user) reads "Core + tournaments" on the first
settings screen they open. Linked Accounts then sells four platform connections
on a benefit that no longer exists. The four `desc` strings promise "auto-result
detection in CS2 and Dota 2 tournaments" (Steam), "auto-detect Valorant / LoL /
TFT match results" (Riot), "Overwatch 2 auto-result detection" (Battle.net) and
"Apex Legends auto-result detection" (EA / Origin).

The 70 Cloud Functions behind that detection were deleted on 2026-08-17, so
linking an account cannot produce a result for anything.

**Fix.** In `SettingsScreen.jsx:126` change the free bullet to something true,
e.g. `'Core features'`. In `LinkedAccountsScreen.jsx` rewrite the four `desc`
strings to the benefit that survives, which is identity and profile display, for
example "Show your Steam profile on your Vergr page." Do **not** delete the
platform rows: `linkSteamAccount` / `unlinkSteamAccount` / `getSteamGsiConfig`
are still deployed and the screen is live.

**Verify.** `grep -rin "tournament" src/screens/settings/` returns nothing.
Load `/settings` and `/settings/linked-accounts` and confirm no tournament or
auto-result wording.

---

## 🔴 A17. Settings promises "active sessions and trusted devices"; neither exists

**File:** `src/screens/settings/SettingsScreen.jsx:86`

The Security card's subtitle reads:

```js
desc: 'Password, 2FA, active sessions, and trusted devices.',
```

`/settings/security` contains exactly four rows: Change Password, Two-Factor
Authentication, Wallet Security, Sign Out All Devices. There is no session list
and no trusted-device list, and
`grep -rn "trustedDevice\|activeSessions\|listSessions" src/ functions/` returns
nothing, so neither feature exists anywhere in the codebase.

Two of the four things named on the card cannot be found by the person who went
looking for them, and this is the security screen, which is the worst place to
overstate what you offer.

**Fix.** Change the subtitle to describe what is there:
`'Password, 2FA, wallet PIN, and signing out everywhere.'` Building a real
session list is separate work and should not block this one-line correction.

**Verify.** Load `/settings`, read the Security card, click into it, and confirm
every noun on the card is present on the screen.

---

## 🔴 A18. Four privacy controls are wired to nothing

**Files:** `src/utils/privacy.js`, `src/screens/settings/PrivacySettingsScreen.jsx`

`privacy.js` is a good module and most of it IS enforced. These four are not:

| Control on `/settings/privacy` | Key | Helper | Callers |
|---|---|---|---|
| Allow downloads | `allowDownloads` | `canDownloadContentOf` | **0** |
| Who can comment on my content | `commentContent` | `canCommentOn` | **0** |
| Show activity feed | `activityFeed` | `showsActivityFeed` | **0** |
| Allow friend requests | `friendReq` | `canSendFriendRequest` | **0** |

Reproduce the count:

```bash
cd src && for k in canDownloadContentOf showsActivityFeed canCommentOn canSendFriendRequest; do printf "%-24s " "$k"; grep -rn "$k" --include=*.js --include=*.jsx . | grep -v "utils/privacy.js" | wc -l; done
```

`friendReq` is the worst of the four: `grep -rn "friendRequest\|sendFriendRequest" src/ functions/`
returns **nothing**, so the app has no friend-request feature at all and the
toggle governs a concept that was never built.

A privacy control that does nothing is worse than an absent one. The user makes a
decision, the UI confirms it was saved, and the behaviour never changes. On a
platform that takes payments and is going to store review, that reads as a false
statement about data handling.

**Fix, per row. Enforce or remove; do not leave them inert.**

- `commentContent`: enforce. `addComment` in `src/firebase/firestore.js:976` is
  the single choke point. `await canCommentOn(authorId, postOwnerDoc)` before the
  write and throw if false; hide the comment box in the post UI on the same check.
- `allowDownloads`: enforce at the one real download affordance,
  `src/components/MediaLightbox.jsx:28`
  (`const canSaveToGallery = isGallerySaveSupported();`). Pass the media owner in
  and add `&& canDownloadContentOf(owner)`. Note the feed has no download button
  at all, so this toggle currently promises protection against something that
  cannot happen there.
- `activityFeed` and `friendReq`: **remove the two rows** from
  `PrivacySettingsScreen.jsx` and their keys from `PRIVACY_DEFAULTS`. There is no
  activity feed and no friend-request system to gate. Keep the helpers in
  `privacy.js` if either feature is coming, but do not ship the switch first.

**Verify.** For each row that stays, change the setting, then perform the action
from a second account and confirm it is refused. For each row removed, confirm
`/settings/privacy` no longer offers it.

**Already checked, do not re-investigate:** `profileVis` is enforced inline at
`PublicProfileScreen.jsx:218` and `NativeProfileScreens.jsx:474`; `receiveMsg` at
`firestore.js:1405`; `readReceipts` in `ChatThreadScreen.jsx:1259`;
`onlineStatus` in `utils/presence.js`; `tagMe` in `CreateComposer.jsx:34` (the
hardcoded `{viewerFollowsTarget:true}` is correct there because the list is
already filtered to people the viewer follows); `searchVis`, `suggestedUsers`,
`hashtagSearch` and `showTrending` via `hiddenFromDiscovery`, which has 9 callers.

---

## 🔴 A19. Opening the Vergr.me editor publishes a public page without asking

**Files:** `src/hooks/useVergrMe.js` (`defaultPage`, `initVergrMePage`),
`src/screens/VergrMeEditorScreen.jsx:56-63`

`VergrMeEditorScreen` calls `initVergrMePage` from a mount effect, with no user
action:

```js
useEffect(() => {
  if (loading || form) return; // init once; never clobber an edited form
  if (profile) initVergrMePage(auth.currentUser.uid, profile).then((d) => {
```

and `initVergrMePage` writes the doc immediately when none exists:

```js
const defaults = defaultPage(profile);
const content = pageContent(defaults);
await setDoc(ref, { ...defaults, draft: content, published: content, hasUnpublishedChanges: false });
```

`defaultPage` sets `isPublic: true`. `VergrMePage` serves any page whose
`isPublic` is truthy (`VergrMePage.jsx:48`). So merely *looking at* the editor
creates a live public page at `vergr.app/u/<username>` carrying the user's
display name, bio and avatar. The dashboard then says "Your page is live" before
they have pressed the Publish button sitting in the top-right corner.

Nobody consented to that. A builder with a Publish button implies nothing is
public until Publish is pressed.

**Fix.**

1. In `defaultPage`, set `isPublic: false`.
2. In `publishVergrMePage`, add `isPublic: true` to the written fields, so the
   first Publish is what makes it live.
3. In `VergrMeEditorScreen.jsx:157` the Publish button is disabled by
   `disabled={publishing || (!hasUnpublished && draftStatus === 'saved')}`. A
   brand-new page has no unpublished changes, so this would trap the user with a
   private page and a dead button. Change to
   `disabled={publishing || (form?.isPublic !== false && !hasUnpublished && draftStatus === 'saved')}`.

Existing pages are unaffected: they already carry a stored `isPublic: true`.
`DashboardPanel.jsx:60` already renders "Your page is private" for the false
case, so no new copy is needed.

**Verify.** With a second account that has never opened the builder, load
`vergr.app/u/<that-username>` and confirm the unclaimed-handle page. Open
`/vergrme/edit` as that user, reload the public URL, and confirm it is STILL not
live. Press Publish, reload, confirm it is now live.

**Already checked, do not re-investigate:** the draft/publish model itself is
correct. `saveVergrMeDraft` writes only `draft`, the public reader reads the flat
top-level fields, and `publishVergrMePage` promotes one to the other. The
`updateDoc`-not-`setDoc-merge` choice is deliberate and documented in the file.
The only defect is the initial `isPublic`.

---

## 🔴 A20. Five of the seven Leaderboard categories can never show anything

**File:** `src/screens/home/LeaderboardScreen.jsx:14-21, 50`

The Leaderboard is one of two entries under Watch in the main nav. It orders the
`users` collection by a field per category:

```js
const q = query(collection(db, 'users'), orderBy(category.field, 'desc'), limit(50));
```

then drops rows whose value is not `> 0`. Firestore omits documents that lack the
ordered field entirely, so a category whose field is never written to `users`
returns an empty page forever.

| Category | Field | Written to `users`? | Result |
|---|---|---|---|
| **Top VP** (default tab) | `vp` | No, every writer targets `wallets/{uid}.vp` | **always empty** |
| Highest Level | `vpLevel` | No writer anywhere | **always empty** |
| Top Streamers | `streamHours` | No writer anywhere | **always empty** |
| Top Earners | `totalEarned` | No, written to `wallets` (`coaching.js:83`) | **always empty** |
| Top XP | `totalXP` | Seeded to 0 at onboarding, never incremented | **always empty** (zero-filter) |
| Most Followed | `followerCount` | Yes (`functions/index.js:2566`) | works |
| Top Posters | `postCount` | Yes (`functions/index.js:2252`) | works |

Confirmed live: the signed-in account holds VP and the board reads "No data yet.
Be the first on the board!" The **default** tab is one of the broken ones, so
this is what every user sees when they open the Leaderboard.

**Fix.** VP, level and earnings live on `wallets`, and a leaderboard cannot join
two collections, so pick one:

- **Preferred, cheap:** denormalise onto the user doc. In
  `functions/walletActions.js` (`awardActionVp`, `recordAdWatch`) and the other
  VP writers listed by `grep -rn "vp: FieldValue.increment" functions/`, mirror
  the same increment to `users/{uid}.vp`, and write `users/{uid}.vpLevel` from
  the existing level helper at the same time. Backfill once with a script over
  `wallets`.
- **Or** reorder `CATEGORIES` so `followers` is first and **delete** the five
  dead entries. Smallest change, honest immediately, loses the categories.

Whichever is chosen, `streamHours` needs a writer or it must go: nothing in the
codebase has ever recorded stream hours.

**Verify.** Open `/leaderboard`. The default tab must list real users. Click every
remaining tab and confirm none shows the empty state while accounts exist with
that value. Cross-check the top row against the same figure on that user's
profile.

---

## 🟡 A21. Any unknown URL silently drops you on the home feed

**File:** `src/router/AppRouter.jsx:218-225`

```js
function CatchAllRoute() {
  // Two or more segments (/vlink/admin/..., /l/handle) land here.
  if (VLINK_PATH.test(window.location.pathname)) return <VLinkHandback />;
  return <Navigate to="/" replace />;
}
```

There is no 404 screen. A mistyped link, a stale push-notification `actionUrl`,
an old email link, or a route removed in the tournament and withdrawal cleanups
all land the user on the home feed with no explanation and no back-trail, since
the redirect is `replace`. Found by loading `/settings/vergrme`, a plausible
guess at the Vergr.me route, which is really `/vergrme/edit`.

This gets worse, not better: the last two cleanups unrouted a lot of URLs that
are still linked from old notifications and indexed pages.

**Fix.** Render a small NotFound screen instead of redirecting: the path that was
missed, a "this page has moved or no longer exists" line, and buttons to Home and
Search. Keep the `VLINK_PATH` branch exactly as it is, it is load-bearing (see
memory `never-break-vlink`). Drop `replace` so Back still works.

**Verify.** Load `vergr.app/settings/vergrme` and any other nonsense path and
confirm a 404 screen rather than the feed. Then load a `/vlink/...` path and
confirm VLink still hands off correctly.

---

## 🟡 A22. "VERGR" is shouted at users in 749 places

**Scope:** `src/screens/`, `src/components/`

The house rule is **"Vergr" in prose, "VERGR" only as the wordmark**
(memory `brand-capitalization`). Prose is losing:

```bash
grep -rnE "[a-z] VERGR[ ,.'’]|VERGR [a-z]" src/screens/ src/components/ --include=*.jsx \
  | grep -v "VERGR_" | grep -vE ":\s*//|\* " | grep -v "/admin" | wc -l
# 749
```

It is on the screens that matter most. Sign-up, the first thing a new account
reads: "Set up your VERGR account", "You must be at least 18 to create a VERGR
account", "I confirm that my use of VERGR...". And `/earn`: "That is revenue
VERGR earns, and VERGR pays you a share of it on a schedule."

Shouting your own name mid-sentence reads as a template nobody proofread, which
is exactly the impression to avoid on a store listing and a payment form.

**Fix.** Mechanical, but scope it or it will eat the logo:

```bash
grep -rlE "[a-z] VERGR[ ,.'’]|VERGR [a-z]" src/screens/ src/components/ --include=*.jsx \
  | xargs sed -i -E "s/([a-z]) VERGR([ ,.'’])/\1 Vergr\2/g; s/VERGR ([a-z])/Vergr \1/g"
```

Then review the diff before committing. **Do not touch:** `VERGR_`-prefixed
identifiers, the logo/wordmark components, `public/llms.txt`, or anything inside
`src/screens/marketing/legal/` without reading it, since legal text may name the
entity deliberately.

**One judgement call for the founder, not for the fixer.**
`SettingsScreen.jsx:115` hardcodes the plan name as
`VERGR {tierLabel === 'FREE' ? 'Free' : ...}`, rendering "VERGR Free". A plan
name is arguably a product mark rather than prose. Default to "Vergr Free" for
consistency, but flag it rather than deciding silently.

**Verify.** Re-run the count command; it must return 0. Then load `/signup`,
`/earn` and `/settings` and read them aloud. `grep -rn "VERGR" src/components/Logo*`
(or wherever the wordmark lives) must still return the wordmark unchanged.

---

## 🔴 A23. `claimQuestReward` pays any quest id, at a price the client sets

**File:** `functions/index.js:1117` (`claimQuestReward`)

**This is the most serious finding in the audit. Fix it before the store build.**

The callable takes `reward` from the client and validates the id against nothing:

```js
const { questId, title } = request.data || {};
let reward = request.data?.reward;
if (!questId || typeof reward !== 'number') throw new ... 'questId and reward required';
if (reward <= 0 || reward > 5000) throw new ... 'Invalid reward amount';
```

After that there are only per-id `if` blocks: `refer_friend`, `creator_content`,
`first_squad`, `first_tournament`, and the six `PROFILE_QUEST_REWARDS` ids. Those
are properly verified and server-priced. **Everything else falls straight through
to the payout, unverified, at whatever `reward` the caller sent.**

Three consequences, in increasing order of seriousness.

**1. Seven live quests pay for work nobody did.** `EarnCoinsScreen` (`/earn`) and
its native twin call this with ids the server never checks. `handleClaim` only
guards on a client-side `claimedIds` array, so pressing the button is the whole
requirement:

| Quest id | VP | Server verifies? |
|---|---|---|
| `daily_post` | 15 | no |
| `daily_like` | 5 | no |
| `daily_squad_msg` | 10 | no |
| `weekly_posts` | 50 | no |
| `weekly_follow` | 50 | no |
| `first_stream` | 100 | no |
| `add_phone` | 1000 | no |

That is 1,230 VP for doing nothing, and the daily ones reset every UTC day.

**2. Any invented id is accepted.** The claim doc is keyed
`${uid}_${questId}_${today}`, so a caller who varies the id has **no limit at
all**:

```js
httpsCallable(functions, 'claimQuestReward')({ questId: 'x1', reward: 5000, title: 'x' })
```

pays 5,000 VP, then `x2`, `x3`, and so on. `applyVPMultiplier` doubles it for a
Pro account, so 10,000 VP per call, repeatable forever.

**3. What that actually buys.** Be precise about this, because it is easy to
overstate: VP does **not** change anybody's revenue share. `commissionForVP` in
`coinLedger.js:191` is explicitly deprecated with no live callers, and the real
rate is `shareForEarnings`, keyed to lifetime gross earnings. What minted VP does
reach is: **Vanguard promotion eligibility** (`vanguardRanks.js:195`,
`AdminVanguardScreen.jsx:486` gate on VP thresholds, and Recruits who cross one
are auto-flagged as promotion-eligible, so this manufactures a moderator
candidate), the `vp < 1000` branch in `enumerationFilter.js:95`, and every level,
rank, ring and badge in the progression system.

**Fix. There is already a correct implementation of this in the repo: copy it.**
`functions/creatorQuests.js` does exactly the right thing, and its own header
comment says why: "The client copy is for DISPLAY ONLY and is never trusted for
an amount."

1. Add a `QUESTS` registry to `claimQuestReward` in the same shape as
   `creatorQuests.js`: `{ [id]: { vp, verify(uid), unmet } }`, covering every id
   in `QUEST_DEFS` in `src/screens/home/EarnCoinsScreen.jsx` plus the ones
   already handled inline.
2. `const quest = QUESTS[questId]; if (!quest) throw new HttpsError('invalid-argument', 'Unknown quest.');`
   This single line closes consequence 2.
3. **Delete `reward` from the input entirely.** Take it from the registry. The
   existing `reward > 5000` cap is not a control, it is a ceiling on the theft.
   Leave the client sending it if you like, but never read it.
4. Write the seven missing `verify` functions. `creatorQuests.js` already has
   `authoredSince`, `startOfUtcDay` and `startOfUtcWeek` helpers that cover
   `daily_post`, `weekly_posts` and `first_stream` almost directly. `add_phone`
   checks `users/{uid}.phoneHash`, which `refer_friend` already reads.
5. Any quest you cannot verify must not be offered. Mirror the pattern in
   `CreatorQuestsScreen.jsx:122` (`visibleQuests` filters to what the server
   returns, with the comment "A card for a quest the backend does not know about
   is a button that can only fail"), so `/earn` renders from a server list
   instead of a hardcoded one.

## ▶ A23 IS FIXED AND DEPLOYED, BUT NOT YET TESTED LIVE — run this

The fix shipped 2026-08-19. It was verified statically (syntax; claim-id keying
checked against the previous behaviour; every client card cross-checked against
the server registry for both existence and amount). It has **not** been
exercised by a real signed-in user, because a callable cannot be proven offline
the way rules can.

**This is the highest-value 5 minutes available to whoever picks this up.** Any
signed-in account will do — no second account, no admin.

**Test 1 — the invented-id mint is closed (the critical one).**
On any signed-in page, open the browser console and run:

```js
const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/12.17.1/firebase-functions.js');
const fns = getFunctions(undefined, 'europe-west1');
await httpsCallable(fns, 'claimQuestReward')({ questId: 'not_a_real_quest', reward: 5000, title: 'x' });
```

**Expected:** throws `invalid-argument` / "Unknown quest." **A payout here is a
critical regression — stop and report it.** Before the fix this returned 5000 VP
and could be repeated forever by changing the id.

(If importing the SDK in the console is awkward, the app already holds an
initialised instance; any existing `httpsCallable(functions, 'claimQuestReward')`
call site can be reused with the same payload.)

**Test 2 — a quest you have NOT done is refused, with a reason.**
Go to `/earn` → Daily. Without posting anything today, press **Claim** on
"Create a Post".
**Expected:** a toast reading "Create a post today to claim this." (or the
matching `unmet` line). **Not** a generic "Failed to claim reward", and **no**
VP. Before the fix this paid 15 VP for pressing a button.

**Test 3 — a quest you HAVE done still pays.**
Create a post, return to `/earn`, press **Claim** on "Create a Post".
**Expected:** it pays, and the toast shows the server's amount. On a Free
account that is 15 VP; on Pro it is 30 (the multiplier is applied server-side,
and the toast now reports what the server actually paid rather than echoing the
card).

**Test 4 — no double-pay on add_phone.**
If the account already has a phone number saved, press **Claim** on "Add Phone
Number" in `/earn` → Special.
**Expected:** "Already claimed today" / `already-exists`, and **no** VP.
Before the fix this paid a fresh 1000 VP *every day*, because
`savePhoneNumber` keys its claim one-time (`${uid}_add_phone`) while this
callable keyed it per-day.

**Test 5 — the remaining verifiers, if there is time.** Each should refuse with
its own message until done, then pay: `daily_like` (like 5 posts today),
`daily_squad_msg` (message any squad today), `weekly_posts` (3 posts this week),
`weekly_follow` (follow 10 people this week), `first_stream` (go live once),
`first_event` (host a ticketed event — native `/earn` only).

⚠ `daily_like` is the one most likely to misbehave, because it is the only
verifier needing a brand-new index (`likes` COLLECTION_GROUP on `userId` +
`createdAt`, deployed 2026-08-19). If it errors rather than refusing politely,
check the function log for an index-build link — a large backfill can take a
few minutes to become queryable.

**If any test fails,** the registry is `QUEST_REGISTRY` in `functions/index.js`,
directly above `exports.claimQuestReward`.

**Already checked, do not re-investigate:** `ProfileCompletionCard.jsx` is fine.
Its six ids ARE in `PROFILE_QUEST_REWARDS`, are individually verified against the
user doc, and the server overwrites the client reward. `CreatorQuestsScreen.jsx`
is fine and is the model to copy: it uses the separate, fully verified
`claimCreatorQuest` in `creatorQuests.js` and hides any quest the server does not
offer. The defect is confined to the older `claimQuestReward` in `index.js`.

---

## 🔴 A24. Anyone can join any squad, make themselves president, and write its treasury

**File:** `firestore.rules` (the `match /squads/{squadId}` block, line 347 on)

**Most severe finding in the audit. This one mints coins.**

Three rules chain together. Each looks reasonable alone.

**Step 1: self-join any squad.**

```
match /members/{memberId} {
  allow create: if isAuth() && (request.auth.uid == memberId || isSquadAdmin(squadId));
  allow update: if isAuth() && (request.auth.uid == memberId || isSquadAdmin(squadId));
}
```

Any authenticated user can create their own member doc in **any** squad. Not a
member, not invited, no join request, no approval, and `isAuth()` rather than
`isRegistered()` so a guest session qualifies. Private squads are not excluded:
nothing in the rule reads the squad's visibility.

**Step 2: become president.** That `create` has **no field validation**, and:

```
function isSquadAdmin(squadId) {
  return isAuth() && get(.../squads/$(squadId)/members/$(request.auth.uid)).data.role in ['president', 'vice_president'];
}
```

`isSquadAdmin` reads `role` from the very doc the attacker just wrote. Writing
`{ role: 'president' }` makes it true. That unlocks the squad doc itself,
announcements, events, challenges, pinned posts and join requests.

**Step 3: write the treasury.**

```
match /wallet/{docId} {
  allow read:   if isSquadMember(squadId);
  allow create: if isSquadMember(squadId);
  allow update: if isSquadMember(squadId);
  allow write:  if false;          // ← inert, see below
}
```

`squads/{squadId}/wallet/main` **is the squad treasury**. It is the doc that
`functions/walletActions.js:197` (`contributeToSquad`), `functions/vanguard.js:46`,
`functions/squadChallenges.js:63` and `functions/tournaments.js:2551` all read and
write, with a `balance` field. A client that passes step 1 can set that balance
to anything.

⚠ **`allow write: if false;` on the last line does nothing.** Firestore rules are
a permissive union: multiple `allow` statements are OR'd, never AND'd, so a
later `false` cannot revoke an earlier grant. Anyone reading this block quickly
will assume it is locked. It is not.

**Why this is worse than one squad's play money.** `distributeVanguardTreasury`
(`functions/vanguard.js`) reads that exact field as the pool:

```js
const pool = treasurySnap.exists ? Number(treasurySnap.data().balance || 0) : 0;
```

and then distributes it monthly, as **real spendable coins**, into Vanguard
members' wallets. So the chain is: any account joins the Vanguard squad, sets
`balance` to an arbitrary number, and the cron mints it. Coins sell at roughly
$0.01163 each, so this is direct value creation, not a cosmetic counter.

`squads/{squadId}/transactions/{txId}` is `allow create: if isSquadMember(squadId)`
as well, so the ledger that would evidence the tampering can be forged to match.

**How this happened, so the same gap gets closed elsewhere:** `contributeToSquad`
was correctly moved server-side into `walletActions.js` during the "every money
field on `wallets` is server-only" pass. The **rule** for the squad side of that
same transfer was never tightened to match. The code moved; the door did not.

**Fix.**

1. **Treasury and ledger become server-only.** In both blocks, replace every
   grant with `allow read: if isSquadMember(squadId); allow write: if false;`.
   Nothing in `src/` writes them: `firestore.js:2064` and `:2468` only `getDoc`.
   Verify with `grep -rn "'wallet', 'main'" src/` before and after.
2. **Constrain member creation.** A self-join must not be able to set a role:
   ```
   allow create: if isAuth()
     && request.auth.uid == memberId
     && request.resource.data.role == 'member'
     && get(/databases/$(database)/documents/squads/$(squadId)).data.isPublic == true;
   ```
   Private squads should go through the existing `join_requests` flow, which is
   already rule-guarded correctly. Admin-created members keep the
   `isSquadAdmin(squadId)` branch.
3. **Role changes are admin-only.** Split `update` so a member may edit their own
   cosmetic fields but `role` is only writable by `isSquadAdmin`:
   ```
   allow update: if isSquadAdmin(squadId)
     || (request.auth.uid == memberId
         && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['role']));
   ```
4. **Delete the inert `allow write: if false;` lines** wherever they sit under a
   grant, or convert them to a real deny by removing the grants above them. Leaving
   them reads as a control that does not exist.

**Verify.** Signed in as an account that is in no squad, from the browser console:

```js
// must now be denied
await setDoc(doc(db,'squads','<some-squad-id>','members','<my-uid>'), { role:'president' });
await setDoc(doc(db,'squads','<my-squad-id>','wallet','main'), { balance: 999999 }, { merge:true });
```

Both must throw `permission-denied`. Then confirm the legitimate paths still
work: join a public squad through the UI, run `contributeToSquad`, and confirm
the treasury still moves and still renders on the squad screen.

---

## 🔴 A25. A "for debugging" rule shipped to production lets anyone vote in any squad

**File:** `firestore.rules:418`

```
// ✅ Votes subcollection – open to any authenticated user (for debugging)
match /votes/{voteId} {
  allow read: if isAuth();
  allow create: if isAuth();
  allow update: if isAuth();
  allow delete: if false;
}
```

The comment says what it is. It guards `squads/{squadId}/votes`, and the check is
`isAuth()`, not `isSquadMember(squadId)`, so **any signed-in account, including a
guest and including someone who has never been near the squad, can create and
overwrite votes in every squad on the platform.** `update` being open means
existing ballots can be rewritten, not just added to.

This is the subcollection behind squad polls and the champion-vote flow, so any
squad decision taken by vote can be decided by an outsider.

**Fix.** Match the surrounding blocks, which already get this right:

```
match /votes/{voteId} {
  allow read: if isSquadMember(squadId);
  allow create: if isSquadMember(squadId) && voteId == request.auth.uid;
  allow update: if isSquadMember(squadId) && voteId == request.auth.uid;
  allow delete: if false;
}
```

Keying the doc id to the voter's uid also makes one-ballot-per-member structural
rather than something the client has to be trusted about. Check the existing doc
id shape first (`grep -rn "'votes'" src/`) and keep whichever field identifies
the voter.

**Verify.** As an account in no squad, attempt a write to
`squads/<id>/votes/<anything>` from the console and confirm `permission-denied`.
Then vote in a squad you belong to through the UI and confirm it still records,
and that voting twice overwrites your own ballot rather than adding a second.

**Note for whoever fixes this:** it is the only rule in the file that admits to
being temporary. A grep for `debug|temporar|TODO|FIXME` across `firestore.rules`
returns this line and three unrelated explanatory comments, so there is no second
one hiding.

---

## 🔴 A26. "Become a creator" reopens on every Creator Studio screen

**File:** `src/components/creator/CreatorLayout.jsx:47`

```js
const [gateOpen, setGateOpen] = useState((profile?.creator?.status || 'none') === 'none');
```

`CreatorLayout` wraps **every** Creator Studio screen, so each navigation
remounts it and `useState` re-runs its initialiser. `setGateOpen(false)` only
lives for that mount. Nothing is persisted: no localStorage, no session flag, no
profile field.

Observed live, three navigations in a row, dismissing each time: Home →
modal, Payout setup → modal, Earnings → modal. A non-creator gets it again on
Analytics, Content, Schedule, Audience, Ads, Memberships, Quests and Verify too.
The whole section is unbrowsable without closing the same dialog eleven times.

**There is a second bug on the same line.** The initialiser reads `profile`,
which is async, and `useState` only evaluates it once. On any render where
`profile` is not yet loaded, `(undefined || 'none') === 'none'` is `true`, the
modal opens, and it **stays** open when the real profile arrives. So a genuine
creator who hard-reloads a Studio page is told to become a creator. `profile` is
seeded synchronously from `peekSelfProfile()` so a warm session usually dodges
this, but a cold start or a private window will not.

**Fix.** Derive the state instead of snapshotting it, respect the loading flag,
and remember the dismissal:

```js
const { profile, wallet, loading } = useUser();
const [dismissed, setDismissed] = useState(() => {
  try { return sessionStorage.getItem('vergr_creator_gate_dismissed') === '1'; } catch { return false; }
});
const isCreator = (profile?.creator?.status || 'none') !== 'none';
const gateOpen = !loading && !!profile && !isCreator && !dismissed;
const closeGate = () => {
  setDismissed(true);
  try { sessionStorage.setItem('vergr_creator_gate_dismissed', '1'); } catch {}
};
```

then `<BecomeCreatorModal open={gateOpen} onClose={closeGate} />` at line 94.
`sessionStorage` rather than `localStorage` is deliberate: the explainer should
come back on a future visit, just not on every click of this one.

**Verify.** As a non-creator, open `/creator/dashboard`, dismiss the modal, then
click through Earnings, Content and Quests. It must not reappear. Open a new tab
and confirm it does appear once. Then, as an account whose
`profile.creator.status` is not `'none'`, hard-reload `/creator/earnings` and
confirm the modal never shows.

---

## ✅ A27. Buy → Custom amount showed multiple prices — FIXED 2026-08-19

> **Fixed and deployed.** The diagnosis below is correct about the cause: the
> state was still named `eur` after the 2026-08-11 re-denomination, so the chips
> ran through `fmtEUR`, which is a EUR->local CONVERTER rather than a formatter.
> Reproduced exactly: at the live rate a USD 20 renders as **$23.06**.
>
> **Two corrections to the write-up, both found by reading the code:**
>
> 1. **There were FOUR wrong figures, not three.** The "Payment processing
>    (~1.5%)" line also ran through `fmtEUR`, so it was inflated too. Not
>    mentioned above.
> 2. **The footer CTA's `$19.99` was RIGHT, and "You pay $20.00" was the wrong
>    one.** This document guessed the CTA was "a third code path... a sticky
>    checkout bar reading a stale pack price". It is not: it is `PriceQuote`
>    rendering `getCoinPriceQuote`, and the file's own comment says "the quote is
>    the ONLY source of the charged figure". You are charged for WHOLE coins and
>    `coins` is floored, so $20 buys `floor(20 / 0.0127)` = 1574 coins = **$19.99**.
>    "You pay" was echoing the amount typed rather than the amount charged.
>    Fixing the CTA to match "You pay" — the obvious reading of the instruction
>    above — would have made the screen advertise a price 1c higher than the card
>    is actually charged.
>
> **What shipped.** `eur`/`setEur`/`eurNum`/`customEUR` renamed to `usd`
> throughout (the name is what caused this); chips use `fmtUsd`; the hardcoded
> `€` on the input is now `$`; the processing fee uses `fmtUsd` and is computed
> off the charged amount; and "You pay" now reads a new `chargedUsd`, which is
> the server quote once it lands and the floored catalogue value until then — so
> "You pay" and the CTA are the same number by construction. `fmtEUR` is no
> longer imported into `BuyScreen.jsx` and there is a comment saying why.
>
> **The native mirror had the identical bug** and is fixed the same way
> (`NativeCustomBuy` in `wallet/native/NativeWalletScreens.jsx`). It has no
> server quote, so it uses the floored catalogue value. ⚠ Source-only until the
> next APK, per the batch-native rule.
>
> **Deliberately left:** a chip labelled `$20` buys $19.99 of coins, a 1c
> difference from flooring to whole coins, always in the buyer's favour. The
> chip is an amount selector, not a price claim, and both charge figures beside
> it are exact.
>
> **Verified:** arithmetic replicated against the component's exact expressions
> (reproduces $23.06 before, all figures agreeing after), and the build ships.
> ⚠ **NOT verified in the live UI** — `/wallet/buy` is behind auth and this
> session cannot sign in. **Someone signed in should open `/wallet/buy` →
> Custom amount, click each of the five chips, and confirm the chip, the input,
> "You pay" and the CTA all read the same dollar figure.** That is this
> finding's own Verify step and it still stands.

---

<details>
<summary>Original finding as written (cause correct, CTA diagnosis wrong)</summary>

### Buy coins → Custom amount shows three different prices for one purchase

**File:** `src/screens/wallet/v2/BuyScreen.jsx:268-290`
(and `fmtEUR` in `src/components/wallet/primitives.jsx:64`)

**This is the live checkout. Highest-severity non-security finding.**

Observed on `/wallet/buy` → **Custom amount**, one screen, one amount:

| Where | Shows |
|---|---|
| Selected quick-pick chip | **$23.06** |
| The amount input | **€20** |
| "You pay" in the breakdown | **$20.00** |
| Footer CTA | **$19.99** ≈ $19.99 · charged in USD |

The Coin packs tab beside it is correct ($0.99 / $4.99 / … "charged in USD"), so
this is confined to the custom-amount panel, which was only half-migrated when
the ladder was re-denominated to native USD on 2026-08-11.

**Root cause.** The state is still called `eur` and the chips render through
`fmtEUR`:

```jsx
{[10, 20, 50, 100, 250].map(n => (
  <button key={n} onClick={() => setEur(n)} ...>{fmtEUR(n)}</button>
))}
```

but `fmtEUR` is not a formatter, it is a **converter**:

```js
// Despite the name, this formats a EUR amount in the USER'S local currency
// (converted via the live FX feed), falling back to EUR.
export const fmtEUR = (n) => formatMoneyFromEur(n);
```

So the raw number `20` is a **USD** amount everywhere else in the flow
(`const valid = eurNum >= MIN_CUSTOM_USD` at line 250, and the quote), but the
chip label runs it through EUR→USD and inflates it by the FX rate (~1.1532).
Clicking the chip labelled **$23.06** sets the amount to 20 and charges
**$20.00**: the label is wrong by $3.06, about 15%.

Separately, line 285 hardcodes a `€` glyph in front of that same USD number, so
the field reads "€20" while the row underneath reads "$20.00".

The file that defines `fmtEUR` already spells out why this matters, in the
comment on the function right below it: *"Formatting a charged amount in a
currency it will not be charged in is the displayed-versus-charged mismatch
`getCoinPriceQuote` exists to prevent."* That is exactly what shipped here.

**Fix.**

1. Rename the state `eur` → `usd` / `setEur` → `setUsd` throughout the panel so
   the next reader is not misled by the name. This is what caused the bug.
2. Chips: `{fmtUsd(n)}` instead of `{fmtEUR(n)}`. `fmtUsd` is imported in this
   file already and is the correct helper for a natively-USD amount.
3. Line 285: delete the hardcoded `€` span, or replace it with `$`.
4. Check the footer CTA separately. It read **$19.99** while the input said 20
   and the breakdown said $20.00, so a third code path is formatting this
   amount. It may be a sticky checkout bar reading a stale pack price. Do not
   assume the same fix covers it: reproduce it first.
5. Grep the panel for any other `fmtEUR` use. Anywhere a natively-USD figure is
   passed to it, the number shown is inflated by the live FX rate.

**Verify.** Open `/wallet/buy` → Custom amount. Click each of the five chips in
turn. For every one, the chip label, the input, "You pay" and the footer must
show the **same** figure, and it must equal what `getCoinPriceQuote` returns.
Then type a custom value and confirm all four agree again. Confirm the Coin
packs tab is unchanged.

</details>

---

## 🟡 A28. Memberships and the KYC screen are still priced in euros

**Files:** `src/screens/creator/MembershipTiersScreen.jsx:12,34-36`,
`src/screens/wallet/v2/KycScreen.jsx:20-25`,
`src/screens/wallet/BoostScreen.jsx:129`,
`src/screens/wallet/TransactionReceiptScreen.jsx:41`

Same root cause as A27, different screens, lower blast radius because none of
them is the checkout itself.

**Membership Tiers** (`/creator/membership`) carries its own hardcoded rate:

```js
const EUR_PER_COIN = 0.0099; // Starter purchase anchor (LOCKED) — for "≈ €" estimates only.
```

That anchor is pre-redenomination. The Starter pack is now 78 coins for $0.99,
so the real anchor is **$0.012692/coin**. A 100-coin tier therefore displays
"≈ €0.99" when it is worth about **$1.27**: wrong currency symbol and ~28% low.
The KPI row on the same screen reads "≈ €0.00 / mo gross" while `/creator/earnings`
one click away reads "$0.00". CLAUDE.md is explicit that the old €0.0090 floor is
stale and deleted, and that coins are one worldwide USD price.

**KycScreen** states the payout ceilings as "Paid up to **€50** per month",
"**€2,500** per month" and "source-of-funds declaration on first **€1,000+**
deposit". These are compliance-facing numbers a user may rely on. The real caps
live in `functions/creatorPayouts.js`; read them there and match both the figure
and the currency rather than editing the symbol alone.

**BoostScreen:129** does `€{(boost.coins * 0.01).toFixed(2)}`, a second hardcoded
rate that is neither the old EUR anchor nor the current USD one.

**TransactionReceiptScreen:41** is different in kind and worth a look while you
are in here: the routed screen `/transaction/:txId` falls back to **mock data**
when the transaction is not found, including `amount: '€4.49'`, `item: '500 Coin
Pack'` and `method: 'Visa •••• 4242'`. A user opening a receipt link for a
transaction that does not exist is shown a fabricated receipt for a purchase they
never made. There is no 500 Coin Pack in `COIN_PACKS`.

**Fix.**

1. Delete `EUR_PER_COIN` and the `fmtEUR`-style helper at
   `MembershipTiersScreen.jsx:34-36`. Derive from the single source: import
   `COIN_PACKS` and use the Starter anchor (`0.99 / 78`), or better, reuse
   whatever `/creator/earnings` uses so the two screens cannot drift again.
   Render with `fmtUsd`.
2. `BoostScreen:129`: same, replace the hardcoded `0.01` and the `€`.
3. `KycScreen`: read the caps out of `functions/creatorPayouts.js` and state them
   in the currency actually paid.
4. `TransactionReceiptScreen`: **delete the mock fallback.** Show a "receipt not
   found" state. Fabricated payment records must never render, and a screenshot
   of one would be indistinguishable from a real receipt.

**Verify.** `grep -rn "€" src/screens/creator/ src/screens/wallet/` returns
nothing outside deliberate localisation helpers. Load `/creator/membership` and
confirm tier prices and the KPI row read in dollars and agree with
`/creator/earnings`. Load `/transaction/does-not-exist` and confirm a not-found
state rather than a €4.49 Visa receipt.

---

## 🔴 A29. Any signed-in account can list, read and hijack every voice/video call

> ⚠️ **PARTIALLY confirmed, 2026-08-18 — do not overstate.** From Verion's real
> session a `runQuery` over `calls` returned HTTP 200 with a call document between
> two *other* users (`iAmIn: false`): the **enumeration + metadata read** half of
> this finding is proven live. **The interception / IP-leak half is NOT yet
> proven** — every sampled call was `status: ended`, so no live offer/answer SDP
> or ICE candidates were present to pull. Enumerating an ended call proves the
> open read gate, not that a third party can steal a live call's SDP/ICE.
>
> **Update from the live call test (2026-08-18):** during an ACTIVE Vergr↔Verion
> video call, the call doc **did** hold both `offer` and `answer` SDP (6604-byte
> offer), and this call uses **non-trickle ICE** — the candidates (host/srflx,
> which carry IP addresses) are embedded **inside the SDP**, not in the
> `callerCandidates`/`calleeCandidates` subcollections (both were empty). So the
> sensitive payload is confirmed to live in the call doc itself — the exact
> document A29's first half already proved any `isAuth()` user can read/enumerate.
> **What is still NOT executed:** the cross-account read of that live SDP by a
> non-participant. Two accounts cannot do it (both are the call's participants);
> it needs a THIRD authenticated session — a guest/anonymous session qualifies,
> since the rule is only `isAuth()`. The data-present half is now confirmed; only
> the final non-participant read remains, and the rule guarantees it would
> succeed.

**File:** `firestore.rules:957-969`

```
match /calls/{callId} {
  allow read: if isAuth();
  allow create: if isAuth();
  allow update: if isAuth();
  allow delete: if false;

  match /callerCandidates/{candidateId} { allow read, write: if isAuth(); }
  match /calleeCandidates/{candidateId} { allow read, write: if isAuth(); }
}
```

There is **no participant check anywhere in this block.** The call document holds
`participants`, `callerId`, `status`, and both WebRTC session descriptions
(`offer: {type, sdp}` written at `src/utils/webrtc.js:76`, and `answer`). The two
subcollections hold the ICE candidates.

`allow read: if isAuth()` with no `resource` condition permits **`list`**, not
just `get`, so an attacker does not need to guess a document id. They can query
the whole `calls` collection.

Three consequences.

**1. Read every call on the platform.** Who called whom, when, and both SDPs.
ICE candidates include host and server-reflexive candidates, which carry
**IP addresses**. Vergr sells "IP-masked private streaming" as a Pro feature; this
collection hands out the IPs of everyone using 1:1 calling, to anyone with an
account.

**2. Intercept a call in progress.** The caller accepts the first answer that
appears, with no check on who wrote it:

```js
const unsub = onSnapshot(doc(db, 'calls', callId), (snap) => {
  const data = snap.data();
  if (data?.answer && !pc.currentRemoteDescription) {
    pc.setRemoteDescription(new RTCSessionDescription(data.answer));
  }
});
```

A third party who writes their own `answer` plus `calleeCandidates` before the
real callee responds gets the caller's peer connection negotiated **with them**.
That is media interception, not just disruption.

**3. Kill or forge calls.** `allow update: if isAuth()` lets anyone write
`status: 'ended'` on any live call. `allow create: if isAuth()` with no constraint
on `participants` lets anyone create a doc naming any user as a participant;
`IncomingCallManager.jsx:26-30` queries `participants array-contains me` +
`status == 'ringing'` and plays a ringtone, so this is a remote ring-spam
primitive against any user.

**The correct pattern is eight lines above it in the same file.** `calls_history`
gets this right:

```
allow read: if isAuth() && request.auth.uid in resource.data.participants;
```

**Fix.**

```
match /calls/{callId} {
  allow get:    if isAuth() && request.auth.uid in resource.data.participants;
  allow list:   if false;
  allow create: if isAuth()
                && request.auth.uid in request.resource.data.participants
                && request.resource.data.callerId == request.auth.uid;
  allow update: if isAuth()
                && request.auth.uid in resource.data.participants
                && request.resource.data.participants == resource.data.participants;
  allow delete: if false;

  match /callerCandidates/{candidateId} {
    allow read, write: if isAuth() && request.auth.uid in
      get(/databases/$(database)/documents/calls/$(callId)).data.participants;
  }
  match /calleeCandidates/{candidateId} {
    allow read, write: if isAuth() && request.auth.uid in
      get(/databases/$(database)/documents/calls/$(callId)).data.participants;
  }
}
```

`allow list: if false` is important and is what closes the enumeration: the
clients only ever `get` a known call, plus the `participants array-contains`
query in `IncomingCallManager`, which is satisfied by the `get` rule's condition.
Test that query specifically after changing this.

**Honest cost note:** the `get()` in the candidate rules bills one document read
per candidate operation. A call exchanges roughly 5 to 20 candidates per side, so
this is small, but it is not free. If it matters, denormalise `participants` onto
each candidate doc at write time and compare against `request.resource.data`
instead, which costs nothing.

**Verify.** From a signed-in account that is in no call:
`await getDocs(collection(db,'calls'))` must throw `permission-denied`. Then
place a real 1:1 call between two accounts and confirm it still connects, rings,
answers and ends. Then, while that call is live, from a third account attempt
`updateDoc(doc(db,'calls','<that-id>'), {status:'ended'})` and confirm it is
refused.

---

## 🔴 A30. `allow read: if true` on user docs makes profile privacy unenforceable, and leaks Vergr.me drafts

**File:** `firestore.rules:104` and `firestore.rules:202`

Two separate reads, same root cause.

**1. The whole user document is world-readable.**

```
match /users/{userId} {
  allow read: if true;
```

A18 records that `profileVis` ("Only me" / "Friends & Followers") is enforced
inline in `PublicProfileScreen.jsx:218` and `NativeProfileScreens.jsx:474`. That
is a **screen-level** check. The document behind it is readable by anyone,
signed in or not, so the privacy setting is cosmetic at the data layer: one
`getDoc(doc(db,'users',uid))` returns the full profile of a user who set it to
"Only me", including `settings.privacy` itself, and whatever else lives on that
doc.

This is worth checking against what the doc actually carries. Server-only fields
were correctly added to the *write* denylist during the wallet hardening
(`kycLevel`, `kyc`, `pendingCreatorCoins`, `vp`, `creator`), but write-protecting
a field does not stop anyone reading it, and `kyc` in particular is
identity-verification state.

**2. Unpublished Vergr.me drafts are public.**

```
match /vergrMe/{docId} {
  allow read:  if true;
```

A19 establishes that the draft/publish model stores both on one document:
`saveVergrMeDraft` writes the in-progress edits to a `draft` field, while the
public page reads the flat top-level fields. The rule makes no distinction, so
**anyone can read `users/{uid}/vergrMe/page` and see the `draft`** — every
unpublished edit, before the user has chosen to publish it. The Publish button
implies the opposite.

**Fix.**

1. **Vergr.me is the cleaner fix and should be done with A19.** Move the draft
   out of the public document: `users/{uid}/vergrMe/draft` with
   `allow read: if isOwner(userId)`, leaving `page` public. `useVergrMe.js`
   changes in three places (`initVergrMePage`, `saveVergrMeDraft`,
   `publishVergrMePage`), and `publishVergrMePage` copies draft to page as it
   already does.
2. **User docs need a decision from the founder, so do not choose silently.**
   Firestore cannot filter fields per-reader, so the options are: (a) accept that
   the profile doc is public and **remove the profile-visibility control**, since
   an unenforceable privacy switch is worse than none (see A18); (b) move the
   private fields to the existing `users/{uid}/private/{docId}` subcollection,
   which is already correctly gated `isOwner`, and keep only public profile
   fields on the parent; or (c) gate reads on the follow relationship, which
   costs a document read on every profile view and would need measuring first.
   (b) is the right answer for `kyc` and `settings` regardless of which is chosen
   for the rest.

**Verify.** Signed **out**, in a console with the SDK: `getDoc(doc(db,'users','<uid-set-to-Only-me>'))`.
After the fix, sensitive fields must be absent from the result. For Vergr.me:
open the builder as user A, type into the bio without publishing, then as user B
read `users/<A>/vergrMe/page` and confirm the unpublished text is not there.

---

## 🔴 A31. `/boost` is routed, linked from nowhere, and every purchase fails

**File:** `src/screens/wallet/BoostScreen.jsx:57-60`

Boosts are one of the four revenue categories in CLAUDE.md. The screen tries to
pay for one by debiting the wallet from the browser:

```js
await updateDoc(walletRef, {
  balance: currentBalance - boost.coins,
  totalSpent: (walletSnap.data().totalSpent || 0) + boost.coins,
});
```

Both `balance` and `totalSpent` are on the server-only denylist in
`firestore.rules:1200-1201`, added in the 2026-08-16 pass that made every money
field on the wallet server-only. So this `updateDoc` is refused, the `catch`
fires, and the user gets a generic **"Boost failed"** toast. There is no path
through this screen that can succeed.

Three further problems in the same handler, all of which matter once it is
rewritten:

- The debit is a **read-then-write, not a transaction**
  (`getDoc` then `updateDoc` with a computed absolute value), so two tabs would
  race and lose a debit. Use `FieldValue.increment` server-side.
- The wallet debit, the `boosts` doc and the `transactions` row are three
  sequential unbatched writes. A failure after the first leaves a charge with no
  boost.
- `awardVP` at the end is now a **shim**: it ignores both its arguments and calls
  `awardActionVp({ action: 'profile_boost' })`. So the "+10 VP" in the success
  toast is not the amount awarded. The server value in `ACTION_VP` is the truth.

**It is also unreachable.** `grep -rn "'/boost'" src/` returns only the route
definition at `AppRouter.jsx:1043`. Nothing in the UI links to it, so this is A6's
problem as well as a broken one.

**Fix.** Move the purchase into a callable, the same shape as
`contributeToSquad` in `functions/walletActions.js`, which is the nearest correct
example: one transaction that checks the balance, decrements it, writes the
`boosts` doc and writes the ledger row together. Then have the screen call it and
surface the server's error message instead of a generic failure. Once it works,
link it from somewhere, or delete the route deliberately rather than leaving a
fourth revenue category behind an unlinked broken screen.

**Verify.** With a funded wallet, open `/boost`, buy the cheapest boost, and
confirm: the coins leave the balance exactly once, a `boosts` doc exists, a
`transactions` row exists, and the VP shown in the toast equals what
`ACTION_VP.profile_boost` actually awards. Then confirm an underfunded wallet is
refused with a message that says why.

---

## 🔴 A32. Any user can write their own ledger rows, and the Earnings screen reads the ledger

**File:** `firestore.rules:1315`

```
match /transactions/{txId} {
  allow read: if isAuth() && (
    resource.data.userId == request.auth.uid ||
    resource.data.recipientId == request.auth.uid ||
    isAdmin()
  );
  allow create: if isAuth() && request.resource.data.userId == request.auth.uid;
  allow update: if false;
  allow delete: if false;
}
```

The only constraint on `create` is that `userId` matches the caller. There is no
constraint on `type`, `amount`, `currency`, or the `earning` flag. So any account
can write:

```js
addDoc(collection(db,'transactions'), {
  userId: myUid, type: 'tip_received', amount: 500000,
  currency: 'usd', earning: true, createdAt: serverTimestamp()
});
```

**This matters because of a deliberate design decision recorded in CLAUDE.md:**
after the `$10.01` incident, the Earnings screen was changed to derive lifetime
figures from the **ledger** rather than the wallet aggregate, on the reasoning
that "the ledger is auditable line by line so a questioned figure can be
reconciled; an aggregate cannot be." That reasoning holds only if the ledger is
server-written. It is not.

**What is and is not at risk, stated precisely.** Real payouts are **safe**:
`functions/creatorPayouts.js` pays from `wallets.owedMicroUsd`, which is
server-only, and the revenue-share tier is keyed to `totalEarnedCoinsGross`,
also server-only. What breaks is the audit trail and every figure derived from
it: the Earnings screen, statements, and any admin view that reads
`transactions`. A user can also produce a convincing screenshot of earnings they
never made.

**Why the rule exists:** `BoostScreen.jsx:75` writes a ledger row from the
client. That is the only live client writer, and per A31 it is on a dead code
path anyway. The two others (`finalizeTournament`, `recordModeratorPayout` in
`firestore.js:3874,3902`) are tournament-era leftovers whose `userId` is another
user, so they could never have satisfied this rule.

**Fix.** `allow create: if false;` — the ledger becomes server-only, like every
other money collection in this file. Fold the boost's ledger row into the
callable written for A31. Confirm nothing else writes it first:
`grep -rn "collection(db, 'transactions')" src/` should show only reads
(`getDocs`/`query`) once BoostScreen is fixed.

**Verify.** From the console as a normal user,
`addDoc(collection(db,'transactions'), { userId: <my-uid>, type:'tip_received', amount: 1, currency:'usd' })`
must throw `permission-denied`. Then send a real tip between two accounts and
confirm the row still appears for both sides and that `/creator/earnings` still
reports it.

---

## 🔴 A33. The upgrade paywall quotes the wrong prices, and its CTA is off-screen

**File:** `src/components/creator/PlanLock.jsx:20` and `:45`

Two bugs in the component that gates Analytics, Schedule and Audience.

**1. Both prices are wrong.**

```js
const PRICE = { lite: '$9.99/mo', pro: '$24.99/mo' };
```

The real prices are in `src/utils/tierSystem.js:34-54`:

| Tier | tierSystem.js | PlanLock says |
|---|---|---|
| Lite | `price: 4.99`, `priceLabel: '$4.99/mo'` | **$9.99/mo** (2x) |
| Pro | `price: 9.99`, `priceLabel: '$9.99/mo'` | **$24.99/mo** (2.5x) |

`tierSystem.js` already exports `priceLabel` for exactly this purpose and the
component simply does not use it. This is the screen that asks someone to pay,
quoting a price 2 to 2.5 times what they would actually be charged.

**2. The unlock CTA renders below the fold, so the page just looks broken.**

```jsx
<div className="pointer-events-none select-none filter blur-[6px] opacity-40">{children}</div>
<div className="absolute inset-0 flex items-center justify-center rounded-2xl">
```

`inset-0` spans the **full height of the blurred content**, and the overlay is
centred in it. On a screen whose content is taller than the viewport, the CTA
sits at roughly half the content height, off-screen.

Observed on `/creator/audience`: the entire page renders blurred with no lock
badge, no title, no description and no Upgrade button anywhere in view, and it
stays that way. There is nothing to tell the user this is a paywall rather than a
rendering failure, and the Audience nav item carries no `LITE` badge (Analytics
and Schedule do), so there is no warning beforehand either.

**Fix.**

1. Delete the hardcoded `PRICE` map and read from the source:
   ```js
   import { getTierConfig } from '../../utils/tierSystem';
   const reqPrice = getTierConfig(required)?.priceLabel;
   ```
   Check the exact export name in `tierSystem.js` before wiring it. Then grep for
   any other hardcoded plan price: `grep -rn "24.99\|\$9.99/mo" src/`.
2. Pin the overlay into view instead of centring it in the content. Add
   `sticky top-24` to the inner card, or cap the blurred region's height, so the
   CTA is visible without scrolling regardless of content length. Test on the
   tallest of the three screens, which is Audience.
3. Add the `LITE` badge to the Audience nav entry in `CreatorLayout` so it
   matches Analytics and Schedule.

**Verify.** As a free account, open `/creator/analytics`, `/creator/schedule` and
`/creator/audience`. On each, without scrolling, the lock card must be visible
and the price must read $4.99/mo for Lite. Cross-check against
`/settings/subscription`, which is where the Upgrade button lands: the two
figures must match.

---

## 🟡 A34. Content library tells you to clear filters that are not set

**File:** `src/screens/creator/CreatorContentScreen.jsx` (the empty state)

On `/creator/content` with zero posts, no search text and the "All" type filter
selected, the empty state reads:

> No posts match those filters.

There are no filters. The user is sent looking for something to clear, and the
one thing that would help, a link to create a post, is not there (there is a
`+ New post` button, but it sits in the toolbar above rather than in the empty
state where the user is looking).

Worth fixing because the rest of the app gets this right and is noted as such in
this document: Shorts, `/streams` and Creator Earnings all have honest empty
states with a working CTA.

**Fix.** Branch on whether any filter is actually applied:

```jsx
{posts.length === 0 && !search && typeFilter === 'all'
  ? <EmptyState title="You have not posted yet"
                body="Everything you publish shows up here."
                cta={{ label: 'Create your first post', onClick: openComposer }} />
  : <EmptyState title="No posts match those filters"
                cta={{ label: 'Clear filters', onClick: resetFilters }} />}
```

**Verify.** With zero posts and no filters, the message must invite a first post.
Then type nonsense in the search box and confirm the message switches to the
filter wording with a Clear filters action.

---

## 🔴 A35. The whole squads section still sells tournaments, and one link is dead

**Files:** `src/screens/squads/SquadOverviewScreen.jsx:111,149`,
`src/screens/squads/SquadChatThreadScreen.jsx:146,923`,
`src/screens/squads/native/NativeSquadOverviewScreen.jsx:103`,
`src/screens/squads/native/NativeSquadEventsScreen.jsx:79`,
`src/screens/squads/native/NativeSquadRolesScreen.jsx:11`,
`src/screens/squads/native/NativeSquadsMineScreen.jsx:67`

Third instance of the A8/A16 pattern, and the largest. Seen live on
`/squads/<id>`: the Events quick-action is subtitled **"Scrims & tournaments"**.

| File | Copy |
|---|---|
| `SquadOverviewScreen.jsx:149` + native `:103` | Events — "Scrims & **tournaments**" |
| `NativeSquadEventsScreen.jsx:79` | "Plan your next scrim, **tournament**, or squad night." |
| `NativeSquadRolesScreen.jsx:11` | "Manages squad coin pool — **tournament entries**, member rewards, payouts." |
| `NativeSquadsMineScreen.jsx:67` | "Squads unlock voice chat, **tournaments**, shared earnings, and ranked leaderboards." |

The last one is the pitch shown to a user with no squads, so it is the first
thing a new user reads about squads, and one of the four things it promises does
not exist.

**One of these is a broken link, not just copy.** `SquadChatThreadScreen.jsx:923`
renders `TournamentEmbed` for any chat message with `type === 'tournament'`, and
that component links to:

```jsx
href={`/match/${data.tournamentId}`}
```

`grep -n 'path="/match' src/router/AppRouter.jsx` returns **nothing**. The route
was removed with the tournament backend on 2026-08-17. So every historical
tournament share sitting in a squad chat is a card that silently dumps the user
on the home feed (see A21). Squad chat history is permanent, so these do not age
out.

**Fix.**

1. Copy: rewrite the four strings above to what squads actually do. Events are
   real (ticketed events live in the `tournaments` collection, see the note in
   CLAUDE.md), so "Scrims & events" is accurate; the roles blurb should say
   "event entries"; the squads pitch should drop tournaments and keep voice chat,
   shared earnings and leaderboards.
2. The embed: `TournamentEmbed` should either point at the ticketed-event route
   that replaced `/match/:id`, or render as a non-link card. Do **not** delete the
   component: it is the only thing that renders those existing chat messages, and
   removing it would blank them.
3. While in `SquadOverviewScreen.jsx:111`, `You're the {myMeta.label}` renders
   **"You're the Member"**. Should be "You're a {label}" for non-unique roles, or
   just the role pill on its own.

**Verify.** `grep -rni "tournament" src/screens/squads/ src/components/squad/`
returns only the ticketed-event imports (`EventTicketCard`, `EventPickerModal`,
`getUserTournaments`), never user-facing copy. Load `/squads/<id>` and confirm
the Events subtitle. If any squad chat contains a tournament embed, click it and
confirm it no longer lands on the home feed.

---

## 🔴 A36. "Vergr Support" is listed twice, under two different headings

**Files:** `functions/supportChannel.js:55-61`,
`src/components/MessagesListPanel.jsx` (list assembly)

Read straight off `/messages`:

```
DIRECT MESSAGES (4)
  ...
  ✔ Vergr Support        Tap to chat      ← the official channel row
GROUPS (2)
  Vergr Update Logs
  Vergr Support     3h   Tap to chat      ← the support thread
```

Same name, same call to action, two rows, two sections. The user has no way to
tell which one reaches a human, and picking wrong is a silent dead end.

**Cause.** Support is modelled two ways at once. `official_channels/vergr_support`
carries `name: 'Vergr Support'` and renders as a synthetic DM row
(`official:<channelId>`, added in the A5 fix). The actual conversation
`resolveSupportChannel` provisions is a **group** `conversations` doc, which the
same list renders under GROUPS. Both are correct individually; nothing
de-duplicates them.

This is the visible half of **A4**, which is about that group thread exposing the
full group-chat affordance set (Invite Members, member list) on what is a private
support ticket. Fix them together.

**Fix.** The support thread should never appear as a group. Either:

- **Preferred:** tag the conversation (`kind: 'support'`, which
  `supportChannel.js` already sets on the channel) and have the list panel route
  it into the official-channel row rather than the GROUPS section, so there is
  exactly one entry and it is the one with the verified badge; or
- suppress the synthetic official row whenever a real support conversation
  exists for that user, so the live thread with its unread count wins.

Whichever way, the surviving row must be the one carrying the unread state, or
the user will miss replies.

**Verify.** On `/messages`, "Vergr Support" appears exactly once. Send a support
message, confirm the reply raises the unread badge on that single row, and
confirm the GROUPS section no longer contains it. Then re-check A4: opening it
must not offer Invite Members.

---

## 🔴 A37. The latest message of every DM on the platform is readable by any account

> ✅ **CONFIRMED LIVE by two-account test, 2026-08-18.** From Verion's real
> session (`damien.w.ashton@gmail.com`, `iAmParticipant: false`), a `getDoc` on a
> private DM between @Vergr and a *third* user returned HTTP 200 and leaked
> `lastMessage: "🎬 Clip"`. A real account read a conversation it has no part in.
> The target was chosen by confirming, from the owner's own session, that Verion
> was not in the participants array.

**File:** `firestore.rules:804`

```
match /conversations/{convoId} {
  allow get: if isAuth();
  allow list: if isAuth() && request.auth.uid in resource.data.participants;
```

`list` is correctly gated. `get` is not gated at all, and three facts turn that
into a full read of everyone's message previews.

**1. The conversation document contains message text.**
`src/firebase/firestore.js:1463`:

```js
batch.update(doc(db, 'conversations', convoId), {
  lastMessage: type === 'text' ? content : `Sent a ${type}`,
  lastMessageAt: serverTimestamp(),
  lastSenderId: senderId,
  status: 'active'
});
```

`lastMessage` is the **full body** of the most recent message, not a redacted
marker. The `messages` subcollection is separately participant-gated, so message
history is safe. The newest message of every thread is not.

**2. DM ids are derivable.** `src/screens/messages/CallHistoryScreen.jsx:70`
builds a thread route as `[me, otherId].sort().join('_')`. Support threads are
worse: `functions/supportChannel.js:137` uses the literal template
`support_${channelId}_${uid}`, and `channelId` is the public `vergr_support`.

**3. uids are enumerable.** `users/{userId}` is `allow read: if true` (A30) and
the document id **is** the uid.

Chain them: pick any two users, sort their uids, join with `_`, `getDoc`. You get
their latest message text, both participants, the timestamp, who sent it, and
per the rules comment also unread state, mute, pin, archive and wallpaper. For
support, `support_vergr_support_<uid>` reads what any user last said to support.

**This one is subtle, so do not "just close `get`".** The author knew it was
open and designed around it: the comment at `firestore.rules:840` says invite
codes are deliberately kept **off** the conversation doc because "`allow get`
above is open to any signed-in user, so anyone holding the chatId could simply
read the current code and revocation would be theatre." The reason `get` is open
is the **public-group self-join** rule immediately below it, which needs a
non-participant to read `isGroup`, `visibility`, `banned` and `requireInvite`
before joining. Closing `get` outright breaks joining public groups.

What was missed is that `lastMessage` carries message text, and that ids are
derivable rather than secret.

**Fix.** Keep the self-join path open, close everything else:

```
allow get: if isAuth() && (
  request.auth.uid in resource.data.participants
  || (resource.data.isGroup == true
      && resource.data.get('visibility', 'private') == 'public')
);
```

A public group is joinable by anyone by design, so exposing its preview is not a
leak. DMs, private groups and support threads all stop being readable.

⚠ **Check one thing before shipping this:** confirm support conversations are not
created with `visibility: 'public'`. `supportChannel.js` creates them as groups;
if `visibility` is unset the `get('visibility','private')` default covers it, but
verify rather than assume, because getting it wrong leaves support tickets open.

Consider also storing a type marker (`'text'`, `'photo'`) instead of the body in
`lastMessage`, with the preview rendered from the messages subcollection the
reader is already allowed to read. That removes the class of bug rather than this
instance, but it is a bigger change and the rule fix is what unblocks.

**Verify.** As account A, DM account B. From account C's console:
`getDoc(doc(db,'conversations','<sorted A_B id>'))` must throw
`permission-denied`. Then, still as C, join a public group by link and confirm
that flow still works end to end, and that a private group's doc is refused.

---

## 🔴 A38. The Notifications page drops the notification title

**File:** `src/screens/home/NotificationsScreen.jsx:99`

```jsx
{notif.content || notif.body}
```

`notif.title` is never read. Every server-written notification sets both fields,
and the title is the part carrying the meaning. From `functions/index.js` on a
quest claim:

```js
title: `+${payoutVp} VP earned!`,
body:  title || `Quest completed: ${questId}`,   // the client-sent label
```

So `/notifications` renders **"Profile banner"** and **"Profile picture"** with a
coin icon and no amount, instead of "+300 VP earned!" and "+500 VP earned!".
Confirmed live on the account: three rows, none of which says what happened.

`src/components/NotificationsDrawer.jsx:184-185` gets it right:

```js
const title = notif.title || notif.content || 'Notification';
const body  = notif.body || '';
```

so the drawer and the full page disagree about the same notification, which is
how this survived.

**Fix.** Mirror the drawer:

```jsx
const title = notif.title || notif.content || 'Notification';
const body  = notif.body || '';
```

and render the title as the primary line with the body beneath. Check the row
layout has somewhere to put a second line before wiring it.

**Also worth fixing while in here:** the oldest row ("Where Gamers Converge.
Complete your profile to get started.") renders at an opacity low enough to be
barely legible, and its icon does not render at all. Whatever read-state styling
does that is too aggressive; a read notification should be de-emphasised, not
unreadable.

**Verify.** Claim any quest, then open `/notifications`. The row must state the
VP amount. Open the drawer on the same notification and confirm both surfaces now
say the same thing.

---

## 🟡 A39. Explore recommends unflagged guest accounts as creators

**File:** `src/screens/explore/ExploreScreen.jsx:197-201`

```js
.filter((u) => u.username
  && u.isGuest !== true
  && !/^guest_/i.test(u.username)
  && u.hideFromEnumeration !== true
  && !hiddenFromDiscovery(u, 'suggested'))
```

**The broad policy here is deliberate and must not be changed.** The comment
records the founder rule from 2026-06-29: a user shows in Creators unless they
are a guest or opted out, with no onboarding or post-count gate, because those
gates wrongly hid real accounts. Zero-follower real people appearing is correct
behaviour, not a bug. Do not add a follower or activity threshold.

The narrow defect is that the **guest** half of that rule does not catch all
guests. Both guards depend on state that some guest accounts never got:
`isGuest === true`, or a `guest_` username prefix. CLAUDE.md documents the
population that has neither: an anonymous session that arrived without the
`isGuest` flag gets its handle from `maintainUsernameIndex`, whose fallback is
`'player'`, and since that is reserved the loop yields **`player` + 4 random
characters**.

Seen live in Recommended Creators right now: **`playerxn8k`** and
**`playera07n`**, both 0 followers, both default avatars. That is exactly the
documented pattern. They are guests, the rule says guests should be excluded, and
the filter misses them.

**Fix.** Do not add a heuristic on the username (a real user could pick
`playerx123`). Exclude on what actually identifies them. Either:

- **Preferred:** fix the data. These accounts are the ones the admin "Delete
  guest account" button exists for (CLAUDE.md, Users screen section). The button
  proves guest-ness against the **Firebase Auth record** (anonymous = an Auth
  user with no email and no providers) rather than the doc flag. Clearing them
  removes the symptom everywhere at once, not just in Explore.
- Or, if they should persist: have the same signup path that writes the doc also
  write `isGuest: true` so both existing guards start working.

⚠ **Do not add a scheduled sweep for this.** A daily reclassification cron was
built once and rejected by the founder on cost ("Did I ask you to add user
cleanup things to the cron which will cost me money"). It is a button, not a job.

**Verify.** Open `/explore` signed in. No `player####` account with a default
avatar and no activity appears under Recommended Creators. Confirm real
zero-follower accounts (e.g. a newly created human account) still DO appear, or
the founder rule has been broken.

---

## ✅ A40. The in-app Help Centre crashed to a black screen — FIXED

**File:** `src/screens/settings/HelpCenterScreen.jsx`

`/settings/help` rendered **nothing at all**. Console:

```
ReferenceError: contactSupport is not defined
    at b (HelpCenterScreen-CQ9qCPX4.js:1:5456)
```

The "Message support" button called `contactSupport` and read `opening`, and
neither existed in the component. Both live in `SettingsScreen.jsx`. Introduced
when support was rewired away from the public help page: the button was added
here, the handler was not.

The Settings hub links straight to this screen ("Help centre — Answers to the
questions people ask most", **Browse FAQs**), so the primary in-app help surface
was dead in production.

**Fixed** by defining the handler locally, mirroring `SettingsScreen.jsx:316`,
using the `openSupportPath` import that was already present:

```js
const { showToast } = useUI();
const [opening, setOpening] = useState(false);
const contactSupport = async () => {
  setOpening(true);
  try { navigate(await openSupportPath()); }
  catch { showToast('Could not open support, please try again', 'error'); setOpening(false); }
};
```

**Verify.** Load `/settings/help`: FAQ list renders, console clean. Click
"Message support" and confirm it opens the support thread in Messages.

---

## 🔴 A41. Five more undefined-identifier crashes the build cannot see

> ✅ **#1 CONFIRMED LIVE, 2026-08-18 — and it is worse than first written.** The
> founder: "when I click to enlarge the screen goes blank." Reproduced exactly:
> enlarging a chat video mounts `InlineVideoPlayer`, which throws
> `ReferenceError: resolvedSrc is not defined`, and because there is **no error
> boundary** (see A50) the **entire React app unmounts to a blank screen**
> (`document.getElementById('root').innerHTML.length === 0`). The user must
> reload the whole app. This is not "inline video looks broken" — it is a
> whole-app crash reachable by the most ordinary action, tapping a video to make
> it bigger. **Fix #1 first; it is the highest-impact of the five.**
>
> ⚠ **Blast radius is NOT just chat enlarge.** `resolvedSrc` is defined nowhere,
> and `InlineVideoPlayer` is imported by **12 components**: `MediaLightbox`
> (enlarge — CONFIRMED crash), `PostCard` (feed), `PostDetailScreen`,
> `ClipViewerScreen` (clips/shorts), `SquadChatThreadScreen`, `VergrMeView`,
> `MobileLiveViewer`, `ViewerStreamScreen`, `LockedMedia`, and three native
> screens. Any of these that actually mounts the `<video>` at line 129 hits the
> same undefined variable and the same whole-app blank-out. Enlarge is proven;
> the others follow from the identical code path (a thumbnail that has not yet
> mounted the `<video>` will not crash until played, which is why browsing the
> feed did not blank — but **playing/opening** a clip, short, post video or
> squad-chat video is the same crash). Treat this as **video playback broken
> app-wide**, verify each surface after the one-line fix.

**Files:** `src/components/media/InlineVideoPlayer.jsx:129`,
`src/components/PostCard.jsx:110`,
`src/screens/settings/Subscriptionscreen.jsx:445`,
`src/components/vergrme/ProductsPanel.jsx:234`,
`src/firebase/firestore.js:4435`

A40 was not a one-off. Running `no-undef` across `src/` finds five more live
sites where a referenced identifier does not exist. Each is valid JavaScript, so
`npm run build` passes; each throws `ReferenceError` the moment that line runs.

**Reproduce** (self-contained, no project config needed):

```bash
npx eslint -c /tmp/undef.config.mjs "src/**/*.{js,jsx}" --no-ignore
```

with a flat config declaring `rules: { 'no-undef': 'error' }` and the browser
globals. Ignore hits for `requestIdleCallback`, `HTMLVideoElement`,
`createImageBitmap` and the `__VERGR_*_BUILD__` defines: those are gaps in the
globals list, not bugs. Tournament files (`BRScoreboard.jsx`,
`MatchDetailsScreen.jsx`) are unrouted dead code and can wait.

| # | Site | Effect |
|---|---|---|
| 1 | `InlineVideoPlayer.jsx:129` `src={resolvedSrc}` | **Every inline video in the app.** The prop is `src`; `resolvedSrc` is never defined anywhere in the file. |
| 2 | `PostCard.jsx:110` `renditions={post?.adaptiveRenditions}` | Any multi-media post containing a video. `MediaRow({ items, onImageClick, onDoubleTapLike })` never receives `post`. |
| 3 | `Subscriptionscreen.jsx:445` `stopPoll(); closePopup(); setCardWaiting(false);` | The **Cancel** button on the "Complete your payment" modal. All three exist only on that line. |
| 4 | `ProductsPanel.jsx:234` `microOf(o)` | Cancelling a Vergr.me order: the confirm dialog throws instead of opening. |
| 5 | `firestore.js:4435` `catch (err) { console.error('...', error) }` | The ad-fetch error handler itself throws, turning a handled failure into an unhandled one. |

⚠ **`post?.adaptiveRenditions` looks safe and is not.** Optional chaining guards
against `null`/`undefined` *values*, never against an **undeclared identifier**.
`post?.x` where no `post` binding exists still throws `ReferenceError`. Worth
knowing, because it is why this one reads as defensive code.

**Fix.**

- **(1)** Decide what `resolvedSrc` was meant to be. The comment at line 48 says
  absent renditions means "it plays `src`", so `src={src}` restores every video
  immediately and matches documented behaviour. If the `renditions` prop is
  supposed to pick a rendition, write that selection and name it `resolvedSrc`.
  **Do this one first: it is the whole video surface.**
- **(2)** Pass `post` into `MediaRow` from its caller, or drop the `renditions`
  prop at that call site. Check the caller before choosing.
- **(3)** Implement the three handlers, or replace the Cancel button with the
  popup/poll teardown that already exists elsewhere in that file. Read the
  checkout lifecycle before editing: this is the paid-subscription path.
- **(4)** Define `microOf`, or use the value already on the order object.
- **(5)** `error` → `err`. One character.

**Then add the gate, or this recurs.** There is no ESLint config in the repo
(`eslint.config.*` and `.eslintrc*` are both absent) though ESLint itself is
available. Add a flat config with `no-undef` and wire it into the build script,
so a missing identifier fails CI instead of reaching production. That is the
durable fix; the five sites above are the backlog it would have caught.

**Verify.** Re-run the lint: no `no-undef` outside the known-good globals and the
dead tournament files. Then in the app: play a video in the feed, open a
multi-image post containing a video, start a card subscription and press Cancel,
and cancel a Vergr.me order. None may throw.

---

## 🟡 A42. "Free Link in Bio" in the public footer is a dead link

**Files:** the marketing footer in
`src/screens/marketing/PublicMarketingScreens.jsx`, against
`src/router/AppRouter.jsx:811`

The footer's CREATORS column links to **`/platform/linkinbio`**. The route is
`/linkinbio` (`AppRouter.jsx:811`, `<Route path="/linkinbio" element={<LinkInBioScreen />} />`).
There is no `/platform/linkinbio`, so the link falls through `CatchAllRoute` and
silently redirects: to the home feed if signed in, to `/platform` if not.
Verified live.

Every other footer link in that column resolves (`/platform/streamer`,
`/platform/creators`, `/platform/studio-tools`, `/platform/partners`,
`/platform/forums`, `/platform/code-of-conduct`). This is the only one that
does not.

It matters more than a normal broken link because of where it sits: the public
marketing site, in the column that sells creators on joining, and Vergr.me is a
Pro conversion driver. A logged-out visitor, which includes a store or processor
reviewer, clicks it and lands back where they started with no error.

**Fix.** One character class either way: change the footer href to `/linkinbio`,
or add a `/platform/linkinbio` route pointing at `LinkInBioScreen`. Prefer
changing the href, since `/linkinbio` is the canonical route and is already in
the sitemap. While in that footer, click every link once: this one survived
because nobody has.

**Verify.** Signed out, load `/platform/delete-account`, click "Free Link in Bio"
in the footer, and confirm the Vergr.me landing page renders rather than the
marketing home. Repeat signed in.

---

## 🔴 A43. Everyone in a group chat is permanently "Offline"

> ✅ **CONFIRMED LIVE by two-account test, 2026-08-18.** With **both** accounts
> genuinely online (Verion in one browser, @Vergr active in another), the "Vergr
> Update Logs" group still showed **"0 online"** in the header and all three
> members — Vergr, Friz1k3 and Verion — marked Offline, *including Verion viewing
> its own session*. That rules out stale presence data: the flag is hardcoded
> false, exactly as the code below shows.

**File:** `src/layouts/MessagesMasterDetail.jsx:31`

```js
return { id: uid, name, avatar, role, online: false };
```

`buildMembers` hardcodes `online: false` for every participant. `ChatMembersRail`
then does `const online = list.filter(m => m.online).length`, so the header always
reads **0 online**, every avatar dot is grey, and every member's status line reads
**Offline**.

Observed live in a 3-person group: header "0 online", all three listed Offline,
**including the signed-in user**, who is by definition online. Being told you
yourself are offline is the tell that this is not real data.

The presence system exists and works. `src/utils/presence.js` is complete,
`useOnlineStatus(otherUserId)` drives the 1:1 DM header
(`ChatThreadScreen.jsx:871`), and the squad rail shows real green dots and a real
count. Group chat is the one surface never wired up.

**Fix.** Populate `online` from the same source the rest of the app uses, and go
through `utils/presence.js` rather than reading `lastSeen` directly, because
those helpers already honour the **`settings.privacy.onlineStatus` opt-out**
(`presence.js:45,68,81`) which A18 confirms is genuinely enforced. Reading
`lastSeen` yourself would quietly break a privacy setting that currently works.

`buildMembers` is a plain function, so either lift it into a hook that subscribes
to presence for `convo.participants`, or resolve presence where `profiles` is
already fetched and merge it in there. The second is less churn: `profiles` is
already keyed by uid at the call site (`MessagesMasterDetail.jsx:188`).

**Verify.** Open a group chat with a second account signed in elsewhere. The
count must be non-zero, that member's dot green, and **your own row must not say
Offline**. Then set `onlineStatus` off in that account's Privacy settings and
confirm they drop back to Offline for other viewers while still showing correctly
to themselves.

---

## 🔴 A44. Live streaming produces no video. "LIVE" is a database flag.

**Found by a two-account end-to-end smoke test on 2026-08-18.** Broadcast from
@Vergr, watched from Verion, two Chrome profiles, both real accounts.

**What the test did.** `/go-live` → devices on → Go Live → broadcast ran **31m 47s**
showing a red LIVE badge and a running timer. From Verion, `/streams` listed the
stream, opening it registered **viewer count 1** on both sides, and the
broadcaster's own recap reported "Peak viewers 1". Every piece of state said it
was working.

**No video ever existed.** Read off the viewer's `<video>` element:

```
currentSrc : https://cdn.vergr.app/streams/d0401f69…f597ea5ffe8/index.m3u8
error      : code 4, PipelineStatus::DEMUXER_ERROR_COULD_NOT_PARSE
networkState: 3 (NETWORK_NO_SOURCE)   readyState: 0
```

Fetching that manifest directly:

```
status: 404   bytes: 0   content-type: text/html
```

And on the broadcaster tab, `read_network_requests` filtered to
`ingest|sfu.vergr|rtmp|seg` returned **nothing**, on a second run with capture
started *before* Go Live. The browser never uploaded a single byte.

So the chain is broken at the first hop. `createStreamSession` writes the stream
doc, the UI flips to LIVE off that doc, discovery lists it off that doc, and the
viewer counter increments off that doc. **None of it is evidence that media is
flowing, and no part of the product checks that it is.**

### ROOT CAUSE: the ingest service rejects the key the backend issues

Isolated on a second broadcast with network capture running **before** Go Live.
The chain was walked hop by hop:

| Check | Result |
|---|---|
| `streams/{id}` doc | `ingestType: "browser"`, `ingestUrl: "https://sfu.vergr.app/ingest"`, `nodeId: "edge1"` — **all correct** |
| `getStreamIngest` callable | **200**, returns a valid `streamKey` |
| `sfu.vergr.app` reachable | **yes** (the earlier "Failed to fetch" was CORS on `/healthz`, not a dead host) |
| MediaRecorder `video/mp4` support | **true** on Chrome 151, so `pickMimeType()` does not throw |
| **`POST /ingest/init` with that exact key** | **401 `{"error":"invalid stream key"}`** |

```
POST https://sfu.vergr.app/ingest/init
Authorization: Bearer 67851b65b989a384ea08a0b32d52ce05161dc31c2cb4133b
→ 401 {"error":"invalid stream key"}
```

**Cloud Functions and the ingest box disagree about where the publish key
lives.** `createStreamSession` (`functions/streaming.js:485-500`) writes it to
two places:

```js
tx.set(db.collection('stream_keys').doc(streamKey), { streamId, hostUid, hostPlan, createdAt });
tx.set(db.collection('streams').doc(streamId).collection('private').doc('ingest'), { streamKey, ingestUrl, ingestType, createdAt });
```

The comment directly above that write records the migration: the lookup used to
"run against `streams`… it stops needing the key to be a field on a public
document." The key was moved off the public `streams` doc for security (memory
`stream-key-is-a-credential`), and `vergr-ingest` was never taught the new
location. It still resolves a Bearer token the old way, finds nothing, and
returns "invalid stream key" for **every** browser broadcast.

That also explains the silence. `startBrowserIngest` throws on the first
`postChunk`, and `BroadcasterScreen`'s snapshot handler swallows the related
failure path:

```js
.catch(() => { ingestFetchedRef.current = false; });   // BroadcasterScreen.jsx:258
```

while `setIsLive(true)` runs regardless of whether the ingest block succeeded.

⚠ **The blocker: `vergr-ingest` has no source in this repo.** CLAUDE.md's Box 2
section is explicit that `vergr-sfu`, `vergr-ingest`, `vergr-rtmp-auth` and
`stream-node-agent` "exist ONLY as compiled binaries." `infra/` contains
`box2-restore`, `community-import`, `stream-node-agent`, `transcode`,
`vergr-ocr` and `vod-archive` — **no `ingest`**. So the component that must
change is the one that cannot be rebuilt from this repo.

**Fix. Three options, in order of preference.**

1. **Make the backend satisfy the old lookup (no Go rebuild).** Determine what
   `vergr-ingest` actually queries — on the box, `strings /opt/vergr-ingest/vergr-ingest | grep -i "stream\|firestore\|collection"` will usually reveal the collection and field names. If it queries `streams` for `streamKey == <bearer>`, have `createStreamSession` also write a **lookup document it can find**. Do **not** restore `streamKey` onto the public `streams` doc: that reverts a deliberate security fix and re-exposes a publish credential to every reader. If the binary reads `streams` directly, this option is closed and you go to 2.
2. **Rebuild `vergr-ingest` from source and point it at `stream_keys/{streamKey}`**, which is the correct long-term shape. Requires locating the Go source, which is not in this repo and may only exist on the founder's other machine or in the box's build directory.
3. **Ship OBS/RTMP as the supported path** while 1 or 2 lands, and stop offering "Browser broadcast" in the UI rather than letting users start a broadcast that silently reaches nobody.

**Regardless of which, add the health signal.** The product must not display
"LIVE" for 31 minutes while emitting nothing. `startBrowserIngest` already
throws on a failed `postChunk` and already accepts an `onError` that calls
`endStream()`; the missing piece is that `setIsLive(true)` does not wait for the
first chunk to be **accepted**. Gate the live flip on a successful `/ingest/init`,
and surface the server's actual message ("invalid stream key") to the host
instead of swallowing it.

**Verify the fix at the protocol level before touching the UI:**

```bash
KEY=$(…)   # from getStreamIngest for a fresh stream
curl -i -X POST https://sfu.vergr.app/ingest/init \
  -H "Authorization: Bearer $KEY" -H "Content-Type: video/mp4" --data-binary @init.mp4
```

That must return 2xx. Until it does, no amount of client work will produce video.

**Verify.** Repeat this exact test: broadcast from one account, watch from
another. The manifest must return **200** with `#EXTM3U`, the `<video>` element
must reach `readyState >= 2` with no error, and the viewer must see moving
picture. Nothing less counts, because every other indicator was already green
while the feature was completely non-functional.

---

## 🔴 A45. hls.js is never loaded, so HLS cannot play in any browser but Safari

**File:** the player behind `/watch/:streamId` (`HlsPlayer`, used by
`ViewerStreamScreen`)

Independent of A44, and it would break playback even after the pipeline is
fixed. Measured on the live viewer page:

```js
hlsJsPresent : false              // no window.Hls
scriptsWithHls: []                // no hls.js script tag
anyHlsGlobal : []
video.src    : https://cdn.vergr.app/…/index.m3u8
```

The player assigns the `.m3u8` straight to `video.src`. **Only Safari can demux
HLS natively.** Chrome, Edge, Firefox, the Tauri desktop WebView2 shell and the
Android WebView all need hls.js feeding Media Source Extensions. The exact error
Chrome raised, `DEMUXER_ERROR_COULD_NOT_PARSE`, is what you get when Chrome is
handed a playlist as if it were a media file.

CLAUDE.md describes the viewer as using "`HlsPlayer` + p2p-media-loader", and
p2p-media-loader is an hls.js engine, so the intent was clearly there. Either the
import was dropped, or it fails to load and the code falls through to the naked
`video.src` assignment.

**Fix.** In the player: if `video.canPlayType('application/vnd.apple.mpegurl')`
is truthy, native HLS is fine (Safari/iOS). Otherwise construct an `Hls`
instance, `hls.loadSource(url)`, `hls.attachMedia(video)`. Never assign an
`.m3u8` to `video.src` on a non-Safari browser. Check whether `hls.js` is even in
`package.json` before assuming it is an import bug.

**Verify.** With a working manifest (A44 first), play a stream in **Chrome** and
confirm picture. Then confirm the same in the desktop app and the APK, since both
are non-Safari WebViews and both would have been broken by this.

---

## 🟡 A46. The viewer claims 1080p60 for a 480p30 Free-tier stream, and Go Live still shows Gems

**Files:** the quality badge in `ViewerStreamScreen`, and the Earnings panel on
`GoLiveSetupScreen`

Two honesty defects seen during the smoke test.

**1. Hardcoded quality badge.** The viewer page displayed **`1080p60`** next to
the LIVE badge. The broadcaster is on the Free plan and its own Stream Quality
card read **`480p · 30fps, Up to 3.0 Mbps · Free plan`**. The badge is not
reading the stream's actual rendition. Per CLAUDE.md the ladder is
single-rendition and viewer cap matches source, so this label is simply wrong,
and it is wrong in the direction that flatters the product.

**2. Gems are still on the Go Live screen.** "EARNINGS · TODAY" shows three
columns: COINS, VP and **GEMS**. Gems were deleted on 2026-08-16 and the unit no
longer exists anywhere in the money path.

**Fix.** Read the rendition off the stream doc that `createStreamSession` wrote
(it already stores the plan-derived quality) and render that, or drop the badge
rather than assert a number. Remove the GEMS column from the Go Live earnings
panel; `grep -rn "GEMS\|gems" src/screens/streams/GoLiveSetupScreen.jsx`.

**Verify.** Broadcast on a Free account and confirm the viewer badge reads 480p30.
Load `/go-live` and confirm only Coins and VP appear.

---

## 🔴 A47. The call screen stretches/crops the remote video instead of letterboxing

> ✅ **Found by two-account live call, 2026-08-18.** Vergr (desktop) called Verion
> (phone), answered, video connected. The phone's portrait camera feed was
> displayed **cropped and zoomed to fill the landscape desktop window** — the
> founder's words: "the call is happening on my phone yet on my laptop it shows a
> stretched full screen." A ceiling filled the entire frame with the sides cut
> off.

**File:** `src/screens/messages/CallScreen.jsx:194-195` (and its native twin,
which re-exports this same component).

```jsx
<video ref={remoteVideoRef} autoPlay playsInline
  className="w-full h-full object-cover" />
```

`object-cover` scales the remote stream to *cover* the container, so a portrait
(9:16 phone) source in a landscape (16:9 desktop) window is blown up until it
fills both axes and the left/right of the frame is cropped away. The result is
the zoomed, "stretched" view the founder saw. This directly violates the
project's own established rule, memory `feedback_video_fit`: **"never crop the
broadcaster preview; letterbox + blurred fill."** The call screen never got that
treatment.

**Fix.** Contain the remote video and put a blurred copy behind it as fill, the
same pattern used elsewhere for WYSIWYG video:

```jsx
{/* blurred fill so letterbox bars aren't dead black */}
<video ref={remoteBlurRef} autoPlay playsInline muted
  className="absolute inset-0 w-full h-full object-cover blur-2xl scale-110 opacity-60" />
<video ref={remoteVideoRef} autoPlay playsInline
  className="relative w-full h-full object-contain" />
```

Point both refs at the same `remoteStream` (`remoteBlurRef.current.srcObject =
remoteStream` alongside the existing assignment at line 75). If a second video
element is unwanted, at minimum change `object-cover` → `object-contain` so the
full phone frame is visible, un-cropped, with plain letterbox bars. The local
self-view thumbnail at line 211 can stay `object-cover` (it is a small fixed box
where cropping is acceptable), but the **main remote video must not crop.**

**Verify.** Place a call between a portrait (phone) source and a landscape
(desktop) viewer. The desktop must show the **entire** phone frame, correct
aspect ratio, no zoom/crop, with letterbox (ideally blurred) filling the sides.

---

## 🔴 A48. Ending a call flashes a blank screen, then dumps you on the empty message list

> ✅ **Found by two-account live call, 2026-08-18.** The founder: "the call end
> screen just goes blank then jumps to the message list, that is also bad UI."
> Reproduced: on hangup the video went black for a beat, then the app landed on
> the root Messages list showing the "CONNECT — choose a conversation" empty
> state, **not** the conversation the call was in.

**File:** `src/screens/messages/CallScreen.jsx` (`handleEnd`, line 140; render
branches, lines 185-275).

Two separate defects.

**1. No `ended` render state → blank flash.** The render handles `connecting`,
`ringing`, `active` and `failed`, but there is **no branch for `status === 'ended'`**.
When the call ends, `handleEnd` tears down the peer connection and streams (the
video element goes black), and only *then* navigates away. For that window the
user sees a dead black frame with no "Call ended" affordance.

**2. Navigates to the root list, not the conversation.** Line 162:

```js
navigate('/messages', { replace: true });
```

The comment explains the intent (avoid `navigate(-1)`, which could return to
squads/feed). But `/messages` is the **empty root list** — on desktop that is
the "choose a conversation" placeholder. The user was just in a specific thread;
dropping them on an empty list loses their place.

**Fix.**

1. Add an `ended` render branch that shows a brief, clean "Call ended · {duration}"
   card (reuse `formatTime(elapsed)` already in the component) rather than a
   detached black video. In `handleEnd`, set `status` to `ended`, render that
   card, and defer the `navigate` by ~1.2s (or drive it from the card's own
   dismiss), so the transition reads as an ending, not a crash.
2. Return to the conversation, not the root:
   ```js
   navigate(`/messages/${chatId}`, { replace: true });
   ```
   This keeps the deliberate "don't use `navigate(-1)`" choice (it is an explicit
   path, not history) while landing the user back in the thread they were
   calling from. `replace: true` still drops the dead call screen from history.

**Verify.** Make a call, hang up. There must be a visible "Call ended" beat (no
black flash), and you must land back **in the conversation thread**, not on the
empty Messages list.

---

## 🔴 A49. Sending a video gives weak/absent upload feedback — "in the dark"

> ✅ **Found by two-account live test, 2026-08-18.** The founder: "it doesn't work
> like Telegram and the user is in the dark waiting to find out if it worked …
> there should be an upload indication or sending indication." Reproduced by
> sending a 1.6 MB video from Vergr to Verion and timing it: the bubble appeared
> immediately but **dimmed**, showed a faint "0.0 MB → 1.6 MB" count, and took
> **~5 seconds** to become a fully rendered, playable video.

**File:** `src/screens/messages/ChatThreadScreen.jsx` — `SendProgress` (line 512),
the relay send path (~1937-1970), and the **legacy send path (1997-2001)**.

**Be precise: an indicator DOES exist and is well-built on the modern path — do
not "add one from scratch."** `SendProgress` renders a violet circular ring plus
a live "X MB / Y MB" (or "Compressing N%") label, and the relay path feeds it
real bytes via `onUp(pct, sent, total)`. `uploadToR2` reports progress on **both**
web (`xhr.upload.onprogress`) and native (Kotlin `vergr:upload-progress` events).
In the desktop test it worked. There are two real gaps.

**1. The legacy send path reports no progress at all.** At line 2001:

```js
const url = await uploadMediaFile(file, folder, tier, tierConfig.mediaRetentionDays);
```

No `onProgress` argument (compare line 1970, which passes `onUp`). Its optimistic
bubble (line 1999) sets `_status:'sending'` but never updates `_progress` or
`_phase:'uploading'`. So `SendProgress` shows the **indeterminate spinner** and
the byte label is **frozen at "0.0 MB / X MB"** for the entire upload, only
snapping to the real video when it completes. That is exactly the "waiting to
find out if it worked" experience. Whether a given send hits this path or the
relay path depends on the conversation/relay state, so some video sends feel fine
and others feel dead — an inconsistency that is itself confusing.

**2. Even on the working path the indicator is too quiet.** `bg-black/45` dim, a
40px ring and 10px mono text over a dark thumbnail. On a fast upload it is on
screen for ~2s and is easy to miss. Telegram's is large, high-contrast, centred
and unmissable.

**Fix.**

1. Pass a progress callback on the legacy path, mirroring the relay path:
   ```js
   const onUp = (pct, sent, total) => setOptimisticMsgs(prev => prev.map(m =>
     m.id === tempId ? { ...m, _phase:'uploading', _progress:pct, _sent:sent, _total: total ?? m._total } : m));
   const url = await uploadMediaFile(file, folder, tier, tierConfig.mediaRetentionDays, 'chat', onUp);
   ```
   `uploadMediaFile`/`uploadToR2` already accept `onProgress`, so this is wiring,
   not new plumbing. Grep for every other `uploadMediaFile(`/`uploadBlob(` call
   in this file (lines 2001, 2092, 2114 at least) and give each one a progress
   callback, so no send path is silent.
2. Make `SendProgress` prominent: larger ring, brighter stroke, a solid "Sending
   N%" / "Uploading" label with real contrast, and a clearer dim-to-clear
   transition so the thumbnail plainly reads "in progress" not "broken".

⚠ **One thing I could not verify and the fixer must:** on a **real phone**,
confirm the native upload actually emits `vergr:upload-progress` (Kotlin side)
during a chat video upload. If it does not fire, the native relay path shows the
same frozen indeterminate state, which would explain the founder's day-to-day
experience since that is the device they use. Test a real phone send and watch
the ring show a live percentage.

**Verify.** Send a video (ideally a larger one on a throttled connection). The
bubble must show a **moving** percentage/ring from 0 → 100 and a clear "Sending"
state, on every send path, on both desktop and the phone. No path may sit at
"0.0 MB" with a spinner until it abruptly completes.

**Note:** the receiver side is fine — the incoming video from Verion rendered
promptly as a circle video note with a thumbnail. And ⚠ a real 1.6 MB test video
(`share.mp4`) was sent into the Vergr↔Verion DM during this test; delete it if
unwanted.

---

## 🔴 A50. No error boundary — any single render error blanks the entire app

> ✅ **Confirmed live, 2026-08-18**, as the mechanism behind A41 #1. When
> `InlineVideoPlayer` threw `ReferenceError: resolvedSrc is not defined`, the
> **whole app went blank** — `root.innerHTML.length` dropped to **0**, every
> `<video>` gone, `document.body.innerText` empty. A crash in one leaf component
> unmounted the entire React tree, leaving a black screen with no way out but a
> manual reload.

**File:** `src/router/AppRouter.jsx` (or the top-level app shell) — there is no
React **error boundary** wrapping the app or its route/modal subtrees.

React's default on an uncaught render error is to unmount the whole tree. Without
an error boundary, **every** bug in the A41 class — and any future one — turns a
localized fault into a total blackout. The enlarge-video crash is the proof, but
the exposure is general: one bad prop, one undefined variable, one malformed
message in any rendered component takes down the entire session.

**Fix.** Add an error boundary. At minimum one at the app root that renders a
"Something went wrong — Reload" fallback and reports the error; better, also wrap
high-risk subtrees so a failure is contained:

- The **media lightbox / video player** (so a bad video cannot blank the app —
  it should show a broken-media placeholder inside the modal and let the user
  close it).
- Each **route element** (so a crash in one screen leaves the nav and other
  screens usable).
- The **message list / message renderer** (so one malformed message does not
  kill the whole conversation view).

A class component with `componentDidCatch` / `static getDerivedStateFromError`,
or `react-error-boundary`, both work. The fallback must offer a route back
(Reload / Go Home), never a dead black screen.

⚠ This does **not** replace fixing A41 — an error boundary catches the crash but
the video still would not play. Fix the `resolvedSrc` bug (A41 #1) **and** add
the boundary so the next unknown crash degrades gracefully instead of blanking.

**Verify.** With A41 #1 still unfixed (or a deliberately thrown test error in a
component), the app must show a contained fallback, not a blank screen, and the
rest of the UI (nav, other routes) must remain usable. Then fix A41 #1 and
confirm enlarging a video plays it.

---

## 🔴 A51. Creating a poll in a DM hangs forever on "Creating…"

> ✅ **Found by live DM test, 2026-08-18.** Paperclip → Poll → typed "Audit test
> poll?" / Yes / No → **Send poll**. The button changed to "Creating…" and
> **stayed there indefinitely** (16 s+, still stuck), no error. **After a manual
> reload, the poll HAD in fact been sent** and rendered correctly in the thread
> (question, Yes/No, "Tap an option to vote", 0 votes). So the send fully
> completed server-side — the poll doc AND the poll message both exist — and only
> the **client's promise never resolved**, hanging the modal on "Creating…" with
> no confirmation. This is not a failed send; it is a client acknowledgment that
> never arrives (the A15 stalled-channel class), leaving the user stuck and
> unsure, and prone to re-sending duplicates.

**Files:** `src/components/messages/CreatePollSheet.jsx:20-28` (the sheet),
`src/screens/messages/ChatThreadScreen.jsx:2596-2599` (`handleCreatePoll`),
`src/firebase/firestore.js:3328` (`createChatPoll`).

**The write actually succeeds — that is the tell.** A `runQuery` on `chat_polls`
confirmed the poll doc **was created server-side** (correct `question`, correct
`convId`, timestamp 09:07). So `createChatPoll`'s `addDoc` reached Firestore. Yet
the UI never proceeds: `handleCreatePoll` is

```js
const pollId = await createChatPoll({ scope:'dm', convId: chatId, question, options, multi });
await sendMsg({ type:'poll', text:`📊 ${question}`, contentUrl: pollId });
```

and `CreatePollSheet.create()` only leaves "Creating…" when `onCreate` resolves
(→ close) or rejects (→ re-enable). It does neither, so `busy` is stuck `true`
forever. One of two awaits never settles even though the doc exists:

1. **Most likely `createChatPoll`'s `addDoc` promise never resolves** although the
   write reached the server — the same stalled-Firestore-channel pattern as A15
   (persistent local cache + long-polling: the write goes out, the ack never
   comes back through a stalled channel, the promise hangs). Text and GIF sends
   work because those ride the **relay**, not a Firestore `addDoc`; the poll is
   the one DM action that does a direct Firestore write, which is exactly what
   stalls. That the doc is visible server-side while the client promise hangs is
   the signature of this bug.
2. Or `sendMsg({type:'poll'})` hangs after the doc is created.

Either way there is **no timeout and no error path**, so it hangs silently and
the user is stuck, and every retry leaves another orphan `chat_polls` doc.

**Fix.**

1. **Make it un-hangable.** In `CreatePollSheet.create()` (or `handleCreatePoll`),
   race the `onCreate` against a timeout and surface an error instead of an
   eternal "Creating…":
   ```js
   await Promise.race([
     onCreate({ question: question.trim(), options: filled, multi }),
     new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
   ]);
   ```
   and on reject show a toast + re-enable the button.
2. **Fix the stall at the source.** Since the doc reaches the server, wire the
   poll write into the same recovery the rest of the app uses — `resync.js`
   (`resyncNow()` / `reportSnapshotSource`) from the A15 fix — or perform the
   `chat_polls` write through the relay/optimistic path the way text messages go,
   so the promise resolves off the local write instead of waiting on a stalled
   ack. Confirm whether the hang is in `createChatPoll` or `sendMsg` by logging
   between the two awaits; the REST evidence points at `createChatPoll`.
3. Because the doc is already written when the hang occurs, the poll message
   should still be sent (and the modal closed) rather than lost — so a completed
   write is never stranded.

**Verify.** Create a DM poll. It must appear in the thread within ~2s and the
sheet must close. Kill the network mid-create and confirm it fails with a visible
error and a usable button, never a permanent "Creating…". Confirm no orphan
`chat_polls` docs pile up from a hang.

✅ **Confirmed DM-specific (2026-08-18):** the **squad** chat poll (a different
path — `sendPoll` in `SquadChatThreadScreen`, which posts a `poll` message
immediately) was created live and **posted instantly** with no hang. Only the
1:1 DM poll (`createChatPoll` + relay `sendMsg`) hangs. This narrows the fix to
the DM path and rules out the poll UI/component itself.

⚠ **Design bug on top of the hang (founder, 2026-08-18): a poll in a 1:1 DM makes
no sense.** A poll needs multiple voters; a 1:1 has exactly two people. The Poll
item should not appear in the 1:1 DM attach menu at all — it belongs only in
group chats and squad chats. The paperclip menu is clearly shared across chat
types; gate `Poll` (and audit the rest of the menu the same way) on whether the
conversation is a group. Removing Poll from 1:1 also sidesteps the hang there
entirely. `createChatPoll` already takes `scope: 'dm' | 'squad'`, so the
group/DM distinction exists — use it to drive the menu, not just the write.

---

## 🔴 A52. Squad chat says "Members — 2" and "No members yet" at the same time

> ✅ **Found by live squad-chat test, 2026-08-18.** Opened the Vanguard squad
> chat. The right rail header read **"MEMBERS — 2"** while the list directly below
> read **"No members yet."**, and the top bar read **"0 / 2 online"** although the
> viewer (@Vergr, a member) was right there. The squad *overview* screen renders
> the same two members (Vergr LEADER, Verion MEMBER) correctly — so the data
> exists; the chat view fails to load it.

**Files:** `src/screens/squads/SquadChatThreadScreen.jsx:408`,
`src/components/squad/SquadInfoRail.jsx:34,73,108`.

One root cause, three symptoms. `SquadInfoRail` draws the **count** from the squad
document but the **list** and the **online count** from a `members` array prop:

```jsx
const memberCount = squad?.memberCount ?? members.length;   // = 2 (from squad doc)
const onlineCount = members.filter(isMemberOnline).length;  // = 0 (members is empty)
...
<span>Members — {memberCount}</span>                          // "Members — 2"
{members.map(...)}                                           // renders nothing
{members.length === 0 && <div>No members yet.</div>}         // shows this
```

and the chat screen loads that array with a **silently swallowed** error:

```js
getSquadMembers(squadId).then((m) => { if (alive) setMembers(m); }).catch(() => {});
```

So when `getSquadMembers` returns nothing or throws in the chat context (it works
on the overview), `members` stays `[]` forever, no error surfaces, and the rail
shows the contradictory "Members — 2 / No members yet" plus "0 online". The
`0 online` header is the same bug, not a separate presence fault: with an empty
`members` array `onlineCount` is structurally 0. (This is adjacent to A43 but a
different mechanism — A43 hardcodes `online:false`; here the whole member list is
missing.)

**Fix.**

1. **Stop swallowing the error.** Replace `.catch(() => {})` with a logged,
   surfaced failure and a retry, so a failed member load is visible instead of a
   silent empty rail. Then find why `getSquadMembers(squadId)` returns empty in
   the chat screen when it succeeds on the overview (compare how each screen
   calls it — likely a timing/auth/shape difference, or the chat mounts before
   the squad context is ready).
2. **Never show a populated count next to an empty list.** In `SquadInfoRail`,
   when `memberCount > 0 && members.length === 0`, render a loading/failed state
   ("Loading members…" / "Couldn't load members"), not "No members yet." — the
   two facts contradict and "No members yet" is simply false.

**Verify.** Open a squad chat with known members. The rail must list them and the
online count must include the viewer, matching the squad overview exactly. Force
`getSquadMembers` to fail and confirm a visible error/loading state rather than a
false "No members yet."

---

## ✅ A53. The sign-in page led with "Tournaments" — FIXED 2026-08-19

**NEW — not in the original audit.** Spotted while loading the site to verify
A27. The audit covers tournament copy in settings (A16), the deletion screen
(A8) and squads (A35), but never looked at the **signed-out** surfaces, which
are the ones a store or processor reviewer sees first.

| File | Was |
|---|---|
| `src/components/auth/AuthShell.jsx:74` | "**Tournaments**, live streams, squads and a real creator economy" |
| `src/screens/auth/InviteLandingScreen.jsx:105` | "The home for competitive gamers: **tournaments**, live streaming, squads, and rewards." |
| `src/screens/marketing/LinkInBioScreen.jsx` ×3 | "your stream, **tournaments** and squad", "live stream, **tournaments** and community", "next **tournament** or squad" |

`AuthShell` is the sign-in/sign-up page, so **"Tournaments" was the first word
of the first sentence an unauthenticated visitor read**, while `public/llms.txt`
states publicly that Vergr runs no prize competitions and a help article says
in as many words that anyone told otherwise has out-of-date information.
`LinkInBioScreen` is a routed public marketing page.

Rewritten to the canonical positioning in CLAUDE.md (a live streaming and
social platform for gamers and creators). **Verified live** on the signed-out
page.

⚠ **Two traps found while doing it, both worth knowing:**

1. **I nearly replaced a stale claim with a false one.** The obvious rewrite for
   the vergr.me copy was "clips", but **there is no clips block**. The
   live-content block types are `vergr_stream`, `vergr_event`, `vergr_squad`,
   `vergr_group` (`BlockForm.jsx:477`). It now says "ticketed events", which
   exists. Check the block list before describing what a vergr.me page can show.
2. **`LearnTournamentsScreen` is NOT a live risk, despite how it reads.** There
   is a whole marketing page in `PublicMarketingScreens.jsx:4486` titled
   "Online Gaming Tournaments — Cash Prizes for Skill", selling entry fees,
   escrow and prize structures. It is **imported but has no `Route`**, is absent
   from the sitemap and the prerender list, and `/platform/learn/tournaments`
   redirects to the marketing home (confirmed in a browser, not assumed).
   Dead code under the no-deletion rule. **Do not panic-delete it, and do not
   route it.**

### 🔴 Left open, needs a founder call: the vergr.me editor still offers a Tournament block

`vergr_tournament` is still a selectable block type in the live editor
(`BlockForm.jsx:310,477`, `ContentTab.jsx:201`, `VergrMeView.jsx:761,1085-1086`
with a 🏆 "My tournament" label). A creator can add a block for a feature that
no longer exists, and it can never resolve to anything. Not touched here: the
no-deletion rule means removing a block type is the founder's call, and existing
pages may already have one saved, so it needs a render-safe path for those.

---

## ✅ A30 part 2 — profileVis is now enforced at the data layer. 2026-08-19

`users/{userId}` was `allow read: if true`, so "Only me" was a screen-level
suggestion: one `getDoc` returned the full profile.

**Why it had been left open, and the actual answer.** A `resource.data`
condition on a **list** is evaluated per returned document and fails the WHOLE
query if any single row fails. `users` is bulk-queried across the app (Explore
reads 300, search, the leaderboard's `orderBy`), so gating `read` would not have
hidden one profile — it would have broken Explore, search and the leaderboard
for everyone the moment one person chose "Only me". That is why `get` and
`list` are split:

```
allow get: if isOwner(userId)
  || profileVis == 'Everyone'                       // the default: short-circuits
  || follow edge in either direction;               // 'Friends & Followers'
allow list: if true;
```

Cost is zero extra reads on the default path, because `||` short-circuits and
`Everyone` is the default. Six emulator assertions cover it, including one that
proves a bulk query still succeeds with a hidden user present — if that ever
fails, three major surfaces are down.

⚠ Residual, stated plainly: a bulk query can still return the profile FIELDS of
a hidden user. Closing that needs the profile split into public and private
documents, a data migration rather than a rule. The genuinely sensitive fields
are already out (phone → `private/contact`, KYC personal data → `private/kyc`).

## ✅ Top Earners leaderboard — BUILT 2026-08-19

Previously removed on the reasoning that publishing per-creator earnings was a
product decision. Founder overruled: TikTok ranks creators by coins earned, and
it is a normal creator-economy surface. Built the same way as Top VP — a
`getEarnersLeaderboard` callable, because the figure is on `wallets`, which is
owner-only.

Ranked on **`totalEarnedCoinsGross`** (lifetime gross coins earned), the same
aggregate the revenue-share ladder keys off. Deliberately NOT `owedMicroUsd`,
which is the outstanding payable and goes DOWN when someone is paid — a
leaderboard of that would rank creators by how recently they had not been paid.
Only the ranking figure leaves the server; never a balance, never the payable.

---

## ✅ A44 — live streaming. ROOT CAUSE FIXED ON THE BOX 2026-08-19

**This document, and CLAUDE.md, both say `vergr-ingest` "exists ONLY as a
compiled binary" with no source in the repo. That is false.** The box was
checked directly: `/opt/vergr-ingest/src/` holds the complete Go source, and so
do four other services. See `infra/README.md`.

**The bug, at `main.go:87`:**

```go
q := fsClient.Collection("streams").Where("streamKey", "==", key).Limit(1)
```

`createStreamSession` moved the publish key OFF the world-readable `streams`
document into `stream_keys/{streamKey}` — deliberately, because it authorises
publishing and the HLS path is `cdn.vergr.app/streams/<streamKey>/index.m3u8`,
so a viewer who could read it could hijack the publish AND rebuild a paid
stream's URL. Nobody updated this service, so the query matched nothing and
every browser go-live got 401. The box's own journal confirms it:
`init: resolve key failed: unknown stream key`, 2026-08-18 20:40 — this
document's own test.

This document's option 1 ("make the backend satisfy the old lookup") is
correctly ruled out by its own caveat: the binary reads `streams` directly, and
satisfying it would mean putting the credential back on a public document.
Option 2 was taken.

**Fixed:** `resolveStreamKey` now resolves `stream_keys/{key}` by document id
(cheaper than the collection query it replaces, the same move vergr-rtmp-auth
already made), then fetches the stream doc by id for the lifecycle checks
(status, ingestType) it still needs. Host and plan prefer the values stamped
alongside the key, falling back to the stream doc for pre-migration keys. Built
on the box with Go 1.22.2, previous binary kept as `vergr-ingest.bak.prekeyfix`,
service restarted and active.

**Client half, same finding.** `status:'live'` was the FIRST thing `startStream`
did — before ingest was even attempted — and nothing rolled it back on failure.
That is the 31-minute "LIVE" broadcast that never sent a byte. Now: the publish
key is resolved inline (it is fetched asynchronously, so pressing Go Live early
used to reach `startBrowserIngest` with `streamKey: undefined`), ingest is
established FIRST, and only then is `status:'live'` written. Any failure stops
the session, rolls the status back to `created` and surfaces the real error.

⚠ **Not proven end to end.** The 401 is fixed at the protocol level and the
service is running, but a real broadcast has not been driven. That is the
verification pass.

---

## ✅ A2 — icon font: 3,948,768 → 458,288 bytes. DONE 2026-08-19

**The size was not the icon count. It was the AXES.** The shipped file was the
full four-axis variable font (opsz 20..48, wght 100..700, FILL 0..1,
GRAD -50..200), and nearly all of that weight paid for axes this app never
moves: `Icon.jsx` sets only `font-variation-settings: 'FILL' 0|1`, and
`.material-symbols-outlined` pins `font-weight`. Requesting opsz/wght/GRAD at
their single used values (24 / 400 / 0) and leaving only FILL variable gives
**8.6x smaller with the FULL icon set still present** — so no icon can go
missing. `font-display: block` stays, as this document says it should; the 3s
window was only a problem because 3.9MB could not make it.

### Why it is not the ~40KB name-subset this document asked for

Not a shortcut, a wall, and worth recording so nobody retries it blind:

- 429 distinct icon names are reachable (literals + lookup tables + the
  interpolated `format_align_*` family, enumerated against Google's official
  4,226-name metadata so non-icon strings could not sneak in).
- Google's `css2?...&icon_names=` is capped by **URL length**, measured here:
  360 names (4,124 chars) works, 380 (4,322) silently falls back to the full
  font. 429 needs ~4.8KB. Shortening the family spec buys ~40 chars, nowhere
  near enough.
- **Splitting across two faces does not work.** Ligature lookup happens inside
  ONE font, and CSS `src` fallback fires only when a file fails to LOAD, never
  per missing glyph. Two faces cannot be partitioned by `unicode-range` either,
  because every icon name is spelled in the same ASCII letters.
- A subset that misses a name renders that icon **as its literal word** — the
  exact bug being fixed. So a partial subset is worse than none.
- No local subsetter is available: this machine has no Python, and installing
  one is not a change to make on the founder's box unasked. **If fonttools ever
  is available, `pyftsubset --glyphs=` against the 429-name list reaches ~40KB.**

### Also fixed: six icon names that were never real

The name collection cross-checked every `<Icon name="…">` literal against the
official list and found **six that are not Material Symbols at all**, so they
have been rendering as raw words this whole time regardless of font size —
the same symptom A2 is about, from a different cause. 12 call sites across 8
files:

`clock`→`schedule`, `coins`→`paid`, `plus`→`add`, `unlink`→`link_off`,
`wrench`→`build`, `x`→`close`.

### Also fixed: the CDN fallback was dead

The second `src` pointed at **v341**, which the "icons render as text" note in
CLAUDE.md records as having started 404ing — that is why the font was
self-hosted in the first place. It now points at the same pinned-axis v367
file, so the fallback is both live and small instead of a 3.9MB stranger.

Built artifact confirmed: `dist/fonts/material-symbols-outlined.woff2` is
458,288 bytes and starts `wOF2`.

---

## ✅ A11 + the rest of A28 — DONE 2026-08-19

**A11 (profile completion).** No new callable was needed: `quest_claims` is
`allow read: if isAuth()` and the claim ids are deterministic
(`${uid}_${questId}`, no date), so the six are fetched BY ID — no query, no
index, exact. New `getOneTimeQuestClaims` in firestore.js, deliberately separate
from `getQuestClaims`, which filters to TODAY and therefore could never return a
profile quest claimed in July.

Also as specified: the ring now measures `i.done` (completeness) instead of
`remaining` (which folded in localStorage claim state, and is why a profile
with a ticked picture and banner still showed 0%), and the already-claimed
response no longer vanishes silently — it says "Already added to your VP".
localStorage stays purely as a first-paint cache.

**A28 — the KYC caps, and something bigger behind them.** The figures were
verified against `KYC_MONTHLY_CAP_MICRO_USD` in `functions/creatorPayouts.js`:
50 / 2,500 / 15,000. **The numbers were right; the currency was not.** The unit
is MICRO-USD, so they are dollars.

Two things followed from checking rather than symbol-swapping:

1. **The "source-of-funds on first €1,000+ deposit" trigger does not exist.**
   Nothing in the code or the policies has a 1,000 threshold; source of funds
   gates the highest payout tier, not a deposit. That clause is removed rather
   than re-denominated.
2. 🔴 **The published AML policy and ToS stated the caps in EUROS** — six
   statements across `compliancePolicies.js`. Since €15,000 > $15,000, the
   published control was **overstated relative to what the engine enforces**,
   which is precisely what `creatorPayouts.js`'s own comment warns about ("a
   control we publish and do not enforce is the one we get held to") and what
   CLAUDE.md requires ("every threshold in them was read out of the code
   first"). All six now say US dollars. **Verified live on
   `/platform/aml-policy`: zero euro mentions, three USD statements matching the
   enforced caps.**

The root of it was in the server: the constants literally named `_MICRO_USD`
carried `// €50/mo` comments. Those are corrected too, so the next reader does
not re-derive euros from them.

---

## ✅ A9, A13, A14, A21 — DONE 2026-08-19

**A9 (poll form behind the toolbar).** `.modal-body` already had a hardcoded
`padding-bottom: 140px`, so the obvious "add padding" fix was already there and
still failing. The toolbar is `position:absolute; bottom:0` with
`flex-wrap: wrap`, so on a narrow window it wraps to two rows and grows past
140px. The padding is now MEASURED from the toolbar with a ResizeObserver, which
covers every mode and every width; a bigger magic number would just move the
breakpoint. Attached with a callback ref rather than `useRef` + a dependency-less
effect, which would have rebuilt the observer on every keystroke.

**A13 (duplicate Share/Follow).** Took the preferred option: `ActionRow` stays in
the header and `FloatingActions` renders only once a sentinel after the header
leaves the viewport (IntersectionObserver). Nothing is removed, and the two
never show at once. The hooks are declared above the `if (!data) return null`
early return, which is required and easy to get wrong here.

**A14 (off-brand cyan) — confirmed, and the suggested fix was wrong.** Traced it
as this document asks: `defaultPage` sets `theme:'dark'`, `resolveAppearance`
also falls back to `'dark'`, and `THEMES.dark.accent` is `#4DFFD4`. So every new
page really did render in the excluded cyan.

But A14 says to "change only the default selection to the violet theme
(#7B1FFF)" — **#7B1FFF is the accent of the LIGHT theme**. Following that would
have made every new vergr.me page light-mode, a far bigger change than intended
on a dark product. There is also no separate "cyan theme" to preserve: cyan was
one token on the default dark theme. That token moved to brand violet; a creator
who wants cyan can still set it as a custom colour, which overrides theme tokens.

**A21 (silent catch-all).** Now a real 404 that names the path and offers Go
home / Search, instead of `<Navigate to="/" replace />` which hid the failure and
broke Back too. The `VLINK_PATH` branch is untouched (load-bearing, memory
`never-break-vlink`) and `verify-vlink-live` still passes.

⚠ Caught while writing it: I first used `href="#/"` hash links from CLAUDE.md's
"HashRouter" note. The app is on **BrowserRouter** (AppRouter ~line 746) — the
note is stale. Switched to `<Link>`, or every 404 button would have full-page
reloaded to a broken URL.

**Verified live:** `/settings/vergrme` — the exact path this document used —
renders "Page not found", names the path, and keeps the URL.

---

## ✅ Copy/layout batch: A3, A17, A28, A34, A38, A42 — DONE 2026-08-19

**A42 (dead footer link).** The href was already `/linkinbio`; the breakage was
`mkPath`, which prefixes `/platform` to every footer target — correct for the
other 16, wrong for this one, because Link in Bio is routed at the TOP level and
that is what the sitemap carries. Added an explicit `raw` flag on that tuple
rather than special-casing `mkPath`. **All 17 footer targets were checked
against the router; this was the only broken one.** Verified live: the anchor
now reads `/linkinbio` and lands on the real page.

**A3 (price printed twice).** Root cause was one level below the Buy screen:
`convertFromUsd` computed `(usd / usdRate) * usdRate` for a USD viewer, i.e. the
same number back, so "$0.99" was followed by "≈ $0.99 · charged in USD". It now
returns null when the viewer is already on the charged currency, which is what
its own contract promised ("or null when no conversion applies"). New
`hasLocalEstimate()` so the three call sites can suppress the WHOLE line —
`PriceQuote`, `CartContents` and the BuyScreen fallback would otherwise each
have been left with a dangling " · " separator.

**A17 (Security card).** Named four things, two of which do not exist anywhere.
Now describes the four rows that are actually on that screen.

**A28 (euros).**
- `MembershipTiersScreen` hardcoded `EUR_PER_COIN = 0.0099`, the
  PRE-redenomination anchor, so a 100-coin tier read "≈ €0.99" when it is worth
  about $1.27 — wrong symbol AND ~28% low. Both it and `BoostScreen`'s separate
  hardcoded `0.01` now derive from the Starter pack in `COIN_PACKS`, the same
  source checkout prices from, so they cannot drift again.
- **`TransactionReceiptScreen`'s mock fallback is deleted.** It rendered a
  fabricated receipt — "500 Coin Pack", "€4.49", "Visa •••• 4242" — for any
  transaction that was not found. A screenshot of it would have been
  indistinguishable from a real receipt for a purchase that never happened, and
  there is no 500 Coin Pack in `COIN_PACKS` and no Visa anywhere in the product.
  Replaced with a real "Receipt not found" state plus a link to history.
- 🔴 **Still open:** the KYC screen's payout ceilings (€50 / €2,500 / €1,000).
  Those are compliance-facing numbers a user may rely on, and this document is
  right that they must be read out of `functions/creatorPayouts.js` rather than
  having their symbol swapped. Left rather than guessed.

**A34 (content library).** Branches on whether a filter is actually applied: an
empty library invites a first post, a filtered-empty view offers Clear filters.

**A38 (notifications).** `notif.title` was never read, so a quest claim showed
"Profile banner" instead of "+300 VP earned!". Title is now the primary line
with the body beneath, matching what `NotificationsDrawer` already did — the two
surfaces disagreed about the same notification, which is how it survived.

---

## ✅ A26 + A31 — DONE 2026-08-19

**A26 (creator gate).** Both bugs on that one line fixed as described: the state
is now derived rather than snapshotted, gated on the `loading` flag `useUser()`
already exposes, and the dismissal is remembered in `sessionStorage`. That kills
the eleven-dismissals-per-session behaviour AND the worse one — a real creator
who hard-reloaded a Studio page being told to become a creator, because the
`useState` initialiser read an async `profile` exactly once and never
reconsidered. No native twin exists.

**A31 (`/boost`).** New `purchaseBoost` callable in `functions/walletActions.js`,
modelled on `contributeToSquad` as this document suggests. It fixes four things,
not one:

| Was | Now |
|---|---|
| Debited the wallet from the BROWSER, and `balance`/`totalSpent` are server-only, so **every purchase failed** with a generic "Boost failed" | One server transaction |
| Read-then-write with a computed absolute value — two tabs would race and lose a debit | `increment()` inside a transaction |
| Wallet debit, boosts doc and ledger row were three sequential unbatched writes; a failure after the first left a charge with no boost | All three in the same transaction |
| Toast hardcoded "+10 VP" while calling an `awardVP` shim that ignored its arguments | VP comes from the server's `ACTION_VP`, and the toast prints what was actually granted |

Price now comes from a server-side `BOOST_COSTS` (keep in sync with
`vpSystem.js`; the client copy is display-only). An underfunded wallet gets the
exact shortfall instead of a blanket failure.

**And it is reachable.** This document is right that leaving a revenue category
behind an unlinked broken screen is not an option once it works, so the wallet
home gained a "Boosts" quick action beside Buy coins and Subscriptions — the
wallet being where you spend coins. The `tournament` boost was already removed
from `BOOST_COSTS` with the tournament sweep (A54).

⚠ Not verified live: both are behind auth. Build, `node --check` and `no-undef`
clean; `purchaseBoost` deployed.

---

## ✅ A20 — Leaderboard. DONE 2026-08-19

All five dead categories confirmed against the writers before acting: `vp` and
`totalEarned` are written **only to `wallets`**; `vpLevel`, `streamHours` and
`totalXP` have **no writer anywhere in the repo**.

**Neither option in this document was taken as written.** Denormalising vp onto
`users` means either mirroring at every VP writer (there are many, it is easy to
miss one, and future writers will not know) or a Firestore trigger on every
wallet write — which bills an invocation on every tip, purchase and quest claim
to keep a leaderboard fresh. The founder has already rejected a scheduled sweep
on cost grounds, and that reasoning applies harder to a per-write trigger.
Deleting all five loses the default tab for no reason.

So: **read the real source.** New `getVpLeaderboard` callable queries
`wallets` ordered by `vp` (a client cannot — `wallets` is owner-only, correctly,
because it holds money) and returns nothing but `{uid, vp}`. One invocation per
leaderboard view, no denormalisation, and it cannot drift out of sync.

| Category | Outcome |
|---|---|
| **Top VP** (default tab) | Fixed via the callable |
| **Highest Level** | Fixed by the SAME query — level is `getVPLevel(vp)`, monotonic in VP, so the ordering is identical and only the displayed unit differs |
| Top Streamers | **Removed** — nothing has ever recorded stream hours; tracking them is a feature, not a leaderboard fix |
| Top XP | **Removed** — seeded to 0 at onboarding, never incremented |
| Top Earners | **Removed, deliberately.** It *could* be surfaced exactly like vp, since `totalEarned` is on `wallets`. But publishing a per-creator ranking of earnings reveals what Vergr owes each creator, and that is a product and privacy decision, not a bug fix. Not mine to make unilaterally |

**Also fixed while adjacent:** `getUserVP` had **no auth check at all** — any
anonymous caller could read any uid's VP through a deliberate hole in the
owner-only `wallets` gate. This document flags it in the "not broken" section
("add `if (!request.auth) throw` to it while nearby"). Done.

⚠ Not verified live: `/leaderboard` is behind auth. Build, `node --check` and
`no-undef` all clean; both functions deployed (the first attempt hit the
documented cold-discovery timeout, second succeeded).

---

## ✅ A41 (all five) + A50 — DONE 2026-08-19

**#1 `InlineVideoPlayer` — the one that blanked the app.** The fix was not
`src={src}`. `pickVideoUrl(originalUrl, renditions)` in `utils/adaptiveVideo.js`
is exactly what `resolvedSrc` was meant to be, it was **already imported at the
top of this very file**, and it was never called — the wiring line was simply
missing. It is defensive by design (no renditions, fast connection, or any
throw at all returns `src` unchanged), so it restores video AND honours the
documented "behaves EXACTLY as it always has" contract on the `renditions` prop,
instead of leaving that prop a lie.

**#2 `PostCard`** — `MediaRow` read `post?.adaptiveRenditions` but never
received a `post` prop. `MediaContent`, its only caller, had it and was not
passing it down. Threaded through. This document's warning is worth repeating:
optional chaining guards a null VALUE, never an undeclared IDENTIFIER, so
`post?.x` with no `post` in scope still throws.

**#3 `Subscriptionscreen`** — Cancel on the "Complete your payment" modal called
`stopPoll(); closePopup(); setCardWaiting(false);`, none of which exist. This is
the paid path, so it was read before editing: `useBuyCheckout` already returns
**`cancelCheckout`**, which does precisely those three things
(`stopPolling` + `closePopup` + `setCheckout(null)`). The screen just never
destructured it. `cardWaiting` is derived (`!!checkout`), so a setter for it
could never have existed.

**#4 `ProductsPanel`** — `microOf` was defined inside the parent component while
`cancel` lives in a child, so the cancel-confirm threw and an order could not be
cancelled at all. It is a pure function; lifted to module scope.

**#5 `firestore.js`** — `catch (err)` logging `error`. Fixed earlier with A18.

### A50 — error boundaries

There was **no boundary anywhere in the codebase**. New
`src/components/ErrorBoundary.jsx`, mounted in two places:

- **Root** (`main.jsx`, inside `DesktopUpdateGate`) — the backstop.
- **Route level** (`AppRouter`, wrapping `<Suspense><Routes>`) — inside the app
  shell, so a screen that throws leaves the nav, drawers and banners mounted
  instead of taking the page with it.
- **`MediaLightbox`'s video branch**, with an inline "This video could not be
  played" fallback — the exact spot A41 #1 blanked the app from. The lightbox
  survives so the user can still close it.

It supports a per-caller `fallback` (node or `({error, reset}) => node`), which
is what makes the inline media placeholder possible rather than a full-page
error. Note what a boundary does NOT catch: event handlers, async callbacks,
timers and SSR — those still need try/catch at the call site.

⚠ A boundary is not a substitute for the fix, which is why A41 #1 was fixed
first. Verified: `no-undef` clean across all five sites, build clean, and the
live app boots normally with both boundaries in the tree (`root.innerHTML`
50,074 chars, no fallback rendered). **Not verified live: the enlarge-video
journey itself**, which needs a signed-in chat containing a video.

---

## ✅ A15 + A10 + A12 — DONE 2026-08-19

**A15 (`/watch` hangs).** Exactly as diagnosed: `loading` starts true and clears
only inside the snapshot callback, so the `if (!streamId) return` guard meant to
protect the missing-id case was what caused the hang. Now
`if (!streamId) { setLoading(false); return; }`, falling through to the
not-found branch.

⚠ **The same bug was in `MobileLiveViewer` too.** This document's sweep listed
nine screens it had cleared, but not the mobile twin of the very screen the
finding is about, and it had the identical defect. Both fixed.

Also: the not-found branch's "Browse live" button navigated to **`/`**, the home
feed, which is not a live list. Both now go to `/streams`, which has a real
empty state and a working Go Live CTA. This document asks to "confirm that
branch offers a route out" — it did, but to the wrong place.

**A10 (Explore recommends you to yourself).** Self-exclusion added, web and
native.

⚠ **The activity threshold this document proposes was deliberately NOT added.**
A10 suggests requiring `avatar || followerCount > 0 || postCount > 0` before an
account can be recommended. **A39, in this same document, forbids exactly that**
and so does the comment in the code: the founder rule from 2026-06-29 is that a
user shows in Creators unless they are a guest or opted out, with no onboarding
or post-count gate, because those gates wrongly hid real accounts. Zero-follower
real people appearing is correct behaviour. Adding the clause would have
silently reversed a founder decision to fix a cosmetic complaint.

The `player####` accounts A10 wants gone are guests missing their `isGuest`
flag; per A39 that is fixed in the DATA (the admin "Delete guest account"
button) or at signup, never with a username heuristic and never with a cron.

**A12 (squads you are already in).** `Find Squads` now subtracts squads
containing the viewer. Same pattern as A10, and this document is right that they
are one rule: a discovery surface must subtract the viewer's existing
relationships.

⚠ Not verified live: `/watch` and `/squads` are behind auth, and signed out they
redirect to login. Build and `no-undef` clean.

---

## ✅ A18 — four inert privacy controls. DONE 2026-08-19

All four zero-caller claims reproduced before acting, and `friendRequest` /
`sendFriendRequest` returns **0 matches across the whole repo** — the feature
was never built. The rule applied was this document's own: enforce or remove,
never leave inert.

| Control | Outcome |
|---|---|
| **Who can comment** (`commentContent`) | **ENFORCED** at `addComment`, the single choke point. Default is 'Everyone', so nobody who has not changed it sees any difference |
| **Show activity feed** (`activityFeed`) | **REMOVED** — there is no activity feed |
| **Allow friend requests** (`friendReq`) | **REMOVED** — no friend-request feature exists anywhere |
| **Allow downloads** (`allowDownloads`) | **REMOVED**, and this one departs from the instruction above. Reasons below |

**Why `allowDownloads` was removed rather than enforced at `MediaLightbox`, as
this document suggests.** Three things only visible from the code:

1. The lightbox is used in **chat** (DM thread, chat detail, squad chat) and for
   paid media. It is not a feed component.
2. **The setting defaults to `false`.** Enforcing it as worded would therefore
   have stopped people saving a photo someone sent them in a DM, for every user,
   on day one. No messenger behaves that way, and it would read as a break.
3. Lightbox items carry **no owner uid**, so per-owner enforcement means
   plumbing sender identity through four call sites — real work to enable a
   control that mostly does harm. Meanwhile the FEED, where "allow downloads of
   my content" would actually mean something, has no download affordance at all,
   which this document also notes.

**But there was a real leak next door, and it is now fixed.** `LockedMedia`
renders unlocked PURCHASES through the same lightbox, so paid content was one
tap from the camera roll. `MediaLightbox` gained an `allowSave` prop (default
true, so chat is unchanged) and `LockedMedia` passes `false`. Not a DRM claim —
a screenshot always exists — but a creator's paid work should not ship with a
save button on it.

⚠ **Honest limit on the comment gate:** it is client-side, like every other
privacy control here. It stops the app writing a comment the owner does not
want; it does not stop a determined caller hitting Firestore directly. A
rules-level gate needs the owner's setting readable from the post document,
which is a larger change than this finding. Also note `addComment` **fails OPEN
on a privacy-lookup error** — deliberately: falling closed would break every
comment on a transient read failure.

Both callers now surface the refusal instead of `console.error`-ing it; a
blocked comment previously left the user staring at their own text.

**Also fixed in passing: A41 #5.** The `no-undef` sweep over the touched files
caught `firestore.js` logging `error` inside `catch (err)` — the error HANDLER
threw a ReferenceError, turning a handled ad-fetch failure into an unhandled
one. One character.

---

## ✅ A4 + A36 — support tickets. DONE 2026-08-19

Fixed together, as this document says to: A36 (two "Vergr Support" rows) is the
visible half of A4 (a ticket rendering as a full group chat).

**The model is correct and was NOT changed.** A support ticket is deliberately a
GROUP conversation because the DM relay path is ciphertext and support has to be
readable by whichever agent picks it up next. What was missing is suppressing
the group UI it inherits. Everything keys off the `supportThread` flag the
conversation already carries.

| Removed on a support thread | Why |
|---|---|
| Members rail (`MessagesMasterDetail`) | Exposed support STAFFING with OWNER/ADMIN roles to the person raising the ticket, and its Invite button let them add a stranger who would then read the whole history |
| Header tap → group screen | Same screen, reachable by tapping the title. The header is now inert on a ticket |
| `/messages/:id/group` route itself | The header link was only one entry point; the route is typeable. **Both** `GroupInfoScreen` and `NativeGroupInfoScreen` now redirect back to the thread |
| Auto-delete | Let a user set their own support record to self-destruct |
| Report | Aimed the reporting flow at the support team currently answering them |
| Delete Chat | Orphaned the user's side while the agent's queue row survived, so the ticket lived on with nobody able to see it |

Kept: Search, Mute, Auto-translate, Jump to date, Wallpaper, Clear Chat.

**A36, in all three inboxes** (`MessagesListPanel`, `MessagesInboxScreen`,
native): a ticket now lists with the official channel row it replaces instead of
under GROUPS, and **the synthetic official support row steps aside once a real
ticket exists**. Order matters here: the real conversation is the one carrying
the unread count and the true last message, and the synthetic row cannot, so
suppressing the real one instead would have made users miss support replies.
Before a ticket exists the official row remains, because it is the entry point
that provisions the thread.

---

## ✅ A19 + A30 — vergr.me drafts, KYC and phone. DONE 2026-08-19

**A19 (editor auto-publishes).** `defaultPage` now sets `isPublic: false`,
`publishVergrMePage` sets it true, and the Publish button no longer disables
itself on a page that has never been published (`form?.isPublic !== false &&
…`), which would have trapped the user with a private page and a dead button.

**A30 part 1 (drafts leak).** The draft was a FIELD on the world-readable
`page` doc, so anyone could watch unpublished edits. **Firestore rules gate
documents, never fields**, so the draft moved to its own doc,
`users/{uid}/vergrMe/draft`, and the rule became
`allow read: if docId != 'draft' || isOwner(userId)`. `saveVergrMeDraft` and
`publishVergrMePage` `deleteField()` the legacy `draft` off the public doc, so
existing pages migrate the first time their owner edits or publishes.
`initVergrMePage` prefers the draft doc and falls back to the legacy field, so
in-progress work is not lost. Six emulator assertions cover it.

### 🔴 A55 (NEW). Every user's raw phone number was world-readable

**Found while assessing A30's user-doc question.** `savePhoneNumber` wrote
`tx.update(userRef, { phone: normalized, … })` — the raw E.164 number — onto
`users/{uid}`, which is `allow read: if true`. **Any visitor, signed out, could
read any user's phone number with one `getDoc`.**

Worse, there is a whole `phoneVisibility` system ('public' / 'contacts' /
'selected' / 'hidden') enforced server-side in `matchContactHashes`. Setting it
to **hidden** removed you from contact matching while your actual number stayed
public. Same shape as A18: a privacy control enforced on one path while the
data sits open at the data layer.

**Nothing ever read it.** Not one call site in `src/` or `functions/` — the
client only checks `profile.phoneHash` for a boolean "has a phone". It was
write-only PII. It now goes to `users/{uid}/private/contact`, and the public
field is `FieldValue.delete()`d on the same write, so anyone already exposed is
migrated the next time they save a number. **`phoneHash` deliberately STAYS**
on the user doc: `matchContactHashes` needs `where('phoneHash','in',…)` and a
collection query cannot reach into a subcollection.

### 🔴 A56 (NEW). Adding a phone number minted 1000 coins, not VP

Same function. It credited `balance` and `totalEarned` — **real spendable coins
at ~$0.0127 each, so roughly $12.70 per user**, and it inflated a lifetime
earnings aggregate. Everything around it said VP: the constant's own comment
("VP awarded once"), the notification (`+1000 VP earned!`, type `vp`) and the
quest registry. `claimQuestReward` had the identical bug and its fix carries the
same note: *"Earlier versions credited `balance` instead of `vp`."* Now credits
`vp`, and the ledger row gained `currency: 'vp'` so the wallet does not render
it as coins (the A1 defect).

### A30 part 2 — KYC split, and why the blanket rule is UNCHANGED

`users/{uid}.kyc` carried `age`, the government-ID `country`, `sessionId` and
`identityHash`. That hash is, in the code's own words, a *"stable per-PERSON
fingerprint"* — equal for two accounts verified by the same human. **World-
readable, it is an alt-account correlation oracle**, and it would link a masked
Vanguard moderator to their public account. `identityHash` and `age` have zero
readers anywhere (identityHash's only consumer, `gemTransfer.js`, was deleted).

`diditWebhook` now splits the payload: status (`verified`, `provider`,
`failureReason`) stays on the public doc because that is what `assertKycVerified`
and `KycGate` gate on; `age`, `country`, `sessionId`, `identityHash` go to
`users/{uid}/private/kyc`. It uses `update()`, **not `set({merge:true})`** —
merge deep-merges nested maps, so fields written by an earlier build would
survive on the public doc forever; `update()` replaces the `kyc` map wholesale
and migrates the leak in the same write. `CreatorVerificationScreen` (the only
consumer, showing the owner their own country) reads the private doc with a
fallback to the old field.

⚠ **`users/{userId}` is STILL `allow read: if true`, and that is deliberate.**
This document offers three options and calls (b) "right regardless". (b) is
**not** safe for `settings`: `src/utils/privacy.js` reads the TARGET user's
`settings.privacy` client-side to decide `canMessage`, `hiddenFromDiscovery`
and friends, so moving settings into an owner-only subcollection would break
the privacy enforcement that A18 confirms currently works. The correct
sequencing is to move the genuinely private payloads out one at a time — phone
and KYC are done — rather than flip the collection rule and break profiles,
search and avatars everywhere. `profileVis` remains screen-level only; closing
that properly needs the (a)/(c) decision this document describes, and it is the
one piece of A30 still open.

---

## ✅ A54. Full tournament sweep — DONE 2026-08-19 (founder-instructed)

Founder: *"you know that tournaments do not exist anymore so that as well as
anything that indicates tournaments needs to be removed."* This supersedes the
no-deletion rule **for tournaments specifically**. A8, A16 and A35 are folded in
here since they were all instances of it.

**Scoping matters, and got checked first.** A raw grep finds 482 live
tournament references, but **141 are in `firestore.js` alone and most of those
are the `tournaments` COLLECTION, which is where ticketed EVENTS live.**
Blanket-removing would have destroyed events, a live revenue feature. Field
names like `tournamentId` on stream and chat docs are the same story: internal
identifiers for events, not user-visible, and renaming them is a data
migration. **Those were deliberately left. Do not "finish the job" by sweeping
them.**

What was removed, all user-visible or user-reachable:

| Area | Change |
|---|---|
| Settings (A16) | Free plan bullet "Core + tournaments" → "Core features" |
| Linked Accounts (A16) | All 4 platform rows sold "auto-result detection" whose ~70 Cloud Functions were deleted 2026-08-17. Now describe showing your handle on your profile. Rows kept, the callables are still deployed |
| Deletion screen (A8) | "Match history, tournament entries" → "Your posts, clips, squad activity, VP and stats" |
| Squads (A35) | "Scrims & tournaments" ×2 → "Scrims & events"; roles blurb; the no-squads pitch; events blurb |
| Squad chat (A35) | `TournamentEmbed` linked to **`/match/:id`, a route deleted on 2026-08-17**, so every historical share silently dumped the user on the home feed. Now `/e/:id`. Labels → Event. **The prize-pool line is gone** and new shares no longer send `prizePool`. The renderer itself is KEPT: squad chat history is permanent and removing it would blank old messages |
| Squad chat share UI | "Share a Tournament" → "Share an Event", empty state, item labels |
| vergr.me | `vergr_tournament` block **fully removed**: registry entry, editor form, list label, enrich case, public-page click handler. It was already unaddable; a saved block now renders **null** rather than falling through to the default LinkBlock, which would have drawn a dead link |
| vergr.me copy | LinkInBio ×3, IntegrationsPanel, event-picker empty state |
| Live viewers | `TournamentOverlay` unmounted from `ViewerStreamScreen` + `MobileLiveViewer`. It floated a bracket / "Round N vs opponent" card over streams and **queried the `tournaments` collection, so an EVENT doc could have made tournament UI appear over a live stream.** Also drops 2 Firestore listeners per viewer |
| Marketing | `LearnTournamentsScreen` **deleted** (124 lines) — a full page titled "Online Gaming Tournaments — Cash Prizes for Skill" selling entry fees, escrow and prize structures. Unrouted and unlisted, but a file selling cash prizes is the worst thing for a reviewer to find |
| Router | 20 dead tournament lazy-imports removed (screens with no `Route`), plus the 2 unrouted OBS overlays. `TournamentOverlayNeon.jsx` stays on disk: `StreamerBattleOverlay` imports its `OVERLAY_CSS` |
| Boosts | "Tournament Boost" product removed from `BOOST_COSTS` |
| Leaderboard (native) | Per-game weekly board removed (it tallied wins from COMPLETED TOURNAMENTS, so it could only ever be empty). Also removed `predictorStreak` "Hottest Streak" — that ranked Champion Picks, the prediction layer — and **deduped the category list, which listed 5 boards twice** |
| Misc | Consent sheet promo copy; `UserAvatar` tooltip "Recent tournament champion" → "Featured creator", matching what `PublicProfileScreen` already called it; Treasury role blurb |

⚠ **Removing code deletes variables, and a passing build does NOT catch that.**
Deleting the per-game leaderboard orphaned `LB_GAME_PICKS`, leaving
`useState(LB_GAME_PICKS[0])` referencing a deleted binding — **exactly the A41
class of bug that blanks the whole app**, and `npm run build` was perfectly
happy with it. Caught by running `no-undef` over every touched file. **Do that
after any removal work:**

```bash
npx eslint@9 -c <flat-config-with-no-undef> --no-config-lookup <files...>
```

Verified: build clean, `no-undef` clean across all 30 touched files, deployed,
signed-out pages checked live.

---

## What is NOT broken (checked, so nobody re-investigates)

- **1:1 video calling — PASS** (two-account live test, 2026-08-18). Vergr
  (desktop) called Verion (phone): the doc went `ringing` → `active` when the
  phone answered, `offer` and `answer` SDP both present, and **live video
  connected** for ~2 minutes, P2P-encrypted. `callerCandidates`/`calleeCandidates`
  subcollections were empty during the live call, which is **not** a defect —
  ICE is bundled in the SDP (non-trickle), and media demonstrably flowed. **Do
  not file a "0 ICE candidates = broken call" finding** (I nearly did; the live
  video proved it wrong). The only call defect is A47 (video is cropped/stretched
  on the desktop, not letterboxed). Every apparent "call stuck on Connecting"
  before permissions were granted was purely ungranted camera/mic in the test
  browser — with permission granted the call works end to end. ⚠ One minor
  residual worth a look: when camera/mic is **denied**, the call sits on
  "Connecting" and ends with **no error surfaced** to the caller — a silent
  failure, but low priority next to A47.
- **Post composer sweep (2026-08-18) — works well.** Opened `/` → New Post
  (`CreateComposer`). Rich and functional: text with B/list/sticker/emoji, quick
  chips (Hot take / Strategy / Achievement), hashtags + suggestions, topic picker,
  **Add media** dropzone, action cards (Go Live, Share Clip, **Create Poll**,
  Squad Update, Host an Event), and a full toolbar (Media, GIF, Poll, Clip, Mood,
  Stats, Tag players, Location). **Poll mode is excellent** — a live in-feed
  Preview, Duration, Multi-select/Anonymous, quick templates — and is a **different
  code path from the DM poll** (`createPoll`, not `createChatPoll`), so it does
  NOT hang (contrast A51). **Schedule** opens a complete planner (calendar, time,
  quick-picks, best-time optimizer, early/notify/auto-share options, preview). Did
  NOT actually post (public feed; founder constraint). Two observations below.
  ⚠ **Verify the Schedule tier gate on Verion, not here.** Scheduling is a
  Lite/Pro feature, but it opened with **no upgrade gate** on @Vergr — expected,
  because @Vergr is the **admin/founder** account and bypasses tier gates. The
  gate must be checked on a **free, non-admin** account (Verion) to confirm free
  users see the upgrade prompt, not the full planner.
  ⚠ **AdSense throws `Error: no_div` repeatedly on the feed** (three in a row on
  composer open, from `pagead2.googlesyndication.com/.../adsbygoogle.js`).
  `adsbygoogle.push()` is being called with no matching `<ins>` slot in the DOM.
  Benign to app function, but it means **feed ads likely are not rendering at
  all** (a revenue issue, not just console noise) and it violates memory
  `ads_feed_component_only` ("AdSense only via VergrAd"). Worth confirming whether
  any ad ever paints, and fixing the push/slot mismatch.
- **DM composer sweep (2026-08-18) — what WORKS.** Tested the full paperclip
  menu + composer live: **emoji picker** (categorised, search, recents — works);
  **GIF** (KLIPY picker; a GIF sent and rendered/animated in the thread);
  **Location** (clean privacy-first consent sheet: reads only on tap, no
  background tracking, never sold); **Event** (honest "not hosting any events
  yet" empty state + Create CTA); **Wallet / Send coins** (composer opens: quick
  amounts, custom, balance, revenue-share note); **Locked** (paid-media composer,
  see A-note below); **poll DISPLAY** (the sent poll renders with vote options);
  **inline video playback** (plays in-thread with a scrubber — only *enlarge*
  crashes, A41); **message actions** (Reply, Edit, Forward, Select, Translate,
  Copy, Pin, Delete, plus emoji reactions — all present); **Contact** ("Share
  Contact" picker opens); **voice/video note toggle** (round composer button
  switches mic ↔ video note); **1:1** ("Start a 1:1" private-live-stream composer:
  Free/Premium + Go live). **What BROKE:** enlarge video → whole-app crash
  (A41 #1 / A50); create poll → UI hangs on "Creating…" though the poll actually
  sends (A51).
  ⚠ **1:1 depends on the broken ingest (A44):** it starts a private live stream
  over the same `sfu.vergr.app/ingest` path that returns 401 in A44, so "Go live"
  from a 1:1 would produce no video for the same reason. Not launched (broadcast).
  ⚠ **Still NOT exercised** (standard OS file pickers + hold-to-record, lower
  risk; next session): Audio, File, Gallery, Use camera (same media path as the
  video attach — *send* works, *enlarge* crashes via A41), Sticker/Clip *send*
  (only GIF send was verified), and actual voice/video note **recording**
  (press-and-hold).
  ⚠ **Verify, not yet confirmed:** the Send-coins modal defaulted to a 500-coin
  quick amount while the balance was 224, and the button still read "Send 500" —
  check it validates against balance and does not allow/attempt an overdraw.
- **TEXT DM delivery across two accounts — PASS** (two-account live test,
  2026-08-18). A uniquely-marked TEXT message sent from @Vergr through the normal
  composer arrived on Verion's side and rendered correctly (received,
  left-aligned, correct timestamp), and the read receipt propagated back. Text
  1:1 messaging works end to end.
  ⚠ **This does NOT mean "video messaging works."** Sending a video uploads and
  delivers and shows an inline thumbnail, but **tapping it to view fullscreen
  crashes the entire app to a blank screen** (A41 #1 / A50). A media message you
  cannot open is not a working feature. An earlier draft of this document and my
  own verbal report called "video send" a PASS after testing only the upload and
  delivery steps in isolation — that was wrong. **A feature is only "working"
  when the whole user journey works: send → the recipient opens it → enlarges it
  → watches it.** Video fails at "enlarges it," so video messaging is BROKEN, not
  passing.
- **DMs ride the chat relay, not the Firestore `messages` subcollection — this is
  the design, not a bug.** During the delivery test the conversation doc's
  `lastMessage` preview updated to the new message, but the message body was
  **absent from `conversations/{id}/messages`**, which is frozen at 2026-08-10
  (40 docs, all older). The body was nonetheless delivered and rendered in the
  UI. This matches CLAUDE.md's "chat rides the relay (Hetzner + Dexie)" and the
  memory `webrtc`/chat-rewrite notes. **Do not chase a "messages not persisting"
  delivery bug from Firestore reads** — the Firestore subcollection is a stale
  historical store; the live path is the relay. (I nearly filed this as a bug
  before checking the UI; recording it so the next session does not.)
- **A24/A32/A29-write were NOT executed live.** The self-promote-to-president
  write (A24) and the other state-mutating exploit writes are blocked by the
  safety classifier and were not run — nothing was mutated. They remain confirmed
  by inspection of `firestore.rules`, which for a rules bug is conclusive: e.g.
  `allow update: if isAuth() && request.auth.uid == memberId` with no field
  restriction is provably exploitable without executing it.
- **Creator Earnings** (`/creator/earnings`) — correct: 50%, Tier 1 of 7,
  accurate revenue-share copy, honest empty state.
- **Buy screen** — packs, prices, artwork, bonus badges all correct.
- **Shorts** — honest empty state with a working CTA.
- **Squads** — clean, console clear.
- **Notifications drawer** — renders correctly. An early screenshot suggested it
  was clipped; that was the open animation.
- **Avatars** — load correctly. An early screenshot suggested they were broken;
  they were mid-flight.
- **Icon ligatures** — the font works and the CSS is correct; only its size is a
  problem. Do **not** go hunting a `font-feature-settings` or `letter-spacing`
  bug: `letter-spacing: normal`, `font-feature-settings: "liga"`,
  `font-variant-ligatures: normal` were all verified correct in production, and a
  width test confirmed the ligature forms.
- **Account deletion page content** — thorough and well written apart from A7.
- **Console** — clean on every screen visited, except the one broken and fixed
  during the audit.
- **Go Live follower gate** (`GoLiveSetupScreen.jsx`) — done properly. The
  100-follower rule is surfaced as an upfront banner at line 513, both action
  buttons are disabled with a lock icon and a "N followers to go" label, and the
  handlers re-check. The user is never walked through setup only to be refused.
- **Vergr.me draft/publish model** (`useVergrMe.js`) — correct. Only the initial
  `isPublic` is wrong; see A19.
- **Two-factor auth** (`/settings/security`) — real, backed by
  `accountSecurityCallables` (`getMyAccountSecurityStatus`, `disableAccountTotp`).
  Not the admin-only TOTP system.
- **Most of `src/utils/privacy.js`** — `profileVis`, `searchVis`, `receiveMsg`,
  `msgReq`, `tagMe`, `readReceipts`, `onlineStatus`, `suggestedUsers`,
  `hashtagSearch` and `showTrending` are all genuinely enforced. See the list at
  the end of A18 for exactly where, so nobody re-derives it. Only the four in
  A18 are inert.
- **Leaderboard "Most Followed" and "Top Posters"** — the two categories whose
  fields really are written to `users`. Everything else on that screen is A20.
- **Calls and Status hubs** (`/messages/hub/calls`, `/messages/hub/status`) —
  real data, correct empty states, console clear.
- **New Group** (`/messages/create-group`) — clean, and it already writes
  "Vergr" correctly.
- **`/streams`** — honest empty state with a working Go Live CTA.
- **Post detail and comments** (`/post/:id`) — renders correctly: avatars, media,
  link-card thumbnail, action row, honest "No comments yet" state and a working
  composer. Note it took roughly **18 seconds** to fully paint on a warm cache;
  an earlier screenshot at 10s showed missing avatars and a blank link-card
  thumbnail and would have been a false finding. That slowness is A2's story, not
  a separate bug.
- **Ad Center** (`/creator/ads`) — clean identity gate, honest copy, working CTA.
- **Squad overview** (`/squads/:id`) — real data throughout: treasury balance,
  member list with roles and presence, honest empty states for activity, pinned,
  events and challenges. Only its tournament copy is wrong (A35).
- **Find Squads**, **Content library** and **Membership Tiers** — all render real
  data correctly; their defects are logged separately (A12, A34, A28) and are
  narrow.
- **Membership default tiers** — the pre-filled Supporter/VIP/Legend tiers marked
  PUBLISHED are **local display defaults only**. `setTiers(t.length ? t : DEFAULT_TIERS…)`
  never persists, and `handleSave` is a manual button. This is **not** an
  A19-style auto-publish. (It does mean a first Save publishes all of them at
  once, which is worth knowing but is not a bug.)
- **`vanguardPresence`** rules — correctly gated on the writer's actual
  `users/{uid}.vanguard.rank`, so a fake moderator badge cannot be planted on a
  stream. Checked because it looked permissive at a glance.
- **The `/admin` gate holds.** A non-admin account gets "Admin only — You don't
  have access to the VERGR admin dashboard." The screens behind it are unaudited
  (see "Not covered"), but the guard itself works.
- **Group conversations** open correctly: real system messages, member list with
  roles, working composer, console clean. Only the presence flag is wrong (A43).
- **Everything around live streaming except the media itself.** Proven in the
  2026-08-18 two-account test, so do not re-test these while fixing A44/A45:
  `createStreamSession` works and routes to `/broadcast/:id` (the old
  `goLive()` dead end that CLAUDE.md describes as "only `navigate('/')` + toast"
  is **fixed**); admin correctly bypasses the 100-follower gate; the
  notify-followers toggle is respected (it was switched off and no push fired);
  `/streams` discovery listed the stream to a *different* account within seconds;
  the viewer counter correctly registered a second real user on both the viewer
  and broadcaster; the playback URL is built correctly against
  `cdn.vergr.app/streams/<streamKey>/index.m3u8` (the stale Gcore URL is
  **fixed**); and End Stream tears down cleanly with an accurate recap
  (31m 47s, peak viewers 1, 0 tips). The console was clean on both sides
  throughout. **The failure is confined to media transport and playback.**
- **`src/components/brand/SquadInfoRail.jsx` placeholder data is unreachable.**
  It defaults to a fake squad ("Night Raiders", level 24, treasury 12,450) and
  five invented members (Luna_Tc, Thunder42, Raze, GhostRider, Vixen). Its only
  consumer is `src/layouts/SquadsMasterDetail.jsx`, which renders it with no
  props — **but that layout is imported nowhere and is not routed**, so none of
  it ever renders. Dead code, not fabricated live data. Do not spend time on it;
  the real rail is `src/components/squad/SquadInfoRail.jsx`, which every squad
  screen passes real props to.
- **`calls_history`**, **`gifters`**, **`stream_keys`**, **`payout_*`**,
  **`platform_*`**, **`entitlements`**, **`event_tickets`** rules — all correctly
  server-only or participant-gated. The rules file is mostly good; A24, A25, A29,
  A30, A32 and A37 are the exceptions, not the pattern.
- **Cloud Function authorization, swept across all 384 `onCall` exports.** Only
  eight have no reference to `auth` anywhere in the body, and six of those are
  legitimately public reads (`getWhatsNew`, `getActiveCoinPromo`, `checkRegion`)
  or dead tournament wrappers. `unsubscribeAnnouncements` is unauthenticated by
  design and keyed on an unguessable FCM token, which is the standard shape.
  **The one worth a note is `getUserVP` (`functions/index.js:1014`)**: it is
  unauthenticated, takes an arbitrary `uid`, and reads `wallets/{uid}` through
  the Admin SDK, returning that user's VP. `wallets` is otherwise
  `allow read: if isOwner(userId)`, so this is a deliberate hole in the wallet
  read gate exposing one field. VP is already semi-public (levels and ranks show
  on profiles) so the leak is bounded, but add `if (!request.auth) throw` to it
  while nearby. Reproduce the sweep with the node one-liner in the session log,
  or re-derive: for each `exports.X = onCall`, check the body for
  `req/request/context.auth`, `assert*`, `require*`, `guardedAdmin`, `isAdmin`.
  **`kyc.js` `reviewKyc` / `decideKyc` are correctly gated** (`assertAdmin(req.auth)`
  on the first line) — they came up as false positives in a cruder version of
  this sweep, so do not re-flag them.
- **Profile completion claim buttons** — they work. `ProfileCompletionCard`'s six
  quest ids are in `PROFILE_QUEST_REWARDS`, verified server-side and
  server-priced. The card's **percentage** is still wrong (A11), but the Claim
  buttons pay correctly. Do not chase these while fixing A23.
- **Creator quests** (`/creator/quests`) — correct end to end, and the pattern
  A23 should be fixed against.
- **Achievements "Coming soon"** on the profile right rail — an honest stub for
  something never built, which the no-deletion rule explicitly allows. Leave it.

---

## Not covered by this audit

- **Play Billing.** Untestable until three Play Console steps are done: create
  the 8 in-app products with the exact ids in `functions/playBilling.js`
  `PLAY_PRODUCTS`; grant the Firebase service account "View financial data" and
  "Manage orders and subscriptions"; enable the Google Play Android Developer
  API. Until then `redeemPlayPurchase` throws on every purchase.
- A real card payment on the PayRam rail.
- **Anything requiring a second live account.** Every A18 privacy fix needs two
  accounts to verify, as does A29 (call interception) and A24 (squad takeover).
  This audit ran on one account, so those findings are established from the rules
  and the code, not by executing the attack.
- **Sign-up and onboarding.** Claude cannot create accounts or type passwords, so
  the first-run flow was never seen. Given A19 (a public page created by opening
  an editor) and A26 (a modal keyed off an async `profile`), first-run is a
  likely place for more of the same.
- **The mobile viewport.** Attempted and **not achievable through this tooling**:
  `resize_window` reports success but the page keeps `innerWidth: 1536`, so no
  breakpoint ever changed. Everything in this document was observed at desktop
  width. This matters more than usual here, because A9 (poll form behind the
  toolbar) and A33 (paywall CTA off-screen) are both layout bugs found at desktop
  width, and `useResponsive` is JS-driven rather than CSS-driven.
- **Native (APK) parity.** Everything here was found on the web app. Screens with
  a `Native*` twin need re-checking there: A18 touches `NativeProfileScreens.jsx`,
  A35 lists four native squad files, and the settings copy fixes (A16, A17, A22)
  have native mirrors. Batch them into one APK per the standing rule.
- **Squad chat, roles, events, challenges and the squad stream.** The squad
  overview, treasury tile and member list were checked; those sub-screens were
  not.
- **A multi-person group conversation.** The New Group screen and the group list
  were checked; an actual group thread, its invite flow and its permissions were
  not.
- **The support conversation itself**, beyond what A4 and A36 cover.
- **The entire admin surface (`/admin/*`).** Attempted and **blocked**: the
  account this audit ran on is not an admin, and `/admin` correctly renders
  "Admin only — You don't have access to the VERGR admin dashboard." The gate
  works, which is itself worth knowing, but every admin screen behind it is
  unaudited: grants, bans, guest deletion, payout runs, app config, announcements
  and the economy tools. Given A24 and A32, authorization is this codebase's
  weakest area, so this is the largest remaining gap. It needs a session run on
  the founder's admin account.
- **The rest of the public marketing pages.** The footer's link targets were
  checked for existence (only A42 was broken) but the pages themselves were not
  read. `/platform/delete-account` was, because A7 lives there.
- **The composer**, beyond A9.

---

# ▶ RESUME HERE — testing handoff (for the account that ran this audit)

**Read this before touching anything.** This is where live testing paused on
2026-08-18. The point of this section is so you do not re-test what is done, do
not re-derive the setup, and do not repeat the mistakes that cost real time.

## How this audit is run (method — do not deviate)

- **Test whole journeys, not steps.** A feature is "working" only when the entire
  user path works: e.g. send a video → the recipient opens it → **enlarges it** →
  plays it. Calling "upload works" a pass while enlarge crashes the app is the
  exact mistake that got made and corrected here (see A41 #1). Exercise every
  control on a surface, not the one you were pointed at.
- **Verify live, not from the bundle.** A passing `npm run build` is not evidence.
  Load the real page, read the console, act like a user.
- **Wait 8–10s before judging a screen.** This app renders in stages (icons as
  words, then blank avatars, then complete). Several "findings" were mid-render
  states. Post detail took ~18s to fully paint.
- **Do not overclaim.** State exactly what was proven. "Enumerated an ended call"
  is not "confirmed call interception." "Upload delivered" is not "video works."
  Separate CONFIRMED (executed live) from PLAUSIBLE-FROM-CODE.
- **Never patch the doc or code with a shell heredoc containing JS/JSX** — bash
  ate template literals and a `const` declaration earlier and white-screened
  `/messages` in production. Use the Edit tool.

## Browser / account setup (two-account tests)

- Two real Chrome profiles are connected via the Claude-in-Chrome extension:
  - `a1df4d94-...` = **Verion** (`damien.w.ashton@gmail.com`) — free, non-admin.
  - `7377de5e-...` = **@Vergr** (`vergenerd@gmail.com`) — **admin/founder**,
    bypasses tier gates (so tier-gate tests must run on Verion).
  - deviceIds are stable; the harness FORCES an AskUserQuestion browser-picker on
    every `select_browser`/`list_connected_browsers` — minimise switches by doing
    all of one account's work before switching.
- Camera + mic are granted in the @Vergr Chrome profile (site permissions), so
  calls/broadcast work there. Native OS permission dialogs cannot be clicked by
  the tool; if a getUserMedia prompt is pending, the user must click Allow.
- Read a page's live Firebase session with:
  `indexedDB.open('firebaseLocalStorageDb')` → object store `firebaseLocalStorage`
  → `value.uid` and `value.stsTokenManager.accessToken`. Use the token against the
  Firestore REST API (`.../databases/vgrdb/documents...`) to prove data-layer facts.
- The DM used for tests is `0yOUbBWmtoYNUHiTHBFjTQLdC8n1_dosQsFnGRkTaBeognKvpRHdWg513`
  (Vergr↔Verion). Test junk left in it: a `share.mp4`, a GIF, a poll, an "AUDIT-…"
  text. Delete if unwanted.

## What is DONE (do not re-test)

Everything in the numbered findings A1–A52 and both the "What is NOT broken" and
"Not covered by this audit" lists above. In particular, already swept live:
the DM composer (full paperclip menu, message actions, emoji/GIF, video
send+enlarge, poll), 1:1 video calling, the post composer (incl. poll preview +
schedule), and the squad chat composer + members rail.

## TESTING QUEUE — pick up here (roughly highest value first)

0. **⚠ FIRST: live-test A23 (quest claims).** Fixed and deployed 2026-08-19 but
   NEVER exercised by a real user. Five short tests, any signed-in account, no
   second account needed — the full procedure with expected results is in the
   A23 section, under "**A23 IS FIXED AND DEPLOYED, BUT NOT YET TESTED LIVE**".
   The one that matters most: calling the callable with a made-up `questId` must
   throw `invalid-argument`. If it pays, that is a critical regression.

   The other five security fixes (A24, A25, A29, A32, A37) are already PROVEN
   by `tests/rules/` — 46 emulator assertions, all passing. Re-run with
   `cd tests/rules && npm install && npm test`. **Run it before and after any
   change to `firestore.rules`**, including A30 and A19, which both touch it.

1. **Admin surface `/admin/*`** — the single largest gap. Needs the @Vergr
   (admin) browser. Sweep: Dashboard, Users (ban / delete guest / grant), Economy
   (payout run preview, grants), Moderation queue, App Config, Subscriptions,
   Announcements, Live Stats, Audit Log, Admin Security, Admin Access. Watch for
   the A24/A32-class authorization gaps and any hang/blank.
2. **Squad sub-screens (create flows):** Events, Challenges, Announcements,
   Media, Treasury (View Treasury → contribute — money, do not actually send),
   Roles, Settings, the squad stream. (Squad chat composer + members rail already
   done; A52 open.)
3. **Second-account write exploits** — A24 (self-promote to president), A32 (forge
   ledger row), A29 (write/hijack a live call). These need two accounts AND are
   mutating writes; the safety classifier blocked the raw-REST versions. Only do
   them with explicit founder go-ahead, reversibly (record/restore), or leave as
   confirmed-by-rules.
4. **Mobile viewport** — could NOT be tested: `resize_window` reports success but
   the page keeps `innerWidth: 1536`. A9 (poll behind toolbar) and A33 (paywall
   CTA off-screen) are desktop-width layout bugs; the phone likely has more.
5. **Remaining DM attach items** (standard pickers, lower risk): Audio, File,
   Gallery, Use camera, Sticker/Clip *send* (only GIF send verified), actual
   voice/video-note **recording** (press-and-hold).
6. **Shorts feed** (open/scroll/interact), **Explore** interactions beyond A10,
   **profile edit** (`/edit-profile`), **Vergr.me public page** rendering (A13/A14),
   **the composer** beyond A9, **a real multi-person group thread**.
7. **Verify-not-confirmed items:** Send-coins overdraw block (default 500 vs 224
   balance); Schedule tier gate on Verion (non-admin); whether any AdSense feed ad
   ever paints (the `no_div` errors suggest none).
8. **Blocked / needs the founder:** Play Billing (3 Play Console steps, listed in
   "Not covered"); a real card payment on PayRam; Safe Browsing recheck; a real
   phone for native-parity + native upload-progress (A49).


---

# Session addendum, 2026-08-21 (second account)

Findings A57 to A62, all NEW and none of them in the original 2026-08-18 sweep.

**Deployment note that applies to A57 to A61:** all five are web changes, and a
`npm run build && firebase deploy --only hosting` ran at the end of the session
with every one of them already in the working tree. A hosting deploy ships the
whole `dist/`, not a file at a time, so all five are live on vergr.app.
**Nothing is committed.** Last commit is `ed9291a`, which predates all of it.

---

## ✅ A57. Support threads could be voice- and video-called, ringing agents' personal accounts

**Files:** `src/screens/messages/ChatThreadScreen.jsx`, `functions/supportChannel.js:175-180`

Reported by the founder: "why does support allow me to randomly call it and even
video call wtf?"

The call buttons were gated only on `!chatInfo?.isSaved`, which hid them on Saved
Messages and **nothing else**, so every group-shaped conversation got them by
default, support threads included.

That matters because `startCall` copies `chatInfo.participants` onto the `calls`
doc, and a support thread's participants are `[user, ...support agents]`
(`supportChannel.js` sets `isGroup: true`, `supportThread: true`).
`IncomingCallManager` listens for `calls` where `participants array-contains uid`
and `status == 'ringing'`. So tapping the video icon in a support ticket **rang
every support agent's personal account**, unsolicited, from any user, at any hour.
An abuse vector, not just a UI slip.

**Fixed.** Gated `!isSaved && !supportThread && !isOfficial` at
`ChatThreadScreen.jsx:3041`, plus a second guard inside `startCall` at
`ChatThreadScreen.jsx:2173` so no other entry point or stale render can start one.
`NativeChatThreadScreen.jsx` is `export { default } from '../ChatThreadScreen'`,
so the APK inherits it.

⚠ **RESIDUAL, deliberately left open.** The UI path is closed, but a hand-crafted
Firestore write still passes rules, because in your own support thread you
genuinely *are* a participant. Closing it needs a `get()` on the conversation doc
inside the `calls` create rule, i.e. a read on every call creation platform-wide.
**Founder decision, not taken.**

---

## ✅ A58. Support and community channel avatars never rendered

**Files:** `src/utils/chatIdentity.js:191`, `src/hooks/useMergedNotifications.js:117`

Founder reported the Vergr Support avatar missing and was certain he had uploaded
one. He was right. Checked Firestore and the CDN directly: both fine. The image
was never the problem.

**Two field names exist for one thing, and the resolver knew only one:**

- `groupIcon` is written by `GroupInfoScreen` when a **user** sets a group picture.
  This is what the code read.
- `groupAvatar` is written by the **server** when it creates a group-shaped
  conversation: `supportChannel.js:184` (the support thread) and
  `officialChannels.js:641` (a community channel room).

So **every server-created conversation** fell through to UserAvatar's grey person
placeholder. It looked like a broken upload precisely because `groupName` resolved
correctly, so the name was right and only the picture was missing.

**Fixed** by reading both (`conv.groupIcon || conv.groupAvatar`) rather than
renaming either, since both have live writers and readers and a rename needs a
data migration.

---

## ✅ A59. Mobile nav showed unlabelled dots instead of counts, and two counts were wrong

**Files:** `src/components/BottomNav.jsx`, `src/components/DesktopSidebar.jsx`,
`src/components/messages/MessagesMenuDrawer.jsx`,
`src/screens/messages/MessagesInboxScreen.jsx`,
`src/screens/messages/native/NativeMessageScreens.jsx`,
`src/screens/calls/CallsScreen.jsx`

Founder: "as a user i don't know what a fucking dot is, and the users won't know
what to go look for to get rid of it because there is no indication of what it's
for."

Mobile rendered a cluster of colour-coded dots (chat / squad / calls / requests)
with no legend and no count, while desktop showed a number. Two real bugs sat
underneath the cosmetic one:

1. The **Community row's bell count included `unreadNotifCount`**, so it reported
   a number the user could not clear from that row.
2. **`CallsScreen` queried `collection(db, 'calls')` directly** instead of
   `getCallHistory(uid, 20)`, so the missed-call figure did not match the screen
   it sent you to.

**Fixed.** One number everywhere: `unreadChatCount + squadUnreadCount +
missedCallCount + requestCount`. Dot cluster, `DOT_COLORS`, `BADGE_ORDER` and the
per-colour `Dot` component all removed. The Messages hamburger carries an
indicator (`menuBadgeCount`) and the drawer shows a per-row `Count`, so the
indicator on the opener tells you to look inside and the row tells you where.

---

## ✅ A60. The squads hub had no mobile layout at all

**File:** `src/screens/messages/hub/SquadsHub.jsx`

`squad.css` hides `.rail-l` below 1100px, and `SquadsHub` rendered the desktop
three-column shell unconditionally, so on a phone the layout collapsed into
overlapping columns.

**Fixed** with the same pattern the rest of the app uses: `useResponsive()`, then
`if (!isDesktop) return <TopBar/>{listCol}`.

---

## ✅ A61. No back navigation on ANY squad screen on mobile web

**Files:** `src/components/squad/SquadShell.jsx`, `src/styles/squad.css`

Founder: "there is also no back arrow as there should be. and the button is
oversized and isn't even needed there since there is one in the hero."

The only navigation affordance on mobile was a floating hamburger FAB gated behind
`IS_NATIVE_BUILD`, so **mobile web had no way back out of a squad at all**, and
where the FAB did render it was oversized and duplicated the hero action.

**Fixed.** Replaced with a `.sqd-mtop` sticky top bar (back arrow, squad name,
menu) inside the `max-width:1100px` media query, plus origin-aware back on the
sheet. Mobile design pass on the same screens while in there: stacked hero row,
22px wordmark, scrim via `.hero::before`, full-width actions, and `.qa` tiles
rebuilt with gradient plus inset highlight plus shadow instead of a 1px border
(per the no-border-soup rule). Cyan swapped to violet per the brand rule.

⚠ **Not done:** the lower cards (Recent Activity, pinned, events) still use the
old bordered-card treatment and have not been brought onto the surface system.

---

## 🟡 A62. Play Console "5 actions recommended" on the 1.0.201 bundle — SOURCE ONLY

**Native Android. Full reasoning in CLAUDE.md under "PLAY CONSOLE '5 actions
recommended' ON 1.0.201, TRIAGED".**

| Advisory | Verdict |
|---|---|
| Edge-to-edge may not display | No action. Already correct (`MainActivity.kt:103`, `viewport-fit=cover`, `env(safe-area-inset-*)`). |
| Deprecated edge-to-edge APIs | No action possible. All six call sites are library code; checked androidx.activity through 1.13.0. |
| Resizability / orientation | **Fixed.** Opt-out property + `configChanges` on `ScannerActivity` and `ArCameraActivity`. Dies at targetSdk 37. |
| Bitmap image optimization | **Fixed.** `decodeStream` with no Options was a 48MB allocation in a background FCM service. Two-pass bounded decode added. |
| R8 optimization | **Half.** `isShrinkResources = true`. AGP 9.0 declined (Kotlin 1.9.25 pin is load-bearing). |

Compile-verified: `./gradlew :app:compileUniversalReleaseKotlin`, clean.

🔴 **NOT IN ANY BUILD.** 1.0.201 is already uploaded to Play, so shipping needs a
bump to **1.0.202** (`tauri.conf.json`, `appVersion.js` APP_VERSION +
APP_VERSION_CODE) and a new AAB.

⚠⚠ **AND THE BIGGER PROBLEM:** these edits live in `src-tauri/gen/android/`, which
`.gitignore:12` ignores. **The entire native Android app is untracked in git**: 43
hand-written Kotlin files, the manifest, and `build.gradle.kts`. Verified per file
with `git ls-files --error-unmatch`. This violates the existing hard rule in
CLAUDE.md and is the same failure class that caused the 1.0.193 web-mode APK
disaster. It is NOT safely regenerable; `tauri android init` would overwrite every
custom file. **Founder decision needed on un-ignoring it.** See `docs/UPDATE_LOG.md`.

---

# Session 2026-08-21 (evening): DM surface re-test, live on vergr.app

Driven in real Chrome on the **@Vergr** account (`vergenerd@gmail.com`, admin), in
the Vergr / Verion DM. Everything below was executed against the live site, not
read out of the bundle. Where a claim is code-only it says so.

WARNING, tool note for whoever picks this up: do NOT use the browser `zoom` action
on this setup. One call timed out mid-flight and left a CDP device-metrics override
behind, collapsing the viewport to 170x255 while `outerWidth` still read 1536.
Everything rendered as a phone and screenshots came back 213x319. `resize_window`
clears it. Use screenshots plus DOM reads instead.

⚠ **`resize_window` does NOT work. The mobile layout is only reachable if the
founder resizes the Chrome window by hand.**

Settled, after I got this wrong twice in one session:

- `resize_window(414, 896)` returns "Successfully resized" and `innerWidth` stays
  **1536**. The call is a no-op.
- Mid-session the viewport became 500x714 and the mobile bottom nav appeared. **The
  founder had dragged the window narrower.** It was not the tool.
- I first wrote here that `resize_window` worked, then wrote a second "correction"
  claiming it works but needs a navigation and that Chrome clamps at 500px. **Both
  were wrong, and the second one was invented to explain a change I had not
  caused.** Recorded here because a fabricated mechanism in an audit doc is worse
  than an admitted gap.

**So: to test mobile, ask the founder to narrow the Chrome window, then verify
`innerWidth` before trusting a single screenshot.**

Unrelated and separately true: do not use the `zoom` action. A timed-out `zoom` left
a CDP device-metrics override of 170x255 behind, which collapsed the viewport while
`outerWidth` still read 1536 and made screenshots come back 213x319.

## A63. Sending media does not scroll the thread to it, so the sender sees nothing happen

**File:** `src/screens/messages/ChatThreadScreen.jsx`, the relay branch of
`handleMediaSend` (the optimistic insert at ~:1942 and the cleanup at ~:1998).

This is the founder's original complaint ("there should be an upload indication or
sending indication ... the user is in the dark waiting to find out if it worked"),
and the cause is not the one that was assumed.

**Measured, with the scroll container instrumented at 150ms:**

| Action | scrollHeight | scrollTop | distance from bottom |
|---|---|---|---|
| before send (pinned to newest) | 5154 | 4552 | **0** |
| image bubble inserted | 5410 | 4552 | **255** |
| 10s later | 5410 | 4552 | **255** |

The list never comes back. The message you just sent is entirely below the fold,
and it stays there until you scroll by hand.

**A text message in the same thread behaves correctly**, which is what isolates
it: scrollHeight grew by 40, and scrollTop moved 4808 to 4844 within about three
seconds, returning the distance to 0. So the auto-scroll exists and works, and the
media path simply does not trigger it.

**This is also why A49 looked like "no upload progress".** `SendProgress`
(`ChatThreadScreen.jsx:512`) is a genuinely good component: a 40px ring whose dash
offset is the percentage, a spinning partial arc while the percentage is still
unknown, and a `1.2 MB / 5.4 MB` byte readout, with separate `Compressing` and
`Trimming` wording so it never shows a misleading MB figure against the source file
during a re-encode. It is rendered for images (`:2748`) and for videos and clips
(`:2753-2754`), and the live relay path feeds it real byte progress through `onUp`
(`:1960-1966`). **All of that machinery draws on a bubble that is off the bottom of
the screen.**

**Fix.** After the optimistic insert, scroll to the new bubble the same way the
text path does. The condition should be "was the user pinned to the bottom", not
"always", so it never yanks someone who has scrolled up to read history.

**Verify.** Scroll to the newest message, send a photo, and do not touch the
scrollbar. The new bubble and its progress ring must be visible without scrolling.
Then scroll up 500px into the history, send another, and confirm you are NOT
dragged to the bottom.

---

## A64. Video messages render as a black box reading 0:00 / 0:00 until you play them

**File:** `src/screens/messages/ChatThreadScreen.jsx:296-311` (the video bubble
player), plus the missing `posterUrl` writer.

Send a video in a DM and your own message appears as an **empty black rectangle at
300x150**, the browser's default intrinsic `<video>` box, showing `0:00 / 0:00`. It
is the wrong shape for the video and shows no frame from it. The two-day-old video
already in the thread was in the same state. Click play once and it immediately
becomes correct: right aspect ratio, real frame, `0:00 / 0:33`.

**Measured on the freshly sent bubble:** `readyState 0`, `duration NaN`,
`videoWidth 0`, `poster` empty, element rect 300x150.

**It is not the file and not the CDN.** The uploaded object returns HTTP 200,
`content-type: video/mp4`, 1,716,642 bytes, and the source MP4 is already faststart
(`ftyp` at 0, **`moov` at 32**, `mdat` at 37582), so this is not the moov-at-the-end
trap. Proof: a detached `<video preload="metadata">` created in the console with the
**same URL** reached `loadedmetadata` in well under eight seconds and reported
`33.1s, 1280x644`.

**So the bubble never gets metadata because of the page, not the media.** The
component depends entirely on `onLoadedMetadata` firing: `onMeta` is what sets the
duration and what nudges `currentTime = 0.01` to force a first frame, and its own
comment says so ("Paint a real first frame: preload=metadata in the Android WebView
leaves the surface black until the first decode, so nudge it"). No metadata event
means no duration, no frame, no aspect ratio.

⚠ **CORRECTION, same session: my first stated cause was wrong and is retracted.** I
wrote that the thread's **nine** `<video preload="metadata">` elements were starving
each other. Then I opened the same thread on the **recipient's** account and
measured: **all nine elements had `readyState: 4` and a real `videoWidth`**,
including the very same file. So nine concurrent elements is not the cause.

**What the evidence actually supports:** on the sender's side the bubble was **below
the fold**, because the thread never scrolled to it (that is A63). Chrome
deprioritises media that is not in the viewport, and the element resolved the moment
I scrolled to it and pressed play. That is a correlation, not a proven mechanism, so
**treat the cause as open** and reproduce it before fixing: send a video, do NOT
scroll, and watch `readyState` on the new bubble.

**What is proven regardless of cause, and is what needs fixing:** no chat video ever
gets a `posterUrl`, so when metadata is slow or deferred there is nothing to draw
and the bubble is a black 300x150 box at the wrong aspect ratio. A stored poster
removes the dependency on metadata timing entirely.

**One more thing found on the recipient's side:** 7 of the 9 videos report
`duration: Infinity`, which is the usual MediaRecorder-WebM container problem. The
app already works around it with a `#d=` fragment hint on the URL (e.g.
`...4a9942b60fbe.webm#d=8.3`), matching the comment in the player about taking
duration "from the `#d=` hint (new recordings) or from finite metadata". **Two of
them carry no hint** (`...92299991_d56e5c8ed49f.webm`,
`...91362117_a9cc0b533db2.webm`) and so can never show a duration. Those are
presumably recordings from before the hint was added; worth confirming that is the
explanation rather than a path that still writes hint-less URLs.

**There is no poster to fall back on.** `poster={poster}` is passed, but
**`posterUrl` is written nowhere in `src/` except `demo/fixtures.js:188`.** No send
path ever produces one, so the field the UI reads (`m.posterUrl || m.thumbnailUrl`,
`:2754` and `:2900`) is always empty for a real chat video.

**Fix, in the order that actually helps:**
1. Capture a frame at send time and store it as `posterUrl` alongside the upload.
   That fixes the sender, the recipient, the lightbox and the reply preview at once,
   and it is the only fix that survives a slow connection.
2. Independently, only let the visible bubbles preload. An IntersectionObserver that
   flips `preload` from `none` to `metadata` when a bubble scrolls into view stops a
   long thread from starving every element.

**Verify.** In a thread with several videos, send one and do not click it. It must
show a real frame and the true duration within a couple of seconds. Reload with the
thread scrolled to the top and confirm the videos further down also resolve as they
come into view.

---

## A51 retest: did not reproduce, and the code has not changed

Created a DM poll ("A51 retest 2026-08-21", options Works / Hangs). The sheet closed
and the poll was delivered **in under two seconds**. Voting works too: one tap moved
it to `1 vote`, `Works 100% / Hangs 0%` with the option checked.

**But nothing has been fixed.** Read both files afterwards:

- `src/firebase/firestore.js:3390-3403` `createChatPoll` is still a bare
  `await addDoc(...)` with no timeout.
- `src/components/messages/CreatePollSheet.jsx:20-29` `create()` still awaits
  `onCreate` with no timeout, and `:86` still renders
  `{busy ? 'Creating…' : 'Send poll'}`. If the promise never settles, `busy` stays
  true forever.

So A51 is **intermittent**, exactly as a stalled Firestore write channel would be,
and it should be re-worded from "hangs forever" (which reads as "always") to "hangs
whenever the write channel stalls, with no timeout and no error". One clean run is
not a fix. The escape hatch is that the X and the backdrop are not disabled while
busy, so the user can close the sheet, but they are then left not knowing whether
the poll sent.

**The 2026-08-19 poll is still sitting in the thread**, which is the corroboration:
that write did reach the server, exactly as the original finding said.

---

## A58 CONFIRMED LIVE (closing the "code-verified only" flag from the handover)

Both official-channel avatars load and are actually painted, not merely present:

| Row | src | naturalWidth | rendered | opacity |
|---|---|---|---|---|
| Vergr Support | `cdn.vergr.app/announcement/...312548_0f0aa4800b19` | 384 | 34x34 | 1 |
| Vergr Offers | `cdn.vergr.app/announcement/...594536_99c733bed4f1` | 384 | 34x34 | 1 |

`complete: true` on both, `visibility: visible`, `display: block`. The `groupIcon`
vs `groupAvatar` fix works. **A58 can be closed.**

---

## A65. The composer's video preview is a bare spinner for several seconds

**File:** the media preview screen reached from the DM attach menu.

Attaching a 1.6 MB, 33 second MP4 showed **only an unlabelled spinner** for
somewhere between five and twelve seconds (readyState was still 0 at the five second
mark and had reached 4 by the next check). Then it resolved into a good screen: the
frame, a filmstrip trim bar with real thumbnails, an `Original 1.6 MB` quality
selector, a Sound toggle, a caption field, and "Hold Send to schedule for later".

The end state is fine. The problem is the several seconds of nothing, on a small
file, on a desktop. A 100 MB clip from a phone camera will sit there far longer, and
there is no text saying what is happening or that it is nearly done. Give it a label
("Preparing preview...") and, once metadata is in, a thumbnail-generation progress
hint.

---

## Also checked while in the DM, no defect found

- **Poll voting** end to end: tap, tally, percentages, checkmark. Correct.
- **Image send:** preview opens instantly with a working rotate control; upload and
  delivery fine (subject to A63, the bubble lands off-screen).
- **Text send:** delivers and **auto-scrolls correctly**, which is the control case
  that proves A63 is media-specific.
- **Locked media sheet** (attach menu, "Locked"): copy is correct and current, "The
  full price is revenue Vergr earns, and Vergr pays you a share of it: 50% to start,
  rising to 80% as your lifetime earnings grow." Not sent, it costs coins.
- **Attach menu inventory:** Use camera, Gallery, Wallet, File, Poll, Audio,
  Location, Contact, Event, Locked, 1:1. All present.

## Not reachable from this account

**A33 needs the free (Verion) account.** On @Vergr, `/creator/audience` renders in
full with no paywall, which is expected: admin outranks the tier gate. Confirmed
from source in the meantime, so the finding stands exactly as written:
`src/components/creator/PlanLock.jsx:20` still reads
`const PRICE = { lite: '$9.99/mo', pro: '$24.99/mo' }` against `tierSystem.js:43,69`
`priceLabel: '$4.99/mo'` and `'$9.99/mo'`, and `CreatorLayout.jsx:25` still has no
`lock: 'lite'` on the Audience nav row while `:21` and `:24` have it on Analytics
and Schedule. `PlanLock.jsx:20` is the only wrong plan price in `src/`; every help
article already says $4.99 / $9.99.

Worth adding to A33 when it is fixed: the mobile "More" sheet
(`CreatorLayout.jsx:312-323`) renders NAV entries with **no lock badge at all**, so
on a phone none of the three locked screens warn you before the wall.

## Test litter left in the Vergr / Verion DM

Delete if unwanted: a poll "A51 retest 2026-08-21" (voted Works), a `share.mp4`
video, a `share-poster.jpg` image, and a text "AUDIT scroll test text". All sent
2026-08-21 around 20:49 to 21:00.

---

# Session 2026-08-21 (evening), part 2: groups and squads

Same account and browser as part 1.

## A43 CONFIRMED LIVE, and the root cause is one hardcoded word

**File:** `src/layouts/MessagesMasterDetail.jsx:31`

```js
return { id: uid, name, avatar, role, online: false };
```

`buildMembers()` hands every group member `online: false` as a literal. That single
constant produces the whole symptom:

- `ChatMembersRail.jsx:24` `const online = list.filter(m => m.online).length` is
  therefore always 0, so the header always reads **"0 online"**.
- `:87` always paints the grey dot, never the green one.
- `:91` always falls through to **"Offline"**.

Observed in the "Vergr Update Logs" group: **Vergr (the account I was signed in
and typing on), Friz1k3 and Verion all read "Offline", header "0 online".** Your
own account cannot be offline.

**The contradiction that makes it obvious:** at the same moment, in the same app,
the DM header showed Verion **"ACTIVE NOW"** with a green dot and the contact panel
said **online**, and the squad rail said **"2 ONLINE"** with green dots on both
members. Three surfaces, one user, two different answers.

**The fix is already written elsewhere in the codebase.** `usePresenceMap(userIds)`
exists at `src/hooks/usePresenceMap.js:19` and is used correctly by
`src/components/squad/SquadInfoRail.jsx:31` (which even honours each member's
`privacy.onlineStatus` opt-out through `presenceVisible`) and by
`ChatSettingsScreen.jsx:59,396`. `MessagesMasterDetail` needs the same call over
`convo.participants` and `online: !!presMap[uid]`.

I checked the avatars in the same rail before filing anything about them: all three
load (naturalWidth 1024 / 512 / 512). **No avatar bug. Only presence.**

### Related, worth a separate look: an abandoned presence design is sitting in `src/`

`src/screens/messages/presence.ts` is a **Cloud Function** (`onValueUpdated`
on `/status/{uid}`, importing `firebase-functions/v2/database` and `firebase-admin`)
living in the client source tree. It writes `users/{uid}.status` and
`conversations/*/metadata.{uid}.status`, which is exactly the data a group rail
would want.

- **Nothing imports it** (grepped `src/` and `functions/`).
- **It is not exported from `functions/index.js`**, so it is not deployed.

So it is dead code, and it is dead code in the wrong directory: if anything ever
imports it, `firebase-admin` lands in the client bundle. Either move it into
`functions/` and deploy it, or delete it. Do not leave a server file in `src/`.

---

## A66. The squad Announcements composer is white text on a white box (NEW)

**Files:** `src/screens/squads/SquadAnnouncementsScreen.jsx:127`,
`src/screens/squads/native/NativeSquadAnnouncementsScreen.jsx:85`,
`src/styles/squad.css:550-557`

**You cannot see what you type.** Measured on the live page:

| Element | background | color | class |
|---|---|---|---|
| `<input>` "Announcement title…" | `rgb(255,255,255)` | `rgb(255,255,255)` | `title` |
| `<textarea>` "Write to the squad…" | `rgb(255,255,255)` | `rgb(255,255,255)` | none |

Typed `VISIBILITY TEST` into the title. The placeholder disappeared and the box went
**blank white**; reading the element back confirmed `value: "VISIBILITY TEST"` with
`color: rgb(255,255,255)` on `background: rgb(255,255,255)`. (Field cleared
afterwards, nothing was posted.)

They are also unstyled in every other respect: browser-default 1px `rgb(229,231,235)`
borders on a dark UI, 154px and 159px wide, sitting side by side and overlapping
instead of stacked full width.

**Root cause, and it is one word.** `squad.css` styles these under **`.composer-box`**:

```css
.sqd .composer-box input.title{ ... color:#fff; ... }
.sqd .composer-box textarea{ ... color:var(--t1); ... }
```

Both announcement screens render **`<div className="composer">`**, not
`composer-box`. `.sqd .composer` exists at `squad.css:385` but only sets padding and
background, so the input and textarea get no rules at all and fall back to browser
defaults, inheriting a white `color` from the page.

**`.composer-box` appears in NO component in `src/`** (grepped): the only three uses
of either class are `SquadChatThreadScreen.jsx:1293`, `SquadAnnouncementsScreen.jsx:127`
and `NativeSquadAnnouncementsScreen.jsx:85`, all of them `composer`. So
`squad.css:550-557` is dead CSS written for a class name nothing uses.

**Fix.** Either rename the wrapper to `composer-box` in both announcement screens,
or widen the selectors to `.sqd .composer-box, .sqd .composer`. Check the squad chat
composer either way, since it shares `.composer`.

**Verify.** Open a squad, go to Announcements, type a title and a body. Both must be
readable, full width, stacked, and themed like the rest of the app.

**While you are in that file:** the body placeholder contains an em dash ("Write to
the squad — practice schedule…") in both the web and native copies, which the house
rule bans in user-facing text.

---

## A67. "View Treasury" is a dead link on every squad screen (NEW)

**File:** `src/components/squad/SquadInfoRail.jsx:128` (and the sibling
`src/components/brand/SquadInfoRail.jsx:102` via its `onOpenTreasury` prop)

```js
onClick={() => navigate(`/squads/${squadId}/treasury`)}
```

**There is no `/squads/:squadId/treasury` route.** `AppRouter.jsx:1225-1247` mounts
twenty squad routes and treasury is not among them, and there is no treasury screen
file in `src/screens/squads/` at all. The only treasury route in the app is
`/vanguard/treasury`, which is a different, admin-only thing.

Clicking it produced the 404 page, path `/squads/wc1atfQOAY2NKFU050Qb/treasury`.

This matters more than a normal dead link: **the rail is persistent, so the button is
on every single squad screen**, and it is the one control that claims to show the
squad's money. The squad under test holds 50 coins.

**Fix.** Per the no-deletion rule this is build-or-stub, not remove. The data is
already loaded (the rail renders the balance and VP right above the button), so the
cheapest honest version is a screen listing treasury inflows and outflows.
`getSquadTreasuryInflows()` already exists in `firestore.js`.

**Verify.** Click View Treasury from any squad screen. It must land on a real screen,
not the 404.

---

## Squad sweep, everything else checked and clean

| Screen | Result |
|---|---|
| Overview | Correct. Rail shows "MEMBERS — 2 / 2 ONLINE" with green dots, treasury 50 coins, quick actions all present. |
| Chat | Correct. Header "2 / 2 online", pinned message, markdown toolbar, the 2026-08-19 squad poll renders with a working Cast Vote. |
| Members | Correct. LEADER / MEMBERS grouping, roles, levels, contribution bars, per-member moderation icons, presence dots green. |
| Events | Correct, and the copy is clean: "Scrims, watch parties, and squad nights". **No tournament wording anywhere** (A35 / A54 confirmed live). |
| Challenges | Correct. Honest empty state with a working CTA. |
| Leaderboard | Correct. Podium, "RANKED #1 OF 2", full table with role, contributed, level and share. |
| Media | Correct. Honest empty state. |

**A21 also confirmed live in passing:** the treasury 404 rendered the proper "Page
not found" screen with the attempted path and Go home / Search buttons.

---

## A52 retest: did not reproduce, but the defect is still in the code

The squad chat rail showed "MEMBERS — 2", "2 ONLINE" and both members listed. No
contradiction today.

**Nothing was fixed, though.** Both halves of the finding are still there:

- `src/screens/squads/SquadChatThreadScreen.jsx:412`
  `getSquadMembers(squadId).then((m) => { if (alive) setMembers(m); }).catch(() => {});`
  still swallows the error whole.
- `src/components/squad/SquadInfoRail.jsx:34`
  `const memberCount = squad?.memberCount ?? members.length;` still takes the count
  from the squad DOC while `:108` renders "No members yet." off `members.length`.

So a failed fetch still produces "Members — 2" and "No members yet." at the same
time, with nothing logged. Same shape as A51: intermittent, and invisible when it
happens. Fix the swallow first, it is what makes the other half undiagnosable.

---

## Method note, worth keeping

**Grep output in this repo escapes forward slashes, so it can invent bugs.** Twice
today a grep hit looked like a real defect and was not:

- `useMatch('\messages:chatId')` in `MessagesMasterDetail.jsx` reads
  `useMatch('/messages/:chatId')` in the file. Fine.
- `<span ...>send<\span>` in `NativeSquadAnnouncementsScreen.jsx:97` reads
  `</span>` in the file. Fine.

**Read the file before filing anything that looks like a broken path, tag or regex.**

---

# Session 2026-08-21 (evening), part 3: Go Live, What's New, admin

## A46 CONFIRMED, and it is bigger than "Go Live still shows Gems"

**File:** `src/screens/streams/GoLiveSetupScreen.jsx:1316-1320`

The "Earnings · Today" panel on `/go-live` renders three columns, **Coins / VP /
Gems**, and Gems has been a deleted currency since 2026-08-16. That much was the
original finding. The part nobody checked is the other two columns:

```jsx
<Stat label="Coins" value={(profile?.todayCoinsEarned ?? 0).toLocaleString()} .../>
<Stat label="VP"    value={(profile?.todayVPEarned    ?? 0).toLocaleString()} .../>
<Stat label="Gems"  value={(profile?.todayGemsEarned  ?? 0).toLocaleString()} .../>
```

Grepped all three field names across `src/` and `functions/`:

| Field | Occurrences in the whole repo |
|---|---|
| `todayCoinsEarned` | 1, this read site |
| `todayVPEarned` | 1, this read site |
| `todayGemsEarned` | 1, this read site |

**Nothing writes any of them.** The panel is structurally incapable of ever showing
anything but `0 / 0 / 0`, and one of its three columns is a currency that no longer
exists. Same class as A20, where five of seven leaderboard categories could never
have data.

**Fix.** Delete the Gems column outright (the currency is gone, there is nothing to
migrate). Then either write the two remaining counters somewhere real, or replace
the panel with a figure that IS live, for example this stream's tip total, which the
stream doc already carries. Do not leave three permanent zeros on the screen a
creator opens right before going live.

**Verify.** Earn a coin or a VP today, reload `/go-live`, and confirm the number
moves. If it cannot move, the panel should not be there.

The other half of A46, the viewer claiming 1080p60 over a 480p stream, still needs a
live broadcast to check and was not tested.

---

## A6 CONFIRMED: What's New works, is empty, and nothing links to it

`/whats-new` and `/whats-new/:slug` are routed (`AppRouter.jsx:798-799`) and the
screen renders correctly, with a canonical URL and its own document title. After
about fifteen seconds of "Loading…" it settles on an honest empty state: **"Nothing
here yet. Updates will appear as they ship."** No console errors.

**No link to it exists anywhere in the app.** Grepped `/whats-new` across `src/`:
every hit is either inside `WhatsNewScreen.jsx` itself (its own back link and
per-entry links) or `AdminCampaignsTab.jsx` describing the URL in help text. No
footer entry, no settings row, no nav item.

So it is a public, SEO-canonical marketing surface with **zero entries and zero
inbound links**. Two things to decide, and they are separate: give it an entry point
(the marketing footer is the natural home), and publish something to it, because
linking to an empty page is worse than not linking at all.

---

## A68. Admin reports USD revenue in euros, and the admin area disagrees with itself (NEW)

**Files:** `src/screens/admin/_adminGuarded.jsx:14`,
`src/screens/admin/AdminDashboardScreen.jsx:78,317,331,333,343,344,357`,
`src/screens/admin/AdminSubscriptionsScreen.jsx` (11 call sites),
`functions/adminDashboard.js:13,73,113`

Live on `/admin`: **MRR reads `€9.99`**, Revenue Overview reads `Subscription €`,
`€0.00`, `Window total €0.00`, and the chart axis is labelled `€0`. On the very same
dashboard, "Revenue share owed" reads **`$0.00`**.

Vergr charges **USD**. `tierSystem.js:43,69` is `$4.99/mo` and `$9.99/mo`, and
CLAUDE.md records a 2026-08-19 sweep that removed euro pricing from user-facing copy
precisely because "USD shown = USD charged". **The admin surface was missed.**

It is not just a symbol. The naming goes all the way down to the Cloud Function:

```js
// functions/adminDashboard.js:13
const PRICE_EUR = { lite: 4.99, pro: 9.99 };
// :73
const mrrEUR = liteCount * PRICE_EUR.lite + proCount * PRICE_EUR.pro;
```

Those are the **USD** prices, stored under a EUR name, returned as `mrrEUR`, and
rendered by a shared formatter that defaults to a euro sign:

```js
// _adminGuarded.jsx:14
export const fmtMoney = (n, cur = '€') => `${cur}${...}`;
```

`AdminSubscriptionsScreen` inherits it across `mrrEUR`, `arrEUR`, `priceEUR`,
`estimatedEUR`, `totalBilledEUR`, `collectedEUR`, `pendingEUR`, `overdueEUR` and
`refundedEUR`. So the MRR figure is numerically right and currency-wrong: a $9.99
subscription is being reported to the founder as €9.99, which at any real rate is a
different amount of money.

**One place it is worse than a label.** `AdminDashboardScreen.jsx:317` converts coin
revenue into the same axis: *"convert coin revenue to EUR-equiv via 100c ≈ €0.90"*,
and `:333` computes `Window total` as `subscriptionEUR + totalPlatformCoins * COIN_TO_EUR`.
Coins are priced natively in USD with a floor of $0.01163, so 100 coins is about
$1.16 at the floor and $1.00 nominal. **`€0.90` per 100 coins matches neither**, and
it is applied to the total the founder reads as platform revenue.

⚠ **Do NOT sweep euros out of `AdminStatsScreen.jsx`.** Every euro on that screen is
a **Hetzner infrastructure cost**, which genuinely is billed in euros
(`accruedEur`, `projectedEur`, `monthlyEur`, `overageEur`). Those are correct.
`AdminSubscriptionsScreen.jsx:1064` is also fine: it reads the row's own
`r.currency` and only prints € when the row says EUR.

**Fix.** Change `fmtMoney`'s default to `$`, rename the revenue fields to USD in
`functions/adminDashboard.js` and `functions/adminSubscriptions.js` and their
readers, and delete the `COIN_TO_EUR` conversion in favour of the real coin price.
Leave the Hetzner cost figures alone.

**Verify.** `/admin` MRR must read `$9.99` against one Pro subscriber, and the
Revenue Overview axis and totals must be dollars. `/admin/economy` already reads
dollars, so the two screens must agree afterwards.

---

## Admin sweep, what is healthy

| Screen | Result |
|---|---|
| Dashboard | Loads, but takes about 15 seconds before the KPI tiles stop showing "—". Data itself is right: 18 users, 1 paid (0 Lite, 1 Pro), 0 live streams. System Status all healthy. Currency is wrong, see A68. |
| Users | **All four 2026-08-21 fixes confirmed live.** "Total Users 18, excl. guests + bots"; "Guest sessions 1, not counted in total" as its own KPI; Last Active shows real recency ("22h ago", "16d ago"), so it is reading `lastSeen` and not the write-once `lastActiveAt`. Username prefix search works: "player" returned 5 `@player*` accounts including one whose display name is Cyrillic, and the footer correctly read "5 loaded · end of list" with no phantom Load more. |
| Economy | Correct and honest. Subtitle "Coins in, revenue share out. No user-initiated withdrawal exists." A loud red banner states no payout partner is wired and that a run marks itself `blocked` and moves nothing. Figures are in **dollars**, which is what makes A68 an internal contradiction. Coins in circulation 400 across 44 wallets, and the Top coin holders list sums to exactly 400. |

**The `playerxxxx` accounts CLAUDE.md predicts are visibly present** (`playerxj6v`,
`playerxpyo`, `playera07n`, `playerboyf`, `playerxn8k`): anonymous sessions that
never got the `isGuest` flag, so `purgeStaleGuests` cannot see them and they sit in
the user table. They are counted in "Total Users 18". The per-user "Delete guest
account" button is the intended remedy and was not exercised, because it deletes an
Auth record.

Not yet swept: Announcements, Creators, Moderation Queue, Subscriptions, App Config,
Stream Preview, Live Stats, Audit Log, Admin Security, Admin Access, News Bots,
Vanguard.

---

# Session 2026-08-21 (evening), part 4: A33 verified on a free account

Driven on the **Verion** account (`damien.w.ashton@gmail.com`, free, non-admin),
which is the only way to see these screens: @Vergr is admin and outranks the tier
gate, so Audience renders in full there with no paywall at all.

## A33 item 2 (CTA off-screen) CONFIRMED LIVE, with measurements

`/creator/audience` renders **the entire page blurred, with no lock badge, no
title, no description and no Upgrade button anywhere in view.** There is nothing on
screen to say this is a paywall rather than a rendering failure. Same on
`/creator/analytics`.

The overlay is `absolute inset-0` and centred, so its position is a function of the
blurred content's height. Measured on the live pages:

| Screen | blurred content height | Upgrade button top | viewport | visible without scrolling? |
|---|---|---|---|---|
| `/creator/schedule` | 821px | 535px | 719px | **YES**, 184px above the fold |
| `/creator/audience` | 1808px | 1028px | 776px | **NO**, 252px below the fold |
| `/creator/analytics` outer LITE lock | 1944px | 1097px | 719px | **NO**, 378px below the fold |
| `/creator/analytics` inner PRO lock | nested inside the above | 1844px | 719px | **NO**, 1125px below the fold |

**Schedule is the reason this went unnoticed**: its content is short enough that the
CTA lands above the fold, so the paywall looks fine there and broken on the other
two.

### New, and worse: Analytics stacks two paywalls on top of each other

A free account on `/creator/analytics` gets **two blur layers and two Upgrade
buttons**. `MonthlyAnalyticsScreen.jsx:445` sets `requiredTier="lite"` on the
CreatorLayout, and `:327` wraps an inner section in its own
`<PlanLock required="pro">`. So the whole page is blurred by the Lite lock, and
**inside that blur sits a second, also-blurred Pro paywall** asking for a different
tier. Scroll far enough and you meet a LITE Upgrade button at 378px and a blurred
PRO Upgrade button at 1125px, competing.

Whatever is done about the overlay position, a locked page should not contain a
second lock for a higher tier. Decide which one a free user is being sold.

## A33 item 3 (missing badge) CONFIRMED LIVE

In the Studio sidebar on a free account: **Analytics and Schedule both carry a
purple `LITE` pill. Audience carries nothing**, and Audience is the screen that was
paywalled at the time of the screenshot. Confirmed against
`CreatorLayout.jsx:21,24,25`: `lock: 'lite'` is on analytics and schedule, absent on
audience, while `CreatorAudienceScreen.jsx:162` sets `requiredTier="lite"`.

## ⚠ A33 item 1 (wrong price) NEEDS CORRECTING: it is real but it is NOT on screen

The finding says the paywall "quotes a price 2 to 2.5 times what they would actually
be charged", and the handover put A33 first partly because that is money and it is
live. **The wrong price is not currently displayed to anyone.** Verify before fixing.

`PlanLock.jsx:20` really does still hold
`const PRICE = { lite: '$9.99/mo', pro: '$24.99/mo' }` against `tierSystem.js:43,69`
(`$4.99/mo`, `$9.99/mo`). But `:55-57` only renders it in a fallback branch:

```jsx
{!title && !description && (
  <p ...>Unlock with {reqLabel}{reqPrice ? ` — ${reqPrice}` : ''}.</p>
)}
```

**Every call site passes both.** `CreatorLayout.jsx:82` builds a title
unconditionally (`lockTitle || \`${...}-only feature\``), and
`MonthlyAnalyticsScreen.jsx:327-329` passes an explicit title and description.
`PlanChip` (the other exported component) is used nowhere in `src/`.

Confirmed live, not just from source: the rendered card on Audience reads
`LITE | Lite-only feature | Deep demographics, top supporters and growth trends.
Upgrade to Lite for audience insights. | Upgrade`, with **no price line**, and
`/Unlock with/` matches nowhere in the body text on any of the three screens.

**So the correct severity split is:**
- **Item 2, CTA off-screen: live, user-visible, high.** This is what makes the
  screens look broken.
- **Item 3, missing LITE badge on Audience: live, low, one line.**
- **Item 1, wrong price: a real defect but currently unreachable.** It is one
  omitted prop away from showing a 2x price on a payment screen. Fix it (read
  `TIERS[required].priceLabel`, never a second copy) but do not describe it as
  something users are seeing today.

**Fix for item 2.** Do not centre the overlay in the content. Cap the blurred
preview's height so the whole lock fits one screen at any content length, or pin the
card with `sticky`. Test on Analytics, which is the tallest and also the nested case.

**Verify.** As a free account, open all three of `/creator/analytics`,
`/creator/schedule` and `/creator/audience`. On each, without scrolling, the lock
card and its Upgrade button must be visible. If a price is ever shown it must read
$4.99/mo for Lite and $9.99/mo for Pro, matching `/settings/subscription`.

**Also worth folding in:** the mobile "More" sheet (`CreatorLayout.jsx:312-323`)
renders NAV entries with no lock badge at all, so on a phone none of the three
locked screens warn you before the wall.

---

## A69. The Change plan modal quotes $5.81 and $11.64, not $4.99 and $9.99 (NEW)

**Files:** `src/screens/settings/Subscriptionscreen.jsx:372-374`,
`src/components/LocalPrice.jsx:24-26`, `src/utils/tierSystem.js:42-43,68-69`

**Seen live** on the Verion (free) account, `/settings/subscription` then
"Change plan":

| Plan | Modal shows | Everywhere else says |
|---|---|---|
| Free | **€0**/month | free |
| Lite | **$5.81**/month | `$4.99/mo` |
| Pro | **$11.64**/month | `$9.99/mo` |

Both paid cards carry the line "exc. VAT/tax · billed in USD/USDT". Browser
timezone was `Africa/Johannesburg`.

$4.99 and $9.99 are what `tierSystem.js:43,69` calls `priceLabel`, what the
marketing site says, what six help articles say, and what
`functions/playBilling.js` sells as `sub_lite` and `sub_pro`. **The one screen a
user actually buys from asks for about 16% more.**

**Root cause: the USD list price is being fed into a EUR-to-USD converter.**

```jsx
// Subscriptionscreen.jsx:372-374
{tier.price === 0 ? '€0'
  : (usePlaySubs && playPrices[...]?.price) ? playPrices[...].price
  : <LocalPrice eur={tier.price} fallback={`€${tier.price}`} />}
```

`tier.price` is `4.99` from `TIERS`, and that entry's own sibling field is
`priceLabel: '$4.99/mo'`, so the number is dollars. It is passed as **`eur=`**, and
`LocalPrice:26` routes the `eur` prop through `convertFromEur()`. The fallback is
even written `€${tier.price}`. At a EUR/USD rate near 1.164 that turns 4.99 into
5.81 and 9.99 into 11.64, which is exactly what is on screen.

**This is a real contradiction inside the codebase, not a typo.** `LocalPrice`'s own
header comment says subscriptions "are still EUR-priced because they carry regional
multipliers", and `functions/geoPricing.js:154` computes `priceEUR` from `baseEUR`.
Meanwhile `tierSystem.js`, the help centre, the marketing pages and Play all say
USD. **Somebody has to decide which is true**, because today the sticker price and
the checkout price are different numbers.

⚠ **What I did NOT verify: what the card is actually charged.** I did not click
"Choose Lite", because that starts a real purchase. So this is confirmed as a
**display** discrepancy on the buy screen. Whether the charge is $5.81 or $4.99 is
the next thing to establish, and it decides the severity:

- If the charge is **$4.99**, the modal is over-quoting and losing conversions.
- If the charge is **$5.81**, users are being charged more than the advertised
  price, which is the exact thing `PriceQuote.jsx:9-13` was written to stop: *"The
  user was told one number and charged another, which is the thing a processor
  objects to at underwriting."* The coin screen was fixed for this. **Subscriptions
  were not.**

**Second problem in the same three lines: the regional multiplier is missing.**
`geoPricing.js:60,73` puts **ZA in the `upper` band at a 0.75 multiplier**, so a
South African buyer should see about $3.74 and $7.49, a discount. The modal showed
$5.81 and $11.64, in the opposite direction. Either the modal is not calling the
regional quote at all, or it is being overridden by the FX conversion. `LocalPrice`
only does FX; nothing in these three lines calls `regionalPrice`.

**Third, smaller: Free is hardcoded `'€0'`** at `:372` while the paid tiers render
in dollars, so one modal shows two currency symbols.

**Fix.** Do what the coin screen already does: have the SERVER return one quote that
has run the regional multiplier and the FX step together, and render exactly that
number. `getCoinPriceQuote` is the working precedent, described in
`PriceQuote.jsx:15-19` ("Nothing in this file multiplies anything. That is
deliberate: two independent calculations of one price eventually disagree"). Until
then, at minimum stop passing a USD figure as `eur=`.

**Verify.** As a free account, open Change plan. Lite and Pro must show the same
figures as the marketing site and the help centre, and the same figure the payment
step then asks for. Free must not be in euros.

---

## A39 CONFIRMED LIVE, and it is the first screen a new user sees

`/explore` on the Verion (free) account. The "Recommended Creators" rail carries
**40 accounts. 30 of them have zero followers.** Counted from the rendered rail:

| What they are | Count | Examples |
|---|---|---|
| Real accounts with any following | 5 | Vergr (8), Friz1k3 (8), shurasosok (2), aidenjacobs (2), vvttvtvtitvt (2) |
| **Abandoned anonymous sessions** | 6 | `playerxn8k`, `playera07n`, `playerxj6v`, `playerxpyo`, `playerboyf` |
| **Test accounts** | 2 | `apptester115`, `playreviewxxhy` |
| News bots | 22 | `ign`, `kotaku`, `pcgamer`, `polygon`, `eurogamer`, `playstation`, `blizzard`, `squareenix`, ... |

The `player####` accounts are the ones CLAUDE.md itself explains: anonymous
sessions that never got the `isGuest` flag, so `maintainUsernameIndex` fell back to
`'player'` plus four random characters. They have no email, no avatar, no posts and
no followers, and the admin Users table lists all of them as Inactive. **They are
not creators and there is nothing to follow.**

Each one renders as a coloured card with a grey silhouette, a name, "0 followers"
and a **Follow** button. Fourteen such cards are visible without scrolling. For a
new user this is the screen that answers "who is on this platform", and it answers
"nobody".

⚠ **The fix is DEMOTE, not EXCLUDE**, per the standing rule recorded in memory
(`feedback_for_you_never_blank`: never exclude bot/news, demote, because an empty
rail reads as a ghost town). Filtering all 30 zero-follower accounts would leave
five cards.

What is safe to exclude outright is narrower and well defined: an account that has
**no user-chosen username** (the `player####` fallback), **no avatar**, **no posts**
and **no followers** is not a creator by any definition. That removes the six
`player*` rows without touching the news bots.

Separately worth a founder decision, not mine: whether 22 news bots belong under a
heading that says **Creators**. They are legitimate accounts and they keep the rail
populated, but "Recommended Creators" is a claim about people.

**A10 confirmed fixed in the same pass:** Verion does not appear in its own
Recommended Creators rail.

**Verify.** As a fresh account, open `/explore`. No `player####` account should
appear in Recommended Creators, and the first row should be accounts with something
to show.

---

## A70. The verified badge vanishes from Vergr Support the moment you use it (NEW, founder-spotted)

**Files:** `src/components/MessagesListPanel.jsx:667,683-691`,
`src/screens/messages/MessagesInboxScreen.jsx:529`,
`src/screens/messages/native/NativeMessageScreens.jsx:447`,
`src/utils/chatIdentity.js:158`, `src/firebase/officialChannels.js:293`,
`functions/supportChannel.js`

The badge is built and it works. It is gated on one field that the real support
conversation never gets.

**Measured live on the Verion (free) account**, reading the rendered rows:

| Row | verified icon in the row |
|---|---|
| Vergr Offers ("No messages yet") | **YES** |
| **Vergr Support** (last message 3d ago) | **NO** |
| Friz1k3, Vergr, Vergr Update Logs | no (correct, not official) |

**Why those two differ.** Until a user opens an official channel, the row is
**synthetic**, built client-side by `buildOfficialRows()`, which stamps
`isOfficial: true` (`officialChannels.js:293`). Once a real thread exists,
`MessagesListPanel.jsx:130-135` deliberately drops the synthetic row
(`officialRows.filter(r => r.kind !== 'support')`) and the real `conversations` doc
takes its place. The badge renders on `const official = !!conv.isOfficial`
(`:667`), so it disappears.

**Confirmed against the stored document**, not inferred. Read
`conversations/support_vergr_support_<uid>` over the Firestore REST API with the
signed-in user's own token:

```
fields present: admins, createdAt, createdBy, groupAvatar, groupName, isGroup,
                lastMessageAt, lastMessageText, participants, status,
                supportAgents, supportChannelId, supportClaimedBy, supportState,
                supportThread, supportUserId, visibility
isOfficial:  ABSENT
accentColor: ABSENT
supportThread: true
```

**`isOfficial` is written nowhere in `functions/`** (grepped). It exists only on
client-built synthetic rows. `accentColor` is missing too, which matters because the
badge paints `background: conv.accentColor || '#7B1FFF'`.

**The code already knows this thread is official, for a different purpose.** The
call-button guard added on 2026-08-21 reads
`!chatInfo?.isSaved && !chatInfo?.supportThread && !chatInfo?.isOfficial`
(`ChatThreadScreen.jsx:3041`), and it works: the support thread correctly shows no
call buttons. So `supportThread` is on the doc, is read, and is trusted for
suppressing calls, but the badge path checks only `isOfficial`.

**Why this is worth more than a missing icon.** The support thread is the single
place a user most needs to know they are talking to the real Vergr, because it is
where they would be asked for account details. As it renders today it is
indistinguishable from any group someone else named "Vergr Support" with a copied
avatar. The badge is present right up until the moment it starts mattering.

**Three more places inherit the same gap:** `MessagesInboxScreen.jsx:529` (mobile
web) and `NativeMessageScreens.jsx:447` (the APK) use the identical
`!!conv.isOfficial`, and `chatIdentity.js:158` branches on it for identity
resolution, so the real support thread also loses its official identity treatment
there. **The same thing will happen to community channels** once a user joins the
room and `roomConvoId` becomes a real conversation.

**Fix, two valid routes:**

1. **Client, one line, works on the threads that already exist:**
   `const official = !!conv.isOfficial || !!conv.supportThread;` in all three list
   components and in `chatIdentity.js`. Needs no migration and no deploy of
   functions.
2. **Server, more correct long term:** have `supportChannel.js` write
   `isOfficial: true` and `accentColor` onto the conversation doc. It already writes
   with `set(..., { merge: true })` at `:136` and `:173` and already has a heal path
   at `:110`, so existing docs can be backfilled rather than left behind.

Doing route 1 now and route 2 next is reasonable. Doing only route 2 leaves every
existing support thread unbadged until it is healed.

**Secondary, worth a look while in there:** the badge is a 12px circle carrying a
7px glyph in the avatar's bottom-right corner. On Vergr Offers it is genuinely hard
to see at a glance. If the point is trust, it should read as a badge.

**Verify.** Open Messages as a user who has an existing support thread. The Vergr
Support row must carry the verified badge, and so must the thread header. Then check
the same on mobile web and in the APK, since both use their own copy of the check.

---

## A71. Three of the four in-feed ad slots never fill and leave 631px holes in the feed (NEW)

**File:** `src/components/VergrAd.jsx:99-117,134-148`

Scrolling the For You feed as a **free** account drops you into a full-viewport
empty card, three times. Screenshot confirmed with the sidebar and right rail
rendering normally beside it, so it is the feed column specifically.

**Measured on the live page** (`ins.adsbygoogle`, absolute positions in a 17,034px
document):

| Slot | top | height | `data-ad-status` | child iframes | display |
|---|---|---|---|---|---|
| 1 | 5023 | **631px** | **null** | 0 | block |
| 2 | 10844 | **631px** | **null** | 0 | block |
| 3 | 16343 | **631px** | **null** | 0 | block |
| 4 | 10362 | 0 | `unfilled` | 1 | **none** |

Slot 4 is the system working: AdSense processed it, had nothing to serve, and
collapsed it to `display: none` so the feed closes up. The other three were
**never processed at all** (a null `data-ad-status` and no iframe means AdSense
never touched the element), so nothing ever collapses them and each holds
**631px** of empty space. That is roughly 1,893px, about 11% of the whole feed,
in three viewport-sized holes.

`window.adsbygoogle` is defined and two `googlesyndication` script tags are
present, so the loader is there. Each `<VergrAd>` pushes exactly once
(`pushedRef`, `:102-103`) inside a `setTimeout(..., 0)` with a `try/catch` that
warns on failure (`:110-114`). I could **not** capture that warning: the console
reader returned nothing on this browser even after a reload, so **the exact
AdSense failure mode is unproven.** Do not write it up as a `no_div` error without
seeing it; open the console on the live feed and scroll, the component already
logs `[VergrAd] adsbygoogle.push failed:` if that is what happens.

**Note the component does not set the height.** The web branch renders
`<ins className="adsbygoogle block" style={{ display: 'block' }}>` with no
reserved height (`:137-146`); `NATIVE_AD_HEIGHT = 300` applies only to the Android
branch. The 631px is coming from AdSense's own handling of
`data-ad-format="fluid"` plus `data-full-width-responsive="true"`, applied to
elements it then never fills. So the fix is not "remove the reserved height", it is
"make sure every slot is actually processed, and collapse any slot that is not".

⚠ **There is a deliberate design decision nearby, do not undo it by accident.**
`VergrAd.jsx:71-75` says the slot "KEEPS its reserved height whether or not an ad
fills, the point of the slot is to earn, so we hold the space and retry rather
than hiding the inventory." That comment is about the **native Android** slot,
where Kotlin positions a real AdMob card over reserved space. It is not a
justification for leaving three unprocessed web slots as blank holes: on web the
one slot AdSense did handle collapses itself, which is the behaviour the other
three should get.

**Fix.**
1. Establish why only one `<ins>` gets processed. Push per element after it is in
   the DOM, and log the AdSense error rather than swallowing it into a `console.warn`
   nobody reads.
2. Collapse any slot that has no `data-ad-status` after a timeout, the same way
   AdSense collapses an `unfilled` one. A blank 631px card is worse than no ad.

**Verify.** As a free account, scroll the whole For You feed. There must be no
empty full-height card. Then check on Lite or Pro that no slot renders at all, since
ads are a free-tier-only experience.

### Not a bug, recorded so nobody re-files it

Two screenshots during this test came back as a **completely blank viewport**, with
the sidebar and right rail missing too. That is a **capture artifact**, not the app.
Measured immediately afterwards at the same scroll position: `#root` held 203,786
characters of HTML, `document.body.innerText` was 19,646 characters, and
`elementFromPoint` returned real elements at five sample points including the
sidebar and the right rail. The screenshot was taken before the compositor
repainted after a scroll. Same class as the "renderer may be frozen" error from the
`zoom` action earlier. **Measure the DOM before filing anything based on a blank
screenshot.**

---

# Session 2026-08-21 (evening), part 5: narrow viewport + notifications

**The founder narrowed the Chrome window by hand to 500x714**, which is what made
everything in this section possible. `resize_window` does not do it. See the
corrected tool note earlier in this session's write-up.

## A72. The notifications page reads "Vergr Vergr" (NEW, and it is a regression from the A38 fix)

**File:** `src/screens/home/NotificationsScreen.jsx:104-107`

A DM notification renders as **"Vergr Vergr"** followed by the message preview.
Read straight out of the DOM:

```html
<p class="text-sm leading-relaxed text-text-primary font-medium">
  <span class="font-bold text-white">Vergr </span>Vergr
</p>
```

The component prints `senderName` and then `title`:

```jsx
{notif.senderName && <span className="font-bold text-white">{notif.senderName} </span>}
{notif.title || notif.content || 'Notification'}
```

**For a message notification the title IS the sender's name.** `functions/index.js:3194`
and `:3226` both write `title: senderName, body: preview`, which is the correct push
shape (title = who, body = what). So the page prints the name twice.

**This is collateral from the A38 fix.** A38 was the opposite complaint: the page
ignored `title`, so a quest reward showed "Profile banner" instead of
"+300 VP earned!". The fix made the page prefer `title` but left the `senderName`
prefix in place, and nobody re-checked the notification types where `title` already
contains the name. On the same screen right now, the quest row correctly reads
**"+300 VP earned!" / "Profile banner"**, so A38 itself is genuinely fixed.

**`NotificationsDrawer.jsx:184-185` gets it right and does not prefix at all:**

```js
const title = notif.title || notif.content || 'Notification';
const body  = notif.body || '';
```

So the drawer shows "Vergr" / "AUDIT scroll test text". The two surfaces still
disagree about the same notification, just in the opposite direction from A38.

**Fix.** Drop the `senderName` prefix on the page and match the drawer. Every writer
that sets `senderName` already puts the name in the title, including
`functions/index.js:2175`, which writes a title of the form
"X mentioned you in squad chat" and would otherwise read "X X mentioned you in...".

**Verify.** Send yourself a DM from another account and open `/notifications`. The
row must read the sender's name once. Then check a quest reward still reads
"+300 VP earned!" and not "Profile banner", so the A38 fix is not undone.

**While in that file:** the reward copy carries em dashes, "+50 VP — 5-day streak!"
and "Streak complete — start again tomorrow!", which the house rule bans in
user-facing text.

---

## A33 at 500px: materially worse than on desktop

Same finding, measured on the narrow viewport:

| | desktop 1552x776 | narrow 500x714 |
|---|---|---|
| blurred content height | 1808px | **2890px** |
| Upgrade button top | 1028px | **1554px** |
| **below the fold** | 252px | **840px** |

Narrow makes the content taller, and the overlay is centred in it, so the CTA falls
further out of view. On a real phone it will be worse again.

**And there is no warning anywhere in the mobile chrome.** The mobile bottom nav
renders `HOME / INSIGHTS / EARNINGS / SCHEDULE / MORE` with **no LITE badge on
Insights or Schedule** (`bottomNavHasLiteBadge: false`), and the "More" sheet
(`CreatorLayout.jsx:312-323`) renders NAV entries with no badge either. So on mobile
a free user gets no signal before the wall on any of the three locked screens, then
lands on a page that looks broken.

---

## A73. One news bot is publishing the source site's navigation bar as the post body (NEW)

The **top post in the For You feed** right now, from **@xboxwire**, has this as its
text:

> Skip to main content XBOX Join Game Pass Browse Games Deals with Game Pass XBOX
> Cloud Gaming Games home Shop all console games Shop all PC games Cloud games XBOX
> Play Anywhere Free-to-Play games Shop consoles XBOX Series X XBOX Series S Shop
> accessories Controllers Headsets Handhelds Where to buy Pl…

That is xbox.com's nav menu, starting with the accessibility skip-link that is the
first element of the page. The importer captured the whole page's text instead of
the article. The real article only appears in the embedded link card underneath
("The Elder Scrolls Online: Tour Tamriel with the…").

**Scope, measured rather than assumed:** I sampled **28 posts across 12 bot
accounts** by scrolling the feed (`xboxwire`, `playstation`, `pcgamer`, `ign`,
`ign_shorts`, `polygon`, `kotaku`, `rockpapershotgun`, `gematsu`, `gamespot`,
`eurogamer`). **Exactly one was nav chrome**, the xboxwire post above; a second
xboxwire post in the same sample was fine. So this is **not systemic**, but the
importer clearly has no guard against it, and the one bad post is currently the
first thing a logged-in user reads.

⚠ **It also has an SEO angle.** `ugcRenderer.js` gates indexing on
`seoText.length >= 400`, and this junk is well over 400 characters, so a scraped
nav menu is exactly the kind of page that would be submitted to Google. Worth a
look given the 2026-08-14 noindex episode.

**Fix.** Add a cheap guard to the import path: reject or re-extract when the body
starts with a skip-link, or when it contains a high ratio of short nav-like
fragments and no sentence punctuation.

---

## Confirmed live on the narrow viewport, closing two more handover items

The 2026-08-21 handover listed A60 and A61 as code-verified only and asked for a
visual pass. Both are good:

- **A60, squads hub mobile layout:** correct. Back arrow, centred "Squads" title,
  hamburger, filter chips wrapping to two rows, honest empty state with a working
  Create Squad CTA. **No overlapping columns.**
- **A61, back navigation on squad screens:** present. `/squads` and
  `/squads/:id` both render a working back arrow and the squad name in the header,
  and the overview's cards stack cleanly.

Minor, not a bug: at 500px the Find Squads header row is cramped, with both "Find
Squads" and "Create Squad" wrapping to two lines.

Also seen in passing: the squad overview subtitle is "The squad hub — recent
activity, pinned announcement, upcoming events", another user-facing em dash.

---

## A74. The composer sells Schedule as PRO, but it is a LITE feature (NEW)

**File:** `src/components/composer/CreateComposer.jsx:1117` and `:1540`

```jsx
Schedule{!isPaid && <span className="up-pill">PRO</span>}
...
{!isPaid && <span className="up-pill">PRO</span>}
```

**The gate is right and the badge is wrong.** `:663` defines
`const isPaid = tier === 'lite' || tier === 'pro'`, so **Lite already unlocks
scheduling**. The pill shown to a free user says **PRO**.

That contradicts the source of truth in both directions:
- `src/utils/tierSystem.js` lists "Scheduled posts and scheduled DMs" under the
  **Lite** feature list, not Pro.
- CLAUDE.md says plainly: "**Scheduled posts are a Lite/Pro feature** (free sees the
  entry with an upgrade pill + prompt to `/settings/subscription`)."

So a free user who wants to schedule a post is told they need the **$9.99** plan when
the **$4.99** one would do. Counted on the live composer: **three `PRO` pills and
zero `LITE` pills**. It is a small string, but it steers people to the wrong plan on
the screen where they decide to pay.

**Fix.** Change both pills to `LITE`. While in there, check every other `up-pill` in
the composer against `tierSystem.js` rather than assuming, since the same mistake
could be in more than these two.

**Verify.** As a free account, open the composer. The Schedule affordance in the
header and the "Schedule for later" card must both read LITE, and tapping either
must land on `/settings/subscription`.

---

## A75. At 500px the composer toolbar is drawn on top of the Topics section (NEW)

**File:** `src/components/composer/CreateComposer.jsx` / `src/styles/composer.css`
(`.tool-icons` and `.section`)

Opened the composer at **500x714** (the founder's narrowed window). The toolbar row
(Media, GIF, Poll, Clip, Mood, Stats, Tag, Location) renders **through** the
"Topics · optional · helps the right people discover it" heading, and the "Schedule
for later" card lands over the topic chips (Gaming, Esports, Just Chatting, IRL,
Music, Art & Crea…).

Measured rects:

| Element | top | bottom | height |
|---|---|---|---|
| Hashtags section | 466 | 534 | 68 |
| **Topics section** | **546** | **610** | 64 |
| **`.tool-icons` toolbar** | **591** | **629** | 38 |
| Add media section | 628 | 984 | 356 |

The toolbar overlaps the Topics section by **19px** and the Add media section by
1px. `.tool-icons` is `position: static` with `z-index: auto`, so this is not a
stacking-context problem: the layout itself is placing them in the same space, which
means something above it has a height that does not account for its content at this
width.

This is the same family as **A9** ("Poll form opens behind the toolbar"), which is
marked fixed. This is a **different instance** of it, so fixing A9 did not fix the
composer generally. Worth checking whether the root cause is shared.

⚠ **Not tested at desktop width**, so it may be narrow-only. Reproduce at 500px
first.

**Verify.** Open the composer at a narrow width. Hashtags, Topics, the toolbar and
Add media must stack with clear space between them, and no text may be drawn through
any other element.

---

## Minor, recorded but not worth its own number

**The Create-post FAB clips the Tip button.** On the mobile feed the FAB
(`aria-label="Create post"`, 56x56 at left 428, top 586) overlaps the first post's
Tip pill (61x26 at left 373, top 596) by about **6px horizontally**. Measured with
`elementFromPoint`: the Tip button's centre is **not** covered, so it is still
clickable, and `blocked: false`. Visual only, but it is a money control sitting under
a floating button, and a real phone is narrower than 500px so it may be worse there.

## Checked at 500px and healthy, no defect found

- **Shorts** (`/shorts`): honest empty state, back arrow, two working CTAs, bottom
  nav correctly hidden for the immersive surface.
- **Profile** (`/profile`): banner, avatar, VP ring, follower counts, tab row
  (Posts / Media / Clips / Likes / Bookmarks / Tagged) and an honest "No posts yet"
  with a CTA. Sticky mini-header with the avatar and name appears on scroll.
- **Profile completion card**: I nearly filed this. The ring reads **33%** while all
  four listed steps show unchecked, which looks broken. It is correct.
  `ProfileCompletionCard.jsx:56-61` defines **six** items;
  `:75-76` computes `pct` from `completed / items.length`, and this account has the
  avatar and banner done, so 2/6 = 33%. `:65` only LISTS items that are not done or
  not claimed, so the two finished ones are hidden. "1,200 VP left" is the exact sum
  of the four shown. Everything is internally consistent. The only weakness is
  presentational: nothing on screen justifies the 33%, so consider showing the
  completed steps ticked rather than hiding them. `:71-74` documents that the ring
  was deliberately switched to follow `i.done` when A11 was fixed, so do not revert
  that.
- **DM thread on the recipient's side**: renders correctly, including the video that
  is a black box for the sender (see the A64 correction), the unread divider, and
  the poll with its tally.

---

## A76. The wallet still says "Your wallet, your earnings", which is the one thing it deliberately is not (NEW)

**Files:** `src/screens/wallet/v2/HomeScreen.jsx:102`,
`src/screens/wallet/native/NativeWalletScreens.jsx:99`

Both render the subtitle **"Your wallet, your earnings."** under the greeting.

That contradicts a locked founder decision recorded in CLAUDE.md:

> **The wallet is the BUYER surface only:** coins held, buy coins, purchase/spend
> history, who you sent to, active subscriptions, security. Nothing that holds or
> moves cashable value.

and, more pointedly:

> ⚠️ **The wallet does NOT link to Creator Studio.** … Removed: the Earnings quick
> action, the Earnings card in the right rail, and the "How creators get paid" help
> link. Part 3 §18 proposes a conditional "you have earnings" row; **founder
> rejected even that**, so there is no wallet-to-earnings path at all.

So the screen promises earnings in the one surface that was deliberately stripped of
every earnings affordance. It is one string in two files, but it is in the area the
project has been strictest about, and it is the kind of stale copy the CLAUDE.md
preamble warns gets repeated as fact.

**Fix.** Something that describes what the screen is, for example "Your coins and
your purchases." Do NOT add an earnings link to make the subtitle true.

**Verify.** Open `/wallet` on web and in the APK. Neither may mention earnings.

---

## A66 scope refinement: the broken announcements composer is LEADER-only

Checked `/squads/<id>/announcements` as **Verion, a MEMBER**: the composer does not
render at all (no title input, no body textarea), and the page correctly shows
"No announcements yet / Leadership posts here". So the white-on-white composer from
A66 only reaches squad leaders and admins.

That narrows the blast radius but does not reduce the severity much: the leader is
the only person who posts announcements, so the feature is unusable for the only
role that has it.

---

## Privacy settings VERIFIED HEALTHY, and this closes the A18 question properly

A18 ("four privacy controls wired to nothing") is marked fixed. I checked **every**
control on `/settings/privacy` by finding its real consumer rather than trusting the
label, because a zero-caller count is not proof after A30 moved profile enforcement
into the data layer.

| Control | key | Enforced where |
|---|---|---|
| Profile visibility | `profileVis` | **`firestore.rules:136`**, the data layer. This is why the client helper `canViewProfile` has no callers, and that is correct. |
| Search visibility | `searchVis` | `privacy.js:107` via `hiddenFromDiscovery` (9 callers) |
| Receive messages | `receiveMsg` | `src/firebase/firestore.js:1442` |
| Who can tag me | `tagMe` | `CreateComposer.jsx:34` |
| Read receipts | `readReceipts` | `ChatThreadScreen.jsx:1277,1282,1673,1679` |
| Show online status | `onlineStatus` | 5 call sites incl. `SquadInfoRail` presence |
| Appear in suggested users | `suggestedUsers` | `privacy.js:107` |
| Show in hashtag searches | `hashtagSearch` | `privacy.js:108` |
| Show in trending | `showTrending` | `privacy.js:109` |
| Who can comment | `commentContent` | 2 call sites |

**All of them have a real consumer. No dead toggles.**

⚠ **I nearly filed two false findings here, both worth recording as method notes:**

1. `canTagUser` and `canMessageUser` have **zero callers**, which looks exactly like
   A18. But the SETTINGS THEY GATE are enforced by other code paths
   (`CreateComposer.jsx:34` and `firestore.js:1442`). The helpers are dead exports,
   not dead features. Deleting the exports is a tidy-up, not a fix; **do not
   "restore" enforcement that already exists elsewhere.**
2. `CreateComposer.jsx:34` calls
   `passesVisibility(getPrivacy(u).tagMe, { viewerFollowsTarget: true })` with the
   relationship **hardcoded true**, which reads like a privacy hole. It is not: the
   line immediately above is `.filter(u => followingIds.has(u.id))`, so the list is
   already restricted to people the viewer follows and the flag is true by
   construction. "Only me" still correctly returns false.

**Dead exports worth removing at some point** (cosmetic, no behaviour change):
`canViewProfile`, `canTagUser`, `canMessageUser` in `src/utils/privacy.js`.

---

## Also checked at 500px, healthy

- **Wallet home**: PIN / 2FA / KYC L0 status pills, coins card with a correct
  `≈ $0.00`, VP card with level progress, bottom nav (Home / Buy / History / More).
  Aside from the subtitle in A76, correct.
- **Wallet history** (`/wallet/history`): the filter set is exactly the buyer ledger
  the Part 3 spec calls for, **All / Unlocks / Tips sent / Coins bought /
  Subscriptions**, with no conversion or withdrawal filters. Table is
  DATE / ACTIVITY / TYPE / AMOUNT / STATUS with an Export CSV action. **No horizontal
  overflow at 500px** (`scrollWidth` 500 = `innerWidth` 500). The only rows this
  account has are VP rewards, which match none of the four purchase filters and show
  only under All; worth deciding whether VP belongs in a buyer ledger at all.
- **Explore** at 500px: no horizontal overflow.
- **Squad announcements** at 500px: no horizontal overflow.

---

## A77. The Chat/Community badge adds four different UNITS together (NEW)

**This is the answer to the open question from the 2026-08-21 handover**, §4: *"On
A59 he asked: 'check if the count is actually accurate because I don't know what the
16 count is.' I did not independently verify that each of those four underlying
numbers is itself correct."*

**They are each internally correct. The problem is that they do not measure the same
thing, and the badge adds them up.**

**Files:** `src/components/BottomNav.jsx:58`,
`src/components/DesktopSidebar.jsx:77-78`, `src/context/NotificationContext.jsx`

Both navs compute:

```js
unreadChatCount + squadUnreadCount + missedCallCount + requestCount
```

and those four are counted in different units:

| Addend | What it counts | Where |
|---|---|---|
| `unreadChatCount` | **MESSAGES.** `count += c.unreadCount[uid]` summed across every conversation | `NotificationContext.jsx:168-174` |
| `squadUnreadCount` | **SQUADS.** `n++` once per squad whose `lastMessageAt` beats the local read cutoff | `:118-127` |
| `missedCallCount` | **CALLS.** `n++` per unanswered call | `:129-137` |
| `requestCount` | **REQUESTS.** `list.length` | `:195` |

So the badge is `messages + threads + calls + requests`. It is not a count of
anything a user could name.

**Seen live on the Verion account:** the CHAT badge reads **4**. The messages list
shows the **Unread tab at 1** and a single conversation carrying a 4. So the badge
said 4 when there was **one** thing to look at, because that conversation holds four
unread messages.

Scale it and it gets worse in the direction the founder noticed: one chatty
conversation with 12 unread plus 3 squads with activity shows **15**, and opening
Chat reveals **4 rows**. That is how you get a 16 nobody can account for.

**This is not the same bug as A59.** A59 was about the badge showing an unlabelled
dot instead of a number, and about two wrong sources (the bell including
`unreadNotifCount`, and `CallsScreen` querying `calls` directly). Both of those are
fixed. This is the composition underneath, which was changed at the same time but
never validated.

**Fix, and it is a product decision, not just code.** Pick one unit and use it
everywhere:

- **Recommended: count CONVERSATIONS**, i.e. rows the user will see when they open
  the screen. Change `unreadChatCount` to `convos.filter(c => c.unreadCount?.[uid] > 0).length`
  so it matches how `squadUnreadCount` already counts. Then the badge means "this
  many rows need you", which is what every messaging app's badge means and what the
  per-row counts already break down.
- If you would rather the badge count messages, then `squadUnreadCount` has to
  become a message count too, which is more work and needs per-squad unread
  tracking that does not exist today (it is a device-local cutoff, not a count).

**Verify.** Leave several unread messages in ONE conversation and nothing else. The
badge must read 1, and the conversation row must show its own message count. Then
add a squad with new activity and confirm the badge reads 2.

---

# Session 2026-08-21 (evening), part 6: the rest of the admin surface

Back on the **@Vergr** (admin) browser.

## A78. "Free Users" on the Subscriptions overview is permanently 0 (NEW)

**File:** `functions/adminSubscriptions.js:88`

```js
safeAgg(users.where('subscription', '==', 'free'), { count: AggregateField.count() })
```

Live: the platform has **18 users and 1 Pro subscriber**, so there are about 17 free
users. The KPI reads **0**.

**Cause: free users have no `subscription` field at all, and Firestore cannot match a
missing field with `==`.** `functions/index.js:2738` `onUserCreated` writes the user
doc and never sets `subscription`. The only three writers of `subscription: 'free'`
are `adminSubscriptions.js:895` (clearing a comp), `playBilling.js:339` and
`subscriptions.js:249` (cancel or expire). So the field only exists on someone who
once paid and then stopped, and the count can only ever show lapsed subscribers, not
free users.

The `== 'pro'` sibling query works and returned 1, which is why the rest of the card
looks right and this one number does not.

**Fix.** Either derive it (`totalUsers - lite - pro`, using the same guest and bot
exclusions the Users screen uses), or write `subscription: 'free'` at signup and
backfill. Deriving is cheaper and cannot drift.

**Verify.** Free Users must read roughly Total Users minus paid, currently ~17.

---

## A79. Nine of the eleven "HEALTHY" status pills can never say anything else (NEW)

**Files:** `src/screens/admin/AdminDashboardScreen.jsx:128-139,236-242`,
`functions/adminConfig.js:284-293`

**The Dashboard's System Status is entirely decorative.** `SYSTEM_PILLS` is a static
list of five names and icons with **no status field at all**, and the JSX renders the
literal string `HEALTHY` in green for every one, unconditionally:

```jsx
{SYSTEM_PILLS.map(p => ( ... <span style={{ color: '#22c55e', ... }}>HEALTHY</span> ))}
```

API, Web, Live Streaming, Payments and Notifications will read HEALTHY during a total
outage.

**App Config's version is half real.** `adminGetSystemHealth`
(`functions/adminConfig.js:275-293`) does check two things and hardcodes four, and the
code is honest about it in its own comments:

| Service | Real? |
|---|---|
| Database | **Yes**, attempts a Firestore read |
| Storage | **Yes**, checks `R2_BUCKET` is set (presence, not reachability) |
| Cache | hardcoded `true` |
| Queue | hardcoded `true` |
| Search | hardcoded `true` |
| CDN | hardcoded `true`, comment: "no live check from here" |

So 2 of 11 pills across the two screens are real. **A status board that cannot report
a problem is worse than no status board**, because the first thing an operator does in
an incident is look at it and be reassured.

**Fix.** Either give each pill a real check, or delete the ones that are decorative
and label the remaining two honestly. Do not leave green pills that are green by
construction. If a live check is genuinely impossible from Cloud Functions (CDN),
say "not monitored" rather than "healthy".

---

## A80. Live Stats reports Active Now, WAU, MAU and every device count as 0, always (NEW)

**File:** `functions/adminStats.js:61,65,66,88,89`

```js
safeCount(users.where('lastSeen', '>=', now - 5 * 60 * 1000)),   // Active Now
safeCount(users.where('lastSeen', '>=', weekAgo)),               // WAU
safeCount(users.where('lastSeen', '>=', monthAgo)),              // MAU
```

`lastSeen` is a Firestore **Timestamp**. These compare it to a raw **number** of
milliseconds. Firestore orders types separately, so a Timestamp field never satisfies
`>=` against a number and the queries match **nothing**.

Observed live while the app was open and in use on two accounts:
**Active Now 0, WAU 0, MAU 0, and Active Devices web/iOS/Android/Other all 0 (0.0%)**,
on a platform whose own Users screen simultaneously reported "Active (7d) 3".

**This exact bug was found and fixed on 2026-08-21, in the other two files, and missed
here.** `functions/adminDashboard.js:46-49` carries the fix and a comment naming the
cause ("`lastSeen` is a Firestore Timestamp and `weekAgo` was a raw number of…"),
using `new Date(weekAgo)`. `functions/adminUsers.js:145` uses
`new Date(now - ACTIVE_WINDOW_MS)`. `adminStats.js` was never updated.

**Fix.** Wrap all five comparisons in `new Date(...)`. One line each.

**Verify.** With someone using the app, Active Now must be non-zero, and WAU/MAU must
be at least as large as the Users screen's "Active (7d)".

---

## A81. Two admin screens report "Total Users" as 52 and 18 (NEW)

**Files:** `functions/adminStats.js:62` versus `functions/adminUsers.js` /
`functions/adminDashboard.js`

- **Live Stats: Total Users 52**
- **Dashboard: Total Users 18**
- **Users: Total Users 18**, labelled "excl. guests + bots", with "Guest sessions 1,
  not counted in total" as its own KPI

`adminStats.js:62` is a bare `safeCount(users)` over the whole collection, so it
includes the ~22 news bots, guest sessions and every other doc. The Users and
Dashboard figures deliberately exclude bots and guests, and the Users screen says so
on the card.

Both are defensible numbers. **Both are labelled "Total Users", and they differ by
nearly 3x**, which means the founder cannot read either with confidence, and it is the
first number on both screens.

**Fix.** Pick one definition, apply the same exclusions in `adminStats.js`, and if a
raw all-docs count is still wanted, give it its own label such as "All documents".

**Verify.** The same figure on `/admin`, `/admin/users` and `/admin/stats`.

---

## A68 confirmed again on the Subscriptions screen

Same euro problem as the Dashboard, on the money screen: **MRR `€9.99`, ARR
`€119.88`**, and Upcoming Renewals values as `~€0.00`. The subscriber is on the
**$9.99** Pro plan. Adds four more display sites to A68's fix list.

---

## Admin screens checked and healthy

| Screen | Result |
|---|---|
| Moderation Queue | Correct. KPIs (Total in queue / Unreviewed / Overdue >48h / Resolved today), an **Enforcement record** panel with median-time-to-action and "within published target" (good compliance-facing work, honest `—` when there is no data), tabs per content type with counts, working filter panel, honest empty state. |
| Creators | Correct but bare. Pending / Approved / Rejected tabs, honest "No pending applications." and "Select an application to review it." The orange "Admins only." line under the tabs reads like a warning rather than a label; consider restyling. |
| App Config | Loads with nine tabs, a Configuration Summary showing "Dirty Fields: No", and a working save-state button ("No Changes"). Fields populated. Only issue is the System Status card, see A79. |

---

## A82. An incoming call shows the caller's GOOGLE account name and photo, not their Vergr identity (NEW, founder-spotted)

**File:** `src/screens/messages/ChatThreadScreen.jsx:2178-2179`

Founder, on his phone: *"the incoming call says 'Verge Nerd' and the avatar is just a
V, not the actual user's avatar."*

**Confirmed from the stored call document.** I placed a real video call from @Vergr to
Verion and read `calls/0yOU…_dosQ…` back over the REST API:

| Field on the call doc | Value |
|---|---|
| `callerName` | **"Verge Nerd"** |
| `callerAvatar` | **`https://lh3.googleusercontent.com/a/ACg8ocIlT513…=s96-c`** |

And the caller's own user document, `users/0yOU…`:

| Field | Value |
|---|---|
| `displayName` | **"Vergr"** |
| `avatar` | `https://firebasestorage.googleapis.com/v0/b/vergr-44494.firebasestorage…` |

So the call carries the **Firebase Auth** identity (the Google account's real name and
its `lh3.googleusercontent.com` photo) instead of the **app profile** identity that
the account presents everywhere else.

**The line that does it:**

```js
// ChatThreadScreen.jsx:2178-2179
callerName:   auth.currentUser.displayName || profile?.displayName || 'Anonymous Pilot',
callerAvatar: auth.currentUser.photoURL    || profile?.avatar      || '',
```

**The app already does it correctly somewhere else**, which is what makes this a bug
rather than a decision. `src/screens/calls/CallsScreen.jsx:117-118`:

```js
callerName:   profile?.displayName || 'User',
callerAvatar: profile?.avatar || '',
```

Two call-start paths, two different identities. The DM path is the one people use.

⚠ **CORRECTION to my first write-up of this finding.** I originally blamed
`IncomingCallManager.jsx:113,118` for the bare "V". **That component is mounted
nowhere** — grepping `src/` for `IncomingCallManager` returns only its own file and
one comment in `ChatThreadScreen.jsx:3036`. It is dead code, ringtone and all.

**The incoming call is actually rendered by `IncomingCallOverlay`**, mounted once at
`AppRouter.jsx:762`, and that component **does** do a live user lookup:

```js
// IncomingCallOverlay.jsx:63-64
const callerData = await getUser(candidate.callerId).catch(() => null);
setCaller(callerData);
// :277  <UserAvatar src={caller?.avatar || incomingCall.callerAvatar} … />
// :285  {caller?.displayName || incomingCall.callerName || 'Unknown'}
```

So on **current** code the overlay should show "Vergr" and the real avatar, and fall
back to the frozen call-doc values only when `getUser` fails or returns nothing.

**That leaves two live possibilities and I cannot separate them from the phone
alone:**
1. The founder's APK predates this live-lookup code, so his build renders the frozen
   values directly. His own reasoning, and it is plausible: the same phone still
   shows the pre-A58 support avatar, so it is demonstrably running an older bundle.
2. `getUser(callerId)` is failing or returning a doc without `avatar` / `displayName`
   on that device, and the fallback is doing its job.

**Either way the stored data is still wrong** and should be fixed at the source
(`ChatThreadScreen.jsx:2178-2179`), because the fallback is what a cold start, a
failed lookup or an older client will always land on. **Settle which by testing
browser to browser on current deployed code before writing this off as staleness.**

**This is more than cosmetic, three ways:**

1. **It discloses the caller's real name.** The Google account name is "Verge Nerd";
   the Vergr profile is "Vergr". Anyone you call learns the name on your Google
   account, which you never chose to show them.
2. **It breaks the Vanguard identity mask.** A masked Vanguard persona placing a call
   would ship their real Google name and photo onto a document the other party reads.
   The mask is the identity boundary everywhere else in the app.
3. **It reaches the push notification too.** `functions/index.js:2963` builds the push
   from `c.callerName`, so the lock-screen notification also says "Verge Nerd is
   calling".

**Fix.** Make `ChatThreadScreen.jsx:2178-2179` match `CallsScreen.jsx:117-118`: read
the app profile, and do not fall back to the Auth record at all. Then give
`IncomingCallManager` the same live-lookup fallback `IncomingCallOverlay` already has,
so existing call docs render correctly too.

**Verify.** Call from a DM. The incoming screen, the push notification and the call
screen must all show the Vergr display name and the Vergr avatar. Repeat as a
Vanguard persona and confirm the mask holds.

---

## Call test, first attempt: the ring times out in 33.6 seconds

Placed a real video call, Vergr to Verion. The caller side is correct: it routes to
`/call/<convId>/video`, shows "Verion / Ringing…", a local self-view, a
`P2P ENCRYPTED` label, and mic / camera / hang-up / flip controls.

**Verion never showed an incoming-call UI**, but that is a timing artifact, not a
finding: the call doc records `createdAt 20:34:03.949Z` and `endedAt 20:34:37.594Z`,
so it **rang for 33.6 seconds and auto-ended** before I finished switching browsers.
Do not file "the callee never sees the call" on this evidence.

⚠ **Worth a founder decision:** 33.6s is a short ring. WhatsApp and Telegram ring for
about 45 to 60 seconds. Someone whose phone is in their pocket will miss calls that a
longer window would catch.

**Also learned, useful for the next attempt:** the call document id **is the
conversation id** (`calls/<convId>`), not a generated id, so there is exactly one call
doc per conversation and each new call overwrites the last. That means **call history
per conversation does not survive** and `declinedBy` / `endedAt` describe only the most
recent attempt. Worth confirming that is intended before building anything on
`calls`.

---

## A83. A 1:1 call never connects: the callee's answer SDP is never written (NEW, founder-reported)

**File:** `src/utils/webrtc.js:102-131` (`answerCall`)

Founder, answering a real video call from @Vergr on his phone: *"it says connection
failed, then blinks to the message list, then blinks back to the call, then back to
the message list, then the call dropped."*

**Read the call document straight afterwards:**

| Field | State |
|---|---|
| `offer` | **present** |
| `answer` | **ABSENT** |
| `status` | `ended` |
| `declinedBy` | absent (so it was not a decline) |
| `createdAt` → `endedAt` | 20:39:40.922Z → 20:40:02.956Z, **22 seconds** |
| `callerCandidates` / `calleeCandidates` | 0 / 0 (expected, this build bundles ICE in the SDP) |

So the caller published its offer, **the callee never published an answer**, and
therefore there was nothing to negotiate against. "Connection failed" is accurate:
the peer connection had no remote description to work with. `status: 'active'` is
only written on the same line as the answer (`webrtc.js:128-131`), so the call can
never leave "ringing" without it.

**A structural defect in that function regardless of the immediate cause:**

```js
const callSnap = await new Promise((resolve) => {
  const unsub = onSnapshot(doc(db, 'calls', callId), (snap) => {
    if (snap.data()?.offer) { unsub(); resolve(snap); }
  });
});
```

**This promise has no timeout and no reject path.** If the offer is not there, or the
snapshot channel stalls (the same `persistentLocalCache` stall already documented in
A15 and A51), `answerCall` hangs here forever, never reaches `createAnswer()`, and
never writes an answer. From the outside it is indistinguishable from a call that was
simply not answered. Add a timeout and surface a real error.

**Two candidate causes for THIS failure, not yet separated:**
1. `getUserMedia` failed on the callee, so `answerCall` was never called at all
   (it receives `localStream` as an argument, so the capture happens before it).
2. `answerCall` ran and hung on the untimed offer wait above.

Both produce exactly the observed document. **The next test is browser to browser on
current deployed code**, which removes the stale APK from the question entirely.

⚠ **The founder's staleness hypothesis is credible and must be tested, not assumed
either way.** His phone still shows the pre-A58 support avatar, which is direct
evidence that the APK predates the 2026-08-21 web deploy. But A82's underlying data
defect is present in current source, so at least part of what he saw is real today.

---

## A84. There is effectively no ringtone, and the file the code wants does not exist (NEW, founder-reported)

**Files:** `src/components/IncomingCallOverlay.jsx:80-92`, `public/sounds/`

Founder: *"There is also no ring tone or anything."*

The mounted overlay does try:

```js
const audio = new Audio('/sounds/ringtone.mp3');
audio.loop = true; audio.volume = 0.85;
audio.addEventListener('error', () => { audio.src = '/sounds/social.mp3'; audio.play().catch(() => {}); }, { once: true });
audio.play().catch(() => {});
```

**`/sounds/ringtone.mp3` does not exist.** `public/sounds/` contains exactly
`default.mp3`, `message.mp3`, `social.mp3` and `tournament.mp3`. So the primary source
always errors and every incoming call falls back to **`social.mp3`, a short
notification chime**, not a ringtone. The code's own comment admits the intent: "drop
a dedicated /sounds/ringtone.mp3 in to replace it".

**And even the fallback is likely silent**, because both `play()` calls are
`.catch(() => {})` against browsers' autoplay policy. The comment says as much:
"Browsers may block autoplay until the user has interacted with the page once". An
incoming call is precisely the case where there has been no gesture: the app is in the
background or freshly foregrounded.

**Also dead in this area:** `src/components/IncomingCallManager.jsx` has its own
ringtone (`:20`) and its own incoming UI, and **is imported nowhere**. Two
implementations of the same feature, one of them unreachable, which is how I
mis-attributed A82 on the first pass.

**Fix.** Ship a real looping `ringtone.mp3`. For the APK, do not rely on WebView audio
at all: play the ringtone from Kotlin on the FCM call notification, which is also the
only way it rings when the app is not foregrounded. Swallowing the `play()` rejection
into an empty catch should at least log, so a silent ring is diagnosable.

**Two more timers worth knowing about, both in the overlay:**
- `:55-57` the overlay only considers calls created within the last **30 seconds**.
- `:95-98` it auto-**declines** after **30 seconds**.

Together with the caller side ending at ~33.6s, the whole window is about half what
WhatsApp or Telegram give you.

---

## ⚠ AUDIT SCOPE GAP: everything so far is WEB. The founder is right to flag it.

*"I hope you aren't just auditing browser, the majority of users will come from the
mobile app."*

**Correct, and it is a real limitation of this audit, not a footnote.** Everything in
this document was driven in desktop Chrome, plus one narrow-window pass at 500px that
the founder produced by resizing the window by hand. **No finding here has been
executed inside the APK.**

What that does and does not mean, checked rather than assumed:

- **Many findings DO reach the APK**, because the native route re-exports the web
  screen. `NativeChatThreadScreen.jsx` is literally
  `export { default } from '../ChatThreadScreen'`, with a comment explaining the
  deliberate no-fork policy. So **A63, A64, A65, A82 and A83 are the same code on the
  phone.** `IncomingCallOverlay` is mounted globally in `AppRouter`, so A82 and A84
  reach it too.
- **Some findings are web-only by construction.** A71 (AdSense) never runs in the
  APK: `VergrAd.jsx` routes native builds to an AdMob native slot instead.
- **Some are native-only and completely uncovered here:** the Kotlin bridges (camera,
  billing, media cache, FCM), safe-area insets, the hotswap/OTA path, and anything
  gated on `IS_NATIVE_BUILD`.
- **Native screens that DO fork** are untested by me: `NativeMessageScreens.jsx`,
  `NativeWalletScreens.jsx`, the native squad screens and the native creator screens
  all have their own source.

⚠ **And a live variable that distorts any phone testing right now:** the installed
APK predates the 2026-08-21 web deploy, demonstrated by the support avatar (A58) still
being wrong on it. **Until a current build is on the device, a defect seen on the
phone cannot be attributed to current code**, and a defect NOT seen on the phone
proves nothing either.

**To actually cover the phone, one of these has to happen:** ship a build with the
current bundle and re-run this audit's messaging, calling and wallet paths on the
device, or give the audit a way to drive the APK (emulator with the debug bundle).
Reading Kotlin is not a substitute; the whole point of this document is that things
which look right in source fail in the artifact.

---

# Call test, resolved: web-to-web calling WORKS. The phone is the variable.

The founder called @Vergr from his phone (as Verion) and an auto-accepter running in
the @Vergr browser answered it. Full instrumented log:

```
21:14:01.704  Audio created src=/sounds/ringtone.mp3
21:14:01.727  OVERLAY seen
21:14:01.727  CLICK innerText="call"
21:14:01.779  Audio BLOCKED AbortError ringtone.mp3
21:14:01.973  Audio.play() called src=default.mp3
21:14:01.980  state=Connecting  url=/call/<convId>/voice
21:14:02.046  DOC ringing/answer=false
21:14:02.234  Audio.play() called src=social.mp3
21:14:02.364  Audio PLAYING default.mp3
21:14:02.843  DOC active/answer=true      <-- answer SDP written, 1.1s after accept
21:14:03.342  Audio PLAYING social.mp3
```

Then, live on screen: the voice-call UI with **"P2P ENCRYPTED"**, Verion's real avatar,
"Verion / @Verion", a green dot and a **running timer at 1:01**, with mic / hang-up /
speaker controls. Two `<audio>` elements, both `paused: false`, each carrying a live
`audio` track. **Zero console errors or unhandled rejections during the whole accept
path.**

## A83 does NOT reproduce on current web. Reclassified.

Voice calling works browser to browser, end to end, on the deployed build. The three
earlier failures each had a different, identifiable cause and **none of them was the
app**:

1. First attempt: I was too slow switching browsers, so it hit the ~33s auto-end.
2. Second attempt: my auto-accept selector matched on the exact text "Accept" and the
   button does not contain that string, so it auto-declined (`declinedBy` was set).
3. The founder's phone: still open, see below.

**So the failure he saw ("connection failed", bouncing between the call and the
message list, then dropping) is NOT reproducible on current web code.** The most
likely remaining explanation is his own: the installed APK predates the current
bundle, which is independently evidenced by that same phone still showing the pre-A58
support avatar.

⚠ **What stays true regardless**, and should still be fixed: `answerCall`
(`webrtc.js:106-111`) waits for the offer with `await new Promise(resolve => onSnapshot(...))`
and **no timeout and no reject path**. It did not bite here, but if the offer is
missing or the snapshot channel stalls it hangs forever, writes no answer, and is
indistinguishable from an unanswered call. That is exactly the shape of the founder's
report, and it is one `setTimeout` away from being diagnosable.

**Next step to close this properly: put a current build on the device and repeat.**
Until then a phone-side call failure cannot be attributed to current code.

## A82 CONFIRMED with harder evidence than the first case

The call document this time stored:

| Field | Value |
|---|---|
| `callerName` | **"Damien Ashton"** — the founder's real legal name, from the Google account |
| `callerAvatar` | `https://lh3.googleusercontent.com/a/ACg8ocK0jYl1t1JT…` |

against Verion's actual profile of `displayName: "Verion"` and a `cdn.vergr.app`
avatar. So a **pseudonymous account placing a call writes its owner's real name into a
document the other party reads.** That is a sharper demonstration than the "Verge
Nerd" case: the leak is not a nickname, it is a legal name.

**The in-app display was correct** ("Verion", `cdn.vergr.app/avatar/…jpeg`) because
`IncomingCallOverlay`'s live `getUser()` lookup overrides the stored value. **The push
notification does not have that luxury**: `functions/index.js:2963` builds it straight
from `c.callerName`, so the lock-screen notification says "Damien Ashton is calling".

Fix remains `ChatThreadScreen.jsx:2178-2179`: read the profile, never
`auth.currentUser`.

## A84 CONFIRMED mechanically, and it plays TWO sounds

`/sounds/ringtone.mp3` does not exist, so: the primary source aborts, the error
handler swaps in a fallback, and on this run **both `default.mp3` and `social.mp3`
ended up playing** (21:14:02.364 and 21:14:03.342). So an incoming call plays two
overlapping notification chimes rather than one looping ringtone. On the founder's
phone nothing audible played at all.

## A85. The Accept and Decline buttons have no accessible name (NEW)

**File:** `src/components/IncomingCallOverlay.jsx:305,314`

Enumerated every button in the incoming-call overlay:

```
"call_end", "call", "", "menu_open", "arrow_back", ...
```

**The Accept button's entire text content is the ligature `"call"`, and Decline's is
`"call_end"`.** The words "Accept" and "Decline" are sibling `<span>`s *outside* the
buttons, and neither button carries an `aria-label`.

Consequences:
- A screen reader announces the two most important controls in the app as "call" and
  "call end", which are the raw Material Symbols ligature names.
- Any automation, test or assistive tool that targets buttons by name cannot find
  them. It cost three attempts here, and the naive fallback (match a button whose text
  is `"call"`) matches the **outbound call button in the Messages header**, so a
  careless implementation would place a call instead of answering one.

**Fix.** `aria-label="Accept call"` and `aria-label="Decline call"`, or move the label
text inside the button. Then audit the rest of the app for icon-only buttons with no
label; the header call, edit and group-add buttons on `/messages` have the same shape
(`"call"`, `"edit_square"`, `"group_add"`).

## A48: half confirmed, half not

Hung up from the call screen with a 60ms transition logger running:

```
21:15:28.428  /call/<convId>/voice?role=callee   len371
21:15:42.168  /messages                          len535
```

- **The blank flash did NOT reproduce.** No sample recorded an empty body; it went
  straight from the call screen to the destination.
- **The wrong destination IS confirmed.** After a call with Verion it landed on
  **`/messages`**, the conversation list with the "CONNECT / choose a conversation"
  placeholder, rather than back in the Verion thread. You lose your place.

Fix is still the one in the original finding: route to `/messages/${chatId}`.

## Ring window, measured across three calls

| Call | created | ended | duration |
|---|---|---|---|
| 1 (video, unanswered) | 20:34:03.949Z | 20:34:37.594Z | 33.6s |
| 2 (video, unanswered) | 20:39:40.922Z | 20:40:02.956Z | 22.0s |
| 3 (voice, auto-declined) | 21:06:54.336Z | 21:07:27.309Z | 33.0s |

The overlay auto-declines at 30s (`IncomingCallOverlay.jsx:95-98`) and only considers
calls created within the last 30s (`:55-57`). About half the window WhatsApp or
Telegram give you, and worth a founder decision.

---

# Video call connected. A47 confirmed with exact numbers.

A real video call, Verion (founder's phone) to @Vergr (browser), answered by a
human-equivalent mouse click on Accept. **No auto-accepter** — that hack was removed
and the page reloaded clean before this run.

Connected state measured directly off the two `<video>` elements:

| | class | container | container AR | source | source AR | `object-fit` |
|---|---|---|---|---|---|---|
| **Remote** (the other person) | `w-full h-full object-cover` | 1523 x 714 | **2.132** | 640 x 360 | **1.778** | `cover` |
| **Self-view PiP** | `w-full h-full object-cover` | 95 x 137 | **0.693** | 1280 x 720 | **1.778** | `cover` |

Both are `object-cover` in source: `CallScreen.jsx:195` and `:212`.

## A47 CONFIRMED. The remote feed loses 16.6% of the picture.

The remote source is 16:9 (1.778) inside a 2.132 container. `object-cover` scales to
fill and discards the overflow. Computed on the live element:

```
box                    1523 x 714
source aspect          1.778
height needed to fill   857px
box height              714px
CROPPED                 142px  =  16.6% of the picture, ~71px off the top and ~71px off the bottom
```

So a sixth of the other person's frame is thrown away, and it is taken from the top
and bottom, which is exactly where a face sits when someone holds a phone or sits at
a desk.

## The self-view is far worse: about 61% of the width is cropped

A **1280x720 landscape** source is being poured into a **95x137 portrait** box, still
with `object-cover`:

```
box                     95 x 137
source aspect           1.778
width needed to fill    244px
box width                95px
CROPPED                 ~61% of the frame width
```

The PiP is portrait-shaped while every webcam it will ever receive is landscape. Even
with a correct fit rule the shape is wrong; with `object-cover` it keeps a narrow
vertical slice out of the middle of a wide frame.

**This is the rule the founder already set**, recorded in memory as
`feedback_video_fit`: *never crop the broadcaster preview, letterbox with a blurred
fill.* The call screen does the opposite on both surfaces.

**Fix.** `object-contain` on both, with a blurred, scaled copy of the same stream
behind it to fill the letterbox, which is the treatment the streaming screens already
use. And give the self-view PiP a 16:9 box rather than a portrait one.

**Verify.** On a connected video call the full frame must be visible on both the main
feed and the PiP, with bars or a blurred fill rather than a crop. Check with a
landscape webcam and a portrait phone camera.

## A48, second confirmation (video this time)

Ended the call with a 200ms transition logger running:

```
/call/<convId>/video?role=callee   v=2  len371
/messages                          v=0  len535
/messages                          v=0  len583
```

Same as the voice run: **no blank frame** at any sample, and it lands on
**`/messages`**, the conversation list, not back in the Verion thread. The blank-flash
half of A48 has now failed to reproduce twice; the wrong-destination half is confirmed
twice.

## Checked and CORRECT, recorded so it is not filed as a bug

**The call controls auto-hide, and that is intended and works.** My first click at the
hang-up coordinates appeared to do nothing, which looked like a dead button. It is
not: `CallScreen.jsx:136` hides the controls after **4 seconds**, and `:187`
(`onClick={() => isVideo && setShowControls(true)}`) brings them back on any click on
the surface. So it is a normal two-tap interaction, first tap reveals, second tap
acts. Verified after the first click that the hang-up button was present at
`opacity: 1`.

## Method note for the next session: how to answer a call without automating it

The 30-second ring plus turn latency makes this awkward, and the wrong solution
(leaving an auto-accepter armed in a live app) is not acceptable: it would answer a
real user's call. What works:

1. Start a **read-only** watch that blocks inside one tool call for ~26s, polling every
   150ms, and **returns the moment the overlay appears** with the Accept button's
   coordinates. It clicks nothing.
2. Bail out immediately if the overlay is **already** up when the watch starts
   (`STALE_ALREADY_RINGING`), because that ring is already part-spent. This is what
   went wrong on the first video attempt: the watch returned in 2ms on a ring that had
   been going ~28s, and the click landed after the auto-decline.
3. Click Accept with a real mouse click at the returned coordinates.
4. Re-enter the watch if it times out.

⚠ **Never match the Accept button by text.** Its accessible name is the bare ligature
`"call"` (A85), and the naive fallback of "a button whose text is `call`" matches the
**outbound call button in the Messages header**, which would place a call instead of
answering one. Scope any selector to the overlay by its `ENCRYPTED P2P CALL` banner.

---

## A86. Calls are never shown in the conversation thread, even though every field needed is already stored (NEW, founder-spotted)

Founder: *"there is no call logs in the chat thread for Vergr or Verion. WhatsApp
shows call times or missed call in the chat thread as well as under calls."*

**Confirmed, and it is purely a rendering gap. The data is complete.**

`calls_history` already carries everything, verified by reading 21 rows over REST.
Today's calls, exactly as recorded:

| started | type | answered | durationSec |
|---|---|---|---|
| 21:22:04 | video | **true** | **139** |
| 21:20:18 | video | false | 0 |
| 21:14:00 | voice | **true** | **97** |
| 21:12:22 | voice | false | 0 |
| 21:09:47 | voice | false | 0 |
| 21:06:54 | voice | false | 0 |
| 20:39:40 | video | false | 0 |

Every row has `chatId`, `callerId`, `participants`, `type`, `answered`,
`durationSec`, `startedAtMs`, `endedAt`. **`chatId` is the link back to the
conversation, and it is already populated.**

**The `/calls` screen renders it correctly and looks good:** per-row avatar, name,
direction and type ("incoming · video", "outgoing · video", "missed · voice"), the
duration ("2:19", "1:37"), relative time, and missed calls in red. That is
essentially the WhatsApp Calls tab.

**The conversation thread shows nothing.** Five calls were placed in the Vergr /
Verion DM today, two of them answered and lasting 2:19 and 1:37, and the thread
contains no trace of any of them. Nothing writes a call event into the conversation:
grepping for a call-type message or a `conversations` write on call end returns
nothing, and `logCallEnd` writes only to `calls_history`.

So Vergr has the Calls tab half of what WhatsApp does and none of the in-thread half.
In practice that means opening a chat gives you no idea you spoke to that person for
two minutes ten minutes ago, and a missed call is invisible in the place you are most
likely to look.

**Fix.** On call end, emit a system message into the conversation the same way
"X renamed the group" already appears (that pattern exists, it is visible in the
Vergr Update Logs group). It needs no new data: `chatId`, `type`, `answered` and
`durationSec` are all on the `calls_history` row. Render it as a call bubble with a
tap target to call back, missed ones in red, matching the Calls tab's own vocabulary.

**Two smaller things noticed on `/calls` while verifying:**
- **A missed call shows a duration of `0`.** WhatsApp shows no duration for a missed
  call. Printing "0" reads like a bug.
- **The list took about 16 seconds to appear**, sitting on a spinner. `getCallHistory`
  fetches the whole collection with no `limit` on the query and sorts client-side
  (`firestore.js:1558-1565`), so it will get worse with every call ever made. Add an
  `orderBy('startedAtMs','desc')` and a server-side `limit`.

**Verify.** Make a call, answer it, hang up. The thread must show a call entry with
the duration. Miss one and the thread must show a missed-call entry in red. Both must
agree with the `/calls` tab.

---

## A88. The Calls screen's right panel drifts below the fold and gets clipped (NEW, founder-spotted from a screenshot)

**File:** `src/screens/calls/CallsScreen.jsx:303` (the shell) and `:251` (the panel)

Founder's screenshot of `/calls` on his window: the phone icon and action cards sit
near the **bottom** of the screen, **"Send Call Link" is cut in half by the viewport
edge and "Schedule a Call" is not visible at all.**

**Measured live and the cause is exact.** The panel is:

```jsx
// :251
<div className="flex flex-col items-center justify-center h-full px-8 text-center">
```

`justify-center` inside `h-full`, so it centres within its PARENT's height. Walking
the ancestors in the live DOM:

| level | classes | height | overflow-y |
|---|---|---|---|
| 0 | `flex flex-col items-center justify-center h-full px-8` | **1345px** | visible |
| 1 | `flex-1 bg-bg-dark` | **1345px** | visible |
| 2 | `min-h-screen flex` | **1345px** | visible |
| 3 | `flex-1 min-h-screen border-x …` | **1345px** | visible |

**Viewport height: 714px. Every ancestor is 1345px.**

The shell at `:303` is `min-h-screen flex` with **no bounded height and no
`overflow-hidden`**, and the left column holds the full call list. So the flex row
stretches to the tallest child (the list), the right column stretches with it, and the
"centred" panel is centred in 1345px rather than 714px. Its centre lands at ~672px,
which is why the cards start near the bottom edge on my window and fall off it
entirely on the founder's taller one.

**It gets worse the more calls exist**, because the list is what sets the height. It
will keep sliding down forever.

**Fix.** Make the shell viewport-bounded and give each column its own scroll, which is
the standard master-detail pattern the Messages screen already uses (its `<main>` is
`clientHeight 658` with `scrollHeight 5152`, i.e. correctly bounded):

```jsx
// :303
<div className="h-screen flex overflow-hidden">
  <div className="w-[380px] … flex flex-col overflow-hidden"> {leftPanel} </div>
  <div className="flex-1 bg-bg-dark overflow-y-auto"> {rightContent} </div>
</div>
```

`:206` already has `flex-1 … overflow-y-auto` on the list body, so once the shell
stops growing, the list will scroll inside its own column as intended.

⚠ **Check `MessagesInboxScreen.jsx` too.** It is the only other file using
`items-center justify-center h-full` for a right panel, so it may have the same shell
problem on a long conversation list.

**Verify.** Open `/calls` on a tall window with a long call history. The phone icon
and all three cards (Start a Call, Send Call Link, Schedule a Call) must be visible
without scrolling, and must stay put as the call list grows.

**Note on how this was found:** I looked at the call screen's video elements and
measured them, and never looked at the interface around them. The founder caught it
from a screenshot. Worth remembering: measuring the thing you came to measure is not
the same as looking at the screen.

---

# SCREEN PASS: Calls + Call (2026-08-22). Scope now includes UI, design, UX and security, and every finding below was FIXED, BUILT and DEPLOYED in the same session.

Founder instruction that changed the method: *"from now on you will fix things as you
are auditing, and not leave things behind"*, plus *"add UI, design, UX, and security to
your audit scope, and we will go one screen at a time"*, and include the mobile app.

## A88. Calls right panel drifts below the fold ✅ FIXED + DEPLOYED

**File:** `src/screens/calls/CallsScreen.jsx:303` (shell), `:251` (panel)

Founder spotted it from a screenshot: "Send Call Link" cut in half, "Schedule a Call"
not visible.

The panel was `flex flex-col items-center justify-center h-full`, so it centred inside
its PARENT. The shell was `min-h-screen flex` with no bounded height and no
`overflow-hidden`, and the left column holds the whole call list, so the flex row
stretched to the list. Measured: **every ancestor 1345px in a 714px viewport.** The
"centred" panel centred in 1345px, putting its middle at ~672px. **It got worse with
every call ever made**, because the list set the height.

**Fix.** Shell is now `h-screen flex overflow-hidden`, left column `overflow-hidden`,
right column `overflow-y-auto`. The panel is `min-h-full ... py-10` rather than
`h-full`, so if the viewport is ever shorter than the content it grows and scrolls
instead of clipping the top (the classic `justify-center` overflow trap).
`flex-1` on the list body gained `min-h-0`, without which a flex child will not shrink
below its content and the scroller never engages.

**Verified live at 1386x732:** all four ancestors now 732px, exactly the viewport.
Start a Call 280-343, Send Call Link 353-416, Schedule a Call 427-489, all fully on
screen. No horizontal scroll.

## A89. Missed calls rendered a literal "0" duration ✅ FIXED + DEPLOYED

**File:** `src/screens/calls/CallsScreen.jsx:239`

Every missed row showed a `0` under the timestamp. Cause was JSX falsy rendering:

```jsx
{call.duration && <p ...>{...}</p>}
```

With `duration === 0` that expression evaluates to `0`, and React renders the number
`0` rather than nothing. Now `{call.duration > 0 && !isMissed && ...}`.

**Verified live:** zero `0` rows; answered calls still show 0:50 and 1:37.

## A90. Call list took 13.3s to appear — two separate causes ✅ FIXED + DEPLOYED

**Files:** `src/firebase/firestore.js` (`getCallHistory`), `CallsScreen.jsx:68-90`

**Cause 1, unbounded query.** `getCallHistory` fetched EVERY `calls_history` row the
user had ever been part of, with no `orderBy` and no `limit`, then sorted and sliced
client-side. It got slower with every call ever made. Now `orderBy('startedAtMs','desc')`
+ `limit(max)` server-side, with the composite index
`calls_history(participants array-contains, startedAtMs desc)` added to
`firestore.indexes.json` and deployed. A fallback to the old client-sort path is kept
so the list stays populated if the index is ever missing, rather than going blank.

**Cause 2, an N+1 that fetched the same document 20 times.** The row loop did
`await getUser(otherId)` INSIDE a `for`, so 20 rows meant 20 sequential round trips.
In a 1:1 call log every row is the same person, so it was refetching one document
twenty times in series. Favourites had the same shape. Now the uids are deduped with a
`Set` and resolved in one `Promise.all`; favourites likewise. `setLoading(false)` also
moved to immediately after the list is set, so the list no longer waits on the
favourites rail, which renders in its own section on its own state.

**Measured, cold load, from navigationStart:** **13,331ms → 4,785ms**, of which 2,615ms
is DOMContentLoaded. So the data layer went from ~10.7s to ~2.2s.

## A91. ⚠ Crossing the mobile/desktop breakpoint KILLED a live call ✅ FIXED + DEPLOYED

**Files:** `src/router/AppRouter.jsx:996`, `src/components/ResponsiveLayout.jsx`

This is the most serious thing found on these screens, and it was found by accident
while checking the mobile layout **during a live video call**.

`ResponsiveLayout` has **five separate `return (` branches** keyed on
`isDesktop` / `isTablet` / mobile. React reconciles by position in the tree, so when the
branch changes the whole returned structure is different and `{children}` — the routed
`CallScreen` — is unmounted and remounted. That tears down the `RTCPeerConnection`.

**Reproduced deliberately, both directions:**

| step | timer | remote tracks | remote videoWidth |
|---|---|---|---|
| connected, 1386px | 2:08 | flowing | 1280 |
| resize to 658px | **0:02** | audio:MUTED, video:MUTED | **0** |
| back to 1386px | 1:21 -> **0:02** | audio:MUTED, video:MUTED | **0** |

The `calls/{id}` doc was written at **09:36:43**, the exact second of the resize, and
still read `status: 'active'` with both offer and answer present. So the call **looked
connected — timer running, status active — while no media flowed at all.**

Two things make it worse:
- The call doc id is the CONVERSATION id (`createTime: 2026-03-23` on a doc still in
  use today), so a remount writes a fresh offer into the SAME doc the other side is
  already using. There is no clean renegotiation path.
- This is the same signature as **A83** ("calls never connect"). Anything that changes
  the viewport across the breakpoint — a foldable, split-screen, a tablet rotation —
  can produce a dead-but-alive call.

**Fix.** `/call/:chatId/:callType` and `/group-call/:callId` moved OUT of the
`MainLayout` block into their own standalone `ProtectedRoute` entries, the same pattern
the wallet already uses. These screens are `fixed inset-0 z-[100]` and never used the
shell's chrome. Routes were moved, not removed.

⚠ **The underlying ResponsiveLayout remount hazard still exists for every other
screen.** Moving the call routes protects the one place where a remount destroys live
state. Any future screen holding a live connection, a recorder or an upload must not be
mounted inside that shell either. Worth a dedicated fix.

## A92. 15 nav controls stayed keyboard-focusable behind the call overlay ✅ FIXED

Measured during a live call: `shellFocusableCount: 15` — the VERGR logo, Home, Explore,
Shorts, Community, Watch, You, the squad row, the profile card, Profile, Settings and
the notifications bell were all still in the DOM and focusable underneath the
full-screen call. Tab then Enter during a call would navigate away mid-conversation.
Screen readers announced the whole sidebar over the call.

Fixed by the same route move as A91. **Verified live: `shellFocusableCount: 0`.**

## A93. Call screen typography: the person you are calling was smaller than a nav label ✅ FIXED

**File:** `src/screens/messages/CallScreen.jsx:246-251`

Measured on a live call at 1386px wide:

| element | was | now |
|---|---|---|
| callee name | **12.25px** | 17.5px (`text-lg md:text-xl`, syne, truncate) |
| call timer | 10.5px, white 60% | 12.25px, white 70%, tabular-nums |
| "P2P ENCRYPTED" | **8px, white 30%** | 11px, white 70%, + green lock icon |

The sidebar's own "Home" label is 13px, so **the person you were on a call with rendered
smaller than a nav item.** WhatsApp desktop uses ~19-20px there. Separately, the only
trust signal on the screen was 8px at 30% opacity, i.e. effectively invisible — a
security-communication problem, not just a design one.

## A94. Mobile: the "Calls" header and the new-call button were rendered TWICE ✅ FIXED

**File:** `src/screens/calls/CallsScreen.jsx:146`

On mobile the screen renders a `TopBar title="Calls"` with an `add_call` action, and
then `{leftPanel}`, whose own first child is another "Calls" heading with another
identical `add_call` button. Two identical titles and two identical buttons stacked.

Measured before: `dupTitles: 2, addCallBtns: 2`. After: **1 and 1.**

The panel header exists for the desktop master-detail column, which has no TopBar, so
it is now `{isDesktop && ...}`.

## Checked and CLEAN, recorded so it is not re-audited

- **Firestore rules for both call collections are correctly participant-scoped.**
  `calls_history` allows read/create/update only when the caller is in `participants`,
  `delete: if false`. `calls` gates `get` AND `list` on the same condition, with a
  comment explaining why `list` cannot be denied outright (the incoming-call
  subscription is a list query). No enumeration path. Nothing to fix.
- Mobile tap targets on the call rows are 58px, above the 44px minimum.
- No horizontal overflow at either width.
- The call controls are NOT clipped at the bottom (bottom 697 in a 732 viewport). What
  looked like clipping in a screenshot was the Claude extension's own toast overlapping
  them, i.e. my tooling, not the app.

## Still OPEN on these screens

- **A48 (wrong destination) reconfirmed twice more.** An outgoing call that rings out
  lands on `/messages`, not on `/calls` where it was started. Both unanswered calls
  today ended at `/messages`.
- **A86 (no call entries in the conversation thread) is unchanged.** Still purely a
  rendering gap; `chatId`, `type`, `answered` and `durationSec` are all already on the
  `calls_history` row.
- **"Schedule a Call"** is a full-size action card that only fires a "coming soon"
  toast. It reads as a live feature. Needs a visible disabled/soon treatment rather
  than looking identical to the two working cards. NOT changed, because that is a
  product call and the hard rule forbids removing an entry point.

## Method notes

- **Window resizing floors at ~658 CSS px** in this Chrome, so it exercises the mobile
  code branch but is NOT true phone width (390px). Real phone-width verification needs
  device emulation or the APK. Do not claim "tested at phone width" from a resize.
- **`resize_window` DOES work** (an earlier session note calling it a no-op was wrong).
  It can take effect only after the next navigation settles, and it reports success
  while a window is minimised even though `innerWidth` stays 0.
- **Do not block the page for 25s+ inside one `javascript_tool` call.** The CDP
  `Runtime.evaluate` cap is 45s and a long blocking promise returns
  "renderer may be frozen", losing the result even though the page is fine. Two
  incoming-call detections were lost this way. Poll in <=20s slices, or attach a
  `MutationObserver` and read it with short calls.
- **A backgrounded tab throttles `setInterval` to as slow as once a minute.**
  `document.hidden` was true the whole time the founder was placing calls from the other
  window. `MutationObserver` is not throttled and is the correct detector.

---

# SCREEN PASS: chat call log + Squads (2026-08-22). All FIXED, BUILT, DEPLOYED.

## A86. Calls now appear in the conversation thread ✅ FIXED + DEPLOYED

Founder: *"if Verion calls Vergr, whether it be missed or answered, the call should
still show in their chat thread, like it does on WhatsApp. I want that now."*

**Built as a RENDER-TIME MERGE, not as a message written on hang-up.** The obvious
implementation is for `logCallEnd` to also post a chat message, and it is the wrong one:

| written on hang-up | merged at render (chosen) |
|---|---|
| both sides run `handleEnd`, so it needs a dedupe scheme or a "only the caller writes" rule | one source of truth, no writes at all |
| rides the relay (`chatRelayEnabled` is true), so it is the fragile messaging path | no relay involvement |
| only works for FUTURE calls | **every past call appears immediately** |
| thread and Calls tab can drift | they cannot disagree, both read `calls_history` |

New `subscribeCallsForChat(chatId, cb)` in `firestore.js` (live `onSnapshot`, so a call
that just ended appears without a reload) plus a `CallRow` component and a merge step in
`ChatThreadScreen`.

⚠ **The `participants array-contains` clause in that query is NOT redundant** with
`chatId ==`. `firestore.rules` gates `calls_history` LIST on the caller being in
`participants`, and rules are evaluated against the QUERY, so dropping it rejects the
whole subscription. New composite index
`calls_history(participants array-contains, chatId ==, startedAtMs desc)`, deployed.

**Day separators are rebuilt after the merge.** They are inserted by `UseMessages` from
the message array alone, so a call landing on a day with no messages would have sat under
the previous day's heading.

**The row renders** an icon (red for missed), a label, a direction arrow, the time and the
duration, and tapping it calls back with the SAME media type. Labels distinguish the two
unanswered cases, which the Calls tab conflates: a call you RECEIVED and did not answer is
"Missed …call" in red; one you PLACED that rang out is a neutral "No answer".

**Verified live**: `Missed voice call`, `Incoming voice call · 11:14 PM · 1:37`,
`Outgoing video call · 11:33 AM · 0:50`, under correct YESTERDAY/TODAY separators.

### ⚠ It crashed the whole thread first. TDZ, exactly as the memory warns.

The first version put the `useState` + `useEffect` at line ~882, but `chatInfo` is
declared at line 915 and the effect's DEPENDENCY ARRAY reads `chatInfo?.isGroup`.
Dependency arrays are evaluated during render, so this threw
`Cannot access 'chatInfo' before initialization` on every mount and the error boundary
showed "Something went wrong". **`npm run build` passes** — it is a runtime error.

This is [[reference-usecallback-dep-tdz]] happening again. The lesson worth keeping: when
adding a hook to a large component, the dependency array is a READ, so the hook must sit
below every identifier it names. A comment marking this now sits on the effect.

## A82. Incoming calls showed a bare "V" ✅ FIXED + DEPLOYED

`ChatThreadScreen.startCall` wrote
`callerName: auth.currentUser.displayName || profile?.displayName`. The Firebase Auth
record's `displayName` is whatever the auth provider last set, often a single initial or a
stale Google name, and it WINS that expression whenever it is non-empty. `CallsScreen` has
always used `profile?.displayName`. Both now use the Vergr profile, which is the identity
the rest of the app shows.

---

# SQUADS

Founder: *"the entire screen is scrollable even the header … the text input area is not on
the screen when the page loads and it also scrolls with the screen so this isn't actually
a functional chat … on the mobile app even when scrolled to the bottom it is under the
phones native nav area."*

All confirmed by measurement. **One root cause for the scrolling half.**

## A95. The squad shell was taller than the viewport, so the DOCUMENT scrolled ✅ FIXED

**File:** `src/styles/squad.css`, `.sqd` / `.sqd .app`

The markup is:

```
<div class="sqd">          ← no height constraint
  <div class="sqd-mtop">   ← ~56px, mobile only, position:sticky
  <div class="app">        ← height:100vh
```

`.sqd-mtop` is a SIBLING sitting ABOVE a full-viewport `.app`, so the page was always
mtop-taller than the screen. **Measured: 786px of document in a 730px viewport, a 56px
overflow that is exactly the top bar's height.**

The consequence is not cosmetic. Because the DOCUMENT became the scroller, the chat's own
`.messages` list — which is already a correct `flex:1; overflow-y:auto; min-height:0` —
never got a bounded parent, so it never scrolled. The channel header scrolled away and the
composer went with it. Measured before the fix: **the only scrollers on the page were
`HTML`, `BODY` and a bare `DIV`, all `overflow: visible`.**

**Fix.** `.sqd` becomes a fixed-height flex column, `.sqd-mtop` is `flex:0 0 auto`, `.app`
is `flex:1 1 auto; min-height:0`. This bounds `.app` WITHOUT hardcoding the top bar's
height, so it stays correct as the safe-area inset changes.

⚠ **`100dvh`, not `100vh`.** On mobile browsers `100vh` is the LARGEST viewport (URL bar
hidden), which reintroduces the identical overflow whenever the bar is showing.

**Verified live at 658x730:** page no longer scrolls, document is exactly 730px, and the
ONLY scroller is `SECTION.messages`. Header pinned at 55, composer at 667-700.

This one fix also resolved the squad OVERVIEW screen on the web.

## A96. The composer was hidden behind the phone's navigation bar ✅ FIXED

`.vergr-native .sqd .channel-header` already added `env(safe-area-inset-top)`. There was no
equivalent at the bottom, so on the APK the send button and the whole tool row sat under
the gesture bar. Added
`.vergr-native .sqd .composer{padding-bottom:calc(env(safe-area-inset-bottom,0px) + 18px)}`.

## A97. The composer had FOURTEEN controls at rest ✅ REDESIGNED

Founder: *"the text input area is way too busy and needs a major redesign, that is horrible
UI and UX."* Counted from source, visible at rest:

- format bar: bold, italic, strike, code, spoiler, + a `Markdown · ||spoiler||` hint
- attach row: image, locked media, event
- tools: GIF, emoji, poll, 1:1 session, event, mic
- send

**Two of them did nearly the same thing under nearly the same label**: a
`confirmation_number` button titled "Share an event" and an `emoji_events` button titled
"Share event".

**Now four at rest**: attach, input, emoji, and send-or-record. **Nothing was removed.**
Everything moved into a labelled "+" sheet, and the format bar is behind an "Aa" toggle.

The real fix is not the count, it is that **every action now has a NAME**. Six unlabelled
glyphs in a row is not something anyone can read. The two event actions are now
"Ticketed event / Share an event with tickets" and "My events / One you host or joined".

Send and mic SWAP on whether there is text (WhatsApp behaviour), so there is one
unambiguous primary action rather than two competing round buttons.

**Verified live: 4 visible controls** (`Attach`, `Formatting`, `Emoji`, `Hold to record`).

## A98. The native squad chrome was a different component from the web ✅ FIXED (needs the APK)

Founder: *"on the squad overview screen on the mobile app the header doesnt match the
browser version, and the hamburger menu is for some reason at the bottom of the page?"*

Both complaints, one cause. Every squad route is
`IS_NATIVE_BUILD ? <NativeX/> : <X/>`, and the native screens use
`NativeSquadScaffold`, **not** `SquadShell`. That scaffold rendered a generic `<TopBar/>`
(hence a different header) plus a `sqd-native-fab` — a floating hamburger pinned to the
bottom of the screen.

That FAB is the exact antipattern `SquadShell`'s own comment says it removed:

> *"Nav belongs at the top of the screen, not floating over the content. This replaces a
> fixed FAB that hovered above the page: a floating hamburger is a phone antipattern, it
> covered whatever was underneath it, and it put the primary navigation somewhere no one
> looks for it."*

The web got that change. The native scaffold never did.

**Fix.** `NativeSquadScaffold` now renders the SAME `.sqd-mtop` markup as the web shell
(back, title, menu at top right), and its container is `flex:1 1 auto; min-height:0`
instead of `minHeight:100vh` — which does not bound a flex column at all, so the document
scrolled there too. The nav sheet is unchanged; only where you open it moved.

⚠ **`flex:1`, deliberately NOT another `100dvh`.** `.sqd` is itself the bounded column and
`.sqd-mtop` is a sibling of this element, so a second full-viewport height would recreate
A95 inside the native scaffold.

⚠ **The mobile rules are keyed on `@media (max-width:1100px)` and the native WebView has
been observed reporting ~980px.** Since `NativeSquadScaffold` renders no desktop rail at
all, a native WebView wider than 1100px would lose its ONLY navigation. The shell
behaviour is now also pinned to `.vergr-native` directly rather than trusting a reported
width.

✅ Useful: **`NativeSquadChatThreadScreen` is `export { default } from
'../SquadChatThreadScreen'`**, a pure re-export, so A95/A96/A97 all reach the APK with no
native-side work.

🔴 **A98 is SOURCE ONLY until an APK ships.** Bumped to 1.0.203.

## Still OPEN on squads

- Squads are slated to become "like Telegram channels" (founder). Not started; that is a
  product change, not a fix, and needs its own scope.
- The squad chat screen is 1,584 lines with inline styles throughout, mixing `.sqd` CSS
  classes and style objects. Not a bug, but it is why layout faults there are hard to see.

---

# SCREEN PASS: Messages (2026-08-22)

## A99. ⚠ SECURITY: any signed-in user could write a message into any conversation ✅ FIXED + DEPLOYED + VERIFIED LIVE

**File:** `firestore.rules`, `conversations/{convoId}/messages` create rule (~line 1029)

The create rule was:

```
allow create: if isAuth() && request.resource.data.senderId == request.auth.uid;
```

Owning `senderId` proves who you are, not that you belong in the thread. **Read, update
and delete on the same subcollection all check `uid in conversations/$(convoId).participants`;
create did not.** So any authenticated account could POST a message into any DM or group on
the platform.

It is trivially targetable, by this same rules file's own comment 120 lines up (the
`conversations` get rule): a DM id is "the two uids sorted and joined with '_'" and uids
are enumerable because `/users` is world-read. So this bypassed blocks, the privacy-tier
gate in `createConversation`, the message-request toggle and the stranger-media gate,
none of which are enforced at the rules layer — they are all client-side in `firestore.js`,
and a direct REST write skips every one of them.

The squad-message create rule (line ~447) has always required `isSquadMember`, so this was
an oversight, not a deliberate asymmetry.

**Fix.** Added the participant check to create, matching read/update/delete:

```
allow create: if isAuth()
  && request.resource.data.senderId == request.auth.uid
  && request.auth.uid in get(/databases/$(database)/documents/conversations/$(convoId)).data.participants;
```

**Safe against first-message races:** `sendMessage` only `batch.update()`s the conversation
(never creates it), and `createConversation` awaits its `setDoc` separately before any
message is written, so the parent doc always exists and the added `get()` cannot spuriously
fail. Cost is one get() per message CREATE; read/update/delete already pay the same get(),
and creates are far rarer than reads.

**Verified live over REST with a real token:**
- Write into a conversation I am NOT a participant of → **403 DENIED**.
- Write into my own Verion DM → **200 ALLOWED** (probe deleted afterward).

## Checked and CLEAN, recorded so it is not re-audited

- **Desktop inbox** (`/messages`): no page scroll, docH = viewport, the `justify-center
  h-full` empty-state panel is safe here because this shell IS bounded (unlike the Calls
  shell in A88).
- **Mobile inbox**: the document scrolls (docH 926 in a 730 viewport), but this is CORRECT
  — measured at scrollY 196 the title (13-39), search box (52-89) and All/Unread/DMs/Groups
  tabs (107-126) all held position, i.e. the header is sticky and the bottom nav is fixed.
  Not the squad bug. Left as-is.
- **DM thread on mobile**: correct. No page scroll, single scroller
  `MAIN.flex-1 overflow-y-auto` (620 visible / 6361 total), composer pinned at 682-722,
  no horizontal overflow. The DM composer already carries
  `calc(8px + env(safe-area-inset-bottom, 0px))`, so it is not hidden behind the phone nav
  bar the way the SQUAD composer was (A96). There are two chat implementations; only the
  squad one had the layout faults.
- **conversations get/list/create rules**: participant-scoped, with group-preview
  exceptions for the invite landing page and support threads explicitly excluded. Already
  hardened in a prior pass (comment dated 2026-08-18). No gap.

## Method note

Firestore rules are enforced against the QUERY/WRITE, and the client SDK path
(`firestore.js`) enforces privacy/blocks/requests BEFORE it writes — but a direct REST
call skips all of that, so the rules layer is the only real boundary. Any privacy control
that exists ONLY in `firestore.js` is advisory. Worth a dedicated sweep: which client-side
gates (block list, msg-request tier, stranger-media) have NO rules-layer backstop.

---

# SCREEN PASS: DM send-location + send-coins (2026-08-22, founder-requested)

Tested live from the Vergr account into the Verion DM: the location flow and the
send-coins flow, both the in-thread UI and the notification.

## COINS

### A103. Sending coins from a DM left NO record in the thread ✅ FIXED + DEPLOYED + VERIFIED LIVE

Tipped Verion 50 coins from the DM. It WORKED (balance 224 → 174, green toast
"Tipped 50 coins to Verion") but **nothing appeared in the conversation.** WhatsApp/
Telegram show a payment in-thread; here the send vanished into a toast.

Cause: `SendCoinsModal` calls `sendCoins` (→ `sendTip` callable) and closes. It never
posts a chat message, even though the message renderer already has
`case 'wallet': "💸 Sent X coins"`. The renderer was dead for this flow. `SendCoinsModal`
is shared by profile/stream/DM, so it took no chat context.

**Fix.** Added an optional `onSent(amount)` prop to `SendCoinsModal`, called after a
successful send. `ChatThreadScreen` passes
`onSent={(amt) => sendMsg({ type:'wallet', text:'💸 Sent N coins', wallet:{amount} })}`.
Profile and stream tips pass no `onSent`, so they are unaffected — only a DM tip posts a
bubble. The amount rides in `text` because the relay only forwards `text`+`type` (see
A102), and the `wallet` renderer falls back to `m.text`.

**Verified live:** a second 50-coin tip produced a "💸 Sent 50 coins" bubble in the
thread AND updated the inbox preview to "Sent 50 coins · just now". Balance moved
174 → 124.

### A104. Tips never pushed a notification ✅ FIXED + DEPLOYED (founder can veto)

`sendTip` writes a `notifications` doc (`type:'tip'`, "You received a tip!", "Someone
tipped you 50 coins, you earned $X"). But it does **no inline push**, and `'tip'` was
**not** in `PUSHABLE_NOTIFICATION_TYPES` — a Set that was 100% dead TOURNAMENT types plus
`cheat_signatures_stale` and `admin_test_notification`. So getting paid produced only an
in-drawer entry, never a push. For a creator, getting tipped is the single most
push-worthy event.

**Fix.** Added `'tip'` to `PUSHABLE_NOTIFICATION_TYPES`, deployed `onNotificationCreated`.
Flagged in a comment so it is one line to revert if tips should not push.

⚠ The push allowlist being all-tournament is a broader smell: the live product (tips,
DMs, memberships, unlocks) is under-represented and the dead product dominates it. Worth
a full review of that Set against what the app actually writes.

### A105. Notification says "Someone tipped you", not the sender's name — FLAGGED, not changed

`sendTip` body is `Someone tipped you ${amount} coins…`. WhatsApp/most platforms name the
sender. This could be a deliberate privacy choice (keep tippers semi-anonymous), so it is
a founder call, not a unilateral change. If it should name the sender, `sendTip` already
has the sender `uid` and can read the display name inside the transaction.

### A106. Default tip amount is 500 coins — FLAGGED (minor)

`SendCoinsModal` defaults `amount` to 500 (~$5.80 at the coin floor). That is a steep
pre-selected default for a one-tap Send. 50 or 100 is a safer default; 500 invites
accidental large sends. Not changed (product call).

### Verified CLEAN
- Notifications are recipient-scoped: reading Verion's tip notifications from the Vergr
  account returned 403. The security boundary holds.
- The send-coins sheet copy is honest: "Vergr pays the creator their revenue share
  50-80%", "goes straight to them". No fee shown at send time, matching the model.

## LOCATION

### A100. ⚠ "Choose on Map" is BROKEN and would be PAID — needs a free replacement

`LocationPickerModal` loads the **Google Maps JavaScript API**
(`maps.googleapis.com/maps/api/js?key=${apiKey}`) with
`apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}`. That var is **undefined**: `.env`
only has `REACT_APP_GOOGLE_MAPS_API_KEY=your_google_maps_api_key` — a placeholder, under
the CRA prefix Vite ignores. So the script loads with `key=undefined`, and opening
"Choose on Map" hung the renderer (screenshot timed out).

Two problems, not one:
1. It is broken today (no key).
2. **Google Maps JS API is a paid, billing-required service.** Adding a key spends money,
   which violates the zero-cost rule. So fixing the key is the WRONG fix.

**Recommended free fix (needs a founder nod on approach, since it swaps a provider):**
replace the Google Maps picker with **Leaflet + OpenStreetMap tiles** (no key, free), and
reverse-geocode via **Nominatim** (free, has a usage policy). Do NOT add a Google Maps
key. Feature stays, cost stays zero. Not built yet — it is a provider swap with a design
surface, so flagging rather than doing it unprompted.

### A101 / A102. The location bubble is raw coordinates and is NOT tappable

Sent "Current Location" (geolocation stubbed to a fixed coord for a deterministic test).
The bubble reads **"📍 Current location: 40.758, -73.9855"** — raw lat/lng, no place name,
no map thumbnail. WhatsApp/Telegram show an address and a static map image.

Worse: the bubble has **no anchor at all** — it is not tappable. The renderer wraps
location in `<a href={maps-url}>` built from `m.location.lat/lng`, but the **relay only
forwards `text` + `type`, not the structured `location` object**, so the coordinates never
reach the renderer and no working link is produced. So "share location" currently yields a
dead line of numbers.

The free correct version: reverse-geocode the current location to an address (free
Nominatim), and render a plain `google.com/maps/search/?q=lat,lng` **link** (the link
itself needs no API key and is free) — carrying lat/lng in the message so the anchor
builds. A static map thumbnail is a nice-to-have (free OSM static-map services exist,
rate-limited).

### Minor: disclosure copy says "VERGR"
The "Share your location" prominent-disclosure modal reads "VERGR needs permission…".
Brand style is "Vergr" in prose ([[feedback-brand-capitalization]]).

## A102 is a general relay limitation worth noting
The chat relay forwards only `text`, `type`, `contentUrl`, `videoUrl`, `fileName`,
`fileSize`, `replyTo`. Any structured payload (`location`, `contact`, `wallet`) is
dropped. So every message type whose renderer depends on a structured object degrades:
location loses its map link, contact loses its structured card data, wallet loses its
amount object (harmless — it has text). Anything relying on the object must instead put
its display data in `text`, or the relay must be extended to carry a typed payload.

## Cleanup note
The stuck "audit-probe-delete-me" inbox preview (from the A99 verification probe) is now
GONE — the location and coin sends became the new latest message and overwrote it, which
is exactly the self-heal path described when it happened.

---

# Location + coin transfer REBUILT properly (2026-08-22, founder-pushed)

Founder rejected the first pass: raw coordinates, a money emoji, "Sent 50 coins"
on both sides, and a text bubble instead of a component. All redone.

## Root cause of everything: the relay dropped structured payloads (A102)

Two layers were stripping the `location`/`wallet` objects:
1. `ChatThreadScreen.sendMsg` forwarded only a fixed field list to `hookSend` —
   `location`/`wallet`/`contact` never even reached the relay hook.
2. The relay frame's `mediaKind` derivation returned '' for non-media, non-system
   types, so a `wallet`/`location` echo came back as type `text` on BOTH sides.

Fixed: `sendMsg` now forwards the structured objects; `useRelayMessages`
send-frame + receive-row carry `location`/`wallet`/`contact`; `mediaKind` now
forwards ANY non-text type. (The relay SERVER already forwards unknown nested
fields — voice-note `waveform` proves it — so these cross to the recipient too.)

## A103. Coin transfer is now a real component ✅ FIXED + DEPLOYED + VERIFIED

New `CoinTransferBubble`: a gold card (not a chat bubble), the real **VC coin
graphic** (`CoinIcon` → `/brand/vc-coin.webp`, NOT the 💸 money emoji), and
DIRECTIONAL copy — sender sees "YOU SENT · 50 coins", recipient sees
"<name> sent you". `noBubble` includes `wallet` so it renders as its own card.
Verified live: `coinCards: 2` coin graphics, "YOU SENT" card rendered.

## A100/A101. Location is a real map card ✅ FIXED + DEPLOYED + VERIFIED

**Why WhatsApp/Telegram show a map image and the "paste a link" trick doesn't
help here, established by testing, not guessing:**
- The app's link unfurl (`getLinkPreviewV2`) just reads `og:image`. Tested it
  against Google/OSM/Apple maps URLs — the function 404s (undeployed) and maps
  providers don't expose a usable per-coordinate map og:image anyway.
- WhatsApp/Telegram generate the thumbnail with their own PAID map API keys.
- The free equivalent is an OSM map tile. Proven by curl:
  `staticmap.openstreetmap.de` (what the first pass used) = **HTTP 000, dead**;
  `tile.openstreetmap.org` = **HTTP 200, 41KB PNG, reliable**.

**Current Location** now reverse-geocodes (free Nominatim) to a real address
("Avenue Gustave Eiffel, 7th Arrondissement") instead of raw coordinates.
The bubble (`LocationBubble`) shows ONE OSM tile offset so the exact point sits
under a centred pin, an "Open map" chip, the address, and taps through to the
**device's own map app** on native (`geo:` URI) / OSM on web. Verified live:
`tileLoaded: true, naturalW: 256`.

**Choose on Map** — the old picker loaded the paid Google Maps JS API with an
undefined key and hung. Rewritten as a free **Leaflet + OpenStreetMap** picker
(no key, no billing): interactive map, tap to drop a pin, reverse-geocode the
pin, confirm. Verified live: `leafletContainer: true, leafletTiles: 9`, tapped
→ pin dropped → "1b Avenue Charles Floquet, 7th Arrondissement" → Send enabled.
Added `leaflet` (open-source) to package.json. CSP already allows `https:` for
connect/img on native, so no CSP change was needed.

New helper `src/utils/geo.js`: `reverseGeocode`, `osmTile`, `openInMaps`.

## Note
Old cached location/coin messages (sent before this) stay in their old style —
they're test data and the fix only applies to new sends. Recipient-side
rendering depends on the relay server forwarding the nested fields (it forwards
`waveform`, so expected to work); confirm cross-device on Verion.

---

## A102 correction + receiver verification (2026-08-22)

Founder asked to verify the RECEIVER (Verion) side. Could NOT drive Verion: only
one browser is connected to automation (the Vergr account), and Control_Chrome is
mac-only (`osascript ENOENT` on this Windows box). Verion's notifications are
recipient-scoped so the Vergr token 403s on them. So the receiver was verified a
different, authoritative way: by capturing the relay SERVER's echo frame, which is
byte-for-byte what Verion receives.

**Finding that corrects my earlier assumption:** the relay server does NOT forward
unknown fields. The echo of a coin send was
`{type:"msg",text:"Sent 50 coins",mediaKind:"wallet",ts:...}` — the
`wallet:{amount:50}` object I added was STRIPPED. The server whitelists fields
(text, mediaKind, hasMedia, contentUrl, videoUrl, waveform, replyToId, ts, ...).
`waveform` crosses because it is whitelisted, not because the server is
transparent. My "it forwards unknown fields" claim was wrong.

**Consequences + fixes:**
- **Coin** already worked on the recipient: the amount is parsed from the
  forwarded `text` ("Sent 50 coins" → 50), and direction from `isMe`. Verion sees
  "Vergr sent you 50 coins".
- **Location** was degraded on the recipient (coords dropped → no map tile).
  Fixed by riding the coordinates in `contentUrl` as `geo:lat,lng` (a forwarded
  field) and parsing them back with `parseGeo`. Verified via the echo: the
  recipient frame now carries
  `text:"Bridge Street, Millbank", mediaKind:"location", contentUrl:"geo:51.5007,-0.1246"`
  — everything the location card needs.

**Still NOT directly observed (cannot, from here):** Verion's rendered bubbles,
Verion's in-app notification drawer, and the push notification. The in-app
notification is written by `sendTip` (type 'tip', "You received a tip!") and now
pushes ('tip' added to PUSHABLE_NOTIFICATION_TYPES); actual push delivery is an
OS/FCM event only visible on Verion's device. These need a founder check on Verion,
or the Verion browser connected to the automation extension.

Test artifacts left in the Vergr↔Verion thread: a few throwaway messages
("relay probe", "x", "y") and several 50-coin test tips + test locations. Harmless
test data; delete via the app if unwanted.

---

# COIN + MAP CARDS: pixel-match rebuild + Google Static Maps (2026-08-22, LATE)
# This section is the CURRENT TRUTH and SUPERSEDES the A100/A101/A103 notes above.

The founder supplied three mockups (`~/Downloads/map widget.png`,
`coin send-recieve for small amounts.png`, `coin send-recieve for large amounts.png`)
and demanded a pixel match. Built via a local preview harness
(`<scratchpad>/preview/*.html`, served by `server.cjs` on :8791 — server STOPPED now)
then ported to React. All deployed to vergr.app.

## Components (all in `src/screens/messages/ChatThreadScreen.jsx`)
- **`CoinCard({amount, note, isMe, otherName, timeStr, read})`** — replaces the old
  CoinTransferBubble. Two layouts by amount: **`COIN_LARGE_THRESHOLD = 1000`** → grand
  CENTERED card (big medallion + ripple, "VERGR SENT YOU", diamond-flanked gold number,
  "COINS", note row); below 1000 → compact HORIZONTAL card (medallion left, text right).
  Real VC medallion = `<img src="/brand/vc-coin.webp">`. Directional copy: sender "YOU
  SENT {name}", receiver "{name} SENT YOU" (other party's name in violet).
- **`LocationBubble({lat, lng, title, subtitle, isMe, timeStr, read})`** — map thumbnail +
  glowing gradient pin overlay (centered on the point) + "Open map" pill + glowing pin
  badge + two-line address + time/ticks.
- Shared bits: `CoinNoteRow`, `HeartIcon`, `CoinTicks`, `goldNum(px)` (gold-clip text),
  `parseCoin`/`coinContentUrl`, `VC_COIN`. `CoinChip` was REMOVED (founder: the small
  inline coin next to the number looked fake).
- Both cards use the **traveling violet glow** border: classes `vg-beam vg-beam-violet`
  from `src/styles/surface.css` (now imported into ChatThreadScreen). Respects
  prefers-reduced-motion. This is the same moving light as the earnings ring.
- The gold number uses **Baloo 2** (rounded heavy) — ADDED to the Google Fonts `<link>` in
  `index.html` (both the media=print and noscript links: `&family=Baloo+2:wght@700;800`).
- `wallet` and `location` are in the `noBubble` set so they render as their own cards, not
  inside the default chat bubble.

## The relay strips structured payloads — carry data in forwarded fields
The DM relay SERVER (wss://chat.vergr.app, no repo source) whitelists frame fields and
DROPS unknown objects (`wallet`, `location`). Proven via the echo. Forwarded fields:
type, id, uid, text, mediaKind, hasMedia, contentUrl, videoUrl, waveform, replyToId, ts.
So both cards carry their data in `contentUrl` + `text`:
- **Coin:** `contentUrl = vergrcoin:<amount>:<encodedNote>` (parseCoin/coinContentUrl in
  ChatThreadScreen), `text = "Sent N coins"` (inbox preview + amount fallback). Optional
  note comes from a NEW "Add a message" input in `SendCoinsModal.jsx` → `onSent(amt, note)`.
- **Location:** `contentUrl = geo:<lat>,<lng>|<encTitle>|<encSubtitle>` (parseGeo/
  geoContentUrl in `src/utils/geo.js`), `text = title`. `reverseGeocode` (geo.js, free
  Nominatim) now returns `{title, subtitle, address}` (title=street+area,
  subtitle=city+postcode+country).
- Also fixed in `useRelayMessages.js`: `mediaKind` now forwards ANY non-text type (was ''
  for wallet/location → they arrived as 'text' on the recipient). The sendMsg wrapper in
  ChatThreadScreen also now forwards location/wallet/contact to hookSend.

## Two founder-reported fixes on the map card
- **Title was cut off** → 13.5px, 2-line clamp (was 16px truncate).
- **"Dummy map"** → it was real OSM data but crushed with `brightness(.4)`; that was the
  bug. (Now moot — replaced by Google Static, see below.)

## GOOGLE STATIC MAPS — wired end to end, cost-controlled (founder chose to enable it)
- **Maps Static API is ENABLED** on project `vergr-44494`. Billing was already on (Blaze).
  Do NOT enable the other Maps APIs (JS/Tiles/SDK/etc.) — only Maps Static API is needed.
- **Key**: a dedicated key restricted to Maps Static API, stored as Firebase secret
  **`GOOGLE_MAPS_KEY`** (server-only, NEVER in the bundle/APK). The existing Firebase/Android
  keys are API-restricted and cannot call Maps (that's expected).
- **Why a proxy, not a client key**: a browser/APK Maps key is exposed and referrer
  restriction doesn't work in the Tauri WebView. So `functions/mapThumbnail.js` exports
  **`mapThumb`** (europe-west1, onRequest, secret GOOGLE_MAPS_KEY): dark-styled Static Map,
  NO Google marker (client overlays its own pin), scale=2, returns image/png with
  `Cache-Control public, max-age=2592000, immutable`.
- **Served at `vergr.app/maptile?lat=..&lng=..&w=..&h=..&z=..`** via a `firebase.json`
  hosting rewrite → mapThumb, plus a `/maptile` headers entry so the CDN caches it (the
  global `**` no-cache rule would otherwise kill caching). Verified live: HTTP 200 image,
  **X-Cache: HIT** → each distinct location = at most ONE Google call, ever. Cost ≈ $0,
  well inside the free tier; ~$2/1000 only for uncached first-loads.
- **LocationBubble** now uses `/maptile` (Google dark map) with fallback chain
  google → OSM Voyager tiles → gradient, so the map is never blank.
- Tapping the location still opens the device's Google Maps free (`geo:` URI via
  `openInMaps` in geo.js) — that was always free and unchanged.

## VERIFIED vs NOT
- ✅ `/maptile` returns a real dark Google map (curl + browser), CDN-cached.
- ✅ Coin small card + location card rendered live in the Vergr↔Verion thread (matched mockups).
- ⚠ Coin LARGE layout (≥1000) is HARNESS-verified only — never fired a ≥1000 tip live (test
  wallet balance spent). Send one to confirm.
- ⚠ Receiver-side (Verion) rendering proven via the relay ECHO carrying the right fields,
  but not screenshotted on Verion (only one browser is connected; Control_Chrome is
  mac-only/dead on this Windows box; the founder's Chrome window is often minimized →
  innerWidth 0 → can't screenshot).

## Loose ends / cleanup
- Test-junk messages left in the Vergr↔Verion thread: "relay probe", "x", "y", and several
  50-coin test tips + test locations. Harmless; delete via the app if wanted.
- `src/utils/geo.js` still exports `osmTile` (now unused by the card, harmless).
- Native APK is at 1.0.203 which PREDATES all of today's coin/map work — a phone will not
  show any of these cards until a new APK is built (founder must say go; batch-native rule).

## Summary-table rows to trust (top of file): A100/A101 map + A103 coin are now
## GOOGLE-STATIC + pixel-matched, not "reverse-geocode + OSM". The prose in
## "Location + coin transfer REBUILT properly" (line ~7257) is an EARLIER pass; THIS
## section is the final state.

---

# SCREEN PASS: Profile + VP/Prestige (2026-08-23)

Auditing from Browser 1, logged in as **Verion** (the receiver account), mobile width.

## Profile screen (`/profile`) — checked and CLEAN, recorded so it is not re-audited
- Sticky mini-header on scroll works; content tabs Posts / Media / Clips / Likes /
  Bookmarks / Tagged all load with correct empty states. Bookmarks render real
  posts (with a live "Translate post" link — the translation feature is working).
- **Privacy is correct.** `PublicProfileScreen.jsx:45-47` — `PROFILE_TABS =
  ['Posts','Media','Clips','Tagged']`. Likes and Bookmarks are OWN-profile only
  (IG model), so a user's private curation is not exposed on other people's
  profiles. Verified in source; not a bug.
- Minor copy: the Tagged empty state reads "No tagged yet" (awkward). Not fixed
  (cosmetic, low value). "VERGR POINTS" all-caps label is the known A22 category.

## A107. ⚠ The VP/Prestige surfaces advertised a DEAD commission model, contradicting revenue-share-only ✅ FIXED + DEPLOYED + VERIFIED LIVE

`/prestige` (PrestigeShowcase) and `/settings/ranks` (VPRanksScreen) sold the
**VP-keyed commission ladder** (30% → 15%) as a live perk of ranking up, plus
referenced **deleted gems and coin→gem conversion**. This directly violates two
locked rules: (1) `commissionForVP`/`COMMISSION_RATES` is DEAD and charges
nothing (`vpSystem.js:82` says so in caps), and (2) revenue share is keyed to
**lifetime gross earnings, never VP**. The 2026-08-19 "commission copy" sweep
fixed five screens but MISSED these. Worst lines found live:
- Hero pill "30% commission"; "One of three currencies" (gems are deleted);
  "Higher ranks cut your platform commission, so you keep more gems on every coin
  converted" (three dead things stated as fact).
- `/settings/ranks` had a whole **Commission column** in the 100-level table and
  per-rank "30% → 20% commission" summaries, while its OWN "How leveling works"
  blurb correctly said VP "never changes what a creator is paid" — a self-contradiction.

**Fixed (grepped `commission` across all of `src/`, corrected every LIVE surface):**
1. `src/components/prestige/PrestigeShowcase.jsx` — hero pill → "N/30 badges";
   "What is VP?" sub drops "one of three currencies"; card #3 → badges/crests copy
   (icon savings→workspace_premium); "What you unlock" sub → badges/crests;
   per-rank chip commission → "Collectible/Animated crest"; removed now-unused `fmtPct`.
2. `src/screens/settings/VPRanksScreen.jsx` — removed the Commission column
   (table now Lvl + VP-to-reach), rank-row summary → "unlocks at N VP", prestige
   note drops "commission", header comment updated, removed unused `lastLvl`.
3. `src/screens/home/native/NativeHomeScreens.jsx` — "Level Up" quest card desc
   "30% → 15% commission" → "Climb 11 ranks, collect badges". (native, needs APK)
4. `src/screens/onboarding/OnboardingFlowScreen.jsx` — step-3 line "cuts your
   cash-out commission" → "unlocks badges across 100 levels".
5. `src/screens/marketing/PublicMarketingScreens.jsx` (Monetization) — stale
   "Real commission per rank" comment corrected, misnamed `comm`→`ring` (the
   column actually shows the ring NAME, not a fee), and the "Quests give VP"
   blurb dropped "climb the conversion table and keep more of what you earn".

Checked and left alone (correct usage): the Twitch comparison on
`CreatorsLandingScreen` (uses the real 50–80% model), legal "European Commission",
help articles about the app stores' 30% cut, and the already-correct
"no fee, commission or spread" statements on VanguardMe / compliancePolicies.

Verified live on `/prestige`: hero now "1/30 badges", "What is VP?" reads
"reputation on Vergr", "What you unlock" shows "N badges · Collectible crest" per
rank, zero commission anywhere. Web deployed; native card ships with the next APK.

## Explore (`/explore`) — checked and CLEAN
- Filter tabs (All / Creators / Squads / Streams / Clips / News) all switch
  correctly; the search placeholder adapts per tab; Streams shows a "Live now"
  section + a proper "No live streams right now" empty state. Suggested Squads and
  Top Games render. No layout or crash issues at mobile width.
- **A39 is CLOSED as working-as-intended, do not re-file or "fix".**
  `ExploreScreen.jsx:192-209` documents a founder decision (2026-06-29): a user
  appears in Recommended Creators UNLESS they are a guest or opted out of
  discovery — deliberately NO follower/post/onboarding gate. The code comment
  explicitly says the A10 activity gate is NOT to be added and zero-follower real
  people showing here is correct ([[feedback_for_you_never_blank]]). So
  "emilialara — 0 followers, default avatar" in the rail is by design. Bots are
  demoted below real people; the signed-in user is excluded (A10 satisfied).

## Shorts (`/shorts`) — checked and CLEAN
- `ShortsScreen.jsx:53-67` queries ALL `posts` where `status=='published'` and
  `type in ['short','clip']`, newest first (GLOBAL, not community-scoped), then
  client-side drops embeds, bot authors, and anything without a videoUrl. It is
  empty only because the sole clip-type content today is from news bots (correctly
  excluded) and no user has uploaded a real short yet — the empty state is
  accurate, not a filter bug. Immersive layout correctly hides the bottom nav.
- Minor copy nit (NOT fixed, low value): the empty state says "Shorts show your
  community's vertical clips" but the feed is global, not community-scoped.

## Deep verification of the VP system (founder-pushed: "did you check it REWARDS correctly")

Traced every VP path, not just the copy. Confirmed genuinely correct:
- **Animated crests are real.** `RankCrest.jsx` applies `prestige-float`;
  `badgeSystem.js` marks Mythic + Ascendant `animated:true`; Immortal reuses the
  animated top-Ascendant crest; all 30 `/public/badges/*.webp` exist. The chips I
  added ("N badges / Collectible|Animated crest") are truthful.
- **Level math** correct (1,261 VP → "739 to L2", L2 = 2,000).
- **Profile-completion VP is server-verified AND secure.** `claimQuestReward`
  (index.js:1352) IGNORES the client-supplied `reward`, uses the server
  `PROFILE_QUEST_REWARDS` table, rejects unknown ids, and verifies each step
  inside the transaction (avatar/banner/bio≥20/interests≥3/gaming-link;
  first_follow_5 queries the real `follows` collection for ≥5). A23 is genuinely
  closed. Creator quests (`claimCreatorQuest`) are equally verified.

## A108. ⚠ Half the "How to earn VP" table paid nothing — now WIRED ✅ DEPLOYED

Same class as the commission copy: `/prestige` → "How to earn" advertised VP for
13 actions (amounts from `VP_ACTIONS`), but tracing every server award path showed
only 6 actually paid (daily_login, daily_streak_5, get_like via onPostLiked,
gift/tip via sendTip 1VP/25c, complete_quest, purchase_coins vpBonus; boost_post
also pays via purchaseBoost). Seven advertised VP that never arrived:
create_post, get_comment, go_live, stream_hour (no award anywhere), win_match
(only via retired/unrouted tournaments), and host_event (not even in VP_ACTIONS →
rendered a broken value).

Founder chose "wire the missing awards". Built **`functions/engagementVp.js`** —
`creditEngagementVp(db, uid, action, units)`, amounts mirror VP_ACTIONS, each with
a per-UTC-day cap in a server-only `vp_daily_caps/{uid}_{action}_{day}` doc
(client-denied by default rules; Admin bypasses). ⚠ **CAPS ARE MY PROPOSAL,
founder to confirm/tune:** create_post 15 (cap 75/day ≈5 posts), get_comment 5
(cap 100/day), go_live 30 (cap 30 = once/day), stream_hour 20 (cap 100/day ≈5h).
Wired at:
- create_post → NEW trigger `onPostCreatedAwardVp` (posts onCreate; published,
  non-bot only; scheduled posts don't earn — minor gap, noted).
- get_comment → `onNewComment` (post author, not self).
- go_live → `onStreamWentLive` (before the notification early-returns, so
  friends-only/0-follower streams still earn; `becameLive` guards re-award).
- stream_hour → `endStreamSession` (floor(duration/1h) × 20, real end only).
- win_match REMOVED from the earn table (tournaments retired, unearnable).
- host_event given a truthful `custom:'+150 VP'` (earned via the
  creator_host_event quest, not a per-action award).
DEPLOYED: onStreamWentLive, onNewComment, endStreamSession updated +
onPostCreatedAwardVp created; web earn table redeployed. NOT yet smoke-tested with
a live action end-to-end (posting/streaming publishes content — awaiting founder
go, or will confirm on next organic action via wallet.vp + vp_daily_caps).

## A109. Stale "gems" copy across live surfaces ✅ FIXED + DEPLOYED (backend was already correct)

Gems were deleted 2026-08-16 but user-facing copy still referenced them.
`vergrMeShop.js` was verified to ALREADY credit the dollar payable
(`owedMicroUsd`, line 239), so these were pure display fixes, not logic:
- `LoadingScreen.jsx` — boot splash "counting your gems" → "counting your coins";
  TIP "Tier S clips earn more gems within 30 minutes" (gems + fabricated mechanic)
  → real VP tip; "DID YOU KNOW … platform fee as low as 5%" (dead commission,
  wrong floor) → "Creators keep 50% to 80%…".
- vergr.me shop cluster: `ShopLayout`, `VergrMeEditorScreen`, `ContentTab`,
  `ProductsPointer`, `ProductsPanel` — all "paid in gems" / "You keep N gems" →
  "keep 92% of every sale" (removed the now-unused `youKeep` coin figure).
- `is-vergr-a-scam` help article — "over the 1,000-Gem minimum" → "$100 payout
  minimum".
- `GoLiveSetupScreen` — dead "Gems" tile (todayGemsEarned, always 0) removed;
  Earnings·Today is now Coins + VP (2-col).
Kept (legitimate, per CLAUDE.md): `gem-blue` color token, `/brand/vp-gem.webp` &
`gems.webp` art, `BadgeGem`, `cheerGem`, gem_transfer icon maps, removal comments.

## A110. ⚠ `users/{uid}.vpLevel` has NO writer, so avatar frames are unreachable for everyone (NEW, OPEN)

Grepped every `.js`/`.jsx` in the repo: `vpLevel` appears ONLY as a local const
(`getVPLevel(vp)`) or as a read with a fallback (`profile?.vpLevel || 1`,
`m.user?.vpLevel || m.user?.level || 1`). Nothing, client or server, ever writes
it. Live consequences:
- **`EditProfileScreen` gates avatar frames on `profile?.vpLevel || 1`**, which is
  always 1, so the Elite (L41), Veteran (L61) and Legend (L71) frames can NEVER be
  selected by any user at any VP. This is the ONLY functional reward in the whole
  VP system and it is unreachable by construction.
- Squad member lists, squad leaderboard, Browse Players and the tournament invite
  picker all render "Lvl 1" for every user.
- The app contradicts itself: profile screens compute the level correctly from
  `wallet.vp`, so a profile shows Rookie / 1,261 VP while a squad list shows Lvl 1
  for the same account.
FIX (owner choice OC2 in `docs/GAMIFICATION_PLAN.md`): denormalise `vpLevel` onto
the user doc on every VP change server-side (preferred, because squad/browse read
OTHER users' docs where the wallet is not loaded), or move every consumer onto
`wallet.vp`. NOT yet fixed: it is one decision inside a larger plan.

## A111. `LevelUpCelebration` is rendered nowhere, so leveling up is completely silent (NEW, OPEN)

`src/components/engagement/LevelUpCelebration.jsx` exists and is imported by
nothing (grep returns exactly one file, itself). No modal, no toast, no push, no
feed moment on level-up or rank-up. The single most important beat in a
progression system was built and never wired. A "level-up" haptic already exists
in `utils/haptics.js` and is likewise unused for this.

## A112. Prestige advertises coin rewards that cannot be obtained (NEW, OPEN)

`PRESTIGE_REWARDS` (`vpSystem.js:141`) lists 500 to 5,000 coins across 10 prestige
levels, and the /prestige Prestige tab renders those figures. There is **no server
implementation of prestige at all**: the only matches for "prestige" anywhere in
`functions/` are comments added on 2026-08-23. Nobody can prestige and nothing
grants those coins. Same class as A107 (dead commission) and A108 (unwired earn
table). Recommended immediate action (OC8): remove the coin figures until prestige
exists, rather than display an unobtainable reward.

## Gamification: the bigger picture (founder-directed, plan written)

The founder pushed back that fixing VP copy and wiring was still surface-level,
and asked what a NON-creator actually gets for leveling, and whether VP works as a
gamification engine. Traced it end to end; the answer is that VP is a scoreboard,
not a game: rank grants only cosmetics (name, ring, crests, plus the broken
frames), a pure VIEWER can earn essentially only 10 VP/day from daily login
because `like_post` / `comment_post` / `watch_stream_hour` / `squad_message` award
nothing, and L2 costs 2,000 VP so a viewer waits months for their first level
while the first (broken) functional unlock sits at L41.

Full analysis, viewer track, creator track, achievements engine, cost table and
10 numbered owner choices: **`docs/GAMIFICATION_PLAN.md`**. Nothing is being built
from it until the founder picks.
