// Small badge variants for the chat crest. Effect 21, doc §5.
//
// ⚠ THIS EXISTS BECAUSE THE CREST ART IS 1024x1024 AND AVERAGES 171 KB, TO DRAW
// A 13-PIXEL ICON. Measured: 30 files, 5,124,234 bytes. A stream chat with eight
// distinct rank bands present downloaded ~1.4 MB and decoded eight 1024x1024
// surfaces (4 MB of RGBA each) to paint eight 13px images.
//
// Effect 21 would have doubled that, because `mask-image` on the same URL is a
// second decode of the same source per crest.
//
// 64px = the 13px crest at 4x, which covers a 3x-DPR phone with headroom. The
// /prestige screen renders at 96px and deliberately keeps the full-size art.
//
//   node scripts/build-badge-sizes.mjs           # write public/badges/sm/
//   node scripts/build-badge-sizes.mjs --check   # verify, write nothing
//
// --check is what `npm run check` runs, so a new badge added without a small
// variant fails the build instead of silently serving 1 MB into chat.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public', 'badges');
const OUT = path.join(SRC, 'sm');
export const SMALL_PX = 64;

const check = process.argv.includes('--check');

const sources = fs.readdirSync(SRC).filter((f) => f.endsWith('.webp'));
if (!sources.length) {
  console.error('build-badge-sizes: no badge art in public/badges');
  process.exit(1);
}

if (!check) fs.mkdirSync(OUT, { recursive: true });

let missing = 0;
let written = 0;
let srcBytes = 0;
let outBytes = 0;

for (const f of sources) {
  const from = path.join(SRC, f);
  const to = path.join(OUT, f);
  srcBytes += fs.statSync(from).size;

  if (check) {
    if (!fs.existsSync(to)) { console.error(`  MISSING public/badges/sm/${f}`); missing++; }
    else outBytes += fs.statSync(to).size;
    continue;
  }

  // `fit: 'inside'` keeps the art square without padding it, and the source is
  // already 1:1. Alpha is preserved because the sheen masks against it.
  await sharp(from)
    .resize(SMALL_PX, SMALL_PX, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90, effort: 6 })
    .toFile(to);
  outBytes += fs.statSync(to).size;
  written++;
}

if (check) {
  if (missing) {
    console.error(`build-badge-sizes --check: ${missing} small badge(s) missing. Run: node scripts/build-badge-sizes.mjs`);
    process.exit(1);
  }
  console.log(`build-badge-sizes --check: OK, ${sources.length} small badges present (${(outBytes / 1024).toFixed(0)} KB)`);
} else {
  const pct = (100 - (outBytes / srcBytes) * 100).toFixed(1);
  console.log(`build-badge-sizes: wrote ${written} files`);
  console.log(`  1024px source : ${(srcBytes / 1024).toFixed(0)} KB (avg ${(srcBytes / sources.length / 1024).toFixed(0)} KB)`);
  console.log(`  ${SMALL_PX}px chat   : ${(outBytes / 1024).toFixed(0)} KB (avg ${(outBytes / sources.length / 1024).toFixed(1)} KB)  -${pct}%`);
}
