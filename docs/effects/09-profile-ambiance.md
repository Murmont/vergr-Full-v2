# 09 — Profile ambiance audio

**STATUS: ✅ SHIPPED + DEPLOYED + LIVE-VERIFIED ON TWO ACCOUNTS (2026-08-25/26).**
⚠ This header read "RESEARCHED, NOT BUILT" until 2026-08-26, long after it
shipped — `ambiance` L81, `src/utils/audius.js`,
`components/effects/audio/ProfileAudio.jsx`, `components/prestige/ProfileAudioPicker.jsx`,
all live. A stale status header is how a later session rebuilds finished work.
Mythic LV1. Rules: [00-RULES.md](00-RULES.md)

---

## 1. Research

A short audio loop the profile owner uploads, which fades in when someone visits
their profile.

### Autoplay policy

Browsers block audio playback until the document has received a user gesture.
This is not defeatable and should not be fought:

- A visitor arriving from inside the app has almost always already tapped
  something, so the audio context is unlocked and playback works.
- A visitor arriving on a **cold load** (a shared profile link, which is the
  common case for a public profile) has not. Playback will be refused.

So the implementation must: attempt playback, accept refusal silently, and
**arm a one-shot listener** so it starts on the visitor's first interaction —
never throw, never show an error, never nag.

### Fade-in is a requirement, not polish

Audio starting at full volume on page load is hostile. Ramp with
`GainNode.gain.linearRampToValueAtTime` (or an `HTMLAudioElement.volume` ramp)
over ~1.5s from 0.

### Founder ruling on hosting risk (2026-08-24)

Vergr already hosts user video and audio; the AUP covers it and DMCA safe
harbour works the same way as for every other upload. **This is not a blocker
and must not be re-raised as one.**

## 2. ⚠ THE REAL BLOCKER: nothing scans audio

The moderation pipeline (`functions/contentAi.js`) covers **chat text, post text
and image/video thumbnails**. It does **not** scan audio.

An uploaded loop that auto-plays to every visitor is therefore an unmoderated
broadcast channel. That is a genuinely different risk from a video upload,
because it plays **without the visitor choosing to press play**.

Minimum before this ships, in order of cost:

1. **A report path on the ambiance itself** — the visitor can report the audio
   from the profile, and it routes into the existing report queue. Cheapest,
   and non-negotiable.
2. **Owner-only default off** — the loop is opt-in per visitor session, or muted
   by default with an unmute affordance. Removes the "plays at you unprompted"
   property entirely.
3. Server-side audio scanning — real work, not required for v1.

**Recommendation: (1) + (2).** With (2) the effect stops being an unprompted
broadcast, which is the part the missing scanner cannot cover.

### ✅ DECIDED (founder, 2026-08-25): the REPORT PATH is the requirement

> "we can just add it to the report options, then its moderated."

So (1) is mandatory and is the bar: the ambiance must be reportable from the
profile, through the existing report queue, and it is then covered by human
moderation like every other user upload. (2) and (3) are NOT required to ship.

⚠ Which means the report option is **load-bearing, not a nicety**. If the
ambiance ships without a working report path it is an unmoderated audio
broadcast, because nothing scans audio. Build the report entry FIRST and prove
it lands in the queue, then wire the playback.

## 3. Surfaces

| Surface | File |
|---|---|
| Public profile (the only place it plays) | `src/screens/profile/PublicProfileScreen.jsx` |
| Native public profile | `src/screens/profile/native/NativeProfileScreens.jsx` |
| Upload + pick | `src/screens/profile/EditProfileScreen.jsx` |
| Storage | `users/{uid}.cosmetics.ambiance` → R2 |

⚠ **It must NOT play on the owner's own profile** (`ProfileScreen.jsx`). The
owner opening their own page and being played at is pointless and annoying.

⚠ **It must stop on unmount.** `PublicProfileScreen` mounts and unmounts as the
user navigates; audio that survives navigation is the worst possible bug here.
Note `ResponsiveLayout` REMOUNTS routed children when crossing a breakpoint
([[reference-responsivelayout-remounts-children]]) — a resize must not start a
second overlapping loop.

⚠ **Vanguard-masked personas play nothing** — a masked profile shows nothing
personal, and a recognisable audio loop is an identity leak.

## 4. Implementation

1. `src/components/effects/audio/ProfileAmbiance.jsx`, mounted only by the two
   public profile screens, rendering `null` when the effect is off.
2. `HTMLAudioElement` with `loop`, not Web Audio: no processing is needed and an
   `AudioContext` is a heavier object to leak.
3. Cleanup on unmount: `pause()`, clear `src`, drop the listener. Assert this.
4. Upload path reuses `uploadToR2(file, 'audio')` and `compressMedia` — check
   the R2 `ALLOWED_KINDS` allowlist in `functions/r2.js` includes an audio kind
   before assuming it does.
5. Cap the duration server-side (~30s). A long file is a bandwidth cost paid on
   every profile visit.

## 5. Verification

- Assert audio does not start on a cold load with no gesture, and DOES start
  after the first interaction.
- Assert volume ramps from 0 rather than starting at full.
- Navigate away and assert `audio.paused === true` and no element remains.
- Resize across a breakpoint and assert exactly one audio element exists.
- Assert nothing plays on the owner's own profile, or on a masked persona.

---

## 6. BUILD STATE: SHIPPED (source) 2026-08-25

Unblocked by the founder ruling in §2 (report path, not a scanner). Built after
that decision; the §2 blocker had been resolved earlier the same day and was
briefly forgotten in a status summary, which is why this doc now records it here.

| Piece | Where |
|---|---|
| Component | `src/components/effects/audio/ProfileAmbiance.jsx` |
| Mounted | `PublicProfileScreen.jsx` **and** `native/NativeProfileScreens.jsx` |
| Upload + pick | `CosmeticEquip.jsx` → Effects tab (see the deviation below) |
| Ladder row | L81 `ambiance` (Mythic LV1, the slot 00-RULES already assigned) |
| Effect row | `EFFECTS`, `defaultOn: false` |
| Storage | `users/{uid}.cosmetics.ambiance` → R2 kind `ambiance` |

### Two things §4 told me to check, and both were missing

⚠ **`ALLOWED_KINDS` in `functions/r2.js` had NO audio kind.** §4.4 says "check
the allowlist includes an audio kind before assuming it does" — it did not.
Added `ambiance` with its **own 2MB cap**, not the plan cap (free 200MB / lite
1GB / pro 5GB, sized for gaming VODs).

⚠ **I FIRST JUSTIFIED THIS AS A BANDWIDTH TRAP AND THAT WAS WRONG.** R2 serves
cdn.vergr.app at **$0 egress**, so Vergr pays nothing to send this file however
many visitors fetch it. Founder challenged the claim and was right to. The real
reasons: it **autoplays**, so unlike a clip nobody pressed play on, the cost
lands on the VISITOR's mobile data and battery; a loop that buffers is not
ambiance; and R2 **storage** (10GB free tier), not egress, is the metered
resource. 2MB is generous for 30s — 128kbps MP3 is about 480KB.

Also rejects any non-`audio/` content type for that kind.

⚠ **The ladder had NO row for it.** 00-RULES assigned "Mythic L1" and nothing
existed at L81, so the reward was promised in the plan and unearnable in the
product. This is an ADD at the already-approved slot, not a move.

### Deviations from this document, both deliberate

1. **Upload lives in the Effects tab, not `EditProfileScreen`** (§3 named the
   latter). The three-tab Appearance panel did not exist in this form when §3
   was written, and an effect whose switch is in one screen and whose file is in
   another is the split that makes a feature feel unfinished.
2. **`defaultOn: false`, the only opt-in effect.** Every other entry in
   `EFFECTS` is visual and costs a visitor nothing. This one makes NOISE at
   them, and a loop that switches itself on the moment the owner reaches L81
   would play at visitors before the owner knew they had it.

### Beyond the doc

- **Reduced motion silences it.** Not literally the right switch, but an
  unprompted sound is the audio equivalent of unprompted motion, and someone
  asking for less sensory load has asked for this too. Both switches checked.
- **`preload="none"`** so a visitor who never triggers playback pays nothing.
- **The URL is host-pinned in `firestore.rules`** to `cdn.vergr.app`. It is
  handed straight to an `<audio>` element, so an arbitrary value would make
  every visitor fetch a third-party host chosen by the profile owner. The report
  path covers CONTENT; this covers WHERE IT LOADS FROM, which a report cannot
  fix after the fact.
- **30s cap enforced client-side** by reading `loadedmetadata` duration before
  uploading, because the server sees a byte count and not an audio stream. The
  2MB cap is the backstop.

### Guards

`scripts/vp-mirror-check.mjs` asserts the level agrees across `EFFECTS`, the
ladder row and `firestore.rules`, that it defaults OFF, and that the rules pin
the audio host. Negative-tested both ways. **447 → 455 assertions.**

⚠ The new `REWARD_OWNERS` guard caught this row as unimplemented on its first
run, before the component was registered — working exactly as intended.

### NOT YET VERIFIED

Every item in §5 is a LIVE test and none has been run: cold-load refusal then
start-on-gesture, the volume ramp, `audio.paused` after navigation, exactly one
element after a breakpoint resize, and silence on the owner's own profile and on
a masked persona. **Nothing here is confirmed working on a real profile.**

---

## 7. REBUILT AS PROFILE MUSIC, SHIPPED + LIVE-VERIFIED 2026-08-25

⚠ **§1's premise was wrong and this document led the build astray.** Its first
sentence assumes "a short audio loop the profile owner **uploads**", and it
never considers an alternative. Doc 08, written for the adjacent audio effect,
had already reached the opposite conclusion ("must say 'choose', never
'upload'") and this doc did not. Founder: *"did you not research all the ways we
can do audio on the profile like my space does?"* Correct, and the answer
changed the whole feature.

### The routes, all tested rather than assumed

| Route | Verdict |
|---|---|
| YouTube embed | **DEAD.** Ads unavoidable on monetised videos and YouTube *increased* their frequency on embeds Aug 2024; `rel=0`/`modestbranding` no longer help. Also reports playback data to Google on page load, a consent problem. |
| Spotify embed | **DEAD.** 30-second preview unless the visitor is desktop + logged in + Premium. Mobile always preview. |
| Direct licensing | **DEAD at this stage.** TikTok's route is UMG/Warner/Sony + publishers; cited floor $100,000+ for a small app. |
| **Audius** | **WORKS.** Free, no key, no ads, ~1M artist-uploaded tracks. |
| **Upload** | **WORKS.** DMCA safe harbour — MySpace's exact footing, and UMG sued them over it and **MySpace won**. |

⚠ **A paid plan on the source platform does NOT remove ads for visitors.**
YouTube Premium and SoundCloud Go+ remove ads for the **listener**, so a profile
owner buying one would only silence ads for themselves. What controls ads is the
*track owner's* monetisation setting. Do not put "get a paid plan" in help copy.

### What was measured, not read

`GET /v1/tracks/{id}/stream` answers 302 → 307 → 200 with
`access-control-allow-origin: *`, `content-type: audio/mpeg`,
`accept-ranges: bytes`. So a plain `<audio>` element plays it directly: **no
iframe, no third-party player, no tracking pixel, and seeking works.** That is
the entire reason this beats every embed, and it is why the consent question
that would have dogged a YouTube embed simply does not arise.

⚠ **`is_streamable` was FALSE on 1 of 10 results** for "lofi", and that track's
stream endpoint 404s. `isPlayable()` also rejects `is_stream_gated` (token- or
follow-gated tracks the artist deliberately withheld) and a non-empty
`allowed_api_keys` (an artist-level app allowlist). None of this is optional.

### Shipped

| Piece | Where |
|---|---|
| API client + filters | `src/utils/audius.js` |
| Player (FAB + popup) | `src/components/effects/audio/ProfileAudio.jsx` |
| Picker (search / upload) | `src/components/prestige/ProfileAudioPicker.jsx` |
| Storage | `users/{uid}.cosmetics.profileAudio` |

⚠ **THE FAB'S POPUP IS THE ATTRIBUTION**: artist, title, artwork, licence and a
link back to Audius. Founder's design, and it also discharges the credit
obligation. Remove the popup and the credit goes with it.

**Whole track plays** (founder: *"we are not paying for it"*). Uploads keep the
30s/2MB cap, because unlike Audius those occupy R2 storage.

### ⚠ A REAL DOUBLE-PLAY BUG, FOUND ONLY BY TESTING

The first build put **two Audio objects playing the same track in lockstep**,
from a single mounted component (verified: one wrapper in the DOM). Cause:
`play()` returns a promise, and its **rejection handler outlived the cleanup**
that should have cancelled it, arming a second gesture listener against a
torn-down element. Nothing in the source looks wrong; only running it showed it.

Fixed twice over: a `cancelled` flag guarding every async continuation, and a
module-level `liveAudio` registry so a new track always silences the previous
one regardless of effect timing.

### Live verification (both accounts, real profiles)

| Doc 09 §5 requirement | Result |
|---|---|
| Silent on the owner's own profile | ✅ no FAB, no audio element |
| Locked below L81 | ✅ "Profile music unlocks at level 81" on the L1 account |
| Search, pick, persist | ✅ 18 results, picked, saved, survived reload (so it passed rules) |
| Visitor sees the FAB | ✅ 48x48 at the profile's corner |
| Popup credits the artist | ✅ "Synthwave / Composer Squad / All rights reserved · on Audius" → `audius.co/composersquad/synthwave-323319` |
| Plays for the visitor | ✅ reached 0:14 of 3:17 |
| Exactly one audio | ✅ 1 created, 1 playing (was 2 and 2 before the fix) |
| Stops on navigation | ✅ paused, `src` cleared, time reset, 0 playing |
| Survives a breakpoint remount | ✅ still 1 created / 1 playing after 4 resizes |

### Still not verified

Masked Vanguard persona (guarded in source, no masked profile to hand), and
native, which waits for the next APK batch.

### 7b. The FAB was UNCLICKABLE, and my own test hid it (2026-08-25)

Founder: *"when i click on the FAB it doesnt open so i currently can't pause the
music"*. Correct, and §7's verification table said it worked.

⚠ **A PROGRAMMATIC `.click()` BYPASSES HIT-TESTING.** My verification called
`fab.click()`, which dispatches straight at the element and succeeds even when
something covers it. A real pointer does not. Measured properly with
`document.elementFromPoint()` at the FAB's own centre: it returned the
**`<aside>` right rail**, not the button. The FAB was viewport-fixed at
`right-4`, which on desktop lands at x=1466 while the rail starts at x=1290.

**Never confirm an interactive element with `.click()` alone. Assert
`elementFromPoint(centre)` resolves to the element itself.**

Fixed by mounting it INSIDE `.vg-profile` (which is already `position: relative`)
as a `sticky bottom-6` child, so it floats over the profile column and nothing
overlaps it. Founder asked for exactly this: *"it should be floating on the
profile section"*. Verified: FAB now at x=1226, inside the 241–1290 column, and
`elementFromPoint` resolves to the button.

### 7c. Design corrections from the same report

- **Autoplay stays ON.** Founder: *"not all users will have the level to get this
  feature so it will be something special."*
- **The glyph is the state.** `music_note` ⇄ `pause`, verified cycling
  `pause → music_note → pause`. The round control IS play/pause; the track-name
  pill beside it opens the credit. Two targets, two jobs.
- **The accent comes from the profile**, not a hardcoded brand gradient — this is
  the owner's page, so it wears their colour. Verified live: `rgb(240,64,96)`.

### 7d. Page load, measured (it is NOT this feature)

DOM ready 1414ms, load 3362ms, 59 requests. The slowest are all pre-existing:
reCAPTCHA `anchor` 1391ms, `subscribeAnnouncements` 1353ms, a Firebase realtime
long-poll 1344ms, the Material Symbols woff2 1095ms, `getUserVP` 1043ms, and
three `rookie*.webp` badge images at ~860ms each. Profile music contributes
nothing to load: `preload="none"` means no bytes are fetched until it plays.
**No console errors on the profile.**

### 7e. The picker BROWSES now — a search box was the wrong shape (2026-08-25)

Founder, on seeing the first picker (a bare search field):

> "this is going to be difficult for users, especially those like me who know
> nothing about Audius... most of whom will search for songs by musicians like
> Taylor Swift and get annoyed after the 3rd search that doesn't show results.
> They need to actually see that songs exist and be able to hear them before
> selecting the one they want."

⚠ **A SEARCH BOX ASSUMES THE USER ALREADY KNOWS THE CATALOGUE.** Nobody picking
profile music knows Audius' roster, and the failure mode is silent: three empty
searches and the feature looks broken rather than unfamiliar. This was a real
design error, not a polish issue.

Four changes, all verified live:

| Change | Verified |
|---|---|
| **Trending loads with no typing** | 20 tracks on screen before any input |
| **20 genre chips** | all tested against the API, every one returns 8/8 playable |
| **Preview on every row** | 20 preview buttons; playback reached 0:14 |
| **Expectations stated up front** | "Chart music from major labels is not available" |

⚠ **ONE PREVIEW AT A TIME.** Measured by switching tracks mid-preview: 2 Audio
objects created, exactly **1 playing**, the first reset to 0. Same discipline the
profile player needed after its double-play bug, applied here from the start
rather than after the fact.

Genre switching verified end to end: Trending showed
"Van Snyder / Peak / Jazcardan", Lo-Fi showed "softy - Plaza / mach_zu / Lazy
Urban Sunday". Search remains, demoted to "Or search by track or artist…".

### 7f. The picker bled off the panel and looked cheap (2026-08-25)

Founder: *"Now things are bleeding off the screen. I feel like you are just
throwing things in there and not making an effort for the UI design.. it
honestly looks cheap."* Both fair.

⚠ **THE BLEED WAS A NEGATIVE MARGIN WITH NOTHING TO CLIP IT.** The genre row used
`-mx-1 px-1`, the usual trick for an edge-to-edge scroller. Measured: it made the
row **1158px wide inside a 1151px parent**, overhanging the panel's right edge,
so the last chips ran off the screen. That trick only works when the PARENT
clips, and this one is `overflow: visible`. Replaced with `.vg-rail` (new, in
`surface.css`): stays in its box, hides the scrollbar, and uses a mask fade to
say "more this way" — which is what the overhang was clumsily trying to
communicate. The fade drops at the end so it never looks like missing content.

⚠ **AND I IGNORED THE DESIGN SYSTEM THAT ALREADY EXISTS.** `surface.css` has
`.vg-tile` — a raised surface with NO stroke, lifting by value plus an inset
highlight — and CLAUDE.md's panel rule is explicit: structure through spacing and
value steps, and *"NO OUTLINE-ONLY SELECTED STATES IN THIS PANEL... selection is
a SOLID accent fill plus a real value step"*. I built flat `rgba(255,255,255,.06)`
washes instead, which is exactly the "border soup / cheap AI design" the rules
were written to stop.

| Was | Now |
|---|---|
| 20 violet "Use" buttons stacked down the panel | **the ROW is the target**; one accent moment on the selected row only |
| flat wash chips | `.vg-tile` chips, solid accent when active |
| flat search box | `.vg-tile` field with a search icon |
| 34px artwork, cramped rows | 44px artwork that doubles as the preview control |
| list guillotined by `max-h` | `.vg-fadelist`, fades out, thin styled scrollbar |

⚠ **AN ACCENT REPEATED TWENTY TIMES STOPS BEING AN ACCENT.** That was the single
biggest reason it read as cheap, and it is worth remembering before adding a
coloured button to every row of any list.

Verified after the fix: rail right edge 1420 vs panel 1434 (**no overflow**),
226px of scroll available, 20 rows, **0** loud Use buttons.

### 7g. "Who even are these artists?" — the DEFAULT QUERY was wrong (2026-08-25)

Founder: *"i dont know or recognise any of this music, who even are these
artists are these just b grade music or what?"*

⚠ **THE CATALOGUE WAS FINE. THE QUERY WAS NOT.** `/tracks/trending` defaults to a
RECENT window, so the picker was serving tracks with **101-1,071 plays** from
artists with **23-5,813 followers**, which makes the whole platform look empty.

Measured with `time=allTime` instead:

| Artist | Plays | Followers |
|---|---|---|
| Skrillex | 1,160,460 | 392,737 |
| Alina Baraz | 863,168 | 87,647 |
| Miquela | 641,884 | 44,176 |
| Zedd | 376,610 | 513,683 |

And verified artists genuinely on the platform, checked by name against
`/users/search`: **Skrillex** (392k followers), **Disclosure** (234k, 41 tracks),
**Odesza** (220k, 81 tracks), **deadmau5** (94k, 9), **RAC** (76k, 19),
**Weezer**, **Diplo**. They were there the whole time; the default query buried
them under this week's uploads.

Per genre with allTime: Electronic leads Skrillex and Zedd, Hip-Hop leads Lil HBK
and RUSS, Pop leads Miquela, Rock leads Cheat Codes.

**Fix:** `trendingTracks()` now defaults to `time: 'allTime'`, and the picker
offers **Popular / This month / New** so fresh material is still reachable.
Verified live: the list now opens on Skrillex, Miquela, Alina Baraz, Lil HBK, Zedd.

⚠ **A DEFAULT THAT MAKES A DATA SOURCE LOOK EMPTY IS A BUG, NOT A TASTE ISSUE.**
I nearly answered this question by explaining that Audius is independent music.
That would have been true and completely useless — the real answer was a query
parameter.

### 7h. UI finished to the panel's own standard

Tabs are now `.vg-tile` with icons rather than flat pills, matching the rows and
chips. Everything unselected in this panel now gets a real value step; solid
accent is reserved for what is actually selected.
