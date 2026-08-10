// groupCall — module-level singleton for ad-hoc GROUP calls in a group chat
// (02_MESSAGING 2.1). Voice for everyone, video for up to 8 cameras.
//
// Why a separate module from voiceSession.js rather than a flag on it:
//   - voiceSession is audio-ONLY by construction (it drops every non-audio
//     remote track) and is Discord-shaped: you stay in the channel while you
//     browse, one session at a time, presence heartbeats onto voice_channels.
//   - A group call carries video, is ring-based (a `calls` doc rings members),
//     and ends when you hang up.
// Sharing one module would mean flags threaded through every branch of both
// behaviours. They share the thing that's actually hard — connectSFU — and
// diverge above it, which is the right seam.
//
// Transport: the Pion SFU (never call it Jitsi). 1:1 DM calls stay raw WebRTC
// P2P; this is only for groups, where a mesh would melt phones.
//
// Room id is `call_<callId>`: the SFU gives rooms with that prefix the bigger
// video grid (videoCapFor in infra/sfu/main.go). Voice participants are NOT
// capped by that — only cameras.

import { connectSFU, pickSfuBase } from './sfuClient';

export const MAX_CALL_VIDEO = 8; // mirrors maxCallVideoPublishers in the SFU

const state = {
  callId: null,
  chatId: null,
  title: '',
  phase: 'idle',   // idle | connecting | live | error
  errorMsg: null,
  micOn: true,
  camOn: false,
  // peerId -> { peerId, uid, audio, video, stream }
  peers: {},
  speaking: {},    // 'me' | peerId -> bool
  localStream: null,
};

let session = null;
let micTrack = null;
let camTrack = null;
let camStream = null;
let listeners = new Set();
let audioHost = null;
let audioCtx = null;
let analysers = new Map();
let speakTimer = null;

function emit() {
  const snap = {
    ...state,
    peers: { ...state.peers },
    speaking: { ...state.speaking },
  };
  for (const fn of listeners) { try { fn(snap); } catch {/* ignore */} }
}

export function subscribeGroupCall(fn) {
  listeners.add(fn);
  fn({ ...state, peers: { ...state.peers }, speaking: { ...state.speaking } });
  return () => listeners.delete(fn);
}
export function getGroupCallState() {
  return { ...state, peers: { ...state.peers }, speaking: { ...state.speaking } };
}

// Remote <audio> elements live on document.body, NOT inside the screen — the
// call must keep its audio if the user navigates away from the call screen.
function ensureAudioHost() {
  if (!audioHost) {
    audioHost = document.createElement('div');
    audioHost.id = 'groupcall-audio-host';
    audioHost.style.display = 'none';
    document.body.appendChild(audioHost);
  }
  return audioHost;
}

// ── Speaking indicator (RMS over a WebAudio analyser, polled) ──
function attachAnalyser(key, stream) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    analysers.set(key, { analyser, buf: new Uint8Array(analyser.frequencyBinCount), src });
  } catch {/* speaking dots are cosmetic — never break the call for them */}
}
function detachAnalyser(key) {
  const a = analysers.get(key);
  if (a) { try { a.src.disconnect(); } catch {/* ignore */} analysers.delete(key); }
}
function startSpeakingLoop() {
  if (speakTimer) return;
  speakTimer = setInterval(() => {
    let changed = false;
    for (const [key, { analyser, buf }] of analysers) {
      analyser.getByteFrequencyData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const on = rms > 18 && !(key === 'me' && !state.micOn);
      if (!!state.speaking[key] !== on) { state.speaking[key] = on; changed = true; }
    }
    if (changed) emit();
  }, 250);
}
function stopSpeakingLoop() {
  if (speakTimer) { clearInterval(speakTimer); speakTimer = null; }
  for (const key of [...analysers.keys()]) detachAnalyser(key);
  state.speaking = {};
}

function upsertPeer(peerId, patch) {
  state.peers[peerId] = { peerId, ...(state.peers[peerId] || {}), ...patch };
  emit();
}
function removePeer(peerId) {
  delete state.peers[peerId];
  detachAnalyser(peerId);
  audioHost?.querySelectorAll(`audio[data-peer-id="${peerId}"]`).forEach(el => el.remove());
  emit();
}

/**
 * Join (or start) a group call.
 * @param callId  the `calls` doc id — also keys the SFU room
 * @param opts    { chatId, title, video } — video:true publishes the camera too
 */
export async function joinGroupCall(callId, currentUser, opts = {}) {
  if (!callId || !currentUser) return;
  if (state.callId === callId && (state.phase === 'live' || state.phase === 'connecting')) return;
  await leaveGroupCall();

  state.callId = callId;
  state.chatId = opts.chatId || null;
  state.title = opts.title || 'Group call';
  state.phase = 'connecting';
  state.errorMsg = null;
  state.micOn = true;
  state.camOn = !!opts.video;
  state.peers = {};
  state.speaking = {};
  emit();

  const roomId = `call_${callId}`;
  try {
    const media = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: opts.video ? { width: { ideal: 640 }, height: { ideal: 480 } } : false,
    });
    // The user may have hung up while we were waiting on the camera prompt.
    if (state.callId !== callId) { media.getTracks().forEach(t => t.stop()); return; }

    micTrack = media.getAudioTracks()[0] || null;
    camTrack = media.getVideoTracks()[0] || null;
    camStream = media;
    state.localStream = media;
    attachAnalyser('me', media);

    const s = await connectSFU({
      roomId,
      sfuBase: await pickSfuBase(roomId),
      getIdToken: () => currentUser.getIdToken(),
      onRoomState: (existing) => {
        for (const m of existing) {
          upsertPeer(m.peerId, {
            uid: m.uid,
            audio: m.tracks?.includes('audio') || false,
            video: m.tracks?.includes('video') || false,
          });
        }
      },
      onPeerJoined: (peerId, uid) => upsertPeer(peerId, { uid }),
      onPeerLeft: (peerId) => removePeer(peerId),
      onTrackPublished: (peerId, uid, kind) => upsertPeer(peerId, { uid, [kind]: true }),
      onTrackUnpublished: (peerId, kind) => {
        upsertPeer(peerId, { [kind]: false, ...(kind === 'video' ? { stream: null } : {}) });
      },
      onRemoteTrack: (peerId, kind, track, stream) => {
        const ms = stream || new MediaStream([track]);
        if (kind === 'audio') {
          const el = document.createElement('audio');
          el.autoplay = true;
          el.dataset.peerId = peerId;
          el.srcObject = ms;
          ensureAudioHost().appendChild(el);
          attachAnalyser(peerId, ms);
          track.onended = () => { el.remove(); detachAnalyser(peerId); };
        } else if (kind === 'video') {
          // Hand the stream to the screen, which binds it to a <video> tile.
          upsertPeer(peerId, { video: true, stream: ms });
          track.onended = () => upsertPeer(peerId, { video: false, stream: null });
        }
      },
      onError: (msg) => {
        if (state.callId !== callId) return;
        state.errorMsg = msg || 'Connection error';
        state.phase = 'error';
        emit();
      },
    });
    if (state.callId !== callId) { try { await s.disconnect(); } catch {/* ignore */} return; }
    session = s;

    if (micTrack) await session.publish('audio', micTrack);
    if (camTrack) {
      try {
        await session.publish('video', camTrack);
      } catch (err) {
        // The SFU rejects past the grid cap. Stay in the call on VOICE rather
        // than failing the whole join — losing your camera is not losing the call.
        state.camOn = false;
        state.errorMsg = err?.message || `Camera limit reached (${MAX_CALL_VIDEO} cameras).`;
        camTrack.stop();
        camTrack = null;
      }
    }
    state.phase = 'live';
    startSpeakingLoop();
    emit();
  } catch (err) {
    console.error('[groupCall] connect failed', err);
    if (state.callId === callId) {
      state.errorMsg = err?.message || 'Could not join the call';
      state.phase = 'error';
      emit();
    }
  }
}

export async function leaveGroupCall() {
  stopSpeakingLoop();
  try { await session?.disconnect(); } catch {/* ignore */}
  session = null;
  try { micTrack?.stop(); } catch {/* ignore */}
  try { camTrack?.stop(); } catch {/* ignore */}
  try { camStream?.getTracks().forEach(t => t.stop()); } catch {/* ignore */}
  micTrack = null; camTrack = null; camStream = null;
  audioHost?.querySelectorAll('audio').forEach(el => el.remove());
  state.callId = null;
  state.chatId = null;
  state.phase = 'idle';
  state.errorMsg = null;
  state.peers = {};
  state.speaking = {};
  state.localStream = null;
  state.camOn = false;
  emit();
}

export function toggleCallMic() {
  if (!micTrack) return;
  state.micOn = !state.micOn;
  micTrack.enabled = state.micOn;
  emit();
}

/** Camera on/off mid-call. Publishing can fail on the grid cap — surface that
 *  rather than silently leaving the button "on" with no video going out. */
export async function toggleCallCamera() {
  if (!session) return;
  if (state.camOn) {
    try { session.unpublish('video'); } catch {/* ignore */}
    try { camTrack?.stop(); } catch {/* ignore */}
    camTrack = null;
    state.camOn = false;
    emit();
    return;
  }
  try {
    const s = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
    });
    camTrack = s.getVideoTracks()[0];
    await session.publish('video', camTrack);
    state.camOn = true;
    state.errorMsg = null;
    if (state.localStream) {
      try { state.localStream.addTrack(camTrack); } catch {/* ignore */}
    }
    emit();
  } catch (err) {
    try { camTrack?.stop(); } catch {/* ignore */}
    camTrack = null;
    state.camOn = false;
    state.errorMsg = err?.message || `Camera limit reached (${MAX_CALL_VIDEO} cameras).`;
    emit();
  }
}
