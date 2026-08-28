// The colour picker itself: saturation/value field, hue slider, hex entry,
// screen eyedropper, preset shortcuts.
//
// ⚠ ONE PICKER, TWO CONSUMERS. `GradientEditor` uses it to edit the selected
// gradient stop; the name-colour unlock uses it to edit a single colour. It was
// extracted the moment the second consumer appeared, rather than copied — a
// second copy is exactly how the theme system ended up with a preview and a
// profile that disagreed (src/components/effects/README.md).
//
// ── THE EYEDROPPER IS THE POINT ─────────────────────────────────────
// Founder: "most people don't know the codes." The EyeDropper API samples any
// pixel on screen, so a user grabs the colour straight off their own logo, their
// game, their avatar. Chromium 95+ only, so it is FEATURE-DETECTED and simply
// absent elsewhere — never a button that does nothing.
//   https://developer.mozilla.org/en-US/docs/Web/API/EyeDropper
//
// ⚠ STATE LIVES IN HSV, NOT HEX. Converting to hex on every pointer move and
// back loses information: drag to pure black and the hue is gone, so the handle
// jumps to red on the way back up. HSV canonical, hex emitted outward.
//
// Cost: zero. No dependency, no canvas, no network. The SV field is two stacked
// CSS gradients, which is how every serious picker draws it and stays crisp at
// any size.
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { hsvToHex, hexToHsv, isHexColor, luminance } from '../../utils/color';

const HAS_EYEDROPPER = typeof window !== 'undefined' && 'EyeDropper' in window;

export default function ColorField({ value, onChange, presets = [], height = 190 }) {
  const [hsv, setHsv] = useState(() => hexToHsv(value) || { h: 280, s: 0.8, v: 1 });
  const [text, setText] = useState(value || '');
  const fieldRef = useRef(null);
  const hueRef = useRef(null);
  const dragRef = useRef(false);

  // Follow the prop when it changes from OUTSIDE (a different stop selected, a
  // reset), but never mid-drag, or the round trip fights the pointer.
  useEffect(() => {
    if (dragRef.current) return;
    if (isHexColor(value) && value.toLowerCase() !== hsvToHex(hsv)) {
      setHsv(hexToHsv(value));
      setText(value);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const emit = useCallback((next) => {
    setHsv(next);
    const hex = hsvToHex(next);
    setText(hex);
    onChange?.(hex);
  }, [onChange]);

  // Pointer events (not mouse) for touch, with pointer capture so a drag that
  // leaves the element keeps tracking instead of freezing where it exited.
  const track = (kind) => (e) => {
    const el = kind === 'field' ? fieldRef.current : hueRef.current;
    if (!el) return;
    dragRef.current = true;
    el.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      const r = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      setHsv((h) => {
        const n = kind === 'field' ? { ...h, s: x, v: 1 - y } : { ...h, h: x * 360 };
        const hex = hsvToHex(n);
        setText(hex);
        onChange?.(hex);
        return n;
      });
    };
    move(e);
    const up = (ev) => {
      dragRef.current = false;
      el.releasePointerCapture?.(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const pickFromScreen = async () => {
    try {
      const res = await new window.EyeDropper().open();
      if (isHexColor(res?.sRGBHex)) emit(hexToHsv(res.sRGBHex));
    } catch {
      /* the user pressed Escape — not an error worth surfacing */
    }
  };

  const hex = hsvToHex(hsv);
  const hueHex = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  const handleDark = luminance(hex) > 0.5;
  const commitText = () => {
    if (isHexColor(text)) emit(hexToHsv(text));
    else setText(hex);   // reject silently, snap back to the real value
  };

  return (
    <div className="space-y-3">
      <div
        ref={fieldRef}
        onPointerDown={track('field')}
        className="relative rounded-lg cursor-crosshair touch-none select-none"
        style={{
          height,
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueHex})`,
        }}
      >
        <span
          className="absolute w-4 h-4 rounded-full pointer-events-none"
          style={{
            left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`,
            transform: 'translate(-50%,-50%)',
            background: hex,
            border: `2px solid ${handleDark ? 'rgba(0,0,0,0.75)' : '#fff'}`,
            boxShadow: '0 1px 5px rgba(0,0,0,0.55)',
          }}
        />
      </div>

      <div
        ref={hueRef}
        onPointerDown={track('hue')}
        className="relative h-3.5 rounded-full cursor-pointer touch-none select-none"
        style={{ background: 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}
      >
        <span
          className="absolute top-1/2 w-4 h-4 rounded-full pointer-events-none"
          style={{
            left: `${(hsv.h / 360) * 100}%`,
            transform: 'translate(-50%,-50%)',
            background: hueHex, border: '2px solid #fff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
          }}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-md shrink-0" style={{ background: hex, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.16)' }} />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitText(); } }}
          spellCheck={false}
          maxLength={7}
          aria-label="Hex colour"
          className="flex-1 min-w-0 px-2.5 py-2 rounded-md bg-surface-2 text-white font-dmmono text-xs outline-none focus:ring-1 focus:ring-brand-violet-light"
        />
        {HAS_EYEDROPPER && (
          <button
            type="button"
            onClick={pickFromScreen}
            title="Pick a colour from anywhere on your screen"
            className="px-3 py-2 rounded-md bg-surface-2 text-text-secondary hover:text-white flex items-center gap-1.5 shrink-0"
          >
            <Icon name="colorize" size={16} />
            <span className="text-[11px] font-bold">Pick</span>
          </button>
        )}
      </div>

      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <button
              key={p.id || p.color}
              type="button"
              onClick={() => emit(hexToHsv(p.color))}
              title={p.name || p.color}
              className="w-5 h-5 rounded-full transition-transform hover:scale-110"
              style={{
                background: p.color,
                boxShadow: hex.toLowerCase() === p.color.toLowerCase()
                  ? '0 0 0 2px #fff' : 'inset 0 0 0 1px rgba(255,255,255,0.18)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
