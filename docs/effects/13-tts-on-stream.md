# 13 — TTS on stream

**STATUS: ✅ SHIPPED + DEPLOYED + VERIFIED LIVE ON TWO ACCOUNTS (2026-08-26).**
A message sent by @vergr was HEARD, spoken aloud, on @Verion's machine. Full
evidence in §2g.
`tts_stream` at **L92**. Rules: [00-RULES.md](00-RULES.md)

⚠ **THE LEVEL IS 92, NOT 82.** Ascendant is **91-99**; the 81-90 band is Mythic
(where `ambiance` sits). This doc says "Ascendant LV2" and a band name is not a
level number — I quoted L82 once before checking `RANK_TIERS`.

**Gate: level OR Pro, no coin charge.** Founder, 2026-08-26: *"both, can be
unlocked or by subscribing to pro"*. Identical shape to `chat_theme`, whose plan
half lives in `canUseChatThemes()` rather than the ladder table.

### Built (source only)

| File | State |
|---|---|
| `src/utils/rankUnlocks.js` | ✅ `tts_stream` row at L92 |
| `scripts/vp-mirror-check.mjs` | ✅ `REWARD_OWNERS` entry — 461 assertions green |
| `src/utils/streamTts.js` | ✅ `canUseStreamTts()`, gesture arming, `voicesReady()`, speak queue with per-viewer mute |
| `infra/chat/src/main.go` | ✅ `StreamMod.TtsEnabled`, `UserProfile.Plan`/`.Role`, `Msg.Tts`, `tts` verb, `handleTts()` — **no Gemini, see §2f** |

### Relay: BUILT + DEPLOYED to box 1, 2026-08-26

`go build` exit 0 on the box (Go 1.22.2), binary installed, `systemctl restart
vergr-chat` done, healthz green, `listening on 127.0.0.1:8095`. Restarted with
**zero** established WS connections, so nobody was dropped.

Backups on the box, both dated `-20260826`: `src/main.go.bak-…` and
`vergr-chat.bak-…`.

⚠ **The live source was verified in sync BEFORE overwriting.** Diff of the box's
`main.go` against the working copy was **122 additions, 0 deletions** — pure
additions, nothing clobbered. Do this every time; box 1 has no backup.

### Receive side: SHIPPED + DEPLOYED

| File | What |
|---|---|
| `src/utils/chatRelay.js` | `tts` case, `onTts` callback (defaulted to a no-op — two existing callers do not pass it), and `speak(text)` |
| `src/components/streams/ChatPanel.jsx` | queue created/torn down with the socket, receive → speak, gesture arming, mute control |

### Both gaps CLOSED — the path is complete end to end (2026-08-26)

| Piece | File | State |
|---|---|---|
| Host toggle | `functions/streamChatMod.js` `setStreamTts` | ✅ deployed, europe-west1 |
| Host UI | `ChatPanel.jsx` → `ChatSettingsPopover` | ✅ "Spoken messages", off by default |
| Viewer send | `ChatPanel.jsx` `onSpeak()` → `client.speak()` | ✅ gated on host opt-in AND (L92 OR Pro) |
| Viewer hear | `ChatPanel.jsx` `onTts` → queue | ✅ |
| Prop plumbed | 5 call sites | ✅ MobileLiveViewer ×2, BroadcasterScreen ×2, NativeBroadcasterScreen ×1 |

⚠ **`ttsEnabled` was passed at ALL FIVE call sites, not just the one in front of
me.** The avatar orbit shipped visible to nobody because exactly one mount point
got wired. `grep followersOnly={` finds them all, because every caller passes the
host settings together.

⚠ **`setStreamTts` uses `loadStream` (host only), deliberately NOT
`loadStreamForMod`.** A chat moderator pinning a message is not the same
authority as opening the room's audio to strangers.

### Verification: see §2d (smoke-tested 2026-08-26)

⚠ **CORRECTION: mobile is NOT a gap.** I flagged `MobileLiveViewer.jsx` as
having no speak queue. It does not need one — it renders `<ChatPanel>` in BOTH
its layouts (`:791` fullscreen rail and `:1060` feed), and ChatPanel carries the
queue, the arming, the mute and the speak button. Verified by reading both call
sites rather than assuming from the absence of a queue in that file.

### ⚠ Two things learned wiring the client

- **Arming cannot rely on the composer.** Most viewers never type. Arming is a
  one-shot `pointerdown`/`keydown` listener on `document`, so unmuting the
  player or opening a panel is enough. Arming only on send would have left
  silent-for-no-reason as the default experience.
- **The speech queue MUST be stopped on unmount.** `speechSynthesis` is a
  GLOBAL queue: without an explicit `stop()` it keeps reading messages aloud
  after the viewer has navigated away from the stream.

### ⚠ Architecture note: TTS is its own verb, but NOT a stricter standard

`handleSend` is HOST + LEXICON only by design, to hold chat fan-out at
single-digit ms. TTS is a separate verb so it can carry its own gates (host
opt-in, the L92/Pro unlock, its own length cap) — but as of §2f it applies the
SAME content standard as chat: lexicon, no Gemini. ⚠ This paragraph previously
said handleTts fails closed on a Gemini error. That is no longer true.

The `Plan`/`Role` reads cost **zero extra Firestore reads**: they come off the
same per-connection snapshot that already yields `vpLevel` for the rank crest.

Research on 2026-08-26 found the chosen free path is **inaudible to viewers by
construction** for camera-only browser broadcasters, and unfixable from our side
because `speechSynthesis` output cannot be captured into an audio graph. See
§2b for the evidence and the A/B decision it forces.

---

## 1. The decision already made

The original proposal used ElevenLabs or Google Cloud TTS. Both are **paid
external services**, which violates the zero-out-of-pocket-cost rule. The
founder accepted the free path on 2026-08-24.

## 2. The free path

**`speechSynthesis` runs on the STREAMER's machine**, and their existing
broadcast audio capture picks it up — so it reaches every viewer with no server,
no API key and no per-character cost.

```
viewer sends text
  -> server validates + charges + moderates
  -> relay pushes to the STREAMER's client only
  -> streamer's speechSynthesis.speak()
  -> their capture already includes system/browser audio -> all viewers hear it
```

### ⚠ What this costs in capability, stated plainly

| Proposed | Free path |
|---|---|
| Celebrity voices | **impossible** — voices are whatever the streamer's OS provides |
| A guaranteed voice per tier | **impossible** — the voice list differs per OS, per browser, per install |
| Robot / monster | possible, by routing output through the doc 05 Web Audio chain |

The ladder copy must therefore promise **an effect**, never a named voice.

### ⚠ Two platform facts to verify before building

1. `speechSynthesis.getVoices()` is **asynchronous on first call** and commonly
   returns an empty array until the `voiceschanged` event fires. Any code
   picking a voice must wait for that event or it silently gets the default.
2. Whether the streamer's capture includes browser audio depends on **how they
   capture**. OBS capturing a display/window may not include browser audio
   without a desktop-audio source configured. **This must be verified against a
   real broadcast before the feature is offered**, and the setup requirement
   documented for streamers.

Fact 2 is the genuine risk: the feature can be built perfectly and still be
inaudible to viewers because of the streamer's capture configuration.

## 2b. ⚠ FACT 2 WAS RESEARCHED 2026-08-26, AND IT IS WORSE THAN THIS DOC ASSUMED

It is not only a configuration risk. For one common setup it is inaudible **by
construction**, and it cannot be fixed from our side. Verified against source and
against the standards trackers, not assumed.

### The blocker: speechSynthesis output cannot be captured

`speechSynthesis.speak()` plays to the system output device and is **not
exposed as a MediaStreamTrack or a Web Audio node**. This is a known gap in the
spec, not a browser bug:
[WICG/speech-api#69 "Support SpeechSynthesis *to* a MediaStreamTrack"](https://github.com/WICG/speech-api/issues/69)
and [WebAudio/web-audio-api#1764](https://github.com/WebAudio/web-audio-api/issues/1764)
are both open feature requests for exactly this.

So we **cannot** route TTS into the broadcast's own audio graph, which is what
would have made this work everywhere regardless of capture setup.

### What that means per streamer setup, traced through our code

| Setup | Reaches viewers? | Why |
|---|---|---|
| Browser broadcast, **camera only** | ❌ **No** | `BroadcasterScreen.jsx:315` captures `audio:` from `getUserMedia` — the MIC only — and sets `echoCancellation: true`, which actively suppresses speaker output. So even acoustic bleed is stripped. |
| Browser broadcast, **screen-sharing with system audio** | ✅ Yes | `BroadcasterScreen.jsx:672` requests `getDisplayMedia({audio:true})`, `:677` passes the track to `comp.setSystemAudio()`, and `streamCompositor.js:257,279` mixes it through `createMediaStreamDestination()` into the outgoing stream. |
| OBS with a **Desktop Audio** source | ✅ Yes | Standard desktop capture picks up the browser's output. |
| OBS routing a browser source via **"Control audio via OBS"** | ❌ **No** | Known open bug: [obs-browser#404](https://github.com/obsproject/obs-browser/issues/404) — SpeechSynthesis audio "records nothing" with that option on. |

⚠ Note the no-compositor fallback at `BroadcasterScreen.jsx:692-696` drops the
display audio track entirely (it adds only video tracks + mic). That path is for
older browsers and would also be silent.

### The decision this forces — FOUNDER CALL, DO NOT BUILD UNTIL ANSWERED

**Option A — speak on the STREAMER's machine (this doc's original design).**
Silent for camera-only browser broadcasters, which is likely the largest group,
and silent for one common OBS misconfiguration. It would ship as a feature that
works for some streamers and mysteriously does nothing for others, with no way
for us to detect or explain which. That is the worst shape a feature can have.

**Option B — speak on every VIEWER's client instead.**
The relay already fans each message to every viewer; each viewer's browser calls
`speechSynthesis.speak()` locally.

| | |
|---|---|
| Works regardless of capture setup | ✅ every setup above, identically |
| Cost | zero — no server, no API, same as option A |
| Streamer hears it too | ✅ they are a client as well |
| In the VOD / replay | ❌ no, it is client-side |
| On a Twitch mirror | ❌ no |
| Voice differs per listener | yes — but doc §2 already accepts per-OS voices |
| Needs a per-viewer mute | yes, and it is mandatory, not polish |

Option B delivers the actual goal in §1 ("a viewer's text audible to the
audience") more reliably than A, and is the recommendation. The real cost is
that it never lands in the recording.

## 2c. OPTION B WAS TESTED ON THE LIVE SITE 2026-08-26 — IT WORKS

Founder: "If you think option B is better then we should do it but check first
to make sure." Checked, in Chrome on vergr.app, measured not assumed.

### ⚠ Web Speech IS autoplay-gated, and the error is silent

| State | Result |
|---|---|
| `speak()` with NO prior user gesture | **`error: not-allowed`** — nothing is spoken |
| immediately after ONE real click | `start` → `end` ✅ |
| 4s later, no new gesture | `start` → `end` ✅ |

**One gesture unlocks it for the session**, exactly like audio autoplay. This is
survivable because a stream viewer must already gesture — stream audio is
autoplay-gated too — but it MUST be armed explicitly the way
`ProfileAudio.jsx` arms its player, never assumed. The failure mode is silence
with an `error` event nobody sees.

✅ **Not throttled in a background tab.** Speech fired normally with
`visibilityState === 'hidden'`, unlike rAF. So a viewer in another tab still
hears it.

✅ `getVoices()` returned 25 voices immediately on this profile — but §2 fact 1
still stands, it is empty-then-async on a cold profile, so the `voiceschanged`
guard is required.

### ⚠ TTS CANNOT RIDE `handleSend`, because stream chat is NOT Gemini-moderated

`infra/chat/src/main.go:872` is explicit: *"Per-message moderation is HOST +
LEXICON only — Gemini is reserved for reported messages. This keeps chat fan-out
latency to single-digit-ms."*

So the relay deliberately does NOT run Gemini on every message. §3 of this doc
requires TTS to pass `moderateChatMessage` because it makes a stranger's text
audible to a whole audience with no human in the loop. Those two facts are
incompatible: **TTS needs the slow moderated path that chat deliberately avoids.**

Therefore TTS is NOT a flag on a normal chat message. Required shape:

```
viewer -> callable speakOnStream()        # unlock + ttsEnabled + Gemini + charge
       -> callable POSTs the relay        # authenticated inject endpoint
       -> relay fans out with tts:true
       -> every viewer's client speaks it
```

The injection precedent already exists: `infra/chat/src/twitch.go:fanIn()` pushes
Twitch messages into a Room from outside the WS path. The relay needs an
authenticated HTTP endpoint of the same shape (header token, as `vergr-sysinfo`
and `vergr-rtmp-auth` already do).

⚠ Adding an inbound verb is otherwise cheap: `main.go:814` ignores unknown types
"to allow protocol evolution", and one `Msg` struct serves both directions.

### ⛔ UNANSWERED: does TTS cost coins, and how much?

§4 step 3 says "charge" and §3 lists a charge surface, but **this doc names no
amount anywhere**. Not inventing one ([[feedback-no-unilateral-financial-choices]]).

Note the unlock already sits at **Ascendant LV2 = L82**, which is a very high
gate on its own, so "the unlock IS the gate, no coin cost" is a coherent answer
as well as a number.

## 3. Surfaces

| Concern | File |
|---|---|
| Viewer sends | `src/screens/streams/ViewerStreamScreen.jsx`, `src/components/streams/MobileLiveViewer.jsx` |
| Streamer speaks | `src/screens/streams/BroadcasterScreen.jsx`, `src/screens/streams/native/NativeBroadcasterScreen.jsx` |
| Transport | `infra/chat/src/main.go` — ⚠ a new message type is a relay change and redeploy (see doc 06 §1) |
| Charge + moderation | `functions/` — must run through the existing moderation path |
| Opt-in | `streams/{id}.ttsEnabled`, streamer-controlled |

⚠ **Moderation is mandatory here and is not optional polish.** This makes a
viewer's text audible to an entire audience with no human in the loop. It must
pass `moderateChatMessage` before it reaches the streamer's client, and the
streamer must have a hard mute.

⚠ **Opt-in per stream, off by default.** A streamer must choose to let viewers
speak on their broadcast.

## 4. Implementation

1. Streamer toggle in the broadcaster UI, defaulting off.
2. Viewer composer entry, gated on the unlock AND on `ttsEnabled`.
3. Server: charge, moderate, then relay to the host uid only.
4. Streamer client: queue and speak one at a time — ⚠ `speechSynthesis` will
   happily overlap utterances, which is unintelligible. A queue with a max
   length, dropping the oldest under flood.
5. Voice selection after `voiceschanged`, with a documented fallback.

## 5. Verification

- ⚠ **On a real broadcast, with a real viewer listening**, confirm the audio
  reaches the stream. This is the only verification that matters and it cannot
  be faked locally.
- Assert the queue never overlaps two utterances.
- Assert a message failing moderation never reaches the streamer's client.
- Assert the streamer's mute stops playback immediately.
- Assert nothing is spoken when `ttsEnabled` is false.

## 2d. SMOKE TEST 2026-08-26 — the path works; Gemini is down

Ran on the live site with the Vergr account (admin, so it clears both the L92
gate and `streaming.js:258`'s follower gate — **no config toggle was needed and
none was touched**). Audience set to `followers`, which `streaming.js:193`
treats as unlisted, so the test stayed off public discovery. `startedAt` is
null and status never left `created`: the session doc existed, nothing was ever
published, nobody was notified.

### Proven, by watching the actual wire

| Step | Evidence |
|---|---|
| Host toggle writes the flag | toast "Spoken messages on"; `streams/{id}.ttsEnabled: true` in Firestore |
| Client gate resolves | the "Speak this message to the stream" button appeared |
| Client emits the verb | `{"type":"tts","text":"…"}` captured on the socket |
| Relay accepts it | reached the moderation step (see below) |
| Host opt-in + unlock + lexicon gates | all passed |
| **Fails CLOSED on Gemini failure** | `{"type":"reject","reason":"policy:moderation-unavailable"}` |

⛔ **NOT proven: fan-out and actual speech.** No message can pass moderation, so
nothing was ever spoken. The queue, the arming and the mute remain untested
against a real spoken message.

### ⚠⚠ TWO PRE-EXISTING PRODUCTION FAULTS FOUND, NEITHER CAUSED BY TTS

**1. The relay's Gemini model was retired. FIXED + DEPLOYED.**
Tested from the box against the live `GEMINI_CHAT_KEY`:

```
gemini-1.5-flash-latest  -> HTTP 404   (was the relay default)
gemini-2.0-flash         -> HTTP 404
gemini-flash-latest      -> HTTP 429   (resolves; quota)
```

So `moderateGemini()` had been calling a dead endpoint. **`handleReport` uses the
same helper**, which means user-REPORTED stream messages were never actually
reviewed — the code believed moderation existed. Default changed to
`gemini-flash-latest`, rebuilt and restarted on box 1.

**2. ⛔ THE `GEMINI_CHAT_KEY` PROJECT IS BILLING-BLOCKED. FOUNDER ACTION REQUIRED.**

⚠ **My first pass here was sloppy and the founder corrected it.** I tested three
guessed model names, hit 429, and reported it as "Gemini is unusable" — ignoring
both the free tier and my own note that [[reference-gemini-quota-per-model]]
quota is PER MODEL, so one 429 is not a ceiling. Gemini does have a free tier and
Vergr already uses it for bot post text and post moderation.

Done properly: enumerated what the key can actually reach
(`GET /v1beta/models`) and tested SIX, including the lite tiers:

| Model | Result |
|---|---|
| `gemini-flash-latest` | 429 |
| `gemini-flash-lite-latest` | 429 |
| `gemini-3.1-flash-lite` | 429 |
| `gemini-3.5-flash-lite` | 429 |
| `gemini-1.5-flash-latest` | 404 — retired (was the relay default) |
| `gemini-2.5-flash` | 404 — retired |

Every 429 carries the SAME body: *"Your prepayment credits are depleted."* That
is a PROJECT BILLING state, not a per-model rate limit — a rate limit says
"requests per minute". ⚠ Once a project is on prepay and credits hit zero it
does NOT fall back to the free tier; everything 429s. So model choice cannot fix
this one key.

### ⚠⚠ IT IS NOT SCOPED TO CHAT. EVERY VERGR KEY IS ON THE DEPLETED PROJECT.

Read off the AI Studio key list on 2026-08-26 (I had earlier written "not
verified" — it is now verified, and it is worse):

| Key | Label | Project | Billing |
|---|---|---|---|
| `…ewMg` | Live stream chat | **vergr-44494** | Tier 1 · Prepay ← the relay |
| `…dneA` | Post text | **vergr-44494** | Tier 1 · Prepay |
| `…UQbA` | Post images | **vergr-44494** | Tier 1 · Prepay |
| `…zet8` | Post videos | **vergr-44494** | Tier 1 · Prepay |
| `…sPsw` | post title correction | **vergr-44494** | Tier 1 · Prepay |
| `…Q6Lw` | **Vergr Moderation** | gen-lang-client-0678214263 | **Free tier** |
| `…ewvQ` | Default | gen-lang-client-0678214263 | **Free tier** |
| `…1BUw` | V title correction | gen-lang-client-0429161577 | **Free tier** |

⛔ **ALL FIVE production keys bill to `vergr-44494`, which is out of credit.**
So `contentAi.js` write-time moderation is down too — post text, images AND
video. **That includes the CSAM block at 0.30 and the nudity block at 0.85.**
This is a live safety gap, and it is far more urgent than TTS.

✅ **Three free-tier keys ALREADY EXIST**, on two projects, one of them named
"Vergr Moderation". A new project may not be needed at all — repointing the five
secrets at free-tier keys would restore moderation immediately.

⚠ Free tier means real RPM/RPD limits. Fine at current volume; revisit before
any growth push.

Ways out, all founder calls: repoint the existing secrets at the free-tier keys,
create a fresh free project, or top `vergr-44494` up. Relay key lives in
`/etc/vergr-chat/env` (one line); the four content keys are Firebase secrets
(`firebase functions:secrets:set GEMINI_POST_TEXT_KEY`, etc., then redeploy the
functions that read them).

⚠ **Do NOT "fix" this by making TTS fail open.** Failing closed is correct and
is exactly what stopped unreviewed text reaching an audience here.

## 2e. Gemini billing + moderation: findings for the founder decision (2026-08-26)

### The model retirement did NOT cause the paid tier

Founder's theory was that the retired model flipped the projects to paid. It did
not — those are independent. The keys read **"Firebase Payment · Tier 1 ·
Prepay"** because they live inside `vergr-44494`, which has a Firebase billing
account attached; the Gemini API auto-enrols any BILLED project into paid tier.
Free tier requires a project with **no billing account**.

(The retired model was a separate, real bug — relay default `gemini-1.5-flash-latest`
404s, fixed. The four Cloud Functions were already on `gemini-flash-latest` /
`gemini-flash-lite-latest`, which are current.)

### ⚠ QUOTA IS PER PROJECT, NOT PER KEY

The four `GEMINI_POST_*` keys plus `GEMINI_CHAT_KEY` all sit in `vergr-44494`,
so **they already share one quota pool.** Having separate keys buys isolation of
blast radius, not extra headroom.

⚠ **Which means: creating one free project PER KEY to multiply the free
allowance is quota circumvention.** Google's terms prohibit spreading a workload
across projects to exceed free limits, and the penalty is account-level, not
project-level — it would take Firebase down with it. Replacing a depleted
project with ONE free project is ordinary use; fanning out four to get 4x the
free tier is not. **Founder decision, made with that risk stated.**

### The four secrets in use

| Secret | Consumed by |
|---|---|
| `GEMINI_CHAT_KEY` | `contentAi.js`, `tipCatalog.js`, **and `/etc/vergr-chat/env` on box 1** |
| `GEMINI_POST_TEXT_KEY` | `contentAi.js`, `newsSeoRewrite.js` |
| `GEMINI_POST_IMAGE_KEY` | `contentAi.js`, `lockedPosts.js`, `lockedMessages.js` |
| `GEMINI_POST_VIDEO_KEY` | `contentAi.js` |

### ⚠ REACTIONARY MODERATION CONTRADICTS THE PUBLISHED POLICIES

`moderateNewPost` (`contentAi.js:285`) is an `onDocumentCreated` trigger on
`posts/{postId}` and scans text + images + video thumbnail on EVERY post. That is
the token burn. `rescanPost` (`:367`) already exists as an on-demand callable, so
most of the reactionary path is built.

But `src/screens/marketing/legal/compliancePolicies.js` states, publicly:

- "Automated systems run before content becomes visible."
- "Automated scanning runs at the moment content is created, before it becomes
  visible to anyone else."
- "Post text is scanned when the post is created."
- "Images are scanned before they appear."
- "Video is scanned by sampling keyframes across the clip."

Switching to report-only makes **all five false**, on indexed pages, including
the CSAM policy. Per CLAUDE.md: keep them true or delete them.

⚠ **And the cost driver is the compliance-critical half.** Text scanning is
cheap; IMAGE and VIDEO scanning are the expensive calls — and they are exactly
the CSAM/nudity surface. So "make it reactionary to save tokens" saves most by
removing the control that is hardest to defend removing.

⚠ **On FREE TIER the proactive scan costs nothing** up to the daily cap. The
token worry is a PAID-tier problem. Moving the keys to a free project may remove
the reason to change moderation at all — worth settling before rewriting policy.

Three coherent options:
1. **Move keys to free tier, change nothing else.** Policies stay true. Free-tier
   daily caps apply; fine at current volume.
2. **Text reactionary, images + video stay proactive.** Rewrite one sentence.
   Keeps the CSAM surface covered; saves little, since text is the cheap call.
3. **Fully reactionary.** Biggest saving, and the compliance pages, the AUP and
   the Play Child Safety declaration all need rewriting to match.

## 2f. GEMINI REMOVED FROM THE TTS PATH — founder decision, 2026-08-26

**This supersedes §3's "must pass `moderateChatMessage`".** Deployed to box 1.

The founder asked the right question: *why was moderation an issue for TTS at
all?* Answer: because I made it one. `handleSend` runs host rules + lexicon and
NO Gemini, by design, to hold fan-out at single-digit ms. I built `handleTts` to
a stricter standard and made it fail closed, so when the Gemini project ran out
of credit TTS died while chat carried on.

⚠ **The argument for the stricter standard does not hold.** THE SAME USER CAN
PUT THE SAME WORDS IN FRONT OF THE SAME AUDIENCE BY TYPING THEM INTO CHAT, where
only the lexicon checks them. A higher bar on the spoken copy of already-
permitted text is inconsistent, not safer — and it was a hard external
dependency that took the feature down with it.

### What still gates a spoken message (verified on the deployed source)

`grep moderateGemini` inside `handleTts` on the box returns **0**. Still present:

| Gate | |
|---|---|
| `TtsEnabled` | host opt-in, OFF by default |
| `VpLevel >= 92` / `Plan == "pro"` | the unlock |
| `IsBanned` / `MutedUntilMs` | chat sanctions apply |
| `takeToken` | rate limit |
| `maxTtsChars` | length cap |
| `matchLexicon` | the word blocking |

⚠ **DO NOT "restore" this by failing OPEN.** That is the worst of both: the
control is present when nothing is wrong and absent exactly when it matters.
Either it runs and blocks, or it is honestly absent — which is what this is.

⚠ The compliance pages describe POST and DM scanning, not stream-chat TTS, so
this change does not falsify them. `handleSend` was already Gemini-free, so the
published claim about chat was never based on a per-message Gemini call.

### Verified end to end — see §2g.

## 2g. ✅ VERIFIED LIVE ON TWO ACCOUNTS — 2026-08-26

Real broadcast (`/broadcast/mUFvQ8AUz1h87kZqwJch`, audience `followers` so it
stayed off public discovery), @vergr hosting, @Verion watching at `/watch/…`.
Stream ended afterwards.

| Assertion | Evidence |
|---|---|
| Host toggle writes the flag | toast "Spoken messages on"; `ttsEnabled: true` in Firestore |
| Sender gate resolves | speak button present for @vergr (admin) |
| **Gate REFUSES the unentitled** | **speak button ABSENT for @Verion (L1, no Pro)** |
| Client emits the verb | `{"type":"tts","text":"…"}` captured on the socket |
| Relay fans out | `{"type":"tts","id":"tts-…","name":"Vergr","text":"…","tts":true}` |
| **A DIFFERENT ACCOUNT HEARS IT** | @Verion's `speechSynthesis.speak()` received "can verion hear this one" |
| Mute silences audio | after mute: **nothing spoken** |
| Mute does NOT hide content | the muted message still appeared in @Verion's chat |
| Mute control is not clutter | only appears once a spoken message has arrived (`ttsSeen`) |

### ⚠ THE ACTUAL ROOT CAUSE OF THE "GEMINI IS DEAD" DETOUR

**The relay was using a STALE KEY.** `/etc/vergr-chat/env` held `…ewMg`
("Live stream chat", project `vergr-44494`, prepay, **depleted**), while the
Firebase secret `GEMINI_CHAT_KEY` already held `…1BUw` — a **free-tier** key that
returns HTTP 200. The box had simply never been updated when the secret changed.

⚠ **I asserted the other four keys were dead by INFERENCE** ("same project →
same quota"), and the founder pushed back. Tested properly:
`GEMINI_POST_TEXT_KEY` **200**, `GEMINI_POST_VIDEO_KEY` **200**,
`GEMINI_POST_IMAGE_KEY` **503** (transient capacity, not billing).
**Post/image/video moderation was never down.** No new projects were needed.
The box env now matches the Firebase secret; `env.bak-20260826` is the backup.

**Lesson: a shared secret stored in TWO places drifts silently.** The relay reads
its key from a file on a box that nothing reconciles against Firebase Secret
Manager. Anything rotated in Firebase must be pushed to `/etc/vergr-chat/env` by
hand, or the relay keeps using the old value until something fails oddly.

## 2h. GEMINI KEY MAP — one project per workload (2026-08-26, DONE + VERIFIED)

⚠ **THE ROOT CAUSE OF THIS WHOLE DETOUR WAS DRIFT, NOT BILLING.** The relay read
its key from `/etc/vergr-chat/env`, which nothing reconciles against Firebase
Secret Manager, so it kept using a depleted key long after the secret had moved
on. **Anything rotated in Firebase MUST be pushed to the box by hand.**

Founder created a separate free-tier project per workload so they stop competing
for one quota. Live map, every entry tested HTTP 200 after wiring:

| Secret | Project | Key tail | Consumed by |
|---|---|---|---|
| `GEMINI_CHAT_KEY` | Vergr Moderation `346351593720` | `…Q6Lw` | `contentAi` (chat), `tipCatalog`, **and `/etc/vergr-chat/env`** |
| `GEMINI_POST_IMAGE_KEY` | `502093043898` | `…hbtQ` | `contentAi`, `lockedPosts`, `lockedMessages` |
| `GEMINI_POST_VIDEO_KEY` | `690916288408` | `…6dkQ` | `contentAi` |
| `GEMINI_POST_TEXT_KEY` | V title correction `…0429161577` | `…1BUw` | `contentAi`, `newsSeoRewrite` |

⚠ **`vergr-44494` (5 keys) is NOT used by anything any more.** It reads "No
credits" in AI Studio because Firebase billing puts it on Tier 1 Prepay. Leave it
alone; do not move a key back there without meaning to pay.

Redeployed after rotation (v2 functions pin a secret VERSION at deploy time, so
a rotation does nothing until they are redeployed):
`moderateChatMessage`, `moderateNewPost`, `rescanPost`, `createLockedPost`,
`getLockedUploadUrl`, `sendLockedMessage`, `getLockedMessageUploadUrl`,
`setTipCatalog`, `clearTipCatalog`.
`newsSeoRewrite` was NOT redeployed — its key did not change.

⚠ `firebase deploy --only functions:…` fails with *"Cannot determine backend
specification. Timeout after 10000"* on this codebase. Not a code fault, the
analyser is just slow over `index.js`. Use `FUNCTIONS_DISCOVERY_TIMEOUT=180`.

⚠ **Free tier returns transient 503** ("model is currently experiencing high
demand") — measured on `gemini-flash-latest`. `gemini-flash-lite-latest` returned
200 four times running. Anything on the free tier should retry, and must not
treat one 503 as a dead key.

Backups on box 1: `/etc/vergr-chat/env.bak-20260826`, `env.bak2-20260826`.
