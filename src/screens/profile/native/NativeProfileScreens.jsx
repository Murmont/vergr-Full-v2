// NATIVE-APP profile screens (Android/iOS Tauri shell ONLY).
//
// Dedicated mobile-first variants of ProfileScreen (own) + PublicProfileScreen
// (others). Routed `IS_NATIVE_BUILD ? <Native> : <existing>`; never render on
// web. The existing src/screens/profile/* are UNTOUCHED. Each reuses the SAME
// data hooks/callables as its web twin — only the layout is phone-first:
//   - single-column full-width feed of PostCards (no thin 2-up grid)
//   - username + rank paint ABOVE the banner (relative z-10), name BELOW the
//     banner edge (founder requirement)
//   - no desktop right rail
// These render INSIDE ResponsiveLayout's native wrapper (full-width + safe-top),
// so the banner already clears the status bar — the action buttons sit at the
// normal top-3.5 with NO extra safe-area padding.

import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../../../context/AuthContext';
import { useUser } from '../../../context/UserContext';
import { useUI } from '../../../context/UIContext';
import { useLiveUsers } from '../../../context/LiveUsersContext';
import {
  getUserPosts, getBookmarks, getFollowers, getFollowing, getLikedPosts, getPost,
  getUserById, getUserByUsername, getUserVP,
  followUser, unfollowUser, isFollowing as checkFollowing, createConversation, reportUser,
} from '../../../firebase/firestore';
import { getVPLevel, getVPProgress, getNextVPLevel } from '../../../utils/vpSystem';
import { PRIVACY_DEFAULTS } from '../../../utils/privacy';
import { presenceVisible } from '../../../utils/presence';
import { withRef } from '../../../utils/shareRef';
import { vergrMeUrl } from '../../../utils/vergrMeUrl';
import useOnlineStatus from '../../../hooks/useOnlineStatus';
import { applyVanguardMask, rankMeta } from '../../../utils/vanguard';
import { trackEvent } from '../../../utils/trackEvent';
import BadgesShowcase from '../../../components/BadgesShowcase';
import MembershipBlock from '../../../components/membership/MembershipBlock';
import UserAvatar from '../../../components/UserAvatar';
import MyQrModal from '../../../components/messages/MyQrModal';
import CachedImg from '../../../components/CachedImg';
import Icon from '../../../components/Icon';
import PostCard from '../../../components/PostCard';
import ProfileCompletionCard from '../../../components/profile/ProfileCompletionCard';
import VanguardBadge from '../../../components/VanguardBadge';
import { CoinIcon, VPIcon } from '../../../components/CoinIcon';
import { ProfileSkeleton } from '../../../components/skeletons/GlassSkeletons';
import NameAudioButton from '../../../components/profile/NameAudioButton';
import StreamScheduleCard from '../../../components/profile/StreamScheduleCard';
import ReportSheet from '../../../components/ReportSheet';
import useHeaderCollapse from '../../../hooks/useHeaderCollapse';
import { bannerGradient, MiniDockHeader } from '../../../components/profile/profilePolish';

const OWN_TABS = ['Posts', 'Media', 'Clips', 'Likes', 'Bookmarks'];
// Likes are private (IG model): own profile only, never on someone else's.
const PUBLIC_TABS = ['Posts', 'Media', 'Clips'];

// ═══════════════════════════════════════ shared bits

function formatCount(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString();
}
function socialsToList(socials, enabled = {}) {
  if (!socials) return [];
  if (Array.isArray(socials)) return socials.filter(s => s && s.url);
  if (typeof socials === 'object') {
    return Object.entries(socials)
      .filter(([platform, url]) => url && enabled?.[platform] !== false)
      .map(([platform, url]) => ({ platform, url }));
  }
  return [];
}
function socialIcon(platform) {
  const map = { twitter: 'public', x: 'public', youtube: 'play_circle', instagram: 'photo_camera',
                tiktok: 'music_note', discord: 'chat', twitch: 'live_tv', website: 'language' };
  return map[(platform || '').toLowerCase()] || 'link';
}
function Banner({ children, banner, uid, parallaxRef }) {
  return (
    <div className="relative h-[176px] overflow-hidden">
      {/* Inner wrapper carries the scroll parallax so overlaid buttons never
          move/blur with the art (B8.1). Bannerless = per-uid gradient (B8.4). */}
      <div ref={parallaxRef} className="absolute inset-0 will-change-transform">
        <div className="absolute inset-0" style={{ background: banner
          ? 'linear-gradient(135deg,#0d0820 0%,#1a0a3a 30%,#2d0a5a 60%,#1a0a30 100%)'
          : bannerGradient(uid) }}>
          <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 70% 50%,rgba(123,31,255,0.25) 0%,transparent 65%), radial-gradient(ellipse at 90% 30%,rgba(61,127,255,0.15) 0%,transparent 50%)' }} />
        </div>
        {banner && <CachedImg src={banner} permanent alt="" className="absolute inset-0 w-full h-full object-cover" />}
      </div>
      {children}
    </div>
  );
}
function BannerBtn({ icon, onClick, label }) {
  return (
    <button onClick={onClick} aria-label={label}
      className="w-[34px] h-[34px] flex items-center justify-center rounded-lg text-white active:scale-95"
      style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}>
      <Icon name={icon} size={16} />
    </button>
  );
}
function StatCell({ label, value, onClick }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center py-1 active:opacity-70">
      <span className="text-[18px] font-extrabold text-text-primary font-dmmono tabular-nums leading-none">{value}</span>
      <span className="text-[11px] text-text-muted mt-1">{label}</span>
    </button>
  );
}
function VPCard({ vp, vpLevel, vpProgress, vpNext, vpToNext, onClick }) {
  return (
    <button onClick={onClick}
      className="w-full mt-3 flex items-center gap-3 p-3.5 rounded-2xl text-left active:brightness-110"
      style={{ background: 'rgba(123,31,255,0.08)', border: '1px solid rgba(180,79,255,0.20)' }}>
      <div className="flex-1 min-w-0">
        <p className="text-[9px] font-bold tracking-widest uppercase" style={{ color: '#B44FFF' }}>Vergr Points</p>
        <p className="text-[19px] font-black text-text-primary leading-none mt-0.5">
          {vp.toLocaleString()} <span className="text-[13px]" style={{ color: '#B44FFF' }}>VP</span>
        </p>
        <div className="h-[3px] rounded mt-1.5" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <div className="h-full rounded" style={{ width: `${Math.min(100, (vpProgress || 0))}%`, background: 'linear-gradient(90deg,#7B1FFF,#B44FFF)' }} />
        </div>
        <p className="text-[10px] text-text-muted mt-1">{vpNext ? `${vpToNext.toLocaleString()} VP to Lvl ${vpNext.level}` : 'Max level reached'}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <VPIcon size={36} className="drop-shadow-[0_0_12px_rgba(180,79,255,0.5)]" />
        <div className="flex flex-col items-end gap-1">
          <BadgesShowcase level={vpLevel?.level || 1} size={32} />
          <p className="text-[9px] text-text-muted leading-none">{vpLevel?.name || 'Rookie'}</p>
        </div>
      </div>
    </button>
  );
}
function Tabs({ tabs, active, onSelect }) {
  return (
    <div className="flex overflow-x-auto no-scrollbar px-3 border-b" style={{ borderColor: '#1E1E2E' }}>
      {tabs.map(t => (
        <button key={t} onClick={() => onSelect(t)}
          className="shrink-0 px-4 py-3 text-[13px] font-semibold transition-colors"
          style={active === t ? { color: '#fff', borderBottom: '2px solid #B44FFF' } : { color: '#6B7280', borderBottom: '2px solid transparent' }}>
          {t}
        </button>
      ))}
    </div>
  );
}
function PostsColumn({ posts, emptyLabel, onDeleted }) {
  if (posts.length === 0) {
    return (
      <div className="text-center py-16">
        <Icon name="inbox" size={48} className="text-text-muted/20 mx-auto mb-3" />
        <p className="text-text-muted text-sm">{emptyLabel}</p>
      </div>
    );
  }
  // Single full-width column of feed cards — clean + professional on a phone.
  return (
    <div className="flex flex-col divide-y divide-white/[0.04]">
      {posts.map(p => <PostCard key={p.id} post={p} onDeleted={onDeleted} />)}
    </div>
  );
}
function MenuItem({ icon, label, onClick }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[14px] text-text-secondary active:bg-white/[0.05] active:text-white text-left">
      <Icon name={icon} size={17} /> {label}
    </button>
  );
}

// ═══════════════════════════════════════ OWN PROFILE

export function NativeProfileScreen() {
  const { currentUser, logout } = useAuth();
  const { profile, wallet } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('Posts');
  const [posts, setPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [bookmarks, setBookmarks] = useState([]);
  const [likedPosts, setLikedPosts] = useState([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const { bannerRef, docked } = useHeaderCollapse({ dockAt: 150 });

  const vp = wallet?.vp || 0;
  const vpLevel = getVPLevel?.(vp);
  const vpProgress = getVPProgress?.(vp) ?? 0;
  const vpNext = getNextVPLevel?.(vp);
  const vpToNext = vpNext ? Math.max(0, vpNext.vpRequired - vp) : 0;

  useEffect(() => {
    if (!currentUser?.uid) return;
    setLoadingPosts(true);
    getUserPosts(currentUser.uid, 30).then(setPosts).catch(console.error).finally(() => setLoadingPosts(false));
    getFollowers(currentUser.uid).then(r => setFollowerCount(r?.length || 0)).catch(() => {});
    getFollowing(currentUser.uid).then(r => setFollowingCount(r?.length || 0)).catch(() => {});
    getBookmarks(currentUser.uid).then(setBookmarks).catch(() => {});
    getLikedPosts(currentUser.uid, 40).then(setLikedPosts).catch(() => {});
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  const filteredPosts = useMemo(() => {
    if (activeTab === 'Media') return posts.filter(p => p.imageUrl || p.videoUrl);
    if (activeTab === 'Clips') return posts.filter(p => p.type === 'clip');
    if (activeTab === 'Likes') return likedPosts;
    if (activeTab === 'Bookmarks') return bookmarks;
    return posts;
  }, [activeTab, posts, bookmarks, likedPosts]);

  const displayName = profile?.displayName || profile?.username || 'You';
  const handle = profile?.username ? `@${profile.username}` : '';
  const initial = (displayName[0] || 'V').toUpperCase();
  const joined = profile?.createdAt
    ? new Date(profile.createdAt.toDate ? profile.createdAt.toDate() : profile.createdAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
    : '';
  const onShare = () => {
    const url = withRef(vergrMeUrl(profile?.username || currentUser?.uid));
    if (navigator.share) navigator.share({ title: displayName, url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => showToast?.('Profile link copied', 'success'));
  };

  return (
    <div className="pb-10 overflow-x-hidden" style={{ background: '#0B0B14' }}>
      <MiniDockHeader show={docked} avatar={profile?.avatar} name={displayName} />
      <Banner banner={profile?.banner} uid={currentUser?.uid} parallaxRef={bannerRef}>
        <span className="absolute right-5 bottom-4 font-syne font-black tracking-widest uppercase select-none pointer-events-none leading-none" style={{ fontSize: 56, color: 'rgba(255,255,255,0.05)' }}>
          {(profile?.username || 'VERGR').toUpperCase()}
        </span>
        <div className="absolute right-3.5 flex items-center gap-2" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}>
          <button onClick={onShare} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold text-white active:scale-95"
            style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}>
            <Icon name="share" size={13} /> Share
          </button>
          <BannerBtn icon="settings" label="Settings" onClick={() => navigate('/settings')} />
          <div className="relative">
            <BannerBtn icon="more_vert" label="More" onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }} />
            {menuOpen && (
              <div className="absolute top-[calc(100%+6px)] right-0 min-w-[230px] rounded-2xl p-1.5 z-30 max-h-[70vh] overflow-y-auto"
                style={{ background: '#14141F', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                onClick={(e) => e.stopPropagation()}>
                <MenuItem icon="edit" label="Edit Profile" onClick={() => { setMenuOpen(false); navigate('/edit-profile'); }} />
                <MenuItem icon="qr_code_2" label="My QR code" onClick={() => { setMenuOpen(false); setShowQr(true); }} />
                <MenuItem icon="link" label="Vergr.me" onClick={() => { setMenuOpen(false); navigate('/vergrme/edit'); }} />
                <div className="h-px my-1" style={{ background: '#1E1E2E' }} />
                <MenuItem icon="account_balance_wallet" label="Wallet" onClick={() => { setMenuOpen(false); navigate('/wallet'); }} />
                <MenuItem icon="emoji_events" label="Tournaments" onClick={() => { setMenuOpen(false); navigate('/tournaments'); }} />
                <MenuItem icon="groups" label="Squads" onClick={() => { setMenuOpen(false); navigate('/squads'); }} />
                <MenuItem icon="workspace_premium" label="Subscription" onClick={() => { setMenuOpen(false); navigate('/settings/subscription'); }} />
                <MenuItem icon="verified_user" label="Verify (KYC)" onClick={() => { setMenuOpen(false); navigate('/creator/verify'); }} />
                <div className="h-px my-1" style={{ background: '#1E1E2E' }} />
                <MenuItem icon="dashboard" label="Creator Studio" onClick={() => { setMenuOpen(false); navigate('/creator/dashboard'); }} />
                <MenuItem icon="analytics" label="Analytics" onClick={() => { setMenuOpen(false); navigate('/creator/analytics'); }} />
                <MenuItem icon="history" label="Activity Log" onClick={() => { setMenuOpen(false); navigate('/transactions/filter'); }} />
                <div className="h-px my-1" style={{ background: '#1E1E2E' }} />
                <MenuItem icon="settings" label="Settings" onClick={() => { setMenuOpen(false); navigate('/settings'); }} />
                <MenuItem icon="help" label="Help Center" onClick={() => { setMenuOpen(false); navigate('/help'); }} />
                <MenuItem icon="logout" label="Sign out" onClick={async () => { setMenuOpen(false); try { await logout(); } catch {} navigate('/login'); }} />
              </div>
            )}
          </div>
        </div>
      </Banner>

      {/* HEADER — relative z-10 paints avatar/name/rank ABOVE the banner. */}
      <div className="px-5 relative z-10">
        <div className="flex items-end gap-4 -mt-11 mb-3">
          <div className="w-[88px] h-[88px] rounded-full flex items-center justify-center font-syne font-black text-[30px] relative shrink-0"
            style={{ background: 'linear-gradient(135deg,#7b1fff,#3b82f6)', border: '3px solid #B44FFF', boxShadow: '0 0 0 3px #0B0B14, 0 0 20px rgba(180,79,255,0.5)' }}>
            <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center">
              {profile?.avatar ? <CachedImg src={profile.avatar} permanent alt={displayName} className="w-full h-full object-cover" /> : initial}
            </div>
            {presenceVisible(profile) && (
              <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full" style={{ background: '#22D17E', border: '3px solid #0B0B14', boxShadow: '0 0 8px rgba(34,209,126,0.55)' }} title="Online" />
            )}
          </div>
          <div className="flex-1 pb-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <span className="text-[22px] font-extrabold text-text-primary truncate">{displayName}</span>
              <NameAudioButton url={profile?.nameAudioUrl} />
              {profile?.verified && <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: '#7B1FFF' }}><Icon name="check" size={11} className="text-white" /></div>}
              <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase shrink-0" style={{ background: 'rgba(123,31,255,0.20)', color: '#B44FFF', border: '1px solid rgba(180,79,255,0.30)' }}>{vpLevel?.name || 'Rookie'}</span>
            </div>
            {handle && <div className="text-[12px] text-text-muted mb-1.5">{handle}</div>}
          </div>
        </div>
        {profile?.bio && <p className="text-[13px] text-text-secondary leading-relaxed mb-2 whitespace-pre-line">{profile.bio}</p>}
        <div className="flex items-center gap-2.5 flex-wrap mb-1">
          {socialsToList(profile?.socials, profile?.socialEnabled).slice(0, 5).map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noreferrer" className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted active:text-white"
               style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}><Icon name={socialIcon(s.platform)} size={13} /></a>
          ))}
          {joined && <span className="flex items-center gap-1 text-[11px] text-text-muted"><Icon name="event" size={12} /> Joined {joined}</span>}
        </div>
      </div>

      {/* STATS */}
      <div className="px-5 py-3 border-b" style={{ borderColor: '#1E1E2E' }}>
        <div className="grid grid-cols-3">
          <StatCell label="Followers" value={formatCount(followerCount)} onClick={() => navigate(`/connections/${currentUser.uid}/followers`)} />
          <StatCell label="Following" value={formatCount(followingCount)} onClick={() => navigate(`/connections/${currentUser.uid}/following`)} />
          <StatCell label="Posts" value={formatCount(posts.length)} onClick={() => setActiveTab('Posts')} />
        </div>
        <VPCard vp={vp} vpLevel={vpLevel} vpProgress={vpProgress} vpNext={vpNext} vpToNext={vpToNext} onClick={() => navigate('/prestige')} />
      </div>

      {/* Complete-your-profile checklist (self-hides once done + claimed;
          pays the founder-approved profile-completion VP). */}
      <div className="px-5 pt-4">
        <ProfileCompletionCard />
      </div>

      <Tabs tabs={OWN_TABS} active={activeTab} onSelect={setActiveTab} />

      <div className="pt-1">
        {loadingPosts ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-surface-3 border-t-brand-violet-light rounded-full animate-spin" /></div>
        ) : (
          <PostsColumn posts={filteredPosts} emptyLabel={`No ${activeTab.toLowerCase()} yet`} onDeleted={(id) => { setPosts(prev => prev.filter(p => p.id !== id)); setBookmarks(prev => prev.filter(p => p.id !== id)); }} />
        )}
      </div>
      <MyQrModal open={showQr} onClose={() => setShowQr(false)} />
    </div>
  );
}

// ═══════════════════════════════════════ PUBLIC PROFILE

export function NativePublicProfileScreen() {
  const { id } = useParams();
  const { currentUser } = useAuth();
  const { isUserLive, liveStreamFor } = useLiveUsers();
  const { profile: viewer } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const { isOnline: userOnline } = useOnlineStatus(user?.id);
  const [userVP, setUserVP] = useState(0);
  const [posts, setPosts] = useState([]);
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Posts');
  const [toggling, setToggling] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [targetFollowsMe, setTargetFollowsMe] = useState(false);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoading(true);
      try {
        let u = await getUserById(id);
        if (!u) u = await getUserByUsername(id);
        if (u) {
          setUser(u);
          if (currentUser?.uid && u.id !== currentUser.uid) trackEvent('profile_visit', { authorId: u.id, target: 'user' });
          const [userPosts, isFollow, vpData, followers, followingList] = await Promise.all([
            getUserPosts(u.id, 30),
            currentUser ? checkFollowing(currentUser.uid, u.id) : false,
            getUserVP(u.id).catch(() => ({ vp: 0 })),
            getFollowers(u.id).catch(() => []),
            getFollowing(u.id).catch(() => []),
          ]);
          setPosts(userPosts || []);
          setFollowing(!!isFollow);
          setUserVP(vpData?.vp || 0);
          setFollowerCount((followers?.length) ?? u.followerCount ?? 0);
          setFollowingCount((followingList?.length) ?? u.followingCount ?? 0);
          setTargetFollowsMe(currentUser?.uid ? (followingList || []).some(e => e.followingId === currentUser.uid) : false);
        }
      } catch (err) { console.error('Error loading profile:', err); }
      finally { setLoading(false); }
    };
    load();
  }, [id, currentUser]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  const isMe = currentUser?.uid === user?.id;
  const isBot = String(user?.accountType || '').includes('bot');
  const vpLevel = getVPLevel(userVP);
  const vpProgress = getVPProgress(userVP);
  const vpNext = getNextVPLevel(userVP);
  const vpToNext = vpNext ? Math.max(0, vpNext.vpRequired - userVP) : 0;

  const handleFollowToggle = async () => {
    if (!currentUser || !user || toggling) return;
    setToggling(true);
    const wasFollowing = following;
    setFollowing(!wasFollowing);
    setFollowerCount(c => c + (wasFollowing ? -1 : 1));
    try {
      if (wasFollowing) await unfollowUser(currentUser.uid, user.id);
      else { await followUser(currentUser.uid, user.id); trackEvent('creator_follow', { authorId: user.id }); }
    } catch {
      setFollowing(wasFollowing);
      setFollowerCount(c => c - (wasFollowing ? -1 : 1));
      showToast('Failed to update follow status', 'error');
    }
    setToggling(false);
  };
  const handleMessage = async () => {
    if (!currentUser || !user) return;
    try { const convoId = await createConversation(currentUser.uid, user); navigate(`/messages/${convoId}`); }
    catch { showToast('Failed to start conversation', 'error'); }
  };
  const handleShare = () => {
    const h = user?.username || user?.id;
    const url = withRef(vergrMeUrl(h));
    if (navigator.share) navigator.share({ title: user?.displayName || user?.username, url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => showToast?.('Profile link copied', 'success'));
  };

  const masked = user ? applyVanguardMask(user, viewer) : null;
  const { bannerRef, docked } = useHeaderCollapse({ dockAt: 150 });
  const [showReport, setShowReport] = useState(false);

  // Pinned posts — fetched by id in array order (cap 3).
  const [pinnedPosts, setPinnedPosts] = useState([]);
  useEffect(() => {
    const ids = (user?.pinnedPostIds || []).slice(0, 3);
    if (!ids.length) { setPinnedPosts([]); return; }
    let live = true;
    Promise.all(ids.map(pid => getPost(pid).catch(() => null)))
      .then(list => { if (live) setPinnedPosts(list.filter(Boolean)); });
    return () => { live = false; };
  }, [user?.pinnedPostIds]);

  const filteredPosts = useMemo(() => {
    if (!user) return [];
    const decorated = posts.map(p => ({ ...p, author: user }));
    if (activeTab === 'Media') return decorated.filter(p => p.imageUrl || p.videoUrl);
    if (activeTab === 'Clips') return decorated.filter(p => p.type === 'clip');
    // Posts tab: pinned render above in their own row, so drop them here.
    const pinnedIds = new Set(pinnedPosts.map(p => p.id));
    return decorated.filter(p => !pinnedIds.has(p.id));
  }, [activeTab, posts, user, pinnedPosts]);

  if (loading) return <ProfileSkeleton />;
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
        <Icon name="person_off" size={48} className="text-text-muted/30 mb-3" />
        <p className="text-text-muted text-sm">User not found</p>
      </div>
    );
  }

  // Privacy → Profile visibility (parity with web PublicProfileScreen).
  const _priv = { ...PRIVACY_DEFAULTS, ...(user.settings?.privacy || {}) };
  const _related = following || targetFollowsMe;
  if (!isMe && viewer?.role !== 'admin' &&
      (_priv.profileVis === 'Only me' || (_priv.profileVis === 'Friends & Followers' && !_related))) {
    const pvName = user.username ? `@${user.username}` : (user.displayName || 'This user');
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-6">
        <div className="w-20 h-20 rounded-full bg-surface-2 flex items-center justify-center mb-4">
          <Icon name="lock" size={32} className="text-text-muted" />
        </div>
        <p className="text-text-primary font-semibold mb-1">{pvName}</p>
        <p className="text-text-muted text-sm max-w-xs mb-4">This profile is private. Follow this user to see their profile.</p>
        {currentUser && !following && (
          <button onClick={handleFollowToggle} disabled={toggling}
            className="px-5 py-2 rounded-full bg-brand-violet-light text-white font-semibold text-sm disabled:opacity-60">Follow</button>
        )}
      </div>
    );
  }

  const displayName = masked.displayName || masked.username || 'User';
  const handle = masked.username ? `@${masked.username}` : '';
  const initial = (displayName[0] || 'V').toUpperCase();
  const vanguardRank = user.vanguard?.rank;
  const joined = user.createdAt
    ? new Date(user.createdAt.toDate ? user.createdAt.toDate() : user.createdAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
    : '';

  return (
    <div className="pb-10 overflow-x-hidden" style={{ background: '#0B0B14' }}>
      <MiniDockHeader show={docked} avatar={masked.avatar} name={displayName} onBack={() => navigate(-1)} />
      <Banner banner={!masked.isVanguardPersona ? user.banner : null} uid={user.id} parallaxRef={bannerRef}>
        <button onClick={() => navigate(-1)} className="absolute left-3.5 w-[34px] h-[34px] flex items-center justify-center rounded-lg text-white active:scale-95"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 14px)', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}>
          <Icon name="arrow_back" size={16} />
        </button>
        <div className="absolute right-3.5 flex items-center gap-2" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}>
          <BannerBtn icon="share" label="Share" onClick={handleShare} />
          <div className="relative">
            <BannerBtn icon="more_vert" label="More" onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }} />
            {menuOpen && (
              <div className="absolute top-[calc(100%+6px)] right-0 min-w-[190px] rounded-2xl p-1.5 z-30"
                style={{ background: '#14141F', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                onClick={(e) => e.stopPropagation()}>
                <MenuItem icon="content_copy" label="Copy link" onClick={() => { setMenuOpen(false); handleShare(); }} />
                {!isMe && currentUser && <MenuItem icon="flag" label="Report" onClick={() => { setMenuOpen(false); setShowReport(true); }} />}
              </div>
            )}
          </div>
        </div>
      </Banner>

      {/* HEADER — relative z-10 so username/rank paint ABOVE the banner. */}
      <div className="px-5 relative z-10">
        <div className="flex items-end gap-4 -mt-11 mb-3">
          <div className="w-[88px] h-[88px] rounded-full flex items-center justify-center font-syne font-black text-[30px] relative shrink-0"
            style={{ background: 'linear-gradient(135deg,#7b1fff,#3b82f6)', border: `3px solid ${vpLevel?.ringColor || '#B44FFF'}`, boxShadow: `0 0 0 3px #0B0B14, 0 0 20px ${(vpLevel?.ringColor || '#B44FFF')}55` }}>
            <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center">
              {masked.avatar ? <CachedImg src={masked.avatar} permanent alt={displayName} className="w-full h-full object-cover" /> : initial}
            </div>
            {user?.id && !masked.isVanguardPersona && isUserLive(user.id) && (
              <>
                <span className="absolute -inset-[3px] rounded-full pointer-events-none" style={{ boxShadow: '0 0 0 3px #F04060, 0 0 22px #F0406088' }} />
                <button onClick={(e) => { e.stopPropagation(); const sid = liveStreamFor(user.id); if (sid) navigate(`/watch/${sid}`); }}
                  className="absolute -bottom-2 left-1/2 -translate-x-1/2 z-30 bg-brand-ember px-2 py-0.5 rounded text-[9px] font-bold text-white uppercase tracking-wider" style={{ whiteSpace: 'nowrap' }}>Live</button>
              </>
            )}
            {presenceVisible(user) && (
              <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full" style={{ background: userOnline ? '#22D17E' : '#555', border: '3px solid #0B0B14', boxShadow: userOnline ? '0 0 8px rgba(34,209,126,0.55)' : 'none' }} />
            )}
          </div>
          <div className="flex-1 pb-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap min-w-0">
              <span className="text-[22px] font-extrabold text-text-primary truncate">{displayName}</span>
              {!masked.isVanguardPersona && <NameAudioButton url={user.nameAudioUrl} />}
              {user.isVerified && <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: '#7B1FFF' }}><Icon name="check" size={11} className="text-white" /></div>}
              {!isBot && <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase shrink-0" style={{ background: 'rgba(123,31,255,0.20)', color: '#B44FFF', border: '1px solid rgba(180,79,255,0.30)' }}>{vpLevel?.name || 'Rookie'}</span>}
            </div>
            {!isMe && (
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <motion.button onClick={handleFollowToggle} disabled={toggling} whileTap={{ scale: 0.92 }} className="px-5 py-2 rounded-full font-bold text-[13px] shrink-0"
                  style={following ? { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: '#a0a0c0' } : { background: '#B44FFF', color: '#fff', boxShadow: '0 0 18px rgba(180,79,255,0.45)' }}>
                  {following ? 'Following' : 'Follow'}
                </motion.button>
                {!isBot && (
                  <>
                    <button onClick={handleMessage} className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-white" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }} title="Message"><Icon name="chat_bubble" size={16} /></button>
                    <button onClick={() => navigate('/wallet')} className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: 'rgba(245,197,66,0.12)', border: '1px solid rgba(245,197,66,0.25)' }} title="Tip"><CoinIcon size={16} /></button>
                  </>
                )}
              </div>
            )}
            {isMe && <button onClick={() => navigate('/edit-profile')} className="px-4 py-2 rounded-lg font-bold text-[12px] mb-2" style={{ background: 'rgba(180,79,255,0.15)', color: '#B44FFF', border: '1px solid rgba(180,79,255,0.40)' }}>Edit Profile</button>}
            <div className="flex items-center gap-2 mb-1.5">
              <div className="text-[12px] text-text-muted">{handle}</div>
              {vanguardRank && <VanguardBadge rank={vanguardRank} size={16} title={`${rankMeta(vanguardRank).label} — Vergr Vanguard`} />}
            </div>
          </div>
        </div>
        {masked.isVanguardPersona ? (
          <p className="text-[13px] text-text-secondary leading-relaxed mb-2">{rankMeta(vanguardRank).blurb}</p>
        ) : (user.bio && <p className="text-[13px] text-text-secondary leading-relaxed mb-2 whitespace-pre-line">{user.bio}</p>)}
        {!masked.isVanguardPersona && (
          <div className="flex items-center gap-2.5 flex-wrap mb-1">
            {socialsToList(user.socials, user.socialEnabled).slice(0, 5).map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noreferrer" className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted active:text-white" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}><Icon name={socialIcon(s.platform)} size={13} /></a>
            ))}
            {joined && <span className="flex items-center gap-1 text-[11px] text-text-muted"><Icon name="event" size={12} /> Joined {joined}</span>}
          </div>
        )}
        {!masked.isVanguardPersona && !isMe && (
          <div className="mt-3"><MembershipBlock creatorId={user.id} creatorName={displayName} /></div>
        )}
      </div>

      {/* STATS */}
      <div className="px-5 py-3 border-b" style={{ borderColor: '#1E1E2E' }}>
        <div className="grid grid-cols-3">
          <StatCell label="Followers" value={formatCount(followerCount)} onClick={() => navigate(`/connections/${user.id}/followers`)} />
          <StatCell label="Following" value={formatCount(followingCount)} onClick={() => navigate(`/connections/${user.id}/following`)} />
          <StatCell label="Likes" value={formatCount(user?.totalLikes || 0)} />
        </div>
        {!isBot && <VPCard vp={userVP} vpLevel={vpLevel} vpProgress={vpProgress} vpNext={vpNext} vpToNext={vpToNext} onClick={() => navigate('/prestige')} />}
      </div>

      {masked.isVanguardPersona ? (
        <div className="px-5 py-12 text-center text-text-muted">
          <img src={rankMeta(vanguardRank).avatar} alt="" className="w-20 h-20 mx-auto rounded-2xl mb-4" style={{ objectFit: 'cover' }} />
          <p className="text-[14px] font-semibold text-text-secondary mb-1">Vergr Vanguard · {rankMeta(vanguardRank).label}</p>
          <p className="text-[12px] max-w-md mx-auto leading-relaxed">Vanguard members are anonymous moderators. Their identity is private to protect them from retaliation.</p>
        </div>
      ) : (
        <>
          {user.streamSchedule && (
            <div className="px-4 pb-3">
              <StreamScheduleCard schedule={user.streamSchedule} />
            </div>
          )}
          <Tabs tabs={PUBLIC_TABS} active={activeTab} onSelect={setActiveTab} />
          <div className="pt-1">
            {activeTab === 'Posts' && pinnedPosts.length > 0 && (
              <div className="px-4 pt-2">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-2">
                  <Icon name="push_pin" size={13} style={{ color: '#B44FFF' }} /> Pinned
                </p>
              </div>
            )}
            {activeTab === 'Posts' && pinnedPosts.length > 0 && (
              <PostsColumn posts={pinnedPosts.map(p => ({ ...p, author: user }))} emptyLabel="" />
            )}
            {(filteredPosts.length > 0 || !(activeTab === 'Posts' && pinnedPosts.length > 0)) && (
              <PostsColumn posts={filteredPosts} emptyLabel={`No ${activeTab.toLowerCase()} yet`} />
            )}
          </div>
        </>
      )}
      <ReportSheet open={showReport} title="Report User" onClose={() => setShowReport(false)}
        onSubmit={(reason) => {
          setShowReport(false);
          reportUser(currentUser.uid, user.id, reason)
            .then(() => showToast('Report submitted — our moderators will review it', 'success'))
            .catch(() => showToast('Could not submit report', 'error'));
        }} />
    </div>
  );
}
