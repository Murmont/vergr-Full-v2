// ONE gradient editor: the ramp, its stops, and a single shared colour picker.
//
// ── WHY IT IS ONE COMPONENT ─────────────────────────────────────────
// The first version was THREE stacked pickers, which forced exactly three
// colours and repeated the same UI three times. Founder, 2026-08-24: "why does
// it need 3 separate sections, it should be one component, and what if the user
// doesn't want 3 colours?" Both fair. So: a gradient bar, a chip per stop, ONE
// picker editing whichever stop is selected, and add/remove.
//
// The picker itself lives in ColorField so the name-colour unlock can use the
// same one instead of a second copy.
import { useState } from 'react';
import Icon from '../Icon';
import ColorField from './ColorField';
import { MAX_GRADIENT_STOPS } from '../../utils/rankUnlocks';

export default function GradientEditor({ stops, onChange, presets = [] }) {
  const [sel, setSel] = useState(0);
  const i = Math.min(sel, stops.length - 1);

  const setStop = (hex) => {
    const next = stops.slice();
    next[i] = hex;
    onChange(next);
  };

  const addStop = () => {
    if (stops.length >= MAX_GRADIENT_STOPS) return;
    const next = stops.slice();
    next.splice(i + 1, 0, stops[i] || '#ffffff');
    onChange(next);
    setSel(i + 1);
  };

  const removeStop = () => {
    if (stops.length <= 2) return;
    onChange(stops.filter((_, k) => k !== i));
    setSel(Math.max(0, i - 1));
  };

  // The ramp shows ONE cycle, which is what the eye reads across a name.
  const rampCss = `linear-gradient(90deg, ${stops.map((c, k) =>
    `${c} ${((k / (stops.length - 1)) * 100).toFixed(2)}%`).join(', ')})`;

  // ⚠ Capped, not full-bleed. On a desktop Row this is ~940px wide, which made
  // the saturation field a 6:1 letterbox — it read as a stretched element rather
  // than a designed one. A picker wants roughly square.
  return (
    <div className="space-y-3 max-w-[420px]">
      <div>
        <div className="h-8 rounded-lg" style={{ background: rampCss, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' }} />
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {stops.map((c, k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSel(k)}
              title={`Colour ${k + 1}: ${c}`}
              className="w-8 h-8 rounded-lg transition-transform"
              style={{
                background: c,
                transform: k === i ? 'scale(1.12)' : 'scale(1)',
                boxShadow: k === i
                  ? '0 0 0 2px #fff, 0 2px 8px rgba(0,0,0,0.5)'
                  : 'inset 0 0 0 1px rgba(255,255,255,0.18)',
              }}
            />
          ))}
          <button
            type="button"
            onClick={addStop}
            disabled={stops.length >= MAX_GRADIENT_STOPS}
            title={stops.length >= MAX_GRADIENT_STOPS ? `Up to ${MAX_GRADIENT_STOPS} colours` : 'Add a colour'}
            className="w-8 h-8 rounded-lg grid place-items-center bg-surface-2 text-text-secondary hover:text-white disabled:opacity-35 disabled:cursor-not-allowed"
          >
            <Icon name="add" size={16} />
          </button>
          <button
            type="button"
            onClick={removeStop}
            disabled={stops.length <= 2}
            title={stops.length <= 2 ? 'A gradient needs at least two colours' : 'Remove the selected colour'}
            className="w-8 h-8 rounded-lg grid place-items-center bg-surface-2 text-text-secondary hover:text-white disabled:opacity-35 disabled:cursor-not-allowed"
          >
            <Icon name="remove" size={16} />
          </button>
        </div>
      </div>

      <ColorField value={stops[i]} onChange={setStop} presets={presets} />
    </div>
  );
}
