// RESEARCH HARNESS for effect 12 (chat themes). Not app code.
// Doc: docs/effects/12-bubble-themes.md
//
//   node scripts/chat-gradient-lab.mjs           # bake masks + serve on :5198
//   node scripts/chat-gradient-lab.mjs --shots   # bake + screenshot frames
//
// WHY THIS EXISTS: the founder's instruction was "I don't want to spend tokens
// only to check and find out it looks like shit". So the gradient, the mask
// derivation and the animation get built and LOOKED AT here, standalone,
// before a line of it goes near a chat screen.
//
// It implements Telegram's algorithm exactly as read from their source
// (docs/effects/12 §0.2) so our output can be compared against their own
// default palette, and it bakes FOUR candidate mask derivations from our
// existing background art so the right one is chosen by looking rather than by
// arguing.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = `${repo}/scripts/.gradient-lab`;
mkdirSync(OUT, { recursive: true });

const BGS = ['bg_1', 'bg_2', 'bg_3', 'bg_4', 'bg_5', 'bg_6', 'bg_7'];

// ── Mask derivation candidates ──────────────────────────────────────
// Our art is colourType=2 (RGB, NO ALPHA): a dark ground with brighter icons
// on it. Telegram's patterns carry the shape in the ALPHA channel, so ours
// cannot be used directly and the mask has to be derived. The four candidates
// exist because the icons are COLOURED neon, and the obvious derivation
// (greyscale luminance) weights a violet icon far lower than a cyan one, so
// half the pattern would come out faint.
//
//   lum     Rec.709 luminance. The naive one.
//   max     max(r,g,b). Hue-independent, so every neon icon reads equally.
//   norm    max(r,g,b) with the black point lifted and the range stretched.
//   soft    norm with a gamma curve, so faint detail survives.
async function bakeMasks() {
  for (const id of BGS) {
    const src = `${repo}/public/backgrounds/static/${id}.png`;
    if (!existsSync(src)) continue;
    const { data, info } = await sharp(src).resize(720).raw().toBuffer({ resolveWithObject: true });
    const n = info.width * info.height;
    const out = { lum: Buffer.alloc(n), max: Buffer.alloc(n), norm: Buffer.alloc(n), soft: Buffer.alloc(n) };
    let hi = 1;
    for (let i = 0; i < n; i++) {
      const r = data[i * info.channels], g = data[i * info.channels + 1], b = data[i * info.channels + 2];
      out.lum[i] = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      const m = Math.max(r, g, b);
      out.max[i] = m;
      if (m > hi) hi = m;
    }
    // Stretch against the 99.5th percentile, not the single brightest pixel: a
    // lone specular dot would otherwise flatten the whole image.
    const hist = new Array(256).fill(0);
    for (let i = 0; i < n; i++) hist[out.max[i]]++;
    let acc = 0, p995 = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.995) { p995 = v; break; } }
    const floor = 10;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, out.max[i] - floor) / Math.max(1, p995 - floor);
      out.norm[i] = Math.round(Math.min(1, v) * 255);
      out.soft[i] = Math.round(Math.pow(Math.min(1, v), 0.65) * 255);
    }
    for (const [kind, buf] of Object.entries(out)) {
      await sharp(buf, { raw: { width: info.width, height: info.height, channels: 1 } })
        // The mask is an ALPHA mask: the icon shape becomes opacity, everything
        // else transparent, so plain `mask-image` works everywhere rather than
        // relying on `mask-mode: luminance`.
        .ensureAlpha()
        .joinChannel(buf, { raw: { width: info.width, height: info.height, channels: 1 } })
        .toColourspace('b-w')
        .png()
        .toFile(`${OUT}/${id}.${kind}.png`);
    }
    console.log(`baked ${id} (${info.width}x${info.height}, p99.5=${p995})`);
  }
}

// The page implements the gradient in JS, mirroring the C in §0.2 line for line.
const page = () => `<!doctype html><meta charset="utf-8"><title>Chat gradient lab</title>
<style>
  body{margin:0;background:#07080D;color:#fff;font:12px/1.45 system-ui,sans-serif}
  h1{font-size:14px;margin:16px}
  .row{display:flex;gap:12px;padding:0 16px 16px;flex-wrap:wrap}
  .cell{width:300px}
  .cap{color:#9CA3AF;margin:6px 0 4px}
  .stage{position:relative;width:300px;height:420px;border-radius:12px;overflow:hidden;background:#000}
  .stage canvas{position:absolute;inset:0;width:100%;height:100%}
  .stage .masked{-webkit-mask-size:cover;mask-size:cover;-webkit-mask-position:center;mask-position:center;
                 -webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}
  .bub{position:absolute;right:12px;padding:8px 12px;border-radius:14px 14px 4px 14px;font-size:12px;color:#fff}
  .bub.in{left:12px;right:auto;border-radius:14px 14px 14px 4px;background:#1A1A2A}
  button{background:#7B1FFF;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-weight:700;margin:0 16px 12px}
</style>
<h1>Chat gradient lab &mdash; Telegram's algorithm, our art as the mask</h1>
<button onclick="step()">Send a message (advance phase)</button>
<button onclick="toggleAuto()">Toggle idle drift</button>
<div class="row" id="row"></div>
<script>
// ── Telegram's algorithm, from TMessagesProj/jni/image.cpp ──────────
const POSITIONS = [[.80,.10],[.60,.20],[.35,.25],[.25,.60],[.20,.90],[.40,.80],[.65,.75],[.75,.40]];
const W = 60, H = 80;   // their bitmap size. The smallness IS the technique.

function gather(phase) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    const p = POSITIONS[(phase + i * 2) % 8];
    out.push([p[0], 1 - p[1]]);          // y flipped, as they do
  }
  return out;
}

// The swirl depends only on the pixel, so it is computed once.
const swirlCache = (() => {
  const a = new Float32Array(W * H * 2);
  for (let y = 0; y < H; y++) {
    const dy = y / H - 0.5;
    for (let x = 0; x < W; x++) {
      const dx = x / W - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      const s = 0.35 * d;
      const th = s * s * 0.8 * 8.0;
      const st = Math.sin(th), ct = Math.cos(th);
      a[(y * W + x) * 2]     = Math.max(0, Math.min(1, 0.5 + dx * ct - dy * st));
      a[(y * W + x) * 2 + 1] = Math.max(0, Math.min(1, 0.5 + dx * st + dy * ct));
    }
  }
  return a;
})();

function render(ctx, colors, phase, progress) {
  const prev = gather((phase + 1) % 8), cur = gather(phase);
  const img = ctx.createImageData(W, H);
  const pts = [];
  for (let i = 0; i < colors.length; i++) {
    pts.push([prev[i][0] + (cur[i][0] - prev[i][0]) * progress,
              prev[i][1] + (cur[i][1] - prev[i][1]) * progress]);
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = swirlCache[(y * W + x) * 2], py = swirlCache[(y * W + x) * 2 + 1];
      let r = 0, g = 0, b = 0, sum = 0;
      for (let i = 0; i < colors.length; i++) {
        const dx = px - pts[i][0], dy = py - pts[i][1];
        let d = Math.max(0, 0.9 - Math.sqrt(dx * dx + dy * dy));
        d = d * d * d * d;                      // 4th power falloff
        sum += d;
        r += d * colors[i][0]; g += d * colors[i][1]; b += d * colors[i][2];
      }
      const o = (y * W + x) * 4;
      img.data[o] = r / sum; img.data[o + 1] = g / sum; img.data[o + 2] = b / sum; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const hex = (h) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];

// Telegram's own two palettes (from their source), then Vergr candidates built
// from PROFILE_ACCENTS. Telegram's are here as a CORRECTNESS FIXTURE: if our
// implementation is right, the first cell looks like Telegram's default.
const PALETTES = [
  ['TG default (fixture)', ['#426D57','#F7E48B','#87A284','#FDF6CA']],
  ['TG wallpaper (fixture)', ['#dbddbb','#6ba587','#d5d88d','#88b884']],
  ['Vergr violet',   ['#7B1FFF','#B44FFF','#3D1E6D','#C87FFF']],
  ['Vergr ember',    ['#F04060','#7B1FFF','#2A1030','#F0A500']],
  ['Vergr deep',     ['#1B0B3A','#7B1FFF','#0B0B14','#4A1E8C']],
];

const cells = [];
function cell(title, palette, maskUrl) {
  const d = document.createElement('div');
  d.className = 'cell';
  d.innerHTML = '<div class="cap">' + title + '</div>' +
    '<div class="stage"><canvas width="' + W + '" height="' + H + '"' + (maskUrl ? ' class="masked" style="-webkit-mask-image:url(' + maskUrl + ');mask-image:url(' + maskUrl + ')"' : '') + '></canvas>' +
    '<div class="bub in" style="top:40px">hey, look at this</div>' +
    '<div class="bub" style="top:96px;background:linear-gradient(135deg,' + palette[0] + ',' + palette[1] + ')">yeah that is the one</div>' +
    '</div>';
  document.getElementById('row').appendChild(d);
  const c = d.querySelector('canvas');
  const ctx = c.getContext('2d');
  cells.push({ ctx, colors: palette.map(hex) });
}

for (const [name, p] of PALETTES) cell(name, p, null);
for (const kind of ['lum','max','norm','soft']) cell('bg_1 &middot; ' + kind, PALETTES[2][1], '/mask/bg_1.' + kind + '.png');
for (const bg of ['bg_2','bg_4','bg_5','bg_6']) cell(bg + ' &middot; norm', PALETTES[3][1], '/mask/' + bg + '.norm.png');

// ── FILMSTRIP: the same cell across ONE phase step ──────────────────
// A still cannot tell you whether the motion is good. These are the frames of
// one "message sent" transition, so the SHAPE of the movement is judgeable.
const strip = document.createElement('div');
strip.className = 'row';
strip.innerHTML = '<div style="width:100%;color:#9CA3AF;padding-top:8px">One phase step, frames at progress 0 / .2 / .4 / .6 / .8 / 1 &mdash; masked with bg_4 &middot; soft. The ICONS never move; only the light behind them does.</div>';
document.body.appendChild(strip);
const stripCells = [];
for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
  const d = document.createElement('div');
  d.innerHTML = '<div class="cap">progress ' + t + '</div>' +
    '<div class="stage" style="width:200px;height:280px"><canvas width="' + W + '" height="' + H + '" class="masked" ' +
    'style="-webkit-mask-image:url(/mask/bg_4.soft.png);mask-image:url(/mask/bg_4.soft.png)"></canvas></div>';
  d.style.width = '200px';
  strip.appendChild(d);
  stripCells.push({ ctx: d.querySelector('canvas').getContext('2d'), t });
}
const stripColors = PALETTES[3][1].map(hex);
for (const c of stripCells) render(c.ctx, stripColors, 3, c.t);

// ── REAL SIZE: a thumbnail flatters everything ──────────────────────
// The icon field looks like noise at 200px and calm at 390px. This renders at
// the two sizes that actually ship: a phone thread and a desktop thread.
const real = document.createElement('div');
real.className = 'row';
real.innerHTML = '<div style="width:100%;color:#9CA3AF;padding-top:8px">Real size &mdash; phone 390 wide, desktop 900 wide. Same mask, same gradient.</div>';
document.body.appendChild(real);
const BUBBLES = [
  ['in', 'you seeing this?'], ['out', 'the background moves when you send'],
  ['in', 'wait what'], ['out', 'watch the icons'], ['in', 'ok that is clean'],
];
function realCell(w, h, maskUrl, palette, label) {
  const d = document.createElement('div');
  d.style.width = w + 'px';
  let bubbles = '';
  let top = 24;
  for (const [side, text] of BUBBLES) {
    const out = side === 'out';
    bubbles += '<div style="position:absolute;' + (out ? 'right' : 'left') + ':14px;top:' + top + 'px;max-width:70%;'
      + 'padding:9px 13px;border-radius:' + (out ? '16px 16px 5px 16px' : '16px 16px 16px 5px') + ';font-size:13px;color:#fff;'
      + 'background:' + (out ? 'linear-gradient(160deg,' + palette[0] + ',' + palette[1] + ')' : 'rgba(20,20,31,.94)') + '">' + text + '</div>';
    top += 52;
  }
  d.innerHTML = '<div class="cap">' + label + '</div>'
    + '<div class="stage" style="width:' + w + 'px;height:' + h + 'px">'
    + '<canvas width="' + W + '" height="' + H + '" class="masked" style="-webkit-mask-image:url(' + maskUrl + ');mask-image:url(' + maskUrl + ')"></canvas>'
    + bubbles + '</div>';
  real.appendChild(d);
  return { ctx: d.querySelector('canvas').getContext('2d'), colors: palette.map(hex) };
}
const realCells = [
  realCell(390, 620, '/mask/bg_4.soft.png', PALETTES[3][1], 'phone 390 &middot; bg_4 &middot; soft (stretched)'),
  realCell(390, 620, '/mask/bg_1.soft.png', PALETTES[2][1], 'phone 390 &middot; bg_1 &middot; soft (stretched)'),
  realCell(900, 620, '/mask/bg_2.norm.png', PALETTES[4][1], 'desktop 900 &middot; bg_2 &middot; norm (stretched)'),
];

// ── The TILE, built from scratch, next to the stretched art ─────────
// Same gradient, same sizes. The only difference is that this mask REPEATS at
// its design size instead of being stretched to cover, which is the whole
// crispness argument.
const tiled = document.createElement('div');
tiled.className = 'row';
tiled.innerHTML = '<div style="width:100%;color:#9CA3AF;padding-top:8px">Built from scratch: a seamless 512px tile of Material Symbols glyphs (Apache 2.0, already shipped). Repeated, never stretched. The existing wallpapers are untouched.</div>';
document.body.appendChild(tiled);
function tileCell(w, h, palette, label, tileSize, maskUrl) {
  const d = document.createElement('div');
  d.style.width = w + 'px';
  let bubbles = '', top = 24;
  for (const [side, text] of BUBBLES) {
    const out = side === 'out';
    bubbles += '<div style="position:absolute;' + (out ? 'right' : 'left') + ':14px;top:' + top + 'px;max-width:70%;'
      + 'padding:9px 13px;border-radius:' + (out ? '16px 16px 5px 16px' : '16px 16px 16px 5px') + ';font-size:13px;color:#fff;'
      + 'background:' + (out ? 'linear-gradient(160deg,' + palette[0] + ',' + palette[1] + ')' : 'rgba(20,20,31,.94)') + '">' + text + '</div>';
    top += 52;
  }
  d.innerHTML = '<div class="cap">' + label + '</div>'
    + '<div class="stage" style="width:' + w + 'px;height:' + h + 'px">'
    + '<canvas width="' + W + '" height="' + H + '" style="position:absolute;inset:0;width:100%;height:100%;'
    + '-webkit-mask-image:url(' + (maskUrl || '/mask/tile_gaming.png') + ');mask-image:url(' + (maskUrl || '/mask/tile_gaming.png') + ');'
    + '-webkit-mask-size:' + tileSize + 'px;mask-size:' + tileSize + 'px;'
    + '-webkit-mask-repeat:repeat;mask-repeat:repeat"></canvas>'
    + bubbles + '</div>';
  tiled.appendChild(d);
  return { ctx: d.querySelector('canvas').getContext('2d'), colors: palette.map(hex) };
}
realCells.push(
  tileCell(390, 620, PALETTES[2][1], 'A &middot; sparser (0.495 even)', 560, '/mask/arcade_A.png'),
  tileCell(390, 620, PALETTES[2][1], 'B &middot; denser (0.603 even)', 560, '/mask/arcade_B.png'),
  tileCell(390, 620, PALETTES[3][1], 'phone 390 &middot; TILE @560', 560),
  tileCell(390, 620, PALETTES[2][1], 'phone 390 &middot; TILE @460', 460),
  tileCell(900, 620, PALETTES[4][1], 'desktop 900 &middot; TILE @640', 640),
);
for (const c of realCells) render(c.ctx, c.colors, 3, 0.6);

// ── COST: how long one frame takes in JS, where Telegram uses C ─────
const perf = document.createElement('div');
perf.style.cssText = 'padding:8px 16px 24px;color:#9CA3AF';
{
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const t0 = performance.now();
  for (let i = 0; i < 60; i++) render(ctx, stripColors, i % 8, (i % 10) / 10);
  const ms = (performance.now() - t0) / 60;
  perf.textContent = 'One ' + W + 'x' + H + ' frame: ' + ms.toFixed(2) + ' ms in JS (' + (W * H) + ' px). '
    + '60fps budget is 16.7ms. A 30-frame 500ms transition costs ' + (ms * 30).toFixed(0) + ' ms of main thread in total.';
}
document.body.appendChild(perf);

let phase = 0, progress = 1, animating = false, auto = false;
function paint() { for (const c of cells) render(c.ctx, c.colors, phase, progress); }
paint();

// One phase step per message sent: 500ms, CubicBezier(0.33, 0, 0, 1).
function bez(t){const u=1-t;return 3*u*u*t*0 + 3*u*t*t*1 + t*t*t;} // approx of (.33,0,0,1) ease-out
function step() {
  if (animating) return;
  animating = true;
  const from = performance.now();
  phase = (phase + 7) % 8;
  const tick = (now) => {
    const t = Math.min(1, (now - from) / 500);
    progress = bez(t);
    paint();
    if (t < 1) requestAnimationFrame(tick); else { progress = 1; animating = false; }
  };
  requestAnimationFrame(tick);
}
// IDLE DRIFT is OUR addition, not Telegram's: they only move on send. Here to
// judge whether a slow constant drift reads as alive or as restless.
function toggleAuto(){ auto=!auto; if(auto) driftLoop(performance.now()); }
let driftFrom = 0;
function driftLoop(now){
  if (!auto) return;
  if (!driftFrom) driftFrom = now;
  const t = ((now - driftFrom) / 12000) % 1;
  progress = t; if (t < 0.02) phase = (phase + 7) % 8;
  paint();
  requestAnimationFrame(driftLoop);
}
window.step = step; window.toggleAuto = toggleAuto;
// Hook for the --anim recorder: paint ONE cell at an exact phase/progress.
window.__paintCell = (ph, pr) => render(window.__cell, PALETTES[2][1].map(hex), ph, pr);
</script>`;

await bakeMasks();

const PORT = Number(process.env.PORT || 5198);
const srv = createServer((req, res) => {
  if (req.url.startsWith('/mask/')) {
    const f = `${OUT}/${req.url.slice(6)}`;
    if (existsSync(f)) { res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); res.end(readFileSync(f)); return; }
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  res.end(page());
});
srv.listen(PORT, () => console.log(`chat-gradient-lab: http://localhost:${PORT}/`));

if (process.argv.includes('--anim')) {
  // ── Record the animation as an animated WebP ────────────────────────
  // A filmstrip cannot answer "is the movement good". This records a real
  // phone-sized thread through TWO phase steps (two messages sent) at the real
  // 500ms / cubic-bezier(0.33, 0, 0, 1) timing, so the motion is judgeable
  // before any of it goes near the app.
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
  });
  const p = await browser.newPage();
  await p.setViewport({ width: 900, height: 900, deviceScaleFactor: 1 });
  await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await p.evaluate(() => {
    // Keep one real-size TILED cell, so the recording is a thread and not a page.
    const stage = [...document.querySelectorAll('.stage')]
      .find((s) => s.offsetWidth === 390 && s.querySelector('canvas[style*="mask-repeat"]'));
    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;background:#000;display:inline-block';
    document.body.appendChild(stage);
    window.__cell = stage.querySelector('canvas').getContext('2d');
  });
  // ⚠ WebP stacks animation frames vertically and caps the strip at 16383px.
  // At 2x DPR and 20fps the first attempt built a 76,880px strip and sharp
  // refused it. 1x, 15fps and a short hold keeps 24 frames x 620 = 14,880.
  // Records the CONTINUOUS DRIFT, which is what ships: one phase step per 12s
  // (Telegram's own indeterminate constant), so one full revolution is 96
  // seconds of real time. WebP caps a stacked strip at 16383px, which at this
  // cell height is 26 frames, so a real-time clip is impossible.
  //
  // ⚠ THIS IS THEREFORE A TIME-LAPSE, and saying so matters: 24 frames spanning
  // TWO full phase steps, i.e. 24 seconds of drift played back in 2. The shape
  // and extent of the movement are exactly right; only the clock is compressed.
  const FPS = 12, FRAMES = 24, PHASES = 2;
  const frames = [];
  const cell = await p.$('.stage');
  let phase = 3;
  for (let f = 0; f < FRAMES; f++) {
    const total = (f / FRAMES) * PHASES;          // phases elapsed
    const ph = (3 + 7 * Math.floor(total)) % 8;
    await p.evaluate((a, b) => window.__paintCell(a, b), ph, total % 1);
    frames.push(await cell.screenshot());
  }
  await browser.close();
  srv.close();

  const meta = await sharp(frames[0]).metadata();
  const W2 = meta.width, H2 = meta.height;
  const strip = Buffer.concat(await Promise.all(frames.map((f) => sharp(f).ensureAlpha().raw().toBuffer())));
  await sharp(strip, { raw: { width: W2, height: H2 * frames.length, channels: 4 }, pageHeight: H2 })
    .webp({ loop: 0, delay: Math.round(1000 / FPS), quality: 90 })
    .toFile(`${repo}/scripts/.gradient-anim.webp`);
  console.log(`anim -> scripts/.gradient-anim.webp  (${frames.length} frames, ${W2}x${H2})`);
} else if (process.argv.includes('--shots')) {
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
  });
  const p = await browser.newPage();
  await p.setViewport({ width: 1320, height: 1500, deviceScaleFactor: 2 });
  await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1200));
  await p.screenshot({ path: `${repo}/scripts/.gradient-lab.png`, fullPage: true });
  console.log('shot → scripts/.gradient-lab.png');
  await browser.close();
  srv.close();
}
