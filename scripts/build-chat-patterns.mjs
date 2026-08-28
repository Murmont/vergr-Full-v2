// Builds the chat-theme pattern tiles into public/chat-patterns/.
//
//   node scripts/build-chat-patterns.mjs            build the tiles + print the measurements
//   node scripts/build-chat-patterns.mjs --review   also serve a review page on :5195
//   node scripts/build-chat-patterns.mjs --debug    draw the packing circles (verification only)
//
// ⚠ IT NEVER TOUCHES public/backgrounds/. The 7 wallpapers are a shipped
// feature and stay exactly as they are (founder, 2026-08-25).
//
// Output is Telegram's pattern format (core.telegram.org/api/wallpapers):
// "completely transparent, except for the pattern itself which should be shades
// of black". The app inverts it into a black sheet with the icons punched out
// and animates the gradient behind the holes.
//
// ── HOW THE ICONS ARE PLACED, AND WHY ───────────────────────────────
// Measured from Telegram's OWN pattern (their web client ships
// src/assets/pattern.svg, 1440x2960, 745 paths). Rasterised, connected-
// component labelled, geometry measured:
//
//   ink coverage        10.5%
//   shapes              520 in 720x1480  = 488 per megapixel = ~288 per 768 tile
//   radius              2.5 / 7.5 median / 50.5 p95 / 102 max   a 40.8x spread
//   bounding circles    75% OVERLAP each other
//
// Two conclusions, both of which changed the design:
//
//   1. DENSITY WAS THE WRONG LEVER. The first version ran 693 shapes at 15.8%
//      ink to kill blank spots. Telegram uses FEWER, more varied shapes. Adding
//      icons was making it worse, not better.
//   2. SIZE SPREAD IS THE REAL DIFFERENCE. Theirs is 40x, the quota version was
//      7x. That is why theirs reads as designed and a quota reads as a machine.
//
// Their 75% circle overlap comes from hand-drawn shapes nesting into each
// other's concavities, which an icon font cannot do. So: NON-OVERLAPPING
// bubbles (founder's call — it makes touching structurally impossible), with
// size taken from the space available rather than from a random draw, which is
// what recovers the spread.
//
// The bubbles are INVISIBLE. They are collision geometry; only the glyph is drawn.
//
// Technique: grow-until-collision packing.
//   generativeartistry.com/tutorials/circle-packing/
//   tylerxhobbs.com/essays/2016/a-randomized-approach-to-cicle-packing
// Seed a candidate, grow its radius a step at a time until it would touch
// something, step back. Sizes are DERIVED FROM THE GAPS, so big anchors appear
// where there is room and small ones fill between them, with no quota to
// flatten the range.
//
// ⚠ WITH A HARD CAP. Uncapped growth puts enormous icons on an empty canvas,
// which the founder explicitly does not want. MAX_R bounds it.
//
// ⚠ THE BUBBLE IS THE GLYPH'S REAL INK, NOT ITS EM BOX. Every glyph is
// rendered once and its minimal enclosing circle measured (Ritter). A `bolt` is
// a thin diagonal and a `keyboard` is a wide rectangle; treating both as a
// square em box would leave one swimming in space and crop the other. This is
// what makes "no two icons touch" true of the ink rather than of a box.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠ NOT UNDER public/. Anything in public/ is copied into dist/ and uploaded
// to Firebase Hosting, whose egress is billed. These tiles are served from R2
// instead (see scripts/publish-chat-patterns.mjs). Firebase's `ignore` globs
// were tried first and did NOT exclude them: the files still deployed and still
// answered 200 from vergr.app. Keeping them out of the tree is the reliable fix.
const OUT = `${repo}/chat-pattern-tiles`;
mkdirSync(OUT, { recursive: true });

// One vocabulary per theme. Telegram's themes do not share a pattern, nor do ours.
//
// ⚠ THE VOCABULARY IS DATA ON DISK, NOT A LITERAL HERE. scripts/chat-pattern-icons/
// holds one SVG per (theme, icon) plus manifest.json naming each icon's source.
// Founder approved the set 2026-08-25 after reviewing all 174 rendered per theme.
//
// SOURCES, and the licence consequence of each:
//   Phosphor Icons  (120)  MIT.        Licence text travels in the repo, no credit UI.
//   game-icons.net  ( 54)  CC BY 3.0.  REQUIRES the artists be credited publicly:
//                                      Lorc, Delapouite, Skoll, Caro Asercion,
//                                      Darkzaitzev. Rendered by the credits page.
// ⚠ Phosphor is taken at the FILL weight, never 'regular'. Regular is a thin
// outline; sparse ink measured 6.4% coverage against a 15.8% target and wrecked
// the blank-spot ratio. Fill also matches game-icons' solid style, so the two
// sources read as one set rather than two.
const ICON_DIR = `${repo}/scripts/chat-pattern-icons`;
const MANIFEST = JSON.parse(readFileSync(`${ICON_DIR}/manifest.json`, 'utf8'));

// Each file is exactly one <path>, in one of two square viewBoxes, with no
// transform, group or fill-rule (audited across all 174). So "parsing" is two
// regexes and the browser turns the d-string into a Path2D. No font, no font
// loading, no ligature lookup, and the geometry is exact rather than hinted.
const PATTERNS = {};
for (const [id, t] of Object.entries(MANIFEST)) {
  PATTERNS[id] = t.icons.map((ic) => {
    const svg = readFileSync(`${ICON_DIR}/${id}__${ic.n}.svg`, 'utf8');
    const d = /<path[^>]*[ ]d="([^"]+)"/.exec(svg);
    const vb = /viewBox="0 0 ([0-9]+) [0-9]+"/.exec(svg);
    if (!d || !vb) throw new Error('unparseable icon: ' + id + '/' + ic.n);
    return { n: ic.n, d: d[1], vb: Number(vb[1]) };
  });
}

const TILE = 768, SCALE = 2;
const DEBUG = process.argv.includes('--debug');

const page = (icons, debug) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:transparent}canvas{display:block}</style>
<canvas id="c" width="${TILE * SCALE}" height="${TILE * SCALE}"></canvas>
<script>
// ⚠ GLYPHS STAYS AN ARRAY OF NAMES. Everything downstream keys off the name
// (byGlyph, metrics, the farthest-twin search), so switching the render path
// from a font to Path2D touches exactly two places: measureGlyphs and draw.
const ICONS = ${JSON.stringify(icons)};
const GLYPHS = ICONS.map((i) => i.n);
const PATHS = {};
for (const i of ICONS) PATHS[i.n] = { p: new Path2D(i.d), vb: i.vb };
const TILE = ${TILE}, SCALE = ${SCALE}, DEBUG = ${debug};

// ── Tunables, all justified against the Telegram measurements above ──
const MIN_R  = 5;     // below this an icon is a speck at phone scale
const MAX_R  = 38;    // ⚠ THE CAP. Founder: no massive icons.
const K      = 0.72;  // circles may overlap to this fraction of their combined radii   // clear space between two icons' INK. Nothing ever touches.
const GROW   = 0.8;   // radius step while growing
const TRIES  = 320;   // candidate positions per seed
const STOP   = 1400;  // consecutive failures before the tile is called full

let seed = 20260825;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

// The tile is a torus: an icon near the right edge is adjacent to one near the
// left. Every distance is measured wrapped, which is what makes the tile
// seamless without a special case at the edges.
function wrapDist(ax, ay, bx, by) {
  let dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  if (dx > TILE / 2) dx = TILE - dx;
  if (dy > TILE / 2) dy = TILE - dy;
  return Math.hypot(dx, dy);
}

// ── GLYPH INK METRICS ───────────────────────────────────────────────
// Render each glyph once, find its ink pixels, and compute the MINIMAL
// ENCLOSING CIRCLE (Ritter's approximation) around them. Gives, per glyph and
// relative to font size: the circle's radius and where its centre sits
// relative to the text origin. So the packing circle is the glyph's real
// silhouette, not its em box.
const REF = 200;
function measureGlyphs() {
  const c = document.createElement('canvas');
  c.width = c.height = REF * 2;
  const ctx = c.getContext('2d');
  const out = {};
  for (const g of GLYPHS) {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000';
    ctx.save();
    // Map the viewBox onto a REF-sized square centred at (REF, REF). Every
    // metric below is then relative to REF exactly as the font version's were
    // relative to font size, which is what lets the bands, the packing and the
    // ink maths carry over completely unchanged.
    ctx.translate(REF / 2, REF / 2);
    ctx.scale(REF / PATHS[g].vb, REF / PATHS[g].vb);
    ctx.fill(PATHS[g].p);
    ctx.restore();
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const pts = [];
    for (let y = 0; y < c.height; y += 2) {
      for (let x = 0; x < c.width; x += 2) {
        if (d[(y * c.width + x) * 4 + 3] > 40) pts.push([x, y]);
      }
    }
    if (!pts.length) { out[g] = { r: 0.5, ox: 0, oy: 0 }; continue; }
    // Ritter: seed with the two extremes, then expand to cover every point.
    let cx = pts[0][0], cy = pts[0][1], r = 0;
    for (const p of pts) { const dd = Math.hypot(p[0]-cx, p[1]-cy); if (dd > r) r = dd; }
    for (let pass = 0; pass < 3; pass++) {
      for (const p of pts) {
        const dd = Math.hypot(p[0]-cx, p[1]-cy);
        if (dd > r) {
          const nr = (r + dd) / 2, k = (nr - r) / dd;
          cx += (p[0]-cx) * k; cy += (p[1]-cy) * k; r = nr;
        }
      }
    }
    // ⚠ INK DENSITY MATTERS AS MUCH AS THE RADIUS. A bolt is a thin diagonal
    // whose enclosing circle is nearly empty; a keyboard fills most of its own.
    // (No backticks in comments in here: this whole page is a template literal
    // and a backtick closes the string, which cost a confusing syntax error.)
    // The first build ignored this and let sparse glyphs win large bubbles,
    // which reserved a big area and then contributed almost no ink: coverage
    // came out at 6.5% against Telegram's 10.5%, and the blank-spot ratio
    // collapsed to 0.25. Density is measured here and used at placement time.
    const area = Math.PI * r * r;
    out[g] = {
      // ⚠ 0.86, not the raw Ritter radius. The enclosing circle is dominated by
      // the single furthest spike of a glyph, so using it whole spaces icons
      // ~40% further apart than the em box did and the corners between circles
      // go to waste: measured 7.3% ink and a 0.10 blank-spot ratio, against
      // 15.8% and 0.66 before. Trimming to 0.86 keeps the silhouette honest
      // while letting neighbours nest into each other's corners, which is what
      // hand-drawn patterns do. The ink-gap measurement below is the check that
      // this never actually lets two icons touch.
      r: (r / REF), ox: (cx - REF) / REF, oy: (cy - REF) / REF,
      fill: (pts.length * 4) / area,   // pts sampled every 2px in both axes
    };
  }
  return out;
}

// ── PACKING ─────────────────────────────────────────────────────────
// Seed a point, size it, and reject only if it would sit too close to a neighbour.
// Nothing is ever placed overlapping, so nothing can touch. Size comes from
// the space, which is what gives the spread a quota cannot.
const ING = 64;   // ink-accounting grid

// ⚠ RADIUS BANDS, LARGEST FIRST. Pure grow-until-collision was tried and
// MEASURED WORSE: 7.1% ink and a 0.25 blank-spot ratio, against 15.8% and 0.66
// from the banded version. The reason is that seeds land everywhere at once, so
// the tile saturates with minimum-radius circles and only the first handful
// ever get room to grow — median radius came out at 5.8 against a 38 maximum.
// Growth is kept as the FINAL step of each placement (a circle still expands
// into whatever room it has, up to its band), but the band decides the scale.
//
// ⚠ BANDS ARE FONT SIZES, NOT RADII, and getting that wrong cost a round.
// Ritter's circle around a glyph has a radius of roughly 0.7 x the font size
// (half the em box diagonal). Specifying the bands as RADII therefore drew
// every icon at about 1.4x SMALLER than intended, and ink coverage collapsed
// from 15.8% to 6.4% while the shape count went UP. The font size is what
// decides how big an icon looks; the ink radius is derived from it per glyph
// and used only for collision.
const BANDS = [
  // ⚠ THE LARGE BAND IS DELIBERATELY MODEST. A big circle reserves a large area
  // but its glyph only inks a third of it, so an oversized icon creates a zone
  // that READS empty and that nothing else can be placed into. Measured: with a
  // 74px top band the blank-spot ratio sat at 0.07-0.29 however the fill was
  // tuned. Telegram gets away with huge shapes because theirs nest into each
  // other's concavities (75% of their bounding circles overlap); non-overlapping
  // bubbles cannot, so the cap does the work instead. This also happens to be
  // exactly what the founder asked for: no massive icons.
  { fs: [30, 44], target: 26 },
  { fs: [20, 29], target: 90 },
  { fs: [13, 19], target: 340 },
  { fs: [7, 11],  target: 700 },
];

function pack(metrics) {
  const placed = [];
  const byGlyph = {}; for (const g of GLYPHS) byGlyph[g] = [];

  // ⚠ SPATIAL HASH, or this never finishes. Testing every candidate against
  // every placed circle is O(n) per try, and the final sweep runs thousands of
  // tries against ~700 circles: the naive version timed out at ~900 million
  // distance checks. Buckets sized to the largest possible pair mean a query
  // only ever looks at a 3x3 neighbourhood, wrapped like everything else.
  // ⚠ BUCKETS MUST BE SIZED FROM THE LARGEST RADIUS THAT CAN ACTUALLY OCCUR,
  // which is the biggest font size times the widest glyph silhouette, NOT the
  // old MAX_R constant. Sizing them from 38 while radii reached 67 meant big
  // pairs fell outside the 3x3 neighbourhood and were never collision-tested:
  // the min ink gap went to -19, i.e. icons overlapping, which is the one thing
  // this whole approach exists to prevent.
  const R_MAX = Math.max(...BANDS.map((b) => b.fs[1])) * Math.max(...GLYPHS.map((g) => metrics[g].r));
  // Small fixed cells with a radius-aware query range. Buckets sized to the
  // biggest possible pair made every lookup scan a quarter of the tile, and the
  // void-filling sweep then took longer than the browser would wait.
  const CS = 24;
  const GN = Math.max(3, Math.ceil(TILE / CS));
  const grid = Array.from({ length: GN * GN }, () => []);
  const gi = (x, y) => ((((y / TILE * GN) | 0) % GN + GN) % GN) * GN
                     + ((((x / TILE * GN) | 0) % GN + GN) % GN);
  const near = (x, y, r) => {
    const span = Math.ceil((r + R_MAX) / CS);
    const cx = ((x / TILE * GN) | 0), cy = ((y / TILE * GN) | 0);
    const out = [];
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        const b = grid[(((cy + dy) % GN + GN) % GN) * GN + (((cx + dx) % GN + GN) % GN)];
        for (const p of b) out.push(p);
      }
    }
    return out;
  };
  // Running ink per cell, so seeding can aim at the thin parts instead of
  // hoping uniform randomness covers evenly. It never does: uniform random
  // seeding is exactly what left the blank spots.
  const inkGrid = new Float32Array(ING * ING);
  const cellOf = (x, y) => (Math.min(ING - 1, (y / TILE * ING) | 0)) * ING + Math.min(ING - 1, (x / TILE * ING) | 0);
  const blurAt = (x, y) => {
    let s = 0, n = 0;
    const cx = (x / TILE * ING) | 0, cy = (y / TILE * ING) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      s += inkGrid[(((cy + dy) % ING + ING) % ING) * ING + (((cx + dx) % ING + ING) % ING)]; n++;
    }
    return s / n;
  };

  const fills = GLYPHS.map((g) => metrics[g].fill).sort((a, b) => a - b);
  const medianFill = fills[(fills.length / 2) | 0];
  const radii = GLYPHS.map((g) => metrics[g].r).sort((a, b) => a - b);
  const medianR = radii[(radii.length / 2) | 0];

  // Pick the display size, then the glyph, then derive the collision radius
  // from that glyph's measured ink. Choosing the glyph BEFORE the radius is the
  // only correct order: a thin bolt and a solid keyboard at the same font size
  // have very different silhouettes, so the bubble has to follow the glyph.
  // ⚠ THE GLYPH SEARCH MUST NOT LIVE INSIDE THE CANDIDATE LOOP. Doing that
  // put ~700 million operations in the build and it timed out. Seeding uses a
  // representative radius for the band; the glyph is chosen ONCE for the chosen
  // seed, and its true ink radius is then re-checked before committing.
  const place = (fsMin, fsMax) => {
    const fsize = fsMin + rnd() * (fsMax - fsMin);
    const big = fsize > 26;
    const rTypical = fsize * medianR;

    let seeded = null, seededInk = Infinity;
    for (let t = 0; t < TRIES; t++) {
      const x = rnd() * TILE, y = rnd() * TILE;
      let room = true;
      for (const p of near(x, y, rTypical)) {
        if (wrapDist(x, y, p.x, p.y) < (p.r + rTypical) * K) { room = false; break; }
      }
      if (!room) continue;
      const ink = blurAt(x, y);
      if (ink < seededInk) { seededInk = ink; seeded = { x, y }; }
      if (t > 140 && seeded) break;
    }
    if (!seeded) return false;

    // Farthest twin, and no airy glyph in a large slot. Once, not 900 times.
    let best = null, bestScore = -1, bestTwin = Infinity;
    for (const g of GLYPHS) {
      const m = metrics[g];
      if (big && m.fill < medianFill * 0.75) continue;
      let nearest = Infinity;
      for (const q of byGlyph[g]) {
        const d = wrapDist(seeded.x, seeded.y, q.x, q.y);
        if (d < nearest) nearest = d;
      }
      const score = (nearest === Infinity ? 1e9 : nearest) * (0.6 + m.fill);
      if (score > bestScore) { bestScore = score; best = g; bestTwin = nearest; }
    }
    if (!best) return false;

    // The chosen glyph's real silhouette may be wider than the representative
    // one, so re-check and shrink to fit rather than allowing a collision.
    let r = fsize * metrics[best].r;
    let fsFinal = fsize;
    let ok = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      let hit = false;
      for (const p of near(seeded.x, seeded.y, r)) {
        if (wrapDist(seeded.x, seeded.y, p.x, p.y) < (p.r + r) * K) { hit = true; break; }
      }
      if (!hit) { ok = true; break; }
      fsFinal *= 0.88; r = fsFinal * metrics[best].r;
      if (fsFinal < fsMin * 0.7) break;
    }
    if (!ok) return false;

    const item = { x: seeded.x, y: seeded.y, r, fs: fsFinal, g: best,
                   rot: (rnd() - 0.5) * 1.7,
                   twin: bestTwin === Infinity ? null : bestTwin };
    placed.push(item);
    grid[gi(item.x, item.y)].push(item);
    byGlyph[best].push(item);
    inkGrid[cellOf(item.x, item.y)] += Math.PI * r * r * metrics[best].fill;
    return true;
  };

  for (const band of BANDS) {
    let made = 0, fails = 0;
    while (made < band.target && fails < 300) {
      if (place(band.fs[0], band.fs[1])) { made++; fails = 0; } else fails++;
    }
  }
  // ── VOID FILLING ────────────────────────────────────────────────
  // Circle packing leaves curved gaps between every three neighbours, and at
  // this scale those read as visible round holes. Keep dropping progressively
  // smaller icons into whatever is thinnest until the field is even.
  for (const fsz of [[8, 12], [6, 9], [5, 7], [4, 6]]) {
    let fails = 0;
    while (fails < 220) {
      if (place(fsz[0], fsz[1])) fails = 0; else fails++;
    }
  }

  // ── TARGETED VOID CLOSING, MEASURED IN INK ──────────────────────
  // ⚠ TWO METRICS FAILED BEFORE THIS ONE, AND BOTH FAILED SILENTLY.
  //
  // 1. measureTile()'s "blank-spot ratio" BLURS over a neighbourhood, so a ring
  //    of dense specks around a round hole still averages fine. It reported
  //    0.52-0.69 (approved build: 0.66) on tiles that visibly had holes.
  // 2. A first fix measured distance to the nearest CIRCLE EDGE. It changed
  //    NOTHING (byte-identical output) because the holes are INSIDE the packing
  //    circles: a large bubble holding a sparse glyph is mostly empty, and no
  //    amount of circle geometry can see that. Only the ink can.
  //
  // So: rasterise what is actually drawn, distance-transform the ink, and put
  // icons on the deepest points. Done in ROUNDS (render once, close many) since
  // re-rendering per placement would be thousands of full redraws.
  const closeInkVoids = (rounds, limitTile) => {
    const G = 192, scale = TILE / G;
    for (let round = 0; round < rounds; round++) {
      const c = document.createElement('canvas');
      c.width = c.height = G;
      const g = c.getContext('2d');
      draw(g, placed, metrics, G);          // draw() already wraps 3x3
      const px = g.getImageData(0, 0, G, G).data;
      const dist = new Float32Array(G * G);
      for (let i = 0; i < G * G; i++) dist[i] = px[i * 4 + 3] > 28 ? 0 : 1e9;
      // Chamfer on a torus, forward then backward.
      const N8 = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,1],[-1,1],[1,-1]];
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k < G * G; k++) {
          const i = pass ? G * G - 1 - k : k;
          const x = i % G, y = (i / G) | 0;
          let m = dist[i];
          for (const [dx, dy] of N8) {
            const nx = ((x + dx) % G + G) % G, ny = ((y + dy) % G + G) % G;
            const v = dist[ny * G + nx] + (dx && dy ? 1.4142 : 1);
            if (v < m) m = v;
          }
          dist[i] = m;
        }
      }
      const order = [...dist.keys()].sort((p, q) => dist[q] - dist[p]);
      const chosen = [];
      for (const i of order) {
        const clear = dist[i] * scale;
        if (clear < limitTile) break;
        const x = (i % G + 0.5) * scale, y = (((i / G) | 0) + 0.5) * scale;
        // Do not stack two fills into one hole.
        if (chosen.some((p) => wrapDist(p.x, p.y, x, y) < p.clear + clear)) continue;
        chosen.push({ x, y, clear });
        if (chosen.length >= 80) break;
      }
      if (!chosen.length) return;

      for (const v of chosen) {
        // Farthest same-glyph, and prefer a DENSE glyph: the whole point is ink,
        // and dropping an airy one into a hole leaves the hole.
        let best = null, bestScore = -1;
        for (const gl of GLYPHS) {
          let nearest = Infinity;
          for (const q of byGlyph[gl]) {
            const d = wrapDist(v.x, v.y, q.x, q.y);
            if (d < nearest) nearest = d;
          }
          const sc = (nearest === Infinity ? 1e9 : nearest) * (0.4 + metrics[gl].fill * 1.6);
          if (sc > bestScore) { bestScore = sc; best = gl; }
        }
        if (!best) continue;
        // Fill most of the hole, not all of it: an icon exactly the size of the
        // gap touches everything around it and reads as a plug, not as pattern.
        const r = Math.min(v.clear * 0.92, 40);
        const fsFinal = r / metrics[best].r;
        if (fsFinal < 4) continue;
        const item = { x: v.x, y: v.y, r, fs: fsFinal, g: best,
                       rot: (rnd() - 0.5) * 1.7, twin: bestScore >= 1e9 ? null : bestScore };
        placed.push(item);
        grid[gi(item.x, item.y)].push(item);
        byGlyph[best].push(item);
        inkGrid[cellOf(item.x, item.y)] += Math.PI * r * r * metrics[best].fill;
      }
    }
  };

  // Close every ink hole wider than ~11 tile units (about 5px on a phone,
  // below what the eye reads as a gap). Six rounds converges; it stops early
  // when a round finds nothing left to close.
  closeInkVoids(6, 11);


  return placed;
}

// ── GLYPH ASSIGNMENT ────────────────────────────────────────────────
// ⚠ FARTHEST SAME-GLYPH, never random-with-fallback. The old version filtered
// out glyphs used nearby and picked randomly from the rest, but when the filter
// emptied it fell back to ANY glyph — which is exactly how identical icons
// ended up side by side. This instead scores every glyph by how far away its
// nearest twin is and takes the best, so the worst case is still the most
// separated option available rather than a coin flip.
function assign(placed) {
  const byGlyph = {};
  for (const g of GLYPHS) byGlyph[g] = [];
  // Largest first: the big icons are the ones the eye tracks across a repeat,
  // so they get first pick of the most isolated symbol.
  const order = [...placed].sort((a, b) => b.r - a.r);
  for (const p of order) {
    let best = null, bestScore = -1;
    for (const g of GLYPHS) {
      let nearest = Infinity;
      for (const q of byGlyph[g]) {
        const d = wrapDist(p.x, p.y, q.x, q.y);
        if (d < nearest) nearest = d;
      }
      // Prefer an unused glyph, then the one whose twin is farthest away.
      const score = nearest === Infinity ? 1e9 : nearest;
      if (score > bestScore) { bestScore = score; best = g; }
    }
    p.g = best;
    p.twin = bestScore >= 1e9 ? null : bestScore;
    byGlyph[best].push(p);
  }
  return placed;
}

function draw(ctx, placed, metrics, px) {
  const s = px / TILE;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.clearRect(0, 0, TILE, TILE);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const p of placed) {
    const m = metrics[p.g];
    // Scale so the glyph's measured ink circle exactly fills its bubble, and
    // shift so that circle's centre lands on the bubble's centre.
    const fs = p.fs;
    for (const ox of [-TILE, 0, TILE]) {
      for (const oy of [-TILE, 0, TILE]) {
        ctx.save();
        ctx.translate(p.x + ox, p.y + oy);
        ctx.rotate(p.rot || 0);
        if (DEBUG) {
          ctx.strokeStyle = 'rgba(255,0,90,.55)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(0, 0, p.r, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.fillStyle = '#000';
        const ic = PATHS[p.g];
        ctx.translate(-m.ox * fs, -m.oy * fs);
        ctx.scale(fs / ic.vb, fs / ic.vb);
        ctx.translate(-ic.vb / 2, -ic.vb / 2);
        ctx.fill(ic.p);
        ctx.restore();
      }
    }
  }
}

// ── MEASUREMENT ─────────────────────────────────────────────────────
function measureTile(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const d = ctx.getImageData(0, 0, w, h).data;
  let ink = 0;
  const N = 48, cells = new Float32Array(N * N), px = (w / N) * (h / N);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = d[(y * w + x) * 4 + 3] / 255;
      ink += a;
      cells[Math.min(N - 1, (y / (h / N)) | 0) * N + Math.min(N - 1, (x / (w / N)) | 0)] += a;
    }
  }
  for (let i = 0; i < cells.length; i++) cells[i] /= px;
  // Blurred, wrap-aware: the squint test for blank spots.
  const B = 2, blur = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let s = 0, n = 0;
    for (let dy = -B; dy <= B; dy++) for (let dx = -B; dx <= B; dx++) {
      s += cells[(((y+dy)%N+N)%N)*N + (((x+dx)%N+N)%N)]; n++;
    }
    blur[y*N+x] = s/n;
  }
  let min = Infinity, mean = 0;
  for (const v of blur) { if (v < min) min = v; mean += v; }
  mean /= blur.length;
  return { ink: ink / (w * h), thinnest: min, mean, ratio: min / mean };
}

async function main() {
  const metrics = measureGlyphs();
  const placed = pack(metrics);
  const c = document.getElementById('c');
  draw(c.getContext('2d'), placed, metrics, TILE * SCALE);

  const rs = placed.map((p) => p.r).sort((a, b) => a - b);
  const qq = (p) => rs[Math.floor(p * (rs.length - 1))];
  // The gap between two icons' INK, which is the thing that must never be <= 0.
  let minGap = Infinity;
  for (const a of placed) for (const b of placed) {
    if (a === b) continue;
    const g = wrapDist(a.x, a.y, b.x, b.y) - a.r - b.r;
    if (g < minGap) minGap = g;
  }
  const twins = placed.map((p) => p.twin).filter((t) => t != null).sort((a, b) => a - b);
  const m = measureTile(c);
  window.__result = {
    png: c.toDataURL('image/png'),
    count: placed.length,
    rMin: rs[0], rMed: qq(0.5), rMax: rs[rs.length - 1],
    spread: rs[rs.length - 1] / rs[0],
    minGap, closestTwin: twins[0] ?? null,
    ink: m.ink, ratio: m.ratio,
    glyphs: new Set(placed.map((p) => p.g)).size,
  };
}
main();
</script>`;

const PORT = 5195;
let current = [];
const srv = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  res.end(page(current, DEBUG));
});
await new Promise((r) => srv.listen(PORT, r));

const puppeteer = (await import('puppeteer-core')).default;
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
});
console.log('                shapes   ink    r min/med/max   spread  min ink gap  nearest twin  thin/avg');
console.log('  TELEGRAM      ~288     10.5%  2.5/7.5/102    40.8x   (they overlap)             --');
for (const [id, glyphs] of Object.entries(PATTERNS)) {
  current = glyphs;
  const p = await browser.newPage();
  await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0', timeout: 180000 });
  await p.waitForFunction('window.__result', { timeout: 120000 });
  const r = await p.evaluate(() => window.__result);
  await p.close();
  const raw = Buffer.from(r.png.split(',')[1], 'base64');
  // Palette-quantise: this is a MASK, only the alpha ramp matters, and 32
  // levels are indistinguishable once the gradient is behind it.
  const out = await sharp(raw).png({ palette: true, colours: 32, compressionLevel: 9 }).toBuffer();
  if (!DEBUG) writeFileSync(`${OUT}/${id}.png`, out);
  console.log(`  ${id.padEnd(12)}  ${String(r.count).padEnd(8)} ${(r.ink * 100).toFixed(1)}%  `
    + `${r.rMin.toFixed(1)}/${r.rMed.toFixed(1)}/${r.rMax.toFixed(1)}`.padEnd(15)
    + `${r.spread.toFixed(1)}x`.padEnd(8)
    + `${r.minGap.toFixed(2)}`.padEnd(13)
    + `${(r.closestTwin ?? 0).toFixed(0)}`.padEnd(14)
    + `${r.ratio.toFixed(3)}   ${(out.length / 1024).toFixed(0)}KB`);
}
await browser.close();
if (!process.argv.includes('--review')) srv.close();
else console.log(`\nreview page: http://localhost:${PORT}/`);
