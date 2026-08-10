// UserPickerSheet — bottom-sheet user picker (search by name/@username).
// Replaces the old prompt() flows (e.g. "share a Vergr contact" in chat).
import { useEffect, useState } from 'react';
import { searchUsers } from '../firebase/firestore';
import UserAvatar from './UserAvatar';
import Icon from './Icon';

export default function UserPickerSheet({ title = 'Select user', onSelect, onClose }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (term.trim().length < 2) { setResults([]); return; }
    let alive = true;
    setSearching(true);
    const t = setTimeout(() => {
      searchUsers(term, 12)
        .then(rows => { if (alive) setResults(rows || []); })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setSearching(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [term]);

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-end sm:items-center justify-center animate-fade-in" onClick={onClose}>
      <div className="bg-surface-1 w-full max-w-md max-h-[70vh] rounded-t-2xl sm:rounded-2xl border border-white/[0.06] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/[0.04]">
          <h3 className="text-white font-bold text-sm">{title}</h3>
          <button onClick={onClose} className="text-text-muted"><Icon name="close" size={20} /></button>
        </div>
        <div className="px-4 py-3">
          <label className="block relative">
            <Icon name="search" size={16} className="absolute inset-y-0 left-3 my-auto h-4 text-text-muted pointer-events-none" />
            <input
              autoFocus type="text" placeholder="Search by name or @username..."
              value={term} onChange={e => setTerm(e.target.value)}
              className="w-full bg-surface-2 border border-white/[0.06] rounded-xl py-2.5 pl-9 pr-4 text-text-primary text-sm focus:border-brand-violet outline-none"
            />
          </label>
        </div>
        <div className="overflow-y-auto flex-1 min-h-[120px]">
          {searching && <p className="text-center text-text-muted text-xs py-6">Searching…</p>}
          {!searching && term.trim().length >= 2 && results.length === 0 && (
            <p className="text-center text-text-muted text-xs py-6">No users found</p>
          )}
          {!searching && term.trim().length < 2 && (
            <p className="text-center text-text-muted text-xs py-6">Type at least 2 characters</p>
          )}
          {results.map(u => (
            <button key={u.id} onClick={() => onSelect?.(u)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-2/50 text-left transition-colors">
              <UserAvatar src={u.avatar} size={38} />
              <div className="flex-1 min-w-0">
                <span className="block text-sm text-text-primary font-medium truncate">{u.displayName || u.username || 'User'}</span>
                {u.username && <span className="block text-[11px] text-text-muted truncate">@{u.username}</span>}
              </div>
              <Icon name="chevron_right" size={16} className="text-text-muted" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
