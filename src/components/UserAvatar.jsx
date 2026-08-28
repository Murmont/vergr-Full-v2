import { useState } from 'react';
import { getTier } from '../utils/helpers';
import { RANK_TIERS } from '../utils/vpSystem';
import { IS_NATIVE_BUILD } from '../utils/platform';
import { useCachedImage, reportImageError } from '../utils/deviceMediaCache';
import Icon from './Icon';

// B9: a bundled, zero-network default avatar. The old fallback hit
// api.dicebear.com on EVERY missing/broken avatar (a remote fetch per empty
// list row). This inline data-URI renders instantly with no request — a dark
// disc with the brand-cyan person glyph, matching the avatar background.
const PLACEHOLDER_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%231A1A1A'/%3E%3Cpath d='M32 33c5 0 9-4 9-9s-4-9-9-9-9 4-9 9 4 9 9 9zm0 5c-7 0-18 3-18 10v3h36v-3c0-7-11-10-18-10z' fill='%23B44FFF' fill-opacity='0.35'/%3E%3C/svg%3E";

// Legacy ring colors (coinsSpent-based getTier). Kept so old callers passing
// a tier name string still render their old ring.
const LEGACY_TIER_RING_COLORS = {
  Bronze: '#CD7F32',
  Silver: '#C0C0C0',
  Gold: '#F5C542',
  Platinum: '#B44FFF',
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
  src: srcProp,
  size = 40,
  // `vpLevel` is the new way to drive the ring. If absent we fall back to
  // the legacy `tier` prop (coinsSpent number OR tier-name string).
  vpLevel,
  tier,
  isVerified,
  isLive,
  // The live stream is a PREMIUM one (paid entry). Only meaningful with isLive.
  isPremiumLive = false,
  // A coloured ring is a SIGNAL, not decoration. Only two things earn one:
  // the user is live, or they have an unseen active status. Everything else
  // gets the neutral lift ring below, so a list of avatars reads as calm.
  hasStory = false,
  // VP/tier rank rings still exist but are now OPT-IN — painting one on every
  // avatar in every list made the whole app look permanently "on fire".
  showTierRing = false,
  // GR4 — recent tournament champions get a gold animated frame + crown for 7
  // days. Pass `championFrame` (bool) OR `championUntilMs` (ms epoch) where the
  // user doc is available; an expiry in the past renders nothing.
  championFrame = false,
  championUntilMs = null,
  className = '',
}) {
  // Normalize size to pixels. Callsites pass either a number (px) or a legacy
  // string token ('xs'|'sm'|'md'|'lg'|'xl'). A string was being written
  // straight into `width`/`height` (invalid CSS) so those avatars rendered at
  // inconsistent intrinsic sizes — map them to real px instead.
  const px = typeof size === 'number'
    ? size
    : ({ xs: 24, sm: 32, md: 40, lg: 56, xl: 72 }[size] ?? 40);

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

  // Live overrides everything else — red ring + LIVE chip below. An unseen
  // status ring comes next. Failing both, every avatar gets the same neutral
  // hairline: a couple of tones lighter than the surface it sits on, which
  // lifts the circle off the background without claiming anything about it.
  //
  // A PREMIUM live (paid entry) rings violet and reads PREMIUM rather than LIVE.
  // It is public and discoverable on purpose, so the ring is the first place a
  // viewer can be told it costs coins — telling them only at the paywall, after
  // they have tapped, is the version that feels like a trick.
  const showLiveRing = !!isLive;
  const livePremium = !!isLive && !!isPremiumLive;
  const LIFT_RING = 'rgba(255,255,255,0.10)';
  const finalRing = showLiveRing
    ? (livePremium ? '#B44FFF' : '#F04060')
    : (hasStory ? '#B44FFF' : (ringColor || LIFT_RING));

  // Resolve through the on-device media cache: the first sighting shows the
  // remote url + persists the bytes on the phone (hidden app dir); every later
  // view — including after an app restart — renders instantly from a local
  // object URL with zero network. Telegram-style. Falls back to the raw src if
  // caching is unavailable (no regression).
  // `permanent` — an avatar is ~20KB and its absence is the most visible thing
  // in the app, so it goes in storage Android will not reclaim.
  // A caller that forgets to destructure uploadToR2's { url, key } hands us an
  // OBJECT here, which React stringifies to src="[object Object]": a broken
  // image plus a pointless request to a garbage path. Anything that is not a
  // non-empty string is treated as no avatar, so it renders the placeholder.
  const src = typeof srcProp === 'string' && srcProp ? srcProp : null;

  const displaySrc = useCachedImage(src, { permanent: true });

  // Fade the real image in over the dark placeholder disc so a slow avatar
  // fetch shows a branded disc (not a white/empty pop). `loaded` also lets us
  // treat a cache HIT as instant (onLoad fires synchronously → no visible fade).
  const [loaded, setLoaded] = useState(false);

  const handleImageError = (e) => {
    // A local file can disappear underneath us: Android is allowed to clear the
    // reclaimable cache tier whenever storage runs low, and it does not tell us.
    // So a failure on a local source is not a broken avatar, it is a stale
    // manifest entry — forget it and retry over the network once before giving
    // up and showing the placeholder.
    if (src && e.target.src !== src && e.target.src !== PLACEHOLDER_AVATAR) {
      reportImageError(src);
      e.target.src = src;
      return;
    }
    setLoaded(true);
    if (e.target.src !== PLACEHOLDER_AVATAR) e.target.src = PLACEHOLDER_AVATAR;
  };

  return (
    <div
      className={`relative inline-flex shrink-0 ${className}`}
      style={{ width: px, height: px }}
    >
      {/* Featured creator: gold animated ring + crown badge. This started life
          as a tournament-champion frame; tournaments are retired and the flag
          is now a featured-creator marker, matching PublicProfileScreen. */}
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
        // If the image is already cached, it can finish before onLoad binds —
        // detect `complete` on attach so it isn't stuck at opacity 0.
        ref={(el) => { if (el && el.complete && el.naturalWidth > 0) setLoaded(true); }}
        src={displaySrc || PLACEHOLDER_AVATAR}
        alt="Avatar"
        onError={handleImageError}
        onLoad={() => setLoaded(true)}
        // Native (Android WebView) reports a false ~980px viewport, which makes
        // native lazy-loading misjudge on-screen avatars as far off-screen and
        // defer them for seconds. Load eagerly + high priority on native so
        // visible avatars fetch immediately; web/PWA keeps lazy for long lists.
        loading={IS_NATIVE_BUILD ? 'eager' : 'lazy'}
        fetchpriority={IS_NATIVE_BUILD ? 'high' : 'auto'}
        decoding="async"
        className="rounded-full object-cover relative z-10"
        style={{
          width: px,
          height: px,
          backgroundColor: '#1A1A1A',
          opacity: loaded ? 1 : 0.01,
          transition: 'opacity 220ms ease-out',
          // Use inline style so any ring color (including hex from VP ranks)
          // works without needing a Tailwind class.
          boxShadow: finalRing ? `0 0 0 2px ${finalRing}` : 'none',
        }}
      />

      {isLive && (
        <div
          className="absolute -bottom-1 left-1/2 -translate-x-1/2 z-20 px-1.5 py-0.5 rounded text-[8px] font-bold text-white uppercase tracking-wider"
          style={{
            whiteSpace: 'nowrap',
            background: livePremium
              ? 'linear-gradient(135deg, #C87FFF 0%, #7B1FFF 100%)'
              : '#F04060',
          }}
        >
          {livePremium ? 'PREMIUM' : 'LIVE'}
        </div>
      )}

      {championActive && !isLive && (
        <div
          className="absolute -top-1.5 left-1/2 -translate-x-1/2 z-20"
          style={{ fontSize: Math.max(10, px * 0.3), lineHeight: 1 }}
          title="Featured creator"
        >
          <Icon name="workspace_premium" size={Math.max(12, px * 0.32)} className="text-brand-gold-light" />
        </div>
      )}

      {isVerified && !isLive && (
        <div
          className="absolute -bottom-0.5 -right-0.5 z-20 w-4 h-4 rounded-full bg-brand-violet flex items-center justify-center border-2 border-bg-dark"
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
