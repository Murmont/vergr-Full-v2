import React, { useCallback, useRef, useState } from 'react';
import Icon from '../Icon';
import StatusCanvasView from './StatusCanvasView';
import {
  CANVAS_ANIMS, CANVAS_BACKGROUNDS, CANVAS_COLORS, CANVAS_FONTS,
  emptyCanvas, makeDrawLayer, makeImageLayer, makeStickerLayer, makeTextLayer,
} from '../../utils/statusCanvas';

const STICKERS = ['🔥', '💜', '😂', '😍', '👑', '⚡', '🎮', '🏆', '✨', '💀', '🤯', '🥶', '🎯', '💯', '🚀', '👀', '🎉', '🌙'];
const BRUSH_SIZES = [0.006, 0.012, 0.022, 0.04];
const SHEET_TITLES = { bg: 'Background', text: 'Text', draw: 'Draw', sticker: 'Stickers', anim: 'Animation' };

/**
 * Canva-style status editor.
 *
 * LAYOUT RULES, both learned by getting them wrong:
 *
 * 1. The canvas is sized BY HEIGHT, never width. The first version used
 *    `w-full aspect-[9/16] max-h-...`, which pins the width and clamps the
 *    height — the aspect ratio is then ignored and a status renders LANDSCAPE
 *    (measured 488x302, ratio 1.6 where 9:16 is 0.56). A status is portrait, so
 *    the width has to derive from the height.
 * 2. Tools float ON the canvas and every panel is dismissable. They were first
 *    stacked in a block underneath, which shrank the canvas and read as
 *    unfinished. Camera-style editors put controls over the artwork and let you
 *    clear them away to see the whole thing.
 *
 * Interaction is the phone convention: tap a layer to select, drag to move,
 * drag the corner handle to scale AND rotate together (one gesture, because
 * separate handles are unusable at thumb size). Geometry is normalised, so the
 * result is resolution-independent.
 */
export default function StatusCanvasEditor({ value, onChange, className = '' }) {
  const canvas = value || emptyCanvas();
  const [selectedId, setSelectedId] = useState(null);
  const [tool, setTool] = useState(null);       // null | 'bg' | 'text' | 'draw' | 'sticker' | 'anim'
  const [drawing, setDrawing] = useState(false);
  const [brush, setBrush] = useState({ color: '#FFFFFF', width: BRUSH_SIZES[1] });
  const [playKey, setPlayKey] = useState(0);
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const fileRef = useRef(null);

  const selected = canvas.layers.find((l) => l.id === selectedId) || null;

  const patch = useCallback((next) => onChange({ ...canvas, ...next }), [canvas, onChange]);
  const setLayers = useCallback((layers) => patch({ layers }), [patch]);
  const updateLayer = useCallback((id, changes) => {
    setLayers(canvas.layers.map((l) => (l.id === id ? { ...l, ...changes } : l)));
  }, [canvas.layers, setLayers]);
  const addLayer = useCallback((layer) => {
    setLayers([...canvas.layers, layer]);
    setSelectedId(layer.id);
  }, [canvas.layers, setLayers]);
  const removeLayer = (id) => {
    setLayers(canvas.layers.filter((l) => l.id !== id));
    setSelectedId(null);
  };

  const stageRect = () => stageRef.current?.getBoundingClientRect();

  /** Normalised pointer position within the stage. */
  const norm = (e) => {
    const r = stageRect();
    if (!r) return { x: 0.5, y: 0.5 };
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  // ── drag / scale / rotate ────────────────────────────────────────────
  const onLayerPointerDown = (e, layer) => {
    if (drawing) return;
    e.stopPropagation();
    e.preventDefault();
    setSelectedId(layer.id);
    const p = norm(e);
    dragRef.current = { mode: 'move', id: layer.id, startP: p, startX: layer.x, startY: layer.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onHandleDown = (e) => {
    if (!selected) return;
    e.stopPropagation();
    e.preventDefault();
    const p = norm(e);
    const r = stageRect();
    // Distance and angle from the layer centre give scale and rotation, so one
    // corner drag does both.
    const dx = (p.x - selected.x) * (r?.width || 1);
    const dy = (p.y - selected.y) * (r?.height || 1);
    dragRef.current = {
      mode: 'scale',
      id: selected.id,
      startDist: Math.hypot(dx, dy) || 1,
      startAngle: Math.atan2(dy, dx),
      startScale: selected.scale || 1,
      startRot: selected.rot || 0,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onStagePointerMove = (e) => {
    if (drawing && dragRef.current?.mode === 'draw') {
      const p = norm(e);
      const layers = canvas.layers.slice();
      const dl = layers[layers.length - 1];
      if (dl?.type === 'draw') {
        const paths = dl.paths.slice();
        const cur = paths[paths.length - 1];
        // Skip points closer than ~0.4% of the canvas: raw pointer streams are
        // dense enough to bloat the document for no visual gain.
        const last = cur.pts[cur.pts.length - 1];
        if (!last || Math.hypot(p.x - last[0], p.y - last[1]) > 0.004) {
          cur.pts = [...cur.pts, [p.x, p.y]];
          paths[paths.length - 1] = cur;
          layers[layers.length - 1] = { ...dl, paths };
          setLayers(layers);
        }
      }
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const p = norm(e);
    if (d.mode === 'move') {
      updateLayer(d.id, {
        x: Math.min(1.1, Math.max(-0.1, d.startX + (p.x - d.startP.x))),
        y: Math.min(1.1, Math.max(-0.1, d.startY + (p.y - d.startP.y))),
      });
    } else if (d.mode === 'scale') {
      const layer = canvas.layers.find((l) => l.id === d.id);
      if (!layer) return;
      const r = stageRect();
      const dx = (p.x - layer.x) * (r?.width || 1);
      const dy = (p.y - layer.y) * (r?.height || 1);
      const dist = Math.hypot(dx, dy) || 1;
      const ang = Math.atan2(dy, dx);
      updateLayer(d.id, {
        scale: Math.min(6, Math.max(0.15, d.startScale * (dist / d.startDist))),
        rot: d.startRot + (ang - d.startAngle) * 180 / Math.PI,
      });
    }
  };

  const onStagePointerUp = () => { dragRef.current = null; };

  const onStagePointerDown = (e) => {
    if (drawing) {
      const p = norm(e);
      const layers = canvas.layers.slice();
      const last = layers[layers.length - 1];
      const stroke = { color: brush.color, width: brush.width, pts: [[p.x, p.y]] };
      if (last?.type === 'draw') {
        layers[layers.length - 1] = { ...last, paths: [...last.paths, stroke] };
      } else {
        layers.push({ ...makeDrawLayer(), paths: [stroke] });
      }
      setLayers(layers);
      dragRef.current = { mode: 'draw' };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    setSelectedId(null);
  };

  const undoStroke = () => {
    const layers = canvas.layers.slice();
    for (let i = layers.length - 1; i >= 0; i--) {
      if (layers[i].type === 'draw' && layers[i].paths.length) {
        const paths = layers[i].paths.slice(0, -1);
        if (paths.length) layers[i] = { ...layers[i], paths };
        else layers.splice(i, 1);
        setLayers(layers);
        return;
      }
    }
  };

  const onPickImage = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => addLayer({
      ...makeImageLayer(url, img.naturalWidth / Math.max(1, img.naturalHeight)),
      _file: file,
    });
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  const play = () => setPlayKey((k) => k + 1);
  const closeSheet = () => setTool(null);

  const sheetBody = () => {
    if (tool === 'bg') {
      return (
        <div className="grid grid-cols-7 gap-2">
          {CANVAS_BACKGROUNDS.map((b) => (
            <button key={b.id} onClick={() => patch({ bg: { ...canvas.bg, css: b.css } })}
              className={`aspect-square rounded-xl border-2 ${canvas.bg?.css === b.css ? 'border-brand-violet-light' : 'border-white/10'}`}
              style={{ background: b.css }} aria-label={b.id} />
          ))}
        </div>
      );
    }
    if (tool === 'text' && selected?.type === 'text') {
      return (
        <>
          <textarea value={selected.text}
            onChange={(e) => updateLayer(selected.id, { text: e.target.value.slice(0, 200) })}
            placeholder="Type something..." rows={2}
            className="w-full bg-surface-2 rounded-xl px-3 py-2 text-white text-sm outline-none resize-none mb-3" />
          <Row label="Colour"><Swatches value={selected.color} onPick={(c) => updateLayer(selected.id, { color: c })} /></Row>
          <Row label="Font">
            <div className="flex gap-2">
              {CANVAS_FONTS.map((f) => (
                <button key={f.id} onClick={() => updateLayer(selected.id, { font: f.id })}
                  className={`px-3 py-1.5 rounded-lg text-xs ${selected.font === f.id ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-secondary'}`}
                  style={{ fontFamily: f.css, fontWeight: f.weight }}>{f.label}</button>
              ))}
            </div>
          </Row>
          <Row label="Size">
            <input type="range" min={0.03} max={0.18} step={0.005} value={selected.size}
              onChange={(e) => updateLayer(selected.id, { size: parseFloat(e.target.value) })}
              className="w-full accent-brand-violet-light" />
          </Row>
          <Row label="Align">
            <div className="flex gap-2">
              {['left', 'center', 'right'].map((a) => (
                <button key={a} onClick={() => updateLayer(selected.id, { align: a })}
                  className={`px-3 py-1.5 rounded-lg ${selected.align === a ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-secondary'}`}>
                  <Icon name={`format_align_${a}`} size={16} />
                </button>
              ))}
            </div>
          </Row>
        </>
      );
    }
    if (tool === 'draw') {
      return (
        <>
          <Row label="Colour"><Swatches value={brush.color} onPick={(c) => setBrush({ ...brush, color: c })} /></Row>
          <Row label="Brush">
            <div className="flex items-center gap-3">
              {BRUSH_SIZES.map((w) => (
                <button key={w} onClick={() => setBrush({ ...brush, width: w })}
                  className={`rounded-full border-2 ${brush.width === w ? 'border-brand-violet-light' : 'border-white/15'} flex items-center justify-center`}
                  style={{ width: 34, height: 34 }}>
                  <span className="rounded-full bg-white block" style={{ width: 4 + w * 300, height: 4 + w * 300 }} />
                </button>
              ))}
              <button onClick={undoStroke} className="ml-auto px-3 py-1.5 rounded-lg bg-surface-2 text-text-secondary text-xs flex items-center gap-1">
                <Icon name="undo" size={15} /> Undo
              </button>
            </div>
          </Row>
          <p className="text-[11px] text-text-muted">Close this panel, then drag on the canvas to draw.</p>
        </>
      );
    }
    if (tool === 'sticker') {
      return (
        <div className="grid grid-cols-9 gap-1">
          {STICKERS.map((s) => (
            <button key={s} onClick={() => addLayer(makeStickerLayer(s))}
              className="aspect-square text-2xl rounded-lg hover:bg-white/10">{s}</button>
          ))}
        </div>
      );
    }
    if (tool === 'anim' && selected) {
      return (
        <div className="grid grid-cols-3 gap-2">
          {CANVAS_ANIMS.map((a) => (
            <button key={a.id} onClick={() => { updateLayer(selected.id, { anim: a.id }); play(); }}
              className={`px-2 py-2 rounded-xl text-xs font-bold ${selected.anim === a.id ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-secondary'}`}>
              {a.label}
            </button>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`relative flex flex-col ${className}`}>
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div
          ref={stageRef}
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={onStagePointerUp}
          onPointerCancel={onStagePointerUp}
          className="relative rounded-3xl overflow-hidden select-none shadow-2xl"
          style={{
            // Sized off the VIEWPORT, not percentages.
            //
            // Two separate traps, both hit: (a) `w-full` + `max-h` overrides the
            // aspect ratio and renders a status LANDSCAPE; (b) `min(100%, ...)`
            // silently collapses to 0 here, because a percentage height needs a
            // parent with a DEFINITE height and this one is flex-derived —
            // measured 0x0 live. dvh/vw always resolve.
            //
            // 168px is the header + compact footer; the width cap keeps the
            // canvas sane on a desktop viewport.
            height: 'min(calc(100dvh - 168px), calc(min(100vw - 24px, 430px) * 16 / 9))',
            aspectRatio: '9 / 16',
            touchAction: 'none',
          }}
        >
          <StatusCanvasView
            canvas={canvas}
            animate
            playKey={playKey}
            selectedId={selectedId}
            onLayerPointerDown={onLayerPointerDown}
          />

          {selected && selected.type !== 'draw' && (
            <button
              onPointerDown={onHandleDown}
              className="absolute w-9 h-9 rounded-full bg-brand-violet-light border-2 border-white flex items-center justify-center shadow-lg"
              style={{
                left: `calc(${selected.x * 100}% + 7%)`,
                top: `calc(${selected.y * 100}% + 7%)`,
                transform: 'translate(-50%,-50%)',
                touchAction: 'none',
              }}
              aria-label="Resize and rotate"
            >
              <Icon name="open_in_full" size={16} />
            </button>
          )}

          {canvas.layers.length === 0 && !drawing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-white/70 gap-1 px-6 text-center">
              <Icon name="add_photo_alternate" size={32} />
              <p className="text-sm font-bold">Add text, photos or drawings</p>
            </div>
          )}

          {/* Tools float ON the canvas. */}
          <div className="absolute top-3 right-3 flex flex-col gap-2">
            <RailBtn icon="palette" active={tool === 'bg'} label="Background"
              onClick={() => { setDrawing(false); setTool(tool === 'bg' ? null : 'bg'); }} />
            <RailBtn icon="title" label="Text"
              onClick={() => { setDrawing(false); addLayer(makeTextLayer('')); setTool('text'); }} />
            <RailBtn icon="draw" active={drawing} label="Draw"
              onClick={() => { setSelectedId(null); setDrawing(!drawing); setTool(drawing ? null : 'draw'); }} />
            <RailBtn icon="image" label="Photo"
              onClick={() => { setDrawing(false); fileRef.current?.click(); }} />
            <RailBtn icon="mood" active={tool === 'sticker'} label="Sticker"
              onClick={() => { setDrawing(false); setTool(tool === 'sticker' ? null : 'sticker'); }} />
            <RailBtn icon="play_arrow" label="Replay animation" onClick={play} />
          </div>

          {/* Layer actions, opposite corner so they never cover the tool rail. */}
          {selected && (
            <div className="absolute top-3 left-3 flex flex-col gap-2">
              <RailBtn icon="delete" label="Delete" onClick={() => removeLayer(selected.id)} />
              <RailBtn icon="content_copy" label="Duplicate"
                onClick={() => addLayer({ ...selected, ...makeIdBump(selected), x: Math.min(0.9, selected.x + 0.06), y: Math.min(0.9, selected.y + 0.06) })} />
              <RailBtn icon="flip_to_front" label="Bring to front"
                onClick={() => setLayers([...canvas.layers.filter((l) => l.id !== selected.id), selected])} />
              <RailBtn icon="auto_awesome" active={tool === 'anim'} label="Animate"
                onClick={() => setTool(tool === 'anim' ? null : 'anim')} />
            </div>
          )}

          {/* Tool panel: over the canvas, dismissable by the scrim or the X, so
              the full canvas can always be seen. */}
          {tool && (
            <>
              <button aria-label="Close tools" onClick={closeSheet}
                className="absolute inset-0 bg-black/35 backdrop-blur-[1px]" />
              <div className="absolute inset-x-0 bottom-0 bg-surface-1/95 backdrop-blur-xl rounded-t-3xl p-3 max-h-[62%] overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{SHEET_TITLES[tool] || ''}</p>
                  <button onClick={closeSheet} className="w-7 h-7 rounded-full bg-surface-2 flex items-center justify-center">
                    <Icon name="close" size={15} />
                  </button>
                </div>
                {sheetBody()}
              </div>
            </>
          )}
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
    </div>
  );
}

/** Duplicating a layer needs a NEW id, or both copies move together. */
function makeIdBump(layer) {
  return { id: `${layer.id}c${Math.random().toString(36).slice(2, 6)}` };
}

function Row({ label, children }) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="text-[11px] text-text-secondary mb-1.5">{label}</p>
      {children}
    </div>
  );
}

function Swatches({ value, onPick }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
      {CANVAS_COLORS.map((c) => (
        <button key={c} onClick={() => onPick(c)}
          className={`shrink-0 w-7 h-7 rounded-full border-2 ${value === c ? 'border-brand-violet-light scale-110' : 'border-white/20'} transition-transform`}
          style={{ background: c }} aria-label={c} />
      ))}
    </div>
  );
}

/** Floating glass tool button that sits ON the canvas. */
function RailBtn({ icon, label, active, onClick }) {
  return (
    <button onClick={onClick} title={label} aria-label={label}
      className={`w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md border transition-colors ${
        active ? 'bg-brand-violet border-brand-violet-light text-white' : 'bg-black/35 border-white/15 text-white'}`}>
      <Icon name={icon} size={18} />
    </button>
  );
}
