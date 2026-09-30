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
const crypto = require('crypto');
const { creditReferralPurchaseBonus } = require('./referralRevenue');
const coinPromos = require('./coinPromos');
const PR = require('./paymentRecords');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';

// ⚠⚠ THE PLAY API CALLS RUN AS THE APPSPOT ACCOUNT, EXPLICITLY. 2nd-gen
// functions default to the Compute Engine account
// (674096624319-compute@developer), but the account invited into Play Console
// (Users and permissions) is vergr-44494@appspot, which is what the setup note
// at the bottom of this file told the founder to add. Unpinned, every purchase
// check authenticated as an account Play did not know, so it would 401/403, the
// coins would never be granted and Google refunds an unconsumed purchase after
// three days. Found 2026-09-10 before any real purchase had run. The account
// holds roles/editor on the project, so Firestore access is unchanged.
const PLAY_API_SERVICE_ACCOUNT = 'vergr-44494@appspot.gserviceaccount.com';
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
  const api = 'purchases.products.get';

  if (res.status === 404) {
    const body = await res.text().catch(() => '');
    throw PR.providerError(HttpsError, 'not-found', 'Purchase not recognised by Google Play.', { name: 'google', status: 404, body, api });
  }
  if (res.status === 401 || res.status === 403) {
    // Config problem, not a user problem. Say so plainly in the log: this is
    // the failure mode when the service account has not been granted access
    // in Play Console, and it would otherwise look like fraud rejection.
    const body = await res.text().catch(() => '');
    console.error('playBilling: Play API auth failed', res.status, body.slice(0, 400));
    throw PR.providerError(HttpsError, 'internal', 'Purchase verification is temporarily unavailable.', { name: 'google', status: res.status, body, api });
  }
  if (res.status === 400) {
    // "Invalid Value" from purchases/products (2026-09-29, a real buyer's
    // purchase failed twice): one-time products set up with the newer
    // purchase-option model are not readable there. productsv2 reads them.
    const body = await res.text().catch(() => '');
    console.warn('playBilling: products.get 400, trying productsv2', productId, body.slice(0, 200));
    return fetchPurchaseV2(productId, purchaseToken, token, body);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('playBilling: Play API error', res.status, productId, body.slice(0, 400));
    throw PR.providerError(HttpsError, 'internal', 'Could not verify the purchase.', { name: 'google', status: res.status, body, api });
  }
  return res.json();
}

const V2_STATE = { PURCHASED: 0, CANCELLED: 1, PENDING: 2 };

/**
 * purchases/productsv2, translated to the v1 fields redeemPlayPurchase reads
 * (purchaseState, obfuscatedExternalAccountId, orderId, purchaseTimeMillis).
 *
 * ⚠ v2 looks up by TOKEN ALONE; v1 had the product id in the URL, so Google
 * itself tied the token to the product. Without the productLineItem check
 * below, a token from the cheapest pack would claim the most expensive one.
 */
async function fetchPurchaseV2(productId, purchaseToken, token, v1Body = '') {
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(PACKAGE_NAME)}/purchases/productsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  // Both answers go on the record: v1's reason for refusing and v2's.
  const api = 'purchases.productsv2.get (after products.get 400)';
  if (res.status === 404) {
    const body = await res.text().catch(() => '');
    throw PR.providerError(HttpsError, 'not-found', 'Purchase not recognised by Google Play.',
      { name: 'google', status: 404, body: `v2: ${body} | v1: ${v1Body}`, api });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('playBilling: productsv2 error', res.status, productId, body.slice(0, 400));
    throw PR.providerError(HttpsError, 'internal', 'Could not verify the purchase.',
      { name: 'google', status: res.status, body: `v2: ${body} | v1: ${v1Body}`, api });
  }
  const p = await res.json();
  const lines = Array.isArray(p.productLineItem) ? p.productLineItem : [];
  // What Google actually holds for this token: whether an order exists, its
  // state, and whether it is a test purchase. Never logs the token itself.
  console.log('playBilling: productsv2', JSON.stringify({
    productId, orderId: p.orderId || null, state: p.purchaseStateContext?.purchaseState || null,
    test: !!p.testPurchaseContext, ack: p.acknowledgementState || null,
    products: lines.map((l) => l.productId), completed: p.purchaseCompletionTime || null,
  }));
  if (!lines.some((l) => l.productId === productId)) {
    console.warn('playBilling: productsv2 product mismatch', { asked: productId, got: lines.map((l) => l.productId) });
    throw new HttpsError('permission-denied', 'This purchase is for a different product.');
  }
  const state = p.purchaseStateContext?.purchaseState;
  return {
    purchaseState: state in V2_STATE ? V2_STATE[state] : 1,
    obfuscatedExternalAccountId: p.obfuscatedExternalAccountId,
    orderId: p.orderId,
    purchaseTimeMillis: p.purchaseCompletionTime ? String(Date.parse(p.purchaseCompletionTime)) : undefined,
    viaProductsV2: true,
  };
}

// ════════════════════════════════════════════════════════════════════
// redeemPlayPurchase — verify a Play purchase and credit coins.
//
// Idempotent on purchaseToken: the client retries this on restore, so a
// second call for the same token must return the original result rather than
// crediting twice.
// ════════════════════════════════════════════════════════════════════
exports._PLAY_ITEM_PRODUCTS = PLAY_ITEM_PRODUCTS;
// Admin "Re-check with Google" (paymentAdmin.js) runs the SAME verification and
// credit as the app, with the BUYER's uid. Never a second copy of this logic.
exports._redeemPlay = (...a) => redeemPlay(...a);
exports._androidPublisherToken = (...a) => androidPublisherToken(...a);
exports._PACKAGE_NAME = PACKAGE_NAME;
exports._PLAY_API_SERVICE_ACCOUNT = PLAY_API_SERVICE_ACCOUNT;
// Shared with functions/huaweiBilling.js so BOTH stores sell the same coin
// counts for the same product id. A second copy is how they would drift.
exports._PLAY_PRODUCTS = PLAY_PRODUCTS;

// The callable is a thin wrapper: every failure is recorded on the Payments
// tab (paymentRecords.js) with the stage it happened at, then re-thrown
// unchanged so the app behaves exactly as before. Admin "Re-check with Google"
// calls redeemPlay directly with the BUYER's uid.
exports.redeemPlayPurchase = functions.https.onCall(
  { region: REGION, serviceAccount: PLAY_API_SERVICE_ACCOUNT, secrets: require('./receipts').RECEIPT_SECRETS },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be signed in.');
    const data = request.data || {};
    const stage = { at: 'validate', orderId: null };
    try {
      const out = await redeemPlay(uid, data, stage);
      if (!out.alreadyCredited) {
        await PR.markCredited({ route: PR.ROUTES.GOOGLE_PLAY, purchaseToken: data.purchaseToken, detail: `credited by redeemPlayPurchase` });
        await require('./receipts').sendPurchaseReceipt({
          uid, orderId: stage.orderId || data.orderId || null, method: 'Google Play',
          coins: Number(out.coins) || 0,
          itemName: out.itemKind ? String(data.productId || 'Store item') : null,
        });
      }
      return out;
    } catch (err) {
      await PR.recordIncident({
        route: PR.ROUTES.GOOGLE_PLAY, uid,
        productId: typeof data.productId === 'string' ? data.productId : null,
        purchaseToken: typeof data.purchaseToken === 'string' ? data.purchaseToken : null,
        orderId: stage.orderId || (typeof data.orderId === 'string' ? data.orderId : null),
        stage: stage.at, err,
      });
      throw err;
    }
  }
);

/**
 * Verify one Play one-time purchase with Google and credit it. `stage.at`
 * names the step in progress so a failure is recorded against it.
 */
async function redeemPlay(uid, data, stage = {}) {
    const { productId, purchaseToken, orderId } = data || {};
    if (typeof productId !== 'string' || typeof purchaseToken !== 'string' || !purchaseToken) {
      throw new HttpsError('invalid-argument', 'productId and purchaseToken are required.');
    }

    const product = PLAY_PRODUCTS[productId];
    const item = PLAY_ITEM_PRODUCTS[productId];
    if (!product && !item) throw new HttpsError('invalid-argument', 'Unknown product.');

    // Fast path: already credited. Checked before hitting Google so a restore
    // sweep over several old tokens does not burn API quota.
    stage.at = 'ledger_check';
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

    stage.at = 'provider_check';
    const purchase = await fetchPurchase(productId, purchaseToken);
    stage.orderId = purchase.orderId || orderId || null;

    stage.at = 'purchase_state';
    if (purchase.purchaseState !== 0) {
      // 2 = pending (cash / delayed payment methods). Not an error, just not
      // money yet — the client shows "waiting for payment" and restore() picks
      // it up once it completes.
      throw new HttpsError(
        'failed-precondition',
        purchase.purchaseState === 2 ? 'Payment is still processing.' : 'Purchase was cancelled.'
      );
    }

    stage.at = 'account_check';
    const boundAccount = purchase.obfuscatedExternalAccountId;
    if (boundAccount && boundAccount !== uid) {
      console.warn('playBilling: account mismatch', { bound: boundAccount, caller: uid });
      throw new HttpsError('permission-denied', 'This purchase belongs to another account.');
    }

    stage.at = 'credit';

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
          route: PR.ROUTES.GOOGLE_PLAY,
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
    let promoBoostCoins = 0;
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
        // ⚠ Promo bonus coins are BOOST coins (founder, 2026-09-27): boosts and
        // VP packs only, never tips. `coins` stays what was bought.
        promoBoostCoins = granted.bonusCoins;
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
        route: PR.ROUTES.GOOGLE_PLAY,
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
      if (promoBoostCoins > 0) {
        t.set(walletRef, { boostCoins: FieldValue.increment(promoBoostCoins) }, { merge: true });
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

    return { coins, vpBonus, promoBoostCoins, alreadyCredited: false };
}

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
  const api = 'purchases.subscriptionsv2.get';
  if (res.status === 404) {
    const body = await res.text().catch(() => '');
    throw PR.providerError(HttpsError, 'not-found', 'Subscription not recognised by Google Play.', { name: 'google', status: 404, body, api });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('playBilling: subscriptionsv2 error', res.status, body.slice(0, 400));
    if (res.status === 401 || res.status === 403) {
      throw PR.providerError(HttpsError, 'internal', 'Subscription verification is temporarily unavailable.', { name: 'google', status: res.status, body, api });
    }
    throw PR.providerError(HttpsError, 'internal', 'Could not verify the subscription.', { name: 'google', status: res.status, body, api });
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
  // Bonus for this paid period. The daily sync calls this too: a new expiry means
  // Google renewed (and charged), the same expiry pays nothing (planBonus.js).
  await require('./planBonus').grantPlanBonus(db, uid, sub.tier, sub.expiryMs, 'google_play');
  return { tier: sub.tier, active: true, expiryMs: sub.expiryMs };
}

exports.redeemPlaySubscription = functions.https.onCall(
  { region: REGION, serviceAccount: PLAY_API_SERVICE_ACCOUNT },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const { purchaseToken } = request.data || {};
    if (typeof purchaseToken !== 'string' || !purchaseToken) {
      throw new HttpsError('invalid-argument', 'purchaseToken is required.');
    }
    const stage = { at: 'provider_check', productId: null };
    try {
      const out = await redeemPlaySub(uid, purchaseToken, stage);
      await PR.markCredited({ route: PR.ROUTES.GOOGLE_PLAY_SUB, purchaseToken, detail: `plan ${out.tier} active` });
      return out;
    } catch (err) {
      await PR.recordIncident({
        route: PR.ROUTES.GOOGLE_PLAY_SUB, uid, productId: stage.productId,
        purchaseToken, stage: stage.at, err,
      });
      throw err;
    }
  }
);

/** Verify a Play subscription and apply the plan. `stage.at` names the step. */
async function redeemPlaySub(uid, purchaseToken, stage = {}) {
    stage.at = 'provider_check';
    const data = await fetchSubscription(purchaseToken);
    const sub = readSubscription(data);
    stage.productId = sub.productId || null;
    stage.at = 'plan_check';

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
    stage.at = 'acknowledge';
    if (data.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED') {
      await acknowledgeSubscription(sub.productId, purchaseToken);
    }

    stage.at = 'apply_plan';
    const result = await applySubscription(uid, sub, purchaseToken);

    // ONE row per billing period, keyed by token + expiry. The app re-redeems
    // owned subscriptions on reinstall and restore (nativeBilling.js
    // restoreSubscriptions), and a Date.now() id wrote a fresh "payment" every
    // time, so the admin Payments tab would have counted one purchase many times.
    const periodId = `${uid}_play_${crypto.createHash('sha256').update(purchaseToken).digest('hex').slice(0, 16)}_${sub.expiryMs || 0}`;
    await db.collection('subscriptions').doc(periodId).create({
      userId: uid, tier: sub.tier, method: 'google_play',
      periodEnd: sub.expiryMs, status: 'active',
      playPurchaseToken: purchaseToken,
      createdAt: FieldValue.serverTimestamp(),
    }).catch((e) => { if (e?.code !== 6) throw e; }); // 6 = ALREADY_EXISTS: same period, already recorded

    return result;
}

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
//    ⚠ The purchase callables are PINNED to that account (serviceAccount above);
//    the daily subscription sync runs inside cronDaily as the Compute Engine
//    account (674096624319-compute@developer.gserviceaccount.com), so invite
//    that one too, with the same two permissions, or renewals never reconcile.
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
