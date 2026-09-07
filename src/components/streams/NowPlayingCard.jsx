// NowPlayingCard — small "now playing" pill under the stream header.
//
// Data source: streams/{id}.nowPlaying = { title, artist, art, source,
//   externalUrl, ts } — populated by functions/spotifyNowPlaying.js cron
// when the host has connected their Spotify account (see functions/spotifyAuth.js).
//
// Note on legality: this card DISPLAYS the song the host is playing on
// their own device — it does NOT broadcast the audio. The host is
// responsible for the music license of whatever's actually in their
// stream. Twitch's DMCA disaster taught us not to encourage broadcast of
// copyrighted music. We surface the title only.

import { motion, AnimatePresence } from 'framer-motion';
import { spring } from '../primitives/springs';
import Icon from '../Icon';

// ⚠ SOLID, AND NO HAIRLINE. This card floats over live gameplay, where a 0.75 fill
// picks up whatever frame is behind it, and its border was a white stroke BRIGHTER
// than that fill — the stroke separating the card instead of a real value step.
// Found only by FIRING the now-playing event and measuring while it was up: every
// earlier sweep ran after it had already timed out.
const C = {
  bg: '#12121E',
  border: 'transparent',
  text: '#fff',
  textDim: 'rgba(255,255,255,0.65)',
  spotify: '#1DB954',
  apple: '#FA243C',
  yt: '#FF0033',
  audius: '#CC0FE0',
};

// ⚠⚠ THIS TABLE CRASHED BOTH LIVE VIEWERS. `SOURCE_META[x] || 'other'` catches a
// MISSING source but NOT an UNKNOWN one: the fallback is inside the KEY, so an
// unrecognised key still returns undefined and `.color` throws. `audius.js:73`
// writes exactly that — `source: 'audius'` — and profile music is the shipped
// feature that produces it, so any stream whose host had an Audius track playing
// took `MobileLiveViewer` and `ViewerStreamScreen` to the ErrorBoundary.
//
// Two fixes, and BOTH are needed: audius belongs in the table because it is a real
// source, and `metaFor()` below makes an unknown one degrade instead of throwing —
// the next source someone adds will not be in here either.
const SOURCE_META = {
  spotify: { color: C.spotify, icon: 'music_note', label: 'Spotify' },
  apple:   { color: C.apple,   icon: 'music_note', label: 'Apple Music' },
  youtube: { color: C.yt,      icon: 'music_note', label: 'YouTube Music' },
  audius:  { color: C.audius, icon: 'music_note', label: 'Audius' },
  other:   { color: '#7c3aed', icon: 'music_note', label: 'Music' },
};

/**
 * ⚠ THE FALLBACK GOES ON THE LOOKUP, NOT ON THE KEY. `SOURCE_META[x || 'other']`
 * reads as safe and is not; `SOURCE_META[x] || SOURCE_META.other` is.
 */
const metaFor = (source) => SOURCE_META[source] || SOURCE_META.other;

export default function NowPlayingCard({ nowPlaying, compact = false }) {
  return (
    <AnimatePresence>
      {nowPlaying?.title && (
        <motion.div
          layout
          initial={{ opacity: 0, y: -6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4 }}
          transition={spring.gentle}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: compact ? '4px 10px 4px 4px' : '6px 12px 6px 6px',
            borderRadius: 99,
            background: C.bg,
            border: 'none',
            backdropFilter: 'blur(8px)',
            color: C.text,
            maxWidth: compact ? 220 : 320,
          }}
        >
          {nowPlaying.art ? (
            <img
              src={nowPlaying.art}
              alt=""
              width={compact ? 22 : 28}
              height={compact ? 22 : 28}
              style={{ borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }}
            />
          ) : (
            <span style={{
              width: compact ? 22 : 28, height: compact ? 22 : 28, borderRadius: '50%',
              background: metaFor(nowPlaying.source).color,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Icon name="music_note" size={compact ? 13 : 16} className=""/>
            </span>
          )}
          <div style={{ minWidth: 0, lineHeight: 1.25 }}>
            <div style={{
              fontSize: compact ? 11 : 12, fontWeight: 800,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{nowPlaying.title}</div>
            <div style={{
              fontSize: compact ? 9.5 : 10.5, color: C.textDim,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{nowPlaying.artist || ''}</div>
          </div>
          {/* Wave animation = clean signal that this is "live" — animates with
              CSS keyframes that respect reduced-motion globally. */}
          <NowPlayingPulse color={metaFor(nowPlaying.source).color} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function NowPlayingPulse({ color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 12, marginLeft: 2 }}>
      {[0.6, 0.9, 0.5, 1, 0.7].map((delay, i) => (
        <span
          key={i}
          style={{
            width: 2, height: 4 + i * 1.6,
            background: color, borderRadius: 1,
            animation: `vergr-np-pulse 0.9s ${delay}s infinite ease-in-out`,
          }}
        />
      ))}
      <style>{`
        @keyframes vergr-np-pulse {
          0%, 100% { transform: scaleY(0.4); }
          50%      { transform: scaleY(1.4); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes vergr-np-pulse { 0%, 100% { transform: scaleY(1); } }
        }
      `}</style>
    </div>
  );
}
