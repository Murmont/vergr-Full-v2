// functions/vergrMe.js
// Public analytics for vergr.me pages. The PUBLIC page is viewed mostly by
// LOGGED-OUT visitors, so the old client-write path (gated behind isAuth in
// firestore.rules) silently dropped the majority of traffic. This callable
// runs server-side with the Admin SDK so anonymous visitors are counted, while
// `vergrMeViews` stays server-write-only in the rules (no client tampering).
//
// Idempotency/abuse: callable is invocable without auth (cors). We validate the
// event shape, cap field-name length, and apply a light per-instance throttle.
// Counters are best-effort analytics, not money — cold-start throttle resets
// are acceptable.

const functions = require('firebase-functions/v2');
const { planOf } = require('./plan');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const admin = require('firebase-admin');
const { isStaffDoc } = require('./staff');

if (admin.apps.length === 0) admin.initializeApp();
const db = getFirestore('vgrdb');

const HttpsError = functions.https.HttpsError;
const REGION = 'europe-west1';

const today = () => new Date().toISOString().slice(0, 10);
const EVENTS = ['view', 'block_click', 'message', 'email', 'tip'];

// Per-instance throttle: key -> last ms. Caps a single caller to ~1 event/250ms.
const lastSeen = new Map();
function throttled(key) {
  const now = Date.now();
  const prev = lastSeen.get(key) || 0;
  if (now - prev < 250) return true;
  lastSeen.set(key, now);
  if (lastSeen.size > 5000) lastSeen.clear(); // bound memory
  return false;
}

const safeId = (s) => typeof s === 'string' && s.length > 0 && s.length <= 128 && !s.includes('/') && !s.includes('.');

exports.trackVergrMeEvent = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const { uid, event, blockId, device, ref: refHost } = request.data || {};
    if (!safeId(uid)) throw new HttpsError('invalid-argument', 'uid required');
    if (!EVENTS.includes(event)) throw new HttpsError('invalid-argument', 'bad event');

    const ip = request.rawRequest?.ip || 'x';
    if (throttled(`${uid}:${ip}:${event}:${blockId || ''}`)) return { ok: true, throttled: true };

    const ref = db.collection('users').doc(uid).collection('vergrMeViews').doc(today());
    const update = { date: today() };

    switch (event) {
      case 'view': {
        const dev = device === 'mobile' ? 'mobile' : 'desktop';
        update.views = FieldValue.increment(1);
        update[`devices.${dev}`] = FieldValue.increment(1);
        // Referrer host, sanitised into a single map key ('.' would nest).
        const host = typeof refHost === 'string' && refHost
          ? refHost.toLowerCase().slice(0, 48).replace(/[^a-z0-9-]/g, '_')
          : 'direct';
        update[`referrers.${host}`] = FieldValue.increment(1);
        break;
      }
      case 'block_click': {
        if (!safeId(blockId)) throw new HttpsError('invalid-argument', 'blockId required');
        update[`blockClicks.${blockId}`] = FieldValue.increment(1);
        update[`linkClicks.${blockId}`] = FieldValue.increment(1); // legacy mirror
        break;
      }
      case 'message': update.messageTaps = FieldValue.increment(1); break;
      case 'email':   update.emailTaps = FieldValue.increment(1); break;
      case 'tip':     update.tipTaps = FieldValue.increment(1); break;
      default: break;
    }

    await ref.set(update, { merge: true });
    return { ok: true };
  }
);

// ── Lead webhook (Pro) ────────────────────────────────────────────────
// On each new vergrMeLeads doc, POST it to the owner's configured webhook
// URL, signed with HMAC-SHA256. Bounded inline retry (3 attempts): this is
// a courtesy delivery, never blocks or fails the lead write itself.
const crypto = require('crypto');

exports.onVergrMeLead = functions.firestore.onDocumentCreated(
  { document: 'users/{userId}/vergrMeLeads/{leadId}', database: 'vgrdb', region: REGION },
  async (event) => {
    const lead = event.data?.data();
    const { userId, leadId } = event.params;
    if (!lead) return;
    try {
      const [pageSnap, userSnap] = await Promise.all([
        db.collection('users').doc(userId).collection('vergrMe').doc('page').get(),
        db.collection('users').doc(userId).get(),
      ]);
      const page = pageSnap.exists ? pageSnap.data() : null;
      const url = page?.webhookUrl;
      if (!url || !/^https:\/\//i.test(url)) return;
      // Server-side Pro gate (the field is client-written).
      const u = userSnap.exists ? userSnap.data() : {};
      const tier = planOf(u);
      const isAdmin = isStaffDoc(u) || u?.role === 'admin';
      if (tier !== 'pro' && !isAdmin) return;

      const body = JSON.stringify({
        event: 'lead.created',
        leadId,
        page: page.username || null,
        lead: {
          name: lead.name || null,
          email: lead.email || null,
          phone: lead.phone || null,
          message: lead.message || null,
        },
        ts: Date.now(),
      });
      const headers = { 'Content-Type': 'application/json', 'User-Agent': 'Vergr-Webhook/1.0' };
      if (page.webhookSecret) {
        headers['X-Vergr-Signature'] = 'sha256=' + crypto.createHmac('sha256', String(page.webhookSecret)).update(body).digest('hex');
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const resp = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(8000) });
          if (resp.ok) return;
        } catch { /* network error → retry */ }
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
      console.warn('vergrMe lead webhook failed after 3 attempts', userId);
    } catch (e) {
      console.warn('vergrMe lead webhook error', e.message);
    }
  }
);
