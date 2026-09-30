// src/components/tournaments/BracketVisualization.jsx
// Visualizes single-elim + double-elim brackets, and round-robin schedules.
//
// Phase 3 (bracket showpiece) — single-elim renders as a measured tree:
// every match card is positioned mathematically (binary-tree centering) and
// an SVG layer draws elbow connector lines from each match into the slot it
// feeds, lighting up cyan as winners advance. Future rounds are synthesized
// as TBD placeholder slots so the full tree is visible from round 1. Seats
// carry avatars; in-progress nodes pulse LIVE and show the OCR live score.
// The losers bracket of double-elim doesn't halve cleanly (2,2,1,1...), so
// it keeps the evenly-spaced column layout (no connector geometry to lie
// about). A BracketFullscreen overlay (drag-to-pan) is exported for the
// full-screen view.
import { useEffect, useRef } from 'react';
import Icon from '../Icon';
import { motion } from 'framer-motion';

// Spring used by every fly-in. Tight enough to feel snappy, loose enough
// the cards don't snap-stop hard.
const FLY_SPRING = { type: 'spring', stiffness: 240, damping: 24, mass: 0.6 };

// 60s "just advanced" window — match cards pulse gold for the first minute
// after a followed player wins or appears in a newly populated next-round slot.
const FOLLOWED_PULSE_MS = 60_000;

// Tree geometry (px). CARD_H is enforced on the card so the math holds.
const CARD_W = 184;
const CARD_H = 68;
const COL_GAP = 64;
const ROW_GAP = 22;
const HEADER_H = 28;

function seatId(p) { return p?.playerId || p?.id || null; }

function SeatAvatar({ p }) {
  if (!p) return null;
  if (p.kind === 'squad') {
    return (
      <div className="w-5 h-5 rounded shrink-0 flex items-center justify-center font-dmmono text-[8px] font-bold"
        style={{
          background: p.banner ? `url(${p.banner}) center/cover` : 'linear-gradient(135deg, #7B1FFF22, #B44FFF22)',
          color: '#fff', border: '1px solid rgba(255,255,255,0.1)',
        }}>
        {!p.banner && (p.tag ? p.tag.slice(0, 3).toUpperCase() : '★')}
      </div>
    );
  }
  if (p.avatar) {
    return <img src={p.avatar} alt="" className="w-5 h-5 rounded-full object-cover shrink-0 border border-white/10" />;
  }
  const letter = (p.name || p.displayName || '?').charAt(0).toUpperCase();
  return (
    <div className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold text-white/80"
      style={{ background: 'linear-gradient(135deg, #7B1FFF44, #B44FFF33)', border: '1px solid rgba(255,255,255,0.1)' }}>
      {letter}
    </div>
  );
}

function MatchCard({ match, followedUids = null, onOpen = null, fixed = false }) {
  // Synthesized future-round slot — render a quiet dashed TBD card.
  if (match.placeholder) {
    return (
      <div
        className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.015] flex flex-col justify-around px-3"
        style={fixed ? { width: CARD_W, height: CARD_H } : { minWidth: 140, height: CARD_H }}
      >
        <span className="text-[10px] text-text-muted/60 italic">TBD</span>
        <div className="h-px bg-white/[0.04]" />
        <span className="text-[10px] text-text-muted/60 italic">TBD</span>
      </div>
    );
  }

  const home = match.home;
  const away = match.away;
  const winner = match.winner;
  const isLive = match.status === 'in_progress';
  // Phase 1 — surface series score (e.g. 2-1) per side. Falls back to the
  // legacy played-flag check for matches still on the pre-Phase-1 shape.
  const showSeriesPip = (match.seriesFormat && match.seriesFormat !== 'bo1')
    || (match.homeScore != null && match.awayScore != null && match.played);
  const render = side => {
    const p = side === 'home' ? home : away;
    const id = seatId(p);
    const isWinner = p && winner && id === winner;
    const isLoser = p && winner && !isWinner;
    const label = p?.name || p?.displayName || 'TBD';
    const score = side === 'home' ? match.homeScore : match.awayScore;
    // Phase 3 — live OCR score (AC1 writes match.liveScore.{uid}) while the
    // match is in progress; final/series score once it isn't.
    const live = isLive && id != null ? match.liveScore?.[id] : null;
    return (
      <div className={`flex items-center gap-2 px-2 py-1 rounded-md min-h-0 ${
        isWinner ? 'bg-brand-violet/15 text-brand-violet-light' :
        isLoser ? 'text-text-muted line-through opacity-60' :
        p ? 'text-text-primary' : 'text-text-muted italic'
      }`}>
        <SeatAvatar p={p} />
        <span className="text-[11px] font-bold truncate flex-1">
          {p?.kind === 'squad' && p.tag && <span className="text-text-muted font-dmmono mr-1 opacity-70">{p.tag}</span>}
          {label}
        </span>
        {live != null && (
          <span className="font-dmmono text-[11px] font-bold tabular-nums text-brand-violet-light">{live}</span>
        )}
        {live == null && showSeriesPip && p && (
          <span className="font-dmmono text-[11px] font-bold tabular-nums opacity-90">{score ?? 0}</span>
        )}
        {isWinner && <Icon name="check" size={12} />}
      </div>
    );
  };
  // Composite key includes the seat occupants — when round N+1 fills in
  // its TBD slots with real players (the bracket advance), the key
  // changes, framer-motion remounts the node, and the new card flies in.
  const seatKey = `${seatId(home) || 'tbd'}__${seatId(away) || 'tbd'}`;

  // Followed-player pulse: gold halo if either seat is a followed uid AND
  // the match is recent (just-won OR newly populated with that follow).
  const homeId = seatId(home);
  const awayId = seatId(away);
  const hasFollow = followedUids
    && ((homeId && followedUids.has(homeId)) || (awayId && followedUids.has(awayId)));
  const completedAtMs = match.completedAt?.toMillis?.() || match.completedAtMs || 0;
  const recentlyDone = completedAtMs && (Date.now() - completedAtMs < FOLLOWED_PULSE_MS);
  const isFollowedAdvance = !!hasFollow && (recentlyDone || (!completedAtMs && (homeId || awayId)));

  const pulse = isFollowedAdvance
    ? { color: 'rgba(240,165,0,0.55)', border: 'border border-brand-gold/60' }
    : isLive
      ? { color: 'rgba(180, 79, 255,0.40)', border: 'border border-brand-violet/50' }
      : null;

  const openable = !!onOpen && !!match.matchId;
  return (
    <motion.div
      key={seatKey}
      onClick={openable ? () => onOpen(match.matchId) : undefined}
      role={openable ? 'button' : undefined}
      title={openable ? 'Open match' : undefined}
      initial={{ opacity: 0, x: -28, scale: 0.96 }}
      animate={pulse ? {
        opacity: 1, x: 0, scale: 1,
        boxShadow: [
          `0 0 0 0 rgba(0,0,0,0)`,
          `0 0 20px 3px ${pulse.color}`,
          `0 0 0 0 rgba(0,0,0,0)`,
        ],
      } : { opacity: 1, x: 0, scale: 1 }}
      transition={pulse
        ? { ...FLY_SPRING, boxShadow: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } }
        : FLY_SPRING
      }
      style={fixed ? { width: CARD_W, height: CARD_H } : { minWidth: 140 }}
      className={`relative bg-surface-1 rounded-lg p-1 flex flex-col justify-around ${openable ? 'cursor-pointer active:opacity-80 transition-opacity' : ''} ${
        pulse ? pulse.border : 'border border-white/[0.06]'
      }`}
    >
      {/* Corner pills (absolute so the card height stays fixed for the tree math) */}
      {isLive && (
        <span className="absolute -top-2 left-2 px-1.5 py-px rounded bg-brand-ember text-white text-[8px] font-bold tracking-widest flex items-center gap-1">
          <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }}
            className="w-1 h-1 rounded-full bg-white inline-block" />
          LIVE
        </span>
      )}
      {match.seriesFormat && match.seriesFormat !== 'bo1' && (
        <span className="absolute -top-2 right-2 px-1.5 py-px rounded bg-surface-2 border border-white/[0.08] text-[8px] font-dmmono uppercase tracking-wider text-text-muted">
          {match.seriesFormat.toUpperCase()}
        </span>
      )}
      {render('home')}
      <div className="h-px bg-white/[0.04]" />
      {render('away')}
    </motion.div>
  );
}

// Round name relative to the FULL tree depth so labels stay correct even
// while later rounds are still synthesized TBD slots.
function roundLabel(rIdx, totalRounds) {
  const fromEnd = totalRounds - 1 - rIdx;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round ${rIdx + 1}`;
}

// Measured binary-tree layout for halving brackets (single-elim / DE winners).
function TreeBracket({ rounds, followedUids, onMatchOpen }) {
  const firstLen = rounds[0].length;
  const totalRounds = Math.max(rounds.length, Math.ceil(Math.log2(Math.max(1, firstLen))) + 1);

  // Synthesize the full tree: pad each round to its expected size (and add
  // missing future rounds) with TBD placeholders so connectors always have
  // a destination and the whole path to the Final is visible from day one.
  const cols = [];
  for (let r = 0; r < totalRounds; r++) {
    const expected = Math.max(1, Math.ceil(firstLen / Math.pow(2, r)));
    const have = rounds[r] || [];
    const col = [];
    for (let i = 0; i < expected; i++) {
      col.push(have[i] || { matchId: null, placeholder: true, home: null, away: null });
    }
    cols.push(col);
  }

  const slot = CARD_H + ROW_GAP;
  const yCenter = (r, i) => slot * Math.pow(2, r) * (i + 0.5);
  const colX = (r) => r * (CARD_W + COL_GAP);
  const width = totalRounds * CARD_W + (totalRounds - 1) * COL_GAP;
  const height = slot * firstLen;

  return (
    <div className="overflow-x-auto">
      <div className="relative min-w-max py-2" style={{ width, height: height + HEADER_H }}>
        {/* Column headers */}
        {cols.map((_, r) => (
          <p key={`h${r}`}
            className="absolute text-text-muted text-[10px] uppercase tracking-widest font-bold text-center"
            style={{ left: colX(r), width: CARD_W, top: 0 }}>
            {roundLabel(r, totalRounds)}
          </p>
        ))}

        {/* Connector lines — elbow from each match into the slot it feeds.
            Cyan once the feeder match has produced a winner. */}
        <svg width={width} height={height} className="absolute left-0 pointer-events-none" style={{ top: HEADER_H }}>
          {cols.map((col, r) => r >= totalRounds - 1 ? null : col.map((m, i) => {
            const x1 = colX(r) + CARD_W;
            const y1 = yCenter(r, i);
            const x2 = colX(r + 1);
            const y2 = yCenter(r + 1, Math.floor(i / 2));
            const midX = x1 + COL_GAP / 2;
            const done = m.played && m.winner;
            return (
              <path key={`c${r}_${i}`}
                d={`M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`}
                fill="none"
                stroke={done ? 'rgba(180, 79, 255,0.55)' : 'rgba(255,255,255,0.10)'}
                strokeWidth={done ? 2 : 1.5}
                strokeLinejoin="round"
              />
            );
          }))}
        </svg>

        {/* Match cards */}
        {cols.map((col, r) => col.map((m, i) => (
          <motion.div
            key={`${r}_${m.matchId || i}`}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...FLY_SPRING, delay: r * 0.06 + i * 0.04 }}
            className="absolute"
            style={{ left: colX(r), top: HEADER_H + yCenter(r, i) - CARD_H / 2 }}
          >
            <MatchCard match={m} followedUids={followedUids} onOpen={onMatchOpen} fixed />
          </motion.div>
        )))}
      </div>
    </div>
  );
}

// Evenly-spaced column layout — used for round shapes that don't halve
// (double-elim losers bracket: 2,2,1,1…), where tree geometry would lie.
function FlexBracket({ rounds, followedUids, onMatchOpen }) {
  return (
    <div className="overflow-x-auto">
      <div className="flex gap-6 min-w-max py-2">
        {rounds.map((round, rIdx) => (
          <motion.div
            key={rIdx}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...FLY_SPRING, delay: rIdx * 0.06 }}
            className="flex flex-col justify-around gap-3"
          >
            <p className="text-text-muted text-[10px] uppercase tracking-widest font-bold text-center">
              Round {rIdx + 1}
            </p>
            {round.map((match, mIdx) => (
              <motion.div
                key={match.matchId}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...FLY_SPRING, delay: rIdx * 0.06 + mIdx * 0.04 }}
              >
                <MatchCard match={match} followedUids={followedUids} onOpen={onMatchOpen} />
              </motion.div>
            ))}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export function SingleElimBracket({ rounds = [], followedUids = null, onMatchOpen = null, tree = true }) {
  if (!rounds.length) {
    return <EmptyState label="Bracket will be generated when the tournament starts" />;
  }
  return tree
    ? <TreeBracket rounds={rounds} followedUids={followedUids} onMatchOpen={onMatchOpen} />
    : <FlexBracket rounds={rounds} followedUids={followedUids} onMatchOpen={onMatchOpen} />;
}

export function DoubleElimBracket({ winners = [], losers = [], grandFinal = [], followedUids = null, onMatchOpen = null }) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-text-secondary text-xs font-bold uppercase tracking-wider mb-2">Winners Bracket</p>
        <SingleElimBracket rounds={winners} followedUids={followedUids} onMatchOpen={onMatchOpen} />
      </div>
      <div>
        <p className="text-text-secondary text-xs font-bold uppercase tracking-wider mb-2">Losers Bracket</p>
        <SingleElimBracket rounds={losers} followedUids={followedUids} onMatchOpen={onMatchOpen} tree={false} />
      </div>
      <div>
        <p className="text-text-secondary text-xs font-bold uppercase tracking-wider mb-2">Grand Final</p>
        <div className="flex">
          {grandFinal.map(m => <MatchCard key={m.matchId} match={m} followedUids={followedUids} onOpen={onMatchOpen} />)}
        </div>
      </div>
    </div>
  );
}

export function RoundRobinSchedule({ rounds = [], onMatchOpen = null }) {
  if (!rounds.length) return <EmptyState label="Schedule will appear once the league begins" />;
  return (
    <div className="space-y-4">
      {rounds.map((round, rIdx) => (
        <div key={rIdx}>
          <p className="text-text-muted text-[10px] uppercase tracking-widest font-bold mb-2">Week {rIdx + 1}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {round.map(m => (
              <div key={m.matchId}
                onClick={onMatchOpen && m.matchId ? () => onMatchOpen(m.matchId) : undefined}
                role={onMatchOpen && m.matchId ? 'button' : undefined}
                className={`bg-surface-1 border border-white/[0.06] rounded-lg p-2.5 flex items-center justify-between gap-2 ${onMatchOpen && m.matchId ? 'cursor-pointer active:opacity-80 transition-opacity' : ''}`}>
                <span className="text-text-primary text-xs font-bold truncate">{m.home?.name || 'TBD'}</span>
                <span className="text-text-muted text-[10px]">
                  {m.played ? `${m.homeScore}–${m.awayScore}` : 'vs'}
                </span>
                <span className="text-text-primary text-xs font-bold truncate text-right">{m.away?.name || 'TBD'}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SwissRoundsList({ rounds = [], onMatchOpen = null }) {
  if (!rounds.length) return <EmptyState label="Pairings will appear round by round" />;
  return (
    <div className="space-y-4">
      {rounds.map((round, rIdx) => (
        <div key={rIdx}>
          <p className="text-text-muted text-[10px] uppercase tracking-widest font-bold mb-2">Round {rIdx + 1}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {round.map(m => (
              <div key={m.matchId}
                onClick={onMatchOpen && m.matchId && !m.bye ? () => onMatchOpen(m.matchId) : undefined}
                role={onMatchOpen && m.matchId && !m.bye ? 'button' : undefined}
                className={`bg-surface-1 border border-white/[0.06] rounded-lg p-2.5 flex items-center justify-between gap-2 ${onMatchOpen && m.matchId && !m.bye ? 'cursor-pointer active:opacity-80 transition-opacity' : ''}`}>
                <span className="text-text-primary text-xs font-bold truncate">
                  {m.home?.name || m.home?.displayName || 'TBD'}
                </span>
                <span className="text-text-muted text-[10px]">{m.bye ? 'BYE' : m.played ? 'DONE' : 'vs'}</span>
                <span className="text-text-primary text-xs font-bold truncate text-right">
                  {m.away?.name || m.away?.displayName || (m.bye ? '—' : 'TBD')}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Phase 3 — full-screen bracket overlay. Renders any bracket content in a
// fixed takeover with drag-to-pan (desktop) + native touch scroll (mobile).
// Escape or the close button exits.
export function BracketFullscreen({ title, onClose, children }) {
  const bodyRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onPointerDown = (e) => {
    // Only pan with mouse — touch gets native scrolling; and never steal a
    // click that lands on a match card (buttons handle their own clicks,
    // a small movement threshold below keeps taps working anyway).
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const el = bodyRef.current;
    if (!el) return;
    dragRef.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    const el = bodyRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.moved) {
      el.scrollLeft = d.left - dx;
      el.scrollTop = d.top - dy;
    }
  };
  const endDrag = () => { dragRef.current = null; };

  return (
    <div className="fixed inset-0 z-[130] bg-bg-dark flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] shrink-0"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <Icon name="account_tree" size={18} className="text-brand-violet-light shrink-0" />
        <p className="font-syne font-bold text-sm truncate flex-1">{title || 'Bracket'}</p>
        <button onClick={onClose} aria-label="Close bracket"
          className="w-9 h-9 rounded-full bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center transition-colors">
          <Icon name="close" size={18} />
        </button>
      </div>
      <div
        ref={bodyRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        className="flex-1 overflow-auto p-6 cursor-grab active:cursor-grabbing"
        style={{ paddingBottom: 'calc(var(--vg-safe-b, 0px) + 24px)' }}
      >
        {children}
      </div>
    </div>
  );
}

function EmptyState({ label }) {
  return (
    <div className="p-8 rounded-xl bg-surface-1 border border-dashed border-white/[0.06] text-center">
      <Icon name="account_tree" size={32} className="text-text-muted mx-auto mb-2" />
      <p className="text-text-muted text-sm">{label}</p>
    </div>
  );
}
