// Pieces both Shorts players share (VideoPlayer in ShortsDeck, LadderPlayer).
//
// usePlayerControls — the deck owns the gestures now, not the <video>. A single
//   tap is held for a moment so a double-tap can become a like instead of a
//   pause-then-play flicker (the way TikTok, Reels and Shorts behave), and the
//   scrub bar needs to seek. So the ACTIVE player hands the deck a small API.
// AmbientFill — a landscape clip in a portrait screen leaves two black bands.
//   The video is never cropped (founder rule), so the bands are filled with the
//   clip's own colours instead: a 10x6 sample of the frame, blurred far past
//   recognition. drawImage never reads pixels back, so cross-origin video
//   works with no CORS header and nothing is fetched twice.
// PausedGlyph — a bare play glyph. The old one sat on a translucent disc.
import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon';

export function usePlayerControls({ ref, active, controlsRef, onBuffering, userPaused, setPaused }) {
  useEffect(() => {
    const v = ref.current;
    if (!v || !active || !controlsRef) return undefined;
    const api = {
      toggle: () => {
        if (v.paused) { v.play().catch(() => {}); userPaused.current = false; setPaused(false); }
        else { v.pause(); userPaused.current = true; setPaused(true); }
      },
      seek: (f) => {
        if (!v.duration || !Number.isFinite(v.duration)) return;
        v.currentTime = Math.max(0, Math.min(v.duration - 0.05, f * v.duration));
      },
      duration: () => (Number.isFinite(v.duration) ? v.duration : 0),
      time: () => v.currentTime || 0,
    };
    controlsRef.current = api;
    return () => { if (controlsRef.current === api) controlsRef.current = null; };
  }, [ref, active, controlsRef, userPaused, setPaused]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !active || !onBuffering) return undefined;
    const on = () => onBuffering(true);
    const off = () => onBuffering(false);
    const offEvents = ['playing', 'canplay', 'seeked', 'pause'];
    v.addEventListener('waiting', on);
    v.addEventListener('stalled', on);
    offEvents.forEach((e) => v.addEventListener(e, off));
    return () => {
      v.removeEventListener('waiting', on);
      v.removeEventListener('stalled', on);
      offEvents.forEach((e) => v.removeEventListener(e, off));
      onBuffering(false);
    };
  }, [ref, active, onBuffering]);
}

export function AmbientFill({ videoRef, active }) {
  const canvasRef = useRef(null);
  const [letterboxed, setLetterboxed] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !active) { setLetterboxed(false); return undefined; }
    const measure = () => {
      const box = v.getBoundingClientRect();
      const vw = v.videoWidth, vh = v.videoHeight;
      if (!vw || !vh || !box.width || !box.height) { setLetterboxed(false); return; }
      const media = vw / vh, frame = box.width / box.height;
      // Only when the bands are big enough to see. A 9:16 clip on a slightly
      // taller phone should not grow a halo.
      setLetterboxed(Math.abs(media - frame) / frame > 0.12);
    };
    measure();
    v.addEventListener('loadedmetadata', measure);
    window.addEventListener('resize', measure);
    return () => {
      v.removeEventListener('loadedmetadata', measure);
      window.removeEventListener('resize', measure);
    };
  }, [videoRef, active]);

  useEffect(() => {
    if (!active || !letterboxed) return undefined;
    const v = videoRef.current, c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!v || !ctx) return undefined;
    c.width = 10;
    c.height = 6;
    let stopped = false, timer = 0;
    const tick = () => {
      if (stopped) return;
      try { ctx.filter = 'blur(1px)'; ctx.drawImage(v, 0, 0, 10, 6); } catch { /* no frame yet */ }
      // 8 samples a second: at this size consecutive frames are indistinguishable.
      timer = setTimeout(tick, 125);
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [videoRef, active, letterboxed]);

  if (!active || !letterboxed) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ filter: 'blur(42px) saturate(1.35) brightness(0.6)', transform: 'scale(1.3)' }}
    />
  );
}

// Portrait clips sit at the TOP of a taller screen, so the spare height gathers
// below them, behind the caption, instead of splitting into a thin band above
// and below (founder, 2026-09-13). Nothing is ever cropped. Landscape stays
// centred. Remembered per source so the poster and the first frame agree.
const tallBySrc = new Map();
export function useTopAnchor(ref, src, poster) {
  const [tall, setTall] = useState(() => (src ? tallBySrc.get(src) ?? false : false));
  useEffect(() => {
    if (!src) return undefined;
    if (tallBySrc.has(src)) setTall(tallBySrc.get(src));
    const v = ref.current;
    let done = false;
    const record = (w, h) => {
      if (!w || !h) return;
      const t = h > w;
      tallBySrc.set(src, t);
      done = true;
      setTall(t);
    };
    const onMeta = () => record(v?.videoWidth, v?.videoHeight);
    v?.addEventListener('loadedmetadata', onMeta);
    if (v?.videoWidth) onMeta();
    let img = null;
    if (poster && !tallBySrc.has(src)) {
      img = new Image();
      img.onload = () => { if (!done) record(img.naturalWidth, img.naturalHeight); };
      img.src = poster;
    }
    return () => {
      v?.removeEventListener('loadedmetadata', onMeta);
      if (img) img.onload = null;
    };
  }, [ref, src, poster]);
  return tall ? 'center top' : 'center center';
}

// A clip that uses a sound plays that audio BESIDE its video (utils/sounds.js):
// nothing re-encoded, nothing stored twice. The audio follows the video's play,
// pause, buffering, seek, speed and loop, and only the active slide has one.
//
// `timeScale` is the clip's own edited speed (utils/clipEdits.js). A clip sped up
// to 2x keeps its added sound at normal speed, as TikTok does, so the sound's
// clock is the video's clock divided by it. `volume` is the creator's mix.
export function useLayeredSound({ ref, active, muted, sound, volume = 1, timeScale = 1, offset = 0 }) {
  const audioRef = useRef(null);
  const url = sound?.url || null;
  const scaleRef = useRef(timeScale || 1);
  scaleRef.current = timeScale > 0 ? timeScale : 1;
  // The editor previews an UNCUT file, so the sound starts at the trim start.
  const offsetRef = useRef(0);
  offsetRef.current = offset > 0 ? offset : 0;
  const resyncRef = useRef(null);

  useEffect(() => {
    const v = ref.current;
    if (!v || !active || !url) return undefined;
    const a = new Audio();
    a.preload = 'auto';
    a.loop = true;
    a.src = url;
    audioRef.current = a;

    const target = () => {
      const d = a.duration;
      const t = Math.max(0, v.currentTime - offsetRef.current) / scaleRef.current;
      return d && Number.isFinite(d) ? t % d : t;
    };
    const sync = (force) => {
      const t = target();
      if (force || Math.abs(a.currentTime - t) > 0.3) { try { a.currentTime = t; } catch { /* not seekable yet */ } }
    };
    const applyRate = () => { a.playbackRate = (v.playbackRate || 1) / scaleRef.current; };
    const onPlaying = () => {
      applyRate();
      sync(true);
      a.play().catch(() => {});
    };
    const onPause = () => a.pause();
    const onSeeked = () => sync(true);
    const onRate = () => applyRate();
    const onTime = () => { if (!v.paused) sync(false); };
    resyncRef.current = () => { applyRate(); sync(true); };

    v.addEventListener('playing', onPlaying);
    v.addEventListener('pause', onPause);
    v.addEventListener('waiting', onPause);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('ratechange', onRate);
    v.addEventListener('timeupdate', onTime);
    if (!v.paused && v.readyState >= 3) onPlaying();

    return () => {
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('waiting', onPause);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('ratechange', onRate);
      v.removeEventListener('timeupdate', onTime);
      try { a.pause(); a.removeAttribute('src'); a.load(); } catch { /* already gone */ }
      if (audioRef.current === a) audioRef.current = null;
      resyncRef.current = null;
    };
  }, [ref, active, url]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = !!muted;
  }, [muted, active, url]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) a.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 1));
  }, [volume, active, url]);

  useEffect(() => { resyncRef.current?.(); }, [timeScale, offset]);
}

export function PausedGlyph() {
  return (
    <div className="absolute inset-0 z-[2] flex items-center justify-center pointer-events-none">
      <Icon
        name="play_arrow"
        filled
        size={88}
        className="text-white"
        style={{ opacity: 0.9, filter: 'drop-shadow(0 2px 10px rgba(0,0,0,0.55))' }}
      />
    </div>
  );
}
