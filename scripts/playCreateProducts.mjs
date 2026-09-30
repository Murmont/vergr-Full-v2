#!/usr/bin/env node
// Create the VP bonus / boost products in Play Console, in bulk, via the Google
// Play Developer API. One run instead of a form and 40 price fields per product.
//
//   node scripts/playCreateProducts.mjs                 → dry run, prints what it would do
//   node scripts/playCreateProducts.mjs --list          → what already exists in Console
//   node scripts/playCreateProducts.mjs --apply         → create the missing ones
//   node scripts/playCreateProducts.mjs --apply --only vpb_day
//   node scripts/playCreateProducts.mjs --apply --force → also overwrite ones that exist
//
// ⚠ DRY RUN IS THE DEFAULT. --apply is the only thing that writes, and it SKIPS
// anything already in Console unless --force is passed, so a re-run cannot
// silently rewrite a product that was set up by hand.
//
// ── THE API, ESTABLISHED BY MEASUREMENT 2026-09-11 ─────────────────────
//
// ⚠⚠ `inappproducts` IS RETIRED FOR THIS APP. It answers:
//       403 "Please migrate to the new publishing API."
// Google's own reference page does NOT say deprecated, so this was only found by
// calling it. Do not go back to it.
//
// ⚠⚠ THE LIVE PATH IS `/applications/{pkg}/oneTimeProducts`, camelCase.
// The documented `/applications/{pkg}/monetization/onetimeproducts` returns 404,
// and lowercase `onetimeproducts` returns 404. All three were tried; only the
// camelCase one answers 200. Trust the probe, not the doc.
//
//   list   GET   /applications/{pkg}/oneTimeProducts
//   create PATCH /applications/{pkg}/oneTimeProducts/{productId}?allowMissing=true
//
// There is no POST create: patch with allowMissing is create-or-update.
//
// ── THE BODY IS COPIED FROM A LIVE PRODUCT, NOT FROM THE DOCS ──────────
//
// The shape below mirrors `coins_ascendant` as it actually exists in Console,
// read back over this same API. That matters for two fields nobody would guess:
//
//   buyOption.legacyCompatible = true
//       Without it the product is invisible to the classic billing flow, and
//       BillingBridge.kt queries with ProductType.INAPP. It would create fine
//       and then report "Product not loaded" on the phone.
//
//   taxAndComplianceSettings.withdrawalRightType = WITHDRAWAL_RIGHT_DIGITAL_CONTENT
//       The EU withdrawal-right classification every existing product carries.
//
// ⚠ PRICES ARE Money { currencyCode, units, nanos }, NOT priceMicros. `units` is
// the whole part as a STRING and `nanos` is billionths: 22.99 is units "22",
// nanos 990000000. The decimal is shifted in the string, never computed as a
// float, because 22.99 * 1e9 is not an integer in binary floating point.
//
// ── AUTH ───────────────────────────────────────────────────────────────
//
// GOOGLE_APPLICATION_CREDENTIALS → a JSON key for a service account invited into
// Play Console. ⚠ Account-level "Manage store presence" was NOT sufficient: every
// endpoint 403'd until the account was given Admin. If this starts failing again
// with PERMISSION_DENIED, that is the thing to look at, not the key.

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const PACKAGE_NAME = 'com.vergr.desktop';   // mirrors functions/playBilling.js:43
const PRODUCTS_CSV = 'docs/play/play-products.csv';
const MARKETS_CSV  = 'docs/play/play-prices-by-market.csv';
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PACKAGE_NAME)}`;

// ⚠⚠ READ AND WRITE USE DIFFERENT CASING, AND THIS IS GOOGLE'S OWN INCONSISTENCY.
// Straight from the v3 discovery document, which is the only place it is stated:
//
//   list  GET   .../oneTimeProducts          ← camelCase
//   get   GET   .../oneTimeProducts/{id}     ← camelCase
//   patch PATCH .../onetimeproducts/{id}     ← lowercase
//
// PATCH to the camelCase path returns a bare HTML 404 that looks exactly like a
// missing product, which is the wrong trail entirely. Verified by fetching
// https://androidpublisher.googleapis.com/$discovery/rest?version=v3 and reading
// the method table. Do not "tidy" these into one constant.
const BASE = `${API}/oneTimeProducts`;        // read
const BASE_WRITE = `${API}/onetimeproducts`;  // write

const args   = process.argv.slice(2);
const APPLY  = args.includes('--apply');
const LIST   = args.includes('--list');
const FORCE  = args.includes('--force');
const onlyIx = args.indexOf('--only');
const ONLY   = onlyIx >= 0 ? new Set((args[onlyIx + 1] || '').split(',').filter(Boolean)) : null;

// Currencies with no minor unit: 200 JPY is units "200", nanos 0.
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'HUF']);

function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  const t = text.replace(/\r\n/g, '\n');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

/** "22.99" → { units: "22", nanos: 990000000 }. String maths only, never a float. */
function toMoney(priceStr, currencyCode) {
  const s = String(priceStr).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`unparseable price "${priceStr}"`);
  const [whole, frac = ''] = s.split('.');
  if (ZERO_DECIMAL.has(currencyCode) && frac.replace(/0+$/, '')) {
    throw new Error(`${currencyCode} has no minor unit but price is "${priceStr}"`);
  }
  const nanos = Number((frac + '000000000').slice(0, 9));
  if (Number(whole) === 0 && nanos === 0) throw new Error(`price must be greater than zero`);
  return { currencyCode, units: String(Number(whole)), nanos };
}

const prod = parseCsv(readFileSync(PRODUCTS_CSV, 'utf8'));
const mkt  = parseCsv(readFileSync(MARKETS_CSV, 'utf8'));
const pHead = prod[0], mHead = mkt[0];
const col = (head, name) => {
  const i = head.indexOf(name);
  if (i < 0) throw new Error(`${name} column missing — did the generator change?`);
  return i;
};
const marketRows = mkt.slice(1).map((r) => ({ iso: r[1], currency: r[2], cells: r }));

const products = [];
for (const r of prod.slice(1)) {
  const productId = r[0];
  if (!/^(vpb_|boost_)/.test(productId)) continue;   // coin packs and subs already exist
  if (ONLY && !ONLY.has(productId)) continue;

  const mi = mHead.indexOf(productId);
  if (mi < 0) throw new Error(`${productId} has no column in ${MARKETS_CSV}`);

  const regionalPricingAndAvailabilityConfigs = marketRows
    .filter((m) => m.cells[mi])
    .map((m) => ({
      regionCode: m.iso,
      price: toMoney(m.cells[mi], m.currency),
      availability: 'AVAILABLE',
    }));

  products.push({
    packageName: PACKAGE_NAME,
    productId,
    listings: [{
      languageCode: 'en-US',
      title: r[col(pHead, 'name')],
      description: r[col(pHead, 'description')],
    }],
    taxAndComplianceSettings: {
      regionalProductAgeRatingInfos: [
        { regionCode: 'US', productAgeRatingTier: 'PRODUCT_AGE_RATING_TIER_EIGHTEEN_AND_ABOVE' },
      ],
    },
    purchaseOptions: [{
      purchaseOptionId: 'buy',
      state: 'ACTIVE',
      buyOption: { legacyCompatible: true },
      regionalPricingAndAvailabilityConfigs,
      taxAndComplianceSettings: { withdrawalRightType: 'WITHDRAWAL_RIGHT_DIGITAL_CONTENT' },
    }],
  });
}

const problems = [];
for (const p of products) {
  const l = p.listings[0];
  if (!l.title) problems.push(`${p.productId}: no title`);
  if (!l.description) problems.push(`${p.productId}: no description`);
  if (l.title.length > 55) problems.push(`${p.productId}: title ${l.title.length} chars, cap 55`);
  if (l.description.length > 200) problems.push(`${p.productId}: description ${l.description.length} chars, cap 200`);
  const n = p.purchaseOptions[0].regionalPricingAndAvailabilityConfigs.length;
  if (n !== marketRows.length) problems.push(`${p.productId}: ${n} prices, expected ${marketRows.length}`);
}
if (problems.length) {
  console.error('✗ Refusing to continue:');
  problems.forEach((x) => console.error('  ' + x));
  process.exit(1);
}

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let _token = null;
async function token() {
  if (_token) return _token;
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    console.error('✗ GOOGLE_APPLICATION_CREDENTIALS is not set.');
    console.error('  Point it at a JSON key for a service account invited into Play Console.');
    console.error('  ⚠ That file is a credential. Keep it out of the repo and delete it after.');
    process.exit(1);
  }
  let key;
  try { key = JSON.parse(readFileSync(keyPath, 'utf8')); }
  catch (e) { console.error(`✗ Could not read the key at ${keyPath}: ${e.message}`); process.exit(1); }

  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    exp: iat + 3600, iat,
  }))}`;
  const assertion = `${unsigned}.${b64url(createSign('RSA-SHA256').update(unsigned).sign(key.private_key))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    console.error(`✗ Token exchange failed: ${body.error_description || body.error || res.statusText}`);
    process.exit(1);
  }
  _token = body.access_token;
  return _token;
}

// ⚠ `regionsVersion.version` IS REQUIRED ON WRITE. Omitting it fails with
// "Regions Version must be specified." It is the vintage of Google's region and
// currency table, and it is read back off a product that already exists rather
// than hardcoded, so it tracks whatever Console is on and cannot go stale here.
let REGIONS_VERSION = null;

async function listProducts() {
  const res = await fetch(`${BASE}?pageSize=100`, { headers: { Authorization: `Bearer ${await token()}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) fail(res, body);
  const list = body.oneTimeProducts || [];
  REGIONS_VERSION = list.find((p) => p.regionsVersion?.version)?.regionsVersion.version || null;
  return list.map((p) => p.productId);
}
const existingIds = listProducts;

function fail(res, body) {
  console.error(`\n✗ HTTP ${res.status}: ${body?.error?.message || res.statusText}`);
  if (res.status === 401 || res.status === 403) {
    console.error('\n  Account-level "Manage store presence" was NOT enough here — every');
    console.error('  endpoint 403\'d until the service account was made Admin in Play');
    console.error('  Console → Users and permissions. Check that before anything else.\n');
  }
  process.exit(1);
}

if (LIST) {
  const found = (await existingIds()).sort();
  console.log(`\n${found.length} one-time products exist:\n`);
  for (const s of found) console.log('  ' + s);
  const missing = products.map((p) => p.productId).filter((s) => !found.includes(s));
  console.log(`\n${missing.length} of the ${products.length} in this table are missing:`);
  for (const s of missing) console.log('  ' + s);
  console.log('');
  process.exit(0);
}

const found = APPLY ? await existingIds() : [];
const todo = products.filter((p) => FORCE || !found.includes(p.productId));
const skipped = products.filter((p) => !FORCE && found.includes(p.productId));

if (!APPLY) {
  console.log(`\nDRY RUN — nothing is sent. ${products.length} products in the table.\n`);
  for (const p of products) {
    const l = p.listings[0];
    const cfg = p.purchaseOptions[0].regionalPricingAndAvailabilityConfigs;
    const us = cfg.find((c) => c.regionCode === 'US');
    console.log(`  ${p.productId}`);
    console.log(`    title       ${l.title}`);
    console.log(`    description ${l.description}`);
    console.log(`    US price    ${us.price.currencyCode} ${us.price.units}.${String(us.price.nanos).padStart(9, '0').slice(0, 2)}`);
    console.log(`    regions     ${cfg.length}`);
    console.log('');
  }
  console.log('Run --list to see what already exists, then --apply to create the rest.\n');
  process.exit(0);
}

if (skipped.length) {
  console.log(`\nSkipping ${skipped.length} that already exist (pass --force to overwrite):`);
  for (const p of skipped) console.log('  · ' + p.productId);
}
if (!todo.length) { console.log('\nNothing to create.\n'); process.exit(0); }

console.log(`\nCreating ${todo.length}:\n`);
const t = await token();
let made = 0;
for (const p of todo) {
  if (!REGIONS_VERSION) {
    console.error('✗ Could not read regionsVersion off any existing product, and it is');
    console.error('  required on write. Create one product by hand in Console first.');
    process.exit(1);
  }
  const url = `${BASE_WRITE}/${encodeURIComponent(p.productId)}` +
    `?allowMissing=true` +
    `&regionsVersion.version=${encodeURIComponent(REGIONS_VERSION)}` +
    `&updateMask=${encodeURIComponent('listings,taxAndComplianceSettings,purchaseOptions')}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(`\n✗ ${p.productId} failed after ${made} created.`); fail(res, body); }
  made++;
  const cfg = body.purchaseOptions?.[0]?.regionalPricingAndAvailabilityConfigs || [];
  console.log(`  ✓ ${p.productId.padEnd(20)} ${cfg.length} regions`);
}
// ── ACTIVATE ─────────────────────────────────────────────────────────
//
// ⚠⚠ A CREATED PRODUCT COMES BACK `state: DRAFT` AND CANNOT BE BOUGHT.
// `state: 'ACTIVE'` in the patch body is IGNORED — silently, with a 200 — so the
// only way to notice is to read the product back. Activation is its own call:
//
//   POST .../oneTimeProducts/{productId}/purchaseOptions:batchUpdateStates
//   { requests: [ { activatePurchaseOptionRequest: {packageName, productId, purchaseOptionId} } ] }
//
// Shape taken from the v3 discovery document, not from the doc pages.
console.log(`\n${made} created. Activating (they are created as DRAFT):\n`);
let live = 0;
for (const p of todo) {
  const res = await fetch(
    `${BASE}/${encodeURIComponent(p.productId)}/purchaseOptions:batchUpdateStates`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          activatePurchaseOptionRequest: {
            packageName: PACKAGE_NAME,
            productId: p.productId,
            purchaseOptionId: 'buy',
          },
        }],
      }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`  ✗ ${p.productId} created but NOT activated: ${body?.error?.message || res.statusText}`);
    continue;
  }
  live++;
  console.log(`  ✓ ${p.productId.padEnd(20)} active`);
}
console.log(`\n${made} created, ${live} activated. Run --list to confirm.\n`);
