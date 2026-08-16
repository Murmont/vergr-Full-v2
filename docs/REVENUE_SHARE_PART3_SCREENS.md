# Revenue Share — Part 3: Screens

> ⚠ **SECTIONS 16-18 ARE SUPERSEDED.** They predated the built backend and the
> founder decisions of 2026-08-14 (50% floor, $100 minimum, cadence ladder,
> strikes). The live mockup brief is **docs/REVENUE_SHARE_MOCKUP_BRIEF.md**,
> which is standalone and uses real field names.
> Sections 15 and 19-21 of this file are still current.

Companion to Parts 1 and 2. **This part is written to be handed to a designer.**
Sections 16 and 17 are the mockup brief.

---

## 15. The structural split

The current `/wallet` tree does two unrelated jobs in one place:

- **Buyer job:** hold coins, buy more, see what you spent.
- **Creator job:** see what you earned, get paid.

Under the revenue share model these must separate, because they are legally
different things. The buyer holds a **licence balance**. The creator is owed a
**payable**. Showing them in one "wallet" is exactly the framing that makes it
look like an account holding money.

### 15.1 Proposed split

| Surface | Route | Audience | Contains |
|---|---|---|---|
| **Coins** (renamed from Wallet) | `/wallet/*` kept, labelled "Coins" | everyone | Coin balance, Buy, Cart, purchase history, security/PIN |
| **Earnings** | `/creator/earnings` **(already exists)** | creators | Revenue share tier, accrued, next payout, payout method, tax status, statements |

**Note:** `/creator/earnings` already exists and is already in the Creator Studio
nav (`src/components/creator/CreatorLayout.jsx:21`, `key:'earnings'`, icon `paid`,
`lock:'lite'`). There is also a native mirror,
`src/screens/creator/native/NativeCreatorEarningsScreen.jsx`. **The nav entry you
asked for is already there**; this plan expands what sits behind it.

### 15.2 Decision needed before design starts

Founder said "moved into the creator menu". The buyer side cannot move there,
because non-creators need to buy coins and Creator Studio is `lock:'lite'`.

**Two options:**

- **A (recommended):** split as above. Buyers keep a simplified Coins surface;
  creators get Earnings in Creator Studio. Cleanest legally, since the two
  concepts never appear on one screen.
- **B:** move everything into Creator Studio and drop the `lock:'lite'` gate on
  Earnings. Simpler navigation, but a buyer with no creator intent lands in
  Creator Studio to top up, which is odd, and it keeps balance and payable
  adjacent.

**Everything below assumes A.**

### 15.3 Removals — need explicit sign-off

Per the hard rule in `CLAUDE.md`, nothing is deleted without permission. These are
**proposed** and each becomes a redirect, not a deletion, unless told otherwise:

| Surface | Why it goes | Proposed fate |
|---|---|---|
| `/wallet/convert` (`ConvertScreen.jsx`, 382 lines) | conversion becomes automatic accrual | redirect to `/creator/earnings` |
| `/wallet/withdraw` (`WithdrawScreen.jsx`, 554 lines) | no on-demand pull | redirect to `/creator/earnings/payout-method` |
| Gem transfer entry points | decision 4, removed | remove UI, keep callable disabled server-side first |
| `ConvertCoinsScreen.jsx` (legacy) | same | already redirected per `AppRouter.jsx:965-968`, confirm |
| `RequestPayoutScreen`, `PayoutSuccessScreen`, `PayoutScreens` | replaced by scheduled runs | redirect |
| Gem balance tile on `HomeScreen.jsx:165` | gems stop being a held balance | replaced by a link to Earnings |

---

## 16. MOCKUP BRIEF — `/creator/earnings`

The primary new screen. Replaces the creator-facing half of the wallet.
Current file is 246 lines and already has charts worth keeping
(`src/screens/creator/CreatorEarningsScreen.jsx`).

**Page title:** Earnings
**Subtitle:** Your revenue share and payouts

### Block 1 — Revenue share tier (hero)

The most important thing on the page. This is the progression hook.

- **Huge number: `60%`** with label "You keep"
- Tier name and position: "Tier 3 of 7"
- Progress bar to next tier
- Under it: "Earn $750 more to reach **65%**"
- Secondary stat: "Lifetime earned: $1,240"
- Tier ladder, collapsed by default, expandable to show all 7 rows with the
  current one highlighted (mirrors the existing rank-ladder pattern on
  `VPRanksScreen`)

Copy note: never the word "commission" or "fee". The frame is what the creator
**earns**, not what is taken.

### Block 2 — Money, three tiles

| Tile | Label | Sub | Notes |
|---|---|---|---|
| 1 | **Available** | "Ready for next payout" | headline figure, brand gold |
| 2 | **Clearing** | "Available after {date}" | inside the hold window |
| 3 | **Paid to date** | "Lifetime" | muted |

No Withdraw button anywhere. That is the point.

### Block 3 — Next payout card

Prominent, directly under the tiles.

- "**Next payout: 1 September**" with a countdown
- Amount going out: `$142.50`
- Cadence badge: **Standard** / **Established** / **Priority**
- Progress to the next cadence stage:
  "2 of 3 payouts complete · 45 of 90 days · no strikes"
- **Below-minimum state:** "You are $18 short of the $50 minimum. Your balance
  rolls over to the next run, nothing is lost."
- **Blocked state:** if tax form or partner account is missing, this card turns
  into the blocker with a single CTA. **Nothing is paid until both are done.**

### Block 4 — Getting paid (setup and status)

Two rows, each with a clear done / not-done state:

| Row | States |
|---|---|
| **Payout account** | Not connected → "Connect" CTA · Connected → partner name, masked account, "Change" |
| **Tax form** | Required → "Complete" CTA (blocking) · On file → form type + date, "Replace" |

Plus KYC level row, reusing the existing `SecRow` pattern from
`src/screens/wallet/v2/HomeScreen.jsx:451-453`.

### Block 5 — Where it came from

Largely **reuse what already exists** in `CreatorEarningsScreen.jsx`:

- Stacked "Revenue over time" chart (line 144)
- "Revenue sources" breakdown (line 153)
- "Top supporters" (line 179)

One change: every figure switches from coins to **your share in currency**, with
the gross available on hover or as a secondary line. The creator should see what
they earned, not what the buyer paid, with the gross visible for transparency.

Sources to list: Tips, Memberships, Locked content, Paid streams, Content packs,
Vergr.me sales, Ad revenue. **Not** tournaments or coaching, both retired
2026-08-09.

### Block 6 — Statements

Replaces "Recent transactions".

Row per payout run:

```
1 Aug 2026    Aug run    Gross $240.00 · your 60% · $144.00    PAID    →
1 Jul 2026    Jul run    Gross $180.00 · your 55% · $99.00     PAID    →
1 Jun 2026    Jun run    Below minimum, rolled over            ROLLED  →
```

- Click opens the **Statement detail** screen (§17)
- "Download CSV" for the year, for tax
- Empty state: "Your first statement appears after your first payout run."

---

## 17. MOCKUP BRIEF — Statement detail (new screen)

Route: `/creator/earnings/statement/:runId`

**This screen matters legally**, not just as UX. It is the remittance advice that
evidences a supplier payment rather than a balance withdrawal. It should read like
an invoice, not like a transaction receipt.

Contents:

- Header: period covered, run date, status
- **From:** Murmont LLC, address
- **To:** creator legal name (from the tax form), not the display handle
- Line items grouped by source:
  `Tips · gross $120.00 · your share 60% · $72.00`
- Totals: gross revenue generated, your share %, **amount payable**
- Deductions, if any: clawbacks, refunds unwound, adjustments
- Payment: method, partner reference, date sent, status
- Footer: "Paid under the Vergr Creator Revenue Share Agreement" with a link

Download as PDF is desirable but not required for v1.

---

## 18. MOCKUP BRIEF — `/wallet` simplified (buyer side)

Current `HomeScreen.jsx` is a 3-column balance grid of Coins / VP / Gems
(line 8 comment). Under the split:

**Keep:** Coins tile with Buy, VP tile (progression, unchanged), Buy / Cart /
purchase history, security chips (PIN, 2FA, KYC).

**Remove:** the Gems tile (line 165), the Convert button (line 120), the Withdraw
button and its lock overlay (lines 172-178), "Withdraw gems to crypto/bank" quick
action (line 200), the Withdrawal limits section (line 432).

**Add:** a single link row, only for users with any earnings:
"You have earnings — view in Creator Studio →"

Screen label changes from "Wallet" to "Coins" throughout.

---

## 19. Backend work implied by these screens

Not a full backend spec, that is Part 4. This is what the screens require to exist.

| Need | Where |
|---|---|
| `creator_payable` ledger, per-creator accrued balance | new; `functions/platformRevenue.js` has the shape for the other half |
| Rate resolution from `totalEarnedCoinsGross` | replaces `commissionForVP` in all three mirrors |
| Single-rate accrual at every earning site | `earnedGemCredit` and `settleEarnedToGems` already do the plumbing, they need repricing |
| Payout run cron | new; replaces `processReadyWithdrawals` in `functions/withdrawals.js` |
| Cadence stage resolution (age, count, strikes, KYC) | new |
| Partner integration: create payee, send batch, ingest status | new, partner-specific |
| Tax form status on the user record, gating payout eligibility | new, likely partner-provided |
| Statement generation per run | new |
| Admin finance reports (Part 2 §13.1) | new `/admin/finance` |
| Remove `gemTransfer` callable + rules | `functions/gemTransfer.js`, `firestore.rules` |

---

## 20. Native mirrors

Every screen above has a native counterpart that must match:

- `src/screens/creator/native/NativeCreatorEarningsScreen.jsx`
- `src/screens/wallet/native/NativeWalletScreens.jsx` (Home, Convert, Settings,
  History, Kyc, Buy, Deposit)

Per memory `feedback_batch_native_work` and `feedback_native_report_means_apk`:
**all native work batches into ONE build at the end**, and nothing is considered
done on native until an APK ships. Do not build per-screen.

---

## 21. Order of work (proposed)

1. Fix the five ToS/code contradictions (Part 2 §9). Independent of everything
   else and wrong today.
2. Draft the Creator Revenue Share Agreement. **Everything else implements what
   this asserts, so it goes first.**
3. Backend: single-rate accrual + `creator_payable` ledger. No UI change yet.
4. Payout partner selection and integration.
5. Payout run cron + cadence ladder.
6. Screens per this document, web first.
7. Admin finance reports.
8. Public marketing and legal copy (Part 2 §14).
9. Native batch, one APK.

Steps 1 and 2 can start immediately. Step 3 is unblocked. Steps 4 and 5 depend on
the partner choice, which is the long pole and should be started in parallel with
1-3 rather than after them.
