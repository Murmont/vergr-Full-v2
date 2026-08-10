// voiceSession — module-level singleton for voice-channel SFU sessions.
//
// Why: the session used to live inside VoiceChannelScreen's effect, so any
// navigation unmounted the screen and DISCONNECTED the call. Discord keeps
// you in the channel while you browse; this manager owns the SFU session,
// mic track and remote <audio> elements (parked on document.body so audio
// keeps playing after the screen unmounts). The screen and the global
// floating pill both subscribe to the same state.
//
// Speaking indicators: one WebAudio AnalyserNode per stream (local mic +
// each remote), polled at 250ms; `speaking[key]` flips when RMS crosses a
// threshold ('me' = the local user, otherwise peerId).

import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { connectSFU, pickSfuBase } from './sfuClient';

const state = {
  channelId: null,
  channelName: '',
  visibility: 'public',
  phase: 'idle', // idle | connecting | live | error
  errorMsg: null,
  micOn: true,
  peers: {},     // peerId -> { peerId, uid, audio }
  speaking: {},  // 'me' | peerId -> bool
};

let session = null;
let micTrack = null;
let audioHost = null;          // hidden div on document.body holding remote <audio>
let listeners = new Set();
let audioCtx = null;
let analysers = new Map();     // key ('me'|peerId) -> { analyser, buf, src }
let speakTimer = null;
let peerVolumes = new Map();   // peerId -> 0..1 (local playback volume)
let presenceTimer = null;      // heartbeat for voice_channels.active.{uid}

// Best-effort presence on the channel doc: `active.{uid} = ms`, heartbeated
// every 60s, removed on leave. Renderers treat entries older than ~2min as
// stale (covers crashes — Firestore has no onDisconnect).
async function presenceWrite(channelId, on) {
  const uid = auth.currentUser?.uid;
  if (!uid || !channelId) return;
  try {
    await updateDoc(doc(db, 'voice_channels', channelId), {
      [`active.${uid}`]: on ? Date.now() : deleteField(),
    });
  } catch {/* best effort */}
}

export function activeVoiceMembers(channel, freshMs = 120_000) {
  const m = channel?.active || {};
  const cutoff = Date.now() - freshMs;
  return Object.entries(m).filter(([, ts]) => typeof ts === 'number' && ts > cutoff).map(([uid]) => uid);
}

function emit() {
  for (const fn of listeners) { try { fn({ ...state, peers: { ...state.peers }, speaking: { ...state.speaking } }); } catch {/* ignore */} }
}

export function subscribeVoiceSession(fn) {
  listeners.add(fn);
  fn({ ...state });
  return () => listeners.delete(fn);
}

export function getVoiceSessionState() { return { ...state }; }

function ensureAudioHost() {
  if (!audioHost) {
    audioHost = document.createElement('div');
    audioHost.style.display = 'none';
    audioHost.dataset.role = 'voice-session-audio';
    document.body.appendChild(audioHost);
  }
  return audioHost;
}

function attachAnalyser(key, stream) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!audioCtx) audioCtx = new Ctx();
    const src = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    analysers.set(key, { analyser, buf: new Uint8Array(analyser.fftSize), src });
  } catch {/* speaking dots are best-effort */}
}

function detachAnalyser(key) {
  const a = analysers.get(key);
  if (a) { try { a.src.disconnect(); } catch {/* ignore */} analysers.delete(key); }
  if (state.speaking[key]) { delete state.speaking[key]; }
}

function startSpeakingLoop() {
  stopSpeakingLoop();
  speakTimer = setInterval(() => {
    let changed = false;
    for (const [key, { analyser, buf }] of analysers) {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d; }
      const speaking = Math.sqrt(sum / buf.length) > 0.04;
      if (key === 'me' && !state.micOn) { if (state.speaking.me) { state.speaking.me = false; changed = true; } continue; }
      if (!!state.speaking[key] !== speaking) { state.speaking[key] = speaking; changed = true; }
    }
    if (changed) emit();
  }, 250);
}

function stopSpeakingLoop() {
  if (speakTimer) { clearInterval(speakTimer); speakTimer = null; }
}

function upsertPeer(peerId, patch) {
  const cur = state.peers[peerId] || { peerId, uid: null, audio: false };
  state.peers = { ...state.peers, [peerId]: { ...cur, ...patch } };
  emit();
}

function removePeer(peerId) {
  const next = { ...state.peers };
  delete next[peerId];
  state.peers = next;
  detachAnalyser(peerId);
  // Remove any parked audio elements for this peer.
  audioHost?.querySelectorAll(`audio[data-peer-id="${peerId}"]`).forEach(el => el.remove());
  emit();
}

/** Join a channel. If already live in the SAME channel, no-op. If in a
 *  different one, leave it first (Discord semantics: one voice session). */
export async function joinVoiceChannel(channel, currentUser) {
  if (!channel?.id || !currentUser) return;
  if (state.channelId === channel.id && (state.phase === 'live' || state.phase === 'connecting')) {
    state.channelName = channel.name || state.channelName;
    emit();
    return;
  }
  await leaveVoiceChannel();

  state.channelId = channel.id;
  state.channelName = channel.name || 'Voice channel';
  state.visibility = channel.visibility || 'public';
  state.phase = 'connecting';
  state.errorMsg = null;
  state.micOn = true;
  state.peers = {};
  state.speaking = {};
  emit();

  try {
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    // join() may have been superseded while we awaited the mic.
    if (state.channelId !== channel.id) { micStream.getTracks().forEach(t => t.stop()); return; }
    micTrack = micStream.getAudioTracks()[0];
    attachAnalyser('me', micStream);

    const s = await connectSFU({
      roomId: `voice_${channel.id}`,
      sfuBase: await pickSfuBase(`voice_${channel.id}`),
      getIdToken: () => currentUser.getIdToken(),
      onRoomState: (existingMembers) => {
        for (const m of existingMembers) {
          upsertPeer(m.peerId, { uid: m.uid, audio: m.tracks?.includes('audio') || false });
        }
      },
      onPeerJoined:       (peerId, uid) => upsertPeer(peerId, { uid }),
      onPeerLeft:         (peerId) => removePeer(peerId),
      onTrackPublished:   (peerId, uid, kind) => { if (kind === 'audio') upsertPeer(peerId, { uid, audio: true }); },
      onTrackUnpublished: (peerId, kind) => { if (kind === 'audio') upsertPeer(peerId, { audio: false }); },
      onRemoteTrack: (peerId, kind, track, stream) => {
        if (kind !== 'audio') return;
        const ms = stream || new MediaStream([track]);
        const audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.dataset.peerId = peerId;
        audioEl.srcObject = ms;
        audioEl.volume = peerVolumes.has(peerId) ? peerVolumes.get(peerId) : 1;
        ensureAudioHost().appendChild(audioEl);
        attachAnalyser(peerId, ms);
        track.onended = () => { audioEl.remove(); detachAnalyser(peerId); };
      },
      onError: (msg) => {
        if (state.channelId !== channel.id) return;
        state.errorMsg = msg || 'Connection error';
        state.phase = 'error';
        emit();
      },
    });
    if (state.channelId !== channel.id) { try { await s.disconnect(); } catch {/* ignore */} return; }
    session = s;
    await session.publish('audio', micTrack);
    state.phase = 'live';
    startSpeakingLoop();
    // Presence: mark active + heartbeat (channel rows show who's in).
    presenceWrite(channel.id, true);
    presenceTimer = setInterval(() => presenceWrite(channel.id, true), 60_000);
    emit();
  } catch (err) {
    console.error('[voiceSession] connect failed', err);
    if (state.channelId === channel.id) {
      state.errorMsg = err?.message || 'Could not join voice channel';
      state.phase = 'error';
      emit();
    }
  }
}

export async function leaveVoiceChannel() {
  stopSpeakingLoop();
  if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
  if (state.channelId) presenceWrite(state.channelId, false);
  peerVolumes = new Map();
  try { session?.disconnect(); } catch {/* ignore */}
  try { micTrack?.stop(); } catch {/* ignore */}
  session = null;
  micTrack = null;
  for (const key of [...analysers.keys()]) detachAnalyser(key);
  if (audioHost) { while (audioHost.firstChild) audioHost.removeChild(audioHost.firstChild); }
  state.channelId = null;
  state.channelName = '';
  state.phase = 'idle';
  state.errorMsg = null;
  state.peers = {};
  state.speaking = {};
  state.micOn = true;
  emit();
}

/** Local playback volume for one peer (0..1). 0 = locally muted. */
export function setPeerVolume(peerId, v) {
  const vol = Math.max(0, Math.min(1, Number(v) || 0));
  peerVolumes.set(peerId, vol);
  audioHost?.querySelectorAll(`audio[data-peer-id="${peerId}"]`).forEach(el => { el.volume = vol; });
}

export function getPeerVolume(peerId) {
  return peerVolumes.has(peerId) ? peerVolumes.get(peerId) : 1;
}

export function toggleVoiceMic() {
  if (!micTrack) return state.micOn;
  const next = !state.micOn;
  micTrack.enabled = next;
  state.micOn = next;
  if (!next) state.speaking.me = false;
  emit();
  return next;
}
