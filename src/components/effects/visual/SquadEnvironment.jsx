// The atmosphere layer of a squad environment. Effect 11.
// Doc: docs/effects/11-squad-environments.md
//
// ⚠ THE DRAW LOOP IS NOT IN HERE. It lives in utils/squadWeather.js, which has
// no React in it, so `scripts/squad-environment-preview.mjs` renders THE SAME
// CODE that ships. A harness that reimplements the loop drifts from the app and
// then you are only measuring the harness.
//
// The BACKDROP is a CSS background on the scroller itself (`environmentBackdrop`
// in utils/squadEnvironments.js). A background on a scrolling element is already
// fixed to that element's box, so it does not slide away as the thread scrolls.
// This component is only the part CSS cannot do.
//
// ⚠ WHY IT IS A `position: sticky; height: 0` FIRST CHILD.
// `.sqd .messages` is `flex:1; overflow-y:auto` — a scroller. An `inset: 0`
// child of a scroller is positioned against its SCROLL CONTENT, so it would
// cover the first screenful and then scroll away, leaving the rest of a long
// thread bare. A zero-height sticky element pinned at `top: 0` is a stable
// anchor contributing NOTHING to flow, and its absolutely positioned canvas
// covers the visible box however far the thread is scrolled.
//
// ⚠ z-index -1 IS LOAD-BEARING — the ambilight lesson repeated. At 0 these are
// positioned siblings, and positioned elements paint above non-positioned ones,
// so particles would draw over the message text. A negative z-index child
// paints above the parent's BACKGROUND but below its in-flow content, which is
// exactly what an atmosphere layer needs.
//
// ⚠ IT NEVER REACHES OUTSIDE ITS OWN BOX (R1). No negative inset.
import { useEffect, useRef } from 'react';
import { createWeather } from '../../../utils/squadWeather';

/**
 * ⚠ TWO REDUCED-MOTION SWITCHES, AND A MEDIA QUERY ONLY CATCHES ONE.
 * Settings -> Appearance sets `html[data-reduced-motion="true"]`, which the OS
 * query knows nothing about. Doc 06 shipped a defect exactly this way.
 */
const motionReduced = () =>
  document.documentElement.dataset.reducedMotion === 'true'
  || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function SquadEnvironment({ env, weather }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    // Tier 1 is backdrop + light only: no canvas work at all, so an owner below
    // the weather unlock costs exactly one empty div.
    if (!env || !weather) return undefined;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const box = wrap?.parentElement;
    if (!canvas || !box) return undefined;

    const w = createWeather(canvas, box, env);
    w.resize();
    // ⚠ Paint one frame NOW. Waiting for the first rAF leaves the canvas blank
    // for a frame, and in any context where rAF is throttled (a background
    // tab, a headless capture) it would stay blank indefinitely.
    w.drawOnce(0);

    // ⚠ Reduced motion draws ONE frame and stops. Not a slowed loop and not a
    // fast-forwarded animation: a still field, a legitimate resting pose for
    // all six models.
    if (motionReduced()) {
      w.drawOnce(0);
      return () => {};
    }

    // ⚠ A PARTICLE LOOP IN A BACKGROUND TAB IS PURE WASTE. Doc §3.3 requires
    // this, and Chrome freezes the timeline there anyway, so a running rAF just
    // burns battery rendering frames nobody sees.
    const onVis = () => (document.visibilityState === 'hidden' ? w.stop() : w.start());
    document.addEventListener('visibilitychange', onVis);

    const ro = new ResizeObserver(() => w.resize());
    ro.observe(box);

    if (document.visibilityState !== 'hidden') w.start();

    return () => {
      w.stop();
      document.removeEventListener('visibilitychange', onVis);
      ro.disconnect();
    };
  }, [env, weather]);

  if (!env || !weather) return null;

  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
      style={{ position: 'sticky', top: 0, height: 0, zIndex: -1, pointerEvents: 'none' }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} />
    </div>
  );
}
