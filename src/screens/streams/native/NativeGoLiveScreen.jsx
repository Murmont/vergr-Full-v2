// NATIVE-APP Go Live setup (Android/iOS Tauri shell ONLY).
//
// Dedicated mobile-first rebuild of GoLiveSetupScreen. Same money/stream path
// (createStreamSession + scheduled_streams doc), same device/preview engine,
// laid out for a phone: full-bleed preview up top, control rail, stacked config
// sections, sticky Go Live CTA. Routed `IS_NATIVE_BUILD ? <Native> : <existing>`;
// never renders on web. The existing GoLiveSetupScreen is untouched.
//
// Video is WYSIWYG (objectFit:contain) — the host sees exactly the frame viewers
// will receive (no crop).

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, updateDoc, serverTimestamp, addDoc, collection } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import { useAuth } from '../../../context/AuthContext';
import { useUser } from '../../../context/UserContext';
import { useUI } from '../../../context/UIContext';
import { browserCanIngest } from '../../../utils/streamIngest';
import { uploadToR2 } from '../../../utils/r2Storage';
import { compressMedia } from '../../../utils/mediaCompression';
import { SUPPORTED_LANGS, LANG_LABELS, languageForCountry } from '../../../utils/localePrefs';
import { resolveTier } from '../../../utils/tierSystem';

const C = {
  bg: '#09090f', card: '#12121e', cardSoft: '#0f0f1a',
  border: 'rgba(255,255,255,0.09)', borderSoft: 'rgba(255,255,255,0.06)',
  text: '#e8e8f0', textDim: '#a0a0b8', textMuted: '#6b7280',
  purple: '#7B1FFF', purpleLight: '#b44fff', purpleSoft: 'rgba(123,31,255,0.15)',
  green: '#22c55e', red: '#ef4444', amber: '#f59e0b',
  divider: 'rgba(255,255,255,0.06)',
};

const RENDITIONS = {
  free: { label: '480p · 30fps', kbps: 3000, planLabel: 'Free' },
  lite: { label: '720p · 60fps', kbps: 4500, planLabel: 'Lite' },
  pro:  { label: '1080p · 60fps', kbps: 6500, planLabel: 'Pro' },
};

export default function NativeGoLiveScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [audience, setAudience] = useState('public');
  const [notifyFollowers, setNotifyFollowers] = useState(true);
  // Spoken language of the broadcast (locality discovery); defaults from country.
  const [streamLang, setStreamLang] = useState(() => languageForCountry(profile?.country));
  const [coverUrl, setCoverUrl] = useState('');
  const [coverBusy, setCoverBusy] = useState(false);
  const coverInputRef = useRef(null);

  const streamTier = resolveTier(profile);
  const rendition = RENDITIONS[streamTier] || RENDITIONS.free;

  // These MUST be declared before the hydrate effect + persistStreamDefaults
  // callback below: a useCallback dependency array reads them at render time, so
  // declaring them later left them in the temporal dead zone and threw
  // "Cannot access 'coverHistory' before initialization" on every render —
  // crashing the whole Go Live screen to a black, frozen state on native.
  const [coverHistory, setCoverHistory] = useState([]);
  const [tipGoalOn, setTipGoalOn] = useState(false);
  const [tipGoalCoins, setTipGoalCoins] = useState(0);
  const [tipGoalReason, setTipGoalReason] = useState('');
  const [ingestMode, setIngestMode] = useState(() => (browserCanIngest() ? 'browser' : 'rtmp'));

  // Hydrate from the host's last-used defaults (persisted on every go-live), so
  // the common case is title -> Go Live. Only fills pristine fields.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !profile?.streamDefaults) return;
    hydratedRef.current = true;
    const d = profile.streamDefaults;
    if (Array.isArray(d.coverHistory)) setCoverHistory(d.coverHistory.slice(0, 6));
    setTitle((t) => t || d.title || '');
    setTags((t) => (t.length ? t : (Array.isArray(d.tags) ? d.tags.slice(0, 12) : [])));
    if (d.coverUrl) setCoverUrl((c) => c || d.coverUrl);
    if (d.language) setStreamLang((l) => l || d.language);
    if (d.ingestMode && browserCanIngest()) setIngestMode(d.ingestMode);
    if (d.tipGoalOn) {
      setTipGoalOn(true);
      if (d.tipGoalCoins) setTipGoalCoins(d.tipGoalCoins);
      if (d.tipGoalReason) setTipGoalReason(d.tipGoalReason);
    }
  }, [profile?.streamDefaults]);

  // Save setup so the next go-live is prefilled (coverHistory: last 6, deduped).
  const persistStreamDefaults = useCallback(() => {
    if (!currentUser?.uid) return;
    const history = coverUrl
      ? [coverUrl, ...coverHistory.filter((u) => u !== coverUrl)].slice(0, 6)
      : coverHistory.slice(0, 6);
    updateDoc(doc(db, 'users', currentUser.uid), {
      streamDefaults: {
        coverUrl: coverUrl || null,
        coverHistory: history,
        title: title.trim() || null,
        tags: tags.slice(0, 12),
        language: streamLang || null,
        ingestMode,
        tipGoalOn: !!tipGoalOn,
        tipGoalCoins: Math.max(0, tipGoalCoins | 0),
        tipGoalReason: tipGoalReason.trim().slice(0, 80) || null,
      },
    }).catch((e) => console.warn('streamDefaults save failed (non-fatal):', e));
  }, [currentUser?.uid, coverUrl, coverHistory, title, tags, streamLang, ingestMode, tipGoalOn, tipGoalCoins, tipGoalReason]);

  const [starting, setStarting] = useState(false);
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [scheduling, setScheduling] = useState(false);

  // ── Preview engine (camera/screen + live mic meter) ──────────────
  const videoRef = useRef(null);
  const camStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const meterRafRef = useRef(0);
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [previewStarted, setPreviewStarted] = useState(false);
  const [videoDevices, setVideoDevices] = useState([]);
  const [audioDevices, setAudioDevices] = useState([]);
  const [camDeviceId, setCamDeviceId] = useState('');
  const [micDeviceId, setMicDeviceId] = useState('');

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(list.filter((d) => d.kind === 'videoinput'));
      setAudioDevices(list.filter((d) => d.kind === 'audioinput'));
    } catch { /* ignore */ }
  }, []);

  const attachMeter = useCallback((mediaStream) => {
    cancelAnimationFrame(meterRafRef.current);
    try { audioCtxRef.current?.close(); } catch {}
    if (!mediaStream || mediaStream.getAudioTracks().length === 0) { setMicLevel(0); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(mediaStream).connect(analyser);
    audioCtxRef.current = ctx;
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

  const acquireCamera = useCallback(async () => {
    setPreviewError(null);
    try {
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: camDeviceId
          ? { deviceId: { exact: camDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { ...(micDeviceId ? { deviceId: { exact: micDeviceId } } : {}), echoCancellation: true, noiseSuppression: true },
      });
      camStreamRef.current = stream;
      stream.getVideoTracks().forEach((t) => (t.enabled = camOn));
      stream.getAudioTracks().forEach((t) => (t.enabled = micOn));
      if (videoRef.current && !screenSharing) videoRef.current.srcObject = stream;
      setPreviewReady(true);
      setPreviewStarted(true);
      refreshDevices();
      if (!screenSharing) attachMeter(stream);
    } catch (err) {
      console.warn('preview getUserMedia failed:', err);
      setPreviewReady(false);
      setPreviewError('Camera/mic blocked. Allow access, or broadcast via OBS below.');
    }
  }, [camOn, micOn, screenSharing, attachMeter, camDeviceId, micDeviceId, refreshDevices]);

  const prevDevicesRef = useRef('');
  useEffect(() => {
    const key = `${camDeviceId}|${micDeviceId}`;
    if (previewStarted && !screenSharing && prevDevicesRef.current && prevDevicesRef.current !== key) acquireCamera();
    prevDevicesRef.current = key;
  }, [camDeviceId, micDeviceId, previewStarted, screenSharing, acquireCamera]);

  const stopAllDevices = useCallback(() => {
    cancelAnimationFrame(meterRafRef.current);
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setMicLevel(0); setPreviewReady(false); setScreenSharing(false); setPreviewStarted(false);
  }, []);
  useEffect(() => stopAllDevices, [stopAllDevices]);

  const toggleMic = () => {
    if (!previewStarted) { setMicOn(true); acquireCamera(); return; }
    const next = !micOn; setMicOn(next);
    camStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
    if (!next) setMicLevel(0);
  };
  const toggleCam = () => {
    if (!previewStarted) { setCamOn(true); acquireCamera(); return; }
    const next = !camOn; setCamOn(next);
    camStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
  };
  const toggleScreen = async () => {
    if (screenSharing) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null; setScreenSharing(false);
      if (videoRef.current) videoRef.current.srcObject = camStreamRef.current;
      attachMeter(camStreamRef.current); return;
    }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      screenStreamRef.current = s; setScreenSharing(true); setPreviewStarted(true); setPreviewReady(true);
      if (videoRef.current) videoRef.current.srcObject = s;
      attachMeter(s.getAudioTracks().length ? s : camStreamRef.current);
      s.getVideoTracks()[0]?.addEventListener('ended', () => {
        screenStreamRef.current = null; setScreenSharing(false);
        if (videoRef.current) videoRef.current.srcObject = camStreamRef.current;
        attachMeter(camStreamRef.current);
      });
    } catch (err) { console.warn('getDisplayMedia failed:', err); }
  };

  // Public live is gated to 100 followers for FREE accounts (admins + paid
  // bypass). Shown up front so new users aren't left guessing why Go Live is
  // disabled. Mirrors the desktop GoLiveSetupScreen + server gate.
  const STREAM_FOLLOWER_GATE = 100;
  const isAdmin = profile?.role === 'admin' || (profile?.email || '').toLowerCase() === 'vergenerd@gmail.com';
  const followerCount = profile?.followerCount || 0;
  const followerGated = !isAdmin && streamTier === 'free' && followerCount < STREAM_FOLLOWER_GATE;
  const followersToGo = Math.max(0, STREAM_FOLLOWER_GATE - followerCount);

  const goLive = async () => {
    if (starting) return;
    if (followerGated) { showToast(`You need ${STREAM_FOLLOWER_GATE} followers to go live publicly — you have ${followerCount}. Squad streams are free.`, 'error'); return; }
    if (!title.trim()) { showToast('Add a title', 'error'); return; }
    setStarting(true);
    try {
      const callable = httpsCallable(getFunctions(undefined, 'europe-west1'), 'createStreamSession');
      const vw = videoRef.current?.videoWidth || 0;
      const vh = videoRef.current?.videoHeight || 0;
      const orientation = vh > vw && vw > 0 ? 'portrait' : 'landscape';
      const { data } = await callable({ kind: 'public', mode: ingestMode, title: title.trim(), game: null, boost: null, orientation, language: streamLang || null, audience });
      try {
        await updateDoc(doc(db, 'streams', data.streamId), {
          description: description.trim().slice(0, 280) || null,
          tags: tags.slice(0, 12),
          coverUrl: coverUrl || null,
          audience,
          notifyFollowers: !!notifyFollowers,
          requestedResolution: rendition.label,
          requestedBitrateKbps: rendition.kbps,
          goal: (tipGoalOn && tipGoalCoins > 0)
            ? { active: true, scope: 'stream', targetCoins: Math.max(0, tipGoalCoins | 0), reason: tipGoalReason.trim().slice(0, 80) || null, currentCoins: 0 }
            : null,
          setupCompletedAt: serverTimestamp(),
        });
      } catch (e) { console.warn('stream metadata update failed (non-fatal):', e); }
      persistStreamDefaults();
      showToast(data.boosted ? 'Boost charged · stream ready' : 'Stream ready', 'success');
      navigate(`/broadcast/${data.streamId}`);
    } catch (err) {
      showToast(err?.message || 'Could not start stream', 'error');
    } finally { setStarting(false); }
  };

  const scheduleStream = async () => {
    if (scheduling) return;
    if (followerGated) { showToast(`You need ${STREAM_FOLLOWER_GATE} followers to stream publicly — you have ${followerCount}.`, 'error'); return; }
    if (!title.trim()) { showToast('Add a title', 'error'); return; }
    const startMs = scheduledAt ? new Date(scheduledAt).getTime() : 0;
    if (!startMs || Number.isNaN(startMs)) { showToast('Pick a date & time', 'error'); return; }
    if (startMs < Date.now() + 60_000) { showToast('Pick a time at least a minute from now', 'error'); return; }
    if (startMs > Date.now() + 30 * 24 * 3600_000) { showToast('Schedule within the next 30 days', 'error'); return; }
    if (!currentUser?.uid) { showToast('Sign in required', 'error'); return; }
    setScheduling(true);
    try {
      await addDoc(collection(db, 'scheduled_streams'), {
        hostUid: currentUser.uid,
        hostUsername: profile?.username || profile?.displayName || null,
        hostAvatar: profile?.avatar || null,
        title: title.trim(),
        description: description.trim().slice(0, 280) || null,
        coverUrl: coverUrl || null,
        tags: tags.slice(0, 12),
        audience,
        notifyFollowers: !!notifyFollowers,
        language: streamLang || null,
        scheduledStart: startMs,
        goal: (tipGoalOn && tipGoalCoins > 0)
          ? { active: true, scope: 'stream', targetCoins: Math.max(0, tipGoalCoins | 0), reason: tipGoalReason.trim().slice(0, 80) || null }
          : null,
        status: 'scheduled',
        createdAt: serverTimestamp(),
      });
      persistStreamDefaults();
      showToast("Stream scheduled — we'll remind you and your followers.", 'success');
      navigate('/');
    } catch (err) { showToast(err?.message || 'Could not schedule', 'error'); } finally { setScheduling(false); }
  };

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, '');
    if (!t || tags.includes(t)) return;
    setTags((prev) => [...prev, t]); setTagInput('');
  };

  const handleCoverFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || coverBusy) return;
    if (!file.type.startsWith('image/')) { showToast('Pick an image for your cover', 'error'); return; }
    setCoverBusy(true);
    try {
      const compressed = await compressMedia(file, streamTier, 'post');
      const { url } = await uploadToR2(compressed, 'banner');
      setCoverUrl(url);
      setCoverHistory((h) => [url, ...h.filter((u) => u !== url)].slice(0, 6));
      showToast('Cover added', 'success');
    } catch (err) { showToast(err?.message || 'Cover upload failed', 'error'); } finally { setCoverBusy(false); }
  };

  return (
    <div style={{ background: C.bg, minHeight: '100%', color: C.text, fontFamily: '"Inter","DM Sans",system-ui,sans-serif' }}>
      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 40, display: 'flex', alignItems: 'center', gap: 8,
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)', paddingLeft: 12, paddingRight: 12, paddingBottom: 10,
        background: 'rgba(9,9,15,0.86)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${C.divider}`,
      }}>
        <button type="button" onClick={() => navigate(-1)} aria-label="Back" style={iconBtn}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back_ios_new</span>
        </button>
        <div style={{ flex: 1, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18 }}>Go Live</div>
        <button type="button" onClick={() => setScheduleOn((v) => !v)} style={{ ...iconBtn, width: 'auto', padding: '0 12px', gap: 6, color: scheduleOn ? C.purpleLight : C.textDim, borderColor: scheduleOn ? C.purpleLight : C.border }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{scheduleOn ? 'event_available' : 'schedule'}</span>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{scheduleOn ? 'Later' : 'Later'}</span>
        </button>
      </div>

      <div style={{ padding: '14px 14px calc(env(safe-area-inset-bottom, 0px) + 96px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Preview */}
        <div style={{ position: 'relative', aspectRatio: '16/9', width: '100%', background: '#000', borderRadius: 16, overflow: 'hidden', border: `1px solid ${C.border}` }}>
          <video ref={videoRef} autoPlay muted playsInline style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#000',
            opacity: previewReady && (camOn || screenSharing) ? 1 : 0,
            transform: screenSharing ? 'none' : 'scaleX(-1)',
          }} />
          {(!previewReady || (!camOn && !screenSharing)) && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, textAlign: 'center', padding: 24, background: 'radial-gradient(circle at 50% 60%, #1a1030 0%, #0a0a14 70%)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 44, color: C.textMuted }}>
                {previewError ? 'videocam_off' : !previewStarted ? 'videocam' : !camOn && !screenSharing ? 'videocam_off' : 'hourglass_empty'}
              </span>
              <div style={{ fontSize: 13, color: C.textDim, maxWidth: 300, lineHeight: 1.45 }}>
                {previewError ? previewError
                  : !previewStarted ? 'Camera off. Enable it to preview before going live — nothing is recorded or shared until you go live.'
                  : !camOn && !screenSharing ? 'Camera off. Turn on Camera or share Screen to preview.'
                  : 'Starting preview…'}
              </div>
              {(!previewStarted || previewError) && (
                <button type="button" onClick={acquireCamera} style={{ ...primaryBtn, marginTop: 2 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>videocam</span>
                  {previewError ? 'Retry' : 'Enable camera & mic'}
                </button>
              )}
            </div>
          )}
          <div style={{ position: 'absolute', top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: 'rgba(0,0,0,0.55)', borderRadius: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em' }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: previewReady ? C.green : C.textMuted }} />
            {screenSharing ? 'SCREEN' : 'PREVIEW'}
          </div>
          <div style={{ position: 'absolute', top: 10, right: 12 }}>
            <MicMeter level={micLevel} muted={!previewStarted || !micOn} />
          </div>
        </div>

        {/* Device controls */}
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { id: 'mic', label: micOn ? 'Mic' : 'Muted', icon: micOn ? 'mic' : 'mic_off', on: micOn, onClick: toggleMic },
            { id: 'cam', label: 'Camera', icon: camOn ? 'videocam' : 'videocam_off', on: camOn, onClick: toggleCam },
            { id: 'screen', label: screenSharing ? 'Sharing' : 'Screen', icon: 'cast', on: screenSharing, onClick: toggleScreen },
          ].map((d) => (
            <button key={d.id} type="button" onClick={d.onClick} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '12px 6px',
              background: d.on ? C.purpleSoft : 'rgba(255,255,255,0.04)',
              border: d.on ? `1px solid ${C.purple}` : `1px solid ${C.borderSoft}`,
              borderRadius: 14, color: d.on ? C.purpleLight : C.textDim, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 22 }}>{d.icon}</span>
              {d.label}
            </button>
          ))}
        </div>

        {previewStarted && (videoDevices.length > 1 || audioDevices.length > 1) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {videoDevices.length > 1 && <DevicePicker icon="videocam" label="Camera" value={camDeviceId} devices={videoDevices} fallback="Default camera" onChange={setCamDeviceId} />}
            {audioDevices.length > 1 && <DevicePicker icon="mic" label="Microphone" value={micDeviceId} devices={audioDevices} fallback="Default microphone" onChange={setMicDeviceId} />}
          </div>
        )}

        {/* Twitch mirror entry */}
        <button type="button" onClick={() => navigate('/settings/linked-accounts')} style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 14,
          cursor: 'pointer', textAlign: 'left', background: 'rgba(145,70,255,0.10)', border: '1px solid rgba(145,70,255,0.35)',
        }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, background: '#9146FF', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flexShrink: 0 }}>T</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: C.text }}>Already stream on Twitch?</span>
            <span style={{ display: 'block', fontSize: 11.5, color: C.textDim, lineHeight: 1.35 }}>Connect once and your Twitch streams appear on VERGR automatically, chat synced.</span>
          </span>
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: C.purpleLight }}>chevron_right</span>
        </button>

        {scheduleOn && (
          <Card>
            <SectionHeader>When</SectionHeader>
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
              min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
              style={{ ...input, colorScheme: 'dark' }} />
          </Card>
        )}

        {/* Basic info */}
        <Card>
          <SectionHeader>Basic info</SectionHeader>
          <Label>Title</Label>
          <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 140))} placeholder="Give your stream a title…" style={input} />
          <Label>Description</Label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value.slice(0, 280))} placeholder="What's this stream about?" style={{ ...input, height: 72, resize: 'vertical', fontFamily: 'inherit' }} />
          <Label>Tags</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 12px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: 12 }}>
            {tags.map((t) => (
              <span key={t} style={tagPill}>#{t}<span style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => setTags((p) => p.filter((x) => x !== t))}>×</span></span>
            ))}
            <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} placeholder="+ Add" style={{ background: 'transparent', border: 'none', color: C.text, fontSize: 13, outline: 'none', minWidth: 80, padding: '4px 6px' }} />
          </div>
          <Label>Cover image</Label>
          <input ref={coverInputRef} type="file" accept="image/*" onChange={handleCoverFile} style={{ display: 'none' }} />
          {coverUrl ? (
            <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', borderRadius: 12, overflow: 'hidden', border: `1px solid ${C.border}` }}>
              <img src={coverUrl} alt="cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => coverInputRef.current?.click()} disabled={coverBusy} style={coverChip}><span className="material-symbols-outlined" style={{ fontSize: 14 }}>edit</span></button>
                <button type="button" onClick={() => setCoverUrl('')} style={coverChip}><span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span></button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => coverInputRef.current?.click()} disabled={coverBusy} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '13px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: `1px dashed ${C.border}`, color: C.textDim, fontSize: 13, fontWeight: 700, cursor: coverBusy ? 'wait' : 'pointer', width: '100%' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add_photo_alternate</span>
              {coverBusy ? 'Uploading…' : 'Add a cover image'}
            </button>
          )}
          {coverHistory.length > 0 && (
            <>
              <Label>Use again</Label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {coverHistory.map((u) => (
                  <button key={u} type="button" onClick={() => setCoverUrl(u)} title="Use this cover" style={{
                    width: 72, height: 40, borderRadius: 8, overflow: 'hidden', padding: 0, cursor: 'pointer',
                    border: u === coverUrl ? `2px solid ${C.purpleLight}` : `1px solid ${C.border}`,
                  }}>
                    <img src={u} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </button>
                ))}
              </div>
            </>
          )}
        </Card>

        {/* Audience */}
        <Card>
          <SectionHeader>Audience</SectionHeader>
          <div style={{ display: 'flex', gap: 8 }}>
            {[{ id: 'public', label: 'Public', icon: 'public' }, { id: 'followers', label: 'Followers', icon: 'favorite' }, { id: 'friends', label: 'Friends', icon: 'group' }].map((a) => (
              <button key={a.id} type="button" onClick={() => setAudience(a.id)} style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '12px 6px',
                background: audience === a.id ? C.purpleSoft : 'rgba(255,255,255,0.04)',
                border: audience === a.id ? `1px solid ${C.purple}` : `1px solid ${C.border}`,
                borderRadius: 12, color: audience === a.id ? C.purpleLight : C.textDim, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{a.icon}</span>{a.label}
              </button>
            ))}
          </div>
          {audience !== 'friends' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, color: C.textDim }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: C.purpleLight }}>notifications_active</span>
              <span style={{ flex: 1 }}>Notify followers when I go live</span>
              <Toggle checked={notifyFollowers} onChange={setNotifyFollowers} />
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, color: C.textDim }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: C.purpleLight }}>translate</span>
            <span style={{ flex: 1 }}>Stream language</span>
            <select
              value={streamLang}
              onChange={(e) => setStreamLang(e.target.value)}
              style={{
                padding: '8px 12px', background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${C.border}`, borderRadius: 10, color: C.text,
                fontSize: 13, fontWeight: 700,
              }}
            >
              {SUPPORTED_LANGS.map((code) => (
                <option key={code} value={code}>{LANG_LABELS[code] || code}</option>
              ))}
            </select>
          </div>
        </Card>

        {/* Quality */}
        <Card>
          <SectionHeader>Stream quality</SectionHeader>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 20, color: C.purpleLight }}>high_quality</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{rendition.label}</div>
              <div style={{ fontSize: 11, color: C.textDim }}>Up to {(rendition.kbps / 1000).toFixed(1)} Mbps · {rendition.planLabel} plan</div>
            </div>
          </div>
          {ingestMode === 'rtmp' && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.divider}`, fontSize: 11.5, color: C.textDim, lineHeight: 1.5 }}>
              In OBS, set bitrate to <strong style={{ color: '#fff' }}>≤ {rendition.kbps.toLocaleString()} kbps</strong>, keyframe interval <strong style={{ color: '#fff' }}>2s</strong>. Higher is throttled.
            </div>
          )}
          {streamTier !== 'pro' && (
            <button type="button" onClick={() => navigate('/settings/subscription')} style={{ ...primaryBtn, marginTop: 12, width: '100%', justifyContent: 'center' }}>
              Upgrade for {streamTier === 'free' ? '720p / 1080p' : '1080p'}
            </button>
          )}
        </Card>

        {/* Tips & goal */}
        <Card>
          <SectionHeader>Tips & goal</SectionHeader>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11.5, color: C.textDim, lineHeight: 1.45, marginBottom: 12 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: C.purpleLight }}>volunteer_activism</span>
            Viewers tip you in coins while live. Vergr pays you a share of that revenue, 50% to 80%.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Set a tip goal</span>
            <Toggle checked={tipGoalOn} onChange={setTipGoalOn} />
          </div>
          {tipGoalOn && (
            <>
              <Label>Goal amount</Label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: 12 }}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill={C.purpleLight}><polygon points="8,1 10,6 15,6 11,9.5 12.5,15 8,11.5 3.5,15 5,9.5 1,6 6,6" /></svg>
                <input type="number" min={0} value={tipGoalCoins} onChange={(e) => setTipGoalCoins(Math.max(0, Number(e.target.value)))} placeholder="0" style={{ flex: 1, background: 'transparent', border: 'none', color: '#fff', fontSize: 15, fontWeight: 700, outline: 'none' }} />
                <span style={{ fontSize: 12, color: C.textDim }}>coins</span>
              </div>
              <Label>What's it for? (optional)</Label>
              <input value={tipGoalReason} onChange={(e) => setTipGoalReason(e.target.value.slice(0, 80))} placeholder="e.g. New mic fund" style={input} />
            </>
          )}
        </Card>

        {/* Broadcast from */}
        <Card>
          <SectionHeader>Broadcast from</SectionHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <IngestCard active={ingestMode === 'browser'} disabled={!browserCanIngest()} onClick={() => setIngestMode('browser')} icon="captive_portal" title="Browser broadcast" desc="Go live from this app. Best for quick streams, just-chatting." note={!browserCanIngest() ? 'Unsupported on this device' : null} />
            <IngestCard active={ingestMode === 'rtmp'} onClick={() => setIngestMode('rtmp')} icon="cast" title="OBS / RTMP" desc="Push from OBS or any RTMP encoder. Best quality + game capture." />
          </div>
        </Card>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.textDim, padding: '0 2px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 14, color: C.purpleLight }}>info</span>
          Review our{' '}
          <button type="button" onClick={() => navigate('/settings/help')} style={{ background: 'none', border: 'none', color: C.purpleLight, cursor: 'pointer', fontSize: 12, padding: 0 }}>Community Guidelines</button>{' '}before going live.
        </div>
      </div>

      {/* Sticky CTA */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: '12px 14px calc(env(safe-area-inset-bottom, 0px) + 12px)', background: 'linear-gradient(to top, rgba(9,9,15,1) 65%, rgba(9,9,15,0))', zIndex: 40 }}>
        {followerGated && (
          <div style={{ marginBottom: 10, padding: '11px 13px', borderRadius: 13, background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.4)' }}>
            <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 19, color: '#f59e0b' }}>lock</span>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Public live unlocks at {STREAM_FOLLOWER_GATE} followers</div>
            </div>
            <div style={{ fontSize: 11.5, color: '#a0a0b8', marginTop: 5, lineHeight: 1.5 }}>
              You have <b style={{ color: '#fff' }}>{followerCount}</b> — {followersToGo} to go. Squad streams to your crew are free anytime.
            </div>
            <div style={{ marginTop: 8, height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(100, (followerCount / STREAM_FOLLOWER_GATE) * 100)}%`, background: '#f59e0b' }} />
            </div>
          </div>
        )}
        {scheduleOn ? (
          <button type="button" onClick={scheduleStream} disabled={scheduling || followerGated} style={{ ...primaryBtn, width: '100%', justifyContent: 'center', padding: 16, fontSize: 15, opacity: (scheduling || followerGated) ? 0.5 : 1 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{followerGated ? 'lock' : 'event'}</span>
            {followerGated ? `${followersToGo} followers to go` : (scheduling ? 'Scheduling…' : 'Schedule stream')}
          </button>
        ) : (
          <button type="button" onClick={goLive} disabled={starting || followerGated} style={{ ...primaryBtn, width: '100%', justifyContent: 'center', padding: 16, fontSize: 15, opacity: (starting || followerGated) ? 0.5 : 1 }}>
            {followerGated
              ? <span className="material-symbols-outlined" style={{ fontSize: 18 }}>lock</span>
              : <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="white" strokeWidth="1.5" /><circle cx="8" cy="8" r="3" fill="white" /></svg>}
            {followerGated ? `${followersToGo} followers to go live` : (starting ? 'Starting…' : 'Go Live')}
          </button>
        )}
      </div>
    </div>
  );
}

// ── primitives ──────────────────────────────────────────────────
function Card({ children }) {
  return <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 16 }}>{children}</div>;
}
function SectionHeader({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textDim, marginBottom: 12 }}>{children}</div>;
}
function Label({ children }) {
  return <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6, marginTop: 12 }}>{children}</div>;
}
function IngestCard({ active, disabled, onClick, icon, title, desc, note }) {
  return (
    <button type="button" onClick={disabled ? undefined : onClick} disabled={disabled} style={{
      textAlign: 'left', padding: '14px', background: active ? C.purpleSoft : 'rgba(255,255,255,0.04)',
      border: active ? `1px solid ${C.purple}` : `1px solid ${C.border}`, borderRadius: 14, color: C.text,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1, display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%',
    }}>
      <span className="material-symbols-outlined" style={{ fontSize: 24, color: active ? C.purpleLight : C.textDim, marginTop: 2 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.4 }}>{desc}</div>
        {note && <div style={{ fontSize: 11, color: C.amber, marginTop: 4 }}>{note}</div>}
      </div>
    </button>
  );
}
function DevicePicker({ icon, label, value, devices, fallback, onChange }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.textDim, marginBottom: 6 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{icon}</span>{label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: 12, padding: '2px 12px' }}>
        <select value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: C.text, fontSize: 13, padding: '11px 0', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none' }}>
          <option value="" style={{ background: C.card }}>{fallback}</option>
          {devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId} style={{ background: C.card }}>{d.label || `${label} ${i + 1}`}</option>)}
        </select>
        <span className="material-symbols-outlined" style={{ fontSize: 14, color: C.textMuted }}>expand_more</span>
      </div>
    </label>
  );
}
function MicMeter({ level = 0, muted = false }) {
  const bars = 9;
  const lit = muted ? 0 : Math.round((level / 100) * bars);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 16, padding: '4px 8px', background: 'rgba(0,0,0,0.45)', borderRadius: 6 }}>
      {Array.from({ length: bars }).map((_, i) => {
        const on = i < lit;
        const color = i >= 7 ? C.red : i >= 5 ? C.amber : C.green;
        return <div key={i} style={{ width: 3, height: 4 + i * 1.1, background: on ? color : 'rgba(255,255,255,0.14)', borderRadius: 1, transition: 'background 0.06s linear' }} />;
      })}
    </div>
  );
}
function Toggle({ checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} style={{ width: 38, height: 22, borderRadius: 11, position: 'relative', background: checked ? `linear-gradient(135deg,${C.purple},${C.purpleLight})` : 'rgba(255,255,255,0.1)', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 2, left: checked ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }} />
    </button>
  );
}

const iconBtn = { width: 38, height: 38, borderRadius: 12, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, color: C.text, cursor: 'pointer' };
const primaryBtn = { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, border: 'none', borderRadius: 14, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', boxShadow: '0 0 16px rgba(123,31,255,0.4)' };
const input = { width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: 12, padding: '13px 15px', color: C.text, fontSize: 15, outline: 'none' };
const coverChip = { width: 30, height: 30, borderRadius: 8, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' };
const tagPill = { display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: C.purpleSoft, border: '1px solid rgba(180,79,255,0.3)', borderRadius: 20, fontSize: 12, color: C.purpleLight };
