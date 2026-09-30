// Public profile — mirrors ProfileScreen (owner) design with read-only actions.
// Banner + avatar header + stats/VP/badges (same container) + tabs + posts.
// Right panel shows public stats / top clips / squads (no analytics, no edit).

import { useState, useEffect, useMemo, useRef } from 'react';
import BoostSheet from '../../components/boost/BoostSheet';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { withRef } from '../../utils/shareRef';
import { vergrMeUrl } from '../../utils/vergrMeUrl';
import { ProfileSkeleton } from '../../components/skeletons/GlassSkeletons';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import {
  getUserById, getUserByUsername, getUserPosts, getPost, blockUser, reportUser,
  followUser, unfollowUser, isFollowing as checkFollowing,
  createConversation, getUserVP, countFollowers, countFollowing, getTaggedPosts,
} from '../../firebase/firestore';
import StreamScheduleCard from '../../components/profile/StreamScheduleCard';
import NameAudioButton from '../../components/profile/NameAudioButton';
import MyQrModal from '../../components/messages/MyQrModal';
import ReportSheet from '../../components/ReportSheet';
import useHeaderCollapse from '../../hooks/useHeaderCollapse';
import { bannerGradient, CountUpNumber, MiniDockHeader, ACCENT_CHIP, SOLID_CHIP, TIP_CHIP } from '../../components/profile/profilePolish';
import { accentFor } from '../../utils/rankUnlocks';

import { themeStyle, themeTokens, headerLightStyle } from '../../utils/profileThemes';
import { Ambilight, ProfileAudio, useEffectEnabled } from '../../components/effects';
import { avatarRing, RING } from '../../utils/avatarRing';
import { isShortFormat, sharesToFeed, isMediaPost } from '../../utils/helpers';
import { presenceVisible } from '../../utils/presence';
import useOnlineStatus from '../../hooks/useOnlineStatus';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import { isVanguard, applyVanguardMask, rankMeta } from '../../utils/vanguard';
import VanguardBadge from '../../components/VanguardBadge';
import PlanBadge from '../../components/PlanBadge';
import { useUser } from '../../context/UserContext';
import { useLiveUsers } from '../../context/LiveUsersContext';
import { getVPLevel, getVPProgress, getNextVPLevel } from '../../utils/vpSystem';
import { trackEvent } from '../../utils/trackEvent';
import BadgesShowcase from '../../components/BadgesShowcase';
import UserName from '../../components/UserName';
import RankBadge from '../../components/RankBadge';
import CachedImg from '../../components/CachedImg';
import ProfileBanner from '../../components/profile/ProfileBanner';
import MembershipBlock from '../../components/membership/MembershipBlock';
import TwitchMirrorPlayer from '../../components/streams/TwitchMirrorPlayer';
import { ProfilePostList, TopClipsList } from '../../components/profile/ProfileGrid';
import Icon from '../../components/Icon';
import SendCoinsModal from '../../components/SendCoinsModal';
import { CoinIcon, VPIcon } from '../../components/CoinIcon';
import { PRIVACY_DEFAULTS } from '../../utils/privacy';
import { socialsToList, socialIcon, socialLabel, openSocialLink } from '../../utils/profileSocials';
import LinkedHandles from '../../components/profile/LinkedHandles';

// Likes are private (IG model): the tab lives only on your OWN profile
// (ProfileScreen), never on someone else's.
/** The accent shown when a user has equipped none. ONE definition, so the
 *  fallback cannot drift between the tokens, the header and the components.
 *  ⚠ NOT the same thing as the STATUS ring colour further down: that one is
 *  deliberately accent-NEUTRAL and must not follow a user accent. */
const DEFAULT_ACCENT = '#B44FFF';

const PROFILE_TABS = ['Posts', 'Media', 'Clips', 'Tagged'];

export default function PublicProfileScreen() {
  const { id } = useParams();
  const { currentUser } = useAuth();
  const { isUserLive, liveStreamFor } = useLiveUsers();
  const { profile: viewer } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { setRightPanel, setContentAlign } = useLayout();

  const [user, setUser] = useState(null);
  // ⚠ MUST STAY ABOVE THE `if (loading) return <ProfileSkeleton/>` BELOW.
  // useEffectEnabled calls useMemo, so placing it further down (next to the
  // accent, where it reads better) made it CONDITIONAL: it did not run on the
  // loading pass and did on the loaded one, so the hook count changed and React
  // threw #310 "rendered more hooks than during the previous render". The whole
  // screen went to ErrorBoundary. Hooks run unconditionally or not at all.
  //
  // The OWNER's profile decides, not the viewer's — that contract is what makes
  // an unlock visible to other people (components/effects/README.md). The
  // Vanguard mask is applied at the USE site, because it is a plain boolean and
  // must not gate the hook.
  // Same rule as above: unconditional, above the early return. Both effects read
  // the VIEWED user's profile, never the viewer's.
  const ambilightOn = useEffectEnabled('ambilight', user);
  // Effect 09. Reads the VIEWED user's unlock, like the two above — it is the
  // owner's loop, played on the visitor's screen.
  const ambianceOn = useEffectEnabled('ambiance', user);
  const { isOnline: userOnline } = useOnlineStatus(user?.id);
  const [userVP, setUserVP] = useState(0);
  const [posts, setPosts] = useState([]);
  const [taggedPosts, setTaggedPosts] = useState([]);
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Posts');
  const [toggling, setToggling] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showBoost, setShowBoost] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [targetFollowsMe, setTargetFollowsMe] = useState(false);
  const { bannerRef, docked } = useHeaderCollapse();
  // Effect 16: the <video> banner, shared with Ambilight so the glow samples
  // the live clip instead of a still. Null for an image banner, which is
  // exactly what Ambilight falls back to.
  const bannerVideoRef = useRef(null);
  const [pinnedPosts, setPinnedPosts] = useState([]);

  // Pinned posts — fetched by id in array order (cap 3, set from PostCard's
  // own-post "Pin to profile"). Deleted posts silently drop out.
  useEffect(() => {
    const ids = (user?.pinnedPostIds || []).slice(0, 3);
    if (!ids.length) { setPinnedPosts([]); return; }
    let live = true;
    Promise.all(ids.map(pid => getPost(pid).catch(() => null)))
      .then(list => { if (live) setPinnedPosts(list.filter(Boolean)); });
    return () => { live = false; };
  }, [user?.pinnedPostIds]);

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
          // Counts are aggregation queries and "do they follow me" is one doc
          // read. This used to download EVERY follower and following doc of the
          // viewed account just to read .length, which is what made a big
          // profile (@vergr) slow to open (founder, 2026-09-11).
          const [userPosts, isFollow, vpData, followerN, followingN, tagged, followsMe] = await Promise.all([
            getUserPosts(u.id, 30),
            currentUser ? checkFollowing(currentUser.uid, u.id) : false,
            getUserVP(u.id).catch(() => ({ vp: 0 })),
            countFollowers(u.id).catch(() => null),
            countFollowing(u.id).catch(() => null),
            getTaggedPosts(u.id, 30).catch(() => []),
            currentUser?.uid && currentUser.uid !== u.id ? checkFollowing(u.id, currentUser.uid).catch(() => false) : false,
          ]);
          setPosts(userPosts || []);
          setTaggedPosts(tagged || []);
          setFollowing(!!isFollow);
          setUserVP(vpData?.vp || 0);
          setFollowerCount(followerN ?? u.followerCount ?? 0);
          setFollowingCount(followingN ?? u.followingCount ?? 0);
          // For privacy relationship checks: does the viewed user follow the viewer?
          setTargetFollowsMe(!!followsMe);
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
  const isBot = String(user?.accountType || '').includes('bot');
  const vpLevel = getVPLevel(userVP);
  const vpProgress = getVPProgress(userVP);
  const vpNext = getNextVPLevel(userVP);
  const vpToNext = vpNext ? Math.max(0, vpNext.vpRequired - userVP) : 0;
  // Real engagement totals from the loaded posts (user.totalLikes is often unset).
  const pLikes = useMemo(() => posts.reduce((s, p) => s + (p.likeCount || 0), 0), [posts]);

  // Right panel — public version
  useEffect(() => {
    if (!user) { setRightPanel(null); return; }
    // ⚠ A MASKED VANGUARD GETS NO RIGHT RAIL. It carried the real account's
    // Twitch player (linkedAccounts.twitch, i.e. the person's own handle), its
    // top clips and its totals: each one enough to match the persona to a person.
    const persona = applyVanguardMask(user, viewer)?.isVanguardPersona;
    setRightPanel(persona ? null : <PublicRightPanel user={user} posts={posts} loaded={!loading} navigate={navigate} onViewClips={() => setActiveTab('Clips')} />);
    setContentAlign('left');
    // Profile pages are black, shell included. Removing the class on unmount
    // restores #0B0B14 everywhere else, so this cannot leak into other routes.
    document.body.classList.add('vg-black-shell');
    return () => {
      setRightPanel(null); setContentAlign('center');
      document.body.classList.remove('vg-black-shell');
    };
  }, [setRightPanel, setContentAlign, user, viewer, posts, loading, navigate]);

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
    // Always share the public vergr.me page, never the in-app
    // tauri.localhost / hash URL. One helper owns the public URL shape
    // (matches the VergrMe editor's copy action).
    const handle = user?.username || user?.id;
    const url = withRef(vergrMeUrl(handle));
    if (navigator.share) navigator.share({ title: user?.displayName || user?.username, url }).catch(() => {});
    else {
      navigator.clipboard?.writeText(url).then(() => showToast?.('Profile link copied', 'success'));
    }
  };

  const filteredPosts = useMemo(() => {
    if (!user) return [];
    const decorated = posts.map(p => ({ ...p, author: user }));
    if (activeTab === 'Posts') return decorated.filter(sharesToFeed);
    if (activeTab === 'Media') return decorated.filter(isMediaPost);
    if (activeTab === 'Clips') return decorated.filter(p => isShortFormat(p.type));
    if (activeTab === 'Tagged') return taggedPosts; // authored by others — PostCard resolves each author itself
    return decorated;
  }, [activeTab, posts, taggedPosts, user]);

  if (loading) {
    return <ProfileSkeleton />;
  }
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
        <Icon name="person_off" size={48} className="text-text-muted/30 mb-3" />
        <p className="text-text-muted text-sm">User not found</p>
      </div>
    );
  }

  // Privacy → Profile visibility. Admins/self bypass; otherwise "Only me" hides
  // from everyone and "Friends & Followers" hides from non-related viewers.
  const _priv = { ...PRIVACY_DEFAULTS, ...(user.settings?.privacy || {}) };
  const _related = following || targetFollowsMe;
  const _isAdmin = viewer?.role === 'admin';
  const profilePrivate = !isMe && !_isAdmin &&
    (_priv.profileVis === 'Only me' || (_priv.profileVis === 'Friends & Followers' && !_related));
  if (profilePrivate) {
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
            className="px-5 py-2 rounded-full bg-brand-violet-light text-white font-semibold text-sm disabled:opacity-60">
            Follow
          </button>
        )}
      </div>
    );
  }

  // Vanguard identity mask. If `user` is an active Vanguard and `viewer`
  // is a normal user, swap to the persona before reading display fields.
  // Founder + other Vanguard see the real identity (with rank badge).
  const masked = applyVanguardMask(user, viewer);

  // Equipped rank accent. This is the ONLY place rank touches somebody's
  // profile chrome, and it deliberately colours the PAGE (banner wash, VP bar)
  // and never the avatar ring, which belongs to live and status.
  // A masked Vanguard persona shows nothing personal, accent included.
  // accentFor() is the ONE resolver, and it honours a free-hex accent as well as
  // a preset id. Hand-rolling the lookup in each of the three profile screens is
  // what would have made a hex accent work in the picker and silently do nothing
  // on two of them — and desync the avatar orbit, which reads the same token.
  const accentHex = masked.isVanguardPersona ? null : accentFor(user, null);
  // ONE ring, and it is the live ring (founder, 2026-09-14). The orbit and the
  // unseen-status ring are gone. See src/utils/avatarRing.js.
  const ring = avatarRing({ live: !!(user?.id && isUserLive(user.id)) });

  // Equipped profile theme. Same rule as the accent: it dresses the PAGE.
  // Only used for the bannerless fallback, so a user who uploaded their own
  // banner still sees their banner: a cosmetic must never hide real content.
  const themeBg = (() => {
    if (masked.isVanguardPersona) return null;
    return themeStyle(user?.cosmetics?.theme);
  })();
  // ⚠ THERE WERE TWO ACCENT SYSTEMS ON THIS ONE PAGE, AND EACH PAINTED HALF
  // OF IT. `accentHex` (accentFor -> cosmetics.accent / cosmetics.accentHex,
  // the EARNED unlock) drove the root tokens, the banner glow, the VP bar and
  // the audio FAB. This variable read `users.accentColor` — a THIRD field, set
  // by the unrestricted swatch picker in Edit Profile -> Profile Images — and
  // drove the name-audio button, the status pill, the schedule card and the
  // pinned icon.
  //
  // So equipping a VP accent recoloured some of your public profile and left
  // the rest violet, and neither file showed the disagreement. Exactly the
  // shape of the theme failure that killed `rankCollections.js`: two sources of
  // truth for one visual property.
  //
  // ⚠ `ProfileScreen.jsx` and `NativeProfileScreens.jsx` BOTH resolve through
  // `accentFor()` alone. This screen was the only one that did not, which is
  // why the divergence was invisible to the owner — it only ever showed on the
  // page other people see.
  //
  // The earned accent wins. `users.accentColor` stays as a fallback so an
  // existing Edit Profile choice is not silently dropped from under anyone.
  // Masked personas reveal neither.
  const accent = masked.isVanguardPersona
    ? DEFAULT_ACCENT
    : (accentHex
      || (/^#[0-9a-fA-F]{6}$/.test(user.accentColor || '') ? user.accentColor : DEFAULT_ACCENT));
  const displayName = masked.displayName || masked.username || 'User';
  const handle = masked.username ? `@${masked.username}` : '';
  const initial = (displayName[0] || 'V').toUpperCase();
  const vanguardRank = user.vanguard?.rank;
  const joined = user.createdAt
    ? new Date(user.createdAt.toDate ? user.createdAt.toDate() : user.createdAt)
        .toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
    : '';

  return (
    // A theme dresses the PAGE. Painting it only into the bannerless fallback
    // meant anybody with a banner uploaded saw no change at all.
    // `backgroundAttachment: fixed` used to pin the theme behind the whole page,
    // which is what made it read as wallpaper with content sliding over it. The
    // theme now behaves exactly as it does on the owner's own profile: black
    // page, gradient in the bannerless fallback, glow band at the seam.
    // ⚠ THE ROOT CONTRACT. This is the single line the whole divergence came
    // from. ProfileScreen sets `{...tokens}` + `vg-profile` on its root and
    // every surface below reads --vg-accent*; this screen set only a background,
    // so it had to re-implement each customization with inline hex, and most
    // were never implemented at all (11 hardcoded brand hexes vs 0 on the
    // owner's page). Ambilight also NEEDS `.vg-profile`'s `position: relative`
    // as its containing block, or the glow escapes across the app shell.
    //
    // Set the contract here and a new customization works on both pages by
    // construction. Do not remove either half.
    <div className="pb-10 relative vg-profile"
         style={{ ...themeTokens(user?.cosmetics?.theme || 'default', accentHex || DEFAULT_ACCENT),
                  background: themeBg ? '#000000' : '#0B0B14' }}>
      {/* Docked mini-header — fades in when the banner scrolls away (B8.1). */}
      <MiniDockHeader show={docked} avatar={masked.avatar} name={displayName} user={masked} onBack={() => navigate(-1)} />

      {/* ⚠ AMBILIGHT FILLS THE BANNER + HEADER + STATS BLOCK AND FADES OUT AT ITS
          BOTTOM. The rule was always "the glow ends where the stats bar ends"; it
          used to be approximated with a fixed pixel height (400px here, 470px,
          340px on the phone) and a black feather, and on the phone that fixed
          edge cut straight through the stats numbers. Wrapping the block makes
          the rule true by construction, whatever the header's height.

          `zIndex: -1` and `.vg-profile` (isolation on the root) are still
          load-bearing: the light paints above the page background and below
          everything in the block. The OWNER's effect decides. */}
      <div className="relative">
      {ambilightOn && !masked.isVanguardPersona && user.banner && (
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: -1 }}>
          <Ambilight src={user.banner} videoRef={bannerVideoRef} enabled intensity={0.72} fade="bottom" />
        </div>
      )}
      {/* BANNER — inner wrapper carries the parallax transform so the overlaid
          back/share buttons never move or blur with it.

          The header carries the theme light, exactly as on the owner's page: it
          is the only part of the page with anything to light, since everything
          below sits on black. */}
      <div className="relative h-[220px] overflow-hidden"
           style={themeBg ? headerLightStyle(user?.cosmetics?.theme || 'default') : undefined}>
        <div ref={bannerRef} className="absolute inset-0 will-change-transform">
          {/* Bannerless fallback: deterministic per-uid brand gradient (B8.4)
              so no profile ever looks broken. */}
          <div className="absolute inset-0"
               style={
                 // An equipped theme is a multi-layer style OBJECT (background
                 // plus blend modes), not a single background string, so it is
                 // spread rather than assigned. An uploaded banner still wins:
                 // a cosmetic must never hide real content.
                 (!masked.isVanguardPersona && user.banner)
                   ? { background: 'linear-gradient(135deg,#0d0820 0%,#1a0a3a 30%,#2d0a5a 60%,#1a0a30 100%)' }
                   : (themeBg ? { background: themeBg.background } : { background: bannerGradient(user.id) })
               }>
            {/* Accent wash, painted OVER the theme. Skipped entirely when a
                theme is equipped and no accent is: those themes carry their own
                light direction, and a fixed violet radial on top flattens every
                one of them into the same purple haze. */}
            {(accentHex || !themeBg) && (
              <div className="absolute inset-0"
                   style={{ background: accentHex
                     ? `radial-gradient(ellipse at 70% 50%, ${accentHex}44 0%, transparent 65%), radial-gradient(ellipse at 90% 30%, ${accentHex}26 0%, transparent 50%)`
                     : 'radial-gradient(ellipse at 70% 50%,rgba(123,31,255,0.25) 0%,transparent 65%), radial-gradient(ellipse at 90% 30%,rgba(61,127,255,0.15) 0%,transparent 50%)' }} />
            )}
          </div>
          {/* Banner: only show the real user's banner if NOT masked. A masked
              Vanguard persona reveals no personal banner art. */}
          {!masked.isVanguardPersona && user.banner && (
            <ProfileBanner src={user.banner} className="absolute inset-0 w-full h-full object-cover" videoRef={bannerVideoRef} />
          )}
          <span
            className="absolute right-5 bottom-4 font-syne font-black tracking-widest uppercase select-none pointer-events-none leading-none"
            style={{ fontSize: 64, color: 'rgba(255,255,255,0.05)' }}
          >
            {(masked.username || 'VERGR').toUpperCase()}
          </span>
        </div>

        {/* Back button (top-left) */}
        <button
          onClick={() => navigate(-1)}
          className="absolute top-3.5 left-3.5 w-[34px] h-[34px] flex items-center justify-center rounded-lg text-white"
          style={{ background: '#15151F' }}
        >
          <Icon name="arrow_back" size={16} />
        </button>

        {/* Top-right actions */}
        <div className="absolute top-3.5 right-3.5 flex items-center gap-2">
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold text-white transition-colors hover:brightness-125"
            style={{ background: '#15151F' }}
          >
            <Icon name="share" size={13} /> Share
          </button>
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }}
              className="w-[34px] h-[34px] flex items-center justify-center rounded-lg text-white"
              style={{ background: '#15151F' }}
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
                {/* Boosts are tokens you own and may spend on anyone, so this is
                    not gated on it being your own profile. */}
                <DropdownItem icon="rocket_launch" label="Boost profile" onClick={() => { setMenuOpen(false); setShowBoost(true); }} />
                {!masked.isVanguardPersona && (
                  <DropdownItem icon="qr_code_2" label="QR code" onClick={() => { setMenuOpen(false); setShowQr(true); }} />
                )}
                {!isMe && currentUser && (
                  <DropdownItem icon="block" label="Block user" onClick={async () => {
                    setMenuOpen(false);
                    if (!window.confirm(`Block ${displayName}? They won't be able to message you.`)) return;
                    try {
                      await blockUser(currentUser.uid, user.id);
                      showToast(`@${masked.username || displayName} blocked — manage in Settings → Privacy`, 'success');
                    } catch (err) {
                      showToast(err?.message || 'Could not block', 'error');
                    }
                  }} />
                )}
                {!isMe && currentUser && <DropdownItem icon="flag" label="Report" onClick={() => { setMenuOpen(false); setShowReport(true); }} />}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* PROFILE HEADER — relative z-10 so it paints ABOVE the positioned
          banner. Without this the banner (position:relative) renders on top of
          the static header in the -mt-11 overlap zone, hiding the username and
          clipping the action buttons. */}
      <div className="px-5 relative z-10">
        {/* ⚠ ONLY THE AVATAR OVERLAPS THE BANNER. Measured: with the negative
            margin on the ROW, the display name spanned y=199..226 against a
            banner ending at y=220 — 21px of the name sat on the art. An avatar
            breaking the banner edge is the standard pattern; a name doing it is
            just a collision. The lift now lives on the avatar alone, so the
            identity text starts below the edge no matter how tall it gets.

            ⚠ `items-start`, NOT `items-end`. With `items-end` every child is
            bottom-aligned, so a negative top margin on the avatar only shortened
            the row and the avatar stayed put (measured: it ended up 30px BELOW
            the banner instead of breaking it). Aligning to the START lets the
            avatar's -mt-11 actually lift it over the edge while the text column
            begins at the row top, below the banner. */}
        <div className="flex items-start gap-4 mb-3 pt-1">
          {/* ⚠ ONE RING, AND IT IS THE LIVE RING, WITH ITS PILL (founder,
              2026-09-14). The orbit, the unseen-status ring and the dark
              separator ring are gone. The gradient paints only when there is no
              photo: behind a photo its antialiased edge showed as a thin ring. */}
          <div
            className="w-[88px] h-[88px] -mt-11 rounded-full flex items-center justify-center font-syne font-black text-[30px] relative shrink-0"
            style={{
              background: masked.avatar ? 'transparent' : 'linear-gradient(135deg,#7b1fff,#3b82f6)',
              ...(ring === RING.LIVE ? { boxShadow: '0 0 0 3px #0B0B14, 0 0 0 6px #F04060, 0 0 22px #F0406088' } : {}),
            }}
          >
            {/* overflow-hidden on inner image wrapper so the presence dot
                below isn't clipped at the avatar edge. */}
            <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center">
              {masked.avatar
                ? <img src={masked.avatar} alt={displayName} className="w-full h-full object-cover" />
                : initial}
            </div>
            {/* ⚠ CHAMPION FRAME REMOVED 2026-08-24, and it was verified dead
                before removal: its ONLY writer was functions/tournaments.js:2471,
                deleted with the 70 tournament callables on 2026-08-17. It was a
                ring reserved for a state that can no longer occur. UserAvatar
                keeps its `championFrame` prop because CoachingScreen still passes
                it, so nothing else breaks. */}
            {/* Live now — the ring itself is on the wrapper above (single
                occupancy); this is just the clickable LIVE pill. */}
            {ring === RING.LIVE && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); const sid = liveStreamFor(user.id); if (sid) navigate(`/watch/${sid}`); }}
                  className="absolute -bottom-2 left-1/2 -translate-x-1/2 z-30 bg-brand-ember px-2 py-0.5 rounded text-[9px] font-bold text-white uppercase tracking-wider"
                  style={{ whiteSpace: 'nowrap' }}
                  title="Watch live"
                >
                  Live
                </button>
              </>
            )}
            {/* Presence dot. Respects the viewed user's privacy setting:
                if they've turned off "Show online status", no dot renders
                at all (not even a grey "offline" one). */}
            {presenceVisible(user) && (
              <span
                className="absolute bottom-1 right-1 w-4 h-4 rounded-full"
                style={{
                  background: userOnline ? '#22D17E' : '#555',
                  border: '3px solid #0B0B14',
                  boxShadow: userOnline ? '0 0 8px rgba(34,209,126,0.55)' : 'none',
                }}
                title={userOnline ? 'Online' : 'Offline'}
              />
            )}
          </div>
          <div className="flex-1 pb-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap min-w-0">
              <span className="text-[22px] font-extrabold text-text-primary truncate"><UserName user={masked} masked context="profile" fallback={displayName} /></span>
              <RankBadge level={masked?.vpLevel} role={masked?.role} size={18} style={{ verticalAlign: '-3px' }} />
              {!masked.isVanguardPersona && <NameAudioButton url={user.nameAudioUrl} accent={accent} />}
              {user.isVerified && (
                <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: 'var(--vg-accent)' }}>
                  <Icon name="check" size={11} className="text-white" />
                </div>
              )}
              {!isBot && (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase shrink-0"
                      style={ACCENT_CHIP}>
                  {vpLevel?.name || 'Rookie'}
                </span>
              )}
            </div>
            {/* ⚠ HANDLE DIRECTLY UNDER THE DISPLAY NAME (founder, 2026-08-24).
                It used to sit BELOW the action buttons, so the two halves of a
                person's identity were split by a row of controls. Name and
                handle are one unit and read as one. */}
            <div className="flex items-center gap-2 mb-1.5">
              <div className="text-[12px] text-text-muted">{handle}</div>
              {/* Rank badge sits next to the handle. Visible to all viewers
                  including non-Vanguard — that's the WHOLE POINT of the
                  persona: users can identify which rank they're talking
                  to. The real identity stays hidden. */}
              {vanguardRank && (
                <VanguardBadge rank={vanguardRank} size={16} title={`${rankMeta(vanguardRank).label} — Vergr Vanguard`} />
              )}
              {/* Plan badge. Suppressed on a Vanguard persona: the whole point
                  of the mask is that the persona leaks nothing about the real
                  account behind it, and what someone pays is exactly that. */}
              {!masked.isVanguardPersona && <PlanBadge profile={user} />}
            </div>

            {/* Personal bio: hide entirely when masked — the persona has no
                bio. For Vanguard show the rank's standard blurb instead. */}
            {masked.isVanguardPersona ? (
              <p className="text-[13px] text-text-secondary leading-relaxed mb-2 max-w-[500px]">
                {rankMeta(vanguardRank).blurb}
              </p>
            ) : (
              user.bio && (
                <p className="text-[13px] text-text-secondary leading-relaxed mb-2 max-w-[500px] whitespace-pre-line">
                  {user.bio}
                </p>
              )
            )}
            {/* Membership: shows the creator's tiers + join CTA. Self-hides when
                the creator has no published tiers, when viewing your own profile,
                or for masked Vanguard personas. */}
            {!masked.isVanguardPersona && !isMe && (
              <div className="my-3 max-w-[500px]">
                <MembershipBlock creatorId={user.id} creatorName={displayName} />
              </div>
            )}
            {/* Linked socials + join date — both leak identity, so hide when
                masked. */}
            <div className="flex items-center gap-2.5 flex-wrap">
              {!masked.isVanguardPersona && socialsToList(user.socials, user.socialEnabled).map((s, i) => (
                <a key={i} href={s.href} target="_blank" rel="noreferrer" aria-label={socialLabel(s.platform)}
                   onClick={(e) => openSocialLink(e, s.href)}
                   className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-white hover:bg-purple-700/20 transition-colors"
                   style={SOLID_CHIP}>
                  <Icon name={socialIcon(s.platform)} size={13} />
                </a>
              ))}
              {!masked.isVanguardPersona && joined && (
                <span className="flex items-center gap-1 text-[11px] text-text-muted">
                  <Icon name="event" size={12} /> Joined {joined}
                </span>
              )}
            </div>
            {!masked.isVanguardPersona && <LinkedHandles linkedAccounts={user.linkedAccounts} platforms={user.platforms} className="mt-2" />}
          </div>
          {/* ⚠ ACTIONS SIT ON THE RIGHT, in the black space under the banner.
              Founder, said three times: "the following, message, and tips have
              to be on the right, where there is black space, under the profile
              banner."

              As a third member of the identity ROW (not a row of its own, not
              inside the text column) they occupy the ~700px that was empty,
              stay clear of the banner art, and leave the name/handle/bio full
              width instead of squashed. `ml-auto` pins them right; `shrink-0`
              stops them collapsing when a long bio pushes the column. */}
          <div className="shrink-0 ml-auto">
                  {!isMe && (
                    <div className="flex items-center gap-2 mb-2 flex-wrap justify-end">
                      <motion.button
                        onClick={handleFollowToggle}
                        disabled={toggling}
                        whileTap={{ scale: 0.92 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                        className="px-5 py-2 rounded-full font-bold text-[13px] transition-colors shrink-0"
                        style={following
                          ? { ...SOLID_CHIP, color: '#a0a0c0' }
                          : { background: 'var(--vg-accent)', color: '#fff', boxShadow: '0 0 18px var(--vg-accent-dim)' }}
                      >
                        {following ? 'Following' : 'Follow'}
                      </motion.button>
                      {!isBot && (
                        <>
                          <button onClick={handleMessage}
                                  className="w-10 h-10 rounded-full flex items-center justify-center hover:brightness-125 transition-all shrink-0 text-white"
                                  style={SOLID_CHIP}
                                  title="Message">
                            <Icon name="chat_bubble" size={16} />
                          </button>
                          <button onClick={() => setShowTip(true)}
                                  className="w-10 h-10 rounded-full flex items-center justify-center hover:brightness-125 transition-all shrink-0"
                                  style={TIP_CHIP}
                                  title="Tip">
                            <CoinIcon size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {isMe && (
                    <button
                      onClick={() => navigate('/edit-profile')}
                      className="px-4 py-2 rounded-lg font-bold text-[12px] mb-2"
                      style={ACCENT_CHIP}
                    >
                      Edit Profile
                    </button>
                  )}
          </div>
        </div>
      </div>


      {/* STATS BAR — compact 3-up counts (Instagram/TikTok style), VP banner
          stacked full-width below. Mobile-first: no bulky icon boxes, no
          inline VP banner that overflowed off-screen on phones. */}
      {/* ⚠ Withheld for a masked Vanguard: the real account's counts are enough
          to match the persona to a person. */}
      {!masked.isVanguardPersona && (
      <div className="px-5 py-3">
        {/* ⚠ ONE ROW: Followers | Following | Likes | VP, exactly as the owner's
            own profile does it (ProfileScreen.jsx:413). Founder, 2026-08-24:
            "Vergr points does not need to be a full width, the stats and Vergr
            points can look the same as on the profile page."
            It was a 1009px-wide card carrying one number. */}
        <div className="flex flex-wrap items-center gap-y-2">
          <Stat icon="person" label="Followers" value={<CountUpNumber value={followerCount} format={formatCount} />} onClick={() => navigate(`/connections/${user.id}/followers`)} />
          <Stat icon="group" label="Following" value={<CountUpNumber value={followingCount} format={formatCount} />} onClick={() => navigate(`/connections/${user.id}/following`)} />
          <Stat icon="favorite" label="Likes" value={<CountUpNumber value={pLikes} format={formatCount} />} />

        {!isBot && (
          <button
            onClick={() => navigate('/prestige')}
            className="vg-recess flex items-center gap-3 p-3 rounded-xl text-left hover:brightness-110 transition-all w-full mt-3 md:w-auto md:flex-1 md:mt-0 md:ml-auto"
          >
            <div className="flex-1 min-w-0">
              <p className="text-[9px] font-bold tracking-widest uppercase" style={{ color: 'var(--vg-accent)' }}>Vergr Points</p>
              <p className="text-[18px] font-black text-text-primary leading-none mt-0.5">
                {userVP.toLocaleString()} <span className="text-[13px]" style={{ color: 'var(--vg-accent)' }}>VP</span>
              </p>
              <div className="h-[3px] rounded mt-1.5" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <div className="h-full rounded" style={{ width: `${Math.min(100, (vpProgress || 0))}%`, background: accentHex ? `linear-gradient(90deg, ${accentHex}, ${accentHex}CC)` : 'linear-gradient(90deg,var(--vg-accent-dark),var(--vg-accent))' }} />
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
      </div>
      )}
      </div>

      {/* STREAM SCHEDULE — read-only card, self-hides when unset/masked. */}
      {!masked.isVanguardPersona && user.streamSchedule && (
        <div className="px-5 pt-4">
          <StreamScheduleCard schedule={user.streamSchedule} accent={accent} />
        </div>
      )}

      {/* ⚠ MILESTONES ARE NOT ON THE PUBLIC PROFILE (founder, 2026-08-24).
          The badge ART is rejected ("those look like shit", 2026-08-24) and the
          public profile is the face strangers judge the product by, so it does
          not carry artwork that is known to be unfinished. The SYSTEM is sound
          and stays on the OWNER's own profile, where it is a progress view
          rather than a shop window.
          Re-add here only once the badge art is redesigned and approved. */}

      {/* TABS — hidden when the profile is masked. A Vanguard persona
          doesn't show personal post history; their actions are attributed
          to "@Vanguard" wherever those posts/comments live in feeds. */}
      {!masked.isVanguardPersona && (
        <div className="flex items-center justify-between px-5">
          <div className="flex">
            {PROFILE_TABS.map(t => (
              <button key={t}
                onClick={() => setActiveTab(t)}
                className="shrink-0 whitespace-nowrap px-4 py-3 text-[13px] font-semibold transition-colors"
                style={activeTab === t
                  ? { color: '#fff', borderBottom: '2px solid var(--vg-accent)', boxShadow: '0 2px 12px -4px var(--vg-accent)' }
                  : { color: '#6B7280', borderBottom: '2px solid transparent' }}>
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* POSTS GRID — empty when masked. Show a Vanguard explainer instead. */}
      {masked.isVanguardPersona ? (
        <div className="px-5 py-12 text-center text-text-muted">
          <img src={rankMeta(vanguardRank).avatar} alt="" className="w-20 h-20 mx-auto rounded-2xl mb-4" style={{ objectFit: 'cover' }} />
          <p className="text-[14px] font-semibold text-text-secondary mb-1">Vergr Vanguard · {rankMeta(vanguardRank).label}</p>
          <p className="text-[12px] max-w-md mx-auto leading-relaxed">
            Vanguard members are anonymous moderators. Their identity is private to protect them from retaliation. If you have a question or report, you can message them via the Vanguard squad or the report flow.
          </p>
        </div>
      ) : (
      // One timeline column for Posts, uniform grids for Clips and Media (see
      // components/profile/ProfileGrid.jsx for why). The bottom padding keeps the
      // last post clear of the floating music player when one is playing.
      <div className={`py-3 md:px-5 ${!isMe && ambianceOn && user.cosmetics?.profileAudio ? 'pb-28' : ''}`}>
        {/* PINNED — above the Posts list only; the main list drops pinned ids
            so nothing renders twice. */}
        {activeTab === 'Posts' && pinnedPosts.length > 0 && (
          <div className="mb-2">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-secondary px-4 md:px-0 pt-1 pb-2">
              <Icon name="push_pin" size={13} style={{ color: accent }} /> Pinned
            </p>
            <ProfilePostList tab="Posts" posts={pinnedPosts.map(p => ({ ...p, author: user }))} />
          </div>
        )}
        {(() => {
          const pinnedIds = new Set(pinnedPosts.map(p => p.id));
          const list = activeTab === 'Posts' ? filteredPosts.filter(p => !pinnedIds.has(p.id)) : filteredPosts;
          if (list.length === 0 && !(activeTab === 'Posts' && pinnedPosts.length)) {
            return (
              <div className="text-center py-16">
                <Icon name="inbox" size={48} className="text-text-muted/20 mx-auto mb-3" />
                <p className="text-text-muted text-sm">No {activeTab.toLowerCase()} yet</p>
              </div>
            );
          }
          return <ProfilePostList tab={activeTab} posts={list} />;
        })()}
      </div>
      )}

      {showTip && user && (
        <SendCoinsModal isOpen={showTip} onClose={() => setShowTip(false)} recipient={user} />
      )}
      <MyQrModal open={showQr} onClose={() => setShowQr(false)} user={user} />
      {showBoost && (
        <BoostSheet
          target="user"
          targetId={user?.id}
          targetLabel={`@${displayName}`}
          onClose={() => setShowBoost(false)}
        />
      )}
      {/* ── PROFILE MUSIC (effect 09) ─────────────────────────────
          ⚠ STICKY INSIDE THE PROFILE COLUMN, NOT FIXED TO THE VIEWPORT. The
          fixed version landed on top of the right rail on desktop: measured,
          elementFromPoint at the FAB's centre returned the <aside>, so real
          clicks never reached it. Founder: "the FAB shouldnt be on the profile
          overview it should be floating on the profile section."
          ⚠ NOT on the owner's own page, and NOT on a masked persona (a
          recognisable track is an identity leak).
          ⚠ The report control is MANDATORY: nothing scans audio, so a visitor
          being able to report it IS the moderation story. */}
      {!isMe && !masked.isVanguardPersona && (
        // ⚠ ABOVE THE BOTTOM NAV ON A PHONE. At bottom-6 it sat BEHIND the fixed
        // 56px nav (z-50 over z-30), so a phone browser never showed it; on a
        // computer there is no bottom nav and bottom-6 is right.
        <div className="sticky bottom-[calc(72px+var(--vg-safe-b,0px))] lg:bottom-6 z-30 flex justify-end pr-4 pointer-events-none">
          <div className="pointer-events-auto">
            <ProfileAudio
              track={user.cosmetics?.profileAudio}
              enabled={ambianceOn}
              accent={accentHex || 'var(--brand-violet,#7B1FFF)'}
              onReport={currentUser ? () => setShowReport(true) : undefined}
            />
          </div>
        </div>
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

// ─── Sub-components ────────────────────────────────────────────────

function DropdownItem({ icon, label, onClick }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[13px] text-text-muted hover:text-white hover:bg-purple-700/15 transition-colors text-left">
      <Icon name={icon} size={14} /> {label}
    </button>
  );
}

// ⚠ IDENTICAL TO `Stat` IN ProfileScreen.jsx:550. It used to be a bare centred
// value-over-label with no icon, which is why the founder said the stats "are
// not in the darkened space like they are on the profile page": the accent icon
// chip is what gives the row its surface, and without it the numbers floated on
// bare black while the VP block beside them sat in a recess.
//
// If you change one, change both. They are the same component on two screens.
function Stat({ icon, label, value, onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2.5 pr-6 transition-colors hover:brightness-125">
      <div className="w-[34px] h-[34px] rounded-lg flex items-center justify-center"
           style={{ ...SOLID_CHIP, color: 'var(--vg-accent)' }}>
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


// ─── Right rail ────────────────────────────────────────────────────

function PublicRightPanel({ user, posts, loaded = true, navigate, onViewClips }) {
  // Before the posts arrive every figure was a confident "0".
  const shown = (v) => (loaded ? v.toLocaleString() : '–');
  const totalLikes = posts.reduce((s, p) => s + (p.likeCount || 0), 0);
  const totalViews = posts.reduce((s, p) => s + (p.viewCount || 0), 0);
  const totalClips = posts.filter(p => isShortFormat(p.type)).length;
  const topClips = [...posts].filter(p => isShortFormat(p.type))
                     .sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0))
                     .slice(0, 3);
  // Twitch handle pulled from linkedAccounts. Stored as either a string
  // (legacy manual flow) or an object { username } from the OAuth flow.
  const twitchRaw = user?.linkedAccounts?.twitch;
  const twitchUser = typeof twitchRaw === 'string' ? twitchRaw : twitchRaw?.username;
  return (
    <div className="w-full px-3 py-4 space-y-4">
      {twitchUser && (
        <div className="rounded-xl p-3" style={{ background: '#14141F' }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[13px] font-bold text-text-primary">Twitch</p>
            <a href={`https://twitch.tv/${twitchUser}`} target="_blank" rel="noreferrer"
               className="text-[10px] font-bold text-[#9146FF]">Open on Twitch ↗</a>
          </div>
          <TwitchMirrorPlayer username={twitchUser} />
        </div>
      )}

      {/* Stats */}
      <div className="rounded-xl p-3" style={{ background: '#14141F' }}>
        <p className="text-[13px] font-bold text-text-primary mb-2.5">Profile Overview</p>
        <div className="grid grid-cols-2 gap-2">
          <OvCard icon="visibility" label="Total Views" value={shown(totalViews)} />
          <OvCard icon="movie"      label="Total Clips" value={shown(totalClips)} />
          <OvCard icon="favorite"   label="Total Likes" value={shown(totalLikes)} />
          <OvCard icon="forum"      label="Posts"       value={user.postCount ? user.postCount.toLocaleString() : shown(posts.length)} />
        </div>
      </div>

      {/* Top Clips */}
      {/* ⚠ It read `c.imageUrl`, which no clip carries, so every thumbnail was
          an empty gradient box, and `c.text`, so every title said "Clip"
          (founder, 2026-09-14 screenshot). TopClipsList draws the real cover. */}
      <div className="rounded-xl p-3" style={{ background: '#14141F' }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[13px] font-bold text-text-primary">Top Clips</p>
          {topClips.length > 0 && (
            <button onClick={onViewClips} className="text-[11px] font-semibold text-brand-violet-light">View All</button>
          )}
        </div>
        <TopClipsList clips={topClips} loading={!loaded} />
      </div>

      {/* Squads */}
      <div className="rounded-xl p-3" style={{ background: '#14141F' }}>
        <p className="text-[13px] font-bold text-text-primary mb-2">Squads</p>
        {/* ⚠ "Public squads coming soon" was REMOVED 2026-08-24. A coming-soon
            panel on the page strangers judge the product by reads as unfinished.
            Show squads when they are real, or show nothing. */}
        <p className="text-[11px] text-text-muted">No public squads</p>
      </div>
    </div>
  );
}

function OvCard({ icon, label, value }) {
  return (
    <div className="rounded-[10px] p-2.5" style={{ background: '#1C1C29' }}>
      <div className="flex items-center gap-1 text-[10px] text-text-muted mb-1">
        <Icon name={icon} size={11} /> {label}
      </div>
      <div className="text-[15px] font-extrabold text-text-primary">{value}</div>
    </div>
  );
}