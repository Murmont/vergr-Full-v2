// InlineAudioPlayer — compact <audio> with CUSTOM HTML controls.
// Same rationale as InlineVideoPlayer: the native <audio controls> bar does not
// receive touch in the Tauri Android WebView, so we drive an <audio> element
// with our own play/pause button + seek slider + time. Works on web + native.
import { useRef, useState } from 'react';
import Icon from '../Icon';

const fmtClock = (s) => {
  s = Number(s);
  if (!isFinite(s) || s < 0) s = 0; // MediaRecorder WebM reports Infinity
  s = Math.floor(s);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

// Voice notes are recorded with MediaRecorder, which reports duration=Infinity
// until the file is fully downloaded. The recorder stamps the real length onto
// the URL as a #d= fragment; read that rather than forcing a full download.
const parseUrlDur = (src) => {
  const m = /[#&]d=([\d.]+)/.exec(src || '');
  const d = m ? parseFloat(m[1]) : 0;
  return isFinite(d) && d > 0 ? d : 0;
};

export default function InlineAudioPlayer({ src, className = '' }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(() => parseUrlDur(src));
  const seekingRef = useRef(false);
  const durKnown = isFinite(dur) && dur > 0;

  const togglePlay = (e) => {
    e?.stopPropagation();
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { try { const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch {/* ignore */} }
    else a.pause();
  };
  const onSeek = (e) => {
    const a = audioRef.current;
    if (!a) return;
    const t = Number(e.target.value);
    setCur(t);
    try { a.currentTime = t; } catch {/* ignore */}
  };

  return (
    <div className={`flex items-center gap-2.5 min-w-[200px] ${className}`}>
      <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}
        className="w-9 h-9 rounded-full bg-brand-violet/20 text-brand-violet-light flex items-center justify-center shrink-0 active:scale-90 transition-transform">
        <Icon name={playing ? 'pause' : 'play_arrow'} size={22} />
      </button>
      <input
        type="range" min={0} max={durKnown ? dur : 0} step="0.1" value={Math.min(cur, durKnown ? dur : 0)}
        onChange={onSeek}
        onPointerDown={() => { seekingRef.current = true; }}
        onPointerUp={() => { seekingRef.current = false; }}
        onTouchStart={() => { seekingRef.current = true; }}
        onTouchEnd={() => { seekingRef.current = false; }}
        aria-label="Seek" className="flex-1 h-1.5 min-w-0" style={{ accentColor: '#B44FFF' }}
      />
      <span className="shrink-0 text-[10px] font-dmmono tabular-nums opacity-70">
        {fmtClock(cur)}{durKnown ? `/${fmtClock(dur)}` : ''}
      </span>
      <audio
        ref={audioRef} src={src} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onLoadedMetadata={() => { const a = audioRef.current; if (a && isFinite(a.duration) && a.duration > 0) setDur(a.duration); }}
        onDurationChange={() => { const a = audioRef.current; if (a && isFinite(a.duration) && a.duration > 0) setDur(a.duration); }}
        onTimeUpdate={() => { const a = audioRef.current; if (a && !seekingRef.current) setCur(a.currentTime || 0); }}
      />
    </div>
  );
}
