// Shared UI primitives for the redesigned Settings screens.
// Inline-styled to match Claude Design's palette (#7c3aed / #12121e).
// Use in /settings/* pages only.
import { useState } from 'react';

export const C = {
  bg: '#09090f',
  card: '#12121e',
  cardSoft: '#0d0d1a',
  border: '#1e1e30',
  borderSoft: '#1a1a2e',
  borderHard: '#2a2a3e',
  text: '#e0e0f0',
  textSoft: '#c0c0d8',
  textMuted: '#a0a0c0',
  textDim: '#7070a0',
  textVeryDim: '#5050a0',
  purple: '#7c3aed',
  purpleLight: '#9d6ef7',
  purpleDeep: '#6d28d9',
  purpleSoft: 'rgba(124,58,237,0.15)',
  purpleSofter: 'rgba(124,58,237,0.08)',
  purpleBorder: 'rgba(124,58,237,0.3)',
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  redDeep: '#b91c1c',
};

export function Toggle({ checked, onChange, small = false }) {
  const w = small ? 36 : 44;
  const h = small ? 20 : 24;
  const thumb = small ? 14 : 18;
  const pad = 3;
  return (
    <button
      type="button"
      onClick={() => onChange?.(!checked)}
      style={{
        width: w, height: h, borderRadius: h,
        background: checked ? `linear-gradient(135deg,${C.purple},${C.purpleDeep})` : C.borderHard,
        border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0,
        outline: 'none', transition: 'background 0.2s',
        boxShadow: checked ? '0 0 0 1px rgba(124,58,237,0.4)' : 'none',
      }}
    >
      <div style={{
        width: thumb, height: thumb, borderRadius: '50%', background: '#fff',
        position: 'absolute', top: pad,
        left: checked ? w - thumb - pad : pad,
        transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }}/>
    </button>
  );
}

export function SelectDropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative', minWidth: 160 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          background: C.borderSoft, border: `1px solid ${C.borderHard}`,
          borderRadius: 8, color: C.text, padding: '8px 12px',
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 14, width: '100%', justifyContent: 'space-between',
        }}
      >
        <span>{value}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: C.borderSoft, border: `1px solid ${C.borderHard}`, borderRadius: 8,
          marginTop: 4, overflow: 'hidden',
        }}>
          {options.map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => { onChange?.(opt); setOpen(false); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '8px 12px',
                background: opt === value ? '#2a1a4e' : 'transparent',
                border: 'none', color: C.text, cursor: 'pointer', fontSize: 14,
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
      color: C.purple, textTransform: 'uppercase', marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

// Outer page container — gives every settings screen the same dark shell.
export function PageShell({ children, padding = 24 }) {
  return (
    <div style={{
      flex: 1, overflowY: 'auto', padding,
      background: C.bg, color: C.text,
      fontFamily: '"Inter", "DM Sans", system-ui, sans-serif',
      minHeight: '100%',
    }}>
      {children}
    </div>
  );
}
