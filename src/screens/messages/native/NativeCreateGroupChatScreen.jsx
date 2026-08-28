// NativeCreateGroupChatScreen — dedicated phone build of /messages/create-group.
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../../firebase/config';
import { getFollowing, getFollowers, searchUsers } from '../../../firebase/firestore';
import { resolveChatUsers } from '../../../utils/chatIdentity';
import Icon from '../../../components/Icon';
import UserAvatar from '../../../components/UserAvatar';
import CloneDiscordModal from '../../../components/messages/CloneDiscordModal';
import { useUI } from '../../../context/UIContext';
import UserName from '../../../components/UserName';

export default function NativeCreateGroupChatScreen() {
  const navigate = useNavigate();
  const { showToast } = useUI();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState([]);
  const [friends, setFriends] = useState([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showClone, setShowClone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const me = auth.currentUser.uid;
        const [following, followers] = await Promise.all([getFollowing(me), getFollowers(me)]);
        const ids = [...following.map(f => f.followingId), ...followers.map(f => f.followerId)].filter(id => id && id !== me);
        const profiles = await resolveChatUsers(ids);
        setFriends(Object.entries(profiles).map(([uid, u]) => ({ uid, ...u })));
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const q = memberSearch.trim();
    if (q.length < 2) { setSearchResults(null); return; }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await searchUsers(q);
        if (alive) setSearchResults((res || []).filter(u => (u.uid || u.id) !== auth.currentUser.uid).map(u => ({ uid: u.uid || u.id, ...u })));
      } catch { if (alive) setSearchResults([]); }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [memberSearch]);

  const toggleSelection = (user) => {
    setSelected(prev => prev.find(u => u.uid === user.uid) ? prev.filter(u => u.uid !== user.uid) : [...prev, user]);
  };

  const createGroup = async () => {
    if (!name.trim() || selected.length < 2) {
      showToast('Name and at least 2 members required', 'error');
      return;
    }
    try {
      const docRef = await addDoc(collection(db, 'conversations'), {
        isGroup: true,
        status: 'active',
        visibility: 'private',
        groupName: name,
        participants: [auth.currentUser.uid, ...selected.map(u => u.uid)],
        createdBy: auth.currentUser.uid,
        admins: [auth.currentUser.uid],
        lastMessageText: `${auth.currentUser.displayName} created the group`,
        lastMessageAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        metadata: { [auth.currentUser.uid]: { name: auth.currentUser.displayName, avatar: auth.currentUser.photoURL } },
      });
      navigate(`/messages/${docRef.id}`);
    } catch (err) {
      showToast('Failed to create group', 'error');
    }
  };

  const list = searchResults
    ? [...selected.filter(s => !searchResults.some(r => r.uid === s.uid)), ...searchResults]
    : [...selected.filter(s => !friends.some(f => f.uid === s.uid)), ...friends];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-dark)', paddingBottom: 'calc(88px + env(safe-area-inset-bottom, 0px))' }}
      className="flex flex-col">
      <header className="flex items-center gap-3 px-4 pb-3 border-b border-white/[0.04]"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}>
        <button onClick={() => navigate(-1)} className="w-11 h-11 -ml-2 flex items-center justify-center text-white/80 active:scale-95 transition-transform">
          <Icon name="arrow_back" size={24} />
        </button>
        <h1 className="text-white font-syne font-bold text-lg flex-1">New Group</h1>
        <button onClick={createGroup} className="px-4 py-2.5 text-brand-violet-light text-sm font-bold active:scale-95 transition-transform">Create</button>
      </header>

      <div className="p-4 space-y-6">
        <button onClick={() => setShowClone(true)}
          className="w-full flex items-center gap-3 rounded-xl border border-[#5865F2]/40 bg-[#5865F2]/10 px-4 py-3.5 text-left active:bg-[#5865F2]/20 transition-colors">
          <Icon name="cloud_download" size={20} className="text-[#A8B0FF] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm">Migrating from Discord?</p>
            <p className="text-text-muted text-xs">Clone your server's channels into Vergr in one step.</p>
          </div>
          <Icon name="chevron_right" size={18} className="text-text-muted" />
        </button>

        <button onClick={() => navigate('/messages/import')}
          className="w-full flex items-center gap-3 rounded-xl border border-[#25D366]/40 bg-[#25D366]/10 px-4 py-3.5 text-left active:bg-[#25D366]/20 transition-colors">
          <Icon name="upload_file" size={20} className="text-[#7FE0A0] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-sm">Moving from WhatsApp?</p>
            <p className="text-text-muted text-xs">Import a group's chat export, history included.</p>
          </div>
          <Icon name="chevron_right" size={18} className="text-text-muted" />
        </button>

        <div>
          <label className="text-text-muted text-[10px] font-bold uppercase tracking-widest mb-2 block">Group Name</label>
          <input value={name} onChange={e => setName(e.target.value)}
            className="w-full bg-surface-2 border border-white/[0.06] rounded-xl px-4 py-3.5 text-white text-[15px] outline-none focus:border-brand-violet transition-colors"
            placeholder="Enter group name..." />
        </div>

        <div>
          <p className="text-text-muted text-[10px] font-bold uppercase tracking-widest mb-3">Add Members ({selected.length})</p>
          <input value={memberSearch} onChange={e => setMemberSearch(e.target.value)}
            className="w-full bg-surface-2 border border-white/[0.06] rounded-xl px-4 py-3 mb-3 text-white text-sm outline-none focus:border-brand-violet transition-colors"
            placeholder="Search by username..." />
          {loading && <p className="text-text-muted text-xs py-2">Loading your people…</p>}
          {!loading && !searchResults && friends.length === 0 && (
            <p className="text-text-muted text-xs py-2">Follow some players first, or search by username above.</p>
          )}
          <div className="space-y-1">
            {list.map(f => {
              const isSelected = selected.find(u => u.uid === f.uid);
              return (
                <button key={f.uid} onClick={() => toggleSelection(f)} className="flex items-center gap-3 w-full py-3 px-3 rounded-xl active:bg-surface-1 transition-colors">
                  <UserAvatar src={f.avatar} size={44} />
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-text-primary font-bold text-sm truncate"><UserName user={f} masked /></p>
                    <p className="text-text-muted text-xs truncate"><UserName user={f} masked handle /></p>
                  </div>
                  <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-brand-violet border-brand-violet scale-110' : 'border-white/[0.1]'}`}>
                    {isSelected && <Icon name="check" size={15} className="text-white font-bold" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {showClone && <CloneDiscordModal onClose={() => setShowClone(false)} />}
    </div>
  );
}
