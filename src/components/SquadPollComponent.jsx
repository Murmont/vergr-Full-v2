// SquadPollComponent — inline poll card used inside squad chat messages.
// Rebuilt on the .sqd visual language: full-width inside the message body,
// brand-cyan accents, results bars when voted.
import { useState } from 'react';

export default function SquadPollComponent({ pollData, onVote }) {
  const [selected, setSelected] = useState(null);
  const [hasVoted, setHasVoted] = useState(false);

  const options = pollData?.options || [];
  const votes = pollData?.votes || {};
  const totalVotes = pollData?.totalVotes
    || Object.values(votes).reduce((a, v) => a + (typeof v === 'number' ? v : 0), 0)
    || 0;

  const handleSubmit = () => {
    if (selected === null) return;
    setHasVoted(true);
    onVote?.(selected);
  };

  return (
    <div style={{
      maxWidth: 420,
      width: '100%',
      marginTop: 6,
      padding: 16,
      background: 'rgba(255,255,255,.025)',
      border: '1px solid rgba(255,255,255,.08)',
      borderRadius: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span className="material-symbols-outlined" style={{ color: 'var(--cyan)', fontSize: 18 }}>poll</span>
        <div style={{ fontFamily: 'Syne', fontWeight: 700, color: '#fff', fontSize: 13.5, lineHeight: 1.3 }}>
          {pollData?.question || pollData?.title || 'Poll'}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map((option, i) => {
          const count = typeof votes[i] === 'number' ? votes[i] : 0;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const isSelected = selected === i;
          const showResults = hasVoted;
          return (
            <button
              key={i}
              onClick={() => !hasVoted && setSelected(i)}
              disabled={hasVoted}
              style={{
                position: 'relative',
                textAlign: 'left',
                padding: '10px 14px',
                borderRadius: 10,
                fontFamily: 'inherit',
                fontSize: 13.5,
                color: isSelected ? 'var(--cyan)' : '#fff',
                background: isSelected ? 'rgba(180,79,255,.10)' : 'rgba(255,255,255,.03)',
                border: `1px solid ${isSelected ? 'rgba(180,79,255,.35)' : 'rgba(255,255,255,.06)'}`,
                cursor: hasVoted ? 'default' : 'pointer',
                overflow: 'hidden',
              }}
            >
              {showResults && (
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, rgba(180,79,255,.18), rgba(180,79,255,.06))',
                  pointerEvents: 'none',
                }} />
              )}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span>{option}</span>
                {showResults && (
                  <span style={{ fontFamily: 'DM Mono', fontSize: 11, color: 'var(--t2)', fontWeight: 700 }}>
                    {pct}% · {count}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {!hasVoted ? (
        <button
          onClick={handleSubmit}
          disabled={selected === null}
          className="btn primary"
          style={{ width: '100%', marginTop: 12, justifyContent: 'center' }}
        >
          Cast Vote
        </button>
      ) : (
        <div style={{ marginTop: 10, textAlign: 'center', fontFamily: 'DM Mono', fontSize: 11, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
          {totalVotes} vote{totalVotes === 1 ? '' : 's'} · your vote recorded
        </div>
      )}
    </div>
  );
}
