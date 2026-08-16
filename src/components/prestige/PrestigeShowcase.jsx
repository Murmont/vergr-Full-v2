// The full /prestige experience, rendered identically on web + native.
// Sections: hero crest, what-is-VP, rank journey, per-rank perks, badge
// collection, how-to-earn, prestige endgame, CTAs. Driven entirely by the
// real vpSystem + badgeSystem (no fake data). Props keep it context-free so
// both screen shells can pass their own wallet/profile/navigate.
import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import Icon from '../Icon';
import { VPIcon } from '../CoinIcon';
import { compactNum } from '../creator/charts';
import {
  getVPLevel, getNextVPLevel, getVPProgress,
  VP_ACTIONS, PLAN_VP_MULTIPLIER, MONTHLY_VP_BONUS,
  PRESTIGE_REWARDS, PRESTIGE_MAX, MAX_VP_LEVEL,
} from '../../utils/vpSystem';
import { getCurrentBadge, getCurrentRankProgress, getAllEarnedBadges } from '../../utils/badgeSystem';
import { RANK_VIEWS, getRankView, TOTAL_BADGES, EARN_ITEMS } from './prestigeData';
import ProgressRing from './ProgressRing';
import RankCrest from './RankCrest';
import RankJourneyTrack from './RankJourneyTrack';

const fade = {
  hidden: { opacity: 0, y: 16 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.4, ease: 'easeOut' } }),
};

function Section({ title, sub, children, i = 0 }) {
  return (
    <motion.section custom={i} variants={fade} initial="hidden" animate="show" className="mt-7">
      {title && <h2 className="font-syne font-bold text-lg text-white">{title}</h2>}
      {sub && <p className="text-text-secondary text-xs mt-0.5 mb-3">{sub}</p>}
      {!sub && title && <div className="mb-3" />}
      {children}
    </motion.section>
  );
}

const TABS = [
  { id: 'what', label: 'What is VP?' },
  { id: 'journey', label: 'Your journey' },
  { id: 'unlock', label: 'What you unlock' },
  { id: 'badges', label: 'Your badges' },
  { id: 'earn', label: 'How to earn' },
  { id: 'prestige', label: 'Prestige' },
];

export default function PrestigeShowcase({ totalVP = 0, plan = 'free', prestige = 0, navigate }) {
  const current = getVPLevel(totalVP);
  const next = getNextVPLevel(totalVP);
  const progress = getVPProgress(totalVP);
  const rankView = getRankView(current.level);
  const heroBadge = getCurrentBadge(current.level);
  const { tiers: rankBadges } = getCurrentRankProgress(current.level);
  const earnedCount = getAllEarnedBadges(current.level).length;
  const accent = rankView.ringColor;
  const isMax = current.level >= MAX_VP_LEVEL;
  const mult = PLAN_VP_MULTIPLIER[plan] || 1;

  const [selectedId, setSelectedId] = useState(rankView.id);
  const [tab, setTab] = useState('what');
  const perkRefs = useRef({});
  const selectRank = (id) => {
    setSelectedId(id);
    setTab('unlock'); // perks live on the "What you unlock" tab
    setTimeout(() => perkRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };
  useEffect(() => { setSelectedId(rankView.id); }, [rankView.id]);

  const fmtPct = (n) => `${Math.round(n * 100)}%`;

  return (
    <div className="relative">
      <style>{`
        @keyframes prestige-aurora { 0%{transform:translate(-12%,-8%) scale(1)} 50%{transform:translate(12%,10%) scale(1.25)} 100%{transform:translate(-12%,-8%) scale(1)} }
        @keyframes prestige-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes prestige-pulse { 0%,100%{filter:drop-shadow(0 0 0 transparent)} 50%{filter:drop-shadow(0 0 9px currentColor)} }
        .prestige-aurora{animation:prestige-aurora 14s ease-in-out infinite}
        .prestige-float{animation:prestige-float 3.2s ease-in-out infinite}
        .prestige-pulse{animation:prestige-pulse 2.2s ease-in-out infinite}
        @media (prefers-reduced-motion: reduce){.prestige-aurora,.prestige-float,.prestige-pulse{animation:none!important}}
      `}</style>

      {/* ── HERO ── */}
      <motion.div
        variants={fade} initial="hidden" animate="show"
        className="relative overflow-hidden rounded-3xl border p-6"
        style={{ borderColor: `${accent}40`, background: `linear-gradient(160deg, ${accent}1A, rgba(20,20,31,0.6) 55%)` }}
      >
        <div className="prestige-aurora absolute -inset-1/4 pointer-events-none"
             style={{ background: `radial-gradient(circle at 30% 30%, ${accent}33, transparent 55%)` }} />
        <div className="relative flex flex-col items-center text-center">
          <ProgressRing size={208} progress={isMax ? 100 : progress} color={accent}>
            <RankCrest art={heroBadge.art} ringColor={accent} size={150} animated={rankView.animated} />
          </ProgressRing>

          <div className="mt-4 flex items-center gap-2">
            <span className="font-syne font-black text-2xl" style={{ color: accent }}>{rankView.name}</span>
            {prestige > 0 && (
              <span className="flex items-center gap-0.5 text-brand-gold-light text-sm" title={`Prestige ${prestige}`}>
                {Array.from({ length: Math.min(prestige, 5) }).map((_, i) => <Icon key={i} name="star" filled size={15} />)}
                {prestige > 5 && <span className="font-dmmono text-xs">×{prestige}</span>}
              </span>
            )}
          </div>
          <p className="text-text-secondary text-sm mt-0.5">
            Level <span className="font-dmmono font-bold text-white">{current.level}</span>
            {prestige > 0 && <> · Prestige {prestige}</>}
          </p>

          <div className="mt-3 flex items-center gap-2">
            <VPIcon size={22} />
            <span className="font-dmmono font-bold tabular-nums text-xl text-white">{totalVP.toLocaleString()}</span>
            <span className="text-text-muted text-sm">VP</span>
          </div>
          <p className="text-xs text-text-secondary mt-1">
            {isMax
              ? 'Max rank reached. You are Immortal.'
              : <>{(next.vpRequired - totalVP).toLocaleString()} VP to Level {next.level} ({RANK_VIEWS.find(r => next.level >= r.min && next.level <= r.max)?.name})</>}
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <span className="px-3 py-1 rounded-full text-xs font-semibold" style={{ background: `${accent}22`, color: accent }}>
              {fmtPct(current.commission)} commission
            </span>
            {mult > 1 && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-brand-violet/20 text-brand-violet-light flex items-center gap-1">
                <Icon name="bolt" size={13} /> {mult}× VP ({plan.toUpperCase()})
              </span>
            )}
          </div>
        </div>
      </motion.div>

      {/* ── TABS ── */}
      <div className="mt-6 -mx-4 px-4 overflow-x-auto no-scrollbar">
        <div className="flex gap-1 min-w-max border-b border-white/[0.08]">
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="relative px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors hover:text-white"
                style={{ color: on ? accent : '#9CA3AF' }}
              >
                {t.label}
                {on && <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full" style={{ background: accent }} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── WHAT IS VP ── */}
      {tab === 'what' && (
      <Section title="What is VP?" sub="Vergr Points are your reputation. One of three currencies, earned by being active." i={1}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { icon: 'trending_up', title: 'Earned by playing', text: 'Posting, winning matches, streaming, quests and daily logins all award VP.' },
            { icon: 'military_tech', title: 'Drives your rank', text: 'VP unlocks 100 levels across 11 ranks, each with its own badge to collect.' },
            { icon: 'savings', title: 'Unlocks real perks', text: 'Higher ranks cut your platform commission, so you keep more gems on every coin converted.' },
          ].map((c) => (
            <div key={c.title} className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2" style={{ background: `${accent}1F`, color: accent }}>
                <Icon name={c.icon} size={20} />
              </div>
              <p className="font-semibold text-sm text-white">{c.title}</p>
              <p className="text-xs text-text-secondary mt-1 leading-relaxed">{c.text}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-text-muted mt-2">VP is not money and cannot be spent, converted or cashed. It is purely status, perks and progression.</p>
      </Section>
      )}

      {/* ── RANK JOURNEY ── */}
      {tab === 'journey' && (
      <Section title="Your journey" sub="11 ranks from Rookie to Immortal. Tap a rank to see what it unlocks." i={2}>
        <div className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
          <RankJourneyTrack currentLevel={current.level} selectedId={selectedId} onSelect={selectRank} />
        </div>
      </Section>
      )}

      {/* ── PER-RANK PERKS ── */}
      {tab === 'unlock' && (
      <Section title="What you unlock" sub="Every rank lowers your commission and adds perks. Locked badges are silhouettes." i={3}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {RANK_VIEWS.map((r) => {
            const reached = current.level >= r.min;
            const isActive = current.level >= r.min && current.level <= r.max;
            const isSelected = selectedId === r.id;
            return (
              <div
                key={r.id}
                ref={(el) => { perkRefs.current[r.id] = el; }}
                className="p-4 rounded-2xl border transition-all"
                style={{
                  borderColor: isSelected || isActive ? r.ringColor : 'rgba(255,255,255,0.06)',
                  background: isActive ? `${r.ringColor}12` : 'var(--surface-1, #14141F)',
                  opacity: reached ? 1 : 0.85,
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    {r.badges.map((b) => (
                      <RankCrest key={b.label} art={b.art} ringColor={r.ringColor} size={40} locked={current.level < b.min} glow={false} />
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-syne font-bold text-sm" style={{ color: reached ? r.ringColor : '#9CA3AF' }}>{r.name}</span>
                      {isActive && <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${r.ringColor}25`, color: r.ringColor }}>You</span>}
                      {!reached && <Icon name="lock" size={12} className="text-text-muted" />}
                    </div>
                    <p className="text-[11px] text-text-muted font-dmmono">L{r.min}{r.min !== r.max ? `-${r.max}` : ''} · {r.vpToEnter.toLocaleString()} VP</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  <Perk icon="percent" text={`${fmtPct(r.commissionStart)}${r.commissionStart !== r.commissionEnd ? ` → ${fmtPct(r.commissionEnd)}` : ''} commission`} />
                  <Perk icon="workspace_premium" text={`${r.badges.length} badge${r.badges.length > 1 ? 's' : ''}`} />
                </div>
              </div>
            );
          })}
        </div>
      </Section>
      )}

      {/* ── BADGE COLLECTION ── */}
      {tab === 'badges' && (
      <Section title="Your badges" sub={`${earnedCount} of ${TOTAL_BADGES} badges earned. Reach the next level to claim the next.`} i={4}>
        <div className="p-5 rounded-2xl bg-surface-1 border border-white/[0.06] flex items-center justify-center gap-5">
          {rankBadges.map((b) => (
            <div key={b.id} className="flex flex-col items-center gap-2">
              <RankCrest art={b.art} ringColor={accent} size={84} locked={!b.earned} animated={rankView.animated && b.earned} />
              <span className="text-[10px] font-dmmono" style={{ color: b.earned ? accent : '#6B7280' }}>
                {b.earned ? (b.isCurrent ? 'Current' : 'Earned') : `Lvl ${b.min}`}
              </span>
            </div>
          ))}
        </div>
      </Section>
      )}

      {/* ── HOW TO EARN ── */}
      {tab === 'earn' && (
      <Section title="How to earn VP" sub="Stack these up. Lite and Pro plans multiply every point you earn." i={5}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {EARN_ITEMS.map((e) => (
            <div key={e.key} className="p-3 rounded-2xl bg-surface-1 border border-white/[0.06] flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accent}1A`, color: accent }}>
                <Icon name={e.icon} size={17} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-text-secondary leading-tight truncate">{e.label}</p>
                <p className="font-dmmono font-bold text-sm text-white tabular-nums">{e.custom || `+${compactNum(VP_ACTIONS[e.key])} VP`}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 p-4 rounded-2xl border border-brand-violet/30 bg-brand-violet/10 flex items-start gap-3">
          <Icon name="bolt" size={20} className="text-brand-violet-light shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">Rank up faster with a plan</p>
            <p className="text-xs text-text-secondary mt-0.5">
              Lite earns {PLAN_VP_MULTIPLIER.lite}× VP (+{compactNum(MONTHLY_VP_BONUS.lite)} VP/mo), Pro earns {PLAN_VP_MULTIPLIER.pro}× VP (+{compactNum(MONTHLY_VP_BONUS.pro)} VP/mo).
            </p>
          </div>
        </div>

        <button
          onClick={() => navigate?.('/earn')}
          className="mt-3 w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2"
          style={{ background: accent, color: '#0B0B14' }}
        >
          <Icon name="task_alt" size={18} /> Go to quests and earn VP
        </button>
      </Section>
      )}

      {/* ── PRESTIGE ── */}
      {tab === 'prestige' && (
      <Section title="Prestige" sub={`Optional endgame after Level 100. Reset your displayed level for a permanent badge. Up to ${PRESTIGE_MAX} times.`} i={6}>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          {PRESTIGE_REWARDS.map((p) => {
            const unlocked = prestige >= p.prestige;
            return (
              <div key={p.prestige} className="p-3 rounded-2xl bg-surface-1 border text-center"
                   style={{ borderColor: unlocked ? '#F5C84266' : 'rgba(255,255,255,0.06)' }}>
                <p className="text-xl leading-none" style={{ color: unlocked ? '#F5C842' : '#ffffff33' }}>{p.badge}</p>
                <p className={`text-[11px] font-semibold mt-1.5 ${unlocked ? 'text-white' : 'text-text-muted'}`}>{p.title}</p>
                <p className="text-[10px] text-text-muted font-dmmono mt-0.5">+{compactNum(p.coinReward)}c</p>
              </div>
            );
          })}
        </div>
      </Section>
      )}

      {/* ── CTAs ── */}
      <div className="mt-7 flex gap-2.5">
        <button onClick={() => navigate?.('/earn')} className="flex-1 py-3 rounded-xl bg-brand-violet text-white font-bold text-sm">Earn VP</button>
        <button onClick={() => navigate?.('/settings/subscription')} className="flex-1 py-3 rounded-xl bg-surface-2 border border-white/[0.08] text-white font-bold text-sm">Boost with a plan</button>
      </div>
      <button onClick={() => navigate?.('/settings/ranks')} className="mt-2.5 w-full py-2.5 rounded-xl text-text-secondary hover:text-white text-xs font-semibold flex items-center justify-center gap-1.5">
        See the full 100-level table <Icon name="arrow_forward" size={14} />
      </button>
    </div>
  );
}

function Perk({ icon, text }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.04] text-[10px] text-text-secondary">
      <Icon name={icon} size={12} /> {text}
    </span>
  );
}
