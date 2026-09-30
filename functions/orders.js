// functions/orders.js — what a purchase IS, independent of who takes the money.
// ─────────────────────────────────────────────────────────────────────
// Founder, 2026-09-26: the Coda checkout and Codashop must not live in PayRam's
// code, because PayRam is removed once Coda is live. So everything a rail
// SHARES lives here and nowhere else:
//
//   COIN_PACKS / STORE_ITEMS / plan prices   the server-authoritative catalogue
//   resolvePaymentOrder                      what is being bought, and its USD price
//   applyOrderPromo                          coin-sale bonus, reserved at order time
//   settleOrder                              credit it exactly once
//   priceSubscription / priceEurToUsd        plan pricing, FX fails closed
//
// Rails that use it: checkout.js (Coda, collection checkout_orders),
// codashop.js (Codashop, checkout_orders), payram.js (PayRam, payram_orders).
// A rail decides HOW money is collected; this file decides what it buys.

const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const functions = require('firebase-functions/v2');
const axios = require('axios');
const { creditReferralPurchaseBonus } = require('./referralRevenue');
const { regionalPrice } = require('./geoPricing');
const { assertNewSubscriptionsOpen } = require('./subscriptionSettings');
const coinPromos = require('./coinPromos');

const db = getFirestore('vgrdb');

// Order collections settleOrder may write. checkout_orders holds Coda and
// Codashop orders; payram_orders holds PayRam's until PayRam is removed.
const SETTLE_COLLECTIONS = new Set(['checkout_orders', 'payram_orders']);
// Rail -> ledger label. Delete the payram entry when PayRam goes.
const RAIL_LABELS = { coda: 'Coda', codashop: 'Codashop', payram: 'PayRam' };

// ── EUR→USD conversion (loss-proof) ──────────────────────────────────
// Subscriptions are priced in EUR (they carry regional multipliers) and charged
// in USD. The USD figure is always worth at least the EUR price.
//
// ⚠ The app_config field names below (payramEurUsd, payramEurUsdAuto,
// payramFxBufferPct) are legacy STORED KEYS, not a PayRam dependency. Renaming
// them would drop the founder's pinned rate, so they keep their names.
//
// Resolution order:
//   1. app_config/general.payramEurUsd  — manual founder pin (used verbatim)
//   2. live rate from open.er-api.com (free, no key) — cached 6h, last-good
//      value persisted to app_config/general.payramEurUsdAuto for fallback
//   3. last-good persisted value
//   4. otherwise: REFUSE the payment (never guess a rate that could undercharge)
//
// A safety buffer (app_config/general.payramFxBufferPct) is then applied so
// amountUSD = priceEUR × rate × (1 + buffer). The bias is always to charge
// slightly MORE USD — overcharging by the FX spread is acceptable;
// undercharging loses money and is not.
//
// RETIRED as a margin lever on 2026-08-11 (founder approved). Default is now 0.
//
// It was never a general-purpose lever, only an invisible markup on the EUR→USD
// hop. The catalogue is going native USD, and USD is both the displayed AND the
// charged currency, so for the buyer there is no conversion left to mark up.
// Keeping a buffer on a native USD price would either do nothing or double-
// charge on top of the itemised fees now shown at checkout. The margin it used
// to provide has been folded into the per-coin price instead, where it is
// honest and visible.
//
// The config field STAYS so the buffer can be switched back on without a deploy
// if a genuinely FX-exposed rail ever appears. Set app_config/general
// .payramFxBufferPct to re-enable. The mechanism below is untouched.
const DEFAULT_FX_BUFFER = 0;
const RATE_CACHE_MS = 6 * 60 * 60 * 1000;
let _liveRate = null;       // { rate, fetchedAt }

async function fetchLiveEurUsd() {
  const now = Date.now();
  if (_liveRate && (now - _liveRate.fetchedAt < RATE_CACHE_MS)) return _liveRate.rate;
  try {
    const resp = await axios.get('https://open.er-api.com/v6/latest/EUR', {
      timeout: 8000, validateStatus: () => true,
    });
    const r = Number(resp.data?.rates?.USD);
    if (resp.data?.result === 'success' && Number.isFinite(r) && r > 0) {
      _liveRate = { rate: r, fetchedAt: now };
      // Persist last-good for fallback (best-effort, don't block).
      db.doc('app_config/general').set(
        { payramEurUsdAuto: r, payramEurUsdAutoAt: FieldValue.serverTimestamp() },
        { merge: true }
      ).catch(() => {});
      return r;
    }
  } catch (err) {
    functions.logger.warn('FX live fetch failed', err.message);
  }
  return null;
}

// Returns the USD amount to charge for a EUR price, or throws if no trustworthy
// rate is available (fail closed — never undercharge).
async function priceEurToUsd(priceEUR) {
  let cfg = {};
  try {
    const snap = await db.doc('app_config/general').get();
    cfg = snap.exists ? (snap.data() || {}) : {};
  } catch { /* fall through */ }

  const pin = Number(cfg.payramEurUsd);
  let rate = (Number.isFinite(pin) && pin > 0) ? pin : null;
  if (rate == null) rate = await fetchLiveEurUsd();
  if (rate == null) {
    const lastGood = Number(cfg.payramEurUsdAuto);
    if (Number.isFinite(lastGood) && lastGood > 0) rate = lastGood;
  }
  if (rate == null) {
    throw new HttpsError('unavailable', 'Exchange rate temporarily unavailable. Please try again shortly.');
  }

  const bufferRaw = Number(cfg.payramFxBufferPct);
  const buffer = (Number.isFinite(bufferRaw) && bufferRaw >= 0) ? bufferRaw : DEFAULT_FX_BUFFER;
  const amountUSD = +(priceEUR * rate * (1 + buffer)).toFixed(2);
  return { amountUSD, rate, buffer };
}

// Coin packs — keys AND values mirror src/utils/vpSystem.js → COIN_PACKS
// exactly. NATIVE USD since 2026-08-11: coins are no longer priced in EUR and
// converted, they are priced in the currency the buyer is charged in.
//
// ⚠ Keep the coin counts and prices identical to vpSystem.js. This is the
// server-authoritative copy: the client names a pack, never an amount, and
// every price the buyer is shown or charged is re-derived here.
const COIN_PACKS = {
  starter:   { coins: 78,    priceUSD: 0.99,   vpBonus: 0    },
  gamer:     { coins: 400,   priceUSD: 4.99,   vpBonus: 0    },
  pro:       { coins: 815,   priceUSD: 9.99,   vpBonus: 0    },
  elite:     { coins: 1650,  priceUSD: 19.99,  vpBonus: 0    },
  legend:    { coins: 4180,  priceUSD: 49.99,  vpBonus: 0    },
  champion:  { coins: 8450,  priceUSD: 99.99,  vpBonus: 0    },
  titan:     { coins: 12800, priceUSD: 149.99, vpBonus: 1500 },
  ascendant: { coins: 21500, priceUSD: 249.99, vpBonus: 3000 },
};

// Custom-amount pricing (Buy screen "Custom amount" tab). Authoritative floor.
// Set at the ladder's WORST per-coin rate (Starter, $0.99 / 78 coins) on
// purpose: a custom amount must never undercut a pack, or the ladder's bulk
// curve becomes decorative and buyers route around it.
const CUSTOM_COIN_PRICE_USD = 0.0127;
// A conservative floor for a custom amount on any card rail.
const CUSTOM_MIN_USD        = 10;

// STORE ITEMS on the CARD rail: VP bonus packs and boosts, paid for in cash.
//
// FOUNDER, 2026-08-28: a boost is charged in COINS only when the wallet covers
// it; otherwise it charges USD. On the Play build that USD charge is an IAP
// (functions/playBilling.js PLAY_ITEM_PRODUCTS). On the web there is no Play
// Billing at all, so it comes through here.
//
// ⚠⚠ THE CASH PRICE IS NOT DERIVED FROM THE COIN PRICE. Pricing an item at
// playPriceFor(its coin count) put a 75-coin bonus at $1.09, which is what 78
// coins cost: nobody buys that, and it devalues the coin. The rule is
// priceUSD = charmRound(max(2 x coin-equivalent, $0.99)), so paying with coins
// is always about half the cash price.
//
// ⚠ SKUs are the SAME strings as the Play product ids, on purpose. One
// namespace across both rails means a cart line, a Play IAP and a ledger row
// all name the item identically, and the prefixes keep them from colliding
// with a coin SKU.
//
// ⚠ No regional multiplier, and that is not an oversight. A boost is CONSUMED,
// so it is not the arbitrage a discounted coin would be, but it is bought with
// the same money as coins on the same screen, and two different geo rules on
// one checkout is how a price stops being explainable.
//
// ⚠ MIRRORS functions/vpBonuses.js and functions/boosts.js.
// scripts/coin-ladder-check.mjs fails the build on any drift.
const STORE_ITEMS = {
  vpb_happy_hour:     { kind: 'bonus', id: 'happy_hour',   name: 'Happy Hour',            priceUSD: 0.99 },
  vpb_flash:          { kind: 'bonus', id: 'flash',        name: 'Flash Surge',           priceUSD: 0.99 },
  vpb_half_day:       { kind: 'bonus', id: 'half_day',     name: 'Half-Day Surge',        priceUSD: 1.59 },
  vpb_day:            { kind: 'bonus', id: 'day',          name: 'Day Surge',             priceUSD: 2.59 },
  vpb_weekend:        { kind: 'bonus', id: 'weekend',      name: 'Weekend Surge',         priceUSD: 4.49 },
  vpb_long:           { kind: 'bonus', id: 'long',         name: 'Long Surge',            priceUSD: 11.99 },
  vpb_creator:        { kind: 'bonus', id: 'creator',      name: 'Creator Surge',         priceUSD: 1.99 },
  vpb_community:      { kind: 'bonus', id: 'community',    name: 'Community Surge',       priceUSD: 1.99 },
  vpb_watcher:        { kind: 'bonus', id: 'watcher',      name: 'Watcher Surge',         priceUSD: 1.29 },
  boost_post:         { kind: 'boost', id: 'post',         name: 'Post Boost',            priceUSD: 0.99 },
  boost_lfg:          { kind: 'boost', id: 'lfg',          name: 'Teammate Search Boost', priceUSD: 0.99 },
  boost_profile:      { kind: 'boost', id: 'profile',      name: 'Profile Boost',         priceUSD: 1.29 },
  boost_squad:        { kind: 'boost', id: 'squad',        name: 'Squad Boost',           priceUSD: 0.99 },
  boost_stream_boost: { kind: 'boost', id: 'stream_boost', name: 'Stream Boost',          priceUSD: 0.99 },
  boost_stream_super: { kind: 'boost', id: 'stream_super', name: 'Super Boost',           priceUSD: 1.99 },
  boost_stream_mega:  { kind: 'boost', id: 'stream_mega',  name: 'Mega Boost',            priceUSD: 6.99 },
};


// Subscription card payments (mirror functions/subscriptions.js TIER_EUR_PRICE).
const TIER_EUR_PRICE = { lite: 4.99, pro: 9.99 };
const SUB_PERIOD_MS  = 30 * 24 * 3600 * 1000;


// Resolve WHAT is being bought and its server-authoritative USD subtotal.
// Shared by every rail (checkout.js, codashop.js, payram.js) so no two of them
// can ever price the same basket differently.
async function resolvePaymentOrder(uid, data) {
  const { packSku, customCoins, subscriptionTier, cart, itemSku } = data || {};
  let order; // { kind, sku, coins, vpBonus, priceEUR, tier? }
  if (Array.isArray(cart) && cart.length) {
    // CART CHECKOUT. The client sends WHAT, never HOW MUCH: a list of
    // { sku, qty } and nothing else. Every line is re-priced from COIN_PACKS
    // here, which is the same rule the single-pack path has always followed and
    // the only reason a cart is safe to accept at all.
    //
    // One payment for the whole basket rather than one per line: three payments
    // to buy three packs is not a checkout, it is an obstacle course.
    let coins = 0;
    let vpBonus = 0;
    let priceUSD = 0;
    const lines = [];
    const items = [];
    for (const raw of cart.slice(0, 20)) {
      const sku = String(raw?.sku || '');
      const qty = Math.min(99, Math.max(1, Math.floor(Number(raw?.qty) || 0)));
      const pack = COIN_PACKS[sku];
      if (pack) {
        coins    += pack.coins   * qty;
        vpBonus  += pack.vpBonus * qty;
        priceUSD += pack.priceUSD * qty;
        lines.push({ sku, qty, coins: pack.coins * qty, priceUSD: +(pack.priceUSD * qty).toFixed(2) });
        continue;
      }
      // A basket may mix coins and store items. One invoice for the lot, because
      // three redirects to buy three things is not a checkout.
      const it = STORE_ITEMS[sku];
      if (!it) throw new HttpsError('invalid-argument', `Unknown pack: ${sku}`);
      priceUSD += it.priceUSD * qty;
      lines.push({ sku, qty, coins: 0, priceUSD: +(it.priceUSD * qty).toFixed(2) });
      items.push({ sku, kind: it.kind, id: it.id, qty });
    }
    if (!coins && !items.length) throw new HttpsError('invalid-argument', 'Cart is empty.');
    order = {
      kind: 'coins', sku: 'cart', coins, vpBonus,
      priceUSD: +priceUSD.toFixed(2), lines, items,
    };
  } else if (itemSku) {
    // QUICK BUY. The boost sheet on a live stream must not send the buyer to a
    // basket: founder, 2026-08-28, *"if I am on a stream I will not want to
    // leave the stream in order to purchase more coins"*.
    const it = STORE_ITEMS[String(itemSku)];
    if (!it) throw new HttpsError('invalid-argument', 'Unknown item');
    const qty = Math.min(99, Math.max(1, Math.floor(Number(data?.qty) || 1)));
    order = {
      kind: 'coins', sku: String(itemSku), coins: 0, vpBonus: 0,
      priceUSD: +(it.priceUSD * qty).toFixed(2),
      items: [{ sku: String(itemSku), kind: it.kind, id: it.id, qty }],
    };
  } else if (subscriptionTier) {
    const priceEUR = TIER_EUR_PRICE[subscriptionTier];
    if (!priceEUR) throw new HttpsError('invalid-argument', 'Unknown subscription tier');
    // Admin → Subscriptions → Settings. Refused BEFORE any order exists, so a
    // paused plan can never take a card payment.
    await assertNewSubscriptionsOpen();
    order = { kind: 'subscription', sku: `sub_${subscriptionTier}`, tier: subscriptionTier, coins: 0, vpBonus: 0, priceEUR };
  } else if (packSku) {
    const pack = COIN_PACKS[packSku];
    if (!pack) throw new HttpsError('invalid-argument', 'Unknown pack');
    order = { kind: 'coins', sku: packSku, coins: pack.coins, vpBonus: pack.vpBonus, priceUSD: pack.priceUSD };
  } else {
    const coins = Math.floor(Number(customCoins) || 0);
    const priceUSD = +(coins * CUSTOM_COIN_PRICE_USD).toFixed(2);
    if (!coins || priceUSD < CUSTOM_MIN_USD) {
      throw new HttpsError('invalid-argument', `Minimum custom purchase is $${CUSTOM_MIN_USD}.`);
    }
    order = { kind: 'coins', sku: 'custom', coins, vpBonus: 0, priceUSD };
  }



  // REGIONAL PRICING — SUBSCRIPTIONS ONLY. NEVER COINS.
  //
  // A coin has a FIXED value on the way out: it accrues a creator's revenue
  // share at a rate that does not care where it was bought. Discount the price a coin
  // is SOLD at and you have created an arbitrage, not a promotion. Buy 100
  // coins for EUR 0.36 in a discount region, tip them to a creator, and that
  // creator withdraws against the full EUR 0.0090 per coin. Vergr funds the
  // gap on every single transaction, and anyone willing to set a VPN and a
  // profile country turns it into a pump aimed at the treasury.
  //
  // Regional pricing is only ever safe on something that cannot be converted
  // back into money. A subscription is consumed, not redeemed, so Lite and Pro
  // can be priced regionally exactly as Spotify and Netflix price them.
  //
  // Affordability in cheaper markets comes from SMALLER PACKS at the same
  // per-coin rate, never from a cheaper coin. See docs + the pack ladder in
  // src/utils/vpSystem.js.
  if (order.kind === 'subscription') {
    const geo = await regionalPrice(uid, order.priceEUR);
    order.baseEUR = order.priceEUR;
    order.priceEUR = geo.priceEUR;
    order.geo = { country: geo.country, tier: geo.tier, multiplier: geo.multiplier };
  }

  // Pricing is server-authoritative — never trust a client-sent amount.
  //
  // COINS are native USD: the pack price IS the charged figure, no conversion,
  // no FX rate to fail on, no buffer. SUBSCRIPTIONS are still
  // priced in EUR (because they carry regional multipliers, which
  // are safe only on something that is consumed rather than redeemed), so they
  // still convert here and priceEurToUsd still fails closed if no trustworthy
  // rate is available.
  let amountUSD;
  let rate = null;
  let buffer = 0;
  if (typeof order.priceUSD === 'number') {
    amountUSD = +order.priceUSD.toFixed(2);
  } else {
    ({ amountUSD, rate, buffer } = await priceEurToUsd(order.priceEUR));
  }

  return { order, amountUSD, rate, buffer };
}

// COIN SALE PROMO. Changes the QUANTITY DELIVERED, never the price charged, and
// mutates `order` in place (coins, vpBonus). Claimed at order creation, which
// reserves the bonus against the promo's cap at the moment it is promised; an
// abandoned order holding a slice errs toward under-issuing, the right side of
// a spend limit. Idempotent on orderId. A promo failure never blocks a sale.
async function applyOrderPromo(order, uid, orderId) {
  if (order.kind !== 'coins') return null;
  try {
    const granted = await coinPromos.applyPromo({
      packId: (order.sku === 'cart' || order.sku === 'custom') ? null : order.sku,
      coins: order.coins, priceUSD: order.priceUSD, uid, orderId,
    });
    if (!granted.promoId) return null;
    // ⚠ PROMO BONUS COINS ARE BOOST COINS (founder, 2026-09-27): they buy
    // boosts and VP packs only, never tips. Kept apart from the purchased coins
    // so settleOrder credits them to wallets.boostCoins.
    order.promoBoostCoins = (order.promoBoostCoins || 0) + granted.bonusCoins;
    order.vpBonus += granted.bonusVp;
    return granted;
  } catch (e) {
    console.warn('applyOrderPromo skipped', e?.message || e);
    return null;
  }
}

/** The order fields every rail stores, so settleOrder reads one shape. */
function baseOrderFields({ uid, order, promo, amountEUR }) {
  return {
    uid,
    promoId: promo?.promoId || null,
    promoBonusCoins: promo?.bonusCoins || 0,
    promoBonusVp: promo?.bonusVp || 0,
    kind: order.kind,                  // 'coins' | 'subscription'
    packSku: order.sku,
    subscriptionTier: order.tier || null,
    coinsToCredit: order.coins,        // 0 for plans and items-only orders
    // Promo bonus, credited as boost coins. An order created before 2026-09-27
    // has no such field and its bonus is inside coinsToCredit, so it settles
    // exactly as it was promised and is never paid twice.
    promoBoostCoins: order.promoBoostCoins || 0,
    vpBonus: order.vpBonus,
    // settleOrder grants store items (VP packs, boosts) from order.items.
    ...(Array.isArray(order.items) && order.items.length ? { items: order.items } : {}),
    ...(Array.isArray(order.lines) && order.lines.length ? { lines: order.lines } : {}),
    // Coins are natively USD and have no EUR price; plans still carry one.
    amountEUR: typeof amountEUR === 'number' ? amountEUR : null,
  };
}

// ════════════════════════════════════════════════════════════════════
// Shared settlement helper — used by webhook + poller
// ════════════════════════════════════════════════════════════════════
// Credits what an order bought exactly once, whichever rail took the money.
// The awaiting_settlement -> settled flip inside the transaction is the lock, so
// a webhook, a poller and a status check racing each other credit once.
async function settleOrder(collection, referenceId, ctx = {}) {
  if (!SETTLE_COLLECTIONS.has(collection)) throw new Error(`settleOrder: unknown collection ${collection}`);
  // The ledger field naming the order. payram_orders rows keep their historic
  // name so existing transactions stay joinable; every other rail is neutral.
  const refField = collection === 'payram_orders' ? 'payramReferenceId' : 'orderReferenceId';
  const orderRef = db.collection(collection).doc(referenceId);
  const result = await db.runTransaction(async (t) => {
    const snap = await t.get(orderRef);
    if (!snap.exists) return { credited: false, reason: 'order-not-found' };
    const order = snap.data();
    if (order.status === 'settled') return { credited: false, reason: 'already-settled' };
    if (order.status !== 'awaiting_settlement') {
      return { credited: false, reason: `status-${order.status}` };
    }
    if (!order.uid) return { credited: false, reason: 'order-malformed' };
    // Which card rail took the money. Labels only: what an order GRANTS is the
    // same whichever rail it came through.
    // PayRam rows predate the rail field, hence the default.
    const gateway = RAIL_LABELS[order.rail] ? order.rail : 'payram';
    const gatewayLabel = RAIL_LABELS[gateway];

    const settleStamp = {
      status: 'settled',
      settledAt: FieldValue.serverTimestamp(),
      settledVia: ctx.source || 'unknown',
      ...(ctx.invoiceId ? { invoiceId: ctx.invoiceId } : {}),
      ...(ctx.filledAmountUSD != null ? { filledAmountUSD: ctx.filledAmountUSD } : {}),
      // A Coda sale made inside the Google Play app must be reported to Google
      // (playExternalTx.js). Flagged here, inside the settling transaction, so a
      // report can never be forgotten even if the reply that follows is lost.
      ...(order.playExternalToken ? { playReportPending: true } : {}),
    };

    // "+ free boost" on every Coda payment (founder, 2026-09-27). Stamped on the
    // order when it is created (checkout.js), granted here with the purchase, so
    // it lands exactly once. A boost is provided by Vergr and costs nothing to
    // grant. Called at the end of every path below, after all reads.
    const grantFreeBoost = () => {
      const fb = order.freeBoost;
      if (!fb || !fb.id) return;
      const { creditBoosts, BOOSTS } = require('./boosts');
      if (!BOOSTS.find((b) => b.id === fb.id)) return;
      const qty = Math.min(5, Math.max(1, Math.floor(Number(fb.qty) || 1)));
      creditBoosts(t, db.collection('wallets').doc(order.uid), fb.id, qty);
      t.create(db.collection('transactions').doc(), {
        userId: order.uid, type: 'free_boost', currency: 'usd', amount: 0,
        description: `Free boost with your ${gatewayLabel} payment`,
        boostId: fb.id, qty, gateway, [refField]: referenceId,
        createdAt: FieldValue.serverTimestamp(),
      });
    };

    // ── Subscription card payment ──
    // A card payment is one-time (no stored card), so it activates one 30-day
    // period with autoRenew=false. The renewal-reminder cron prompts the user
    // to pay again (or switch to coin auto-renew).
    if (order.kind === 'subscription') {
      const tier = order.subscriptionTier;
      if (tier !== 'lite' && tier !== 'pro') return { credited: false, reason: 'bad-tier' };
      const now = Date.now();
      const periodEnd = now + SUB_PERIOD_MS;
      const tierName = tier === 'lite' ? 'Lite' : 'Pro';

      t.set(db.collection('users').doc(order.uid), {
        subscription: tier,
        subscriptionPeriodStart: now,
        subscriptionPeriodEnd: periodEnd,
        subscriptionAutoRenew: false,
        subscriptionPreferredMethod: 'card',
      }, { merge: true });

      t.set(db.collection('subscriptions').doc(`${order.uid}_${now}`), {
        userId: order.uid, tier, method: 'card', priceEUR: order.amountEUR,
        // What the buyer was charged (subtotal + fees + tax). The admin
        // Payments tab reads this; before 2026-09-21 the row had no USD at all.
        amountUSD: Number(order.amountUSD) || null,
        periodStart: now, periodEnd, status: 'active',
        gateway, [refField]: referenceId,
        createdAt: FieldValue.serverTimestamp(),
      });

      t.create(db.collection('transactions').doc(), {
        userId: order.uid, type: 'subscription_payment',
        amount: order.amountEUR, currency: 'eur',
        description: `${tierName} subscription — 1 month (${gatewayLabel})`,
        gateway, [refField]: referenceId,
        createdAt: FieldValue.serverTimestamp(),
      });

      t.set(db.collection('notifications').doc(), {
        recipientId: order.uid, type: 'subscription',
        title: `${tierName} active!`,
        body: `Your subscription is active until ${new Date(periodEnd).toLocaleDateString()}.`,
        read: false, data: { tier },
        createdAt: FieldValue.serverTimestamp(),
      });

      grantFreeBoost();
      t.update(orderRef, settleStamp);
      return { credited: true, uid: order.uid, kind: 'subscription', tier, periodEnd };
    }


    // ── STORE ITEMS (VP bonuses / boosts) ──
    //
    // Granted through the SAME helpers a coin purchase uses, so a bonus bought
    // with a card is the identical object to one bought with coins and expires
    // the same way. Reads come first because Firestore forbids a read after a
    // write inside a transaction, and applyPack needs the user snapshot.
    const orderItems = Array.isArray(order.items) ? order.items : [];
    let userSnapForItems = null;
    if (orderItems.some((i) => i && i.kind === 'bonus')) {
      userSnapForItems = await t.get(db.collection('users').doc(order.uid));
    }

    // ── Coin purchase ──
    if (typeof order.coinsToCredit !== 'number' && !orderItems.length) {
      return { credited: false, reason: 'order-malformed' };
    }
    if (orderItems.length) {
      const { applyPack, VP_BONUS_PACKS } = require('./vpBonuses');
      const { creditBoosts, BOOSTS } = require('./boosts');
      const itemWalletRef = db.collection('wallets').doc(order.uid);
      const itemUserRef = db.collection('users').doc(order.uid);
      const now = Date.now();
      for (const line of orderItems) {
        const qty = Math.min(99, Math.max(1, Math.floor(Number(line?.qty) || 1)));
        if (line?.kind === 'bonus') {
          const pack = VP_BONUS_PACKS.find((p) => p.id === line.id);
          // A missing pack must not strand a paid order: skip the line, settle
          // the rest, and leave the row in the transactions ledger to correct.
          if (!pack || !userSnapForItems || !userSnapForItems.exists) continue;
          // qty is ignored for a bonus on purpose. Stacking is additive on the
          // excess with a hard 3.0 ceiling, so a second copy of the same pack
          // buys almost nothing and would read as a bug on the receipt.
          applyPack(t, itemUserRef, userSnapForItems.data(), pack, 'card_purchase', now);
        } else if (line?.kind === 'boost') {
          const boost = BOOSTS.find((b) => b.id === line.id);
          if (!boost) continue;
          creditBoosts(t, itemWalletRef, boost.id, qty);
        }
        t.create(db.collection('transactions').doc(), {
          userId: order.uid,
          type: line.kind === 'bonus' ? 'vp_bonus_purchase' : 'boost_purchase',
          currency: 'usd',
          amount: 0,
          description: (line.kind === 'bonus' ? 'VP bonus: ' : 'Boost: ') + line.sku + ` (${gatewayLabel})`,
          gateway,
          [refField]: referenceId,
          ...(line.kind === 'bonus' ? { packId: line.id } : { boostId: line.id, qty }),
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      // An items-only order has no coins to credit and is finished here.
      if (!order.coinsToCredit) {
        grantFreeBoost();
        t.update(orderRef, settleStamp);
        return { credited: true, uid: order.uid, kind: 'items', items: orderItems };
      }
    }
    const walletRef = db.collection('wallets').doc(order.uid);
    t.set(walletRef, {
      balance: FieldValue.increment(order.coinsToCredit),
      totalEarned: FieldValue.increment(order.coinsToCredit),
      lastDepositAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (order.vpBonus > 0) {
      t.set(walletRef, { vp: FieldValue.increment(order.vpBonus) }, { merge: true });
    }
    if (order.promoBoostCoins > 0) {
      t.set(walletRef, { boostCoins: FieldValue.increment(order.promoBoostCoins) }, { merge: true });
    }

    t.create(db.collection('transactions').doc(), {
      userId: order.uid,
      type: 'coin_purchase',
      currency: 'coins',
      amount: order.coinsToCredit,
      vpBonus: order.vpBonus || 0,
      promoBoostCoins: order.promoBoostCoins || 0,
      description: `Coin pack: ${order.packSku} (${gatewayLabel})`,
      gateway,
      [refField]: referenceId,
      createdAt: FieldValue.serverTimestamp(),
    });

    grantFreeBoost();
    t.update(orderRef, settleStamp);

    return {
      credited: true, uid: order.uid, coins: order.coinsToCredit, vpBonus: order.vpBonus || 0,
      // Carried out of the transaction for the profit ledger below. `order` is
      // scoped to this callback, so the post-commit block cannot read it.
      // What we intend to NET, i.e. the ladder price. Falls back to amountUSD
      // for orders created before fees were itemised, where the two were equal.
      subtotalUSD: Number(order.subtotalUSD) || Number(order.amountUSD) || 0,
      buyerFeesUSD: Number(order.buyerFeesUSD) || 0,
      processorFeeUSD: Number(order.processorFeeUSD) || 0,
      gateway,
    };
  });

  // A paid Lite/Pro period gets its plan bonus now, not on the 1st of next month.
  if (result.credited && result.kind === 'subscription') {
    await require('./planBonus').grantPlanBonus(db, result.uid, result.tier, result.periodEnd, 'card');
  }

  // Post-commit, guarded: pay the buyer's referrer their coin revenue-share.
  // Coin purchases only (subscription settlements return kind:'subscription').
  if (result.credited && !result.kind && result.coins > 0) {
    await creditReferralPurchaseBonus({
      buyerUid: result.uid, coins: result.coins, sourceId: `order:${referenceId}`,
    });

    // Post-commit, guarded: book the sale to the profit ledger. Same sourceId
    // as the referral bonus above, so the reconciler cron settling the same
    // order a second time cannot double-book either one.
    try {
      const { bookCoinPurchase } = require('./platformRevenue');
      await bookCoinPurchase({
        uid: result.uid,
        grossUsd: result.subtotalUSD,
        coins: result.coins,
        sourceId: `order:${referenceId}`,
        gateway: result.gateway,
        buyerFeesUsd: result.buyerFeesUSD,
        processorFeeUsd: result.processorFeeUSD,
      });
    } catch (e) {
      console.error('platform revenue booking failed', referenceId, e?.message || e);
    }
  }
  // The buyer's receipt email. Never throws; a caller without SMTP bound sends
  // nothing (functions/receipts.js).
  if (result.credited) await require('./receipts').sendOrderReceipt(collection, referenceId);
  return result;
}

/**
 * Price one subscription tier, for ANY card rail.
 *
 * Exported so any future card rail quotes a subscription through exactly this
 * code rather than keeping its own copy. Two rails with two price tables is the
 * duplicated-constant failure that has already bitten this codebase once, and on
 * a subscription it would mean the same subscriber paying different amounts
 * depending on which button they pressed. (The Stripe rail that used to consume
 * this was removed 2026-08-13; the export stays because the rule outlives it.)
 *
 * The EUR base is deliberate, not legacy: regional multipliers are applied to it,
 * and a regional multiplier is only ever safe on something CONSUMED rather than
 * redeemed. Coins are redeemable, so they are native USD with no multiplier.
 *
 * Returns { priceEUR, baseEUR, geo, amountUSD }. Fails closed via priceEurToUsd
 * when no trustworthy FX rate is available.
 */
async function priceSubscription(uid, tier) {
  const baseEUR = TIER_EUR_PRICE[tier];
  if (!baseEUR) throw new HttpsError('invalid-argument', 'Unknown subscription tier');
  const geo = await regionalPrice(uid, baseEUR);
  const { amountUSD } = await priceEurToUsd(geo.priceEUR);
  return {
    baseEUR,
    priceEUR: geo.priceEUR,
    geo: { country: geo.country, tier: geo.tier, multiplier: geo.multiplier },
    amountUSD,
  };
}

module.exports = {
  COIN_PACKS, STORE_ITEMS, TIER_EUR_PRICE, SUB_PERIOD_MS,
  CUSTOM_COIN_PRICE_USD, CUSTOM_MIN_USD,
  priceEurToUsd, resolvePaymentOrder, applyOrderPromo, baseOrderFields,
  settleOrder, priceSubscription,
};
