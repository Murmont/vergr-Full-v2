import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { getUser, logCallEnd } from '../../firebase/firestore';
import { createPeerConnection, createOffer, answerCall, endCallCleanup, getMediaStream } from '../../utils/webrtc';
import Icon from '../../components/Icon';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import UserAvatar from '../../components/UserAvatar';
import UserName from '../../components/UserName';

export default function CallScreen() {
  const { chatId, callType } = useParams();
  const [params] = useSearchParams();
  const role = params.get('role') || 'caller';
  const navigate = useNavigate();

  const [status, setStatus] = useState('connecting'); // connecting, ringing, active, ended, failed
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(callType === 'voice');
  const [speakerOn, setSpeakerOn] = useState(false);
  const [otherUser, setOtherUser] = useState(null);
  const [showControls, setShowControls] = useState(true);
  // Camera flip. `hasTwoCameras` gates the button: offering a flip on a laptop
  // with one camera is a control that can only fail.
  const [facing, setFacing] = useState('user');
  const [flipping, setFlipping] = useState(false);
  const [hasTwoCameras, setHasTwoCameras] = useState(false);
  // ⚠ RETRY IS A RE-RUN OF SETUP, NOT A PAGE RELOAD. Bumping this re-keys the
  // WebRTC effect, so the old connection tears down and a fresh one is built —
  // in place, keeping the route, the thread and the app. `safeReload()` threw
  // away the whole session to redial one call, and on the native build that is a
  // cold boot of the WebView.
  const [attempt, setAttempt] = useState(0);

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  // Second element carrying the SAME remote stream, drawn blurred behind the
  // real one so the letterbox is filled instead of showing black bars. The
  // rule is never crop the picture: `object-cover` was throwing away 16.6% of
  // the remote frame (measured on a live call, 640x360 source in a 1523x714
  // box) and ~61% of the self-view's width (audit A47).
  const remoteBgRef = useRef(null);
  const timerRef = useRef(null);
  const cleanupRef = useRef(null);
  // Call-history bookkeeping: call doc meta, whether it ever connected,
  // elapsed seconds, and a one-shot guard so we log exactly once.
  const callMetaRef = useRef(null);
  const everActiveRef = useRef(false);
  const elapsedRef = useRef(0);
  const loggedRef = useRef(false);

  // Load other user's info
  useEffect(() => {
    if (!chatId) return;
    const otherUid = chatId.split('_').find(id => id !== auth.currentUser?.uid);
    if (otherUid) getUser(otherUid).then(setOtherUser).catch(() => {});
  }, [chatId]);

  // Main WebRTC setup
  useEffect(() => {
    if (!chatId) return;
    let mounted = true;

    const setup = async () => {
      try {
        // Get media
        const stream = await getMediaStream(callType === 'video' ? 'video' : 'audio');
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
        localStreamRef.current = stream;

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Create peer connection
        const pc = createPeerConnection();
        pcRef.current = pc;

        // Remote stream
        const remoteStream = new MediaStream();
        remoteStreamRef.current = remoteStream;

        pc.ontrack = (event) => {
          event.streams[0].getTracks().forEach(track => {
            remoteStream.addTrack(track);
          });
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStream;
          }
          // Same MediaStream on the blurred backdrop. One stream, two sinks:
          // no extra bandwidth, no second decode of anything new.
          if (remoteBgRef.current) {
            remoteBgRef.current.srcObject = remoteStream;
          }
          if (mounted) setStatus('active');
        };

        pc.oniceconnectionstatechange = () => {
          if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            if (mounted) setStatus('active');
          }
          if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
            if (mounted) setStatus('failed');
          }
        };

        // Caller creates offer, callee answers
        if (role === 'callee') {
          setStatus('connecting');
          cleanupRef.current = await answerCall(chatId, pc, stream);
        } else {
          setStatus('ringing');
          cleanupRef.current = await createOffer(chatId, pc, stream);
        }
      } catch (err) {
        console.error('WebRTC setup error:', err);
        if (mounted) setStatus('failed');
      }
    };

    setup();

    return () => {
      mounted = false;
      if (cleanupRef.current) cleanupRef.current();
      // ⚠ RELEASE THE DEVICES, NOT JUST THE SIGNALLING. This teardown only
      // unsubscribed, so re-running setup (a retry) left the previous camera and
      // microphone open: the OS indicator stayed lit and the phone held two
      // capture sessions. `stop()` and `close()` are both idempotent, so the
      // hangup path calling them first is harmless.
      try { localStreamRef.current?.getTracks?.().forEach((t) => t.stop()); } catch { /* already stopped */ }
      try { pcRef.current?.close?.(); } catch { /* already closed */ }
    };
  }, [chatId, callType, role, attempt]);

  // Listen for status changes (caller hangup, etc)
  useEffect(() => {
    if (!chatId) return;
    const unsub = onSnapshot(doc(db, 'calls', chatId), (snap) => {
      if (!snap.exists()) { handleEnd(); return; }
      const data = snap.data();
      callMetaRef.current = data;
      if (data.status === 'ended') handleEnd();
      if (data.status === 'active' && status === 'ringing') setStatus('active');
    });
    return () => unsub();
  }, [chatId, status]);

  // Call timer
  useEffect(() => {
    if (status === 'active') {
      everActiveRef.current = true;
      timerRef.current = setInterval(() => setElapsed(e => { elapsedRef.current = e + 1; return e + 1; }), 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [status]);

  // Auto-hide controls after 4s in video call
  useEffect(() => {
    if (callType !== 'video' || status !== 'active') return;
    const timer = setTimeout(() => setShowControls(false), 4000);
    return () => clearTimeout(timer);
  }, [showControls, callType, status]);

  const handleEnd = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (cleanupRef.current) cleanupRef.current();
    // Log to call history exactly once. Deterministic doc id (chatId +
    // start ms) means the other side's write merges into the same entry.
    if (!loggedRef.current) {
      loggedRef.current = true;
      const meta = callMetaRef.current;
      const startedAtMs = meta?.createdAt?.toMillis?.() || (Date.now() - elapsedRef.current * 1000);
      logCallEnd({
        chatId,
        callerId: meta?.callerId,
        type: callType,
        startedAtMs,
        answered: everActiveRef.current,
        durationSec: elapsedRef.current,
      });
    }
    await endCallCleanup(chatId, pcRef.current, localStreamRef.current);
    // Always land back in Messages (not navigate(-1), which returned to whatever
    // screen launched the call — squads/feed/etc). `replace` drops the dead call
    // screen from history so Back doesn't return to it.
    navigate('/messages', { replace: true });
  };

  const toggleMute = () => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setMuted(!audioTrack.enabled);
    }
  };

  const toggleVideo = () => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setVideoOff(!videoTrack.enabled);
    }
  };

  /**
   * Flip between the front and back camera.
   *
   * ⚠⚠ THIS BUTTON HAD NO onClick AT ALL. It rendered, it took a press, and
   * nothing happened — for the life of the feature. On a phone, front-to-back is
   * the most used control on a video call.
   *
   * ⚠ `replaceTrack` ON THE SENDER, NOT A NEW getUserMedia INTO THE PEER
   * CONNECTION. Swapping the track on the existing sender needs no renegotiation
   * at all: no new offer, no answer, no ICE restart, and the other side never
   * sees a blip. Tearing down and re-adding a track would renegotiate mid-call,
   * which is how a flip turns into a reconnect.
   *
   * ⚠ THE OLD TRACK IS STOPPED, AND THAT IS NOT TIDYING. An unstopped camera
   * track keeps the device held and the OS indicator lit, so on a phone you flip
   * once and both cameras stay open.
   *
   * ⚠ THE `videoOff` STATE IS CARRIED ACROSS. Flipping while your camera is off
   * must not silently turn it back on and start sending your face.
   */
  const flipCamera = async () => {
    if (flipping) return;
    const oldTrack = localStreamRef.current?.getVideoTracks()[0];
    if (!oldTrack) return;
    const next = facing === 'user' ? 'environment' : 'user';
    setFlipping(true);
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: next } },
        audio: false,
      });
      const newTrack = fresh.getVideoTracks()[0];
      if (!newTrack) throw new Error('no video track');
      newTrack.enabled = oldTrack.enabled;

      const sender = pcRef.current?.getSenders?.().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(newTrack);

      oldTrack.stop();
      localStreamRef.current.removeTrack(oldTrack);
      localStreamRef.current.addTrack(newTrack);
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      setFacing(next);
    } catch (err) {
      // A laptop with one camera, or a denied permission. Say nothing loud: the
      // old track is still live and still being sent, so the call is unaffected.
      console.warn('Camera flip failed:', err?.message || err);
    } finally {
      setFlipping(false);
    }
  };

  // ⚠ ENUMERATE AFTER PERMISSION, NOT BEFORE. Until getUserMedia has resolved,
  // enumerateDevices returns entries with empty labels and, in some browsers,
  // a single placeholder — so a check that runs on mount reports one camera on a
  // phone that has two. This runs off `status`, by which point media is up.
  //
  // ⚠ IT READS `callType`, NOT `isVideo`. `isVideo` is a const declared BELOW
  // this effect, and a dependency array is evaluated at RENDER time — so
  // depending on it is a temporal-dead-zone crash, not a lint warning. eslint
  // `no-undef` sees a well-defined binding and says nothing.
  useEffect(() => {
    let alive = true;
    if (callType !== 'video') return undefined;
    navigator.mediaDevices?.enumerateDevices?.()
      .then((list) => {
        if (alive) setHasTwoCameras(list.filter((d) => d.kind === 'videoinput').length > 1);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [callType, status]);

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const isVideo = callType === 'video';

  return (
    <div className="fixed inset-0 bg-bg-dark z-[100] flex flex-col overflow-hidden"
      onClick={() => isVideo && setShowControls(true)}>

      {/* === VIDEO CALL LAYOUT === */}
      {isVideo ? (
        <>
          {/* Remote video — full screen */}
          <div className="absolute inset-0 bg-black">
            {/* Blurred fill: same stream, cover + scale so no edge shows. */}
            <video ref={remoteBgRef} autoPlay playsInline muted aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-50 pointer-events-none" />
            {/* The real picture, never cropped. */}
            <video ref={remoteVideoRef} autoPlay playsInline
              className="relative w-full h-full object-contain" />
            {status !== 'active' && (
              <div className="absolute inset-0 bg-bg-dark flex items-center justify-center">
                <div className="text-center">
                  <UserAvatar src={otherUser?.avatar} size={96} />
                  <p className="text-white font-syne text-xl font-bold mt-4"><UserName user={otherUser} masked fallback={'Connecting...'} /></p>
                  <p className="text-brand-violet-light text-sm mt-2 animate-pulse">
                    {status === 'ringing' ? 'Ringing...' : status === 'failed' ? 'Connection failed' : 'Connecting...'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Local video — picture in picture */}
          {/* Self-view. The box used to be PORTRAIT (w-28 h-40) with
              `object-cover`, so a landscape webcam (1280x720 measured live)
              lost about 61% of its width. Now a 16:9 box with `object-contain`,
              so a landscape camera fills it and a portrait phone camera
              letterboxes rather than being sliced down the middle. */}
          <div className="absolute top-16 right-4 w-40 aspect-video rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl z-30 bg-black">
            <video ref={localVideoRef} autoPlay playsInline muted
              className={`w-full h-full object-contain ${videoOff ? 'hidden' : ''}`} />
            {videoOff && (
              <div className="w-full h-full flex items-center justify-center">
                <Icon name="videocam_off" size={24} className="text-text-muted" />
              </div>
            )}
          </div>

          {/* Top bar — fades with controls */}
          <div className={`absolute top-0 left-0 right-0 px-5 pt-5 pb-12 bg-gradient-to-b from-black/70 to-transparent z-20 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
               style={IS_NATIVE_BUILD ? { paddingTop: 'calc(env(safe-area-inset-top, 0px) + 20px)' } : undefined}>
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
              <div className="flex-1 min-w-0">
                {/* The person you are talking to is the most important thing on
                    this screen. It was 12px — smaller than a sidebar nav label. */}
                <p className="text-white font-syne text-lg md:text-xl font-bold truncate"><UserName user={otherUser} masked fallback={'Unknown'} /></p>
                <p className="text-white/70 text-sm font-dmmono tabular-nums">
                  {status === 'active' ? formatTime(elapsed) : status === 'ringing' ? 'Ringing...' : 'Connecting...'}
                </p>
              </div>
              {/* Was 8px at 30% opacity — the one trust signal on the screen and
                  it was effectively unreadable. */}
              <span className="flex items-center gap-1.5 text-white/70 text-[11px] font-dmmono uppercase tracking-widest shrink-0">
                <Icon name="lock" size={13} className="text-green-400" />
                P2P Encrypted
              </span>
            </div>
          </div>
        </>
      ) : (
        /* === AUDIO CALL LAYOUT === */
        <div className="flex-1 flex flex-col items-center justify-center px-8 relative">
          {/* Ambient background */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-brand-violet/5 rounded-full blur-3xl" />
            <div className="absolute bottom-1/4 right-1/4 w-48 h-48 bg-brand-violet/5 rounded-full blur-3xl" />
          </div>

          {/* Encrypted badge */}
          <div className="absolute top-8 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-2/50 border border-white/[0.04]">
            <Icon name="lock" size={10} className="text-brand-violet-light" />
            <span className="text-[9px] text-text-muted font-dmmono uppercase tracking-widest">P2P Encrypted</span>
          </div>

          {/* Avatar with animated ring */}
          <div className="relative mb-8 z-10">
            {status === 'ringing' && (
              <>
                <div className="absolute inset-0 w-40 h-40 -m-6 rounded-full border-2 border-brand-violet/20 animate-ping" style={{ animationDuration: '2s' }} />
                <div className="absolute inset-0 w-36 h-36 -m-4 rounded-full border border-brand-violet/10 animate-ping" style={{ animationDuration: '3s' }} />
              </>
            )}
            {status === 'active' && (
              <div className="absolute inset-0 w-32 h-32 -m-2 rounded-full border-2 border-brand-violet/30 animate-pulse" />
            )}
            <UserAvatar src={otherUser?.avatar} size={112} />
          </div>

          {/* Name + status */}
          <h2 className="font-syne text-2xl font-bold text-text-primary mb-1 z-10"><UserName user={otherUser} masked fallback={'Unknown'} /></h2>
          <p className="text-text-muted text-sm font-dmmono mb-1 z-10"><UserName user={otherUser} masked handle fallback={'user'} /></p>

          {status === 'active' ? (
            <div className="flex items-center gap-2 z-10">
              <div className="w-2 h-2 rounded-full bg-green-500 " />
              <p className="text-brand-violet-light text-lg font-dmmono font-bold">{formatTime(elapsed)}</p>
            </div>
          ) : (
            <p className={`text-sm z-10 ${status === 'failed' ? 'text-brand-ember' : 'text-text-muted animate-pulse'}`}>
              {status === 'ringing' ? 'Ringing...' : status === 'failed' ? 'Connection failed — try WiFi or mobile data' : 'Connecting...'}
            </p>
          )}

          {/* Hidden audio elements */}
          <audio ref={remoteVideoRef} autoPlay playsInline className="hidden" />
          <audio ref={localVideoRef} autoPlay playsInline muted className="hidden" />
        </div>
      )}

      {/* === CONTROLS BAR === */}
      <div className={`${isVideo ? 'absolute bottom-0 left-0 right-0 z-20' : 'relative'} transition-opacity duration-300 ${isVideo && !showControls ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <div className={`${isVideo ? 'bg-gradient-to-t from-black/80 to-transparent pt-16' : ''} pb-10 px-6`}>
          <div className="flex items-center justify-center gap-5">
            {/* Mute */}
            <button onClick={toggleMute}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${muted ? 'bg-white/20 backdrop-blur' : 'bg-surface-2/80 backdrop-blur'}`}>
              <Icon name={muted ? 'mic_off' : 'mic'} size={24} className={muted ? 'text-brand-ember' : 'text-white'} />
            </button>

            {/* Video toggle (video calls only) */}
            {isVideo && (
              <button onClick={toggleVideo}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${videoOff ? 'bg-white/20 backdrop-blur' : 'bg-surface-2/80 backdrop-blur'}`}>
                <Icon name={videoOff ? 'videocam_off' : 'videocam'} size={24} className={videoOff ? 'text-brand-ember' : 'text-white'} />
              </button>
            )}

            {/* End call */}
            <button onClick={handleEnd}
              className="w-16 h-16 rounded-full bg-brand-ember flex items-center justify-center  hover:scale-105 active:scale-95 transition-all">
              <Icon name="call_end" size={28} className="text-white" />
            </button>

            {/* Speaker (audio calls only) */}
            {!isVideo && (
              <button onClick={() => setSpeakerOn(!speakerOn)}
                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${speakerOn ? 'bg-brand-violet/20' : 'bg-surface-2/80 backdrop-blur'}`}>
                <Icon name={speakerOn ? 'volume_up' : 'volume_down'} size={24} className={speakerOn ? 'text-brand-violet-light' : 'text-white'} />
              </button>
            )}

            {/* Flip camera (video calls only, and only where there IS a second
                camera — see hasTwoCameras). */}
            {isVideo && hasTwoCameras && (
              <button
                type="button"
                onClick={flipCamera}
                disabled={flipping}
                aria-label={facing === 'user' ? 'Switch to the back camera' : 'Switch to the front camera'}
                className={`w-14 h-14 rounded-full bg-surface-2/80 backdrop-blur flex items-center justify-center transition-opacity ${flipping ? 'opacity-50' : ''}`}
              >
                <Icon name="flip_camera_ios" size={24} className="text-white" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Failed state — retry button */}
      {status === 'failed' && (
        <div className="absolute bottom-32 left-1/2 -translate-x-1/2 z-30">
          <button onClick={() => { setStatus('connecting'); setAttempt((a) => a + 1); }} className="px-6 py-3 rounded-full bg-brand-violet text-bg-dark font-bold text-sm flex items-center gap-2">
            <Icon name="refresh" size={18} /> Retry
          </button>
        </div>
      )}
    </div>
  );
}
