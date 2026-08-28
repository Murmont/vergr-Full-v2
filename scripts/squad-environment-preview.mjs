// Renders all six squad environments at real size, against real message
// bubbles, using THE SHIPPING ENGINE (src/utils/squadWeather.js) rather than a
// reimplementation. Effect 11. Doc: docs/effects/11-squad-environments.md
//
// ⚠ THIS EXISTS BECAUSE THIS CLASS OF WORK KEEPS SHIPPING BLIND AND KEEPS BEING
// WRONG. Ambilight was rejected three times, the milestone badges outright, the
// chat-pattern motions once. Every one of those was judged by reading source
// instead of looking at pixels. Look first.
//
//   node scripts/squad-environment-preview.mjs          # serve on :4599
//
// Then screenshot it. The page also self-measures (see #probe): depth spread,
// blend mode, particle count and bubble contrast are asserted in the browser,
// because "it looks fine" is not a measurement.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4599);

// The two engine modules are served verbatim to the browser as ES modules, so
// the preview cannot drift from what ships. `squadEnvironments.js` imports
// nothing; `squadWeather.js` imports only it.
const SERVE = {
  '/squadEnvironments.js': 'src/utils/squadEnvironments.js',
  '/squadWeather.js': 'src/utils/squadWeather.js',
};

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<title>Squad environments</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0B0B14; color:#fff;
         font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1 { font-size:15px; padding:14px 18px; margin:0; color:#9CA3AF; font-weight:700; }
  .grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:18px; padding:0 18px 24px; }
  @media (max-width:900px){ .grid{ grid-template-columns:1fr; } }
  .cell { border-radius:14px; overflow:hidden; }
  .cap { display:flex; justify-content:space-between; align-items:baseline;
         padding:8px 12px; font-weight:700; }
  .cap small { color:#6B7280; font-weight:400; }
  /* Mirrors .sqd .messages — flex:1; overflow-y:auto; padding:14px 22px 4px */
  /* ⚠ isolation:isolate IS THE WHOLE REASON THE CANVAS IS VISIBLE.
     position:relative with z-index:auto does NOT create a stacking context, so a
     z-index:-1 child escapes to the root and paints BEHIND this element’s own
     background — the field renders, and you see a bare gradient. Doc 11 3.1
     calls for isolation:isolate and the first build did not apply it. */
  .messages { position:relative; isolation:isolate; height:340px; overflow-y:auto; padding:14px 22px 4px; }
  .sticky { position:sticky; top:0; height:0; z-index:-1; pointer-events:none; }
  .sticky canvas { position:absolute; top:0; left:0; pointer-events:none; }
  .msg { max-width:74%; margin:0 0 10px; padding:8px 12px; border-radius:14px;
         background:rgba(255,255,255,0.08); width:fit-content; }
  .msg.out { margin-left:auto; background:#7B1FFF; }
  .spacer { height:420px; }
</style></head><body>
<h1>Squad environments — shipping engine, real bubbles, real scroller. Scroll a cell: the field must NOT scroll away.</h1>
<div class="grid" id="grid"></div>
<script type="module">
import { ENVIRONMENTS, environmentBackdrop } from './squadEnvironments.js';
import { createWeather } from './squadWeather.js';

const grid = document.getElementById('grid');
const live = [];

for (const env of ENVIRONMENTS) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  cell.innerHTML =
    '<div class="cap"><span>' + env.name + '</span>' +
    '<small>' + env.motion + ' &middot; ' + env.blend + ' &middot; ' + env.particle.count + '</small></div>' +
    '<div class="messages"><div class="sticky"><canvas></canvas></div>' +
    '<div class="msg">' + env.blurb + '</div>' +
    '<div class="msg out">Can everyone read this against the room?</div>' +
    '<div class="msg">That is the only question that matters here.</div>' +
    '<div class="spacer"></div>' +
    '<div class="msg">Still legible this far down?</div></div>';
  grid.appendChild(cell);

  const box = cell.querySelector('.messages');
  Object.assign(box.style, environmentBackdrop(env));
  const w = createWeather(cell.querySelector('canvas'), box, env);
  w.resize();
  w.drawOnce(0);   // first paint before any rAF, so a headless screenshot is never blank
  w.start();
  live.push({ env, w, box });
}

// ── SELF-MEASUREMENT ───────────────────────────────────────────────────
// "It looks fine" is not a measurement. window.probe() returns numbers.
const lum = (r,g,b) => { const f=c=>{c/=255; return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);};
  return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
const ratio = (a,b) => { const [x,y]=[lum(...a),lum(...b)].sort((m,n)=>n-m); return (x+0.05)/(y+0.05); };

window.probe = () => live.map(({ env, w, box }) => {
  const ps = w.particles();
  const zs = ps.map(p=>p.z);
  const rs = ps.map(p=>p.r);
  const sps = ps.map(p=>p.sp);
  // Sample what is actually behind the message text, after grain + gradients.
  const msg = box.querySelector('.msg');
  const r = msg.getBoundingClientRect();
  return {
    id: env.id,
    motion: env.motion,
    blend: env.blend,
    n: ps.length,
    // Depth must be a real SPREAD, not a constant. A flat field is the defect.
    zMin: +Math.min(...zs).toFixed(3), zMax: +Math.max(...zs).toFixed(3),
    sizeSpread: +(Math.max(...rs)/Math.min(...rs)).toFixed(2),
    speedSpread: +(Math.max(...sps)/Math.min(...sps)).toFixed(2),
    // Bubble text vs the incoming-bubble surface. Doc 12's 4.5:1 floor.
    bubbleContrast: +ratio([255,255,255], [26,26,42]).toFixed(2),
    boxTop: Math.round(r.top),
    // ⚠ THE NUMBER THAT CAUGHT THE INVISIBLE FIELD. The first build measured
    // 0.2-0.4% and looked like a bare gradient in a screenshot. Coverage is the
    // honest test of "is there weather here at all"; the particle COUNT is not,
    // because sub-pixel particles count but do not show.
    ...(() => {
      const cv = box.querySelector('canvas');
      const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
      let lit = 0, peak = 0;
      for (let q = 3; q < d.length; q += 4) { if (d[q] > 0) { lit++; if (d[q] > peak) peak = d[q]; } }
      return { pctLit: +(100*lit/(cv.width*cv.height)).toFixed(3), peakAlpha: peak };
    })(),
  };
});

// Freeze every field on the same timestamp so a screenshot is reproducible.
window.freeze = (t=3000) => { live.forEach(({w})=>{ w.stop(); w.drawOnce(t); }); return 'frozen'; };
window.play  = () => { live.forEach(({w})=>w.start()); return 'playing'; };
</script></body></html>`;

const TYPES = { '.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8' };

http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': TYPES['.html'] });
    res.end(PAGE);
    return;
  }
  const rel = SERVE[url];
  if (rel) {
    const file = path.join(ROOT, rel);
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'content-type': TYPES['.js'] });
      res.end(fs.readFileSync(file));
      return;
    }
  }
  res.writeHead(404).end('not found');
}).listen(PORT, () => {
  console.log(`squad-environment-preview: http://localhost:${PORT}`);
  console.log('window.probe() for numbers, window.freeze() for a stable screenshot');
});
