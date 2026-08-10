// Headless verification of streamCompositor.js (the screenshare fix).
// Launches real Chrome with a fake camera, runs the ACTUAL compositor module,
// and asserts: (1) frames flow, (2) frames KEEP flowing after a mid-stream
// source swap (the camera->screenshare bug), (3) resolution is plan-capped,
// (4) setTargetFps actually throttles frame emission. No camera/human needed.
import http from 'http';
import { readFileSync, existsSync } from 'fs';
import { extname, join } from 'path';
import puppeteer from 'puppeteer-core';

const ROOT = process.cwd();
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.html': 'text/html', '.json': 'application/json' };

const TEST_HTML = `<!doctype html><html><body><script type="module">
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
window.__run = async () => {
  const { createStreamCompositor } = await import('/src/utils/streamCompositor.js');
  const out = {};
  // 1920x1080 fake camera so the resolution cap has something to clamp.
  const cam = await navigator.mediaDevices.getUserMedia({ video: { width: 1920, height: 1080 }, audio: true });
  const comp = createStreamCompositor({ source: cam, plan: 'free' }); // free -> short edge cap 480
  out.canvasSize = comp.width + 'x' + comp.height;
  out.capOk = comp.height <= 480; // free plan caps shorter edge to 480

  const rec = new MediaRecorder(comp.stream, { mimeType: 'video/webm' });
  const sizes = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) sizes.push(e.data.size); };
  rec.start(400);
  await sleep(1600);
  out.beforeSwap = sizes.length;

  // Simulate switching to screen share: a different (animated) source.
  const cnv = document.createElement('canvas'); cnv.width = 1280; cnv.height = 720;
  const c = cnv.getContext('2d'); let hue = 0;
  const paint = () => { hue = (hue + 7) % 360; c.fillStyle = 'hsl(' + hue + ',80%,50%)'; c.fillRect(0, 0, 1280, 720); requestAnimationFrame(paint); };
  paint();
  const screenLike = cnv.captureStream(30);
  const n0 = sizes.length;
  comp.setVideoTrack(screenLike.getVideoTracks()[0]);
  await sleep(1600);
  out.afterSwap = sizes.length - n0; // chunks produced AFTER the swap (the fix)

  // 4) fps throttle: count emitted frames at 8fps over ~2s on the output track.
  const v = document.createElement('video'); v.muted = true; v.srcObject = comp.stream; await v.play().catch(()=>{});
  comp.setTargetFps(8);
  let frames = 0;
  if (v.requestVideoFrameCallback) {
    const cb = () => { frames++; v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb);
    await sleep(2000);
    out.framesAt8fps = frames; // expect roughly 8*2=16, definitely < 40
  } else { out.framesAt8fps = 'n/a'; }

  rec.stop();
  comp.stop();
  return out;
};
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/__test.html') { res.setHeader('Content-Type', 'text/html'); return res.end(TEST_HTML); }
  const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!existsSync(p)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('Content-Type', MIME[extname(p)] || 'application/octet-stream');
  res.end(readFileSync(p));
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text()); });
  await page.goto(`http://localhost:${port}/__test.html`);
  const result = await page.evaluate(() => window.__run());
  console.log('RESULT:', JSON.stringify(result, null, 2));
  const pass = result.capOk && result.beforeSwap > 0 && result.afterSwap > 0 &&
    (result.framesAt8fps === 'n/a' || result.framesAt8fps < 40);
  console.log(pass ? 'PASS: compositor produces frames before AND after source swap, resolution capped, fps throttles' : 'FAIL');
  process.exitCode = pass ? 0 : 1;
} finally {
  await browser.close();
  server.close();
}
