// Go Live setup — redesigned per Claude Design.
// Preview area + device controls + numbered config sections + right side panel.
// Note: actual stream startup is unchanged (toast + navigate). Wire to real backend later.
import { useState, useEffect, useRef, useCallback } from 'react';
import { SUPPORTED_LANGS, LANG_LABELS, languageForCountry } from '../../utils/localePrefs';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, getDoc, updateDoc, serverTimestamp, addDoc, collection } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import TopBar from '../../components/TopBar';
import EventPickerModal from '../../components/tournament/EventPickerModal';
import PriceSheet from '../../components/monetization/PriceSheet';
import { browserCanIngest } from '../../utils/streamIngest';
import { uploadToR2 } from '../../utils/r2Storage';
import { compressMedia } from '../../utils/mediaCompression';
import { resolveTier } from '../../utils/tierSystem';

const C = {
  bg: '#09090f',
  card: '#12121e',
  cardSoft: '#0f0f1a',
  border: 'rgba(255,255,255,0.09)',
  borderSoft: 'rgba(255,255,255,0.06)',
  text: '#e8e8f0',
  textDim: '#a0a0b8',
  textMuted: '#6b7280',
  purple: '#7B1FFF',
  purpleLight: '#b44fff',
  purpleSoft: 'rgba(123,31,255,0.15)',
  gemBlue: '#3D7FFF',
  green: '#22c55e',
  red: '#ef4444',
  amber: '#f59e0b',
  divider: 'rgba(255,255,255,0.06)',
};

export default function GoLiveSetupScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const { isDesktop, isMobile } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  // Hydrate from the host's last-used stream defaults (persisted on every
  // successful go-live). Runs once when the profile arrives, only filling fields
  // the user hasn't already touched, so the common case is "title -> Go Live".
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

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  // Everything except the preview + title + Go Live lives under "Advanced", so
  // the common case is title -> Go Live (defaults are remembered, see below).
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Recently-used cover images (one-tap "use again" chips), newest first.
  const [coverHistory, setCoverHistory] = useState([]);
  // Audience knob = visibility within a public stream (everyone / followers-only / friends-only).
  // Squad streams are NOT started here — they're squad-dashboard only.
  const [audience, setAudience] = useState('public'); // public | followers | friends | ticketed
  const [ticketedEventId, setTicketedEventId] = useState(null);
  // Paid stream: charge coins for entry, with no event behind it. Distinct from
  // 'ticketed', which exists to fund a prize purse and is tied to an event; this
  // is a creator selling entry to their own broadcast, and it settles through
  // the same entitlement as a locked post. 0 = free.
  const [accessPrice, setAccessPrice] = useState(0);
  // Adult marker for this broadcast. Only offered once entry is PAID, and
  // force-cleared if the host drops the price back to free, so it can never be
  // left set on a stream that then goes out to a public feed.
  const [isNsfwStream, setIsNsfwStream] = useState(false);
  const [audioOnly, setAudioOnly] = useState(false);
  const [clipPolicy, setClipPolicy] = useState('everyone');
  const [accessSheet, setAccessSheet] = useState(false);
  const [ticketedEventName, setTicketedEventName] = useState('');
  const [showEventPicker, setShowEventPicker] = useState(false);
  // Promote a ticketed event on a NON-ticketed (public/followers) stream so
  // viewers can buy a ticket to it while watching. Independent of the gate.
  const [promotedEventId, setPromotedEventId] = useState(null);
  const [promotedEventName, setPromotedEventName] = useState('');
  const [showPromotePicker, setShowPromotePicker] = useState(false);
  // Spoken language of the broadcast — drives locality discovery (viewers can
  // filter/rank streams by language). Defaults from the host's country.
  const [streamLang, setStreamLang] = useState(() => languageForCountry(profile?.country));
  const [notifyFollowers, setNotifyFollowers] = useState(true);
  const [coverUrl, setCoverUrl] = useState('');
  const [coverBusy, setCoverBusy] = useState(false);
  const coverInputRef = useRef(null);

  // Streaming is single-rendition and tier-capped (LOCKED spec). The output
  // resolution/bitrate are NOT user-choosable — show the real cap per plan
  // instead of a fake picker that the rtmp watchdog would just disconnect.
  const streamTier = resolveTier(profile);
  const RENDITIONS = {
    free: { label: '480p · 30fps', kbps: 3000, planLabel: 'Free' },
    lite: { label: '720p · 60fps', kbps: 4500, planLabel: 'Lite' },
    pro:  { label: '1080p · 60fps', kbps: 6500, planLabel: 'Pro' },
  };
  const rendition = RENDITIONS[streamTier] || RENDITIONS.free;
  // Live streams earn TIPS (+ an optional tip goal). There is NO entry fee for a
  // stream — entry fees are a tournament-only concept.
  const [tipGoalOn, setTipGoalOn] = useState(false);
  const [tipGoalCoins, setTipGoalCoins] = useState(0);
  const [tipGoalReason, setTipGoalReason] = useState('');
  // (Tournament streams are a separate flow, started from the tournament screen.)
  // Ingest mode: 'browser' (fMP4 → vergr-ingest, default if supported) or 'rtmp' (OBS).
  const [ingestMode, setIngestMode] = useState(() => (browserCanIngest() ? 'browser' : 'rtmp'));
  // "Stream to both": relay the OBS feed to the streamer's Twitch too (the
  // backend has supported this since 2026-05-30 — createStreamSession
  // twitchMirror:true — but it never had a UI entry point until now).
  const twitchLinked = !!profile?.linkedAccounts?.twitch;
  const [mirrorToTwitch, setMirrorToTwitch] = useState(false);
  // Owner-configured chat-bridge nudge: a periodic message in the streamer's
  // OWN Twitch chat linking their Vergr channel. OFF by default, conservative
  // 20-minute interval (their channel + their message = within Twitch rules).
  const [twitchNudgeOn, setTwitchNudgeOn] = useState(false);
  const [twitchNudgeText, setTwitchNudgeText] = useState('');
  const [starting, setStarting] = useState(false);
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduledAt, setScheduledAt] = useState(''); // datetime-local string
  const [scheduling, setScheduling] = useState(false);

  // ── Real local preview (camera/screen + live mic meter) ──────────────────────
  const videoRef = useRef(null);
  const camStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const meterRafRef = useRef(0);
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [micLevel, setMicLevel] = useState(0); // 0..100 real RMS
  const [previewReady, setPreviewReady] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  // Camera/mic are opt-in: we do NOT grab devices just because the page loaded.
  // The user enables the preview explicitly (and it's released on leave).
  const [previewStarted, setPreviewStarted] = useState(false);
  // Device selection (which camera / which mic). Labels only populate after the
  // first getUserMedia grant, so we enumerate lazily once the preview starts.
  const [videoDevices, setVideoDevices] = useState([]);
  const [audioDevices, setAudioDevices] = useState([]);
  const [camDeviceId, setCamDeviceId] = useState('');
  const [micDeviceId, setMicDeviceId] = useState('');

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(list.filter(d => d.kind === 'videoinput'));
      setAudioDevices(list.filter(d => d.kind === 'audioinput'));
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
      camStreamRef.current?.getTracks().forEach(t => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: camDeviceId
          ? { deviceId: { exact: camDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: {
          ...(micDeviceId ? { deviceId: { exact: micDeviceId } } : {}),
          echoCancellation: true, noiseSuppression: true,
        },
      });
      camStreamRef.current = stream;
      stream.getVideoTracks().forEach(t => (t.enabled = camOn));
      stream.getAudioTracks().forEach(t => (t.enabled = micOn));
      if (videoRef.current && !screenSharing) videoRef.current.srcObject = stream;
      setPreviewReady(true);
      setPreviewStarted(true);
      refreshDevices();
      if (!screenSharing) attachMeter(stream);
    } catch (err) {
      console.warn('preview getUserMedia failed:', err);
      setPreviewReady(false);
      setPreviewError('Camera/mic blocked. Allow access in your browser, or broadcast via OBS below.');
    }
  }, [camOn, micOn, screenSharing, attachMeter, camDeviceId, micDeviceId, refreshDevices]);

  // Re-acquire when the user picks a different camera/mic (preview already on).
  const prevDevicesRef = useRef('');
  useEffect(() => {
    const key = `${camDeviceId}|${micDeviceId}`;
    if (previewStarted && !screenSharing && prevDevicesRef.current && prevDevicesRef.current !== key) {
      acquireCamera();
    }
    prevDevicesRef.current = key;
  }, [camDeviceId, micDeviceId, previewStarted, screenSharing, acquireCamera]);

  // Release ALL devices when leaving the screen (do NOT auto-acquire on mount —
  // the camera only turns on when the user explicitly enables the preview).
  const stopAllDevices = useCallback(() => {
    cancelAnimationFrame(meterRafRef.current);
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
    camStreamRef.current?.getTracks().forEach(t => t.stop());
    camStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setMicLevel(0);
    setPreviewReady(false);
    setScreenSharing(false);
    setPreviewStarted(false);
  }, []);

  useEffect(() => stopAllDevices, [stopAllDevices]);

  const toggleMic = () => {
    if (!previewStarted) { setMicOn(true); acquireCamera(); return; }
    const next = !micOn;
    setMicOn(next);
    camStreamRef.current?.getAudioTracks().forEach(t => (t.enabled = next));
    if (!next) setMicLevel(0);
  };
  const toggleCam = () => {
    if (!previewStarted) { setCamOn(true); acquireCamera(); return; }
    const next = !camOn;
    setCamOn(next);
    camStreamRef.current?.getVideoTracks().forEach(t => (t.enabled = next));
  };
  const toggleScreen = async () => {
    if (screenSharing) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
      setScreenSharing(false);
      if (videoRef.current) videoRef.current.srcObject = camStreamRef.current;
      attachMeter(camStreamRef.current);
      return;
    }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      screenStreamRef.current = s;
      setScreenSharing(true);
      setPreviewStarted(true);
      setPreviewReady(true);
      if (videoRef.current) videoRef.current.srcObject = s;
      attachMeter(s.getAudioTracks().length ? s : camStreamRef.current);
      // When the user stops sharing via the browser chrome, fall back to camera.
      s.getVideoTracks()[0]?.addEventListener('ended', () => {
        screenStreamRef.current = null;
        setScreenSharing(false);
        if (videoRef.current) videoRef.current.srcObject = camStreamRef.current;
        attachMeter(camStreamRef.current);
      });
    } catch (err) {
      console.warn('getDisplayMedia failed:', err);
    }
  };

  // Save the host's stream setup so the next go-live is prefilled. coverHistory
  // keeps the last 6 covers (deduped, newest first) for one-tap reuse.
  const persistStreamDefaults = useCallback(() => {
    if (!currentUser?.uid) return;
    const history = (() => {
      if (!coverUrl) return coverHistory.slice(0, 6);
      return [coverUrl, ...coverHistory.filter((u) => u !== coverUrl)].slice(0, 6);
    })();
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

  // Public live streaming (every audience started here is `kind:'public'`) is
  // gated to 100 followers for FREE accounts — admins + paid plans bypass.
  // Surfaced up front (banner + button state) so a new user is never left
  // staring at a silently-disabled button wondering why (the exact thing that
  // made a blind tester give up and ask the founder).
  const STREAM_FOLLOWER_GATE = 100;
  const isAdmin = profile?.role === 'admin' || (currentUser?.email || '').toLowerCase() === 'vergenerd@gmail.com';
  const planTier = resolveTier(profile);
  const followerCount = profile?.followerCount || 0;

  // ⚠⚠ THE ADMIN KILL SWITCH WAS DEAD ON THIS SCREEN (found 2026-08-27).
  //
  // `/admin/config` offers "Min-Follower Requirement (Go Live)", it writes
  // `app_config/general.streamFollowerGateEnabled`, it is in the adminConfig
  // write allowlist, and `functions/streaming.js:256` honours it correctly:
  //   const followerGateOn = cfg.streamFollowerGateEnabled !== false;
  //
  // But THIS SCREEN never read it. It hardcoded the 100 and disabled the button
  // locally, so the server — which would have allowed the stream — was never
  // asked. The founder had the toggle OFF the entire time and was still gated,
  // with no way to tell the switch was doing nothing.
  //
  // Same class as the three inert kill switches in CLAUDE.md (payoutsPaused,
  // conversionsPaused, tipsPaused): a control that is trusted and does nothing
  // is worse than no control. A server-side gate needs its CLIENT to read the
  // same switch, or the client silently becomes the real policy.
  const [gateEnabled, setGateEnabled] = useState(true);   // fail CLOSED while loading
  useEffect(() => {
    let alive = true;
    getDoc(doc(db, 'app_config', 'general'))
      .then((s) => { if (alive) setGateEnabled(s.data()?.streamFollowerGateEnabled !== false); })
      // ⚠ On a read failure the gate STAYS ON. Failing open would let anyone
      // stream publicly whenever the config read hiccups.
      .catch(() => { if (alive) setGateEnabled(true); });
    return () => { alive = false; };
  }, []);

  const followerGated = gateEnabled && !isAdmin && planTier === 'free' && followerCount < STREAM_FOLLOWER_GATE;
  const followersToGo = Math.max(0, STREAM_FOLLOWER_GATE - followerCount);

  const goLive = async () => {
    if (starting) return;
    if (followerGated) {
      showToast(`You need ${STREAM_FOLLOWER_GATE} followers to go live publicly. You have ${followerCount}. Squad streams are free.`, 'error');
      return;
    }
    if (!title.trim()) {
      showToast('Add a title', 'error');
      return;
    }
    if (audience === 'ticketed' && !ticketedEventId) {
      showToast('Pick the ticketed event this stream is for', 'error');
      return;
    }
    setStarting(true);
    try {
      const callable = httpsCallable(
        getFunctions(undefined, 'europe-west1'),
        'createStreamSession',
      );
      // Detect orientation from the live preview so discovery can split
      // desktop (landscape) vs mobile (portrait) streams.
      const vw = videoRef.current?.videoWidth || 0;
      const vh = videoRef.current?.videoHeight || 0;
      const orientation = vh > vw && vw > 0 ? 'portrait' : 'landscape';
      const { data } = await callable({
        kind: 'public',
        mode: ingestMode,
        title: title.trim(),
        game: null, // game selection removed from the live-stream flow (tournament streams set their own)
        boost: null, // server defaults: free=true, paid=false
        orientation,
        language: streamLang || null,
        audience, // server sets discoverable/unlisted from this (honest enforcement)
        // ⚠ A REAL FORMAT, NOT A CAMERA THAT HAPPENS TO BE OFF. The field was read
        // in two places and written by nothing, so the viewer could never draw the
        // audio stage. Founder-approved 2026-09-02.
        audioOnly,
        // ⚠ WHO may clip. HOW MUCH stays the clipper's own plan, enforced separately
        // in functions/streamClips.js. Founder, 2026-09-02.
        clipPolicy,
        // A paid stream's playback URL is withheld from the world-readable
        // stream doc and served only by getAccess. See functions/streaming.js.
        access: accessPrice > 0 ? { mode: 'paid', priceCoins: accessPrice } : { mode: 'free' },
        // Only meaningful on a paid stream; the server ignores it otherwise.
        contentRating: accessPrice > 0 && isNsfwStream ? 'nsfw' : 'general',
        tournamentId: audience === 'ticketed' ? ticketedEventId : null, // ticket-gate target
        // "Stream to both" — server validates the RTMP path + mirror secrets.
        twitchMirror: mirrorToTwitch && ingestMode === 'rtmp' && twitchLinked,
      });
      // Persist setup-only metadata the callable doesn't capture.
      try {
        await updateDoc(doc(db, 'streams', data.streamId), {
          description: description.trim().slice(0, 280) || null,
          tags: tags.slice(0, 12),
          coverUrl: coverUrl || null,
          audience,
          notifyFollowers: !!notifyFollowers,
          // Ticket-selling on the stream: ticketed streams sell their own gated
          // event; other streams can promote a chosen ticketed event.
          promotedEventId: audience === 'ticketed' ? ticketedEventId : (promotedEventId || null),
          requestedResolution: rendition.label,
          requestedBitrateKbps: rendition.kbps,
          // Live streams monetize via TIPS (creator is paid their revenue share) + a tip goal.
          // No entry fee (that's tournaments only).
          goal: (tipGoalOn && tipGoalCoins > 0)
            ? { active: true, scope: 'stream', targetCoins: Math.max(0, tipGoalCoins | 0), reason: tipGoalReason.trim().slice(0, 80) || null, currentCoins: 0 }
            : null,
          // Chat-bridge nudge (owner-configured, off by default): the relay
          // posts this in the streamer's OWN Twitch chat every 20 minutes
          // while the mirror runs.
          twitchNudge: (mirrorToTwitch && ingestMode === 'rtmp' && twitchNudgeOn && twitchNudgeText.trim())
            ? { enabled: true, intervalMin: 20, text: twitchNudgeText.trim().slice(0, 200) }
            : null,
          setupCompletedAt: serverTimestamp(),
        });
      } catch (e) {
        console.warn('stream metadata update failed (non-fatal):', e);
      }
      // Remember these settings for next time (one-tap re-go-live).
      persistStreamDefaults();
      showToast(data.boosted ? 'Boost charged · stream ready' : 'Stream ready', 'success');
      navigate(`/broadcast/${data.streamId}`);
    } catch (err) {
      const msg = err?.message || 'Could not start stream';
      showToast(msg, 'error');
    } finally {
      setStarting(false);
    }
  };

  // Schedule for later: create a scheduled_streams doc (NO session/streamKey/
  // boost yet — that happens when the host actually goes live at the time). The
  // notifyScheduledStreams cron reminds the host + followers ~10 min before.
  const scheduleStream = async () => {
    if (scheduling) return;
    if (followerGated) { showToast(`You need ${STREAM_FOLLOWER_GATE} followers to stream publicly. You have ${followerCount}.`, 'error'); return; }
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
      showToast('Stream scheduled. We\'ll remind you and your followers.', 'success');
      navigate('/');
    } catch (err) {
      showToast(err?.message || 'Could not schedule', 'error');
    } finally {
      setScheduling(false);
    }
  };

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, '');
    if (!t || tags.includes(t)) return;
    setTags(prev => [...prev, t]);
    setTagInput('');
  };

  const handleCoverFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || coverBusy) return;
    if (!file.type.startsWith('image/')) { showToast('Pick an image for your cover', 'error'); return; }
    setCoverBusy(true);
    try {
      const tier = resolveTier(profile);
      const compressed = await compressMedia(file, tier, 'post');
      const { url } = await uploadToR2(compressed, 'banner');
      setCoverUrl(url);
      setCoverHistory((h) => [url, ...h.filter((u) => u !== url)].slice(0, 6));
      showToast('Cover added', 'success');
    } catch (err) {
      showToast(err?.message || 'Cover upload failed', 'error');
    } finally {
      setCoverBusy(false);
    }
  };

  return (
    <div style={{
      background: C.bg, minHeight: '100%', color: C.text,
      fontFamily: '"DM Sans", system-ui, sans-serif',
    }}>
      {isMobile && <TopBar title="Go Live" showBack />}

      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 24px 16px', flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 22, fontWeight: 800 }}>
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke={C.purpleLight} strokeWidth="1.5"/>
              <circle cx="8" cy="8" r="3" fill={C.purpleLight}/>
              <circle cx="8" cy="8" r="5.5" stroke={C.purpleLight} strokeWidth="1" opacity="0.4"/>
            </svg>
            Go Live
          </div>
          <div style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>
            Broadcast to the world or your squad. You're live in seconds.
          </div>
        </div>
        {followerGated && (
          <div style={{
            margin: '0 0 4px', padding: '14px 16px', borderRadius: 14,
            background: 'rgba(245,158,11,0.10)', border: `1px solid ${C.amber}55`,
            display: 'flex', gap: 12, alignItems: 'flex-start',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 22, color: C.amber, flex: 'none' }}>lock</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                Public live streaming unlocks at {STREAM_FOLLOWER_GATE} followers
              </div>
              <div style={{ fontSize: 12.5, color: C.textDim, marginTop: 3, lineHeight: 1.5 }}>
                You have <b style={{ color: C.text }}>{followerCount}</b>, {followersToGo} to go. This keeps brand-new
                accounts from spamming live. In the meantime you can host a <b style={{ color: C.text }}>free Squad stream</b> to your crew.
              </div>
              <div style={{ marginTop: 9, height: 6, borderRadius: 999, background: '#2A2A38', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (followerCount / STREAM_FOLLOWER_GATE) * 100)}%`, background: C.amber, borderRadius: 999 }} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => navigate('/squads')}
                  style={{ background: C.amber, color: '#1a1205', border: 'none', borderRadius: 9, padding: '7px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                  Stream to my Squad
                </button>
                <button type="button" onClick={() => navigate('/explore')}
                  style={{ background: 'transparent', color: C.textDim, border: `1px solid ${C.border}`, borderRadius: 9, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                  Find people to follow
                </button>
              </div>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            onClick={acquireCamera}
            style={btnOutline}
            title="Re-check camera and mic"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>refresh</span>
            Test Devices
          </button>
          <button
            type="button"
            onClick={() => setScheduleOn(v => !v)}
            style={{ ...btnOutline, borderColor: scheduleOn ? C.purpleLight : C.border, color: scheduleOn ? C.purpleLight : C.textDim }}
            title="Schedule this stream for later"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{scheduleOn ? 'event_available' : 'schedule'}</span>
            {scheduleOn ? 'Scheduling' : 'Later'}
          </button>
          {scheduleOn && (
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
              style={{
                background: C.cardSoft, border: `1px solid ${C.border}`, borderRadius: 10,
                color: C.text, padding: '8px 10px', fontSize: 13, colorScheme: 'dark',
              }}
            />
          )}
          {scheduleOn ? (
            <button
              type="button"
              onClick={scheduleStream}
              disabled={scheduling || followerGated}
              title={followerGated ? `Reach ${STREAM_FOLLOWER_GATE} followers to stream publicly` : undefined}
              style={{ ...btnPrimary, opacity: (scheduling || followerGated) ? 0.5 : 1, cursor: followerGated ? 'not-allowed' : (scheduling ? 'wait' : 'pointer') }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{followerGated ? 'lock' : 'event'}</span>
              {followerGated ? `${followersToGo} followers to go` : (scheduling ? 'Scheduling…' : 'Schedule')}
            </button>
          ) : (
            <button
              type="button"
              onClick={goLive}
              disabled={starting || followerGated}
              title={followerGated ? `Reach ${STREAM_FOLLOWER_GATE} followers to stream publicly` : undefined}
              style={{ ...btnPrimary, opacity: (starting || followerGated) ? 0.5 : 1, cursor: followerGated ? 'not-allowed' : (starting ? 'wait' : 'pointer') }}
            >
              {followerGated ? (
                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>lock</span>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" stroke="white" strokeWidth="1.5"/>
                  <circle cx="8" cy="8" r="3" fill="white"/>
                </svg>
              )}
              {followerGated ? `${followersToGo} followers to go live` : (starting ? 'Starting…' : 'Go Live')}
            </button>
          )}
        </div>
      </div>

      {/* Twitch: not linked → connect banner; linked → the "Stream to both"
          mirror toggle (the relay-out has existed since May but had no UI). */}
      <div style={{ padding: '0 24px 12px' }}>
        {!twitchLinked ? (
          <button
            type="button"
            onClick={() => navigate('/settings/linked-accounts')}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
              background: 'rgba(145,70,255,0.10)', border: '1px solid rgba(145,70,255,0.35)',
            }}
          >
            <span style={{
              width: 32, height: 32, borderRadius: 8, background: '#9146FF', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flexShrink: 0,
            }}>T</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: C.text }}>Already stream on Twitch?</span>
              <span style={{ display: 'block', fontSize: 11.5, color: C.textDim }}>
                Connect Twitch once and your Twitch streams appear live on VERGR automatically, chat synced. No OBS changes.
              </span>
            </span>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#B44FFF' }}>chevron_right</span>
          </button>
        ) : (
          <div style={{
            borderRadius: 12, padding: '12px 14px',
            background: 'rgba(145,70,255,0.10)', border: '1px solid rgba(145,70,255,0.35)',
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <span style={{
                width: 32, height: 32, borderRadius: 8, background: '#9146FF', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flexShrink: 0,
              }}>T</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: C.text }}>Stream to both</span>
                <span style={{ display: 'block', fontSize: 11.5, color: C.textDim }}>
                  Relay this broadcast to your Twitch channel too. Your Twitch audience sees no change while your Vergr channel grows.
                  {ingestMode !== 'rtmp' && mirrorToTwitch ? ' Needs the OBS / RTMP source (switch below).' : ''}
                </span>
              </span>
              <input type="checkbox" checked={mirrorToTwitch}
                onChange={(e) => {
                  setMirrorToTwitch(e.target.checked);
                  if (e.target.checked && !twitchNudgeText) {
                    setTwitchNudgeText(`I'm also live on Vergr: same stream, and tips pay me up to 80%: https://vergr.app/user/${currentUser?.uid}?ref=${currentUser?.uid}`);
                  }
                }}
                style={{ width: 18, height: 18, accentColor: '#9146FF', flexShrink: 0 }} />
            </label>
            {mirrorToTwitch && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(145,70,255,0.25)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={twitchNudgeOn} onChange={(e) => setTwitchNudgeOn(e.target.checked)}
                    style={{ width: 15, height: 15, accentColor: '#9146FF', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>
                    Post a reminder in my Twitch chat every 20 min
                  </span>
                </label>
                {twitchNudgeOn && (
                  <textarea
                    value={twitchNudgeText}
                    onChange={(e) => setTwitchNudgeText(e.target.value.slice(0, 200))}
                    rows={2}
                    style={{
                      width: '100%', marginTop: 8, borderRadius: 8, padding: '8px 10px',
                      fontSize: 12, color: C.text, background: 'rgba(0,0,0,0.3)',
                      border: '1px solid rgba(145,70,255,0.3)', outline: 'none', resize: 'vertical',
                    }} />
                )}
                <p style={{ margin: '8px 0 0', fontSize: 10.5, color: C.textDim }}>
                  Posted as YOU, in YOUR channel only. Off by default; keep it friendly.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isDesktop ? 'minmax(0,1fr) 320px' : '1fr',
        gap: 16, padding: '0 24px 32px',
      }}>
        {/* MAIN CONTENT */}
        <div>
          {/* Preview */}
          <div style={{
            position: 'relative', aspectRatio: '16/9', width: '100%',
            background: '#000',
            borderRadius: 12, overflow: 'hidden', marginBottom: 12,
            border: `1px solid ${C.border}`,
          }}>
            <video
              ref={videoRef}
              autoPlay muted playsInline
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                objectFit: 'contain', background: '#000',
                opacity: (previewReady && (camOn || screenSharing)) ? 1 : 0,
                transform: screenSharing ? 'none' : 'scaleX(-1)', // mirror selfie cam only
              }}
            />
            {/* Empty / blocked / opt-in states */}
            {(!previewReady || (!camOn && !screenSharing)) && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 10, textAlign: 'center', padding: 24,
                background: 'radial-gradient(circle at 50% 60%, #1a1030 0%, #0a0a14 70%)',
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: 40, color: C.textMuted }}>
                  {previewError ? 'videocam_off' : (!previewStarted ? 'videocam' : (!camOn && !screenSharing ? 'videocam_off' : 'hourglass_empty'))}
                </span>
                <div style={{ fontSize: 12, color: C.textDim, maxWidth: 320, lineHeight: 1.4 }}>
                  {previewError
                    ? previewError
                    : !previewStarted
                      ? 'Your camera is off. Enable it to preview yourself before going live. Nothing is recorded or shared until you go live.'
                      : (!camOn && !screenSharing)
                        ? 'Camera off. Turn on Camera or share your Screen to preview.'
                        : 'Starting preview…'}
                </div>
                {(!previewStarted || previewError) && (
                  <button type="button" onClick={acquireCamera} style={{ ...btnPrimary, marginTop: 2 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>videocam</span>
                    {previewError ? 'Retry' : 'Enable camera & mic'}
                  </button>
                )}
              </div>
            )}
            {/* LIVE-PREVIEW badge */}
            <div style={{
              position: 'absolute', top: 12, left: 12,
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 10px', background: 'rgba(0,0,0,0.55)', borderRadius: 4,
              fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
            }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: previewReady ? C.green : C.textMuted }}/>
              {screenSharing ? 'SCREEN' : 'PREVIEW'}
            </div>
            <div style={{ position: 'absolute', top: 10, right: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, color: camOn || screenSharing ? '#fff' : C.textMuted }}>
                {screenSharing ? 'cast' : camOn ? 'videocam' : 'videocam_off'}
              </span>
              <MicMeter level={micLevel} muted={!previewStarted || !micOn} />
            </div>
          </div>

          {/* Device controls */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px',
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
            marginBottom: 16, flexWrap: 'wrap',
          }}>
            {[
              { id: 'mic',    label: micOn ? 'Mic' : 'Muted',  icon: micOn ? 'mic' : 'mic_off',          on: micOn,        onClick: toggleMic },
              { id: 'camera', label: 'Camera', icon: camOn ? 'videocam' : 'videocam_off',                on: camOn,        onClick: toggleCam },
              { id: 'screen', label: screenSharing ? 'Sharing' : 'Screen', icon: 'cast',                 on: screenSharing, onClick: toggleScreen },
            ].map(d => (
              <button
                key={d.id}
                type="button"
                onClick={d.onClick}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px',
                  background: d.on ? C.purpleSoft : 'rgba(255,255,255,0.04)',
                  border: d.on ? `1px solid ${C.purple}` : `1px solid ${C.borderSoft}`,
                  borderRadius: 7, color: d.on ? C.purpleLight : C.textDim,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{d.icon}</span>
                {d.label}
              </button>
            ))}
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 8,
              minWidth: 120, marginLeft: 'auto',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, color: micOn ? 'rgba(255,255,255,0.6)' : C.red }}>
                {micOn ? 'volume_up' : 'volume_off'}
              </span>
              <MicMeter level={micLevel} muted={!previewStarted || !micOn} />
            </div>
          </div>

          {/* Device pickers — appear once the preview is on and labels resolve. */}
          {previewStarted && (videoDevices.length > 1 || audioDevices.length > 1) && (
            <div style={{
              display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8,
              marginBottom: 16,
            }}>
              {videoDevices.length > 1 && (
                <DevicePicker
                  icon="videocam" label="Camera" value={camDeviceId}
                  devices={videoDevices} fallback="Default camera"
                  onChange={setCamDeviceId}
                />
              )}
              {audioDevices.length > 1 && (
                <DevicePicker
                  icon="mic" label="Microphone" value={micDeviceId}
                  devices={audioDevices} fallback="Default microphone"
                  onChange={setMicDeviceId}
                />
              )}
            </div>
          )}

          {/* Fast path: a title is all you need. Everything else remembers your
              last stream and hides under Advanced. */}
          <div style={{ marginBottom: 14 }}>
            <FieldLabel>Title</FieldLabel>
            <input
              value={title}
              onChange={e => setTitle(e.target.value.slice(0, 140))}
              placeholder="Give your stream a title…"
              style={inputField}
            />
            <CharCount value={title.length} max={140}/>
          </div>

          {/* Advanced accordion */}
          <button
            type="button"
            onClick={() => setAdvancedOpen(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '10px 12px', marginBottom: advancedOpen ? 16 : 8,
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
              color: C.textDim, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>tune</span>
            <span style={{ flex: 1, textAlign: 'left' }}>Advanced options (description, tags, cover, audience, quality, tips, source)</span>
            <span className="material-symbols-outlined" style={{ fontSize: 18, transform: advancedOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>expand_more</span>
          </button>

          <div style={{ display: advancedOpen ? 'block' : 'none' }}>
          {/* 1. Basic Info */}
          <SectionHeader n="1" label="More details"/>
          <div style={{ marginBottom: 18 }}>
            <FieldLabel>Description</FieldLabel>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value.slice(0, 280))}
              placeholder="What's this stream about?"
              style={{ ...inputField, height: 64, resize: 'vertical', fontFamily: 'inherit' }}
            />
            <CharCount value={description.length} max={280}/>

            <FieldLabel>Tags</FieldLabel>
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 6,
              padding: '9px 12px', background: '#191527',
              border: `1px solid ${C.border}`, borderRadius: 8,
            }}>
              {tags.map(t => (
                <span key={t} style={tagPill}>
                  #{t}
                  <span
                    style={{ cursor: 'pointer', opacity: 0.7 }}
                    onClick={() => setTags(prev => prev.filter(x => x !== t))}
                  >×</span>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                placeholder="+ Add"
                style={{
                  background: 'transparent', border: 'none', color: C.text,
                  fontSize: 12, outline: 'none', minWidth: 80, padding: '3px 6px',
                }}
              />
            </div>

            <FieldLabel>Cover image (shown in discovery)</FieldLabel>
            <input ref={coverInputRef} type="file" accept="image/*" onChange={handleCoverFile} style={{ display: 'none' }} />
            {coverUrl ? (
              <div style={{
                position: 'relative', width: '100%', aspectRatio: '16/9', maxWidth: 320,
                borderRadius: 10, overflow: 'hidden', border: `1px solid ${C.border}`,
              }}>
                <img src={coverUrl} alt="cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 6 }}>
                  <button type="button" onClick={() => coverInputRef.current?.click()} disabled={coverBusy} style={coverChip}>
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>edit</span>
                  </button>
                  <button type="button" onClick={() => setCoverUrl('')} style={coverChip}>
                    <span className="material-symbols-outlined" style={{ fontSize: 13 }}>close</span>
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                disabled={coverBusy}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 14px', borderRadius: 8,
                  background: '#191527', border: `1px dashed ${C.border}`,
                  color: C.textDim, fontSize: 12, fontWeight: 600, cursor: coverBusy ? 'wait' : 'pointer',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add_photo_alternate</span>
                {coverBusy ? 'Uploading…' : 'Add a cover image'}
              </button>
            )}
            {coverHistory.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 5 }}>Use again</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {coverHistory.map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setCoverUrl(u)}
                      title="Use this cover"
                      style={{
                        width: 64, height: 36, borderRadius: 6, overflow: 'hidden', padding: 0, cursor: 'pointer',
                        border: u === coverUrl ? `2px solid ${C.purpleLight}` : `1px solid ${C.border}`,
                      }}
                    >
                      <img src={u} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>
              Optional. A custom cover makes your stream stand out in the live feed.
            </div>
          </div>

          {/* 2. Audience (game selection removed from the live-stream flow) */}
          <div style={{ marginBottom: 18 }}>
            <div>
              <SectionHeader n="2" label="Audience"/>
              <div style={{ display: 'flex', gap: 6 }}>
                {[
                  { id: 'public',    label: 'Public',    icon: 'public' },
                  { id: 'followers', label: 'Followers', icon: 'favorite' },
                  { id: 'friends',   label: 'Friends',   icon: 'group' },
                  { id: 'ticketed',  label: 'Ticketed',  icon: 'confirmation_number' },
                ].map(a => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAudience(a.id)}
                    style={{
                      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '10px 12px',
                      background: audience === a.id ? C.purpleSoft : 'rgba(255,255,255,0.04)',
                      border: audience === a.id ? `1px solid ${C.purple}` : `1px solid ${C.border}`,
                      borderRadius: 8,
                      color: audience === a.id ? C.purpleLight : C.textDim,
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{a.icon}</span>
                    {a.label}
                  </button>
                ))}
              </div>

              {/* Charging for entry is orthogonal to WHO can find the stream, so
                  it sits next to the audience picker rather than inside it: a
                  paid stream can still be public, followers-only, or unlisted. */}
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setAccessSheet(true)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 12px',
                    background: accessPrice > 0 ? 'rgba(240,165,0,0.14)' : 'rgba(255,255,255,0.04)',
                    border: accessPrice > 0 ? '1px solid #F0A500' : `1px solid ${C.border}`,
                    borderRadius: 8,
                    color: accessPrice > 0 ? '#F5C842' : C.textDim,
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                    {accessPrice > 0 ? 'lock' : 'lock_open'}
                  </span>
                  <span style={{ flex: 1, textAlign: 'left' }}>
                    {accessPrice > 0
                      ? `Paid entry: ${accessPrice.toLocaleString()} coins`
                      : 'Free to watch (tap to charge for entry)'}
                  </span>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chevron_right</span>
                </button>
              </div>
              {/* Adult content is permitted on a PAID stream only. A free or
                  followers-only broadcast still reaches an audience, and Terms
                  section 3 blocks nudity there. The server enforces the same
                  rule and ignores this flag when the stream is not paid, so the
                  two cannot drift. */}
              {accessPrice > 0 && (
                <button
                  type="button"
                  onClick={() => setIsNsfwStream(v => !v)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                    marginTop: 8, padding: '10px 12px',
                    background: isNsfwStream ? 'rgba(200,127,255,0.14)' : 'rgba(255,255,255,0.04)',
                    border: isNsfwStream ? '1px solid #C87FFF' : `1px solid ${C.border}`,
                    borderRadius: 8,
                    color: isNsfwStream ? '#C87FFF' : C.textDim,
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                    {isNsfwStream ? 'visibility_off' : 'visibility'}
                  </span>
                  <span style={{ flex: 1, textAlign: 'left' }}>
                    {isNsfwStream
                      ? 'Marked NSFW: age-verified viewers only'
                      : 'Mark as NSFW (adult content)'}
                  </span>
                </button>
              )}
              <div style={{ fontSize: 10, color: C.textMuted, marginTop: 6, lineHeight: 1.4 }}>
                Squad streams start from your squad dashboard, not here.
              </div>
              {audience === 'ticketed' && (
                <button type="button" onClick={() => setShowEventPicker(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginTop: 10, padding: '10px 12px',
                    background: ticketedEventId ? C.purpleSoft : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${ticketedEventId ? C.purple : C.border}`, borderRadius: 8,
                    color: ticketedEventId ? C.purpleLight : C.textDim, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>confirmation_number</span>
                  <span style={{ flex: 1, textAlign: 'left' }}>{ticketedEventId ? ticketedEventName : 'Link this stream to a ticketed event'}</span>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chevron_right</span>
                </button>
              )}
              <EventPickerModal
                isOpen={showEventPicker}
                onClose={() => setShowEventPicker(false)}
                onSelect={(t) => { setTicketedEventId(t.id); setTicketedEventName(t.name); setShowEventPicker(false); }}
              />
              <PriceSheet
                open={accessSheet}
                onClose={() => setAccessSheet(false)}
                onConfirm={({ isPaid, priceCoins }) => { setAccessPrice(isPaid ? priceCoins : 0); if (!isPaid) setIsNsfwStream(false); setAccessSheet(false); }}
                title="Charge for entry"
                subtitle="Viewers pay once to watch this broadcast. Anyone with an active membership that includes your paid streams gets in without paying again."
                confirmLabel="Set"
                initialPaid={accessPrice > 0}
                initialPrice={accessPrice > 0 ? accessPrice : 250}
              />
              {audience !== 'ticketed' && (
                <button type="button" onClick={() => setShowPromotePicker(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginTop: 10, padding: '10px 12px',
                    background: promotedEventId ? C.purpleSoft : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${promotedEventId ? C.purple : C.border}`, borderRadius: 8,
                    color: promotedEventId ? C.purpleLight : C.textDim, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>sell</span>
                  <span style={{ flex: 1, textAlign: 'left' }}>{promotedEventId ? `Selling tickets: ${promotedEventName}` : 'Sell tickets for an event on this stream (optional)'}</span>
                  {promotedEventId
                    ? <span className="material-symbols-outlined" style={{ fontSize: 16 }} onClick={(e) => { e.stopPropagation(); setPromotedEventId(null); setPromotedEventName(''); }}>close</span>
                    : <span className="material-symbols-outlined" style={{ fontSize: 16 }}>chevron_right</span>}
                </button>
              )}
              <EventPickerModal
                isOpen={showPromotePicker}
                onClose={() => setShowPromotePicker(false)}
                onSelect={(t) => { setPromotedEventId(t.id); setPromotedEventName(t.name); setShowPromotePicker(false); }}
              />
              {/* ⚠ AUDIO-ONLY IS A FORMAT CHOICE, so it sits with the other things that
                  describe the broadcast rather than with the camera controls. A co-host
                  could already join audio-only; refusing a solo host was an
                  inconsistency. Founder-approved 2026-09-02. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, color: C.textDim }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: C.purpleLight }}>graphic_eq</span>
                <span style={{ flex: 1 }}>Audio only, no camera</span>
                <ToggleSm checked={audioOnly} onChange={setAudioOnly}/>
              </div>

              {/* ⚠⚠ WHO MAY CLIP. NOT HOW MUCH. The clipper's own plan still decides
                  length and count (free 30s/3, lite 60s/5, pro 90s/unlimited), so a Pro
                  subscriber on a followers-only stream still gets the full 90s.
                  Conflating the two would silently re-price every plan. The rule is
                  enforced in functions/streamClips.js, because a client check is a
                  suggestion. Founder, 2026-09-02. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, color: C.textDim }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: C.purpleLight }}>content_cut</span>
                <span style={{ flex: 1 }}>Who can clip this stream</span>
                <select value={clipPolicy} onChange={(e) => setClipPolicy(e.target.value)}
                  style={{ background: '#191527', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 12, padding: '5px 8px', outline: 'none' }}>
                  <option value="everyone">Everyone</option>
                  <option value="followers">Followers</option>
                  <option value="subscribers">Subscribers</option>
                </select>
              </div>
              {audience !== 'friends' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, color: C.textDim }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: C.purpleLight }}>notifications_active</span>
                  <span style={{ flex: 1 }}>Notify my followers when I go live</span>
                  <ToggleSm checked={notifyFollowers} onChange={setNotifyFollowers}/>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, color: C.textDim }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: C.purpleLight }}>translate</span>
                <span style={{ flex: 1 }}>Stream language</span>
                <select
                  value={streamLang}
                  onChange={e => setStreamLang(e.target.value)}
                  style={{
                    padding: '6px 10px', background: '#191527',
                    border: `1px solid ${C.border}`, borderRadius: 8, color: C.text,
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {SUPPORTED_LANGS.map(code => (
                    <option key={code} value={code}>{LANG_LABELS[code] || code}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* 4. Quality + 5. Monetization */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 18 }}>
            <div>
              <SectionHeader n="4" label="Stream Quality"/>
              <div style={{
                padding: 14, borderRadius: 10, background: C.cardSoft,
                border: `1px solid ${C.border}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18, color: C.purpleLight }}>high_quality</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{rendition.label}</div>
                    <div style={{ fontSize: 11, color: C.textDim }}>
                      Up to {(rendition.kbps / 1000).toFixed(1)} Mbps · {rendition.planLabel} plan
                    </div>
                  </div>
                </div>
                {ingestMode === 'rtmp' && (
                  <div style={{
                    marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.divider}`,
                    fontSize: 11, color: C.textDim, lineHeight: 1.5,
                  }}>
                    In OBS, set video bitrate to <strong style={{ color: '#fff' }}>≤ {rendition.kbps.toLocaleString()} kbps</strong>, keyframe interval <strong style={{ color: '#fff' }}>2s</strong>. Higher bitrates are throttled.
                  </div>
                )}
                {streamTier !== 'pro' && (
                  <button
                    type="button"
                    onClick={() => navigate('/settings/subscription')}
                    style={{
                      marginTop: 10, width: '100%', padding: '8px', borderRadius: 7, border: 'none',
                      background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
                      color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    Upgrade for {streamTier === 'free' ? '720p / 1080p' : '1080p'}
                  </button>
                )}
              </div>
            </div>

            <div>
              <SectionHeader n="5" label="Tips & Goal"/>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
                fontSize: 11, color: C.textDim, lineHeight: 1.4,
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: C.purpleLight }}>volunteer_activism</span>
                Viewers tip you in coins while you're live. Vergr pays you a share of that revenue, 50% to 80% by lifetime earnings.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Set a tip goal</span>
                <ToggleSm checked={tipGoalOn} onChange={setTipGoalOn}/>
              </div>
              {tipGoalOn && (
                <>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Goal amount</div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '8px 12px', background: '#191527',
                      border: `1px solid ${C.border}`, borderRadius: 8,
                    }}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill={C.purpleLight}>
                        <polygon points="8,1 10,6 15,6 11,9.5 12.5,15 8,11.5 3.5,15 5,9.5 1,6 6,6"/>
                      </svg>
                      <input
                        type="number"
                        min={0}
                        value={tipGoalCoins}
                        onChange={e => setTipGoalCoins(Math.max(0, Number(e.target.value)))}
                        placeholder="0"
                        style={{
                          flex: 1, background: 'transparent', border: 'none',
                          color: '#fff', fontSize: 13, fontWeight: 700, outline: 'none',
                        }}
                      />
                      <span style={{ fontSize: 11, color: C.textDim }}>coins</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>What's it for? (optional)</div>
                    <input
                      value={tipGoalReason}
                      onChange={e => setTipGoalReason(e.target.value.slice(0, 80))}
                      placeholder="e.g. New mic fund"
                      style={inputField}
                    />
                    <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>
                      Shows a progress bar on your stream that fills as viewers tip.
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 6. Ingest source */}
          <div style={{ marginBottom: 18 }}>
            <SectionHeader n="6" label="Broadcast From"/>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
              <IngestCard
                active={ingestMode === 'browser'}
                disabled={!browserCanIngest()}
                onClick={() => setIngestMode('browser')}
                icon="captive_portal"
                title="Browser broadcast"
                desc="Go live from this tab. Best for quick streams, mobile, just-chatting."
                note={!browserCanIngest() ? 'Browser unsupported. Update Chrome 88+ / Safari 18.4+' : null}
              />
              <IngestCard
                active={ingestMode === 'rtmp'}
                onClick={() => setIngestMode('rtmp')}
                icon="cast"
                title="OBS / RTMP"
                desc="Push from OBS, Streamlabs, or any RTMP encoder. Best quality + game capture."
              />
            </div>
          </div>
          </div>{/* end Advanced accordion */}

          {/* Footer */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 0', borderTop: `1px solid ${C.divider}`,
            fontSize: 12, color: C.textDim, gap: 12, flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 14, color: C.purpleLight }}>info</span>
              Make sure to review our{' '}
              <button
                type="button"
                onClick={() => navigate('/settings/help')}
                style={{ background: 'none', border: 'none', color: C.purpleLight, cursor: 'pointer', fontSize: 12, padding: 0 }}
              >Community Guidelines</button>{' '}
              before going live.
            </div>
            <button
              type="button"
              onClick={() => showToast('Viewer preview opens once you go live. Your watch page is shareable then.', 'info')}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', background: 'transparent',
                border: `1px solid ${C.border}`, borderRadius: 7,
                color: C.textMuted, fontSize: 12, cursor: 'pointer',
              }}
            >
              Viewer Preview
              <span className="material-symbols-outlined" style={{ fontSize: 12 }}>open_in_new</span>
            </button>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <PanelSection title={
            <>
              Stream Status
              <span style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: C.textMuted,
              }}>
                <div style={{ width: 7, height: 7, background: C.textMuted, borderRadius: '50%' }}/>
                OFFLINE
              </span>
            </>
          }>
            <StatusRow k="Status" v={
              <span style={{ color: previewStarted ? C.green : C.amber, fontWeight: 600 }}>
                {previewStarted ? 'Ready to Stream' : 'Devices off'}
              </span>
            }/>
            <StatusRow k="Camera" v={
              <span style={{ color: !previewStarted ? C.textMuted : screenSharing ? C.purpleLight : camOn ? C.green : C.textMuted, fontWeight: 600 }}>
                {!previewStarted ? 'Off' : screenSharing ? 'Screen share' : camOn ? 'On' : 'Off'}
              </span>
            }/>
            <StatusRow k="Microphone" v={
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: previewStarted && micOn ? C.green : C.textMuted, fontWeight: 600 }}>
                {!previewStarted ? 'Off' : micOn ? 'Live' : 'Muted'} <MicMeter level={micLevel} muted={!previewStarted || !micOn} />
              </span>
            }/>
            <StatusRow k="Broadcast via" v={
              <span style={{ color: '#fff', fontWeight: 600 }}>{ingestMode === 'rtmp' ? 'OBS / RTMP' : 'Browser'}</span>
            }/>
          </PanelSection>

          <PanelSection title={
            <>
              Viewers
              <span style={{ fontSize: 12, color: C.textDim, fontWeight: 400, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>visibility</span> 0
              </span>
            </>
          }>
            <div style={{ textAlign: 'center', padding: '12px 0 4px', color: C.textDim, fontSize: 12 }}>Be the first one!</div>
            <div style={{ textAlign: 'center', color: C.textMuted, fontSize: 11, marginBottom: 10 }}>
              Invite your squad and start streaming.
            </div>
            <div style={{ display: 'flex', gap: 5, justifyContent: 'center' }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ width: 28, height: 28, borderRadius: '50%', background: '#1A1A2A' }}/>
              ))}
            </div>
          </PanelSection>

          <PanelSection title="Earnings · Today">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Stat label="Coins" value={(profile?.todayCoinsEarned ?? 0).toLocaleString()} color="#fff" iconColor={C.purpleLight}/>
              <Stat label="VP" value={(profile?.todayVPEarned ?? 0).toLocaleString()} color={C.purpleLight}/>
            </div>
            <div style={{ marginTop: 8, fontSize: 10, color: C.textMuted, lineHeight: 1.4 }}>
              Vergr pays you a share of tip revenue: 50% to start, rising to 80% as your lifetime earnings grow.
            </div>
          </PanelSection>

          <PanelSection title="Quick Actions">
            <QAItem icon="group_add" onClick={() => navigate('/squads')}>Invite Squad</QAItem>
            <QAItem icon="share" onClick={() => {
              navigator.clipboard?.writeText(window.location.href);
              showToast('Stream link copied', 'success');
            }}>Share Stream</QAItem>
            <QAItem icon="content_cut" onClick={() => showToast('Clip moments while you\'re live. Viewers can clip too.', 'info')}>Clip Moment</QAItem>
          </PanelSection>

          <div style={{
            background: 'linear-gradient(135deg, rgba(123,31,255,0.18), rgba(180,79,255,0.06))',
            border: '1px solid rgba(180,79,255,0.3)', borderRadius: 12, padding: 14,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>👑</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Level Up Your Stream</div>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 10 }}>
              Unlock higher quality, custom overlays, and more ways to earn.
            </div>
            <button
              type="button"
              onClick={() => navigate('/settings/subscription')}
              style={{
                width: '100%', padding: '8px 12px',
                background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
                border: 'none', borderRadius: 7, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >View Plans</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────
function SectionHeader({ n, label }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 800, textTransform: 'uppercase',
      letterSpacing: '0.08em', color: C.textDim, marginBottom: 10,
    }}>
      {n}. {label}
    </div>
  );
}

function FieldLabel({ children }) {
  return <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6, marginTop: 12 }}>{children}</div>;
}

function CharCount({ value, max }) {
  return (
    <div style={{
      fontSize: 10, color: value > max * 0.9 ? C.amber : C.textMuted,
      textAlign: 'right', marginTop: 2,
    }}>
      {value} / {max}
    </div>
  );
}

function PanelSection({ title, children }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em',
        color: C.text, marginBottom: 10,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function StatusRow({ k, v }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '6px 0', borderBottom: `1px solid ${C.divider}`,
    }}>
      <span style={{ fontSize: 12, color: C.textDim }}>{k}</span>
      <span style={{ fontSize: 12 }}>{v}</span>
    </div>
  );
}

function Stat({ label, value, color = '#fff' }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color, marginTop: 3 }}>{value}</div>
    </div>
  );
}

function QAItem({ icon, children, shortcut, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px',
        cursor: onClick ? 'pointer' : 'default', fontSize: 13, color: C.text,
        borderBottom: `1px solid ${C.divider}`,
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 16, color: C.textDim }}>{icon}</span>
      <span style={{ flex: 1 }}>{children}</span>
      {shortcut && (
        <span style={{
          fontSize: 10, color: C.textMuted, padding: '2px 6px',
          border: `1px solid ${C.border}`, borderRadius: 4,
        }}>{shortcut}</span>
      )}
    </div>
  );
}

function IngestCard({ active, disabled, onClick, icon, title, desc, note }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        textAlign: 'left', padding: '12px 14px',
        background: active ? C.purpleSoft : 'rgba(255,255,255,0.04)',
        border: active ? `1px solid ${C.purple}` : `1px solid ${C.border}`,
        borderRadius: 10, color: C.text,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        display: 'flex', gap: 12, alignItems: 'flex-start',
      }}
    >
      <span className="material-symbols-outlined" style={{
        fontSize: 22, color: active ? C.purpleLight : C.textDim, marginTop: 2,
      }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.4 }}>{desc}</div>
        {note && (
          <div style={{ fontSize: 10, color: C.amber, marginTop: 4 }}>{note}</div>
        )}
      </div>
    </button>
  );
}

function DevicePicker({ icon, label, value, devices, fallback, onChange }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.textDim, marginBottom: 6 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{icon}</span>
        {label}
      </span>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: '#191527', border: `1px solid ${C.border}`,
        borderRadius: 8, padding: '2px 10px',
      }}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: C.text, fontSize: 12, padding: '8px 0', cursor: 'pointer',
            appearance: 'none', WebkitAppearance: 'none',
          }}
        >
          <option value="" style={{ background: C.card }}>{fallback}</option>
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId} style={{ background: C.card }}>
              {d.label || `${label} ${i + 1}`}
            </option>
          ))}
        </select>
        <span className="material-symbols-outlined" style={{ fontSize: 14, color: C.textMuted }}>expand_more</span>
      </div>
    </label>
  );
}

// Real mic level meter — `level` is 0..100 RMS from the live AnalyserNode.
function MicMeter({ level = 0, muted = false }) {
  const bars = 9;
  const lit = muted ? 0 : Math.round((level / 100) * bars);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 14 }}>
      {Array.from({ length: bars }).map((_, i) => {
        const on = i < lit;
        const color = i >= 7 ? C.red : i >= 5 ? C.amber : C.green;
        return (
          <div key={i} style={{
            width: 3, height: 4 + i * 1.1,
            // ⚠ A SWITCH TRACK IS A SOLID VALUE. A 12% white wash has no value of its
            // own: it takes whatever is behind it, so the OFF state changed shade from
            // section to section. #2A2A38 is the track token the state layer uses.
            background: on ? color : '#2A2A38',
            borderRadius: 1, transition: 'background 0.06s linear',
          }}/>
        );
      })}
    </div>
  );
}

function ToggleSm({ checked, onChange, style }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        width: 32, height: 18, borderRadius: 9, position: 'relative',
        background: checked ? `linear-gradient(135deg,${C.purple},${C.purpleLight})` : 'rgba(255,255,255,0.1)',
        border: 'none', cursor: 'pointer', flexShrink: 0, ...style,
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: checked ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%', background: '#fff',
        transition: 'left 0.15s', boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
      }}/>
    </button>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const btnOutline = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', background: 'transparent',
  border: `1px solid ${C.border}`, borderRadius: 8,
  color: C.textDim, fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
const btnPrimary = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 18px',
  background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
  border: 'none', borderRadius: 8,
  color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  boxShadow: '0 0 16px rgba(123,31,255,0.4)',
};
const inputField = {
  width: '100%', boxSizing: 'border-box',
  background: '#191527', border: `1px solid ${C.border}`,
  borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 13, outline: 'none',
};
const coverChip = {
  width: 26, height: 26, borderRadius: 6, border: 'none',
  background: 'rgba(0,0,0,0.6)', color: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
};
const tagPill = {
  display: 'flex', alignItems: 'center', gap: 5,
  padding: '3px 9px', background: C.purpleSoft,
  border: '1px solid rgba(180,79,255,0.3)', borderRadius: 20,
  fontSize: 12, color: C.purpleLight,
};
