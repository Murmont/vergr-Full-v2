// src/screens/creator/CreatorEarningsScreen.jsx
// Creator Studio — Earnings. Revenue share, scheduled payouts, statements.
//
// See docs/REVENUE_SHARE_MOCKUP_BRIEF.md. Two rules this screen exists to obey:
//
// 1. NO WITHDRAW BUTTON, anywhere, and no affordance that resembles one. Vergr
//    pays its suppliers on a schedule; a creator pulling funds on demand is the
//    exact shape the revenue-share model exists to remove.
// 2. Copy never says commission, fee, withdraw, convert, or "your balance". It
//    says what the creator EARNS and WHEN THEY ARE PAID. Gems are an internal
//    unit and are never shown; everything is dollars.
import { useState, useEffect, useMemo, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { EarningsSkeleton } from '../../components/creator/StudioSkeletons';
import { getTransactions, getPayoutAccount, getMyPayoutStatements } from '../../firebase/firestore';
import CreatorLayout from '../../components/creator/CreatorLayout';
import { Card, SectionHeader } from '../../components/creator/Widgets';
import { StackedAreaChart, DonutChart, PALETTE } from '../../components/creator/charts';
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, LabelList,
} from 'recharts';

import { revenueShareTier, REVENUE_SHARE_RATES, REVENUE_SHARE_THRESHOLDS } from '../../utils/vpSystem';
import Icon from '../../components/Icon';
import '../../styles/surface.css';

function tsMs(t) {
  if (!t) return 0;
  if (t.toDate) return t.toDate().getTime();
  if (t.seconds) return t.seconds * 1000;
  return new Date(t).getTime() || 0;
}

/** Server sends micro-USD (1 USD = 1,000,000). Never do rate maths on the client. */
const usd = (micro) => `$${((Number(micro) || 0) / 1e6).toLocaleString(undefined, {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;
/** Coins are $0.01 each, so lifetime gross coins → dollars for the tier ladder. */
/** Tier THRESHOLDS only. These are round by construction ($0/$50/$250/...). */
const coinsToUsd = (coins) => `$${Math.floor((Number(coins) || 0) / 100).toLocaleString()}`;

/**
 * Any figure that is a creator's actual money. Coins and gems are both worth
 * $0.01, so this is the one conversion for both.
 *
 * NEVER use coinsToUsd for a balance: it floors to whole dollars, which
 * reported "$0" to an account holding $0.01 and made three figures on this
 * screen contradict each other.
 */
/** A figure that is ALREADY in dollars. */
const usdStr = (usd) => `$${(Number(usd) || 0).toLocaleString(undefined, {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

/** COINS (or cents) to dollars. Never pass a dollar figure to this. */
const unitsToUsd = (units) => `$${((Number(units) || 0) / 100).toLocaleString(undefined, {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

const NUM = 'font-dmmono font-bold tabular-nums';

/**
 * Ledger window for the monthly chart. Lifetime totals must NEVER be summed
 * from this: it is capped, so the sum silently under-reports past the cap.
 * They come from the wallet aggregates instead.
 */
const TX_WINDOW = 500;

// Deliberately no cyan: off-brand, see memory project_brand_no_cyan.
const SOURCE_DEFS = [
  { key: 'Tips',           match: ['tip', 'gift'],                          color: PALETTE.gold },
  { key: 'Memberships',    match: ['member', 'sub'],                        color: PALETTE.violet },
  { key: 'Locked content', match: ['entitlement', 'unlock', 'pack'],        color: PALETTE.pink },
  { key: 'Paid access',    match: ['paid_stream', 'ticket', 'season_pass'], color: PALETTE.blue },
  { key: 'Vergr.me',       match: ['vergrme', 'shop', 'product'],           color: PALETTE.emerald },
  { key: 'Other',          match: [],                                       color: PALETTE.rose },
];

/**
 * WHAT COUNTS AS EARNED.
 *
 * This used to be a hand-kept allowlist of transaction TYPE strings, because
 * nothing on the row said whether it was income. That was fragile in both
 * directions: it had to be updated every time an earning surface shipped, and
 * four of the eight types it listed could never match anyway, because their
 * writers never stamped the currency the filter also required.
 *
 * The server now stamps `earning: true` on every row that is real creator
 * income, at the moment it writes it (coinLedger.js, and each earning surface).
 * Filtering on a fact the writer asserted beats inferring from a name.
 *
 * Money still fails CLOSED: a row without the flag is NOT income. Admin grants,
 * refunds, purchases and coin movements do not carry it, deliberately.
 */
function isEarning(t) {
  return t?.earning === true && (Number(t?.amountMicroUsd) || 0) > 0;
}

/** Micro-USD on an earning row. One accessor so no figure invents its own. */
function earnedMicro(t) {
  return Number(t?.amountMicroUsd) || 0;
}

function classify(tx) {
  const t = (tx.type || '').toLowerCase();
  for (const s of SOURCE_DEFS) if (s.match.some((m) => t.includes(m))) return s.key;
  return 'Other';
}

/**
 * Next payout date for a cadence, in UTC, matching cadenceDueToday() in
 * functions/creatorPayouts.js. Display only: the server decides what actually
 * runs, and this must never be presented as a promise.
 */
function nextPayoutDate(cadence, from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const bump = () => d.setUTCDate(d.getUTCDate() + 1);
  // Start from tomorrow: a run that was due today has already been planned.
  bump();
  for (let i = 0; i < 400; i++) {
    const dom = d.getUTCDate();
    const dow = d.getUTCDay();
    if (cadence === 'standard' && dom === 1) return new Date(d);
    if (cadence === 'established' && (dom === 1 || dom === 15)) return new Date(d);
    if (cadence === 'priority' && dow === 1) return new Date(d);
    bump();
  }
  return null;
}

const fmtDate = (d) => (d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) : '—');
const daysUntil = (d) => (d ? Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000)) : null);

const CADENCE_META = {
  standard:    { label: 'Standard',    pays: 'Paid monthly',        next: 'Get paid twice a month' },
  established: { label: 'Established', pays: 'Paid twice a month',  next: 'Get paid weekly' },
  priority:    { label: 'Priority',    pays: 'Paid weekly',         next: null },
};

// ── Block A ───────────────────────────────────────────────────────────

function useCountUp(target, ms = 900) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setN(target);
      return;
    }
    let raf, t0;
    const step = (t) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / ms);
      setN(target * (1 - Math.pow(1 - p, 3)));   // ease-out cubic
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return n;
}

/**
 * Gold is never a solid fill on this screen. A flat #F0A500 reads as orange
 * paint; real gold is a gradient from a pale champagne highlight into deep
 * amber, which is what makes it read as metal. GOLD_TEXT clips that ramp to
 * glyphs (the glow has to be a filter, not text-shadow, because the text
 * itself is transparent).
 */
/**
 * 370-byte blur of the tier art, inlined. It paints with the component so the
 * slot is never empty, and it doubles as the sub-lg src: the real render sits
 * behind a <source media> query, so phones never fetch the 61KB asset.
 */
const ART_LQIP = 'data:image/webp;base64,UklGRmoBAABXRUJQVlA4WAoAAAAQAAAAEwAADQAAQUxQSIoAAAARb6C4bSQ1tW+mY4iIAG/ba/HvidcBNdu2ZdmFRHdJHCSNNJp1DibwBWiWqDRGoHKQXDPJ7dd7mu8bIqL/EwAwT2Ean0gRk8q/dA6M7XgekhT7sTEyyedg+TZkAc/LkPEBT8PUAcP6v3Rc2aFW+JUGNsBzkqQkeDoyznwWT3X7Lx27Pgt4C+1ywgJWUDggugAAAHAEAJ0BKhQADgA/CW6uT6umJCIwCAFwIQlsAJ0ygE4BtQDAaDrjeIynSRKAAP53o7MRK/7C3csvxJ+Ra6zy67lrNh2yixImCn/hCFYfJayaNcxIAC+ncL3CUSyFSDQNqziG7YuMubTvIxpyvrWWkyFgpJ3jlvrHTvz1bC96jMbvyd1ae3Br0o5iLRVPUQOMWt1Dj46jMeSyMijvGsJN5MrCPgodxW1H8OIpIvJZTIPJp4EFdo801AAAAA==';

// Gold, measured off the founder's mockup rather than eyeballed: the arc runs
// #FAE177 at the top to #EDAB2A at the bottom. Do not widen this ramp. Pushing
// the top toward white or the bottom toward brown is what made earlier passes
// read as orange paint.
const GOLD_STOPS = ['#FAE58C', '#FBDE6B', '#F3BB38', '#EDA92A'];
const GOLD_TEXT = {
  background: `linear-gradient(175deg, ${GOLD_STOPS[0]} 0%, ${GOLD_STOPS[1]} 34%, ${GOLD_STOPS[2]} 74%, ${GOLD_STOPS[3]} 100%)`,
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
  filter: 'drop-shadow(0 0 18px rgba(240,165,0,0.30))',
};

/* Ring geometry, MEASURED from the reference (centre 90.1,86.8; band r 63.5 to
 * 74.5; mid 69; 12 blocks; duty 0.935). Expressed in the 120-unit viewBox:
 *   thickness / mid-radius = 0.159   <- the ratio that matters
 * An earlier pass ran this at 0.368, i.e. the band was 2.3x too thick, which is
 * why it read as chunky rather than precise. Do not thicken it. */
const R_MID = 49;
const W_BAND = 7.8;
const DUTY = 0.95;
const R_OUT = R_MID + W_BAND / 2;
const R_IN = R_MID - W_BAND / 2;

/**
 * Segmented gauge.
 *
 * NO BLUR ANYWHERE. The reference glow was measured across the band: it is
 * amber, reaches about 33% of the source luminance immediately beside the
 * block, and dies within roughly one band-width. That is a falloff, so it is
 * drawn as one, as four concentric strokes of increasing width and decreasing
 * alpha sharing the block's own dash pattern. Consequences that a Gaussian
 * cannot give you: the gaps between blocks stay dark (a blur floods them), the
 * falloff is exact rather than approximate, and there is no filter cost.
 *
 * The blocks are beveled with a hairline shadow on the inner wall and a lit
 * hairline on the outer, which is the carve. The recess behind is deliberately
 * faint: the reference interior measures luminance 9.5 against a page of 7.5,
 * so there is no dark disc there, and painting one is what made this look
 * pasted on.
 *
 * It plots the SHARE. The track below the copy carries progress-to-next-tier.
 * pathLength=100 normalises per-circle, so a bevel stroke at a different radius
 * lines up angularly with its own face for free.
 */
function SegmentRing({ pct, label, sub, size = 168, segments = 12 }) {
  const uid = useId().replace(/:/g, '');
  const lit = Math.round((Math.max(0, Math.min(100, pct)) / 100) * segments);
  const unit = 100 / segments;
  const dash = unit * DUTY;

  const arc = (i, r, w, stroke, extra = {}) => (
    <circle
      key={`${stroke}-${r}-${i}`}
      cx="60" cy="60" r={r} fill="none" pathLength="100"
      stroke={stroke} strokeWidth={w} strokeLinecap="butt"
      strokeDasharray={`${dash} ${100 - dash}`}
      strokeDashoffset={-(i * unit)}
      {...extra}
    />
  );

  const range = (n) => Array.from({ length: n }, (_, i) => i);

  // Feathered ring mask, so the carve shading describes an annulus and never
  // terminates on a visible circle.
  const p = (r) => `${((r / 60) * 100).toFixed(1)}%`;
  const bandMask =
    `radial-gradient(circle closest-side, transparent ${p(R_IN - 2)}, #000 ${p(R_IN)}, #000 ${p(R_OUT)}, transparent ${p(R_OUT + 2)})`;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        aria-hidden
        className="absolute -inset-[18px] rounded-full pointer-events-none"
        style={{
          background:
            'radial-gradient(circle closest-side, rgba(0,0,0,0.30) 0%,' +
            ' rgba(0,0,0,0.26) 52%, rgba(0,0,0,0.14) 72%,' +
            ' rgba(0,0,0,0.05) 86%, transparent 100%)',
        }}
      />

      <svg viewBox="0 0 120 120" className="absolute inset-0 w-full h-full">
        <defs>
          <linearGradient id={`gold${uid}`} x1="0.35" y1="0" x2="0.62" y2="1">
            <stop offset="0%"   stopColor={GOLD_STOPS[0]} />
            <stop offset="34%"  stopColor={GOLD_STOPS[1]} />
            <stop offset="72%"  stopColor={GOLD_STOPS[2]} />
            <stop offset="100%" stopColor={GOLD_STOPS[3]} />
          </linearGradient>
          {/* Unlit blocks, sampled from the reference at #20232A. */}
          <linearGradient id={`slate${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#24272E" />
            <stop offset="60%"  stopColor="#1E2128" />
            <stop offset="100%" stopColor="#191C22" />
          </linearGradient>
        </defs>

        <g transform="rotate(-90 60 60)">
          {/* Glow: additive, tight, gaps preserved. */}
          <g className="vg-bloom">
            {range(lit).map((i) => arc(i, R_MID, W_BAND * 1.75, 'rgba(240,168,26,0.13)'))}
            {range(lit).map((i) => arc(i, R_MID, W_BAND * 1.42, 'rgba(243,182,44,0.20)'))}
            {range(lit).map((i) => arc(i, R_MID, W_BAND * 1.22, 'rgba(250,212,92,0.30)'))}
            {range(lit).map((i) => arc(i, R_MID, W_BAND * 1.08, 'rgba(255,236,150,0.42)'))}
          </g>

          {/* Faces. */}
          {range(segments).map((i) =>
            arc(i, R_MID, W_BAND, i < lit ? `url(#gold${uid})` : `url(#slate${uid})`, {
              className: i < lit ? 'vg-seg' : undefined,
              style: i < lit ? { animationDelay: `${i * 38}ms`, transformOrigin: '60px 60px' } : undefined,
            })
          )}

          {/* Bevel: inner wall falls away, outer wall catches the light. */}
          {range(segments).map((i) =>
            arc(i, R_IN + 0.35, 0.7, i < lit ? 'rgba(120,72,0,0.55)' : 'rgba(0,0,0,0.65)'))}
          {range(segments).map((i) =>
            arc(i, R_OUT - 0.35, 0.7, i < lit ? 'rgba(255,246,200,0.55)' : 'rgba(255,255,255,0.07)'))}
        </g>
      </svg>

      {/* Carve, annulus only. */}
      <div
        aria-hidden
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.10) 42%, transparent 60%)',
          WebkitMaskImage: bandMask,
          maskImage: bandMask,
        }}
      />

      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className={`${NUM} text-[36px] text-white leading-none tracking-tight`}>{label}</div>
        <div className="text-[13px] text-text-secondary mt-[7px] leading-none">{sub}</div>
      </div>
    </div>
  );
}

/* Per-tier accent, sampled from the founder's mockup badge rings:
 * T1 #EADE46 gold, T2/T3 silver (#A6A8AC / #B9BBBD), T4 #CC9650 bronze,
 * T5 #B7C367 olive, T6 #37B2D1 cyan, T7 violet (ring edge #39145A).
 * NOTE: T6 cyan is what the mockup uses; it conflicts with the no-cyan brand
 * rule, so it is isolated here as a one-line change if that rule wins. */
const TIER_ACCENT = ['#F5C842', '#C2C6CC', '#B9BBBD', '#CC9650', '#B7C367', '#37B2D1', '#B44FFF'];

const RAIL_DOTS = 6;

/**
 * Progress rail. Six dots on a 2px track.
 *
 * Judgement call, flagged: the mockup's rail fills are 43/9/7/5/4/3/3 percent
 * across tiers 1-7 against a lifetime of $0.00, which no formula reproduces, so
 * they are placeholder values. This implements the honest reading instead:
 * how far the creator is toward THAT tier's threshold, measured from the
 * previous threshold. Passed tiers fill completely, the current tier fills
 * partially, future tiers show their start dot. Rows 2-7 look like the mockup;
 * row 1 differs only because it shows a real number.
 */
function TierRail({ fill }) {
  const f = Math.max(0, Math.min(1, fill));
  return (
    <div className="relative h-2 w-full">
      <div className="absolute left-1 right-1 top-1/2 -translate-y-1/2 h-[2px] rounded-full bg-[#191C21]" />
      <div
        className="absolute left-1 top-1/2 -translate-y-1/2 h-[2px] rounded-full"
        style={{
          width: `calc((100% - 8px) * ${f})`,
          background: 'linear-gradient(90deg, #F5C53B, #FBEB8A)',
          boxShadow: f > 0 ? '0 0 8px rgba(245,197,59,0.55)' : 'none',
        }}
      />
      {Array.from({ length: RAIL_DOTS }).map((_, i) => {
        const at = i / (RAIL_DOTS - 1);
        const on = f >= at - 0.001;
        return (
          <span
            key={i}
            className="absolute top-1/2 w-2 h-2 rounded-full"
            style={{
              left: `calc(4px + (100% - 8px) * ${at})`,
              transform: 'translate(-50%,-50%)',
              background: on ? '#F5C53B' : '#343942',
              boxShadow: on ? '0 0 7px rgba(245,197,59,0.7)' : 'none',
            }}
          />
        );
      })}
    </div>
  );
}

function TierBadge({ n, accent, current }) {
  return (
    <span
      className="relative shrink-0 grid place-items-center rounded-full"
      style={{
        width: 26, height: 26,
        background: `radial-gradient(circle at 40% 32%, ${accent}22, transparent 70%), #0B0D11`,
        boxShadow: `inset 0 0 0 1.5px ${accent}${current ? 'DD' : '77'}${current ? '' : ''}`,
      }}
    >
      <span className={`${NUM} text-[12px] leading-none`} style={{ color: accent }}>{n}</span>
    </span>
  );
}

/**
 * The tier ladder, its own panel below the hero (that is how the mockup has it).
 *
 * Measured from the reference and worth keeping: rows sit on a 26px pitch with
 * NO separator lines between them, only the current row carries a border, and
 * only the current row's percentage is gold (#E7CC28) while the rest are white.
 *
 * The current row is NOT glass. Measured, it is an amber wash anchored at the
 * LEFT (lum 20.3 at x=30 falling to 10.9 by x=700) inside a 1px amber border
 * that is brightest on the left edge (135) then top (87) then bottom (55). So
 * it reads as lit from the left rather than as a frosted panel laid on top.
 * The improvement on the reference: the same traveling edge light the hero
 * panel uses runs around this one row, so "you are here" is a light source.
 */
function TierLadder({ tier, earnedGross, onHide }) {
  return (
    <div className="vg-material vg-grain vg-beam rounded-2xl mt-4 overflow-hidden">
      <div className="relative z-[1] px-5 pt-4 pb-2 flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-text-primary">
            Revenue share tiers
          </div>
          <div className="text-xs text-text-muted mt-0.5">The more you earn, the more you keep.</div>
        </div>
        <button
          onClick={onHide}
          className="shrink-0 rounded-lg px-3 py-1.5 text-xs text-text-secondary flex items-center gap-1 transition-colors hover:text-text-primary"
          style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.10)' }}
        >
          Hide tiers
          <Icon name="expand_less" className="text-sm" />
        </button>
      </div>

      <div className="relative z-[1] px-3 pb-3">
        {REVENUE_SHARE_RATES.map((rate, i) => {
          const isNow = i === tier - 1;
          const passed = i < tier - 1;
          const floor = REVENUE_SHARE_THRESHOLDS[i];
          const prev = i === 0 ? 0 : REVENUE_SHARE_THRESHOLDS[i - 1];
          const fill = passed ? 1 : floor <= prev ? 0 : Math.max(0, Math.min(1, (earnedGross - prev) / (floor - prev)));
          const accent = TIER_ACCENT[i];

          return (
            <div
              key={rate}
              className={`relative grid items-center gap-3 pl-3 pr-5 rounded-xl ${isNow ? 'vg-beam' : ''}`}
              style={{
                height: 44,
                // Fixed columns, measured off the mockup: badge / label / pill /
                // threshold / rail / percentage. The pill slot exists on every
                // row even when empty, which is what keeps the rails aligned.
                gridTemplateColumns: '26px 46px 66px 128px minmax(0,1fr) 48px',
                background: isNow
                  ? 'linear-gradient(90deg, rgba(240,180,50,0.13) 0%, rgba(240,180,50,0.07) 26%, rgba(240,180,50,0.02) 62%, transparent 88%)'
                  : 'transparent',
              }}
            >
              <TierBadge n={i + 1} accent={accent} current={isNow} />

              <span className={`text-sm whitespace-nowrap ${isNow ? 'text-text-primary font-bold' : 'text-text-secondary'}`}>
                Tier {i + 1}
              </span>

              {/* Column is always present so the grid does not reflow per row. */}
              <span className="min-w-0">
                {isNow && (
                  <span
                    className="inline-block rounded-md px-2 py-[3px] text-[10px] font-bold tracking-wide"
                    style={{ background: 'rgba(240,180,50,0.16)', color: '#F5C842' }}
                  >
                    CURRENT
                  </span>
                )}
              </span>

              <span className="text-xs text-text-muted whitespace-nowrap">
                from {coinsToUsd(floor)}
              </span>

              <TierRail fill={fill} />

              <span
                className={`${NUM} text-right text-sm`}
                style={{ color: isNow ? '#E7CC28' : '#E0E0E3' }}
              >
                {Math.round(rate * 100)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TierHero({ earnedGross }) {
  const [open, setOpen] = useState(false);
  const [artOk, setArtOk] = useState(true);
  const t = revenueShareTier(earnedGross);
  const sharePct = Math.round(t.share * 100);
  const shown = Math.round(useCountUp(sharePct));
  const isMax = t.nextShare == null;
  // Right-hand scale label is the top of the whole ladder, not the next rung:
  // the scale exists to show how much room is left overall.
  const ladderTop = `${coinsToUsd(REVENUE_SHARE_THRESHOLDS[REVENUE_SHARE_THRESHOLDS.length - 1])}+`;

  return (
    <>
    <div className="vg-material vg-grain vg-beam rounded-2xl">
      <div className="relative z-[1] grid gap-6 p-5 lg:grid-cols-[minmax(150px,0.72fr)_auto_auto_minmax(260px,1.15fr)_minmax(0,0.8fr)] lg:items-center lg:gap-0">

        {/* Zone 1: the headline share. */}
        <div className="lg:pr-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-gold-light/95">
            Your progress
          </div>
          <div className={`${NUM} text-[64px] leading-[0.92] mt-1.5 tracking-tight`} style={GOLD_TEXT}>
            {shown}%
          </div>
          <div className="text-text-primary font-bold text-[17px] mt-1">You keep</div>
          <div className="text-text-muted text-xs mt-0.5">Tier {t.tier} of {t.tierCount}</div>

          <div className="mt-4">
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted leading-none">
              Lifetime earned, before your share
              <InfoDot label="What lifetime earned means">
                The full value of everything you earned, before your revenue share rate is applied. Your share of it is shown under Earnings over time, and the part you can be paid right now is your available balance.
                This is the figure that moves you up the tier ladder, and it never resets or
                goes down, so your rate can only improve.
              </InfoDot>
            </div>
            <div className={`${NUM} text-lg text-text-primary mt-1.5 leading-none`}>{unitsToUsd(earnedGross)}</div>
          </div>
        </div>

        <div className="vg-rule-v hidden lg:block" />

        {/* Zone 2: the gauge. Plots the share, matching the number inside it. */}
        <div className="flex justify-center lg:px-8">
          <SegmentRing pct={sharePct} label={`${shown}%`} sub="You keep" />
        </div>

        {/* Zone 3: what it takes to move up. */}
        <div className="lg:pl-2 lg:pr-8 min-w-0">
          {isMax ? (
            <div>
              <div className="text-text-primary font-bold text-[22px]">Top tier reached.</div>
              <div className="text-text-secondary text-sm mt-1">
                You keep the maximum share of everything you earn.
              </div>
            </div>
          ) : (
            <>
              <div className="font-bold text-[22px] leading-snug text-text-primary">
                Earn <span style={GOLD_TEXT}>{unitsToUsd(t.coinsToNext)}</span> more
              </div>
              <div className="text-text-secondary text-[15px]">
                to reach <span className="font-bold" style={GOLD_TEXT}>{Math.round(t.nextShare * 100)}%</span>
              </div>

              {/* Track. The knob is what says "position on a scale" rather than
                  "loading bar", so it stays visible even at 0 progress. */}
              <div className="relative mt-5 mb-2.5 h-2 flex items-center">
                <div className="absolute inset-x-0 h-2 rounded-full bg-white/[0.09]" />
                <div
                  className="absolute left-0 h-2 rounded-full transition-[width] duration-700 ease-out"
                  style={{
                    width: `${Math.max(4, t.progress)}%`,
                    background: `linear-gradient(90deg, ${GOLD_STOPS[2]}, ${GOLD_STOPS[1]} 60%, ${GOLD_STOPS[0]})`,
                    boxShadow: '0 0 12px rgba(240,165,0,0.45)',
                  }}
                />
                <div
                  className="vg-knob absolute w-[18px] h-[18px] rounded-full"
                  style={{
                    left: `${Math.max(4, t.progress)}%`,
                    transform: 'translate(-50%,0)',
                    background: `radial-gradient(circle at 35% 30%, #FFF8DC, ${GOLD_STOPS[1]} 55%, ${GOLD_STOPS[2]})`,
                  }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-text-muted gap-2">
                <span>{coinsToUsd(REVENUE_SHARE_THRESHOLDS[t.tier - 1])}</span>
                <span className="text-text-secondary truncate">{unitsToUsd(t.coinsToNext)} to next tier</span>
                <span>{ladderTop}</span>
              </div>
            </>
          )}

          {/* Raised tile, no outline: it lifts by value and shadow. */}
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="vg-tile w-full mt-5 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-left"
          >
            <div className="min-w-0">
              <div className="text-[11px] text-text-muted">Lifetime earned</div>
              <div className={`${NUM} text-[19px] text-emerald-400 mt-0.5`}>{unitsToUsd(earnedGross)}</div>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <span className="text-[11px] text-text-muted hidden sm:inline">
                {open ? 'Hide tiers' : 'All tiers'}
              </span>
              <span className="w-6 h-6 rounded-full bg-white/[0.07] flex items-center justify-center">
                <Icon
                  name="chevron_right"
                  className={`text-text-secondary text-base transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
                />
              </span>
            </div>
          </button>
        </div>

        {/* Zone 4: art slot with its own light. The bokeh and glow are the
            atmosphere the render will sit inside, so the zone reads as lit
            rather than empty before the asset exists. */}
        <div className="relative hidden lg:flex items-center justify-center min-h-[200px] overflow-hidden rounded-xl">
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(58% 62% at 52% 52%, rgba(240,165,0,0.20), transparent 72%),' +
                'radial-gradient(30% 34% at 78% 26%, rgba(245,200,66,0.14), transparent 70%)',
            }}
          />
          {[
            { t: '16%', l: '14%', s: 5, o: 0.5 },  { t: '68%', l: '20%', s: 3, o: 0.35 },
            { t: '26%', l: '82%', s: 4, o: 0.45 }, { t: '78%', l: '72%', s: 6, o: 0.3 },
            { t: '46%', l: '92%', s: 3, o: 0.4 },  { t: '10%', l: '56%', s: 4, o: 0.28 },
          ].map((b, i) => (
            <span
              key={i}
              aria-hidden
              className="absolute rounded-full pointer-events-none"
              style={{
                top: b.t, left: b.l, width: b.s, height: b.s,
                background: GOLD_STOPS[1], opacity: b.o,
                boxShadow: `0 0 ${b.s * 2.5}px ${b.s * 0.8}px rgba(240,165,0,0.55)`,
              }}
            />
          ))}
          {artOk && (
            <picture>
              {/* Desktop only. Below lg the slot is display:none, but browsers
                  still fetch a hidden <img>, so the media query is what actually
                  saves the bytes on a phone. */}
              <source
                media="(min-width: 1024px)"
                type="image/webp"
                srcSet="/brand/earnings/tier-vault.webp 1x, /brand/earnings/tier-vault@2x.webp 2x"
              />
              <img
                src={ART_LQIP}
                alt=""
                aria-hidden
                width={294}
                height={210}
                decoding="async"
                fetchPriority="high"
                onError={() => setArtOk(false)}
                className="relative max-h-[210px] w-auto object-contain select-none pointer-events-none"
                style={{ filter: 'drop-shadow(0 14px 34px rgba(0,0,0,0.6))' }}
              />
            </picture>
          )}
        </div>


      </div>
    </div>
    {open && <TierLadder tier={t.tier} earnedGross={earnedGross} onHide={() => setOpen(false)} />}
    </>
  );
}

// ── Block G: remaining earnings sections ──────────────────────────────
// Built from the founder's mockups in Downloads/vergr-mockups/. Everything is
// driven by data already loaded on this screen; nothing is placeholder.

const WALLET_LQIP = 'data:image/webp;base64,UklGRkoBAABXRUJQVlA4WAoAAAAQAAAAEwAADQAAQUxQSH4AAAARb6CgbRsWF8LbjYgAvVu25X3CTbVty3L/tvvu7BbAdyYCQAR32fijkMBiyMTPm+b76BDR/wkAcPnr1b3EV/ptAzcxDOj3L9fnpgakHxGRyCBuvBTfYFq8lcBh3NQZxN9KaZnuULQN3LOuZhiT6iciu4FHcivLzXLkA7GBAQBWUDggpgAAAFAEAJ0BKhQADgA/CW6uT6umJCIwCAFwIQlsAJ0ygVYAA+Kxh23YxlZeGYAAzEyuDAVYcf/IqCJS353rslWDp1ushhfYRnHa46CZL21UpORj4qnBe3dRNeblG/eNuYl/KsgIhT1+ctuB6ao30wChPmzNg2Ao8kJMZFsi629K/Or99FFXwy4c5sfxFixYp4yTkW2jE/gNTNztNv8WNs2tdoqMAyzAAAA=';

/** Hexagon-framed icon chip. Used as the section mark on every panel header. */
function HexIcon({ icon, color = '#F5C842', size = 44 }) {
  return (
    <span className="relative shrink-0 grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
        <polygon
          points="50,3 91,26.5 91,73.5 50,97 9,73.5 9,26.5"
          fill={`${color}0F`} stroke={color} strokeWidth="4" strokeOpacity="0.55"
        />
      </svg>
      <Icon name={icon} className="relative" style={{ color, fontSize: size * 0.42 }} />
    </span>
  );
}

function PanelHead({ icon, title, accentWord, subtitle, info, right, color = '#F5C842' }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <HexIcon icon={icon} color={color} />
        <div className="min-w-0">
          <div className="text-[22px] font-bold text-text-primary leading-tight">
            {title} {accentWord && <span style={GOLD_TEXT}>{accentWord}</span>}
          </div>
          <div className="text-xs text-text-muted mt-0.5 flex items-center gap-1.5">
            {subtitle}
            {info && <InfoDot label={title}>{info}</InfoDot>}
          </div>
        </div>
      </div>
      {right}
    </div>
  );
}

/** Small select styled as the mockup's pill dropdown. */
function RangePicker({ value, onChange, options, icon = 'calendar_month' }) {
  return (
    <label
      className="relative shrink-0 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-text-primary cursor-pointer"
      style={{ background: 'rgba(255,255,255,0.03)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.10)' }}
    >
      <Icon name={icon} className="text-base" style={{ color: '#F5C842' }} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent outline-none appearance-none pr-5 cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: '#14151C' }}>{o.label}</option>
        ))}
      </select>
      <Icon name="expand_more" className="text-base text-text-muted absolute right-2 pointer-events-none" />
    </label>
  );
}

// ── Set up payouts ────────────────────────────────────────────────────

/**
 * Enrolment banner. Only rendered when the creator is NOT enrolled, so it
 * disappears the moment setup is done rather than nagging forever.
 */
function SetUpPayouts({ navigate }) {
  const [artOk, setArtOk] = useState(true);
  return (
    <div className="vg-material vg-grain vg-beam rounded-2xl overflow-hidden">
      <div className="relative z-[1] grid gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:items-center">
        <div className="flex items-start gap-4">
          <HexIcon icon="account_balance" size={56} />
          <div className="min-w-0">
            <div className="text-[26px] font-bold text-text-primary leading-tight">
              Set up <span style={GOLD_TEXT}>payouts</span>
            </div>
            <p className="text-sm text-text-secondary mt-2 leading-relaxed">
              You are earning. To be paid we need your identity, a tax form and a payout account.
              It takes a few minutes and only has to be done once.
            </p>
            <button
              onClick={() => navigate('/creator/earnings/setup')}
              className="mt-5 inline-flex items-center gap-2 rounded-xl px-5 py-3 font-bold text-[#1A1408] transition-transform active:scale-[0.98]"
              style={{
                background: `linear-gradient(180deg, ${GOLD_STOPS[1]}, ${GOLD_STOPS[2]})`,
                boxShadow: '0 8px 24px -10px rgba(240,180,50,0.8)',
              }}
            >
              Start setup
              <Icon name="arrow_forward" className="text-lg" />
            </button>
          </div>
        </div>

        <div className="relative hidden lg:flex items-center justify-center min-h-[190px] overflow-hidden rounded-xl">
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(58% 62% at 52% 52%, rgba(240,165,0,0.20), transparent 72%)' }}
          />
          {artOk && (
            <picture>
              <source
                media="(min-width: 1024px)"
                type="image/webp"
                srcSet="/brand/earnings/payout-wallet.webp 1x, /brand/earnings/payout-wallet@2x.webp 2x"
              />
              <img
                src={WALLET_LQIP}
                alt="" aria-hidden width={306} height={210}
                decoding="async" fetchPriority="high"
                onError={() => setArtOk(false)}
                className="relative max-h-[210px] w-auto object-contain select-none pointer-events-none"
                style={{ filter: 'drop-shadow(0 14px 34px rgba(0,0,0,0.6))' }}
              />
            </picture>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Earnings over time ────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon, tone }) {
  const t = TILE_TONES[tone] || TILE_TONES.gold;
  return (
    <div
      className="vg-wash relative rounded-[11px] p-4"
      style={{ '--vg-accent': t.accent, '--vg-wash': t.wash }}
    >
      <div className="relative z-[2] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] text-text-muted font-bold uppercase tracking-wider">{label}</div>
          <div className={`${NUM} text-[26px] text-text-primary mt-1 leading-none`}>{value}</div>
          {sub && <div className="text-xs mt-2">{sub}</div>}
        </div>
        <span
          className="shrink-0 grid place-items-center w-10 h-10 rounded-full"
          style={{ background: `${t.icon}1A`, boxShadow: `inset 0 0 0 1px ${t.icon}55` }}
        >
          <Icon name={icon} className="text-lg" style={{ color: t.icon }} />
        </span>
      </div>
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Earnings over time. Bar and line are the same series, toggled, matching the
 * two mockups. Months come from real gem-earning transactions; the value labels
 * above each bar are in the mockup and are genuinely useful at 12 points.
 */
function EarningsOverTime({ transactions, payoutCount = 0, wallet, txCapped }) {
  // Earnings come from the LEDGER, not from wallets/{uid}.totalGemsEarned.
  //
  // That aggregate is not trustworthy: adminEconomy.grantCurrency incremented it
  // on every admin gem grant, so support credits and test grants were reported
  // as earnings. Fixed at the source, but existing wallets still carry the
  // inflated figure and there is no migration (Part 2 decision 7: balances today
  // are test data, clean cutover).
  //
  // The ledger is the auditable record: every row has a type, an amount and a
  // timestamp the creator can be shown. If a figure is ever questioned, it can
  // be reconciled line by line, which an aggregate cannot.
  const [mode, setMode] = useState('bar');
  const [range, setRange] = useState('12');

  const { data, total: windowTotal, avg, best, growth, lifetimeKept } = useMemo(() => {
    const months = Number(range);
    const now = new Date();
    const buckets = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      buckets.push({ key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`, name: MONTHS[d.getUTCMonth()], usd: 0 });
    }
    const index = new Map(buckets.map((b, i) => [b.key, i]));
    for (const t of transactions || []) {
      if (!isEarning(t)) continue;
      const d = new Date(tsMs(t.createdAt));
      const i = index.get(`${d.getUTCFullYear()}-${d.getUTCMonth()}`);
      if (i != null) buckets[i].usd += earnedMicro(t) / 1e6;
    }
    const vals = buckets.map((b) => b.usd);
    const sum = vals.reduce((a, b) => a + b, 0);
    const nonZero = vals.filter((v) => v > 0).length || 1;
    const peakIdx = vals.indexOf(Math.max(...vals));
    const half = Math.floor(buckets.length / 2);
    const prev = vals.slice(0, half).reduce((a, b) => a + b, 0);
    const recent = vals.slice(half).reduce((a, b) => a + b, 0);
    // Lifetime is the whole allowlisted ledger, not just the charted window.
    const lifetimeKept = (transactions || [])
      .filter(isEarning)
      .reduce((a, t) => a + earnedMicro(t), 0) / 1e6;

    return {
      data: buckets,
      lifetimeKept,
      total: sum,
      avg: sum / nonZero,
      best: sum > 0 ? { name: buckets[peakIdx].name, v: vals[peakIdx] } : null,
      growth: prev > 0 ? ((recent - prev) / prev) * 100 : null,
    };
  }, [transactions, range]);

  const money = (v) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // The CHART is a time series so it must come from the ledger; only the
  // lifetime KPI is wallet-backed. When the ledger window is capped, say so
  // rather than presenting a partial series as complete.
  const empty = windowTotal <= 0;

  return (
    <div className="vg-material vg-grain vg-beam rounded-2xl overflow-hidden">
      <div className="relative z-[1] p-5">
        <PanelHead
          icon={mode === 'bar' ? 'bar_chart' : 'show_chart'}
          title="Earnings" accentWord="over time"
          subtitle="What you kept, by month"
          info="Every figure here is your share of what you earned, after your revenue share rate is applied. Shown in USD and updated daily."
          right={
            <RangePicker
              value={range} onChange={setRange}
              options={[{ value: '6', label: 'Last 6 months' }, { value: '12', label: 'Last 12 months' }]}
            />
          }
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 mt-4">
          <KpiCard
            label="Your share, all time" tone="gold" icon="paid" value={usdStr(lifetimeKept)}
            sub={growth == null ? <span className="text-text-muted">Kept after your revenue share</span> : (
              <span className={growth >= 0 ? 'text-emerald-400' : 'text-brand-ember'}>
                {growth >= 0 ? '↗' : '↘'} {Math.abs(growth).toFixed(0)}% vs previous period
              </span>
            )}
          />
          <KpiCard label="Avg. monthly" tone="violet" icon="calendar_month" value={money(avg)}
            sub={<span className="text-text-muted">Across months with earnings</span>} />
          <KpiCard label="Highest month" tone="blue" icon="military_tech"
            value={best ? money(best.v) : '$0.00'}
            sub={<span className="text-text-muted">{best ? best.name : 'No earnings yet'}</span>} />
          <KpiCard label="Payouts received" tone="emerald" icon="account_balance_wallet"
            value={String(payoutCount)}
            sub={<span className="text-text-muted">Total successful payouts</span>} />
        </div>

        <div className="mt-4 rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.015)' }}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-bold uppercase tracking-wider" style={{ color: '#F5C842' }}>Earnings</span>
              <span className="text-text-muted">(USD)</span>
            </div>
            <div
              className="inline-flex rounded-lg p-0.5"
              style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.10)' }}
            >
              {[['bar', 'bar_chart'], ['line', 'show_chart']].map(([m, ic]) => (
                <button
                  key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
                  className="px-3 py-1.5 rounded-md transition-colors"
                  style={mode === m
                    ? { background: 'rgba(240,180,50,0.14)', boxShadow: 'inset 0 0 0 1px rgba(240,180,50,0.45)' }
                    : {}}
                >
                  <Icon name={ic} className="text-base" style={{ color: mode === m ? '#F5C842' : '#6B7280' }} />
                </button>
              ))}
            </div>
          </div>

          {empty ? (
            <div className="h-[240px] grid place-items-center text-sm text-text-muted">
              Nothing to chart yet. Your first earnings will appear here.
            </div>
          ) : (
            <div className="mt-3">
              <EarningsChart data={data} mode={mode} />
            </div>
          )}
        </div>

        <div
          className="mt-4 rounded-xl p-3 flex items-center gap-3"
          style={{ background: 'rgba(255,255,255,0.02)' }}
        >
          <span className="shrink-0 grid place-items-center w-8 h-8 rounded-full"
                style={{ background: 'rgba(240,180,50,0.12)', boxShadow: 'inset 0 0 0 1px rgba(240,180,50,0.30)' }}>
            <Icon name="auto_awesome" className="text-sm" style={{ color: '#F5C842' }} />
          </span>
          <div className="text-xs text-text-secondary">
            {txCapped
              ? 'Chart covers your most recent activity. "Your share, all time" is your complete lifetime total.'
              : 'Updated daily. Every figure is what you kept, in USD.'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Where it came from ────────────────────────────────────────────────

function WhereItCameFrom({ bySource, totalUsd }) {
  const [sel, setSel] = useState(0);
  // `value` is already USD: the ledger rows carry micro-USD and the aggregator
  // divides once, at the point of summing.
  const rows = (bySource || []).map((s) => ({
    ...s,
    usd: s.value,
    pct: totalUsd > 0 ? (s.value / totalUsd) * 100 : 0,
  }));
  const money = (v) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (!rows.length) {
    return (
      <div className="vg-material vg-grain vg-beam rounded-2xl p-6">
        <div className="relative z-[1]">
          <PanelHead icon="donut_large" title="Where it" accentWord="came from"
                     subtitle="Breakdown of your earnings by source" />
          <div className="h-[160px] grid place-items-center text-sm text-text-muted">
            Once you start earning, this shows which sources brought in the most.
          </div>
        </div>
      </div>
    );
  }

  const top = rows[0];
  const SOURCE_ICON = {
    'Live streams': 'sensors', 'Post tips': 'favorite', 'Subscriptions': 'workspace_premium',
    'Memberships': 'stars', 'Locked content': 'lock', 'Paid access': 'confirmation_number',
    'Vergr.me': 'storefront', 'Other': 'more_horiz',
  };

  return (
    <div className="vg-material vg-grain vg-beam rounded-2xl overflow-hidden">
      <div className="relative z-[1] p-5">
        <PanelHead icon="donut_large" title="Where it" accentWord="came from"
                   subtitle="Breakdown of your earnings by source"
                   info="Grouped from what you earned. Percentages are of the total shown in the centre." />

        <div className="grid gap-5 mt-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.1fr)] xl:items-center">
          <div>
            {rows.map((r, i) => (
              <button
                key={r.name} onClick={() => setSel(i)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors"
                style={i === sel
                  ? { background: `linear-gradient(90deg, ${r.color}1F 0%, transparent 85%)`,
                      boxShadow: `inset 2px 0 0 ${r.color}` }
                  : {}}
              >
                <span className="shrink-0 grid place-items-center w-8 h-8 rounded-lg"
                      style={{ background: `${r.color}1A`, boxShadow: `inset 0 0 0 1px ${r.color}44` }}>
                  <Icon name={SOURCE_ICON[r.name] || 'more_horiz'} className="text-base" style={{ color: r.color }} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text-primary font-bold truncate">{r.name}</div>
                  <div className="text-[11px] text-text-muted">{r.pct.toFixed(1)}%</div>
                </div>
                <span className={`${NUM} text-sm shrink-0`} style={{ color: i === sel ? r.color : '#E0E0E3' }}>
                  {money(r.usd)}
                </span>
              </button>
            ))}
            <div className="vg-rule-h my-2" />
            <div className="flex items-center justify-between px-3 pb-1">
              <span className="text-sm text-text-secondary">Total earnings</span>
              <span className={`${NUM} text-sm`} style={GOLD_TEXT}>{money(totalUsd)}</span>
            </div>
          </div>

          <div className="min-w-0">
            <DonutChart data={bySource} centerLabel="Total earnings" centerValue={money(totalUsd)} />
          </div>

          <div className="min-w-0">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-[10px] uppercase tracking-wider text-text-muted pb-2">
              <span>Source</span><span className="text-right">% of earnings</span><span className="text-right">Amount</span>
            </div>
            <div className="vg-rule-h" />
            {rows.map((r) => (
              <div key={r.name} className="grid grid-cols-[1fr_auto_auto] gap-x-4 items-center py-2.5 text-sm">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: r.color }} />
                  <span className="text-text-secondary truncate">{r.name}</span>
                </span>
                <span className={`${NUM} text-text-secondary text-right`}>{r.pct.toFixed(1)}%</span>
                <span className={`${NUM} text-text-primary text-right`}>{money(r.usd)}</span>
              </div>
            ))}

            <div className="vg-wash rounded-xl p-3.5 mt-3 flex items-start gap-3"
                 style={{ '--vg-accent': '#6E5222', '--vg-wash': 'rgba(35,27,11,0.95)' }}>
              <span className="relative z-[2] shrink-0 grid place-items-center w-10 h-10 rounded-xl"
                    style={{ background: `${top.color}1A`, boxShadow: `inset 0 0 0 1px ${top.color}55` }}>
                <Icon name={SOURCE_ICON[top.name] || 'trending_up'} className="text-lg" style={{ color: top.color }} />
              </span>
              <div className="relative z-[2] min-w-0">
                <div className="text-sm font-bold" style={{ color: '#F5C842' }}>Top source</div>
                <div className="text-xs text-text-secondary mt-0.5">
                  {top.name} brought in the most, {top.pct.toFixed(1)}% of everything you earned.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Chart ─────────────────────────────────────────────────────────────

/**
 * One series, two renderings. Recharts is already a dependency, so this reuses
 * it rather than hand-rolling SVG. The gold vertical gradient and the value
 * labels above each point are both in the mockups and are readable at 12
 * points; they are suppressed under 4px of bar height so they never collide.
 */
function EarningsChart({ data, mode, height = 260 }) {
  const label = (v) => (v > 0 ? `$${Math.round(v)}` : '');
  const axis = { stroke: '#6B7280', fontSize: 11, tickLine: false, axisLine: false };
  return (
    <ResponsiveContainer width="100%" height={height}>
      {mode === 'bar' ? (
        <BarChart data={data} margin={{ top: 22, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="vgBar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GOLD_STOPS[1]} />
              <stop offset="55%" stopColor={GOLD_STOPS[2]} />
              <stop offset="100%" stopColor={GOLD_STOPS[3]} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="4 6" vertical={false} />
          <XAxis dataKey="name" {...axis} />
          <YAxis {...axis} tickFormatter={(v) => (v >= 1000 ? `$${v / 1000}K` : `$${v}`)} />
          <RTooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            contentStyle={{ background: '#14151C', border: 0, borderRadius: 12,
              boxShadow: '0 10px 30px -8px rgba(0,0,0,.95), inset 0 0 0 1px rgba(255,255,255,.10)' }}
            labelStyle={{ color: '#9CA3AF', fontSize: 11 }}
            formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Earnings']}
          />
          <Bar dataKey="usd" fill="url(#vgBar)" radius={[4, 4, 0, 0]} maxBarSize={46}>
            <LabelList dataKey="usd" position="top" formatter={label}
                       style={{ fill: GOLD_STOPS[1], fontSize: 11, fontWeight: 700 }} />
          </Bar>
        </BarChart>
      ) : (
        <AreaChart data={data} margin={{ top: 22, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="vgArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GOLD_STOPS[2]} stopOpacity={0.55} />
              <stop offset="100%" stopColor={GOLD_STOPS[3]} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="4 6" vertical={false} />
          <XAxis dataKey="name" {...axis} />
          <YAxis {...axis} tickFormatter={(v) => (v >= 1000 ? `$${v / 1000}K` : `$${v}`)} />
          <RTooltip
            cursor={{ stroke: 'rgba(255,255,255,0.18)' }}
            contentStyle={{ background: '#14151C', border: 0, borderRadius: 12,
              boxShadow: '0 10px 30px -8px rgba(0,0,0,.95), inset 0 0 0 1px rgba(255,255,255,.10)' }}
            labelStyle={{ color: '#9CA3AF', fontSize: 11 }}
            formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Earnings']}
          />
          <Area
            type="linear" dataKey="usd" stroke={GOLD_STOPS[1]} strokeWidth={2}
            fill="url(#vgArea)"
            dot={{ r: 3.5, fill: GOLD_STOPS[1], stroke: '#0B0B14', strokeWidth: 2 }}
            activeDot={{ r: 5, fill: GOLD_STOPS[0] }}
          />
        </AreaChart>
      )}
    </ResponsiveContainer>
  );
}

// ── Block B ───────────────────────────────────────────────────────────

/* Card accents sampled from the founder's mockup. Each card is one wash:
 * border saturated at the top (#33552D / #5C431B / #4F245F) dying to #000105 at
 * the bottom, fill anchored top-left (#1A3718 / #231B0B / #190D21) dying to
 * near-black bottom-right. Radius measured at 11px. */
const TILE_TONES = {
  emerald: { accent: '#3E6B35', wash: 'rgba(26,55,24,0.95)',  value: 'text-emerald-400',           icon: '#34D399' },
  gold:    { accent: '#6E5222', wash: 'rgba(35,27,11,0.95)',  value: 'text-text-primary',          icon: '#F5C842' },
  violet:  { accent: '#5C2B6E', wash: 'rgba(25,13,33,0.95)',  value: 'text-brand-violet-light',    icon: '#B44FFF' },
  blue:    { accent: '#1F4A6E', wash: 'rgba(12,28,44,0.95)',  value: 'text-text-primary',          icon: '#3D7FFF' },
};

function MoneyTile({ label, value, sub, tone = 'gold', big, icon }) {
  const t = TILE_TONES[tone] || TILE_TONES.gold;
  return (
    <div
      className="vg-wash relative rounded-[11px] p-4 overflow-hidden"
      style={{ '--vg-accent': t.accent, '--vg-wash': t.wash }}
    >
      <div className="relative z-[2] flex items-start gap-3">
        {icon && (
          <span className="shrink-0 grid place-items-center w-9 h-9 rounded-lg"
                style={{ background: t.wash, boxShadow: `inset 0 0 0 1px ${t.accent}` }}>
            <Icon name={icon} className="text-lg" style={{ color: t.accent }} filled />
          </span>
        )}
        <div className="min-w-0">
          <div className="text-[11px] text-text-muted font-bold uppercase tracking-wider">{label}</div>
          <div className={`${NUM} ${big ? 'text-3xl' : 'text-2xl'} ${t.value} mt-1`}>{value}</div>
          {sub && <div className="text-xs text-text-muted mt-1">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Block C ───────────────────────────────────────────────────────────

/**
 * Five states, all of which occur in practice. Two of them (below-minimum and
 * suspended) read naturally as "we took your money", so both say plainly that
 * nothing is lost and earnings keep accruing.
 */
function NextPayoutCard({ account, navigate }) {
  const cadence = account?.cadence || 'standard';
  const meta = CADENCE_META[cadence] || CADENCE_META.standard;
  const next = nextPayoutDate(cadence);
  const days = daysUntil(next);
  const blocked = account?.blockedBy;

  if (account?.suspended) {
    return (
      <Card className="p-5 border border-brand-ember/40">
        <div className="flex items-start gap-3">
          <Icon name="pause_circle" className="text-brand-ember text-2xl shrink-0" />
          <div className="min-w-0">
            <div className="font-bold text-text-primary">Payouts paused</div>
            <p className="text-sm text-text-secondary mt-1">
              Your account is under review. You are still earning and nothing has been lost.{' '}
              <span className={`${NUM} text-text-primary`}>{usd(account.availableMicroUsd)}</span> is being held for you.
            </p>
            <button
              onClick={() => navigate('/help')}
              className="mt-3 px-4 py-2 rounded-lg bg-surface-2 text-text-primary text-sm font-bold hover:bg-white/10"
            >
              Contact support
            </button>
          </div>
        </div>
      </Card>
    );
  }

  if (blocked && blocked !== 'below_minimum') {
    const cta = {
      kyc_required: ['Verify your identity', '/creator/earnings/setup'],
      tax_form_required: ['Add your tax form', '/creator/earnings/setup'],
      payout_account_required: ['Connect a payout account', '/creator/earnings/setup'],
      frozen: ['Contact support', '/help'],
      account_too_new: [null, null],
    }[blocked] || ['Finish setup', '/creator/earnings/setup'];

    // Nothing to finish here: the only thing missing is time. Saying "finish
    // setup" to someone with nothing left to do is the worst version of this.
    if (blocked === 'account_too_new') {
      const left = Math.max(0, (account?.minAccountAgeDays ?? 30) - (account?.accountAgeDays ?? 0));
      return (
        <Card className="p-5 border border-brand-gold/40">
          <div className="flex items-start gap-3">
            <Icon name="hourglass_top" className="text-brand-gold text-2xl shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-bold text-text-primary">Your first payout unlocks soon</div>
              <p className="text-sm text-text-secondary mt-1">
                Accounts need to be {account?.minAccountAgeDays ?? 30} days old before a payout can be
                sent. {left > 0
                  ? <>That is <span className={`${NUM} text-text-primary`}>{left}</span> {left === 1 ? 'day' : 'days'} away.</>
                  : 'You have reached it.'} Your{' '}
                <span className={`${NUM} text-text-primary`}>{usd(account?.availableMicroUsd)}</span> keeps
                accruing and stays yours.
              </p>
            </div>
          </div>
        </Card>
      );
    }

    return (
      <Card className="p-5 border border-brand-gold/40">
        <div className="flex items-start gap-3">
          <Icon name="warning" className="text-brand-gold text-2xl shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-bold text-text-primary">Finish setup to get paid</div>
            <p className="text-sm text-text-secondary mt-1">
              You have <span className={`${NUM} text-text-primary`}>{usd(account.availableMicroUsd)}</span> waiting.
              It stays yours until we can send it.
            </p>
            <button
              onClick={() => navigate(cta[1])}
              className="mt-3 px-4 py-2 rounded-lg bg-brand-violet text-white text-sm font-bold hover:brightness-110"
            >
              {cta[0]}
            </button>
          </div>
        </div>
      </Card>
    );
  }

  if (blocked === 'below_minimum') {
    const short = (account.minimumMicroUsd || 0) - (account.availableMicroUsd || 0);
    const pct = Math.min(100, ((account.availableMicroUsd || 0) / (account.minimumMicroUsd || 1)) * 100);
    return (
      <Card className="p-5">
        <div className="font-bold text-text-primary">
          <span className={NUM}>{usd(short)}</span> to go
        </div>
        <div className="mt-3 h-2 rounded-full bg-surface-2 overflow-hidden">
          <div className="h-full rounded-full bg-brand-violet-light" style={{ width: `${Math.max(2, pct)}%` }} />
        </div>
        <p className="text-sm text-text-secondary mt-3">
          You need <span className={`${NUM} text-text-primary`}>{usd(account.minimumMicroUsd)}</span> before a payout
          is sent. Your <span className={`${NUM} text-text-primary`}>{usd(account.availableMicroUsd)}</span> carries
          over to the next one. Nothing is lost.
        </p>
      </Card>
    );
  }

  const reduced = (account?.activeStrikes || 0) > 0;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs text-text-muted font-bold uppercase tracking-wide">Next payout</div>
          <div className={`${NUM} text-2xl text-text-primary mt-1`}>{fmtDate(next)}</div>
          <div className="text-xs text-text-muted">{days != null ? `in ${days} day${days === 1 ? '' : 's'}` : ''}</div>
        </div>
        <div className="text-right">
          <div className={`${NUM} text-2xl text-brand-gold`}>{usd(account?.availableMicroUsd)}</div>
          <div className="text-xs text-text-muted">will be sent</div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <span className="px-2 py-1 rounded-md bg-surface-2 text-xs font-bold text-text-secondary">
          {meta.pays}
        </span>
        <span className="px-2 py-1 rounded-md bg-brand-violet/15 text-xs font-bold text-brand-violet-light">
          {meta.label}
        </span>
      </div>

      {reduced && (
        <p className="text-sm text-brand-gold mt-3">
          Your payout speed was reduced and returns automatically when the strike expires.
        </p>
      )}

      {!reduced && meta.next && (
        <p className="text-xs text-text-muted mt-3">
          <span className={`${NUM} text-text-secondary`}>{account?.successfulPayouts || 0}</span> payouts so far · {meta.next} as your account matures
        </p>
      )}
    </Card>
  );
}

// ── Block D ───────────────────────────────────────────────────────────

/**
 * Hover/tap explainer. NOT `components/InfoTooltip`, which is a dismissible
 * banner that renders once and then stores a localStorage flag: wiring that to
 * a per-figure "i" would make the icon disappear permanently after one read.
 * This is a transient popover, so it can be asked the same question twice.
 */
function InfoDot({ children, label = 'What this means', side = 'right' }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        aria-label={label}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onBlur={() => setOpen(false)}
        className="grid place-items-center w-[15px] h-[15px] rounded-full text-text-muted hover:text-text-secondary transition-colors"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.22)' }}
      >
        <Icon name="info" className="text-[11px]" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-50 bottom-full mb-2 w-[240px] rounded-xl p-3 text-[11px] leading-relaxed text-text-secondary pointer-events-none"
          style={{
            [side === 'right' ? 'left' : 'right']: -8,
            background: '#14151C',
            boxShadow: '0 10px 30px -8px rgba(0,0,0,0.95), inset 0 0 0 1px rgba(255,255,255,0.10)',
          }}
        >
          {children}
        </span>
      )}
    </span>
  );
}

/**
 * Payout speed. Three requirements, all driven by real account fields rather
 * than copy: age from the account's own creation date, `successfulPayouts`,
 * and `activeStrikes`. Where a value is genuinely unknown it says so instead
 * of showing a green tick.
 *
 * Thresholds mirror the cadence ladder the server enforces:
 *   established  90 days + 3 payouts,  priority  180 days + 12 payouts.
 */
const SPEED_META = {
  standard:    { name: 'Standard',  window: 'Paid monthly',       next: 'established' },
  established: { name: 'Faster',    window: 'Paid twice a month', next: 'priority' },
  priority:    { name: 'Fastest',   window: 'Paid weekly',        next: null },
};

function ReqRow({ icon, title, detail, met, unknown }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span
        className="shrink-0 grid place-items-center w-9 h-9 rounded-xl"
        style={{ background: 'rgba(240,180,50,0.10)', boxShadow: 'inset 0 0 0 1px rgba(240,180,50,0.22)' }}
      >
        <Icon name={icon} className="text-base" style={{ color: '#F5C842' }} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-text-primary">{title}</div>
        <div className="text-xs text-text-muted">{detail}</div>
      </div>
      <span className={`shrink-0 flex items-center gap-1.5 text-xs font-bold ${
        unknown ? 'text-text-muted' : met ? 'text-emerald-400' : 'text-text-muted'
      }`}>
        <Icon
          name={unknown ? 'help' : met ? 'check_circle' : 'radio_button_unchecked'}
          className="text-base"
          filled={!unknown && met}
        />
        {unknown ? 'Unknown' : met ? 'Completed' : 'Not yet'}
      </span>
    </div>
  );
}

function PayoutSpeed({ account, statements }) {
  const cadence = account?.cadence || 'standard';
  const meta = SPEED_META[cadence] || SPEED_META.standard;

  // Thresholds come from the server (getPayoutAccount.nextCadence) so this can
  // never drift from what resolveCadence() actually enforces. Note the real
  // gate is days since FIRST PAYOUT, not account age as the mockup labels it,
  // and it includes a KYC level the mockup omits. This decides when someone
  // gets paid, so it follows the rule rather than the picture.
  const req = account?.nextCadence || null;
  const days = account?.daysSinceFirstPayout;
  const payouts = Number(account?.successfulPayouts ?? statements?.length ?? 0);
  const strikes = Number(account?.activeStrikes || 0);
  const kyc = Number(account?.kycLevel || 0);

  const daysMet = req ? days != null && days >= req.minDaysSinceFirstPayout : true;
  const payMet = req ? payouts >= req.minSuccessfulPayouts : true;
  const kycMet = req ? kyc >= req.minKyc : true;
  const cleanMet = strikes === 0 && !account?.suspended;
  const eligible = daysMet && payMet && kycMet && cleanMet;
  const nextKey = req?.key || null;

  return (
    <div className="vg-material vg-grain vg-beam rounded-2xl overflow-hidden">
      <div className="relative z-[1] p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span
              className="shrink-0 grid place-items-center w-11 h-11 rounded-xl"
              style={{ background: 'rgba(240,180,50,0.10)', boxShadow: 'inset 0 0 0 1px rgba(240,180,50,0.28)' }}
            >
              <Icon name="speed" className="text-xl" style={{ color: '#F5C842' }} />
            </span>
            <div>
              <div className="text-xl font-bold text-text-primary">
                Payout <span style={GOLD_TEXT}>speed</span>
              </div>
              <div className="text-xs text-text-muted mt-0.5">The faster you qualify, the faster you get paid.</div>
            </div>
          </div>

          <div className="text-right">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold"
              style={{
                background: eligible ? 'rgba(16,185,129,0.14)' : 'rgba(255,255,255,0.06)',
                color: eligible ? '#34D399' : '#9CA3AF',
                boxShadow: `inset 0 0 0 1px ${eligible ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.12)'}`,
              }}
            >
              <Icon name={eligible ? 'check_circle' : 'schedule'} className="text-sm" filled={eligible} />
              {nextKey ? (eligible ? 'ELIGIBLE' : 'IN PROGRESS') : 'TOP SPEED'}
            </span>
            <div className="text-xs text-text-muted mt-1.5">
              {nextKey
                ? eligible ? 'You qualify for faster payouts' : 'Keep going to unlock faster payouts'
                : 'You are on the fastest schedule'}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted mb-2">
            Before a payout can be sent
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {[
              { k: 'strikes',  label: 'Account in good standing',
                ok: strikes < 3 && !account?.suspended,
                detail: strikes >= 3 ? 'Payouts are suspended by strikes' : 'No suspension on your account' },
              { k: 'frozen',   label: 'Account not frozen',
                ok: account?.blockedBy !== 'frozen',
                detail: account?.blockedBy === 'frozen' ? 'Your payouts are frozen' : 'Active' },
              { k: 'age',      label: 'Account old enough',
                ok: (account?.accountAgeDays ?? 0) >= (account?.minAccountAgeDays ?? 30),
                detail: account?.accountAgeDays == null
                  ? 'We could not read your account start date'
                  : `${account.accountAgeDays} of ${account.minAccountAgeDays ?? 30} days` },
              { k: 'kyc',      label: 'Identity verified',
                ok: kyc >= 1,
                detail: kyc >= 1 ? 'Verification complete' : 'Required before any payout' },
              { k: 'tax',      label: 'Tax form on file',
                ok: account?.taxFormStatus === 'on_file',
                detail: account?.taxFormStatus === 'on_file' ? `${account?.taxFormType || 'Form'} received` : 'Not yet submitted' },
              { k: 'payee',    label: 'Payout account connected',
                ok: !!account?.payoutAccountConnected,
                detail: account?.payoutAccountConnected ? 'Ready to receive' : 'Not connected yet' },
              { k: 'minimum',  label: 'Balance over the minimum',
                ok: Number(account?.availableMicroUsd || 0) >= Number(account?.minimumMicroUsd || 0),
                detail: `${usd(account?.availableMicroUsd)} of ${usd(account?.minimumMicroUsd)} minimum` },
            ].map((g) => (
              <div key={g.k} className="flex items-center gap-2.5 rounded-lg px-3 py-2"
                   style={{ background: 'rgba(255,255,255,0.02)' }}>
                <Icon
                  name={g.ok ? 'check_circle' : 'error'}
                  className="text-base shrink-0"
                  filled={g.ok}
                  style={{ color: g.ok ? '#34D399' : '#F0A500' }}
                />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-text-primary truncate">{g.label}</div>
                  <div className="text-[11px] text-text-muted truncate">{g.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="vg-rule-h my-4" />

        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-muted mb-1">
          What sets your speed
        </div>

        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_auto_minmax(0,1fr)]">
          <div>
            {req ? (
              <>
                <ReqRow
                  icon="history" title="Payout history length"
                  detail={days == null
                    ? 'Starts counting from your first payout'
                    : `${days} ${days === 1 ? 'day' : 'days'} since your first payout, ${req.minDaysSinceFirstPayout} needed`}
                  met={daysMet} unknown={days == null}
                />
                <div className="vg-rule-h" />
                <ReqRow
                  icon="paid" title="Previous payouts"
                  detail={`You have completed ${payouts} of ${req.minSuccessfulPayouts} payouts`}
                  met={payMet}
                />
                <div className="vg-rule-h" />
                <ReqRow
                  icon="badge" title="Identity verified"
                  detail={kycMet ? 'Your identity check is complete' : `Verification level ${req.minKyc} required`}
                  met={kycMet}
                />
                <div className="vg-rule-h" />
                <ReqRow
                  icon="verified_user" title="No issues"
                  detail={strikes > 0
                    ? `${strikes} active ${strikes === 1 ? 'strike' : 'strikes'} on your account`
                    : 'No strikes or policy violations'}
                  met={cleanMet}
                />
              </>
            ) : (
              <div className="py-6 text-sm text-text-secondary">
                You have cleared every requirement. Nothing left to unlock here.
              </div>
            )}
          </div>

          <div className="vg-rule-v hidden lg:block" />

          <div>
            <div className="text-xs text-text-muted">Your current payout speed</div>
            <div className="text-3xl font-bold mt-0.5" style={{ color: '#B44FFF' }}>{meta.name}</div>
            <div className="text-xs text-text-secondary mt-1">{meta.window}.</div>

            <div
              className="vg-wash mt-4 rounded-xl p-3 flex items-center gap-3"
              style={{ '--vg-accent': '#5C2B6E', '--vg-wash': 'rgba(25,13,33,0.95)' }}
            >
              <span
                className="relative z-[2] shrink-0 grid place-items-center w-10 h-10 rounded-full"
                style={{ background: 'rgba(180,79,255,0.12)', boxShadow: 'inset 0 0 0 1px rgba(180,79,255,0.30)' }}
              >
                <Icon name="schedule" className="text-lg" style={{ color: '#B44FFF' }} />
              </span>
              <div className="relative z-[2] min-w-0">
                <div className="text-[11px] text-text-muted">Funds usually arrive within</div>
                <div className="text-lg font-bold" style={{ color: '#B44FFF' }}>1 to 3 business days</div>
                <div className="text-[11px] text-text-muted">after a payout is sent</div>
              </div>
            </div>
          </div>
        </div>

        <div
          className="vg-wash mt-4 rounded-xl p-3.5 flex items-center gap-3 flex-wrap"
          style={{ '--vg-accent': '#5C2B6E', '--vg-wash': 'rgba(25,13,33,0.9)' }}
        >
          <span
            className="relative z-[2] shrink-0 grid place-items-center w-9 h-9 rounded-lg"
            style={{ background: 'rgba(180,79,255,0.12)', boxShadow: 'inset 0 0 0 1px rgba(180,79,255,0.28)' }}
          >
            <Icon name="event_available" className="text-base" style={{ color: '#B44FFF' }} />
          </span>
          <div className="relative z-[2] min-w-0 flex-1">
            <div className="text-sm font-bold text-text-primary">Keep it up</div>
            <div className="text-xs text-text-muted">
              Keep your account in good standing to hold your payout speed.
            </div>
          </div>
          <span className="relative z-[2] flex items-center gap-1.5 text-xs font-bold" style={{ color: '#B44FFF' }}>
            How it works
            <InfoDot side="left" label="How payout speed works">
              Speed is set by your account history, not by a fee. Clear the requirements and the
              schedule moves up on its own. The $100 minimum is the same at every speed.
            </InfoDot>
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Block F ───────────────────────────────────────────────────────────

const STATEMENT_STATUS = {
  paid:    { label: 'Paid',    cls: 'text-brand-gold' },
  pending: { label: 'Pending', cls: 'text-text-secondary' },
  failed:  { label: 'Failed',  cls: 'text-brand-ember' },
};

function Statements({ rows, navigate }) {
  const [page, setPage] = useState(0);
  const PER = 8;
  if (!rows.length) {
    return (
      <div className="vg-material vg-grain rounded-2xl p-8 text-center">
        <div className="relative z-[1]">
          <Icon name="receipt_long" className="text-3xl text-text-muted" />
          <p className="text-sm text-text-secondary mt-2">
            Statements appear here after your first payout. One per payout run.
          </p>
        </div>
      </div>
    );
  }
  const pages = Math.ceil(rows.length / PER);
  const slice = rows.slice(page * PER, page * PER + PER);
  const dt = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

  return (
    <div className="vg-material vg-grain vg-beam rounded-2xl overflow-hidden">
      <div className="relative z-[1] p-5">
        <PanelHead icon="receipt_long" title="Statements" subtitle="One per payout run" />

        <div className="mt-4 overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[130px_150px_1fr_120px_110px_44px] gap-x-4 px-3 pb-2 text-[10px] uppercase tracking-wider text-text-muted">
              <span>Statement ID</span><span>Payout date</span><span>Period</span>
              <span className="text-right">Net payout</span><span>Status</span><span />
            </div>
            <div className="vg-rule-h" />
            {slice.map((r) => {
              const st = STATEMENT_STATUS[r.status] || STATEMENT_STATUS.pending;
              const paidMs = tsMs(r.createdAt);
              const ok = r.status === 'paid';
              return (
                <button
                  key={r.id}
                  onClick={() => navigate(`/creator/earnings/statement/${r.runId}`)}
                  className="w-full grid grid-cols-[130px_150px_1fr_120px_110px_44px] gap-x-4 items-center px-3 py-3 rounded-lg text-left transition-colors hover:bg-white/[0.03]"
                >
                  <span className={`${NUM} text-xs truncate`} style={GOLD_TEXT}>{r.runId || r.id}</span>
                  <span className="flex items-center gap-2 text-sm text-text-secondary">
                    <Icon name="calendar_month" className="text-sm text-text-muted" />
                    {dt(paidMs)}
                  </span>
                  <span className="text-sm text-text-muted truncate">
                    {r.periodFromMs ? `${dt(r.periodFromMs)} to ${dt(paidMs)}` : `${r.cadence || 'standard'} run`}
                  </span>
                  <span className={`${NUM} text-sm text-right`} style={{ color: ok ? '#34D399' : '#E0E0E3' }}>
                    {usd(r.amountMicroUsd)}
                  </span>
                  <span>
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
                      style={{
                        background: ok ? 'rgba(16,185,129,0.14)' : 'rgba(255,255,255,0.06)',
                        color: ok ? '#34D399' : '#9CA3AF',
                        boxShadow: `inset 0 0 0 1px ${ok ? 'rgba(16,185,129,0.32)' : 'rgba(255,255,255,0.12)'}`,
                      }}
                    >
                      <Icon name={ok ? 'check_circle' : 'schedule'} className="text-xs" filled={ok} />
                      {st.label}
                    </span>
                  </span>
                  <span className="grid place-items-center w-8 h-8 rounded-lg justify-self-end"
                        style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.10)' }}>
                    <Icon name="description" className="text-sm text-text-secondary" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-3">
            <button onClick={() => setPage((v) => Math.max(0, v - 1))} disabled={page === 0}
                    className="grid place-items-center w-8 h-8 rounded-lg text-text-secondary disabled:opacity-30">
              <Icon name="chevron_left" className="text-base" />
            </button>
            {Array.from({ length: pages }).map((_, i) => (
              <button key={i} onClick={() => setPage(i)}
                      className={`${NUM} w-8 h-8 rounded-lg text-xs`}
                      style={i === page
                        ? { color: '#F5C842', boxShadow: 'inset 0 0 0 1px rgba(240,180,50,0.45)' }
                        : { color: '#9CA3AF' }}>
                {i + 1}
              </button>
            ))}
            <button onClick={() => setPage((v) => Math.min(pages - 1, v + 1))} disabled={page === pages - 1}
                    className="grid place-items-center w-8 h-8 rounded-lg text-text-secondary disabled:opacity-30">
              <Icon name="chevron_right" className="text-base" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Screen ────────────────────────────────────────────────────────────

export default function CreatorEarningsScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { wallet } = useUser();
  const [transactions, setTransactions] = useState([]);
  const [account, setAccount] = useState(null);
  const [statements, setStatements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    let alive = true;
    (async () => {
      setLoading(true);
      // Settled, not all: one failing source must not blank the whole screen.
      const [tx, acct, stmts] = await Promise.allSettled([
        getTransactions(currentUser.uid, TX_WINDOW),
        getPayoutAccount(),
        getMyPayoutStatements(currentUser.uid, 24),
      ]);
      if (!alive) return;
      if (tx.status === 'fulfilled') setTransactions(tx.value || []);
      if (acct.status === 'fulfilled') setAccount(acct.value || null);
      else console.error('getPayoutAccount', acct.reason);
      if (stmts.status === 'fulfilled') setStatements(stmts.value || []);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [currentUser]);

  const earnedGross = Number(wallet?.totalEarnedCoinsGross || 0);

  const { bySource, stacked } = useMemo(() => {
    const earn = (transactions || []).filter(isEarning);
    const totals = {};
    const byDay = {};
    for (const t of earn) {
      const k = classify(t);
      totals[k] = (totals[k] || 0) + earnedMicro(t) / 1e6;
      const d = new Date(tsMs(t.createdAt)).toISOString().slice(0, 10);
      byDay[d] = byDay[d] || { name: d };
      byDay[d][k] = (byDay[d][k] || 0) + earnedMicro(t) / 1e6;
    }
    return {
      bySource: Object.entries(totals)
        .map(([name, value]) => ({ name, value, color: SOURCE_DEFS.find((s) => s.key === name)?.color }))
        .sort((a, b) => b.value - a.value),
      stacked: Object.values(byDay).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [transactions]);

  // bySource values are already USD.
  const sourceTotalUsd = useMemo(
    () => (bySource || []).reduce((a, b) => a + b.value, 0),
    [bySource],
  );

  const hasEarnings = earnedGross > 0 || (account?.availableMicroUsd || 0) > 0;

  return (
    <CreatorLayout
      page="earnings"
      title="Earnings"
      subtitle="Your revenue share and payouts"
    >
      {loading ? <EarningsSkeleton /> : (
        <div className="space-y-4 pb-10">
          <TierHero earnedGross={earnedGross} />

          {!hasEarnings ? (
            <Card className="p-8 text-center">
              <Icon name="savings" className="text-4xl text-brand-violet-light" />
              <h3 className="text-text-primary font-bold text-lg mt-3">You have not earned yet</h3>
              <p className="text-sm text-text-secondary mt-2 max-w-md mx-auto">
                Every tip, membership and unlock counts toward your lifetime total. You start by
                keeping 50% of the revenue you generate and climb to 80% as that total grows.
                Your rate never goes down.
              </p>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <MoneyTile
                  big label="Available now" tone="emerald" icon="account_balance_wallet"
                  value={usd(account?.availableMicroUsd)}
                  sub="Your share, ready to be paid"
                />
                <MoneyTile
                  label="Next payout date" tone="gold" icon="calendar_month"
                  value={fmtDate(nextPayoutDate(account?.cadence || 'standard'))}
                  sub={CADENCE_META[account?.cadence || 'standard'].pays}
                />
                <MoneyTile
                  label="Paid to date" tone="violet" icon="workspace_premium"
                  value={usd((Number(wallet?.totalPaidOut || 0)) * 10000)}
                  sub="Sent to you across all payouts"
                />
              </div>

              {account?.enrolled
                ? <NextPayoutCard account={account} navigate={navigate} />
                : <SetUpPayouts navigate={navigate} />}

              <PayoutSpeed account={account} statements={statements} />

              <EarningsOverTime
                transactions={transactions}
                payoutCount={statements.length}
                wallet={wallet}
                txCapped={transactions.length >= TX_WINDOW}
              />

              <WhereItCameFrom bySource={bySource} totalUsd={sourceTotalUsd} />

              <Statements rows={statements} navigate={navigate} />
            </>
          )}
        </div>
      )}
    </CreatorLayout>
  );
}
