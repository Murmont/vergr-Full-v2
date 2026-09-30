# Payments, Play billing choice, boost coins and ads: everything still to do

Written 2026-09-26 from one long working session. Every fact below was checked against the
repo, a live system, or the vendor's own documentation on that date; the source is named next
to it. Anything that is **my proposal rather than a fact** is marked **(proposal)**. Anything that
needs the founder is marked **(founder)**.

Nothing in this document has been built unless it says **DONE**.

---

## 0. Where things stand right now (verified 2026-09-26)

| Area | State |
|---|---|
| Coda checkout on vergr.app | **LIVE.** `functions/checkout.js` (`createCheckout`, `getCheckoutStatus`, `getCoinPriceQuote`), orders in `checkout_orders`, poller inside `cron5Min`. Independent of PayRam. |
| Codashop fulfilment endpoint | **DEPLOYED** `codashopFulfilment` (`/validate`, `/topup`). Secret in `private_config/codashop`, portal holds the same key (hash-matched). Signature matches Coda's two published test vectors (guarded in `coda-pay-check`). |
| Codashop portal | Our URLs + key saved, Role ID false, Serverlist empty. Status **Under Review** (Coda verifies before the Test button appears). |
| AdMob policy fix | Delete the `settleEarnedShare` call in the ad path (4.2). Independent of boost coins; ship first. |
| Codapay portal | Notification + landing URLs saved on **all 86 merchant IDs, sandbox and production** ("86 Merchant ID configuration are successfully updated", twice). Production still shows **0/N methods** in every country. Overview checklist still says 2 pending. |
| Play Console alternative billing | **Started, not submitted.** Step 1 done (User choice billing: Pilot, India, South Korea; Alternative billing: EEA, United States; all Terms ticked by the founder). Step 2 "Confirm info" waiting on three certifications. Step 3 "Set up invoicing" not reached. |
| AdMob rewarded | Unit `ca-app-pub-4584066602378782/8267596734`, SSV callback set to `admobSsvCallback` (correct). `admob_rewards` collection has **0 documents ever**. |
| AdMob payments | Account is **AdSense (South Africa)**. Founder decision 2026-09-26: **keep it** (earnings follow the viewer's location, not the account's; a new US account would take weeks). |
| PayRam | Still deployed, hidden from buyers. To be removed once Coda is live. |

---

## 1. Finish the Google Play enrolment

### 1.1 Step 2 "Confirm info" **(founder)**
Three certifications, each a "Yes" box. Only the founder can make these statements:
1. Store listing contact details (email, website) are up to date.
2. The billing system complies with PCI-DSS **or does not handle card data**. True for us: Coda's hosted component collects card data inside Coda's own frame; our servers never see it.
3. A process exists for users to dispute unauthorized transactions. Filled: URL `https://vergr.app/platform/refunds` (the real Refund & Cancellation Policy page, checked by title).

Then Next.

### 1.2 Step 3 "Set up invoicing" **(founder + me)**
Not seen yet. I will fill everything that is not identity or banking and list the rest.

### 1.3 After submitting
- Check whether each **app** also needs its own enrolment or declaration (Google's pages describe developer-level enrolment and then "enroll your apps"; confirm on the page after submitting, do not assume).
- Store listing contact details: open Store settings and confirm the support email and website are current (certification 1 depends on it).

---

## 2. Coda inside the Play app (user choice billing)

### 2.1 What we are allowed to do (sources)
- **User choice billing** (the buyer sees Google Play and our checkout side by side, inside the app). Pilot markets: *"European Economic Area (EEA) countries, Australia, Brazil, Indonesia, Japan, South Africa, United Kingdom, United States"*, for non-gaming apps outside the EEA. Separate rows for India and South Korea. ([Google 12570971](https://support.google.com/googleplay/android-developer/answer/12570971?hl=en))
- **US policy:** Google *"will not prohibit a developer from communicating with users about the availability or pricing of an app outside the Google Play Store... or link to transactions"*. ([Google 15582165](https://support.google.com/googleplay/android-developer/answer/15582165?hl=en))
- **Pricing or bonus differences between the two options:** Google's program pages say **nothing either way**. The US policy page allows communicating pricing. Treat a bonus as allowed in the US, and **re-check the choice-screen rules for the other markets during the build** before showing a bonus there.

### 2.2 THE MONEY: fees are added on top, so we never net less than the web price

**Rule (founder): fees are always added on top of the price. Losing money is never an option.**
So the Coda price inside the app is the web price grossed up for Coda's method fee **and** Google's
service fee, rounded **up** to the cent. We always net at least the web price.

Fees, from Google's own table ([Google 16954621](https://support.google.com/googleplay/android-developer/answer/16954621?hl=en)):
- From **30 June 2026 in the US, UK and EEA**: Google Play Billing sale = **10% service fee (first $1M of earnings) + 5% billing fee**.
- A sale through our own billing (user choice / alternative billing) still pays the **10% service fee**; the billing fee does not apply.
- Rollout of the new model: Australia and Japan 30 Sep 2026, South Korea 31 Dec 2026, rest of world 30 Sep 2027. Until then, other pilot markets use the old rule: user choice billing = service fee **reduced by 4 percentage points** ([Google 13821247](https://support.google.com/googleplay/android-developer/answer/13821247?hl=en)).

Coda's cost per method is in `functions/codaMethods.js` (US card **4.0% + $0.25**, no tax; ZA card 5.5% + R4.30; DE card 2.6% + €0.23 with 19% VAT).

Formula (US, card): `CodaInAppPrice = ceil_cent( (web + 0.25) / (1 − 0.04 − 0.10) )`.

**United States, card, fees on top:**

| Pack | Web price | Coda price in app | We net | Play price | Buyer saves with Coda |
|---|---|---|---|---|---|
| Starter | 0.99 | 1.45 | 0.9970 | 1.09 | −0.36 |
| Gamer | 4.99 | 6.10 | 4.9960 | 5.99 | −0.11 |
| Pro | 9.99 | 11.91 | 9.9926 | 11.99 | +0.08 |
| Elite | 19.99 | 23.54 | 19.9944 | 22.99 | −0.55 |
| Legend | 49.99 | 58.42 | 49.9912 | 57.99 | −0.43 |
| Champion | 99.99 | 116.56 | 99.9916 | 119.99 | **+3.43** |
| Titan | 149.99 | 174.70 | 149.9920 | 179.99 | **+5.29** |
| Ascendant | 249.99 | 290.98 | 249.9928 | 299.99 | **+9.01** |

(Play prices from `docs/play/play-prices-by-market.csv`.)

**What this means:**
- We net the full web price on **every** pack, every time. No pack loses money.
- For the **buyer**, Coda is cheaper on Pro, Champion, Titan and Ascendant, and dearer on Starter, Gamer, Elite and Legend (the fixed $0.25 and Google's 10% weigh most on small packs).
- The reason to pick Coda on the dearer packs is the **boost coins / a free boost** bonus (section 4), which costs us $0. Show it on every Coda option ("+ free boost") so the choice is worth making on every pack.
- If you want **extra real coins** as well: every real coin can cost up to $0.008 when tipped (4.1), so the only money that can fund them is the buyer's saving we choose not to pass on. Never fund them from our net.
- **A generator script** must produce the full table (every pack, every pilot country, every Coda method, each market's tax rule) and a **guard must fail the build if any cell nets below the web price**. Never hand-compute a price.
- **India:** our Coda method table has **no methods for India**, so user choice billing there adds nothing until Coda enables India.

### 2.3 Which Play Billing Library API (verify before coding)
Our app uses `com.android.billingclient:billing:9.1.0` (`src-tauri/gen/android/app/build.gradle.kts:245`).
Release notes list three families ([Play Billing release notes](https://developer.android.com/google/play/billing/release-notes)):
- `enableUserChoiceBilling(UserChoiceBillingListener)` + `UserChoiceDetails.externalTransactionToken` (7.0+, the pilot API).
- `enableBillingProgram(...)`, `BillingProgram.EXTERNAL_PAYMENTS`, `enableDeveloperBillingOption` (8.2/8.3, external payments/links).
- `getBillingChoiceInfoAsync`, `showBillingProgramInformationDialog`, `ChoiceScreenType` (9.1, the new Billing Choice program).

**Before any code:** open each program we enrolled in and follow **its** integration guide. Do not mix families.
The user choice guide ([developer.android.com](https://developer.android.com/google/play/billing/alternative/alternative-billing-with-user-choice-in-app)) says Google Play renders the choice screen itself; when the buyer picks our option we receive `UserChoiceDetails` (products + `externalTransactionToken`) and must send the token to our backend.

⚠ Kotlin is pinned to 1.9.25 and we use the plain `billing` artifact, not `billing-ktx`, because the ktx variant ships Kotlin 2.x metadata (`build.gradle.kts:233-241`). Keep it that way.

### 2.4 Build plan (app + server) (proposal)
1. `BillingBridge.kt`: enable the chosen program; on the buyer choosing our option, hand `{products, externalTransactionToken}` to the web layer.
2. Web layer: open the existing in-basket Coda checkout (`src/components/wallet/CodaPay.jsx`) with the token attached. No redirect to the browser is needed.
3. `createCheckout` stores the token on the `checkout_orders` doc (`playExternalToken`, `playCountry`).
4. Settlement reports the sale to Google (section 2.5).
5. Eligibility comes from **Play's country** (`getBillingConfigAsync`), never from `users.geoCountry`: Google decides eligibility by the Play account's country.
6. Guard: store bundle scan still proves the card/crypto row is absent outside eligible flows.

### 2.5 Reporting each sale to Google (mandatory)
- *"you must report the transaction to Google Play by calling the Google Play Developer API from your backend within 24 hours"* (user choice guide).
- Endpoint: `POST https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.vergr.desktop/externalTransactions?externalTransactionId=<id>`; body `originalPreTaxAmount {currency, priceMicros}`, `originalTaxAmount`, `transactionTime`, `oneTimeTransaction.externalTransactionToken`, `userTaxAddress.regionCode`; scope `androidpublisher` ([API reference](https://developers.google.com/android-publisher/api-ref/rest/v3/externaltransactions/createexternaltransaction)).
- `externalTransactionId`: our order id (`coda_...`, 1-63 chars `[a-zA-Z0-9_-]`, already valid).
- Where: after `settleOrder` credits a `checkout_orders` row that carries a `playExternalToken`. Idempotent (the id makes a retry safe). A failed report is retried by the existing `pollCheckoutOrders` job until reported; a row that cannot be reported within 20h raises an admin alert.
- **Permission:** the service account used by `redeemPlayPurchase` (`vergr-44494@appspot`) has View financial data + Manage orders. Confirm the endpoint accepts it with a dry call before launch; the Play Developer API refused non-Admin accounts for product creation on 2026-09-11 (CLAUDE.md), so test, do not assume.
- Fees: *"report transactions and pay the relevant service fees starting on October 1, 2026"* ([Google 15582165](https://support.google.com/googleplay/android-developer/answer/15582165?hl=en)). Budget the 10% in every price (2.2).

---

## 3. Countries outside Google's programs

Google's Payments policy: *"Within an app, developers may not lead users to a payment method other than Google Play's billing system unless Section 3, 8, or 9 of Payments policy applies."* And: *"Outside of your app, you are free to communicate with your users about alternative purchase options. You can use email marketing and other channels outside of the app to provide subscription offers and even special pricing."* ([Google 10281818](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en))

So, for those countries:
- **No banner, button or link inside the Play app.** Doing it anyway risks the listing.
- **Coda stays on vergr.app**, where there is no Google fee at all. Coins bought there land in the same wallet.
- Tell users **outside the app**: email, socials, the website, vergr.me. "Cheaper on vergr.app" is allowed there.
- The website itself is the one channel where "cheaper with Coda plus a bonus" is always true and costs Google nothing.

---

## 4. Watch 3 ads, get boost coins (founder spec, 2026-09-26) — ✅ BUILT + DEPLOYED 2026-09-27 (card needs next APK; record in UPDATE_LOG)

**Scope, exactly as the founder set it. Nothing is rebuilt from scratch:**
- The **existing** Watch-to-earn card and its button that opens an AdMob **rewarded** ad (`src/components/WatchToEarnQuest.jsx` → `RewardedCoinQuest`, `src/utils/admob.js` `showRewardedForCoins`, server `functions/admobReward.js` `admobSsvCallback`). The ad type is already chosen and wired. It stays.
- **Add a counter**: 1 of 3, 2 of 3, 3 of 3.
- **After the 3rd ad, reward coins that can only be spent on boosts** (and VP packs). **Never on tips or gifts**, or anything that pays a creator.
- **No bonus gifts.** Out of scope.

### 4.1 Why boost-only (the maths behind the founder's rule)
- A normal coin is worth $0.01 at payout (`COIN_MICRO_USD = 10_000`, `coinLedger.js:228`), and a creator keeps 50-80% (`REVENUE_SHARE_RATES`, `coinLedger.js:163`), so a tipped coin can cost up to $0.008. That is why the current reward is only 2 coins.
- A coin that can only buy a boost or a VP pack costs us **$0** (Vergr provides both itself), so the reward can be large enough to matter.

### 4.2 AdMob rules that apply ([AdMob 7313578](https://support.google.com/admob/answer/7313578?hl=en))
- Rewarded ads paying in-app coins are allowed (Google: users *"watch videos to earn in-app rewards, such as coins"*).
- *"require users to watch a fixed number of Rewarded Ads to obtain a reward, such details must be clearly disclosed"* → the card says "Watch 3 ads to get 75 boost coins" before the first ad, and each step shows "Ad 2 of 3".
- No "support us" wording near the button.
- One line to delete: `admobReward.js:240-248` calls `settleEarnedShare`, which turns an approved creator's ad coins into cash owed. Boost-only coins remove it anyway.

### 4.3 What changes (small)
| Piece | Change |
|---|---|
| Wallet | new server-only field `boostCoins` (spendable on boosts + VP packs only), and `adProgress {day, watched, rewardsToday}` |
| `admobSsvCallback` | per verified view: `watched += 1` (inside the transaction it already runs, which already reads the user and writes the wallet). On the 3rd: `boostCoins += 75`, reset `watched`, `rewardsToday += 1`. Cap reached → no credit, still answer 200. Stop crediting normal coins and remove the `settleEarnedShare` call. |
| Spend | `purchaseBoostPack`, `applyBoost`, `purchaseBoost`, `boostStream`, `requestStreamQualityBoost`, `purchaseVpBonus` take `boostCoins` first, then normal coins. **Nothing else reads `boostCoins`** (guard fails the build otherwise). |
| Rules | `boostCoins` and `adProgress` added to the server-only list for `wallets` in `firestore.rules` |
| Country | the handler already reads `users/{uid}`, so `geoCountry` is checked for free against `app_config/general.adRewardCountries`; the card is hidden outside the list |
| Config | `adAdsPerReward` (3), `adRewardBoostCoins` (75), `adRewardsPerDay` (3), `adRewardCountries` in `app_config/general`; each needs a reader or `admin-config-check` fails |

Numbers 75 and 3/day are **proposals**; 3 ads per reward is the founder's.

### 4.4 The counter (hype-train quality)
Same visual language as `HypeTrainView` (`src/components/streams/states/index.jsx:852`): `vg-material vg-grain` card, a step pill ("1 of 3" → "READY"), a track in **three segments** filling heat-to-gold with the same glow and 340ms ease, the reward on the right ("75 boost coins"), the disclosure line under it, a short celebration on the 3rd. States: loading ad, no ad available right now, done for today (reset time). Progress reads `wallets/{uid}.adProgress`, which UserContext already listens to (zero extra reads). Solid fills only.

### 4.5 Country list
Start (proposal): US, CA, GB, IE, AU, NZ, DE, AT, CH, NL, BE, FR, DK, SE, NO, FI, JP, KR, AE, SA, QA, KW. Replace with our own AdMob earnings by country once real views exist (AdMob API is OAuth-only; one consent, token stored in `private_config`, pulled weekly inside the existing `cronDaily`).

### 4.6 Earning more per view (later, proposal)
AdMob bidding partners (Meta Audience Network, AppLovin, Liftoff, Mintegral, Pangle) compete for each view; each needs its own account (founder) and an adapter in the app build. `app-ads.txt` is already published.

### 4.7 AdMob account: kept in South Africa (founder decision)
Check once: AdMob → Payments → tax info has a **W-8BEN with the US–South Africa treaty claimed**; without valid tax info Google can withhold up to 24-30% of US-viewer earnings ([Google](https://support.google.com/paymentscenter/answer/10349995?hl=en)).

### 4.8 Where it ships
Server part deploys immediately. The card with the counter reaches phones with the next app build (rewarded ads only run in the app).

## 5. Coda and Codashop: what is left

### 5.1 Codashop
1. **Coda's review of our API** (status Under Review). When it reads Verified, run the portal **Test** with user id `vergr` and SKU `coins_starter`. Test orders now credit a real account **nothing** (`test_no_credit`), only a staff account gets coins (deployed today, emulator 65/65).
2. **Content details** (Codashop task list). Field rules from Coda's docs:
   - Tile image 178 × 178 px, JPG/PNG, under 25 KB, **no rounded corners**
   - Banner 640 × 241 px, JPG/PNG, under 100 KB
   - Links: Google Play, website (full URLs)
   - User ID input: validation type "User ID"; field name e.g. "Vergr @username"
   - Helper image (JPG/PNG under 150 KB or GIF under 1 MB) showing where the @username is
   - Helper text: one sentence, Latin characters
   - Title description: up to 4,000 characters
   - Important note: up to 1,000 characters (recommended)
   I prepare all of it, you approve before anything is submitted.
3. ✅ **DONE 2026-09-28, saved as drafts, verified** (see UPDATE_LOG; generator `scripts/codashop/pricing.mjs`,
   tax from Coda's own fee endpoint, never assumed). **SKU prices (26 drafts):** Codashop takes **15% of the tax-inclusive price** and Coda remits VAT. For us to net the web price W in a market with VAT rate t: **P ≥ W ÷ (1/(1+t) − 0.15)**, rounded up. US (t = 0): Starter 0.99 → **$1.17**. A generator produces every SKU × country; a guard fails on any cell netting below W. Nothing is published before you approve.
4. **Push to production** after tests pass.

### 5.2 Codapay (our checkout)
Coda's own checklist ([Integration Checklist](https://docs.coda.co/codapay/integration-guides/integration-checklist.md)):
1. Account status **Testing → Active** (Coda).
2. **E-Annex** approval of payment channels (Coda). Until then every production country shows 0 methods.
3. Tell the Codapay team four things. Draft, to be sent only with your yes (through the portal's Support section if it has a form):
   > Vergr (merchant ids 765075–765160). Request currency: **local currency**. payType: **a specific channel id per request** (we list methods ourselves). We use **InquiryPaymentResult** for every order and also accept your notification at https://sfu.vergr.app/payouts/coda/notify. Integration: **Coda Hosted Component embedded in our website** (desktop and mobile browsers). Please activate production and advise on E-Annex.
4. Production test with Coda (they ask for a website URL, a login and the lowest denomination).
5. **US card (payType 1006)** is still refused in sandbox (code 203): ask in the same message.
6. ✅ DONE 2026-09-28. The Overview checklist needed EVERY transaction URL filled, including "Subscription notification URL", which had been left blank on all 86 merchants. Read from the portal's own code; now reads Setup complete.

### 5.3 PayRam removal (after Coda production works)
Delete `functions/payram.js`, its four exports in `index.js`, the `payram_orders` entry in `SETTLE_COLLECTIONS` and `payram` in `RAIL_LABELS` (`functions/orders.js`), the hidden client path (`src/screens/wallet/v2/buyCheckout.js`, PayRam helpers in `firestore.js`), the two `PAYRAM_*` secrets (**destroy** the versions; disabled versions still bill). `circleWallets.js` reads `payram_orders` for crypto deposits: decide its fate at the same time.

---

## 6. Other open items from this session

| Item | Owner |
|---|---|
| Play 1.0.218: Alpha + Production in review. Publish only when you say. | founder |
| 17 existing accounts get their country on next visit (the log backfill was unreliable and was not written). | automatic |
| Google for Startups **Cloud program**: up to **$2,000** credits without equity funding, and they cover **Firebase** ([Google](https://cloud.google.com/startup)). The North America Accelerator needs AI/ML + 5 employees: not a fit. Apply (free). | founder yes → me |
| Downloads: Refer & Earn push outside the app; Play custom store listings and store listing experiments (free); promotional content once Play allows it. | both |

---

## 7. Google Play payout profile (state 2026-09-26 late)

**CURRENT STATE, 2026-09-26 late (supersedes every other line here):** the founder switched the Primary payout bank on 9952-6439-2583 BACK to Murmont's Relay ••852, and the "urgent issue" notification then disappeared. Identity = Vergr LLC (6074-7047-6716). Payout profile = Murmont LLC 9952-6439-2583, bound to D-U-N-S 109915832, US tax info empty. **Researched to Google's own text, both founder options are closed:** (1) renaming 9952 to Vergr LLC is impossible, because its "Change name" is bound to Murmont's D-U-N-S and Google says the D-U-N-S "can't [be updated] on an existing payments profile" (16260648), while an organisation's payments-profile name "must match" its D&B profile (13634888); renaming Murmont's D&B record to Vergr would be a false record. (2) Linking 6074 as the payout profile is impossible: "You can link a Play Console and payments profile only once. After they're linked, they can't be unlinked or changed" (3092739). Google's only stated remedy is a new developer account + fee + app transfer. **Never re-propose either, support tickets, or ownership transfer (identity only, 16909862).**

## 8. Decisions needed (founder)

1. Reward: 75 boost coins per 3 ads, 3 rewards a day. **Confirm or change.**
2. Minimum ad earnings for a country to get Watch-to-earn: $5 per 1,000 views. **Confirm or change.**
3. Coda option inside the Play app: show a free boost on every Coda option (costs $0)? Extra real coins too (only from buyer savings we do not pass on, 2.2)?
4. Send the Codapay message (5.2.3)?
6. Enrol for the 15% service fee (7.3)?
7. Apply for the $2,000 Cloud credits?

## 9. Order of work (proposal)
1. Founder: Play enrolment steps 2-3; the urgent payments alert text; AdMob W-8BEN check; decisions in section 8.
2. Server: boost coins + ad counter (section 4.3), guards, emulator tests. Deploy.
3. Server: Play external transaction reporting + price generator for Coda in-app + guards.
4. App: billing program integration, the counter card, bidding adapters. **One build**, then the store-bundle scan.
5. Coda: message, production test, Codashop content + SKU prices, push to production.
6. Remove PayRam.
