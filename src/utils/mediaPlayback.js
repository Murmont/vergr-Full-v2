// Shared media-playback helpers for chat surfaces (thread + contact info).
//
// These live outside the screens so the round video-note player can be reused
// in BOTH the chat thread and the Shared Media panel — a video note must look
// the same everywhere (a circle), never a full-screen rectangle.

import { useEffect } from 'react';

/** mm:ss, guarding the non-finite durations MediaRecorder produces. */
export const fmtClock = (s) => {
  s = Number(s);
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Recorded (MediaRecorder) WebM reports duration=Infinity until the whole file
 * is downloaded. The recorder stamps the real length onto the upload URL as a
 * `#d=` fragment — a fragment never reaches the server and survives the relay
 * inside contentUrl. Read that instead of far-seeking, which would force a
 * full-file download (see reference-never-far-seek-video-duration).
 */
export const parseUrlDur = (src) => {
  const m = /[#&]d=([\d.]+)/.exec(src || '');
  const d = m ? parseFloat(m[1]) : 0;
  return isFinite(d) && d > 0 ? d : 0;
};

// One media element plays at a time (Telegram): starting any player pauses
// whoever was playing before it — video, video note or voice note. Module-level
// so every importer shares the SAME registry.
let _activeMedia = null;
export const claimPlayback = (el) => {
  if (_activeMedia && _activeMedia !== el && !_activeMedia.paused) {
    try { _activeMedia.pause(); } catch { /* ignore */ }
  }
  _activeMedia = el;
};

/** Pause a playing video once it scrolls out of view — audio must not keep
 *  going from a bubble the user can no longer see. */
export const usePauseOffscreen = (videoRef) => {
  useEffect(() => {
    const el = videoRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([en]) => {
      if (!en.isIntersecting && !el.paused) { try { el.pause(); } catch { /* ignore */ } }
    }, { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, [videoRef]);
};
