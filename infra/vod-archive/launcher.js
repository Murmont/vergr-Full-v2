// vergr-vod-archive — Hetzner-side VOD transcode + R2 upload service.
//
// Endpoints (Bearer-token auth via HOST_OPS_TOKEN env var):
//   POST /archive { sourceHls, targetKey, tournamentId, matchId, streamId,
//                   maxResolution: '480p', crf: 28, callbackUrl }
//     → 202 Accepted; runs ffmpeg in background; POSTs callbackUrl on done.
//   POST /clip { sourceHls, durationSec, targetKey }
//     → SYNCHRONOUS 200 { url, sizeBytes }; cuts the last `durationSec` from a
//       live HLS manifest (engine-independent server-side clipping — works for
//       Apple-webview viewers where client-side captureStream taints). Parses
//       the manifest, downloads the tail segments (+ EXT-X-MAP init if fMP4),
//       binary-concats, then ffmpeg -ss <total-want> trims to an mp4.
//   GET  /healthz
//
// ffmpeg pipeline:
//   ffmpeg -i <sourceHls> -vf scale=-2:480 -c:v libx264 -preset veryfast
//          -crf <crf> -c:a aac -b:a 64k -movflags +faststart -f mp4 <out.mp4>
//
// R2 upload: aws-sdk v3 S3 client, endpoint = R2 S3-compat.
// Lives in /opt/vergr-vod-archive/. systemd unit deploy.sh provisions it.

import http from 'http';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fetch from 'node-fetch';

const PORT = process.env.PORT || 8095;
const TOKEN = process.env.HOST_OPS_TOKEN;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID?.trim();
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY?.trim();
const R2_BUCKET = process.env.R2_BUCKET?.trim() || 'vergr-media';
const R2_PUBLIC_BASE = process.env.R2_PUBLIC_BASE?.trim() || 'https://cdn.vergr.app';

if (!TOKEN || !R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
  console.error('Missing required env: HOST_OPS_TOKEN / R2_*');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  requestChecksumCalculation: 'WHEN_REQUIRED',
});

function checkAuth(req) {
  const h = req.headers['authorization'] || '';
  return h === `Bearer ${TOKEN}`;
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

async function archive(job) {
  const { sourceHls, targetKey, tournamentId, matchId, streamId, callbackUrl, crf = 28 } = job;
  if (!sourceHls || !targetKey) throw new Error('sourceHls + targetKey required');
  const tmp = path.join(os.tmpdir(), `vergr-vod-${matchId}-${Date.now()}.mp4`);
  console.log(`[archive] ${matchId} → ${tmp}`);
  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y', '-i', sourceHls,
      '-vf', 'scale=-2:480',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf),
      '-c:a', 'aac', '-b:a', '64k',
      '-movflags', '+faststart',
      '-f', 'mp4', tmp,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    ff.stderr.on('data', (d) => process.stderr.write(d));
    ff.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
    ff.on('error', reject);
  });
  const stat = fs.statSync(tmp);
  // Probe duration cheaply via ffprobe.
  const duration = await new Promise((resolve) => {
    const fp = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', tmp]);
    let out = '';
    fp.stdout.on('data', (d) => (out += d));
    fp.on('close', () => resolve(parseFloat(out) || 0));
    fp.on('error', () => resolve(0));
  });
  const body = fs.createReadStream(tmp);
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: targetKey, Body: body, ContentType: 'video/mp4',
  }));
  fs.unlink(tmp, () => {});
  const archiveVodUrl = `${R2_PUBLIC_BASE}/${targetKey}`;
  console.log(`[archive] uploaded ${matchId} → ${archiveVodUrl}`);
  if (callbackUrl) {
    try {
      const res = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          tournamentId, matchId, streamId, archiveVodUrl,
          durationSec: Math.floor(duration), sizeBytes: stat.size,
        }),
      });
      console.log(`[archive] callback ${res.status}`);
    } catch (err) { console.error('callback failed', err); }
  }
}

// Cut the last `durationSec` seconds from a live HLS manifest into one mp4.
async function clip(job) {
  const { sourceHls, targetKey } = job;
  if (!sourceHls || !targetKey) throw new Error('sourceHls + targetKey required');
  const want = Math.min(Math.max(Number(job.durationSec) || 30, 5), 120);

  const mres = await fetch(sourceHls);
  if (!mres.ok) throw new Error(`manifest ${mres.status}`);
  const text = await mres.text();
  const base = sourceHls.replace(/[^/]*$/, ''); // directory of the manifest

  let mapUri = null;
  const segs = [];
  let pendingDur = 0;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (l.startsWith('#EXT-X-MAP:')) {
      const m = l.match(/URI="([^"]+)"/); if (m) mapUri = m[1];
    } else if (l.startsWith('#EXTINF:')) {
      pendingDur = parseFloat(l.slice(8)) || 0;
    } else if (l && !l.startsWith('#')) {
      segs.push({ uri: l, dur: pendingDur }); pendingDur = 0;
    }
  }
  if (!segs.length) throw new Error('no segments in manifest');

  // Take tail segments until we have at least `want` + a little headroom.
  const tail = [];
  let acc = 0;
  for (let i = segs.length - 1; i >= 0 && acc < want + 4; i--) {
    tail.unshift(segs[i]); acc += segs[i].dur;
  }

  const resolveUri = (u) => (/^https?:\/\//.test(u) ? u : base + u);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vergr-clip-'));
  const joined = path.join(tmpDir, 'joined.bin');
  const ws = fs.createWriteStream(joined);
  const append = async (u) => {
    const r = await fetch(resolveUri(u));
    if (!r.ok) throw new Error(`segment ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    await new Promise((res, rej) => ws.write(buf, (e) => (e ? rej(e) : res())));
  };
  try {
    if (mapUri) await append(mapUri);        // fMP4 init segment, if any
    for (const s of tail) await append(s.uri);
    await new Promise((res) => ws.end(res));

    const out = path.join(tmpDir, 'clip.mp4');
    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', [
        '-y',
        '-ss', String(Math.max(0, acc - want)), // offset from the concat start
        '-i', joined,
        '-t', String(want),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
        '-c:a', 'aac', '-b:a', '96k',
        '-movflags', '+faststart',
        '-f', 'mp4', out,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      ff.stderr.on('data', (d) => process.stderr.write(d));
      ff.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exit ${c}`))));
      ff.on('error', reject);
    });

    const stat = fs.statSync(out);
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET, Key: targetKey, Body: fs.createReadStream(out), ContentType: 'video/mp4',
    }));
    return { url: `${R2_PUBLIC_BASE}/${targetKey}`, sizeBytes: stat.size };
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }, () => {});
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ts: Date.now() }));
    return;
  }
  if (!checkAuth(req)) {
    res.writeHead(401); res.end('{"error":"unauthorized"}'); return;
  }
  if (req.method === 'POST' && req.url === '/archive') {
    try {
      const job = await readJson(req);
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, queued: true }));
      // Fire & forget. Don't block the HTTP response.
      archive(job).catch((err) => console.error('archive failed', err));
    } catch (err) {
      res.writeHead(400); res.end(`{"error":"${String(err.message)}"}`);
    }
    return;
  }
  if (req.method === 'POST' && req.url === '/clip') {
    // Synchronous — the requesting user is waiting for the clip URL.
    try {
      const job = await readJson(req);
      const result = await clip(job);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      console.error('clip failed', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err.message || err).slice(0, 200) }));
    }
    return;
  }
  res.writeHead(404); res.end('{"error":"not_found"}');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`vergr-vod-archive listening on 127.0.0.1:${PORT}`);
});
