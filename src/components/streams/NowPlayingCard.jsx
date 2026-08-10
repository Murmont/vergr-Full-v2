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

const C = {
  bg: 'rgba(18, 18, 30, 0.75)',
  border: 'rgba(255,255,255,0.10)',
  text: '#fff',
  textDim: 'rgba(255,255,255,0.65)',
  spotify: '#1DB954',
  apple: '#FA243C',
  yt: '#FF0033',
};

const SOURCE_META = {
  spotify: { color: C.spotify, icon: 'music_note', label: 'Spotify' },
  apple:   { color: C.apple,   icon: 'music_note', label: 'Apple Music' },
  youtube: { color: C.yt,      icon: 'music_note', label: 'YouTube Music' },
  other:   { color: '#7c3aed', icon: 'music_note', label: 'Music' },
};

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
            border: `1px solid ${C.border}`,
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
              background: SOURCE_META[nowPlaying.source || 'other'].color,
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
          <NowPlayingPulse color={SOURCE_META[nowPlaying.source || 'other'].color} />
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
