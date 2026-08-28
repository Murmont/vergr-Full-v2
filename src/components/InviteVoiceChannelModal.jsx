// InviteVoiceChannelModal — search-as-you-type user picker for adding
// members to a private voice channel. Sources users from the current user's
// `following` list (people they actually know).

import { useEffect, useMemo, useState } from 'react';
import { auth } from '../firebase/config';
import { getFollowing, getUser } from '../firebase/firestore';
import Icon from './Icon';
import UserAvatar from './UserAvatar';
import UserName from './UserName';

export default function InviteVoiceChannelModal({ channel, onSave, onClose }) {
  const myUid = auth.currentUser?.uid;
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Start with everyone currently allowed (minus owner).
  const [selected, setSelected] = useState(() =>
    new Set((channel?.allowedUserIds || []).filter(id => id !== channel?.ownerId)),
  );

  useEffect(() => {
    if (!myUid) return;
    let cancelled = false;
    (async () => {
      try {
        const follows = await getFollowing(myUid);
        const ids = [...new Set(follows.map(f => f.followingId).filter(Boolean))];
        const users = await Promise.all(ids.map(id => getUser(id).catch(() => null)));
        if (!cancelled) {
          setCandidates(users.filter(Boolean));
          setLoading(false);
        }
      } catch (err) {
        console.error('Invite modal load failed', err);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [myUid]);

  const filtered = useMemo(() => {
    if (!search) return candidates;
    const q = search.toLowerCase();
    return candidates.filter(u =>
      (u.displayName || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q),
    );
  }, [candidates, search]);

  const toggle = (uid) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  const handleSave = () => onSave?.(Array.from(selected));

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md max-h-[80vh] rounded-2xl bg-surface-1 border border-white/[0.08] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
          <h2 className="font-syne text-lg font-extrabold text-text-primary">Invite members</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="px-5 pt-3">
          <label className="relative block">
            <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-text-muted">
              <Icon name="search" size={15} />
            </span>
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people you follow"
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg py-2 pl-8 pr-3 text-text-primary text-sm focus:border-brand-violet/40 outline-none"
            />
          </label>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="py-8 text-center text-text-muted text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center">
              <Icon name="group_off" size={32} className="text-text-muted/30 mx-auto mb-2" />
              <p className="text-text-muted text-xs">
                {candidates.length === 0
                  ? "Follow some people to invite them here."
                  : 'No matches.'}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map(u => {
                const on = selected.has(u.id);
                return (
                  <button
                    key={u.id}
                    onClick={() => toggle(u.id)}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-lg transition-colors ${
                      on ? 'bg-brand-violet/15' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <UserAvatar src={u.avatar} size={36} />
                    <div className="flex-1 text-left min-w-0">
                      <div className="text-sm font-semibold text-text-primary truncate">
                        <UserName user={u} masked />
                      </div>
                      <div className="text-[11px] text-text-muted truncate"><UserName user={u} masked handle /></div>
                    </div>
                    <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                      on ? 'bg-brand-violet border-brand-violet' : 'border-white/20 bg-white/[0.04]'
                    }`}>
                      {on && <Icon name="check" size={13} className="text-black" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/[0.06] flex items-center justify-between gap-3">
          <span className="text-[11px] text-text-muted">
            {selected.size} selected
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-2 rounded-lg bg-white/[0.04] text-text-secondary text-sm font-semibold hover:bg-white/[0.07]">
              Cancel
            </button>
            <button onClick={handleSave} className="px-4 py-2 rounded-lg bg-gradient-to-r from-brand-violet to-brand-pink text-white text-sm font-bold hover:brightness-110">
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
