// Renders every rank collection at ALL THREE scales into one sheet.
//
// WHY THIS EXISTS: the first theme attempt took an afternoon because three
// versions shipped unrendered and a fourth shipped with a url("...") that
// silently voided its own `background` shorthand, so the element rendered its
// parent's colour with no error anywhere.
//
// This imports the REAL module, so a preview cannot drift from what ships, and
// it asserts that every declared background actually parsed.
//
//   node scripts/theme-preview.mjs
//   chrome --headless=new --force-device-scale-factor=2 \
//          --window-size=1700,2600 --screenshot=out.png file:///<repo>/.preview/collections.html
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

const { COLLECTIONS, nameplate } =
  await import(`file://${repo}/src/utils/rankCollections.js`);

const ACCENTS = ['ember', 'mint', 'gold'];

/** camelCase style object -> CSS text */
const css = (o) =>
  Object.entries(o || {})
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${typeof v === 'number' && !/^(opacity|zIndex|flex|lineHeight)$/.test(k) ? v + 'px' : v}`)
    .join(';');

const MSGS = [
  ['Verion', 'gg that last round was unreal'],
  ['nova_kill', 'how are you hitting those flicks'],
  ['Sable', 'first time here, this is sick'],
  ['drift', 'w stream'],
];

const rows = (id, accentId) => {
  const plate = nameplate(id, accentId);
  const ink = plate?.ink;
  return MSGS.map(([n, t]) => `
    <div class="row" ${plate ? `data-plate="${id}"` : ''} style="${plate ? css(plate.style) : ''}">
      <span class="av"></span>
      <span class="nm" style="color:${ink?.name || '#C9CDD4'}">${n}</span>
      <span class="tx" style="color:${ink?.text || '#C9CDD4'}">${t}</span>
    </div>`).join('');
};

const block = (c) => `
  <section class="col">
    <header>
      <h2>${c.name}</h2><span class="lv">L${c.min}</span>
      <span class="tag">${c.tag}</span>
    </header>
    <div class="scales">
      ${ACCENTS.map((a) => `
        <div class="scale">
          <div class="cap">${a}</div>
          <div class="chat">${rows(c.id, a)}</div>
        </div>`).join('')}
    </div>
  </section>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#050508;color:#fff;font-family:system-ui,-apple-system,sans-serif;padding:26px}
h1{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#6B7280;margin-bottom:3px}
.sub{font-size:11px;color:#4B5563;margin-bottom:22px}
.col{margin-bottom:26px;padding-bottom:22px;border-bottom:1px solid rgba(255,255,255,.05)}
header{display:flex;align-items:baseline;gap:10px;margin-bottom:11px}
h2{font-size:15px;font-weight:800}
.lv{font-family:ui-monospace,monospace;font-size:11px;color:#6B7280}
.tag{font-size:11px;color:#5A6070;font-style:italic}
.scales{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.cap{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#4B5563;margin-bottom:6px}
.chat{background:#0A0A10;border-radius:9px;padding:7px}
.row{display:flex;align-items:center;gap:7px;padding:5px 8px;margin-bottom:3px;font-size:11.5px}
.av{width:17px;height:17px;border-radius:50%;background:linear-gradient(135deg,#2a1b4a,#101a30);flex:none}
.nm{font-weight:800;flex:none}
.tx{color:#C9CDD4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style></head><body>
<h1>Rank collections — nameplate scale</h1>
<div class="sub">The surface others see hundreds of times per stream. Pure CSS, no filters, one shared noise tile. Rendered from the real rankCollections.js.</div>
${COLLECTIONS.map(block).join('')}
<script>
  // The exact failure that cost an afternoon: an invalid url() drops the WHOLE
  // shorthand and the element silently renders its parent's colour.
  const bad = [];
  document.querySelectorAll('[data-plate]').forEach((el) => {
    if (getComputedStyle(el).backgroundImage === 'none') bad.push(el.dataset.plate);
  });
  document.title = bad.length ? 'FAIL: ' + [...new Set(bad)].join(',') : 'OK all plates parsed';
<\/script>
</body></html>`;

mkdirSync(`${repo}/.preview`, { recursive: true });
writeFileSync(`${repo}/.preview/collections.html`, html);
console.log('wrote .preview/collections.html —', COLLECTIONS.length, 'collections x', ACCENTS.length, 'accents');
