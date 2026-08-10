import { useState, useEffect } from 'react';
import Icon from '../Icon';
import BadgeGem from './BadgeGem';
import SubscribeSheet from './SubscribeSheet';
import { getMembershipTiers, getMyMembershipFor } from '../../firebase/firestore';
import { useAuth } from '../../context/AuthContext';

// The "Membership" section shown on a creator's profile (B1). Renders only when the
// creator has at least one published tier. Shows the cheapest price + a join CTA;
// opening it pops the SubscribeSheet. If the viewer is already a member, shows their gem.
export default function MembershipBlock({ creatorId, creatorName = 'this creator' }) {
  const { currentUser } = useAuth();
  const [tiers, setTiers] = useState([]);
  const [mine, setMine] = useState(null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!creatorId) return;
    let alive = true;
    (async () => {
      const [{ tiers: t }, m] = await Promise.all([
        getMembershipTiers(creatorId),
        currentUser?.uid ? getMyMembershipFor(creatorId, currentUser.uid) : Promise.resolve(null),
      ]);
      if (!alive) return;
      setTiers(t); setMine(m); setLoaded(true);
    })();
    return () => { alive = false; };
  }, [creatorId, currentUser]);

  if (!loaded || tiers.length === 0 || currentUser?.uid === creatorId) return null;
  const cheapest = Math.min(...tiers.map((t) => t.priceCoins || 0));
  const mineTier = mine && tiers.find((t) => t.id === mine.tierId);

  return (
    <>
      <div className="rounded-2xl p-4 bg-gradient-to-br from-brand-violet/12 to-brand-pink/5 border border-brand-violet/25 flex items-center gap-4">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-violet to-brand-pink flex items-center justify-center shrink-0">
          <Icon name="workspace_premium" filled size={22} className="text-white" />
        </div>
        {mine ? (
          <>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white">You're a {mine.tierName} member 💜</div>
              <div className="text-xs text-text-secondary mt-0.5">Supporting {creatorName}</div>
            </div>
            {mineTier && <BadgeGem color={mineTier.badge?.color} icon={mineTier.badge?.icon} size={36} />}
          </>
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white">Support {creatorName}</div>
              <div className="text-xs text-text-secondary mt-0.5">Monthly perks from <span className="text-brand-gold font-dmmono">● {cheapest.toLocaleString()}</span>/mo</div>
            </div>
            <button onClick={() => setOpen(true)} className="px-4 py-2 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white font-semibold text-sm shrink-0 hover:brightness-110 transition">Join</button>
          </>
        )}
      </div>
      {open && <SubscribeSheet creatorId={creatorId} creatorName={creatorName} onClose={() => setOpen(false)} onSubscribed={(t) => setMine({ tierId: t.id, tierName: t.name })} />}
    </>
  );
}
