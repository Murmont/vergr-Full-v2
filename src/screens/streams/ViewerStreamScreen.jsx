// ViewerStreamScreen — Phase 6 rebuild.
//
// Live HLS playback from cdn.vergr.app/streams/<streamKey>/index.m3u8.
// Real streams/{id} subscription drives title, host info, viewer count,
// boost badge, co-host roster. Chat panel = Phase 7 placeholder.
//
// Mobile portrait: WYSIWYG with source orientation.
//   - 9:16 source (mobile broadcaster) → fills phone screen.
//   - 16:9 source (desktop / OBS broadcaster) → letterboxed with a blurred
//     copy of the same frame as backdrop (TikTok pattern). Tap rotate icon
//     for true landscape fullscreen.
// Desktop: framed layout with right-side chat panel.
//
// Co-host visible: if coHostUids[] populated, an overlay card surfaces the
// co-host (avatar + name + tap-to-view-profile).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  doc, onSnapshot, updateDoc, increment as fsIncrement, getDoc,
  collection, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import HlsPlayer from '../../components/streams/HlsPlayer';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import VanguardPresence from '../../components/VanguardPresence';
import { getPlaybackUrl } from '../../utils/streamConfig';
import { followUser, unfollowUser, isFollowing, sendCoins, createPost } from '../../firebase/firestore';
import { uploadToR2 } from '../../utils/r2Storage';
import useStreamClipBuffer from '../../hooks/useStreamClipBuffer';
import JoinAnnouncer from '../../components/streams/JoinAnnouncer';
import UserQuickSheet from '../../components/streams/UserQuickSheet';
import ChatPanel from '../../components/streams/ChatPanel';
import TournamentOverlay from '../../components/streams/TournamentOverlay';
import PiPController from '../../components/streams/PiPController';
import ReactionsFloor from '../../components/streams/ReactionsFloor';
import NowPlayingCard from '../../components/streams/NowPlayingCard';
import HeartBurst from '../../components/primitives/HeartBurst';
import RollingNumber from '../../components/primitives/RollingNumber';
import { useStreamJoinEvents } from '../../hooks/useStreamJoinEvents';
import { haptic } from '../../utils/haptics';
import * as sfx from '../../utils/sfx';

const C = {
  bg: '#0a0a14',
  card: '#12121e',
  cardSoft: '#0f0f1a',
  border: 'rgba(255,255,255,0.09)',
  text: '#e8e8f0',
  textDim: '#a0a0b8',
  textMuted: '#6b7280',
  purple: '#7c3aed',
  purpleLight: '#b44fff',
  purpleSoft: 'rgba(124,58,237,0.18)',
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  divider: 'rgba(255,255,255,0.06)',
};

export default function ViewerStreamScreen() {
  const { streamId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isDesktop } = useResponsive();

  const videoElRef = useRef(null);
  const presenceAppliedRef = useRef(false);

  const [streamDoc, setStreamDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hostInfo, setHostInfo] = useState(null);
  // coHostTiles unify two sources:
  //   - coHostUids[] (publishers in this stream's ingest room — no own stream URL)
  //   - linkedStreamIds[] (TikTok Multi-Guest partners — have their own stream URL,
  //     tapping switches viewer + viewerCount over)
  // Each tile: { uid, displayName, avatar, switchToStreamId? }
  const [coHostTiles, setCoHostTiles] = useState([]);
  const [followed, setFollowed] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const [tipAmount, setTipAmount] = useState(50);
  const [tipMessage, setTipMessage] = useState('');
  const [tipping, setTipping] = useState(false);
  const [sourceAspect, setSourceAspect] = useState(16 / 9); // detected from <video>
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Quick-action sheet for inspecting another streamer (Multi-Guest partner,
  // chat message tap, @mention, etc.). { uid, streamId } when open.
  const [quickSheet, setQuickSheet] = useState(null);

  // Heart-burst: double-tap viewport spawns hearts at tap point.
  const [heartBurst, setHeartBurst] = useState({ tick: 0, x: '50%', y: '50%' });
  const lastTapRef = useRef(0);
  // HUD visibility — single tap toggles. While visible we auto-hide after 4s
  // of inactivity, matching TikTok / native fullscreen video conventions.
  const [hudVisible, setHudVisible] = useState(true);
  const hudTimerRef = useRef(0);
  const bumpHud = (force = null) => {
    setHudVisible((cur) => force != null ? force : true);
    clearTimeout(hudTimerRef.current);
    hudTimerRef.current = setTimeout(() => setHudVisible(false), 4000);
  };
  useEffect(() => () => clearTimeout(hudTimerRef.current), []);
  // ESC exits the immersive view (mobile fullscreen, desktop fullscreen).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (fullscreen) setFullscreen(false);
        else navigate(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, navigate]);
  // Reaction events for the floating emoji floor.
  const [reactions, setReactions] = useState([]);
  const reactionIdRef = useRef(0);
  // Per-viewer rate limit: at most one server-side reaction every 1s.
  // The visual emoji burst on the viewer's own screen still fires every tap
  // (it's local-only), so the UX feels responsive — only the broadcaster
  // HypeMeter ping is debounced.
  const lastReactionAtRef = useRef(0);
  const onReactionTap = (em) => {
    reactionIdRef.current += 1;
    const id = reactionIdRef.current;
    setReactions((prev) => [...prev, { id, emoji: em }]);
    haptic.light();
    // Garbage-collect after the float-up animation finishes (~2.4s).
    setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 2600);

    // Push to the server-side hype aggregator so the broadcaster's HypeMeter
    // (BroadcasterScreen) reflects the crowd. Fire-and-forget — failures are
    // silent on purpose (no toast spam for a viewer-only nicety).
    const now = Date.now();
    if (streamId && now - lastReactionAtRef.current >= 1000) {
      lastReactionAtRef.current = now;
      (async () => {
        try {
          const { getFunctions, httpsCallable } = await import('firebase/functions');
          await httpsCallable(getFunctions(undefined, 'europe-west1'), 'recordStreamReaction')({ streamId });
        } catch {
          // intentional: never bother the viewer if hype write fails
        }
      })();
    }
  };

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  // ── Subscribe to stream doc ────────────────────────────────
  useEffect(() => {
    if (!streamId) return;
    const unsub = onSnapshot(doc(db, 'streams', streamId), (snap) => {
      setLoading(false);
      setStreamDoc(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    }, () => setLoading(false));
    return unsub;
  }, [streamId]);

  // ── Resolve host + co-host profiles ────────────────────────
  useEffect(() => {
    if (!streamDoc?.hostUid) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', streamDoc.hostUid));
        if (!cancelled && snap.exists()) setHostInfo({ id: snap.id, ...snap.data() });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [streamDoc?.hostUid]);

  useEffect(() => {
    const publisherUids = streamDoc?.coHostUids || [];
    const linkedStreamIds = streamDoc?.linkedStreamIds || [];
    if (!publisherUids.length && !linkedStreamIds.length) {
      setCoHostTiles([]);
      return;
    }
    let cancelled = false;
    (async () => {
      // Publishers (no own stream URL — tap goes to profile).
      const pub = await Promise.all(publisherUids.map(async (uid) => {
        const s = await getDoc(doc(db, 'users', uid)).catch(() => null);
        return s?.exists() ? { uid, ...s.data(), switchToStreamId: null } : null;
      }));
      // Linked Multi-Guest partners (their own stream — tap switches view).
      const linked = await Promise.all(linkedStreamIds.map(async (sid) => {
        const ss = await getDoc(doc(db, 'streams', sid)).catch(() => null);
        if (!ss?.exists()) return null;
        const sd = ss.data();
        const u = await getDoc(doc(db, 'users', sd.hostUid)).catch(() => null);
        return u?.exists()
          ? { uid: sd.hostUid, ...u.data(), switchToStreamId: sid }
          : null;
      }));
      const merged = [...pub, ...linked].filter(Boolean);
      if (!cancelled) setCoHostTiles(merged);
    })();
    return () => { cancelled = true; };
  }, [streamDoc?.coHostUids, streamDoc?.linkedStreamIds]);

  // ── Presence: increment viewerCount on mount, decrement on unmount ─
  useEffect(() => {
    if (!streamDoc?.id || !currentUser || streamDoc.hostUid === currentUser.uid) return;
    if (presenceAppliedRef.current) return;
    presenceAppliedRef.current = true;
    const ref = doc(db, 'streams', streamDoc.id);
    updateDoc(ref, { viewerCount: fsIncrement(1) }).catch(() => {});
    return () => {
      updateDoc(ref, { viewerCount: fsIncrement(-1) }).catch(() => {});
      presenceAppliedRef.current = false;
    };
  }, [streamDoc?.id, currentUser?.uid, streamDoc?.hostUid]);

  // ── Follow state + write join event if follower/subscriber ─
  // Plain (non-follower) joins do NOT write — they appear as system "joined"
  // lines in chat (Phase 7 WS relay emits them). Keeps Firestore writes low.
  const joinAnnouncedRef = useRef(false);
  useEffect(() => {
    if (!currentUser?.uid || !streamDoc?.hostUid || !streamDoc?.id) return;
    if (currentUser.uid === streamDoc.hostUid) return;
    isFollowing(currentUser.uid, streamDoc.hostUid).then(async (isFollower) => {
      setFollowed(isFollower);
      if (!isFollower || joinAnnouncedRef.current) return;
      joinAnnouncedRef.current = true;
      // Detect a paying subscriber tier from the viewer's own profile.
      // Subscription doc shape: profile.subscription = { tier: 'lite' | 'pro' } or string.
      let kind = 'follower';
      let tier = null;
      const sub = profile?.subscription;
      const subTier = typeof sub === 'string' ? sub : sub?.tier;
      if (subTier && subTier !== 'free') {
        // Note: this is the viewer's own subscription, not a per-creator membership.
        // Per-creator memberships will be wired when fanship.js ships.
        kind = 'subscriber';
        tier = subTier;
      }
      try {
        await addDoc(collection(db, 'streams', streamDoc.id, 'joins'), {
          uid: currentUser.uid,
          displayName: profile?.displayName || profile?.username || null,
          avatar: profile?.avatar || null,
          kind, tier,
          ts: serverTimestamp(),
          // Client-side ts fallback for fast local read (server stamp arrives ~50ms later).
          clientTs: Date.now(),
        });
      } catch (err) { /* non-fatal */ }
    }).catch(() => {});
  }, [currentUser?.uid, streamDoc?.hostUid, streamDoc?.id, profile?.subscription]);

  // Live join events to feed the JoinAnnouncer.
  const rawJoinEvents = useStreamJoinEvents(streamDoc?.id);
  const joinEvents = useMemo(() => rawJoinEvents.map((e) => ({
    id: e.id,
    kind: e.kind,
    tier: e.tier,
    user: { uid: e.uid, displayName: e.displayName, avatar: e.avatar },
  })), [rawJoinEvents]);

  const toggleFollow = async () => {
    if (followBusy || !currentUser?.uid || !streamDoc?.hostUid) return;
    setFollowBusy(true);
    try {
      if (followed) {
        await unfollowUser(currentUser.uid, streamDoc.hostUid);
        setFollowed(false);
      } else {
        await followUser(currentUser.uid, streamDoc.hostUid);
        setFollowed(true);
      }
    } catch (err) {
      showToast(err?.message || 'Could not update follow', 'error');
    } finally {
      setFollowBusy(false);
    }
  };

  const sendTip = async () => {
    if (tipping || !currentUser?.uid || !streamDoc?.hostUid) return;
    const amt = Math.max(1, Math.floor(tipAmount));
    setTipping(true);
    try {
      let finalMessage = tipMessage.trim();
      // If viewer didn't type, fall back to the highest matching catalog entry.
      if (!finalMessage && Array.isArray(hostInfo?.tipCatalog)) {
        const suggested = hostInfo.tipCatalog
          .filter((e) => amt >= e.minCoins)
          .sort((a, b) => b.minCoins - a.minCoins)[0];
        if (suggested) finalMessage = suggested.message;
      }
      // Any user-typed (non-catalog) message goes through Gemini before send.
      // Catalog entries were moderated at save time so we skip re-checking those.
      const isCustomMessage = finalMessage && finalMessage !== '' && finalMessage === tipMessage.trim();
      if (isCustomMessage) {
        const { getFunctions, httpsCallable } = await import('firebase/functions');
        const mod = httpsCallable(getFunctions(undefined, 'europe-west1'), 'moderateChatMessage');
        const { data } = await mod({ text: finalMessage, surface: 'tip', surfaceId: streamDoc.id });
        if (data?.verdict === 'block') {
          showToast(`Message blocked: ${data.reason || 'policy'}`, 'error');
          setTipping(false);
          return;
        }
      }
      const desc = finalMessage
        ? `Tip · ${streamDoc.title || 'live'} · "${finalMessage}"`
        : `Tip · ${streamDoc.title || 'live'}`;
      await sendCoins(currentUser.uid, streamDoc.hostUid, amt, desc);
      haptic.success();
      showToast(`Tipped ${amt} coins`, 'success');
      setTipMessage('');
      setShowTip(false);
    } catch (err) {
      showToast(err?.message || 'Tip failed', 'error');
    } finally {
      setTipping(false);
    }
  };

  // Detect source aspect ratio whenever the player gets metadata.
  const onVideoMeta = (e) => {
    const el = e?.currentTarget || videoElRef.current;
    if (!el?.videoWidth || !el?.videoHeight) return;
    setSourceAspect(el.videoWidth / el.videoHeight);
  };

  // Tap on viewport: single tap toggles HUD; double tap (within 350ms) spawns
  // a heart burst at the tap point. Hearts increment a stream counter that
  // becomes part of the host's lifetime `totalLikes` on stream end.
  const lastHeartWriteRef = useRef(0);
  const pendingTapTimerRef = useRef(0);
  const onViewportTap = (e) => {
    const now = Date.now();
    const since = now - lastTapRef.current;
    lastTapRef.current = now;
    if (since > 0 && since < 350) {
      // Double tap → heart burst.
      clearTimeout(pendingTapTimerRef.current);
      const rect = e.currentTarget.getBoundingClientRect();
      const clientX = e.touches?.[0]?.clientX ?? e.clientX;
      const clientY = e.touches?.[0]?.clientY ?? e.clientY;
      const x = clientX != null ? clientX - rect.left : rect.width / 2;
      const y = clientY != null ? clientY - rect.top : rect.height / 2;
      setHeartBurst({ tick: heartBurst.tick + 1, x, y });
      haptic.light();
      sfx.play('heart', { volume: 0.6 });
      if (streamDoc?.id && now - lastHeartWriteRef.current > 800) {
        lastHeartWriteRef.current = now;
        updateDoc(doc(db, 'streams', streamDoc.id), { hearts: fsIncrement(1) }).catch(() => {});
      }
    } else {
      // Single tap → toggle HUD after a brief delay (so a follow-up tap can
      // resolve as a double-tap heart instead of HUD flipping in/out).
      pendingTapTimerRef.current = setTimeout(() => {
        setHudVisible((v) => !v);
      }, 360);
    }
  };

  // Playback URL: prefer the server-side composite when streams are linked
  // (vergr-cohost renders 1-4 publishers into one HLS stream). Falls back to
  // this stream's own solo HLS. Viewer always fetches ONE feed — 1× bandwidth
  // regardless of how many streamers are visible on screen.
  const playbackUrl = streamDoc?.compositeHlsUrl
    || (streamDoc?.streamKey ? getPlaybackUrl(streamDoc.streamKey) : null);

  // ── In-stream clip capture: rolling buffer → R2 → user-owned clip post ──
  // Tier gates: Free 30s/3, Lite 60s/5, Pro 90s/unlimited per stream session.
  const viewerTier = (() => {
    const sub = profile?.subscription;
    const t = typeof sub === 'string' ? sub : sub?.tier;
    return t === 'pro' || t === 'lite' ? t : 'free';
  })();
  const CLIP_TIER = { free: { sec: 30, max: 3 }, lite: { sec: 60, max: 5 }, pro: { sec: 90, max: Infinity } };
  const clipCfg = CLIP_TIER[viewerTier];
  const { grab: grabClip, isSupported: clipSupported } = useStreamClipBuffer(videoElRef, { enabled: !!playbackUrl });
  const [clipsUsed, setClipsUsed] = useState(0);
  const [clipping, setClipping] = useState(false);

  const handleClip = async () => {
    if (clipping || !currentUser?.uid) return;
    if (!clipSupported()) { showToast('Clipping is not supported in this browser', 'info'); return; }
    if (clipsUsed >= clipCfg.max) { showToast(`Clip limit reached (${clipCfg.max} per stream on ${viewerTier})`, 'info'); return; }
    const blob = grabClip(clipCfg.sec);
    if (!blob || blob.size < 50_000) { showToast('Need a few more seconds of footage — try again shortly', 'info'); return; }
    setClipping(true);
    try {
      const file = new File([blob], `clip-${Date.now()}.webm`, { type: 'video/webm' });
      const url = await uploadToR2(file, 'clip');
      await createPost(currentUser.uid, {
        content: streamDoc?.title ? `Clip · ${streamDoc.title}` : 'Live clip',
        type: 'clip',
        mediaUrls: [url],
        hashtags: streamDoc?.game ? [String(streamDoc.game).toLowerCase()] : [],
        visibility: 'public',
      });
      setClipsUsed((n) => n + 1);
      showToast('Clip saved to your profile', 'success');
    } catch (err) {
      showToast(err?.message || 'Clip failed', 'error');
    } finally { setClipping(false); }
  };

  // Linked streams (for the tap-to-switch overlay tiles on top of the
  // composite). Each entry resolves to the OTHER streamer's stream id so
  // tapping navigates to /watch/<their-id> and their viewerCount goes +1.
  const [linkedStreamDocs, setLinkedStreamDocs] = useState([]);
  useEffect(() => {
    const ids = streamDoc?.linkedStreamIds || [];
    if (!ids.length) { setLinkedStreamDocs([]); return; }
    let cancelled = false;
    const unsubs = ids.map((sid) => onSnapshot(doc(db, 'streams', sid), (snap) => {
      if (cancelled) return;
      const data = snap.exists() ? { id: snap.id, ...snap.data() } : null;
      setLinkedStreamDocs((prev) => {
        const next = prev.filter((s) => s.id !== sid);
        if (data && data.status === 'live') next.push(data);
        return next;
      });
    }));
    return () => { cancelled = true; unsubs.forEach((u) => u && u()); };
  }, [streamDoc?.linkedStreamIds?.join('|')]);

  // ─────────────────────────────────────────────────────────────
  // Guard rails.
  // ─────────────────────────────────────────────────────────────
  if (loading) return <Centered label="Loading stream…" />;
  if (!streamDoc) return <Centered label="Stream not found." action={{ label: 'Browse live', onClick: () => navigate('/') }}/>;
  if (streamDoc.status === 'ended') {
    return <Centered label="This stream has ended." action={{ label: 'Browse live', onClick: () => navigate('/') }}/>;
  }
  if (streamDoc.status === 'created') {
    return <Centered label="Stream hasn't started yet." action={{ label: 'Refresh', onClick: () => window.location.reload() }}/>;
  }

  const isTouchPhone = typeof window !== 'undefined' &&
    window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
  const mobile = !isDesktop || isTouchPhone;
  // Multi-Guest mode: server-side composite is delivered as a single video.
  // We just overlay tap-to-switch zones for each linked streamer.
  const isMultiGuest = linkedStreamDocs.length > 0;

  // ─────────────────────────────────────────────────────────────
  // Mobile portrait: WYSIWYG with source orientation.
  // ─────────────────────────────────────────────────────────────
  if (mobile && !fullscreen) {
    // Portrait source → fill screen. Landscape → letterbox + blurred backdrop.
    const sourceIsPortrait = sourceAspect < 1;
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#000', overflow: 'hidden',
        color: C.text, fontFamily: '"Inter", system-ui, sans-serif',
      }}>
        {!isMultiGuest && !sourceIsPortrait && playbackUrl && (
          // Solo landscape on portrait phone → blurred backdrop fills dead space.
          <div style={{
            position: 'absolute', inset: 0, overflow: 'hidden',
            filter: 'blur(34px) brightness(0.55)', transform: 'scale(1.2)',
          }}>
            <HlsPlayer src={playbackUrl} controls={false} muted autoPlay className="w-full h-full"/>
          </div>
        )}
        <div onClick={onViewportTap} style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {playbackUrl ? (
            <HlsPlayerWithMeta
              src={playbackUrl}
              controls={false}
              muted={muted}
              autoPlay
              onMeta={onVideoMeta}
              style={{
                width: '100%', height: sourceIsPortrait ? '100%' : 'auto',
                maxHeight: '100%', objectFit: 'contain',
              }}
              videoElRef={videoElRef}
            />
          ) : (
            <div style={{ color: C.textDim, fontSize: 12 }}>Waiting for stream…</div>
          )}
          <HeartBurst trigger={heartBurst.tick} originX={heartBurst.x} originY={heartBurst.y} />
          {streamDoc?.hostUid && (
            <TournamentOverlay hostUid={streamDoc.hostUid} position="top-left" />
          )}
          {isMultiGuest && (
            <MultiGuestOverlay
              partners={linkedStreamDocs}
              currentStreamId={streamDoc.id}
              compositeOwner={streamDoc.compositeOwner}
              onSwitch={(targetId) => navigate(`/watch/${targetId}`)}
              onInspect={(partner) => setQuickSheet({ uid: partner.hostUid, streamId: partner.id })}
            />
          )}
        </div>

        {/* Top overlay (HUD — fades out on tap) */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          padding: '10px 12px',
          background: 'linear-gradient(180deg, rgba(0,0,0,0.7), transparent)',
          display: 'flex', alignItems: 'center', gap: 8,
          opacity: hudVisible ? 1 : 0,
          pointerEvents: hudVisible ? 'auto' : 'none',
          transition: 'opacity 0.22s ease-out',
        }}>
          <button onClick={() => navigate(-1)} style={iconBtn}>
            <Icon name="arrow_back" size={18} className=""/>
          </button>
          <UserAvatar src={hostInfo?.avatar} size="sm"/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {hostInfo?.displayName || hostInfo?.username || 'Live'}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.8)' }}>
              <span style={{ color: C.red, fontWeight: 800 }}>● LIVE</span>
              {' · '}
              <RollingNumber value={streamDoc.viewerCount || 0} />
              {' watching'}
            </div>
          </div>
          {streamDoc.boosted && (
            <span style={pillSm({ background: 'rgba(245,158,11,0.85)' })}>BOOSTED</span>
          )}
        </div>
        {/* Now-playing card — appears just under the header when host has
            Spotify connected AND a track is playing. */}
        {streamDoc.nowPlaying?.title && (
          <div style={{
            position: 'absolute', top: 60, left: 12, zIndex: 4,
            opacity: hudVisible ? 1 : 0,
            pointerEvents: hudVisible ? 'auto' : 'none',
            transition: 'opacity 0.22s ease-out',
          }}>
            <NowPlayingCard nowPlaying={streamDoc.nowPlaying} compact />
          </div>
        )}

        {/* Multi-Guest tiles are rendered inline in the grid above; no
            separate overlay needed. Each tile is itself tappable to switch. */}

        {/* Right action rail (HUD — fades out on tap) */}
        <div style={{
          position: 'absolute', right: 8, bottom: 110,
          display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center',
          opacity: hudVisible ? 1 : 0,
          pointerEvents: hudVisible ? 'auto' : 'none',
          transition: 'opacity 0.22s ease-out',
        }}>
          <ActionPill icon={muted ? 'volume_off' : 'volume_up'} onClick={() => setMuted((v) => !v)}/>
          <ActionPill icon="paid" label="Tip" onClick={() => setShowTip(true)}/>
          <ActionPill icon={followed ? 'check' : 'person_add'} label={followed ? 'Following' : 'Follow'} onClick={toggleFollow} disabled={followBusy}/>
          <ActionPill icon="chat" onClick={() => showToast('Chat opens with Phase 7 relay', 'info')}/>
          <ActionPill icon="content_cut" label={clipping ? 'Saving…' : 'Clip'} onClick={handleClip} disabled={clipping}/>
          <ActionPill icon="share" onClick={() => {
            navigator.share?.({ url: window.location.href, title: 'Watch live on VERGR' })
              .catch(() => navigator.clipboard?.writeText(window.location.href).then(() =>
                showToast('Link copied', 'success')));
          }}/>
          <ActionPill icon="fullscreen" onClick={() => setFullscreen(true)}/>
        </div>

        {/* Bottom title strip (HUD — fades out on tap) */}
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          padding: '12px 64px 18px 12px',
          background: 'linear-gradient(0deg, rgba(0,0,0,0.8), transparent)',
          fontSize: 13, fontWeight: 700, lineHeight: 1.4,
          opacity: hudVisible ? 1 : 0,
          pointerEvents: hudVisible ? 'auto' : 'none',
          transition: 'opacity 0.22s ease-out',
        }}>
          {streamDoc.title}
          {streamDoc.game && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>
              {streamDoc.game}
            </div>
          )}
        </div>

        {showTip && (
          <TipModal
            amount={tipAmount}
            setAmount={setTipAmount}
            message={tipMessage}
            setMessage={setTipMessage}
            onClose={() => setShowTip(false)}
            onSend={sendTip}
            sending={tipping}
            host={hostInfo}
            tipCatalog={hostInfo?.tipCatalog}
          />
        )}
        <ReactionsFloor events={reactions} onTapEmoji={onReactionTap} position="right" />
        <JoinAnnouncer events={joinEvents} side="right" />
        <UserQuickSheet
          open={!!quickSheet}
          uid={quickSheet?.uid}
          watchLiveStreamId={quickSheet?.streamId}
          onClose={() => setQuickSheet(null)}
        />
        <VanguardPresence parentPath={`streams/${streamDoc.id}`} />
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Fullscreen mode (mobile rotate-to-landscape OR desktop).
  // ─────────────────────────────────────────────────────────────
  if (fullscreen) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#000', zIndex: 95,
        display: 'flex', flexDirection: 'column',
        color: C.text, fontFamily: '"Inter", system-ui, sans-serif',
      }}>
        <div style={{ flex: 1, minHeight: 0 }}>
          {playbackUrl ? (
            <HlsPlayerWithMeta
              src={playbackUrl}
              controls
              muted={muted}
              autoPlay
              onMeta={onVideoMeta}
              style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
              videoElRef={videoElRef}
            />
          ) : (
            <Centered label="Waiting for stream…" />
          )}
          {isMultiGuest && (
            <MultiGuestOverlay
              partners={linkedStreamDocs}
              currentStreamId={streamDoc.id}
              compositeOwner={streamDoc.compositeOwner}
              onSwitch={(targetId) => navigate(`/watch/${targetId}`)}
              onInspect={(partner) => setQuickSheet({ uid: partner.hostUid, streamId: partner.id })}
            />
          )}
        </div>
        <div style={{
          position: 'absolute', top: 10, left: 10, display: 'flex', gap: 8,
        }}>
          <button onClick={() => setFullscreen(false)} style={pillBtn}>
            <Icon name="fullscreen_exit" size={14} className=""/>
            Exit fullscreen
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Desktop layout — framed video + chat right panel.
  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{
      background: C.bg, minHeight: '100%', color: C.text,
      fontFamily: '"Inter", system-ui, sans-serif',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 340px',
        minHeight: 'calc(100vh - 0px)',
      }}>
        {/* MAIN */}
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {/* Desktop exit row — TikTok-style explicit exit, plus ESC works too. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => navigate(-1)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 99, border: `1px solid ${C.border}`,
              background: 'transparent', color: C.textDim,
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>
              <Icon name="arrow_back" size={14} className=""/>
              Exit live
            </button>
            <span style={{ fontSize: 10, color: C.textMuted }}>
              press <kbd style={{ padding: '1px 6px', border: `1px solid ${C.border}`,
                borderRadius: 4, fontFamily: 'DM Mono, monospace', fontSize: 10 }}>ESC</kbd> to exit
            </span>
          </div>
          <div style={{
            position: 'relative', background: '#000',
            border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden',
            aspectRatio: '16/9',
          }}>
            {playbackUrl ? (
              <HlsPlayerWithMeta
                src={playbackUrl}
                controls
                muted={muted}
                autoPlay
                onMeta={onVideoMeta}
                style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                videoElRef={videoElRef}
              />
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center', color: C.textDim, fontSize: 13 }}>
                Waiting for stream…
              </div>
            )}
            <div style={{
              position: 'absolute', top: 12, left: 12,
              display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
            }}>
              <span style={pillSm({ background: C.red })}>● LIVE</span>
              {streamDoc.boosted && <span style={pillSm({ background: C.amber, color: '#000' })}>BOOSTED</span>}
              {streamDoc.nowPlaying?.title && (
                <NowPlayingCard nowPlaying={streamDoc.nowPlaying} compact />
              )}
            </div>
            <div style={{
              position: 'absolute', top: 12, right: 12,
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '3px 10px', background: 'rgba(0,0,0,0.55)', borderRadius: 99,
              fontSize: 11, fontWeight: 700, color: '#fff',
            }}>
              <Icon name="visibility" size={12} className=""/>
              <RollingNumber value={streamDoc.viewerCount || 0} />
            </div>
            <div style={{
              position: 'absolute', bottom: 12, right: 12, display: 'flex', gap: 6,
            }}>
              <PiPController videoElRef={videoElRef} title={streamDoc.title}/>
              <button onClick={() => setFullscreen(true)} style={{
                padding: '5px 10px', borderRadius: 6, border: 'none',
                background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 11, fontWeight: 700,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <Icon name="fullscreen" size={12} className=""/>
                Fullscreen
              </button>
            </div>
          </div>

          {/* Compact "also linked" rail under the grid for desktop —
              redundant with the in-grid tap-to-watch labels but useful as
              a quick scan. */}
          {coHostTiles.length > 0 && !isMultiGuest && (
            <div style={{
              display: 'flex', gap: 8, padding: 10, background: C.card,
              border: `1px solid ${C.border}`, borderRadius: 10,
            }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.textDim, alignSelf: 'center' }}>ALSO ON STREAM</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                {coHostTiles.map((u) => (
                  <button key={u.uid} onClick={() => u.switchToStreamId
                    ? navigate(`/watch/${u.switchToStreamId}`)
                    : navigate(`/u/${u.username || u.uid}`)}
                    title={u.switchToStreamId ? 'Watch their stream' : 'View profile'}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 10px', borderRadius: 99,
                      background: C.cardSoft, border: `1px solid ${C.border}`,
                      color: C.text, cursor: 'pointer', fontSize: 12,
                    }}>
                    <UserAvatar src={u.avatar} size="xs"/>
                    {u.displayName || u.username}
                    {u.switchToStreamId && (
                      <span style={{
                        fontSize: 9, fontWeight: 800, color: C.green,
                        padding: '1px 6px', background: 'rgba(34,197,94,0.15)',
                        border: `1px solid rgba(34,197,94,0.4)`, borderRadius: 99,
                      }}>● LIVE</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Host bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: 14, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
          }}>
            <UserAvatar src={hostInfo?.avatar} size="md"/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>
                {hostInfo?.displayName || hostInfo?.username || 'Host'}
              </div>
              <div style={{ fontSize: 12, color: C.textDim, whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {streamDoc.title}{streamDoc.game ? ` · ${streamDoc.game}` : ''}
              </div>
            </div>
            <button onClick={toggleFollow} disabled={followBusy || currentUser?.uid === streamDoc.hostUid}
              style={{
                padding: '8px 14px', borderRadius: 8,
                background: followed ? 'transparent' : `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
                border: followed ? `1px solid ${C.border}` : 'none',
                color: followed ? C.textDim : '#fff',
                fontSize: 12, fontWeight: 800, cursor: 'pointer',
                opacity: followBusy ? 0.6 : 1,
              }}>
              {followed ? 'Following' : 'Follow'}
            </button>
            <button onClick={() => setShowTip(true)}
              disabled={currentUser?.uid === streamDoc.hostUid}
              style={{
                padding: '8px 14px', borderRadius: 8,
                background: 'transparent', border: `1px solid ${C.amber}`,
                color: C.amber, fontSize: 12, fontWeight: 800, cursor: 'pointer',
              }}>
              <Icon name="paid" size={14} className=""/> Tip
            </button>
          </div>
        </div>

        {/* RIGHT chat panel */}
        <ChatPanel streamId={streamDoc.id} layout="side" hostUid={streamDoc.hostUid} />
      </div>

      <VanguardPresence parentPath={`streams/${streamDoc.id}`} />
      <JoinAnnouncer events={joinEvents} side="right" />
      <UserQuickSheet
        open={!!quickSheet}
        uid={quickSheet?.uid}
        watchLiveStreamId={quickSheet?.streamId}
        onClose={() => setQuickSheet(null)}
      />

      {showTip && (
        <TipModal
          amount={tipAmount}
          setAmount={setTipAmount}
          message={tipMessage}
          setMessage={setTipMessage}
          onClose={() => setShowTip(false)}
          onSend={sendTip}
          sending={tipping}
          host={hostInfo}
          tipCatalog={hostInfo?.tipCatalog}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────

/** MultiGuestOverlay — invisible tap zones placed over each partner's slot
    in the composite frame. Click a partner's region of the video → navigate
    to their stream. No pills, no buttons, no chrome — you tap on the person
    you want to watch.
    Long-press / right-click opens the quick sheet (inspect / follow) without
    switching. Slot layout matches vergr-cohost xstack exactly:
       n=2: [0_0 | w0_0]            → slot 0 left half, slot 1 right half
       n=3: [0_0 | w0_0 | w0+w1_0]  → three columns (padded centered to 1280)
       n=4: 2×2                      → slot 0 TL, 1 TR, 2 BL, 3 BR
    Slot 0 is the composite owner (their stream initiated the merge). */
function MultiGuestOverlay({ partners, currentStreamId, compositeOwner, onSwitch, onInspect }) {
  // Resolve slot order. Slot 0 = compositeOwner. Remaining slots fill from
  // partners[] in their linkedStreamIds order (deterministic insertion).
  const slots = [];
  // First, slot 0:
  if (compositeOwner === currentStreamId) {
    slots.push({ streamId: currentStreamId, isSelf: true });
  } else {
    // Slot 0 is whichever partner IS the composite owner.
    const ownerPartner = partners.find((p) => p.id === compositeOwner);
    if (ownerPartner) slots.push({ streamId: ownerPartner.id, isSelf: false, partner: ownerPartner });
  }
  // Then fill remaining slots with the rest, ensuring our own stream is included.
  for (const p of partners) {
    if (slots.find((s) => s.streamId === p.id)) continue;
    slots.push({ streamId: p.id, isSelf: false, partner: p });
  }
  if (!slots.find((s) => s.isSelf)) {
    slots.push({ streamId: currentStreamId, isSelf: true });
  }
  const n = slots.length;

  // Compute rect for each slot as % of the composite frame.
  const rectFor = (i) => {
    if (n === 1) return { left: '0%', top: '0%', width: '100%', height: '100%' };
    if (n === 2) return {
      left: i === 0 ? '0%' : '50%', top: '0%', width: '50%', height: '100%',
    };
    if (n === 3) {
      // Three tiles padded centered in 1280×720; each tile 426/1280 = 33.28%
      // with ~1.5% padding on each side.
      const w = 100 / 3;
      return { left: `${i * w}%`, top: '0%', width: `${w}%`, height: '100%' };
    }
    // n === 4: 2×2 grid
    const col = i % 2;
    const row = Math.floor(i / 2);
    return { left: col === 0 ? '0%' : '50%', top: row === 0 ? '0%' : '50%', width: '50%', height: '50%' };
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3,
    }}>
      {slots.map((slot, i) => {
        const r = rectFor(i);
        return (
          <SlotTapZone
            key={slot.streamId}
            isSelf={slot.isSelf}
            rect={r}
            partner={slot.partner}
            onTap={() => !slot.isSelf && onSwitch(slot.streamId)}
            onLongPress={() => !slot.isSelf && onInspect?.(slot.partner)}
          />
        );
      })}
    </div>
  );
}

function SlotTapZone({ isSelf, rect, partner, onTap, onLongPress }) {
  const [host, setHost] = useState(null);
  const [hover, setHover] = useState(false);
  const pressTimerRef = useRef(null);

  useEffect(() => {
    if (isSelf || !partner?.hostUid) return;
    let cancelled = false;
    getDoc(doc(db, 'users', partner.hostUid)).then((s) => {
      if (!cancelled && s.exists()) setHost({ id: s.id, ...s.data() });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isSelf, partner?.hostUid]);

  const startPress = () => {
    clearTimeout(pressTimerRef.current);
    pressTimerRef.current = setTimeout(() => {
      onLongPress?.();
      pressTimerRef.current = null;
    }, 550);
  };
  const endPress = (fire) => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
      if (fire) onTap?.();
    }
    // If the timer already fired (long-press triggered), don't fire tap.
  };

  return (
    <div
      onPointerDown={startPress}
      onPointerUp={() => endPress(true)}
      onPointerLeave={() => endPress(false)}
      onContextMenu={(e) => { e.preventDefault(); onLongPress?.(); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'absolute',
        left: rect.left, top: rect.top, width: rect.width, height: rect.height,
        pointerEvents: isSelf ? 'none' : 'auto',
        cursor: isSelf ? 'default' : 'pointer',
        // Subtle hover affordance on desktop so users know the region is interactive.
        boxShadow: hover && !isSelf ? 'inset 0 0 0 2px rgba(124,58,237,0.55)' : 'none',
        transition: 'box-shadow 0.18s ease-out',
      }}
    >
      {/* Bottom-left name label (no chrome). Hidden on the self slot. */}
      {!isSelf && host && (
        <div style={{
          position: 'absolute', left: 10, bottom: 10,
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 10px 4px 4px', borderRadius: 99,
          background: hover ? 'rgba(124,58,237,0.85)' : 'rgba(0,0,0,0.55)',
          color: '#fff', fontSize: 11, fontWeight: 700,
          backdropFilter: 'blur(6px)',
          transition: 'background 0.18s ease-out',
          pointerEvents: 'none',
        }}>
          <UserAvatar src={host.avatar} size="xs"/>
          {host.displayName || host.username}
        </div>
      )}
    </div>
  );
}

/** Wraps HlsPlayer with a loadedmetadata listener that emits source aspect ratio. */
function HlsPlayerWithMeta({ src, onMeta, style, videoElRef, ...rest }) {
  // Attach loadedmetadata listener on the forwarded video element.
  useEffect(() => {
    const v = videoElRef?.current;
    if (!v) return;
    const h = (e) => onMeta?.(e);
    v.addEventListener('loadedmetadata', h);
    return () => v.removeEventListener('loadedmetadata', h);
  }, [src, onMeta, videoElRef]);
  return <HlsPlayer src={src} {...rest} videoRef={videoElRef} style={style} />;
}

function Centered({ label, action }) {
  return (
    <div style={{
      minHeight: '100vh', background: C.bg, color: C.text,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 14, fontFamily: '"Inter", system-ui, sans-serif',
    }}>
      <div style={{ fontSize: 14, color: C.textDim }}>{label}</div>
      {action && (
        <button onClick={action.onClick} style={{
          padding: '10px 18px', borderRadius: 8, border: 'none',
          background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
          color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer',
        }}>{action.label}</button>
      )}
    </div>
  );
}

function ActionPill({ icon, onClick, label, disabled }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{
      width: 44, borderRadius: 22, border: 'none',
      background: 'rgba(0,0,0,0.55)', color: '#fff',
      padding: '8px 0', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.6 : 1,
    }}>
      <Icon name={icon} size={18} className=""/>
      {label && <span style={{ fontSize: 9, fontWeight: 700, marginTop: 2 }}>{label}</span>}
    </button>
  );
}

const iconBtn = {
  width: 32, height: 32, borderRadius: '50%', border: 'none',
  background: 'rgba(0,0,0,0.55)', color: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
};

const pillBtn = {
  padding: '6px 12px', borderRadius: 99, border: 'none',
  background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12, fontWeight: 700,
  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
};

function pillSm(extra = {}) {
  return {
    padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 800,
    letterSpacing: '0.06em', color: '#fff', ...extra,
  };
}

function TipModal({ amount, setAmount, message, setMessage, onClose, onSend, sending, host, tipCatalog }) {
  const PRESETS = [10, 50, 100, 500, 1000];
  // Auto-suggested caption: highest catalog tier the user's current amount meets.
  // Shown as placeholder so the viewer knows what'll appear in chat if they don't type their own.
  const suggested = (tipCatalog || [])
    .filter((e) => amount >= e.minCoins)
    .sort((a, b) => b.minCoins - a.minCoins)[0];
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 'min(380px, 92vw)', background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 14, padding: 20, color: C.text,
        fontFamily: '"Inter", system-ui, sans-serif',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <UserAvatar src={host?.avatar} size="md"/>
          <div>
            <div style={{ fontSize: 12, color: C.textDim }}>Tip</div>
            <div style={{ fontSize: 14, fontWeight: 800 }}>{host?.displayName || 'host'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {PRESETS.map((p) => (
            <button key={p} onClick={() => setAmount(p)} style={{
              padding: '6px 12px', borderRadius: 6,
              background: amount === p ? C.purpleSoft : 'rgba(255,255,255,0.04)',
              border: `1px solid ${amount === p ? C.purple : C.border}`,
              color: amount === p ? C.purpleLight : C.textDim,
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>{p}c</button>
          ))}
        </div>
        <input
          type="number" min={1} value={amount}
          onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value || '0', 10)))}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`,
            borderRadius: 8, padding: 10, color: C.text, fontSize: 14, outline: 'none',
            marginBottom: 10,
          }}
        />
        <input
          type="text"
          value={message}
          maxLength={80}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={suggested ? `Optional message (default: "${suggested.message}")` : 'Optional message (up to 80 chars)'}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`,
            borderRadius: 8, padding: 10, color: C.text, fontSize: 13, outline: 'none',
            marginBottom: 6,
          }}
        />
        <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 14, lineHeight: 1.4 }}>
          Every message is moderated before broadcast. {' '}
          10% platform fee. Host receives {Math.floor(amount * 0.9)}c.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={sending} style={{
            flex: 1, padding: 10, borderRadius: 8, border: `1px solid ${C.border}`,
            background: 'transparent', color: C.textDim, fontSize: 12, fontWeight: 700,
            cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={onSend} disabled={sending} style={{
            flex: 2, padding: 10, borderRadius: 8, border: 'none',
            background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
            color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer',
            opacity: sending ? 0.6 : 1,
          }}>{sending ? 'Sending…' : `Send ${amount}c`}</button>
        </div>
      </div>
    </div>
  );
}
