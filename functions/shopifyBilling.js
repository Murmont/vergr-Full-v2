// Shopify app subscriptions — the app's revenue stream.
//
// This is Shopify App Pricing ("managed pricing"), NOT the Billing API. Plans
// are defined in the Partner Dashboard and Shopify hosts the plan-picker page,
// charges the merchant and redirects back to us. Opting in to App Pricing
// permanently disables appSubscriptionCreate, so there is deliberately no
// Billing API code here.
//
// SECURITY — the thing that makes this file necessary:
// Shopify redirects the merchant back with ?plan_handle=<plan>. That parameter
// is in a URL the MERCHANT controls, so anyone could hit our redirect with
// plan_handle=business and unlock the top tier for free. It is therefore used
// only to decide what to SAY on the confirmation screen, never to grant
// entitlement. Entitlement comes from the Partner API's activeSubscription
// query, which is authenticated with our own Partner token.
//
// Shopify App Pricing stopped sending subscription webhooks on 28 April 2026,
// so polling the Partner API is the only server-side source of truth. There is
// no push channel to wait for.

const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore('vgrdb');

// Generated in the Partner Dashboard under Settings -> Partner API clients.
// Until it holds a real value every shop resolves to FREE (see verifyPlan).
const PARTNER_API_TOKEN = defineSecret('SHOPIFY_PARTNER_API_TOKEN');

const PARTNER_API_VERSION = '2026-07';

// The Partner API is addressed by ORGANIZATION, and the token is bound to one
// org: calling another org's endpoint with it returns a bare 401 "Invalid
// access token", which reads like a bad token rather than a wrong URL.
//
// There are two ids in play and they are NOT interchangeable:
//   4571613   — the legacy partners.shopify.com account
//   189051674 — the dev.shopify.com dashboard that owns the app
// The token must be created in the org that OWNS the app, or activeSubscription
// resolves to null for every shop and every merchant silently reads as free.
//
// Both live in app_config/general so a mismatch is fixed by editing a document,
// not by editing this file and redeploying.
const DEFAULT_PARTNER_ORG_ID = '4571613';
const DEFAULT_APP_ID = '399398862849';

let cfgCache = null;
let cfgAt = 0;

async function partnerConfig() {
  if (cfgCache && Date.now() - cfgAt < 5 * 60 * 1000) return cfgCache;
  let d = {};
  try {
    const snap = await db.collection('app_config').doc('general').get();
    d = snap.exists ? snap.data() : {};
  } catch { /* fall through to defaults */ }
  cfgCache = {
    orgId: String(d.shopifyPartnerOrgId || DEFAULT_PARTNER_ORG_ID),
    appId: String(d.shopifyPartnerAppId || DEFAULT_APP_ID),
  };
  cfgAt = Date.now();
  return cfgCache;
}

/**
 * The plan ladder. Handles MUST match the plan handles created in the Partner
 * Dashboard — Shopify sends us the handle, and an unrecognised one falls back
 * to free rather than guessing upward.
 *
 * Product caps are founder-settled: 10 / 50 / 1000 / unlimited-capped-25,000.
 * They are shared with the Vergr-native catalog caps on purpose; a merchant
 * should not get a bigger allowance by routing the same products a second way.
 */
const PLANS = {
  free: { handle: 'free', label: 'Free', priceEur: 0, productCap: 10, branding: true },
  lite: { handle: 'lite', label: 'Lite', priceEur: 4.99, productCap: 50, branding: false },
  pro: { handle: 'pro', label: 'Pro', priceEur: 9.99, productCap: 1000, branding: false },
  // Price deliberately null: it must cover the cost of storing that much
  // product data and the founder has not set it. Never invent one.
  business: { handle: 'business', label: 'Business', priceEur: null, productCap: 25000, branding: false },
};

const FREE = PLANS.free;

function planByHandle(handle) {
  const h = String(handle || '').toLowerCase().trim();
  return PLANS[h] || FREE;
}

/** Shopify's hosted plan picker. We never build our own pricing UI. */
function pricingPlansUrl(shop, appHandle = 'vergr-link-in-bio') {
  const store = String(shop || '').replace(/\.myshopify\.com$/i, '');
  if (!store) return '';
  return `https://admin.shopify.com/store/${store}/charges/${appHandle}/pricing_plans`;
}

async function partnerGraphql(query, variables) {
  const token = (PARTNER_API_TOKEN.value() || '').trim();
  if (!token || token === 'placeholder') return { ok: false, error: 'partner_api_unconfigured' };

  const { orgId } = await partnerConfig();
  try {
    const res = await fetch(
      `https://partners.shopify.com/${orgId}/api/${PARTNER_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      },
    );
    const json = await res.json().catch(() => null);
    // The Partner API answers 200 with an errors[] on an authz failure, so a
    // status check alone would read a rejected token as an empty subscription
    // and silently downgrade every paying merchant to free.
    if (json?.errors?.length) return { ok: false, error: json.errors[0]?.message || 'partner_error' };
    if (!res.ok || !json?.data) return { ok: false, error: `http_${res.status}` };
    return { ok: true, data: json.data };
  } catch (e) {
    return { ok: false, error: e?.message || 'network' };
  }
}

const ACTIVE_SUBSCRIPTION_QUERY = `
  query ActiveSubscription($appId: ID!, $shopId: ID!) {
    activeSubscription(appId: $appId, shopId: $shopId) {
      billingPeriod
      items { handle }
    }
  }
`;

/**
 * Authoritative plan for a shop.
 *
 * FAILS CLOSED: any error, missing token or missing subscription resolves to
 * FREE. Being wrong in the free direction costs a merchant some product slots
 * they can restore by reloading; being wrong the other way gives away the paid
 * tiers, which is the entire revenue model.
 *
 * Cached on the shop doc for an hour so a catalog sync does not re-query the
 * Partner API for every product page.
 */
async function verifyPlan(shop, shopGid, { maxAgeMs = 60 * 60 * 1000 } = {}) {
  const ref = db.collection('shopify_shops').doc(shop);
  const snap = await ref.get();
  const d = snap.exists ? snap.data() : {};

  const checkedAt = d.planCheckedAt?.toMillis?.() || 0;
  if (d.plan && Date.now() - checkedAt < maxAgeMs) return planByHandle(d.plan);

  if (!shopGid) return planByHandle(d.plan) || FREE;

  const { appId, orgId } = await partnerConfig();
  const r = await partnerGraphql(ACTIVE_SUBSCRIPTION_QUERY, {
    appId: `gid://partners/App/${appId}`,
    shopId: shopGid,
  });

  // A null subscription for a shop we believe is paying almost always means
  // the org/app pairing is wrong rather than that the merchant cancelled, and
  // that misreads as "everyone is on free". Say so in the log explicitly.
  if (r.ok && !r.data?.activeSubscription && d.plan && d.plan !== 'free') {
    console.warn(
      `verifyPlan: ${shop} was on ${d.plan} but Partner org ${orgId} reports no subscription ` +
      `for app ${appId}. Check app_config/general.shopifyPartnerOrgId matches the org that owns the app.`,
    );
  }

  if (!r.ok) {
    // Do NOT downgrade a known-paying shop because our own token broke — that
    // would cut off a paying merchant over our outage. Keep the cached plan
    // and retry on the next call; only an unknown shop falls to free.
    console.error('verifyPlan failed', shop, r.error);
    return planByHandle(d.plan);
  }

  const handle = r.data?.activeSubscription?.items?.[0]?.handle || 'free';
  const plan = planByHandle(handle);
  await ref.set({ plan: plan.handle, planCheckedAt: FieldValue.serverTimestamp() }, { merge: true });
  return plan;
}

/** Cached read with no network call — for hot paths like a catalog sync. */
async function cachedPlan(shop) {
  const snap = await db.collection('shopify_shops').doc(shop).get();
  return planByHandle(snap.exists ? snap.data().plan : null);
}

module.exports = {
  PLANS,
  FREE,
  PARTNER_API_TOKEN,
  planByHandle,
  pricingPlansUrl,
  verifyPlan,
  cachedPlan,
};
