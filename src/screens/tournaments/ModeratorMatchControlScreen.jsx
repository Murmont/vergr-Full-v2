import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { getTournament, getTournamentMatches, reportMatchResultSecure, startTournamentSecure, finalizeTournamentSecure, getUser } from '../../firebase/firestore';
import { useLayout } from '../../context/LayoutContext';
import { StackSkeleton } from '../../components/skeletons/GlassSkeletons';
import useResponsive from '../../hooks/useResponsive';
import TopBar from '../../components/TopBar';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';

export default function ModeratorMatchControlScreen() {
  const { matchId } = useParams();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  const [tournament, setTournament] = useState(null);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  useEffect(() => {
    setRightPanel(null);
    setContentAlign(isDesktop ? 'left' : 'center');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  const loadData = async () => {
    setLoading(true);
    try {
      const t = await getTournament(matchId);
      setTournament(t);
      if (t?.status === 'active' || t?.status === 'completed') {
        const m = await getTournamentMatches(matchId);
        setMatches(m);
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  useEffect(() => { if (matchId) loadData(); }, [matchId]);

  const handleStart = async () => {
    setActionLoading('start');
    try {
      await startTournamentSecure(matchId);
      showToast('Tournament started! Bracket generated.', 'success');
      await loadData();
    } catch (err) { showToast(err.message || 'Failed to start', 'error'); }
    setActionLoading(null);
  };

  const handleReportWinner = async (matchDocId, winnerId) => {
    setActionLoading(matchDocId);
    try {
      // Host override: 'manual' source — server detects adminId === uid and
      // advances the bracket without waiting for two-player agreement.
      await reportMatchResultSecure({ tournamentId: matchId, matchId: matchDocId, winnerId, source: 'manual' });
      showToast('Result recorded', 'success');
      await loadData();
    } catch (err) { showToast(err.message || 'Failed to report', 'error'); }
    setActionLoading(null);
  };

  const handleDistribute = async () => {
    if (!window.confirm('Distribute prize pool to winners? This cannot be undone.')) return;
    setActionLoading('distribute');
    try {
      await finalizeTournamentSecure(matchId);
      showToast('Prizes distributed!', 'success');
      await loadData();
    } catch (err) { showToast(err.message || 'Failed to distribute', 'error'); }
    setActionLoading(null);
  };

  if (loading) return <div className="min-h-screen"><TopBar showBack title="Match Control" /><StackSkeleton rows={4} height={80} /></div>;
  if (!tournament) return <div className="min-h-screen"><TopBar showBack title="Match Control" /><div className="text-center py-20 text-text-muted">Tournament not found</div></div>;
  if (tournament.adminId !== currentUser?.uid) return <div className="min-h-screen"><TopBar showBack title="Match Control" /><div className="text-center py-20 text-text-muted">Admin access only</div></div>;

  const pendingMatches = matches.filter(m => m.status === 'pending' || m.status === 'in_progress' || m.status === 'awaiting_confirmation');
  const completedMatches = matches.filter(m => m.status === 'completed');
  const allRoundComplete = pendingMatches.length === 0 && matches.length > 0;

  return (
    <div className="min-h-screen pb-24 lg:pb-8">
      <TopBar showBack title="Match Control" />

      <div className={`px-4 py-4 ${isDesktop ? 'max-w-3xl' : ''}`}>
        {/* Status header */}
        <div className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06] mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-syne font-bold text-lg">{tournament.name}</h2>
            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
              tournament.status === 'open' ? 'bg-green-500/15 text-green-400' :
              tournament.status === 'active' ? 'bg-brand-ember/15 text-brand-ember' :
              'bg-surface-3 text-text-muted'
            }`}>{tournament.status}</span>
          </div>
          <div className="flex gap-4 text-xs text-text-muted">
            <span>{tournament.participants?.length || 0} players</span>
            <span>Prize: {(tournament.prizePool || 0).toLocaleString()} coins</span>
            <span>{tournament.game}</span>
          </div>
        </div>

        {/* Start tournament button */}
        {tournament.status === 'open' && (
          <button onClick={handleStart} disabled={actionLoading === 'start' || (tournament.participants?.length || 0) < 2}
            className="w-full py-4 rounded-2xl bg-brand-violet text-white font-bold text-sm mb-4 hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-30">
            {actionLoading === 'start' ? 'Generating bracket...' : `Start Tournament (${tournament.participants?.length || 0} players)`}
          </button>
        )}

        {/* Active matches */}
        {tournament.status === 'active' && (
          <>
            {pendingMatches.length > 0 && (
              <div className="mb-6">
                <h3 className="text-text-secondary text-[10px] uppercase tracking-widest font-bold mb-3">Awaiting Results ({pendingMatches.length})</h3>
                <div className="space-y-3">
                  {pendingMatches.map(match => (
                    <div key={match.id} className="p-4 rounded-2xl bg-surface-1 border border-brand-gold/20">
                      <p className="text-text-muted text-[10px] uppercase font-bold tracking-widest mb-3">Round {match.round} · Match {match.matchNumber}</p>
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleReportWinner(match.id, match.player1)}
                          disabled={!!actionLoading}
                          className="flex-1 flex items-center gap-2 p-3 rounded-xl bg-surface-2 border border-white/[0.06] hover:border-white/[0.12] hover:bg-brand-violet/5 transition-all group">
                          <UserAvatar src={match.player1Data?.avatar} size={32} />
                          <span className="text-sm font-semibold truncate flex-1 text-left">{match.player1Data?.displayName || 'Player 1'}</span>
                          <span className="text-[9px] text-text-muted group-hover:text-brand-violet-light font-bold uppercase opacity-0 group-hover:opacity-100 transition-opacity">Winner</span>
                        </button>
                        <span className="text-text-muted text-xs font-bold shrink-0">VS</span>
                        <button onClick={() => handleReportWinner(match.id, match.player2)}
                          disabled={!!actionLoading || !match.player2}
                          className="flex-1 flex items-center gap-2 p-3 rounded-xl bg-surface-2 border border-white/[0.06] hover:border-white/[0.12] hover:bg-brand-violet/5 transition-all group">
                          <UserAvatar src={match.player2Data?.avatar} size={32} />
                          <span className="text-sm font-semibold truncate flex-1 text-left">{match.player2Data?.displayName || 'BYE'}</span>
                          <span className="text-[9px] text-text-muted group-hover:text-brand-violet-light font-bold uppercase opacity-0 group-hover:opacity-100 transition-opacity">Winner</span>
                        </button>
                      </div>
                      {actionLoading === match.id && (
                        <div className="flex justify-center mt-2"><div className="w-5 h-5 border-2 border-brand-violet border-t-transparent rounded-full animate-spin" /></div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {completedMatches.length > 0 && (
              <div className="mb-6">
                <h3 className="text-text-secondary text-[10px] uppercase tracking-widest font-bold mb-3">Completed ({completedMatches.length})</h3>
                <div className="space-y-2">
                  {completedMatches.map(match => (
                    <div key={match.id} className="p-3 rounded-xl bg-surface-1 border border-white/[0.06] flex items-center gap-3">
                      <span className="text-text-muted text-[10px] font-dmmono w-16 shrink-0">R{match.round} M{match.matchNumber}</span>
                      <div className={`flex items-center gap-1.5 flex-1 ${match.winner === match.player1 ? 'text-brand-violet-light' : 'text-text-muted'}`}>
                        <UserAvatar src={match.player1Data?.avatar} size={24} />
                        <span className="text-xs font-semibold truncate">{match.player1Data?.displayName}</span>
                        {match.winner === match.player1 && <Icon name="check" size={14} className="text-brand-violet-light shrink-0" />}
                      </div>
                      <span className="text-text-muted text-[10px]">vs</span>
                      <div className={`flex items-center gap-1.5 flex-1 ${match.winner === match.player2 ? 'text-brand-violet-light' : 'text-text-muted'}`}>
                        <UserAvatar src={match.player2Data?.avatar} size={24} />
                        <span className="text-xs font-semibold truncate">{match.player2Data?.displayName || 'BYE'}</span>
                        {match.winner === match.player2 && <Icon name="check" size={14} className="text-brand-violet-light shrink-0" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Distribute prizes when all matches done */}
            {allRoundComplete && !tournament.prizeDistributed && tournament.prizePool > 0 && (
              <button onClick={handleDistribute} disabled={actionLoading === 'distribute'}
                className="w-full py-4 rounded-2xl bg-brand-gold/15 border border-brand-gold/30 text-brand-gold font-bold text-sm hover:bg-brand-gold/25 transition-all">
                {actionLoading === 'distribute' ? 'Distributing...' : `Distribute Prize Pool (${tournament.prizePool.toLocaleString()} coins)`}
              </button>
            )}

            {tournament.prizeDistributed && (
              <div className="p-4 rounded-2xl bg-brand-violet/10 border border-brand-violet/20 text-center">
                <Icon name="check_circle" size={24} className="text-brand-violet-light mx-auto mb-2" />
                <p className="text-brand-violet-light font-bold text-sm">Prizes distributed</p>
              </div>
            )}
          </>
        )}

        {/* Quick link to public view */}
        <button onClick={() => navigate(`/match/${matchId}`)}
          className="w-full mt-4 p-3 rounded-xl bg-surface-2 border border-white/[0.06] text-text-muted text-sm text-center hover:text-text-secondary transition-colors">
          View public tournament page →
        </button>
      </div>
    </div>
  );
}
