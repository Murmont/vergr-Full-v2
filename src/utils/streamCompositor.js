// Browser-ingest stream compositor (multi-layer).
//
// Why this exists: MediaRecorder (the engine behind browser fMP4 ingest, see
// streamIngest.js) binds to ONE MediaStream at construction and, per spec,
// ignores tracks added/removed after start(). And getDisplayMedia captures at
// full desktop resolution (1440p/4K), which exceeds the H.264 decode level on
// most phones. So we record from a FIXED-size <canvas>: a requestAnimationFrame
// loop composites the current layout (camera, screen, or both) into the canvas
// with object-fit:contain (WYSIWYG, never cropped), audio is mixed through one
// AudioContext, and the recorded track set never changes. The layout is BAKED
// into the single encoded canvas, so every viewer (desktop/tablet/phone/native)
// renders one video with no per-device layout logic — PiP/side-by-side "just
// work" everywhere.
//
// Layouts (setLayout):
//   'camera'          full-frame camera
//   'screen'          full-frame screen/game
//   'screen_cam_pip'  screen full + camera in a corner (the Twitch layout)
//   'cam_screen_pip'  camera full + screen in a corner
//   'side_by_side'    screen (~68%) beside camera (~32%)
// Scenes (setScene): a solid card with title/subtitle (Starting soon / BRB /
//   Ending) drawn instead of video.

import { createCameraEffect, LIVE_LOOKS } from './liveArEffects';
import { LIVE_MASKS } from './liveMaskMesh';
import { MASKS_ENABLED } from './featureFlags';

const LIVE_CAM_FX = ['none', 'blur', 'violet', 'studio'];
const PLAN_SHORT_EDGE = { free: 480, lite: 720, pro: 1080 };

function planKey(plan) {
  const p = typeof plan === 'string' ? plan : plan?.tier;
  return PLAN_SHORT_EDGE[p] ? p : 'free';
}
function even(n) { return Math.max(2, Math.round(n / 2) * 2); }

// Canvas dimensions. 'landscape' = 16:9 at the plan cap (height=cap); 'portrait'
// = 9:16 (width=cap); 'source' = follow the seed source (legacy single-layer).
function canvasSize(source, plan, aspect) {
  const cap = PLAN_SHORT_EDGE[planKey(plan)];
  if (aspect === 'landscape') return { width: even(cap * 16 / 9), height: even(cap) };
  if (aspect === 'portrait') return { width: even(cap), height: even(cap * 16 / 9) };
  const track = source?.getVideoTracks?.()[0];
  const s = track?.getSettings?.() || {};
  let w = s.width || 1280, h = s.height || 720;
  const shortEdge = Math.min(w, h);
  if (shortEdge > cap) { const k = cap / shortEdge; w *= k; h *= k; }
  return { width: even(w), height: even(h) };
}

/**
 * @param {object} opts
 * @param {MediaStream} opts.source  Initial camera+mic stream.
 * @param {string|object} [opts.plan]
 * @param {number} [opts.fps]
 * @param {'landscape'|'portrait'|'source'} [opts.aspect]
 * @param {string} [opts.layout]  initial layout (default 'camera')
 */
export function createStreamCompositor({ source, plan = 'free', fps = 30, aspect = 'source', layout = 'camera' }) {
  const { width, height } = canvasSize(source, plan, aspect);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  // Two source <video> layers, each holding its own track.
  const mkVideo = () => { const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.autoplay = true; return v; };
  const camVideo = mkVideo();
  const screenVideo = mkVideo();

  let mode = layout;
  let pipCorner = 'br';     // br | bl | tr | tl
  let pipScale = 0.28;      // PiP width as a fraction of canvas width
  let scene = null;         // { title, subtitle } or null
  // Camera-layer AR effect (P4): 'none' | 'blur' | 'violet' | 'studio'.
  // The segmenter loads lazily on first enable; until it's ready (or if it
  // fails) drawCamera falls back to the plain camera — an effect can never
  // break the stream.
  let camFx = 'none';
  // Colour look + face mask ride alongside the background effect. They are
  // independent: a mask with no background effect, or a look on a plain camera,
  // are both normal combinations.
  let camLook = 'none';
  let camMask = 'none';
  let camEffect = null;
  /** Anything beyond a plain camera draw needs the effect module. */
  const camFxActive = () => camFx !== 'none' || camLook !== 'none' || camMask !== 'none';

  // captureStream(0) + requestFrame lets the congestion controller throttle the
  // encoder's input fps in real time without restarting MediaRecorder. Older
  // Safari has no requestFrame → fall back to fixed-rate capture.
  let canvasStream = canvas.captureStream(0);
  let canvasTrack = canvasStream.getVideoTracks()[0];
  const manualFrames = typeof canvasTrack.requestFrame === 'function';
  if (!manualFrames) {
    try { canvasStream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    canvasStream = canvas.captureStream(fps);
    canvasTrack = canvasStream.getVideoTracks()[0];
  }
  let targetFps = fps;
  const setTargetFps = (n) => {
    targetFps = Math.max(2, Math.min(60, n || fps));
    // Push the new cadence to the worker clock (no-op until the clock starts).
    try { frameWorker?.postMessage({ ms: Math.max(8, Math.round(1000 / targetFps)) }); } catch { /* noop */ }
  };

  // Works for <video> and <img> (incl. animated GIF, which paints its current
  // frame each draw).
  const dims = (el) => ({ w: el.videoWidth || el.naturalWidth || 0, h: el.videoHeight || el.naturalHeight || 0 });

  // Draw a source into a target rect. cover=false → object-fit:contain
  // (letterbox); cover=true → object-fit:cover (fill, crop) for scene art.
  const drawFit = (el, rx, ry, rw, rh, cover) => {
    const { w: vw, h: vh } = dims(el);
    if (!vw || !vh) return;
    const scale = cover ? Math.max(rw / vw, rh / vh) : Math.min(rw / vw, rh / vh);
    const dw = vw * scale, dh = vh * scale;
    const dx = rx + (rw - dw) / 2, dy = ry + (rh - dh) / 2;
    if (cover) { ctx.save(); ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip(); }
    try { ctx.drawImage(el, dx, dy, dw, dh); } catch { /* frame not ready */ }
    if (cover) ctx.restore();
  };
  const drawContain = (el, rx, ry, rw, rh) => drawFit(el, rx, ry, rw, rh, false);

  // Camera layer draw — effects when armed + ready, plain contain otherwise.
  const drawCamera = (rx, ry, rw, rh) => {
    // A look or a mask alone does NOT need the segmenter, so they must not wait
    // on isReady() — that gate is only about the background cutout.
    const needsSeg = camFx !== 'none';
    if (camFxActive() && camEffect && (!needsSeg || camEffect.isReady())) {
      try {
        camEffect.draw(ctx, camVideo, rx, ry, rw, rh, { bg: camFx, look: camLook, mask: camMask });
        return;
      } catch { /* fall through to the plain camera */ }
    }
    drawContain(camVideo, rx, ry, rw, rh);
  };

  const pipRect = () => {
    const w = Math.round(width * pipScale);
    const h = Math.round(w * 9 / 16);
    const m = Math.round(width * 0.018); // margin
    const x = pipCorner.includes('l') ? m : width - w - m;
    const y = pipCorner.includes('t') ? m : height - h - m;
    return { x, y, w, h };
  };

  const drawScene = () => {
    // Custom media scene (uploaded image / GIF / video) fills the frame.
    if (scene.media) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      drawFit(scene.media, 0, 0, width, height, true);
      // Optional caption over the media.
      if (scene.title) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `700 ${Math.round(height * 0.07)}px Syne, system-ui, sans-serif`;
        ctx.fillText(scene.title, width / 2, height - Math.round(height * 0.08));
      }
      return;
    }
    // Default text card.
    ctx.fillStyle = '#0B0B14';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#7B1FFF';
    ctx.fillRect(0, height - even(height * 0.012), width, even(height * 0.012));
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 ${Math.round(height * 0.09)}px Syne, system-ui, sans-serif`;
    ctx.fillText(scene.title || '', width / 2, height / 2);
    if (scene.subtitle) {
      ctx.fillStyle = '#9CA3AF';
      ctx.font = `400 ${Math.round(height * 0.04)}px "DM Sans", system-ui, sans-serif`;
      ctx.fillText(scene.subtitle, width / 2, height / 2 + Math.round(height * 0.085));
    }
  };

  let running = true;

  // One composite draw + frame emit. Cadence is driven by the clock below.
  const renderFrame = () => {
    if (!running) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    if (scene) { drawScene(); if (manualFrames) { try { canvasTrack.requestFrame(); } catch {} } return; }

    if (mode === 'camera') {
      drawCamera(0, 0, width, height);
    } else if (mode === 'screen') {
      drawContain(screenVideo, 0, 0, width, height);
    } else if (mode === 'side_by_side') {
      const lw = Math.round(width * 0.68);
      drawContain(screenVideo, 0, 0, lw, height);
      drawCamera(lw, 0, width - lw, height);
    } else if (mode === 'cam_screen_pip') {
      drawCamera(0, 0, width, height);
      const r = pipRect();
      ctx.fillStyle = '#000'; ctx.fillRect(r.x, r.y, r.w, r.h);
      drawContain(screenVideo, r.x, r.y, r.w, r.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2; ctx.strokeRect(r.x, r.y, r.w, r.h);
    } else { // screen_cam_pip (default composite)
      drawContain(screenVideo, 0, 0, width, height);
      const r = pipRect();
      ctx.fillStyle = '#000'; ctx.fillRect(r.x, r.y, r.w, r.h);
      drawCamera(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2; ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    if (manualFrames) { try { canvasTrack.requestFrame(); } catch {} }
  };

  // ── Frame clock ────────────────────────────────────────────────────────────
  // CRITICAL: requestAnimationFrame is throttled to ~0 in a BACKGROUND tab — and
  // a streamer who alt-tabs to their game IS backgrounded. With manual-frame
  // capture that starves MediaRecorder: it emits the init segment then nothing,
  // the stream dies with idle-timeout, and viewers see a frozen/empty player.
  // (getDisplayMedia/getUserMedia <video> elements keep DECODING in the
  // background, so drawImage still gets fresh pixels — we just need a clock that
  // keeps ticking.) A Web Worker setInterval is NOT visibility-throttled, so we
  // drive the loop from a worker, falling back to rAF only if a worker can't be
  // created (then background streams degrade, but at least foreground works).
  let frameWorker = null;
  let raf = 0;
  let lastEmit = 0;
  const frameMs = () => Math.max(8, Math.round(1000 / targetFps));
  const startClock = () => {
    try {
      const src = 'let t=null;onmessage=function(e){var d=e.data||{};if(d.stop){clearInterval(t);t=null;return;}clearInterval(t);t=setInterval(function(){postMessage(0);}, d.ms||33);};';
      const blob = new Blob([src], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      frameWorker = new Worker(url);
      URL.revokeObjectURL(url);
      frameWorker.onmessage = () => renderFrame();
      frameWorker.postMessage({ ms: frameMs() });
    } catch {
      frameWorker = null;
      const loop = (t) => {
        if (!running) return;
        raf = requestAnimationFrame(loop);
        if (t - lastEmit < frameMs() - 1) return;
        lastEmit = t;
        renderFrame();
      };
      raf = requestAnimationFrame(loop);
    }
  };
  startClock();

  // Audio mix: mic + optional system audio → one destination track.
  const AC = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AC();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  const dest = audioCtx.createMediaStreamDestination();
  let micNode = null, sysNode = null;
  const connectAudio = (track, setter, getter) => {
    const prev = getter();
    if (prev) { try { prev.disconnect(); } catch { /* gone */ } }
    if (!track) { setter(null); return; }
    const node = audioCtx.createMediaStreamSource(new MediaStream([track]));
    node.connect(dest);
    setter(node);
  };

  const setCameraTrack = (track) => {
    if (!track) { camVideo.srcObject = null; return; }
    camVideo.srcObject = new MediaStream([track]);
    camVideo.play().catch(() => {});
  };
  const setScreenTrack = (track) => {
    if (!track) { screenVideo.srcObject = null; return; }
    screenVideo.srcObject = new MediaStream([track]);
    screenVideo.play().catch(() => {});
  };
  const setMicTrack = (track) => connectAudio(track, (n) => { micNode = n; }, () => micNode);
  const setSystemAudio = (track) => connectAudio(track, (n) => { sysNode = n; }, () => sysNode);
  const setLayout = (next = {}) => {
    if (typeof next === 'string') { mode = next; return; }
    if (next.mode) mode = next.mode;
    if (next.corner) pipCorner = next.corner;
    if (typeof next.scale === 'number') pipScale = Math.max(0.12, Math.min(0.5, next.scale));
  };
  const setScene = (s) => { scene = s || null; };
  const setCameraEffect = (fx) => {
    camFx = LIVE_CAM_FX.includes(fx) ? fx : 'none';
    armCameraEffect();
  };
  const setCameraLook = (look) => {
    camLook = LIVE_LOOKS[look] !== undefined ? look : 'none';
    armCameraEffect();
  };
  const setCameraMask = (mask) => {
    // Belt and braces with the hidden picker: a preference persisted before
    // masks were hidden must not silently re-apply one.
    if (!MASKS_ENABLED) { camMask = 'none'; return; }
    camMask = LIVE_MASKS[mask] !== undefined ? mask : 'none';
    armCameraEffect();
  };
  /**
   * Create the effect module on first use and warm the segmenter only when a
   * BACKGROUND effect is on — the segmentation model is the expensive load, and
   * a look or mask has no use for it.
   */
  const armCameraEffect = () => {
    if (!camFxActive()) return;
    if (!camEffect) camEffect = createCameraEffect();
    if (camFx !== 'none') camEffect.ensure();
  };

  // Seed with the initial camera + mic.
  setCameraTrack(source?.getVideoTracks?.()[0]);
  setMicTrack(source?.getAudioTracks?.()[0]);

  const output = new MediaStream();
  output.addTrack(canvasTrack);
  dest.stream.getAudioTracks().forEach((t) => output.addTrack(t));

  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
    try { frameWorker?.postMessage({ stop: true }); frameWorker?.terminate(); } catch { /* noop */ }
    frameWorker = null;
    try { canvasStream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    try { audioCtx.close(); } catch { /* noop */ }
    camVideo.srcObject = null;
    screenVideo.srcObject = null;
  };

  return {
    stream: output,
    setCameraTrack,
    setScreenTrack,
    // Back-compat alias: old callers used setVideoTrack for the single source.
    setVideoTrack: setCameraTrack,
    setMicTrack,
    setSystemAudio,
    setLayout,
    setScene,
    setCameraEffect,
    setCameraLook,
    setCameraMask,
    setTargetFps,
    stop,
    width,
    height,
  };
}
