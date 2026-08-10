// src/components/tournaments/StandingsTable.jsx
// Round Robin + Swiss standings.
import Icon from '../Icon';

export function RoundRobinStandings({ standings = [], teamLookup = {} }) {
  if (!standings.length) {
    return <Empty label="Standings will appear after matches are played" />;
  }
  return (
    <div className="rounded-xl border border-white/[0.06] bg-surface-1 overflow-hidden">
      <div className="grid grid-cols-[32px_1fr_32px_32px_32px_48px_48px] gap-2 px-3 py-2 border-b border-white/[0.06] bg-surface-2/50">
        <Header>#</Header>
        <Header>Squad</Header>
        <Header>W</Header>
        <Header>D</Header>
        <Header>L</Header>
        <Header>Pts</Header>
        <Header>Diff</Header>
      </div>
      {standings.map((row, i) => {
        const team = teamLookup[row.teamId] || { name: row.teamId };
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
        return (
          <div key={row.teamId} className="grid grid-cols-[32px_1fr_32px_32px_32px_48px_48px] gap-2 px-3 py-2.5 border-b border-white/[0.04] last:border-0 items-center">
            <span className="text-text-muted text-xs font-bold">{medal || i + 1}</span>
            <span className="text-text-primary text-sm font-bold truncate">{team.name}</span>
            <Cell>{row.w}</Cell>
            <Cell>{row.d}</Cell>
            <Cell>{row.l}</Cell>
            <Cell className="text-brand-violet-light font-bold">{row.pts}</Cell>
            <Cell className={row.diff >= 0 ? 'text-brand-violet-light' : 'text-brand-ember'}>
              {row.diff > 0 ? `+${row.diff}` : row.diff}
            </Cell>
          </div>
        );
      })}
    </div>
  );
}

export function SwissStandings({ standings = [] }) {
  if (!standings.length) return <Empty label="Swiss standings will appear after round 1" />;
  return (
    <div className="rounded-xl border border-white/[0.06] bg-surface-1 overflow-hidden">
      <div className="grid grid-cols-[32px_1fr_32px_32px_56px] gap-2 px-3 py-2 border-b border-white/[0.06] bg-surface-2/50">
        <Header>#</Header>
        <Header>Player</Header>
        <Header>W</Header>
        <Header>L</Header>
        <Header>Buch.</Header>
      </div>
      {standings.map((row, i) => (
        <div key={row.playerId} className="grid grid-cols-[32px_1fr_32px_32px_56px] gap-2 px-3 py-2.5 border-b border-white/[0.04] last:border-0 items-center">
          <span className="text-text-muted text-xs font-bold">{i + 1}</span>
          <span className="text-text-primary text-sm font-bold truncate">{row.name || row.playerId}</span>
          <Cell className="text-brand-violet-light font-bold">{row.wins}</Cell>
          <Cell>{row.losses}</Cell>
          <Cell className="text-text-secondary">{row.buchholz}</Cell>
        </div>
      ))}
    </div>
  );
}

function Header({ children }) {
  return <span className="text-text-muted text-[9px] uppercase tracking-widest font-bold">{children}</span>;
}
function Cell({ children, className = '' }) {
  return <span className={`text-text-primary text-xs font-dmmono ${className}`}>{children}</span>;
}
function Empty({ label }) {
  return (
    <div className="p-8 rounded-xl bg-surface-1 border border-dashed border-white/[0.06] text-center">
      <Icon name="leaderboard" size={32} className="text-text-muted mx-auto mb-2" />
      <p className="text-text-muted text-sm">{label}</p>
    </div>
  );
}
