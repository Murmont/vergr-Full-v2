// vergr.me wallet-native digital sales — the wedge vs Linktree (12%) / Beacons (9%).
//
// Founder-locked economics (2026-07-17):
//   - Platform fee = 8% of the sale, taken at purchase. LOCKED.
//   - Seller is credited THE PAYABLE DIRECTLY (floor(price * 0.92), in
//     micro-USD), so there is no second deduction
//     on top of it. 8% total, and that is the whole fee.
//   - Everyone can sell (all tiers). Tier only caps the FILE size
//     (free 200MB / lite 1GB / pro 5GB — mirrors r2.js SIZE_CAPS).
//
// Data shape:
//   users/{uid}/vergrMeProducts/{pid}         — PUBLIC listing (name, price,
//     cover, fileName, sizeBytes, published). Owner-write via rules. The CF
//     re-reads the price server-side at purchase, so the client can never
//     send its own number.
//   users/{uid}/private/vergrMeProductFiles   — owner-only map { pid: {key,
//     contentType, fileName, sizeBytes} }. The paid file's R2 key NEVER
//     appears on a world-readable doc; only this CF (Admin SDK) reads it.
//   vergrme_purchases/{sellerUid_pid_buyerUid} — CF-write only, deterministic
//     id = idempotent (a double-tap can't double-charge). Buyer+seller read.
//
// Delivery: paid files live under the R2 prefix vergrme-products/ and are
// handed out ONLY as short-lived presigned GETs against the R2 S3 endpoint
// (never a cdn.vergr.app URL — that would be a permanent public link).

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

// External-store write-back (Shopify/Woo inventory decrement). Best-effort,
// called AFTER the purchase transaction commits — see shopSync.js.
const { decrementExternalStock } = require('./shopSync');
const { COIN_MICRO_USD, microUsdToStr } = require('./coinLedger');

const SALE_FEE = 0.08; // LOCKED — founder 2026-07-17. 8% flat, credited straight to the payable.
const MAX_PRICE_COINS = 500_000; // sanity ceiling, mirrors the largest platform amount (prize cap)
const R2_SECRETS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];

// Mirrors functions/r2.js SIZE_CAPS — keep in sync.
const SIZE_CAPS = {
  free: 200 * 1024 * 1024,
  lite: 1024 * 1024 * 1024,
  pro: 5 * 1024 * 1024 * 1024,
};

// Digital-goods allowlist — broader than the media matrix in getR2UploadUrl
// (sellers ship zips/PDFs/ebooks, not just media), which is why this is its
// own presign instead of a new 'kind' there.
const PRODUCT_TYPES = new Set([
  'application/zip', 'application/x-zip-compressed', 'application/x-7z-compressed', 'application/x-rar-compressed',
  'application/pdf', 'application/epub+zip', 'application/json',
  'text/plain', 'text/csv', 'text/markdown',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/vnd.adobe.photoshop',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/flac',
  'video/mp4', 'video/webm', 'video/quicktime',
  'font/ttf', 'font/otf', 'font/woff', 'font/woff2',
  'application/octet-stream', // generic binary (presets, save files, project files)
]);

const env = (name) => (process.env[name] || '').replace(/[\s\r\n]+$/g, '').trim();

function r2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY') },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}
const bucket = () => env('R2_BUCKET') || 'vergr-media';

const safeName = (s) => String(s || 'download').replace(/[^\w.\- ()\[\]]+/g, '_').slice(0, 120) || 'download';

// ─────────────────────────────────────────────────────────────────────
// getVergrMeProductUploadUrl — presign a paid file into the private prefix.
// ─────────────────────────────────────────────────────────────────────
exports.getVergrMeProductUploadUrl = functions.https.onCall(
  { region: REGION, cors: true, secrets: R2_SECRETS },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const contentType = String(req.data?.contentType || '');
    const sizeBytes = Math.floor(Number(req.data?.sizeBytes) || 0);
    const fileName = safeName(req.data?.fileName);
    if (!PRODUCT_TYPES.has(contentType)) {
      throw new functions.https.HttpsError('invalid-argument', `File type ${contentType || '(unknown)'} is not supported.`);
    }
    if (sizeBytes <= 0) throw new functions.https.HttpsError('invalid-argument', 'sizeBytes required.');

    const userDoc = await db.collection('users').doc(uid).get();
    const u = userDoc.exists ? userDoc.data() : {};
    const isAdmin = u.role === 'admin' || (u.email || '').toLowerCase() === 'vergenerd@gmail.com';
    const plan = isAdmin ? 'pro' : (u.subscription?.tier || u.subscription || 'free');
    const cap = SIZE_CAPS[plan] || SIZE_CAPS.free;
    if (sizeBytes > cap) {
      throw new functions.https.HttpsError('resource-exhausted',
        `File exceeds your ${plan} plan limit of ${Math.round(cap / 1024 / 1024)}MB.`);
    }

    const extMatch = fileName.match(/\.([A-Za-z0-9]{1,8})$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : 'bin';
    const key = `vergrme-products/${uid}/${Date.now()}_${crypto.randomBytes(8).toString('hex')}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
      // private, no-store: even if a buyer's presigned URL transits a shared
      // cache, nothing may retain the paid bytes.
      CacheControl: 'private, no-store',
    });
    const uploadUrl = await getSignedUrl(r2Client(), command, { expiresIn: 600 });
    return { uploadUrl, key, cacheControl: 'private, no-store' };
  }
);

// ─────────────────────────────────────────────────────────────────────
// purchaseVergrMeProduct — buyer pays coins, seller accrues their 92% share.
//
// DIGITAL: deterministic purchase doc = one grant per buyer, idempotent.
// PHYSICAL (founder-locked 2026-07-18): same 8% fee ON THE PRODUCT PRICE
// ONLY — the flat shippingCoins field passes through to the seller 100%
// (it's their real courier cost). Stock decrements atomically; repeat
// orders allowed (autoId order docs in vergrme_orders + client
// idempotencyKey). Shipping address rides on the order doc (buyer+seller
// read only). Refunds are seller-handled; the ONLY automated path is the
// seller cancelling an unshipped order (cancelVergrMeOrder below).
// ─────────────────────────────────────────────────────────────────────
exports.purchaseVergrMeProduct = functions.https.onCall(
  { region: REGION, cors: true },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const sellerUid = String(req.data?.sellerUid || '');
    const productId = String(req.data?.productId || '');
    if (!sellerUid || !productId) throw new functions.https.HttpsError('invalid-argument', 'sellerUid and productId required.');
    if (sellerUid === uid) throw new functions.https.HttpsError('failed-precondition', "You can't buy your own product.");

    const productRef = db.collection('users').doc(sellerUid).collection('vergrMeProducts').doc(productId);
    const purchaseRef = db.collection('vergrme_purchases').doc(`${sellerUid}_${productId}_${uid}`);
    const buyerWalletRef = db.collection('wallets').doc(uid);
    const sellerWalletRef = db.collection('wallets').doc(sellerUid);

    // Physical-only inputs, validated up front (no reads wasted on bad input).
    const shippingIn = req.data?.shipping || null;
    const idempotencyKey = String(req.data?.idempotencyKey || '').slice(0, 64);
    // Multi-variant synced products: the buyer picks a variant. Validated
    // against the stored catalog below — never trusted for price or stock.
    const variantIdIn = String(req.data?.variantId || '').slice(0, 120);
    const cleanShipping = (s) => {
      const f = (k, max, required) => {
        const v = String(s?.[k] || '').trim().slice(0, max);
        if (required && !v) throw new functions.https.HttpsError('invalid-argument', `Shipping ${k} required.`);
        return v;
      };
      return {
        name: f('name', 80, true),
        address1: f('address1', 140, true),
        address2: f('address2', 140, false),
        city: f('city', 80, true),
        postal: f('postal', 20, true),
        country: f('country', 60, true),
        phone: f('phone', 30, false),
        note: f('note', 200, false),
      };
    };

    // Post-commit external write-back (synced Shopify/Woo products only). Set
    // inside the transaction, fired after it commits — never inside.
    let writeBack = null;
    const txResult = await db.runTransaction(async (tx) => {
      const [productSnap, purchaseSnap, walletSnap] = await Promise.all([
        tx.get(productRef), tx.get(purchaseRef), tx.get(buyerWalletRef),
      ]);
      if (!productSnap.exists) throw new functions.https.HttpsError('not-found', 'Product not found.');
      const p = productSnap.data();
      if (p.published === false) throw new functions.https.HttpsError('failed-precondition', 'This product is not for sale.');
      // CHECKOUT FORK: a product synced through the public Shopify app is a
      // sales-channel listing and must check out inside Shopify via a cart
      // permalink. Selling it for coins would breach the App Store listing, so
      // refuse it here — the client renders a permalink button for these, and
      // this is the layer that holds if an older client ever calls through.
      if (p.checkoutMode === 'permalink') {
        throw new functions.https.HttpsError('failed-precondition', 'This product checks out on the seller\'s store.');
      }
      // Variant resolution, before pricing — a multi-variant product has no
      // single price, so buying one without naming a variant is ambiguous and
      // must fail rather than silently charge for the cheapest one.
      const variants = Array.isArray(p.variants) ? p.variants : [];
      let variant = null;
      if (variants.length) {
        if (variantIdIn) {
          variant = variants.find((v) => v.id === variantIdIn || v.numericId === variantIdIn) || null;
          if (!variant) throw new functions.https.HttpsError('not-found', 'That option is no longer available.');
        } else if (variants.length === 1) {
          variant = variants[0];
        } else {
          throw new functions.https.HttpsError('invalid-argument', 'Choose an option before buying.');
        }
        if (variant.available === false) {
          throw new functions.https.HttpsError('resource-exhausted', 'That option is sold out.');
        }
      }

      // Price is read HERE, server-side — never trusted from the client.
      // A seller override applies to the whole product; otherwise each variant
      // carries its own converted coin price.
      const price = Math.floor(
        (variant && p.priceOverridden !== true && Number(variant.priceCoins) > 0)
          ? Number(variant.priceCoins)
          : Number(p.priceCoins) || 0
      );
      if (price <= 0 || price > MAX_PRICE_COINS) {
        throw new functions.https.HttpsError('failed-precondition', 'This product has no valid price.');
      }
      const kind = p.kind === 'physical' ? 'physical' : 'digital';
      const balance = walletSnap.exists ? (walletSnap.data().balance || 0) : 0;
      const name = p.name || (kind === 'physical' ? 'Product' : 'Digital product');

      // Shared credit/ledger writer.
      const settle = ({ total, owedToSeller, platformCut, refCollectionDoc, extraSellerBody }) => {
        tx.update(buyerWalletRef, {
          balance: FieldValue.increment(-total),
          totalSpent: FieldValue.increment(total),
          updatedAt: FieldValue.serverTimestamp(),
        });
        // Straight to the payable: the whole point of the wedge. No coin leg
        // and no second deduction — 8% total, done. The RATE is unchanged by
        // the removal of gems; only the unit it is recorded in changed, from an
        // integer cent to micro-USD.
        tx.set(sellerWalletRef, {
          owedMicroUsd: FieldValue.increment(owedToSeller),
          totalOwedMicroUsd: FieldValue.increment(owedToSeller),
          vergrMeSalesMicroUsd: FieldValue.increment(owedToSeller),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        tx.update(productRef, { salesCount: FieldValue.increment(1) });
        tx.set(db.collection('transactions').doc(), {
          userId: uid, type: 'vergrme_purchase', amount: -total, currency: 'coins',
          description: `Bought "${name}"`,
          meta: { sellerUid, productId }, createdAt: FieldValue.serverTimestamp(),
        });
        tx.set(db.collection('transactions').doc(), {
          userId: sellerUid, type: 'vergrme_sale', earning: true,
          amount: owedToSeller, amountMicroUsd: owedToSeller, currency: 'usd',
          description: `Sold "${name}" (${total} coins, your 92% share is ${microUsdToStr(owedToSeller)})`,
          meta: { buyerUid: uid, productId, coinsTotal: total, platformCut },
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.set(db.collection('platform_commissions').doc(), {
          type: 'vergrme_sale_fee', userId: sellerUid,
          priceCoins: total, owedMicroUsd: owedToSeller, platformCut, feePct: SALE_FEE,
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.set(db.collection('notifications').doc(), {
          recipientId: sellerUid, type: 'vergrme_sale',
          title: kind === 'physical' ? 'New order!' : 'Product sold!',
          body: kind === 'physical'
            ? `"${name}" ordered for ${total} coins — you earned ${microUsdToStr(owedToSeller)}. Check your orders to ship it.`
            : `"${name}" sold for ${total} coins — you earned ${microUsdToStr(owedToSeller)}`,
          senderId: uid, read: false, data: { productId, ...(refCollectionDoc ? { orderId: refCollectionDoc.id } : {}) },
          createdAt: FieldValue.serverTimestamp(),
        });
      };

      if (kind === 'digital') {
        if (purchaseSnap.exists) {
          // Already bought — idempotent success, no second charge.
          return { ok: true, alreadyOwned: true, purchaseId: purchaseRef.id };
        }
        if (balance < price) {
          throw new functions.https.HttpsError('failed-precondition', `Need ${price} coins. You have ${balance}.`);
        }
        const sellerCoins = Math.floor(price * (1 - SALE_FEE));
        const owedToSeller = sellerCoins * COIN_MICRO_USD;
        const platformCut = price - sellerCoins;
        settle({ total: price, owedToSeller, platformCut });
        tx.set(purchaseRef, {
          buyerUid: uid, sellerUid, productId,
          productName: name,
          priceCoins: price, feePct: SALE_FEE, owedToSeller,
          coverUrl: p.coverUrl || null, fileName: p.fileName || null,
          createdAt: FieldValue.serverTimestamp(),
        });
        return { ok: true, purchaseId: purchaseRef.id, owedToSeller };
      }

      // ── PHYSICAL ──
      const shipping = cleanShipping(shippingIn);
      // Idempotency: a retried request must not place a second order.
      if (idempotencyKey) {
        const idRef = db.collection('idempotency').doc(`vmorder_${uid}_${idempotencyKey}`);
        const idSnap = await tx.get(idRef);
        if (idSnap.exists) return idSnap.data().result;
      }
      // Stock: absent/null = unlimited; a number decrements atomically.
      // With variants the CHOSEN variant's stock is authoritative — the
      // product-level total is a sum and can be positive while the size the
      // buyer actually picked is gone.
      const variantTracksStock = variant && typeof variant.stock === 'number';
      if (variantTracksStock && variant.stock <= 0) {
        throw new functions.https.HttpsError('resource-exhausted', 'That option is sold out.');
      }
      const hasStock = typeof p.stock === 'number';
      if (hasStock && p.stock <= 0 && !variantTracksStock) {
        throw new functions.https.HttpsError('resource-exhausted', 'Sold out.');
      }
      const shipCoins = Math.max(0, Math.floor(Number(p.shippingCoins) || 0));
      if (shipCoins > MAX_PRICE_COINS) throw new functions.https.HttpsError('failed-precondition', 'Invalid shipping cost.');
      const total = price + shipCoins;
      if (balance < total) {
        throw new functions.https.HttpsError('failed-precondition', `Need ${total} coins (incl. shipping). You have ${balance}.`);
      }
      // Fee on the PRODUCT price only; shipping passes through in full.
      const sellerCoinsFromPrice = Math.floor(price * (1 - SALE_FEE));
      const owedToSeller = (sellerCoinsFromPrice + shipCoins) * COIN_MICRO_USD;
      const platformCut = price - sellerCoinsFromPrice;

      const orderRef = db.collection('vergrme_orders').doc();
      settle({ total, owedToSeller, platformCut, refCollectionDoc: orderRef });
      if (hasStock) tx.update(productRef, { stock: FieldValue.increment(-1) });
      if (variantTracksStock) {
        // No array-element increment in Firestore, so rewrite the row. Safe:
        // we are inside the transaction that read it.
        tx.update(productRef, {
          variants: variants.map((v) => (v.id === variant.id
            ? { ...v, stock: Math.max(0, v.stock - 1), available: v.stock - 1 > 0 }
            : v)),
        });
      }
      // Synced product → reconcile the seller's real store after commit.
      if (p.source && p.source !== 'native') {
        writeBack = {
          product: {
            source: p.source,
            externalId: p.externalId,
            // Adjust the inventory item of the variant that actually sold.
            inventoryItemId: variant?.inventoryItemId || p.inventoryItemId,
            purchaseId: orderRef.id,
          },
          newStock: variantTracksStock ? variant.stock - 1 : (hasStock ? p.stock - 1 : null),
        };
      }
      tx.set(orderRef, {
        buyerUid: uid, sellerUid, productId,
        productName: name,
        priceCoins: price, shippingCoins: shipCoins, totalCoins: total,
        feePct: SALE_FEE, owedToSeller,
        coverUrl: p.coverUrl || null,
        // The seller has to know WHICH option to ship.
        variantId: variant?.id || null,
        variantTitle: variant?.title || '',
        variantSku: variant?.sku || '',
        status: 'placed', // placed → shipped (seller, rules) | cancelled (CF)
        shipping,
        createdAt: FieldValue.serverTimestamp(),
      });

      const result = { ok: true, orderId: orderRef.id, totalCoins: total, owedToSeller };
      if (idempotencyKey) {
        tx.set(db.collection('idempotency').doc(`vmorder_${uid}_${idempotencyKey}`), {
          result, createdAt: FieldValue.serverTimestamp(),
        });
      }
      return result;
    });

    if (writeBack) {
      await decrementExternalStock(sellerUid, writeBack.product, writeBack.newStock);
    }
    return txResult;
  }
);

// ─────────────────────────────────────────────────────────────────────
// cancelVergrMeOrder — SELLER cancels an unshipped order → full auto-refund.
// The only automated refund path (founder-locked): buyer gets ALL coins
// back (price + shipping), the seller's accrued share is clawed back. Once
// an order is marked shipped this door closes — disputes are then
// seller-handled off-platform.
// ─────────────────────────────────────────────────────────────────────
exports.cancelVergrMeOrder = functions.https.onCall(
  { region: REGION, cors: true },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const orderId = String(req.data?.orderId || '');
    if (!orderId) throw new functions.https.HttpsError('invalid-argument', 'orderId required.');
    const orderRef = db.collection('vergrme_orders').doc(orderId);

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Order not found.');
      const o = snap.data();
      if (o.sellerUid !== uid) throw new functions.https.HttpsError('permission-denied', 'Only the seller can cancel an order.');
      if (o.status !== 'placed') throw new functions.https.HttpsError('failed-precondition', 'Only unshipped orders can be cancelled.');

      const total = o.totalCoins || 0;
      // Older order docs recorded the seller amount as an integer-cent figure
      // under `gemsToSeller`; new ones store micro-USD under `owedToSeller`.
      const owed = Number(o.owedToSeller ?? ((o.gemsToSeller || 0) * COIN_MICRO_USD)) || 0;

      // Read the product BEFORE any write. Firestore transactions require all
      // reads to precede all writes, so the old placement of this get (after
      // the wallet writes) threw and took the whole cancel with it — this is
      // the only automated refund path, so it failing meant a seller could not
      // cancel at all.
      const productRef = db.collection('users').doc(uid).collection('vergrMeProducts').doc(o.productId);
      const pSnap = await tx.get(productRef);

      tx.update(orderRef, { status: 'cancelled', cancelledAt: FieldValue.serverTimestamp() });
      tx.set(db.collection('wallets').doc(o.buyerUid), {
        balance: FieldValue.increment(total),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.set(db.collection('wallets').doc(uid), {
        owedMicroUsd: FieldValue.increment(-owed),
        totalOwedMicroUsd: FieldValue.increment(-owed),
        vergrMeSalesMicroUsd: FieldValue.increment(-owed),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      // Restock one unit if the product tracks stock.
      if (pSnap.exists && typeof pSnap.data().stock === 'number') {
        tx.update(productRef, { stock: FieldValue.increment(1) });
      }
      // And restock the specific variant that was ordered.
      const pVariants = pSnap.exists && Array.isArray(pSnap.data().variants) ? pSnap.data().variants : [];
      if (o.variantId && pVariants.length) {
        tx.update(productRef, {
          variants: pVariants.map((v) => (v.id === o.variantId && typeof v.stock === 'number'
            ? { ...v, stock: v.stock + 1, available: true }
            : v)),
        });
      }
      tx.set(db.collection('transactions').doc(), {
        userId: o.buyerUid, type: 'vergrme_refund', amount: total, currency: 'coins',
        description: `Refund: "${o.productName}" order cancelled by the seller`,
        meta: { orderId, sellerUid: uid }, createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('transactions').doc(), {
        userId: uid, type: 'vergrme_refund', amount: -owed, amountMicroUsd: -owed, currency: 'usd',
        description: `Order cancelled: "${o.productName}" — your share reversed for the buyer refund`,
        meta: { orderId, buyerUid: o.buyerUid }, createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('notifications').doc(), {
        recipientId: o.buyerUid, type: 'vergrme_sale',
        title: 'Order cancelled',
        body: `The seller cancelled your "${o.productName}" order — ${total} coins refunded.`,
        senderId: uid, read: false, data: { orderId }, createdAt: FieldValue.serverTimestamp(),
      });
      return { ok: true, refundedCoins: total };
    });
  }
);

// ─────────────────────────────────────────────────────────────────────
// fetchShopCatalog — import an EXTERNAL shop's catalog (Shopify public
// products.json, WooCommerce Store API) server-side (their endpoints have
// no CORS for browsers). Display + link-out only: external checkouts
// can't take coins, so no fee applies — the items are snapshotted onto
// the block and buyers tap through to the shop's own checkout.
// ─────────────────────────────────────────────────────────────────────
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\]|.*\.internal)$/i;

exports.fetchShopCatalog = functions.https.onCall(
  { region: REGION, cors: true },
  async (req) => {
    if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    let raw = String(req.data?.url || '').trim();
    if (!raw) throw new functions.https.HttpsError('invalid-argument', 'Shop URL required.');
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    let host;
    try { host = new URL(raw).hostname; } catch { throw new functions.https.HttpsError('invalid-argument', 'Not a valid URL.'); }
    if (!host.includes('.') || PRIVATE_HOST.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      throw new functions.https.HttpsError('invalid-argument', 'Not a valid shop host.');
    }

    const getJson = async (url) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(url, {
          signal: ctrl.signal, redirect: 'follow',
          headers: { 'User-Agent': 'VergrBot/1.0 (+https://vergr.app)', Accept: 'application/json' },
        });
        if (!res.ok) return null;
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('json')) return null;
        return await res.json();
      } catch { return null; } finally { clearTimeout(timer); }
    };

    // 1. Shopify storefront products.json (public on most Shopify shops).
    const shopify = await getJson(`https://${host}/products.json?limit=24`);
    if (Array.isArray(shopify?.products) && shopify.products.length) {
      const items = shopify.products.slice(0, 24).map((pr) => ({
        title: String(pr.title || '').slice(0, 120),
        url: `https://${host}/products/${pr.handle}`,
        imageUrl: pr.images?.[0]?.src || '',
        price: String(pr.variants?.[0]?.price || ''),
        currency: '',
      })).filter((it) => it.title && it.url);
      if (items.length) return { source: 'shopify', items };
    }

    // 2. WooCommerce Store API (public on standard Woo installs).
    const woo = await getJson(`https://${host}/wp-json/wc/store/v1/products?per_page=24`);
    if (Array.isArray(woo) && woo.length) {
      const items = woo.slice(0, 24).map((pr) => {
        const minor = Number(pr.prices?.currency_minor_unit ?? 2);
        const rawPrice = Number(pr.prices?.price || 0);
        return {
          title: String(pr.name || '').replace(/<[^>]+>/g, '').slice(0, 120),
          url: pr.permalink || '',
          imageUrl: pr.images?.[0]?.src || '',
          price: rawPrice ? (rawPrice / Math.pow(10, minor)).toFixed(minor) : '',
          currency: pr.prices?.currency_symbol || pr.prices?.currency_code || '',
        };
      }).filter((it) => it.title && it.url);
      if (items.length) return { source: 'woocommerce', items };
    }

    throw new functions.https.HttpsError('not-found',
      "Couldn't read this shop's catalog. Shopify and WooCommerce stores are supported — or add products manually with Product blocks.");
  }
);

// ─────────────────────────────────────────────────────────────────────
// getVergrMeProductDownloadUrl — buyer (or the seller) gets a short-lived
// presigned GET. The R2 key comes from the seller's owner-only private doc.
// ─────────────────────────────────────────────────────────────────────
exports.getVergrMeProductDownloadUrl = functions.https.onCall(
  { region: REGION, cors: true, secrets: R2_SECRETS },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const sellerUid = String(req.data?.sellerUid || '');
    const productId = String(req.data?.productId || '');
    if (!sellerUid || !productId) throw new functions.https.HttpsError('invalid-argument', 'sellerUid and productId required.');

    if (uid !== sellerUid) {
      const purchase = await db.collection('vergrme_purchases').doc(`${sellerUid}_${productId}_${uid}`).get();
      if (!purchase.exists) {
        throw new functions.https.HttpsError('permission-denied', 'Buy this product to download it.');
      }
    }

    const filesDoc = await db.collection('users').doc(sellerUid)
      .collection('private').doc('vergrMeProductFiles').get();
    const entry = filesDoc.exists ? (filesDoc.data()[productId] || null) : null;
    if (!entry?.key || !entry.key.startsWith(`vergrme-products/${sellerUid}/`)) {
      throw new functions.https.HttpsError('not-found', 'File not available. Contact the seller.');
    }

    const command = new GetObjectCommand({
      Bucket: bucket(),
      Key: entry.key,
      ResponseContentDisposition: `attachment; filename="${safeName(entry.fileName)}"`,
    });
    const url = await getSignedUrl(r2Client(), command, { expiresIn: 600 });
    return { url, fileName: entry.fileName || 'download', expiresIn: 600 };
  }
);
