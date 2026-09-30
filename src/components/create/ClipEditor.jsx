// The clip editor: step two of /create/clip, between recording or picking a video
// and posting it (founder, 2026-09-13: "build editing tools ... so that users can
// actually create good clips").
//
// PHONE: TikTok's editor. The clip fills the screen, "Add sound" sits on top, the
// tools run down the right edge and Next is bottom right. A tool opens a panel
// under the clip and the clip shrinks to stay fully visible above it; text is
// written straight onto the video, and anything placed can be dragged, pinched,
// or dropped on the bin to delete it.
//
// DESKTOP (`wide`): an editor page. Tools on the left, the clip in the middle, the
// open tool's controls on the right, Next in the header.
//
// What each tool produces (utils/clipEdits.js): a trim and a silenced original are
// cut into the file when the clip is posted; text, stickers, speed and the sound
// mix are stored on the post and drawn by the player, so what is placed here is
// what a viewer sees. Positions are fractions of the picture, never of the screen.
//
// House rules: solid values only (scrims excepted, and marked), no hairline
// borders, and the clip is never cropped.
import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { SoundSheet } from '../clips/SoundPicker';
import { useLayeredSound, PausedGlyph } from '../../screens/shorts/playerParts';
import { useContentRect, useTrimLoop } from '../clips/EditOverlays';
import {
  SPEEDS, TEXT_FONTS, TEXT_COLORS, STICKERS, MAX_OVERLAYS, MAX_TEXT,
  fontById, fmtTime, newTextOverlay, newStickerOverlay, overlayCss, extractFrames,
} from '../../utils/clipEdits';

const C = {
  page: '#0B0B14',
  card: '#14141F',
  raised: '#1E1E2C',
  chip: '#15151F',
  track: '#2E2E40',
  violet: '#7B1FFF',
  ember: '#F04060',
  muted: '#9CA3AF',
};
const SHADOW = { filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.65))' };
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

export const EDITOR_TOOLS = [
  { id: 'trim', label: 'Trim', icon: 'content_cut', needsLength: true },
  { id: 'text', label: 'Text', icon: 'text_fields' },
  { id: 'stickers', label: 'Stickers', icon: 'add_reaction' },
  { id: 'speed', label: 'Speed', icon: 'speed' },
  { id: 'volume', label: 'Volume', icon: 'volume_up' },
  { id: 'cover', label: 'Cover', icon: 'image', needsLength: true },
];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
// Where the next text or sticker lands, so a new one never sits on the last.
const spot = (n) => ({ x: 0.5 + ((n % 3) - 1) * 0.2, y: 0.34 + (n % 4) * 0.12 });
const secs = (s) => `${(Math.round(s * 10) / 10).toFixed(1)}s`;
const rangeFill = (value, min, max) => {
  const p = ((value - min) / (max - min || 1)) * 100;
  return { background: `linear-gradient(to right, ${C.violet} ${p}%, ${C.track} ${p}%)` };
};

const EDITOR_CSS = `
.vg-range{-webkit-appearance:none;appearance:none;height:4px;border-radius:999px;outline:none;cursor:pointer}
.vg-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:18px;height:18px;border-radius:50%;background:#FFFFFF;box-shadow:0 1px 4px rgba(0,0,0,.5)}
.vg-range::-moz-range-thumb{width:18px;height:18px;border-radius:50%;border:0;background:#FFFFFF}
.vg-text-input:empty::before{content:attr(data-placeholder);opacity:.55}
.vg-hscroll{scrollbar-width:none}.vg-hscroll::-webkit-scrollbar{display:none}
`;

export default function ClipEditor({
  video, trim, onTrim, edits, onEdits, coverAt, onCoverAt, soundChoice,
  wide = false, initialTool = null, onBack, onNext,
}) {
  const stageRef = useRef(null);
  const videoRef = useRef(null);
  const trashRef = useRef(null);
  const autoMuted = useRef(false);
  const [tool, setTool] = useState(initialTool || (wide ? 'trim' : null));
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);       // the text being written
  const [dragging, setDragging] = useState(null); // { overTrash } while an overlay moves
  const [frames, setFrames] = useState([]);
  const [paused, setPaused] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);

  const duration = video.duration > 0 && Number.isFinite(video.duration) ? video.duration : 0;
  const trimEnd = duration && trim.end < duration - 0.05 ? trim.end : null;
  const sound = soundChoice?.sound || null;
  const overlays = edits.overlays;
  const full = overlays.length >= MAX_OVERLAYS;
  const selected = overlays.find((o) => o.id === selectedId) || null;
  const playLength = Math.max(0, ((trimEnd ?? duration) - trim.start) / (edits.speed || 1));
  const rect = useContentRect(stageRef, videoRef, false, true);

  useTrimLoop(videoRef, trim.start, trimEnd, tool !== 'cover');
  useLayeredSound({
    ref: videoRef,
    active: true,
    muted: false,
    sound: sound?.url ? { url: sound.url, keepOriginal: true } : null,
    volume: edits.soundVolume,
    timeScale: edits.speed,
    offset: trim.start,
  });

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.defaultPlaybackRate = edits.speed;
    v.playbackRate = edits.speed;
  }, [edits.speed]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.volume = clamp(edits.originalVolume, 0, 1);
  }, [edits.originalVolume]);

  // Play with sound where the browser allows it, silently where it does not; the
  // first tap on the clip then turns the sound on rather than pausing it.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    autoMuted.current = false;
    v.muted = false;
    v.play().catch(() => {
      autoMuted.current = true;
      v.muted = true;
      v.play().catch(() => {});
    });
  }, [video.preview]);

  useEffect(() => {
    let alive = true;
    setFrames([]);
    extractFrames(video.preview, duration, wide ? 14 : 10).then((f) => { if (alive) setFrames(f); });
    return () => { alive = false; };
  }, [video.preview, duration, wide]);

  // The cover tool holds the clip on the chosen frame.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || tool !== 'cover') return;
    v.pause();
    try { v.currentTime = coverAt; } catch { /* not seekable yet */ }
  }, [tool, coverAt]);

  const lastTool = useRef(tool);
  useEffect(() => {
    const v = videoRef.current;
    if (lastTool.current === 'cover' && tool !== 'cover' && v) {
      try { v.currentTime = trim.start; } catch { /* not seekable yet */ }
      v.play().catch(() => {});
    }
    lastTool.current = tool;
  }, [tool, trim.start]);

  const setOverlays = (fn) => onEdits((e) => ({ ...e, overlays: fn(e.overlays) }));
  const updateOverlay = (id, patch) => setOverlays((list) => list.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const deleteOverlay = (id) => {
    setOverlays((list) => list.filter((o) => o.id !== id));
    setSelectedId((s) => (s === id ? null : s));
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (autoMuted.current) {
      autoMuted.current = false;
      v.muted = false;
      if (v.paused) v.play().catch(() => {});
      return;
    }
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const openText = (existing) => {
    if (!existing && full) return;
    setSelectedId(null);
    if (!wide) setTool(null);
    videoRef.current?.pause();
    setDraft(existing ? { ...existing } : newTextOverlay(spot(overlays.length)));
  };

  const closeComposer = () => {
    setDraft(null);
    videoRef.current?.play().catch(() => {});
  };

  const commitText = () => {
    const d = draft;
    closeComposer();
    if (!d) return;
    const text = d.text.replace(/\n+$/, '');
    if (!text.trim()) {
      if (overlays.some((o) => o.id === d.id)) deleteOverlay(d.id);
      return;
    }
    setOverlays((list) => (list.some((o) => o.id === d.id)
      ? list.map((o) => (o.id === d.id ? { ...d, text } : o))
      : [...list, { ...d, text }].slice(0, MAX_OVERLAYS)));
    setSelectedId(d.id);
  };

  const addSticker = (emoji) => {
    if (full) return;
    const o = newStickerOverlay(emoji, spot(overlays.length));
    setOverlays((list) => [...list, o].slice(0, MAX_OVERLAYS));
    setSelectedId(o.id);
    if (!wide) setTool(null);
  };

  const pickTool = (id) => {
    setSelectedId(null);
    if (id === 'text' && !wide) { openText(null); return; }
    setTool((t) => (wide ? id : t === id ? null : id));
  };

  const onStageClick = () => {
    if (draft) return;
    if (selectedId) { setSelectedId(null); return; }
    if (!wide && tool) { setTool(null); return; }
    togglePlay();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (sheetOpen) return;
      const t = e.target;
      const typing = t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName || '');
      if (e.key === 'Escape') {
        if (draft) { e.preventDefault(); closeComposer(); }
        else if (selectedId) setSelectedId(null);
        else if (tool && !wide) setTool(null);
        return;
      }
      if (typing || draft) return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); deleteOverlay(selectedId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const soundPill = soundChoice ? (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setSheetOpen(true); }}
      className="pointer-events-auto h-9 max-w-[62%] px-4 rounded-full flex items-center gap-1.5 text-white text-[14px] font-semibold"
      style={{ background: C.chip }}
    >
      <Icon name="music_note" size={16} className="shrink-0" />
      <span className="truncate">{sound ? sound.title : 'Add sound'}</span>
    </button>
  ) : null;

  const soundSheet = sheetOpen && soundChoice ? (
    <SoundSheet
      selectedId={sound?.id}
      onClose={() => setSheetOpen(false)}
      onPick={(s) => { soundChoice.picker.onChange(s); setSheetOpen(false); }}
    />
  ) : null;

  const panel = (id) => {
    switch (id) {
      case 'trim':
        return <TrimPanel frames={frames} duration={duration} trim={trim} onTrim={onTrim} videoRef={videoRef} wide={wide} />;
      case 'speed':
        return <SpeedPanel value={edits.speed} onChange={(s) => onEdits((e) => ({ ...e, speed: s }))} hasSound={!!sound} wide={wide} />;
      case 'text':
        return <TextListPanel overlays={overlays} full={full} onAdd={() => openText(null)} onEdit={openText} onDelete={deleteOverlay} />;
      case 'stickers':
        return <StickerPanel onPick={addSticker} full={full} wide={wide} />;
      case 'volume':
        return (
          <VolumePanel
            wide={wide}
            original={edits.originalVolume}
            added={edits.soundVolume}
            sound={sound}
            onOriginal={(v) => onEdits((e) => ({ ...e, originalVolume: v }))}
            onAdded={(v) => onEdits((e) => ({ ...e, soundVolume: v }))}
            onAddSound={soundChoice ? () => setSheetOpen(true) : null}
            onRemoveSound={() => soundChoice?.picker.onChange(null)}
          />
        );
      case 'cover':
        return <CoverPanel frames={frames} duration={duration} trim={trim} coverAt={coverAt} onCoverAt={onCoverAt} wide={wide} />;
      default:
        return null;
    }
  };
  const toolMeta = EDITOR_TOOLS.find((t) => t.id === tool);
  const canNext = !duration || playLength >= 0.5;

  const selectedBar = selected && !draft && !dragging ? (
    <SelectedBar
      overlay={selected}
      onSize={(size) => updateOverlay(selected.id, { size })}
      onEdit={selected.kind === 'text' ? () => openText(selected) : null}
      onDelete={() => deleteOverlay(selected.id)}
      style={{ bottom: wide || tool ? 16 : 'calc(var(--vg-safe-b, 0px) + 84px)' }}
    />
  ) : null;

  const stageInner = (
    <>
      <video
        ref={videoRef}
        src={video.preview}
        playsInline
        preload="auto"
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onLoadedMetadata={(e) => {
          e.currentTarget.playbackRate = edits.speed;
          e.currentTarget.volume = clamp(edits.originalVolume, 0, 1);
        }}
        className="absolute inset-0 w-full h-full object-contain"
      />
      <OverlayLayer
        overlays={overlays}
        rect={rect}
        selectedId={selectedId}
        hiddenId={draft?.id}
        trashRef={trashRef}
        onSelect={setSelectedId}
        onTap={(o, wasSelected) => { if (wasSelected && o.kind === 'text') openText(o); else setSelectedId(o.id); }}
        onChange={updateOverlay}
        onDelete={deleteOverlay}
        onDrag={setDragging}
      />
      {paused && !draft && tool !== 'cover' && !dragging && <PausedGlyph />}
      {dragging && (
        <div
          ref={trashRef}
          aria-hidden
          className="absolute left-1/2 z-[6] w-14 h-14 rounded-full grid place-items-center transition-transform"
          style={{
            bottom: wide || tool ? 24 : 'calc(var(--vg-safe-b, 0px) + 28px)',
            background: dragging.overTrash ? C.ember : C.chip,
            transform: `translateX(-50%) scale(${dragging.overTrash ? 1.15 : 1})`,
          }}
        >
          <Icon name="delete" size={26} className="text-white" />
        </div>
      )}
      {selectedBar}
      {draft && <TextComposer draft={draft} onChange={setDraft} onCancel={closeComposer} onDone={commitText} />}
    </>
  );

  // ── PHONE ──
  if (!wide) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col bg-black">
        <style>{EDITOR_CSS}</style>
        <div ref={stageRef} className="relative flex-1 min-h-0 overflow-hidden" onClick={onStageClick}>
          {stageInner}

          {!draft && (
            <div
              className="absolute inset-x-0 top-0 z-[10] flex items-center justify-between px-2 pointer-events-none"
              style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 6px)' }}
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onBack(); }}
                aria-label="Back"
                className="pointer-events-auto w-11 h-11 grid place-items-center text-white"
                style={SHADOW}
              >
                <Icon name="arrow_back" size={26} />
              </button>
              {soundPill}
              <span className="w-11" aria-hidden />
            </div>
          )}

          {!draft && !tool && !dragging && (
            <div className="absolute right-1 z-[10] flex flex-col items-center gap-4" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 68px)' }}>
              {EDITOR_TOOLS.map((t) => (
                <RailTool
                  key={t.id}
                  tool={t}
                  disabled={t.needsLength && !duration}
                  onClick={(e) => { e.stopPropagation(); pickTool(t.id); }}
                />
              ))}
            </div>
          )}

          {!draft && !tool && !dragging && (
            <div
              className="absolute inset-x-0 bottom-0 z-[10] flex items-center justify-between px-4 pointer-events-none"
              style={{ paddingBottom: 'calc(var(--vg-safe-b, 0px) + 16px)' }}
            >
              <span className="h-8 px-3 rounded-full flex items-center gap-1.5 text-white text-[13px] font-semibold tabular-nums" style={{ background: C.chip }}>
                <Icon name="schedule" size={15} /> {fmtTime(playLength)}
              </span>
              <NextButton onClick={onNext} disabled={!canNext} />
            </div>
          )}
        </div>

        {tool && !draft && (
          <div className="shrink-0" style={{ background: C.card, borderRadius: '20px 20px 0 0', paddingBottom: 'calc(var(--vg-safe-b, 0px) + 8px)' }}>
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <h2 className="text-white text-[16px] font-bold">{toolMeta?.label}</h2>
              <button
                type="button"
                onClick={() => setTool(null)}
                aria-label="Done"
                className="w-9 h-9 rounded-full grid place-items-center text-white"
                style={{ background: C.violet }}
              >
                <Icon name="check" size={20} />
              </button>
            </div>
            {panel(tool)}
          </div>
        )}
        {soundSheet}
      </div>
    );
  }

  // ── DESKTOP ──
  return (
    <div className="min-h-screen" style={{ background: C.page }}>
      <style>{EDITOR_CSS}</style>
      <header className="sticky top-0 z-30" style={{ background: C.page }}>
        {/* pr-16 keeps Next clear of the app shell's fixed notification bell (top-4 right-4, 32px). */}
        <div className="w-full max-w-[1280px] mx-auto pl-4 pr-16 h-16 flex items-center gap-2">
          <button type="button" onClick={onBack} aria-label="Back" className="w-11 h-11 grid place-items-center rounded-full text-white hover:bg-[#1E1E2C]">
            <Icon name="arrow_back" size={24} />
          </button>
          <h1 className="font-syne font-bold text-white text-[20px]">Edit clip</h1>
          <span className="ml-2 h-7 px-2.5 rounded-full flex items-center text-[13px] font-semibold tabular-nums text-white" style={{ background: C.raised }}>
            {fmtTime(playLength)}
          </span>
          <div className="flex-1" />
          <NextButton onClick={onNext} disabled={!canNext} wide />
        </div>
      </header>
      <main className="w-full max-w-[1280px] mx-auto px-6 pb-10 grid gap-6 items-start" style={{ gridTemplateColumns: '84px minmax(0,1fr) 360px' }}>
        <nav className="sticky top-20 flex flex-col gap-1" aria-label="Editing tools">
          {EDITOR_TOOLS.map((t) => {
            const on = tool === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => pickTool(t.id)}
                disabled={t.needsLength && !duration}
                aria-pressed={on}
                className="h-[68px] rounded-xl flex flex-col items-center justify-center gap-1 text-[12px] font-semibold transition-colors disabled:opacity-40 hover:bg-[#191926]"
                style={{ background: on ? C.raised : undefined, color: on ? '#FFFFFF' : C.muted }}
              >
                <Icon name={t.icon} size={24} />
                {t.label}
              </button>
            );
          })}
        </nav>
        <section className="flex justify-center min-w-0">
          <div
            ref={stageRef}
            className="relative bg-black rounded-[20px] overflow-hidden"
            style={{ height: 'min(760px, calc(100vh - 104px))', aspectRatio: '9 / 16' }}
            onClick={onStageClick}
          >
            {stageInner}
            {!draft && soundPill && (
              <div className="absolute inset-x-0 top-3 z-[10] flex justify-center pointer-events-none">{soundPill}</div>
            )}
          </div>
        </section>
        <aside className="sticky top-20 rounded-2xl p-5" style={{ background: C.card }}>
          <h2 className="mb-4 text-white text-[16px] font-bold">{toolMeta?.label || 'Tools'}</h2>
          {panel(tool)}
        </aside>
      </main>
      {soundSheet}
    </div>
  );
}

function RailTool({ tool, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-[58px] flex flex-col items-center gap-0.5 text-white text-[11px] font-semibold disabled:opacity-40"
      style={SHADOW}
    >
      <Icon name={tool.icon} size={28} />
      {tool.label}
    </button>
  );
}

function NextButton({ onClick, disabled, wide = false }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      className={`pointer-events-auto rounded-full text-white font-bold active:scale-[0.98] transition-transform disabled:opacity-50 ${wide ? 'h-11 px-8 text-[15px]' : 'h-12 px-9 text-[16px]'}`}
      style={{ background: C.violet }}
    >
      Next
    </button>
  );
}

// Text and stickers on the clip: tap to select, drag to move, pinch to resize and
// turn, drop on the bin to delete. Scroll over a selected one on desktop to resize.
function OverlayLayer({ overlays, rect, selectedId, hiddenId, trashRef, onSelect, onTap, onChange, onDelete, onDrag }) {
  const gesture = useRef(null);
  if (!rect) return null;

  const overTrash = (x, y) => {
    const el = trashRef.current;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)) < 52;
  };

  return (
    <div className="absolute inset-0 z-[5] overflow-hidden pointer-events-none">
      {overlays.map((o) => {
        if (o.id === hiddenId) return null;
        const on = o.id === selectedId;
        const maxSize = o.kind === 'sticker' ? 0.6 : 0.3;

        const down = (e) => {
          e.stopPropagation();
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
          const g = gesture.current;
          if (g && g.id === o.id) {
            g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (g.pointers.size === 2) {
              const [a, b] = [...g.pointers.values()];
              g.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, angle: Math.atan2(b.y - a.y, b.x - a.x), size: o.size, rotation: o.rotation || 0 };
              g.moved = true;
              g.pinched = true;
              onDrag(null);
            }
            return;
          }
          gesture.current = {
            id: o.id,
            pointers: new Map([[e.pointerId, { x: e.clientX, y: e.clientY }]]),
            sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y,
            moved: false, pinch: null, pinched: false, wasSelected: on,
          };
        };

        const move = (e) => {
          const g = gesture.current;
          if (!g || g.id !== o.id || !g.pointers.has(e.pointerId)) return;
          g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (g.pinch && g.pointers.size >= 2) {
            const [a, b] = [...g.pointers.values()];
            const ratio = Math.hypot(a.x - b.x, a.y - b.y) / g.pinch.dist;
            const turn = ((Math.atan2(b.y - a.y, b.x - a.x) - g.pinch.angle) * 180) / Math.PI;
            const rotation = ((((g.pinch.rotation + turn + 180) % 360) + 360) % 360) - 180;
            onChange(o.id, { size: clamp(g.pinch.size * ratio, 0.02, maxSize), rotation: Math.round(rotation) });
            return;
          }
          const dx = e.clientX - g.sx;
          const dy = e.clientY - g.sy;
          if (!g.moved && Math.hypot(dx, dy) < 6) return;
          if (!g.moved) { g.moved = true; onSelect(o.id); }
          if (!g.pinched) onDrag({ overTrash: overTrash(e.clientX, e.clientY) });
          onChange(o.id, { x: clamp(g.ox + dx / rect.w, 0, 1), y: clamp(g.oy + dy / rect.h, 0, 1) });
        };

        const up = (e) => {
          const g = gesture.current;
          if (!g || g.id !== o.id) return;
          g.pointers.delete(e.pointerId);
          if (g.pointers.size > 0) {
            const [p] = [...g.pointers.values()];
            g.pinch = null;
            g.sx = p.x; g.sy = p.y; g.ox = o.x; g.oy = o.y;
            return;
          }
          gesture.current = null;
          onDrag(null);
          if (g.moved && !g.pinched && overTrash(e.clientX, e.clientY)) { onDelete(o.id); return; }
          if (!g.moved) onTap(o, g.wasSelected);
        };

        return (
          <div
            key={o.id}
            role="button"
            tabIndex={0}
            aria-label={o.kind === 'text' ? `Text: ${o.text}` : `Sticker ${o.text}`}
            aria-pressed={on}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => {
              if (!on) return;
              e.stopPropagation();
              onChange(o.id, { size: clamp(o.size * (e.deltaY < 0 ? 1.06 : 1 / 1.06), 0.02, maxSize) });
            }}
            style={{
              ...overlayCss(o, rect),
              pointerEvents: 'auto',
              touchAction: 'none',
              cursor: 'grab',
              userSelect: 'none',
              outline: on ? '2px solid #FFFFFF' : 'none',
              outlineOffset: 6,
            }}
          >
            {o.text}
          </div>
        );
      })}
    </div>
  );
}

function SelectedBar({ overlay, onSize, onEdit, onDelete, style }) {
  const max = overlay.kind === 'sticker' ? 0.6 : 0.3;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute left-1/2 z-[12] h-12 pl-4 pr-1.5 rounded-full flex items-center gap-2"
      style={{ background: C.card, transform: 'translateX(-50%)', ...style }}
    >
      <Icon name="format_size" size={18} className="text-white shrink-0" />
      <input
        type="range"
        min={0.02}
        max={max}
        step={0.005}
        value={overlay.size}
        aria-label="Size"
        onChange={(e) => onSize(Number(e.target.value))}
        className="vg-range w-[112px]"
        style={rangeFill(overlay.size, 0.02, max)}
      />
      {onEdit && (
        <button type="button" onClick={onEdit} className="h-9 px-3.5 rounded-full text-white text-[13px] font-semibold" style={{ background: C.raised }}>
          Edit
        </button>
      )}
      <button type="button" onClick={onDelete} aria-label="Delete" className="w-9 h-9 rounded-full grid place-items-center text-white" style={{ background: C.raised }}>
        <Icon name="delete" size={18} />
      </button>
    </div>
  );
}

// Writing text straight onto the clip, as TikTok does: the words appear in the
// chosen font, colour and background while they are typed.
function TextComposer({ draft, onChange, onCancel, onDone }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerText = draft.text || '';
    el.focus();
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch { /* the caret stays where the browser put it */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const look = overlayCss({ ...draft, x: 0, y: 0, size: 1, rotation: 0 }, { x: 0, y: 0, w: 30, h: 1 });
  const style = {
    ...look,
    position: 'relative',
    left: 'auto',
    top: 'auto',
    transform: 'none',
    display: 'inline-block',
    width: 'auto',
    maxWidth: `min(${(0.9 / (draft.size || 0.075)).toFixed(2)}em, 100%)`,
    minWidth: '1ch',
    outline: 'none',
    caretColor: '#FFFFFF',
    wordBreak: 'break-word',
  };
  const setField = (patch) => onChange((d) => ({ ...d, ...patch }));

  return (
    <div
      data-scrim
      className="absolute inset-0 z-[30] flex flex-col"
      style={{ background: 'rgba(0,0,0,0.62)' }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Add text"
    >
      <div className="flex items-center justify-between px-3" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}>
        <button type="button" onClick={onCancel} className="h-10 px-3 text-white text-[15px] font-semibold">Cancel</button>
        <button type="button" onClick={onDone} className="h-10 px-5 rounded-full text-white text-[15px] font-bold" style={{ background: C.violet }}>Done</button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center px-5 overflow-hidden" onClick={() => ref.current?.focus()}>
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Your text"
          data-placeholder="Type something"
          className="vg-text-input"
          style={style}
          onInput={(e) => setField({ text: e.currentTarget.innerText.slice(0, MAX_TEXT) })}
          onBeforeInput={(e) => { if (e.data && e.currentTarget.innerText.length >= MAX_TEXT) e.preventDefault(); }}
          onPaste={(e) => {
            e.preventDefault();
            const t = (e.clipboardData?.getData('text/plain') || '').slice(0, MAX_TEXT);
            document.execCommand('insertText', false, t);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onDone(); } }}
        />
      </div>
      {/* mousedown is cancelled so choosing a font never closes the keyboard */}
      <div className="px-3" style={{ paddingBottom: 'calc(var(--vg-safe-b, 0px) + 14px)' }} onMouseDown={(e) => e.preventDefault()}>
        <div className="vg-hscroll flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setField({ bg: draft.bg === 'solid' ? 'none' : 'solid' })}
            aria-pressed={draft.bg === 'solid'}
            aria-label="Text background"
            className="shrink-0 w-10 h-10 rounded-full grid place-items-center"
            style={{ background: draft.bg === 'solid' ? '#FFFFFF' : C.raised, color: draft.bg === 'solid' ? '#0B0B14' : '#FFFFFF' }}
          >
            <Icon name="format_color_fill" size={20} />
          </button>
          {TEXT_FONTS.map((f) => {
            const on = draft.font === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setField({ font: f.id })}
                aria-pressed={on}
                className="shrink-0 h-10 px-4 rounded-full text-[14px]"
                style={{ fontFamily: f.family, fontWeight: f.weight, background: on ? '#FFFFFF' : C.raised, color: on ? '#0B0B14' : '#FFFFFF' }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between px-1">
          {TEXT_COLORS.map((c) => {
            const on = draft.color === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setField({ color: c })}
                aria-label={`Colour ${c}`}
                aria-pressed={on}
                className="w-8 h-8 rounded-full"
                style={{ background: c, boxShadow: on ? '0 0 0 2px #0B0B14, 0 0 0 4px #FFFFFF' : c === '#0B0B14' ? 'inset 0 0 0 2px #3A3A4C' : 'none' }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function useVideoTime(videoRef) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return undefined;
    let raf = 0;
    let last = -1;
    const loop = () => {
      if (Math.abs(v.currentTime - last) > 0.03) { last = v.currentTime; setT(last); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);
  return t;
}

function Filmstrip({ frames, children }) {
  return (
    <div className="absolute inset-0 rounded-[10px] overflow-hidden flex" style={{ background: C.raised }}>
      {frames.map((src, i) => (
        <img key={i} src={src} alt="" draggable={false} className="h-full flex-1 min-w-0 object-cover" />
      ))}
      {children}
    </div>
  );
}

function NoLength({ wide }) {
  return (
    <p className={`text-[14px] leading-[20px] ${wide ? '' : 'px-5 pb-5'}`} style={{ color: C.muted }}>
      This video does not report its length on this device, so it cannot be cut here. Everything else still works.
    </p>
  );
}

// Drag the handles to cut the start and end. The clip shows the frame under the
// handle while dragging, then plays the kept part on a loop.
function TrimPanel({ frames, duration, trim, onTrim, videoRef, wide }) {
  const trackRef = useRef(null);
  const drag = useRef(null);
  const now = useVideoTime(videoRef);
  if (!duration) return <NoLength wide={wide} />;

  const MIN = Math.min(1, duration);
  const pct = (t) => `${(clamp(t, 0, duration) / duration) * 100}%`;
  const timeAt = (clientX) => {
    const r = trackRef.current.getBoundingClientRect();
    return clamp(((clientX - r.left) / r.width) * duration, 0, duration);
  };
  const seek = (t) => {
    const v = videoRef.current;
    if (v) { try { v.currentTime = clamp(t, 0, duration); } catch { /* not seekable yet */ } }
  };
  const setStart = (t) => { const s = clamp(t, 0, trim.end - MIN); onTrim({ start: s, end: trim.end }); seek(s); };
  const setEnd = (t) => { const e = clamp(t, trim.start + MIN, duration); onTrim({ start: trim.start, end: e }); seek(e - 0.05); };

  const handleProps = (which) => ({
    onPointerDown: (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      drag.current = which;
      videoRef.current?.pause();
    },
    onPointerMove: (e) => {
      if (drag.current !== which) return;
      if (which === 'start') setStart(timeAt(e.clientX));
      else setEnd(timeAt(e.clientX));
    },
    onPointerUp: () => {
      if (!drag.current) return;
      drag.current = null;
      seek(trim.start);
      videoRef.current?.play().catch(() => {});
    },
    onKeyDown: (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const step = e.key === 'ArrowLeft' ? -0.1 : 0.1;
      if (which === 'start') setStart(trim.start + step);
      else setEnd(trim.end + step);
    },
  });

  return (
    <div className={wide ? '' : 'px-5 pb-4'}>
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-[13px] tabular-nums" style={{ color: C.muted }}>{fmtTime(trim.start)}</span>
        <span className="text-white text-[15px] font-semibold tabular-nums">{secs(trim.end - trim.start)} kept</span>
        <span className="text-[13px] tabular-nums" style={{ color: C.muted }}>{fmtTime(trim.end)}</span>
      </div>
      <div
        ref={trackRef}
        className="relative h-[60px] mx-[14px] select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => { if (e.target === e.currentTarget || e.target.tagName === 'IMG') seek(clamp(timeAt(e.clientX), trim.start, trim.end)); }}
      >
        <Filmstrip frames={frames}>
          <div data-scrim className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: pct(trim.start), background: 'rgba(11,11,20,0.72)' }} />
          <div data-scrim className="absolute inset-y-0 right-0 pointer-events-none" style={{ width: `${100 - (trim.end / duration) * 100}%`, background: 'rgba(11,11,20,0.72)' }} />
        </Filmstrip>
        <div
          className="absolute inset-y-0 pointer-events-none"
          style={{ left: pct(trim.start), width: pct(trim.end - trim.start), boxShadow: 'inset 0 3px 0 #FFFFFF, inset 0 -3px 0 #FFFFFF' }}
        />
        <TrimHandle side="start" at={pct(trim.start)} label="Trim start" {...handleProps('start')} />
        <TrimHandle side="end" at={pct(trim.end)} label="Trim end" {...handleProps('end')} />
        <div
          aria-hidden
          className="absolute -top-1 -bottom-1 w-[3px] rounded-full pointer-events-none"
          style={{ left: pct(now), background: '#FFFFFF', boxShadow: '0 0 0 1px #0B0B14', transform: 'translateX(-50%)' }}
        />
      </div>
      <p className="mt-3 text-[12px]" style={{ color: C.muted }}>Drag the handles to cut the start and end.</p>
    </div>
  );
}

function TrimHandle({ side, at, label, onPointerDown, onPointerMove, onPointerUp, onKeyDown }) {
  const start = side === 'start';
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className="absolute inset-y-0 w-8 grid place-items-center cursor-ew-resize"
      style={{ left: at, transform: `translateX(${start ? -23 : -9}px)`, touchAction: 'none' }}
    >
      <span
        className="h-full w-[14px] grid place-items-center"
        style={{ background: '#FFFFFF', borderRadius: start ? '10px 2px 2px 10px' : '2px 10px 10px 2px' }}
      >
        <span className="w-[2px] h-5 rounded-full" style={{ background: '#0B0B14' }} />
      </span>
    </button>
  );
}

function CoverPanel({ frames, duration, trim, coverAt, onCoverAt, wide }) {
  const trackRef = useRef(null);
  const drag = useRef(false);
  if (!duration) return <NoLength wide={wide} />;

  const lo = trim.start;
  const hi = Math.max(lo, trim.end - 0.05);
  const set = (clientX) => {
    const r = trackRef.current.getBoundingClientRect();
    onCoverAt(clamp(((clientX - r.left) / r.width) * duration, lo, hi));
  };

  return (
    <div className={wide ? '' : 'px-5 pb-4'}>
      <p className="mb-3 text-[13px] leading-[18px]" style={{ color: C.muted }}>
        Pick the frame people see before they tap. Your text and stickers show on it too.
      </p>
      <div
        ref={trackRef}
        className="relative h-[60px] mx-[18px] select-none cursor-pointer"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ } drag.current = true; set(e.clientX); }}
        onPointerMove={(e) => { if (drag.current) set(e.clientX); }}
        onPointerUp={() => { drag.current = false; }}
        onPointerCancel={() => { drag.current = false; }}
      >
        <Filmstrip frames={frames}>
          <div data-scrim className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: `${(lo / duration) * 100}%`, background: 'rgba(11,11,20,0.72)' }} />
          <div data-scrim className="absolute inset-y-0 right-0 pointer-events-none" style={{ width: `${100 - (trim.end / duration) * 100}%`, background: 'rgba(11,11,20,0.72)' }} />
        </Filmstrip>
        <div
          aria-hidden
          className="absolute -top-1.5 -bottom-1.5 w-[36px] rounded-[8px] pointer-events-none"
          style={{ left: `calc(${(coverAt / duration) * 100}% - 18px)`, boxShadow: '0 0 0 3px #FFFFFF, 0 2px 10px rgba(0,0,0,0.6)' }}
        />
      </div>
      <p className="mt-3 text-[12px] tabular-nums" style={{ color: C.muted }}>Cover at {fmtTime(coverAt - trim.start)}</p>
    </div>
  );
}

function SpeedPanel({ value, onChange, hasSound, wide }) {
  return (
    <div className={wide ? '' : 'px-5 pb-5'}>
      <div className="flex p-1 rounded-full" style={{ background: C.raised }} role="radiogroup" aria-label="Speed">
        {SPEEDS.map((s) => {
          const on = value === s;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(s)}
              className="flex-1 h-10 rounded-full text-[14px] font-bold tabular-nums transition-colors"
              style={{ background: on ? '#FFFFFF' : undefined, color: on ? '#0B0B14' : '#FFFFFF' }}
            >
              {s}x
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[13px] leading-[18px]" style={{ color: C.muted }}>
        {hasSound ? 'The clip changes speed; your added sound keeps its normal speed.' : 'Slow it down for a replay, or speed it up to keep it tight.'}
      </p>
    </div>
  );
}

function VolumePanel({ original, added, onOriginal, onAdded, sound, onAddSound, onRemoveSound, wide }) {
  return (
    <div className={wide ? 'space-y-5' : 'px-5 pb-5 space-y-5'}>
      <div>
        <Slider label="Original sound" icon="videocam" value={original} onChange={onOriginal} />
        {original === 0 && (
          <p className="mt-2 text-[12px]" style={{ color: C.muted }}>The video's own sound is removed when you post.</p>
        )}
      </div>
      {sound ? (
        <>
          <Slider label={sound.title} icon="music_note" value={added} onChange={onAdded} />
          <button type="button" onClick={onRemoveSound} className="h-10 px-4 rounded-full text-white text-[14px] font-semibold" style={{ background: C.raised }}>
            Remove sound
          </button>
        </>
      ) : onAddSound ? (
        <button
          type="button"
          onClick={onAddSound}
          className="w-full h-12 rounded-[12px] flex items-center justify-center gap-2 text-white text-[15px] font-semibold"
          style={{ background: C.raised }}
        >
          <Icon name="music_note" size={20} /> Add a sound
        </button>
      ) : null}
    </div>
  );
}

function Slider({ label, icon, value, onChange }) {
  const pct = Math.round(value * 100);
  return (
    <label className="block">
      <span className="mb-2 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 min-w-0 text-white text-[14px] font-medium">
          <Icon name={icon} size={18} className="text-text-secondary shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <span className="text-[13px] tabular-nums" style={{ color: C.muted }}>{pct}</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="vg-range w-full"
        style={rangeFill(pct, 0, 100)}
      />
    </label>
  );
}

function StickerPanel({ onPick, full, wide }) {
  return (
    <div className={wide ? '' : 'px-3 pb-3'}>
      {full && (
        <p className={`mb-2 text-[13px] ${wide ? '' : 'px-2'}`} style={{ color: C.muted }}>
          A clip can hold {MAX_OVERLAYS} texts and stickers. Delete one to add another.
        </p>
      )}
      <div className={`grid gap-1 overflow-y-auto ${wide ? 'grid-cols-6 max-h-[440px]' : 'grid-cols-8 max-h-[228px]'}`}>
        {STICKERS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={full}
            onClick={() => onPick(s)}
            aria-label={`Sticker ${s}`}
            className="h-12 rounded-[10px] grid place-items-center text-[28px] hover:bg-[#1E1E2C] active:bg-[#1E1E2C] disabled:opacity-40"
            style={{ fontFamily: EMOJI }}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// Desktop only: the phone writes text straight onto the clip from the rail.
function TextListPanel({ overlays, full, onAdd, onEdit, onDelete }) {
  const texts = overlays.filter((o) => o.kind === 'text');
  return (
    <div>
      <button
        type="button"
        onClick={onAdd}
        disabled={full}
        className="w-full h-12 rounded-[12px] flex items-center justify-center gap-2 text-white text-[15px] font-bold disabled:opacity-40"
        style={{ background: C.violet }}
      >
        <Icon name="add" size={20} /> Add text
      </button>
      {texts.length === 0 ? (
        <p className="mt-3 text-[13px] leading-[18px]" style={{ color: C.muted }}>
          Drag text on the clip to move it. Select it and scroll to resize, or press Delete to remove it.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {texts.map((o) => (
            <li key={o.id} className="h-12 pl-3 pr-1 rounded-[12px] flex items-center gap-1" style={{ background: C.raised }}>
              <span className="flex-1 min-w-0 truncate text-white text-[14px]" style={{ fontFamily: fontById(o.font).family }}>
                {o.text.split('\n')[0]}
              </span>
              <button type="button" onClick={() => onEdit(o)} aria-label="Edit text" className="w-9 h-9 rounded-full grid place-items-center text-white hover:bg-[#2A2A3A]">
                <Icon name="edit" size={18} />
              </button>
              <button type="button" onClick={() => onDelete(o.id)} aria-label="Delete text" className="w-9 h-9 rounded-full grid place-items-center text-white hover:bg-[#2A2A3A]">
                <Icon name="delete" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
