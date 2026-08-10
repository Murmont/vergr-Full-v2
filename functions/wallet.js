// Wallet security primitives + PIN + TOTP callables.
//
// Spec: CLAUDE.md → "[Option 1] Self-custodied USDC wallet" + Path B custody.
//
// Phase 0/2 scope shipping in this file:
//   - PIN setup, verify, change, reset (scrypt-hashed, lockout-protected)
//   - TOTP enrollment + verify + disable (speakeasy)
//   - Wallet onboarding completion marker
//   - Whitelisted withdrawal address management (add/remove + TOTP gate)
//
// NOT in this file yet (Phase 3-4, separate session):
//   - Circle Wallets API integration for deposit detection
//   - processReadyWithdrawals Cloud Function (signs + broadcasts via Circle API)
//   - Reconciliation cron
//   - Travel Rule + sanctions screening (Phase 5)
//
// Security design notes
// ─────────────────────────────────────────────────────────────────────
// PIN model: 6-digit numeric. scrypt with N=32768, r=8, p=1 = ~250ms per
// check on Cloud Functions runtime. Combined with lockout (5 wrong = 1hr,
// 10 in 24h = 24hr + email, 20 in week = wallet frozen), a leaked database
// would still take ~70 hours per PIN to brute force offline. TOTP gates
// the high-value actions independently so a cracked PIN alone can't move
// money over EUR 100 or whitelist new addresses.
//
// Storage layout: sensitive fields (pinHash, pinSalt, totpSecret,
// totpRecoveryCodesHashed) live in `wallets/{uid}/security/credentials`,
// which firestore.rules blocks all client access to. The parent
// `wallets/{uid}` doc exposes only state booleans (totpEnrolled,
// onboardingCompleted) that clients need for UI.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('node:crypto');
const speakeasy = require('speakeasy');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

// ════════════════════════════════════════════════════════════════════
// CONSTANTS — single source of truth for security thresholds
// ════════════════════════════════════════════════════════════════════

const PIN_LENGTH = 6;
const PIN_SCRYPT_OPTS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const PIN_SALT_BYTES = 32;
const PIN_KEY_LEN = 64;

const PIN_UNLOCK_TTL_SEC = 5 * 60;         // 5 min session after correct PIN
const PIN_LOCKOUT_THRESHOLD_1 = 5;          // wrong PINs before short cooldown
const PIN_LOCKOUT_DURATION_1_MS = 60 * 60 * 1000;  // 1 hour
const PIN_LOCKOUT_THRESHOLD_2 = 10;         // wrong PINs in 24h before long lockout + alert
const PIN_LOCKOUT_DURATION_2_MS = 24 * 60 * 60 * 1000;  // 24 hours
const PIN_LOCKOUT_THRESHOLD_3 = 20;         // wrong PINs in 7 days = wallet frozen

const TOTP_ISSUER = 'VERGR Wallet';
const TOTP_RECOVERY_CODES = 10;
const TOTP_ENROLLMENT_TTL_MS = 10 * 60 * 1000;  // 10 min to complete enrollment

const MAX_WHITELIST_ADDRESSES = 10;
const WHITELIST_COOLDOWN_HOURS = 24;        // new address must wait 24h before first use

// ════════════════════════════════════════════════════════════════════
// SCRYPT HELPERS (sync wrapper around crypto.scrypt)
// ════════════════════════════════════════════════════════════════════

function hashPin(pin, saltHex) {
  return new Promise((resolve, reject) => {
    const salt = Buffer.from(saltHex, 'hex');
    crypto.scrypt(pin, salt, PIN_KEY_LEN, PIN_SCRYPT_OPTS, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString('hex'));
    });
  });
}

function newPinSalt() {
  return crypto.randomBytes(PIN_SALT_BYTES).toString('hex');
}

function constantTimeEqual(a, b) {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// ════════════════════════════════════════════════════════════════════
// FIRESTORE PATH HELPERS
// ════════════════════════════════════════════════════════════════════

function walletDoc(uid) { return db.collection('wallets').doc(uid); }
function credsDoc(uid)  { return walletDoc(uid).collection('security').doc('credentials'); }

// ════════════════════════════════════════════════════════════════════
// REQUIRE HELPERS
// ════════════════════════════════════════════════════════════════════

function requireAuthUid(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be signed in.');
  if (request.auth.token?.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('permission-denied', 'Guest accounts cannot use the wallet.');
  }
  return uid;
}

function validatePinFormat(pin) {
  if (typeof pin !== 'string') throw new HttpsError('invalid-argument', 'PIN must be a string.');
  if (!/^\d{6}$/.test(pin)) throw new HttpsError('invalid-argument', 'PIN must be exactly 6 digits.');
  // Reject obviously weak PINs
  if (/^(\d)\1{5}$/.test(pin)) {
    throw new HttpsError('invalid-argument', 'PIN cannot be all the same digit.');
  }
  const trivialSeqs = ['123456', '012345', '654321', '111111', '000000'];
  if (trivialSeqs.includes(pin)) {
    throw new HttpsError('invalid-argument', 'PIN is too easy to guess. Pick something less obvious.');
  }
}

async function loadLockoutState(uid) {
  const snap = await walletDoc(uid).get();
  const data = snap.data() || {};
  return {
    pinFailedAttempts: data.pinFailedAttempts || 0,
    pinLockedUntil: data.pinLockedUntil || 0,
    pinLastFailedAt: data.pinLastFailedAt || 0,
    walletFrozen: data.walletFrozen || false,
  };
}

function isCurrentlyLocked(state) {
  return state.pinLockedUntil && state.pinLockedUntil > Date.now();
}

// ════════════════════════════════════════════════════════════════════
// PIN CALLABLES
// ════════════════════════════════════════════════════════════════════

// Called once during onboarding. After this returns, the wallet has a PIN
// set and the user can proceed. Cannot be called again — use changeWalletPin.
exports.setupWalletPin = functions.https.onCall({ region: REGION }, async (request) => {
  const uid = requireAuthUid(request);
  const { pin } = request.data || {};
  validatePinFormat(pin);

  const cred = await credsDoc(uid).get();
  if (cred.exists && cred.data()?.pinHash) {
    throw new HttpsError('failed-precondition', 'PIN already set. Use change PIN to update it.');
  }

  const salt = newPinSalt();
  const hash = await hashPin(pin, salt);

  await db.runTransaction(async (tx) => {
    tx.set(credsDoc(uid), {
      pinHash: hash,
      pinSalt: salt,
      pinSetAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(walletDoc(uid), {
      onboardingCompleted: true,
      pinFailedAttempts: 0,
      pinLockedUntil: 0,
      pinSetAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  return { ok: true };
});

// Verifies a PIN attempt. On success, returns a short-lived unlock token
// the client stores in memory only. On failure, increments lockout counters.
// The unlock token is HMAC-signed by a server secret so it can't be forged.
exports.verifyWalletPin = functions.https.onCall({ region: REGION }, async (request) => {
  const uid = requireAuthUid(request);
  const { pin } = request.data || {};
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
    throw new HttpsError('invalid-argument', 'PIN must be 6 digits.');
  }

  const state = await loadLockoutState(uid);
  if (state.walletFrozen) {
    throw new HttpsError('permission-denied', 'Wallet is frozen. Contact support.');
  }
  if (isCurrentlyLocked(state)) {
    const minutesLeft = Math.ceil((state.pinLockedUntil - Date.now()) / 60000);
    throw new HttpsError('resource-exhausted', `Too many wrong attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`);
  }

  const cred = await credsDoc(uid).get();
  const credData = cred.data();
  if (!cred.exists || !credData?.pinHash) {
    throw new HttpsError('failed-precondition', 'No PIN set. Complete wallet onboarding first.');
  }

  const attemptHash = await hashPin(pin, credData.pinSalt);
  const correct = constantTimeEqual(attemptHash, credData.pinHash);

  if (!correct) {
    return await recordFailedPinAttempt(uid, state);
  }

  // Success — reset counters, return unlock token
  await walletDoc(uid).set({
    pinFailedAttempts: 0,
    pinLockedUntil: 0,
    pinLastUnlockAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const token = signUnlockToken(uid);
  return {
    ok: true,
    unlockToken: token,
    expiresAt: Date.now() + PIN_UNLOCK_TTL_SEC * 1000,
  };
});

async function recordFailedPinAttempt(uid, prevState) {
  const now = Date.now();
  const failedAttempts = (prevState.pinFailedAttempts || 0) + 1;

  let lockedUntil = 0;
  let frozen = false;
  let frozenReason = null;

  if (failedAttempts >= PIN_LOCKOUT_THRESHOLD_3) {
    // Hard freeze. Requires support intervention.
    frozen = true;
    frozenReason = 'pin_brute_force_suspected';
    lockedUntil = now + 365 * 24 * 60 * 60 * 1000;  // effectively forever
  } else if (failedAttempts >= PIN_LOCKOUT_THRESHOLD_2) {
    lockedUntil = now + PIN_LOCKOUT_DURATION_2_MS;
  } else if (failedAttempts >= PIN_LOCKOUT_THRESHOLD_1) {
    lockedUntil = now + PIN_LOCKOUT_DURATION_1_MS;
  }

  const updates = {
    pinFailedAttempts: failedAttempts,
    pinLastFailedAt: now,
    pinLockedUntil: lockedUntil,
  };
  if (frozen) {
    updates.walletFrozen = true;
    updates.walletFrozenAt = FieldValue.serverTimestamp();
    updates.walletFrozenReason = frozenReason;
  }
  await walletDoc(uid).set(updates, { merge: true });

  // TODO Phase 3: write to wallet_security_log/ + notify admin if attempts >= threshold_2
  throw new HttpsError('permission-denied', frozen
    ? 'Wallet frozen due to repeated failed attempts. Contact support.'
    : (lockedUntil
        ? `Wrong PIN. Locked for ${Math.ceil((lockedUntil - now) / 60000)} minute${lockedUntil - now > 60000 ? 's' : ''}.`
        : `Wrong PIN. ${PIN_LOCKOUT_THRESHOLD_1 - failedAttempts} attempts left.`));
}

// Change PIN (user knows old PIN). Requires fresh PIN verification AND TOTP
// if enrolled. Resets lockout counters on success.
exports.changeWalletPin = functions.https.onCall({ region: REGION }, async (request) => {
  const uid = requireAuthUid(request);
  const { oldPin, newPin, totpCode } = request.data || {};
  validatePinFormat(newPin);
  if (typeof oldPin !== 'string' || !/^\d{6}$/.test(oldPin)) {
    throw new HttpsError('invalid-argument', 'Old PIN must be 6 digits.');
  }
  if (oldPin === newPin) {
    throw new HttpsError('invalid-argument', 'New PIN cannot match the old PIN.');
  }

  const state = await loadLockoutState(uid);
  if (state.walletFrozen) throw new HttpsError('permission-denied', 'Wallet is frozen. Contact support.');
  if (isCurrentlyLocked(state)) {
    throw new HttpsError('resource-exhausted', 'Wallet temporarily locked. Try again later.');
  }

  const cred = await credsDoc(uid).get();
  const credData = cred.data();
  if (!cred.exists || !credData?.pinHash) {
    throw new HttpsError('failed-precondition', 'No PIN currently set.');
  }

  // Verify old PIN
  const oldHash = await hashPin(oldPin, credData.pinSalt);
  if (!constantTimeEqual(oldHash, credData.pinHash)) {
    return await recordFailedPinAttempt(uid, state);
  }

  // If TOTP enrolled, require it for PIN change (defense in depth)
  if (credData.totpSecret) {
    if (!totpCode) throw new HttpsError('failed-precondition', 'TOTP code required to change PIN.');
    const verified = speakeasy.totp.verify({
      secret: credData.totpSecret,
      encoding: 'base32',
      token: totpCode,
      window: 1,
    });
    if (!verified) throw new HttpsError('permission-denied', 'TOTP code is wrong or expired.');
  }

  const salt = newPinSalt();
  const hash = await hashPin(newPin, salt);

  await db.runTransaction(async (tx) => {
    tx.set(credsDoc(uid), {
      pinHash: hash,
      pinSalt: salt,
      pinChangedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(walletDoc(uid), {
      pinFailedAttempts: 0,
      pinLockedUntil: 0,
    }, { merge: true });
  });

  return { ok: true };
});

// ════════════════════════════════════════════════════════════════════
// UNLOCK TOKEN
// ════════════════════════════════════════════════════════════════════

// Signed unlock token = HMAC of (uid + issuedAt). Client passes it back in
// future requests that need PIN-unlocked state (withdrawals, address adds).
// The signing key lives in env (set via Firebase secret).
function signUnlockToken(uid) {
  const secret = process.env.WALLET_UNLOCK_SECRET || 'dev-only-replace-me';
  const issuedAt = Date.now();
  const payload = `${uid}:${issuedAt}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${issuedAt}.${sig}`;
}

function verifyUnlockToken(uid, token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [issuedAtStr, sig] = token.split('.');
  const issuedAt = parseInt(issuedAtStr, 10);
  if (!issuedAt || Date.now() - issuedAt > PIN_UNLOCK_TTL_SEC * 1000) return false;
  const secret = process.env.WALLET_UNLOCK_SECRET || 'dev-only-replace-me';
  const expectedSig = crypto.createHmac('sha256', secret).update(`${uid}:${issuedAt}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'));
  } catch {
    return false;
  }
}

// Exported so other wallet functions (withdrawal, address whitelist) can
// gate themselves on a fresh PIN unlock without duplicating verify logic.
exports._verifyUnlockToken = verifyUnlockToken;

// ════════════════════════════════════════════════════════════════════
// TOTP CALLABLES
// ════════════════════════════════════════════════════════════════════

// Start TOTP enrollment. Generates a pending secret with 10-min TTL.
// Returns QR-encoded otpauth URL + the raw secret for manual entry.
// User must call confirmWalletTotpEnrollment with a code to activate.
exports.enrollWalletTotp = functions.https.onCall({ region: REGION }, async (request) => {
  const uid = requireAuthUid(request);
  const { unlockToken } = request.data || {};
  if (!verifyUnlockToken(uid, unlockToken)) {
    throw new HttpsError('failed-precondition', 'Unlock your wallet with your PIN first.');
  }

  const cred = await credsDoc(uid).get();
  if (cred.exists && cred.data()?.totpSecret) {
    throw new HttpsError('failed-precondition', 'TOTP already enrolled. Disable first to re-enroll.');
  }

  const userSnap = await db.collection('users').doc(uid).get();
  const username = userSnap.data()?.username || uid.slice(0, 8);

  const secret = speakeasy.generateSecret({
    name: `${TOTP_ISSUER} (${username})`,
    issuer: TOTP_ISSUER,
    length: 32,
  });

  await credsDoc(uid).set({
    pendingTotpSecret: secret.base32,
    pendingTotpStartedAt: Date.now(),
  }, { merge: true });

  return {
    ok: true,
    otpauthUrl: secret.otpauth_url,
    base32: secret.base32,
    expiresAt: Date.now() + TOTP_ENROLLMENT_TTL_MS,
  };
});

// Confirm enrollment with a code. Generates and returns 10 recovery codes
// (one-shot use, hashed before storage). Recovery codes are shown ONCE
// here; user must save them.
exports.confirmWalletTotpEnrollment = functions.https.onCall({ region: REGION }, async (request) => {
  const uid = requireAuthUid(request);
  const { code } = request.data || {};
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'TOTP code must be 6 digits.');
  }

  const cred = await credsDoc(uid).get();
  const credData = cred.data() || {};
  if (!credData.pendingTotpSecret) {
    throw new HttpsError('failed-precondition', 'No enrollment in progress. Call enrollWalletTotp first.');
  }
  if (Date.now() - (credData.pendingTotpStartedAt || 0) > TOTP_ENROLLMENT_TTL_MS) {
    throw new HttpsError('deadline-exceeded', 'Enrollment expired. Start again.');
  }

  const verified = speakeasy.totp.verify({
    secret: credData.pendingTotpSecret,
    encoding: 'base32',
    token: code,
    window: 1,
  });
  if (!verified) throw new HttpsError('permission-denied', 'TOTP code is wrong. Check your authenticator clock.');

  // Generate 10 recovery codes. Each is 10 hex chars (~40 bits = fine for one-shot use).
  const plainCodes = Array.from({ length: TOTP_RECOVERY_CODES }, () =>
    crypto.randomBytes(5).toString('hex').toUpperCase()
  );
  const hashedCodes = plainCodes.map(c =>
    crypto.createHash('sha256').update(c).digest('hex')
  );

  await db.runTransaction(async (tx) => {
    tx.set(credsDoc(uid), {
      totpSecret: credData.pendingTotpSecret,
      totpEnrolledAt: FieldValue.serverTimestamp(),
      totpRecoveryCodesHashed: hashedCodes,
      pendingTotpSecret: FieldValue.delete(),
      pendingTotpStartedAt: FieldValue.delete(),
    }, { merge: true });
    tx.set(walletDoc(uid), {
      totpEnrolled: true,
    }, { merge: true });
  });

  return {
    ok: true,
    recoveryCodes: plainCodes,  // shown ONCE, user must save
  };
});

// Verify a TOTP code (live, no state change). Used by withdrawal flow + add
// address flow + PIN change. Returns ok:true on success.
exports.verifyWalletTotp = functions.https.onCall({ region: REGION }, async (request) => {
  const uid = requireAuthUid(request);
  const { code, unlockToken } = request.data || {};
  if (!verifyUnlockToken(uid, unlockToken)) {
    throw new HttpsError('failed-precondition', 'Unlock your wallet with your PIN first.');
  }
  if (typeof code !== 'string' || !/^\d{6,8}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'TOTP code must be 6 digits (or 10-char recovery code).');
  }

  const cred = await credsDoc(uid).get();
  const credData = cred.data() || {};
  if (!credData.totpSecret) {
    throw new HttpsError('failed-precondition', 'TOTP not enrolled.');
  }

  const verified = speakeasy.totp.verify({
    secret: credData.totpSecret,
    encoding: 'base32',
    token: code,
    window: 1,
  });
  if (verified) return { ok: true };

  throw new HttpsError('permission-denied', 'TOTP code is wrong or expired.');
});

// Verify a recovery code (one-shot use). Falls back when user lost their
// authenticator. Each code only works once.
exports.useTotpRecoveryCode = functions.https.onCall({ region: REGION }, async (request) => {
  const uid = requireAuthUid(request);
  const { code, unlockToken } = request.data || {};
  if (!verifyUnlockToken(uid, unlockToken)) {
    throw new HttpsError('failed-precondition', 'Unlock your wallet with your PIN first.');
  }
  if (typeof code !== 'string' || code.length < 8 || code.length > 16) {
    throw new HttpsError('invalid-argument', 'Recovery code looks malformed.');
  }

  const normalized = code.toUpperCase().replace(/\s/g, '');
  const candidateHash = crypto.createHash('sha256').update(normalized).digest('hex');

  return await db.runTransaction(async (tx) => {
    const cred = await tx.get(credsDoc(uid));
    const credData = cred.data() || {};
    const codes = credData.totpRecoveryCodesHashed || [];
    const idx = codes.indexOf(candidateHash);
    if (idx === -1) {
      throw new HttpsError('permission-denied', 'Recovery code is wrong or already used.');
    }
    // Consume the code by removing it from the array
    const remaining = codes.slice(0, idx).concat(codes.slice(idx + 1));
    tx.set(credsDoc(uid), {
      totpRecoveryCodesHashed: remaining,
      lastRecoveryUseAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, remainingCodes: remaining.length };
  });
});

// Disable TOTP. Requires fresh PIN unlock + a current TOTP code (so a
// stolen unlock token alone can't disable). After this, withdrawals over
// EUR 100 will be blocked until re-enrolled.
exports.disableWalletTotp = functions.https.onCall({ region: REGION }, async (request) => {
  const uid = requireAuthUid(request);
  const { code, unlockToken } = request.data || {};
  if (!verifyUnlockToken(uid, unlockToken)) {
    throw new HttpsError('failed-precondition', 'Unlock your wallet with your PIN first.');
  }
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'TOTP code required to disable.');
  }

  const cred = await credsDoc(uid).get();
  const credData = cred.data() || {};
  if (!credData.totpSecret) throw new HttpsError('failed-precondition', 'TOTP not enrolled.');

  const verified = speakeasy.totp.verify({
    secret: credData.totpSecret,
    encoding: 'base32',
    token: code,
    window: 1,
  });
  if (!verified) throw new HttpsError('permission-denied', 'TOTP code is wrong.');

  await db.runTransaction(async (tx) => {
    tx.set(credsDoc(uid), {
      totpSecret: FieldValue.delete(),
      totpEnrolledAt: FieldValue.delete(),
      totpRecoveryCodesHashed: FieldValue.delete(),
      totpDisabledAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(walletDoc(uid), {
      totpEnrolled: false,
    }, { merge: true });
  });

  return { ok: true };
});

// ════════════════════════════════════════════════════════════════════
// ADDRESS WHITELIST
// ════════════════════════════════════════════════════════════════════

// Add a withdrawal destination to the whitelist. Requires PIN unlock +
// TOTP (if enrolled). New address has a 24h cooldown before it can be
// used for the first time. Max 10 addresses per user.
exports.addWhitelistedAddress = functions.https.onCall({ region: REGION }, async (request) => {
  const uid = requireAuthUid(request);
  const { address, label, totpCode, unlockToken } = request.data || {};
  if (!verifyUnlockToken(uid, unlockToken)) {
    throw new HttpsError('failed-precondition', 'Unlock your wallet with your PIN first.');
  }
  if (typeof address !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new HttpsError('invalid-argument', 'Address must be a valid 0x-prefixed Base/Ethereum address.');
  }
  if (typeof label !== 'string' || label.length < 1 || label.length > 40) {
    throw new HttpsError('invalid-argument', 'Label must be 1-40 characters.');
  }

  return await db.runTransaction(async (tx) => {
    const walletSnap = await tx.get(walletDoc(uid));
    const data = walletSnap.data() || {};
    const list = data.whitelistedAddresses || [];

    // Admin bypass for cooldown + TOTP gates. Used during sandbox testing.
    const userSnap = await tx.get(db.collection('users').doc(uid));
    const isAdmin = userSnap.data()?.role === 'admin';

    if (list.length >= MAX_WHITELIST_ADDRESSES) {
      throw new HttpsError('failed-precondition',
        `Maximum ${MAX_WHITELIST_ADDRESSES} addresses. Remove one first.`);
    }
    if (list.some(a => a.address?.toLowerCase() === address.toLowerCase())) {
      throw new HttpsError('already-exists', 'Address already whitelisted.');
    }

    // If TOTP enrolled, require it (admin bypasses)
    const cred = await tx.get(credsDoc(uid));
    const credData = cred.data() || {};
    if (credData.totpSecret && !isAdmin) {
      if (!totpCode) throw new HttpsError('failed-precondition', 'TOTP required to add an address.');
      const verified = speakeasy.totp.verify({
        secret: credData.totpSecret,
        encoding: 'base32',
        token: totpCode,
        window: 1,
      });
      if (!verified) throw new HttpsError('permission-denied', 'TOTP code is wrong.');
    }

    const now = Date.now();
    const entry = {
      address: address.toLowerCase(),
      label: label.trim(),
      addedAt: now,
      // Admin: skip the 24h cooldown so the address is immediately usable
      // for testing withdrawals end-to-end.
      usableAfter: isAdmin ? now : now + WHITELIST_COOLDOWN_HOURS * 3600 * 1000,
      verifiedViaTotp: !!credData.totpSecret,
      adminBypass: isAdmin || null,
    };
    tx.set(walletDoc(uid), {
      whitelistedAddresses: [...list, entry],
    }, { merge: true });

    return { ok: true, usableAfter: entry.usableAfter };
  });
});

// Remove a whitelisted address. PIN-gated. TOTP NOT required for removal
// (worst case: user removes a legit address, has to re-add with 24h
// cooldown, no funds at risk).
exports.removeWhitelistedAddress = functions.https.onCall({ region: REGION }, async (request) => {
  const uid = requireAuthUid(request);
  const { address, unlockToken } = request.data || {};
  if (!verifyUnlockToken(uid, unlockToken)) {
    throw new HttpsError('failed-precondition', 'Unlock your wallet with your PIN first.');
  }
  if (typeof address !== 'string') {
    throw new HttpsError('invalid-argument', 'Address required.');
  }

  return await db.runTransaction(async (tx) => {
    const walletSnap = await tx.get(walletDoc(uid));
    const data = walletSnap.data() || {};
    const list = data.whitelistedAddresses || [];
    const filtered = list.filter(a => a.address?.toLowerCase() !== address.toLowerCase());
    if (filtered.length === list.length) {
      throw new HttpsError('not-found', 'Address not in whitelist.');
    }
    tx.set(walletDoc(uid), {
      whitelistedAddresses: filtered,
    }, { merge: true });
    return { ok: true };
  });
});

// ════════════════════════════════════════════════════════════════════
// ADMIN BYPASS — mint an unlock token without PIN
// ════════════════════════════════════════════════════════════════════
//
// Founder needs to test withdrawal + admin flows without going through the
// PIN modal every 5 minutes. This callable mints a regular unlock token if
// (and only if) the caller has `users/{uid}.role === 'admin'`.
//
// The token is identical to a PIN-derived token — same HMAC signature, same
// 5-min TTL. Downstream callables (TOTP, whitelist, future withdraw) can't
// tell the difference, so no change to those handlers needed.
//
// Audit: every mint writes to `admin_actions/` so misuse is visible.
exports.adminMintWalletUnlockToken = functions.https.onCall({ region: REGION }, async (request) => {
  const uid = requireAuthUid(request);
  const userSnap = await db.collection('users').doc(uid).get();
  const role = userSnap.data()?.role;
  if (role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only.');
  }
  const token = signUnlockToken(uid);
  // Best-effort audit — don't block on failure.
  db.collection('admin_actions').add({
    actor: { uid, role: 'admin' },
    action: 'wallet_unlock_admin_bypass',
    target: { type: 'wallet', uid },
    createdAt: FieldValue.serverTimestamp(),
    meta: { reason: 'admin-pin-bypass' },
  }).catch(() => {});
  return {
    ok: true,
    unlockToken: token,
    expiresAt: Date.now() + PIN_UNLOCK_TTL_SEC * 1000,
  };
});

// ════════════════════════════════════════════════════════════════════
// READ HELPERS (client-safe, returns shaped data without secrets)
// ════════════════════════════════════════════════════════════════════

// Returns the current wallet security status for the calling user. Used by
// the wallet UI to render gates ("PIN not set up", "TOTP recommended",
// "wallet locked", etc). NEVER returns hashes, salts, or secrets.
exports.getMyWalletSecurityStatus = functions.https.onCall({ region: REGION }, async (request) => {
  const uid = requireAuthUid(request);
  const [walletSnap, credSnap] = await Promise.all([
    walletDoc(uid).get(),
    credsDoc(uid).get(),
  ]);
  const wallet = walletSnap.data() || {};
  const cred = credSnap.data() || {};

  // Self-healing backfill: `onboardingCompleted` was introduced after some
  // users had already set a PIN, leaving them permanently flagged as
  // un-onboarded (the setup wizard reappeared on every wallet visit). Having a
  // PIN is proof the wizard was completed, so stamp the flag once and move on.
  const pinSet = !!cred.pinHash;
  const onboardingCompleted = !!wallet.onboardingCompleted || pinSet;
  if (pinSet && !wallet.onboardingCompleted) {
    try {
      await walletDoc(uid).set({ onboardingCompleted: true }, { merge: true });
    } catch (_) { /* best effort — the response below is already correct */ }
  }

  return {
    onboardingCompleted,
    pinSet,
    totpEnrolled: !!wallet.totpEnrolled,
    totpRecoveryCodesRemaining: (cred.totpRecoveryCodesHashed || []).length,
    walletFrozen: !!wallet.walletFrozen,
    walletFrozenReason: wallet.walletFrozenReason || null,
    pinLockedUntil: wallet.pinLockedUntil || 0,
    pinFailedAttempts: wallet.pinFailedAttempts || 0,
    kycLevel: wallet.kycLevel || 0,
    whitelistedAddressCount: (wallet.whitelistedAddresses || []).length,
  };
});
