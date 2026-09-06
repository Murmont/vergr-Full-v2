# Live surfaces: TikTok + Twitch benchmark, UI system, and the OBS / Twitch layer

Researched 2026-09-05. Founder: *"Vergr is a smoosh of both tiktok and twitch in one
app"*, so both are the bar, and neither on its own is.

**Every claim about Vergr in this document was checked against the source**, not recalled.
Where something is absent I say which file I looked in. Nothing here has been built; this is
the plan, and the founder's rule stands: build on `/admin/stream-preview` first, port only
once he says it is right.

---

## 0. The two false promises. Fix these before any pixel.

1. ~~**"Custom emotes (5 slots)"** ships as a default VIP membership perk.~~
   **RESOLVED 2026-09-05.** The founder cut custom emotes rather than build them, and the
   promise went with it: the perk is gone from `membershipDefaults.js` and from the
   suggested-perk list in `MembershipTiersScreen`. Zero references remain.
2. ~~**"Subscribers only" stream access** is offered in the stream settings sheet…~~
   **CORRECTED 2026-09-06, measured rather than remembered. This overstated it, and a
   session was about to "fix" a bug that is not reaching users.**

   The server half is right: `'subs'` appears **nowhere in `functions/`**, and
   `createStreamSession` writes `access.mode` as `paid` or `free` only
   (`functions/streaming.js:421`) — an access block asking for `subs` is discarded and the
   stream comes out FREE. But **nothing shipped ever asks for it.** The real go-live screen
   offers Free or Ticketed and nothing else (`GoLiveSetupScreen.jsx:408`), and the
   production paywall (`components/monetization/StreamPaywall.jsx`, rendered by
   `MobileLiveViewer.jsx:850`) has **no `kind` prop at all** — it is coins-only. The `subs`
   paywall is the PREVIEW's copy in `components/streams/states/index.jsx:403`, reached only
   from the simulator's own rail.

   So there is **no live false promise to users**, and this is a build-it decision rather
   than a fix. The founder already took it on 2026-09-02: paid and subscriber-only streams
   ship at launch.

   ⚠ **The same measurement found a second, smaller gap that IS real in the preview.** The
   relay honours exactly two chat rules, `followersOnly` and `slowModeSec`
   (`infra/chat/src/main.go:713`), and `functions/streamChatMod.js` writes no subscriber or
   verified field. So **"Subscribers-only" and "Verified accounts only" chat are inert
   toggles** — the same class as the three kill switches and the boost that bought a badge.
   Designed in the preview 2026-09-06; the port needs one bool each beside the two that
   already work, and until then neither may be described as working.

Same class as the boost that bought a badge and the three inert kill switches: a control the
product offers and the server does not honour. Either build them or pull them.

3. **The OBS host is never given the stream key.** `createStreamSession` returns
   `ingestUrl` and `streamKey`; `GoLiveSetupScreen` renders neither. The whole RTMP branch is
   one line of bitrate advice (line ~1190). Someone who picks OBS is told what bitrate to
   use and is never told where to send it. See §5.

---

## 1. TikTok LIVE: what they have that we do not

| Feature | Vergr | Evidence |
|---|---|---|
| Q&A / question queue | absent | no match in `src` or `functions` |
| Custom emotes | **sold, not built** | §0 |
| Subscriber-only chat | absent | chat has followers-only + slow mode only |
| Subscriber-only stream access | **UI only** | §0 |
| Subscriber-only videos | absent | a newer TikTok subscription perk |
| Multi-guest at scale | 3 | `MAX_COHOSTS = 3`, `CoStreamingScreen.jsx:46`. TikTok: 20, each guest giftable |
| In-app battles | overlay only | `StreamerBattleOverlay` at `/overlay/battle/:streamId/neon` is an OBS browser source. No matchmaking, no shared meter, no result |
| Animated stickers | absent | host-placed canvas stickers |

**Already matched, do not re-raise:** polls, pinned messages, tip goals, keyword filter (now
500, matching theirs), mute timers, moderators, top-gifters ranking, levels and crests, age
restriction, replays, analytics, and scheduled streams with follower reminders
(`notifyScheduledStreams`) which is their "LIVE Events".

---

## 2. Twitch: what they have that we do not

### 2.1 Engagement

- **Channel points.** A per-channel loyalty currency, earned by watching, spent on rewards
  the streamer defines. No equivalent: VP is platform-wide progression, not a per-channel
  balance. Twitch's own AUP says points have **no monetary value and cannot be sold or
  traded**, which is exactly why they can build on them and why coins cannot do this job.
- **Hype Train.** Fires when support spikes **from different viewers**; the whole chat fills
  a shared meter with subs and bits; contributors get temporary emotes and the top two get
  conductor badges for a week. Twitch report **2.5x more subs** during one. `ComboMeter` is a
  per-viewer like-streak with a 1.1s decay, which is a different mechanic entirely.
- **Predictions.** ⚠ **DO NOT BUILD.** Viewers wager channel points on an outcome.
  `public/llms.txt` states publicly that Vergr has no betting, wagering or prediction
  markets, and predictions were removed for underwriting. Recorded here so nobody
  re-discovers it as a "gap".

### 2.2 Moderation, which is the cheapest large win

- **Shield Mode**: one button that flips subscribers-only, raises AutoMod, requires
  verification and clears stragglers. Vergr has the individual levers and nothing that pulls
  them together.
- **AutoMod, a 0-4 strictness dial**, with held messages queued for a mod to approve before
  they appear. Vergr's Gemini pass is binary and host-invisible: no dial, no hold queue.
- **Mod View**, ~12 widgets: chat, AutoMod queue, mod actions log, channel toggles, users in
  chat, suspicious users, blocked terms, permitted terms, unban requests, activity feed.
- **The user card is the sharp one.** Twitch's shows **account creation date, prior timeouts,
  the full chat log and mod comments**. Ours shows followers, following, likes and a bio —
  right for a viewer, useless to a moderator deciding a ban. Same sheet, wrong payload for
  the role. This is a small change to a component that already exists.
- **Unban requests go to the CHANNEL's mods.** Vergr's `submitAppeal` lands in
  `functions/adminModeration.js`, the platform queue, so a host cannot review an appeal
  against their own ban.

### 2.3 Format and discovery

- **Dual Format** (TwitchCon Rotterdam, May 2026): publish horizontal **and** vertical at
  once; mobile gets vertical full-screen, desktop horizontal, rotating swaps you back. Vergr
  carries a single `orientation: 'portrait' | 'landscape'` fixed at creation
  (`streaming.js:150`). **For an app that is deliberately TikTok plus Twitch this is the most
  structural gap on the list.**
- **Discovery Feed**: vertical mobile feed, two tabs (live / clips), preroll-free, tap the
  avatar to enter. Vertical clips reportedly get **40% higher tap-through**.
- **Auto Clips**: captioned clips cut from chat activity, vocal inflection and on-screen
  events. We clip; nothing automatic, no captions.
- **Stream Summaries**: a synopsis so a late joiner can catch up.
- **2K**: 1440p at 9 Mbps for partners. Our Pro cap is 1080p60 at 6.5 Mbps.

### 2.4 Monetisation

Gift 'Em All (up to 1,000 subs at once; our `giftMembership` accepts 25 and the sheet gifts
to one), Creator Badge Drops (Twitch report **up to 50% more gift-sub revenue** where custom
badges are set up), Custom Power-Ups, Drops, Bounty Board, Creator Sponsorships.

---

## 3. The UI systems, measured

### 3.1 Twitch's tokens, and what they show about discipline

| | Twitch |
|---|---|
| Purple ramp | `#9146ff` primary, `#5c16c5` links/active, `#451093` hover, `#330c6e` pressed. 15 greys and 15 purples on a controlled lightness curve |
| Signal | LIVE red `#eb0400`, **used for the live indicator and nothing else** |
| Type | 6 roles only: 31/600, 20/400, 16/600, 14/400, 14/600, 12/400, each with a fixed line height |
| Typefaces | Roobert for brand/display, Inter for functional reading. Two faces, two jobs |
| Spacing | 4 / 8 / 12 / 16 / 18 / 24 / 40 |
| Radius | 2 / 4 / 8 / full |
| Elevation | **shadowless.** "depth comes from the video itself and from translucent scrims, never from drop shadows" |
| Motion | 120ms fast, 200ms standard, 320ms slow; enter `cubic-bezier(0.2,0.6,0.25,1)`, exit `cubic-bezier(0.4,0,1,1)` |

### 3.2 Vergr's, measured across `streamPreview/*.jsx` and `components/streams/*.jsx`

| | Vergr | A scale |
|---|---|---|
| Font sizes | **23** — 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 17, 18, 19, 20, 22, 23, 24 | 6-8 |
| Border radii | **19** — 1,2,3,4,6,7,8,9,10,11,12,13,14,15,16,18,22,99,999 | 3-4 + pill |
| Gaps | **13** — nearly every integer 2-14 | 4/8/12/16 |
| Motion | ad hoc per call site | 3 tokens |

This is the measurable reason it reads cheap: values that are almost-but-not-quite the same.
The research is blunt that this is what separates eyeballed from designed, and that
typography carries more of the expensive-or-cheap impression than any other single thing.

**Vergr should NOT copy Twitch's shadowless rule.** Vergr's approved direction is the
opposite: measured ramps, lit lips, bloom and a travelling edge, from the founder's own
mockups and `surface.css`. The transferable lesson is not "no shadows", it is **one source of
depth, applied consistently** — Twitch picked scrims, Vergr picked light.

### 3.3 What Vergr already does well

Skeletons in 61 files, reduced-motion handling in 27, tabular numerals in 120, haptics in 15,
and a three-typeface split (Syne display / DM Sans body / DM Mono numerals) that mirrors
Twitch's two-face strategy. `RollingNumber` exists but is used in only 3 files — animated
counters on viewer count, tip totals and goal progress are a cheap, high-impact win.

---

## 4. Where TikTok and Twitch agree

Both have these and Vergr does not, which makes them the strongest candidates:

1. **Emotes** (and we already sell them)
2. **Subscriber-only chat** (and our subscriber stream gate is inert)
3. **Multi-guest beyond a handful** (TikTok 20, Twitch Guest Star, Vergr 3)
4. **Vertical-first clips** (TikTok native, Twitch now default)

---

## 5. OBS and Twitch Connect: what exists, and what becomes possible

### 5.1 What is already built

**OBS in (RTMP → Vergr).** `createStreamSession({ mode: 'rtmp' })` mints a stream key and
returns `{ ingestUrl, streamKey }`. `infra/rtmp-auth` validates the key and the plan on
nginx-rtmp's `on_publish`, then a 5s watchdog disconnects anything over the plan cap for 15s
(Free 4 / Lite 6 / Pro 9 Mbps).
⚠ **And the UI shows neither value.** See §0.3.

**Twitch → Vergr (`functions/twitchMirror.js`).** A linked user going live *on Twitch*
surfaces as a native-looking Vergr stream: a `streams/{id}` doc with `source:'twitch'`, and
the viewer renders Twitch's official embed inside Vergr chrome — our header, chat, tips, LIVE
ring and discovery all apply. Detection is Helix polling on an app token. We never rehost
their video.

**Vergr → Twitch.** With OBS ingest, "stream to both" relays out to the streamer's Twitch.

**Two-way chat bridge (`infra/chat/src/twitch.go`).** Twitch PRIVMSG is fanned out to Vergr
peers tagged `src:'twitch'`, and Vergr messages are sent to the Twitch channel as the
broadcaster. Falls back to an anonymous read-only connection without chat scopes. Plus
`TwitchNudge`, an owner-configured periodic message in their own Twitch chat, clamped to
>= 10 minutes.

### 5.2 What connecting unlocks, that we are not doing yet

Ordered by ratio of value to effort.

1. **A real OBS panel.** Server URL and stream key with reveal, copy and regenerate; a live
   connection state (waiting for OBS / receiving / bitrate / dropped frames / health); the
   exact bitrate and keyframe settings for their plan; and a one-tap "copy both". Today this
   does not exist at all, and it is the difference between OBS working and a host guessing.
2. **Vergr as an OBS browser source.** The overlay routes already exist
   (`/overlay/battle/:streamId/neon`, `TournamentOverlayNeon`). Generalise them into a
   **Vergr Alerts overlay**: tip combo feed, new follower, new member, goal bar, entry
   ribbons — the same components already on the viewer, rendered transparent at 1920x1080 for
   OBS. Zero new mechanics; it is a second render target for what ships.
3. **Cross-platform chat in one pane.** The bridge already merges both directions. Surface it
   properly: a source chip per message, one composer that posts to both, and a combined
   viewer count (`getTwitchMirrorViewers` already fetches Twitch's).
4. **Chat commands from OBS/stream deck.** Twitch hosts live in `/poll`, `/prediction`,
   `/shield`. Vergr has polls, goals, raids, boosts — none reachable by a typed command, so a
   host mid-game has to leave the game to click.
5. **Follower and member alerts back into Twitch chat.** The nudge mechanism already writes
   to their Twitch chat; a Vergr follow or membership could post "X just subscribed on Vergr"
   into the Twitch room, which is the growth loop.
6. **Import once, keep in sync.** `twitchChannelImport` exists; extend it to pull the
   Twitch sub list so a Twitch subscriber lands as a Vergr member without paying twice, and
   to mirror emote slots if emotes get built.
7. ~~**Dual Format from the OBS feed.** Because the RTMP path already transcodes…~~
   ⚠⚠ **WRONG, AND IT WAS THE WHOLE JUSTIFICATION. CORRECTED 2026-09-06 by reading the
   services rather than grepping for "transcode".**

   **Vergr has no live transcoding anywhere.** Read in full:
   - `infra/transcode/worker.js` transcodes **uploaded post video**, not streams. Its own
     header: renditions land on "a NEW field on the post document. **Nothing reads that field
     yet**", and it "cannot degrade playback, uploads, calls, **or live streaming, none of
     which it touches**". It also ran on **vergr-stream-2, which was deleted 2026-08-17**.
   - `infra/ingest/src/main.go`: "we write them straight to disk as HLS-fMP4 segments —
     **no ffmpeg, no transcode**, ~1% CPU per stream."
   - `infra/rtmp-auth/src/main.go`: authenticates `on_publish` and drops over-cap publishers.
     No encoding of any kind.

   So a vertical variant is **not** a cheap server-side crop. Costs and options are scoped in
   §6 under Dual Format.

---

## 6. Build order and progress

**On the preview only.** Nothing ports until the founder says it is right, so every
tick below means "built and deployed to `/admin/stream-preview`", never "shipped to
users".

- [x] **OBS connect panel.** Server URL, stream key with reveal/copy/regenerate, live
      connection state with bitrate and dropped frames, plan-correct settings, and the
      stream-to-Twitch row. Found while building it: `createStreamSession` returns
      `{ ingestUrl, streamKey }` and the shipped `GoLiveSetupScreen` renders **neither**,
      so an OBS host could never connect.
- [x] **The three scales.** `previewScale.js` is the source; 301 literals snapped;
      23 font sizes to 8, 19 radii to 7, 13 gaps to 6. Guarded, so it cannot drift back.
- [x] **The shared sheet shell.** One `SheetShell` behind every sheet: docked to the
      bottom, 28px radius and a 40% scrim per Material, a 4x32 grabber that drags to
      dismiss, two detents measured from the content, and a travelling edge light.
- [x] **The profile sheet rebuild.** Identity plate, ring, real rank crest art, stats
      row, bio, Follow/Message, actions on a raised card.
- [x] **The tip and boost sheet**, to the founder's mockups, sampled rather than eyeballed.
- [x] **Custom emotes: CUT**, and the promise removed from the default tier and the
      suggested-perk list. Scope kept in §5 only if it is ever revived.
- [x] **Moderation context on the user card.** Account age (amber under a week),
      prior timeouts in this channel, their recent messages as the evidence, and a
      note for the next moderator. Same sheet, gated on `canModerate`, so the viewer
      card and the mod card cannot drift apart.
- [x] **Shield Mode.** First row of the broadcaster's chat-moderation menu, styled
      unlike everything around it because it is the control you reach for while
      something is going wrong. Four pickable levers, a live armed banner, and it
      restores the host's own settings when lowered rather than resetting them.
- [x] **AutoMod dial with a hold-for-review queue.** Four levels (Off / Light / Standard /
      Strict) in the chat-moderation menu, carrying their current value on the row. Held
      messages never reach viewers; the queue shows who, what, why it was held, account age
      (amber under a week) and prior timeouts, with Approve / Deny / time out.
      **It adds no Gemini spend:** the relay already scans every message and returns
      pass | flag | block (`infra/chat/src/main.go:9-21`), so the dial changes ROUTING, not
      scanning, and the two strictest notches use signals that need no AI at all (first
      message here, link, account under a week). No per-category sliders, because the relay
      returns one verdict and not category scores — offering them would be §0 all over again.
      A red banner above the composer carries the count, on the surface the host is actually
      watching, and it renders only when something is held.
- [~] **Subscriber-only chat** — preview done, server half deliberately NOT done.
      **Done:** the chat rules moved out of `useState` inside the moderation sheet and into
      the sim, so they survive the sheet closing and every surface can read them; a
      **Chat is limited** strip above the composer names every active restriction, because
      a host who locks their own chat down otherwise sees only that it went quiet; and
      **Shield Mode now actually moves those rules and puts the host's own settings back**,
      which its copy had been promising while changing nothing. Verified live: `Verified
      only` → raise → `Followers only · Verified only · Slow 30s` → lower → `Verified only`.
      **Not done, on purpose:** the relay honours `followersOnly` and `slowModeSec` and
      nothing else, so subscriber-only and verified-only chat are still inert. The port is
      one bool each beside the two that work, plus `p.isSubscriber` beside `p.isFollower`
      in `infra/chat/src/main.go:1083`. That is production, and the gate is a founder call.
      See the corrected §0.2 — the "Subscribers only" STREAM gate is preview-only and is
      not lying to any user today.
- [x] **Hype Train** as the shared-support mechanic. A ribbon under the top bar on all
      **six** stream surfaces: level chip, progress to the next level, a countdown, and the
      riders who got it there. Driven by the REAL support emitters (`fireTip`, `fireSub`), so
      it is a mechanic rather than a widget with its own button.
      ⚠ **It rides `train`, NOT `streams/{id}.hype`.** That field already exists and means a
      reactions-per-5-seconds excitement meter (`functions/streamHype.js`). Two systems on
      one word is how the theme system died.
      🔴 **REWARD IS A FOUNDER DECISION AND IS CURRENTLY RECOGNITION ONLY.** Coins would mint
      currency out of a celebration; VP would inflate the ladder and collide with
      `GIFT_COINS_PER_VP`, whose own comment says coins must not buy rank. Guard rule 55
      fails the build if a payout is added.
      🔴 **EVERY NUMBER IS MINE, NOT THE FOUNDER'S:** 500 coins per level, 5 levels, a
      5-minute window, and a 250-coin placeholder for what a sub contributes (a creator sets
      their own membership price, so it cannot be derived). One-line constants, flagged in
      place.
- [x] **Vergr Alerts overlay** for OBS — a second render target for components that
      already ship. A third option beside Desktop and Mobile in the preview: a true
      **1920x1080** canvas, scaled as one unit so every offset is the offset OBS gets,
      carrying the SAME components as the viewer (hype train, sub alert, tip combo feed,
      entrance ribbon, reactions, goal bar). Zero new mechanics, zero lookalikes.
      **Transparency / Over gameplay** toggle, because an overlay that looks right on a dark
      preview and carries its own fill becomes a grey box over somebody's game. Plus the
      browser-source settings a host actually types in, including the two OBS options that
      default to ON and both break alerts.
      🔴 **NOT A ROUTE YET, deliberately.** `/overlay/battle/:streamId/neon` is the precedent
      and takes a stream id, which is not secret — unlike the stream KEY, which is a
      credential and must never reach a URL a host pastes into OBS and screen-shares.
      Shipping the real page is a one-step port on your say-so.
- [ ] **Dual Format** — SCOPED 2026-09-06, NOT BUILT. **Blocked on a founder decision, and
      every route needs one.** Scoped by reading the services end to end, because the one-line
      justification in §5.2 turned out to be false.

      **What already exists** (read, not assumed):
      - `streamCompositor.js` `canvasSize()` already produces **landscape 16:9 and portrait
        9:16** at the plan's short-edge cap (free 480 / lite 720 / pro 1080). Portrait is
        live today behind the mobile Studio toggle.
      - `orientation` is a real, consumed field, not an inert one: `ExploreScreen` and
        `NativeExploreScreen` both split the grid into desktop and mobile rows on it.
      - Viewers **never crop**. Every player is `objectFit: 'contain'`, and `sourceIsPortrait`
        comes from the video's own metadata rather than the doc field.

      **What does not exist:** any live transcoding, anywhere. See the corrected §5.2 item 7.

      **The constraint, in one line:** MediaRecorder binds ONE MediaStream at construction,
      so one canvas is one encode is one upload. Publishing both formats means paying for the
      second one somewhere, and there are only three somewheres.

      **MEASURED ON BOX 1, 2026-09-06, over SSH — not estimated.** `91.98.79.244`, Intel
      Xeon Skylake, **2 vCPU**, 3.8 GB RAM, **ffmpeg 6.1.1 with libx264 IS installed**, idle
      load 0.18–0.49. Live nginx `application live` block read directly: `hls on` with
      **no `exec` / transcode directive of any kind**, so RTMP is remuxed to HLS, never
      re-encoded.

      Real 16:9 → 9:16 crop + scale + re-encode, `-preset veryfast`, **including H.264
      decode** (a `testsrc2` benchmark skips decode and overstates by ~35%), run at
      `nice -n 19`:

      | Output | Speed vs realtime | Verdict |
      |---|---|---|
      | Free 480×854 @ 3 Mbps | **2.89x** | ~2 concurrent, some headroom |
      | Lite 720×1280 @ 4.5 Mbps | **1.69x** | ~1 concurrent, little headroom |
      | Pro 1080×1920 @ 6.5 Mbps | **0.85x** | **cannot keep up with even one** |

      ⚠ `h264_nvenc` / `qsv` / `vaapi` are listed by `ffmpeg -encoders` but a CX23 has no
      GPU. Software x264 is the only real option; do not plan around hardware encode.
      ⚠ **The box is not idle and is not spare.** It also runs the chat relay, ingest, SFU,
      rtmp-auth, OCR, the thumbnailer, cohost-launcher, community-import and the node agent —
      **plus the PayRam node, measured at ~42% of one core sustained**. A transcode taking a
      third to two thirds of the box competes with the live stream's OWN ingest and chat, and
      box 2 is gone, so there is nowhere to move it.
      ⚠ The "box 1 sits at 1.00 load on 2 cores" line in `infra/transcode/worker.js` is from
      the box-2 era and is **stale**; real idle load is 0.18–0.49.

      | Route | Real cost | Status |
      |---|---|---|
      | **A. Two canvases, two recorders, two uploads** | Doubles UPSTREAM (free 3 → 6 Mbps from a phone) and roughly doubles device encode CPU | Bitrate caps are founder-locked. Likely unusable on mobile free |
      | **B. Server-side crop** | Possible at free, marginal at lite, **impossible at Pro** on current hardware, and it competes with live ingest on the same 2 cores | **Tier-limited, not blocked** — corrected by measurement |
      | **C. One encode, viewer-side framing** | **Zero.** No second upload, no transcode, no new infra. Publish 16:9; the mobile viewer fills from a host-set safe area instead of letterboxing | Works at every tier. It CROPS, and "never crop, letterbox instead" is a founder rule |

      ✅ **ROUTE C APPROVED AND BUILT ON THE PREVIEW, 2026-09-06.** Founder: "fine we can go
      with C so long as it is TikTok and Twitch level." Rail section **VERTICAL FRAMING**
      (Whole picture / Fill screen / Frame it…) plus a `vframe` sheet.

      ⚠⚠ **THE HOST DRAWS THE LINES; THE APP DECIDES NOTHING.** Founder, same day: *"we
      shouldnt do it for the user because thats not what other platforms do, we should allow
      them to move lines so that will see what will be visible and what wont be visible."*
      Two draggable lines over the wide source — drag one and that edge moves while the other
      holds. The gap is labelled **ON PHONES**, both outer regions are labelled **CUT**, and
      a live "ON A PHONE" panel sits beside it. **No zoom slider:** the gap between the lines
      already IS the zoom, because a narrower window can only be filled by cropping height
      too. Verified by driving the pointer: dragging the left handle narrowed the window
      0.3164 → 0.1583 (the zoom-2 clamp) with the right edge held at 0.658.
      **Verified live by measurement:** window = **0.3162** of the container against 0.3164
      expected; presets land on **−39.75 / −99.375 / −159px** for x = 0.2 / 0.5 / 0.8, which
      is exactly −x × (inner − container); zoom applies as `scale()`.
      ⚠ **Rotate-to-swap was already built** — `MobileLiveViewer` has a `fullscreen` branch,
      so turning the phone sideways already gives the full 16:9.
      ⚠ **The frame was applied only to `<img>`/`<video>`**, but
      `/brand/live/preview-scene.webp` **does not exist** — it answers 200 with `text/html`
      via the SPA rewrite — so every preview scene is the drawn `SceneFallback` and the
      feature did nothing. [[reference-spa-rewrite-masks-404]]

      ⚠⚠ **AND I BRIEFLY LETTERBOXED THE IMMERSIVE STAGE, WHICH BROKE THE TIKTOK LOOK.**
      Reasoning that an "off" state had to letterbox or the toggle was dishonest, I passed
      `vFrame || 'letterbox'` and gave the stage `objectFit: contain` for everybody. A
      1080x1920 source in a 393x852 (19.5:9) frame letterboxes, so black appeared behind the
      header, and the founder caught it within minutes. **The no-crop rule is about MEDIA
      UPLOADS, not this viewer's presentation** — full-bleed here is an approved design. Null
      now means untouched, and the cards read **Automatic / Fills the screen, centred** rather
      than claiming "Whole picture / nothing is cut", which was never true. Guard rule **56**
      asserts the stage passes the frame straight through; negative-tested against exactly
      that regression.

      **Recommendation was C**, with the host choosing the safe area at go-live so nothing is
      cropped without them seeing it. It is the only route that costs nothing, adds no
      upstream, and works identically at Pro. It needs one ruling: whether a host-defined
      crop is an acceptable exception to never-crop. **A** is a bandwidth ruling. **B** is
      now a capacity ruling rather than a spending one, and it inverts oddly — it is
      cheapest for the free tier and impossible for the paying one.
      Rotating-to-swap is separate, viewer-side, and cheap under any of them.

---

## Sources

- [TwitchCon Rotterdam 2026 announcements](https://blog.twitch.tv/en/2026/05/30/everything-we-announced-at-twitchcon-rotterdam-2026/)
- [Twitch design system tokens](https://oh-my-design.kr/design-systems/twitch)
- [Twitch Mod View widgets](https://stream-rise.com/blog/mod-view)
- [Channel Points and Predictions](https://stream-rise.com/blog/channel-points-predictions)
- [Hype Train guide](https://stream-rise.com/blog/hype-train-guide)
- [Twitch Discovery Feed rollout](https://9to5google.com/2024/05/01/twitch-discovery-feed-app-redesign/)
- [Twitch moderation setup](https://blog.brandbastion.com/how-to-set-up-twitch-moderation-and-keep-chat-safe)
- [Material 3 bottom sheets](https://m3.material.io/components/bottom-sheets/specs)
- [NN/g bottom sheets](https://www.nngroup.com/articles/bottom-sheet/)
- [Optical alignment: 7 spacing fixes](https://adamarant.com/en/blog/optical-alignment-in-ui-7-spacing-fixes-math-gets-wrong)
- [TikTok LIVE overview](https://www.eulerstream.com/what-is-tiktok-live)
- [TikTok LIVE Subscription perks](https://newsroom.tiktok.com/en-us/live-subscription-subscriber-only-videos)
