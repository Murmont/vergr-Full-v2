// Builds SEAMLESS, TILEABLE alpha patterns for chat themes (effect 12) and
// MEASURES the placement, because "it looks fine" is how the last attempt at
// this shipped a grid.
//
//   node scripts/chat-pattern-tile.mjs            # build + measure + serve :5197
//   node scripts/chat-pattern-tile.mjs --shots    # also screenshot the study
//
// ⚠ IT DOES NOT TOUCH public/backgrounds/. The existing 7 wallpapers are a
// shipped feature and stay exactly as they are (founder, 2026-08-25).
//
// ── THE FOUR THINGS THE PREVIOUS ATTEMPT GOT WRONG ──────────────────
// Founder, 2026-08-25: "they were all in the same rows and columns which isn't
// the telegram design and you added too few and made them all the same size".
// Each one is now a structural property of the generator, not a hope:
//
//   1. ROWS AND COLUMNS. Positions come from a variable-radius Poisson-disc
//      sampler over continuous floats. There is no grid to fall back to and no
//      quantisation anywhere, so a lattice cannot form. Measured below as
//      per-cell coverage spread.
//   2. TOO FEW. Density is driven by a target INK COVERAGE and the sampler
//      runs until it can place no more, rather than stopping at a fixed count.
//   3. ALL THE SAME SIZE. Three explicit size tiers with weights, so there is a
//      hierarchy: a few large anchors, medium mass, small filler in the gaps.
//   4. VISIBLE REPETITION. Neighbouring glyphs may not be the same symbol, and
//      the tile is checked by rendering it 3x3.
//
// LICENCE: Material Symbols, Apache 2.0, already self-hosted here. Route 2 in
// docs/effects/12 (game-icons.net, CC BY 3.0) drops into the same generator by
// swapping the glyph source for SVG paths.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = `${repo}/scripts/.gradient-lab`;
mkdirSync(OUT, { recursive: true });

const GLYPHS = [
  'sports_esports', 'headphones', 'videogame_asset', 'keyboard', 'mouse',
  'stadia_controller', 'smart_display', 'live_tv', 'mic', 'photo_camera',
  'bolt', 'star', 'favorite', 'chat_bubble', 'emoji_events', 'diamond',
  'rocket_launch', 'sports_score', 'joystick', 'memory', 'sd_card', 'wifi',
  'volume_up', 'play_circle', 'skip_next', 'radio', 'casino', 'extension',
  'flare', 'auto_awesome', 'sports_martial_arts', 'swords', 'shield',
  'local_fire_department', 'visibility', 'bar_chart', 'timer', 'flag',
];

const TILE = 768, SCALE = 2;   // 768 not 512: a bigger tile means the LARGE icons recur
                               // far less often across a desktop-width thread, which is what
                               // made the repeat visible at 512.

const page = `<!doctype html><meta charset="utf-8"><title>Pattern placement study</title>
<style>
  @font-face{font-family:'MS';src:url('/font.woff2') format('woff2');font-display:block}
  body{margin:0;background:#0B0B14;color:#fff;font:13px/1.5 system-ui,sans-serif}
  h1{font-size:15px;margin:16px}
  h2{font-size:12px;color:#9CA3AF;margin:22px 16px 8px;text-transform:uppercase;letter-spacing:.08em}
  .wrap{padding:0 16px 20px;display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start}
  .lbl{color:#9CA3AF;margin-bottom:6px;font-size:12px}
  canvas{display:block;border-radius:8px}
  .onblack{background:#000}
  pre{margin:0 16px 20px;padding:12px 14px;background:#14141F;border-radius:10px;color:#C9CDD6;
      font:12px/1.6 ui-monospace,monospace;white-space:pre-wrap}
  .seam{position:relative}
  .seam .edge{position:absolute;pointer-events:none;inset:0;
      background:linear-gradient(90deg,transparent calc(33.333% - 1px),#F0406088 33.333%,transparent calc(33.333% + 1px)),
                 linear-gradient(90deg,transparent calc(66.666% - 1px),#F0406088 66.666%,transparent calc(66.666% + 1px)),
                 linear-gradient(0deg,transparent calc(33.333% - 1px),#F0406088 33.333%,transparent calc(33.333% + 1px)),
                 linear-gradient(0deg,transparent calc(66.666% - 1px),#F0406088 66.666%,transparent calc(66.666% + 1px))}
</style>
<h1>Pattern placement study &mdash; is it a grid, is it dense enough, are the sizes varied?</h1>
<div id="app"></div>
<script>
const GLYPHS = ${JSON.stringify(GLYPHS)};
const TILE = ${TILE}, SCALE = ${SCALE};

let seed = 20260825;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

// Wrapped distance: the tile is a torus, so an icon near the right edge is
// adjacent to one near the left. Without this the seam clumps.
function wrapDist(ax, ay, bx, by) {
  let dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  if (dx > TILE / 2) dx = TILE - dx;
  if (dy > TILE / 2) dy = TILE - dy;
  return Math.hypot(dx, dy);
}

// ── SIZE TIERS ──────────────────────────────────────────────────────
// Not one size, and not a flat random range either: an explicit hierarchy, so
// large icons anchor the field and small ones fill between them.
// ⚠ SIZES ARE A QUOTA, NOT A PROBABILITY, AND BIG ONES GO FIRST.
// First version drew a tier at random each throw with weights 13/34/53 and
// MEASURED 8 large / 22 medium / 169 small. A dart thrower rejects a big icon
// far more often than a small one, because it needs more free space, so a
// probabilistic mix silently collapses into "almost all small" — the founder's
// "you made them all the same size", arriving by a different route.
// Largest-first with an explicit target count is the standard fix: the large
// anchors claim their room while the tile is empty, and the small ones fill
// what is left.
//
// The FOURTH tier is a filler pass. With three tiers the measurement came back
// at 8.9% ink and a per-cell minimum of 3.4% against a 15.9% maximum: real bald
// patches, which is what makes a pattern look thin rather than designed. Tiny
// icons cost almost nothing in exclusion radius and go exactly where the gaps
// are, so they raise the floor without crowding the anchors.
const TIERS = [
  { name: 'large',  size: [52, 74], target: 16 },
  { name: 'medium', size: [32, 48], target: 60 },
  { name: 'small',  size: [18, 29], target: 260 },
  { name: 'tiny',   size: [10, 16], target: 300 },
];

// ── PLACEMENT ───────────────────────────────────────────────────────
// Variable-radius dart throwing over continuous floats. The exclusion radius
// scales with each icon's own size, so nothing overlaps and nothing snaps to a
// lattice.
function place() { return gapFill(placeRaw()); }

/** The quota pass on its own, so the gap-fill's effect can be measured. */
function placeRaw() {
  const placed = [];
  const GAP = 0.50;          // fraction of the two icons' combined radius
  for (const tier of TIERS) {
    let fails = 0, made = 0;
    while (made < tier.target && fails < 3000) {
      const size = tier.size[0] + rnd() * (tier.size[1] - tier.size[0]);
      const x = rnd() * TILE, y = rnd() * TILE;
      let ok = true;
      for (const p of placed) {
        if (wrapDist(x, y, p.x, p.y) < (size + p.size) * GAP) { ok = false; break; }
      }
      if (!ok) { fails++; continue; }
      fails = 0; made++;
      // No two neighbours share a symbol, which is what stops the field reading
      // as a loop. The radius scales with size so LARGE icons — the ones the eye
      // uses as landmarks across a repeat — are kept far from their own kind.
      const guard = size * 4.5;
      const near = placed.filter((p) => wrapDist(x, y, p.x, p.y) < guard).map((p) => p.g);
      const options = GLYPHS.filter((g) => !near.includes(g));
      const g = options[Math.floor(rnd() * options.length)] || GLYPHS[Math.floor(rnd() * GLYPHS.length)];
      placed.push({ x, y, size, g, tier: tier.name, rot: (rnd() - 0.5) * 0.62 });
    }
  }
  return placed;
}

// ── GAP FILL ────────────────────────────────────────────────────────
// ⚠ THE DEFECT THIS EXISTS TO FIX, founder 2026-08-25: "there are odd and
// noticeable blank spots that will look off ... on mobile it will be very
// noticeable." Correct, and the measurement agreed: per-cell coverage ran 9.1%
// to 20.9%, a 2.3x spread.
//
// The cause is that random dart throwing has NO IDEA WHERE THE GAPS ARE. It
// throws, and if it misses it throws again somewhere else, so holes survive
// however many darts are thrown. Raising the count just crowds the dense parts.
//
// So placement stops being random and becomes gap-driven: build a distance
// field over the tile, find the point FURTHEST from any existing icon, and put
// the next icon exactly there, sized to the hole. Repeat until the largest hole
// is under threshold. This is the same idea as Lloyd relaxation, done directly.
// ⚠ FIRST ATTEMPT AT THIS MEASURED THE WRONG THING, and it is worth recording
// because it "passed" while the defect was plainly visible. A distance field
// asks "how far is the nearest icon CENTRE", so a region packed with 12px
// specks scores as fully covered. It reported the largest hole at r=24 units,
// under the threshold, so the fill placed NOTHING while the founder could see
// blank areas on screen.
//
// What the eye actually does is SQUINT: it integrates ink over an area and
// notices where there is less of it. So the metric is a blurred ink map, and
// the fill is driven by the darkest patch of that map. A big icon and twenty
// specks now score differently, which is the whole point.
const INK = 192;     // ink raster resolution
const CELL = 48;     // coverage grid over the tile
const BLUR = 2;      // squint radius, in cells

/** Ink coverage per cell, wrap-aware, then blurred. This is the squint test. */
function coverageMap(placed) {
  const c = document.createElement('canvas');
  c.width = INK; c.height = INK;
  const ctx = c.getContext('2d');
  const s = INK / TILE;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
  for (const p of placed) {
    ctx.font = '400 ' + p.size + 'px MS';
    for (const ox of [-TILE, 0, TILE]) for (const oy of [-TILE, 0, TILE]) {
      ctx.save(); ctx.translate(p.x + ox, p.y + oy); ctx.rotate(p.rot);
      ctx.fillText(p.g, 0, 0); ctx.restore();
    }
  }
  const d = ctx.getImageData(0, 0, INK, INK).data;
  const per = INK / CELL;
  const raw = new Float32Array(CELL * CELL);
  for (let y = 0; y < INK; y++) {
    for (let x = 0; x < INK; x++) {
      raw[((y / per) | 0) * CELL + ((x / per) | 0)] += d[(y * INK + x) * 4 + 3] / 255;
    }
  }
  for (let i = 0; i < raw.length; i++) raw[i] /= per * per;
  // Wrap-aware box blur: the tile is a torus, so cells at the edge average with
  // the far side rather than with nothing.
  const out = new Float32Array(CELL * CELL);
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      let sum = 0, n = 0;
      for (let dy = -BLUR; dy <= BLUR; dy++) for (let dx = -BLUR; dx <= BLUR; dx++) {
        sum += raw[(((y + dy) % CELL + CELL) % CELL) * CELL + (((x + dx) % CELL + CELL) % CELL)];
        n++;
      }
      out[y * CELL + x] = sum / n;
    }
  }
  return out;
}

// NOTE: no backticks in comments below this point. This whole page is a JS
// template literal, so a backtick in a comment closes the string and the file
// dies with a syntax error a long way from the cause.
//
// skip holds cells already proven unfillable, so the fill loop advances to the
// next-thinnest patch instead of hammering one that is genuinely full.
function coverageStats(map, skip) {
  let min = Infinity, max = 0, sum = 0, mi = -1;
  for (let i = 0; i < map.length; i++) {
    sum += map[i];
    if (map[i] > max) max = map[i];
    if (skip && skip.has(i)) continue;
    if (map[i] < min) { min = map[i]; mi = i; }
  }
  if (mi < 0) return null;
  const mean = sum / map.length;
  const s = TILE / CELL;
  return { min, max, mean, ratio: min / mean, i: mi,
           x: ((mi % CELL) + 0.5) * s, y: (((mi / CELL) | 0) + 0.5) * s };
}

const FIELD = 128;   // distance-field resolution over the tile

function distanceField(placed) {
  // Seed with each icon's footprint, then a two-pass chamfer sweep that WRAPS,
  // because the tile is a torus and a hole at the edge is not a hole.
  const inf = 1e6;
  const d = new Float32Array(FIELD * FIELD).fill(inf);
  const s = FIELD / TILE;
  for (const p of placed) {
    const r = Math.max(1, p.size * 0.42 * s);
    const cx = p.x * s, cy = p.y * s;
    const r0 = Math.ceil(r) + 1;
    for (let oy = -r0; oy <= r0; oy++) {
      for (let ox = -r0; ox <= r0; ox++) {
        const gx = ((Math.round(cx) + ox) % FIELD + FIELD) % FIELD;
        const gy = ((Math.round(cy) + oy) % FIELD + FIELD) % FIELD;
        const dist = Math.max(0, Math.hypot(ox, oy) - r);
        const i = gy * FIELD + gx;
        if (dist < d[i]) d[i] = dist;
      }
    }
  }
  // Chamfer, four sweeps so it converges across the wrap.
  const at = (x, y) => d[(((y % FIELD) + FIELD) % FIELD) * FIELD + (((x % FIELD) + FIELD) % FIELD)];
  const put = (x, y, v) => { const i = (((y % FIELD) + FIELD) % FIELD) * FIELD + (((x % FIELD) + FIELD) % FIELD); if (v < d[i]) d[i] = v; };
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < FIELD; y++) for (let x = 0; x < FIELD; x++) {
      put(x, y, Math.min(at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414));
    }
    for (let y = FIELD - 1; y >= 0; y--) for (let x = FIELD - 1; x >= 0; x--) {
      put(x, y, Math.min(at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414));
    }
  }
  return d;
}

/** Radius of the largest empty circle, in tile units. This IS the metric for
 *  "noticeable blank spot" — it is the hole a person's eye finds. */

function largestHole(d) {
  let best = 0, bx = 0, by = 0;
  for (let i = 0; i < d.length; i++) {
    if (d[i] > best) { best = d[i]; bx = i % FIELD; by = (i / FIELD) | 0; }
  }
  const s = TILE / FIELD;
  return { r: best * s, x: bx * s, y: by * s };
}

function gapFill(placed) {
  // Repeatedly find the THINNEST patch by the squint test and put an icon
  // there, until the thinnest patch is within this fraction of the average.
  // 0.72 was chosen by rendering, not by taste: below about 0.65 the thin
  // areas are visible on a phone, and pushing above ~0.8 starts flattening the
  // field into uniform noise and loses the size hierarchy.
  // ⚠ 0.72 WAS TOO GREEDY AND IT SHOWED. Chasing it drove coverage to 26.1%
  // and a nearest-neighbour minimum of 1.2 units: icons landing on top of each
  // other and merging into unreadable blobs. Telegram's patterns are dense but
  // the shapes never collide. The fill now obeys the SAME overlap rule as the
  // main pass, and the target is the level reachable without collisions.
  const TARGET_RATIO = 0.66;
  // ⚠ TIGHTER THAN THE MAIN PASS ON PURPOSE. The exclusion test treats a glyph
  // as a solid disc of its full em box, but an outline icon is mostly empty
  // space, so 0.50 refuses placements that would not actually collide. At 0.50
  // the fill could seat only 47 icons and the ratio moved 0.468 -> 0.507.
  // 0.34 lets outline shapes nest the way they do in a real drawn pattern,
  // while still keeping the ink apart (verified by the nearest-neighbour floor
  // and by looking).
  const GAP = 0.34;
  const MAX_FILL = 400;
  const exhausted = new Set();
  let added = 0;
  for (let n = 0; n < MAX_FILL; n++) {
    const st = coverageStats(coverageMap(placed), exhausted);
    if (!st || st.ratio >= TARGET_RATIO) break;
    const deficit = 1 - st.ratio;
    const jitter = TILE / CELL;
    let put = null;
    // Try candidates inside the thin cell, largest first, shrinking on failure.
    // A patch that cannot take even the smallest icon is genuinely full, so it
    // is retired rather than retried forever.
    outer:
    for (const size of [Math.min(46, 16 + deficit * 80), 30, 22, 16, 12]) {
      for (let k = 0; k < 24; k++) {
        const x = (st.x + (rnd() - 0.5) * jitter * 1.8 + TILE) % TILE;
        const y = (st.y + (rnd() - 0.5) * jitter * 1.8 + TILE) % TILE;
        let ok = true;
        for (const p of placed) {
          if (wrapDist(x, y, p.x, p.y) < (size + p.size) * GAP) { ok = false; break; }
        }
        if (ok) { put = { x, y, size }; break outer; }
      }
    }
    if (!put) { exhausted.add(st.i); continue; }
    const near = placed.filter((p) => wrapDist(put.x, put.y, p.x, p.y) < put.size * 4.5).map((p) => p.g);
    const options = GLYPHS.filter((g) => !near.includes(g));
    const g = options[Math.floor(rnd() * options.length)] || GLYPHS[Math.floor(rnd() * GLYPHS.length)];
    placed.push({ ...put, g, tier: 'fill', rot: (rnd() - 0.5) * 0.62 });
    added++;
  }
  window.__filled = added;
  return placed;
}

function drawTile(canvas, placed, px) {
  const ctx = canvas.getContext('2d');
  const s = px / TILE;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.clearRect(0, 0, TILE, TILE);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  for (const p of placed) {
    ctx.font = '400 ' + p.size + 'px MS';
    // Nine draws: the position plus all eight wrapped offsets, so anything
    // crossing an edge reappears opposite and the tile butts against itself.
    for (const ox of [-TILE, 0, TILE]) {
      for (const oy of [-TILE, 0, TILE]) {
        ctx.save();
        ctx.translate(p.x + ox, p.y + oy);
        ctx.rotate(p.rot);
        ctx.fillText(p.g, 0, 0);
        ctx.restore();
      }
    }
  }
}

// ── MEASUREMENT ─────────────────────────────────────────────────────
// Ink coverage overall, and per cell of an 8x8 split. The per-cell spread is
// the evenness test: a clumpy field has a wide spread, a bald patch shows as a
// near-zero cell, and a GRID shows as an almost identical value everywhere.
function measure(canvas, N = 8) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const d = ctx.getImageData(0, 0, w, h).data;
  let ink = 0;
  const cells = new Array(N * N).fill(0), cellPx = new Array(N * N).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = d[(y * w + x) * 4 + 3] / 255;
      ink += a;
      const ci = Math.floor(y / (h / N)) * N + Math.floor(x / (w / N));
      cells[ci] += a; cellPx[ci]++;
    }
  }
  const per = cells.map((v, i) => v / cellPx[i]);
  const mean = per.reduce((a, b) => a + b, 0) / per.length;
  const sd = Math.sqrt(per.reduce((a, b) => a + (b - mean) ** 2, 0) / per.length);
  return { coverage: ink / (w * h), cellMean: mean, cellSd: sd, cellMin: Math.min(...per), cellMax: Math.max(...per) };
}

function nnStats(placed) {
  const ds = placed.map((p) => {
    let best = Infinity;
    for (const q of placed) if (q !== p) best = Math.min(best, wrapDist(p.x, p.y, q.x, q.y));
    return best;
  });
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  const sd = Math.sqrt(ds.reduce((a, b) => a + (b - mean) ** 2, 0) / ds.length);
  return { mean, sd, cv: sd / mean, min: Math.min(...ds), max: Math.max(...ds) };
}

async function main() {
  await document.fonts.load('400 100px MS');
  await document.fonts.ready;
  const app = document.getElementById('app');
  // Measure BEFORE the gap-fill so the fix is provable, not asserted.
  const rawSeed = seed;
  const before = placeRaw();
  const stBefore = coverageStats(coverageMap(before));
  seed = rawSeed;
  const placed = place();
  const stAfter = coverageStats(coverageMap(placed));

  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

  // 1. the tile alone
  app.appendChild(el('<h2>1. The tile itself, 512px, black shapes on transparent (Telegram\\'s pattern format)</h2>'));
  const w1 = el('<div class="wrap"></div>'); app.appendChild(w1);
  const c1 = document.createElement('canvas'); c1.width = TILE * SCALE; c1.height = TILE * SCALE;
  c1.style.width = '512px'; c1.style.height = '512px'; c1.className = 'onblack';
  // shown on a light ground so the black shapes read
  c1.style.background = '#5a5a66';
  drawTile(c1, placed, TILE * SCALE);
  const d1 = el('<div><div class="lbl">1:1</div></div>'); d1.appendChild(c1); w1.appendChild(d1);

  // 2. 3x3 repeat with seam guides
  app.appendChild(el('<h2>2. Repeated 3&times;3. The red lines are the seams &mdash; nothing should line up on them</h2>'));
  const w2 = el('<div class="wrap"></div>'); app.appendChild(w2);
  const rep = document.createElement('canvas'); rep.width = TILE * 3; rep.height = TILE * 3;
  rep.style.width = '600px'; rep.style.height = '600px'; rep.style.background = '#5a5a66';
  {
    const t = document.createElement('canvas'); t.width = TILE; t.height = TILE;
    drawTile(t, placed, TILE);
    const rc = rep.getContext('2d');
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) rc.drawImage(t, i * TILE, j * TILE);
  }
  const d2 = el('<div class="seam"><div class="lbl">3&times;3</div></div>');
  d2.appendChild(rep);
  const edge = document.createElement('div'); edge.className = 'edge';
  edge.style.top = '21px'; edge.style.height = '600px'; edge.style.width = '600px';
  d2.appendChild(edge);
  w2.appendChild(d2);

  // 3. numbers
  const m = measure(c1), nn = nnStats(placed);
  const tierCount = {};
  for (const p of placed) tierCount[p.tier] = (tierCount[p.tier] || 0) + 1;
  app.appendChild(el('<h2>3. Measured</h2>'));
  app.appendChild(el('<pre>' + [
    'icons placed          ' + placed.length + '   (first attempt: 78)  '
       + window.__filled + ' of them placed by the gap-fill',
    '',
    'THE BLANK-SPOT TEST   thinnest patch as a fraction of the average, measured',
    '                      on a blurred ink map (the "squint" test)',
    '   before gap-fill    ' + stBefore.ratio.toFixed(3) + '   (thinnest ' + (stBefore.min * 100).toFixed(1)
       + '%  average ' + (stBefore.mean * 100).toFixed(1) + '%)',
    '   after  gap-fill    ' + stAfter.ratio.toFixed(3) + '   (thinnest ' + (stAfter.min * 100).toFixed(1)
       + '%  average ' + (stAfter.mean * 100).toFixed(1) + '%)   target >= 0.720',
    '                      -> 1.000 would be perfectly uniform. A visible blank',
    '                         spot is a patch far below the average.',
    'size tiers            ' + Object.entries(tierCount).map(([k, v]) => k + ' ' + v).join(' / ')
       + '   sizes ' + Math.round(Math.min(...placed.map(p => p.size))) + '-' + Math.round(Math.max(...placed.map(p => p.size))) + 'px',
    'distinct symbols      ' + new Set(placed.map(p => p.g)).size + ' of ' + GLYPHS.length,
    '',
    'ink coverage          ' + (m.coverage * 100).toFixed(1) + '%',
    'per-cell coverage     mean ' + (m.cellMean * 100).toFixed(1) + '%  sd ' + (m.cellSd * 100).toFixed(2)
       + '  min ' + (m.cellMin * 100).toFixed(1) + '%  max ' + (m.cellMax * 100).toFixed(1) + '%',
    '                      -> low sd = even. A bald patch shows as a low min,',
    '                         a clump as a high max, a GRID as sd near zero',
    '                         with an identical value in every cell.',
    '',
    'nearest neighbour     mean ' + nn.mean.toFixed(1) + 'px  sd ' + nn.sd.toFixed(1)
       + '  cv ' + nn.cv.toFixed(2) + '  min ' + nn.min.toFixed(1) + '  max ' + nn.max.toFixed(1),
    '                      -> a square grid would give cv ~0.00 and min=max.',
    '                         Positions here are continuous floats from a',
    '                         variable-radius dart thrower, never snapped.',
  ].join('\\n') + '</pre>'));
  window.__placed = placed.length;
  window.__ready = true;
}
main();
</script>`;

const PORT = Number(process.env.PORT || 5197);
const srv = createServer((req, res) => {
  if (req.url.startsWith('/font.woff2')) {
    res.writeHead(200, { 'content-type': 'font/woff2' });
    res.end(readFileSync(`${repo}/public/fonts/material-symbols-outlined.woff2`));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  res.end(page);
});
await new Promise((r) => srv.listen(PORT, r));
console.log(`chat-pattern-tile: http://localhost:${PORT}/`);

if (process.argv.includes('--shots')) {
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
  });
  const p = await browser.newPage();
  await p.setViewport({ width: 1340, height: 1700, deviceScaleFactor: 2 });
  await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await p.waitForFunction('window.__ready', { timeout: 30000 });
  await p.screenshot({ path: `${repo}/scripts/.pattern-study.png`, fullPage: true });
  // Export the tile for the gradient lab to mask with.
  const dataUrl = await p.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
  writeFileSync(`${OUT}/tile_gaming.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('study  -> scripts/.pattern-study.png');
  console.log('tile   -> scripts/.gradient-lab/tile_gaming.png');
  await browser.close();
  srv.close();
}
