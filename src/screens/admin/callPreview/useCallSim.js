// The call simulator's clock and state.
//
// ⚠ SIMULATION ONLY. Nothing here calls getUserMedia, constructs an
// RTCPeerConnection, opens an SFU socket, writes a `calls` doc or touches a
// wallet. It is a bag of React state plus two timers, so the preview can show
// the real call layouts doing real things without any of it being real.
//
// ⚠ THE WHOLE RETURN IS PASSED THROUGH ONE CONTEXT, NOT A HAND-PICKED PROP
// LIST. The stream preview learned this the expensive way: `simProps` was an
// allowlist maintained by hand and it silently dropped something four separate
// times (uploaded avatars, the PiP video, reactions, the combo meter), each
// time leaving a control mounted on a surface with nothing feeding it. A prop
// has to be remembered at every hop; a context cannot be forgotten.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  loadAssets, putAsset, deleteAsset, avatarKey, videoKey,
} from '../streamPreview/previewAssets';
import {
  GROUP_SEATS, SQUAD_SEATS, CHANNEL_SEATS, CALL_PEER, PREVIEW_VIEWER,
} from './callCast';

// ⚠ SPEAKING IS THE ONE THING THAT MUST MOVE ON ITS OWN. Every call surface in
// the product draws a speaking ring driven by a WebAudio RMS poll at 250ms
// (groupCall.js, voiceSession.js). A static grid cannot show what that ring
// does, and a screen recording of a call where nobody ever speaks is a picture
// of a bug. This rotates the ring through whoever has their mic on.
const SPEAK_MS = 1800;

export default function useCallSim() {
  // ── the call itself ──────────────────────────────────────────────────
  //
  // ⚠ THE PHASES ARE READ OFF THE REAL SCREENS, NOT INVENTED. CallScreen's own
  // state comment is `connecting, ringing, active, ended, failed`, and the
  // caller starts at 'ringing' while the callee starts at 'connecting'.
  // GroupCallScreen and VoiceChannelScreen use the SFU's four instead:
  // idle | connecting | live | error. 'reconnecting' is the one state the
  // product actually reaches (pc.oniceconnectionstatechange fires
  // 'disconnected') and draws nothing for, so it is selectable here in order
  // to be designed.
  const [phase, setPhase] = useState('active');
  const [elapsed, setElapsed] = useState(184);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  // ⚠ THE VIEWER'S OWN CAMERA IS SEPARATE FROM `videoOff`. videoOff is the
  // local track being disabled mid-call; camOn is whether this seat publishes
  // at all in a group room, which starts false in GroupCallScreen and in the
  // squad hangout. Collapsing them loses the "joined on voice" state.
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(true);
  // Controls fade after 4s on a video call (CallScreen:145). Held here so both
  // states are capturable rather than the capture racing a timer.
  const [controls, setControls] = useState(true);

  // ⚠ CONNECTION QUALITY IS DESIGNED HERE AND DOES NOT EXIST IN THE PRODUCT.
  // Measured 2026-09-06: no call surface reads getStats(), and the only network
  // signal any of them shows is CallScreen flipping to 'failed' once ICE gives
  // up. So a call degrades in total silence and then dies. This is a proposal,
  // flagged as one, NOT a claim that it works.
  const [quality, setQuality] = useState('good'); // good | fair | poor

  // ⚠ THE SEATS ARE ONE ARRAY PER ROOM KIND, because the caps differ and are
  // enforced server-side. A group call allows 8 cameras (MAX_CALL_VIDEO); a
  // squad hangout allows 2 (MAX_VIDEO_PUBLISHERS); a voice channel allows none
  // at all (voiceSession drops every non-audio track). One shared array would
  // let the rail put a camera somewhere the server refuses.
  const [groupSeats, setGroupSeats] = useState(GROUP_SEATS);
  const [squadSeats, setSquadSeats] = useState(SQUAD_SEATS);
  const [channelSeats, setChannelSeats] = useState(CHANNEL_SEATS);
  const [guestCount, setGuestCount] = useState(3);

  // Incoming ring. `kind` picks which of IncomingCallOverlay's three shapes is
  // drawn: a 1:1, a group call, or a paid session whose Accept button carries
  // the price and buys the entitlement before connecting.
  const [ringKind, setRingKind] = useState('direct'); // direct | group | paid
  const [ringVideo, setRingVideo] = useState(true);
  const [ringPrice, setRingPrice] = useState(250);

  // Voice channel: whether the person previewing owns it. Owner-only controls
  // (invite, delete, kick) are otherwise unreachable, and their absence reads
  // as a broken screen rather than as a permission.
  const [owner, setOwner] = useState(true);
  const [channelPrivate, setChannelPrivate] = useState(true);

  // ── uploaded assets, SHARED WITH THE STREAM PREVIEW ─────────────────
  //
  // ⚠ THE SAME INDEXEDDB STORE, ON PURPOSE. previewAssets.js keys avatars by
  // uid and videos by slot; both tools use the same cast, so a face uploaded
  // for nova_kill in the stream preview is her face here too, with no second
  // upload. A separate store would mean two rails, two uploads, and two tools
  // that disagree about what a person looks like.
  //
  // ⚠ THE BLOB IS WHAT PERSISTS, NEVER THE URL. An object URL is a pointer into
  // one document's memory. IndexedDB stores the File and a fresh URL is minted
  // on every mount. [[reference-object-url-in-render]]
  const [avatars, setAvatars] = useState({});
  const [videos, setVideos] = useState({});
  const liveUrls = useRef(new Set());

  const mintUrl = useCallback((blob) => {
    const u = URL.createObjectURL(blob);
    liveUrls.current.add(u);
    return u;
  }, []);
  const dropUrl = useCallback((u) => {
    if (!u) return;
    URL.revokeObjectURL(u);
    liveUrls.current.delete(u);
  }, []);

  useEffect(() => {
    let alive = true;
    loadAssets().then((blobs) => {
      if (!alive) return;
      const faces = {};
      const vids = {};
      Object.entries(blobs).forEach(([id, blob]) => {
        if (id.startsWith('video:')) vids[id.slice(6)] = mintUrl(blob);
        else if (id.startsWith('avatar:')) faces[id.slice(7)] = mintUrl(blob);
      });
      if (Object.keys(faces).length) setAvatars(faces);
      if (Object.keys(vids).length) setVideos(vids);
    }).catch(() => {});   // a blocked or absent IndexedDB degrades to session-only
    return () => { alive = false; };
  }, [mintUrl]);

  const setAvatar = useCallback((uid, file) => {
    if (!file) return;
    const url = mintUrl(file);
    setAvatars((prev) => { dropUrl(prev[uid]); return { ...prev, [uid]: url }; });
    putAsset(avatarKey(uid), file).catch(() => {});
  }, [mintUrl, dropUrl]);

  const clearAvatar = useCallback((uid) => {
    setAvatars((prev) => {
      if (!prev[uid]) return prev;
      dropUrl(prev[uid]);
      const next = { ...prev };
      delete next[uid];
      return next;
    });
    deleteAsset(avatarKey(uid)).catch(() => {});
  }, [dropUrl]);

  const setVideo = useCallback((slot, file) => {
    const url = file ? mintUrl(file) : null;
    setVideos((prev) => {
      dropUrl(prev[slot]);
      if (!url) { const next = { ...prev }; delete next[slot]; return next; }
      return { ...prev, [slot]: url };
    });
    if (file) putAsset(videoKey(slot), file).catch(() => {});
    else deleteAsset(videoKey(slot)).catch(() => {});
  }, [mintUrl, dropUrl]);

  useEffect(() => () => {
    liveUrls.current.forEach((u) => URL.revokeObjectURL(u));
    liveUrls.current.clear();
  }, []);

  // ── the call timer ───────────────────────────────────────────────────
  //
  // ⚠ IT RUNS ONLY WHILE THE CALL IS UP, exactly as CallScreen's does: the real
  // timer starts on `status === 'active'`, and a call that is ringing has no
  // duration to show. A clock ticking through a ringing state is the kind of
  // detail that makes a capture read as fake.
  useEffect(() => {
    if (phase !== 'active') return undefined;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // ── the speaking ring ────────────────────────────────────────────────
  //
  // ⚠ ONE TIMER FOR THE WHOLE SIMULATOR, not one per surface. Four surfaces
  // draw a speaking ring; four intervals would drift out of phase and two
  // screenshots of the same room would disagree about who is talking.
  const [speakingIdx, setSpeakingIdx] = useState(0);
  const [speakingOn, setSpeakingOn] = useState(true);
  useEffect(() => {
    if (!speakingOn || phase !== 'active') return undefined;
    const id = setInterval(() => setSpeakingIdx((i) => i + 1), SPEAK_MS);
    return () => clearInterval(id);
  }, [speakingOn, phase]);

  /**
   * Who is speaking right now, as a { uid | 'me': bool } map.
   *
   * ⚠ A MUTED SEAT NEVER LIGHTS UP. groupCall.js's own RMS loop carries the
   * same guard (`!(key === 'me' && !state.micOn)`), and a muted person wearing
   * a speaking ring is the single most confusing thing a call grid can draw.
   *
   * ⚠ DERIVED, NEVER STORED. Storing it would let the seat array and the
   * speaking map disagree the moment a seat is muted from the rail, leaving
   * the ring sitting on somebody who has gone quiet.
   */
  const speakingFor = useCallback((seats, includeMe = true) => {
    if (!speakingOn || phase !== 'active') return {};
    const live = [
      ...(includeMe && micOn ? ['me'] : []),
      ...seats.filter((s) => s.micOn).map((s) => s.uid),
    ];
    if (!live.length) return {};
    return { [live[speakingIdx % live.length]]: true };
  }, [speakingOn, phase, micOn, speakingIdx]);

  // ── seat mutation, one path per room ─────────────────────────────────
  const setGroupSeat = useCallback((uid, patch) => setGroupSeats(
    (prev) => prev.map((s) => (s.uid === uid ? { ...s, ...patch } : s)),
  ), []);
  const setSquadSeat = useCallback((uid, patch) => setSquadSeats(
    (prev) => prev.map((s) => (s.uid === uid ? { ...s, ...patch } : s)),
  ), []);
  const setChannelSeat = useCallback((uid, patch) => setChannelSeats(
    (prev) => prev.map((s) => (s.uid === uid ? { ...s, ...patch } : s)),
  ), []);

  // The seats actually in the room. One list per kind so a camera can never be
  // placed in a room whose server rejects it.
  const group = useMemo(() => groupSeats.slice(0, guestCount), [groupSeats, guestCount]);
  const squad = useMemo(() => squadSeats.slice(0, guestCount + 1), [squadSeats, guestCount]);
  const channel = useMemo(() => channelSeats.slice(0, guestCount), [channelSeats, guestCount]);

  const groupCams = group.filter((s) => s.camOn).length + (camOn ? 1 : 0);
  const squadCams = squad.filter((s) => s.camOn).length + (camOn ? 1 : 0);

  const reset = useCallback(() => {
    setPhase('active');
    setElapsed(0);
    setMuted(false); setVideoOff(false); setCamOn(false); setMicOn(true);
    setGroupSeats(GROUP_SEATS); setSquadSeats(SQUAD_SEATS); setChannelSeats(CHANNEL_SEATS);
    setQuality('good');
  }, []);

  return {
    phase, setPhase,
    elapsed, setElapsed,
    muted, setMuted, videoOff, setVideoOff, speakerOn, setSpeakerOn,
    camOn, setCamOn, micOn, setMicOn,
    controls, setControls,
    quality, setQuality,
    guestCount, setGuestCount,
    group, squad, channel,
    groupSeats, squadSeats, channelSeats,
    setGroupSeat, setSquadSeat, setChannelSeat,
    groupCams, squadCams,
    speakingFor, speakingOn, setSpeakingOn,
    ringKind, setRingKind, ringVideo, setRingVideo, ringPrice, setRingPrice,
    owner, setOwner, channelPrivate, setChannelPrivate,
    peer: CALL_PEER, me: PREVIEW_VIEWER,
    avatars, videos, setAvatar, clearAvatar, setVideo,
    reset,
  };
}
