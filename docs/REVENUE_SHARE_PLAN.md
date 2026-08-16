# Revenue Share Migration — Master Plan

Status: **Decisions LOCKED. Backend largely BUILT. Legal in progress.**

> Live implementation status: **docs/REVENUE_SHARE_PART2_DECISIONS.md §15**.
> Mockup brief: **docs/REVENUE_SHARE_MOCKUP_BRIEF.md**.
> §5 of this file (open decisions) is RESOLVED — see Part 2 §8.
Started 2026-08-14. Every constant and path below was read from the code on that date.

> **Read this file first.** It replaces the economy sections of `CLAUDE.md`, which
> were found stale twice on 2026-08-14 (see "Corrections to CLAUDE.md" at the end).
> `docs/OPEN_WORK_AND_ECONOMY.md` (2026-08-11) is accurate and is the companion
> document; this plan builds on it rather than replacing it.

Parts:

| Part | Covers | Status |
|---|---|---|
| 1 | Why, current verified state, the model, full inventory, open decisions | this file |
| 2 | Backend: data model, ledger, callables, migration | not started |
| 3 | Frontend: every screen, including the new Earnings surface spec for mockups | not started |
| 4 | Policy text, ToS, rollout, comms, rollback | not started |

---

## 1. Why we are doing this

### 1.1 The problem in one sentence

Vergr currently takes money from one user, holds it as a balance, and pays it out
on demand to a different user's nominated crypto address, which is the textbook
description of money transmission, and Murmont LLC is not licensed to do it.

### 1.2 The specific legal exposure

Three facts combine into the exposure. Any one alone is survivable, all three
together are not:

1. **Murmont LLC is a US entity**, so FinCEN rules apply directly, and unlicensed
   money transmission is a criminal statute (18 USC 1960) as well as a civil one.
2. **We hold user funds.** All float sits in a developer-controlled Circle
   omnibus wallet with `wallets/{uid}` as a ledger against it. That is custody.
3. **Value leaves to a third party on user instruction.** Gems withdraw as USDC
   to an address the user nominates, at a time and amount the user chooses.

Supporting detail:

- FinCEN's exemption for payments "integral to the sale of goods or services"
  **explicitly does not cover tips or gifts for a performance that lacks an
  assigned price**. Tipping is our largest earning surface and sits squarely in
  that hole.
- Closed-loop prepaid value is exempt, but only while it cannot be redeemed for
  cash. Gem withdrawal is precisely what breaks the closed loop.
- Circle holds licences. Circle's licences cover Circle. In developer-controlled
  mode we direct the funds, so their registration does not extend to our activity.

### 1.3 Why TikTok is not a precedent

Checked 2026-08-14. TikTok acknowledged internally in 2022 that it was not
authorised for money transmission, citing "user-to-user transactions without
license" and no licence "to have balances (stored value)". Utah's Division of
Consumer Protection sued in June 2024 alleging TikTok LIVE operates as an
unlicensed money transmitter; the motion to dismiss was denied February 2025.

TikTok's US payouts route through **PayPal**, which holds money transmitter
licences in every state. TikTok keeps the ledger, a licensed party moves the money.
On the payout leg we are currently in a **worse** position than TikTok, not a
comparable one, because we are the transmitter rather than the instruction-giver
to one.

### 1.4 The chosen defence: the principal model

We restructure so that Vergr is the **principal** in every transaction and
creators are **suppliers paid a revenue share**, not account holders with
balances.

- A viewer buys coins **from Vergr**. That money is Vergr revenue at that moment.
- A viewer spends coins on Vergr products (unlocks, subscriptions, tips).
- Vergr owes the creator a **share of the revenue their content generated**.
- Vergr pays its suppliers on **Vergr's schedule**, as accounts payable.

Paying your own suppliers is not money transmission. This is how Twitch, YouTube,
Patreon and the App Store are all structured.

**This is a legal-posture change, not a business-model change.** The economics can
end up identical. What changes is who owns the money at each step, who controls
timing, and what the records say.

### 1.5 What actually has to change for the argument to hold

The theory only works if the implementation matches it. Three things currently
contradict it, and these are the real work:

| Contradiction | Today | Required |
|---|---|---|
| **Balances** | `wallets/{uid}.gems` is a balance the creator calls on at will. That is a deposit obligation. | An **earnings ledger**: revenue accrued, share owed, paid. Not a balance the user holds. |
| **Timing and amount** | Creator presses Withdraw, any amount, any time. | Vergr computes and pays on a **schedule**. This is the single highest-leverage change. |
| **Destination** | Arbitrary self-custody crypto address the user nominates. | Payment to a supplier's account through a payout partner. Crypto address is the worst possible destination for this argument. |

Plus one feature that has to go: see §4.1 on `gemTransfer`.

### 1.6 What this does NOT fix

Stated plainly so nobody assumes more than is true.

- It does not make us licensed. It aims to make licensing **not required**.
- It does not guarantee a processor will underwrite us. Stripe already exited this
  category (see memory `project_stripe_removed`). Payout partners will still ask.
- It does not remove the tip problem entirely. A tip still has no assigned price.
  Mitigation is in §3.4.
- It has a **tax and reporting cost** that is real and must be accepted knowingly:
  if all coin sales are Vergr revenue, gross revenue is every coin sold, creator
  payouts are an expense, and that implies contractor reporting obligations
  (1099 / W-8BEN equivalents) and potentially sales tax or VAT on the full coin
  sale rather than on our fee. **This is a founder decision, not a technical one.**

---

## 2. Current state, verified against code

Read from source 2026-08-14. File:line given so a future session can re-verify
rather than trust this table.

### 2.1 The value path today

```
buyer pays fiat/crypto
   → coins credited (NO platform fee)          functions/payram.js:437
   → buyer spends coins on a creator
       → surface-specific platform fee          (table below)
       → remainder credited to creator
       → auto-converted to gems at VP commission  functions/coinLedger.js
   → creator withdraws gems
       → 2% spread                              functions/withdrawals.js:47
       → 3-day hold
       → USDC out via Circle
```

### 2.2 Every fee surface (the complete list)

| Surface | Fee today | Source |
|---|---|---|
| Coin purchase | **0%** platform, 2% FX buffer | `functions/payram.js:88,437` |
| Tip | flat **10%** at send | `functions/index.js:3391` |
| Membership | flat **10%** | `functions/memberships.js:24,78,281` |
| Locked content / entitlements | **10%**, **8%** if seller is Pro | `functions/entitlements.js:61-62,392-395` |
| Event tickets | **10%** + purse contribution | `functions/eventTickets.js:149,311` |
| Vergr.me digital sales | **8%** flat, gems-direct | `functions/vergrMeShop.js:39` |
| Gem transfer (user to user) | **3%** | `functions/gemTransfer.js:30` |
| Coin → gem conversion | **30% → 15%** by VP tier | `functions/economy.js:21`, `src/utils/vpSystem.js:44`, `functions/coinLedger.js:138` (three mirrors) |
| Withdrawal | **2%** spread | `functions/withdrawals.js:47` |
| Gem buyback (gems → coins) | flat, rank-independent, ceiling 1.15 | `functions/gemBuyback.js` |
| Referral revenue share | 1% base, cap 5%, 2 years, **minted not deducted** | `functions/referralRevenue.js:99` |

### 2.3 The commission ladder as it actually is

`src/utils/vpSystem.js:43-49`, mirrored in `functions/economy.js:21` and
`functions/coinLedger.js:138`. **All three must stay byte-aligned.**

```js
COMMISSION_RATES = [0.30, 0.28, 0.25, 0.22, 0.20, 0.18, 0.15];
VP_THRESHOLDS    = [0,    500,  2000, 5000, 15000, 40000, 100000];
```

Floor is **15%**, not the 5% `CLAUDE.md` claims. Keyed to **total VP**, not level.
Active Vanguard are exempt (0%) via `isVanguardExempt`, `functions/coinLedger.js`.

### 2.4 Effective creator share today

Two deductions stack. For a tip, per `functions/index.js:3391` then
`earnedGemCredit`:

| Creator | Tip fee | Conversion | Withdrawal spread | **Keeps, of coin face** |
|---|---|---|---|---|
| New (VP 0) | 10% | 30% | 2% | **61.7%** |
| Mid (VP 15k) | 10% | 20% | 2% | 70.6% |
| Max (VP 100k+) | 10% | 15% | 2% | **75.0%** |

Platform net after ~3% processing and 1-5% referral: **roughly 18-32% full
lifecycle**. That is a normal margin and is the real business today.

### 2.5 The structural fact that must survive untouched

**`functions/coinLedger.js` splits the wallet:**

- `balance` = spendable coins
- `earnedBalance` = the subset that arrived as income from someone else

Conversion permits only `min(earnedBalance, balance)`. **Purchased coins can never
be cashed out.** A buyer cannot convert their own purchase and withdraw it.

This is what keeps Google Play Billing from being a cash-out rail. **Collapsing
this split would breach Play policy and is not negotiable.** Any revenue-share
redesign must preserve it, and it happens to map perfectly onto the new model:
`earnedBalance` is already, conceptually, "revenue share owed".

### 2.6 Plumbing that already exists and helps us

Good news that reduces the size of Part 2 substantially:

- `earnedGemCredit(coins, vp, opts)` — inline conversion at receipt, used where
  the crediting transaction already reads the wallet (`sendTip`).
- `settleEarnedToGems(db, {uid, coins, source, sourceId})` — post-commit
  conversion, idempotent via `earned_gem_settlements/{sourceId}`, fire-and-forget
  with a deliberately benign failure mode.
- `platform_commissions/` and `platform_revenue/` ledgers already written.
- `transactions/` rows already carry `meta.commission` and `meta.feePct`.

**The accrual plumbing is already there.** Most of Part 2 is re-pricing,
re-labelling, and changing payout timing, not building a ledger from scratch.

---

## 3. The target model

### 3.1 The core reframe

| Concept | Today | Target |
|---|---|---|
| Coins | currency the user holds | **licence to access Vergr features**, revocable, no cash value, non-transferable |
| Gems | cashable currency, transferable | **accrued revenue share owed by Vergr**, not a currency, not transferable |
| Conversion | user action, "convert coins to gems" | **automatic accrual at the moment revenue is earned** |
| Withdrawal | user pulls funds on demand | **Vergr pays out on a schedule** |
| Commission | fee charged against the user's balance | **the platform's share of revenue**, stated as what the creator earns |
| Wallet | one screen holding "your money" | **two surfaces**: a coin balance (buyer) and an earnings statement (creator) |

### 3.2 One rate, not two

The double deduction (surface fee, then conversion commission) is the shape of
*fees charged against a balance the user owns*. That is the custody framing we are
trying to escape.

Replace with a **single revenue share percentage**, presented as
**"you earn X% of the revenue your content generates."** Identical arithmetic is
achievable; the characterization is completely different, and it is free.

### 3.3 The ladder should be based on earnings, not VP

Basing a payout rate on gamified activity points is wrong on three counts:

1. Creators cannot forecast income against a score they do not track.
2. VP rewards *playing*, not *earning*. Under `GIFT_COINS_PER_VP` and
   `VP_ACTIONS`, a heavy tipper who creates nothing can out-rank a real creator
   and get a better payout rate. That is backwards.
3. **For the legal framing specifically:** a supplier rate card keyed to *volume
   delivered* is what every commercial contract looks like (cf. Twitch Partner
   Plus, 70/30 to the first $100k). One keyed to how much the supplier played our
   game is arbitrary, and arbitrary reads as a fee on the user's money.

**Recommendation: key the ladder to lifetime gross earnings.**
`wallets/{uid}.totalEarnedCoinsGross` already exists and already tracks exactly
this (`functions/coinLedger.js`, `earnedGemCredit`).

**Keep VP.** It keeps ranks, rings, prestige, cosmetics, perks. It just stops
setting the payout rate.

### 3.4 Handling the tip problem

Tips have no assigned price, which is the specific gap FinCEN's exemption leaves
open. Two mitigations, both cheap:

1. **Reframe tips as a priced product.** A tip purchases a named, priced thing:
   an on-stream shout-out, a highlighted message, a badge. It then has an assigned
   price and sits inside the exemption. This is what "gifts" do for TikTok, except
   TikTok never made the goods explicit and got sued.
2. **Shift mix toward priced surfaces.** Subscriptions, locked content, media
   packs and Vergr.me sales all have assigned prices already and are on much
   safer ground than raw tipping.

### 3.5 Market context for rate-setting

Verified 2026-08-14. Creator keeps:

| Platform | Creator keeps | Rate basis |
|---|---|---|
| Whop | 97% | flat |
| Kick | 95% subs, 100% tips | flat |
| Patreon | 88-92% | creator picks plan tier |
| Passes | 90% | flat |
| Substack | ~87% | flat |
| OnlyFans | 80% (77-78% net of processing) | flat |
| YouTube | 55% long-form ads | content type |
| Twitch | 50%, 70% to first $100k on Partner Plus | volume threshold |
| TikTok | 50% | flat |
| **Vergr now** | **61.7-75%** | activity points |

We beat TikTok and Twitch, which is where gaming creators actually are. We lose to
Kick badly. **Do not chase Kick.** Their 5% is funded by Stake.com gambling
revenue; it is customer acquisition paid for out of another business. Per memory
`feedback_price_off_our_costs`, we price off our costs, never off competitors.

### 3.6 The margin identity (from OPEN_WORK_AND_ECONOMY.md, still true)

```
margin = what the buyer pays − what the creator receives
```

There is no fourth term. Three doors only: raise price per coin, lower payout, or
grow the share of coins that never reach a creator. Any proposal that claims to
improve margin without touching one of those three is wrong.

---

## 4. Full inventory of what is affected

Nothing here is a change instruction yet. This is the checklist Parts 2 and 3 work
through, so nothing is missed.

### 4.1 Backend — must change

| File | Why |
|---|---|
| `functions/economy.js` | `convertCoinsToGems` becomes accrual, not a user-invoked conversion |
| `functions/coinLedger.js` | the three-way-mirrored commission ladder; `earnedGemCredit`; `settleEarnedToGems` |
| `src/utils/vpSystem.js` | `COMMISSION_RATES` / `VP_THRESHOLDS` / `getCommission` / `getGemRate` — the client mirror |
| `functions/index.js:3391` | `sendTip` 10% fee, folds into the single rate |
| `functions/memberships.js` | `PLATFORM_FEE_PCT` 10% |
| `functions/entitlements.js` | `FEE_PCT` / `FEE_PCT_PRO` / `feePctFor()` |
| `functions/eventTickets.js` | 10% + purse split |
| `functions/vergrMeShop.js` | `SALE_FEE` 8% (currently the most generous surface) |
| `functions/withdrawals.js` | on-demand → **scheduled payout run**. Biggest single change. |
| `functions/platformRevenue.js` | revenue recognition changes: gross, not net |
| `functions/referralRevenue.js` | minted-not-deducted needs re-examining under gross accounting |
| **`functions/gemTransfer.js`** | **user-to-user transfer of cashable value. This is the most transmission-looking feature we have and it almost certainly has to be removed.** 3% fee, `TRANSFER_FEE_PCT:30`. Flagged for a founder decision, not removed unilaterally. |
| `functions/gemBuyback.js` | gems→coins makes gems look like a currency. May survive as "convert earnings to spending credit"; needs a call. |
| `functions/admobReward.js`, `functions/streamingBoost.js`, `functions/mediaPacks.js`, `functions/lockedPosts.js`, `functions/lockedMessages.js`, `functions/subscriptions.js` | all credit earnings; all need auditing against the new single rate |
| `firestore.rules` | new/renamed collections |

### 4.2 Frontend — must change

Wallet v2 tree (`src/screens/wallet/v2/`, 3,659 lines total):

| Screen | Lines | Fate |
|---|---|---|
| `HomeScreen.jsx` | 484 | **splits into two surfaces** (see Part 3) |
| `ConvertScreen.jsx` | 382 | conversion becomes automatic — screen likely **retires** |
| `WithdrawScreen.jsx` | 554 | becomes **payout settings + schedule**, not a pull action |
| `HistoryScreen.jsx` | 350 | becomes an **earnings statement** |
| `BuyScreen.jsx` | 525 | mostly unchanged (buyer side) |
| `CartScreen.jsx` | 63 | unchanged |
| `SettingsScreen.jsx` | 170 | payout method/schedule moves in |
| `KycScreen.jsx` | 159 | unchanged in function, copy changes |
| `SecurityScreens.jsx` | 657 | address book meaning changes with destination |
| `NewAddressScreen.jsx` | 240 | depends on the destination decision |
| `HelpScreen.jsx` | 75 | copy |

Legacy wallet tree (`src/screens/wallet/*.jsx`) — `WalletScreen`,
`ConvertCoinsScreen`, `RequestPayoutScreen`, `PayoutScreens`, `PayoutSuccessScreen`,
`TransactionReceiptScreen`, `TransactionFiltersScreen`, `WalletSecurityScreen`,
`BoostScreen`. Most are already redirected per `AppRouter.jsx:951-968`; each needs
confirming rather than assuming. **Per the hard rule in `CLAUDE.md`, nothing gets
deleted without explicit permission.**

Native wallet (`src/screens/wallet/native/NativeWalletScreens.jsx`) — mirrors
Home/Convert/Settings/History/Kyc/Buy/Deposit. **Changes here mean an APK build**
(memory `feedback_native_report_means_apk`, `feedback_batch_native_work`), so all
native work batches into ONE build at the end.

Other surfaces showing commission:

- `src/screens/vanguard/VanguardWalletScreen.jsx:53`
- `src/screens/settings/VPRanksScreen.jsx:82`
- `src/screens/marketing/PublicMarketingScreens.jsx:1594,4168` (public rate table)
- `src/firebase/firestore.js:2924,2973,4430`

### 4.3 Non-code

- ToS and creator agreement: the supplier relationship must be **written down**.
  This is where the principal model actually lives. Part 4.
- The eight compliance policies in
  `src/screens/marketing/legal/compliancePolicies.js` reference thresholds that
  will move.
- Help articles describing convert/withdraw.
- `CLAUDE.md` economy sections.

---

## 5. Open decisions — founder only, blocking Part 2

Per memory `feedback_no_unilateral_financial_choices`, none of these are mine to
pick. Part 2 cannot start until these are answered.

1. **The ladder.** Tiers, thresholds, percentages. Starting proposal, against
   sale price, for you to change:

   | Tier | Lifetime earned | Creator keeps | Vergr gross |
   |---|---|---|---|
   | 1 | $0 | 70% | 30% |
   | 2 | $100 | 75% | 25% |
   | 3 | $500 | 80% | 20% |
   | 4 | $2,500 | 84% | 16% |
   | 5 | $10,000 | 87% | 13% |
   | 6 | $25,000+ | 90% | 10% |

   **Caution before locking:** GMV on creator platforms concentrates in the top
   few percent. If whales sit in tier 6, blended take is near 10%, not near the
   middle of the table. Model against a real earnings distribution first.

2. **Payout schedule.** Weekly, biweekly, monthly? Minimum threshold? This is the
   single most important change for the legal argument and the most visible to
   creators.

3. **Payout destination.** Stay crypto-only (weakest for the argument, but it is
   what exists today and costs nothing), or pursue a payout partner (Tipalti,
   Trolley, Dots, Payoneer) who becomes payer of record. **Underwriting risk is
   real given the Stripe exit.**

4. **`gemTransfer`: remove, or keep?** Recommend remove. It is the clearest
   user-to-user value transfer in the codebase.

5. **Coin sale price vs face value.** Coins sell at €0.0090-0.0099 against a €0.01
   face. Every payout percentage is measured against face, which makes our
   headline rate look worse than our real economics. Setting sale price equal to
   face makes the numbers honest and quotable at no cost.

6. **Accept the tax/reporting consequence** of gross revenue accounting (§1.6).

7. **Existing balances.** Users hold gems today under the current promise.
   Migration must not confiscate or devalue them. Part 2 needs a policy:
   grandfather at current rates, or convert at announcement.

---

## 6. Corrections to CLAUDE.md (apply when editing that file)

- "Rookie 30% → Immortal 5%" is **wrong**. The floor is **15%**
  (`COMMISSION_RATES` ends at 0.15).
- "Tip economy: flat 10% platform fee" is true but **incomplete** — it omits that
  the conversion commission then applies to the remainder, so the real creator
  share is 61.7-75%, not 90%.
- Tournaments and coaching were retired 2026-08-09 and must not be cited as live
  revenue surfaces.

---

## 7. Honest limits of this plan

- I am not a lawyer and this is not legal advice. The plan implements a structure
  that is standard in the industry; whether it is sufficient for Murmont LLC
  specifically is a question this document cannot answer.
- Everything in §2 was read from code and is verifiable. Everything in §3 and §5
  is proposal.
- Nothing in `functions/` has been runtime-tested as part of this audit. Per
  `OPEN_WORK_AND_ECONOMY.md`, locked content, Content Packs, 1:1 sessions and the
  cart have **never been through a real purchase by a human**, so the current
  behaviour of those fee paths is asserted from code, not observed.
