# Open work + the coin economy

> **⚠ STRIPE IS DEAD (2026-08-13). Stripe closed the account.** Every Stripe
> section below is HISTORY, not a task list. Do not run the setup commands: the
> rail, its functions, its secrets and its seed scripts have all been deleted,
> and the deployed endpoints return 404. **Card = PayRam**, one "Card or crypto"
> row; Play Billing is the other rail. `activeCardRail` no longer exists.
> Everything NOT about Stripe in this doc still stands.

Handover written 2026-08-11. Part 1 is what is left to do. Part 2 is the economy
analysis, written down so the next session does not re-derive it from scratch.

Everything in Part 2 was verified by reading the code, not from memory. File and
line references are given so any claim can be checked in seconds.

---

# PART 1 — What still needs doing

## ~~Blocking Stripe~~ (VOID 2026-08-13, account closed by Stripe)

- **Currency decision is half-made.** Founder chose **native USD**. The catalogue
  is still EUR (`COIN_PACKS[].priceEUR` in `src/utils/vpSystem.js`). Converting
  it is a pricing decision, not a find-and-replace, and it is entangled with the
  coin-price question in Part 2. Do that first, then set the USD ladder once.
  (Still open. It was never really about Stripe.)
- ~~**Statement descriptor** `VERGR` to be set in the Stripe dashboard.~~ Void.
- **`refundOutstandingPicks` has never been run.** Deployed, defaults to
  `dryRun`. Returns stranded prediction stakes from the retired tournament
  betting. Stranded user funds are a complaint and chargeback surface during
  underwriting.

## Blocking Google Play

- **Enter the SKUs.** Prices come from `node scripts/playPricing.mjs --usd 1.08`
  (add `--csv` for bulk import). Product ids `coins_<packid>` and `sub_lite` /
  `sub_pro`. Regenerate after the USD catalogue decision above, because the
  numbers will move.
- **Confirm `PLAY_SERVICE_FEE`.** `src/utils/storePricing.js` assumes 15%. Verify
  in Play Console under Monetise → Pricing, change the one constant, rerun.
- **AAB**: Tauri wrapper. The Kotlin app is still in development and is not the
  store build.

## Product gaps, not started

- **First-purchase offer.** The Tango mechanic the founder remembered: the first
  pack a new payer buys carries a better rate than the same pack afterwards. An
  acquisition mechanic, and it *costs* margin rather than making it. Worth
  building because first-payer conversion is the hardest step in the funnel.
- **Promotional band** (`app_config/general.coinPromo`): extra coins on the same
  price, server-credited, with a countdown. Founder has not decided whether to
  run promotions at all. Affordability maths is in Part 2.
- **Vanguard funding.** Their treasury has exactly one income source,
  `functions/tournaments.js:2531`, and tournaments are unrouted, so it has been
  earning nothing since. The monthly distribution cron is dividing zero. Founder
  has said the whole structure is changing and they will be paid from profits;
  that decision has not been made yet. **Do not fold Vanguard into economy
  maths** — founder has ruled it out of scope repeatedly.

## Latent issues found while working, none urgent

- **`earnedCoinCredit` is bypassed.** The helper in `functions/coinLedger.js`
  exists so a new credit site cannot forget to classify coins as earned
  (convertible) or purchased (not). Nine of the ten credit sites write
  `earnedBalance` inline instead. If someone adds a path that writes only
  `balance`, that income silently becomes non-withdrawable and the creator has no
  way to tell why. Surfaces as "a creator says their money is stuck".
- **Three different beliefs about what a gem is worth.**
  `src/utils/vpSystem.js` says `GEM_TO_EUR = 0.01`;
  `src/screens/wallet/native/NativeWalletScreens.jsx:44` and
  `src/screens/wallet/v2/ConvertScreen.jsx:17` each hardcode `0.009`. Only
  `functions/withdrawals.js:47` (`GEM_TO_MICRO_USDC = 10_000`) decides real
  money. The other two are display-only and currently understate by 10%.
- **Locked-content price bound.** Founder wants the 50–10,000 coin ceiling raised
  or removed now that tournaments are gone. The tournament entry caps are indeed
  dead. But the locked-content bound is **not** a tournament artifact: it is a
  laundering control (`functions/entitlements.js`), and two accounts trading a
  one-million-coin post is a clearing house with a receipt. Raise it if wanted;
  removing it entirely weeks before Stripe underwriting is the wrong direction.
  Tips already have no per-amount cap, only rate limits (30/hour, 200/day in
  `functions/economy.js:37`), so "send a creator a million coins" already works.

## Not verified by a human

Nothing in locked content, Content Packs, 1:1 sessions, the cart, the pack cards
or the quick-buy drawer has been through a real send or a real purchase. The two
worth testing first are a **multi-item locked send** and a **pack send**.

## Already shipped, do not redo

`docs/LOCKED_AND_1TO1_PLAN.md` sections 7 and 8b list it in full. In summary:
locked media sets end to end, Content Packs, the 1:1 join gate and guest list,
Premium Live badging across discovery, the Google Play same-coins-different-price
fix, the coin pack card redesign, pack art normalisation
(`node scripts/packArt.mjs`), and the coin quick-buy drawer.

---

# PART 2 — The coin economy

## The verified money path

Every constant below was read from the code on 2026-08-11.

| Step | Rate | Where |
|---|---|---|
| Coin purchase | **no platform fee** | `functions/payram.js:437` credits coins, writes no revenue row |
| FX buffer on purchase | **2%** (`payramFxBufferPct`) | `functions/payram.js:88` |
| Referral revenue share | 1% base, 2% if the referred user has streamed, +0.5% per subscribed referral, **cap 5%**, 2 years from signup | `functions/referralRevenue.js` |
| Tip | flat **10%** at send | `TIP_PLATFORM_FEE_PCT`, `src/firebase/firestore.js` |
| Coin → gem | **30% → 15%** by VP tier | `functions/economy.js:18` |
| Withdrawal spread | **2%** | `PLATFORM_SPREAD_BPS = 200`, `functions/withdrawals.js:47` |
| Gem cash value | 1 gem = €0.01 | `GEM_TO_MICRO_USDC = 10_000`, same file |

**Coin sell price:** €0.0099 (Starter) down to €0.0090 (bulk), floor
`COIN_VALUE_EUR = 0.0090` in `src/utils/vpSystem.js`.

### The single most important structural fact

`functions/coinLedger.js` splits the wallet: `balance` is spendable,
`earnedBalance` is the subset that arrived as income from someone else.
Conversion checks `min(earnedBalance, balance)`.

**Purchased coins can never be cashed out.** A buyer cannot convert their own
purchase and withdraw it. Coins only leave the system through a creator who
received them. This is what keeps Play Billing from being a cash-out rail, and it
is why the purchased/earned split must never be collapsed.

### The referral share is minted, not deducted

`functions/referralRevenue.js:99` increments the referrer's `balance` **and**
`earnedBalance`. Nothing is taken from the buyer's payment or from platform
revenue. Every referred purchase creates a new withdrawable liability on top of
the coins just sold. It also skips the 10% tip fee, so it costs more per coin
than a tipped coin does.

The comment in that file claiming a bonus "costs well under its face %" is
optimistic for that reason.

## Current margin

Creator receives, as a share of a coin's €0.01 face:
`0.90 (tip fee) × (1 − commission) × 0.98 (spread)`

| Recipient tier | Creator gets | Payout per coin | Platform margin on a ~€0.0096 coin |
|---|---|---|---|
| Rookie (30%) | 61.7% | €0.00617 | **36%** |
| Mid (20%) | 70.6% | €0.00706 | 26% |
| Immortal (15%) | 75.0% | €0.00750 | **22%** |

Less ~3% processing and 1–5% referral: **roughly 18–32% net, full lifecycle.**

That is the real business margin today. It is a normal margin. Earlier in the
conversation a "1% margin" figure was quoted; that was the *incremental* margin
on the purchase event alone after referral cost, not the business, and it was
misleading.

## The identity that governs everything

For a coin that completes the journey buyer → creator → cash:

```
margin = what the buyer pays − what the creator receives
```

Fix both ends and the margin is fixed. There is no fourth term. Several sessions
of ideas (a checkout service fee, a 2:1 coin→gem rate, removing the tip fee,
removing the commission ladder) were all attempts to find one, and all of them
resolved to taking money from the buyer or from the creator.

**There are exactly three doors:**

1. **Price per coin rises.** Not the pack price: the price *per coin*, with
   in-app prices falling to match so the user experience is unchanged. A coin at
   €0.0125 instead of €0.0096 yields a 40% margin. The cost lands on the buyer,
   who receives fewer but more valuable coins per dollar.
2. **Payout falls.** Ruled out by the founder, correctly.
3. **Coins that never reach a creator.** Costs nobody anything.

## Door 3 is free and is not being measured

- A coin spent on a **subscription or a stream boost** never becomes anyone's
  withdrawable balance, so it is **100% margin**. The same coin tipped nets
  22–36%. Lite costs ~500 coins: spent on Lite it returns ~€4.95, tipped it
  returns ~€1.85. **Roughly three times more valuable when spent on the platform
  than passed to a person.**
- **Unspent coins are 100% margin** until spent. Typical virtual-currency
  breakage runs 10–20% of issued value.
- There are currently **only two coin sinks**: subscriptions and the 50-coin
  stream boost. Every additional thing worth spending coins on that is not a
  person is margin at 100% with the creator economy untouched.

**Neither breakage nor sink volume is counted anywhere.** If breakage is near the
industry norm, real margin is already 35–45% and no price needs to change. If it
is near zero, door 1 is needed. Nobody currently knows which, and that is why the
coin price cannot responsibly be set yet.

## The purchase-moment arithmetic

Only relevant to cash timing, not to whether the business is profitable, but it
is what the founder asked about:

```
margin at purchase = FX buffer − referral rate
```

| Buffer | Net at 1% referral | Net at 5% cap |
|---|---|---|
| 2% (today) | 1% | −3% |
| 4% | 3% | −1% |
| 5% | 4% | 0% |
| 6% | 5% | 1% |

The FX buffer is the only invisible buyer-side lever that exists: it is baked
into the USD figure rather than shown as a line item, so there is no fee for a
buyer to object to. It is config (`app_config/general.payramFxBufferPct`), so it
changes without a deploy.

**Caveat that undermines it:** if the catalogue goes native USD as decided, a US
buyer sees no conversion at all and there is no buffer to apply. The buffer only
earns on non-USD purchases. **The USD catalogue decision and the buffer decision
are the same decision** and must be made together.

## Promotion affordability

A bonus coin costs whatever a coin costs on the way out: €0.0062 (Rookie) to
€0.0075 (Immortal). On a 1,200-coin pack with a €0.0034/coin margin:

| Bonus | Verdict |
|---|---|
| +25% | Safe at every tier |
| +50% | Safe for most, break-even at the top tier |
| +100% | Loses money at every tier |

Competitors advertising "+300% More" are quoting a promotional rate against a
base they invented, not a bulk curve. The honest bulk curve on the current ladder
is +3% (Gamer) to +10% (Legend and above), computed by `packValueBonusPct()` in
`src/utils/vpSystem.js` and displayed on pack cards where it clears 5%.

## SHIPPED 2026-08-11 — profit ledger, referral cap, FX buffer retired

All deployed to europe-west1. None of it is user-visible.

**`functions/platformRevenue.js` (new).** The profit ledger that CLAUDE.md
claimed existed and did not. Integer micro-USD rows in `platform_revenue`, plus
a per-day rollup in `platform_revenue_daily` so the admin screen reads one doc
instead of scanning. Every write is guarded and idempotent on `sourceId`, and
none of it can throw into a payment path.

Kinds booked today: `coin_sale_gross`, `buyer_fees_collected`, `processor_fee`,
`payram_settlement_fee`, `payout_liability_accrued`, `referral_cost`,
`platform_sink`.

The point of `payout_liability_accrued` is that it turns "cash in the bank" into
"cash that is safe to spend". Without it a purchase looks like 100% profit for
however many months it takes a recipient to withdraw. It books the WORST case
(Immortal, 15% commission) deliberately: an understated liability is the one
that hurts.

**New fact found while building, verified from PayRam's own FAQ:** PayRam charges
**1-5% on settlement** when funds withdraw to the cold wallet. That is ours, it
is published, and it was accounted for NOWHERE. On $100 of sales it is $1 to $5
straight off the margin. Now booked as `payram_settlement_fee`; override the
assumed rate via `app_config/general.payramSettlementFeePct` (default 0.03, the
middle of the published band) once the real contracted rate is known.

**Sinks are now counted.** `subscribeWithCoins` and the 50-coin Stream Boost both
book `platform_sink`. The boost booking is REVERSIBLE and reverses correctly: a
stream that earns 50 coins of tips gets the fee back, so `endStreamSession` books
a negative row. Without that the ledger would count every refunded boost as
permanent margin and overstate profit on exactly the best-performing streams.

**Referral cap 5% -> 3%** (`functions/referralRevenue.js`). Base 1% and streamer
base 2% untouched, so only heavy referrers notice. `SUB_CAP_COUNT` recomputes
itself from the cap (8 -> 4). Referral cost is now booked at mint time.

**FX buffer retired** (`functions/payram.js`, `DEFAULT_FX_BUFFER` 0.02 -> 0). It
was only ever an invisible markup on the EUR->USD hop, and native USD has no
conversion to mark up. The config field and the mechanism STAY so it can be
switched back on without a deploy if an FX-exposed rail appears.

**firestore.rules:** both new collections are admin-read, `write: if false`.

### USD ladder — SHIPPED + DEPLOYED 2026-08-11

Done in one pass across the charge path AND the display path, for the reason
given in the warning that used to sit here. Build passes, functions and hosting
deployed, VLink postdeploy verified (`/vlink` served by `vlinkApp`, 400).

**Charge path.** `functions/payram.js` COIN_PACKS mirrors vpSystem exactly in
USD. Coins no longer route through `priceEurToUsd` at all: the pack price IS the
charged figure, so a coin purchase can no longer fail because an FX provider is
down. Subscriptions and gem sends still convert, because they are still EUR
(regional multipliers are safe only on something consumed, never redeemed).
`payram_orders.amountEUR` is now null for coins.

**Display path.** `LocalPrice` gained a `usd` prop; `currency.js` gained
`convertFromUsd` / `formatMoneyFromUsd` / `formatUsd`; wallet primitives gained
`fmtUsd` (deliberately NOT localised the way `fmtEUR` is, since USD is the
charged currency and the local figure is only ever an estimate). Updated:
CartContents, CoinQuickBuy, PriceQuote, BuyScreen, NativeWalletScreens,
WalletScreen teaser packs, PublicMarketingScreens.

**Play.** `TARGET_NET_USD_PER_COIN = 0.011628`. `scripts/playPricing.mjs` now
computes natively in USD; `--usd` is a no-op that warns rather than
double-converting, `--eur <rate>` goes the other way. Floor invariant PASSES
(thinnest row: elite in EE at $27.99, nets $0.01163 against a $0.0116 floor).

**Not migrated, deliberately:** `src/screens/wallet/BuyCoinsScreen.jsx` is dead
code. It is imported by nothing and its `applyFirstPurchaseDiscount` /
`FIRST_PURCHASE_DISCOUNT` imports already point at exports that no longer exist,
so it is not in the bundle and cannot be. NOT deleted (hard rule: never remove a
screen without permission).

`scripts/seedCoinPackages.mjs` still holds the old EUR ladder. It seeds a
Firestore `coin_packages` collection that nothing in the live buy path reads, so
it is stale rather than wrong, but it will mislead whoever runs it next.

### ~~Stripe products~~ (VOID 2026-08-13)
`docs/STRIPE_PRODUCT_CATALOGUE.md` and the four `scripts/*Stripe*.mjs` seed
scripts were removed with the rail. The one durable lesson from that catalogue:
a flat $0.30 card fee is the whole margin on a $0.99 pack, and on any non-Play
rail WE are merchant of record for tax, which Play handles for us.

### Cart fees + tax — SHIPPED + DEPLOYED 2026-08-11

Fees are ADDED to the buyer, not absorbed (founder decision). New
`functions/checkoutFees.js` → `quoteCheckout({subtotalUsd, method, uid})`.

**The gross-up is solved, not approximated.** `paid = (net + flat) / (1 - pct)`,
because a processor charges its percentage on the grossed-up amount too. Adding
`pct * net` instead under-recovers by about a cent on a $0.99 sale, which is
small until it is every sale. Verified: every tier nets the subtotal exactly.

| Subtotal | Buyer pays (Stripe) | We net |
|---|---|---|
| $0.99 | $1.33 | $0.99 |
| $9.99 | $10.60 | $9.99 |
| $99.99 | $103.29 | $99.99 |

This is what fixes the Starter pack: absorbed it netted $0.66 against a $0.63
worst-case payout (5%); added it nets the full $0.99 (36%).

**UI is the Tango pattern.** Sticker price stays on the shelf; a quiet
"Taxes / Fees ⓘ" line sits under the Pay button; the itemised breakdown opens on
tap. Four permanent rows above the button turns a two-line cart into a tax
return. `<TaxesAndFees>` in `CartContents.jsx`; the cart re-quotes when the RAIL
changes, because a total quoted for one rail is wrong for another.

**Per rail:**
- Stripe: exact, 2.9% + $0.30, published schedule.
- PayRam card: our published 1-5% settlement fee is itemised; the card partner's
  fee shows `—` with "Shown by the payment provider before you confirm", because
  their API has NO fee field and their docs decline to name partners or rates.
  A confidently wrong fee line is worse than one that says where to look.
- PayRam crypto: settlement only.
- Google Play: NOT itemised and NOT surcharged. Play forbids adding anything to
  an IAP price; its fee is already inside `playPriceFor()`.

**`'card'` MEANS PayRam** (2026-08-13). It used to resolve through
`app_config/general.activeCardRail`; that switch was deleted with the Stripe
rail, because a config key selecting between one live processor and one deleted
one is a trap, not a fallback.

**⚠ TAX IS OFF.** `app_config/general.checkoutTaxEnabled` defaults to FALSE, so
no VAT line is charged or shown. This is deliberate and must NOT be flipped
casually: on Play, Google is merchant of record and remits VAT for us; on Stripe
WE are, and Stripe only calculates and remits when Stripe Tax is enabled AND a
registration exists for that jurisdiction. Collecting tax we are not registered
to remit is a liability, not revenue. Turn it on only after the registrations are
real. VAT_RATES in `checkoutFees.js` MIRRORS `storePricing.js`
TAX_INCLUSIVE_MARKETS; keep them in sync.

`payram_orders` now records `subtotalUSD` (what we intend to net) alongside
`amountUSD` (what the buyer is charged) and `buyerFeesUSD`, and
`bookCoinPurchase` books gross from the SUBTOTAL so fees are not double-counted.

### Currency-consistency sweep — SHIPPED + DEPLOYED 2026-08-11

The USD ladder turned a latent problem into a live one. Every hardcoded rate is
now gone; `src/utils/vpSystem.js` holds the only copies.

**A LIVE OVERCHARGE, caused by the ladder change and caught the same day.** The
custom-amount tab computed `coins = amount / COIN_PRICE_EUR (0.009)` client-side
while the server priced at `CUSTOM_COIN_PRICE_USD (0.0127)`. The client sends
COINS and the server charges `coins * rate`, so typing $10 displayed 1,111 coins
and would have billed **$14.11**. `buyCheckout.js` now exports `COIN_PRICE_USD`
mirroring the server constant; web + native buy screens updated.

**New single sources of truth in `vpSystem.js`:**
- `COIN_VALUE_USD = 0.01163` (ladder floor)
- `GEM_VALUE_USD = 0.01` (mirrors `functions/withdrawals.js GEM_TO_MICRO_USDC`,
  the only thing that decides real money). USD not EUR: withdrawals settle in
  USDC on Base, 1 gem is 0.01 USDC exactly, there is no FX step.

**Eight sites fixed**, five of them user-facing money figures:
`ConvertScreen.jsx` and `NativeWalletScreens.jsx` (each had their own
`GEM_TO_EUR = 0.009`, understating conversions by 10%), `WalletLayout.jsx`,
`wallet/v2/HomeScreen.jsx`, `monetization/PriceSheet.jsx` (locked-content prices,
understated ~29%), `AdminDashboardScreen.jsx`, `buyCheckout.js`, `vpSystem.js`.

**`WalletLayout` was summing coins and gems at ONE rate.** They are not the same
thing: a gem is $0.01 flat because that is what it withdraws at; a coin is valued
at what it COSTS to buy, and its redemption value is far lower because converting
runs the 15-30% rank commission. Now valued separately, and the comment says it
must never be presented as a payout figure.

### Gaming-is-one-category copy pass — SHIPPED + DEPLOYED 2026-08-11

Founder: "gaming is just one category now." Public hero was still
"Play together / Win together / Grow together" → now
**"Create together / Watch together / Earn together."** Also de-gamed: hero body,
feature-carousel heading ("Built for gamers" → creators), footer blurb, About
hero, streaming landing hero + title, legal trading line, home meta description.
`VERGR` → `Vergr` in the prose touched.

**Onboarding:** only `OnboardingFlowScreen` is ROUTED. `OnboardingScreen`,
`ProfileSetupScreen`, `FollowSuggestionsScreen` and `InterestSelectionScreen` are
unrouted zombies (the last one IS gaming-only: Speedrunning, Retro Gaming, VR
Gaming, Game Dev — that is what the founder remembered). NOT deleted, per the
hard rule. Live copy de-gamed; the `|| '🎮'` fallback icon made every
un-iconed topic read as gaming, now `✨`.

The live interest list is `CONTENT_TOPICS` in `src/utils/constants.js`: 20 broad
topics with Gaming as one. Already correct, shared with the composer and
EditProfileScreen. It saves to `profile.gameTags` — a legacy field NAME, read by
the composer, For You matching, ProfileCompletionCard and `completeOnboarding`.
Renaming needs a data migration on existing user docs; the name is internal and
never shown, so it was left alone deliberately.

**NOT touched, deliberately:** `src/screens/marketing/growth/` is the SEO keyword
estate (`/platform/make-money-gaming` etc). Those pages target gaming search
terms on purpose; de-gaming them throws away the SEO work. A creator-focused
pillar page is NEW content, not an edit. Help articles saying "gaming accounts"
are accurate (Steam/Twitch linking).

### Auto-convert + buyback — COMPLETE, SHIPPED + DEPLOYED 2026-08-11

Both halves are live. Earned value converts to gems at receipt; gems buy coins
back at a flat 1:1.

**Wired (all deployed):**

| Path | Function | Shape |
|---|---|---|
| Tips | `sendTip` | INLINE (`earnedGemCredit`) |
| Memberships (new) | `subscribeMembership` | post-commit |
| Memberships (renewal) | `cronDaily` | post-commit, idempotent per period |
| Event tickets | `purchaseEventTicket` | post-commit |
| Season passes | `purchaseSeasonPass` | post-commit |
| Rewarded ads | `admobSsvCallback` | post-commit, idempotent per AdMob txId |
| Referral share | `payramWebhook` / `pollCircleDeposits` | post-commit |
| Vanguard treasury | `adminTriggerVanguardDistribution` + cron | post-commit, per (month, uid) |

**Two shapes, and the rule for which to use.** Where the crediting transaction
already reads the recipient's wallet, convert INLINE with `earnedGemCredit`: it
is atomic and the coins never exist as coins. `sendTip` is the only such site.
Everywhere else writes the creator wallet with `set(..., {merge:true})` and never
reads it, so there is no VP in scope; those use `settleEarnedToGems(db, {...})`
post-commit, the same pattern `creditReferralPurchaseBonus` already used.

**The post-commit failure mode is deliberately benign.** If it throws or never
runs, the coins simply stay coins under the old model: the user keeps every unit
of value and can still convert manually. Nothing is lost, nothing double-counts.

**The Vanguard 0% perk survived.** `isVanguardExempt()` is now a shared helper in
coinLedger.js and every site applies it, including the treasury distribution
(which re-reads each user doc, so a status change between distribution and
settlement is priced on what is true now).

**Clamping:** `settleEarnedToGems` converts `min(coins, earnedBalance, balance)`,
so a spend between the credit and the settlement cannot push a wallet negative.

**Idempotency:** `earned_gem_settlements/{sourceId}` marker per settlement.

**UI:** `<GemsToCoins>` on ConvertScreen (`/wallet/convert`), collapsed by
default, min 10 gems, Max button. Copy states plainly that converting back to
gems later charges commission, so only convert what you plan to spend.

**Verified against the founder's own scenario, in the real code:** receive 1,000
at 30% → 700 gems; level to 20%; buy back 700 coins; convert → 560 gems. Net
**−140 gems**. The round trip loses at every rank.

`BUYBACK_COINS_PER_GEM = 1` is a CODE constant, not Firestore config, and the
module refuses to load above 1.15. A remotely-tunable buyback rate pushed past
~1.18 turns the round trip profitable and becomes a money pump with no deploy and
no review.

### (historical) The half-shipped note this replaced

**Shipped and deployed:**
- `functions/gemBuyback.js` → `buyCoinsWithGems` callable. Flat 1:1, exported
  from index.js, client wrapper `buyCoinsWithGems(gems)` in firestore.js.
- `functions/coinLedger.js` → `earnedGemCredit(coins, vp)` + `commissionForVP`.
  Returns the wallet increments AND the numbers for the ledger row, so a caller
  cannot convert and forget to record the rate.

Verified by running the founder's exact scenario: receive 1,000 at 30% → 700
gems; level to 20%; buy back 700 coins; convert → 560 gems. **Net −140 gems.**
The round trip loses at every rank, which is what makes 1:1 safe.

**The buyback is safe to ship alone** and already is: earned value still arrives
as coins today, so nobody is stranded, and gems→coins is purely additive (a user
who converted too eagerly can get spending money back). Converting out and back
costs commission, so there is no exploit.

**NOT DONE: the auto-convert wiring.** `earnedGemCredit` is not called anywhere
yet. Nine sites credit `earnedBalance` and each needs converting:

| File | Line | Path |
|---|---|---|
| `index.js` | ~3382 (`sendTip`) | tips, highest volume |
| `memberships.js` | 97, 284 | creator memberships |
| `eventTickets.js` | 162, 309 | ticket sales |
| `admobReward.js` | 222 | rewarded ads |
| `referralRevenue.js` | 119 | referral share |
| `vanguard.js` | 129 | treasury distribution |
| `tournamentTrust.js` | 321, `tournaments.js` 2393 | dead (tournaments removed) |

**Two things that will bite whoever wires it:**

1. **The Vanguard 0% perk.** `economy.js` line ~165 does
   `vanguardActive ? 0 : commissionForVP(vp)` — active Vanguard convert free.
   `earnedGemCredit` takes only VP, so wiring it naively DELETES that perk. Pass
   the effective commission, or extend the helper, but do not lose it.
2. **VP lives on the WALLET doc** (`w.vp`), not the user doc, so most sites
   already have it in a read they are making. `sendTip` reads
   `recipientWallet` and can use `.data().vp` with no extra read.

**Do NOT deploy auto-convert without the buyback UI.** The callable exists but
nothing calls it: ConvertScreen still only converts coins→gems. Auto-convert
without a visible way back strands every creator who wants to spend.

**Migration decision is moot:** founder confirmed no users have purchased and
there are no creators, so existing balances need no grandfathering.

### ~~Stripe checkout~~ — REMOVED 2026-08-13 (Stripe closed the account)

The whole rail is gone: `functions/stripeCheckout.js`, the `createStripeCheckout`
client wrapper, the index.js exports, the legacy unsigned `handleStripeWebhook`,
`StripeCheckoutPanel.jsx`, the `useStripeReturn` handler, the npm deps, the
`VITE_STRIPE_PUBLISHABLE_KEY` env entry and the four setup/seed scripts. The
three deployed endpoints were deleted (404 now) and both `STRIPE_*` secrets
destroyed. The setup runbook that lived here has been deleted so nobody follows
it by accident.

**What is worth keeping from it**, for any future processor:

- A webhook is a public URL. Verify the signature on the RAW body before
  parsing, or anyone who learns the URL mints coins for free. Fail CLOSED when
  the signing secret is missing.
- The client names WHAT (a sku or a cart), never HOW MUCH. Re-price server-side
  from `COIN_PACKS` every time.
- Purchased coins credit `balance` only, never `earnedBalance`. A buyer who can
  convert their own purchase and withdraw has turned card billing into a
  cash-out rail (functions/coinLedger.js).
- A redirect back from checkout is the NORMAL path (3-D Secure, iDEAL), so the
  panel callback cannot be trusted to run, and a session id in the URL is not
  proof of payment. Settle on the server doc only.


**Design decisions worth not re-litigating:**
- **`stripe_orders/{sessionId}`** carries the same `awaiting_settlement →
  settled` lock as `payram_orders`, written BEFORE the buyer pays. The webhook can
  never credit an order we have no record of, and cannot double-credit.
- **Signature verification fails CLOSED.** No `STRIPE_WEBHOOK_SECRET` returns 500,
  never "accept anything". This endpoint mints coins; an unverified POST is free
  money. Uses `req.rawBody` because Stripe signs exact bytes.
- **ONE Stripe line item for the whole basket**, not one per pack. Fees and tax
  are grossed up across the basket; splitting them back per line either does not
  add up or invents an allocation nobody asked for. The itemisation is in the
  description, and our own cart already showed it.
- **Purchased, not earned.** Credits `balance` only, never `earnedBalance`.
- **Processor fee is booked EXACTLY**, not estimated. Stripe publishes its
  schedule, unlike PayRam, so no later reconciliation row is needed.

**`scripts/seedStripeProducts.mjs`** generates all 8 products + prices FROM
`COIN_PACKS`. Dry-run by default; `--apply` writes; LIVE mode additionally needs
`--i-mean-live`. Idempotent via `lookup_key = coins_<packid>`. Stripe prices are
IMMUTABLE, so a repricing archives the old price and creates a new one rather
than pretending an update happened. Re-validates the bulk curve before writing.

Run it by reading the key from Secret Manager, never by pasting it into a file:
```
STRIPE_SECRET_KEY=$(npx firebase functions:secrets:access STRIPE_SECRET_KEY) \
  node scripts/seedStripeProducts.mjs --apply
```

**Subscriptions are NOT seeded.** Lite/Pro are still EUR with regional
multipliers (`geoPricing.js`), and regional pricing is only safe on something
consumed rather than redeemed. Set those two up by hand until their currency
question is settled.

**EMBEDDED CHECKOUT is the default** (founder: "I want it to stay on our site").
`createStripeCheckout` returns a `clientSecret` for an in-page mount rather than
a redirect URL. Pass `{ mode: 'hosted' }` for the redirect fallback, which is
still needed when the embedded iframe is blocked (some webviews) or the mount
fails.

Embedded and hosted take DIFFERENT url params and Stripe rejects the wrong pair,
so they are branched: embedded gets one `return_url`, hosted gets
`success_url` + `cancel_url`. Exactly one of `clientSecret` / `url` is ever
non-null, so the client cannot take the wrong path.

**Still to do (the client half of embedded):**
1. `npm i @stripe/stripe-js @stripe/react-stripe-js` at the repo root.
2. A `<StripeCheckoutPanel>` mounting `EmbeddedCheckoutProvider` +
   `<EmbeddedCheckout>` with the returned `clientSecret`, rendered inside the
   wallet rather than navigated to.
3. Needs the PUBLISHABLE key (`pk_test_...`) on the client. That one is safe in
   the bundle by design, unlike the secret key.
4. On `return_url` hit, do NOT credit from the client. The webhook is the only
   thing that credits; the return page just polls `stripe_orders/{sessionId}`
   until `status === 'settled'`.
5. Wire into `PaymentMethodPicker` / `CartContents` as a selectable rail, then
   flip `app_config/general.activeCardRail` to `stripe` when it is primary.

### Stripe secret handling
Never paste a key into a chat. `printf 'sk_test_...' | firebase functions:secrets:set STRIPE_SECRET_KEY`
(printf, never echo: a trailing newline once broke R2 for days). Nothing reads
`STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` yet.

### Still to do from this batch
- **Cart taxes and fees**, Tango pattern: sticker price, "Amount inclusive of
  Fees: $X" underneath, exact breakdown behind the tap. Fees are ADDED to the
  buyer (founder decision 2026-08-11), not absorbed.
- **Auto-convert + buyback**, locked below.

### ⚠ Read before touching the ladder AGAIN (kept: still true next time)
`priceEUR` has 138 references across 19 files. Most are NOT coin packs:
`nowpayments.js`, `adminSubscriptions.js`, `geoPricing.js` and
`AdminSubscriptionsScreen.jsx` are SUBSCRIPTIONS, which stay EUR because
regional pricing applies to subscriptions and only to subscriptions (see
`reference-never-discount-a-redeemable`).

Do the coin-pack migration in ONE pass across the charge path AND the display
path together. A half migration where `vpSystem.js` holds USD and
`BuyCoinsScreen.jsx` still renders a euro sign is the displayed-versus-charged
mismatch that Play rejects for and that `getCoinPriceQuote` was built to prevent.
Half is worse than none here.

Coin-pack files: `src/utils/vpSystem.js`, `functions/payram.js` (COIN_PACKS
mirror), `src/utils/storePricing.js`, `scripts/seedCoinPackages.mjs`,
`scripts/playPricing.mjs`, `BuyCoinsScreen.jsx`, `CartContents.jsx`,
`WalletScreen.jsx`, `PriceQuote.jsx`, `NativeWalletScreens.jsx`,
`BuyScreen.jsx`, `CoinQuickBuy.jsx`, `currency.js`, `firestore.js`.

### The shipped ladder (live since 2026-08-11)

| Pack | Price | Coins | Per 100 coins |
|---|---|---|---|
| Starter | $0.99 | 78 | $1.27 |
| Gamer | $4.99 | 400 | $1.25 |
| Pro | $9.99 | 815 | $1.23 |
| Elite | $19.99 | 1,650 | $1.21 |
| Legend | $49.99 | 4,180 | $1.20 |
| Champion | $99.99 | 8,450 | $1.18 |
| Titan | $149.99 | 12,800 | $1.17 |
| Ascendant | $249.99 | 21,500 | $1.16 |

Monotonically improving rate, +9% bulk curve top to bottom, floor
$0.01163/coin. Founder's stated anchor of ~$1.17 per 100 coins sits mid-ladder.

## LOCKED 2026-08-11 — auto-convert at receipt + gem buyback

Founder approved. Build these two together; auto-convert without the buyback
strands every creator who wants to spend in-app.

**1. Earned coins auto-convert to gems the moment they are received.**
The commission rate charged is the recipient's rate AT RECEIPT, not at the time
they choose to cash out. This is the TikTok model: gifts land as Diamonds, and a
creator who wants to send gifts buys Coins with cash like anyone else.

Closes a real leak. Today a Rookie can sit on earned coins, grind to Immortal,
and convert the whole stored balance at 15% instead of 30%. On 1,000 coins that
is a payout of 850 gems instead of 700, i.e. EUR 1.50 per 1,000 coins straight
off the margin.

**2. Gems buy coins back at a flat 1 gem = 1 coin.**
This is what keeps in-app spending alive. It also charges a second toll: the
creator paid commission on the way in, and gets back coins worth EUR 0.0090 for
a gem that was a EUR 0.0100 liability.

**The buyback rate must never depend on rank, and must never exceed 1.15.**
Round-tripping gems to coins and back is only profitable for the user if the
buyback hands out more than `1 / (1 - commission)` coins per gem. At the best
rank (15%) that line is 1.18. At 1:1 the round trip loses the user 15% every
loop, so nobody will do it for arbitrage, only for genuine spending.

Worked check, the scenario the founder raised (receive at 30%, level to 20%,
then buy back): 1,000 coins becomes 700 gems, buys back 700 coins, converts at
20% to 560 gems. The user is 140 gems down. Levelling up does not help, because
the buyback rate is flat.

**Classification:** coins issued by the buyback are EARNED (convertible). Making
them purchased would trap creator money permanently and produce "my money is
stuck" complaints. Earned is safe because each round trip is lossy.

**Play/Stripe:** this SHARPENS the wall rather than weakening it. Purchased coins
still can never reach gems. Earned value goes straight to gems. The mixed wallet
disappears, which is an easier story at underwriting than what exists today.

**The cost, accepted knowingly:** the commission ladder stops being retroactive.
Levelling up helps future earnings only, never a balance already earned. The
ladder survives as a perk, but "save up and cash out cheaper later" dies with it.

**STILL OPEN — founder has not answered:** do existing earned balances get
converted now at each creator's current rank, or grandfathered as coins with only
new income auto-converting? Converting now earns more immediately but changes the
deal on money people already earned while the ladder was retroactive.

## Founder constraints — do not relitigate

Stated firmly, more than once:

- **The commission ladder stays.** It is the front-facing creator perk that no
  other platform offers, and the sense of progression is the point of it.
- **The 10% tip fee stays.**
- **No visible checkout service fee.** Turns buyers away, and Stripe already
  charges one.
- **The coin must keep feeling cheap.** ~$1.17 per 100 coins is deliberate.
- **Do not take more from creators.** "Without creators we do not have a platform
  and we do not have a reason for people to buy coins in the first place."
- **Tournaments are gone.** Their caps go with them.
- **Vanguard is out of scope** for economy maths. Their structure is changing and
  they will be paid from profits.

## Open questions, in the order they should be answered

0. **Grandfathering of existing earned balances** under the locked auto-convert
   decision above. Blocks the build.
1. **What is the actual breakage rate?** Everything else depends on it. Not
   measurable today because nothing counts it.
2. **USD catalogue ladder.** Native USD was chosen; the numbers have not been
   set. Blocks the Play SKUs.
3. **FX buffer** (and whether it still matters once USD is native).
4. **Referral ceiling.** 5% is what makes the purchase-moment arithmetic
   negative. A 3% cap with a 4% buffer nets at least 1% on every purchase.
5. **Coin price**, only after 1 is known.

## Recommended next step

**Ship the measurement before changing any price.** One day of work, changes
nothing user-facing:

⚠ Verified 2026-08-11: **`platform_revenue` does not exist.** It is written
nowhere in the repo (the only hit is this document). CLAUDE.md describes a live
three-bucket ledger with a daily reconciliation invariant; that ledger was never
built. So today there is no record of profit anywhere at all, not merely missing
breakage counters. Step 1 below has to create the collection, not extend it.

1. Book the FX margin and the referral cost to `platform_revenue` at settlement,
   so a purchase shows profit the moment it lands instead of being invisible
   until someone withdraws months later.
2. Add a breakage counter and a platform-sink counter.
3. Surface all of it on the admin economy screen, with the buffer as an editable
   config field.

Then set the coin price against real numbers rather than estimates.
