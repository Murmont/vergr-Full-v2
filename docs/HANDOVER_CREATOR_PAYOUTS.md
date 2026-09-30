# HANDOVER: creator payouts on Mercury

Written 2026-09-24, at the end of the session that chose the rail and wrote the spec.
**A new session reads this file first, then `docs/launch/creator-payouts-flow.md`.**

⚠⚠ **`docs/launch/` IS UNTRACKED IN GIT.** `git status --porcelain docs/launch/` returns `?? docs/launch/`.
Untracked means git is not protecting them. **`git clean -fd` and `git stash -u` delete them with no
error.** A `git checkout` or `git reset --hard` does NOT: a checkout carries untracked files across
untouched, and `reset --hard` only resets tracked files. **Committing them is a founder call and has NOT
been done.** Nothing about switching machines, sessions or Claude accounts touches them; they are
ordinary files on the founder’s disk.

---

## 1. Where this sits in the product

`functions/creatorPayouts.js` has a constant `PAYOUT_PARTNER_CONFIGURED = false` and a
`disbursePayout()` that throws unconditionally. The run marks itself `blocked` and moves nothing, by
design, because an earlier version debited the payable and then threw, destroying the money.

**That flag is the one remaining blocker to money reaching a creator.** Everything else in the creator
program was audited and fixed on 2026-08-16.

Total creator liability platform-wide is **$0.01**. Nobody is owed anything yet. Minimum payout is
$100 and accounts must be 30 days old, so there is no urgency and no excuse for shortcuts.

---

## 2. What the 2026-09-24 session actually did

| | |
|---|---|
| Coda Payments KYC email | Drafted in the founder's own first-person voice, he sent it. Vergr LLC is a member-managed Kentucky LLC, single member Damien Ashton, who is also sole director, sole authorised signatory and sole 100% UBO. One nationality, South African. No former nationalities, no former names. |
| Google test deposit / Mercury | Researched the apparent chicken-and-egg (needing the deposit amount to verify Google, needing Mercury access to read the amount). It is not a deadlock: the Google deposit IS the first deposit into the empty account, Mercury emails on incoming cash (Cash flow notifications, Email and push), and Google's own page says the amount can be obtained "by calling your bank". Recorded in `docs/launch/entity-migration.md`. Google gives a DROPDOWN of candidate amounts, not a text box, and the US is not on Google's no-test-deposit wire list. |
| Payout rail | Researched Trolley, PayPal and Mercury from the vendors' own live pages. **Chose Mercury's own Send Money API.** Wrote `docs/launch/creator-payouts.md` (decision record) and `docs/launch/creator-payouts-flow.md` (build spec). |
| CLAUDE.md | Added the Mercury decision block under the "payout partner is still not wired" paragraph. |

**No code was written. No functions were deployed. Nothing was committed.**

---

## 3. The decision, in one paragraph

Mercury does ACH, domestic wire and international wire by API to 200+ countries in 40+ currencies;
invites recipients to enter their own bank details AND upload a tax form through a white-label hosted
page; classifies that form as `w9` / `w8BEN` / `w8BENE` and exposes it through the API, so
`taxFormStatus` stays partner-fed exactly as `creatorPayouts.js` already requires; and files
1099-NEC/MISC at $5 each on the FREE plan. Cost: $0 ACH, $0 USD wires, 1% FX. Against Trolley at
$2,399/yr minimum plus 2% FX, and PayPal at 4% FX with a 180-day hold risk.

**PayPal is refused, with evidence:** Live Streaming/Broadcasting is AUP category 12 (pre-approval
required), operating without that approval is an AUP breach by definition, and a breach lets PayPal
hold the balance up to 180 days. Trolley cannot fund or screen PayPal payouts, so the float would sit
inside PayPal and the Didit-verified creator would not be linked to the paid address.

**Mercury's binding terms do not exclude Vergr.** The ToU's only business prohibition is online
gambling; Choice's deposit agreement adds illegal transactions and settlement/trust funds. The
marketplace / MSB / money-transmission language sits ONLY in an informational "Valid uses" note in the
API docs, not in any signed agreement, and that same note lists "paying invoices for your company" as
acceptable.

---

## 4. The five questions are CLOSED. Do not reopen them.

The founder answered these on 2026-09-24 and was visibly annoyed at being asked. `creator-payouts-flow.md`
section 0 holds them with sources.

1. **Wise US Inc** is one of Mercury's two international wire providers. Founder accepted it. Vergr holds
   no Wise account.
2. **`chargeType: 'shared'`, send in the supplier's LOCAL CURRENCY by default.** The $15 is OPTIONAL and
   exists only for USD international wires. ToS 8.6 already discloses that the creator's own bank and
   intermediary charges are theirs while Vergr bears the payments partner's cost.
3. ⚠⚠ **NOT a royalty and NOT a third-party service fee. Creators are INDEPENDENT SUPPLIERS paid a share
   of Vergr's revenue.** ToS 11.1 and `docs/REVENUE_SHARE_PLAN.md` 1.4. It follows that income is
   sourced where the services are performed, so a non-US supplier working abroad is foreign-source:
   **no NRA withholding, no 1042-S**, W-8BEN collected only to document foreign status, US suppliers get
   a 1099-NEC, and `purpose.simple.category` is **`contractor`** on every wire. Mercury therefore covers
   the whole tax job and no third-party tax module is needed.
4. **The API has no currency field.** Currency follows the recipient's own bank details entered in
   Mercury's hosted onboarding. The body is `recipientId`, `amount`, `paymentMethod`, `idempotencyKey`,
   `purpose`.
5. **Dual approval is a dashboard toggle.** The org can switch it off so the requester approves their own
   payment. Read `requesterMayApprove` on the response. No second Mercury user is needed.

---

## 5. What the FOUNDER still has to do (nothing past build step 1 can happen without this)

| # | Action | Detail |
|---|---|---|
| 1 | Google test deposit lands, Mercury dashboard unlocks | In flight at the end of the session. |
| 2 | Create the Mercury API token for Cloud Functions | Mercury dashboard, Settings, API tokens, **Custom Scopes**. Tick: Fetch Depository Accounts, Fetch Recipients, Fetch Recipient Invites, Fetch Send Money Requests, Fetch Transactions, **Send Money with Approval**. Leave the **IP whitelist EMPTY**. |
| 3 | Create a SECOND token for box 1 | Same place, with the asterisked scopes: **Create Recipients**, **Create Recipient Invites**. This one NEEDS the IP allowlist set to **91.98.79.244**. |
| 4 | Turn OFF dual approval | Mercury dashboard, so the requester may approve their own payment. |
| 5 | Ask Mercury four questions | Listed in `creator-payouts.md` section 7. Most important: "making mass payments on our API" is listed as a chargeable feature in Mercury's own pricing FAQ and the fee appears nowhere in the comparison table. **Get the number in writing before building.** |

⚠ **Tokens must never be pasted into chat.** They go into the founder's shell as an environment variable
and scripts read `process.env`.

---

## 6. Build order (from `creator-payouts-flow.md` section 8)

Each step is verifiable before the next begins. **Nothing deploys until the founder says so.**

1. ✅ **WRITTEN 2026-09-24, SOURCE ONLY** (guard `scripts/mercury-payouts-check.mjs`, 103 assertions; see UPDATE_LOG). `functions/mercuryPayouts.js`, the client. Pure, unit-testable functions: micro-USD to USD amount
   conversion, tax-form mapping (`w9` / `w8BEN` / `w8BENE` / `unknown`), payment-method selection
   (`ach` for US, `internationalWire` otherwise), response classification (200 / 409-as-success /
   400-duplicate / error). **Needs no token, can be written and tested today.**
2. ✅ **INSTALLED ON BOX 1 2026-09-24** (see UPDATE_LOG). Payouts go from Checking ••0576 until a dedicated payouts account exists. Written as `infra/mercury-relay/` (guard `scripts/mercury-relay-check.mjs`). It relays EVERY Mercury call, not only invites, and authenticates Cloud Functions by Google OIDC. Install needs the founder's go-ahead, plus `MERCURY_PAYOUT_ACCOUNT_ID`, `MERCURY_RELAY_AUDIENCE` and `MERCURY_RELAY_ALLOWED_SA` in the env file. Originally: Box 1 service on **port 8098** (free; 8090, 8093, 8094, 8095, 8096, 8097 are taken),
   bearer-authenticated, one job: create recipient invites.
3. ✅ **WRITTEN 2026-09-24, SOURCE ONLY** as `enrollForPayouts({ connectPayoutAccount: true })`, not a new callable (see UPDATE_LOG: the verified name was never stored, `private/kyc` was owner-writable, and the ID-country sanctions check was dead; all three are fixed in source). Originally: `createPayoutOnboarding` callable + the new invite fields on `payout_accounts/{uid}`.
4. ✅ **WRITTEN 2026-09-24, SOURCE ONLY** (`refreshPayoutOnboarding` + `sweepPayoutOnboarding`; emulator test `scripts/mercury-onboarding-emulator.cjs`). Originally: Invite polling and the Mercury-verdict writer (section 3.4), including the legal-name match.
5. ✅ **WRITTEN 2026-09-24, SOURCE ONLY, switch still off** (see UPDATE_LOG; the Level 1 $50 cap is now applied per ToS 8.4, which puts the minimum on the BALANCE, and there is still no route to Level 2). Originally: `disbursePayout` + the new statement states (`queued`, `reversed`) + the reconcile pass.
6. ✅ **WRITTEN 2026-09-24, SOURCE ONLY** (`checkReturnedPayouts`; ⚠ relay `transactions` route not yet pushed to box 1). Originally: The second reconciliation layer for returned wires.
6b. ✅ **Payout verification Levels 2/3 (option B, manual review) WRITTEN 2026-09-24, SOURCE ONLY.** See UPDATE_LOG. `RaisePayoutLimit` already sits on the payout setup screen; step 7 should restyle it rather than rebuild it.
7. The payout screen: merge steps 3 and 4 into one, add the new states, remove the honest banner.
8. Flip `PAYOUT_PARTNER_CONFIGURED` only after a live payout of a small amount has settled.

---

## 7. The traps that will bite a new session

⚠⚠ **BOX 1 REACHES MERCURY OVER IPv6 BY DEFAULT, AND THE WHITELIST IS IPv4.** Measured 2026-09-24: a call from box 1 went out as `2a01:4f8:1c18:987e::1` and Mercury answered **401 `ipNotWhitelisted`**. The identical call with `curl -4` returned 200. Every Mercury call from box 1 must force IPv4 (`family: 4` in Node). Do not "fix" it by whitelisting the IPv6 address without asking.

✅ **TOKEN A EXISTS (2026-09-24).** Custom, 6 scopes, whitelist `91.98.79.244`. Mercury's modal REQUIRES an IP for this scope set, although the docs say request-send-money needs none, so it lives on box 1 in `/etc/vergr-payouts/mercury.env` (root 600) as `MERCURY_TOKEN_A`, saved by the founder through `/usr/local/bin/vergr-set-mercury-token A|B` (hidden input, never printed). Verified with GET /accounts over IPv4: HTTP 200, Checking ••0576 + Savings ••7680. **Cloud Functions therefore cannot call Mercury directly; box 1 makes every Mercury call.** ⚠ The send scope will be DOWNGRADED if no payout is requested within 45 days of 2026-09-24. ✅ **TOKEN B EXISTS (2026-09-24)**: Custom, Create Recipients + Create Recipient Invites, whitelist 91.98.79.244, in the same env file as MERCURY_TOKEN_B, loaded by the relay (healthz tokenB:true). Proven without creating anything: POST /recipients/invites with {} over IPv4 gave 400 invalidApiArgs (contactEmail missing), so the token and IP are accepted. ⚠ It is deleted if unused for 45 days (by about 2026-11-08) unless a real creator onboards.

⚠⚠ **A successful `request-send-money` means QUEUED, not sent.** `successfulPayouts++`, `firstPayoutAt`
and the "You have been paid" notification currently fire at disburse time in `payOne()` and **must move
to the approved transition**. `firstPayoutAt` and `successfulPayouts` are the two inputs to
`resolveCadence()`, so advancing them on an unapproved payment promotes a creator to a faster payout
cadence on money that never moved.

⚠⚠ **HTTP 409 is SUCCESS**, not failure. It means the idempotency key was reused.

⚠⚠ **A returned wire needs a SECOND reconciliation layer** via `Fetch Transactions`, because the
approval request still reads `approved` forever even after the receiving bank sends the money back.

⚠⚠ **A Mercury token unused for 45 days is DELETED, and one whose permissions exceed its usage for 45
days is DOWNGRADED.** Both fail silently and both break payouts. The run must make one unconditional
`GET /accounts` call every time purely to keep it alive.

⚠⚠ **Asterisked scopes need an IP allowlist and Cloud Functions have no static IP.** Mercury says
outright "we do not offer a way to circumvent this". `Create Recipients` and `Create Recipient Invites`
are asterisked. `request-send-money` (Send Money with Approval) is NOT, which is the whole reason the
architecture works. Splitting the tokens also means a leaked Firebase secret cannot add a new
destination for money.

⚠ **`contactEmail` cannot come from `users/{uid}`.** Emails were removed from that document on
2026-09-16 because it is publicly listable. Read it through `functions/authEmails.js`.

⚠ **`sendEmail: false` on the invite is what makes it white-label.** The response carries
`onboardingUrl`; the app opens it. No Mercury-branded email reaches the creator.

⚠ **Mercury's blocked-country list is WIDER than Vergr's.** Mercury refuses Belarus, Cuba, Iran, North
Korea, Myanmar, Russia, Sudan, Syria, sanctioned regions of Ukraine, Venezuela, Yemen. Vergr blocks 7
sanctioned states. So a creator in **Myanmar, Sudan or Yemen** passes `blockingReason()` and then has the
wire refused. Handle it as a payout failure with a real message, not a silent retry.

⚠ **A new Cloud Function is a new Artifact Registry image, i.e. money.** No webhooks: polling inside a
function that already runs is free and the latency does not matter for a payout that takes days. No new
Cloud Scheduler job: reconciliation rides `runCreatorPayouts`, which already runs.

⚠ **Writing long markdown through a bash heredoc fails in this shell** on apostrophes and backticks. Use
the Write tool. Same for `node -e` with nested quotes: write a `.cjs` file to the scratchpad and run it.

---

## 8. What `functions/creatorPayouts.js` already does (read, not remembered)

- `disbursePayout({ payeeId, amountMicroUsd, idempotencyKey })` around line 341, throws unconditionally.
- `PAYOUT_PARTNER_CONFIGURED = false` around line 359.
- `blockingReason()` order: `suspended_strikes`, `frozen`, `sanctioned_country`, `account_too_new`,
  `kyc_required`, `tax_form_required` (`taxFormStatus !== 'on_file'`), `payout_account_required`
  (`!partnerPayeeId`), `below_minimum`.
- `payOne()` reserves (debit + statement `pending` + ledger row), calls disburse, then sets
  `status: 'paid'`, increments `successfulPayouts`, sets `firstPayoutAt` once, and sends the
  "You have been paid" notification. **Those last three move to the approved transition.**
- `applyPartnerAccountState(uid, { taxFormStatus, taxFormType, partnerPayeeId, legalName, country })`
  already accepts `'W-9' | 'W-8BEN' | 'W-8BEN-E'`.
- Constants: `MIN_PAYOUT_MICRO_USD = 100 * MICRO_USD`, `MIN_ACCOUNT_AGE_DAYS = 30`,
  `MAX_PAYEES_PER_RUN = 500`, `STRIKE_SUSPEND_THRESHOLD = 3`.

`src/screens/creator/PayoutScreens.jsx` (334 lines) has four `StepRow`s: Start payout setup (works,
calls `enrollForPayouts`), Verify identity (works, `/wallet/kyc`), Tax form (CTA to `/help`, dead),
Payout account (CTA to `/help`, dead), plus an honest banner saying the last two are not available.

---

## 9. Still open, recorded rather than guessed

- Whether Mercury's 1099 tool picks up API-sent payments automatically.
- Idempotency behaviour of `request-send-money` (documented only for `createTransaction`).
- The "mass payments on our API" chargeable feature in Mercury's pricing FAQ.
- Whether non-USD wires carry intermediary deductions the way USD wires do.
- The current 1099-NEC filing threshold (was $600 for years; the 2025 tax act raised it and the current
  figure could not be pinned to an IRS page). Confirm with the accountant.
- The exact `users/{uid}.kyc` shape for the legal-name match in section 3.4.

---

## 10. Everything else outstanding on this machine, not payouts

| | |
|---|---|
| **Coda Payments** | Still owed the answer set and three PDFs in `C:\Users\damie\Downloads\`: `Vergr LLC - Source of Funds Statement.pdf`, `Vergr LLC - Corporate Registry Document.pdf`, `Vergr LLC - aml-policy.pdf`. |
| **Play** | 7 changes still IN REVIEW (1.0.215 production + alpha, listing text, 6 countries, feedback email). Founder authorized Publish once Google approves: press Publish only when "Changes in review" is empty with no rejection. Then flip `PLAY_LISTING_LIVE` in `src/utils/referral.js`. Never publish over a rejection. |
| **Play publisher name** | `OPERATOR.playPublisher` in `src/screens/marketing/legal/legalContent.js` reads `'Murmont LLC'`. Change it only after Google approves the developer-name switch, and delete the field and both uses when the Play identity switches. |
| **Merchant / payout profile** | Still Murmont LLC and CANNOT be relinked. `docs/launch/entity-migration.md` has the plan; the first move is asking Play support whether developer-account ownership transfer also moves the merchant profile. |
| **Huawei** | 1.0.214 APK submitted and under review. Subscriptions blocked until Huawei approves the emailed application to `jointoperation@huawei.com`. |

---

## 11. The founder's standing rules that this work touches

- ⚠⚠ **NEVER make a choice that costs him money. Ever.** Not a threshold, not "it is inside the free
  tier". Stop, say the cost, say the free alternative, let him choose.
- **Never enter bank account numbers, routing numbers or financial credentials into any field.** He
  types them himself.
- **API tokens never go into chat.**
- **Never frame Vergr as a gaming app** to any vendor or processor. It is a live streaming and social
  creator platform.
- **Never re-suggest Stripe or Paddle.** Both already rejected Vergr.
- **Never describe Vergr as a marketplace**, or as forwarding funds, or as holding stored value. Vergr is
  the PRINCIPAL.
- **Research means research.** He does not want to be asked a question a source could answer, and he does
  not want an email drafted to a vendor when he asked for a policy to be read.
- **Do not put up roadblocks.** The IP allowlist looked like a blocker and was solved with box 1.
