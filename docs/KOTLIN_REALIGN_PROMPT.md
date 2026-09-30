# Kotlin app: realign with the live app (handover prompt)

Written 2026-09-27 for a new session working on the native Kotlin app. Paste the line
below into that session, or point it at this file.

> Read `C:\Users\damie\Downloads\GitHub\vergr-Full-v2\docs\KOTLIN_REALIGN_PROMPT.md` in full
> and follow it before touching any code.

---

## 1. Where things are, and the one thing that will hurt if you get it wrong

| | |
|---|---|
| **Work here** | **`C:\Users\damie\Downloads\GitHub\vergr-kotlin`**, a git worktree on branch `kotlin-native` (created 2026-09-27; `local.properties` and `google-services.json` already copied in) |
| Kotlin project | inside it, folder `kotlin-native/` (Gradle, KMP: `androidApp` + `shared`) |
| Dev app | the **debug** build, `com.vergr.desktop.dev` ("-dev" version). **Only the founder has it on his phone** and it is how he checks the work. The branch's `Kotlin-native.md` has the "CHECK THESE IN THE DEV APP" table |
| Kotlin start file | `Kotlin-native.md` at the root of that branch, then `kotlin-native/PORT_MAP/`, `kotlin-native/DEVICE_FIRST.md`, the `BATCH_*.md` checklists |
| Last Kotlin commit | **2026-09-09** (`c81775e`, streaming components) |
| The working app (the SPEC) | `C:\Users\damie\Downloads\GitHub\vergr-Full-v2`, branch `chore/revenue-share-events-1.0.196`, **including its uncommitted working tree** |
| Live Play build | 1.0.218 in review; **1.0.219** (versionCode 1000219) built 2026-09-27, not yet uploaded. Package `com.vergr.desktop`. The Kotlin release goes on a NEW developer account |

⚠⚠ **The `kotlin-native` branch carries its own copies of `src/`, `functions/`, `firestore.rules`
and `firebase.json`. They are a snapshot from early September and are WRONG now.**
- Never read the web app from the Kotlin branch. Read it from the `vergr-Full-v2` folder above.
- **Never run `firebase deploy` of any kind from the Kotlin tree.** It would overwrite live Cloud
  Functions, security rules and hosting with month-old code, and would reopen security holes that
  were closed (anyone could make themselves admin until 2026-09-19).
- **Do not `git checkout kotlin-native` inside `vergr-Full-v2`.** That folder has hundreds of
  uncommitted changes and untracked files that a checkout can destroy. Work in a separate worktree
  or clone (for example `git worktree add ../vergr-kotlin kotlin-native` run from `vergr-Full-v2`).
- Do not edit or deploy anything in `vergr-Full-v2`. Another session works there. If the Kotlin app
  needs a server change, write it down (section 6) for the founder.

---

## 1b. The founder's rules for this work (2026-09-27, standing)

- **Your Kotlin work must never affect the other repo** (`vergr-Full-v2`). Read it, never write it.
- The job is **converting each web file to Kotlin, file by file**, and every screen must be
  **functional, wired up and working at the same time**. There is no later "wiring pass"; he does
  not want another run going back to wire things up.
- **Before making any choice, ask him. If you are unsure, ask; never guess.**
- The dev app must be **smoother and better in every respect** than the WebView app. It is truly
  native Android in Kotlin, so there is no excuse.
- The finished Kotlin app is the **next release, on a NEW Play developer account**, which he will
  not create until the Kotlin app is done and working. Do not list creating it as a to-do.
- **Finish the whole list before any build.** Never build and then report app work as still open.

## 2. Read these first, in this order

All paths are in `vergr-Full-v2`.

1. `CLAUDE.md`, all of it. It is long because every rule in it is a defect that shipped. The
   sections on the operating entity, Play, tournaments, payments, bans/mutes, the operator, and
   "Hard rules" apply to the Kotlin app exactly as they apply to the web one.
2. `docs/UPDATE_LOG.md`, every entry from **2026-09-09 to today**. This is the list of what changed
   since the Kotlin branch last moved. It is the core of your job.
3. `docs/AUDIT_RULES.md` (measure the rendered result, every probe needs a control run).
4. The spec doc for whatever area you open (section 4 names them).
5. Then, and only then, `Kotlin-native.md` and the Kotlin `PORT_MAP/` on the branch, remembering
   they describe a web app that no longer exists in several places.

---

## 3. How to work

- **The web app is the spec. Go file by file.** For each Kotlin screen or component, open the web
  file it came from in `vergr-Full-v2` as it is TODAY, diff behaviour (not just layout), and bring
  the Kotlin file back in line. A lot has changed; assume nothing ported before 2026-09-09 is still
  correct until you have compared it.
- **Regenerate the port map before trusting it.** `PORT_MAP/` was generated from the web tree on
  2026-09-07. Routes have been removed (all tournaments, all admin, all Vanguard moderation screens)
  and many added (the clip flow, sounds, the store tabs, Coda). Re-walk the routes in
  `src/router/AppRouter.jsx` and mark what is new, changed, or gone.
- **Native is an opportunity, not a copy.** Founder: the Kotlin app must be visibly better and
  smoother than the WebView app, or the rewrite is wasted. Where the web did something a clumsy way
  because a WebView forced it, do it properly (section 5 lists known cases). Keep the behaviour and
  the business rules identical; improve the feel.
- **Business rules never change in a port.** Prices, fees, VP amounts, level rewards, what is free
  and what is paid, who may do what: copy them from the web source, never re-derive them.
- **Money:** never make a choice that costs the founder money (new Cloud Function, new scheduled
  job, new paid service, more reads or writes per user, a paid API call rate). Stop and ask.
- Write in plain English, no em dashes, and say plainly what was checked and what was not.

---

## 4. Examples of what must be looked at again from scratch

These are examples, not the full list. Each one changed a great deal after 2026-09-09.

### Clips and Shorts (spec: `docs/CLIPS_AUDIT.md`, CLAUDE.md "A CLIP IS A FORMAT")
- A clip is a **9:16 format with its own full-screen player**, not a post with a video on it. One
  player (`ShortsDeck`) for `/shorts` and `/clip/:id`; comments open in a sheet OVER the playing
  video (`CommentSheet`), never a separate page. `isShortFormat()` is the one definition.
- Gestures: tap pause, double-tap like with the heart at the finger, hold an edge for 2x, hold the
  middle for the menu, a thin bar that becomes a scrubber, clear-screen mode. Two gesture defects
  only a device found are in CLAUDE.md; do not repeat them.
- The whole create flow is new: `CreateClipFlow` + `ClipEditor` (trim, text, stickers, speed,
  volume, cover), and **sounds** (`src/utils/sounds.js`, `/sound/:id`, a separately uploaded sound
  layered over the clip, "original sound - name"). Trim and a silenced original are cut into the
  file; text, stickers, speed and the sound mix are stored as `posts.edits` and drawn by the player.
- Quality ladder `CLIP_LIMITS`: free 480p, Lite 720p @ 3 Mbps, Pro 1080p @ 6 Mbps. A cover image
  (`thumbnailUrl`) is generated on every upload. Upload first, then create the post in one write.
- Clips can be "also shared to feed"; unshared ones live in the Clips shelf in For You.
- **Native chance:** Media3 ExoPlayer with a real preload cache for the next clip, Media3
  Transformer or MediaCodec for on-device trim and re-encode (the web's canvas encoder is the
  fragile path that once turned a 22s clip into 2 frames), CameraX recording, uploads in WorkManager
  so they survive leaving the app.

### Live streaming (spec: `docs/LIVE_STREAM_READINESS.md`, `docs/LIVE_STREAM_PORT_PLAN.md`, `docs/HYPE_TRAIN_PLAN.md`)
Added or changed on the web after the Kotlin port:
- **Hype train** (server module rides `sendTip` and `endStreamSession`; `HypeTrainView`, conductor
  plus riders, pays exactly ONE of real coins, boost coins or VP, at random).
- **Bonus coins are boost coins** (monthly plan bonus, promo bonus on coin packs, ad rewards, one
  hype train outcome): they buy boosts and VP packs only and can never be tipped.
- Tip combo rows (`TipComboFeed`) replaced the centred tip pill; the right-edge **support tray**
  (subscribe and gift subs while watching); **bulk gift subs** with no discount and no random.
- **Raids** now have an entry point (`RaidPicker` in the stream summary) and **co-host invites** are
  in the broadcaster's More sheet; both were unreachable before.
- Mod-only chat channel, audio-only streams, who may watch and who may clip, zero-viewer and
  empty-chat states, broadcast health, replay states, "host dropped" derived from the player (no
  heartbeat writes), `peakViewers` from the relay.
- **Native chance:** a hardware encoder and a foreground service for the broadcaster, picture in
  picture for viewers, proper audio routing, real network-quality stats.

### The VP ladder and unlockables (spec: `src/utils/rankUnlocks.js`, `docs/effects/00-RULES.md` and the numbered docs, `docs/GAMIFICATION_PLAN.md`, `docs/VP_BONUS_PACKS_PLAN.md`)
- `rankUnlocks.js` is the ONE table of what each level gives. All 100 levels now grant something
  (boost tokens, VP bonus packs, cosmetics spread one per level). Rank shows in live chat and the
  stream entrance only, never as an avatar ring.
- Unlockables built since: avatar orbit (L6), name colour (L12), 18 name typefaces (demand-loaded),
  ambilight (L21), custom typing indicator styles (L32), living crest (L62), animated name gradient
  with user-picked colours (L63), profile music (L81, Audius), name glow (L100), 8 chat themes with
  icon-pattern tiles, milestone badges, entry ribbons with the name sized by measurement.
- `users/{uid}.cosmetics.fx` stores OPT-OUTS only; every reward resolves from `vpLevel` alone.
- One username renderer on the web (`<UserName>`); the Kotlin equivalent must be the one place too.
- **Native chance:** AGSL/RuntimeShader and RenderEffect (API 31+) for ambilight, glows and the
  name gradient instead of canvas tricks, the Palette API for ambient colour, 120 Hz motion,
  haptics on level-up. Keep a static fallback for reduced motion.

### Buying, store rules and Play policy (spec: CLAUDE.md "THE PLAY BUILD SELLS THROUGH GOOGLE PLAY BILLING ONLY", `docs/PLAN_PAYMENTS_ADS_2026-09-26.md`, UPDATE_LOG 2026-09-26/27)
- Coin packs, boosts (tokens you own and apply to anything), VP bonus packs, Lite/Pro. The buyer
  picks coins or money (`PayChoice`), the basket is a drawer over the current screen.
- **Coda inside the Play app** behind Google's billing-choice programs (`BillingBridge.kt choiceMode`
  in the Tauri tree): Coda methods priced with Google's fee added on top, Google Play under them,
  inert until Google approves. Fees always on top; we must always net the web price.
- A guest can never start a purchase. No card or crypto rail in the store build. The in-app help
  articles have Play-specific versions. Only sanctioned countries are blocked (7).
- "Watch 3 ads, get boost coins" (2026-09-27).

### Everything else that moved (check each against the web)
- **Tournaments are gone and must never appear in the Kotlin app** (Google Play will pull it). The
  port map's largest area is tournaments: skip it entirely. Ticketed EVENTS stay.
- **Admin and Vanguard moderation are desktop apps now** (Vergr Admin, Vergr Vanguard). Do not port
  their screens into the phone app. `/vanguard/invitation` stays.
- Bans are real (account disabled, `BannedGate`), mutes ride an ID-token claim and the composer
  refuses to post while muted.
- Profiles: `ProfileGrid` layout, linked handles on all views, `PlanBadge`, private emails (never
  read or show `users.email`, it no longer exists).
- Subscriptions: the plan is a top-level string (`users.subscription`); read it one way only.
  Lite/Pro perks are in `src/utils/tierSystem.js`.
- Chat themes load tiles from `cdn.vergr.app` (versioned by `TILE_V`); calls had eight defects
  fixed (`docs` + CLAUDE.md "CALL PREVIEW").
- Safe areas: the web uses a `--vg-safe-b` workaround because the Android WebView reports a 0
  bottom inset. Native has real `WindowInsets`; use them, do not copy the 24px workaround.
- Notification channels: there is no Tournaments channel; `tournament_` and `match_` pushes go to
  Other.

---

## 5. Where the WebView forced a worse design (do it properly in Kotlin)

| Web workaround | Native way |
|---|---|
| Canvas + MediaRecorder video re-encode (real time, can drop frames) | MediaCodec / Media3 Transformer, hardware, faster than real time |
| `--vg-safe-b` fixed 24px gesture inset | real WindowInsets (gesture bar and 3-button nav differ) |
| CSS mask chat patterns that need CORS | draw the tile natively, no CORS |
| rAF-driven animations that freeze in background | Compose animation + proper lifecycle |
| No picture in picture, no background audio | PiP for streams and calls, media session |
| Timer freeze in a background tab | foreground service / WorkManager |

---

## 6. What to hand back

- A short report per area: what matched, what was realigned, what is new and not yet built.
- A list of **server changes the Kotlin app needs**, for the founder to approve. Do not make them.
- Update `Kotlin-native.md` on the branch so the next session starts from the truth.
- Nothing has been on a device since 2026-09-09; say which checks were run on a device and which
  were only compiled.
