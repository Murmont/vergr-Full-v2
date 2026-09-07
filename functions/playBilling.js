// Google Play Billing — server-side purchase verification and coin crediting.
//
// The client half is src/utils/nativeBilling.js + BillingBridge.kt. Nothing
// the client sends is trusted here: a purchase is only real if Google's
// Play Developer API says it is. A patched APK can call this callable with any
// token it likes, so every field is re-derived server-side.
//
// WHAT IS VERIFIED
//   1. The token exists for THIS package and product (Google 404s otherwise).
//   2. purchaseState == 0 (purchased). 1 = cancelled, 2 = pending.
//   3. obfuscatedExternalAccountId, when present, matches the calling uid, so
//      a token bought on one account cannot be redeemed on another.
//   4. The token has not already been credited (idempotency doc).
//
// COIN AMOUNTS COME FROM THE SERVER MAP BELOW, never from the request. The
// client sends a productId; how many coins that is worth is our decision.
//
// AUTH: uses the function's own service account via Application Default
// Credentials with the androidpublisher scope. That account must be granted
// access in Play Console (see the founder steps at the bottom of this file).

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { GoogleAuth } = require('google-auth-library');
const { creditReferralPurchaseBonus } = require('./referralRevenue');
const coinPromos = require('./coinPromos');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

const PACKAGE_NAME = 'com.vergr.desktop';

// ─────────────────────────────────────────────────────────────────────
// Product map — MUST mirror STORE_COIN_PACKS in src/utils/storePricing.js.
// If you change the coin counts there, change them here too, or Play will
// charge for one thing and we will credit another.
//
// Keys are the in-app product ids created in Play Console. The client builds
// them with playProductIdFor() as `coins_<packId>`.
// ─────────────────────────────────────────────────────────────────────
// `priceUSD` is what Play charges, and it is here ONLY so a promo's
// `minSpendUSD` can be evaluated on this rail too. It is not used to charge
// anything: Play owns the price. Kept on the product rather than in a parallel
// map, because a second map is exactly how these constants drift apart.
// ⚠⚠ CORRECTED 2026-08-28. This map held a SECOND, LARGER coin ladder
// (85/425/1000/2100/…) left over from an abandoned "Play gets different
// quantities" design. Two things were wrong with it, and both were live:
//
//  1. IT DISAGREED WITH THE SHELF. `NativeWalletScreens` renders
//     `ACTIVE_COIN_PACKS = COIN_PACKS` — 78 coins — and this granted 85. The
//     displayed-versus-granted mismatch is the exact Play rejection reason
//     src/utils/storePricing.js warns about.
//  2. IT MADE VERGR EAT GOOGLE'S CUT AND THEN SOME. At $0.99 for 85 coins the
//     net was $0.84 against a $0.99 shelf price: short $0.15 on the smallest
//     pack and short $37.50 on Ascendant. The founder's rule is the opposite —
//     the buyer pays Google's fee, Vergr nets the shelf price.
//
// `coins` here MUST equal COIN_PACKS in src/utils/vpSystem.js. One ladder,
// everywhere: web, Play and Huawei sell the identical packs.
//
// `priceUSD` is the SHELF price (what Vergr nets), NOT what Play charges. Play
// Console is set to the grossed-up figure so the fee lands on the buyer; see
// checkoutFees.quoteCheckout('googlePlay') and storePricing.playPriceFor().
const PLAY_PRODUCTS = {
  coins_starter:   { coins: 78,     vpBonus: 0,    priceUSD: 0.99 },
  coins_gamer:     { coins: 400,    vpBonus: 0,    priceUSD: 4.99 },
  coins_pro:       { coins: 815,    vpBonus: 0,    priceUSD: 9.99 },
  coins_elite:     { coins: 1650,   vpBonus: 0,    priceUSD: 19.99 },
  coins_legend:    { coins: 4180,   vpBonus: 0,    priceUSD: 49.99 },
  coins_champion:  { coins: 8450,   vpBonus: 0,    priceUSD: 99.99 },
  coins_titan:     { coins: 12800,  vpBonus: 1500, priceUSD: 149.99 },
  coins_ascendant: { coins: 21500,  vpBonus: 3000, priceUSD: 249.99 },
};

// ─────────────────────────────────────────────────────────────────────
// STORE ITEMS: VP bonus packs and boosts, bought with CASH.
//
// FOUNDER, 2026-08-28: a user is only charged COINS for a boost if the wallet
// covers it, otherwise the boost charges USD. So each of the 16 items carries
// TWO prices and the buyer takes whichever they can pay.
//
// ⚠⚠ THE CASH PRICE IS NOT DERIVED FROM THE COIN PRICE, and getting that wrong
// once already produced a 75-coin bonus priced at $1.09, exactly what a 78-coin
// pack costs. Nobody would buy that, and it devalues the coin. The rule is
// priceUSD = charmRound(max(2 x coin-equivalent, $0.99)): coins are always about
// half the cash price, which is the whole reason to hold coins.
//
// ⚠ `priceUSD` here is the SHELF price, what Vergr nets. Play Console is set
// to the grossed-up figure so Google takes its cut from the buyer, exactly as
// the coin packs work. The generator is scripts/playPricing.mjs and the
// per-market table is docs/play/play-prices-by-market.csv.
//
// ⚠ The id is the Play product id and it is vpb_<packId> / boost_<boostId>.
// Those two prefixes are the only thing separating the namespaces, because
// stream_boost as a bare id would be indistinguishable from a coin SKU.
//
// ⚠ Prices MIRROR functions/vpBonuses.js and functions/boosts.js, which mirror
// src/utils/. scripts/coin-ladder-check.mjs fails the build on any drift.
const PLAY_ITEM_PRODUCTS = {
  vpb_happy_hour:     { kind: 'bonus', id: 'happy_hour',   priceUSD: 0.99 },
  vpb_flash:          { kind: 'bonus', id: 'flash',        priceUSD: 0.99 },
  vpb_half_day:       { kind: 'bonus', id: 'half_day',     priceUSD: 1.59 },
  vpb_day:            { kind: 'bonus', id: 'day',          priceUSD: 2.59 },
  vpb_weekend:        { kind: 'bonus', id: 'weekend',      priceUSD: 4.49 },
  vpb_long:           { kind: 'bonus', id: 'long',         priceUSD: 11.99 },
  vpb_creator:        { kind: 'bonus', id: 'creator',      priceUSD: 1.99 },
  vpb_community:      { kind: 'bonus', id: 'community',    priceUSD: 1.99 },
  vpb_watcher:        { kind: 'bonus', id: 'watcher',      priceUSD: 1.29 },
  boost_post:         { kind: 'boost', id: 'post',         priceUSD: 0.99 },
  boost_lfg:          { kind: 'boost', id: 'lfg',          priceUSD: 0.99 },
  boost_profile:      { kind: 'boost', id: 'profile',      priceUSD: 1.29 },
  boost_squad:        { kind: 'boost', id: 'squad',        priceUSD: 0.99 },
  boost_stream_boost: { kind: 'boost', id: 'stream_boost', priceUSD: 0.99 },
  boost_stream_super: { kind: 'boost', id: 'stream_super', priceUSD: 1.99 },
  boost_stream_mega:  { kind: 'boost', id: 'stream_mega',  priceUSD: 6.99 },
};

// ─────────────────────────────────────────────────────────────────────
// Subscription products. Play subscription ids → our platform tier.
// Create these in Play Console as SUBSCRIPTIONS (not in-app products), each
// with a single monthly base plan.
//
// Platform Lite/Pro on the Play build MUST go through Play Billing: they are
// digital features unlocked inside the app. Creator memberships are a
// different thing and stay on coins.
// ─────────────────────────────────────────────────────────────────────
const PLAY_SUBSCRIPTIONS = {
  sub_lite: 'lite',
  sub_pro: 'pro',
};

let _authClient = null;
async function androidPublisherToken() {
  if (!_authClient) {
    _authClient = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
  }
  const client = await _authClient.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new HttpsError('internal', 'Could not obtain Play API credentials.');
  return token;
}

/**
 * Ask Google whether this purchase is real.
 * https://androidpublisher.googleapis.com/.../purchases/products/{id}/tokens/{token}
 */
async function fetchPurchase(productId, purchaseToken) {
  const token = await androidPublisherToken();
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(PACKAGE_NAME)}/purchases/products/` +
    `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 404) {
    throw new HttpsError('not-found', 'Purchase not recognised by Google Play.');
  }
  if (res.status === 401 || res.status === 403) {
    // Config problem, not a user problem. Say so plainly in the log: this is
    // the failure mode when the service account has not been granted access
    // in Play Console, and it would otherwise look like fraud rejection.
    const body = await res.text().catch(() => '');
    console.error('playBilling: Play API auth failed', res.status, body.slice(0, 400));
    throw new HttpsError('internal', 'Purchase verification is temporarily unavailable.');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('playBilling: Play API error', res.status, body.slice(0, 400));
    throw new HttpsError('internal', 'Could not verify the purchase.');
  }
  return res.json();
}

// ════════════════════════════════════════════════════════════════════
// redeemPlayPurchase — verify a Play purchase and credit coins.
//
// Idempotent on purchaseToken: the client retries this on restore, so a
// second call for the same token must return the original result rather than
// crediting twice.
// ════════════════════════════════════════════════════════════════════
exports._PLAY_ITEM_PRODUCTS = PLAY_ITEM_PRODUCTS;

exports.redeemPlayPurchase = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const { productId, purchaseToken, orderId } = request.data || {};
    if (typeof productId !== 'string' || typeof purchaseToken !== 'string' || !purchaseToken) {
      throw new HttpsError('invalid-argument', 'productId and purchaseToken are required.');
    }

    const product = PLAY_PRODUCTS[productId];
    const item = PLAY_ITEM_PRODUCTS[productId];
    if (!product && !item) throw new HttpsError('invalid-argument', 'Unknown product.');

    // Fast path: already credited. Checked before hitting Google so a restore
    // sweep over several old tokens does not burn API quota.
    const ledgerRef = db.collection('play_purchases').doc(purchaseToken);
    const existing = await ledgerRef.get();
    if (existing.exists) {
      const d = existing.data();
      if (d.uid !== uid) {
        // Someone is replaying another account's token.
        console.warn('playBilling: token replay', { token: purchaseToken.slice(0, 12), owner: d.uid, caller: uid });
        throw new HttpsError('permission-denied', 'This purchase belongs to another account.');
      }
      if (d.itemKind) {
        return { itemKind: d.itemKind, itemId: d.itemId, coins: 0, vpBonus: 0, alreadyCredited: true };
      }
      return { coins: d.coins || 0, vpBonus: d.vpBonus || 0, alreadyCredited: true };
    }

    const purchase = await fetchPurchase(productId, purchaseToken);

    if (purchase.purchaseState !== 0) {
      // 2 = pending (cash / delayed payment methods). Not an error, just not
      // money yet — the client shows "waiting for payment" and restore() picks
      // it up once it completes.
      throw new HttpsError(
        'failed-precondition',
        purchase.purchaseState === 2 ? 'Payment is still processing.' : 'Purchase was cancelled.'
      );
    }

    const boundAccount = purchase.obfuscatedExternalAccountId;
    if (boundAccount && boundAccount !== uid) {
      console.warn('playBilling: account mismatch', { bound: boundAccount, caller: uid });
      throw new HttpsError('permission-denied', 'This purchase belongs to another account.');
    }

    // ── STORE ITEM (VP bonus / boost) ────────────────────────────────
    //
    // Grants the item itself, not coins. It calls the SAME helpers the coin
    // purchase calls (applyPack, creditBoosts), inside the same transaction that
    // writes the idempotency ledger row, so a bonus bought with cash is
    // byte-identical to one bought with coins and expires the same way.
    //
    // No promo resolver here: a coin promo changes how many COINS a pack
    // delivers, and an item delivers no coins.
    if (item) {
      const walletRefI = db.collection('wallets').doc(uid);
      const userRefI = db.collection('users').doc(uid);
      let granted = null;

      await db.runTransaction(async (t) => {
        const fresh = await t.get(ledgerRef);
        if (fresh.exists) return;

        if (item.kind === 'bonus') {
          const { applyPack, VP_BONUS_PACKS } = require('./vpBonuses');
          const pack = VP_BONUS_PACKS.find((p) => p.id === item.id);
          if (!pack) throw new HttpsError('internal', 'Bonus pack missing from catalogue.');
          // Read inside the transaction: applyPack prunes the running bonuses
          // off this snapshot and rewrites the whole array.
          const userSnap = await t.get(userRefI);
          if (!userSnap.exists) throw new HttpsError('not-found', 'No account.');
          const now = Date.now();
          applyPack(t, userRefI, userSnap.data(), pack, 'play_purchase', now);
          granted = {
            kind: 'bonus', id: pack.id, name: pack.name,
            expiresAt: now + pack.hours * 3600 * 1000,
          };
        } else {
          const { creditBoosts, BOOSTS } = require('./boosts');
          const boost = BOOSTS.find((b) => b.id === item.id);
          if (!boost) throw new HttpsError('internal', 'Boost missing from catalogue.');
          creditBoosts(t, walletRefI, boost.id, 1);
          granted = { kind: 'boost', id: boost.id, qty: 1 };
        }

        t.create(ledgerRef, {
          uid,
          productId,
          itemKind: item.kind,
          itemId: item.id,
          coins: 0,
          vpBonus: 0,
          priceUSD: item.priceUSD,
          orderId: orderId || purchase.orderId || null,
          purchaseTimeMillis: purchase.purchaseTimeMillis || null,
          creditedAt: FieldValue.serverTimestamp(),
        });

        t.create(db.collection('transactions').doc(), {
          userId: uid,
          type: item.kind === 'bonus' ? 'vp_bonus_purchase' : 'boost_purchase',
          currency: 'usd',
          amount: 0,
          priceUSD: item.priceUSD,
          description: (item.kind === 'bonus' ? 'VP bonus: ' : 'Boost: ') + productId + ' (Google Play)',
          gateway: 'google_play',
          playOrderId: orderId || purchase.orderId || null,
          ...(item.kind === 'bonus' ? { packId: item.id } : { boostId: item.id, qty: 1 }),
          createdAt: FieldValue.serverTimestamp(),
        });
      });

      return {
        itemKind: item.kind,
        itemId: item.id,
        coins: 0,
        vpBonus: 0,
        alreadyCredited: !granted,
        granted,
      };
    }

    // COIN SALE PROMO. Same resolver the web rail uses, deliberately: two pack
    // maps with different coin counts already exist because Play takes 30%, and
    // a promo applied to one and not the other would silently work on web only.
    //
    // Claimed BEFORE the credit transaction and keyed on the purchase token, so
    // a restore sweep replaying the same token cannot issue the bonus twice. The
    // price Google charged is untouched: only the quantity delivered moves.
    let coins = product.coins;
    let vpBonus = product.vpBonus;
    let promo = null;
    try {
      const granted = await coinPromos.applyPromo({
        packId: productId,
        coins,
        priceUSD: product.priceUSD || 0,
        uid,
        orderId: purchaseToken,
      });
      if (granted.promoId) {
        coins += granted.bonusCoins;
        vpBonus += granted.bonusVp;
        promo = granted;
      }
    } catch (e) {
      // Never fail a purchase Google has already taken money for.
      console.warn('playBilling: promo skipped', e?.message || e);
    }

    const walletRef = db.collection('wallets').doc(uid);

    await db.runTransaction(async (t) => {
      // Re-read inside the transaction: two devices can redeem the same token
      // concurrently after a restore, and the pre-check above is not atomic.
      const fresh = await t.get(ledgerRef);
      if (fresh.exists) return;

      t.create(ledgerRef, {
        uid,
        productId,
        coins,
        vpBonus,
        promoId: promo?.promoId || null,
        promoBonusCoins: promo?.bonusCoins || 0,
        promoBonusVp: promo?.bonusVp || 0,
        orderId: orderId || purchase.orderId || null,
        purchaseTimeMillis: purchase.purchaseTimeMillis || null,
        creditedAt: FieldValue.serverTimestamp(),
      });

      t.set(walletRef, {
        balance: FieldValue.increment(coins),
        totalEarned: FieldValue.increment(coins),
        lastDepositAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      if (vpBonus > 0) {
        t.set(walletRef, { vp: FieldValue.increment(vpBonus) }, { merge: true });
      }

      t.create(db.collection('transactions').doc(), {
        userId: uid,
        type: 'coin_purchase',
        currency: 'coins',
        amount: coins,
        vpBonus: vpBonus || 0,
        description: `Coin pack: ${productId} (Google Play)`,
        gateway: 'google_play',
        promoId: promo?.promoId || null,
        promoBonusCoins: promo?.bonusCoins || 0,
        playOrderId: orderId || purchase.orderId || null,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    // Post-commit and guarded, exactly as the PayRam path does it: the
    // referrer's revenue share must never be able to fail a paid purchase.
    try {
      await creditReferralPurchaseBonus({
        buyerUid: uid,
        coins,
        sourceId: `play:${purchaseToken}`,
      });
    } catch (err) {
      console.error('playBilling: referral bonus failed (purchase already credited)', err);
    }

    return { coins, vpBonus, alreadyCredited: false };
  }
);

// ════════════════════════════════════════════════════════════════════
// SUBSCRIPTIONS
// ════════════════════════════════════════════════════════════════════
//
// Different API and a different lifecycle from consumables:
//   • verified against purchases.subscriptionsv2 (not products)
//   • ACKNOWLEDGED, never consumed — an unacknowledged subscription is
//     auto-refunded by Google after 3 days
//   • renews on Google's schedule, so the tier must be re-checked over time
//     rather than granted once (see syncPlaySubscriptions below)

async function fetchSubscription(purchaseToken) {
  const token = await androidPublisherToken();
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(PACKAGE_NAME)}/purchases/subscriptionsv2/tokens/` +
    `${encodeURIComponent(purchaseToken)}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) throw new HttpsError('not-found', 'Subscription not recognised by Google Play.');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('playBilling: subscriptionsv2 error', res.status, body.slice(0, 400));
    if (res.status === 401 || res.status === 403) {
      throw new HttpsError('internal', 'Subscription verification is temporarily unavailable.');
    }
    throw new HttpsError('internal', 'Could not verify the subscription.');
  }
  return res.json();
}

/** Acknowledge server-side. Unacknowledged subscriptions are refunded at 3 days. */
async function acknowledgeSubscription(productId, purchaseToken) {
  const token = await androidPublisherToken();
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(PACKAGE_NAME)}/purchases/subscriptions/` +
    `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok && res.status !== 400) {
    // 400 is normal when it is already acknowledged.
    console.warn('playBilling: acknowledge failed', res.status, (await res.text().catch(() => '')).slice(0, 200));
  }
}

const ACTIVE_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED', // cancelled but still paid up until expiry
]);

/** Pull tier + expiry out of a subscriptionsv2 response. */
function readSubscription(data) {
  const line = (data.lineItems || [])[0] || {};
  const productId = line.productId || '';
  return {
    tier: PLAY_SUBSCRIPTIONS[productId] || null,
    productId,
    state: data.subscriptionState || '',
    expiryMs: line.expiryTime ? Date.parse(line.expiryTime) : 0,
    autoRenewing: Boolean(line.autoRenewingPlan?.autoRenewEnabled),
    boundAccount: data.externalAccountIdentifiers?.obfuscatedExternalAccountId || null,
  };
}

async function applySubscription(uid, sub, purchaseToken) {
  const active = ACTIVE_STATES.has(sub.state) && sub.expiryMs > Date.now();
  const userRef = db.collection('users').doc(uid);

  if (!active) {
    // Expired or revoked. Drop to free, but only if Play is the method that
    // granted it — never stomp a coins- or PayRam-purchased period.
    const snap = await userRef.get();
    if (snap.data()?.subscriptionPreferredMethod === 'google_play') {
      await userRef.update({
        subscription: 'free',
        subscriptionAutoRenew: false,
        playSubscription: FieldValue.delete(),
      });
    }
    return { tier: 'free', active: false };
  }

  await userRef.update({
    subscription: sub.tier,
    subscriptionPeriodEnd: sub.expiryMs,
    subscriptionAutoRenew: sub.autoRenewing,
    subscriptionPreferredMethod: 'google_play',
    playSubscription: { purchaseToken, productId: sub.productId, expiryMs: sub.expiryMs },
  });
  return { tier: sub.tier, active: true, expiryMs: sub.expiryMs };
}

exports.redeemPlaySubscription = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const { purchaseToken } = request.data || {};
    if (typeof purchaseToken !== 'string' || !purchaseToken) {
      throw new HttpsError('invalid-argument', 'purchaseToken is required.');
    }

    const data = await fetchSubscription(purchaseToken);
    const sub = readSubscription(data);

    if (!sub.tier) throw new HttpsError('invalid-argument', 'Unknown subscription product.');
    if (sub.boundAccount && sub.boundAccount !== uid) {
      console.warn('playBilling: subscription account mismatch', { bound: sub.boundAccount, caller: uid });
      throw new HttpsError('permission-denied', 'This subscription belongs to another account.');
    }
    if (!ACTIVE_STATES.has(sub.state)) {
      throw new HttpsError('failed-precondition', 'Subscription is not active.');
    }

    // Acknowledge BEFORE granting: if we granted first and acknowledgement
    // failed, Google would refund at 3 days while the user kept the tier.
    if (data.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED') {
      await acknowledgeSubscription(sub.productId, purchaseToken);
    }

    const result = await applySubscription(uid, sub, purchaseToken);

    await db.collection('subscriptions').doc(`${uid}_${Date.now()}`).set({
      userId: uid, tier: sub.tier, method: 'google_play',
      periodEnd: sub.expiryMs, status: 'active',
      playPurchaseToken: purchaseToken,
      createdAt: FieldValue.serverTimestamp(),
    });

    return result;
  }
);

/**
 * Daily reconcile. Play renews on its own schedule and tells us nothing, so a
 * tier granted once would outlive the payment. This re-reads every Play-backed
 * subscription and applies the current truth.
 *
 * Polling rather than Real-Time Developer Notifications purely for cost and
 * setup: RTDN needs a Pub/Sub topic plus Play Console wiring. At this volume a
 * daily pass is enough. If subscription count grows, move to RTDN — the
 * verification code here does not change, only the trigger.
 */
exports.syncPlaySubscriptions = async function syncPlaySubscriptions() {
  const snap = await db.collection('users')
    .where('subscriptionPreferredMethod', '==', 'google_play')
    .limit(500)
    .get();

  let checked = 0, downgraded = 0;
  for (const doc of snap.docs) {
    const token = doc.data()?.playSubscription?.purchaseToken;
    if (!token) continue;
    try {
      const sub = readSubscription(await fetchSubscription(token));
      const r = await applySubscription(doc.id, sub, token);
      checked++;
      if (!r.active) downgraded++;
    } catch (err) {
      // A single bad token must not stop the sweep.
      console.warn('playBilling: sync failed for', doc.id, err?.message);
    }
  }
  return { checked, downgraded };
};

// ─────────────────────────────────────────────────────────────────────
// FOUNDER SETUP (one-time, required before any purchase can be verified)
//
// 1. Play Console → Monetise → In-app products → create one product per key
//    in PLAY_PRODUCTS above, with EXACTLY those ids (coins_starter, …).
//    Type: consumable. Set the price per market.
//
// 2. Play Console → Users and permissions → Invite user → add the Firebase
//    service account email (<project>@appspot.gserviceaccount.com), with the
//    "View financial data" and "Manage orders and subscriptions" permissions.
//    Without this the API returns 401/403 and every redeem fails.
//
// 3. Google Cloud console → APIs & Services → enable "Google Play Android
//    Developer API" on project vergr-44494.
//
// Until all three are done redeemPlayPurchase throws, which is deliberate:
// the client leaves the purchase unconsumed so it can be retried later rather
// than taking money and delivering nothing.
// ─────────────────────────────────────────────────────────────────────
