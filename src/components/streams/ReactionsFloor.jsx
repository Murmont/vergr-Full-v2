// ReactionsFloor — heart reactions floating up the right edge of the stream
// view (TikTok Live model: the ONLY reaction is a heart/like).
//
// This component renders the floating trail only — there is no on-screen
// reaction rail. Hearts are triggered by tapping the video / the heart
// button in the composer row; remote viewers' reactions also render here.
//
// ⚠ WHAT MAKES THIS READ AS TIKTOK RATHER THAN "A FLOATING EMOJI".
// The first version was one ❤️ emoji per tap, travelling in a STRAIGHT LINE on
// a fixed random diagonal, fading from full to zero across the whole flight.
// Four things separate that from the reference, and all four are cheap:
//
//   1. A DRAWN HEART, NOT AN EMOJI. An emoji glyph is whatever the OS ships —
//      Segoe on Windows, Noto on Android — so the same stream looks different
//      per device and none of them match the brand. An inline SVG path is one
//      shape everywhere and can be coloured per particle.
//   2. COLOUR VARIETY. TikTok emits hearts in several colours; a single red
//      repeated fifty times reads as a glitch rather than a crowd. Palette is
//      brand pink/violet/gold — deliberately NO cyan [[project-brand-no-cyan]].
//   3. AN S-CURVE, NOT A DIAGONAL. Real ones wobble: they drift one way, come
//      back, and drift again as they rise. A single `x` target is a ruler line
//      and is the single biggest tell.
//   4. FADE LATE, POP EARLY. Fading from the first frame means every heart is
//      half-transparent for its whole life, so the trail looks weak. They pop
//      in past full size, hold opaque through the middle, and fade only in the
//      last third.
//
// ⚠ TWO REDUCED-MOTION SWITCHES. `prefersReducedMotion()` reads the media query
// ONLY; Settings → Appearance sets `html[data-reduced-motion="true"]` and a
// media query cannot see it. Both are checked here, or the setting silently
// does nothing on this surface.

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { prefersReducedMotion } from '../primitives/springs';

let nextId = 0;

// ⚠ WEIGHTED, NOT UNIFORM, AND THIS WAS FOUND BY RENDERING IT. An even split
// across six colours put three violets and a gold in every burst, so the trail
// read PURPLE — a heart that is not pink stops reading as a heart at 20px. Pink
// leads (5 of 8 entries), violet is the accent, gold appears about one in eight.
const HEART_COLORS = [
  '#FF2D6F', '#FF2D6F', '#FF4D85', '#FF5C8A', '#F0396B',
  '#C87FFF', '#B44FFF',
  '#F5C842',
];

function Heart({ size, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ display: 'block' }}>
      <path
        d="M12 21s-7.6-4.9-9.6-9.2C1.1 8.6 2.6 5.2 6 4.3c2.1-.6 4.3.3 5.4 2.1l.6 1 .6-1c1.1-1.8 3.3-2.7 5.4-2.1 3.4.9 4.9 4.3 3.6 7.5C19.6 16.1 12 21 12 21z"
        fill={color}
      />
      {/* ⚠ A THIN CRESCENT, NOT A BLOB. The first specular was a rounded lobe at
          0.42 — about a quarter of the shape at 20px, which rendered as a white
          smear rather than a shine. Narrow and faint reads as gloss; wide and
          bright reads as damage. Same lesson `.vg-bloom` already records: white
          over a saturated fill averages toward grey. */}
      <path d="M7.9 6.6c.9-.7 2-.6 2.6.1.3.4.1.9-.4 1-.8.2-1.5.7-1.9 1.4-.2.4-.8.4-.9-.1-.2-.8 0-1.7.6-2.4z" fill="#fff" opacity="0.26" />
    </svg>
  );
}

export default function ReactionsFloor({
  events = [],            // [{ id, originX? }]
  position = 'right',     // 'right' | 'bottom' — float origin
}) {
  const [floats, setFloats] = useState([]);
  // ⚠⚠ THIS COMPONENT USED TO RE-SPAWN ITS ENTIRE `events` ARRAY ON EVERY
  // CHANGE, so tapping fast made the count grow quadratically: five taps in half
  // a second produced 1+2+3+4+5 = 15 hearts. MEASURED, not reasoned about —
  // clicking the button five times and counting the paths in the DOM.
  //
  // It hid because the caller drains its own array after 2600ms, so the backlog
  // stays small and a slow tap really does give one heart. Spam it and the
  // screen fills, which is exactly what the founder reported and what I twice
  // "fixed" by lowering the per-tap count somewhere else.
  //
  // An id is only ever spawned once now. The ref is deliberately not state: it
  // must be written during the effect that consumes the event, and a re-render
  // in between would let the same id through twice.
  const seen = useRef(new Set());

  useEffect(() => {
    if (!events.length) return;
    const unseen = events.filter((e) => e.id == null || !seen.current.has(e.id));
    if (!unseen.length) return;
    unseen.forEach((e) => { if (e.id != null) seen.current.add(e.id); });
    const reduced = prefersReducedMotion()
      || (typeof document !== 'undefined'
        && document.documentElement.getAttribute('data-reduced-motion') === 'true');
    const fresh = unseen.map((e, i) => {
      // Amplitude and direction of the wobble, per particle. Signed so a burst
      // fans out both ways instead of leaning as a group.
      const dir = Math.random() < 0.5 ? -1 : 1;
      // ⚠ AMPLITUDE HAS TO BE BIG ENOUGH TO SEE. At 14-36px against a 190px
      // rise the S-curve read as a slightly crooked vertical line.
      const amp = 22 + Math.random() * 30;
      return {
        id: e.id ?? ++nextId,
        reduced,
        color: HEART_COLORS[Math.floor(Math.random() * HEART_COLORS.length)],
        // wider size spread so a burst has depth instead of one uniform row
        size: 17 + Math.random() * 17,
        rise: 170 + Math.random() * 130,
        // staggered so a 6-tap burst leaves in sequence, not as one block
        delay: reduced ? 0 : i * 0.055 + Math.random() * 0.06,
        dur: 2.1 + Math.random() * 0.9,
        x1: dir * amp, x2: -dir * amp * 0.65, x3: dir * amp * 0.4,
        rot: dir * (6 + Math.random() * 10),
        originX: e.originX ?? null,
      };
    });
    setFloats((prev) => [...prev, ...fresh]);
    const t = setTimeout(() => {
      setFloats((prev) => prev.filter((f) => !fresh.find((x) => x.id === f.id)));
      // Forget the ids too, or the set grows for the life of the stream. Safe:
      // the caller has long since dropped these events (2600ms), so nothing it
      // hands us afterwards can still carry one.
      fresh.forEach((f) => seen.current.delete(f.id));
    }, 3400);
    return () => clearTimeout(t);
  }, [events]);

  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 6,
    }}>
      <AnimatePresence>
        {floats.map((f) => (
          <motion.span
            key={f.id}
            initial={{ opacity: 0, y: 0, x: 0, scale: 0.3, rotate: 0 }}
            animate={f.reduced
              ? { opacity: 1, y: -40, scale: 1 }
              : {
                // ⚠ KEYFRAME ARRAYS, NOT SINGLE TARGETS. The wobble IS the
                // effect; one `x` value gives a straight diagonal.
                opacity: [0, 1, 1, 0],
                y: [0, -f.rise * 0.26, -f.rise * 0.64, -f.rise],
                x: [0, f.x1, f.x2, f.x3],
                scale: [0.3, 1.14, 1, 0.86],
                rotate: [0, f.rot, -f.rot * 0.5, f.rot * 0.3],
              }}
            exit={{ opacity: 0 }}
            transition={f.reduced
              ? { duration: 0.001 }
              : { duration: f.dur, delay: f.delay, times: [0, 0.18, 0.62, 1], ease: 'easeOut' }}
            style={{
              position: 'absolute',
              bottom: 'calc(var(--vg-safe-b, 0px) + 96px)',
              left: f.originX != null ? f.originX : (position === 'right' ? 'calc(100% - 44px)' : '50%'),
              marginLeft: -f.size / 2,
              // ⚠ NO `transform: translateX(-50%)` HERE. It is overwritten by
              // framer-motion's own transform every frame, so the old version's
              // centring silently did nothing. marginLeft does the same job and
              // survives being animated.
              // ⚠ NO COLOURED GLOW. A per-particle halo blooms into its
              // neighbours wherever the trail bunches, turning a crowd into an
              // orange smear. One dark shadow, purely for separation against
              // bright video, is all this needs.
              filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.55))',
            }}
          >
            <Heart size={f.size} color={f.color} />
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
