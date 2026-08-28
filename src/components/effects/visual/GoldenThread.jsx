// ⛔ NOT USED BY THE APP. REJECTED 2026-08-27.
//
// This drew the Golden Thread as an SVG path down the chat gutter. It works,
// and it benchmarked well (0.105ms/draw, 0.63% of a frame), but it LOOKED
// WRONG: a jagged gold squiggle in a narrow column that read as a rendering
// artefact rather than a designed element. Founder, seeing it: "that looks
// professional ui to you? is this how it looks on twitch?" No, and no.
//
// ⚠ THE RESEARCH HAD ALREADY SAID SO. Doc 07 §7 records: "nobody draws
// connecting curves in live chat... not one links messages with a path."
// That finding was written down and then not acted on.
//
// The shipped reward is a TINT + ACCENT BAR on the followed viewer's rows,
// in ChatPanel.jsx — the pattern Twitch uses and the one this very file's
// neighbour already used for tips. Kept on disk under the no-deletion rule.
// ⚠ Do NOT wire this back in without a design that has been LOOKED AT first.

// The Golden Thread. Effect 07. Doc: docs/effects/07-golden-thread.md
//
// ⚠ THE DRAW LOOP IS NOT IN HERE. It lives in utils/goldenThread.js, which has
// no React in it, so `scripts/golden-thread-preview.mjs` benchmarks THE SAME
// CODE that ships. Phase A measured 0.105ms per draw, 0.63% of a frame budget.
//
// ── THE THREE RULES, ENFORCED HERE OR ABOVE ───────────────────────────
//
// 1. ONE thread. Structural: one `uid` prop, one `<path>`.
// 2. HOST'S CHAT ONLY. ⚠ The CALLER enforces this — `ChatPanel` renders for
//    viewers too, and mounting this there would put a private wayfinding aid on
//    every viewer's screen. Twitch's own highlights "will never be visible to
//    other viewers"; this follows that.
// 3. LEFT GUTTER, never across text. Structural, in the engine's path maths.
//
// ⚠ RENDERS `null` WHEN THERE IS NO UID (R-6: zero cost when off). Phase A
// measured the off case at 0.001ms, but not mounting at all is cheaper still.
import { useEffect, useRef } from 'react';
import { createThread } from '../../../utils/goldenThread';

export default function GoldenThread({ boxRef, uid, color, deps }) {
  const svgRef = useRef(null);
  const threadRef = useRef(null);

  useEffect(() => {
    const box = boxRef?.current;
    const svg = svgRef.current;
    if (!box || !svg || !uid) return undefined;

    const t = createThread(box, svg, { color });
    threadRef.current = t;
    t.setUid(uid);
    // ⚠ Paint once immediately. Waiting for the first rAF leaves the thread
    // absent for a frame, and in any context where rAF is throttled it would
    // stay absent — the same trap the squad-weather canvas hit.
    t.drawNow();
    t.start();
    return () => { t.stop(); threadRef.current = null; };
  }, [boxRef, uid, color]);

  // The message list changed: re-scan for that uid's rows. Cheap — it only
  // marks dirty; the rAF does the work.
  useEffect(() => { threadRef.current?.refresh(); }, [deps]);

  if (!uid) return null;

  return (
    <svg
      ref={svgRef}
      className="vg-thread"
      aria-hidden="true"
      // ⚠ z-index -1 so the path paints above the panel's background but BELOW
      // the messages. At 0 it is a positioned sibling and would draw over chat
      // text — the exact defect ambilight was rejected for twice.
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
               pointerEvents: 'none', zIndex: -1, overflow: 'visible' }}
    >
      <path d="" />
    </svg>
  );
}
