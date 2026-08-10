// TwoCameraProofViewer
//
// Mod / founder review surface for a player's two-camera proof feed.
// Reads `match.proofFeed[uid].chunks[]` and plays them sequentially in a
// single <video>. Each chunk is a 10s WebM that already contains the
// game-window + webcam composite the player produced client-side.
//
// Drop-in usage:
//   <TwoCameraProofViewer match={match} participants={participants} />
//
// Renders a collapsible drawer per recording player. Empty proofFeed = null.

import { useMemo, useRef, useState, useEffect } from 'react';
import Icon from '../Icon';

export default function TwoCameraProofViewer({ match, participants = [] }) {
  const feeds = match?.proofFeed || {};
  const uids = Object.keys(feeds);
  if (!uids.length) return null;

  return (
    <div style={{
      borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)',
      background: '#14141F', padding: 14, marginTop: 12,
    }}>
      <div style={{ fontSize: 10, letterSpacing: '0.14em', fontWeight: 800,
        color: '#F0A500', marginBottom: 10 }}>
        ● TWO-CAMERA PROOF FEEDS (high-stakes verification)
      </div>
      {uids.map((uid) => (
        <FeedRow
          key={uid}
          uid={uid}
          feed={feeds[uid]}
          participant={participants.find((p) => p?.id === uid)}
        />
      ))}
    </div>
  );
}

function FeedRow({ uid, feed, participant }) {
  const [open, setOpen] = useState(false);
  const [chunkIdx, setChunkIdx] = useState(0);
  const videoRef = useRef(null);

  // Sort chunks by idx so playback is in capture order, not write order.
  const chunks = useMemo(() => {
    return [...(feed?.chunks || [])].sort((a, b) => (a.idx || 0) - (b.idx || 0));
  }, [feed?.chunks]);

  // Auto-advance to next chunk when current finishes.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onEnded = () => setChunkIdx((i) => Math.min(i + 1, chunks.length - 1));
    v.addEventListener('ended', onEnded);
    return () => v.removeEventListener('ended', onEnded);
  }, [chunks.length]);

  useEffect(() => {
    if (!open || !videoRef.current || !chunks[chunkIdx]) return;
    videoRef.current.src = chunks[chunkIdx].url;
    videoRef.current.play().catch(() => {});
  }, [open, chunkIdx, chunks]);

  const label = participant?.displayName || participant?.username || uid.slice(0, 8);
  const totalMs = chunks.reduce((a, c) => a + (c.durationMs || 0), 0);
  const totalMin = (totalMs / 60_000).toFixed(1);

  return (
    <div style={{
      borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10, marginTop: 10,
    }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          background: 'transparent', border: 'none', color: '#fff',
          padding: 4, cursor: 'pointer', textAlign: 'left',
        }}
      >
        <Icon name={open ? 'expand_less' : 'expand_more'} size={18} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#fff' }}>{label}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>
            {chunks.length} chunks · ~{totalMin}m recorded
          </div>
        </div>
      </button>

      {open && chunks.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <video
            ref={videoRef}
            controls
            playsInline
            style={{ width: '100%', borderRadius: 10, background: '#000', maxHeight: 480 }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
            {chunks.map((c, i) => (
              <button
                key={c.idx + '-' + i}
                onClick={() => setChunkIdx(i)}
                title={new Date(c.t || 0).toLocaleTimeString()}
                style={{
                  padding: '4px 8px', borderRadius: 6, fontSize: 10,
                  fontFamily: 'DM Mono, monospace', fontWeight: 700,
                  cursor: 'pointer',
                  background: i === chunkIdx ? '#F0A500' : 'rgba(255,255,255,0.05)',
                  color: i === chunkIdx ? '#000' : 'rgba(255,255,255,0.7)',
                  border: '1px solid ' + (i === chunkIdx ? '#F0A500' : 'rgba(255,255,255,0.08)'),
                }}
              >
                #{c.idx}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
