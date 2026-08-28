// New Group as a popup (desktop). Mirrors CreateGroupChatScreen's logic but in
// a roomy modal. Mobile/native keep the full-screen route. Also hosts the
// "Migrating from Discord?" entry → CloneDiscordModal.
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { getFollowing, getFollowers, searchUsers } from '../../firebase/firestore';
import { resolveChatUsers } from '../../utils/chatIdentity';
import Icon from '../Icon';
import UserAvatar from '../UserAvatar';
import { useUI } from '../../context/UIContext';
import CloneDiscordModal from './CloneDiscordModal';
import UserName from '../UserName';

export default function CreateGroupModal({ onClose }) {
  const navigate = useNavigate();
  const { showToast } = useUI();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState([]);
  const [friends, setFriends] = useState([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showClone, setShowClone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const me = auth.currentUser.uid;
        const [following, followers] = await Promise.all([getFollowing(me), getFollowers(me)]);
        const ids = [
          ...following.map(f => f.followingId),
          ...followers.map(f => f.followerId),
        ].filter(id => id && id !== me);
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

  const toggle = (user) => {
    setSelected(prev => prev.find(u => u.uid === user.uid) ? prev.filter(u => u.uid !== user.uid) : [...prev, user]);
  };

  const create = async () => {
    if (!name.trim() || selected.length < 2) { showToast('Name and at least 2 members required', 'error'); return; }
    setCreating(true);
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
      onClose?.();
      navigate(`/messages/${docRef.id}`);
    } catch {
      showToast('Failed to create group', 'error');
      setCreating(false);
    }
  };

  const list = searchResults
    ? [...selected.filter(s => !searchResults.some(r => r.uid === s.uid)), ...searchResults]
    : [...selected.filter(s => !friends.some(f => f.uid === s.uid)), ...friends];

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
    >
      <div className="w-full max-w-2xl max-h-[85vh] rounded-2xl bg-surface-1 border border-white/[0.08] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/[0.05]">
          <h2 className="font-syne text-xl font-extrabold text-text-primary">New Group</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><Icon name="close" size={22} /></button>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-6 py-5 space-y-5">
          <button
            onClick={() => setShowClone(true)}
            className="w-full flex items-center gap-3 rounded-xl border border-[#5865F2]/40 bg-[#5865F2]/10 px-4 py-3 text-left hover:bg-[#5865F2]/20 transition-colors"
          >
            <Icon name="cloud_download" size={20} className="text-[#A8B0FF] shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-sm">Migrating from Discord?</p>
              <p className="text-text-muted text-xs">Clone your server's channels into Vergr in one step.</p>
            </div>
            <Icon name="chevron_right" size={18} className="text-text-muted" />
          </button>

          <button
            onClick={() => { onClose?.(); navigate('/messages/import'); }}
            className="w-full flex items-center gap-3 rounded-xl border border-[#25D366]/40 bg-[#25D366]/10 px-4 py-3 text-left hover:bg-[#25D366]/20 transition-colors"
          >
            <Icon name="upload_file" size={20} className="text-[#7FE0A0] shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-sm">Moving from WhatsApp?</p>
              <p className="text-text-muted text-xs">Import a group's chat export, history included.</p>
            </div>
            <Icon name="chevron_right" size={18} className="text-text-muted" />
          </button>

          <div>
            <label className="text-text-muted text-[10px] font-bold uppercase tracking-widest mb-2 block">Group Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-surface-2 border border-white/[0.06] rounded-xl px-4 py-3 text-white outline-none focus:border-brand-violet/40 transition-colors"
              placeholder="Enter group name..."
            />
          </div>

          <div>
            <p className="text-text-muted text-[10px] font-bold uppercase tracking-widest mb-3">Add Members ({selected.length})</p>
            <input
              value={memberSearch}
              onChange={e => setMemberSearch(e.target.value)}
              className="w-full bg-surface-2 border border-white/[0.06] rounded-xl px-4 py-2.5 mb-3 text-white text-sm outline-none focus:border-brand-violet/40 transition-colors"
              placeholder="Search by username..."
            />
            {loading && <p className="text-text-muted text-xs py-2">Loading your people…</p>}
            {!loading && !searchResults && friends.length === 0 && (
              <p className="text-text-muted text-xs py-2">Follow some players first, or search by username above.</p>
            )}
            <div className="space-y-1">
              {list.map(f => {
                const isSelected = selected.find(u => u.uid === f.uid);
                return (
                  <button key={f.uid} onClick={() => toggle(f)} className="flex items-center gap-3 w-full py-2.5 px-3 rounded-xl hover:bg-surface-2 transition-colors">
                    <UserAvatar src={f.avatar} size={40} />
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-text-primary font-bold text-sm truncate"><UserName user={f} masked /></p>
                      <p className="text-text-muted text-xs truncate"><UserName user={f} masked handle /></p>
                    </div>
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                      isSelected ? 'bg-brand-violet border-brand-violet scale-110' : 'border-white/[0.1]'
                    }`}>
                      {isSelected && <Icon name="check" size={14} className="text-white" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-white/[0.05] flex justify-end gap-2">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl bg-white/[0.05] text-text-secondary text-sm font-bold hover:bg-white/[0.08]">Cancel</button>
          <button
            onClick={create}
            disabled={creating || !name.trim() || selected.length < 2}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-sm font-bold hover:brightness-110 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create Group'}
          </button>
        </div>
      </div>

      {showClone && <CloneDiscordModal onClose={() => setShowClone(false)} />}
    </div>
  );
}
