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
//   adminResetBoostStats — zero the three boost delivery counters on a target
//   adminSetUserRole     — set users/{uid}.role
//   adminForceLogoutUser — revoke refresh tokens (forces re-auth)
//   adminSendPasswordReset — emails the user a reset link
//   adminDeleteGuestAccount, hard-delete an anonymous guest session (Auth + doc)
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

// The ONLY field that actually tracks activity is `lastSeen`, written on every
// sign-in (AuthContext) and every presence tick (UsePresence). `lastActiveAt` is
// written ONCE at account creation and never again, so the Active tab and the
// Active KPI used to be "accounts created in the last 7 days" wearing the wrong
// label, and every older account read as inactive with a Last Active equal to
// its signup date. Order matters here: lastSeen first, the rest are fallbacks
// for accounts that predate presence.
const ACTIVITY_FIELD = 'lastSeen';
const activityMs = (d) =>
  toMs(d.lastSeen) || toMs(d.lastActiveAt) || toMs(d.lastLoginAt) || toMs(d.createdAt);

// News/shorts bots are not users, and guests are anonymous browsing sessions
// rather than accounts. Both are excluded from every human-facing tab and from
// the total; guests get their own tab so they are still inspectable.
const isBotDoc   = (d) => typeof d.accountType === 'string' && d.accountType.includes('bot');
const isGuestDoc = (d) => d.isGuest === true;

function shapeUserRow(uid, d) {
  const now = Date.now();
  const banUntilMs = toMs(d.banUntil);
  const isActiveBan = d.banned === true && (d.permabanned || (banUntilMs && banUntilMs > now));
  const lastActiveMs = activityMs(d);
  return {
    uid,
    isGuest: isGuestDoc(d),
    convertedFromGuest: !!d.convertedFromGuestAt,
    // True when maintainUsernameIndex picked the handle because the doc arrived
    // without one. That generator falls back to "player" + 4 random chars when
    // there is no display name and no email to derive a base from, which is
    // where every `playerxxxx` handle in the list comes from.
    usernameAutoAssigned: !!d.usernameAutoAssigned,
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
      tab = 'all',           // all | active | new | banned | guests
      search = '',
      role = null,
      plan = null,
      cursor = null,         // last row's order-field millis (keyset pagination)
      pageSize = PAGE_SIZE,
    } = request.data || {};

    const now = Date.now();
    const effPageSize = Math.min(Math.max(Number(pageSize) || PAGE_SIZE, 1), 100);
    const includeGuests = tab === 'guests';
    // Bots are never listed. Guests only on their own tab.
    const keep = (d) => !isBotDoc(d) && (includeGuests ? isGuestDoc(d) : !isGuestDoc(d));

    let base = db.collection('users');
    // The order field has to be the inequality field, so the Active tab pages by
    // lastSeen and everything else pages by createdAt.
    let orderField = 'createdAt';

    if (tab === 'banned') {
      base = base.where('banned', '==', true);
    } else if (tab === 'active') {
      base = base.where(ACTIVITY_FIELD, '>=', new Date(now - ACTIVE_WINDOW_MS));
      orderField = ACTIVITY_FIELD;
    } else if (tab === 'new') {
      base = base.where('createdAt', '>=', new Date(now - NEW_WINDOW_MS));
    } else if (tab === 'guests') {
      base = base.where('isGuest', '==', true);
    }

    if (role) base = base.where('role', '==', role);
    if (plan) base = base.where('subscription', '==', plan);

    const term = (search || '').trim().toLowerCase();

    // Search path: prefix match on usernameLower, then a capped in-memory scan
    // for display-name / email matches. Not paginated (a search returns one page
    // of best matches).
    if (term) {
      const rows = [];
      const seen = new Set();
      const push = (id, d) => {
        if (seen.has(id) || !keep(d)) return;
        if (role && (d.role || 'user') !== role) return;
        if (plan && (d.subscription || 'free') !== plan) return;
        seen.add(id);
        rows.push(shapeUserRow(id, d));
      };
      try {
        // The upper bound needs the high-codepoint sentinel U+F8FF to make this
        // a PREFIX range. The old query passed an EMPTY string there, so it was
        // an exact-match query pretending to be a prefix search, and it ran
        // against `username` (original case) rather than the lowercase index, so
        // anyone with a capital letter in their handle was unfindable.
        const pre = await db.collection('users')
          .where('usernameLower', '>=', term)
          .where('usernameLower', '<=', term + '\uf8ff')
          .orderBy('usernameLower')
          .limit(effPageSize)
          .get();
        for (const doc of pre.docs) push(doc.id, doc.data());
      } catch { /* index missing -> fall through to the scan below */ }

      if (rows.length < effPageSize) {
        try {
          const scan = await db.collection('users')
            .orderBy('createdAt', 'desc')
            .limit(500)
            .get();
          for (const doc of scan.docs) {
            if (rows.length >= effPageSize) break;
            const d = doc.data();
            const hay = [d.displayName, d.username, d.usernameLower, d.email]
              .filter(Boolean).join(' ').toLowerCase();
            if (hay.includes(term)) push(doc.id, d);
          }
        } catch { /* ignore */ }
      }
      return { rows, nextCursor: null, count: rows.length, searched: true };
    }

    // Paged path. Bots and guests are filtered in memory, which means a raw page
    // can come back short, so keep fetching until the page is full (or the source
    // runs out). The old version fetched ONE page of pageSize+5, then returned a
    // cursor unconditionally and computed it from the wrong array, so "Load more"
    // stayed clickable forever and re-served rows already on screen.
    const fetchSize = Math.max(effPageSize * 2, 40);
    const picked = [];             // one more than the page proves more exist
    let scanCursor = cursor;
    let exhausted = false;

    for (let round = 0; round < 6 && picked.length <= effPageSize; round++) {
      let q = base.orderBy(orderField, 'desc');
      if (scanCursor) q = q.startAfter(new Date(scanCursor));
      const snap = await q.limit(fetchSize).get();
      if (snap.empty) { exhausted = true; break; }

      for (const doc of snap.docs) {
        const d = doc.data();
        if (keep(d)) picked.push({ id: doc.id, d });
        if (picked.length > effPageSize) break;
      }

      const lastMs = toMs(snap.docs[snap.docs.length - 1].data()[orderField]);
      if (snap.docs.length < fetchSize || !lastMs || lastMs === scanCursor) { exhausted = true; break; }
      scanCursor = lastMs;
    }

    const hasMore = picked.length > effPageSize;
    const page = picked.slice(0, effPageSize);
    const rows = page.map(({ id, d }) => shapeUserRow(id, d));
    const nextCursor = hasMore && page.length
      ? toMs(page[page.length - 1].d[orderField])
      : null;
    return { rows, nextCursor, count: rows.length, exhausted: exhausted && !hasMore };
  }
);

exports.adminGetUserDetail = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, 'users');
    const { targetUid } = request.data || {};
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');

    // The Auth record is the only authoritative answer to "is this an anonymous
    // browsing session or a real signup". A user doc alone cannot tell you: an
    // abandoned signup and a guest look identical on it.
    const [userSnap, walletSnap, authUser] = await Promise.all([
      db.collection('users').doc(targetUid).get(),
      db.collection('wallets').doc(targetUid).get(),
      getAuth().getUser(targetUid).catch(() => null),
    ]);
    if (!userSnap.exists) throw new HttpsError('not-found', 'User not found.');
    const d = userSnap.data();
    const providers = (authUser?.providerData || []).map(p => p.providerId);
    return {
      ...shapeUserRow(targetUid, d),
      // Empty providers on an existing Auth record means anonymous sign-in.
      signInProviders: providers,
      isAnonymousAuth: !!authUser && providers.length === 0,
      authExists: !!authUser,
      emailVerified: !!authUser?.emailVerified,
      authDisabled: !!authUser?.disabled,
      lastSignInAt: authUser?.metadata?.lastSignInTime
        ? new Date(authUser.metadata.lastSignInTime).getTime() : null,
      bio: d.bio || null,
      followers: d.followerCount || 0,
      following: d.followingCount || 0,
      postsCount: d.postsCount || 0,
      kycStatus: d.kyc?.status || null,
      wallet: walletSnap.exists ? walletSnap.data() : { balance: 0, owedMicroUsd: 0, vp: 0 },
      vanguard: d.vanguard || null,
    };
  }
);

// Counts for the KPI strip. Uses Firestore aggregation count(), one read per
// count regardless of how many docs match, so this is cheap.
//
// "Total" means real human accounts: bots and guests are both subtracted. A
// guest is an anonymous browsing session (Firebase anonymous auth), not a
// signup, so counting them inflated the only number on the screen anyone reads
// as "how big is Vergr". They get their own count and their own tab instead.
exports.adminGetUserStats = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, 'users');
    const usersCol = db.collection('users');
    const sinceActive = new Date(Date.now() - ACTIVE_WINDOW_MS);
    const sinceNew    = new Date(Date.now() - NEW_WINDOW_MS);
    const zero = { data: () => ({ count: 0 }) };
    const safe = (q) => q.count().get().catch(() => zero);

    const [total, active, fresh, banned, lite, pro, guests, newsBots, shortsBots, guestsActive] =
      await Promise.all([
        safe(usersCol),
        // lastSeen, NOT lastActiveAt: see ACTIVITY_FIELD above. This compared a
        // Timestamp field against a field nothing updates, so Active was really
        // "signed up in the last 7 days".
        safe(usersCol.where(ACTIVITY_FIELD, '>=', sinceActive)),
        safe(usersCol.where('createdAt', '>=', sinceNew)),
        safe(usersCol.where('banned', '==', true)),
        safe(usersCol.where('subscription', '==', 'lite')),
        safe(usersCol.where('subscription', '==', 'pro')),
        safe(usersCol.where('isGuest', '==', true)),
        safe(usersCol.where('accountType', '==', 'news_bot')),
        safe(usersCol.where('accountType', '==', 'shorts_bot')),
        // Guests are excluded from Active too, so the figure has to be netted
        // out rather than assumed to be zero.
        safe(usersCol.where('isGuest', '==', true).where(ACTIVITY_FIELD, '>=', sinceActive)),
      ]);

    const n = (r) => r.data().count;
    const guestCount = n(guests);
    const botCount = n(newsBots) + n(shortsBots);

    return {
      total:   Math.max(0, n(total) - botCount - guestCount),
      active:  Math.max(0, n(active) - n(guestsActive)),
      new:     n(fresh),
      banned:  n(banned),
      lite:    n(lite),
      pro:     n(pro),
      guests:  guestCount,
      bots:    botCount,
      // So the screen can label the Total card honestly instead of the client
      // guessing what was netted out.
      totalIncludingGuestsAndBots: n(total),
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

// Zero a boost's delivery counters.
//
// ⚠ EXISTS BECAUSE A COUNTER WAS INFLATED BY A BUG AND THERE WAS NO WAY TO
// CORRECT IT. On 2026-08-28 impression counting was briefly live on all six
// suggestion surfaces instead of one, and separately "views" counted page loads
// rather than devices, so a boost on a 2-account platform reported 5 viewers.
// Both are fixed, but the accumulated numbers were wrong and server-only, so
// nothing short of an admin write could clean them.
//
// Scoped deliberately: it only ever writes zeroes, and only to the three delivery
// counters. It cannot grant, move or destroy anything else.
exports.adminResetBoostStats = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, 'users');
    await adminRateLimit(uid, 'admin_reset_boost_stats', { perHour: 30, perDay: 100 });

    const { target, targetId } = request.data || {};
    const COL = { user: 'users', post: 'posts', squad: 'squads', stream: 'streams' };
    if (!COL[target] || !targetId) {
      throw new HttpsError('invalid-argument', 'target (user|post|squad|stream) and targetId required.');
    }

    await db.collection(COL[target]).doc(String(targetId)).set({
      boostImpressions: 0, boostViews: 0, boostEngagements: 0,
    }, { merge: true });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'admin_reset_boost_stats',
      target: { type: target, id: String(targetId) },
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

// ════════════════════════════════════════════════════════════════════
// DELETE: guest sessions only
// ════════════════════════════════════════════════════════════════════

/**
 * Hard-delete a guest account: Firebase Auth user, then the Firestore doc and its
 * subcollections.
 *
 * Deliberately scoped to GUESTS and nothing else. A guest is an anonymous browse
 * session with no credential, so there is nothing to recover and nobody to
 * notify; a real account is a person's data and deleting it from a moderation
 * row would be an unrecoverable mistake one misclick away from a ban button.
 * Banning is the tool for real accounts.
 *
 * Guest-ness is proved against the Firebase Auth record, not the user doc: an
 * anonymous sign-in is exactly "an Auth user with no email and no providers".
 * The doc flag alone is forgeable-by-accident (a stale or missing `isGuest` is
 * why some sessions read `playerxxxx` instead of `guest_...`), so it is accepted
 * as a signal but the Auth record is what authorises the delete.
 *
 * Uses the SAME purge routine as the daily `purgeStaleGuests` job so the manual
 * and automatic paths cannot diverge: Auth first, then a recursive doc delete, so
 * a failed Auth delete leaves the account whole rather than half-gone.
 */
exports.adminDeleteGuestAccount = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, 'users', { requireStepUp: true });
    await adminRateLimit(uid, 'admin_delete_guest', { perHour: 60, perDay: 300 });

    const { targetUid, reason = '' } = request.data || {};
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');
    if (targetUid === uid) throw new HttpsError('failed-precondition', 'Cannot delete yourself.');
    await assertNotFounder(targetUid);

    const snap = await db.collection('users').doc(targetUid).get();
    const d = snap.exists ? snap.data() : null;

    // A converted account keeps its uid, so `convertedFromGuestAt` means this is
    // a REAL account that merely started as a guest. Never deletable here.
    if (d?.convertedFromGuestAt) {
      throw new HttpsError('failed-precondition',
        'This account converted from a guest to a real account. Ban it instead.');
    }
    if (d?.email) {
      throw new HttpsError('failed-precondition', 'Account has an email on file. Ban it instead.');
    }

    const authUser = await getAuth().getUser(targetUid).catch(() => null);
    if (authUser) {
      const providers = (authUser.providerData || []).map(x => x.providerId);
      if (authUser.email || providers.length > 0) {
        throw new HttpsError('failed-precondition',
          `Not a guest: signs in with ${providers.join(', ') || 'a credential'}. Ban it instead.`);
      }
    } else if (!d) {
      throw new HttpsError('not-found', 'No account found.');
    }
    // authUser == null with a doc present is an ORPHAN doc: no Auth record at
    // all. That is safe to clean up and is one of the things this button is for.

    const { _purgeGuest } = require('./guestCleanup');
    await _purgeGuest(targetUid);

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'admin_delete_guest',
      target: { type: 'user', id: targetUid },
      before: {
        username: d?.username || null,
        isGuest: d?.isGuest === true,
        hadAuthRecord: !!authUser,
      },
      reason: String(reason).slice(0, 400),
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    });

    return { ok: true, deleted: targetUid };
  }
);
