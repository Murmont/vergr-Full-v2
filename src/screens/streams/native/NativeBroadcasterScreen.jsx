// NATIVE-APP broadcaster (Android/iOS Tauri shell ONLY).
//
// Dedicated mobile-first immersive broadcaster. Reuses the SAME ingest engine
// (startBrowserIngest), clip path (useStreamClipBuffer / requestStreamClip),
// tips/followers/poll subscriptions, and shared components (HypeMeter,
// ChatPanel, StreamGoalBar, TipAlert, StreamPoll, JoinAnnouncer, share sheet)
// + the same callables (endStreamSession, requestStreamClip). The existing
// BroadcasterScreen (desktop + mobile web) is left untouched.
//
// WYSIWYG preview (objectFit:contain — the host sees the exact frame viewers
// get, never cropped). Top/bottom overlays respect the status-bar safe area.

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import TakedownNotice from '../../../components/streams/TakedownNotice';
import { CoinIcon } from '../../../components/CoinIcon';
import { useKeepAwake } from '../../../utils/keepAwake';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, serverTimestamp, collection, query, where, orderBy, limit, addDoc, Timestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { RaidPicker } from '../../../components/streams/RaidControls';
import { useLiveUsers } from '../../../context/LiveUsersContext';
import { db } from '../../../firebase/config';
import { useAuth } from '../../../context/AuthContext';
import { useUser } from '../../../context/UserContext';
import { useUI } from '../../../context/UIContext';
import Icon from '../../../components/Icon';
import { startBrowserIngest, browserCanIngest } from '../../../utils/streamIngest';
import HypeMeter from '../../../components/tournament/HypeMeter';
import JoinAnnouncer from '../../../components/streams/JoinAnnouncer';
import ChatPanel from '../../../components/streams/ChatPanel';
import { StreamGoalBar, SubAlertOverlay } from '../../../components/streams/StreamGoalAndAlerts';
import { TipComboFeed, useLastTipCombo, useAboveChat } from '../../../components/streams/TipComboFeed';
import { useActiveStreamPoll, StreamPollCard, CreateStreamPollModal } from '../../../components/streams/StreamPoll';
import useStreamClipBuffer from '../../../hooks/useStreamClipBuffer';
import { uploadToR2 } from '../../../utils/r2Storage';
import { renderShareCard } from '../../../utils/shareCard';
import { createPost, getStreamIngest, markStatusPosted } from '../../../firebase/firestore';
import StreamShareSheet from '../../../components/streams/StreamShareSheet';
import CoHostInviteModal from '../../../components/streams/CoHostInviteModal';
import { ZeroViewers, VpEarnedChip, MovableGoal, HealthWarningView, HypeTrainView, LiveTrainBonus, trainPayTotals, trainPayLine } from '../../../components/streams/states';
import { motion, AnimatePresence } from 'framer-motion';
import { spring } from '../../../components/primitives/springs';
import { useStreamJoinEvents } from '../../../hooks/useStreamJoinEvents';
import { resolveTier } from '../../../utils/tierSystem';

const C = {
  bg: '#0a0a14', card: '#12121e', cardSoft: '#0f0f1a',
  border: 'rgba(255,255,255,0.09)', borderSoft: 'rgba(255,255,255,0.06)',
  text: '#e8e8f0', textDim: '#a0a0b8', textMuted: '#6b7280',
  purple: '#7c3aed', purpleLight: '#b44fff', purpleSoft: 'rgba(124,58,237,0.15)',
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444', divider: 'rgba(255,255,255,0.06)',
};

export default function NativeBroadcasterScreen() {
  useKeepAwake(); // keep the screen on while broadcasting
  const { streamId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();

  const isCohostQuery = searchParams.get('cohost') === '1';

  const rawJoinEvents = useStreamJoinEvents(streamId);
  const joinEvents = useMemo(() => rawJoinEvents.map((e) => ({
    id: e.id, kind: e.kind, tier: e.tier, level: e.level, rankId: e.rankId,
    user: { uid: e.uid, displayName: e.displayName, avatar: e.avatar },
  })), [rawJoinEvents]);

  const videoRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const ingestSessionRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const meterRafRef = useRef(0);

  const [streamDoc, setStreamDoc] = useState(null);
  // Set when Vergr ends this stream (functions/streamTakedown.js); the reason.
  const [takenDown, setTakenDown] = useState(null);
  const ingestFetchedRef = useRef(false);
  const [streamLoading, setStreamLoading] = useState(true);

  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [facing, setFacing] = useState('user'); // 'user' | 'environment'
  const [screenSharing, setScreenSharing] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);

  const [isLive, setIsLive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [paused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [startedAt, setStartedAt] = useState(null);

  const [bitrateKbps, setBitrateKbps] = useState(0);
  const [chunkLatencyMs, setChunkLatencyMs] = useState(0);

  // THE NATIVE BROADCASTER HAD NO HEALTH WARNING AT ALL, and the reason was not
  // that the signal was missing: `chunkLatencyMs` is written on every chunk
  // (onChunkSent below) and nothing ever read it. The web broadcaster derives a
  // stability label from the same value at the same thresholds
  // (BroadcasterScreen.jsx:886: under 600 Excellent, under 1500 Good, else Poor),
  // so this uses those, not a new number.
  //
  // A host mid-broadcast needs to be told, not left to read a latency figure.
  const uplinkStruggling = chunkLatencyMs >= 1500;

  const [tipEvents, setTipEvents] = useState([]);
  const [startingFollowers, setStartingFollowers] = useState(null);
  const [currentFollowers, setCurrentFollowers] = useState(0);

  // Every hype train this stream paid, from the stream doc the screen already
  // listens to (no read), for the end-of-stream summary. Keyed by the train, so
  // the final payout returned by endStreamSession is never counted twice.
  const trainPaysRef = useRef(new Map());
  const trainBonusAt = streamDoc?.hypeTrainBonus?.at || 0;
  useEffect(() => {
    const b = streamDoc?.hypeTrainBonus;
    if (b?.at) trainPaysRef.current.set(b.trainStartedAtMs || b.at, b);
  }, [trainBonusAt]);

  const [endedStats, setEndedStats] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [coHostOpen, setCoHostOpen] = useState(false);
  const [endConfirm, setEndConfirm] = useState(false);
  const [alertsOn] = useState(true);
  const [pollModalOpen, setPollModalOpen] = useState(false);
  const [editInfoOpen, setEditInfoOpen] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);

  // Mid-stream title/category edit — persists to the stream doc (viewers see it live).
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
    } catch (err) { showToast(err?.message || 'Could not update', 'error'); } finally { setSavingInfo(false); }
  };
  const [shareOpen, setShareOpen] = useState(false);

  // The same movable tip goal the web broadcaster got. Persisted per host in
  // this browser, and it changes only what the HOST sees: writing the placement
  // to the stream doc would move it for every viewer too, which is a product
  // decision nobody has made.
  const goalKey = `vergr.goalBox.${currentUser?.uid || 'anon'}`;
  const [goalBox, setGoalBoxState] = useState(() => {
    try { const raw = localStorage.getItem(goalKey); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const [goalEdit, setGoalEdit] = useState(false);
  const setGoalBox = (b) => {
    setGoalBoxState(b);
    // null is a RESET, so it clears rather than storing null and looking placed
    try { if (b) localStorage.setItem(goalKey, JSON.stringify(b)); else localStorage.removeItem(goalKey); } catch { /* private mode */ }
  };
  const { poll: streamPoll, closed: streamPollClosed } = useActiveStreamPoll(streamDoc?.hostUid, currentUser?.uid);

  // Subscribe to stream doc.
  useEffect(() => {
    if (!streamId) return;
    return onSnapshot(doc(db, 'streams', streamId), (snap) => {
      setStreamLoading(false);
      if (!snap.exists()) { setStreamDoc(null); return; }
      const data = { id: snap.id, ...snap.data() };
      setStreamDoc(data);
      // The publish key is not on this world-readable document; only the host
      // can fetch it, and only from the server. Merged in so every existing
      // `streamDoc.streamKey` read keeps working.
      if (!data.streamKey && !ingestFetchedRef.current) {
        ingestFetchedRef.current = true;
        getStreamIngest(streamId)
          .then((ing) => { if (ing?.streamKey) setStreamDoc((d) => (d ? { ...d, ...ing } : d)); })
          .catch(() => { ingestFetchedRef.current = false; });
      }
      if (data.status === 'live' && !isLive) setIsLive(true);
      if (data.status === 'ended' && isLive) setIsLive(false);
      if (data.takenDownAt) setTakenDown(data.takedownReason || '');
    }, (err) => { console.warn('stream doc subscribe error:', err); setStreamLoading(false); });
  }, [streamId, isLive]);

  // Native foreground-service bridge while live.
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.VergrStream : null;
    if (!bridge) return undefined;
    if (isLive) { try { bridge.start(streamDoc?.title || "You're live on VERGR"); } catch {} }
    else { try { bridge.stop(); } catch {} }
    return () => { try { bridge.stop(); } catch {} };
  }, [isLive, streamDoc?.title]);

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

  const acquireCamera = useCallback(async (face = facing) => {
    try {
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: face },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      stream.getAudioTracks().forEach((t) => (t.enabled = micOn));
      stream.getVideoTracks().forEach((t) => (t.enabled = camOn));
      setCameraReady(true);
      attachAudioMeter(stream);
    } catch (err) {
      console.warn('getUserMedia failed:', err);
      setCameraReady(false);
      showToast('Camera/mic permission denied or unavailable.', 'error');
    }
  }, [micOn, camOn, facing, showToast, attachAudioMeter]);

  // Flip front/back camera. Pre-live only: the browser-ingest MediaRecorder
  // is bound to the current stream's tracks, so a mid-broadcast swap would
  // kill the recording (needs a canvas-compositing ingest to support — a
  // separate ingest change, not a UI toggle).
  const flipCamera = useCallback(() => {
    if (isLive) { showToast('Camera flip is available before going live.', 'info'); return; }
    const next = facing === 'user' ? 'environment' : 'user';
    setFacing(next);
    acquireCamera(next);
  }, [isLive, facing, acquireCamera, showToast]);

  useEffect(() => {
    acquireCamera();
    return () => {
      try { ingestSessionRef.current?.stop(); } catch {}
      ingestSessionRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      cancelAnimationFrame(meterRafRef.current);
      try { audioCtxRef.current?.close(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Duration ticker.
  useEffect(() => {
    if (!isLive || paused || !startedAt) return;
    const id = setInterval(() => setDuration(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [isLive, paused, startedAt]);

  // Liveness heartbeat — while live, stamp streams/{id}.lastHeartbeat every 25s.
  // If the app crashes or is force-closed without calling endStreamSession, the
  // beat stops and the server's reapStaleStreams cron flips the doc to 'ended'
  // (otherwise it stays stuck "LIVE" in every discovery list — the zombie bug).
  useEffect(() => {
    if (!isLive || !streamDoc?.id) return;
    const ref = doc(db, 'streams', streamDoc.id);
    const ping = () => updateDoc(ref, { lastHeartbeat: serverTimestamp() }).catch(() => {});
    ping();
    const id = setInterval(ping, 25000);
    return () => clearInterval(id);
  }, [isLive, streamDoc?.id]);

  // Tips.
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

  // Followers.
  useEffect(() => {
    if (!streamDoc?.hostUid) return;
    return onSnapshot(doc(db, 'users', streamDoc.hostUid), (snap) => {
      if (!snap.exists()) return;
      const n = snap.data().followerCount || 0;
      setCurrentFollowers(n);
      if (startingFollowers === null) setStartingFollowers(n);
    });
  }, [streamDoc?.hostUid, startingFollowers]);

  const startStream = async () => {
    if (starting || isLive || !streamDoc) return;
    if (streamDoc.hostUid !== currentUser?.uid) { showToast('Not your stream.', 'error'); return; }
    setStarting(true);
    try {
      // sourceAspect = layout hint for viewers (native camera streams are
      // portrait); real video metadata overrides it in the player if it differs.
      await updateDoc(doc(db, 'streams', streamDoc.id), {
        status: 'live', startedAt: serverTimestamp(),
        ...(streamDoc.ingestType === 'browser' ? { sourceAspect: 0.5625 } : {}),
      });
      const liveAt = Date.now();
      setStartedAt(liveAt); setDuration(0);
      const isCoStream = streamDoc.kind === 'co_stream' || isCohostQuery;
      if (!isCoStream && streamDoc.ingestType === 'browser') {
        if (!browserCanIngest()) throw new Error('Your browser cannot do live ingest. Use OBS, or update the app.');
        if (!mediaStreamRef.current) throw new Error('No camera or mic. Grant permission first.');
        const session = await startBrowserIngest({
          streamKey: streamDoc.streamKey,
          mediaStream: mediaStreamRef.current,
          plan: streamDoc.hostPlan || resolveTier(profile),
          ingestBase: streamDoc.ingestUrl,   // box assigned by createStreamSession (distributes ingest across edges)
          onChunkSent: (_seq, ms, bytes) => { setChunkLatencyMs(ms); if (bytes > 0) setBitrateKbps(Math.round((bytes * 8) / 1000)); },
          onError: (err) => { console.error('ingest error:', err); showToast(err.message || 'Stream upload failed', 'error'); endStream().catch(() => {}); },
          onEnded: (reason) => console.log('ingest ended:', reason),
        });
        ingestSessionRef.current = session;
      }
      setIsLive(true);
    } catch (err) { showToast(err?.message || 'Could not go live.', 'error'); } finally { setStarting(false); }
  };

  const endStream = async () => {
    if (ending) return;
    setEnding(true);
    try {
      if (ingestSessionRef.current) { try { await ingestSessionRef.current.stop(); } catch (e) { console.warn('ingest stop:', e); } ingestSessionRef.current = null; }
      if (streamDoc?.id) {
        const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'endStreamSession');
        const r = await fn({ streamId: streamDoc.id });
        if (r.data?.refunded) showToast('Boost refunded. Your tips covered the fee!', 'success');
        const tb = r.data?.trainBonus;
        if (tb) trainPaysRef.current.set(tb.trainStartedAtMs || tb.at || 'end', tb);
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
        trainPays: trainPayTotals([...trainPaysRef.current.values()]),
      });
      setIsLive(false);
    } catch (err) { showToast(err?.message || 'End-stream failed', 'error'); } finally { setEnding(false); }
  };

  const toggleMic = () => setMicOn((v) => { const next = !v; mediaStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next)); return next; });
  const toggleCam = () => setCamOn((v) => { const next = !v; mediaStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next)); return next; });

  const fmtTime = (s) => {
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${hh ? String(hh).padStart(2, '0') + ':' : ''}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };

  const tipCoins = useMemo(() => tipEvents.reduce((s, t) => s + (t.coins || 0), 0), [tipEvents]);
  const followerDelta = startingFollowers === null ? 0 : Math.max(0, currentFollowers - startingFollowers);

  // Clip ("clip my own moment").
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
      if (!data?.clipUrl) throw new Error('Clip failed. Try again in a few seconds.');
      await publishClip(data.clipUrl);
      setClipsUsed((n) => n + 1);
      showToast('Clip saved to your profile.', 'success');
    } catch (err) { showToast(err?.message || 'Clip failed', 'error'); } finally { setClipping(false); }
  }, [clipping, currentUser?.uid, isLive, clipsUsed, clipCfg, hostPlan, browserIngest, clipSupported, grabClip, streamDoc?.id, publishClip, showToast]);

  // ── Guards ──
  // Tips draw as the designed combo feed from the server-written lastTip, the
  // same as the viewers, directly above the newest chat row. Declared above the
  // early returns so the hook order never changes.
  const { tips: tipDrops } = useLastTipCombo(streamDoc?.lastTip);
  const { setList: setChatList, setAnchor: setChatFrame, bottom: aboveChat } = useAboveChat(null);

  if (streamLoading) return <FullCenter label="Loading stream…" />;
  if (!streamDoc) return <FullCenter label="This stream doesn't exist." action={{ label: 'Back to Go Live', onClick: () => navigate('/go-live') }} />;
  if (streamDoc.hostUid !== currentUser?.uid) return <FullCenter label="You're not the host of this stream." action={{ label: 'Watch instead', onClick: () => navigate(`/watch/${streamDoc.id}`) }} />;
  if (takenDown !== null) return <TakedownNotice streamId={streamId} reason={takenDown} onClose={() => navigate('/')} />;
  if (endedStats) return <StreamSummary stats={endedStats} onClose={() => navigate('/')} />;

  const composerExtras = (
    <>
      <DockBtn icon={micOn ? 'mic' : 'mic_off'} danger={!micOn} onClick={toggleMic} label="Mic" />
      <DockBtn icon={camOn ? 'videocam' : 'videocam_off'} danger={!camOn} onClick={toggleCam} label="Camera" />
      <DockBtn icon="more_horiz" onClick={() => setMoreOpen(true)} label="More" />
    </>
  );

  return (
    <div ref={setChatFrame} style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden', color: C.text, fontFamily: '"DM Sans",system-ui,sans-serif', zIndex: 90 }}>
      {/* WYSIWYG preview — contain, never cropped. */}
      <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />

      {/* Top overlay (safe-area aware): LIVE · duration · stats chips · viewers · X */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: '12px 12px 24px', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.7), transparent)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {isLive ? <LivePill /> : (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{streamDoc.title || 'Live stream'}</span>
        )}
        {isLive && <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: 'DM Mono, ui-monospace, monospace' }}>{fmtTime(duration)}</span>}
        {isLive && <HypeMeter streamId={streamId} mode="compact" />}
        <div style={{ flex: 1 }} />
        {isLive && (
          <span style={statChip(C.amber)}><CoinIcon size={12} />{tipCoins}</span>
        )}
        {isLive && followerDelta > 0 && (
          <span style={statChip(C.purpleLight)}><Icon name="person_add" size={12} />+{followerDelta}</span>
        )}
        {/* ⚠ THE HOST'S OWN VP, AND ONLY THE HOST'S. go_live and stream_hour are both
            server-awarded, so this figure is real. A VIEWER equivalent must never be
            added: nothing awards watch_stream_hour, so it would promise VP that never
            arrives. The chip renders as a plain element here because there is nowhere
            useful to send someone, and a button that does nothing is worse than none. */}
        {isLive && <VpEarnedChip host minutes={duration / 60} />}
        <span style={statChip('#fff')}><Icon name="visibility" size={12} />{streamDoc.viewerCount || 0}</span>
        <button
          onClick={() => { if (isLive) setEndConfirm(true); else navigate(-1); }}
          aria-label={isLive ? 'End stream' : 'Back'}
          style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
        >
          <Icon name="close" size={18} />
        </button>
      </div>

        {/* ⚠⚠ THE FIRST MINUTES OF EVERY STREAM SHOWED THE DIGIT 0 AND NOTHING ELSE.
            It is the state a new creator sees most and the one most likely to make them
            stop, and there was no copy, no explanation and nothing to do about it. The
            card frames the moment as EARLY rather than as nobody watching, and offers
            the things that actually change the number.

            ⚠ Actions without a handler are not rendered, so this is safe here even
            though the native broadcaster has no boost entry point: it shows the two it
            can do. */}
        {isLive && (streamDoc.viewerCount || 0) === 0 && (
          <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 92px)', left: 12, right: 12, zIndex: 5 }}>
            <ZeroViewers compact onShare={() => setShareOpen(true)} onInvite={() => setShareOpen(true)} />
          </div>
        )}

      {/* Bottom dock: poll + goal above the PERSISTENT chat feed; the
          composer row carries mic / camera / more (TikTok host pattern —
          the streamer reads chat while live, no sheet to open). */}
      <div style={{
        position: 'absolute', left: 10, right: 10,
        bottom: 'calc(var(--vg-safe-b, 0px) + 10px)',
        display: 'flex', flexDirection: 'column', gap: 8, zIndex: 8,
      }}>
        {streamPoll && (
          <div style={{ maxWidth: 320 }}>
            <StreamPollCard poll={streamPoll} closed={streamPollClosed} uid={currentUser?.uid} compact />
          </div>
        )}
        {/* The card carries the plain fact, not advice for a situation that has not
            happened. Nothing is passed as an action because there is nothing here for
            the host to press: the card hides its button without a handler. */}
        {isLive && uplinkStruggling && (
          <div style={{ marginBottom: 8 }}>
            <HealthWarningView state="unstable"
              title="Your upload is struggling"
              body="Frames are taking too long to send. Move closer to your router or close other uploads." />
          </div>
        )}
        {/* The goal rendered at a FIXED position and covered the host face, with no
            way to move it. Same fix as the web broadcaster. */}
        {isLive && streamDoc.goal?.active && (
          <MovableGoal goal={streamDoc.goal} box={goalBox} onChange={setGoalBox}
            editable editing={goalEdit} compact
            fallback={{ xPct: 3, yPct: 20, wPct: 62 }} />
        )}
        {isLive ? (
          <div style={{ height: '28vh', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <ChatPanel
              streamId={streamDoc.id} layout="overlay" hostUid={streamDoc.hostUid}
              slowModeSec={streamDoc.slowModeSec || 0} followersOnly={!!streamDoc.followersOnly} subsOnly={!!streamDoc.subsOnly} mutedUids={streamDoc.mutedUids || null} ttsEnabled={!!streamDoc.ttsEnabled}
              pinnedMessage={streamDoc.pinnedMessage || null}
              composerExtras={composerExtras}
              onListRef={setChatList}
            />
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
            <button onClick={startStream} disabled={starting || !cameraReady} style={{ width: '100%', padding: 15, borderRadius: 14, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: starting || !cameraReady ? 0.6 : 1 }}>
              {starting ? 'Starting…' : 'Start Stream'}
            </button>
          </div>
        )}
      </div>

      <HypeTrainView train={streamDoc.hypeTrain} />
      <LiveTrainBonus bonus={streamDoc.hypeTrainBonus} train={streamDoc.hypeTrain} hostName="you" />
      {alertsOn && <TipComboFeed tips={tipDrops} style={{ bottom: aboveChat ?? 'calc(var(--vg-safe-b, 0px) + 28vh + 24px)', left: 10, zIndex: 9 }} />}
      {alertsOn && <SubAlertOverlay lastSub={streamDoc.lastSub} anchor="bottom" />}
      {pollModalOpen && <CreateStreamPollModal hostUid={streamDoc.hostUid} streamId={streamDoc.id} onClose={() => setPollModalOpen(false)} showToast={showToast} />}
      <JoinAnnouncer events={joinEvents} side="left" bottom="calc(var(--vg-safe-b, 0px) + 28vh + 24px)" />

      {/* "More" tool sheet: poll / clip / share */}
      <AnimatePresence>
        {moreOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMoreOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60 }}>
            <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={spring.gentle}
              style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: C.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '14px 14px calc(var(--vg-safe-b, 0px) + 14px)' }}>
              <SheetBtn icon="edit" label="Edit title / category" onClick={() => { setMoreOpen(false); setEditInfoOpen(true); }} />
              <SheetBtn icon="poll" label={streamPoll && !streamPollClosed ? 'Poll running' : 'Start a poll'} onClick={() => { setMoreOpen(false); if (!isLive) { showToast('Go live first to start a poll.', 'info'); return; } setPollModalOpen(true); }} />
              <SheetBtn icon="content_cut" label="Clip the last moment" onClick={() => { setMoreOpen(false); handleClip(); }} />
              {/* Without an entry point the drag can never be turned on, and an
                  always-draggable goal gets moved by accident mid-stream. */}
              {isLive && streamDoc.goal?.active && (
                <SheetBtn icon="open_with" label={goalEdit ? 'Done moving the tip goal' : 'Move the tip goal'}
                  onClick={() => { setMoreOpen(false); setGoalEdit((v) => !v); }} />
              )}
              {/* ⚠⚠ SAME GAP AS THE WEB BROADCASTER: `CoHostInviteModal` was
                  mounted in ZERO files while its own header calls itself "the
                  ONLY co-host entry point now", because the pre-broadcast button
                  on Go Live was deliberately removed in its favour. Both doors
                  were shut, so co-hosting was unreachable on every platform. */}
              {isLive && (
                <SheetBtn icon="group_add" label="Invite a co-host"
                  onClick={() => { setMoreOpen(false); setCoHostOpen(true); }} />
              )}
              <SheetBtn icon="share" label="Share stream" onClick={() => { setMoreOpen(false); setShareOpen(true); }} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* End-stream confirm */}
      <AnimatePresence>
        {endConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEndConfirm(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <motion.div onClick={(e) => e.stopPropagation()} initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.gentle}
              style={{ width: 'min(320px, 100%)', background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>End the stream?</div>
              <div style={{ fontSize: 12, color: C.textDim, marginBottom: 16 }}>Your viewers will see the stream end immediately.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setEndConfirm(false)} style={{ flex: 1, padding: 12, borderRadius: 10, border: `1px solid ${C.border}`, background: 'transparent', color: C.textDim, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Keep going</button>
                <button onClick={() => { setEndConfirm(false); endStream(); }} disabled={ending} style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: C.red, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', opacity: ending ? 0.6 : 1 }}>{ending ? 'Ending…' : 'End stream'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {shareOpen && (
        <StreamShareSheet streamId={streamDoc.id} streamTitle={streamDoc.title} hostName={profile?.displayName || profile?.username || streamDoc.hostUsername} live={isLive} onClose={() => setShareOpen(false)} />
      )}
      {editInfoOpen && <EditInfoModal title={streamDoc.title} game={streamDoc.game} saving={savingInfo} onSave={saveStreamInfo} onClose={() => setEditInfoOpen(false)} />}
      {coHostOpen && <CoHostInviteModal streamId={streamDoc.id} coHostUids={streamDoc.coHostUids || []} onClose={() => setCoHostOpen(false)} showToast={showToast} />}
    </div>
  );
}

// ── subcomponents (mirror the web broadcaster) ──
function EditInfoModal({ title, game, saving, onSave, onClose }) {
  const [t, setT] = useState(title || '');
  const [g, setG] = useState(game || '');
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 80, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: C.card, border: `1px solid ${C.border}`, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, paddingBottom: 'calc(var(--vg-safe-b, 0px) + 20px)', color: C.text, fontFamily: '"DM Sans", system-ui, sans-serif' }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>Edit stream info</div>
        <label style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: C.textDim }}>TITLE</label>
        <input value={t} maxLength={140} onChange={(e) => setT(e.target.value)} placeholder="What are you streaming?"
          style={{ width: '100%', boxSizing: 'border-box', margin: '6px 0 14px', background: '#191527', border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, color: C.text, fontSize: 14, outline: 'none' }} />
        <label style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: C.textDim }}>CATEGORY / GAME</label>
        <input value={g} maxLength={60} onChange={(e) => setG(e.target.value)} placeholder="e.g. Counter-Strike 2"
          style={{ width: '100%', boxSizing: 'border-box', margin: '6px 0 18px', background: '#191527', border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, color: C.text, fontSize: 14, outline: 'none' }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={saving} style={{ flex: 1, padding: 13, borderRadius: 10, border: `1px solid ${C.border}`, background: 'transparent', color: C.textDim, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => onSave({ title: t, game: g })} disabled={saving} style={{ flex: 2, padding: 13, borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function FullCenter({ label, action }) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14, fontFamily: '"DM Sans", system-ui, sans-serif' }}>
      <div style={{ fontSize: 14, color: C.textDim }}>{label}</div>
      {action && <button onClick={action.onClick} style={{ padding: '12px 20px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>{action.label}</button>}
    </div>
  );
}
function LivePill() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: C.red, fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.08em' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />LIVE
    </span>
  );
}
function AudioMeter({ level, compact = false }) {
  const bars = compact ? 12 : 20;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: compact ? 12 : 14 }}>
      {Array.from({ length: bars }).map((_, i) => {
        const threshold = ((i + 1) / bars) * 100;
        const lit = level >= threshold;
        const color = i < bars * 0.6 ? C.green : i < bars * 0.85 ? C.amber : C.red;
        return <div key={i} style={{ width: 3, height: compact ? 4 + (i / bars) * 8 : 4 + (i / bars) * 10, background: lit ? color : 'rgba(255,255,255,0.08)', borderRadius: 2 }} />;
      })}
    </div>
  );
}
function DockBtn({ icon, onClick, label, danger = false }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} style={{
      width: 42, height: 42, borderRadius: '50%', border: 'none', flexShrink: 0,
      background: danger ? 'rgba(239,68,68,0.35)' : 'rgba(0,0,0,0.45)', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    }}>
      <Icon name={icon} size={20} />
    </button>
  );
}
function SheetBtn({ icon, label, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, width: '100%',
      padding: '13px 12px', borderRadius: 12, border: 'none', marginBottom: 6,
      background: '#191527', color: '#fff', fontSize: 14, fontWeight: 700,
      cursor: 'pointer', textAlign: 'left',
    }}>
      <Icon name={icon} size={18} />
      {label}
    </button>
  );
}
function statChip(color) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
    padding: '4px 9px', borderRadius: 999, background: 'rgba(0,0,0,0.45)',
    color, fontSize: 11, fontWeight: 800, fontFamily: 'DM Mono, ui-monospace, monospace',
  };
}
function Stat({ label, value, color = '#fff' }) {
  return (
    <div style={{ padding: 12, background: C.cardSoft, borderRadius: 10, border: `1px solid ${C.borderSoft}` }}>
      <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, marginTop: 4, fontFamily: 'DM Mono, ui-monospace, monospace' }}>{value}</div>
    </div>
  );
}
function formatDuration(s) {
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${hh ? hh + 'h ' : ''}${mm}m ${ss}s`;
}
function StreamSummary({ stats, onClose }) {
  const goalReached = stats.goal && (stats.goal.currentCoins || 0) >= (stats.goal.targetCoins || 1);
  const usd = (stats.tipCoins * 0.0099).toFixed(2);
  const medal = ['🥇', '🥈', '🥉'];
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const [postingStory, setPostingStory] = useState(false);

  // ⚠⚠ SAME GAP AS THE WEB BROADCASTER. `RaidPicker` was mounted only in
  // StreamEndingScreen.jsx and nothing in the app routes to /stream/ended, so on
  // native the raid was equally unreachable and `raidStream` had never been
  // called from either platform. Candidates come from LiveUsersContext, which
  // already holds one shared snapshot of live streams, so this costs zero reads;
  // the filter mirrors `badRaidTarget` in functions/raids.js so the picker
  // cannot offer a target the server will refuse.
  const { liveHosts } = useLiveUsers();
  const [raidBusy, setRaidBusy] = useState(false);
  const [raided, setRaided] = useState(null);
  const [raidSkipped, setRaidSkipped] = useState(false);
  const raidTargets = useMemo(() => [...(liveHosts?.values?.() || [])]
    .filter((h) => h.streamId !== stats.streamId
      && h.discoverable && !h.premium && !h.audioOnly && !h.ticketed)
    .sort((a, b) => (b.viewerCount || 0) - (a.viewerCount || 0))
    .slice(0, 5)
    .map((h) => ({ id: h.streamId, hostName: h.name || 'A creator', viewers: h.viewerCount || 0 })),
  [liveHosts, stats.streamId]);

  const doRaid = async (toStreamId) => {
    if (!stats.streamId || raidBusy) return;
    setRaidBusy(true);
    try {
      await httpsCallable(getFunctions(undefined, 'europe-west1'), 'raidStream')({ fromStreamId: stats.streamId, toStreamId });
      setRaided(raidTargets.find((t) => t.id === toStreamId)?.hostName || 'them');
    } catch (e) {
      // The server owns every rule, so its message is the honest one to show.
      showToast?.(e?.message || 'Could not send the raid', 'error');
      setRaidSkipped(true);
    } finally { setRaidBusy(false); }
  };

  const share = async () => {
    const text = `Just wrapped a stream on VERGR: ${formatDuration(stats.duration)}, ${(stats.peakViewers || 0)} peak viewers, ${stats.tipCoins.toLocaleString()} coins tipped. ⚡`;
    try { if (navigator.share) await navigator.share({ title: 'VERGR stream recap', text, url: 'https://vergr.app' }); else await navigator.clipboard.writeText(text + ' https://vergr.app'); } catch {}
  };
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
      const ref = await addDoc(collection(db, 'statuses'), {
        authorId: currentUser.uid,
        text: null, bgColor: null,
        mediaUrl: url, mediaType: 'image',
        caption: stats.title || 'Was live on VERGR',
        viewerIds: [], viewCount: 0,
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
      });
      // Same denormalisation as the Status composer, so the avatar ring knows
      // about a status posted from the broadcaster without a query.
      await markStatusPosted(currentUser.uid, ref.id, Date.now() + 24 * 60 * 60 * 1000);
      showToast?.('Posted to your Status', 'success');
    } catch (e) {
      showToast?.(e?.message || 'Could not post to Status', 'error');
    } finally { setPostingStory(false); }
  };
  return (
    <div style={{ minHeight: '100vh', background: `radial-gradient(circle at 50% 0%, #1a1030 0%, ${C.bg} 60%)`, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, paddingTop: 'calc(env(safe-area-inset-top,0px) + 24px)', fontFamily: '"DM Sans", system-ui, sans-serif' }}>
      <div style={{ width: 'min(540px, 100%)', background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: 24, boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ width: 36, height: 36, borderRadius: '50%', background: '#241943', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="live_tv" size={20} /></span>
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
        {stats.goal && (
          <div style={{ padding: '10px 12px', borderRadius: 10, marginBottom: 14, background: goalReached ? '#2A2008' : C.cardSoft, borderLeft: goalReached ? `3px solid ${C.amber}` : '3px solid transparent', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <Icon name={goalReached ? 'emoji_events' : 'flag'} size={16} />
            <span style={{ flex: 1 }}>{goalReached ? 'Tip goal reached!' : 'Tip goal'}{stats.goal.reason ? ` · ${stats.goal.reason}` : ''}</span>
            <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 800, color: goalReached ? C.amber : C.text }}>{(stats.goal.currentCoins || 0).toLocaleString()} / {(stats.goal.targetCoins || 0).toLocaleString()}</span>
          </div>
        )}
        {stats.trainPays?.count > 0 && (
          <div style={{ padding: '10px 12px', borderRadius: 10, marginBottom: 14, background: '#2A2008', borderLeft: `3px solid ${C.amber}`, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <Icon name="local_fire_department" size={16} />
            <span style={{ flex: 1 }}>{stats.trainPays.count === 1 ? 'Hype train paid you' : `${stats.trainPays.count} hype trains paid you`}</span>
            <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 800, color: C.amber }}>{trainPayLine(stats.trainPays)}</span>
          </div>
        )}
        {stats.topTippers?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: C.textDim, textTransform: 'uppercase', marginBottom: 8 }}>Top supporters</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {stats.topTippers.map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: C.cardSoft, borderRadius: 8, border: `1px solid ${C.borderSoft}` }}>
                  <span style={{ fontSize: 14 }}>{medal[i]}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{t.name}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.amber, fontFamily: 'DM Mono, monospace' }}>{t.coins.toLocaleString()}c</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* ⚠ ABOVE THE SHARE BUTTONS BECAUSE IT IS THE ONLY DECISION HERE WITH A
            DEADLINE. The audience is dispersing while the host reads this. */}
        {stats.streamId && !raided && !raidSkipped && raidTargets.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <RaidPicker candidates={raidTargets} busy={raidBusy}
              onRaid={doRaid} onSkip={() => setRaidSkipped(true)} />
          </div>
        )}
        {raided && (
          <div style={{ marginBottom: 12, padding: '12px 14px', borderRadius: 12, background: '#1a1a2a', color: C.text, fontSize: 13, fontWeight: 700 }}>
            Your viewers are on their way to {raided}.
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
