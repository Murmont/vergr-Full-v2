// Repairs codemod damage where <UserName> was substituted into a place that
// needs a STRING, not a React element.
//
// ── WHAT WENT WRONG ─────────────────────────────────────────────────
//
// username-codemod.mjs matched the bare shape `{a.displayName || ...}` with no
// regard for what sat immediately before the `{`. Two contexts bit:
//
//   `Invited ${user.displayName || 'player'}`   template literal
//   alt={who.displayName}                       JSX attribute
//
// In the first the `$` is left stranded and the element text becomes part of a
// STRING, so a toast reads literally "Invited $<UserName user={user} ... />".
// In the second, JSX legally accepts an element as an attribute value, so the
// BUILD PASSES and the attribute silently receives an object: alt text becomes
// [object Object], and `value=<UserName/>` on an <input> breaks the field.
//
// 35 sites across two codemod runs. Nothing failed. That is the whole lesson:
// a green build proves the syntax parsed, never that the app still works.
//
// ── HOW THE REPAIR IS EXACT ─────────────────────────────────────────
//
// The substitution is deterministic, so replaying the SAME patterns against the
// committed (pre-migration) file reproduces every `tag -> original` pair. A
// stranded `$` or `=` immediately before a tag is the marker of a bad site, so
// only those are rewritten and every legitimate <UserName> is left alone.
//
//   node scripts/username-repair.mjs          dry run
//   node scripts/username-repair.mjs --apply  write
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';

const APPLY = process.argv.includes('--apply');
const norm = (p) => p.split('\\').join('/');

const walk = (d, out = []) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.jsx$/.test(p)) out.push(p);
  }
  return out;
};

// Must stay byte-identical to username-codemod.mjs, or the reverse map is wrong.
const OBJ = String.raw`[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*`;
const tag = (obj, fallback) =>
  `<UserName user={${obj}} masked` + (fallback ? ` fallback={${fallback}}` : '') + ` />`;

const PATTERNS = [
  new RegExp(String.raw`\{\s*(${OBJ})\??\.displayName\s*\|\|\s*\1\??\.username\s*\|\|\s*('[^']*'|"[^"]*")\s*\}`, 'g'),
  new RegExp(String.raw`\{\s*(${OBJ})\??\.displayName\s*\|\|\s*\1\??\.username\s*\}`, 'g'),
  new RegExp(String.raw`\{\s*(${OBJ})\??\.displayName\s*\|\|\s*('[^']*'|"[^"]*")\s*\}`, 'g'),
  new RegExp(String.raw`\{\s*(${OBJ})\??\.displayName\s*\}`, 'g'),
  new RegExp(String.raw`\{\s*(${OBJ})\??\.displayName\s*\|\|\s*\1\??\.username\s*\|\|\s*([^}]+?)\s*\}`, 'g'),
];

const head = (file) => {
  try {
    return execFileSync('git', ['show', `HEAD:${norm(relative('.', file))}`], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
  } catch { return null; }
};

let fixed = 0, files = 0, ambiguous = 0;

for (const f of walk('src')) {
  const cur = readFileSync(f, 'utf8');
  // A stranded `$` or `=` directly before the tag is the ONLY marker of damage.
  if (!/[$=]<UserName/.test(cur)) continue;

  const src = head(f);
  if (!src) { console.log('NO HEAD VERSION', norm(f)); continue; }

  // tag text -> the original `{...}` it replaced.
  const map = new Map();
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    for (const m of src.matchAll(re)) {
      const key = tag(m[1], m[2] || null);
      if (map.has(key) && map.get(key) !== m[0]) ambiguous++;
      if (!map.has(key)) map.set(key, m[0]);
    }
  }

  let out = cur, n = 0;
  for (const [key, original] of map) {
    for (const lead of ['$', '=']) {
      const needle = lead + key;
      // ⚠ split/join, never String.replace: a replacement containing `$$` or
      // `$&` is interpreted by replace() as an escape and silently mangled.
      if (!out.includes(needle)) continue;
      n += out.split(needle).length - 1;
      out = out.split(needle).join(lead + original);
    }
  }

  if (!n) { console.log('UNREPAIRED (no matching original)', norm(f)); continue; }
  files++; fixed += n;
  console.log(String(n).padStart(3), norm(relative('src', f)));
  if (APPLY) writeFileSync(f, out);
}

console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — ${fixed} sites in ${files} files`);
if (ambiguous) console.log(`⚠ ${ambiguous} ambiguous tag(s): two different originals produced the same tag; first won. Review those files.`);
if (!APPLY) console.log('re-run with --apply to write');
