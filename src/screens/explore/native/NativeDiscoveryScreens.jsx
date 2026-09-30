// NATIVE-APP discovery screens (Android/iOS Tauri shell ONLY).
//
// Dedicated mobile-first variants for Batch 3 discovery surfaces. Routed
// `IS_NATIVE_BUILD ? <Native> : <existing>`; never render on web. The existing
// web screens are UNTOUCHED. Each reuses the SAME data hooks/callables as its
// web twin — only the layout is phone-first (single column, native-safe header,
// no useResponsive/desktop branches, no LayoutContext right-rail plumbing).
// These render inside ResponsiveLayout's native wrapper (full-width + safe-top),
// so the shared TopBar already clears the status bar.

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import { useAuth } from '../../../context/AuthContext';
import { useUser } from '../../../context/UserContext';
import { useLiveUsers } from '../../../context/LiveUsersContext';
import {
  getFollowersDetailed, getFollowingDetailed, getFans, followUser, unfollowUser, isFollowing as checkFollowing,
  searchUsers, getSquads, getFeedPosts, getLiveStreams, getUser,
} from '../../../firebase/firestore';
import { applyVanguardMask } from '../../../utils/vanguard';
import { filterForEnumeration } from '../../../utils/enumerationFilter';
import { resolveTier } from '../../../utils/tierSystem';
import { ListSkeleton } from '../../../components/skeletons/GlassSkeletons';
import TopBar from '../../../components/TopBar';
import UserAvatar from '../../../components/UserAvatar';
import VanguardBadge from '../../../components/VanguardBadge';
import Icon from '../../../components/Icon';
import PrestigeShowcase from '../../../components/prestige/PrestigeShowcase';
import UserName from '../../../components/UserName';

function UserRow({ user, viewer, isUserLive, navigate, follow, onToggle, showTier }) {
  const masked = applyVanguardMask(user, viewer);
  const isMasked = !!masked?.isVanguardPersona;
  const vRank = user.vanguard?.rank;
  return (
    <div className="flex items-center gap-3 py-3">
      <button onClick={() => navigate(`/user/${user.id}`)} className="shrink-0">
        <UserAvatar src={masked.avatar} size="md" isLive={!isMasked && isUserLive(user.id)} />
      </button>
      <button onClick={() => navigate(`/user/${user.id}`)} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-1">
          <p className="text-sm font-semibold truncate"><UserName user={masked} masked /></p>
          {!isMasked && user.isVerified && <Icon name="verified" filled size={14} className="text-brand-violet-light shrink-0" />}
          {vRank && <VanguardBadge rank={vRank} size={13} />}
        </div>
        <p className="text-xs text-text-muted"><UserName user={masked} masked handle /></p>
        {showTier && user._fanTier && (
          <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
            style={{ background: 'rgba(240,165,0,0.12)', color: '#F5C842' }}>
            <Icon name="workspace_premium" filled size={11} /> {user._fanTier}
          </span>
        )}
      </button>
      {onToggle && (
        <motion.button onClick={() => onToggle(user.id)} whileTap={{ scale: 0.92 }}
          className={`px-4 py-1.5 rounded-full text-xs font-bold ${follow ? 'bg-surface-2 border border-white/[0.06] text-text-secondary' : 'bg-brand-violet text-white'}`}>
          {follow ? 'Following' : 'Follow'}
        </motion.button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════ FOLLOWERS / FOLLOWING

export function NativeFollowListScreen() {
  const { tab: initialTab, uid: routeUid } = useParams();
  const [activeTab, setActiveTab] = useState(initialTab || 'followers');
  const [followers, setFollowers] = useState([]);
  const [following, setFollowing] = useState([]);
  const [fans, setFans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [followStates, setFollowStates] = useState({});
  const { currentUser } = useAuth();
  const { profile: viewer } = useUser();
  const { isUserLive } = useLiveUsers();
  const navigate = useNavigate();

  // Whose list to show: the :uid route param (other users) or the signed-in user.
  const targetUid = routeUid || currentUser?.uid;
  const isSelf = targetUid === currentUser?.uid;

  useEffect(() => {
    if (!targetUid || !currentUser) return;
    const load = async () => {
      setLoading(true);
      try {
        // Fans (paying members) are private to the creator — only on own profile.
        const [followerList, followingList, fanList] = await Promise.all([
          getFollowersDetailed(targetUid, 100),
          getFollowingDetailed(targetUid, 100),
          isSelf ? getFans(targetUid, 100) : Promise.resolve([]),
        ]);
        setFollowers(followerList); setFollowing(followingList); setFans(fanList);
        const states = {};
        await Promise.all([...followerList, ...followingList, ...fanList].map(async (user) => {
          if (user.id === currentUser.uid) return;
          states[user.id] = await checkFollowing(currentUser.uid, user.id);
        }));
        setFollowStates(states);
      } catch (err) { console.error('Failed to load follow data:', err); }
      setLoading(false);
    };
    load();
  }, [targetUid, currentUser]);

  const handleFollowToggle = async (userId) => {
    const was = followStates[userId];
    setFollowStates(prev => ({ ...prev, [userId]: !was }));
    try { was ? await unfollowUser(currentUser.uid, userId) : await followUser(currentUser.uid, userId); }
    catch (err) { console.error(err); setFollowStates(prev => ({ ...prev, [userId]: was })); }
  };

  const TAB_LABEL = { followers: 'Followers', following: 'Following', fans: 'Fans' };
  const listFor = { followers, following, fans };
  // Fans tab only on your own profile (paying-member lists are private).
  const TABS = isSelf ? ['followers', 'following', 'fans'] : ['followers', 'following'];
  const safeTab = TABS.includes(activeTab) ? activeTab : 'followers';
  const currentList = filterForEnumeration(listFor[safeTab] || [], viewer);

  return (
    <div className="min-h-screen pb-8">
      <TopBar showBack title={TAB_LABEL[safeTab] || 'Followers'} />
      <div className="flex border-b border-white/[0.04]">
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 py-3.5 text-sm font-bold text-center relative ${safeTab === tab ? 'text-white' : 'text-text-muted'}`}>
            {`${TAB_LABEL[tab]}${listFor[tab].length ? ` (${listFor[tab].length})` : ''}`}
            {safeTab === tab && <motion.div layoutId="nativeFollowTab" className="absolute bottom-0 left-4 right-4 h-[2px] bg-brand-violet rounded-full" />}
          </button>
        ))}
      </div>
      <div className="px-4 py-3">
        {loading ? <ListSkeleton rows={8} /> : currentList.length === 0 ? (
          <div className="text-center py-16">
            <Icon name={safeTab === 'fans' ? 'workspace_premium' : safeTab === 'followers' ? 'group' : 'person_search'} size={48} className="text-text-muted/30 mx-auto mb-3" />
            <p className="text-text-muted text-sm">
              {safeTab === 'fans'
                ? (isSelf ? 'No fans yet. Set up membership tiers so supporters can subscribe.' : 'No fans yet.')
                : safeTab === 'followers'
                  ? 'No followers yet. Share your content to grow your audience!'
                  : 'Not following anyone yet. Discover people to follow!'}
            </p>
            {safeTab === 'fans' && isSelf && <button onClick={() => navigate('/creator/membership')} className="mt-4 px-5 py-2.5 rounded-full bg-brand-violet text-white text-sm font-bold">Set up tiers</button>}
            {safeTab === 'following' && <button onClick={() => navigate('/explore')} className="mt-4 px-5 py-2.5 rounded-full bg-brand-violet text-white text-sm font-bold">Explore</button>}
          </div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {currentList.map(user => (
              <UserRow key={user.id} user={user} viewer={viewer} isUserLive={isUserLive} navigate={navigate}
                showTier={safeTab === 'fans'}
                follow={followStates[user.id]} onToggle={user.id !== currentUser.uid ? handleFollowToggle : null} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ SEARCH (People / Squads / Posts)

export function NativeSearchResultsAllScreen() {
  const { profile: viewer } = useUser();
  const { isUserLive } = useLiveUsers();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [activeTab, setActiveTab] = useState('People');
  const [users, setUsers] = useState([]);
  const [squads, setSquads] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const doSearch = useCallback(async (term) => {
    if (!term || term.length < 2) { setUsers([]); setSquads([]); setPosts([]); return; }
    setLoading(true);
    try {
      const [u, s, p] = await Promise.all([searchUsers(term, 10), getSquads(20), getFeedPosts(20)]);
      setUsers(u.filter(user => user.id !== currentUser?.uid));
      setSquads(s.filter(sq => sq.name?.toLowerCase().includes(term.toLowerCase())));
      setPosts(p.filter(post => post.content?.toLowerCase().includes(term.toLowerCase())));
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [currentUser]);

  useEffect(() => { const q = searchParams.get('q'); if (q) { setQuery(q); doSearch(q); } }, [searchParams, doSearch]);
  const handleSearch = (e) => { e.preventDefault(); if (query.trim()) { setSearchParams({ q: query.trim() }); doSearch(query.trim()); } };

  const tabs = ['People', 'Squads', 'Posts'];
  const currentResults = activeTab === 'People' ? users : activeTab === 'Squads' ? squads : posts;

  return (
    <div className="min-h-screen pb-8">
      {/* Native-safe sticky search header (the wrapper's safe-top already insets
          the page, so this sticky bar needs its own inset to clear the status
          bar when scrolled to top). */}
      <div className="sticky top-0 z-40 glass-header" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}>
        <form onSubmit={handleSearch} className="px-4 pb-2 flex items-center gap-2">
          <button type="button" onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center shrink-0"><Icon name="arrow_back" size={20} /></button>
          <div className="flex-1 relative">
            <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people, squads, posts..."
              className="w-full bg-surface-2 border border-white/[0.06] rounded-full py-2.5 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-violet focus:outline-none" autoFocus />
          </div>
        </form>
        <div className="flex px-4 gap-4">
          {tabs.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`pb-2.5 text-sm font-bold relative ${activeTab === tab ? 'text-brand-violet-light' : 'text-text-muted'}`}>
              {tab}{activeTab === tab && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-violet" />}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3">
        {loading ? <ListSkeleton rows={6} /> : !query.trim() ? (
          <div className="text-center py-16"><Icon name="search" size={48} className="text-text-muted/20 mx-auto mb-3" /><p className="text-text-muted text-sm">Search for people, squads, or posts</p></div>
        ) : currentResults.length === 0 ? (
          <div className="text-center py-16"><Icon name="search_off" size={48} className="text-text-muted/20 mx-auto mb-3" /><p className="text-text-muted text-sm">No {activeTab.toLowerCase()} found for "{query}"</p></div>
        ) : activeTab === 'People' ? (
          <div className="space-y-2">
            {users.map(user => {
              const masked = applyVanguardMask(user, viewer);
              const isMasked = !!masked?.isVanguardPersona;
              const vRank = user.vanguard?.rank;
              return (
                <button key={user.id} onClick={() => navigate(`/user/${user.id}`)} className="flex items-center gap-3 w-full p-3 rounded-2xl bg-surface-1 border border-white/[0.06] text-left active:border-white/[0.12]">
                  <UserAvatar src={masked.avatar} size="md" isLive={!isMasked && isUserLive(user.id)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1"><p className="text-sm font-semibold truncate"><UserName user={masked} masked /></p>{!isMasked && user.isVerified && <Icon name="verified" filled size={14} className="text-brand-violet-light" />}{vRank && <VanguardBadge rank={vRank} size={13} />}</div>
                    <p className="text-xs text-text-muted"><UserName user={masked} masked handle /></p>
                  </div>
                  <Icon name="chevron_right" size={18} className="text-text-muted" />
                </button>
              );
            })}
          </div>
        ) : activeTab === 'Squads' ? (
          <div className="space-y-2">
            {squads.map(squad => (
              <button key={squad.id} onClick={() => navigate(`/squads/${squad.id}`)} className="flex items-center gap-3 w-full p-3 rounded-2xl bg-surface-1 border border-white/[0.06] text-left active:border-white/[0.12]">
                <div className="w-12 h-12 rounded-xl bg-surface-3 flex items-center justify-center text-xl">{squad.avatar || '🎮'}</div>
                <div className="flex-1 min-w-0"><p className="text-sm font-semibold truncate">{squad.name}</p><p className="text-xs text-text-muted">{squad.game} · {squad.memberCount || 0} members</p></div>
                <Icon name="chevron_right" size={18} className="text-text-muted" />
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map(post => {
              const a = applyVanguardMask(post.author, viewer);
              return (
                <button key={post.id} onClick={() => navigate(`/post/${post.id}`)} className="w-full p-3 rounded-2xl bg-surface-1 border border-white/[0.06] text-left active:border-white/[0.12]">
                  <div className="flex items-center gap-2 mb-1"><UserAvatar src={a?.avatar} size="sm" /><span className="text-xs font-semibold"><UserName user={a} masked /></span>{post.author?.vanguard?.rank && <VanguardBadge rank={post.author.vanguard.rank} size={11} />}</div>
                  <p className="text-sm text-text-primary line-clamp-2">{post.content}</p>
                  <div className="flex gap-3 mt-2"><span className="text-[10px] text-text-muted flex items-center gap-1"><Icon name="favorite" size={10} /> {post.likeCount || 0}</span><span className="text-[10px] text-text-muted flex items-center gap-1"><Icon name="chat_bubble" size={10} /> {post.commentCount || 0}</span></div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ LIVE STREAMS (search)

export function NativeSearchResultsStreamsScreen() {
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => { getLiveStreams(20).then(setStreams).catch(console.error).finally(() => setLoading(false)); }, []);

  return (
    <div className="min-h-screen pb-8">
      <TopBar title="Live Streams" showBack />
      <div className="px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-surface-3 border-t-brand-violet rounded-full animate-spin" /></div>
        ) : streams.length === 0 ? (
          <div className="text-center py-16">
            <Icon name="live_tv" size={48} className="text-text-muted/30 mx-auto mb-3" />
            <p className="text-text-muted text-sm">No one is live right now</p>
            <p className="text-text-muted/60 text-xs mt-1">Be the first to go live!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {streams.map(stream => (
              <button key={stream.id} onClick={() => navigate(`/stream/${stream.id}`)}
                className="w-full flex items-center gap-3 p-4 rounded-2xl bg-surface-1 border border-white/[0.06] text-left active:border-brand-ember/30">
                <div className="w-12 h-12 rounded-xl bg-surface-3 flex items-center justify-center text-xl">🎮</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{stream.title}</p>
                  <p className="text-xs text-text-muted"><UserName user={stream.streamer} masked fallback={'Streamer'} /> · {stream.game}</p>
                </div>
                <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-brand-ember/10">
                  <div className="w-1.5 h-1.5 rounded-full bg-brand-ember animate-pulse" />
                  <span className="text-[10px] font-bold text-brand-ember">{stream.viewerCount || 0}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ BROWSE CREATORS

export function NativeBrowseCreatorsScreen() {
  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const qy = query(collection(db, 'users'), where('role', '==', 'creator'), orderBy('followerCount', 'desc'), limit(30));
        const snap = await getDocs(qy);
        setCreators(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) { console.error(err); }
      setLoading(false);
    })();
  }, []);

  const fmt = (n) => n >= 1000 ? (n / 1000).toFixed(1) + 'K' : (n || 0).toString();

  return (
    <div className="min-h-screen pb-8">
      <TopBar title="Browse Creators" showBack />
      <div className="px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-surface-3 border-t-brand-violet rounded-full animate-spin" /></div>
        ) : creators.length === 0 ? (
          <div className="text-center py-16">
            <Icon name="video_camera_front" size={48} className="text-text-muted/30 mx-auto mb-3" />
            <p className="text-text-muted text-sm">No creators yet</p>
            <p className="text-text-muted/60 text-xs mt-1">Be the first! Apply for creator status in settings.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {creators.map(c => (
              <button key={c.id} onClick={() => navigate(`/user/${c.id}`)} className="w-full flex items-center gap-3 p-4 rounded-2xl bg-surface-1 border border-white/[0.06] text-left active:border-white/[0.12]">
                <UserAvatar src={c.avatar} size="lg" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5"><p className="font-bold text-sm truncate"><UserName user={c} masked /></p>{c.isVerified && <Icon name="verified" filled size={14} className="text-brand-violet-light" />}</div>
                  <p className="text-xs text-text-muted"><UserName user={c} masked handle /></p>
                  <p className="text-xs text-brand-gold font-dmmono mt-1">{fmt(c.followerCount)} fans</p>
                </div>
                <Icon name="chevron_right" size={18} className="text-text-muted" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ PRESTIGE LEVELS

export function NativePrestigeLevelsScreen() {
  const navigate = useNavigate();
  const { profile, wallet } = useUser();

  return (
    <div className="min-h-screen pb-8">
      <TopBar title="VP & Prestige" showBack />
      <div className="px-4 py-4">
        <PrestigeShowcase
          totalVP={wallet?.vp || 0}
          plan={resolveTier(profile)}
          prestige={profile?.prestige || 0}
          boostTokens={Number(wallet?.boostTokens) || 0}
          navigate={navigate}
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ ESPORTS TEAM

export function NativeEsportsTeamScreen() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const [team, setTeam] = useState(null);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!teamId) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'teams', teamId));
        if (snap.exists()) {
          const data = { id: snap.id, ...snap.data() };
          setTeam(data);
          if (data.roster) { const players = await Promise.all(data.roster.map(id => getUser(id))); setRoster(players.filter(Boolean)); }
        }
      } catch (err) { console.error(err); }
      setLoading(false);
    })();
  }, [teamId]);

  if (loading) return <div className="min-h-screen"><TopBar showBack title="Team" /><div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-surface-3 border-t-brand-violet rounded-full animate-spin" /></div></div>;
  if (!team) return <div className="min-h-screen"><TopBar showBack title="Team" /><div className="text-center py-20"><p className="text-text-muted">Team not found</p></div></div>;

  return (
    <div className="min-h-screen pb-8">
      <TopBar showBack title={team.name} />
      <div className="px-4 py-4">
        <div className="p-5 rounded-2xl bg-surface-1 border border-white/[0.06] mb-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-14 h-14 rounded-2xl bg-brand-violet flex items-center justify-center text-2xl font-black text-white">{team.tag || '?'}</div>
            <div><h2 className="font-syne text-xl font-bold">{team.name}</h2><p className="text-text-muted text-xs">{team.game} · {team.region}</p></div>
          </div>
          <div className="flex gap-4">
            <div><p className="text-[10px] text-text-muted uppercase">Wins</p><p className="font-dmmono font-bold text-green-500">{team.wins || 0}</p></div>
            <div><p className="text-[10px] text-text-muted uppercase">Losses</p><p className="font-dmmono font-bold text-brand-ember">{team.losses || 0}</p></div>
            <div><p className="text-[10px] text-text-muted uppercase">Team XP</p><p className="font-dmmono font-bold text-brand-violet-light">{team.teamXP || 0}</p></div>
          </div>
        </div>
        <h3 className="font-syne font-bold text-base mb-3">Roster ({roster.length})</h3>
        <div className="space-y-2">
          {roster.map(player => (
            <button key={player.id} onClick={() => navigate(`/user/${player.id}`)} className="flex items-center gap-3 w-full p-3 rounded-2xl bg-surface-1 border border-white/[0.06] text-left">
              <UserAvatar src={player.avatar} size="md" />
              <div className="flex-1 min-w-0"><p className="text-sm font-semibold truncate"><UserName user={player} masked /></p><p className="text-xs text-text-muted"><UserName user={player} masked handle /></p></div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
