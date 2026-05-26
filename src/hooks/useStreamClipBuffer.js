// useStreamClipBuffer — retroactive "clip the last N seconds" of a live stream,
// client-side and zero-cost (no Hetzner ffmpeg, no extra storage round-trips).
//
// How it works: once the <video> is playing we capture its rendered output via
// captureStream() and run a continuous MediaRecorder with a 1s timeslice. We
// keep the FIRST chunk forever (it carries the WebM/EBML header + init cluster)
// and a pruned rolling window of recent chunks. On grab(n) we assemble
// [header, ...recent chunks within the last n seconds] into one Blob — a
// playable WebM whose content is the last n seconds (older clusters are dropped,
// so memory stays bounded regardless of stream length).
//
// Caveats (honest): captureStream + MediaRecorder is a Chromium-class feature.
// On the Safari native-HLS path the cross-origin <video> can taint the captured
// stream, in which case isSupported() returns false and the caller hides the
// clip button. hls.js (MSE) playback in Chromium is the supported path.

import { useEffect, useRef, useCallback } from 'react';

const MAX_WINDOW_SEC = 95; // covers the Pro 90s clip + a little headroom

export default function useStreamClipBuffer(videoRef, { enabled = true } = {}) {
  const recRef = useRef(null);
  const headerRef = useRef(null);   // first dataavailable blob (header + init)
  const recentRef = useRef([]);     // [{ blob, t }]
  const mimeRef = useRef('video/webm');
  const supportedRef = useRef(true);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;
    const video = videoRef?.current;
    if (!video || typeof video.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
      supportedRef.current = false;
      return undefined;
    }
    let cancelled = false;

    const start = () => {
      if (cancelled || startedRef.current) return;
      let stream;
      try { stream = video.captureStream(); }
      catch { supportedRef.current = false; return; }
      if (!stream || stream.getTracks().length === 0) return; // tracks not live yet

      const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      const mime = candidates.find((m) => {
        try { return MediaRecorder.isTypeSupported(m); } catch { return false; }
      }) || 'video/webm';
      mimeRef.current = mime;

      let rec;
      try { rec = new MediaRecorder(stream, { mimeType: mime }); }
      catch { supportedRef.current = false; return; }
      recRef.current = rec;
      startedRef.current = true;

      rec.ondataavailable = (e) => {
        if (!e.data || !e.data.size) return;
        if (!headerRef.current) { headerRef.current = e.data; return; }
        const now = Date.now();
        recentRef.current.push({ blob: e.data, t: now });
        const cutoff = now - MAX_WINDOW_SEC * 1000;
        while (recentRef.current.length && recentRef.current[0].t < cutoff) recentRef.current.shift();
      };
      rec.onerror = () => { supportedRef.current = false; };
      try { rec.start(1000); } catch { supportedRef.current = false; }
    };

    if (video.readyState >= 2 && !video.paused) start();
    const onPlaying = () => start();
    video.addEventListener('playing', onPlaying);

    return () => {
      cancelled = true;
      video.removeEventListener('playing', onPlaying);
      try { if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop(); } catch { /* ignore */ }
      recRef.current = null;
      startedRef.current = false;
      headerRef.current = null;
      recentRef.current = [];
    };
  }, [videoRef, enabled]);

  const isSupported = useCallback(() => supportedRef.current, []);

  // Assemble the last `seconds` of footage into one WebM Blob, or null if there
  // isn't enough buffered yet.
  const grab = useCallback((seconds) => {
    if (!supportedRef.current || !headerRef.current) return null;
    const cutoff = Date.now() - seconds * 1000;
    const recent = recentRef.current.filter((c) => c.t >= cutoff).map((c) => c.blob);
    if (recent.length === 0) return null;
    return new Blob([headerRef.current, ...recent], { type: mimeRef.current });
  }, []);

  return { grab, isSupported };
}
