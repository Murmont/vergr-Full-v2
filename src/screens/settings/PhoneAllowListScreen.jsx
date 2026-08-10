import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, updateDoc, documentId, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { getFollowing, getFollowers } from '../../firebase/firestore';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

export default function PhoneAllowListScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();

  const [candidates, setCandidates] = useState([]);
  const [allowSet, setAllowSet] = useState(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  useEffect(() => {
    if (!currentUser) return;
    setAllowSet(new Set(profile?.phoneVisibilityAllowList || []));
    (async () => {
      try {
        const [following, followers] = await Promise.all([
          getFollowing(currentUser.uid),
          getFollowers(currentUser.uid),
        ]);
        const ids = new Set();
        following.forEach(f => ids.add(f.followingId));
        followers.forEach(f => ids.add(f.followerId));
        ids.delete(currentUser.uid);

        const idArr = Array.from(ids);
        const users = [];
        for (let i = 0; i < idArr.length; i += 10) {
          const chunk = idArr.slice(i, i + 10);
          const snap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', chunk)));
          snap.forEach(d => users.push({ id: d.id, ...d.data() }));
        }
        users.sort((a, b) => (a.username || '').localeCompare(b.username || ''));
        setCandidates(users);
      } catch (err) {
        console.error(err);
        showToast('Failed to load contacts', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [currentUser, profile, showToast]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(u => (u.username || '').toLowerCase().includes(q) || (u.displayName || '').toLowerCase().includes(q));
  }, [candidates, search]);

  const toggle = (uid) => {
    setAllowSet(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  const save = async () => {
    if (!currentUser) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), {
        phoneVisibilityAllowList: Array.from(allowSet),
      });
      showToast('Allowed list saved', 'success');
      navigate(-1);
    } catch (err) {
      console.error(err);
      showToast('Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={isDesktop ? 'min-h-screen pb-8' : 'screen-container min-h-screen pb-24'}>
      <TopBar title="Allowed Users" showBack right={
        <button onClick={save} disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-brand-violet text-white text-xs font-bold disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
      } />

      <div className="px-4 py-3">
        <p className="text-xs text-text-muted mb-3">
          These users will be able to find you by phone number even though your number is not public.
        </p>
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-1 border border-white/[0.06] mb-3">
          <Icon name="search" size={18} className="text-text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search followers/following"
            className="flex-1 bg-transparent text-sm outline-none" />
        </div>

        {loading ? (
          <p className="text-center text-sm text-text-muted py-12">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-sm text-text-muted py-12">No matching users.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map(u => {
              const checked = allowSet.has(u.id);
              return (
                <button key={u.id} onClick={() => toggle(u.id)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-surface-1 border border-white/[0.06] text-left">
                  {u.avatarUrl ? (
                    <img src={u.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center text-sm font-bold text-text-muted">
                      {(u.username || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{u.displayName || u.username}</p>
                    <p className="text-xs text-text-muted truncate">@{u.username}</p>
                  </div>
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center ${checked ? 'bg-brand-violet text-white' : 'border border-white/20'}`}>
                    {checked && <Icon name="check" size={16} />}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
