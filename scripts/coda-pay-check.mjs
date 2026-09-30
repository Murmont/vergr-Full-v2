// Guard for the Codapay browser checkout (functions/codaPay.js + the relay's
// Coda routes in infra/mercury-relay/server.cjs + the coda_card fee rail).
//
//   node scripts/coda-pay-check.mjs
//
// No network, no Coda key: a fake Coda answers the relay. Every refusal is paired
// with a CONTROL that must succeed, so a check cannot pass by refusing everything.

import { createRequire } from 'node:module';
import http from 'node:http';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const coda = require('../functions/codaPay.js');
const { createRelay } = require('../infra/mercury-relay/server.cjs');

let total = 0;
const failures = [];
const check = (cond, label) => { total++; if (!cond) failures.push(label); };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

// ── Countries ──
check(coda.codaCountry('us') === 840 && coda.codaCountry('ZA') === 710, 'alpha-2 maps to Coda numeric, case-insensitive');
check(coda.codaCountry('GB') === 826, 'GB maps to 826');
check(coda.codaCountry('RU') === null, 'Russia is refused (sanctioned), even though Coda lists it');
for (const c of ['KP', 'IR', 'SY', 'CU', 'BY', 'VE']) check(coda.codaCountry(c) === null, `sanctioned ${c} is not offered`);
check(coda.codaCountry('') === null && coda.codaCountry(null) === null, 'no country = not offered');
check(coda.codaCountry('constructor') === null && coda.codaCountry('__proto__') === null, 'prototype keys are not countries');

// ── Order id ──
const oid = coda.codaOrderId('abc/DEF-123456789', 1700000000000, 'deadbeef');
check(oid === 'coda_abcDEF12_1700000000000_deadbeef', 'order id is coda_<uid8>_<ts>_<hex>');
check(oid.length >= 4 && oid.length <= 64, 'order id is 4-64 chars');
check(coda.codaOrderId('x') !== coda.codaOrderId('x'), 'two order ids for the same user differ');

// ── init body ──
const base = { apiKey: 'K', projectId: '123', countryNumeric: 840, orderId: oid, uid: 'u1', itemName: 'Vergr 500 Coins', priceUSD: 5.49, returnUrl: 'https://vergr.app/wallet/buy?paid=coda' };
const body = coda.buildInitBody(base);
const ir = body.initRequest;
check(ir.currency === 840 && ir.payType === 0, 'USD, channel selection page');
check(ir.items.length === 1, 'exactly ONE item (US and Canada accept one)');
check(ir.items[0].price === 5.49, 'price in USD with two decimals');
check(coda.buildInitBody({ ...base, priceUSD: 0.1 + 0.2 }).initRequest.items[0].price === 0.3, 'float noise is rounded to cents');
check(ir.projectId === 123, 'projectId is numeric');
check(ir.profile.entry.some((e) => e.key === 'return_url' && e.value === base.returnUrl), 'return URL sent as return_url in profile.entry');
check(ir.profile.entry.some((e) => e.key === 'user_id' && e.value === 'u1'), 'user id sent');
check(!coda.buildInitBody({ ...base, returnUrl: null }).initRequest.profile.entry.some((e) => e.key === 'return_url'), 'no return_url when none given');
check(throws(() => coda.buildInitBody({ ...base, apiKey: '' })), 'refuses without an API key');
check(throws(() => coda.buildInitBody({ ...base, priceUSD: 0 })) && throws(() => coda.buildInitBody({ ...base, priceUSD: -1 })), 'refuses a zero or negative price');
check(throws(() => coda.buildInitBody({ ...base, countryNumeric: 'US' })), 'refuses a non-numeric country');
check(throws(() => coda.buildInitBody({ ...base, orderId: 'x'.repeat(65) })), 'refuses an order id over 64 chars');

// ── init response ──
const bigTxn = '7152307384293654321'; // > 2^53
const okText = `{"initResult":{"resultCode":0,"txnId":${bigTxn},"redirectUrl":"https://sandbox.codapayments.com/pay?t=1"}}`;
const p = coda.parseInitResponse(okText);
check(p.ok && p.txnId === bigTxn, 'txnId kept exact as a string past 2^53');
check(String(JSON.parse(okText).initResult.txnId) !== bigTxn, 'CONTROL: JSON.parse really would corrupt that txnId');
check(!coda.parseInitResponse('{"initResult":{"resultCode":101,"resultDesc":"bad"}}').ok, 'a non-zero resultCode is not ok');
check(!coda.parseInitResponse(`{"initResult":{"resultCode":0,"txnId":1,"redirectUrl":"http://evil"}}`).ok, 'a non-https redirect is not ok');
check(!coda.parseInitResponse('<html>').ok, 'garbage is not ok');

// ── inquiry ──
const inq = coda.buildInquiryBody({ apiKey: 'K', projectId: '123', countryNumeric: 840, txnId: bigTxn });
check(inq.includes(`"txnId":${bigTxn}`), 'inquiry sends the txnId digits unchanged');
check(JSON.parse(inq).inquiryPaymentRequest.country === 840, 'inquiry body is valid JSON');
check(coda.buildInquiryBody({ apiKey: 'K', projectId: '1', countryNumeric: 1, txnId: '1,"x":2' }).includes('"txnId":0'), 'a non-digit txnId cannot inject JSON');
check(coda.inquiryState('{"paymentResult":{"resultCode":0}}').state === 'paid', 'resultCode 0 = paid');
check(coda.inquiryState('{"paymentResult":{"resultCode":431}}').state === 'pending', '431 = pending');
check(coda.inquiryState('{"paymentResult":{"resultCode":216}}').state === 'pending', '216 = pending');
check(coda.inquiryState('{"paymentResult":{"resultCode":320}}').state === 'failed', 'other codes = failed');
check(coda.inquiryState('nope').state === 'unknown' && coda.inquiryState('{}').state === 'unknown', 'unreadable = unknown, never paid');

// ── notification checksum ──
const KEY = 'coda-secret-key';
const sum = (t, o, r, k = KEY) => crypto.createHash('md5').update(`${t}${k}${o}${r}`).digest('hex');
const note = { TxnId: bigTxn, OrderId: oid, ResultCode: '0', Checksum: sum(bigTxn, oid, '0') };
check(coda.notificationValid(note, KEY), 'CONTROL: a genuine notification is valid');
check(coda.notificationValid({ ...note, Checksum: note.Checksum.toUpperCase() }, KEY), 'checksum case does not matter');
check(!coda.notificationValid({ ...note, ResultCode: '1' }, KEY), 'a changed ResultCode fails');
check(!coda.notificationValid({ ...note, OrderId: 'coda_other' }, KEY), 'a changed OrderId fails');
check(!coda.notificationValid({ ...note, Checksum: sum(bigTxn, oid, '0', 'wrong-key') }, KEY), 'a checksum made with another key fails');
check(!coda.notificationValid({ ...note, Checksum: 'abc' }, KEY), 'a short checksum fails');
check(!coda.notificationValid(note, ''), 'no key configured = never valid');

// ── item names ──
check(coda.itemNameFor({ kind: 'subscription', tier: 'pro' }) === 'Vergr Pro (1 month)', 'subscription names the one month');
check(coda.itemNameFor({ kind: 'coins', coins: 1500 }) === 'Vergr 1,500 Coins', 'coins name');
check(coda.itemNameFor({ kind: 'coins', coins: 0, items: [{}, {}] }) === 'Vergr 2 extras', 'store items name');

// ── fee rail ──
// checkoutFees.js initialises Firestore on load, so it is checked by source here;
// the emulator run exercises the real quote.
const feeSrc = require('node:fs').readFileSync(new URL('../functions/checkoutFees.js', import.meta.url), 'utf8');
check(/rail === 'coda_card'/.test(feeSrc), 'checkoutFees has a coda_card rail');
const codaBlock = feeSrc.slice(feeSrc.indexOf("rail === 'coda_card'"), feeSrc.indexOf("rail === 'payram_crypto'"));
check(/total: subtotal/.test(codaBlock) && !/grossUp/.test(codaBlock), 'Coda adds nothing to the buyer (agreement clause 4.1)');
// The Coda checkout lives in checkout.js on orders.js, never in PayRam's file
// (founder, 2026-09-26: PayRam is removed once Coda is live).
const rd = (f) => require('node:fs').readFileSync(new URL('../functions/' + f, import.meta.url), 'utf8');
const ckSrc = rd('checkout.js');
const payramOnly = rd('payram.js');
const codashopSrc = rd('codashop.js');
const codeOnly = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check(!/coda|codashop|checkout_orders/i.test(codeOnly(payramOnly)), 'payram.js holds no Coda or Codashop code');
check(!/payram/i.test(codeOnly(ckSrc)) && !/payram/i.test(codeOnly(codashopSrc)), 'checkout.js and codashop.js never touch PayRam');
check(/require\('\.\/orders'\)/.test(ckSrc) && /require\('\.\/orders'\)/.test(codashopSrc), 'Coda and Codashop settle through the shared orders.js');
check(/const COLLECTION = 'checkout_orders'/.test(ckSrc) && /const COLLECTION = 'checkout_orders'/.test(codashopSrc), 'Coda and Codashop orders live in checkout_orders');
check(/\['pollCheckoutOrders', checkout\.pollCheckoutOrders\]/.test(rd('index.js')), 'the checkout poller rides cron5Min (no new scheduler job)');
const payramSrc = ckSrc;
check(/knownEnv !== 'production' && !staff/.test(payramSrc), 'sandbox Coda is staff only (a fake payment must not credit real coins)');
check(/liveEnv === 'sandbox' && !gate\.staff/.test(payramSrc), 'refused again if the relay reports sandbox after the config said production');
check(/const country = String\(user\.geoCountry \|\| ''\)/.test(payramSrc) && /codaPay\.codaCountry\(country\)/.test(payramSrc), 'Coda country is the DETECTED country (geoCountry), never the client or the typed profile field');
const geoSrc = require('node:fs').readFileSync(new URL('../functions/geo.js', import.meta.url), 'utf8');
const stampSrc = geoSrc.slice(geoSrc.indexOf('async function stampAccountCountry'));
check(/geoHeadersTrusted\(h\)/.test(stampSrc) && /verifyIdToken/.test(stampSrc), 'country is saved only from the trusted worker headers, for a verified account');
check(/collection\('user_geo'\)/.test(stampSrc) && !/users'\)\.doc\(tok\.uid\)\.update\(\{[^}]*\bip\b/.test(stampSrc), 'the IP goes to the private user_geo collection, never the public users doc');
check(/sign_in_provider === 'anonymous' \|\| tok\.operator === true/.test(stampSrc), 'guests and the operator are never stamped');
const rulesSrc = require('node:fs').readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
check(/lockedUserFields\(\) \{[\s\S]{0,900}'geoCountry'/.test(rulesSrc) && !/match \/user_geo\//.test(rulesSrc), 'geoCountry is server-only and user_geo has no client rule');
check(/gate\.methods\.find\(\(m\) => m\.payType === payType\)/.test(payramSrc), 'the payment method must be one the server offers for that country');
check(/codaPricing\.localPrice\(\{ usd: subtotalUSD/.test(payramSrc), 'the order is priced by the server per method, never by the client');
const optSrc = payramSrc.slice(payramSrc.indexOf('async function codaCheckoutOptions'));
const createSrc = ckSrc.slice(ckSrc.indexOf('exports.createCheckout'), ckSrc.indexOf('exports.getCheckoutStatus'));
const buyerSrc = ckSrc.slice(ckSrc.indexOf('function requireBuyer'), ckSrc.indexOf('function requireBuyer') + 400);
check(/sign_in_provider === 'anonymous'/.test(buyerSrc) && createSrc.indexOf('requireBuyer(request)') >= 0 && createSrc.indexOf('requireBuyer(request)') < createSrc.indexOf('options === true) return codaCheckoutOptions'), 'method list rides createCheckout, after its guest check');
check(!/exports\.getCodaCheckoutOptions/.test(ckSrc), 'no separate options callable (a new function is a new image to pay for)');
check(/resolvePaymentOrder\(uid, data/.test(optSrc), 'method list prices the SAME basket resolver as the payment');

// ── Codashop signature: Coda's own published vectors (docs.coda.co .../authorization) ──
{
  const cs = require('../functions/codashop.js');
  const v = { id: '4123456789012345678', jsonrpc: '2.0', method: 'topup', params: [{ serviceProvider: 'Coda', txnId: '4123456789012345678', orderId: '4876543210987654321', user: { userId: '1002356', zoneId: '101' }, price: { currency: 'IDR', amount: '200000.0' }, sku: 'diamonds_1', quantity: 1, paymentChannelId: 0, isForTest: 0 }] };
  check(cs.sign('1234567890ABCDE', v) === '78c0e1335a95b9b0bd2b8c24f34f15c2b5d51b860487aa1a5d0e84ad4bf3c09b', "Codashop signature matches Coda's published vector (no roleId)");
  v.params[0].user.roleId = '111';
  check(cs.sign('1234567890ABCDE', v) === '9a648682c00726535f3c0c7db15cdb795bf6138378ff3478625eca260dcfe3dd', "Codashop signature matches Coda's published vector (with roleId)");
  v.params[0].signature = cs.sign('1234567890ABCDE', v);
  check(cs.signatureValid('1234567890ABCDE', v) && !cs.signatureValid('wrong-secret', v), 'a signature verifies only with the right secret');
}

// ── embedded component body ──
const methods = require('../functions/codaMethods.js');
const pricing = require('../functions/codaPricing.js');
const cbase = { apiKey: 'K', projectId: '123', countryNumeric: 710, payType: 432, currencyNumeric: 710, orderId: oid, uid: 'u1', itemName: 'Vergr 500 Coins', price: 99.99 };
const cir = coda.buildComponentInitBody(cbase).initRequest;
check(cir.payType === 432 && cir.currency === 710 && cir.country === 710, 'component init carries the method and LOCAL currency');
check(cir.items.length === 1 && cir.items[0].price === 99.99, 'component init sends one item at the local price');
check(throws(() => coda.buildComponentInitBody({ ...cbase, payType: 0 })), 'component init refuses without a payment method');
check(throws(() => coda.buildComponentInitBody({ ...cbase, currencyNumeric: 'ZAR' })), 'component init refuses a non-numeric currency');
check(throws(() => coda.buildComponentInitBody({ ...cbase, price: 0 })), 'component init refuses a zero price');
const cok = `{"initResult":{"resultCode":0,"txnId":${bigTxn},"clientSecret":"a.b.c"}}`;
const cp = coda.parseComponentInitResponse(cok);
check(cp.ok && cp.txnId === bigTxn && cp.clientSecret === 'a.b.c', 'component response: exact txnId + clientSecret');
check(!coda.parseComponentInitResponse(`{"initResult":{"resultCode":0,"txnId":${bigTxn}}}`).ok, 'no clientSecret = not ok');
check(!coda.parseComponentInitResponse('{"initResult":{"resultCode":203,"resultDesc":"cancelled"}}').ok, 'a refused method (203) is not ok');

// ── per-method local price: Vergr never receives less than the web price ──
const { COIN_PACKS } = await import('../src/utils/vpSystem.js');
const rates = {};
for (const cur of new Set(Object.values(methods.COUNTRY_CURRENCY))) rates[cur] = cur === 'USD' ? 1 : 0.5 + (cur.charCodeAt(0) % 7) * 37.3;
rates.EUR = 0.92;
const webPrices = [...COIN_PACKS.map((x) => x.priceUSD), 4.99, 9.99, 0.99, 12.34];
let priced = 0; let under = 0; let badFee = 0; let noNumeric = 0;
for (const m of methods.METHODS) {
  if (!(m.fee >= 0 && m.fee < 0.6)) badFee++;
  if (!methods.CURRENCY_NUMERIC[methods.COUNTRY_CURRENCY[m.country]]) noNumeric++;
  for (const usd of webPrices) {
    const lp = pricing.localPrice({ usd, method: m, rates });
    priced++;
    if (pricing.receivedUsd({ price: lp.price, method: m, rate: lp.rate }) < usd - 1e-9) under++;
  }
}
check(badFee === 0, `every method fee is a sane fraction (${badFee} bad)`);
check(noNumeric === 0, `every method currency has an ISO numeric code (${noNumeric} missing)`);
check(priced > 400 && under === 0, `every method x every price leaves Vergr at least the web price (${priced} checked, ${under} under)`);
check(pricing.receivedUsd({ price: 1.19 * 0.79, method: { country: 'GB', fee: 0.1, tax: 0.2, fixed: 0 }, rate: 0.79 }) < 1.19, 'CONTROL: receivedUsd really does detect an ungrossed price');
check(pricing.localPrice({ usd: 1, method: { country: 'JP', fee: 0.1, tax: 0.1, fixed: 0 }, rates: { JPY: 150 } }).price % 1 === 0, 'whole-unit currencies get whole prices');
check(throws(() => pricing.localPrice({ usd: 1, method: { country: 'GB', fee: 0.1, tax: 0, fixed: 0 }, rates: {} })), 'no FX rate = refuse, never guess');
check(['KP', 'IR', 'SY', 'CU', 'BY', 'VE', 'RU'].every((c) => methods.methodsFor(c).length === 0), 'no payment methods listed for sanctioned countries');

// ── per-method breakdown: what the basket shows adds up to what Coda charges ──
let badSum = 0; let noLogo = 0;
const logos = require('../functions/codaLogos.js');
const nodeFs = require('node:fs');
for (const m of methods.METHODS) {
  const f = logos.logoFor(m.country, m.payType);
  if (!f || !nodeFs.existsSync(new URL('../public' + f, import.meta.url))) noLogo++;
  for (const usd of webPrices) {
    const lp = pricing.localPrice({ usd, method: m, rates });
    const b = pricing.breakdown({ usd, price: lp.price, method: m, rate: lp.rate, currency: lp.currency });
    if (b.total !== lp.price || Math.abs(b.price + b.tax + b.fee - b.total) > 0.011) badSum++;
  }
}
check(noLogo === 0, `every payment method has an official logo file (${noLogo} missing)`);
check(badSum === 0, `Price + Tax + Payment fee = Total, for every method and price (${badSum} off)`);
const us = methods.methodFor('US', 1006);
check(pricing.localPrice({ usd: 0.99, method: us, rates }).price === 1.34 && pricing.localPrice({ usd: 9.99, method: us, rates }).price === 10.99,
  'US prices carry no currency buffer and round up finely ($0.99 -> $1.34, $9.99 -> $10.99)');
check(pricing.localPrice({ usd: 99.99, method: us, rates }).price === 104.99, 'no coarse rounding above 100 ($99.99 -> $104.99, not $109.99)');

// ── client: embedded in the basket, PayRam hidden, no glass ──
const readSrc = (f) => nodeFs.readFileSync(new URL(f, import.meta.url), 'utf8');
const pay = readSrc('../src/components/wallet/CodaPay.jsx');
check(/createCheckout\(\{ \.\.\.payload, payType: method\.payType, \.\.\.\(play \? \{ play \} : \{\}\) \}\)/.test(pay), 'the checkout sends the chosen method (and Google\'s token in the Play app), never a price');
check(!/payram/i.test(pay.replace(/^\s*\/\/.*$/gm, '')), 'the web checkout never calls PayRam');
check(/getCheckoutStatus\(res\.referenceId\)/.test(pay) && /status === 'settled'/.test(pay), 'the checkout reports what the SERVER settled, not what the iframe said');
check(/js\.codapayments\.com\/8\.8\.0\/coda-card\.min\.js/.test(pay), "card SDK pinned to a version that exists on Coda's CDN");
check(/ensureAccountCountry\(user, profile\)/.test(pay), 'the basket waits for the account country, and only asks when the profile has none');
check(!nodeFs.existsSync(new URL('../src/components/wallet/CodaCheckoutSheet.jsx', import.meta.url)), 'the popup sheet is gone');
for (const f of ['../src/components/wallet/CartContents.jsx', '../src/screens/wallet/v2/BuyScreen.jsx', '../src/screens/settings/Subscriptionscreen.jsx', '../src/screens/wallet/native/NativeWalletScreens.jsx']) {
  const src = readSrc(f);
  check(src.includes('<CodaCheckoutBlock') && !src.includes('CodaCheckoutSheet') && !/rail: 'coda'/.test(src), `${f.split('/').pop()}: Coda is embedded (one shared block)`);
}
check(/const SHOW_PAYRAM = false;/.test(readSrc('../src/screens/wallet/v2/BuyScreen.jsx'))
  && /const SHOW_PAYRAM_CARD = false;/.test(readSrc('../src/screens/settings/Subscriptionscreen.jsx'))
  && /const SHOW_PAYRAM_NATIVE = false;/.test(readSrc('../src/screens/wallet/native/NativeWalletScreens.jsx')), 'PayRam is hidden on every checkout (its server stays)');
{
  const cart = readSrc('../src/components/wallet/CartContents.jsx');
  check(/const codaMode = !IS_STORE_BUILD \|\| storeCoda \|\| !!chosenPlay;/.test(cart), 'the website/desktop basket is the Coda checkout; the Play app only once Google allows it');
  // ── Coda inside the Google Play app (billing choice / alternative / user choice) ──
  check(/storeCoda = IS_PLAY_BUILD && codaOffered && \(choice\.mode === 'developer' \|\| choice\.mode === 'alternative'\)/.test(cart), 'Play app: Coda form only where Google reports developer-drawn choice or alternative billing');
  check(/inPlay: true/.test(cart), 'Play app: methods are priced with Google\'s fee on top');
  check(/preparePlay=\{storeCoda && !chosenPlay \? prepareAltBilling : null\}/.test(cart) && /presetPlay=\{chosenPlay\}/.test(cart), 'Play app: every Coda order carries Google\'s transaction token');
  check(/alternative=\{playOption\}/.test(cart) && /choice\.playImage/.test(cart), 'Play app: Google Play is offered under the Coda form, with Google\'s artwork');
  check(/getBillingChoiceMode\(gate\.playUserChoice === true\)/.test(cart), 'Play app: user choice billing is asked for only once App Config allows it');
  const nb = readSrc('../src/utils/nativeBilling.js');
  check(/export async function buyWithChoice/.test(nb) && /typeof bridge\(\)\.buyChoice !== 'function'/.test(nb), 'buyWithChoice falls back to plain Play on an older bridge');
  check(/if \(!play && preparePlay\)/.test(pay) && /e\?\.code === 'cancelled'\) \{ onBack/.test(pay), 'the Coda panel fetches the token first; declining Google\'s dialog goes back, no order');
  const kt = readSrc('../src-tauri/gen/android/app/src/main/java/com/vergr/desktop/BillingBridge.kt');
  check(/fun buy\(reqId: String, productId: String, uid: String\) = launchCoin\(reqId, productId, uid, false\)/.test(kt), 'native: every other buy button keeps plain Play');
  check(/DeveloperBillingType\.IN_APP/.test(kt) && /showBillingProgramInformationDialog/.test(kt), 'native: billing choice token + Google\'s information dialog');
  check(/showAlternativeBillingOnlyInformationDialog/.test(kt) && /createAlternativeBillingOnlyReportingDetailsAsync/.test(kt), 'native: alternative billing dialog then token');
  check(/if \(!allowUserChoice\) \{ altMode = "none"/.test(kt), 'native: user choice billing only when the web asks for it');
}
check(/if \(pack\) buyPack\(pack\);/.test(readSrc('../src/screens/wallet/v2/BuyScreen.jsx')), 'the quick-buy link opens the basket, not PayRam');
for (const f of ['../src/components/wallet/CodaPay.jsx', '../src/components/wallet/CartDrawer.jsx', '../src/components/wallet/CartContents.jsx']) {
  const src = readSrc(f);
  const glass = (src.match(/background:\s*'rgba\([^']*'/g) || []).filter((b) => !b.includes('rgba(5,5,10,0.72)'));
  check(!/backdropFilter\s*:|backdrop-filter\s*:|blur\(\d/.test(src) && glass.length === 0, `${f.split('/').pop()}: no glass (see-through fills or blur) (${glass.join(' ')})`);
}
const tauri = readSrc('../src-tauri/tauri.conf.json');
check(tauri.includes('https://js.codapayments.com') && tauri.includes('https://hosted-component.codapayments.com'), 'desktop CSP allows both Coda SDKs');

// ── relay Coda routes ──
const AUD = 'https://sfu.vergr.app/payouts';
const SA = 'fn@vergr-44494.iam.gserviceaccount.com';
const google = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...google.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const hdr = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
const clm = b64({ iss: 'https://accounts.google.com', aud: AUD, email: SA, email_verified: true, iat: now, exp: now + 3600 });
const good = `${hdr}.${clm}.${crypto.sign('RSA-SHA256', Buffer.from(`${hdr}.${clm}`), google.privateKey).toString('base64url')}`;

const codaCalls = [];
async function fakeCoda(url, init) {
  codaCalls.push({ url, body: init?.body || '' });
  if (url.includes('Component/init.json')) return { status: 200, text: async () => cok };
  if (url.includes('init.json')) return { status: 200, text: async () => okText };
  if (url.includes('inquiryPaymentResult')) return { status: 200, text: async () => '{"paymentResult":{"resultCode":0}}' };
  return { status: 404, text: async () => '{}' };
}
const logs = [];
function start(over = {}) {
  const handler = createRelay({
    config: { tokenA: null, tokenB: null, payoutAccountId: null, audience: AUD, allowedServiceAccounts: [SA], codaApiKey: KEY, codaProjectId: '123', codaEnv: 'sandbox', ...over },
    mercuryFetch: fakeCoda,
    fetchJwks: async () => ({ keys: [jwk] }),
    log: (l) => logs.push(l),
  });
  return new Promise((resolve) => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(s)); });
}
async function call(srv, path, { method = 'POST', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`http://127.0.0.1:${srv.address().port}${path}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* text */ }
  return { status: r.status, json, text };
}

const srv = await start();
let r = await call(srv, '/payouts/healthz', { method: 'GET' });
check(r.json?.coda === true && r.json?.codaEnv === 'sandbox', 'healthz reports Coda configured, sandbox');
check(!r.text.includes(KEY), 'healthz never returns the Coda key');

const initReq = { countryNumeric: 840, orderId: oid, uid: 'u1', itemName: 'Vergr 500 Coins', priceUSD: 5.49, returnUrl: base.returnUrl };
r = await call(srv, '/payouts/v1/coda/init', { body: initReq });
check(r.status === 401 && codaCalls.length === 0, 'coda/init without a Google token is refused and Coda is not called');
r = await call(srv, '/payouts/v1/coda/init', { token: good, body: initReq });
check(r.status === 200 && r.json?.body?.ok === true && r.json?.body?.txnId === bigTxn, 'CONTROL: coda/init with a token starts a payment');
check(codaCalls.at(-1)?.url.startsWith('https://sandbox.codapayments.com/'), 'sandbox env calls the sandbox host');
check(JSON.parse(codaCalls.at(-1).body).initRequest.apiKey === KEY, 'the relay adds the key itself');
check(!JSON.stringify(r.json).includes(KEY), 'the key is never returned to the caller');
r = await call(srv, '/payouts/v1/coda/init', { token: good, body: { ...initReq, priceUSD: 0 } });
check(r.status === 400, 'a bad init request is a 400, not a Coda call');

const compReq = { countryNumeric: 710, payType: 432, currencyNumeric: 710, orderId: oid, uid: 'u1', itemName: 'Vergr 500 Coins', price: 99.99 };
r = await call(srv, '/payouts/v1/coda/component-init', { body: compReq });
check(r.status === 401, 'component-init without a Google token is refused');
r = await call(srv, '/payouts/v1/coda/component-init', { token: good, body: compReq });
check(r.status === 200 && r.json?.body?.ok === true && r.json?.body?.clientSecret === 'a.b.c' && r.json?.body?.env === 'sandbox', 'CONTROL: component-init returns the session and env');
check(codaCalls.at(-1).url === coda.CODA_URLS.sandbox.componentInit, 'component-init calls the component endpoint');
check(JSON.parse(codaCalls.at(-1).body).initRequest.apiKey === KEY && !JSON.stringify(r.json).includes(KEY), 'relay adds the key and never returns it');
r = await call(srv, '/payouts/v1/coda/component-init', { token: good, body: { ...compReq, payType: 0 } });
check(r.status === 400, 'component-init without a method is a 400');

r = await call(srv, '/payouts/v1/coda/inquiry', { token: good, body: { countryNumeric: 840, txnId: bigTxn } });
check(r.status === 200 && r.json?.body?.state === 'paid', 'coda/inquiry returns the state');
check(codaCalls.at(-1).body.includes(`"txnId":${bigTxn}`), 'inquiry forwards the exact txnId');

const qs = (o) => new URLSearchParams(o).toString();
r = await call(srv, `/payouts/coda/notify?${qs(note)}`, { method: 'GET' });
check(r.status === 200 && r.text === 'ResultCode=0', 'CONTROL: a genuine notification is acknowledged');
r = await call(srv, `/payouts/coda/notify?${qs({ ...note, ResultCode: '1' })}`, { method: 'GET' });
check(r.status === 400 && r.text === 'ResultCode=1', 'a tampered notification is refused');
check(!logs.join('\n').includes(KEY), 'logs never contain the Coda key');
srv.close();

const unset = await start({ codaApiKey: null });
r = await call(unset, '/payouts/v1/coda/init', { token: good, body: initReq });
check(r.status === 503, 'no Coda key on the box = 503, not a call');
r = await call(unset, `/payouts/coda/notify?${qs(note)}`, { method: 'GET' });
check(r.status === 400, 'no Coda key = no notification is ever valid');
unset.close();

const prod = await start({ codaEnv: 'production' });
await call(prod, '/payouts/v1/coda/init', { token: good, body: initReq });
check(codaCalls.at(-1)?.url.startsWith('https://airtime.codapayments.com/'), 'production env calls the production host');
prod.close();

// ── saved cards + in-app (Google Play) Coda sales, 2026-09-27 ──
{
  const ci = { apiKey: 'K', projectId: '1', countryNumeric: 840, payType: 1006, currencyNumeric: 840, orderId: 'coda_u1_1', uid: 'u1', itemName: 'x', price: 1.5 };
  const plain = coda.buildComponentInitBody(ci).initRequest;
  check(!plain.shopper && !plain.enableSavePaymentMethod, 'no saved-card fields unless asked for');
  const saved = coda.buildComponentInitBody({ ...ci, shopper: { email: 'a@b.c' } }).initRequest;
  check(saved.enableSavePaymentMethod === true && saved.displaySavedPaymentMethodList === true && saved.userInitiated === true, 'saved cards: Coda flags set');
  check(saved.shopper?.entry?.[0]?.key === 'partnerShopperId' && saved.shopper.entry[0].value === 'u1', 'saved cards: our uid is the partnerShopperId');
  const relaySrc = (await import('node:fs')).readFileSync(new URL('../infra/mercury-relay/server.cjs', import.meta.url), 'utf8');
  check(relaySrc.includes('shopper: b.shopper'), 'relay passes the shopper through to Coda');

  const ptx = require('../functions/playExternalTx.js');
  check(ptx.playFeeFor('US') === 0.10 && ptx.playFeeFor('DE') === 0.10 && ptx.playFeeFor('ZA') === 0.11 && ptx.playFeeFor('') === 0.11, "Google's fee: 10% US/UK/EEA/AU/JP, 11% elsewhere");
  check(ptx.parsePlay({ token: 'tok-12345678', program: 'alternative' }) && !ptx.parsePlay({ token: 'x', program: 'alternative' }) && !ptx.parsePlay({ token: 'tok-12345678', program: 'other' }), 'Play token + program validated');
  const rb = ptx.reportBody({ localPrice: 115, localCurrency: 'ZAR', codaTax: 0.15, codaCountryCode: 'za', playExternalToken: 'T' });
  const sum = (Number(rb.originalPreTaxAmount.priceMicros) + Number(rb.originalTaxAmount.priceMicros)) / 1e6;
  check(Math.abs(sum - 115) < 1e-6 && rb.originalPreTaxAmount.priceMicros === '100000000' && rb.userTaxAddress.regionCode === 'ZA', 'Google report: pre-tax + tax = price, region upper-cased');
  const ck = (await import('node:fs')).readFileSync(new URL('../functions/checkout.js', import.meta.url), 'utf8');
  check(ck.includes('withPlayFee(baseMethod, gate.country, play)') && ck.includes('withPlayFee(base, gate.country, inPlay)'), "Google's fee added on top for both the listed and the charged price");
  const od = (await import('node:fs')).readFileSync(new URL('../functions/orders.js', import.meta.url), 'utf8');
  check(od.includes('playReportPending: true') && (od.match(/grantFreeBoost\(\);/g) || []).length === 3, 'settlement flags the Google report and grants the free boost on every path');
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`coda-pay-check: ${failures.length} of ${total} failed`);
  process.exit(1);
}
console.log(`coda-pay-check: ${total} assertions green`);
