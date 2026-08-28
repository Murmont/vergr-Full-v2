import { useState, useEffect } from 'react';
import { getBoostedUsers } from '../firebase/firestore';
import { mergeBoostedFirst } from '../utils/promoBoost';
import { boostSlotsFor } from '../utils/boostDelivery';
import { useNavigate } from 'react-router-dom';
import { collection, query, limit, where, getDocs, getDoc, doc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { followUser, unfollowUser, isFollowing as checkFollowing } from '../firebase/firestore';
import Icon from './Icon';
import UserAvatar from './UserAvatar';
import UserName from './UserName';

// Module-level caches so we don't re-fetch on every sidebar mount.
// Trending hashtags only update once an hour (Cloud Function), and verified
// users almost never change — both are perfect candidates for in-memory + LS cache.
const TRENDING_LS_KEY = 'vergr_trending_tags_v1';
const SUGGESTED_LS_KEY = 'vergr_suggested_users_v1';
// ⚠ Only the ORGANIC list is cached. See the boosted-slot fetch below.
const TRENDING_TTL_MS = 60 * 60 * 1000; // 1 hour
const SUGGESTED_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const _readCache = (key, ttl) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.savedAt || Date.now() - parsed.savedAt > ttl) return null;
    return parsed.data;
  } catch { return null; }
};
const _writeCache = (key, data) => {
  try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data })); } catch {}
};

export default function RightSidebarPanel() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [trendingTags, setTrendingTags] = useState(() => _readCache(TRENDING_LS_KEY, TRENDING_TTL_MS) || []);
  const [suggestedUsers, setSuggestedUsers] = useState(() => _readCache(SUGGESTED_LS_KEY, SUGGESTED_TTL_MS) || []);
  const [followState, setFollowState] = useState({});
  const [togglingIds, setTogglingIds] = useState(new Set());

  useEffect(() => {
    let cancelled = false;

    // Trending tags — one-shot getDoc (was real-time onSnapshot, even though
    // the source doc only updates hourly via Cloud Function). Cached for 1h.
    if (!_readCache(TRENDING_LS_KEY, TRENDING_TTL_MS)) {
      getDoc(doc(db, 'trending', 'hashtags')).then(snap => {
        if (cancelled) return;
        const tags = snap.exists() && snap.data().tags?.length > 0
          ? snap.data().tags.slice(0, 8).map(t => t.tag || t)
          : [];
        setTrendingTags(tags);
        _writeCache(TRENDING_LS_KEY, tags);
      }).catch(() => {});
    }

    // ⚠ THE BOOSTED SLOT MUST BYPASS THE SIX-HOUR CACHE. A boost bought now
    // would otherwise not appear here for up to six hours on a returning
    // device — 12% of a 48-hour purchase silently undelivered, and the whole
    // of a 15-minute one. So the boosted slot is fetched EVERY mount and
    // merged over whatever the cache holds; only the organic list is cached.
    (async () => {
      try {
        const boosted = await getBoostedUsers({
          viewerUid: currentUser?.uid, want: boostSlotsFor(5),
        });
        if (cancelled || !boosted.length) return;
        setSuggestedUsers((prev) => mergeBoostedFirst(
          boosted.map((u) => ({
            id: u.id, displayName: u.displayName, username: u.username,
            avatar: u.avatar, isVerified: u.isVerified, boostExpiresAt: u.boostExpiresAt,
          })),
          prev, 5,
        ));
      } catch { /* never empty the panel over a boost */ }
    })();

    // Suggested users (verified) — one-shot, cached for 6 hours
    if (!_readCache(SUGGESTED_LS_KEY, SUGGESTED_TTL_MS)) {
      const usersQuery = query(collection(db, 'users'), where('isVerified', '==', true), limit(8));
      getDocs(usersQuery).then(snap => {
        if (cancelled) return;
        const users = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(u => u.id !== currentUser?.uid)
          .slice(0, 5)
          .map(u => ({ id: u.id, displayName: u.displayName, username: u.username, avatar: u.avatar, isVerified: u.isVerified }));
        setSuggestedUsers(users);
        _writeCache(SUGGESTED_LS_KEY, users);
      }).catch(() => {});
    }

    // Preload follow state for whatever users we currently have
    if (currentUser && suggestedUsers.length > 0) {
      Promise.all(
        suggestedUsers.map(u => checkFollowing(currentUser.uid, u.id).catch(() => false))
      ).then(states => {
        if (cancelled) return;
        const map = {};
        suggestedUsers.forEach((u, i) => { map[u.id] = states[i]; });
        setFollowState(map);
      });
    }

    return () => { cancelled = true; };
  }, [currentUser, suggestedUsers.length]);

  const handleToggleFollow = async (e, user) => {
    e.stopPropagation();
    if (!currentUser || togglingIds.has(user.id)) return;
    const wasFollowing = !!followState[user.id];
    setFollowState(s => ({ ...s, [user.id]: !wasFollowing }));
    setTogglingIds(s => new Set(s).add(user.id));
    try {
      if (wasFollowing) await unfollowUser(currentUser.uid, user.id);
      else await followUser(currentUser.uid, user.id);
    } catch {
      setFollowState(s => ({ ...s, [user.id]: wasFollowing }));
    } finally {
      setTogglingIds(s => { const n = new Set(s); n.delete(user.id); return n; });
    }
  };

  return (
    <div className="space-y-5">
      {/* Search */}
      <label className="block relative">
        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-text-muted">
          <Icon name="search" size={20} />
        </div>
        <input
          type="text"
          placeholder="Search Vergr..."
          onClick={() => navigate('/search')}
          readOnly
          className="w-full bg-surface-2 border border-white/[0.06] rounded-full py-2.5 pl-10 pr-4 text-text-primary text-sm focus:border-brand-violet transition-colors outline-none cursor-pointer"
        />
      </label>

      {/* Trending — only shows when Cloud Function has populated real data */}
      {trendingTags.length > 0 && (
        <div className="bg-surface-1 rounded-2xl border border-white/[0.06] overflow-hidden">
          <h3 className="px-4 pt-4 pb-2 text-sm font-syne font-bold text-text-primary">Trending Now</h3>
          <div className="px-4 pb-3 flex flex-wrap gap-2">
            {trendingTags.map((tag, index) => (
              <button key={index} onClick={() => navigate(`/search?q=%23${tag}`)}
                className="px-3 py-1.5 rounded-lg bg-surface-2 border border-white/[0.06] text-brand-violet-light text-xs font-bold hover:border-white/[0.12] transition-colors">
                #{tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Who to follow */}
      {suggestedUsers.length > 0 && (
        <div className="bg-surface-1 rounded-2xl border border-white/[0.06] overflow-hidden">
          <h3 className="px-4 pt-4 pb-2 text-sm font-syne font-bold text-text-primary">Who to Follow</h3>
          <div className="divide-y divide-white/[0.04]">
            {suggestedUsers.map(user => {
              const isFollowing = !!followState[user.id];
              return (
                <div key={user.id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/40 transition-colors">
                  <button
                    onClick={() => navigate(`/user/${user.id}`)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    <UserAvatar src={user.avatar} size={36} isVerified={user.isVerified} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-text-primary truncate"><UserName user={user} masked /></p>
                      <p className="text-xs text-text-muted font-dmmono truncate"><UserName user={user} masked handle /></p>
                    </div>
                  </button>
                  <button
                    onClick={(e) => handleToggleFollow(e, user)}
                    disabled={togglingIds.has(user.id)}
                    className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-colors ${
                      isFollowing
                        ? 'bg-surface-2 text-text-secondary border-white/[0.08] hover:border-brand-ember hover:text-brand-ember'
                        : 'bg-brand-violet/10 text-brand-violet-light border-brand-violet/20 hover:bg-brand-violet/20'
                    }`}
                  >
                    {isFollowing ? 'Following' : 'Follow'}
                  </button>
                </div>
              );
            })}
          </div>
          <button 
            onClick={() => navigate('/browse-creators')}
            className="w-full px-4 py-3 text-brand-violet-light text-sm font-semibold hover:bg-surface-2/30 transition-colors"
          >
            Show more
          </button>
        </div>
      )}

      {/* Footer links */}
      <div className="px-2 text-[10px] text-text-muted font-dmmono space-y-1">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <button onClick={() => navigate('/settings/privacy-policy')} className="hover:text-text-secondary transition-colors">Privacy</button>
          <button onClick={() => navigate('/settings/about')} className="hover:text-text-secondary transition-colors">About</button>
          <button onClick={() => navigate('/settings/help')} className="hover:text-text-secondary transition-colors">Help</button>
        </div>
        <p className="mt-2">© 2026 Vergr. All rights reserved.</p>
      </div>
    </div>
  );
}