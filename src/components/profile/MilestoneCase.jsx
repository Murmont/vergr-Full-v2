// The badge case — milestone achievements on a profile.
//
// Distinct from `BadgesShowcase`, which shows the three RANK badges for your
// current VP band. These are achievements: things you did, not a level you
// reached. Both can sit on one profile without competing, because one is a
// ladder position and the other is a history.
//
// COSTS NOTHING TO RENDER. `milestonesFor()` is a pure pass over a static
// table using counters already present on the user and wallet docs the screen
// has loaded. No query, no subscription, no stamped "earned" collection.
//
// The wallet is only available for your OWN profile. On someone else's, the
// wallet-sourced families (Generous, Earner, Loyal) are not evaluated at all
// rather than being drawn as unearned — "we cannot see it" and "they have not
// earned it" are different claims and only one of them is true.

import { useMemo, useState } from 'react';
import Icon from '../Icon';
import { milestonesFor, MILESTONE_TOTAL } from '../../utils/milestones';

/** 0 -> "0", 6000 -> "6,000". Thresholds read as counts, never abbreviated: a
 *  badge that says "6K" hides whether you need 6,000 or 6,499. */
const n = (v) => Math.round(Number(v) || 0).toLocaleString();

/** Minutes -> a human duration, because "6000" means nothing as a stream goal. */
const asHours = (mins) => `${Math.floor(mins / 60)}h`;

function BadgeFace({ b, earned, size = 54 }) {
  return (
    <div
      className="relative shrink-0 rounded-2xl flex items-center justify-center"
      style={{
        width: size, height: size,
        // Earned badges carry their own colour as a low wash plus a lit top
        // rim; locked ones sit as a recess. Same material language as the rest
        // of the profile: value and light, not an outline.
        background: earned
          ? `linear-gradient(180deg, ${b.color}26, ${b.color}0A)`
          : 'linear-gradient(180deg, rgba(0,0,0,0.42), rgba(255,255,255,0.018))',
        boxShadow: earned
          ? `inset 0 1px 0 ${b.color}66, 0 4px 14px -6px ${b.color}55`
          : 'inset 0 2px 3px -1px rgba(0,0,0,0.85), inset 0 -1px 0 0 rgba(255,255,255,0.06)',
      }}
    >
      <Icon
        name={b.icon}
        size={Math.round(size * 0.44)}
        style={{ color: earned ? b.color : 'rgba(255,255,255,0.20)' }}
      />
      {b.oneOff && earned && (
        // Rare badges get a corner mark so they are distinguishable at a glance
        // from a tier-4 threshold badge, which is also white.
        <span
          className="absolute -top-1 -right-1 w-[14px] h-[14px] rounded-full flex items-center justify-center"
          style={{ background: b.color, color: '#0B0B14' }}
        >
          <Icon name="star" size={9} />
        </span>
      )}
    </div>
  );
}

export default function MilestoneCase({ user, wallet, compact = false }) {
  const [open, setOpen] = useState(false);
  const { earned, locked, next, count } = useMemo(
    () => milestonesFor(user, wallet),
    [user, wallet],
  );

  // A profile with nothing earned shows the chase, not an empty shelf. An empty
  // state that says "no badges" reads as broken; one that names the closest
  // badge reads as a goal.
  const nothingYet = earned.length === 0;

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between mb-2.5">
        <h3 className="text-[13px] font-bold text-text-primary">Milestones</h3>
        <span className="text-[11px] font-dmmono tabular-nums text-text-muted">
          {count} / {MILESTONE_TOTAL}
        </span>
      </div>

      {nothingYet ? (
        next && (
          <div className="flex items-center gap-3 p-3 rounded-xl"
               style={{ background: 'rgba(255,255,255,0.028)' }}>
            <BadgeFace b={next} earned={false} size={44} />
            <div className="min-w-0">
              <p className="text-[12px] font-bold text-text-primary">{next.name}</p>
              <p className="text-[11px] text-text-secondary mt-0.5">{next.desc}</p>
            </div>
          </div>
        )
      ) : (
        <div className="flex flex-wrap gap-2">
          {(open ? earned : earned.slice(0, compact ? 6 : 10)).map((b) => (
            <div key={b.id} title={`${b.name} — ${b.desc}`}>
              <BadgeFace b={b} earned size={compact ? 44 : 54} />
            </div>
          ))}
          {earned.length > (compact ? 6 : 10) && !open && (
            <button
              onClick={() => setOpen(true)}
              className="rounded-2xl px-3 text-[11px] font-bold text-text-secondary"
              style={{ height: compact ? 44 : 54, background: 'rgba(255,255,255,0.04)' }}
            >
              +{earned.length - (compact ? 6 : 10)}
            </button>
          )}
        </div>
      )}

      {/* The next one to chase, with real progress. Only shown once something
          has been earned, otherwise it duplicates the empty state above. */}
      {!nothingYet && next && (
        // Capped rather than full-bleed: measured at 1,182px on desktop, a 34%
        // fill across the whole content column reads as a stretched hairline
        // instead of progress. A bar has to be short enough that the filled
        // part is a shape.
        <div className="mt-3 flex items-center gap-3 max-w-[420px]">
          <BadgeFace b={next} earned={false} size={38} />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[11.5px] font-bold text-text-primary truncate">{next.name}</p>
              <p className="text-[10px] font-dmmono tabular-nums text-text-muted shrink-0">
                {next.field === 'streamMinutes'
                  ? `${asHours(next.have)} / ${asHours(next.need)}`
                  : `${n(next.have)} / ${n(next.need)}`}
              </p>
            </div>
            <div className="mt-1.5 h-[3px] rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, next.pct)}%`,
                  background: `linear-gradient(90deg, ${next.color}55, ${next.color})`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Wallet-sourced families are invisible on someone else's profile by
          design. Saying so is better than silently showing a shorter list that
          looks like they have earned less than they have. */}
      {/* ⚠ "Tipping, earnings and streak badges are private" was REMOVED here
          2026-08-24. It rendered directly beneath VISIBLE badges, so it read as
          a flat contradiction, and it was aimed at nobody: a visitor does not
          need telling what they are not being shown, and the owner never saw it.
          A shorter list needs no apology. The wallet-sourced families are still
          omitted — that part was always correct, since those counters live on
          the wallet doc a visitor cannot read. */}
    </div>
  );
}
