import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { StackSkeleton } from '../../components/skeletons/GlassSkeletons';
import { getTournament, getSquad, getUser } from '../../firebase/firestore';
import { computePrizeBreakdown, getBracketType } from '../../utils/tournamentTypes';

export default function TournamentPrizePoolScreen() {
  const { tournamentId } = useParams();
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();
  const [tournament, setTournament] = useState(null);
  const [winner, setWinner] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const t = await getTournament(tournamentId);
        if (cancelled) return;
        setTournament(t);
        const winnerId = t?.placements?.first || t?.winnerId || null;
        if (winnerId) {
          const fetcher = t.mode === 'squad' ? getSquad : getUser;
          const w = await fetcher(winnerId).catch(() => null);
          if (!cancelled) setWinner(w ? { id: winnerId, name: w.name || w.displayName || w.username || winnerId, avatar: w.avatar || w.bannerUrl || null } : null);
        }
      } catch (err) {
        console.error('PrizePool load', err);
      }
      if (!cancelled) setLoading(false);
    })();
  }, [tournamentId]);

  if (loading) {
    return (
      <div className={isDesktop ? 'min-h-screen pb-8' : 'screen-container min-h-screen pb-8'}>
        <TopBar title="Prize Pool" showBack />
        <StackSkeleton rows={4} height={68} />
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className={isDesktop ? 'min-h-screen pb-8' : 'screen-container min-h-screen pb-8'}>
        <TopBar title="Prize Pool" showBack />
        <div className="text-center py-16 px-4">
          <Icon name="error_outline" size={48} className="text-text-muted/30 mx-auto mb-3" />
          <p className="text-text-muted text-sm">Tournament not found</p>
        </div>
      </div>
    );
  }

  const bracketCfg = getBracketType(tournament.type) || getBracketType('single_elim');
  const isSquadMode = tournament.mode === 'squad';
  const breakdown = computePrizeBreakdown(tournament.prizePool || 0, bracketCfg.id, {
    squadTreasury: isSquadMode,
  });
  const winnerCoins = breakdown.payouts[0]?.gross || 0;
  const finalized = tournament.status === 'completed';

  return (
    <div className={isDesktop ? 'min-h-screen pb-8' : 'screen-container min-h-screen pb-8'}>
      <TopBar title="Prize Pool" showBack />
      <div className="px-4 py-4 space-y-4">
        <div className="p-6 rounded-2xl bg-gradient-to-br from-brand-gold/15 to-surface-2 border border-brand-gold/30 text-center">
          <Icon name="emoji_events" size={32} className="text-brand-gold mx-auto mb-2" />
          <p className="text-text-muted text-xs uppercase tracking-wider mb-1">Total Prize Pool</p>
          <p className="font-dmmono text-3xl font-bold text-brand-gold">
            {(tournament.prizePool || 0).toLocaleString()} <span className="text-base">coins</span>
          </p>
          <p className="text-text-muted text-xs mt-1">{tournament.name}</p>
        </div>

        <div className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06] space-y-2.5">
          <Row label="Gross pool" value={`${breakdown.gross.toLocaleString()} c`} valueClass="text-brand-gold font-bold" />
          <Row label="Mod cut (5%)" value={`−${breakdown.modCut.toLocaleString()} c`} subtle />
          <div className="h-px bg-white/[0.06]" />
          <Row
            label={isSquadMode ? 'To winning squad treasury' : 'To winner'}
            value={`${winnerCoins.toLocaleString()} c`}
            valueClass="text-brand-violet-light font-bold text-base"
          />
        </div>

        <div className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
          <p className="text-text-muted text-[10px] uppercase tracking-widest font-bold mb-3">
            {finalized ? 'Winner' : 'Payout Recipient'}
          </p>
          {finalized && winner ? (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-brand-gold/10 border border-brand-gold/30">
              <div className="w-12 h-12 rounded-full bg-brand-gold/20 flex items-center justify-center overflow-hidden">
                {winner.avatar
                  ? <img src={winner.avatar} alt="" className="w-full h-full object-cover" />
                  : <Icon name={isSquadMode ? 'groups' : 'person'} size={20} className="text-brand-gold" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{winner.name}</p>
                <p className="text-xs text-brand-gold font-dmmono">+{winnerCoins.toLocaleString()} coins</p>
              </div>
              <span className="text-2xl">🏆</span>
            </div>
          ) : (
            <p className="text-text-muted text-sm">
              {isSquadMode
                ? 'The winning squad receives the full pool (minus 5% mod fee) into its treasury.'
                : 'The tournament winner receives the full pool (minus 5% mod fee).'}
            </p>
          )}
        </div>

        <div className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
          <p className="text-text-muted text-[10px] uppercase tracking-widest font-bold mb-2">
            Leaderboard Points
          </p>
          <p className="text-text-secondary text-xs leading-relaxed">
            Tournament Points (TP) are awarded to every participant based on final placement
            and tournament size — separate from the coin prize. TP shows up on the Top Players
            leaderboard.
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, valueClass = 'text-text-primary font-dmmono', subtle = false }) {
  return (
    <div className="flex justify-between items-center">
      <span className={`text-sm ${subtle ? 'text-text-muted' : 'text-text-secondary'}`}>{label}</span>
      <span className={`text-sm font-dmmono ${valueClass}`}>{value}</span>
    </div>
  );
}
