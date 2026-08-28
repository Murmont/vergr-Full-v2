# VP bonus packs, the VP shop, and what happens at L100

**STATUS, 2026-08-28: §3 and §4.1/4.3 are BUILT, SHIPPED AND DEPLOYED. The rest
of this document is still a plan.**

| Section | State |
|---|---|
| §3 the timed-bonus mechanic | ✅ built — `users/{uid}.vpBonuses`, resolved in both VP credit paths |
| §4.1 the six duration surges | ✅ built |
| §4.3 the three focused surges | ✅ built |
| ladder grants | ✅ built — 14 levels hand out a pack (`BONUS_LADDER_LEVELS`) |
| coin purchase | ✅ built — `purchaseVpBonus` |
| §5 VP shop | ❌ **CANCELLED.** Founder, 2026-08-28: coins only. See §11.2 — a VP-priced VP multiplier is an infinite loop, so this was never buildable as written. |
| §4.2 Open Bar, §4.6 Streak Shield, §4.7 Squad Surge | ❌ not built. Each is a DIFFERENT mechanic (daily caps / streak counters / treasury fan-out), not another row in the pack table. |
| §7 L100 answer | ❌ not built, still needs a founder decision |

⚠ **Prices, durations and multipliers below are what SHIPPED**, and they remain
the founder's to change. They live in `src/utils/vpBonuses.js`, mirrored in
`functions/vpBonuses.js`, and `vp-mirror-check.mjs` fails the build on drift.

---
Driver, founder 2026-08-27: *"its kind of pointless to increase the vp earning
indefinitely... timed extra vp earnings, like 6 hour, 12 hour, 24 hour, 48 hour,
7 day earning bonus. then since when a user reaches level 100, they arent able to
get anything else, we should create like with the coins pack, purchase bonus with
VP... then also we can add Bonuses that can be purchased with coins."*

---

## 1. Why the current mechanic had to go

`rankVpBonus()` gives **+0.5% per level, flat, on every level**. Measured, not
assumed:

- **`VP_BONUS_MAX = 1.5` is never reached.** L100 pays 1.495x. The cap is dead code.
- Awards run through `Math.round()`, so the bonus **pays literally nothing** for
  most of the ladder on the actions people actually do:

| Action | Base VP | Times the payout changes across 100 levels |
|---|---|---|
| `like_post` | 1 | **never** |
| `squad_message` | 1 | **never** |
| `get_like` | 2 | **once**, at L51 |
| `get_comment` | 5 | twice, L21 and L61 |
| `create_post` | 15 | 7 times |
| `daily_login` | 10 | 5 times |
| `complete_quest` | 20 | 10 times |

A player going Rookie to Champion earns **zero extra VP on a like for fifty
levels**. The founder is right that an indefinite rate creep is pointless: it is
invisible, unbounded in principle, and bounded in practice by a cap nobody reaches.

**A timed bonus is the better shape** because it is visible, it has an end, it can
be given as a reward OR sold, and it cannot inflate the curve forever.

## 2. The three things a user holds, and what each is for

Getting this wrong is how a bonus pack becomes a money-transmission problem or a
pay-to-win ladder. Stated so every pack below can be checked against it.

| | What it is | Can it be bought? | Can it be earned? |
|---|---|---|---|
| **VP** | progress in a game. Not a currency, not transferable, no cash value | **no** (see §7) | yes, by using the product |
| **Coins** | a revocable licence to access features. No cash value, non-transferable | yes, with money | yes, small amounts |
| **Boost tokens** | promo inventory. One free Stream Boost | not today | yes, from the ladder |

⚠ **`GIFT_COINS_PER_VP = 25` is a founder-locked principle, not a tuning knob.**
Its own comment: *"coins are bought with real money, so 1 VP per coin would let
anyone buy max rank. Instead a low coins→VP rate keeps gifting a contributor, not
a shortcut."* Everything in §6 has to answer to that line.

## 3. How a timed bonus works (the one mechanic all of §4 shares)

```
users/{uid}.vpBonus = { id, mult, scope, startedAt, expiresAt, source }
```

**On `users`, deliberately NOT on `wallets`.** `engagementVp.js:65` and
`walletActions.js` already `tx.get(userRef)` to read the plan tier and `vpLevel`.
Putting the bonus on that same document means the multiplier **costs zero extra
reads** — the same argument that made the chat crest and the rank bonus free. The
wallet is only ever written in those paths, never read.

**Resolution** is one more factor in a line that already multiplies two:

```js
const mult = PLAN_VP_MULTIPLIER[tier] * rankMult * activeBonusMult(user, now);
```

**Expiry is evaluated at read time** (`expiresAt > now`), never by a cron. Same
pattern as `boostExpiresAt` on a stream. Zero scheduled cost.

⚠ **A multiplier already lifts the daily cap**, because `engagementVp.js:74` does
`cap = Math.round(cfg.dailyCapVp * mult)`. That is correct and should stay: a 2x
that still stops at the same daily ceiling is a 2x that does nothing to anyone
active. It also means **the cap lift in §4.2 is a genuinely different lever** and
not a duplicate.

⚠ **Stacking needs a rule and it should be the one Stream Boost already uses:**
additive on the excess, hard ceiling, never multiplicative. Two 2x bonuses give
3x, not 4x. Reuse `boostReach()`'s shape so there is one stacking model in the
product, not two.

⚠ **Reference numbers.** A very active free user tops out near **350-400 VP/day**
across all caps; Pro doubles it. L100 is 648,000 VP, so the ladder is a
**multi-year** climb even for a heavy user. Every duration and multiplier below
should be read against that, and it is the reason a 7-day bonus is a serious
reward rather than a trinket.

---

## 4. VP earning bonuses

### 4.1 Surge — the founder's list

One mechanic, five durations. Short is hot, long is mild, so the choice is real
rather than "bigger is always better".

| Pack | Duration | Proposed multiplier | Roughly worth |
|---|---|---|---|
| Flash Surge | 6 hours | 3x | one focused session |
| Half-Day Surge | 12 hours | 2.5x | a day off |
| Day Surge | 24 hours | 2x | ~+400 VP |
| Weekend Surge | 48 hours | 1.75x | ~+600 VP |
| Long Surge | 7 days | 1.5x | ~+1,400 VP |

⚠ The multipliers are mine, not the founder's. The *durations* are his.

### 4.2 Open Bar — daily caps lifted, rate unchanged

The cap, not the rate, is what stops an active user. `create_post` stops at 75
VP/day (~5 posts), `stream_hour` at 100 (~5 hours). Someone streaming eight hours
earns nothing for three of them.

Lifts or raises the per-action daily caps for a window without touching the rate.
**Distinct from Surge, and better for heavy users** — worth having both because
they reward different behaviour.

### 4.3 Focused surges — cheaper, and they steer behaviour

A blanket multiplier rewards whatever you were doing anyway. A focused one is
cheaper and points at something.

| Pack | Boosts | Why it exists |
|---|---|---|
| Creator Surge | `create_post`, `go_live`, `stream_hour`, `clip` | pushes supply of content |
| Community Surge | `get_like`, `get_comment`, `comment_post` | pushes engagement on other people |
| Watcher Surge | `watch_stream_hour` | fills streams with an audience |

`scope` on the bonus doc is the action allowlist. `engagementVp` already receives
the action key, so this is a filter, not a new path.

### 4.4 Happy Hour — 1 hour, cheap, impulsive

The founder's "+VP 1 hour". Deliberately the smallest unit: low enough to be an
impulse, short enough that nobody stacks it into a shortcut.

### 4.5 Weekend Double — a window, not a duration

2x that only pays Saturday and Sunday UTC, bought any day. Costs nothing extra to
build (the resolver already knows the clock) and gives a reason to come back on a
specific day rather than a countdown that punishes you for sleeping.

### 4.6 Streak Shield — a bonus that prevents a loss

`claimDailyReward` writes `consecutiveDays` / `bestConsecutiveDays`. A shield
absorbs N missed days without breaking the streak.

⚠ **The only pack here that protects rather than accelerates**, and the one most
likely to be bought by someone who has been playing a long time. It also has the
lowest abuse surface: it grants no VP at all.

### 4.7 Squad Surge — the social one

Bought once by a squad owner from the **squad treasury**, applies the bonus to
**every member** for the window. The treasury and the member list both already
exist. Turns a solo purchase into a reason to be in a squad, and it is the only
pack whose value grows with the number of people around you.

---

## 5. Spending VP (the shop that gives VP a purpose)

Today VP does exactly one thing: raise a level. At L100 it does nothing at all.
A VP shop fixes both ends — it gives VP a use at every level, not only the last.

⚠ **Nothing in this shop may be sellable, transferable or refundable into coins.**
The moment VP buys something with coin value that can move to another account, VP
becomes a currency and the whole §2 table collapses.

| Item | What it costs VP for | Buildable today? |
|---|---|---|
| **Stream Boost token** | the reward the ladder already grants | ✅ `wallets.boostTokens` exists |
| **Post Boost** | already a coin purchase (`purchaseBoost`) | ✅ |
| **Surge packs** (§4) | the whole of §4, priced in VP instead of coins | ✅ once §3 is built |
| **Streak Shield** | §4.6 | ✅ |
| **Open Bar** | §4.2 | ✅ |
| **Profile spotlight** | your profile in a discovery rail for N hours | ❌ needs a rail that does not exist |
| **Early access token** | unlock ONE ladder item before its level | ⚠ see below |

⚠ **Early access is the one I would not build.** It sells the ladder back to the
player and makes every level's reward negotiable. If it ever ships it must be
*early*, never *instead*: the item still unlocks at its level for everyone.

### 5.1 The exchange rate is already implied, and it is worth knowing

The ladder grants **75 boost tokens across 648,000 VP** = one token per **8,640
VP**. A token is a 50-coin boost. So the ladder already prices VP at about
**0.006 coins per VP**. Any VP shop price should be set against that number rather
than invented, or the shop and the ladder will disagree about what VP is worth.

---

## 6. Buying bonuses with coins

The founder asked for this explicitly. It is the one section with a real risk in
it, so the risk is stated first.

### 6.1 The arbitrage loop closes, and here is the arithmetic

Coins → VP bonus → faster levels → **boost tokens, which are worth coins**. That
is a loop, and a loop that pays is a laundering shape.

It does not pay. Using the ladder's own rate from §5.1: a 7-day 1.5x surge on a
heavy user yields roughly **+1,400 VP**, worth about **8 coins** in tokens. **Any
price above ~20 coins makes the loop strictly lossy**, and every price under
discussion is far above that.

✅ **So the arbitrage risk is not real at any sane price.** It should still be
re-checked if boost-token density ever changes, because that is the number the
whole calculation hangs on.

### 6.2 The real objection is a values one, and it needs the founder

Arbitrage is fine. **Buying rank progression with money is still buying rank**,
and `GIFT_COINS_PER_VP = 25` exists specifically to stop that. A coin-bought
surge reopens the door the gifting rate closed.

Three ways to go, in order of how well they hold that line:

1. **VP bonuses are earned or bought with VP, never with coins.** Coins keep
   buying things that are not rank: Stream Boosts, Post Boosts, stream quality,
   memberships, unlocks. Cleanest, and it costs the least explaining.
2. **Coins buy only the non-VP packs** — Streak Shield, Open Bar, Squad Surge —
   so money buys convenience and reach but never a rate.
3. **Coins buy everything, and rank stops being a claim about effort.** Honest if
   chosen deliberately; corrosive if it happens by accident.

⚠ **This is a founder decision and the plan does not assume one.** My
recommendation is **1**, with **2** as the compromise if a coin sink is wanted.

### 6.3 If coins do buy surges: what has to be true

- The Play build sells them as consumable IAP or coins-first, never both.
- A coin-bought bonus is **still just `users/{uid}.vpBonus`** — one mechanic, one
  resolver, one expiry path, regardless of how it was paid for.
- It must be excluded from any "rank reflects effort" copy on the marketing site
  and the help centre, or that copy becomes false.

---

## 7. L100, and what a ladder does when it ends

⚠ **`vpSystem.js:122` already anticipates this**: `vpToNext: levelCost(lvl + 1),
// 0 at L100 unless prestige`. Prestige was contemplated when the curve was
written and never built.

Four options, not mutually exclusive:

### 7.1 Prestige — reset the number, keep everything

Back to L1, **every unlock retained**, and the crest gains a prestige mark. The
classic answer and the one the code already hints at. Cheap: one counter
(`users/{uid}.prestige`), one crest variant, `levelForVp` unchanged.

⚠ **The crest is the reward, so it needs art** — and art is the route that is
currently blocked (effects 10, 18 and 23 are all parked on it). A prestige mark
that is a Material Symbols glyph will get the same *"those look like shit"* the
milestone badges got. **Plan for a generated treatment, not new art**: a numeral
struck into the existing crest, or the L62 light sweep running at a different
rhythm.

### 7.2 Legacy VP — the sink that needs no new art

Past L100, VP keeps accruing into a spendable balance and buys everything in §5,
forever. This is the **lowest-risk and highest-value option**: it makes the whole
of §5 the endgame, needs no new content, and nothing about it can look cheap.

### 7.3 Ascendant+ levels — 101, 102, … with only bonuses attached

An unbounded tail where each level grants boost tokens or a Surge. Honest, but it
is the indefinite creep the founder just rejected, wearing a level number.
**Recommend against.**

### 7.4 Seasonal ladders

A season resets a *separate* seasonal VP track while lifetime VP and every unlock
stay put. Real work (a season doc, a reset job, seasonal rewards) and it only
matters once there is a population to run a season for. **Later, not now.**

---

## 8. Build order, if this is approved

Each step is shippable on its own and none of it blocks the next.

| # | Step | Needs |
|---|---|---|
| 1 | `users/{uid}.vpBonus` + `activeBonusMult()` in both credit paths + expiry at read time | nothing new |
| 2 | The ladder grants Surge packs at chosen levels (replacing the flat rate rows) | founder picks levels + multipliers |
| 3 | VP shop (§5) with the items marked buildable | a screen, `/prestige` is the natural home |
| 4 | Streak Shield, Open Bar, Squad Surge | §1 done |
| 5 | Coin purchase, **only if §6.2 is answered** | founder decision |
| 6 | Legacy VP at L100 (§7.2) | §3 done |
| 7 | Prestige mark (§7.1) | a crest treatment that needs no new art |

## 9. What this plan deliberately does NOT propose

Each of these was considered and rejected, with the reason, so nobody re-raises
them as an oversight:

- **Buying VP directly.** That is buying rank, with no fig leaf. `GIFT_COINS_PER_VP`
  already answers it.
- **Level skips.** Same objection, and it makes every level's reward meaningless.
- **Transferring VP or gifting a bonus to another user.** VP moving between
  accounts makes it a currency, which is the exact shape §2 exists to prevent.
- **A bonus that never expires.** That is the permanent rate creep, renamed.
- **Anything priced against a competitor.** Prices come from our own costs and
  from §5.1's implied rate.

## 10. The one guard this needs from day one

`vp-mirror-check.mjs` must assert that **every bonus offered in the shop resolves
to a real multiplier server-side**, the same way `REWARD_OWNERS` asserts every
ladder row has an implementing file. The lesson is already on the record twice:
`name_glow` sat inert at L100 promising a glow nothing rendered, and three kill
switches were trusted and did nothing. **A bonus that is sold and not honoured is
worse than both, because someone paid for it.**

---

## 11. Prices

⚠ **PROPOSALS. Every one of these is the economy and therefore the founder's to set.**
They are anchored to constants already in the code, not invented: `BOOST_COSTS`
(post 50c, profile 100c, lfg 25c, squad 75c) and `BOOST_TIERS` (50 / 150 / 500c).

### 11.1 The one rate everything uses: **1 coin = 15 VP**

Derived, not chosen. A Stream Boost token costs **50 coins** in `BOOST_TIERS`, and
a fair VP price for one is ~750 VP (about five days for a typical user). 750 / 50
= 15. Every VP price below is exactly its coin price x 15, so the two shops can
never disagree about what a thing is worth.

Sanity check against the ladder: it grants 75 tokens (3,750 coins) across 648,000
VP earned, so the ladder already hands back ~8.7% of your VP as boost value. The
shop rate sits in the same neighbourhood.

### 11.2 ⚠ THE RULE THAT DECIDES WHICH SHOP AN ITEM GOES IN

**Anything that increases VP output CANNOT be bought with VP.** A 200 VP surge
that returns 400 VP is an infinite loop, and no price fixes it: price it above
what it returns and nobody buys it, below and VP inflates without limit.

So the split is forced, and it lands exactly where the founder put it
(*"purchase bonus with VP like post boosts, stream posts"*):

- **VP buys REACH** - boosts, tokens, shields. None of them generate VP.
- **Coins buy RATE** - the surges and the cap lift. Subject to §6.2.

### 11.3 VP shop (VP or coins, same rate)

| Item | VP | Coins | Anchor |
|---|---|---|---|
| LFG Boost, 12h | 375 | 25 | `BOOST_COSTS.lfg` |
| Post Boost, 24h | 750 | 50 | `BOOST_COSTS.post` |
| Stream Boost token | 750 | 50 | `BOOST_TIERS.boost` |
| Squad Boost, 48h | 1,125 | 75 | `BOOST_COSTS.squad` |
| Streak Shield, 3 days | 1,200 | 80 | new |
| Profile Boost, 48h | 1,500 | 100 | `BOOST_COSTS.profile` |
| Streak Shield, 7 days | 2,250 | 150 | new |
| Super Boost token | 2,250 | 150 | `BOOST_TIERS.super` |
| Mega Boost token | 7,500 | 500 | `BOOST_TIERS.mega` |

### 11.4 Surges (coins only, per §11.2)

| Pack | Duration | Multiplier | Coins | Extra VP it can return | Lossy? |
|---|---|---|---|---|---|
| Happy Hour | 1h | 3x | 25 | ~35 VP (2c) | ✅ |
| Flash Surge | 6h | 3x | 75 | ~200 VP (13c) | ✅ |
| Half-Day Surge | 12h | 2.5x | 120 | ~300 VP (20c) | ✅ |
| Day Surge | 24h | 2x | 200 | ~400 VP (27c) | ✅ |
| Weekend Surge | 48h | 1.75x | 350 | ~600 VP (40c) | ✅ |
| Long Surge | 7 days | 1.5x | 900 | ~1,400 VP (93c) | ✅ |
| Creator Surge | 24h | 3x on creator actions | 150 | - | ✅ |
| Community Surge | 24h | 3x on received engagement | 150 | - | ✅ |
| Watcher Surge | 24h | 3x on watch time | 100 | - | ✅ |
| Open Bar | 24h | daily caps lifted | 150 | - | ✅ |
| Open Bar | 7 days | daily caps lifted | 700 | - | ✅ |
| Squad Surge | 24h | 2x for every member | 500 (treasury) | - | ✅ |

✅ **Every row is strictly lossy as arbitrage** at the 15:1 rate, by a wide
margin. The loop cannot pay. Re-check this table if boost-token density changes.

### 11.5 ⚠ TWO DIFFERENT PRODUCTS ARE BOTH CALLED "STREAM BOOST"

`BOOST_COSTS.stream` = **60 coins, 4 hours, "Pinned to Live tab"**.
`BOOST_TIERS.boost` = **50 coins, 15 minutes, 1.5x discovery reach**.

Same name, different price, different duration, different effect. A shop listing
both is a support ticket. **This needs resolving before any shop ships**, most
likely by retiring `BOOST_COSTS.stream`, since `BOOST_TIERS` is the one the
rebuilt boost actually honours.

---

## 12. Art direction and generation prompts

⚠ **THE STYLE IS ALREADY SET AND MUST BE MATCHED, NOT REINVENTED.**
`public/brand/packs/*.webp` (the eight coin packs) are 288x288 transparent WebP:
3D game-asset renders, black obsidian and brushed metal with polished gold trim,
faceted violet gems, each object on a small circular black plinth with a gold
rim. A second visual language in the same shop is the failure that got the
milestone badges rejected (*"those look like shit"*): those were Material Symbols
glyphs on a tinted square and read as a settings row, not as something earned.

⚠ **NO CYAN.** `#4DFFD4` is off-brand. Violet, pink and gold only.
⚠ **Gold is never a flat fill.** It is the ramp #FCEFB4 -> #F5C842 -> #E9A517 -> #C97F12.
⚠ **No text in the image.** Generators mangle letterforms and the app overlays its
own copy anyway.

### 12.1 Output spec

| | Value |
|---|---|
| Generate at | 1024x1024, transparent background |
| Ship as | `public/brand/bonuses/<id>.webp` 288x288 + `<id>@2x.webp` 576x576 |
| Target size | ~20-30KB each, matching the coin packs |
| Cache | ✅ `/brand/**` already has headers in `firebase.json`. Do NOT add a new top-level directory under `public/` without checking that file: the catch-all rule is `no-store`. |

### 12.2 The shared style block - paste this in front of EVERY subject

```
3D rendered game asset, three-quarter view from slightly above, centred on a FULLY TRANSPARENT background. Materials: black obsidian and dark brushed metal with polished gold trim, set with faceted violet gems. Gold is a vertical ramp from pale #FCEFB4 through #F5C842 to deep #C97F12, never a flat colour. Violet runs #7B1FFF to #B44FFF. The object rests on a small circular black plinth with a gold rim and violet inlays. Glossy mobile-game treasure aesthetic, crisp specular highlights, soft violet rim light from behind. NO text, NO letters, NO numbers, NO logos, NO people, NO background scenery. Square 1:1 with even margin so nothing touches the edge. Subject:
```

### 12.3 Per-pack subjects

| id | Pack | Subject (append to the style block) |
|---|---|---|
| `happy-hour` | Happy Hour | a small gold hourglass with violet sand caught mid-fall, a single bright spark of violet energy pinched at its neck |
| `flash-surge` | Flash Surge | a thick gold lightning bolt driven straight through a cracked violet crystal shard, sparks arcing off the fracture |
| `half-day-surge` | Half-Day Surge | two gold lightning bolts crossed in an X over a floating violet orb that glows from within |
| `day-surge` | Day Surge | a gold sun-disc with radiating spokes, ringed by violet energy arcs curling around its edge |
| `weekend-surge` | Weekend Surge | two interlocking gold crescents with violet storm energy churning in the gap between them |
| `long-surge` | Long Surge | a tall gold obelisk wrapped in a spiralling violet energy helix, banded with several gold rings up its height |
| `open-bar` | Open Bar | a shattered gold cage lid burst open from below, violet light pouring up through the broken bars |
| `creator-surge` | Creator Surge | a gold prism splitting a single violet beam into three brighter beams fanning outward |
| `community-surge` | Community Surge | a ring of small gold orbs orbiting a larger violet core, linked by fine gold filaments |
| `watcher-surge` | Watcher Surge | a gold viewing lens on a stand, its glass a deep violet, a soft violet glow spilling from the rim |
| `streak-shield` | Streak Shield | a gold kite shield with a violet flame embossed across its face and a small gold flame cresting the top edge |
| `squad-surge` | Squad Surge | three gold pennant banners planted around a single tall violet beacon, on a wider plinth |

### 12.4 Shop banner (one wide hero, not one per pack)

Same materials, different composition. Generate at **1536x1024**, ship trimmed as
`public/brand/bonuses/shop-hero.webp` + `@2x`, behind a `<picture>` with a
`media:(min-width:1024px)` source so phones never fetch it. Same treatment
`tier-vault.webp` already uses on the earnings screen.

```
Wide cinematic hero, 3:2. A shallow black obsidian vault shelf lit from the upper
left, holding a loose arrangement of gold and violet energy artefacts: an
hourglass, a lightning bolt, a shield, a prism, a small obelisk. Polished gold
trim on every piece, gold running a vertical ramp from pale #FCEFB4 through
#F5C842 to deep #C97F12. Faceted violet gems #7B1FFF to #B44FFF scattered between
them, throwing violet bounce light onto the shelf. Objects clustered in the LEFT
two thirds; the right third falls off into clean near-black #0B0B14 empty space
for headline copy. Soft volumetric haze, shallow depth of field. NO text, NO
letters, NO numbers, NO logos, NO people.
```

### 12.5 ⚠ Reject any render that does this

- a flat gold fill instead of the ramp - it reads as orange paint
- any cyan or teal
- a floor, horizon or room - the objects float on a plinth, nothing else
- text or numerals, however small
- an object touching the frame edge - it crops badly inside a card
- a style that is not the coin-pack style. If the two sit side by side in the
  shop and look like different games, the render is wrong even if it is pretty.
