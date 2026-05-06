// All compression runs on the user's device — free CPU, free bandwidth.
// The server only ever receives the already-shrunk file, which keeps Firebase
// Storage costs minimal even at scale.

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
  avatar:    { maxW: 512,  maxH: 512,  quality: 0.85, square: true },
  post:      { maxW: 1600, maxH: 1600, quality: 0.82, square: false },
  chat:      { maxW: 1280, maxH: 1280, quality: 0.80, square: false },
  background:{ maxW: 1920, maxH: 1920, quality: 0.82, square: false },
};

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
export const compressImage = async (file, preset = 'post') => {
  const cfg = PRESETS[preset] || PRESETS.post;
  const img = await _loadImage(file);

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
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  URL.revokeObjectURL(img.src);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', cfg.quality));
  if (!blob) throw new Error('Image compression failed');

  // Strip the original extension so the server-side filename is consistent
  const baseName = (file.name || 'image').replace(/\.[^.]+$/, '');
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
};

// ── Shorts tier limits ──
// Shorts are vertical short-form — capped at 60s regardless of tier to keep
// them snackable.
export const SHORTS_LIMITS = {
  free: { maxDuration: 60, maxShortSide: 720,  videoBitrate: 1_500_000 },
  lite: { maxDuration: 60, maxShortSide: 1080, videoBitrate: 2_500_000 },
  pro:  { maxDuration: 60, maxShortSide: 1080, videoBitrate: 3_500_000 },
};

// ── Clip / feed-video tier limits ──
// Long-form gaming content (highlights, plays of the game, full-match recaps).
// Free users get 5-min 720p; Pro gets 60-min 1080p.
export const CLIP_LIMITS = {
  free: { maxDuration: 5  * 60, maxShortSide: 720,  videoBitrate: 1_500_000 },
  lite: { maxDuration: 15 * 60, maxShortSide: 1080, videoBitrate: 2_500_000 },
  pro:  { maxDuration: 60 * 60, maxShortSide: 1080, videoBitrate: 3_500_000 },
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
export const compressVideo = async (file, tier = 'free', onProgress, kind = 'short') => {
  const table = kind === 'clip' ? CLIP_LIMITS : SHORTS_LIMITS;
  const limits = table[tier] || table.free;

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    const url = URL.createObjectURL(file);

    video.onloadedmetadata = async () => {
      const { videoWidth: origW, videoHeight: origH, duration } = video;

      if (duration > limits.maxDuration) {
        URL.revokeObjectURL(url);
        reject(new Error(`Video is ${Math.ceil(duration)}s — max ${limits.maxDuration}s`));
        return;
      }

      // Scale so the shorter side ≤ maxShortSide
      const shortSide = Math.min(origW, origH);
      const scale = shortSide > limits.maxShortSide
        ? limits.maxShortSide / shortSide
        : 1;

      // Already small enough — pass through
      if (scale >= 1) {
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

      // Try to capture audio via Web Audio API
      let combinedStream;
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

      recorder.start(100);
      video.currentTime = 0;
      try { await video.play(); } catch {
        // Autoplay blocked — fallback: pass through without compression
        recorder.stop();
        URL.revokeObjectURL(url);
        resolve(file);
        return;
      }

      const drawLoop = () => {
        if (video.ended || video.paused) {
          if (recorder.state !== 'inactive') recorder.stop();
          return;
        }
        ctx.drawImage(video, 0, 0, newW, newH);
        onProgress?.(video.currentTime / duration);
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

export const getMediaDimensions = (file) => new Promise((resolve) => {
  if (file.type.startsWith('video')) {
    const v = document.createElement('video');
    v.onloadedmetadata = () => resolve({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
    v.src = URL.createObjectURL(file);
  } else {
    const i = new Image();
    i.onload = () => resolve({ width: i.width, height: i.height });
    i.src = URL.createObjectURL(file);
  }
});

/**
 * Generic compress entry point used by chat / post / avatar uploads.
 *
 * @param {File} file - input file
 * @param {string} tier - 'free' | 'lite' | 'pro'
 * @param {string} preset - 'avatar' | 'post' | 'chat' | 'background'
 */
export const compressMedia = async (file, tier = 'free', preset = 'chat') => {
  const cap = TIER_MAX_BYTES[tier] || TIER_MAX_BYTES.free;
  if (file.size > cap) {
    const mb = Math.round(file.size / 1024 / 1024);
    throw new Error(`File too large (${mb} MB) — your tier max is ${cap / 1024 / 1024} MB`);
  }

  if (file.type.startsWith('image/')) {
    return compressImage(file, preset);
  }

  // Videos: pass through, but enforce the cap above. Future: add ffmpeg.wasm
  // worker for short clips if storage costs balloon again.
  return file;
};
