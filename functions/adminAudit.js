// adminAudit.js — Admin → Audit Log screen callables.
//
// Read-only over admin_actions/. Founders see everything. Sub-admins can read
// the full log if they have the 'audit' screen scope, but exports are limited
// to their own actions unless they're a founder.
//
// Callables:
//   adminListAuditActions({ filters, cursor, pageSize })
//   adminGetAuditDetail({ actionId })
//   adminGetAuditFacets()        - distinct actor uids + action names + target types
//   adminExportAuditCsv({ filters })  - returns CSV text (small batches only)

const functions = require('firebase-functions/v2');
const { getFirestore } = require('firebase-admin/firestore');
const { requireAdminScreen } = require('./adminAccess');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

async function guardCaller(uid) {
  return await requireAdminScreen(uid, 'audit');
}

function toRow(d) {
  const data = d.data() || {};
  return {
    id: d.id,
    actor:  data.actor || null,
    action: data.action || 'unknown',
    target: data.target || null,
    reason: data.reason || null,
    before: data.before ?? null,
    after:  data.after  ?? null,
    ip:     data.ip || null,
    userAgent: data.userAgent || null,
    stepUpEnforced: !!data.stepUpEnforced,
    stepUpFresh:    !!data.stepUpFresh,
    meta:   data.meta || null,
    createdAt: data.createdAt?.toMillis?.() || null,
  };
}

// ════════════════════════════════════════════════════════════════════
// LIST
// ════════════════════════════════════════════════════════════════════

exports.adminListAuditActions = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);

    const { filters = {}, cursor = null, pageSize = 50 } = request.data || {};
    const limit = Math.min(200, Math.max(1, pageSize));

    let q = db.collection('admin_actions').orderBy('createdAt', 'desc');

    if (filters.actorUid) q = q.where('actor.uid', '==', filters.actorUid);
    if (filters.action)   q = q.where('action', '==', filters.action);
    if (filters.targetType) q = q.where('target.type', '==', filters.targetType);
    if (filters.targetId)   q = q.where('target.id',   '==', filters.targetId);
    if (filters.startAt) q = q.where('createdAt', '>=', new Date(filters.startAt));
    if (filters.endAt)   q = q.where('createdAt', '<=', new Date(filters.endAt));

    if (cursor) {
      const cs = await db.collection('admin_actions').doc(cursor).get();
      if (cs.exists) q = q.startAfter(cs);
    }

    const snap = await q.limit(limit).get();
    const rows = snap.docs.map(toRow);

    // Hydrate actor display fields from users collection (one-shot batch).
    const uids = Array.from(new Set(rows.map(r => r.actor?.uid).filter(Boolean)));
    const profiles = {};
    if (uids.length > 0) {
      const chunks = [];
      for (let i = 0; i < uids.length; i += 10) chunks.push(uids.slice(i, i + 10));
      for (const chunk of chunks) {
        const snaps = await Promise.all(chunk.map(u => db.collection('users').doc(u).get()));
        snaps.forEach((s, i) => {
          if (s.exists) {
            const p = s.data();
            profiles[chunk[i]] = {
              displayName: p.displayName || null,
              avatar:      p.avatar || null,
              role:        p.role || null,
            };
          }
        });
      }
    }

    const enriched = rows.map(r => ({
      ...r,
      actorProfile: r.actor?.uid ? (profiles[r.actor.uid] || null) : null,
    }));

    const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;
    return { rows: enriched, nextCursor };
  }
);

exports.adminGetAuditDetail = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { actionId } = request.data || {};
    if (!actionId) throw new HttpsError('invalid-argument', 'actionId required');
    const snap = await db.collection('admin_actions').doc(actionId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Action not found');
    const row = toRow(snap);
    if (row.actor?.uid) {
      const p = await db.collection('users').doc(row.actor.uid).get();
      row.actorProfile = p.exists ? {
        displayName: p.data().displayName || null,
        avatar:      p.data().avatar || null,
        role:        p.data().role || null,
      } : null;
    }
    return row;
  }
);

// Distinct facet values for the filter dropdowns. Reads the latest 500 rows —
// not exhaustive but good enough for a populated dropdown.
exports.adminGetAuditFacets = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const snap = await db.collection('admin_actions')
      .orderBy('createdAt', 'desc').limit(500).get();
    const actors = new Map();
    const actions = new Set();
    const targets = new Set();
    snap.docs.forEach(d => {
      const r = d.data();
      if (r.actor?.uid) actors.set(r.actor.uid, r.actor.displayName || null);
      if (r.action) actions.add(r.action);
      if (r.target?.type) targets.add(r.target.type);
    });
    return {
      actors: Array.from(actors.entries()).map(([uid, displayName]) => ({ uid, displayName })),
      actions: Array.from(actions).sort(),
      targetTypes: Array.from(targets).sort(),
    };
  }
);

// CSV export — capped at 5000 rows to keep response size sane. Larger exports
// should land in a future R2-backed async job.
exports.adminExportAuditCsv = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    const { isFounder } = await guardCaller(uid);
    const { filters = {} } = request.data || {};

    let q = db.collection('admin_actions').orderBy('createdAt', 'desc');
    // Sub-admins can only export their own actions.
    if (!isFounder) q = q.where('actor.uid', '==', uid);
    if (filters.actorUid && isFounder) q = q.where('actor.uid', '==', filters.actorUid);
    if (filters.action)   q = q.where('action', '==', filters.action);
    if (filters.targetType) q = q.where('target.type', '==', filters.targetType);
    if (filters.startAt) q = q.where('createdAt', '>=', new Date(filters.startAt));
    if (filters.endAt)   q = q.where('createdAt', '<=', new Date(filters.endAt));

    const snap = await q.limit(5000).get();
    const escape = (v) => {
      if (v == null) return '';
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    const header = ['id', 'at', 'actor_uid', 'actor_name', 'action', 'target_type', 'target_id',
      'reason', 'ip', 'stepUpEnforced', 'stepUpFresh'];
    const lines = [header.join(',')];
    snap.docs.forEach(d => {
      const r = d.data();
      lines.push([
        d.id,
        r.createdAt?.toDate?.()?.toISOString() || '',
        r.actor?.uid || '',
        r.actor?.displayName || '',
        r.action || '',
        r.target?.type || '',
        r.target?.id || '',
        r.reason || '',
        r.ip || '',
        r.stepUpEnforced ? 'true' : 'false',
        r.stepUpFresh ? 'true' : 'false',
      ].map(escape).join(','));
    });

    return {
      csv: lines.join('\n'),
      rowCount: snap.docs.length,
      truncated: snap.docs.length === 5000,
    };
  }
);
