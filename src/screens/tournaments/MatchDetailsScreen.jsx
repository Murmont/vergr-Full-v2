import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { getTournament, subscribeTournament, joinTournamentSecure, leaveTournamentSecure, startTournamentSecure, reportMatchResultSecure, finalizeTournamentSecure, applyToTournamentSecure, getTournamentMatches, getUser, getSquad, getFollowing, getHostStats } from '../../firebase/firestore';
import { gameById } from '../../utils/tournamentGames';
import LaunchGameDropdown from '../../components/tournament/LaunchGameDropdown';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import TopBar from '../../components/TopBar';
import UserAvatar from '../../components/UserAvatar';
import VanguardBadge from '../../components/VanguardBadge';
import { applyVanguardMask } from '../../utils/vanguard';
import VanguardPresence from '../../components/VanguardPresence';
import Icon from '../../components/Icon';
import { SingleElimBracket, DoubleElimBracket, RoundRobinSchedule, SwissRoundsList } from '../../components/tournaments/BracketVisualization';
import { RoundRobinStandings, SwissStandings } from '../../components/tournaments/StandingsTable';
import BRScoreboard from '../../components/tournaments/BRScoreboard';
import {
  getBracketType,
  computePrizeBreakdown,
  computeBRStandings,
  computeRoundRobinStandings,
  computeSwissStandings,
} from '../../utils/tournamentTypes';
import TrophyCeremony from '../../components/tournament/TrophyCeremony';
import { buildRoundsFromMatches, buildBrResults } from '../../utils/tournamentBracketShape';

// AC9 high-stakes gate. WEBCAM_PRIZE_THRESHOLD mirrors functions/tournamentRules.js
// + TournamentMatchScreen.jsx — keep in sync.
const WEBCAM_PRIZE_THRESHOLD = 5000;

// The real requirement for claiming a high-stakes win is the two-camera proof
// feed, which needs getDisplayMedia (macOS 13+ / Safari 16). macOS version is no
// longer reliably readable from a browser (Apple freezes the UA string), so we
// feature-detect the capture API and best-effort confirm macOS>=13 via UA-CH.
async function highStakesCaptureSupported() {
  if (!navigator.mediaDevices?.getDisplayMedia) return false;
  try {
    const uaData = navigator.userAgentData;
    if (uaData?.getHighEntropyValues) {
      const hv = await uaData.getHighEntropyValues(['platform', 'platformVersion']);
      if (hv.platform === 'macOS' && hv.platformVersion) {
        const major = parseInt(String(hv.platformVersion).split('.')[0], 10);
        if (!Number.isNaN(major) && major < 13) return false;
      }
    }
  } catch { /* UA-CH unavailable (Safari/Firefox) — fall back to the API check */ }
  return true;
}

export default function MatchDetailsScreen() {
  const { matchId } = useParams();
  const { currentUser } = useAuth();
  const { wallet } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  // Viewer's followed-uid set — drives the gold "followed advance" pulse
  // on bracket cards when one of their players wins a round.
  const [followedUids, setFollowedUids] = useState(() => new Set());
  useEffect(() => {
    if (!currentUser?.uid) { setFollowedUids(new Set()); return; }
    let cancelled = false;
    getFollowing(currentUser.uid)
      .then((rows) => {
        if (cancelled) return;
        setFollowedUids(new Set(rows.map((r) => r.followingId).filter(Boolean)));
      })
      .catch(() => { /* non-blocking */ });
    return () => { cancelled = true; };
  }, [currentUser?.uid]);

  const [tournament, setTournament] = useState(null);
  const [matches, setMatches] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [showJoinConfirm, setShowJoinConfirm] = useState(false);
  const [macBlock, setMacBlock] = useState(false); // AC9 high-stakes capture gate
  const [activeTab, setActiveTab] = useState('overview');
  // Phase 2 — which stage the user is currently viewing on the Bracket tab.
  // Null falls through to tournament.currentStageId in render.
  const [viewStageId, setViewStageId] = useState(null);

  useEffect(() => {
    setRightPanel(null);
    setContentAlign(isDesktop ? 'left' : 'center');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  useEffect(() => {
    if (!matchId) return;
    const load = async () => {
      setLoading(true);
      try {
        const t = await getTournament(matchId);
        setTournament(t);
        if (t?.status === 'active' || t?.status === 'completed') {
          const m = await getTournamentMatches(matchId);
          setMatches(m);
        }
        if (t?.participants?.length > 0) {
          // Phase 3 — squad mode loads squad docs as participants (not users).
          // Each row gets a kind flag so the bracket viz knows how to render.
          if (t.mode === 'squad') {
            const squads = await Promise.all(t.participants.map(async (sid) => {
              const s = await getSquad(sid).catch(() => null);
              return s ? { ...s, id: sid, kind: 'squad', name: s.name, tag: s.tag, banner: s.banner || s.bannerUrl } : null;
            }));
            setParticipants(squads.filter(Boolean));
          } else {
            const users = await Promise.all(t.participants.map(uid => getUser(uid)));
            setParticipants(users.filter(Boolean).map((u) => ({ ...u, kind: 'user' })));
          }
        }
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    load();
  }, [matchId]);

  // MP2 — live-patch the volatile fields (prize pool grows as players join,
  // entrant count, status) so the displayed numbers update without a reload.
  // The one-time load above still owns matches + resolved participant profiles.
  useEffect(() => {
    if (!matchId) return;
    const unsub = subscribeTournament(matchId, (live) => {
      if (!live) return;
      setTournament(prev => prev ? {
        ...prev,
        prizePool: live.prizePool,
        participants: live.participants,
        maxParticipants: live.maxParticipants,
        status: live.status,
      } : live);
    });
    return unsub;
  }, [matchId]);

  const isRegistered = tournament?.participants?.includes(currentUser?.uid);
  const isFull = (tournament?.participants?.length || 0) >= (tournament?.maxParticipants || Infinity);
  const isAdmin = tournament?.adminId === currentUser?.uid;
  const isInvited = (tournament?.invitedUserIds || []).includes(currentUser?.uid);
  // Private tournament + not host + not invited + not already in → the user
  // must apply rather than join directly.
  const needsApplication =
    tournament?.visibility === 'private' && !isAdmin && !isRegistered && !isInvited;

  // Refresh all derived state. Used after mutations so the UI reflects the
  // new tournament + match state without a full page reload.
  const refresh = async () => {
    const t = await getTournament(matchId);
    setTournament(t);
    if (t?.status === 'active' || t?.status === 'completed') {
      const m = await getTournamentMatches(matchId);
      setMatches(m);
    }
    if (t?.participants?.length > 0) {
      const users = await Promise.all(t.participants.map(uid => getUser(uid)));
      setParticipants(users.filter(Boolean));
    }
  };

  const handleStart = async () => {
    try {
      await startTournamentSecure(matchId);
      showToast('Tournament started!', 'success');
      await refresh();
    } catch (err) {
      showToast(err.message || 'Failed to start', 'error');
    }
  };

  const handleReport = async (mId, winnerId) => {
    try {
      // Source 'manual' for both host and players — server auto-detects
      // adminId === reporterUid and skips the two-player-agree path.
      const res = await reportMatchResultSecure({ tournamentId: matchId, matchId: mId, winnerId, source: 'manual' });
      if (res?.status === 'awaiting_confirmation') {
        showToast('Result submitted — waiting for opponent', 'info');
      } else if (res?.status === 'disputed') {
        showToast('Reports disagree — match disputed', 'error');
      } else {
        showToast('Result recorded!', 'success');
      }
      await refresh();
    } catch (err) {
      showToast(err.message || 'Failed to report', 'error');
    }
  };

  const handleFinalizeNow = async () => {
    try {
      await finalizeTournamentSecure(matchId);
      showToast('Prizes distributed!', 'success');
      await refresh();
    } catch (err) {
      showToast(err.message || 'Failed to finalize', 'error');
    }
  };

  const [applying, setApplying] = useState(false);
  const [hasApplied, setHasApplied] = useState(false);
  const handleApply = async () => {
    if (applying) return;
    const message = window.prompt('Add a short note for the host (optional):', '') ?? '';
    setApplying(true);
    try {
      await applyToTournamentSecure({ tournamentId: matchId, message });
      showToast('Application sent — the host will review it.', 'success');
      setHasApplied(true);
    } catch (err) {
      // "already applied" → treat as success state.
      if ((err.message || '').toLowerCase().includes('already applied')) {
        setHasApplied(true);
        showToast('You already applied to this tournament.', 'info');
      } else {
        showToast(err.message || 'Failed to apply', 'error');
      }
    }
    setApplying(false);
  };

  const handleJoin = async () => {
    if (joining) return;
    setJoining(true);
    try {
      // AC9 — high-stakes capture gate. Block up front (and tell the server)
      // when this device cannot screen-capture, so the player never escrows
      // coins into a win they could not claim.
      let captureOk = null;
      if ((tournament?.entryFee || 0) > WEBCAM_PRIZE_THRESHOLD) {
        captureOk = await highStakesCaptureSupported();
        if (!captureOk) {
          setShowJoinConfirm(false);
          setMacBlock(true);
          setJoining(false);
          return;
        }
      }
      await joinTournamentSecure(matchId,
        captureOk === null ? {} : { displayCaptureSupported: captureOk });
      showToast('Registered!', 'success');
      setShowJoinConfirm(false);
      await refresh();
    } catch (err) {
      showToast(err.message || 'Failed to join', 'error');
    }
    setJoining(false);
  };

  const handleLeave = async () => {
    try {
      await leaveTournamentSecure(matchId);
      showToast('Left tournament', 'info');
      await refresh();
    } catch (err) {
      showToast(err.message || 'Failed to leave', 'error');
    }
  };

  const getStatusStyle = (status) => {
    switch (status) {
      case 'open': return { bg: 'bg-green-500/15', text: 'text-green-400', label: 'Open' };
      case 'active': return { bg: 'bg-brand-ember/15', text: 'text-brand-ember', label: 'LIVE' };
      case 'completed': return { bg: 'bg-surface-3', text: 'text-text-muted', label: 'Completed' };
      default: return { bg: 'bg-surface-3', text: 'text-text-muted', label: status };
    }
  };

  // Trophy ceremony — fires once per completed tournament for top-3 finishers
  // and the host. Persists "seen" via localStorage so it doesn't replay on
  // navigation. P0 #5. MUST be declared before any early returns (React rules).
  const ceremonyKey = `vergr.trophyCeremony.${matchId}`;
  const [showCeremony, setShowCeremony] = useState(false);
  useEffect(() => {
    if (!tournament || tournament.status !== 'completed') return;
    if (localStorage.getItem(ceremonyKey)) return;
    const placements = tournament.placements || {};
    const top3 = [placements.first, placements.second,
      Array.isArray(placements.third) ? placements.third[0] : placements.third].filter(Boolean);
    if (top3.length === 0 && tournament.winnerId) top3.push(tournament.winnerId);
    // DS9 — show the trophy ceremony to EVERYONE who opens a completed
    // tournament (winner, host, and spectators who watched the final), once
    // per user via the localStorage gate above.
    if (top3.length > 0) setShowCeremony(true);
    // eslint-disable-next-line
  }, [tournament?.status, currentUser?.uid]);

  if (loading) return <div className="min-h-screen"><TopBar showBack title="Tournament" /><div className="flex justify-center py-20"><div className="w-8 h-8 border-3 border-brand-cyan border-t-transparent rounded-full animate-spin" /></div></div>;
  if (!tournament) return <div className="min-h-screen"><TopBar showBack title="Tournament" /><div className="text-center py-20"><p className="text-text-muted">Tournament not found</p></div></div>;

  const status = getStatusStyle(tournament.status);

  const ceremonyStandings = (() => {
    const placements = tournament?.placements || {};
    const ids = [
      placements.first,
      placements.second,
      Array.isArray(placements.third) ? placements.third[0] : placements.third,
    ].filter(Boolean);
    // Fallback for bracket types that only set winnerId.
    if (ids.length === 0 && tournament?.winnerId) ids.push(tournament.winnerId);
    return ids.map((uid) => {
      const p = participants.find((u) => u?.id === uid);
      return { uid, username: p?.username || 'TBA', avatar: p?.avatar };
    });
  })();
  const ceremonyPrizes = (() => {
    const breakdown = tournament?.payoutBreakdown?.payouts || [];
    return [1, 2, 3].map((place) => breakdown.find((p) => p.place === place)?.player || 0);
  })();

  return (
    <>
    {showCeremony && (
      <TrophyCeremony
        standings={ceremonyStandings}
        prizes={ceremonyPrizes}
        onClose={() => { localStorage.setItem(ceremonyKey, '1'); setShowCeremony(false); }}
      />
    )}
    {showJoinConfirm && (
      <GameOwnershipModal
        tournament={tournament}
        joining={joining}
        onCancel={() => setShowJoinConfirm(false)}
        onConfirm={handleJoin}
      />
    )}
    {macBlock && (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/85">
        <div className="w-full max-w-md rounded-2xl bg-surface-1 border border-white/10 p-5 text-text-primary">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="desktop_access_disabled" className="text-brand-ember" />
            <div className="font-bold text-base">Screen capture required</div>
          </div>
          <p className="text-sm text-text-secondary leading-relaxed mb-4">
            This high-stakes tournament needs screen capture (the two-camera proof feed)
            to claim a win. Your device or browser does not support it. On Mac you need
            macOS 13 (Ventura) or newer, or use a current browser. You can still
            spectate this tournament.
          </p>
          <button
            onClick={() => setMacBlock(false)}
            className="w-full py-3 rounded-xl bg-surface-2 border border-white/10 font-bold text-sm"
          >Got it</button>
        </div>
      </div>
    )}
    <VanguardPresence parentPath={`tournaments/${matchId}`} />
    <div className="min-h-screen pb-24 lg:pb-8">
      <TopBar showBack title={tournament.name} />

      <div className="px-4 py-4">
        {/* Hero card */}
        <div className="relative p-5 rounded-2xl bg-gradient-to-br from-surface-1 to-surface-2 border border-white/[0.06] overflow-hidden mb-4">
          <div className="absolute top-0 right-0 w-32 h-32 bg-brand-gold/5 rounded-full blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest ${status.bg} ${status.text}`}>{status.label}</span>
              <span className="text-text-muted text-xs">{tournament.game}</span>
            </div>
            <h1 className="font-syne text-2xl font-extrabold text-white mb-1">{tournament.name}</h1>
            <p className="text-text-muted text-sm">{tournament.type || 'Single Elimination'} · {tournament.maxParticipants} players max</p>

            <div className="grid grid-cols-3 gap-3 mt-5">
              <div className="relative p-3 rounded-xl bg-bg-dark/50 border border-white/[0.06] text-center">
                {(tournament.status === 'open' || tournament.status === 'registration') && (
                  <span className="absolute top-2 right-2 flex items-center gap-1" title="Prize pool grows as players join">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-gold animate-pulse" />
                  </span>
                )}
                <Icon name="emoji_events" size={20} className="text-brand-gold mx-auto mb-1" />
                <p className="text-brand-gold font-dmmono font-bold text-lg">{(tournament.prizePool || 0).toLocaleString()}</p>
                <p className="text-text-muted text-[9px] uppercase">Prize Pool</p>
              </div>
              <div className="p-3 rounded-xl bg-bg-dark/50 border border-white/[0.06] text-center">
                <Icon name="confirmation_number" size={20} className="text-brand-cyan mx-auto mb-1" />
                <p className="text-brand-cyan font-dmmono font-bold text-lg">{tournament.entryFee || 'Free'}</p>
                <p className="text-text-muted text-[9px] uppercase">Entry Fee</p>
              </div>
              <div className="p-3 rounded-xl bg-bg-dark/50 border border-white/[0.06] text-center">
                <Icon name="group" size={20} className="text-brand-violet mx-auto mb-1" />
                <p className="text-brand-violet font-dmmono font-bold text-lg">{tournament.participants?.length || 0}/{tournament.maxParticipants}</p>
                <p className="text-text-muted text-[9px] uppercase">Players</p>
              </div>
            </div>
          </div>
        </div>

        {/* Host actions: Start, Control Panel, Finalize Now */}
        {isAdmin && tournament.status === 'open' && (
          <button onClick={handleStart} disabled={(tournament.participants?.length || 0) < 2}
            className="w-full mb-3 py-3 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white font-bold text-sm flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand-violet/25">
            <Icon name="play_arrow" size={18} />
            {(tournament.participants?.length || 0) < 2 ? 'Need ≥ 2 players to start' : 'Start Tournament'}
          </button>
        )}
        {isAdmin && tournament.status === 'active' && (
          <button onClick={() => navigate(`/match/${matchId}/control`)}
            className="w-full mb-3 py-3 rounded-xl bg-brand-gold/10 border border-brand-gold/25 text-brand-gold font-bold text-sm flex items-center justify-center gap-2 hover:bg-brand-gold/20 transition-colors">
            <Icon name="admin_panel_settings" size={18} />
            Admin Control Panel
          </button>
        )}
        {/* OBS overlay URL — host-only, copy-to-OBS browser source.
            Display-only: shows tournament info to viewers on the broadcast.
            Winner decisions are made by Vanguard moderators in the Moderation Room. */}
        {isAdmin && tournament.overlayToken && tournament.requiresManualMod && (
          <div className="mb-3 p-3 rounded-xl bg-surface-1 border border-brand-violet-light/30">
            <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">OBS Browser-Source Overlay (display-only)</div>
            <div className="text-xs text-text-secondary mb-2">Add this URL as an OBS browser source to display the tournament name, prize pool, and current match info on your broadcast for viewers. Winners are called by the assigned Vanguard moderator — not the streamer.</div>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={`${window.location.origin}/#/overlay/${matchId}?token=${tournament.overlayToken}&mode=obs`}
                onFocus={(e) => e.target.select()}
                className="flex-1 text-[10px] font-mono bg-bg-dark border border-white/10 rounded px-2 py-1.5 text-text-primary"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/#/overlay/${matchId}?token=${tournament.overlayToken}&mode=obs`);
                  showToast('Overlay URL copied. Paste into OBS Sources → Browser.', 'success');
                }}
                className="px-3 py-1.5 rounded bg-brand-violet text-white text-xs font-bold hover:brightness-110"
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {isAdmin && tournament.status === 'completed' && tournament.payoutStatus !== 'paid' && (
          <button onClick={handleFinalizeNow}
            className="w-full mb-3 py-3 rounded-xl bg-gradient-to-r from-brand-gold to-amber-600 text-bg-dark font-extrabold text-sm flex items-center justify-center gap-2 hover:brightness-110 shadow-lg shadow-brand-gold/25">
            <Icon name="paid" size={18} />
            Finalize &amp; distribute prizes
          </button>
        )}
        {tournament.status === 'completed' && tournament.payoutStatus === 'paid' && (
          <div className="w-full mb-3 py-3 rounded-xl bg-brand-cyan/10 border border-brand-cyan/30 text-brand-cyan text-center text-sm font-bold flex items-center justify-center gap-2">
            <Icon name="check_circle" size={18} /> Prizes distributed
          </div>
        )}
        {tournament.status === 'open' && (
          <div className="mb-4">
            {isRegistered ? (
              <div className="flex gap-2">
                <div className="flex-1 py-3 rounded-xl bg-brand-cyan/10 border border-brand-cyan/30 text-brand-cyan text-center text-sm font-bold flex items-center justify-center gap-2">
                  <Icon name="check_circle" size={18} /> Registered
                </div>
                <button onClick={handleLeave} className="px-4 py-3 rounded-xl bg-surface-2 border border-white/[0.06] text-text-muted text-sm font-bold hover:text-brand-ember hover:border-brand-ember/30 transition-colors">
                  Leave
                </button>
              </div>
            ) : isFull ? (
              <div className="py-3 rounded-xl bg-surface-2 border border-white/[0.06] text-text-muted text-center text-sm font-bold">Tournament Full</div>
            ) : needsApplication ? (
              hasApplied ? (
                <div className="py-3 rounded-xl bg-brand-gold/10 border border-brand-gold/30 text-brand-gold text-center text-sm font-bold flex items-center justify-center gap-2">
                  <Icon name="hourglass_top" size={18} /> Application pending
                </div>
              ) : (
                <button onClick={handleApply} disabled={applying}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white font-bold text-sm hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  <Icon name="lock" size={16} />
                  {applying ? 'Sending…' : 'Apply to Join (Invite-Only)'}
                </button>
              )
            ) : (
              <button onClick={() => setShowJoinConfirm(true)} disabled={joining}
                className="w-full py-3.5 rounded-xl bg-brand-cyan text-bg-dark font-bold text-sm hover:brightness-110 active:scale-[0.98] transition-all  disabled:opacity-50">
                {joining ? 'Joining...' : tournament.entryFee > 0 ? `Join — ${tournament.entryFee} coins` : 'Join Tournament'}
              </button>
            )}
            {tournament.entryFee > 0 && !isRegistered && (
              <p className="text-text-muted text-[10px] text-center mt-2">
                Your balance: <span className="text-brand-gold font-dmmono">{wallet?.balance || 0} coins</span>
                {(wallet?.balance || 0) < tournament.entryFee && <span className="text-brand-ember ml-1">— insufficient</span>}
              </p>
            )}
          </div>
        )}

        {/* Active matches the user can report on. Shows pending matches the
            current user is a player in (or, if host, all pending matches).
            Two-button report → backend handles two-player-agree logic. */}
        {tournament.status === 'active' && matches.length > 0 && (() => {
          const myPending = matches.filter(m =>
            m.status !== 'completed' && !m.bye && m.player1 && m.player2 &&
            (m.player1 === currentUser?.uid || m.player2 === currentUser?.uid || isAdmin)
          );
          if (myPending.length === 0) return null;
          return (
            <div className="mb-4 space-y-3">
              <h3 className="text-text-muted text-[10px] uppercase font-bold tracking-widest">Your matches</h3>
              {myPending.map(m => {
                const p1 = participants.find(p => p.id === m.player1);
                const p2 = participants.find(p => p.id === m.player2);
                const isInMatch = m.player1 === currentUser?.uid || m.player2 === currentUser?.uid;
                return (
                  <div key={m.id} className="p-4 rounded-2xl bg-surface-1 border border-brand-cyan/20">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-text-muted text-[10px] uppercase font-bold tracking-widest">Round {m.round} · Match {m.matchNumber}</span>
                      <span className={`ml-auto px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                        m.status === 'awaiting_confirmation' ? 'bg-brand-gold/15 text-brand-gold' :
                        m.status === 'disputed' ? 'bg-brand-ember/15 text-brand-ember' :
                        'bg-brand-cyan/15 text-brand-cyan'
                      }`}>{m.status === 'awaiting_confirmation' ? 'Awaiting confirmation' : m.status}</span>
                    </div>
                    <p className="text-text-muted text-xs mb-3">
                      {isAdmin && !isInMatch ? 'As host, your call advances the bracket immediately.' :
                       m.status === 'awaiting_confirmation' ? 'Your opponent reported a result. Confirm or contest below.' :
                       'Both players must agree on the winner. If you disagree, the match is flagged disputed.'}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => handleReport(m.id, m.player1)}
                        className="py-2.5 rounded-xl bg-surface-2 border border-white/[0.08] hover:border-brand-cyan/40 hover:bg-brand-cyan/10 text-sm font-bold flex items-center justify-center gap-2 transition-colors">
                        <UserAvatar src={p1?.avatar} size={22} />
                        <span className="truncate">{p1?.displayName || p1?.username || 'Player 1'} won</span>
                      </button>
                      <button onClick={() => handleReport(m.id, m.player2)}
                        className="py-2.5 rounded-xl bg-surface-2 border border-white/[0.08] hover:border-brand-cyan/40 hover:bg-brand-cyan/10 text-sm font-bold flex items-center justify-center gap-2 transition-colors">
                        <UserAvatar src={p2?.avatar} size={22} />
                        <span className="truncate">{p2?.displayName || p2?.username || 'Player 2'} won</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-surface-1 rounded-xl p-1 border border-white/[0.06]">
          {['overview', 'participants', ...(matches.length > 0 ? ['bracket'] : [])].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 rounded-lg text-xs font-bold capitalize transition-all ${
                activeTab === tab ? 'bg-surface-3 text-white' : 'text-text-muted hover:text-text-secondary'
              }`}>{tab}</button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'overview' && (
          <div className="space-y-3">
            {tournament.adminId && <HostLegitCard hostUid={tournament.adminId} />}
            <button onClick={() => navigate(`/tournaments/${matchId}/standings`)}
              className="w-full p-4 rounded-2xl bg-surface-1 border border-white/[0.06] flex items-center gap-3 hover:border-white/[0.12] transition-colors">
              <Icon name="leaderboard" size={20} className="text-brand-gold" />
              <span className="flex-1 text-sm font-semibold text-left">Standings</span>
              <Icon name="chevron_right" size={18} className="text-text-muted" />
            </button>
            <button onClick={() => navigate(`/tournaments/${matchId}/prizes`)}
              className="w-full p-4 rounded-2xl bg-surface-1 border border-white/[0.06] flex items-center gap-3 hover:border-white/[0.12] transition-colors">
              <Icon name="emoji_events" size={20} className="text-brand-gold" />
              <span className="flex-1 text-sm font-semibold text-left">Prize Distribution</span>
              <Icon name="chevron_right" size={18} className="text-text-muted" />
            </button>
            <div className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
              <p className="text-text-muted text-[10px] uppercase tracking-widest font-bold mb-2">Winner Payout</p>
              <div className="space-y-1.5 text-sm">
                {(() => {
                  const cfg = getBracketType(tournament.type) || getBracketType('single_elim');
                  const pb = computePrizeBreakdown(tournament.prizePool || 0, cfg.id, { squadTreasury: cfg.mode === 'squad' });
                  if (!pb.payouts.length) {
                    return <p className="text-text-muted text-xs">Custom prize split set by creator</p>;
                  }
                  return pb.payouts.map(p => (
                    <div key={p.place} className="flex justify-between">
                      <span className="text-text-secondary">{p.label} ({p.pct}%)</span>
                      <span className="text-text-primary font-dmmono">{p.player.toLocaleString()}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'participants' && (
          <div className="space-y-2">
            {participants.length === 0 ? (
              <p className="text-text-muted text-sm text-center py-8">No participants yet</p>
            ) : (
              participants.map((rawUser, i) => {
                const user = applyVanguardMask(rawUser, profile);
                const isMasked = !!user?.isVanguardPersona;
                return (
                  <button key={rawUser.id} onClick={() => !user?.hideProfileLink && navigate(`/user/${rawUser.id}`)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl bg-surface-1 border border-white/[0.06] hover:border-white/[0.12] transition-colors">
                    <span className="text-text-muted text-xs font-dmmono w-6 text-center">{i + 1}</span>
                    <UserAvatar src={user?.avatar || rawUser.avatar} size={36} />
                    <div className="flex-1 text-left flex items-center gap-2">
                      <div>
                        <p className="text-text-primary text-sm font-semibold">{user?.displayName || rawUser.displayName}</p>
                        <p className="text-text-muted text-xs font-dmmono">@{user?.username || rawUser.username}</p>
                      </div>
                      {rawUser?.vanguard?.rank && <VanguardBadge rank={rawUser.vanguard.rank} size={14} />}
                    </div>
                    {rawUser.id === tournament.adminId && !isMasked && (
                      <span className="px-2 py-0.5 rounded-full bg-brand-gold/15 text-brand-gold text-[9px] font-bold uppercase">Admin</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'bracket' && (
          <div className="space-y-4">
            {/* Phase 2 — stage tabs for multi-stage tournaments. */}
            {Array.isArray(tournament.stages) && tournament.stages.length > 1 && (
              <MultiStageTabs
                tournament={tournament} matches={matches}
                viewStageId={viewStageId} setViewStageId={setViewStageId}
              />
            )}
            {(() => {
              // Real bracket data is derived from the match docs themselves —
              // tournament.bracketData only carries metadata (format/totalRounds).
              // buildRoundsFromMatches turns the raw match docs into the shape
              // the viz components expect (rounds[][{ home, away, winner }]).
              const t = tournament;
              // Phase 2 — filter matches to the selected stage when multi-stage.
              const isMulti = Array.isArray(t.stages) && t.stages.length > 1;
              const activeStageId = viewStageId || t.currentStageId || (isMulti ? t.stages[0].id : null);
              const activeStage = isMulti
                ? t.stages.find((s) => s.id === activeStageId) || t.stages[0]
                : null;
              const stageMatches = !isMulti ? matches
                : (matches || []).filter((m) => m.stageId === activeStageId
                    || (!m.stageId && activeStageId === t.stages[0].id));
              const stageType = activeStage ? activeStage.type : t.type;
              const shaped = stageMatches?.length > 0
                ? buildRoundsFromMatches(stageMatches, participants, stageType)
                : null;
              if (stageType === 'single_elim' || stageType === 'squad_single_elim' || stageType === 'invitational') {
                if (!shaped || (Array.isArray(shaped) && shaped.length === 0)) {
                  return <p className="text-text-muted text-sm text-center py-8">Bracket appears once the tournament starts</p>;
                }
                return <SingleElimBracket rounds={shaped} followedUids={followedUids} />;
              }
              if (stageType === 'double_elim') {
                if (!shaped?.winners?.length) {
                  return <p className="text-text-muted text-sm text-center py-8">Bracket appears once the tournament starts</p>;
                }
                return <DoubleElimBracket
                  followedUids={followedUids}
                  winners={shaped.winners}
                  losers={shaped.losers}
                  grandFinal={shaped.grandFinal}
                />;
              }
              if (stageType === 'squad_round_robin' || stageType === 'round_robin') {
                if (!shaped || shaped.length === 0) {
                  return <p className="text-text-muted text-sm text-center py-8">Schedule appears once the league begins</p>;
                }
                return <>
                  <RoundRobinStandings
                    standings={computeRoundRobinStandings(shaped.flat())}
                    teamLookup={Object.fromEntries(participants.map((p) => [p.id, p]))}
                  />
                  <RoundRobinSchedule rounds={shaped} />
                </>;
              }
              if (stageType === 'swiss') {
                if (!shaped || shaped.length === 0) {
                  return <p className="text-text-muted text-sm text-center py-8">Pairings appear once round 1 starts</p>;
                }
                return <>
                  <SwissStandings
                    standings={computeSwissStandings(
                      (t.participants || []).map((uid) => ({
                        playerId: uid,
                        name: participants.find((p) => p.id === uid)?.displayName ||
                              participants.find((p) => p.id === uid)?.username || uid,
                      })),
                      shaped.flat().map((m) => ({
                        played: m.played, winner: m.winner,
                        home: { playerId: m.home?.playerId }, away: { playerId: m.away?.playerId },
                      })),
                    )}
                  />
                  <SwissRoundsList rounds={shaped} />
                </>;
              }
              if (t.type === 'battle_royale') {
                return <BRScoreboard
                  standings={computeBRStandings(buildBrResults(t, matches))}
                  gameCount={t.brGameCount || 3}
                  playerLookup={Object.fromEntries(participants.map((p) => [p.id, p]))}
                />;
              }
              return <p className="text-text-muted text-sm text-center py-8">Bracket view not available for this format yet.</p>;
            })()}
            {!tournament.bracketData && matches.length > 0 && matches.map(match => (
                <div key={match.id} className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-text-muted text-[10px] uppercase font-bold tracking-widest">Round {match.round} · Match {match.matchNumber}</span>
                    <span className={`ml-auto px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                      match.status === 'completed' ? 'bg-brand-cyan/15 text-brand-cyan' : 'bg-brand-gold/15 text-brand-gold'
                    }`}>{match.status}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={`flex-1 flex items-center gap-2 p-2 rounded-xl ${match.winner === match.player1 ? 'bg-brand-cyan/10 border border-brand-cyan/30' : 'bg-surface-2'}`}>
                      <UserAvatar src={match.player1Data?.avatar} size={28} />
                      <span className="text-sm font-semibold truncate">{match.player1Data?.displayName || 'TBD'}</span>
                      {match.winner === match.player1 && <Icon name="check_circle" size={16} className="text-brand-cyan ml-auto shrink-0" />}
                    </div>
                    <span className="text-text-muted text-xs font-bold">VS</span>
                    <div className={`flex-1 flex items-center gap-2 p-2 rounded-xl ${match.winner === match.player2 ? 'bg-brand-cyan/10 border border-brand-cyan/30' : 'bg-surface-2'}`}>
                      <UserAvatar src={match.player2Data?.avatar} size={28} />
                      <span className="text-sm font-semibold truncate">{match.player2Data?.displayName || 'BYE'}</span>
                      {match.winner === match.player2 && <Icon name="check_circle" size={16} className="text-brand-cyan ml-auto shrink-0" />}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
    </>
  );
}

// OP5 — pre-join "do you own the game?" confirm. A player can otherwise join
// (and pay the entry fee) for a game they don't own, then fail at the lobby
// and forfeit. This gives a one-click launcher test before committing, and a
// clear confirm. Resolves the tournament's game to a registry object so the
// LaunchGameDropdown can offer the right launcher / .exe.
// GR1 — public host reputation card. Answers "is this host legit?" inline on
// the tournament page: how many events they've run, completion rate, players
// served, prizes paid, and how often they bring in Vanguard moderation.
function HostLegitCard({ hostUid }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    getHostStats(hostUid)
      .then((s) => { if (!cancelled) setStats(s); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hostUid]);
  if (loading || !stats || stats.hosted === 0) return null;
  const Stat = ({ label, value }) => (
    <div className="flex-1 text-center">
      <p className="text-brand-cyan font-dmmono font-bold text-base">{value}</p>
      <p className="text-text-muted text-[9px] uppercase tracking-wider">{label}</p>
    </div>
  );
  return (
    <div className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="verified_user" size={16} className="text-brand-cyan" />
        <p className="text-text-secondary text-xs font-bold uppercase tracking-wider">Host track record</p>
      </div>
      <div className="flex items-center gap-2">
        <Stat label="Hosted" value={stats.hosted} />
        <Stat label="Completed" value={stats.completed} />
        {stats.completionRate != null && <Stat label="Finish %" value={`${stats.completionRate}%`} />}
        <Stat label="Players" value={stats.totalPlayers} />
        <Stat label="Mod %" value={`${stats.moderatedRate}%`} />
      </div>
      {stats.cancelled > 0 && (
        <p className="text-text-muted text-[10px] mt-2">{stats.cancelled} event{stats.cancelled === 1 ? '' : 's'} cancelled (entries refunded).</p>
      )}
    </div>
  );
}

function GameOwnershipModal({ tournament, joining, onCancel, onConfirm }) {
  const game = gameById(tournament.game);
  const gameName = game?.label || tournament.game || 'this game';
  const paid = (tournament.entryFee || 0) > 0;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl bg-surface-1 border border-white/[0.08] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <Icon name="sports_esports" size={22} className="text-brand-cyan" />
          <h3 className="font-syne text-lg font-bold">Before you register</h3>
        </div>
        <p className="text-text-secondary text-sm leading-relaxed">
          This tournament is played on <strong className="text-text-primary">{gameName}</strong>.
          Make sure you own it and can launch it{paid ? `. The ${tournament.entryFee}-coin entry fee is escrowed on join` : ''}.
          If you can't get into the lobby when your match starts you may forfeit.
        </p>
        {game && (
          <div className="mt-4">
            <p className="text-text-muted text-[11px] uppercase tracking-wide mb-2">Test launch now</p>
            <LaunchGameDropdown game={game} />
          </div>
        )}
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-surface-2 text-text-secondary font-bold text-sm">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={joining}
            className="flex-1 py-3 rounded-xl bg-brand-cyan text-bg-dark font-bold text-sm disabled:opacity-50">
            {joining ? 'Joining…' : paid ? `Register — ${tournament.entryFee}c` : 'Register'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Phase 2 — stage selector for multi-stage tournaments. Renders a chip per
// stage with current-stage highlighted, plus a checkmark on completed stages
// (those that appear in tournament.stageHistory).
function MultiStageTabs({ tournament, matches, viewStageId, setViewStageId }) {
  const stages = tournament.stages || [];
  const current = tournament.currentStageId || stages[0]?.id;
  const completed = new Set((tournament.stageHistory || []).map((h) => h.stageId));
  const view = viewStageId || current;
  return (
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2">
      {stages.map((s, i) => {
        const isView = s.id === view;
        const isCurrent = s.id === current;
        const isDone = completed.has(s.id);
        return (
          <button key={s.id}
            onClick={() => setViewStageId(s.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border transition-all flex items-center gap-1.5 ${
              isView
                ? 'bg-brand-violet/15 border-brand-violet/40 text-brand-violet-light'
                : 'bg-white/[0.04] border-white/[0.06] text-text-muted'
            }`}>
            <span className="font-dmmono text-[10px] opacity-70">{i + 1}</span>
            {s.name || s.type}
            {isDone && <Icon name="check_circle" size={12} className="text-brand-cyan" />}
            {isCurrent && !isDone && <span className="w-1.5 h-1.5 rounded-full bg-brand-cyan animate-pulse" />}
          </button>
        );
      })}
    </div>
  );
}
