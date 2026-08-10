// Account-level Two-Factor Authentication (TOTP) for ANY authenticated user.
//
// This powers Settings → Security → Two-Factor Authentication. It is a real
// authenticator-app second factor (Google Authenticator / Authy / 1Password etc).
//
// We CANNOT gate Firebase email/password login itself without the paid Identity
// Platform (Blaze), which violates the project's zero-cost rule. So this is a
// genuine "step-up" 2FA: the user enrolls a TOTP secret + recovery codes, and
// the client requires a fresh TOTP verification before sensitive account
// actions (change password, sign out everywhere, open wallet security, delete
// account). The cosmetic toggle is replaced by this real enroll/verify flow.
//
// Storage (server-only, never client-readable — see firestore.rules):
//   account_security/{uid}        { secret, enrolled, enrolledAt, recoveryCodesHashed[], lastStepUpAt }
//   account_totp_enrollment/{uid} { secret, otpauthUrl, expiresAt }   (pending, 10-min TTL)
//
// The user doc mirrors only a NON-secret flag: settings.twoFactorEnabled, so the
// client UI can reflect state without ever reading the secret.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const speakeasy = require('speakeasy');
const crypto = require('crypto');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

const TOTP_ISSUER = 'VERGR';
const ENROLLMENT_TTL_MS = 10 * 60 * 1000; // 10 minutes to finish setup
const RECOVERY_CODES = 10;
const STEP_UP_WINDOW_SEC = 300; // a verification stays "fresh" for 5 minutes

function requireUid(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in.');
  return uid;
}

const secDoc = (uid) => db.collection('account_security').doc(uid);
const pendingDoc = (uid) => db.collection('account_totp_enrollment').doc(uid);

// ── Enroll: generate a pending secret (10-min TTL). Returns otpauth URL + base32.
exports.enrollAccountTotp = functions.https.onCall({ region: REGION, cors: true }, async (request) => {
  const uid = requireUid(request);

  const cur = await secDoc(uid).get();
  if (cur.exists && cur.data()?.enrolled) {
    throw new HttpsError('failed-precondition', '2FA is already enabled. Disable it first to re-enroll.');
  }

  const userSnap = await db.collection('users').doc(uid).get();
  const username = userSnap.data()?.username || uid.slice(0, 6);

  const secret = speakeasy.generateSecret({
    length: 20,
    name: `${TOTP_ISSUER} (${username})`,
    issuer: TOTP_ISSUER,
  });

  await pendingDoc(uid).set({
    secret: secret.base32,
    otpauthUrl: secret.otpauth_url,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + ENROLLMENT_TTL_MS),
  });

  return {
    ok: true,
    otpauthUrl: secret.otpauth_url,
    secret: secret.base32, // manual entry for devices without a camera
    expiresInSec: Math.floor(ENROLLMENT_TTL_MS / 1000),
  };
});

// ── Confirm: verify a code, activate, return one-shot recovery codes.
exports.confirmAccountTotpEnrollment = functions.https.onCall({ region: REGION, cors: true }, async (request) => {
  const uid = requireUid(request);
  const { code } = request.data || {};
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'Enter the 6-digit code from your authenticator app.');
  }

  const pending = await pendingDoc(uid).get();
  if (!pending.exists) {
    throw new HttpsError('failed-precondition', 'No enrollment in progress. Start again.');
  }
  const data = pending.data();
  const expMs = data.expiresAt?.toMillis ? data.expiresAt.toMillis() : 0;
  if (Date.now() > expMs) {
    await pendingDoc(uid).delete().catch(() => {});
    throw new HttpsError('deadline-exceeded', 'Enrollment expired. Start again.');
  }

  const verified = speakeasy.totp.verify({ secret: data.secret, encoding: 'base32', token: code, window: 1 });
  if (!verified) throw new HttpsError('permission-denied', 'Invalid code. Check your authenticator clock.');

  const plainCodes = Array.from({ length: RECOVERY_CODES }, () =>
    crypto.randomBytes(5).toString('hex').toUpperCase()
  );
  const hashedCodes = plainCodes.map(c => crypto.createHash('sha256').update(c).digest('hex'));

  await db.runTransaction(async (tx) => {
    tx.set(secDoc(uid), {
      secret: data.secret,
      enrolled: true,
      enrolledAt: FieldValue.serverTimestamp(),
      recoveryCodesHashed: hashedCodes,
      lastStepUpAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    // Non-secret mirror flag for the client UI.
    tx.set(db.collection('users').doc(uid), {
      settings: { twoFactorEnabled: true },
    }, { merge: true });
  });
  await pendingDoc(uid).delete().catch(() => {});

  return { ok: true, recoveryCodes: plainCodes };
});

// ── Verify (step-up): accepts a 6-digit TOTP OR a recovery code (consumed once).
//    On success records lastStepUpAt so callers can require a fresh check.
exports.verifyAccountTotp = functions.https.onCall({ region: REGION, cors: true }, async (request) => {
  const uid = requireUid(request);
  const { code } = request.data || {};
  if (typeof code !== 'string' || !code.trim()) {
    throw new HttpsError('invalid-argument', 'Code required.');
  }
  const normalized = code.toUpperCase().replace(/\s/g, '');

  const sec = await secDoc(uid).get();
  const d = sec.data() || {};
  if (!sec.exists || !d.enrolled) throw new HttpsError('failed-precondition', '2FA is not enabled.');

  // Plain 6-digit TOTP path.
  if (/^\d{6}$/.test(normalized)) {
    const ok = speakeasy.totp.verify({ secret: d.secret, encoding: 'base32', token: normalized, window: 1 });
    if (!ok) throw new HttpsError('permission-denied', 'Invalid code.');
    await secDoc(uid).set({ lastStepUpAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true, lastStepUpAt: Date.now() };
  }

  // Recovery-code path (one-shot).
  const candidate = crypto.createHash('sha256').update(normalized).digest('hex');
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(secDoc(uid));
    const codes = snap.data()?.recoveryCodesHashed || [];
    const idx = codes.indexOf(candidate);
    if (idx === -1) throw new HttpsError('permission-denied', 'Code is wrong or already used.');
    const remaining = codes.slice(0, idx).concat(codes.slice(idx + 1));
    tx.set(secDoc(uid), {
      recoveryCodesHashed: remaining,
      lastStepUpAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, usedRecovery: true, remainingCodes: remaining.length };
  });
});

// ── Disable: requires a current code (so a hijacked session alone can't remove it).
exports.disableAccountTotp = functions.https.onCall({ region: REGION, cors: true }, async (request) => {
  const uid = requireUid(request);
  const { code } = request.data || {};
  const sec = await secDoc(uid).get();
  const d = sec.data() || {};
  if (!sec.exists || !d.enrolled) throw new HttpsError('failed-precondition', '2FA is not enabled.');

  const normalized = typeof code === 'string' ? code.toUpperCase().replace(/\s/g, '') : '';
  let ok = false;
  if (/^\d{6}$/.test(normalized)) {
    ok = speakeasy.totp.verify({ secret: d.secret, encoding: 'base32', token: normalized, window: 1 });
  } else if (normalized) {
    const candidate = crypto.createHash('sha256').update(normalized).digest('hex');
    ok = (d.recoveryCodesHashed || []).includes(candidate);
  }
  if (!ok) throw new HttpsError('permission-denied', 'A valid code is required to disable 2FA.');

  await db.runTransaction(async (tx) => {
    tx.delete(secDoc(uid));
    tx.set(db.collection('users').doc(uid), {
      settings: { twoFactorEnabled: false },
    }, { merge: true });
  });
  return { ok: true };
});

// ── Status: non-secret summary for the UI.
exports.getMyAccountSecurityStatus = functions.https.onCall({ region: REGION, cors: true }, async (request) => {
  const uid = requireUid(request);
  const sec = await secDoc(uid).get();
  const d = sec.data() || {};
  const lastStepUpAt = d.lastStepUpAt?.toMillis ? d.lastStepUpAt.toMillis() : 0;
  return {
    enrolled: !!d.enrolled,
    recoveryCodesRemaining: (d.recoveryCodesHashed || []).length,
    lastStepUpAt,
    stepUpFresh: Date.now() - lastStepUpAt < STEP_UP_WINDOW_SEC * 1000,
  };
});
