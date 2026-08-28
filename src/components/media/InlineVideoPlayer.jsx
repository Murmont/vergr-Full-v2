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
import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { pickVideoUrl, primeAdaptiveConfig } from '../../utils/adaptiveVideo';
import Ambilight from '../effects/visual/Ambilight';

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
  // Ambient light thrown from the video into the page behind it.
  //
  // OFF by default, deliberately: a feed of twenty cards each throwing light
  // would be noise, and only the caller knows whether its surface has room for
  // the glow to land on. Turn it on where the video is the subject — the
  // lightbox, a profile clip, the live viewer — not in a dense list.
  ambilight = false,
  ambilightSpread = 90,
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
  // Optional adaptive renditions (`post.adaptiveRenditions`). ABSENT or empty
  // means this component behaves EXACTLY as it always has: it plays `src`.
  renditions,
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

  // THE line that was missing. `<video src={resolvedSrc}>` below referenced an
  // identifier that existed nowhere in this file, so mounting the element threw
  // `ReferenceError: resolvedSrc is not defined` — and with no error boundary
  // (A50) that unmounted the ENTIRE React tree to a blank page. Reported as
  // "when I click to enlarge the screen goes blank"; the same crash was reachable
  // from all 12 components that render this player, so video playback was broken
  // app-wide (audit A41 #1).
  //
  // `pickVideoUrl` is what it was always meant to be: already imported at the
  // top of this file, never called. It is defensive by design — no renditions,
  // a fast connection, or any surprise at all returns `src` unchanged, which is
  // exactly the documented "behaves EXACTLY as it always has" contract on the
  // `renditions` prop above.
  const resolvedSrc = pickVideoUrl(src, renditions);

  // HLS sources (.m3u8) need hls.js everywhere except Safari, which demuxes
  // them natively. This player is reached with an HLS url by past-broadcast
  // replays: a Pro replay IS the broadcast's own manifest and segments on R2
  // (see functions/vodArchive.js), not a remuxed mp4, so without this branch
  // "Watch replay" would show a black frame in Chrome, Edge, Firefox, the
  // desktop WebView2 shell and the Android WebView.
  //
  // hls.js is imported lazily so the ~150KB parser is not pulled into the
  // bundle for the twelve callsites that only ever play a plain mp4 or webm.
  const isHls = /\.m3u8(\?|#|$)/i.test(resolvedSrc || '');
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isHls || !resolvedSrc) return undefined;
    // Safari/iOS: native. Assigning src directly is both simpler and better
    // (hardware decode, AirPlay), so do not attach hls.js over the top of it.
    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = resolvedSrc;
      return undefined;
    }
    let hls;
    let cancelled = false;
    import('hls.js').then(({ default: Hls }) => {
      if (cancelled || !videoRef.current) return;
      if (!Hls.isSupported()) { videoRef.current.src = resolvedSrc; return; }
      hls = new Hls({ enableWorker: true });
      hls.loadSource(resolvedSrc);
      hls.attachMedia(videoRef.current);
    }).catch(() => { if (!cancelled && videoRef.current) videoRef.current.src = resolvedSrc; });
    return () => { cancelled = true; if (hls) hls.destroy(); };
  }, [resolvedSrc, isHls]);

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

  // The player's own box is `overflow-hidden` — it has to be, to clip the video
  // to its rounded corners — so light drawn inside it is cut off at exactly the
  // edges it needs to cross. With ambilight on, the player is wrapped in an
  // UNCLIPPED outer box that owns the glow, and this clipped box becomes its
  // child. `className`/`style` move to the wrapper so the caller's sizing still
  // applies to the outermost element, as it did before.
  const inner = (
    <div
      ref={containerRef}
      className={`relative w-full ${maxHeightClass} bg-black ${rounded ? 'rounded-sm' : ''} overflow-hidden ${ambilight ? '' : className}`}
      style={ambilight ? { aspectRatio: ar } : { aspectRatio: ar, ...style }}
    >
      {/* src is left off for HLS: the effect above attaches it, via hls.js on
          MSE browsers or a direct assignment on Safari. Setting it here as
          well would make the browser fetch the manifest as a plain media file
          and fight hls.js for the element. */}
      <video
        ref={videoRef}
        src={isHls ? undefined : resolvedSrc}
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

  if (!ambilight) return inner;
  // The wrapper is PADDED by the spread, and the glow fills the padded box, so
  // the light occupies space the layout already reserved and cannot reach a
  // neighbour (00-RULES R1).
  //
  // ⚠ This path is for a video that is the SUBJECT of its screen — the
  // lightbox, a dedicated clip page. In a FEED, do not use it: the card owns
  // one glow behind all of its content (see PostCard), because a per-player
  // padded box inside a card fights the card's own layout and the feather has
  // nowhere to fall off to. That combination is what produced the darkened
  // border around feed videos.
  //
  // `isolation: isolate` makes this a stacking context so the z-index:-1 glow
  // paints above the wrapper's background and below the video. Without it the
  // glow escapes to an ancestor context and is covered by the first opaque
  // background above it (R6).
  return (
    <div
      className={`relative ${className}`}
      style={{ isolation: 'isolate', padding: ambilightSpread, ...style }}
    >
      <Ambilight videoRef={videoRef} enabled spread={ambilightSpread} intensity={0.6} />
      {inner}
    </div>
  );
}
