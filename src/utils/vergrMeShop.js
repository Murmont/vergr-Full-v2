// vergr.me digital-products client — catalog CRUD + wallet purchase/download.
// Backend contract: functions/vergrMeShop.js (8% fee, seller paid in gems).
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, deleteField, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase/config';

const fn = (name) => httpsCallable(getFunctions(undefined, 'europe-west1'), name);

const productsCol = (uid) => collection(db, 'users', uid, 'vergrMeProducts');
const filesRef = (uid) => doc(db, 'users', uid, 'private', 'vergrMeProductFiles');

// ── Catalog CRUD (owner) ─────────────────────────────────────────────
export async function getVergrMeProducts(uid, { publishedOnly = false } = {}) {
  const snap = await getDocs(productsCol(uid));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const list = publishedOnly ? rows.filter((p) => p.published !== false) : rows;
  return list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (b.createdAtMs || 0) - (a.createdAtMs || 0));
}

export async function getVergrMeProduct(uid, productId) {
  const snap = await getDoc(doc(productsCol(uid), productId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveVergrMeProduct(uid, product) {
  const id = product.id || doc(productsCol(uid)).id;
  const { id: _drop, ...body } = product;
  await setDoc(doc(productsCol(uid), id), {
    ...body,
    priceCoins: Math.max(0, Math.floor(Number(body.priceCoins) || 0)),
    createdAtMs: body.createdAtMs || Date.now(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return id;
}

export async function deleteVergrMeProduct(uid, productId) {
  await deleteDoc(doc(productsCol(uid), productId));
  // Drop the private file pointer too (the R2 object itself is orphaned, not
  // leaked — its key is gone from every readable place).
  try { await updateDoc(filesRef(uid), { [productId]: deleteField() }); } catch { /* no files doc yet */ }
}

// ── Paid file upload (owner) ─────────────────────────────────────────
// Presign into the private vergrme-products/ prefix, PUT, then record the key
// on the owner-only private doc. The key never touches the public product doc.
export async function uploadVergrMeProductFile(uid, productId, file, onProgress) {
  const contentType = (file.type || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream';
  const { data } = await fn('getVergrMeProductUploadUrl')({
    contentType, sizeBytes: file.size, fileName: file.name,
  });
  const { uploadUrl, key, cacheControl } = data;

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', contentType);
    // Signed into the URL by the CF — must match or R2 403s.
    if (cacheControl) xhr.setRequestHeader('Cache-Control', cacheControl);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300)
      ? resolve()
      : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(file);
  });

  await setDoc(filesRef(uid), {
    [productId]: { key, contentType, fileName: file.name, sizeBytes: file.size },
  }, { merge: true });

  return { key, fileName: file.name, sizeBytes: file.size };
}

// ── Buy + download (buyer) ───────────────────────────────────────────
// `extra` for physical: { shipping: {...address}, idempotencyKey }.
export async function purchaseVergrMeProduct(sellerUid, productId, extra = {}) {
  const { data } = await fn('purchaseVergrMeProduct')({ sellerUid, productId, ...extra });
  return data;
}

export async function getVergrMeProductDownloadUrl(sellerUid, productId) {
  const { data } = await fn('getVergrMeProductDownloadUrl')({ sellerUid, productId });
  return data; // { url, fileName, expiresIn }
}

// Has this signed-in user already bought this product? (Deterministic doc id.)
export async function getMyVergrMePurchase(buyerUid, sellerUid, productId) {
  try {
    const snap = await getDoc(doc(db, 'vergrme_purchases', `${sellerUid}_${productId}_${buyerUid}`));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch { return null; }
}

// All of the signed-in user's purchases (single equality filter — no index).
export async function getMyVergrMePurchases(buyerUid) {
  const snap = await getDocs(query(collection(db, 'vergrme_purchases'), where('buyerUid', '==', buyerUid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

// Seller's sales rows (for the editor's Products panel).
export async function getMyVergrMeSales(sellerUid) {
  const snap = await getDocs(query(collection(db, 'vergrme_purchases'), where('sellerUid', '==', sellerUid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ── Physical orders ──────────────────────────────────────────────────
export async function getMyVergrMeOrders(buyerUid) {
  const snap = await getDocs(query(collection(db, 'vergrme_orders'), where('buyerUid', '==', buyerUid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

export async function getMySellerOrders(sellerUid) {
  const snap = await getDocs(query(collection(db, 'vergrme_orders'), where('sellerUid', '==', sellerUid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

// Seller marks a placed order shipped — the one direct write rules allow.
export async function markOrderShipped(orderId, trackingNote = '') {
  await updateDoc(doc(db, 'vergrme_orders', orderId), {
    status: 'shipped', trackingNote: trackingNote.slice(0, 200), shippedAtMs: Date.now(),
  });
}

// Seller cancels an unshipped order → CF auto-refunds the buyer in full.
export async function cancelVergrMeOrder(orderId) {
  const { data } = await fn('cancelVergrMeOrder')({ orderId });
  return data;
}

// ── External shop catalog import (Shopify / WooCommerce, link-out) ──
export async function fetchShopCatalog(url) {
  const { data } = await fn('fetchShopCatalog')({ url });
  return data; // { source, items: [{title,url,imageUrl,price,currency}] }
}

// ── Store integrations (Shopify / WooCommerce — the outlet model) ────
// Tokens live server-only; these callables only ever return a safe status
// view (provider/shopName/currency/counts), never the raw credentials.
export async function getMyShopIntegration() {
  const { data } = await fn('getMyShopIntegration')();
  return data.integration; // null | { provider, shopDomain, shopName, currency, productCount, lastSyncAt, lastSyncError }
}
export async function connectShopIntegration(payload) {
  const { data } = await fn('connectShopIntegration')(payload);
  return data; // { ok, integration, sync }
}
export async function syncShopInventory(provider) {
  const { data } = await fn('syncShopInventory')({ provider });
  return data; // { ok, integration, productCount }
}
export async function disconnectShopIntegration(provider) {
  const { data } = await fn('disconnectShopIntegration')({ provider });
  return data;
}

// ── Customers (seller) ───────────────────────────────────────────────
// Aggregate unique buyers across digital purchases + physical orders into one
// customer list. Reuses the seller-side queries above (single equality filter,
// no index). DM reuse happens in the screen via createConversation.
export async function getVergrMeCustomers(sellerUid) {
  const [sales, orders] = await Promise.all([
    getMyVergrMeSales(sellerUid).catch(() => []),
    getMySellerOrders(sellerUid).catch(() => []),
  ]);
  const map = new Map();
  const add = (buyerUid, coins, ms, productName, kind) => {
    if (!buyerUid) return;
    const c = map.get(buyerUid) || { buyerUid, totalCoins: 0, count: 0, lastMs: 0, products: [] };
    c.totalCoins += coins || 0;
    c.count += 1;
    c.lastMs = Math.max(c.lastMs, ms || 0);
    if (productName) c.products.push({ name: productName, kind });
    map.set(buyerUid, c);
  };
  sales.forEach((s) => add(s.buyerUid, s.priceCoins, s.createdAt?.toMillis?.() || 0, s.productName, 'digital'));
  orders.filter((o) => o.status !== 'cancelled')
    .forEach((o) => add(o.buyerUid, o.totalCoins, o.createdAt?.toMillis?.() || 0, o.productName, 'physical'));
  return Array.from(map.values()).sort((a, b) => b.lastMs - a.lastMs);
}

// Open a fresh presigned download in a new tab (URLs expire in 10 min, so we
// always fetch a fresh one at click time instead of storing any URL).
export async function openVergrMeDownload(sellerUid, productId) {
  const { url } = await getVergrMeProductDownloadUrl(sellerUid, productId);
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
