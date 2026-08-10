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
import { getContentAccess } from '../../firebase/firestore';
import StreamPaywall from '../../components/monetization/StreamPaywall';
import { captureStreamInterest } from '../../utils/feedRank';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { followUser, unfollowUser, isFollowing, sendCoins, getEventTicketStatus, getMembershipTiers, reportStream } from '../../firebase/firestore';
import SubscribeSheet from '../../components/membership/SubscribeSheet';
import ReportSheet from '../../components/ReportSheet';
import ReportPrivate from '../../components/safety/ReportPrivate';
import { collection as fsCollection, query as fsQuery, orderBy as fsOrderBy, limit as fsLimit } from 'firebase/firestore';
import useLiveClip from '../../hooks/useLiveClip';
import JoinAnnouncer from '../../components/streams/JoinAnnouncer';
import UserQuickSheet from '../../components/streams/UserQuickSheet';
import ChatPanel from '../../components/streams/ChatPanel';
import MobileLiveViewer, { ReconnectingOverlay, StreamLoadingCover } from '../../components/streams/MobileLiveViewer';
import TwitchMirrorPlayer from '../../components/streams/TwitchMirrorPlayer';
import InStreamTicketWidget from '../../components/streams/InStreamTicketWidget';
import EventTicketCard from '../../components/tournament/EventTicketCard';
import { StreamGoalBar, TipAlertOverlay, SubAlertOverlay } from '../../components/streams/StreamGoalAndAlerts';
import InlineVideoPlayer from '../../components/media/InlineVideoPlayer';
import TournamentOverlay from '../../components/streams/TournamentOverlay';
import ReactionsFloor from '../../components/streams/ReactionsFloor';
import NowPlayingCard from '../../components/streams/NowPlayingCard';
import HeartBurst from '../../components/primitives/HeartBurst';
import RollingNumber from '../../components/primitives/RollingNumber';
import { useStreamJoinEvents } from '../../hooks/useStreamJoinEvents';
import { haptic } from '../../utils/haptics';
import { resolveTier } from '../../utils/tierSystem';

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

// Touch phones get the dedicated TikTok-style immersive viewer (MobileLiveViewer,
// the same component the native app uses). Every mouse-driven viewport — including
// a narrow desktop window — gets the framed desktop viewer below.
export default function ViewerStreamScreen() {
  const isTouchPhone = typeof window !== 'undefined'
    && window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
  if (isTouchPhone) return <MobileLiveViewer />;
  return <DesktopViewerStreamScreen />;
}

function DesktopViewerStreamScreen() {
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
  const [ticketStatus, setTicketStatus] = useState(null); // ticketed-stream gate
  const [followChecked, setFollowChecked] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [videoStarted, setVideoStarted] = useState(false); // first real frame painted
  const [replayOpen, setReplayOpen] = useState(false);
  const [membershipTiers, setMembershipTiers] = useState([]); // creator sub tiers
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [topGifters, setTopGifters] = useState([]); // [{ uid, coins, displayName, avatar }]
  const [nowTick, setNowTick] = useState(Date.now());
  // Custom control bar visibility (fades in on hover, auto-hides after 2.6s).
  const [barVisible, setBarVisible] = useState(true);
  const barTimerRef = useRef(0);
  const bumpBar = () => {
    setBarVisible(true);
    clearTimeout(barTimerRef.current);
    barTimerRef.current = setTimeout(() => setBarVisible(false), 2600);
  };
  useEffect(() => () => clearTimeout(barTimerRef.current), []);

  // Heart-burst: double-click the video frame spawns hearts at the click point.
  const [heartBurst, setHeartBurst] = useState({ tick: 0, x: '50%', y: '50%' });
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

  // Uptime ticker (1s) while live.
  useEffect(() => {
    if (streamDoc?.status !== 'live') return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [streamDoc?.status]);

  // Watching a stream for a few seconds = a host-affinity signal for For You.
  useEffect(() => {
    if (streamDoc?.status !== 'live' || !(streamDoc?.hostUid || streamDoc?.streamerId)) return;
    const t = setTimeout(() => captureStreamInterest(streamDoc, 1), 5000);
    return () => clearTimeout(t);
  }, [streamDoc?.id, streamDoc?.status]);

  // Creator membership tiers → drives the Subscribe button (hidden if none).
  useEffect(() => {
    if (!streamDoc?.hostUid) { setMembershipTiers([]); return; }
    let alive = true;
    getMembershipTiers(streamDoc.hostUid).then(({ tiers }) => { if (alive) setMembershipTiers(tiers || []); }).catch(() => {});
    return () => { alive = false; };
  }, [streamDoc?.hostUid]);

  // Top-gifters leaderboard (server-accumulated per-stream coin totals).
  const gifterCacheRef = useRef(new Map());
  useEffect(() => {
    if (!streamDoc?.id) return;
    const q = fsQuery(fsCollection(db, 'streams', streamDoc.id, 'gifters'), fsOrderBy('coins', 'desc'), fsLimit(10));
    return onSnapshot(q, async (snap) => {
      const rows = snap.docs.map((d) => ({ uid: d.id, coins: d.data().coins || 0 }));
      const cache = gifterCacheRef.current;
      await Promise.all(rows.map(async (r) => {
        if (cache.has(r.uid)) return;
        try {
          const u = await getDoc(doc(db, 'users', r.uid));
          cache.set(r.uid, u.exists() ? { displayName: u.data().displayName || u.data().username || 'Supporter', avatar: u.data().avatar || null } : { displayName: 'Supporter', avatar: null });
        } catch { cache.set(r.uid, { displayName: 'Supporter', avatar: null }); }
      }));
      setTopGifters(rows.map((r) => ({ ...r, ...(cache.get(r.uid) || {}) })));
    }, () => {});
  }, [streamDoc?.id]);

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
      setFollowChecked(true);
      if (!isFollower || joinAnnouncedRef.current) return;
      joinAnnouncedRef.current = true;
      // Detect a paying subscriber tier from the viewer's own profile.
      // resolveTier handles every legacy document shape; reading `subscription`
      // directly here used to miss the `profile.tier` shape entirely.
      let kind = 'follower';
      let tier = null;
      const subTier = resolveTier(profile);
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
      await sendCoins(currentUser.uid, streamDoc.hostUid, amt, desc, { streamId: streamDoc.id });
      // Feed the on-stream tip alert + tip goal (best-effort, mirrors mobile).
      try {
        const patch = { lastTip: { coins: amt, fromName: profile?.displayName || profile?.username || 'Someone', ts: Date.now() } };
        if (streamDoc.goal?.active) patch['goal.currentCoins'] = fsIncrement(amt);
        await updateDoc(doc(db, 'streams', streamDoc.id), patch);
      } catch { /* alert/goal write must never fail the tip */ }
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

  // Double-click the video frame → heart burst at the click point + a throttled
  // hearts increment (feeds the same counter as the mobile viewer's like taps).
  const lastHeartWriteRef = useRef(0);
  const onFrameDoubleClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHeartBurst((hb) => ({ tick: hb.tick + 1, x: e.clientX - rect.left, y: e.clientY - rect.top }));
    haptic.light();
    const now = Date.now();
    if (streamDoc?.id && now - lastHeartWriteRef.current > 800) {
      lastHeartWriteRef.current = now;
      updateDoc(doc(db, 'streams', streamDoc.id), { hearts: fsIncrement(1) }).catch(() => {});
    }
  };

  // Playback URL: prefer the server-side composite when streams are linked
  // (vergr-cohost renders 1-4 publishers into one HLS stream). Falls back to
  // this stream's own solo HLS. Viewer always fetches ONE feed — 1× bandwidth
  // regardless of how many streamers are visible on screen.
  //
  // PAID STREAMS take a different route entirely. `createStreamSession` writes
  // no `hlsUrl` for them and puts both playback URLs in
  // `streams/{id}/private/playback`, which rules deny to every client. The only
  // way to a URL is `getAccess` proving this viewer bought entry, so a paid
  // stream must never fall through to the streamKey reconstruction below.
  const isPaidStream = streamDoc?.access?.mode === 'paid';
  // Terms 10A. Server-stamped and server-capped to one viewer, so this is a
  // real category rather than a label the host chose.
  const isOneToOne = streamDoc?.sessionType === 'one_to_one';
  const paidPrice = Math.floor(streamDoc?.access?.priceCoins || 0);
  const [paidAccess, setPaidAccess] = useState(null); // null = still checking

  useEffect(() => {
    if (!isPaidStream || !streamId) { setPaidAccess(null); return undefined; }
    let alive = true;
    (async () => {
      try {
        const res = await getContentAccess('stream', streamId);
        if (alive) setPaidAccess(res || { hasAccess: false });
      } catch {
        // Fail CLOSED. A failed access check is not a reason to hand over a
        // stream someone is charging for.
        if (alive) setPaidAccess({ hasAccess: false });
      }
    })();
    return () => { alive = false; };
  }, [isPaidStream, streamId]);

  const playbackUrl = isPaidStream
    ? (paidAccess?.hasAccess ? (paidAccess.hlsUrl || paidAccess.lowLatencyHlsUrl || null) : null)
    // A free stream carries its own hlsUrl on the document. The old fallback
    // rebuilt the URL from streamKey, which is why the key had to be public in
    // the first place; it is gone now, so this reads what the server wrote.
    : (streamDoc?.compositeHlsUrl || streamDoc?.hlsUrl || null);
  const isTwitchMirror = streamDoc?.source === 'twitch' && !!streamDoc?.twitchChannel;
  const hasVideo = !!playbackUrl || isTwitchMirror;
  // Source quality label (single-rendition — the viewer receives the source).
  const qualityLabel = (() => {
    const plan = streamDoc?.hostPlan;
    const t = typeof plan === 'string' ? plan : (plan?.tier || 'free');
    return t === 'pro' ? '1080p60' : t === 'lite' ? '720p60' : '480p';
  })();
  const startedMs = streamDoc?.startedAt?.toMillis?.() || (typeof streamDoc?.startedAt === 'number' ? streamDoc.startedAt : 0);
  const uptimeStr = startedMs ? fmtUptime(Math.max(0, nowTick - startedMs)) : null;

  // Ticketed-stream gate: resolve whether this viewer may watch (mirrors mobile).
  useEffect(() => {
    if (streamDoc?.audience !== 'ticketed' || !streamDoc?.tournamentId) { setTicketStatus(null); return; }
    let alive = true;
    getEventTicketStatus(streamDoc.tournamentId).then((s) => { if (alive) setTicketStatus(s); }).catch(() => {});
    return () => { alive = false; };
  }, [streamDoc?.audience, streamDoc?.tournamentId]);

  // Stall detection + telemetry: overlay "Reconnecting" on a real stall and bump
  // streams/{id}.playbackStalls (throttled) so the broadcaster/ops can see it.
  const lastStallWriteRef = useRef(0);
  useEffect(() => {
    const v = videoElRef.current;
    if (!v) return;
    let stallTimer = 0;
    const onWaiting = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        setStalled(true);
        const now = Date.now();
        if (streamId && now - lastStallWriteRef.current > 30_000) {
          lastStallWriteRef.current = now;
          updateDoc(doc(db, 'streams', streamId), { playbackStalls: fsIncrement(1) }).catch(() => {});
        }
      }, 3500);
    };
    const onResume = () => { clearTimeout(stallTimer); setStalled(false); };
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('stalled', onWaiting);
    v.addEventListener('playing', onResume);
    v.addEventListener('timeupdate', onResume);
    v.addEventListener('canplay', onResume);
    return () => {
      clearTimeout(stallTimer);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('stalled', onWaiting);
      v.removeEventListener('playing', onResume);
      v.removeEventListener('timeupdate', onResume);
      v.removeEventListener('canplay', onResume);
    };
  }, [streamDoc?.id, streamDoc?.compositeHlsUrl, streamDoc?.streamKey]);

  // First-frame detection: keep the loading cover up until REAL video paints.
  useEffect(() => {
    setVideoStarted(false);
    if (isTwitchMirror) { setVideoStarted(true); return; }
    if (!playbackUrl) return;
    const v = videoElRef.current;
    if (!v) return;
    const onFrame = () => { if (v.currentTime > 0 || v.readyState >= 3) setVideoStarted(true); };
    v.addEventListener('playing', onFrame);
    v.addEventListener('timeupdate', onFrame);
    return () => { v.removeEventListener('playing', onFrame); v.removeEventListener('timeupdate', onFrame); };
  }, [playbackUrl, isTwitchMirror]);

  // Share the watch link (system share sheet where available, else clipboard).
  const shareStream = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ url, title: 'Watch live on VERGR' });
      else { await navigator.clipboard.writeText(url); showToast('Link copied', 'success'); }
    } catch { /* user cancelled */ }
  };

  // ── In-stream clip capture ──
  // The whole flow (tier gate → rolling buffer or server-side cut → R2 → clip
  // post) lives in useLiveClip, shared with the mobile/native viewer so the two
  // can't drift. Tier gates: Free 30s/3, Lite 60s/5, Pro 90s/unlimited.
  const { clip: handleClip, clipping } = useLiveClip({
    videoRef: videoElRef,
    streamDoc,
    currentUser,
    profile,
    enabled: !!playbackUrl,
    showToast,
  });

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
  const isHost = !!currentUser?.uid && streamDoc.hostUid === currentUser.uid;
  const isAdmin = profile?.role === 'admin' || currentUser?.email === 'vergenerd@gmail.com';

  if (streamDoc.status === 'ended') {
    // Replay parity with the mobile viewer: offer the archived VOD when it
    // exists AND the viewer would have been allowed to watch it live. This
    // branch returns before the audience/ticket gates below, so without this
    // check a ticketed event's replay would be free for anyone with the link.
    const replayAllowed = isHost || isAdmin
      || (!streamDoc.unlisted && streamDoc.audience !== 'ticketed')
      || (streamDoc.unlisted && followed)
      || (streamDoc.audience === 'ticketed'
        && (ticketStatus?.hasTicket || ticketStatus?.isCompetitor));
    // A restricted stream's replay url lives in gatedVodUrl, never in
    // archiveVodUrl — older app builds render archiveVodUrl with no gate at all,
    // so the server keeps it out of their reach. Only read it once allowed.
    const replayUrl = replayAllowed
      ? (streamDoc.archiveVodUrl || streamDoc.gatedVodUrl || streamDoc.vodUrl || null)
      : null;
    if (replayOpen && replayUrl) {
      return (
        <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 95, display: 'flex', flexDirection: 'column' }}>
          <InlineVideoPlayer src={replayUrl} maxHeightClass="h-full" rounded={false} objectFit="contain" className="flex-1 min-h-0" style={{ width: '100%' }} />
          <button onClick={() => setReplayOpen(false)} style={{ position: 'absolute', top: 12, left: 12, ...pillBtn }}>
            <Icon name="arrow_back" size={14} className=""/> Back
          </button>
        </div>
      );
    }
    return (
      <div style={{ minHeight: '100vh', background: `radial-gradient(circle at 50% 0%, #1a1030 0%, ${C.bg} 60%)`, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: '"Inter", system-ui, sans-serif' }}>
        <div style={{ width: 'min(420px, 100%)', background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: 24, textAlign: 'center' }}>
          <UserAvatar src={hostInfo?.avatar} size="lg" />
          <div style={{ fontSize: 17, fontWeight: 800, marginTop: 12 }}>{hostInfo?.displayName || hostInfo?.username || 'The stream'} has ended</div>
          <div style={{ fontSize: 12, color: C.textDim, marginTop: 4, marginBottom: 18 }}>
            {replayUrl ? 'Catch the replay or follow for the next one.'
              : streamDoc.vodPending ? 'The replay is still processing — check back in a few minutes.'
                : streamDoc.vodExpired ? 'The replay for this stream is no longer available.'
                  : 'Follow to get notified when they go live again.'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {replayUrl && (
              <button onClick={() => setReplayOpen(true)} style={{ padding: 14, borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Icon name="play_circle" size={16} className=""/> Watch replay
              </button>
            )}
            {currentUser && currentUser.uid !== streamDoc.hostUid && (
              <button onClick={toggleFollow} disabled={followBusy} style={{ padding: 14, borderRadius: 12, background: followed ? 'transparent' : `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, border: followed ? `1px solid ${C.border}` : 'none', color: followed ? C.textDim : '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
                {followed ? 'Following' : 'Follow'}
              </button>
            )}
            <button onClick={() => navigate('/')} style={{ padding: 14, borderRadius: 12, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>Browse live</button>
          </div>
        </div>
      </div>
    );
  }
  if (streamDoc.status === 'created') {
    return <Centered label="Stream hasn't started yet." action={{ label: 'Refresh', onClick: () => window.location.reload() }}/>;
  }

  // Audience gate: followers/friends-only (unlisted) streams only play for the
  // host, admins, and followers — same rule the mobile viewer enforces.
  // (isHost/isAdmin are hoisted above the ended branch — the replay needs them.)
  const audienceGated = !!streamDoc.unlisted && !isHost && !isAdmin && (followChecked ? !followed : !currentUser);
  if (audienceGated) {
    return (
      <div style={{ minHeight: '100vh', background: `radial-gradient(circle at 50% 0%, #1a1030 0%, ${C.bg} 60%)`, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: '"Inter", system-ui, sans-serif' }}>
        <div style={{ width: 'min(420px, 100%)', background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: 24, textAlign: 'center' }}>
          <UserAvatar src={hostInfo?.avatar} size="lg" />
          <div style={{ fontSize: 17, fontWeight: 800, marginTop: 12 }}>This stream is for followers</div>
          <div style={{ fontSize: 12, color: C.textDim, marginTop: 4, marginBottom: 18 }}>
            {hostInfo?.displayName || hostInfo?.username || 'The host'} made this stream {streamDoc.audience === 'friends' ? 'friends-only' : 'followers-only'}. Follow to watch.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {currentUser ? (
              <button onClick={toggleFollow} disabled={followBusy} style={{ padding: 14, borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
                {followBusy ? 'Following…' : 'Follow'}
              </button>
            ) : (
              <button onClick={() => navigate('/login')} style={{ padding: 14, borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>Sign in to follow</button>
            )}
            <button onClick={() => navigate('/')} style={{ padding: 14, borderRadius: 12, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>Browse live</button>
          </div>
        </div>
      </div>
    );
  }

  // Ticketed watch-gate: only host/admin/competitor/ticket-holder may watch.
  const ticketGated = streamDoc.audience === 'ticketed' && streamDoc.tournamentId
    && !isHost && !isAdmin
    && ticketStatus && !ticketStatus.hasTicket && !ticketStatus.isCompetitor;
  if (ticketGated) {
    return (
      <div style={{ minHeight: '100vh', background: `radial-gradient(circle at 50% 0%, #1a1030 0%, ${C.bg} 60%)`, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: '"Inter", system-ui, sans-serif' }}>
        <div style={{ width: 'min(420px, 100%)' }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 900 }}>This event is ticketed</div>
            <div style={{ fontSize: 12, color: C.textDim, marginTop: 6 }}>Buy a ticket to watch live and support the host.</div>
          </div>
          <EventTicketCard
            tournament={{ id: streamDoc.tournamentId, fundingModel: 'ticketed', ticket: {} }}
            source="gateway"
            onPurchased={() => setTicketStatus((s) => ({ ...(s || {}), hasTicket: true }))}
          />
          <button onClick={() => navigate('/')} style={{ width: '100%', marginTop: 12, padding: 12, borderRadius: 12, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Browse live</button>
        </div>
      </div>
    );
  }

  // Multi-Guest mode: server-side composite is delivered as a single video.
  // We just overlay tap-to-switch zones for each linked streamer.
  const isMultiGuest = linkedStreamDocs.length > 0;

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
          {isPaidStream && !paidAccess?.hasAccess ? (
            <StreamPaywall
              streamId={streamId}
              priceCoins={paidPrice}
              title={streamDoc?.title}
              hostName={streamDoc?.hostName || streamDoc?.hostUsername}
              onUnlocked={() => getContentAccess('stream', streamId).then(setPaidAccess).catch(() => {})}
            />
          ) : playbackUrl ? (
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
        // Narrow (mouse-driven) windows stack the chat under the video instead
        // of squeezing both into a cramped two-column grid.
        gridTemplateColumns: isDesktop ? 'minmax(0, 1fr) 340px' : 'minmax(0, 1fr)',
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
          <div onDoubleClick={onFrameDoubleClick} onMouseMove={bumpBar} onMouseLeave={() => setBarVisible(false)} style={{
            position: 'relative', background: '#000',
            border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden',
            aspectRatio: '16/9',
          }}>
            {isPaidStream && !paidAccess?.hasAccess ? (
              <StreamPaywall
                streamId={streamId}
                priceCoins={paidPrice}
                title={streamDoc?.title}
                hostName={streamDoc?.hostName || streamDoc?.hostUsername}
                onUnlocked={() => getContentAccess('stream', streamId).then(setPaidAccess).catch(() => {})}
              />
            ) : isTwitchMirror ? (
              <TwitchMirrorPlayer username={streamDoc.twitchChannel} autoplay fill />
            ) : playbackUrl ? (
              <HlsPlayerWithMeta
                src={playbackUrl}
                controls={false}
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
            {/* Terms 10A.5: reportable from INSIDE the session, while it is
                running. Pinned to the player rather than tucked into a panel,
                because in a private room this control is the entire escalation
                path and a viewer must not have to go looking for it. */}
            {isOneToOne && (
              <button
                onClick={() => setShowReport(true)}
                title="Report this session"
                style={{
                  position: 'absolute', top: 10, right: 10, zIndex: 6,
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 10px', borderRadius: 999,
                  background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
                  border: '1px solid rgba(255,255,255,0.16)',
                  color: 'rgba(255,255,255,0.85)', fontSize: 11.5, fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>flag</span>
                Report
              </button>
            )}
            {stalled && streamDoc.status === 'live' && <ReconnectingOverlay />}
            <StreamLoadingCover
              thumb={streamDoc.thumbnailUrl || streamDoc.coverUrl || null}
              visible={hasVideo && !isTwitchMirror && !videoStarted && streamDoc.status === 'live'}
            />
            <HeartBurst trigger={heartBurst.tick} originX={heartBurst.x} originY={heartBurst.y} />
            {isMultiGuest && (
              <MultiGuestOverlay
                partners={linkedStreamDocs}
                currentStreamId={streamDoc.id}
                compositeOwner={streamDoc.compositeOwner}
                onSwitch={(targetId) => navigate(`/watch/${targetId}`)}
                onInspect={(partner) => setQuickSheet({ uid: partner.hostUid, streamId: partner.id })}
              />
            )}
            {streamDoc?.hostUid && (
              <TournamentOverlay hostUid={streamDoc.hostUid} offset={{ top: 52, right: 12 }} />
            )}
            {streamDoc.goal?.active && (
              <div style={{ position: 'absolute', left: 12, right: 12, bottom: 56 }}>
                <StreamGoalBar goal={streamDoc.goal} compact />
              </div>
            )}
            <TipAlertOverlay lastTip={streamDoc.lastTip} anchor="top" />
            <SubAlertOverlay lastSub={streamDoc.lastSub} anchor="top" />
            <ReactionsFloor events={reactions} onTapEmoji={onReactionTap} position="right" />
            <div style={{
              position: 'absolute', top: 12, left: 12,
              display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
              opacity: barVisible ? 1 : 0, transition: 'opacity 0.22s ease',
            }}>
              <span style={pillSm({ background: C.red })}>● LIVE</span>
              <span style={pillSm({ background: 'rgba(0,0,0,0.6)' })}>{qualityLabel}</span>
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
              opacity: barVisible ? 1 : 0, transition: 'opacity 0.22s ease',
            }}>
              <Icon name="visibility" size={12} className=""/>
              <RollingNumber value={streamDoc.viewerCount || 0} />
            </div>
            {!isTwitchMirror && (
              <VideoControlBar
                videoElRef={videoElRef} visible={barVisible} muted={muted} setMuted={setMuted}
                onFullscreen={() => setFullscreen(true)} title={streamDoc.title}
              />
            )}
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

          {/* Channel section (Twitch-style): host + title + game/tags + actions */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <button onClick={() => navigate(`/u/${hostInfo?.username || streamDoc.hostUid}`)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', minWidth: 0 }}>
                <div style={{ flexShrink: 0, padding: 2, borderRadius: '50%', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})` }}>
                  <UserAvatar src={hostInfo?.avatar} size="md"/>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: 17, fontWeight: 800 }}>{hostInfo?.displayName || hostInfo?.username || 'Host'}</span>
                    {hostInfo?.isVerified && <Icon name="verified" size={15} filled style={{ color: C.purpleLight }} className=""/>}
                  </div>
                  <div style={{ fontSize: 12, color: C.textDim }}>Open profile</div>
                </div>
              </button>
              <div style={{ flex: 1, minWidth: 12 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={toggleFollow} disabled={followBusy || currentUser?.uid === streamDoc.hostUid}
                  style={pillAction(followed ? 'transparent' : `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, followed ? C.textDim : '#fff', followed ? C.border : 'transparent', followBusy)}>
                  <Icon name={followed ? 'favorite' : 'favorite_border'} size={15} filled={followed} className=""/> {followed ? 'Following' : 'Follow'}
                </button>
                {membershipTiers.length > 0 && currentUser?.uid !== streamDoc.hostUid && (
                  <button onClick={() => setShowSubscribe(true)}
                    style={pillAction('rgba(245,200,66,0.14)', C.amber, C.amber)}>
                    <Icon name="star" size={15} filled className=""/> Subscribe
                  </button>
                )}
                <button onClick={() => setShowTip(true)} disabled={currentUser?.uid === streamDoc.hostUid}
                  style={pillAction('transparent', C.amber, C.amber)}>
                  <Icon name="paid" size={15} className=""/> Tip
                </button>
                <button onClick={handleClip} disabled={clipping} style={pillAction('transparent', C.text, C.border, clipping)}>
                  <Icon name="content_cut" size={15} className=""/> {clipping ? 'Saving…' : 'Clip'}
                </button>
                <button onClick={shareStream} style={pillAction('transparent', C.text, C.border)}>
                  <Icon name="share" size={15} className=""/> Share
                </button>
                {currentUser && currentUser.uid !== streamDoc.hostUid && (
                  <button onClick={() => setShowReport(true)} title="Report stream"
                    style={pillAction('transparent', C.textDim, C.border)}>
                    <Icon name="flag" size={15} className=""/>
                  </button>
                )}
              </div>
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.4 }}>{streamDoc.title || 'Live stream'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {streamDoc.game && <span style={{ fontSize: 13, color: C.purpleLight, fontWeight: 700 }}>{streamDoc.game}</span>}
              {(streamDoc.tags || []).slice(0, 4).map((t) => (
                <span key={t} style={{ padding: '3px 9px', borderRadius: 999, background: C.cardSoft, color: C.textDim, fontSize: 12, fontWeight: 600 }}>{t}</span>
              ))}
              <div style={{ flex: 1 }} />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: C.red, fontWeight: 700 }}>
                <Icon name="person" size={15} filled className=""/> <RollingNumber value={streamDoc.viewerCount || 0} />
              </span>
              {uptimeStr && <span style={{ fontSize: 13, color: C.textDim, fontFamily: 'DM Mono, monospace' }}>{uptimeStr}</span>}
            </div>
          </div>

          {/* About card */}
          {(hostInfo?.bio || hostInfo?.followerCount != null) && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 800 }}>About {hostInfo?.displayName || hostInfo?.username || 'the host'}</span>
                {hostInfo?.isVerified && <Icon name="verified" size={14} filled style={{ color: C.purpleLight }} className=""/>}
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>{compactNum(hostInfo?.followerCount || 0)} followers</div>
              {hostInfo?.bio && <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.5 }}>{hostInfo.bio}</div>}
            </div>
          )}
        </div>

        {/* RIGHT chat column: top-gifters strip + live chat (stacks under the
            video on narrow windows). */}
        <div style={{ minHeight: 0, height: isDesktop ? 'auto' : 520, display: 'flex', flexDirection: 'column', borderTop: isDesktop ? 'none' : `1px solid ${C.border}`, borderLeft: isDesktop ? `1px solid ${C.border}` : 'none', background: C.cardSoft }}>
          {topGifters.length > 0 && (
            <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${C.border}`, overflowX: 'auto', flexShrink: 0 }}>
              {topGifters.slice(0, 3).map((g, i) => (
                <span key={g.uid} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 999, background: C.card, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  <Icon name={i === 0 ? 'emoji_events' : 'paid'} size={13} filled={i === 0} style={{ color: C.amber }} className=""/>
                  <span style={{ maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.displayName}</span>
                  <span style={{ color: C.amber }}>{compactNum(g.coins)}</span>
                </span>
              ))}
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <ChatPanel
              streamId={streamDoc.id} layout="side" hostUid={streamDoc.hostUid}
              slowModeSec={streamDoc.slowModeSec || 0} followersOnly={!!streamDoc.followersOnly}
              pinnedMessage={streamDoc.pinnedMessage || null}
            />
          </div>
        </div>
      </div>

      {streamDoc.promotedEventId && <InStreamTicketWidget tournamentId={streamDoc.promotedEventId} />}
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
      {/* A 1:1 is a private room that nothing scans, so its report control uses
          the universal-prohibition reason set (a minor involved, non-consensual
          imagery, recording without consent, coercion) rather than the generic
          public-stream one. Terms 10A.5: reportable whether or not it was paid,
          and the host cannot prevent it. */}
      {isOneToOne ? (
        <ReportPrivate
          open={showReport}
          onClose={() => setShowReport(false)}
          targetType="stream"
          targetId={streamId}
          context={{ surface: 'one_to_one_session', streamId, paid: isPaidStream }}
          title="Report this session"
        />
      ) : (
        <ReportSheet open={showReport} title="Report Stream" onClose={() => setShowReport(false)}
          onSubmit={(reason) => {
            setShowReport(false);
            reportStream(currentUser.uid, streamId, reason)
              .then(() => showToast('Report submitted — our moderators will review it', 'success'))
              .catch(() => showToast('Could not submit report', 'error'));
          }} />
      )}
      {showSubscribe && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setShowSubscribe(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <SubscribeSheet
              creatorId={streamDoc.hostUid}
              creatorName={hostInfo?.displayName || hostInfo?.username || 'this creator'}
              onClose={() => setShowSubscribe(false)}
            />
          </div>
        </div>
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

function pillAction(bg, color, borderColor, disabled = false) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 14px', borderRadius: 8,
    background: bg, color,
    border: borderColor && borderColor !== 'transparent' ? `1px solid ${borderColor}` : 'none',
    fontSize: 12, fontWeight: 800, cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.6 : 1, whiteSpace: 'nowrap',
  };
}

function compactNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n || 0);
}

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${hh ? hh + ':' : ''}${String(mm).padStart(hh ? 2 : 1, '0')}:${String(ss).padStart(2, '0')}`;
}

// Custom video control bar (replaces the browser's native <video controls> — the
// Twitch-style bottom bar: play/pause, volume, live latency, PiP, fullscreen).
function VideoControlBar({ videoElRef, visible, muted, setMuted, onFullscreen, title }) {
  const [playing, setPlaying] = useState(true);
  const [volume, setVolume] = useState(1);
  useEffect(() => {
    const v = videoElRef?.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onVol = () => { setVolume(v.muted ? 0 : v.volume); };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('volumechange', onVol);
    setPlaying(!v.paused);
    setVolume(v.muted ? 0 : v.volume);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('volumechange', onVol);
    };
  }, [videoElRef]);

  const togglePlay = () => {
    const v = videoElRef?.current;
    if (!v) return;
    if (v.paused) v.play?.().catch(() => {}); else v.pause?.();
  };
  const toggleMute = () => {
    const v = videoElRef?.current;
    if (!v) return;
    const next = !v.muted;
    v.muted = next;
    setMuted?.(next);
  };
  const onVolume = (e) => {
    const v = videoElRef?.current;
    const val = parseFloat(e.target.value);
    if (v) { v.volume = val; v.muted = val === 0; setMuted?.(val === 0); }
    setVolume(val);
  };
  const enterPip = async () => {
    const v = videoElRef?.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture?.();
    } catch { /* PiP may be blocked */ }
  };

  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      padding: '22px 14px 10px', display: 'flex', alignItems: 'center', gap: 14,
      background: 'linear-gradient(0deg, rgba(0,0,0,0.78), transparent)',
      opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none',
      transition: 'opacity 0.22s ease',
    }}>
      <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} style={ctrlBtn}>
        <Icon name={playing ? 'pause' : 'play_arrow'} size={22} filled className=""/>
      </button>
      <button onClick={toggleMute} aria-label="Mute" style={ctrlBtn}>
        <Icon name={volume === 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up'} size={20} className=""/>
      </button>
      <input type="range" min={0} max={1} step={0.05} value={volume} onChange={onVolume} aria-label="Volume"
        style={{ width: 84, accentColor: '#b44fff', cursor: 'pointer' }} />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: '#fff' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 6px #ef4444' }} /> LIVE
      </span>
      <div style={{ flex: 1 }} />
      <button onClick={enterPip} aria-label="Picture in picture" style={ctrlBtn}>
        <Icon name="picture_in_picture_alt" size={19} className=""/>
      </button>
      <button onClick={onFullscreen} aria-label="Fullscreen" style={ctrlBtn}>
        <Icon name="fullscreen" size={22} className=""/>
      </button>
    </div>
  );
}
const ctrlBtn = { background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' };

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
