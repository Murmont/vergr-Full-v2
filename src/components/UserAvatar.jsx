import { getTier } from '../utils/helpers';
import { RANK_TIERS } from '../utils/vpSystem';
import Icon from './Icon';

// Legacy ring colors (coinsSpent-based getTier). Kept so old callers passing
// a tier name string still render their old ring.
const LEGACY_TIER_RING_COLORS = {
  Bronze: '#CD7F32',
  Silver: '#C0C0C0',
  Gold: '#F5C542',
  Platinum: '#4DFFD4',
  'Diamond Apex Elite': null, // animated rainbow ring below
};

// Map a VP level (1-100) → ring color from RANK_TIERS. Returns null if the
// user has no earned ring (Rookie = L1-10 in our system; the source of
// truth flags this with ring:null).
function ringForVpLevel(level) {
  if (!level || level < 1) return { color: null, name: 'Rookie' };
  const t = RANK_TIERS.find(r => level >= r.min && level <= r.max) || RANK_TIERS[0];
  return {
    color: t.ring ? t.ringColor : null, // ring:null in Rookie → no ring rendered
    name: t.name,
    isImmortal: t.name === 'Immortal',
  };
}

export default function UserAvatar({
  src,
  size = 40,
  // `vpLevel` is the new way to drive the ring. If absent we fall back to
  // the legacy `tier` prop (coinsSpent number OR tier-name string).
  vpLevel,
  tier,
  isVerified,
  isLive,
  showTierRing = true,
  // GR4 — recent tournament champions get a gold animated frame + crown for 7
  // days. Pass `championFrame` (bool) OR `championUntilMs` (ms epoch) where the
  // user doc is available; an expiry in the past renders nothing.
  championFrame = false,
  championUntilMs = null,
  className = '',
}) {
  const championActive = championFrame || (championUntilMs != null && championUntilMs > Date.now());
  // Pick ring color.
  let ringColor = null;
  let isImmortal = false;
  if (showTierRing) {
    if (vpLevel != null) {
      const r = ringForVpLevel(vpLevel);
      ringColor = r.color;
      isImmortal = r.isImmortal;
    } else if (tier != null) {
      if (typeof tier === 'string') {
        // Legacy named tiers
        ringColor = LEGACY_TIER_RING_COLORS[tier] || null;
        isImmortal = tier === 'Diamond Apex Elite';
      } else {
        // tier as coinsSpent number — preserve legacy getTier behavior.
        const tierData = getTier(tier);
        ringColor = LEGACY_TIER_RING_COLORS[tierData?.name] || null;
        isImmortal = tierData?.name === 'Diamond Apex Elite';
      }
    }
  }

  // Live overrides everything else — red ring + LIVE chip below.
  const showLiveRing = !!isLive;
  const finalRing = showLiveRing ? '#F04060' : ringColor;

  const handleImageError = (e) => {
    e.target.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=default`;
  };

  return (
    <div
      className={`relative inline-flex shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {/* GR4 champion: gold animated ring + crown badge */}
      {championActive && !showLiveRing && (
        <div
          className="absolute -inset-[3px] rounded-full animate-spin-slow bg-gradient-to-tr from-[#F0A500] via-[#F5C842] to-[#F0A500] opacity-90 blur-[1px]"
        />
      )}

      {/* Immortal: animated rainbow ring */}
      {isImmortal && !showLiveRing && (
        <div
          className="absolute -inset-[3px] rounded-full animate-spin-slow bg-gradient-to-tr from-[#00f2ff] via-[#0062ff] to-[#7000ff] opacity-75 blur-[1px]"
        />
      )}

      <img
        src={src || `https://api.dicebear.com/7.x/avataaars/svg?seed=default`}
        alt="Avatar"
        onError={handleImageError}
        className="rounded-full object-cover relative z-10"
        style={{
          width: size,
          height: size,
          backgroundColor: '#1A1A1A',
          // Use inline style so any ring color (including hex from VP ranks)
          // works without needing a Tailwind class.
          boxShadow: finalRing ? `0 0 0 2px ${finalRing}` : 'none',
        }}
      />

      {isLive && (
        <div
          className="absolute -bottom-1 left-1/2 -translate-x-1/2 z-20 bg-brand-ember px-1.5 py-0.5 rounded text-[8px] font-bold text-white uppercase tracking-wider"
          style={{ whiteSpace: 'nowrap' }}
        >
          LIVE
        </div>
      )}

      {championActive && !isLive && (
        <div
          className="absolute -top-1.5 left-1/2 -translate-x-1/2 z-20"
          style={{ fontSize: Math.max(10, size * 0.3), lineHeight: 1 }}
          title="Recent tournament champion"
        >
          <Icon name="workspace_premium" size={Math.max(12, size * 0.32)} className="text-brand-gold-light" />
        </div>
      )}

      {isVerified && !isLive && (
        <div
          className="absolute -bottom-0.5 -right-0.5 z-20 w-4 h-4 rounded-full bg-brand-cyan flex items-center justify-center border-2 border-bg-dark"
        >
          <Icon name="check" size={10} className="text-bg-dark font-bold" />
        </div>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes spin-slow {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }
            .animate-spin-slow {
              animation: spin-slow 3s linear infinite;
            }
          `,
        }}
      />
    </div>
  );
}
