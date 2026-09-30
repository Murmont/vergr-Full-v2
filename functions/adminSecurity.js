// Admin security primitives — used by every privileged callable.
//
// Spec: CLAUDE.md → "🚨 Security hardening" (Tier 1).
//
// Exports
//   requireAdmin(uid)                            — throws unless caller has role: 'admin'
//   requireFreshStepUp(uid, maxAgeSec?)          — throws unless the admin re-verified
//                                                  TOTP within the window (default 5 min)
//   adminRateLimit(uid, action, opts)            — non-transactional Firestore-counter limiter
//   auditAdminAction(payload)                    — append-only write to admin_actions/
//   guardedAdmin(opts, handler) → onCall wrapper — bundles all three above
//
// TOTP callables exported:
//   enrollAdminTotp           — generates a pending secret, returns QR/secret to client
//   confirmAdminTotpEnrollment — verifies a code, activates the secret
//   verifyAdminTotp           — sets `lastStepUpAt` on success
//   disableAdminTotp          — owner can disable (audit logged) after step-up
//   getMyAdminSecurityStatus  — returns { enrolled, lastStepUpAt, enrolledAt }

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const speakeasy = require('speakeasy');
const crypto = require('crypto');
const { isOperator, requireOperatorSession } = require('./operator');
const { authEmailFor } = require('./authEmails');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

const DEFAULT_STEP_UP_WINDOW_SEC = 300; // 5 minutes
const TOTP_ISSUER = 'VERGR Admin';
const ENROLLMENT_TTL_MS = 10 * 60 * 1000; // 10 minutes to finish setup
const RECOVERY_CODES = 10; // same shape as accountSecurity.js: 10 hex chars, hashed, one use each

// ════════════════════════════════════════════════════════════════════
// REQUIREMENT GUARDS
// ════════════════════════════════════════════════════════════════════

// The admin is the OPERATOR (functions/operator.js): a Firebase Auth custom claim
// on a sign-in with no Vergr profile, and every call needs a live authenticator
// session. The users/{uid}.role === 'admin' path below is the TRANSITION path
// for @Vergr while Vergr Admin is being set up, and is removed once the
// Operator is verified end to end.
async function requireAdmin(uid) {
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in.');
  if (await isOperator(uid)) {
    await requireOperatorSession(uid);
    return { operator: true };
  }
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists || snap.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only.');
  }
  return snap.data();
}

// Identity only, NO session requirement. Used by the authenticator callables
// themselves, which are how a session is opened in the first place.
// Who may touch the admin SECURITY surface at all (enroll an authenticator,
// step up, read their own status). Deliberately wider than requireAdmin: a
// sub-admin has to be able to set up 2FA BEFORE any guarded call will let them
// through, or they can never satisfy the guard.
//
// ⚠⚠ THE SUB-ADMIN BRANCH IS NOT OPTIONAL. `users/{uid}.role` no longer exists
// on any account (stripped 2026-09-20), so without it this function admits the
// operator and nobody else, and an invited sub-admin cannot even enroll.
//
// ⚠ It does NOT read users/{uid}. A sub-admin may be a profile-less ops account
// exactly like the operator, which is the whole point of Vergr Admin.
async function requireAdminIdentity(uid) {
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in.');
  if (await isOperator(uid)) return { operator: true };
  const sub = await db.collection('admin_users').doc(uid).get();
  // 'pending_2fa' is admitted HERE ONLY: it is an accepted sub-admin who has
  // not finished authenticator setup, and enrolling is exactly what this
  // function exists to allow. requireAdminScreen still refuses them.
  const subStatus = sub.exists ? sub.data()?.status : null;
  if (subStatus === 'active' || subStatus === 'pending_2fa') {
    return { subAdmin: true, pending2fa: subStatus === 'pending_2fa', allowedScreens: sub.data().allowedScreens || [] };
  }
  const snap = await db.collection('users').doc(uid).get();
  // A Vanguard moderator is admitted here, and HERE ONLY, so they can enroll
  // and verify the authenticator Vergr Vanguard demands (2026-09-21). This
  // function grants no admin power: every admin callable goes through
  // requireAdmin / requireAdminScreen, which still refuse them.
  const vg = vanguardOf(snap.exists ? snap.data() : null);
  if (vg) return { vanguard: true, rank: vg.rank };
  if (!snap.exists || snap.data()?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only.');
  }
  return snap.data();
}

// An ACTIVE Vanguard member's { rank, status }, or null. Mirrors isVanguard()
// in src/utils/vanguard.js: a suspended or retired member is not one. A
// recruit IS one (read-only, but they still see reports, so they need 2FA).
function vanguardOf(u) {
  const v = u?.vanguard;
  if (!v?.rank || v.status === 'suspended' || v.status === 'retired') return null;
  return { rank: v.rank, status: v.status || 'active' };
}

async function isActiveVanguard(uid) {
  if (!uid) return false;
  const snap = await db.collection('users').doc(uid).get();
  return !!vanguardOf(snap.exists ? snap.data() : null);
}

// True for an accepted, still-active sub-admin. One read, and only ever reached
// when the caller is not the operator.
async function isActiveSubAdmin(uid) {
  if (!uid) return false;
  const snap = await db.collection('admin_users').doc(uid).get();
  return snap.exists && snap.data()?.status === 'active';
}

// Reads admin_security/{uid} directly — never trusts a client-writable field.
// If the admin hasn't enrolled TOTP yet, the step-up requirement passes (so
// we don't lock out the founder during the initial setup window). Once
// enrolled, every step-up-required action demands a fresh verification.
async function requireFreshStepUp(uid, maxAgeSec = DEFAULT_STEP_UP_WINDOW_SEC) {
  const secSnap = await db.collection('admin_security').doc(uid).get();
  if (!secSnap.exists || !secSnap.data()?.enrolled) {
    // ⚠ FAILS CLOSED for the operator AND for a sub-admin. A sub-admin can ban
    // and mute real people on the screens they hold, so "no authenticator yet"
    // must never be a way to skip the check. The only path that still passes
    // unenrolled is the legacy users/{uid}.role one, which no account has.
    if (await isOperator(uid) || await isActiveSubAdmin(uid)) {
      throw new HttpsError('failed-precondition',
        'Authenticator not set up. Finish setup in Vergr Admin first.',
        { code: 'TOTP_ENROLL_REQUIRED' });
    }
    // Same for a Vanguard moderator: they ban and mute real people.
    if (await isActiveVanguard(uid)) {
      throw new HttpsError('failed-precondition',
        'Authenticator not set up. Finish setup in Vergr Vanguard first.',
        { code: 'TOTP_ENROLL_REQUIRED' });
    }
    return { stepUpEnforced: false };
  }
  const last = secSnap.data().lastStepUpAt;
  const lastMs = last && typeof last.toMillis === 'function' ? last.toMillis() : 0;
  const ageSec = (Date.now() - lastMs) / 1000;
  if (ageSec > maxAgeSec) {
    throw new HttpsError(
      'failed-precondition',
      `Admin step-up required. Re-verify your TOTP code (window: ${maxAgeSec}s).`,
      { code: 'STEP_UP_REQUIRED', maxAgeSec }
    );
  }
  return { stepUpEnforced: true, lastStepUpAt: lastMs };
}

// ════════════════════════════════════════════════════════════════════
// RATE LIMITER (non-transactional — for admin callables that aren't
// already inside a transaction). Stored at the same path used by
// economy.js so reads/writes never collide.
// ════════════════════════════════════════════════════════════════════
//
// opts = { perHour?, perDay?, perMonth? }
// Throws HttpsError('resource-exhausted') if any limit is exceeded.
//
// Why not reuse economy.checkRateLimit? It requires a transaction
// context. Admin callables (setBotsPaused, etc.) are usually one-shot
// writes that don't need a transaction. This helper does its own
// best-effort atomic increment via FieldValue.increment.

async function adminRateLimit(uid, action, opts) {
  if (!uid || !action) return;
  const now = new Date();
  const hourKey  = now.toISOString().slice(0, 13).replace(/[-T:]/g, '');
  const dayKey   = now.toISOString().slice(0, 10).replace(/-/g, '');
  const monthKey = now.toISOString().slice(0, 7).replace(/-/g, '');

  const checks = [];
  if (opts.perHour)  checks.push({ key: `h_${hourKey}`,  limit: opts.perHour,  label: 'hour' });
  if (opts.perDay)   checks.push({ key: `d_${dayKey}`,   limit: opts.perDay,   label: 'day' });
  if (opts.perMonth) checks.push({ key: `m_${monthKey}`, limit: opts.perMonth, label: 'month' });

  for (const c of checks) {
    const ref = db.collection('rate_limits').doc(uid).collection(action).doc(c.key);
    // Read current count.
    const snap = await ref.get();
    const count = snap.exists ? (snap.data().count || 0) : 0;
    if (count >= c.limit) {
      throw new HttpsError('resource-exhausted',
        `Rate limit reached (${c.limit} ${action.replace(/_/g, ' ')}/${c.label}). Slow down.`,
        { action, limit: c.limit, period: c.label });
    }
  }
  // Now increment all counters. (Read-then-write is slightly racy in a
  // burst, but admin callables aren't called at high concurrency by one
  // user — the small window is acceptable.)
  await Promise.all(checks.map(c => {
    const ref = db.collection('rate_limits').doc(uid).collection(action).doc(c.key);
    return ref.set({
      count: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }));
}

// ════════════════════════════════════════════════════════════════════
// AUDIT WRITER — append-only row in admin_actions/
// ════════════════════════════════════════════════════════════════════
//
// payload = {
//   actor:  uid,
//   action: 'set_bots_paused' | 'change_vanguard_rank' | ...
//   target: { type?, id? },
//   before: any,
//   after:  any,
//   reason: string?,
//   ip:     string?,   // from req.rawRequest?.ip
//   userAgent: string?,
//   stepUpEnforced: bool,
//   stepUpFresh:    bool,
//   meta: any,         // arbitrary extra context
// }
//
// Returns the new doc ref.

async function auditAdminAction(payload) {
  const ref = db.collection('admin_actions').doc();
  await ref.set({
    actor:           payload.actor || null,
    action:          payload.action || 'unknown',
    target:          payload.target || null,
    before:          payload.before !== undefined ? payload.before : null,
    after:           payload.after  !== undefined ? payload.after  : null,
    reason:          payload.reason || null,
    ip:              payload.ip || null,
    userAgent:       payload.userAgent || null,
    stepUpEnforced:  !!payload.stepUpEnforced,
    stepUpFresh:     !!payload.stepUpFresh,
    meta:            payload.meta || null,
    createdAt:       FieldValue.serverTimestamp(),
  });
  return ref;
}

// Extract IP + UA from a v2 onCall request (best-effort — Firebase puts
// them on different paths depending on transport).
function extractRequestMeta(request) {
  const raw = request.rawRequest;
  return {
    ip: raw?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
         || raw?.ip
         || raw?.socket?.remoteAddress
         || null,
    userAgent: raw?.headers?.['user-agent'] || null,
  };
}

// ════════════════════════════════════════════════════════════════════
// guardedAdmin — wraps an onCall handler with admin gate + step-up +
// rate-limit + automatic audit row on success.
// ════════════════════════════════════════════════════════════════════
//
// Usage:
//   exports.setBotsPaused = guardedAdmin({
//     action: 'set_bots_paused',
//     requireStepUp: true,
//     stepUpWindowSec: 300,
//     rateLimit: { perHour: 30, perDay: 100 },
//   }, async (request, ctx) => {
//     const { paused } = request.data || {};
//     await db.collection('app_config').doc('general').set({ botsPaused: !!paused }, { merge: true });
//     return {
//       result: { ok: true, paused: !!paused },
//       audit:  { target: { type: 'app_config', id: 'general' }, before: ctx.before, after: { botsPaused: !!paused } },
//     };
//   });
//
// The handler returns either:
//   - a plain object (treated as result, no extra audit fields), or
//   - { result, audit: { target?, before?, after?, reason?, meta? } } where
//     `audit` is merged into the audit row.

function guardedAdmin(opts, handler) {
  const {
    action,
    requireStepUp = false,
    stepUpWindowSec = DEFAULT_STEP_UP_WINDOW_SEC,
    rateLimit = null,
  } = opts;
  if (!action) throw new Error('guardedAdmin: opts.action is required');

  return functions.https.onCall({ region: REGION, cors: true }, async (request) => {
    const uid = request.auth?.uid;
    await requireAdmin(uid);

    // Rate limit BEFORE step-up so a flooded caller can't enumerate.
    if (rateLimit) await adminRateLimit(uid, action, rateLimit);

    let stepUp = { stepUpEnforced: false };
    if (requireStepUp) {
      stepUp = await requireFreshStepUp(uid, stepUpWindowSec);
    }

    const meta = extractRequestMeta(request);
    let result, auditExtras = {};
    try {
      const ret = await handler(request, { uid, stepUp, meta });
      if (ret && typeof ret === 'object' && 'result' in ret && 'audit' in ret) {
        result = ret.result;
        auditExtras = ret.audit || {};
      } else {
        result = ret;
      }
    } catch (err) {
      // Failed actions still get audited so we see attempted abuse.
      await auditAdminAction({
        actor: uid,
        action: `${action}_failed`,
        ip: meta.ip,
        userAgent: meta.userAgent,
        stepUpEnforced: requireStepUp,
        stepUpFresh: !!stepUp.stepUpEnforced,
        meta: { errorCode: err.code || 'unknown', errorMessage: err.message },
      }).catch(() => {});
      throw err;
    }

    await auditAdminAction({
      actor: uid,
      action,
      target: auditExtras.target || null,
      before: auditExtras.before,
      after:  auditExtras.after,
      reason: auditExtras.reason || null,
      ip: meta.ip,
      userAgent: meta.userAgent,
      stepUpEnforced: requireStepUp,
      stepUpFresh: !!stepUp.stepUpEnforced,
      meta: auditExtras.meta || null,
    });
    return result;
  });
}

// ════════════════════════════════════════════════════════════════════
// TOTP ENROLLMENT + STEP-UP CALLABLES
// ════════════════════════════════════════════════════════════════════
//
// Flow:
//   1. Admin opens Settings → Admin Security
//   2. Calls enrollAdminTotp → server generates secret + otpauthUrl,
//      stores PENDING doc with 10-min TTL
//   3. Client renders QR (otpauthUrl), admin scans in Authenticator app
//   4. Client calls confirmAdminTotpEnrollment({ code })
//   5. If code valid → server promotes pending → confirmed, sets enrolled=true
//
// To step up before a destructive action:
//   1. Client calls verifyAdminTotp({ code })
//   2. Server sets admin_security/{uid}.lastStepUpAt = now
//   3. Client retries the original action — the guarded callable now sees
//      a fresh step-up timestamp.

exports.enrollAdminTotp = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    const who = await requireAdminIdentity(uid);

    // If already enrolled, you must disable first (which requires step-up).
    const cur = await db.collection('admin_security').doc(uid).get();
    if (cur.exists && cur.data()?.enrolled) {
      throw new HttpsError('failed-precondition',
        'TOTP already enrolled. Disable first if you need to re-enroll.');
    }

    // The label the authenticator app shows. A Vanguard moderator's entry must
    // not read "VERGR Admin": they hold no admin power.
    const issuer = who?.vanguard ? 'Vergr Vanguard' : TOTP_ISSUER;
    const secret = speakeasy.generateSecret({
      length: 20,
      name: `${issuer} (${uid.slice(0, 6)})`,
      issuer,
    });

    await db.collection('admin_totp_enrollment').doc(uid).set({
      secret: secret.base32,
      otpauthUrl: secret.otpauth_url,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + ENROLLMENT_TTL_MS),
    });

    return {
      ok: true,
      otpauthUrl: secret.otpauth_url,
      secret: secret.base32, // for manual entry on devices without a camera
      expiresInSec: Math.floor(ENROLLMENT_TTL_MS / 1000),
    };
  }
);

exports.confirmAdminTotpEnrollment = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminIdentity(uid);
    const { code } = request.data || {};
    if (!code || typeof code !== 'string') {
      throw new HttpsError('invalid-argument', 'code (string) required.');
    }

    const pendingRef = db.collection('admin_totp_enrollment').doc(uid);
    const pending = await pendingRef.get();
    if (!pending.exists) {
      throw new HttpsError('not-found', 'No pending enrollment. Call enrollAdminTotp first.');
    }
    const data = pending.data();
    const expMs = data.expiresAt && typeof data.expiresAt.toMillis === 'function'
      ? data.expiresAt.toMillis() : 0;
    if (Date.now() > expMs) {
      await pendingRef.delete();
      throw new HttpsError('deadline-exceeded', 'Enrollment expired. Start over.');
    }

    const verified = speakeasy.totp.verify({
      secret: data.secret,
      encoding: 'base32',
      token: code,
      window: 1, // ±30s tolerance for clock drift
    });
    if (!verified) {
      throw new HttpsError('permission-denied', 'Invalid code. Check your authenticator app.');
    }

    // Promote pending → confirmed, with one-use recovery codes so a lost or
    // broken phone does not lock the Operator out. Shown once, stored hashed.
    const recoveryCodes = Array.from({ length: RECOVERY_CODES }, () =>
      crypto.randomBytes(5).toString('hex').toUpperCase());
    await db.collection('admin_security').doc(uid).set({
      secret: data.secret,
      enrolled: true,
      enrolledAt: FieldValue.serverTimestamp(),
      lastStepUpAt: FieldValue.serverTimestamp(), // enrollment counts as a step-up
      recoveryCodesHashed: recoveryCodes.map((c) => crypto.createHash('sha256').update(c).digest('hex')),
    }, { merge: true });
    await pendingRef.delete();

    // A sub-admin becomes ACTIVE here, never on accepting the invite. See the
    // note in adminAccess.acceptAdminInvite for why that ordering matters.
    const subRef = db.collection('admin_users').doc(uid);
    const sub = await subRef.get();
    if (sub.exists && sub.data()?.status === 'pending_2fa') {
      await subRef.set({ status: 'active', activatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }

    // Audit row — direct write since guardedAdmin would loop on requireStepUp.
    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'totp_enroll',
      ip: meta.ip,
      userAgent: meta.userAgent,
      stepUpEnforced: true,
      stepUpFresh: true,
    });

    return { ok: true, enrolled: true, recoveryCodes };
  }
);

exports.verifyAdminTotp = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminIdentity(uid);
    const { code } = request.data || {};
    if (!code || typeof code !== 'string') {
      throw new HttpsError('invalid-argument', 'code (string) required.');
    }
    const normalized = code.toUpperCase().replace(/\s/g, '');

    // Light rate limit on TOTP attempts — stops online brute force.
    await adminRateLimit(uid, 'totp_verify', { perHour: 20, perDay: 100 });

    const secRef = db.collection('admin_security').doc(uid);
    const sec = await secRef.get();
    if (!sec.exists || !sec.data()?.enrolled) {
      throw new HttpsError('failed-precondition', 'TOTP not enrolled. Enroll first.');
    }

    // A recovery code (10 hex characters) is consumed once and opens a session
    // exactly like an authenticator code.
    if (/^[0-9A-F]{10}$/.test(normalized) && !/^\d{6}$/.test(normalized)) {
      const candidate = crypto.createHash('sha256').update(normalized).digest('hex');
      const used = await db.runTransaction(async (tx) => {
        const s = await tx.get(secRef);
        const codes = s.data()?.recoveryCodesHashed || [];
        const idx = codes.indexOf(candidate);
        if (idx === -1) return null;
        const remaining = codes.slice(0, idx).concat(codes.slice(idx + 1));
        tx.set(secRef, { recoveryCodesHashed: remaining, lastStepUpAt: FieldValue.serverTimestamp() }, { merge: true });
        return remaining.length;
      });
      if (used !== null) {
        const meta = extractRequestMeta(request);
        await auditAdminAction({ actor: uid, action: 'totp_recovery_code_used', ip: meta.ip, userAgent: meta.userAgent,
          stepUpEnforced: true, stepUpFresh: true, meta: { remaining: used } });
        return { ok: true, usedRecovery: true, remainingCodes: used, lastStepUpAt: Date.now() };
      }
    }

    const verified = speakeasy.totp.verify({
      secret: sec.data().secret,
      encoding: 'base32',
      token: normalized,
      window: 1,
    });
    if (!verified) {
      // Audit the failed attempt — repeated failures are an alert signal.
      const meta = extractRequestMeta(request);
      await auditAdminAction({
        actor: uid,
        action: 'totp_verify_failed',
        ip: meta.ip,
        userAgent: meta.userAgent,
        stepUpEnforced: false,
        stepUpFresh: false,
      });
      throw new HttpsError('permission-denied', 'Invalid code.');
    }

    await secRef.set({ lastStepUpAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true, lastStepUpAt: Date.now() };
  }
);

exports.disableAdminTotp = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdmin(uid);
    // Disabling is destructive — require a fresh step-up just like other
    // privileged actions. Founder must verify TOTP, THEN disable.
    const stepUp = await requireFreshStepUp(uid);

    const before = await db.collection('admin_security').doc(uid).get();
    await db.collection('admin_security').doc(uid).delete().catch(() => {});

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'totp_disable',
      ip: meta.ip,
      userAgent: meta.userAgent,
      stepUpEnforced: true,
      stepUpFresh: !!stepUp.stepUpEnforced,
      before: before.exists ? { enrolled: true, enrolledAt: before.data().enrolledAt } : null,
      after: null,
    });

    return { ok: true, enrolled: false };
  }
);

// ── Vergr Admin update ticket ─────────────────────────────────────────
// The admin installer and its update manifest are served from box 1 at
// sfu.vergr.app/ops/, and nginx hands them only to a request carrying a live
// ticket (infra/ops-auth). The ticket is minted HERE, for the operator or an
// ACTIVE sub-admin, and nowhere else.
//
// ⚠ It is deliberately NOT the Firebase ID token. An ID token sent to the box
// would be a live admin session sitting on a server that is not backed up and
// runs a dozen other services. A ticket downloads a signed installer for 15
// minutes and does nothing else.
//
// The HMAC key lives at ops_config/update_ticket. No firestore rule matches
// ops_config, so every client read is denied; it is read here once per warm
// instance.
const UPDATE_TICKET_TTL_MS = 15 * 60 * 1000;
let updateTicketKey = null;
async function mintUpdateTicket(uid, scope = 'admin') {
  try {
    if (!updateTicketKey) {
      const snap = await db.collection('ops_config').doc('update_ticket').get();
      const hex = snap.exists ? String(snap.data()?.key || '') : '';
      if (!/^[0-9a-f]{64,}$/.test(hex)) return null;
      updateTicketKey = Buffer.from(hex, 'hex');
    }
    // v2 carries a SCOPE, and vergr-ops-auth only honours it under
    // /ops/<scope>/. So a Vanguard ticket cannot fetch the admin console and an
    // admin ticket cannot fetch Vergr Vanguard. v1 (no scope) is admin-only.
    if (!/^(admin|vanguard)$/.test(scope)) return null;
    const body = `v2.${scope}.${uid}.${Date.now() + UPDATE_TICKET_TTL_MS}`;
    const sig = crypto.createHmac('sha256', updateTicketKey).update(body).digest('hex');
    return `${body}.${sig}`;
  } catch {
    return null; // an update check must never break sign-in
  }
}

exports.getMyAdminSecurityStatus = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in.');

    // ⚠ THIS ONE ANSWERS INSTEAD OF REFUSING, and it has to. Vergr Admin calls
    // it to decide which screen to draw, including for someone who has been
    // invited but has accepted nothing yet: refusing them would leave the app
    // with no way to offer the Accept step. It discloses only facts about the
    // CALLER'S OWN account, so there is nothing here to leak.
    const operator = await isOperator(uid);
    const subSnap = operator ? null : await db.collection('admin_users').doc(uid).get();
    // pending_2fa counts as a sub-admin HERE so Vergr Admin draws the
    // authenticator setup step; every guarded call still refuses them.
    const subStatus = subSnap?.exists ? subSnap.data()?.status : null;
    const subAdmin = subStatus === 'active' || subStatus === 'pending_2fa';
    const allowedScreens = subAdmin ? (subSnap.data().allowedScreens || []) : (operator ? ['*'] : []);

    // Vergr Vanguard asks the same question. One users read, only for a caller
    // who is not the operator (the operator has no users document).
    let vanguard = null;
    if (!operator) {
      const u = await db.collection('users').doc(uid).get();
      vanguard = vanguardOf(u.exists ? u.data() : null);
    }
    // The operator gets a Vanguard ticket too: founder oversight opens Vergr
    // Vanguard as a synthetic Overseer (functions/vanguard.js loadActor).
    const vanguardTicket = (operator || vanguard) ? await mintUpdateTicket(uid, 'vanguard') : null;

    let pendingInvite = false;
    if (!operator && !subAdmin) {
      const email = (await authEmailFor(uid) || '').toLowerCase();
      if (email) {
        const inv = await db.collection('admin_invites')
          .where('email', '==', email).where('status', '==', 'pending').limit(1).get();
        pendingInvite = !inv.empty
          && Date.now() <= (inv.docs[0].data().expiresAt?.toMillis?.() || 0);
      }
      if (!pendingInvite && !vanguard) return { admin: false, operator: false, subAdmin: false, pendingInvite: false, vanguard: null };
    }

    // Only the operator and an ACTIVE sub-admin may download the console.
    const updateTicket = (operator || subStatus === 'active') ? await mintUpdateTicket(uid, 'admin') : null;
    const base = { admin: true, operator, subAdmin, subStatus, allowedScreens, pendingInvite, updateTicket, vanguard, vanguardTicket };
    const snap = await db.collection('admin_security').doc(uid).get();
    if (!snap.exists) return { ...base, admin: operator || subAdmin, enrolled: false };
    const d = snap.data();
    const toMs = (t) => (t && typeof t.toMillis === 'function') ? t.toMillis() : null;
    return {
      ...base,
      admin: operator || subAdmin,
      enrolled: !!d.enrolled,
      enrolledAt:    toMs(d.enrolledAt),
      lastStepUpAt:  toMs(d.lastStepUpAt),
      recoveryCodesRemaining: (d.recoveryCodesHashed || []).length,
    };
  }
);

// Periodic cleanup of expired pending enrollments. Cheap, runs hourly.
const defer = (_opts, fn) => fn; // cron-consolidation shim (see index.js cronDaily)
exports.cleanupExpiredTotpEnrollments = defer(
  { region: REGION, schedule: 'every 60 minutes' },
  async () => {
    const now = new Date();
    const snap = await db.collection('admin_totp_enrollment')
      .where('expiresAt', '<', now)
      .limit(100)
      .get();
    const batch = db.batch();
    snap.forEach(doc => batch.delete(doc.ref));
    if (!snap.empty) await batch.commit();
    return null;
  }
);

// ════════════════════════════════════════════════════════════════════
// Exports for use by other server modules.
// ════════════════════════════════════════════════════════════════════

module.exports.requireAdmin = requireAdmin;
module.exports.requireAdminIdentity = requireAdminIdentity;
module.exports.isActiveVanguard = isActiveVanguard;
module.exports.requireFreshStepUp = requireFreshStepUp;
module.exports.adminRateLimit = adminRateLimit;
module.exports.auditAdminAction = auditAdminAction;
module.exports.extractRequestMeta = extractRequestMeta;
module.exports.guardedAdmin = guardedAdmin;
module.exports.DEFAULT_STEP_UP_WINDOW_SEC = DEFAULT_STEP_UP_WINDOW_SEC;
