// VERGR streaming cleanup — two responsibilities:
//
//   1. Auto-trigger vergr-cohost composite on Multi-Guest link/unlink.
//      Firestore trigger on streams/{streamId}: when `compositeOwner` becomes
//      set on a stream where this stream IS the composite owner, POST the
//      launcher to start the systemd unit. When it's cleared, POST stop.
//
//   2. R2 segment cleanup. Hourly cron deletes HLS segments for streams that
//      have ended >24h ago (or orphan segments with no doc backing, >6h).
//      Saves Class A delete ops by batching DeleteObjects in groups of 1000.
//
// Both wired together here because they share the streams collection.

const functions = require('firebase-functions/v2');
const { defineSecret, defineString } = require('firebase-functions/params');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const HOST_OPS_TOKEN = defineSecret('HOST_OPS_TOKEN');
const R2_ACCESS_KEY_ID     = defineSecret('R2_ACCESS_KEY_ID');
const R2_SECRET_ACCESS_KEY = defineSecret('R2_SECRET_ACCESS_KEY');
const R2_ACCOUNT_ID = defineString('R2_ACCOUNT_ID');

// Public URL of the launcher (must be HTTPS, behind Cloudflare DNS-only).
// Set via runtime env in firebase functions:config:set if you prefer.
const LAUNCHER_BASE = process.env.COHOST_LAUNCHER_BASE || 'https://cohost.vergr.app';
// vergr-vod-archive (box2). Same base the tournament pipeline posts to.
const VOD_LAUNCHER_BASE = process.env.VOD_LAUNCHER_BASE || 'https://archive.vergr.app';

// Trim trailing whitespace/newlines from all R2 secrets — past R2 outage
// root-caused to trailing \n. See CLAUDE.md "If R2 uploads fail" section.
function env(secret) {
  const v = secret?.value?.() ?? secret;
  return typeof v === 'string' ? v.trim() : v;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) Co-host auto-trigger.
// ─────────────────────────────────────────────────────────────────────────────
exports.triggerCohostComposite = onDocumentWritten(
  { region: REGION, document: 'streams/{streamId}', database: 'vgrdb', secrets: [HOST_OPS_TOKEN] },
  async (event) => {
    const streamId = event.params.streamId;
    const before = event.data?.before?.data() || null;
    const after  = event.data?.after?.data() || null;
    if (!after) return; // deletion — handled by endStreamSession

    const wasOwner = before && before.compositeOwner === streamId;
    const isOwner  = after.compositeOwner === streamId;

    // Become composite owner → start ffmpeg.
    if (!wasOwner && isOwner) {
      try {
        await fetch(`${LAUNCHER_BASE}/cohost/start`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env(HOST_OPS_TOKEN)}`,
          },
          body: JSON.stringify({
            streamId,
            streamKey: after.streamKey,
            roomId: `ingest_${streamId}`,
            hostUid: after.hostUid,
            // Portrait composite (TikTok-style stacked/grid) for mobile-origin
            // streams; landscape for desktop/OBS. Defaults landscape.
            orientation: after.orientation === 'portrait' ? 'portrait' : 'landscape',
          }),
        });
        console.log(`cohost composite started for ${streamId}`);
      } catch (err) {
        console.error(`cohost start ${streamId} failed:`, err);
      }
    }

    // Stop becoming owner OR stream ended → stop ffmpeg.
    const wasLive = before && before.status === 'live';
    const endedOrUnlinked =
      (wasOwner && !isOwner) ||
      (wasLive && after.status === 'ended' && wasOwner);

    if (endedOrUnlinked) {
      try {
        await fetch(`${LAUNCHER_BASE}/cohost/stop`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env(HOST_OPS_TOKEN)}`,
          },
          body: JSON.stringify({ streamId }),
        });
        console.log(`cohost composite stopped for ${streamId}`);
      } catch (err) {
        console.error(`cohost stop ${streamId} failed:`, err);
      }
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 2) R2 segment cleanup cron — hourly.
// ─────────────────────────────────────────────────────────────────────────────
// Runs inside a dispatcher cron in index.js (it was its own Cloud Scheduler
// job, and every job past the first three is billed monthly).
exports.cleanupExpiredStreamSegments = async function cleanupExpiredStreamSegments() {
    const accountId = env(R2_ACCOUNT_ID);
    const accessKey = env(R2_ACCESS_KEY_ID);
    const secret    = env(R2_SECRET_ACCESS_KEY);
    if (!accountId || !accessKey || !secret) {
      console.warn('R2 secrets missing — skipping cleanup');
      return;
    }
    const bucket = 'vergr-media';
    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: accessKey, secretAccessKey: secret },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });

    const now = Date.now();
    const ENDED_TTL_MS  = 24 * 60 * 60 * 1000; // 24h after end (normal streams)
    const TOURNAMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d after winner declared
    const ORPHAN_TTL_MS = 6  * 60 * 60 * 1000; // 6h for orphans

    // Index live stream-keys to recognize orphans.
    const liveSnap = await db.collection('streams')
      .where('status', 'in', ['live', 'created'])
      .get();
    const liveKeys = new Set(liveSnap.docs.map((d) => d.data().streamKey).filter(Boolean));

    // Index recently-ended stream-keys and their endedAt.
    // Tournament-linked streams get a 7-day TTL after the linked match's
    // winner is declared (kept for second-mod review). They're retained at
    // forced low quality (480p) — see BroadcasterScreen tournament gate.
    const endedSnap = await db.collection('streams')
      .where('status', '==', 'ended')
      .get();
    const endedKeyToEndedAt = new Map();
    const tournamentLinkedKeys = new Set();
    // Keys under a live replay hold. A Pro past broadcast IS the HLS manifest
    // and segments already sitting under streams/<key>/ — vergr-ingest writes
    // #EXT-X-ENDLIST when it finalizes, and r2-sync only ever copies. So the
    // replay costs nothing to produce; the only thing that ever killed it was
    // this sweep deleting the segments at 24h. Holding them until vodExpiresAt
    // is the whole feature. See functions/vodArchive.js.
    const replayHeldKeys = new Map(); // streamKey → expiry ms
    for (const d of endedSnap.docs) {
      const data = d.data();
      const ms = data.endedAt?.toMillis?.();
      if (data.streamKey && ms) endedKeyToEndedAt.set(data.streamKey, ms);
      if (data.streamKey && (data.tournamentMatchId || data.tournamentId)) {
        tournamentLinkedKeys.add(data.streamKey);
      }
      const expiry = data.vodExpiresAt?.toMillis?.();
      if (data.streamKey && expiry && data.vodKind === 'hls') {
        replayHeldKeys.set(data.streamKey, expiry);
      }
    }

    // List under streams/ prefix and group by first path segment (streamKey).
    const keysByStream = new Map(); // streamKey → [objectKeys]
    let continuationToken;
    do {
      const out = await s3.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: 'streams/',
        ContinuationToken: continuationToken,
      }));
      for (const obj of out.Contents || []) {
        const parts = obj.Key.split('/');
        if (parts.length < 3) continue;
        const streamKey = parts[1];
        if (!keysByStream.has(streamKey)) keysByStream.set(streamKey, []);
        keysByStream.get(streamKey).push(obj.Key);
      }
      continuationToken = out.IsTruncated ? out.NextContinuationToken : null;
    } while (continuationToken);

    // Decide which streamKeys to delete.
    const deleteKeys = [];
    for (const [streamKey, objects] of keysByStream.entries()) {
      if (liveKeys.has(streamKey)) continue;
      // A Pro replay is served straight from these objects, so they outlive the
      // 24h sweep until the retention window closes. Once vodExpiresAt passes,
      // this stops matching and the normal TTL below deletes them on the same
      // run that block 2c clears the replay fields off the doc.
      const heldUntil = replayHeldKeys.get(streamKey);
      if (heldUntil && heldUntil > now) continue;
      const endedAt = endedKeyToEndedAt.get(streamKey);
      const ttl = tournamentLinkedKeys.has(streamKey) ? TOURNAMENT_TTL_MS : ENDED_TTL_MS;
      if (endedAt && (now - endedAt) >= ttl) {
        deleteKeys.push(...objects);
        continue;
      }
      if (!endedAt) {
        // Orphan (no live, no ended) — older content goes after 6h.
        // We use LastModified as the heuristic but for simplicity, treat
        // all orphans on this pass as eligible after the TTL would have passed
        // had they been ended; you could refine by inspecting LastModified.
        deleteKeys.push(...objects);
        continue;
      }
    }

    // Batch delete in groups of 1000 (R2 / S3 API limit).
    let deleted = 0;
    for (let i = 0; i < deleteKeys.length; i += 1000) {
      const batch = deleteKeys.slice(i, i + 1000).map((Key) => ({ Key }));
      await s3.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch, Quiet: true },
      }));
      deleted += batch.length;
    }

    // ── 2b) Past-broadcast archive retry ──────────────────────────────────
    // The raw segments a VOD is built from are deleted 24h after the stream
    // ends (above), so a failed archive has exactly that long to recover. The
    // dispatch trigger clears archiveDispatchedAt on failure; pick those up.
    let retried = 0;
    const RETRY_WINDOW_MS = 20 * 60 * 60 * 1000; // stay clear of the 24h delete
    for (const d of endedSnap.docs) {
      const s = d.data();
      if (!s.vodPending || s.archiveVodUrl || s.gatedVodUrl || s.archiveDispatchedAt) continue;
      if (s.tournamentMatchId) continue;
      const endedMs = s.endedAt?.toMillis?.() || 0;
      if (!endedMs || (now - endedMs) > RETRY_WINDOW_MS) continue;
      if (!s.hlsUrl || !s.streamKey) continue;
      try {
        const res = await fetch(`${VOD_LAUNCHER_BASE}/archive`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env(HOST_OPS_TOKEN)}`,
          },
          body: JSON.stringify({
            sourceHls: s.hlsUrl,
            streamKey: s.streamKey,
            targetKey: `vods/${d.id}.mp4`,
            streamId: d.id,
            mode: s.hostPlan === 'pro' ? 'copy' : undefined,
            crf: 28,
            callbackUrl: `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/markVodArchived`,
          }),
        });
        if (!res.ok) throw new Error(`launcher returned ${res.status}`);
        await d.ref.update({ archiveDispatchedAt: FieldValue.serverTimestamp() });
        retried++;
      } catch (err) {
        console.error('vod archive retry failed', d.id, err);
      }
    }

    // ── 2c) Expired past-broadcast purge ──────────────────────────────────
    // vodExpiresAt is stamped at stream end from the host's plan (free 7d /
    // lite 30d / pro 90d, overridable in app_config). Single-field inequality,
    // so no composite index; docs without the field never match.
    let vodsPurged = 0;
    const expiredSnap = await db.collection('streams')
      .where('vodExpiresAt', '<=', new Date(now))
      .limit(200)
      .get();
    if (!expiredSnap.empty) {
      const vodKeys = expiredSnap.docs.map((d) => ({ Key: `vods/${d.id}.mp4` }));
      for (let i = 0; i < vodKeys.length; i += 1000) {
        await s3.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: vodKeys.slice(i, i + 1000), Quiet: true },
        }));
      }
      // Clear the fields so the replay button disappears and the doc stops
      // matching this query. vodExpired keeps the ended screen honest ("the
      // replay is gone") rather than pretending the stream never had one.
      const batch = db.batch();
      for (const d of expiredSnap.docs) {
        batch.update(d.ref, {
          archiveVodUrl: FieldValue.delete(),
          gatedVodUrl: FieldValue.delete(),   // restricted streams park the url here
          vodExpiresAt: FieldValue.delete(),
          vodPending: FieldValue.delete(),
          vodExpired: true,
        });
      }
      await batch.commit();
      vodsPurged = expiredSnap.size;
    }

    await db.collection('streaming_cleanup_logs').add({
      ranAt: FieldValue.serverTimestamp(),
      keysScanned: Array.from(keysByStream.keys()).length,
      deletedCount: deleted,
      vodsPurged,
      vodRetries: retried,
    });
    console.log(`R2 cleanup: deleted ${deleted} objects across ${keysByStream.size} stream-keys; vods purged ${vodsPurged}, archives retried ${retried}`);
  };
