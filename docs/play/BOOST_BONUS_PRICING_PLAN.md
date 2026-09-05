# Boosts + VP bonuses: USD pricing, Play geo pricing, and the web rail

**STATUS: BUILT, SHIPPED + DEPLOYED 2026-08-30.** Source, functions and the Play
tables are all live. The one remaining action is the founder's: create the 16
products in Play Console (§8).

§7 records the wrong turns, including two wrong pricings that both looked right.

---

## 1. THE THREE ASKS

1. **Redo the pricing for boosts and VP bonus packs.** They are products with a
   USD price. A user is only charged COINS if the wallet covers it. ✅
2. **Do the Google Play geo pricing for them**, the same way the coin packs were
   done. ✅ 40 markets, in `docs/play/play-prices-by-market.csv`.
3. **Google Pay is not selectable on the web** and why. ✅ §3. Not a bug and not
   fixable in Play Console.

---

## 2. WHAT ALREADY EXISTED (and should have been read first)

The entire Play pricing pipeline was already built and is the source of the live
prices.

| File | Role |
|---|---|
| `src/utils/storePricing.js` | the model: `playPriceFor()`, `playItemPriceFor()`, `TAX_INCLUSIVE_MARKETS`, `PLAY_SERVICE_FEE` |
| `scripts/playPricing.mjs` | **the source of the Play Console table.** `--csv` writes to `docs/play/` |
| `docs/play/play-products.csv` | one row per product. Now **26**: 8 coin packs + 2 subs + 16 store items |
| `docs/play/play-prices-by-market.csv` | **the geo pricing**, a price per country per product |
| `docs/play/play-blocked-countries.csv` | mirrors `functions/geo.js BLOCKED_COUNTRIES` |

**Proof this is what is live:** `play-prices-by-market.csv` row 1 is
`United States,US,USD,…,1.09,…` for `coins_starter`, and Play Console shows USD
1.09 for the United States. The pipeline and reality agree, and the coin packs
were therefore left completely alone.

⚠ **Play Console removed CSV import on 19 May 2025.** The CSVs are a reference to
type from, or to feed the Play Developer API. There is no bulk upload button.

---

## 3. ⚠ WHY GOOGLE PAY CANNOT BE SELECTED ON THE WEB

Not a bug, and not fixable by configuring anything in Play Console.

**Google Play Billing is an Android-app API.** `isPlayBillingSupported()` returns
true only when `window.VergrBilling` exists, which is the Kotlin `BillingBridge`
compiled into the Play build (`src/utils/nativeBilling.js`). A browser has no
bridge, so the row is correctly unavailable and `googlePlayAvailable` is false.

**Play Console products are IAPs redeemable only inside the installed app.**
Creating `boost_post` in Console grants nothing on the web.

**Google's own policy confirms the split.** Play billing is required only for
purchases *inside* a Play-distributed app; developers may transact freely
outside it.
([Payments policy](https://support.google.com/googleplay/android-developer/answer/10281818))

**Google Pay is a different product from Google Play Billing.** Play Billing
sells digital goods inside an app. Google Pay is a card wallet, added on the web
as a payment METHOD inside a processor, never through Play Console.

### If Google Pay on the web is wanted, it is separate work

It would be added to the PayRam rail as a wallet option. It does not use Play
Console, does not use the Play price table, and Google takes no 15% on it;
PayRam's own settlement fee applies, which `checkoutFees.js` already models.
**Founder decision, and not part of this work.**

---

## 4. ⚠⚠ THE PRICING RULE

```
priceUSD = charmRound(max(coins × RETAIL_COIN_USD, $0.99))
RETAIL_COIN_USD = $0.99 / 78 = $0.0126923
```

**The anchor is what a buyer actually PAYS for a coin**, which is the Starter
pack, the ladder's worst per-coin rate. `functions/payram.js` already uses this
exact number as `CUSTOM_COIN_PRICE_USD`, with the reason spelled out there: a
custom amount must never undercut a pack. This is the mirror of that rule.

**So a coin has ONE value on both routes.** That is the whole answer to "are you
trying to devalue the coins": no. The cash price is *derived from* the coin
price, at retail.

**$0.99 is Google Play's US minimum.** It binds on everything under 78 coins,
which is why five small items sit at $0.99 in cash. That is the floor's doing,
not a designed premium, and on those items coins genuinely are the better buy
(78 coins for the same $0.99). The card shows both prices so the buyer can see
it.

### The shipped table

| item | coins | retail | **shelf** | **Play Console (US)** | cheapest pack that buys it |
|---|---|---|---|---|---|
| Happy Hour | 25 | $0.32 | **$0.99** | $1.19 | 78c $0.99 |
| Teammate Search | 25 | $0.32 | **$0.99** | $1.19 | 78c $0.99 |
| Post Boost | 50 | $0.63 | **$0.99** | $1.19 | 78c $0.99 |
| Stream Boost | 50 | $0.63 | **$0.99** | $1.19 | 78c $0.99 |
| Flash Surge | 75 | $0.95 | **$0.99** | $1.19 | 78c $0.99 |
| Squad Boost | 75 | $0.95 | **$0.99** | $1.19 | 78c $0.99 |
| Watcher Surge | 100 | $1.27 | **$1.29** | $1.59 | 400c $4.99 |
| Profile Boost | 100 | $1.27 | **$1.29** | $1.59 | 400c $4.99 |
| Half-Day Surge | 120 | $1.52 | **$1.59** | $1.89 | 400c $4.99 |
| Creator Surge | 150 | $1.90 | **$1.99** | $2.39 | 400c $4.99 |
| Community Surge | 150 | $1.90 | **$1.99** | $2.39 | 400c $4.99 |
| Super Boost | 150 | $1.90 | **$1.99** | $2.39 | 400c $4.99 |
| Day Surge | 200 | $2.54 | **$2.59** | $3.09 | 400c $4.99 |
| Weekend Surge | 350 | $4.44 | **$4.49** | $5.99 | 400c $4.99 |
| Mega Boost | 500 | $6.35 | **$6.99** | $8.99 | 815c $9.99 |
| Long Surge | 900 | $11.42 | **$11.99** | $14.99 | 1650c $19.99 |

**Shelf = what Vergr nets. Console = grossed up so Google's 15% lands on the
buyer**, exactly as the coin packs work. Every Console price clears the $0.99 US
minimum and nets at least the shelf price.

⚠ **DURATIONS DID NOT CHANGE AND MUST NOT.** Founder: *"I did not say that you
can change the times, I only said change the prices."* One hour is still the
cheapest in coins, which is the ordering that was asked for; in cash the Play
floor flattens the bottom four, which is Google's constraint, not a re-spec.

---

## 5. ⚠ THE ASSERTION THAT CATCHES BOTH WRONG PRICINGS

> **An item must never cost MORE in cash than the cheapest coin pack that would
> buy it outright.**

Fail that and the cash button is irrational: the buyer pays less for the coins,
buys the same item, and keeps the change. Both wrong pricings failed it. It is
now in `scripts/coin-ladder-check.mjs` and **negative-tested in both
directions** (the guard was proven to fail on the $2.09 price before it was
believed passing).

A TIE passes on purpose: under 78 coins the $0.99 floor and the Starter pack are
the same money, and the spare coins are a real reason to prefer coins.

---

## 6. WHAT WAS BUILT

| # | File | Change |
|---|---|---|
| 1 | `src/utils/{vpBonuses,boosts}.js` | `priceUSD` on all 16. Coin prices UNCHANGED. |
| 2 | `src/utils/storeItems.js` **(new)** | the ONE resolver from a cart SKU back to an item |
| 3 | `src/utils/storePricing.js` | `playItemPriceFor(priceUSD, country)`, anchored on the item's own USD price, **never on its coin count** |
| 4 | `scripts/playPricing.mjs` | emits the 16 items into both CSVs. This IS ask #2. |
| 5 | `functions/{vpBonuses,boosts}.js` | `priceUSD` mirrors + `applyPack` / `creditBoosts` exported so a CASH purchase grants through the SAME helper a coin purchase uses |
| 6 | `functions/playBilling.js` | `PLAY_ITEM_PRODUCTS` + an item branch in `redeemPlayPurchase` |
| 7 | `functions/payram.js` | `STORE_ITEMS`, item lines in the cart, `itemSku` quick buy, and the grant in `settlePayramOrder` |
| 8 | `functions/circleWallets.js` | ⚠ see below |
| 9 | `src/utils/nativeBilling.js` | `playItemIdFor()` + `buyStoreItem()` |
| 10 | `src/screens/wallet/v2/buyCheckout.js` | a store item's SKU IS its Play product id, so it must not be run through `playProductIdFor()` |
| 11 | `src/components/wallet/StoreTabs.jsx` | one `useStoreBuy` rule for both tabs. **No dead cards.** |
| 12 | `src/components/wallet/StorePackCard.jsx` | affordability dimming gone; `secondary` price line added |
| 13 | `src/components/wallet/CartContents.jsx` | renders item lines with their own art |
| 14 | `scripts/coin-ladder-check.mjs` | 35 → **239** assertions, including one that resolves every shop SKU to a complete basket row |

⚠ **`circleWallets.js` HAD A SECOND SETTLEMENT PATH AND IT WOULD HAVE EATEN THE
ITEM.** When a Circle USDC deposit arrives carrying a PayRam `refId`, that file
credits `coinsToCredit` and marks the order settled **on its own**, knowing
nothing about items. A mixed basket would have credited the coins, dropped the
boost, and left no way to settle again. It now defers any order carrying items
to `settlePayramOrder`, exactly as it already defers subscriptions.

⚠ **`coinLedger.js`-style bundling applies here too:** `settlePayramOrder` is
bundled into `payramWebhook` AND `pollPayramOrders`. Both were redeployed
together, along with `circleWalletsWebhook` and `pollCircleDeposits`.

### The buy rule, in one place

`useStoreBuy` in `StoreTabs.jsx`, so a bonus and a boost cannot diverge:

```
wallet covers the coin price  →  spend coins, instantly, in place
otherwise, Play build         →  the Play sheet (vpb_* / boost_* IAP)
otherwise, web/desktop        →  add to the basket and open it
```

Both prices are always shown: the payable one large, the other quiet beneath it.

---

## 7. THE WRONG TURNS, SO THEY ARE NOT REPEATED

1. **Derived the cash price from the coin REDEMPTION rate** via
   `playPriceFor(item.coins)` → a 75-coin bonus at $1.09, which is what a
   78-coin pack costs. Nobody would ever buy it.
2. **Then anchored on the NET floor and doubled it** ($0.011628 × 2) → flash at
   **$2.09**, which is *worse for the buyer than the bug it replaced*: $0.99 buys
   78 coins, spend 75, keep 3. **A premium over the retail cost of an item's own
   coins is a price nobody can rationally pay.** The net floor is what a coin
   must be WORTH after Google's cut; it is not what anyone pays for one.
3. **Added a "Google Play fee" line to `quoteCheckout`.** The Play sheet charges
   exactly the Console price and nothing can be appended at runtime, so this
   would have printed a total the buyer is never charged. Reverted.
4. **Asserted the wrong coin-pack invariant** (that Console must net the shelf
   price) and produced $1.19 for Starter, contradicting the live $1.09. The real
   rule for a COIN pack is net ≥ the per-coin floor. For an ITEM it is net ≥ its
   own price. Two different products, two different invariants.
5. **Printed $1.16** by testing the unrounded quotient. $1.16 × 0.85 = $0.986,
   under the floor. Charm-round before asserting.
6. **Did not look for existing tooling.** `scripts/playPricing.mjs` and the CSVs
   already did most of this. Read `docs/play/` first.
7. **Proposed changing durations** to fit the price floor. Specs are not mine to
   change.
8. **The basket crashed on the first boost added, with a green build AND a
   green guard.** The line renderer branched at every field, and one survivor
   forty lines below the resolve (`pack.priceUSD * line.qty`, the line total)
   dereferenced null because a store item has no pack. Nothing caught it because
   no guard had ever resolved a boost SKU. Fixed by flattening both kinds into
   ONE non-null row in `rowFor()` and putting `pack`/`item` out of scope in the
   renderer, so the class is gone rather than the instance. The guard now
   resolves all 16 SKUs and asserts every field the basket renders.
9. **A multi-line anchor silently matched nothing** in `playBilling.js` and
   `payram.js`, because those two files are **CRLF** while the rest of the repo
   is LF. Every patch script now normalises anchor and replacement to whatever
   the file already uses. [[reference-mixed-line-endings]]

---

## 8. WHAT IS LEFT, AND IT IS THE FOUNDER'S

**Create the 16 products in Play Console**, from `docs/play/play-products.csv`:
one-time product, **consumable**, prices per `play-prices-by-market.csv`.

Until they exist, the Play build offers only the coin price, so a buyer with an
empty wallet cannot buy a boost on Android. The web rail works today.

---

## 9. VERIFICATION

- `node scripts/playPricing.mjs --csv` → **26 products, 40 markets**, every item
  clearing its market floor. Geo confirmed live: `boost_profile` = US $1.59,
  CHF 1.39, JPY 280, INR 189.99.
- `npm run check` → **239/239**, and the new half **negative-tested both ways**:
  drifting one mirror fails it, and the original $2.09 fails the dominance
  assertion with `item $2.09 vs 78 coins for $0.99`.
- `npm run build` clean, deployed to hosting, 9 functions redeployed.
- **Verified from the deployed artifact, not the source**: the live
  `StoreTabs-*.js` chunk contains the coins-or-cash branch, `"Pay with Google
  Play"`, `"Adds to your basket"`, and **no `disabled` prop at either call
  site**; the live `index-*.js` carries exactly the 16 corrected prices.
- Still untested end to end: a real Play purchase of an item (needs the products
  created), and a real card purchase of an items-only basket (PayRam has never
  completed a payment, see CLAUDE.md "Payments reality check").
