import fs from 'fs';
const src = fs.readFileSync('src/screens/marketing/help/helpContent.jsx', 'utf8');
const rawStart = src.indexOf('const RAW = {');
const rawEnd = src.indexOf('\n};', rawStart);
const raw = src.slice(rawStart, rawEnd);
function slugify(t) {
  return t.toLowerCase().replace(/&/g, ' and ').replace(/\+/g, ' plus ')
    .replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
}
const lines = raw.split('\n');
let cat = null; const cats = {};
for (const ln of lines) {
  const m = ln.match(/^\s*'([a-z0-9-]+)':\s*\[/);
  if (m) { cat = m[1]; cats[cat] = []; continue; }
  const t = ln.match(/^\s*\[\s*'(.+?)'\s*,\s*'(core|std|long)'\s*\]/);
  if (t && cat) cats[cat].push(t[1]);
}
const dir = 'src/screens/marketing/help/articles';
let doneCount = 0, remCount = 0;
const out = [];
for (const c of Object.keys(cats)) {
  let files = new Set();
  try { files = new Set(fs.readdirSync(`${dir}/${c}`).filter(f => f.endsWith('.jsx')).map(f => f.replace(/\.jsx$/, ''))); } catch {}
  const done = [], rem = [];
  for (const title of cats[c]) { (files.has(slugify(title)) ? done : rem).push(title); }
  doneCount += done.length; remCount += rem.length;
  out.push({ c, done, rem });
}
console.log(`TOTAL done=${doneCount} remaining=${remCount} of ${doneCount + remCount}`);
fs.writeFileSync('scripts/_help_status.json', JSON.stringify(out, null, 1));
