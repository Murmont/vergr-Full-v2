// Owner Profile screen — what you see when you visit /profile (your own).
// Layout matches the Claude Design "Owner Profile" mock:
//   - Banner with username text + 3-dot menu
//   - Avatar header with verified + rank badge + bio + socials
//   - Stats bar: Followers, Following, VP Points (with progress)
//   - Tabs: Posts / Media / Clips / Likes / Bookmarks
//   - Right panel: Profile Overview, Top Clips, Achievements, Squads
//
// All data is read from existing context/hooks (UserContext, AuthContext).
// The right panel is set via useLayout so it docks into the existing chrome.

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { getUserPosts, getBookmarks, getFollowers, getFollowing } from '../../firebase/firestore';
import { getVPLevel, getVPProgress, getNextVPLevel } from '../../utils/vpSystem';
import BadgesShowcase from '../../components/BadgesShowcase';
import TwitchMirrorPlayer from '../../components/streams/TwitchMirrorPlayer';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import PostCard from '../../components/PostCard';
import { VPIcon } from '../../components/CoinIcon';

const PROFILE_TABS = ['Posts', 'Media', 'Clips', 'Likes', 'Bookmarks'];

export default function ProfileScreen() {
  const { currentUser } = useAuth();
  const { profile, wallet } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { isMobile } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  const [activeTab, setActiveTab] = useState('Posts');
  const [posts, setPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [bookmarks, setBookmarks] = useState([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  const vp = wallet?.vp || 0;
  const vpLevel = getVPLevel?.(vp);
  const vpProgress = getVPProgress?.(vp) ?? 0;
  const vpNext = getNextVPLevel?.(vp);
  const vpToNext = vpNext ? Math.max(0, vpNext.vpRequired - vp) : 0;

  // Right panel
  useEffect(() => {
    setRightPanel(<OwnerRightPanel posts={posts} navigate={navigate} profile={profile} />);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, posts, navigate, profile]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    setLoadingPosts(true);
    getUserPosts(currentUser.uid, 30)
      .then(setPosts)
      .catch(console.error)
      .finally(() => setLoadingPosts(false));
    getFollowers(currentUser.uid).then(r => setFollowerCount(r?.length || 0)).catch(() => {});
    getFollowing(currentUser.uid).then(r => setFollowingCount(r?.length || 0)).catch(() => {});
    getBookmarks(currentUser.uid).then(setBookmarks).catch(() => {});
  }, [currentUser?.uid]);

  // Close 3-dot menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuOpen]);

  const filteredPosts = useMemo(() => {
    if (activeTab === 'Posts') return posts;
    if (activeTab === 'Media') return posts.filter(p => p.imageUrl || p.videoUrl);
    if (activeTab === 'Clips') return posts.filter(p => p.type === 'clip');
    if (activeTab === 'Likes') return posts.filter(p => p.likedByMe);
    if (activeTab === 'Bookmarks') return bookmarks;
    return posts;
  }, [activeTab, posts, bookmarks]);

  const displayName = profile?.displayName || profile?.username || 'You';
  const handle = profile?.username ? `@${profile.username}` : '';
  const initial = (displayName[0] || 'V').toUpperCase();
  const joined = profile?.createdAt
    ? new Date(profile.createdAt.toDate ? profile.createdAt.toDate() : profile.createdAt)
        .toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
    : '';

  return (
    <div className="pb-10" style={{ background: '#0B0B14' }}>
      {/* BANNER */}
      <div className="relative h-[220px] overflow-hidden">
        <div className="absolute inset-0"
             style={{
               background: 'linear-gradient(135deg,#0d0820 0%,#1a0a3a 30%,#2d0a5a 60%,#1a0a30 100%)',
             }}>
          <div className="absolute inset-0"
               style={{
                 background: 'radial-gradient(ellipse at 70% 50%,rgba(123,31,255,0.4) 0%,transparent 65%), radial-gradient(ellipse at 90% 30%,rgba(61,127,255,0.2) 0%,transparent 50%)',
               }} />
        </div>
        {/* Username faded watermark */}
        <span
          className="absolute right-5 bottom-4 font-syne font-black tracking-widest uppercase select-none pointer-events-none leading-none"
          style={{ fontSize: 64, color: 'rgba(255,255,255,0.05)' }}
        >
          {(profile?.username || 'VERGR').toUpperCase()}
        </span>

        {/* Top-right actions */}
        <div className="absolute top-3.5 right-3.5 flex items-center gap-2">
          <button
            onClick={() => {
              if (navigator.share) navigator.share({ title: displayName, url: window.location.href });
              else navigator.clipboard?.writeText(window.location.href).then(() => showToast?.('Profile link copied', 'success'));
            }}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold text-white transition-colors hover:brightness-125"
            style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}
          >
            <Icon name="share" size={13} /> Share Profile
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
                <DropdownItem icon="edit" label="Edit Profile" onClick={() => { setMenuOpen(false); navigate('/edit-profile'); }} />
                <DropdownItem icon="share" label="Share Profile" onClick={() => { setMenuOpen(false); navigator.clipboard?.writeText(window.location.href); showToast?.('Link copied', 'success'); }} />
                <div className="h-px my-1" style={{ background: '#1E1E2E' }} />
                <DropdownItem icon="analytics" label="View Analytics" onClick={() => { setMenuOpen(false); navigate('/creator/dashboard'); }} />
                <DropdownItem icon="history" label="Activity Log" onClick={() => { setMenuOpen(false); navigate('/transactions/filter'); }} />
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
              border: '3px solid #B44FFF',
              boxShadow: '0 0 0 3px #0B0B14, 0 0 20px rgba(180,79,255,0.5)',
            }}
          >
            {profile?.avatar
              ? <img src={profile.avatar} alt={displayName} className="w-full h-full object-cover" />
              : initial}
            <span className="absolute bottom-1 right-1 w-3.5 h-3.5 rounded-full border-2"
                  style={{ background: '#22D17E', borderColor: '#0B0B14' }} />
          </div>
          <div className="flex-1 pb-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[22px] font-extrabold text-text-primary">{displayName}</span>
              {profile?.verified && (
                <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: '#7B1FFF' }}>
                  <Icon name="check" size={11} className="text-white" />
                </div>
              )}
              <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase"
                    style={{ background: 'rgba(123,31,255,0.20)', color: '#B44FFF', border: '1px solid rgba(180,79,255,0.30)' }}>
                {vpLevel?.name || 'Rookie'}
              </span>
            </div>
            <div className="text-[12px] text-text-muted mb-1.5">{handle}</div>
            {profile?.bio && (
              <p className="text-[13px] text-text-secondary leading-relaxed mb-2 max-w-[500px] whitespace-pre-line">
                {profile.bio}
              </p>
            )}
            <div className="flex items-center gap-2.5">
              {socialsToList(profile?.socials, profile?.socialEnabled).slice(0, 5).map((s, i) => (
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

      {/* STATS BAR */}
      <div className="flex items-center gap-0 px-5 py-2.5 border-b" style={{ borderColor: '#1E1E2E' }}>
        <Stat icon="person" label="Followers" value={followerCount.toLocaleString()} onClick={() => navigate('/profile/followers')} />
        <div className="border-r mr-6 self-stretch" style={{ borderColor: '#1E1E2E' }} />
        <Stat icon="group" label="Following" value={followingCount.toLocaleString()} onClick={() => navigate('/profile/following')} />
        <div className="border-r mr-6 self-stretch" style={{ borderColor: '#1E1E2E' }} />
        <button
          onClick={() => navigate('/prestige')}
          className="flex-1 flex items-center gap-3 p-3 rounded-xl text-left hover:brightness-110 transition-all"
          style={{ background: 'rgba(123,31,255,0.08)', border: '1px solid rgba(180,79,255,0.20)' }}
        >
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-bold tracking-widest uppercase" style={{ color: '#B44FFF' }}>Vergr Points</p>
            <p className="text-[18px] font-black text-text-primary leading-none mt-0.5">
              {vp.toLocaleString()} <span className="text-[13px]" style={{ color: '#B44FFF' }}>VP</span>
            </p>
            <div className="h-[3px] rounded mt-1.5" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div className="h-full rounded" style={{ width: `${Math.min(100, vpProgress * 100)}%`, background: 'linear-gradient(90deg,#7B1FFF,#B44FFF)' }} />
            </div>
            <p className="text-[10px] text-text-muted mt-1">
              {vpNext ? `${vpToNext.toLocaleString()} VP to Lvl ${vpNext.level}` : 'Max level reached'}
            </p>
          </div>
          {/* VP icon + inline badge trio — same container as VP bar */}
          <div className="flex items-center gap-3 shrink-0">
            <VPIcon size={36} className="drop-shadow-[0_0_12px_rgba(180,79,255,0.5)]" />
            <div className="flex flex-col items-end gap-1">
              <BadgesShowcase level={vpLevel?.level || 1} size={32} />
              <p className="text-[9px] text-text-muted leading-none">{vpLevel?.name || 'Rookie'}</p>
            </div>
          </div>
        </button>
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
        <div className="flex items-center gap-2.5">
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold text-text-muted hover:text-white"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #1E1E2E' }}>
            Latest <Icon name="expand_more" size={12} />
          </button>
        </div>
      </div>

      {/* POSTS GRID */}
      <div className="px-5 py-4">
        {loadingPosts ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-surface-3 border-t-brand-cyan rounded-full animate-spin" /></div>
        ) : filteredPosts.length === 0 ? (
          <div className="text-center py-16">
            <Icon name="inbox" size={48} className="text-text-muted/20 mx-auto mb-3" />
            <p className="text-text-muted">No {activeTab.toLowerCase()} yet</p>
            {activeTab === 'Posts' && (
              <button onClick={() => navigate('/create')}
                      className="mt-4 px-5 py-2 rounded-lg text-[13px] font-bold"
                      style={{ background: 'rgba(180,79,255,0.15)', color: '#B44FFF', border: '1px solid rgba(180,79,255,0.40)' }}>
                Create your first post
              </button>
            )}
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

// EditProfileScreen stores socials as a map ({ twitter: 'url', ... }) but
// older accounts may have an array. Normalise here so the renderer can
// just .map() across the result without runtime checks.
function socialsToList(socials, enabled = {}) {
  if (!socials) return [];
  if (Array.isArray(socials)) {
    return socials.filter(s => s && s.url);
  }
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

function OwnerRightPanel({ posts, navigate, profile }) {
  const totalLikes  = posts.reduce((s, p) => s + (p.likeCount || 0), 0);
  const totalClips  = posts.filter(p => p.type === 'clip').length;
  const topClips    = [...posts].filter(p => p.type === 'clip')
                        .sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0))
                        .slice(0, 3);
  const twitchRaw = profile?.linkedAccounts?.twitch;
  const twitchUser = typeof twitchRaw === 'string' ? twitchRaw : twitchRaw?.username;
  return (
    <div className="w-full px-3 py-4 space-y-4">
      {twitchUser && (
        <div className="rounded-xl p-3" style={{ background: '#14141F', border: '1px solid #1E1E2E' }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[13px] font-bold text-text-primary">Your Twitch</p>
            <a href={`https://twitch.tv/${twitchUser}`} target="_blank" rel="noreferrer"
               className="text-[10px] font-bold" style={{ color: '#9146FF' }}>Open ↗</a>
          </div>
          <TwitchMirrorPlayer username={twitchUser} />
        </div>
      )}

      {/* Profile Overview */}
      <div className="rounded-xl p-3" style={{ background: '#14141F', border: '1px solid #1E1E2E' }}>
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-[13px] font-bold text-text-primary">Profile Overview</p>
          <button onClick={() => navigate('/creator/dashboard')} className="text-[11px] font-semibold" style={{ color: '#B44FFF' }}>
            View Analytics
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <OvCard icon="visibility"        label="Total Views" value={posts.reduce((s, p) => s + (p.viewCount || 0), 0).toLocaleString()} />
          <OvCard icon="movie"             label="Total Clips" value={totalClips.toLocaleString()} />
          <OvCard icon="cell_tower"        label="Streams"     value={String(0)} />
          <OvCard icon="favorite"          label="Total Likes" value={totalLikes.toLocaleString()} />
        </div>
      </div>

      {/* Top Clips */}
      <div className="rounded-xl p-3" style={{ background: '#14141F', border: '1px solid #1E1E2E' }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[13px] font-bold text-text-primary">Top Clips</p>
          <button onClick={() => {}} className="text-[11px] font-semibold" style={{ color: '#B44FFF' }}>View All</button>
        </div>
        {topClips.length === 0 ? (
          <p className="text-[11px] text-text-muted">No clips yet</p>
        ) : (
          topClips.map(c => (
            <button key={c.id} className="flex items-center gap-2 py-2 w-full text-left border-b last:border-0" style={{ borderColor: '#1E1E2E' }}>
              <div className="w-[52px] h-[34px] rounded-md shrink-0"
                   style={{ background: 'linear-gradient(135deg,#1a0a2e,#0a1a3e)' }} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-text-primary truncate">{c.text || 'Clip'}</p>
                <p className="text-[10px] text-text-muted">♥ {(c.likeCount || 0).toLocaleString()}</p>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Achievements */}
      <div className="rounded-xl p-3" style={{ background: '#14141F', border: '1px solid #1E1E2E' }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[13px] font-bold text-text-primary">Achievements</p>
          <button onClick={() => navigate('/profile/achievements')} className="text-[11px] font-semibold" style={{ color: '#B44FFF' }}>View All</button>
        </div>
        <p className="text-[11px] text-text-muted">Coming soon</p>
      </div>

      {/* Squads */}
      <div className="rounded-xl p-3" style={{ background: '#14141F', border: '1px solid #1E1E2E' }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[13px] font-bold text-text-primary">Your Squads</p>
          <button onClick={() => navigate('/squads')} className="text-[11px] font-semibold" style={{ color: '#B44FFF' }}>View All</button>
        </div>
        <p className="text-[11px] text-text-muted">No squads yet</p>
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
