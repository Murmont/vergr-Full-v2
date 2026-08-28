// Squad environments. Effect 11. Doc: docs/effects/11-squad-environments.md
//
// ⚠ AN ENVIRONMENT IS NOT A BACKGROUND IMAGE. Founder, 2026-08-26: "the
// enviraments are more than just fucking backgrounds claude." Correct, and the
// doc already said so — §3.3 describes an atmosphere layer, which is the half
// that makes a squad's chat a PLACE rather than a wallpaper.
//
// Three composed layers, none of which is a supplied asset:
//
//   backdrop    a multi-stop scene: sky, horizon, ground glow
//   atmosphere  a capped canvas particle system (tier 2 only)
//   light       a colour cast so the bubbles sit IN the room
//
// ⚠ ZERO ART, ZERO BYTES, ZERO HOSTING. Nothing here is fetched. The precedent
// is scripts/build-chat-patterns.mjs, which generated all eight chat tiles
// procedurally rather than waiting on art.
//
// ⚠ THE SEVEN WALLPAPERS IN public/backgrounds/static ARE UNTOUCHED AND MUST
// STAY THAT WAY. They are a separate shipped feature. This is additive.

/**
 * ⚠ MOTION MODELS ARE STRUCTURALLY DIFFERENT, NOT RE-PARAMETERISED.
 *
 * The chat-pattern motions were rejected for exactly this failure: five
 * "different" models that were all ellipses, because their frequency ratios sat
 * near 1:1. Re-tuning numbers does not produce a different motion.
 *
 * These six differ in their EQUATIONS, not their constants:
 *
 *   drift   brownian walk, no gravity term at all
 *   rise    NEGATIVE gravity, decelerating, opacity flicker
 *   fall    positive gravity + a sinusoidal horizontal term
 *   streak  near-vertical, high velocity, strictly linear, drawn as a LINE
 *   bloom   slow rise with a wide low-frequency drift, scale grows with age
 *   twinkle NO TRANSLATION AT ALL — opacity only
 *
 * `twinkle` is the control. If it ever looks like the others, the others are
 * not doing what this comment claims.
 */
export const MOTION = {
  DRIFT: 'drift',
  RISE: 'rise',
  FALL: 'fall',
  STREAK: 'streak',
  BLOOM: 'bloom',
  TWINKLE: 'twinkle',
};

/**
 * ⚠ RESEARCHED 2026-08-26, AND THE RESEARCH CHANGED THE DESIGN. The first pass
 * was written from imagination and had all six failures below. Sources:
 *   https://css-tricks.com/grainy-gradients/
 *   https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation
 *   https://godotshaders.com/shader/rain-and-snow-with-parallax-scrolling-effect/
 *   https://thecodeplayer.com/walkthrough/html5-canvas-experiment-a-cool-flame-fire-effect-using-particles
 *
 * 1. DEPTH IS THE WHOLE TECHNIQUE. Every serious rain/snow implementation runs
 *    particles at multiple DEPTHS: distant ones smaller, slower and dimmer,
 *    near ones larger, faster and brighter. A field where every particle shares
 *    one speed range is the thing that reads as a screensaver. Each particle
 *    now carries `z`, and size, speed, alpha and streak length all derive from
 *    it. This was the single biggest miss.
 * 2. LIGHT-EMITTING PARTICLES NEED ADDITIVE BLENDING, and it is PER
 *    ENVIRONMENT, not global. Embers and stars EMIT, so overlaps must SUM
 *    (`lighter`). Rain and snow OCCLUDE, so they must not — additive rain
 *    glows, which is wrong.
 * 3. A LARGE DARK GRADIENT BANDS on 8-bit displays, and grain is the fix.
 *    Folded into the backdrop's own background stack, because `.vg-grain` is a
 *    `::before { inset: 0 }` and this paints on a SCROLLER, where that would
 *    scroll away.
 * 4. RAIN IS ANGLED LINES WHOSE LENGTH VARIES WITH DEPTH. A fast dot reads as
 *    a rendering glitch.
 *
 * ⚠ `ink` IS THE MEASURED FLOOR, NOT A GUESS. It is the darkest the scene gets
 * behind message text, and SquadEnvironment computes the scrim from it so the
 * 4.5:1 contrast floor holds by construction rather than by eye. Doc 12 learned
 * this the expensive way: a palette that looks fine can still ship an
 * unreadable bubble, so the floor is enforced in code.
 */
export const ENVIRONMENTS = [
  {
    id: 'nightfall',
    blend: 'lighter',
    name: 'Nightfall',
    blurb: 'Late blue dusk, with dust in the air.',
    sky: ['#0A1030', '#131A44', '#0B0E22'],
    horizon: '#2B3A7A',
    glow: '#4A5BC4',
    light: 'rgba(74,91,196,0.14)',
    ink: '#080B1A',
    motion: MOTION.DRIFT,
    particle: { count: 60, size: [1.6, 3.6], speed: 0.16, color: '#9FB0FF', alpha: [0.30, 0.75] },
  },
  {
    id: 'ember',
    blend: 'lighter',
    name: 'Ember',
    blurb: 'A banked fire, throwing sparks upward.',
    sky: ['#1A0705', '#2E0D06', '#120403'],
    horizon: '#7A2A10',
    glow: '#F0682A',
    light: 'rgba(240,104,42,0.13)',
    ink: '#0F0402',
    motion: MOTION.RISE,
    particle: { count: 55, size: [1.4, 3.2], speed: 0.42, color: '#FFA24A', alpha: [0.40, 1.00] },
  },
  {
    id: 'frost',
    blend: 'source-over',
    name: 'Frost',
    blurb: 'Pale cold light and falling snow.',
    sky: ['#0C1626', '#152438', '#0A111C'],
    horizon: '#3E6C92',
    glow: '#8FD0F0',
    light: 'rgba(143,208,240,0.12)',
    ink: '#070D16',
    motion: MOTION.FALL,
    particle: { count: 90, size: [1.8, 4.2], speed: 0.34, color: '#E4F4FF', alpha: [0.45, 0.95] },
  },
  {
    id: 'downpour',
    blend: 'source-over',
    name: 'Downpour',
    blurb: 'Slate skies and hard rain.',
    sky: ['#0E1418', '#1A2328', '#090D10'],
    horizon: '#38484F',
    glow: '#6E8A94',
    light: 'rgba(110,138,148,0.12)',
    ink: '#070A0C',
    motion: MOTION.STREAK,
    particle: { count: 130, size: [9, 20], speed: 2.1, color: '#A8C4CE', alpha: [0.20, 0.50] },
  },
  {
    id: 'verdant',
    blend: 'lighter',
    name: 'Verdant',
    blurb: 'Deep canopy, with spores rising through the light.',
    sky: ['#08160E', '#0E2416', '#06110A'],
    horizon: '#1F5C33',
    glow: '#54C97A',
    light: 'rgba(84,201,122,0.11)',
    ink: '#050D08',
    motion: MOTION.BLOOM,
    particle: { count: 50, size: [1.8, 4.4], speed: 0.2, color: '#A8F0BE', alpha: [0.30, 0.70] },
  },
  {
    id: 'void',
    blend: 'lighter',
    name: 'Void',
    blurb: 'Nothing but stars.',
    sky: ['#04040A', '#080814', '#020206'],
    horizon: '#191A38',
    glow: '#6E6ED0',
    light: 'rgba(110,110,208,0.10)',
    ink: '#020205',
    // ⚠ THE CONTROL. No translation term whatsoever — these stars never move,
    // they only vary in opacity. If Void ever reads like the other five, the
    // other five are not structurally different after all.
    motion: MOTION.TWINKLE,
    particle: { count: 130, size: [1.0, 2.4], speed: 0, color: '#FFFFFF', alpha: [0.25, 1.00] },
  },
];

export const environmentById = (id) => ENVIRONMENTS.find((e) => e.id === id) || null;

/** Valid ids, mirrored in firestore.rules. Add to both or the picker offers
 *  something the server refuses — the same trap as NAME_FONTS. */
export const ENVIRONMENT_IDS = ENVIRONMENTS.map((e) => e.id);

/**
 * The backdrop, as inline style. A scene, not a fill: a sky gradient, a horizon
 * band low in the frame, and a ground glow rising from the bottom edge.
 *
 * ⚠ The glow is anchored at the BOTTOM (`at 50% 108%`), so it rises into the
 * message area from below. Anchored at the top it would sit behind the thread
 * header, which is exactly the mistake the profile theme band made: light drawn
 * where it is occluded paints zero visible pixels.
 */
/**
 * ⚠ GRAIN IS NOT DECORATION HERE, IT IS THE ANTI-BANDING FIX.
 * A gradient this large and this dark WILL band into visible steps on an 8-bit
 * display, because there are not enough distinct values between `#0A1030` and
 * `#0B0E22` to fill the height smoothly. Noise dithers the boundary away.
 * Source: https://css-tricks.com/grainy-gradients/ (fractalNoise, numOctaves 3,
 * stitchTiles, noise UNDER the gradient).
 *
 * ⚠ IT CANNOT USE `.vg-grain`. That class is a `::before { inset: 0 }`, and
 * this paints on a SCROLLER, so the pseudo-element would scroll away with the
 * content and leave the rest of a long thread ungrained (and therefore banded).
 * As a background LAYER it is fixed to the element's box for free.
 *
 * baseFrequency 0.65 per the source. `.vg-grain` uses 0.8, but that is tuned as
 * surface TOOTH at 0.07 opacity on a small panel; dithering a full-height
 * gradient is a different job and takes the coarser, stronger noise.
 */
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23g)' opacity='0.055'/%3E%3C/svg%3E\")";

export function environmentBackdrop(env) {
  if (!env) return null;
  const [a, b, c] = env.sky;
  return {
    backgroundColor: env.ink,
    backgroundImage: [
      // ⚠ Grain FIRST in the list = topmost layer, so it dithers everything
      // below it. Underneath the gradient it would be invisible.
      GRAIN,
      // The light cast. It was a separate absolutely-positioned DOM layer in
      // the first pass, which meant chasing the scroller's height with a
      // ResizeObserver to size a STATIC gradient. It is a background layer.
      `radial-gradient(140% 70% at 50% 100%, ${env.light} 0%, transparent 74%)`,
      `radial-gradient(120% 60% at 50% 108%, ${env.glow}2E 0%, transparent 62%)`,
      `linear-gradient(180deg, ${a} 0%, ${b} 46%, ${env.horizon}22 66%, ${c} 100%)`,
    ].join(', '),
  };
}
