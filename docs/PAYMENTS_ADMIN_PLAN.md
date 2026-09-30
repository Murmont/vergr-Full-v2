# Payments admin + transaction records + email: plan

Status: **BUILT (phases 1-5 + email §6), 2026-09-29/30.** See §11 for exactly what shipped
and where; the Kotlin app must copy §11, not re-derive it. Written 2026-09-29 after a real Google Play purchase by a new user
(@faisalbahri) failed server verification twice ("400 Invalid Value") and the only way anyone found
out was a session reading Cloud Run logs by chance. Founder: *"I want even more details, error codes,
who purchased, who tried, think Shopify level and further, transaction level detail … and greater
control within admin, so that I don't need to come to you in a rush if a transaction goes wrong."*

Read with: `CLAUDE.md` → "CLOUD COST RULES" (no new Cloud Functions or schedules without a yes).

---

## 1. What exists today (read from the code, 2026-09-29)

| Route | Client entry | Server | Record kept today |
|---|---|---|---|
| Google Play coins / items | `src/utils/nativeBilling.js` `buyCoinPack`, `buyWithChoice`, `restorePurchases` | `redeemPlayPurchase` (`functions/playBilling.js`) | `play_purchases/{token}` **only on success**; failures only in Cloud Run logs |
| Google Play subscriptions | `nativeBilling.js` `buySubscription`, `restoreSubscriptions` | `redeemPlaySubscription` | user doc fields only |
| AppGallery | same file, Huawei branch | `redeemHuaweiPurchase`, `redeemHuaweiSubscription` | `huawei_purchases` on success |
| Coda web + Coda in the Play app | `src/screens/wallet/v2/buyCheckout.js`, `src/components/wallet/CodaPay.jsx` | `createCheckout`, `getCheckoutStatus`, `pollCheckoutOrders` (cron5Min), `settleOrder` (`orders.js`) | `checkout_orders/{orderId}` (awaiting / settled / expired) |
| Codashop | Codashop's storefront | `codashopFulfilment` | `checkout_orders` |
| Coin spends (boosts, VP packs, coin subscriptions) | many screens | `purchaseBoostPack`, `purchaseVpBonus`, `subscribeWithCoins` | `transactions` ledger (already shown in Admin → Economy → Transactions) |

**Gaps found:**
1. A failed purchase check leaves **no record** anywhere an admin can see.
2. Nothing on the phone reports an attempt that never reaches the server (sheet cancelled, "product not
   loaded", pending cash payment, Play error codes).
3. **Refunds and chargebacks from Google are never read.** Nothing calls `purchases.voidedpurchases`,
   so a buyer refunded by Google keeps the coins.
4. `redeemPlayPurchase` used only `purchases/products` (v1). One-time products set up with the newer
   purchase-option model need `purchases/productsv2` (fallback added 2026-09-29, logs order/test state).
5. Admin has **no per-transaction view and no actions** beyond Grant / Deduct.

## 2. What the providers give us (researched, not assumed)

**Google Play Developer API v3** (`https://androidpublisher.googleapis.com/$discovery/rest?version=v3`):
- `orders.get(orderId)` → `Order`: `state` (PENDING, PROCESSED, CANCELED, PENDING_REFUND,
  PARTIALLY_REFUNDED, REFUNDED), `total`, `tax`, **`developerRevenueInBuyerCurrency`**, `lineItems[]`
  (`productId`, `productTitle`, `listingPrice`, `tax`, `total`, `oneTimePurchaseDetails.quantity`),
  `buyerAddress` (country, state, postcode), `salesChannel`, `pointsDetails` (Play Points used),
  `orderHistory` (processed / cancellation / refund events; **`refundReason` includes CHARGEBACK**),
  `createTime`, `lastEventTime`.
- `orders.refund(orderId, revoke)`: refunds, and with `revoke=true` removes the item on the device.
- `purchases.products.get` (v1) and `purchases.productsv2.getproductpurchasev2` (token only; returns
  `productLineItem[]`, `purchaseStateContext`, `testPurchaseContext`, `acknowledgementState`).
- `purchases.voidedpurchases.list`: every refunded / charged-back / revoked purchase, with reason.
- The service account `vergr-44494@appspot.gserviceaccount.com` already has "View financial data" and
  "Manage orders and subscriptions", which `orders.get` and `orders.refund` require.

**Coda:** `coda/inquiry` through our relay (`functions/checkout.js:255`, `countryNumeric` + `txnId`)
returns the order's live state. Coda refunds are done in the Coda portal (no API used today).

**Email: Spacemail** (already configured: `SMTP_USER` is a vergr.app mailbox, `SMTP_PASS` is set).
Sending limits, [Spaceship knowledgebase](https://www.spaceship.com/knowledgebase/spacemail-email-limits/):
**500/hour/mailbox on a paid plan, 20/hour on a trial**, shared across aliases, 50 recipients per email.

## 3. The transaction record

One document per attempt: **`payment_attempts/{attemptId}`**. Server-written fields are
server-only in `firestore.rules`; the phone may only CREATE its own attempt and APPEND client events.

| Group | Fields |
|---|---|
| Identity | `attemptId`, `route` (google_play, google_play_sub, appgallery, coda_web, coda_in_app, codashop), `status` |
| Buyer | `uid`, `username`, `accountCreatedAt`, `country` (users.geoCountry), `device`, `appVersion`, `platform`. Email looked up from Firebase Auth only when an admin opens the record (users/{uid} is public, never copy it there) |
| What | `productId`, `productTitle`, `quantity`, `coinsPromised`, `vpPromised`, `items[]` |
| Money (from the provider, never our catalogue) | `currency`, `total`, `tax`, `developerRevenue`, `pointsUsed`, `buyerRegion` |
| Provider refs | `googleOrderId` (GPA.…), `tokenHash` (sha256 prefix; the raw token is kept in a server-only field only while needed to re-check or refund), `codaOrderId`, `codaTxnId`, `huaweiOrderId` |
| Outcome | `coinsCredited`, `vpCredited`, `creditedAt`, `consumed`, `refundedAt`, `refundReason` |
| Error (latest) | `error.code` (ours), `error.provider` (google/coda/huawei), `error.providerCode`, `error.httpStatus`, `error.message` (provider text, trimmed) |
| Admin | `needsAttention` (bool, indexed), `attentionReason`, `resolvedBy`, `resolvedAt`, `notes[]` |
| Timeline | `events[]`, each `{ at, source: client/server/admin/provider, type, detail }` |

**Statuses:** `started` → `sheet_open` → `pending` (cash) → `paid` → `credited`, or
`cancelled` / `failed` / `refunded` / `charged_back` / `resolved`.

**Event types (timeline):** `attempt_started`, `sheet_opened`, `sheet_cancelled`, `sheet_error`
(Play `BillingResponseCode` name + debug message), `product_not_loaded`, `payment_pending`,
`purchase_returned`, `server_check_started`, `provider_answer` (HTTP status + provider code),
`credited`, `consumed`, `credit_failed`, `restore_retry`, `refund_detected`, `chargeback_detected`,
`coins_revoked`, `admin_recheck`, `admin_credit`, `admin_refund`, `admin_note`, `resolved`.

**`needsAttention` is set when:** a server check fails; money is `paid` but not `credited` after 10
minutes; a Coda order is still awaiting after 30 minutes; a Play purchase is unconsumed with less than
48h left of Google's 3-day window; a refund or chargeback arrives for coins that were already spent.

## 4. Where it hooks in (no new Cloud Functions, no new schedules)

**Server** (existing functions only):
- `redeemPlayPurchase`, `redeemPlaySubscription`, `redeemHuaweiPurchase`, `redeemHuaweiSubscription`:
  write/update the attempt on every outcome, including every error path, with the provider's answer.
  On success also call `orders.get` once and store total/tax/revenue/region (one API call, no cost).
- `createCheckout`, `settleOrder`, `pollCheckoutOrders`, `codashopFulfilment`: mirror Coda order
  state into the attempt (the Coda order id links them).
- **Refund/chargeback sync inside the existing `cronDaily`:** `voidedpurchases.list` since the last
  run → mark the attempt `refunded` / `charged_back`, remove the coins that are still unspent, flag
  `needsAttention` if they were already spent.
- **Admin actions** go into the EXISTING `adminListTransactions` callable as an `op` switch
  (list / get / recheck / credit / refund / revoke / note / resolve), behind `requireAdmin` +
  `requireFreshStepUp` (2FA) and written to `admin_actions`, the same as the other money actions.
- **Alert:** on `needsAttention` becoming true, write a `notifications` doc to staff accounts
  (existing push path). One write per incident.

**Client:**
- `src/utils/nativeBilling.js` (every Play and AppGallery purchase and restore passes through it) and
  `buyCheckout.js` / `CodaPay.jsx` create the attempt (Firestore create, allowed by rules for the owner)
  and pass `attemptId` to the server calls. Play `BillingResponseCode` values are reported by name.
- Web ships on the next hosting deploy. The Play app needs the next AAB (`BillingBridge.kt` must pass
  the response code and debug message through to JS, which it currently drops).

## 5. Admin → Economy → **Payments** (new tab, beside Transactions)

- **Needs attention** strip at the top, with count and oldest-first list, and a countdown to Google's
  auto-refund where relevant.
- **Today / 7 days per route:** attempts, paid, credited, failed, refunded, charged back, gross,
  your revenue (Google's `developerRevenueInBuyerCurrency`, Coda net).
- **List** with search (username, uid, Google order id, Coda order id, product) and filters (route,
  status, country, date range), 50 per page, CSV export of the filtered set.
- **Transaction page (Shopify-style):**
  - header: status pill, amount, route, product, times
  - **Timeline** with every event, source and detail, error codes in full
  - **Buyer panel:** username (links to Admin → Users), account age, country, email (fetched from
    Auth on open), wallet balance, their other attempts (success/failure counts), open reports
  - **Provider panel:** live `orders.get` / Coda inquiry fetched when you press "Refresh from Google"
  - **Actions:** Re-check with provider (credits automatically if genuinely paid) · Credit manually
    (reason required) · Refund via Google Play (with or without revoking coins) · Remove coins ·
    Add note · Mark resolved. Every action asks for 2FA and is audited.

## 6. Email

The code-based verification already runs on Spacemail from a vergr.app mailbox, but
`EmailVerificationScreen.jsx` makes it **always skippable**. Proposed:
1. **Verification required** for email/password sign-ups before the account can post, message or buy
   (Google/Apple sign-ins are already verified by the provider). The app stays browsable while
   unverified, so nobody is locked out of reading.
2. **Reject addresses that cannot receive mail** at sign-up: the server checks the domain has MX
   records (`dns.resolveMx`, free) and refuses known disposable-mail domains (a list shipped in
   `functions/`). Typos like `gmial.com` get a "did you mean gmail.com?".
3. **Receipts:** a branded receipt email per credited purchase and per refund, from the same SMTP
   (same template system as the verification email). ⚠ If the Spacemail mailbox is on a **trial**,
   the 20/hour limit covers sign-up codes but not receipts at any volume: confirm the plan first.
4. **Admin alerts by email** (optional) to support@vergr.app for `needsAttention`, rate-limited.
Founder asked about a separate free domain + email: **not needed**, the vergr.app Spacemail mailbox
already sends, and a different sending domain would hurt deliverability and look like phishing.

## 7. Cost (under the CLOUD COST RULES)

- **No new Cloud Functions, no new Cloud Scheduler jobs.**
- Firestore: about **2 to 4 writes per purchase attempt** plus one per admin action; reads only when
  the Payments tab is opened (paged, 50 per page) and one aggregate count per summary tile.
  `needsAttention`, `status`, `route`, `uid`, `googleOrderId`, `codaOrderId` get single-field indexes
  (Enterprise edition bills unindexed scans).
- Google / Coda API calls: free.
- Email: inside the Spacemail plan's limits (see §6).

## 8. Build order

1. Server: `payment_attempts` writer module + rules + indexes; hook `redeemPlayPurchase` first (the
   route that just failed), then the other redeem functions and Coda.
2. Admin Payments tab: list + needs-attention + transaction page (read-only).
3. Admin actions (re-check, credit, refund, revoke, note, resolve) with 2FA + audit.
4. Refund/chargeback sync in `cronDaily`.
5. Client attempt events (web now; Play app with the next AAB, including `BillingBridge.kt` codes).
6. Email: mandatory verification + MX/disposable checks, then receipts.
7. Verify end to end with a **license-test Play purchase** (free, founder's account) and a Coda
   sandbox purchase: each must appear with a full timeline, and every action must work on it.

## 9. Founder decisions (2026-09-29)

1. **Spacemail is PAID** (500/hour/mailbox). Receipts and verification both fit.
2. **Unverified email accounts cannot buy, post or message.** Verification becomes **one tap**: the email
   carries a "Verify my email" button linking to `vergr.app/verify-email?t=<signed token>`, which opens the
   app through App Links on a phone and the site on desktop, and confirms through the EXISTING
   `verifyEmailCode` callable (token instead of code). The 6-digit code stays as the fallback. No new
   function.
3. **Refunds and chargebacks on credited coins (DECIDED):** remove the unspent coins; if already spent,
   the wallet goes **negative** (the next purchase repays it first; no tipping or spending until it is
   back to zero); **flag** the account; **block the account from buying coins** for a period (temp ban,
   length set in admin, default 90 days; an admin can lift or extend it); and **notify every creator
   who received tips from those coins, naming the user**, so the creator knows the tip was reversed.
   Wording is FACTUAL, never "fraud": *"@user's 500-coin tip to you was reversed: they charged the
   payment back with their bank."* (refund variant: "…they were refunded by Google Play."). A chargeback
   can be the real card owner, so Vergr's own message states only what happened. Founder: creator
   call-outs aimed at the charged-back user are not treated as harassment by moderation.
   Why this happens at all: Google refunds without asking us (buyer refund requests, often auto-approved
   within 48h; bank chargebacks; Google's own fraud cancellations), and a buyer who tipped the coins
   first leaves Vergr owing the creator's revenue share on money it never kept.

## 10. Lean write model (founder asked for the cheapest way, 2026-09-29) — SUPERSEDES §3/§7 counts

- **No separate record for a successful purchase.** The detail goes into the record that is ALREADY
  written on success (`play_purchases/{token}`, `huawei_purchases`, `checkout_orders/{orderId}`), in the
  same write: **0 extra writes per success.**
- **`payment_attempts` holds only failures and abandoned attempts** (server check failed, sheet error,
  cancelled after opening, pending that never completed): **1 write per incident.** The phone keeps a
  successful attempt's client events in memory and only sends them when the attempt fails.
- **Provider details (Google `orders.get`, Coda inquiry) are fetched when an admin opens the
  transaction**, not stored up front. API calls are free.
- The Payments list reads both: success records and incident records, merged by time, paged.
- Why not the Hetzner box: it is not backed up, and financial records must not be lost.
- Added usage, stated plainly: 0 extra writes per successful purchase, 1 write per failed or abandoned
  attempt, 1 per admin action. Firestore quotas are shared by the whole app, so this is never described
  as "free".

## 11. What was built (2026-09-29) — the reference for the Kotlin app

**Server (all DEPLOYED; no new Cloud Function, no new schedule):**

| File | Role |
|---|---|
| `functions/paymentRecords.js` | THE recorder. `recordIncident()` (one doc per purchase in `payment_attempts`, id = `route_` + sha256(token or order id)[0..24], retries append to `events[]`), `markCredited()` (closes an incident on a later success, blind update, no read), `classify()` (status + whether it needs attention), `describeError()` (our code, provider, provider HTTP status, provider message, provider API), `providerError()` (attach the provider's answer to a thrown error), `recorded(route, keyOf, handler)` (wrap a purchase callable), `alertStaff()` (push to `users.staff`, ONCE per incident, type `payment_attention`). Never throws. |
| `functions/playBilling.js` | `redeemPlayPurchase` / `redeemPlaySubscription` are thin wrappers over `redeemPlay` / `redeemPlaySub`, which set `stage.at` (validate, ledger_check, provider_check, purchase_state, account_check, credit / acknowledge, apply_plan). Google's answers carry their status + message. `purchases.products.get` falls back to `productsv2` on 400 and checks the product id is in Google's line items. Success ledger rows carry `route`. |
| `functions/huaweiBilling.js` | Both redeem callables wrapped in `PR.recorded`. |
| `functions/checkout.js` | Coda: records create failures, declined payments, abandoned checkouts, paid-but-not-credited, and in-app sales not reported to Google after 20h (once). `codaGate` refuses a buyer whose `purchaseBanUntil` is in the future (no extra read). |
| `functions/paymentAdmin.js` | Admin ops behind `adminListTransactions({ op })`: reads `summary`, `list` (views attention / incidents / google_play / appgallery / coda; search @username, uid, GPA.…, coda_…), `get` (record + buyer panel + Auth email), `provider` (live Google `orders.get` or Coda inquiry). Writes (2FA step-up + rate limit + audit): `recheck` (runs the SAME redeemPlay with the buyer's uid, or Coda inquiry + settle), `credit`, `removeCoins` (may go negative), `refund` (Google `orders.refund`, optional revoke), `note`, `resolve`, `purchaseBan` (days; 0 lifts), `syncRefunds`. |
| `functions/paymentRefunds.js` | `syncVoidedPurchases()` in `cronDaily` (+ the "Check Google refunds now" button): reads Google's voided purchases (30-day window, idempotent via `payment_voided/{orderId}`), takes the coins back (wallet may go negative), and when coins were spent or the reason is fraud / friendly fraud / chargeback: blocks buying 90 days, notifies every creator tipped from those coins (`tip_reversed`, factual wording), flags it. Refunds we issued (source developer) are not penalised. |
| `functions/adminEconomy.js` | `adminListTransactions` runs as the appspot account (Play API access) and routes `op` to paymentAdmin; `grantCurrency` gained `allowNegative`. |
| `functions/index.js` | `tip_reversed`, `payment_attention` on the push allowlist; `syncVoidedPurchases` in `cronDaily`. |

**Data:** `payment_attempts` (incidents + client attempts), `payment_voided` (seen voided orders),
`payment_system/play_voided` (last run). Success records stay where they were (`play_purchases`,
`huawei_purchases`, `checkout_orders`). 16 indexes in `firestore.indexes.json`.
`users.purchaseBanUntil` / `purchaseBanReason` are server-only (`lockedUserFields`).

**Rules:** a signed-in non-guest may CREATE `payment_attempts/client_<uid>_<ms>` with fixed fields,
status cancelled / pending / failed, `needsAttention == false`, and never read or change any record.
Tested: `tests/rules/paymentAttempts.mjs` (15/15, with controls).

**Client:** `src/utils/paymentAttempts.js` `recordClientAttempt()` (fire-and-forget, names Google's
BillingResponseCode), called from the three buy paths in `src/utils/nativeBilling.js`.
`BillingBridge.kt` now passes Google's numeric `playCode` in every `emitError` (compile-verified;
ships with the next AAB).

**Admin UI:** `src/screens/admin/AdminPaymentsTab.jsx` (Admin → Economy → Payments): KPI tiles,
views, search, route/status filters, CSV export, transaction drawer (facts, buyer panel, provider
panel, timeline, actions). Ships in Vergr Admin 1.0.226.

**Email (§6), built 2026-09-30, founder: EVERY account is asked, existing ones included:**
- Verified = Firebase Auth's own `emailVerified` flag, read off the ID token (`email_verified`) by
  `firestore.rules` (`emailVerifiedToken()` in `canPublish()` + polls, stories, statuses, DM and squad
  messages), the chat relay (`Peer.emailOK`, reject `verify-email`) and Coda/PayRam checkout. No reads.
- `functions/emailVerification.js`: one-tap link `vergr.app/verify-email?u=&t=` (24h) + 6-digit code
  (10 min); `sendEmailVerificationCode({newEmail})` changes the address after a fresh password sign-in;
  `verifyEmailCode({op:'check'})` is the pre-sign-up address check. The link path never returns an email.
- `functions/emailAddressCheck.js`: shape, typo suggestions, throwaway domains, MX (fails open on DNS trouble).
- `functions/receipts.js`: receipt per credited Coda/Codashop/PayRam order (`settleOrder`) and Play
  coin/item purchase; refund notice from the nightly refund sync. No receipt for Play subscriptions
  (re-verified on every launch; Google sends its own). AppGallery: none yet.
- Client: `src/utils/emailGate.js` (`blockUnverified`), `VerifyEmailPrompt.jsx` (once per session + on
  block), purchases via `blockGuestPurchase`, composer/clip/comment pre-checks, relay rejects in
  `chatRelay*.js`, sign-up check in `SignUpStep1.jsx`. Rules test: `tests/rules/emailGate.mjs` 17/17.

**Not built yet:** the
Play purchase ban is enforced for Coda only (a Play purchase by a blocked buyer is not refused
server-side, which would need one extra read per purchase: founder decision); Huawei purchases
cannot be re-checked from admin (the proof is the phone's signed payload); Coda refunds are done
in the Coda portal (no API used).
