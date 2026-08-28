// CoHostStage — joins the Pion SFU ingest_<streamId> room as a publisher
// and renders the 1-4 publisher tile grid.
//
// Architecture (CLAUDE.md "Streaming routing"):
//   - Each publisher (host + up to 3 co-hosts) opens a WebRTC session to vergr-sfu.
//   - vergr-cohost@<streamId> subscribes server-side, composites with ffmpeg
//     xstack, and pushes RTMP loopback → HLS → R2 → CDN.
//   - Viewer sees the composite HLS (one <video>, no SFU on the viewer side).
//
// This component is mounted inside BroadcasterScreen when streamDoc.kind === 'co_stream'.
// Solo streams never reach here.

import { useEffect, useRef, useState, useMemo } from 'react';
import { connectSFU } from '../../utils/sfuClient';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import Icon from '../Icon';
import UserName from '../UserName';

// Inline palette (matches BroadcasterScreen).
const C = {
  bg: '#0a0a14',
  card: '#12121e',
  cardSoft: '#0f0f1a',
  border: 'rgba(255,255,255,0.09)',
  text: '#e8e8f0',
  textDim: '#a0a0b8',
  purple: '#7c3aed',
  purpleLight: '#b44fff',
  green: '#22c55e',
  red: '#ef4444',
  amber: '#f59e0b',
};

const gridFor = (n) => {
  if (n <= 1) return { cols: '1fr',          rows: '1fr' };
  if (n === 2) return { cols: '1fr 1fr',     rows: '1fr' };
  if (n === 3) return { cols: '1fr 1fr',     rows: '1fr 1fr', span3: true };
  return            { cols: '1fr 1fr',       rows: '1fr 1fr' };
};

export default function CoHostStage({
  streamId,
  mediaStream,          // local cam+mic from BroadcasterScreen
  hostUid,
  coHostUids = [],
  hostInfo,             // { uid, displayName, avatar }
  fullscreen = false,
  onRemoveCoHost,       // (uid) => void — host-only
  onInviteCoHost,       // () => void — host-only, opens the in-live invite modal
  showToast,
}) {
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const sessionRef = useRef(null);
  const localVideoRef = useRef(null);
  // remotePeers: { peerId: { uid, videoStream?, audioStream?, displayName? } }
  const [remotePeers, setRemotePeers] = useState({});
  const [connecting, setConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState(null);

  const iAmHost = currentUser?.uid === hostUid;

  // ─────────────────────────────────────────────────────────────
  // Connect once on mount; tear down on unmount.
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!streamId || !currentUser) return;
    let session;
    let cancelled = false;

    (async () => {
      try {
        session = await connectSFU({
          roomId: `ingest_${streamId}`,
          getIdToken: () => currentUser.getIdToken(),
          onRemoteTrack: (peerId, kind, track, streamObj) => {
            setRemotePeers((prev) => {
              const existing = prev[peerId] || {};
              const next = { ...existing };
              if (kind === 'video') next.videoStream = streamObj || new MediaStream([track]);
              if (kind === 'audio') next.audioStream = streamObj || new MediaStream([track]);
              return { ...prev, [peerId]: next };
            });
          },
          onPeerJoined: (peerId, uid) => {
            setRemotePeers((prev) => ({ ...prev, [peerId]: { ...(prev[peerId] || {}), uid } }));
          },
          onPeerLeft: (peerId) => {
            setRemotePeers((prev) => {
              const next = { ...prev };
              delete next[peerId];
              return next;
            });
          },
          onTrackPublished: (peerId, uid, kind) => {
            // Auto-subscribe to video tracks from peers (audio is auto-mixed).
            if (kind === 'video') session?.subscribe(peerId, 'video');
          },
          onTrackUnpublished: (peerId, kind) => {
            setRemotePeers((prev) => {
              const p = prev[peerId];
              if (!p) return prev;
              const next = { ...p };
              if (kind === 'video') delete next.videoStream;
              if (kind === 'audio') delete next.audioStream;
              return { ...prev, [peerId]: next };
            });
          },
          onError: (err) => {
            console.error('CoHostStage SFU error:', err);
            setConnectionError(err.message);
          },
        });
        if (cancelled) { session.disconnect(); return; }
        sessionRef.current = session;

        // Publish our local tracks.
        const audioTrack = mediaStream?.getAudioTracks?.()?.[0];
        const videoTrack = mediaStream?.getVideoTracks?.()?.[0];
        if (audioTrack) await session.publish('audio', audioTrack);
        if (videoTrack) await session.publish('video', videoTrack);

        setConnecting(false);
      } catch (err) {
        console.error('CoHostStage connect failed:', err);
        setConnectionError(err.message || 'SFU connection failed');
        setConnecting(false);
        showToast?.('Could not join co-host room. ' + (err.message || ''), 'error');
      }
    })();

    return () => {
      cancelled = true;
      try { sessionRef.current?.disconnect(); } catch {}
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamId, currentUser?.uid]);

  // Refresh published tracks if mediaStream changes (e.g. camera handoff or screen share).
  useEffect(() => {
    const s = sessionRef.current;
    if (!s || !mediaStream) return;
    const audioTrack = mediaStream.getAudioTracks()?.[0];
    const videoTrack = mediaStream.getVideoTracks()?.[0];
    if (audioTrack) s.publish('audio', audioTrack).catch(() => {});
    if (videoTrack) s.publish('video', videoTrack).catch(() => {});
  }, [mediaStream]);

  // Mirror the local mediaStream into the local preview video element.
  useEffect(() => {
    if (localVideoRef.current && mediaStream) {
      localVideoRef.current.srcObject = mediaStream;
    }
  }, [mediaStream]);

  // ─────────────────────────────────────────────────────────────
  // Build the publisher roster.
  // Order: self first, then remotes (host first if I'm a co-host).
  // ─────────────────────────────────────────────────────────────
  const tiles = useMemo(() => {
    const self = {
      isSelf: true,
      uid: currentUser?.uid,
      displayName: iAmHost ? (profile?.displayName || 'You') : (profile?.displayName || 'You'),
      role: iAmHost ? 'HOST' : 'CO-HOST',
    };
    const remotes = Object.entries(remotePeers).map(([peerId, p]) => {
      const remoteIsHost = p.uid === hostUid;
      return {
        peerId,
        uid: p.uid,
        displayName: p.uid?.slice(0, 6) || 'guest',
        role: remoteIsHost ? 'HOST' : 'CO-HOST',
        videoStream: p.videoStream,
      };
    });
    // If I'm a co-host, surface host first.
    remotes.sort((a, b) => (a.role === 'HOST' ? -1 : b.role === 'HOST' ? 1 : 0));
    return [self, ...remotes].slice(0, 4);
  }, [remotePeers, currentUser?.uid, iAmHost, profile?.displayName, hostUid]);

  const n = tiles.length;
  const grid = gridFor(n);

  return (
    <div style={{
      display: 'grid',
      gap: fullscreen ? 4 : 10,
      gridTemplateColumns: grid.cols,
      gridTemplateRows: grid.rows,
      minHeight: fullscreen ? '100%' : 'auto',
    }}>
      {tiles.map((tile, i) => (
        <Tile
          key={tile.isSelf ? 'self' : tile.peerId}
          tile={tile}
          localVideoRef={tile.isSelf ? localVideoRef : null}
          fullscreen={fullscreen}
          showRemove={iAmHost && !tile.isSelf}
          onRemove={() => onRemoveCoHost?.(tile.uid)}
          // For n=3, span the third tile across both columns.
          style={grid.span3 && i === 2 ? { gridColumn: 'span 2' } : null}
        />
      ))}
      {n < 4 && !fullscreen && (
        // Empty co-host slot card — only the host sees the invite affordance.
        <EmptySlot canInvite={iAmHost} onClick={() => onInviteCoHost?.()} />
      )}
      {connecting && (
        <div style={{
          position: 'absolute', top: 12, right: 12, padding: '4px 10px',
          background: 'rgba(0,0,0,0.6)', borderRadius: 99, fontSize: 11,
          color: C.amber, fontWeight: 700,
        }}>Connecting to SFU…</div>
      )}
      {connectionError && (
        <div style={{
          position: 'absolute', top: 12, right: 12, padding: '4px 10px',
          background: 'rgba(239,68,68,0.2)', borderRadius: 99, fontSize: 11,
          color: C.red, fontWeight: 700,
        }}>SFU: {connectionError}</div>
      )}
    </div>
  );
}

function Tile({ tile, localVideoRef, fullscreen, showRemove, onRemove, style }) {
  const remoteVideoRef = useRef(null);

  useEffect(() => {
    if (!tile.isSelf && remoteVideoRef.current && tile.videoStream) {
      remoteVideoRef.current.srcObject = tile.videoStream;
    }
  }, [tile.isSelf, tile.videoStream]);

  return (
    <div style={{
      position: 'relative', aspectRatio: fullscreen ? undefined : '16/9',
      background: '#000', borderRadius: fullscreen ? 6 : 12,
      border: `1px solid ${C.border}`, overflow: 'hidden',
      minHeight: fullscreen ? 0 : 'auto',
      ...style,
    }}>
      <video
        ref={tile.isSelf ? localVideoRef : remoteVideoRef}
        autoPlay
        muted={tile.isSelf}    // never feedback-loop our own audio
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
      />
      <div style={{
        position: 'absolute', top: 10, left: 10,
        padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 800,
        letterSpacing: '0.08em',
        background: tile.role === 'HOST' ? 'rgba(124,58,237,0.85)' : 'rgba(0,0,0,0.6)',
        color: '#fff',
      }}>{tile.role}</div>
      <div style={{
        position: 'absolute', bottom: 10, left: 10, fontSize: 12, fontWeight: 700,
        color: '#fff', padding: '4px 8px', background: 'rgba(0,0,0,0.55)', borderRadius: 4,
      }}><UserName user={tile} masked /></div>
      {!tile.videoStream && !tile.isSelf && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: C.textDim, fontSize: 12, fontWeight: 600,
        }}>Waiting for video…</div>
      )}
      {showRemove && (
        <button onClick={onRemove} style={{
          position: 'absolute', top: 10, right: 10,
          padding: '4px 10px', borderRadius: 99, border: 'none',
          background: 'rgba(239,68,68,0.85)', color: '#fff',
          fontSize: 10, fontWeight: 800, cursor: 'pointer',
        }}>Remove</button>
      )}
    </div>
  );
}

function EmptySlot({ canInvite, onClick }) {
  return (
    <div onClick={canInvite ? onClick : undefined} style={{
      position: 'relative', aspectRatio: '16/9',
      background: C.cardSoft, border: `1px dashed ${C.border}`, borderRadius: 12,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: C.textDim, fontSize: 12, fontWeight: 600,
      cursor: canInvite ? 'pointer' : 'default',
    }}>
      <div style={{ textAlign: 'center' }}>
        <Icon name="group_add" size={28} className="" />
        <div style={{ marginTop: 6 }}>{canInvite ? 'Invite co-host' : 'Open slot'}</div>
      </div>
    </div>
  );
}
