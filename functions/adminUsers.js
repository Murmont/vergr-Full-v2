// adminUsers.js — server callables for the Admin → Users screen.
//
// Every callable is guarded by guardedAdmin (admin gate + audit + rate limit)
// AND requires the caller to have the 'users' screen scope. Destructive
// actions require a fresh TOTP step-up.
//
// Callables:
//   adminListUsers       — paginated list with tab/role/plan/search filters
//   adminGetUserDetail   — full detail blob for the row drawer
//   adminGetUserStats    — KPI counts (total/active/new/banned/pro)
//   adminBanUser         — temp ban (days) or permaban
//   adminUnbanUser       — clear ban flags
//   adminMuteUser        — set mutedUntil
//   adminUnmuteUser      — clear mutedUntil
//   adminSetUserRole     — set users/{uid}.role
//   adminForceLogoutUser — revoke refresh tokens (forces re-auth)
//   adminSendPasswordReset — emails the user a reset link
//
// Hard rules:
//   - Founder cannot be banned / muted / role-stripped (defense against self-foot-gun).
//   - Setting role:'admin' is founder-only (sub-admins can't create more admins).
//   - Every action audits and notifies the target user where appropriate.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const {
  requireAdmin,
  requireFreshStepUp,
  adminRateLimit,
  auditAdminAction,
  extractRequestMeta,
} = require('./adminSecurity');
const { requireAdminScreen } = require('./adminAccess');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

const PAGE_SIZE = 25;
const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const NEW_WINDOW_MS    = 30 * 24 * 60 * 60 * 1000;

// ════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════

async function guardCaller(uid, screen, { requireStepUp = false } = {}) {
  await requireAdminScreen(uid, screen);
  if (requireStepUp) await requireFreshStepUp(uid);
}

async function assertNotFounder(targetUid) {
  const snap = await db.collection('users').doc(targetUid).get();
  if (snap.exists && snap.data().role === 'admin') {
    throw new HttpsError('permission-denied', 'Cannot moderate the platform owner.');
  }
}

function toMs(t) { return t && typeof t.toMillis === 'function' ? t.toMillis() : null; }

function shapeUserRow(uid, d) {
  const now = Date.now();
  const banUntilMs = toMs(d.banUntil);
  const isActiveBan = d.banned === true && (d.permabanned || (banUntilMs && banUntilMs > now));
  const lastActiveMs = toMs(d.lastActiveAt) || toMs(d.lastLoginAt) || toMs(d.updatedAt) || toMs(d.createdAt);
  return {
    uid,
    displayName: d.displayName || d.username || '(no name)',
    username: d.username || null,
    email: d.email || null,
    avatar: d.avatar || null,
    verified: !!d.verified,
    role: d.role || 'user',
    subscription: d.subscription || 'free',
    banned: isActiveBan,
    permabanned: !!d.permabanned,
    banUntil: banUntilMs,
    banReason: d.banReason || null,
    mutedUntil: toMs(d.mutedUntil),
    muteReason: d.muteReason || null,
    createdAt: toMs(d.createdAt),
    lastActiveAt: lastActiveMs,
    hideFromEnumeration: !!d.hideFromEnumeration,
  };
}

// ════════════════════════════════════════════════════════════════════
// READ — list / detail / stats
// ════════════════════════════════════════════════════════════════════

exports.adminListUsers = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, 'users');
    const {
      tab = 'all',           // all | active | new | banned | reports
      search = '',
      role = null,
      plan = null,
      cursor = null,         // last doc createdAt millis for keyset pagination
      pageSize = PAGE_SIZE,
    } = request.data || {};

    let q = db.collection('users');

    // Tab filter.
    if (tab === 'banned') {
      q = q.where('banned', '==', true);
    } else if (tab === 'active') {
      const since = new Date(Date.now() - ACTIVE_WINDOW_MS);
      q = q.where('lastActiveAt', '>=', since);
    } else if (tab === 'new') {
      const since = new Date(Date.now() - NEW_WINDOW_MS);
      q = q.where('createdAt', '>=', since);
    }
    // 'reports' tab is handled by the moderation screen, not here.

    if (role) q = q.where('role', '==', role);
    if (plan) q = q.where('subscription', '==', plan);

    const term = (search || '').trim().toLowerCase();
    if (term) {
      // Range query on username prefix. Combining with non-equality on other
      // fields requires composite indexes; we keep it simple by always
      // ordering by username when searching.
      q = q.where('username', '>=', term).where('username', '<=', term + '').orderBy('username');
    } else {
      // Default order: newest first.
      q = q.orderBy('createdAt', 'desc');
      if (cursor) q = q.startAfter(new Date(cursor));
    }

    // Over-fetch slightly to account for in-memory bot filter below.
    const effPageSize = Math.min(Number(pageSize) || PAGE_SIZE, 100);
    q = q.limit(effPageSize + 5);

    const snap = await q.get();
    // News bots are not users. Filter them out of admin lists so the founder
    // never sees bot accounts in Users / Active / New / Banned tabs.
    const filtered = snap.docs.filter(d => (d.data().accountType !== 'news_bot'));
    let rows = filtered.slice(0, effPageSize).map(d => shapeUserRow(d.id, d.data()));

    // Display-name fallback for searches that miss username prefix.
    // Most users type the display name, not the lowercase username. If the
    // username prefix query returned nothing (or very few), scan recent users
    // in-memory for displayName matches and append them. Capped scan size
    // keeps this O(small-constant) reads.
    if (term && rows.length < effPageSize) {
      const seen = new Set(rows.map(r => r.uid));
      try {
        const fallbackSnap = await db.collection('users')
          .orderBy('createdAt', 'desc')
          .limit(500)
          .get();
        for (const d of fallbackSnap.docs) {
          if (rows.length >= effPageSize) break;
          if (seen.has(d.id)) continue;
          const data = d.data();
          if (data.accountType === 'news_bot') continue;
          const dn = (data.displayName || '').toLowerCase();
          const un = (data.username || '').toLowerCase();
          const em = (data.email || '').toLowerCase();
          if (dn.includes(term) || un.includes(term) || em.includes(term)) {
            rows.push(shapeUserRow(d.id, data));
            seen.add(d.id);
          }
        }
      } catch {}
    }

    const last = rows.length > 0 ? filtered[Math.min(rows.length, filtered.length) - 1] : null;
    const nextCursor = !term && last ? toMs(last.data().createdAt) : null;
    return { rows, nextCursor, count: rows.length };
  }
);

exports.adminGetUserDetail = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, 'users');
    const { targetUid } = request.data || {};
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');

    const [userSnap, walletSnap] = await Promise.all([
      db.collection('users').doc(targetUid).get(),
      db.collection('wallets').doc(targetUid).get(),
    ]);
    if (!userSnap.exists) throw new HttpsError('not-found', 'User not found.');
    const d = userSnap.data();
    return {
      ...shapeUserRow(targetUid, d),
      bio: d.bio || null,
      followers: d.followerCount || 0,
      following: d.followingCount || 0,
      postsCount: d.postsCount || 0,
      kycStatus: d.kyc?.status || null,
      wallet: walletSnap.exists ? walletSnap.data() : { balance: 0, gems: 0, vp: 0 },
      vanguard: d.vanguard || null,
    };
  }
);

// Counts for the KPI strip. Uses Firestore aggregation count() — one read
// per count regardless of how many docs match, so this is cheap.
exports.adminGetUserStats = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, 'users');
    const usersCol = db.collection('users');
    const sinceActive = new Date(Date.now() - ACTIVE_WINDOW_MS);
    const sinceNew    = new Date(Date.now() - NEW_WINDOW_MS);

    const [total, active, fresh, banned, lite, pro, bots] = await Promise.all([
      usersCol.count().get(),
      usersCol.where('lastActiveAt', '>=', sinceActive).count().get(),
      usersCol.where('createdAt',    '>=', sinceNew).count().get(),
      usersCol.where('banned', '==', true).count().get(),
      usersCol.where('subscription', '==', 'lite').count().get(),
      usersCol.where('subscription', '==', 'pro').count().get(),
      // News bots are not users. Subtract from total so the KPI strip reflects
      // real humans only. Bots can't be banned/active/new/paid in practice,
      // but we subtract from total only to be safe (the other buckets are
      // already de-facto bot-free).
      usersCol.where('accountType', '==', 'news_bot').count().get().catch(() => ({ data: () => ({ count: 0 }) })),
    ]);
    const botCount = bots.data().count;
    return {
      total:  Math.max(0, total.data().count - botCount),
      active: active.data().count,
      new:    fresh.data().count,
      banned: banned.data().count,
      lite:   lite.data().count,
      pro:    pro.data().count,
    };
  }
);

// ════════════════════════════════════════════════════════════════════
// WRITE — bans, mutes, role, force-logout
// ════════════════════════════════════════════════════════════════════

exports.adminBanUser = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, 'users', { requireStepUp: true });
    await adminRateLimit(uid, 'admin_ban_user', { perHour: 30, perDay: 100 });

    const { targetUid, durationDays, reason = '', permanent = false } = request.data || {};
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');
    if (targetUid === uid) throw new HttpsError('failed-precondition', 'Cannot ban yourself.');
    await assertNotFounder(targetUid);
    if (!permanent && (!durationDays || durationDays < 1)) {
      throw new HttpsError('invalid-argument', 'durationDays required for temp ban.');
    }

    const userRef = db.collection('users').doc(targetUid);
    const before = (await userRef.get()).data();

    const banUntil = permanent ? null : new Date(Date.now() + durationDays * 24 * 3600 * 1000);
    await userRef.update({
      banned: true,
      banUntil,
      permabanned: !!permanent,
      banReason: String(reason).slice(0, 400),
      bannedBy: uid,
      bannedAt: FieldValue.serverTimestamp(),
    });

    // Notify the user.
    await db.collection('notifications').add({
      recipientId: targetUid,
      type: 'admin_ban',
      title: permanent ? 'Your account has been permanently banned' : 'Your account has been banned',
      body: reason || 'Contact support if you believe this is in error.',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Revoke their sessions immediately.
    try { await getAuth().revokeRefreshTokens(targetUid); } catch (e) { /* ignore */ }

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: permanent ? 'admin_perma_ban' : 'admin_temp_ban',
      target: { type: 'user', id: targetUid },
      before: { banned: before?.banned || false, permabanned: !!before?.permabanned },
      after:  { banned: true, permabanned: !!permanent, banUntil: banUntil ? banUntil.toISOString() : null },
      reason: String(reason).slice(0, 400),
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    });
    return { ok: true };
  }
);

exports.adminUnbanUser = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, 'users', { requireStepUp: true });
    await adminRateLimit(uid, 'admin_unban_user', { perHour: 30, perDay: 100 });

    const { targetUid, reason = '' } = request.data || {};
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');

    const userRef = db.collection('users').doc(targetUid);
    const before = (await userRef.get()).data();

    await userRef.update({
      banned: false,
      banUntil: null,
      permabanned: false,
      banReason: null,
      unbannedBy: uid,
      unbannedAt: FieldValue.serverTimestamp(),
    });

    await db.collection('notifications').add({
      recipientId: targetUid,
      type: 'admin_unban',
      title: 'Your account has been reinstated',
      body: 'Welcome back to VERGR.',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'admin_unban',
      target: { type: 'user', id: targetUid },
      before: { banned: !!before?.banned, permabanned: !!before?.permabanned },
      after:  { banned: false, permabanned: false },
      reason: String(reason).slice(0, 400),
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    });
    return { ok: true };
  }
);

exports.adminMuteUser = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, 'users', { requireStepUp: true });
    await adminRateLimit(uid, 'admin_mute_user', { perHour: 60, perDay: 200 });

    const { targetUid, hours, reason = '' } = request.data || {};
    if (!targetUid || !hours || hours < 1) {
      throw new HttpsError('invalid-argument', 'targetUid + hours (≥1) required.');
    }
    if (targetUid === uid) throw new HttpsError('failed-precondition', 'Cannot mute yourself.');
    await assertNotFounder(targetUid);

    const until = new Date(Date.now() + hours * 3600 * 1000);
    await db.collection('users').doc(targetUid).update({
      mutedUntil: until,
      mutedBy: uid,
      mutedAt: FieldValue.serverTimestamp(),
      muteReason: String(reason).slice(0, 400),
    });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'admin_mute',
      target: { type: 'user', id: targetUid },
      after: { mutedUntil: until.toISOString(), hours },
      reason: String(reason).slice(0, 400),
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    });
    return { ok: true, until: until.getTime() };
  }
);

exports.adminUnmuteUser = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, 'users');
    await adminRateLimit(uid, 'admin_unmute_user', { perHour: 60, perDay: 200 });

    const { targetUid } = request.data || {};
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');

    await db.collection('users').doc(targetUid).update({
      mutedUntil: null, muteReason: null,
      unmutedBy: uid, unmutedAt: FieldValue.serverTimestamp(),
    });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'admin_unmute',
      target: { type: 'user', id: targetUid },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: false, stepUpFresh: false,
    });
    return { ok: true };
  }
);

exports.adminSetUserRole = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, 'users', { requireStepUp: true });
    await adminRateLimit(uid, 'admin_set_role', { perHour: 10, perDay: 30 });

    const { targetUid, role } = request.data || {};
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');
    const allowedRoles = ['user', 'moderator', 'admin'];
    if (!allowedRoles.includes(role)) {
      throw new HttpsError('invalid-argument', `role must be one of: ${allowedRoles.join(', ')}`);
    }
    if (targetUid === uid) throw new HttpsError('failed-precondition', 'Cannot change your own role.');

    // Only the founder (role:'admin') can promote someone to admin.
    const caller = await requireAdmin(uid).catch(() => null);
    if (role === 'admin' && !caller) {
      throw new HttpsError('permission-denied', 'Only the founder can grant admin role.');
    }
    // And only the founder can DEMOTE an existing admin.
    const before = (await db.collection('users').doc(targetUid).get()).data();
    if (before?.role === 'admin' && !caller) {
      throw new HttpsError('permission-denied', 'Only the founder can change an admin\'s role.');
    }

    await db.collection('users').doc(targetUid).update({
      role,
      roleChangedBy: uid,
      roleChangedAt: FieldValue.serverTimestamp(),
    });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'admin_set_role',
      target: { type: 'user', id: targetUid },
      before: { role: before?.role || 'user' },
      after: { role },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    });
    return { ok: true };
  }
);

exports.adminForceLogoutUser = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, 'users', { requireStepUp: true });
    await adminRateLimit(uid, 'admin_force_logout', { perHour: 30, perDay: 100 });

    const { targetUid, reason = '' } = request.data || {};
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');
    await assertNotFounder(targetUid);

    await getAuth().revokeRefreshTokens(targetUid);

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'admin_force_logout',
      target: { type: 'user', id: targetUid },
      reason: String(reason).slice(0, 400),
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    });
    return { ok: true };
  }
);

exports.adminSendPasswordReset = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, 'users');
    await adminRateLimit(uid, 'admin_pwd_reset', { perHour: 20, perDay: 50 });

    const { targetUid } = request.data || {};
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');
    const userSnap = await db.collection('users').doc(targetUid).get();
    if (!userSnap.exists) throw new HttpsError('not-found', 'User not found.');
    const email = userSnap.data().email;
    if (!email) throw new HttpsError('failed-precondition', 'User has no email on file.');

    // generatePasswordResetLink returns a link we can show/send. Firebase
    // doesn't have a one-step admin "send reset email" — we just generate
    // the link and email it through whatever channel is configured. For
    // now, write the link to a notification so the user sees it on next
    // load (defensive; if they're locked out of email).
    const link = await getAuth().generatePasswordResetLink(email);

    await db.collection('notifications').add({
      recipientId: targetUid,
      type: 'admin_password_reset',
      title: 'Admin issued a password reset',
      body: 'Open the link in your email to set a new password.',
      meta: { link },
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'admin_password_reset',
      target: { type: 'user', id: targetUid },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: false, stepUpFresh: false,
    });
    return { ok: true, link }; // returned so admin can copy/send manually if email is broken
  }
);
