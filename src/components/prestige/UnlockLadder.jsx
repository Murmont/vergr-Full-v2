// The "what you unlock" surface, driven by src/utils/rankUnlocks.js.
//
// This replaced a tab that listed only crests and badges, which is why the
// ladder felt empty: it was describing two cosmetics across 100 levels. Every
// row here is a real entry in RANK_UNLOCKS, so the screen can never promise
// something the table does not grant.
//
// COST: zero. `level` comes from the wallet the page already loaded, and every
// lookup below is a filter over a ~110 row in-memory array. No reads, no
// callables, nothing per-render that touches Firestore.
import { useMemo, useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import Icon from '../Icon';
import {
  RANK_UNLOCKS, UNLOCK_SURFACE, nextUnlock, entryTier, chatNameColor, rankVpBonus,
} from '../../utils/rankUnlocks';
import { RANK_TIERS } from '../../utils/vpSystem';

const rankFor = (lvl) =>
  RANK_TIERS.find((t) => lvl >= t.min && lvl <= t.max) || RANK_TIERS[0];

const FILTERS = [
  { id: 'all', label: 'Everything', icon: 'apps' },
  ...Object.entries(UNLOCK_SURFACE).map(([id, s]) => ({ id, label: s.label, icon: s.icon })),
];

function NextUp({ level }) {
  const next = nextUnlock(level);
  if (!next) {
    return (
      <div className="p-4 rounded-2xl border" style={{ borderColor: '#FFFFFF33', background: '#FFFFFF0A' }}>
        <p className="font-syne font-bold text-white text-sm">Everything is unlocked.</p>
        <p className="text-xs text-text-secondary mt-1">
          Level 100. There is nothing above you on this ladder.
        </p>
      </div>
    );
  }
  const r = rankFor(next.level);
  const away = next.level - level;
  return (
    <div
      className="p-4 rounded-2xl border relative overflow-hidden"
      style={{ borderColor: `${r.ringColor}55`, background: `${r.ringColor}12` }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `${r.ringColor}22`, border: `1px solid ${r.ringColor}44` }}
        >
          <Icon name={UNLOCK_SURFACE[next.surface]?.icon || 'lock_open'} size={20} style={{ color: r.ringColor }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: r.ringColor }}>
            Next unlock · {away === 1 ? '1 level away' : `${away} levels away`}
          </p>
          <p className="font-syne font-bold text-white text-sm truncate">{next.name}</p>
          <p className="text-[11px] text-text-secondary mt-0.5">{next.desc}</p>
        </div>
        <span className="font-dmmono font-bold text-lg tabular-nums shrink-0" style={{ color: r.ringColor }}>
          L{next.level}
        </span>
      </div>
    </div>
  );
}

/** What the room sees. The only reward a stranger can observe, so it leads. */
function WitnessCard({ level }) {
  const tier = entryTier(level);
  const r = rankFor(level);
  const nameCol = chatNameColor(level);
  const upcoming = RANK_UNLOCKS.filter((u) => u.surface === 'entry' && u.level > level);
  return (
    <div className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
      <div className="flex items-center gap-2 mb-2">
        <Icon name="sensor_door" size={16} style={{ color: r.ringColor }} />
        <h3 className="font-syne font-bold text-sm text-white">When you walk into a stream</h3>
      </div>
      <p className="text-xs text-text-secondary mb-3">
        This is the part other people can see. It is the reason the ladder is worth climbing in public.
      </p>

      <div
        className="rounded-xl px-3 py-2.5 flex items-center gap-2"
        style={{ background: `${r.ringColor}10`, border: `1px solid ${r.ringColor}30` }}
      >
        <Icon name={tier.id === 'none' ? 'visibility_off' : 'campaign'} size={16} style={{ color: r.ringColor }} />
        <div className="min-w-0">
          <p className="text-xs font-bold" style={{ color: r.ringColor }}>{tier.label}</p>
          <p className="text-[11px] text-text-muted">{tier.desc}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-[11px] text-text-muted">Your name in chat:</span>
        <span
          className="text-sm font-bold"
          style={{ color: nameCol || '#C9CDD4' }}
        >
          {nameCol ? 'you' : 'you'}
        </span>
        {!nameCol && <span className="text-[10px] text-text-muted">(coloured from L3)</span>}
      </div>

      {upcoming.length > 0 && (
        <p className="text-[11px] text-text-muted mt-3">
          Next entry upgrade at <span className="font-dmmono font-bold text-white">L{upcoming[0].level}</span>: {upcoming[0].name}
        </p>
      )}
    </div>
  );
}

/** What your rank is paying you right now, in numbers rather than adjectives. */
function ActiveNow({ level, boostTokens = 0 }) {
  const bonus = Math.round((rankVpBonus(level) - 1) * 1000) / 10;
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="p-3 rounded-2xl bg-surface-1 border border-white/[0.06]">
        <p className="text-[10px] uppercase tracking-wider text-text-muted font-bold">VP earn rate</p>
        <p className="font-dmmono font-bold text-lg text-white tabular-nums">
          {bonus > 0 ? `+${bonus}%` : 'base'}
        </p>
        <p className="text-[10px] text-text-muted">on everything you do</p>
      </div>
      <div className="p-3 rounded-2xl bg-surface-1 border border-white/[0.06]">
        <p className="text-[10px] uppercase tracking-wider text-text-muted font-bold">Boost tokens</p>
        <p className="font-dmmono font-bold text-lg text-white tabular-nums">{boostTokens}</p>
        <p className="text-[10px] text-text-muted">free 50-coin stream boosts</p>
      </div>
    </div>
  );
}

export default function UnlockLadder({ level = 1, boostTokens = 0 }) {
  const [filter, setFilter] = useState('all');
  const [showLocked, setShowLocked] = useState(true);
  const currentRef = useRef(null);

  const rows = useMemo(() => {
    const base = filter === 'all' ? RANK_UNLOCKS : RANK_UNLOCKS.filter((u) => u.surface === filter);
    let kept = showLocked ? base : base.filter((u) => u.level <= level);
    // The VP rate steps at EVERY level, so listing it as its own row on all 99
    // of them buried the real unlocks in repetition. It stays on levels where
    // it is the only thing granted (so no level looks empty) and is otherwise
    // implied: the running total lives in the card at the top of this screen.
    if (filter !== 'utility') {
      const soloVpLevels = new Set(
        RANK_UNLOCKS.filter((u) => u.kind === 'vp_rate')
          .filter((u) => !RANK_UNLOCKS.some((o) => o.level === u.level && o.kind !== 'vp_rate'))
          .map((u) => u.level),
      );
      kept = kept.filter((u) => u.kind !== 'vp_rate' || soloVpLevels.has(u.level));
    }
    // Group by level so a level that grants three things reads as one moment.
    const byLevel = new Map();
    for (const u of kept) {
      if (!byLevel.has(u.level)) byLevel.set(u.level, []);
      byLevel.get(u.level).push(u);
    }
    return [...byLevel.entries()].sort((a, b) => a[0] - b[0]);
  }, [filter, showLocked, level]);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, [filter, showLocked]);

  const unlockedCount = RANK_UNLOCKS.filter((u) => u.level <= level).length;

  return (
    <div className="space-y-3">
      <ActiveNow level={level} boostTokens={boostTokens} />
      <NextUp level={level} />
      <WitnessCard level={level} />

      {/* Filters */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 py-0.5">
        {FILTERS.map((f) => {
          const on = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors ${
                on ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-secondary'
              }`}
            >
              <Icon name={f.icon} size={13} />
              {f.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-text-muted font-dmmono tabular-nums">
          {unlockedCount} of {RANK_UNLOCKS.length} unlocked
        </p>
        <button
          onClick={() => setShowLocked((v) => !v)}
          className="text-[11px] font-bold text-brand-violet-light"
        >
          {showLocked ? 'Hide locked' : 'Show locked'}
        </button>
      </div>

      {/* The ladder */}
      <div className="space-y-1.5">
        {rows.map(([lvl, items]) => {
          const have = lvl <= level;
          const isCurrent = lvl === level;
          const r = rankFor(lvl);
          const bandStart = RANK_TIERS.some((t) => t.min === lvl);
          return (
            <div key={lvl} ref={isCurrent ? currentRef : null}>
              {bandStart && (
                <div className="flex items-center gap-2 pt-3 pb-1">
                  <span
                    className="text-[10px] uppercase tracking-[0.14em] font-bold"
                    style={{ color: r.ringColor }}
                  >
                    {r.name}
                  </span>
                  <div
                    className="flex-1 h-px"
                    style={{ background: `linear-gradient(90deg, ${r.ringColor}55, transparent)` }}
                  />
                </div>
              )}
              <motion.div
                initial={false}
                className="rounded-xl border px-3 py-2.5 flex gap-3"
                style={{
                  borderColor: isCurrent ? `${r.ringColor}66` : 'rgba(255,255,255,0.05)',
                  background: isCurrent ? `${r.ringColor}10` : have ? 'var(--surface-1, #14141F)' : 'transparent',
                  opacity: have ? 1 : 0.55,
                }}
              >
                <div className="w-11 shrink-0 flex flex-col items-center pt-0.5">
                  <span
                    className="font-dmmono font-bold text-sm tabular-nums"
                    style={{ color: have ? r.ringColor : '#6B7280' }}
                  >
                    {lvl}
                  </span>
                  <Icon
                    name={have ? 'check_circle' : 'lock'}
                    size={12}
                    className="mt-0.5"
                    style={{ color: have ? r.ringColor : '#6B7280' }}
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  {items.map((u) => (
                    <div key={u.id} className="flex items-start gap-2">
                      <Icon
                        name={UNLOCK_SURFACE[u.surface]?.icon || 'star'}
                        size={13}
                        className="mt-0.5 shrink-0"
                        style={{ color: have ? '#9CA3AF' : '#6B7280' }}
                      />
                      <div className="min-w-0">
                        <p className={`text-xs font-bold ${have ? 'text-white' : 'text-text-muted'}`}>
                          {u.name}
                          {u.equip && have && (
                            <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-white/[0.07] text-text-secondary">
                              equippable
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-text-muted leading-snug">{u.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-text-muted pt-2">
        Equippable unlocks are turned on in the Appearance tab. Everything else applies by itself the moment you reach the level.
      </p>
    </div>
  );
}
