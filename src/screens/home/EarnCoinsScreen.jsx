import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { getQuestClaims, getUserPosts, getFollowing, getTransactions } from '../../firebase/firestore';
import { StackSkeleton } from '../../components/skeletons/GlassSkeletons';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config';
import TopBar from '../../components/TopBar';
import CoinDisplay from '../../components/CoinDisplay';
import Icon from '../../components/Icon';
import { CoinIcon, VPIcon } from '../../components/CoinIcon';
import InfoTooltip from '../../components/InfoTooltip';
import WatchToEarnQuest from '../../components/WatchToEarnQuest';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { PLAN_VP_MULTIPLIER } from '../../utils/vpSystem';
import { resolveTier } from '../../utils/tierSystem';

// Watch-to-Earn lives ONLY on the Earn screen as a dedicated component
// (see <WatchToEarnQuest /> below). It is deliberately NOT added as a
// quest card here, because quest cards render on /earn and AdSense
// policy forbids mixing incentivised ad prompts with AdSense inventory
// — if the same screen ever showed an AdSense unit, the account could
// be banned. Keeping the two surfaces separate (AdSense everywhere
// except /earn, Watch-to-Earn only on /earn) is the safe split.
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
    { id: 'first_stream', title: 'Go Live', description: 'Broadcast your first live stream', reward: 100, currency: 'vp', target: 1, oneTime: true },
    // Profile-completion rewards (founder-approved 2026-07-09). Server
    // verifies the data exists (avatar set, bio length, etc.) and locks the
    // amount — claiming without the data returns a friendly error toast.
    { id: 'profile_avatar', title: 'Add a Profile Picture', description: 'Upload an avatar so gamers recognise you', reward: 500, currency: 'vp', target: 1, oneTime: true },
    { id: 'profile_banner', title: 'Add a Profile Banner', description: 'Give your profile header some art', reward: 300, currency: 'vp', target: 1, oneTime: true },
    { id: 'profile_bio', title: 'Write Your Bio', description: 'At least 20 characters about you', reward: 200, currency: 'vp', target: 1, oneTime: true },
    { id: 'profile_interests', title: 'Pick Your Interests', description: 'Choose 3+ game genres in onboarding or Edit Profile', reward: 200, currency: 'vp', target: 1, oneTime: true },
    { id: 'first_follow_5', title: 'Follow 5 Gamers', description: 'Fill your feed with people worth watching', reward: 300, currency: 'vp', target: 1, oneTime: true },
    { id: 'profile_gaming_link', title: 'Connect a Gaming Account', description: 'Link Twitch, Discord or Steam (Settings → Linked accounts), then claim', reward: 500, currency: 'vp', target: 1, oneTime: true },
    // Refer-a-Friend: reward is 5000 VP to the referrer, 3000 VP to the
    // invitee. Unlocks when the invitee (a) signed up via the referrer's
    // link, (b) added their phone number, and (c) either joined a squad or
    // subscribed to Lite/Pro. See claimQuestReward in functions/index.js.
    { id: 'refer_friend', title: 'Refer a Friend', description: 'Friend joins via your link and verifies a phone number — you earn 5000 VP, they earn 3000 VP', reward: 5000, currency: 'vp', target: 1, requiresFriend: true, external: true, externalRoute: '/earn/refer', externalLabel: 'Manage' },
    // Rewarded via the dedicated `savePhoneNumber` callable (functions/index.js).
    // The quest-claim doc key is `${uid}_add_phone` so the grid below can
    // detect it as already-claimed just like the other oneTime quests.
    { id: 'add_phone', title: 'Add Phone Number', description: 'Unlocks contact invites — open New Chat → ⋮ → Add phone number', reward: 1000, currency: 'vp', target: 1, oneTime: true, external: true, externalRoute: '/messages/new', externalLabel: 'Add' },
  ],
};

export default function EarnCoinsScreen() {
  const [activeTab, setActiveTab] = useState('daily');
  const [claimedIds, setClaimedIds] = useState([]);
  const [claiming, setClaiming] = useState(null);
  const [userActivity, setUserActivity] = useState({});
  const [loading, setLoading] = useState(true);
  const [todayEarned, setTodayEarned] = useState(0);

  const { currentUser } = useAuth();
  const { wallet, profile } = useUser();
  const plan = resolveTier(profile);
  const vpMultiplier = PLAN_VP_MULTIPLIER[plan] || 1;
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isMobile } = useResponsive();

  // Full‑width layout (like Settings)
  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => {
      setRightPanel(null);
      setContentAlign('center');
    };
  }, [setRightPanel, setContentAlign]);

  useEffect(() => {
    if (!currentUser) return;
    const load = async () => {
      setLoading(true);
      try {
        const [claims, posts, following, txs] = await Promise.all([
          getQuestClaims(currentUser.uid),
          getUserPosts(currentUser.uid, 10).catch(() => []),
          getFollowing(currentUser.uid, 50).catch(() => []),
          getTransactions(currentUser.uid, 50).catch(() => []),
        ]);
        setClaimedIds(claims);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Calculate today's earnings from actual transactions
        const earned = txs.filter(t => {
          if (t.amount <= 0) return false;
          const d = t.createdAt?.toDate ? t.createdAt.toDate() : new Date(t.createdAt);
          return d >= today;
        }).reduce((sum, t) => sum + (t.amount || 0), 0);
        setTodayEarned(earned);

        const weekStart = new Date(today);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());

        const todayPosts = posts.filter(p => {
          const d = p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt);
          return d >= today;
        }).length;

        const weekPosts = posts.filter(p => {
          const d = p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt);
          return d >= weekStart;
        }).length;

        setUserActivity({
          daily_login: 1,
          daily_post: todayPosts,
          daily_like: 0,
          daily_squad_msg: 0,
          weekly_posts: weekPosts,
          weekly_follow: following.length,
          weekly_streak: 1,
          refer_friend: 0,
          first_squad: 0,
          first_stream: 0,
        });
      } catch (err) {
        console.error('Failed to load earn data:', err);
      }
      setLoading(false);
    };
    load();
  }, [currentUser]);

  const handleClaim = useCallback(async (quest) => {
    if (claiming || claimedIds.includes(quest.id)) return;
    setClaiming(quest.id);
    try {
      await httpsCallable(functions, 'claimQuestReward')({ questId: quest.id, reward: quest.reward, title: quest.title });
      setClaimedIds(prev => [...prev, quest.id]);
      showToast(`+${quest.reward} ${quest.currency === "coins" ? "coins" : "VP"} earned!`, quest.currency === "coins" ? "coins" : "success");
    } catch (err) {
      if (err.code === 'functions/already-exists' || err.message?.includes('already claimed')) {
        showToast('Already claimed today', 'info');
        setClaimedIds(prev => [...prev, quest.id]);
      } else {
        showToast('Failed to claim reward', 'error');
        console.error(err);
      }
    }
    setClaiming(null);
  }, [claiming, claimedIds, currentUser, showToast]);

  const quests = QUEST_DEFS[activeTab] || [];

  const EARN_METHODS = [
    { img: '/brand/earn/quest-daily.webp', bg: '/brand/earn/bg-daily.webp', icon: 'star', title: 'Daily Quests', desc: 'Complete tasks for VP', reward: '15-30 VP/day', color: 'text-brand-violet', action: () => setActiveTab('daily') },
    { img: '/brand/earn/quest-streak.webp', bg: '/brand/earn/bg-streak.webp', icon: 'login', title: '5-Day Streak', desc: 'Log in 5 days straight', reward: '5 coins + 50 VP', color: 'text-brand-gold', action: () => navigate('/') },
    { img: '/brand/earn/quest-phone.webp', bg: '/brand/earn/bg-phone.webp', icon: 'phone', title: 'Add Phone Number', desc: 'Unlock contact invites', reward: '1000 VP', color: 'text-brand-violet-light', action: () => navigate('/messages/new') },
    { img: '/brand/earn/quest-tournaments.webp', bg: '/brand/earn/bg-tournaments.webp', icon: 'live_tv', title: 'Go Live', desc: 'Stream and receive tips from viewers', reward: 'Coins + VP', color: 'text-brand-ember', action: () => navigate('/go-live') },
    { img: '/brand/earn/quest-refer.webp', bg: '/brand/earn/bg-refer.webp', icon: 'person_add', title: 'Refer Friends', desc: 'Invite a friend who sets up properly', reward: '5000 VP (+3000 VP for them)', color: 'text-brand-pink', action: () => setActiveTab('special') },
    { img: '/brand/earn/quest-levelup.webp', bg: '/brand/earn/bg-levelup.webp', icon: 'trending_up', title: 'Level Up', desc: 'Rings, badges and standing as you rank up', reward: 'Ranks 1–100', color: 'text-brand-gold', action: () => navigate('/settings/ranks') },
    { bg: '/brand/earn/bg-liteplans.webp', icon: 'workspace_premium', title: 'Lite / Pro Plans', desc: '1.5×/2× VP + monthly VP & coins', reward: '+1k–3k VP / mo', color: 'text-brand-violet', action: () => navigate('/settings/subscription') },
  ];

  return (
    <div className="min-h-full">
      {/* Mobile header */}
      {isMobile && <TopBar title="Earn Coins" showBack actions={<CoinDisplay amount={wallet?.balance || 0} />} />}

      {/* Desktop header – with right padding to avoid notification icon overlap */}
      {!isMobile && (
        <div className="flex items-center justify-between px-4 lg:px-6 pt-4 pr-12 lg:pr-16">
          <button onClick={() => navigate(-1)} className="text-white/80 hover:text-white transition-colors" aria-label="Go back">
            <Icon name="arrow_back" size={24} />
          </button>
          <CoinDisplay amount={wallet?.balance || 0} />
        </div>
      )}

      {/* Hero card */}
      <div className="mx-4 lg:mx-6 mt-2 p-5 rounded-2xl bg-surface-1 border border-white/[0.06] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-brand-violet/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="relative z-10">
          <p className="text-text-secondary text-xs uppercase tracking-wider font-bold mb-2">How You Earn</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-surface-2/50 text-center">
              <Icon name="star" size={20} className="text-brand-violet mx-auto mb-1" />
              <p className="text-brand-violet text-lg font-black font-dmmono">{wallet?.vp || 0}</p>
              <p className="text-text-secondary text-[9px]">VP (levels + perks)</p>
            </div>
            <div className="p-3 rounded-xl bg-surface-2/50 text-center">
              <div className="mx-auto mb-1 w-fit"><VPIcon size={20} /></div>
              <p className="text-brand-violet-light text-lg font-black font-dmmono">{wallet?.totalEarnedCoinsGross || 0}</p>
              <p className="text-text-secondary text-[9px]">Coins earned</p>
            </div>
            <div className="p-3 rounded-xl bg-surface-2/50 text-center">
              <div className="mx-auto mb-1 w-fit"><CoinIcon size={20} /></div>
              <p className="text-brand-gold text-lg font-black font-dmmono">{wallet?.balance || 0}</p>
              <p className="text-text-secondary text-[9px]">Coins (spendable)</p>
            </div>
          </div>
          <p className="text-text-primary text-[10px] mt-3 text-center">Quests earn VP · Tips and memberships earn coins · Referrals earn VP for both of you</p>
          {vpMultiplier > 1 && (
            <button
              onClick={() => navigate('/settings/subscription')}
              className="mt-3 w-full flex items-center justify-center gap-2 text-[11px] font-semibold py-1.5 rounded-full bg-brand-violet/15 border border-brand-violet/30 text-brand-violet-light"
            >
              <Icon name="bolt" size={14} />
              {plan.toUpperCase()} active — {vpMultiplier}× VP on every action
            </button>
          )}
          {vpMultiplier === 1 && (
            <button
              onClick={() => navigate('/settings/subscription')}
              className="mt-3 w-full relative overflow-hidden rounded-xl border border-brand-violet/40 hover:border-brand-violet/70 transition-colors group"
              style={{ background: 'linear-gradient(90deg, #2b1052 0%, #1c0b33 32%, #1a0a2f 68%, #3a0f3f 100%)' }}
            >
              {/* Side art rendered at full height (never cropped); hidden on narrow screens */}
              <img src="/brand/earn/cta-left.webp" alt="" className="hidden sm:block absolute left-0 inset-y-0 h-full w-auto pointer-events-none select-none" draggable={false}
                style={{ maskImage: 'linear-gradient(to right, black 55%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, black 55%, transparent 100%)' }} />
              <img src="/brand/earn/cta-right.webp" alt="" className="hidden sm:block absolute right-0 inset-y-0 h-full w-auto pointer-events-none select-none" draggable={false}
                style={{ maskImage: 'linear-gradient(to left, black 55%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to left, black 55%, transparent 100%)' }} />
              <div className="relative z-10 flex flex-col items-center justify-center py-4 px-16">
                <p className="text-white text-sm font-syne font-bold flex items-center gap-1.5 drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
                  <Icon name="workspace_premium" size={16} className="text-brand-violet-light" />
                  Upgrade to Lite / Pro
                </p>
                <p className="text-white/85 text-[10px] mt-0.5 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">1.5× / 2× VP on every action you take</p>
              </div>
            </button>
          )}
        </div>
      </div>

      {/* Watch-to-Earn daily quest (PropellerAds Direct Link) */}
      <WatchToEarnQuest />

      <div className="mx-4 lg:mx-6 mt-3">
        <InfoTooltip id="earn_intro" icon="diamond" color="#B44FFF" title="How earning works on VERGR" rightImage="/brand/earn/icon-real-money.webp">
          Receive tips, memberships, and paid-stream access. That is revenue VERGR earns, and VERGR pays you a share of it on a schedule.
          Complete quests, refer friends, and level up to earn <strong>VP</strong> — this levels up your profile and unlocks rings, badges and perks.
        </InfoTooltip>
      </div>

      {/* Two‑column layout on desktop */}
      {isMobile ? (
        // Mobile: stack sections vertically
        <>
          <div className="px-4 mt-6">
            <h3 className="font-syne font-bold text-lg mb-3">Ways to Earn</h3>
            <div className="grid grid-cols-2 gap-3">
              {EARN_METHODS.map((method, i) => (
                <button key={i} onClick={method.action}
                  className="relative overflow-hidden p-3 rounded-2xl border border-white/[0.08] bg-surface-1 text-left hover:border-white/[0.16] transition-colors"
                  style={{ backgroundImage: `url('${method.bg}')`, backgroundSize: 'auto 100%', backgroundPosition: 'right center', backgroundRepeat: 'no-repeat' }}>
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B14]/95 via-[#0B0B14]/70 to-[#0B0B14]/35" />
                  <div className="relative z-10">
                    {method.img
                      ? <img src={method.img} alt="" className="w-11 h-11 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)] pointer-events-none select-none" draggable={false} />
                      : <div className="w-11 h-11 rounded-xl bg-white/[0.08] border border-white/[0.1] flex items-center justify-center"><Icon name={method.icon} filled size={24} className={method.color} /></div>}
                    <p className="text-text-primary text-sm font-semibold mt-2 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">{method.title}</p>
                    <p className="text-white/65 text-xs mt-0.5 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">{method.desc}</p>
                    <p className="text-brand-gold text-xs font-dmmono mt-2 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">{method.reward}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="px-4 mt-6">
            <h3 className="font-syne font-bold text-lg mb-3">Active Quests</h3>
            <div className="flex gap-2 mb-4">
              {['daily', 'weekly', 'special'].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold capitalize transition-all ${
                    activeTab === tab ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-secondary'
                  }`}>
                  {tab}
                </button>
              ))}
            </div>
            {loading ? (
              <StackSkeleton rows={3} height={56} />
            ) : (
              <div className="space-y-3">
                {quests.map(quest => {
                  const progress = userActivity[quest.id] || 0;
                  const completed = progress >= quest.target || quest.checkAuto;
                  const claimed = claimedIds.includes(quest.id);

                  return (
                    <div key={quest.id} className="flex items-center gap-3 p-4 rounded-2xl border border-white/[0.06] bg-surface-1">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${completed ? 'bg-brand-violet/10' : 'bg-surface-3'}`}>
                        <Icon name={completed ? 'check_circle' : 'radio_button_unchecked'} filled={completed} size={22}
                          className={completed ? 'text-brand-violet-light' : 'text-text-muted'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-text-primary">{quest.title}</p>
                        <p className="text-xs text-text-muted">{quest.description}</p>
                        {!completed && (
                          <>
                            <div className="w-full h-1.5 bg-surface-3 rounded-full mt-2 overflow-hidden">
                              <div className="h-full bg-brand-violet rounded-full transition-all" style={{ width: `${Math.min((progress / quest.target) * 100, 100)}%` }} />
                            </div>
                            <p className="text-xs text-text-muted font-dmmono mt-1">{progress}/{quest.target}</p>
                          </>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-xs font-dmmono font-bold ${quest.currency === "coins" ? "text-brand-gold" : "text-brand-violet"}`}>{quest.currency === "coins" ? "●" : "★"} {quest.reward} {quest.currency === "coins" ? "" : "VP"}</p>
                        {completed && !claimed && (
                          <button
                            onClick={() => handleClaim(quest)}
                            disabled={claiming === quest.id}
                            className="mt-1 px-3 py-1 rounded-full bg-brand-gold text-bg-dark text-xs font-bold hover:brightness-110 active:scale-95 transition-all">
                            {claiming === quest.id ? '...' : 'Claim'}
                          </button>
                        )}
                        {claimed && <span className="text-brand-violet-light text-xs font-semibold">Claimed ✓</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        // Desktop: two columns with full width — both columns stretch to the
        // same height (cards/quest rows flex-grow to fill the grid row)
        <div className="px-4 lg:px-6 mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
          {/* Left column: Ways to Earn */}
          <div className="lg:col-span-1 flex flex-col">
            <h3 className="font-syne font-bold text-lg mb-3 shrink-0">Ways to Earn</h3>
            <div className="flex-1 flex flex-col gap-3">
              {EARN_METHODS.map((method, i) => (
                <button key={i} onClick={method.action}
                  className="w-full flex-1 min-h-[84px] relative overflow-hidden px-4 py-3 rounded-2xl border border-white/[0.08] bg-surface-1 text-left hover:border-white/[0.16] transition-colors"
                  style={{ backgroundImage: `url('${method.bg}')`, backgroundSize: 'auto 100%', backgroundPosition: 'right center', backgroundRepeat: 'no-repeat' }}>
                  <div className="absolute inset-0 bg-gradient-to-r from-[#0B0B14]/95 via-[#0B0B14]/60 to-[#0B0B14]/10" />
                  <div className="relative z-10 flex items-center gap-3 h-full">
                    {method.img
                      ? <img src={method.img} alt="" className="w-12 h-12 shrink-0 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)] pointer-events-none select-none" draggable={false} />
                      : <div className="w-12 h-12 rounded-xl bg-white/[0.08] border border-white/[0.1] flex items-center justify-center shrink-0"><Icon name={method.icon} filled size={26} className={method.color} /></div>}
                    <div className="min-w-0">
                      <p className="text-text-primary text-base font-semibold drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">{method.title}</p>
                      <p className="text-white/65 text-xs mt-0.5 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">{method.desc}</p>
                      <p className="text-brand-gold text-xs font-dmmono mt-1.5 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">{method.reward}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right column: Active Quests */}
          <div className="lg:col-span-2 flex flex-col">
            <h3 className="font-syne font-bold text-lg mb-3 shrink-0">Active Quests</h3>
            <div className="flex gap-2 mb-4 shrink-0">
              {['daily', 'weekly', 'special'].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`px-4 py-2 rounded-full text-xs font-semibold capitalize transition-all ${
                    activeTab === tab ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-secondary'
                  }`}>
                  {tab}
                </button>
              ))}
            </div>
            {loading ? (
              <StackSkeleton rows={3} height={56} />
            ) : (
              <div className="flex-1 flex flex-col gap-4">
                {quests.map(quest => {
                  const progress = userActivity[quest.id] || 0;
                  const completed = progress >= quest.target || quest.checkAuto;
                  const claimed = claimedIds.includes(quest.id);

                  return (
                    <div key={quest.id} className="flex-1 min-h-[96px] flex items-center gap-4 p-4 rounded-2xl border border-white/[0.06] bg-surface-1">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${completed ? 'bg-brand-violet/10' : 'bg-surface-3'}`}>
                        <Icon name={completed ? 'check_circle' : 'radio_button_unchecked'} filled={completed} size={26}
                          className={completed ? 'text-brand-violet-light' : 'text-text-muted'} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-semibold text-text-primary">{quest.title}</p>
                        <p className="text-sm text-text-muted">{quest.description}</p>
                        {!completed && (
                          <>
                            <div className="w-full h-2 bg-surface-3 rounded-full mt-3 overflow-hidden">
                              <div className="h-full bg-brand-violet rounded-full transition-all" style={{ width: `${Math.min((progress / quest.target) * 100, 100)}%` }} />
                            </div>
                            <p className="text-xs text-text-muted font-dmmono mt-1">{progress}/{quest.target}</p>
                          </>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-dmmono font-bold ${quest.currency === "coins" ? "text-brand-gold" : "text-brand-violet"}`}>{quest.currency === "coins" ? "●" : "★"} {quest.reward} {quest.currency === "coins" ? "" : "VP"}</p>
                        {quest.external && !claimed && (
                          <button
                            onClick={() => navigate(quest.externalRoute || '/messages/new')}
                            className="mt-2 px-4 py-1.5 rounded-full bg-brand-violet text-white text-xs font-bold hover:brightness-110 active:scale-95 transition-all">
                            {quest.externalLabel || 'Open'}
                          </button>
                        )}
                        {!quest.external && completed && !claimed && (
                          <button
                            onClick={() => handleClaim(quest)}
                            disabled={claiming === quest.id}
                            className="mt-2 px-4 py-1.5 rounded-full bg-brand-gold text-bg-dark text-xs font-bold hover:brightness-110 active:scale-95 transition-all">
                            {claiming === quest.id ? '...' : 'Claim'}
                          </button>
                        )}
                        {claimed && <span className="text-brand-violet-light text-xs font-semibold">Claimed ✓</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-4 shrink-0 p-4 rounded-2xl border border-white/[0.06] bg-surface-1 grid grid-cols-3 gap-3">
              <div className="flex flex-col items-center text-center gap-1.5">
                <div className="w-10 h-10 rounded-xl bg-brand-violet/15 flex items-center justify-center"><Icon name="trending_up" size={20} className="text-brand-violet-light" /></div>
                <p className="text-text-primary text-xs font-semibold">Earn More</p>
                <p className="text-text-muted text-[10px] leading-snug">Level up to unlock higher rewards</p>
              </div>
              <div className="flex flex-col items-center text-center gap-1.5">
                <div className="w-10 h-10 rounded-xl bg-brand-violet/15 flex items-center justify-center"><Icon name="diamond" size={20} className="text-brand-violet-light" /></div>
                <p className="text-text-primary text-xs font-semibold">Revenue share</p>
                <p className="text-text-muted text-[10px] leading-snug">Vergr pays creators a share of what they make</p>
              </div>
              <div className="flex flex-col items-center text-center gap-1.5">
                <div className="w-10 h-10 rounded-xl bg-brand-gold/15 flex items-center justify-center"><Icon name="verified_user" size={20} className="text-brand-gold" /></div>
                <p className="text-text-primary text-xs font-semibold">Trusted & Secure</p>
                <p className="text-text-muted text-[10px] leading-snug">Verified platform. Fair play always.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}