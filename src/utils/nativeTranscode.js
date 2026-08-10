// Hardware video transcoding on Android, via window.VergrTranscode.
//
// The web compressor in mediaCompression.js re-encodes by playing the video
// through a canvas and capturing with MediaRecorder, which is locked to
// playback speed — a 45-minute video costs 45 minutes and a faster phone does
// not help. MediaCodec runs as fast as the hardware allows. See
// VideoTranscodeBridge.kt for the pipeline.
//
// EVERY function here degrades to "cannot do it" rather than throwing, and the
// caller falls back to existing behaviour. A transcode that cannot run must
// never stop someone sending a video.

import { convertFileSrc } from '@tauri-apps/api/core';

const bridge = () => (typeof window !== 'undefined' ? window.VergrTranscode : null);

// Give up after this long with NO heartbeat from the encoder. Kotlin beats every
// 2s while frames are moving, so 60s of silence means it is wedged.
const STALL_MS = 60 * 1000;
// Absolute backstop, so a promise can never hang for the life of the session.
const CEILING_MS = 30 * 60 * 1000;

/** Is hardware transcoding available on this device/build? */
export function isHardwareTranscodeAvailable() {
  try { return !!bridge()?.available?.(); } catch { return false; }
}

/**
 * Can we transcode THIS file?
 *
 * Requires a real path on disk, because Kotlin cannot read a JavaScript Blob.
 * `_nativePath` is attached by nativeMedia.js to anything picked through our own
 * gallery grid. A video chosen through the system file picker has no path, so it
 * keeps the old behaviour.
 */
export function canHardwareTranscode(file) {
  return !!(file && file._nativePath && isHardwareTranscodeAvailable());
}

/**
 * Re-encode at `bitrate` bits per second, resolving to a new File.
 *
 * `startSec`/`endSec` bound the section to keep and `mute` drops the audio
 * track, so a sender who changed quality AND cut the video pays for one pass
 * rather than two.
 *
 * Resolves to `null` — never throws — when it cannot run or the encode fails, so
 * the caller can simply fall through to the original file.
 *
 * Note the output keeps the SOURCE RESOLUTION: the decoder renders straight into
 * the encoder's surface, and resizing between the two would need a GL pass.
 * Bitrate is the dominant lever for size regardless.
 */
export function hardwareTranscode(file, {
  bitrate = 2_500_000,
  startSec = 0,
  endSec = null,
  mute = false,
  onProgress,
} = {}) {
  if (!canHardwareTranscode(file)) return Promise.resolve(null);

  return new Promise((resolve) => {
    const reqId = `t${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      window.removeEventListener('vergr:transcode-done', onEvent);
      window.removeEventListener('vergr:transcode-progress', onBeat);
      clearTimeout(stall);
      clearTimeout(ceiling);
      resolve(value);
    };

    // STALL watchdog, not a duration limit. A long video can legitimately take
    // minutes even on hardware, so timing out on total elapsed time would kill
    // healthy encodes. What is never legitimate is the encoder going quiet — so
    // the clock resets on every heartbeat and only fires when nothing has moved.
    let stall = null;
    const armStall = () => {
      clearTimeout(stall);
      stall = setTimeout(() => finish(null), STALL_MS);
    };
    const onBeat = (e) => {
      const d = e?.detail;
      if (d?.reqId !== reqId) return;
      armStall();
      // Encoded position against source duration. totalUs is 0 when the
      // container did not declare one — report null rather than a made-up
      // number, and the UI falls back to an indeterminate spinner.
      if (typeof onProgress === 'function') {
        onProgress(d.totalUs > 0 ? Math.min(0.99, d.atUs / d.totalUs) : null);
      }
    };

    const onEvent = async (e) => {
      const d = e?.detail;
      if (!d || d.reqId !== reqId) return;
      if (!d.ok || !d.path) { finish(null); return; }
      try {
        // Read the encoded file back through the asset protocol, then tell
        // Kotlin to delete it — otherwise every send would leave a full copy of
        // the video sitting in the cache directory.
        const res = await fetch(convertFileSrc(d.path));
        if (!res.ok) { finish(null); return; }
        const blob = await res.blob();
        const name = (file.name || 'video').replace(/\.[^.]+$/, '') + '.mp4';
        finish(new File([blob], name, { type: 'video/mp4' }));
      } catch {
        finish(null);
      } finally {
        try { bridge()?.cleanup?.(d.path); } catch { /* best effort */ }
      }
    };

    // Backstop only. The stall watchdog above is what should normally catch a
    // failure; this exists so nothing can leave the promise pending forever.
    const ceiling = setTimeout(() => finish(null), CEILING_MS);
    window.addEventListener('vergr:transcode-done', onEvent);
    window.addEventListener('vergr:transcode-progress', onBeat);
    armStall();

    try {
      // Milliseconds, not microseconds: the WebView bridge marshals JS numbers
      // as doubles, and milliseconds keep every real video far inside the range
      // where a double is exact.
      bridge().transcode(
        file._nativePath, bitrate,
        Math.max(0, Math.round((startSec || 0) * 1000)),
        endSec != null ? Math.round(endSec * 1000) : 0,
        !!mute, reqId,
      );
    } catch {
      finish(null);
    }
  });
}

/**
 * Cut and/or silence a video WITHOUT re-encoding it.
 *
 * A trim changes no pixels — it selects a range of the samples that are already
 * there — so the honest operation is a copy into a new container, not a decode
 * and re-encode. That is the difference between a cut landing instantly and a
 * progress bar, and it is also lossless, which a re-encode never is.
 *
 * The cut starts at the keyframe at or before the requested point, so the output
 * can contain slightly MORE than was asked for, never less: erring the other way
 * would silently delete a moment the sender chose to keep.
 *
 * Resolves to a File, or null when it cannot run — the caller then falls back to
 * the slow encoder, which can always honour the cut.
 */
export function hardwareTrim(file, { startSec = 0, endSec = null, mute = false } = {}) {
  const b = bridge();
  if (!file?._nativePath || !b?.trim) return Promise.resolve(null);

  return new Promise((resolve) => {
    const reqId = `x${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      window.removeEventListener('vergr:transcode-done', onEvent);
      clearTimeout(timer);
      resolve(v);
    };
    const onEvent = async (e) => {
      const d = e?.detail;
      if (!d || d.reqId !== reqId) return;
      if (!d.ok || !d.path) { finish(null); return; }
      try {
        const res = await fetch(convertFileSrc(d.path));
        if (!res.ok) { finish(null); return; }
        const blob = await res.blob();
        const name = (file.name || 'video').replace(/\.[^.]+$/, '') + '.mp4';
        finish(new File([blob], name, { type: 'video/mp4' }));
      } catch {
        finish(null);
      } finally {
        try { b.cleanup?.(d.path); } catch { /* best effort */ }
      }
    };
    // Copying samples is disk-speed work. Long past this and something is stuck.
    const timer = setTimeout(() => finish(null), 120_000);
    window.addEventListener('vergr:transcode-done', onEvent);
    try {
      b.trim(
        file._nativePath,
        Math.max(0, Math.round((startSec || 0) * 1000)),
        endSec != null ? Math.round(endSec * 1000) : 0,
        !!mute, reqId,
      );
    } catch {
      finish(null);
    }
  });
}

/**
 * Relocate an MP4's index to the front WITHOUT re-encoding.
 *
 * For videos we deliberately leave alone (under the size threshold): the file is
 * sent exactly as the camera made it, index-at-the-end and all, which costs the
 * player an extra round trip before the first frame — and the penalty grows with
 * the video's length, because the index holds per-frame tables. This is a pure
 * structural rewrite: no decode, no quality change, milliseconds of work.
 *
 * Resolves to a new File, or null when there was nothing to do (already
 * faststart) or it could not be done safely. Never throws.
 */
export function faststartOnly(file) {
  const b = bridge();
  if (!file?._nativePath || !b?.faststart) return Promise.resolve(null);

  return new Promise((resolve) => {
    const reqId = `f${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      window.removeEventListener('vergr:transcode-done', onEvent);
      clearTimeout(timer);
      resolve(v);
    };
    const onEvent = async (e) => {
      const d = e?.detail;
      if (!d || d.reqId !== reqId) return;
      if (!d.ok || !d.path) { finish(null); return; }
      try {
        const res = await fetch(convertFileSrc(d.path));
        if (!res.ok) { finish(null); return; }
        const blob = await res.blob();
        finish(new File([blob], file.name || 'video.mp4', { type: 'video/mp4' }));
      } catch {
        finish(null);
      } finally {
        try { b.cleanup?.(d.path); } catch { /* best effort */ }
      }
    };
    // A remux is a straight file copy plus a header rewrite — if it has not
    // finished in this long, something is wrong and the original is fine.
    const timer = setTimeout(() => finish(null), 60_000);
    window.addEventListener('vergr:transcode-done', onEvent);
    try {
      b.faststart(file._nativePath, reqId);
    } catch {
      finish(null);
    }
  });
}
