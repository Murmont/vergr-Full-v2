// Admin access control — founder-invited sub-admins with per-screen scopes.
//
// Two-tier model:
//   Founder         users/{uid}.role === 'admin'        — implicit full access ('*')
//   Sub-admin       admin_users/{uid}.status === 'active' — scoped to allowedScreens[]
//
// Founder-only callables manage sub-admins:
//   inviteAdmin({ email, allowedScreens })       create pending invite
//   revokeAdminInvite({ inviteId })              cancel pending invite
//   setAdminScreens({ uid, allowedScreens })     edit a sub-admin's scopes
//   revokeAdminAccess({ uid })                   remove a sub-admin entirely
//   listAdmins                                   roster + pending invites
//
// Invitee callable (gated to the invited email):
//   acceptAdminInvite({ inviteId })              promote to active sub-admin
//
// Server helper exported for use by every other privileged callable:
//   requireAdminScreen(uid, screen) → { isFounder, allowedScreens }
//     Throws permission-denied if the caller isn't a founder AND isn't a
//     sub-admin with that screen in allowedScreens.
//
// Spec source: CLAUDE.md ("Admin dashboard — operational metrics", new section
// for invited admin roles).

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { authEmailFor } = require('./authEmails');
const crypto = require('crypto');
const { requireAdmin, requireFreshStepUp, auditAdminAction, extractRequestMeta } = require('./adminSecurity');
const { isOperator, requireOperatorSession, armOperator } = require('./operator');
const { getAuth } = require('firebase-admin/auth');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// Canonical list of screens shown in the admin sidebar. Sub-admins can be
// granted any subset. '*' is the wildcard (founder-equivalent).
const ADMIN_SCREENS = [
  'dashboard',
  'announcements',
  // Granted on its own so someone can answer support tickets and reach nothing
  // else in the admin. Support agents are ordinary accounts, not admins.
  'support',
  'users',
  // 'creators' was in the sidebar (ADMIN_NAV) but never in this list, and
  // normalizeScreens() silently drops anything not listed here, so a sub-admin
  // could never be granted the Creators screen no matter what was ticked.
  'creators',
  'moderation',
  'economy',
  'subscriptions',
  // 'tournaments' removed 2026-08-17 with the admin Tournaments screen. Any
  // sub-admin still carrying the old grant has it dropped by normalizeScreens().
  'config',
  'stream-preview',
  // The call simulator. Its own grant rather than riding 'stream-preview':
  // normalizeScreens() drops anything not listed here, which is exactly how
  // 'creators' sat in the sidebar for months and could never be granted.
  'call-preview',
  'stats',
  'audit',
  'security',     // admin security settings (self-only by default)
  'access',       // manage other admins — founder-only in practice
];

function normalizeScreens(input) {
  if (!Array.isArray(input)) return [];
  if (input.includes('*')) return ['*'];
  const set = new Set();
  for (const s of input) {
    if (typeof s === 'string' && ADMIN_SCREENS.includes(s)) set.add(s);
  }
  return Array.from(set);
}

// ════════════════════════════════════════════════════════════════════
// CORE GUARD — used by every privileged callable in other modules.
// ════════════════════════════════════════════════════════════════════

async function requireAdminScreen(uid, screen) {
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in.');

  // The Operator (functions/operator.js) holds every screen. It is an Auth
  // custom claim with no users/{uid} document at all, so it is checked FIRST:
  // a users doc read would find nothing and fall through to permission-denied.
  if (await isOperator(uid)) {
    await requireOperatorSession(uid);
    return { isFounder: true, isOperator: true, allowedScreens: ['*'] };
  }

  // Founder bypass — role:'admin' on the users doc. TRANSITION path for
  // @Vergr; removed once Vergr Admin is verified end to end.
  const userSnap = await db.collection('users').doc(uid).get();
  if (userSnap.exists && userSnap.data()?.role === 'admin') {
    return { isFounder: true, allowedScreens: ['*'] };
  }

  // Sub-admin check.
  const adminSnap = await db.collection('admin_users').doc(uid).get();
  if (!adminSnap.exists) {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }
  const a = adminSnap.data();
  if (a.status !== 'active') {
    throw new HttpsError('permission-denied', `Admin access ${a.status}.`);
  }
  const allowed = a.allowedScreens || [];
  if (!allowed.includes('*') && !allowed.includes(screen)) {
    throw new HttpsError('permission-denied', `No access to "${screen}".`);
  }
  return { isFounder: false, allowedScreens: allowed };
}

// Founder-only — wraps requireAdmin and adds a strict role check (sub-admins
// can't manage other admins even if granted the 'access' screen).
async function requireFounder(uid) {
  await requireAdmin(uid);
  // requireAdmin already validates role === 'admin'. Nothing else to do.
}

// ════════════════════════════════════════════════════════════════════
// CALLABLES
// ════════════════════════════════════════════════════════════════════

exports.inviteAdmin = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireFounder(uid);
    const { email, allowedScreens, operator } = request.data || {};
    if (!email || typeof email !== 'string') {
      throw new HttpsError('invalid-argument', 'email required.');
    }
    const emailLower = email.trim().toLowerCase();

    // operator: true arms the SUPER ADMIN (functions/operator.js) instead of
    // creating a sub-admin invite. It writes no invite doc and sends no
    // notification: the address belongs to nobody on Vergr and no account for
    // it exists yet. It is hosted here rather than in its own callable because
    // a new Cloud Function is a new Artifact Registry image, i.e. money.
    if (operator === true) {
      const step = await requireFreshStepUp(uid);
      const armed = await armOperator(emailLower, uid);
      const m = extractRequestMeta(request);
      await auditAdminAction({
        actor: uid,
        action: 'operator_arm',
        target: { type: 'operator', id: armed.emailHash },
        after: { expiresAt: armed.expiresAt },
        ip: m.ip,
        userAgent: m.userAgent,
        stepUpEnforced: !!step.stepUpEnforced,
        stepUpFresh: !!step.stepUpEnforced,
      });
      return { ok: true, operator: true, expiresAt: armed.expiresAt };
    }

    const screens = normalizeScreens(allowedScreens);
    if (screens.length === 0) {
      throw new HttpsError('invalid-argument', 'allowedScreens must include at least one screen.');
    }

    // Dedupe — one pending invite per email at a time.
    const existing = await db.collection('admin_invites')
      .where('email', '==', emailLower)
      .where('status', '==', 'pending')
      .limit(1)
      .get();
    if (!existing.empty) {
      throw new HttpsError('already-exists', 'Pending invite already exists for that email.');
    }

    const token = crypto.randomBytes(24).toString('hex');
    const ref = db.collection('admin_invites').doc();
    await ref.set({
      email: emailLower,
      allowedScreens: screens,
      invitedBy: uid,
      token,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'admin_invite',
      target: { type: 'admin_invite', id: ref.id },
      after: { email: emailLower, allowedScreens: screens },
      ip: meta.ip,
      userAgent: meta.userAgent,
      stepUpEnforced: false,
      stepUpFresh: false,
    });

    // ⚠⚠ THIS LOOKUP WAS DEAD AND THE INVITEE WAS NEVER TOLD. It queried
    // `users where email ==`, and that field was removed from the profile doc
    // on 2026-09-16 because users/{uid} is publicly listable, so it matched
    // nothing and notified nobody, silently. The address lives in Auth now.
    //
    // ⚠ The notification is a COURTESY, not the delivery mechanism. A
    // profile-less ops account has no app to read it in, and that is fine:
    // Vergr Admin finds the pending invite from the signed-in address itself,
    // so no invite id ever has to be sent anywhere.
    let inviteeUid = null;
    try { inviteeUid = (await getAuth().getUserByEmail(emailLower)).uid; } catch { /* no account yet */ }
    if (inviteeUid && (await db.collection('users').doc(inviteeUid).get()).exists) {
      await db.collection('notifications').add({
        recipientId: inviteeUid,
        type: 'admin_invite',
        title: 'You\'ve been invited as a VERGR admin',
        body: `Open Vergr Admin and sign in to accept. Scopes: ${screens.join(', ')}`,
        targetId: ref.id,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    return { ok: true, inviteId: ref.id };
  }
);

exports.revokeAdminInvite = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireFounder(uid);
    const { inviteId } = request.data || {};
    if (!inviteId) throw new HttpsError('invalid-argument', 'inviteId required.');
    const ref = db.collection('admin_invites').doc(inviteId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Invite not found.');
    if (snap.data().status !== 'pending') {
      throw new HttpsError('failed-precondition', 'Invite is not pending.');
    }
    await ref.set({
      status: 'revoked',
      revokedAt: FieldValue.serverTimestamp(),
      revokedBy: uid,
    }, { merge: true });
    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'admin_invite_revoke',
      target: { type: 'admin_invite', id: inviteId },
      before: { status: 'pending' },
      after: { status: 'revoked' },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: false, stepUpFresh: false,
    });
    return { ok: true };
  }
);

exports.acceptAdminInvite = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in.');
    const { inviteId } = request.data || {};

    // ⚠⚠ THERE IS DELIBERATELY NO PROFILE REQUIREMENT ANY MORE. This threw
    // "User profile missing", which forced every sub-admin to be an ordinary
    // Vergr user with a public @handle — the exact link the operator exists to
    // break. A sub-admin can ban and mute real people, so they are a target
    // too, and the rule is that an admin identity leaves nothing to find.
    //
    // The sign-up email is read from Auth, never from the public profile doc.
    const userEmail = ((await authEmailFor(uid)) || '').toLowerCase();
    if (!userEmail) throw new HttpsError('failed-precondition', 'No email on this account.');

    // ⚠ inviteId IS OPTIONAL, and that is what makes the flow usable at all.
    // Without it there is nothing to transmit: the invitee opens Vergr Admin,
    // signs in, and the server finds the pending invite for their OWN address.
    // An id may still be passed, and is then checked against that same address
    // by the email comparison below, so this widens nothing.
    let ref;
    if (inviteId) {
      ref = db.collection('admin_invites').doc(inviteId);
    } else {
      const found = await db.collection('admin_invites')
        .where('email', '==', userEmail)
        .where('status', '==', 'pending')
        .limit(1)
        .get();
      if (found.empty) throw new HttpsError('not-found', 'No pending invitation for this account.');
      ref = found.docs[0].ref;
    }
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Invite not found.');
    const inv = snap.data();
    if (inv.status !== 'pending') {
      throw new HttpsError('failed-precondition', `Invite is ${inv.status}.`);
    }
    if (inv.email !== userEmail) {
      throw new HttpsError('permission-denied', 'Invite is for a different email.');
    }
    const expMs = inv.expiresAt && typeof inv.expiresAt.toMillis === 'function'
      ? inv.expiresAt.toMillis() : 0;
    if (Date.now() > expMs) {
      await ref.set({ status: 'expired' }, { merge: true });
      throw new HttpsError('deadline-exceeded', 'Invite expired.');
    }

    // Create / re-activate the admin_users doc. The label comes from the Auth
    // record, so a profile-less ops account still reads as something on
    // /admin/access instead of a bare uid.
    let label = null;
    try { label = (await getAuth().getUser(uid)).displayName || null; } catch { /* optional */ }

    // ⚠⚠ ACCEPTING DOES NOT MAKE A SUB-ADMIN ACTIVE. Finishing authenticator
    // setup does (confirmAdminTotpEnrollment flips pending_2fa -> active).
    // This is how the 2FA requirement reaches ~150 deployed functions WITHOUT
    // redeploying them: they carry an older requireFreshStepUp that lets an
    // UNENROLLED caller through, but every one of them also runs
    // requireAdminScreen, which refuses any status other than 'active'. So a
    // sub-admin with no authenticator is refused everywhere, old code included.
    // Someone re-invited who already has an authenticator goes straight to active.
    const sec = await db.collection('admin_security').doc(uid).get();
    const status = sec.exists && sec.data()?.enrolled ? 'active' : 'pending_2fa';
    await db.collection('admin_users').doc(uid).set({
      email: userEmail,
      displayName: label,
      allowedScreens: inv.allowedScreens || [],
      invitedBy: inv.invitedBy,
      invitedAt: inv.createdAt || FieldValue.serverTimestamp(),
      acceptedAt: FieldValue.serverTimestamp(),
      status,
    }, { merge: true });

    await ref.set({
      status: 'accepted',
      acceptedAt: FieldValue.serverTimestamp(),
      acceptedBy: uid,
    }, { merge: true });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'admin_invite_accept',
      target: { type: 'admin_user', id: uid },
      after: { allowedScreens: inv.allowedScreens },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: false, stepUpFresh: false,
    });
    return { ok: true, allowedScreens: inv.allowedScreens, status };
  }
);

exports.setAdminScreens = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireFounder(uid);
    const { uid: targetUid, allowedScreens } = request.data || {};
    if (!targetUid) throw new HttpsError('invalid-argument', 'uid required.');
    if (targetUid === uid) throw new HttpsError('failed-precondition', 'Cannot edit founder via this callable.');
    const screens = normalizeScreens(allowedScreens);
    if (screens.length === 0) {
      throw new HttpsError('invalid-argument', 'allowedScreens must include at least one screen.');
    }
    const ref = db.collection('admin_users').doc(targetUid);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Admin not found.');
    const before = snap.data().allowedScreens || [];
    await ref.set({ allowedScreens: screens }, { merge: true });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'admin_set_screens',
      target: { type: 'admin_user', id: targetUid },
      before: { allowedScreens: before },
      after: { allowedScreens: screens },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: false, stepUpFresh: false,
    });
    return { ok: true };
  }
);

exports.revokeAdminAccess = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireFounder(uid);
    const { uid: targetUid } = request.data || {};
    if (!targetUid) throw new HttpsError('invalid-argument', 'uid required.');
    if (targetUid === uid) throw new HttpsError('failed-precondition', 'Cannot revoke founder.');
    const ref = db.collection('admin_users').doc(targetUid);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Admin not found.');
    await ref.set({
      status: 'revoked',
      revokedAt: FieldValue.serverTimestamp(),
      revokedBy: uid,
    }, { merge: true });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'admin_revoke',
      target: { type: 'admin_user', id: targetUid },
      before: { status: snap.data().status, allowedScreens: snap.data().allowedScreens },
      after: { status: 'revoked' },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: false, stepUpFresh: false,
    });
    return { ok: true };
  }
);

exports.listAdmins = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireFounder(uid);
    const [adminUsersSnap, invitesSnap] = await Promise.all([
      db.collection('admin_users').get(),
      db.collection('admin_invites').where('status', '==', 'pending').get(),
    ]);
    const toMs = (t) => (t && typeof t.toMillis === 'function') ? t.toMillis() : null;
    return {
      admins: adminUsersSnap.docs.map(d => ({
        uid: d.id,
        email: d.data().email,
        displayName: d.data().displayName,
        allowedScreens: d.data().allowedScreens || [],
        status: d.data().status,
        invitedBy: d.data().invitedBy,
        acceptedAt: toMs(d.data().acceptedAt),
        revokedAt:  toMs(d.data().revokedAt),
      })),
      invites: invitesSnap.docs.map(d => ({
        id: d.id,
        email: d.data().email,
        allowedScreens: d.data().allowedScreens || [],
        invitedBy: d.data().invitedBy,
        createdAt: toMs(d.data().createdAt),
        expiresAt: toMs(d.data().expiresAt),
      })),
    };
  }
);

// Caller-side helper for any signed-in user — returns their own access record
// if they are a founder or sub-admin, otherwise { isAdmin: false }.
exports.getMyAdminAccess = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) return { isAdmin: false };
    // No session check here: this is the call Vergr Admin makes to find out
    // WHETHER to show the authenticator gate, so demanding a session would be
    // a deadlock. Nothing is granted by the answer; every action re-checks.
    if (await isOperator(uid)) {
      return { isAdmin: true, isFounder: true, isOperator: true, allowedScreens: ['*'] };
    }
    const userSnap = await db.collection('users').doc(uid).get();
    if (userSnap.exists && userSnap.data()?.role === 'admin') {
      return { isAdmin: true, isFounder: true, allowedScreens: ['*'] };
    }
    const adminSnap = await db.collection('admin_users').doc(uid).get();
    if (!adminSnap.exists || adminSnap.data().status !== 'active') {
      return { isAdmin: false };
    }
    return {
      isAdmin: true,
      isFounder: false,
      allowedScreens: adminSnap.data().allowedScreens || [],
    };
  }
);

module.exports.requireAdminScreen = requireAdminScreen;
module.exports.requireFounder = requireFounder;
module.exports.normalizeScreens = normalizeScreens;
module.exports.ADMIN_SCREENS = ADMIN_SCREENS;
