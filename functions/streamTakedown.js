// streamTakedown.js: ending SOMEONE ELSE'S live stream. A module, not a Cloud
// Function: it is called from functions that already exist (endStreamSession,
// adminResolveReport), so it adds no deployed function and no image.
//
// ⚠⚠ WHY THIS EXISTS. Until 2026-09-21 an admin "ending" a stream wrote
// `status: 'ended_by_admin'` and nothing else. No screen knew that status: the
// viewers kept showing the stream, the broadcaster kept broadcasting, and
// neither streaming server re-checks the document after it starts, so the video
// kept reaching the CDN. A takedown that stops nothing.
//
// Now a takedown writes the SAME `status: 'ended'` a host's own end writes,
// which every viewer, both broadcasters and the segment cleanup already obey,
// plus `takenDownAt`. The two ingest servers act on that marker:
//   • vergr-rtmp-auth (OBS): its watchdog already re-reads each live stream's
//     document every tick for quality boosts, and now drops the publisher when
//     it sees `takenDownAt`. No extra read.
//   • vergr-ingest (browser): a query listener on `takenDownAt >= start`, which
//     only returns a document when a takedown happens, then drops the session.
//
// ⚠ A takedown skips the host's end-of-stream rewards (hype-train settlement,
// VP, stream minutes): those run in endStreamSession for a host ending their
// own stream, which now returns `alreadyEnded`. That is deliberate for a stream
// removed for breaking the rules.

const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');

const db = getFirestore('vgrdb');

const LIVE_STATES = new Set(['live', 'created']);

/**
 * @param {object} p
 * @param {string} p.streamId
 * @param {string} p.byUid     the operator, sub-admin or moderator ending it
 * @param {string} p.reason    shown to the host; required
 * @param {string} p.source    'admin_direct' | 'admin_report' | 'vanguard_report' | ...
 * @returns {{ ok: true, alreadyEnded?: true, hostUid?: string }}
 */
async function takedownStream({ streamId, byUid, reason, source }) {
  if (!streamId) throw new HttpsError('invalid-argument', 'streamId required');
  const why = String(reason || '').trim();
  if (why.length < 4) throw new HttpsError('invalid-argument', 'A reason (4+ characters) is required. The host is shown it.');

  const ref = db.collection('streams').doc(streamId);
  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Stream not found');
    const s = snap.data() || {};
    if (!LIVE_STATES.has(s.status)) return { ok: true, alreadyEnded: true, hostUid: s.hostUid || null };
    tx.update(ref, {
      status: 'ended',
      endedAt: FieldValue.serverTimestamp(),
      endedReason: 'takedown',
      takenDownAt: FieldValue.serverTimestamp(),
      takedownReason: why.slice(0, 300),
      takedownSource: source || 'admin_direct',
    });
    return { ok: true, hostUid: s.hostUid || null, title: s.title || '' };
  });

  if (!out.alreadyEnded && out.hostUid) {
    await db.collection('notifications').add({
      recipientId: out.hostUid,
      type: 'stream_taken_down',
      title: 'Your live stream was ended',
      body: `Vergr ended your stream${out.title ? ` "${out.title.slice(0, 60)}"` : ''}: ${why.slice(0, 200)}. If you think this is wrong, you can appeal.`,
      link: `/appeal?type=stream&id=${encodeURIComponent(streamId)}`,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    }).catch(() => null);
  }
  return out;
}

module.exports = { takedownStream };
