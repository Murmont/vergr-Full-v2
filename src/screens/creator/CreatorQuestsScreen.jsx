// src/screens/creator/CreatorQuestsScreen.jsx
// Creator quests — VP rewards only (never coins) to protect the coin economy.
import { useState, useEffect, useMemo } from 'react';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import {
  claimQuestReward, getQuestClaims,
  claimMilestoneReward, getMilestoneClaims, getTournamentCoinsEarned,
} from '../../firebase/firestore';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { compactNum } from '../../components/creator/charts';

// Confetti micro-burst on claim. Raw DOM + WAAPI so it survives re-renders;
// skipped under prefers-reduced-motion.
const BURST_COLORS = ['#7B1FFF', '#B44FFF', '#C87FFF', '#F5C842', '#FFFFFF'];
function burstConfetti(el) {
  if (!el || typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  for (let i = 0; i < 12; i++) {
    const p = document.createElement('span');
    const size = 4 + Math.random() * 4;
    p.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;width:${size}px;height:${size}px;border-radius:${Math.random() > 0.5 ? '9999px' : '1px'};background:${BURST_COLORS[i % BURST_COLORS.length]};pointer-events:none;z-index:9999;`;
    document.body.appendChild(p);
    const ang = (Math.PI * 2 * i) / 12 + Math.random() * 0.6;
    const dist = 34 + Math.random() * 30;
    p.animate([
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist - 14}px)) scale(0.4) rotate(${Math.random() * 240 - 120}deg)`, opacity: 0 },
    ], { duration: 480 + Math.random() * 180, easing: 'cubic-bezier(0.2,0.8,0.3,1)' }).onfinish = () => p.remove();
  }
  // pop the claimed row/card itself
  const card = el.closest('[data-quest-card]');
  if (card) card.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }],
    { duration: 320, easing: 'ease-out' }
  );
}

// Daily quests — deliberately monochrome. VP is the only accent (violet); coins
// never appear here. No per-quest rainbow tones (looked toy-like).
const CREATOR_QUESTS = [
  { id: 'creator_post',     title: 'Post content',       desc: 'Create a post today',             vp: 30,  icon: 'edit' },
  { id: 'creator_stream',   title: 'Go Live',            desc: 'Stream for at least 30 minutes',  vp: 100, icon: 'podcasts' },
  { id: 'creator_engage',   title: 'Engage with fans',   desc: 'Reply to 5 comments',             vp: 25,  icon: 'forum' },
  { id: 'creator_collab',   title: 'Collaborate',        desc: 'Co-stream with another creator',  vp: 200, icon: 'diversity_3' },
  { id: 'creator_short',    title: 'Drop a Short',       desc: 'Publish a Short this week',       vp: 50,  icon: 'movie' },
  { id: 'creator_tierlist', title: 'Share a tier list',  desc: 'Create and publish a tier list',  vp: 40,  icon: 'format_list_numbered' },
  { id: 'creator_host_tournament', title: 'Host a tournament', desc: 'Create a tournament for your community', vp: 150, icon: 'emoji_events' },
];

// Leveled tournament-earnings ladder. Tracks REAL coins won in tournaments
// (summed from the ledger) and pays VP once per level, ever.
const EARN_TIERS = [
  { id: 'tourney_earn_5k',  coins: 5000,  vp: 200 },
  { id: 'tourney_earn_10k', coins: 10000, vp: 400 },
  { id: 'tourney_earn_25k', coins: 25000, vp: 800 },
  { id: 'tourney_earn_50k', coins: 50000, vp: 1500 },
];

// ── Tournament earnings tracker (hero) ──────────────────────────────────
function TournamentEarningTracker({ earned, claimed, claiming, onClaim }) {
  const total = EARN_TIERS[EARN_TIERS.length - 1].coins;
  // current level = highest tier whose threshold is reached
  const reachedIdx = EARN_TIERS.reduce((acc, t, i) => (earned >= t.coins ? i : acc), -1);
  const nextTier = EARN_TIERS[reachedIdx + 1] || null;
  const prevCoins = reachedIdx >= 0 ? EARN_TIERS[reachedIdx].coins : 0;
  const segLow = nextTier ? prevCoins : total;
  const segHigh = nextTier ? nextTier.coins : total;
  const segPct = nextTier
    ? Math.min(100, Math.max(0, ((earned - segLow) / (segHigh - segLow)) * 100))
    : 100;
  const overallPct = Math.min(100, (earned / total) * 100);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.12] via-amber-500/[0.04] to-transparent p-5 md:p-6">
      <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-amber-400/10 blur-3xl pointer-events-none" />
      <div className="relative flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] text-amber-400 font-bold mb-1">Tournament earnings</p>
          <div className="flex items-end gap-2">
            <span className="font-dmmono font-bold text-4xl md:text-5xl text-white tabular-nums leading-none">{compactNum(earned)}</span>
            <Icon name="paid" filled size={22} className="text-amber-400 mb-1" />
          </div>
          <p className="text-xs text-text-muted mt-1.5">
            {nextTier
              ? <>Win <span className="text-white font-semibold">{compactNum(segHigh - earned)}</span> more in tournaments to hit the next reward.</>
              : <>Top tier reached. You've earned every tournament VP reward.</>}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-dmmono font-bold text-2xl text-amber-400 leading-none">L{reachedIdx + 1}</p>
          <p className="text-[10px] uppercase tracking-widest text-text-muted mt-1">of {EARN_TIERS.length}</p>
        </div>
      </div>

      {/* Segment progress to next tier */}
      <div className="relative mb-5">
        <div className="h-3 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-300 transition-[width] duration-700 ease-out"
            style={{ width: `${nextTier ? segPct : overallPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-1.5 text-[11px] font-dmmono text-text-muted tabular-nums">
          <span>{compactNum(nextTier ? segLow : 0)}</span>
          <span className="text-amber-400 font-bold">{compactNum(earned)}</span>
          <span>{compactNum(segHigh)}</span>
        </div>
      </div>

      {/* Tier ladder */}
      <div className={`grid gap-2.5 ${IS_NATIVE_BUILD ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
        {EARN_TIERS.map((t, i) => {
          const reached = earned >= t.coins;
          const isClaimed = claimed.includes(t.id);
          const canClaim = reached && !isClaimed;
          return (
            <div key={t.id} data-quest-card
              className={`relative rounded-2xl border p-3 transition-colors ${
                isClaimed ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
                : canClaim ? 'border-amber-400/40 bg-amber-400/[0.08]'
                : reached ? 'border-white/10 bg-white/[0.03]'
                : 'border-white/[0.06] bg-white/[0.015]'
              }`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className={`font-dmmono font-bold text-sm tabular-nums ${reached ? 'text-white' : 'text-text-muted'}`}>
                  {compactNum(t.coins)}
                </span>
                <Icon
                  name={isClaimed ? 'check_circle' : reached ? 'lock_open' : 'lock'}
                  filled={isClaimed}
                  size={15}
                  className={isClaimed ? 'text-emerald-400' : reached ? 'text-amber-400' : 'text-text-muted'}
                />
              </div>
              <p className="font-dmmono font-bold text-brand-violet text-xs mb-2">+{t.vp} VP</p>
              {isClaimed ? (
                <span className="block text-center text-emerald-400 text-[11px] font-bold py-1">Claimed</span>
              ) : canClaim ? (
                <button onClick={(e) => onClaim(t, e.currentTarget)} disabled={claiming === t.id}
                  className="w-full py-1.5 rounded-lg bg-amber-400 text-bg-dark text-[11px] font-bold hover:brightness-110 transition disabled:opacity-60">
                  {claiming === t.id ? '...' : 'Claim'}
                </button>
              ) : (
                <span className="block text-center text-text-muted text-[11px] py-1">Locked</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Daily quest row (monochrome) ────────────────────────────────────────
function QuestRow({ quest, isClaimed, claiming, onClaim }) {
  return (
    <div data-quest-card className="flex items-center gap-3.5 p-4 rounded-2xl bg-white/[0.025] border border-white/[0.05] hover:border-white/[0.1] transition-colors">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${isClaimed ? 'bg-emerald-500/10' : 'bg-white/[0.05]'}`}>
        <Icon name={isClaimed ? 'check_circle' : quest.icon} filled={isClaimed} size={21}
          className={isClaimed ? 'text-emerald-400' : 'text-text-secondary'} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white">{quest.title}</p>
        <p className="text-xs text-text-muted">{quest.desc}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="font-dmmono font-bold text-brand-violet tabular-nums text-sm">+{quest.vp} VP</p>
        {isClaimed ? (
          <span className="text-emerald-400 text-[11px] font-bold">Done</span>
        ) : (
          <button onClick={(e) => onClaim(quest, e.currentTarget)} disabled={claiming === quest.id}
            className="mt-1.5 px-3.5 py-1 rounded-full bg-brand-violet text-white text-[11px] font-bold hover:brightness-110 transition disabled:opacity-60">
            {claiming === quest.id ? '...' : 'Claim'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function CreatorQuestsScreen({ embedded = false }) {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    if (embedded) return;
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop, embedded]);

  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const [claimed, setClaimed] = useState([]);
  const [milestonesClaimed, setMilestonesClaimed] = useState([]);
  const [tournamentCoins, setTournamentCoins] = useState(0);
  const [claiming, setClaiming] = useState(null);

  useEffect(() => {
    if (!currentUser) return;
    getQuestClaims(currentUser.uid).then(setClaimed).catch(console.error);
    getMilestoneClaims(currentUser.uid).then(setMilestonesClaimed).catch(console.error);
    getTournamentCoinsEarned(currentUser.uid).then(setTournamentCoins).catch(console.error);
  }, [currentUser]);

  const totalVpToday = useMemo(
    () => CREATOR_QUESTS.reduce((s, q) => s + q.vp, 0),
    []
  );
  const claimedVpToday = useMemo(
    () => CREATOR_QUESTS.filter(q => claimed.includes(q.id)).reduce((s, q) => s + q.vp, 0),
    [claimed]
  );

  const handleClaim = async (quest, btnEl) => {
    setClaiming(quest.id);
    try {
      await claimQuestReward(currentUser.uid, quest.id, quest.vp, quest.title);
      setClaimed(prev => [...prev, quest.id]);
      burstConfetti(btnEl);
      showToast(`+${quest.vp} VP`, 'success');
    } catch (err) {
      showToast(err.message?.includes('already') ? 'Already claimed' : 'Failed', 'error');
    }
    setClaiming(null);
  };

  const handleClaimMilestone = async (tier, btnEl) => {
    setClaiming(tier.id);
    try {
      await claimMilestoneReward(currentUser.uid, tier.id, tier.vp, `Tournament earnings ${compactNum(tier.coins)}`);
      setMilestonesClaimed(prev => [...prev, tier.id]);
      burstConfetti(btnEl);
      showToast(`+${tier.vp} VP`, 'success');
    } catch (err) {
      showToast(err.message?.includes('already') ? 'Already claimed' : 'Failed', 'error');
    }
    setClaiming(null);
  };

  const content = (
    <>
      {/* Header */}
      <div className="flex items-start gap-4 rounded-2xl border border-brand-violet/20 bg-gradient-to-br from-brand-violet/[0.12] to-transparent p-4 md:p-5 mb-5">
        <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
          <Icon name="military_tech" filled size={22} className="text-brand-violet" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-syne font-extrabold text-white text-base">Creator quests</h3>
          <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
            Quests pay <span className="text-brand-violet font-bold">Vergr Points</span> — they raise your creator rank and unlock perks. They never pay coins.
          </p>
        </div>
        <div className="hidden sm:block text-right shrink-0">
          <p className="font-dmmono font-bold text-brand-violet text-lg leading-none">{claimedVpToday}<span className="text-text-muted text-sm">/{totalVpToday}</span></p>
          <p className="text-[10px] uppercase tracking-widest text-text-muted mt-1">VP today</p>
        </div>
      </div>

      {/* Tournament earnings hero */}
      <TournamentEarningTracker
        earned={tournamentCoins}
        claimed={milestonesClaimed}
        claiming={claiming}
        onClaim={handleClaimMilestone}
      />

      {/* Daily quests */}
      <div className="mt-6">
        <div className="flex items-end justify-between mb-3">
          <div>
            <h3 className="font-syne font-extrabold text-white text-base">Daily quests</h3>
            <p className="text-[11px] text-text-muted">Refreshes every 24 hours</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {CREATOR_QUESTS.map(quest => (
            <QuestRow key={quest.id} quest={quest}
              isClaimed={claimed.includes(quest.id)}
              claiming={claiming}
              onClaim={handleClaim} />
          ))}
        </div>
      </div>
    </>
  );

  if (embedded) return content;

  return (
    <div className={isDesktop ? "min-h-screen pb-8" : "screen-container min-h-screen pb-8"}>
      <TopBar title="Creator Quests" showBack />
      <div className="px-4 py-4">{content}</div>
    </div>
  );
}
