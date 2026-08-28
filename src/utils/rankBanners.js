// Rank entry-banner palettes.
//
// Source of truth for the colours used by the live-stream entry announcement
// (src/components/streams/JoinAnnouncer.jsx). Derived by measuring the founder's
// reference sheet pixel by pixel; full analysis and the art briefs live in
// docs/ENTRY_BANNER_ART_SPEC.md, and the generation prompts in
// docs/ENTRY_BANNER_PROMPTS.md.
//
// THE RULE, measured off all ten reference samples: the avatar ring and the
// username are the SAME hue. The username is slightly brighter than the ring and
// carries a soft vertical gradient (lighter top, deeper bottom); the ring sits at
// the darker stop. "LIVE" takes the rank colour; "joined" and "to watch the"
// stay white. Do not break that pairing, it is the whole look.
//
// `art` is a background generated per rank at 4:1 and dropped in at
// public/brand/entry/{id}.webp (+ @2x). Until those land, `fallback` renders a
// CSS-only version of the same palette, so nothing looks broken and no art is
// load-bearing.
//
// Level bands mirror RANK_TIERS in src/utils/vpSystem.js. Server mirror:
// functions/streamJoins.js. If a rank colour changes, change it in BOTH.

/**
 * ⚠ Two colours here deliberately differ from RANK_TIERS, because RANK_TIERS
 * cannot render as a neon ring (see docs/ENTRY_BANNER_ART_SPEC.md §4):
 *   - Veteran: RANK_TIERS says onyx #2A2A2A, which is darker than the banner
 *     itself and would be invisible as both a ring and a username. Rendered here
 *     as platinum-on-obsidian.
 *   - Ascendant: #FFB347 sits ~15 degrees of hue from Challenger's gold and reads
 *     as a second gold at 280px, so the name gradient travels amber to rose.
 * Both are flagged as open founder decisions (C2 and C4 in the art spec).
 */
export const RANK_BANNERS = [
  { id: 'rookie',     name: 'Rookie',     min: 1,   max: 10,
    ring: '#9AA3B2', nameTop: '#C7CEDA', nameBottom: '#8E97A6', base: '#0E1014' },
  { id: 'contender',  name: 'Contender',  min: 11,  max: 20,
    ring: '#E08A3C', nameTop: '#FFC489', nameBottom: '#C46A22', base: '#100A06' },
  { id: 'rival',      name: 'Rival',      min: 21,  max: 30,
    ring: '#D7DEE8', nameTop: '#FFFFFF', nameBottom: '#A9B4C4', base: '#0C0E12' },
  { id: 'challenger', name: 'Challenger', min: 31,  max: 40,
    ring: '#F5C542', nameTop: '#FFE9A3', nameBottom: '#DFA51C', base: '#0B0803' },
  { id: 'elite',      name: 'Elite',      min: 41,  max: 50,
    ring: '#4DFFD4', nameTop: '#B9FFEE', nameBottom: '#23D6AE', base: '#04120F' },
  { id: 'champion',   name: 'Champion',   min: 51,  max: 60,
    ring: '#7B6FFF', nameTop: '#B9B3FF', nameBottom: '#5A4DEB', base: '#070518' },
  { id: 'veteran',    name: 'Veteran',    min: 61,  max: 70,
    ring: '#C9CDD4', nameTop: '#EDEFF2', nameBottom: '#9AA0AA', base: '#050505' },
  { id: 'legend',     name: 'Legend',     min: 71,  max: 80,
    ring: '#E0115F', nameTop: '#FF6B9D', nameBottom: '#B00A45', base: '#100005' },
  { id: 'mythic',     name: 'Mythic',     min: 81,  max: 90,
    ring: '#C87FFF', nameTop: '#E9C4FF', nameBottom: '#A24FF0', base: '#08021A' },
  { id: 'ascendant',  name: 'Ascendant',  min: 91,  max: 99,
    ring: '#FFB347', nameTop: '#FFD9A0', nameBottom: '#FF7AB8', nameMid: '#FF9A6B', base: '#070316' },
  { id: 'immortal',   name: 'Immortal',   min: 100, max: 100,
    ring: '#FFFFFF', nameTop: '#FFFFFF', nameBottom: '#DCE6FF', base: '#000000' },
];

/** Level at or above which a high-rank entrance gains the travelling border. */
export const BORDER_SWEEP_LEVEL = 71;   // Legend+
/** Level at or above which the card gains a one-pass shimmer + entry sound. */
export const SHIMMER_LEVEL = 91;        // Ascendant+
/** Minimum level at which a NON-follower stranger earns a card at all. */
export const STRANGER_CARD_LEVEL = 31;  // Challenger+

export const getRankBanner = (level) => {
  const l = Math.max(1, Math.min(100, Number(level) || 1));
  return RANK_BANNERS.find((r) => l >= r.min && l <= r.max) || RANK_BANNERS[0];
};

export const rankBannerById = (id) =>
  RANK_BANNERS.find((r) => r.id === id) || RANK_BANNERS[0];

/** Art slot. Returns null-safe paths; the component falls back if they 404. */
export const rankArt = (id) => ({
  src: `/brand/entry/${id}.webp`,
  srcSet: `/brand/entry/${id}.webp 1x, /brand/entry/${id}@2x.webp 2x`,
});

// ── Username size on the entry ribbon ───────────────────────────────
//
// ⚠ TWO WRONG ATTEMPTS BEFORE THIS ONE. Recorded so nobody tries them again.
//
// 1. A hand-tuned step ladder by character count. Truncated "nova_kill" to
//    "NOVA_..." with visible space to spare.
// 2. The same ladder replaced by one measured constant, 1.017 x fontSize per
//    character. That made MORE names truncate, because 1.017 turned out to be
//    the NARROWEST name in the sample, not the average.
//
// Measured widths of Syne 800 italic uppercase, per character, per unit of
// font-size:  nova_kill 1.017 · Sable 1.072 · ALEX 1.086 · a_long_handle 1.154
// · DrLupo 1.197 · Vergr 1.211 · xQcOW 1.368.
//
// A 34% spread. Character COUNT does not predict width, because W/Q/M are wide
// and l/i/_ are narrow, so no constant can be right for every handle. The only
// correct input is the actual string, so it is measured with canvas
// measureText, which costs nothing and is exact.
//
// Geometry, measured at the real 280x70 ribbon:
//   text column 194px − "joined" 44px − 6px gap = 148px available.
// SAFETY is 0.94 of that, because measureText ignores the -0.01em letter
// spacing (making it read slightly wide, which is the safe direction) and can
// fall back to a substitute metric if Syne has not finished loading on the
// first paint.
const NAME_AVAIL_FRACTION = 148 / 280;   // of ribbon WIDTH, so it scales
const SAFETY = 0.94;
const MIN_SCALE = 0.16;                  // of ribbon height; below this it is unreadable
const MAX_SCALE = 0.34;                  // the reference sheet's punch for short names

let _ctx = null;
const measureCtx = () => {
  if (_ctx) return _ctx;
  if (typeof document === 'undefined') return null;
  try { _ctx = document.createElement('canvas').getContext('2d'); } catch { _ctx = null; }
  return _ctx;
};

/**
 * Font size, in px, for `name` on a ribbon `w` x `h`. Measures the real string
 * so a wide handle shrinks and a narrow one does not.
 * Falls back to a conservative per-character estimate where canvas is absent
 * (SSR, the prerender pass), which is the only place a guess is acceptable.
 */
export const nameSizeFor = (name, w = 280, h = 70) => {
  const avail = w * NAME_AVAIL_FRACTION * SAFETY;
  const text = String(name || '').toUpperCase();
  if (!text) return Math.round(h * MAX_SCALE);
  const ctx = measureCtx();
  let perPx;               // width in px per 1px of font-size
  if (ctx) {
    ctx.font = 'italic 800 100px Syne, sans-serif';
    perPx = ctx.measureText(text).width / 100;
  } else {
    perPx = text.length * 1.368;   // the widest measured sample: never overflows
  }
  const size = perPx > 0 ? avail / perPx : h * MAX_SCALE;
  return Math.floor(Math.min(h * MAX_SCALE, Math.max(h * MIN_SCALE, size)));
};

/**
 * CSS-only stand-in for the generated art, and the permanent fallback if an
 * image fails. Mirrors the brief: dark and calm on the left (the avatar sits
 * there), all the colour energy on the right.
 */
export const fallbackBackground = (r) =>
  `radial-gradient(120% 180% at 92% 50%, ${r.ring}55 0%, ${r.ring}22 34%, transparent 68%),`
  + `linear-gradient(90deg, ${r.base} 0%, ${r.base} 42%, ${r.nameBottom}22 78%, ${r.ring}33 100%)`;
