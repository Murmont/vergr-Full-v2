// TournamentOverlayNeon — OBS browser-source overlay for live tournament
// streams. Renders 1920×1080 at transparent background. Streamer adds the
// URL once (https://vergr.app/#/overlay/<tournamentId>/neon) and it
// subscribes to:
//   - tournaments/{tId}             (name, game, mode)
//   - tournaments/{tId}/matches/*   (picks the first non-completed match,
//                                    or the one specified by ?matchId=)
//   - users/{player1Uid}, users/{player2Uid}  (avatars, tags, country)
//
// Live data slots populated reactively:
//   - currentMatchSeriesScore  (always — derived from match.seriesScore)
//   - currentMatchPlayer1.liveScore / liveScoreSource  (when OCR/GSI lands)
//   - modPresent               (from match.vanguardPresent or assignment)
//   - aiScanStatus             (from match.cheatFlagPass or activity)
//
// Empty states are graceful — score boxes show "—" when no live data.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getUser, getSquad } from '../../firebase/firestore';
import VanguardBadge from '../../components/VanguardBadge';

export const OVERLAY_CSS = `
:root {
  --brand-cyan: #4DFFD4;
  --brand-violet: #7B1FFF;
  --brand-violet-light: #B44FFF;
  --brand-pink: #C87FFF;
  --brand-gold: #F0A500;
  --brand-gold-light: #F5C842;
  --brand-ember: #F04060;
  --bg-dark: #0B0B14;
  --surface-1: #14141F;
  --surface-2: #1A1A2A;
  --text-primary: #FFFFFF;
  --text-secondary: #9CA3AF;
  --text-muted: #6B7280;
  --grad-neon: linear-gradient(90deg, var(--brand-cyan) 0%, var(--brand-violet-light) 55%, var(--brand-pink) 100%);
}
.tneon, .tneon * { box-sizing: border-box; }
html.tneon-host, body.tneon-host { margin:0; padding:0; background: transparent !important; overflow: hidden; }
.tneon { font-family: "DM Sans", system-ui, sans-serif; color: var(--text-primary); }
.tneon .stage { position: relative; width: 100vw; height: 100vh; overflow: hidden; }
.tneon .overlay { position: absolute; top: 50%; left: 50%; width: 1920px; height: 1080px; transform-origin: center center; transform: translate(-50%, -50%) scale(var(--fit, 1)); pointer-events: none; }
.tneon .top-rail { position: absolute; top: 36px; left: 0; right: 0; display: flex; justify-content: space-between; padding: 0 48px; align-items: flex-start; }
.tneon .t-tag { display: flex; align-items: stretch; height: 84px; background: rgba(11,11,20,.82); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); clip-path: polygon(0 0, calc(100% - 22px) 0, 100% 50%, calc(100% - 22px) 100%, 0 100%); position: relative; box-shadow: 0 0 0 1px rgba(255,255,255,.04) inset, 0 8px 40px rgba(0,0,0,.4); }
.tneon .t-tag::before { content: ""; position: absolute; inset: 0; padding: 2.5px; background: var(--grad-neon); clip-path: polygon(0 0, calc(100% - 22px) 0, 100% 50%, calc(100% - 22px) 100%, 0 100%); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; }
.tneon .t-tag .live-pip { display: inline-flex; align-items: center; gap: 12px; padding: 0 22px 0 28px; border-right: 1px solid rgba(0,0,0,.25); height: 100%; background: var(--brand-ember); box-shadow: inset 0 -2px 0 color-mix(in oklab, var(--brand-ember) 60%, black); }
.tneon .pip-dot { width: 12px; height: 12px; border-radius: 50%; background: #fff; box-shadow: 0 0 14px rgba(255,255,255,.9), 0 0 28px rgba(255,255,255,.5); animation: tneon-pulse 1.4s ease-in-out infinite; }
.tneon .live-pip .label { font: 800 18px/1 "Syne", sans-serif; letter-spacing: .26em; color: #fff; text-shadow: 0 1px 0 rgba(0,0,0,.25); }
.tneon .t-tag .meta { display: flex; flex-direction: column; justify-content: center; padding: 0 38px 0 22px; gap: 6px; }
.tneon .t-tag .game { font: 500 13px/1 "DM Mono", monospace; letter-spacing: .22em; color: var(--text-secondary); text-transform: uppercase; }
.tneon .t-tag .name { font: 800 24px/1 "Syne", sans-serif; letter-spacing: .04em; color: var(--text-primary); }
.tneon .t-status { display: flex; align-items: stretch; height: 84px; gap: 10px; }
.tneon .status-card { background: rgba(11,11,20,.82); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); padding: 0 22px; display: flex; align-items: center; gap: 12px; clip-path: polygon(22px 0, 100% 0, calc(100% - 22px) 100%, 0 100%); position: relative; }
.tneon .status-card::before { content: ""; position: absolute; inset: 0; padding: 2px; background: linear-gradient(180deg, rgba(255,255,255,.18), rgba(255,255,255,.04)); clip-path: polygon(22px 0, 100% 0, calc(100% - 22px) 100%, 0 100%); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; }
.tneon .status-card .ico { font-family: "Material Symbols Outlined"; font-size: 26px; color: var(--text-secondary); font-feature-settings: 'liga'; transition: color .3s; }
.tneon .status-card .label { font: 700 15px/1 "DM Mono", monospace; letter-spacing: .22em; color: var(--text-secondary); text-transform: uppercase; transition: color .3s; }
.tneon .status-card.on .ico, .tneon .status-card.on .label { color: var(--brand-cyan); }
.tneon .status-card.on { box-shadow: 0 0 28px color-mix(in oklab, var(--brand-cyan) 30%, transparent); }
.tneon .status-card.on::before { background: linear-gradient(180deg, var(--brand-cyan), color-mix(in oklab, var(--brand-cyan) 30%, transparent)); }
.tneon .status-card.flag .ico, .tneon .status-card.flag .label { color: var(--brand-gold); }
.tneon .status-card.flag { box-shadow: 0 0 28px color-mix(in oklab, var(--brand-gold) 30%, transparent); }
.tneon .status-card.flag::before { background: linear-gradient(180deg, var(--brand-gold), color-mix(in oklab, var(--brand-gold) 30%, transparent)); }
.tneon .round-card { background: rgba(11,11,20,.82); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); padding: 0 32px; display: flex; flex-direction: column; justify-content: center; gap: 7px; clip-path: polygon(22px 0, 100% 0, calc(100% - 22px) 100%, 0 100%); position: relative; min-width: 240px; text-align: right; box-shadow: 0 8px 40px rgba(0,0,0,.4); }
.tneon .round-card::before { content: ""; position: absolute; inset: 0; padding: 2.5px; background: var(--grad-neon); clip-path: polygon(22px 0, 100% 0, calc(100% - 22px) 100%, 0 100%); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; }
.tneon .round-card .kicker { font: 700 12px/1 "DM Mono", monospace; letter-spacing: .32em; color: var(--brand-cyan); text-transform: uppercase; }
.tneon .round-card .round { font: 800 26px/1 "Syne", sans-serif; letter-spacing: .02em; color: var(--text-primary); }
.tneon .lower-third { position: absolute; left: 0; right: 0; bottom: 72px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: end; padding: 0 48px; gap: 0; }
.tneon .player { position: relative; display: flex; align-items: stretch; height: 140px; background: rgba(11,11,20,.85); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); box-shadow: 0 8px 40px rgba(0,0,0,.5); }
.tneon .player.left { clip-path: polygon(0 0, calc(100% - 42px) 0, 100% 100%, 0 100%); padding-right: 52px; }
.tneon .player.right { clip-path: polygon(42px 0, 100% 0, 100% 100%, 0 100%); padding-left: 52px; flex-direction: row-reverse; }
.tneon .player::before { content: ""; position: absolute; inset: 0; padding: 3px; -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; }
.tneon .player.left::before { background: linear-gradient(90deg, var(--brand-cyan) 0%, color-mix(in oklab, var(--brand-cyan) 20%, transparent) 100%); clip-path: polygon(0 0, calc(100% - 42px) 0, 100% 100%, 0 100%); }
.tneon .player.right::before { background: linear-gradient(90deg, color-mix(in oklab, var(--brand-pink) 20%, transparent) 0%, var(--brand-pink) 100%); clip-path: polygon(42px 0, 100% 0, 100% 100%, 0 100%); }
.tneon .player.left::after, .tneon .player.right::after { content: ""; position: absolute; top: -6px; bottom: -6px; width: 10px; filter: blur(16px); opacity: .9; pointer-events: none; }
.tneon .player.left::after { left: -4px; background: var(--brand-cyan); }
.tneon .player.right::after { right: -4px; background: var(--brand-pink); }
.tneon .player-wash { position: absolute; inset: 0; pointer-events: none; clip-path: inherit; z-index: 0; }
.tneon .player.left .player-wash { background: linear-gradient(90deg, color-mix(in oklab, var(--brand-cyan) 22%, transparent) 0%, transparent 60%); }
.tneon .player.right .player-wash { background: linear-gradient(270deg, color-mix(in oklab, var(--brand-pink) 22%, transparent) 0%, transparent 60%); }
.tneon .avatar-wrap { width: 140px; height: 140px; flex: 0 0 140px; position: relative; overflow: hidden; background: var(--surface-2); z-index: 1; }
.tneon .player.left .avatar-wrap { clip-path: polygon(0 0, 100% 0, calc(100% - 26px) 100%, 0 100%); }
.tneon .player.right .avatar-wrap { clip-path: polygon(26px 0, 100% 0, 100% 100%, 0 100%); }
.tneon .avatar-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tneon .avatar-wrap.fallback { background: linear-gradient(135deg, var(--surface-2) 0%, var(--brand-violet) 100%); display: flex; align-items: center; justify-content: center; font: 900 56px/1 "Syne", sans-serif; color: var(--text-primary); letter-spacing: .04em; }
.tneon .player.right .avatar-wrap.fallback { background: linear-gradient(225deg, var(--surface-2) 0%, var(--brand-pink) 100%); }
.tneon .player-info { flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; padding: 0 30px; gap: 10px; min-width: 0; position: relative; z-index: 1; }
.tneon .player.right .player-info { align-items: flex-end; text-align: right; }
.tneon .player-meta { display: flex; align-items: center; gap: 14px; font: 700 16px/1 "DM Mono", monospace; letter-spacing: .18em; color: var(--text-secondary); text-transform: uppercase; }
.tneon .flag { font-size: 24px; line-height: 1; filter: drop-shadow(0 0 6px rgba(0,0,0,.6)); }
.tneon .tag { color: var(--brand-cyan); font-weight: 700; text-shadow: 0 0 16px color-mix(in oklab, var(--brand-cyan) 55%, transparent); }
.tneon .player.right .tag { color: var(--brand-pink); text-shadow: 0 0 16px color-mix(in oklab, var(--brand-pink) 55%, transparent); }
.tneon .player-name { font: 900 40px/1 "Syne", sans-serif; letter-spacing: .005em; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 420px; text-shadow: 0 2px 12px rgba(0,0,0,.6); }
.tneon .score-box { flex: 0 0 auto; min-width: 140px; padding: 0 18px; display: flex; align-items: center; justify-content: center; position: relative; font: 900 clamp(56px, 6vw, 84px)/1 "Syne", sans-serif; font-variant-numeric: tabular-nums; color: var(--text-primary); letter-spacing: -.04em; z-index: 1; }
.tneon .player.left .score-box { background: linear-gradient(90deg, transparent, color-mix(in oklab, var(--brand-cyan) 24%, transparent)); text-shadow: 0 0 28px color-mix(in oklab, var(--brand-cyan) 60%, transparent); }
.tneon .player.right .score-box { background: linear-gradient(270deg, transparent, color-mix(in oklab, var(--brand-pink) 24%, transparent)); text-shadow: 0 0 28px color-mix(in oklab, var(--brand-pink) 60%, transparent); }
.tneon .score-empty { color: var(--text-muted); font-weight: 700; letter-spacing: 0; }
.tneon .score-source { position: absolute; bottom: 12px; width: 8px; height: 8px; border-radius: 50%; box-shadow: 0 0 8px currentColor; }
.tneon .player.left .score-source { right: 12px; }
.tneon .player.right .score-source { left: 12px; }
.tneon .score-source.gsi { color: var(--brand-cyan); background: currentColor; }
.tneon .score-source.ocr { color: var(--brand-gold); background: currentColor; }
.tneon .score-source.manual { color: var(--brand-violet-light); background: currentColor; }
.tneon .score-source.none { display: none; }
.tneon .series { position: relative; margin: 0 -32px; z-index: 5; display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 22px 40px 18px; min-width: 260px; background: rgba(11,11,20,.94); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); clip-path: polygon(28px 0, calc(100% - 28px) 0, 100% 100%, 0 100%); box-shadow: 0 0 60px color-mix(in oklab, var(--brand-violet) 35%, transparent), 0 12px 50px rgba(0,0,0,.6); }
.tneon .series::before { content: ""; position: absolute; inset: 0; padding: 3px; background: var(--grad-neon); clip-path: polygon(28px 0, calc(100% - 28px) 0, 100% 100%, 0 100%); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; }
.tneon .series-format { font: 700 14px/1 "DM Mono", monospace; letter-spacing: .36em; color: var(--brand-cyan); text-transform: uppercase; text-shadow: 0 0 14px color-mix(in oklab, var(--brand-cyan) 60%, transparent); }
.tneon .series-score { font: 900 56px/1 "Syne", sans-serif; font-variant-numeric: tabular-nums; letter-spacing: .02em; display: flex; align-items: baseline; gap: 14px; }
.tneon .series-score .a { color: var(--brand-cyan); text-shadow: 0 0 20px color-mix(in oklab, var(--brand-cyan) 70%, transparent), 0 0 40px color-mix(in oklab, var(--brand-cyan) 40%, transparent); }
.tneon .series-score .b { color: var(--brand-pink); text-shadow: 0 0 20px color-mix(in oklab, var(--brand-pink) 70%, transparent), 0 0 40px color-mix(in oklab, var(--brand-pink) 40%, transparent); }
.tneon .series-score .sep { color: var(--text-muted); font: 800 32px/1 "Syne", sans-serif; transform: translateY(-6px); }
.tneon .series-dots { display: flex; gap: 8px; }
.tneon .dot { width: 22px; height: 5px; border-radius: 3px; background: rgba(255,255,255,.14); }
.tneon .dot.a { background: var(--brand-cyan); box-shadow: 0 0 12px var(--brand-cyan); }
.tneon .dot.b { background: var(--brand-pink); box-shadow: 0 0 12px var(--brand-pink); }
@keyframes tneon-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .55; transform: scale(.82); } }
@media (prefers-reduced-motion: reduce) { .tneon *, .tneon *::before, .tneon *::after { animation: none !important; transition: none !important; } }
`;

const COUNTRY_FLAGS = { SE: '🇸🇪', BR: '🇧🇷', US: '🇺🇸', KR: '🇰🇷', DE: '🇩🇪', JP: '🇯🇵', FR: '🇫🇷', UK: '🇬🇧', GB: '🇬🇧' };

function fmtCompact(n) {
  n = Math.max(0, Math.floor(n || 0));
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  if (n < 1_000_000) return Math.floor(n / 1000) + 'K';
  if (n < 10_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n < 1_000_000_000) return Math.floor(n / 1_000_000) + 'M';
  return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
}

// Normalise a user OR squad doc into the shape PlayerCell expects. Squads
// have `name`/`tag`/`banner`; users have `username`/`displayName`/`avatar`.
function normaliseSide(d, isSquad) {
  if (!d) return null;
  if (isSquad) {
    return {
      id: d.id,
      username: d.name || d.tag || d.id,
      displayName: d.name || d.tag || d.id,
      tag: d.tag || (d.name || '').slice(0, 4).toUpperCase(),
      avatar: d.banner || d.bannerUrl || d.avatar || null,
      country: null, // squads don't carry a country flag
    };
  }
  return {
    id: d.id,
    username: d.username || d.displayName || d.id,
    displayName: d.displayName || d.username || d.id,
    tag: d.tag || (d.username || '').slice(0, 4).toUpperCase(),
    avatar: d.avatar || null,
    country: d.country || d.countryCode || null,
  };
}

function pickActiveMatch(matches, preferredId) {
  if (!matches.length) return null;
  if (preferredId) {
    const exact = matches.find((m) => m.id === preferredId);
    if (exact) return exact;
  }
  const liveSet = new Set(['in_progress', 'awaiting_confirmation']);
  const live = matches.find((m) => liveSet.has(m.status));
  if (live) return live;
  return matches.find((m) => m.status === 'pending' && m.player1 && m.player2) || null;
}

export default function TournamentOverlayNeon() {
  const { tournamentId } = useParams();
  const [params] = useSearchParams();
  const preferredMatchId = params.get('matchId');

  const [tournament, setTournament] = useState(null);
  const [matches, setMatches] = useState([]);
  const [p1, setP1] = useState(null);
  const [p2, setP2] = useState(null);
  const overlayRef = useRef(null);

  // Inject CSS + transparent body. Cleanup on unmount.
  useEffect(() => {
    const styleEl = document.createElement('style');
    styleEl.textContent = OVERLAY_CSS;
    document.head.appendChild(styleEl);
    document.documentElement.classList.add('tneon-host');
    document.body.classList.add('tneon-host');
    return () => {
      styleEl.remove();
      document.documentElement.classList.remove('tneon-host');
      document.body.classList.remove('tneon-host');
    };
  }, []);

  // Fit 1920×1080 overlay into the viewport so the design renders 1:1 in
  // OBS browser source AND on smaller preview windows.
  useEffect(() => {
    const fit = () => {
      const el = overlayRef.current;
      if (!el) return;
      const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      el.style.setProperty('--fit', s);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // Tournament doc subscription.
  useEffect(() => {
    if (!tournamentId) return;
    return onSnapshot(doc(db, 'tournaments', tournamentId), (snap) => {
      if (snap.exists()) setTournament({ id: snap.id, ...snap.data() });
      else setTournament(null);
    });
  }, [tournamentId]);

  // Matches subcollection — drives which match the overlay focuses on.
  useEffect(() => {
    if (!tournamentId) return;
    return onSnapshot(collection(db, 'tournaments', tournamentId, 'matches'), (snap) => {
      setMatches(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [tournamentId]);

  const match = useMemo(() => pickActiveMatch(matches, preferredMatchId), [matches, preferredMatchId]);

  // Player profiles — squad-mode tournaments hold SQUAD IDs in match.player1/2,
  // not user IDs. Use the right loader per mode so avatars + names resolve.
  const isSquadMode = tournament?.mode === 'squad';
  useEffect(() => {
    if (!match?.player1) { setP1(null); return; }
    let cancelled = false;
    const load = isSquadMode ? getSquad : getUser;
    load(match.player1).then((d) => { if (!cancelled) setP1(normaliseSide(d, isSquadMode)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [match?.player1, isSquadMode]);
  useEffect(() => {
    if (!match?.player2) { setP2(null); return; }
    let cancelled = false;
    const load = isSquadMode ? getSquad : getUser;
    load(match.player2).then((d) => { if (!cancelled) setP2(normaliseSide(d, isSquadMode)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [match?.player2, isSquadMode]);

  // Vanguard moderators who have acted on this tournament. Each one gets
  // their rank badge stacked next to the VANGUARD label so viewers see at
  // a glance how many mods + what authority is watching.
  const modUids = useMemo(() => (tournament?.vanguardModerators || []).slice(0, 5), [tournament?.vanguardModerators]);
  const [modRanks, setModRanks] = useState([]);
  useEffect(() => {
    if (!modUids.length) { setModRanks([]); return; }
    let cancelled = false;
    Promise.all(modUids.map((uid) => getUser(uid).catch(() => null)))
      .then((arr) => {
        if (cancelled) return;
        // De-dupe ranks; sort by rank seniority (overseer > commander > ...).
        const ORDER = { overseer: 5, commander: 4, senior: 3, vanguard: 2, recruit: 1 };
        const ranks = arr
          .map((u) => u?.vanguard?.rank)
          .filter(Boolean)
          .sort((a, b) => (ORDER[b] || 0) - (ORDER[a] || 0));
        setModRanks(ranks);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [modUids]);

  // Live score plumbing — slots present even when no source has populated
  // them yet. OCR pipeline (when wired) will write match.liveScore.{uid} +
  // match.liveScoreSource.{uid}; GSI does the same with source='gsi'.
  const score1     = match?.liveScore?.[match?.player1];
  const score2     = match?.liveScore?.[match?.player2];
  const source1    = match?.liveScoreSource?.[match?.player1] || 'none';
  const source2    = match?.liveScoreSource?.[match?.player2] || 'none';

  const seriesA = match?.seriesScore?.a ?? 0;
  const seriesB = match?.seriesScore?.b ?? 0;
  const seriesFormat = (match?.seriesFormat || 'bo1').toLowerCase();
  const seriesTotal = seriesFormat === 'bo5' ? 5 : seriesFormat === 'bo1' ? 1 : 3;

  // Mod presence + AI scan derived from match doc flags. Both default off.
  const modOn = !!match?.vanguardPresent || !!(match?.claimedModeratorId);
  const aiOn  = match?.cheatFlagPass === 'pending' || match?.cheatFlagPass === 'done' || !!match?.aiSuggestion;
  const aiFlagged = !!match?.cheatFlag?.flags?.length;

  if (!tournament || !match) {
    return (
      <div className="tneon">
        <div className="stage" />
      </div>
    );
  }

  const flagFor = (user) => COUNTRY_FLAGS[(user?.country || user?.countryCode || '').toUpperCase()] || '';
  const tagFor = (user) => user?.tag || (user?.username || '').slice(0, 4).toUpperCase();

  return (
    <div className="tneon">
      <div className="stage">
        <div className="overlay" ref={overlayRef}>
          {/* ─── TOP RAIL ─── */}
          <div className="top-rail">
            <div className="t-tag">
              <div className="live-pip">
                <span className="pip-dot" />
                <span className="label">LIVE</span>
              </div>
              <div className="meta">
                <span className="game">{tournament.game || ''}</span>
                <span className="name">{tournament.name || ''}</span>
              </div>
            </div>
            <div className="t-status">
              <div className={`status-card ${modOn || modRanks.length > 0 ? 'on' : ''}`}>
                <span className="ico">shield_person</span>
                <span className="label">VANGUARD</span>
                {/* Stacked rank badges — one per mod who has acted on this
                    tournament. Higher rank first. Caps at 5 visible to keep
                    the status card tidy. */}
                {modRanks.length > 0 && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
                    {modRanks.slice(0, 5).map((r, i) => (
                      <VanguardBadge key={`${r}-${i}`} rank={r} size={22} />
                    ))}
                  </span>
                )}
              </div>
              <div className={`status-card ${aiFlagged ? 'flag' : (aiOn ? 'on' : '')}`}>
                <span className="ico">radar</span>
                <span className="label">SCREEN SCAN</span>
              </div>
              <div className="round-card">
                <span className="kicker">ROUND</span>
                <span className="round">{roundLabel(match)}</span>
              </div>
            </div>
          </div>

          {/* ─── LOWER THIRD ─── */}
          <div className="lower-third">
            <PlayerCell user={p1} side="left" score={score1} source={source1} flag={flagFor(p1)} tag={tagFor(p1)} />

            <div className="series">
              <span className="series-format">{(match.seriesFormat || 'BO1').toUpperCase()}</span>
              <div className="series-score">
                <span className="a">{seriesA}</span>
                <span className="sep">—</span>
                <span className="b">{seriesB}</span>
              </div>
              <div className="series-dots">
                {Array.from({ length: seriesTotal }).map((_, i) => {
                  let cls = '';
                  if (i < seriesA) cls = 'a';
                  else if (i >= seriesTotal - seriesB) cls = 'b';
                  return <span key={i} className={`dot ${cls}`} />;
                })}
              </div>
            </div>

            <PlayerCell user={p2} side="right" score={score2} source={source2} flag={flagFor(p2)} tag={tagFor(p2)} />
          </div>

        </div>
      </div>
    </div>
  );
}

function PlayerCell({ user, side, score, source, flag, tag }) {
  const hasScore = typeof score === 'number';
  const username = user?.username || user?.displayName || '…';
  const avatarUrl = user?.avatar;
  return (
    <div className={`player ${side}`}>
      <div className="player-wash" />
      <div className={`avatar-wrap ${!avatarUrl ? 'fallback' : ''}`}>
        {avatarUrl
          ? <img alt="" src={avatarUrl} />
          : (username || '?').slice(0, 1).toUpperCase()}
      </div>
      <div className="player-info">
        <div className="player-meta">
          {side === 'left' && flag && <span className="flag">{flag}</span>}
          <span className="tag">{tag}</span>
          {side === 'right' && flag && <span className="flag">{flag}</span>}
        </div>
        <div className="player-name">{username}</div>
      </div>
      <div className="score-box">
        {hasScore
          ? <span>{score}</span>
          : <span className="score-empty">—</span>}
        <span className={`score-source ${source || 'none'}`} />
      </div>
    </div>
  );
}

function roundLabel(match) {
  if (match?.stageName) return match.stageName;
  if (typeof match?.round === 'number') {
    // Heuristic — round labels are nicer when we know the bracket shape, but
    // the match doc alone gives us just the round index. Show "Round N".
    return `Round ${match.round}`;
  }
  return '—';
}
