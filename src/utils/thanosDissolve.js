/**
 * Google Thanos-Snap dissolve.
 *
 * html2canvas is dynamically imported so its cost is only paid the first time
 * a user deletes a message (not on initial app load).
 *
 * Design notes (why it looks the way it does):
 *  - The raster snapshot, the pixel bucketing, and the dust-canvas creation all
 *    happen while the ORIGINAL element is still fully visible. Only in the final
 *    synchronous step do we append the dust AND hide the original in the same
 *    frame — so there's no "element blinks invisible, THEN dust appears" gap.
 *  - Scale is capped (not raw devicePixelRatio) so the Android System WebView
 *    doesn't choke on a huge canvas × many buckets, which made the effect fail
 *    silently on native (message just vanished with no animation).
 *  - dissolveElement returns a boolean: true if the dust animation is running,
 *    false if the raster path failed — the caller then plays a CSS fallback so
 *    native never degrades to an instant disappear.
 */

const CANVAS_COUNT = 24;      // fewer buckets = faster + lighter on mobile
const MAX_SNAPSHOT_PX = 900;  // clamp the longest edge of the raster snapshot

/**
 * Weighted random distribution — the Google Thanos snap formula. Biases a
 * pixel toward `peak`, giving the "crumble from one side" sweep.
 */
function weightedRandomDistrib(peak) {
  const prob = [];
  for (let i = 0; i < CANVAS_COUNT; i++) {
    prob.push(Math.pow(CANVAS_COUNT - Math.abs(peak - i), 3));
  }
  const total = prob.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < CANVAS_COUNT; i++) {
    r -= prob[i];
    if (r <= 0) return i;
  }
  return CANVAS_COUNT - 1;
}

function newCanvasFromImageData(pixelArray, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').putImageData(new ImageData(pixelArray, w, h), 0, 0);
  return canvas;
}

function animateDustCanvas(canvas, index) {
  const tx = 55 + Math.random() * 75;               // drift right
  const ty = -45 + Math.random() * 90;              // random vertical
  const rot = -22 + Math.random() * 44;             // slight rotation
  const delay = index * 9;                          // stagger per layer
  const duration = 420 + index * 14;                // ~750ms for the last layer

  canvas.style.transition =
    `transform ${duration}ms cubic-bezier(0.4,0,1,1) ${delay}ms, opacity ${duration}ms ease-in ${delay}ms`;
  canvas.getBoundingClientRect(); // force reflow so the transition registers
  canvas.style.transform = `rotate(${rot}deg) translate(${tx}px, ${ty}px)`;
  canvas.style.opacity = '0';

  return new Promise((resolve) => {
    setTimeout(() => { canvas.remove(); resolve(); }, delay + duration + 40);
  });
}

let html2canvasPromise = null;
function loadHtml2canvas() {
  if (!html2canvasPromise) {
    html2canvasPromise = import('html2canvas').then((m) => m.default || m);
  }
  return html2canvasPromise;
}

/**
 * Warm the html2canvas import ahead of the first delete. Safe to call often.
 */
export function preloadThanosDissolve() {
  loadHtml2canvas().catch(() => { html2canvasPromise = null; });
}

/**
 * CSS-only fallback: a smooth "crumble away" (fade + blur + shrink + rise).
 * Used when the raster snapshot can't run (some WebViews) so a delete is never
 * a jarring instant blip. Resolves when the animation finishes.
 */
export function cssShatterFallback(el) {
  if (!el || !el.animate) return Promise.resolve();
  try {
    const anim = el.animate(
      [
        { opacity: 1, filter: 'blur(0px)', transform: 'scale(1) translateY(0)' },
        { opacity: 0, filter: 'blur(7px)', transform: 'scale(0.72) translateY(-16px)' },
      ],
      { duration: 380, easing: 'cubic-bezier(0.4,0,1,1)', fill: 'forwards' }
    );
    return anim.finished.catch(() => {});
  } catch {
    el.style.opacity = '0';
    return Promise.resolve();
  }
}

/**
 * Dissolve a DOM element using the Thanos-snap algorithm.
 *
 * @param {HTMLElement} el
 * @returns {Promise<boolean>} true if the dust animation is live on screen,
 *   false if the raster path failed (caller should run cssShatterFallback).
 */
export async function dissolveElement(el) {
  if (!el || !el.getBoundingClientRect) return false;

  let html2canvas;
  try {
    html2canvas = await loadHtml2canvas();
  } catch {
    html2canvasPromise = null;
    return false;
  }

  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;

  // Cap the raster resolution: enough to look sharp, small enough that the
  // WebView can allocate CANVAS_COUNT copies without stalling or OOMing.
  const longest = Math.max(rect.width, rect.height);
  const scale = Math.min(window.devicePixelRatio || 1, 1.5, MAX_SNAPSHOT_PX / longest);

  let snapshot;
  try {
    snapshot = await html2canvas(el, {
      scale,
      useCORS: true,
      backgroundColor: null,
      logging: false,
      imageTimeout: 1500,
    });
  } catch {
    return false; // caller runs the CSS fallback
  }
  if (!snapshot || !snapshot.width || !snapshot.height) return false;

  const w = snapshot.width;
  const h = snapshot.height;

  let rawPixels;
  try {
    rawPixels = snapshot.getContext('2d').getImageData(0, 0, w, h).data;
  } catch {
    return false;
  }

  // Distribute pixels across the buckets (all work done while `el` is visible).
  const buckets = [];
  for (let i = 0; i < CANVAS_COUNT; i++) buckets.push(new Uint8ClampedArray(rawPixels.length));
  for (let i = 0; i < rawPixels.length; i += 4) {
    const peak = Math.floor((i / rawPixels.length) * CANVAS_COUNT);
    const b = buckets[weightedRandomDistrib(peak)];
    b[i] = rawPixels[i]; b[i + 1] = rawPixels[i + 1]; b[i + 2] = rawPixels[i + 2]; b[i + 3] = rawPixels[i + 3];
  }

  // Viewport-clamped stage (fixed + contain:strict) so the transformed dust
  // canvases can't extend the document scroll area / scroll-anchor the page.
  const stage = document.createElement('div');
  stage.style.cssText = 'position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:9999;contain:strict;';

  const dust = [];
  for (let i = 0; i < CANVAS_COUNT; i++) {
    const c = newCanvasFromImageData(buckets[i], w, h);
    c.style.cssText =
      `position:absolute;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;` +
      'pointer-events:none;opacity:1;transform:none;will-change:transform,opacity;';
    stage.appendChild(c);
    dust.push(c);
  }

  // FINAL synchronous step: reveal the dust AND hide the original together so
  // there is no visible gap (the "blink then dust" bug).
  document.body.appendChild(stage);
  el.style.opacity = '0';
  el.style.pointerEvents = 'none';

  // Drift + fade runs in the background; the stage self-cleans when done.
  Promise.all(dust.map((c, i) => animateDustCanvas(c, i)))
    .then(() => stage.remove())
    .catch(() => stage.remove());

  return true;
}
