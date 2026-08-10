// External store integrations for Vergr Shop — the "selling outlet" model
// (TikTok-Shop style). A seller connects their Shopify or WooCommerce store
// with an API token; we import their products into their Vergr catalog as
// native, coin-buyable items with real stock, and keep inventory in sync so
// buyers can't order out-of-stock.
//
// Founder decisions (2026-07-18):
//   - Connect = seller pastes an API token (Shopify custom-app Admin token /
//     Woo consumer key+secret). Stored SERVER-ONLY in users/{uid}/private/
//     shopIntegration (CF-only rules). Never client-readable.
//   - Import pricing = auto-convert store price -> EUR (FX) -> coins at the
//     EUR 0.009 floor, pre-filled; the seller can override the coin price per
//     product (a synced re-pull never clobbers an overridden price).
//   - Inventory = on a Vergr sale we push a stock decrement to their store,
//     and a daily re-pull reconciles their side. Fulfilment stays in Vergr's
//     Orders tab (we do NOT create the order inside their store in v1).
//
// Phase 2 (2026-07-19): the Shopify half is GraphQL (new public apps are
// GraphQL-only since April 2025) and multi-variant is supported end to end.
// One Vergr product doc per external PRODUCT, carrying a variants[] array —
// not one doc per variant, which would blow through the tier product caps on
// a single sized-and-coloured t-shirt. The Woo path stays REST.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const shopifyApi = require('./shopifyGraphql');
const shopifyBilling = require('./shopifyBilling');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const COIN_EUR = 0.009;            // coin floor (mirrors the platform anchor)
const MAX_IMPORT = 250;            // cap products per sync — keeps reads bounded
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\]|.*\.internal)$/i;

// ── helpers ──────────────────────────────────────────────────────────
function normHost(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let host;
  try { host = new URL(s).hostname.toLowerCase(); } catch { return ''; }
  if (!host.includes('.') || PRIVATE_HOST.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return '';
  return host;
}

async function httpJson(url, { method = 'GET', headers = {}, body, timeoutMs = 9000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method, signal: ctrl.signal, redirect: 'follow',
      headers: { Accept: 'application/json', 'User-Agent': 'VergrBot/1.0 (+https://vergr.app)', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) { try { json = await res.json(); } catch {} }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: null, error: e?.name === 'AbortError' ? 'timeout' : (e?.message || 'network') };
  } finally { clearTimeout(timer); }
}

// Server-side FX (EUR base). Cached 24h in app_config/fx_rates — mirrors the
// client currency.js feed (open.er-api.com, no key). Falls back to {} so an
// FX outage just means "can't auto-price" (seller sets the coin price), never
// a wrong number.
async function getFxRates() {
  const ref = db.collection('app_config').doc('fx_rates');
  const snap = await ref.get();
  const now = Date.now();
  if (snap.exists) {
    const d = snap.data();
    if (d.rates && d.fetchedAt && (now - (d.fetchedAt.toMillis?.() || 0)) < 24 * 60 * 60 * 1000) {
      return d.rates;
    }
  }
  const { json } = await httpJson('https://open.er-api.com/v6/latest/EUR');
  const rates = json?.rates && typeof json.rates === 'object' ? json.rates : null;
  if (rates) {
    await ref.set({ base: 'EUR', rates, fetchedAt: FieldValue.serverTimestamp() }, { merge: true });
    return rates;
  }
  return snap.exists ? (snap.data().rates || {}) : {};
}

// Store-currency amount -> coin price at the EUR floor. Returns 0 when we
// can't convert (missing rate / bad price) so the seller must set it.
function toCoins(amount, currency, rates) {
  const val = Number(amount);
  if (!Number.isFinite(val) || val <= 0) return 0;
  const cur = String(currency || 'EUR').toUpperCase();
  let eur;
  if (cur === 'EUR') eur = val;
  else {
    const rate = Number(rates?.[cur]); // 1 EUR = rate CUR
    if (!Number.isFinite(rate) || rate <= 0) return 0;
    eur = val / rate;
  }
  return Math.max(1, Math.ceil(eur / COIN_EUR));
}

function integrationRef(uid) {
  return db.collection('users').doc(uid).collection('private').doc('shopIntegration');
}

// Public-safe view of an integration (NEVER the token/secret).
function safeIntegration(d) {
  if (!d) return null;
  return {
    provider: d.provider || null,
    shopDomain: d.shopDomain || null,
    shopName: d.shopName || null,
    currency: d.currency || null,
    productCount: d.productCount || 0,
    connectedAt: d.connectedAt || null,
    lastSyncAt: d.lastSyncAt || null,
    lastSyncError: d.lastSyncError || null,
    // { plan, cap, total } when the catalog was trimmed to the plan's limit.
    planCap: d.planCap || null,
  };
}

// ── provider adapters ────────────────────────────────────────────────
// Each returns { ok, shopName, currency, error } for a connection test, and
// { items:[{externalId, variantId, inventoryItemId, title, imageUrl, price,
// currency, stock}] } for a product pull.

const shopifyTest = (host, token) => shopifyApi.testConnection(host, token);
const shopifyLocationId = (host, token) => shopifyApi.primaryLocationId(host, token);

async function shopifyPull(host, token) {
  const res = await shopifyApi.pullProducts(host, token, { max: MAX_IMPORT });
  if (!res.ok) return null;
  return res.items.map((p) => {
    const variants = p.variants.length
      ? p.variants
      // A product with no variant rows still has a buyable default in Shopify;
      // synthesise one so it doesn't silently vanish from the catalog.
      : [{ id: null, numericId: '', title: '', sku: '', price: p.price, imageUrl: p.imageUrl, inventoryItemId: null, stock: null, available: true, options: [] }];

    const tracked = variants.filter((v) => typeof v.stock === 'number');
    return {
      externalId: p.externalId,
      // Kept for back-compat with docs imported by the REST version: the
      // single-variant fields still point at the default variant.
      variantId: variants[0].id,
      inventoryItemId: variants[0].inventoryItemId,
      title: p.title,
      imageUrl: p.imageUrl,
      handle: p.handle,
      // Lowest variant price is what a storefront shows as "from X".
      price: variants.reduce((lo, v) => {
        const n = Number(v.price);
        return Number.isFinite(n) && (lo === null || n < lo) ? n : lo;
      }, null) ?? p.price,
      // null = nothing tracked = unlimited. Only sum the variants that DO
      // track, otherwise one untracked variant would read as zero stock.
      stock: tracked.length ? tracked.reduce((s, v) => s + Math.max(0, v.stock), 0) : null,
      variants,
    };
  });
}

function wooAuthHeader(key, secret) {
  return 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
}

async function wooTest(host, key, secret) {
  const auth = wooAuthHeader(key, secret);
  const { ok, status } = await httpJson(
    `https://${host}/wp-json/wc/v3/products?per_page=1`, { headers: { Authorization: auth } });
  if (!ok) {
    return { ok: false, error: status === 401
      ? 'WooCommerce rejected the key/secret. Give the API key Read/Write permission.'
      : `Could not reach this WooCommerce store (status ${status || 'network'}).` };
  }
  // Currency (best-effort — Woo returns it in settings/general).
  let currency = 'EUR';
  const g = await httpJson(`https://${host}/wp-json/wc/v3/settings/general`, { headers: { Authorization: auth } });
  if (Array.isArray(g.json)) {
    const c = g.json.find((s) => s.id === 'woocommerce_currency');
    if (c?.value) currency = String(c.value).toUpperCase();
  }
  return { ok: true, shopName: host, currency };
}

async function wooPull(host, key, secret) {
  const { ok, json } = await httpJson(
    `https://${host}/wp-json/wc/v3/products?per_page=100&status=publish`,
    { headers: { Authorization: wooAuthHeader(key, secret) } });
  if (!ok || !Array.isArray(json)) return null;
  return json.slice(0, MAX_IMPORT).map((p) => ({
    externalId: String(p.id),
    variantId: null,
    inventoryItemId: null,
    title: String(p.name || '').replace(/<[^>]+>/g, '').slice(0, 120),
    imageUrl: p.images?.[0]?.src || '',
    price: p.price || p.regular_price || '0',
    stock: (p.manage_stock && Number.isFinite(Number(p.stock_quantity))) ? Number(p.stock_quantity) : null,
  }));
}

// ── core sync: upsert one seller's external catalog ──────────────────
async function runSync(uid, cfg) {
  const provider = cfg.provider;
  const host = cfg.shopDomain;
  let items;
  let overCap = null;
  if (provider === 'shopify') items = await shopifyPull(host, cfg.accessToken);
  else if (provider === 'woocommerce') items = await wooPull(host, cfg.consumerKey, cfg.consumerSecret);
  else return { ok: false, error: 'Unknown provider.' };

  // PLAN CAP. Shopify merchants pay us a monthly subscription instead of a
  // per-sale cut, so the product cap IS the paid boundary — an unenforced cap
  // means the free tier is the whole product and nobody ever upgrades.
  // Enforced on the sync (not the sale) so the merchant sees the limit while
  // setting up rather than losing a sale to it later.
  if (Array.isArray(items) && provider === 'shopify' && cfg.shopDomain) {
    const plan = await shopifyBilling.cachedPlan(cfg.shopDomain);
    if (items.length > plan.productCap) {
      // Keep the newest-updated products (the pull is sorted UPDATED_AT desc),
      // and tell the caller plainly rather than truncating in silence.
      overCap = { plan: plan.handle, cap: plan.productCap, total: items.length };
      items = items.slice(0, plan.productCap);
    }
  }

  if (!Array.isArray(items)) {
    await integrationRef(uid).set({ lastSyncError: 'Could not read products from the store.', lastSyncAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ok: false, error: 'Could not read products from the store.' };
  }

  const rates = await getFxRates();
  const seenIds = new Set();
  let count = 0;

  // Upsert in batches (Firestore batch cap 500; we cap at MAX_IMPORT anyway).
  const batch = db.batch();
  for (const it of items) {
    const docId = `shop_${provider}_${it.externalId}`;
    seenIds.add(docId);
    const ref = db.collection('users').doc(uid).collection('vergrMeProducts').doc(docId);
    const converted = toCoins(it.price, cfg.currency, rates);
    const base = {
      kind: 'physical',
      source: provider,
      // THE FEE RULE (founder, 2026-07-19): Vergr takes its percentage when a
      // creator uploads their OWN product and has no store linked. Anything
      // synced from Shopify checks out in Shopify and we take NO cut — that
      // merchant pays us a monthly app subscription instead. So the rule keys
      // on the SOURCE, not on how the store was connected: every Shopify
      // product is permalink, full stop.
      //
      // WooCommerce stays on coins at the 8% fee. It is not an App Store
      // channel, has no subscription attached, and taking nothing there would
      // mean earning nothing from those sellers at all.
      checkoutMode: provider === 'shopify' ? 'permalink' : 'coins',
      shopDomain: cfg.shopDomain || '',
      externalId: it.externalId,
      externalVariantId: it.variantId,
      inventoryItemId: it.inventoryItemId,
      name: it.title || 'Product',
      coverUrl: it.imageUrl || '',
      stock: it.stock,                 // null = untracked/unlimited on their side
      // Variant rows drive the buyer's picker and the per-variant stock
      // decrement. Priced in the STORE's currency; the coin price is derived
      // per variant at render time from syncedPriceCoins' same FX pass.
      variants: (it.variants || []).map((v) => ({
        id: v.id || null,
        numericId: v.numericId || '',
        title: v.title || '',
        sku: v.sku || '',
        storePrice: String(v.price || ''),
        priceCoins: toCoins(v.price, cfg.currency, rates),
        imageUrl: v.imageUrl || '',
        inventoryItemId: v.inventoryItemId || null,
        stock: typeof v.stock === 'number' ? v.stock : null,
        available: v.available !== false,
        options: Array.isArray(v.options) ? v.options.slice(0, 3) : [],
      })),
      hasVariants: (it.variants || []).length > 1,
      externalHandle: it.handle || '',
      syncedPriceCoins: converted,     // the auto-converted reference price
      storePrice: String(it.price || ''),
      storeCurrency: cfg.currency || '',
      syncPaused: false,
      lastSyncedAt: FieldValue.serverTimestamp(),
    };
    // priceCoins: set on first import; on re-sync only when NOT overridden.
    // Merge-write does not tell us if the doc pre-exists, so we read the flag
    // cheaply is avoided — instead we always write syncedPriceCoins, and set
    // priceCoins conditionally via a field transform is not possible, so we
    // set priceCoins only when converted>0 AND rely on the editor stamping
    // priceOverridden:true (never cleared here) to protect edits.
    // To respect overrides without a per-doc read, we DON'T write priceCoins
    // here for existing overridden docs — enforced below via a targeted read.
    batch.set(ref, base, { merge: true });
    count++;
  }
  await batch.commit();

  // Second pass: set priceCoins where it's safe (new docs or non-overridden),
  // and mark newly-published so they appear. One read per product, but only
  // for the imported set (<=250) and only daily — acceptable + correct.
  const priceBatch = db.batch();
  for (const it of items) {
    const docId = `shop_${provider}_${it.externalId}`;
    const ref = db.collection('users').doc(uid).collection('vergrMeProducts').doc(docId);
    const snap = await ref.get();
    const d = snap.data() || {};
    const converted = toCoins(it.price, cfg.currency, rates);
    const patch = {};
    if (d.priceOverridden !== true && converted > 0) patch.priceCoins = converted;
    if (d.published === undefined) patch.published = false; // seller opts each in
    if (Object.keys(patch).length) priceBatch.set(ref, patch, { merge: true });
  }
  await priceBatch.commit();

  // Products removed from the store -> unpublish (keep history).
  const existing = await db.collection('users').doc(uid).collection('vergrMeProducts')
    .where('source', '==', provider).get();
  const staleBatch = db.batch();
  existing.forEach((doc) => {
    if (!seenIds.has(doc.id) && doc.data().published !== false) {
      staleBatch.set(doc.ref, { published: false, syncStale: true }, { merge: true });
    }
  });
  await staleBatch.commit();

  await integrationRef(uid).set({
    productCount: count,
    lastSyncAt: FieldValue.serverTimestamp(),
    lastSyncError: null,
    // Surfaced, not swallowed: a merchant whose catalog was trimmed needs to
    // know why and what to do about it.
    planCap: overCap || FieldValue.delete(),
  }, { merge: true });
  return { ok: true, productCount: count, overCap };
}

// ── write-back: called from purchaseVergrMeProduct AFTER commit ──────
// Best-effort; a store API hiccup must never fail a paid purchase (our copy
// is authoritative, the daily re-sync reconciles). `newStock` is our
// post-sale stock value.
async function decrementExternalStock(sellerUid, product, newStock) {
  try {
    if (!product?.source || product.source === 'native') return;
    const snap = await integrationRef(sellerUid).get();
    if (!snap.exists) return;
    const cfg = snap.data();
    if (cfg.provider !== product.source) return;
    const host = cfg.shopDomain;
    if (product.source === 'shopify') {
      if (!product.inventoryItemId || !cfg.locationId) return;
      // Integrations connected before the GraphQL rewrite stored a NUMERIC
      // location id from the REST locations.json; the mutation needs a GID.
      const locationId = String(cfg.locationId).startsWith('gid://')
        ? cfg.locationId
        : `gid://shopify/Location/${String(cfg.locationId).replace(/\D/g, '')}`;
      const inventoryItemId = String(product.inventoryItemId).startsWith('gid://')
        ? product.inventoryItemId
        : `gid://shopify/InventoryItem/${String(product.inventoryItemId).replace(/\D/g, '')}`;
      const r = await shopifyApi.adjustInventory(host, cfg.accessToken, {
        inventoryItemId,
        locationId,
        delta: -1,
        // Stable per purchase, so a retry cannot decrement the merchant's real
        // stock twice. @idempotent has been mandatory since API 2026-04.
        idempotencyKey: product.purchaseId ? `vergr-${product.purchaseId}` : undefined,
        referenceUri: product.purchaseId ? `https://vergr.app/purchases/${product.purchaseId}` : undefined,
      });
      if (!r.ok) console.error('shopify stock write-back failed (non-fatal)', sellerUid, r.error);
    } else if (product.source === 'woocommerce') {
      if (!product.externalId) return;
      await httpJson(`https://${host}/wp-json/wc/v3/products/${product.externalId}`, {
        method: 'PUT',
        headers: { Authorization: wooAuthHeader(cfg.consumerKey, cfg.consumerSecret), 'Content-Type': 'application/json' },
        body: { stock_quantity: Math.max(0, Number(newStock) || 0), manage_stock: true },
      });
    }
  } catch (e) {
    console.error('decrementExternalStock failed (non-fatal)', sellerUid, e?.message);
  }
}

// ── callables ────────────────────────────────────────────────────────
exports.connectShopIntegration = functions.https.onCall(
  { region: REGION, cors: true },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const provider = String(req.data?.provider || '');
    const host = normHost(req.data?.shopDomain);
    if (!['shopify', 'woocommerce'].includes(provider)) throw new functions.https.HttpsError('invalid-argument', 'Unknown provider.');
    if (!host) throw new functions.https.HttpsError('invalid-argument', 'Enter a valid store domain.');

    let cfg;
    if (provider === 'shopify') {
      const token = String(req.data?.accessToken || '').trim();
      if (!token) throw new functions.https.HttpsError('invalid-argument', 'Paste your Admin API access token.');
      const test = await shopifyTest(host, token);
      if (!test.ok) throw new functions.https.HttpsError('failed-precondition', test.error);
      const locationId = await shopifyLocationId(host, token);
      // Seller-pasted token: NOT an App Store distribution, so coin checkout
      // is allowed. The public app's install path sets 'app_oauth' instead.
      cfg = { provider, shopDomain: host, accessToken: token, locationId, shopName: test.shopName, currency: test.currency, connectionType: 'custom_token' };
    } else {
      const key = String(req.data?.consumerKey || '').trim();
      const secret = String(req.data?.consumerSecret || '').trim();
      if (!key || !secret) throw new functions.https.HttpsError('invalid-argument', 'Paste your consumer key and secret.');
      const test = await wooTest(host, key, secret);
      if (!test.ok) throw new functions.https.HttpsError('failed-precondition', test.error);
      cfg = { provider, shopDomain: host, consumerKey: key, consumerSecret: secret, shopName: test.shopName, currency: test.currency, connectionType: 'custom_token' };
    }

    await integrationRef(uid).set({ ...cfg, connectedAt: FieldValue.serverTimestamp(), lastSyncError: null }, { merge: true });
    await db.collection('app_config').doc('general').set({ shopIntegrationsActive: true }, { merge: true });
    // Registry for the daily reconcile — avoids a collectionGroup index.
    await db.collection('shop_connected').doc(uid).set({ provider, connectedAt: FieldValue.serverTimestamp() }, { merge: true });

    // Kick off the first sync immediately so the catalog isn't empty.
    const full = (await integrationRef(uid).get()).data();
    const sync = await runSync(uid, full).catch((e) => ({ ok: false, error: e?.message }));
    return { ok: true, integration: safeIntegration({ ...cfg }), sync };
  }
);

exports.syncShopInventory = functions.https.onCall(
  { region: REGION, cors: true, timeoutSeconds: 120 },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const snap = await integrationRef(uid).get();
    if (!snap.exists) throw new functions.https.HttpsError('failed-precondition', 'No store connected.');
    const res = await runSync(uid, snap.data());
    if (!res.ok) throw new functions.https.HttpsError('unavailable', res.error || 'Sync failed.');
    const after = (await integrationRef(uid).get()).data();
    return { ok: true, integration: safeIntegration(after), productCount: res.productCount };
  }
);

exports.disconnectShopIntegration = functions.https.onCall(
  { region: REGION, cors: true },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const snap = await integrationRef(uid).get();
    const provider = snap.exists ? snap.data().provider : null;
    await integrationRef(uid).delete().catch(() => {});
    await db.collection('shop_connected').doc(uid).delete().catch(() => {});
    // Pause the synced products (don't hard-delete — keeps buyer history) and
    // hide them so they stop selling without a live store behind them.
    if (provider) {
      const rows = await db.collection('users').doc(uid).collection('vergrMeProducts')
        .where('source', '==', provider).get();
      const batch = db.batch();
      rows.forEach((doc) => batch.set(doc.ref, { syncPaused: true, published: false }, { merge: true }));
      await batch.commit();
    }
    return { ok: true };
  }
);

exports.getMyShopIntegration = functions.https.onCall(
  { region: REGION, cors: true },
  async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const snap = await integrationRef(uid).get();
    return { integration: snap.exists ? safeIntegration(snap.data()) : null };
  }
);

// ── scheduled reconcile (folded into cronDaily) ──────────────────────
// Cost-gated: returns immediately unless at least one store is connected.
async function syncAllShopInventories() {
  const cfg = await db.collection('app_config').doc('general').get();
  if (!cfg.exists || cfg.data().shopIntegrationsActive !== true) return;
  const connected = await db.collection('shop_connected').get();
  let synced = 0;
  for (const doc of connected.docs) {
    const uid = doc.id;
    try {
      const iSnap = await integrationRef(uid).get();
      if (!iSnap.exists) { await doc.ref.delete().catch(() => {}); continue; }
      await runSync(uid, iSnap.data());
      synced++;
    } catch (e) { console.error('daily shop sync failed', uid, e?.message); }
  }
  console.log(`syncAllShopInventories: reconciled ${synced} store(s)`);
}

exports.syncAllShopInventories = syncAllShopInventories;
exports.decrementExternalStock = decrementExternalStock;
