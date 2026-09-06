// SquadStreamScreen — voice-first squad hangout with up to 2 active video publishers.
//
// Architecture (CLAUDE.md "Streaming routing rule" route #2):
//   - Joins a Pion SFU room (roomId = squadId) via src/utils/sfuClient.js
//   - Voice: every member publishes Opus, every member subscribes to everyone else.
//     SFU does the fan-out; latency ~200ms, conversational.
//   - Video: max 2 publishers per room. Members subscribe on-demand by clicking
//     someone's tile. Defaults off so 100-person rooms only fan out 2 video tracks.
//   - Camera handoff: a third member who taps "turn on camera" sees a polite
//     "ask one of them to swap" prompt — no hard rotation.
//
// Auth: SFU validates the Firebase ID token + checks the user is in the squad's
// `members` array via Firestore Admin SDK. Frontend doesn't need to gate access
// since the server enforces it.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { getSquadMembers } from '../../firebase/firestore';
import { connectSFU, pickSfuBase } from '../../utils/sfuClient';
import TopBar from '../../components/TopBar';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import UserName from '../../components/UserName';

const MAX_VIDEO_PUBLISHERS = 2;

export default function SquadStreamScreen() {
  const { squadId } = useParams();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const navigate = useNavigate();

  // Static squad info (name, members) so we can render even before SFU connects.
  const [squad, setSquad] = useState(null);
  const [members, setMembers] = useState([]);
  const membersByUid = useMemo(() => {
    const m = new Map();
    for (const mem of members) m.set(mem.id, mem);
    return m;
  }, [members]);

  // Connection lifecycle state.
  const [phase, setPhase] = useState('connecting'); // 'connecting' | 'live' | 'error' | 'left'
  const [errorMsg, setErrorMsg] = useState(null);

  // Local capture state.
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);

  // SFU peer state, keyed by sfu peerId.
  // shape: { peerId, uid, audio: bool, video: bool, watching: bool }
  const [peers, setPeers] = useState({}); // map<peerId, peerEntry>

  // Live MediaStream refs we own.
  const localMicTrackRef = useRef(null);
  const localCamTrackRef = useRef(null);
  const sfuSessionRef = useRef(null);

  // Container refs for remote audio elements (hidden) + remote video elements (visible).
  const remoteAudioContainerRef = useRef(null);
  const remoteVideoElsRef = useRef(new Map()); // peerId -> <video>

  // ---------- Load squad info ----------

  useEffect(() => {
    if (!squadId) return;
    const unsub = onSnapshot(doc(db, 'squads', squadId), (snap) => {
      if (snap.exists()) setSquad({ id: snap.id, ...snap.data() });
    });
    return () => unsub();
  }, [squadId]);

  useEffect(() => {
    if (!squadId) return;
    getSquadMembers(squadId).then(setMembers).catch(console.error);
  }, [squadId]);

  // ---------- Helpers to mutate the peers map ----------

  const upsertPeer = useCallback((peerId, patch) => {
    setPeers((prev) => {
      const cur = prev[peerId] || { peerId, uid: null, audio: false, video: false, watching: false };
      return { ...prev, [peerId]: { ...cur, ...patch } };
    });
  }, []);

  const removePeer = useCallback((peerId) => {
    setPeers((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
    const vid = remoteVideoElsRef.current.get(peerId);
    if (vid) {
      try { vid.srcObject = null; } catch {}
      remoteVideoElsRef.current.delete(peerId);
    }
  }, []);

  // ---------- Wire up SFU connection ----------

  useEffect(() => {
    if (!squadId || !currentUser) return;
    let session;
    let cancelled = false;

    (async () => {
      try {
        // 1. Get mic — required to join voice. Cam stays off by default.
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
        if (cancelled) {
          micStream.getTracks().forEach((t) => t.stop());
          return;
        }
        localMicTrackRef.current = micStream.getAudioTracks()[0];

        // 2. Connect to SFU.
        session = await connectSFU({
          roomId: squadId,
          sfuBase: await pickSfuBase(squadId),   // healthy SFU box for failover/spread
          getIdToken: () => currentUser.getIdToken(),
          onRoomState: (existingMembers) => {
            for (const m of existingMembers) {
              upsertPeer(m.peerId, {
                uid: m.uid,
                audio: m.tracks?.includes('audio') || false,
                video: m.tracks?.includes('video') || false,
              });
            }
          },
          onPeerJoined: (peerId, uid) => upsertPeer(peerId, { uid }),
          onPeerLeft:   (peerId) => removePeer(peerId),
          onTrackPublished:   (peerId, uid, kind) => upsertPeer(peerId, { uid, [kind]: true }),
          onTrackUnpublished: (peerId, kind)      => {
            upsertPeer(peerId, { [kind]: false });
            // If they unpublished video while we were watching them, drop our subscription too.
            if (kind === 'video') {
              setPeers((prev) => {
                if (!prev[peerId]?.watching) return prev;
                return { ...prev, [peerId]: { ...prev[peerId], watching: false } };
              });
              const vid = remoteVideoElsRef.current.get(peerId);
              if (vid) { try { vid.srcObject = null; } catch {} }
            }
          },
          onRemoteTrack: (peerId, kind, track, stream) => {
            if (kind === 'audio') {
              // Server auto-subscribes us to all audio. Play it silently in the DOM.
              const audioEl = document.createElement('audio');
              audioEl.autoplay = true;
              audioEl.dataset.peerId = peerId;
              audioEl.srcObject = stream || new MediaStream([track]);
              remoteAudioContainerRef.current?.appendChild(audioEl);
              track.onended = () => audioEl.remove();
            } else if (kind === 'video') {
              // We only get a video track AFTER explicitly subscribing. Plumb it
              // into the <video> element if one is already mounted, or stash it
              // for the element to pick up on next render.
              const vid = remoteVideoElsRef.current.get(peerId);
              if (vid) vid.srcObject = stream || new MediaStream([track]);
              upsertPeer(peerId, { video: true, watching: true, _pendingStream: stream || new MediaStream([track]) });
            }
          },
          onError: (err) => {
            console.error('SFU error', err);
            setErrorMsg(err.message || 'Connection error');
          },
        });
        if (cancelled) {
          session.disconnect();
          return;
        }
        sfuSessionRef.current = session;

        // 3. Publish mic immediately.
        await session.publish('audio', localMicTrackRef.current);

        setPhase('live');
      } catch (err) {
        console.error('squad stream connect failed', err);
        setErrorMsg(err.message || 'Failed to join');
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
      try { session?.disconnect(); } catch {}
      sfuSessionRef.current = null;
      // Stop local capture so the OS releases the mic/cam indicator.
      localMicTrackRef.current?.stop();
      localCamTrackRef.current?.stop();
      localMicTrackRef.current = null;
      localCamTrackRef.current = null;
    };
  }, [squadId, currentUser, upsertPeer, removePeer]);

  // ---------- Local controls ----------

  const toggleMic = useCallback(() => {
    const track = localMicTrackRef.current;
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }, []);

  const activeVideoPublisherCount = useMemo(() => {
    let n = 0;
    for (const p of Object.values(peers)) if (p.video) n++;
    return n;
  }, [peers]);

  const toggleCam = useCallback(async () => {
    const session = sfuSessionRef.current;
    if (!session) return;

    if (camOn) {
      // Turn off → unpublish + stop track.
      try { await session.unpublish('video'); } catch (e) { console.warn(e); }
      localCamTrackRef.current?.stop();
      localCamTrackRef.current = null;
      setCamOn(false);
      return;
    }

    // Polite cap: if 2 cams already live (excluding self), refuse + tell user.
    if (activeVideoPublisherCount >= MAX_VIDEO_PUBLISHERS) {
      showToast(
        `${MAX_VIDEO_PUBLISHERS} cameras already live. Ask one of them to turn off, or wait.`,
        'info'
      );
      return;
    }

    try {
      const camStream = await navigator.mediaDevices.getUserMedia({
        // Squad video is intentionally low-res; voice is the primary surface.
        video: { width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      const camTrack = camStream.getVideoTracks()[0];
      localCamTrackRef.current = camTrack;
      await session.publish('video', camTrack);
      setCamOn(true);
    } catch (err) {
      console.error('camera publish failed', err);
      showToast(err.message || 'Could not start camera', 'error');
    }
  }, [camOn, activeVideoPublisherCount, showToast]);

  const watchPeer = useCallback((peerId) => {
    const session = sfuSessionRef.current;
    if (!session) return;
    session.subscribe(peerId, 'video');
    upsertPeer(peerId, { watching: true });
  }, [upsertPeer]);

  const stopWatching = useCallback((peerId) => {
    const session = sfuSessionRef.current;
    if (!session) return;
    session.unsubscribe(peerId, 'video');
    upsertPeer(peerId, { watching: false });
    const vid = remoteVideoElsRef.current.get(peerId);
    if (vid) { try { vid.srcObject = null; } catch {} }
  }, [upsertPeer]);

  const leave = useCallback(() => {
    sfuSessionRef.current?.disconnect();
    sfuSessionRef.current = null;
    setPhase('left');
    navigate(`/squads/${squadId}`);
  }, [navigate, squadId]);

  // ---------- Render ----------

  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-bg-dark text-white">
        <TopBar title={squad?.name || 'Squad stream'} showBack onBack={() => navigate(`/squads/${squadId}`)} />
        <div className="max-w-md mx-auto p-6 text-center">
          <Icon name="error" className="text-brand-ember mb-4" style={{ fontSize: 48 }} />
          <p className="font-bold mb-2">Couldn't join the hangout</p>
          <p className="text-sm text-text-muted mb-4">{errorMsg}</p>
          <button
            onClick={() => navigate(`/squads/${squadId}`)}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm"
          >
            Back to squad
          </button>
        </div>
      </div>
    );
  }

  // Decide which peers' tiles to render. Show all known peers, but only video
  // for those we're watching AND who actually publish video.
  const peerEntries = Object.values(peers).sort((a, b) => {
    // Video publishers first, then audio-only.
    if (a.video !== b.video) return a.video ? -1 : 1;
    return 0;
  });

  return (
    <div className="min-h-screen bg-bg-dark text-white flex flex-col">
      <TopBar
        title={squad?.name || 'Squad hangout'}
        subtitle={phase === 'connecting' ? 'Connecting...' : `${peerEntries.length + 1} in voice`}
        showBack
        onBack={leave}
      />

      <div className="flex-1 overflow-y-auto p-4 pb-32">
        {/* Self tile */}
        <div className="mb-6">
          <p className="text-xs uppercase tracking-wider text-text-muted mb-2">You</p>
          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <UserAvatar user={currentUser} size={44} />
            <div className="flex-1">
              <p className="font-bold text-sm"><UserName user={currentUser} masked fallback={'You'} /></p>
              <p className="text-xs text-text-muted">
                {micOn ? 'Mic on' : 'Mic muted'}{camOn ? ' • Camera on' : ''}
              </p>
            </div>
            <Icon
              name={micOn ? 'mic' : 'mic_off'}
              className={micOn ? 'text-brand-violet-light' : 'text-text-muted'}
            />
          </div>
        </div>

        {/* Active video tiles */}
        {peerEntries.some((p) => p.video) && (
          <>
            <p className="text-xs uppercase tracking-wider text-text-muted mb-2">
              Cameras live ({activeVideoPublisherCount}/{MAX_VIDEO_PUBLISHERS})
            </p>
            <div className={`grid gap-3 mb-6 ${IS_NATIVE_BUILD ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
              {peerEntries.filter((p) => p.video).map((p) => {
                const member = membersByUid.get(p.uid);
                return (
                  <div key={p.peerId} className="rounded-xl overflow-hidden bg-white/[0.03] border border-white/[0.08] aspect-video relative">
                    {p.watching ? (
                      <video
                        autoPlay
                        playsInline
                        muted={false}
                        ref={(el) => {
                          if (!el) return;
                          remoteVideoElsRef.current.set(p.peerId, el);
                          if (p._pendingStream && el.srcObject !== p._pendingStream) {
                            el.srcObject = p._pendingStream;
                          }
                        }}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <button
                        onClick={() => watchPeer(p.peerId)}
                        className="w-full h-full flex flex-col items-center justify-center gap-2 hover:bg-white/[0.05]"
                      >
                        <UserAvatar user={member} size={48} />
                        <span className="text-xs text-text-muted">Tap to watch</span>
                      </button>
                    )}
                    <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 text-xs">
                      <span className="px-2 py-1 rounded bg-black/60 backdrop-blur-sm">
                        {member?.username || 'Member'}
                      </span>
                      {p.watching && (
                        <button
                          onClick={() => stopWatching(p.peerId)}
                          className="ml-auto px-2 py-1 rounded bg-black/60 backdrop-blur-sm hover:bg-black/80"
                        >
                          Stop watching
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Voice-only members */}
        <p className="text-xs uppercase tracking-wider text-text-muted mb-2">
          In voice
        </p>
        {peerEntries.length === 0 ? (
          <p className="text-sm text-text-muted">Just you here. Invite a squadmate.</p>
        ) : (
          <div className={`grid gap-3 ${IS_NATIVE_BUILD ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
            {peerEntries.filter((p) => !p.video).map((p) => {
              const member = membersByUid.get(p.uid);
              return (
                <div key={p.peerId} className="flex flex-col items-center gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                  <UserAvatar user={member} size={44} />
                  <p className="text-xs font-bold truncate w-full text-center">
                    {member?.username || 'Member'}
                  </p>
                  <Icon
                    name={p.audio ? 'mic' : 'mic_off'}
                    className={p.audio ? 'text-brand-violet-light' : 'text-text-muted'}
                    style={{ fontSize: 16 }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Hidden audio sink — every remote audio track plays through here. */}
      <div ref={remoteAudioContainerRef} style={{ display: 'none' }} aria-hidden="true" />

      {/* Bottom controls bar.
          ⚠⚠ THE CAP NEEDS A REASON THAT IS STILL THERE WHEN YOU LOOK BACK. The
          camera button disables itself at the two-publisher cap and the only
          explanation was a toast fired from `toggleCam` — which a disabled
          button never fires, and which has gone by the time anyone wonders why
          the control is dead. So the line lives under the row, permanently,
          whenever the cap is what is stopping you. */}
      <div className="fixed bottom-0 left-0 right-0 bg-surface-1/95 backdrop-blur-md border-t border-white/[0.08] p-4 flex flex-col items-center gap-2">
        {!camOn && activeVideoPublisherCount >= MAX_VIDEO_PUBLISHERS && (
          <p className="text-[11px] text-text-muted text-center">
            {MAX_VIDEO_PUBLISHERS} cameras are already live. Ask one of them to turn off, or wait.
          </p>
        )}
        <div className="flex items-center justify-center gap-3">
        <button
          onClick={toggleMic}
          aria-label={micOn ? 'Mute mic' : 'Unmute mic'}
          className={`w-14 h-14 rounded-full flex items-center justify-center ${
            micOn ? 'bg-white/10 hover:bg-white/15' : 'bg-brand-ember hover:bg-brand-ember/80'
          }`}
        >
          <Icon name={micOn ? 'mic' : 'mic_off'} />
        </button>
        <button
          onClick={toggleCam}
          aria-label={camOn ? 'Turn off camera' : 'Turn on camera'}
          disabled={!camOn && activeVideoPublisherCount >= MAX_VIDEO_PUBLISHERS}
          className={`w-14 h-14 rounded-full flex items-center justify-center ${
            camOn ? 'bg-brand-violet-light text-black' : 'bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed'
          }`}
        >
          <Icon name={camOn ? 'videocam' : 'videocam_off'} />
        </button>
        <button
          onClick={leave}
          aria-label="Leave hangout"
          className="w-14 h-14 rounded-full bg-brand-ember hover:bg-brand-ember/80 flex items-center justify-center"
        >
          <Icon name="call_end" />
        </button>
        </div>
      </div>
    </div>
  );
}
