# 26 — One checkout: buy a boost or bonus without owning coins first

**STATUS: DESIGNED, BUILDING.** Rules: [00-RULES.md](00-RULES.md)

---

## 0. THE DEFECT, AND WHY IT IS NOT A STYLING BUG

Founder, 2026-08-28:

> *"if a user doesn't have coins and they add it to cart then they should... we
> can't create a design that prevents the user from checking out if they are
> already there and willing to pay, then they need to buy that amount of coins
> at the same time, we can't send them to go buy coins then come back to get a
> boost, that is extra steps that will result in a user deciding that they don't
> want to spend money anymore."*

He is right, and the first diagnosis of this was wrong in a way worth recording.

**What was reported:** the VP bonus and boost cards look like they have a dark
filter over them, and none of them can be added to the cart.

**The mechanical cause** (verified in source):

```js
// StoreTabs.jsx
const afford = coins >= p.coins;
disabled={!afford}
// StorePackCard.jsx
opacity: disabled ? 0.55 : 1
onClick={() => !dead && onClick?.()}
```

The cheapest item in BOTH tabs is 25 coins. The account had 24. So every card in
both tabs was one coin short, dimmed to 55%, and inert.

**The wrong conclusion** — which the previous session reached — was "working as
intended, they are gated on affordability, and cart is coin-packs-only by
design". That defends a checkout that turns a paying customer away. The correct
conclusion is that **the affordability gate should not exist at this point in
the funnel at all.**

⚠ **The rule this leaves: never make "you cannot pay yet" a dead end.** A user
at the shop with their card out is the most valuable state in the product. Any
design that sends them somewhere else first is losing money, however tidy it
looks.

## 1. THE MODEL

One basket. Two kinds of line.

| Kind | Example | Priced in | What checkout does |
|---|---|---|---|
| `coin` | 780 coins pack | USD | credits coins (exists today) |
| `bonus` | Watcher Surge | coins | credits coins, then spends them |
| `boost` | Profile Boost | coins | credits coins, then spends them |

**If the basket's coin-priced items cost more coins than the wallet holds, the
server adds the coins needed as an explicit line.** One total, one payment, one
checkout. The user never leaves.

### Worked example

```
Basket
  Profile Boost                     50 coins
  Kindle (1.5x VP, 6h)              25 coins
                                    ─────────
  coins needed                      75
  wallet balance                    24
  shortfall                         51
+ Coins for your basket   78 coins  $0.99      ← added by the server
                                    ─────────
  Total                             $0.99
```

After payment: 78 coins land, 75 are spent, **3 remain in the wallet**. Leftover
coins are the user's and stay there. That is the honest outcome and it is also
the one that makes the next purchase easier.

## 2. WHY THE SERVER PICKS THE COIN PACK, NOT THE CLIENT

`CartContext` is deliberately dumb: *"The cart holds SKUs and quantities.
Nothing else... A cart that carried its own prices would be a cart an attacker
could edit."* That property must not be lost.

So the client sends `{kind, id, qty}` lines and **nothing else**.
`getCoinPriceQuote` re-prices everything against `COIN_PACKS`, `VP_BONUS_PACKS`
and `BOOSTS`, reads the real wallet balance, computes the shortfall, and decides
which pack covers it. The client renders what it is told.

⚠ The balance is read SERVER-SIDE at quote and again at settlement. A client
that lied about its balance would otherwise get items for free.

## 3. ⚠ THE ORDER OF OPERATIONS IS A MONEY SAFETY PROPERTY

**Credit the coins FIRST, spend them SECOND, in the same transaction.**

If the spend fails for any reason, the user is left holding coins they paid for.
That is recoverable and honest. The inverse — spend first, credit second, or
spend outside the transaction — can leave someone charged with nothing to show.

⚠ This repo already has that scar: `creatorPayouts.payOne` debited a payable and
then called `disbursePayout()`, which throws unconditionally, and the catch
**left the debit**. Money vanished. Do not build the same shape.

Fulfilment is therefore:

1. `settleOrder` transaction credits `coinsToCredit` (existing code, untouched)
2. same transaction spends coins on `order.attachedItems` and writes the
   bonus/boost state
3. the order is stamped settled

Idempotency comes from the existing `payram_orders/{ref}.status` lock, which
already guarantees exactly-once across the webhook and the poller.

## 4. FILES

| File | Change |
|---|---|
| `src/context/CartContext.jsx` | lines gain `kind`; `add(kind, id, qty)`; storage migration for old `{sku,qty}` lines |
| `src/components/wallet/StoreTabs.jsx` | remove the affordability gate; cards add to cart |
| `src/components/wallet/StorePackCard.jsx` | drop the `opacity: 0.55` dead state |
| `src/components/wallet/CartContents.jsx` | render item lines + the auto-added coin line |
| `functions/payram.js` `getCoinPriceQuote` | price mixed baskets, compute shortfall, choose the pack |
| `functions/payram.js` `createPayramPayment` | persist `attachedItems` on the order |
| `functions/payram.js` settlement | spend coins on `attachedItems` after crediting |
| `functions/vpBonuses.js`, `functions/boosts.js` | export internal grant helpers the settlement can call inside its transaction |

⚠ **`/prestige` renders the SAME `StoreTabs`.** Both surfaces change together;
there is no second implementation to update, and there must not be one.

## 5. FOUNDER DECISIONS NEEDED

1. **Which coin pack covers a shortfall?** Recommendation: the cheapest single
   pack that covers it. It always overshoots a little, the leftover is the
   user's, and it keeps the basket to one added line instead of a puzzle.
2. **Should the auto-added coins line be removable?** Recommendation: no — it is
   what makes the basket payable. Removing an item reduces it automatically.

## 6. VERIFICATION

- With a balance BELOW the cheapest item: every card is full opacity, tappable,
  and lands in the cart.
- Cart shows the item lines, the auto-added coin line, and one USD total.
- After a test purchase: coins credited, items granted, leftover coins correct,
  exactly one `transactions` row per item.
- Replay the webhook: nothing double-grants (the `status` lock).
- A deliberately invalid item id: coins still land, nothing is granted, the user
  is not out of pocket.
- Both `/wallet/buy` and `/prestige` behave identically — same component.
