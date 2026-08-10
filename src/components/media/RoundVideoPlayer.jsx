// Round video-note player (Telegram "video note").
//
// A video note is RECORDED as a square (640x640) — the circle is a CSS mask.
// So it must always be PRESENTED as a circle: tapping one grows it to a
// centered circle over a dimmed background, never a full-screen rectangle.
// That is the deliberate difference from a gallery video, which does open
// full-screen. This component is shared by the chat thread and the Shared
// Media panel so the two can never drift apart.

import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import { fmtClock, parseUrlDur, claimPlayback } from '../../utils/mediaPlayback';

/** The interactive circle itself. Autoplays with sound on mount. */
export function RoundVideoPlayer({ src, size }) {
  const STROKE = 5;
  const R = (size - STROKE) / 2 - 1;
  const CIRC = 2 * Math.PI * R;
  const videoRef = useRef(null);
  const wrapRef = useRef(null);
  const draggingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(() => parseUrlDur(src));
  const [rate, setRate] = useState(1); // 1 → 1.5 → 2 (Telegram)

  // Duration from the #d= hint or finite metadata only — never a far seek
  // (that downloads the whole file).
  const resolveDuration = () => {
    const v = videoRef.current; if (!v) return;
    if (isFinite(v.duration) && v.duration > 0) setDur(v.duration);
  };

  useEffect(() => {
    const v = videoRef.current; if (!v) return;
    v.muted = false;
    try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
  }, []);

  const togglePlay = () => {
    const v = videoRef.current; if (!v) return;
    if (v.paused) {
      v.muted = false;
      v.playbackRate = rate;
      try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
    } else { v.pause(); }
  };
  const cycleRate = (e) => {
    e.stopPropagation();
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    const v = videoRef.current; if (v) v.playbackRate = next;
  };

  // Drag around the rim = scrub (angle → time, 0 at 12 o'clock, clockwise).
  const seekFromPoint = (clientX, clientY) => {
    const w = wrapRef.current, v = videoRef.current;
    if (!w || !v || !dur || !isFinite(dur)) return;
    const rect = w.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const ang = Math.atan2(clientY - cy, clientX - cx);
    let frac = (ang + Math.PI / 2) / (2 * Math.PI);
    if (frac < 0) frac += 1;
    const t = frac * dur;
    try { v.currentTime = t; } catch { /* ignore */ }
    setCur(t);
  };
  const onPointerDown = (e) => {
    const w = wrapRef.current; if (!w) return;
    const rect = w.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    if (Math.hypot(dx, dy) > rect.width * 0.34) {
      draggingRef.current = true;
      try { w.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      seekFromPoint(e.clientX, e.clientY);
    }
  };
  const onPointerMove = (e) => { if (draggingRef.current) seekFromPoint(e.clientX, e.clientY); };
  const onPointerUp = () => {
    if (draggingRef.current) { draggingRef.current = false; return; }
    togglePlay();
  };

  const progress = dur > 0 && isFinite(dur) ? Math.min(1, cur / dur) : 0;
  const remain = Math.max(0, (dur || 0) - cur);

  return (
    <div className="relative" style={{ width: size, height: size }} onClick={(e) => e.stopPropagation()}>
      <div
        ref={wrapRef}
        className="absolute inset-0 rounded-full overflow-hidden bg-black select-none touch-none cursor-pointer shadow-2xl"
        onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e); }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { draggingRef.current = false; }}
      >
        <video
          ref={videoRef}
          src={src}
          playsInline
          preload="auto"
          className="w-full h-full object-cover pointer-events-none"
          onPlay={() => { setPlaying(true); claimPlayback(videoRef.current); }}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setCur(0); const v = videoRef.current; if (v) { try { v.currentTime = 0; } catch { /* ignore */ } } }}
          onLoadedMetadata={resolveDuration}
          onDurationChange={resolveDuration}
          onTimeUpdate={() => { const v = videoRef.current; if (v && !draggingRef.current) setCur(v.currentTime || 0); }}
        />
      </div>

      <svg className="absolute inset-0 pointer-events-none" width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={STROKE} />
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="#B44FFF" strokeWidth={STROKE} strokeLinecap="round"
          strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - progress)} />
      </svg>

      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="w-16 h-16 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center">
            <Icon name="play_arrow" size={40} className="text-white relative left-[1px]" />
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={cycleRate}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Playback speed"
        className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-sm"
      >
        <Icon name={playing ? 'pause' : 'videocam'} size={13} className="text-white" />
        <span className="text-white text-[11px] font-dmmono tabular-nums">{fmtClock(playing ? remain : dur)}</span>
        {rate !== 1 && <span className="text-brand-violet-light text-[11px] font-bold tabular-nums">{rate}x</span>}
      </button>
    </div>
  );
}

/** Centered circle over a dimmed backdrop, portalled to <body>. */
export function RoundVideoOverlay({ src, onClose }) {
  const size = typeof window !== 'undefined'
    ? Math.min(Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.82), 360)
    : 300;
  return createPortal(
    <div
      className="fixed inset-0 z-[9997] flex items-center justify-center bg-black/70 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <RoundVideoPlayer src={src} size={size} />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose?.(); }}
        aria-label="Close"
        className="absolute top-5 right-5 w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center text-white active:scale-90"
      >
        <Icon name="close" size={22} />
      </button>
    </div>,
    document.body
  );
}

export default RoundVideoPlayer;
