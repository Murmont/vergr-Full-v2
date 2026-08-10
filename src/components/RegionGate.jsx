// RegionGate — blocks access to wallet, tournament, and payout features
// in jurisdictions where the skill-based-gaming-for-cash model is
// prohibited or heavily restricted. See `src/utils/geoBlocks.js`.
//
// The server is the authoritative check (every wallet/tournament/payout
// callable rejects blocked regions via `assertRegionAllowed`). This
// component is the UX gate so the user sees a clear explanation instead
// of an opaque permission-denied error.

import { useEffect, useState } from 'react';
import { fetchRegionStatus, regionDisplayName } from '../utils/geoBlocks';
import Icon from './Icon';

export default function RegionGate({ children, feature = 'this feature' }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchRegionStatus().then(s => {
      if (!alive) return;
      setStatus(s);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-text-muted text-sm">
        Checking region…
      </div>
    );
  }

  if (status && status.blocked) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-6">
        <div className="max-w-md w-full rounded-2xl border border-white/[0.08] bg-surface-1 p-8 text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-brand-ember/15 text-brand-ember flex items-center justify-center">
            <Icon name="public_off" size={28} />
          </div>
          <h2 className="font-syne text-xl font-bold mb-2">Not available in {regionDisplayName(status)}</h2>
          <p className="text-text-muted text-sm leading-relaxed">
            VERGR's skill-based competitive gaming and virtual-currency features
            are not currently available in {regionDisplayName(status)} due to
            local regulations. You can still browse social content, but {feature}
            {' '}is restricted.
          </p>
          <p className="text-text-muted text-xs mt-4">
            If you believe this is an error, contact{' '}
            <a href="mailto:support@vergr.app" className="text-brand-violet-light">support@vergr.app</a>.
          </p>
        </div>
      </div>
    );
  }

  return children;
}
