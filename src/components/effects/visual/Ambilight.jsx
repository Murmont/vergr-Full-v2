// AMBILIGHT — the content's own colour, thrown into the page around it.
//
// Used behind profile banners (image and video) and behind video throughout the
// app. Unlocked on the VP ladder; the level check lives in the registry, never
// here (see effects/README.md).
//
// ── THE TECHNIQUE, AND WHY THE FIRST VERSION LOOKED CHEAP ────────────
//
// Reference: https://www.smashingmagazine.com/2023/07/recreating-youtube-ambient-mode-glow-effect/
//
// The whole effect is FOUR things, and getting any of them wrong turns it into
// "a blurry copy behind the video", which is the failure mode:
//
//   1. THE CANVAS IS TINY. 10x6. Not 32x18, not 64x36. Downscaling that far is
//      not an optimisation, it IS the effect: it throws away every detail and
//      keeps only the dominant colours, so the upscale is huge soft fields of
//      colour rather than a recognisable smeared frame. The first version used
//      32x18 and you could still make out the picture, which is why it read as
//      a blurred photo.
//
//   2. THE BLUR IS APPLIED AT SOURCE SCALE, via `ctx.filter` BEFORE drawImage,
//      not with CSS on the result. A 1px blur on a 10px-wide canvas covers a
//      tenth of the image; the same 1px after upscaling covers nothing. This is
//      the difference between colours that bleed into each other and colours
//      that sit in blocks.
//
//   3. THE CANVAS IS BIGGER THAN THE CONTENT AND THE CONTENT SITS INSIDE IT.
//      The light has to occupy the space AROUND the banner. The first version
//      drew four separate strips along the edges, which is a fabrication — it
//      cannot produce a corner, so it always reads as four gradients meeting.
//
//   4. THE EDGES ARE FEATHERED WITH AN INSET SHADOW in the page colour, so the
//      glow dies before it reaches its own boundary. Without this you see the
//      rectangle instead of the light. (Same rule as every other surface in
//      this app: "a recess must fade to zero BEFORE it reaches an edge".)
//
// ── A CONSEQUENCE WORTH NOTING ──────────────────────────────────────
//
// Doing it correctly REMOVED the whole CORS problem. The first version read
// pixels back with `getImageData` to compute per-edge colours, which taints on
// cross-origin media and needed a cache-busting query param to work around.
// `drawImage` has no such restriction — a tainted canvas draws fine, it just
// cannot be read. Since nothing is read any more, cdn.vergr.app media works
// with no crossOrigin attribute, no extra fetch, and no cache trickery.

import { useEffect, useRef, useState } from 'react';

// 10x6 is from the reference and is deliberate. See note 1 above: this is the
// effect, not a performance compromise. Raising it makes the result worse.
const SAMPLE_W = 10;
const SAMPLE_H = 6;

/**
 * Video sample rate. The reference uses requestAnimationFrame; at 10x6 with a
 * source-scale blur, consecutive frames are visually identical well below 60fps
 * and the difference is not perceivable. 12/sec keeps the colour responsive to
 * a cut while doing an eighth of the work.
 */
const VIDEO_FPS = 12;

/**
 * @param {object}  props
 * @param {string}  props.src        image URL (banners, posters)
 * @param {React.RefObject} props.videoRef  a <video> to sample live
 * @param {boolean} props.enabled    off = renders nothing at all
 * @param {number}  props.spread     how far past the content the light reaches, px
 * @param {number}  props.intensity  0-1 opacity of the glow
 * @param {string}  props.feather    colour the glow dissolves into (the page)
 * @param {string}  props.className
 */
export default function Ambilight({
  src,
  videoRef,
  enabled = true,
  spread = 120,
  intensity = 0.55,
  // Pass `false` to omit the feather entirely. Required when the effect sits
  // behind a card that already clips its own corners: an inset shadow there
  // paints a dark ring inside the card instead of softening an outer edge.
  feather = '#000000',
  // How far the glow box extends past its parent, in px. The parent must be
  // sized to the MEDIA, and an ancestor must clip (see the inset note below).
  //
  // ⚠ 0 means "fill the parent exactly" and is only correct when the parent IS
  // the reserved space. Filling a whole POST CARD with it was wrong: a 16:9
  // sample stretched over a tall card loses the media's shape and floods the
  // entire card with colour. The glow has to keep a resemblance of the source.
  bleed = 0,
  // Per-axis overrides of `bleed`, in px. The feed passes bleedY={0}: light
  // above or below a post's media lands on its author line and its like row.
  bleedX = null,
  bleedY = null,
  // Fade the glow to nothing at every edge of its own box with a mask, and clip
  // the blur to that box. Without it the glow ends wherever an ancestor's
  // overflow clip happens to be, which draws a hard line (measured on the feed,
  // 2026-09-14: a straight vertical edge at the card's left side).
  edgeFade = false,
  // 'bottom' = the profile shape: the layer fills the banner + header + stats
  // block, CLIPS its own blur, and fades to transparent at the bottom with a
  // mask. No feather colour is involved at all, so it can never disagree with
  // the page behind it.
  //
  // ⚠ WHY THIS EXISTS. The profiles used a fixed 340/400/470px box with a
  // `#000000` feather. Measured on the phone (2026-09-14): the feather painted a
  // solid black slab over the #0B0B14 page, ended in a hard edge exactly at
  // 340px, and that edge cut through the Followers / Following / Likes numbers.
  // The canvas blur was not clipped either, so the only colour visible was the
  // part that leaked BELOW the black. A mask fades light into whatever is
  // behind it; a feather has to guess the colour, and it guessed wrong.
  fade = null,
  className = '',
}) {
  const canvasRef = useRef(null);
  const timerRef = useRef(0);

  // ── BLUR IS DERIVED FROM CELL SIZE, NEVER HARDCODED ────────────────
  //
  // The canvas is 10 cells wide. Rendered across a ~1060px card that is ~106px
  // PER CELL, and the previous fixed 28px blur could not blend them — what you
  // saw was bilinear interpolation between 10 samples, which reads as
  // pixelation. The blur has to be a function of the rendered width.
  //
  // 0.75 x cell width is the smallest multiplier that removed visible banding
  // when measured; below ~0.6 the cell edges return.
  const [blurPx, setBlurPx] = useState(28);
  const layerRef = useRef(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const el = layerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect?.width || 0;
      if (w > 0) setBlurPx(Math.round((w / SAMPLE_W) * 0.75));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);

  useEffect(() => {
    // Rule 2 in effects/README.md: off means no canvas, no timer, no listener.
    if (!enabled) return undefined;

    const canvas = canvasRef.current;
    if (!canvas || (!src && !videoRef?.current)) return undefined;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;

    let stopped = false;

    const draw = (node) => {
      if (stopped || !node) return;
      try {
        // Note 2: the blur happens HERE, at 10x6, before the upscale. Set on
        // every draw because a video loop can be interrupted by a context reset.
        ctx.filter = 'blur(1px)';
        ctx.drawImage(node, 0, 0, SAMPLE_W, SAMPLE_H);
      } catch {
        // A <video> with no frame yet or an <img> mid-decode. Both transient.
      }
    };

    // ── VIDEO: sample the live element in place ──────────────────────
    const video = videoRef?.current;
    if (video) {
      const tick = () => { draw(video); timerRef.current = setTimeout(tick, 1000 / VIDEO_FPS); };
      if (video.readyState >= 2) tick();
      else video.addEventListener('loadeddata', tick, { once: true });
      return () => { stopped = true; clearTimeout(timerRef.current); };
    }

    // ── IMAGE: drawn once. A still frame cannot change. ──────────────
    //
    // No crossOrigin, no cache-buster, no second fetch: nothing reads the
    // canvas back, so tainting is irrelevant. The browser already has these
    // bytes from the visible <img>, so this costs a decode and no network.
    const img = new Image();
    img.onload = () => draw(img);
    img.src = src;
    return () => { stopped = true; img.onload = null; };
  }, [enabled, src, videoRef]);

  if (!enabled) return null;

  const fadeBottom = fade === 'bottom';
  // Solid for the top 40% (the banner hides most of it), then falls to nothing
  // by the bottom of the block, so no edge is ever drawn.
  const fadeMask = 'linear-gradient(to bottom, #000 0%, #000 40%, rgba(0,0,0,0.55) 70%, transparent 100%)';

  const bx = bleedX ?? bleed;
  const by = bleedY ?? bleed;
  // Full strength at the media's edge, zero at the box's edge. With no vertical
  // bleed the top and bottom fade inside the media's own height instead, so the
  // light never has a corner.
  const edgeMask = edgeFade
    ? `linear-gradient(to right, transparent 0, #000 ${bx}px, #000 calc(100% - ${bx}px), transparent 100%), `
      + `linear-gradient(to bottom, transparent 0, #000 ${by > 0 ? `${by}px` : '18%'}, #000 ${by > 0 ? `calc(100% - ${by}px)` : '82%'}, transparent 100%)`
    : null;
  const clipped = fadeBottom || !!edgeMask;

  return (
    <div
      aria-hidden
      ref={layerRef}
      className={className}
      style={{
        ...(fadeBottom ? { overflow: 'hidden', WebkitMaskImage: fadeMask, maskImage: fadeMask } : {}),
        // Two mask layers INTERSECTED: `source-in` is the prefixed spelling the
        // Android WebView reads, `intersect` the standard one.
        ...(edgeMask ? { overflow: 'hidden', WebkitMaskImage: edgeMask, maskImage: edgeMask, WebkitMaskComposite: 'source-in', maskComposite: 'intersect' } : {}),
        // ⚠ `inset: 0`, NEVER a negative inset.
        //
        // The first version used `inset: -spread` so the glow would extend past
        // its own box. That is why it washed the post text above a video and the
        // link card below it: an absolutely-positioned layer that reaches
        // outside its parent covers whatever in-flow siblings are there, and
        // `isolation: isolate` on the wrapper makes the whole thing paint as one
        // unit above preceding siblings.
        //
        // Two legitimate shapes, and only two:
        //
        //   bleed = 0   the parent IS the reserved space (a padded box). The
        //               glow fills it exactly and cannot escape.
        //   bleed > 0   the parent is the MEDIA, and the glow extends past it
        //               by `bleed` on every side, keeping the media's aspect
        //               ratio. An ANCESTOR MUST CLIP (the post card sets
        //               `overflow: hidden`), so it still cannot reach a sibling
        //               card — the containment comes from the clip instead of
        //               from padding.
        //
        // What is never correct is stretching the glow across a container of a
        // different shape from the source. A 16:9 frame sampled into a tall
        // card produces a wash with no resemblance to the media.
        position: 'absolute',
        inset: `${-by}px ${-bx}px`,
        zIndex: -1,
        pointerEvents: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          // Clipped mode: the canvas overhangs its box by one blur radius so
          // the blur does not fade to transparent at the box's own edges.
          ...(clipped
            ? { position: 'absolute', left: -blurPx, top: -blurPx, width: `calc(100% + ${blurPx * 2}px)`, height: `calc(100% + ${blurPx * 2}px)` }
            : { width: '100%', height: '100%' }),
          display: 'block',
          opacity: intensity,
          // Scaled to the rendered cell size by the ResizeObserver above, never
          // a constant. A fixed blur is why the first version looked pixelated.
          filter: `blur(${blurPx}px) saturate(1.45)`,
        }}
      />
      {/* Feather: an inset shadow in the page colour so the glow falls to
          nothing before its own boundary and the eye reads light rather than a
          rectangle. Omitted when `feather === false` — behind a card that
          already clips its corners it would paint a dark ring INSIDE the card,
          which is the "darkened border" that got the first version rejected. */}
      {feather !== false && !clipped && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            boxShadow: `inset 0 0 ${Math.round(spread * 0.7)}px ${Math.round(spread * 0.8)}px ${feather}`,
          }}
        />
      )}
    </div>
  );
}
