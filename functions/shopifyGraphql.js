// Shared Shopify Admin GraphQL client.
//
// New public apps are GraphQL-only (REST Admin API closed to new apps in
// April 2025), so every Shopify call in the codebase routes through here.
// Two callers with different token sources, identical wire protocol:
//   - functions/shopSync.js   -> seller's own custom-app Admin token
//   - functions/shopifyApp.js -> OAuth token from the public app install
//
// Rate limiting is a LEAKY BUCKET measured in points, not requests: standard
// plans restore 100 points/second, Plus 1000 (verified against
// shopify.dev/docs/api/usage/rate-limits, July 2026). Every response carries
// extensions.cost.throttleStatus, so we steer off the real remaining budget
// rather than blind-sleeping between calls.

const crypto = require('crypto');

const API_VERSION = '2026-07';
const MAX_ATTEMPTS = 4;

// Keep a floor of points in the bucket. Draining it fully makes the NEXT
// caller (a live buyer's stock write-back) eat the throttle, and that one
// cannot afford to wait.
const POINT_FLOOR = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One GraphQL call with throttle-aware retry.
 *
 * THROTTLED is not an error here, it is backpressure: Shopify tells us how
 * many points we need and how fast they restore, so we can compute the exact
 * wait instead of guessing. A fixed sleep is either too short (429 loop) or
 * far too long (a 250-product sync times out).
 */
async function shopifyGraphql(host, token, query, variables = {}, { timeoutMs = 15000 } = {}) {
  let lastError = 'unknown';

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res, json;
    try {
      res = await fetch(`https://${host}/admin/api/${API_VERSION}/graphql.json`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'VergrBot/1.0 (+https://vergr.app)',
        },
        body: JSON.stringify({ query, variables }),
      });
      json = await res.json().catch(() => null);
    } catch (e) {
      lastError = e?.name === 'AbortError' ? 'timeout' : (e?.message || 'network');
      clearTimeout(timer);
      // Network blips are worth one cheap retry; a timeout usually is not.
      if (lastError === 'timeout' || attempt === MAX_ATTEMPTS - 1) {
        return { ok: false, error: lastError, status: 0 };
      }
      await sleep(500 * (attempt + 1));
      continue;
    }
    clearTimeout(timer);

    // 401/403 are terminal: the token is wrong or its scopes were revoked.
    // Retrying just burns the remaining function timeout.
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, error: 'unauthorized', json };
    }

    const throttled = res.status === 429
      || (json?.errors || []).some((e) => e?.extensions?.code === 'THROTTLED');

    if (throttled) {
      const cost = json?.extensions?.cost;
      const status = cost?.throttleStatus;
      const needed = Number(cost?.requestedQueryCost) || 50;
      const available = Number(status?.currentlyAvailable) || 0;
      const restore = Number(status?.restoreRate) || 50;
      const waitMs = Math.min(10000, Math.max(1000, Math.ceil(((needed - available) / restore) * 1000)));
      if (attempt === MAX_ATTEMPTS - 1) {
        return { ok: false, status: 429, error: 'throttled', json };
      }
      await sleep(waitMs);
      continue;
    }

    // A GraphQL response can be HTTP 200 and still carry a fatal errors[].
    // Checking res.ok alone reads a hard failure as success.
    if (json?.errors?.length) {
      return { ok: false, status: res.status, error: json.errors[0]?.message || 'graphql_error', json };
    }
    if (!res.ok || !json?.data) {
      return { ok: false, status: res.status, error: `http_${res.status}`, json };
    }

    return { ok: true, data: json.data, cost: json.extensions?.cost || null };
  }

  return { ok: false, status: 0, error: lastError };
}

/** Pause when the bucket is nearly dry, so the next call isn't throttled. */
async function respectBudget(cost) {
  const s = cost?.throttleStatus;
  if (!s) return;
  const available = Number(s.currentlyAvailable) || 0;
  if (available >= POINT_FLOOR) return;
  const restore = Number(s.restoreRate) || 50;
  await sleep(Math.min(5000, Math.ceil(((POINT_FLOOR - available) / restore) * 1000)));
}

/** `gid://shopify/ProductVariant/123` -> `123`. Cart permalinks take the numeric id. */
function gidToNumeric(gid) {
  const m = /\/(\d+)(?:\?|$)/.exec(String(gid || ''));
  return m ? m[1] : '';
}

const SHOP_QUERY = `
  query { shop { name currencyCode myshopifyDomain } }
`;

/** Connection test. Doubles as the scope check: no read_products -> ACCESS_DENIED. */
async function testConnection(host, token) {
  const r = await shopifyGraphql(host, token, SHOP_QUERY);
  if (!r.ok) {
    if (r.status === 401 || r.status === 403 || r.error === 'unauthorized') {
      return { ok: false, error: 'Shopify rejected the token. Check it has read_products and read/write inventory scopes.' };
    }
    return { ok: false, error: `Could not reach this Shopify store (${r.error}).` };
  }
  const shop = r.data.shop;
  return { ok: true, shopName: shop?.name || host, currency: shop?.currencyCode || 'EUR', domain: shop?.myshopifyDomain || host };
}

const LOCATIONS_QUERY = `
  query { locations(first: 10, includeInactive: false) { nodes { id name } } }
`;

async function primaryLocationId(host, token) {
  const r = await shopifyGraphql(host, token, LOCATIONS_QUERY);
  if (!r.ok) return null;
  return r.data?.locations?.nodes?.[0]?.id || null; // full GID, the mutation wants a GID
}

// Variants are paged INSIDE the product connection. 100 is the per-connection
// ceiling; a product with more than 100 variants keeps its first 100, which is
// far past anything a link-in-bio catalog realistically shows.
const PRODUCTS_QUERY = `
  query VergrProducts($cursor: String, $pageSize: Int!) {
    products(first: $pageSize, after: $cursor, query: "status:active", sortKey: UPDATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        totalInventory
        tracksInventory
        onlineStoreUrl
        featuredMedia { preview { image { url } } }
        priceRangeV2 { minVariantPrice { amount currencyCode } }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            availableForSale
            inventoryQuantity
            selectedOptions { name value }
            image { url }
            inventoryItem { id tracked }
          }
        }
      }
    }
  }
`;

/**
 * Pull the active catalog with full variant detail.
 *
 * Cursor pagination, not the old REST `limit=250`: a merchant with 2,000
 * products previously got a silently truncated catalog with no signal that
 * anything was missing.
 */
async function pullProducts(host, token, { max = 250, pageSize = 50 } = {}) {
  const out = [];
  let cursor = null;

  while (out.length < max) {
    const r = await shopifyGraphql(host, token, PRODUCTS_QUERY, { cursor, pageSize });
    if (!r.ok) {
      // Partial data is worse than none: the stale-sweep would unpublish every
      // product we simply never reached. Fail the whole sync instead.
      return { ok: false, error: r.error, items: null };
    }

    const conn = r.data?.products;
    for (const p of conn?.nodes || []) {
      const variants = (p.variants?.nodes || []).map((v) => ({
        id: v.id,
        numericId: gidToNumeric(v.id),
        title: v.title === 'Default Title' ? '' : String(v.title || '').slice(0, 80),
        sku: v.sku || '',
        price: v.price || '0',
        imageUrl: v.image?.url || '',
        inventoryItemId: v.inventoryItem?.id || null,
        // An untracked variant is NOT out of stock, it is unlimited. Coercing
        // null to 0 here would mark the whole catalog sold out.
        stock: v.inventoryItem?.tracked === false
          ? null
          : (Number.isFinite(Number(v.inventoryQuantity)) ? Number(v.inventoryQuantity) : null),
        available: v.availableForSale !== false,
        options: (v.selectedOptions || []).map((o) => ({ name: o.name, value: o.value })),
      }));

      out.push({
        externalId: gidToNumeric(p.id) || p.id,
        gid: p.id,
        title: String(p.title || '').slice(0, 120),
        handle: p.handle || '',
        onlineStoreUrl: p.onlineStoreUrl || '',
        imageUrl: p.featuredMedia?.preview?.image?.url || variants[0]?.imageUrl || '',
        price: p.priceRangeV2?.minVariantPrice?.amount || variants[0]?.price || '0',
        currency: p.priceRangeV2?.minVariantPrice?.currencyCode || '',
        tracksInventory: p.tracksInventory !== false,
        variants,
      });
      if (out.length >= max) break;
    }

    if (!conn?.pageInfo?.hasNextPage || out.length >= max) break;
    cursor = conn.pageInfo.endCursor;
    await respectBudget(r.cost);
  }

  return { ok: true, items: out, truncated: out.length >= max };
}

const ADJUST_MUTATION = `
  mutation VergrAdjust($input: InventoryAdjustQuantitiesInput!, $key: String!) {
    inventoryAdjustQuantities(input: $input) @idempotent(key: $key) {
      userErrors { field message }
    }
  }
`;

/**
 * Decrement stock for one sold variant.
 *
 * The @idempotent directive is MANDATORY from API version 2026-04. Passing a
 * stable key derived from the order means a retried call cannot double-decrement
 * the merchant's real inventory.
 */
async function adjustInventory(host, token, { inventoryItemId, locationId, delta, idempotencyKey, referenceUri }) {
  if (!inventoryItemId || !locationId) return { ok: false, error: 'missing_ids' };
  const input = {
    name: 'available',
    reason: 'correction',
    changes: [{ inventoryItemId, locationId, delta: Number(delta) }],
  };
  if (referenceUri) input.referenceDocumentUri = referenceUri;

  const r = await shopifyGraphql(host, token, ADJUST_MUTATION, {
    input,
    key: idempotencyKey || crypto.randomUUID(),
  });
  if (!r.ok) return { ok: false, error: r.error };
  const errs = r.data?.inventoryAdjustQuantities?.userErrors || [];
  if (errs.length) return { ok: false, error: errs[0].message };
  return { ok: true };
}

/**
 * Cart permalink: the sanctioned checkout path for App Store sales channels.
 *
 * Format verified against shopify.dev/docs/apps/build/checkout/create-cart-permalinks
 * (July 2026): /cart/{numericVariantId}:{qty}. It takes the NUMERIC variant id,
 * not the GraphQL GID, so a raw gid here yields a dead link.
 */
function cartPermalink(shopDomain, lines, { sourceName = 'vergr', discount = '' } = {}) {
  const parts = (Array.isArray(lines) ? lines : [lines])
    .map((l) => {
      const id = gidToNumeric(l.variantId) || String(l.variantId || '').replace(/\D/g, '');
      const qty = Math.max(1, Number(l.quantity) || 1);
      return id ? `${id}:${qty}` : '';
    })
    .filter(Boolean);
  if (!parts.length) return '';
  const qs = new URLSearchParams();
  if (sourceName) qs.set('source_name', sourceName);
  // Shopify cannot parse a discount code containing a comma in this parameter.
  if (discount && !discount.includes(',')) qs.set('discount', discount);
  const q = qs.toString();
  return `https://${shopDomain}/cart/${parts.join(',')}${q ? `?${q}` : ''}`;
}

module.exports = {
  API_VERSION,
  shopifyGraphql,
  testConnection,
  primaryLocationId,
  pullProducts,
  adjustInventory,
  cartPermalink,
  gidToNumeric,
};
