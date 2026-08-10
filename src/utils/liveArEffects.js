// Live AR camera effects for the stream compositor (AR plan P4).
//
// MediaPipe Tasks ImageSegmenter (WASM + GPU) running IN the page — the same
// model family the native AR camera uses (ML Kit selfie segmentation is
// MediaPipe underneath, verified: its runtime ships as mediapipe-internal).
// Everything runs on-device; the wasm runtime and the model are SELF-HOSTED
// under public/mediapipe/ because the native shell's CSP has no CDN exceptions
// and the zero-cost rule means no new external runtime dependencies.
//
// Design constraints, in order:
//   1. The stream must NEVER break because of an effect. Every path falls back
//      to drawing the plain camera; a load failure just means "no effects".
//   2. The encode path stays untouched — effects draw into the compositor's
//      existing canvas, so ingest/R2/CDN/viewers see ordinary frames and the
//      server cost of an effect is exactly zero.
//   3. Segmentation runs at a REDUCED cadence (~15fps) while video draws at
//      full rate — a person's outline moves slowly relative to framerate, and
//      halving the model rate is the difference between smooth and choppy on
//      mid-range phones.

import { LIVE_MASKS, drawMaskMesh, estimateYaw, loadMaskMesh } from './liveMaskMesh';
// maskRenderer3d pulls in three.js (~477KB). It is imported DYNAMICALLY so
// that weight only lands when a mask is actually selected — which cannot
// happen while MASKS_ENABLED is false, so today it never ships to a user.
import { MASKS_ENABLED } from './featureFlags';

let segmenterPromise = null;
let landmarkerPromise = null;

/**
 * Face landmarks for live masks. Loaded ONLY when a mask is actually selected —
 * the model is ~3.8MB and most streams never wear one, so paying for it up
 * front would slow every go-live for a minority feature.
 */
async function loadLandmarker() {
  const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
  });
}

/**
 * Colour looks for live, mirroring the native "Looks" category.
 *
 * Canvas filters rather than shaders on purpose: these are per-frame CSS filter
 * strings the browser runs on the GPU, they cost nothing to add, and they need
 * no extra model or asset. The native side gets the equivalent from GPUPixel.
 */
export const LIVE_LOOKS = {
  none: '',
  warm: 'sepia(0.35) saturate(1.25) hue-rotate(-8deg)',
  vivid: 'saturate(1.6) contrast(1.08)',
  bright: 'brightness(1.18) saturate(1.1)',
  punch: 'contrast(1.35) saturate(1.15)',
  cool: 'hue-rotate(12deg) saturate(1.15) brightness(1.04)',
  mono: 'grayscale(1) contrast(1.15)',
  faded: 'contrast(0.88) saturate(0.75) brightness(1.08)',
  sepia: 'sepia(0.75) saturate(0.9) contrast(1.05)',
  noir: 'grayscale(1) contrast(1.5) brightness(0.92)',
};

async function loadSegmenter() {
  const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  return ImageSegmenter.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: '/mediapipe/selfie_segmenter.tflite',
      // GPU delegate where available; MediaPipe falls back to CPU itself.
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
}

/** Camera-layer effect modes, mirroring the native AR camera's set. */
export const LIVE_CAM_EFFECTS = ['none', 'blur', 'violet', 'studio'];

export function createCameraEffect() {
  let segmenter = null;
  let failed = false;
  let personIdx = -1;

  // Person cutout at VIDEO resolution, so the caller can draw it with the
  // exact same transform as the raw video (perfect registration).
  const person = document.createElement('canvas');
  const pctx = person.getContext('2d');
  const maskC = document.createElement('canvas');
  const mctx = maskC.getContext('2d');
  let maskData = null;
  let lastMaskAt = 0;
  let lastTs = 0;

  // Mask state. Kept beside the segmenter so one object owns the whole camera
  // effect surface and the compositor has a single thing to talk to.
  let landmarker = null;
  let maskKey = 'none';
  let maskMesh = null;
  let maskEyes = null; // {left,right,centreX,width} in VIDEO pixels
  let mask3d = null;     // WebGL mask renderer (maskRenderer3d), lazily created
  let mask3dKeys = null; // masks the 3D renderer covers, filled on first load
  let lastLmAt = 0;
  let lastLmTs = 0;

  const ensureMask = (key) => {
    if (key === maskKey) return;
    maskKey = key;
    maskMesh = null;
    maskEyes = null;
    // Textured WebGL path, loaded on first mask selection so a session that
    // never opens a mask pays neither the three.js download nor a GL context.
    if (MASKS_ENABLED && key !== 'none') {
      import('./maskRenderer3d').then(({ MASKS_3D, createMaskRenderer }) => {
        if (maskKey !== key) return;        // superseded while loading
        if (!MASKS_3D[key]) return;         // not migrated: flat path handles it
        mask3dKeys = new Set(Object.keys(MASKS_3D).filter((k) => MASKS_3D[k]));
        if (!mask3d) mask3d = createMaskRenderer();
        if (mask3d) mask3d.setMask(key);
      }).catch(() => { /* falls back to the flat path */ });
    } else if (mask3d) {
      mask3d.setMask('none');
    }
    const def = LIVE_MASKS[key];
    if (!def) return;
    if (!landmarkerPromise) landmarkerPromise = loadLandmarker();
    landmarkerPromise.then((l) => { landmarker = l; }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[liveArEffects] face landmarker unavailable:', e?.message || e);
    });
    loadMaskMesh(def.url).then((m) => { if (maskKey === key) maskMesh = m; });
  };

  /**
   * Eye anchors from the face landmarker, on the same reduced cadence as
   * segmentation. MediaPipe's canonical indices: 33 = outer right eye corner,
   * 263 = outer left, 133/362 the inner corners. Averaging the pair per eye is
   * steadier than any single point.
   */
  const updateFace = (video) => {
    if (!landmarker) return;
    const now = performance.now();
    if (now - lastLmAt < 66) return;
    lastLmAt = now;
    const ts = Math.max(now, lastLmTs + 1);
    lastLmTs = ts;
    let res;
    try { res = landmarker.detectForVideo(video, ts); } catch { return; }
    const lm = res?.faceLandmarks?.[0];
    if (!lm) { maskEyes = null; return; }
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const pt = (i) => ({ x: lm[i].x * vw, y: lm[i].y * vh });
    const r1 = pt(33), r2 = pt(133);
    const l1 = pt(263), l2 = pt(362);
    // Landmarks are normalised, so face width comes from the extremes (234/454
    // are the cheek edges) rather than assuming a fixed proportion.
    const cheekL = pt(234), cheekR = pt(454);
    maskEyes = {
      // "left"/"right" here mean left/right ON SCREEN, which is what the
      // renderer's roll calculation expects.
      left: { x: (r1.x + r2.x) / 2, y: (r1.y + r2.y) / 2 },
      right: { x: (l1.x + l2.x) / 2, y: (l1.y + l2.y) / 2 },
      centreX: (cheekL.x + cheekR.x) / 2,
      width: Math.abs(cheekR.x - cheekL.x),
    };
  };

  const ensure = () => {
    if (segmenter || failed) return;
    if (!segmenterPromise) segmenterPromise = loadSegmenter();
    segmenterPromise
      .then((s) => {
        segmenter = s;
        // The confidence-mask index for "person" comes from the model's OWN
        // labels, not a hardcoded guess — an inverted mask (background where
        // the person should be) is the classic silent failure here.
        try {
          const labels = s.getLabels?.() || [];
          personIdx = labels.findIndex((l) => /self|person|fore/i.test(String(l)));
        } catch { personIdx = -1; }
      })
      .catch((e) => {
        failed = true;
        // eslint-disable-next-line no-console
        console.warn('[liveArEffects] segmenter load failed:', e?.message || e);
      });
  };

  const isReady = () => !!segmenter && !failed;

  const updateMask = (video) => {
    const now = performance.now();
    if (now - lastMaskAt < 66) return; // model at ~15fps, video at full rate
    lastMaskAt = now;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    // segmentForVideo requires strictly increasing timestamps.
    const ts = Math.max(now, lastTs + 1);
    lastTs = ts;
    let res;
    try { res = segmenter.segmentForVideo(video, ts); } catch { return; }
    try {
      const masks = res.confidenceMasks || [];
      const m = masks[(personIdx >= 0 && personIdx < masks.length) ? personIdx : masks.length - 1];
      if (!m) return;
      const mw = m.width;
      const mh = m.height;
      const conf = m.getAsFloat32Array();
      if (maskC.width !== mw || maskC.height !== mh || !maskData) {
        maskC.width = mw;
        maskC.height = mh;
        maskData = mctx.createImageData(mw, mh);
      }
      const d = maskData.data;
      for (let i = 0; i < conf.length; i++) d[i * 4 + 3] = (conf[i] * 255) | 0;
      mctx.putImageData(maskData, 0, 0);

      if (person.width !== vw || person.height !== vh) {
        person.width = vw;
        person.height = vh;
      }
      pctx.clearRect(0, 0, vw, vh);
      pctx.drawImage(video, 0, 0, vw, vh);
      pctx.globalCompositeOperation = 'destination-in';
      pctx.drawImage(maskC, 0, 0, vw, vh);
      pctx.globalCompositeOperation = 'source-over';
    } finally {
      // MPMask holds GPU/WASM memory — freeing it per frame is not optional.
      try { res?.close?.(); } catch { /* already freed */ }
    }
  };

  /**
   * Draw the camera into [rx,ry,rw,rh] with the given background effect.
   * COVER-fit for both background and person — identical transform, so the
   * cutout registers pixel-perfectly on its own background. Falls back to a
   * plain draw until the first mask exists, so enabling an effect never
   * blanks the camera while the model warms up.
   */
  const draw = (ctx, video, rx, ry, rw, rh, fx) => {
    // Accepts either the legacy background string or a full effect object, so
    // an older caller cannot break when it passes just 'blur'.
    const cfg = typeof fx === 'string' ? { bg: fx } : (fx || {});
    const bg = cfg.bg || 'none';
    const lookCss = LIVE_LOOKS[cfg.look] || '';
    const maskDef = LIVE_MASKS[cfg.mask] || null;
    ensureMask(maskDef ? cfg.mask : 'none');

    if (bg !== 'none') { try { updateMask(video); } catch { /* keep drawing */ } }
    if (maskDef) { try { updateFace(video); } catch { /* keep drawing */ } }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    const scale = Math.max(rw / vw, rh / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = rx + (rw - dw) / 2;
    const dy = ry + (rh - dh) / 2;

    // Masks are positioned in VIDEO pixels, so they ride the same cover-fit
    // transform as the image itself — anything else drifts as the frame resizes.
    const toCanvas = (p) => ({ x: dx + p.x * scale, y: dy + p.y * scale });

    const paintMask = () => {
      if (!maskEyes) return;

      // Textured WebGL path. Preferred whenever the mask has a 3D entry and a
      // GL context was obtained; the flat Canvas 2D path below is the fallback
      // for devices without WebGL, and for any mask not yet migrated.
      if (mask3d && mask3dKeys?.has(cfg.mask)) {
        const L0 = toCanvas(maskEyes.left);
        const R0 = toCanvas(maskEyes.right);
        const yaw = estimateYaw(
          dx + maskEyes.centreX * scale, maskEyes.width * scale, (L0.x + R0.x) / 2,
        );
        mask3d.resize(ctx.canvas.width, ctx.canvas.height);
        const out = mask3d.render(L0, R0, yaw);
        if (out) { ctx.drawImage(out, 0, 0); return; }
        // render() returns null until the mesh finishes loading — fall through
        // so the first frames are not blank.
      }

      if (!maskDef || !maskMesh) return;
      const L0 = toCanvas(maskEyes.left);
      const R0 = toCanvas(maskEyes.right);
      const ex = R0.x - L0.x;
      const ey = R0.y - L0.y;
      const d = Math.hypot(ex, ey) || 1;
      // Unit vectors along and perpendicular to the eye line, so every offset
      // follows head ROLL rather than being screen-aligned.
      const ux = ex / d, uy = ey / d;
      const px = -uy, py = ux;
      const place = (dx, dy) => {
        const ox = ux * dx + px * -dy;
        const oy = uy * dx + py * -dy;
        return [{ x: L0.x + ox, y: L0.y + oy }, { x: R0.x + ox, y: R0.y + oy }];
      };
      const yawFor = (L, R) => estimateYaw(
        dx + maskEyes.centreX * scale, maskEyes.width * scale, (L.x + R.x) / 2,
      );
      try {
        const n = maskDef.repeat || 1;
        if (n > 1) {
          // Swarm: arc above the head, alternating size so it reads as depth
          // instead of a row of identical stamps.
          for (let i = 0; i < n; i++) {
            const t = (i / (n - 1)) * 2 - 1;
            const [L, R] = place(t * d * 1.5, (maskDef.lift + 0.35 * (1 - t * t)) * d);
            const sc = maskDef.widthMul * (0.75 + 0.35 * (1 - Math.abs(t)));
            drawMaskMesh(ctx, maskMesh, L, R, yawFor(L, R) + t * 0.5, sc, maskDef.rgb, maskDef.env);
          }
        } else {
          const [L, R] = place((maskDef.offX || 0) * d, (maskDef.lift || 0) * d);
          drawMaskMesh(ctx, maskMesh, L, R, yawFor(L, R), maskDef.widthMul, maskDef.rgb, maskDef.env);
        }
      } catch { /* cosmetic */ }
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(rx, ry, rw, rh);
    ctx.clip();

    if (bg === 'none' || person.width === 0) {
      // No background effect, or no cutout yet: plain camera, never a blank
      // frame. The look still applies, and the mask still sits on top.
      if (lookCss) ctx.filter = lookCss;
      try { ctx.drawImage(video, dx, dy, dw, dh); } catch { /* not ready */ }
      ctx.filter = 'none';
      paintMask();
      ctx.restore();
      return;
    }

    if (bg === 'blur') {
      ctx.filter = `blur(${Math.max(8, Math.round(rh * 0.02))}px)`;
      try { ctx.drawImage(video, dx, dy, dw, dh); } catch { /* not ready */ }
      ctx.filter = 'none';
    } else if (bg === 'violet') {
      const g = ctx.createLinearGradient(rx, ry, rx + rw, ry + rh);
      g.addColorStop(0, '#7B1FFF');
      g.addColorStop(1, '#C87FFF');
      ctx.fillStyle = g;
      ctx.fillRect(rx, ry, rw, rh);
    } else if (bg === 'studio') {
      const g = ctx.createLinearGradient(rx, ry, rx, ry + rh);
      g.addColorStop(0, '#14141F');
      g.addColorStop(1, '#000000');
      ctx.fillStyle = g;
      ctx.fillRect(rx, ry, rw, rh);
    }

    // The look grades the PERSON only, so a replaced background keeps its own
    // colour instead of being tinted along with them.
    if (lookCss) ctx.filter = lookCss;
    try { ctx.drawImage(person, dx, dy, dw, dh); } catch { /* not ready */ }
    ctx.filter = 'none';
    paintMask();
    ctx.restore();
  };

  // The segmenter itself is a module-level singleton (loading the wasm twice
  // would double memory); instances only own their canvases, which the GC takes.
  const dispose = () => { /* nothing instance-owned to free */ };

  return { ensure, isReady, draw, dispose };
}
