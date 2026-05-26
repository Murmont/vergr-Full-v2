// Public profile — mirrors ProfileScreen (owner) design with read-only actions.
// Banner + avatar header + stats/VP/badges (same container) + tabs + posts.
// Right panel shows public stats / top clips / squads (no analytics, no edit).

import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import {
  getUserById, getUserByUsername, getUserPosts,
  followUser, unfollowUser, isFollowing as checkFollowing,
  createConversation, getWallet, getFollowers, getFollowing,
} from '../../firebase/firestore';
import { getVPLevel, getVPProgress, getNextVPLevel } from '../../utils/vpSystem';
import { trackEvent } from '../../utils/trackEvent';
import BadgesShowcase from '../../components/BadgesShowcase';
import TwitchMirrorPlayer from '../../components/streams/TwitchMirrorPlayer';
import PostCard from '../../components/PostCard';
import Icon from '../../components/Icon';
import { CoinIcon, VPIcon } from '../../components/CoinIcon';

const PROFILE_TABS = ['Posts', 'Media', 'Clips', 'Likes'];

export default function PublicProfileScreen() {
  const { id } = useParams();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { setRightPanel, setContentAlign } = useLayout();

  const [user, setUser] = useState(null);
  const [userVP, setUserVP] = useState(0);
  const [posts, setPosts] = useState([]);
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Posts');
  const [toggling, setToggling] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoading(true);
      try {
        let u = await getUserById(id);
        if (!u) u = await getUserByUsername(id);
        if (u) {
          setUser(u);
          if (currentUser?.uid && u.id !== currentUser.uid) {
            trackEvent('profile_visit', { authorId: u.id, target: 'user' });
          }
          const [userPosts, isFollow, walletData, followers, followingList] = await Promise.all([
            getUserPosts(u.id, 30),
            currentUser ? checkFollowing(currentUser.uid, u.id) : false,
            getWallet(u.id).catch(() => ({ vp: 0 })),
            getFollowers(u.id).catch(() => []),
            getFollowing(u.id).catch(() => []),
          ]);
          setPosts(userPosts || []);
          setFollowing(!!isFollow);
          setUserVP(walletData?.vp || 0);
          setFollowerCount((followers?.length) ?? u.followerCount ?? 0);
          setFollowingCount((followingList?.length) ?? u.followingCount ?? 0);
        }
      } catch (err) {
        console.error('Error loading profile:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, currentUser]);

  const isMe = currentUser?.uid === user?.id;
  const isBot = user?.accountType === 'news_bot';
  const vpLevel = getVPLevel(userVP);
  const vpProgress = getVPProgress(userVP);
  const vpNext = getNextVPLevel(userVP);
  const vpToNext = vpNext ? Math.max(0, vpNext.vpRequired - userVP) : 0;

  // Right panel — public version
  useEffect(() => {
    if (!user) { setRightPanel(null); return; }
    setRightPanel(<PublicRightPanel user={user} posts={posts} navigate={navigate} />);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, user, posts, navigate]);

  // Close 3-dot menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  const handleFollowToggle = async () => {
    if (!currentUser || !user || toggling) return;
    setToggling(true);
    const wasFollowing = following;
    setFollowing(!wasFollowing);
    setFollowerCount(c => c + (wasFollowing ? -1 : 1));
    try {
      if (wasFollowing) await unfollowUser(currentUser.uid, user.id);
      else {
        await followUser(currentUser.uid, user.id);
        trackEvent('creator_follow', { authorId: user.id });
      }
    } catch {
      setFollowing(wasFollowing);
      setFollowerCount(c => c - (wasFollowing ? -1 : 1));
      showToast('Failed to update follow status', 'error');
    }
    setToggling(false);
  };

  const handleMessage = async () => {
    if (!currentUser || !user) return;
    try {
      const convoId = await createConversation(currentUser.uid, user);
      navigate(`/messages/${convoId}`);
    } catch { showToast('Failed to start conversation', 'error'); }
  };

  const handleShare = () => {
    const url = window.location.href;
    if (navigator.share) navigator.share({ title: user?.displayName || user?.username, url });
    else {
      navigator.clipboard?.writeText(url).then(() => showToast?.('Profile link copied', 'success'));
    }
  };

  const filteredPosts = useMemo(() => {
    if (!user) return [];
    const decorated = posts.map(p => ({ ...p, author: user }));
    if (activeTab === 'Posts') return decorated;
    if (activeTab === 'Media') return decorated.filter(p => p.imageUrl || p.videoUrl);
    if (activeTab === 'Clips') return decorated.filter(p => p.type === 'clip');
    if (activeTab === 'Likes') return []; // Liked posts are private
    return decorated;
  }, [activeTab, posts, user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-surface-3 border-t-brand-cyan rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
        <Icon name="person_off" size={48} className="text-text-muted/30 mb-3" />
        <p className="text-text-muted text-sm">User not found</p>
      </div>
    );
  }

  const displayName = user.displayName || user.username || 'User';
  const handle = user.username ? `@${user.username}` : '';
  const initial = (displayName[0] || 'V').toUpperCase();
  const joined = user.createdAt
    ? new Date(user.createdAt.toDate ? user.createdAt.toDate() : user.createdAt)
        .toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
    : '';

  return (
    <div className="pb-10" style={{ background: '#0B0B14' }}>
      {/* BANNER */}
      <div className="relative h-[220px] overflow-hidden">
        <div className="absolute inset-0"
             style={{ background: 'linear-gradient(135deg,#0d0820 0%,#1a0a3a 30%,#2d0a5a 60%,#1a0a30 100%)' }}>
          <div className="absolute inset-0"
               style={{ background: 'radial-gradient(ellipse at 70% 50%,rgba(123,31,255,0.4) 0%,transparent 65%), radial-gradient(ellipse at 90% 30%,rgba(61,127,255,0.2) 0%,transparent 50%)' }} />
        </div>
        {user.banner && (
          <img src={user.banner} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}
        <span
          className="absolute right-5 bottom-4 font-syne font-black tracking-widest uppercase select-none pointer-events-none leading-none"
          style={{ fontSize: 64, color: 'rgba(255,255,255,0.05)' }}
        >
          {(user.username || 'VERGR').toUpperCase()}
        </span>

        {/* Back button (top-left) */}
        <button
          onClick={() => navigate(-1)}
          className="absolute top-3.5 left-3.5 w-[34px] h-[34px] flex items-center justify-center rounded-lg text-white"
          style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}
        >
          <Icon name="arrow_back" size={16} />
        </button>

        {/* Top-right actions */}
        <div className="absolute top-3.5 right-3.5 flex items-center gap-2">
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold text-white transition-colors hover:brightness-125"
            style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}
          >
            <Icon name="share" size={13} /> Share
          </button>
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}
              className="w-[34px] h-[34px] flex items-center justify-center rounded-lg text-white"
              style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}
            >
              <Icon name="more_vert" size={16} />
            </button>
            {menuOpen && (
              <div
                className="absolute top-[calc(100%+6px)] right-0 min-w-[180px] rounded-[10px] p-1.5 z-30"
                style={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownItem icon="share" label="Copy link" onClick={() => { setMenuOpen(false); handleShare(); }} />
                {!isMe && <DropdownItem icon="block" label="Block user" onClick={() => { setMenuOpen(false); showToast('Block — coming soon', 'info'); }} />}
                {!isMe && <DropdownItem icon="flag" label="Report" onClick={() => { setMenuOpen(false); showToast('Report — coming soon', 'info'); }} />}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PROFILE HEADER */}
      <div className="px-5">
        <div className="flex items-end gap-4 -mt-11 mb-3">
          <div
            className="w-[88px] h-[88px] rounded-full flex items-center justify-center font-syne font-black text-[30px] relative shrink-0 overflow-hidden"
            style={{
              background: 'linear-gradient(135deg,#7b1fff,#3b82f6)',
              border: `3px solid ${vpLevel?.ringColor || '#B44FFF'}`,
              boxShadow: `0 0 0 3px #0B0B14, 0 0 20px ${(vpLevel?.ringColor || '#B44FFF')}55`,
            }}
          >
            {user.avatar
              ? <img src={user.avatar} alt={displayName} className="w-full h-full object-cover" />
              : initial}
          </div>
          <div className="flex-1 pb-1 min-w-0">
            <div className="flex items-center justify-between gap-3 mb-0.5 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[22px] font-extrabold text-text-primary truncate">{displayName}</span>
                {user.isVerified && (
                  <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: '#7B1FFF' }}>
                    <Icon name="check" size={11} className="text-white" />
                  </div>
                )}
                {!isBot && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase shrink-0"
                        style={{ background: 'rgba(123,31,255,0.20)', color: '#B44FFF', border: '1px solid rgba(180,79,255,0.30)' }}>
                    {vpLevel?.name || 'Rookie'}
                  </span>
                )}
              </div>

              {/* ACTION BUTTONS — read-only */}
              {!isMe && !isBot && (
                <div className="flex gap-2">
                  <button onClick={handleMessage}
                          className="w-10 h-10 rounded-full flex items-center justify-center hover:brightness-125 transition-all"
                          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}
                          title="Message">
                    <Icon name="chat_bubble" size={16} />
                  </button>
                  <button onClick={() => navigate('/wallet')}
                          className="w-10 h-10 rounded-full flex items-center justify-center hover:brightness-125 transition-all"
                          style={{ background: 'rgba(245,197,66,0.12)', border: '1px solid rgba(245,197,66,0.25)' }}
                          title="Tip">
                    <CoinIcon size={16} />
                  </button>
                  <motion.button
                    onClick={handleFollowToggle}
                    disabled={toggling}
                    whileTap={{ scale: 0.92 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                    className="px-5 py-2 rounded-full font-bold text-[13px] transition-colors"
                    style={following
                      ? { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: '#a0a0c0' }
                      : { background: '#B44FFF', color: '#fff', boxShadow: '0 0 18px rgba(180,79,255,0.45)' }}
                  >
                    {following ? 'Following' : 'Follow'}
                  </motion.button>
                </div>
              )}
              {isMe && (
                <button
                  onClick={() => navigate('/edit-profile')}
                  className="px-4 py-2 rounded-lg font-bold text-[12px]"
                  style={{ background: 'rgba(180,79,255,0.15)', color: '#B44FFF', border: '1px solid rgba(180,79,255,0.40)' }}
                >
                  Edit Profile
                </button>
              )}
            </div>
            <div className="text-[12px] text-text-muted mb-1.5">{handle}</div>
            {user.bio && (
              <p className="text-[13px] text-text-secondary leading-relaxed mb-2 max-w-[500px] whitespace-pre-line">
                {user.bio}
              </p>
            )}
            <div className="flex items-center gap-2.5 flex-wrap">
              {socialsToList(user.socials, user.socialEnabled).slice(0, 5).map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noreferrer"
                   className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-white hover:bg-purple-700/20 transition-colors"
                   style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <Icon name={socialIcon(s.platform)} size={13} />
                </a>
              ))}
              {joined && (
                <span className="flex items-center gap-1 text-[11px] text-text-muted">
                  <Icon name="event" size={12} /> Joined {joined}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* STATS BAR — Followers · Following · VP+badges combined */}
      <div className="flex items-center gap-0 px-5 py-2.5 border-b" style={{ borderColor: '#1E1E2E' }}>
        <Stat icon="person" label="Followers" value={formatCount(followerCount)} onClick={() => navigate(`/profile/followers/${user.id}`)} />
        <div className="border-r mr-6 self-stretch" style={{ borderColor: '#1E1E2E' }} />
        <Stat icon="group" label="Following" value={formatCount(followingCount)} onClick={() => navigate(`/profile/following/${user.id}`)} />
        <div className="border-r mr-6 self-stretch" style={{ borderColor: '#1E1E2E' }} />

        {!isBot && (
          <button
            onClick={() => navigate('/prestige')}
            className="flex-1 flex items-center gap-3 p-3 rounded-xl text-left hover:brightness-110 transition-all"
            style={{ background: 'rgba(123,31,255,0.08)', border: '1px solid rgba(180,79,255,0.20)' }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-bold tracking-widest uppercase" style={{ color: '#B44FFF' }}>Vergr Points</p>
              <p className="text-[18px] font-black text-text-primary leading-none mt-0.5">
                {userVP.toLocaleString()} <span className="text-[13px]" style={{ color: '#B44FFF' }}>VP</span>
              </p>
              <div className="h-[3px] rounded mt-1.5" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <div className="h-full rounded" style={{ width: `${Math.min(100, (vpProgress || 0) * 100)}%`, background: 'linear-gradient(90deg,#7B1FFF,#B44FFF)' }} />
              </div>
              <p className="text-[10px] text-text-muted mt-1">
                {vpNext ? `${vpToNext.toLocaleString()} VP to Lvl ${vpNext.level}` : 'Max level reached'}
              </p>
            </div>
            {/* VP icon + inline badges — same container as VP */}
            <div className="flex items-center gap-3 shrink-0">
              <VPIcon size={36} className="drop-shadow-[0_0_12px_rgba(180,79,255,0.5)]" />
              <div className="flex flex-col items-end gap-1">
                <BadgesShowcase level={vpLevel?.level || 1} size={32} />
                <p className="text-[9px] text-text-muted leading-none">{vpLevel?.name || 'Rookie'}</p>
              </div>
            </div>
          </button>
        )}
      </div>

      {/* TABS */}
      <div className="flex items-center justify-between px-5 border-b" style={{ borderColor: '#1E1E2E' }}>
        <div className="flex">
          {PROFILE_TABS.map(t => (
            <button key={t}
              onClick={() => setActiveTab(t)}
              className="px-4 py-3 text-[13px] font-semibold transition-colors"
              style={activeTab === t
                ? { color: '#fff', borderBottom: '2px solid #B44FFF' }
                : { color: '#6B7280', borderBottom: '2px solid transparent' }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* POSTS GRID */}
      <div className="px-5 py-4">
        {activeTab === 'Likes' ? (
          <div className="text-center py-16">
            <Icon name="favorite_border" size={48} className="text-text-muted/20 mx-auto mb-3" />
            <p className="text-text-muted text-sm">Liked posts are private</p>
          </div>
        ) : filteredPosts.length === 0 ? (
          <div className="text-center py-16">
            <Icon name="inbox" size={48} className="text-text-muted/20 mx-auto mb-3" />
            <p className="text-text-muted text-sm">No {activeTab.toLowerCase()} yet</p>
          </div>
        ) : (
          <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {filteredPosts.map(p => <PostCard key={p.id} post={p} compact />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function DropdownItem({ icon, label, onClick }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[13px] text-text-muted hover:text-white hover:bg-purple-700/15 transition-colors text-left">
      <Icon name={icon} size={14} /> {label}
    </button>
  );
}

function Stat({ icon, label, value, onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2.5 pr-6 transition-colors hover:brightness-125">
      <div className="w-[34px] h-[34px] rounded-lg flex items-center justify-center"
           style={{ background: 'rgba(123,31,255,0.15)', border: '1px solid rgba(180,79,255,0.25)', color: '#B44FFF' }}>
        <Icon name={icon} size={16} />
      </div>
      <div className="text-left">
        <div className="text-[16px] font-extrabold text-text-primary leading-none">{value}</div>
        <div className="text-[10px] text-text-muted mt-0.5">{label}</div>
      </div>
    </button>
  );
}

function formatCount(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
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

// ─── Right rail ────────────────────────────────────────────────────

function PublicRightPanel({ user, posts, navigate }) {
  const totalLikes = posts.reduce((s, p) => s + (p.likeCount || 0), 0);
  const totalViews = posts.reduce((s, p) => s + (p.viewCount || 0), 0);
  const totalClips = posts.filter(p => p.type === 'clip').length;
  const topClips = [...posts].filter(p => p.type === 'clip')
                     .sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0))
                     .slice(0, 3);
  // Twitch handle pulled from linkedAccounts. Stored as either a string
  // (legacy manual flow) or an object { username } from the OAuth flow.
  const twitchRaw = user?.linkedAccounts?.twitch;
  const twitchUser = typeof twitchRaw === 'string' ? twitchRaw : twitchRaw?.username;
  return (
    <div className="w-full px-3 py-4 space-y-4">
      {twitchUser && (
        <div className="rounded-xl p-3" style={{ background: '#14141F', border: '1px solid #1E1E2E' }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[13px] font-bold text-text-primary">Twitch</p>
            <a href={`https://twitch.tv/${twitchUser}`} target="_blank" rel="noreferrer"
               className="text-[10px] font-bold text-[#9146FF]">Open on Twitch ↗</a>
          </div>
          <TwitchMirrorPlayer username={twitchUser} />
        </div>
      )}

      {/* Stats */}
      <div className="rounded-xl p-3" style={{ background: '#14141F', border: '1px solid #1E1E2E' }}>
        <p className="text-[13px] font-bold text-text-primary mb-2.5">Profile Overview</p>
        <div className="grid grid-cols-2 gap-2">
          <OvCard icon="visibility" label="Total Views" value={totalViews.toLocaleString()} />
          <OvCard icon="movie"      label="Total Clips" value={totalClips.toLocaleString()} />
          <OvCard icon="favorite"   label="Total Likes" value={totalLikes.toLocaleString()} />
          <OvCard icon="forum"      label="Posts"       value={(user.postCount || posts.length).toLocaleString()} />
        </div>
      </div>

      {/* Top Clips */}
      <div className="rounded-xl p-3" style={{ background: '#14141F', border: '1px solid #1E1E2E' }}>
        <p className="text-[13px] font-bold text-text-primary mb-2">Top Clips</p>
        {topClips.length === 0 ? (
          <p className="text-[11px] text-text-muted">No clips yet</p>
        ) : (
          topClips.map(c => (
            <button key={c.id}
              onClick={() => navigate(`/post/${c.id}`)}
              className="flex items-center gap-2 py-2 w-full text-left border-b last:border-0"
              style={{ borderColor: '#1E1E2E' }}>
              <div className="w-[52px] h-[34px] rounded-md shrink-0 overflow-hidden"
                   style={{ background: 'linear-gradient(135deg,#1a0a2e,#0a1a3e)' }}>
                {c.imageUrl && <img src={c.imageUrl} alt="" className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-text-primary truncate">{c.text || c.title || 'Clip'}</p>
                <p className="text-[10px] text-text-muted">♥ {(c.likeCount || 0).toLocaleString()}</p>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Squads */}
      <div className="rounded-xl p-3" style={{ background: '#14141F', border: '1px solid #1E1E2E' }}>
        <p className="text-[13px] font-bold text-text-primary mb-2">Squads</p>
        <p className="text-[11px] text-text-muted">Public squads coming soon</p>
      </div>
    </div>
  );
}

function OvCard({ icon, label, value }) {
  return (
    <div className="rounded-[10px] p-2.5" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center gap-1 text-[10px] text-text-muted mb-1">
        <Icon name={icon} size={11} /> {label}
      </div>
      <div className="text-[15px] font-extrabold text-text-primary">{value}</div>
    </div>
  );
}
