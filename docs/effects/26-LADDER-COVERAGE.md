# The ladder, level by level — coverage and what is still missing

**This is the document that should have existed before the first reward shipped.**
It did not, and the cost was measurable: on 2026-08-27 the founder asked whether
any levels give nothing, and the answer was **56 of 100 gave only the +0.5% VP
earn rate** — nothing visible, nothing equippable, nothing anyone else can see.

## Why it happened

Rewards were added one at a time, each as its own effect shipped, and the ladder
was never laid out end to end and read as a whole. Two things hid it:

1. **`assertNoDeadLevels` proved the wrong thing.** It asserts every level 1-100
   has a ROW. Every level did — because every level carries a `vprate_` row. The
   guard was green while more than half the ladder was hollow. A guard that
   measures the thing you can measure instead of the thing that matters is worse
   than no guard, because it ends the enquiry.
2. **Eight rewards were cut before shipping** (emote packs, pinned-post slots,
   comment tint, audio clip, profile links, trophy case, post reactions) under
   the correct rule "do not promise what does not exist". Cutting them was right.
   Leaving the holes they left unfilled, and never counting them, was not.

## What fixed most of it: the content already existed

The single biggest cause was **32 shipped items handed over by 3 ladder rows**:

| Pool | Items | Was | Now |
|---|---|---|---|
| Typefaces (`nameFonts.js`) | 18 | all at L3 | 3 bundled at L3, 15 drip-fed to L90 |
| Chat themes (`chatThemes.js`) | 8 | all at L23 | one per level, L7 to L85 |
| Typing indicators | 6 | all at L32 | `dots` free, 5 drip-fed L9 to L64 |

`PROFILE_ACCENTS` (12) and `PROFILE_THEMES` (8) were drip-fed one per level from
the first version. **The pattern already existed and was applied inconsistently**
— that is the whole bug. No new content was built to fix 26 levels.

**Result: 44/100 rewarding → 70/100.**

⚠ **This was the right moment to do it and will not be again.** Spreading a pool
TAKES AWAY items a high-level user already had. Balances today are test data
(REVENUE_SHARE_PART2 decision 7) and nobody is above L2, so the migration cost is
zero. After real users exist, re-spreading a pool is a downgrade and needs a
grandfather clause.

## RESOLVED 2026-08-27 — the ladder is COMPLETE, 100/100

Founder: *"I have already told you how boosts will work in the VP ladder, we are
using them to fill empty gaps."* So the 26 levels that still paid nothing but the
+0.5% earn rate now grant a **Stream Boost token**. `BOOST_TOKEN_LEVELS` went
**11 -> 37**, mirrored in `functions/vpLevel.js`.

| Band | Rewarding |
|---|---|
| every band, 1-100 | **10/10** (Ascendant 9/9, Immortal 1/1) |

Filled: 10, 19, 22, 29, 34, 39, 42, 43, 48, 53, 58, 59, 69, 74, 77, 78, 80, 82,
87, 89, 94, 95, 96, 97, 98, 99.

✅ **Nothing else could have filled them.** Verified against the built pools, not
assumed: fonts 18 built / 15 drip-fed + 3 free, chat themes 8/8, accents 12/12,
profile gradients 7 + 1 free, typing styles 5 + 1 free. **Every built cosmetic
already had a level.** The only fillers available were boost tokens or content
that does not exist.

## The guard that was missing, and now exists

⚠ `assertNoDeadLevels` proves every level has a ROW, and every level always did,
because every level carries a `vprate_` row. **It was green the entire time 56 of
100 levels were hollow.** New `assertNoHollowLevels()` counts rows that are NOT
`vprate_`, and `vp-mirror-check.mjs` fails the build on any level returning zero.
Negative-tested by deleting two levels from the list: it named 95 and 96.

Fixed in passing: the boost mirror check parsed the server array with a naive
`split(',')`, so the trailing comma on the now-multi-line array produced a
phantom **level 0** and failed a mirror that was correct.

## ⚠ ONE THING THE FOUNDER SHOULD LOOK AT

**L93-99 is now seven consecutive Stream Boost tokens.** No level is hollow any
more, which was the goal, but the top band pays the same reward seven times in a
row. Shorter runs at 42-43, 58-59, 76-78.

Two ways to break the run up, both ECONOMY decisions and therefore founder calls:

1. **Grant more than one token** at high levels. `BOOST_TOKEN_LEVELS` becomes a
   level->count map; `vpLevel.js` already increments by a computed total, so this
   is a small change and needs no schema change.
2. **Grant a higher TIER** (Super/Mega) at high levels. This one IS a schema
   change: the wallet holds a single flat `boostTokens` count with no tier, and
   `boostStream` always redeems at `TOKEN_TIER_ID`.

Effect 22, if built, would ADD to L94 rather than replace its token.

## The rule this leaves

**Adding a reward pool means assigning a level to every ITEM in it, not to the
pool.** `vp-mirror-check.mjs` asserts each typeface, chat theme and typing style
has its own ladder row at its own level, and that no two share a level —
negative-tested by stacking two fonts, which fails the run.

**And a coverage guard must count what the PLAYER sees, not what the table
contains.**
