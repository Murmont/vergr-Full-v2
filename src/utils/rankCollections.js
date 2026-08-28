// ═══════════════════════════════════════════════════════════════════
// RANK COLLECTIONS
// ═══════════════════════════════════════════════════════════════════
//
// A collection is ONE visual family expressed on three surfaces, ordered by how
// often other people see them:
//
//   chat nameplate   every message you send, to the whole room   100s / stream
//   entrance ribbon  every room you walk into                    1 at a time
//   profile theme    when somebody opens your profile            1
//
// This replaces "profile themes". A theme alone is a reward on the page a user
// visits least, and nobody grinds 100 levels for something only they see. The
// nameplate is the engine: somebody sees it in chat, does not have it, wants it.
//
// It stays inside the founder ruling (rank shows in LIVE CHAT and the STREAM
// ENTRANCE, nowhere else) because those are exactly the two surfaces.
//
// ── THE CONSTRAINT THAT DECIDES EVERY TECHNIQUE ──
//
// A nameplate renders HUNDREDS of times per stream. A theme renders ONCE. They
// therefore cannot use the same technique:
//
//   nameplate  pure CSS only. one shared background tile.
//              ZERO filters, ZERO canvas, ZERO blend modes.
//   ribbon     CSS + at most one SVG filter
//   theme      anything: canvas, WebGL, filter chains
//
// An feDiffuseLighting filter on 200 chat rows is guaranteed jank. The same
// filter once on a profile is free. Every collection below expresses its
// material three times at three budgets.
//
// COST: zero reads. Everything derives from `vpLevel` and the equipped ids,
// which the relay already stamps on every message from the profile it loads
// once per connection.

import { PROFILE_ACCENTS } from './rankUnlocks.js';   // .js so the preview harness can import this under node ESM

/**
 * One shared noise tile for EVERY nameplate on screen. The browser decodes it
 * once and reuses it, so 200 chat rows cost one image.
 *
 * ⚠ SINGLE-quoted url() with %22 inside. A double-quoted url("data:...")
 * silently kills the ENTIRE `background` shorthand wherever the CSS reaches an
 * HTML style attribute, and the element then renders its parent's colour with
 * no error anywhere. That cost an afternoon on the first theme attempt.
 */
export const noiseTile = (a = 0.06) =>
  "url('data:image/svg+xml," +
  "%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2264%22 height=%2264%22%3E" +
  "%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%221.1%22 " +
  "numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E" +
  "%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22 opacity=%22" + a +
  "%22/%3E%3C/svg%3E')";

/** #RRGGBB + alpha -> rgba(). Inputs are the 12 accent hexes, so no edge cases. */
export const hexA = (hex, alpha) => {
  const n = parseInt(String(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

/** Darken toward black. Used for the low end of a two-stop accent ramp. */
export const shade = (hex, amount) => {
  const n = parseInt(String(hex).slice(1), 16);
  const f = 1 - amount;
  return `rgb(${Math.round(((n >> 16) & 255) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
};

/** WCAG relative luminance. */
const lum = (r, g, b) => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const rgbOf = (hex) => {
  const n = parseInt(String(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const contrast = (a, b) => {
  const [l1, l2] = [lum(...a), lum(...b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

/**
 * Darken `hex` until it hits `target` contrast against `onHex`, preserving hue.
 * Steps in 4% increments and stops at the first pass, so a colour that already
 * passes is left completely alone.
 */
export const inkOn = (hex, onHex, target = 4.5) => {
  const bg = rgbOf(onHex);
  let [r, g, b] = rgbOf(hex);
  for (let i = 0; i < 40; i++) {
    if (contrast([r, g, b], bg) >= target) break;
    r *= 0.95; g *= 0.95; b *= 0.95;
  }
  return toHex(r, g, b);
};

// ── Ink ─────────────────────────────────────────────────────────────
// Ink is a PIGMENT. It absorbs light, so on pale stock it must be dark, and a
// raw accent hex on cream paper is close to illegible (mint on #DCCEB2 lands
// around 1.6:1). This darkens the accent until it MEASURES 4.5:1 against the
// paper, so every one of the twelve accents is readable by construction rather
// than by hoping.

/** The stock Grain prints on. Its own constant so ink and paper cannot drift. */
export const GRAIN_PAPER = '#DCCEB2';

// ── The ladder ──────────────────────────────────────────────────────
export const COLLECTIONS = [
  { id: 'default',  min: 1,  name: 'Standard', tag: 'the baseline' },   // id matches firestore.rules cosmeticMinLevel + existing docs: no migration
  { id: 'deep',     min: 6,  name: 'Deep',     tag: 'one cold light, far above' },
  { id: 'grain',    min: 16, name: 'Grain',    tag: 'printed, not lit' },
  { id: 'beam',     min: 27, name: 'Beam',     tag: 'projection, with dust in the air' },
  { id: 'carved',   min: 38, name: 'Carved',   tag: 'milled from one block' },
  { id: 'aurora',   min: 52, name: 'Aurora',   tag: 'the page is translucent' },
  { id: 'eclipse',  min: 66, name: 'Eclipse',  tag: 'one occluded star' },
  { id: 'nebula',   min: 84, name: 'Nebula',   tag: 'volume, with real depth' },
];

export const collectionById = (id) =>
  COLLECTIONS.find((c) => c.id === id) || COLLECTIONS[0];

export const unlockedCollections = (level = 1) =>
  COLLECTIONS.filter((c) => level >= c.min);

export const isCollectionUnlocked = (id, level = 1) =>
  level >= (COLLECTIONS.find((c) => c.id === id)?.min ?? 999);

export const accentHexFor = (id) =>
  PROFILE_ACCENTS.find((a) => a.id === id)?.color || '#B44FFF';

// ── Accent response ─────────────────────────────────────────────────
// Not every accent suits every material, and pretending otherwise ships bad
// combinations. Cyan ink on warm stock reads sickly; anodised metal compresses
// every hue toward the metallic. Data, not special cases.
const toHex = (r, g, b) =>
  '#' + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');

const desaturate = (hex, amt) => {
  const [r, g, b] = rgbOf(hex);
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  const m = (c) => c + (l - c) * amt;
  return toHex(m(r), m(g), m(b));
};
/** How warm a hue is, 0 (cold) to 1 (warm). Used to bias only cool accents. */
const warmth = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (((n >> 16) & 255) - (n & 255)) / 255 * 0.5 + 0.5;
};

export const accentFor = (collectionId, hex) => {
  const a = hex || '#B44FFF';
  switch (collectionId) {
    // Cool ink on warm stock reads sickly. Only the cold end is pulled back.
    case 'grain':  return desaturate(a, (1 - warmth(a)) * 0.30);
    // Anodising compresses everything toward the metal it sits on.
    case 'carved': return desaturate(a, 0.18);
    default:       return a;
  }
};

// ═══════════════════════════════════════════════════════════════════
// TIER 1 — NAMEPLATES.  Pure CSS. No filters. No canvas. No blend modes.
// Called once per message render, so it stays allocation-light.
// ═══════════════════════════════════════════════════════════════════

// A plate returns { style, ink }.
//
//   style  the row's CSS. Pure CSS, always.
//   ink    OPTIONAL text-colour overrides for the row.
//
// Most collections leave `ink` alone: light text on a dark plate, as chat has
// always been. GRAIN inverts it, because printed stock is a LIGHT material and
// dark ink on pale paper is the whole idea. The first pass made Grain another
// dark plate and it lost the only thing that made it a different material.
export const NAMEPLATES = {
  // The ladder has to start somewhere. Below L6 there is no plate, which is
  // what makes the first one worth reaching.
  default: () => null,

  // DEEP — wet, lit from above. The top edge catches, the bottom falls away.
  deep: (a) => ({
    style: {
      background:
        'linear-gradient(180deg, rgba(150,180,255,0.11) 0%, rgba(8,10,18,0.55) 72%),' +
        `linear-gradient(90deg, ${hexA(a, 0.22)} 0%, transparent 48%)`,
      boxShadow: `inset 0 1px 0 rgba(190,210,255,0.24), inset 2px 0 0 ${hexA(a, 0.85)}`,
      borderRadius: 8,
    },
  }),

  // GRAIN — printed stock, and therefore a LIGHT material. Warm paper in a
  // black chat is instantly recognisable, and it is the only plate on the
  // ladder that inverts the text. Square corners: print has no soft edges.
  // Heavy tooth from the shared tile, because paper is the one material where
  // texture IS the design.
  grain: (a) => ({
    style: {
      background:
        noiseTile(0.17) + ',' +
        'linear-gradient(178deg, #E9DDC6 0%, #DCCEB2 58%, #CCBD9E 100%)',
      backgroundSize: '64px 64px, auto',
      boxShadow:
        'inset 0 1px 0 rgba(255,255,255,0.6),' +          // the sheet's lit top edge
        'inset 0 -2px 3px -1px rgba(92,74,46,0.45),' +    // it curls away at the base
        `inset 4px 0 0 ${a}`,                              // the ink rule
      borderRadius: 2,
    },
    ink: { text: '#3B3228', name: inkOn(a, GRAIN_PAPER), muted: 'rgba(59,50,40,0.60)' },
  }),

  // BEAM — a shaft crosses the plate, hottest off-centre, hard-edged.
  beam: (a) => ({
    style: {
      background:
        `linear-gradient(101deg, transparent 16%, ${hexA(a, 0.36)} 33%,` +
        ` rgba(255,255,255,0.20) 40%, ${hexA(a, 0.20)} 47%, transparent 68%),` +
        'linear-gradient(180deg, rgba(12,8,24,0.58), rgba(6,4,12,0.78))',
      boxShadow: `inset 0 0 0 1px ${hexA(a, 0.20)}`,
      borderRadius: 8,
    },
  }),

  // CARVED — routed into the block. Two passes were too timid to read at 28px:
  // a chamfer rendered as a soft gradient is just a grey box. Machined metal
  // reads through HARD VALUE STEPS, not ramps, so this is built from four
  // stacked insets with abrupt boundaries:
  //
  //   0-38%   the wall in shadow, near-black
  //   38-42%  the chamfer, the one bright step
  //   42-100% the floor, catching a little bounce
  //
  // plus a 1px machined lip top and bottom, and the anodised channel down the
  // trailing edge where colour lives in a cut rather than on a face.
  carved: (a) => ({
    style: {
      background:
        'linear-gradient(180deg,' +
        ' rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.66) 34%,' +          // wall
        ' rgba(214,226,255,0.16) 38%, rgba(214,226,255,0.16) 41%,' + // chamfer
        ' rgba(255,255,255,0.030) 45%, rgba(255,255,255,0.055) 100%)', // floor
      boxShadow:
        'inset 0 1px 0 rgba(0,0,0,1),' +                 // the cut's top arris
        'inset 0 -1px 0 rgba(226,236,255,0.20),' +       // the lower lip catching
        `inset -3px 0 0 ${hexA(a, 0.85)},` +            // anodised channel
        `inset -5px 0 5px -3px ${hexA(a, 0.55)}`,       // its bounce onto the floor
      borderRadius: 3,                                    // milled corners are tight
    },
  }),

  // AURORA — frosted glass with colour moving behind it.
  aurora: (a) => ({
    style: {
      background:
        `linear-gradient(100deg, ${hexA(a, 0.28)} 0%, rgba(61,150,255,0.17) 44%,` +
        ' rgba(180,79,255,0.21) 78%, transparent 100%),' +
        'linear-gradient(180deg, rgba(255,255,255,0.060), rgba(255,255,255,0.015))',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22)',
      borderRadius: 10,
    },
  }),

  // ECLIPSE — near-black, with the entire light budget spent on one hot limb.
  eclipse: (a) => ({
    style: {
      background: `linear-gradient(90deg, ${hexA(a, 0.34)} 0%, rgba(0,0,0,0.74) 17%, rgba(0,0,0,0.86) 100%)`,
      boxShadow: `inset 3px 0 7px -2px ${a}, inset 0 0 0 1px rgba(255,255,255,0.05)`,
      borderRadius: 8,
    },
  }),

  // NEBULA — depth. Two cloud stops at different scales plus tooth, so the
  // plate has interior structure rather than being a smear.
  nebula: (a) => ({
    style: {
      background:
        noiseTile(0.05) + ',' +
        `radial-gradient(62% 210% at 17% 50%, ${hexA(a, 0.44)} 0%, transparent 62%),` +
        'radial-gradient(52% 190% at 73% 50%, rgba(61,127,255,0.28) 0%, transparent 64%),' +
        'linear-gradient(180deg, rgba(10,4,22,0.72), rgba(4,2,10,0.86))',
      backgroundSize: '64px 64px, auto, auto, auto',
      boxShadow: `inset 0 0 0 1px ${hexA(a, 0.22)}`,
      borderRadius: 10,
    },
  }),
};

/**
 * The plate for a chat row: `{ style, ink }` or null.
 * @param {string} collectionId equipped collection
 * @param {string} accentId     equipped accent id (not hex)
 */
export const nameplate = (collectionId, accentId) => {
  const fn = NAMEPLATES[collectionId];
  if (!fn) return null;
  return fn(accentFor(collectionId, accentHexFor(accentId)));
};

/** Just the CSS half, for callers that do not need the ink overrides. */
export const nameplateStyle = (collectionId, accentId) =>
  nameplate(collectionId, accentId)?.style || null;

// ═══════════════════════════════════════════════════════════════════
// SWATCHES — the collection shown at picker scale.
//
// ⚠ This exists because the picker was rendering the OLD profileThemes table
// while the profile rendered the new one, so the preview showed something the
// app would never paint. A swatch must come from the same place as the thing
// it previews or it is worse than no swatch at all.
//
// Pure CSS, like the nameplate: a picker draws eight of these at once.
// ═══════════════════════════════════════════════════════════════════
export const SWATCHES = {
  default: (a) => ({
    background:
      `radial-gradient(120% 160% at 18% 0%, ${hexA(a, 0.20)}, transparent 62%),` +
      'linear-gradient(160deg,#14141F 0%,#0D0D16 100%)',
  }),

  deep: (a) => ({
    background:
      'radial-gradient(120% 90% at 50% -30%, rgba(150,180,255,0.26), transparent 62%),' +
      `radial-gradient(46% 80% at 14% 6%, ${hexA(a, 0.20)}, transparent 62%),` +
      'radial-gradient(130% 46% at 50% 112%, rgba(20,44,92,0.46), transparent 72%),' +
      'linear-gradient(180deg,#0E1119 0%,#04050A 100%)',
  }),

  // PAPER. Light stock with real tooth and an ink rule. At swatch scale this is
  // the whole point: it must be unmistakable next to seven dark ones.
  grain: (a) => ({
    background:
      noiseTile(0.20) + ',' +
      'linear-gradient(178deg, #EADEC7 0%, #DCCEB2 56%, #C9BA9B 100%)',
    backgroundSize: '64px 64px, auto',
    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.6), inset 5px 0 0 ${inkOn(accentFor('grain', a), GRAIN_PAPER)}`,
  }),

  beam: (a) => ({
    background:
      `linear-gradient(101deg, transparent 22%, ${hexA(a, 0.42)} 36%,` +
      ' rgba(255,255,255,0.24) 43%, transparent 62%),' +
      'linear-gradient(180deg,#120B24,#07050E)',
  }),

  // Milled metal: brushed, with a chamfer catching along one edge.
  carved: (a) => ({
    background:
      'repeating-linear-gradient(97deg, rgba(255,255,255,.02) 0 1px, transparent 1px 3px),' +
      'repeating-linear-gradient(97deg, rgba(0,0,0,.26) 0 2px, transparent 2px 7px),' +
      'linear-gradient(168deg,#1B1C21 0%,#0D0E11 52%,#17181D 100%)',
    boxShadow:
      'inset 0 1px 0 rgba(226,236,255,.16), inset 0 -2px 4px -2px rgba(0,0,0,.9),' +
      `inset -4px 0 0 ${hexA(accentFor('carved', a), 0.8)}`,
  }),

  aurora: (a) => ({
    background:
      `radial-gradient(70% 60% at 16% 6%, ${hexA(a, 0.42)}, transparent 62%),` +
      'radial-gradient(58% 74% at 44% -6%, rgba(61,150,255,0.40), transparent 60%),' +
      'radial-gradient(62% 58% at 76% 10%, rgba(180,79,255,0.38), transparent 62%),' +
      'linear-gradient(180deg, transparent 42%, rgba(4,7,16,0.92) 94%),' +
      'linear-gradient(170deg,#08131C,#050810)',
  }),

  eclipse: (a) => ({
    background:
      `radial-gradient(circle 44px at 50% 50%, transparent 56%, ${hexA(a, 0.95)} 60%, ${hexA(a, 0.45)} 66%, transparent 84%),` +
      'radial-gradient(circle 44px at 50% 50%, #000 0%, #000 57%, transparent 58%),' +
      'linear-gradient(170deg,#12040A,#000)',
  }),

  nebula: (a) => ({
    background:
      noiseTile(0.07) + ',' +
      `radial-gradient(38% 62% at 20% 34%, ${hexA(a, 0.62)}, transparent 64%),` +
      'radial-gradient(30% 48% at 70% 12%, rgba(210,140,255,0.42), transparent 62%),' +
      'radial-gradient(44% 62% at 58% 100%, rgba(61,127,255,0.44), transparent 66%),' +
      'radial-gradient(12% 18% at 32% 46%, rgba(255,245,255,0.5), transparent 70%),' +
      'linear-gradient(165deg,#0D0418,#040209)',
    backgroundSize: '64px 64px, auto, auto, auto, auto, auto',
  }),
};

/** Swatch style for the picker. Same source as the profile paints from. */
export const swatchStyle = (collectionId, accentId) => {
  const fn = SWATCHES[collectionId];
  return fn ? fn(accentHexFor(accentId)) : null;
};
