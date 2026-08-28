// vergr-vod-archive — Hetzner-side VOD transcode + R2 upload service.
//
// Endpoints (Bearer-token auth via HOST_OPS_TOKEN env var):
//   POST /archive { sourceHls, targetKey, tournamentId, matchId, streamId,
//                   mode: 'copy' | undefined, crf: 28, callbackUrl }
//     → 202 Accepted; runs ffmpeg in background; POSTs callbackUrl on done.
//       mode 'copy' remuxes at source quality (no re-encode, ~no CPU, big file);
//       default downscales to 480p (~10x smaller, one encode pass).
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
  const { sourceHls, targetKey, tournamentId, matchId, streamId, callbackUrl, crf = 28, mode } = job;
  if (!sourceHls || !targetKey) throw new Error('sourceHls + targetKey required');
  const label = matchId || streamId || 'job';
  const tmp = path.join(os.tmpdir(), `vergr-vod-${label}-${Date.now()}.mp4`);

  // Two archive modes:
  //   'copy'  — remux the HLS segments straight into an MP4 container. No
  //             re-encode, so the replay is bit-identical to what viewers saw
  //             (up to 1080p) and the box spends almost no CPU. The file is as
  //             large as the source, so this is reserved for Pro hosts.
  //   default — downscale to 480p H.264. ~10x smaller, which is what makes a
  //             multi-week retention window affordable. Costs one encode pass.
  const encodeArgs = mode === 'copy'
    ? ['-c', 'copy']
    : [
      '-vf', 'scale=-2:480',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf),
      '-c:a', 'aac', '-b:a', '64k',
    ];
  console.log(`[archive] ${label} mode=${mode || '480p'} → ${tmp}`);
  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y', '-i', sourceHls,
      ...encodeArgs,
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
  console.log(`[archive] uploaded ${label} (${stat.size} bytes) → ${archiveVodUrl}`);
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

// ── HLS rendition ladder for shorts / clips ────────────────────────────────
//
// WHY. A single uploaded file gives every viewer the same bitrate, so a phone on
// a weak connection has nothing smaller to fall back to and simply waits — the
// loading spinner TikTok never shows. Three renditions plus a master playlist
// let hls.js pick from the measured connection and switch mid-playback.
//
// One ffmpeg pass produces all three: decoding the source once and splitting the
// filter graph is far cheaper than three separate invocations, which is what
// makes this affordable on a box that also handles ingest.
const LADDER_RUNGS = [
  { name: '720', short: 720, v: '2000k', maxrate: '2400k', bufsize: '3000k', a: '96k' },
  { name: '480', short: 480, v: '1000k', maxrate: '1200k', bufsize: '1600k', a: '64k' },
  { name: '360', short: 360, v: '600k',  maxrate: '720k',  bufsize: '1000k', a: '48k' },
];

function ffprobeJson(input) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffprobe', [
      '-v', 'error', '-print_format', 'json',
      '-show_streams', '-show_format', input,
    ]);
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe ${code}: ${err.slice(0, 200)}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
    });
  });
}

const CONTENT_TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
};

async function uploadDir(dir, prefix) {
  const files = [];
  const walk = (d, rel) => {
    for (const name of fs.readdirSync(d)) {
      const full = path.join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, r);
      else files.push({ full, rel: r });
    }
  };
  walk(dir, '');

  // Bounded concurrency: a 60s video is ~90 segments, and firing them all at
  // once just makes R2 rate-limit us.
  const QUEUE = 6;
  let i = 0;
  const workers = Array.from({ length: QUEUE }, async () => {
    while (i < files.length) {
      const f = files[i++];
      const ext = path.extname(f.rel).toLowerCase();
      await s3.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: `${prefix}/${f.rel}`,
        Body: fs.createReadStream(f.full),
        ContentType: CONTENT_TYPES[ext] || 'application/octet-stream',
        // VOD segments are immutable by construction — the key contains the
        // post id and nothing ever rewrites them.
        CacheControl: 'public, max-age=31536000, immutable',
      }));
    }
  });
  await Promise.all(workers);
  return files.length;
}

async function ladder(job) {
  const { sourceUrl, postId, callbackUrl } = job;
  if (!sourceUrl || !postId) throw new Error('sourceUrl and postId required');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(postId)) throw new Error('bad postId');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-'));
  const input = path.join(tmpDir, 'in');
  const outDir = path.join(tmpDir, 'out');
  fs.mkdirSync(outDir);

  try {
    const r = await fetch(sourceUrl);
    if (!r.ok) throw new Error(`source fetch ${r.status}`);
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(input);
      r.body.pipe(ws);
      r.body.on('error', reject);
      ws.on('finish', resolve);
      ws.on('error', reject);
    });

    const probe = await ffprobeJson(input);
    const v = (probe.streams || []).find((s) => s.codec_type === 'video');
    if (!v) throw new Error('no video stream');
    const hasAudio = (probe.streams || []).some((s) => s.codec_type === 'audio');
    const srcW = Number(v.width) || 0;
    const srcH = Number(v.height) || 0;
    const srcShort = Math.min(srcW, srcH);
    const portrait = srcH >= srcW;

    // Only rungs BELOW the source. Upscaling is not a quality option, it is a
    // bigger file for worse pixels. The shortest side is what we cap, so a
    // vertical short is measured across its width, not its height — capping
    // height on portrait video would produce a 405-wide 720p, which is wrong.
    let rungs = LADDER_RUNGS.filter((x) => !srcShort || x.short < srcShort);
    if (rungs.length === 0) rungs = [LADDER_RUNGS[LADDER_RUNGS.length - 1]];

    // scale keeps the aspect and forces even dimensions (-2), which H.264
    // requires.
    const splits = rungs.map((_, i) => `[v${i}]`).join('');
    const chains = rungs
      .map((x, i) => `[v${i}]scale=${portrait ? `${x.short}:-2` : `-2:${x.short}`}[o${i}]`)
      .join(';');
    const filter = `[0:v]split=${rungs.length}${splits};${chains}`;

    const args = ['-y', '-i', input, '-filter_complex', filter];
    rungs.forEach((x, i) => {
      args.push('-map', `[o${i}]`,
        `-c:v:${i}`, 'libx264', '-preset', 'veryfast', '-profile:v', 'main',
        `-b:v:${i}`, x.v, `-maxrate:v:${i}`, x.maxrate, `-bufsize:v:${i}`, x.bufsize,
        // Two-second GOP so segment boundaries are always keyframes, which is
        // what lets the player switch rendition without a visible seek.
        '-g', '48', '-keyint_min', '48', '-sc_threshold', '0');
    });
    if (hasAudio) {
      rungs.forEach((x, i) => {
        args.push('-map', 'a:0', `-c:a:${i}`, 'aac', `-b:a:${i}`, x.a, '-ac', '2');
      });
    }
    const varMap = rungs
      .map((_, i) => (hasAudio ? `v:${i},a:${i}` : `v:${i}`))
      .join(' ');
    args.push(
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_playlist_type', 'vod',
      '-hls_flags', 'independent_segments',
      '-hls_segment_filename', path.join(outDir, '%v', 'seg_%04d.ts'),
      '-master_pl_name', 'master.m3u8',
      '-var_stream_map', varMap,
      path.join(outDir, '%v', 'index.m3u8'),
    );
    // %v expands to the variant INDEX, so the directories must be 0/1/2 and the
    // master playlist references them by that name. ffmpeg will not create them
    // itself when a segment filename points inside one.
    rungs.forEach((_, i) => fs.mkdirSync(path.join(outDir, String(i)), { recursive: true }));

    await new Promise((resolve, reject) => {
      const p = spawn('ffmpeg', args);
      let err = '';
      p.stderr.on('data', (d) => { err += d; if (err.length > 8000) err = err.slice(-4000); });
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(-400)}`))));
    });

    const count = await uploadDir(outDir, `ladders/${postId}`);
    const hlsUrl = `${R2_PUBLIC_BASE}/ladders/${postId}/master.m3u8`;
    console.log(`[ladder] ${postId}: ${rungs.length} rungs, ${count} files → ${hlsUrl}`);

    if (callbackUrl) {
      try {
        const res = await fetch(callbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify({ postId, hlsUrl, rungs: rungs.map((x) => x.name) }),
        });
        if (!res.ok) console.error(`[ladder] callback ${res.status}`);
      } catch (e) {
        console.error('[ladder] callback failed', e);
      }
    }
    return { hlsUrl, files: count };
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
  if (req.method === 'POST' && req.url === '/ladder') {
    try {
      const job = await readJson(req);
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, queued: true }));
      // Fire & forget, like /archive — nobody is waiting on this, the post is
      // already playable from its original file.
      ladder(job).catch((err) => console.error('ladder failed', job?.postId, err));
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

// BIND_HOST defaults to 127.0.0.1 (box 1: nginx on the same host proxies to it).
// On box 2 it is set to 0.0.0.0 so box 1's nginx can reach it over the private
// network (10.0.0.x); port 8097 is firewalled (ufw) to the private net only.
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1';
server.listen(PORT, BIND_HOST, () => {
  console.log(`vergr-vod-archive listening on ${BIND_HOST}:${PORT}`);
});
