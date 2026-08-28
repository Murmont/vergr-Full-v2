// The particle engine for squad environments. Effect 11.
// Doc: docs/effects/11-squad-environments.md
//
// ⚠ THIS IS A PLAIN MODULE ON PURPOSE, WITH NO REACT IN IT. The component is a
// thin wrapper and `scripts/squad-environment-preview.mjs` renders the SAME
// code. A preview harness that reimplements the draw loop is worthless: it
// drifts from what ships, and then you are measuring the harness. Doc 12's
// pattern preview and doc 06's typing preview both exist for this reason.
//
// Researched 2026-08-26, and the research changed the design. Sources:
//   https://godotshaders.com/shader/rain-and-snow-with-parallax-scrolling-effect/
//   https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/globalCompositeOperation
//   https://thecodeplayer.com/walkthrough/html5-canvas-experiment-a-cool-flame-fire-effect-using-particles
import { MOTION } from './squadEnvironments.js';  // explicit .js: Vite resolves it, and so does the raw browser in scripts/squad-environment-preview.mjs

/** Hard ceiling regardless of what an environment asks for. */
export const MAX_PARTICLES = 320;

/**
 * ⚠ DEPTH IS THE TECHNIQUE, AND THE FIRST VERSION HAD NONE.
 * Every serious rain/snow implementation runs particles at multiple depths:
 * distant ones smaller, slower and dimmer, near ones larger, faster, brighter.
 * A field where every particle shares one speed range is exactly what reads as
 * a screensaver instead of weather.
 *
 * `z` in [0,1] — 0 furthest, 1 nearest — drives FOUR properties at once. Driving
 * only size, or only speed, does not produce depth: the eye reads depth from
 * their CORRELATION.
 */
// ⚠ THESE WERE 0.35 / 0.30 / 0.28 AND THE FIELD WAS INVISIBLE. Measured on the
// preview: 420-933 lit pixels out of 214,084, i.e. 0.2-0.4% coverage. A
// 1px base size scaled to 0.35 is a 0.35px circle, which sub-pixel
// antialiasing renders as almost nothing, and most particles sat there because
// of the far-bias below. Depth must ATTENUATE the far plane, not erase it.
const DEPTH_MIN_SCALE = 0.5;
const DEPTH_MIN_SPEED = 0.34;
const DEPTH_MIN_ALPHA = 0.4;

/**
 * ⚠ FAR-BIAS EXPONENT. `**2` was too aggressive: it put roughly 70% of the
 * field below z=0.55, where particles are small, slow and dim all at once, so
 * the visible population collapsed. 1.5 still yields more far than near — which
 * is what makes it read as depth — without emptying the frame.
 */
const DEPTH_BIAS = 1.5;

/**
 * ⚠ COUNT IS A DENSITY, NOT A CONSTANT, and the first version got this wrong
 * in a way a small preview cell hides. A fixed 46 particles is a reasonable
 * field in a 400px-wide phone thread and is nothing at all across a 1100px
 * desktop pane. `count` in the environment table is now "particles per
 * 240,000 px²" (roughly one preview cell), scaled to the real box.
 */
const REFERENCE_AREA = 240000;

const rnd = (a, b) => a + Math.random() * (b - a);

function spawn(model, w, h, cfg, seeded) {
  const [s0, s1] = cfg.size;
  const [a0, a1] = cfg.alpha;
  // ⚠ Squared distribution: many far, few near. A uniform `z` puts as many
  // large fast particles in front of the reader as small slow ones behind,
  // which flattens the field back out and undoes the depth.
  const z = Math.random() ** DEPTH_BIAS;
  const rises = model === MOTION.RISE || model === MOTION.BLOOM;
  return {
    z,
    x: Math.random() * w,
    y: seeded ? Math.random() * h : (rises ? h + 10 : -10),
    r: rnd(s0, s1) * (DEPTH_MIN_SCALE + (1 - DEPTH_MIN_SCALE) * z),
    a: rnd(a0, a1) * (DEPTH_MIN_ALPHA + (1 - DEPTH_MIN_ALPHA) * z),
    sp: DEPTH_MIN_SPEED + (1 - DEPTH_MIN_SPEED) * z,
    p: Math.random() * Math.PI * 2,
    vx: rnd(-0.25, 0.25),
    vy: rnd(0.6, 1.4),
    age: 0,
  };
}

/**
 * Build a weather instance bound to a canvas and a sizing box.
 * Returns { start, stop, resize, drawOnce, particles } — the caller owns the
 * lifecycle, so React and the preview harness drive it identically.
 */
export function createWeather(canvas, box, env) {
  const ctx = canvas.getContext('2d');
  const cfg = env.particle;
  const model = env.motion;
  // ⚠ PER ENVIRONMENT, NOT GLOBAL. Embers and stars EMIT light so overlaps must
  // SUM (`lighter`); rain and snow OCCLUDE it. Additive rain glows, which is
  // simply wrong, and getting this backwards is very visible.
  const blend = env.blend || 'source-over';
  let w = 0;
  let h = 0;
  let parts = [];
  let raf = 0;
  let running = false;

  const resize = () => {
    // DPR capped at 2: a 3x buffer on a large desktop pane is over twice the
    // fill cost for no visible gain on a soft particle.
    const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
    w = box.clientWidth;
    h = box.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    // ⚠ PULL UP BY THE SCROLLER'S TOP PADDING. The sticky anchor is the first
    // child, so it sits AFTER `padding-top` and the canvas started 14px down —
    // measured on the live squad thread, which has `padding:14px 22px 4px`.
    // That left a strip at the top of the room with backdrop but no weather,
    // and particles visibly beginning a little way down the frame. Read rather
    // than hardcoded, so changing the padding cannot silently reintroduce it.
    const padTop = parseFloat(getComputedStyle(box).paddingTop) || 0;
    canvas.style.top = `${-padTop}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const seed = () => {
    const area = Math.max(1, w * h);
    const n = Math.max(8, Math.min(Math.round(cfg.count * (area / REFERENCE_AREA)), MAX_PARTICLES));
    parts = Array.from({ length: n }, () => spawn(model, w, h, cfg, true));
    // ⚠ Painter's order: far first, so near particles overlap distant ones and
    // never the reverse. A free depth cue, sorted once and never re-sorted.
    parts.sort((m, n2) => m.z - n2.z);
  };

  // ── THE SIX MOTION MODELS ────────────────────────────────────────────
  // ⚠ They differ in their EQUATIONS, not their constants. Re-tuning a number
  // does not make a new motion — that is exactly how the chat pattern motions
  // ended up being five ellipses. Every displacement is scaled by `p.sp`, the
  // depth speed factor, so parallax falls out of all six for free.
  const step = (t) => {
    for (const p of parts) {
      p.age += 1;
      switch (model) {
        case MOTION.DRIFT:
          p.vx += rnd(-0.02, 0.02);
          p.vy += rnd(-0.02, 0.02);
          p.vx *= 0.98; p.vy *= 0.98;
          p.x += p.vx * cfg.speed * 6 * p.sp;
          p.y += p.vy * cfg.speed * 6 * p.sp;
          break;
        case MOTION.RISE:
          p.y -= cfg.speed * (1.6 - Math.min(1.2, p.age / 260)) * p.sp;
          p.x += Math.sin(t / 700 + p.p) * 0.32 * p.sp;
          p.a = Math.max(0, p.a - 0.0016);
          break;
        case MOTION.FALL:
          p.y += cfg.speed * p.sp;
          p.x += Math.sin(t / 900 + p.p) * 0.7 * p.sp;
          break;
        case MOTION.STREAK:
          // Strictly linear, high velocity, and ANGLED — vertical rain reads as
          // static. Drawn as a line, never a dot.
          p.y += cfg.speed * 4 * p.sp;
          p.x += cfg.speed * 0.45 * p.sp;
          break;
        case MOTION.BLOOM:
          p.y -= cfg.speed * p.sp;
          p.x += Math.sin(t / 2600 + p.p) * 0.9 * p.sp;
          break;
        case MOTION.TWINKLE:
        default:
          // ⚠ NO TRANSLATION. Opacity only. This is the control: if Void ever
          // reads like the other five, the other five are not structurally
          // different after all.
          break;
      }
    }
    for (let i = 0; i < parts.length; i += 1) {
      const p = parts[i];
      if (p.y < -30 || p.y > h + 30 || p.x < -40 || p.x > w + 40 || p.a <= 0) {
        parts[i] = spawn(model, w, h, cfg, false);
      }
    }
  };

  const draw = (t) => {
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = blend;
    ctx.fillStyle = cfg.color;
    ctx.strokeStyle = cfg.color;
    for (const p of parts) {
      const alpha = model === MOTION.TWINKLE
        ? p.a * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t / 1100 + p.p)))
        : p.a;
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      if (model === MOTION.STREAK) {
        // ⚠ Length and width scale with depth too, so near drops are long
        // streaks and far ones short ticks. That correlation is the effect.
        ctx.lineWidth = Math.max(0.6, p.z * 1.4);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.r * 0.22, p.y - p.r);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  const frame = (t) => {
    step(t);
    draw(t);
    raf = requestAnimationFrame(frame);
  };

  return {
    resize: () => { resize(); seed(); },
    start() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    /** One still frame. The resting pose for reduced motion. */
    drawOnce: (t = 0) => draw(t),
    /** Exposed so the preview can assert depth spread rather than eyeball it. */
    particles: () => parts,
  };
}
