// ⚠⚠ env(safe-area-inset-bottom) IS 0 IN THE ANDROID WEBVIEW. THE TOP ONE IS NOT.
//
// Measured over CDP against the running 1.0.209 app on 2026-09-11 (Chrome 113
// WebView, 412x915, dpr 2.625). Every shape was tested, not just one:
//
//   height: env(safe-area-inset-bottom)          -> 0px
//   height: env(safe-area-inset-bottom, 0px)     -> 0px
//   calc(64px + env(safe-area-inset-bottom))     -> 64px
//   padding-bottom: env(safe-area-inset-bottom)  -> 0px
//   env(safe-area-inset-TOP)                     -> 49px   (works, leave it alone)
//
// So every bottom fix written against that inset was a NO-OP on a phone, which
// is what put the gesture pill through the SHORTS, Buy and History labels and
// under the tip sheet's Send button. 108 sites across 71 files were repointed at
// `--vg-safe-b`, which index.html defines as max(env(...), 24px) on native.
//
// This guard exists so the next session cannot reintroduce the dead form by
// copying an older line. TOP insets are deliberately NOT flagged.
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'src');
const EXT = new Set(['.jsx', '.js', '.css', '.html']);

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (EXT.has(extname(e.name))) files.push(p);
  }
})(SRC);

let failed = 0;
let checked = 0;
const BAD = /env\(\s*safe-area-inset-bottom/;

for (const f of files) {
  checked++;
  const src = readFileSync(f, 'utf8');
  src.split(/\r?\n/).forEach((line, i) => {
    if (!BAD.test(line)) return;
    failed++;
    console.error(
      `FAIL ${relative(ROOT, f)}:${i + 1}\n`
      + `     env(safe-area-inset-bottom) resolves to 0 in the Android WebView.\n`
      + `     Use var(--vg-safe-b) instead (defined in index.html). Inside a Tailwind\n`
      + `     class write it WITHOUT spaces: pb-[calc(var(--vg-safe-b,0px)+1rem)].\n`
      + `     ${line.trim().slice(0, 120)}`,
    );
  });
}

// ⚠⚠ A SPACE INSIDE A TAILWIND ARBITRARY VALUE SILENTLY DELETES THE CLASS.
// `pb-[calc(var(--vg-safe-b, 0px)+4rem)]` is two whitespace-separated tokens to
// Tailwind, neither of them a utility, so NO CSS is generated and the element
// gets no bottom clearance at all. Five sheets shipped like that (message
// actions, chat folders, chat polls, invite members, animated emoji upsell),
// found 2026-09-16 by grepping the built CSS: the space-free control class was
// there, these were not. The message above used to recommend the spaced form,
// which is how it spread.
const SPACED_ARBITRARY = /(?<![\w$.])[a-z][a-z0-9:-]*-\[[^\]\s"`']*(?:var|calc|env|min|max|clamp)\([^\]"`'\n]*?\s[^\]"`'\n]*\]/g;
for (const f of files) {
  if (extname(f) === '.css') continue;
  readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(SPACED_ARBITRARY)) {
      failed++;
      console.error(
        `FAIL ${relative(ROOT, f)}:${i + 1}\n`
        + `     A space inside a Tailwind arbitrary value splits the class in two and\n`
        + `     Tailwind emits no CSS for it. Remove the spaces:\n`
        + `     ${m[0]}`,
      );
    }
  });
}

// index.html is the ONE place the raw inset may appear: it is what feeds the
// variable. Assert that definition still exists, so the variable cannot quietly
// become undefined everywhere (which would silently restore the old bug).
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const defines = /--vg-safe-b:\s*env\(\s*safe-area-inset-bottom/.test(html)
  && /html\.vergr-native\s*\{\s*--vg-safe-b:\s*max\(/.test(html);
if (!defines) {
  failed++;
  console.error('FAIL index.html no longer defines --vg-safe-b from env() with a native max() floor.');
}

if (failed) {
  console.error(`\nsafe-area-check: ${failed} problem(s) across ${checked} files`);
  process.exit(1);
}
console.log(`safe-area-check: ${checked} files clean, --vg-safe-b defined`);
