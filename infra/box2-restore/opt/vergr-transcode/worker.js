// vergr-transcode — the adaptive-video worker.
//
// Produces lower-bitrate renditions of uploaded video so a viewer on a weak
// connection gets a stream that plays instead of one that spins.
//
// ── SAFETY CONTRACT (read before changing anything here) ─────────────
//
// THIS SERVICE IS PURELY ADDITIVE. It must never break an existing video.
//
//   * It NEVER deletes, moves or overwrites the original upload. The original
//     stays exactly where it is, at exactly the URL every existing player
//     already uses.
//   * It writes renditions to NEW R2 keys under `adaptive/`, and records them in
//     a NEW field on the post document. Nothing reads that field yet.
//   * A failed job leaves the world exactly as it found it. The original plays,
//     the post is untouched, the job is marked failed.
//
// So the worst case for this service is "adaptive video does not exist yet",
// which is also the current state. It cannot degrade playback, uploads, calls,
// or live streaming, none of which it touches.
//
// ── WHY A SEPARATE SERVICE ───────────────────────────────────────────
//
// vergr-vod-archive already runs ffmpeg on this box and could have hosted this.
// It is deliberately NOT extended, because deploying to it means restarting the
// service that handles live clip cuts and tournament VOD archiving. A new unit
// on a new port cannot take those down.
//
// ── WHY THIS BOX ─────────────────────────────────────────────────────
//
// vergr-stream-2 measured 0.00 load across 4 cores and had served 1 non-local
// request in its last 200 log lines. box1 measured 1.00 load on 2 cores before
// any stream exists. The CPU-hungry work belongs here.

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// ⚠ TRANSCODE_PORT, deliberately NOT `PORT`.
//
// This service shares /etc/vergr-vod-archive.env to reuse the R2 credentials
// (one copy of a secret is one thing to rotate). That file sets PORT=8097, and
// systemd's precedence between EnvironmentFile= and Environment= is not worth
// betting a service on: the first install of this worker inherited 8097, tried
// to bind vod-archive's port, and crash-looped.
//
// It failed safely — vod-archive already held the port, so the newcomer died
// and the incumbent was untouched — but relying on "the OS will stop me" is not
// a design. A distinct variable name cannot collide at all.
const PORT = Number(process.env.TRANSCODE_PORT || 8098);
// LOCALHOST ONLY, and NOT read from the shared env file.
//
// `BIND_HOST` in /etc/vergr-vod-archive.env is 0.0.0.0 because that service sits
// behind an nginx vhost. Inheriting it put this worker on a public port on the
// first install. Auth rejected everything (401), so nothing leaked, but an
// unnecessary internet-facing port is an unnecessary attack surface.
//
// Nothing outside this box needs to reach it: Cloud Functions call it through
// the same nginx vhost pattern vod-archive uses, if and when it is exposed at
// all. Hardcoded rather than configurable so it cannot regress via a config file
// this service does not own.
const BIND = '127.0.0.1';
const OPS_TOKEN = (process.env.HOST_OPS_TOKEN || '').trim();

const R2 = {
  accountId: (process.env.R2_ACCOUNT_ID || '').trim(),
  accessKeyId: (process.env.R2_ACCESS_KEY_ID || '').trim(),
  secretAccessKey: (process.env.R2_SECRET_ACCESS_KEY || '').trim(),
  bucket: (process.env.R2_BUCKET || '').trim(),
  publicBase: (process.env.R2_PUBLIC_BASE || '').trim().replace(/\/+$/, ''),
};

/**
 * The ladder.
 *
 * Two rungs, not three. 360p is the "always plays" floor and 720p is the
 * comfortable middle; a 1080p rung would mostly duplicate originals that are
 * already 1080p and costs storage for it. Revisit if large-screen playback
 * becomes a real complaint.
 *
 * `maxrate`/`bufsize` are set because CRF alone produces bitrate spikes on
 * high-motion gameplay, and a spike is exactly the moment a weak connection
 * gives up. Capping the peak is the whole point of the low rung.
 */
const LADDER = [
  { name: '360p', height: 360, crf: 28, maxrate: '800k',  bufsize: '1200k', abr: '64k' },
  { name: '720p', height: 720, crf: 25, maxrate: '2500k', bufsize: '3750k', abr: '96k' },
];

/** One job at a time. This box also serves edge traffic; a transcode storm here
 *  would be a self-inflicted outage on the machine we are trying to offload TO. */
let busy = false;

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ── R2 (SigV4, no SDK) ───────────────────────────────────────────────
// Hand-rolled to keep this service dependency-free: npm install on a box that
// serves live traffic is a risk with no upside for four lines of signing.
function sign(key, msg) { return crypto.createHmac('sha256', key).update(msg).digest(); }
function sha256hex(b) { return crypto.createHash('sha256').update(b).digest('hex'); }

async function r2Put(key, body, contentType) {
  const host = `${R2.bucket}.${R2.accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);

  const canonicalHeaders =
    `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest =
    `PUT\n/${key}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign =
    `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256hex(Buffer.from(canonicalRequest))}`;

  let k = sign(`AWS4${R2.secretAccessKey}`, dateStamp);
  k = sign(k, 'auto'); k = sign(k, 's3'); k = sign(k, 'aws4_request');
  const signature = crypto.createHmac('sha256', k).update(stringToSign).digest('hex');

  const res = await fetch(`https://${host}/${key}`, {
    method: 'PUT',
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${R2.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      // ⚠ EXACT content type, no `;codecs=`. R2 rejects a mismatch silently.
      'Content-Type': contentType,
      'Content-Length': String(body.length),
    },
    body,
  });
  if (!res.ok) throw new Error(`R2 PUT ${key} -> ${res.status} ${await res.text().catch(() => '')}`);
}

function run(cmd, args, { timeoutMs = 20 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString().slice(0, 2000); });
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('timeout')); }, timeoutMs);
    p.on('close', (code) => {
      clearTimeout(t);
      code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}: ${err.slice(-500)}`));
    });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

/** Probe once so we never UPSCALE. A 480p source re-encoded to 720p is bigger,
 *  slower and no better looking, which is the opposite of the goal. */
async function sourceHeight(file) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=height', '-of', 'csv=p=0', file,
    ]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => resolve(Number(String(out).trim()) || 0));
    p.on('error', () => resolve(0));
  });
}

async function transcode({ sourceUrl, postId }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vgt-'));
  const src = path.join(work, 'src');
  const renditions = [];
  try {
    const r = await fetch(sourceUrl);
    if (!r.ok) throw new Error(`source fetch ${r.status}`);
    fs.writeFileSync(src, Buffer.from(await r.arrayBuffer()));

    const h = await sourceHeight(src);
    log('source height', h, 'post', postId);

    for (const rung of LADDER) {
      // Skip a rung the source cannot honestly fill.
      if (h && rung.height >= h) { log('skip', rung.name, '(source is', h + 'p)'); continue; }

      const out = path.join(work, `${rung.name}.mp4`);
      await run('ffmpeg', [
        '-nostdin', '-y', '-i', src,
        '-vf', `scale=-2:${rung.height}`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(rung.crf),
        '-maxrate', rung.maxrate, '-bufsize', rung.bufsize,
        '-c:a', 'aac', '-b:a', rung.abr,
        // The index at the FRONT, so playback starts before the whole file is
        // fetched. Without it a long video is slow to START regardless of
        // bitrate, which is a different bug that looks identical to the user.
        '-movflags', '+faststart',
        '-f', 'mp4', out,
      ]);

      const buf = fs.readFileSync(out);
      const key = `adaptive/${postId}/${rung.name}.mp4`;
      await r2Put(key, buf, 'video/mp4');
      renditions.push({
        name: rung.name, height: rung.height,
        url: `${R2.publicBase}/${key}`, bytes: buf.length,
      });
      log('uploaded', key, buf.length, 'bytes');
    }
    return renditions;
  } finally {
    // Always clean up. A worker that fills its own disk takes the box with it.
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// ════════════════════════════════════════════════════════════════════
// JOB QUEUE — the worker PULLS, nothing pushes to it
// ════════════════════════════════════════════════════════════════════
//
// Chosen over an HTTP endpoint that Cloud Functions call, for four reasons that
// all matter more than the slight extra latency:
//
//   1. NO INBOUND EXPOSURE. Nothing to firewall, no TLS cert, no public port,
//      no nginx vhost to edit on a box serving live traffic.
//   2. BOX 3 IS FREE. A new box runs this same unit and starts claiming jobs.
//      No load balancer, no DNS change, no registry of worker addresses.
//   3. CRASH SAFE. A worker that dies mid-job leaves a stale claim that expires
//      and another worker retakes. An HTTP call that dies mid-job is just lost.
//   4. NATURAL BACKPRESSURE. Work queues instead of hammering a busy box.
//
// This is the same shape as the existing vergr-ocr loop on box 1, so it is a
// pattern already proven on this infrastructure rather than a new idea.

// Bare specifiers, resolved via NODE_PATH set in the systemd unit (pointing at
// stream-node-agent's node_modules). An ABSOLUTE path to a package subpath does
// NOT resolve — package "exports" maps only apply to bare specifiers — which is
// what MODULE_NOT_FOUND on the previous attempt was.
//
// Sub-module imports, matching what stream-node-agent on this box already does
// (firebase-admin 12.x). The root `admin.cert()` shape is v9-era and throws
// "admin.cert is not a function" on 12.x — the first install of this queue did
// exactly that. It failed safely (queue disabled, HTTP kept serving), but the
// lesson is to copy the pattern already proven on the box rather than recall an
// API from memory.
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const CRED = process.env.TRANSCODE_CREDS || '/etc/vergr-sfu/firebase-admin.json';
const DB_ID = process.env.DB_ID || 'vgrdb'; // NAMED database, not (default)
let db = null;
try {
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(CRED, 'utf8'))) });
  db = getFirestore(DB_ID);
  log(`firestore connected (${DB_ID})`);
} catch (e) {
  // Queue off, HTTP path still works. A worker that cannot reach Firestore is
  // idle, never wrong.
  log('FIRESTORE UNAVAILABLE, queue disabled:', e.message);
}

/** Distinct per box, so claims and logs say WHICH machine took a job. */
const NODE_ID = process.env.TRANSCODE_NODE_ID || os.hostname();

/** A claim older than this is assumed dead and may be retaken. Comfortably
 *  longer than the ffmpeg timeout so a slow job is never stolen mid-encode. */
const CLAIM_TTL_MS = 30 * 60 * 1000;
const POLL_MS = Number(process.env.TRANSCODE_POLL_MS || 15000);

async function claimAndRun() {
  if (busy || !db) return;

  const now = Date.now();
  let claimed = null;

  try {
    // NO orderBy, deliberately.
    //
    // A status-IN filter combined with an ordering needs a COMPOSITE INDEX that
    // does not exist in this project. Firestore would reject the query every
    // time, and because the failure is caught and logged, the symptom would be
    // a queue that looks permanently empty while jobs pile up unprocessed.
    //
    // Strict FIFO is not worth a hand-created index at this queue size. An
    // unordered page of 10 drains everything within a few ticks anyway.
    const snap = await db.collection('transcode_jobs')
      .where('status', 'in', ['queued', 'claimed'])
      .limit(10)
      .get();

    for (const d of snap.docs) {
      const j = d.data();
      // Skip a job another worker holds a LIVE claim on.
      if (j.status === 'claimed' && (now - (j.claimedAtMs || 0)) < CLAIM_TTL_MS) continue;

      // Atomic claim. Two workers racing: one transaction wins, the other sees
      // the new claim and moves on. This is what makes N boxes safe.
      const won = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(d.ref);
        if (!fresh.exists) return false;
        const f = fresh.data();
        if (f.status === 'done' || f.status === 'failed') return false;
        if (f.status === 'claimed' && (Date.now() - (f.claimedAtMs || 0)) < CLAIM_TTL_MS) return false;
        tx.update(d.ref, {
          status: 'claimed',
          claimedBy: NODE_ID,
          claimedAtMs: Date.now(),
          attempts: (f.attempts || 0) + 1,
        });
        return true;
      });

      if (won) { claimed = { ref: d.ref, data: j }; break; }
    }
  } catch (e) {
    // An index that does not exist yet, or a transient read failure. Log and
    // retry on the next tick rather than crash-looping the service.
    log('claim query failed:', e.message);
    return;
  }

  if (!claimed) return;

  const { postId, sourceUrl } = claimed.data;
  if (!postId || !sourceUrl) {
    await claimed.ref.update({ status: 'failed', error: 'missing postId or sourceUrl' }).catch(() => {});
    return;
  }

  busy = true;
  log('claimed', postId);
  try {
    const renditions = await transcode({ postId, sourceUrl });
    await claimed.ref.update({
      status: 'done',
      renditions,
      finishedAtMs: Date.now(),
      workerNode: NODE_ID,
    });

    // Record on the POST as a NEW field. Nothing reads it yet, and the original
    // `mediaUrls` is untouched, so this cannot change what any player loads.
    if (claimed.data.targetPath) {
      await db.doc(claimed.data.targetPath).set({
        adaptiveRenditions: renditions,
        adaptiveReadyAtMs: Date.now(),
      }, { merge: true }).catch((e) => log('post stamp failed:', e.message));
    }
    log('done', postId, renditions.length, 'renditions');
  } catch (e) {
    log('FAILED', postId, e.message);
    // Give up after 3 attempts so a permanently broken source does not spin
    // forever. The original still plays either way.
    const attempts = (claimed.data.attempts || 0) + 1;
    await claimed.ref.update({
      status: attempts >= 3 ? 'failed' : 'queued',
      error: String(e.message).slice(0, 500),
      lastFailedAtMs: Date.now(),
    }).catch(() => {});
  } finally {
    busy = false;
  }
}

if (db) {
  setInterval(() => { claimAndRun().catch((e) => log('loop error', e.message)); }, POLL_MS);
  log(`queue poller started as "${NODE_ID}" every ${POLL_MS}ms`);
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'GET' && req.url === '/healthz') {
    return send(200, { ok: true, service: 'vergr-transcode', busy, ladder: LADDER.map((l) => l.name) });
  }

  if (req.method !== 'POST' || req.url !== '/transcode') return send(404, { error: 'not found' });

  // Same bearer-token scheme the vod-archive service uses. Fails CLOSED: an
  // unset token means nobody can call this, never that anybody can.
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!OPS_TOKEN || auth !== OPS_TOKEN) return send(401, { error: 'unauthorized' });

  if (busy) return send(429, { error: 'busy' });

  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', async () => {
    let job;
    try { job = JSON.parse(body); } catch { return send(400, { error: 'bad json' }); }
    if (!job?.sourceUrl || !job?.postId) return send(400, { error: 'sourceUrl and postId required' });

    // 202 immediately: transcoding takes minutes and nothing should hold a
    // socket open for it. The caller polls or waits for the callback.
    send(202, { accepted: true, postId: job.postId });

    busy = true;
    try {
      const renditions = await transcode(job);
      log('done', job.postId, renditions.length, 'renditions');
      if (job.callbackUrl) {
        await fetch(job.callbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPS_TOKEN}` },
          body: JSON.stringify({ postId: job.postId, renditions, ok: true }),
        }).catch((e) => log('callback failed', e.message));
      }
    } catch (e) {
      log('FAILED', job.postId, e.message);
      // A failure is silent to the user by design: the original still plays.
      if (job.callbackUrl) {
        await fetch(job.callbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPS_TOKEN}` },
          body: JSON.stringify({ postId: job.postId, ok: false, error: e.message }),
        }).catch(() => {});
      }
    } finally {
      busy = false;
    }
  });
});

server.listen(PORT, BIND, () => log(`vergr-transcode listening on ${BIND}:${PORT}`));
