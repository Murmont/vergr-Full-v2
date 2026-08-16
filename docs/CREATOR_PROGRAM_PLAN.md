# Creator Program — plan

Written 2026-08-15 after auditing the code, not from memory.

**The model, in one line:** anyone can use Vergr. Only a **creator** can monetize.
Users are not creators by default; they apply and are approved, like TikTok.

---

## 1. What the audit actually found

| Question | Answer, verified |
|---|---|
| Does a creator status exist? | **No.** `grep isCreator/creatorStatus/becomeCreator` across `src/` and `functions/` returns only group-chat "creator of the group". There is no concept. |
| Who can receive a tip today? | **Anyone.** `sendTip` (`functions/index.js:3388`) checks auth, recipient id, amount and self-tipping. No eligibility check. |
| Who can be paid out? | Anyone enrolled in payouts. `blockingReason()` checks strikes, frozen, KYC, tax form, payout account, minimum, account age. **No creator check.** |
| Is Creator Studio gated? | Earnings **was** `lock:'lite'`, removed 2026-08-15. `memberships` is still `lock:'pro'`. |

**So today every user is implicitly a creator.** That is the gap.

---

## 2. Target model

### 2.1 Three states on the user

```
users/{uid}.creator = {
  status: 'none' | 'pending' | 'active' | 'suspended',
  appliedAt, decidedAt, decidedBy, reason
}
```

`none` is the default and costs nothing to be in. A `none` user can post, go live,
join squads and groups, create groups, comment, and buy coins. They simply cannot
**accrue revenue**.

### 2.2 The enforcement point

Eligibility must be checked where value is credited, not in the UI. There are two
shared helpers and everything routes through them:

- `functions/coinLedger.js` → `earnedGemCredit()` (inline, used by `sendTip`)
- `functions/coinLedger.js` → `settleEarnedToGems()` (post-commit, used by
  memberships, event tickets, admob rewards, referral revenue, locked content)

Adding the gate in those two places covers every earning surface at once and
cannot be bypassed by a client. A non-creator receiving a tip should be handled
by a **decision the founder owns**: refuse the tip, or accept it as a gift with
no revenue share. See §4.

### 2.3 What "becoming a creator" involves

The application itself is cheap. The value is that it is a **deliberate act** that
creates a record: someone agreed to the Creator Revenue Share Agreement, on a
date, from an account of a known age. That record is what makes the principal
model defensible, and it is what an underwriter will ask for.

Minimum steps, all of which already exist somewhere in the codebase:
1. Accept the Creator Revenue Share Agreement (needs writing, Part 3 step 2).
2. Confirm 18+ (DOB already collected at signup).
3. No active strikes (`activeStrikeCount` exists).
4. Account age (`MIN_ACCOUNT_AGE_DAYS = 30` already added to payouts).

---

## 3. Why this is worth doing beyond product tidiness

- **Legal.** The principal model says Vergr buys content services from suppliers.
  A supplier relationship needs a supplier who **agreed to be one**. Implicit
  creator status undermines the argument the whole migration exists to support.
- **Fraud.** A monetization path open to every account on signup is the path a
  scam ring uses. An approval step with an account-age floor is the cheapest
  possible control.
- **Tax.** Gross-revenue accounting (Part 2 decision 6) implies contractor
  reporting. You cannot report on people who never agreed to be contractors.

---

## 4. Decisions — ANSWERED by the founder 2026-08-15

| # | Decision | Answer |
|---|---|---|
| 1 | Approval | **Manual review.** |
| 2 | Age gate to BECOME a creator | **No.** Account age gates revenue-share PAYOUT eligibility only, which is already built (`MIN_ACCOUNT_AGE_DAYS`). Becoming a creator is a separate, earlier step. |
| 3 | Tip to a non-creator | **Never refuse it.** It is counted and surfaced to the RECEIVER as a reason to become a creator. |
| 4 | Memberships behind Pro | **No.** It is a way to earn, so it is part of revenue share and cannot be charged for. Removed. |
| 5 | Existing users | **Everyone starts at `none`.** Confirmed. |
| 6 | Referrals before applying | **They count.** |
| 7 | Reapply after rejection | **30 days**, matching Twitch. Hard reasons (fraud, strikes, impersonation, underage) are not on a timer. |
| 8 | `pendingCreatorCoins` on approval | **Converts retroactively.** Farming before approval is not a concern: a new creator is on tier 1 and keeps 50%, so the platform earns on it either way, and they are on the bottom tier regardless. |

## 4b. Shipped 2026-08-15

`functions/creatorProgram.js`, all deployed:
- `getCreatorEligibility` — status, the 3 mandatory requirements, live progress on all 4 paths.
- `applyForCreator` — sets `pending` only (manual review). Stores a SNAPSHOT of the measurements on `creator_applications/{uid}`, not a live recompute, so a decision stays auditable.
- `adminListCreatorApplications` / `adminDecideCreatorApplication`.
- Accrual gate in `coinLedger.earnedGemCredit`: `creatorActive === false` routes the gross to `users/{uid}.pendingCreatorCoins` and accrues nothing. `sendTip` passes the status.
- Retroactive conversion inside `adminDecideCreatorApplication`: on approval, one transaction credits gems at the current share, increments `totalEarnedCoinsGross` + `totalGemsEarned`, zeroes the pot and writes an `earned_auto_converted` row (on the Earnings-screen allowlist). Idempotent: the pot is read and zeroed in the same transaction.
- `firestore.rules`: `creator_applications` readable by the applicant, writes callable-only.

### Shipped since
- `settleEarnedToGems` **also gated**. Gating only `earnedGemCredit` covered tips alone; this is the shared path used by memberships, event tickets, season passes, locked content, ad rewards and referral revenue, so without it a non-creator still accrued from every surface except tipping. Same behaviour: value moves to `pendingCreatorCoins`, the settlement marker is written so it stays idempotent, nothing accrues.
- `BecomeCreatorModal` — fires in `CreatorLayout` for any user at `status:'none'`. Capability only, **no earnings figures**, so a fan cannot reverse-engineer creator income.
- `/creator/apply` — requirements + all four paths with live progress, agreement checkbox, held-coins panel.
- `/admin/creators` — Pending/Approved/Rejected, reviews the stored SNAPSHOT not a live recompute, reason codes flagged for whether they block reapplying, warns how many held coins an approval will credit.

⚠️ `git checkout` on `CreatorLayout.jsx` silently reverted the Earnings and Memberships tier unlocks. Both re-applied. **Verify tier locks in that file after any revert.**

STILL TO BUILD: Part 3 leftovers (HistoryScreen to earnings statement, wallet relabelled "Coins", `gemBuyback` founder call, `PLATFORM_SPREAD_BPS`), the Creator Agreement copy, and the dashboard revamp once mockups land.

## 5. Build order once decided

1. `users.creator` shape + `applyForCreator` / `adminSetCreatorStatus` callables.
2. Gate in `earnedGemCredit` + `settleEarnedToGems`. Backend only, no UI.
3. Creator Revenue Share Agreement copy, and accept-on-apply.
4. "Become a creator" screen + the Creator Studio non-creator state.
5. Dashboard revamp (§6).
6. Admin: creator list, suspend, appeal.
7. Native batch, one APK.

---

## 6. Creator dashboard revamp

Current state, measured: `CreatorDashboardScreen.jsx`, 562 lines.

Already fixed 2026-08-15 while auditing: the card headed **"Your wallet — Cash out
any time"** with a working **Request Payout** button. That was a live on-demand
withdrawal entry point, and it read `wallet.totalEarned`, the field inflated by
admin grants. It is now "Your coins / Spend on Vergr", and the quick-link tile
labelled "Payout" now points at `/creator/earnings`.

Still to do:
- The dashboard should read the **creator status** first and show the apply state
  for `none` users rather than empty widgets.
- Money widgets should follow the one-basis-per-number rule established on the
  Earnings screen (see CLAUDE.md): never `totalEarned`, never a capped ledger sum
  for a lifetime figure.
- Design pass against founder mockups, same measured process as the Earnings
  screen. **Mockups needed.**

---

## 7. Outstanding elsewhere (not this plan, but not done)

- Part 3: `HistoryScreen` → earnings statement; wallet relabelled "Coins";
  `gemBuyback` founder call; `PLATFORM_SPREAD_BPS = 200` dies with the flow.
- Native mirrors batch into ONE APK at the end.


## 8. Creator Studio screen map (measured 2026-08-15)

The founder asked what belongs on each screen. Audited rather than assumed:

| Screen | Lines | Carries today |
|---|---|---|
| Home (`CreatorDashboardScreen`) | 561 | Growth over time, coins/views/likes trend, engagement heatmap, when your audience is active, top performing posts, where your coins came from, AI coach, coins tile |
| Analytics (`MonthlyAnalyticsScreen`) | 183 | Engagement Breakdown, Top Performing |

**The problem:** Home holds six analytics sections, Analytics holds two, and Top Performing appears on BOTH. "Where your coins came from" is a third duplicate now that Earnings has it properly.

### Proposed split (needs founder sign-off before any code)

The organising question for each screen is what a creator opens it TO DO.

**Home = "what happened, and what should I do next."** Glanceable, no deep charts.
- Headline KPIs for the current period with a delta against the previous one
- Anything needing action: an unanswered top comment, a scheduled post about to publish, an unresolved strike, an incomplete payout setup
- Next payout date and amount owed, one line, linking to Earnings
- AI coach: ONE next action, not a panel
- Recent posts with their performance, 3 rows, linking to Analytics

**Analytics = the deep dive.** Everything currently stranded on Home moves here.
- Date-range picker driving the whole screen
- Growth over time (followers, views, engagement) with period comparison
- Coins/views/likes trend
- Engagement heatmap + best time to post
- Top performing posts, ranked, filterable, the ONLY place this lives
- Per-format breakdown (clips vs posts vs streams), which does not exist anywhere today

**Earnings** keeps all money. "Where your coins came from" is removed from Home; it already exists there as "Where it came from".

**Audience** keeps demographics and supporters. Note: demographics are still placeholders (pre-existing, flagged in CLAUDE.md backlog).

⚠️ Do NOT build this until the founder supplies mockups and confirms the nav. He has said the revamp follows the UI, and the UI follows this map.
---

## 9. Creator Studio HOME — full plan, for sign-off before any code

Founder instruction: plan it before building so the design can be judged, and
so failure is attributable. Nothing below is built yet.

### 9.1 The one job of this screen

**"What happened since I was last here, and what should I do next?"**

That is the whole brief. Home is not an analytics screen; the deep dive now
lives on Analytics. Home is not a money screen; money lives on Earnings. If a
block on Home does not answer one of those two questions, it does not belong.

The test for every block: **could a creator act on this in the next ten
minutes?** If not, it is analysis, and it goes to Analytics.

### 9.2 Blocks, in order down the page

**1. Greeting + status line.** Name, and one sentence of state:
"3 things need you" / "Nothing needs you, here is how last week went."
Sets the tone: this screen is a to-do list, not a trophy cabinet.

**2. Needs you.** THE differentiating block, and nothing in the studio does this
today. A prioritised list, max 5, each row one tap from resolution:
- Payout setup incomplete, or a payout blocked by a missing requirement
- Creator application pending, or rejected with a reapply date
- An unanswered comment on a post that is currently performing
- A scheduled post publishing in the next 24h, or one that failed to publish
- An active strike, with its expiry date
- A membership tier with zero members after 30 days

Empty state is a win state, not a blank: "Nothing needs you right now."

**3. Since you were last here.** Four numbers, deltas against the equivalent
previous period, no charts: new followers, views, engagement, new members.
A delta is actionable ("down 40%" prompts a click); an absolute is trivia.

**4. Your last post.** One card: thumbnail, published time, and how it is doing
against your own median, not against nothing. "2.1x your usual" or
"below your usual". Links to Analytics for the why.

**5. Next payout.** ONE line. Date, amount owed, and the single next blocking
requirement if there is one. Links to Earnings. No tiles, no breakdown, no
lifetime totals: those exist properly on Earnings and duplicating them is how
three numbers ended up disagreeing.

**6. AI coach.** ONE suggestion with a reason drawn from the creator's own data
("your clips get 3x the engagement of your text posts, you have posted 2 clips
this month"), and one button to act. Not a panel of generic tips.

**7. Quick actions.** Go live, create post, schedule, invite. Four, no more.

### 9.3 Explicitly NOT on Home

- Growth-over-time chart, coins/views/likes trend, engagement heatmap,
  best-time-to-post, top posts ranked  → **Analytics**
- Where earnings came from, lifetime totals, tier ladder, statements → **Earnings**
- Audience demographics, supporter list → **Audience**
- Coin balance tile. The buyer wallet owns coins; a creator screen showing a
  spendable balance next to earnings is exactly the confusion Part 3 removes.

### 9.4 Non-creator state

A user at `creator.status !== 'active'` never sees empty widgets. Home renders
the become-a-creator explainer as the page, with the same capability framing and
no earnings figures, plus their held-support panel if any exists.

### 9.5 Honest risks in this plan

- **"Needs you" is only as good as its inputs.** Six sources, each needing a
  real query. If any is faked or stubbed the whole block loses trust and is
  worse than absent. It ships complete or not at all.
- **"Against your usual" needs a median** over enough posts to mean anything.
  Under ~5 posts it should say "not enough history yet" rather than print a
  misleading multiple.
- **The AI coach can produce generic filler.** If it cannot cite a specific
  number from that creator's own data, it should render nothing.

### 9.6 What is needed before building

Founder mockups, and confirmation of the block order in 9.2. The measured
process used on the Earnings screen applies: measure the mockup, do not eyeball.
