// TrustBadge — public reputation badge for a tournament player.
// Hidden until verifiedMatches >= 5 (server-side filter).
//
// Score 0-1000:
//   850+  → 'Trusted'    (cyan)
//   650+  → 'Reliable'   (green)
//   400+  → 'Average'    (amber)
//   <400  → 'Watch'      (red)
//
// Tooltip on hover shows verifiedMatches / disputes / autoFlags breakdown.

import { useEffect, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';

const C = {
  cyan: '#B44FFF', green: '#22c55e', amber: '#f59e0b', red: '#ef4444',
  surface: '#14141F', border: 'rgba(255,255,255,0.10)', dim: 'rgba(255,255,255,0.65)',
};

export default function TrustBadge({ uid, size = 'md', showLabel = true }) {
  const [trust, setTrust] = useState(null);
  useEffect(() => {
    if (!uid) return;
    const fns = getFunctions(undefined, 'europe-west1');
    httpsCallable(fns, 'getTournamentTrust')({ uid })
      .then(({ data }) => setTrust(data))
      .catch(() => setTrust(null));
  }, [uid]);

  if (!trust || !trust.visible) return null;
  const tier = scoreTier(trust.score);
  const dim = size === 'sm' ? { f: 9, p: '2px 6px' }
            : size === 'lg' ? { f: 12, p: '6px 12px' }
            : { f: 10, p: '4px 8px' };

  return (
    <div
      title={`${trust.verifiedMatches} verified · ${trust.disputes} disputes · ${trust.autoFlags} flags`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: dim.p, borderRadius: 6,
        background: `${tier.color}22`, border: `1px solid ${tier.color}66`,
        color: tier.color, fontSize: dim.f, fontWeight: 800,
        fontFamily: 'DM Mono, monospace', textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}
    >
      <span>{trust.score}</span>
      {showLabel && <span>· {tier.label}</span>}
    </div>
  );
}

function scoreTier(score) {
  if (score >= 850) return { label: 'Trusted', color: C.cyan };
  if (score >= 650) return { label: 'Reliable', color: C.green };
  if (score >= 400) return { label: 'Average', color: C.amber };
  return { label: 'Watch', color: C.red };
}
