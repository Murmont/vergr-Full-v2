// Emulator integration test for Vergr's checkout (Coda, per-method local prices)
// and Codashop fulfilment. Runs the REAL functions/checkout.js, codashop.js and
// orders.js against the Firestore emulator, with the box-1 relay faked, and
// proves PayRam (functions/payram.js) is a separate rail. NOT in
// npm run check, because it needs a running emulator.
//
//   start: java -jar "%USERPROFILE%/.cache/firebase/emulators/cloud-firestore-emulator-v1.19.8.jar" --host=127.0.0.1 --port=8089
//   then:  set FIRESTORE_EMULATOR_HOST=127.0.0.1:8089 && node scripts/coda-checkout-emulator.cjs
//   stop the emulator BY PID afterwards; never kill every java.exe.
const path = require('path');
const root = path.join(__dirname, '..');
const fn = (f) => path.join(root, 'functions', f);
process.env.GCLOUD_PROJECT = 'vergr-int-test';

const freq = require('module').createRequire(fn('index.js'));
const admin = freq('firebase-admin');
admin.initializeApp({ projectId: 'vergr-int-test' });

const relayCalls = [];
let relayScript = {};
require.cache[require.resolve(fn('mercuryRelayClient.js'))] = {
  id: 'fake', filename: fn('mercuryRelayClient.js'), loaded: true,
  exports: {
    relayCall: async (route, body) => {
      relayCalls.push({ route, body });
      const h = relayScript[route];
      if (!h) return { ok: false, httpStatus: 599, error: 'unscripted' };
      return typeof h === 'function' ? h(body) : h;
    },
  },
};

// Fixed FX so prices are deterministic; the live feed is exercised on box 1.
const codaPricing = require(fn('codaPricing.js'));
codaPricing.usdRates = async () => ({ ZAR: 18.2, EUR: 0.92, GBP: 0.79, PHP: 57 });
const playTx = require(fn('playExternalTx.js'));
const playReports = [];
playTx.reportOrder = async (o, id) => { playReports.push({ id, body: playTx.reportBody(o) }); return 'reported'; };
const checkout = require(fn('checkout.js'));
const orders = require(fn('orders.js'));
const codashop = require(fn('codashop.js'));
const payram = require(fn('payram.js'));
const { getFirestore } = freq('firebase-admin/firestore');
const db = getFirestore('vgrdb');

let total = 0; const fails = [];
const check = (c, l) => { total++; if (!c) fails.push(l); };
const call = (f, uid, data) => f.run({ auth: { uid, token: { firebase: { sign_in_provider: 'password' } } }, data });
const f_anon = (f, data) => f.run({ auth: { uid: 'anon-1', token: { firebase: { sign_in_provider: 'anonymous' } } }, data });
async function expectErr(p, re, label) {
  try { await p; check(false, `${label} (did not throw)`); } catch (e) { check(re.test(e.message), `${label} (got: ${e.message})`); }
}
const order = async (id) => (await db.collection('checkout_orders').doc(id).get()).data() || {};
const wallet = async (uid) => (await db.collection('wallets').doc(uid).get()).data() || {};

const TXN = '7152307384293654321';
const initOk = () => ({ ok: true, httpStatus: 200, body: { ok: true, txnId: TXN, clientSecret: 'h.p.s', env: 'sandbox' } });
const CARD = 432; // ZA card

(async () => {
  const cfg = db.doc('app_config/general');
  const U = 'u-coda-buyer';
  const S = 'u-coda-staff';
  await db.collection('users').doc(U).set({ geoCountry: 'ZA' });
  await db.collection('users').doc(S).set({ geoCountry: 'ZA', staff: true });
  await db.collection('wallets').doc(U).set({ balance: 0 });

  // ── gates ──
  await cfg.set({ codaCheckout: 'off' });
  relayScript = { 'coda/component-init': initOk };
  await expectErr(call(checkout.createCheckout, U, { packSku: 'starter', payType: CARD }), /not available yet/, 'off: refused');
  check(relayCalls.length === 0, 'off: Coda never called');

  await cfg.set({ codaCheckout: 'staff' });
  await expectErr(call(checkout.createCheckout, U, { packSku: 'starter', payType: CARD }), /not available yet/, 'staff mode: a normal user is refused');
  const staffRes = await call(checkout.createCheckout, S, { packSku: 'starter', payType: CARD });
  check(staffRes.ok && staffRes.clientSecret === 'h.p.s' && staffRes.sdk === 'card' && staffRes.currency === 'ZAR', 'CONTROL staff mode: staff gets an embedded card session in ZAR');

  // unset mode = on, but Coda in sandbox: a normal user is refused, staff is not
  await cfg.set({});
  relayCalls.length = 0;
  await expectErr(call(checkout.createCheckout, U, { packSku: 'starter', payType: CARD }), /not available yet/, 'sandbox: a normal user is refused');
  check(relayCalls.length === 0, 'sandbox + normal user: Coda never called');
  const stS = await call(checkout.createCheckout, S, { packSku: 'starter', payType: CARD });
  check(stS.ok, 'CONTROL sandbox: staff can pay');
  check((await cfg.get()).data().codaEnv !== 'production', 'sandbox stays sandbox (no write when nothing changed)');

  // production: everyone
  await cfg.set({ codaEnv: 'production' });
  relayScript = { 'coda/component-init': (b) => ({ ...initOk(b), body: { ...initOk(b).body, env: 'production' } }) };
  const pub = await call(checkout.createCheckout, U, { packSku: 'starter', payType: CARD });
  check(pub.ok, 'production: a normal user can pay');
  // relay flips back to sandbox: public refused, no order written
  relayScript = { 'coda/component-init': initOk };
  await expectErr(call(checkout.createCheckout, U, { packSku: 'starter', payType: CARD }), /not available yet/, 'relay back in sandbox: public refused');
  check((await cfg.get()).data().codaEnv === 'sandbox', 'config follows the relay back to sandbox');
  await cfg.set({ codaEnv: 'production' });
  relayScript = { 'coda/component-init': (b) => ({ ...initOk(b), body: { ...initOk(b).body, env: 'production' } }) };
  await db.collection('users').doc(U).set({ geoCountry: 'RU' }, { merge: true });
  await expectErr(call(checkout.createCheckout, U, { packSku: 'starter', payType: CARD }), /not available in your country/, 'sanctioned profile country refused');
  await db.collection('users').doc(U).set({ geoCountry: 'ZA' }, { merge: true });

  const saved = relayScript;
  relayScript = { 'coda/component-init': { ok: true, httpStatus: 200, body: { ok: false, resultCode: 101 } } };
  await expectErr(call(checkout.createCheckout, U, { packSku: 'starter', payType: CARD }), /not available right now/, 'a refused method surfaces so the buyer picks another');
  relayScript = saved;
  await expectErr(call(checkout.createCheckout, U, { packSku: 'starter', payType: 252 }), /Choose a payment method/, 'a method not offered in the buyer country (GCash in ZA) is refused');
  await expectErr(call(checkout.createCheckout, U, { packSku: 'starter' }), /Choose a payment method/, 'no method = refused');

  await db.collection('users').doc(U).update({ geoCountry: null, country: 'ZA' });
  await expectErr(call(checkout.createCheckout, U, { packSku: 'starter', payType: CARD }), /could not confirm your country/, 'no detected country = refused, even with a typed profile country');
  await db.collection('users').doc(U).update({ geoCountry: 'ZA' });

  // ── method list ──
  const opts = await call(checkout.createCheckout, U, { options: true, cart: [{ sku: 'starter', qty: 2 }, { sku: 'boost_post', qty: 1 }] });
  check(opts.country === 'ZA' && opts.currency === 'ZAR' && opts.methods.some((m) => m.payType === CARD), 'method list for ZA, priced in ZAR');
  check(opts.methods.every((m) => m.price > 0 && m.currency === 'ZAR'), 'every listed method has a local price');
  await expectErr(f_anon(checkout.createCheckout, { options: true, packSku: 'starter' }), /Anonymous/, 'guests get no method list');

  // ── a coin + item basket ──
  relayScript = saved;
  relayCalls.length = 0;
  const cart = [{ sku: 'starter', qty: 2 }, { sku: 'boost_post', qty: 1 }];
  const res = await call(checkout.createCheckout, U, { cart, payType: CARD, amountUSD: 0.01 });
  check(res.ok && res.referenceId.startsWith('coda_'), 'basket order started');
  const sent = relayCalls[0]?.body || {};
  check(sent.countryNumeric === 710, 'country from the profile (ZA = 710)');
  check(sent.payType === CARD && sent.currencyNumeric === 710, 'the chosen method and ZAR are sent');
  const listed = opts.methods.find((m) => m.payType === CARD);
  let o = await order(res.referenceId);
  check(o.rail === 'coda' && o.codaTxnId === TXN && typeof o.codaTxnId === 'string', 'txnId stored exactly, as a string');
  check(o.subtotalUSD > 0.01, 'server re-prices (client amount ignored)');
  check(o.localCurrency === 'ZAR' && o.localPrice === sent.price, 'the local price sent to Coda is the one stored');
  check(listed && listed.price === o.localPrice, 'the price shown in the list is the price charged');
  check(o.codaPayType === CARD && o.codaMethod === 'Card' && o.codaMethodFee > 0, 'method and its fee recorded on the order');
  const got = codaPricing.receivedUsd({ price: o.localPrice, method: { fee: o.codaMethodFee, tax: o.codaTax, fixed: o.codaMethodFixed }, rate: o.usdLocalRate });
  check(got >= o.subtotalUSD, `after Coda's fee and tax Vergr still receives the web price (${got.toFixed(2)} >= ${o.subtotalUSD})`);
  check(Array.isArray(o.items) && o.items[0]?.sku === 'boost_post', 'store items stored on the order');
  check(o.status === 'awaiting_settlement', 'order awaiting settlement');
  check(opts.freeBoost === 'post', 'options advertise the free Post Boost');
  check(o.freeBoost && o.freeBoost.id === 'post' && o.freeBoost.qty === 1, 'free boost stamped on the order');
  check(res.freeBoost === 'post', 'order reply names the free boost');
  check(!sent.shopper, 'saved cards off by default: no shopper sent to Coda');

  // status: pending, then paid
  relayScript['coda/inquiry'] = { ok: true, httpStatus: 200, body: { state: 'pending' } };
  let st = await call(checkout.getCheckoutStatus, U, { referenceId: res.referenceId });
  check(st.status === 'awaiting', 'pending stays awaiting');
  check((await wallet(U)).balance === 0, 'nothing credited while pending');
  await expectErr(call(checkout.getCheckoutStatus, 'someone-else', { referenceId: res.referenceId }), /Not your order/, 'another user cannot read the order');

  relayScript['coda/inquiry'] = { ok: true, httpStatus: 200, body: { state: 'paid' } };
  st = await call(checkout.getCheckoutStatus, U, { referenceId: res.referenceId });
  check(st.status === 'settled', 'paid settles');
  let w = await wallet(U);
  check(w.balance === o.coinsToCredit && o.coinsToCredit > 0, `coins credited (${w.balance} of ${o.coinsToCredit})`);
  check(JSON.stringify(w.boosts || {}).includes('post'), 'the boost was credited too');
  check((w.boosts || {}).post === 2, `bought Post Boost + free Post Boost = 2 (got ${(w.boosts || {}).post})`);
  const fbTx = await db.collection('transactions').where('orderReferenceId', '==', res.referenceId).where('type', '==', 'free_boost').get();
  check(fbTx.size === 1 && /Coda/.test(fbTx.docs[0].data().description), 'one free_boost ledger row');
  o = await order(res.referenceId);
  check(o.status === 'settled', 'order marked settled');
  const tx = await db.collection('transactions').where('orderReferenceId', '==', res.referenceId).get();
  check(tx.size >= 1 && tx.docs.every(d => d.data().gateway === 'coda') && tx.docs.some(d => d.data().type === 'coin_purchase') && tx.docs.every(d => /(Coda)/.test(d.data().description)), 'one ledger row, recorded as Coda');

  st = await call(checkout.getCheckoutStatus, U, { referenceId: res.referenceId });
  const r2 = await orders.settleOrder('checkout_orders', res.referenceId, { source: 'coda-poll' });
  check(!r2.credited && (await wallet(U)).balance === w.balance, 'settling twice credits once');
  check(((await wallet(U)).boosts || {}).post === 2, 'settling twice grants the free boost once');

  // ── free boost switch + saved cards ──
  await cfg.set({ codaFreeBoostId: 'none' }, { merge: true });
  const noFb = await call(checkout.createCheckout, U, { packSku: 'starter', payType: CARD });
  check(!(await order(noFb.referenceId)).freeBoost && noFb.freeBoost === null, 'codaFreeBoostId none: no free boost');
  await cfg.set({ codaFreeBoostId: 'post', codaSaveCards: true }, { merge: true });
  relayCalls.length = 0;
  const sc = await call(checkout.createCheckout, U, { packSku: 'starter', payType: CARD });
  check(sc.ok && relayCalls.length === 1 && relayCalls[0].body.shopper, 'saved cards on: shopper sent for a card');
  // Coda refusing the saved-card request must not fail the sale.
  relayCalls.length = 0;
  const initNow = relayScript['coda/component-init'];
  relayScript['coda/component-init'] = (b) => (b.shopper ? { ok: true, httpStatus: 200, body: { ok: false, resultCode: 211 } } : (typeof initNow === 'function' ? initNow(b) : initNow));
  const sc2 = await call(checkout.createCheckout, U, { packSku: 'starter', payType: CARD });
  check(sc2.ok && relayCalls.length === 2 && relayCalls[0].body.shopper && !relayCalls[1].body.shopper, 'refused saved-card init retries without it');
  relayScript['coda/component-init'] = initNow;
  await cfg.set({ codaSaveCards: false }, { merge: true });

  // ── inside the Google Play app: Google's fee on top, token stored, sale reported ──
  const webOpts = await call(checkout.createCheckout, U, { options: true, packSku: 'pro' });
  const playOpts = await call(checkout.createCheckout, U, { options: true, packSku: 'pro', inPlay: true });
  const wCard = webOpts.methods.find((m) => m.payType === CARD);
  const pCard = playOpts.methods.find((m) => m.payType === CARD);
  check(pCard.price > wCard.price, `in-app price adds Google's fee (${pCard.price} > ${wCard.price})`);
  await expectErr(call(checkout.createCheckout, U, { packSku: 'pro', payType: CARD, play: { program: 'alternative' } }), /Google Play transaction/, 'in-app order without a token is refused');
  const ppr = await call(checkout.createCheckout, U, { packSku: 'pro', payType: CARD, play: { token: 'ext-token-123456', program: 'alternative' } });
  let po = await order(ppr.referenceId);
  check(po.playExternalToken === 'ext-token-123456' && po.playProgram === 'alternative' && po.playFee === 0.11 && po.codaCountryCode === 'ZA', 'token, program, fee and country stored (ZA = 11%)');
  check(ppr.price === pCard.price, 'the in-app price listed is the price charged');
  const gotPlay = codaPricing.receivedUsd({ price: po.localPrice, method: { fee: po.codaMethodFee, tax: po.codaTax, fixed: po.codaMethodFixed }, rate: po.usdLocalRate });
  check(gotPlay >= po.subtotalUSD, `after Coda's AND Google's fees Vergr still nets the web price (${gotPlay.toFixed(2)} >= ${po.subtotalUSD})`);
  relayScript['coda/inquiry'] = { ok: true, httpStatus: 200, body: { state: 'paid' } };
  playReports.length = 0;
  const pst = await call(checkout.getCheckoutStatus, U, { referenceId: ppr.referenceId });
  po = await order(ppr.referenceId);
  check(pst.status === 'settled' && playReports.length === 1 && playReports[0].id === ppr.referenceId, 'settling reports the sale to Google once');
  const rb = playReports[0]?.body || {};
  check(rb.oneTimeTransaction?.externalTransactionToken === 'ext-token-123456' && rb.userTaxAddress?.regionCode === 'ZA' && rb.originalPreTaxAmount?.currency === 'ZAR', 'report carries token, ZA and ZAR');
  const sum = (Number(rb.originalPreTaxAmount?.priceMicros) + Number(rb.originalTaxAmount?.priceMicros)) / 1e6;
  check(Math.abs(sum - po.localPrice) < 0.01, 'pre-tax + tax = the price charged');
  check(po.playReportPending === false && po.playReportedAt, 'row marked reported');
  await checkout.pollCheckoutOrders();
  check(playReports.length === 1, 'the poller does not report it again');
  // a failed report is retried by the poller
  playTx.reportOrder = async () => 'failed:500:boom';
  const pr2 = await call(checkout.createCheckout, U, { packSku: 'pro', payType: CARD, play: { token: 'ext-token-999999', program: 'user_choice' } });
  await call(checkout.getCheckoutStatus, U, { referenceId: pr2.referenceId });
  check((await order(pr2.referenceId)).playReportPending === true, 'failed report stays pending');
  playTx.reportOrder = async (o, id) => { playReports.push({ id, body: playTx.reportBody(o) }); return 'reported'; };
  await checkout.pollCheckoutOrders();
  check((await order(pr2.referenceId)).playReportPending === false && playReports.some((r) => r.id === pr2.referenceId), 'poller retries and reports it');
  const webOrder = await call(checkout.createCheckout, U, { packSku: 'pro', payType: CARD });
  check(!(await order(webOrder.referenceId)).playExternalToken, 'a web order carries no Play token');
  w = await wallet(U); // the in-app orders above credited coins; later checks compare against this

  // ── a failed payment expires and credits nothing ──
  const res2 = await call(checkout.createCheckout, U, { packSku: 'starter', payType: CARD });
  relayScript['coda/inquiry'] = { ok: true, httpStatus: 200, body: { state: 'failed' } };
  st = await call(checkout.getCheckoutStatus, U, { referenceId: res2.referenceId });
  check(st.status === 'expired' && (await wallet(U)).balance === w.balance, 'failed payment expires, nothing credited');

  // relay down: the status call must not expire or credit
  const res3 = await call(checkout.createCheckout, U, { packSku: 'starter', payType: CARD });
  relayScript['coda/inquiry'] = { ok: false, httpStatus: 503, error: 'down' };
  st = await call(checkout.getCheckoutStatus, U, { referenceId: res3.referenceId });
  check(st.status === 'awaiting' && (await order(res3.referenceId)).status === 'awaiting_settlement', 'relay down: order kept, not expired');

  // ── one-off month subscription ──
  await db.collection('users').doc(U).set({ subscription: 'free' }, { merge: true });
  const sub = await call(checkout.createCheckout, U, { subscriptionTier: 'pro', payType: CARD });
  check(/Pro \(1 month\)/.test(relayCalls.at(-1)?.body?.itemName || ''), 'subscription named as one month');
  relayScript['coda/inquiry'] = { ok: true, httpStatus: 200, body: { state: 'paid' } };
  st = await call(checkout.getCheckoutStatus, U, { referenceId: sub.referenceId });
  const u = (await db.collection('users').doc(U).get()).data();
  check(st.status === 'settled' && u.subscription === 'pro', 'Pro activated');
  check(u.subscriptionAutoRenew === false, 'one-off month: auto-renew OFF');
  const days = (u.subscriptionPeriodEnd - u.subscriptionPeriodStart) / 86400000;
  check(days >= 29 && days <= 31, `one month granted (${days.toFixed(1)} days)`);

  // ── the poller (cron5Min job) ──
  const res4 = await call(checkout.createCheckout, U, { packSku: 'starter', payType: CARD });
  await db.collection('checkout_orders').doc(res4.referenceId).update({ createdAt: new Date(Date.now() - 10 * 60 * 1000) });
  relayScript['coda/inquiry'] = { ok: true, httpStatus: 200, body: { state: 'paid' } };
  const before4 = (await wallet(U)).balance;
  await checkout.pollCheckoutOrders();
  check((await order(res4.referenceId)).status === 'settled' && (await wallet(U)).balance > before4, 'poller settles a paid order nobody polled');

  // ── Codashop (codashop.com orders) ──
  const SECRET = 'test-secret-codashop';
  await db.collection('private_config').doc('codashop').set({ secretKey: SECRET });
  await db.collection('users').doc(U).set({ usernameLower: 'buyer1', displayName: 'Buyer One', geoCountry: 'ZA' }, { merge: true });
  const rpc = (method, params, sign = true) => {
    const r = { id: 'r-' + Math.random().toString(36).slice(2), jsonrpc: '2.0', method, params: [{ ...params }] };
    if (sign) r.params[0].signature = codashop.sign(SECRET, r);
    return r;
  };
  const hit = async (path, body) => {
    let out = null; let code = 0;
    const res = { status(c) { code = c; return this; }, json(b) { out = b; return this; }, send(b) { out = b; return this; } };
    await codashop._route({ path, method: 'POST', body, headers: {} }, res);
    return { code, out };
  };
  const base = { serviceProvider: 'coda', txnId: 'T1', user: { userId: '@buyer1', zoneId: '' }, price: { currency: 'ZAR', amount: '30' }, sku: 'coins_starter', quantity: 1, paymentChannelId: 1, isForTest: 0, purchaseOrigin: 'ZA' };
  let r = await hit('/validate', rpc('validate', { ...base, orderId: 'CS1' }));
  check(r.code === 200 && r.out.result && r.out.result.username === 'Buyer One' && r.out.result.accountRegionCode === 'ZA', 'codashop validate finds the account by @username');
  r = await hit('/validate', rpc('validate', { ...base, orderId: 'CS1', user: { userId: 'nobody-here' } }));
  check(r.out.error && r.out.error.code === -100, 'codashop: unknown user is -100');
  r = await hit('/validate', rpc('validate', { ...base, orderId: 'CS1', sku: 'coins_nope' }));
  check(r.out.error && r.out.error.code === -101, 'codashop: unknown SKU is -101');
  const bad = rpc('validate', { ...base, orderId: 'CS1' }); bad.params[0].sku = 'coins_ascendant';
  r = await hit('/validate', bad);
  check(r.out.error && r.out.error.code === -103, 'codashop: a tampered signed field is refused');
  r = await hit('/validate', rpc('validate', { ...base, orderId: 'CST', isForTest: 1 }));
  check(r.out.result && r.out.result.username === 'Buyer One', 'codashop: a test order validates for any real account (Coda review passes)');
  const beforeT = (await wallet(U)).balance;
  r = await hit('/topup', rpc('topup', { ...base, orderId: 'CST', isForTest: 1 }));
  check(r.out.result === 0, 'codashop: a test top-up on a real account answers success');
  r = await hit('/topup', rpc('topup', { ...base, orderId: 'CST', isForTest: 1 }));
  check(r.out.result === 0 && (await wallet(U)).balance === beforeT, 'codashop: ...and credits NOTHING, even when retried');
  const cst = (await db.collection('checkout_orders').doc('codashop_CST').get()).data() || {};
  check(cst.status === 'test_no_credit', 'codashop: the test order is recorded as test_no_credit');
  await checkout.pollCheckoutOrders();
  check((await wallet(U)).balance === beforeT, 'codashop: the poller never credits a test_no_credit order');
  await db.collection('users').doc(S).set({ usernameLower: 'staff1' }, { merge: true });
  const beforeS = (await wallet(S)).balance || 0;
  r = await hit('/topup', rpc('topup', { ...base, orderId: 'CSS', isForTest: 1, user: { userId: '@staff1', zoneId: '' } }));
  check(r.out.result === 0 && ((await wallet(S)).balance || 0) - beforeS === 78, 'codashop: a test top-up on the staff account does credit (end-to-end proof)');
  r = await hit('/validate', rpc('validate', { ...base, orderId: 'CS1', purchaseOrigin: 'RU' }));
  check(r.out.error && r.out.error.code === -200, 'codashop: sanctioned country is -200');
  r = await hit('/nope', rpc('validate', { ...base, orderId: 'CS1' }));
  check(r.code === 404, 'codashop: unknown path 404');

  const beforeCs = (await wallet(U)).balance;
  r = await hit('/topup', rpc('topup', { ...base, orderId: 'CS1' }));
  check(r.out.result === 0, 'codashop topup succeeds');
  const afterCs = (await wallet(U)).balance;
  check(afterCs - beforeCs === 78, `codashop topup credits the pack (${afterCs - beforeCs})`);
  r = await hit('/topup', rpc('topup', { ...base, orderId: 'CS1' }));
  check(r.out.result === 0 && (await wallet(U)).balance === afterCs, 'codashop topup retried: success, credited once');
  const cso = (await db.collection('checkout_orders').doc('codashop_CS1').get()).data() || {};
  check(cso.rail === 'codashop' && cso.status === 'settled', 'codashop order lives in checkout_orders');
  const cstx = await db.collection('transactions').where('orderReferenceId', '==', 'codashop_CS1').get();
  check(cstx.size === 1 && cstx.docs[0].data().gateway === 'codashop', 'codashop ledger row labelled Codashop');
  const plain = await db.collection('payram_orders').doc('codashop_CS1').get();
  check(!plain.exists, 'nothing Codashop is written to payram_orders');

  // ── the PayRam rail is separate ──
  relayCalls.length = 0;
  const pr = await call(payram.createPayramPayment, U, { packSku: 'starter', rail: 'coda', payType: CARD });
  check(relayCalls.length === 0 && (pr.placeholder === true || pr.ok === true), 'PayRam ignores rail/payType: Coda is never reached through PayRam');

  if (fails.length) { for (const f of fails) console.error('FAIL', f); console.error(`coda-checkout-emulator: ${fails.length} of ${total} failed`); process.exit(1); }
  console.log(`coda-checkout-emulator: ${total} assertions green`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
