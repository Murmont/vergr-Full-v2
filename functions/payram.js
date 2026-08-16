// functions/payram.js — PayRam inbound rail (buy coins) + settlement.
// ─────────────────────────────────────────────────────────────────────
// PayRam is a self-hosted crypto payment node (Docker container on Hetzner,
// reverse-proxied at PAYRAM_NODE_URL). It onramps the user's card/Apple Pay/
// bank into USDC on Base and forwards it to our Circle omnibus (the deposit
// contract's cold-wallet field = the Circle omnibus address). See CLAUDE.md
// "[Option 1 / SNAPSHOT]" + the PayRam node ops notes.
//
// API spec (verified against https://docs.payram.com 2026-05-21):
//   Create payment   POST {node}/api/v1/payment
//                     headers: API-Key: <key>, Content-Type: application/json
//                     body:    { customerEmail, customerID, amountInUSD }
//                     resp:    { host, reference_id, url }
//   Payment status   GET  {node}/api/v1/payment/reference/{reference_id}
//                     resp field: paymentState
//   Webhook          PayRam sends a GET to the URL registered in
//                     Dashboard → Developer → Webhook → Add Endpoint.
//                     fields: reference_id, customer_id, invoice_id, status,
//                             amount, currency, filled_amount,
//                             filled_amount_in_usd, timestamp
//                     statuses: OPEN | CANCELLED | FILLED | PARTIALLY_FILLED |
//                               OVER_FILLED   (paid = FILLED | OVER_FILLED)
//                     auth: PayRam echoes the API-Key header back; the merchant
//                           compares it to its own key. There is NO separate
//                           HMAC webhook secret in PayRam's model (despite the
//                           CLAUDE.md placeholder PAYRAM_WEBHOOK_SECRET note —
//                           that is not a real PayRam concept).
//
// Crediting authority + idempotency:
//   payram_orders/{reference_id} holds { uid, coinsToCredit, vpBonus, status }.
//   status starts 'awaiting_settlement'. THREE rails can settle an order:
//     1. payramWebhook (primary — fires on FILLED/OVER_FILLED)
//     2. pollPayramOrders (belt-and-suspenders — polls PayRam status endpoint)
//     3. circleWallets.processInboundDeposit (fallback — IF the Circle deposit
//        surfaces the refId; credits balance + vpBonus too)
//   All three credit only when status === 'awaiting_settlement' inside a
//   Firestore transaction that flips it to 'settled', so crediting is
//   exactly-once regardless of ordering / duplicate webhook delivery.
//
// Required Firebase secrets:
//   PAYRAM_API_KEY    (project API key from PayRam admin → Connect App → API Keys)
//   PAYRAM_NODE_URL   (e.g. https://payram.vergr.app)

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const functions = require('firebase-functions/v2');
const axios = require('axios');
const crypto = require('node:crypto');
const { creditReferralPurchaseBonus } = require('./referralRevenue');
const { regionalPrice } = require('./geoPricing');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';

const PAYRAM_API_KEY  = defineSecret('PAYRAM_API_KEY');
const PAYRAM_NODE_URL = defineSecret('PAYRAM_NODE_URL');
const SECRETS = [PAYRAM_API_KEY, PAYRAM_NODE_URL];

// CLAUDE.md flags secrets set via `echo` landing with a trailing \n that breaks
// HTTP headers. Trim every read.
const trimEnv = (name) => (process.env[name] || '').replace(/[\s\r\n]+$/g, '').trim();
const payramApiKey  = () => trimEnv('PAYRAM_API_KEY');
const payramNodeUrl = () => trimEnv('PAYRAM_NODE_URL').replace(/\/+$/, '');

const isPlaceholder = (v) => !v || typeof v !== 'string' || v.startsWith('placeholder');
function isConfigured() {
  return !isPlaceholder(payramApiKey()) && !isPlaceholder(payramNodeUrl());
}

// ── EUR→USD conversion (loss-proof) ──────────────────────────────────
// PayRam charges in USD; packs are priced in EUR. We request the USD amount
// such that the USDC we receive is ALWAYS worth at least the EUR pack price,
// even if the rate moves against us before the founder off-ramps USDC→EUR.
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
    functions.logger.warn('payram FX live fetch failed', err.message);
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
// PayRam's underlying card processor has a practical floor. It is not published
// (their API exposes no fee or minimum field at all), so this stays a
// conservative local guard rather than a mirrored constant.
const CUSTOM_MIN_USD        = 10;

// Subscription card payments (mirror functions/subscriptions.js TIER_EUR_PRICE).
const TIER_EUR_PRICE = { lite: 4.99, pro: 9.99 };
const SUB_PERIOD_MS  = 30 * 24 * 3600 * 1000;

const PAID_STATES = new Set(['FILLED', 'OVER_FILLED']);

// ════════════════════════════════════════════════════════════════════
// createPayramPayment — inbound (buy coins)
// ════════════════════════════════════════════════════════════════════
exports.createPayramPayment = onCall({ region: REGION, secrets: SECRETS }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Login required');
  if (request.auth?.token?.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('permission-denied', 'Anonymous accounts cannot buy coins.');
  }

  // Resolve order — a fixed pack, a custom coin amount, or a subscription.
  const { packSku, customCoins, subscriptionTier, gemQuoteId, cart } = request.data || {};
  let order; // { kind, sku, coins, vpBonus, priceEUR, tier? }
  if (gemQuoteId) {
    // Buy-and-send: gems are never sold as a standing balance, only as payment
    // for a transfer that goes out the moment the money settles. The price is
    // taken from a server-issued, time-locked quote — never from the client.
    const { consumeGemQuote } = require('./gemTransfer');
    const q = await consumeGemQuote(uid, gemQuoteId);
    order = {
      kind: 'gem_send', sku: 'gem_send', coins: 0, vpBonus: 0,
      priceEUR: q.eurTotal, gemQuote: q,
    };
  } else if (Array.isArray(cart) && cart.length) {
    // CART CHECKOUT. The client sends WHAT, never HOW MUCH: a list of
    // { sku, qty } and nothing else. Every line is re-priced from COIN_PACKS
    // here, which is the same rule the single-pack path has always followed and
    // the only reason a cart is safe to accept at all.
    //
    // One payment for the whole basket rather than one per line: PayRam charges
    // per invoice, and three redirects to buy three packs is not a checkout,
    // it is an obstacle course.
    let coins = 0;
    let vpBonus = 0;
    let priceUSD = 0;
    const lines = [];
    for (const raw of cart.slice(0, 20)) {
      const sku = String(raw?.sku || '');
      const qty = Math.min(99, Math.max(1, Math.floor(Number(raw?.qty) || 0)));
      const pack = COIN_PACKS[sku];
      if (!pack) throw new HttpsError('invalid-argument', `Unknown pack: ${sku}`);
      coins    += pack.coins   * qty;
      vpBonus  += pack.vpBonus * qty;
      priceUSD += pack.priceUSD * qty;
      lines.push({ sku, qty, coins: pack.coins * qty, priceUSD: +(pack.priceUSD * qty).toFixed(2) });
    }
    if (!coins) throw new HttpsError('invalid-argument', 'Cart is empty.');
    order = {
      kind: 'coins', sku: 'cart', coins, vpBonus,
      priceUSD: +priceUSD.toFixed(2), lines,
    };
  } else if (subscriptionTier) {
    const priceEUR = TIER_EUR_PRICE[subscriptionTier];
    if (!priceEUR) throw new HttpsError('invalid-argument', 'Unknown subscription tier');
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

  if (!isConfigured()) {
    return {
      ok: false,
      placeholder: true,
      message: 'PayRam is not configured. Set PAYRAM_API_KEY + PAYRAM_NODE_URL to enable.',
    };
  }

  // REGIONAL PRICING — SUBSCRIPTIONS ONLY. NEVER COINS.
  //
  // A coin has a FIXED value on the way out: it converts to Gems and withdraws
  // at a rate that does not care where it was bought. Discount the price a coin
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
  // no FX rate to fail on, no buffer. SUBSCRIPTIONS and gem sends are still
  // priced in EUR (subscriptions because they carry regional multipliers, which
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

  // ── Fees and tax, ADDED to the buyer (founder decision 2026-08-11) ──
  //
  // `amountUSD` above is the SUBTOTAL: what we intend to net. The buyer is
  // charged that plus the rail's processing fee and any tax. Without this the
  // Starter pack nets $0.66 on a $0.99 sale, because Stripe-class flat fees are
  // 30% of a 99-cent charge.
  //
  // Quoted here rather than trusted from the client, on the same server call
  // that priced the order, so the number on the button and the number on the
  // statement come from one calculation. If the quote fails we charge the
  // subtotal and eat the fee: undercharging is recoverable, overcharging a buyer
  // on a guessed number is not.
  const subtotalUSD = amountUSD;
  let buyerFeesUSD = 0;
  try {
    const { quoteCheckout } = require('./checkoutFees');
    const q = await quoteCheckout({ subtotalUsd: subtotalUSD, method: 'payram_card', uid });
    if (q && q.total > 0) {
      amountUSD = q.total;
      buyerFeesUSD = +(q.total - subtotalUSD).toFixed(2);
    }
  } catch (e) {
    functions.logger.warn('checkout fee quote failed on payment path; charging subtotal', {
      uid, err: e?.message || e,
    });
  }

  const customerEmail = request.auth?.token?.email || `${uid}@users.vergr.app`;

  let resp;
  try {
    resp = await axios.post(
      `${payramNodeUrl()}/api/v1/payment`,
      { customerEmail, customerID: uid, amountInUSD: amountUSD },
      {
        headers: { 'API-Key': payramApiKey(), 'Content-Type': 'application/json' },
        timeout: 15000,
        validateStatus: () => true,
      }
    );
  } catch (err) {
    functions.logger.error('payram createPayment threw', { message: err.message, code: err.code });
    throw new HttpsError('unavailable', 'PayRam is unreachable. Try again shortly.');
  }

  if (resp.status >= 400 || !resp.data?.reference_id || !resp.data?.url) {
    functions.logger.error('payram createPayment non-2xx / malformed', {
      status: resp.status, body: resp.data,
    });
    throw new HttpsError('internal', `PayRam create payment failed (${resp.status}).`);
  }

  const referenceId = String(resp.data.reference_id);

  // Doc id = PayRam reference_id so circleWallets.processInboundDeposit can
  // match a Circle deposit's refId straight to payram_orders/{refId}.
  await db.collection('payram_orders').doc(referenceId).set({
    referenceId,
    uid,
    kind: order.kind,                  // 'coins' | 'subscription' | 'gem_send'
    packSku: order.sku,
    subscriptionTier: order.tier || null,
    // Buy-and-send only: who receives, and how much, fixed at quote time.
    gemSend: order.gemQuote || null,
    coinsToCredit: order.coins,        // field name circleWallets reads (0 for subs)
    vpBonus: order.vpBonus,
    // null for coins since 2026-08-11: they are natively USD and never had a EUR
    // price to record. Subscriptions and gem sends still carry one.
    amountEUR: typeof order.priceEUR === 'number' ? order.priceEUR : null,
    // `amountUSD` is what the buyer is CHARGED (subtotal + fees + tax).
    // `subtotalUSD` is what we intend to net. platformRevenue.js books the two
    // separately so the ledger reconciles against the card statement rather than
    // against a net figure nothing can be tied back to.
    amountUSD,
    subtotalUSD,
    buyerFeesUSD,
    eurUsdRate: rate,
    fxBufferPct: buffer,
    paymentUrl: resp.data.url,
    payramHost: resp.data.host || null,
    status: 'awaiting_settlement',
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, referenceId, paymentUrl: resp.data.url };
});

// ════════════════════════════════════════════════════════════════════
// Shared settlement helper — used by webhook + poller
// ════════════════════════════════════════════════════════════════════
// Credits the user's coins (+ VP bonus) exactly once. Returns a small result
// object describing what happened. Mirrors circleWallets' awaiting_settlement
// lock so the two rails never double-credit.
async function settlePayramOrder(referenceId, ctx = {}) {
  const orderRef = db.collection('payram_orders').doc(referenceId);
  const result = await db.runTransaction(async (t) => {
    const snap = await t.get(orderRef);
    if (!snap.exists) return { credited: false, reason: 'order-not-found' };
    const order = snap.data();
    if (order.status === 'settled') return { credited: false, reason: 'already-settled' };
    if (order.status !== 'awaiting_settlement') {
      return { credited: false, reason: `status-${order.status}` };
    }
    if (!order.uid) return { credited: false, reason: 'order-malformed' };

    const settleStamp = {
      status: 'settled',
      settledAt: FieldValue.serverTimestamp(),
      settledVia: ctx.source || 'unknown',
      ...(ctx.invoiceId ? { invoiceId: ctx.invoiceId } : {}),
      ...(ctx.filledAmountUSD != null ? { filledAmountUSD: ctx.filledAmountUSD } : {}),
    };

    // ── Subscription card payment ──
    // PayRam is one-time (no stored card / recurring), so a card subscription
    // activates one 30-day period with autoRenew=false. The renewal-reminder
    // cron prompts the user to re-pay (or switch to coin auto-renew).
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
        periodStart: now, periodEnd, status: 'active',
        gateway: 'payram', payramReferenceId: referenceId,
        createdAt: FieldValue.serverTimestamp(),
      });

      t.create(db.collection('transactions').doc(), {
        userId: order.uid, type: 'subscription_payment',
        amount: order.amountEUR, currency: 'eur',
        description: `${tierName} subscription — 1 month (card)`,
        gateway: 'payram', payramReferenceId: referenceId,
        createdAt: FieldValue.serverTimestamp(),
      });

      t.set(db.collection('notifications').doc(), {
        recipientId: order.uid, type: 'subscription',
        title: `${tierName} active!`,
        body: `Your subscription is active until ${new Date(periodEnd).toLocaleDateString()}.`,
        read: false, data: { tier },
        createdAt: FieldValue.serverTimestamp(),
      });

      t.update(orderRef, settleStamp);
      return { credited: true, uid: order.uid, kind: 'subscription', tier, periodEnd };
    }

    // ── Buy-and-send (gem transfer paid by card) ──
    // The buyer NEVER receives a gem balance from this. Gems are minted
    // straight into the recipient's wallet, net of the transfer fee, so a
    // purchase can't be used as a top-up-then-withdraw route. That property is
    // the whole reason gems aren't sold standalone — do not "simplify" this
    // into crediting the buyer and then transferring.
    if (order.kind === 'gem_send') {
      const g = order.gemSend;
      if (!g || !g.recipientId || !(g.netGems > 0)) {
        return { credited: false, reason: 'order-malformed' };
      }
      t.set(db.collection('wallets').doc(g.recipientId), {
        gems: FieldValue.increment(g.netGems),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      t.create(db.collection('transactions').doc(), {
        userId: order.uid, type: 'gem_transfer_sent', currency: 'gems',
        amount: -g.gems, counterpartyId: g.recipientId,
        description: `Sent ${g.netGems} gems (card)`,
        meta: { gross: g.gems, net: g.netGems, feePct: g.feePct, paidEUR: order.amountEUR, quoteId: g.quoteId },
        gateway: 'payram', payramReferenceId: referenceId,
        createdAt: FieldValue.serverTimestamp(),
      });
      t.create(db.collection('transactions').doc(), {
        userId: g.recipientId, type: 'gem_transfer_received', currency: 'gems',
        amount: g.netGems, counterpartyId: order.uid,
        description: `Received ${g.netGems} gems`,
        meta: { gross: g.gems, net: g.netGems, feePct: g.feePct, quoteId: g.quoteId },
        createdAt: FieldValue.serverTimestamp(),
      });
      t.create(db.collection('notifications').doc(), {
        recipientId: g.recipientId, type: 'gem_transfer',
        title: `+${g.netGems} gems received`,
        body: 'Someone sent you gems',
        read: false, data: { type: 'gem_transfer', gems: g.netGems, fromUid: order.uid },
        createdAt: FieldValue.serverTimestamp(),
      });

      t.update(orderRef, settleStamp);
      return { credited: true, uid: order.uid, kind: 'gem_send', gems: g.netGems, recipientId: g.recipientId };
    }

    // ── Coin purchase ──
    if (typeof order.coinsToCredit !== 'number') return { credited: false, reason: 'order-malformed' };
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

    t.create(db.collection('transactions').doc(), {
      userId: order.uid,
      type: 'coin_purchase',
      currency: 'coins',
      amount: order.coinsToCredit,
      vpBonus: order.vpBonus || 0,
      description: `Coin pack: ${order.packSku} (PayRam)`,
      gateway: 'payram',
      payramReferenceId: referenceId,
      createdAt: FieldValue.serverTimestamp(),
    });

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
    };
  });

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
        gateway: 'payram',
        buyerFeesUsd: result.buyerFeesUSD,
        processorFeeUsd: result.processorFeeUSD,
      });
    } catch (e) {
      console.error('platform revenue booking failed', referenceId, e?.message || e);
    }
  }
  return result;
}

// ════════════════════════════════════════════════════════════════════
// payramWebhook — GET callback from PayRam (Dashboard → Developer → Webhook)
// ════════════════════════════════════════════════════════════════════
exports.payramWebhook = onRequest(
  { region: REGION, secrets: SECRETS, cors: false, maxInstances: 4, memory: '256MiB' },
  async (req, res) => {
    // PayRam sends GET. Accept POST too defensively, and read fields from
    // either the query string (GET) or the body (POST).
    const p = { ...(req.query || {}), ...(req.body || {}) };

    // Auth: PayRam echoes the API-Key header. Compare timing-safely.
    const presentedKey = (req.headers['api-key'] || req.headers['API-Key'] || '').toString().trim();
    const ourKey = payramApiKey();
    if (isConfigured()) {
      let ok = false;
      try {
        ok = !!presentedKey && presentedKey.length === ourKey.length &&
          crypto.timingSafeEqual(Buffer.from(presentedKey), Buffer.from(ourKey));
      } catch { ok = false; }
      if (!ok) {
        functions.logger.warn('payramWebhook bad API-Key header', {
          hasKey: !!presentedKey, refId: p.reference_id || null,
        });
        res.status(401).send('unauthorized');
        return;
      }
    } else {
      functions.logger.warn('payramWebhook: PayRam not configured, accepting unverified (bring-up only)');
    }

    const referenceId = (p.reference_id || p.referenceId || '').toString();
    const status = (p.status || p.paymentState || '').toString().toUpperCase();
    if (!referenceId) {
      res.status(400).send('missing reference_id');
      return;
    }

    functions.logger.info('payramWebhook received', {
      referenceId, status, invoiceId: p.invoice_id || null,
      filledUsd: p.filled_amount_in_usd || null,
    });

    try {
      if (PAID_STATES.has(status)) {
        const result = await settlePayramOrder(referenceId, {
          source: 'webhook',
          invoiceId: p.invoice_id || null,
          filledAmountUSD: p.filled_amount_in_usd != null ? Number(p.filled_amount_in_usd) : null,
        });
        functions.logger.info('payramWebhook settle result', { referenceId, ...result });
      } else {
        // Non-terminal / unpaid — record last seen status for visibility.
        await db.collection('payram_orders').doc(referenceId).set({
          lastStatus: status,
          lastEventAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    } catch (err) {
      // Idempotency makes retries safe, so prefer 200 over a 5xx retry storm.
      functions.logger.error('payramWebhook handler error', { referenceId, message: err.message });
    }

    res.status(200).json({ ok: true, received: referenceId });
  }
);

// ════════════════════════════════════════════════════════════════════
// pollPayramOrders — belt-and-suspenders reconciler (every 5 min)
// ════════════════════════════════════════════════════════════════════
// PayRam webhooks are unsigned GETs and delivery isn't guaranteed. This polls
// the status endpoint for any order still awaiting settlement and credits it
// if PayRam reports FILLED/OVER_FILLED. Orders older than 1h that are still
// unpaid are marked expired.
exports.pollPayramOrders = onSchedule(
  { schedule: 'every 5 minutes', region: REGION, timeZone: 'UTC', secrets: SECRETS },
  async () => {
    if (!isConfigured()) {
      functions.logger.info('pollPayramOrders skipped — PayRam not configured');
      return;
    }

    // Only check orders at least 2 min old (give the webhook first crack) and
    // not older than 24h (stale links).
    const now = Date.now();
    const minAgeMs = 2 * 60 * 1000;
    const maxAgeMs = 24 * 60 * 60 * 1000;
    const expireMs = 60 * 60 * 1000;

    let pending;
    try {
      pending = await db.collection('payram_orders')
        .where('status', '==', 'awaiting_settlement')
        .orderBy('createdAt', 'asc')
        .limit(40)
        .get();
    } catch (err) {
      functions.logger.error('pollPayramOrders query failed', err.message);
      return;
    }

    for (const doc of pending.docs) {
      const order = doc.data();
      const createdMs = order.createdAt?.toMillis ? order.createdAt.toMillis() : 0;
      const age = createdMs ? now - createdMs : Infinity;
      if (age < minAgeMs) continue;
      if (age > maxAgeMs) continue;

      let state = '';
      try {
        const resp = await axios.get(
          `${payramNodeUrl()}/api/v1/payment/reference/${encodeURIComponent(doc.id)}`,
          { headers: { 'API-Key': payramApiKey() }, timeout: 12000, validateStatus: () => true }
        );
        state = (resp.data?.paymentState || resp.data?.status || '').toString().toUpperCase();
      } catch (err) {
        functions.logger.warn('pollPayramOrders status fetch failed', { refId: doc.id, message: err.message });
        continue;
      }

      if (PAID_STATES.has(state)) {
        try {
          const result = await settlePayramOrder(doc.id, { source: 'poll' });
          functions.logger.info('pollPayramOrders settled', { refId: doc.id, ...result });
        } catch (err) {
          functions.logger.error('pollPayramOrders settle failed', { refId: doc.id, message: err.message });
        }
      } else if (state === 'CANCELLED' || age > expireMs) {
        await doc.ref.set({
          status: 'expired',
          lastStatus: state || 'TIMEOUT',
          expiredAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }
  }
);

// ════════════════════════════════════════════════════════════════════
// getPayramOrderStatus — polled by the in-app popup checkout
// ════════════════════════════════════════════════════════════════════
// The buy popup opens PayRam's hosted page on a different origin, so the app
// can't postMessage from it — it polls this callable instead. To make success
// instant (not wait on the webhook or the 5-min cron), if the order is still
// awaiting we query PayRam's status endpoint live and settle on the spot.
exports.getPayramOrderStatus = onCall({ region: REGION, secrets: SECRETS }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Login required');
  const { referenceId } = request.data || {};
  if (!referenceId) throw new HttpsError('invalid-argument', 'referenceId required');

  const ref = db.collection('payram_orders').doc(String(referenceId));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Order not found');
  const order = snap.data();
  if (order.uid !== uid) throw new HttpsError('permission-denied', 'Not your order');

  if (order.status === 'settled') {
    return { status: 'settled', coins: order.coinsToCredit, vpBonus: order.vpBonus || 0 };
  }
  if (order.status === 'expired') return { status: 'expired' };

  // Still awaiting — ask PayRam directly so the popup can resolve immediately.
  if (order.status === 'awaiting_settlement' && isConfigured()) {
    try {
      const resp = await axios.get(
        `${payramNodeUrl()}/api/v1/payment/reference/${encodeURIComponent(referenceId)}`,
        { headers: { 'API-Key': payramApiKey() }, timeout: 12000, validateStatus: () => true }
      );
      const state = (resp.data?.paymentState || resp.data?.status || '').toString().toUpperCase();
      if (PAID_STATES.has(state)) {
        const result = await settlePayramOrder(referenceId, { source: 'status-poll' });
        if (result.credited || result.reason === 'already-settled') {
          return { status: 'settled', coins: order.coinsToCredit, vpBonus: order.vpBonus || 0 };
        }
      }
    } catch (err) {
      functions.logger.warn('getPayramOrderStatus live check failed', { referenceId, message: err.message });
    }
  }

  return { status: 'awaiting' };
});

exports._settlePayramOrder = settlePayramOrder;
// Shared so the gem quote prices in USD through the SAME rate source, cache and
// safety buffer as every other purchase. A second FX path would drift from this
// one and be the thing that silently undercharges.
exports._priceEurToUsd = priceEurToUsd;

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
exports._internal_priceSubscription = async function _internal_priceSubscription(uid, tier) {
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
};

/**
 * What will this actually cost me, in the currency I will actually be charged.
 *
 * The buy screen used to show a EUR figure with "billed in USD/USDT" beneath
 * it, which meant the number on the button was never the number on the card
 * statement. That is the exact thing a payment processor objects to at
 * underwriting, and it is also just bad manners.
 *
 * So this runs the SAME two steps the payment path runs, in the same order,
 * against the same live rate: regional price first, FX second. The client
 * renders what comes back. There is no second calculation anywhere that could
 * drift from this one.
 *
 * Fails closed on FX exactly like the payment does: if no trustworthy rate is
 * available the quote errors rather than guessing, because a quote that
 * disagreed with the charge would be worse than no quote at all.
 */
exports.getCoinPriceQuote = onCall(
  { region: REGION, cors: true, secrets: [PAYRAM_API_KEY, PAYRAM_NODE_URL] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

    const { packSku, customCoins, subscriptionTier, all, cart, method } = request.data || {};

    // Fees and tax are quoted by the SERVER, on the same call that prices the
    // basket, so the breakdown and the total can never come from two different
    // calculations. `method` is the rail the buyer has selected; omitted means
    // "price only, no fee lines yet" (the pack grid, before a rail is chosen).
    const feesFor = async (subtotalUsd) => {
      if (!method || !(subtotalUsd > 0)) return null;
      try {
        const { quoteCheckout } = require('./checkoutFees');
        return await quoteCheckout({ subtotalUsd, method, uid });
      } catch (e) {
        // A fee-quote failure must not break the price quote: the buyer can
        // still see what the coins cost. It DOES mean we must not present a
        // total, which the client handles by falling back to the subtotal and
        // saying fees are shown at checkout.
        functions.logger.warn('checkout fee quote failed', { method, err: e?.message });
        return null;
      }
    };

    // The whole ladder in ONE call. The buy screen shows eight packs, and eight
    // round trips to price a single screen is how you make a wallet feel slow.
    // Region and FX are resolved once and applied across the ladder.
    if (all) {
      // No regional multiplier here. Coins are sold at ONE global per-coin rate
      // because they redeem at one global rate; see the note on the payment
      // path. This call exists to convert EUR to the USD the buyer is charged,
      // nothing more.
      // Native USD: the pack price IS the charged figure. No FX call, so this
      // can no longer fail because a rate provider is down.
      const entries = Object.entries(COIN_PACKS).map(([sku, pack]) => (
        [sku, { coins: pack.coins, priceUSD: pack.priceUSD, amountUSD: pack.priceUSD }]
      ));
      return { currency: 'USD', packs: Object.fromEntries(entries) };
    }

    // CART TOTAL. Same server-side re-pricing as the payment path: the client
    // names packs and quantities, never an amount. One quote for the basket, so
    // the total on the cart button is the total on the statement.
    if (Array.isArray(cart) && cart.length) {
      let coinsTotal = 0;
      let usdTotal = 0;
      const lines = [];
      for (const raw of cart.slice(0, 20)) {
        const sku = String(raw?.sku || '');
        const qty = Math.min(99, Math.max(1, Math.floor(Number(raw?.qty) || 0)));
        const pack = COIN_PACKS[sku];
        if (!pack) continue;
        coinsTotal += pack.coins * qty;
        usdTotal   += pack.priceUSD * qty;
        lines.push({ sku, qty, coins: pack.coins * qty, priceUSD: +(pack.priceUSD * qty).toFixed(2) });
      }
      if (!coinsTotal) throw new HttpsError('invalid-argument', 'Cart is empty.');
      const usd = +usdTotal.toFixed(2);
      return {
        coins: coinsTotal, priceUSD: usd, amountUSD: usd,
        currency: 'USD', fxRate: null, lines,
        checkout: await feesFor(usd),
      };
    }

    // COINS: native USD, no conversion. SUBSCRIPTIONS: still EUR, because they
    // carry regional multipliers and those are safe only on something consumed
    // rather than redeemed.
    if (!subscriptionTier) {
      let coins = 0;
      let priceUSD = 0;
      if (packSku && packSku !== 'custom') {
        const pack = COIN_PACKS[packSku];
        if (!pack) throw new HttpsError('invalid-argument', 'Unknown pack');
        priceUSD = pack.priceUSD;
        coins = pack.coins;
      } else {
        coins = Math.floor(Number(customCoins) || 0);
        priceUSD = +(coins * CUSTOM_COIN_PRICE_USD).toFixed(2);
        if (!coins || priceUSD < CUSTOM_MIN_USD) {
          throw new HttpsError('invalid-argument', `Minimum is $${CUSTOM_MIN_USD}.`);
        }
      }
      return {
        coins,
        priceUSD,
        // THE NUMBER ON THE CARD STATEMENT (before fees and tax; `checkout.total`
        // is the figure the buyer actually pays once a rail is chosen).
        amountUSD: priceUSD,
        currency: 'USD',
        fxRate: null,
        checkout: await feesFor(priceUSD),
      };
    }

    const baseEUR = TIER_EUR_PRICE[subscriptionTier];
    if (!baseEUR) throw new HttpsError('invalid-argument', 'Unknown subscription tier');
    const priceEUR = (await regionalPrice(uid, baseEUR)).priceEUR;
    const { amountUSD, rate } = await priceEurToUsd(priceEUR);

    return {
      coins: 0,
      priceEUR,
      // THE NUMBER ON THE CARD STATEMENT.
      amountUSD,
      currency: 'USD',
      fxRate: rate,
    };
  },
);
