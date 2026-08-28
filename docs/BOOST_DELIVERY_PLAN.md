# Boost delivery: making it scale, and making it fair

**STATUS 2026-08-28: §1-§4 and §6.1-6.5 are BUILT, SHIPPED AND DEPLOYED.**

| Item | State |
|---|---|
| All six suggestion surfaces honour a boost | ✅ via one shared `getBoostedUsers()` |
| Fair rotation (`boostBucket` + empty-bucket fallback) | ✅ index deployed |
| Relevance targeting off device-local affinity | ✅ zero reads |
| Viewer excluded from their own suggestions | ✅ |
| Muted author outranks a payment | ✅ |
| 6-hour sidebar cache bypassed for the boosted slot | ✅ |
| Feed block (`SuggestedPeopleBlock`, every 14 posts) | ✅ the unbounded inventory |
| Batched impressions + unique views | ✅ `recordBoostImpressions`, boost-scoped |
| Buyer receipt (followers gained, impressions, people) | ✅ wallet → My boosts → RUNNING NOW |
| `viewCount` and the boost counters locked server-only | ✅ |
| Copy rewritten to the honest promise | ✅ |
| Guard: every surface must call `getBoostedUsers` | ✅ negative-tested |

**NOT built, and deliberately:**

⚠ **The PUBLIC post view count.** Counting every post is precisely the cost we
cannot carry (§6.3): 20,000 writes a day, and one popular post would spend all
of them. `incrementViewCount()` still has zero callers and `viewCount` is still
always 0. Only BOOSTED items are counted, and those numbers are private to the
buyer. A display floor of 50 now guards the render site so that if public
counting is ever built it cannot ship showing "3 views" — but building it needs
a sampling design and a decision that the write budget is worth spending there.

---
Founder: *"all boosts need to be scalable, so that there aren't bottlenecks and
everyone gets fair value for what they have paid. we can't if we have a million
users, 1 in 4 in the rail isn't going to work."*

---

## 1. The two problems, stated honestly

### 1.1 I wired two surfaces out of six

The Profile Boost was added to `HomeFeedRail` and `DiscoveryStrip` only. The
founder opened Explore and the boosted account was not first, because **Explore
was never touched**. This is the same failure the avatar orbit had: work done on
one mount point while the others go untouched.

**Every surface that suggests a USER to follow:**

| # | Surface | File | Boost wired? |
|---|---|---|---|
| 1 | Home right rail, "Who to follow" | `components/brand/HomeFeedRail.jsx:86` | ✅ |
| 2 | Discovery strip, suggested users | `components/DiscoveryStrip.jsx` | ✅ |
| 3 | **Explore, "Recommended Creators"** | `screens/explore/ExploreScreen.jsx:922` | ❌ **this is the one he saw** |
| 4 | **Explore NATIVE, "Recommended Creators"** | `screens/explore/native/NativeExploreScreen.jsx:304` | ❌ |
| 5 | **Right sidebar panel, suggested users** | `components/RightSidebarPanel.jsx:56` | ❌ |
| 6 | **Onboarding, who to follow** | `screens/onboarding/OnboardingFlowScreen.jsx` | ❌ |

Out of scope, checked and excluded on purpose: `CreateComposer` "Suggested for
you" (that is tagging people in a post, not following them), `FriendsScreen`
(your existing friends), `BrowsePlayersScreen` (an explicit search, where the
user asked for something specific and injecting a paid result is a different and
worse product decision).

⚠ **`RightSidebarPanel` caches its suggestions in localStorage for SIX HOURS**
(`SUGGESTED_LS_KEY`, `SUGGESTED_TTL_MS`). A boost bought now would not appear
there for up to six hours on a returning device. On a 48-hour product that is
12% of the purchase silently undelivered, and on a 15-minute stream boost it
would be the whole thing. Any surface that caches must either exclude the
boosted slot from the cache or hold a much shorter TTL for it.

### 1.2 The delivery model breaks at the second concurrent boost

Today every reader does:

```js
where('boostExpiresAt','>',now), orderBy('boostExpiresAt','asc'), limit(2)
```

**That is deterministic.** The two boosts expiring soonest are returned to
*every viewer, on every render, everywhere.* With 1,000 boosted profiles live,
998 people have paid and receive **zero impressions**. That is not an unfair
split, it is a complete failure to deliver, and it gets worse the more successful
the product is.

⚠ **The Post Boost does NOT have this problem and should not be changed.** A post
boost multiplies the post's own score inside the viewer's own feed
(`scorePost` × 3), so every boosted post competes on its own merit against that
viewer's own content. It scales by construction. **Only the surfaces that MERGE a
boosted item to the front of a shared list bottleneck: profiles and squads.**

---

## 2. The three things that fix it

### 2.1 Fair rotation — a random shard, so everyone gets a turn

Give every boost a random `boostBucket` (0-99) when it is applied. Readers query
**one random bucket**:

```js
where('boostBucket','==', Math.floor(Math.random()*100))
where('boostExpiresAt','>', now)
```

- With 1,000 live boosts a bucket holds ~10, and **every boost has an equal
  chance of being in the bucket that gets queried**. Fair by construction.
- No impression counters, no writes, no cron. The fairness is in the data layout.
- Cost: one composite index, `(boostBucket ASC, boostExpiresAt ASC)`.

⚠ **It must fall back at LOW volume, and this is not optional.** With three live
boosts, a random bucket is empty ~97% of the time and nobody would ever be shown.
So: query the bucket, and **if it returns nothing, re-run unsharded**. At launch
that is always the fallback (correct — with three boosts, show all three); at
scale the bucket almost always hits and the fallback never runs. Self-tuning,
with no config value to forget to change.

### 2.2 Relevance — show it to people likely to actually follow

The founder has asked for this twice, and the machinery already exists. Once the
bucket gives ~10 candidates, rank them **client-side** against the viewer's own
interest affinity, exactly as `rankStreams()` already does for stream boosts.

- Affinity lives in `feedPrefs`, which is **device-local**, so this costs
  **zero reads**.
- `inferPostTopics` / topic weights are already built and already used by the
  feed.
- The buyer gets a follow rather than an impression, which is the thing they are
  actually buying.

⚠ This also **shards the pool a second time, by interest**, which relieves the
bottleneck further: a Valorant creator and a music creator stop competing for the
same slot because they are shown to different people.

### 2.3 More inventory — a fixed rail can never scale, the feed can

"1 in 4 in the rail" is a hard ceiling: four slots, however many buyers. The rail
cannot be the answer.

**Suggested-user blocks injected into the feed** are the answer, because the
inventory grows with scroll depth instead of being fixed:

| Placement | Slots | Notes |
|---|---|---|
| Home right rail | 1 of 4 | keep the cap — a rail that is mostly ads stops being a recommendation |
| **Feed block, every ~15 posts** | 3-4 per block | **unbounded**: a long session generates many blocks |
| Explore "Recommended Creators" | 1-2 of the grid | biggest single surface, currently unwired |
| Onboarding | 1 of the set | highest-intent moment in the product; a brand-new user IS looking for people to follow |

⚠ **The feed block is the only one that scales without limit**, and it is also
the one that does not yet exist. It is the main build in this plan.

⚠ **A feed block must be labelled and must be skippable.** An unlabelled paid
suggestion inside the feed is an ad pretending to be content, which is the thing
that makes feeds feel cheap. Label it, and let "not interested" dismiss it the
same way a post can be dismissed.

---

## 3. What the buyer is actually promised

This has to change, and the copy has to change with it.

**Today's implied promise:** "a slot for 48 hours". At scale that is a promise we
cannot keep and should never have printed.

**The honest promise:** *"For 48 hours you are shown to people likely to follow
you, across the feed, Explore and suggestions."* Eligibility for a window, with
relevance targeting — not a reserved seat.

⚠ **Proof of delivery, at zero cost.** Counting impressions means a write per
impression, which is unaffordable. The number that matters is conversion, and it
is already free: **followers gained during the boost window**, derived from the
follow writes that already happen. Show that on the boost, in the wallet:
*"Profile Boost — 14 new followers while it ran."* That is a better number than
impressions anyway, and it costs nothing new.

---

## 4. Build order

| # | Step | Why this order |
|---|---|---|
| 1 | Wire the 4 missing surfaces (Explore web + native, right rail, onboarding) | The product is currently lying about where a boost appears. Fixes the founder's actual complaint. |
| 2 | Exclude the viewer from their own suggestions | Verion was suggested to Verion. Wrong regardless of boosts. |
| 3 | Shorten / bypass the 6-hour `RightSidebarPanel` cache for the boosted slot | Silent undelivery |
| 4 | `boostBucket` + bucket-first-with-fallback reader | The fairness fix. Needs one composite index. |
| 5 | Interest ranking of bucket candidates | Relevance, zero read cost, reuses `rankStreams`'s shape |
| 6 | Suggested-user block in the feed | The inventory fix, and the only unbounded one |
| 7 | "Followers gained while boosted" | Proof the buyer got value |
| 8 | Rewrite the boost copy to the honest promise | Must not ship before 1-6 |

Steps 1-3 are corrections to what is already live and should go first regardless
of whether the rest is approved.

---

## 5. Founder decisions (answered 2026-08-28)

| Question | Decision |
|---|---|
| Paid slot in the rail? | **Keep one of four.** Feed blocks are additive inventory, not a replacement. |
| Boosted above verified? | **Yes.** That is what was bought. |
| Tiebreak between two eligible boosts | **Relevance only, never spend.** Spend-ordering makes it an ad auction, which is a different business. |
| Labelled? | **Yes, labelled.** The Boosted pill on posts shipped 2026-08-28 and sets the precedent. |

---

## 6. Views and impressions — so the buyer is not blind

Founder, 2026-08-28: *"we should have a views counter as well as impressions so
that the user can actually see activity rather than being blind... a view counter
was originally created for posts but we hid it since the first few users would
see low numbers and be discouraged."*

### 6.1 What is actually in the code today

| Fact | Detail |
|---|---|
| `viewCount` exists on every post | written as `0` by `createPost` (`firestore.js:499`) |
| `incrementViewCount()` exists | `firestore.js:1280` |
| **It is called from NOWHERE** | grep returns zero callers, so `viewCount` is permanently 0 |
| PostCard already renders it | `PostCard.jsx:952`, gated on `viewCount > 0` — so it shows nothing, ever |

⚠ **So it was never "hidden", it was never CONNECTED.** The display code has been
sitting there the whole time behind a condition that can never be true. Nothing
needs unhiding; the counting needs building.

⚠⚠ **SECURITY HOLE, and it must be closed before any number is shown.**
`firestore.rules:511` lets ANY authenticated client write `viewCount` on ANY
post (it is in the same `hasOnly` allowlist as the like and comment counters).
The moment a view count is visible it is also **self-inflatable by anyone with
the console open** — and worse, inflatable on someone else's post. A vanity
number nobody trusts is worse than no number. `viewCount` has to become
server-only, like `boostExpiresAt` did.

✅ **There IS a working precedent to copy for UNIQUE viewers:** Status/stories use
`viewerIds: arrayUnion(uid)` plus `viewCount` (`StatusScreen.jsx:281`). That is
the right shape for a story seen by tens of people. **It does NOT scale to posts**
— an array of every viewer hits the 1MB document ceiling and costs a write per
viewer.

### 6.2 The two numbers, defined, because they are not the same

| | Means | Industry equivalent |
|---|---|---|
| **Impressions** | how many TIMES it was put in front of someone | X calls this "Views"; Instagram calls it Impressions |
| **Views** | how many DISTINCT people saw it | Instagram calls this Reach |

Both are worth showing precisely because the gap between them is informative:
10,000 impressions and 800 views means the same people saw it repeatedly, which
is a very different outcome from 10,000 impressions and 9,000 views.

⚠ **A "view" needs a definition or the number is meaningless.** Proposal, matching
the mainstream: the item entered the viewport and stayed for **1 second**
(IntersectionObserver, ~50% visible). For a video, first frame played. Not "it
was in the DOM" — a feed renders far more than anyone looks at.

### 6.3 ⚠ THE COST PROBLEM, WHICH DECIDES THE WHOLE DESIGN

**One Firestore write per view is unaffordable.** Spark gives 20,000 writes/day.
A SINGLE post seen 20,000 times would consume the entire day's write budget for
the whole platform. Naive counting is not an option at any scale.

Three affordable approaches, and the recommendation:

| Approach | Cost | Trade |
|---|---|---|
| Sampled counting: record 1 in N, display × N | writes ÷ N | the number becomes an estimate, which every platform's already is |
| Session batching: one write per viewer per session listing what they saw | 1 write/session | needs a fan-out to update each post, which costs the writes back |
| **Count ONLY while a boost is running** | bounded by live boosts, not by content | no numbers on unboosted content |

✅ **RECOMMENDED: boost-scoped counting, plus sampling if it ever needs it.**

The insight is that **you do not need view counts on all 50,000 posts — only on
the handful boosted right now.** That bounds the cost by the number of live
boosts (a business input we control and get paid for) instead of by content
volume (unbounded). It is also exactly the number the buyer paid to see, so the
cost lands on the thing generating the revenue.

Mechanically: while `boostExpiresAt > now`, the reader that already decided to
show the item also increments `boostImpressions` on it. **No new read** — the
document is already in hand.

### 6.4 The discouragement problem, and why it does not apply here

The founder is right that "3 views" on a new user's post is demoralising, and
that is a real reason platforms hide numbers (Instagram hid like counts for
exactly this).

⚠ **But a BOOST counter is private to the buyer.** It is a receipt, not a public
scoreboard, so there is nobody to be embarrassed in front of. Low numbers on a
boost are *useful* information: it says the boost underdelivered and we owe an
explanation.

So the two cases split cleanly:

| | Who sees it | Threshold |
|---|---|---|
| **Boost stats** (impressions, views, followers gained) | the BUYER only | none — always show, even if it is 4 |
| **Public post view count** | everyone | only display above a floor (~50), so a post never reads "3 views" |

### 6.5 What the buyer sees

On the boost, live while it runs and kept afterwards:

```
Profile Boost · 14h 20m left
  8,412 impressions
  6,190 people
     14 new followers
```

**Followers gained stays the headline** — it is free (follow writes already
happen), it is the outcome rather than the activity, and it is the honest test of
whether the boost was worth buying. Impressions and views sit under it as the
"is this thing actually running" reassurance the founder is asking for.

### 6.6 Build order for this section

| # | Step |
|---|---|
| 1 | **Lock `viewCount` server-only in firestore.rules** — before anything is displayed |
| 2 | `boostImpressions` + `boostViews` incremented by the surfaces that already show the item |
| 3 | Unique views via a bounded device-local seen-set, so a refresh is not a new view |
| 4 | Buyer-facing stats block on the boost, in the wallet |
| 5 | Public post view count, behind a display floor, only once counting is real and server-only |

⚠ Step 1 is a correction to live behaviour and is worth doing on its own: today
any user can write any post's `viewCount`, and although nothing displays it, the
Creator Studio content screen already SORTS and TOTALS by it
(`CreatorContentScreen.jsx:76,81,91`).
