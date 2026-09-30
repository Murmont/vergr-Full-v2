// Payment records: what happened to every purchase that did not go cleanly.
// The admin half is the Payments tab (Admin → Economy); plan and reasoning in
// docs/PAYMENTS_ADMIN_PLAN.md.
//
// LEAN MODEL (founder, 2026-09-29, "is there a more affordable way"):
//   • A SUCCESSFUL purchase writes nothing here. Its detail lives on the record
//     the credit already writes (play_purchases/{token}, huawei_purchases/{id},
//     checkout_orders/{orderId}), so success costs no extra write.
//   • An attempt that went WRONG writes ONE document here, keyed by the route
//     and a hash of the purchase token, so every retry of the same purchase lands
//     on the same record as another timeline event instead of a new document.
//
// ⚠ recordIncident / markCredited NEVER THROW. Recording a problem must not be
// able to become a second problem inside a purchase that is already failing.
//
// ⚠ The raw purchase token is stored (server-only, rules deny all client reads)
// because an admin re-check or a Google refund needs it. It is never returned
// to the admin client; the UI sees tokenHash only.

const crypto = require('crypto');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore('vgrdb');
const COLLECTION = 'payment_attempts';

/** Routes, one name each, used on every record and in the admin filters. */
const ROUTES = Object.freeze({
  GOOGLE_PLAY: 'google_play',
  GOOGLE_PLAY_SUB: 'google_play_sub',
  APPGALLERY: 'appgallery',
  APPGALLERY_SUB: 'appgallery_sub',
  CODA: 'coda',
  CODASHOP: 'codashop',
});

const tokenHash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 24);
const attemptIdFor = (route, key) => `${route}_${tokenHash(key)}`;
const trim = (s, n = 300) => (s == null ? null : String(s).slice(0, n));

/**
 * Turn a thrown error into the fields an admin needs. Errors raised after a
 * provider call carry `_provider` (see playBilling.fetchPurchase), so the
 * provider's own HTTP status and message survive into the record.
 */
function describeError(err) {
  const p = err && err._provider ? err._provider : null;
  return {
    code: trim(err && err.code, 60),                 // our code, e.g. 'not-found', 'internal'
    message: trim(err && err.message, 300),           // what the buyer was told
    provider: p ? trim(p.name, 20) : null,            // 'google' | 'huawei' | 'coda'
    providerStatus: p ? Number(p.status) || null : null,
    providerMessage: p ? trim(p.message, 400) : null,
    providerApi: p ? trim(p.api, 60) : null,          // e.g. 'purchases.products.get'
  };
}

/**
 * How serious an error is. `attention` is the reason the Payments tab should
 * surface it, or null when nothing needs doing (the buyer cancelled, the
 * payment is still pending, a missing argument from a broken client).
 */
function classify(err) {
  const code = err && err.code;
  const msg = String(err && err.message || '');
  if (code === 'failed-precondition' && /processing/i.test(msg)) return { status: 'pending', attention: null };
  if (code === 'failed-precondition' && /cancelled|not active|expired|Test purchases/i.test(msg)) return { status: 'cancelled', attention: null };
  if (code === 'unauthenticated') return { status: 'failed', attention: null };
  if (code === 'permission-denied') return { status: 'failed', attention: 'Purchase belongs to another account or product (possible fraud)' };
  if (code === 'invalid-argument' && /Unknown product/i.test(msg)) return { status: 'failed', attention: 'Product id not in our catalogue' };
  if (code === 'invalid-argument') return { status: 'failed', attention: null };
  if (code === 'not-found') return { status: 'failed', attention: 'Provider does not recognise this purchase' };
  return { status: 'failed', attention: 'Payment check failed: the buyer may have paid and not been credited' };
}

/**
 * Record one event for a purchase that went wrong (or is still open).
 * Creates the record on first sight and appends to its timeline after that.
 *
 *   route, uid, productId      what and who
 *   purchaseToken | orderId    the key (token preferred: stable across retries)
 *   stage                      where it failed: 'provider_check', 'credit', ...
 *   err                        the thrown error (optional)
 *   status / attention         override the classification
 *   source                     'server' | 'client' | 'admin' | 'provider'
 *   extra                      merged onto the record (e.g. { orderId })
 */
async function recordIncident({
  route, uid, productId = null, purchaseToken = null, orderId = null,
  stage, err = null, status, attention, source = 'server', detail = null, extra = {},
}) {
  try {
    const key = purchaseToken || orderId || `${uid}_${Date.now()}`;
    const id = attemptIdFor(route, key);
    const cls = err ? classify(err) : { status: status || 'failed', attention: null };
    const finalStatus = status || cls.status;
    const finalAttention = attention !== undefined ? attention : cls.attention;
    const error = err ? describeError(err) : null;
    const event = {
      at: Date.now(), source, type: stage || 'event', status: finalStatus,
      ...(error ? { error } : {}),
      ...(detail ? { detail: trim(typeof detail === 'string' ? detail : JSON.stringify(detail), 500) } : {}),
    };
    const ref = db.collection(COLLECTION).doc(id);
    const fields = {
      attemptId: id, route, uid: uid || null, productId,
      orderId: orderId || null,
      tokenHash: purchaseToken ? tokenHash(purchaseToken) : null,
      ...(purchaseToken ? { purchaseToken } : {}),
      status: finalStatus,
      needsAttention: Boolean(finalAttention),
      attentionReason: finalAttention || null,
      ...(error ? { lastError: error } : {}),
      lastEventAt: FieldValue.serverTimestamp(),
      events: FieldValue.arrayUnion(event),
      attempts: FieldValue.increment(1),
      ...extra,
    };
    let created = false;
    try {
      await ref.create({ ...fields, createdAt: FieldValue.serverTimestamp() });
      created = true;
    } catch (e) {
      if (e && e.code !== 6) throw e; // 6 = ALREADY_EXISTS: append to the existing record
      await ref.set(fields, { merge: true });
    }
    // Alert staff ONCE per incident: on the record's first event, never on a
    // retry of the same purchase (those append to the same record).
    if (created && finalAttention) await alertStaff(id, route, finalAttention, uid);
    return id;
  } catch (e) {
    console.error('paymentRecords.recordIncident failed', e && e.message);
    return null;
  }
}

/**
 * Push to staff accounts (users.staff, the same set adminAlerts notifies): the
 * operator account has no device, so staff accounts are where alerts land.
 * 'payment_attention' is on the push allowlist in index.js.
 */
async function alertStaff(attemptId, route, reason, buyerUid) {
  try {
    const staff = await db.collection('users').where('staff', '==', true).limit(10).get();
    const batch = db.batch();
    for (const s of staff.docs) {
      batch.set(db.collection('notifications').doc(), {
        recipientId: s.id, type: 'payment_attention', read: false,
        title: 'A payment needs attention',
        body: `${route.replace(/_/g, ' ')}: ${reason}`.slice(0, 180),
        meta: { attemptId, buyerUid: buyerUid || null },
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    if (!staff.empty) await batch.commit();
  } catch (e) {
    console.error('paymentRecords.alertStaff failed', e && e.message);
  }
}

/**
 * A purchase that previously failed has now been credited (a retry, a restore
 * or an admin re-check). Closes the incident if there is one. A blind update
 * rather than read-then-write: a purchase with no incident costs no read, and
 * an update of a missing document simply fails.
 */
async function markCredited({ route, purchaseToken = null, orderId = null, detail = null, source = 'server' }) {
  const key = purchaseToken || orderId;
  if (!key) return;
  try {
    await db.collection(COLLECTION).doc(attemptIdFor(route, key)).update({
      status: 'credited',
      needsAttention: false,
      attentionReason: null,
      creditedAt: FieldValue.serverTimestamp(),
      lastEventAt: FieldValue.serverTimestamp(),
      events: FieldValue.arrayUnion({ at: Date.now(), source, type: 'credited', status: 'credited',
        ...(detail ? { detail: trim(detail, 500) } : {}) }),
    });
  } catch (e) {
    if (e && e.code !== 5) console.error('paymentRecords.markCredited failed', e.message); // 5 = NOT_FOUND: no incident, normal
  }
}

/**
 * Wrap a purchase callable's handler so any failure is recorded, then re-thrown
 * unchanged. `keyOf(request)` returns { uid, productId, purchaseToken, orderId }
 * best-effort from the request (for a signature-based store it is read from the
 * signed payload WITHOUT trusting it: this is only the record's label).
 */
function recorded(route, keyOf, handler) {
  return async (request) => {
    try {
      const out = await handler(request);
      const k = safeKey(keyOf, request);
      if (k.purchaseToken && !(out && out.alreadyCredited)) {
        await markCredited({ route, purchaseToken: k.purchaseToken, detail: `credited by ${route} redeem` });
      }
      return out;
    } catch (err) {
      const k = safeKey(keyOf, request);
      await recordIncident({ route, ...k, uid: request.auth?.uid || null, stage: err && err._stage || 'redeem', err });
      throw err;
    }
  };
}
function safeKey(keyOf, request) {
  try { return keyOf(request) || {}; } catch { return {}; }
}

/** Attach provider details to an error so recordIncident can store them. */
function providerError(HttpsError, code, message, { name, status, body, api }) {
  const e = new HttpsError(code, message);
  let text = '';
  try { const j = JSON.parse(body); text = j?.error?.message || body; } catch { text = body || ''; }
  e._provider = { name, status, message: String(text).slice(0, 400), api };
  return e;
}

module.exports = {
  COLLECTION, ROUTES, tokenHash, attemptIdFor, describeError, classify,
  recordIncident, markCredited, providerError, recorded,
};
