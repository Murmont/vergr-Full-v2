// VodFlagScrubber — custom seek bar overlay that surfaces every AI cheat
// flag at its real timestamp along the VOD duration. Renders below the
// native <video> in CheatFlagClipScreen so mods can visually scan where
// flags cluster + jump to any moment with one click.
//
// Pure presentation — takes a videoRef + flags[] + the current
// flagIndex (for "you are here" highlight). Hooks into the video element
// for live currentTime + duration tracking.

import { useEffect, useRef, useState } from 'react';

const PALETTE = {
  bar:       'rgba(255,255,255,0.10)',
  progress:  '#B44FFF',
  high:      '#F04060',   // sev 4-5
  med:       '#F0A500',   // sev 3
  low:       '#7B6FFF',   // sev 1-2
  current:   '#FFFFFF',
};

function severityColor(sev) {
  return sev >= 4 ? PALETTE.high : sev >= 3 ? PALETTE.med : PALETTE.low;
}

export default function VodFlagScrubber({ videoRef, flags = [], currentFlagIdx = -1 }) {
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [hover, setHover] = useState(null); // { idx, pctX }
  const trackRef = useRef(null);

  // Subscribe to the video element. videoRef is a React ref to a <video>.
  useEffect(() => {
    const v = videoRef?.current;
    if (!v) return;
    const onMeta = () => setDuration(v.duration || 0);
    const onTime = () => setTime(v.currentTime || 0);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('durationchange', onMeta);
    v.addEventListener('timeupdate', onTime);
    if (v.readyState >= 1) onMeta();
    return () => {
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('durationchange', onMeta);
      v.removeEventListener('timeupdate', onTime);
    };
  }, [videoRef]);

  // Seek-by-delta helper. Clamps to [0, duration].
  const seekRel = (delta) => {
    const v = videoRef?.current;
    if (!v) return;
    const next = Math.max(0, Math.min((v.duration || 0), (v.currentTime || 0) + delta));
    try { v.currentTime = next; } catch {}
  };

  // Keyboard shortcuts for mod review workflow. Hotkeys global to the page
  // (no focus required) but ignored while typing in an input/textarea.
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      if (e.key === 'J' || e.key === 'j') { seekRel(-30); e.preventDefault(); }
      else if (e.key === 'L' || e.key === 'l') { seekRel(30);  e.preventDefault(); }
      else if (e.key === 'ArrowLeft')  { seekRel(e.shiftKey ? -30 : -10); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { seekRel(e.shiftKey ?  30 :  10); e.preventDefault(); }
      else if (e.key === ' ') {
        const v = videoRef?.current;
        if (v) { if (v.paused) v.play(); else v.pause(); }
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [videoRef]);

  // Click-to-seek anywhere on the track.
  const seekToClientX = (clientX) => {
    const v = videoRef?.current;
    const el = trackRef.current;
    if (!v || !el || !duration) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    try { v.currentTime = pct * duration; } catch {}
  };
  const seekToFlag = (flag) => {
    const v = videoRef?.current;
    if (!v || !flag) return;
    try { v.currentTime = Math.max(0, (flag.tSec || 0) - 5); } catch {}
  };

  const progressPct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div style={{ marginTop: 12, userSelect: 'none' }}>
      {/* Header — seek shortcuts + counts per severity. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 10, color: 'rgba(255,255,255,0.5)',
        fontFamily: 'DM Mono, monospace', marginBottom: 6,
        textTransform: 'uppercase', letterSpacing: '0.12em',
        flexWrap: 'wrap',
      }}>
        {/* Rewind / forward buttons. Keyboard: J / L (or Shift+Arrow). */}
        <button onClick={() => seekRel(-30)} title="Rewind 30 seconds (J)"
          style={seekBtn}>
          <span style={{ fontSize: 12 }}>⟲</span> −30s
        </button>
        <button onClick={() => seekRel(-10)} title="Rewind 10 seconds (Left arrow)"
          style={seekBtn}>−10s</button>
        <button onClick={() => seekRel(10)} title="Forward 10 seconds (Right arrow)"
          style={seekBtn}>+10s</button>
        <button onClick={() => seekRel(30)} title="Forward 30 seconds (L)"
          style={seekBtn}>+30s <span style={{ fontSize: 12 }}>⟳</span></button>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>{flags.length} flag{flags.length === 1 ? '' : 's'}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: PALETTE.high }} />
            sev 4-5
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: PALETTE.med }} />
            sev 3
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: PALETTE.low }} />
            sev 1-2
          </span>
        </span>
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        onClick={(e) => seekToClientX(e.clientX)}
        onMouseLeave={() => setHover(null)}
        style={{
          position: 'relative', height: 28, borderRadius: 6,
          background: PALETTE.bar, cursor: 'pointer',
        }}
      >
        {/* Progress fill */}
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0,
          width: `${progressPct}%`, background: PALETTE.progress + '40',
          borderRadius: '6px 0 0 6px',
          transition: 'width 120ms linear',
          pointerEvents: 'none',
        }} />

        {/* Playhead */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${progressPct}%`, width: 2,
          background: PALETTE.current, transform: 'translateX(-1px)',
          boxShadow: '0 0 8px rgba(255,255,255,0.7)',
          pointerEvents: 'none',
        }} />

        {/* Flag markers */}
        {duration > 0 && flags.map((f, i) => {
          const pct = Math.max(0, Math.min(100, ((f.tSec || 0) / duration) * 100));
          const color = severityColor(f.severity || 0);
          const isCurrent = i === currentFlagIdx;
          const isHover = hover?.idx === i;
          return (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); seekToFlag(f); }}
              onMouseEnter={() => setHover({ idx: i, pctX: pct })}
              onFocus={() => setHover({ idx: i, pctX: pct })}
              title={`${f.type} · sev ${f.severity}/5 · ${(f.tSec || 0).toFixed(1)}s`}
              style={{
                position: 'absolute', top: -2, bottom: -2, left: `${pct}%`,
                transform: 'translateX(-50%)',
                width: isCurrent || isHover ? 6 : 4, padding: 0,
                background: color,
                border: isCurrent ? `2px solid ${PALETTE.current}` : 'none',
                borderRadius: 3, cursor: 'pointer',
                boxShadow: `0 0 ${isHover ? 12 : 6}px ${color}88`,
                transition: 'width 80ms, box-shadow 120ms',
              }}
            />
          );
        })}

        {/* Hover tooltip — sits above the marker */}
        {hover !== null && flags[hover.idx] && (
          <div style={{
            position: 'absolute', bottom: '110%', left: `${hover.pctX}%`,
            transform: 'translateX(-50%)',
            padding: '6px 9px', borderRadius: 6,
            background: '#14141F', border: '1px solid rgba(255,255,255,0.10)',
            fontSize: 11, color: '#fff', whiteSpace: 'nowrap',
            pointerEvents: 'none', zIndex: 5,
            boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
          }}>
            <span style={{ color: severityColor(flags[hover.idx].severity || 0), fontWeight: 800 }}>
              {flags[hover.idx].type}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.55)' }}>
              {' · '}sev {flags[hover.idx].severity}/5
              {' · '}{Math.floor((flags[hover.idx].tSec || 0) / 60)}:
              {String(Math.floor((flags[hover.idx].tSec || 0) % 60)).padStart(2, '0')}
            </span>
            {flags[hover.idx].note && (
              <div style={{ marginTop: 4, color: 'rgba(255,255,255,0.7)',
                whiteSpace: 'normal', maxWidth: 320, lineHeight: 1.4 }}>
                {flags[hover.idx].note}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Duration readout */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', marginTop: 4,
        fontSize: 10, color: 'rgba(255,255,255,0.45)', fontFamily: 'DM Mono, monospace',
      }}>
        <span>{fmtTime(time)}</span>
        <span>{fmtTime(duration)}</span>
      </div>
    </div>
  );
}

function fmtTime(s) {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

const seekBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 10px', borderRadius: 6,
  background: 'rgba(180, 79, 255,0.10)', color: '#B44FFF',
  border: '1px solid rgba(180, 79, 255,0.30)',
  fontSize: 10, fontWeight: 800, cursor: 'pointer',
  fontFamily: 'DM Mono, monospace', letterSpacing: '0.06em',
};
