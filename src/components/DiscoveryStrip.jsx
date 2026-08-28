import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import CachedImg from './CachedImg';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import { mergeBoostedFirst } from '../utils/promoBoost';
import { boostSlotsFor } from '../utils/boostDelivery';
import { getBoostedUsers } from '../firebase/firestore';
import Icon from './Icon';
import { getTrendingClips } from '../utils/klipyApi';
import { hiddenFromDiscovery } from '../utils/privacy';
import UserName from './UserName';

export default function DiscoveryStrip() {
  // Needed so a boosted profile is never suggested to itself.
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [trendingClips, setTrendingClips] = useState([]);
  const [suggestedUsers, setSuggestedUsers] = useState([]);

  useEffect(() => {
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
        // ⚠ The shared query — see getBoostedUsers. Fair rotation + interest
        // ranking + self-exclusion, identical on every surface.
        let boostedUsers = [];
        try {
          boostedUsers = await getBoostedUsers({
            viewerUid: currentUser?.uid, want: boostSlotsFor(5),
          });
        } catch { /* never empty the strip over a boost */ }

        setSuggestedUsers(
          mergeBoostedFirst(boostedUsers, snap.docs.map(d => ({ id: d.id, ...d.data() })), 5)
            // Privacy → "Appear in suggested users" opt-out.
            .filter(u => !hiddenFromDiscovery(u, 'suggested'))
        );
      } catch (err) {
        console.error('Error fetching users:', err);
        setSuggestedUsers([]);
      }
    };
    fetchUsers();
  }, []);

  if (trendingClips.length === 0 && suggestedUsers.length === 0) {
    return null;
  }

  return (
    <div className="w-[260px] h-full overflow-y-auto no-scrollbar py-4 px-3 space-y-6 border-l border-white/[0.06]">
      {trendingClips.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">Trending Clips</h3>
            <button onClick={() => navigate('/explore?tab=clips')} className="text-brand-violet-light text-[10px]">See all</button>
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
                <CachedImg src={user.avatar} permanent className="w-8 h-8 rounded-full object-cover" />
                <div className="flex-1 text-left">
                  <p className="text-white text-xs font-semibold"><UserName user={user} masked /></p>
                  <p className="text-text-muted text-[10px]"><UserName user={user} masked handle /></p>
                </div>
                <button className="px-2 py-0.5 rounded-full bg-brand-violet/10 text-brand-violet-light text-[9px] font-bold">Follow</button>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}