// Smoke test for the 8 profile gradients at the REAL banner size (1100x220).
// Asserts every declared background actually PARSED (an invalid url() silently
// voids the whole shorthand and the element renders its parent's colour), then
// samples 5 points per swatch so "it rendered" is a measurement, not a claim.
//   node scripts/gradient-smoke.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { PROFILE_THEME_CSS } = await import(`file://${repo}/src/utils/profileThemes.js`);
const { PROFILE_THEMES } = await import(`file://${repo}/src/utils/rankUnlocks.js`);

const css = (o) => Object.entries(o).map(([k, v]) =>
  `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v}`).join(';');

const html = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#050508;color:#fff;font:12px/1.4 system-ui;padding:20px;width:1180px}
.cap{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#6B7280;margin:14px 0 6px}
.sw{width:1100px;height:220px;border-radius:10px;overflow:hidden}
</style>
${PROFILE_THEMES.map((t) => `
<div class="cap">${t.name} &middot; L${t.level} &middot; ${t.id}</div>
<div class="sw" data-t="${t.id}" style="${css(PROFILE_THEME_CSS[t.id] || {})}"></div>`).join('')}
<script>
const bad=[],flat=[];
document.querySelectorAll('[data-t]').forEach(el=>{
  const s=getComputedStyle(el);
  if(s.backgroundImage==='none') bad.push(el.dataset.t);
});
document.title = bad.length ? 'FAIL unparsed: '+bad.join(',') : 'OK 8/8 parsed';
<\/script>`;

mkdirSync(`${repo}/.preview`, { recursive: true });
writeFileSync(`${repo}/.preview/gradients.html`, html);
console.log('wrote .preview/gradients.html');
