// GR5 — Brawl quickplay modal. Pick a game + stake, get matched into an
// instant 1v1. Calls joinBrawlQueue; if matched immediately we route in,
// otherwise we wait on the queue doc snapshot until an opponent pairs.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useUI } from '../../context/UIContext';
import { TOURNAMENT_GAMES } from '../../utils/tournamentGames';

const fns = () => getFunctions(undefined, 'europe-west1');
const C = {
  surface: '#14141F', soft: '#1A1A2A', border: 'rgba(255,255,255,0.10)',
  text: '#fff', dim: 'rgba(255,255,255,0.65)', cyan: '#4DFFD4', violet: '#7B1FFF',
};

const GAME_PICKS = ['Counter-Strike 2', 'VALORANT', 'EA Sports FC 25 (FIFA)', 'NBA 2K', 'Rocket League', 'Street Fighter 6', 'Tekken 8']
  .filter((g) => TOURNAMENT_GAMES.some((tg) => tg.label === g));
const STAKES = [0, 50, 100, 250, 500, 1000];

export default function BrawlQuickplay({ onClose }) {
  const navigate = useNavigate();
  const { showToast } = useUI();
  const [game, setGame] = useState(GAME_PICKS[0] || 'Counter-Strike 2');
  const [stake, setStake] = useState(0);
  const [searching, setSearching] = useState(false);
  const queueRef = useRef(null);
  const unsubRef = useRef(null);

  const goToMatch = (tid, mid) => {
    cleanup();
    onClose?.();
    navigate(`/tournaments/${tid}/match/${mid}`);
  };

  const cleanup = () => {
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
  };
  useEffect(() => () => cleanup(), []);

  const find = async () => {
    if (searching) return;
    setSearching(true);
    try {
      const { data } = await httpsCallable(fns(), 'joinBrawlQueue')({ game, stake });
      if (data.matched) { goToMatch(data.tournamentId, data.matchId); return; }
      // Waiting — subscribe to our queue doc until an opponent pairs.
      queueRef.current = data.queueId;
      unsubRef.current = onSnapshot(doc(db, 'brawl_queue', data.queueId), (snap) => {
        const d = snap.data();
        if (d?.status === 'matched' && d.matchedTournamentId) {
          goToMatch(d.matchedTournamentId, d.matchedMatchId);
        }
      });
    } catch (err) {
      showToast(err?.message || 'Could not join the queue', 'error');
      setSearching(false);
    }
  };

  const cancel = async () => {
    cleanup();
    if (queueRef.current) {
      try { await httpsCallable(fns(), 'leaveBrawlQueue')({ queueId: queueRef.current }); } catch { /* ignore */ }
      queueRef.current = null;
    }
    setSearching(false);
  };

  return (
    <div onClick={() => { if (!searching) onClose?.(); }} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.surface, borderRadius: 16, padding: 20, width: '100%', maxWidth: 420,
        border: `1px solid ${C.border}`, color: C.text, fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>Brawl · quick 1v1</div>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>
          No bracket to commit to — pick a game, get matched into an instant 1v1.
        </div>

        {searching ? (
          <div style={{ textAlign: 'center', padding: '28px 0' }}>
            <div style={{
              width: 40, height: 40, margin: '0 auto 14px', borderRadius: '50%',
              border: `3px solid ${C.border}`, borderTopColor: C.cyan, animation: 'spin 1s linear infinite',
            }} />
            <div style={{ fontSize: 14, fontWeight: 700 }}>Finding an opponent…</div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>{game}{stake > 0 ? ` · ${stake}c stake` : ' · free'}</div>
            <button onClick={cancel} style={{
              marginTop: 18, padding: '10px 22px', borderRadius: 10,
              background: 'transparent', border: `1px solid ${C.border}`, color: C.text, fontWeight: 700, cursor: 'pointer',
            }}>Cancel</button>
            <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 11, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '16px 0 8px' }}>Game</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {GAME_PICKS.map((g) => (
                <button key={g} onClick={() => setGame(g)} style={{
                  padding: '8px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: game === g ? `${C.cyan}22` : C.soft,
                  border: `1px solid ${game === g ? C.cyan : C.border}`,
                  color: game === g ? C.cyan : C.text,
                }}>{g}</button>
              ))}
            </div>

            <div style={{ fontSize: 11, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '16px 0 8px' }}>Stake</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {STAKES.map((s) => (
                <button key={s} onClick={() => setStake(s)} style={{
                  padding: '8px 14px', borderRadius: 999, fontSize: 12, fontWeight: 800, cursor: 'pointer',
                  background: stake === s ? `${C.violet}33` : C.soft,
                  border: `1px solid ${stake === s ? C.violet : C.border}`,
                  color: stake === s ? '#fff' : C.text,
                }}>{s === 0 ? 'Free' : `${s}c`}</button>
              ))}
            </div>
            {stake > 0 && (
              <div style={{ fontSize: 11, color: C.dim, marginTop: 10 }}>
                Winner takes {stake * 2}c. Both stakes are escrowed when matched. KYC required for paid brawls.
              </div>
            )}

            <button onClick={find} style={{
              width: '100%', marginTop: 18, padding: 13, borderRadius: 12, border: 'none',
              background: `linear-gradient(135deg, ${C.cyan}, #7B6FFF)`, color: '#000', fontWeight: 900, fontSize: 14, cursor: 'pointer',
            }}>Find match</button>
          </>
        )}
      </div>
    </div>
  );
}
