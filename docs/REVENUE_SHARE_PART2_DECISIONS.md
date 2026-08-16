# Revenue Share — Part 2: Decisions, Economics, Accounting, Legal

Companion to `docs/REVENUE_SHARE_PLAN.md` (Part 1). Read Part 1 first.
Founder decisions taken 2026-08-14. **These are settled. Do not relitigate.**

---

## 8. Locked decisions

| # | Decision | Answer |
|---|---|---|
| 1 | Ladder floor | **Start at 50%**, creator climbs. Not 70%. |
| 2 | Payout cadence | **Monthly + minimum threshold** at first. Earns down to twice-monthly, then weekly, as the account matures, becomes trusted, and stays strike-free. |
| 3 | Payout destination | **Payout partner.** Partner becomes payer of record. |
| 4 | `gemTransfer` | **REMOVE.** Founder: "its a red flag." |
| 5 | Coin price | **Sale price = face value.** Requires a hard split between platform money and money owed out. See §11. |
| 6 | Gross-revenue tax accounting | **Accepted**, conditional on admin automation. See §12. |
| 7 | Existing balances | **No migration needed.** Balances today are test data; other users joined without purchasing. Clean cutover. |

Decision 7 is a major unblock: no grandfathering, no dual-rate period, no
compensation policy, no migration script.

---

## 9. Five code/ToS contradictions found while auditing

**These are live problems today, independent of this project.** Three of them
understate what Vergr takes, which is a consumer-protection exposure on its own.

| # | ToS says | Code does | Severity |
|---|---|---|---|
| 1 | §7.4: commission floor is "five percent (5%)" | `COMMISSION_RATES` floor is **15%** (`src/utils/vpSystem.js:43`) | **HIGH** — promises a better rate than delivered |
| 2 | §8.5: "VERGR does NOT take an additional fee on the Gem-to-cryptocurrency payout itself" | `PLATFORM_SPREAD_BPS = 200`, a **2% spread** (`functions/withdrawals.js:47`) | **HIGH** — undisclosed fee, direct contradiction |
| 3 | §10.4: "10% Platform Fee; the remaining ninety percent (90%) is credited to the creator" | 10% then conversion commission stacks; creator really gets **61.7-75%** | **HIGH** — materially overstates creator share |
| 4 | §8.3: Hold Period is "seven (7) days" | `HOLD_DURATION_MS = 3 days` (`functions/withdrawals.js:45`) | LOW — favours the user, still wrong |
| 5 | §8.6: payouts are "USDT-TRC20" via a crypto processor | Actual rail is **Circle, USDC on Base** | MEDIUM — wrong asset and network |

All five are resolved by the §13 rewrite, but #1, #2 and #3 are wrong *now* and
would stay wrong if this project stalled.

---

## 10. The new revenue share ladder

Keyed to **lifetime gross earnings**, not VP. Field already exists:
`wallets/{uid}.totalEarnedCoinsGross` (`functions/coinLedger.js`, `earnedGemCredit`).

Deliberately 7 tiers so it drops into the existing 7-entry array shape in
`src/utils/vpSystem.js`, minimising churn across the three mirrors.

| Tier | Lifetime earned | **Creator keeps** | Vergr gross |
|---|---|---|---|
| 1 | $0 | **50%** | 50% |
| 2 | $50 | 55% | 45% |
| 3 | $250 | 60% | 40% |
| 4 | $1,000 | 65% | 35% |
| 5 | $5,000 | 70% | 30% |
| 6 | $15,000 | 75% | 25% |
| 7 | $50,000+ | **80%** | 20% |

Why this shape:

- **Entry at 50%** matches TikTok and Twitch exactly. A new creator is no worse
  off than the platform they came from, and we do not pay out margin to accounts
  that may never produce.
- **Top at 80%** matches OnlyFans and beats today's effective ceiling of 75%, so
  the ladder is real progression, not a repackaging of the status quo.
- **The climb is the product.** Kick cannot copy it without abandoning their flat
  rate, and it fits the existing rank/progression identity.

**This replaces BOTH deductions.** No separate tip fee, no separate conversion
commission. One number, stated as what the creator earns.

Proposed constants (Part 3 confirms naming):

```js
export const REVENUE_SHARE_RATES      = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80];
export const REVENUE_SHARE_THRESHOLDS = [0, 5000, 25000, 100000, 500000, 1500000, 5000000]; // COINS gross
```

Thresholds in coins because that is what `totalEarnedCoinsGross` counts. At
1 coin = $0.01 these equal the USD figures above.

**Three mirrors must stay byte-aligned**, same as today:
`src/utils/vpSystem.js`, `functions/economy.js`, `functions/coinLedger.js`.

**Vanguard is OUT OF SCOPE.** The Vanguard programme is being completely redone
separately. `isVanguardExempt` is left exactly as it is by this project. Do not
change it, do not design around it, and do not raise it as a decision.

---

## 11. The accounting model (decision 5)

Requirement: at any moment, know **how much is Vergr's and how much is owed out**.

### 11.1 Two ledgers, one invariant

```
buyer pays $10.00
  └─ gross revenue recognised: $10.00        → platform_revenue
     (nothing owed yet, no creator has earned)

buyer spends 1,000 coins on a Tier-3 creator (60%)
  └─ $6.00 moves  platform_revenue → creator_payable
     $4.00 stays  platform_revenue                    (margin)

payout run
  └─ $6.00 moves  creator_payable → payout partner → creator
     partner fee charged against platform_revenue      (see 11.3)
```

**The invariant that governs solvency:**

```
float_held  >=  creator_payable
```

If that fails, Vergr owes creators more than it holds. This is the single most
important number on the admin dashboard and must be alarmed.

### 11.2 What each ledger means

| Ledger | Meaning | Spendable by Vergr? |
|---|---|---|
| `platform_revenue` | Vergr's own money: margin, plus revenue on coins that never reached a creator | **Yes** |
| `creator_payable` | Accrued share owed, not yet paid. A liability. | **No** |
| `float_held` | Actual money on hand (processor + partner + reserve) | must cover the above |

`functions/platformRevenue.js` already exists and already writes
`platform_revenue` / `platform_revenue_daily`. Its header notes the three-bucket
ledger "was never built". **Part 3 builds the `creator_payable` side.**

### 11.3 Where the payout partner sits

At each run, Vergr moves the batch total from `creator_payable` to the partner,
and the partner disburses. The partner's fee is a **cost of sale against
`platform_revenue`**, not a deduction from the creator's share. Deducting it from
the creator reintroduces a second deduction and undoes §10.

**DECIDED: Vergr absorbs the per-payout fee** where affordable. This keeps "you
earn X%" literally true, which is worth real money in trust terms. The $100
minimum (§12) keeps the fee small as a proportion of each run.

Affordability guard: if the partner fee ever exceeds a set percentage of a run's
total, the admin dashboard flags it rather than silently eroding margin. The
decision to pass a fee on would be a fresh founder call, not an automatic one.

### 11.4 Coins that never reach a creator

Per `docs/OPEN_WORK_AND_ECONOMY.md`, coins spent on Boosts, or bought and never
spent, cost nobody anything and are pure margin. Under gross accounting they are
revenue with no matching liability. **This is the only lever that improves margin
without taking from buyer or creator, and it is currently not measured.** Part 3
puts it on the admin dashboard.

---

## 12. Payout cadence ladder (decision 2)

Risk-based supplier payment terms. This is the **single highest-leverage change
for the legal argument**, because it is what converts "user withdraws on demand"
into "Vergr pays its suppliers on Vergr's schedule."

**Minimum payout: $100, flat, at every stage.** Founder decision. Balances below
it roll over to the next run and are never lost. (Note this is the same floor
TikTok uses, so it will not read as unusual to a creator arriving from there.)

| Stage | Cadence | Minimum | Requirements to reach |
|---|---|---|---|
| **Standard** (default) | Monthly, on the 1st | $100 | KYC L1, tax form on file |
| **Established** | Twice monthly, 1st + 15th | $100 | 90 days since first payout, 3 successful payouts, KYC L2, zero active strikes |
| **Priority** | Weekly, Mondays | $100 | 180 days, 12 successful payouts, KYC L2, zero active strikes |

### 12.1 Strike definition

Researched against industry practice 2026-08-14. The common pattern is three
strikes with expiry (YouTube expires at 90 days); money platforms run longer
windows because the risk is financial rather than editorial. **Vergr uses three
strikes with a 180-day expiry.**

**Counts as a strike:**

1. An upheld moderation action against the creator's content, after the appeal
   window closes. A report that is dismissed is not a strike.
2. A chargeback rate above threshold on purchases that funded this creator's
   earnings. A single isolated chargeback is **not** a strike; buyers charge back
   for their own reasons and the creator did not cause it.
3. An upheld fraud-review flag.
4. A failed payout caused by false or mismatched supplier details.
5. Any attempt to circumvent the platform: real-money trading, soliciting payment
   off-platform to avoid the share, or multi-accounting to farm tier thresholds.

**Does not count:**

- A dismissed report.
- An isolated chargeback below the rate threshold.
- Content removed on a copyright claim that was successfully counter-claimed.
- Anything reversed on appeal. **Appeals unwind the strike.**

**Effect, escalating:**

| Active strikes | Consequence |
|---|---|
| 1 | Cadence drops one stage, stage clock restarts |
| 2 | Drops to Standard (monthly), extended review on each run |
| 3 | Payouts suspended pending manual review. **Accrual continues** — earnings are not confiscated, they are held. |

Strikes expire 180 days after they are applied. Confiscation is never automatic;
forfeiture only happens through the existing termination-for-cause path in the
ToS, decided by a human.

All of this must appear in the Creator Revenue Share Agreement so it is a contract
term the creator agreed to, not a surprise applied after the fact.

---

## 13. Making the tax side manageable (decision 6)

### 13.1 Reports the admin dashboard must generate

New `/admin/finance`, or a tab under the existing `/admin/economy`:

| Report | Contents | Cadence |
|---|---|---|
| **Gross revenue** | All coin sales by rail (PayRam / Play Billing), gross and net of processor fees | Monthly, CSV + on-screen |
| **Creator payable** | Opening, accrued this period, paid this period, closing. Must reconcile. | Monthly |
| **Payout register** | Every creator paid: amount, date, partner reference, running YTD per creator | Per run + YTD |
| **Supplier threshold report** | Creators whose YTD payouts crossed the reporting threshold, with tax-form status | Annual, flagged monthly |
| **Reconciliation** | `float_held` vs `creator_payable`, drift, alarm state | Daily |

### 13.2 Automation that removes the headache

- Ingest per-payment status from the partner and reconcile automatically.
- **Gate tax-form collection into the payout flow.** A creator cannot reach
  payout-eligible state without a W-9 / W-8BEN equivalent on file. Turns an annual
  scramble into a one-time onboarding step.
- Generate the annual report from the payout register, never by hand.

**Choose the payout partner partly on whether they collect and validate tax forms
and file year-end reporting.** Tipalti and Trolley both do. That selection alone
removes most of decision 6's burden, and it is a choice rather than a build.

---

## 14. Legal documents that must change

Part 1 omitted these. Full list with specific sections.

### 14.1 `src/screens/marketing/legal/legalContent.js` — Terms of Service

| Section | Line | Change |
|---|---|---|
| **§7.2 Coins** | ~231 | Strengthen licence framing: revocable, no cash value, non-transferable. Remove "receipt as a Tip... from another User" — under the principal model a creator does not receive coins from a user, they accrue a share of Vergr revenue. |
| **§7.4 Gems** | ~235 | **Rewrite.** Gems stop being "the Cash-Equivalent redeemable virtual asset" the user holds and become **accrued revenue share owed by Vergr**. Delete the "30% to 5%" rate language (wrong today). Delete user-initiated conversion. |
| **§7.6 Non-transferability** | ~239 | Tighten now that `gemTransfer` is removed. |
| **§7.7 / §7.8 Closure, insolvency** | ~240-241 | Reframe: accrued share owed is a payable, not a held balance. |
| **§8 Payouts of Gems** | 243-260 | **Rewrite whole section** as "Payment of Revenue Share". Scheduled runs, cadence ladder, minimum threshold, partner as payer of record. Delete §8.5 (contradicts code) and §8.6 (names USDT-TRC20). |
| **§9 Refunds** | 262 | A refunded coin purchase now unwinds recognised revenue; add clawback of accrued share. |
| **§10.4 Paid stream pricing** | §10.4 | "10% / 90%" is false today; state the real single rate. |
| **§11 Creator Monetisation** | §11 | **The creator supplier agreement lives here.** Biggest drafting job. |
| §6 No Gambling | 218 | Review only, unaffected. |

**New document required: a Creator Revenue Share Agreement.** Either a numbered
ToS section or standalone. Must cover supplier status, the rate card, the payment
schedule and cadence ladder, set-off and clawback, tax responsibility, and
termination. **This is where the entire legal argument lives.** Everything else in
this plan is implementation of what that document asserts.

### 14.2 `src/screens/marketing/legal/compliancePolicies.js`

| Policy | Sections | Change |
|---|---|---|
| AML | `1. Principles`, `2. Customer due diligence`, `4. Monitoring` | Currently describes handling user funds. Reframe around supplier payments. |
| Anti-fraud | `3. Holds on outgoing funds`, `4. Chargebacks` | Hold logic changes with scheduled payouts; state chargeback clawback against accrued share. |
| Identity and consent | `3. Graduated verification` | KYC tiers currently gate withdrawal limits; they now gate payout eligibility and cadence. |
| Law enforcement | `5. Preservation` | Records of supplier payments, not user-to-user transfers. |

### 14.3 Public marketing — `src/screens/marketing/PublicMarketingScreens.jsx`

Every line below quotes a rate that is about to be wrong. Verified 2026-08-14:

| Line | Current claim |
|---|---|
| 1311 | `'Tips at 10% flat'` |
| 1344 | `'Convert as you rank'` |
| 1345 | `'Transparent fees'` / `'Flat 10% tip fee, no hidden cuts, no surprises'` |
| 1498 | `'Lower fees'` / `'Commission drops as you rank up'` |
| 1594-1597 | Comment block documenting the 30%→15% ladder |
| 1648, 1654, 1673 | `'30% fees'` / `'15% fees'` rank chips |
| 1688, 1692 | `'Lower platform commission'` |
| 3983 | "flat 10% on tips and a tier-based commission on..." |
| 3995 | `'Tip fee is a flat 10%, the same for free and Pro alike'` |
| 4005-4006 | `'Flat 10% tip fee'` tile |
| 4133 | `'10% platform fee → you receive floor(N × 0.90) coins'` |
| 4165 | SEO description quoting both rates |
| 4168-4170 | Per-rank commission table derived from `commissionForVP()` |

**Line 1345 in particular:** "no hidden cuts, no surprises" sits directly above a
model that takes a second cut at conversion. That copy is misleading today and
should be fixed on its own merits.

### 14.4 Other rate-quoting surfaces

- `src/screens/settings/VPRanksScreen.jsx:82` — "X% conversion commission"
- `src/screens/vanguard/VanguardWalletScreen.jsx:53` — `withdrawalCommission`
- `src/firebase/firestore.js:2973` (`TIP_PLATFORM_FEE_PCT`), `:4430`
- Help articles: grep for gem/withdraw/convert found **none**. Verify before
  assuming, the help content may live where that grep did not reach.
- `public/sitemap.xml` and `scripts/prerenderHelp.mjs` if any legal slug changes.
  **Recommend keeping every slug stable** so nothing needs resubmitting to Google
  (see memory `project_seo`).

---

## 15. Implementation status (updated 2026-08-14)

### Done, build passing, NOT deployed

| Change | File |
|---|---|
| Revenue share ladder, server source of truth | `functions/coinLedger.js` (`shareForEarnings`, `REVENUE_SHARE_RATES/THRESHOLDS`) |
| `earnedGemCredit` re-keyed from VP to lifetime earnings; returns `share` | `functions/coinLedger.js` |
| `settleEarnedToGems` re-keyed to `totalEarnedCoinsGross` | `functions/coinLedger.js` |
| `totalEarnedCoinsGross` now incremented at the credit site | `functions/coinLedger.js` (`earnedCoinCredit`) |
| Ladder imported, not re-declared (was 3 hand-kept mirrors, now 2) | `functions/economy.js` |
| Client mirror + `revenueShareTier()` for the Earnings screen | `src/utils/vpSystem.js` |
| Tip 10% surface fee REMOVED | `functions/index.js` `sendTip` |
| Membership 10% surface fee REMOVED (join + renewal) | `functions/memberships.js` |
| Locked content 8/10% surface fee REMOVED | `functions/entitlements.js` (`feePctFor` returns 0) |
| Event ticket + season pass 10% surface fee REMOVED | `functions/eventTickets.js` |
| `sendGems` / `quoteGemSend` DISABLED | `functions/gemTransfer.js` |

Verified by execution, not by reading: ladder boundaries at every threshold, and
a 100-coin tip paying 50 gems at tier 1 / 80 at tier 7.

### Deliberately NOT changed, needs a founder decision

1. **`functions/vergrMeShop.js` — `SALE_FEE = 0.08`, LOCKED by founder 2026-07-17.**
   Left alone on purpose. Vergr.me is a **marketplace** where a seller sells
   their own digital goods, which is a different legal shape from a content
   platform paying revenue share, and arguably a stronger position (Vergr is a
   facilitator, not the principal). Applying the ladder would take a seller from
   an 8% fee to as much as 50%, which is a business decision, not a refactor.
   **Decide explicitly: keep 8% flat, or fold into the ladder.**

2. **The Pro seller perk in `entitlements.js`.** Pro sellers paid 8% instead of
   10%. `feePctFor()` now returns 0 for everyone, so the perk is dormant.
   It was NOT reinstated arbitrarily because setting a replacement rate is a
   financial decision. Natural replacement: a one-tier share bump for Pro in
   `shareForEarnings()`. `FEE_PCT_PRO` retained so the intent stays visible.

3. **`functions/withdrawals.js` `PLATFORM_SPREAD_BPS = 200`.** The 2% withdrawal
   spread is untouched, because it dies with the withdrawal flow itself when
   scheduled payouts replace it, not before.

### Not deployed, and why

Deploying now makes the code contradict the ToS in a NEW direction: §10.4 still
promises creators 90% of a paid stream while the code pays 50-80%. With no real
balances (decision 7) the practical risk is nil, but the correct order is the
Creator Revenue Share Agreement first, then deploy. Founder call.

### Payout engine — DONE (2026-08-14), not yet the live rail

`functions/creatorPayouts.js` (new). Exported from `index.js`, rules added.

| Piece | Detail |
|---|---|
| Scheduled run | `runCreatorPayouts`, daily 06:00 UTC. One daily job, not three crons, because which cadences are due depends on the date and three crons can collide on the 1st. |
| Cadence resolution | Computed from facts every run, never stored, so a stored stage cannot drift and a strike takes effect immediately. |
| Cadence days | Standard = 1st. Established = 1st + 15th. Priority = Mondays. |
| Eligibility gates | strikes < 3, not frozen, KYC ≥ 1, tax form on file, partner payee set, balance ≥ $100. |
| Minimum | 10,000 gems = $100. Below it the balance **rolls over**, never expires. |
| Statements | `payout_statements/{runId}__{uid}` — the remittance advice from Part 3 §17. |
| Dry run | `previewCreatorPayoutRun` (admin callable) shows exactly who would be paid and every skip reason, and moves nothing. **Run this before the first real run.** |

**Payable = `wallets/{uid}.gems`, deliberately.** No parallel per-creator ledger:
a second balance is a thing that can drift from the first, and gems are already
credited at the correct revenue-share rate by `coinLedger.js`. What was missing
is the platform-side aggregate for the solvency invariant, which is still to
build.

**The partner seam is `disbursePayout()`** — the only partner-specific function
in the file. It throws until a partner is wired, and a run that cannot disburse
marks the statement `failed` rather than debiting gems it cannot send.

**`functions/withdrawals.js` is untouched and still the active rail.** Two
systems that can both move the same gems must never be live at once, so the
cutover is a separate deliberate step.

Verified by execution: cadence due-dates across four September dates, all six
`resolveCadence` paths including strike expiry, all six blocking reasons, and
the $100 minimum.

### Legal + public copy — DONE (2026-08-14)

**`src/screens/marketing/legal/legalContent.js`** rewritten:

| Section | Change |
|---|---|
| Definitions | "Gems" redefined as accrued revenue share owed, not a redeemable asset. "Platform Fee" replaced by **"Revenue Share Rate"**. "Eligible Earnings" re-pointed at §8.2. |
| §4.2 | Identity Verification now gates *being paid*, not *requesting a withdrawal*. |
| §7.1 | Gems separated in kind from Coins/VP: a debt owed, not a virtual item held. |
| §7.2 Coins | Rewritten as a revocable licence. Removed "receipt as a Tip from another User", which contradicted the principal model. Explicitly non-transferable, non-redeemable. |
| §7.4 Gems | Rewritten. Accrues automatically at the moment revenue is earned. No conversion step, no conversion fee. |
| §7.5, §7.8 | Re-pointed at §11.5 notice terms; insolvency now describes an ordinary commercial debt. |
| **§8** | **Fully replaced**: "Payouts of Gems" → **"Payment of Revenue Share"**. 13 clauses covering eligibility, the three-stage schedule, the $100 minimum with roll-over, statements, **Strikes**, set-off and clawback, holds, taxes, no-interest/no-deposit, closure. |
| §10.4 | "10% fee, creator gets 90%" replaced with the revenue share rate. |
| **§11** | **Fully replaced**: "Creator Monetisation" → **"Creator Revenue Share Agreement"**, 12 clauses. §11.1 establishes the principal model in writing, which is the clause the entire legal position rests on. |
| §17.3 | The published fee schedule (10% / 10% / 5-30% / 2%) was **entirely false** post-migration. Replaced. |
| Event rules §3.2 | Ticket "10% Platform Fee" replaced with the revenue share rate. |
| Privacy | "Withdrawal information" → "Payout information" (partner account, tax docs, legal name). |

**`src/screens/marketing/PublicMarketingScreens.jsx`**: 28 replacements across the
landing page, rank ladder, Monetization page, cash-out flow and the Twitch
comparison page. **Verified zero residual** stale rate claims by grep.

The Twitch comparison page needed the most work: its whole pitch was "flat 10%,
no tier ladder", which the new model inverts. Reframed honestly as *entry at 50%,
matching where Twitch caps most creators, climbing to 80%*.

### ⚠ NEW PRODUCT GAP surfaced by this work

**Ranking up now has no economic benefit.** The conversion-commission drop was
explicitly "the one real rank perk" (`src/utils/vpSystem.js`). Revenue share is
now keyed to earnings, so VP rank confers only cosmetics: ring, badge, prestige.

The public rank table has been changed to show the ring rather than a fee, which
is true, but **rank needs a new perk or it becomes decorative**. Founder decision.
Options: a share bump for high rank (couples the ladders again, probably wrong),
or non-economic perks (discovery weighting, early access, cosmetics).

### Next

1. **Payout partner selection — the long pole**, blocks everything downstream.
2. `platform_ledger/totals`: the `creator_payable` aggregate + solvency invariant.
3. Strike write path (nothing creates strikes yet; the read path is done).
4. Tax-form collection gated into payout eligibility.
5. Screens per `docs/REVENUE_SHARE_MOCKUP_BRIEF.md`.
6. Admin finance reports (§13.1).
7. `compliancePolicies.js` — 4 policies still describe handling user funds.
8. Cutover: retire `functions/withdrawals.js` once the partner is live.
9. Native batch + one APK.
