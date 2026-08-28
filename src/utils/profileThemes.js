// Profile theme backgrounds.
//
// ONE definition, used by both the swatch on /prestige and the real banner on
// the profile, so a preview can never drift from the thing it previews.
//
// ── TWO PASSES OF MISTAKES, RECORDED SO THEY ARE NOT REPEATED ──
//
// Pass 1 was seven flat two-stop linear gradients, two of them ("grain",
// "carved") named after treatments in src/styles/surface.css that they did not
// actually use. Lazy, and it looked it.
//
// Pass 2 added `background-blend-mode` to composite an feTurbulence layer.
// Rendered headless at the real 220px banner size, `grain` and `nebula` came
// out as FLAT GREY: a mid-grey noise layer blended `overlay`/`soft-light` over
// dark colour layers crushes them to nothing. The blend modes are gone. Noise
// now carries its alpha INSIDE the SVG and composites normally, so every colour
// layer under it survives.
//
// RULE: never ship one of these without rendering it. `background-blend-mode`
// on a dark stack does not do what it looks like it does in the source.
//
// Design rules from CLAUDE.md that these follow:
//   - Light has a DIRECTION. A flat fill reads as paint, not material.
//   - Grain is the biggest cheap-to-designed lever on a dark UI, but it is
//     tooth at low alpha, never grey haze.
//   - A recess fades to zero BEFORE it reaches an edge, or you see the boundary
//     instead of the depth.

/**
 * feTurbulence tooth. Alpha is baked into the SVG so this composites as a
 * normal layer: no blend mode, nothing underneath gets crushed.
 * @param {number} a opacity of the noise rect, 0-1
 */
const noise = (a) =>
  "url('data:image/svg+xml," +
  "%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22140%22 height=%22140%22%3E" +
  "%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 " +
  "numOctaves=%224%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E" +
  "%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22 opacity=%22" + a +
  "%22/%3E%3C/svg%3E')";

export const PROFILE_THEME_CSS = {
  // Baseline. Deliberately quiet so an unequipped profile is not competing with
  // the equipped ones.
  default: {
    background:
      'radial-gradient(120% 160% at 18% 0%, rgba(123,31,255,0.18), transparent 62%),' +
      'radial-gradient(90% 120% at 88% 12%, rgba(61,127,255,0.12), transparent 58%),' +
      'linear-gradient(160deg,#14141F 0%,#0D0D16 100%)',
  },

  // L6. First equippable, so it has to read as "cleaner" rather than "more".
  // Cold rim light down the left edge plus a cyan kicker on the right, which is
  // what stops it being an indistinguishable dark rectangle.
  deep: {
    background:
      'radial-gradient(85% 130% at -5% 0%, rgba(150,180,255,0.30), transparent 55%),' +
      'radial-gradient(55% 90% at 104% 88%, rgba(77,200,255,0.16), transparent 60%),' +
      'linear-gradient(178deg, rgba(255,255,255,0.05) 0%, transparent 40%),' +
      'linear-gradient(150deg,#0C0D18 0%,#05060C 58%,#0E1120 100%)',
  },

  // L16. Real tooth on a DARK warm plate. Pass 3: the previous values put the
  // base at #1F1C1A with a 0.10 warm key and it came out a muddy olive card,
  // several stops lighter than every other theme and off-brand with it. The
  // tooth is the reward here, not the brightness, so the plate went down to
  // near-black and the key down to a rim.
  grain: {
    // ⚠ feTurbulence averages MID-GREY, so a noise layer at alpha A does not
    // just add tooth, it LIFTS the whole plate by roughly 128*A. At 0.16 that
    // was +20 levels across the banner, which is why pass 3 still came out as a
    // brown card several stops brighter than every other theme.
    //
    // Two changes: alpha down to 0.07 (tooth, not a veil) and the plate taken
    // to near-black so the residual lift lands where the other themes live. The
    // warm tint is now a rim rather than a wash, or the lift turns it olive.
    background:
      noise(0.07) + ',' +
      'radial-gradient(80% 130% at 0% 0%, rgba(255,225,185,0.05), transparent 55%),' +
      'radial-gradient(50% 85% at 100% 100%, rgba(255,150,80,0.04), transparent 60%),' +
      'linear-gradient(155deg,#0C0B0A 0%,#060505 55%,#0E0C0A 100%)',
    backgroundSize: '140px 140px, auto, auto, auto',
  },

  // L27. A shaft of light crossing the plate. Three passes at slightly
  // different angles and widths, with a hot core, so it reads as light through
  // something rather than a printed stripe.
  beam: {
    background:
      'linear-gradient(101deg, transparent 30%, rgba(232,205,255,0.30) 43%, transparent 52%),' +
      'linear-gradient(104deg, transparent 24%, rgba(180,79,255,0.42) 41%, rgba(180,79,255,0.10) 52%, transparent 62%),' +
      'linear-gradient(96deg, transparent 44%, rgba(123,31,255,0.26) 56%, transparent 70%),' +
      'radial-gradient(90% 140% at 26% -10%, rgba(123,31,255,0.28), transparent 62%),' +
      'linear-gradient(160deg,#120B24 0%,#07050E 60%,#170F2B 100%)',
  },

  // L38. A machined CHANNEL running across the plate, which is what "carved"
  // has to mean to read at all. Two earlier passes drew broad soft bands and
  // both came out as grey haze, because a wall that fades over a third of the
  // banner is not a wall, it is a fog.
  //
  // The channel is narrow (46% to 62% of the height) and each wall is 3-4% tall:
  // shadow on the UPPER wall, light on the LOWER lip, which is the direction
  // that reads as cut INTO the surface with the key light up and left. Swap the
  // two and it pops out as a ridge instead.
  carved: {
    background:
      'linear-gradient(180deg, transparent 44%, rgba(0,0,0,0.85) 48%, rgba(0,0,0,0.35) 53%, transparent 58%),' +
      'linear-gradient(180deg, transparent 58%, rgba(255,255,255,0.14) 62%, rgba(255,255,255,0.03) 66%, transparent 70%),' +
      'linear-gradient(180deg, transparent 46%, rgba(0,0,0,0.5) 54%, transparent 62%),' +
      'radial-gradient(120% 90% at 8% 0%, rgba(200,190,255,0.075), transparent 60%),' +
      noise(0.06) + ',' +
      'linear-gradient(160deg,#171722 0%,#0D0D14 52%,#1A1A26 100%)',
    backgroundSize: 'auto, auto, auto, auto, 140px 140px, auto',
  },

  // L52. Curtains, not a three-stop ramp. Overlapping ellipses at different
  // angles and heights, with the ground darkened so the light reads as hanging
  // above a horizon.
  aurora: {
    background:
      'radial-gradient(70% 48% at 14% 2%, rgba(77,255,212,0.34), transparent 60%),' +
      'radial-gradient(58% 70% at 40% -8%, rgba(61,150,255,0.36), transparent 58%),' +
      'radial-gradient(62% 55% at 72% 8%, rgba(180,79,255,0.34), transparent 60%),' +
      'radial-gradient(48% 40% at 92% 30%, rgba(255,122,184,0.20), transparent 62%),' +
      'linear-gradient(180deg, transparent 40%, rgba(4,7,16,0.92) 92%),' +
      'linear-gradient(170deg,#08131C 0%,#050810 55%,#0C0718 100%)',
  },

  // L66. A corona, which means a thin bright RING around an occluded body.
  // Pass 2 drew a filled orange ellipse and it looked like a lens flare. The
  // bright band is now narrow (60% to 66% of the radius) with the body pure
  // black inside it, and the whole thing sits slightly high and left of centre
  // so it reads as occlusion rather than a glow.
  eclipse: {
    background:
      'radial-gradient(circle 132px at 44% 42%, transparent 58%, rgba(255,190,90,0.85) 61%, rgba(255,120,40,0.55) 66%, rgba(255,80,30,0.14) 76%, transparent 88%),' +
      'radial-gradient(circle 132px at 44% 42%, #000000 0%, #000000 59%, transparent 60%),' +
      'radial-gradient(circle 340px at 44% 42%, rgba(255,120,50,0.14), transparent 70%),' +
      'linear-gradient(170deg,#12040A 0%,#050004 55%,#1A0510 100%)',
  },

  // L84. Top of the ladder, so it is allowed to be loud, but pass 3 pulled it
  // back hard: the previous values ran four clouds at 0.42-0.62 alpha with no
  // dark between them and the result was a milky lilac smear. Clouds are now
  // tighter and separated by real black, which is what makes a nebula read as
  // depth rather than fog.
  nebula: {
    background:
      noise(0.14) + ',' +
      'radial-gradient(34% 48% at 18% 22%, rgba(190,90,255,0.55), transparent 66%),' +
      'radial-gradient(26% 38% at 68% 6%, rgba(220,150,255,0.34), transparent 64%),' +
      'radial-gradient(40% 56% at 60% 104%, rgba(61,127,255,0.38), transparent 66%),' +
      'radial-gradient(11% 16% at 30% 40%, rgba(255,245,255,0.42), transparent 72%),' +
      'radial-gradient(20% 28% at 88% 66%, rgba(255,110,180,0.22), transparent 68%),' +
      'radial-gradient(130% 130% at 46% 46%, transparent 34%, rgba(3,1,8,0.72) 82%),' +
      'linear-gradient(165deg,#0D0418 0%,#040209 55%,#12052270 100%)',
    backgroundSize: '140px 140px, auto, auto, auto, auto, auto, auto, auto',
  },
};

/**
 * Inline style object for a theme id. Returns null for an unknown id so the
 * caller falls back to whatever it drew before, rather than painting nothing.
 */
export const themeStyle = (id) => PROFILE_THEME_CSS[id] || null;

// ═══════════════════════════════════════════════════════════════════
// THEME TOKENS (the real system, superseding the background strings above)
// ═══════════════════════════════════════════════════════════════════
//
// A theme is a LIGHT SOURCE, not a picture. It sets custom properties once on
// the profile root and every surface below reads them, so 8 themes x 12 accents
// is 96 real combinations from one contract instead of 96 drawn backgrounds.
//
// ── THE UPLOADED-BANNER PROBLEM, AND THE ANSWER ──
//
// Most accounts upload a banner. A theme that only paints the banner area
// therefore does nothing for them, and a theme that tints the banner is worse:
// it discolours art the user chose. Both are wrong.
//
// So the theme NEVER touches the banner image. It lights the SEAM instead:
//   - `seam`  a scrim from transparent into the field colour, over the bottom
//             of the art, so the banner dissolves into the page rather than
//             ending as a rectangle stuck on it.
//   - `seamLine` a 1px accent line at that edge, fading at both ends (same rule
//             as a divider), which ties the accent to the banner without
//             recolouring one pixel of it.
// Everything below the banner (identity, rail, tabs, cards, links) is where the
// accent actually lives, which is also where the eye lands.

/**
 * Custom properties for a theme + the user's accent.
 * @param {string} themeId  id from PROFILE_THEME_CSS
 * @param {string} accent   hex, the user's equipped accent
 */
/**
 * Collections whose surface is LIGHT. On these the accent must become INK:
 * a raw accent on pale stock measures about 2.4:1, which is unreadable, and
 * because most of the profile sets colour INLINE the only way to fix all of
 * them at once is at the token they read.
 */
const LIGHT_COLLECTIONS = new Set();   // no light themes: reverted 2026-08-24

/** Darken toward black until it measures  contrast against .
 * Returns HEX, because every other helper here parses hex and an rgb() string
 * silently becomes NaN. That exact mismatch already cost one debugging round. */
const inkFor = (hex, onHex, target = 4.5) => {
  const rgb = (h) => { const n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const bg = rgb(onHex);
  let c = rgb(hex);
  for (let i = 0; i < 40; i++) {
    const [l1, l2] = [lum(c), lum(bg)].sort((x, y) => y - x);
    if ((l1 + 0.05) / (l2 + 0.05) >= target) break;
    c = c.map((v) => v * 0.95);
  }
  return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
};

export const themeTokens = (themeId, accent) => {
  const raw = accent || '#B44FFF';
  // On a light collection the accent IS ink, so every inline colour that reads
  // this token becomes readable in one move.
  const a = LIGHT_COLLECTIONS.has(themeId) ? inkFor(raw, '#DCCEB2') : raw;
  const base = {
    '--vg-accent': a,
    '--vg-accent-bloom': hexA(a, 0.13),
    '--vg-accent-wash': hexA(a, 0.24),
    '--vg-accent-chip': hexA(a, 0.14),
    '--vg-accent-dim': hexA(a, 0.30),
    '--vg-accent-dark': mixBlack(a, 0.45),
    '--vg-accent-faint': hexA(a, 0.10),
  };
  return { ...base, ...THEME_TOKENS.default };
};

/** #RRGGBB + alpha -> rgba(). Accepts the 12 accent hexes only, so no parsing edge cases. */
function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
/** Darken toward black by `amount`, for the low end of the VP bar gradient. */
function mixBlack(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = 1 - amount;
  return `rgb(${Math.round(((n >> 16) & 255) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
}

export const THEME_TOKENS = {
  // ⚠ ONE shared surface set for EVERY theme, deliberately.
  //
  // This used to hold a per-theme entry, but only "default" and "deep" were
  // ever written, so six of the eight themes silently fell back to "default"
  // and painted IDENTICALLY to Standard on the owner's own profile. The swatch
  // on /prestige previewed a gradient the profile then never drew, which is
  // exactly the "I can't see any change between Deep and Grain" report.
  //
  // A theme is now ONE thing: the gradient in PROFILE_THEME_CSS, drawn on the
  // header. Surfaces (cards, rims, seams) stay constant so nothing else on the
  // page can drift, and the accent is the user's other lever. It cannot
  // half-apply, because there is no longer a second place for it to apply.
  default: {
    '--vg-field': '#000000',
    '--vg-key': 'rgba(150,180,255,0.12)',
    '--vg-pool': 'rgba(30,22,66,0.34)',
    '--vg-rim': 'rgba(255,255,255,0.14)',
    '--vg-card': 'linear-gradient(180deg,rgba(255,255,255,0.040),rgba(255,255,255,0.010))',
    '--vg-seam': '#000000',
    '--vg-grain': '0.04',
  },
};


/**
 * The page field. Four layers: grain, key light anchored ABOVE the viewport so
 * the falloff is real, the accent bloom, a depth pool at the bottom, the base.
 *
 * `backgroundAttachment` is deliberately SCROLL. `fixed` was what made the
 * first version read as wallpaper: content sliding over a static image.
 */
/**
 * The PAGE is pure black. Nothing else.
 *
 * ⚠ THIS IS THE CORRECTION. The previous version put a key light
 * (rgba(150,180,255,0.20) across 140%x72%) and a depth pool (0.42) over the
 * whole page. Both are pale washes, and a pale wash over black IS grey: the
 * base computed as rgb(0,0,0) while the painted result was visibly grey, which
 * is exactly what the founder was looking at. Measuring the base colour and
 * declaring it black was answering the wrong question.
 *
 * A theme's light now belongs to the HEADER, where there is something to light
 * (banner, avatar, identity, rail). Below that there is only content, so there
 * is nothing to light and the correct value is black.
 */
export const fieldStyle = () => ({ background: '#000000' });

/**
 * The header's surface: the equipped theme's gradient, drawn on the 220px
 * banner block. That block is the only part of a profile with something to
 * light, and it is where the swatch on /prestige promises the change will be.
 *
 * Unknown or unequipped ids fall back to "default" rather than returning null,
 * so a themed profile can never render an unpainted header.
 */
export const headerLightStyle = (themeId) =>
  PROFILE_THEME_CSS[themeId] || PROFILE_THEME_CSS.default;

// ═══════════════════════════════════════════════════════════════════
// THE SEAM GLOW — the part of a theme that is ALWAYS visible
// ═══════════════════════════════════════════════════════════════════
//
// ⚠ MEASURED ON THE LIVE PAGE, 2026-08-24. The header block and the uploaded
// banner <img> occupy the IDENTICAL rect (x241 y0 1049x220) and the image is
// object-fit:cover at opacity 1. So a theme drawn on the header paints exactly
// ZERO visible pixels for any account with a banner, which is every account
// that has bothered to set one. Putting the gradient on the header was moving
// the "it does nothing" bug one layer down, not fixing it.
//
// ⚠ AND THE LIGHT POINTED THE WRONG WAY. Every gradient above anchors its key
// at the TOP (`at 18% 0%`, `at -5% 0%`, `at 0% 0%`, `at 26% -10%`) and dies at
// the bottom. The top is precisely the occluded part. The one edge a banner
// never covers is the BOTTOM, so the light has to rise from the seam and fall
// DOWNWARD through the identity block.
//
// Hence: each theme carries a signature glow, drawn as a band directly below
// the banner, top-anchored so it emanates from the seam. It never touches the
// user's art, and it is visible whether or not a banner exists.

/** Signature light per theme, taken from that theme's own palette. */
const THEME_GLOW = {
  default: ['rgba(123,31,255,0.20)', 'rgba(61,127,255,0.10)'],
  deep:    ['rgba(150,180,255,0.22)', 'rgba(77,200,255,0.12)'],
  grain:   ['rgba(255,190,120,0.16)', 'rgba(255,150,80,0.08)'],
  beam:    ['rgba(180,79,255,0.34)',  'rgba(232,205,255,0.14)'],
  carved:  ['rgba(200,190,255,0.16)', 'rgba(255,255,255,0.06)'],
  aurora:  ['rgba(77,255,212,0.26)',  'rgba(180,79,255,0.20)'],
  eclipse: ['rgba(255,140,50,0.26)',  'rgba(255,80,30,0.10)'],
  nebula:  ['rgba(190,90,255,0.30)',  'rgba(61,127,255,0.20)'],
};

/**
 * The band under the banner. Two ellipses anchored at y=0 (the seam) falling to
 * nothing well before the bottom edge, so the glow FADES OUT rather than ending
 * at a boundary the eye can find.
 */
export const themeSeamStyle = (themeId) => {
  const [a, b] = THEME_GLOW[themeId] || THEME_GLOW.default;
  return {
    background:
      `radial-gradient(120% 100% at 28% 0%, ${a}, transparent 62%),` +
      `radial-gradient(90% 85% at 78% 0%, ${b}, transparent 60%)`,
  };
};
