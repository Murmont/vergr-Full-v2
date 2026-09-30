// Shopify public app — "Vergr Link In Bio" (app id 399398862849).
//
// This is the PUBLIC App Store app, and it is a different thing from
// functions/shopSync.js. shopSync is the seller-pastes-a-token path for the
// existing Vergr Shop (coin-paid, our checkout). This module is the OAuth'd
// Shopify app: products sync in, but buyers check out INSIDE Shopify via a
// cart permalink, because a sales channel app is not permitted to use an
// external checkout. See docs/handover/16_SHOPIFY_APPS.md section 0.
//
// Everything here is served through ONE onRequest, mounted on the hosting
// rewrite /shopify/**, so there is no second server to pay for:
//   GET  /shopify              install entry / embedded admin shell
//   GET  /shopify/callback     OAuth callback
//   POST /shopify/webhooks     compliance webhooks + app/uninstalled
//
// Dormant-safe: the two secrets seed to 'placeholder', in which case every
// route answers 503 rather than half-working.

const functions = require('firebase-functions/v2');
const crypto = require('crypto');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const shopifyBilling = require('./shopifyBilling');
const shopifyApi = require('./shopifyGraphql');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const CLIENT_ID = functions.params.defineString('SHOPIFY_APP_CLIENT_ID');
const CLIENT_SECRET = functions.params.defineSecret('SHOPIFY_APP_CLIENT_SECRET');

// Quarterly. Bump deliberately — a stale version keeps working until Shopify
// retires it, so this is a scheduled chore, not a silent break.
const API_VERSION = '2026-07';

const APP_HOST = 'https://vergr.app';
const REDIRECT_URI = `${APP_HOST}/shopify/callback`;

// Minimal scopes for a link-in-bio channel: read the catalog, publish to our
// channel. No customer/order scopes — we never see an order, their checkout does.
const SCOPES = 'read_products,write_product_listings';

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

// ── helpers ──────────────────────────────────────────────────────────
function secretsReady() {
  const id = (CLIENT_ID.value() || '').trim();
  const sec = (CLIENT_SECRET.value() || '').trim();
  return id && sec && id !== 'placeholder' && sec !== 'placeholder';
}

function validShop(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return SHOP_RE.test(s) ? s : '';
}

// Constant-time compare that can't throw on a length mismatch (timingSafeEqual
// does throw, and a throw here would read as a server error instead of "no").
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// OAuth query HMAC: every param except hmac/signature, sorted, k=v joined by
// &, HMAC-SHA256 hex. Shopify signs the REQUEST, so this is what proves the
// install redirect actually came from them.
function verifyQueryHmac(query) {
  const { hmac, signature, ...rest } = query || {};
  if (!hmac) return false;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(',') : rest[k]}`)
    .join('&');
  const digest = crypto
    .createHmac('sha256', CLIENT_SECRET.value().trim())
    .update(message, 'utf8')
    .digest('hex');
  return safeEqual(digest, hmac);
}

// Webhook HMAC: base64 over the RAW body. Must never be computed from a
// re-serialized JSON object — key order would differ and every webhook would
// fail. req.rawBody is what Functions gives us for exactly this.
function verifyWebhookHmac(rawBody, header) {
  if (!rawBody || !header) return false;
  const digest = crypto
    .createHmac('sha256', CLIENT_SECRET.value().trim())
    .update(rawBody)
    .digest('base64');
  return safeEqual(digest, header);
}

async function shopifyGraphql(shop, token, query, variables) {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables: variables || {} }),
  });
  const json = await res.json().catch(() => null);
  // GraphQL answers 200 with an errors[] on failure, so a status check alone
  // reads that as success. Same trap as the Cloudflare cost panel.
  if (!res.ok || json?.errors) {
    return { ok: false, status: res.status, errors: json?.errors || null, data: null };
  }
  return { ok: true, status: res.status, errors: null, data: json?.data || null };
}

function shopRef(shop) {
  return db.collection('shopify_shops').doc(shop);
}

// ── webhook registration ─────────────────────────────────────────────
// The three COMPLIANCE webhooks are declared in the app config in the Dev
// dashboard, not registered here. These are the operational ones.
const WEBHOOK_TOPICS = [
  'APP_UNINSTALLED',
  'PRODUCTS_CREATE',
  'PRODUCTS_UPDATE',
  'PRODUCTS_DELETE',
];

const REGISTER_MUTATION = `
  mutation register($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
    webhookSubscriptionCreate(
      topic: $topic
      webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
    ) {
      userErrors { field message }
      webhookSubscription { id }
    }
  }`;

async function registerWebhooks(shop, token) {
  const callbackUrl = `${APP_HOST}/shopify/webhooks`;
  const results = [];
  for (const topic of WEBHOOK_TOPICS) {
    const r = await shopifyGraphql(shop, token, REGISTER_MUTATION, { topic, callbackUrl });
    const userErrors = r.data?.webhookSubscriptionCreate?.userErrors || [];
    // Re-registering an identical subscription is an expected no-op on
    // reinstall, so a "already exists" userError is not a failure.
    results.push({ topic, ok: r.ok && userErrors.length === 0, userErrors, errors: r.errors });
  }
  return results;
}

// ── teardown ─────────────────────────────────────────────────────────
// A merchant who uninstalls and still sees their products on Vergr will
// escalate, and be right to. Unpublish rather than hard-delete so a reinstall
// restores rather than re-imports from nothing.
async function uninstallShop(shop) {
  const snap = await shopRef(shop).get();
  if (!snap.exists) return;
  const uid = snap.data().uid || null;

  await shopRef(shop).set(
    {
      uninstalledAt: FieldValue.serverTimestamp(),
      accessToken: FieldValue.delete(),
      active: false,
    },
    { merge: true }
  );

  if (uid) {
    const rows = await db
      .collection('users').doc(uid).collection('vergrMeProducts')
      .where('shopifyShop', '==', shop).get();
    const batch = db.batch();
    rows.forEach((doc) => batch.set(doc.ref, { published: false, syncPaused: true }, { merge: true }));
    await batch.commit();
  }
}

// GDPR erasure. We store no buyer PII from Shopify at all — checkout happens
// inside their store — so the honest answer to a customer request is "we hold
// nothing", and shop/redact drops the whole shop record.
async function handleCompliance(topic, payload) {
  const shop = validShop(payload?.shop_domain) || validShop(payload?.myshopify_domain);
  if (topic === 'shop/redact' && shop) {
    await shopRef(shop).delete().catch(() => {});
    await db.collection('shopify_erasures').add({
      topic, shop, at: FieldValue.serverTimestamp(),
    });
    return;
  }
  // customers/data_request + customers/redact: log the request so we can
  // evidence compliance, but there is no customer data to return or erase.
  await db.collection('shopify_erasures').add({
    topic,
    shop: shop || null,
    customerId: payload?.customer?.id ? String(payload.customer.id) : null,
    at: FieldValue.serverTimestamp(),
    note: 'No customer data held: checkout occurs in the merchant store.',
  });
}

// ── embedded admin shell ─────────────────────────────────────────────
// App Bridge MUST be the first script tag on the page. Serving this from a
// Function (rather than the SPA's index.html) is deliberate: frame-ancestors
// has to name the specific shop, which a static hosting header can't do.
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Shared chrome for every embedded page.
 *
 * `<ui-nav-menu>` is what puts entries under the app in Shopify's left nav —
 * without it the app is a single dead-end screen, which is exactly how this
 * looked before. App Bridge reads it from the DOM, so it must be present on
 * EVERY page, not only the home one, or the nav vanishes on navigation.
 */
function page(shop, host, active, bodyHtml, { title = 'Vergr Link In Bio' } = {}) {
  const apiKey = CLIENT_ID.value().trim();
  const q = `shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host || '')}&embedded=1`;
  const nav = [
    ['/shopify', 'Home', 'home'],
    ['/shopify/products', 'Products', 'products'],
    ['/shopify/settings', 'Settings', 'settings'],
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="shopify-api-key" content="${esc(apiKey)}">
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<title>${esc(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background:#0B0B14; color:#fff; padding:24px; }
  .wrap { max-width:880px; margin:0 auto; }
  h1 { font-size:20px; margin:0 0 4px; letter-spacing:-0.01em; }
  h2 { font-size:15px; margin:0 0 12px; }
  .sub { color:#9CA3AF; margin:0 0 20px; font-size:13.5px; }
  .card { background:#14141F; border:1px solid #2A2A3E; border-radius:14px; padding:20px; margin-bottom:16px; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; }
  code { background:#1A1A2A; padding:2px 6px; border-radius:5px; font-size:12.5px; }
  .btn { display:inline-block; background:linear-gradient(135deg,#7B1FFF,#B44FFF); color:#fff;
         text-decoration:none; font-weight:700; font-size:13.5px; padding:10px 16px;
         border-radius:10px; border:none; cursor:pointer; }
  .btn.sec { background:#1A1A2A; border:1px solid #2A2A3E; }
  .muted { color:#6B7280; font-size:12.5px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:#9CA3AF; font-weight:600; font-size:11.5px; text-transform:uppercase;
       letter-spacing:.04em; padding:0 10px 8px; border-bottom:1px solid #2A2A3E; }
  td { padding:10px; border-bottom:1px solid #1A1A2A; vertical-align:middle; }
  tr:last-child td { border-bottom:none; }
  .thumb { width:38px; height:38px; border-radius:7px; object-fit:cover; background:#1A1A2A; display:block; }
  .pill { display:inline-block; font-size:11px; font-weight:700; padding:3px 8px; border-radius:20px; }
  .ok { background:rgba(61,127,255,.16); color:#7FA8FF; }
  .warn { background:rgba(240,165,0,.16); color:#F0A500; }
  .empty { text-align:center; padding:36px 20px; color:#9CA3AF; }
  a.link { color:#B44FFF; }
</style>
</head>
<body>
<ui-nav-menu>
  ${nav.map(([href, label, id], i) =>
    `<a href="${href}?${q}"${i === 0 ? ' rel="home"' : ''}${id === active ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('\n  ')}
</ui-nav-menu>
<div class="wrap">${bodyHtml}</div>
</body>
</html>`;
}

function planCardHtml(shop, plan, productCount) {
  const isFree = plan.handle === 'free';
  const plansUrl = shopifyBilling.pricingPlansUrl(shop);
  const used = typeof productCount === 'number' ? productCount : null;
  return `<div class="card">
    <div class="row">
      <div>
        <b>${esc(plan.label)} plan</b><br>
        <span class="muted">
          ${used === null ? '' : `${used.toLocaleString()} of `}${plan.productCap.toLocaleString()} products${isFree ? ' · Vergr branding shown' : ''}
        </span>
      </div>
      ${plansUrl ? `<a class="btn${isFree ? '' : ' sec'}" href="${plansUrl}" target="_top">${isFree ? 'Upgrade' : 'Change plan'}</a>` : ''}
    </div>
  </div>`;
}

// ── the single HTTP entry point ──────────────────────────────────────
exports.shopifyApp = functions.https.onRequest(
  { region: REGION, secrets: [CLIENT_SECRET, shopifyBilling.PARTNER_API_TOKEN], cors: false },
  async (req, res) => {
    if (!secretsReady()) {
      res.status(503).send('Shopify app is not configured.');
      return;
    }

    // Hosting rewrites preserve the full path, so this is /shopify/... here.
    const path = (req.path || '/').replace(/^\/shopify/, '').replace(/\/+$/, '') || '/';

    try {
      // ---- RETIRED 2026-07-23 ----
      // This app is superseded by VLink (/vlink). It shares the SAME Partner
      // client_id, so leaving the install route open meant a stale link could
      // install with the old 2-scope config into shopify_shops and land the
      // merchant in a dead static admin. Every entry point now bounces to VLink.
      //
      // /webhooks DELIBERATELY still answers: webhooks registered by a legacy
      // install still point here, and they stay registered until that shop
      // re-authorises. Returning 404 to them would fail Shopify's mandatory
      // compliance-webhook response requirement and inflate our webhook failure
      // rate. It costs nothing to keep answering, so it stays until the legacy
      // shopify_shops collection is confirmed empty.
      if (path !== '/webhooks') {
        const shop = validShop(req.query.shop);
        res.redirect(302, shop
          ? `${APP_HOST}/vlink?shop=${encodeURIComponent(shop)}`
          : `${APP_HOST}/vlink`);
        return;
      }

      // ---- webhooks ----
      if (path === '/webhooks') {
        if (req.method !== 'POST') { res.status(405).send('Method not allowed'); return; }
        const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
        if (!verifyWebhookHmac(req.rawBody, hmacHeader)) {
          res.status(401).send('Invalid HMAC');
          return;
        }
        const topic = String(req.get('X-Shopify-Topic') || '');
        const shopHeader = validShop(req.get('X-Shopify-Shop-Domain'));
        let payload = {};
        try { payload = JSON.parse(req.rawBody.toString('utf8')); } catch {}

        // Answer fast: Shopify retries on timeout, and a retry storm on a slow
        // handler shows up as our "webhook failure rate" in their dashboard.
        res.status(200).send('ok');

        if (topic === 'app/uninstalled') {
          if (shopHeader) await uninstallShop(shopHeader);
        } else if (topic.startsWith('customers/') || topic === 'shop/redact') {
          await handleCompliance(topic, payload);
        } else {
          await db.collection('shopify_webhook_log').add({
            topic, shop: shopHeader || null, at: FieldValue.serverTimestamp(),
          });
        }
        return;
      }

      // ---- OAuth callback ----
      if (path === '/callback') {
        const shop = validShop(req.query.shop);
        const code = String(req.query.code || '');
        const state = String(req.query.state || '');
        if (!shop || !code || !state) { res.status(400).send('Invalid callback.'); return; }
        if (!verifyQueryHmac(req.query)) { res.status(401).send('Invalid HMAC.'); return; }

        // The nonce proves this callback belongs to an install WE started,
        // which is what stops a forged callback planting a token.
        const stateRef = db.collection('shopify_oauth_states').doc(state);
        const stateSnap = await stateRef.get();
        if (!stateSnap.exists || stateSnap.data().shop !== shop) {
          res.status(401).send('Invalid or expired state.');
          return;
        }
        const ageMs = Date.now() - (stateSnap.data().createdAt?.toMillis?.() || 0);
        await stateRef.delete().catch(() => {});
        if (ageMs > 10 * 60 * 1000) { res.status(401).send('Install expired, try again.'); return; }

        const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            client_id: CLIENT_ID.value().trim(),
            client_secret: CLIENT_SECRET.value().trim(),
            code,
          }),
        });
        const tokenJson = await tokenRes.json().catch(() => null);
        const accessToken = tokenJson?.access_token;
        if (!tokenRes.ok || !accessToken) {
          console.error('shopify token exchange failed', shop, tokenRes.status);
          res.status(502).send('Could not complete the install.');
          return;
        }

        await shopRef(shop).set({
          shop,
          accessToken,                       // server-only: rules deny all client reads
          scope: tokenJson.scope || SCOPES,
          apiVersion: API_VERSION,
          // CHECKOUT FORK: this is an App Store distribution, so anything
          // synced from it is a sales-channel listing and must check out
          // inside Shopify. shopSync stamps checkoutMode:'permalink' off this
          // and purchaseVergrMeProduct refuses to take coins for those.
          connectionType: 'app_oauth',
          active: true,
          installedAt: FieldValue.serverTimestamp(),
          uninstalledAt: FieldValue.delete(),
        }, { merge: true });

        const hooks = await registerWebhooks(shop, accessToken).catch((e) => {
          console.error('webhook registration failed', shop, e?.message);
          return [];
        });
        const failed = hooks.filter((h) => !h.ok);
        if (failed.length) console.error('webhook topics failed', shop, JSON.stringify(failed));

        res.redirect(`https://${shop}/admin/apps/${CLIENT_ID.value().trim()}`);
        return;
      }

      // ---- return from Shopify's hosted plan picker ----
      // Shopify charges the merchant, then redirects here with ?plan_handle=.
      // That parameter is in a merchant-controlled URL, so it is used ONLY to
      // trigger a re-check and to word the confirmation. Entitlement comes
      // from the Partner API inside verifyPlan, never from this query string.
      if (path === '/plan-selected') {
        const shop = validShop(req.query.shop);
        if (!shop) { res.status(400).send('Missing or invalid shop parameter.'); return; }

        const snap = await shopRef(shop).get();
        const token = snap.exists ? snap.data().accessToken : null;
        let plan = shopifyBilling.FREE;
        if (token) {
          // The Partner API identifies the shop by its graph id, not domain.
          const g = await shopifyGraphql(shop, token, 'query { shop { id } }');
          plan = await shopifyBilling.verifyPlan(shop, g.ok ? g.data?.shop?.id : null, { maxAgeMs: 0 });
        }
        await shopRef(shop).set({ planSelectedAt: FieldValue.serverTimestamp() }, { merge: true });
        res.redirect(`https://${shop}/admin/apps/${CLIENT_ID.value().trim()}?planned=${encodeURIComponent(plan.handle)}`);
        return;
      }

      // ---- Products: the merchant's real catalog, live from Shopify ----
      if (path === '/products' || path === '/settings') {
        const shop = validShop(req.query.shop);
        if (!shop) { res.status(400).send('Missing or invalid shop parameter.'); return; }
        const snap = await shopRef(shop).get();
        const d = snap.exists ? snap.data() : {};
        if (!d.accessToken) { res.redirect(`/shopify?shop=${encodeURIComponent(shop)}`); return; }
        res.set('Content-Security-Policy', `frame-ancestors https://${shop} https://admin.shopify.com;`);
        const plan = await shopifyBilling.cachedPlan(shop);

        if (path === '/settings') {
          const vergrUrl = d.vergrUsername ? `https://vergr.app/u/${d.vergrUsername}` : null;
          res.status(200).send(page(shop, req.query.host, 'settings', `
            <h1>Settings</h1>
            <p class="sub">Store <code>${esc(shop)}</code></p>
            ${planCardHtml(shop, plan)}
            <div class="card">
              <h2>Your Vergr page</h2>
              ${vergrUrl
                ? `<p class="muted">Products appear at <a class="link" href="${esc(vergrUrl)}" target="_blank" rel="noopener">${esc(vergrUrl)}</a></p>`
                : `<p class="muted">Connect a Vergr account on the Home tab to publish your products.</p>`}
            </div>
            <div class="card">
              <h2>How selling works</h2>
              <p class="muted">Buyers tap a product on your Vergr page and check out in your own
              Shopify checkout, so you keep your payment setup, tax and shipping rules.
              Vergr takes no commission on those orders.</p>
            </div>`, { title: 'Settings' }));
          return;
        }

        // Read the catalog live rather than from our mirror: on a fresh install
        // nothing has synced yet, and an empty table would look like the app is
        // broken when the real state is "not connected to a Vergr account yet".
        const pull = await shopifyApi.pullProducts(shop, d.accessToken, { max: 50, pageSize: 50 });
        let body;
        if (!pull.ok) {
          body = `<h1>Products</h1>
            <div class="card"><p class="muted">Could not read your catalog (${esc(pull.error)}).
            If you recently changed app permissions, reinstall the app.</p></div>`;
        } else if (!pull.items.length) {
          body = `<h1>Products</h1>
            <div class="card"><div class="empty">This store has no active products yet.<br>
            <span class="muted">Add one in Shopify and it will appear here.</span></div></div>`;
        } else {
          const over = pull.items.length > plan.productCap;
          const rows = pull.items.map((p, i) => {
            const variants = p.variants.length;
            const stock = p.variants.some((v) => typeof v.stock === 'number')
              ? p.variants.reduce((s, v) => s + (typeof v.stock === 'number' ? Math.max(0, v.stock) : 0), 0)
              : null;
            const capped = i >= plan.productCap;
            return `<tr${capped ? ' style="opacity:.45"' : ''}>
              <td><img class="thumb" src="${esc(p.imageUrl)}" alt="" loading="lazy"></td>
              <td>${esc(p.title)}${variants > 1 ? `<br><span class="muted">${variants} options</span>` : ''}</td>
              <td>${esc(p.price)} ${esc(p.currency)}</td>
              <td>${stock === null ? '<span class="muted">Untracked</span>' : `${stock} in stock`}</td>
              <td>${capped ? '<span class="pill warn">Over plan limit</span>' : '<span class="pill ok">Ready</span>'}</td>
            </tr>`;
          }).join('');
          body = `<h1>Products</h1>
            <p class="sub">${pull.items.length} active product${pull.items.length === 1 ? '' : 's'} in ${esc(shop)}</p>
            ${over ? `<div class="card"><div class="row"><div><b>Only the first ${plan.productCap} will publish</b><br>
              <span class="muted">Your ${esc(plan.label)} plan covers ${plan.productCap.toLocaleString()} products.</span></div>
              <a class="btn" href="${shopifyBilling.pricingPlansUrl(shop)}" target="_top">Upgrade</a></div></div>` : ''}
            <div class="card" style="padding:8px 12px">
              <table><thead><tr><th></th><th>Product</th><th>Price</th><th>Stock</th><th>Status</th></tr></thead>
              <tbody>${rows}</tbody></table>
            </div>`;
        }
        res.status(200).send(page(shop, req.query.host, 'products', body, { title: 'Products' }));
        return;
      }

      // ---- install entry / embedded shell ----
      if (path === '/') {
        const shop = validShop(req.query.shop);
        if (!shop) { res.status(400).send('Missing or invalid shop parameter.'); return; }

        const snap = await shopRef(shop).get();
        const installed = snap.exists && snap.data().active === true && !!snap.data().accessToken;

        if (installed && String(req.query.embedded || '') === '1') {
          res.set('Content-Security-Policy',
            `frame-ancestors https://${shop} https://admin.shopify.com;`);
          // Cached read: the admin shell loads on every app open, and a
          // Partner API round trip per page view is wasteful. verifyPlan
          // refreshes it hourly and on return from the plan picker.
          const plan = await shopifyBilling.cachedPlan(shop);
          const d = snap.data();
          const linked = !!d.vergrUid;

          // A one-time code the merchant carries to vergr.app while signed in,
          // which is what ties this store to a Vergr account. Without it the
          // sync has no user to write products to, which is why the app could
          // look "installed" and still do nothing.
          let connectUrl = '';
          if (!linked) {
            const code = crypto.randomBytes(16).toString('hex');
            await db.collection('shopify_connect_codes').doc(code).set({
              shop, createdAt: FieldValue.serverTimestamp(),
            });
            connectUrl = `https://vergr.app/shop/link-shopify?code=${code}`;
          }

          const body = `
            <h1>Vergr Link In Bio</h1>
            <p class="sub">Connected to <code>${esc(shop)}</code></p>
            ${linked ? `
              <div class="card">
                <div class="row">
                  <div><b>Publishing to @${esc(d.vergrUsername || 'your Vergr page')}</b><br>
                  <span class="muted">Your products appear on your Vergr page and check out here in Shopify.</span></div>
                  <a class="btn sec" href="https://vergr.app/u/${esc(d.vergrUsername || '')}" target="_blank" rel="noopener">View page</a>
                </div>
              </div>` : `
              <div class="card">
                <h2>Connect your Vergr account</h2>
                <p class="muted">This links the store to your Vergr page so your products
                can appear on it. Opens vergr.app in a new tab, sign in there and confirm.</p>
                <p style="margin-top:14px"><a class="btn" href="${esc(connectUrl)}" target="_blank" rel="noopener">Connect Vergr account</a></p>
                <p class="muted" style="margin-top:12px">Already connected? Reload this page.</p>
              </div>`}
            ${planCardHtml(shop, plan)}
            <div class="card">
              <h2>Next</h2>
              <p class="muted">Check the <b>Products</b> tab to see what will publish from this store.</p>
            </div>`;
          res.status(200).send(page(shop, req.query.host, 'home', body));
          return;
        }

        // OAuth immediately on install, before anything else happens.
        const nonce = crypto.randomBytes(16).toString('hex');
        await db.collection('shopify_oauth_states').doc(nonce).set({
          shop, createdAt: FieldValue.serverTimestamp(),
        });
        const authUrl =
          `https://${shop}/admin/oauth/authorize` +
          `?client_id=${encodeURIComponent(CLIENT_ID.value().trim())}` +
          `&scope=${encodeURIComponent(SCOPES)}` +
          `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
          `&state=${nonce}`;

        // An embedded iframe cannot navigate the top window to Shopify's
        // consent screen, so break out of the frame first.
        if (String(req.query.embedded || '') === '1') {
          res.set('Content-Security-Policy',
            `frame-ancestors https://${shop} https://admin.shopify.com;`);
          res.status(200).send(
            `<!doctype html><html><head><meta charset="utf-8">
             <script>window.top.location.href=${JSON.stringify(authUrl)};</script>
             </head><body></body></html>`);
          return;
        }
        res.redirect(authUrl);
        return;
      }

      res.status(404).send('Not found');
    } catch (e) {
      console.error('shopifyApp error', path, e?.message, e?.stack);
      if (!res.headersSent) res.status(500).send('Server error');
    }
  }
);


// linkShopifyStore MOVED to functions/vlinkAccountLink.js when this app retired.
// Vergr Shop still needs it, so it had to survive; keeping a second copy here
// would have left two implementations of the store-claim flow to drift apart.
