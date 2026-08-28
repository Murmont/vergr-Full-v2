// Placeholder store art for the 7 boosts and the 9 VP bonus packs.
//
// ⚠ THESE ARE PLACEHOLDERS AND THE FILENAMES ARE THE CONTRACT. Founder, 2026-08-28:
// "at least make it look good enough so we can replace it later". Drop a real
// render at the same path and it takes over with no code change, because
// boostArt() / bonusArt() resolve by art id.
//
// ⚠ NOT A GLYPH ON A TINTED SQUARE. That treatment is what got the milestone
// badges rejected. Every mark here gets the language the rest of the app uses:
// a ramp rather than a flat fill, an emissive glow rather than a plain blur,
// light from the upper left, and a medallion giving the icon somewhere to sit.
//
// ⚠ VP BONUSES USE THE REAL VP ICON. Founder: "for the VP boosts use the VP
// icon". /brand/vp-gem.webp is an actual render, so those nine come out looking
// finished rather than placeholder. Only the bloom intensity varies, by
// multiplier, so a 3x reads hotter than a 1.5x without inventing nine arts.
//
// Icons are the SVGs already in scripts/chat-pattern-icons (Phosphor MIT +
// game-icons.net CC BY 3.0, credited on /platform/credits). No new dependency
// and no new licence obligation.
//
//   node scripts/build-store-art.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { BOOSTS } from '../src/utils/boosts.js';
import { VP_BONUS_PACKS } from '../src/utils/vpBonuses.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = path.join(repo, 'scripts', 'chat-pattern-icons');
const SIZE = 288;

// Ramps mirrored from StorePackCard.RAMPS. A single hex reads as paint; a ramp
// reads as material. Same rule the gold gauge and the name gradient follow.
const RAMP = {
  ember: ['#FFD2DA', '#FF8098', '#F04060', '#B81E3C'],
  violet: ['#E9D2FF', '#C88BFF', '#9B45F5', '#6B18D6'],
};
const ACCENT = { ember: '#F04060', violet: '#B44FFF' };

// The closest icon we actually have. There is no person or group icon in the
// set, so profile and teammate lean on meaning rather than depiction.
const ICON_FOR = {
  'post-boost': 'arcade__rocket',
  'teammate-boost': 'chatter__chats',
  'profile-boost': 'cosmos__sparkle',
  'squad-boost': 'arcade__shield',
  'stream-boost': 'studio__broadcast',
  'stream-super': 'arcade__star',
  'stream-mega': 'vault__crown',
};

const readIcon = (name) => {
  const src = fs.readFileSync(path.join(ICONS, name + '.svg'), 'utf8');
  const d = [...src.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
  if (d.length === 0) throw new Error('no path in ' + name + '.svg');
  const vb = src.match(/viewBox="([^"]+)"/);
  return { d, box: vb ? vb[1].split(/\s+/).map(Number) : [0, 0, 256, 256] };
};

const markSvg = (iconName, tone) => {
  const { d, box } = readIcon(iconName);
  const vw = box[2];
  const vh = box[3];
  const s = RAMP[tone];
  const draw = 0.42 * SIZE;
  const k = draw / Math.max(vw, vh);
  const tx = (SIZE - vw * k) / 2;
  const ty = (SIZE - vh * k) / 2;
  const paths = (fill, extra) =>
    d.map((p) => '<path d="' + p + '" fill="' + fill + '" ' + (extra || '') + '/>').join('');

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + SIZE + '" height="' + SIZE + '" viewBox="0 0 ' + SIZE + ' ' + SIZE + '">',
    '<defs>',
    // ⚠ NO WHITE OVERLAY ON THE GLYPH. The first pass laid a 50% white specular
    // over the top half and every mark came out flat pastel pink, which is the
    // "glyph on a tinted circle" look that got the milestone badges rejected.
    // Semi-transparent white over a saturated fill averages toward grey; the
    // same lesson .vg-bloom already records. Depth comes from the RAMP RANGE and
    // from the dark well behind, never from painting white on top.
    '<linearGradient id="ramp" x1="0.2" y1="0" x2="0.8" y2="1">',
    '<stop offset="0%" stop-color="' + s[0] + '"/><stop offset="34%" stop-color="' + s[1] + '"/>',
    '<stop offset="72%" stop-color="' + s[2] + '"/><stop offset="100%" stop-color="' + s[3] + '"/>',
    '</linearGradient>',
    '<radialGradient id="bloom" cx="50%" cy="46%" r="52%">',
    '<stop offset="0%" stop-color="' + ACCENT[tone] + '" stop-opacity="0.30"/>',
    '<stop offset="62%" stop-color="' + ACCENT[tone] + '" stop-opacity="0.09"/>',
    '<stop offset="100%" stop-color="' + ACCENT[tone] + '" stop-opacity="0"/>',
    '</radialGradient>',
    // The well. A DARKER disc than the card, so a bright mark has something to
    // sit against. The first pass used a near-invisible white plate and the
    // glyph had nothing to separate it from the card.
    '<radialGradient id="well" cx="40%" cy="32%" r="78%">',
    '<stop offset="0%" stop-color="#000000" stop-opacity="0.20"/>',
    '<stop offset="100%" stop-color="#000000" stop-opacity="0.46"/>',
    '</radialGradient>',
    // Rim light, hot at the upper left and gone by the lower right, matching the
    // single light direction the rest of the app is lit from.
    '<linearGradient id="rim" x1="0.12" y1="0" x2="0.88" y2="1">',
    '<stop offset="0%" stop-color="' + s[0] + '" stop-opacity="0.92"/>',
    '<stop offset="42%" stop-color="' + ACCENT[tone] + '" stop-opacity="0.42"/>',
    '<stop offset="100%" stop-color="' + s[3] + '" stop-opacity="0.06"/>',
    '</linearGradient>',
    '<filter id="glow" x="-60%" y="-60%" width="220%" height="220%">',
    '<feGaussianBlur stdDeviation="7"/>',
    '</filter>',
    '</defs>',
    '<rect width="' + SIZE + '" height="' + SIZE + '" fill="url(#bloom)"/>',
    '<circle cx="' + SIZE / 2 + '" cy="' + SIZE / 2 + '" r="' + SIZE * 0.345 + '" fill="url(#well)"/>',
    '<circle cx="' + SIZE / 2 + '" cy="' + SIZE / 2 + '" r="' + SIZE * 0.345 + '" fill="none" stroke="url(#rim)" stroke-width="2.2"/>',
    '<g transform="translate(' + tx + ' ' + ty + ') scale(' + k + ')">',
    paths(ACCENT[tone], 'filter="url(#glow)" opacity="0.85"'),
    paths('url(#ramp)'),
    '</g>',
    '</svg>',
  ].join('\n');
};

// quality 80: these are drawn at 132px in the card, and the coin pack art it
// sits beside is 19KB. A 100KB placeholder would be the heaviest thing on the
// shop tab for no visible gain at that size.
const write = async (input, outBase, q = 80) => {
  fs.mkdirSync(path.dirname(outBase), { recursive: true });
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  await sharp(buf, { density: 384 }).resize(SIZE, SIZE).webp({ quality: q }).toFile(outBase + '.webp');
  await sharp(buf, { density: 768 }).resize(SIZE * 2, SIZE * 2).webp({ quality: q }).toFile(outBase + '@2x.webp');
};

// The VP packs get the real VP render on a violet bloom, hotter for a bigger
// multiplier. Nothing here is invented art.
const vpMark = async (mult) => {
  const heat = Math.min(1, Math.max(0, (mult - 1.5) / 1.5));
  const o1 = (0.20 + 0.22 * heat).toFixed(3);
  const o2 = (0.06 + 0.10 * heat).toFixed(3);

  // ⚠ BUILT AT 2x NATIVELY, and the composite is why. The first version passed
  // `density: 384` to a 288px background SVG, which rasterised the BACKGROUND to
  // 1536px while the gem stayed 224px, so every pack rendered a speck of a gem
  // floating in a huge violet cloud. Density scales an SVG; it does not scale
  // what you composite onto it. Rasterise the canvas at the size you actually
  // want, then size the overlay against THAT.
  const W = SIZE * 2;
  const bg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + W + '">' +
    '<defs><radialGradient id="b" cx="50%" cy="46%" r="54%">' +
    '<stop offset="0%" stop-color="' + ACCENT.violet + '" stop-opacity="' + o1 + '"/>' +
    '<stop offset="62%" stop-color="' + ACCENT.violet + '" stop-opacity="' + o2 + '"/>' +
    '<stop offset="100%" stop-color="' + ACCENT.violet + '" stop-opacity="0"/>' +
    '</radialGradient></defs>' +
    '<rect width="' + W + '" height="' + W + '" fill="url(#b)"/></svg>'
  );
  const gem = await sharp(path.join(repo, 'public', 'brand', 'vp-gem.webp'))
    .resize(Math.round(W * 0.82), Math.round(W * 0.82), {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();
  return sharp(bg)
    .composite([{ input: gem, gravity: 'centre' }])
    .png()
    .toBuffer();
};

let n = 0;
for (const b of BOOSTS) {
  const icon = ICON_FOR[b.art];
  if (!icon) throw new Error('no icon mapped for boost art "' + b.art + '"');
  await write(markSvg(icon, 'ember'), path.join(repo, 'public', 'brand', 'boosts', b.art));
  n += 1;
}
for (const p of VP_BONUS_PACKS) {
  await write(await vpMark(p.mult), path.join(repo, 'public', 'brand', 'bonuses', p.art));
  n += 1;
}
console.log('build-store-art: wrote ' + n + ' marks (' + n * 2 + ' files) at ' + SIZE + 'px + @2x');
