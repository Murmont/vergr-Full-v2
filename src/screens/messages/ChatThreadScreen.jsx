// src/screens/ChatThreadScreen.jsx
import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, orderBy, where, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, setDoc, deleteDoc, getDocs, Timestamp, writeBatch, increment, deleteField } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, auth, functions } from '../../firebase/config';
import { enqueueMessage, isOfflineError, processQueue } from '../../utils/offlineQueue';
import { ChatThreadSkeleton } from '../../components/skeletons/GlassSkeletons';
import { dissolveElement, cssShatterFallback, preloadThanosDissolve } from '../../utils/thanosDissolve';
import { fmtClock, parseUrlDur, claimPlayback, usePauseOffscreen } from '../../utils/mediaPlayback';
import { RoundVideoOverlay } from '../../components/media/RoundVideoPlayer';
import { removeCachedMessage } from '../../utils/messageCache';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import { startVoiceRecording, stopVoiceRecording, startVideoRecording, stopVideoRecording, uploadMediaFile, uploadBlob, getYouTubeID } from '../../utils/mediaHelpers';
import { getChatBgStyle, preloadBackground } from '../../utils/chatBackgrounds';
import { ChatGradient } from '../../components/effects';
import { chatThemeFor, chatThemeColors, chatPatternUrl, chatBubbleColors, chatBubbleVars, chatBubbleStyles, chatMotionFor } from '../../utils/chatThemes';
import { compressVideo } from '../../utils/mediaCompression';
import { faststartOnly } from '../../utils/nativeTranscode';
import useVideoDownload from '../../hooks/useVideoDownload';
import Icon from '../../components/Icon';
import { CoinIcon } from '../../components/CoinIcon';
import { reverseGeocode, openInMaps, parseGeo, geoContentUrl } from '../../utils/geo';
import '../../styles/surface.css';
import CachedImg from '../../components/CachedImg';
import ReactorsSheet from '../../components/messages/ReactorsSheet';
import ScheduleMessageSheet from '../../components/messages/ScheduleMessageSheet';
import TranslationSheet from '../../components/TranslationSheet';
import UserAvatar from '../../components/UserAvatar';
import VanguardBadge from '../../components/VanguardBadge';
import { applyVanguardMask } from '../../utils/vanguard';
import { useUser } from '../../context/UserContext';
import { useLiveUsers } from '../../context/LiveUsersContext';
import EmojiPicker from '../../components/EmojiPicker';
import MediaPanel from '../../components/MediaPanel';
import TypingIndicator from '../../components/TypingIndicator';
import MediaPreview from '../../components/MediaPreview';
import LinkPreviewCard, { extractUrl } from '../../components/LinkPreview';
import { ReactionBubbles, MessageContextMenu } from '../../components/MessageContextMenu';
import useResponsive from '../../hooks/useResponsive';
import useTyping from '../../hooks/useTyping';
import useMessages from '../../hooks/useChatMessages';
import useChatRelayFlag from '../../hooks/useChatRelayFlag';
import useTier from '../../hooks/useTier';
import useOnlineStatus from '../../hooks/useOnlineStatus';
import UpgradeModal from '../../components/UpgradeModal';

// New imports for attachment features
import AttachmentMenu from '../../components/AttachmentMenu';
import ContactSubMenu from '../../components/ContactSubMenu';
import UserPickerSheet from '../../components/UserPickerSheet';
import LocationSubMenu from '../../components/LocationSubMenu';
import LocationPickerModal from '../../components/LocationPickerModal';
import PermissionDisclosure, { DISCLOSURES } from '../../components/permissions/PermissionDisclosure';
import EventPickerModal from '../../components/tournament/EventPickerModal';
import CreatePollSheet from '../../components/messages/CreatePollSheet';
import ChatPollBubble from '../../components/messages/ChatPollBubble';
import EventTicketCard from '../../components/tournament/EventTicketCard';
import SendCoinsModal from '../../components/SendCoinsModal';
import { getWallet, sendCoins, translateContent, groupAllows, subscribeCallsForChat } from '../../firebase/firestore';
import { sendLockedMessage, uploadLockedItem, createMediaPack } from '../../firebase/firestore';
import ContentPacksSheet from '../../components/monetization/ContentPacksSheet';

/** Ceiling on one locked send, mirroring MAX_ITEMS_PER_SEND in the callable. */
const MAX_LOCKED_ITEMS = 20;
import LockedMedia from '../../components/monetization/LockedMedia';
import OneToOneCard from '../../components/monetization/OneToOneCard';
import ReportPrivate from '../../components/safety/ReportPrivate';
import PriceSheet from '../../components/monetization/PriceSheet';
import { translateTarget } from '../../utils/localePrefs';
import { toggleReaction, tombstoneMessage, isChatMutedFor, setChatMuted, MUTE_OPTIONS, deleteChatForMe, deleteChatForEveryone } from '../../utils/chatOps';
import { resolveChatUsers, chatDisplayName, senderColor, peekChatUser, chatPartner } from '../../utils/chatIdentity';
import { sendRelayMessageTo } from '../../utils/relaySend';
import MediaLightbox from '../../components/MediaLightbox';
import { saveDraft, clearDraft, getDraft } from '../../utils/chatDrafts';
import { TTL_OPTIONS, ttlLabel, ttlShort, filterExpired } from '../../utils/disappearing';
import { consumeSharedText, consumeSharedMedia, sharedMediaToFile } from '../../utils/shareIn';
import { useUI } from '../../context/UIContext';
import { isGallerySaveSupported, saveMediaToGallery, isMediaSaved, getAutoSavePhotos, getAutoSaveVideos, autoAlbumFor } from '../../utils/saveToGallery';
import UserName from '../../components/UserName';
import RankBadge from '../../components/RankBadge';

/* ═══════ AudioPlayer (voice notes + audio files) ═══════ */
const AudioPlayer = ({ url, isMe, label, waveform }) => {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1); // 1 → 1.5 → 2 (Telegram standard)
  const barsRef = useRef([]);

  const cycleSpeed = (e) => {
    e?.stopPropagation();
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  useEffect(() => {
    // Prefer the REAL recorded waveform (0-100 ints shipped with the message);
    // seeded pseudo-bars only as the fallback for old messages without one.
    if (Array.isArray(waveform) && waveform.length) {
      barsRef.current = waveform.map(v => Math.max(0.08, Math.min(1, v / 100)));
      return;
    }
    let seed = 0;
    for (let i = 0; i < (url || '').length; i++) seed = ((seed << 5) - seed + (url || '').charCodeAt(i)) | 0;
    const sr = (s) => { s = Math.sin(s) * 10000; return s - Math.floor(s); };
    barsRef.current = Array.from({ length: 36 }, (_, i) => 0.15 + sr(seed + i) * 0.85);
  }, [url, waveform]);

  // stopPropagation everywhere: the message ROW opens the reaction menu on tap
  // (Telegram row model), so without this, pressing play on a voice note also
  // popped the menu open over it.
  const togglePlay = (e) => {
    e?.stopPropagation();
    if (!audioRef.current) return;
    if (isPlaying) audioRef.current.pause();
    else { claimPlayback(audioRef.current); audioRef.current.playbackRate = speed; audioRef.current.play().catch(() => {}); }
    setIsPlaying(!isPlaying);
  };
  const onTimeUpdate = () => { if (!audioRef.current) return; const c = audioRef.current.currentTime, t = audioRef.current.duration; if (t > 0) setProgress((c / t) * 100); };
  const onLoadedMetadata = () => { if (audioRef.current) setDuration(audioRef.current.duration); };
  // Scrub: press anywhere on the waveform and DRAG (Telegram). Pointer capture
  // keeps the drag alive if the finger leaves the bars.
  const scrubbingRef = useRef(false);
  const seekAt = (clientX, el) => {
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    if (audioRef.current?.duration) {
      audioRef.current.currentTime = pct * audioRef.current.duration;
      setProgress(pct * 100);
    }
  };
  const onScrubDown = (e) => {
    e.stopPropagation();
    scrubbingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    seekAt(e.clientX, e.currentTarget);
  };
  const onScrubMove = (e) => { if (scrubbingRef.current) seekAt(e.clientX, e.currentTarget); };
  const onScrubUp = (e) => {
    e.stopPropagation();
    scrubbingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  const fmt = (t) => { if (isNaN(t)) return '0:00'; return `${Math.floor(t/60)}:${Math.floor(t%60).toString().padStart(2,'0')}`; };

  return (
    <div className={`flex flex-col p-3 min-w-[240px] ${isMe ? 'text-white' : 'text-white'}`}>
      {label && <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 truncate ${isMe ? 'text-white/50' : 'text-text-muted'}`}><Icon name="audio_file" size={12} className="inline mr-1" />{label}</p>}
      <div className="flex items-center gap-3">
        <button onClick={togglePlay}
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-90"
          style={isMe
            ? { background: 'rgba(255,255,255,0.20)', color: '#fff' }
            : { background: 'var(--vg-chat-accent-28, rgba(123,31,255,0.20))', color: 'var(--vg-chat-accent, #B44FFF)' }}>
          <Icon name={isPlaying ? 'pause' : 'play_arrow'} size={28} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-end gap-[2px] h-7 cursor-pointer touch-none"
            onPointerDown={onScrubDown} onPointerMove={onScrubMove} onPointerUp={onScrubUp} onPointerCancel={onScrubUp}>
            {barsRef.current.map((h, i) => (<div key={i} className={`flex-1 rounded-full transition-colors duration-75 ${isMe ? ((i / barsRef.current.length) * 100 < progress ? 'bg-white/70' : 'bg-white/20') : 'bg-white/15'}`} style={{ height: `${h * 100}%`, minWidth: 2,
              ...(!isMe && (i / barsRef.current.length) * 100 < progress
                ? { background: 'var(--vg-chat-accent, #7B1FFF)' } : null) }} />))}
          </div>
          <div className="flex justify-between items-center mt-1 px-0.5">
            <span className="text-[10px] font-bold opacity-60">{isPlaying ? fmt(audioRef.current?.currentTime) : fmt(duration)}</span>
            <button onClick={cycleSpeed} aria-label="Playback speed"
              className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold tabular-nums ${speed !== 1 ? (isMe ? 'bg-white/25 text-white' : 'bg-brand-violet/20 text-brand-violet-light') : 'opacity-50'}`}>
              {speed}x
            </button>
          </div>
        </div>
      </div>
      <audio ref={audioRef} src={url} preload="metadata" onTimeUpdate={onTimeUpdate} onLoadedMetadata={onLoadedMetadata} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => { setIsPlaying(false); setProgress(0); }} />
    </div>
  );
};

/* ═══════ Clip / Video Message Player (CUSTOM controls) ═══════ */
// ROOT CAUSE of "clips have no working controls on the native app only":
// the Android System WebView renders the NATIVE `<video controls>` bar on a
// separate compositor surface that does NOT reliably receive touch events
// inside the Tauri shell — so play / seek / mute are dead on the native app,
// even though they work fine in desktop, mobile Chrome, and the PWA (none of
// which use the System WebView). Relying on native `controls` is therefore a
// dead end. Fix: render the <video> WITHOUT `controls` and drive it entirely
// with our OWN HTML control bar (plain <button>s + an <input type="range">),
// which the WebView DOES deliver touch to. All playback goes through the JS
// media API (play/pause/currentTime/muted), which works in the WebView.
// fmtClock / parseUrlDur / claimPlayback / usePauseOffscreen now live in
// utils/mediaPlayback so the round video-note player can be shared with the
// Shared Media panel (see components/media/RoundVideoPlayer).
const ClipMessagePlayer = ({ src, poster, onExpand }) => {
  const videoRef = useRef(null);
  // Play from disk when we have it. Nothing downloads on its own — see
  // useVideoDownload for why video is opt-in where photos are not.
  const dl = useVideoDownload(src);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(() => parseUrlDur(src));
  const [seeking, setSeeking] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [skipFlash, setSkipFlash] = useState(null); // 'back' | 'fwd'
  const seekingRef = useRef(false);
  const chromeTimer = useRef(null);
  const tapRef = useRef({ t: 0, side: null, timer: null });

  usePauseOffscreen(videoRef);
  useEffect(() => () => { clearTimeout(chromeTimer.current); clearTimeout(tapRef.current.timer); }, []);

  // Controls fade while playing (Telegram); reappear on pause / any touch.
  const showChrome = () => {
    setChromeVisible(true);
    clearTimeout(chromeTimer.current);
    chromeTimer.current = setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused && !seekingRef.current) setChromeVisible(false);
    }, 2600);
  };

  // Duration comes from the #d= hint (new recordings) or from finite metadata.
  // We deliberately DO NOT force a far seek to make a MediaRecorder WebM report
  // its duration: that makes the browser download the ENTIRE file, so a thread
  // with several legacy notes/videos would pull them all in full on open,
  // saturating the connection (it made sending media crawl). Unknown duration
  // simply shows no number until playback reveals it.
  const resolveDuration = () => {
    const v = videoRef.current; if (!v) return;
    const d = v.duration;
    if (isFinite(d) && d > 0) setDur(d);
  };
  const onMeta = () => {
    resolveDuration();
    // Paint a real first frame: preload="metadata" in the Android WebView
    // leaves the surface black until the first decode, so nudge it.
    const v = videoRef.current;
    if (v && !poster && v.currentTime === 0) {
      try { v.currentTime = 0.01; } catch { /* ignore */ }
    }
  };

  const togglePlay = (e) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.muted = muted;
      try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch {/* ignore */}
    } else {
      v.pause();
    }
  };
  const toggleMute = (e) => {
    e?.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };
  const onSeek = (e) => {
    const v = videoRef.current;
    if (!v) return;
    const t = Number(e.target.value);
    setCur(t);
    try { v.currentTime = t; } catch {/* ignore */}
  };
  const seekStart = () => { seekingRef.current = true; setSeeking(true); showChrome(); };
  const seekEnd = () => { seekingRef.current = false; setSeeking(false); showChrome(); };

  // Tap model: center tap = play/pause; DOUBLE-tap on the left/right third
  // skips ±10s (Telegram). Edge single-taps wait 260ms for a possible second
  // tap; center taps toggle instantly so play/pause never feels laggy.
  const skipBy = (delta, side) => {
    const v = videoRef.current; if (!v) return;
    const cap = isFinite(v.duration) && v.duration > 0 ? v.duration : (dur || Infinity);
    try { v.currentTime = Math.max(0, Math.min(cap, v.currentTime + delta)); } catch { /* ignore */ }
    setCur(v.currentTime || 0);
    setSkipFlash(side);
    setTimeout(() => setSkipFlash(null), 450);
    showChrome();
  };
  const onVideoTap = (e) => {
    e.stopPropagation();
    showChrome();
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = rect.width ? (e.clientX - rect.left) / rect.width : 0.5;
    const side = frac < 0.35 ? 'back' : frac > 0.65 ? 'fwd' : 'mid';
    const now = Date.now();
    const tp = tapRef.current;
    if (side !== 'mid' && now - tp.t < 300 && tp.side === side) {
      clearTimeout(tp.timer);
      tp.t = 0;
      skipBy(side === 'fwd' ? 10 : -10, side);
      return;
    }
    tp.t = now; tp.side = side;
    clearTimeout(tp.timer);
    if (side === 'mid') togglePlay();
    else tp.timer = setTimeout(() => togglePlay(), 260);
  };

  const durKnown = isFinite(dur) && dur > 0;
  return (
    <div className="relative w-full max-h-64 bg-black rounded-sm overflow-hidden" onMouseMove={showChrome}>
      <video
        ref={videoRef}
        src={dl.src}
        poster={poster}
        playsInline
        preload="metadata"
        onError={dl.onLocalError}
        onClick={onVideoTap}
        onPlay={() => { setPlaying(true); claimPlayback(videoRef.current); showChrome(); }}
        onPause={() => { setPlaying(false); setChromeVisible(true); }}
        onEnded={() => { setPlaying(false); setCur(0); setChromeVisible(true); const v = videoRef.current; if (v) { try { v.currentTime = 0; } catch { /* ignore */ } } }}
        onLoadedMetadata={onMeta}
        onDurationChange={resolveDuration}
        onTimeUpdate={() => { const v = videoRef.current; if (v && !seekingRef.current) setCur(v.currentTime || 0); }}
        className="w-full max-h-64 block"
      />

      {/* Center play affordance while paused — the button is ONLY the circle,
          so edge taps still reach the video's double-tap-to-skip handler. */}
      {!playing && (
        <div className="absolute inset-x-0 top-0 bottom-9 flex items-center justify-center pointer-events-none">
          <button
            type="button"
            onClick={togglePlay}
            aria-label="Play"
            className="pointer-events-auto w-14 h-14 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center"
          >
            <Icon name="play_arrow" size={32} className="text-white relative left-[1px]" />
          </button>
        </div>
      )}

      {/* ±10s skip flash */}
      {skipFlash && (
        <div className={`absolute top-0 bottom-9 ${skipFlash === 'fwd' ? 'right-0' : 'left-0'} w-1/3 flex items-center justify-center pointer-events-none`}>
          <span className="flex items-center gap-0.5 px-2.5 py-1.5 rounded-full bg-black/55 text-white text-[11px] font-bold">
            <Icon name={skipFlash === 'fwd' ? 'fast_forward' : 'fast_rewind'} size={16} />10s
          </span>
        </div>
      )}

      {/* Expand → full-screen centered viewer (MediaLightbox) */}
      {onExpand && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); const v = videoRef.current; if (v && !v.paused) v.pause(); onExpand(); }}
          aria-label="Expand"
          className={`absolute top-2 right-2 w-8 h-8 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center text-white transition-opacity duration-300 ${chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          <Icon name="open_in_full" size={16} />
        </button>
      )}

      {/* Keep-on-device control. Deliberately a manual action: a video is far
          too big to pull down just because it scrolled past. Once saved it
          plays from disk with no network at all, so it works offline. */}
      {dl.supported && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (dl.saved) dl.discard(); else dl.download(); }}
          aria-label={dl.saved ? 'Remove download' : 'Download'}
          className={`absolute top-2 left-2 h-8 min-w-8 px-2 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center gap-1 text-white transition-opacity duration-300 ${chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          {dl.downloading ? (
            <>
              <Icon name="progress_activity" size={15} className="animate-spin" />
              {dl.pct != null && (
                <span className="text-[10px] font-dmmono tabular-nums">{dl.pct}%</span>
              )}
            </>
          ) : (
            <Icon name={dl.saved ? 'download_done' : 'download'} size={16} />
          )}
        </button>
      )}

      {/* Scrub-time bubble while dragging */}
      {seeking && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-sm text-white text-[11px] font-dmmono tabular-nums pointer-events-none">
          {fmtClock(cur)}{durKnown ? ` / ${fmtClock(dur)}` : ''}
        </div>
      )}

      {/* Custom control bar — HTML elements DO receive touch in the WebView */}
      <div
        className={`absolute bottom-0 inset-x-0 flex items-center gap-2 px-2.5 py-1.5 transition-opacity duration-300 ${chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} className="shrink-0 text-white flex items-center">
          <Icon name={playing ? 'pause' : 'play_arrow'} size={20} />
        </button>
        <span className="shrink-0 text-white text-[10px] font-dmmono tabular-nums">{fmtClock(cur)}</span>
        <input
          type="range"
          min={0}
          max={durKnown ? dur : 0}
          step="0.1"
          value={Math.min(cur, durKnown ? dur : 0)}
          onChange={onSeek}
          onPointerDown={seekStart}
          onPointerUp={seekEnd}
          onTouchStart={seekStart}
          onTouchEnd={seekEnd}
          aria-label="Seek"
          className="flex-1 min-w-0 h-1.5 py-2 cursor-pointer"
          style={{ accentColor: '#B44FFF' }}
        />
        <span className="shrink-0 text-white text-[10px] font-dmmono tabular-nums">{fmtClock(dur)}</span>
        <button type="button" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} className="shrink-0 text-white flex items-center">
          <Icon name={muted ? 'volume_off' : 'volume_up'} size={18} />
        </button>
      </div>
    </div>
  );
};

const RoundVideoMessage = ({ src }) => {
  const SIZE = 208;            // inline bubble diameter (px)
  const STROKE = 4;
  const R = (SIZE - STROKE) / 2 - 1;
  const CIRC = 2 * Math.PI * R;
  const posterRef = useRef(null);
  const [dur, setDur] = useState(() => parseUrlDur(src));
  const [open, setOpen] = useState(false);

  // Duration from the #d= hint or finite metadata only. NEVER far-seek to
  // force a MediaRecorder WebM to report its length: that downloads the whole
  // file, so every legacy note in the thread would fully download on open.
  const resolveDuration = () => {
    const v = posterRef.current; if (!v) return;
    const d = v.duration;
    if (isFinite(d) && d > 0) setDur(d);
  };
  const onMeta = () => {
    resolveDuration();
    // Paint a real first frame — preload="metadata" leaves the WebView circle
    // black otherwise (a giant play glyph over nothing).
    const v = posterRef.current;
    if (v && v.currentTime === 0) {
      try { v.currentTime = 0.01; } catch { /* ignore */ }
    }
  };

  return (
    // stopPropagation: taps ON the circle open the enlarged player; taps
    // BESIDE it bubble up to the row and open the reaction menu (Telegram row
    // model). Right-click is NOT stopped so desktop right-click opens the menu.
    <div className="relative my-0.5" style={{ width: SIZE, height: SIZE }} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Play video message"
        className="absolute inset-0 rounded-full overflow-hidden bg-black cursor-pointer"
      >
        <video
          ref={posterRef}
          src={src}
          muted
          playsInline
          preload="metadata"
          className="w-full h-full object-cover pointer-events-none"
          onLoadedMetadata={onMeta}
          onDurationChange={resolveDuration}
        />
        <svg className="absolute inset-0 pointer-events-none" width={SIZE} height={SIZE} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={STROKE} />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="w-14 h-14 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center">
            <Icon name="play_arrow" size={34} className="text-white relative left-[1px]" />
          </span>
        </span>
        <span className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-sm pointer-events-none">
          <Icon name="videocam" size={12} className="text-white" />
          {/* Only show a number when we actually know it — legacy notes have no
              #d= hint and we no longer download the file just to find out. */}
          {dur > 0 && isFinite(dur) && (
            <span className="text-white text-[10px] font-dmmono tabular-nums">{fmtClock(dur)}</span>
          )}
        </span>
      </button>

      {open && <RoundVideoOverlay src={src} onClose={() => setOpen(false)} />}
    </div>
  );
};

/* ═══════ Day Separator ═══════ */
const DaySeparator = ({ date }) => {
  const now = new Date(); const d = new Date(date);
  const isToday = d.toDateString() === now.toDateString();
  const isYesterday = d.toDateString() === new Date(now - 86400000).toDateString();
  const label = isToday ? 'Today' : isYesterday ? 'Yesterday' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  // Sticky (Telegram): the pill for the day you're scrolling through docks
  // under the header until the next day's pill pushes it away.
  // pointer-events-none so the floating pill never blocks bubble taps.
  return (<div className="sticky top-1 z-20 flex items-center justify-center py-3 pointer-events-none"><span className="px-4 py-1.5 bg-bg-dark/70 backdrop-blur-sm rounded-full text-[10px] font-bold text-text-muted uppercase tracking-[0.15em] border border-white/[0.04]" >{label}</span></div>);
};

/* ═══════ Call row — a call that happened in THIS conversation ═══════ */
// WhatsApp puts calls in the thread, not only in the Calls tab. These are read
// live out of `calls_history` (see subscribeCallsForChat) rather than written as
// messages, so past calls appear too and the two surfaces can never disagree.
// Tapping one calls back with the SAME media type, which is what the icon
// promises.
const CallRow = ({ call, meUid, onCallBack }) => {
  const isVideo = call.type === 'video';
  const outgoing = call.callerId === meUid;
  const answered = !!call.answered;
  // An unanswered call you RECEIVED is "missed" (red, the thing you want to
  // spot). An unanswered call you PLACED is just "no answer" and is not an
  // alert, so it stays neutral.
  const missed = !answered && !outgoing;
  const kind = isVideo ? 'video' : 'voice';
  const label = answered
    ? (outgoing ? `Outgoing ${kind} call` : `Incoming ${kind} call`)
    : (missed ? `Missed ${kind} call` : `No answer`);
  const dirIcon = missed ? 'call_missed' : outgoing ? 'call_made' : 'call_received';
  const secs = Math.max(0, Math.round(call.durationSec || 0));
  const dur = answered && secs > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : '';
  const at = call.startedAtMs
    ? new Date(call.startedAtMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';
  return (
    <div className="flex justify-center py-1.5">
      <button
        type="button"
        onClick={() => onCallBack?.(isVideo ? 'video' : 'voice')}
        title={`Call back (${kind})`}
        className="group flex items-center gap-3 pl-3 pr-3.5 py-2 rounded-2xl bg-surface-1/70 backdrop-blur-sm hover:bg-surface-2/70 transition-colors max-w-[85%] text-left"
      >
        <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${missed ? 'bg-brand-ember/15' : 'bg-brand-violet/12'}`}>
          <Icon name={isVideo ? 'videocam' : 'call'} size={16} className={missed ? 'text-brand-ember' : 'text-brand-violet'} />
        </span>
        <span className="min-w-0">
          <span className={`block text-[12.5px] font-semibold truncate ${missed ? 'text-brand-ember' : 'text-text-primary'}`}>{label}</span>
          <span className="flex items-center gap-1 text-[10.5px] text-text-muted">
            <Icon name={dirIcon} size={11} className={missed ? 'text-brand-ember' : 'text-text-muted'} />
            {at}{dur ? ` · ${dur}` : ''}
          </span>
        </span>
        <Icon name="chevron_right" size={16} className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </button>
    </div>
  );
};

/* ═══════ Coin transfer + Location — designed cards, matched to the founder's
   mockups pixel for pixel (map widget.png, coin send-recieve *.png). Both sit
   in a violet neon bubble whose glow TRAVELS the border (surface.css
   .vg-beam-violet, the same moving light as the earnings ring; it stops under
   prefers-reduced-motion). ═══════ */

const VC_COIN = '/brand/vc-coin.webp';       // the ornate VC medallion asset
const COIN_LARGE_THRESHOLD = 1000;           // >= this uses the grand centred layout

// Coin amount + optional note ride `contentUrl` as `vergrcoin:<amount>:<note>`
// because the relay server strips unknown objects but forwards contentUrl. The
// amount also lives in `text` ("Sent N coins") as a preview + fallback.
function coinContentUrl(amount, note) { return `vergrcoin:${amount}:${encodeURIComponent(note || '')}`; }
function parseCoin(contentUrl) {
  const m = /^vergrcoin:(\d+):?(.*)$/.exec(contentUrl || '');
  if (!m) return null;
  let note = ''; try { note = decodeURIComponent(m[2] || ''); } catch { note = ''; }
  return { amount: Number(m[1]) || 0, note };
}

// Shared little pieces
const CoinTicks = () => (
  <svg viewBox="0 0 24 16" width="17" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-brand-violet-light shrink-0"><path d="M2 8l4 4 8-9"/><path d="M9 12l1 1 8-9"/></svg>
);
const HeartIcon = ({ size = 18 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor"><path d="M12 21s-7.5-4.9-10-9.6C.3 8 1.6 4.6 4.8 4.1 7 3.8 8.9 5 10 6.7 11.1 5 13 3.8 15.2 4.1c3.2.5 4.5 3.9 2.8 7.3C19.5 16.1 12 21 12 21z"/></svg>
);
// A note/time footer row shared by both coin layouts. Shows the heart + message
// when a note exists; always shows time + read ticks.
function CoinNoteRow({ note, timeStr, read, boxed }) {
  const inner = (
    <>
      {note ? (
        <>
          <span className={boxed ? 'shrink-0 text-brand-violet-light' : 'w-7 h-7 rounded-full grid place-items-center shrink-0 bg-brand-violet/15 text-brand-violet-light'}>
            <HeartIcon size={boxed ? 17 : 15} />
          </span>
          <span className="flex-1 min-w-0 truncate text-[12.5px] text-text-secondary">{note}</span>
        </>
      ) : <span className="flex-1" />}
      <span className="font-dmmono text-[11px] text-text-muted shrink-0">{timeStr}</span>
      {read ? <CoinTicks /> : null}
    </>
  );
  return boxed
    ? <div className="mt-3 flex items-center gap-2.5 px-3 py-2.5 rounded-2xl bg-white/[0.035] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">{inner}</div>
    : <div className="mt-3 pt-3 border-t border-white/[0.07] flex items-center gap-2.5">{inner}</div>;
}

// The gold number, using the rounded heavy face (Baloo 2) + gold clip, matching
// the mockup exactly.
const goldNum = (fontSize) => ({
  fontFamily: "'Baloo 2', cursive", fontWeight: 800, fontSize, lineHeight: 0.85,
  background: 'linear-gradient(180deg,#ffeaa0,#f7c81e 42%,#d99500)',
  WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
  filter: 'drop-shadow(0 2px 1px rgba(120,70,0,.35)) drop-shadow(0 0 8px rgba(245,197,24,.3))',
});
function CoinCard({ amount, note, isMe, otherName, timeStr, read }) {
  const n = Number(amount || 0);
  const large = n >= COIN_LARGE_THRESHOLD;
  const name = (otherName || 'Someone').toUpperCase();
  // Direction, matching the mockup ("VERGR SENT YOU"): the OTHER party's name is
  // the violet word.
  const line = isMe
    ? <><span className="text-white/80">YOU SENT</span> <span className="text-brand-violet-light vg-brandmark">{name}</span></>
    : <><span className="text-brand-violet-light vg-brandmark">{name}</span> <span className={large ? 'text-white' : 'text-text-secondary'}>SENT YOU</span></>;

  const shell = 'vg-beam vg-beam-violet relative overflow-hidden bg-[#151321]';
  // Inline, not a Tailwind arbitrary shadow, so it can read the chat theme's
  // accent. Falls back to the original violet when no theme is set.
  const shellGlow = {
    boxShadow: '0 0 0 1.5px var(--vg-chat-accent-28, rgba(176,107,255,0.5)),'
             + '0 0 18px var(--vg-chat-accent-28, rgba(147,51,234,0.32)),'
             + '0 0 46px var(--vg-chat-accent-12, rgba(147,51,234,0.14))',
  };

  if (large) {
    return (
      <div className={`${shell} rounded-[26px]`} style={{ width: 300, padding: '22px 22px 12px', ...shellGlow }}>
        {/* medallion + ripple */}
        <div className="relative h-[128px] grid place-items-center mb-1">
          <div className="absolute" style={{ bottom: 16, width: 190, height: 48, background: 'radial-gradient(ellipse at center,rgba(150,70,255,.5),rgba(150,70,255,.10) 55%,transparent 72%)', filter: 'blur(3px)' }} />
          <img src={VC_COIN} alt="" width={124} height={124} draggable={false} style={{ position: 'relative', objectFit: 'contain', filter: 'drop-shadow(0 5px 11px rgba(0,0,0,.5)) drop-shadow(0 0 13px rgba(245,190,60,.42))' }} />
        </div>
        <div className="text-center font-extrabold tracking-[1.5px]" style={{ fontSize: 19 }}>{line}</div>
        <div className="flex items-center justify-center gap-3 mt-2">
          <span className="flex items-center gap-1.5"><span className="w-5 h-0.5" style={{ background: 'linear-gradient(90deg,transparent,rgba(155,107,255,.6))' }} /><span className="w-1.5 h-1.5 rotate-45" style={{ background: '#9b6bff', boxShadow: '0 0 7px rgba(155,107,255,.8)' }} /></span>
          <span style={goldNum(58)}>{n.toLocaleString()}</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rotate-45" style={{ background: '#9b6bff', boxShadow: '0 0 7px rgba(155,107,255,.8)' }} /><span className="w-5 h-0.5" style={{ background: 'linear-gradient(90deg,rgba(155,107,255,.6),transparent)' }} /></span>
        </div>
        <div className="text-center font-extrabold text-text-muted mt-1.5" style={{ fontSize: 15, letterSpacing: '4px' }}>COINS</div>
        <CoinNoteRow note={note} timeStr={timeStr} read={read} boxed={false} />
      </div>
    );
  }
  // small — horizontal
  return (
    <div className={`${shell} rounded-[24px]`} style={{ width: 320, padding: '14px 16px 12px', ...shellGlow }}>
      {/* faint dot grid deco, top-right */}
      <div className="absolute pointer-events-none" style={{ right: 14, top: 16, width: 52, height: 40, opacity: .5, backgroundImage: 'radial-gradient(var(--vg-chat-accent-45, rgba(176,107,255,.5)) 1.2px,transparent 1.4px)', backgroundSize: '11px 11px' }} />
      <div className="flex items-center gap-3.5 relative">
        <div className="relative shrink-0 grid place-items-center" style={{ width: 62, height: 62 }}>
          <div className="absolute rounded-full" style={{ width: 58, height: 58, background: 'radial-gradient(circle,rgba(245,190,60,.5),rgba(245,190,60,.1) 55%,transparent 72%)', filter: 'blur(3px)' }} />
          <img src={VC_COIN} alt="" width={62} height={62} draggable={false} style={{ position: 'relative', objectFit: 'contain', filter: 'drop-shadow(0 0 8px rgba(245,190,60,.5))' }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-extrabold truncate" style={{ fontSize: 14, letterSpacing: '.8px' }}>{line}</div>
          <div className="flex items-center gap-2.5 mt-1.5">
            <span style={goldNum(42)}>{n.toLocaleString()}</span>
            <span className="font-extrabold text-white self-end" style={{ fontSize: 18, letterSpacing: '.5px', marginBottom: 5 }}>COINS</span>
          </div>
        </div>
      </div>
      <CoinNoteRow note={note} timeStr={timeStr} read={read} boxed={true} />
    </div>
  );
}

/* ═══════ Location — a shared place, with a real map thumbnail ═══════ */
// Matches map widget.png: a 3x3 CARTO-Voyager tile grid, darkened to the mockup
// tone (tile.openstreetmap.org is a fallback), centred on the exact point under
// a glowing gradient pin, an "Open map" pill, and a footer with a glowing pin
// badge + address. Tapping the map opens the device's own map app on native.
const LOC_W = 300, LOC_MAP_H = 150, TILE = 256;
function LocationBubble({ lat, lng, title, subtitle, isMe, timeStr, read }) {
  // Map source falls back gracefully: Google dark-styled static (via our proxy,
  // no key exposed) → free OSM tiles → a plain gradient, so the map is never
  // blank even if a provider is down.
  const [mapMode, setMapMode] = useState('google');
  const z = 15;
  const nn = 2 ** z, latR = Number(lat) * Math.PI / 180;
  const xf = (Number(lng) + 180) / 360 * nn;
  const yf = (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * nn;
  const cx = Math.floor(xf), cy = Math.floor(yf);
  const originX = LOC_W / 2 - (xf - cx) * TILE, originY = LOC_MAP_H / 2 - (yf - cy) * TILE;
  const line1 = title || `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  const line2 = subtitle || 'Shared location';
  const gmap = `/maptile?lat=${lat}&lng=${lng}&w=${LOC_W}&h=${LOC_MAP_H}&z=${z}`;
  const tiles = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    tiles.push({ dx, dy, url: `https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${cx + dx}/${cy + dy}.png` });
  }
  return (
    <div className="vg-beam vg-beam-violet relative overflow-hidden rounded-[26px] bg-[#141320]"
      style={{
        width: LOC_W,
        boxShadow: '0 0 0 1.5px var(--vg-chat-accent-28, rgba(176,107,255,0.5)),'
                 + '0 0 18px var(--vg-chat-accent-28, rgba(147,51,234,0.32)),'
                 + '0 0 46px var(--vg-chat-accent-12, rgba(147,51,234,0.14))',
      }}>
      <button type="button" onClick={(e) => { e.stopPropagation(); openInMaps(lat, lng, title, IS_NATIVE_BUILD); }} className="block w-full text-left">
        <div className="relative overflow-hidden" style={{ height: LOC_MAP_H, background: '#12203a' }}>
          {mapMode === 'google' && (
            <img src={gmap} alt="" draggable={false} onError={() => setMapMode('osm')}
              className="absolute inset-0 w-full h-full object-cover" />
          )}
          {mapMode === 'osm' && tiles.map((t, i) => (
            <img key={i} src={t.url} alt="" draggable={false} onError={i === 0 ? () => setMapMode('gradient') : undefined}
              style={{ position: 'absolute', width: TILE, height: TILE, left: originX + t.dx * TILE, top: originY + t.dy * TILE, maxWidth: 'none', filter: 'brightness(.82) saturate(1.15) contrast(1.02)' }} />
          ))}
          {mapMode === 'gradient' && <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg,#1b2440,#2a1b40)' }} />}
          {/* The Google map is already dark-styled; the OSM/gradient fallbacks
              get a light tone for cohesion with the bubble. */}
          {mapMode !== 'google' && <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,rgba(10,8,22,.10),rgba(12,9,26,.30))' }} />}
          {/* glowing gradient pin, centred on the point */}
          <svg viewBox="0 0 58 74" width="40" height="51" className="absolute left-1/2 top-1/2" style={{ transform: 'translate(-50%,-100%)', filter: 'drop-shadow(0 0 8px rgba(215,95,255,.8)) drop-shadow(0 4px 6px rgba(0,0,0,.5))' }}>
            <defs><radialGradient id="lpin" cx="42%" cy="30%" r="75%">
              <stop offset="0" stopColor="var(--vg-chat-accent, #f5a3ff)" stopOpacity="0.75" />
              <stop offset="42%" stopColor="var(--vg-chat-accent, #d24bff)" />
              <stop offset="100%" stopColor="var(--vg-chat-accent, #8b23e6)" stopOpacity="0.85" />
            </radialGradient></defs>
            <path d="M29 2C15.6 2 4 13 4 27c0 18 25 45 25 45s25-27 25-45C54 13 42.4 2 29 2z" fill="url(#lpin)"/>
            <circle cx="29" cy="26" r="9.5" fill="#3a1560" opacity=".5"/>
            <circle cx="29" cy="26" r="9.5" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="1.5"/>
          </svg>
          <span className="absolute right-2.5 bottom-2.5 flex items-center gap-1.5 px-3 py-1.5 rounded-2xl text-white font-bold text-[12px]" style={{ background: 'rgba(16,12,26,.85)', boxShadow: 'inset 0 0 0 1px var(--vg-chat-accent-45, rgba(176,107,255,.4)),0 4px 12px rgba(0,0,0,.5)' }}>
            <Icon name="open_in_new" size={14} className="text-brand-violet-light" /> Open map
          </span>
        </div>
        <div className="flex items-center gap-3 px-3.5 pt-3 pb-1.5">
          <span className="w-10 h-10 rounded-full grid place-items-center shrink-0" style={{ background: 'radial-gradient(circle at 50% 38%,#271c3d,#15101e)', boxShadow: '0 0 0 1.5px var(--vg-chat-accent-70, rgba(176,107,255,.6)),0 0 13px var(--vg-chat-accent-45, rgba(160,60,240,.5))' }}>
            <Icon name="location_on" size={20} className="text-[#c489ff]" style={{ filter: 'drop-shadow(0 0 4px rgba(180,90,255,.85))' }} />
          </span>
          <div className="min-w-0 flex-1">
            {/* 2-line clamp, not truncate: a real address ("Bridge Street,
                Millbank") was getting cut off at one line. */}
            <div className="font-syne font-bold text-white" style={{ fontSize: 13.5, lineHeight: 1.2, letterSpacing: '-.1px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{line1}</div>
            <div className="text-text-muted truncate mt-0.5" style={{ fontSize: 11.5 }}>{line2}</div>
          </div>
        </div>
      </button>
      <div className="flex items-center justify-end gap-2 px-3.5 pb-2.5">
        <span className="font-dmmono text-[11px] text-text-muted">{timeStr}</span>
        {read ? <CoinTicks /> : null}
      </div>
    </div>
  );
}

/* ═══════ Delivery ticks (single grey = sent, double blue = read) ═══════ */
// A tiny scale pop when the state flips (sent → read) sells reliability; the
// first render never pops so opening a thread doesn't twitch every row.
// Upload progress drawn ON the message that is already sitting in the thread.
//
// Telegram's model, and it is the right one: the bubble takes its place in the
// conversation the moment you hit send, and the progress lives on it. The
// alternative — holding the user on the preview screen until the upload
// finishes — makes a slow connection feel like the app has hung, and hides the
// message they just sent.
//
// Renders nothing once the send completes, so it simply disappears rather than
// needing to be torn down.
const fmtMB = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

const SendProgress = ({ msg }) => {
  if (!msg || msg._status !== 'sending') return null;
  const pct = typeof msg._progress === 'number' ? msg._progress : null;
  const total = msg._total || msg.fileSize || 0;
  const sent = msg._sent || (pct != null && total ? Math.round((pct / 100) * total) : 0);
  // 16px radius circle, circumference ~100 so the dash offset IS the percentage.
  const R = 16;
  const C = 2 * Math.PI * R;
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-black/45 rounded-sm pointer-events-none">
      <svg width="40" height="40" viewBox="0 0 40 40" className="-rotate-90">
        <circle cx="20" cy="20" r={R} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
        <circle
          cx="20" cy="20" r={R} fill="none" stroke="#B44FFF" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={C}
          // No percentage yet (still compressing, or the web path has not
          // reported) — show a partial arc rather than an empty ring, so it
          // never looks like nothing is happening.
          strokeDashoffset={pct == null ? C * 0.75 : C * (1 - pct / 100)}
          style={{ transition: 'stroke-dashoffset 200ms linear' }}
          className={pct == null ? 'animate-spin origin-center' : ''}
        />
      </svg>
      {/* While re-encoding there are no meaningful byte figures yet — the output
          does not exist — so say what is happening instead of showing a
          misleading MB count against the source file's size. */}
      {msg._phase === 'encoding' || msg._phase === 'trimming' ? (
        <span className="text-[10px] font-dmmono tabular-nums text-white/90">
          {msg._phase === 'trimming' ? 'Trimming' : 'Compressing'}{pct != null ? ` ${pct}%` : '…'}
        </span>
      ) : total > 0 ? (
        <span className="text-[10px] font-dmmono tabular-nums text-white/90">
          {fmtMB(sent)} / {fmtMB(total)}
        </span>
      ) : null}
    </div>
  );
};

const Ticks = ({ read, size = 12, className = '' }) => {
  const ref = useRef(null);
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    const el = ref.current;
    if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    try {
      el.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.45)' }, { transform: 'scale(1)' }],
        { duration: 300, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
      );
    } catch {}
  }, [read]);
  return (
    <span ref={ref} className={`inline-flex leading-none ${className}`}>
      <Icon name={read ? 'done_all' : 'done'} size={size} className={read ? 'text-[#4DA6FF]' : 'text-white/55'} />
    </span>
  );
};

/* ═══════ Inline Timestamp (Telegram-style, inside bubble) ═══════ */
const InlineTime = ({ time, isMe, read, status, edited }) => (
  <span className={`inline-flex items-center gap-1 float-right ml-3 mt-1 relative top-[3px] ${isMe ? 'text-white/50' : 'text-white/40'}`}>
    {edited && <span className="text-[8px] italic">edited</span>}
    <span className="text-[9px] font-medium">{time}</span>
    {isMe && (
      status === 'sending'
        ? <Icon name="schedule" size={11} className="opacity-50" />
        : <Ticks read={read} size={13} />
    )}
  </span>
);

/* ═══════ Expandable message text (Telegram-style "Read more" collapse) ═══════ */
// `overflow-wrap:anywhere` (not just break-word) also shrinks min-content so an
// unbroken string can't force the flex bubble past its max-width and bleed off-screen.
const READ_MORE_LIMIT = 600;

// Emoji-only messages (1-3 emoji, nothing else) render LARGE with no bubble —
// the Telegram/WhatsApp expressive treatment, zero custom assets needed.
const EMOJI_ONLY_RE = /^(?:\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*)*){1,3}$/u;
const isEmojiOnly = (m) => (m?.type === 'text' || !m?.type) && !m?.deleted && !!m?.text && EMOJI_ONLY_RE.test(m.text.trim());

// Render @username mentions highlighted (no per-message lookups — purely
// visual; the push-side mention logic lives in dmNotify).
const MENTION_SPLIT_RE = /(@[a-zA-Z0-9_.]{2,30})/g;
const renderWithMentions = (text, isMe) => {
  if (!text || !text.includes('@')) return text;
  const parts = text.split(MENTION_SPLIT_RE);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    /^@[a-zA-Z0-9_.]{2,30}$/.test(part)
      ? <span key={i} className={`font-semibold ${isMe ? 'text-white underline decoration-white/40' : 'text-brand-violet-light'}`}>{part}</span>
      : part
  );
};

const ExpandableText = ({ text, isMe, timeEl }) => {
  const [expanded, setExpanded] = useState(false);
  const long = (text?.length || 0) > READ_MORE_LIMIT;
  const shown = long && !expanded ? text.slice(0, READ_MORE_LIMIT).trimEnd() + '…' : text;
  return (
    <p className="px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {renderWithMentions(shown, isMe)}
      {long && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
          className={`block mt-1 text-xs font-semibold ${isMe ? 'text-white/80' : 'text-brand-violet-light'}`}>
          {expanded ? 'Show less' : 'Read more'}
        </button>
      )}
      {!long && timeEl}
      {long && expanded && timeEl}
    </p>
  );
};

/* ═══════ Quoted Reply Bar ═══════ */
const QuotedReply = ({ replyTo, isMe }) => {
  if (!replyTo) return null;
  const scrollToMsg = () => {
    const el = document.getElementById(`msg-${replyTo.id}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('ring-2', 'ring-brand-violet/50'); setTimeout(() => el.classList.remove('ring-2', 'ring-brand-violet/50'), 2000); }
  };
  return (
    <div onClick={scrollToMsg} className={`mx-3 mt-2 mb-1 pl-3 border-l-2 rounded-r-lg py-1.5 pr-3 cursor-pointer active:opacity-70 ${isMe ? 'border-white/30 bg-white/10' : 'border-brand-violet/50 bg-brand-violet/5'}`}>
      <p className={`text-[10px] font-bold ${isMe ? 'text-white/70' : 'text-brand-violet-light'}`}>{replyTo.senderName || 'User'}</p>
      <p className={`text-[11px] truncate ${isMe ? 'text-white/50' : 'text-text-muted'}`}>{replyTo.text || 'Media'}</p>
    </div>
  );
};

/* ═══════ Forward Modal ═══════ */
const ForwardModal = ({ message, onClose }) => {
  const [convos, setConvos] = useState([]);
  const [sending, setSending] = useState(false);
  const [term, setTerm] = useState('');
  const [targets, setTargets] = useState(new Set()); // multi-destination
  const relayEnabled = useChatRelayFlag();
  // Multi-select passes an ARRAY of messages; single forward passes one.
  const messageList = Array.isArray(message) ? message : [message];

  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(collection(db, 'conversations'), where('participants', 'array-contains', auth.currentUser.uid), where('status', '==', 'active'), orderBy('lastMessageAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => setConvos(
      snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(c => c.hiddenFor?.[auth.currentUser.uid] !== true)
    ));
    return () => unsub();
  }, []);

  const forwardToOne = async (convoId) => {
      for (const msg of messageList) {
        if (relayEnabled) {
          // Relay path: recipients don't read Firestore message docs — the
          // forward must travel over the relay to the TARGET conversation.
          await sendRelayMessageTo(convoId, {
            type: msg.type || 'text',
            text: msg.text || '',
            contentUrl: msg.contentUrl || '',
            videoUrl: msg.videoUrl || '',
            ...(msg.waveform ? { waveform: msg.waveform } : {}),
            forwardedFrom: msg.senderId,
          });
        } else {
          await addDoc(collection(db, 'conversations', convoId, 'messages'), {
            senderId: auth.currentUser.uid, createdAt: serverTimestamp(),
            type: msg.type || 'text', text: msg.text || '', contentUrl: msg.contentUrl || '',
            forwarded: true, forwardedFrom: msg.senderId,
          });
          await updateDoc(doc(db, 'conversations', convoId), {
            lastMessageText: `Forwarded: ${msg.text?.slice(0, 30) || 'media'}`,
            lastMessageAt: serverTimestamp(), lastMessageSenderId: auth.currentUser.uid,
          });
        }
      }
  };

  // Multi-destination send (WhatsApp flow: tick chats, one Send).
  const sendAll = async () => {
    if (!targets.size || sending) return;
    setSending(true);
    try {
      for (const convoId of targets) await forwardToOne(convoId);
      onClose();
    } catch (err) { console.error('Forward error:', err); setSending(false); }
  };

  const toggleTarget = (id) => setTargets(prev => {
    const s = new Set(prev);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-end sm:items-center justify-center animate-fade-in" onClick={onClose}>
      <div className="bg-surface-1 w-full max-w-md max-h-[70vh] rounded-t-2xl sm:rounded-2xl border border-white/[0.06] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/[0.04]">
          <h3 className="text-white font-bold text-sm">Forward to...</h3>
          <button onClick={onClose} className="text-text-muted"><Icon name="close" size={20} /></button>
        </div>
        <div className="px-4 py-2.5">
          <label className="block relative">
            <Icon name="search" size={15} className="absolute inset-y-0 left-3 my-auto h-[15px] text-text-muted pointer-events-none" />
            <input type="text" placeholder="Search chats..." value={term} onChange={e => setTerm(e.target.value)}
              className="w-full bg-surface-2 border border-white/[0.06] rounded-xl py-2 pl-9 pr-3 text-text-primary text-sm focus:border-brand-violet outline-none" />
          </label>
        </div>
        <div className="overflow-y-auto max-h-[45vh]">
          {convos
            .filter(c => {
              if (!term.trim()) return true;
              const name = c.isSaved ? 'Saved Messages' : chatPartner(c, auth.currentUser.uid, null).name;
              return name.toLowerCase().includes(term.trim().toLowerCase());
            })
            .map(c => {
              // chatPartner, not c.metadata: the forward picker was listing
              // people under their names/avatars from whenever the chat started.
              const p = chatPartner(c, auth.currentUser.uid, null);
              const name = c.isSaved ? 'Saved Messages' : p.name;
              const picked = targets.has(c.id);
              return (
                <button key={c.id} onClick={() => toggleTarget(c.id)} disabled={sending}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-2/50 text-left transition-colors disabled:opacity-50">
                  <UserAvatar src={p.avatar} size={40} />
                  <span className="text-sm text-text-primary font-medium flex-1 truncate">{name}</span>
                  <Icon name={picked ? 'check_circle' : 'radio_button_unchecked'} size={20}
                    className={picked ? 'text-brand-violet-light' : 'text-text-muted/40'} />
                </button>
              );
            })}
        </div>
        {targets.size > 0 && (
          <div className="p-3 border-t border-white/[0.04] flex items-center gap-3">
            <span className="flex-1 text-xs text-text-muted">{targets.size} chat{targets.size > 1 ? 's' : ''} selected</span>
            <button onClick={sendAll} disabled={sending}
              className="px-5 py-2.5 rounded-full bg-brand-violet text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
              {sending ? <div className="w-4 h-4 border-2 border-bg-dark border-t-transparent rounded-full animate-spin" /> : <Icon name="send" size={16} />}
              Send
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   CHAT THREAD SCREEN
   ═══════════════════════════════════════════════════════════ */
export default function ChatThreadScreen() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile } = useUser();
  const { isUserLive } = useLiveUsers();
  const scrollRef = useRef();
  const containerRef = useRef();
  const recorderRef = useRef(null);
  const recorderReadyRef = useRef(null);
  const recordKindRef = useRef('mic'); // which kind the in-flight recording is ('mic' | 'camera')
  const recordStartTsRef = useRef(0);  // wall-clock start → real duration for the #d= URL stamp
  const previewVideoRef = useRef(null); // live camera preview while recording a video message
  const inputRef = useRef(null);
  const longPressTimer = useRef(null);
  const recordingInterval = useRef(null);
  const { isDesktop } = useResponsive();
  const { typingUsers, setTyping, clearTyping } = useTyping(chatId);
  const relayEnabled = useChatRelayFlag();
  const { showToast } = useUI();
  const canSaveToGallery = isGallerySaveSupported();

  // Resolve the real media URL + kind for a chat message (video/clip → the
  // playable video; image/meme/giphy → the still).
  const mediaInfoFor = (m) => {
    if (!m) return null;
    if (m.type === 'clip') return m.videoUrl ? { url: m.videoUrl, isVideo: true } : null;
    if (m.type === 'video' || m.type === 'videonote') return m.contentUrl ? { url: m.contentUrl, isVideo: true } : null;
    if (['image', 'meme', 'giphy'].includes(m.type) && m.contentUrl) return { url: m.contentUrl, isVideo: false };
    return null;
  };

  const handleSaveMedia = async (m) => {
    const info = mediaInfoFor(m);
    if (!info) return;
    const res = await saveMediaToGallery(info.url, { isVideo: info.isVideo });
    if (res.ok) showToast?.(info.isVideo ? 'Video saved to gallery' : 'Photo saved to gallery', 'success');
    else if (res.error !== 'unsupported') showToast?.('Could not save to gallery', 'error');
  };

  // Tapping the header opens contact/group info. Groups → their own screen.
  // 1-to-1: desktop toggles the inline side drawer (?info), mobile pushes the
  // full-screen details route (Telegram-mobile pattern).
  const openContactInfo = () => {
    if (chatInfo?.isSaved) return;
    // A support ticket is a group under the hood, so tapping its header used to
    // open the full group-management screen: member list with roles, Invite
    // Members, rename, leave (audit A4). There is nothing there a person
    // raising a ticket should see or be able to do, so the header is inert.
    if (chatInfo?.supportThread === true) return;
    if (chatInfo?.isGroup) { navigate(`/messages/${chatId}/group`); return; }
    if (isDesktop) {
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        if (p.get('info') === '0') p.delete('info'); else p.set('info', '0');
        return p;
      }, { replace: true });
    } else {
      navigate(`/messages/${chatId}/details`);
    }
  };
  const { messages, rawMessages, loading, sendMessage: hookSend, removeLocalMessage, syncPreviewToLatest, editMessage: relayEditMessage, clearLocalMessages, loadOlderMessages, hasMoreHistory, mediaBlocked: strangerMediaBlocked } = useMessages(chatId);
  const { tier, tierConfig, checkFeature, checkFileSize } = useTier();
  // Always-fresh view of the message list for async loops (jump-to-date pages
  // history and must read the post-render array, not the stale closure copy).
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Auto-save incoming media to the gallery (native, when the toggle is on).
  // Only media that ARRIVES this session is saved (we snapshot the cutoff on
  // mount) so opening an old chat doesn't dump its whole history into the
  // gallery; and only INCOMING media (never your own sends).
  const autoSaveSince = useRef(Date.now());
  useEffect(() => { autoSaveSince.current = Date.now(); }, [chatId]);
  useEffect(() => {
    if (!canSaveToGallery || !messages?.length) return;
    const myUid = auth.currentUser?.uid;
    const wantPhotos = getAutoSavePhotos();
    const wantVideos = getAutoSaveVideos();
    if (!wantPhotos && !wantVideos) return;
    const msMs = (t) => (t?.toMillis ? t.toMillis() : (typeof t === 'number' ? t : 0));
    for (const m of messages) {
      if (!m || m.deleted || m.senderId === myUid) continue;
      if (msMs(m.createdAt) < autoSaveSince.current) continue;
      const info = mediaInfoFor(m);
      if (!info) continue;
      if (info.isVideo ? !wantVideos : !wantPhotos) continue;
      if (isMediaSaved(info.url)) continue;
      // Automatic saves go to the per-type albums, so they never mix with the
      // "VERGR" album the user curates by hand.
      saveMediaToGallery(info.url, { isVideo: info.isVideo, album: autoAlbumFor(info.isVideo) });
    }
  }, [messages, canSaveToGallery]);

  const [chatInfo, setChatInfo] = useState(null);

  // Calls in this conversation, rendered inline in the thread. Live, so a call
  // that just ended appears without a reload. Groups are excluded: 1:1 calling
  // is the only kind these rows describe.
  //
  // ⚠ This MUST sit below `chatInfo`'s declaration. The dependency array is
  // evaluated during render, so reading `chatInfo?.isGroup` from above the
  // `useState` line puts it in the temporal dead zone and throws
  // "Cannot access 'chatInfo' before initialization" on every mount. The build
  // passes either way — it is a runtime crash, caught here by the error
  // boundary as "Something went wrong".
  const [callRows, setCallRows] = useState([]);
  useEffect(() => {
    if (!chatId || chatInfo?.isGroup) { setCallRows([]); return undefined; }
    const unsub = subscribeCallsForChat(chatId, setCallRows);
    return () => unsub && unsub();
  }, [chatId, chatInfo?.isGroup]);

  const otherUserId = chatInfo?.participants?.find(id => id !== auth.currentUser?.uid);
  // `metadata` is a snapshot stored on the conversation doc — it doesn't
  // include the live `vanguard` rank. We fetch the live user doc once so
  // the Vanguard mask applies properly to the chat header.
  const otherUserMeta = chatInfo?.metadata?.[otherUserId];
  const [otherUserLive, setOtherUserLive] = useState(null);
  useEffect(() => {
    if (!otherUserId) { setOtherUserLive(null); return; }
    let alive = true;
    import('../../firebase/firestore').then(({ getUserById }) =>
      getUserById(otherUserId).then(u => { if (alive) setOtherUserLive(u); }).catch(() => {})
    );
    return () => { alive = false; };
  }, [otherUserId]);
  // Prefer the live doc; fall back to the warm identity cache (the inbox
  // resolves DM users, so this is usually a hit = no flash of the stale
  // metadata snapshot) before finally the frozen metadata.
  const otherUser = otherUserLive || peekChatUser(otherUserId) || otherUserMeta;
  const { isOnline: otherOnline, lastSeen: otherLastSeen } = useOnlineStatus(otherUserId);

  // Group chats: resolve LIVE member profiles once so bubbles can show who
  // is talking (sender attribution) with current names/avatars, not the
  // stale creation-time metadata snapshot.
  const [memberProfiles, setMemberProfiles] = useState({});
  const [reactorsView, setReactorsView] = useState(null); // { reactions, emoji } for the "who reacted" sheet
  const participantsKey = (chatInfo?.participants || []).join(',');
  useEffect(() => {
    if (!chatInfo?.isGroup || !chatInfo?.participants?.length) return;
    let alive = true;
    resolveChatUsers(chatInfo.participants).then((map) => { if (alive) setMemberProfiles(map); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatInfo?.isGroup, participantsKey]);

  // Full-screen media viewer state: { index } into lightboxItems.
  const [lightbox, setLightbox] = useState(null);

  // "Unread messages" divider: capture where the user HAD read up to the
  // moment they opened the chat (markRead overwrites readAt ~500ms later, so
  // snapshot once per chat open).
  const firstUnreadRef = useRef({ chatId: null, readAt: 0, unread: 0 });
  useEffect(() => {
    if (!chatInfo || firstUnreadRef.current.chatId === chatId) return;
    const uid = auth.currentUser?.uid;
    const v = chatInfo.readAt?.[uid];
    const remote = typeof v === 'number' ? v : (v?.toMillis?.() || 0);
    // When read receipts are off, readAt stops advancing — the local open
    // marker keeps the divider honest.
    let local = 0;
    try { local = Number(localStorage.getItem(`vergr.chatOpenAt.${uid}.${chatId}`)) || 0; } catch {/* ignore */}
    firstUnreadRef.current = {
      chatId,
      readAt: Math.max(remote, local),
      unread: chatInfo.unreadCount?.[uid] || 0,
    };
  }, [chatInfo, chatId]);

  // In a SUPPORT thread every participant except the person who opened it is an
  // agent, and they answer AS the channel. The user should see "Vergr Support",
  // not the name of whichever member of staff happened to pick it up: it keeps
  // the agent's identity private and stops the thread reading as a stranger
  // messaging them. Same masking rule as Vanguard. The real uid stays on the
  // message, so who answered is always recoverable internally.
  const supportUserId = chatInfo?.supportThread === true ? chatInfo.supportUserId : null;
  const isSupportAgent = (uid) => !!supportUserId && uid !== supportUserId;
  const supportLabel = chatInfo?.groupName || 'Support';

  // A support ticket is deliberately a GROUP conversation (functions/
  // supportChannel.js): the DM relay path is ciphertext, so only the two
  // endpoints could read it, and support has to be readable by whichever agent
  // picks it up next. That decision is correct and must not be reverted.
  //
  // What was never done is suppressing the group UI it inherits (audit A4). A
  // user raising a ticket was offered Invite Members (add a stranger to your
  // own private support conversation, who then reads the whole history), a
  // MEMBERS panel with OWNER/ADMIN roles (exposing support staffing to the
  // person raising the ticket), Auto-delete (set your own support record to
  // self-destruct) and Report (aimed at the support team answering you).
  const isSupportThread = chatInfo?.supportThread === true;

  // Name resolution for a message sender (nickname → live profile → snapshot).
  const senderNameOf = (uid) => {
    if (uid === auth.currentUser?.uid) return 'You';
    if (isSupportAgent(uid)) return supportLabel;
    return chatDisplayName(uid, memberProfiles[uid] || (uid === otherUserId ? otherUserLive : null), profile, chatInfo?.metadata?.[uid]?.name || 'User');
  };

  // The live user doc behind a uid in this thread, or null. Everything here is
  // already loaded for names and avatars, so this is a property read and never
  // a fetch — which is what lets the typing indicator show the TYPIST's
  // cosmetics for free (docs/effects/06-typing-indicator.md §4.1).
  const profileOf = (uid) =>
    (uid ? (memberProfiles[uid] || (uid === otherUserId ? (otherUserLive || otherUser) : null) || peekChatUser(uid)) : null);

  // Resolve a reactor uid → { displayName, avatar } for the "who reacted" sheet.
  const resolveReactor = (uid) => {
    if (uid === auth.currentUser?.uid) return { displayName: 'You', avatar: profile?.avatar || profile?.photoURL || null };
    const p = memberProfiles[uid] || (uid === otherUserId ? (otherUserLive || otherUser) : null) || peekChatUser(uid);
    return {
      displayName: p?.displayName || p?.username || chatInfo?.metadata?.[uid]?.name || 'User',
      avatar: p?.avatar || p?.photoURL || null,
    };
  };

  // System pills ("… renamed the group to X") must show the actor's CURRENT
  // name. Baking the name into the text at write time froze it forever — a user
  // who later renamed themselves still showed up under their old display name
  // on every historical pill. New pills are written with an `{actor}` token and
  // the name is resolved at RENDER time from the row's senderId (the actor is
  // always the sender). Legacy pills have no token and render verbatim, so old
  // messages are left exactly as they are rather than half-rewritten.
  const systemText = (m) => {
    const raw = m?.text || '';
    if (!raw.includes('{actor}')) return raw;
    const uid = m.senderId;
    let name = 'Someone';
    if (uid) {
      const p = memberProfiles[uid] || (uid === otherUserId ? (otherUserLive || otherUser) : null) || peekChatUser(uid);
      name = (uid === auth.currentUser?.uid ? (profile?.displayName || profile?.username) : null)
        || p?.displayName || p?.username
        || chatInfo?.metadata?.[uid]?.name || 'Someone';
    }
    return raw.replace(/\{actor\}/g, name);
  };

  // ── Scheduled messages (Lite/Pro) ──────────────────────────────────
  // Pending scheduled sends for THIS chat (two equality filters → no composite
  // index). The relay executes them server-side.
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !chatId) { setScheduledMsgs([]); return undefined; }
    const q = query(collection(db, 'scheduled_messages'), where('senderUid', '==', uid), where('convoId', '==', chatId));
    return onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => {
        const x = d.data();
        const ms = x.sendAt?.toMillis ? x.sendAt.toMillis() : (x.sendAt?.seconds ? x.sendAt.seconds * 1000 : (typeof x.sendAt === 'number' ? x.sendAt : 0));
        return { id: d.id, text: x.text || '', sendAt: ms, mediaKind: x.mediaKind || '', contentUrl: x.contentUrl || '' };
      }).sort((a, b) => a.sendAt - b.sendAt);
      setScheduledMsgs(rows);
    }, () => setScheduledMsgs([]));
  }, [chatId]);

  // Gate once, here: both the composer long-press and the media long-press
  // route through this, so a free user never uploads before being told no.
  const scheduleAllowed = () => {
    if (tier === 'free') {
      setUpgradeModal({ open: true, requiredTier: 'lite', message: 'Schedule messages to send automatically later, a Lite or Pro feature.' });
      return false;
    }
    return true;
  };
  const openSchedule = () => {
    if (!scheduleAllowed()) return;
    setScheduleMedia(null); // composer path = text
    setScheduleOpen(true);
  };

  // Media path: the attachment must exist at a URL before it can be scheduled
  // (the relay delivers a url, it can't hold a file), so we upload NOW and
  // schedule the resulting CDN url. The upload is the only slow part; the
  // sheet opens as soon as it lands.
  const openScheduleMedia = async (file, caption = '', editOpts = null) => {
    if (!scheduleAllowed()) return;
    setPreviewFile(null);
    const isImage = file.type?.startsWith('image/'); const isVideo = file.type?.startsWith('video/'); const isAudio = file.type?.startsWith('audio/');
    const videoOpts = isVideo ? editOpts : null;
    const uploadOpts = isImage && editOpts?.rotate ? { rotate: editOpts.rotate } : undefined;
    const folder = isImage ? 'chat_images' : isVideo ? 'chat_videos' : isAudio ? 'voice_notes' : 'chat_files';
    const type = isImage ? 'image' : isVideo ? 'video' : isAudio ? 'audio' : 'file';
    setScheduleUploading(true);
    try {
      // Honour the quality the sender picked here too — the relay stores a URL,
      // so whatever is uploaded now is what gets delivered later.
      const outFile = videoOpts ? await compressVideo(file, tier, null, 'clip', videoOpts) : file;
      const url = await uploadMediaFile(
        outFile, folder, tier, tierConfig.mediaRetentionDays, 'chat', undefined, uploadOpts,
      );
      setScheduleMedia({ contentUrl: url, type, caption: caption || '', fileName: outFile.name || file.name });
      setScheduleOpen(true);
    } catch (err) {
      console.error('Schedule media upload failed:', err);
      showToast?.('Could not upload that file', 'error');
    } finally {
      setScheduleUploading(false);
    }
  };

  const doSchedule = async (whenMs) => {
    const media = scheduleMedia;
    const text = media ? (media.caption || '') : input.trim();
    if (!media && !text) { showToast?.('Type a message first', 'error'); return; }
    try {
      await httpsCallable(functions, 'scheduleMessage')({
        convoId: chatId,
        text,
        sendAt: whenMs,
        ...(media ? { contentUrl: media.contentUrl, mediaKind: media.type } : {}),
      });
      if (!media) { setInput(''); clearDraft(chatId); }
      setScheduleMedia(null);
      showToast?.('Message scheduled', 'success');
      setScheduleOpen(false);
    } catch (e) {
      showToast?.(e?.message || 'Could not schedule', 'error');
    }
  };
  const cancelScheduled = async (id) => {
    try { await deleteDoc(doc(db, 'scheduled_messages', id)); showToast?.('Scheduled message canceled', 'success'); }
    catch { showToast?.('Could not cancel', 'error'); }
  };

  // ── Whole-chat auto-translate (Lite/Pro, visible-messages-only) ──────────
  // Per-chat device preference (a desktop and a phone can want different
  // targets). To keep costs down we only ever translate messages that actually
  // scroll into view (IntersectionObserver), then more as new messages arrive.
  // NOTE: declared here (before the effects/callbacks below reference them) so
  // the auto-translate effect's dependency array isn't evaluated while these
  // bindings are still in their temporal dead zone (render-time TDZ crash).
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [translations, setTranslations] = useState({}); // msgId -> {text, detected} | 'pending' | 'error'
  const translateObserverRef = useRef(null);
  const jumpDateRef = useRef(null);

  // Load the per-chat preference from the device on chat switch. Reset the
  // translation cache so a new chat starts clean.
  useEffect(() => {
    setTranslations({});
    try { setAutoTranslate(localStorage.getItem(`vergr_autotranslate_${chatId}`) === '1'); }
    catch { setAutoTranslate(false); }
  }, [chatId]);

  const toggleAutoTranslate = () => {
    if (!autoTranslate && tier === 'free') {
      setUpgradeModal({ open: true, requiredTier: 'lite', message: 'Auto-translate every message in a chat into your language, a Lite or Pro feature.' });
      setShowHeaderMenu(false);
      return;
    }
    const next = !autoTranslate;
    setAutoTranslate(next);
    try { localStorage.setItem(`vergr_autotranslate_${chatId}`, next ? '1' : '0'); } catch { /* ignore */ }
    setShowHeaderMenu(false);
  };

  // Translate one message on demand (called when it scrolls into view). Guards
  // against duplicate/in-flight requests and short-circuits when the text is
  // already in the viewer's language (server returns the same string).
  const requestTranslate = useCallback((id, text) => {
    if (!id || !text) return;
    setTranslations((prev) => {
      if (prev[id]) return prev; // pending / done / error already
      const target = translateTarget(profile);
      translateContent({ text: String(text), target, kind: 'message' })
        .then((r) => setTranslations((p) => ({ ...p, [id]: { text: r.translatedText, detected: r.detected || null } })))
        .catch(() => setTranslations((p) => ({ ...p, [id]: 'error' })));
      return { ...prev, [id]: 'pending' };
    });
  }, [profile]);

  // IntersectionObserver: translate ONLY the incoming foreign messages that
  // actually become visible, then more as the user scrolls / new ones arrive.
  useEffect(() => {
    if (!autoTranslate) { translateObserverRef.current?.disconnect(); return undefined; }
    const root = containerRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return undefined;
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = e.target.getAttribute('data-translate-id');
        const text = e.target.getAttribute('data-translate-text');
        if (id && text) requestTranslate(id, text);
        obs.unobserve(e.target); // once translated, stop watching
      }
    }, { root, threshold: 0.15 });
    translateObserverRef.current = obs;
    root.querySelectorAll('[data-translate-id]').forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [autoTranslate, chatId, messages.length, requestTranslate]);

  // ── Jump to date ─────────────────────────────────────────────────────────
  // Opens the native date picker; on pick, scrolls to the first message on or
  // after that day. If the target predates the loaded window, pages older
  // history (bounded) until it's in range, then scrolls.
  const openJumpToDate = () => {
    setShowHeaderMenu(false);
    const el = jumpDateRef.current;
    if (!el) return;
    if (el.showPicker) { try { el.showPicker(); return; } catch { /* fall through */ } }
    el.focus(); el.click();
  };
  const msgDayMs = (m) => {
    const d = m?.createdAt?.toDate ? m.createdAt.toDate() : null;
    return d ? d.getTime() : 0;
  };
  // Highlight a message by id, paging older history in until it's loaded.
  // Shared by the ?msg= deep link (global search results) and anything else
  // that needs to land on a specific message.
  const highlightMessage = (id) => {
    const node = document.getElementById(`msg-${id}`);
    if (!node) return false;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.classList.add('ring-2', 'ring-brand-violet/50');
    setTimeout(() => node.classList.remove('ring-2', 'ring-brand-violet/50'), 2000);
    return true;
  };
  const jumpToMessage = async (id) => {
    if (!id) return;
    const has = () => messagesRef.current.some((m) => m.id === id);
    let guard = 0;
    // Same settle-then-read pattern as jumpToDate: messagesRef must be read
    // AFTER the re-render commits or the just-loaded page is invisible here.
    while (!has() && hasMoreHistory && loadOlderMessages && guard < 40) {
      const added = await loadOlderMessages();
      guard += 1;
      await new Promise((r) => setTimeout(r, 60));
      if (!added) break;
    }
    if (!has()) { showToast?.('Could not find that message', 'info'); return; }
    // One more frame so the node exists in the DOM, not just in state.
    await new Promise((r) => setTimeout(r, 60));
    highlightMessage(id);
  };

  // Deep link: /messages/:chatId?msg=<id> (global search → the exact message).
  // Consume the param so a later re-render can't re-trigger the jump.
  const jumpedToRef = useRef('');
  useEffect(() => {
    const target = searchParams.get('msg');
    if (!target || loading || jumpedToRef.current === target) return;
    jumpedToRef.current = target;
    jumpToMessage(target).finally(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('msg');
        return next;
      }, { replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loading]);

  const jumpToDate = async (value) => {
    if (!value) return;
    const target = new Date(`${value}T00:00:00`).getTime();
    const realMsgs = () => messagesRef.current.filter((m) => !m._type && m.type !== 'system');
    const findFirst = () => realMsgs().find((m) => msgDayMs(m) >= target);
    let hit = findFirst();
    // Target predates everything loaded → page older history until it's in
    // range (or history runs out). Read messagesRef AFTER a settle so the
    // just-loaded page is committed to the render.
    let guard = 0;
    while (!hit && hasMoreHistory && loadOlderMessages && guard < 40) {
      const earliest = realMsgs()[0];
      if (earliest && msgDayMs(earliest) < target) break; // window covers it, no earlier match exists
      const added = await loadOlderMessages();
      guard += 1;
      await new Promise((r) => setTimeout(r, 60)); // let the re-render commit
      if (!added) break;
      hit = findFirst();
    }
    if (!hit) hit = findFirst();
    if (hit) {
      const node = document.getElementById(`msg-${hit.id}`);
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        node.classList.add('ring-2', 'ring-brand-violet/50');
        setTimeout(() => node.classList.remove('ring-2', 'ring-brand-violet/50'), 2000);
      }
    } else {
      showToast?.('No messages on or after that date', 'info');
    }
    if (jumpDateRef.current) jumpDateRef.current.value = ''; // allow re-picking the same date
  };

  // Group "only admins post": members can read but the composer is locked.
  // Enforced client-side here, rules-side (onlyAdminsPost is an admin-only
  // field) and relay-side (dm.go rejects msg frames from non-admins).
  const amGroupAdmin = !chatInfo?.isGroup
    || chatInfo?.createdBy === auth.currentUser?.uid
    || (chatInfo?.admins || []).includes(auth.currentUser?.uid);
  const postingLocked = !!(chatInfo?.isGroup && chatInfo?.onlyAdminsPost && !amGroupAdmin);

  // Granular member permissions (admins are never restricted). Same three-layer
  // enforcement as onlyAdminsPost: here, in the rules, and in the relay — the
  // client gate is UX, the relay gate is what actually holds.
  const canSendMedia = groupAllows(chatInfo, 'sendMedia', auth.currentUser?.uid);
  const canSendLinks = groupAllows(chatInfo, 'sendLinks', auth.currentUser?.uid);
  const canPinHere = groupAllows(chatInfo, 'pin', auth.currentUser?.uid);

  // ── Disappearing messages / auto-delete ────────────────────────────
  // NOTE: declared HERE, below amGroupAdmin, because `canSetTtl` is evaluated at
  // RENDER time — reading amGroupAdmin from above its declaration would be a
  // temporal-dead-zone ReferenceError (a clean vite build does not catch this;
  // it black-screens the route at runtime).
  const chatTtl = Number(chatInfo?.ttlSeconds) || 0;
  // In a group only admins may arm the timer (mirrors the Firestore rule);
  // in a 1:1 DM either party may (Telegram model).
  const canSetTtl = !chatInfo?.isGroup || amGroupAdmin;

  // Only tick while a timer is armed — an idle chat must never re-render forever.
  useEffect(() => {
    if (!chatTtl) return undefined;
    const t = setInterval(() => setExpireTick(Date.now()), 10000);
    return () => clearInterval(t);
  }, [chatTtl]);

  const setChatTtl = async (seconds) => {
    setTtlSheetOpen(false);
    if (seconds === chatTtl) return;
    try {
      await updateDoc(doc(db, 'conversations', chatId), { ttlSeconds: seconds });
      // Telegram posts a system row so BOTH sides see the timer change.
      const who = profile?.displayName || profile?.username || 'Someone';
      await sendMsg({
        type: 'system',
        text: seconds
          ? `${who} set messages to disappear after ${ttlLabel(seconds)}`
          : `${who} turned off disappearing messages`,
      });
      showToast?.(seconds ? `Messages now disappear after ${ttlLabel(seconds)}` : 'Disappearing messages off', 'success');
    } catch (e) {
      showToast?.(e?.message || 'Could not change the timer', 'error');
    }
  };

  // Read-receipt privacy (settings → Privacy → "Read receipts"). WhatsApp
  // semantics: turning it OFF is mutual — you stop sending readAt AND stop
  // seeing others' read ticks.
  const readReceiptsOn = profile?.settings?.privacy?.readReceipts !== false;

  // Read receipts (relay path): a message of mine is "read" when every OTHER
  // participant's readAt marker is at/after the message's timestamp.
  const othersReadAt = (() => {
    if (!relayEnabled || !readReceiptsOn) return 0;
    const ra = chatInfo?.readAt || {};
    const others = (chatInfo?.participants || []).filter(id => id && id !== auth.currentUser?.uid);
    if (!others.length) return 0;
    let min = Infinity;
    for (const id of others) {
      const v = ra[id];
      const ms = typeof v === 'number' ? v : (v?.toMillis?.() || 0);
      if (ms < min) min = ms;
    }
    return min === Infinity ? 0 : min;
  })();
  const [input, setInput] = useState('');

  // @mention autocomplete (groups): typing "@..." at the end of the input
  // offers member usernames; selecting inserts "@username ". MUST sit after the
  // `input` useState above: it reads `input`, and a const placed before that
  // declaration crashes the group thread with a TDZ ("Cannot access before
  // initialization") since the isGroup branch dereferences `input`.
  const mentionMatch = chatInfo?.isGroup ? /(^|\s)@([a-zA-Z0-9_.]{0,20})$/.exec(input) : null;
  const mentionCandidates = mentionMatch
    ? Object.entries(memberProfiles)
        .filter(([uid]) => uid !== auth.currentUser?.uid)
        .map(([uid, u]) => ({ uid, username: u?.username, name: u?.displayName || u?.username, avatar: u?.avatar }))
        .filter(c => c.username && (
          mentionMatch[2] === '' ||
          c.username.toLowerCase().startsWith(mentionMatch[2].toLowerCase()) ||
          (c.name || '').toLowerCase().startsWith(mentionMatch[2].toLowerCase())
        ))
        .slice(0, 6)
    : [];
  const insertMention = (username) => {
    setInput(prev => prev.replace(/(^|\s)@([a-zA-Z0-9_.]{0,20})$/, `$1@${username} `));
    inputRef.current?.focus();
  };

  // P8: native inline-reply hands the typed draft here via ?prefill= so the
  // composer opens with it ready to send (relay/E2E send stays web-side).
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const pf = params.get('prefill');
      if (pf) {
        setInput(pf);
        const url = window.location.pathname;
        window.history.replaceState({}, '', url);
        return;
      }
    } catch { /* ignore */ }
    // Share target: text/a link was shared into Vergr from another app and the
    // user has now picked this chat. Consume it (first chat opened wins) and
    // seed the composer — same end state as ?prefill=.
    const shared = consumeSharedText();
    if (shared) {
      setInput(shared);
      showToast?.('Shared link added to your message', 'success');
      return;
    }
    // A shared PHOTO/VIDEO lands in the normal attachment preview (caption +
    // send), so the share path and the pick-from-gallery path stay identical.
    const media = consumeSharedMedia();
    if (media) {
      sharedMediaToFile(media)
        .then((file) => { if (file) setPreviewFile(file); })
        .catch((err) => {
          console.error('Shared media read failed:', err);
          showToast?.("Couldn't open the shared file", 'error');
        });
    }
    // No prefill: restore this chat's saved draft (Telegram behaviour).
    setInput(getDraft(chatId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);
  const [showMedia, setShowMedia] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  // WhatsApp recording gestures: hold = record, slide LEFT = cancel,
  // slide UP = lock (hands-free). Refs mirror state for pointer handlers
  // (which outlive renders thanks to pointer capture).
  const [recordLocked, setRecordLocked] = useState(false);
  const [recordDragX, setRecordDragX] = useState(0);
  const recordPtrStart = useRef(null);     // {x,y} at hold start
  const isRecordingRef = useRef(false);
  const recordLockedRef = useRef(false);
  const lockReleasePendingRef = useRef(false); // swallow the release that engaged the lock
  const [contextMenuMsgId, setContextMenuMsgId] = useState(null);
  // Multi-select mode: null = off, Set of message ids = on (context-menu →
  // Select). Tapping bubbles toggles; the composer swaps to an action bar.
  const [selectedIds, setSelectedIds] = useState(null);
  const [showSelDelete, setShowSelDelete] = useState(false); // delete-options popover in the selection bar
  const toggleSelect = (id) => setSelectedIds(prev => {
    const s = new Set(prev || []);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s.size ? s : null;
  });
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [translateMsg, setTranslateMsg] = useState(null); // message being shown in the translation sheet
  const [previewFile, setPreviewFile] = useState(null);
  const [optimisticMsgs, setOptimisticMsgs] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [editingMsg, setEditingMsg] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [forwardMsg, setForwardMsg] = useState(null);
  const [upgradeModal, setUpgradeModal] = useState({ open: false, requiredTier: 'lite', message: '' });
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledMsgs, setScheduledMsgs] = useState([]); // pending scheduled for THIS chat
  // Staged media awaiting a send time: { contentUrl, type, caption, fileName }.
  // Null = the sheet is scheduling the composer's text.
  const [scheduleMedia, setScheduleMedia] = useState(null);
  const [scheduleUploading, setScheduleUploading] = useState(false);
  // Disappearing messages: a clock that ticks only while a TTL is armed, so an
  // expiring message leaves the screen without needing any other state change.
  const [expireTick, setExpireTick] = useState(() => Date.now());
  const [ttlSheetOpen, setTtlSheetOpen] = useState(false);
  const sendHoldRef = useRef({ timer: null, long: false });
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  // The menu is PORTALLED to <body> (the header sets backdrop-filter, which
  // would otherwise clip it and trap its z-index). A portal is positioned
  // against the VIEWPORT, so the old hard-coded `right-4` pinned it to the far
  // right of the screen — which on desktop is on top of the Contact Info
  // drawer, not under the ⋮ button. Measure the button and anchor to it.
  const headerMenuBtnRef = useRef(null);
  const [headerMenuPos, setHeaderMenuPos] = useState({ top: 58, right: 16 });
  const openHeaderMenu = () => {
    if (!showHeaderMenu) {
      const r = headerMenuBtnRef.current?.getBoundingClientRect();
      if (r) {
        const MENU_W = 208; // w-52
        const right = Math.max(8, Math.min(window.innerWidth - r.right - 4, window.innerWidth - MENU_W - 8));
        setHeaderMenuPos({ top: Math.round(r.bottom + 6), right: Math.round(right) });
      }
    }
    setShowHeaderMenu(s => !s);
  };
  const [showMuteOptions, setShowMuteOptions] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [alsoDeleteForThem, setAlsoDeleteForThem] = useState(false);
  const [deletingChat, setDeletingChat] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  // Count of messages that arrived while scrolled up — shown as a badge on
  // the scroll-to-bottom FAB (Telegram). Tracked by last-message identity so
  // history pagination (prepends) never inflates it.
  const [newBelow, setNewBelow] = useState(0);

  // Attachment menu states
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  // Explains the stranger-DM media block. Shown on demand (attach tap / a
  // rejected send) rather than permanently, so an ordinary text conversation
  // isn't cluttered by a rule that hasn't come up yet.
  const [showStrangerNote, setShowStrangerNote] = useState(false);
  // The attach button, so the sheet can open ABOVE it on desktop instead of in
  // a fixed viewport corner (which lands over the sidebar, nowhere near the
  // composer, once the 3-column layout is in play).
  const attachBtnRef = useRef(null);
  const [showContactSubMenu, setShowContactSubMenu] = useState(false);
  const [locationAsk, setLocationAsk] = useState(false);
  const [showLocationSubMenu, setShowLocationSubMenu] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showEventPicker, setShowEventPicker] = useState(false);
  const [showPollSheet, setShowPollSheet] = useState(false);
  const [showSendCoinsModal, setShowSendCoinsModal] = useState(false);
  const [recordMode, setRecordMode] = useState('mic'); // 'mic' or 'camera'
  // Live camera stream for the record preview. Kept in state (not just a ref)
  // so an effect can attach it AFTER the preview <video> mounts — attaching
  // inline in handleRecordStart raced the React render (getUserMedia often
  // resolves before the element exists → previewVideoRef.current was null →
  // black circle, "records in the background" with no preview).
  const [recordStream, setRecordStream] = useState(null);
  const [showRecordModeHover, setShowRecordModeHover] = useState(false);

  const swipeRef = useRef({ startX: 0, startY: 0, msgId: null, swiping: false });

  useEffect(() => {
    if (!chatId) return;
    const unsub = onSnapshot(doc(db, 'conversations', chatId), (d) => { if (d.exists()) setChatInfo(d.data()); });
    return () => unsub();
  }, [chatId]);

  // Warm up html2canvas so the first delete animation doesn't stall on a
  // 400KB dynamic import. Runs once when the chat screen mounts.
  useEffect(() => { preloadThanosDissolve(); }, []);

  // Mobile virtual-keyboard handling.
  // On mobile when the textarea is focused, the browser tries to scroll
  // the input into view at the document level. Because 100dvh doesn't
  // instantly track keyboard show/hide on every WebView, the outer chat
  // container ends up taller than the visible viewport and the page
  // scrolls up — header disappears, blank space under the input. Fix:
  // pin the container to visualViewport.height and keep the window pinned
  // at scroll-0 so nothing can push off-screen.
  useEffect(() => {
    if (isDesktop) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      document.documentElement.style.setProperty('--chat-vh', `${vv.height}px`);
      // Kill any scroll the browser tried to apply at window level
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    window.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      window.removeEventListener('scroll', apply);
      document.documentElement.style.removeProperty('--chat-vh');
    };
  }, [isDesktop]);

  // Track whether we've done the initial jump-to-bottom for this chat.
  // First open should snap instantly to the latest message; subsequent
  // updates only smooth-scroll if the user is already near the bottom.
  const initialScrollDoneRef = useRef(false);

  // Set the moment WE send anything (text, media, voice, video note). Sending
  // must ALWAYS ride the view to the bottom so you see your own message land,
  // even if you'd scrolled up in history first.
  const forceScrollRef = useRef(false);
  const markOwnSend = useCallback(() => { forceScrollRef.current = true; }, []);

  // Open a thread on the first UNREAD message instead of the very bottom when
  // there's a real backlog (you shouldn't have to scroll up to find where you
  // left off). A couple of messages still just opens at the bottom.
  const UNREAD_JUMP_THRESHOLD = 10;

  // Reset the "initial scroll" flag whenever the user opens a different chat.
  useEffect(() => {
    initialScrollDoneRef.current = false;
  }, [chatId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (loading) return;
    if (messages.length === 0) return;

    if (!initialScrollDoneRef.current) {
      // Snap instantly to the bottom on first paint after messages arrive.
      // Media inside messages (images, videos, GIFs, clips) loads async and
      // expands layout AFTER our initial jump, so we keep re-pinning the
      // scroll for ~1.5s OR until the user scrolls themselves. Also listen
      // to `load` events bubbling up from <img>/<video> so the last jump
      // always happens *after* the final media settles.
      //
      // Exception: with a real unread backlog we open on the FIRST UNREAD
      // message (docked just under the header) rather than the bottom.
      const bigBacklog = firstUnreadRef.current.chatId === chatId
        && firstUnreadRef.current.unread >= UNREAD_JUMP_THRESHOLD;
      const jump = () => {
        if (bigBacklog) {
          const marker = container.querySelector('[data-first-unread]');
          if (marker) {
            container.scrollTop = Math.max(0, marker.offsetTop - 72);
            return;
          }
        }
        container.scrollTop = container.scrollHeight;
      };
      let userScrolled = false;
      const onUserScroll = () => { userScrolled = true; };
      container.addEventListener('wheel', onUserScroll, { passive: true, once: true });
      container.addEventListener('touchmove', onUserScroll, { passive: true, once: true });

      const pinIfSafe = () => { if (!userScrolled) jump(); };
      jump();
      requestAnimationFrame(pinIfSafe);
      const timeouts = [60, 200, 500, 900, 1500].map(ms => setTimeout(pinIfSafe, ms));

      const onMediaLoad = (e) => {
        if (e.target && (e.target.tagName === 'IMG' || e.target.tagName === 'VIDEO')) pinIfSafe();
      };
      container.addEventListener('load', onMediaLoad, true);
      setTimeout(() => {
        container.removeEventListener('load', onMediaLoad, true);
        container.removeEventListener('wheel', onUserScroll);
        container.removeEventListener('touchmove', onUserScroll);
        timeouts.forEach(clearTimeout);
      }, 2000);

      initialScrollDoneRef.current = true;
      setShowScrollButton(false);
      return;
    }

    // Our own send always rides to the bottom, regardless of scroll position.
    if (forceScrollRef.current) {
      forceScrollRef.current = false;
      const ride = () => container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      requestAnimationFrame(ride);
      // Media (a photo/video note) expands the layout after it decodes, so
      // re-pin a few times or the message lands just below the fold.
      [120, 350, 700].forEach(ms => setTimeout(ride, ms));
      setShowScrollButton(false);
      return;
    }

    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
    if (isNearBottom) {
      // Scope the scroll to the chat container, NOT scrollRef.scrollIntoView.
      // On the native WebView scrollIntoView scrolls the DOCUMENT too, which
      // fights the visual-viewport keyboard pin above and shoves the header
      // off-screen after every send ("ui pushes up"). scrollTo on the
      // container moves only its own scrollbar, never the window.
      requestAnimationFrame(() => {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      });
    }
    setShowScrollButton(!isNearBottom);
  }, [loading, messages.length, optimisticMsgs.length, typingUsers.length]);

  // Infinite scroll-up: near the top, pull the next page of older history
  // from Dexie and keep the viewport anchored (no visual jump).
  const loadingOlderRef = useRef(false);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = async () => {
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
      setShowScrollButton(!isNearBottom);
      if (container.scrollTop < 80 && hasMoreHistory && loadOlderMessages && !loadingOlderRef.current) {
        loadingOlderRef.current = true;
        const prevH = container.scrollHeight;
        const prevTop = container.scrollTop;
        const added = await loadOlderMessages();
        if (added) {
          requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight - prevH + prevTop;
            loadingOlderRef.current = false;
          });
        } else {
          loadingOlderRef.current = false;
        }
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [hasMoreHistory, loadOlderMessages]);

  const scrollToBottom = () => {
    // Container-scoped (see note above): scrollIntoView would scroll the
    // document on native and push the header up.
    const container = containerRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    else scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    setNewBelow(0);
  };

  // FAB unread badge: bump when a NEW last message from someone else lands
  // while the user is scrolled up; clear whenever they're back at the bottom.
  const lastMsgIdRef = useRef(null);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    const prev = lastMsgIdRef.current;
    lastMsgIdRef.current = last.id;
    if (prev && last.id !== prev && showScrollButton && last.senderId !== auth.currentUser?.uid) {
      setNewBelow((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);
  useEffect(() => { if (!showScrollButton) setNewBelow(0); }, [showScrollButton]);

  useEffect(() => {
    if (!chatId || !auth.currentUser || !rawMessages.length) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const unreadFromOthers = rawMessages.filter(m => m.senderId !== uid && !m.read && !m.deleted);
    // Reset the badge unconditionally when this chat is open. Earlier this
    // hook bailed when `unreadFromOthers.length === 0` — which left the
    // count stuck if the sender deleted their messages before the
    // recipient ever opened the chat. Always writing 0 here is cheap (one
    // doc update per chat open) and is the canonical "I've seen this" signal.
    const markRead = async () => {
      try {
        // Local open marker — drives the "Unread messages" divider even when
        // read receipts are disabled (readAt then never advances).
        try { localStorage.setItem(`vergr.chatOpenAt.${uid}.${chatId}`, String(Date.now())); } catch {/* ignore */}
        if (relayEnabled) {
          // Relay path: no per-message Firestore docs exist. Clear the
          // conversation-level unread counter AND (receipts permitting)
          // stamp our per-user read marker — the sender's ticks turn blue
          // off readAt.{uid} (one numeric field per member).
          await updateDoc(doc(db, 'conversations', chatId), {
            [`unreadCount.${uid}`]: 0,
            ...(readReceiptsOn ? { [`readAt.${uid}`]: Date.now() } : {}),
            // Clear my inbox @-badge (set by dmNotify when I was mentioned).
            ...(chatInfo?.isGroup ? { [`mentions.${uid}`]: deleteField() } : {}),
          });
        } else {
          const batch = writeBatch(db);
          if (readReceiptsOn) {
            unreadFromOthers.forEach(m => { batch.update(doc(db, 'conversations', chatId, 'messages', m.id), { read: true, readAt: serverTimestamp() }); });
          }
          batch.update(doc(db, 'conversations', chatId), { [`unreadCount.${uid}`]: 0 });
          await batch.commit();
        }
      } catch (err) { /* silently fail */ }
    };
    const timer = setTimeout(markRead, 500);
    return () => clearTimeout(timer);
  }, [chatId, rawMessages]);

  // ── Chat theme (effect 12) ──────────────────────────────────────────
  // ⚠ Resolved from the profile of whoever SET it, not the viewer's, and not at
  // write time. If they drop below the level or their Pro lapses, the theme
  // stops rendering by itself — no cleanup job. See chatThemes.js.
  // The setter's profile is already loaded for their name and avatar, so this
  // costs nothing (docs/effects/12 §2b).
  const chatTheme = chatThemeFor(chatInfo, profileOf(chatInfo?.chatThemeBy));
  const isLightApp = typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-theme') === 'light';
  const themeColors = chatThemeColors(chatTheme, isLightApp);
  // One phase step per message YOU send, which is Telegram's rule. Counting my
  // own messages means the prop changes exactly on send, and it is stable on
  // load so the thread does not animate when you open it.
  const mySendCount = messages.filter((m) => m.senderId === auth.currentUser?.uid).length;

  // ── BUBBLE COLOURS ──────────────────────────────────────────────
  // A theme resolves to the gradient PLUS the bubbles (doc 12 §2b). Null when
  // no theme is set, so the default violet is untouched for everyone who has
  // not chosen one.
  const bubble = chatBubbleColors(chatTheme);

  // ⚠ ANCHORED TO THE THREAD, NOT THE BUBBLE (doc 12 §0.3). Telegram's shader
  // spans the whole chat background and each bubble paints the SLICE at its own
  // scroll position, so a bubble high in the thread is a different colour from
  // one lower down and the colour shifts as you scroll. The doc calls this "the
  // single most recognisable detail of a Telegram chat theme", and the thing
  // that gets missed if you copy "gradient bubbles" literally by putting a
  // gradient on each bubble.
  //
  // `background-attachment: fixed` buys it for ONE property: the gradient is
  // laid out against the viewport rather than the element, so every bubble
  // samples whatever slice it happens to sit over.
  //
  // ⚠ WebKit treats `fixed` as `scroll`, so on iOS the gradient is per-bubble.
  // That is a graceful degradation to the obvious behaviour, not a bug to chase,
  // and it is why the gradient still reads correctly on its own.
  // Built in chatThemes.js, not here, so the doc-12 §8 rules (no
  // backdrop-filter, opacity never below the floor) can actually be ASSERTED by
  // scripts/chat-contrast-check.mjs. See the comment on chatBubbleStyles.
  const { out: outBubbleStyle, in: inBubbleStyle } = chatBubbleStyles(bubble);
  // ⚠ A noBubble MESSAGE STILL NEEDS THE THEME VARS. Media, location and file
  // cards render with no bubble chrome, so they used to get   // and therefore none of the custom properties. Their icons then fell back to
  // the global brand violet, which is why a live probe kept finding violet
  // inside a Dracula thread no matter how many call sites were fixed. The
  // scoped CSS rule in surface.css was correct all along; the variable simply
  // was not there to read.
  const bubbleVarsOnly = chatBubbleVars(bubble) || undefined;

  // The wallpaper is suppressed while a theme is on. It is NOT removed: clear
  // the theme and the user's chosen wallpaper is exactly as it was.
  const bgStyle = chatTheme
    ? { backgroundColor: isLightApp ? '#FFFFFF' : '#000000' }
    : getChatBgStyle(chatInfo?.chatBackground, chatInfo?.chatBackgroundImage, { isDesktop });

  // Preload the chosen background as soon as we know it. Browser puts it in
  // the HTTP cache so the actual background-image paint is instant.
  useEffect(() => {
    preloadBackground(chatInfo?.chatBackground, chatInfo?.chatBackgroundImage, { isDesktop });
  }, [chatInfo?.chatBackground, chatInfo?.chatBackgroundImage, isDesktop]);

  // Build the unreadCount.<recipientId>: increment(1) updates for everyone in
  // the conversation other than the sender. The sender's own counter is
  // never bumped — it gets reset to 0 when they open the thread.
  const buildUnreadIncrements = () => {
    const updates = {};
    const me = auth.currentUser?.uid;
    const participants = chatInfo?.participants || [];
    for (const pid of participants) {
      if (pid && pid !== me) updates[`unreadCount.${pid}`] = increment(1);
    }
    return updates;
  };

  const sendMsg = async (payload) => {
    markOwnSend(); // sending always rides the view to the bottom
    const replyPayload = replyTo ? { id: replyTo.id, text: (replyTo.text || '').slice(0, 100), senderName: replyTo.senderName || 'User', senderId: replyTo.senderId } : null;

    // RELAY PATH (no Firestore message bodies). The hook owns optimistic state.
    if (relayEnabled) {
      try {
        await hookSend({
          text: payload.text || '',
          type: payload.type || 'text',
          contentUrl: payload.contentUrl || '',
          videoUrl: payload.videoUrl || '',
          fileName: payload.fileName || '',
          fileSize: payload.fileSize || 0,
          // Structured payloads for card bubbles (location pin, coin transfer,
          // contact). This wrapper used to forward only the fields above, so a
          // location/wallet object was dropped here before it ever reached the
          // relay hook — the amount/coordinates never arrived and the bubble
          // fell back to a plain line of text.
          ...(payload.location ? { location: payload.location } : {}),
          ...(payload.wallet ? { wallet: payload.wallet } : {}),
          ...(payload.contact ? { contact: payload.contact } : {}),
          replyTo: replyPayload || null,
          replyToId: replyPayload?.id || '',
        });
      } catch (err) { console.error('Relay send failed:', err); }
      setReplyTo(null);
      clearTyping();
      return;
    }

    // LEGACY PATH (Firestore via relayMessage Cloud Function).
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const clientId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fullPayload = { ...payload, clientId, ...(replyPayload ? { replyTo: replyPayload } : {}) };

    setOptimisticMsgs(prev => [...prev, { id: tempId, _clientId: clientId, senderId: auth.currentUser.uid, createdAt: Timestamp.now(), _status: 'sending', ...fullPayload }]);

    try {
      const relay = httpsCallable(functions, 'relayMessage');
      await relay({ chatId, ...fullPayload });
      setOptimisticMsgs(prev => prev.filter(m => m.id !== tempId));
    } catch (err) {
      if (isOfflineError(err)) {
        await enqueueMessage(chatId, fullPayload);
        setOptimisticMsgs(prev => prev.map(m => m.id === tempId ? { ...m, _status: 'queued' } : m));
        processQueue().catch(() => {});
      } else {
        console.error('Send failed:', err);
        setOptimisticMsgs(prev => prev.map(m => m.id === tempId ? { ...m, _status: 'failed' } : m));
      }
    }
    setReplyTo(null);
    clearTyping();
  };

  const handleDelete = async (msg) => {
    if (!msg || msg.senderId !== auth.currentUser?.uid) return;
    closeContextMenu();
    const root = document.getElementById(`msg-${msg.id}`);
    const bubble = root?.querySelector('[data-msg-bubble]') || root;

    // 1. Disintegrate the bubble. The bubble is hidden but its ROW slot stays
    //    reserved, so the dust drifts over empty space (not over the message
    //    below, which would look cheap). If the raster path can't run (some
    //    WebViews), fall back to a smooth CSS crumble so native never blips.
    if (bubble) {
      try {
        const ok = await dissolveElement(bubble);
        if (!ok) await cssShatterFallback(bubble);
      } catch (err) {
        console.error('Dissolve failed:', err);
        try { await cssShatterFallback(bubble); } catch { /* ignore */ }
      }
    }

    // 2. Let the dust drift clear of the slot, then collapse the row height
    //    smoothly so the gap closes gracefully (Telegram) instead of the
    //    message below snapping up under the still-drifting dust.
    if (root) {
      await new Promise((r) => setTimeout(r, 260));
      try {
        root.style.overflow = 'hidden';
        root.style.height = `${root.offsetHeight}px`;
        root.getBoundingClientRect(); // reflow so the transition takes
        root.style.transition = 'height 200ms ease, opacity 200ms ease, margin 200ms ease';
        root.style.height = '0px';
        root.style.opacity = '0';
        root.style.marginTop = '0px';
        root.style.marginBottom = '0px';
        await new Promise((r) => setTimeout(r, 200));
      } catch { /* ignore */ }
    }

    // Optimistic / queued message? Just drop it locally — no Firestore doc.
    if (msg.id?.startsWith('temp-') || msg._status === 'queued' || msg._status === 'sending' || msg._status === 'failed') {
      setOptimisticMsgs(prev => prev.filter(m => m.id !== msg.id));
      return;
    }

    // Yank it from local state+cache so the UI collapses with no refresh.
    // onSnapshot's 'removed' event won't fire for messages older than the
    // sync cutoff, so we can't rely on it.
    removeLocalMessage?.(msg.id);

    if (relayEnabled) {
      // Delete-for-everyone on the relay path = a content-free tombstone in
      // the ops doc. Every device's subscription (online or not at the time)
      // removes the message from its local cache. No Firestore message docs
      // exist to delete.
      try { await tombstoneMessage(chatId, msg.id); }
      catch (err) { console.error('Tombstone failed:', err); }
      // Deleted message must stop lingering as the inbox preview under the name.
      syncPreviewToLatest?.();
      return;
    }

    try {
      const deleteFn = httpsCallable(functions, 'deleteMessage');
      await deleteFn({ chatId, messageId: msg.id });
    } catch (err) {
      console.error('Relay delete failed, falling back to direct delete:', err);
      try { await deleteDoc(doc(db, 'conversations', chatId, 'messages', msg.id)); }
      catch (err2) { console.error('Direct delete also failed:', err2); }
    }
  };

  const handleTextSend = async () => {
    if (!input.trim()) return;
    if (editingMsg) {
      try {
        if (relayEnabled) {
          // Relay path: patch local + Dexie, fan out an 'edit' op frame.
          await relayEditMessage?.(editingMsg.id, input.trim());
        } else {
          await updateDoc(doc(db, 'conversations', chatId, 'messages', editingMsg.id), { text: input.trim(), editedAt: serverTimestamp() });
        }
      } catch (err) { console.error('Edit failed:', err); }
      setEditingMsg(null); setInput('');
      if (inputRef.current) inputRef.current.style.height = '44px';
      return;
    }
    sendMsg({ text: input.trim(), type: 'text' });
    setInput('');
    clearDraft(chatId);
    if (inputRef.current) inputRef.current.style.height = '44px';
    inputRef.current?.focus();
  };

  // One gate in front of every path that can attach media — file picker, in-app
  // gallery grid, GIF/sticker/clip pickers. The relay refuses all of them
  // identically, so letting any one through would produce a failed bubble with
  // no explanation. Returns true when the send should be abandoned.
  const blockStrangerMedia = () => {
    if (!strangerMediaBlocked) return false;
    setShowMedia(null);
    setShowAttachmentMenu(false);
    setShowStrangerNote(true);
    return true;
  };

  const handleMediaSelect = (type, url, item) => {
    if (blockStrangerMedia()) return;
    if (type === 'gifs') sendMsg({ type: 'giphy', contentUrl: url });
    else if (type === 'stickers') sendMsg({ type: 'sticker', contentUrl: url });
    else if (type === 'clips') {
      // Klipy's mapClipResults returns a FLAT structure:
      //   { url: mp4, preview: gif, videoUrl: mp4 }  — not nested under .formats
      const videoUrl = item?.videoUrl || item?.url || '';
      const gifUrl = item?.preview || item?.url || url;
      sendMsg({ type: 'clip', contentUrl: gifUrl, videoUrl });
    }
    setShowMedia(null);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = '';
    if (blockStrangerMedia()) return;
    const sizeCheck = checkFileSize(file.size);
    if (!sizeCheck.allowed) {
      setUpgradeModal({ open: true, requiredTier: sizeCheck.requiredTier, message: sizeCheck.message });
      return;
    }
    setPreviewFile(file);
  };

  // Multi-select from the in-app gallery grid. A single pick still goes through
  // MediaPreview so the caption/edit affordances are unchanged; a batch sends
  // straight through, because there is no one caption that fits N items.
  // Oversized files are reported rather than silently dropped from the batch.
  const handlePickedMedia = async (files) => {
    if (blockStrangerMedia()) return;
    const ok = [];
    let blocked = null;
    for (const f of files) {
      const check = checkFileSize(f.size);
      if (check.allowed) ok.push(f);
      else if (!blocked) blocked = check;
    }
    if (ok.length === 1 && !blocked) { setPreviewFile(ok[0]); return; }
    for (const f of ok) {
      // Sequential: each send uploads to R2, and firing them all at once on a
      // phone connection is how you get half a batch failing.
      // eslint-disable-next-line no-await-in-loop
      await handleMediaSend(f);
    }
    if (blocked) {
      setUpgradeModal({ open: true, requiredTier: blocked.requiredTier, message: blocked.message });
    }
  };

  const handleMediaSend = async (file, caption = '', editOpts = null) => {
    setPreviewFile(null);
    markOwnSend(); // relay path calls hookSend directly, not sendMsg
    const isImage = file.type?.startsWith('image/'); const isVideo = file.type?.startsWith('video/'); const isAudio = file.type?.startsWith('audio/');
    // EVERY edit is applied HERE, behind the bubble, never on the preview
    // screen. The point of the preview is to decide and get out; nobody should
    // be pinned to a modal watching a bar while the rest of their chats wait.
    const videoOpts = isVideo ? editOpts : null;
    const uploadOpts = isImage && editOpts?.rotate ? { rotate: editOpts.rotate } : undefined;
    let folder, msgType;
    if (isImage) { folder = 'chat_images'; msgType = 'image'; } else if (isVideo) { folder = 'chat_videos'; msgType = 'video'; } else if (isAudio) { folder = 'voice_notes'; msgType = 'audio'; } else { folder = 'chat_files'; msgType = 'file'; }

    // RELAY PATH — upload to R2 then announce the URL via WS. Conversation
    // metadata is bumped but the message body is never written to Firestore.
    if (relayEnabled) {
      // Render it IMMEDIATELY from the local file, then upload behind it.
      //
      // This path used to await the compress + R2 upload BEFORE anything
      // appeared, so sending a photo looked like nothing had happened for as
      // long as the upload took — seconds on a phone connection, with no bubble,
      // no spinner and no indication the tap had registered. The legacy path
      // below always did the optimistic insert correctly; the relay path, which
      // is the one actually live (`chatRelayEnabled`), never did. Same reasoning
      // as the video-message send further down: it is instant messaging, the
      // sender should not be left wondering whether it worked.
      const tempId = `temp-${Date.now()}`;
      const localUrl = URL.createObjectURL(file);
      setOptimisticMsgs(prev => [...prev, {
        id: tempId,
        senderId: auth.currentUser.uid,
        createdAt: Timestamp.now(),
        type: msgType,
        contentUrl: localUrl,
        text: caption || '',
        fileName: file.name,
        fileSize: file.size,
        _status: 'sending',
        // A cut or a mute is a sample copy, not an encode — calling it
        // "Compressing" would name the wrong operation and set the wrong
        // expectation about how long it takes.
        _phase: videoOpts ? (videoOpts.remuxOnly ? 'trimming' : 'encoding') : 'uploading',
      }]);
      try {
        // Feed real byte progress onto the bubble that is already on screen, so
        // the sender watches it move instead of guessing whether it is stuck.
        const onUp = (pct, sent, total) => {
          setOptimisticMsgs(prev => prev.map(m => (
            m.id === tempId
              ? { ...m, _phase: 'uploading', _progress: pct, _sent: sent, _total: total ?? m._total }
              : m
          )));
        };

        // The sender picked a smaller size on the preview screen. Re-encode
        // HERE rather than there, so they are back in the conversation while it
        // happens instead of pinned to a modal watching a bar.
        let outFile = file;
        if (videoOpts) {
          const editPhase = videoOpts.remuxOnly ? 'trimming' : 'encoding';
          outFile = await compressVideo(file, tier, (p) => {
            setOptimisticMsgs(prev => prev.map(m => (
              m.id === tempId ? { ...m, _phase: editPhase, _progress: Math.round((p || 0) * 100) } : m
            )));
          }, 'clip', videoOpts);
        } else if (isVideo) {
          // No quality change asked for, so the file goes as-is — but still move
          // its index to the front. Camera MP4s carry it at the END, which costs
          // the recipient a round trip before the first frame and gets worse the
          // longer the video is. Structural only: no re-encode, no quality loss,
          // and DM videos stay uncompressed exactly as before.
          outFile = (await faststartOnly(file).catch(() => null)) || file;
        }

        const url = await uploadMediaFile(
          outFile, folder, tier, tierConfig.mediaRetentionDays, 'chat', onUp, uploadOpts,
        );
        await hookSend({
          type: msgType,
          contentUrl: url,
          text: caption || '',
          fileName: outFile.name || file.name,
          fileSize: outFile.size,
        });
        setOptimisticMsgs(prev => prev.filter(m => m.id !== tempId));
        // Revoke late. The real bubble renders from the CDN url, and dropping
        // the blob the instant the optimistic row goes can blank the image
        // mid-swap.
        setTimeout(() => { try { URL.revokeObjectURL(localUrl); } catch { /* ignore */ } }, 2000);
      } catch (err) {
        console.error('Relay media send failed:', err);
        // Leave it on screen marked failed rather than vanishing — a photo that
        // silently disappears reads as the app losing it.
        setOptimisticMsgs(prev => prev.map(m => m.id === tempId ? { ...m, _status: 'failed' } : m));
      }
      // If the gate turned out to be on (state arrived late, or the recipient
      // unfollowed mid-send), surface the reason next to the failed bubble.
      if (strangerMediaBlocked) setShowStrangerNote(true);
      return;
    }

    // LEGACY PATH.
    const tempId = `temp-${Date.now()}`; const localUrl = URL.createObjectURL(file);
    setOptimisticMsgs(prev => [...prev, { id: tempId, senderId: auth.currentUser.uid, createdAt: Timestamp.now(), type: msgType, contentUrl: localUrl, text: caption || file.name, _status: 'sending', fileName: file.name, fileSize: file.size }]);
    try {
      const url = await uploadMediaFile(file, folder, tier, tierConfig.mediaRetentionDays);
      await addDoc(collection(db, 'conversations', chatId, 'messages'), { senderId: auth.currentUser.uid, createdAt: serverTimestamp(), type: msgType, contentUrl: url, text: caption || (msgType === 'file' ? file.name : ''), fileName: file.name, fileSize: file.size });
      const typeLabels = { image: 'a photo', video: 'a video', audio: 'an audio file', file: 'a file' };
      await updateDoc(doc(db, 'conversations', chatId), {
        lastMessageText: caption || `Sent ${typeLabels[msgType]}`,
        lastMessageAt: serverTimestamp(),
        lastMessageSenderId: auth.currentUser.uid,
        ...buildUnreadIncrements(),
      });
      setOptimisticMsgs(prev => prev.filter(m => m.id !== tempId));
    } catch (err) { console.error('Media send failed:', err); setOptimisticMsgs(prev => prev.map(m => m.id === tempId ? { ...m, _status: 'failed' } : m)); }
  };

  // Mode-aware recording: 'mic' records an audio voice note, 'camera' records
  // a video message (front camera + mic, Telegram/IG round-message style).
  const handleRecordStart = async (kind = 'mic') => {
    // A voice note and a video message are media too — better to say so before
    // the mic opens than to let someone record and then lose it at send.
    if (blockStrangerMedia()) return;
    recordKindRef.current = kind;
    recordStartTsRef.current = Date.now();
    try {
      setIsRecording(true); setRecordingTime(0);
      isRecordingRef.current = true;
      recordLockedRef.current = false;
      setRecordLocked(false); setRecordDragX(0);
      recorderReadyRef.current = kind === 'camera' ? startVideoRecording() : startVoiceRecording();
      const r = await recorderReadyRef.current;
      recorderRef.current = r;
      // Publish the stream to state; the effect below attaches it to the
      // preview <video> once React has mounted it (avoids the null-ref race).
      if (kind === 'camera' && r?._stream) {
        setRecordStream(r._stream);
        // Fast-path attach if the element already exists this tick.
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = r._stream;
          previewVideoRef.current.play?.().catch(() => {});
        }
      }
      recordingInterval.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch (e) {
      console.error('Error starting recorder:', e);
      setIsRecording(false); recorderRef.current = null; recorderReadyRef.current = null;
      isRecordingRef.current = false;
      if (e.name === 'NotAllowedError' || e.name === 'NotFoundError') {
        alert(kind === 'camera'
          ? 'Camera & microphone access is required for video messages. Please allow permission in your settings.'
          : 'Microphone access denied. Please allow microphone permission in your settings.');
      }
    }
  };

  // Attach the live camera stream to the preview <video> once it's mounted.
  // Runs after render (unlike the inline attach in handleRecordStart, which
  // races getUserMedia against React), so the round preview reliably shows.
  useEffect(() => {
    const v = previewVideoRef.current;
    if (v && recordStream && v.srcObject !== recordStream) {
      v.srcObject = recordStream;
      v.play?.().catch(() => {});
    }
  }, [recordStream, isRecording, recordMode]);

  const handleRecordStop = async () => {
    const kind = recordKindRef.current;
    setIsRecording(false); clearInterval(recordingInterval.current);
    isRecordingRef.current = false; recordLockedRef.current = false;
    lockReleasePendingRef.current = false;
    setRecordLocked(false); setRecordDragX(0);
    setRecordStream(null);
    if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
    let rec = recorderRef.current; if (!rec && recorderReadyRef.current) { try { rec = await recorderReadyRef.current; } catch { return; } }
    recorderReadyRef.current = null; if (!rec || rec.state === 'inactive') { recorderRef.current = null; return; }
    try {
      if (kind === 'camera') {
        // Measured NOW (at stop) so upload latency never inflates the stamp.
        const durSec = Math.max(0.5, (Date.now() - recordStartTsRef.current) / 1000);
        const blob = await stopVideoRecording(rec);
        if (blob.size > 0) {
          // Use the real recorded extension so the R2 object + content-type agree
          // (Android WebViews that fall back to mp4 would otherwise mismatch).
          const ext = (blob.type || 'video/webm').includes('mp4') ? 'mp4' : 'webm';
          // INSTANT SEND: show the video note immediately from the local
          // recording (playable) with a "sending" state, then upload +
          // announce in the background. It's instant messaging — the user
          // shouldn't stare at a spinner wondering if it worked.
          const tempId = `temp-${Date.now()}`;
          const localUrl = `${URL.createObjectURL(blob)}#d=${durSec.toFixed(1)}`;
          markOwnSend(); // the optimistic bubble lands before sendMsg runs
          setOptimisticMsgs(prev => [...prev, { id: tempId, senderId: auth.currentUser.uid, createdAt: Timestamp.now(), type: 'videonote', contentUrl: localUrl, _status: 'sending' }]);
          try {
            const url = await uploadBlob(blob, 'chat_videos', ext);
            // Stamp the real recorded length as a URL fragment: MediaRecorder
            // WebM reports duration=Infinity, and a fragment survives the relay
            // (it rides inside contentUrl) without ever reaching the server.
            await sendMsg({ type: 'videonote', contentUrl: `${url}#d=${durSec.toFixed(1)}` });
            setOptimisticMsgs(prev => prev.filter(m => m.id !== tempId));
            setTimeout(() => { try { URL.revokeObjectURL(localUrl.split('#')[0]); } catch { /* ignore */ } }, 2000);
          } catch (err) {
            setOptimisticMsgs(prev => prev.filter(m => m.id !== tempId));
            try { URL.revokeObjectURL(localUrl.split('#')[0]); } catch { /* ignore */ }
            throw err; // surfaced by the outer catch's alert
          }
        } else {
          alert("Your video message didn't record any data. Please try again (hold the button a moment longer).");
        }
      } else {
        // Same #d= duration stamp as video notes: MediaRecorder audio also
        // reports duration=Infinity, which is why shared-media voice rows
        // showed "0:00/0:00".
        const voiceDur = Math.max(0.5, (Date.now() - recordStartTsRef.current) / 1000);
        const blob = await stopVoiceRecording(rec);
        if (blob.size > 0) {
          const url = await uploadBlob(blob, 'voice_notes');
          // rec._waveform = the REAL recorded amplitude bars (0-100 ints).
          sendMsg({ type: 'voice', contentUrl: `${url}#d=${voiceDur.toFixed(1)}`, ...(rec._waveform ? { waveform: rec._waveform } : {}) });
        }
      }
    } catch (err) {
      console.error('Record send error:', err);
      alert(`Couldn't send your ${kind === 'camera' ? 'video message' : 'voice note'}: ${err?.message || 'upload failed'}`);
    }
    finally { recorderRef.current = null; }
  };

  // Discard the current recording WITHOUT sending — and crucially stop the
  // mic/camera tracks so the device indicator turns off (the old cancel just
  // hid the UI and left the stream live).
  const handleRecordCancel = () => {
    setIsRecording(false); setRecordingTime(0);
    clearInterval(recordingInterval.current);
    isRecordingRef.current = false; recordLockedRef.current = false;
    lockReleasePendingRef.current = false;
    setRecordLocked(false); setRecordDragX(0);
    setRecordStream(null);
    if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
    const rec = recorderRef.current;
    try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* ignore */ }
    try { rec?._stream?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    if (recorderReadyRef.current) {
      recorderReadyRef.current.then(r => { try { r?._stream?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ } }).catch(() => {});
    }
    recorderRef.current = null; recorderReadyRef.current = null;
  };

  // 1:1 DM calls are raw WebRTC P2P (/call). A GROUP call routes through the
  // Pion SFU instead (/group-call) — a mesh would have every phone encoding one
  // stream per peer. Both ring through the same `calls` doc.
  const startCall = async (type) => {
    if (!chatInfo) return;
    // Defence in depth for the header gate above: a support thread's
    // participants are the support AGENTS' personal uids, so a call here rings
    // staff directly. Refuse at the source too, so no other entry point (or a
    // render against stale chatInfo) can start one.
    if (chatInfo.supportThread || chatInfo.isOfficial) return;
    const isGroupCall = !!chatInfo.isGroup;
    try {
      await setDoc(doc(db, 'calls', chatId), {
        callerId: auth.currentUser.uid,
        // A82: the Vergr PROFILE is the identity, not the Firebase Auth record.
        // `auth.currentUser.displayName` is whatever the auth provider last set
        // (often a single initial, or a stale Google name), and putting it first
        // is what made incoming calls ring showing a bare "V". CallsScreen has
        // always used the profile; these two are now consistent.
        callerName: profile?.displayName || profile?.username || 'Vergr user',
        callerAvatar: profile?.avatar || '',
        type,
        status: 'ringing',
        participants: chatInfo.participants,
        createdAt: serverTimestamp(),
        ...(isGroupCall ? {
          isGroup: true,
          chatId,
          groupName: chatInfo.groupName || 'Group call',
          activeUids: [],
        } : {}),
      });
      navigate(isGroupCall ? `/group-call/${chatId}` : `/call/${chatId}/${type}`);
    } catch (error) { console.error('Call init failed:', error); }
  };

  // Track the starting point of a touch so we can cancel the long-press if
  // the user drags (scroll / swipe-to-reply). Prevents accidental menu
  // pop-ups during normal scrolling.
  const longPressStart = useRef({ x: 0, y: 0, pointerId: null, el: null });
  // Set when a long-press just entered selection mode, so the synthesised
  // click that follows the finger release doesn't immediately toggle the
  // freshly-selected message back off.
  const justLongPressed = useRef(false);
  const LONG_PRESS_MS = 400;
  const LONG_PRESS_MOVE_SLOP = 10; // px — above this, we treat it as a scroll

  // Telegram model: TAP opens the message menu (reactions + actions);
  // HOLD enters multi-select (select this one, then tap others to
  // forward/reply). Long-press therefore starts selection, not the menu.
  const handleMsgLongPress = (msgId, e) => {
    if (contextMenuMsgId) return;      // a menu is open — ignore
    if (selectedIds) return;           // already selecting — taps toggle
    const x = e?.touches?.[0]?.clientX ?? e?.clientX ?? 0;
    const y = e?.touches?.[0]?.clientY ?? e?.clientY ?? 0;
    longPressStart.current = { x, y };
    clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      justLongPressed.current = true;
      setSelectedIds(new Set([msgId]));
      // Haptic tick so the user feels the selection commit.
      try { navigator.vibrate?.(15); } catch {}
    }, LONG_PRESS_MS);
  };
  const cancelLongPress = () => clearTimeout(longPressTimer.current);

  // When the menu closes, the tap that dismissed it (on the backdrop) can
  // fall through to the row underneath once the backdrop unmounts — which
  // re-opened the menu. Stamp the close time and ignore row taps briefly.
  const menuClosedAt = useRef(0);
  const closeContextMenu = useCallback(() => {
    menuClosedAt.current = Date.now();
    setContextMenuMsgId(null);
  }, []);

  // Single tap on a message → open the context menu at the tap point.
  const handleMsgTap = (m, e) => {
    if (selectedIds) return;           // selection mode: capture handler toggles
    if (contextMenuMsgId) return;      // menu already open — backdrop closes it
    if (Date.now() - menuClosedAt.current < 400) return; // just dismissed a menu
    if (m?.deleted) return;
    const x = e?.clientX ?? 0;
    const y = e?.clientY ?? 0;
    setContextMenuPos({ x, y });
    setContextMenuMsgId(m.id);
  };
  const handleLongPressMove = (e) => {
    const t = e?.touches?.[0];
    if (!t) return;
    const dx = Math.abs(t.clientX - longPressStart.current.x);
    const dy = Math.abs(t.clientY - longPressStart.current.y);
    if (dx > LONG_PRESS_MOVE_SLOP || dy > LONG_PRESS_MOVE_SLOP) cancelLongPress();
  };

  const handleSwipeStart = (e, msg) => {
    const touch = e.touches[0];
    swipeRef.current = { startX: touch.clientX, startY: touch.clientY, msgId: msg.id, msg, swiping: false, el: e.currentTarget };
  };
  const handleSwipeMove = (e) => {
    const sw = swipeRef.current;
    if (!sw.msgId) return;
    const touch = e.touches[0];
    const dx = touch.clientX - sw.startX;
    const dy = Math.abs(touch.clientY - sw.startY);
    if (dy > 30 && !sw.swiping) { sw.msgId = null; return; }
    if (dx > 15) {
      sw.swiping = true;
      const offset = Math.min(dx - 15, 80);
      if (sw.el) sw.el.style.transform = `translateX(${offset}px)`;
      if (sw.el) sw.el.style.transition = 'none';
    }
  };
  const handleSwipeEnd = () => {
    const sw = swipeRef.current;
    if (sw.el) { sw.el.style.transform = ''; sw.el.style.transition = 'transform 0.2s'; }
    if (sw.swiping && sw.msg) {
      const senderName = senderNameOf(sw.msg.senderId);
      setReplyTo({ id: sw.msg.id, text: sw.msg.text || 'Media', senderName, senderId: sw.msg.senderId });
      inputRef.current?.focus();
    }
    swipeRef.current = { startX: 0, startY: 0, msgId: null, swiping: false };
  };

  const handleReply = (msg) => {
    const senderName = senderNameOf(msg.senderId);
    setReplyTo({ id: msg.id, text: msg.text || (msg.type === 'image' ? '📷 Photo' : msg.type === 'voice' ? '🎤 Voice' : msg.type === 'videonote' ? '🎥 Video message' : msg.type === 'video' ? '🎬 Video' : msg.type === 'sticker' ? msg.stickerLabel || '🎯 Sticker' : 'Media'), senderName, senderId: msg.senderId });
    setEditingMsg(null); inputRef.current?.focus();
  };
  const handleEdit = (msg) => {
    if (msg.senderId !== auth.currentUser?.uid) return;
    if (!msg.text) return; // Can only edit messages that have text
    setEditingMsg({ id: msg.id, text: msg.text }); setInput(msg.text || ''); setReplyTo(null); setContextMenuMsgId(null); inputRef.current?.focus();
  };
  const handlePin = async (msg) => {
    if (!groupAllows(chatInfo, 'pin', auth.currentUser?.uid)) {
      showToast('Only admins can pin messages in this group', 'info');
      return;
    }
    try {
      const isPinned = chatInfo?.pinnedMessage?.id === msg.id;
      await updateDoc(doc(db, 'conversations', chatId), { pinnedMessage: isPinned ? null : { id: msg.id, text: (msg.text || '').slice(0, 100), senderId: msg.senderId } });
    } catch (err) { console.error('Pin error:', err); }
  };

  const handleInputChange = (e) => { setInput(e.target.value); setTyping(); };

  // Attachment menu handlers
  const handleCamera = () => {
    document.getElementById(`camera-up-${chatId}`).click();
  };

  const handleMusic = () => {
    document.getElementById(`music-up-${chatId}`).click();
  };

  // Play requires a prominent disclosure before the location permission
  // prompt. Shown once per device — after the OS grant there is no further
  // request to disclose, and re-asking every time would just train people to
  // dismiss it.
  const LOCATION_ACK_KEY = "vergr.locationDisclosureAck";
  const openLocationMenu = () => setShowLocationSubMenu(true);
  const handleLocation = () => {
    let acked = false;
    try { acked = localStorage.getItem(LOCATION_ACK_KEY) === "1"; } catch { /* private mode */ }
    if (acked) { openLocationMenu(); return; }
    setLocationAsk(true);
  };

  const handleCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        // Turn the raw pair into a human address (free, key-less). Showing
        // "40.758, -73.9855" as a shared location is unreadable; a place name
        // is what every messenger shows. Falls back to the pair if offline.
        const { title, subtitle } = await reverseGeocode(latitude, longitude);
        sendMsg({
          type: 'location',
          text: title, // inbox-preview + fallback label
          location: { lat: latitude, lng: longitude, title, subtitle, type: 'current' },
          // The relay server strips the `location` object; contentUrl survives,
          // so coords + address ride there and the recipient reconstructs them.
          contentUrl: geoContentUrl(latitude, longitude, title, subtitle),
        });
      },
      (error) => {
        console.error('Geolocation error:', error);
        alert('Unable to get location. Please check permissions.');
      }
    );
  };

  const handleChooseOnMap = () => {
    setShowLocationPicker(true);
  };

  const handleLocationConfirm = (coords, addr) => {
    const title = addr?.title || addr?.address || (typeof addr === 'string' ? addr : `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`);
    const subtitle = addr?.subtitle || '';
    sendMsg({
      type: 'location',
      text: title, // inbox-preview + fallback label
      location: { lat: coords.lat, lng: coords.lng, title, subtitle, type: 'pinned' },
      contentUrl: geoContentUrl(coords.lat, coords.lng, title, subtitle),
    });
  };

  const handleContact = () => {
    setShowContactSubMenu(true);
  };

  // Proper user-picker sheet (the old flow was a bare prompt()).
  const [showUserPicker, setShowUserPicker] = useState(false);
  const handleShareVergrUser = () => setShowUserPicker(true);

  const handleUserPicked = (u) => {
    setShowUserPicker(false);
    if (!u?.username && !u?.displayName) return;
    sendMsg({
      type: 'contact',
      text: `👤 Contact: @${u.username || u.displayName}`,
      contact: { type: 'vergr', username: u.username || '', uid: u.id, name: u.displayName || u.username || '' },
    });
  };

  const handleSharePhoneContact = async () => {
    if (!('contacts' in navigator)) {
      // Fallback: manual input
      const name = prompt('Enter contact name:');
      const phone = prompt('Enter phone number:');
      if (name && phone) {
        sendMsg({
          type: 'contact',
          text: `📞 ${name}: ${phone}`,
          contact: { type: 'phone', name, phone },
        });
      }
      return;
    }
    try {
      const contacts = await navigator.contacts.select(['name', 'tel'], { multiple: false });
      if (contacts.length) {
        const contact = contacts[0];
        sendMsg({
          type: 'contact',
          text: `📞 ${contact.name[0]}: ${contact.tel[0]}`,
          contact: { type: 'phone', name: contact.name[0], phone: contact.tel[0] },
        });
      }
    } catch (err) {
      console.error('Contact picker error:', err);
      alert('Could not select contact');
    }
  };

  const handleWallet = () => {
    if (!otherUser) {
      alert('Cannot send coins – user not found');
      return;
    }
    setShowSendCoinsModal(true);
  };

  // Ticketed-event share — pick one of my events, send it as an interactive
  // ticket card message. Denormalize display fields so the card renders
  // without a fetch; live price/sold/status refresh from getEventTicketStatus.
  // ── Locked media ─────────────────────────────────────────────────────────
  //
  // Two steps, because the price has to be known BEFORE the upload: the object
  // goes to a private prefix and the callable that files its key is the same one
  // that writes the price, so there is no "upload now, decide later".
  const [lockedFiles, setLockedFiles] = useState([]);
  const [lockedSheet, setLockedSheet] = useState(false);
  const [packsSheet, setPacksSheet] = useState(false);
  const lockedInputRef = useRef(null);

  // The lock button opens the SAVED PACKS first. A creator with packs almost
  // always wants one of them, and its empty state is how anybody discovers the
  // feature exists at all; "New pack" from there falls through to the picker.
  const handleLocked = () => setPacksSheet(true);
  const pickLockedFiles = () => lockedInputRef.current?.click();

  // Object URLs for the sheet's media strip. Built in an effect, not in render,
  // because createObjectURL in a render body leaks a new URL on every pass and
  // the thumbnail flickers without ever settling.
  const [lockedThumbs, setLockedThumbs] = useState([]);
  useEffect(() => {
    const urls = lockedFiles.map((f) => ({
      id: `${f.name}:${f.size}:${f.lastModified}`,
      url: URL.createObjectURL(f),
      isVideo: (f.type || '').startsWith('video/'),
    }));
    setLockedThumbs(urls);
    return () => urls.forEach((u) => { try { URL.revokeObjectURL(u.url); } catch {} });
  }, [lockedFiles]);

  // MULTI-SELECT. A locked send can carry a set ("3 PICS") bought once, so the
  // picker takes several files and adds to whatever is already staged rather
  // than replacing it — that is what makes the sheet's "+" tile work.
  const onLockedFilePicked = (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (!picked.length) return;
    setLockedFiles((prev) => [...prev, ...picked].slice(0, MAX_LOCKED_ITEMS));
    setLockedSheet(true);
  };

  const sendLocked = async ({ priceCoins, saveAsPack, packTitle }) => {
    const files = lockedFiles;
    if (!files.length) return;
    setLockedSheet(false);
    setLockedFiles([]);
    try {
      // Uploaded in order, so the first file picked is the cover the bubble
      // draws. Sequential rather than parallel: a set of five videos uploading
      // at once on a phone connection is how you get five timeouts.
      const items = [];
      for (const file of files) {
        items.push(await uploadLockedItem({ chatId, scope: 'conversation', file }));
      }
      const cover = items[0];

      // Saving the set for reuse is a side effect of this send, not a
      // precondition of it: if the pack write fails the message still goes, so
      // a bookkeeping error never costs the creator the sale.
      if (saveAsPack && packTitle) {
        createMediaPack({ title: packTitle, priceCoins, items })
          .catch(() => alert('Sent, but the pack could not be saved for reuse.'));
      }

      // ONE id, named by us, used by both halves.
      //
      // The chat list on the relay path is built from relay FRAMES and never
      // reads message docs from Firestore, so a callable that only wrote to
      // Firestore produced a message nobody could see. The callable files the
      // price and the private object keys against this id; the frame below is
      // what actually appears in the conversation.
      const messageId = `lk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const previewUrl = cover.previewUrl;
      await sendLockedMessage({
        chatId, scope: 'conversation', messageId, priceCoins, caption: '', items,
      });
      // The blurred preview is a deliberately public object, so it is safe on
      // the wire. The real bytes are not on it, and never leave R2 unsigned.
      // RELAY PATH ONLY.
      //
      // The callable above already wrote the message document. On the legacy
      // (Firestore) chat path that document IS the message, and sending a frame
      // too would post a second, duplicate row via relayMessage. On the relay
      // path the list is built from frames and never reads that document, so
      // the frame is the only thing that appears.
      //
      // mediaKind is set EXPLICITLY: the frame builder otherwise derives it from
      // contentUrl, and a locked video has no preview to put there, so the
      // message would arrive typed as plain text and render as an empty bubble.
      if (relayEnabled) {
        await hookSend({ id: messageId, type: 'locked', mediaKind: 'locked', contentUrl: previewUrl || '' });
      }
    } catch (err) {
      alert(err?.message || 'Could not send locked media.');
    }
  };

  // ── 1:1 session ──────────────────────────────────────────────────────────
  //
  // A 1:1 is an UNLISTED stream, not a new subsystem. That gets the whole
  // existing pipeline for free (ingest, playback, chat, tips, gifts) and means
  // "free or paid" is the same `access` block every other paid stream uses.
  // Unlisted keeps it out of every discovery query, so the link is the only way
  // in, which is the Tango model the founder asked for.
  const [oneToOneSheet, setOneToOneSheet] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  // A report aimed at ONE message rather than the whole conversation. Set from
  // the locked-media bubble, which is the priced surface a buyer needs to be
  // able to escalate.
  const [reportTarget, setReportTarget] = useState(null);
  const handleOneToOne = () => setOneToOneSheet(true);

  /**
   * Start a 1:1 session in this conversation, optionally paid.
   *
   * A 1:1 IS A PRIVATE ONE-WAY BROADCAST, NOT A TWO-WAY CALL.
   *
   * This was built as a video call once and reverted. The model being copied is
   * Tango's: the host goes live to an audience of one (or, in a group, to the
   * people in that group), and the guest watches, chats and tips. It is not a
   * conversation with two cameras, so it rides the streaming pipeline and gets
   * ingest, playback, chat, tips and gifts for free.
   *
   * What makes it private is not obscurity. The server forces it unlisted, caps
   * it at one concurrent viewer, stamps `sessionType` so moderation can tell it
   * from a broadcast, withholds the playback URL from the world-readable stream
   * document, and admits only the uids named below.
   */
  const startOneToOne = async ({ isPaid, priceCoins }) => {
    setOneToOneSheet(false);
    try {
      const { httpsCallable: hc } = await import('firebase/functions');
      const { functions: fns } = await import('../../firebase/config');
      const res = await hc(fns, 'createStreamSession')({
        kind: 'public',
        mode: 'browser',
        title: '1:1 session',
        audience: 'unlisted',
        // Server-side this forces unlisted, caps concurrent viewers, and stamps
        // sessionType. Client-side, streamVisibility.js keeps it out of every
        // discovery surface — Explore, Shorts, rails and the avatar LIVE ring
        // all read those flags now, which they did not before.
        sessionType: 'one_to_one',
        // THE GUEST LIST. Everyone in this conversation, and nobody else.
        //
        // Unlisted only removes the session from discovery; the stream document
        // is world-readable, so without this a forwarded id was a forwarded
        // session. getAccess checks this list before it will mint a playback
        // URL, including when the session is free.
        inviteUids: (chatInfo?.participants || []).filter(Boolean),
        access: isPaid ? { mode: 'paid', priceCoins } : { mode: 'free' },
      });
      const streamId = res.data?.streamId;
      if (!streamId) throw new Error('Could not start the session.');

      // A JOIN CARD, not a link.
      //
      // This used to drop a bare /watch URL into the chat as plain text, which
      // on the relay path rendered as an unclickable line and gave the other
      // person nothing to press. It now rides the wire as its own message type
      // with the stream id in contentUrl, and renders as a card with a Join
      // button (see the 'onetoone' case in the message renderer).
      await hookSend({
        type: 'onetoone',
        mediaKind: 'onetoone',
        contentUrl: streamId,
        text: isPaid ? String(Math.floor(priceCoins)) : '0',
      });

      navigate(`/broadcast/${streamId}`);
    } catch (err) {
      alert(err?.message || 'Could not start the 1:1.');
    }
  };

  const handleSendTicket = () => setShowEventPicker(true);
  const handleEventSelected = (t) => {
    setShowEventPicker(false);
    // The relay only persists a fixed field set, so the event id rides in
    // `contentUrl` (survives reload). The chat card fetches live price/sold/
    // status + name/banner by id. `eventTicket` is a best-effort optimistic
    // hint for the sender's immediate render before the card self-fetches.
    sendMsg({
      type: 'event_ticket',
      text: `🎟 ${t.name}`,
      contentUrl: t.id,
      eventTicket: {
        tournamentId: t.id,
        name: t.name,
        game: t.game || '',
        bannerUrl: t.bannerUrl || null,
        priceCoins: t.ticket?.priceCoins || 0,
        capacity: t.ticket?.capacity || 0,
        sold: t.ticket?.sold || 0,
      },
    });
  };

  // Poll: create the chat_polls doc, then send a message whose contentUrl is
  // the poll id (the relay strips nested fields; ChatPollBubble self-fetches).
  const handleCreatePoll = async ({ question, options, multi }) => {
    const { createChatPoll } = await import('../../firebase/firestore');
    const pollId = await createChatPoll({ scope: 'dm', convId: chatId, question, options, multi });
    await sendMsg({ type: 'poll', text: `📊 ${question}`, contentUrl: pollId });
  };

  const renderMessageContent = (m, isMe) => {
    const time = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const timeEl = <InlineTime time={time} isMe={isMe} read={m.read} status={m._status} edited={!!m.editedAt} />;

    // Telegram-style: deleted messages render nothing (they're already filtered
    // out of displayMessages; this is defense-in-depth). No WhatsApp-style
    // "This message was deleted" placeholder.
    if (m.deleted) return null;

    const forwardedLabel = m.forwarded ? (<p className={`px-4 pt-2 text-[10px] font-bold ${isMe ? 'text-white/40' : 'text-brand-violet-light/60'}`}><Icon name="shortcut" size={12} className="inline mr-1" />Forwarded</p>) : null;
    const ytId = m.type === 'text' ? getYouTubeID(m.text) : null;

    if (ytId) {
      return (<div className="flex flex-col">{forwardedLabel}<QuotedReply replyTo={m.replyTo} isMe={isMe} /><p className="px-4 py-2.5 text-sm break-words">{m.text}{timeEl}</p><div className="relative aspect-video"><iframe src={`https://www.youtube.com/embed/${ytId}`} className="w-full h-full" allowFullScreen title="YT" /></div></div>);
    }

    switch (m.type) {
      // An invitation to a private 1:1 session. A card with a button, because a
      // URL in a text bubble is not something anyone can reliably press.
      case 'onetoone': {
        const oneToOneId = m.contentUrl;
        const priceC = Math.floor(Number(m.text) || 0);
        // The card tracks the session's real state (starting / live / ended)
        // rather than always offering a Join button that may lead nowhere.
        return (
          <div className="flex flex-col">
            <OneToOneCard
              streamId={oneToOneId}
              priceCoins={priceC}
              isMe={isMe}
              hostName={isMe ? (profile?.displayName || profile?.username) : resolveReactor(m.senderId).displayName}
              hostAvatar={isMe ? (profile?.avatar || profile?.photoURL) : resolveReactor(m.senderId).avatar}
            />
            <span className="px-2 pb-1.5 flex justify-end items-center gap-1">
              <span className="text-[9px] text-white/55">{time}</span>
              {isMe && <Ticks read={m.read} />}
            </span>
          </div>
        );
      }

      // Priced media. The bytes are on a private R2 prefix and this message
      // carries no contentUrl at all, so there is nothing here to accidentally
      // render: LockedMedia asks the server whether this viewer has paid and
      // only then receives a five-minute signed URL.
      case 'locked':
        return (
          <div className="flex flex-col">
            {forwardedLabel}<QuotedReply replyTo={m.replyTo} isMe={isMe} />
            <div className="p-1.5 w-[240px] max-w-full">
              <LockedMedia
                resourceType="message"
                resourceId={`${chatId}:${m.id}`}
                locked={m.locked}
                previewUrl={m.contentUrl || null}
                compact
              />
            </div>
            {m.text && <p className="px-4 pb-1 text-sm break-words">{m.text}</p>}
            <span className="px-4 pb-2 flex justify-end items-center gap-2">
              {/* Sold media in a room nobody else can see. This is the only
                  route from here to a human, so it sits on the bubble itself
                  rather than behind a long-press people will not find. */}
              {!isMe && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setReportTarget({ chatId, messageId: m.id });
                  }}
                  className="text-[10px] text-white/45 hover:text-brand-ember transition flex items-center gap-0.5"
                >
                  <Icon name="flag" size={12} />
                  Report
                </button>
              )}
              <span className="text-[9px] text-white/60">{time}</span>
              {isMe && <Ticks read={m.read} />}
            </span>
          </div>
        );

      case 'sticker':
        return (
          <div className="relative inline-block">
            {forwardedLabel}<QuotedReply replyTo={m.replyTo} isMe={isMe} />
            {m.contentUrl ? (
              <img src={m.contentUrl} alt="Sticker" className="w-36 h-36 object-contain drop-shadow-md" loading="lazy" style={{ background: 'transparent' }} />
            ) : (
              <span className="text-6xl leading-none">{m.text}</span>
            )}
            <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-full bg-black/40 backdrop-blur-sm flex items-center gap-1">
              <span className="text-[9px] text-white/80 font-medium">{time}</span>
              {isMe && <Ticks read={m.read} />}
            </span>
          </div>
        );

      case 'clip':
        return (
          <div className="relative">
            {forwardedLabel}<QuotedReply replyTo={m.replyTo} isMe={isMe} />
            {m.videoUrl ? (
              <ClipMessagePlayer src={m.videoUrl} poster={m.contentUrl} onExpand={() => openLightbox(m.id)} />
            ) : (
              <img src={m.contentUrl} alt="Clip" className="w-full max-h-64 object-cover rounded-sm" loading="lazy" />
            )}
            <span className={`absolute bottom-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${isMe ? 'bg-bg-dark/50 text-white' : 'bg-black/50 text-white'}`}>{time}{isMe && <Ticks read={m.read} />}</span>
          </div>
        );

      case 'meme':
        return (
          <div className="relative">
            {forwardedLabel}<QuotedReply replyTo={m.replyTo} isMe={isMe} />
            <CachedImg src={m.contentUrl} policyGated className="w-full rounded-sm cursor-pointer" alt="Meme" loading="lazy" onClick={(e) => { e.stopPropagation(); openLightbox(m.id); }} />
            <span className={`absolute bottom-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${isMe ? 'bg-bg-dark/50 text-white' : 'bg-black/50 text-white'}`}>{time}{isMe && <Ticks read={m.read} />}</span>
          </div>
        );

      case 'giphy':
        return (<div className="relative">{forwardedLabel}<QuotedReply replyTo={m.replyTo} isMe={isMe} /><img src={m.contentUrl} className="w-full rounded-sm cursor-pointer" alt="GIF" loading="lazy" onClick={(e) => { e.stopPropagation(); openLightbox(m.id); }} /><span className={`absolute bottom-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${isMe ? 'bg-bg-dark/50 text-white' : 'bg-black/50 text-white'}`}>{time}{isMe && <Ticks read={m.read} />}</span></div>);

      case 'image':
        return (<div className="relative">{forwardedLabel}<QuotedReply replyTo={m.replyTo} isMe={isMe} /><CachedImg src={m.contentUrl} policyGated className="w-full max-h-80 object-cover cursor-pointer" alt="" loading="lazy" onClick={(e) => { e.stopPropagation(); openLightbox(m.id); }} /><SendProgress msg={m} />{m.text && m.text !== m.fileName && <p className="px-4 py-2 text-sm break-words">{m.text}</p>}<span className={`absolute bottom-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${isMe ? 'bg-bg-dark/50 text-white' : 'bg-black/50 text-white'}`}>{time}{isMe && <Ticks read={m.read} />}</span></div>);

      case 'videonote':
        return (<div className="flex flex-col items-center">{forwardedLabel}<QuotedReply replyTo={m.replyTo} isMe={isMe} /><RoundVideoMessage src={m.contentUrl} /><span className={`mt-0.5 text-[10px] ${isMe ? 'text-white/50' : 'text-text-muted'}`}>{time}{isMe && <Ticks read={m.read} className="ml-1 relative top-[1px]" />}</span></div>);

      case 'video':
        return (<div className="relative">{forwardedLabel}<QuotedReply replyTo={m.replyTo} isMe={isMe} /><ClipMessagePlayer src={m.contentUrl} poster={m.posterUrl || m.thumbnailUrl} onExpand={() => openLightbox(m.id)} /><SendProgress msg={m} />{m.text && m.text !== m.fileName && <p className="px-4 py-2 text-sm break-words">{m.text}{timeEl}</p>}</div>);

      case 'voice':
        return (<div>{forwardedLabel}<QuotedReply replyTo={m.replyTo} isMe={isMe} /><AudioPlayer url={m.contentUrl} isMe={isMe} waveform={m.waveform} /></div>);

      case 'audio':
        return (<div>{forwardedLabel}<QuotedReply replyTo={m.replyTo} isMe={isMe} /><AudioPlayer url={m.contentUrl} isMe={isMe} label={m.fileName} /></div>);

      case 'file':
        return (
          <div>{forwardedLabel}<QuotedReply replyTo={m.replyTo} isMe={isMe} />
          <a href={m.contentUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="flex items-center gap-3 px-4 py-3 hover:opacity-80 transition-opacity min-w-[200px]">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: isMe ? 'rgba(255,255,255,0.15)' : 'var(--vg-chat-accent-12, rgba(123,31,255,0.10))' }}>
              <Icon name="description" size={20}
                className={isMe ? 'text-white/70' : ''}
                style={isMe ? undefined : { color: 'var(--vg-chat-accent, #B44FFF)' }} />
            </div>
            <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{m.fileName || m.text || 'File'}</p>{m.fileSize && <p className={`text-[10px] ${isMe ? 'text-white/50' : 'text-text-muted'}`}>{m.fileSize < 1048576 ? `${(m.fileSize / 1024).toFixed(1)} KB` : `${(m.fileSize / 1048576).toFixed(1)} MB`}</p>}</div>
            <Icon name="download" size={18} className={isMe ? 'text-white/40' : 'text-text-muted'} />
          </a></div>
        );

      case 'location': {
        // Sender holds the full `location` object; the RECIPIENT gets only the
        // relay-forwarded fields, so lat/lng + address ride `contentUrl` as
        // geo:lat,lng|title|subtitle and are parsed back here.
        const geo = m.location || parseGeo(m.contentUrl) || {};
        const lat = geo.lat, lng = geo.lng;
        const title = m.location?.title || geo.title || m.text;
        const subtitle = m.location?.subtitle || geo.subtitle || '';
        // Truly legacy rows (no coords anywhere) show their text, not a broken card.
        if (lat == null || lng == null) {
          return (
            <div>
              {forwardedLabel}
              <QuotedReply replyTo={m.replyTo} isMe={isMe} />
              <div className="px-4 py-2.5 flex items-center gap-2">
                <Icon name="location_on" size={20} style={{ color: 'var(--vg-chat-accent, #B44FFF)' }} />
                <span className="text-sm">{m.text || 'Shared a location'}</span>
              </div>
              {timeEl}
            </div>
          );
        }
        return <LocationBubble lat={lat} lng={lng} title={title} subtitle={subtitle} isMe={isMe} timeStr={time} read={isMe} />;
      }

      case 'contact':
        const { type, username, name, phone } = m.contact || {};
        return (
          <div>
            {forwardedLabel}
            <QuotedReply replyTo={m.replyTo} isMe={isMe} />
            <div className="px-4 py-2.5 flex items-center gap-2">
              <Icon name="contact_mail" size={20} style={{ color: 'var(--vg-chat-accent, #B44FFF)' }} />
              <span className="text-sm">
                {type === 'vergr' ? `👤 @${username}` : `📞 ${name}: ${phone}`}
              </span>
            </div>
            {timeEl}
          </div>
        );

      case 'wallet': {
        // Amount + optional note ride `contentUrl` (vergrcoin:amount:note) since
        // the relay strips the structured object; `text` ("Sent N coins") is the
        // preview + a last-ditch amount fallback for legacy rows.
        const parsed = parseCoin(m.contentUrl);
        const amt = Number(
          (m.wallet && m.wallet.amount) ?? parsed?.amount ??
          (String(m.text || '').match(/([\d,]+)/)?.[1] || '0').replace(/,/g, '')
        ) || 0;
        const note = m.wallet?.note ?? parsed?.note ?? '';
        return (
          <CoinCard amount={amt} note={note} isMe={isMe} otherName={otherUser?.displayName} timeStr={time} read={isMe} />
        );
      }

      case 'poll':
        return (
          <div>
            {forwardedLabel}
            <QuotedReply replyTo={m.replyTo} isMe={isMe} />
            {/* Voting must not also open the row's reaction menu. */}
            <div onClick={(e) => e.stopPropagation()}>
              <ChatPollBubble pollId={m.contentUrl} isMe={isMe} />
            </div>
            <div className="px-3 pb-1">{timeEl}</div>
          </div>
        );

      case 'event_ticket': {
        const et = m.eventTicket || {};
        const tid = et.tournamentId || m.contentUrl;
        return (
          <div className="px-1.5 py-1.5" onClick={(e) => e.stopPropagation()}>
            {forwardedLabel}
            <QuotedReply replyTo={m.replyTo} isMe={isMe} />
            <EventTicketCard
              variant="chat"
              source="dm"
              tournament={{ id: tid, fundingModel: 'ticketed', ticket: { priceCoins: et.priceCoins, capacity: et.capacity, sold: et.sold } }}
              meta={et.name ? et : { name: (m.text || '').replace(/^🎟\s*/, '') }}
              onView={() => navigate(`/e/${tid}`)}
            />
            {timeEl}
          </div>
        );
      }

      default: {
        if (isEmojiOnly(m)) {
          return (
            <div className="flex flex-col items-center px-1">
              {forwardedLabel}<QuotedReply replyTo={m.replyTo} isMe={isMe} />
              <span className="text-[46px] leading-[1.15]">{m.text.trim()}</span>
              <span className={`self-end text-[9px] ${isMe ? 'text-white/50' : 'text-white/40'}`}>
                {time}
                {isMe && <Ticks read={m.read} className="ml-1 relative top-[2px]" />}
              </span>
            </div>
          );
        }
        const linkUrl = extractUrl(m.text);
        return (
          <div>
            {forwardedLabel}
            <QuotedReply replyTo={m.replyTo} isMe={isMe} />
            <ExpandableText text={m.text} isMe={isMe} timeEl={timeEl} />
            {linkUrl && <LinkPreviewCard url={linkUrl} isMe={isMe} />}
          </div>
        );
      }
    }
  };

  const retryMessage = (msg) => { setOptimisticMsgs(prev => prev.filter(m => m.id !== msg.id)); const { id, _status, ...payload } = msg; sendMsg(payload); };

  // Telegram-style delete: a deleted message leaves NO trace (no "this message
  // was deleted" placeholder). Filter any stray deleted row out of the render
  // entirely so the row collapses. Separators have no `deleted` and are kept.
  // Disappearing messages: hide anything past the chat's TTL at RENDER time, so
  // it vanishes on its timer instead of whenever the relay's 60s sweep next
  // runs (the sweep is what actually deletes the body server-side). `expireTick`
  // re-renders on a timer so a message open on screen disappears on its own.
  const baseMessages = filterExpired(
    [...messages, ...optimisticMsgs.filter(opt => { const last5 = messages.slice(-5); return !last5.some(m => m.text === opt.text && m.senderId === opt.senderId && m.type === opt.type); })].filter(m => !m.deleted),
    chatTtl,
    expireTick,
  );

  // Splice call rows into the conversation (WhatsApp behaviour: a call you made
  // or missed is part of the thread, not only of the Calls tab). Day separators
  // are rebuilt after the merge, otherwise a call landing on a day with no
  // messages would sit under the wrong date heading.
  const allMessages = (() => {
    if (!callRows.length) return baseMessages;
    const msMsg = (m) => (m.createdAt?.toDate ? m.createdAt.toDate().getTime() : (m.createdAt ? new Date(m.createdAt).getTime() : 0));
    const merged = [
      ...baseMessages.filter(m => m._type !== 'separator'),
      ...callRows.map(c => ({ ...c, _type: 'call', id: `call_${c.id}`, createdAt: new Date(c.startedAtMs || 0) })),
    ].sort((a, b) => msMsg(a) - msMsg(b));
    const out = [];
    let lastDate = null;
    for (const m of merged) {
      const dateStr = new Date(msMsg(m) || Date.now()).toDateString();
      if (dateStr !== lastDate) { out.push({ _type: 'separator', date: dateStr, id: 'sep_' + dateStr }); lastDate = dateStr; }
      out.push(m);
    }
    return out;
  })();
  const displayMessages = searchQuery ? allMessages.filter(m => m._type === 'separator' || (m.text && m.text.toLowerCase().includes(searchQuery.toLowerCase()))) : allMessages;

  // All viewable media in this chat (for the lightbox's swipe-between).
  const lightboxItems = displayMessages
    .filter(m => !m._type && !m.deleted && (
      (m.contentUrl && ['image', 'meme', 'giphy', 'video', 'videonote'].includes(m.type)) ||
      (m.type === 'clip' && m.videoUrl)))
    .map(m => m.type === 'clip'
      ? { msgId: m.id, url: m.videoUrl, type: 'video', poster: m.contentUrl }
      : { msgId: m.id, url: m.contentUrl, type: (m.type === 'video' || m.type === 'videonote') ? 'video' : 'image', poster: m.posterUrl || m.thumbnailUrl });
  const openLightbox = (msgId) => {
    const idx = lightboxItems.findIndex(it => it.msgId === msgId);
    if (idx >= 0) setLightbox({ index: idx });
  };

  // First-unread divider target (computed off the open-time snapshot).
  const firstUnreadId = (() => {
    const fu = firstUnreadRef.current;
    if (fu.chatId !== chatId || !fu.unread) return null;
    const me = auth.currentUser?.uid;
    if (fu.readAt) {
      for (const m of displayMessages) {
        if (m._type === 'separator' || m.senderId === me) continue;
        const ms = m.createdAt?.toDate ? m.createdAt.toDate().getTime() : 0;
        if (ms > fu.readAt) return m.id;
      }
      return null;
    }
    // No read marker yet (first open since the feature shipped): take the
    // last `unread` messages from others.
    let remaining = fu.unread;
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const m = displayMessages[i];
      if (m._type === 'separator' || m.senderId === me) continue;
      remaining--;
      if (remaining === 0) return m.id;
    }
    return null;
  })();

  const formatLastSeen = () => {
    if (otherOnline) return null;
    if (otherLastSeen) { const diff = Date.now() - otherLastSeen; if (diff < 60000) return 'last seen just now'; if (diff < 3600000) return `last seen ${Math.floor(diff / 60000)}m ago`; if (diff < 86400000) return `last seen ${Math.floor(diff / 3600000)}h ago`; return `last seen ${otherLastSeen.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`; }
    return 'Offline';
  };

  const closeAllPickers = () => { setShowEmoji(false); setShowMedia(null); };

  // Apply Vanguard mask to the 1-to-1 chat header. The conversation
  // doc only has a metadata snapshot of the other user; we fetched the
  // LIVE user doc above so `vanguard.rank` is present. Group chats skip
  // the mask entirely — group icon/name aren't user fields.
  const maskedDM = (() => {
    if (chatInfo?.isGroup) return { avatar: null, name: null, rank: null };
    // Viewer's own per-contact nickname wins (never applied over a masked
    // Vanguard persona — the mask is the identity boundary).
    const nick = profile?.contactNicknames?.[otherUserId];
    const live = otherUserLive;
    if (!live) return {
      avatar: otherUser?.avatar,
      name:   nick || otherUser?.name || otherUser?.displayName || 'Chat',
      rank:   null,
      // Crest in the DM header. No extra read: otherUserLive is the live user doc.
      vpLevel: otherUser?.vpLevel || null,
      role: otherUser?.role || null,
    };
    const masked = applyVanguardMask(live, profile);
    return {
      avatar: masked?.avatar || otherUser?.avatar,
      name:   (!masked?.isVanguardPersona && nick) || masked?.displayName || otherUser?.name || 'Chat',
      rank:   live?.vanguard?.rank || null,
      isVanguardPersona: masked?.isVanguardPersona,
      // ⚠ NULL UNDER THE MASK. A Vanguard persona is anonymous, and a rank crest
      // beside a masked name would leak exactly what the mask exists to hide.
      vpLevel: masked?.isVanguardPersona ? null : (live?.vpLevel || null),
      // ⚠ Also null under the mask: an admin allowance would out a masked mod.
      role: masked?.isVanguardPersona ? null : (live?.role || null),
    };
  })();

  return (
    <div
      className={`flex flex-col overflow-hidden ${isDesktop ? 'h-screen relative' : 'fixed inset-0'}`}
      style={isDesktop
        // ⚠ `isolation: isolate` IS REQUIRED, not decorative. The chat-theme
        // layer below is `z-index: -1`, and a negative-z child paints above its
        // parent's background ONLY if that parent forms a stacking context.
        // Without it the gradient rendered perfectly and was invisible, behind
        // an opaque ancestor: measured as a correct 824x686 canvas with the
        // mask loaded and nothing on screen. This is R6 in docs/effects/00-RULES.md.
        // The mobile branch always had it, which is why only desktop broke.
        ? { ...bgStyle, isolation: 'isolate' }
        : { height: 'var(--chat-vh, 100dvh)', isolation: 'isolate' }}
    >
      {/* Background layer — sized to the large viewport (ignoring the virtual
          keyboard) so the image doesn't rescale/jump when the keyboard opens
          and the flex container above shrinks. z-index: -1 (contained by the
          parent's `isolation: isolate` stacking context) so the emoji / media
          pickers and message list paint above it without needing their own
          explicit z-index. */}
      {!isDesktop && (
        <div
          aria-hidden="true"
          style={{ ...bgStyle, position: 'fixed', inset: 0, height: '100lvh', zIndex: -1, pointerEvents: 'none' }}
        />
      )}

      {/* Chat theme (effect 12). Sits in the same slot as the wallpaper: fixed
          to the viewport so it does not scroll away, zIndex -1 inside the
          parent's stacking context so every message paints above it. */}
      {chatTheme && (
        <div
          aria-hidden="true"
          style={{
            position: isDesktop ? 'absolute' : 'fixed',
            inset: 0,
            height: isDesktop ? '100%' : '100lvh',
            zIndex: -1,
            pointerEvents: 'none',
          }}
        >
          <ChatGradient
            colors={themeColors}
            motion={chatMotionFor(chatInfo)}
            patternUrl={chatPatternUrl(chatTheme)}
            sendCount={mySendCount}
            sheet={isLightApp ? '#FFFFFF' : '#000000'}
            // ⚠ The tile is 768 design units. Drawing it near 1:1 made the
            // icons chunky on screen and opened visible gaps between them.
            // Drawing it smaller shrinks every icon and tightens the field,
            // which is what makes it read as texture rather than as objects.
            tileSize={isDesktop ? 430 : 360}
          />
        </div>
      )}

      {/* Header */}
      <header className="shrink-0 flex items-center gap-3 px-4 z-20" style={{ height: 'auto', minHeight: 52, paddingTop: IS_NATIVE_BUILD ? 'calc(env(safe-area-inset-top, 0px) + 8px)' : 'env(safe-area-inset-top, 0px)', background: 'rgba(7,8,13,0.55)', backdropFilter: 'blur(20px) saturate(1.4)', WebkitBackdropFilter: 'blur(20px) saturate(1.4)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <button onClick={() => navigate('/messages')} className={isDesktop ? 'hidden' : 'shrink-0 text-text-secondary'}><Icon name="arrow_back" size={22} /></button>
        <div className="relative shrink-0 cursor-pointer" onClick={openContactInfo}>
          {chatInfo?.isSaved ? (
            <div className="w-[38px] h-[38px] rounded-full bg-brand-violet/15 border border-brand-violet/30 flex items-center justify-center">
              <Icon name="bookmark" size={19} className="text-brand-violet-light" />
            </div>
          ) : (
            <UserAvatar src={chatInfo?.isGroup ? (chatInfo.groupIcon || chatInfo.groupAvatar || null) : maskedDM.avatar} size={38} isGroup={chatInfo?.isGroup} isLive={!chatInfo?.isGroup && !maskedDM?.isVanguardPersona && isUserLive(otherUserId)} />
          )}
          {!chatInfo?.isSaved && otherOnline && <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-bg-dark rounded-full" />}
        </div>
        <div className="flex-1 min-w-0 cursor-pointer group" onClick={openContactInfo}>
          <h2 className="text-text-primary font-semibold text-sm truncate group-hover:text-text-primary transition-colors flex items-center gap-1.5">
            {chatInfo?.isSaved ? 'Saved Messages' : chatInfo?.isGroup ? chatInfo.groupName : maskedDM.name}
            {maskedDM.rank && <VanguardBadge rank={maskedDM.rank} size={13} />}
            {/* Rank crest. Only on a 1:1 thread — a group header shows the group
                name, and "Saved Messages" is yourself. Static, like every
                surface except live chat. */}
            {!chatInfo?.isSaved && !chatInfo?.isGroup && (
              <RankBadge level={maskedDM.vpLevel} role={maskedDM.role} size={13} />
            )}
          </h2>
          <p className="text-[10px] font-bold uppercase tracking-tighter">
            {chatInfo?.isSaved ? (
              <span className="text-text-muted opacity-60">Only you can see these</span>
            ) : chatInfo?.isGroup ? (
              typingUsers.length > 0 ? (
                // The glyph carries the motion now, so the old `animate-pulse`
                // on the text came off: two unsynchronised animations on one
                // line read as a fault rather than as one indicator.
                <TypingIndicator
                  variant="inline"
                  className="text-brand-violet-light"
                  users={typingUsers}
                  typist={profileOf(typingUsers[0]?.uid)}
                  label={`${senderNameOf(typingUsers[0]?.uid)} is typing...`}
                />
              ) : (
                <span className="text-text-muted opacity-60">{(chatInfo?.participants || []).length} members</span>
              )
            ) : typingUsers.some(u => u.uid === otherUserId) ? (
              <TypingIndicator
                variant="inline"
                className="text-brand-violet-light"
                users={typingUsers}
                typist={profileOf(otherUserId)}
                label="typing..."
              />
            ) : otherOnline ? (
              <span className="text-green-400">Active now</span>
            ) : (
              <span className="text-text-muted opacity-60">{formatLastSeen()}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          {/* Armed auto-delete timer — visible without opening the menu, so
              nobody types into a disappearing chat without knowing. */}
          {chatTtl > 0 && (
            <button
              onClick={() => canSetTtl && setTtlSheetOpen(true)}
              title={`Messages disappear after ${ttlLabel(chatTtl)}`}
              className="flex items-center gap-1 px-1.5 py-1 rounded-full text-brand-violet-light hover:bg-white/[0.06] transition-colors"
            >
              <Icon name="timer" size={16} />
              <span className="text-[10px] font-bold tabular-nums">{ttlShort(chatTtl)}</span>
            </button>
          )}
          <button onClick={() => setShowSearch(s => !s)} className="text-text-muted hover:text-text-secondary transition-colors p-1.5"><Icon name="search" size={20} /></button>
          {/* Call buttons were gated only on isSaved (the self-chat), so they
              also rendered on a SUPPORT thread — and startCall() copies
              `chatInfo.participants` onto the call doc, which for a support
              thread is [the user, ...support agents]. IncomingCallManager
              listens for `calls` where participants array-contains uid and
              status == 'ringing', so tapping the video icon rang every support
              agent's PERSONAL account, unsolicited, from any user at any time.
              A support conversation is a ticket, not a contact. */}
          {!chatInfo?.isSaved && !chatInfo?.supportThread && !chatInfo?.isOfficial && (
            <>
              <button onClick={() => startCall('video')} className="text-text-muted hover:text-text-secondary transition-colors p-1.5"><Icon name="videocam" size={20} /></button>
              <button onClick={() => startCall('voice')} className="text-text-muted hover:text-text-secondary transition-colors p-1.5"><Icon name="call" size={18} /></button>
            </>
          )}
          <button ref={headerMenuBtnRef} onClick={openHeaderMenu} className="text-text-muted hover:text-text-secondary transition-colors p-1.5"><Icon name="more_vert" size={20} /></button>
        </div>
        {/* PORTALLED to <body> on purpose. This header sets `backdrop-filter`,
            which makes it a containing block for position:fixed AND its own
            stacking context. Rendered inline, the dismiss backdrop was clipped
            to the header box (so tapping the thread never closed the menu) and
            the menu's z-40 was trapped under the header's z-20 — which is why
            the sticky day pills ("MON, JUL 6") painted over it. */}
        {showHeaderMenu && createPortal(
          <>
            <div className="fixed inset-0 z-[9998]" onClick={() => { setShowHeaderMenu(false); setShowMuteOptions(false); }} />
            <div
              className="fixed z-[9999] w-52 bg-surface-1 border border-white/[0.06] rounded-2xl shadow-2xl overflow-hidden animate-fade-in"
              style={{ top: headerMenuPos.top, right: headerMenuPos.right }}
            >
            {[
              { icon: 'search', label: 'Search', action: () => { setShowSearch(true); setShowHeaderMenu(false); } },
              // Mute is PER-USER (muted.{uid} = true | untilMs) — the old shared
              // boolean silenced the chat for BOTH sides.
              isChatMutedFor(chatInfo, auth.currentUser?.uid)
                ? { icon: 'notifications_active', label: 'Unmute', action: async () => { try { await setChatMuted(chatId, false); } catch {} setShowHeaderMenu(false); setShowMuteOptions(false); } }
                : { icon: 'notifications_off', label: 'Mute…', action: () => setShowMuteOptions(s => !s) },
              { icon: 'translate', label: autoTranslate ? 'Auto-translate: On' : 'Auto-translate', action: toggleAutoTranslate },
              { icon: 'event', label: 'Jump to date', action: openJumpToDate },
              // Not on a support ticket: it would let the user set their own
              // support record to self-destruct (audit A4).
              canSetTtl && !isSupportThread && {
                icon: 'timer',
                label: chatTtl ? `Auto-delete: ${ttlLabel(chatTtl)}` : 'Auto-delete',
                action: () => { setShowHeaderMenu(false); setTtlSheetOpen(true); },
              },
              { icon: 'wallpaper', label: 'Change Wallpaper', action: () => { navigate(`/messages/${chatId}/settings`); setShowHeaderMenu(false); } },
              { icon: 'cleaning_services', label: 'Clear Chat', action: async () => {
                  if (!window.confirm('Clear all messages in this chat on THIS device?')) return;
                  try {
                    if (relayEnabled) {
                      // Relay path: history only exists locally — wipe Dexie + memory.
                      await clearLocalMessages?.();
                    } else {
                      const snap = await getDocs(collection(db, 'conversations', chatId, 'messages'));
                      const batch = writeBatch(db);
                      snap.docs.forEach(d => batch.delete(d.ref));
                      await batch.commit();
                    }
                  } catch {}
                  setShowHeaderMenu(false);
                } },
              // Private conversations are not scanned by automated moderation,
              // so a participant reporting is the ONLY way anything in here
              // reaches a human. Blocking stops the messages reaching YOU and
              // tells nobody at Vergr that anything happened; this does.
              // Hidden on a support ticket: it points the reporting flow at the
              // support team the user is currently talking to (audit A4).
              !isSupportThread && { icon: 'flag', label: 'Report', danger: true, action: () => {
                  setReportOpen(true);
                  setShowHeaderMenu(false);
                } },
              // Also hidden on support: deleting orphans the user's side while
              // the agent's queue row survives, so the ticket lives on with
              // nobody able to see it. Support threads follow the official
              // channel rule instead (they reappear on the next message).
              !isSupportThread && { icon: 'delete', label: 'Delete Chat', danger: true, action: () => {
                  setAlsoDeleteForThem(false);
                  setShowDeleteDialog(true);
                  setShowHeaderMenu(false);
                } },
            ].filter(Boolean).map((item, i) => (
              <div key={item.label}>
                <button onClick={item.action}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors ${i > 0 ? 'border-t border-white/[0.03]' : ''}`}>
                  <Icon name={item.icon} size={18} className={item.danger ? 'text-brand-ember' : 'text-text-secondary'} />
                  <span className={`text-sm ${item.danger ? 'text-brand-ember' : 'text-text-primary'}`}>{item.label}</span>
                </button>
                {item.label === 'Mute…' && showMuteOptions && (
                  <div className="bg-surface-2/60">
                    {MUTE_OPTIONS.map(opt => (
                      <button key={opt.label}
                        onClick={async () => { try { await setChatMuted(chatId, opt.value()); } catch {} setShowHeaderMenu(false); setShowMuteOptions(false); }}
                        className="w-full flex items-center gap-3 pl-12 pr-4 py-2.5 text-left hover:bg-surface-2 transition-colors">
                        <span className="text-[13px] text-text-secondary">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            </div>
          </>,
          document.body,
        )}
        {/* Hidden picker driving "Jump to date" (opened via showPicker()). */}
        <input
          ref={jumpDateRef}
          type="date"
          onChange={(e) => jumpToDate(e.target.value)}
          className="absolute right-4 top-12 w-0 h-0 opacity-0 pointer-events-none [color-scheme:dark]"
          tabIndex={-1}
          aria-hidden="true"
        />
      </header>

      {showSearch && (() => {
        const searchResults = searchQuery ? allMessages.filter(m => m._type !== 'separator' && m.text?.toLowerCase().includes(searchQuery.toLowerCase())) : [];
        const totalResults = searchResults.length;
        const scrollToResult = (idx) => {
          const msg = searchResults[idx];
          if (msg) { const el = document.getElementById(`msg-${msg.id}`); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('ring-2', 'ring-brand-violet/50'); setTimeout(() => el.classList.remove('ring-2', 'ring-brand-violet/50'), 2000); } }
        };
        return (
          <div className="flex items-center gap-2 px-3 py-2 bg-surface-1 border-b border-white/[0.04] animate-slide-down">
            <Icon name="search" size={18} className="text-text-muted shrink-0" />
            <input autoFocus value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setSearchIndex(0); }} placeholder="Search in chat..." className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-text-muted/60" />
            {searchQuery && totalResults > 0 && (
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[10px] text-text-muted">{searchIndex + 1}/{totalResults}</span>
                <button onClick={() => { const next = (searchIndex - 1 + totalResults) % totalResults; setSearchIndex(next); scrollToResult(next); }} className="text-text-muted hover:text-white p-0.5"><Icon name="keyboard_arrow_up" size={18} /></button>
                <button onClick={() => { const next = (searchIndex + 1) % totalResults; setSearchIndex(next); scrollToResult(next); }} className="text-text-muted hover:text-white p-0.5"><Icon name="keyboard_arrow_down" size={18} /></button>
              </div>
            )}
            {searchQuery && totalResults === 0 && <span className="text-[10px] text-text-muted shrink-0">No results</span>}
            <button onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchIndex(0); }} className="text-text-muted hover:text-white"><Icon name="close" size={18} /></button>
          </div>
        );
      })()}

      {chatInfo?.pinnedMessage && !showSearch && (
        <div className="flex items-center gap-2 px-4 py-2 bg-surface-2/80 border-b border-white/[0.03]">
          <button onClick={() => { const el = document.getElementById(`msg-${chatInfo.pinnedMessage.id}`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
            className="flex items-center gap-2 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity">
            <Icon name="push_pin" size={16} className="text-brand-violet-light shrink-0" />
            <div className="flex-1 min-w-0"><p className="text-[10px] text-brand-violet-light font-bold">Pinned Message</p><p className="text-xs text-text-muted truncate">{chatInfo.pinnedMessage.text}</p></div>
          </button>
          <button onClick={async () => { try { await updateDoc(doc(db, 'conversations', chatId), { pinnedMessage: null }); } catch {} }}
            className="text-text-muted hover:text-white p-1 shrink-0" title="Unpin"><Icon name="close" size={16} /></button>
        </div>
      )}

      {/* Main content */}
      <main
        ref={containerRef}
        className="flex-1 overflow-y-auto no-scrollbar"
      >
        {/* Optional dark overlay for custom images (keeps your original logic) */}
        {chatInfo?.chatBackground === 'custom_image' && chatInfo?.chatBackgroundImage && (
          <div className="absolute inset-0 bg-bg-dark/50 pointer-events-none" />
        )}
        <div className="relative p-4 min-h-full flex flex-col justify-end">
          {loading && <ChatThreadSkeleton rows={6} />}

          {displayMessages.map((rawM, mi) => {
            if (rawM._type === 'separator') return <DaySeparator key={rawM.id} date={rawM.date} />;
            if (rawM._type === 'call') return <CallRow key={rawM.id} call={rawM} meUid={auth.currentUser?.uid} onCallBack={startCall} />;
            // System messages ("X added Y", "X renamed the group") render as
            // centered pills, not bubbles.
            if (rawM.type === 'system') {
              return (
                <div key={rawM.id} id={`msg-${rawM.id}`} className="flex justify-center py-1.5">
                  <span className="px-3 py-1 bg-bg-dark/60 backdrop-blur-sm rounded-full text-[10.5px] text-text-muted border border-white/[0.04] text-center max-w-[85%]">
                    {systemText(rawM)}
                  </span>
                </div>
              );
            }
            const isMe = rawM.senderId === auth.currentUser?.uid;
            // Relay-path read receipt: blue ticks when every other member's
            // readAt marker has passed this message's timestamp.
            const msgMs = rawM.createdAt?.toDate ? rawM.createdAt.toDate().getTime() : 0;
            const m = (relayEnabled && isMe && msgMs && othersReadAt && msgMs <= othersReadAt && !rawM.read)
              ? { ...rawM, read: true } : rawM;
            const isOptimistic = m._status === 'sending';
            const isFailed = m._status === 'failed';
            const isHighlighted = searchQuery && m.text?.toLowerCase().includes(searchQuery.toLowerCase());

            // Group sender attribution (Telegram-style): name pill on the
            // first message of a sender run, avatar beside the last. The same
            // run flags drive message CLUSTERING (tight spacing, tail corner
            // only on the run's last bubble).
            const isGroup = !!chatInfo?.isGroup;
            const prevM = displayMessages[mi - 1];
            const nextM = displayMessages[mi + 1];
            // Imported history rows (Discord/WhatsApp) may have no senderId —
            // cluster runs by the imported author name instead.
            const senderKeyOf = (x) => x?.senderId || x?.imported?.name || '';
            const runStart = !prevM || prevM._type === 'separator' || senderKeyOf(prevM) !== senderKeyOf(m) || prevM.type === 'system';
            const runEnd = !nextM || nextM._type === 'separator' || senderKeyOf(nextM) !== senderKeyOf(m) || nextM.type === 'system';
            const showSender = isGroup && !isMe;
            const senderProfile = showSender ? memberProfiles[m.senderId] : null;
            const importedOnly = !!m.imported && !m.senderId; // no Vergr account mapped
            // `wallet` (a coin transfer) and `location` (a map card) are their
            // own self-styled cards, not chat bubbles, so they opt out of the
            // default bubble background.
            const noBubble = m.type === 'sticker' || m.type === 'videonote' || m.type === 'wallet' || m.type === 'location' || isEmojiOnly(m);
            // MEDIA IS THE BUBBLE. A photo, a clip, a locked item or a session
            // card fills its container edge to edge, so the bubble's border and
            // tinted background only ever appear as a rim tracing the media —
            // which is the "thick border that makes it look stupid". These keep
            // the rounding and the shadow and drop the frame.
            const bareMedia = !noBubble
              && (m.type === 'image' || m.type === 'video' || m.type === 'locked' || m.type === 'onetoone');

            return (
              <Fragment key={m.id}>
              {m.id === firstUnreadId && (
                <div data-first-unread className="flex items-center gap-3 py-2.5">
                  <div className="flex-1 h-px bg-brand-violet/25" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-violet-light/80">Unread messages</span>
                  <div className="flex-1 h-px bg-brand-violet/25" />
                </div>
              )}
              <motion.div id={`msg-${m.id}`}
                initial={isOptimistic ? { scale: 0.85, opacity: 0.5 } : { scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: isOptimistic ? 0.6 : 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30, mass: 0.8 }}
                onClickCapture={selectedIds ? (e) => { e.preventDefault(); e.stopPropagation(); if (justLongPressed.current) { justLongPressed.current = false; return; } toggleSelect(m.id); } : undefined}
                // Telegram row model: the WHOLE line is the message's tap
                // target, so tapping the empty space beside a photo/video
                // bubble still opens the reaction menu. Media surfaces keep
                // their own gestures (play, lightbox) via stopPropagation.
                onClick={(e) => handleMsgTap(m, e)}
                onTouchStartCapture={(e) => handleMsgLongPress(m.id, e)}
                onTouchMove={handleLongPressMove}
                onTouchEnd={cancelLongPress}
                onTouchCancel={cancelLongPress}
                onMouseDown={(e) => handleMsgLongPress(m.id, e)}
                onMouseUp={cancelLongPress}
                onMouseLeave={cancelLongPress}
                onContextMenu={(e) => {
                  // Desktop right-click opens the menu; suppress the native
                  // long-press menu on touch (hold = selection there).
                  e.preventDefault();
                  if (!isDesktop) return;
                  setContextMenuPos({ x: e.clientX, y: e.clientY });
                  setContextMenuMsgId(prev => prev === m.id ? null : m.id);
                }}
                className={`flex ${isMe ? 'justify-end' : 'justify-start'} ${runStart ? 'mt-3' : 'mt-[2px]'} ${isHighlighted ? 'bg-brand-violet/5 -mx-2 px-2 rounded-lg' : ''} ${selectedIds?.has(m.id) ? 'bg-brand-violet/10 -mx-2 px-2 rounded-lg' : ''} ${selectedIds ? 'cursor-pointer' : ''}`}>
                {selectedIds && (
                  <span className={`self-center shrink-0 ${isMe ? 'mr-auto' : 'mr-2'}`}>
                    <Icon name={selectedIds.has(m.id) ? 'check_circle' : 'radio_button_unchecked'} size={20}
                      className={selectedIds.has(m.id) ? 'text-brand-violet-light' : 'text-text-muted/50'} />
                  </span>
                )}
                {showSender && (
                  <div className="w-7 mr-1.5 shrink-0 self-end pb-0.5">
                    {runEnd && (
                      <button onClick={(e) => { e.stopPropagation(); if (!importedOnly && !isSupportAgent(m.senderId)) navigate(`/user/${m.senderId}`); }} aria-label="View profile">
                        {/* A masked agent shows the channel's avatar, and tapping
                            it must not open the agent's personal profile. */}
                        <UserAvatar src={isSupportAgent(m.senderId)
                          ? (chatInfo?.groupAvatar || null)
                          : (senderProfile?.avatar || chatInfo?.metadata?.[m.senderId]?.avatar || m.imported?.avatar)} size={26} />
                      </button>
                    )}
                  </div>
                )}
                <div className="flex flex-col max-w-[80%] lg:max-w-[65%] min-w-0" style={{ alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                  {showSender && runStart && (
                    <span className="px-1 pb-0.5 flex items-center gap-1.5 max-w-full">
                      <button
                        onClick={(e) => { e.stopPropagation(); if (!importedOnly && !isSupportAgent(m.senderId)) navigate(`/user/${m.senderId}`); }}
                        className="text-[11px] font-bold truncate text-left"
                        style={{ color: senderColor(m.senderId || m.imported?.name || '') }}>
                        {importedOnly ? m.imported.name : senderNameOf(m.senderId)}
                      </button>
                      {m.imported && (
                        <span className="shrink-0 px-1.5 py-px rounded-full bg-white/[0.06] text-[8.5px] font-bold uppercase tracking-wider text-text-muted">
                          via {m.imported.source === 'whatsapp' ? 'WhatsApp' : 'Discord'}
                        </span>
                      )}
                    </span>
                  )}
                  <div className="relative"
                    style={{ transition: 'transform 0.2s' }}
                    onTouchStart={(e) => handleSwipeStart(e, m)}
                    onTouchMove={handleSwipeMove}
                    onTouchEnd={handleSwipeEnd}>

                    {contextMenuMsgId === m.id && (
                      <MessageContextMenu chatId={chatId} messageId={m.id} message={m} isMe={isMe}
                        anchorX={contextMenuPos.x} anchorY={contextMenuPos.y}
                        onClose={closeContextMenu}
                        onTranslate={m.text ? (msg) => setTranslateMsg(msg) : undefined}
                        onReact={relayEnabled ? (emoji) => toggleReaction(chatId, m.id, emoji, m.reactions) : undefined}
                        onReply={handleReply} onEdit={handleEdit} onPin={handlePin} onForward={setForwardMsg} onDelete={handleDelete}
                        onSelect={(msg) => setSelectedIds(new Set([msg.id]))}
                        onSaveMedia={canSaveToGallery ? handleSaveMedia : undefined} />
                    )}

                    <div data-msg-bubble className={`${noBubble ? '' : `rounded-2xl overflow-hidden break-words ${isMe ? `text-white ${runEnd ? 'rounded-br-none' : ''}` : `bg-surface-2 text-white ${bareMedia ? '' : 'border border-white/[0.06]'} ${runEnd ? 'rounded-bl-none' : ''}`}`} transition-opacity ${isOptimistic ? 'opacity-60' : ''} ${isFailed ? 'opacity-40 ring-1 ring-red-500/50' : ''} ${m._status === 'queued' ? 'opacity-70 ring-1 ring-yellow-500/40' : ''}`}
                      {...(autoTranslate && !isMe && m.type === 'text' && m.text ? { 'data-translate-id': m.id, 'data-translate-text': m.text } : {})}
                      style={noBubble ? bubbleVarsOnly : isMe ? outBubbleStyle : inBubbleStyle}>
                      {renderMessageContent(m, isMe)}
                      {autoTranslate && !isMe && m.type === 'text' && m.text && translations[m.id] && translations[m.id] !== 'error' && (
                        translations[m.id] === 'pending'
                          ? <p className="px-4 pb-2 -mt-1.5 text-[11px] italic text-white/40">translating…</p>
                          : (translations[m.id].text && translations[m.id].text.trim() !== m.text.trim()) ? (
                            <div className="px-4 pb-2 -mt-1">
                              <div className="border-t border-white/[0.12] pt-1.5 mt-1">
                                <p className="text-[14px] leading-snug whitespace-pre-wrap break-words text-white/95">{translations[m.id].text}</p>
                                <p className="mt-0.5 text-[9px] uppercase tracking-wide text-white/40">translated</p>
                              </div>
                            </div>
                          ) : null
                      )}
                    </div>

                    {m._status === 'queued' && <span className="text-[9px] text-yellow-400/80 font-bold uppercase mt-0.5 px-1 flex items-center gap-1"><Icon name="schedule" size={10} />Queued</span>}
                    {isFailed && <button onClick={(e) => { e.stopPropagation(); retryMessage(m); }} className="text-[9px] text-red-400 font-bold uppercase mt-0.5 px-1">Retry</button>}
                  </div>
                  {m.reactions && (
                    // display:contents so this wrapper adds no layout box; it
                    // only stops chip taps from also opening the row's menu.
                    <span style={{ display: 'contents' }} onClick={(e) => e.stopPropagation()}>
                      <ReactionBubbles reactions={m.reactions} chatId={chatId} messageId={m.id} isMe={isMe}
                        onToggle={relayEnabled ? (emoji) => toggleReaction(chatId, m.id, emoji, m.reactions) : undefined}
                        onShowReactors={(emoji) => setReactorsView({ reactions: m.reactions, emoji })} />
                    </span>
                  )}
                </div>
              </motion.div>
              </Fragment>
            );
          })}

          {/* Typing indicator */}
          {typingUsers.length > 0 && (
            <div className="flex justify-start">
              <div className="flex gap-2 items-end">
                <div className="w-8 shrink-0">
                  {/* Groups: show the avatar of whoever is actually typing,
                      not the (undefined) DM "other user". */}
                  <UserAvatar
                    src={chatInfo?.isGroup
                      ? (memberProfiles[typingUsers[0]?.uid]?.avatar || chatInfo?.metadata?.[typingUsers[0]?.uid]?.avatar)
                      : (otherUser?.avatar)}
                    size={26} />
                </div>
                {/* `users` is what makes this render at all: without it the
                    component's own empty-list guard returned null and this
                    bubble never drew. `typist` is what makes it carry the other
                    person's chosen style. */}
                <TypingIndicator
                  users={typingUsers.map(u => ({ uid: u.uid, name: senderNameOf(u.uid) }))}
                  typist={profileOf(typingUsers[0]?.uid)}
                />
              </div>
            </div>
          )}

          <div ref={scrollRef} />
        </div>
      </main>

      {/* Media Panel */}
      {showMedia && (
        <MediaPanel
          defaultTab={showMedia}
          onSelect={handleMediaSelect}
          onClose={() => setShowMedia(null)}
        />
      )}

      {/* Emoji Picker */}
      {showEmoji && <EmojiPicker onSelect={(emoji) => setInput(prev => prev + emoji)} onClose={() => setShowEmoji(false)} />}

      {/* Input Footer */}
      <footer className="relative z-10 px-2 pb-2 pt-1.5 lg:px-3 lg:pb-3 lg:pt-2" style={{ paddingBottom: 'calc(8px + env(safe-area-inset-bottom, 0px))', background: 'rgba(7,8,13,0.45)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
        {/* Multi-select action bar — replaces the composer while selecting */}
        {selectedIds && (() => {
          const selMsgs = displayMessages.filter(m => m._type !== 'separator' && selectedIds.has(m.id));
          const allMine = selMsgs.length > 0 && selMsgs.every(m => m.senderId === auth.currentUser?.uid);
          const copySel = () => {
            const text = selMsgs.map(m => m.text || m.contentUrl || '').filter(Boolean).join('\n');
            navigator.clipboard?.writeText(text);
            setSelectedIds(null);
          };
          const deleteForMe = () => {
            setOptimisticMsgs(prev => prev.filter(x => !selectedIds.has(x.id)));
            selMsgs.forEach(m => removeLocalMessage?.(m.id));
            setSelectedIds(null); setShowSelDelete(false);
          };
          const deleteForEveryone = async () => {
            for (const m of selMsgs) {
              removeLocalMessage?.(m.id);
              try {
                if (relayEnabled) await tombstoneMessage(chatId, m.id);
                else await httpsCallable(functions, 'deleteMessage')({ chatId, messageId: m.id });
              } catch (err) { console.error('Batch delete failed:', err); }
            }
            syncPreviewToLatest?.();
            setSelectedIds(null); setShowSelDelete(false);
          };
          return (
            <div className="absolute inset-0 z-30 flex items-center gap-1 px-3" style={{ background: 'rgba(7,8,13,0.97)' }}>
              <button onClick={() => { setSelectedIds(null); setShowSelDelete(false); }} className="w-9 h-9 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary">
                <Icon name="close" size={20} />
              </button>
              <span className="flex-1 text-sm font-bold text-text-primary">{selMsgs.length} selected</span>
              {selMsgs.length === 1 && (
                <button onClick={() => { handleReply(selMsgs[0]); setSelectedIds(null); }} title="Reply" className="w-9 h-9 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary">
                  <Icon name="reply" size={19} />
                </button>
              )}
              <button onClick={copySel} title="Copy" className="w-9 h-9 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary">
                <Icon name="content_copy" size={18} />
              </button>
              <button onClick={() => { setForwardMsg(selMsgs); setSelectedIds(null); }} title="Forward" className="w-9 h-9 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary">
                <Icon name="forward" size={19} />
              </button>
              <div className="relative">
                <button onClick={() => setShowSelDelete(s => !s)} title="Delete" className="w-9 h-9 rounded-full flex items-center justify-center text-brand-ember">
                  <Icon name="delete" size={19} />
                </button>
                {showSelDelete && (
                  <div className="absolute bottom-11 right-0 w-48 bg-surface-1 border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden">
                    <button onClick={deleteForMe} className="w-full px-4 py-2.5 text-left text-sm text-text-primary hover:bg-surface-2">Delete for me</button>
                    {allMine && (
                      <button onClick={deleteForEveryone} className="w-full px-4 py-2.5 text-left text-sm text-brand-ember hover:bg-brand-ember/10 border-t border-white/[0.04]">Delete for everyone</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        {/* Only-admins-post lock (members keep reading, composer blocked) */}
        {postingLocked && (
          <div className="absolute inset-0 z-20 flex items-center justify-center gap-2" style={{ background: 'rgba(7,8,13,0.97)' }}>
            <Icon name="lock" size={15} className="text-text-muted" />
            <span className="text-sm text-text-muted">Only admins can send messages</span>
          </div>
        )}
        {/* @mention autocomplete (group chats) */}
        {mentionCandidates.length > 0 && (
          <div className="absolute bottom-full left-2 right-2 mb-1 bg-surface-1 border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden">
            {mentionCandidates.map(c => (
              <button key={c.uid} onClick={() => insertMention(c.username)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-2 transition-colors">
                <UserAvatar src={c.avatar} size={26} />
                <span className="text-sm text-text-primary font-medium truncate">{c.name}</span>
                <span className="text-[11px] text-text-muted truncate"><UserName user={c} masked handle /></span>
              </button>
            ))}
          </div>
        )}
        {/* Scheduled-messages indicator (Lite/Pro) */}
        {scheduledMsgs.length > 0 && (
          <button
            onClick={() => setScheduleOpen(true)}
            className="flex items-center gap-2 px-3 py-2 mb-1.5 w-full bg-brand-violet/12 border border-brand-violet/30 rounded-2xl text-left hover:bg-brand-violet/20 transition-colors"
          >
            <Icon name="schedule" size={16} className="text-brand-violet-light shrink-0" />
            <span className="text-[12px] text-white font-medium">{scheduledMsgs.length} scheduled message{scheduledMsgs.length === 1 ? '' : 's'}</span>
            <span className="ml-auto text-[11px] text-text-muted">View</span>
          </button>
        )}
        {/* Stranger-DM media block. Only appears once the user reaches for a
            photo — the point is to answer "why can't I send this", not to
            preface every conversation with a rule. */}
        {showStrangerNote && strangerMediaBlocked && (
          <div className="flex items-start gap-2.5 px-3 py-2.5 mb-1.5 bg-brand-gold/10 border border-brand-gold/30 rounded-2xl">
            <Icon name="lock" size={16} className="text-brand-gold shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[12px] text-white font-medium">Attachments are locked</p>
              <p className="text-[11px] text-text-muted mt-0.5">
                {otherUser?.name ? `${otherUser.name} hasn't` : "They haven't"} followed you back yet, so this chat is
                text-only for now. Photos, videos and files unlock the moment they do.
              </p>
            </div>
            <button
              onClick={() => setShowStrangerNote(false)}
              className="w-7 h-7 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-2/50 transition-colors shrink-0"
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        )}
        {/* Reply / Edit bar */}
        {(replyTo || editingMsg) && (
          <div className="flex items-center gap-3 px-3 py-2 mb-1.5 bg-bg-dark/60 backdrop-blur-xl rounded-2xl border border-white/[0.08]">
            <div className={`w-[3px] self-stretch rounded-full ${editingMsg ? 'bg-brand-gold' : 'bg-brand-violet'}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-[10px] font-semibold ${editingMsg ? 'text-brand-gold' : 'text-brand-violet-light'}`}>{editingMsg ? 'Editing' : `Reply to ${replyTo?.senderName}`}</p>
              <p className="text-[11px] text-text-muted truncate">{editingMsg?.text || replyTo?.text}</p>
            </div>
            <button onClick={() => { setReplyTo(null); setEditingMsg(null); setInput(''); }} className="w-7 h-7 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-2/50 transition-colors shrink-0"><Icon name="close" size={16} /></button>
          </div>
        )}

        <div className="flex items-end gap-1.5">
          {!isRecording && (
            <>
              {/* Hidden file inputs */}
              <input type="file" id={`file-up-${chatId}`} hidden accept="*/*" onChange={handleFileSelect} />
              <input type="file" id={`media-up-${chatId}`} hidden accept="image/*,video/*,audio/*" onChange={handleFileSelect} />
              <input type="file" id={`camera-up-${chatId}`} hidden accept="image/*" capture="environment" onChange={handleFileSelect} />
              <input type="file" id={`music-up-${chatId}`} hidden accept="audio/*" onChange={handleFileSelect} />

              {/* Attachment button — hidden entirely when an admin has turned
                  off member media, rather than shown and then failing.

                  The STRANGER gate is deliberately different: the button stays,
                  and tapping it explains why. Hiding it there would just be a
                  missing button with no reason given, which is the "app looks
                  broken" outcome the rule is trying to avoid. */}
              {canSendMedia && (
                <button
                  ref={attachBtnRef}
                  onClick={() => {
                    if (strangerMediaBlocked) { setShowStrangerNote(true); return; }
                    setShowAttachmentMenu(true);
                  }}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors shrink-0 self-end ${
                    strangerMediaBlocked
                      ? 'text-text-muted/40'
                      : 'text-text-muted hover:text-text-primary hover:bg-surface-2/40'
                  }`}
                >
                  <Icon name="attach_file" size={22} className="rotate-[315deg]" />
                </button>
              )}

              {/* Main input pill */}
              <div className="flex-1 flex items-end bg-surface-1/80 backdrop-blur-xl rounded-[22px] border border-white/[0.08] focus-within:border-white/[0.15] transition-colors min-h-[44px] min-w-0">
                {/* Emoji toggle */}
                <button onClick={() => { const on = !showEmoji; closeAllPickers(); if (on) setShowEmoji(true); }} className="w-[44px] h-[44px] shrink-0 flex items-center justify-center">
                  <Icon name={showEmoji ? 'keyboard' : 'sentiment_satisfied'} size={22} className={showEmoji ? 'text-brand-violet-light' : 'text-text-muted'} />
                </button>

                {/* Text input */}
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    setTyping();
                    if (!editingMsg) saveDraft(chatId, e.target.value);
                    e.target.style.height = '24px';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleTextSend();
                    }
                  }}
                  placeholder={editingMsg ? 'Edit message...' : 'Message...'}
                  rows={1}
                  className="flex-1 w-full bg-transparent py-[10px] px-1 text-[14px] text-text-primary outline-none resize-none overflow-y-auto break-words whitespace-pre-wrap leading-[20px] placeholder:text-text-muted/50"
                  style={{ minHeight: '24px', maxHeight: '120px' }}
                />

                {/* Right side icons inside the pill */}
                {!input.trim() && (
                  <div className="flex items-center shrink-0 h-[44px]">
                    <button onClick={() => { const on = showMedia !== 'stickers'; closeAllPickers(); if (on) setShowMedia('stickers'); }} className="p-2">
                      <Icon name="sticky_note_2" size={20} className={showMedia === 'stickers' ? 'text-brand-violet-light' : 'text-text-muted'} />
                    </button>
                    <button onClick={() => { const on = showMedia !== 'gifs'; closeAllPickers(); if (on) setShowMedia('gifs'); }} className="p-2">
                      <Icon name="gif_box" size={20} className={showMedia === 'gifs' ? 'text-brand-violet-light' : 'text-text-muted'} />
                    </button>
                  </div>
                )}
              </div>

            </>
          )}

          {isRecording && (
            /* Recording state — WhatsApp gestures: slide left to cancel,
               slide up to lock. Until locked, the user is HOLDING the mic
               button (pointer-captured), so the bar shows the slide hint;
               once locked it shows tap targets (delete / send). */
            <div className="flex-1 flex items-center gap-3 bg-surface-1/80 backdrop-blur-xl rounded-full px-4 py-2.5 border border-white/[0.08] overflow-hidden">
              {/* Live camera preview (video messages only) — Telegram round
                  bubble. PORTALLED to <body> with FIXED positioning: the
                  composer bar has overflow-hidden and sits under ancestors
                  with backdrop-blur/transforms, which clip or trap an inline
                  absolutely-positioned element so the founder never saw it.
                  pointer-events-none so the record button underneath keeps
                  receiving the slide/lock gestures. */}
              {recordMode === 'camera' && createPortal(
                <div className="fixed inset-x-0 bottom-28 z-[95] flex flex-col items-center pointer-events-none px-4">
                  <video
                    ref={previewVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-60 h-60 rounded-full object-cover border-[3px] border-red-500 shadow-2xl bg-black"
                    style={{ transform: 'scaleX(-1)' }}
                  />
                  <span className="mt-3 px-3 py-1 rounded-full bg-black/65 backdrop-blur-sm text-[12px] text-white text-center">
                    {recordLocked ? 'Recording · tap send when done' : 'Recording · release to send · slide left to cancel'}
                  </span>
                </div>,
                document.body
              )}
              <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
              <Icon name={recordMode === 'camera' ? 'videocam' : 'mic'} size={16} className="text-red-400 shrink-0" />
              <span className="text-text-primary text-sm font-dmmono shrink-0">{Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}</span>
              {!recordLocked ? (
                <span
                  className="flex-1 text-[12px] text-text-muted truncate select-none"
                  style={{ transform: `translateX(${recordDragX}px)`, opacity: Math.max(0.2, 1 + recordDragX / 120) }}
                >
                  ‹ Slide to cancel&nbsp;&nbsp;·&nbsp;&nbsp;<Icon name="lock" size={11} className="inline-block align-[-1px]" /> up to lock
                </span>
              ) : (
                <>
                  <span className="flex-1 text-[11px] text-brand-violet-light/80 flex items-center gap-1 select-none">
                    <Icon name="lock" size={12} /> Locked
                  </span>
                  <button onClick={handleRecordCancel} className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors">
                    <Icon name="delete" size={16} />
                  </button>
                </>
              )}
            </div>
          )}

          {/* Send / Mic / Camera button — stays MOUNTED while recording so
              pointer capture survives the composer→recording-bar swap (the
              slide gestures depend on continued pointermove events). */}
          <AnimatePresence mode="wait">
            {input.trim() && !isRecording ? (
              <motion.button
                key="send"
                initial={{ scale: 0.5, rotate: -90 }}
                animate={{ scale: 1, rotate: 0 }}
                exit={{ scale: 0.5, rotate: 90 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                onClick={() => { if (sendHoldRef.current.long) { sendHoldRef.current.long = false; return; } handleTextSend(); }}
                onPointerDown={() => { if (editingMsg) return; sendHoldRef.current.long = false; clearTimeout(sendHoldRef.current.timer); sendHoldRef.current.timer = setTimeout(() => { sendHoldRef.current.long = true; openSchedule(); }, 500); }}
                onPointerUp={() => clearTimeout(sendHoldRef.current.timer)}
                onPointerLeave={() => clearTimeout(sendHoldRef.current.timer)}
                onContextMenu={(e) => { if (editingMsg) return; e.preventDefault(); openSchedule(); }}
                title={editingMsg ? 'Save edit' : 'Send · long-press to schedule'}
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 self-end active:scale-90 transition-colors ${editingMsg ? 'bg-brand-gold text-bg-dark' : 'bg-brand-violet text-white'}`}>
                <Icon name={editingMsg ? 'check' : 'send'} size={18} />
              </motion.button>
            ) : (
              <motion.button
                key={recordMode}
                initial={{ scale: 0.5 }}
                animate={{ scale: isRecording && !recordLocked ? 1.25 : 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                onPointerDown={(e) => {
                  if (isRecordingRef.current) return; // locked mode: tap handled on pointer up
                  e.preventDefault();
                  const mode = recordMode;
                  recordPtrStart.current = { x: e.clientX, y: e.clientY };
                  try { e.currentTarget.setPointerCapture(e.pointerId); } catch {/* ignore */}
                  const timer = setTimeout(() => handleRecordStart(mode), 300);
                  e.currentTarget._holdTimer = timer;
                }}
                onPointerMove={(e) => {
                  if (!isRecordingRef.current || recordLockedRef.current || !recordPtrStart.current) return;
                  const dx = e.clientX - recordPtrStart.current.x;
                  const dy = e.clientY - recordPtrStart.current.y;
                  setRecordDragX(Math.min(0, dx));
                  if (dx <= -80) { recordPtrStart.current = null; handleRecordCancel(); return; }
                  if (dy <= -70) {
                    recordPtrStart.current = null;
                    recordLockedRef.current = true;
                    lockReleasePendingRef.current = true;
                    setRecordLocked(true); setRecordDragX(0);
                  }
                }}
                onPointerUp={(e) => {
                  clearTimeout(e.currentTarget._holdTimer);
                  recordPtrStart.current = null;
                  if (isRecordingRef.current) {
                    if (lockReleasePendingRef.current) { lockReleasePendingRef.current = false; return; } // release after locking — keep recording
                    handleRecordStop(); // release-to-send, or tap-to-send when locked
                  } else {
                    setRecordMode(prev => prev === 'mic' ? 'camera' : 'mic'); // short tap toggles mode
                  }
                }}
                onPointerCancel={(e) => {
                  clearTimeout(e.currentTarget._holdTimer);
                  recordPtrStart.current = null;
                  if (isRecordingRef.current && !recordLockedRef.current) handleRecordStop();
                }}
                style={{ touchAction: 'none' }}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors shrink-0 self-end ${
                  isRecording
                    ? (recordLocked ? 'bg-brand-violet text-white' : 'bg-red-500 text-white border border-red-400')
                    : 'bg-surface-1/80 backdrop-blur-sm border border-white/[0.08] text-text-secondary hover:text-text-primary active:bg-brand-violet active:text-white active:border-brand-violet'
                }`}>
                <Icon name={isRecording && recordLocked ? 'send' : (recordMode === 'mic' ? 'mic' : 'videocam')} size={20} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </footer>

      {/* Floating scroll‑to‑bottom button */}
      <AnimatePresence>
        {showScrollButton && (
          <motion.button
            initial={{ scale: 0, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0, opacity: 0, y: 20 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            onClick={scrollToBottom}
            className="fixed bottom-20 right-4 z-50 w-9 h-9 rounded-full bg-surface-1 border border-white/[0.06] text-text-secondary flex items-center justify-center hover:text-text-primary active:scale-95 transition-colors"
            aria-label="Scroll to bottom"
          >
            <Icon name="arrow_downward" size={20} />
            {newBelow > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-violet text-white text-[10px] font-bold flex items-center justify-center border-2 border-bg-dark tabular-nums">
                {newBelow > 99 ? '99+' : newBelow}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {lightbox && <MediaLightbox items={lightboxItems} startIndex={lightbox.index} onClose={() => setLightbox(null)} />}
      {reactorsView && (
        <ReactorsSheet
          reactions={reactorsView.reactions}
          activeEmoji={reactorsView.emoji}
          resolveUser={resolveReactor}
          onClose={() => setReactorsView(null)}
        />
      )}
      {/* Auto-delete timer (Telegram durations). Server-side deletion is the
          relay's sweep; this only arms the timer on the conversation. */}
      {ttlSheetOpen && createPortal(
        <div className="fixed inset-0 z-[220] bg-black/60 flex items-end sm:items-center justify-center"
          onClick={() => setTtlSheetOpen(false)}>
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ y: '100%' }} animate={{ y: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className="w-full sm:max-w-sm bg-surface-1 border border-white/[0.08] rounded-t-2xl sm:rounded-2xl overflow-hidden"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            <div className="flex items-center gap-2 px-4 pt-4 pb-2">
              <Icon name="timer" size={18} className="text-brand-violet-light" />
              <span className="text-sm font-bold text-white">Auto-delete messages</span>
              <button onClick={() => setTtlSheetOpen(false)} className="ml-auto w-8 h-8 rounded-full bg-white/[0.06] text-text-secondary flex items-center justify-center">
                <Icon name="close" size={16} />
              </button>
            </div>
            <p className="px-4 pb-3 text-[11px] text-text-muted">
              New and existing messages in this chat are deleted for everyone once they reach this age.
            </p>
            <div className="pb-2">
              {TTL_OPTIONS.map((o) => (
                <button key={o.seconds} onClick={() => setChatTtl(o.seconds)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors">
                  <span className={`text-sm flex-1 ${chatTtl === o.seconds ? 'text-brand-violet-light font-bold' : 'text-text-primary'}`}>{o.label}</span>
                  {chatTtl === o.seconds && <Icon name="check" size={18} className="text-brand-violet-light" />}
                </button>
              ))}
            </div>
          </motion.div>
        </div>,
        document.body
      )}
      <ScheduleMessageSheet
        open={scheduleOpen}
        draftText={scheduleMedia ? scheduleMedia.caption : input.trim()}
        media={scheduleMedia}
        pending={scheduledMsgs}
        onSchedule={doSchedule}
        onCancel={cancelScheduled}
        onClose={() => { setScheduleOpen(false); setScheduleMedia(null); }}
      />
      {previewFile && (
        <MediaPreview
          file={previewFile}
          tier={tier}
          onSend={handleMediaSend}
          onSchedule={openScheduleMedia}
          scheduling={scheduleUploading}
          onCancel={() => setPreviewFile(null)}
        />
      )}
      {forwardMsg && <ForwardModal message={forwardMsg} onClose={() => setForwardMsg(null)} />}
      {showUserPicker && <UserPickerSheet title="Share a Vergr user" onSelect={handleUserPicked} onClose={() => setShowUserPicker(false)} />}
      {translateMsg && <TranslationSheet text={translateMsg.text} kind="message" onClose={() => setTranslateMsg(null)} />}
      <UpgradeModal isOpen={upgradeModal.open} onClose={() => setUpgradeModal({ open: false, requiredTier: 'lite', message: '' })}
        requiredTier={upgradeModal.requiredTier} message={upgradeModal.message} />

      {/* Delete Chat dialog — Telegram parity. 1:1 DMs get an "Also delete for
          {name}" checkbox; without it the delete is local-to-me (the chat
          stays intact for the other person and resurrects on a new message). */}
      {showDeleteDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-6"
          onClick={() => !deletingChat && setShowDeleteDialog(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-surface-1 border border-white/[0.06] p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}>
            <h3 className="font-syne text-lg font-bold text-text-primary">Delete chat?</h3>
            <p className="mt-1.5 text-sm text-text-secondary">
              This removes the chat from your inbox and clears its history on your devices.
            </p>
            {!chatInfo?.isGroup && (
              <label className="mt-4 flex items-center gap-3 cursor-pointer select-none">
                <input type="checkbox" checked={alsoDeleteForThem}
                  onChange={(e) => setAlsoDeleteForThem(e.target.checked)}
                  className="h-4 w-4 accent-brand-ember" />
                <span className="text-sm text-text-primary">
                  Also delete for <UserName user={otherUser} masked fallback={chatInfo?.metadata?.[otherUserId]?.name || 'them'} />
                </span>
              </label>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button disabled={deletingChat} onClick={() => setShowDeleteDialog(false)}
                className="px-4 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-2 transition-colors">Cancel</button>
              <button disabled={deletingChat}
                onClick={async () => {
                  if (deletingChat) return;
                  setDeletingChat(true);
                  try {
                    await clearLocalMessages?.();
                    if (!chatInfo?.isGroup && alsoDeleteForThem) {
                      await deleteChatForEveryone(chatId, otherUserId);
                    } else {
                      await deleteChatForMe(chatId);
                    }
                    navigate('/messages');
                  } catch {/* best effort */}
                  setDeletingChat(false);
                  setShowDeleteDialog(false);
                }}
                className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-brand-ember hover:bg-brand-ember/90 transition-colors disabled:opacity-50">
                {deletingChat ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attachment Menu Components */}
      <AttachmentMenu
        isOpen={showAttachmentMenu}
        onClose={() => setShowAttachmentMenu(false)}
        onGallery={() => document.getElementById(`media-up-${chatId}`).click()}
        onCamera={handleCamera}
        onFile={() => document.getElementById(`file-up-${chatId}`).click()}
        onLocation={handleLocation}
        onContact={handleContact}
        onMusic={handleMusic}
        onWallet={handleWallet}
        onSendTicket={handleSendTicket}
        onSendPoll={() => setShowPollSheet(true)}
        onLocked={handleLocked}
        onOneToOne={handleOneToOne}
        onPickedMedia={handlePickedMedia}
        anchorRef={attachBtnRef}
      />

      <input
        type="file"
        ref={lockedInputRef}
        onChange={onLockedFilePicked}
        className="hidden"
        accept="image/*,video/*"
        multiple
      />

      <PriceSheet
        open={lockedSheet}
        onClose={() => { setLockedSheet(false); setLockedFiles([]); }}
        onConfirm={sendLocked}
        items={lockedThumbs}
        onAddMore={pickLockedFiles}
        onRemoveItem={(i) => setLockedFiles((prev) => prev.filter((_, n) => n !== i))}
        allowSaveAsPack
        title="Lock this media"
        subtitle="They see a blurred preview and pay coins to open it. The real file never reaches their device until they do."
        confirmLabel="Send locked"
        allowFree={false}
        initialPrice={100}
      />

      <ContentPacksSheet
        open={packsSheet}
        onClose={() => setPacksSheet(false)}
        chatId={chatId}
        scope="conversation"
        onCreateNew={pickLockedFiles}
        // A pack send writes the message server-side. On the relay path the
        // list is built from frames and never reads that document, so the frame
        // is what actually appears — same contract as a fresh locked send.
        onSent={({ messageId, previewUrl }) => {
          if (relayEnabled) {
            hookSend({ id: messageId, type: 'locked', mediaKind: 'locked', contentUrl: previewUrl || '' });
          }
        }}
      />

      <ReportPrivate
        open={!!reportTarget}
        onClose={() => setReportTarget(null)}
        targetType="message"
        targetId={reportTarget ? `${reportTarget.chatId}:${reportTarget.messageId}` : ''}
        context={{ surface: 'locked_message', chatId: reportTarget?.chatId, messageId: reportTarget?.messageId, paid: true }}
        title="Report this media"
      />

      <ReportPrivate
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType={chatInfo?.isGroup ? 'message' : 'user'}
        targetId={chatInfo?.isGroup ? chatId : (otherUser?.id || chatId)}
        context={{ surface: chatInfo?.isGroup ? 'group_chat' : 'direct_message', chatId }}
        title={chatInfo?.isGroup ? 'Report this group' : 'Report this conversation'}
      />

      <PriceSheet
        open={oneToOneSheet}
        onClose={() => setOneToOneSheet(false)}
        onConfirm={startOneToOne}
        title="Start a 1:1"
        subtitle="You go live, just for them. It is never listed anywhere and only people in this chat can join. Tips and gifts work either way."
        confirmLabel="Go live"
        initialPaid={false}
        initialPrice={250}
        feeNote="What they pay to join is revenue Vergr earns, and Vergr pays you a share of it: 50% to start, rising to 80% as your lifetime earnings grow."
      />

      <EventPickerModal
        isOpen={showEventPicker}
        onClose={() => setShowEventPicker(false)}
        onSelect={handleEventSelected}
      />

      {showPollSheet && (
        <CreatePollSheet onClose={() => setShowPollSheet(false)} onCreate={handleCreatePoll} />
      )}

      <ContactSubMenu
        isOpen={showContactSubMenu}
        onClose={() => setShowContactSubMenu(false)}
        onShareVergrUser={handleShareVergrUser}
        onSharePhoneContact={handleSharePhoneContact}
      />

      <LocationSubMenu
        isOpen={showLocationSubMenu}
        onClose={() => setShowLocationSubMenu(false)}
        onCurrentLocation={handleCurrentLocation}
        onChooseOnMap={handleChooseOnMap}
      />

      {locationAsk && (
        <PermissionDisclosure
          {...DISCLOSURES.location}
          onCancel={() => setLocationAsk(false)}
          onAllow={() => {
            try { localStorage.setItem(LOCATION_ACK_KEY, "1"); } catch { /* private mode */ }
            setLocationAsk(false);
            openLocationMenu();
          }}
        />
      )}
      <LocationPickerModal
        isOpen={showLocationPicker}
        onClose={() => setShowLocationPicker(false)}
        onConfirm={handleLocationConfirm}
        apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
      />

      {/* DM "Wallet" = person-to-person GEM transfer (3%), NOT a tip. Tipping
          keeps SendCoinsModal on the profile, so stream/post tipping and the
          10% fee are untouched by this. */}
      <SendCoinsModal
        isOpen={showSendCoinsModal}
        onClose={() => setShowSendCoinsModal(false)}
        recipient={otherUser ? { id: otherUserId, ...otherUser } : null}
        // Drop a record of the tip into the thread (WhatsApp/Telegram show a
        // payment in-line), rendered by CoinCard. Amount + optional note ride
        // `contentUrl` (relay-safe); `text` is only the inbox preview. Profile/
        // stream tips pass no onSent, so this fires only for a DM tip.
        onSent={(amt, note) => sendMsg({ type: 'wallet', text: `Sent ${amt.toLocaleString()} coins`, wallet: { amount: amt, note: note || '' }, contentUrl: coinContentUrl(amt, note) })}
      />
    </div>
  );
}