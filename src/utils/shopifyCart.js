// Shopify cart permalinks — the sanctioned checkout path for a sales channel.
//
// A Shopify App Store sales channel MUST send buyers to Shopify Checkout, so
// products synced through the public app carry checkoutMode:'permalink' and
// are never sold for coins. We pre-load their cart and hand off; Shopify owns
// payment, tax, shipping and refunds from that point, and its own final stock
// check is our best defence against overselling.
//
// Mirrors cartPermalink() in functions/shopifyGraphql.js. Format verified
// against shopify.dev/docs/apps/build/checkout/create-cart-permalinks.

// Attribution handle. Shopify credits the order to this channel, which is how
// merchants see what Vergr actually earned them.
const SOURCE_NAME = 'vergr';

/** `gid://shopify/ProductVariant/123` -> `123`. */
export function variantNumericId(variant) {
  if (!variant) return '';
  if (variant.numericId) return String(variant.numericId);
  const m = /\/(\d+)(?:\?|$)/.exec(String(variant.id || ''));
  return m ? m[1] : String(variant.id || '').replace(/\D/g, '');
}

/**
 * Build a cart permalink for one or more variants.
 *
 * The path segment takes the NUMERIC variant id, not the GraphQL GID — a raw
 * gid here produces a link that loads an empty cart with no error.
 */
export function buildCartPermalink(shopDomain, lines, { discount = '' } = {}) {
  const domain = String(shopDomain || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!domain) return '';

  const parts = (Array.isArray(lines) ? lines : [lines])
    .map((l) => {
      const id = variantNumericId(l.variant || l);
      const qty = Math.max(1, Number(l.quantity) || 1);
      return id ? `${id}:${qty}` : '';
    })
    .filter(Boolean);
  if (!parts.length) return '';

  const qs = new URLSearchParams({ source_name: SOURCE_NAME });
  // Shopify cannot parse a discount code containing a comma in this parameter.
  if (discount && !discount.includes(',')) qs.set('discount', discount);

  return `https://${domain}/cart/${parts.join(',')}?${qs.toString()}`;
}

/** True when this product must check out on the merchant's store, not for coins. */
export function isPermalinkProduct(product) {
  return product?.checkoutMode === 'permalink';
}

/**
 * Hand off to Shopify Checkout.
 *
 * Opened in a new tab so the creator's page survives behind it: a buyer who
 * abandons checkout lands back on the link-in-bio instead of a dead end.
 */
export function openCartCheckout(product, variant, opts = {}) {
  const url = buildCartPermalink(product?.shopDomain, { variant: variant || (product?.variants || [])[0] }, opts);
  if (!url) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
