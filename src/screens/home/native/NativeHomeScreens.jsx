// NATIVE-APP home/feed-area screens (Android/iOS Tauri shell ONLY).
//
// Dedicated mobile-first variants for Batch 2 (everything except HomeFeed, which
// already has NativeHomeFeedScreen). Routed `IS_NATIVE_BUILD ? <Native> :
// <existing>`; never render on web. The existing src/screens/home/* are
// UNTOUCHED. Each reuses the SAME data hooks/contexts/callables as its web twin
// (useNotifications, getGameWeeklyLeaderboard, claimQuestReward, addComment,
// PostCard, etc.) — only the layout is phone-first (drops desktop sidebars/
// two-column branches; full-width single column). Shared TopBar is native-safe.

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { doc, getDoc, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db, functions } from '../../../firebase/config';
import { httpsCallable } from 'firebase/functions';
import { useNotifications } from '../../../context/NotificationContext';
import { useMergedNotifications } from '../../../hooks/useMergedNotifications';
import { useAuth } from '../../../context/AuthContext';
import { useUser } from '../../../context/UserContext';
import { useUI } from '../../../context/UIContext';
import { useLayout } from '../../../context/LayoutContext';
import {
  getUser, getComments, addComment as addCommentToFirestore, getPostByIdOrSlug,
  getQuestClaims, getUserPosts, getFollowing, getTransactions,
  toggleCommentLike, getLikedCommentIds, reportComment, COMMENT_BLOCKED,
} from '../../../firebase/firestore';
import ReportSheet from '../../../components/ReportSheet';
import { uploadMediaFile } from '../../../utils/mediaHelpers';
import { applyVanguardMask } from '../../../utils/vanguard';
import { PLAN_VP_MULTIPLIER, REFERRAL_VP_REFERRER, REFERRAL_VP_REFEREE } from '../../../utils/vpSystem';
import { resolveTier } from '../../../utils/tierSystem';
import { timeAgo } from '../../../utils/helpers';
import TopBar from '../../../components/TopBar';
import UserAvatar from '../../../components/UserAvatar';
import Icon from '../../../components/Icon';
import InlineVideoPlayer from '../../../components/media/InlineVideoPlayer';
import CoinDisplay from '../../../components/CoinDisplay';
import { CoinIcon, VPIcon } from '../../../components/CoinIcon';
import InfoTooltip from '../../../components/InfoTooltip';
import { HowItWorksBanner, BrandGlyph, FAQS } from '../ReferralScreen';
import WatchToEarnQuest from '../../../components/WatchToEarnQuest';
import PostCard from '../../../components/PostCard';
import MediaPanel from '../../../components/MediaPanel';
import EmojiPicker from '../../../components/EmojiPicker';
import VanguardBadge from '../../../components/VanguardBadge';
import { FeedSkeleton, ListSkeleton, StackSkeleton } from '../../../components/skeletons/GlassSkeletons';
import UserName from '../../../components/UserName';

// ═══════════════════════════════════════ NOTIFICATIONS

const NOTIF_ICONS = {
  like: { icon: 'favorite', color: 'text-brand-ember', bg: 'bg-brand-ember/10' },
  follow: { icon: 'person_add', color: 'text-brand-violet-light', bg: 'bg-brand-violet/10' },
  coins: { icon: 'paid', color: 'text-brand-gold', bg: 'bg-brand-gold/10' },
  vp: { icon: 'auto_awesome', color: 'text-brand-violet', bg: 'bg-brand-violet/10' },
  gem_transfer: { icon: 'diamond', color: 'text-gem-blue', bg: 'bg-gem-blue/10' },
  tip: { icon: 'paid', color: 'text-brand-gold', bg: 'bg-brand-gold/10' },
  squad: { icon: 'groups', color: 'text-brand-violet', bg: 'bg-brand-violet/10' },
  comment: { icon: 'chat_bubble', color: 'text-brand-violet-light', bg: 'bg-brand-violet/10' },
  stream: { icon: 'live_tv', color: 'text-brand-ember', bg: 'bg-brand-ember/10' },
  message: { icon: 'chat', color: 'text-brand-ember', bg: 'bg-brand-ember/10' },
  request: { icon: 'mark_email_unread', color: 'text-brand-gold', bg: 'bg-brand-gold/10' },
  missed_call: { icon: 'call_missed', color: 'text-success-green', bg: 'bg-success-green/10' },
  system: { icon: 'info', color: 'text-brand-violet', bg: 'bg-brand-violet/10' },
};

export function NativeNotificationsScreen() {
  const { markAllRead, markRead } = useNotifications();
  const { items, routeFor } = useMergedNotifications();
  const navigate = useNavigate();
  const loading = items == null;

  const notifications = useMemo(() => {
    if (items && items.length > 0) return items;
    return [{ id: 'welcome-system', type: 'system', content: 'Welcome to Vergr! Start by following creators or posting your first clip.', read: false, _ms: Date.now() }];
  }, [items]);

  const handleNotifClick = async (notif) => {
    if (!notif.read && notif._kind === 'doc') markRead(notif.id);
    const path = routeFor(notif);
    if (path) navigate(path);
  };

  return (
    <div className="min-h-screen pb-8">
      <TopBar title="Notifications" showBack actions={<button onClick={markAllRead} className="text-text-secondary text-xs font-medium active:text-text-primary">Mark all read</button>} />
      <div className="divide-y divide-white/[0.04]">
        {loading ? (
          <div className="p-8 text-center text-text-muted"><div className="w-6 h-6 border-2 border-surface-3 border-t-brand-violet rounded-full animate-spin mx-auto mb-3" /><span className="text-xs font-dmmono">Loading</span></div>
        ) : notifications.map((notif, idx) => {
          const style = NOTIF_ICONS[notif.type] || NOTIF_ICONS.system;
          return (
            <motion.button key={notif.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(idx * 0.04, 0.4), duration: 0.2 }}
              onClick={() => handleNotifClick(notif)} className={`w-full flex items-start gap-3 px-4 py-4 text-left active:bg-surface-1/40 ${!notif.read ? 'bg-brand-violet/[0.02]' : ''}`}>
              {notif.senderAvatar ? <UserAvatar src={notif.senderAvatar} size={44} /> : (
                <div className={`w-11 h-11 rounded-xl ${style.bg} flex items-center justify-center shrink-0`}><Icon name={style.icon} filled size={20} className={style.color} /></div>
              )}
              <div className="flex-1 min-w-0">
                <p className={`text-sm leading-relaxed ${!notif.read ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
                  {notif.senderName && <span className="font-bold text-white">{notif.senderName} </span>}{notif.content || notif.body}
                </p>
                <p className="text-text-muted text-xs mt-1 font-dmmono">{timeAgo(notif._ms ? new Date(notif._ms) : (notif.createdAt?.toDate ? notif.createdAt.toDate() : notif.createdAt))}</p>
              </div>
              {!notif.read && <div className="w-2 h-2 bg-brand-violet rounded-full mt-2 shrink-0" />}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ TRENDING HASHTAGS

export function NativeTrendingHashtagsScreen() {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try { const snap = await getDoc(doc(db, 'trending', 'daily')); if (snap.exists() && snap.data().hashtags?.length > 0) setTags(snap.data().hashtags); }
      catch (err) { console.error(err); }
      setLoading(false);
    })();
  }, []);

  return (
    <div className="min-h-screen pb-8">
      <TopBar title="Trending" showBack />
      <div className="px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-surface-3 border-t-brand-violet rounded-full animate-spin" /></div>
        ) : tags.length === 0 ? (
          <div className="text-center py-16"><Icon name="trending_up" size={48} className="text-text-muted/30 mx-auto mb-3" /><p className="text-text-muted text-sm">No trending hashtags yet</p><p className="text-text-muted/60 text-xs mt-1">Start using hashtags in your posts to see trends here</p></div>
        ) : (
          <div className="space-y-2">
            {tags.map((tag, i) => (
              <button key={tag.tag || i} onClick={() => navigate(`/search?q=${encodeURIComponent(tag.tag || tag)}`)} className="w-full flex items-center gap-3 p-4 rounded-2xl bg-surface-1 border border-white/[0.06] text-left active:border-white/[0.12]">
                <span className="font-dmmono text-text-muted w-6 text-center">#{i + 1}</span>
                <div className="flex-1"><p className="text-sm font-bold text-brand-violet-light">#{typeof tag === 'string' ? tag : tag.tag}</p>{tag.count && <p className="text-xs text-text-muted">{tag.count} posts</p>}</div>
                <Icon name="trending_up" size={18} className="text-green-500" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ LEADERBOARD

// Every entry below was listed TWICE (earnings, xp, posts, followers,
// streamers), so the chip row rendered ten tabs for five boards. Deduped.
//
// `predictorStreak` ("Hottest Streak") is removed: it ranked Champion Picks,
// the prediction layer that went with tournaments, and llms.txt states
// publicly that Vergr runs no prediction markets.
//
// ⚠ Several of these still cannot have data (audit A20 — vp, vpLevel,
// streamHours and totalEarned are written to `wallets`, not `users`, or have
// no writer at all). That is a separate fix and is NOT done here.
const LB_CATEGORIES = [
  { key: 'vp', label: 'Top VP', field: 'vp', icon: 'star', suffix: 'VP' },
  { key: 'vpLevel', label: 'Highest Level', field: 'vpLevel', icon: 'trending_up', suffix: 'LVL' },
  { key: 'followers', label: 'Most Followed', field: 'followerCount', icon: 'group' },
  { key: 'earnings', label: 'Top Earners', field: 'totalEarned', icon: 'paid' },
  { key: 'xp', label: 'Top XP', field: 'totalXP', icon: 'military_tech' },
  { key: 'posts', label: 'Top Posters', field: 'postCount', icon: 'edit_note' },
  { key: 'streamers', label: 'Top Streamers', field: 'streamHours', icon: 'live_tv', suffix: 'hrs' },
];
const PODIUM_COLORS = { 0: '#F5C542', 1: '#C0C0C0', 2: '#CD7F32' };

export function NativeLeaderboardScreen() {
  const [category, setCategory] = useState(LB_CATEGORIES[0]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // The per-game weekly board is gone with tournaments: it tallied wins
        // from COMPLETED TOURNAMENTS, so it could only ever be empty now.
        const q = query(collection(db, 'users'), orderBy(category.field, 'desc'), limit(50));
        const snap = await getDocs(q);
        const getVal = (u, path) => path.split('.').reduce((o, k) => (o == null ? null : o[k]), u);
        setEntries(snap.docs.map((d, i) => ({ id: d.id, rank: i + 1, ...d.data(), isYou: d.id === currentUser?.uid })).filter(u => (getVal(u, category.field) || 0) > 0));
      } catch (err) { console.error('Leaderboard error:', err); setEntries([]); }
      setLoading(false);
    };
    load();
  }, [category, currentUser]);

  const valOf = (u) => (category.field ? category.field.split('.').reduce((o, k) => (o == null ? null : o[k]), u) : 0);
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  const formatVal = (n) => !n ? '0' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : n.toLocaleString();

  return (
    <div className="min-h-screen pb-8">
      <TopBar title="Leaderboard" showBack />
      <div className="flex gap-2 px-4 py-3 overflow-x-auto no-scrollbar">
        {LB_CATEGORIES.map(cat => (
          <button key={cat.key} onClick={() => setCategory(cat)} className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap ${category.key === cat.key ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-secondary'}`}>
            <Icon name={cat.icon} size={14} /> {cat.label}
          </button>
        ))}
      </div>
      <div className="px-4">
        {loading ? <ListSkeleton rows={8} /> : entries.length === 0 ? (
          <div className="text-center py-16"><Icon name="leaderboard" size={48} className="text-text-muted/20 mx-auto mb-3" /><p className="text-text-muted text-sm">No data yet. Be the first on the board!</p></div>
        ) : (
          <>
            {top3.length >= 3 && (
              <div className="flex items-end justify-center gap-3 py-6 mb-4">
                {[1, 0, 2].map(idx => {
                  const user = top3[idx]; if (!user) return null;
                  const isFirst = idx === 0;
                  return (
                    <button key={user.id} onClick={() => navigate(`/user/${user.id}`)} className="flex flex-col items-center">
                      <div className={`relative ${isFirst ? 'mb-2' : 'mb-1'}`}>
                        {isFirst && <Icon name="emoji_events" size={24} className="text-brand-gold absolute -top-6 left-1/2 -translate-x-1/2" />}
                        <div className="rounded-full p-[2px]" style={{ background: PODIUM_COLORS[idx] }}><UserAvatar src={user.avatar} size={isFirst ? 64 : 48} /></div>
                        <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-bg-dark" style={{ background: PODIUM_COLORS[idx] }}>{idx + 1}</div>
                      </div>
                      <p className={`font-bold truncate max-w-[84px] ${isFirst ? 'text-sm' : 'text-xs'} ${user.isYou ? 'text-brand-violet-light' : 'text-text-primary'}`}><UserName user={user} masked /></p>
                      <p className="text-text-muted text-[10px] font-dmmono">{formatVal(valOf(user))}</p>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="space-y-1.5">
              {rest.map(user => (
                <button key={user.id} onClick={() => navigate(`/user/${user.id}`)} className={`w-full flex items-center gap-3 p-3 rounded-xl ${user.isYou ? 'bg-brand-violet/10 border border-brand-violet/30' : 'bg-surface-1 border border-white/[0.06]'}`}>
                  <span className="w-8 text-center text-text-muted text-xs font-dmmono font-bold">{user.rank}</span>
                  <UserAvatar src={user.avatar} size={40} />
                  <div className="flex-1 text-left min-w-0"><p className={`text-sm font-semibold truncate ${user.isYou ? 'text-brand-violet-light' : 'text-text-primary'}`}><UserName user={user} masked /></p><p className="text-text-muted text-xs font-dmmono"><UserName user={user} masked handle /></p></div>
                  <span className="text-sm font-dmmono font-bold text-brand-gold">{formatVal(valOf(user))}{category.suffix && <span className="text-[10px] text-text-muted ml-1">{category.suffix}</span>}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ EARN COINS

const QUEST_DEFS = {
  daily: [
    { id: 'daily_post', title: 'Create a Post', description: 'Share something with the community', reward: 15, currency: 'vp', target: 1 },
    { id: 'daily_like', title: 'Like 5 Posts', description: 'Engage with the community', reward: 5, currency: 'vp', target: 5 },
    { id: 'daily_squad_msg', title: 'Squad Activity', description: 'Send a message in any squad', reward: 10, currency: 'vp', target: 1 },
  ],
  weekly: [
    { id: 'weekly_posts', title: 'Content Creator', description: 'Create 3 posts this week', reward: 50, currency: 'vp', target: 3 },
    { id: 'weekly_follow', title: 'Social Butterfly', description: 'Follow 10 new people this week', reward: 50, currency: 'vp', target: 10 },
  ],
  special: [
    { id: 'creator_content', title: 'Creator Content', description: 'Post 10 times with 5+ likes and 5+ comments each', reward: 100, currency: 'vp', target: 10, oneTime: true },
    { id: 'first_squad', title: 'Join a Squad', description: 'Join or create your first squad', reward: 50, currency: 'vp', target: 1, oneTime: true },
    { id: 'first_event', title: 'Host an Event', description: 'Create your first ticketed event', reward: 100, currency: 'vp', target: 1, oneTime: true },
    { id: 'refer_friend', title: 'Refer a Friend', description: 'Friend joins via your link and verifies a phone number. You earn 5000 VP, they earn 3000 VP', reward: 5000, currency: 'vp', target: 1, requiresFriend: true, external: true, externalRoute: '/earn/refer', externalLabel: 'Manage' },
    { id: 'add_phone', title: 'Add Phone Number', description: 'Unlocks contact invites — open New Chat → ⋮ → Add phone number', reward: 1000, currency: 'vp', target: 1, oneTime: true, external: true, externalRoute: '/messages/new', externalLabel: 'Add' },
  ],
};

export function NativeEarnCoinsScreen() {
  const [activeTab, setActiveTab] = useState('daily');
  const [claimedIds, setClaimedIds] = useState([]);
  const [claiming, setClaiming] = useState(null);
  const [userActivity, setUserActivity] = useState({});
  const [loading, setLoading] = useState(true);
  const { currentUser } = useAuth();
  const { wallet, profile } = useUser();
  const plan = resolveTier(profile);
  const vpMultiplier = PLAN_VP_MULTIPLIER[plan] || 1;
  const { showToast } = useUI();
  const navigate = useNavigate();

  useEffect(() => {
    if (!currentUser) return;
    const load = async () => {
      setLoading(true);
      try {
        const [claims, posts, following] = await Promise.all([
          getQuestClaims(currentUser.uid),
          getUserPosts(currentUser.uid, 10).catch(() => []),
          getFollowing(currentUser.uid, 50).catch(() => []),
        ]);
        setClaimedIds(claims);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const weekStart = new Date(today); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        const todayPosts = posts.filter(p => { const d = p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt); return d >= today; }).length;
        const weekPosts = posts.filter(p => { const d = p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt); return d >= weekStart; }).length;
        setUserActivity({ daily_login: 1, daily_post: todayPosts, daily_like: 0, daily_squad_msg: 0, weekly_posts: weekPosts, weekly_follow: following.length, weekly_streak: 1, refer_friend: 0, first_squad: 0, first_tournament: 0 });
      } catch (err) { console.error('Failed to load earn data:', err); }
      setLoading(false);
    };
    load();
  }, [currentUser]);

  const handleClaim = useCallback(async (quest) => {
    if (claiming || claimedIds.includes(quest.id)) return;
    setClaiming(quest.id);
    try {
      const res = await httpsCallable(functions, 'claimQuestReward')({ questId: quest.id, reward: quest.reward, title: quest.title });
      setClaimedIds(prev => [...prev, quest.id]);
      // Server-reported payout (plan multiplier included), not the card's base.
      showToast(`+${res?.data?.reward ?? quest.reward} VP earned!`, 'success');
    } catch (err) {
      if (err.code === 'functions/already-exists' || err.message?.includes('already claimed')) { showToast('Already claimed today', 'info'); setClaimedIds(prev => [...prev, quest.id]); }
      // Quests verify server-side now, so a refusal carries a specific reason
      // ("Like 5 posts today to claim this."). Surface it, don't swallow it.
      else if (err.code === 'functions/failed-precondition') { showToast(err.message || 'You have not completed this quest yet.', 'info'); }
      else { showToast(err.message || 'Failed to claim reward', 'error'); console.error(err); }
    }
    setClaiming(null);
  }, [claiming, claimedIds, showToast]);

  const quests = QUEST_DEFS[activeTab] || [];
  const EARN_METHODS = [
    { icon: 'star', title: 'Daily Quests', desc: 'Complete tasks for VP', reward: '15-30 VP/day', color: 'text-brand-violet', action: () => setActiveTab('daily') },
    { icon: 'login', title: '5-Day Streak', desc: 'Log in 5 days straight', reward: '5 coins + 50 VP', color: 'text-brand-gold', action: () => navigate('/') },
    { icon: 'phone', title: 'Add Phone Number', desc: 'Unlock contact invites', reward: '1000 VP', color: 'text-brand-violet-light', action: () => navigate('/messages/new') },
    { icon: 'confirmation_number', title: 'Host an Event', desc: 'Sell tickets to a live event', reward: 'Coins + VP', color: 'text-brand-ember', action: () => navigate('/events/create') },
    { icon: 'person_add', title: 'Refer Friends', desc: 'Invite a friend who sets up properly', reward: '5000 VP (+3000 for them)', color: 'text-brand-pink', action: () => setActiveTab('special') },
    { icon: 'trending_up', title: 'Level Up', desc: 'Climb 11 ranks, collect badges', reward: 'Ranks 1–100', color: 'text-brand-gold', action: () => navigate('/settings/ranks') },
    { icon: 'workspace_premium', title: 'Lite / Pro Plans', desc: '1.5×/2× VP + monthly VP & coins', reward: '+1k–3k VP / mo', color: 'text-brand-violet', action: () => navigate('/settings/subscription') },
  ];

  return (
    <div className="min-h-screen pb-8">
      <TopBar title="Earn Coins" showBack actions={<CoinDisplay amount={wallet?.balance || 0} />} />
      <div className="mx-4 mt-3 p-5 rounded-2xl bg-surface-1 border border-white/[0.06] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-brand-violet/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="relative z-10">
          <p className="text-text-secondary text-xs uppercase tracking-wider font-bold mb-2">How You Earn</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-surface-2/50 text-center"><Icon name="star" size={20} className="text-brand-violet mx-auto mb-1" /><p className="text-brand-violet text-lg font-black font-dmmono">{wallet?.vp || 0}</p><p className="text-text-secondary text-[9px]">VP</p></div>
            <div className="p-3 rounded-xl bg-surface-2/50 text-center"><div className="mx-auto mb-1 w-fit"><CoinIcon size={20} /></div><p className="text-brand-gold text-lg font-black font-dmmono">{wallet?.balance || 0}</p><p className="text-text-secondary text-[9px]">Coins</p></div>
          </div>
          <button onClick={() => navigate('/settings/subscription')} className={`mt-3 w-full flex items-center justify-center gap-2 text-[11px] font-semibold py-2 rounded-full border ${vpMultiplier > 1 ? 'bg-brand-violet/15 border-brand-violet/30 text-brand-violet-light' : 'bg-brand-violet/15 border-brand-violet/30 text-brand-violet'}`}>
            <Icon name={vpMultiplier > 1 ? 'bolt' : 'workspace_premium'} size={14} />
            {vpMultiplier > 1 ? `${plan.toUpperCase()} active — ${vpMultiplier}× VP` : 'Upgrade to Lite / Pro for 1.5× / 2× VP'}
          </button>
        </div>
      </div>
      <WatchToEarnQuest />
      <div className="mx-4 mt-3"><InfoTooltip id="earn_intro" icon="diamond" color="#B44FFF" title="Earning real money on VERGR">Buy <strong>coins</strong> to support creators, and earn <strong>VP</strong> from quests, referrals and levelling up. If people pay for your content, Vergr pays you a share of that revenue on a schedule.</InfoTooltip></div>
      <div className="px-4 mt-6">
        <h3 className="font-syne font-bold text-lg mb-3">Ways to Earn</h3>
        <div className="grid grid-cols-2 gap-3">
          {EARN_METHODS.map((method, i) => (
            <button key={i} onClick={method.action} className="p-3 rounded-2xl border border-white/[0.06] bg-surface-1 text-left active:border-white/[0.12]">
              <Icon name={method.icon} filled size={24} className={method.color} />
              <p className="text-text-primary text-sm font-semibold mt-2">{method.title}</p>
              <p className="text-text-muted text-xs mt-0.5">{method.desc}</p>
              <p className="text-brand-gold text-xs font-dmmono mt-2">{method.reward}</p>
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 mt-6">
        <h3 className="font-syne font-bold text-lg mb-3">Active Quests</h3>
        <div className="flex gap-2 mb-4">
          {['daily', 'weekly', 'special'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-full text-xs font-semibold capitalize ${activeTab === tab ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-secondary'}`}>{tab}</button>
          ))}
        </div>
        {loading ? <StackSkeleton rows={3} height={56} /> : (
          <div className="space-y-3">
            {quests.map(quest => {
              const progress = userActivity[quest.id] || 0;
              const completed = progress >= quest.target;
              const claimed = claimedIds.includes(quest.id);
              return (
                <div key={quest.id} className="flex items-center gap-3 p-4 rounded-2xl border border-white/[0.06] bg-surface-1">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${completed ? 'bg-brand-violet/10' : 'bg-surface-3'}`}><Icon name={completed ? 'check_circle' : 'radio_button_unchecked'} filled={completed} size={24} className={completed ? 'text-brand-violet-light' : 'text-text-muted'} /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary">{quest.title}</p>
                    <p className="text-xs text-text-muted">{quest.description}</p>
                    {!completed && <><div className="w-full h-1.5 bg-surface-3 rounded-full mt-2 overflow-hidden"><div className="h-full bg-brand-violet rounded-full" style={{ width: `${Math.min((progress / quest.target) * 100, 100)}%` }} /></div><p className="text-xs text-text-muted font-dmmono mt-1">{progress}/{quest.target}</p></>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-dmmono font-bold text-brand-violet">★ {quest.reward} VP</p>
                    {quest.external && !claimed && <button onClick={() => navigate(quest.externalRoute || '/messages/new')} className="mt-1 px-3 py-1.5 rounded-full bg-brand-violet text-white text-xs font-bold">{quest.externalLabel || 'Open'}</button>}
                    {!quest.external && completed && !claimed && <button onClick={() => handleClaim(quest)} disabled={claiming === quest.id} className="mt-1 px-3 py-1.5 rounded-full bg-brand-gold text-bg-dark text-xs font-bold">{claiming === quest.id ? '...' : 'Claim'}</button>}
                    {claimed && <span className="text-brand-violet-light text-xs font-semibold">Claimed ✓</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════ REFERRAL

const REFERRAL_BASE_URL = 'https://vergr.app';
const BONUS_MILESTONES = [
  { icon: 'group', label: 'Invite 3 friends', reward: '+2,000 VP', gold: false },
  { icon: 'groups', label: 'Invite 10 friends', reward: '+10,000 VP', gold: false },
  { icon: 'workspace_premium', label: 'Invite 25 friends', reward: 'VIP Status', gold: true },
];
const REFERRAL_TIPS = [
  { icon: 'group', title: 'Invite your squad members', body: "You'll earn more when you invite people who play!" },
  { icon: 'emoji_events', title: 'Share after a win', body: 'People are more likely to join after seeing you win.' },
  { icon: 'forum', title: 'Use Discord', body: 'Sharing in Discord servers gets the best results!' },
];
const SHARE_TARGETS = [
  { id: 'whatsapp', label: 'WhatsApp', emoji: '📱', accent: 'rgba(34,209,126,0.30)', url: (link) => `https://wa.me/?text=${encodeURIComponent('Join me on VERGR! ' + link)}` },
  { id: 'discord', label: 'Discord', emoji: '💬', accent: 'rgba(88,101,242,0.40)', url: () => 'https://discord.com/channels/@me' },
  { id: 'twitter', label: 'X / Twitter', emoji: '𝕏', accent: 'rgba(255,255,255,0.20)', url: (link) => `https://twitter.com/intent/tweet?text=${encodeURIComponent('Join me on VERGR! ' + link)}` },
  { id: 'telegram', label: 'Telegram', emoji: '✈', accent: 'rgba(56,189,248,0.40)', url: (link) => `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Join me on VERGR!')}` },
];

export function NativeReferralScreen() {
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const referralLink = currentUser ? `${REFERRAL_BASE_URL}/reflink?ref=${currentUser.uid}` : `${REFERRAL_BASE_URL}/reflink`;
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState({ totalInvites: 0, successfulReferrals: 0, vpEarned: 0 });
  const [invites, setInvites] = useState([]);
  const [claimedFriendIds, setClaimedFriendIds] = useState([]);
  const [claimingId, setClaimingId] = useState(null);
  const [openFaq, setOpenFaq] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    (async () => {
      try {
        const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
        const data = userSnap.exists() ? userSnap.data() : {};
        const q = query(collection(db, 'users'), where('referredBy', '==', currentUser.uid));
        const snap = await getDocs(q);
        const list = snap.docs.map(d => { const u = d.data(); return { uid: d.id, displayName: u.displayName || u.username || 'Unknown', avatar: u.photoURL || u.avatar || null, verified: u.phoneVerified ?? false }; });
        let claimedIds = [];
        try {
          const cq = query(collection(db, 'quest_claims'), where('userId', '==', currentUser.uid), where('questId', '==', 'refer_friend'));
          const cs = await getDocs(cq);
          claimedIds = cs.docs.map(d => d.data().friendId).filter(Boolean);
        } catch (e) { /* eligibility re-validated server-side on claim */ }
        if (!cancelled) { setStats({ totalInvites: data.referralCount ?? 0, successfulReferrals: data.successfulReferrals ?? 0, vpEarned: data.referralVpEarned ?? 0 }); setInvites(list); setClaimedFriendIds(claimedIds); }
      } catch (err) { console.warn('Referral load failed', err); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [currentUser]);

  const handleClaimFriend = useCallback(async (friendId) => {
    if (claimingId) return;
    setClaimingId(friendId);
    try {
      const res = await httpsCallable(functions, 'claimQuestReward')({ questId: 'refer_friend', reward: 5000, title: 'Refer a Friend', friendId });
      setClaimedFriendIds(prev => [...prev, friendId]);
      setStats(prev => ({ ...prev, successfulReferrals: prev.successfulReferrals + 1, vpEarned: prev.vpEarned + (res?.data?.reward || REFERRAL_VP_REFERRER) }));
      showToast?.(`+${REFERRAL_VP_REFERRER.toLocaleString()} VP claimed! Your friend got ${REFERRAL_VP_REFEREE.toLocaleString()} VP too.`, 'success');
    } catch (err) {
      const msg = err?.message || 'Could not claim yet.';
      if (err?.code === 'already-exists' || /already/i.test(msg)) { setClaimedFriendIds(prev => [...prev, friendId]); showToast?.('Already claimed for this friend.', 'info'); }
      else showToast?.(msg, 'error');
    } finally { setClaimingId(null); }
  }, [claimingId, showToast]);

  const handleCopy = useCallback(() => { navigator.clipboard?.writeText(referralLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }, [referralLink]);
  const handleShare = (target) => { const url = target.url(referralLink); if (url) window.open(url, '_blank', 'noopener,noreferrer'); };
  const handleNativeShare = useCallback(async () => {
    if (navigator.share) { try { await navigator.share({ title: 'Join me on VERGR!', text: 'Sign up via my link and we both earn VP.', url: referralLink }); } catch {} }
    else handleCopy();
  }, [referralLink, handleCopy]);

  const RewardCard = ({ label, amount, color, description }) => (
    <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5">
      <p className="text-[10.5px] font-bold text-text-muted uppercase tracking-widest mb-3">{label}</p>
      <div className="flex items-center gap-3 mb-3">
        <VPIcon size={44} />
        <span className="text-3xl font-black tabular-nums" style={{ color }}>{amount.toLocaleString()} <span className="text-xl">VP</span></span>
      </div>
      <p className="text-text-muted text-sm leading-relaxed">{description}</p>
    </div>
  );
  const SidebarCard = ({ title, children }) => (
    <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5"><p className="font-semibold text-sm text-text-primary mb-3">{title}</p><div className="space-y-1">{children}</div></div>
  );

  return (
    <div className="min-h-screen pb-10">
      <TopBar title="Refer a Friend" showBack />
      <div className="px-4 py-5 space-y-5">
        <div className="relative rounded-2xl overflow-hidden min-h-[160px] bg-surface-1 border border-surface-3">
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/brand/refer-hero-bg.webp')" }} />
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(100deg, rgba(11,11,20,0.82) 0%, rgba(13,5,32,0.55) 45%, rgba(13,5,32,0.10) 100%)' }} />
          <div className="relative z-10 p-6"><h2 className="font-syne text-2xl font-black text-text-primary mb-2">Invite a friend, you both get VP</h2><p className="text-text-secondary text-sm">The more VP you have, the larger the share you keep of what your content earns.</p></div>
        </div>
        <InfoTooltip id="refer_vp_explainer" icon="diamond" color="#B44FFF" title="What's VP?">VP is your Vergr progression score. The higher your VP, the larger the revenue share you keep as a creator, and the faster your profile levels up.</InfoTooltip>
        <div className="grid grid-cols-1 gap-4">
          <RewardCard label="You Earn" amount={REFERRAL_VP_REFERRER} color="#B44FFF" description="Your friend signs up via your link and verifies a phone number. Then you come back here and claim 5,000 VP." />
          <RewardCard label="Friend Earns" amount={REFERRAL_VP_REFEREE} color="#3D7FFF" description="After your friend verifies a phone number, they automatically get 3,000 VP, no need to claim anything." />
        </div>
        <HowItWorksBanner />
        <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5">
          <p className="text-sm font-semibold text-text-primary mb-3">Your Invite Link</p>
          <div className="flex flex-col gap-2">
            <div className="bg-bg-dark border border-white/10 rounded-xl px-4 py-3 min-w-0"><span className="text-text-muted text-sm truncate block select-all font-dmmono">{referralLink}</span></div>
            <div className="flex gap-2">
              <button onClick={handleCopy} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm" style={{ background: copied ? 'rgba(123,31,255,0.20)' : 'rgba(180,79,255,0.12)', color: '#B44FFF', border: '1px solid rgba(180,79,255,0.40)' }}><Icon name={copied ? 'check' : 'content_copy'} size={16} />{copied ? 'Copied!' : 'Copy'}</button>
              <button onClick={handleNativeShare} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm bg-white/[0.04] border border-white/10 text-text-secondary"><Icon name="ios_share" size={16} /> Share</button>
            </div>
          </div>
        </div>
        <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5">
          <p className="text-sm font-semibold text-text-primary mb-4">Quick Share</p>
          <div className="flex flex-wrap gap-3">
            {SHARE_TARGETS.map(t => (<button key={t.id} onClick={() => handleShare(t)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border bg-bg-dark text-sm font-medium text-text-secondary" style={{ borderColor: t.accent }}><BrandGlyph id={t.id} />{t.label}</button>))}
          </div>
        </div>
        <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5">
          <p className="text-sm font-semibold text-text-primary mb-4">Your Invites</p>
          {loading ? <ListSkeleton rows={4} /> : invites.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center"><div className="w-16 h-16 rounded-full bg-brand-violet/10 flex items-center justify-center"><Icon name="group_add" size={28} className="text-brand-violet-light/70" /></div><p className="font-semibold text-text-secondary">No one has signed up via your link yet.</p><p className="text-text-muted text-sm">Share it with a friend to get started.</p></div>
          ) : (
            <div className="space-y-2">
              {invites.map(inv => (
                <div key={inv.uid} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03]">
                  {inv.avatar ? <img src={inv.avatar} alt={inv.displayName} className="w-9 h-9 rounded-full object-cover" /> : <div className="w-9 h-9 rounded-full bg-brand-violet/30 flex items-center justify-center"><Icon name="person" size={16} className="text-brand-violet-light" /></div>}
                  <div className="flex-1 min-w-0"><p className="font-semibold text-sm text-text-primary truncate"><UserName user={inv} masked /></p><p className="text-text-muted text-xs">{inv.verified ? 'Phone verified ✓' : 'Setup not finished'}</p></div>
                  {claimedFriendIds.includes(inv.uid) ? (
                    <span className="text-xs font-semibold text-brand-violet-light shrink-0">Claimed ✓</span>
                  ) : inv.verified ? (
                    <button onClick={() => handleClaimFriend(inv.uid)} disabled={claimingId === inv.uid}
                      className="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold active:scale-95 disabled:opacity-60"
                      style={{ background: 'linear-gradient(135deg, #7B1FFF, #C87FFF)', color: '#fff' }}>
                      {claimingId === inv.uid ? '...' : `Claim ${REFERRAL_VP_REFERRER.toLocaleString()} VP`}
                    </button>
                  ) : (
                    <span className="text-xs font-bold tabular-nums text-text-muted shrink-0">Pending</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5">
          <p className="font-syne text-lg font-bold text-text-primary mb-3">Some questions you might have</p>
          <div className="divide-y divide-white/[0.06]">
            {FAQS.map((f, i) => {
              const open = openFaq === i;
              return (
                <div key={i}>
                  <button onClick={() => setOpenFaq(open ? null : i)} className="w-full flex items-center gap-3 text-left py-3">
                    <span className="flex-1 text-sm font-semibold text-text-primary">{f.q}</span>
                    <Icon name={open ? 'expand_less' : 'expand_more'} size={20} className="text-text-muted shrink-0" />
                  </button>
                  {open && <p className="text-text-muted text-[13px] leading-relaxed pb-3 -mt-1 pr-6">{f.a}</p>}
                </div>
              );
            })}
          </div>
        </div>
        <SidebarCard title="Referral Stats">
          <StatRow icon="group" color="#B44FFF" label="Total Invites" value={loading ? '—' : stats.totalInvites} />
          <StatRow icon="how_to_reg" color="#22D17E" label="Successful Referrals" value={loading ? '—' : stats.successfulReferrals} />
          <StatRow icon="diamond" color="#B44FFF" label="VP Earned" value={loading ? '—' : `${stats.vpEarned.toLocaleString()} VP`} accent />
        </SidebarCard>
        <SidebarCard title="Bonus Rewards">
          {BONUS_MILESTONES.map((m, i) => (
            <div key={i} className="flex items-center gap-3 py-1.5"><div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${m.gold ? 'bg-brand-gold-light/15' : 'bg-brand-violet/15'}`}><Icon name={m.icon} size={14} className={m.gold ? 'text-brand-gold-light' : 'text-brand-violet-light'} /></div><span className="flex-1 text-text-secondary text-[12.5px]">{m.label}</span><span className={`text-[12.5px] font-bold tabular-nums shrink-0 ${m.gold ? 'text-brand-gold-light' : 'text-brand-violet-light'}`}>{m.reward}</span></div>
          ))}
        </SidebarCard>
        <SidebarCard title="Tips to Earn More">
          {REFERRAL_TIPS.map((tip, i) => (<div key={i} className="flex gap-3 py-2"><div className="w-8 h-8 rounded-full bg-brand-violet/20 flex items-center justify-center shrink-0"><Icon name={tip.icon} size={14} className="text-brand-violet-light" /></div><div className="min-w-0"><p className="text-sm font-semibold text-text-primary leading-snug">{tip.title}</p><p className="text-text-muted text-xs mt-0.5 leading-relaxed">{tip.body}</p></div></div>))}
        </SidebarCard>
      </div>
    </div>
  );
}
function StatRow({ icon, color, label, value, accent }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="flex items-center gap-2 text-text-secondary text-[12.5px]"><Icon name={icon} size={14} style={{ color }} />{label}</span>
      <span className="font-bold tabular-nums text-[12.5px]" style={accent ? { color } : undefined}>{value}</span>
    </div>
  );
}

// ═══════════════════════════════════════ POST DETAIL

export function NativePostDetailScreen() {
  const { postId } = useParams();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const [showMediaPanel, setShowMediaPanel] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [uploading, setUploading] = useState(false);
  // B5: 1-level replies + comment likes (mirrors the web PostDetailScreen).
  const [replyingTo, setReplyingTo] = useState(null);
  const [reportingComment, setReportingComment] = useState(null);
  const [expandedReplies, setExpandedReplies] = useState(() => new Set());
  const [likedComments, setLikedComments] = useState(() => new Set());
  const [likeBusy, setLikeBusy] = useState(() => new Set());
  const inputRef = useRef(null);

  const threaded = useMemo(() => {
    const tops = [];
    const repliesByParent = new Map();
    for (const c of comments) {
      if (c.parentId) {
        if (!repliesByParent.has(c.parentId)) repliesByParent.set(c.parentId, []);
        repliesByParent.get(c.parentId).push(c);
      } else { tops.push(c); }
    }
    const ms = (c) => (c.createdAt?.toMillis ? c.createdAt.toMillis() : new Date(c.createdAt || 0).getTime());
    for (const arr of repliesByParent.values()) arr.sort((a, b) => ms(a) - ms(b));
    return tops.map(c => ({ ...c, replies: repliesByParent.get(c.id) || [] }));
  }, [comments]);
  const totalCount = comments.length;

  useEffect(() => {
    if (!postId) return;
    const load = async () => {
      setLoading(true);
      try {
        const postData = await getPostByIdOrSlug(postId);
        if (postData) { postData.author = await getUser(postData.authorId); setPost(postData); }
        const resolvedId = postData?.id || postId;
        const cmts = await getComments(resolvedId, 50);
        setComments(cmts);
        if (currentUser?.uid && cmts.length) {
          getLikedCommentIds(resolvedId, currentUser.uid, cmts.map(c => c.id)).then(setLikedComments).catch(() => {});
        }
      } catch (err) { console.error('Failed to load post:', err); }
      setLoading(false);
    };
    load();
  }, [postId]);

  const handleAddComment = async () => {
    if ((!input.trim() && !attachment) || posting || !currentUser) return;
    setPosting(true);
    const parentId = replyingTo?.id || null;
    const targetId = post?.id || postId;
    try {
      await addCommentToFirestore(targetId, currentUser.uid, input.trim(), attachment, parentId);
      const cmts = await getComments(targetId, 50);
      setComments(cmts);
      if (parentId) setExpandedReplies(prev => new Set(prev).add(parentId));
      setInput(''); setAttachment(null); setReplyingTo(null); setShowMediaPanel(null); setShowEmoji(false);
      if (!parentId) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 200);
    } catch (err) {
      // Say why. A comment refused by the owner's privacy setting used to fail
      // silently, leaving the user staring at their own text (audit A18).
      if (err?.code === COMMENT_BLOCKED) showToast(err.message, 'info');
      else showToast('Could not post your comment. Please try again.', 'error');
      console.error('Failed to add comment:', err);
    }
    setPosting(false);
  };

  const startReply = (comment, rootId = null) => {
    const name = comment.author?.displayName || comment.author?.username || 'User';
    setReplyingTo({ id: rootId || comment.id, name });
    setShowMediaPanel(null); setShowEmoji(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleToggleCommentLike = async (comment) => {
    if (!currentUser?.uid || likeBusy.has(comment.id)) return;
    const id = comment.id;
    const wasLiked = likedComments.has(id);
    setLikedComments(prev => { const n = new Set(prev); wasLiked ? n.delete(id) : n.add(id); return n; });
    setComments(prev => prev.map(c => c.id === id ? { ...c, likeCount: Math.max(0, (c.likeCount || 0) + (wasLiked ? -1 : 1)) } : c));
    setLikeBusy(prev => new Set(prev).add(id));
    try {
      await toggleCommentLike(post?.id || postId, id, currentUser.uid);
    } catch {
      setLikedComments(prev => { const n = new Set(prev); wasLiked ? n.add(id) : n.delete(id); return n; });
      setComments(prev => prev.map(c => c.id === id ? { ...c, likeCount: Math.max(0, (c.likeCount || 0) + (wasLiked ? 1 : -1)) } : c));
    } finally {
      setLikeBusy(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };
  const handleMediaSelect = (tab, url, item) => { const type = tab === 'clips' ? 'clip' : tab === 'stickers' ? 'sticker' : 'gif'; setAttachment({ type, url, thumbnailUrl: item?.preview || null }); setShowMediaPanel(null); };
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = '';
    setUploading(true);
    try { const { url } = await uploadMediaFile(file, 'comment_media'); setAttachment({ type: file.type.startsWith('video/') ? 'video' : 'image', url }); }
    catch (err) { console.error('Upload failed:', err); }
    setUploading(false);
  };
  const closeAllPickers = () => { setShowMediaPanel(null); setShowEmoji(false); };
  const renderCommentMedia = (comment) => {
    if (!comment.mediaUrl) return null;
    const t = comment.mediaType;
    if (t === 'video' || t === 'clip') return <div className="mt-2 rounded-xl overflow-hidden border border-white/[0.06] max-w-[260px]"><InlineVideoPlayer src={comment.mediaUrl} maxHeightClass="max-h-[260px]" objectFit="contain" /></div>;
    if (t === 'sticker') return <img src={comment.mediaUrl} alt="" className="mt-2 w-28 h-28 object-contain" />;
    return <div className="mt-2 rounded-xl overflow-hidden border border-white/[0.06] max-w-[260px]"><img src={comment.mediaUrl} alt="" className="w-full h-auto max-h-[260px] object-cover" loading="lazy" /></div>;
  };

  const renderCommentRow = (comment, { isReply = false, rootId = null } = {}) => {
    const realAuthor = comment.author;
    const author = applyVanguardMask(realAuthor, profile);
    const isMasked = !!author?.isVanguardPersona;
    const vRank = realAuthor?.vanguard?.rank;
    const liked = likedComments.has(comment.id);
    return (
      <div className="flex gap-3">
        <button onClick={() => navigate(`/user/${realAuthor?.id || comment.authorId}`)} className="shrink-0"><UserAvatar src={author?.avatar} size={isReply ? 30 : 36} /></button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-sm"><UserName user={author} masked fallback={'User'} /></span>
            {!isMasked && realAuthor?.isVerified && <span className="w-3.5 h-3.5 rounded-full bg-brand-violet flex items-center justify-center"><Icon name="check" size={9} className="text-white" /></span>}
            {vRank && <VanguardBadge rank={vRank} size={12} />}
            <span className="text-text-muted text-xs font-dmmono">{timeAgo(comment.createdAt?.toDate ? comment.createdAt.toDate() : comment.createdAt)}</span>
          </div>
          {comment.content && <p className="text-text-secondary text-sm break-words">{comment.content}</p>}
          {renderCommentMedia(comment)}
          <div className="flex items-center gap-4 mt-1.5">
            <button onClick={() => handleToggleCommentLike(comment)} className={`flex items-center gap-1 ${liked ? 'text-brand-ember' : 'text-text-muted active:text-brand-ember'}`}>
              <Icon name={liked ? 'favorite' : 'favorite_border'} size={14} filled={liked} /><span className="text-xs">{comment.likeCount || 0}</span>
            </button>
            <button onClick={() => startReply(comment, rootId)} className="text-text-muted text-xs">Reply</button>
            {currentUser && comment.authorId !== currentUser.uid && (
              <button onClick={() => setReportingComment(comment)} className="text-text-muted/60 text-xs active:text-brand-ember">Report</button>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (loading) return <div className="min-h-screen"><TopBar title="Post" showBack /><FeedSkeleton count={1} /></div>;
  if (!post) return <div className="min-h-screen"><TopBar title="Post" showBack /><div className="flex flex-col items-center py-20"><Icon name="error_outline" size={48} className="text-text-muted/30 mb-3" /><p className="text-text-muted text-sm">Post not found</p></div></div>;

  return (
    <div className="flex flex-col overflow-hidden fixed inset-0 z-30 bg-bg-dark">
      <TopBar title="Post" showBack />
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <PostCard post={post} onDeleted={() => navigate(-1)} />
        <div className="px-4 py-3 border-t border-white/[0.03]">
          <h3 className="font-syne font-bold text-sm mb-4">Comments {totalCount > 0 && `(${totalCount})`}</h3>
          {threaded.length === 0 ? (
            <div className="text-center py-8"><p className="text-text-muted text-sm">No comments yet. Be the first!</p></div>
          ) : (
            <div className="space-y-4">
              {threaded.map(comment => {
                const replies = comment.replies || [];
                const open = expandedReplies.has(comment.id);
                return (
                  <div key={comment.id} className="space-y-3">
                    {renderCommentRow(comment)}
                    {replies.length > 0 && (
                      <div className="ml-11 space-y-3">
                        <button onClick={() => setExpandedReplies(prev => { const n = new Set(prev); n.has(comment.id) ? n.delete(comment.id) : n.add(comment.id); return n; })} className="flex items-center gap-1.5 text-text-muted text-xs font-semibold active:text-text-secondary">
                          <span className="w-6 h-px bg-white/[0.12]" />
                          {open ? 'Hide replies' : `View ${replies.length} ${replies.length > 1 ? 'replies' : 'reply'}`}
                        </button>
                        {open && replies.map(r => <div key={r.id}>{renderCommentRow(r, { isReply: true, rootId: comment.id })}</div>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div ref={bottomRef} />
      </div>

      {showMediaPanel && <MediaPanel defaultTab={showMediaPanel} onSelect={handleMediaSelect} onClose={() => setShowMediaPanel(null)} />}
      {showEmoji && <EmojiPicker onSelect={(emoji) => setInput(prev => prev + emoji)} onClose={() => setShowEmoji(false)} />}

      <div className="shrink-0 glass-header border-t border-white/[0.04] px-2 pt-2 overflow-x-hidden" style={{ paddingBottom: 'calc(8px + env(safe-area-inset-bottom, 0px))' }}>
        {replyingTo && (
          <div className="flex items-center justify-between gap-2 mb-2 px-3 py-1.5 rounded-lg bg-surface-2 border border-white/[0.06]">
            <span className="text-xs text-text-muted truncate">Replying to <span className="text-text-secondary font-semibold">{replyingTo.name}</span></span>
            <button onClick={() => setReplyingTo(null)} className="w-5 h-5 rounded-full bg-black/40 flex items-center justify-center shrink-0"><Icon name="close" size={12} className="text-white" /></button>
          </div>
        )}
        {attachment && (
          <div className="flex items-center gap-2 mb-2 px-2">
            <div className="relative rounded-lg overflow-hidden border border-white/[0.08] max-w-[100px]">
              {attachment.type === 'video' || attachment.type === 'clip' ? <video src={attachment.url} muted className="w-20 h-20 object-cover bg-black" /> : <img src={attachment.thumbnailUrl || attachment.url} alt="" className="w-20 h-20 object-cover" />}
              <button onClick={() => setAttachment(null)} className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center"><Icon name="close" size={12} className="text-white" /></button>
            </div>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept="image/*,video/*" hidden onChange={handleFileSelect} />
        <div className="flex items-center gap-1.5">
          <UserAvatar src={profile?.avatar} size={32} />
          <div className="flex-1 min-w-0 flex items-center bg-surface-2 border border-white/[0.06] rounded-full focus-within:border-brand-violet/40">
            <button onClick={() => { const on = !showEmoji; closeAllPickers(); if (on) setShowEmoji(true); }} className="w-10 h-10 shrink-0 flex items-center justify-center"><Icon name={showEmoji ? 'keyboard' : 'sentiment_satisfied'} size={20} className={showEmoji ? 'text-brand-violet-light' : 'text-text-muted'} /></button>
            <input ref={inputRef} type="text" placeholder={replyingTo ? `Reply to ${replyingTo.name}...` : 'Add a comment...'} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddComment()} className="flex-1 bg-transparent py-2.5 pr-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none min-w-0" />
            <div className="flex items-center shrink-0 pr-1">
              <button onClick={() => { const on = !showMediaPanel; closeAllPickers(); if (on) setShowMediaPanel('gifs'); }} className="w-10 h-10 flex items-center justify-center" aria-label="GIFs, stickers and clips"><Icon name="gif_box" size={20} className={showMediaPanel ? 'text-brand-violet-light' : 'text-text-muted'} /></button>
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="w-10 h-10 flex items-center justify-center" aria-label="Add photo or video"><Icon name={uploading ? 'hourglass_empty' : 'image'} size={20} className="text-text-muted" /></button>
            </div>
          </div>
          <button onClick={handleAddComment} disabled={(!input.trim() && !attachment) || posting} className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${(input.trim() || attachment) && !posting ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-muted'}`}><Icon name={posting ? 'hourglass_empty' : 'send'} size={18} /></button>
        </div>
      </div>

      <ReportSheet open={!!reportingComment} title="Report Comment" onClose={() => setReportingComment(null)}
        onSubmit={(reason) => {
          const c = reportingComment;
          setReportingComment(null);
          if (!c || !currentUser) return;
          reportComment(currentUser.uid, post?.id || postId, c.id, reason)
            .then(() => showToast?.('Report submitted — our moderators will review it', 'success'))
            .catch(() => showToast?.('Could not submit report', 'error'));
        }} />
    </div>
  );
}
