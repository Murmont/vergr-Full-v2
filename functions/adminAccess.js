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
const crypto = require('crypto');
const { requireAdmin, auditAdminAction, extractRequestMeta } = require('./adminSecurity');

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

  // Founder bypass — role:'admin' on the users doc.
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
    const { email, allowedScreens } = request.data || {};
    if (!email || typeof email !== 'string') {
      throw new HttpsError('invalid-argument', 'email required.');
    }
    const screens = normalizeScreens(allowedScreens);
    if (screens.length === 0) {
      throw new HttpsError('invalid-argument', 'allowedScreens must include at least one screen.');
    }
    const emailLower = email.trim().toLowerCase();

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

    // Notify the user if we already have an account for that email.
    const userMatch = await db.collection('users')
      .where('email', '==', emailLower)
      .limit(1)
      .get();
    if (!userMatch.empty) {
      const target = userMatch.docs[0];
      await db.collection('notifications').add({
        recipientId: target.id,
        type: 'admin_invite',
        title: 'You\'ve been invited as a VERGR admin',
        body: `Scopes: ${screens.join(', ')}`,
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
    if (!inviteId) throw new HttpsError('invalid-argument', 'inviteId required.');

    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) throw new HttpsError('not-found', 'User profile missing.');
    const userEmail = (userSnap.data().email || '').toLowerCase();
    if (!userEmail) throw new HttpsError('failed-precondition', 'No email on user profile.');

    const ref = db.collection('admin_invites').doc(inviteId);
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

    // Create / re-activate the admin_users doc.
    await db.collection('admin_users').doc(uid).set({
      email: userEmail,
      displayName: userSnap.data().displayName || null,
      allowedScreens: inv.allowedScreens || [],
      invitedBy: inv.invitedBy,
      invitedAt: inv.createdAt || FieldValue.serverTimestamp(),
      acceptedAt: FieldValue.serverTimestamp(),
      status: 'active',
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
    return { ok: true, allowedScreens: inv.allowedScreens };
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
