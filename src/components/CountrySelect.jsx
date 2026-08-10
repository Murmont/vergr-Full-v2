// Shared country picker — one full list used by onboarding and edit-profile so
// both are identical. Value is the ISO-2 country code (drives locale grouping +
// local-currency price estimates). onChange receives (code, name).
//
// Custom dropdown (not a native <select>) because a native <option> can only
// render text, and flag EMOJI render as the two letters "GB"/"US" on Windows.
// So we draw real flag images (flagcdn.com, free) with a letter fallback.
import { useEffect, useRef, useState } from 'react';
import { COUNTRIES } from '../utils/countries';
import Icon from './Icon';

export const countryName = (code) =>
  COUNTRIES.find((c) => c.code === String(code || '').toUpperCase())?.name || '';

function Flag({ code }) {
  const cc = String(code || '').toLowerCase();
  const [err, setErr] = useState(false);
  if (!cc || err) {
    return <span style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', width: 24, textAlign: 'center', flexShrink: 0 }}>{String(code || '').toUpperCase()}</span>;
  }
  return (
    <img
      src={`https://flagcdn.com/24x18/${cc}.png`}
      srcSet={`https://flagcdn.com/48x36/${cc}.png 2x`}
      width={24} height={18} alt=""
      onError={() => setErr(true)}
      style={{ borderRadius: 2, flexShrink: 0, objectFit: 'cover', boxShadow: '0 0 0 1px rgba(255,255,255,0.08)' }}
    />
  );
}

export default function CountrySelect({ value, onChange, className, placeholder = 'Select country' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const code = String(value || '').toUpperCase();
  const sel = COUNTRIES.find((c) => c.code === code);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQ(''); } };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setQ(''); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const list = q
    ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.code.toLowerCase() === q.toLowerCase())
    : COUNTRIES;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className={className}
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', cursor: 'pointer' }}
      >
        {sel
          ? <><Flag code={sel.code} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sel.name}</span></>
          : <span style={{ opacity: 0.55 }}>{placeholder}</span>}
        <Icon name="expand_more" size={18} className="opacity-60" style={{ marginLeft: 'auto', flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 60,
          background: '#14141F', border: '1px solid #2A2A3A', borderRadius: 10,
          boxShadow: '0 20px 50px rgba(0,0,0,0.6)', overflow: 'hidden',
        }}>
          <input
            autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search country…"
            style={{
              width: '100%', padding: '10px 12px', background: 'transparent', border: 'none',
              borderBottom: '1px solid #2A2A3A', color: '#fff', outline: 'none', fontSize: 13,
            }}
          />
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {list.map((c) => (
              <button
                key={c.code} type="button"
                onClick={() => { onChange?.(c.code, c.name); setOpen(false); setQ(''); }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = c.code === code ? 'rgba(124,58,237,0.18)' : 'transparent'; }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 12px',
                  background: c.code === code ? 'rgba(124,58,237,0.18)' : 'transparent',
                  border: 'none', color: '#fff', cursor: 'pointer', fontSize: 13, textAlign: 'left',
                }}
              >
                <Flag code={c.code} /><span>{c.name}</span>
              </button>
            ))}
            {list.length === 0 && <div style={{ padding: 12, color: '#6B7280', fontSize: 13 }}>No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}
