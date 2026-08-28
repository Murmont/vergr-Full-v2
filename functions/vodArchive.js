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
const { S3Client, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const HOST_OPS_TOKEN = defineSecret('HOST_OPS_TOKEN');
const R2_ACCESS_KEY_ID     = defineSecret('R2_ACCESS_KEY_ID');
const R2_SECRET_ACCESS_KEY = defineSecret('R2_SECRET_ACCESS_KEY');
const R2_ACCOUNT_ID        = defineSecret('R2_ACCOUNT_ID');
const VOD_LAUNCHER_BASE = process.env.VOD_LAUNCHER_BASE || 'https://archive.vergr.app';
const R2_BUCKET = 'vergr-media';
const CDN_BASE = 'https://cdn.vergr.app';

// Trim trailing whitespace from R2 secrets — a past R2 outage root-caused to a
// trailing \n on every one of them. See CLAUDE.md "If R2 uploads fail".
function env(secret) {
  const v = secret?.value?.() ?? secret;
  return typeof v === 'string' ? v.trim() : v;
}

function r2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env(R2_ACCOUNT_ID)}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env(R2_ACCESS_KEY_ID),
      secretAccessKey: env(R2_SECRET_ACCESS_KEY),
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
}

/**
 * Build a VOD playlist for an RTMP (OBS) broadcast from the segments on R2.
 *
 * Why this exists: nginx-rtmp serves a SLIDING window (hls_playlist_length 18s
 * on the live box), and it rewrites index.m3u8 in place, so when the broadcast
 * ends the manifest describes the last ~18 seconds and nothing else. The
 * SEGMENTS are all still there, because r2-sync only ever copies. So the audio
 * and video of the whole broadcast survives and only the index is missing.
 * Browser ingest does not need this: vergr-ingest writes a complete manifest
 * with #EXT-X-ENDLIST when it finalizes.
 *
 * On durations: nginx cuts fragments at keyframes, so `hls_fragment 1s` is a
 * floor and the real length is the encoder's GOP (2s for stock OBS). We cannot
 * recover each segment's true EXTINF after the fact without probing every file,
 * so we divide the broadcast's wall-clock length by the segment count. The
 * fragments are uniform by construction, which makes that average accurate to
 * well under a second, and HLS players treat EXTINF as advisory for seeking
 * anyway. The alternative, hardcoding hls_fragment, would report half the true
 * duration on a default OBS profile.
 *
 * Returns the public manifest URL, or null if there is nothing to build from.
 */
async function buildRtmpVodManifest(streamKey, durationSec) {
  const s3 = r2Client();
  const prefix = `streams/${streamKey}/`;
  const segments = [];
  let initSegment = null;
  let token;

  do {
    const out = await s3.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: token,
    }));
    for (const obj of out.Contents || []) {
      const name = obj.Key.slice(prefix.length);
      if (name.includes('/')) continue;             // nested, not ours
      if (name === 'init.mp4') { initSegment = name; continue; }
      if (name.endsWith('.ts') || name.endsWith('.m4s')) segments.push(name);
    }
    token = out.IsTruncated ? out.NextContinuationToken : null;
  } while (token);

  if (segments.length === 0) return null;

  // Sort by the sequence number in the filename, NOT lexically: nginx writes
  // 2.ts, 10.ts, 100.ts, and a string sort puts 10 before 2.
  const seq = (n) => {
    const m = n.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  };
  segments.sort((a, b) => seq(a) - seq(b));

  const per = durationSec > 0 ? durationSec / segments.length : 2;
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXT-X-TARGETDURATION:${Math.max(1, Math.ceil(per))}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
  ];
  if (initSegment) lines.push(`#EXT-X-MAP:URI="${initSegment}"`);
  for (const name of segments) {
    lines.push(`#EXTINF:${per.toFixed(3)},`);
    lines.push(name);
  }
  lines.push('#EXT-X-ENDLIST');

  const key = `${prefix}index-vod.m3u8`;
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: lines.join('\n'),
    ContentType: 'application/vnd.apple.mpegurl',
    // Immutable: a VOD playlist never changes once written, unlike the live
    // index.m3u8 that r2-sync serves at max-age=1.
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  return `${CDN_BASE}/${key}`;
}

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
// Both ingest types are archived, by different routes:
//   browser / fMP4 — vergr-ingest already wrote a complete manifest with
//     #EXT-X-ENDLIST when it finalized, so the replay is that file, as is.
//   rtmp (OBS)     — nginx-rtmp's playlist is a sliding ~18s window, so the
//     index is useless after the fact even though every segment survives on
//     R2. buildRtmpVodManifest() rebuilds a VOD playlist from the object
//     listing. OBS is what serious streamers use, so leaving it out would have
//     meant the tier's own audience got no replays.
const VOD_MIN_SECONDS = 120;              // don't archive a 30-second false start
const DEFAULT_RETENTION_DAYS = { free: 0, lite: 0, pro: 90 };  // 0 = never archived
const ARCHIVABLE_INGEST = new Set(['browser', 'fmp4', 'rtmp']);

function retentionDaysFor(plan, cfg) {
  const override = cfg?.streamVodRetentionDays || {};
  const days = override[plan] ?? DEFAULT_RETENTION_DAYS[plan] ?? DEFAULT_RETENTION_DAYS.free;
  return Math.max(0, Number(days) || 0);
}

/**
 * Does this stream's replay have to sit behind a gate?
 *
 * A restricted stream's URL goes in `gatedVodUrl`, NEVER `archiveVodUrl`.
 * Reason: the viewers are shared code that reaches phones only via an APK, so
 * older native installs still run an ended screen that renders `archiveVodUrl`
 * with no follow/ticket check. Publishing a restricted replay there hands it to
 * anyone with the link, and we cannot force every device to update. Old clients
 * find no field and show no replay. Fail closed, not open.
 *
 * `access.mode === 'paid'` is included deliberately: it was missing from the
 * inline copy this replaces, which meant someone could pay to watch a stream
 * live and then find the replay published for free. One helper, both callers,
 * so the two cannot drift again.
 */
function isRestricted(s = {}) {
  return !!s.unlisted
    || s.audience === 'ticketed'
    || s.access?.mode === 'paid';
}

exports.dispatchStreamVodArchive = onDocumentWritten(
  {
    region: REGION, document: 'streams/{streamId}', database: 'vgrdb',
    secrets: [HOST_OPS_TOKEN, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID],
  },
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

    const expiresAt = new Date(endedMs + days * 24 * 60 * 60 * 1000);

    // ── Default path: no transcode at all ────────────────────────────────
    //
    // The finished broadcast is ALREADY a complete, playable VOD: vergr-ingest
    // rewrites index.m3u8 with every segment plus #EXT-X-ENDLIST when the
    // session ends, and r2-sync only ever copies, so the whole thing is sitting
    // on R2 behind the same CDN the live stream used. The only reason replays
    // never existed is that streamingCleanup deleted those objects at 24h.
    //
    // So the replay is a RETENTION decision, not a rendering job. Stamping the
    // manifest here and holding the segments in streamingCleanup (see the
    // replayHeldKeys map there) gives Pro a real 90-day replay for the price of
    // the storage, with no ffmpeg, no callback and no box to keep alive.
    //
    // The ffmpeg remux below is strictly an OPTIMISATION for later: one mp4 is
    // cheaper to store and simpler to serve than thousands of segments. It
    // needs a host running vergr-vod-archive, which does not exist right now
    // (box 2 was deleted 2026-08-17 and archive.vergr.app answers 503), so it
    // is opt-in via app_config/general.streamVodRemux rather than the default.
    // Do NOT flip that flag back on without checking the box actually answers.
    if (cfg.streamVodRemux !== true) {
      let replayUrl = after.hlsUrl;

      // OBS: the live index is a sliding window, so rebuild a real VOD
      // playlist from the segments. Browser ingest already finalized its own.
      if (after.ingestType === 'rtmp') {
        try {
          replayUrl = await buildRtmpVodManifest(after.streamKey, durationSec);
        } catch (err) {
          console.error('rtmp vod manifest failed', event.params.streamId, err);
          replayUrl = null;
        }
        if (!replayUrl) {
          // No manifest means no replay. Stamp the failure rather than
          // pointing the player at an 18-second sliding window and calling
          // that a 90-day replay.
          await event.data.after.ref.update({
            vodError: 'could not rebuild playlist from segments',
            archiveDispatchedAt: FieldValue.serverTimestamp(),
          });
          return;
        }
      }

      const restricted = isRestricted(after);
      await event.data.after.ref.update({
        [restricted ? 'gatedVodUrl' : 'archiveVodUrl']: replayUrl,
        vodKind: 'hls',            // streamingCleanup holds segments on this
        vodDurationSec: durationSec,
        vodPending: false,
        vodExpiresAt: expiresAt,
        archiveDispatchedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    // Mark dispatched first → a retry can't double-launch ffmpeg.
    await event.data.after.ref.update({
      archiveDispatchedAt: FieldValue.serverTimestamp(),
      vodPending: true,
      // Expiry runs from stream end, not from when the transcode happens, so a
      // slow archive can't quietly extend the retention window.
      vodExpiresAt: expiresAt,
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
      // Gate decided by isRestricted() at the top of this file — see the
      // reasoning there for why a restricted replay must never land in
      // `archiveVodUrl`.
      if (streamId) {
        const sRef = db.collection('streams').doc(streamId);
        const sSnap = await sRef.get();
        const s = sSnap.exists ? sSnap.data() : {};
        const restricted = isRestricted(s);
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
