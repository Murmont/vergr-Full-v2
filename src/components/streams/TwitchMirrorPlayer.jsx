// Twitch stream mirror — embeds a user's Twitch channel via the official
// <iframe> player. Approved per Twitch DSA; constraints enforced here:
//   - parent param matches the deployed domain (required by Twitch)
//   - container ≥ 400×300, never obscured by overlays
//   - HTTPS only (Twitch refuses to load on http)
//   - No charging users to access Twitch content (we don't)
//   - No compensation from streamers in exchange for the embed (we don't)
//
// We don't gate this on "live now" — Twitch's player itself shows
// "Channel offline" art when the streamer isn't broadcasting, which is fine
// for a profile mirror. If you want to hide the player when offline, add a
// Helix `streams?user_id=X` poll via a Cloud Function (uses TWITCH_CLIENT_ID/
// SECRET app-token; out of scope for the mirror itself).
import { useMemo } from 'react';

const HOSTING_DOMAIN  = 'vergr-44494.web.app';
const FALLBACK_DOMAIN = 'vergr-44494.firebaseapp.com';

export default function TwitchMirrorPlayer({ username, height = 360, autoplay = false, muted = true, fill = false }) {
  // Twitch requires the embedding page's hostname as `parent`. Local dev needs
  // localhost. Multiple parents are allowed (one per param).
  const parents = useMemo(() => {
    const list = [HOSTING_DOMAIN, FALLBACK_DOMAIN];
    if (typeof window !== 'undefined') {
      const h = window.location.hostname;
      if (h && !list.includes(h)) list.push(h);
    }
    return list;
  }, []);

  if (!username) return null;
  const safe = String(username).replace(/[^a-zA-Z0-9_]/g, '');
  if (!safe) return null;

  const params = new URLSearchParams({
    channel: safe,
    autoplay: String(!!autoplay),
    muted: String(!!muted),
  });
  parents.forEach(p => params.append('parent', p));

  // fill = render as the main player inside an existing container (no border,
  // no aspect box, fills 100%). Default = standalone card (profile embed).
  const wrapStyle = fill
    ? { width: '100%', height: '100%', background: '#000' }
    : { aspectRatio: '16 / 9', minHeight: 300, minWidth: 400, width: '100%' };
  const wrapClass = fill ? 'bg-black' : 'rounded-2xl overflow-hidden border border-white/[0.08] bg-black';
  return (
    <div className={wrapClass} style={wrapStyle}>
      <iframe
        title={`Twitch — ${safe}`}
        src={`https://player.twitch.tv/?${params.toString()}`}
        height={height}
        width="100%"
        allowFullScreen
        scrolling="no"
        frameBorder="0"
        style={{ display: 'block', border: 0, width: '100%', height: '100%' }}
      />
    </div>
  );
}
