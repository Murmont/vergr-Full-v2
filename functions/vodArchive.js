// VERGR tournament VOD archive transcode pipeline.
//
// Flow:
//   1. Stream ends → onDocumentWritten trigger fires.
//   2. If stream is tournament-linked (tournamentMatchId set), POST to the
//      Hetzner `vergr-vod-archive` launcher with the source HLS playlist
//      URL + target R2 key.
//   3. Hetzner runs ffmpeg: HLS → single 480p H.264 MP4 (CRF 28, AAC 64k).
//      Upload to R2 at archives/tournaments/{matchId}.mp4.
//   4. Hetzner calls back `markVodArchived` with the R2 URL.
//   5. Cloud Function writes `archiveVodUrl` on the match doc.
//
// This unblocks `aiCheatFlagVod` + `autoCutVodHighlights` + the 7-day
// retention path in streamingCleanup.js.

const functions = require('firebase-functions/v2');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const HOST_OPS_TOKEN = defineSecret('HOST_OPS_TOKEN');
const VOD_LAUNCHER_BASE = process.env.VOD_LAUNCHER_BASE || 'https://archive.vergr.app';

// Fires when a stream's status transitions to 'ended' AND it's a tournament
// stream. Idempotent: skips if archiveDispatchedAt already set.
exports.dispatchTournamentVodArchive = onDocumentWritten(
  { region: REGION, document: 'streams/{streamId}', database: 'vgrdb', secrets: [HOST_OPS_TOKEN] },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;
    if (before?.status === 'ended') return;          // already past the transition
    if (after.status !== 'ended') return;
    if (!after.tournamentMatchId) return;            // not a tournament stream
    if (after.archiveDispatchedAt) return;           // already dispatched

    const streamId = event.params.streamId;
    const matchId = after.tournamentMatchId;
    const tournamentId = after.tournamentId;

    // Mark dispatched first → idempotent even on retry.
    await event.data.after.ref.update({
      archiveDispatchedAt: FieldValue.serverTimestamp(),
    });

    try {
      const res = await fetch(`${VOD_LAUNCHER_BASE}/archive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${HOST_OPS_TOKEN.value()}`,
        },
        body: JSON.stringify({
          sourceHls: after.hlsUrl,
          streamKey: after.streamKey,
          targetKey: `archives/tournaments/${matchId}.mp4`,
          tournamentId, matchId, streamId,
          maxResolution: '480p', crf: 28,
          callbackUrl: `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/markVodArchived`,
        }),
      });
      if (!res.ok) throw new Error(`launcher returned ${res.status}`);
    } catch (err) {
      console.error('vod archive dispatch failed', streamId, err);
      // Allow retry by clearing the dispatch flag.
      await event.data.after.ref.update({
        archiveDispatchedAt: null,
        archiveError: String(err.message || err).slice(0, 200),
      });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Past broadcasts (regular streams).
//
// The ended stream is ALREADY replayable: when vergr-ingest finalizes a session
// it rewrites index.m3u8 with every segment plus #EXT-X-ENDLIST, and r2-sync
// only ever copies (never deletes), so the full VOD manifest sits on R2. What
// it does NOT survive is streamingCleanup, which deletes streams/<key>/* 24h
// after the stream ends. So we archive to a single MP4 that outlives it.
//
// Past broadcasts are a PRO-ONLY feature (founder decision 2026-07-14).
// Free and Lite streams are not archived at all — their retention is 0 days, so
// the dispatch below returns before any ffmpeg work happens. A Pro replay is a
// 'copy' remux at source quality: no re-encode, ~no CPU, but a file as large as
// the broadcast, which is exactly why it isn't given away on the free tiers.
// Retention is overridable at runtime via app_config/general.streamVodRetentionDays
// so storage can be dialled back without a redeploy.
//
// Scope limit (deliberate): only browser/fMP4 ingest is archived. OBS/RTMP goes
// through nginx-rtmp, whose playlist is a sliding ~18s window even after the
// stream ends, so archiving it would yield an 18-second "replay". Reconstructing
// a full playlist from the R2 object listing is a separate build.
const VOD_MIN_SECONDS = 120;              // don't archive a 30-second false start
const DEFAULT_RETENTION_DAYS = { free: 0, lite: 0, pro: 90 };  // 0 = never archived
const ARCHIVABLE_INGEST = new Set(['browser', 'fmp4']);

function retentionDaysFor(plan, cfg) {
  const override = cfg?.streamVodRetentionDays || {};
  const days = override[plan] ?? DEFAULT_RETENTION_DAYS[plan] ?? DEFAULT_RETENTION_DAYS.free;
  return Math.max(0, Number(days) || 0);
}

exports.dispatchStreamVodArchive = onDocumentWritten(
  { region: REGION, document: 'streams/{streamId}', database: 'vgrdb', secrets: [HOST_OPS_TOKEN] },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;
    if (before?.status === 'ended') return;   // already past the transition
    if (after.status !== 'ended') return;
    if (after.tournamentMatchId) return;      // tournament path handles these
    if (after.archiveDispatchedAt) return;    // idempotent
    if (after.archiveVodUrl || after.gatedVodUrl) return;
    if (!ARCHIVABLE_INGEST.has(after.ingestType)) return;
    if (!after.hlsUrl || !after.streamKey) return;

    const startedMs = after.startedAt?.toMillis?.() ?? 0;
    const endedMs = after.endedAt?.toMillis?.() ?? Date.now();
    const durationSec = startedMs ? Math.round((endedMs - startedMs) / 1000) : 0;
    if (durationSec < VOD_MIN_SECONDS) return;

    const streamId = event.params.streamId;
    const plan = after.hostPlan || 'free';

    const cfgSnap = await db.collection('app_config').doc('general').get();
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    if (cfg.streamVodArchiveEnabled === false) return;   // kill switch

    const days = retentionDaysFor(plan, cfg);
    if (days <= 0) return;

    // Mark dispatched first → a retry can't double-launch ffmpeg.
    await event.data.after.ref.update({
      archiveDispatchedAt: FieldValue.serverTimestamp(),
      vodPending: true,
      // Expiry runs from stream end, not from when the transcode happens, so a
      // slow archive can't quietly extend the retention window.
      vodExpiresAt: new Date(endedMs + days * 24 * 60 * 60 * 1000),
    });

    try {
      const res = await fetch(`${VOD_LAUNCHER_BASE}/archive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${HOST_OPS_TOKEN.value()}`,
        },
        body: JSON.stringify({
          sourceHls: after.hlsUrl,
          streamKey: after.streamKey,
          targetKey: `vods/${streamId}.mp4`,
          streamId,
          // Only Pro reaches here today (everyone else has 0 retention), but the
          // branch stays honest if a tier is ever switched on via app_config.
          mode: plan === 'pro' ? 'copy' : undefined,
          crf: 28,
          callbackUrl: `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/markVodArchived`,
        }),
      });
      if (!res.ok) throw new Error(`launcher returned ${res.status}`);
    } catch (err) {
      console.error('stream vod dispatch failed', streamId, err);
      // Clear the flag so the hourly retry sweep can pick it up. The raw
      // segments live for 24h, which is the whole window we have to recover in.
      await event.data.after.ref.update({
        archiveDispatchedAt: null,
        vodError: String(err.message || err).slice(0, 200),
      });
    }
  },
);

// Hetzner launcher posts back here when the transcode + upload completes.
// Auth via the same HOST_OPS_TOKEN bearer. Serves BOTH pipelines: a tournament
// callback carries tournamentId + matchId, a past-broadcast callback carries
// only streamId.
exports.markVodArchived = functions.https.onRequest(
  { region: REGION, secrets: [HOST_OPS_TOKEN] },
  async (req, res) => {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${HOST_OPS_TOKEN.value()}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const { tournamentId, matchId, streamId, archiveVodUrl, durationSec, sizeBytes } = req.body || {};
    if (!archiveVodUrl || (!matchId && !streamId)) {
      res.status(400).json({ error: 'archiveVodUrl + (matchId | streamId) required' });
      return;
    }
    try {
      // Tournament match archive — unblocks aiCheatFlagVod + autoCutVodHighlights.
      if (tournamentId && matchId) {
        const mRef = db.collection('tournaments').doc(tournamentId)
          .collection('matches').doc(matchId);
        await mRef.update({
          archiveVodUrl,
          archiveDurationSec: durationSec || null,
          archiveSizeBytes: sizeBytes || null,
          archivedAt: FieldValue.serverTimestamp(),
          // Init flags so downstream triggers fire.
          cheatFlagPass: 'pending',
          highlightsExtracted: false,
        });
      }
      // Stamp stream doc. This is what makes "Watch replay" appear.
      //
      // A restricted stream's URL goes in `gatedVodUrl`, NOT `archiveVodUrl`.
      // Reason: the viewers are shared code that reaches phones only via an APK,
      // so older native installs still run an ended screen that renders
      // `archiveVodUrl` with no follow/ticket check. Publishing a ticketed
      // event's replay there would hand it out for free to anyone with the link,
      // and we cannot force every device to update. Old clients simply find no
      // field and show no replay; clients that know the gate read `gatedVodUrl`
      // only after checking it. Fail closed, not open.
      if (streamId) {
        const sRef = db.collection('streams').doc(streamId);
        const sSnap = await sRef.get();
        const s = sSnap.exists ? sSnap.data() : {};
        const restricted = !!s.unlisted || s.audience === 'ticketed';
        await sRef.update({
          [restricted ? 'gatedVodUrl' : 'archiveVodUrl']: archiveVodUrl,
          vodDurationSec: durationSec || null,
          vodSizeBytes: sizeBytes || null,
          vodPending: false,
          vodError: FieldValue.delete(),
          archivedAt: FieldValue.serverTimestamp(),
        });
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('markVodArchived failed', err);
      res.status(500).json({ error: String(err.message || err).slice(0, 200) });
    }
  },
);
