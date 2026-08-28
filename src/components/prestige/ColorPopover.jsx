// A swatch that opens the shared ColorField in a popover.
//
// Founder, 2026-08-24: "Add a colour picker popup with an eyedropper to Profile
// accent." A popover rather than another always-open panel, because the page was
// already too long — see the section note in CosmeticEquip.
//
// Closes on outside click and on Escape, both of which people expect and neither
// of which is free: without them a popover is a trap on touch.
import { useEffect, useRef, useState } from 'react';
import ColorField from './ColorField';

export default function ColorPopover({ value, onChange, onCommit, presets = [], title = 'Pick a colour', align = 'left' }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const close = () => { setOpen(false); onCommit?.(); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onCommit]);

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={title}
        className="w-9 h-9 rounded-full grid place-items-center transition-transform hover:scale-105"
        style={{
          background: value,
          boxShadow: open
            ? '0 0 0 2px #fff'
            : 'inset 0 0 0 1px rgba(255,255,255,0.22)',
        }}
      >
        {/* A conic ring reads as "any colour", where a plain swatch reads as one
            more preset. It is drawn, not an image, so it costs nothing. */}
        <span
          className="w-4 h-4 rounded-full"
          style={{ background: 'conic-gradient(#ff4d4d,#ffd60a,#30d158,#4dffd4,#3d7fff,#b44fff,#ff4d4d)' }}
        />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-2 p-3 rounded-2xl bg-surface-1 shadow-2xl"
          style={{ width: 300, [align]: 0, boxShadow: '0 18px 50px rgba(0,0,0,0.6)' }}
        >
          <ColorField value={value} onChange={onChange} presets={presets} height={150} />
          <button
            type="button"
            onClick={() => { setOpen(false); onCommit?.(); }}
            className="mt-3 w-full py-2 rounded-xl text-xs font-bold text-white"
            style={{ background: 'var(--brand-violet,#7B1FFF)' }}
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
