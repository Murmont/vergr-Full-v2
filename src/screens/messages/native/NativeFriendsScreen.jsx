// NativeFriendsScreen — dedicated phone build of /friends.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListSkeleton } from '../../../components/skeletons/GlassSkeletons';
import { auth } from '../../../firebase/config';
import { getFollowing, getUser, createConversation } from '../../../firebase/firestore';
import { useUI } from '../../../context/UIContext';
import { useLiveUsers } from '../../../context/LiveUsersContext';
import TopBar from '../../../components/TopBar';
import UserAvatar from '../../../components/UserAvatar';
import Icon from '../../../components/Icon';
import UserName from '../../../components/UserName';

export default function NativeFriendsScreen() {
  const { showToast } = useUI();
  const { isUserLive } = useLiveUsers();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const follows = await getFollowing(uid);
        const ids = [...new Set(follows.map(f => f.followingId).filter(Boolean))];
        const profiles = await Promise.all(ids.map(id => getUser(id).catch(() => null)));
        if (cancelled) return;
        setUsers(profiles.filter(Boolean));
      } catch (err) { console.error('Friends load failed', err); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!search) return users;
    const q = search.toLowerCase();
    return users.filter(u =>
      (u.displayName || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q));
  }, [users, search]);

  const handleMessage = async (user) => {
    const me = auth.currentUser?.uid;
    if (!me) return;
    setBusyId(user.id);
    try {
      const convoId = await createConversation(me, {
        id: user.id, displayName: user.displayName || user.username,
        username: user.username, avatar: user.avatar || user.photoURL,
      });
      navigate(`/messages/${convoId}`);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to start chat', 'error');
    } finally { setBusyId(null); }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-dark)', paddingBottom: 'calc(88px + env(safe-area-inset-bottom, 0px))' }}
      className="flex flex-col">
      <TopBar title="Friends" showBack />
      <div className="px-4 pt-4 flex-1">
        <label className="relative block mb-4">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-text-muted"><Icon name="search" size={16} /></span>
          <input type="text" placeholder="Search friends" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/[0.06] rounded-xl py-3 pl-9 pr-3 text-text-primary text-sm focus:border-brand-violet/50 outline-none" />
        </label>

        {loading ? (
          <ListSkeleton rows={6} />
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Icon name="person_add" size={48} className="text-text-muted/30 mx-auto mb-3" />
            <p className="text-text-muted text-sm">{users.length === 0 ? "You're not following anyone yet." : 'No matches.'}</p>
            {users.length === 0 && (
              <button onClick={() => navigate('/explore')}
                className="mt-4 px-5 py-2.5 rounded-lg bg-gradient-to-r from-brand-violet to-brand-pink text-white text-xs font-bold active:scale-95 transition-transform">
                Find people to follow
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2 pb-6">
            {filtered.map(u => (
              <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-1 border border-white/[0.06]">
                <button onClick={() => navigate(`/user/${u.id}`)} className="flex-1 flex items-center gap-3 text-left min-w-0">
                  <UserAvatar src={u.avatar || u.photoURL} size={42} isVerified={u.isVerified} isLive={isUserLive(u.id)} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-text-primary truncate"><UserName user={u} masked fallback={'Unknown'} /></div>
                    {u.username && <div className="text-[11px] font-dmmono text-text-muted truncate"><UserName user={u} masked handle /></div>}
                  </div>
                </button>
                <button onClick={() => handleMessage(u)} disabled={busyId === u.id}
                  className="px-3.5 py-2.5 rounded-lg bg-gradient-to-r from-brand-violet to-brand-pink text-white text-[12px] font-bold flex items-center gap-1.5 disabled:opacity-50 active:scale-95 transition-transform">
                  <Icon name="chat_bubble" size={14} /> Message
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
