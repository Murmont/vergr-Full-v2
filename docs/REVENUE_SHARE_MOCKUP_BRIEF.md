# Vergr — Earnings & Payouts: UI Mockup Brief

**Standalone. A designer needs only this file.**
Supersedes §16-18 of `REVENUE_SHARE_PART3_SCREENS.md`, which predated the built
backend and several decisions. Every field name below is real and already exists
in code, so nothing here is aspirational.

Written 2026-08-14.

---

## 0. The one-paragraph context

Vergr is a gaming social platform. Viewers buy **coins** and spend them on
creators (tips, memberships, locked content, event tickets). Creators earn a
**percentage share of the revenue their content generates**, which climbs from
50% to 80% as they earn more. Vergr pays creators on a **schedule** (monthly at
first, faster as an account matures), not on demand.

**The single most important framing rule for all copy:** we never say
"commission", "fee", "withdraw", or "your balance". We say what the creator
**earns** and when they will be **paid**. This is a payout system, not a wallet.

---

## 1. What we need designed

| # | Screen | Route | Priority |
|---|---|---|---|
| 1 | **Earnings** (main) | `/creator/earnings` | **P0** |
| 2 | **Statement detail** | `/creator/earnings/statement/:runId` | **P0** |
| 3 | **Payout setup** | `/creator/earnings/setup` | **P0** |
| 4 | **Coins** (simplified buyer wallet) | `/wallet` | P1 |

All four need **desktop + mobile**. There is a native Android app that mirrors
these, so mobile is not an afterthought.

---

## 2. Design system (existing, must match)

Dark theme. Tokens from `tailwind.config.js`:

```
--brand-violet       #7B1FFF      --brand-violet-light #B44FFF
--brand-pink         #C87FFF      --brand-gold         #F0A500
--brand-gold-light   #F5C842      --brand-ember        #F04060
--gem-blue           #3D7FFF
--bg-dark            #0B0B14      --surface-1          #14141F
--surface-2          #1A1A2A
--text-primary       #FFFFFF      --text-secondary     #9CA3AF
--text-muted         #6B7280
```

⚠ **Do NOT use cyan (#4DFFD4).** It appears in older screens but is off-brand and
is being removed. Violet / pink / gold only.

**Fonts:** Syne (headings), DM Sans (body), **DM Mono for all numbers** with
`tabular-nums`. Every money figure and percentage uses DM Mono.

**Icons:** Material Symbols **Outlined** only.

**Money format:** USD, two decimals, `$1,240.50`. Coins shown as `1,240c`.
Percentages as whole numbers, `65%`.

---

## 3. SCREEN 1 — Earnings (`/creator/earnings`)

The creator's home for money. Page title **"Earnings"**, subtitle
**"Your revenue share and payouts"**.

### Block A — Revenue share tier (hero)

The emotional centre of the screen. This is the progression hook and should feel
like a rank card, not a bank statement.

Contents:

- **`65%`** — enormous, DM Mono, gold. Label beneath: **"You keep"**
- `Tier 4 of 7`
- Progress bar to the next tier
- **"Earn $760 more to reach 70%"**
- Small: `Lifetime earned  $4,240`
- **"View all tiers"** → expands an inline ladder of all 7 rows

The full ladder, for the expanded state:

| Tier | Lifetime earned | Creator keeps |
|---|---|---|
| 1 | $0 | 50% |
| 2 | $50 | 55% |
| 3 | $250 | 60% |
| 4 | $1,000 | 65% |
| 5 | $5,000 | 70% |
| 6 | $15,000 | 75% |
| 7 | $50,000 | 80% |

Current tier highlighted. Tiers already passed shown as achieved. Future tiers
shown but muted.

*Data:* `revenueShareTier(wallet.totalEarnedCoinsGross)` in
`src/utils/vpSystem.js` returns `{ tier, tierCount, share, nextShare, nextAt,
coinsToNext, progress }`. Everything above is already computed.

### Block B — Three money tiles

| Tile | Label | Value | Sub-label |
|---|---|---|---|
| 1 | **Available** | `$142.50` | "In your next payout" — gold, largest |
| 2 | **Next payout** | `1 Sep` | "in 18 days" |
| 3 | **Paid to date** | `$1,890.00` | "Lifetime" — muted |

**There is no Withdraw button anywhere on this screen. That is the point.**
Please do not add one, and do not design an affordance that looks like one.

*Data:* `wallet.gems` (1 gem = $0.01), next run date from cadence,
`wallet.totalPaidOut`.

### Block C — Next payout card

Sits directly under the tiles. Needs **five distinct states**, all of which will
be seen in practice.

**C1 — On track (the happy path)**
```
Next payout          1 September
$142.50 will be sent to your bank
Paid monthly  ·  Standard
```
Plus a subtle progress row toward the next cadence stage:
`2 of 3 payouts · 45 of 90 days · Get paid twice a month`

**C2 — Below the minimum**
```
$62 to go
You need $100 before a payout is sent. Your $38.00
carries over to next month, nothing is lost.
```
Reassurance is the whole job of this state. Progress bar toward $100.

**C3 — Setup incomplete (BLOCKING)**
```
⚠  Finish setup to get paid
You have $142.50 waiting.
[ Add your tax form ]        ← primary CTA
Payout account  ✓ connected
```
List each requirement with done / not-done. **The money is safe and should be
shown**, the block is only on sending it.

**C4 — Strike, reduced cadence**
```
Paid monthly
Your payout speed was reduced. It returns to twice
monthly on 12 February.
```
Amber, not red. Informational, not punitive in tone.

**C5 — Suspended (3 strikes)**
```
⚠  Payouts paused
Your account is under review. You are still earning
and nothing has been lost — $142.50 is being held.
[ Contact support ]
```
**Critical:** must not read as confiscation. Earnings continue to accrue.

*Data:* `payout_accounts/{uid}` → `cadence`, `strikes[]`, `taxFormStatus`,
`partnerPayeeId`, `successfulPayouts`, `firstPayoutAt`, `frozen`. Blocking reason
comes back as one of: `suspended_strikes`, `frozen`, `kyc_required`,
`tax_form_required`, `payout_account_required`, `below_minimum`.

### Block D — Payout speed (cadence ladder)

Three-step visual, current step marked. Sells the progression.

| Stage | Label | Requirement copy |
|---|---|---|
| **Standard** | Paid monthly | Where everyone starts |
| **Established** | Paid twice a month | 90 days, 3 payouts, ID verified, no strikes |
| **Priority** | Paid weekly | 180 days, 12 payouts, ID verified, no strikes |

Minimum is **$100 at every stage** — say so once, plainly, so nobody thinks
moving up costs them.

### Block E — Where it came from

Charts. These **already exist** in `CreatorEarningsScreen.jsx` and largely work;
they need restyling and a change of units, not reinvention.

- Revenue over time, stacked by source
- Revenue sources breakdown
- Top supporters

Sources: **Tips, Memberships, Locked content, Paid streams, Content packs,
Vergr.me sales, Ad revenue.**
⚠ **Not tournaments, not coaching.** Both retired, do not appear anywhere.

Each row shows **the creator's share** as the primary figure, with gross
available as a secondary or on hover:
`Tips   $840 earned   from $1,292 gross`

### Block F — Statements

Replaces "recent transactions".

```
1 Aug 2026   $144.00   Paid      →
1 Jul 2026    $99.00   Paid      →
1 Jun 2026        —    Rolled over  →
```

Row states: **Paid**, **Pending**, **Failed** (with "we're looking into it"),
**Rolled over**.

Plus **"Download CSV"** for the tax year.

*Data:* `payout_statements` where `uid == me`, ordered by `createdAt` desc.

### Empty states (all needed)

- **No earnings ever:** explain the 50% start and the climb. Should feel like the
  beginning of a progression, not an error.
- **Earnings but no payout yet:** "Your first payout will be sent on 1 September."
- **No statements:** "Statements appear after your first payout."

---

## 4. SCREEN 2 — Statement detail (`/creator/earnings/statement/:runId`)

**Should look like a remittance advice / invoice, not a receipt.** This is a tax
document and a legal record of a supplier payment. Formal, printable, plain.

```
─────────────────────────────────────────────
  VERGR                        STATEMENT
  Vergr LLC                    1 August 2026
─────────────────────────────────────────────
  PAID TO      Jordan Smith          ← legal name, not @handle
               jordan@example.com

  PERIOD       1 Jul – 31 Jul 2026
  STATUS       Paid  ·  1 Aug 2026
─────────────────────────────────────────────
  Tips              gross $120.00   65%   $78.00
  Memberships       gross  $80.00   65%   $52.00
  Locked content    gross  $21.50   65%   $13.98
─────────────────────────────────────────────
  Gross revenue generated              $221.50
  Your revenue share                       65%
  ADJUSTMENTS                            $0.00
  ─────────────────────────────────────────────
  AMOUNT PAID                          $143.98

  Method       Bank transfer ••••4821
  Reference    TRL-88213-A
─────────────────────────────────────────────
  Paid under the Vergr Creator Revenue Share
  Agreement.
```

Needs a **"Download PDF"** and a print stylesheet.

*Data:* `payout_statements/{runId}__{uid}` → `gems`, `amountMicroUsd`, `status`,
`partnerReference`, `paidAt`, `cadence`.

---

## 5. SCREEN 3 — Payout setup (`/creator/earnings/setup`)

Linear checklist. A creator cannot be paid until all four are green, so the
screen's only job is getting them there.

| Step | States |
|---|---|
| 1. **Verify your identity** | Not started / In review / Verified (Level 1 or 2) |
| 2. **Tax form** | Required / Submitted / On file (+ type + date) |
| 3. **Payout account** | Not connected / Connected (masked) |
| 4. **Confirm details** | Legal name + country, must match the tax form |

Show a persistent banner of what is waiting: *"$142.50 is ready once setup is
complete."* That is the motivation to finish.

Level 2 ID verification unlocks faster payouts — worth calling out at step 1.

---

## 6. SCREEN 4 — Coins (simplified `/wallet`) — P1

The buyer-side wallet. Today it shows Coins / VP / **Gems** with Convert and
Withdraw buttons. Under the new model gems are not a currency the user holds, so:

**Keep:** Coin balance + Buy, VP tile (progression, unchanged), Buy / Cart /
purchase history, security chips (PIN, 2FA, KYC).

**Remove:** the Gems tile, the Convert button, the Withdraw button and its lock
overlay, "Withdraw gems to crypto/bank", the Withdrawal limits section.

**Add:** one row, shown only to users who have earnings —
*"You have earnings → View in Creator Studio"*.

**Rename the screen from "Wallet" to "Coins"** throughout.

---

## 7. Copy rules (please hold the designer to these)

| Never say | Say instead |
|---|---|
| Commission, platform fee, our cut | Your share, you keep 65% |
| Withdraw, cash out | Get paid, your next payout |
| Your balance, your wallet | Your earnings, available |
| Gems | *(never shown to creators — always dollars)* |
| Convert | *(nothing — it happens automatically)* |

Tone: plain, calm, factual. It is someone's income. No hype, no exclamation
marks on money, no confetti on a payout.

---

## 8. What is already built (so the designer knows it's real)

- The 50-80% ladder, live in `functions/coinLedger.js`
- Tier + progress calculation, `revenueShareTier()` in `src/utils/vpSystem.js`
- The payout engine, cadence ladder, strike logic, statements and a dry-run
  preview, in `functions/creatorPayouts.js`
- `/creator/earnings` route, nav entry and charts already exist

Not yet built: the payout partner integration, the screens in this document.
