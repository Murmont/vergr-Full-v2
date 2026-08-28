// All compression runs on the user's device — free CPU, free bandwidth.
// The server only ever receives the already-shrunk file, which keeps Firebase
// Storage costs minimal even at scale.

import { canHardwareTranscode, hardwareTranscode, hardwareTrim, faststartOnly } from './nativeTranscode';

// Tier-based hard size caps (BEFORE compression). If the *original* file
// is larger than this we reject before doing any work.
// Sized for gaming content: free users can post 5-min 720p clips, Pro can
// upload 1080p game footage up to ~30 min. Server enforces the same cap
// in `functions/r2.js` (SIZE_CAPS) — keep the two in sync.
const TIER_MAX_BYTES = {
  free: 200 * 1024 * 1024,    // 200 MB  — ~5 min 720p gaming clip
  lite: 1024 * 1024 * 1024,   //   1 GB  — ~15 min 1080p clip
  pro:  5 * 1024 * 1024 * 1024, // 5 GB  — full match VOD / extended highlight
};

// Image quality presets — every preset writes JPEG, which is 5–10× smaller
// than the typical 12 MP HEIC/PNG that phones produce.
const PRESETS = {
  // B9: 384px (down from 512) is still crisp for a 2-3x profile header while
  // cutting stored/served bytes ~45% for every list-row avatar. True per-size
  // variants (48/96/192) are the follow-up; this is the single-size floor.
  avatar:    { maxW: 384,  maxH: 384,  quality: 0.82, square: true },
  post:      { maxW: 1600, maxH: 1600, quality: 0.82, square: false },
  // Pro-only. 3840 is the 4K long edge, and quality is raised because the
  // whole point of the tier is that a 4K photo survives the upload. The bytes
  // are still bounded by the 5GB Pro cap in functions/r2.js SIZE_CAPS.
  post4k:    { maxW: 3840, maxH: 3840, quality: 0.90, square: false },
  chat:      { maxW: 1280, maxH: 1280, quality: 0.80, square: false },
  background:{ maxW: 1920, maxH: 1920, quality: 0.82, square: false },
};

// Which image preset a plan gets for a feed post. Pro is the only tier whose
// photos are not resized to 1600px; that is the "4K photos" line on the
// pricing page, so this map is the thing that makes the claim true.
// Mirrors maxPhotoPx in src/utils/tierSystem.js TIER_FEATURES.
export const postPresetForTier = (tier) => (tier === 'pro' ? 'post4k' : 'post');

const _loadImage = (file) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = URL.createObjectURL(file);
});

/**
 * Compresses an image to a JPEG of at most maxW × maxH using a canvas.
 * If square=true, center-crops to a 1:1 aspect ratio first (used for avatars).
 *
 * Always returns a `File` (not just a Blob) so downstream code can read
 * `.name` / `.type` consistently.
 */
export const compressImage = async (file, preset = 'post', rotate = 0) => {
  const cfg = PRESETS[preset] || PRESETS.post;
  const img = await _loadImage(file);
  // Rotation is baked into THIS draw rather than done as its own pass. A
  // separate rotate step would mean encoding the JPEG twice, and the second
  // encode of an already-lossy image is quality thrown away for nothing.
  const turn = ((Number(rotate) || 0) % 360 + 360) % 360;
  const swap = turn === 90 || turn === 270;

  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (cfg.square) {
    const side = Math.min(img.width, img.height);
    sx = Math.floor((img.width - side) / 2);
    sy = Math.floor((img.height - side) / 2);
    sw = side;
    sh = side;
  }

  // Fit inside (maxW, maxH) while preserving aspect ratio
  let dw = sw, dh = sh;
  if (dw > cfg.maxW) { dh = (cfg.maxW / dw) * dh; dw = cfg.maxW; }
  if (dh > cfg.maxH) { dw = (cfg.maxH / dh) * dw; dh = cfg.maxH; }
  dw = Math.round(dw);
  dh = Math.round(dh);

  const canvas = document.createElement('canvas');
  canvas.width = swap ? dh : dw;
  canvas.height = swap ? dw : dh;
  const ctx = canvas.getContext('2d');
  if (turn) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((turn * Math.PI) / 180);
    ctx.drawImage(img, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  } else {
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  }
  URL.revokeObjectURL(img.src);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', cfg.quality));
  if (!blob) throw new Error('Image compression failed');

  // Strip the original extension so the server-side filename is consistent
  const baseName = (file.name || 'image').replace(/\.[^.]+$/, '');
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
};

// ── Shorts tier limits ──
//
// NO DURATION CAP. Founder-set 2026-08-03: "we shouldn't restrict the length,
// only the size, since that is what we pay for". Storage bills per byte and R2
// delivery is free, so two files of equal size cost the same whether one is 45
// seconds and the other 45 minutes. The real ceiling is the tier's byte cap
// (TIER_MAX_BYTES), which is checked before any work happens.
export const SHORTS_LIMITS = {
  free: { maxShortSide: 720,  videoBitrate: 1_500_000 },
  lite: { maxShortSide: 1080, videoBitrate: 2_500_000 },
  pro:  { maxShortSide: 1080, videoBitrate: 3_500_000 },
};

// Below this, a video is left exactly as it is.
//
// This is deliberately NOT the tier cap. The tier cap (200MB / 1GB / 5GB) is a
// REJECTION threshold — "too big to accept" — and 190MB is under the free cap
// while being something nobody wants to push over mobile data. This is the
// separate, much lower "already fine, don't spend the user's battery and minutes
// on it" line. Founder-set 2026-08-03.
export const SKIP_REENCODE_BYTES = 25 * 1024 * 1024;

// ── Clip / feed-video tier limits ──
// Long-form gaming content (highlights, plays of the game, full-match recaps).
// Resolution and bitrate only — see the note on SHORTS_LIMITS for why there is
// no duration here.
export const CLIP_LIMITS = {
  free: { maxShortSide: 720,  videoBitrate: 1_500_000 },
  lite: { maxShortSide: 1080, videoBitrate: 2_500_000 },
  pro:  { maxShortSide: 1080, videoBitrate: 3_500_000 },
};

/**
 * Compresses a video by re-encoding via Canvas + MediaRecorder.
 * Scales the shorter side down to `maxShortSide` and re-encodes at a
 * controlled bitrate.  Runs in real-time (30 s video ≈ 30 s to compress).
 *
 * @param {File}     file         - Source video
 * @param {string}   tier         - 'free' | 'lite' | 'pro'
 * @param {Function} [onProgress] - Called with 0-1 progress value
 * @returns {Promise<File>}       - Compressed WebM file
 */
export const compressVideo = async (file, tier = 'free', onProgress, kind = 'short', opts = {}) => {
  const table = kind === 'clip' ? CLIP_LIMITS : SHORTS_LIMITS;
  const base = table[tier] || table.free;
  // `opts.maxShortSide` / `opts.videoBitrate` let the SENDER choose a smaller
  // version than their plan would give them — someone on mobile data may want a
  // 40MB clip sent as 8MB. Absent, the plan's own numbers apply.
  const limits = {
    ...base,
    ...(opts.maxShortSide ? { maxShortSide: opts.maxShortSide } : {}),
    ...(opts.videoBitrate ? { videoBitrate: opts.videoBitrate } : {}),
  };

  // EDITS THE SENDER MADE ON THE PREVIEW SCREEN.
  //
  // These are not optimisations we chose, they are instructions. That
  // distinction runs through every shortcut below: any path that would return
  // the source file unchanged is fine when we were merely trying to make it
  // smaller, and is a silent lie when the user cut ten seconds out of it.
  const trimStart = Math.max(0, Number(opts.trimStart) || 0);
  const trimEnd = Number.isFinite(Number(opts.trimEnd)) && Number(opts.trimEnd) > trimStart
    ? Number(opts.trimEnd)
    : null;
  const mute = !!opts.mute;
  const edited = trimStart > 0 || trimEnd != null || mute;

  // ALREADY SMALL ENOUGH — don't touch it.
  //
  // Re-encoding is real-time (see the note above), so shrinking a 40MB file to
  // 38MB costs the user minutes of waiting for nothing. Size is also the only
  // thing that actually costs us anything: storage is billed per byte, and
  // delivery is free on R2, so a short file and a long file of equal size cost
  // exactly the same.
  //
  // `opts.force` is how the send screen overrides this when the user has
  // deliberately picked a smaller size. Their choice always wins over ours.
  if (!opts.force && !edited && file.size <= SKIP_REENCODE_BYTES) {
    // Not re-encoding, but still worth moving the index to the front. The file
    // is otherwise byte-identical to what the camera produced, index-at-the-end
    // included — and that index is what a player must have before it can show a
    // frame. Cheap structural rewrite, no quality change; a small-but-LONG video
    // is exactly the case that suffers most without it.
    const fs = await faststartOnly(file).catch(() => null);
    onProgress?.(1);
    return fs || file;
  }

  // HARDWARE PATH FIRST. The canvas encoder below is locked to playback speed,
  // so it costs a minute per minute of video; MediaCodec runs as fast as the
  // phone allows. Only possible when the file has a real path on disk (anything
  // picked through our own gallery grid) and the native bridge is present.
  // Returns null rather than throwing on any failure, so an unsupported codec or
  // a busy encoder simply falls through to the old path instead of blocking the
  // send.
  if (canHardwareTranscode(file)) {
    // A cut or a mute with no quality change touches no pixels, so it is a
    // sample copy into a fresh container rather than a decode-and-re-encode.
    // Near-instant and lossless — the difference between Telegram cutting a
    // video the moment you let go of the handle and a progress bar.
    if (opts.remuxOnly && edited) {
      const cut = await hardwareTrim(file, { startSec: trimStart, endSec: trimEnd, mute });
      if (cut) { onProgress?.(1); return cut; }
      // Fell through: the canvas encoder below can still honour the cut, just
      // slowly. What must never happen is sending the untrimmed original.
    }

    const hw = await hardwareTranscode(file, {
      bitrate: limits.videoBitrate,
      startSec: trimStart,
      endSec: trimEnd,
      mute,
      // Forwarded so the sending bubble can show a real "Compressing 42%"
      // instead of an indefinite spinner for the whole encode.
      onProgress: (frac) => { if (frac != null) onProgress?.(frac); },
    });
    if (hw) {
      onProgress?.(1);
      // Only take it if it actually helped. A file already efficiently encoded
      // can come out LARGER after a re-encode, and shipping the bigger one would
      // be worse than doing nothing.
      //
      // ONLY when nothing was edited, though. With a cut or a mute the output is
      // the thing the user asked for; comparing sizes and handing back the
      // original would quietly undo their edit.
      if (edited) return hw;
      return hw.size < file.size ? hw : file;
    }
  }

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    const url = URL.createObjectURL(file);

    video.onloadedmetadata = async () => {
      const { videoWidth: origW, videoHeight: origH, duration } = video;

      // The window we are actually encoding. Everything downstream — the draw
      // loop's stop condition and the progress fraction — is measured against
      // this rather than the source length.
      const startT = Math.min(trimStart, Math.max(0, (duration || 0) - 0.1));
      const endT = trimEnd != null ? Math.min(trimEnd, duration || trimEnd) : (duration || 0);
      const span = Math.max(0.1, endT - startT);

      // Scale so the shorter side ≤ maxShortSide
      const shortSide = Math.min(origW, origH);
      const scale = shortSide > limits.maxShortSide
        ? limits.maxShortSide / shortSide
        : 1;

      // Already small enough — pass through.
      //
      // Only when there is nothing to cut or mute. With an edit pending this
      // branch would hand back the untouched source, which looks like the app
      // ignored the user rather than like a size decision.
      if (scale >= 1 && !edited) {
        URL.revokeObjectURL(url);
        onProgress?.(1);
        resolve(file);
        return;
      }

      // Ensure even pixel counts (codec requirement)
      const newW = Math.round((origW * scale) / 2) * 2;
      const newH = Math.round((origH * scale) / 2) * 2;

      const canvas = document.createElement('canvas');
      canvas.width = newW;
      canvas.height = newH;
      const ctx = canvas.getContext('2d');

      // Video track from the canvas
      const canvasStream = canvas.captureStream(30);

      // Try to capture audio via Web Audio API. Skipped entirely when the sender
      // asked for a silent send — dropping the track is the point, not a
      // fallback.
      let combinedStream;
      if (mute) {
        combinedStream = canvasStream;
        video.muted = true;
      } else {
        try {
          video.muted = false;
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const source = audioCtx.createMediaElementSource(video);
          const dest   = audioCtx.createMediaStreamDestination();
          source.connect(dest);
          combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...dest.stream.getAudioTracks(),
          ]);
        } catch {
          // No audio track or Web Audio unsupported — video-only
          combinedStream = canvasStream;
          video.muted = true;
        }
      }

      // Pick best available codec
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
          ? 'video/webm;codecs=vp8'
          : 'video/webm';

      const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: limits.videoBitrate,
      });

      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      recorder.onstop = () => {
        URL.revokeObjectURL(url);
        const blob = new Blob(chunks, { type: 'video/webm' });
        const name = (file.name || 'short').replace(/\.[^.]+$/, '.webm');
        onProgress?.(1);
        resolve(new File([blob], name, { type: 'video/webm' }));
      };

      recorder.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Video compression failed'));
      };

      // Park on the in-point BEFORE recording starts, or the first frames
      // captured are whatever the video happened to be showing and the cut
      // begins in the wrong place.
      await new Promise((seeked) => {
        if (startT <= 0.01) { seeked(); return; }
        const done = () => { video.removeEventListener('seeked', done); seeked(); };
        video.addEventListener('seeked', done);
        setTimeout(done, 4000);   // never hang the send on a seek that stalls
        try { video.currentTime = startT; } catch { done(); }
      });

      recorder.start(100);
      try { await video.play(); } catch {
        // Autoplay blocked. Without an edit the source is a fine answer; with
        // one there is no honest output to return, so fail loudly instead of
        // sending something the user did not ask for.
        recorder.stop();
        URL.revokeObjectURL(url);
        if (edited) reject(new Error('Could not apply your edits to this video'));
        else resolve(file);
        return;
      }

      const drawLoop = () => {
        if (video.ended || video.paused) {
          if (recorder.state !== 'inactive') recorder.stop();
          return;
        }
        if (video.currentTime >= endT) {
          video.pause();
          if (recorder.state !== 'inactive') recorder.stop();
          return;
        }
        ctx.drawImage(video, 0, 0, newW, newH);
        onProgress?.(Math.min(0.99, (video.currentTime - startT) / span));
        requestAnimationFrame(drawLoop);
      };
      drawLoop();

      video.onended = () => {
        if (recorder.state !== 'inactive') recorder.stop();
      };
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video'));
    };

    video.src = url;
  });
};

/**
 * Read a file's intrinsic size (and duration, for video).
 *
 * ALWAYS settles. It used to have no error handler, so an unreadable file left
 * the promise pending forever and whatever awaited it simply never continued.
 * A codec we cannot probe resolves to an empty object instead, and the caller
 * degrades to not showing the numbers.
 */
export const getMediaDimensions = (file) => new Promise((resolve) => {
  const url = URL.createObjectURL(file);
  let settled = false;
  const done = (v) => {
    if (settled) return;
    settled = true;
    URL.revokeObjectURL(url);   // was leaked on every call
    clearTimeout(timer);
    resolve(v);
  };
  const timer = setTimeout(() => done({}), 15000);

  if (file.type?.startsWith('video')) {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => done({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
    v.onerror = () => done({});
    v.src = url;
  } else {
    const i = new Image();
    i.onload = () => done({ width: i.width, height: i.height });
    i.onerror = () => done({});
    i.src = url;
  }
});

/**
 * Generic compress entry point used by chat / post / avatar uploads.
 *
 * @param {File} file - input file
 * @param {string} tier - 'free' | 'lite' | 'pro'
 * @param {string} preset - 'avatar' | 'post' | 'chat' | 'background'
 * @param {object} [opts] - { rotate } for images, applied inside the same
 *                          re-encode this already performs.
 */
export const compressMedia = async (file, tier = 'free', preset = 'chat', opts = {}) => {
  const cap = TIER_MAX_BYTES[tier] || TIER_MAX_BYTES.free;
  if (file.size > cap) {
    const mb = Math.round(file.size / 1024 / 1024);
    throw new Error(`File too large (${mb} MB) — your tier max is ${cap / 1024 / 1024} MB`);
  }

  if (file.type.startsWith('image/')) {
    return compressImage(file, preset, opts.rotate);
  }

  // Videos: pass through, but enforce the cap above. Future: add ffmpeg.wasm
  // worker for short clips if storage costs balloon again.
  return file;
};
