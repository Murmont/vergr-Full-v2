// NativeMatchDetailsScreen — dedicated phone-first tournament detail screen for
// the native APK. Same Firestore flows as the web MatchDetailsScreen (leave,
// start, report, finalize, ticket buy, bracket, trophy ceremony) MINUS entry:
// joining and applying are desktop/browser only, so this screen has no path
// into joinTournamentSecure or applyToTournamentSecure. That keeps the Play
// build free of any pay-to-enter-and-win surface, which is a licensed category
// under Play's Real-Money Gambling, Games, and Contests policy.
// It is otherwise a lean mobile-only shell: no useResponsive / LayoutContext desktop
// plumbing, safe-area TopBar, single column, bottom nav clearance. The heavy
// bracket + host + ownership sub-components are imported from the web screen so
// the critical bracket/verify logic is shared, not duplicated. Routed
// IS_NATIVE_BUILD only.

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { useUser } from '../../../context/UserContext';
import { useUI } from '../../../context/UIContext';
import { StackSkeleton } from '../../../components/skeletons/GlassSkeletons';
import {
  getTournament, subscribeTournament, leaveTournamentSecure,
  startTournamentSecure, reportMatchResultSecure, finalizeTournamentSecure,
  getTournamentMatches, getUser, getSquad, getFollowing,
} from '../../../firebase/firestore';
import { applyVanguardMask } from '../../../utils/vanguard';
import { getBracketType, computePrizeBreakdown } from '../../../utils/tournamentTypes';
import TopBar from '../../../components/TopBar';
import UserAvatar from '../../../components/UserAvatar';
import VanguardBadge from '../../../components/VanguardBadge';
import VanguardPresence from '../../../components/VanguardPresence';
import Icon from '../../../components/Icon';
import { BracketFullscreen } from '../../../components/tournaments/BracketVisualization';
import EventTicketCard from '../../../components/tournament/EventTicketCard';
import { EventShareRow } from '../../../components/tournament/EventShareSheet';
import TrophyCeremony from '../../../components/tournament/TrophyCeremony';
import { SquadSponsorModal } from '../../../components/tournament/HostingExtras';
import {
  HostLegitCard, BracketPanel,
} from '../MatchDetailsScreen';

const statusStyle = (status) => {
  switch (status) {
    case 'open': return { bg: 'bg-green-500/15', text: 'text-green-400', label: 'Open' };
    case 'active': return { bg: 'bg-brand-ember/15', text: 'text-brand-ember', label: 'LIVE' };
    case 'completed': return { bg: 'bg-surface-3', text: 'text-text-muted', label: 'Completed' };
    default: return { bg: 'bg-surface-3', text: 'text-text-muted', label: status };
  }
};

export default function NativeMatchDetailsScreen() {
  const { matchId } = useParams();
  const { currentUser } = useAuth();
  const { wallet, profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const openMatch = (mId) => mId && navigate(`/tournaments/${matchId}/match/${mId}`);

  const [followedUids, setFollowedUids] = useState(() => new Set());
  const [tournament, setTournament] = useState(null);
  const [matches, setMatches] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSponsor, setShowSponsor] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [viewStageId, setViewStageId] = useState(null);
  const [bracketFull, setBracketFull] = useState(false);
  const [hasApplied, setHasApplied] = useState(false);

  useEffect(() => {
    if (!currentUser?.uid) { setFollowedUids(new Set()); return; }
    let cancelled = false;
    getFollowing(currentUser.uid)
      .then((rows) => { if (!cancelled) setFollowedUids(new Set(rows.map((r) => r.followingId).filter(Boolean))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const t = await getTournament(matchId);
        if (cancelled) return;
        setTournament(t);
        if (t?.status === 'active' || t?.status === 'completed') {
          const m = await getTournamentMatches(matchId);
          if (!cancelled) setMatches(m);
        }
        if (t?.participants?.length > 0) {
          if (t.mode === 'squad') {
            const squads = await Promise.all(t.participants.map(async (sid) => {
              const s = await getSquad(sid).catch(() => null);
              return s ? { ...s, id: sid, kind: 'squad', name: s.name, tag: s.tag, banner: s.banner || s.bannerUrl } : null;
            }));
            if (!cancelled) setParticipants(squads.filter(Boolean));
          } else {
            const users = await Promise.all(t.participants.map(uid => getUser(uid)));
            if (!cancelled) setParticipants(users.filter(Boolean).map((u) => ({ ...u, kind: 'user' })));
          }
        }
      } catch (err) { console.error(err); }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [matchId]);

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
  const isTicketed = tournament?.fundingModel === 'ticketed';
  const isAdmin = tournament?.adminId === currentUser?.uid;
  const isInvited = (tournament?.invitedUserIds || []).includes(currentUser?.uid);

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
    try { await startTournamentSecure(matchId); showToast('Tournament started!', 'success'); await refresh(); }
    catch (err) { showToast(err.message || 'Failed to start', 'error'); }
  };
  const handleReport = async (mId, winnerId) => {
    try {
      const res = await reportMatchResultSecure({ tournamentId: matchId, matchId: mId, winnerId, source: 'manual' });
      if (res?.status === 'awaiting_confirmation') showToast('Result submitted — waiting for opponent', 'info');
      else if (res?.status === 'disputed') showToast('Reports disagree — match disputed', 'error');
      else showToast('Result recorded!', 'success');
      await refresh();
    } catch (err) { showToast(err.message || 'Failed to report', 'error'); }
  };
  const handleFinalizeNow = async () => {
    try { await finalizeTournamentSecure(matchId); showToast('Prizes distributed!', 'success'); await refresh(); }
    catch (err) { showToast(err.message || 'Failed to finalize', 'error'); }
  };
  // No handleJoin / handleApply here on purpose. Tournament ENTRY (free,
  // paid, or apply-to-private) is desktop and browser only; the phone is a
  // viewing surface. Leaving stays available so someone who registered on a
  // computer can withdraw from anywhere. Do not add an entry path back to this
  // screen without reading the Play compliance notes in CLAUDE.md first.
  const handleLeave = async () => {
    try { await leaveTournamentSecure(matchId); showToast('Left tournament', 'info'); await refresh(); }
    catch (err) { showToast(err.message || 'Failed to leave', 'error'); }
  };

  // Trophy ceremony — once per completed tournament, localStorage-gated.
  const ceremonyKey = `vergr.trophyCeremony.${matchId}`;
  const [showCeremony, setShowCeremony] = useState(false);
  useEffect(() => {
    if (!tournament || tournament.status !== 'completed') return;
    if (localStorage.getItem(ceremonyKey)) return;
    const placements = tournament.placements || {};
    const top3 = [placements.first, placements.second,
      Array.isArray(placements.third) ? placements.third[0] : placements.third].filter(Boolean);
    if (top3.length === 0 && tournament.winnerId) top3.push(tournament.winnerId);
    if (top3.length > 0) setShowCeremony(true);
    // eslint-disable-next-line
  }, [tournament?.status, currentUser?.uid]);

  if (loading) return <div className="min-h-screen"><TopBar showBack title="Tournament" /><StackSkeleton rows={5} height={88} /></div>;
  if (!tournament) return <div className="min-h-screen"><TopBar showBack title="Tournament" /><div className="text-center py-20"><p className="text-text-muted">Tournament not found</p></div></div>;

  const status = statusStyle(tournament.status);

  const ceremonyStandings = (() => {
    const placements = tournament?.placements || {};
    const ids = [placements.first, placements.second,
      Array.isArray(placements.third) ? placements.third[0] : placements.third].filter(Boolean);
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
        <TrophyCeremony standings={ceremonyStandings} prizes={ceremonyPrizes}
          onClose={() => { localStorage.setItem(ceremonyKey, '1'); setShowCeremony(false); }} />
      )}
      {showSponsor && (
        <SquadSponsorModal tournamentId={matchId} onClose={() => setShowSponsor(false)} onSponsored={refresh} />
      )}
      <VanguardPresence parentPath={`tournaments/${matchId}`} />

      <div className="min-h-screen" style={{ paddingBottom: 'calc(88px + env(safe-area-inset-bottom, 0px))' }}>
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
                    <span className="absolute top-2 right-2 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-gold animate-pulse" />
                    </span>
                  )}
                  <Icon name="emoji_events" size={20} className="text-brand-gold mx-auto mb-1" />
                  <p className="text-brand-gold font-dmmono font-bold text-lg">{((isTicketed ? tournament.declaredPurse : tournament.prizePool) || 0).toLocaleString()}</p>
                  <p className="text-text-muted text-[9px] uppercase">{isTicketed ? 'Prize Purse' : 'Prize Pool'}</p>
                </div>
                <div className="p-3 rounded-xl bg-bg-dark/50 border border-white/[0.06] text-center">
                  <Icon name="confirmation_number" size={20} className="text-brand-violet-light mx-auto mb-1" />
                  <p className="text-brand-violet-light font-dmmono font-bold text-lg">
                    {isTicketed ? (tournament.ticket?.priceCoins ? tournament.ticket.priceCoins.toLocaleString() : 'Free') : (tournament.entryFee || 'Free')}
                  </p>
                  <p className="text-text-muted text-[9px] uppercase">{isTicketed ? 'Ticket' : 'Entry Fee'}</p>
                </div>
                <div className="p-3 rounded-xl bg-bg-dark/50 border border-white/[0.06] text-center">
                  <Icon name={isTicketed ? 'visibility' : 'group'} size={20} className="text-brand-violet mx-auto mb-1" />
                  {isTicketed
                    ? <p className="text-brand-violet font-dmmono font-bold text-lg">{tournament.ticket?.sold || 0}/{tournament.ticket?.capacity || 0}</p>
                    : <p className="text-brand-violet font-dmmono font-bold text-lg">{tournament.participants?.length || 0}/{tournament.maxParticipants}</p>}
                  <p className="text-text-muted text-[9px] uppercase">{isTicketed ? 'Tickets' : 'Players'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Host actions */}
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
              <Icon name="admin_panel_settings" size={18} /> Admin Control Panel
            </button>
          )}
          {isAdmin && tournament.overlayToken && tournament.requiresManualMod && (
            <div className="mb-3 p-3 rounded-xl bg-surface-1 border border-brand-violet-light/30">
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">OBS Browser-Source Overlay (display-only)</div>
              <div className="text-xs text-text-secondary mb-2">Add this URL as an OBS browser source to display tournament info on your broadcast. Winners are called by the assigned Vanguard moderator.</div>
              <div className="flex items-center gap-2">
                <input readOnly value={`${window.location.origin}/overlay/${matchId}?token=${tournament.overlayToken}&mode=obs`}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 text-[10px] font-mono bg-bg-dark border border-white/10 rounded px-2 py-1.5 text-text-primary" />
                <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/overlay/${matchId}?token=${tournament.overlayToken}&mode=obs`); showToast('Overlay URL copied.', 'success'); }}
                  className="px-3 py-1.5 rounded bg-brand-violet text-white text-xs font-bold hover:brightness-110">Copy</button>
              </div>
            </div>
          )}
          {isAdmin && tournament.status === 'completed' && tournament.payoutStatus !== 'paid' && (
            <button onClick={handleFinalizeNow}
              className="w-full mb-3 py-3 rounded-xl bg-gradient-to-r from-brand-gold to-amber-600 text-bg-dark font-extrabold text-sm flex items-center justify-center gap-2 hover:brightness-110 shadow-lg shadow-brand-gold/25">
              <Icon name="paid" size={18} /> Finalize &amp; distribute prizes
            </button>
          )}
          {tournament.status === 'completed' && tournament.payoutStatus === 'paid' && (
            <div className="w-full mb-3 py-3 rounded-xl bg-brand-violet/10 border border-brand-violet/30 text-brand-violet-light text-center text-sm font-bold flex items-center justify-center gap-2">
              <Icon name="check_circle" size={18} /> Prizes distributed
            </div>
          )}

          {isTicketed && !isAdmin && !isRegistered && (tournament.status === 'open' || tournament.status === 'active') && (
            <div className="mb-4"><EventTicketCard tournament={{ ...tournament, id: matchId }} source="direct" /></div>
          )}
          {isTicketed && tournament.status !== 'cancelled' && (
            <div className="mb-4 flex items-center justify-between gap-2 p-3 rounded-xl bg-surface-1 border border-white/[0.06]">
              <div className="min-w-0">
                <p className="text-text-primary text-sm font-bold">{isAdmin ? 'Sell tickets' : 'Share this event'}</p>
                <p className="text-text-muted text-[11px] truncate">{isAdmin ? 'Send the link to your fans and followers.' : 'Invite friends to watch.'}</p>
              </div>
              <EventShareRow tournament={{ ...tournament, id: matchId }} />
            </div>
          )}

          {tournament.status === 'open' && (
            <div className="mb-4">
              {isRegistered ? (
                <div className="flex gap-2">
                  <div className="flex-1 py-3 rounded-xl bg-brand-violet/10 border border-brand-violet/30 text-brand-violet-light text-center text-sm font-bold flex items-center justify-center gap-2">
                    <Icon name="check_circle" size={18} /> Registered
                  </div>
                  <button onClick={handleLeave} className="px-4 py-3 rounded-xl bg-surface-2 border border-white/[0.06] text-text-muted text-sm font-bold hover:text-brand-ember hover:border-brand-ember/30 transition-colors">Leave</button>
                </div>
              ) : isFull ? (
                <div className="py-3 rounded-xl bg-surface-2 border border-white/[0.06] text-text-muted text-center text-sm font-bold">Tournament Full</div>
              ) : hasApplied ? (
                <div className="py-3 rounded-xl bg-brand-gold/10 border border-brand-gold/30 text-brand-gold text-center text-sm font-bold flex items-center justify-center gap-2">
                  <Icon name="hourglass_top" size={18} /> Application pending
                </div>
              ) : (
                /* Entry is desktop/browser only. The phone is a viewing
                   surface: watch, buy a spectator ticket, follow the bracket.
                   Registering (free or paid) happens on a computer. */
                <div className="py-3 px-4 rounded-xl bg-surface-1 border border-white/[0.06] text-center">
                  <p className="text-text-primary text-sm font-bold flex items-center justify-center gap-2">
                    <Icon name="desktop_windows" size={18} /> Entry is on desktop
                  </p>
                  <p className="text-text-muted text-[11px] mt-1">
                    Open vergr.app on a computer to register. You can watch and follow the bracket here.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Your active matches to report on */}
          {tournament.status === 'active' && matches.length > 0 && (() => {
            const myPending = matches.filter(m =>
              m.status !== 'completed' && !m.bye && m.player1 && m.player2 &&
              (m.player1 === currentUser?.uid || m.player2 === currentUser?.uid || isAdmin));
            if (myPending.length === 0) return null;
            return (
              <div className="mb-4 space-y-3">
                <h3 className="text-text-muted text-[10px] uppercase font-bold tracking-widest">Your matches</h3>
                {myPending.map(m => {
                  const p1 = participants.find(p => p.id === m.player1);
                  const p2 = participants.find(p => p.id === m.player2);
                  const isInMatch = m.player1 === currentUser?.uid || m.player2 === currentUser?.uid;
                  return (
                    <div key={m.id} className="p-4 rounded-2xl bg-surface-1 border border-brand-violet/20">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-text-muted text-[10px] uppercase font-bold tracking-widest">Round {m.round} · Match {m.matchNumber}</span>
                        <span className={`ml-auto px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                          m.status === 'awaiting_confirmation' ? 'bg-brand-gold/15 text-brand-gold' :
                          m.status === 'disputed' ? 'bg-brand-ember/15 text-brand-ember' :
                          'bg-brand-violet/15 text-brand-violet-light'
                        }`}>{m.status === 'awaiting_confirmation' ? 'Awaiting confirmation' : m.status === 'in_progress' ? 'Live' : m.status}</span>
                      </div>
                      <p className="text-text-muted text-xs mb-3">
                        {isAdmin && !isInMatch ? 'As host, your call advances the bracket immediately.' :
                         m.status === 'awaiting_confirmation' ? 'Your opponent reported a result. Confirm or contest below.' :
                         'Both players must agree on the winner. If you disagree, the match is flagged disputed.'}
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => handleReport(m.id, m.player1)}
                          className="py-2.5 rounded-xl bg-surface-2 border border-white/[0.08] hover:border-brand-violet/40 hover:bg-brand-violet/10 text-sm font-bold flex items-center justify-center gap-2 transition-colors">
                          <UserAvatar src={p1?.avatar} size={22} />
                          <span className="truncate">{p1?.displayName || p1?.username || 'Player 1'} won</span>
                        </button>
                        <button onClick={() => handleReport(m.id, m.player2)}
                          className="py-2.5 rounded-xl bg-surface-2 border border-white/[0.08] hover:border-brand-violet/40 hover:bg-brand-violet/10 text-sm font-bold flex items-center justify-center gap-2 transition-colors">
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
                className={`flex-1 py-2 rounded-lg text-xs font-bold capitalize transition-all ${activeTab === tab ? 'bg-surface-3 text-white' : 'text-text-muted'}`}>{tab}</button>
            ))}
          </div>

          {activeTab === 'overview' && (
            <div className="space-y-3">
              {tournament.adminId && <HostLegitCard hostUid={tournament.adminId} />}
              {tournament.visibility !== 'private' && ['open', 'registration', 'active', 'live'].includes(tournament.status) && (
                <button onClick={() => setShowSponsor(true)}
                  className="w-full p-4 rounded-2xl bg-surface-1 border border-brand-violet/20 flex items-center gap-3 hover:border-brand-violet/40 transition-colors">
                  <Icon name="volunteer_activism" size={20} className="text-brand-violet-light" />
                  <span className="flex-1 text-sm font-semibold text-left">Sponsor from squad treasury</span>
                  <Icon name="chevron_right" size={18} className="text-text-muted" />
                </button>
              )}
              <button onClick={() => navigate(`/tournaments/${matchId}/standings`)}
                className="w-full p-4 rounded-2xl bg-surface-1 border border-white/[0.06] flex items-center gap-3">
                <Icon name="leaderboard" size={20} className="text-brand-gold" />
                <span className="flex-1 text-sm font-semibold text-left">Standings</span>
                <Icon name="chevron_right" size={18} className="text-text-muted" />
              </button>
              <button onClick={() => navigate(`/tournaments/${matchId}/prizes`)}
                className="w-full p-4 rounded-2xl bg-surface-1 border border-white/[0.06] flex items-center gap-3">
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
                    if (!pb.payouts.length) return <p className="text-text-muted text-xs">Custom prize split set by creator</p>;
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
                      className="w-full flex items-center gap-3 p-3 rounded-xl bg-surface-1 border border-white/[0.06]">
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
              <div className="flex justify-end">
                <button onClick={() => setBracketFull(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-text-secondary text-xs font-bold">
                  <Icon name="open_in_full" size={13} /> Full screen
                </button>
              </div>
              <BracketPanel tournament={tournament} matches={matches} participants={participants}
                viewStageId={viewStageId} setViewStageId={setViewStageId}
                followedUids={followedUids} openMatch={openMatch} />
            </div>
          )}
          {bracketFull && (
            <BracketFullscreen title={`${tournament.name} · Bracket`} onClose={() => setBracketFull(false)}>
              <BracketPanel tournament={tournament} matches={matches} participants={participants}
                viewStageId={viewStageId} setViewStageId={setViewStageId}
                followedUids={followedUids} openMatch={openMatch} />
            </BracketFullscreen>
          )}
        </div>
      </div>
    </>
  );
}
