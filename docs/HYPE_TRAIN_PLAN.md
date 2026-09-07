# Hype train: the plan

Founder-directed, 2026-09-06. **Nothing here is built yet.** The preview carries a ribbon and
a placeholder set of constants; this replaces those constants with a designed system.

Every number below is derived from a stated principle or from a constant already in the code.
Where a number is a judgement call it says so.

---

## 1. What has to be true, before any number

A hype train is a **room event**, and four things follow from that alone:

1. **One person must not be able to make one.** If a single tip can start and finish a train,
   it is a purchase with an animation on it, not a shared moment. This is the constraint that
   shapes most of the design.
2. **It has to be reachable in a small room and still mean something in a big one.** A goal
   that only large streams can hit makes the feature useless to exactly the creators who need
   help growing.
3. **It has to be able to fail.** No countdown, no urgency, and no reason for the fifth person
   to join in rather than watch.
4. **It has to escalate.** If level 5 is as easy as level 1 there is no climb, and reaching
   the top means nothing.

---

## 2. The goal scales with the room, sub-linearly

**Founder anchor:** ten people watching, roughly a thousand coins to complete the first level.

Linear scaling fails immediately. At 100 coins per viewer, a thousand-viewer stream would need
**100,000 coins**, about $1,000 of tips, for one train. The feature would exist only for small
streams, which is backwards.

The reason is that the goal should track the number of people **likely to tip**, not the number
of people present, and participation rate falls as a room grows: in a room of ten, several
people might contribute; in a room of ten thousand, a fraction of a percent do. A square root
is the simplest curve with that property.

```
Level 1 goal  G = 316 x sqrt(viewers)      (anchored so 10 viewers -> 1,000)
```

| Viewers | Level-1 goal | Coins per viewer |
|---|---|---|
| 10 | 1,000 | 100 |
| 25 | 1,580 | 63 |
| 50 | 2,235 | 45 |
| 100 | 3,160 | 32 |
| 500 | 7,065 | 14 |
| 1,000 | 9,995 | 10 |
| 10,000 | 31,600 | 3.2 |

The ask per head falls as the room grows, which is the behaviour we want and the reason the
curve is a square root rather than a line.

⚠ **The viewer count is frozen when the train starts.** If it tracked live numbers the goal
would move while people were pushing at it, and a bar that recedes as you fill it is a broken
promise. Snapshot at trigger, use it for the whole train.

---

## 3. No whale trains

**Any one person's contribution counts toward the meter for at most 40% of the current level's
goal.** Above that, the tip still lands in full, the creator still receives all of it, and the
sender still earns their VP. Only its contribution to the *meter* is capped.

40% is chosen because it is the largest cap that still forces **three** distinct contributors,
and three is the smallest number that reads as a group. A tighter cap would make small rooms
unable to start a train at all, which fails principle 2.

---

## 4. Levels escalate

```
Level n goal = G x (1 + 0.5(n - 1))     ->  1.0G, 1.5G, 2.0G, 2.5G, 3.0G
```

Cumulative to level 5 is **10 x G**. In a ten-person room that is 10,000 coins, which should be
rare and feel like it. Most trains will die at level 1 or 2, and that is correct: a level 5
that happens every stream is not worth reaching.

**Timer: 5 minutes, extended 30 seconds by each contribution, hard cap 15 minutes.** Five
minutes is Twitch's proven window. The extension keeps a live room alive; the cap stops one
never-ending train swallowing a whole stream.

---

## 5. The reward goes to the CREATOR, as coins or VP, at random

**Budget = 20% of the coins the train actually received** (not of the goal, of what landed),
capped at **5,000 coins**. Founder decision, 2026-09-06 and 2026-09-07. Paid to the **creator**,
as **either** a coin bonus **or** a VP bonus.

⚠⚠ **NEVER BOTH.** Founder, 2026-09-07: *"we NEVER give both ... either coin or VP but not
both."* `settleTrain()` returns the unused branch as `0` so no caller can read a stale figure
off it, and `npm run check` settles 20,000 trains and fails if a single one pays two rewards
or none.

⚠⚠ **THE CAP IS WHY THE ABSOLUTE CANNOT RUN AWAY.** A percentage keeps the ratio safe at any
size and bounds nothing: the full-train bonus is `632 x sqrt(viewers)`, so a 10,000-viewer room
mints 63,200 coins off one train. The cap does not bind until roughly 63 viewers, which is
deliberate, because the whole case for the feature is the small room. A 10-viewer full train
still pays the uncapped 1,998.

⚠⚠ **VP IS PRICED OFF THE LEVEL REACHED, NOT OFF THE COINS. 50 VP per level, so a max train
pays 250.** Pricing it off the coin count was the worst error in the first build: a
13,590-coin train paid **2,718 VP**, five times the VP that entire tipping event generated for
every tipper combined (a tip pays the sender 1 VP per 25 coins, `GIFT_COINS_PER_VP`) and about
eighteen times the largest single VP award anywhere in the product (host a live event, **150**,
`creatorQuests.js:94`). Coins and VP are not the same unit and must never share a number.

Per level, the VP branch cannot be inflated by a whale because it never reads the coin total,
and it self-limits down the ladder: 250 VP is 12.5% of an early level (2,000 VP) and a rounding
error at L90 (11,000 VP), so it helps a new creator and barely moves an established one.

⚠ **A COIN RESULT UNDER 25 COINS PAYS VP INSTEAD.** Being handed 4 coins reads as being fobbed
off and is worth less than the branch it beat. Still exactly one reward.

⚠⚠ **THE PEOPLE WHO TIPPED GET NOTHING BACK, AND THAT IS THE DESIGN.** An earlier draft of this
plan paid the contributors and it was wrong in every direction: it turned the train into a
rebate on tipping, it created a loop where rewarded coins could be tipped into the next train,
and it made VP the booby prize, because a tipper has ALREADY earned VP from the tip itself
(1 per 25 coins, `GIFT_COINS_PER_VP`, `functions/index.js:841`) so a small VP bonus reads as
being fobbed off. Paying the creator removes all three problems at once.

**Why VP works here and did not there:** a creator earns **no VP from receiving a tip** —
`sendTip` awards `vpEarned` to the sender only. So a VP bonus on a completed train is
entirely new value to them, and does not have to be inflated to compete with something they
already had. It is progression and rank, which is what a creator actually wants, and it never
touches the money path.

**One draw per completed train**, not per level and not per person. The amount scales with the
level reached automatically, because the budget is a percentage of what landed and a higher
level means more landed.

**What each outcome costs us:**

- **VP:** no direct cost. The only real cost is downstream: the level ladder grants 47 boost
  tokens across 100 levels, each redeemable as a 50-coin stream boost we would otherwise sell,
  so accelerating a creator up the ladder brings that forward. Small, and bounded by the ladder
  itself.
- **Coins:** **coins are never withdrawable**, so a coin given to a creator can only ever be
  spent inside Vergr. Spent on a boost, a VP pack, a membership or an unlock it costs us
  **nothing** — we simply do not book a sale we might not have made. It only costs us if they
  tip it onward to another creator, at that creator's share.

So the true expected cost is well under the worst case modelled below, in both branches.

## 6. Why this cannot lose money

Per coin, from source:

| | Value |
|---|---|
| Net revenue per coin sold | **$0.011628** (`TARGET_NET_USD_PER_COIN`, worst case, the ladder floor) |
| Owed to the creator per coin earned | `share x $0.01` (`COIN_MICRO_USD = 10_000`) |
| Creator share | 50% to 80% (`REVENUE_SHARE_RATES`) |
| **Margin retained per coin tipped** | **$0.003628** (80% creator) to **$0.006628** (50% creator) |

The coins that feed a train were bought before they were tipped, so that margin is already
banked when the train completes. The reward is spent out of it.

Worst case: the coin branch comes up, top-tier creator, and every rewarded coin is later
tipped onward to another top-tier creator.

```
train receives   T coins
margin banked    T x $0.003628
reward           0.20T coins, costing at most 0.20T x $0.008 = T x $0.0016
retained         T x $0.002028   ->  56% of margin kept
```

At the other end of the ladder (50% creator) we keep **76%**. Break-even would not arrive until
about **45%** given back, so 20% sits behind a 2.3x safety factor at the tightest point. Every
VP result instead of a coin result pushes it further out.

### 6.1 The guarantee is enforced in code, not by the percentage being small

⚠⚠ **FOUNDER RULE, 2026-09-07, VERBATIM:** *"when giving coins, the rule is that i should
ALWAYS make money and never lose money."*

The arithmetic above is only true while `TRAIN_BONUS_PCT` stays at 20%. That makes the
guarantee a **comment**, and a comment is not a control. `maxSafeCoinBonus()` in
`src/utils/hypeTrain.js` is the control:

```
margin(T, share)  = T x ($0.011628 - $0.01 x share)
maxSafe(T, share) = floor( margin x (1 - MARGIN_FLOOR) / ($0.01 x 0.80) )
paid              = min( pct x T, cap, maxSafe )
```

`TRAIN_MARGIN_FLOOR = 0.50`, so **we keep at least half the margin on every train, whatever
else changes**. At the tightest tier the clamp lands at 22.7% of the raise, so the current 20%
never reaches it: it is a safety net, not the mechanism. Measured, with the rate deliberately
raised past sanity:

| rate | wanted | clamp | paid | kept on a 10,000-coin train |
|---|---|---|---|---|
| 20% | 2,000 | 2,267 | 2,000 | $20.28 |
| 25% | 2,500 | 2,267 | 2,267 | $18.14 |
| 50% | 5,000 | 2,267 | 2,267 | $18.14 |
| 90% | 9,000 | 2,267 | 2,267 | $18.14 |

`npm run check` sweeps all seven share tiers against train sizes from 100 to 1,000,000 coins
and fails the build if a single combination leaves the platform behind. Negative-tested:
replacing the clamp with `Infinity` fails it immediately.

Full 5-level trains, measured:

| viewers | raised | bonus | margin | worst-case cost | we keep |
|---|---|---|---|---|---|
| 10 | 9,990 | 1,998 | $36.24 | $15.98 | **$20.26 (56%)** |
| 50 | 22,340 | 4,468 | $81.05 | $35.74 | **$45.31 (56%)** |
| 100 | 31,600 | 5,000 (capped) | $114.64 | $40.00 | **$74.64 (65%)** |
| 1,000 | 99,930 | 5,000 (capped) | $362.55 | $40.00 | **$322.55 (89%)** |
| 10,000 | 316,000 | 5,000 (capped) | $1,146.45 | $40.00 | **$1,106.45 (97%)** |

**$40 is the most a single train can ever cost us**, and only in the branch where the creator
tips every rewarded coin onward to an 80% creator.

---

## 6.2 The randomiser

⚠⚠ **THE SEED IS FIXED WHEN THE TRAIN STARTS, BEFORE THE FIRST COIN LANDS.** Three things
follow and all three are the point:

1. **Nobody can influence the branch by spending.** The result is not a function of what
   anyone pays, which is also why this is not a chance mechanic dressed up as a reward.
2. **Settling is idempotent for free.** A retry, a reconnect or a double-fire recomputes the
   same outcome instead of paying a second, different bonus.
3. **It is auditable.** Given the stored train, the outcome can be recomputed and checked, so
   it can be shown not to have been rigged.

⚠⚠ **IN PRODUCTION THE SEED IS `HMAC_SHA256(SERVER_SECRET, streamId + ':' + trainId)` AND MUST
NEVER REACH THE CLIENT.** The mapping from seed to branch is deliberately public and
deterministic, so a client-visible seed would let a creator read the outcome the moment a train
starts and decide whether to bother promoting it. The preview mints a throwaway local seed.

⚠⚠ **A MARGINAL-SPLIT TEST IS VACUOUS HERE, AND THAT WAS PROVEN RATHER THAN ASSUMED.** The
first version of the guard measured only the coins-versus-VP ratio over 20,000 seeds. Deleting
the murmur3 finaliser from `trainRoll` leaves plain FNV-1a, which measured **64.92% VP against
a 65% weight, passing perfectly**, while emitting the first forty seeds as twenty coins in a row
followed by twenty VP in a row, with a **longest run of 211 identical outcomes**. FNV-1a maps
adjacent inputs to adjacent hashes and consecutive train ids are adjacent inputs.

So the guard measures three things, and the last two are what actually catch it:

| | real hash | FNV-1a only | assertion |
|---|---|---|---|
| VP share | 65.02% | 64.92% | within 1.5pt of the weight |
| repeat rate | 53.89% | **95.25%** | within 3pt of `w² + (1-w)²` = 54.5% |
| longest run | 21 | **211** | at most 60 |

⚠ **Rewarded coins do not count toward train progress.** The loop is smaller now that the
creator is paid rather than the tippers, but it is not zero: a creator can tip their bonus into
another creator's stream, and without the rule those coins could feed a train and mint again.
With it, the cost is exactly `r` rather than `r/(1-r)` and the guarantee holds without
depending on anyone's behaviour.

---

## 7. Abuse

- **Whale solo-completion:** blocked by the 40% cap.
- **A creator tipping their own stream to farm the bonus:** unprofitable by a wide margin, and
  the reward going to the CREATOR does not change that. To pull 1,000 coins into a train they
  must spend 1,000 coins they bought for $11.63. They receive their revenue share (at best
  $8.00) plus a 200-coin bonus (worth at most $2.00 of onward tipping value, and $0 if spent
  inside Vergr). Best case they recover $10.00 of $11.63, losing 14% every cycle. The 40% meter
  cap also forces them to fund three accounts to start a train at all.
- **Chaining trains:** one train per stream per cooldown window, so a stream cannot run them
  back to back off the same crowd.
- **Alt-account padding to clear the 3-contributor floor:** costs real coins per alt and is
  bounded by the same loss as self-tipping.

---

## 8. What it costs us to run: nothing

⚠ This was checked against the founder's absolute rule that no change may cost money.

- **Zero extra Firestore writes.** `sendTip` already writes to the stream doc post-commit
  (`functions/index.js:3868-3880`, stamping `lastTip` and bumping `goal.currentCoins`). Train
  progress rides that same write.
- **No cron and no Cloud Scheduler job.** The train expires on a timestamp evaluated at read
  time, the same pattern boosts and VP bonuses already use.
- **No new service, model call or storage.** Nothing here calls Gemini or any billed API.
- **Viewer count is already on the stream doc**, so the scaling input costs no read.

---

## 9. Still to decide

1. **The VP amount**, and how it compares to the coin branch. It does not need inflating to
   beat something the creator already has, but it still has to be worth drawing. Size it
   against the real level curve in `vpSystem.js` at build time.
2. **The odds of the draw.** Even, or weighted toward VP because it is the cheaper branch?
3. **Cooldown length** between trains on one stream.
4. **Whether the room sees the reward.** Telling the room "this train earned Riven a bonus"
   makes the next train more likely; saying nothing makes it a private payout and wastes the
   moment.
