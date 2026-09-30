// HUAWEI IAP — server verification and credit for the AppGallery build.
//
// The Play mirror of this file is functions/playBilling.js. Read that first;
// this one deliberately reuses its product catalogue and its grant helpers so a
// coin pack bought on AppGallery is byte-identical in the ledger to the same
// pack bought on Play.
//
// ═══════════════════════════════════════════════════════════════════════
// HOW A HUAWEI PURCHASE IS PROVEN, AND WHY IT IS NOT A TOKEN LOOKUP
// ═══════════════════════════════════════════════════════════════════════
//
// Google gives the client an opaque purchaseToken and we ask the Play Developer
// API about it. Huawei does the opposite: it hands the client a JSON blob
// (`InAppPurchaseData`) plus an RSA signature over that exact string, and the
// developer verifies it against the app's IAP public key from AppGallery
// Connect → In-App Purchases → App settings → Public key.
//
// So the trust boundary is the SIGNATURE, and every field this file acts on is
// read out of the signed string. Nothing loose from the client is trusted:
//
//   productId      which product, and therefore what to grant
//   purchaseToken  the idempotency key
//   purchaseState  0 = a completed purchase
//   purchaseType   0 = SANDBOX. Absent on a real production purchase.
//   developerPayload  the uid we set at checkout, so a purchase made on one
//                     account cannot be redeemed on another
//
// ⚠⚠ THIS COSTS NOTHING TO RUN AND NEEDS NO NEW CREDENTIAL BEYOND THE PUBLIC
// KEY. Huawei also offers an order-query REST API authenticated with a JWT from
// a generated IAP key, which would be a second secret, a second network call
// per purchase, and a key that "cannot be reused once revoked". Local signature
// verification is cryptographically sound — only Huawei's private key can
// produce a valid signature over this data — and replay is handled by the same
// purchaseToken ledger the Play path uses.
//
// ⚠ WHAT LOCAL VERIFICATION DOES NOT CATCH: a refund or a chargeback after the
// fact. The Play path has the same hole for consumables. If that ever matters,
// add the order-query API rather than weakening this.
//
// ⚠ REQUIRED SECRET: HUAWEI_IAP_PUBLIC_KEY, the base64 string from AGC (no PEM
// header). Set it with:
//     firebase functions:secrets:set HUAWEI_IAP_PUBLIC_KEY
// Until it is set, every redeem fails CLOSED with "temporarily unavailable"
// rather than crediting unverified coins.

const crypto = require('crypto');
const functions = require('firebase-functions/v2');
const { HttpsError } = require('firebase-functions/v2/https');
const PR = require('./paymentRecords');
// The record's LABEL only (never trusted for crediting): product and token read
// from Huawei's purchaseData so a failure is filed against the right purchase.
function huaweiKey(request) {
  const d = JSON.parse(String(request.data?.purchaseData || '{}'));
  return { productId: d.productId || null, purchaseToken: d.purchaseToken || null, orderId: d.orderId || null };
}
const { defineSecret, defineString } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { creditReferralPurchaseBonus } = require('./referralRevenue');
const coinPromos = require('./coinPromos');
// ⚠ ONE CATALOGUE, SHARED WITH PLAY. A second copy is how the two stores end up
// selling different coin counts for the same product id.
const { _PLAY_PRODUCTS: HUAWEI_PRODUCTS, _PLAY_ITEM_PRODUCTS: HUAWEI_ITEM_PRODUCTS } = require('./playBilling');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';

const HUAWEI_IAP_PUBLIC_KEY = defineString('HUAWEI_IAP_PUBLIC_KEY');
const SECRETS = [];

/** Huawei's `purchaseState` for a completed purchase. */
const PURCHASE_STATE_PURCHASED = 0;
/** Huawei's `purchaseType` for a sandbox purchase. Absent in production. */
const PURCHASE_TYPE_SANDBOX = 0;

// ─────────────────────────────────────────────────────────────────────
// Signature verification
// ─────────────────────────────────────────────────────────────────────

/**
 * Wrap AGC's bare base64 key in PEM. AppGallery Connect shows the key as one
 * long base64 DER SubjectPublicKeyInfo string with no header, which
 * crypto.verify will not take as-is.
 */
function toPem(base64Key) {
  const body = String(base64Key || '').replace(/\s+/g, '');
  if (!body) return '';
  if (body.startsWith('-----BEGIN')) return base64Key;
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
}

/**
 * Verify Huawei's signature over the purchase data.
 *
 * ⚠ THE SIGNED MESSAGE IS THE RAW STRING EXACTLY AS RECEIVED. Do not parse and
 * re-stringify it first: JSON.stringify reorders nothing but does normalise
 * whitespace and escaping, and any single byte of difference makes a valid
 * signature fail. Parse a COPY for the fields; verify the original.
 *
 * Exported so it can be exercised directly with a synthetic key pair.
 *
 * @param algorithm 'SHA256withRSA' by default. Switch to the PSS variant only
 *   if "Use SHA256WithRSA/PSS signature algorithm" is turned on in AGC — the
 *   two are not interchangeable and a mismatch verifies as false.
 */
function verifySignature(purchaseData, signature, publicKey, algorithm = 'SHA256withRSA') {
  const pem = toPem(publicKey);
  if (!pem || !purchaseData || !signature) return false;
  try {
    const v = crypto.createVerify('RSA-SHA256');
    v.update(Buffer.from(purchaseData, 'utf8'));
    v.end();
    const key = algorithm === 'SHA256withRSA/PSS'
      ? { key: pem, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }
      : pem;
    return v.verify(key, signature, 'base64');
  } catch (err) {
    // A malformed key or signature is a verification failure, never a throw
    // that could be mistaken for a transient error and retried into a credit.
    console.warn('huaweiBilling: signature check threw', err?.message || err);
    return false;
  }
}

/**
 * Verify and parse, or throw. Returns the parsed purchase.
 *
 * Every check that decides whether real money changed hands lives here, so
 * there is exactly one place to read when asking "could this have credited
 * something it should not have?".
 */
function verifiedPurchase(purchaseData, signature, uid) {
  const publicKey = HUAWEI_IAP_PUBLIC_KEY.value();
  if (!publicKey || publicKey === 'unset') {
    // FAIL CLOSED. Crediting an unverified purchase is strictly worse than an
    // outage: it is free coins for anyone who can POST to this endpoint.
    console.error('huaweiBilling: HUAWEI_IAP_PUBLIC_KEY is not set — refusing to credit');
    throw new HttpsError('internal', 'Purchase verification is temporarily unavailable.');
  }
  if (!verifySignature(purchaseData, signature, publicKey)) {
    console.warn('huaweiBilling: BAD SIGNATURE', { uid, len: String(purchaseData || '').length });
    throw new HttpsError('permission-denied', 'This purchase could not be verified.');
  }

  let p;
  try {
    p = JSON.parse(purchaseData);
  } catch {
    throw new HttpsError('invalid-argument', 'Purchase data is not readable.');
  }

  if (p.purchaseState !== PURCHASE_STATE_PURCHASED) {
    // Not an error, just not money yet. The client shows "waiting for payment"
    // and restore() picks it up once it completes.
    throw new HttpsError('failed-precondition', 'Payment is still processing.');
  }

  // ⚠ A SANDBOX PURCHASE MUST NEVER CREDIT REAL COINS. `purchaseType` is
  // absent on a genuine production purchase and 0 on a sandbox one, so the
  // check is for the field being PRESENT and 0 — not for it being truthy.
  if (p.purchaseType === PURCHASE_TYPE_SANDBOX) {
    console.warn('huaweiBilling: sandbox purchase refused', { uid, productId: p.productId });
    throw new HttpsError('failed-precondition', 'Test purchases cannot be credited.');
  }

  // developerPayload is the uid set at checkout by HuaweiIapBridge.
  if (p.developerPayload && p.developerPayload !== uid) {
    console.warn('huaweiBilling: account mismatch', { bound: p.developerPayload, caller: uid });
    throw new HttpsError('permission-denied', 'This purchase belongs to another account.');
  }

  if (!p.purchaseToken) {
    throw new HttpsError('invalid-argument', 'Purchase has no token.');
  }
  return p;
}

// ═══════════════════════════════════════════════════════════════════════
// redeemHuaweiPurchase — verify an AppGallery purchase and credit it.
//
// Idempotent on purchaseToken: the client retries this on restore, so a second
// call for the same token returns the original result rather than crediting
// twice. Same ledger shape as play_purchases, in its own collection so the two
// stores cannot collide on a token.
// ═══════════════════════════════════════════════════════════════════════

exports.redeemHuaweiPurchase = functions.https.onCall(
  { region: REGION, secrets: SECRETS },
  PR.recorded(PR.ROUTES.APPGALLERY, huaweiKey, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const { purchaseData, signature } = request.data || {};
    if (typeof purchaseData !== 'string' || typeof signature !== 'string') {
      throw new HttpsError('invalid-argument', 'purchaseData and signature are required.');
    }

    const purchase = verifiedPurchase(purchaseData, signature, uid);
    // ⚠ FROM THE SIGNED DATA, not from request.data.productId. A client that
    // sent a real signed 78-coin purchase with productId: 'coins_ascendant'
    // would otherwise be handed 21,500 coins.
    const productId = purchase.productId;
    const purchaseToken = purchase.purchaseToken;

    const product = HUAWEI_PRODUCTS[productId];
    const item = HUAWEI_ITEM_PRODUCTS[productId];
    if (!product && !item) throw new HttpsError('invalid-argument', 'Unknown product.');

    const ledgerRef = db.collection('huawei_purchases').doc(purchaseToken);
    const existing = await ledgerRef.get();
    if (existing.exists) {
      const d = existing.data();
      if (d.uid !== uid) {
        console.warn('huaweiBilling: token replay', { token: purchaseToken.slice(0, 12), owner: d.uid, caller: uid });
        throw new HttpsError('permission-denied', 'This purchase belongs to another account.');
      }
      if (d.itemKind) {
        return { itemKind: d.itemKind, itemId: d.itemId, coins: 0, vpBonus: 0, alreadyCredited: true };
      }
      return { coins: d.coins || 0, vpBonus: d.vpBonus || 0, alreadyCredited: true };
    }

    const orderId = purchase.orderId || purchase.payOrderId || null;

    // ── STORE ITEM (VP bonus / boost) ────────────────────────────────
    //
    // Calls the SAME helpers the coin purchase and the Play purchase call
    // (applyPack, creditBoosts), inside the same transaction that writes the
    // idempotency row, so an item bought on AppGallery behaves and expires
    // exactly like one bought anywhere else.
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
          const userSnap = await t.get(userRefI);
          if (!userSnap.exists) throw new HttpsError('not-found', 'No account.');
          const now = Date.now();
          applyPack(t, userRefI, userSnap.data(), pack, 'huawei_purchase', now);
          granted = { kind: 'bonus', id: pack.id, name: pack.name, expiresAt: now + pack.hours * 3600 * 1000 };
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
          orderId,
          purchaseTimeMillis: purchase.purchaseTime || null,
          creditedAt: FieldValue.serverTimestamp(),
        });

        t.create(db.collection('transactions').doc(), {
          userId: uid,
          type: item.kind === 'bonus' ? 'vp_bonus_purchase' : 'boost_purchase',
          currency: 'usd',
          amount: 0,
          priceUSD: item.priceUSD,
          description: (item.kind === 'bonus' ? 'VP bonus: ' : 'Boost: ') + productId + ' (HUAWEI AppGallery)',
          gateway: 'huawei_iap',
          huaweiOrderId: orderId,
          ...(item.kind === 'bonus' ? { packId: item.id } : { boostId: item.id, qty: 1 }),
          createdAt: FieldValue.serverTimestamp(),
        });
      });

      return { itemKind: item.kind, itemId: item.id, coins: 0, vpBonus: 0, alreadyCredited: !granted, granted };
    }

    // ── COIN PACK ────────────────────────────────────────────────────
    //
    // Same promo resolver as the web and Play rails, keyed on the purchase
    // token so a restore sweep cannot issue the bonus twice. The price Huawei
    // charged is untouched; only the quantity delivered moves.
    let coins = product.coins;
    let vpBonus = product.vpBonus;
    let promoBoostCoins = 0;
    let promo = null;
    try {
      const grantedPromo = await coinPromos.applyPromo({
        packId: productId,
        coins,
        priceUSD: product.priceUSD || 0,
        uid,
        orderId: purchaseToken,
      });
      if (grantedPromo.promoId) {
        // ⚠ Promo bonus coins are BOOST coins (founder, 2026-09-27): boosts and
        // VP packs only, never tips. `coins` stays what was bought.
        promoBoostCoins = grantedPromo.bonusCoins;
        vpBonus += grantedPromo.bonusVp;
        promo = grantedPromo;
      }
    } catch (e) {
      // Never fail a purchase Huawei has already taken money for.
      console.warn('huaweiBilling: promo skipped', e?.message || e);
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
        orderId,
        purchaseTimeMillis: purchase.purchaseTime || null,
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
        description: `Coin pack: ${productId} (HUAWEI AppGallery)`,
        gateway: 'huawei_iap',
        promoId: promo?.promoId || null,
        promoBonusCoins: promo?.bonusCoins || 0,
        huaweiOrderId: orderId,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    // Post-commit and guarded, exactly as the Play and PayRam paths do it: the
    // referrer's revenue share must never be able to fail a paid purchase.
    try {
      await creditReferralPurchaseBonus({
        buyerUid: uid,
        coins,
        sourceId: `huawei:${purchaseToken}`,
      });
    } catch (err) {
      console.error('huaweiBilling: referral bonus failed (purchase already credited)', err);
    }

    return { coins, vpBonus, promoBoostCoins, alreadyCredited: false };
  })
);

// ═══════════════════════════════════════════════════════════════════════
// SUBSCRIPTIONS
// ═══════════════════════════════════════════════════════════════════════
//
// A subscription is NOT consumed and renews on Huawei's schedule without
// telling us, so granting it once is not enough — see syncHuaweiSubscriptions
// at the bottom of this file.
//
// ⚠⚠ THE TIER IS WRITTEN IN THE CANONICAL SHAPE, NOT A NESTED OBJECT.
// `resolveTier` in src/utils/tierSystem.js accepts a nested `{tier}` for
// historical reasons, so writing one LOOKS fine on the plan screen and then
// silently breaks everything keyed on the real fields: the renewal crons, the
// downgrade guard, and `subscriptionPreferredMethod`, which is what stops one
// rail stomping a period another rail paid for. The canonical shape, written by
// payram.js, subscriptions.js and playBilling.js alike, is:
//
//   subscription                 'free' | 'lite' | 'pro'   (top-level STRING)
//   subscriptionPeriodEnd        epoch ms
//   subscriptionAutoRenew        bool
//   subscriptionPreferredMethod  'huawei_iap' here
//   huaweiSubscription           our own bookkeeping, mirroring playSubscription

const SUB_TIERS = { sub_lite: 'lite', sub_pro: 'pro' };

/** This app's own method tag. The downgrade guard below keys on it. */
const METHOD = 'huawei_iap';

/**
 * Apply (or clear) a Huawei-granted tier.
 *
 * ⚠ THE DOWNGRADE IS GUARDED. It only ever drops a user whose
 * `subscriptionPreferredMethod` is still `huawei_iap`. Without that, a Huawei
 * subscription that lapsed AFTER the user re-subscribed with coins or PayRam
 * would cancel the period they had just paid for. Straight copy of the Play
 * path's reasoning, and the same trap.
 */
async function applyHuaweiSubscription(uid, { tier, expiryMs, autoRenewing, productId, purchaseToken, subscriptionId }) {
  const userRef = db.collection('users').doc(uid);
  const active = Boolean(tier) && expiryMs > Date.now();

  if (!active) {
    const snap = await userRef.get();
    if (snap.data()?.subscriptionPreferredMethod === METHOD) {
      await userRef.update({
        subscription: 'free',
        subscriptionAutoRenew: false,
        huaweiSubscription: FieldValue.delete(),
      });
    }
    return { tier: 'free', active: false };
  }

  await userRef.update({
    subscription: tier,
    subscriptionPeriodEnd: expiryMs,
    subscriptionAutoRenew: Boolean(autoRenewing),
    subscriptionPreferredMethod: METHOD,
    huaweiSubscription: { purchaseToken, subscriptionId: subscriptionId || null, productId, expiryMs },
  });
  // Bonus for this paid period; a repeat sync with the same expiry pays nothing.
  await require('./planBonus').grantPlanBonus(db, uid, tier, expiryMs, 'huawei_iap');
  return { tier, active: true, expiryMs };
}

/** Pull the fields we act on out of Huawei's signed InAppPurchaseData. */
function readHuaweiSubscription(p) {
  return {
    tier: SUB_TIERS[p.productId] || null,
    productId: p.productId,
    purchaseToken: p.purchaseToken,
    subscriptionId: p.subscriptionId || null,
    expiryMs: Number(p.expirationDate) || 0,
    // `autoRenewing` is absent on some responses; treat absent as true only
    // when the subscription has not been explicitly cancelled.
    autoRenewing: p.autoRenewing !== undefined ? Boolean(p.autoRenewing) : !p.cancellationTime,
  };
}

exports.redeemHuaweiSubscription = functions.https.onCall(
  { region: REGION, secrets: SECRETS },
  PR.recorded(PR.ROUTES.APPGALLERY_SUB, huaweiKey, async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be signed in.');

    const { purchaseData, signature } = request.data || {};
    if (typeof purchaseData !== 'string' || typeof signature !== 'string') {
      throw new HttpsError('invalid-argument', 'purchaseData and signature are required.');
    }

    const purchase = verifiedPurchase(purchaseData, signature, uid);
    const sub = readHuaweiSubscription(purchase);
    if (!sub.tier) throw new HttpsError('invalid-argument', 'Unknown subscription product.');
    if (sub.expiryMs && sub.expiryMs < Date.now()) {
      throw new HttpsError('failed-precondition', 'This subscription has expired.');
    }

    const r = await applyHuaweiSubscription(uid, sub);

    // The payment record every other rail already writes (coins, card, Google
    // Play). Without it an AppGallery subscriber was invisible in the admin
    // Payments tab. One row per billing period, keyed by token + expiry, because
    // the app re-redeems owned subscriptions on reinstall and restore.
    const periodId = `${uid}_huawei_${crypto.createHash('sha256').update(sub.purchaseToken || '').digest('hex').slice(0, 16)}_${sub.expiryMs || 0}`;
    await db.collection('subscriptions').doc(periodId).create({
      userId: uid, tier: sub.tier, method: METHOD,
      periodEnd: sub.expiryMs || null, status: 'active',
      huaweiSubscriptionId: sub.subscriptionId || null,
      createdAt: FieldValue.serverTimestamp(),
    }).catch((e) => { if (e?.code !== 6) throw e; }); // 6 = ALREADY_EXISTS

    return { tier: r.tier, expiresAt: r.expiryMs || null };
  })
);

// ═══════════════════════════════════════════════════════════════════════
// syncHuaweiSubscriptions — the reconcile. Mirrors syncPlaySubscriptions.
// ═══════════════════════════════════════════════════════════════════════
//
// Huawei renews and cancels on its own schedule and does not tell us, so a tier
// granted once would outlive the payment. This asks Huawei for the current
// status of every Huawei-granted subscription and re-applies it.
//
// ⚠ IT ADDS NO BILLABLE RESOURCE. It is called from the EXISTING `cronDaily`,
// exactly like the Play one. A new Cloud Scheduler job is one of the few things
// in this project that genuinely costs money; do not give this its own.
//
// ⚠⚠ IT FAILS SAFE, AND THAT IS THE MOST IMPORTANT PROPERTY HERE. Anything that
// is not a clear, authenticated "this subscription is over" leaves the user
// ALONE: a missing secret, an OAuth failure, an HTTP error, an unparseable body
// and a per-user exception all skip that user. Downgrading a paying customer
// because Huawei's API had a bad minute is far worse than carrying an expired
// one for a day, and the client re-verifies on next launch anyway.
//
// ⚠ REGION. The IAP server API is per data-processing location, and this
// project's is **Germany**, so the endpoints are the EU ones. If the project's
// data location ever changes, BOTH constants below change with it:
//   DRE (Europe)  subscr-dre.iap.cloud.huawei.eu
//   DRA (Asia)    subscr-dra.iap.cloud.huawei.asia
//   DRR (Russia)  subscr-drru.iap.cloud.huawei.ru
const HUAWEI_OAUTH_URL = 'https://oauth-login.cloud.huawei.com/oauth2/v3/token';
const HUAWEI_SUB_STATUS_URL = 'https://subscr-dre.iap.cloud.huawei.eu/sub/applications/v2/purchases/get';

const HUAWEI_CLIENT_ID = defineString('HUAWEI_CLIENT_ID');
const HUAWEI_CLIENT_SECRET = defineSecret('HUAWEI_CLIENT_SECRET');

/** Cached app-level access token. Huawei's expire in ~1h; refresh a little early. */
let tokenCache = { value: '', expiresAt: 0 };

async function huaweiAccessToken() {
  const id = HUAWEI_CLIENT_ID.value();
  const secret = HUAWEI_CLIENT_SECRET.value();
  if (!id || !secret || id === 'unset' || secret === 'unset') return '';
  if (tokenCache.value && Date.now() < tokenCache.expiresAt) return tokenCache.value;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: id,
    client_secret: secret,
  });
  const res = await fetch(HUAWEI_OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    console.warn('huaweiBilling: oauth failed', res.status);
    return '';
  }
  const j = await res.json().catch(() => null);
  const token = j?.access_token || '';
  if (token) {
    // Refresh 5 minutes early so a long sweep cannot expire mid-run.
    tokenCache = { value: token, expiresAt: Date.now() + Math.max(60, (j.expires_in || 3600) - 300) * 1000 };
  }
  return token;
}

/**
 * Huawei's Authorization header is NOT a plain bearer token: it is
 * `Basic base64("APPAT:" + accessToken)`. Sending `Bearer <token>` returns 401
 * and reads exactly like a bad credential.
 */
function huaweiAuthHeader(accessToken) {
  return 'Basic ' + Buffer.from(`APPAT:${accessToken}`, 'utf8').toString('base64');
}

/**
 * Current status of one subscription, or null if it could not be established.
 * Null always means "leave the user alone", never "cancel them".
 */
async function fetchHuaweiSubscription(subscriptionId, purchaseToken) {
  const token = await huaweiAccessToken();
  if (!token) return null;
  let res;
  try {
    res = await fetch(HUAWEI_SUB_STATUS_URL, {
      method: 'POST',
      headers: {
        Authorization: huaweiAuthHeader(token),
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ subscriptionId, purchaseToken }),
    });
  } catch (err) {
    console.warn('huaweiBilling: sub status request failed', err?.message || err);
    return null;
  }
  if (!res.ok) {
    console.warn('huaweiBilling: sub status HTTP', res.status);
    return null;
  }
  const j = await res.json().catch(() => null);
  // Huawei returns HTTP 200 with a responseCode string; "0" is success.
  if (!j || j.responseCode !== '0' || !j.inappPurchaseData) {
    console.warn('huaweiBilling: sub status responseCode', j?.responseCode, j?.responseMessage);
    return null;
  }
  try {
    return JSON.parse(j.inappPurchaseData);
  } catch {
    return null;
  }
}

exports.syncHuaweiSubscriptions = async function syncHuaweiSubscriptions() {
  const snap = await db.collection('users')
    .where('subscriptionPreferredMethod', '==', METHOD)
    .limit(500)
    .get();

  let checked = 0, downgraded = 0, skipped = 0;
  for (const doc of snap.docs) {
    const rec = doc.data()?.huaweiSubscription;
    if (!rec?.purchaseToken) { skipped++; continue; }
    try {
      const data = await fetchHuaweiSubscription(rec.subscriptionId || rec.productId, rec.purchaseToken);
      if (!data) { skipped++; continue; }   // ← fail safe: never downgrade on doubt

      const sub = readHuaweiSubscription(data);
      // `subIsvalid` is Huawei's own "is this still a valid subscription" flag.
      // Absent on some responses, so only an explicit false counts against it.
      const invalid = data.subIsvalid === false;
      const r = await applyHuaweiSubscription(doc.id, {
        ...sub,
        productId: sub.productId || rec.productId,
        purchaseToken: rec.purchaseToken,
        tier: invalid ? null : sub.tier,
      });
      checked++;
      if (!r.active) downgraded++;
    } catch (err) {
      // A single bad record must not stop the sweep.
      skipped++;
      console.warn('huaweiBilling: sync failed for', doc.id, err?.message);
    }
  }
  return { checked, downgraded, skipped };
};

// Exported for tests and for anything that needs to check a signature without
// going through the callable.
exports._internal = {
  verifySignature,
  toPem,
  verifiedPurchase,
  readHuaweiSubscription,
  huaweiAuthHeader,
  applyHuaweiSubscription,
};

// ⚠ FOUNDER SETUP for the reconcile (the purchase path does NOT need these):
//
//   firebase functions:secrets:set HUAWEI_CLIENT_ID       # AGC → Project settings → Client ID
//   firebase functions:secrets:set HUAWEI_CLIENT_SECRET   # AGC → Project settings → Client secret
//
// Until both are set, `syncHuaweiSubscriptions` fetches nothing and skips every
// user — which is the safe direction: tiers stay as granted rather than being
// cancelled by an unauthenticated guess.
//
// ⚠ There is a second, push-based option Huawei offers: AGC → In-App Purchases
// → App settings → "Key event notifications for an order or subscription"
// (currently OFF), which POSTs renewal and cancellation events to a URL. That
// would react in seconds instead of once a day, but it needs a new public HTTP
// function and signature handling for a second message format. The daily
// reconcile covers correctness; notifications would only improve latency.
