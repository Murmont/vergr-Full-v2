# Withdrawal / conversion / crypto-deposit removal list

**Purpose: stop a future session redoing finished work.** Tick a box the moment the change lands,
and never tick one without grepping first. Started 2026-08-16.

**The rule this enforces: users can NEVER withdraw, convert, or transfer anything.**
`requestWithdrawal` throws (`functions/withdrawals.js:280`), `sendGems`/`quoteGemSend` throw
(`functions/gemTransfer.js:91`), `buyCoinsWithGems` is disabled. Coins are a revocable licence to
access features, no cash value, non-transferable. Gems are revenue share Vergr OWES, not a balance,
and are never shown to a user. The only outbound path is Vergr paying a creator on Vergr's schedule
(`functions/creatorPayouts.js`).

Related: `docs/REVENUE_SHARE_PLAN.md` §1.4 (principal model), §1.5 (what had to change).

---

## A. PUBLIC AND CRAWLABLE

`scripts/prerenderHelp.mjs` writes a static HTML file + sitemap entry per published help URL on every
build, so these are indexed pages. Article URLs are `/platform/help/<slug>` with no category segment.

- [x] **A1. `public/llms.txt`** — 3 money-flow claims rewritten to the principal model. Had stated
      "withdraw as USDC to the user's own whitelisted wallet" as fact to AI crawlers.
- [x] **A2. help category `withdrawing/`** — DELETED, 14 articles + index + category card.
- [x] **A3. help category `converting/`** — DELETED, 6 articles + index + category card.
- [x] **A4. 5 stragglers in kept categories** — DELETED:
      `do-i-need-to-be-verified-to-withdraw-gems`, `why-can-i-not-withdraw-until-i-am-verified`,
      `what-is-a-whitelisted-withdrawal-address-and-why-do-i-need-one`,
      `how-do-i-add-or-remove-a-withdrawal-address`, `which-currency-can-i-withdraw-as-real-money`.
- [x] **A5. 3 gem-subject articles** — DELETED: `what-are-gems`, `do-gems-expire`,
      `what-is-the-difference-between-coins-and-gems`.
- [x] **A6. 3 articles REPLACED with the real feature** (old slug retired, new slug published):
      `how-do-coins-gems-and-vp-work-together` → `how-do-coins-and-vp-work-together`;
      `what-are-vc-vp-and-gems` → `what-are-coins-and-vp`;
      `how-do-i-check-my-coin-and-gem-balance` → `how-do-i-check-my-coin-balance`.
- [x] **A7. dead CTA links** — 28 repointed across 25 files. Verified zero CTAs target a deleted slug.
- [x] **A8. `legalContent.js`** — 15 edits: ToS §4A.2 / §4A.5 / §4A.6, privacy processing +
      retention + processor rows, forfeiture clause, KYC gate, two fee lists, prize clause.
- [x] **A9. `compliancePolicies.js`** — 20 edits: AML payout caps, AML monitoring typologies,
      anti-fraud typologies, sanctions wording, chargeback/negative-balance wording.
- [x] **A10. ~81 published articles with incidental gem/withdraw wording in BODY text.**
      Sentence-level rewrites, roughly 35 distinct patterns. NOT a find-and-replace.
      DONE in 3 ordered passes (178 replacements): conversion/withdrawal framing -> revenue share,
      Gems removed from all user-facing copy, whitelisted-payout-address language removed, "conversion
      commission" -> "the share Vergr keeps", and EUR tier prices corrected to USD ($4.99/$9.99, which is
      what `tierSystem.js:31,50` actually charges). Verified: the only remaining "withdraw" strings in
      published articles are deliberate negations ("Nothing on VERGR can be withdrawn...").

## B. IN-APP SURFACES

- [x] **B1. Crypto deposit, "Receive USDC on Base".** Route `/wallet/security/deposit` is mounted at
      DONE: route unmounted (`AppRouter.jsx`), both lazy imports removed, breadcrumb removed from `WalletLayout`, and all 4 entry points cut (native QuickAction + LinkCard, wallet Settings card, Security block). Screens remain on disk, unreachable.
      `AppRouter.jsx:1092`. Entry points: `NativeWalletScreens.jsx:142` (QuickAction),
      `NativeWalletScreens.jsx:489` (LinkCard), `SettingsScreen.jsx:44`, `SecurityScreens.jsx:108`,
      breadcrumb `WalletLayout.jsx:239`.
      **Note: this button credits nothing.** `circleWallets.js:437` credits coins ONLY for an
      attributed PayRam order; an unattributed deposit is parked for manual admin reconciliation
      (`:510`). It is a support-ticket generator, and it is the last inbound-custody shape.
- [x] **B2. Buttons on reachable screens pointing at routes that no longer exist (dead clicks).**
      DONE: "Whitelisted addresses" block cut from `SecurityScreens`; the Vanguard "Request Payout / Withdraw" card cut from `VanguardWalletScreen` (plus its now-unused `withdrawalCommission` + `getCommission` import). `SecurityScreens:495` is inside `SecurityAddressesScreen`, which is NOT mounted, so it is dead.
      `SecurityScreens.jsx:102` → `/wallet/security/addresses` (unrouted);
      `SecurityScreens.jsx:511` → `/wallet/withdraw/new-address` (unrouted);
      `VanguardWalletScreen.jsx:165` → `/wallet/payout` (redirects to `/creator/earnings`).

## C. ALREADY UNROUTED — do not re-link, no action needed

- [x] `WalletScreen.jsx` — lazy-imported at `AppRouter.jsx:486`, NEVER mounted. Still contains
      "Convert Coins" (`:401`) and "Convert to Gems" (`:449`) CTAs; harmless while unmounted.
- [x] `ConvertScreen.jsx`, `WithdrawScreen.jsx`, `NewAddressScreen.jsx`, `RequestPayoutScreen.jsx`,
      `PayoutScreens.jsx`, `SendGemsModal.jsx` — all unrouted / unmounted.

## D. LIVE COMPONENTS WITH WITHDRAWAL COPY — read, then edit (not delete)

⚠ **A tick in this section means "the hit that was looked at", NOT "this file is clean".**
`EarnCoinsScreen.jsx` was ticked for its Cash Out tile on 2026-08-16 and still carried a
`Gems (cashable)` stat tile and a coins-to-gems tooltip; both were found and fixed in the second
pass (G1). Re-grep the whole file before trusting a tick here.

- [x] `src/components/wallet/WalletOnboarding.jsx`
      DONE: "Gems for earning" -> Coins-only; PIN and 2FA copy no longer cite withdrawing or deposit addresses.
- [x] `src/components/wallet/WalletWalkthrough.jsx`
      DONE: 8 beats -> 5. Dropped TWO CURRENCIES (gems), CASH OUT, and SEVEN DAYS (which animated "Funds leave the wallet, on chain"). Beat2/4/6 components remain defined but unreferenced.
- [x] `src/components/payments/WalletEducationWizard.jsx`
      DONE: irreversible-withdrawal warning -> spent-Coins warning.
- [x] `src/components/verify/KycWizard.jsx` — "verify to withdraw" framing
      NO CHANGE NEEDED: its only hit is "withdraw consent", which is GDPR wording, not a payout.
- [x] `src/components/verify/DiditVerify.jsx`
      DONE: "enter tournaments, or withdraw earnings" -> "or be paid your creator revenue share".
- [x] `src/screens/home/EarnCoinsScreen.jsx`
      PARTIAL then DONE: the Cash Out tile went 2026-08-16, but a `Gems (cashable)` stat tile and an "earn coins, then convert coins to gems" tooltip survived until the second pass (G1).
- [x] `src/screens/home/ReferralScreen.jsx`
      DONE: commission-on-cash-out copy -> share-you-keep copy (2 places).
- [x] `src/screens/home/native/NativeHomeScreens.jsx`
      DONE: dropped the Gems stat tile (it printed the internal accrual unit to a user) and made the grid 2-col; earn tooltip no longer describes tournaments, conversion or commission; 2 VP/commission lines rewritten to revenue share.
- [x] `src/screens/creator/MembershipTiersScreen.jsx`
      DONE: "convert to gems to withdraw" -> "You keep 90%. Vergr pays your revenue share on a schedule."
- [x] `src/screens/creator/CreatorEarningsScreen.jsx`
      NO CHANGE NEEDED: every hit is a code comment, and the file header already forbids a withdraw affordance.
- [x] `src/screens/creator/PayoutScreens.jsx`
      NO CHANGE NEEDED: single hit is a code comment.
- [x] `src/context/WalletUnlockContext.jsx`
      NO CHANGE NEEDED: hits are code comments only.
- [x] `src/components/auth/AuthShell.jsx`
      DONE: signup panel said "Earn VP, cash out / Rack up rewards and withdraw to crypto" and advertised retired tournaments. Now squad-building + revenue share.
- [x] `src/screens/auth/SignUpStep1.jsx`
      DONE: consent checkbox named "competitive tournaments" and "cryptocurrency withdrawals". Now Coin purchases, subscriptions, creator revenue share.

## F. FOUND LATE (not in the original list) — all DONE unless noted

- [x] `src/components/vergrme/BlockForm.jsx`, `ProductsPanel.jsx`, `ProductsPointer.jsx` — seller-facing
      Vergr.me copy said "paid straight to gems (no withdraw fee)". Now "credited to your earnings".
- [x] `src/layouts/WalletLayout.jsx` — onboarding line "buy coins, earn, and cash out" -> "buy and spend
      coins"; and a comment asserting the accrual unit "withdraws at" $0.01.
- [x] `src/firebase/firestore.js` — ledger row description `Cash out €X via Y` -> `Payout of $X via Y`
      (also EUR -> USD, which is the currency actually charged).
- [x] Help articles carried EUR tier prices (€4.99 / €9.99). `tierSystem.js:31,50` charges USD, so
      corrected to $4.99 / $9.99.
- [x] `src/screens/marketing/growth/` — **DELETED 2026-08-16** (founder: "then do it"). Content module
      + `GrowthScreens.jsx` + lazy exports + `AppRouter` imports + the prerender block. It could not be
      repaired by sentence edits: 638 lines whose premise was tournament prize pools, 1v1 money matches
      with escrowed stakes, and USDC withdrawal, none of which exist. Verified: directory gone, zero
      dangling references. The four URLs now return 410 (see G5).

## H. SEO — removed URLs return HTTP 410 (DONE, deployed 2026-08-16)

- [x] **All 31 removed help URLs return a hard 410 Gone**, via `functions/gone.js` (`goneHelp`,
      europe-west1) wired through `firebase.json` rewrites placed BEFORE the SPA catch-all.
      Verified live: 31/31 return 410 with `X-Robots-Tag: noindex, nofollow`; surviving articles and
      the help index still 200; VLink unaffected.

      **They were briefly 301s. That was WRONG and was reverted the same day.** Two reasons, and the
      second is the one that matters:

      1. A 301 keeps the URL permanently resolvable. "It redirects elsewhere" is a weak answer to an
         underwriter asking whether withdrawals were removed. 410 is auditable: the resource is gone.
      2. A 301 passes topical signal INTO the target, teaching search engines that the surviving
         earnings article is about withdrawal. That is the exact association this migration exists to
         sever, so the redirect actively worked against the point of the whole task.

      The link-equity argument for 301 was worth ~nothing here: these were help pages for a feature
      that no longer exists, carrying no valuable traffic and no equity worth keeping.

      **Why a Cloud Function.** `firebase.json` `redirects` can only emit 3xx, and the catch-all
      rewrite (`** -> /index.html`) answers 200 with the app shell for anything unmatched, which
      Google classes as a SOFT 404 and is worse than either option. A rewrite to a function is the
      only way hosting can return a real 410. The slugs are enumerated one by one on purpose:
      pointing `/platform/help/**` at the function would route every help article through it, killing
      the prerendered static HTML and billing an invocation per help pageview.

      ⚠ **Removing a URL from the sitemap does NOT deindex it.** Google drops a URL when it recrawls
      and gets the removal signal. The sitemap only controls what is submitted.

- [ ] **FOUNDER ACTION: Search Console removal requests.** A 410 only takes effect when Google
      recrawls, so old titles can sit in results for days or weeks. The Removals tool suppresses them
      immediately. **The list is now 38 URLs, not 31:**

      - the original 31 withdrawal / conversion / gem help articles;
      - 4 growth URLs: `/platform/make-money-gaming`, `/platform/legit`, `/platform/play`,
        `/platform/play/cs2` (and the other `/platform/play/*` game pages);
      - 3 removed help articles: `is-playing-games-for-money-on-vergr-gambling`,
        `how-does-vergr-detect-cheating`, `how-does-vergr-verify-results-and-prevent-cheating`.

      Prioritise the `*withdraw*`, `*convert*` and `*gambling*` ones: those are what an underwriter
      searches for.

## G. STILL PUBLISHED AND WRONG

⚠ **The original claim here ("none known", 2026-08-16) WAS WRONG and cost the next session a full
pass.** A sweep the same day found withdrawal copy live on indexed marketing pages and on in-app
screens. Root cause of the miss: the first sweep searched for withdrawal terms paired with
money words, so it never matched a bare `Withdraw to crypto` tile title, a `Gems (cashable)`
label, or a `<title>` tag. **Sweep on the bare terms and classify the hits, do not pre-filter.**

### G1. FIXED + DEPLOYED 2026-08-16 (second pass)

- [x] **`helpContent.jsx` POPULAR_FAQS.** The "How do payouts work?" answer described requesting a
      payout in Gems to a cryptocurrency wallet address, and it is fed to `faqSchema()` on
      `/platform/help`, so it was FAQPage structured data telling search engines VERGR does crypto
      withdrawals. Also the 18+ answer, the `Coins, Gems & VP` category label, and the
      security-privacy blurb ("withdrawal addresses").
- [x] **`PublicMarketingScreens.jsx`, 27 + 15 edits across 10 routed pages**, 5 of them in the
      sitemap: the landing payments slide (`Withdraw to crypto`, `Min 1,000 gems`), the landing
      economy block and its `MIN. WITHDRAWAL 1,000 GEMS` caption, the landing phone mock that
      advertised a €10,000 `Season Cup` prize (a retired product, and `llms.txt` states publicly
      that VERGR runs no prize competitions), the help hero, `/platform/delete-account`,
      `/platform/about`, `/platform/monetization`, `/platform/creators`, `/platform/forums`,
      `/platform/partners`, and the whole of `/platform/learn/coins`, whose `<title>` literally read
      **"VC Coins — Gaming Currency You Can Cash Out"**.
- [x] **`scripts/prerenderHelp.mjs` carries its OWN copy of every marketing `<title>`/`<meta>`.**
      Fixing the screen alone left the static HTML Google actually reads unchanged. 7 edits.
      **Anything that changes marketing page metadata must change BOTH files.**
- [x] **`src/screens/settings/HowItWorksScreen.jsx`** (`/settings/how-it-works`), the worst in-app
      offender: "three currencies", gems cashable, a `cashout` section reading "1000 gems (€10),
      Paid via Wise/PayPal, ~3% processor fee" (Wise and PayPal have never been payout rails here),
      and a VP-keyed 30%/15% commission table. Rewritten to coins + VP and the real ladder.
- [x] **`src/screens/settings/HelpCenterScreen.jsx`** (`/settings/help`), 7 FAQ answers.
- [x] **`src/components/FirstBootIntro.jsx`**, the first-run animation every new user sees: it
      counted a gem balance up to 1,000 beside a `PAYOUT · USD $9.50` figure under the caption
      "Coins in. Gems out. Real money." Now coins in, creators paid.
- [x] **`src/screens/home/EarnCoinsScreen.jsx`** still printed a `Gems (cashable)` stat tile and an
      "earn coins, then convert coins to gems" tooltip. (Section D ticked this file for the Cash Out
      tile only. A file is not done because one hit in it was fixed.)
- [x] **Wallet v2:** `HelpScreen` FAQ (withdrawal hold, conversion rate, "withdraw to any wallet",
      plus a hot/warm/cold multisig-Safe custody description that does not exist), `KycScreen` tier
      unlocks (advertised daily AND monthly crypto/bank withdrawal caps; only a MONTHLY cap is
      enforced, `creatorPayouts.js:116`), `SecurityScreens` 2FA copy, `HomeScreen` dead locals.
- [x] **`src/screens/wallet/native/NativeWalletScreens.jsx`:** the Gems balance card and the
      "Withdrawal limits" cards were still there on native, months after the web wallet dropped
      both. Also the KYC tiers, the frozen-wallet copy and the Conversions/Withdrawals history
      filters. The in-flight withdrawal panel is KEPT on purpose: `cancelWithdrawal` is deliberately
      still live. ⚠ Source only, native ships in one APK later ([[feedback-batch-native-work]]).
- [x] **3 published + indexed help articles:** `what-does-vp-actually-do-for-me` (claimed VP sets
      your share), `what-is-vergrs-refund-policy` ("Withdrawals that have been sent are
      irreversible"), `how-do-i-tip-a-creator` ("convert them to Gems and cash out").
- [x] **Vanguard screens x3** promised a "5% withdrawal-commission floor" at VP L100. Both halves
      wrong: there is no withdrawal, and the Vanguard perk is a 100% share while active
      (`coinLedger.js:260`, `vanguardExempt ? 1 : shareForEarnings`).
- [x] **`ShopScreens.jsx`** ("Proceeds land as gems... no withdraw fee", "gems (the withdrawable
      currency)"), **`PrestigeShowcase.jsx`** ("Only gems convert to a payout"),
      **`EditProfileScreen.jsx`** DOB hint, **`PrestigeLevelsScreen.jsx`** which linked at
      `how-do-i-convert-coins-into-gems`, a slug deleted in the first pass, so the link served a 410.

### G2. VERIFIED CLEAN after the second pass

Live-checked on vergr.app after deploy, not from the build:

- All 31 removed help URLs still return **410**. ⚠ The `goneHelp` function COLD-STARTS as 500/503;
  they settle to 410 once warm. Google retries 5xx, so this delays rather than breaks the deindex,
  but do not conclude from a single 5xx that the 410s have regressed.
- `/platform/learn/coins`, `/platform/help`, surviving articles: 200. VLink: still served by
  `vlinkApp`. Sitemap unchanged at 420 URLs (387 help, 355 articles), so no article was lost.
- Every `withdraw`/`cash out` string left in the 423 prerendered HTML pages is a deliberate
  negation, except the CSAM policy line about not withdrawing a report to an authority.
- The old crypto-payout FAQ answer appears in **zero** shipped JS bundles.

### G3. The "flat 10% / creator keeps 90%" claim — REMOVED 2026-08-16 (founder-instructed)

Founder: *"it needs to be removed, the only thing that should exist is the revenue share model"*.

**THE ONLY MODEL. There is no per-surface fee anywhere.** Verified in code, not assumed:

| Fact | Source |
|---|---|
| Creator share 50% → 80%, keyed to LIFETIME GROSS EARNED (not VP, not plan) | `functions/coinLedger.js:169` `REVENUE_SHARE_RATES` / `shareForEarnings` |
| Tips take NOTHING at send time; the whole tip is gross revenue | `functions/index.js:3448` `sendTip` → `earnedGemCredit` |
| Memberships, event tickets, season passes, locked content, ad rewards and referral revenue all use the same ladder | `functions/coinLedger.js` `settleEarnedToGems` |
| The per-surface unlock fee is **0** | `functions/entitlements.js` `feePctFor()` returns 0 |
| Active Vanguard keep **100%** | `coinLedger.js:260` `vanguardExempt ? 1 : shareForEarnings` |

**~40 files, ~110 sentences rewritten**, in three passes: shared constants and the live tip surfaces,
then marketing + prerender metadata, then 68 phrase-level replacements across the help articles plus
5 stragglers. Then a second sweep caught "conversion commission" (the VP-keyed rate that no longer
exists) in 6 more published articles and on `/settings/ranks`.

⚠ **No client may compute or display what a creator receives.** The share depends on the
recipient's lifetime earnings, which the client does not know. Three surfaces were printing a
computed figure and are now fixed: `SendCoinsModal` ("They receive (after 10% fee)"),
`ViewerStreamScreen` and `MobileLiveViewer` ("Host receives {amount * 0.9}c"). `getMembershipStats`
in `firestore.js` no longer returns a fabricated `monthlyNet` (it was `gross * 0.9`); the Studio tile
shows gross and says so.

⚠ **`firestore.js` `sendCoins` only FORWARDS to the `sendTip` callable.** Its
`TIP_PLATFORM_FEE_PCT` was a dead client constant with a stale comment claiming a "HARD RULE" 10%
fee. Set to 0 and documented. `requestPayout` in the same file is DEAD (zero callers) but still
contains a client-side 10% + 3% payout calculation; left in place under the no-delete rule.

**Genuinely different, deliberately kept:** Vergr.me shop sales are a flat 8%, seller keeps 92%,
credited directly and bypassing the ladder (`functions/vergrMeShop.js:39` `SALE_FEE`, founder-locked
2026-07-17). Do not "correct" that to 50-80%.

⚠ **OPEN FOUNDER DECISION, unchanged:** Pro sellers used to pay 8% instead of 10% on unlocks. That
perk is dormant, not removed — `feePctFor()` returns 0 for everyone and the comment there explains
why inventing a replacement rate was not the session's call. The natural replacement is a one-tier
share bump for Pro in `shareForEarnings()`.

### G5. Tournaments and the growth funnel — CONTENT DELETED 2026-08-16 (founder-instructed)

Founder: *"tournaments are not supposed to exist, why do i need to continue saying this"*. The two
"decide: delete or leave dormant" items in this file are now DECIDED, and the answer is delete.

Tournaments were retired 2026-08-09 and unrouted, but the CONTENT stayed on disk, which is why it
kept resurfacing in sweeps and in sessions. Removed:

- **The whole `help/articles/tournaments/` category, 37 articles + index** (including
  `what-are-champion-picks-predictions-and-how-do-i-earn-from-them`, which described backing a
  player with Coins for a reward), plus its import and spread in `articles/index.js`.
- **7 more tournament articles hiding in other categories:** `how-do-i-earn-from-tournaments`,
  `what-is-the-gold-ring-on-some-avatars`, `how-does-vergr-keep-tournaments-fair`,
  `how-do-squad-champion-votes-work-for-tournaments`, `what-are-squad-rivalries`,
  `how-is-vergr-different-from-repeatgg-players-lounge-and-gamersaloon`,
  `is-skill-based-gaming-for-money-legal`. Each removed WITH its import and map entry.
- **`TOURNAMENT_RULES` in `legalContent.js`, 124 lines**, describing entry fees and cash prizes.
  It was exported and consumed by nothing.
- **The growth module, `src/screens/marketing/growth/`** (`growthContent.js` +
  `GrowthScreens.jsx`), its lazy exports in `marketingLazy.js`, its `AppRouter` imports and its
  prerender block. Its premise was dead three times over: tournament prize pools, 1v1 money
  matches with escrowed stakes, and USDC withdrawal.

**All of it was already unpublished**, which is why the article count stayed at 355 and the sitemap
at 420 across the rebuild. That is the check to run: if either number DROPS, a live article was
deleted by mistake.

**Dangling references fixed, which is where deletions actually bite:**
`PublicUgcScreens.jsx` linked at `/platform/make-money-gaming` and `/platform/legit` from a public
page; `prerenderHelp.mjs` had breadcrumb labels for `/platform/play/*`; and `firebase.json`
redirected `/platform/play` to a page that no longer existed.

**The three growth URLs now return 410, not 200.** They were prerendered and indexed BEFORE the
funnel was gated off, so leaving them to the SPA catch-all made them soft 404s. `/platform/play`,
`/platform/play/**`, `/platform/make-money-gaming` and `/platform/legit` were added to the
`goneHelp` rewrites (now 35 entries), and the `/platform/play` 301 was REMOVED because hosting
evaluates redirects BEFORE rewrites, so it would have shadowed the 410. Verified live: all four
410, `/platform`, `/platform/creators`, `/platform/help` still 200, VLink still served by `vlinkApp`.

### G6. Follow-up sweep: "tournament" was the WRONG WORD to search for

After G5 the built site had zero occurrences of "tournament", and that looked like done. It was not.
The retired product is described throughout the help centre in words that never say "tournament":
**match, prize, purse, referee, competitor, bracket, entry fee, spectator ticket, skill-based.**
Searching that vocabulary found 20 PUBLISHED articles still describing it.

**3 published articles REMOVED** (wholly about the dead product; all now 410, and each removed with
its category-index import, its map entry AND its `RAW` question row in `helpContent.jsx` — leaving
the RAW row behind would have relisted the article as an unwritten "Coming soon" entry):
`is-playing-games-for-money-on-vergr-gambling`, `how-does-vergr-detect-cheating`,
`how-does-vergr-verify-results-and-prevent-cheating`.

**`is-vergr-gambling` was deliberately KEPT and rewritten**, not deleted. It is the question an
underwriter or processor actually searches for, and the honest answer is now much stronger than the
old one. The old version answered "no" while describing entry-free competitions, prize purses and
"Champion Picks" predictions, which invited the question rather than closing it. The new answer is
that there is nothing to stake and nothing to win, matching `llms.txt` word for word.

**14 more published articles** had one-line incidental references (pooled prizes, brackets, "the full
creator and competitor toolkit", match-fixing, "skill-based competition for cash-equivalent prizes").
All rewritten.

**Dead CTAs are the real hazard when deleting articles.** 78 article files were removed across this
session; a link in a SURVIVING article to a removed slug becomes a 410 in the reader's face. Seven
were found and repointed. The check to run after any deletion:

```bash
git status --short | grep "^ D" | grep help/articles | sed 's|.*/\([^/]*\)\.jsx|\1|' \
  | grep -v index | while read s; do grep -rn "help/$s" src/; done
```

**The count check that proves nothing live was lost:** prerender printed 355 articles / 387 help URLs
before this sweep and 352 / 384 after, a drop of exactly the 3 published articles removed. The 75
earlier deletions moved neither number, which is what confirmed they were all unpublished. **If
either number drops by more than you deleted on purpose, stop and find out why.**

### G7. OPEN FOR THE FOUNDER: ticketed events are half-alive

Not a copy problem, so it was flagged rather than actioned. Found while checking whether the
"prize" articles described anything real:

- `functions/eventTickets.js` is **deployed** (`purchaseEventTicket`, `getEventTicketStatus`,
  `purchaseSeasonPass` are all exported from `index.js`). It has competitors, a host-set
  `purseSlicePct`, a `declaredPurse` prize pool, and stores events in a `tournaments` collection.
  It carries an explicit "LEGAL INVARIANT: a competitor can never buy a (prize-funding) ticket".
- `/e/:id` (`EventLandingScreen`) **is routed** and works logged-out as a share target.
- **But `CreateTournamentV2` is NOT mounted**, so there is no way to create one. The product is
  reachable-but-uncreatable.

This is the "ticketed pivot" from memory `project_geo_unblock` that unblocked 11 countries. It is
tournament-shaped, and the founder has said tournaments must not exist. **Decide:** retire the
backend and unroute `/e/:id`, or restore a creation surface. Do not let a third session rediscover it.

⚠ Note that `SquadEventsScreen` is a DIFFERENT and harmless thing: an RSVP calendar whose event
types happen to include a "Tournament" label. No money, no tickets, no purse. Leave it alone.

### G8. Tournament callables — 8 money-movers BLOCKED + DEPLOYED 2026-08-16

Removing a screen does not remove a Cloud Function. A Firebase `onCall` is invokable by any
signed-in client with the function name and a payload; it does not care whether a UI exists. So
"tournaments are unrouted" never meant "tournaments cannot happen": a user with a network tab could
still create a tournament, escrow coins into it and drive it to payout, with no VERGR screen
involved.

**Now blocked, verified live** (each returns `FAILED_PRECONDITION` "Tournaments have been retired"
to a raw POST, and rejects BEFORE auth, which proves the guard is the first statement):

| Callable | What it used to do |
|---|---|
| `createTournamentSecure` | created the tournament |
| `joinTournamentSecure` | **debited a wallet** (`balance: increment(-topUp)`, squad `treasury: increment(-fee)`) and grew `prizePool` |
| `startTournamentSecure` | seeded the bracket |
| `applyToTournamentSecure` | applied to an invite-only event |
| `joinBrawlQueue` | escrowed both sides of a 1v1 money match |
| `tipUnderdog` | moved coins |
| `contributeToSquadTournament` | squad treasury into a prize pool |
| `sponsorTournamentFromTreasury` | squad treasury into a prize pool |

**The split matters more than the list, and it mirrors `requestWithdrawal` exactly.** Blocked =
anything that starts a tournament or puts NEW money into one. **Deliberately LEFT LIVE = every
settle, refund and exit path**, so coins already escrowed in an in-flight tournament can still
complete or be returned instead of being stranded with no way out: `leaveTournamentSecure`,
`leaveBrawlQueue`, `finalizeTournamentSecure`, `reportMatchResultSecure`, `reportGameResultSecure`,
`resolveTournamentDispute`. All five verified still returning `UNAUTHENTICATED` (i.e. reachable),
not the retirement error.

Implementation: one `TOURNAMENTS_RETIRED()` throw as the first statement, bodies RETAINED, same as
`functions/withdrawals.js:280`. ⚠ `tournamentExtras.js` and `brawl.js` do not bind a bare
`HttpsError` the way `tournaments.js` does, so the guard there must use
`functions.https.HttpsError` or it raises a ReferenceError at call time instead of a clean error.
`node --check` does NOT catch that; the handlers were invoked directly to prove the error code.

**Deployed by NAME only** (`--only functions:a,functions:b,...`), never a wholesale functions
deploy, because the working tree carries the founder's uncommitted WIP across `functions/`. Of the
files touched, only `eventTickets.js` had WIP, and it was left alone (see G7).

⚠ **STILL OPEN:** `purchaseEventTicket` / `purchaseSeasonPass` are NOT guarded. They are the
ticketed-events product in G7, which is a separate founder decision, and `eventTickets.js` is the
one file here carrying uncommitted work (the revenue-share migration: surface fee to 0, host net
routed through `settleEarnedToGems`). Guarding them would retire a product without being asked and
would ship that WIP.

✅ **Checked and CORRECTED:** memory `project_tournaments_removed_web` claimed `placeMatchBet`,
`requestDoubleOrNothing` and `respondDoubleOrNothing` were left deployed after being cut from source.
They are **not** deployed: all three return HTTP 404, as does `settleMatchBets`. Nothing to delete.

✅ **CLOSED, founder 2026-08-16:** `settleMatchBets` is gone too, so coins in `picks` docs have no
settle path. It does not matter and no refund is needed: *"no one has purchased coins besides me for
testing"*. Do not write a refund script and do not raise this again.


### G4. Other stale figures found in passing (fixed where touched, NOT swept)

- Plan prices as **€4.99 / €9.99** or **$9.99 / $24.99**. `src/utils/tierSystem.js:31,50` charges
  **$4.99 / $9.99**. Fixed in the files above; not swept repo-wide.
- Coin packs as **€0.99 to €224.99** with a **€0.0090** floor. `vpSystem.js:325` is native USD,
  **$0.99 to $249.99**, floor **$0.0116**.
- Referral rewards stated backwards. `vpSystem.js:380`: referrer +5,000 VP, referee +3,000 VP.

## E. BACKEND — leave alone unless noted

- [x] `functions/withdrawals.js` body retained for the SCHEDULED creator-payout path. Correct as is.
- [ ] `functions/withdrawals.js` `KYC_LIMITS` still carries DAILY caps that nothing enforces. The
      real gate is `creatorPayouts.js:116` `KYC_MONTHLY_CAP_MICRO_USD` (€50 / €2,500 / €15,000 per
      MONTH, no daily cap). Remove when that file is retired at cutover.
- [ ] `functions/withdrawals.js` `PLATFORM_SPREAD_BPS = 200` is vestigial; dies with the flow.
- [x] `src/screens/admin/*` — admin tooling still processes in-flight items. Leave.

---

## FLAGGED — money-transmitter / licensing shaped

- [x] **ToS was self-contradicting.** §7 said gems are not stored value while §4A.5 asked the user to
      accept that "cryptocurrency-rail withdrawals are irreversible and you bear the entire risk of
      any incorrect destination address you select". That is a description of user-directed
      transmission in the binding document. FIXED.
- [x] **"skill-gaming winnings"** in the tax clause and "competitive activity in which you may lose
      money paid for in-Service items" in §4A.5 described a tournament product that no longer
      exists, and invite a gambling-licence question. FIXED.
- [x] **AML policy published withdrawal tier limits including DAILY caps the payout engine never
      enforced.** An overstated control is the document you get held to. Monthly figures were
      correct and kept; daily figures removed. FIXED.
- [x] **Tournament rules legal doc** — **DELETED 2026-08-16** (founder-decided). 124 lines of
      `TOURNAMENT_RULES` describing entry fees and cash prizes, exported and consumed by nothing.
      Verified: zero references to `TOURNAMENT_RULES` anywhere in `src/`.
- [x] **Tournaments help category** — **DELETED 2026-08-16** (founder-decided), 37 articles + index,
      including `what-are-champion-picks-predictions-and-how-do-i-earn-from-them`. Verified: directory
      gone, zero `*champion-picks*` files remain. See G5 for the 7 further tournament articles found
      hiding in other categories and the 3 PUBLISHED ones removed in the follow-up sweep.
