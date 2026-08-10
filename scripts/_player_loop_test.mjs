// Headless verification of the mobile "loop" fix. Serves a faithful live HLS
// simulator (sliding 18-seg window, media-sequence advancing 1/s, NO ENDLIST,
// ALL past segments still downloadable -- exactly how the box+R2 behave, which is
// what let a drifted player replay the past). Drives hls.js with the REAL mobile
// config + drift guard from HlsPlayer.jsx, injects a stall, and asserts the
// player tracks the live edge and never loops back toward 0.
import http from 'http';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import puppeteer from 'puppeteer-core';

const SEG = 'C:/Users/damie/AppData/Local/Temp/hlssim';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HLS = readFileSync('node_modules/hls.js/dist/hls.min.js', 'utf8');
const TOTAL = 40, WINDOW = 18;
const t0 = Date.now();

const page = `<!doctype html><html><body><video id="v" muted playsinline></video>
<script>${HLS}</script>
<script>
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
window.__samples = []; window.__done = false; window.__err = null;
window.__run = async () => { try {
  const video = document.getElementById('v');
  const cfg = { enableWorker:true, lowLatencyMode:false, backBufferLength:12,
    liveSyncDurationCount:4, liveMaxLatencyDurationCount:12, maxLiveSyncPlaybackRate:1.5,
    startPosition:-1, liveDurationInfinity:true, maxBufferLength:12,
    fragLoadingMaxRetry:6, manifestLoadingMaxRetry:6 };
  const hls = new Hls(cfg);
  hls.loadSource('/live.m3u8'); hls.attachMedia(video);
  // Drift guard, identical to HlsPlayer.jsx.
  video.addEventListener('timeupdate', () => {
    const sync = hls.liveSyncPosition;
    if (typeof sync !== 'number' || !Number.isFinite(sync)) return;
    if (sync - video.currentTime > 10) { try { video.currentTime = sync; } catch {} }
  });
  await new Promise(res => hls.on(Hls.Events.MANIFEST_PARSED, res));
  await video.play().catch(()=>{});
  let stalled = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    window.__samples.push({ t: i, cur: +video.currentTime.toFixed(2), edge: +(hls.liveSyncPosition||0).toFixed(2), paused: video.paused });
    // Inject a 12s stall at t=8 to push the player well behind the edge.
    if (i === 8 && !stalled) { stalled = true; video.pause(); setTimeout(()=>video.play().catch(()=>{}), 12000); }
  }
  } catch (e) { window.__err = String(e); } finally { window.__done = true; }
};
</script></body></html>`;

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/index.html') { res.setHeader('Content-Type','text/html'); return res.end(page); }
  if (u === '/live.m3u8') {
    const elapsed = (Date.now() - t0) / 1000;
    const edge = Math.min(Math.floor(elapsed), TOTAL - 1);
    const start = Math.max(0, edge - (WINDOW - 1));
    let m = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:' + start + '\n';
    for (let i = start; i <= edge; i++) m += '#EXTINF:1.000,\nseg-' + i + '.ts\n';
    res.setHeader('Content-Type','application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control','max-age=1');
    return res.end(m);
  }
  if (u.startsWith('/seg-')) {
    const p = join(SEG, u.slice(1));
    if (existsSync(p)) { res.setHeader('Content-Type','video/mp2t'); return res.end(readFileSync(p)); }
  }
  res.statusCode = 404; res.end('nf');
});

await new Promise((r)=>server.listen(0,r));
const port = server.address().port;
const browser = await puppeteer.launch({ executablePath: CHROME, headless:'new',
  protocolTimeout: 120000,
  args:['--autoplay-policy=no-user-gesture-required'] });
try {
  const pg = await browser.newPage();
  pg.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await pg.goto(`http://localhost:${port}/`);
  await pg.evaluate(() => { window.__run(); }); // kick off, don't block on the 30s loop
  let s = [];
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const st = await pg.evaluate(() => ({ done: window.__done, err: window.__err, samples: window.__samples }));
    s = st.samples || [];
    if (st.err) { console.log('PAGE __err:', st.err); break; }
    if (st.done) break;
  }
  // Analyze: a "loop" = currentTime jumping BACK toward 0 while the edge is ahead.
  let maxBack = 0, minCur = Infinity, looped = false;
  for (let i = 1; i < s.length; i++) {
    const back = s[i-1].cur - s[i].cur;
    if (!s[i].paused && back > maxBack) maxBack = back;
    if (back > 5) looped = true; // big backward jump = replay-from-past
    minCur = Math.min(minCur, s[i].cur);
  }
  if (!s.length) { console.log('FAIL: no samples captured'); process.exitCode = 1; }
  const last = s[s.length-1] || { edge: 0, cur: 0 };
  const finalDrift = +(last.edge - last.cur).toFixed(2);
  console.log('SAMPLES:', JSON.stringify(s));
  console.log(`maxBackwardJump=${maxBack.toFixed(2)}s  finalDrift=${finalDrift}s  looped=${looped}`);
  // Pass: never looped back to the past, and after the 12s stall it recovered to
  // within ~13s of the edge (drift guard + latency control pulled it forward).
  const pass = !looped && finalDrift < 13 && last.cur > 5;
  console.log(pass ? 'PASS: player tracks live edge, recovers from stall, no loop-to-start' : 'FAIL');
  process.exitCode = pass ? 0 : 1;
} finally { await browser.close(); server.close(); }
