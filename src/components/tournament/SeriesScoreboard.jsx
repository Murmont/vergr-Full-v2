// SeriesScoreboard — Phase 1 series UI for TournamentMatchScreen.
//
// Renders:
//   - Big "2-1" score line for Bo3/Bo5 (hidden for Bo1)
//   - Per-game pip list (1 ● 2 ● 3 ○)
//   - "Report Game N" button (next-in-sequence)
//   - Per-game agreement state (awaiting / disputed)
//
// Backend: calls `reportGameResultSecure` with the explicit gameNumber.

import { useMemo, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import Icon from '../Icon';

const C = {
  surface: '#14141F', soft: '#1A1A2A', border: 'rgba(255,255,255,0.10)',
  text: '#fff', dim: 'rgba(255,255,255,0.65)', mute: 'rgba(255,255,255,0.45)',
  gold: '#F0A500', goldLight: '#F5C842',
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444', cyan: '#B44FFF',
};

const SERIES_THRESHOLD = { bo1: 1, bo3: 2, bo5: 3 };
const SERIES_MAX_GAMES = { bo1: 1, bo3: 3, bo5: 5 };

const fns = () => getFunctions(undefined, 'europe-west1');

export default function SeriesScoreboard({
  match, tournamentId, p1, p2, currentUid, iAmPlayer, onToast,
}) {
  const seriesFormat = match.seriesFormat || 'bo1';
  const need = SERIES_THRESHOLD[seriesFormat] || 1;
  const maxGames = SERIES_MAX_GAMES[seriesFormat] || 1;
  const seriesScore = match.seriesScore || { a: 0, b: 0 };
  const games = Array.isArray(match.games) ? match.games : [];
  const gameReportState = match.gameReportState || {};
  const seriesDone = !!match.seriesWinner || match.status === 'completed';
  const nextGameNumber = games.length + 1;
  const myReport = gameReportState[`g${nextGameNumber}`];

  const [busy, setBusy] = useState(false);

  // Bo1: don't render — TournamentMatchScreen's existing "I won / They won"
  // CTAs already handle single-game matches via reportMatchResultSecure.
  if (seriesFormat === 'bo1') return null;

  const reportGame = async (winnerUid) => {
    if (busy) return;
    setBusy(true);
    try {
      await httpsCallable(fns(), 'reportGameResultSecure')({
        tournamentId, matchId: match.id, gameNumber: nextGameNumber, winnerId: winnerUid,
      });
      onToast?.(`Game ${nextGameNumber} reported.`, 'success');
    } catch (e) {
      onToast?.(e?.message || 'Report failed', 'error');
    } finally { setBusy(false); }
  };

  const opponentUid = currentUid === match.player1 ? match.player2 : match.player1;
  const myReportedNext = myReport?.firstReporter === currentUid;
  const oppReportedNext = myReport?.firstReporter === opponentUid;

  const pips = useMemo(() => {
    const out = [];
    for (let i = 1; i <= maxGames; i++) {
      const g = games.find((gm) => gm.gameNumber === i);
      const state = gameReportState[`g${i}`];
      let kind;
      if (g?.winnerId === match.player1) kind = 'p1';
      else if (g?.winnerId === match.player2) kind = 'p2';
      else if (state?.status === 'disputed') kind = 'disputed';
      else if (state?.status === 'awaiting_confirmation') kind = 'awaiting';
      else if (i <= games.length + 1 && i > games.length) kind = 'next';
      else kind = 'empty';
      out.push({ n: i, kind });
    }
    return out;
  }, [games, gameReportState, maxGames, match.player1, match.player2]);

  return (
    <div style={{
      padding: 14, borderRadius: 14,
      background: `linear-gradient(135deg, ${C.gold}11, ${C.goldLight}11)`,
      border: `1px solid ${C.gold}55`,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8,
      }}>
        <div style={{
          fontFamily: 'DM Mono, monospace', fontSize: 10, fontWeight: 800,
          color: C.gold, letterSpacing: '0.1em', textTransform: 'uppercase',
        }}>
          {seriesFormat.toUpperCase()} · first to {need}
        </div>
        {seriesDone && (
          <div style={{
            padding: '2px 8px', borderRadius: 6, background: C.green + '22',
            color: C.green, fontFamily: 'DM Mono, monospace',
            fontSize: 10, fontWeight: 800,
          }}>SERIES WON</div>
        )}
      </div>

      {/* Big score */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20,
        padding: '10px 0',
      }}>
        <div style={{ flex: 1, textAlign: 'right', minWidth: 0 }}>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {p1?.username || 'P1'}
          </div>
          <div style={{
            fontFamily: 'DM Mono, monospace', fontSize: 36, fontWeight: 900,
            color: seriesScore.a >= need ? C.green : C.text, lineHeight: 1,
          }}>{seriesScore.a}</div>
        </div>
        <div style={{
          fontFamily: 'DM Mono, monospace', fontSize: 18, color: C.mute,
        }}>—</div>
        <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {p2?.username || 'P2'}
          </div>
          <div style={{
            fontFamily: 'DM Mono, monospace', fontSize: 36, fontWeight: 900,
            color: seriesScore.b >= need ? C.green : C.text, lineHeight: 1,
          }}>{seriesScore.b}</div>
        </div>
      </div>

      {/* Pips */}
      <div style={{
        display: 'flex', gap: 6, justifyContent: 'center', padding: '6px 0 10px',
      }}>
        {pips.map((p) => (
          <div key={p.n} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: pipBg(p.kind), border: `1.5px solid ${pipBorder(p.kind)}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 900, color: pipFg(p.kind),
              fontFamily: 'DM Mono, monospace',
            }}>{p.kind === 'p1' ? '1' : p.kind === 'p2' ? '2' : p.kind === 'disputed' ? '!' : p.kind === 'awaiting' ? '?' : p.n}</div>
            <div style={{
              fontFamily: 'DM Mono, monospace', fontSize: 8, color: C.mute,
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>G{p.n}</div>
          </div>
        ))}
      </div>

      {/* Awaiting state */}
      {myReport?.status === 'awaiting_confirmation' && (
        <div style={{
          padding: 8, borderRadius: 8, background: C.amber + '15',
          color: C.amber, fontSize: 11, fontWeight: 700, marginBottom: 10, textAlign: 'center',
        }}>
          Game {nextGameNumber}: waiting on {myReportedNext ? 'opponent' : 'you'} to confirm.
        </div>
      )}
      {myReport?.status === 'disputed' && (
        <div style={{
          padding: 8, borderRadius: 8, background: C.red + '15',
          color: C.red, fontSize: 11, fontWeight: 700, marginBottom: 10, textAlign: 'center',
        }}>
          Game {nextGameNumber} disputed — opponent reported the other player. Mod will resolve.
        </div>
      )}

      {/* Per-game report CTAs — only for active players, while series in progress. */}
      {iAmPlayer && !seriesDone && match.status !== 'completed' && match.status !== 'cancelled' && (
        <div>
          <div style={{
            fontFamily: 'DM Mono, monospace', fontSize: 10, color: C.mute,
            textAlign: 'center', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em',
          }}>Report game {nextGameNumber}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => reportGame(currentUid)}
              disabled={busy || (myReport && myReport.firstReporter === currentUid)}
              style={{
                flex: 1, padding: 12, borderRadius: 10, border: 'none',
                background: `linear-gradient(135deg, ${C.gold}, ${C.goldLight})`,
                color: '#000', fontSize: 13, fontWeight: 900, cursor: 'pointer',
                opacity: busy ? 0.6 : 1,
              }}>
              I won game {nextGameNumber}
            </button>
            <button
              onClick={() => reportGame(opponentUid)}
              disabled={busy}
              style={{
                flex: 1, padding: 12, borderRadius: 10,
                border: `1px solid ${C.border}`, background: 'transparent',
                color: C.text, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                opacity: busy ? 0.6 : 1,
              }}>
              They won
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function pipBg(k) {
  return ({
    p1: '#F0A50022', p2: '#F0A50022',
    disputed: '#ef444422', awaiting: '#f59e0b22',
    next: '#B44FFF22', empty: 'transparent',
  })[k] || 'transparent';
}
function pipBorder(k) {
  return ({
    p1: '#F0A500', p2: '#F0A500',
    disputed: '#ef4444', awaiting: '#f59e0b',
    next: '#B44FFF', empty: 'rgba(255,255,255,0.15)',
  })[k] || 'rgba(255,255,255,0.15)';
}
function pipFg(k) {
  return ({
    p1: '#F0A500', p2: '#F0A500',
    disputed: '#ef4444', awaiting: '#f59e0b',
    next: '#B44FFF', empty: 'rgba(255,255,255,0.35)',
  })[k] || 'rgba(255,255,255,0.35)';
}
