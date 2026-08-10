import { useState, useEffect } from 'react';
import Icon from '../Icon';

// Generic searchable picker for vergr-native blocks (squads, tournaments,
// events, groups). `load()` returns a promise of [{ id, name, sub, image, icon }].
export default function VergrPicker({ open, title, emptyText, load, onSelect, onClose }) {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setItems(null);
    setQ('');
    Promise.resolve(load())
      .then((list) => { if (alive) setItems(list || []); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  const filtered = (items || []).filter((i) => !q || (i.name || '').toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-md bg-surface-1 border border-white/[0.08] rounded-t-3xl sm:rounded-2xl p-5 max-h-[75vh] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-syne text-lg font-bold text-white">{title}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-white"><Icon name="close" size={20} /></button>
        </div>
        <div className="relative mb-3">
          <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface-2 border border-white/10 text-sm text-white outline-none" />
        </div>
        {items === null ? (
          <p className="text-text-muted text-sm text-center py-8">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-text-muted text-sm text-center py-8">{emptyText || 'Nothing found.'}</p>
        ) : (
          <div className="space-y-2 overflow-y-auto">
            {filtered.map((i) => (
              <button key={i.id} onClick={() => onSelect(i)} className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:border-brand-violet/40 text-left transition-colors">
                <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-brand-violet/40 to-brand-pink/20 overflow-hidden flex items-center justify-center shrink-0">
                  {i.image ? <img src={i.image} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <Icon name={i.icon || 'tag'} size={18} className="text-white/70" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-bold truncate">{i.name}</p>
                  {i.sub && <p className="text-text-muted text-[11px] truncate">{i.sub}</p>}
                </div>
                <Icon name="chevron_right" size={18} className="text-text-muted shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
