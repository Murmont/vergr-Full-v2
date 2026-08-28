# Spec: stream entry announcements (rank integration)

---
## ▶ BUILD STATE (2026-08-23). Read this before touching anything below.

**Steps 1 to 5 of section 10 are BUILT AND DEPLOYED.** The spec below is the
design; this block is what actually exists.

| Done | What | Where |
|---|---|---|
| ✅ | `announceStreamJoin` callable, resolves follower/tier/rank server-side, owns dedupe (6h), per-stream rate limit, block and ban suppression | `functions/streamJoins.js`, exported in `functions/index.js` |
| ✅ | Rules locked: `joins` create/update now `if false`; new server-only `joinLocks` and `meta` | `firestore.rules` (~line 1846) |
| ✅ | Client sends only the stream id | `firestore.js → announceStreamJoin()`, called from `ViewerStreamScreen` + `MobileLiveViewer` |
| ✅ | Rank palettes for all 11 ranks (ring = username hue, gradient stops, thresholds) | `src/utils/rankBanners.js` |
| ✅ | Ribbon UI rebuilt: 4:1, art slot + CSS fallback, rank ring, gradient name, "LIVE" in rank colour, L71 border sweep, L91 shimmer | `src/components/streams/JoinAnnouncer.jsx` |
| ✅ | Both defects in §8 fixed (keyboard anchor, fullscreen gap) | `MobileLiveViewer.jsx` |
| ✅ | Rank fields plumbed through all 4 surfaces | Viewer/Mobile/Broadcaster/NativeBroadcaster |

**NOT done, and these are the next steps:**
- ⏳ **Background art does not exist yet.** The founder is generating it from
  `docs/ENTRY_BANNER_PROMPTS.md` to `public/brand/entry/{rankId}.webp` (+`@2x`).
  Until it lands every ribbon renders the CSS fallback in `rankBanners.js`, which
  is deliberate and looks finished, so nothing is blocked.
- ⏳ **Streamer controls (§7)** are read by the callable (`stream.joinAnnounce`)
  but there is **no UI to set them yet**. Add to Go Live setup + broadcaster panel.
- ⏳ **Firestore TTL policy** on `streams/{id}/joins` and `joinLocks` still needs
  setting in the console (`expiresAt` is already written by the callable). Founder
  console action, no code.
- ⏳ **Broadcaster OBS overlay variant** (§10 step 7) not started.
- ⏳ **Never verified on a real live stream.** Verified instead by rendering all
  11 ribbons headless at the true 280x70 and checking name fitting; the harness is
  `<scratchpad>/ribbon_preview.html`.

**Companion docs:** `docs/ENTRY_BANNER_ART_SPEC.md` (measured geometry, the 11
palettes, the 4 unresolved colour conflicts) and `docs/ENTRY_BANNER_PROMPTS.md`
(the generation prompts). Gamification context: `docs/GAMIFICATION_PLAN.md`.

⚠ **Type scale is length-adaptive** (`nameScale` in JoinAnnouncer). A flat size
truncated "Verion" to four characters at 280px. Do not replace it with a constant
without re-rendering the harness.
---


Written 2026-08-23. This is the implementation spec for the entry banner idea in
`docs/GAMIFICATION_PLAN.md` section 4. It exists because the plan described the
feature as a wish ("a slim banner over the lower third") without establishing
where it goes, what is already there, or what it collides with.

**Everything in section 1 was read out of the source.** File and line references
are given so the next session can re-verify instead of trusting this doc.

---

## 1. This feature already exists. We are extending it, not building it.

### 1.1 What is already built and wired

| Piece | File | Notes |
|---|---|---|
| The overlay component | `src/components/streams/JoinAnnouncer.jsx` | complete, animated, particle + SFX + haptics |
| The data hook | `src/hooks/useStreamJoinEvents.js` | subscribes `streams/{id}/joins`, 8s window, max 12 |
| The store | `streams/{streamId}/joins` subcollection | written by the joining viewer's own client |
| Security rules | `firestore.rules:1846-1851` | read public, create self-uid only, no update |
| Viewer (desktop) | `ViewerStreamScreen.jsx:1087` | `side="right"`, default bottom 96 |
| Viewer (mobile) | `MobileLiveViewer.jsx:1075` | `side="left"`, bottom = safe-area + 30vh + 24 |
| Broadcaster (web) | `BroadcasterScreen.jsx:946` and `:1103` | mobile `side="left"`, desktop `side="right"` |
| Broadcaster (native) | `NativeBroadcasterScreen.jsx:465` | `side="left"`, bottom = safe-area + 28vh + 24 |

### 1.2 The founder rule that is already written into the component

`JoinAnnouncer.jsx:3-7`, verbatim:

```
// UX RULES (founder explicit, do not deviate):
//   - Follower joins  → small avatar card slides in next to chat with "X joined".
//   - Subscriber joins → same card with tier-colored glow + soft particle.
//   - Non-follower    → plain "X joined" line at bottom of chat. NO card.
//   - NEVER full-screen. TikTok-sized, not awards-show.
```

⚠ **`GAMIFICATION_PLAN.md` revision 2 proposed a cinematic Immortal entrance that
dims the stream and resolves a crest centre-screen. That directly violates the
last rule and is RETRACTED.** It was written without reading this file. Nothing in
this spec goes full-screen, and no entry treatment takes over the video.

### 1.3 Current data flow

```
viewer opens stream
  └─ client writes streams/{streamId}/joins/{autoId}   (only if follower or subscriber)
       └─ every watching client: onSnapshot, docChanges 'added', ts within last 8s
            └─ JoinAnnouncer: stack of ≤3 cards, 4200ms each, oldest dropped
non-follower join
  └─ NO Firestore write; a plain system line comes from the WS chat relay
```

### 1.4 Existing behaviour constants (do not re-invent these)

- `DISPLAY_MS = 4200`, `maxVisible = 3`, oldest dropped on overflow.
- Card: `width: min(280px, 70vw)`, `borderRadius: 99`, `backdropFilter: blur(8px)`,
  `zIndex: 7`, `pointerEvents: 'none'`, offset `12px` from the chosen side.
- Motion: framer-motion `spring.bouncy`, enters from `x: ±30, scale 0.96`.
  `prefersReducedMotion()` degrades to a 120ms opacity fade.
- Colours: follower `#3D7FFF`, lite sub `#7c3aed`, pro sub `#F0A500`.
- Audio/haptics: `sfx.play('follow')` at 0.6 (sub) / 0.35 (follower);
  `haptic.medium()` / `haptic.light()`.
- Subscribers additionally render `<ParticleEmitter shape="star" count={6} />`.

---

## 2. Blocker: the join write is spoofable, so rank cannot drive spectacle yet

`firestore.rules:1846`:

```
match /joins/{joinId} {
  allow read: if true;
  allow create: if isAuth() && request.resource.data.uid == request.auth.uid;
  allow update: if false;
  allow delete: if isModerator() || isOwner(resource.data.uid);
}
```

The only thing validated is that `uid` matches the caller. **Every other field is
whatever the client says.** Today that means any signed-in account can:

1. Write `kind:'subscriber', tier:'pro'` into **any** stream and receive the gold
   glow and particles without ever subscribing.
2. Write an unlimited number of join docs into someone else's stream (no rate
   limit in rules), which is both announcement spam and a Firestore write-cost
   attack on a stream they do not own.
3. Set an arbitrary `displayName` and `avatar` in the payload if the renderer
   trusts them.

**If rank determines how grand the entrance is, this becomes "anybody can be
Immortal in anybody's room".** So the trust model has to change before the reward
is worth anything. Three options:

| Option | How | Cost | Verdict |
|---|---|---|---|
| **A. Callable** `announceStreamJoin({streamId})` writes the doc server-side, resolving rank/follower/sub state itself; rules drop `create` to `if false`. | one small Cloud Function | 1 invocation per qualifying join | **Recommended.** Only the stream id comes from the client. |
| B. Keep the client write, add rules validation | rules read the user doc and follower edge via `get()` | 2 rule reads per write, billed | Rules `get()` is expensive and cannot rate-limit. |
| C. Render from presence instead of a written doc | derive entries from the viewer list | no writes at all | Loses the broadcaster overlay path and reliable ordering. Keep as a fallback. |

**Option A also fixes the cost problem** (the function can enforce one
announcement per user per stream per session) and gives one trusted place to
apply the mute/block suppression in section 7.

---

## 3. How VP rank integrates (the actual design)

The existing system keys on **relationship** (follower / subscriber / stranger).
Rank is a **second, independent axis**. Do not replace one with the other: a
Rookie who subscribes deserves recognition, and an Immortal stranger is
interesting for a different reason.

**Proposed model: relationship decides IF you get a card, rank decides how it is
DRESSED.**

| Viewer | Today | Proposed |
|---|---|---|
| Stranger, rank < Challenger (L31) | plain chat line | unchanged, plain chat line |
| **Stranger, rank ≥ Challenger (L31)** | plain chat line | **gets a card** (this is the new reward, and it is the reason a lurker ranks up) |
| Follower, any rank | blue card | card with rank-coloured ring on the avatar + rank crest chip |
| Subscriber, any rank | tier card + particles | unchanged, plus rank crest chip |
| Rank ≥ Legend (L71) | n/a | card gains an animated rank-gradient border (still a card, still 280px) |
| Rank ≥ Ascendant (L91) | n/a | card gains a one-off shimmer sweep and the entry sound at 0.6 (subject to streamer sound toggle) |

Escalation is expressed as **richness of a small card**, never as size. That
satisfies "TikTok-sized, not awards-show" while still making L31, L71 and L91
feel like doors opening.

**Why L31 for the stranger card:** it must be far enough up to be scarce, but
reachable. It is also the first band where the ladder in the plan currently has
nothing memorable, so it fills a dead stretch.

---

## 4. Exact placement, per surface

The component is `position: absolute`, so it anchors to the nearest positioned
ancestor in each host screen. Values below are the current ones, kept.

| Surface | Side | Bottom anchor | Width | z-index | Sits above |
|---|---|---|---|---|---|
| Mobile viewer (`MobileLiveViewer`) | left, 12px | `calc(env(safe-area-inset-bottom) + 30vh + 24px)` | `min(280px, 70vw)` | 7 | the 30vh chat feed |
| Desktop viewer (`ViewerStreamScreen`) | right, 12px | 96px | `min(280px, 70vw)` | 7 | the chat input dock |
| Broadcaster mobile | left, 12px | `calc(env(safe-area-inset-bottom) + 28vh + 24px)` | same | 7 | the 28vh dock |
| Broadcaster desktop | right, 12px | 96px | same | 7 | the input dock |
| Native broadcaster | left, 12px | `calc(env(safe-area-inset-bottom) + 28vh + 24px)` | same | 7 | the dock |

**Verified z-index landscape on `MobileLiveViewer`** (root container is `z:95`;
these are children): `4` top-left badges, `5` chat column and PiP button, `6`
fullscreen controls and dim layer, **`7` JoinAnnouncer**, `8` the right-hand
action rail, `9` floating buttons and the reactions floor, `60` the more-sheet
backdrop, `200-210` bottom sheets and modals.

Consequences that matter:
- The announcer is **left** on mobile while the action rail is **right**, so they
  do not overlap even though the rail is at a higher z-index. Keep that split. If
  a future card widens past `70vw` it will collide with the rail.
- Bottom sheets (z 200+) correctly cover announcements.
- `pointerEvents: 'none'` means the card never steals a tap from the video. Keep.

---

## 5. Motion and timing

Reuse what exists rather than inventing a second motion language.

| Property | Value | Source |
|---|---|---|
| Enter | `x: ±30 → 0`, `scale 0.96 → 1`, `opacity 0 → 1`, `spring.bouncy` | existing |
| Exit | reverse, `x: ±18`, `scale 0.96` | existing |
| Dwell | 4200ms | existing `DISPLAY_MS` |
| Stack | up to 3, vertical, `gap: 6`, framer `layout` reflow | existing |
| Reduced motion | 120ms opacity only, no particles, no shimmer | existing `prefersReducedMotion()` |
| New: rank border (L71+) | 2.5s conic sweep, one pass, then static | reuse `.vg-beam` from `surface.css` |
| New: shimmer (L91+) | 900ms single diagonal sweep at 35% opacity | new, small |

**Do not animate more than one card at a time above L71.** If two high-rank
cards land together, the second renders in its static state. Simultaneous sweeps
read as noise.

---

## 6. Queue and throttle algorithm

Today there is effectively no throttle: every qualifying join inside the 8s
window renders, capped only by `maxVisible = 3`. In a busy stream that is a wall.

Proposed, enforced **server-side in the callable** (option A) so it cannot be
bypassed:

1. **Dedupe:** one announcement per `(uid, streamId)` per 6 hours. Re-entering
   does not re-announce, which kills leave/rejoin farming.
2. **Global rate limit per stream:** at most 1 announcement per 2 seconds. Excess
   is dropped, not queued, except for the priority classes below.
3. **Priority under load:** when the limiter is saturated, keep subscriber and
   rank ≥ Legend announcements and drop follower and stranger ones. A whale
   arriving during a raid is exactly who should not be dropped.
4. **Burst ceiling:** at most 20 announcements per stream per minute regardless of
   class. Above that, suppress entirely and let chat carry the joins.
5. Client keeps `maxVisible = 3` as the visual cap.

These are starting numbers, not sacred; they are the tuning surface once it is
live.

---

## 7. Streamer controls (required, not optional)

Stored on the stream doc, editable from the broadcaster panel and Go Live setup:

```
streams/{id}.joinAnnounce = {
  enabled: true,            // master switch
  minRank: 0,               // 0 = follow existing behaviour; else min VP level for a card
  sound: true,              // entry SFX on/off for THIS stream
  subscribersAlways: true,  // subs bypass minRank
}
```

Rationale: a creator whose chat is being drowned will otherwise disable the whole
feature socially by complaining, and a creator who wants their whales celebrated
needs a way to raise the bar rather than turn it off.

**Suppression rules that are not negotiable:** a user the broadcaster has blocked,
or who is banned or muted in that chat, gets **no** announcement, and the callable
enforces it (not the client).

---

## 8. Edge cases and failure modes

1. **⚠ Existing bug: the keyboard.** `MobileLiveViewer.jsx:1055` shrinks the chat
   feed to `96px` when the keyboard is open (`kb > 0`), but the announcer's
   `bottom` is computed from the constant `CHAT_FEED_HEIGHT` (30vh) and does not
   react. So while typing, cards float detached, roughly 30vh up, over the video.
   Fix by passing the live chat height rather than the constant.
2. **⚠ Existing gap: fullscreen.** `JoinAnnouncer` is rendered in the main return
   at `:1075`; the fullscreen branch (`:772` onward) renders its own chat column
   at z5 and no announcer. So entry announcements silently disappear in
   fullscreen. Decide: render there too, or accept and document.
3. **PiP:** already correctly suppressed via `{!pipActive && ...}`. Keep.
4. **Rank changes mid-stream:** resolve rank at announce time; never re-render an
   already-shown card.
5. **Missing avatar or display name:** the card already falls back to 'Someone'.
   Rank chip must degrade to no chip rather than a broken image.
6. **Offline or rules failure:** the hook already logs and continues. An
   announcement failing must never break playback or chat.
7. **A stranger with a high rank who is muted:** no card (section 7).
8. **Reduced motion:** no shimmer, no particles, no sound.
9. **Cost:** with the callable, one function invocation and one Firestore write per
   qualifying join, deduped 6-hourly. There is still **no TTL policy on `joins`**
   (`useStreamJoinEvents.js:11` says it is a TODO), so those docs accumulate
   forever. **Add the TTL policy as part of this work**, or the subcollection
   grows without bound.

---

## 9. Acceptance criteria

The feature is done when all of these are true on a real stream:

1. A stranger below the rank threshold produces a chat line and no card.
2. A stranger at or above L31 produces a card with their rank ring and crest chip.
3. A follower and a subscriber behave exactly as they do today, plus the rank chip.
4. A client that writes a forged `tier:'pro'` join doc directly produces **no**
   announcement (rules deny the write; only the callable can create).
5. Re-entering the same stream within 6 hours does not re-announce.
6. 30 simultaneous joins produce at most 3 visible cards and never more than 1
   announcement per 2 seconds, with subscribers surviving the drop.
7. A blocked or muted user produces no card.
8. With the keyboard open, cards sit directly above the shrunken chat, not
   floating over the video.
9. `prefers-reduced-motion` produces a fade with no particles, shimmer or sound.
10. The broadcaster can turn announcements off, raise the minimum rank, and mute
    the sound, and each takes effect without a restart.
11. Playback, chat and the action rail are unaffected when the announcer errors.

---

## 10. Build order

1. **TTL policy on `streams/{id}/joins`** plus the cost guard. Independent, do it
   first, it is already overdue.
2. **`announceStreamJoin` callable** + rules change to `allow create: if false`.
   Move the four client call sites onto it. **No visual change yet**, which makes
   it a safe, verifiable step.
3. **Fix the two existing defects** (keyboard anchor, fullscreen gap).
4. **Rank plumbing**: resolve rank in the callable, extend the payload, render the
   ring and crest chip on the card.
5. **Stranger card at L31** plus the streamer controls.
6. **L71 border sweep and L91 shimmer.**
7. **Broadcaster OBS overlay variant** (separate surface, own spec).

Steps 1 and 2 are worth doing even if the rank work is deferred: they close a
live spoofing hole and an unbounded-growth bug.

---

## 11. Open questions for the owner

**Q1. Rank threshold for the stranger card.** Proposed L31 (Challenger). Higher is
scarcer and more prestigious, lower is more people getting the reward.

**Q2. Does rank ever beat relationship?** Proposed no: a subscriber always gets
the tier treatment regardless of rank. Alternative is a combined score.

**Q3. Sound default.** Proposed on for subscribers and L91+, off otherwise, with a
per-stream toggle. Sound is the most complained-about part of this genre.

**Q4. Should the broadcaster be able to grant a VIP entrance manually** to a
specific viewer, independent of rank? It is a strong creator tool and a way for
creators to reward their own community, but it is extra scope.

**Q5. Entry-effect variants bought with coins** (plan OC5). Rank unlocks the slot,
coins choose the look. Real coin sink, real revenue, more scope and moderation.

**Q6. Fullscreen (section 8.2):** render announcements there, or accept the gap?
