// Admin → Economy → Payments: the server half.
//
// Reached through the EXISTING `adminListTransactions` callable with an `op`
// (no new Cloud Function: CLOUD COST RULES in CLAUDE.md). adminEconomy.js has
// already checked economy-screen access before calling in here; every action
// that changes money or an account also needs a fresh 2FA step-up, is rate
// limited and is written to admin_actions.
//
// Nothing here re-implements a purchase. "Re-check with Google" runs the SAME
// redeemPlay the app runs, with the BUYER's uid; credits use the SAME
// grantCurrency as the Grant tab. Plan: docs/PAYMENTS_ADMIN_PLAN.md.

const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const PR = require('./paymentRecords');

const db = getFirestore('vgrdb');

const toMs = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : null));
const clampPage = (n) => Math.max(1, Math.min(Number(n) || 50, 100));

// Every list the tab can show, and the time field it is ordered by. Each
// (filter, order) pair below has an index in firestore.indexes.json: vgrdb is
// the Enterprise edition, where an unindexed query bills every document scanned.
const SOURCES = {
  incidents:   { coll: PR.COLLECTION,        time: 'lastEventAt' },
  google_play: { coll: 'play_purchases',     time: 'creditedAt' },
  appgallery:  { coll: 'huawei_purchases',   time: 'creditedAt' },
  coda:        { coll: 'checkout_orders',    time: 'createdAt' },
};

// ─────────────────────────────────────────────────────────────────────
// Normalising: one row shape for the list, whatever the source.
// ─────────────────────────────────────────────────────────────────────

/** What a Coda / Codashop order bought, in the fields those orders actually carry. */
function codaProduct(d) {
  if (d.subscriptionTier) return `plan:${d.subscriptionTier}`;
  const skus = Array.isArray(d.lines) ? d.lines.map((l) => l && (l.sku || l.packSku)).filter(Boolean) : [];
  if (skus.length) return skus.join(',');
  return d.packSku || d.codashopSku || d.kind || null;
}

function rowFrom(source, id, d) {
  if (source === 'incidents') {
    return {
      source, id, route: d.route, status: d.status, uid: d.uid || null,
      productId: d.productId || null, orderId: d.orderId || null,
      at: toMs(d.lastEventAt) || toMs(d.createdAt),
      needsAttention: !!d.needsAttention, attentionReason: d.attentionReason || null,
      error: d.lastError || null, attempts: d.attempts || 0,
    };
  }
  if (source === 'coda') {
    return {
      source, id, route: d.rail === 'codashop' ? 'codashop' : 'coda',
      status: d.status === 'settled' ? 'credited' : d.status === 'awaiting_settlement' ? 'awaiting' : (d.status || 'unknown'),
      uid: d.uid || null, productId: codaProduct(d), orderId: id,
      amount: d.localPrice ?? null, currency: d.localCurrency || null, amountUSD: d.amountUSD ?? null,
      coins: d.coinsToCredit ?? null, method: d.codaMethod || (d.rail === 'codashop' ? 'Codashop' : null),
      country: d.codaCountryCode || d.codaCountry || null,
      at: toMs(d.createdAt), needsAttention: false,
      refunded: !!d.refundedAt, test: !!d.isForTest,
    };
  }
  // google_play / appgallery ledgers (credited purchases)
  return {
    source, id: PR.tokenHash(id), route: d.route || (source === 'appgallery' ? 'appgallery' : 'google_play'),
    status: d.refundedAt ? (d.refundReason === 'chargeback' ? 'charged_back' : 'refunded') : 'credited',
    uid: d.uid || null, productId: d.productId || null, orderId: d.orderId || null,
    coins: d.coins ?? null, itemKind: d.itemKind || null, amountUSD: d.priceUSD ?? null,
    at: toMs(d.creditedAt), needsAttention: false, refunded: !!d.refundedAt,
  };
}

async function usersFor(uids) {
  const out = {};
  const list = [...new Set(uids.filter(Boolean))];
  const snaps = list.length ? await db.getAll(...list.map((u) => db.collection('users').doc(u))) : [];
  for (const s of snaps) {
    if (!s.exists) continue;
    const u = s.data();
    out[s.id] = { username: u.username || null, displayName: u.displayName || null, avatar: u.avatar || null };
  }
  return out;
}

/** A search string: a Google order id, one of our order ids, a uid, or a username. */
async function resolveSearch(q) {
  const s = String(q || '').trim();
  if (!s) return {};
  if (/^GPA\./i.test(s)) return { orderId: s };
  if (/^coda_|^cs_/i.test(s)) return { orderId: s };
  if (/^[A-Za-z0-9]{28}$/.test(s)) return { uid: s };
  const handle = s.replace(/^@/, '').toLowerCase();
  const u = await db.collection('users').where('usernameLower', '==', handle).limit(1).get();
  return u.empty ? { none: true } : { uid: u.docs[0].id };
}

// ─────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────

async function summary() {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const since = Timestamp.fromDate(start);
  const count = async (q) => (await q.count().get()).data().count;
  const [attention, incidentsToday, playToday, huaweiToday, codaToday, codaSettledToday] = await Promise.all([
    count(db.collection(PR.COLLECTION).where('needsAttention', '==', true)),
    count(db.collection(PR.COLLECTION).where('lastEventAt', '>=', since)),
    count(db.collection('play_purchases').where('creditedAt', '>=', since)),
    count(db.collection('huawei_purchases').where('creditedAt', '>=', since)),
    count(db.collection('checkout_orders').where('createdAt', '>=', since)),
    count(db.collection('checkout_orders').where('settledAt', '>=', since)),
  ]);
  return { attention, today: { incidents: incidentsToday, google_play: playToday, appgallery: huaweiToday, coda_orders: codaToday, coda_settled: codaSettledToday } };
}

async function list(data) {
  const view = data.view || 'attention';
  const source = view === 'attention' ? 'incidents' : view;
  const cfg = SOURCES[source];
  if (!cfg) throw new HttpsError('invalid-argument', 'Unknown view.');
  const pageSize = clampPage(data.pageSize);
  const search = await resolveSearch(data.search);
  if (search.none) return { rows: [], users: {}, nextCursor: null };
  // Coda orders are KEYED by their order id (no orderId field): read it directly.
  if (source === 'coda' && search.orderId) {
    const one = await db.collection(cfg.coll).doc(search.orderId).get();
    const rows = one.exists ? [rowFrom(source, one.id, one.data())] : [];
    return { rows, users: await usersFor(rows.map((r) => r.uid)), nextCursor: null };
  }

  let q = db.collection(cfg.coll);
  if (view === 'attention') q = q.where('needsAttention', '==', true);
  if (search.uid) q = q.where('uid', '==', search.uid);
  if (search.orderId) q = q.where('orderId', '==', search.orderId);
  if (source === 'incidents' && data.route) q = q.where('route', '==', String(data.route));
  if (source === 'incidents' && data.status) q = q.where('status', '==', String(data.status));
  if (!search.orderId) {
    q = q.orderBy(cfg.time, 'desc');
    if (data.cursor) q = q.startAfter(Timestamp.fromMillis(Number(data.cursor)));
  }
  const snap = await q.limit(pageSize).get();
  const rows = snap.docs.map((d) => rowFrom(source, d.id, d.data()));
  const users = await usersFor(rows.map((r) => r.uid));
  const last = rows[rows.length - 1];
  return { rows, users, nextCursor: rows.length === pageSize && last?.at ? last.at : null };
}

/** Find the stored document behind a row. Ledger rows are addressed by token hash. */
async function loadRecord(source, id) {
  const cfg = SOURCES[source];
  if (!cfg) throw new HttpsError('invalid-argument', 'Unknown source.');
  if (source === 'google_play' || source === 'appgallery') {
    // id is the token hash; the ledger is keyed by the raw token, which never
    // leaves the server. Look it up through the incident record if there is one,
    // else scan the buyer's recent ledger rows (uid is required for that).
    return null;
  }
  const snap = await db.collection(cfg.coll).doc(id).get();
  return snap.exists ? { ref: snap.ref, data: snap.data() } : null;
}

async function get(data, deps) {
  const source = data.source;
  let rec;
  let ledger = null;
  if (source === 'google_play' || source === 'appgallery') {
    // Find the ledger row whose token hashes to id, within this buyer's rows.
    if (!data.uid) throw new HttpsError('invalid-argument', 'uid required for a ledger row.');
    const coll = SOURCES[source].coll;
    const snap = await db.collection(coll).where('uid', '==', data.uid).orderBy('creditedAt', 'desc').limit(100).get();
    const hit = snap.docs.find((d) => PR.tokenHash(d.id) === data.id);
    if (!hit) throw new HttpsError('not-found', 'Purchase not found.');
    ledger = { ref: hit.ref, token: hit.id, data: hit.data() };
    rec = { data: hit.data() };
  } else {
    rec = await loadRecord(source, data.id);
    if (!rec) throw new HttpsError('not-found', 'Record not found.');
  }
  const d = rec.data;
  const uid = d.uid || null;

  // Buyer panel. The email comes from Firebase Auth, never from users/{uid}
  // (that document is publicly listable).
  const [userSnap, walletSnap, emails, incidentsForUser] = await Promise.all([
    uid ? db.collection('users').doc(uid).get() : null,
    uid ? db.collection('wallets').doc(uid).get() : null,
    uid ? deps.authEmailsFor([uid]).catch(() => ({})) : {},
    uid ? db.collection(PR.COLLECTION).where('uid', '==', uid).count().get().then((s) => s.data().count).catch(() => null) : null,
  ]);
  const u = userSnap?.exists ? userSnap.data() : {};
  const w = walletSnap?.exists ? walletSnap.data() : {};
  const buyer = uid ? {
    uid, username: u.username || null, displayName: u.displayName || null, avatar: u.avatar || null,
    email: emails?.[uid] || null, createdAt: toMs(u.createdAt), country: u.geoCountry || u.country || null,
    plan: typeof u.subscription === 'string' ? u.subscription : null,
    purchaseBanUntil: u.purchaseBanUntil || null, purchaseBanReason: u.purchaseBanReason || null,
    balance: w.balance ?? 0, boostCoins: w.boostCoins ?? 0, vp: w.vp ?? 0,
    incidentCount: incidentsForUser,
  } : null;

  // Never send the raw token to the client.
  const { purchaseToken, ...safe } = d; // eslint-disable-line no-unused-vars
  const record = {
    ...safe,
    ...(ledger ? { tokenHash: PR.tokenHash(ledger.token) } : {}),
    createdAt: toMs(d.createdAt), lastEventAt: toMs(d.lastEventAt), creditedAt: toMs(d.creditedAt),
    settledAt: toMs(d.settledAt), expiredAt: toMs(d.expiredAt), refundedAt: toMs(d.refundedAt),
    events: Array.isArray(d.events) ? [...d.events].sort((a, b) => (a.at || 0) - (b.at || 0)) : [],
    canRecheck: source === 'incidents'
      ? (d.route === 'google_play' && !!d.purchaseToken && !!d.productId) || d.route === 'coda'
      : source === 'coda',
    canRefund: (source === 'incidents' || source === 'google_play') && !!(d.orderId && /^GPA\./.test(d.orderId)),
  };
  return { source, id: data.id, record, buyer };
}

/** Live view from the provider, fetched only when the admin asks for it. */
async function providerView(data) {
  const orderId = String(data.orderId || '');
  if (/^GPA\./.test(orderId)) {
    const pb = require('./playBilling');
    const token = await pb._androidPublisherToken();
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(pb._PACKAGE_NAME)}/orders/${encodeURIComponent(orderId)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.text();
    let json = null; try { json = JSON.parse(body); } catch { /* keep text */ }
    return { provider: 'google', ok: res.ok, status: res.status, order: res.ok ? json : null, error: res.ok ? null : (json?.error?.message || body.slice(0, 300)) };
  }
  if (/^coda_|^cs_/i.test(orderId)) {
    const snap = await db.collection('checkout_orders').doc(orderId).get();
    if (!snap.exists) return { provider: 'coda', ok: false, error: 'Order not found.' };
    const { _internal_coda } = require('./checkout');
    const state = await _internal_coda.codaOrderState(snap.data());
    return { provider: 'coda', ok: state !== 'unknown', state };
  }
  return { provider: null, ok: false, error: 'No provider order id on this record.' };
}

// ─────────────────────────────────────────────────────────────────────
// Actions (each: 2FA step-up, rate limit, audit, and a timeline event)
// ─────────────────────────────────────────────────────────────────────

async function addEvent(ref, event, fields = {}) {
  await ref.set({
    ...fields,
    lastEventAt: FieldValue.serverTimestamp(),
    events: FieldValue.arrayUnion({ at: Date.now(), source: 'admin', ...event }),
  }, { merge: true });
}

async function incidentRef(id) {
  const ref = db.collection(PR.COLLECTION).doc(String(id));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Record not found.');
  return { ref, d: snap.data() };
}

async function recheck(data, ctx) {
  if (data.source === 'coda') {
    const snap = await db.collection('checkout_orders').doc(String(data.id)).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');
    const order = snap.data();
    const { _internal_coda } = require('./checkout');
    const state = await _internal_coda.codaOrderState(order);
    let result = { state };
    if (state === 'paid' && order.status !== 'settled') {
      result = { state, ...(await require('./orders').settleOrder('checkout_orders', snap.id, { source: 'admin-recheck' })) };
      if (result.credited) await PR.markCredited({ route: order.rail === 'codashop' ? PR.ROUTES.CODASHOP : PR.ROUTES.CODA, orderId: snap.id, source: 'admin', detail: `re-checked by admin ${ctx.uid}` });
    }
    return result;
  }
  const { ref, d } = await incidentRef(data.id);
  if (d.route === 'coda' && d.orderId) return recheck({ source: 'coda', id: d.orderId }, ctx);
  if (d.route !== 'google_play' || !d.purchaseToken || !d.productId) {
    throw new HttpsError('failed-precondition', 'This record cannot be re-checked (no purchase token on file).');
  }
  const stage = { at: 'admin_recheck' };
  try {
    const out = await require('./playBilling')._redeemPlay(d.uid, { productId: d.productId, purchaseToken: d.purchaseToken, orderId: d.orderId }, stage);
    await addEvent(ref, { type: 'admin_recheck', status: 'credited', detail: `Google confirmed the purchase; ${out.alreadyCredited ? 'it was already credited' : `credited ${out.coins || 0} coins`}. By ${ctx.uid}.` },
      { status: 'credited', needsAttention: false, attentionReason: null });
    return { ok: true, ...out };
  } catch (err) {
    const e = PR.describeError(err);
    await addEvent(ref, { type: 'admin_recheck', status: 'failed', error: e, detail: `stage ${stage.at}` }, { lastError: e });
    return { ok: false, error: e };
  }
}

async function credit(data, ctx) {
  const amount = Math.floor(Number(data.coins));
  const reason = String(data.reason || '').trim();
  if (!(amount > 0) || amount > 1_000_000) throw new HttpsError('invalid-argument', 'coins must be 1 to 1,000,000.');
  if (!reason) throw new HttpsError('invalid-argument', 'reason required.');
  const { ref, d } = await incidentRef(data.id);
  if (!d.uid) throw new HttpsError('failed-precondition', 'No buyer on this record.');
  await ctx.grantCurrency({ callerUid: ctx.uid, targetUid: d.uid, amount, currency: 'coins',
    reason: `Payment ${data.id}: ${reason}`, type: 'admin_payment_credit', ...ctx.meta });
  await addEvent(ref, { type: 'admin_credit', status: 'credited', detail: `${amount} coins credited manually by ${ctx.uid}: ${reason}` },
    { status: 'credited_manually', needsAttention: false, attentionReason: null, manualCoins: FieldValue.increment(amount) });
  return { ok: true };
}

async function removeCoins(data, ctx) {
  const amount = Math.floor(Number(data.coins));
  const reason = String(data.reason || '').trim();
  const targetUid = String(data.uid || '');
  if (!(amount > 0)) throw new HttpsError('invalid-argument', 'coins must be positive.');
  if (!reason || !targetUid) throw new HttpsError('invalid-argument', 'uid and reason required.');
  // allowNegative: a refunded buyer who already spent the coins goes negative,
  // so their next purchase repays it first (founder, 2026-09-29).
  await ctx.grantCurrency({ callerUid: ctx.uid, targetUid, amount: -amount, currency: 'coins',
    reason: `Payment ${data.id || ''}: ${reason}`, type: 'admin_payment_reversal', allowNegative: true, ...ctx.meta });
  if (data.source === 'incidents' && data.id) {
    const { ref } = await incidentRef(data.id);
    await addEvent(ref, { type: 'coins_revoked', status: 'refunded', detail: `${amount} coins removed by ${ctx.uid}: ${reason}` });
  }
  return { ok: true };
}

async function refund(data, ctx) {
  const orderId = String(data.orderId || '');
  if (!/^GPA\./.test(orderId)) throw new HttpsError('invalid-argument', 'A Google Play order id (GPA.…) is required.');
  const revoke = data.revoke === true;
  const pb = require('./playBilling');
  const token = await pb._androidPublisherToken();
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(pb._PACKAGE_NAME)}/orders/${encodeURIComponent(orderId)}:refund?revoke=${revoke}`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  const body = await res.text();
  if (!res.ok) {
    let msg = body; try { msg = JSON.parse(body)?.error?.message || body; } catch { /* text */ }
    throw new HttpsError('failed-precondition', `Google refused the refund: ${String(msg).slice(0, 300)}`);
  }
  // Mark it everywhere it is recorded. The ledger row is found by order id.
  const [ledger, incident] = await Promise.all([
    db.collection('play_purchases').where('orderId', '==', orderId).limit(1).get(),
    db.collection(PR.COLLECTION).where('orderId', '==', orderId).limit(1).get(),
  ]);
  const stamp = { refundedAt: FieldValue.serverTimestamp(), refundReason: 'admin', refundedBy: ctx.uid };
  if (!ledger.empty) await ledger.docs[0].ref.set(stamp, { merge: true });
  if (!incident.empty) {
    await addEvent(incident.docs[0].ref, { type: 'admin_refund', status: 'refunded', detail: `Refunded through Google Play by ${ctx.uid}${revoke ? ', item revoked' : ''}` },
      { status: 'refunded', needsAttention: false, attentionReason: null, ...stamp });
  }
  return { ok: true, revoke };
}

async function note(data, ctx) {
  const text = String(data.text || '').trim().slice(0, 1000);
  if (!text) throw new HttpsError('invalid-argument', 'text required.');
  const { ref } = await incidentRef(data.id);
  await addEvent(ref, { type: 'admin_note', status: 'note', detail: `${ctx.uid}: ${text}` });
  return { ok: true };
}

async function resolve(data, ctx) {
  const text = String(data.text || '').trim().slice(0, 1000);
  if (!text) throw new HttpsError('invalid-argument', 'A resolution note is required.');
  const { ref } = await incidentRef(data.id);
  await addEvent(ref, { type: 'resolved', status: 'resolved', detail: `${ctx.uid}: ${text}` },
    { status: 'resolved', needsAttention: false, attentionReason: null, resolvedBy: ctx.uid, resolvedAt: FieldValue.serverTimestamp() });
  return { ok: true };
}

/** Block (or unblock) a buyer from buying coins. Enforced in the redeem paths and createCheckout. */
async function purchaseBan(data, ctx) {
  const targetUid = String(data.uid || '');
  if (!targetUid) throw new HttpsError('invalid-argument', 'uid required.');
  const days = Number(data.days);
  const ref = db.collection('users').doc(targetUid);
  if (!(days > 0)) {
    await ref.set({ purchaseBanUntil: FieldValue.delete(), purchaseBanReason: FieldValue.delete() }, { merge: true });
    return { ok: true, lifted: true };
  }
  const reason = String(data.reason || '').trim().slice(0, 300);
  if (!reason) throw new HttpsError('invalid-argument', 'reason required.');
  const until = Date.now() + Math.min(days, 3650) * 86400000;
  await ref.set({ purchaseBanUntil: until, purchaseBanReason: reason }, { merge: true });
  return { ok: true, until };
}

/** Run the daily Google refund/chargeback check now (paymentRefunds.js). */
async function syncRefunds() {
  const tally = await require('./paymentRefunds').syncVoidedPurchases();
  return { ok: true, tally };
}

const READS = { summary, list, get, provider: providerView };
const WRITES = { recheck, credit, removeCoins, refund, note, resolve, purchaseBan, syncRefunds };

/**
 * Entry point from adminListTransactions. `deps` carries what lives in
 * adminEconomy.js (grantCurrency, auth, audit), so there is one copy of each.
 */
async function handle(op, request, deps) {
  const uid = request.auth?.uid;
  const data = request.data || {};
  if (READS[op]) return READS[op](data, deps);
  if (!WRITES[op]) throw new HttpsError('invalid-argument', `Unknown op ${op}.`);
  await deps.requireFreshStepUp(uid);
  await deps.adminRateLimit(uid, `payments_${op}`, { perHour: 60, perDay: 300, perMonth: 3000 });
  const meta = deps.extractRequestMeta(request);
  const out = await WRITES[op](data, { uid, meta, grantCurrency: deps.grantCurrency });
  await deps.auditAdminAction({
    actor: uid, action: `payments_${op}`,
    target: { type: 'payment', id: String(data.id || data.orderId || data.uid || '') },
    after: { ...data, text: undefined, reason: undefined },
    reason: String(data.reason || data.text || '').slice(0, 400),
    ...meta, stepUpEnforced: true, stepUpFresh: true,
  });
  return out;
}

module.exports = { handle };
