import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../firebase/config';
import Icon from './Icon';
import { getTrendingClips } from '../utils/klipyApi';

export default function DiscoveryStrip() {
  const navigate = useNavigate();
  const [trendingClips, setTrendingClips] = useState([]);
  const [suggestedUsers, setSuggestedUsers] = useState([]);
  // DS6 — surface live tournaments so spectators discover Champion Picks
  // ("predict the winner, earn coins") without already knowing it exists.
  const [liveTournaments, setLiveTournaments] = useState([]);

  useEffect(() => {
    // Live tournaments for the predictions nudge.
    (async () => {
      try {
        const q = query(collection(db, 'tournaments'), where('status', 'in', ['live', 'active']), limit(3));
        const snap = await getDocs(q);
        setLiveTournaments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch { setLiveTournaments([]); }
    })();

    // Real clips from Klipy
    getTrendingClips().then(clips => setTrendingClips(clips.slice(0, 6))).catch(() => setTrendingClips([]));

    // Real suggested users from Firestore (verified, fallback to regular)
    const fetchUsers = async () => {
      try {
        let q = query(collection(db, 'users'), where('isVerified', '==', true), limit(5));
        let snap = await getDocs(q);
        if (snap.empty) {
          q = query(collection(db, 'users'), limit(5));
          snap = await getDocs(q);
        }
        setSuggestedUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Error fetching users:', err);
        setSuggestedUsers([]);
      }
    };
    fetchUsers();
  }, []);

  if (trendingClips.length === 0 && suggestedUsers.length === 0 && liveTournaments.length === 0) {
    return null;
  }

  return (
    <div className="w-[260px] h-full overflow-y-auto no-scrollbar py-4 px-3 space-y-6 border-l border-white/[0.06]">
      {liveTournaments.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider mb-2">Predict & Earn</h3>
          <div className="space-y-2">
            {liveTournaments.map(t => (
              <button key={t.id} onClick={() => navigate(`/match/${t.id}`)}
                className="w-full p-3 rounded-xl bg-gradient-to-br from-brand-violet/20 to-brand-cyan/10 border border-brand-cyan/30 text-left hover:border-brand-cyan/60 transition">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-ember animate-pulse" />
                  <span className="text-[9px] font-bold uppercase tracking-wider text-brand-ember">Live now</span>
                </div>
                <p className="text-white text-xs font-bold truncate">{t.name || 'Tournament'}</p>
                <p className="text-brand-cyan text-[10px] font-semibold mt-0.5">Predict the winner, earn coins</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {trendingClips.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">Trending Clips</h3>
            <button onClick={() => navigate('/explore?tab=clips')} className="text-brand-cyan text-[10px]">See all</button>
          </div>
          <div className="flex flex-col gap-2">
            {trendingClips.slice(0, 3).map(clip => (
              <button key={clip.id} onClick={() => navigate(`/clip/${clip.id}`)} className="relative rounded-xl overflow-hidden aspect-video bg-surface-2 group">
                <img src={clip.preview || clip.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition">
                  <Icon name="play_arrow" size={24} className="text-white" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {suggestedUsers.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider mb-2">Who to Follow</h3>
          <div className="space-y-2">
            {suggestedUsers.map(user => (
              <button key={user.id} onClick={() => navigate(`/user/${user.id}`)} className="flex items-center gap-2 w-full p-2 rounded-xl hover:bg-surface-2 transition">
                <img src={user.avatar} className="w-8 h-8 rounded-full object-cover" />
                <div className="flex-1 text-left">
                  <p className="text-white text-xs font-semibold">{user.displayName}</p>
                  <p className="text-text-muted text-[10px]">@{user.username}</p>
                </div>
                <button className="px-2 py-0.5 rounded-full bg-brand-cyan/10 text-brand-cyan text-[9px] font-bold">Follow</button>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}