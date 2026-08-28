# Vergr update log

Running record of what changed, session by session, newest first. Written so a
second session (or a second machine) can pick up without re-auditing.

**Rules for this file:**
- Every entry states **SHIPPED**, **DEPLOYED**, or **SOURCE ONLY**. "Done" on its
  own is banned; it is how stale claims get repeated as fact.
- File paths carry line numbers where a reader would otherwise have to hunt.
- Anything awaiting a founder decision goes in its own section, not buried in prose.
- Verify against the source before trusting an entry. If they disagree, the source
  wins and this file gets corrected.

---

## Boost flow finished: target picker + the dead stream SKU removed (2026-08-28) — SHIPPED + DEPLOYED

Founder, on being handed open items instead of finished ones. Both were mine to close.

**1. The flow could not complete.** `BoostScreen` read its target from `?id=` in
the URL, so arriving from the wallet Boosts tab (which has no id) landed you on a
screen that could not buy anything — and after the ownership fix the server
rightly refuses a null target. `BoostScreen` now has a **picker**: choosing a
post/squad boost lists what you own (`getUserPosts` / `getUserSquads`, filtered to
`ownerId === uid`), with an honest empty state that routes to /create or /squads.
LFG boosts list only `type === 'lfg'` posts and post boosts exclude them, so
nobody pays 25 coins to boost a photo.

**2. `BOOST_COSTS.stream` DELETED** from `src/utils/vpSystem.js` and the
`functions/walletActions.js` mirror. It sold 60 coins for 4 hours "pinned to the
Live tab", a pin nothing read, while `BOOST_TIERS.boost` sells 50 coins for real
discovery reach and is honoured. Two products, one name. `purchaseBoost` keeps an
explicit refusal for `type === 'stream'` so a stale client gets a message naming
the real one rather than a generic error.

⚠ Ownership is checked SERVER-side in the transaction; the picker list is
convenience, not the boundary.

---
## Every paid boost was buying nothing. Now wired (2026-08-28) — SHIPPED + DEPLOYED

Founder: *"i dont even know what an LFG boost is so how the fuck is a user going
to know?"* Checking the copy exposed something worse: `collection('boosts')`
appeared **exactly once** in the repo, the write in `purchaseBoost`. Nothing read
it and the target doc was never touched, so Post / Profile / LFG / Squad Boost
were coin debits with no effect.

**Mechanic** (the one `streamBoost.js` uses): server stamps `boostExpiresAt`
millis on the TARGET doc, expiry at read time, no cron, single-field inequality
so no composite index. Reader side `src/utils/promoBoost.js`.

| Boost | Target | Reader |
|---|---|---|
| Post | `posts/{id}` | `feedRank.scorePost` × POST_BOOST_REACH (3) |
| Teammate Search (was LFG) | `posts/{id}` | same |
| Profile | `users/{uid}` | `HomeFeedRail`, `DiscoveryStrip` |
| Squad | `squads/{id}` | `getSquads` |

Each reader runs its OWN `boostExpiresAt > now` query and merges with
`mergeBoostedFirst` — the primary sort can never surface something that just paid.

**Security fixed in the same pass:**
- `boostExpiresAt` + `boostedAt` are now SERVER-ONLY in firestore.rules on
  `posts`, `squads` AND `users`. `posts` granted the author write on any field and
  `squads` granted a squad admin the same, so a user could self-stamp the boost
  and take the paid 3x for free.
- `purchaseBoost` reads the target in-transaction and rejects a non-owner.
  `targetId` was previously unvalidated.
- Boosts EXTEND rather than reset.
- Post multiplier guarded on `s > 0`; ×3 on a negative score demotes further.

**Copy** now names the outcome, not our surfaces. `lfg` renamed **Teammate Search
Boost**: there is no LFG list to pin to, an LFG post is a post, so it is a
cheaper/shorter post boost. `BOOST_COSTS.stream` now REFUSES with a pointer to the
real one (it collides with `BOOST_TIERS.boost`).

⚠ **NOT LIVE-TESTED.** Needs an account with 50+ coins to buy a post boost and a
second account to confirm the post ranks higher. The @vergr account has 24.

---
## Shop: one card, three tones; bonuses + boosts on the buy screen (2026-08-28) — SHIPPED

Founder: *"shouldnt we have a tab on the buy coins screen? and what about the
other packs like post boost"* and *"The card design should be the same as the coin
packs but with a different colour."*

- **`src/components/wallet/StorePackCard.jsx`** — the coin-pack treatment lifted
  verbatim (top-lit gradient, bloom, fixed 132px art box, footer price shelf),
  parameterised by tone: `gold` coins / `violet` VP bonuses / `ember` boosts.
  Violet was not invented: `COIN_PACKS` with `badgeStyle: 'vp'` already render
  violet on that screen.
- **`src/components/wallet/StoreTabs.jsx`** — `BonusPacksTab` + `BoostsTab`,
  shared by `/wallet/buy`, its NATIVE mirror and `/prestige`, with a `compact`
  2-up grid for native so it matches `NativePackCard` one tab away.
- `BonusShop` on `/prestige` now renders the shared card instead of its own.

⚠ The live buy screen is `wallet/v2/BuyScreen.jsx`.
`src/screens/wallet/BuyCoinsScreen.jsx` is UNROUTED dead code still referencing
`FIRST_PURCHASE_DISCOUNT` and NOWPayments.

⚠ Only `profile` boost is bought from the tab. Post/squad/LFG boost a SPECIFIC
thing, so they route to `/boost` where the target is chosen — selling one with
`targetId: null` would charge for a boost that promotes nothing.

⚠ `BOOST_COSTS.stream` (60c/4h, "pinned to Live tab") is omitted: it collides by
name with `BOOST_TIERS.boost` (50c/15min discovery reach). **Two products, one
name, different prices.** Still reachable on `/boost`. Needs resolving.

---
## VP bonus packs built — timed multipliers, coins only (2026-08-28) — SHIPPED

Founder: *"they cant be purchased using VP, only with coins, BUT they should be
added to the VP ladder rewards."*

Nine packs. `src/utils/vpBonuses.js` (source of truth) + `functions/vpBonuses.js`
(mirror + `purchaseVpBonus`) + `src/components/prestige/BonusShop.jsx`, mounted as
a **VP bonuses** tab on `/prestige`.

- Six durations: Happy Hour 1h/3x 25c, Flash 6h/3x 75c, Half-Day 12h/2.5x 120c,
  Day 24h/2x 200c, Weekend 48h/1.75x 350c, Long 7d/1.5x 900c.
- Three focused (24h/3x, cheaper, scoped): Creator 150c, Community 150c, Watcher 100c.
- Stored on `users/{uid}.vpBonuses`, resolved in `engagementVp.js` and
  `walletActions.js` off the userSnap they already read — **zero extra reads**.
- Expiry at READ time, no cron. Stacking additive on the excess, ceiling 3.0,
  the same rule `boostReach()` uses.
- `planMultiplier(uid, action)` gained the action argument so a scoped pack does
  not pay on actions it does not name.
- `vpBonuses` locked SERVER-ONLY in firestore.rules.

**Ladder:** `BONUS_LADDER_LEVELS` gives 14 levels a pack instead of a boost token
(10, 19, 29, 39, 42, 48, 55, 59, 69, 77, 87, 94, 96, 98). **L93-99 is no longer
seven identical rows**, and no two consecutive levels grant the same thing
anywhere. Boost tokens 37 levels → 23, 47 tokens total.

**Guards:** per-pack mirror (mult, hours, coins, scope), pack count, ceiling,
ladder-level map vs `vpLevel.js`, that `grantBonusPack` is actually called, and
that **no `vp:` price exists on either side**. Negative-tested: an overcharged
price and a silently widened scope were both caught. `npm run check` = **2107**.

⚠ **ART NOT YET MADE.** `PackArt` falls back to the multiplier in the gold ramp.
Prompts + output spec in `docs/VP_BONUS_PACKS_PLAN.md` §12; renders go to
`public/brand/bonuses/<art-id>.webp` 288 + `@2x` and appear with no code change.

⚠ **NOT BUILT, each a different mechanic:** Open Bar (cap lift), Streak Shield
(streak counters), Squad Surge (treasury fan-out). L100 answer still open.

---
## VP ladder COMPLETE — 100/100, no hollow levels (2026-08-27) — SHIPPED + DEPLOYED

Founder: *"I have already told you how boosts will work in the VP ladder, we are
using them to fill empty gaps."*

`BOOST_TOKEN_LEVELS` **11 -> 37** (`src/utils/rankUnlocks.js:341`), mirrored in
`functions/vpLevel.js:37`. Filled: 10, 19, 22, 29, 34, 39, 42, 43, 48, 53, 58, 59,
69, 74, 77, 78, 80, 82, 87, 89, 94, 95, 96, 97, 98, 99.

Checked before filling, not assumed: **every built cosmetic already had a level**
(fonts 18 = 15 drip-fed + 3 free, chat themes 8/8, accents 12/12, gradients 7 + 1
free, typing 5 + 1 free). Boost tokens or nonexistent content were the only options.

**New guard:** `assertNoHollowLevels()` in `rankUnlocks.js` counts rows that are
NOT `vprate_`; `vp-mirror-check.mjs` fails the build on any level returning zero.
`assertNoDeadLevels` never was coverage — it was green while 56 levels were hollow.
Negative-tested: removing 95 and 96 made it name them.

**Guard bug fixed:** the boost mirror parsed the server array with a bare
`split(',')`, so the trailing comma on the multi-line array invented a phantom
level 0 and failed a correct mirror.

Copy fixed: the boost ladder row said "so a public stream costs you nothing",
which died with the 50-coin gate.

`npm run check` = **2064**. Deployed: hosting + `syncVpLevel`.

⚠ **OPEN FOR THE FOUNDER:** L93-99 is seven consecutive boost tokens (also 42-43,
58-59, 76-78). Options in `docs/effects/26-LADDER-COVERAGE.md`: more tokens per
level (no schema change) or a higher-tier token (schema change — the wallet holds
one flat `boostTokens` count). Both are economy decisions.

⚠ **Version bumped to 1.0.205** across `appVersion.js`, `tauri.conf.json` and
`version.json`, with rewritten release notes. **APK and desktop NOT YET BUILT.**
1.0.204 APK is already published on the CDN (23 Aug); desktop last shipped 1.0.199.

---
## eslint added, eight latent defects fixed (2026-08-27) — SHIPPED + DEPLOYED

`eslint.config.mjs`, `npm run lint`, first step of `npm run check` so it gates
every build. Three rules, all crash-class: `no-undef`, `react/jsx-no-undef`,
`react-hooks/rules-of-hooks`. `exhaustive-deps` deliberately off. Negative-tested
against a probe file carrying all three faults.

Driver: four unimported identifiers shipped in a single session and `vite build`
was green every time.

**Fixed (three on live screens):**
- `src/screens/profile/EditProfileScreen.jsx:114,121,397` — `ProfileImagesTab`
  read `myVpLevel` out of a SIBLING component's scope. Profile Images tab threw
  on render, web and native. New module-scope `ownVpLevel(wallet, profile)`.
- `src/screens/profile/native/NativeProfileScreens.jsx:391` — same shape:
  `NativePublicProfileScreen` read `accentHex` from `NativeProfileScreen`. Threw
  for every visitor, and would have shown the viewer's accent. Now `accentFor(user)`.
- `src/components/streams/StreamShareSheet.jsx` — `useState` below an early
  return (#310 risk). Hoisted above it.
- `src/components/tournament/SeriesScoreboard.jsx` — bo1 early return above a
  `useMemo`; `seriesFormat` comes off the live match doc so the count can change.
- `src/components/tournament/SpectatorPanels.jsx` — `IS_STORE_BUILD` returned
  before every hook; the effect now skips its listener instead, Play build unchanged.
- `src/components/tournaments/BRScoreboard.jsx` — `<Header>` used 4x, never defined.
- `src/screens/tournaments/MatchDetailsScreen.jsx:60` — `profile` never destructured.
- `seed-firestore.js:141` — stray `}` closed `seed()` early; the script had been
  a hard SyntaxError.

Also: the live-stream gift sheet header said "Tip" while the Boost tab was open
(`MobileLiveViewer.jsx:1495`, `ViewerStreamScreen.jsx:1482`). **SOURCE ONLY at
the time of the deploy above — it landed after that build and ships with the next one.**

## Effect 22 documented (2026-08-27) — DOC ONLY, awaiting a founder decision

`docs/effects/22-accent-presence.md`. Writing it up shrank the effect: "app-wide"
is the deleted theme system, and the effect-17 cut generalises to every
multi-user surface. Proposed scope is one-owner surfaces = the live stream,
at L94. Costs zero extra reads (both viewers already load the host user doc).
Fills one hollow Ascendant level, not six.

---
## Live smoke test of the crest work — four defects found (2026-08-27)

Founder: *"you expect me to believe that you have done that with no errors and
its working perfectly... in one try?"* No. Driven in his own Chrome, against
production, with his account raised to L100 so the crest could render at all.

⚠ **THE CREST COULD NOT RENDER ANYWHERE ON PRODUCTION.** Queried live: **zero
users at L11+**, and the admin account had no `vpLevel` field at all. Everything
built across 11 surfaces was invisible to every account in existence. Not a bug
— but it means none of it had ever been seen.

**Four real defects, all found by rendering, none by the build or the guards:**

1. ⚠ **An admin allowance on the crest put an ASCENDANT crest beside the
   account's own ROOKIE pill**, with the sidebar reading LVL 2 — three rank
   claims on one screen, two of them true. `UserName` and `isEffectOn` resolve
   admin to L100 so COSMETICS can be previewed; a crest ASSERTS A RANK and may
   not be faked. Reverted, and asserted so it cannot return by analogy.
2. ⚠ **The crest was tappable in live chat ONLY.** The card was wired at the
   ChatPanel call site via `onOpen`, so on the profile, feed, lists and DMs the
   crest rendered and did nothing — the popup the founder asked for, delivered
   on one surface out of eleven. The popover now lives INSIDE `RankBadge`, so
   every crest is tappable with zero per-site wiring; `onOpen` survives as an
   override for ChatPanel, whose column is an overflow scroller.
3. ⚠ **The card read "Progress to level 101 — 100%"** on the L100 account,
   against a sidebar on the same screen correctly saying "Max level". There is
   no level 101. Now "Max level reached".
4. ⚠ **`BadgesShowcase` drew 32px badges from the 1024px source** — three of
   them, ~500 KB on every profile view. Now uses the 64px variants.

**Verified working, by rendering:** profile header crest (18px, small art),
post-card crest (13px), leaderboard podium crest, the card's content, and that
tapping a crest inside a clickable post card opens the card WITHOUT navigating.

**Verified by query, not inference:** the boost query
(`streams where boostExpiresAt > now`) returns HTTP 200 with **no composite index
required and rules permitting it** — the risk that mattered, since the app's
`.catch()` would have swallowed a failure into an empty list.

**Still unverified and honestly so:** live-chat crest and its sweep, the gift
menu's Boost tab, and any boost actually being spent — all need a real
broadcast. Search and the followers list could not be tested because the founder
is excluded from public enumeration and has no followers.

---

## Stream Boost actually works now (SHIPPED + DEPLOYED 2026-08-27)

⚠ **IT DID NOTHING BEFORE.** `streams/{id}.boosted` was read in exactly one place
per surface — to draw a badge. Every live list (ExploreScreen,
NativeExploreScreen, LiveUsersContext, HomeFeedRail) queried Firestore directly
with `orderBy(viewerCount)`. The 1.5x `BOOST_REACH_MULTIPLIER` lived inside
`getLiveDiscoveryFeed`, a deployed callable **nothing in src/ ever called**. So a
user paid 50 coins for a badge, while the help centre told them it pushed their
stream in discovery. Same shape as the three inert kill switches.

**Founder decisions, 2026-08-27:** three paid tiers; an earned VP token spends as
a boost on ANY stream, including someone else's; stacking with a hard ceiling;
every boost time-limited with a visible TikTok-style countdown.

| Tier | Coins | Reach | Minutes |
|---|---|---|---|
| Boost | 50 | 1.5x | 15 |
| Super Boost | 150 | 2.5x | 30 |
| Mega Boost | 500 | 4x + feed rail | 60 |

⚠ **STACKING IS ADDITIVE ON THE EXCESS**, not multiplicative: two 1.5x boosts
give 2.0x, not 2.25x. Multiplying compounds so fast that four entry boosts would
blow past the 3.0x ceiling and make the tiers meaningless.

⚠ **A TOKEN ALWAYS REDEEMS AS THE ENTRY TIER.** Pairing `useToken` with `mega`
would turn a free rank reward into the 500-coin product.

⚠ **EXPIRY IS COMPUTED AT READ TIME, NEVER BY A CRON.** A sweep would bill for
doing nothing on most runs and still leave a window where an expired boost ranks.

**The piece that was missing entirely:** each list surface now runs
`rankStreams()` AND fires a second small query for currently-boosted streams.
Ordering the top-24-by-viewers can never surface a boosted stream with three
viewers, which is the whole thing a boost is bought for. `boostExpiresAt` is a
single-field inequality, so it needs no composite index.

**Interest matching cost nothing.** `feedRank.js` already inferred stream topics
inside `captureStreamInterest` — the app could LEARN what you like about streams
but had nothing to RANK them by it. Extracted as `inferStreamTopics` rather than
copied (two definitions of "what is this stream about" is how the theme systems
drifted); affinity comes from device-local counters.

⚠ **MY OWN SELF-CHECK WAS BOGUS.** The ExploreScreen imports did not land, the
build passed, and my verification grepped for the symbol ANYWHERE — matching the
usage rather than the import. Third time this class has bitten. Now a guard
assertion, negative-tested by deleting the import.

**Ladder:** boost tokens went 7 → 11, one per rank band.
`[5,14,26,41,50,76,93]` had TWO in Elite and NONE in Challenger, Champion,
Veteran or Mythic. Added 36, 55, 65, 86 — all previously hollow levels.
**Economy change, founder-authorised.** Mirrored in `functions/vpLevel.js`.

**Deliberately not wired:** `LiveUsersContext` fetches all 300 live streams to
light up avatars, so ranking is meaningless there. **Still to do:**
MobileLiveViewer's boost button.

Guard: `npm run check` **1,991**. `boostStream` verified live in europe-west1 via
`functions:list`, not from the deploy log.

---

## Ladder coverage: 44/100 rewarding → 70/100 (SHIPPED + DEPLOYED 2026-08-27)

Founder asked whether any levels give nothing. Measured: **56 of 100 gave only
the +0.5% VP earn rate** — nothing visible, equippable, or seen by anyone else.

⚠ **That is a planning failure, not a discovery.** Rewards were added one at a
time as each effect shipped and the ladder was never read end to end.
`assertNoDeadLevels` hid it by proving every level has a ROW — every level does,
because every level carries a `vprate_` row. A green guard measuring the wrong
thing is worse than no guard.

**The fix needed no new content.** 32 already-shipped items were being handed
over by 3 ladder rows: 18 typefaces at L3, 8 chat themes at L23, 6 typing styles
at L32. `PROFILE_ACCENTS` and `PROFILE_THEMES` were drip-fed one per level from
day one, so the pattern existed and was applied inconsistently. Now each item
carries its own `level` and the ladder builder emits a row per item.

⚠ **`nameFontFor` NEVER CHECKED THE LEVEL** — it was a bare `fontById()` lookup.
Survivable while one row granted all 18 faces; with a drip-feed it would have
rendered a face the user had not reached. Now mirrors `typingStyleFor`: rules
enforce the floor and the enum, the resolver enforces the per-item level.
`typingStyleFor` already did this correctly, so typing needed data only.

⚠ **THE MIGRATION WINDOW IS NOW AND WILL NOT REOPEN.** Spreading a pool takes
items away from anyone already above the new levels. Balances are test data and
nobody is above L2, so the cost is zero today; after real users it needs a
grandfather clause.

Two levels were nudged (`bars` 22→23, `orbit` 34→32) so the old `chat_theme` and
`typing_style` levels keep a reward and nothing regresses.

**Still hollow: 30 levels, and the one that matters is L94-99** — six in a row,
66,000 VP, immediately before L100. Options and the trade-offs are in
`docs/effects/26-LADDER-COVERAGE.md`; adding boost tokens is an economy change
and is deliberately left as a founder decision.

Guard: `npm run check` **1,971**, asserting every typeface, chat theme and typing
style has its own row at its own level and that no two share one. Negative-tested
by stacking two fonts.

Also: effect **17 (post-card accent) CUT** by the founder. Effects **16** and
**20** marked shipped on the scope table — both had been live for a day while
the table still said "unplaced".

---

## 21 — The living crest (SHIPPED + DEPLOYED 2026-08-27)

`animated_crest` at **L62** (Veteran L2), level only. The rank crest beside the
name in live stream chat gains an intermittent specular sweep. No new art: the
band is masked to the badge webp that already ships.

Doc: `docs/effects/21-animated-crest.md`. Harness:
`node scripts/crest-preview.mjs --measure` = **24/24, duty cycle 0.125**.

**The design decision that matters:** the sweep is 900ms of a 5,600ms cycle, so
**84% of the time nothing moves**, and the phase is hashed per uid. That is the
answer to "what happens when several people in one chat have it" — the question
the founder asked of the Golden Thread, and the reason that one was rejected.
Twitch does not permit animated chat badges at all (PNG, 25 KB, no animation),
which is the restraint bar this had to clear.

**Two real defects found while measuring, both pre-existing:**

1. ⚠ **The crest art is 1024x1024 and averages 167 KB, to paint a 13px icon.**
   30 files, 5,004 KB. A chat with eight rank bands present pulled ~1.4 MB and
   decoded eight 1024x1024 surfaces (4 MB of RGBA each).
   `scripts/build-badge-sizes.mjs` now emits 64px variants to
   `public/badges/sm/` — **1.9 KB average, -98.9%**. `RankBadge` uses those;
   `/prestige` renders at 96px and keeps the full-size art.
2. ⚠ **`/badges/` had no entry in `firebase.json`**, so it fell through to the
   catch-all no-store rule and every crest was re-downloaded in full on **every
   page load**. Now 7d browser / 30d CDN, matching the `/brand/` rule. Verified
   live by content-type, not status.

**Three visual defects that a green run did not catch** — a filled grey square
(the clip squaring off the crest's own halo), a white cut-out of the badge
sliding over the badge (the mask travelling with the band), and a grey sticker
instead of light (no additive blend). All three passed every number then being
checked; all three were found by rendering it and looking. Full account, and the
three times the TESTS were wrong, in doc section 9.

Guard: `npm run check` is **1,844** assertions, with new ones for the duty
cycle, the static mask, the additive blend, the glow padding and the small art.
Negative-tested: widening the duty cycle, dropping the uid prop, deleting a small
badge and removing the padding each fail it.

---

## 20 — Animated avatar (SHIPPED + DEPLOYED 2026-08-27)

`animated_avatar` at **L45**. ⚠ **NOTHING NEW WAS BUILT.** `uploadAvatar` already
passed a GIF/WebP/APNG through uncompressed; it just asked the wrong question
(`tier === 'pro'`). The founder overruled the Pro-only gate, so the question
moved to `canUseAnimatedAvatar()` — level OR Pro, same shape as
`canUseChatThemes()`.

L45 is deliberate: L41 already carries the Elite crest AND a boost token, and the
ladder's real gaps are BETWEEN band starts, not on them.

⚠ Costs **no extra Firestore read** — `uploadAvatar` already fetched the user doc
to resolve the tier, and the gate reads the same snapshot.

### ⚠ THE IMPORT WAS MISSING AND THE BUILD WENT GREEN

`uploadAvatar` shipped calling `canUseAnimatedAvatar()` with no import. `vite
build` passed; it would have thrown at runtime on the first avatar upload and
nowhere else. **This repo has no eslint** (no config, no dependency), so nothing
catches an undefined identifier.

New guard, `vp-mirror-check.mjs` §4f: any file CALLING a ladder gate
(`canUseAnimatedAvatar`, `isUnlocked`, `unlockLevel`, `accentFor`, `isEffectOn`)
must also IMPORT it. Deliberately narrow, to stay free of false positives.

⚠ Its first run flagged `utils/rankCollections.js`, which was a FALSE POSITIVE:
that file exports its OWN `accentFor`, a different function sharing the name. The
guard now skips a file that defines the identifier locally. Negative-tested both
ways — removing the import fails the run, restoring it passes.
`npm run check` is now **479 assertions**.

⚠ Note two different `accentFor` functions exist (`rankUnlocks.js` and the dead
`rankCollections.js`). Nothing imports rankCollections; it is the deleted theme
system kept on disk. Worth knowing before grepping that name.

## 2026-08-26 — Squad environments, effect 11 (SHIPPED + DEPLOYED + LIVE-VERIFIED)

Doc: `docs/effects/11-squad-environments.md`. `squad_environment` **L52**,
`squad_weather` **L73**. Six rooms, all procedural: no art file, no R2 object,
no hosting egress.

**An environment is not a background image.** Backdrop (a multi-stop scene) +
atmosphere (a capped canvas particle system) + light. Founder correction:
"the enviraments are more than just fucking backgrounds claude."

**Stored as a THIRD KIND on the existing `squads/{id}.chatBackground`**, not a
new `squads/{id}.environment` as the doc originally proposed. That field already
existed with `color`/`image` kinds. Two fields painting one surface is the bug
that killed `rankCollections.js` and that was found live on
`PublicProfileScreen.jsx` the same day.

⚠ **`isolation: isolate` on `.sqd .messages` (`src/styles/squad.css`) is
load-bearing.** Without it the `z-index:-1` canvas escapes to the root stacking
context and paints behind the section's own background — the weather renders and
is invisible. Removing it silently disables every environment.

⚠ **Researched only after the founder asked whether I had.** I had not; doc 11
§1 covers parallax technique only. Four things changed as a result: depth bands
(omitted entirely at first, and it is THE technique), per-environment additive
blending (`lighter` for emitters, never for rain), grain as an anti-banding
requirement on large dark gradients, and rain as depth-varying angled lines.
First build measured **0.2-0.4% lit coverage** and looked like a bare gradient.

Live-verified @vergr → @Verion: an **L1 member sees the full room including
weather**, which is the design (unlock belongs to the setter, room belongs to
the squad). Numbers in the doc.

**NOT done:** overview/detail/members surfaces, native squad screens, tier-2
parallax. **NOT negative-tested:** the rules gate refusing an under-levelled
setter — it needs an account that is a squad admin AND below L52, and neither
test account is.

---

## 2026-08-26 — Public profile had TWO accent systems (SHIPPED + DEPLOYED)

`PublicProfileScreen.jsx` resolved the accent twice. `accentFor()` (the earned
VP unlock) drove the root tokens, banner glow, VP bar and audio FAB; a second
variable read `users.accentColor` — a third field, set by the unrestricted
swatch picker in Edit Profile — and drove the name-audio button, status pill,
schedule card and pinned icon. **Equipping a VP accent recoloured half your
public profile.**

`ProfileScreen.jsx` and `NativeProfileScreens.jsx` both use `accentFor()` alone,
which is why this was invisible to the owner: it only showed on the page other
people see. Earned accent now wins, `users.accentColor` kept as fallback.

⚠ `docs/PROFILE_THEMES_DESIGN.md:34` says `users.accentColor` "has no writer".
**Stale** — `EditProfileScreen.jsx:209` saves the whole form including it.

**NOT live-proven:** needs an account with an accent equipped, viewed by someone
else. @Verion has none, so that path exercises the fallback, not the fix.

---

## 2026-08-26 — Profile music picker, effect 09 finish (SHIPPED + DEPLOYED)

Tab row removed (upload is a quiet footer button opening the file dialog
directly, no mode to enter or escape). Artwork de-noised: the play control
appears on hover, guarded by `(hover: hover) and (pointer: fine)` so touch keeps
it visible — 19 permanent play glyphs over 19 covers was the same defect as 20
accent pills.

⚠ **Silent-start bug fixed.** Measured **2,876ms from click to the `playing`
event**, 2,828ms of it Audius resolving `/stream` through its 302→307 chain,
during which the button already read `stop` and lied. Now a spinner, cleared by
the `playing` **EVENT** — `play()`'s promise resolves earlier and is not the
same thing.

---

## 2026-08-25 — Custom typing indicator, effect 06 (SHIPPED + DEPLOYED, one check outstanding)

Doc: `docs/effects/06-typing-indicator.md`. Unlock `typing_style` at **L32**
(Challenger L2), six styles, the user picks one on `/prestige` → Effects.

**A live bug found on the surface this landed on: the DM typing bubble had never
rendered.** `ChatThreadScreen.jsx:3688` mounted `<TypingIndicator />` with no
`users` prop and the component opens `if (users.length === 0) return null`, so
what a user saw was a floating 26px avatar beside nothing. The header line
("X is typing...") worked, which is why it was never noticed.

**The doc's own inventory was wrong and is corrected in it.** It claimed two
files, from `grep -rl 'TypingIndicator'`. That finds the component's consumers,
not the places that DRAW an indicator: the squad chat hand-rolls `.typing-dots`
(`squad.css:452`) and three inbox rows write the sentence as a string. Six
surfaces, all now through the one component: DM bubble, DM header, squad footer,
`MessagesListPanel` (x2), `MessagesInboxScreen`, native inbox. Native threads
inherit — both native thread files are 8- and 13-line re-export wrappers,
checked rather than assumed.

**The relay was never involved.** The doc had spent its research on
`vergr-chat`'s `Msg` struct dropping unknown fields and recommended deriving the
style from `vpLevel` to avoid a Go redeploy. `grep -rn 'typing' infra/chat/src`
returns one code comment: typing rides the Firestore conversation doc. So the
constraint that shaped the recommendation does not exist, and the style is a
free USER CHOICE (the `name_font` precedent) rather than level-derived.

Resolution costs zero reads: every surface has already loaded the typist's user
doc for their name and avatar. It is read from there rather than carried in the
typing entry, so `cosmeticsAllowed()` in firestore.rules is the only integrity
story. `firestore.rules` gained `typingStyle` (level 32 + the id enum,
`'dots'` always allowed since storing it is how you turn the cosmetic off).

**`slimUser()` now persists `vpLevel` + `cosmetics`** (`chatIdentity.js:30`).
They were dropped from the localStorage identity subset, so on a COLD start
every chat surface lost name colour, typeface and gradient until the async
refetch landed. Never filed, fixed in passing.

Verified by measurement, not by looking: new `scripts/typing-preview.mjs`
(`--measure`) serves the real stylesheet and drives it in Chrome. **29/29** —
periods, negative staggers (-0.32/-0.16/0, the reference idiom the old
implementation lacked), per-channel travel, a byte-identical seamless loop for
`comet`, reduced motion stopping AND staying visible, and zero JS timers.
`npm run check` 91 → 114 assertions, each new class negative-tested.

⚠ **One defect passed every number and was only caught by LOOKING:** `comet`
rendered as a solid violet bar. `.vg-typing i` sets a background *colour* and
the comet only overrode background-*image*, so the gradient painted on top of a
solid fill — it animated, it moved, and it looped perfectly, because a uniform
bar does. Fixed, and the harness gained "mid-cycle must differ from the start".

**Verified live on two accounts** (@vergr typing, @Verion watching, navigated
not URL-pasted). Three indicators measured on the visitor's screen, all
resolving the TYPIST's cosmetics: ink `#f04060` (Vergr's Ember accent), 4px in
the inbox row and header, 7px in the bubble, `role="status"` on the bubble only.
Equip persisted across a reload; switching style changed what the other account
saw; and @Verion at L1 correctly sees "unlocks at level 32" instead of a picker.

⚠ **TWO MORE BUGS FOUND, both fixed and deployed:**

1. **`useTyping` died on every cold load.** It opened its subscription with
   `if (!chatId || !auth.currentUser) return;` against `[chatId]` deps, so on a
   reload / pasted link / push-notification launch — where Firebase has not
   restored the session yet — it bailed and never re-ran. **The thread's typing
   listener was dead for that whole session**, while the inbox row (subscribed
   elsewhere) kept working, which made it look like a rendering fault. Now
   tracks `onAuthStateChanged`. Same class as
   [[reference-auth-null-is-not-signed-out]]. A/B'd on the live site.
2. **Vergr's OWN Reduced Motion setting made the indicator invisible.** There
   are two switches and the CSS media query only catches the OS one. Settings →
   Appearance sets `html[data-reduced-motion="true"]` and `index.css` answers
   with `animation-duration: 0.001ms; iteration-count: 1` — which does not stop
   an animation, it **fast-forwards it to its final keyframe**, i.e. the resting
   pose: `pixel` 0.20 opacity, `dots` 0.42. Static poses now declared for the
   attribute too; verified live with that setting on (`animation-duration:
   1e-06s`, indicators still at 0.75 and visible).

⚠ **SQUAD CHAT NEEDS A FOUNDER DECISION, and it is not a regression.** Squad
typing has never worked in either direction: `SquadChatThreadScreen:298` never
takes `setTyping`, and `useTyping(squadId)` listens to
`conversations/{squadId}`, **a doc nothing ever creates**. The `.typing-dots`
markup replaced there was dead code. Squad messages are Firestore, not the
relay, so the obvious home for typing state is the squad doc — where every
member already holds a listener, so a keystroke burst bills a read per member.
Not built. Doc 06 §8.2.3.

Also corrected while here, both stale headers that contradicted their own
bodies: `docs/effects/02-ambilight.md` said "TWO DEFECTS OPEN" while §5.3
describes the shipped fix (verified in `Ambilight.jsx`), and
`docs/effects/25-public-profile.md` said "AUDITED, NOT BUILT" while steps 1-7
are in the source.


## 2026-08-23 — VP gamification built end to end + CLAUDE.md audit (SHIPPED + DEPLOYED)

**CLAUDE.md audit.** Six more stale claims on top of the relay-source one, each
checked against source: HashRouter (it is BrowserRouter, and the migration was
still listed as outstanding launch work), "no source for sfu/ingest/rtmp-auth/chat"
(all four have source; only `stream-node-agent` does not), "1.0.198" as the
current version (1.0.203), the whole Subscriptions section (sold tournaments, a
vergr.me custom domain, IP-masked streaming, priority support, co-streaming as a
Pro perk, in EUR: all wrong, and its own 2026-08-19 audit section already said
so), "tip 10% fee" (no tip fee exists), and Vanguard perks (both against deleted
features, so Vanguard have no working compensation: needs a founder call).

The HashRouter one was NOT harmless: `ErrorBoundary.jsx` set
`window.location.hash = '#/'` for "Go home", which under BrowserRouter appends
`#/` to the crashed path and reloads the same crash. Fixed.

**Relay deployed to box 1.** `infra/chat/src/main.go` now carries `vpLevel` on
every message, read from the profile it already loads once per connection.
Verified: repo was byte-identical to the box on all 9 other files, temp-built
first, `strings` confirms the field in the running binary, healthz 200.

**Gamification, all live.** New `src/utils/rankUnlocks.js` is the single table.
Built and deployed: rank crest + name colour + animated name in live chat; entry
ribbon tiers; 12 profile accents and 7 themes with an equip UI on /prestige and
a real render on the profile; 7 Stream Boost tokens (granted on level-up, spent
instead of 50 coins, refunded as a TOKEN so a token-paid boost cannot mint
coins); a +0.5%/level VP earn rate in both credit paths; a rank-up push; and a
level-up modal that names what you actually got instead of "keep going to
unlock new perks, badges and ring colours".

⚠ **A draft of the ladder promised eight rewards with no system behind them**
(emote packs, pinned-post slots, comment tint, comment pinning, audio name clip,
extra profile links, trophy case, post reactions) plus two entry tiers
`JoinAnnouncer` does not draw. All cut before shipping rather than shipped as
promises. Build the system first, then add the row.

**Six help articles** were still selling the dead 30%→15% VP commission ladder as
fact, including the one in the Trust category titled "What fees does Vergr
charge". One contradicted itself inside a single summary sentence. All rewritten
to the real model: no fee on any surface, 50%→80% by lifetime earnings, rank
never touches it.

Security: `users.vpLevel` and `wallets.boostTokens` server-only; `cosmeticMinLevel()`
in firestore.rules re-checks every equipped id against the level already on the doc.

Found and flagged, not changed: `users.avatarFrame` is a level-gated picker with
an upsell toast that **nothing anywhere renders**.


## 2026-08-23 — Rank in live chat, done the FREE way (CORRECTED, DEPLOYED)

Founder ruling, two parts, both correcting me:

**1. Rank shows ONLY in the live-stream entrance ribbon and live stream chat**, and
must never interfere with the live ring or the status ring on an avatar. I had added
a rank badge to the feed, comments, followers, search and the DM header. All of that
is REVERTED. `UserAvatar.showTierRing` stays false everywhere.

**2. It must not cost money per viewer.** My first build resolved each chatter's
rank with a Firestore read per unique sender, cached and capped. The founder
rejected it outright and was right: it billed per viewer for a cosmetic.

⚠ **The reason I built the expensive version is a STALE FACT IN `CLAUDE.md`**, now
corrected. It claimed `vergr-chat` (plus sfu, ingest, rtmp-auth) exist only as
compiled binaries with no source. **That is false.** `infra/chat/src/` holds the
full Go source, as do `infra/sfu/src`, `infra/ingest/src`, `infra/rtmp-auth/src`.
Only `stream-node-agent` genuinely lacks source. Verified by listing the dirs.

The correct fix, now in source: the relay ALREADY loads each sender's user doc once
per CONNECTION to stamp name, avatar, Vanguard rank and the member gem. `vpLevel`
now rides in that same `UserProfile` and `Msg` struct (`infra/chat/src/main.go`), so
the rank crest in chat costs **zero extra Firestore reads, ever**. The client just
renders `m.vpLevel`. `src/utils/rankLookup.js` is DELETED.

⏳ **The relay is NOT yet deployed to box 1.** Needs scp to `/opt/vergr-chat/src/`,
`go build`, `systemctl restart vergr-chat`. Until then `vpLevel` is absent from the
wire and chat simply shows no crest, which degrades silently. Web is deployed.

## 2026-08-23 — Gamification Phase 0: the three VP defects fixed (A110-A112, DEPLOYED)

- **A110.** New `syncVpLevel` trigger (`functions/vpLevel.js`) writes
  `users/{uid}.vpLevel` from `wallets/{uid}.vp`. Nothing had EVER written that
  field, which left the Elite/Veteran/Legend avatar frames unreachable for every
  user and every "Lvl" list showing 1. One trigger instead of a write at each of
  the dozen VP grant sites. `vpLevel` added to the server-only denylist in
  `firestore.rules` (it now gates rewards, so an owner-writable copy would be
  self-promotion to Immortal). `EditProfileScreen` additionally derives your own
  level from your already-loaded wallet so frames unlock immediately.
- **A111.** `LevelUpWatcher` mounted in `AppRouter` finally renders the
  `LevelUpCelebration` component, which was imported by nothing. Fires once per
  level, per user, and stays silent on first sight of an account on a device.
- **A112.** Removed the prestige coin figures (500 to 5,000) that no code can
  grant, since prestige has no server implementation at all.

Docs: `docs/GAMIFICATION_PLAN.md` (build state at top), `docs/APP_AUDIT.md`.

## 2026-08-23 — Stream entry ribbons: rank-themed, server-authoritative (SHIPPED + DEPLOYED)

First real T1 gamification reward, and it closed a live security hole on the way.

**Security:** `streams/{id}/joins` create was `isAuth() && uid == request.auth.uid`,
validating ONLY the uid, so any account could forge `kind:'subscriber', tier:'pro'`
into ANY stream for the gold entrance, and spam unlimited join docs into a stream
it did not own. Now `allow create, update: if false`; the new
**`announceStreamJoin`** callable (`functions/streamJoins.js`) resolves follower
state, subscription tier and VP rank server-side and owns dedupe (6h per user per
stream), a per-stream rate limit with priority classes, and block/ban suppression.
Client sends only the stream id.

**UI:** `JoinAnnouncer.jsx` rebuilt as a 4:1 rank-themed ribbon, measured off the
founder's reference sheet (ring hue == username hue, gradient name, "LIVE" in rank
colour, halo bleeding past the edges, L71 border sweep, L91 shimmer). Palettes for
all 11 ranks in `src/utils/rankBanners.js`. Background art slot at
`public/brand/entry/{rank}.webp` with a CSS fallback so nothing is blocked while
the founder generates it.

**Also fixed** the two defects the spec turned up: the mobile ribbon was anchored
to a constant chat height so it floated detached when the keyboard opened, and
entry ribbons were missing entirely from the fullscreen branch.

**Verified by rendering**, not assumed: all 11 ribbons screenshotted headless at
the true 280x70. That caught a real defect (a flat type scale truncated "Verion"
to four characters), fixed with a length-adaptive name size.

⏳ Still open: background art, streamer controls UI, the Firestore TTL policy
(console action), the OBS overlay variant, and a real live-stream test.
Docs: `docs/ENTRY_ANNOUNCEMENTS_SPEC.md` (BUILD STATE block at top),
`docs/ENTRY_BANNER_ART_SPEC.md`, `docs/ENTRY_BANNER_PROMPTS.md`.

## 2026-08-23 — Gamification plan written; three more VP defects found (A110-A112, SOURCE ONLY / PLAN)

Founder pushed that the VP work was still surface-level and asked what a NON-creator
gets for leveling and whether VP actually gamifies the app. Traced it end to end.
Findings: rank grants cosmetics only; `users/{uid}.vpLevel` has **no writer** so
avatar frames (the one functional reward) are unreachable for everyone and every
"Lvl" list shows 1 (A110); `LevelUpCelebration` is rendered nowhere so leveling is
silent (A111); prestige advertises 500-5,000 coins with no server implementation
(A112); badge and crest are the same 30 assets shown as two systems; a pure viewer
can earn only ~10 VP/day because the viewer-shaped VP_ACTIONS award nothing.

New doc **`docs/GAMIFICATION_PLAN.md`**: viewer track, creator track, achievements
engine, the moments, cost table, and **10 numbered owner choices**. Key constraint
recorded there: rank rewards must not cannibalise Lite/Pro, and granted coins are
NOT free because a tipped coin accrues real revenue-share liability regardless of
where it came from. **NOTHING BUILT YET**, awaiting founder decisions.

## 2026-08-23 — VP system: wired the earn actions that paid nothing + killed stale gems copy (A108/A109, DEPLOYED)

Deep-dive after the founder pushed that A107 was surface-level. Verified the VP
system rewards correctly (animated crests real; profile-completion quests are
server-verified + ignore the client amount, A23 genuinely closed). But found the
`/prestige` "How to earn" table advertised 7 actions that awarded NO VP
(create_post, get_comment, go_live, stream_hour, win_match, host_event; boost_post
was fine). Founder chose to wire them: new `functions/engagementVp.js`
(`creditEngagementVp`, per-UTC-day caps in `vp_daily_caps`), wired into
`onPostCreatedAwardVp` (new), `onNewComment`, `onStreamWentLive`,
`endStreamSession`; win_match removed + host_event made honest in the earn table.
**DEPLOYED** (4 functions + hosting). ⚠ Caps are a proposal for founder to tune.
Separately swept stale "gems" copy (deleted 2026-08-16) still live in the boot
`LoadingScreen`, the vergr.me shop surfaces (backend already credits the dollar
payable — copy only), a help article, and the Go-Live earnings tile. Detail:
`docs/APP_AUDIT.md` A108/A109.

## 2026-08-23 — VP/Prestige screens still sold the DEAD commission ladder (A107, DEPLOYED)

Profile screen pass (audited from the Verion account). Profile itself is clean
(tabs, empty states, and Likes/Bookmarks correctly private per
`PublicProfileScreen.jsx:45`). But `/prestige` and `/settings/ranks` were still
advertising the VP-keyed commission ladder (30%→15%) and deleted gems/coin
conversion as live perks — the 2026-08-19 commission-copy sweep missed them.
`/settings/ranks` even contradicted itself (a Commission column beside a blurb
saying VP "never changes what a creator is paid").

Fixed every LIVE surface (grepped `commission` across `src/`): PrestigeShowcase,
VPRanksScreen, NativeHomeScreens (native, needs APK), OnboardingFlowScreen,
PublicMarketingScreens/Monetization. Left the correct usages alone (Twitch
comparison, EU "Commission", store-30% help articles). **DEPLOYED** to web,
verified live on `/prestige` (hero "1/30 badges", "What you unlock" shows
badges/crests, no commission). Full detail: `docs/APP_AUDIT.md` A107.

---

## 2026-08-22 (late) — DM coin + location cards, pixel-matched + Google Static Maps (SHIPPED + DEPLOYED)

Full detail: docs/APP_AUDIT.md "COIN + MAP CARDS: pixel-match rebuild" (end of file).

- Rebuilt the DM coin-transfer + shared-location messages as designed cards matching the
  founder's mockups. `CoinCard` (small <1000 / grand centered >=1000) + `LocationBubble` in
  ChatThreadScreen.jsx. Real /brand/vc-coin.webp medallion, Baloo 2 gold number (added to
  index.html fonts), traveling violet glow (surface.css .vg-beam-violet), optional "Add a
  message" note (new field in SendCoinsModal).
- Relay strips unknown objects, so amount+note ride contentUrl (`vergrcoin:amt:note`) and
  location coords+address ride contentUrl (`geo:lat,lng|title|subtitle`); reverseGeocode
  (utils/geo.js) returns {title,subtitle}. Fixed mediaKind to forward non-text types.
- GOOGLE STATIC MAPS wired: Maps Static API enabled on vergr-44494, key in secret
  GOOGLE_MAPS_KEY (server-only), functions/mapThumbnail.js `mapThumb` (dark style, no
  marker), served at vergr.app/maptile via firebase.json rewrite + cache headers, CDN
  cached (X-Cache HIT). Fallback google -> OSM -> gradient. Cost ~$0 (cached). Only Maps
  Static API enabled; do not enable other Maps APIs.
- Verified live: /maptile real dark map; coin-small + location cards in the thread. NOT yet
  verified live: coin LARGE (>=1000) layout (harness only), Verion receiver-side visual.
- Native APK (1.0.203) predates ALL of this; needs a new APK before any of it shows on phone.

## 2026-08-22 — Calls + Call screen pass (SHIPPED + DEPLOYED)

Audit method changed on founder instruction: fix findings in the moment rather than
logging them, add UI/design/UX/security to scope, one screen at a time, include mobile.

Seven fixes, all built and deployed to hosting, all verified live in the browser.
Full write-up: `docs/APP_AUDIT.md` A88-A94.

| # | Fix | Verified |
|---|---|---|
| A88 | Calls right panel centred in the CALL LIST's height (1345px in a 714px viewport) so its cards fell below the fold, worsening with every call ever made. Shell is now `h-screen ... overflow-hidden` with a scrolling right column. | All ancestors 732px = viewport; all 3 cards on screen |
| A89 | Missed calls printed a literal `0` — JSX falsy render of `{call.duration && ...}`. | Zero `0` rows; 0:50 / 1:37 still shown |
| A90 | Call list 13.3s cold. `getCallHistory` fetched EVERY row with no orderBy/limit (+ new composite index), and an N+1 refetched the SAME user doc 20x sequentially. | **13,331ms → 4,785ms** |
| A91 | **Critical.** Crossing the mobile/desktop breakpoint remounted the call screen and killed the live WebRTC call. Call routes moved outside `MainLayout`. | Reproduced both ways pre-fix (1:21→0:02, tracks MUTED, doc still `status:active`) |
| A92 | 15 nav controls stayed keyboard-focusable behind the full-screen call overlay. | `shellFocusableCount: 15 → 0` |
| A93 | Callee name was 12.25px, smaller than a 13px nav label; "P2P ENCRYPTED" 8px at 30% opacity. | Name 17.5px, lock icon, label 11px/70% |
| A94 | Mobile rendered the "Calls" title and new-call button TWICE (TopBar + panel header). | `dupTitles / addCallBtns: 2 → 1` |

⚠ **A91's root cause is NOT fixed, only routed around.** `ResponsiveLayout` returns five
different trees by breakpoint, so it remounts `{children}` on any breakpoint crossing.
Every other screen is still exposed; only the call routes were moved out. Any future
screen holding live state (recorder, upload, broadcaster, peer connection) must be
mounted outside that shell. Memory: `reference-responsivelayout-remounts-children`.

Still open on these screens: A48 (a rung-out call lands on `/messages`, not where it was
started, reconfirmed twice), A86 (no call entries in the conversation thread; all the
data is already on the `calls_history` row), and "Schedule a Call" being a full-size
action card that only fires a "coming soon" toast.

Method note: window resizing floors at ~658 CSS px in this Chrome, so it exercises the
mobile branch but is NOT true phone width. Do not claim phone-width verification from a
resize; that needs device emulation or the APK.

## 2026-08-21

### ⚠ RISK FOUND FIRST, read this before anything else

**The ENTIRE native Android app is untracked in git.** `.gitignore:12` ignores
`src-tauri/gen`, which contains:

- 43 hand-written Kotlin files in `src-tauri/gen/android/app/src/main/java/com/vergr/desktop/`
  (MainActivity 47KB, ArCameraActivity 68KB, VideoTranscodeBridge 24KB,
  VergrMessagingService, BillingBridge, MediaCacheBridge, the camera and call stack)
- `AndroidManifest.xml`
- `app/build.gradle.kts` and the proguard rules

Confirmed with `git ls-files --error-unmatch` on each: all report untracked.

This **directly violates a hard rule already in CLAUDE.md**: "Nothing that decides
how the app is built may sit UNTRACKED in git ... If a build config is not in
`git ls-files`, that is a bug to fix, not a detail." That rule exists because
exactly this class of loss caused the 1.0.193 web-mode APK disaster, which cost a
release and a day.

`src-tauri/gen` is Tauri's stock gitignore line, presumably never revisited while
months of bespoke Kotlin grew inside it. **It is not safely regenerable**:
`tauri android init` would overwrite every custom file.

One `git clean -fdx`, one branch checkout, or one machine failure and the native
app is gone. Today's three Android fixes sit in that same unprotected directory.

**NOT FIXED. Needs a founder decision** on whether to un-ignore `src-tauri/gen`
(or narrow the ignore to the genuinely generated subpaths). Flagged, not actioned,
because changing what is tracked is not a call to make unasked.

---

### A. SHIPPED + DEPLOYED (web, live on vergr.app)

**Support threads could be voice- and video-called by any user.**
`src/screens/messages/ChatThreadScreen.jsx:3041` gated the call buttons only on
`!chatInfo?.isSaved`, so they rendered on support threads. `startCall` copies
`chatInfo.participants` onto the `calls` doc, and a support thread's participants
are `[user, ...support agents]` (`functions/supportChannel.js:175-180`).
`IncomingCallManager` listens for `calls` where `participants array-contains uid`
and `status == 'ringing'`, so tapping the video icon **rang every support agent's
personal account**, unsolicited, from any user. A harassment vector, not just a bug.

Now gated `!isSaved && !supportThread && !isOfficial` at
[ChatThreadScreen.jsx:3041](src/screens/messages/ChatThreadScreen.jsx:3041), with a
second guard inside `startCall` at
[ChatThreadScreen.jsx:2173](src/screens/messages/ChatThreadScreen.jsx:2173) so no
other entry point or stale render can start one.
`NativeChatThreadScreen.jsx` is `export { default } from '../ChatThreadScreen'`, so
the APK inherits it.

⚠ **Residual, deliberately left:** the client path is closed, but a hand-crafted
Firestore write still passes rules, because in your own support thread you genuinely
are a participant. Closing it needs a `get()` on the conversation doc inside the
`calls` rule on every call creation, which is a read on every call platform-wide.
**Founder decision, not done.**

### B. SOURCE ONLY, NOT IN ANY BUILD (native Android)

Play Console showed **"5 actions recommended"** against the 1.0.201 bundle. Triaged
all five against the code. Full reasoning is in CLAUDE.md under
"PLAY CONSOLE '5 actions recommended' ON 1.0.201, TRIAGED".

| Advisory | Outcome |
|---|---|
| Edge-to-edge may not display | **No action needed.** Already correct. |
| Deprecated edge-to-edge APIs | **No action possible.** All library code. |
| Resizability / orientation | **Fixed.** |
| Bitmap image optimization | **Fixed.** |
| R8 optimization | **Half fixed.** Resource shrinking yes, AGP 9 declined. |

**1. Bitmap decode, the one that could actually crash things.**
`VergrMessagingService` called `BitmapFactory.decodeStream(input)` with no
`Options` for both the notification photo and the sender avatar. That allocates at
full source resolution before any downscale, so a 4000x3000 CDN photo was a **48MB
ARGB_8888 allocation inside a background FCM service**, the smallest heap the app
ever gets. On OOM the push silently never appears, indistinguishable from never
being sent. The avatar path was worse: circle-cropped and PNG-encoded at full
resolution for something the OS draws at 64dp.

Added `downloadToFile()` (streams to a temp file) and `decodeBounded()` (canonical
two-pass `inJustDecodeBounds` + `inSampleSize`), constants `PHOTO_MAX_DIM = 1024`
and `AVATAR_MAX_DIM = 512`, plus recycling in `downscale` and `circleCrop`.
**No image library added**; Play suggests Coil/Glide, which is a dependency and APK
weight for two call sites when the manual fix is the same fix.

**2. Orientation, with an expiry date.**
`ScannerActivity` and `ArCameraActivity` are portrait-locked with no landscape
layout. At targetSdk 36, `screenOrientation` is **ignored on any display >= 600dp
smallest width**, and neither activity declared `configChanges`, so a tablet or
unfolded foldable destroyed and recreated the activity mid-capture.
Both now carry `android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY = true`
plus `configChanges="screenSize|screenLayout|smallestScreenSize|keyboardHidden"`.
`orientation` is deliberately **absent** from configChanges.

⚠ **The opt-out dies at targetSdk 37.** A real landscape pass on those two capture
screens is required before that bump.

**3. Resource shrinking.** `isShrinkResources = true` at
`src-tauri/gen/android/app/build.gradle.kts:154`. Safe because nothing resolves a
resource by name at runtime (`getIdentifier` appears nowhere in the Kotlin,
verified). AGP 9.0 **declined**: Kotlin is pinned at 1.9.25 for documented
metadata reasons, and AGP 9 needs Gradle 9.x which drags in the buildSrc Rust
plugin and the Tauri subprojects.

**Verification:** `./gradlew :app:compileUniversalReleaseKotlin` with
`ANDROID_HOME=C:\Android\sdk`, clean. Useful fact discovered: the Rust build hangs
off `merge*JniLibFolders`, **not** Kotlin compilation
(`buildSrc/.../RustPlugin.kt:60,78`), so that task is a ~40s syntax check, not a
20-minute cargo build.

🔴 **TO SHIP THIS:** 1.0.201 is already uploaded to Play, so it needs a version
bump and a new AAB. Move together: `src-tauri/tauri.conf.json`,
`src/utils/appVersion.js` (`APP_VERSION` + `APP_VERSION_CODE`), and
`public/version.json` if a sideload APK is published too. Next is **1.0.202**.

### C. RESEARCH + DOCUMENTATION ONLY (no code)

**Play account migration off Murmont LLC.** Recorded in CLAUDE.md under
"Migrating the PLAY account off Murmont: the order is forced". Verified against
Google's docs, not assumed:

- The **D-U-N-S number cannot be edited** on an existing payments profile
  (nor can country or account type). Murmont to Vergr is therefore a **new
  payments profile**, not a rename.
- ✅ **No app transfer required.** The new verified profile links to the same
  developer account; apps, reviews, install base and Play Billing SKUs all stay.
  App transfer is forced only when the **country** changes, and both entities are US.
- The new profile is a **merchant** profile: W-9 needs the **EIN**, and the payout
  bank account name must match the legal name. Forced order:
  **EIN → Vergr bank account → new payments profile → Play identity.**
- ⚠ Do NOT rename the Murmont D-U-N-S record at D&B. There is now a separate Vergr
  D-U-N-S; renaming Murmont's would produce one matching neither EIN.
- ⚠ A half-finished switch raises a "no longer verified" banner with a deadline,
  and Google's stated consequence is **removal of all apps from Google Play**.

**Verification documents.** EIN and bank are **not** needed for Play developer
verification or for creating and identity-verifying the payments profile. They are
needed for the tax step and payouts only. Documents for the payments profile:
state registration document (the stamped Kentucky Articles of Organization),
government photo ID of the authorised representative, and proof of address if the
ID address differs. Original photos only, all four corners visible, 2 to 3 business
days to review.

⚠ Two risks specific to this case, unresolved: the registered address is
**Northwest Registered Agent's office**, and Google forbids PO boxes and sometimes
rejects registered-agent addresses for merchant profiles; and the founder's photo
ID is issued in another country, so it will not match the Kentucky address.

**Not usable as evidence:** `docs/corporate/member-register.html`,
`certificate-of-ownership.html` and `ownership-structure.svg` are unsigned and
self-generated. Google needs state-issued documents.

**EIN mechanics.** Fax Form SS-4 to **855-641-6935** (principal office in one of
the 50 states; NOT the international lines). Putting a return fax number on the
form gets the EIN back in **about 4 business days**; omitting it means roughly 4
weeks by post. International applicant phone line **+1 267-941-1099**, Mon to Fri
6am to 11pm ET, worth trying first. Richmond KY is area code **859** (Madison
County; 859 is central Kentucky, not Lexington-only), though the area code of the
receiving fax is functionally irrelevant to the IRS.

### D. OPEN, AWAITING A FOUNDER DECISION

| # | Decision | Why it is blocked |
|---|---|---|
| 1 | **Un-ignore `src-tauri/gen`** | Whole native app is one `git clean` from gone. Changing what git tracks is not a call to make unasked. |
| 2 | **Streaming daily cap** | `stream_usage` is read at `functions/streaming.js:267` and **written nowhere**, so no tier is capped. Either wire it up or delete the dead limit. Raised three times, still unanswered. Blocks adding any streaming-hours line to plan copy. |
| 3 | **Harden the `calls` firestore rule** | Costs a `get()` per call creation platform-wide to close a write-level hole the UI already blocks. |
| 4 | **Ship 1.0.202** | Android fixes above are inert until an AAB is built. |
| 5 | **News image mirroring to R2** | Fixes CORP-blocked news thumbnails. Has real R2 storage cost. |

### E. SMALLER OPEN ITEMS

- `EMPTY_PREVIEW` in `functions/officialChannels.js` sets `lastMessage`, but the
  inbox reads `lastMessageText`, so those rows show a generic "Tap to chat".
- Squad page lower cards (Recent Activity, pinned, events) still use the old
  bordered-card treatment rather than the surface system.
- The unused Cloudflare `vergr-custom-hostnames` API token should be revoked.
- Play submission itself: `C:\Users\damie\Downloads\VERGR-1.0.201.aab` is uploaded,
  Submission 3 sits at "Ready to publish" (managed publishing). App access test
  login and the Data safety form still outstanding.

### F. CURRENT VERSION STATE (verified on disk)

| Field | Value |
|---|---|
| `src-tauri/tauri.conf.json` | 1.0.201 |
| `src/utils/appVersion.js` | APP_VERSION 1.0.201, APP_VERSION_CODE 201 |
| `src-tauri/gen/android/app/tauri.properties` | 1.0.201 / versionCode 1000201 |
| `public/version.json` (sideload APK) | 1.0.199, published 2026-08-19 |
| Play Console | 1000201.aab (1.0.201) Active, install base <= 100 |

`version.json` at 1.0.199 is **not drift**: it describes the last *published
sideload APK* on cdn.vergr.app, with that artifact's own size and sha256.
1.0.200 and 1.0.201 were store builds. Version code **1000200 is burned forever**
by the 336MB multi-ABI upload; Play never reuses a version code.

**Nothing in this session is committed.** Last commit is `ed9291a`, which predates
all of it. The web changes are deployed to hosting from the working tree.
