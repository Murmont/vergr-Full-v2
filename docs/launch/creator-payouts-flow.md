# Creator payouts: the full lifecycle, end to end

Written 2026-09-24 against the code as it exists and the Mercury API reference as published.
Companion to `creator-payouts.md`, which is the decision record for WHY Mercury. **This one is the
build spec.** Nothing gets written until the founder has read it.

Every Mercury shape below was read off `docs.mercury.com/reference`. Every Vergr shape was read off
`functions/creatorPayouts.js` and `src/screens/creator/PayoutScreens.jsx`, not remembered.

---

## 0. The five questions are closed

All five were answered from the sources and from this repo on 2026-09-24. **None of them is an
open decision. Do not reopen them.**

| # | Question | Answer |
|---|---|---|
| 1 | Wise US Inc is one of Mercury's two international wire providers | **Accepted by the founder.** No Vergr account or relationship with Wise exists; they are in the rail only. |
| 2 | `chargeType` `ours` or `shared` | **`shared`, and send in local currency by default so the question rarely arises.** The $15 is OPTIONAL and exists only for USD international wires. ToS §8.6 already discloses that the creator's own bank and intermediary charges are theirs. |
| 3 | Service fee or royalty | **Neither framing applies. It is a revenue share paid to a supplier**, per ToS §11.1 and `docs/REVENUE_SHARE_PLAN.md` §1.4. See §7. |
| 4 | Can the API send non-USD | **There is no currency field.** The currency follows the recipient's own bank details, entered in Mercury's hosted onboarding. Mercury's international wire recipe confirms the full body is `recipientId`, `amount`, `paymentMethod`, `idempotencyKey`, `purpose`. |
| 5 | Can the founder approve his own request | **Yes, it is a dashboard toggle.** "Your org can turn this off in the dashboard so the requester may approve their own payment." Read `requesterMayApprove` on the response. No second Mercury user needed. |

---

## 1. Data model

### Already exists, unchanged

| Store | Fields this flow reads or writes |
|---|---|
| `users/{uid}` | `country`, `kyc.country`, `kycLevel`, `createdAt` |
| `wallets/{uid}` | `owedMicroUsd`, `totalPaidMicroUsd` |
| `payout_accounts/{uid}` | `enrolled`, `enrolledAt`, `taxFormStatus`, `taxFormType`, `partnerPayeeId`, `legalName`, `country`, `frozen`, `strikes`, `firstPayoutAt`, `successfulPayouts`, `lastPayoutAt` |
| `payout_runs/{runId}` | run summary |
| `payout_statements/{runId}__{uid}` | one per creator per run |

**`partnerPayeeId` becomes the Mercury `recipientId`. `taxFormStatus` and `taxFormType` are set from
Mercury's classification.** Both fields already exist and are already read by `blockingReason()`.
Nothing about the gate logic changes.

### New fields on `payout_accounts/{uid}`

| Field | Purpose |
|---|---|
| `mercuryInviteId` | the invite we created |
| `mercuryInviteStatus` | `created` / `completed` / `expired` |
| `mercuryInviteUrl` | `onboardingUrl`, shown to the creator |
| `mercuryInviteExpiresAt` | so we can re-issue before it dies |
| `mercuryPaymentMethod` | `ach` or `internationalWire`, cached from the recipient |
| `nameMatch` | `ok` / `mismatch`, see §3.4 |

### New fields on `payout_statements`

| Field | Purpose |
|---|---|
| `mercuryRequestId` | returned by `request-send-money` |
| `mercuryStatus` | last seen: `pendingApproval` / `approved` / `rejected` / `cancelled` |
| `queuedAt`, `reversedAt` | timestamps for the new states |

---

## 2. Statement state machine

Today the code has `pending -> paid | failed`. **With an approval step that is wrong**, because a
successful API call means QUEUED, not sent.

```
          reserve                submit                 approve            settle
 (none) ---------> pending ---------------> queued --------------> paid
                      |                       |
                      | submit failed         | rejected / cancelled
                      v                       v
                   failed                 reversed
                                              ^
                                              | wire returned by the
                                              | receiving bank
                                           (paid)
```

| State | Payable | Meaning |
|---|---|---|
| `pending` | debited | reserved, not yet sent to Mercury. Transient, within one `payOne` call. |
| `queued` | debited | Mercury accepted the request. **Sitting in the dashboard waiting for a human.** |
| `paid` | debited | approved and the money left. |
| `reversed` | **re-credited** | rejected, cancelled, or the wire came back. |
| `failed` | debited | submission error. **Human reconciliation. Deliberately not auto-refunded**, because we cannot tell a network timeout from an accepted payment. |

⚠⚠ **Three things currently fire at disburse time and must move to the `paid` transition:**
`successfulPayouts++`, `firstPayoutAt`, and the "You have been paid" notification.
`firstPayoutAt` and `successfulPayouts` are the two inputs to the cadence ladder
(`resolveCadence`), so advancing them on a payment that was never approved would promote a creator
to a faster cadence on money that never moved. And telling someone they have been paid before the
money leaves is the worst copy in the product.

---

## 3. The lifecycle, stage by stage

### 3.1 Enrol

Exists and works. `enrollForPayouts` sets `enrolled: true` and is idempotent (it never resets
`firstPayoutAt`, strikes or payout counts). No change.

### 3.2 Identity

Exists and works. Didit writes `kycLevel = 1`. No change.

### 3.3 Payout account and tax form are ONE step, not two

The payout screen currently shows four steps, and steps 3 and 4 both have a CTA pointing at `/help`
with an honest banner saying they are not available. **Mercury collapses them into one**, because
the recipient invite collects bank details and the tax document in the same flow.

New callable, `createPayoutOnboarding`:

**Refuses unless:** signed in, `enrolled`, `kycLevel >= 1`, not a Vergr-sanctioned country, not a
Mercury-blocked country (§5.3), and there is no live invite already.

⚠ **Gating on `kycLevel >= 1` is a deliberate choice.** Creating a Mercury recipient for someone who
will never pass the identity gate leaves junk in the payee list, which is a compliance surface, not
just clutter.

Calls box 1, which calls `POST /recipients/invites`:

```
contactEmail              from functions/authEmails.js
name                      the Didit-verified legal name
paymentMethods            ['ach'] for US, ['internationalWire'] otherwise
requireTaxDocument        true
sendEmail                 false
organizationNameOnRequest 'Vergr LLC'
```

⚠ **`contactEmail` cannot come from `users/{uid}`.** Emails were removed from that document on
2026-09-16 because it is publicly listable. The server reads it through `functions/authEmails.js`.
A build that forgets this fails at runtime with an empty email.

⚠ **`sendEmail: false` is what makes it white-label.** The response carries `onboardingUrl`; the app
opens it. No Mercury-branded email reaches the creator.

⚠ **Why box 1:** `Create Recipient Invites` is asterisked in the token modal, so it needs an IP
allowlist. Cloud Functions have no static IP. Box 1 (91.98.79.244) does, is already paid for, and
already runs an nginx-fronted service pattern with a bearer token. New service on port 8098, which
is free (8090, 8093, 8094, 8095, 8096, 8097 are taken).

### 3.4 The creator finishes, and we verify Mercury's verdict

`Fetch Recipient Invites` is NOT asterisked, so Cloud Functions can poll it directly. Two triggers,
both free:

1. **When the creator opens the payout screen.** `getPayoutAccount` refreshes a `created` invite.
   One API call, only when someone is actually looking.
2. **At the start of the payout run**, as a sweep for anyone who never came back to the screen.

On `status: 'completed'`, read `recipientId`, then `GET /recipient/{recipientId}`:

| Read | Written to | Rule |
|---|---|---|
| `id` | `partnerPayeeId` | only if the name check passes |
| `attachments[].formType` | `taxFormType` | `w9` -> `W-9`, `w8BEN` -> `W-8BEN`, `w8BENE` -> `W-8BEN-E` |
| | `taxFormStatus` | `on_file` for those three. ⚠ **`unknown` or no attachment means `submitted`, not `on_file`.** Fails closed. |
| `name` | `legalName` | |
| `address.country` | `country` | second country signal |
| `defaultPaymentMethod` | `mercuryPaymentMethod` | |
| `isBusiness` | | individual vs entity, which is W-8BEN vs W-8BEN-E |

⚠⚠ **NAME MATCH IS AN AML CONTROL AND IT IS FREE.** Mercury's `recipient.name` is the name on the
bank account. Vergr holds the Didit-verified legal name. If they disagree, **do not set
`partnerPayeeId`**; write `nameMatch: 'mismatch'` and surface it for review. Both values are already
in hand, so this costs nothing, and paying a bank account in a different name from the verified
identity is precisely the hole the whole KYC gate exists to close.

⚠ **Read the actual `users/{uid}.kyc` shape before building the comparison.** It is written by
`diditWebhook` and I have not read it. Do not guess the field name.

### 3.5 The run

`runCreatorPayouts` already runs daily. Two additions, both inside the function that already exists.
**No new cron, no new Cloud Function, no new Scheduler job.**

1. **Reconcile first** (§3.6), before building this run's plan, so a rejected payment is re-credited
   before the creator's balance is read again.
2. **Sweep completed invites** for anyone who never reopened the screen.

`buildRunPlan` is unchanged. `blockingReason` is unchanged. The KYC monthly cap, the $100 minimum,
the 30-day account age, the strike suspension and the sanctioned-country check all already work and
none of them move.

### 3.6 `disbursePayout`, the one function that changes

```
POST /account/{accountId}/request-send-money
  amount           amountMicroUsd / 1_000_000, rounded to 2dp deliberately
  idempotencyKey   `${runId}__${uid}`, the statement doc id
  recipientId      partnerPayeeId
  paymentMethod    mercuryPaymentMethod
  purpose          wires only: { simple: { category: 'contractor', additionalInfo: legalName } }
  chargeType       USD international wires only: 'shared' (see below)
```

⚠ **`amount` is a double in USD, not cents and not micro-USD.** The ledger is micro-USD throughout.
Convert explicitly and round on purpose; do not let a float decide what a creator is paid.

⚠ **`purpose.simple.category`** enum is: employee, landlord, vendor, contractor, subsidiary,
transferToMyExternalAccount, familyMemberOrFriend, forGoodsOrServices, angelInvestment,
savingsOrInvestments, expenses, travel, other. `contractor` fits the service-fee characterisation and
lines up with a 1099-NEC. **`contractor` is the category that matches ToS §11.1,
which calls the creator "an independent supplier", and it lines up with a 1099-NEC.**

Response handling:

| Response | Meaning | Action |
|---|---|---|
| 200 | accepted | statement -> `queued`, store `mercuryRequestId` |
| **409** | **idempotency key already used. THIS IS SUCCESS.** | treat as `queued`, use the returned body |
| 400 duplicate | same recipient, same account, same amount within 24h, **even with a different idempotency key** | distinct error, retry next run. **Not a failure to reconcile by hand.** |
| other 4xx/5xx | real error | statement -> `failed` |

⚠ **Treating 409 as an error would cause a retry storm and false failures.** Mercury documents it as
returning the normal body.
⚠ **The 24-hour duplicate guard is documented on `createTransaction`. Whether it applies to
`request-send-money` is not stated. Assume it does and handle the 400.**
⚠ **Idempotency behaviour on `request-send-money` is not documented at all**, only on
`createTransaction`. Verify with a deliberate repeat call before trusting it.

### 3.7 Approval and reconciliation

The founder opens the Mercury dashboard and approves the batch. Then, on the next run:

For every `queued` statement, `GET /request-send-money/{requestId}`:

| `status` | Action |
|---|---|
| `pendingApproval` | leave it. ⚠ **If it has been queued more than N days, surface it.** A creator's balance is debited while this sits, and a forgotten approval is money the creator cannot see and cannot spend. |
| `approved` | statement -> `paid`, `paidAt`, `successfulPayouts++`, `firstPayoutAt` if unset, send the notification |
| `rejected` / `cancelled` | **re-credit `owedMicroUsd`**, write a reversing ledger row, statement -> `reversed` |

⚠⚠ **A SECOND RECONCILIATION LAYER IS NEEDED AND IS EASY TO MISS.** An approved wire can still be
**returned** by the receiving bank days later. Mercury redeposits it as a new transaction labelled
"wire return". That does **not** appear on the approval request, so `GET /request-send-money` will
say `approved` forever. Detecting it needs `Fetch Transactions`. Without this layer a bounced payout
is invisible: the creator's balance stays debited, the money is back in Mercury, and nobody knows.

---

## 4. What the creator sees

The existing screen already has the right four rows. Steps 3 and 4 merge.

| Step | Before | After |
|---|---|---|
| Start payout setup | works | unchanged |
| Verify your identity | works | unchanged |
| Tax form | CTA -> `/help`, dead | **completed by the same Mercury flow as step 4.** Shows `W-9 on file` / `W-8BEN on file` from Mercury's own classification |
| Payout account | CTA -> `/help`, dead | CTA opens `onboardingUrl` |

**The honest banner ("that connection is being finalised") comes out in the same commit that makes
the CTAs work**, and not before.

New states the screen must show, because each one is a person stuck:

- invite created but not completed -> "Finish adding your details" with the same link
- invite expired -> "Start again"
- tax document unreadable (`formType: unknown`) -> "We could not read your tax form. Upload it again."
- name mismatch -> "The name on your bank account does not match your verified identity." **Support
  route, not a self-service retry.**
- queued -> "Your payment is being released" and a real date, not silence

---

## 5. Every failure path

### 5.1 Before any money moves

| Failure | Handling |
|---|---|
| Invite expires unused | re-issue on next screen load |
| Creator abandons halfway | invite stays `created`, nothing is owed to anyone, no cleanup needed |
| Tax doc uploaded but unclassifiable | `taxFormStatus: 'submitted'`, not payable, creator told to re-upload |
| Name mismatch | `partnerPayeeId` withheld, flagged for review |
| Recipient deleted in the dashboard | `GET /recipient` returns `status: 'deleted'` -> clear `partnerPayeeId`, creator repeats step 4 |

### 5.2 At submission

| Failure | Handling |
|---|---|
| Token deleted (45 days unused) or downgraded (45 days under-used) | **Both fail silently and both break payouts.** The run makes one unconditional cheap `GET /accounts` call every time, whether or not there is anything to pay, purely to keep the token alive |
| 400 duplicate within 24h | retry next run |
| 409 | success |
| Network timeout | statement `failed`, payable stays debited, human reconciles. Never auto-refund: we cannot tell a timeout from an accepted payment |

### 5.3 Country

⚠ **Mercury blocks more countries than Vergr does.** Vergr blocks 7 sanctioned states. Mercury will
not send to **Belarus, Cuba, Iran, North Korea, Myanmar, Russia, Sudan, Syria, sanctioned regions of
Ukraine, Venezuela, Yemen** — Myanmar, Sudan, Ukraine regions and Yemen are additions.

**Check Mercury's list at ONBOARDING, not at payout.** A creator in Myanmar passes `blockingReason()`
today, accrues a balance, completes onboarding, and then discovers at payout time that the money
cannot reach them. Telling them on day one is the only humane version.

⚠ Separately, Mercury refuses international wires entirely if a **beneficial owner address** is in
one of 36 countries. South Africa is not among them, so Vergr qualifies, but that is a fact about
Vergr and it should be re-checked if the ownership ever changes.

### 5.4 After approval

| Failure | Handling |
|---|---|
| Wire returned by the receiving bank | detected only via `Fetch Transactions` (§3.7). Re-credit, statement -> `reversed`, tell the creator their details were rejected |
| Intermediary bank deducts fees under `shared` | creator receives less than the statement says. **If Q2 is answered `shared`, the statement copy must say so up front**, or the first international payout is a support ticket |
| Founder never approves | queued statements age. Needs the staleness surface in §3.7 |

---

## 6. Cost per path

| | Mercury fee | Notes |
|---|---|---|
| US creator, ACH | **$0** | |
| Non-US, local currency wire | **1%** FX | mid-market rate, 40 currencies incl. ZAR |
| Non-US, USD wire, `shared` | **$0** to Vergr | intermediary banks take an unknown cut from the creator |
| Non-US, USD wire, `ours` | **$15** flat | creator receives the full amount |

⚠ **$15 on a $100 payout is 15%.** If Q2 is answered `ours`, the international payout minimum should
probably rise above $100. That is a founder decision and it changes `MIN_PAYOUT_MICRO_USD` per
destination, which is a change to a published number.

---

## 7. Tax

**The relationship is settled by Vergr's own Terms, §11.1, and it is not an open question:**

> "This Section is the agreement under which VERGR pays you **for content and services you
> supply**... You supply content and services to VERGR. VERGR sells access to that content and to
> related features to other Users **as principal, in its own name and on its own account**...
> **You are an independent supplier.**"

There is no licence granted by the creator to Vergr anywhere in the Terms. Creators are suppliers
paid a share of Vergr's revenue. That is the model the whole principal restructure exists to
establish (`docs/REVENUE_SHARE_PLAN.md` §1.4), and every downstream answer follows from it.

| | |
|---|---|
| Sourcing | **where the services are performed** (IRS: "Business income: Personal services, where services performed") |
| Non-US supplier working abroad | **foreign-source. No NRA withholding. No 1042-S.** |
| US supplier | 1099-NEC, nonemployee compensation |
| W-8BEN | collected to **document** foreign status, not to claim a treaty rate |
| `purpose.simple.category` | **`contractor`**, with the supplier's name in `additionalInfo` |

**Mercury covers all of it.** `requireTaxDocument: true` collects and classifies the W-9 or
W-8BEN; its 1099-NEC and 1099-MISC filing at $5 each on the free plan handles US suppliers.
**No third-party tax module is needed.**

⚠ ToS §4A.6 already states the posture to creators: VERGR "does not act as a tax agent, does not
withhold tax on your behalf, and does not provide tax reporting documents except where compelled
by applicable law."

⚠ Confirm the current 1099-NEC filing threshold with the accountant. It was $600 for years and the
2025 tax act raised it; I could not pin the current figure to an IRS page.

---

## 8. Build order

Each step is verifiable before the next begins. **Nothing deploys until the founder says so, and
`PAYOUT_PARTNER_CONFIGURED` stays `false` until a real payout has completed end to end.**

1. `functions/mercuryPayouts.js` — the client. Pure functions for amount conversion, tax-form
   mapping, payment-method selection and response classification, all unit-testable with no token.
2. Box 1 service on port 8098, bearer-authenticated, one job: create recipient invites.
3. `createPayoutOnboarding` callable + the invite fields.
4. Invite polling and the Mercury-verdict writer (§3.4), including the name match.
5. `disbursePayout` + the new statement states + the reconcile pass.
6. The second reconciliation layer for returned wires.
7. The payout screen: merge steps 3 and 4, add the five new states, remove the honest banner.
8. Flip `PAYOUT_PARTNER_CONFIGURED` only after a live payout of a small amount has settled.

## 9. Deliberately not built

- **Webhooks.** The scopes are available and unasterisked, but a webhook needs a public HTTP
  endpoint, which is a new Cloud Function, which is a new Artifact Registry image, which is money.
  Polling inside a function that already runs is free and the latency does not matter for a payout
  that takes days anyway.
- **In-app W-9 / W-8BEN forms.** Mercury collects and classifies them, which is what the existing
  code requires ("tax status is exactly the kind of claim that has to come from the party that
  validated it").
- **Automated recipient creation from Cloud Functions.** Asterisked scope, needs a static IP. Box 1
  does it instead.
- **A second identity check.** Didit already does it and `kycLevel >= 1` already gates payouts.
