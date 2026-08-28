# Gamification plan: what leveling up should actually give

Written 2026-08-23 during the live audit. **Revision 2**, after the founder
correctly called revision 1 timid.

Every "today" statement was read out of the source, not assumed. Owner choices
are in section 11.

Related: `docs/APP_AUDIT.md` (A107 to A112), `docs/REVENUE_SHARE_PLAN.md` (why VP
must never touch what a creator is paid).

## ▶ BUILD STATE, 2026-08-23 (SHIPPED + DEPLOYED). Read this before touching VP.

**Source of truth for rewards: `src/utils/rankUnlocks.js`.** Not this document.
The table is the product; this file is the reasoning behind it.

### The rule that shaped everything here

**Two founder rulings, both non-negotiable:**

1. **Rank never touches the avatar ring.** The ring means "live" or "unseen
   status". Rank shows in **live chat** and on the **stream entrance ribbon**,
   and nowhere else. `RankBadge` was removed from the feed, comments, follower
   lists, search and the DM header on 2026-08-23. `UserAvatar.showTierRing`
   stays `false`.
2. **Nothing may cost money per run.** Every reward here resolves from
   `vpLevel`, a single number already on the user doc. No callable, no extra
   read, no cron. The rank crest in live chat costs ZERO reads because the
   relay (`infra/chat/src/main.go`) already loads each sender's profile once per
   connection and now stamps `vpLevel` on every message from it. The rank VP
   bonus costs zero reads because `walletActions.planMultiplier` and
   `engagementVp` already fetch the user doc for the plan multiplier.

⚠ An earlier draft built a per-chatter Firestore read (`src/utils/rankLookup.js`)
because CLAUDE.md claimed the relay had no source. **That claim was false**, the
file is deleted, and CLAUDE.md is corrected. If a doc here says something is
impossible, check the filesystem before designing around it.

### What is BUILT and LIVE

| Reward | Where it lives | Enforced by |
|---|---|---|
| Crest per rank band | live chat | `RankBadge` in `ChatPanel.jsx`, `vpLevel` off the wire |
| Chat name colour (L3+) | live chat | `chatNameColor()` in `ChatPanel.jsx` |
| Animated chat name (L63) | live chat | `.vg-join`/`vgNameSweep` in `surface.css`, equipped |
| Entry ribbon tiers (L31/71/91) | stream entrance | `functions/streamJoins.js` + `JoinAnnouncer.jsx` |
| Profile accent (12 levels) | profile banner wash + VP bar | `PublicProfileScreen`, equipped |
| Profile theme (7 levels) | profile bannerless background | `PublicProfileScreen`, equipped |
| Stream Boost token (7 levels) | pays for a public stream | granted `functions/vpLevel.js`, spent + refunded `functions/streaming.js` |
| VP earn rate, +0.5%/level | every VP grant | `walletActions.js` + `engagementVp.js` |
| Level-up modal naming real unlocks | `LevelUpCelebration.jsx` | reads `unlocksForLevel()` |
| Rank-up push | notification + FCM | `functions/vpLevel.js`, type `vp_level_up` |
| Unlock ladder + equip UI | `/prestige` | `UnlockLadder.jsx`, `CosmeticEquip.jsx` |

Security: `users.vpLevel` and `wallets.boostTokens` are **server-only** in
`firestore.rules`; `cosmeticMinLevel()` there re-checks every equipped id
against the level already ON the doc, so the client gate is advisory only.

### ⚠ WHAT WAS CUT, AND WHY (do not just re-add these)

A draft of the ladder promised **emote packs, pinned-post slots, comment tints,
comment pinning, an audio name clip, extra profile links, a trophy case, and
extra post reactions**. Every one was cut before shipping because **none has a
system behind it**: there is no post-reaction collection, no pinned-post field,
no emote-pack registry, no audio-clip upload. Shipping them would have made the
levels page a list of lies, which is the exact defect this whole workstream
exists to fix.

Two entry tiers were cut for the same reason: a "tinted line" at L11 and a
"full banner" at L51. `JoinAnnouncer` draws ONE ribbon for anyone who earns a
card, so those tiers were describing a visual nothing rendered.

**To bring any of them back: build the system first, then add the row.** The
order matters, and it is the whole lesson.

### Admin override, and the theme-rendering lesson

**Admin sees every cosmetic unlocked.** `profile.role === 'admin'` sets an
effective level of 100 in `CosmeticEquip.jsx`, mirrored in firestore.rules
`cosmeticsAllowed()` (which reads `role` off the doc BEING WRITTEN, so it costs
no extra read, unlike the `isAdmin()` helper which does a `get()`).

It is admin-only on purpose: a debug flag, query param or localStorage key would
all be ways for a normal account to equip level-100 cosmetics.

⚠ **Themes took FOUR passes because the first three shipped unrendered.** Recorded
in `src/utils/profileThemes.js`, and the traps are worth knowing before touching
any dark-UI background:

1. Pass 1 was seven flat two-stop gradients. Two were named after treatments in
   `surface.css` that they did not use.
2. Pass 2 used `background-blend-mode` to composite noise. `grain` and `nebula`
   rendered as FLAT GREY: mid-grey noise blended over dark colour layers crushes
   them to nothing.
3. Pass 3: `url("data:...")` with DOUBLE quotes silently killed the entire
   `background` shorthand wherever the CSS reached an HTML `style="..."`
   attribute. Single-quoted `url('data:...')` with `%22` inside the SVG is the
   robust form.
4. Pass 4: **feTurbulence averages MID-GREY**, so a noise layer at alpha A does
   not only add tooth, it LIFTS the plate by roughly `128 * A`. At 0.16 that was
   +20 levels and `grain` came out a brown card. Now 0.07 on a near-black plate.

Harness: `~/Downloads/vergr-theme-preview/render.cjs` reads the real
`profileThemes.js`, writes a page of 220px banners, and headless Chrome
screenshots it. Reuse it before touching these again, and never ship one blind.

### Still open

- **`users.avatarFrame` is a dead-end.** `EditProfileScreen` has a level-gated
  frame picker with an upsell toast, it saves to the user doc, and **nothing
  anywhere renders it**. Wiring it up would break ruling 1 (it is an avatar
  ring); deleting it needs founder permission. Left as-is, flagged.
- Entry ribbon visual tiers at L11/L51, pending the entrance-banner art
  (`docs/ENTRY_BANNER_ART_SPEC.md`, `docs/ENTRY_BANNER_PROMPTS.md`).
- Streamer-side controls for the ribbons: `functions/streamJoins.js` READS
  `joinAnnounce` settings, nothing writes them.
- Firestore TTL policy on `streams/{id}/joins` (console action).
- Achievements engine (section 8) and the creator track (section 7).
- `functions/scripts/backfillVpLevels.js --apply` still needs a run so existing
  accounts get a `vpLevel` (needs `GOOGLE_APPLICATION_CREDENTIALS`).


## ▶ DOCUMENT MAP AND BUILD STATE (keep current)

| Doc | What it holds |
|---|---|
| **this file** | The gamification system: the ladder, both tracks, achievements, owner choices |
| `docs/ENTRY_ANNOUNCEMENTS_SPEC.md` | Entry ribbons: behaviour, placement, security, throttle, acceptance criteria, **and a BUILD STATE block at the top** |
| `docs/ENTRY_BANNER_ART_SPEC.md` | Measured reference analysis, the 11 rank palettes, 4 unresolved colour conflicts, asset delivery |
| `docs/ENTRY_BANNER_PROMPTS.md` | 11 paste-ready image-generation prompts for the backgrounds |

**Shipped so far (2026-08-23):**
- ✅ **Entry ribbons, end to end** (the first T1 reward). Server-authoritative
  `announceStreamJoin`, rules locked against the spoofing hole, rank-themed 4:1
  ribbon UI in `JoinAnnouncer.jsx`, palettes in `src/utils/rankBanners.js`.
  Background art is pending (founder generating); a CSS fallback ships meanwhile.
- ✅ **A108 engagement VP wired** (create_post, get_comment, go_live, stream_hour)
  with per-day caps in `functions/engagementVp.js`.
- ✅ A107 dead commission copy removed; A109 stale gems copy removed.

- ✅ **Phase 0 defects, all three fixed and deployed:**
  - **A110** `syncVpLevel` trigger (`functions/vpLevel.js`) keeps
    `users/{uid}.vpLevel` in step with `wallets/{uid}.vp`, one trigger rather than
    a write at each of the dozen VP grant sites. `vpLevel` added to the
    server-only denylist in `firestore.rules` because it now gates rewards.
    `EditProfileScreen` also derives YOUR OWN level from your loaded wallet, so
    avatar frames unlocked immediately rather than waiting for the next VP change.
  - **A111** `LevelUpWatcher` (`src/components/engagement/LevelUpWatcher.jsx`)
    mounted app-wide in `AppRouter`; fires the previously dead
    `LevelUpCelebration` once per level, remembered per user in localStorage, and
    deliberately silent on first sight of an account on a new device.
  - **A112** the unobtainable coin figures are gone from the Prestige tab.

- 🟡 **Rank identity, scoped to LIVE ONLY (founder ruling 2026-08-23).**
  `src/components/RankBadge.jsx`, silent below L11 so the badge stays a signal.
  **Rank appears in exactly two places: the live-stream entrance ribbon and live
  stream chat.** It was briefly added to the feed, comments, followers, search and
  the DM header; the founder ruled that out, and it was reverted. Rank must also
  never interfere with the live ring or the status ring on an avatar, which is why
  `UserAvatar.showTierRing` stays false everywhere.
  - **Cost rule learned the hard way:** the first build resolved a chatter's rank
    with a Firestore read per unique sender. That was wrong twice over: it cost
    money per viewer, and it was unnecessary. `vergr-chat` **has full source at
    `infra/chat/src/`** (CLAUDE.md claimed otherwise and was corrected), and the
    relay already loads each sender's user doc ONCE PER CONNECTION to stamp name,
    avatar, Vanguard rank and the member gem. VP level now rides along in that
    same struct, so the crest costs **zero extra reads, ever**. The client just
    renders `m.vpLevel`. `src/utils/rankLookup.js` is deleted.

**⏳ BLOCKED ON A ONE-OFF RUN:** `functions/scripts/backfillVpLevels.js` populates
`users/{uid}.vpLevel` for existing accounts. Until it runs, badges appear only as
each user next earns VP (the trigger fires on wallet change). Needs credentials:
`GOOGLE_APPLICATION_CREDENTIALS=/path/key.json node scripts/backfillVpLevels.js --apply`
(dry run without `--apply`).

**Still NOT built, so this section is not finished:** the `RANK_UNLOCKS` table and
every L1 to L20 density unlock (section 5), chat name colour, profile accent
colour, the trophy case, rank-up push notifications, the achievements engine
(section 8), the creator track (section 7), and the streamer controls for the
ribbons (`ENTRY_ANNOUNCEMENTS_SPEC.md` §7).

**Next up, in order:** the `RANK_UNLOCKS` table plus the L1 to L20 unlocks,
rank-up push, then the achievements engine.

⚠ **Still needs the founder:** the 12 owner choices in section 11, the 4 colour
conflicts in `ENTRY_BANNER_ART_SPEC.md` §4, and the background art.

---

## 1. What was wrong with revision 1, and the principle that fixes it

Revision 1 proposed profile accent colours, frames, themes and a trophy case. The
founder's answer was an **entry banner when you walk into a live stream**, and
that single example is worth more than my whole list. Here is why, stated as the
principle this revision is built on:

> **I ranked rewards by how cheap they were to build. The right axis is how
> publicly they are witnessed.**

Status is worthless in private. A profile accent colour is seen by whoever opens
your settings, which is you. An entry banner is seen by **every person in the room
at the moment you arrive**, and it makes the host say your name out loud. That
parasocial hit, being recognised in front of an audience, is the thing people
chase and the thing people pay for on TikTok Live, Bigo and Twitch.

I also misapplied the zero-cost rule. "No new paid services" is a constraint on
**vendors**, not on ambition. Building a rich entrance moment costs engineering
time, not money, and I used the cost rule as an excuse to stay small.

### The witness tiers

Every reward in this plan is classified by where it lands:

| Tier | Where it is witnessed | Behavioural power |
|---|---|---|
| **T1** | Live, in front of an audience, in real time (stream entry, stream chat, gifts, host reaction) | Highest. Drives spend and repeat attendance. |
| **T2** | Asynchronously, by other individuals (comments, profile, feed, squads, DMs) | Medium. Drives identity and retention. |
| **T3** | Privately, by the user alone (settings cosmetics, inventory) | Lowest. Nice, but it changes nothing. |

Revision 1 was almost entirely T3, which was too timid. But **T1 alone is the
opposite mistake, and it is just as wrong.**

**The two tiers are halves of the same curve, not alternatives.** T1 spectacle
only works while it is rare, so it has to be gated to high ranks. Yet almost
every user lives between L1 and L20 (section 3). So a T1-only design gives the
entire population nothing, and the loop never starts. Conversely a T3-only design
gives people trinkets and nothing to climb toward.

The rule this plan actually follows:

> **Reward density carries the early game; witness tier escalates with rank.**
> Levels 1 to 20 pay out often, in small private and semi-public ways. Levels 20
> to 50 make your status visible to individuals. Levels 50 to 100 make it visible
> to entire rooms. Something at every level, escalating in *who sees it*.

Section 5 is the single unified ladder that does this. Sections 4, 6 and 7 are
the reward pools it draws from.

---

## 2. What VP gives today, verified

For a viewer **and** a creator, reaching a higher rank grants:

| Reward | Source | Real? |
|---|---|---|
| Rank name (Rookie to Immortal) | `vpSystem.js` `RANK_TIERS` | cosmetic, T3 |
| Coloured avatar ring | `RANK_TIERS.ringColor` | cosmetic, T2 |
| 30 collectible crests | `badgeSystem.js`, `public/badges/*.webp` | cosmetic, T3 |
| Animated crest at Mythic+ | `RankCrest` `prestige-float` | cosmetic, T3 |
| 5 avatar frames, 3 level-gated | `EditProfileScreen` `FRAMES` | **broken, A110** |
| Prestige badges and coins | `PRESTIGE_REWARDS` | **not implemented, A112** |
| Higher tip-target surfacing | `computeLikelyTipperScore` (VP is 10%) | invisible to the user |

That is the whole list. Nothing you can *do* at rank 40 that you cannot do at
rank 1. **Zero T1 rewards exist today.**

**Did I create the crests?** No. The 30 images already existed (your art). I
verified they are present and correctly mapped. No new art has been drawn.

### Defects found while tracing (logged as A110 to A112)

- **A110. `users/{uid}.vpLevel` is never written by anything.** Verified by
  grepping every `.js`/`.jsx`: it only appears as a local const or a read with a
  `|| 1` fallback. So **avatar frames are permanently locked for every user**, and
  every squad list, Browse Players and invite picker shows "Lvl 1" for everyone,
  while profile screens compute the level correctly from `wallet.vp`. The app
  disagrees with itself.
- **A111. `LevelUpCelebration` is imported by nothing.** Leveling up is silent.
- **A112. Prestige has no server implementation**, yet advertises 500 to 5,000
  coins across 10 prestige levels.

---

## 3. The core problem

**VP is a creator currency shown to everyone.** The viewer-shaped entries in
`VP_ACTIONS` (`like_post` 1, `comment_post` 3, `watch_stream_hour` 5,
`squad_message` 1) award **nothing** and are not even displayed. After the A108
work the live earn paths are login, streak, receiving a like, tipping, quests,
buying coins, buying a boost, posting, receiving a comment, going live, and
stream hours. Read as a pure viewer: **about 10 VP a day.**

L2 costs 2,000 VP, so that viewer waits months for their first level. The first
functional unlock sits at L41 and is broken anyway. There are 11 ranks and in
practice everyone lives in the first one.

So: rewards must be **dense from L1 to L20**, and the good ones must be **T1**.

---

## 4. Track T1: the live stream, where this system should actually live

### 4.1 Entry banners (the anchor mechanic)

**What it is.** When you enter a live stream, the room sees an announcement whose
grandeur scales with your rank. This is the mechanic that makes rank *mean*
something, because it converts a number into a moment in front of an audience.

⚠ **The scaling ladder that was here is RETRACTED, and the full spec now lives in
`docs/ENTRY_ANNOUNCEMENTS_SPEC.md`.** It was written without reading the code, and
it was wrong in two ways that matter:

1. **This feature already exists.** `src/components/streams/JoinAnnouncer.jsx` is
   built and wired into four surfaces, fed by `useStreamJoinEvents` and the
   `streams/{id}/joins` subcollection. The work is to EXTEND it with rank, not to
   design it from scratch.
2. **It violated a founder rule already written in that file**
   (`JoinAnnouncer.jsx:3-7`): *"NEVER full-screen. TikTok-sized, not
   awards-show."* My "cinematic entrance that dims the stream" is exactly what
   that rule forbids. Withdrawn.

The corrected model, specced properly in the spec doc: **relationship decides IF
you get a card (follower, subscriber, or a stranger at rank L31+), and rank
decides how the card is DRESSED** (rank ring, crest chip, a border sweep at L71, a
shimmer at L91). Escalation is richness inside a 280px card, never size.

The spec also covers what a wishlist cannot: exact placement and z-index per
surface, the queue and throttle algorithm, the data contract, streamer controls,
nine edge cases, eleven acceptance criteria, and a blocker (below).

**Why it works.** It is scarce (rank-gated), witnessed (whole room), repeatable
(every entry), and it triggers the real payoff: the host greets you by name.

**The second-order design work, which is the part that decides if it ships well:**

- **It must also fire on the broadcaster's OBS overlay**, not only in the app.
  The host looking up and saying "yo, Verion's here" is the actual reward. Without
  that, it is just chat decoration. An overlay pack already exists
  (`TournamentOverlayNeon`, `/overlay/...` routes) to model this on.
- **Throttling is mandatory.** In a 500-viewer stream, unthrottled entries destroy
  chat. Rules: a global cooldown (at most one banner every N seconds, queue the
  rest), only one banner per user per stream per session (no re-entry farming),
  and low ranks get nothing by design.
- **Streamer controls are mandatory.** Per-stream toggles: banners on/off, minimum
  rank, sound on/off. A creator whose chat is being drowned will otherwise just
  hate the feature. This also makes it a creator-side lever ("I want my whales
  celebrated").
- **Muting and blocking must suppress it.** A blocked user must never get a
  cinematic entrance into someone's room.
- **Accessibility.** Respect `prefers-reduced-motion` (the codebase already does
  this in `surface.css`) and never rely on sound alone.

**⚠ BLOCKER found while speccing this: the join write is spoofable.**
`firestore.rules:1846` allows any signed-in user to create a join doc in **any**
stream, validating only that `uid` matches the caller. Every other field is
client-supplied, so today anyone can already fake `tier:'pro'` to get the gold
subscriber treatment in someone else's room, and can spam unlimited join docs
(no rate limit), which is both announcement spam and a write-cost attack on a
stream they do not own.

**If rank drives the entrance, this becomes "anyone can be Immortal in anyone's
room".** So the fix comes first: an `announceStreamJoin` callable resolves rank,
follower and subscriber state server-side, rules drop to `allow create: if false`,
and the callable also owns the throttle and the block/mute suppression. Full
detail and two alternatives in the spec.

Two more real defects the spec turned up: the mobile card is anchored to a
constant chat height so **it floats detached when the keyboard opens**, and
**announcements silently vanish in fullscreen**. There is also still **no TTL
policy on `streams/{id}/joins`**, so that subcollection grows forever.

### 4.2 The rest of the T1 family (same room, same audience)

These share the entry banner's engine and multiply its effect:

1. **Rank-styled chat messages.** Name in rank colour, rank badge beside it, and
   at high ranks the message itself gets a gradient border. This is the Twitch
   sub-badge effect and it is the strongest everyday driver of chat participation.
2. **Host-visible highlighting.** High-rank messages are visually prioritised in
   the broadcaster's chat view so the streamer actually *sees and answers* them.
   The reward is being talked to, which is what viewers actually want.
3. **Viewer list ordering.** The audience list sorts by rank with crests shown, so
   the room can see who is in it.
4. **Gift and tip animations that scale with rank.** The same 100-coin tip lands
   bigger for a Legend. This directly couples rank to spending.
5. **A persistent supporter throne.** The current top supporter of a stream gets a
   crown next to their name for the session. A gifters board already exists to
   build on. Supporter status is the single strongest spend lever on comparable
   platforms, because being #1 is worth paying to defend.
6. **Rank-gated emotes in stream chat**, visible to everyone, so using one
   advertises the rank.
7. **Queue priority when a stream hits its viewer cap.** A real utility that only
   matters when you are popular, and costs nothing.
8. **Entry effect variants purchasable with coins** once the rank unlocks the
   slot. This is a legitimate coin sink and a direct revenue mechanic. Rank grants
   the right to have an entrance, coins choose which one. **OC5.**

---

## 5. The unified ladder: something at every level

This is the merge. The left columns are the dense early rewards (cheap, mostly
T3/T2, and they are what makes levels 2 to 20 worth reaching). The right column is
the escalating stream treatment from section 4. **Both run on the same ladder.**

Levels and items are your dial; this is the shape.

| Level | Unlock (density) | What the room sees (witness) |
|---|---|---|
| 1 | Rookie crest, base frame | nothing, by design |
| 2 | Profile accent colour (existing backlog TODO) | |
| 3 | Chat name colour, starter set | your name is coloured in chat |
| 4 | 3 extra reaction emotes | |
| 5 | Second avatar frame, + 1 Stream Boost token | |
| 6 | Profile theme variant | |
| 7 | Comment highlight tint | your comments stand out |
| 8 | Extra pinned post slot | |
| 9 | Emote pack II | |
| **10** | **Contender: bronze ring, crest II** | **rank badge beside your name everywhere** |
| 11 to 19 | one small unlock per level (emotes, frames, themes, tokens) | **entry notice: a tinted one-line "joined" in rank colour** |
| **20** | **Rival: silver ring, crest III, trophy case on profile** | viewer list sorts you up with your crest |
| 21 to 30 | cosmetic + utility alternating | |
| **30** | Challenger band begins | rank-gated stream emotes |
| 31 to 50 | frames, themes, audio name clip, extra profile links | **slim entry banner slides across the chat header** |
| **50** | **Champion: animated avatar ring** | **full-width entry banner over the video, crest animates in** |
| 51 to 70 | escalating cosmetics, boost tokens | host-side message highlighting |
| **70** | Legend band | **entry particles + entry sound** |
| 71 to 90 | rare cosmetics, seasonal slots | gift animations scale up |
| **90** | Mythic / Ascendant | |
| **100** | **Immortal: name glow, exclusive emote, permanent badge** | **cinematic entrance: stream dims, crest resolves centre-screen** |

Two things this table is doing deliberately:

1. **No dead levels.** Every level pays something, even if small. Revision 1's
   real defect was not that cosmetics are bad, it is that today L2 to L40 give
   literally nothing.
2. **The reward you can see from L1 is the reward you cannot have yet.** A new
   user watching a Champion's banner sweep the screen learns the ladder exists in
   one second, without reading a page about it.

## 6. Reward pool: T2, profile, comments, feed, squads

Lower power than T1, still worth building, and cheap:

- **Rank badge beside your name everywhere** (comments, DMs, squads, followers
  lists). One change, enormous surface coverage.
- **Trophy case on the profile**, pinning your best achievement badges.
- **Profile entrance animation** when a visitor opens your profile at high rank.
- **Comment highlighting** at high rank, so your comments carry visible weight.
- **Audio name clip** (already a backlog item in CLAUDE.md's edit-profile TODO):
  a 2 second voice clip that plays on profile open. Distinctive and cheap.
- **Rank-coloured name in the feed.**
- **Squad contribution:** your rank contributes to a squad-level score, so squads
  recruit high-rank members. This turns individual progress into social pressure,
  which is the cheapest retention mechanic that exists.
- **Rank-gated squad roles and rank-gated private squads.**

## 6b. Reward pool: T3, private cosmetics

Frames, themes, accent colours, inventory, audio name clip. **These carry levels 1
to 20**, which is where your entire user base actually is, so they are not filler.
What they should not be is the *headline* unlock of a high rank: by L50 the
headline has to be something a room can see.

---

## 7. The creator side

Creators want reach, credibility, tools and community, and they are already paid
through revenue share, so **rank must never pay them money** (locked rule).

| Band | Unlock | Why |
|---|---|---|
| L10 | Rank badge on stream and profile | credibility to a stranger choosing whether to watch |
| L15 | 1 free Stream Boost token per month | boost costs 50 coins for free users, so this is real value with **no liability** (section 9) |
| L20 | Custom stream overlay theme, custom entry-banner style for their own room | visible, differentiating |
| L25 | Small, capped listing priority in a game category | reach, the thing they want most (**OC6**) |
| L30 | Extra member emote slots; ability to grant a regular viewer a VIP entrance | lets creators reward their own community, which is a loop inside the loop |
| L40 | Creator programme eligibility, higher event ticket caps | access, not money |
| L50+ | Animated crest on stream, profile spotlight, beta feature access | status and tools |

Deliberately **excluded** because they are Lite or Pro capability: bitrate and
resolution, upload size, 4K photos, advanced analytics, scheduled posts, replay
retention. Giving these away teaches users to grind instead of subscribe.

---

## 8. Achievements: the second engine, and the fix for viewers

Rather than paying VP per like or per minute watched (spammy, farmable, needs
caps), pay **chunky one-time achievements**, server-verified. A one-time
achievement is un-farmable by construction, which is a far cleaner anti-abuse
answer than daily caps.

Categories, each granting VP plus a permanent trophy-case badge:

- **Getting started:** profile complete, first post, first follow, first comment,
  first squad. Teaches the app in the first session.
- **Loyalty:** 7 / 30 / 100 / 365-day streaks, one-year anniversary.
- **Social:** 10 / 100 / 1,000 followers, 50 comments written, led a squad.
- **Support (the spend driver):** first tip, tipped 5 creators, tipped 25
  creators, first membership, top supporter of a creator for a month.
- **Creation:** first clip, first short, first stream, 10 streams, 100 posts.
- **Events:** attended an event, hosted an event, sold 10 tickets.
- **Rare and seasonal:** launch-era founder badge, event participation. These are
  what people screenshot.

This is how a viewer earns real VP, so it fixes section 3 without adding faucets.

**Seasons.** A time-boxed track (rank-independent) with limited badges and entry
effects that expire is the strongest known return-daily mechanic. Free track only
unless you want a paid pass, which is a new SKU decision (**OC8**).

---

## 9. Guardrails, and the things that could go wrong

1. **Do not cannibalise Lite and Pro.** Paid sells capability; rank sells status
   and access. Today Lite and Pro already multiply VP (1.5x, 2x), so paying
   accelerates status, which is exactly the right relationship: **the gamification
   system is a subscription driver, not a competitor to one.**
2. **Coin grants are not free.** `sendTip` calls `earnedShareCredit` regardless of
   where the coins came from, so **granted coins, once tipped, accrue a real
   revenue-share liability in `owedMicroUsd` that Vergr genuinely owes**. A "free
   1,000 coins at L50" is real cash. Use Stream Boost tokens or cosmetics for
   headline rewards instead. **OC4.**
3. **⚠ No loot boxes, no randomised crates.** `public/llms.txt` states publicly
   that Vergr has no loot boxes or games of chance, and the compliance pages
   repeat it. A randomised "rank crate" would contradict a published compliance
   statement and is a regulatory problem in several markets. Every reward here is
   **deterministic**: you know exactly what a level gives before you reach it.
4. **Entry effects are an abuse surface.** Rate limits, per-session dedupe,
   streamer controls, and blocked-user suppression are requirements, not polish.
5. **Do not let rank bury new creators** in discovery. Any listing weight must be
   small and capped, or it fights the "For You is never blank" rule.
6. **Reduced motion and sound-off must be honoured.**

---

## 10. Architecture (so adding rewards later is data, not code)

- **`RANK_UNLOCKS`, a level-to-items table**, mirrored client and server. Permanent
  unlocks are **derived from level**, so there is no per-user inventory to store
  and no migration. Adding a reward later is a data change.
- **Consumables** (boost tokens, entry-effect variants) need real storage plus a
  grant ledger keyed `(uid, level, item)` for idempotency, the same pattern
  `quest_claims` already uses.
- **`vpLevel` must be denormalised onto the user doc** (A110) because squad lists,
  Browse Players and stream viewer lists read *other* users' docs where the wallet
  is not loaded. Everything in T1 and T2 depends on this one fix.
- **Entry banners ride the existing `system` channel** if the relay cooperates,
  with two no-relay-change fallbacks (section 4.1).

---

## 11. Owner choices

Nothing is built until you pick. Recommendation given, decision yours.

**OC1. Badge vs crest.** They are the same 30 files today, presented as two
systems. Either (A) unify the wording, or (B) **crest = your current rank
identity (11, replaced as you rank up), badges = a permanent achievement trophy
case**. *Recommend B.*

**OC2. Fix `vpLevel` (A110).** Denormalise onto the user doc, or move consumers to
`wallet.vp`. *Recommend denormalise.* This is a bug fix and a hard dependency for
almost everything above, so it should happen regardless.

**OC3. Build order across the ladder.** The ladder in section 5 needs both halves,
so this is a sequencing question, not an either/or. *Recommend building the dense
L1 to L20 unlocks and the entry banner in parallel*: the early unlocks are what
makes the system work for the people you already have, and the entry banner is
what makes the whole ladder legible and worth climbing. Doing only one of them
fails for the reason given in section 1.

**OC4. Are coin grants ever allowed as rewards?** *Recommend no*, per section 9.2.

**OC5. May coins buy entry-effect variants once rank unlocks the slot?** This is a
genuine new revenue line and a coin sink. *Recommend yes, later*, after the free
rank-based version proves out.

**OC6. May rank affect discovery or listing order?** *Recommend yes, tiny and
capped, creator track only.*

**OC7. Pacing.** L2 at 2,000 VP means a viewer waits months for their first level.
Either leave the curve and let achievements carry viewers, or **lower early-level
costs so L1 to L10 is fast and the curve steepens later**. *Recommend the latter
plus achievements*: the first level-up has to land in week one or the loop never
starts. This changes an economy constant, so it is explicitly yours.

**OC8. Seasons.** Free-only track, or a paid pass (new SKU, new store review
surface, and it interacts with Play billing). *Recommend free-only first.*

**OC9. Prestige (A112).** Implement it, or remove the unobtainable coin figures
now. *Recommend removing the figures immediately*, implement later.

**OC10. Do achievements award VP?** *Recommend yes.* Coins, *recommend no*.

**OC11. May rank raise squad ownership slots?** `MAX_SQUAD_OWN` is deliberately
flat at 1. Your call.

**OC12. Do Lite and Pro also get exclusive cosmetics**, or stay purely a VP
multiplier? Plan-exclusive entry effects would be a strong subscription lever.

---

## 12. Build phases

**Phase 0, defects (no decisions needed, can start now):**
fix `vpLevel` (A110), wire `LevelUpCelebration` plus a rank-up push (A111), make
prestige honest (A112), settle badge vs crest wording (OC1).

**Phase 1, both halves of the ladder in parallel:**
(a) the `RANK_UNLOCKS` table plus the dense L1 to L20 unlocks (accent colour, chat
name colour, frames, emotes, pinned slots), so the early game stops being empty;
(b) entry banners end to end (relay test, client render, broadcaster overlay,
throttling, streamer controls), rank-styled chat names and badges, host-side
highlighting.

**Phase 2, T1 economy:** supporter throne, rank-scaled gift animations, rank-gated
emotes.

**Phase 3, achievements engine:** schema, server verifiers, trophy case, VP
awards, badge art.

**Phase 4:** creator utilities (boost tokens, overlay themes, listing priority),
then seasons and prestige.

---

## 13. UI and UX fixes for /prestige, independent of the above

- "How to earn" is tab 5 of 6 and sits off-screen on mobile. The behaviours you
  want repeated are hidden behind a horizontal scroll. Promote it.
- The hero reads "739 VP to Level 2 (Rookie)" while you are already Rookie.
- The badge grid has no completion pull beyond the "1/30" pill. Always show the
  next unlock and what it takes.
- There is no rank-up moment anywhere in the product.
- The page never answers "what do I get", because today the answer is nothing.
  That is the real fix, and it is everything above.
