// adminModeration.js — server callables for the Admin → Moderation Queue.
//
// Reads from `reports/` (created via submitReport). Acts on report status
// and, for approve decisions on posts/clips/streams, hides the target. User
// reports leave the user record alone — the admin moves to the Users screen
// to ban/mute/etc, with full context from the report drawer.
//
// Every callable is gated by `requireAdminScreen('moderation')`. Destructive
// resolutions require fresh TOTP step-up.
//
// Difference from `vanguardResolveReport`: the admin path does NOT bump the
// Vanguard treasury action counters or VP. Founder/admin actions are
// separate from paid moderator work.
//
// Callables:
//   adminGetModerationStats   — KPI counts (total / unreviewed / overdue / resolved today)
//   adminListReports          — paginated list with tab + filters
//   adminGetReportDetail      — single report + sibling reports for same target + target snapshot
//   adminResolveReport        — approve / reject / escalate (single)
//   adminBulkResolveReports   — apply same decision to many at once

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const {
  requireFreshStepUp,
  adminRateLimit,
  auditAdminAction,
  extractRequestMeta,
} = require('./adminSecurity');
const { requireAdminScreen } = require('./adminAccess');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

const OVERDUE_MS = 48 * 60 * 60 * 1000; // 48h unreviewed = overdue

async function guardCaller(uid, { requireStepUp = false } = {}) {
  await requireAdminScreen(uid, 'moderation');
  if (requireStepUp) await requireFreshStepUp(uid);
}

const toMs = (t) => t && typeof t.toMillis === 'function' ? t.toMillis() : null;

// targetType in the schema → which UI tab it belongs to.
// 'post' is the catch-all for clip/short/article/photo posts.
const TAB_TO_TYPES = {
  all:     null,
  clips:   ['post'],
  users:   ['user'],
  comments:['comment'],
  streams: ['stream'],
  messages:['message'],
};

// ════════════════════════════════════════════════════════════════════
// READ
// ════════════════════════════════════════════════════════════════════

exports.adminGetModerationStats = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);

    const reports = db.collection('reports');
    const overdueCutoff = new Date(Date.now() - OVERDUE_MS);
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);

    const safeCount = async (q) => {
      try { return (await q.count().get()).data().count; } catch { return 0; }
    };

    const [total, pending, overdue, resolvedToday, postReports, userReports, commentReports, streamReports] = await Promise.all([
      safeCount(reports),
      safeCount(reports.where('status', '==', 'pending')),
      safeCount(reports.where('status', '==', 'pending').where('createdAt', '<', overdueCutoff)),
      safeCount(reports.where('resolvedAt', '>=', startOfToday)),
      safeCount(reports.where('targetType', '==', 'post').where('status', '==', 'pending')),
      safeCount(reports.where('targetType', '==', 'user').where('status', '==', 'pending')),
      safeCount(reports.where('targetType', '==', 'comment').where('status', '==', 'pending')),
      safeCount(reports.where('targetType', '==', 'stream').where('status', '==', 'pending')),
    ]);

    return {
      total, pending, overdue, resolvedToday,
      byType: {
        post:    postReports,
        user:    userReports,
        comment: commentReports,
        stream:  streamReports,
      },
    };
  }
);

exports.adminListReports = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const {
      tab = 'all',
      status = 'pending',
      priority = null,
      reason = null,
      cursor = null,
      pageSize = 25,
    } = request.data || {};

    let q = db.collection('reports');
    if (status && status !== 'all') q = q.where('status', '==', status);

    const types = TAB_TO_TYPES[tab];
    if (types && types.length === 1) q = q.where('targetType', '==', types[0]);

    if (priority) q = q.where('priority', '==', priority);
    if (reason)   q = q.where('reason', '==', reason);

    q = q.orderBy('createdAt', 'desc');
    if (cursor) q = q.startAfter(new Date(cursor));
    q = q.limit(Math.min(Number(pageSize), 100));

    const snap = await q.get();
    const rows = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
      createdAt: toMs(d.data().createdAt),
      resolvedAt: toMs(d.data().resolvedAt),
    }));

    // Hydrate reporter info for unique uids.
    const uids = [...new Set(rows.map(r => r.reporterId).filter(Boolean))];
    const reporters = {};
    await Promise.all(uids.map(async (u) => {
      try {
        const us = await db.collection('users').doc(u).get();
        if (us.exists) reporters[u] = {
          displayName: us.data().displayName || us.data().username || u.slice(0, 6),
          username: us.data().username || null,
          avatar: us.data().avatar || null,
        };
      } catch {}
    }));

    const nextCursor = snap.docs.length === Number(pageSize)
      ? toMs(snap.docs[snap.docs.length - 1].data().createdAt)
      : null;
    return { rows, reporters, nextCursor };
  }
);

// Returns the report + every sibling report for the same target + a snapshot
// of the target itself (post body, user info, etc) so the admin can decide
// without opening 4 tabs.
exports.adminGetReportDetail = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { reportId } = request.data || {};
    if (!reportId) throw new HttpsError('invalid-argument', 'reportId required.');

    const reportSnap = await db.collection('reports').doc(reportId).get();
    if (!reportSnap.exists) throw new HttpsError('not-found', 'Report not found.');
    const report = { id: reportSnap.id, ...reportSnap.data(), createdAt: toMs(reportSnap.data().createdAt), resolvedAt: toMs(reportSnap.data().resolvedAt) };

    // Siblings = other reports against same target.
    let siblings = [];
    if (report.targetId) {
      const sibSnap = await db.collection('reports')
        .where('targetId', '==', report.targetId)
        .where('targetType', '==', report.targetType)
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      siblings = sibSnap.docs
        .filter(d => d.id !== reportId)
        .map(d => ({ id: d.id, ...d.data(), createdAt: toMs(d.data().createdAt) }));
    }

    // Hydrate reporter + sibling reporters.
    const allReporterUids = [...new Set([
      report.reporterId,
      ...siblings.map(s => s.reporterId),
    ].filter(Boolean))];
    const reporters = {};
    await Promise.all(allReporterUids.map(async (u) => {
      try {
        const us = await db.collection('users').doc(u).get();
        if (us.exists) reporters[u] = {
          displayName: us.data().displayName || us.data().username || u.slice(0, 6),
          username: us.data().username || null,
          avatar: us.data().avatar || null,
        };
      } catch {}
    }));

    // Target snapshot.
    let target = null;
    if (report.targetType && report.targetId) {
      try {
        if (report.targetType === 'post') {
          const ps = await db.collection('posts').doc(report.targetId).get();
          if (ps.exists) {
            const p = ps.data();
            target = {
              type: 'post',
              id: ps.id,
              authorId: p.authorId || p.userId || null,
              text: (p.text || p.body || p.caption || '').slice(0, 1000),
              mediaUrls: p.mediaUrls || p.media || [],
              postType: p.postType || p.type || 'text',
              status: p.status || 'visible',
              createdAt: toMs(p.createdAt),
            };
            if (target.authorId) {
              const au = await db.collection('users').doc(target.authorId).get();
              if (au.exists) target.author = {
                displayName: au.data().displayName || au.data().username,
                username: au.data().username || null,
                avatar: au.data().avatar || null,
                uid: au.id,
              };
            }
          }
        } else if (report.targetType === 'user') {
          const us = await db.collection('users').doc(report.targetId).get();
          if (us.exists) target = {
            type: 'user',
            id: us.id,
            uid: us.id,
            displayName: us.data().displayName || us.data().username,
            username: us.data().username || null,
            avatar: us.data().avatar || null,
            bio: us.data().bio || null,
            banned: !!us.data().banned,
            mutedUntil: toMs(us.data().mutedUntil),
            createdAt: toMs(us.data().createdAt),
          };
        } else if (report.targetType === 'comment') {
          // Comments live under posts/{postId}/comments/{commentId}. Without
          // the postId we'd need a collectionGroup — try it.
          const cs = await db.collectionGroup('comments').where('__name__', '==', report.targetId).limit(1).get().catch(() => null);
          if (cs && !cs.empty) {
            const c = cs.docs[0];
            target = {
              type: 'comment',
              id: c.id,
              authorId: c.data().authorId || c.data().userId || null,
              text: (c.data().text || c.data().body || '').slice(0, 1000),
              createdAt: toMs(c.data().createdAt),
              postId: c.ref.parent.parent?.id || null,
            };
          }
        } else if (report.targetType === 'stream') {
          const ss = await db.collection('streams').doc(report.targetId).get();
          if (ss.exists) target = {
            type: 'stream',
            id: ss.id,
            hostId: ss.data().hostId || null,
            title: ss.data().title || null,
            status: ss.data().status || null,
            createdAt: toMs(ss.data().createdAt),
          };
        }
      } catch { /* swallow; admin still sees report meta */ }
    }

    return { report, siblings, reporters, target };
  }
);

// ════════════════════════════════════════════════════════════════════
// WRITE
// ════════════════════════════════════════════════════════════════════

const VALID_DECISIONS = ['approve', 'reject', 'escalate'];

async function resolveOne(callerUid, reportId, decision, reason, meta) {
  const reportRef = db.collection('reports').doc(reportId);
  const snap = await reportRef.get();
  if (!snap.exists) throw new HttpsError('not-found', `Report ${reportId} not found.`);
  const r = snap.data();
  if (['actioned', 'rejected', 'escalated', 'resolved'].includes(r.status)) {
    return { reportId, skipped: true, reason: `Already ${r.status}` };
  }
  const newStatus = decision === 'approve' ? 'actioned'
                  : decision === 'reject'  ? 'rejected'
                  : 'escalated';
  await reportRef.update({
    status: newStatus,
    resolvedBy: callerUid,
    resolvedAt: FieldValue.serverTimestamp(),
    resolutionReason: String(reason || '').slice(0, 400),
  });

  // Auto-hide posts when an admin approves the report.
  if (decision === 'approve' && r.targetType === 'post' && r.targetId) {
    await db.collection('posts').doc(r.targetId).update({
      status: 'hidden',
      hiddenReason: 'admin_approved_report',
      hiddenAt: FieldValue.serverTimestamp(),
      hiddenBy: callerUid,
    }).catch(() => null);
  }
  // Mark streams ended when approving stream reports.
  if (decision === 'approve' && r.targetType === 'stream' && r.targetId) {
    await db.collection('streams').doc(r.targetId).update({
      status: 'ended_by_admin',
      endedReason: 'admin_approved_report',
      endedAt: FieldValue.serverTimestamp(),
      endedBy: callerUid,
    }).catch(() => null);
  }

  // Audit.
  await auditAdminAction({
    actor: callerUid,
    action: `admin_report_${decision}`,
    target: { type: 'report', id: reportId },
    before: { status: r.status, targetType: r.targetType, targetId: r.targetId },
    after:  { status: newStatus },
    reason: String(reason || '').slice(0, 400),
    ip: meta.ip, userAgent: meta.userAgent,
    stepUpEnforced: true, stepUpFresh: true,
    meta: { reportReason: r.reason, targetType: r.targetType, targetId: r.targetId },
  });

  return { reportId, status: newStatus };
}

exports.adminResolveReport = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_resolve_report', { perHour: 200, perDay: 1000 });

    const { reportId, decision, reason = '' } = request.data || {};
    if (!reportId) throw new HttpsError('invalid-argument', 'reportId required.');
    if (!VALID_DECISIONS.includes(decision)) {
      throw new HttpsError('invalid-argument', `decision must be one of: ${VALID_DECISIONS.join(', ')}`);
    }
    const meta = extractRequestMeta(request);
    const r = await resolveOne(uid, reportId, decision, reason, meta);
    return { ok: true, ...r };
  }
);

exports.adminBulkResolveReports = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_bulk_resolve', { perHour: 30, perDay: 100 });

    const { reportIds, decision, reason = '' } = request.data || {};
    if (!Array.isArray(reportIds) || reportIds.length === 0) {
      throw new HttpsError('invalid-argument', 'reportIds[] required.');
    }
    if (reportIds.length > 50) {
      throw new HttpsError('invalid-argument', 'Max 50 reports per bulk action.');
    }
    if (!VALID_DECISIONS.includes(decision)) {
      throw new HttpsError('invalid-argument', `decision must be one of: ${VALID_DECISIONS.join(', ')}`);
    }
    const meta = extractRequestMeta(request);
    const results = await Promise.allSettled(
      reportIds.map(id => resolveOne(uid, id, decision, reason, meta))
    );
    return {
      ok: true,
      results: results.map((r, i) => r.status === 'fulfilled'
        ? { reportId: reportIds[i], ...r.value }
        : { reportId: reportIds[i], error: r.reason?.message || 'failed' }
      ),
    };
  }
);

// ════════════════════════════════════════════════════════════════════
// MODERATION REPORTS AUDIT SUB-SCREEN  (/admin/reports/audit)
// ════════════════════════════════════════════════════════════════════
//
// Reports on past moderation activity. Reads admin_actions/ + reports/
// in resolved states + vanguard_actions/ + appeals/. Adds an Appeals
// workflow on top of the existing report resolution flow.
//
// Callables:
//   adminListResolvedReports        — paginated history of past resolutions
//   adminGetModeratorStats          — per-moderator action counts + breakdown
//   adminListAppeals                — paginated appeals queue
//   adminGetAppealDetail            — single appeal + original report
//   adminResolveAppeal              — admin uphold/overturn an appeal
//   adminGetModerationPolicySettings — global moderation policy flags
//   adminSetModerationPolicySettings — write policy flags

// ── RESOLVED REPORTS ────────────────────────────────────────────────

const RESOLVED_STATUSES = ['actioned', 'rejected', 'escalated', 'resolved'];

exports.adminListResolvedReports = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const {
      filters = {}, cursor = null, pageSize = 50,
    } = request.data || {};
    const limit = Math.min(200, Math.max(1, pageSize));

    let q = db.collection('reports')
      .orderBy('resolvedAt', 'desc');

    if (filters.status && RESOLVED_STATUSES.includes(filters.status)) {
      q = q.where('status', '==', filters.status);
    } else {
      // Default: any resolved state.
      q = q.where('status', 'in', RESOLVED_STATUSES);
    }
    if (filters.targetType) q = q.where('targetType', '==', filters.targetType);
    if (filters.moderatorUid) q = q.where('resolvedBy', '==', filters.moderatorUid);
    if (filters.sinceMs) q = q.where('resolvedAt', '>=', new Date(Number(filters.sinceMs)));

    if (cursor) {
      const cs = await db.collection('reports').doc(cursor).get();
      if (cs.exists) q = q.startAfter(cs);
    }

    const snap = await q.limit(limit).get().catch(() => ({ docs: [] }));
    const rows = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        targetType: data.targetType || null,
        targetId: data.targetId || null,
        reason: data.reason || null,
        priority: data.priority || 'normal',
        status: data.status || null,
        reporterId: data.reporterId || null,
        resolvedBy: data.resolvedBy || null,
        resolvedAt: toMs(data.resolvedAt),
        resolutionReason: data.resolutionReason || null,
        createdAt: toMs(data.createdAt),
        hasAppeal: !!data.hasAppeal,
      };
    });

    // Hydrate moderator profiles
    const modUids = [...new Set(rows.map(r => r.resolvedBy).filter(Boolean))];
    const profiles = {};
    if (modUids.length > 0) {
      const snaps = await Promise.all(modUids.map(u => db.collection('users').doc(u).get()));
      snaps.forEach((s, i) => {
        if (s.exists) {
          const p = s.data();
          profiles[modUids[i]] = {
            displayName: p.displayName || null,
            username: p.username || null,
            avatar: p.avatar || null,
            role: p.role || null,
          };
        }
      });
    }

    const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;
    return { rows: rows.map(r => ({ ...r, moderator: profiles[r.resolvedBy] || null })), nextCursor };
  }
);

// ── PER-MODERATOR STATS ─────────────────────────────────────────────
//
// Returns an aggregated leaderboard of moderator activity over the
// configured time window. Reads reports/ resolvedBy + admin_actions/
// to capture both Vanguard and admin paths.

exports.adminGetModeratorStats = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { sinceMs = Date.now() - 30 * 24 * 3600 * 1000 } = request.data || {};
    const since = new Date(Number(sinceMs));

    // 1. Pull resolved reports in window (capped at 1000 to bound reads)
    const repSnap = await db.collection('reports')
      .where('status', 'in', RESOLVED_STATUSES)
      .where('resolvedAt', '>=', since)
      .orderBy('resolvedAt', 'desc')
      .limit(1000)
      .get()
      .catch(() => ({ docs: [] }));

    // Aggregate per moderator
    const byUid = new Map();
    for (const d of repSnap.docs) {
      const r = d.data();
      const moduid = r.resolvedBy;
      if (!moduid) continue;
      const row = byUid.get(moduid) || {
        uid: moduid,
        total: 0, approved: 0, rejected: 0, escalated: 0,
        targetTypeBreakdown: {},
        lastActionAt: 0,
      };
      row.total += 1;
      if (r.status === 'actioned') row.approved += 1;
      else if (r.status === 'rejected') row.rejected += 1;
      else if (r.status === 'escalated') row.escalated += 1;
      const t = r.targetType || 'unknown';
      row.targetTypeBreakdown[t] = (row.targetTypeBreakdown[t] || 0) + 1;
      const ts = toMs(r.resolvedAt) || 0;
      if (ts > row.lastActionAt) row.lastActionAt = ts;
      byUid.set(moduid, row);
    }

    // 2. Hydrate profiles
    const uids = [...byUid.keys()];
    const profiles = {};
    if (uids.length > 0) {
      const snaps = await Promise.all(uids.map(u => db.collection('users').doc(u).get()));
      snaps.forEach((s, i) => {
        if (s.exists) {
          const p = s.data();
          profiles[uids[i]] = {
            displayName: p.displayName || null,
            username: p.username || null,
            avatar: p.avatar || null,
            role: p.role || null,
            vanguardRank: p.vanguard?.rank || null,
          };
        }
      });
    }

    // 3. Compute a moderation score per moderator
    //   score = 100 - (escalateRate*30 + (1-approve_or_reject_clarity)*20)
    //   Where escalateRate = escalated / total
    //   approve_or_reject_clarity = (approved + rejected) / total
    // Cap [0,100].
    const rows = Array.from(byUid.values()).map(r => {
      const escalateRate = r.total > 0 ? r.escalated / r.total : 0;
      const clarity = r.total > 0 ? (r.approved + r.rejected) / r.total : 0;
      const score = Math.max(0, Math.min(100, 100 - (escalateRate * 30) - ((1 - clarity) * 20)));
      return {
        ...r,
        score: Math.round(score),
        moderator: profiles[r.uid] || null,
      };
    }).sort((a, b) => b.total - a.total);

    return { rows, windowSinceMs: since.getTime(), windowEndMs: Date.now() };
  }
);

// ── APPEALS ──────────────────────────────────────────────────────────
//
// User submits an appeal when their content was hidden / they were
// muted / banned via a moderation action. Appeals collection schema:
//   appeals/{auto} = {
//     reportId?,             // when the appeal points at a specific report
//     targetType,            // 'post' | 'user' | 'comment' | 'stream' (mirror of reports)
//     targetId,
//     userId,                // the appealing user (always the affected party)
//     appealText,            // max 1500 chars
//     status: 'pending' | 'upheld' | 'overturned' | 'dismissed',
//     priority: 'normal',
//     createdAt,
//     resolvedBy?, resolvedAt?, resolutionReason?
//   }
// Appeals are user-submitted; admins read + resolve. User can submit
// at most one pending appeal per reportId (enforced server-side).

exports.adminListAppeals = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { filters = {}, cursor = null, pageSize = 50 } = request.data || {};
    const limit = Math.min(200, Math.max(1, pageSize));

    let q = db.collection('appeals').orderBy('createdAt', 'desc');
    if (filters.status) q = q.where('status', '==', filters.status);
    if (filters.targetType) q = q.where('targetType', '==', filters.targetType);
    if (filters.userId) q = q.where('userId', '==', filters.userId);

    if (cursor) {
      const cs = await db.collection('appeals').doc(cursor).get();
      if (cs.exists) q = q.startAfter(cs);
    }

    const snap = await q.limit(limit).get().catch(() => ({ docs: [] }));
    const rows = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        reportId: data.reportId || null,
        targetType: data.targetType || null,
        targetId: data.targetId || null,
        userId: data.userId || null,
        appealText: data.appealText || '',
        status: data.status || 'pending',
        priority: data.priority || 'normal',
        createdAt: toMs(data.createdAt),
        resolvedBy: data.resolvedBy || null,
        resolvedAt: toMs(data.resolvedAt),
        resolutionReason: data.resolutionReason || null,
      };
    });

    // Hydrate appealing-user profiles
    const userUids = [...new Set(rows.map(r => r.userId).filter(Boolean))];
    const profiles = {};
    if (userUids.length > 0) {
      const snaps = await Promise.all(userUids.map(u => db.collection('users').doc(u).get()));
      snaps.forEach((s, i) => {
        if (s.exists) {
          const p = s.data();
          profiles[userUids[i]] = {
            displayName: p.displayName || null,
            username: p.username || null,
            avatar: p.avatar || null,
            banned: !!p.banned,
            mutedUntil: toMs(p.mutedUntil),
          };
        }
      });
    }

    const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;
    return { rows: rows.map(r => ({ ...r, user: profiles[r.userId] || null })), nextCursor };
  }
);

exports.adminGetAppealDetail = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { appealId } = request.data || {};
    if (!appealId) throw new HttpsError('invalid-argument', 'appealId required');

    const snap = await db.collection('appeals').doc(appealId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Appeal not found');
    const a = snap.data();

    let report = null;
    if (a.reportId) {
      const rs = await db.collection('reports').doc(a.reportId).get();
      if (rs.exists) {
        const r = rs.data();
        report = {
          id: rs.id,
          targetType: r.targetType,
          targetId: r.targetId,
          reason: r.reason,
          status: r.status,
          priority: r.priority,
          resolvedBy: r.resolvedBy,
          resolvedAt: toMs(r.resolvedAt),
          resolutionReason: r.resolutionReason,
          createdAt: toMs(r.createdAt),
        };
      }
    }

    let user = null;
    if (a.userId) {
      const us = await db.collection('users').doc(a.userId).get();
      if (us.exists) {
        const p = us.data();
        user = {
          uid: us.id,
          displayName: p.displayName || null,
          username: p.username || null,
          avatar: p.avatar || null,
          banned: !!p.banned,
          banReason: p.banReason || null,
          banUntil: toMs(p.banUntil),
          mutedUntil: toMs(p.mutedUntil),
          createdAt: toMs(p.createdAt),
        };
      }
    }

    return {
      appeal: {
        id: snap.id,
        ...a,
        createdAt: toMs(a.createdAt),
        resolvedAt: toMs(a.resolvedAt),
      },
      report,
      user,
    };
  }
);

const APPEAL_DECISIONS = ['upheld', 'overturned', 'dismissed'];

exports.adminResolveAppeal = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_resolve_appeal', { perHour: 100, perDay: 500 });

    const { appealId, decision, reason = '' } = request.data || {};
    if (!appealId) throw new HttpsError('invalid-argument', 'appealId required');
    if (!APPEAL_DECISIONS.includes(decision)) {
      throw new HttpsError('invalid-argument', `decision must be one of: ${APPEAL_DECISIONS.join(', ')}`);
    }
    if (!reason || String(reason).trim().length < 4) {
      throw new HttpsError('invalid-argument', 'reason required (min 4 chars)');
    }

    const ref = db.collection('appeals').doc(appealId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Appeal not found');
    const a = snap.data();
    if (a.status !== 'pending') {
      throw new HttpsError('failed-precondition', `Already ${a.status}`);
    }

    await ref.update({
      status: decision,
      resolvedBy: uid,
      resolvedAt: FieldValue.serverTimestamp(),
      resolutionReason: String(reason).slice(0, 500),
    });

    // 'overturned' means the original moderation action was wrong — auto-restore
    // the affected target where we can.
    if (decision === 'overturned') {
      try {
        if (a.targetType === 'post' && a.targetId) {
          await db.collection('posts').doc(a.targetId).update({
            status: 'visible',
            hiddenReason: null,
            restoredAt: FieldValue.serverTimestamp(),
            restoredBy: uid,
          });
        } else if (a.targetType === 'stream' && a.targetId) {
          // Streams can't really be un-ended; mark only.
          await db.collection('streams').doc(a.targetId).update({
            appealOverturned: true,
            appealOverturnedAt: FieldValue.serverTimestamp(),
          });
        }
        // For target=user: we don't auto-unban. Admin should go to the
        // users screen and manually lift the ban — too easy to fat-finger
        // a permaban undo otherwise.
      } catch { /* swallow — appeal status already updated */ }
    }

    // Mark the linked report (if any) so the resolved-reports view can show "appealed"
    if (a.reportId) {
      await db.collection('reports').doc(a.reportId).update({
        hasAppeal: true,
        appealStatus: decision,
      }).catch(() => null);
    }

    // Notify the appealing user
    if (a.userId) {
      await db.collection('notifications').doc().set({
        recipientId: a.userId,
        type: 'appeal_resolved',
        title: decision === 'overturned' ? 'Appeal approved' :
               decision === 'upheld'     ? 'Appeal denied' :
                                            'Appeal dismissed',
        body: decision === 'overturned'
          ? 'We reviewed your appeal and reversed the original decision.'
          : decision === 'upheld'
            ? 'We reviewed your appeal and the original decision stands.'
            : 'Your appeal was closed without review (typically: insufficient detail).',
        read: false,
        data: { appealId, decision },
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'admin_resolve_appeal',
      target: { type: 'appeal', id: appealId },
      before: { status: 'pending' },
      after:  { status: decision },
      reason,
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
      meta: { reportId: a.reportId || null, targetType: a.targetType, targetId: a.targetId },
    });

    return { ok: true, decision };
  }
);

// User-side callable: submit an appeal. Lives here (admin module) because
// the schema is admin-owned, but the auth check is just isAuth — no admin
// gate. One pending appeal per reportId.
exports.submitAppeal = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
    const { reportId = null, targetType, targetId, appealText } = request.data || {};
    if (!targetType || !targetId) {
      throw new HttpsError('invalid-argument', 'targetType, targetId required');
    }
    if (!appealText || String(appealText).trim().length < 20) {
      throw new HttpsError('invalid-argument', 'appealText required (min 20 chars)');
    }

    // Dedupe: one pending appeal per (userId, reportId or targetId).
    let dupeQ = db.collection('appeals').where('userId', '==', uid).where('status', '==', 'pending');
    if (reportId) dupeQ = dupeQ.where('reportId', '==', reportId);
    else dupeQ = dupeQ.where('targetType', '==', targetType).where('targetId', '==', targetId);
    const dupe = await dupeQ.limit(1).get().catch(() => ({ empty: true }));
    if (!dupe.empty) {
      throw new HttpsError('already-exists', 'You already have a pending appeal for this.');
    }

    const ref = db.collection('appeals').doc();
    await ref.set({
      reportId: reportId || null,
      targetType, targetId,
      userId: uid,
      appealText: String(appealText).trim().slice(0, 1500),
      status: 'pending',
      priority: 'normal',
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, appealId: ref.id };
  }
);

// ── POLICY SETTINGS ─────────────────────────────────────────────────
//
// Stored under app_config/general.moderation. Read by every server-side
// moderation flow at decision time (auto-hide threshold etc).

const MOD_POLICY_DEFAULTS = {
  autoHideReportThreshold: 5,        // # of pending reports on same target before auto-hide
  defaultMuteHours: 24,
  defaultTempBanDays: 7,
  appealWindowDays: 14,
  // Free-text moderator handbook content (rendered on /vanguard/me → Handbook tab).
  // Limited to 8000 chars so it stays cache-friendly on every load.
  handbookMarkdown: '',
};

const MOD_POLICY_VALIDATORS = {
  autoHideReportThreshold: v => Number.isInteger(v) && v >= 1 && v <= 100,
  defaultMuteHours: v => Number.isInteger(v) && v >= 1 && v <= 720,
  defaultTempBanDays: v => Number.isInteger(v) && v >= 1 && v <= 365,
  appealWindowDays: v => Number.isInteger(v) && v >= 1 && v <= 90,
  handbookMarkdown: v => typeof v === 'string' && v.length <= 8000,
};

exports.adminGetModerationPolicySettings = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const snap = await db.collection('app_config').doc('general').get();
    const stored = (snap.exists ? snap.data() : {}).moderation || {};
    return { settings: { ...MOD_POLICY_DEFAULTS, ...stored } };
  }
);

exports.adminSetModerationPolicySettings = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_set_moderation_policy', { perHour: 30, perDay: 100 });

    const incoming = request.data?.settings || {};
    const next = {};
    for (const [k, v] of Object.entries(incoming)) {
      const validate = MOD_POLICY_VALIDATORS[k];
      if (!validate) throw new HttpsError('invalid-argument', `Unknown setting: ${k}`);
      if (!validate(v)) throw new HttpsError('invalid-argument', `Invalid value for ${k}`);
      next[k] = v;
    }
    if (Object.keys(next).length === 0) throw new HttpsError('invalid-argument', 'No fields to update');

    const ref = db.collection('app_config').doc('general');
    const before = (await ref.get()).data()?.moderation || {};
    const after = { ...MOD_POLICY_DEFAULTS, ...before, ...next };
    await ref.set({ moderation: after, _updatedAt: FieldValue.serverTimestamp(), _updatedBy: uid }, { merge: true });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'admin_set_moderation_policy',
      target: { type: 'app_config', id: 'general' },
      before: { moderation: before }, after: { moderation: after },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    });
    return { ok: true, settings: after };
  }
);
