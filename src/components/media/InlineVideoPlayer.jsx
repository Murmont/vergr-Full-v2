// InlineVideoPlayer — a <video> with CUSTOM HTML controls (play/pause, seek,
// time, mute) instead of the browser-native `controls` bar.
//
// WHY: the Android System WebView (our Tauri native app) renders the native
// <video controls> bar on a separate compositor surface that does NOT receive
// touch events inside the Tauri shell — so play/seek/mute are dead on native
// (they work fine in desktop/mobile-Chrome/PWA, which aren't the System
// WebView). Native controls are therefore a dead end for the native app. These
// custom controls are plain HTML (<button>/<input type=range>), which the
// WebView DOES deliver touch to, and they work identically on web. Playback is
// driven entirely through the JS media API (play/pause/currentTime/muted).
//
// Use this anywhere we'd otherwise render `<video ... controls />`.
import { useRef, useState } from 'react';
import Icon from '../Icon';

const fmtClock = (s) => {
  s = Number(s);
  if (!isFinite(s) || s < 0) s = 0; // MediaRecorder WebM can report Infinity
  s = Math.floor(s);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

// Recorded (MediaRecorder) WebM reports duration=Infinity; the chat recorder
// stamps the real length onto the URL as a #d= fragment. Parse it as the hint.
const parseUrlDur = (src) => {
  const m = /[#&]d=([\d.]+)/.exec(src || '');
  const d = m ? parseFloat(m[1]) : 0;
  return isFinite(d) && d > 0 ? d : 0;
};

export default function InlineVideoPlayer({
  src,
  poster,
  className = '',
  style,
  videoClassName = '',
  maxHeightClass = 'max-h-64',
  objectFit = 'cover',
  rounded = true,
  // When provided (feed cards), a double-tap on the video surface LIKES the post
  // (Instagram model) with a centered heart pop; the single tap (play/pause) is
  // deferred 250ms so the 2nd tap can cancel it. Absent = instant play as before.
  onDoubleTapLike,
}) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(() => parseUrlDur(src));
  // Real intrinsic aspect ratio (w/h) once metadata loads, so portrait clips
  // aren't letterboxed into a wide box. Default 16:9 avoids a 0-height flash.
  const [ar, setAr] = useState(16 / 9);
  const [heartKey, setHeartKey] = useState(0); // double-tap heart pop (feed only)
  const tapRef = useRef({ timer: null, last: 0 });
  const seekingRef = useRef(false);

  const togglePlay = (e) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.muted = muted;
      try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch {/* ignore */}
    } else {
      v.pause();
    }
  };

  // Video-surface tap: without onDoubleTapLike it's an instant play/pause. With
  // it, a 2nd tap within 300ms cancels the pending play/pause and LIKES instead.
  const onSurfaceTap = (e) => {
    if (!onDoubleTapLike) return togglePlay(e);
    e?.stopPropagation();
    const now = Date.now();
    const t = tapRef.current;
    if (now - t.last < 300) {
      if (t.timer) { clearTimeout(t.timer); t.timer = null; }
      t.last = 0;
      onDoubleTapLike();
      setHeartKey((k) => k + 1);
    } else {
      t.last = now;
      if (t.timer) clearTimeout(t.timer);
      t.timer = setTimeout(() => { t.timer = null; togglePlay(); }, 250);
    }
  };
  const toggleMute = (e) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };
  const onSeek = (e) => {
    const v = videoRef.current;
    if (!v) return;
    const t = Number(e.target.value);
    setCur(t);
    try { v.currentTime = t; } catch {/* ignore */}
  };
  const toggleFullscreen = (e) => {
    e?.stopPropagation();
    const el = containerRef.current;
    const v = videoRef.current;
    try {
      if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
      if (el?.requestFullscreen) { el.requestFullscreen(); return; }
      if (el?.webkitRequestFullscreen) { el.webkitRequestFullscreen(); return; }
      // iOS Safari only allows fullscreen on the <video> element itself.
      if (v?.webkitEnterFullscreen) v.webkitEnterFullscreen();
    } catch {/* ignore */}
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full ${maxHeightClass} bg-black ${rounded ? 'rounded-sm' : ''} overflow-hidden ${className}`}
      style={{ aspectRatio: ar, ...style }}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        playsInline
        preload="metadata"
        onClick={onSurfaceTap}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={() => {
          const v = videoRef.current;
          if (!v) return;
          if (isFinite(v.duration) && v.duration > 0) setDur(v.duration);
          if (v.videoWidth && v.videoHeight) setAr(v.videoWidth / v.videoHeight);
        }}
        onDurationChange={() => { const v = videoRef.current; if (v && isFinite(v.duration) && v.duration > 0) setDur(v.duration); }}
        onTimeUpdate={() => { const v = videoRef.current; if (v && !seekingRef.current) setCur(v.currentTime || 0); }}
        className={`absolute inset-0 w-full h-full block ${videoClassName}`}
        style={{ objectFit }}
      />

      {/* Double-tap heart pop (feed only) */}
      {heartKey > 0 && (
        <span key={heartKey} className="media-heart-pop pointer-events-none absolute left-1/2 top-1/2 z-20" aria-hidden>
          <Icon name="favorite" filled size={84} className="text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]" />
        </span>
      )}

      {/* Big center play affordance while paused (leaves the control bar tappable) */}
      {!playing && (
        <button
          type="button"
          onClick={onSurfaceTap}
          aria-label="Play"
          className="absolute inset-x-0 top-0 bottom-9 flex items-center justify-center"
        >
          <span className="w-14 h-14 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center">
            <Icon name="play_arrow" size={32} className="text-white relative left-[1px]" />
          </span>
        </button>
      )}

      {/* Custom control bar — HTML elements DO receive touch in the WebView */}
      <div
        className="absolute bottom-0 inset-x-0 flex items-center gap-2 px-2.5 py-1.5"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} className="shrink-0 text-white flex items-center">
          <Icon name={playing ? 'pause' : 'play_arrow'} size={20} />
        </button>
        <span className="shrink-0 text-white text-[10px] font-dmmono tabular-nums">{fmtClock(cur)}</span>
        <input
          type="range"
          min={0}
          max={dur || 0}
          step="0.1"
          value={Math.min(cur, dur || 0)}
          onChange={onSeek}
          onPointerDown={() => { seekingRef.current = true; }}
          onPointerUp={() => { seekingRef.current = false; }}
          onTouchStart={() => { seekingRef.current = true; }}
          onTouchEnd={() => { seekingRef.current = false; }}
          aria-label="Seek"
          className="flex-1 h-1 min-w-0"
          style={{ accentColor: '#B44FFF' }}
        />
        <span className="shrink-0 text-white text-[10px] font-dmmono tabular-nums">{fmtClock(dur)}</span>
        <button type="button" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} className="shrink-0 text-white flex items-center">
          <Icon name={muted ? 'volume_off' : 'volume_up'} size={18} />
        </button>
        <button type="button" onClick={toggleFullscreen} aria-label="Fullscreen" className="shrink-0 text-white flex items-center">
          <Icon name="fullscreen" size={18} />
        </button>
      </div>
    </div>
  );
}
