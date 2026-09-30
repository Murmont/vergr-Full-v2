import { useState } from 'react';
import { IS_NATIVE_BUILD } from '../utils/platform';
import { useCachedImage, reportImageError } from '../utils/deviceMediaCache';
import Icon from './Icon';

// B9: a bundled, zero-network default avatar. The old fallback hit
// api.dicebear.com on EVERY missing/broken avatar (a remote fetch per empty
// list row). This inline data-URI renders instantly with no request — a dark
// disc with the brand-cyan person glyph, matching the avatar background.
const PLACEHOLDER_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%231A1A1A'/%3E%3Cpath d='M32 33c5 0 9-4 9-9s-4-9-9-9-9 4-9 9 4 9 9 9zm0 5c-7 0-18 3-18 10v3h36v-3c0-7-11-10-18-10z' fill='%23B44FFF' fill-opacity='0.35'/%3E%3C/svg%3E";

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
  // ⚠⚠ THE NEUTRAL LIFT RING IS NOT ALWAYS WANTED, AND UNTIL NOW THERE WAS NO
  // WAY OFF IT. `finalRing` always resolves to at least LIFT_RING, so an avatar
  // placed inside SOMEONE ELSE'S ring came out as two rings with a dark band
  // between them — a caller then "fixed" that by shrinking the portrait, which
  // is how the tip sheet ended up with a photo floating inside its own ring.
  // Pass false when the surrounding element is already drawing the ring. Live,
  // story and tier rings are SIGNALS and are deliberately unaffected.
  showLiftRing = true,
  className = '',
}) {
  // Normalize size to pixels. Callsites pass either a number (px) or a legacy
  // string token ('xs'|'sm'|'md'|'lg'|'xl'). A string was being written
  // straight into `width`/`height` (invalid CSS) so those avatars rendered at
  // inconsistent intrinsic sizes — map them to real px instead.
  const px = typeof size === 'number'
    ? size
    : ({ xs: 24, sm: 32, md: 40, lg: 56, xl: 72 }[size] ?? 40);

  // ⚠⚠ THE ONLY RING IS THE LIVE RING, AND IT ALWAYS COMES WITH ITS PILL.
  // Founder, 2026-09-14: "The only ring that should be visible is the live ring
  // with the pill", and yes to removing the orbit and the unseen-status ring too,
  // with live taking precedence over everything.
  //
  // Gone, all on purpose: the neutral "lift ring" every avatar used to get (the
  // grey ring measured on post avatars, the comment box and the bottom nav), the
  // unseen-status ring (`hasStory`), the opt-in rank ring (`showTierRing`), the
  // Immortal rainbow and the featured-creator frame. Their props are still
  // ACCEPTED so no caller breaks; they draw nothing. Do not bring a ring back for
  // anything but live.
  //
  // A PREMIUM live (paid entry) rings violet and reads PREMIUM rather than LIVE.
  // It is public and discoverable on purpose, so the ring is the first place a
  // viewer can be told it costs coins — telling them only at the paywall, after
  // they have tapped, is the version that feels like a trick.
  void vpLevel; void tier; void hasStory; void showTierRing; void championFrame; void championUntilMs; void showLiftRing;
  const livePremium = !!isLive && !!isPremiumLive;
  const finalRing = isLive ? (livePremium ? '#B44FFF' : '#F04060') : null;

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

  // rounded-full on the WRAPPER, not just the <img>.
  // Measured on the device 2026-09-12: the Shorts rail passes
  // className="border-2 border-white" and got a white SQUARE around a circular
  // avatar, because the border lands on this wrapper while the radius only ever
  // lived on the <img> below. The wrapper has no background, so rounding it is
  // invisible everywhere else and makes any border, ring or shadow a caller
  // passes follow the avatar's real shape.
  return (
    <div
      className={`relative inline-flex shrink-0 rounded-full ${className}`}
      style={{ width: px, height: px }}
    >
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

      {isVerified && !isLive && (
        <div
          className="absolute -bottom-0.5 -right-0.5 z-20 w-4 h-4 rounded-full bg-brand-violet flex items-center justify-center border-2 border-bg-dark"
        >
          <Icon name="check" size={10} className="text-bg-dark font-bold" />
        </div>
      )}

      {/* ⚠⚠ THE PER-INSTANCE <style> IS GONE, AND IT WAS THREE BUGS AT ONCE.
          `animate-spin-slow` is ALREADY a Tailwind utility (tailwind.config.js:101,
          `spin 3s linear infinite`), so this block only ever redefined it — later in
          the cascade, so it also overrode the real one.

          1. It shipped ONE COPY PER AVATAR. Measured on the live preview: 53 inline
             <style> tags on a single page, each 258 characters of identical CSS.
          2. It POISONED ACCESSIBLE NAMES. A button wrapping an avatar with no
             aria-label takes its name from text content, and the CSS is text content —
             so a screen reader announced the gift-sub buttons as
             "@keyframes spin-slow from transform rotate 0deg...". Found by measuring
             those buttons, not by reading this file.
          3. It is the same trap CLAUDE.md already records for innerText: anything
             reading textContent off a container holding an avatar picked up CSS.

          Nothing replaces it — the Tailwind utility was always doing the work. */}
    </div>
  );
}
