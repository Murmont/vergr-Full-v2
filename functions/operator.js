// The Operator: the platform's super admin, and deliberately NOT a Vergr user.
//
// Founder, 2026-09-19: the admin must not be the public @Vergr account, must not
// be reachable from the web, and must leave "nothing to find" for someone with
// bad intent looking at the app. So the Operator:
//   - signs in to the separate Vergr Admin desktop app with a private email,
//   - has NO users/{uid} document (no profile, username, followers or presence),
//   - is identified by a Firebase Auth CUSTOM CLAIM `operator: true`, which only
//     the Admin SDK can set, never by a profile field a client can write,
//   - must pass an authenticator-app code (admin_security/{uid}) before any
//     admin callable answers (requireOperatorSession).
//
// ⚠ NOTHING HERE IS A CLOUD FUNCTION. It is a module other functions require,
// so it adds no deployed function, no Artifact Registry image and no bill. The
// two entry points are an existing callable (inviteAdmin, with operator: true)
// and the existing onUserCreated trigger.
//
// Setup, and no password ever leaves the founder's machine:
//   1. An existing admin calls inviteAdmin({ email, operator: true }). The
//      SERVER writes operator_pending/{sha256(email)} with a short expiry.
//      Nothing is written by a client, so no rule opens for this.
//   2. In Vergr Admin the founder creates that account with his own password.
//   3. onUserCreated calls claimOperatorOnCreate() FIRST: it matches the
//      pending doc, sets the claim, records operators/{uid}, deletes the
//      pending doc, and the trigger returns BEFORE creating any profile.
//   4. First sign-in forces authenticator enrollment; after that every admin
//      call needs a live session.

const admin = require('firebase-admin');
const crypto = require('crypto');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');

const db = getFirestore('vgrdb');

// How long an authenticator code keeps an admin session open. After this every
// admin callable answers "step-up required" and Vergr Admin asks for a code.
const OPERATOR_SESSION_MS = 12 * 60 * 60 * 1000;

// The window to create the account after arming it. Short on purpose: the
// pending doc is the only thing standing between that email address and a
// claim, so it should not sit around.
const OPERATOR_SETUP_TTL_MS = 60 * 60 * 1000;

const emailHash = (email) =>
  crypto.createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex');

// Short in-memory cache so a burst of admin calls costs one Auth lookup, not one
// per call. Claims change only at setup or on revocation, both rare.
const claimCache = new Map();
const CLAIM_TTL_MS = 60 * 1000;

async function isOperator(uid) {
  if (!uid) return false;
  const hit = claimCache.get(uid);
  if (hit && Date.now() - hit.at < CLAIM_TTL_MS) return hit.v;
  let v = false;
  try {
    const u = await admin.auth().getUser(uid);
    v = !u.disabled && u.customClaims?.operator === true;
  } catch { v = false; }
  claimCache.set(uid, { v, at: Date.now() });
  return v;
}

// Every admin callable passes through here for an Operator. No authenticator
// enrolled, or no code within the session window, means no answer: this is the
// server side of "no code, no access", not a screen the client could skip.
async function requireOperatorSession(uid) {
  const snap = await db.collection('admin_security').doc(uid).get();
  const d = snap.exists ? snap.data() : null;
  if (!d || !d.enrolled) {
    throw new HttpsError('failed-precondition',
      'Authenticator not set up. Finish setup in Vergr Admin first.',
      { code: 'TOTP_ENROLL_REQUIRED' });
  }
  const last = d.lastStepUpAt && typeof d.lastStepUpAt.toMillis === 'function' ? d.lastStepUpAt.toMillis() : 0;
  if (Date.now() - last > OPERATOR_SESSION_MS) {
    throw new HttpsError('failed-precondition',
      'Admin step-up required. Enter your authenticator code.',
      { code: 'STEP_UP_REQUIRED', maxAgeSec: Math.floor(OPERATOR_SESSION_MS / 1000) });
  }
}

// Arms an email address so the next Auth account created with it becomes the
// Operator. Called by inviteAdmin (founder-gated and audited there); the
// address is stored ONLY as a hash, so the pending doc names nobody.
async function armOperator(email, byUid) {
  const h = emailHash(email);
  await db.collection('operator_pending').doc(h).set({
    armedBy: byUid || null,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + OPERATOR_SETUP_TTL_MS),
  });
  return { emailHash: h, expiresAt: Date.now() + OPERATOR_SETUP_TTL_MS };
}

// Called first thing in onUserCreated. Returns true when the new Auth user is
// the Operator being set up, in which case the caller must NOT create a profile.
async function claimOperatorOnCreate(user) {
  if (!user?.email) return false;
  const pendingRef = db.collection('operator_pending').doc(emailHash(user.email));
  const pending = await pendingRef.get();
  if (!pending.exists) return false;
  const exp = pending.data()?.expiresAt?.toMillis ? pending.data().expiresAt.toMillis() : 0;
  // An expired arm is cleaned up rather than honoured, so a stale doc can never
  // hand the claim to an account created weeks later.
  if (Date.now() > exp) {
    await pendingRef.delete().catch(() => {});
    return false;
  }
  await admin.auth().setCustomUserClaims(user.uid, { operator: true });
  await db.collection('operators').doc(user.uid).set({
    emailHash: emailHash(user.email),
    armedBy: pending.data()?.armedBy || null,
    createdAt: FieldValue.serverTimestamp(),
  });
  await pendingRef.delete();
  claimCache.delete(user.uid);
  return true;
}

module.exports = {
  isOperator,
  requireOperatorSession,
  claimOperatorOnCreate,
  armOperator,
  emailHash,
  OPERATOR_SESSION_MS,
  OPERATOR_SETUP_TTL_MS,
};
