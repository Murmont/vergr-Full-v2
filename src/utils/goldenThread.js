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

// The Golden Thread engine. Effect 07. Doc: docs/effects/07-golden-thread.md
//
// Links one viewer's messages in live chat with a curve down the LEFT GUTTER,
// so the broadcaster can follow that person without losing them in the flow.
//
// ⚠ NO REACT IN HERE ON PURPOSE. `scripts/golden-thread-preview.mjs` runs THIS
// code against a synthetic chat, so the harness cannot drift from what ships.
// Same reasoning as utils/squadWeather.js.
//
// ── THE THREE RULES THAT SHAPE THIS FILE ──────────────────────────────
//
// 1. ⚠ ONE PATH, EVER. Founder, 2026-08-26: two curves crossing a 360px column
//    is spaghetti. The cap is structural, not a setting — there is a single
//    `<path>` and a single tracked uid, so a second thread cannot exist.
//
// 2. ⚠ THE HOST'S CHAT ONLY. Doc §1's purpose is "so the STREAMER can track
//    that person". Twitch ships chat highlights that "will never be visible to
//    other viewers"; this follows that. The caller enforces it — this engine
//    does not know what a host is.
//
// 3. ⚠ THE LEFT GUTTER, NEVER ACROSS TEXT. A curve through the message column
//    crosses OTHER people's messages and makes them harder to read. Decorating
//    chat must never degrade chat.
//
// ── AND THE PERFORMANCE TRAPS (doc §2) ────────────────────────────────
//
// ⚠ `getBoundingClientRect()` per scroll event is the documented cost — the
// browser recalculates bounds on every call, and live chat scrolls continuously.
// So: ONE batched read of all tracked rects inside ONE rAF. Never per element,
// never per scroll event.
//
// ⚠ `ResizeObserver` does NOT help. It reports SIZE, not position. There is no
// position observer on the platform (WICG discourse 6095), so scroll handling is
// unavoidable — it can only be made cheap.

/** Hard cap on tracked nodes. The path only ever spans what is on screen. */
export const MAX_NODES = 12;

/** Messages are found by this attribute; ChatPanel stamps it on each row. */
export const UID_ATTR = 'data-thread-uid';

/**
 * Build a thread bound to a scroll container and an SVG overlay.
 *
 * @param {HTMLElement} box   the scrolling chat container
 * @param {SVGElement}  svg   an overlay sized to the container
 * @param {object}      opts  { gutter, color, reduced }
 */
export function createThread(box, svg, opts = {}) {
  const gutter = opts.gutter ?? 10;      // px from the container's left edge
  const color = opts.color || '#F5C842';
  const path = svg.querySelector('path');
  let uid = null;
  let raf = 0;
  let running = false;
  let dirty = true;
  // Instrumentation, so the harness can PROVE the rect budget rather than
  // assume it. Doc §5 requires the call count be bounded by the node cap.
  let rectReads = 0;

  const io = typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver((entries) => {
      // Offscreen rows stop being tracked, so a long thread never costs more
      // than a screenful. Marking dirty is enough; the rAF does the work.
      for (const e of entries) e.target.__onScreen = e.isIntersecting;
      dirty = true;
    }, { root: box, threshold: 0 })
    : null;

  let observed = [];
  const rescan = () => {
    if (io) observed.forEach((n) => io.unobserve(n));
    observed = uid ? [...box.querySelectorAll(`[${UID_ATTR}="${CSS.escape(uid)}"]`)] : [];
    // ⚠ NEWEST N, not the first N. The bottom of a live chat is where attention
    // is; keeping the oldest would anchor the thread off the top of the screen.
    if (observed.length > MAX_NODES) observed = observed.slice(-MAX_NODES);
    if (io) observed.forEach((n) => io.observe(n));
    dirty = true;
  };

  /** One batched read → one path. The only place rects are touched. */
  const draw = () => {
    if (!uid || !observed.length) { path.setAttribute('d', ''); return; }
    const b = box.getBoundingClientRect();
    rectReads += 1;
    const pts = [];
    for (const n of observed) {
      if (n.__onScreen === false) continue;
      const r = n.getBoundingClientRect();
      rectReads += 1;
      // Vertical centre of the row, pinned to the gutter x.
      const y = r.top - b.top + r.height / 2;
      if (y < -40 || y > b.height + 40) continue;
      pts.push(y);
    }
    if (pts.length < 1) { path.setAttribute('d', ''); return; }
    // ⚠ A SPINE THAT BULGES, not a curve between arbitrary points. The x stays
    // in the gutter; only the bulge varies, so the path can never wander into
    // the text column no matter how the rows are laid out.
    const x = gutter;
    const bulge = 6;
    let d = `M ${x} ${pts[0]}`;
    for (let i = 1; i < pts.length; i += 1) {
      const y0 = pts[i - 1];
      const y1 = pts[i];
      const mid = (y0 + y1) / 2;
      d += ` C ${x + bulge} ${mid} ${x + bulge} ${mid} ${x} ${y1}`;
    }
    path.setAttribute('d', d);
  };

  const frame = () => {
    if (dirty) { draw(); dirty = false; }
    raf = requestAnimationFrame(frame);
  };

  const onScroll = () => { dirty = true; };

  return {
    /** Track this uid, or null to switch the thread off entirely. */
    setUid(next) {
      uid = next || null;
      if (!uid) { path.setAttribute('d', ''); }
      rescan();
    },
    /** Call when the message list changes. */
    refresh: rescan,
    start() {
      if (running) return;
      running = true;
      path.setAttribute('stroke', color);
      box.addEventListener('scroll', onScroll, { passive: true });
      // ⚠ Reduced motion still DRAWS the thread — it is a wayfinding aid, not
      // decoration. What it drops is the dash animation, handled in CSS.
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      box.removeEventListener('scroll', onScroll);
      if (io) { observed.forEach((n) => io.unobserve(n)); io.disconnect(); }
      observed = [];
      path.setAttribute('d', '');
    },
    /**
     * Draw one frame synchronously, bypassing rAF.
     *
     * ⚠ THIS EXISTS SO THE COST CAN BE MEASURED AT ALL. rAF is throttled to a
     * stop in a background or unfocused tab, so any benchmark that awaits it
     * hangs rather than reporting — which is exactly what happened on the first
     * Phase A run. Measuring the DRAW directly is also the better question:
     * "what does one frame of this cost" is deterministic, where frames-per-
     * second depends on whatever else the machine is doing.
     */
    drawNow: () => draw(),
    /** Harness only: proves the rect budget and the node cap. */
    stats: () => ({ tracked: observed.length, rectReads, uid }),
    resetStats() { rectReads = 0; },
  };
}
