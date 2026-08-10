// src/screens/streams/BroadcasterScreen.jsx
//
// Web (desktop + mobile-web) broadcaster. Reconstructed against the live
// streaming infra: browser fMP4 ingest (startBrowserIngest), the canvas
// compositor (createStreamCompositor) for desktop screen-share / layouts /
// scenes + mobile "Studio" mode, real audio meter, uplink-probe bitrate cap +
// fps backpressure adaptation, tips/followers/poll telemetry, clip buffer, and
// the end-stream recap. The native-shell broadcaster lives in
// screens/streams/native/NativeBroadcasterScreen.jsx.
//
// Desktop always composites (screen-share PiP, layout presets). Mobile web is
// camera-only by default (direct ingest, proven path); an opt-in Studio toggle
// runs the portrait compositor for dual-camera + scene cards.

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import {
  doc, onSnapshot, updateDoc, serverTimestamp,
  collection, query, where, orderBy, limit,
  addDoc, Timestamp,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { motion, AnimatePresence } from 'framer-motion';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import Icon from '../../components/Icon';
import { startBrowserIngest, browserCanIngest, probeUplink } from '../../utils/streamIngest';
import { createStreamCompositor } from '../../utils/streamCompositor';
import { MASKS_ENABLED } from '../../utils/featureFlags';
import HypeMeter from '../../components/tournament/HypeMeter';
import JoinAnnouncer from '../../components/streams/JoinAnnouncer';
import ChatPanel from '../../components/streams/ChatPanel';
import { StreamGoalBar, TipAlertOverlay, SubAlertOverlay } from '../../components/streams/StreamGoalAndAlerts';
import { useActiveStreamPoll, StreamPollCard, CreateStreamPollModal } from '../../components/streams/StreamPoll';
import StreamShareSheet from '../../components/streams/StreamShareSheet';
import TipCatalogEditor from '../../components/streams/TipCatalogEditor';
import BannedWordsEditor from '../../components/streams/BannedWordsEditor';
import useStreamClipBuffer from '../../hooks/useStreamClipBuffer';
import { useStreamJoinEvents } from '../../hooks/useStreamJoinEvents';
import { uploadToR2 } from '../../utils/r2Storage';
import { createPost } from '../../firebase/firestore';
import { renderShareCard } from '../../utils/shareCard';
import { resolveTier } from '../../utils/tierSystem';

const C = {
  bg: '#0a0a14', card: '#12121e', cardSoft: '#0f0f1a',
  border: 'rgba(255,255,255,0.09)', borderSoft: 'rgba(255,255,255,0.06)',
  text: '#e8e8f0', textDim: '#a0a0b8', textMuted: '#6b7280',
  purple: '#7c3aed', purpleLight: '#b44fff', purpleSoft: 'rgba(124,58,237,0.15)',
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444', divider: 'rgba(255,255,255,0.06)',
};

const FPS_LADDER = [30, 24, 18, 12];
const SOURCE_BITRATE = { free: 3_000_000, lite: 4_500_000, pro: 6_500_000 };

// Compositor layout presets shown in the Layout menu (desktop) + Studio sheet.
const LAYOUT_PRESETS = [
  { id: 'camera', label: 'Camera only', icon: 'videocam' },
  { id: 'screen', label: 'Screen only', icon: 'screen_share' },
  { id: 'screen_cam_pip', label: 'Screen + facecam', icon: 'picture_in_picture' },
  { id: 'cam_screen_pip', label: 'Camera + screen PiP', icon: 'picture_in_picture_alt' },
  { id: 'side_by_side', label: 'Side by side', icon: 'splitscreen' },
];
const PIP_CORNERS = [
  { id: 'tl', label: 'Top left' }, { id: 'tr', label: 'Top right' },
  { id: 'bl', label: 'Bottom left' }, { id: 'br', label: 'Bottom right' },
];
const SCENE_CARDS = [
  { id: 'starting', title: 'Starting soon', subtitle: 'Stream begins shortly' },
  { id: 'brb', title: 'Be right back', subtitle: 'Back in a moment' },
  { id: 'ending', title: 'Thanks for watching', subtitle: 'Stream ending' },
];
// Camera-layer AR effects (on-device MediaPipe segmentation; see
// utils/liveArEffects.js). Ids must match the compositor's LIVE_CAM_FX set.
const CAM_FX_OPTIONS = [
  { id: 'none', label: 'No effect', icon: 'block' },
  { id: 'blur', label: 'Background blur', icon: 'blur_on' },
  { id: 'violet', label: 'Violet backdrop', icon: 'gradient' },
  { id: 'studio', label: 'Studio backdrop', icon: 'texture' },
];

// Colour grades, matching the native camera's "Looks" category so a creator
// gets the same set whether they are posting or live.
const CAM_LOOK_OPTIONS = [
  { id: 'none', label: 'No look' },
  { id: 'warm', label: 'Warm' },
  { id: 'cool', label: 'Cool' },
  { id: 'vivid', label: 'Vivid' },
  { id: 'bright', label: 'Bright' },
  { id: 'punch', label: 'Punch' },
  { id: 'faded', label: 'Fade' },
  { id: 'mono', label: 'Mono' },
  { id: 'noir', label: 'Noir' },
  { id: 'sepia', label: 'Sepia' },
];

// Face masks. Same 3D models the native camera uses.
const CAM_MASK_OPTIONS = [
  { id: 'none', label: 'No mask', icon: 'block' },
  { id: 'shades', label: 'Shades', icon: 'eyeglasses' },
  { id: 'visor', label: 'Helmet', icon: 'sports_motorsports' },
  { id: 'dog', label: 'Dog ears', icon: 'pets' },
  { id: 'tiger', label: 'Tiger', icon: 'pets' },
  { id: 'werewolf', label: 'Werewolf', icon: 'dark_mode' },
  { id: 'alien', label: 'Alien', icon: 'sentiment_neutral' },
  { id: 'spider', label: 'Spider', icon: 'bug_report' },
  { id: 'butterflies', label: 'Butterflies', icon: 'flutter_dash' },
  { id: 'cloud', label: 'Cloud', icon: 'cloud' },
  { id: 'angel', label: 'Angel', icon: 'auto_awesome' },
  { id: 'demon', label: 'Demon', icon: 'local_fire_department' },
];

function isTouchPhone() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
}

export default function BroadcasterScreen() {
  const { streamId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isDesktop } = useResponsive();

  const isCohostQuery = searchParams.get('cohost') === '1';

  // ── Refs ──
  const videoRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const screenStreamRef = useRef(null);   // desktop screen-share, kept alive as a PiP layer
  const ingestSessionRef = useRef(null);
  const compositorRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const meterRafRef = useRef(0);
  const sceneFileInputRef = useRef(null);
  const previewAttachRef = useRef({ el: null, stream: null });
  const stallCountRef = useRef(-1);

  // fps backpressure adaptation refs
  const fpsIdxRef = useRef(0);
  const lastDownAtRef = useRef(0);
  const lastBackpressureAtRef = useRef(0);

  // ── Stream doc ──
  const [streamDoc, setStreamDoc] = useState(null);
  const [streamLoading, setStreamLoading] = useState(true);
  const [buffering, setBuffering] = useState(false);

  // Compositor layout state
  const [layoutMode, setLayoutMode] = useState('camera');
  const [pipCorner, setPipCorner] = useState('br');
  const [scene, setScene] = useState(null);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  // Camera-layer AR effect (background blur/replace via on-device MediaPipe).
  const [camFx, setCamFx] = useState('none');
  const [camLook, setCamLook] = useState('none');
  const [camMask, setCamMask] = useState('none');
  const [mobileStudio, setMobileStudio] = useState(false);
  const [mobileLayoutOpen, setMobileLayoutOpen] = useState(false);

  // Capture state
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [cameraFacing, setCameraFacing] = useState('user');
  const [screenSharing, setScreenSharing] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);

  // Live state
  const [isLive, setIsLive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fsChatOpen, setFsChatOpen] = useState(true);
  const [duration, setDuration] = useState(0);
  const [startedAt, setStartedAt] = useState(null);

  const [bitrateKbps, setBitrateKbps] = useState(0);
  const [chunkLatencyMs, setChunkLatencyMs] = useState(0);
  const [netWarn, setNetWarn] = useState(false);

  // Telemetry
  const [tipEvents, setTipEvents] = useState([]);
  const [startingFollowers, setStartingFollowers] = useState(null);
  const [currentFollowers, setCurrentFollowers] = useState(0);

  // UI
  const [endedStats, setEndedStats] = useState(null);
  const [activeBoost, setActiveBoost] = useState(null);
  const [tipCatalogOpen, setTipCatalogOpen] = useState(false);
  const [bannedWordsOpen, setBannedWordsOpen] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [endConfirm, setEndConfirm] = useState(false);
  const [alertsOn] = useState(true);
  const [pollModalOpen, setPollModalOpen] = useState(false);
  const [editInfoOpen, setEditInfoOpen] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const { poll: streamPoll, closed: streamPollClosed } = useActiveStreamPoll(streamDoc?.hostUid, currentUser?.uid);

  // Mid-stream title/category edit (Twitch-style) — persists to the stream doc
  // so viewers see the update live (their onSnapshot re-renders the channel bar).
  const saveStreamInfo = async ({ title, game }) => {
    if (savingInfo || !streamDoc?.id) return;
    const t = (title || '').trim().slice(0, 140);
    const g = (game || '').trim().slice(0, 60);
    if (!t) { showToast('Title cannot be empty', 'error'); return; }
    setSavingInfo(true);
    try {
      await updateDoc(doc(db, 'streams', streamDoc.id), { title: t, game: g });
      showToast('Stream info updated', 'success');
      setEditInfoOpen(false);
    } catch (err) {
      showToast(err?.message || 'Could not update stream info', 'error');
    } finally { setSavingInfo(false); }
  };

  const rawJoinEvents = useStreamJoinEvents(streamId);
  const joinEvents = useMemo(() => rawJoinEvents.map((e) => ({
    id: e.id, kind: e.kind, tier: e.tier, user: { uid: e.uid, displayName: e.displayName, avatar: e.avatar },
  })), [rawJoinEvents]);

  // Hide the app shell side panel on this screen.
  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  // ── 1) Subscribe to stream doc ──
  useEffect(() => {
    if (!streamId) return;
    return onSnapshot(doc(db, 'streams', streamId), (snap) => {
      setStreamLoading(false);
      if (!snap.exists()) { setStreamDoc(null); return; }
      const data = { id: snap.id, ...snap.data() };
      setStreamDoc(data);
      const sc = data.playbackStalls || 0;
      if (stallCountRef.current < 0) stallCountRef.current = sc;
      else if (sc > stallCountRef.current) { stallCountRef.current = sc; setBuffering(true); }
      if (data.status === 'live' && !isLive) setIsLive(true);
      if (data.status === 'ended' && isLive) setIsLive(false);
      setActiveBoost(data.qualityBoost?.active ? data.qualityBoost : null);
    }, (err) => { console.warn('stream doc subscribe error:', err); setStreamLoading(false); });
  }, [streamId, isLive]);

  // Auto-clear the "viewers may be buffering" warning ~45s after the last climb.
  useEffect(() => {
    if (!buffering) return;
    const t = setTimeout(() => setBuffering(false), 45_000);
    return () => clearTimeout(t);
  }, [buffering]);

  // Native foreground-service bridge while live (no-op on web/PWA).
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.VergrStream : null;
    if (!bridge) return undefined;
    if (isLive) { try { bridge.start(streamDoc?.title || "You're live on VERGR"); } catch {} }
    else { try { bridge.stop(); } catch {} }
    return () => { try { bridge.stop(); } catch {} };
  }, [isLive, streamDoc?.title]);

  // ── 2) Real audio meter ──
  const attachAudioMeter = useCallback((mediaStream) => {
    cancelAnimationFrame(meterRafRef.current);
    try { audioCtxRef.current?.close(); } catch {}
    if (!mediaStream || mediaStream.getAudioTracks().length === 0) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(mediaStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sumSq += v * v; }
      const rms = Math.sqrt(sumSq / buf.length);
      setMicLevel(micOn ? Math.min(100, Math.round(rms * 100 * 2.2)) : 0);
      meterRafRef.current = requestAnimationFrame(tick);
    };
    meterRafRef.current = requestAnimationFrame(tick);
  }, [micOn]);

  // ── 3) Acquire camera + mic (compositor-aware) ──
  const acquireCamera = useCallback(async (facing) => {
    const wantFacing = facing || cameraFacing;
    try {
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: wantFacing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      mediaStreamRef.current = stream;
      stream.getAudioTracks().forEach((t) => (t.enabled = micOn));
      stream.getVideoTracks().forEach((t) => (t.enabled = camOn));
      const comp = compositorRef.current;
      if (comp) {
        comp.setCameraTrack(stream.getVideoTracks()[0]);
        comp.setMicTrack(stream.getAudioTracks()[0]);
        if (videoRef.current) {
          videoRef.current.srcObject = comp.stream;
          previewAttachRef.current = { el: videoRef.current, stream: comp.stream };
          videoRef.current.play().catch(() => {});
        }
      } else if (videoRef.current) {
        videoRef.current.srcObject = stream;
        previewAttachRef.current = { el: videoRef.current, stream };
        videoRef.current.play().catch(() => {});
      }
      setCameraReady(true);
      attachAudioMeter(stream);
    } catch (err) {
      console.warn('getUserMedia failed:', err);
      setCameraReady(false);
      setCamOn(false);
      // Not fatal on desktop: the user can still go live by sharing their screen
      // (gameplay/no-camera streaming). Guide them there instead of erroring.
      showToast(
        isDesktop
          ? 'No camera detected. You can still go live by sharing your screen.'
          : 'Camera/mic permission denied or unavailable.',
        isDesktop ? 'info' : 'error',
      );
    }
  }, [micOn, camOn, cameraFacing, showToast, attachAudioMeter, isDesktop]);

  const flipCamera = () => {
    const next = cameraFacing === 'user' ? 'environment' : 'user';
    setCameraFacing(next);
    acquireCamera(next);
  };

  useEffect(() => {
    acquireCamera();
    return () => {
      try { ingestSessionRef.current?.stop(); } catch {}
      ingestSessionRef.current = null;
      try { compositorRef.current?.stop(); } catch {}
      compositorRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      cancelAnimationFrame(meterRafRef.current);
      try { audioCtxRef.current?.close(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-attach the local preview when a layout switch remounts the <video>.
  useEffect(() => {
    const v = videoRef.current;
    const s = compositorRef.current?.stream || mediaStreamRef.current;
    if (!v || !s) return;
    const a = previewAttachRef.current;
    if (a.el !== v || a.stream !== s) { v.srcObject = s; previewAttachRef.current = { el: v, stream: s }; }
    if (v.paused) v.play().catch(() => {});
  });

  // ── 4) Duration ticker ──
  useEffect(() => {
    if (!isLive || !startedAt) return;
    const id = setInterval(() => setDuration(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [isLive, startedAt]);

  // Liveness heartbeat — while live, stamp streams/{id}.lastHeartbeat every 25s
  // so the server's reapStaleStreams cron can end this stream if the tab/app
  // dies without calling endStreamSession (otherwise it stays stuck "LIVE" in
  // every discovery list). 25s beat vs the cron's 180s stale window leaves room
  // for Chrome's background-tab interval throttling on an alt-tabbed streamer.
  useEffect(() => {
    if (!isLive || !streamDoc?.id) return;
    const ref = doc(db, 'streams', streamDoc.id);
    const ping = () => updateDoc(ref, { lastHeartbeat: serverTimestamp() }).catch(() => {});
    ping();
    const id = setInterval(ping, 25000);
    return () => clearInterval(id);
  }, [isLive, streamDoc?.id]);

  // "Stream to both" recap sampling: while a Twitch-mirrored broadcast is
  // live, poll getTwitchMirrorViewers every 60s — the CF stamps current +
  // peak Twitch viewer counts onto the stream doc for the end-of-stream
  // per-platform recap. Client-driven, so it costs nothing when not mirroring.
  useEffect(() => {
    if (!isLive || !streamDoc?.id || !streamDoc?.twitchMirror) return;
    const poll = () => httpsCallable(getFunctions(undefined, 'europe-west1'), 'getTwitchMirrorViewers')({ streamId: streamDoc.id }).catch(() => {});
    const id = setInterval(poll, 60000);
    const first = setTimeout(poll, 15000); // first sample once the relay is up
    return () => { clearInterval(id); clearTimeout(first); };
  }, [isLive, streamDoc?.id, streamDoc?.twitchMirror]);

  // fps recovery: after 20s with no backpressure, step the frame rate back up.
  const applyFps = useCallback((idx) => {
    const fps = FPS_LADDER[idx];
    const comp = compositorRef.current;
    if (comp?.setTargetFps) { comp.setTargetFps(fps); return; }
    const vt = mediaStreamRef.current?.getVideoTracks?.()[0];
    vt?.applyConstraints?.({ frameRate: { ideal: fps, max: fps } }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => {
      if (Date.now() - lastBackpressureAtRef.current > 20_000 && fpsIdxRef.current > 0) {
        fpsIdxRef.current -= 1;
        applyFps(fpsIdxRef.current);
        if (fpsIdxRef.current === 0) setNetWarn(false);
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [isLive, applyFps]);

  // ── 5) Tips ──
  useEffect(() => {
    if (!streamDoc?.hostUid) return;
    const q = query(collection(db, 'transactions'), where('recipientUid', '==', streamDoc.hostUid), where('type', 'in', ['tip', 'stream_tip']), orderBy('createdAt', 'desc'), limit(30));
    return onSnapshot(q, (snap) => {
      const startMs = startedAt || streamDoc.startedAt?.toMillis?.() || 0;
      const list = snap.docs.map((d) => {
        const v = d.data();
        const ts = v.createdAt?.toMillis?.() || 0;
        return { id: d.id, fromUid: v.senderUid || v.fromUid || 'unknown', fromName: v.senderName || v.fromName || 'Someone', coins: v.coinsAmount || v.amount || 0, ts };
      }).filter((t) => t.ts >= startMs);
      setTipEvents(list);
    }, (err) => console.warn('tips subscribe error:', err));
  }, [streamDoc?.hostUid, startedAt, streamDoc?.startedAt]);

  // ── 6) Followers ──
  useEffect(() => {
    if (!streamDoc?.hostUid) return;
    return onSnapshot(doc(db, 'users', streamDoc.hostUid), (snap) => {
      if (!snap.exists()) return;
      const n = snap.data().followerCount || 0;
      setCurrentFollowers(n);
      if (startingFollowers === null) setStartingFollowers(n);
    });
  }, [streamDoc?.hostUid, startingFollowers]);

  // ── 7) Go live (browser fMP4 ingest, compositor on desktop / Studio) ──
  const startStream = async () => {
    if (starting || isLive || !streamDoc) return;
    if (streamDoc.hostUid !== currentUser?.uid) { showToast('Not your stream.', 'error'); return; }
    setStarting(true);
    try {
      await updateDoc(doc(db, 'streams', streamDoc.id), { status: 'live', startedAt: serverTimestamp() });
      setStartedAt(Date.now());
      setDuration(0);

      const isCoStream = streamDoc.kind === 'co_stream' || isCohostQuery;
      if (!isCoStream && streamDoc.ingestType === 'browser') {
        if (!browserCanIngest()) throw new Error('Your browser cannot do live ingest. Use Chrome 88+ / Safari 18.4+ or OBS.');

        // Source check: a desktop user can go live with screen-share only (no
        // camera). Require at least one source (camera stream, active screen
        // share, or an already-built compositor holding the screen track).
        if (!mediaStreamRef.current && !screenSharing && !compositorRef.current) {
          throw new Error('Add a source first — share your screen or enable your camera.');
        }

        const plan = streamDoc.hostPlan || resolveTier(profile);
        const phone = isTouchPhone();
        const useCompositor = (isDesktop && !phone) ? true : ((phone || !isDesktop) && mobileStudio);
        const aspect = (isDesktop && !phone) ? 'landscape' : 'portrait';

        let ingestStream = mediaStreamRef.current;
        if (useCompositor) {
          const comp = compositorRef.current || createStreamCompositor({ source: mediaStreamRef.current, plan, aspect, layout: 'camera' });
          compositorRef.current = comp;
          ingestStream = comp.stream;
          if (videoRef.current) {
            videoRef.current.srcObject = comp.stream;
            previewAttachRef.current = { el: videoRef.current, stream: comp.stream };
            videoRef.current.play().catch(() => {});
          }
        }

        // Layout hint for viewers: stamp the encoded source aspect so the watch
        // UI (immersive vs split) is right on FIRST paint, before any video
        // metadata. Desktop composites are exactly 16:9; the direct mobile-web
        // camera path is portrait. Real metadata still wins in the player.
        updateDoc(doc(db, 'streams', streamDoc.id), {
          sourceAspect: aspect === 'landscape' ? 1.778 : 0.5625,
        }).catch(() => {});

        fpsIdxRef.current = 0; lastDownAtRef.current = 0; lastBackpressureAtRef.current = 0; setNetWarn(false);

        const planTier = typeof plan === 'string' ? plan : (plan?.tier || 'free');
        let videoBitrate = SOURCE_BITRATE[planTier] || SOURCE_BITRATE.free;
        // Pre-flight uplink probe: cap STARTING bitrate to ~60% of measured uplink.
        try {
          const up = await probeUplink({ streamKey: streamDoc.streamKey, ingestBase: streamDoc.ingestUrl });
          if (up) {
            const cap = Math.floor(up * 1000 * 0.6);
            if (cap < videoBitrate) {
              videoBitrate = Math.max(600_000, cap);
              setNetWarn(true);
              if (videoBitrate <= 1_200_000) { fpsIdxRef.current = 1; applyFps(1); }
            }
          }
        } catch {}

        const session = await startBrowserIngest({
          streamKey: streamDoc.streamKey,
          mediaStream: ingestStream,
          plan,
          videoBitrate,
          ingestBase: streamDoc.ingestUrl,
          onChunkSent: (_seq, ms, bytes) => { setChunkLatencyMs(ms); if (bytes > 0) setBitrateKbps(Math.round((bytes * 8) / 1000)); },
          onBackpressure: (depth) => {
            lastBackpressureAtRef.current = Date.now();
            if (depth < 2) return;
            const now = Date.now();
            if (now - lastDownAtRef.current < 4000) return;
            if (fpsIdxRef.current < FPS_LADDER.length - 1) {
              fpsIdxRef.current += 1; applyFps(fpsIdxRef.current); lastDownAtRef.current = now; setNetWarn(true);
            }
          },
          onError: (err) => { console.error('ingest error:', err); showToast(err.message || 'Stream upload failed', 'error'); endStream().catch(() => {}); },
          onEnded: (reason) => console.log('ingest ended:', reason),
        });
        ingestSessionRef.current = session;
      }
      setIsLive(true);
    } catch (err) {
      showToast(err?.message || 'Could not go live.', 'error');
    } finally {
      setStarting(false);
    }
  };

  // ── 8) End stream ──
  const endStream = async () => {
    if (ending) return;
    setEnding(true);
    try {
      if (ingestSessionRef.current) {
        try { await ingestSessionRef.current.stop(); } catch (e) { console.warn('ingest stop:', e); }
        ingestSessionRef.current = null;
      }
      try { compositorRef.current?.stop(); } catch {}
      compositorRef.current = null;
      if (streamDoc?.id) {
        const r = await httpsCallable(getFunctions(undefined, 'europe-west1'), 'endStreamSession')({ streamId: streamDoc.id });
        if (r.data?.refunded) showToast('Boost refunded — your tips covered the fee!', 'success');
      }
      const tipCoins = tipEvents.reduce((s, t) => s + (t.coins || 0), 0);
      const tipperMap = {};
      tipEvents.forEach((t) => { const k = t.fromUid || t.fromName || 'anon'; if (!tipperMap[k]) tipperMap[k] = { name: t.fromName || 'Someone', coins: 0 }; tipperMap[k].coins += t.coins || 0; });
      const topTippers = Object.values(tipperMap).sort((a, b) => b.coins - a.coins).slice(0, 3);
      setEndedStats({
        streamId: streamDoc?.id, title: streamDoc?.title || 'Live stream', duration,
        peakViewers: streamDoc?.peakViewers || 0, tipCoins, tipCount: tipEvents.length, topTippers,
        goal: streamDoc?.goal?.active ? streamDoc.goal : null,
        newFollowers: Math.max(0, currentFollowers - (startingFollowers || currentFollowers)),
        boosted: !!streamDoc?.boosted,
        // Per-platform recap for "stream to both" (Twitch mirror): peak counts
        // sampled during the broadcast via getTwitchMirrorViewers.
        mirrored: !!streamDoc?.twitchMirror,
        twitchPeakViewers: streamDoc?.twitchPeakViewers || 0,
      });
      setIsLive(false);
    } catch (err) {
      showToast(err?.message || 'End-stream failed', 'error');
    } finally {
      setEnding(false);
    }
  };

  const toggleMic = () => setMicOn((v) => { const next = !v; mediaStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next)); return next; });
  const toggleCam = () => setCamOn((v) => { const next = !v; mediaStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next)); return next; });

  // Re-feed the camera into the compositor after a screen-share ends.
  const recomposeCamera = () => {
    const comp = compositorRef.current;
    const ms = mediaStreamRef.current;
    if (!comp || !ms) return;
    comp.setCameraTrack(ms.getVideoTracks()[0]);
    comp.setMicTrack(ms.getAudioTracks()[0]);
  };

  // Create the compositor on first Layout/Screen/scene touch (desktop only),
  // so layout setup + composite preview work BEFORE going live.
  const ensureCompositor = () => {
    if (compositorRef.current) return compositorRef.current;
    // Allow a compositor with NO camera (screen-share-only / gameplay streaming).
    // createStreamCompositor handles a null source; we seed the screen track next.
    if (!isDesktop || isTouchPhone()) return null;
    const plan = streamDoc?.hostPlan || resolveTier(profile);
    const comp = createStreamCompositor({ source: mediaStreamRef.current || null, plan, aspect: 'landscape', layout: mediaStreamRef.current ? 'camera' : 'screen' });
    compositorRef.current = comp;
    if (videoRef.current) {
      videoRef.current.srcObject = comp.stream;
      previewAttachRef.current = { el: videoRef.current, stream: comp.stream };
      videoRef.current.play().catch(() => {});
    }
    return comp;
  };

  const stopScreenShare = () => {
    try { screenStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    screenStreamRef.current = null;
    setScreenSharing(false);
    const comp = compositorRef.current;
    if (comp) { comp.setScreenTrack(null); comp.setSystemAudio(null); comp.setLayout('camera'); }
    setLayoutMode('camera');
  };

  const toggleScreen = async () => {
    let comp = compositorRef.current;
    if (screenSharing) {
      if (comp) { stopScreenShare(); return; }
      // non-composited fallback: drop back to the camera stream
      setScreenSharing(false);
      await acquireCamera();
      recomposeCamera();
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: true });
      if (!comp) comp = ensureCompositor();
      if (comp) {
        screenStreamRef.current = display;
        comp.setScreenTrack(display.getVideoTracks()[0]);
        comp.setSystemAudio(display.getAudioTracks()[0] || null);
        // With a camera: Twitch-style screen + facecam PiP. Without one
        // (gameplay/no-camera): full-frame screen, no empty PiP box.
        const hasCam = cameraReady && !!mediaStreamRef.current?.getVideoTracks?.().length;
        comp.setLayout(hasCam ? { mode: 'screen_cam_pip', corner: pipCorner } : { mode: 'screen' });
        setLayoutMode(hasCam ? 'screen_cam_pip' : 'screen');
        setScreenSharing(true);
        if (videoRef.current) {
          videoRef.current.srcObject = comp.stream;
          previewAttachRef.current = { el: videoRef.current, stream: comp.stream };
          videoRef.current.play().catch(() => {});
        }
        display.getVideoTracks()[0].addEventListener('ended', () => stopScreenShare());
        return;
      }
      // No compositor (older browser): swap raw tracks.
      const mic = mediaStreamRef.current?.getAudioTracks()?.[0];
      const mixed = new MediaStream();
      display.getVideoTracks().forEach((t) => mixed.addTrack(t));
      if (mic) mixed.addTrack(mic);
      mediaStreamRef.current?.getVideoTracks().forEach((t) => t.stop());
      mediaStreamRef.current = mixed;
      if (videoRef.current) {
        videoRef.current.srcObject = mixed;
        previewAttachRef.current = { el: videoRef.current, stream: mixed };
        videoRef.current.play().catch(() => {});
      }
      setScreenSharing(true);
      display.getVideoTracks()[0].addEventListener('ended', () => { setScreenSharing(false); acquireCamera(); });
    } catch (err) {
      console.warn('screen share failed:', err);
    }
  };

  const applyLayout = async (mode) => {
    const comp = ensureCompositor();
    if (!comp) { showToast('Layouts are available on desktop streams (or mobile Studio mode).', 'info'); return; }
    const needsScreen = mode === 'screen' || mode === 'screen_cam_pip' || mode === 'cam_screen_pip' || mode === 'side_by_side';
    if (needsScreen && !screenStreamRef.current) {
      await toggleScreen();
      if (!screenStreamRef.current) return; // user cancelled the picker
    }
    comp.setScene(null);
    setScene(null);
    comp.setLayout({ mode, corner: pipCorner });
    setLayoutMode(mode);
  };

  const applyCorner = (corner) => {
    setPipCorner(corner);
    compositorRef.current?.setLayout({ corner });
  };

  const applyScene = (sceneId) => {
    const comp = ensureCompositor();
    if (!comp) { showToast('Scenes need Studio mode (turn it on before going live).', 'info'); return; }
    const card = SCENE_CARDS.find((s) => s.id === sceneId) || null;
    comp.setScene(card);
    setScene(sceneId);
  };

  // AR camera effect for the live camera layer. Baked into the composited
  // canvas, so every viewer sees it with zero extra server cost.
  const applyCameraFx = (fx) => {
    const comp = ensureCompositor();
    if (!comp) { showToast('Effects need Studio mode on mobile (or a desktop stream).', 'info'); return; }
    comp.setCameraEffect(fx);
    setCamFx(fx);
  };

  const applyCameraLook = (look) => {
    const comp = ensureCompositor();
    if (!comp) { showToast('Effects need Studio mode on mobile (or a desktop stream).', 'info'); return; }
    comp.setCameraLook(look);
    setCamLook(look);
  };

  const applyCameraMask = (mask) => {
    const comp = ensureCompositor();
    if (!comp) { showToast('Effects need Studio mode on mobile (or a desktop stream).', 'info'); return; }
    comp.setCameraMask(mask);
    setCamMask(mask);
  };

  const onSceneFile = (file) => {
    if (!file) return;
    const comp = ensureCompositor();
    if (!comp) { showToast('Scenes need Studio mode (turn it on before going live).', 'info'); return; }
    const url = URL.createObjectURL(file);
    if (file.type.startsWith('video')) {
      const vid = document.createElement('video');
      vid.src = url; vid.loop = true; vid.muted = true; vid.playsInline = true; vid.autoplay = true;
      vid.play().catch(() => {});
      comp.setScene({ media: vid });
    } else {
      const img = new Image();
      img.src = url;
      img.onload = () => comp.setScene({ media: img });
    }
    setScene('custom');
  };

  // Mobile dual-camera (Studio): rear feeds the base layer, front feeds the PiP.
  const enableDualCamera = async () => {
    const comp = ensureCompositorMobile();
    if (!comp) { showToast('Turn on Studio first.', 'info'); return; }
    try {
      const rear = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: 'environment' } } });
      comp.setScreenTrack(rear.getVideoTracks()[0]); // rear as the "screen"/base layer
      screenStreamRef.current = rear;
      comp.setLayout({ mode: 'screen_cam_pip', corner: pipCorner });
      setLayoutMode('screen_cam_pip');
    } catch {
      showToast('This device cannot use two cameras at once.', 'info');
    }
  };

  // Mobile Studio compositor (portrait) — only created when Studio is ON.
  const ensureCompositorMobile = () => {
    if (compositorRef.current) return compositorRef.current;
    if (!mobileStudio || !mediaStreamRef.current) return null;
    const plan = streamDoc?.hostPlan || resolveTier(profile);
    const comp = createStreamCompositor({ source: mediaStreamRef.current, plan, aspect: 'portrait', layout: 'camera' });
    compositorRef.current = comp;
    if (videoRef.current) {
      videoRef.current.srcObject = comp.stream;
      previewAttachRef.current = { el: videoRef.current, stream: comp.stream };
      videoRef.current.play().catch(() => {});
    }
    return comp;
  };

  const fmtTime = (s) => {
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${hh ? String(hh).padStart(2, '0') + ':' : ''}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };

  const tipCoins = useMemo(() => tipEvents.reduce((s, t) => s + (t.coins || 0), 0), [tipEvents]);
  const followerDelta = startingFollowers === null ? 0 : Math.max(0, currentFollowers - startingFollowers);

  // ── Clip ("clip my own moment") ──
  const CLIP_TIER = { free: { sec: 30, max: 3 }, lite: { sec: 60, max: 5 }, pro: { sec: 90, max: Infinity } };
  const hostPlan = streamDoc?.hostPlan || 'free';
  const clipCfg = CLIP_TIER[hostPlan] || CLIP_TIER.free;
  const browserIngest = streamDoc?.ingestType === 'browser';
  const { grab: grabClip, isSupported: clipSupported } = useStreamClipBuffer(videoRef, { enabled: browserIngest && isLive });
  const [clipsUsed, setClipsUsed] = useState(0);
  const [clipping, setClipping] = useState(false);

  const publishClip = useCallback(async (url) => {
    await createPost(currentUser.uid, { type: 'clip', mediaUrls: [url], content: streamDoc?.title ? `Clip from "${streamDoc.title}"` : 'Stream clip', game: streamDoc?.game || null, hashtags: streamDoc?.game ? [String(streamDoc.game).toLowerCase()] : [], visibility: 'public' });
  }, [currentUser?.uid, streamDoc?.title]);

  const handleClip = useCallback(async () => {
    if (clipping || !currentUser?.uid) return;
    if (!isLive) { showToast('Go live first to clip a moment.', 'info'); return; }
    if (clipsUsed >= clipCfg.max) { showToast(`Clip limit reached (${clipCfg.max} per stream on ${hostPlan}).`, 'info'); return; }
    setClipping(true);
    try {
      if (browserIngest && clipSupported()) {
        const blob = grabClip(clipCfg.sec);
        if (blob && blob.size >= 50_000) {
          const file = new File([blob], `clip-${Date.now()}.webm`, { type: 'video/webm' });
          const { url } = await uploadToR2(file, 'clip');
          await publishClip(url);
          setClipsUsed((n) => n + 1);
          showToast('Clip saved to your profile.', 'success');
          return;
        }
      }
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'requestStreamClip');
      const { data } = await fn({ streamId: streamDoc?.id, durationSec: clipCfg.sec });
      if (!data?.clipUrl) throw new Error('Clip failed — try again in a few seconds.');
      await publishClip(data.clipUrl);
      setClipsUsed((n) => n + 1);
      showToast('Clip saved to your profile.', 'success');
    } catch (err) { showToast(err?.message || 'Clip failed', 'error'); } finally { setClipping(false); }
  }, [clipping, currentUser?.uid, isLive, clipsUsed, clipCfg, hostPlan, browserIngest, clipSupported, grabClip, streamDoc?.id, publishClip, showToast]);

  // ── Guards ──
  if (streamLoading) return <FullCenter label="Loading stream…" />;
  if (!streamDoc) return <FullCenter label="This stream doesn't exist." action={{ label: 'Back to Go Live', onClick: () => navigate('/go-live') }} />;
  if (streamDoc.hostUid !== currentUser?.uid) return <FullCenter label="You're not the host of this stream." action={{ label: 'Watch instead', onClick: () => navigate(`/watch/${streamDoc.id}`) }} />;
  if (endedStats) return <StreamSummary stats={endedStats} onClose={() => navigate('/')} />;

  const mobileImmersive = !isDesktop || isTouchPhone();
  const stability = chunkLatencyMs === 0 ? '—' : chunkLatencyMs < 600 ? 'Excellent' : chunkLatencyMs < 1500 ? 'Good' : 'Poor';
  const stabilityColor = stability === 'Excellent' ? C.green : stability === 'Good' ? C.amber : stability === '—' ? C.textMuted : C.red;

  const hiddenSceneInput = (
    <input ref={sceneFileInputRef} type="file" accept="image/*,image/gif,video/*" style={{ display: 'none' }}
      onChange={(e) => { const f = e.target.files?.[0]; if (f) onSceneFile(f); e.target.value = ''; }} />
  );

  // ────────────────────────────────────────────────────────────
  // MOBILE PORTRAIT IMMERSIVE LAYOUT
  // ────────────────────────────────────────────────────────────
  if (mobileImmersive) {
    const composerExtras = (
      <>
        <DockBtn icon={micOn ? 'mic' : 'mic_off'} danger={!micOn} onClick={toggleMic} label="Mic" />
        <DockBtn icon={camOn ? 'videocam' : 'videocam_off'} danger={!camOn} onClick={toggleCam} label="Camera" />
        <DockBtn icon="more_horiz" onClick={() => setMoreOpen(true)} label="More" />
      </>
    );
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden', color: C.text, fontFamily: '"Inter","DM Sans",system-ui,sans-serif', zIndex: 90 }}>
        <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />

        {/* Top overlay */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '12px 12px 24px', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)', background: 'linear-gradient(180deg, rgba(0,0,0,0.7), transparent)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {isLive ? <LivePill /> : <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{streamDoc.title || 'Live stream'}</span>}
          {isLive && <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: 'DM Mono, ui-monospace, monospace' }}>{fmtTime(duration)}</span>}
          {isLive && <HypeMeter streamId={streamId} mode="compact" />}
          <div style={{ flex: 1 }} />
          {isLive && <span style={statChip(C.amber)}><Icon name="paid" size={12} />{tipCoins}</span>}
          {isLive && followerDelta > 0 && <span style={statChip(C.purpleLight)}><Icon name="person_add" size={12} />+{followerDelta}</span>}
          <span style={statChip('#fff')}><Icon name="visibility" size={12} />{streamDoc.viewerCount || 0}</span>
          <button onClick={() => { if (isLive) setEndConfirm(true); else navigate(-1); }} aria-label={isLive ? 'End stream' : 'Back'} style={roundBtn}><Icon name="close" size={18} /></button>
        </div>

        {netWarn && isLive && (
          <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 58px)', left: 12, ...warnPill }}>
            <Icon name="signal_cellular_alt" size={13} /> Quality lowered to keep you live
          </div>
        )}

        {/* Right action rail */}
        <div style={{ position: 'absolute', right: 10, top: '38%', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', zIndex: 7 }}>
          <ActionPill icon="cameraswitch" onClick={flipCamera} active={cameraFacing === 'environment'} />
          {mobileStudio && <ActionPill icon="dashboard_customize" onClick={() => setMobileLayoutOpen(true)} active={mobileLayoutOpen} />}
          <ActionPill icon="content_cut" onClick={handleClip} />
          <ActionPill icon="poll" active={!!streamPoll && !streamPollClosed} onClick={() => { if (!isLive) { showToast('Go live first to start a poll.', 'info'); return; } setPollModalOpen(true); }} />
          <ActionPill icon="share" onClick={() => setShareOpen(true)} />
        </div>

        {/* Bottom dock */}
        <div style={{ position: 'absolute', left: 10, right: 10, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 10px)', display: 'flex', flexDirection: 'column', gap: 8, zIndex: 8 }}>
          {streamPoll && <div style={{ maxWidth: 320 }}><StreamPollCard poll={streamPoll} closed={streamPollClosed} uid={currentUser?.uid} compact /></div>}
          {isLive && streamDoc.goal?.active && <div style={{ maxWidth: 360 }}><StreamGoalBar goal={streamDoc.goal} compact /></div>}
          {isLive ? (
            <div style={{ height: '28vh', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <ChatPanel streamId={streamDoc.id} layout="overlay" hostUid={streamDoc.hostUid} slowModeSec={streamDoc.slowModeSec || 0} followersOnly={!!streamDoc.followersOnly} pinnedMessage={streamDoc.pinnedMessage || null} composerExtras={composerExtras} />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <DockBtn icon={micOn ? 'mic' : 'mic_off'} danger={!micOn} onClick={toggleMic} label="Mic" />
                <DockBtn icon={camOn ? 'videocam' : 'videocam_off'} danger={!camOn} onClick={toggleCam} label="Camera" />
                <DockBtn icon="flip_camera_android" onClick={flipCamera} label="Flip camera" />
                <div style={{ flex: 1 }} />
                <AudioMeter level={micLevel} compact />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setMobileStudio((v) => !v)} title="Studio: dual camera + scene cards" style={{ padding: '14px 12px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${mobileStudio ? C.purple : C.border}`, background: mobileStudio ? C.purpleSoft : 'rgba(255,255,255,0.06)', color: mobileStudio ? C.purpleLight : '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                  <Icon name="dashboard_customize" size={16} /> Studio
                </button>
                <button onClick={startStream} disabled={starting || (!cameraReady && !screenSharing)} style={{ flex: 1, padding: 15, borderRadius: 14, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer', opacity: starting || (!cameraReady && !screenSharing) ? 0.6 : 1 }}>
                  {starting ? 'Starting…' : 'Start Stream'}
                </button>
              </div>
            </div>
          )}
        </div>

        {alertsOn && <TipAlertOverlay lastTip={streamDoc.lastTip} anchor="top" />}
        {alertsOn && <SubAlertOverlay lastSub={streamDoc.lastSub} anchor="top" />}
        {pollModalOpen && <CreateStreamPollModal hostUid={streamDoc.hostUid} streamId={streamDoc.id} onClose={() => setPollModalOpen(false)} showToast={showToast} />}
        <JoinAnnouncer events={joinEvents} side="left" bottom="calc(env(safe-area-inset-bottom, 0px) + 28vh + 24px)" />
        {hiddenSceneInput}

        {/* Studio layout sheet */}
        <AnimatePresence>
          {mobileLayoutOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileLayoutOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end' }}>
              <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 38 }} style={{ width: '100%', background: C.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '14px 14px calc(env(safe-area-inset-bottom,0px) + 14px)' }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.textDim, marginBottom: 10 }}>Studio layout</div>
                <SheetRow icon="videocam" label="Camera only" onClick={() => { applyLayout('camera'); setMobileLayoutOpen(false); }} />
                <SheetRow icon="picture_in_picture" label="Dual camera (selfie over rear)" onClick={() => { enableDualCamera(); setMobileLayoutOpen(false); }} />
                {SCENE_CARDS.map((s) => <SheetRow key={s.id} icon="image" label={`Scene · ${s.title}`} onClick={() => { applyScene(s.id); setMobileLayoutOpen(false); }} />)}
                {CAM_FX_OPTIONS.map((f) => <SheetRow key={f.id} icon={f.icon} label={`Effect · ${f.label}`} onClick={() => { applyCameraFx(f.id); setMobileLayoutOpen(false); }} />)}
                {CAM_MASK_OPTIONS.map((m) => <SheetRow key={m.id} icon={m.icon} label={`Mask · ${m.label}`} onClick={() => { applyCameraMask(m.id); setMobileLayoutOpen(false); }} />)}
                {CAM_LOOK_OPTIONS.map((l) => <SheetRow key={l.id} icon='palette' label={`Look · ${l.label}`} onClick={() => { applyCameraLook(l.id); setMobileLayoutOpen(false); }} />)}
                <SheetRow icon="upload" label="Upload scene (image / GIF / video)" onClick={() => { sceneFileInputRef.current?.click(); setMobileLayoutOpen(false); }} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* More sheet */}
        <AnimatePresence>
          {moreOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMoreOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60 }}>
              <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 38 }} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: C.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '14px 14px calc(env(safe-area-inset-bottom,0px) + 14px)' }}>
                <SheetRow icon="edit" label="Edit title / category" onClick={() => { setMoreOpen(false); setEditInfoOpen(true); }} />
                <SheetRow icon="poll" label={streamPoll && !streamPollClosed ? 'Poll running' : 'Start a poll'} onClick={() => { setMoreOpen(false); if (!isLive) { showToast('Go live first to start a poll.', 'info'); return; } setPollModalOpen(true); }} />
                <SheetRow icon="content_cut" label="Clip the last moment" onClick={() => { setMoreOpen(false); handleClip(); }} />
                <SheetRow icon="volunteer_activism" label="Tip catalog" onClick={() => { setMoreOpen(false); setTipCatalogOpen(true); }} />
                <SheetRow icon="block" label="Banned words" onClick={() => { setMoreOpen(false); setBannedWordsOpen(true); }} />
                <SheetRow icon="share" label="Share stream" onClick={() => { setMoreOpen(false); setShareOpen(true); }} />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* End-stream confirm */}
        <AnimatePresence>
          {endConfirm && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEndConfirm(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <motion.div onClick={(e) => e.stopPropagation()} initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={{ width: 'min(320px, 100%)', background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>End the stream?</div>
                <div style={{ fontSize: 12, color: C.textDim, marginBottom: 16 }}>Your viewers will see the stream end immediately.</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setEndConfirm(false)} style={{ flex: 1, padding: 12, borderRadius: 10, border: `1px solid ${C.border}`, background: 'transparent', color: C.textDim, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Keep going</button>
                  <button onClick={() => { setEndConfirm(false); endStream(); }} disabled={ending} style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: C.red, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', opacity: ending ? 0.6 : 1 }}>{ending ? 'Ending…' : 'End stream'}</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {shareOpen && <StreamShareSheet streamId={streamDoc.id} streamTitle={streamDoc.title} hostName={profile?.displayName || profile?.username || streamDoc.hostUsername} live={isLive} onClose={() => setShareOpen(false)} />}
        {tipCatalogOpen && <TipCatalogEditor onClose={() => setTipCatalogOpen(false)} />}
        {bannedWordsOpen && <BannedWordsEditor streamId={streamDoc.id} onClose={() => setBannedWordsOpen(false)} />}
        {editInfoOpen && <EditInfoModal title={streamDoc.title} game={streamDoc.game} saving={savingInfo} onSave={saveStreamInfo} onClose={() => setEditInfoOpen(false)} />}
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────
  // DESKTOP FRAMED STUDIO LAYOUT
  // ────────────────────────────────────────────────────────────
  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: '"Inter","DM Sans",system-ui,sans-serif', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 14, padding: 16 }}>
        {/* LEFT: preview + controls */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#000', borderRadius: 14, overflow: 'hidden', border: `1px solid ${C.border}` }}>
            <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />

            {/* Top overlay: LIVE / duration / hype / stats */}
            <div style={{ position: 'absolute', top: 12, left: 12, right: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              {isLive ? <LivePill /> : <span style={{ fontSize: 12, fontWeight: 800, color: 'rgba(255,255,255,0.85)' }}>PREVIEW</span>}
              {isLive && <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: 'DM Mono, ui-monospace, monospace' }}>{fmtTime(duration)}</span>}
              {isLive && <HypeMeter streamId={streamId} mode="compact" />}
              <div style={{ flex: 1 }} />
              {isLive && <span style={statChip(C.amber)}><Icon name="paid" size={12} />{tipCoins}</span>}
              {isLive && followerDelta > 0 && <span style={statChip(C.purpleLight)}><Icon name="person_add" size={12} />+{followerDelta}</span>}
              <span style={statChip('#fff')}><Icon name="visibility" size={12} />{streamDoc.viewerCount || 0}</span>
            </div>

            {netWarn && isLive && <div style={{ position: 'absolute', top: 48, left: 12, ...warnPill }}><Icon name="signal_cellular_alt" size={13} /> Quality lowered to keep you live</div>}
            {buffering && <div style={{ position: 'absolute', top: 48, right: 12, ...warnPill }}><Icon name="warning" size={13} /> Viewers may be buffering</div>}

            {isLive && streamDoc.goal?.active && <div style={{ position: 'absolute', left: 12, right: 12, bottom: 12 }}><StreamGoalBar goal={streamDoc.goal} /></div>}
            {alertsOn && <TipAlertOverlay lastTip={streamDoc.lastTip} anchor="top" />}
            {alertsOn && <SubAlertOverlay lastSub={streamDoc.lastSub} anchor="top" />}
          </div>

          {/* Control bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}>
            <CtrlBtn icon={micOn ? 'mic' : 'mic_off'} label="Mic" active={micOn} danger={!micOn} onClick={toggleMic} />
            <CtrlBtn icon={camOn ? 'videocam' : 'videocam_off'} label="Camera" active={camOn} danger={!camOn} onClick={toggleCam} />
            <CtrlBtn icon="screen_share" label={screenSharing ? 'Stop share' : 'Share screen'} active={screenSharing} onClick={toggleScreen} />
            <div style={{ position: 'relative' }}>
              <CtrlBtn icon="dashboard_customize" label="Layout" active={layoutMenuOpen} onClick={() => { ensureCompositor(); setLayoutMenuOpen((v) => !v); }} />
              {layoutMenuOpen && (
                <LayoutMenu
                  layoutMode={layoutMode} pipCorner={pipCorner} scene={scene} camFx={camFx} camLook={camLook} camMask={camMask}
                  onLayout={(m) => applyLayout(m)} onCorner={applyCorner}
                  onScene={applyScene} onUploadScene={() => sceneFileInputRef.current?.click()}
                  onCamFx={applyCameraFx} onCamLook={applyCameraLook} onCamMask={applyCameraMask}
                  onClose={() => setLayoutMenuOpen(false)}
                />
              )}
            </div>
            <CtrlBtn icon="content_cut" label="Clip" onClick={handleClip} />
            <CtrlBtn icon="poll" label="Poll" active={!!streamPoll && !streamPollClosed} onClick={() => { if (!isLive) { showToast('Go live first to start a poll.', 'info'); return; } setPollModalOpen(true); }} />
            <CtrlBtn icon="volunteer_activism" label="Tips" onClick={() => setTipCatalogOpen(true)} />
            <CtrlBtn icon="block" label="Words" onClick={() => setBannedWordsOpen(true)} />
            <CtrlBtn icon="share" label="Share" onClick={() => setShareOpen(true)} />
            <div style={{ flex: 1, minWidth: 12 }} />
            <AudioMeter level={micLevel} />
            {!isLive ? (
              <button onClick={startStream} disabled={starting || (!cameraReady && !screenSharing)} style={{ padding: '12px 22px', borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: starting || (!cameraReady && !screenSharing) ? 0.6 : 1 }}>
                {starting ? 'Starting…' : 'Go Live'}
              </button>
            ) : (
              <button onClick={() => setEndConfirm(true)} disabled={ending} style={{ padding: '12px 22px', borderRadius: 12, border: 'none', background: C.red, color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: ending ? 0.6 : 1 }}>
                {ending ? 'Ending…' : 'End Stream'}
              </button>
            )}
          </div>

          {/* Stream info + edit (title / category, editable mid-stream) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 14px' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{streamDoc.title || 'Untitled stream'}</div>
              <div style={{ fontSize: 12, color: C.purpleLight, fontWeight: 700, marginTop: 2 }}>{streamDoc.game || 'No category set'}</div>
            </div>
            <button onClick={() => setEditInfoOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.cardSoft, color: C.text, fontSize: 12, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
              <Icon name="edit" size={14} /> Edit info
            </button>
          </div>

          {/* Status strip */}
          {isLive && (
            <div style={{ display: 'flex', gap: 14, fontSize: 12, color: C.textDim, padding: '0 4px' }}>
              <span>Bitrate <b style={{ color: C.text, fontFamily: 'DM Mono, monospace' }}>{bitrateKbps ? `${bitrateKbps} kbps` : '—'}</b></span>
              <span>Stability <b style={{ color: stabilityColor }}>{stability}</b></span>
              {activeBoost && <span style={{ color: C.amber }}>Boosted</span>}
            </div>
          )}
        </div>

        {/* RIGHT: chat */}
        <div style={{ width: 340, flexShrink: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', color: C.textDim }}>LIVE CHAT</div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ChatPanel streamId={streamDoc.id} layout="side" hostUid={streamDoc.hostUid} slowModeSec={streamDoc.slowModeSec || 0} followersOnly={!!streamDoc.followersOnly} pinnedMessage={streamDoc.pinnedMessage || null} />
          </div>
        </div>
      </div>

      {pollModalOpen && <CreateStreamPollModal hostUid={streamDoc.hostUid} streamId={streamDoc.id} onClose={() => setPollModalOpen(false)} showToast={showToast} />}
      <JoinAnnouncer events={joinEvents} side="right" />
      {hiddenSceneInput}

      {/* End-stream confirm (desktop) */}
      <AnimatePresence>
        {endConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEndConfirm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <motion.div onClick={(e) => e.stopPropagation()} initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={{ width: 'min(340px, 100%)', background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>End the stream?</div>
              <div style={{ fontSize: 12, color: C.textDim, marginBottom: 16 }}>Your viewers will see the stream end immediately.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setEndConfirm(false)} style={{ flex: 1, padding: 12, borderRadius: 10, border: `1px solid ${C.border}`, background: 'transparent', color: C.textDim, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Keep going</button>
                <button onClick={() => { setEndConfirm(false); endStream(); }} disabled={ending} style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: C.red, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', opacity: ending ? 0.6 : 1 }}>{ending ? 'Ending…' : 'End stream'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {shareOpen && <StreamShareSheet streamId={streamDoc.id} streamTitle={streamDoc.title} hostName={profile?.displayName || profile?.username || streamDoc.hostUsername} live={isLive} onClose={() => setShareOpen(false)} />}
      {tipCatalogOpen && <TipCatalogEditor onClose={() => setTipCatalogOpen(false)} />}
      {bannedWordsOpen && <BannedWordsEditor streamId={streamDoc.id} onClose={() => setBannedWordsOpen(false)} />}
      {editInfoOpen && <EditInfoModal title={streamDoc.title} game={streamDoc.game} saving={savingInfo} onSave={saveStreamInfo} onClose={() => setEditInfoOpen(false)} />}
    </div>
  );
}

// ── subcomponents ──
function EditInfoModal({ title, game, saving, onSave, onClose }) {
  const [t, setT] = useState(title || '');
  const [g, setG] = useState(game || '');
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 210, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(440px, 100%)', background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, color: C.text, fontFamily: '"Inter","DM Sans",system-ui,sans-serif' }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 14 }}>Edit stream info</div>
        <label style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: C.textDim }}>TITLE</label>
        <input value={t} maxLength={140} onChange={(e) => setT(e.target.value)} placeholder="What are you streaming?"
          style={{ width: '100%', boxSizing: 'border-box', margin: '6px 0 14px', background: C.cardSoft, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, color: C.text, fontSize: 14, outline: 'none' }} />
        <label style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: C.textDim }}>CATEGORY / GAME</label>
        <input value={g} maxLength={60} onChange={(e) => setG(e.target.value)} placeholder="e.g. Counter-Strike 2"
          style={{ width: '100%', boxSizing: 'border-box', margin: '6px 0 18px', background: C.cardSoft, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, color: C.text, fontSize: 14, outline: 'none' }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={saving} style={{ flex: 1, padding: 13, borderRadius: 10, border: `1px solid ${C.border}`, background: 'transparent', color: C.textDim, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => onSave({ title: t, game: g })} disabled={saving} style={{ flex: 2, padding: 13, borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
const roundBtn = { width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 };
const warnPill = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, background: 'rgba(240,165,0,0.92)', color: '#1a1205', fontSize: 11, fontWeight: 800, zIndex: 9 };

function statChip(color) {
  return { display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '4px 9px', borderRadius: 999, background: 'rgba(0,0,0,0.45)', color, fontSize: 11, fontWeight: 800, fontFamily: 'DM Mono, ui-monospace, monospace' };
}

function LivePill() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: C.red, fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.08em' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />LIVE
    </span>
  );
}

function ActionPill({ icon, label, onClick, active = false }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} style={{ width: 46, height: 46, borderRadius: '50%', border: 'none', flexShrink: 0, background: active ? C.purpleSoft : 'rgba(0,0,0,0.45)', color: active ? C.purpleLight : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
      <Icon name={icon} size={21} />
    </button>
  );
}

function CtrlBtn({ icon, label, onClick, active = false, danger = false }) {
  return (
    <button type="button" onClick={onClick} title={label} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '6px 10px', borderRadius: 10, border: `1px solid ${active ? C.purple : C.border}`, background: danger ? 'rgba(239,68,68,0.18)' : active ? C.purpleSoft : C.cardSoft, color: danger ? C.red : active ? C.purpleLight : C.text, cursor: 'pointer', minWidth: 58 }}>
      <Icon name={icon} size={18} />
      <span style={{ fontSize: 10, fontWeight: 700 }}>{label}</span>
    </button>
  );
}

function DockBtn({ icon, onClick, label, danger = false }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} style={{ width: 42, height: 42, borderRadius: '50%', border: 'none', flexShrink: 0, background: danger ? 'rgba(239,68,68,0.35)' : 'rgba(0,0,0,0.45)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
      <Icon name={icon} size={20} />
    </button>
  );
}

function SheetRow({ icon, label, onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '13px 12px', borderRadius: 12, border: 'none', marginBottom: 6, background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>
      <Icon name={icon} size={18} />{label}
    </button>
  );
}

function LayoutMenu({ layoutMode, pipCorner, scene, camFx, camLook, camMask, onLayout, onCorner, onScene, onUploadScene, onCamFx, onCamLook, onCamMask, onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div style={{ position: 'absolute', bottom: '110%', left: 0, width: 250, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 10, zIndex: 41, boxShadow: '0 12px 36px rgba(0,0,0,0.5)' }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, textTransform: 'uppercase', margin: '2px 4px 8px' }}>Layout</div>
        {LAYOUT_PRESETS.map((p) => (
          <button key={p.id} onClick={() => onLayout(p.id)} style={menuRow(layoutMode === p.id && !scene)}>
            <Icon name={p.icon} size={16} /><span style={{ flex: 1 }}>{p.label}</span>
            {layoutMode === p.id && !scene && <Icon name="check" size={15} />}
          </button>
        ))}
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, textTransform: 'uppercase', margin: '10px 4px 6px' }}>PiP corner</div>
        <div style={{ display: 'flex', gap: 6, padding: '0 2px' }}>
          {PIP_CORNERS.map((c) => (
            <button key={c.id} onClick={() => onCorner(c.id)} title={c.label} style={{ flex: 1, padding: '7px 0', borderRadius: 8, border: `1px solid ${pipCorner === c.id ? C.purple : C.border}`, background: pipCorner === c.id ? C.purpleSoft : C.cardSoft, color: pipCorner === c.id ? C.purpleLight : C.textDim, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>{c.id.toUpperCase()}</button>
          ))}
        </div>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, textTransform: 'uppercase', margin: '10px 4px 6px' }}>Camera effects</div>
        {CAM_FX_OPTIONS.map((f) => (
          <button key={f.id} onClick={() => onCamFx(f.id)} style={menuRow(camFx === f.id)}>
            <Icon name={f.icon} size={16} /><span style={{ flex: 1 }}>{f.label}</span>
            {camFx === f.id && <Icon name='check' size={15} />}
          </button>
        ))}
        {/* Face masks hidden behind MASKS_ENABLED — see src/utils/featureFlags.js.
            The picker and every mask below it still work; the art is the reason
            they are not shown. Background effects and Looks are unaffected. */}
        {MASKS_ENABLED && (
          <>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, textTransform: 'uppercase', margin: '10px 4px 6px' }}>Face masks</div>
            {CAM_MASK_OPTIONS.map((m) => (
              <button key={m.id} onClick={() => onCamMask(m.id)} style={menuRow(camMask === m.id)}>
                <Icon name={m.icon} size={16} /><span style={{ flex: 1 }}>{m.label}</span>
                {camMask === m.id && <Icon name='check' size={15} />}
              </button>
            ))}
          </>
        )}
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, textTransform: 'uppercase', margin: '10px 4px 6px' }}>Looks</div>
        {CAM_LOOK_OPTIONS.map((l) => (
          <button key={l.id} onClick={() => onCamLook(l.id)} style={menuRow(camLook === l.id)}>
            <Icon name='palette' size={16} /><span style={{ flex: 1 }}>{l.label}</span>
            {camLook === l.id && <Icon name='check' size={15} />}
          </button>
        ))}
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, textTransform: 'uppercase', margin: '10px 4px 6px' }}>Scene cards</div>
        {SCENE_CARDS.map((s) => (
          <button key={s.id} onClick={() => onScene(s.id)} style={menuRow(scene === s.id)}>
            <Icon name="image" size={16} /><span style={{ flex: 1 }}>{s.title}</span>
            {scene === s.id && <Icon name="check" size={15} />}
          </button>
        ))}
        <button onClick={onUploadScene} style={menuRow(false)}>
          <Icon name="upload" size={16} /><span style={{ flex: 1 }}>Upload scene</span>
        </button>
      </div>
    </>
  );
}
function menuRow(active) {
  return { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 8px', borderRadius: 8, border: 'none', background: active ? C.purpleSoft : 'transparent', color: active ? C.purpleLight : C.text, fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left' };
}

function AudioMeter({ level, compact = false }) {
  const bars = compact ? 12 : 20;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: compact ? 12 : 14 }}>
      {Array.from({ length: bars }).map((_, i) => {
        const threshold = ((i + 1) / bars) * 100;
        const lit = level >= threshold;
        const color = i < bars * 0.6 ? C.green : i < bars * 0.85 ? C.amber : C.red;
        return <div key={i} style={{ width: 3, height: compact ? 4 + (i / bars) * 8 : 4 + (i / bars) * 10, background: lit ? color : 'rgba(255,255,255,0.08)', borderRadius: 1 }} />;
      })}
    </div>
  );
}

function FullCenter({ label, action }) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14, fontFamily: '"Inter", system-ui, sans-serif' }}>
      <div style={{ fontSize: 14, color: C.textDim }}>{label}</div>
      {action && <button onClick={action.onClick} style={{ padding: '12px 20px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>{action.label}</button>}
    </div>
  );
}

function formatDuration(s) {
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${hh ? hh + 'h ' : ''}${mm}m ${ss}s`;
}
function Stat({ label, value, color = '#fff' }) {
  return (
    <div style={{ padding: 12, background: C.cardSoft, borderRadius: 10, border: `1px solid ${C.borderSoft}` }}>
      <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, marginTop: 4, fontFamily: 'DM Mono, ui-monospace, monospace' }}>{value}</div>
    </div>
  );
}
function StreamSummary({ stats, onClose }) {
  const goalReached = stats.goal && (stats.goal.currentCoins || 0) >= (stats.goal.targetCoins || 1);
  const usd = (stats.tipCoins * 0.0099).toFixed(2);
  const medal = ['🥇', '🥈', '🥉'];
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const [postingStory, setPostingStory] = useState(false);
  const share = async () => {
    const text = `Just wrapped a stream on VERGR — ${formatDuration(stats.duration)}, ${(stats.peakViewers || 0)} peak viewers, ${stats.tipCoins.toLocaleString()} coins tipped. ⚡`;
    try { if (navigator.share) await navigator.share({ title: 'VERGR stream recap', text, url: 'https://vergr.app' }); else await navigator.clipboard.writeText(text + ' https://vergr.app'); } catch {}
  };
  // One-tap "share to my Status": renders a branded 9:16 recap card client-side,
  // uploads it to R2, and posts it as a 24h Status. Zero server cost.
  const shareToStatus = async () => {
    if (postingStory || !currentUser?.uid) return;
    setPostingStory(true);
    try {
      const blob = await renderShareCard({
        layout: 'story',
        avatarUrl: profile?.avatar || profile?.photoURL || currentUser?.photoURL || null,
        headline: profile?.displayName || profile?.username || 'I',
        subline: 'was LIVE on VERGR',
        stats: [
          { label: 'Peak', value: (stats.peakViewers || 0).toLocaleString() },
          { label: 'Tips', value: `${(stats.tipCoins || 0).toLocaleString()}c` },
          { label: 'Time', value: formatDuration(stats.duration) },
        ],
      });
      if (!blob) throw new Error('Could not render card');
      const { url } = await uploadToR2(new File([blob], 'vergr-stream.png', { type: 'image/png' }), 'post');
      await addDoc(collection(db, 'statuses'), {
        authorId: currentUser.uid,
        text: null, bgColor: null,
        mediaUrl: url, mediaType: 'image',
        caption: stats.title || 'Was live on VERGR',
        viewerIds: [], viewCount: 0,
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
      });
      showToast?.('Posted to your Status', 'success');
    } catch (e) {
      showToast?.(e?.message || 'Could not post to Status', 'error');
    } finally { setPostingStory(false); }
  };
  return (
    <div style={{ minHeight: '100vh', background: `radial-gradient(circle at 50% 0%, #1a1030 0%, ${C.bg} 60%)`, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: '"Inter", system-ui, sans-serif' }}>
      <div style={{ width: 'min(540px, 100%)', background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ width: 36, height: 36, borderRadius: '50%', background: C.purpleSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="live_tv" size={20} /></span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>That's a wrap</div>
            <div style={{ fontSize: 11, color: C.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 360 }}>{stats.title}</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, margin: '18px 0' }}>
          <Stat label="Duration" value={formatDuration(stats.duration)} />
          <Stat label="Peak viewers" value={(stats.peakViewers || 0).toLocaleString()} />
          <Stat label="Tips" value={`${stats.tipCoins.toLocaleString()}c`} color={C.amber} />
          <Stat label="New followers" value={'+' + stats.newFollowers} color={C.purpleLight} />
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, textAlign: 'right', marginTop: -8, marginBottom: 12 }}>≈ ${usd} from {stats.tipCount} tip{stats.tipCount === 1 ? '' : 's'}</div>
        {stats.mirrored && (
          <div style={{ padding: '10px 12px', borderRadius: 10, marginBottom: 14, background: 'rgba(145,70,255,0.10)', border: '1px solid rgba(145,70,255,0.35)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 22, height: 22, borderRadius: 6, background: '#9146FF', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12 }}>T</span>
            <span style={{ flex: 1 }}>Streamed to both platforms</span>
            <span style={{ fontWeight: 800 }}>{(stats.peakViewers || 0).toLocaleString()} on Vergr · {(stats.twitchPeakViewers || 0).toLocaleString()} on Twitch (peak)</span>
          </div>
        )}
        {stats.goal && (
          <div style={{ padding: '10px 12px', borderRadius: 10, marginBottom: 14, background: goalReached ? 'rgba(240,165,0,0.12)' : C.cardSoft, border: `1px solid ${goalReached ? C.amber + '66' : C.borderSoft}`, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <Icon name={goalReached ? 'emoji_events' : 'flag'} size={16} />
            <span style={{ flex: 1 }}>{goalReached ? 'Tip goal reached!' : 'Tip goal'}{stats.goal.reason ? ` · ${stats.goal.reason}` : ''}</span>
            <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 800, color: goalReached ? C.amber : C.text }}>{(stats.goal.currentCoins || 0).toLocaleString()} / {(stats.goal.targetCoins || 0).toLocaleString()}</span>
          </div>
        )}
        {stats.topTippers?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>Top supporters</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {stats.topTippers.map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: C.cardSoft, borderRadius: 8, border: `1px solid ${C.borderSoft}` }}>
                  <span style={{ fontSize: 15 }}>{medal[i]}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{t.name}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.amber, fontFamily: 'DM Mono, monospace' }}>{t.coins.toLocaleString()}c</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <button onClick={shareToStatus} disabled={postingStory} style={{ width: '100%', padding: 14, borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 10, opacity: postingStory ? 0.7 : 1 }}>
          <Icon name="auto_awesome" size={15} /> {postingStory ? 'Posting…' : 'Share to my Status'}
        </button>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={share} style={{ flex: 1, padding: 14, borderRadius: 12, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: 13, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name="share" size={15} /> Share recap
          </button>
          <button onClick={onClose} style={{ flex: 1, padding: 14, borderRadius: 12, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Done</button>
        </div>
      </div>
    </div>
  );
}
