// SFU signaling client — talks to vergr-sfu (infra/sfu/main.go) via WebSocket.
//
// Routing rule (CLAUDE.md): squad voice + ≤2 video publishers, OR co-host
// public stream ingest rooms. NOT for 1-on-1 calls (those use raw WebRTC
// peer-to-peer via webrtc.js).
//
// Usage:
//   import { connectSFU } from '@/utils/sfuClient';
//   const session = await connectSFU({
//     roomId: squadId,
//     getIdToken: () => auth.currentUser.getIdToken(),
//     onRemoteTrack: (peerId, kind, track) => { ... },
//     onPeerJoined: (peerId, uid) => { ... },
//     onPeerLeft:   (peerId) => { ... },
//     onTrackPublished:   (peerId, uid, kind) => { ... },
//     onTrackUnpublished: (peerId, kind) => { ... },
//   });
//   await session.publish('audio', micTrack);
//   await session.publish('video', camTrack);   // throws if 2 publishers already
//   await session.subscribe(otherPeerId, 'video');
//   session.unpublish('video');                  // camera handoff: keep mic, drop cam
//   session.disconnect();

import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';

const SFU_WS_URL =
  import.meta.env.VITE_SFU_WS_URL || 'wss://sfu.vergr.app/ws';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
];

const SFU_NODE_STALE_MS = 60 * 1000;

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// pickSfuBase — choose which SFU box this room connects to, for failover +
// spread. Reads the stream_nodes registry, keeps only active+fresh nodes that
// advertise an sfuBase, sorts them stably, and picks deterministically by
// hashing roomId — so EVERY member of a room independently computes the SAME
// box (WebRTC rooms have affinity: all peers must share one SFU). If a box dies
// its heartbeat goes stale (≤60s) and drops out of the set, so all members
// recompute onto the surviving box on their next (re)connect = failover.
// Returns null if the registry is empty/unreachable → caller uses the static
// default box. Co-host rooms intentionally DON'T use this (they pin to the box
// running their ffmpeg composite); only squad voice/hangout rooms do.
export async function pickSfuBase(roomId) {
  try {
    const snap = await getDocs(collection(db, 'stream_nodes'));
    const now = Date.now();
    const nodes = [];
    snap.forEach((d) => {
      const n = d.data() || {};
      if (n.status !== 'active' || !n.sfuBase) return;
      const hb = n.lastHeartbeat?.toMillis ? n.lastHeartbeat.toMillis() : 0;
      if (!hb || now - hb > SFU_NODE_STALE_MS) return;
      nodes.push({ id: d.id, sfuBase: n.sfuBase });
    });
    if (!nodes.length) return null;
    nodes.sort((a, b) => (a.id < b.id ? -1 : 1));
    return nodes[hashStr(roomId) % nodes.length].sfuBase;
  } catch {
    return null;
  }
}

export async function connectSFU({
  roomId,
  sfuBase,                 // assigned SFU box (from pickSfuBase); falls back to the static box
  getIdToken,
  onRemoteTrack = () => {},
  onPeerJoined = () => {},
  onPeerLeft = () => {},
  onTrackPublished = () => {},
  onTrackUnpublished = () => {},
  onRoomState = () => {},
  onError = () => {},
}) {
  const token = await getIdToken();
  if (!token) throw new Error('SFU connect: no Firebase ID token');

  const url = `${(sfuBase || SFU_WS_URL)}?token=${encodeURIComponent(token)}&room=${encodeURIComponent(roomId)}`;
  const ws = new WebSocket(url);

  // Server-pushed offers + bookkeeping all live in this single PeerConnection.
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  // Pre-add transceivers so initial offer carries audio + video m-sections.
  // We may not actually publish yet, but the SDP plumbing is ready.
  const audioTx = pc.addTransceiver('audio', { direction: 'sendrecv' });
  const videoTx = pc.addTransceiver('video', { direction: 'sendrecv' });

  // Forward our ICE candidates to the server.
  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      send({ type: 'trickle', candidate: ev.candidate.toJSON() });
    }
  };

  // Whenever the server attaches a remote track to us, hand it up to the app.
  pc.ontrack = (ev) => {
    const track = ev.track;
    // The streamId on the remote track equals the publisher's peerId
    // (we set this server-side when constructing TrackLocalStaticRTP).
    const peerId = ev.streams?.[0]?.id || track.id;
    onRemoteTrack(peerId, track.kind, track, ev.streams?.[0]);
  };

  // Promise resolution helpers for the connect handshake.
  let resolveReady, rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });

  // Outgoing message helper — coalesces JSON serialization.
  function send(msg) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  // Inbound message dispatch.
  ws.onmessage = async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    switch (msg.type) {
      case 'room-state':
        onRoomState(msg.members || []);
        resolveReady();
        break;

      case 'offer':
        // Server offered (typically because someone subscribed us to a new track).
        await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        send({ type: 'answer', sdp: ans.sdp });
        break;

      case 'answer':
        // Server's answer to our publish offer.
        await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
        break;

      case 'trickle':
        if (msg.candidate) {
          try { await pc.addIceCandidate(msg.candidate); }
          catch (e) { console.warn('addIceCandidate', e); }
        }
        break;

      case 'peer-joined':
        onPeerJoined(msg.peerId, msg.uid);
        break;

      case 'peer-left':
        onPeerLeft(msg.peerId);
        break;

      case 'track-published':
        onTrackPublished(msg.peerId, msg.uid, msg.kind);
        break;

      case 'track-unpublished':
        onTrackUnpublished(msg.peerId, msg.kind);
        break;

      case 'error':
        console.error('SFU error:', msg.error);
        onError(new Error(msg.error));
        break;
    }
  };

  ws.onerror = (e) => {
    console.error('SFU ws error', e);
    onError(new Error('WebSocket error'));
    rejectReady?.(new Error('WebSocket error'));
  };

  ws.onclose = () => {
    pc.close();
  };

  // Wait for either the open or the room-state message to confirm we're in.
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  // Send an initial empty offer so server can attach senders for any pre-existing
  // audio publishers (the server auto-subscribes us to room audio).
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send({ type: 'offer', sdp: offer.sdp });

  await ready;

  // ===== Public session API =====

  return {
    /** Replace the local track on the audio or video sender. */
    async publish(kind, track) {
      const tx = kind === 'audio' ? audioTx : videoTx;
      // Force H.264 for video so server-side composition (co-host xstack)
      // can copy without transcoding.
      if (kind === 'video' && tx.setCodecPreferences) {
        try {
          const caps = RTCRtpSender.getCapabilities('video');
          const h264 = caps?.codecs?.filter(c => c.mimeType === 'video/H264') || [];
          if (h264.length) tx.setCodecPreferences(h264);
        } catch (e) { /* not all browsers support this — fall back */ }
      }
      await tx.sender.replaceTrack(track);
      // Renegotiate so the new track's m-section becomes sendonly.
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: 'offer', sdp: offer.sdp });
    },

    /** Stop sending the given kind without disconnecting. Used for camera handoff. */
    async unpublish(kind) {
      const tx = kind === 'audio' ? audioTx : videoTx;
      await tx.sender.replaceTrack(null);
      send({ type: 'unpublish', kind });
    },

    /** Subscribe to another peer's published track (typically video). */
    subscribe(peerId, kind) {
      send({ type: 'subscribe', peerId, kind });
    },

    /** Stop subscribing to another peer's track. */
    unsubscribe(peerId, kind) {
      send({ type: 'unsubscribe', peerId, kind });
    },

    /** Tear down the SFU session. */
    disconnect() {
      try { ws.close(); } catch {}
      try { pc.close(); } catch {}
    },

    pc,
    ws,
  };
}
