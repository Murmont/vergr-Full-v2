import React, { useEffect, useRef, useState } from 'react';
import { CANVAS_FONTS } from '../../utils/statusCanvas';

/**
 * Renders a status canvas.
 *
 * ONE renderer for both the editor preview and the viewer, on purpose: if the
 * two drew layers separately they would drift, and "it looked different after I
 * posted it" is the worst possible bug in a design tool.
 *
 * Everything is sized in PERCENTAGES of the box, driven by the normalised
 * layer coordinates, so the same canvas is correct at any size — a 120px
 * thumbnail, a phone viewer or a desktop preview.
 */
export default function StatusCanvasView({
  canvas,
  className = '',
  animate = true,
  playKey = 0,
  selectedId = null,
  onLayerPointerDown = null,
  fontScaleRef = null,
}) {
  const boxRef = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // Font size and stroke width are fractions of the box HEIGHT/WIDTH, so they
  // need the measured box, not a CSS unit.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
      if (fontScaleRef) fontScaleRef.current = { w: r.width, h: r.height };
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fontScaleRef]);

  const bg = canvas?.bg?.css || '#0B0B14';
  const layers = canvas?.layers || [];

  return (
    <div
      ref={boxRef}
      className={`overflow-hidden ${className}`}
      // Positioning is INLINE, not a Tailwind class, and that is deliberate.
      // This component previously set `relative` while callers passed
      // `absolute inset-0`; Tailwind emits `.relative` AFTER `.absolute`, so
      // `relative` won the cascade, the box collapsed to height 0, and the
      // whole canvas rendered invisible — backgrounds looked like they did
      // nothing. A className prop cannot override a class the component itself
      // sets, so the position lives here where no caller can conflict with it.
      // Requires a positioned parent, which every call site provides.
      style={{ position: 'absolute', inset: 0, background: bg }}
    >
      {canvas?.bg?.imageUrl && (
        <img
          src={canvas.bg.imageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
      )}

      {layers.map((layer, i) => (
        <LayerView
          key={layer.id}
          layer={layer}
          index={i}
          box={box}
          animate={animate}
          playKey={playKey}
          selected={selectedId === layer.id}
          onPointerDown={onLayerPointerDown}
        />
      ))}
    </div>
  );
}

function LayerView({ layer, index, box, animate, playKey, selected, onPointerDown }) {
  // Entrance animations stagger by layer order so a multi-layer status arrives
  // as a sequence rather than everything landing at once.
  const delay = (layer.delay ?? index * 0.12);
  const animStyle = animate && layer.anim && layer.anim !== 'none'
    ? {
      animation: `vsc-${layer.anim} 620ms cubic-bezier(0.22,1,0.36,1) both`,
      animationDelay: `${delay}s`,
    }
    : {};

  const common = {
    position: 'absolute',
    left: `${layer.x * 100}%`,
    top: `${layer.y * 100}%`,
    transform: `translate(-50%,-50%) rotate(${layer.rot || 0}deg)`,
    touchAction: 'none',
    cursor: onPointerDown ? 'grab' : 'default',
    ...animStyle,
  };

  const ring = selected
    ? { outline: '2px solid #B44FFF', outlineOffset: 4, borderRadius: 6 }
    : {};

  const handleDown = onPointerDown ? (e) => onPointerDown(e, layer) : undefined;

  if (layer.type === 'draw') {
    // Drawings own the whole canvas (their points are already absolute within
    // it), so they are NOT translated like the other layer types.
    return (
      <svg
        key={`${layer.id}-${playKey}`}
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={animStyle}
      >
        {(layer.paths || []).map((p, pi) => (
          <polyline
            key={pi}
            points={(p.pts || []).map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ')}
            fill="none"
            stroke={p.color || '#fff'}
            strokeWidth={(p.width || 0.01) * 1000}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    );
  }

  if (layer.type === 'text') {
    const f = CANVAS_FONTS.find((x) => x.id === layer.font) || CANVAS_FONTS[0];
    return (
      <div
        key={`${layer.id}-${playKey}`}
        onPointerDown={handleDown}
        style={{
          ...common,
          ...ring,
          width: '84%',
          fontFamily: f.css,
          fontWeight: f.weight,
          fontSize: box.h ? `${(layer.size || 0.07) * box.h * (layer.scale || 1)}px` : '4vh',
          color: layer.color || '#fff',
          textAlign: layer.align || 'center',
          lineHeight: 1.22,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          textShadow: '0 2px 12px rgba(0,0,0,0.28)',
        }}
      >
        {layer.text}
      </div>
    );
  }

  if (layer.type === 'sticker') {
    return (
      <div
        key={`${layer.id}-${playKey}`}
        onPointerDown={handleDown}
        style={{
          ...common,
          ...ring,
          fontSize: box.h ? `${(layer.size || 0.16) * box.h * (layer.scale || 1)}px` : '10vh',
          lineHeight: 1,
          userSelect: 'none',
        }}
      >
        {layer.emoji}
      </div>
    );
  }

  if (layer.type === 'image') {
    const w = (layer.scale || 0.7) * 100;
    return (
      <img
        key={`${layer.id}-${playKey}`}
        src={layer.url}
        alt=""
        draggable={false}
        onPointerDown={handleDown}
        style={{
          ...common,
          ...ring,
          width: `${w}%`,
          borderRadius: box.w ? `${(layer.radius || 0) * box.w}px` : 8,
          objectFit: 'cover',
        }}
      />
    );
  }

  return null;
}
