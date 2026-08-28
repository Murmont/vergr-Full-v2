// src/components/tournaments/BRScoreboard.jsx
// Battle Royale placement scoreboard showing per-game placements + totals.
import Icon from '../Icon';
import { BR_PLACEMENT_POINTS, pointsForPlacement } from '../../utils/tournamentTypes';

export default function BRScoreboard({ standings = [], gameCount = 3, playerLookup = {} }) {
  if (!standings.length) {
    return (
      <div className="p-8 rounded-xl bg-surface-1 border border-dashed border-white/[0.06] text-center">
        <Icon name="local_fire_department" size={32} className="text-text-muted mx-auto mb-2" />
        <p className="text-text-muted text-sm">Scores will update as games finish</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/[0.06] bg-surface-1 overflow-hidden">
        <div className="grid gap-2 px-3 py-2 border-b border-white/[0.06] bg-surface-2/50"
          style={{ gridTemplateColumns: `32px 1fr ${'40px '.repeat(gameCount)}56px` }}>
          <Header>#</Header>
          <Header>Player</Header>
          {Array.from({ length: gameCount }).map((_, i) => (
            <Header key={i}>G{i + 1}</Header>
          ))}
          <Header>Total</Header>
        </div>
        {standings.map((row, i) => {
          const player = playerLookup[row.playerId] || { name: row.playerId };
          const games = row.games || [];
          return (
            <div key={row.playerId}
              className="grid gap-2 px-3 py-2.5 border-b border-white/[0.04] last:border-0 items-center"
              style={{ gridTemplateColumns: `32px 1fr ${'40px '.repeat(gameCount)}56px` }}>
              <span className="text-text-muted text-xs font-bold">{i + 1}</span>
              <span className="text-text-primary text-sm font-bold truncate">{player.name || player.displayName}</span>
              {Array.from({ length: gameCount }).map((_, gi) => {
                const g = games[gi];
                return (
                  <span key={gi} className="text-text-secondary text-xs font-dmmono">
                    {g ? `${ord(g.place)}` : '—'}
                  </span>
                );
              })}
              <span className="text-brand-ember text-sm font-dmmono font-bold">{row.total}</span>
            </div>
          );
        })}
      </div>

      <div className="p-3 rounded-xl bg-surface-1 border border-white/[0.06]">
        <p className="text-text-muted text-[10px] uppercase tracking-widest font-bold mb-2">Scoring</p>
        <div className="flex flex-wrap gap-1.5">
          {BR_PLACEMENT_POINTS.map((pts, i) => (
            <div key={i} className="px-2 py-1 rounded-md bg-surface-2 text-[10px] text-text-secondary font-dmmono">
              {ord(i + 1)} = <span className="text-brand-ember font-bold">{pts}</span>
            </div>
          ))}
          <div className="px-2 py-1 rounded-md bg-surface-2 text-[10px] text-text-muted font-dmmono">11th+ = 0</div>
        </div>
      </div>
    </div>
  );
}

// Column heading cell. Was referenced four times above and never defined, so
// this component threw on render for its entire life (found by eslint
// react/jsx-no-undef, 2026-08-27 - the bundler compiles an unresolved JSX name
// without complaint).
function Header({ children }) {
  return (
    <span className="text-text-muted text-[10px] uppercase tracking-widest font-bold truncate">{children}</span>
  );
}

function ord(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export { pointsForPlacement };
