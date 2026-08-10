// NativeBrowseGroupsScreen — dedicated phone build of /browse-groups.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../../firebase/config';
import { getPublicGroupChats, joinGroupChat } from '../../../firebase/firestore';
import { useUI } from '../../../context/UIContext';
import TopBar from '../../../components/TopBar';
import { ListSkeleton } from '../../../components/skeletons/GlassSkeletons';
import Icon from '../../../components/Icon';

export default function NativeBrowseGroupsScreen() {
  const { showToast } = useUI();
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const me = auth.currentUser?.uid;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getPublicGroupChats(50);
        if (!cancelled) setGroups(list);
      } catch (err) { console.error('Browse groups load failed', err); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!search) return groups;
    const q = search.toLowerCase();
    return groups.filter(g => (g.groupName || '').toLowerCase().includes(q));
  }, [groups, search]);

  const handleJoin = async (group) => {
    if (!me) return;
    setBusyId(group.id);
    try {
      await joinGroupChat(group.id);
      showToast('Joined!', 'success');
      navigate(`/messages/${group.id}`);
    } catch (err) { showToast(err.message || 'Failed to join', 'error'); }
    finally { setBusyId(null); }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-dark)', paddingBottom: 'calc(88px + env(safe-area-inset-bottom, 0px))' }}
      className="flex flex-col">
      <TopBar title="Browse Groups" showBack />
      <div className="px-4 pt-4 flex-1">
        <label className="relative block mb-4">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-text-muted"><Icon name="search" size={16} /></span>
          <input type="text" placeholder="Search public groups" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/[0.06] rounded-xl py-3 pl-9 pr-3 text-text-primary text-sm focus:border-brand-violet/50 outline-none" />
        </label>

        {loading ? (
          <ListSkeleton rows={6} />
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Icon name="groups" size={48} className="text-text-muted/30 mx-auto mb-3" />
            <p className="text-text-muted text-sm">{groups.length === 0 ? 'No public groups yet.' : 'No matches.'}</p>
            <p className="text-text-muted/60 text-xs mt-1">Start one by creating a group chat and marking it public in its settings.</p>
            <button onClick={() => navigate('/messages/create-group')}
              className="mt-4 px-5 py-2.5 rounded-lg bg-gradient-to-r from-brand-violet to-brand-pink text-white text-xs font-bold active:scale-95 transition-transform">
              Create Group
            </button>
          </div>
        ) : (
          <div className="space-y-2 pb-6">
            {filtered.map(g => {
              const joined = (g.participants || []).includes(me);
              const memberCount = (g.participants || []).length;
              return (
                <div key={g.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-1 border border-white/[0.06]">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-violet/30 to-brand-pink/20 flex items-center justify-center shrink-0">
                    <Icon name="tag" size={20} className="text-brand-violet-light" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-text-primary truncate">{g.groupName || 'Untitled Group'}</div>
                    <div className="text-[11px] text-text-muted flex items-center gap-2">
                      <span className="flex items-center gap-1"><Icon name="group" size={11} /> {memberCount} {memberCount === 1 ? 'member' : 'members'}</span>
                      <span className="text-text-muted/40">·</span>
                      <span className="flex items-center gap-1"><Icon name="public" size={11} /> Public</span>
                    </div>
                  </div>
                  {joined ? (
                    <button onClick={() => navigate(`/messages/${g.id}`)}
                      className="px-3.5 py-2.5 rounded-lg bg-brand-violet/10 border border-brand-violet/30 text-brand-violet-light text-[12px] font-bold flex items-center gap-1.5 active:scale-95 transition-transform">
                      <Icon name="check_circle" size={14} /> Open
                    </button>
                  ) : (
                    <button onClick={() => handleJoin(g)} disabled={busyId === g.id}
                      className="px-3.5 py-2.5 rounded-lg bg-gradient-to-r from-brand-violet to-brand-pink text-white text-[12px] font-bold disabled:opacity-50 active:scale-95 transition-transform">
                      {busyId === g.id ? 'Joining…' : 'Join'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
