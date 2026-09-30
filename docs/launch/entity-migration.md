# Murmont LLC -> Vergr LLC migration: Google Play, payments, and the Mercury unlock

Researched and written 2026-09-22. Every claim below is quoted from a Google help
article or a Mercury help article, with the URL. **Do not repeat any of it from memory,
re-read the source before acting**, because the earlier note in `CLAUDE.md` saying "No app
transfer is required" was HALF WRONG and is corrected here.

---

## 1. The finding that decides everything: there are TWO payments profiles

Google says it in its own words, and the project notes did not distinguish them:

> "If you monetize your apps, you also set up a payments profile when creating your merchant
> account. Don't confuse this with the payments profile used for identity verification."
> — [Update developer identity details managed by a Google payments profile (16260648)](https://support.google.com/googleplay/android-developer/answer/16260648?hl=en)

| | Identity / verification profile | Merchant / payout profile |
|---|---|---|
| What it does | proves the developer's legal name + address (D-U-N-S for orgs) | receives Play Billing revenue, holds the payout bank account |
| Where | Play Console > Developer account > About you | Play Console > Payments settings / payments centre |
| **Can it be changed?** | **YES** | **NO** |

**Identity profile, changeable** (16260648): About you > Update details > Create or Select
payments profile > verify identity > back to About you > "Link your payments profile to your
developer account" > Confirm and save. Country, account type and D-U-N-S cannot be edited on
an existing profile, which is exactly why a NEW profile is created and linked.

**Merchant profile, permanent:**

> "You can link a Play Console and payments profile only once. After they're linked, they
> can't be unlinked or changed." ... you must "sign up for a new developer account using a new
> payments profile, pay another registration fee, and transfer any existing apps to the new
> developer account."
> — [Link a Google Play developer account to your payments profile (3092739)](https://support.google.com/googleplay/android-developer/answer/3092739)

### What that means for the goal

The goal is Play revenue landing in **Mercury, in Vergr LLC's name**. Google requires the
payout bank account name to match the legal name on the merchant profile. The current
developer account's merchant profile is **Murmont LLC, permanently**. So:

- Swapping the **identity** profile alone makes the store say Vergr LLC while the money still
  pays a Murmont merchant profile that can only hold a Murmont-named bank account. **That does
  not achieve the goal.**
- The only documented route to a Vergr LLC merchant profile is a **new developer account plus
  an app transfer**.

### Why this is cheap right now and expensive later

An app transfer preserves package name, listing, install history, ratings, reviews and
subscriptions ([Transfer apps to a different developer account (6230247)](https://support.google.com/googleplay/android-developer/answer/6230247?hl=en)).
What does NOT transfer: orders created before the transfer, earnings reports, promotions.

Vergr has **zero of all of it**: no public launch, no revenue, no subscribers, no reviews,
no orders. So the transfer costs nothing but the registration fee and the paperwork. Every
month closer to launch makes this harder. **Now is the cheapest this will ever be.**

---

## 2. One phone call could collapse this plan, make it first

Google shipped a newer flow, [Transferring ownership of a Play Console developer account
(16909862)](https://support.google.com/googleplay/android-developer/answer/16909862?hl=en):
the owner transfers the whole account to a **new organization**, 7 day hold, the incoming
owner selects their own payments profile. Organization accounts are eligible (only
"individual developers who monetize their apps" are excluded, and Murmont is an organization).

**Google's article does not say what happens to the merchant account or payouts.** If
ownership transfer also re-points the merchant profile, it replaces Phases 2 and 4 below,
saves the registration fee and avoids the app transfer entirely.

**ACTION: ask Play support this exact question before doing anything else.** Suggested
wording: "Our organization developer account is registered to Murmont LLC. We need the
merchant account and payouts to be under a different legal entity, Vergr LLC. Does the
developer account ownership transfer to a new organization also move or allow a new merchant
payments profile, or is a new developer account plus app transfer the only route?"

Cost: one support ticket. Upside: removes the fee and the transfer.

---

## 3. Founder decisions required before any step runs

1. **The Play developer registration fee (one time) is a spend.** Not authorised, not paid.
   Everything in Phase 2 waits on an explicit yes.
2. **Confirm there is nothing to lose:** no public production launch, no installs, no reviews,
   no paying subscribers. (This is believed true, the founder confirms it.)
3. **The pending Play submission.** 1.0.215, the listing text and the 6 country changes are in
   review. Decide: let it finish and publish, or withdraw it, before a transfer starts.

---

## 4. The plan

### Phase 0, pre-flight (free, reversible, do regardless)

- [ ] **D&B record check.** The Vergr LLC D-U-N-S record's legal name and address must match
      what will be typed into Google **exactly**: Vergr LLC, 212 N. 2nd St, Ste 100, Richmond,
      KY 40475. A mismatch raises Google's "no longer verified" banner with a deadline, whose
      stated consequence is account restriction and removal of the apps. Fix at D&B first if
      it differs.
- [ ] **Capture the Mercury numbers** (account + routing) off the deposit screen. This is
      reachable with the dashboard still locked.
- [ ] **Ask Play support the Section 2 question.** If the answer is yes, skip to Phase 2b.
- [ ] Confirm the EIN document is to hand: **35-2982976**, assigned 09/17/2026 (IRS fax; the
      CP 575 follows by post).

### Phase 1, resolve the pending submission

- [ ] Let the in-review changes finish, or withdraw them. **Do not leave a review pending
      across a transfer.** Never publish over a rejection.

### Phase 2, the Vergr LLC developer account (needs the fee decision)

- [ ] **A second Google account is required as owner.** One Google account can own one Play
      developer account, and vergenerd@gmail.com already owns Murmont's. Use an ops address
      (the `ops-*@vergr.app` Spacemail catch-all pattern already planned for the operator
      identity).
- [ ] Register the developer account: **Organization**, Vergr LLC, the KY address, the Vergr
      D-U-N-S, EIN 35-2982976.
- [ ] Complete Play's developer verification. Expect days, not minutes.

### Phase 2b, if ownership transfer turns out to cover the merchant profile

- [ ] Follow 16909862 instead: transfer ownership to the new organization, 7 day hold, the
      incoming owner selects the Vergr LLC payments profile. Then continue at Phase 3.

### Phase 3, merchant profile + the Mercury unlock (the two birds step)

- [ ] On the new account, create the **merchant account / payments profile as Vergr LLC**.
- [ ] Tax info: **W-9** with the EIN and the business name, matching what Google reports to
      the IRS.
- [ ] Add the payout bank account: the **Mercury** account and routing numbers from Phase 0.
      The account holder name (Vergr LLC) matches the profile name, which is the whole point.
- [ ] ⚠ **Choose "verify in 2-3 days with deposit", NOT instant verification.** This is the
      step that makes Google actually send money. Instant verify moves nothing and leaves
      Mercury locked. Source:
      [Verify bank account (7161378)](https://support.google.com/googleplay/android-developer/answer/7161378?hl=en)
      and [Enter merchant bank account information (7161440)](https://support.google.com/googleplay/android-developer/answer/7161440?hl=en).
- [ ] Wait up to 3 business days. The credit is **under US$1.00**, labelled
      "Google Deposit [statement name]". The US is NOT on Google's wire-transfer list, so EFT
      applies and a test deposit IS sent (7161378 names the countries where it is not).
- [ ] **Mercury unlocks.** Mercury's BUSINESS deposit article is the source, not the personal
      one: *"To start using Mercury, you'll need to deposit money into your account. You can
      make your first deposit by wiring funds, transferring money from another account,
      depositing a check, issuing a SAFE, or requesting a payment from a customer or financial
      platform."* Google's credit is a payment from a financial platform, and **no minimum
      amount appears anywhere in that article**.
      [Deposit funds to your Mercury Business account](https://support.mercury.com/hc/en-us/articles/43480243196052-Deposit-funds-to-your-Mercury-Business-account-wire-ACH-check-invoice)
- [ ] ⚠ **The apparent chicken-and-egg (read the amount in Mercury, which needs a deposit) has
      three independent outs, so it is not a deadlock.** (1) The Google deposit IS the first
      deposit, so it lifts the gate itself. (2) Mercury's **Cash flow** notification ("tracks
      money moving in and out of your account", Email & push) is in the high-priority group and
      arrives by email regardless of dashboard state, though Mercury does not document whether
      the email prints the amount.
      [Managing your notification settings](https://support.mercury.com/hc/en-us/articles/47493071225748-Managing-your-notification-settings)
      (3) Google's own instruction is to get the amount "using your bank statement **or by
      calling your bank**", and Mercury support is reachable by message without the dashboard.
- [ ] ⚠ **Google gives a DROPDOWN of candidate amounts, not a free-text box:** *"use the
      dropdown to select the amount that was deposited into your account by Google, then click
      Verify."* Path: Play Console > Settings > Payments settings > How you get paid > Choose
      payment method > **Fix**.
- [ ] **Download the Mercury bank letter** (admin only): PDF on Choice/Column letterhead with
      the legal account holder name, routing number, account number and account type. This is
      the "bank ownership proof in the name Vergr LLC" that Coda asked for.
      [Getting a bank letter](https://support.mercury.com/hc/en-us/articles/28768788092436-Getting-a-bank-letter)
- [ ] Send it to Coda.
- [ ] Back in Google, enter the deposit amount and verify the bank account.

### Phase 4, move the app

- [ ] Both accounts must be fully registered and active, and the destination must already have
      a payments profile because the app has in-app purchases. Phase 3 satisfies that.
- [ ] Submit the app transfer for **com.vergr.desktop**. Support replies within about 2
      business days.
- [ ] Confirm on the new account: package name, store listing, tracks, install history,
      ratings and reviews all present.

### Phase 5, rebuild what does not travel

- [ ] **Service accounts must be re-invited on the new account** with *View financial data* and
      *Manage orders and subscriptions*, or `redeemPlayPurchase` and `syncPlaySubscriptions`
      break silently: `vergr-44494@appspot.gserviceaccount.com` and
      `674096624319-compute@developer.gserviceaccount.com`.
- [ ] **Verify the 26 in-app products survived** (8 coin packs, 9 VP packs, 7 boosts, plus
      sub_lite and sub_pro). If any are missing, `scripts/playCreateProducts.mjs` recreates
      them from `docs/play/play-products.csv` + `play-prices-by-market.csv`. That script needs
      **Admin** on the account, which must be granted and then revoked again.
- [ ] **Check the Play App Signing key.** If the app signing certificate changes on transfer,
      `public/.well-known/assetlinks.json` must list the new SHA-256 or App Links break for
      every Play install. Today it lists Google's app signing key `95:08:CA:73...` and the
      upload key `EC:26:E2:EE...`. **Unverified, check it, do not assume it is unchanged.**
- [ ] Re-create: license testing list, internal + closed tester lists, the open testing
      feedback email.
- [ ] Store listing text is backed up at `docs/play/store-listing.md`, byte-verified against
      the live field, so it can be restored exactly.

### Phase 6, the other accounts still in Murmont's name (separate jobs, not this one)

AdMob (its own payments profile), PayRam, Circle, Relay. Changing Play changes none of them.

### Phase 7, code and docs

- [ ] `OPERATOR.playPublisher = 'Murmont LLC'` in
      `src/screens/marketing/legal/legalContent.js` becomes Vergr LLC **on the day the store
      listing shows Vergr LLC**, not before: Google checks that the Child Safety Standards page
      names the developer as the listing does. They currently disagree in the other direction.
- [ ] `CLAUDE.md` migration section corrected (done as part of this document).

---

## 5. Stop conditions

- **Never put a Vergr LLC bank account on Murmont's merchant profile.** Name mismatch.
- **Never start the identity switch and stall.** The D&B mismatch banner carries a deadline and
  Google's stated consequence is removal of all apps from Google Play.
- **Never press Publish over a rejection**, and do not leave a review pending across a transfer.
- **The registration fee is not authorised** until the founder says so.

## 6. Open questions, flagged rather than guessed

1. Does developer account ownership transfer also move the merchant profile? Google's article
   is silent. **Ask support (Section 2).** This is the one answer that could delete half the plan.
2. Can an app transfer proceed while a release is in review? Unconfirmed.
3. Does Play App Signing change the certificate on transfer? Unconfirmed, and it affects
   `assetlinks.json`.
4. Do the 26 one-time products and 2 subscriptions survive the transfer intact? Subscriptions
   are documented as transferring; the one-time catalogue is not explicitly stated.
