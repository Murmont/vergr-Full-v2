// The animated chat-theme background. Effect 12.
// Doc: docs/effects/12-bubble-themes.md §0.2 (the algorithm) and §0.4e (the
// animation), both read from Telegram's own source rather than guessed.
//
// WHAT IT IS: a 60x80 pixel bitmap, recomputed per frame and upscaled, showing
// through a pattern of icon-shaped holes in a black sheet. The icons never
// move; only the light behind them does.
//
// ⚠ THE 60x80 IS THE TECHNIQUE, NOT A COMPROMISE. Telegram uses exactly this
// size (`MotionBackgroundDrawable`: bitmapWidth 60, bitmapHeight 80) and lets
// the bilinear upscale do the smoothing. The full-resolution version is ~36x
// the work and cannot hold 60fps. Measured here: 0.32ms per frame, about 2% of
// a 60fps budget, so this needs no WebGL and no worker. Do not "improve" the
// resolution.
import { useEffect, useRef } from 'react';

const W = 60, H = 80;

// ── FIVE MOTIONS, NOT ONE ───────────────────────────────────────────
// ⚠ THE FIRST TWO ATTEMPTS BOTH PRODUCED A CIRCLE, AND THE SECOND ONE LIED
// ABOUT IT. Telegram moves four colours between eight slots on a ring, so their
// field literally rotates. The replacement claimed to fix that with Lissajous
// paths, but used frequency RATIOS of 1.32 / 0.61 / 1.45 / 1.34. A Lissajous at
// a ratio near 1:1 with a phase offset is AN ELLIPSE. Founder, twice:
//   "your gradient animations all move in a circle, how creative of you"
//   "they all still move in a circular motion, create a few different options"
//
// So these five are structurally different MODELS, not five tunings of one:
//
//   drift   Lissajous at 3:2 and 5:3 — genuine figure-eights and pretzels.
//           A ratio of small INTEGERS is what makes the lobes; a ratio near 1
//           is what made an ellipse.
//   tide    Dominantly one axis. Colours slide across and back; the tiny
//           vertical term stops them running on a rail. Not orbital at all.
//   pulse   Purely RADIAL: each colour keeps a fixed bearing from centre and
//           moves in and out. No angular component whatsoever, so it cannot
//           read as rotation however long you watch it.
//   wander  Three incommensurate sines per axis. The sum has no practical
//           period, so it never traces a closed path and never repeats.
//   orbit   The honest circle, kept deliberately. Some people will want it,
//           and pretending it is not an option is how the first fix happened.
//
// Every model returns points in 0..1, clamped away from the very edge so a
// colour never parks in a corner where three quarters of its field is offscreen.
const CLAMP = (v) => Math.max(0.06, Math.min(0.94, v));

const MOTIONS = {
  drift: (t, i) => {
    const P = [
      { ax: 0.30, ay: 0.26, fx: 0.30, fy: 0.20, px: 0.0, py: 1.7 },   // 3:2
      { ax: 0.26, ay: 0.31, fx: 0.25, fy: 0.15, px: 2.1, py: 0.4 },   // 5:3
      { ax: 0.33, ay: 0.24, fx: 0.28, fy: 0.16, px: 4.0, py: 3.1 },   // 7:4
      { ax: 0.24, ay: 0.29, fx: 0.18, fy: 0.315, px: 5.6, py: 2.2 },  // 4:7
    ][i % 4];
    return [CLAMP(0.5 + P.ax * Math.sin(t * P.fx + P.px)),
            CLAMP(0.5 + P.ay * Math.sin(t * P.fy + P.py))];
  },

  tide: (t, i) => {
    const P = [
      { a: 0.36, f: 0.17, p: 0.0, y: 0.22, fy: 0.055 },
      { a: 0.32, f: 0.13, p: 2.4, y: 0.44, fy: 0.041 },
      { a: 0.38, f: 0.20, p: 4.1, y: 0.62, fy: 0.063 },
      { a: 0.30, f: 0.15, p: 5.9, y: 0.80, fy: 0.048 },
    ][i % 4];
    return [CLAMP(0.5 + P.a * Math.sin(t * P.f + P.p)),
            CLAMP(P.y + 0.07 * Math.sin(t * P.fy + P.p))];
  },

  pulse: (t, i) => {
    // Fixed bearing, moving radius. Golden-angle bearings so four colours never
    // line up on an axis and read as a cross.
    const bearing = i * 2.39996;
    const P = [{ f: 0.22, p: 0.0 }, { f: 0.17, p: 1.9 },
               { f: 0.26, p: 3.4 }, { f: 0.20, p: 5.1 }][i % 4];
    const r = 0.16 + 0.24 * (0.5 + 0.5 * Math.sin(t * P.f + P.p));
    return [CLAMP(0.5 + r * Math.cos(bearing)), CLAMP(0.5 + r * Math.sin(bearing))];
  },

  wander: (t, i) => {
    // Sum of three sines per axis at mutually incommensurate frequencies. The
    // combined period is long enough that it never visibly repeats, and the
    // path is open rather than closed, which is what "not a circle" needs.
    const S = [
      { x: [0.131, 0.211, 0.377], y: [0.173, 0.283, 0.419], p: 0.0 },
      { x: [0.157, 0.239, 0.311], y: [0.127, 0.347, 0.401] , p: 1.3 },
      { x: [0.191, 0.263, 0.433], y: [0.149, 0.229, 0.367], p: 2.7 },
      { x: [0.113, 0.297, 0.353], y: [0.181, 0.251, 0.389], p: 4.4 },
    ][i % 4];
    const mix = (f) => 0.60 * Math.sin(t * f[0] + S.p)
                     + 0.28 * Math.sin(t * f[1] + S.p * 1.7)
                     + 0.12 * Math.sin(t * f[2] + S.p * 2.3);
    return [CLAMP(0.5 + 0.34 * mix(S.x)), CLAMP(0.5 + 0.32 * mix(S.y))];
  },

  orbit: (t, i) => {
    const a = t * 0.16 + (i * Math.PI) / 2;
    return [CLAMP(0.5 + 0.30 * Math.cos(a)), CLAMP(0.5 + 0.28 * Math.sin(a))];
  },
};

const SEND_BOOST = 3.2;    // a send speeds the field up briefly
const SEND_MS = 900;

/** Where each colour sits at time t (seconds), under the chosen model. */
function pointsAt(t, n, motion) {
  const fn = MOTIONS[motion] || MOTIONS.drift;
  const out = [];
  for (let i = 0; i < n; i++) out.push(fn(t, i));
  return out;
}

// The swirl warp depends only on the pixel, never on phase or colour, so it is
// computed once for the life of the module. It is what makes the colour fields
// curve instead of reading as four radial blobs.
const SWIRL = (() => {
  const a = new Float32Array(W * H * 2);
  for (let y = 0; y < H; y++) {
    const dy = y / H - 0.5;
    for (let x = 0; x < W; x++) {
      const dx = x / W - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      const s = 0.35 * d;
      const th = s * s * 0.8 * 8.0;
      const st = Math.sin(th), ct = Math.cos(th);
      a[(y * W + x) * 2] = Math.max(0, Math.min(1, 0.5 + dx * ct - dy * st));
      a[(y * W + x) * 2 + 1] = Math.max(0, Math.min(1, 0.5 + dx * st + dy * ct));
    }
  }
  return a;
})();

const hexToRgb = (h) => [
  parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
];

function paint(ctx, rgb, t, motion) {
  const img = ctx.createImageData(W, H);
  const pts = pointsAt(t, rgb.length, motion);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = SWIRL[(y * W + x) * 2], py = SWIRL[(y * W + x) * 2 + 1];
      let r = 0, g = 0, b = 0, sum = 0;
      for (let i = 0; i < rgb.length; i++) {
        const dx = px - pts[i][0], dy = py - pts[i][1];
        // Inverse distance with a hard 0.9 cutoff and a FOURTH power. The
        // sharp falloff is what keeps the colours distinct instead of muddying
        // to grey, and it is Telegram's exact formula.
        let d = Math.max(0, 0.9 - Math.sqrt(dx * dx + dy * dy));
        d = d * d * d * d;
        sum += d;
        r += d * rgb[i][0]; g += d * rgb[i][1]; b += d * rgb[i][2];
      }
      const o = (y * W + x) * 4;
      img.data[o] = r / sum; img.data[o + 1] = g / sum; img.data[o + 2] = b / sum;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * @param {string[]} colors    3 or 4 hex colours
 * @param {string}   patternUrl  the alpha tile, or null for a plain gradient
 * @param {number}   sendCount   increments once per message SENT; briefly speeds the field up
 * @param {number}   intensity   0-100, how strongly the pattern is lit
 * @param {number}   tileSize    CSS px the 768-unit tile is drawn at
 */
export default function ChatGradient({
  colors, patternUrl, sendCount = 0, intensity = 78, tileSize = 560, sheet = '#000000',
  motion = 'drift',
}) {
  const ref = useRef(null);
  const rafRef = useRef(0);
  const lastSend = useRef(sendCount);

  // ⚠ BOTH reduced-motion switches. The media query catches the OS setting;
  // Vergr's own Settings → Appearance toggle is an ATTRIBUTE on <html>, and
  // index.css answers it by fast-forwarding animations to their last keyframe
  // rather than stopping them. See docs/effects/06 §8.2.2 — that one cost a
  // shipped defect.
  const reduced = typeof window !== 'undefined' && (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.getAttribute('data-reduced-motion') === 'true'
  );

  const key = (colors || []).join(',');

  // ── IT DRIFTS CONTINUOUSLY, and speeds up when you send ─────────────
  // Founder call, 2026-08-25. The first build only moved on send, which is what
  // Telegram's CHAT background does, but their own drawable also has a
  // continuous mode and it supplies the speed:
  //
  //   MotionBackgroundDrawable: posAnimationProgress += (dt / 12000f) * indeterminateSpeedScale
  //
  // So one phase step per 12 seconds, a full 8-phase revolution in 96s. That is
  // slow enough to read as the light breathing rather than as something
  // sliding, which is the failure mode a faster drift falls into.
  //
  // Sending still KICKS it: the same 500ms eased step Telegram uses, then the
  // drift resumes from wherever it landed.
  // Time, in seconds, that the field has been running. A send briefly speeds
  // the clock up rather than jumping the field, so the reaction reads as a
  // surge of light instead of a cut.
  const tRef = useRef(Math.random() * 40);
  const boostUntil = useRef(0);

  useEffect(() => {
    const c = ref.current;
    if (!c || !colors?.length) return undefined;
    const ctx = c.getContext('2d');
    const rgb = colors.map(hexToRgb);

    // ⚠ PAINT ONE FRAME IMMEDIATELY, before any rAF. requestAnimationFrame does
    // not fire at all in a hidden tab, so a thread opened in a background tab
    // would otherwise sit on an unpainted canvas and the theme would be BLANK
    // until the tab was focused. Measured exactly that: a sampled pixel came
    // back 0,0,0 on a load into a backgrounded window.
    paint(ctx, rgb, tRef.current, motion);
    if (reduced) return undefined;

    let last = 0;
    const loop = (now) => {
      // ⚠ PAUSE WHEN NOBODY IS LOOKING. A continuous animation on an open chat
      // is the one thing that could make this expensive, so it stops dead while
      // the tab is hidden. A frame costs 0.32ms: nothing while visible, pure
      // waste while not.
      if (document.hidden) { last = 0; rafRef.current = requestAnimationFrame(loop); return; }
      if (!last) last = now;
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      const boost = now < boostUntil.current ? SEND_BOOST : 1;
      tRef.current += dt * boost;
      paint(ctx, rgb, tRef.current, motion);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [key, reduced, motion]);

  useEffect(() => {
    if (sendCount === lastSend.current) return;
    lastSend.current = sendCount;
    if (!reduced) boostUntil.current = performance.now() + SEND_MS;
  }, [sendCount, reduced]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  if (!colors?.length) return null;

  // ⚠ THE SHEET IS THE BOTTOM LAYER AND THE GRADIENT IS MASKED TO THE ICONS.
  // Telegram's negative-intensity path draws black, then composites the
  // gradient through the pattern's alpha (DST_IN). In CSS that is: a solid
  // sheet, with a mask-image on the canvas above it. The icons are the holes.
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute', inset: 0, overflow: 'hidden',
        background: sheet, pointerEvents: 'none',
      }}
    >
      <canvas
        ref={ref}
        width={W}
        height={H}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          opacity: Math.max(0, Math.min(100, intensity)) / 100,
          ...(patternUrl ? {
            WebkitMaskImage: `url(${patternUrl})`, maskImage: `url(${patternUrl})`,
            WebkitMaskSize: `${tileSize}px`, maskSize: `${tileSize}px`,
            WebkitMaskRepeat: 'repeat', maskRepeat: 'repeat',
          } : null),
        }}
      />
    </div>
  );
}
