// src/screens/settings/VPRanksScreen.jsx
// Full 100-level VP ladder across 11 ranks. Shows user's current level,
// progress to next, commission / discount per level, and prestige info.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import TopBar from '../../components/TopBar';
import { useLayout } from '../../context/LayoutContext';
import { useUser } from '../../context/UserContext';
import useResponsive from '../../hooks/useResponsive';
import {
  VP_LEVELS, RANK_TIERS, MAX_VP_LEVEL, TOTAL_VP_TO_MAX,
  getVPLevel, getVPProgress, getNextVPLevel,
  PRESTIGE_REWARDS, PRESTIGE_MAX, PLAN_VP_MULTIPLIER,
} from '../../utils/vpSystem';
import { resolveTier } from '../../utils/tierSystem';
import RankCrest from '../../components/prestige/RankCrest';
import { RANK_VIEWS } from '../../components/prestige/prestigeData';

export default function VPRanksScreen() {
  const navigate = useNavigate();
  const { isMobile, isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();
  const { profile, wallet } = useUser();
  const [openRank, setOpenRank] = useState(null);

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  const totalVP = wallet?.vp || 0;
  const plan = resolveTier(profile);
  const currentLevel = getVPLevel(totalVP);
  const nextLevel = getNextVPLevel(totalVP);
  const progress = getVPProgress(totalVP);
  const prestige = profile?.prestige || 0;

  // Group 100 levels by rank
  const groupedRanks = useMemo(() => {
    return RANK_TIERS.map(rank => {
      const view = RANK_VIEWS.find(v => v.name === rank.name);
      const badges = view?.badges || [];
      return {
        ...rank,
        levels: VP_LEVELS.filter(l => l.level >= rank.min && l.level <= rank.max),
        // Highest crest of the band = the rank's emblem.
        badgeArt: badges.length ? badges[badges.length - 1].art : null,
      };
    });
  }, []);

  const fmt = (n) => n.toLocaleString();

  return (
    <div className="min-h-full flex flex-col pb-10">
      {isMobile && <TopBar title="VP Levels & Ranks" showBack />}
      {!isMobile && (
        <header className="flex items-center gap-3 px-5 pt-6 pb-4">
          <button onClick={() => navigate(-1)} className="text-white/80" aria-label="Back">
            <Icon name="arrow_back" size={24} />
          </button>
          <h1 className="text-white font-syne font-bold text-xl">VP Levels & Ranks</h1>
        </header>
      )}

      <main className={`flex-1 px-4 lg:px-6 ${isDesktop ? 'max-w-6xl' : ''}`}>
        <div className="lg:grid lg:grid-cols-2 lg:gap-4 lg:items-start">
        {/* Current status */}
        <div className="mb-6 p-5 rounded-2xl border border-white/[0.08] bg-surface-1">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-white font-black font-dmmono text-sm"
              style={{ background: `${currentLevel.ringColor}25`, border: `2px solid ${currentLevel.ringColor}` }}
            >
              {currentLevel.level}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-lg">{currentLevel.name}</p>
              <p className="text-text-secondary text-xs">
                Level {currentLevel.level}{prestige > 0 ? ` · Prestige ${prestige}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-text-secondary mb-1">
            <span>{fmt(totalVP)} VP</span>
            {nextLevel
              ? <span>Next: {nextLevel.name} · {fmt(nextLevel.vpRequired - totalVP)} to go</span>
              : <span>Max level reached</span>}
          </div>
          <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full transition-all"
              style={{ width: `${progress}%`, background: currentLevel.ringColor }}
            />
          </div>

          {plan !== 'free' && (
            <div className="mt-3 flex items-center gap-2 text-xs text-brand-violet-light">
              <Icon name="bolt" size={14} />
              <span>{plan.toUpperCase()} plan active — earning VP at {PLAN_VP_MULTIPLIER[plan]}× speed</span>
            </div>
          )}
        </div>

        {/* How it works */}
        <div className="mb-6 p-4 rounded-2xl border border-white/[0.06] bg-surface-1 text-xs text-text-secondary leading-relaxed">
          <p className="text-white font-semibold text-sm mb-1">How leveling works</p>
          <p>
            100 levels across 11 ranks. Each level costs 2,000 VP at the start, rising by 1,000 every 10 levels (11,000 per level from L91 to L100). Reaching L100 takes {fmt(TOTAL_VP_TO_MAX)} VP total. VP is a status ladder: it unlocks rings, badges and standing, and it never changes what a creator is paid.
          </p>
          <p className="mt-2">
            Earn VP from daily logins, quests, likes received, streaming, referrals, and more. Pro/Lite plans multiply all VP earnings (1.5× / 2×) so you rank up faster.
          </p>
        </div>
        </div>

        {/* Rank groups */}
        <p className="text-text-secondary text-xs uppercase tracking-wider font-bold mb-3">The 11 ranks</p>
        <div className="space-y-2 mb-8 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0 lg:items-start">
          {groupedRanks.map((rank) => {
            const firstLvl = rank.levels[0];
            const lastLvl = rank.levels[rank.levels.length - 1];
            const isUnlocked = currentLevel.level >= rank.min;
            const isActive = currentLevel.level >= rank.min && currentLevel.level <= rank.max;
            const isOpen = openRank === rank.name;

            return (
              <div
                key={rank.name}
                className="rounded-2xl border bg-surface-1 overflow-hidden"
                style={{ borderColor: isActive ? rank.ringColor : 'rgba(255,255,255,0.06)' }}
              >
                <button
                  onClick={() => setOpenRank(isOpen ? null : rank.name)}
                  className="w-full flex items-center gap-3 p-4 hover:bg-white/[0.02] transition-colors"
                >
                  {rank.badgeArt ? (
                    <div className="relative shrink-0">
                      <RankCrest art={rank.badgeArt} ringColor={rank.ringColor} size={46} locked={!isUnlocked} />
                      {!isUnlocked && (
                        <Icon name="lock" size={13} className="absolute -bottom-0.5 -right-0.5 text-white/70 bg-bg-dark rounded-full p-0.5" />
                      )}
                    </div>
                  ) : (
                    <div
                      className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center"
                      style={{
                        background: `${rank.ringColor}20`,
                        border: `2px solid ${isUnlocked ? rank.ringColor : 'rgba(255,255,255,0.1)'}`,
                        opacity: isUnlocked ? 1 : 0.5,
                      }}
                    >
                      <Icon name={isUnlocked ? 'verified' : 'lock'} size={18} style={{ color: isUnlocked ? rank.ringColor : '#ffffff66' }} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-white font-bold text-sm">{rank.name}</p>
                    <p className="text-text-secondary text-[11px]">
                      L{rank.min}–L{rank.max} · {Math.round(firstLvl.commission * 100)}% → {Math.round(lastLvl.commission * 100)}% commission
                    </p>
                  </div>
                  {isActive && (
                    <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full" style={{ background: `${rank.ringColor}25`, color: rank.ringColor }}>
                      Active
                    </span>
                  )}
                  <Icon name={isOpen ? 'expand_less' : 'expand_more'} size={20} className="text-text-secondary" />
                </button>

                {isOpen && (
                  <div className="border-t border-white/[0.06]">
                    <div className="grid grid-cols-[0.6fr_1fr_1fr] px-4 py-2 text-[10px] uppercase tracking-wider text-text-muted font-bold border-b border-white/[0.04]">
                      <span>Lvl</span>
                      <span className="text-right">VP to reach</span>
                      <span className="text-right">Commission</span>
                    </div>
                    {rank.levels.map((lvl) => {
                      const isCurrent = lvl.level === currentLevel.level;
                      const isReached = totalVP >= lvl.vpRequired;
                      return (
                        <div
                          key={lvl.level}
                          className={`grid grid-cols-[0.6fr_1fr_1fr] px-4 py-2 text-xs border-b border-white/[0.03] last:border-b-0 ${
                            isCurrent ? 'bg-white/[0.04]' : ''
                          }`}
                        >
                          <span className={`font-dmmono font-bold ${isCurrent ? 'text-white' : isReached ? 'text-text-primary' : 'text-text-muted'}`}>
                            L{lvl.level}{isCurrent && ' ←'}
                          </span>
                          <span className={`text-right font-dmmono ${isReached ? 'text-text-secondary' : 'text-text-muted'}`}>
                            {fmt(lvl.vpRequired)}
                          </span>
                          <span className="text-right text-text-primary">{Math.round(lvl.commission * 100)}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Prestige */}
        <p className="text-text-secondary text-xs uppercase tracking-wider font-bold mb-3">Prestige</p>
        <div className="mb-6 p-4 rounded-2xl border border-white/[0.06] bg-surface-1 text-xs text-text-secondary leading-relaxed">
          <p className="text-white font-semibold text-sm mb-1">After L100 — optional</p>
          <p className="mb-3">
            Hit Immortal (L100) and you can Prestige. Your displayed level resets to 1 with a prestige badge, while your lifetime VP, commission, and perks stay intact. Never forced — purely for bragging rights. Up to {PRESTIGE_MAX} prestiges.
          </p>
          <div className="space-y-1.5">
            {PRESTIGE_REWARDS.map((p) => {
              const isUnlocked = prestige >= p.prestige;
              return (
                <div key={p.prestige} className="flex items-center gap-3 py-1.5 border-t border-white/[0.04] first:border-t-0">
                  <span className="w-10 text-center text-base" style={{ color: isUnlocked ? '#F5C542' : '#ffffff33' }}>{p.badge}</span>
                  <span className={`flex-1 text-xs ${isUnlocked ? 'text-white' : 'text-text-muted'}`}>{p.title}</span>
                  <span className="text-[10px] text-text-muted font-dmmono">+{fmt(p.coinReward)} coins</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => navigate('/earn')}
            className="flex-1 py-3 rounded-xl bg-brand-violet text-white font-bold text-sm"
          >
            Earn VP
          </button>
          <button
            onClick={() => navigate('/settings/subscription')}
            className="flex-1 py-3 rounded-xl bg-surface-2 border border-white/[0.08] text-white font-bold text-sm"
          >
            Boost with a plan
          </button>
        </div>
      </main>
    </div>
  );
}
