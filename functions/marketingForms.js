// Marketing-site form submissions — Contact form (Phase 1).
//
// Writes inbound messages to Firestore (`contact_messages` collection).
// Founder reviews in the Firebase Console; we can wire up a /admin/inbox
// view later if traffic justifies it. No external email service required —
// keeps the zero-out-of-pocket rule intact.
//
// Rate-limiting: one submission per IP per 60 seconds (recorded via a
// short-lived Firestore doc keyed by IP hash). Doesn't need to be
// bulletproof — light defence against drive-by spam.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const admin = require('firebase-admin');
const crypto = require('crypto');

if (admin.apps.length === 0) admin.initializeApp();
const db = getFirestore('vgrdb');

const MAX_NAME_LEN    = 100;
const MAX_EMAIL_LEN   = 254;
const MAX_SUBJECT_LEN = 200;
const MAX_MESSAGE_LEN = 5000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALLOWED_TOPICS = new Set([
  'general',
  'support',
  'privacy',
  'legal',
  'abuse',
  'copyright',
  'press',
  'partnership',
  'other',
]);

function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || '')).digest('hex').slice(0, 16);
}

exports.submitContactForm = onCall(
  { region: 'europe-west1', cors: true },
  async (request) => {
    const data = request.data || {};

    // ── Validation ────────────────────────────────────────────────────
    const name    = String(data.name || '').trim();
    const email   = String(data.email || '').trim();
    const topic   = String(data.topic || 'general').trim();
    const subject = String(data.subject || '').trim();
    const message = String(data.message || '').trim();

    if (!name || name.length > MAX_NAME_LEN) {
      throw new HttpsError('invalid-argument', 'Please provide a valid name (1-100 characters).');
    }
    if (!email || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
      throw new HttpsError('invalid-argument', 'Please provide a valid email address.');
    }
    if (!ALLOWED_TOPICS.has(topic)) {
      throw new HttpsError('invalid-argument', 'Invalid topic selection.');
    }
    if (subject.length > MAX_SUBJECT_LEN) {
      throw new HttpsError('invalid-argument', 'Subject must be 200 characters or fewer.');
    }
    if (!message || message.length > MAX_MESSAGE_LEN) {
      throw new HttpsError('invalid-argument', 'Please provide a message (1-5000 characters).');
    }

    // ── Rate limit: 1 submission per IP per 60s ──────────────────────
    const rawHeaders = (request.rawRequest && request.rawRequest.headers) || {};
    const ip = rawHeaders['cf-connecting-ip'] || rawHeaders['x-forwarded-for'] || 'unknown';
    const ipHash = hashIp(ip);
    const rateKey = `contact_${ipHash}`;
    const rateRef = db.collection('rate_limits').doc(rateKey);
    const rateSnap = await rateRef.get();
    if (rateSnap.exists) {
      const last = rateSnap.data().lastAt || 0;
      if (Date.now() - last < 60 * 1000) {
        throw new HttpsError(
          'resource-exhausted',
          'Please wait a minute before sending another message.'
        );
      }
    }
    await rateRef.set({ lastAt: Date.now() }, { merge: true });

    // ── Persist the message ──────────────────────────────────────────
    const doc = await db.collection('contact_messages').add({
      name,
      email,
      topic,
      subject: subject || null,
      message,
      uid: request.auth?.uid || null,
      ipHash,
      userAgent: rawHeaders['user-agent'] || null,
      country: rawHeaders['cf-ipcountry'] || null,
      status: 'new',
      createdAt: FieldValue.serverTimestamp(),
    });

    return { ok: true, ticketId: doc.id };
  }
);
