// Builds the stream ENTRY RIBBON art from the founder's source renders.
//
// The ribbon (src/components/streams/JoinAnnouncer.jsx) is capped at 280px wide
// at a 4:1 aspect and loads /brand/entry/{rankId}.webp with an @2x companion.
// The sources are 4128x1024 JPEGs (~2-4MB each); shipping those would be ~30MB
// of art for a component that draws at 280x70, so they are resized and
// re-encoded here.
//
// 1x is deliberately 560x140 (2x the CSS size, not 1x). The files land around
// 10-25KB each, so the extra sharpness is effectively free, and it means the
// ribbon still holds up if MAX_W is ever raised.
//
//   node scripts/build-entry-banners.mjs
import sharp from 'sharp';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = 'C:/Users/damie/Downloads';
const OUT = `${repo}/public/brand/entry`;

// rankId -> source filename. Ids come from RANK_BANNERS in src/utils/rankBanners.js
// and MUST match, because rankArt() builds the URL straight from the id.
const MAP = {
  rookie:     'ROOKIE lvl 3.jpg',
  contender:  'CONTENDER.jpg',
  rival:      'RIVAL.jpg',
  challenger: 'CHALLENGER.jpg',
  elite:      'ELITE.jpg',
  champion:   'CHAMPION.jpg',
  veteran:    'VETERAN.jpg',
  legend:     'LEGEND.jpg',
  mythic:     'MYTHIC.jpg',
  ascendant:  'ASCENDANT.jpg',
  immortal:   'IMMORTAL.jpg',
};

mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [id, file] of Object.entries(MAP)) {
  const src = `${SRC}/${file}`;
  if (!existsSync(src)) { console.log(`  ! ${id}: source missing (${file})`); continue; }
  for (const [suffix, w] of [['', 560], ['@2x', 1120]]) {
    const dest = `${OUT}/${id}${suffix}.webp`;
    await sharp(src).resize(w, Math.round(w / 4), { fit: 'cover' })
      .webp({ quality: 82, effort: 6 }).toFile(dest);
    total += statSync(dest).size;
  }
  const kb = (statSync(`${OUT}/${id}.webp`).size / 1024).toFixed(1);
  const kb2 = (statSync(`${OUT}/${id}@2x.webp`).size / 1024).toFixed(1);
  console.log(`  ${id.padEnd(11)} ${kb.padStart(6)}KB  @2x ${kb2.padStart(6)}KB`);
}
console.log(`total ${(total / 1024).toFixed(0)}KB across ${Object.keys(MAP).length} ranks`);
