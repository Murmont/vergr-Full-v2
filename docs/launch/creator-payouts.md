# Creator payouts: Mercury, not Trolley, and not PayPal

Researched and written 2026-09-23, from the vendors' own published pages. Every figure below was
read off a live page on that date, not recalled. **Re-read the source before acting**, because
payout pricing moves.

**Conclusion up front: use Mercury's own Send Money API. It does the whole job for roughly $4,800 a
year less than Trolley, at a quarter of PayPal's FX cost, with no PayPal exposure at all.**

---

## 1. The decision in one table

Cost of paying a creator, all-in, by rail.

| | US creator, USD | Non-US creator, local currency |
|---|---|---|
| **Mercury** | **$0** (ACH) | **1.00%** FX, wire fee $0 |
| Trolley bank rail | $1.00 (ACH) | $4.00 + **2.00%** FX |
| Trolley + PayPal | $0.25 (Payouts API) | 2% (cap $20) + **4.00%** PayPal FX |

Plus the subscription, which is the number that actually decides this:

| | Per year |
|---|---|
| **Mercury** | **$0** on the free plan, or $358.80 on Mercury Plus |
| Trolley Pay module | **$2,399** |
| Trolley Pay + Tax | **$4,798** |
| Trolley Standard bundle | $7,895 |

Sources: [Mercury pricing](https://mercury.com/pricing),
[Trolley pricing](https://trolley.com/trolley-pricing/),
[PayPal merchant fees](https://www.paypal.com/us/webapps/mpp/merchant-fees).

⚠ **Vergr's total creator liability today is $0.01.** Nobody is owed anything, payouts are still
blocked in code, the minimum payout is $100 and accounts must be 30 days old. Signing a $2,399
subscription now buys a rail with nothing to move.

---

## 2. Why not PayPal

### It is on PayPal's pre-approval list, by name

[PayPal Acceptable Use Policy](https://www.paypal.com/us/legalhub/acceptableuse-full), Activities
Requiring Approval, category 12:

> **Live Streaming/Broadcasting** — "Any activities in which people transmit video, voice or text
> content in a live environment with the potential of user interaction."

And in the same document's Prohibited Activities, you may not use PayPal for activities that

> "relate to transactions involving any activity that requires pre-approval **without having
> obtained said approval**."

So operating without that approval is an AUP breach by definition. What that unlocks, from the
[User Agreement](https://www.paypal.com/us/legalhub/useragreement-full):

> "Holding the balance in ... your business account ... **for up to 180 days** if reasonably needed
> to protect against the risk of liability **or if you have violated our Acceptable Use Policy**.
> The hold may remain in place longer than 180 days according to Court Orders, Regulatory
> Requirements, or Other Legal Processes."

Limitations apply "if we believe **in our sole discretion** that you have breached this agreement or
violated the Acceptable Use Policy."

### The structural problem is worse than the approval

Trolley's own
[enrolment article](https://support.trolley.com/s/article/How-to-Enroll-in-PayPal-Payouts-API):

> "you still need to fund your PayPal account in order to send PayPal payouts, as **we do not touch
> those funds**"

and their [PayPal FAQ](https://support.trolley.com/s/article/PayPal-FAQ):

> "Your PayPal account **cannot be funded from the Trolley platform**."

So the payout float would sit inside PayPal. A limitation freezes the float and the payouts in one
action, and creators go unpaid for up to 180 days.

### It also breaks the AML story being told to processors right now

Same FAQ, verbatim:

> "Trolley only facilitates PayPal payments and **cannot perform checks** on PayPal payments."
> "We **cannot verify** PayPal account email addresses or check whether they belong to the
> registered recipient."

There would be no link between the creator verified through Didit and the address receiving the
money. Vergr is mid-KYC with Coda and has just closed the sanctioned-country payout gap. This would
reopen a different one.

**If PayPal is ever revisited:** get the pre-approval in writing through the Payouts API
questionnaire, answer it honestly as a live streaming and creator platform, never hold float, and
never describe Vergr as a marketplace (AUP category 18, a separate approval, and factually wrong,
Vergr is the principal).

---

## 3. What Mercury actually does

All verified on [docs.mercury.com](https://docs.mercury.com/reference/send-money) and Mercury's help
centre, 2026-09-23.

| Capability | Status |
|---|---|
| Create, update, delete recipients by API | Supported |
| **Invite a recipient to enter their own bank details** | Supported. "keeps sensitive data protected and reduces risk of error due to manual entry" |
| Send ACH, check, domestic wire by API | Supported |
| Send international wire by API | Supported, via `request-send-money` with a `purpose` |
| **Pay many recipients** | "Send payments to many recipients from a single background job or scheduled worker, looping through your recipient list" |
| Per-payment `idempotencyKey` | Supported |
| Queue a payment for dashboard approval | Supported |
| Track to completion | `transaction.created` / `transaction.updated` webhooks, or poll |
| RTP / FedNow by API | **Not available** |

**The recipient invite is the important one.** It is Trolley's white-label onboarding, free, and it
means Vergr never stores a creator's bank details.

**Coverage:** "200+ countries and regions, in 40+ local currencies", South African Rand included. FX
is **1%** at the mid-market rate.

**Mercury will not send to:** Belarus, Cuba, Iran, North Korea, Myanmar, Russia, Sudan, Syria,
sanctioned regions of Ukraine, Venezuela, Yemen.
⚠ That is **wider than Vergr's own block list** (the 7 sanctioned states). A creator in Myanmar,
Sudan or Yemen passes `blockingReason()` and then has the wire refused. Handle it as a payout
failure with a real message, not a silent retry.

**Eligibility, checked because it is the thing that could have killed this:** you are ineligible for
international wires if the company legal address is outside the US, or if the company physical
address **or a beneficial owner address** is in one of 36 listed countries. **South Africa is not on
that list**, and Vergr LLC's legal address is Richmond, KY. Vergr qualifies.

---

## 4. Tax forms: Mercury does more of this than expected

From the plan comparison table on [mercury.com/pricing](https://mercury.com/pricing), Taxes section,
available on the **free** plan:

- Centralized tax documentation
- Manage recipients for 1099 tax filing
- **Auto-scan W-9s to pre-fill 1099s**
- Track, void, or resubmit form corrections
- Send 1099 forms electronically or by post to recipients
- **Federal and state filing for 1099-NEC and 1099-MISC, $5 per filing**

Mercury Plus ($29.90/month) makes 1099 filings **unlimited**. Break-even is about six filings a
month, so the free plan is correct until there are real US creators.

That is Trolley's entire $2,399/year Tax module, replaced.

### What Mercury does NOT do

1. Identity verification. ⚠ **Not needed. Vergr already has Didit**, and `kycLevel >= 1` is already
   a payout gate. Trolley's Trust module ($1,199/year plus $2.50 a scan) would be paying twice.
2. Nothing else. Under the supplier revenue-share model (§10 below and ToS §11.1) there is no
   1042-S obligation and no withholding, so Mercury's W-9/W-8BEN collection plus 1099-NEC filing
   is the whole job.

### The tax position, settled by Vergr's own Terms

**ToS §11.1:** the creator "supplies content and services to VERGR", Vergr "sells access to that
content and to related features to other Users **as principal, in its own name and on its own
account**", and the creator "is an independent supplier". There is no licence granted by the
creator to Vergr anywhere in the Terms. **Creators are suppliers paid a share of Vergr's revenue.**
That is the model `docs/REVENUE_SHARE_PLAN.md` §1.4 exists to establish.

Everything follows from that:

| | |
|---|---|
| Sourcing | **where the services are performed** (IRS: "Business income: Personal services, where services performed") |
| Non-US supplier working abroad | **foreign-source. No NRA withholding. No 1042-S.** |
| US supplier | 1099-NEC, nonemployee compensation |
| W-8BEN | collected to **document** foreign status, not to claim a treaty rate |
| `purpose.simple.category` on every wire | **`contractor`** |

⚠ ToS §4A.6 already tells creators the same thing: VERGR "does not act as a tax agent, does not
withhold tax on your behalf, and does not provide tax reporting documents except where compelled by
applicable law."

⚠ Confirm the current 1099-NEC filing threshold with the accountant. It was $600 for years and the
2025 tax act raised it; I could not pin the current figure to an IRS page.
---

## 5. What to build

Nothing here adds a Cloud Function, a cron or a billable resource. That is deliberate.

| Piece | Where |
|---|---|
| Mercury recipient id | `payout_accounts/{uid}.partnerPayeeId`, **the field already exists** |
| Tax form state | `payout_accounts/{uid}.taxFormStatus`, **already exists** |
| Send the money | `disbursePayout()` in `functions/creatorPayouts.js`, currently throws |
| Flip the switch | `PAYOUT_PARTNER_CONFIGURED = false` becomes true **in the same commit** |

**Order of work:**

1. **Recipient onboarding.** `PayoutScreens.jsx` calls Mercury's recipient-invite endpoint and
   stores the returned recipient id as `partnerPayeeId`. The creator enters their own bank details
   on Mercury's page. Vergr never sees them.
2. **Tax form.** A W-9 for US creators and a W-8BEN for everyone else, collected in
   `PayoutScreens.jsx`, stored with a typed signature, date and timestamp, setting `taxFormStatus`.
   `blockingReason()` already refuses a payout without it. The W-9s then feed Mercury's 1099 flow.
3. **`disbursePayout()`** posts to `POST /account/{accountId}/request-send-money`, with
   `idempotencyKey` set to the payout statement id so a retry cannot double-pay. ACH for US
   recipients, `internationalWire` plus a `purpose` for everyone else.
4. **Approval.** The run lands in the Mercury dashboard for approval. Keep it that way. It avoids
   the IP allowlist that `createTransaction` requires, which would otherwise need a static egress IP
   and therefore Cloud NAT and therefore money, and a human eye on a batch of outgoing payments is
   the correct control anyway.
5. **Status.** Poll `GET /request-send-money/{requestId}` from the **existing** `cronEvery6h`.
   Webhooks would need a new public HTTP function; polling inside a cron that already runs does not.
6. **A dedicated Mercury account for payouts.** Free, and it keeps the payout float separate from
   operating cash so a reconciliation error cannot drain the business.

**Spends this needs approved before it can run, stated rather than assumed:**

- `MERCURY_API_TOKEN` as a Firebase secret, about **$0.06 a month**.
- Mercury Plus at **$29.90 a month**, but only once there are more than about six US creators filing
  1099s a year. Not now.

---

## 6. Where Mercury is genuinely worse, stated plainly

**International payouts are WIRES, not local rails.** Trolley sends SEPA, FPS, NPP and IACH; Mercury
sends a wire. On a USD international wire Mercury gives two choices: **SHA**, free to Vergr but
intermediary banks deduct an unpredictable amount from the creator, or **OUR**, a flat **$15** so the
creator gets the full amount. On a $100 payout that is either an unknown haircut to the creator or
15% to Vergr.

Whether the same intermediary problem applies to **non-USD local-currency** wires at 1% is not
documented. **Test it with one real payout before promising creators anything.**

**Two options when that bites**, both founder decisions:

- Raise the payout minimum for international creators so a wire is proportionate.
- Revisit a local-rail provider once international volume is real enough to negotiate with.

**One more risk to name:** routing payouts through the operating bank means a Mercury freeze stops
everything, not just payouts. That risk already exists because Mercury is the business bank, but
concentrating creator money there raises the stakes.

---

## 7. Confirm with Mercury before building

1. **"Making mass payments on our API" is listed as a chargeable feature** in Mercury's own pricing
   FAQ, and the fee appears nowhere in the comparison table. Get the number in writing.
2. Do non-USD local-currency wires carry intermediary deductions the way USD wires do?
3. Are there payment-count or volume limits on the API that a monthly payout run would hit?
4. Does paying a large number of unrelated individual recipients sit within acceptable use for a
   Mercury business account?

## 8. Stop conditions

- **Do not sign a Trolley subscription** while creator liability is $0.01.
- **Do not open a PayPal business account for Vergr** without the live-streaming pre-approval in
  writing first.
- **Do not flip `PAYOUT_PARTNER_CONFIGURED` to true** until one real payout has been queued,
  approved in the Mercury dashboard, and confirmed as sent.
- **Do not re-open the supplier revenue-share characterisation.** ToS 11.1 and
  docs/REVENUE_SHARE_PLAN.md 1.4 settle it: creators are independent suppliers paid a share of
  Vergr revenue. It is not a royalty and not a third-party service fee.

---

## 9. Read from the API reference, 2026-09-24

Everything here is from docs.mercury.com/reference, not from the marketing pages.

### The tax problem is solved by Mercury, so section 4 above is superseded

`POST /recipients/invites` takes **`requireTaxDocument: boolean` (required)**, and
`GET /recipient/{recipientId}` returns:

```
attachments[]: { fileName, uploadedAt, url, formType }
formType enum: w9 | w8BEN | w8BENE | unknown
```

**Mercury collects AND classifies the tax form, and exposes the type through the API.** So
`taxFormStatus` and `taxFormType` get set from Mercury's verdict, read server-side, never from a
client assertion. That satisfies the existing rule in `creatorPayouts.js` verbatim: "tax status is
exactly the kind of claim that has to come from the party that validated it". **No in-app W-9 or
W-8BEN form is needed, and no operator review step is needed.**

⚠ `formType` can come back `unknown`, meaning Mercury accepted a file it could not classify. Treat
`unknown` as NOT on file. Fail closed.
⚠ Mercury COLLECTS the form. Whether it validates the contents (TIN matching and so on) is not
stated anywhere. This is document collection, not Trolley's full tax interview.

### The invite is fully white-label

`sendEmail: false` suppresses Mercury's email and the response carries `onboardingUrl`, so the
creator goes straight from PayoutScreens to Mercury's form and back. The response also carries `id`,
`status` (created | completed | expired) and `recipientId`, which is null until they finish. That
`recipientId` becomes `partnerPayeeId`.

### ⚠⚠ The approver must not be the token creator

`POST /account/{accountId}/request-send-money`, verbatim:

> "The user approving the payment will need to be **different than the user who created the API
> Token**, and the approving user will need to have proper send money permissions."

**For a one-person company this is a blocker unless it is planned for.** The fix is free: Mercury
gives **unlimited team members on every plan**, so create the API token as one user and approve as
another. Both are the founder. The response carries `requesterMayApprove` and
`numberOfApproversRequired`, and the Send Money guide says the requester can self-approve "unless
your approval rules allow the requester to approve their own payment", so the org's approval rules
may also permit it. **Confirm with Mercury before building; do not assume.**

### There is no way around the IP allowlist, and Mercury says so outright

> "**We do not offer a way to circumvent this security requirement right now.** ... If you cannot
> obtain a static IP address ... you can create an API token that does not require IP whitelisting:
> Read Only or Custom with only scopes that do not have an asterisk next to them. **You can use the
> request-send-money endpoint without IP whitelisting.**"

So `request-send-money` with a Custom token is the ONLY send path that avoids a static egress IP,
which would mean Cloud NAT, which would mean a monthly bill.

⚠ **Unknown until the token modal is opened: whether the RECIPIENT WRITE scopes carry an asterisk.**
If they do, invites cannot be created from Cloud Functions without a static IP, and the architecture
changes.

### Three operational traps

1. **A token unused for 45 days is automatically DELETED.** A quiet month kills payouts silently.
2. **A token with higher permissions than it used in 45 days is automatically DOWNGRADED**, which
   breaks sending in exactly the same silent way.
   Mitigation for both: the 6-hourly cron makes an unconditional cheap `GET /accounts` call, not
   only when there are payouts to poll.
3. **Scopes cannot be edited after a Custom token is created.** Pick every scope up front, or it is
   a new token.

### Request and response shapes worth writing down

`POST /account/{accountId}/request-send-money`:

- `amount` is a **double in USD** (e.g. 100.50), NOT cents and NOT micro-USD. Our ledger is
  micro-USD, so convert and round to 2dp deliberately rather than letting a float decide.
- `idempotencyKey` **required**. Use the payout statement id.
- `paymentMethod`: ach | check | domesticWire | internationalWire | realTimePayment.
- `purpose` object **required** for domesticWire and internationalWire.
- ⚠ `chargeType`: `ours` (Mercury charges **$15**, recipient gets the full amount) or `shared`.
  **If omitted on a USD international wire it DEFAULTS TO `ours`**, so every international payout
  silently costs $15 unless the field is set deliberately.
- Returns `requestId` and `status`: pendingApproval | approved | rejected | cancelled.

⚠⚠ **This changes what "paid" means in `payOne()`.** A successful call means QUEUED, not sent. The
current code debits the creator and treats a successful disburse as final. With an approval step, a
REJECTED or CANCELLED request must re-credit the creator. That path does not exist yet and has to be
built.

`GET /accounts` returns `{ accounts: [...], page: {...} }`, and each account carries `type`:
mercury | external | recipient. **Filter on `type === 'mercury'`**; recipients come back from the
same endpoint.

`GET /recipient/{id}` also carries `isBusiness` (individual vs entity, which is W-8BEN vs
W-8BEN-E), `defaultPaymentMethod`, and `address.country`, which is a second country signal for both
the sanctioned-country gate and the tax-sourcing question.

---

## 10. Mercury's binding terms, read 2026-09-24

The "marketplace / MSB / money transmission" language that looked like a blocker appears in
**exactly one place: the API documentation's "Valid uses for the transaction API" note.** It is not
in any agreement Vergr signed. Read in full:

**Mercury Terms of Use §1.4 Prohibitions** is the complete list of prohibited uses. The only
business-type prohibition in it is:

> "Use the Account or the Services for **online gambling transactions**, whether or not gambling is
> legal where you operate."

No restricted-business list. No marketplace clause. No money services business clause. The rest of
1.4 covers OFAC parties, non-commercial use, impersonation, scraping and abuse.

**Mercury Terms of Use §9 "No Money Transmission"** is not a restriction on the customer:

> "**Mercury** does not transmit money or monetary value on your behalf... Any movement of funds
> occurs through our partner banks or other regulated financial institutions."

That is Mercury describing its own regulatory position.

**Choice Financial Group Commercial Deposit Account Agreement §1.5 Prohibited Uses**, the bank's own
agreement accepted at signup: illegal transactions, online gambling, and funds that are qualified
settlement funds, tax-qualified retirement trusts, or IOLTA/IOLA client funds. No marketplace
clause, no MSB clause.

### ⚠ Two clauses a strict reader could point at

- **ToU §1.4:** "Use the Account or the Services for **any third parties**."
- **International Wire Services Addendum §4:** "You must not submit any Wire Instructions **on behalf
  of or for the benefit of any person or organization other than you**."

Both are standard anti-nesting language: do not run banking as an agent for someone else. Paying
your own creditor discharges your own liability, which is your own benefit, and otherwise no Mercury
customer could pay a vendor. But they exist and should not be discovered later.

### ⚠⚠ Wise US Inc is in the international path

**International Wire Services Addendum §1:**

> "The International Wire Services Providers are **Column National Association, Member FDIC, and
> Wise US Inc.**"

Vergr would hold no Wise account and no relationship with them ("you are not establishing an account
or other contractual or formal banking relationship with any International Wire Services Provider"),
but Wise is in the rail for non-USD payouts. **Founder decision, raised explicitly because there is a
standing rule against Wise.**

### The fee model is confirmed in the binding terms

**Addendum §15:**

> "For each International Wire Transfer you send **in a currency other than USD**, we assess a
> foreign exchange fee, calculated as a percentage of the Wire Instruction Amount at the time it is
> converted. For each International Wire Transfer you send in USD, we may assess a fee based on the
> payment method used."

So non-USD sends exist as a product and the percentage is the 1% on the pricing page. The cost table
in section 1 stands.

⚠ **Still not established: whether the API can request a non-USD send.** `amount` is documented as
USD with no currency parameter, while the response carries `currencyExchangeInfo`. The likely answer
is that the currency follows the recipient's own bank details. **Resolve it with one test call, not
by asking anyone.**
