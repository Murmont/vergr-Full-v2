#!/usr/bin/env node
/**
 * Normalise and compress the coin-pack illustrations.
 *
 *   node scripts/packArt.mjs            rebuild every pack image
 *   node scripts/packArt.mjs --check    report only, change nothing
 *
 * ## The problem this fixes
 *
 * The eight source illustrations are all 1024x1024, but the SUBJECT inside each
 * canvas fills anywhere from 29% (starter) to 83% (titan) of the frame. Rendered
 * with `object-fit: contain` in a fixed box, that makes the starter pack look
 * tiny and the titan pack look huge, with every baseline in a different place.
 * It reads as a broken grid, and no amount of CSS fixes it because the padding
 * is baked into the pixels.
 *
 * So: trim each image to its subject, scale that subject to one consistent
 * fraction of the frame, and re-centre it on a shared square canvas. After this
 * every pack occupies the same optical space and the row lines up.
 *
 * Uniform rather than a size ramp on purpose. A ramp (small pack small, big pack
 * big) is nice merchandising in a fixed row, but the grid wraps responsively, so
 * cards that are not adjacent in the ladder end up side by side and the ramp
 * reads as random sizing instead of progression. The artwork itself carries the
 * sense of scale: a coin pile versus a treasure chest.
 *
 * ## And the weight
 *
 * The source PNGs are 1.6-2.4MB each and live in `public/`, so all ~15MB of them
 * were being deployed and served for nothing. The WebPs beside them are 107-399KB,
 * about 2MB for eight, against a budget of "well under 200KB total" in the plan.
 * That is why the founder sees them load slowly.
 *
 * Output here is a single 288px WebP per pack, which is already 2x for the ~144px
 * box the card draws, at roughly 15-25KB each.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const OUT_DIR = 'public/brand/packs';
const SRC_DIR = 'art-src/packs';

/** Rendered size. 2x the ~144px box the card uses, so it is retina-ready. */
const CANVAS = 288;

/**
 * How much of the frame the subject occupies after normalising.
 *
 * 0.88 leaves a small, even margin so a drop-shadow in the CSS has somewhere to
 * fall and nothing touches the edge of its box.
 */
const FILL = 0.88;

/** Alpha cutoff for the trim. Low enough to keep soft glows, high enough to cut
 *  the transparent padding these were exported with. */
const TRIM_THRESHOLD = 12;

const check = process.argv.includes('--check');
const kb = (n) => `${(n / 1024).toFixed(0)}KB`;

/**
 * Sources: prefer the PNG (lossless, so re-encoding does not stack artefacts),
 * fall back to the existing WebP where no PNG survives.
 */
function sourceFor(id) {
  for (const dir of [SRC_DIR, OUT_DIR]) {
    for (const ext of ['png', 'webp']) {
      const p = path.join(dir, `${id}-pack.${ext}`);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function packIds() {
  const seen = new Set();
  for (const dir of [SRC_DIR, OUT_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const m = /^(.+)-pack\.(png|webp)$/.exec(f);
      if (m) seen.add(m[1]);
    }
  }
  return [...seen].sort();
}

const ids = packIds();
if (!ids.length) {
  console.error(`No pack art found in ${SRC_DIR} or ${OUT_DIR}.`);
  process.exit(1);
}

let total = 0;
for (const id of ids) {
  const src = sourceFor(id);
  if (!src) { console.log(`${id.padEnd(11)} SKIP (no source)`); continue; }

  // Trim to the subject, then scale that subject to a fixed fraction of the
  // canvas. `fit: inside` preserves the subject's own aspect ratio, so a wide
  // chest stays wide; what is normalised is how much room it takes up.
  const box = Math.round(CANVAS * FILL);
  const subject = await sharp(src)
    .trim({ threshold: TRIM_THRESHOLD })
    .resize(box, box, { fit: 'inside', withoutEnlargement: false })
    .toBuffer();

  const out = await sharp({
    create: {
      width: CANVAS, height: CANVAS, channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: subject, gravity: 'centre' }])
    .webp({ quality: 72, effort: 6 })
    .toBuffer();

  const dest = path.join(OUT_DIR, `${id}-pack.webp`);
  const before = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
  total += out.length;

  if (check) {
    console.log(`${id.padEnd(11)} ${kb(before).padStart(6)} -> ${kb(out.length).padStart(6)}  (dry run)`);
  } else {
    fs.writeFileSync(dest, out);
    console.log(`${id.padEnd(11)} ${kb(before).padStart(6)} -> ${kb(out.length).padStart(6)}  ${CANVAS}px`);
  }
}

console.log('');
console.log(`${ids.length} packs, ${kb(total)} total${check ? ' (dry run, nothing written)' : ''}`);
if (total > 200 * 1024) {
  console.log('WARNING: over the 200KB budget for the whole set. Lower quality or CANVAS.');
}
