// MobileLiveViewer — the ONE immersive mobile live-stream viewer, shared by
// the native app (NativeViewerStreamScreen re-exports it) and mobile web
// (ViewerStreamScreen renders it on touch/phone). TikTok Live layout:
//
//   - Full-bleed video. Portrait fills; landscape letterboxes over a blurred
//     backdrop (WYSIWYG, never cropped). Sound plays immediately (HlsPlayer
//     handles the browser-only muted-autoplay fallback internally).
//   - Top: host capsule (avatar · name · LIVE+uptime) with Follow inside it;
//     right: viewer count, fullscreen, close.
//   - Bottom: persistent transparent chat feed + "Say something…" composer
//     with Tip / Share / Heart on the same row. Chat never unmounts, so
//     history never vanishes.
//   - The ONLY reaction is the heart: tap the video or the heart button.
//   - No volume control (device buttons), no quality pill, no clip button,
//     no title/tags strip (those live on shorts slides + desktop).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useKeepAwake } from '../../utils/keepAwake';
import { useStreamPip, isPipSupported, enterPip } from '../../utils/pictureInPicture';
import { motion, AnimatePresence } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, updateDoc, increment as fsIncrement, getDoc, collection, addDoc, serverTimestamp, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase/config';
import VergrMeStreamBanner from './VergrMeStreamBanner';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import HlsPlayer from './HlsPlayer';
import TwitchMirrorPlayer from './TwitchMirrorPlayer';
import useLiveClip from '../../hooks/useLiveClip';
import { connectChat } from '../../utils/chatRelay';
import { safeReload } from '../../utils/platform';
import Icon from '../Icon';
import InlineVideoPlayer from '../media/InlineVideoPlayer';
import UserAvatar from '../UserAvatar';
import VanguardPresence from '../VanguardPresence';
import { getPlaybackUrl } from '../../utils/streamConfig';
import { captureStreamInterest } from '../../utils/feedRank';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { followUser, unfollowUser, isFollowing, sendCoins, getEventTicketStatus, getContentAccess } from '../../firebase/firestore';
import StreamPaywall from '../monetization/StreamPaywall';
import EventTicketCard from '../tournament/EventTicketCard';
import InStreamTicketWidget from './InStreamTicketWidget';
import StreamShareSheet from './StreamShareSheet';
import JoinAnnouncer from './JoinAnnouncer';
import UserQuickSheet from './UserQuickSheet';
import ChatPanel from './ChatPanel';
import TournamentOverlay from './TournamentOverlay';
import ReactionsFloor from './ReactionsFloor';
import NowPlayingCard from './NowPlayingCard';
import { StreamGoalBar, TipAlertOverlay, SubAlertOverlay } from './StreamGoalAndAlerts';
import { useActiveStreamPoll, StreamPollCard } from './StreamPoll';
import HeartBurst from '../primitives/HeartBurst';
import RollingNumber from '../primitives/RollingNumber';
import { useStreamJoinEvents } from '../../hooks/useStreamJoinEvents';
import { haptic } from '../../utils/haptics';
import { useLiveUsers } from '../../context/LiveUsersContext';
import streamBg from '../../assets/stream/cohost-bg.jpg';
import likeIconAsset from '../../assets/stream/like.webp';
import inviteIconAsset from '../../assets/stream/invite.webp';
import vcCoinIconAsset from '../../assets/stream/vc-coin.webp';
import giftboxIconAsset from '../../assets/stream/giftbox.webp';
import sendIconAsset from '../../assets/stream/send.webp';
import { resolveTier } from '../../utils/tierSystem';

// Frosted-glass surface tokens — match the Stream Preview design (the background
// image behind the blur is what makes the glass read).
const glass = { background: 'rgba(255,255,255,0.10)', backdropFilter: 'blur(16px) saturate(140%)', WebkitBackdropFilter: 'blur(16px) saturate(140%)', border: '1px solid rgba(255,255,255,0.18)' };
const glassDark = { background: 'rgba(10,8,22,0.42)', backdropFilter: 'blur(18px) saturate(140%)', WebkitBackdropFilter: 'blur(18px) saturate(140%)', border: '1px solid rgba(255,255,255,0.12)' };

const C = {
  bg: '#0a0a14', card: '#12121e',
  border: 'rgba(255,255,255,0.09)', text: '#e8e8f0', textDim: '#a0a0b8', textMuted: '#6b7280',
  purple: '#7c3aed', purpleLight: '#b44fff', purpleSoft: 'rgba(124,58,237,0.18)',
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444', divider: 'rgba(255,255,255,0.06)',
};

// Height of the persistent chat feed (the message area above the composer).
const CHAT_FEED_HEIGHT = '30vh';
// Split layout (landscape/desktop source): the video is a contained 16:9 box.
// The band it lives in runs from the bottom of the top bar to the top of the
// dock, and the box is centred in it.
const SPLIT_BAND_TOP = 'calc(env(safe-area-inset-top, 0px) + 56px)';
const SPLIT_VIDEO_H = 'min(56.25vw, 46vh)';

// Live element height via a CALLBACK ref, so it re-measures when the element
// mounts or unmounts rather than on some proxy dependency. An effect keyed on
// state would miss the promo strip appearing/disappearing with the tip goal.
function useMeasuredHeight() {
  const [h, setH] = useState(0);
  const roRef = useRef(null);
  const ref = useCallback((el) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    if (!el) { setH(0); return; }
    const measure = () => setH(Math.round(el.getBoundingClientRect().height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
  }, []);
  return [ref, h];
}
// Like-combo meter: how many rapid taps fill the bar (TikTok-style power bar).
const HEART_COMBO_MAX = 30;

export default function MobileLiveViewer() {
  useKeepAwake(); // keep the screen on while watching a live stream
  const { streamId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const { liveHosts } = useLiveUsers();

  const videoElRef = useRef(null);

  const [streamDoc, setStreamDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ticketStatus, setTicketStatus] = useState(null); // ticketed-stream gate
  const [hostInfo, setHostInfo] = useState(null);
  const [followed, setFollowed] = useState(false);
  const [followChecked, setFollowChecked] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const [tipAmount, setTipAmount] = useState(50);
  const [tipMessage, setTipMessage] = useState('');
  const [tipping, setTipping] = useState(false);
  const [sourceAspect, setSourceAspect] = useState(16 / 9);
  const [sourceAspectKnown, setSourceAspectKnown] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fsUiHidden, setFsUiHidden] = useState(false); // landscape focus mode
  const [replayOpen, setReplayOpen] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [drift, setDrift] = useState(0);
  // Split layout only: the bottom dock (goal + chat feed + composer) sizes
  // itself from the bottom up, so its height is measured rather than assumed.
  // It's what tells the video where the free band above it ends, which is what
  // lets the video sit CENTRED in that band instead of pinned under the header
  // with a dead strip below it.
  const [dockRef, dockH] = useMeasuredHeight();
  // The promo strip that sits above the video in split (goal / vergr.me card).
  const [splitSlotRef, splitSlotH] = useMeasuredHeight();
  // Keyboard handling. baseH = the layout height BEFORE the soft keyboard opens
  // (captured at mount). kb = how many px the keyboard currently covers. The
  // Android activity uses adjustResize (messaging needs it), so when the chat
  // input focuses the WebView shrinks the viewport and a position:fixed/inset:0
  // layout gets squashed upward. We pin the video layer to baseH and ride ONLY
  // the bottom dock above the keyboard via transform. Also fixes iOS Safari web.
  const [baseH, setBaseH] = useState(0);
  const [kb, setKb] = useState(0);
  const [nowTick, setNowTick] = useState(Date.now());
  const [pollDismissed, setPollDismissed] = useState(null);
  const { poll: streamPoll, myVote: pollMyVote, closed: pollClosed } = useActiveStreamPoll(streamDoc?.hostUid, currentUser?.uid);
  const showPoll = streamPoll && pollDismissed !== streamPoll.id;
  const [quickSheet, setQuickSheet] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [topGifters, setTopGifters] = useState([]); // [{ uid, coins, displayName, avatar }]
  const [giftersOpen, setGiftersOpen] = useState(false);
  const [giftSoonOpen, setGiftSoonOpen] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false); // half-drawer of other live streams

  const [heartBurst, setHeartBurst] = useState({ tick: 0, x: '50%', y: '50%' });
  const [heartsDisplay, setHeartsDisplay] = useState(0); // optimistic, monotonic like total
  const [combo, setCombo] = useState(0);                 // rapid-tap power meter (tapper-only)
  const [videoStarted, setVideoStarted] = useState(false); // first real frame painted

  // Picture-in-Picture: keep the stream floating when the user leaves the app
  // (Home press) + a manual "pop out". pipActive strips chrome to video-only.
  const pipActive = useStreamPip(Math.round(sourceAspect * 1000) || 1778, 1000);

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

  // Stall detection + telemetry. When the stall overlay fires, bump
  // streams/{id}.playbackStalls (throttled >=30s) so the broadcaster screen can
  // warn "viewers may be buffering" and ops can see chronic delivery problems.
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

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { if (fullscreen) setFullscreen(false); else navigate(-1); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, navigate]);

  // Capture base height + track the soft keyboard via visualViewport.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const setBase = () => setBaseH(window.innerHeight);
    setBase();
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      // Keyboard height = how much the visual viewport shrank below the layout
      // viewport. Clamp small deltas (URL bar etc.) to avoid jitter.
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKb(covered > 80 ? Math.round(covered) : 0);
    };
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    window.addEventListener('orientationchange', setBase);
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
      window.removeEventListener('orientationchange', setBase);
    };
  }, []);

  // Hearts — the only reaction. Tap the video or the heart button. TikTok-style:
  // unlimited multi-tap, a combo/power meter the tapper sees, floating hearts,
  // and a real-time heart storm shared across viewers via the chat relay. The
  // running "Likes" total is the Firestore streams/{id}.hearts counter, written
  // as ONE batched increment every ~1.5s (never one Firestore write per tap).
  const [reactions, setReactions] = useState([]);
  const reactionIdRef = useRef(0);
  const lastReactionAtRef = useRef(0);
  const heartsPendingRef = useRef(0);     // taps not yet flushed to Firestore
  const comboDecayRef = useRef(0);
  const viewerConnRef = useRef(null);     // relay socket (shared with presence)
  const relayHeartBufRef = useRef(0);
  const relayHeartTimerRef = useRef(0);

  // Spawn N floating hearts (local taps + remote viewers' taps via relay).
  const spawnHearts = (n = 1) => {
    const fresh = [];
    for (let i = 0; i < n; i++) { reactionIdRef.current += 1; fresh.push({ id: reactionIdRef.current }); }
    setReactions((prev) => [...prev, ...fresh]);
    setTimeout(() => setReactions((prev) => prev.filter((r) => !fresh.find((f) => f.id === r.id))), 2600);
  };

  // Coalesce rapid taps into one relay frame (~180ms) so the storm fans out
  // without hammering the socket. The count rides in `n`.
  const queueRelayHeart = () => {
    relayHeartBufRef.current += 1;
    if (relayHeartTimerRef.current) return;
    relayHeartTimerRef.current = setTimeout(() => {
      const n = relayHeartBufRef.current;
      relayHeartBufRef.current = 0;
      relayHeartTimerRef.current = 0;
      if (n > 0) viewerConnRef.current?.send?.({ type: 'heart', n });
    }, 180);
  };

  const bumpCombo = () => {
    setCombo((c) => Math.min(HEART_COMBO_MAX, c + 1));
    clearTimeout(comboDecayRef.current);
    comboDecayRef.current = setTimeout(() => setCombo(0), 1100);
  };

  const sendHeart = (x = null, y = null) => {
    spawnHearts(1);
    if (x != null && y != null) setHeartBurst((hb) => ({ tick: hb.tick + 1, x, y }));
    haptic.light();
    setHeartsDisplay((d) => d + 1);   // optimistic + monotonic (never ticks to 0)
    heartsPendingRef.current += 1;    // batched flush writes the real total
    bumpCombo();
    queueRelayHeart();
    const now = Date.now();
    if (streamId && now - lastReactionAtRef.current >= 1000) {
      lastReactionAtRef.current = now;
      (async () => {
        try { await httpsCallable(getFunctions(undefined, 'europe-west1'), 'recordStreamReaction')({ streamId }); } catch {}
      })();
    }
  };

  // Flush queued like-taps to Firestore as ONE increment every 1.5s (zero-cost
  // at scale; the snapshot then fans the new total to every other viewer).
  useEffect(() => {
    if (!streamDoc?.id) return;
    const sid = streamDoc.id;
    const flush = () => {
      const n = heartsPendingRef.current;
      if (n <= 0) return;
      heartsPendingRef.current = 0;
      updateDoc(doc(db, 'streams', sid), { hearts: fsIncrement(n) }).catch(() => {});
    };
    const id = setInterval(flush, 1500);
    return () => { clearInterval(id); flush(); };
  }, [streamDoc?.id]);

  // Keep the displayed total monotonic: take the higher of our optimistic count
  // and the authoritative snapshot. This is what kills the "counts then drops to
  // 0" bug — a momentary snapshot without the field can never lower the number.
  useEffect(() => {
    const h = streamDoc?.hearts || 0;
    setHeartsDisplay((d) => (h > d ? h : d));
  }, [streamDoc?.hearts]);

  // Clear the combo-decay + relay-coalesce timers on unmount.
  useEffect(() => () => {
    clearTimeout(comboDecayRef.current);
    clearTimeout(relayHeartTimerRef.current);
  }, []);
  const onVideoTap = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    const clientY = e.touches?.[0]?.clientY ?? e.clientY;
    sendHeart(
      clientX != null ? clientX - rect.left : rect.width / 2,
      clientY != null ? clientY - rect.top : rect.height / 2,
    );
  };

  // Subscribe to stream doc.
  useEffect(() => {
    if (!streamId) return;
    return onSnapshot(doc(db, 'streams', streamId), (snap) => {
      setLoading(false);
      setStreamDoc(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    }, () => setLoading(false));
  }, [streamId]);

  // Layout hint: broadcasters stamp streams/{id}.sourceAspect at go-live so the
  // right layout (immersive vs split) paints on the FIRST frame, before any
  // video metadata arrives. Real metadata still wins (onVideoMeta overrides).
  useEffect(() => {
    const a = streamDoc?.sourceAspect;
    if (!a || !Number.isFinite(a) || sourceAspectKnown) return;
    setSourceAspect(a);
    setSourceAspectKnown(true);
  }, [streamDoc?.sourceAspect, sourceAspectKnown]);


  // Host profile.
  useEffect(() => {
    if (!streamDoc?.hostUid) return;
    let cancelled = false;
    (async () => {
      try { const snap = await getDoc(doc(db, 'users', streamDoc.hostUid)); if (!cancelled && snap.exists()) setHostInfo({ id: snap.id, ...snap.data() }); } catch {}
    })();
    return () => { cancelled = true; };
  }, [streamDoc?.hostUid]);

  // Top-gifters leaderboard: server-accumulated per-stream coin totals. Resolve
  // each gifter's name/avatar once and cache it (the doc only stores uid+coins).
  const gifterProfileCache = useRef(new Map());
  useEffect(() => {
    if (!streamDoc?.id) return;
    const q = query(collection(db, 'streams', streamDoc.id, 'gifters'), orderBy('coins', 'desc'), limit(20));
    return onSnapshot(q, async (snap) => {
      const rows = snap.docs.map((d) => ({ uid: d.id, coins: d.data().coins || 0 }));
      const cache = gifterProfileCache.current;
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

  // Presence: hold a relay socket so the server-side presence counter counts
  // this viewer authoritatively (the relay dedupes by uid, so this never
  // double-counts alongside the always-mounted ChatPanel).
  useEffect(() => {
    if (!streamDoc?.id || !currentUser || streamDoc.hostUid === currentUser.uid) return;
    let conn = null;
    let cancelled = false;
    (async () => {
      try {
        conn = await connectChat({
          streamId: streamDoc.id,
          getIdToken: () => currentUser.getIdToken(),
          // Other viewers' like-taps fan out here → render their heart storm.
          onHeart: (m) => spawnHearts(Math.min(8, Math.max(1, m.n || 1))),
        });
        viewerConnRef.current = conn;
        if (cancelled && conn) { conn.close(); viewerConnRef.current = null; }
      } catch { /* presence is best-effort */ }
    })();
    return () => { cancelled = true; viewerConnRef.current = null; if (conn) conn.close(); };
  }, [streamDoc?.id, currentUser?.uid, streamDoc?.hostUid]);

  // Ticketed-stream gate: resolve whether the viewer may watch.
  useEffect(() => {
    if (streamDoc?.audience !== 'ticketed' || !streamDoc?.tournamentId) { setTicketStatus(null); return; }
    let alive = true;
    getEventTicketStatus(streamDoc.tournamentId).then((s) => { if (alive) setTicketStatus(s); }).catch(() => {});
    return () => { alive = false; };
  }, [streamDoc?.audience, streamDoc?.tournamentId]);

  // Follow state + join event.
  const joinAnnouncedRef = useRef(false);
  useEffect(() => {
    if (!currentUser?.uid || !streamDoc?.hostUid || !streamDoc?.id) return;
    if (currentUser.uid === streamDoc.hostUid) return;
    isFollowing(currentUser.uid, streamDoc.hostUid).then(async (isFollower) => {
      setFollowed(isFollower);
      setFollowChecked(true);
      if (!isFollower || joinAnnouncedRef.current) return;
      joinAnnouncedRef.current = true;
      let kind = 'follower'; let tier = null;
      const subTier = resolveTier(profile);
      if (subTier && subTier !== 'free') { kind = 'subscriber'; tier = subTier; }
      try {
        await addDoc(collection(db, 'streams', streamDoc.id, 'joins'), {
          uid: currentUser.uid, displayName: profile?.displayName || profile?.username || null,
          avatar: profile?.avatar || null, kind, tier, ts: serverTimestamp(), clientTs: Date.now(),
        });
      } catch {}
    }).catch(() => {});
  }, [currentUser?.uid, streamDoc?.hostUid, streamDoc?.id, profile?.subscription]);

  const rawJoinEvents = useStreamJoinEvents(streamDoc?.id);
  const joinEvents = useMemo(() => rawJoinEvents.map((e) => ({
    id: e.id, kind: e.kind, tier: e.tier, user: { uid: e.uid, displayName: e.displayName, avatar: e.avatar },
  })), [rawJoinEvents]);

  const toggleFollow = async () => {
    if (followBusy || !currentUser?.uid || !streamDoc?.hostUid) return;
    setFollowBusy(true);
    try {
      if (followed) { await unfollowUser(currentUser.uid, streamDoc.hostUid); setFollowed(false); }
      else { await followUser(currentUser.uid, streamDoc.hostUid); setFollowed(true); haptic.success(); }
    } catch (err) { showToast(err?.message || 'Could not update follow', 'error'); } finally { setFollowBusy(false); }
  };

  const sendTip = async () => {
    if (tipping || !currentUser?.uid || !streamDoc?.hostUid) return;
    const amt = Math.max(1, Math.floor(tipAmount));
    setTipping(true);
    try {
      let finalMessage = tipMessage.trim();
      if (!finalMessage && Array.isArray(hostInfo?.tipCatalog)) {
        const suggested = hostInfo.tipCatalog.filter((e) => amt >= e.minCoins).sort((a, b) => b.minCoins - a.minCoins)[0];
        if (suggested) finalMessage = suggested.message;
      }
      const isCustomMessage = finalMessage && finalMessage !== '' && finalMessage === tipMessage.trim();
      if (isCustomMessage) {
        const mod = httpsCallable(getFunctions(undefined, 'europe-west1'), 'moderateChatMessage');
        const { data } = await mod({ text: finalMessage, surface: 'tip', surfaceId: streamDoc.id });
        if (data?.verdict === 'block') { showToast(`Message blocked: ${data.reason || 'policy'}`, 'error'); setTipping(false); return; }
      }
      const desc = finalMessage ? `Tip · ${streamDoc.title || 'live'} · "${finalMessage}"` : `Tip · ${streamDoc.title || 'live'}`;
      await sendCoins(currentUser.uid, streamDoc.hostUid, amt, desc, { streamId: streamDoc.id });
      try {
        const patch = { lastTip: { coins: amt, fromName: profile?.displayName || profile?.username || 'Someone', ts: Date.now() } };
        if (streamDoc.goal?.active) patch['goal.currentCoins'] = fsIncrement(amt);
        await updateDoc(doc(db, 'streams', streamDoc.id), patch);
      } catch {}
      haptic.success();
      showToast(`Tipped ${amt} coins`, 'success');
      setTipMessage(''); setShowTip(false);
    } catch (err) { showToast(err?.message || 'Tip failed', 'error'); } finally { setTipping(false); }
  };

  const onVideoMeta = (e) => {
    const el = e?.currentTarget || videoElRef.current;
    if (!el?.videoWidth || !el?.videoHeight) return;
    setSourceAspect(el.videoWidth / el.videoHeight);
    setSourceAspectKnown(true);
  };

  // Snap the player back to the live edge (tap the "behind" pill).
  const goLiveEdge = () => {
    const v = videoElRef.current;
    if (!v) return;
    try {
      const sk = v.seekable;
      if (sk && sk.length) { v.currentTime = sk.end(sk.length - 1); v.play?.(); setDrift(0); }
    } catch { /* seek may race teardown */ }
  };
  const behind = drift > 6;

  // WHERE THE PLAYBACK URL COMES FROM.
  //
  // A free public stream carries `hlsUrl` on its own document. A PAID stream and
  // a 1:1 SESSION do not: `streams/{id}` is world-readable, so publishing the
  // URL there would be a paywall anyone defeats by reading the document they are
  // already allowed to read, and a "private" session anyone could join by
  // holding the id. Both resolve through getAccess, which checks the entitlement
  // (paid) or the guest list (1:1) before it mints anything.
  //
  // This screen previously did neither, so a paid stream on a phone showed an
  // empty player and no paywall at all.
  const isPaidStream = streamDoc?.access?.mode === 'paid';
  const isOneToOne = streamDoc?.sessionType === 'one_to_one';
  const paidPrice = Math.floor(streamDoc?.access?.priceCoins || 0);
  const needsServerPlayback = isPaidStream || isOneToOne;
  const [serverAccess, setServerAccess] = useState(null); // null = still checking
  // The join gate is dismissed for this visit. Not persisted: arriving in
  // somebody's private session should always be a deliberate act.
  const [gateAccepted, setGateAccepted] = useState(false);

  useEffect(() => {
    if (!needsServerPlayback || !streamId) { setServerAccess(null); return undefined; }
    let alive = true;
    (async () => {
      try {
        const res = await getContentAccess('stream', streamId);
        if (alive) setServerAccess(res || { hasAccess: false });
      } catch (err) {
        // Fail CLOSED. `not-found` is the server refusing an uninvited viewer on
        // a private session; it is not distinguished from a session that never
        // existed, so that probing an id tells a stranger nothing.
        if (alive) setServerAccess({ hasAccess: false, denied: err?.code === 'functions/not-found' });
      }
    })();
    return () => { alive = false; };
  }, [needsServerPlayback, streamId]);

  const playbackUrl = needsServerPlayback
    ? (serverAccess?.hasAccess ? (serverAccess.hlsUrl || serverAccess.lowLatencyHlsUrl || null) : null)
    : (streamDoc?.compositeHlsUrl || streamDoc?.hlsUrl || null);
  const isTwitchMirror = streamDoc?.source === 'twitch' && !!streamDoc?.twitchChannel;
  const hasVideo = !!playbackUrl || isTwitchMirror;

  // Clip the last N seconds — same hook the desktop watch page uses, so the two
  // can't drift. Not offered on a Twitch mirror: we don't own that video.
  const { clip, clipping, clipSeconds } = useLiveClip({
    videoRef: videoElRef,
    streamDoc,
    currentUser,
    profile,
    enabled: !!playbackUrl && !isTwitchMirror,
    showToast,
  });
  // Default stream background: the host's thumbnail/cover if set, else the brand
  // gradient. Used as the watch backdrop AND the blurred loading screen, and the
  // base behind the split (landscape) layout — same backdrop everywhere.
  const bgImage = streamDoc?.thumbnailUrl || streamDoc?.coverUrl || streamBg;

  // First-frame detection. The blurred loading cover stays up until REAL video
  // paints (not merely manifest-parsed), so the WebView's grey poster + play
  // button never flashes. Twitch mirror owns its own loading UI.
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

  const startedMs = streamDoc?.startedAt?.toMillis?.() || (typeof streamDoc?.startedAt === 'number' ? streamDoc.startedAt : 0);
  const uptimeStr = startedMs ? fmtUptime(Math.max(0, nowTick - startedMs)) : null;

  // ── Guards ──
  if (loading) return <Centered label="Loading stream…" />;
  if (!streamDoc) return <Centered label="Stream not found." action={{ label: 'Browse live', onClick: () => navigate('/') }} />;

  const isHost = !!currentUser?.uid && streamDoc.hostUid === currentUser.uid;
  const isAdmin = profile?.role === 'admin' || currentUser?.email === 'vergenerd@gmail.com';

  if (streamDoc.status === 'ended') {
    // The replay must honour the same gates the LIVE stream did — this branch
    // returns before the audience/ticket gates below, so an ungated replay
    // would hand out a paid event for free once the VOD exists.
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
          <button onClick={() => setReplayOpen(false)} style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top,0px) + 12px)', left: 12, ...pillBtn }}>
            <Icon name="arrow_back" size={14} /> Back
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
                <Icon name="play_circle" size={16} /> Watch replay
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
    return <Centered label="Stream hasn't started yet." action={{ label: 'Refresh', onClick: () => safeReload() }} />;
  }

  // A PRIVATE SESSION THE VIEWER IS NOT IN. Checked before every other gate,
  // because there is nothing here to follow, buy or wait for.
  if (serverAccess?.denied) {
    return (
      <Centered
        label="That session is not available."
        action={{ label: 'Browse live', onClick: () => navigate('/') }}
      />
    );
  }

  // Audience gate: followers/friends-only streams (unlisted) only play for the
  // host, admins, and followers. Everyone else gets a Follow gate, not the video.
  // (isHost/isAdmin are hoisted above the ended branch — the replay needs them.)
  //
  // A 1:1 is EXCLUDED. It is unlisted too, but its gate is the guest list, and
  // running it through this one would have told an invited guest to go and
  // follow the person who just invited them.
  const audienceGated = !!streamDoc.unlisted && !isOneToOne && !isHost && !isAdmin && (followChecked ? !followed : !currentUser);
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

  // THE JOIN GATE. Shown before entering a Premium Live that has not been paid
  // for, AND before entering a 1:1 session — including a free one.
  //
  // A free 1:1 gets a gate on purpose. Dropping straight into somebody's private
  // broadcast with no confirmation is startling for both sides; the host should
  // know when a guest arrives, and the guest should know what they are walking
  // into. Same screen for both products, so the price and the copy cannot drift.
  const needsGate = serverAccess && !serverAccess.hasAccess
    ? isPaidStream            // paid: must buy in
    : (isOneToOne && !isHost && !gateAccepted); // free 1:1: must accept

  if (needsGate) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 95 }}>
        <StreamPaywall
          streamId={streamId}
          priceCoins={isPaidStream ? paidPrice : 0}
          title={streamDoc?.title}
          hostName={hostInfo?.displayName || hostInfo?.username}
          hostAvatar={hostInfo?.avatar}
          stillUrl={streamDoc?.thumbnailUrl || streamDoc?.coverUrl || streamDoc?.thumbUrl}
          isOneToOne={isOneToOne}
          viewerCount={streamDoc?.viewerCount || 0}
          onBack={() => navigate('/')}
          onUnlocked={() => {
            setGateAccepted(true);
            getContentAccess('stream', streamId).then(setServerAccess).catch(() => {});
          }}
        />
      </div>
    );
  }

  const sourceIsPortrait = sourceAspect < 1;
  // Split layout: a landscape (desktop) source plays in a contained 16:9 box at
  // the top with the chat in a panel below, on the same backdrop — instead of
  // letterboxing it inside the full-bleed portrait view. Only commit once the
  // real aspect is known (avoids a portrait stream briefly showing split).
  const useSplit = sourceAspectKnown && !sourceIsPortrait && hasVideo && !isTwitchMirror;

  // Rotate-to-landscape fullscreen — immersive full-bleed video with overlaid
  // chat + composer (matches the Stream Preview landscape design). Tap the video
  // to toggle focus mode (hide all chrome for a clean watch).
  if (fullscreen) {
    const fsComposerExtras = (
      <>
        <GlassDockBtn src={inviteIconAsset} label="Invite friends" onClick={() => setShareOpen(true)} />
        <GlassDockBtn src={vcCoinIconAsset} label="Tips & VC" onClick={() => setShowTip(true)} />
        <GlassDockBtn src={giftboxIconAsset} label="Gift Box" onClick={() => setGiftSoonOpen(true)} />
      </>
    );
    return (
      <div style={{ position: 'fixed', inset: 0, background: `#000 url(${bgImage}) center/cover`, zIndex: 95, color: C.text, overflow: 'hidden' }}>
        {/* Video fills; tapping it toggles focus mode. */}
        <div onClick={() => setFsUiHidden((v) => !v)} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {hasVideo ? (
            <MainVideo isTwitch={isTwitchMirror} twitchChannel={streamDoc?.twitchChannel} src={playbackUrl} controls={false} autoPlay onMeta={onVideoMeta} onDrift={setDrift} style={{ width: '100%', height: '100%', objectFit: 'contain', background: 'transparent' }} videoElRef={videoElRef} />
          ) : <Centered label="Waiting for stream…" />}
          {stalled && streamDoc.status === 'live' && <ReconnectingOverlay />}
        </div>

        {!fsUiHidden && (
          <>
            {/* Exit fullscreen (top-left) + viewer pill (top-right). */}
            <button onClick={(e) => { e.stopPropagation(); setFullscreen(false); }} style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top,0px) + 10px)', left: 10, zIndex: 6, ...pillBtn }}>
              <Icon name="fullscreen_exit" size={14} /> Exit
            </button>
            <span style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top,0px) + 10px)', right: 10, zIndex: 6, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 999, ...glassDark, fontSize: 11, fontWeight: 800 }}>
              <Icon name="person" size={13} /><RollingNumber value={streamDoc.viewerCount || 0} />
            </span>

            {/* Chat overlay — right column, newest at bottom (ChatPanel overlay
                brings its own composer + dock buttons). */}
            <div style={{ position: 'absolute', right: 10, top: 'calc(env(safe-area-inset-top,0px) + 52px)', bottom: 'calc(env(safe-area-inset-bottom,0px) + 10px)', width: 'min(42%, 360px)', display: 'flex', flexDirection: 'column', minHeight: 0, zIndex: 5 }}>
              <ChatPanel
                streamId={streamDoc.id} layout="overlay" hostUid={streamDoc.hostUid}
                slowModeSec={streamDoc.slowModeSec || 0} followersOnly={!!streamDoc.followersOnly}
                pinnedMessage={streamDoc.pinnedMessage || null}
                composerExtras={fsComposerExtras}
              />
            </div>

            {/* Floating like button (bottom-left, away from the chat column). */}
            <button type="button" onClick={(e) => { e.stopPropagation(); sendHeart(); }} aria-label="Like"
              style={{ position: 'absolute', left: 10, bottom: 'calc(env(safe-area-inset-bottom,0px) + 10px)', width: 48, height: 48, borderRadius: 16, padding: 0, ...glass, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 6, boxShadow: '0 6px 18px rgba(0,0,0,0.45)' }}>
              <img src={likeIconAsset} alt="" style={{ width: 30, height: 30, objectFit: 'contain' }} />
            </button>

            {/* Clip — sits above the like button. Landscape is where the good
                moments happen, so it needs a one-tap entry, not a menu dive. */}
            {currentUser && !isTwitchMirror && (
              <button type="button" onClick={(e) => { e.stopPropagation(); if (!clipping) clip(); }} aria-label={`Clip the last ${clipSeconds} seconds`}
                disabled={clipping}
                style={{ position: 'absolute', left: 10, bottom: 'calc(env(safe-area-inset-bottom,0px) + 66px)', width: 48, height: 48, borderRadius: 16, padding: 0, ...glass, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: clipping ? 'default' : 'pointer', opacity: clipping ? 0.6 : 1, zIndex: 6, boxShadow: '0 6px 18px rgba(0,0,0,0.45)' }}>
                <Icon name="content_cut" size={20} />
              </button>
            )}
          </>
        )}

        <ReactionsFloor events={reactions} position="right" />
      </div>
    );
  }

  // When floating in a PiP window, hide all chrome and show only the video.
  // We fade (not unmount) so the ChatPanel relay socket / presence stays alive.
  const chromeHidden = pipActive ? { opacity: 0, pointerEvents: 'none', transition: 'opacity 0.15s' } : null;

  const composerExtras = (
    <>
      <GlassDockBtn src={inviteIconAsset} label="Invite friends" onClick={() => setShareOpen(true)} />
      <GlassDockBtn src={vcCoinIconAsset} label="Tips & VC" onClick={() => setShowTip(true)} />
      <GlassDockBtn src={giftboxIconAsset} label="Gift Box" onClick={() => setGiftSoonOpen(true)} />
      <GlassDockBtn src={sendIconAsset} label="Share" onClick={() => setShareOpen(true)} />
    </>
  );

  // Split layout geometry. The band above the dock holds a promo strip (tip
  // goal, or the host's vergr.me page when there's no goal) stacked on top of
  // the contained 16:9 video box, and the pair is centred in that band. The
  // strip's height is measured because it depends on which card is showing.
  const splitSlotSpace = splitSlotH > 0 ? `${splitSlotH + 8}px` : '0px';
  const splitVideoTop = dockH > 0
    ? `calc(${SPLIT_BAND_TOP} + max(0px, (100% - ${SPLIT_BAND_TOP} - ${dockH}px - ${SPLIT_VIDEO_H} - ${splitSlotSpace}) / 2) + ${splitSlotSpace})`
    : SPLIT_BAND_TOP;

  // ── Immersive portrait view ──
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0,
      // Pin to the pre-keyboard height so adjustResize can't squash the video.
      height: baseH || '100%',
      // Default backdrop (host thumbnail/cover or the brand gradient) sits behind
      // the video so a thumbnail-less / still-loading stream is never bare black.
      background: `#000 url(${bgImage}) center/cover`,
      overflow: 'hidden', color: C.text, fontFamily: '"Inter", system-ui, sans-serif',
    }}>
      {!pipActive && streamDoc.promotedEventId && <InStreamTicketWidget tournamentId={streamDoc.promotedEventId} />}
      {!useSplit && !sourceIsPortrait && playbackUrl && !isTwitchMirror && (
        <BlurBackdrop videoElRef={videoElRef} />
      )}
      {/* One container, morphing between immersive (full-bleed) and split
          (contained 16:9 at top) via animated top/height — no layout snap when
          the aspect resolves or changes mid-stream. */}
      <div onClick={onVideoTap} style={{
        position: 'absolute', left: 0, right: 0,
        // Split: a contained 16:9 box CENTRED in the band between the top bar
        // and the dock. It used to be pinned directly under the top bar, which
        // left every desktop stream with a dead strip of backdrop between the
        // video and the chat. Half the slack now sits above it instead.
        // dockH is 0 until the dock has been measured; splitVideoTop stays
        // pinned under the top bar for that first frame rather than centring
        // against a zero-height dock and animating back up.
        top: !pipActive && useSplit ? splitVideoTop : 0,
        height: !pipActive && useSplit ? SPLIT_VIDEO_H : '100%',
        background: pipActive || useSplit ? '#000' : 'transparent',
        overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'top 0.35s ease, height 0.35s ease',
      }}>
        {hasVideo ? (
          <MainVideo isTwitch={isTwitchMirror} twitchChannel={streamDoc?.twitchChannel} src={playbackUrl} controls={false} autoPlay onMeta={onVideoMeta} onDrift={setDrift}
            style={pipActive ? { width: '100%', height: '100%', objectFit: 'contain' } : useSplit ? { width: '100%', height: '100%', objectFit: 'contain' } : { width: '100%', height: sourceIsPortrait ? '100%' : 'auto', maxHeight: '100%', objectFit: 'contain' }} videoElRef={videoElRef} />
        ) : <div style={{ color: C.textDim, fontSize: 12 }}>Waiting for stream…</div>}
        <HeartBurst trigger={heartBurst.tick} originX={heartBurst.x} originY={heartBurst.y} />
        {stalled && streamDoc.status === 'live' && <ReconnectingOverlay />}
        <StreamLoadingCover
          thumb={bgImage}
          visible={hasVideo && !isTwitchMirror && !videoStarted && streamDoc.status === 'live'}
        />
        {streamDoc?.hostUid && (
          <TournamentOverlay
            hostUid={streamDoc.hostUid}
            offset={{ top: 'calc(env(safe-area-inset-top, 0px) + 64px)', right: 10 }}
          />
        )}
        {/* Corner fullscreen toggle — shown in split (landscape source) so the
            viewer can expand without hunting through the "…" sheet. */}
        {!pipActive && useSplit && hasVideo && !isTwitchMirror && (
          <button onClick={(e) => { e.stopPropagation(); setFullscreen(true); }} aria-label="Fullscreen"
            style={{ position: 'absolute', right: 8, bottom: 8, width: 34, height: 34, borderRadius: '50%', ...glassDark, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 5 }}>
            <Icon name="fullscreen" size={17} />
          </button>
        )}
      </div>

      {/* Split promo strip — sits directly ABOVE the video box, in space the
          landscape source leaves over anyway. Tip goal when the host has set
          one, otherwise their vergr.me page so the slot is never dead. Anchored
          by `bottom` off the video's top edge, so it grows upward and never
          pushes the video, the chat or the composer. */}
      {!pipActive && useSplit && (
        <div
          ref={splitSlotRef}
          style={{
            position: 'absolute', left: 10, right: 10,
            bottom: `calc(100% - (${splitVideoTop}) + 8px)`,
            zIndex: 7, ...chromeHidden,
          }}
        >
          {streamDoc.goal?.active
            ? <StreamGoalBar goal={streamDoc.goal} compact />
            : <VergrMeStreamBanner uid={streamDoc.hostUid} username={hostInfo?.username} />}
        </div>
      )}

      {/* Top bar: host capsule + viewer count + fullscreen + close */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, padding: '10px 12px 22px',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.55), transparent)',
        display: 'flex', alignItems: 'center', gap: 8,
        ...chromeHidden,
      }}>
        {/* Host capsule */}
        <div
          onClick={() => streamDoc?.hostUid && setQuickSheet({ uid: streamDoc.hostUid })}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
            padding: '4px 6px 4px 4px', borderRadius: 999, ...glass,
            cursor: 'pointer', maxWidth: '58%',
          }}
        >
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <UserAvatar src={hostInfo?.avatar} size="sm" />
            {hostInfo?.isVerified && (
              <span style={{
                position: 'absolute', bottom: -2, left: -2, width: 15, height: 15, borderRadius: '50%',
                background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, border: '2px solid rgba(0,0,0,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name="check" size={9} />
              </span>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {hostInfo?.displayName || hostInfo?.username || 'Live'}
            </div>
            <div style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <Icon name="favorite" size={9} filled className="" style={{ color: C.red }} />
                {compactNum(heartsDisplay)} Likes
              </span>
            </div>
          </div>
          {currentUser && currentUser.uid !== streamDoc.hostUid && !followed && (
            <button
              onClick={(e) => { e.stopPropagation(); toggleFollow(); }}
              disabled={followBusy}
              style={{
                marginLeft: 4, padding: '6px 14px', borderRadius: 999, border: 'none', flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', gap: 3,
                background: '#fff', color: '#0a0a14',
                fontSize: 11, fontWeight: 800, cursor: 'pointer', opacity: followBusy ? 0.6 : 1,
              }}
            ><Icon name="add" size={13} className="" />Follow</button>
          )}
        </div>

        <div style={{ flex: 1 }} />
        {topGifters.length > 0 && (
          <TopGiftersCluster gifters={topGifters} onClick={() => setGiftersOpen(true)} />
        )}
        {behind && streamDoc.status === 'live' && hasVideo && !isTwitchMirror && (
          <button
            onClick={(e) => { e.stopPropagation(); goLiveEdge(); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 999,
              border: 'none', fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', cursor: 'pointer',
              background: 'rgba(0,0,0,0.55)', color: C.textDim,
            }}
          ><Icon name="history" size={12} /> GO LIVE</button>
        )}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 999,
          ...glassDark, fontSize: 11, fontWeight: 800,
        }}>
          <Icon name="person" size={13} />
          <RollingNumber value={streamDoc.viewerCount || 0} />
        </span>
        <button onClick={() => setMoreOpen(true)} aria-label="More" style={iconBtn}><Icon name="more_horiz" size={17} /></button>
        <button onClick={() => navigate(-1)} aria-label="Leave" style={iconBtn}><Icon name="close" size={17} /></button>
      </div>

      {!pipActive && streamDoc.nowPlaying?.title && (
        <div style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top,0px) + 62px)', left: 12, zIndex: 4 }}>
          <NowPlayingCard nowPlaying={streamDoc.nowPlaying} compact />
        </div>
      )}

      {/* Bottom dock: poll + goal stacked above the persistent chat feed +
          composer (Tip / Share / Heart inline). Rides above the soft keyboard
          via transform (not layout) so the video layer never moves. */}
      <div ref={dockRef} style={{
        position: 'absolute', left: 10, right: 10,
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 10px)',
        // Sizes from the bottom up in BOTH layouts. It used to be stretched in
        // split (top pinned to the video's bottom edge), which forced the chat
        // to fill the whole remaining height — and since chat messages are
        // bottom-anchored, that just produced empty space under the video.
        // Measuring this instead lets the video centre in what's left.
        display: 'flex', flexDirection: 'column', gap: 8, zIndex: 8,
        transform: kb > 0 ? `translateY(-${kb}px)` : 'none',
        transition: 'transform 0.18s ease-out',
        ...chromeHidden,
      }}>
        {showPoll && (
          <div style={{ maxWidth: 320 }}>
            <StreamPollCard poll={streamPoll} myVote={pollMyVote} closed={pollClosed} uid={currentUser?.uid} onClose={() => setPollDismissed(streamPoll.id)} />
          </div>
        )}
        {/* Immersive only — in split this moved ABOVE the video box (see the
            promo strip), where the landscape source leaves room for it. */}
        {useSplit ? null : streamDoc.goal?.active ? (
          <div style={{ maxWidth: 360 }}>
            <StreamGoalBar goal={streamDoc.goal} compact />
          </div>
        ) : (
          // No tip goal set → an Explore pill that opens a half-drawer of other
          // live streams (keeps the spot useful instead of empty).
          <button
            type="button" onClick={() => setExploreOpen(true)}
            style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 999, cursor: 'pointer', color: '#fff', fontSize: 12, fontWeight: 800, ...glassDark }}
          ><Icon name="explore" size={15} /> Explore live</button>
        )}
        {/* Rapid-tap power meter: fills as you spam likes, decays when you stop.
            Only the tapper sees it (TikTok-style). */}
        <ComboMeter combo={combo} max={HEART_COMBO_MAX} />
        {/* Floating like button: the only reaction, sits above the composer on
            the right (the inline heart moved here to match the live design). */}
        <button
          type="button" onClick={() => sendHeart()} aria-label="Like"
          style={{
            position: 'absolute', right: 2, bottom: 56, width: 48, height: 48, borderRadius: 16, padding: 0,
            ...glass, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 9,
            boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
          }}
        ><img src={likeIconAsset} alt="" style={{ width: 30, height: 30, objectFit: 'contain' }} /></button>
        <div style={{ height: kb > 0 ? 96 : CHAT_FEED_HEIGHT, display: 'flex', flexDirection: 'column', minHeight: 0, transition: 'height 0.18s ease-out' }}>
          <ChatPanel
            streamId={streamDoc.id} layout="overlay" hostUid={streamDoc.hostUid}
            slowModeSec={streamDoc.slowModeSec || 0} followersOnly={!!streamDoc.followersOnly}
            pinnedMessage={streamDoc.pinnedMessage || null}
            composerExtras={composerExtras}
          />
        </div>
      </div>

      {!pipActive && <TipAlertOverlay lastTip={streamDoc.lastTip} anchor="top" />}
      {!pipActive && <SubAlertOverlay lastSub={streamDoc.lastSub} anchor="top" />}

      {showTip && (
        <TipModal amount={tipAmount} setAmount={setTipAmount} message={tipMessage} setMessage={setTipMessage} onClose={() => setShowTip(false)} onSend={sendTip} sending={tipping} host={hostInfo} tipCatalog={hostInfo?.tipCatalog} />
      )}
      {shareOpen && (
        <StreamShareSheet streamId={streamDoc.id} streamTitle={streamDoc.title} hostName={hostInfo?.displayName || streamDoc.hostUsername} live={streamDoc.status === 'live'} onClose={() => setShareOpen(false)} />
      )}
      <ReactionsFloor events={reactions} position="right" />
      {!pipActive && <JoinAnnouncer events={joinEvents} side="left" bottom={`calc(env(safe-area-inset-bottom, 0px) + ${CHAT_FEED_HEIGHT} + 24px)`} />}
      <UserQuickSheet open={!!quickSheet} uid={quickSheet?.uid} watchLiveStreamId={quickSheet?.streamId} onClose={() => setQuickSheet(null)} />
      <VanguardPresence parentPath={`streams/${streamDoc.id}`} />

      {/* "…" sheet: fullscreen / report */}
      <AnimatePresence>
        {moreOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMoreOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60 }}>
            <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: C.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '14px 14px calc(env(safe-area-inset-bottom,0px) + 14px)' }}>
              {currentUser && !isTwitchMirror && (
                <SheetBtn
                  icon="content_cut"
                  label={clipping ? 'Clipping…' : `Clip the last ${clipSeconds}s`}
                  onClick={() => { if (!clipping) { setMoreOpen(false); clip(); } }}
                />
              )}
              <SheetBtn icon="fullscreen" label="Fullscreen" onClick={() => { setMoreOpen(false); setFullscreen(true); }} />
              {isPipSupported() && (
                <SheetBtn icon="picture_in_picture_alt" label="Pop out (Picture-in-Picture)" onClick={() => { setMoreOpen(false); enterPip(Math.round(sourceAspect * 1000) || 1778, 1000); }} />
              )}
              <SheetBtn icon="flag" label="Report stream" danger onClick={() => { setMoreOpen(false); setReportOpen(true); }} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {reportOpen && (
        <ReportStreamSheet streamId={streamDoc.id} onClose={() => setReportOpen(false)} showToast={showToast} />
      )}
      {giftersOpen && (
        <GiftersSheet gifters={topGifters} hostName={hostInfo?.displayName || hostInfo?.username} onClose={() => setGiftersOpen(false)} onTip={() => { setGiftersOpen(false); setShowTip(true); }} />
      )}
      {giftSoonOpen && (
        <GiftSoonSheet onClose={() => setGiftSoonOpen(false)} onTip={() => { setGiftSoonOpen(false); setShowTip(true); }} />
      )}
      {exploreOpen && (
        <ExploreDrawer
          liveHosts={liveHosts} currentStreamId={streamDoc.id}
          onClose={() => setExploreOpen(false)}
          onGo={(id) => { setExploreOpen(false); navigate(`/watch/${id}`); }}
        />
      )}
    </div>
  );
}

// ── subcomponents ──
// Blurred backdrop for letterboxed landscape sources. Instead of mounting a
// SECOND HlsPlayer (double download + double decode on a phone), paint the
// MAIN video element onto a tiny canvas at ~10fps and blow it up with CSS blur.
// One decode, half the bandwidth.
function BlurBackdrop({ videoElRef }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let lastPaint = 0;
    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      if (t - lastPaint < 100) return; // ~10fps
      lastPaint = t;
      const v = videoElRef?.current;
      if (!v || !v.videoWidth) return;
      try { ctx.drawImage(v, 0, 0, canvas.width, canvas.height); } catch { /* not ready */ }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [videoElRef]);
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', filter: 'blur(34px) brightness(0.55)', transform: 'scale(1.2)' }}>
      <canvas ref={canvasRef} width={64} height={36} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </div>
  );
}
function HlsPlayerWithMeta({ src, onMeta, style, videoElRef, ...rest }) {
  useEffect(() => {
    const v = videoElRef?.current;
    if (!v) return;
    const h = (e) => onMeta?.(e);
    v.addEventListener('loadedmetadata', h);
    // 'resize' fires when the decoded frame dimensions change MID-stream (e.g.
    // a phone broadcaster rotating) — re-derive the aspect so the layout follows.
    v.addEventListener('resize', h);
    return () => { v.removeEventListener('loadedmetadata', h); v.removeEventListener('resize', h); };
  }, [src, onMeta, videoElRef]);
  return <HlsPlayer src={src} {...rest} videoRef={videoElRef} style={style} />;
}
function MainVideo({ isTwitch, twitchChannel, src, controls, autoPlay, onMeta, onDrift, style, videoElRef }) {
  if (isTwitch) {
    return (
      <div style={style && style.width ? { width: style.width, height: style.height || '100%' } : { width: '100%', height: '100%' }}>
        <TwitchMirrorPlayer username={twitchChannel} autoplay={autoPlay} fill />
      </div>
    );
  }
  return <HlsPlayerWithMeta src={src} controls={controls} autoPlay={autoPlay} onMeta={onMeta} onDrift={onDrift} style={style} videoElRef={videoElRef} />;
}
function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${hh ? hh + ':' : ''}${String(mm).padStart(hh ? 2 : 1, '0')}:${String(ss).padStart(2, '0')}`;
}
export function ReconnectingOverlay() {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 999, background: 'rgba(10,10,20,0.85)', border: `1px solid ${C.border}`, color: C.text, fontSize: 13, fontWeight: 700 }}>
        <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }} style={{ display: 'inline-flex' }}><Icon name="progress_activity" size={16} /></motion.span>
        Reconnecting…
      </div>
    </div>
  );
}
// Blurred-frame loading cover (TikTok-style): the stream's own thumbnail,
// blurred + dark, with a spinner — shown until the first real frame paints.
// No z-index: DOM order keeps it above the <video> and below the top-bar chrome
// (so Close stays tappable). Purely visual (pointerEvents none).
export function StreamLoadingCover({ thumb, visible }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, overflow: 'hidden', background: '#0a0a14',
      opacity: visible ? 1 : 0, pointerEvents: 'none',
      transition: 'opacity 0.45s ease',
    }}>
      {thumb && (
        <img src={thumb} alt="" style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover', filter: 'blur(30px) brightness(0.5)', transform: 'scale(1.25)',
        }} />
      )}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 42%, rgba(124,58,237,0.28), rgba(10,10,20,0.82) 68%)' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <motion.div
          animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
          style={{ width: 42, height: 42, borderRadius: '50%', border: '3px solid rgba(255,255,255,0.16)', borderTopColor: '#fff' }}
        />
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 800, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.92)' }}>
          <motion.span
            animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 1.1, repeat: Infinity }}
            style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff2d4f', boxShadow: '0 0 9px #ff2d4f' }}
          />
          GOING LIVE
        </div>
      </div>
    </div>
  );
}
// Rapid-tap power/combo meter: a vertical bar that charges as the viewer spams
// likes and decays after ~1.1s of no taps. Sits beside the like button; the
// tapper is the only one who sees it.
function ComboMeter({ combo, max }) {
  const pct = Math.min(1, combo / max);
  return (
    <AnimatePresence>
      {combo > 1 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.7, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.7 }}
          style={{ position: 'absolute', right: 9, bottom: 112, zIndex: 9, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, pointerEvents: 'none' }}
        >
          <motion.div
            key={combo}
            initial={{ scale: 1.35 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}
            style={{ fontSize: 14, fontWeight: 900, fontStyle: 'italic', color: '#fff', textShadow: '0 1px 8px rgba(255,45,79,0.85)' }}
          >x{combo}</motion.div>
          <div style={{ width: 6, height: 92, borderRadius: 999, background: 'rgba(255,255,255,0.16)', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <motion.div
              animate={{ height: `${pct * 100}%` }} transition={{ type: 'spring', stiffness: 280, damping: 26 }}
              style={{ width: '100%', background: 'linear-gradient(180deg, #ffd23f, #ff2d4f)', borderRadius: 999 }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
function Centered({ label, action }) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14, fontFamily: '"Inter", system-ui, sans-serif' }}>
      <div style={{ fontSize: 14, color: C.textDim }}>{label}</div>
      {action && <button onClick={action.onClick} style={{ padding: '12px 20px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>{action.label}</button>}
    </div>
  );
}
function compactNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}
function SheetBtn({ icon, label, onClick, danger = false }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, width: '100%',
      padding: '13px 12px', borderRadius: 12, border: 'none', marginBottom: 6,
      background: 'rgba(255,255,255,0.04)', color: danger ? C.red : '#fff',
      fontSize: 14, fontWeight: 700, cursor: 'pointer', textAlign: 'left',
    }}>
      <Icon name={icon} size={18} />
      {label}
    </button>
  );
}
const REPORT_REASONS = [
  { id: 'cheating', label: 'Cheating' },
  { id: 'explicit', label: 'Explicit content' },
  { id: 'harassment', label: 'Harassment / hate' },
  { id: 'scam', label: 'Scam / spam' },
  { id: 'other', label: 'Other' },
];
function ReportStreamSheet({ streamId, onClose, showToast }) {
  const [reason, setReason] = useState('explicit');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await httpsCallable(getFunctions(undefined, 'europe-west1'), 'submitReport')({
        targetType: 'stream', targetId: streamId, reason, details: details.slice(0, 1000),
      });
      showToast('Report sent. Vanguard will review.', 'success');
      onClose();
    } catch (err) {
      showToast(err?.message === 'You already reported this' ? 'You already reported this stream.' : (err?.message || 'Report failed'), 'error');
    } finally { setBusy(false); }
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 210, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: C.card, border: `1px solid ${C.border}`, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 20px)', color: C.text, fontFamily: '"Inter", system-ui, sans-serif' }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>Report this stream</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {REPORT_REASONS.map((r) => (
            <button key={r.id} onClick={() => setReason(r.id)} style={{
              padding: '8px 12px', borderRadius: 99, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              background: reason === r.id ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${reason === r.id ? C.red : C.border}`,
              color: reason === r.id ? C.red : C.textDim,
            }}>{r.label}</button>
          ))}
        </div>
        <textarea value={details} maxLength={1000} onChange={(e) => setDetails(e.target.value)} placeholder="What happened? (optional)" rows={3}
          style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, color: C.text, fontSize: 13, outline: 'none', resize: 'none', marginBottom: 12 }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={busy} style={{ flex: 1, padding: 13, borderRadius: 12, border: `1px solid ${C.border}`, background: 'transparent', color: C.textDim, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
          <button onClick={send} disabled={busy} style={{ flex: 2, padding: 13, borderRadius: 12, border: 'none', background: C.red, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Sending…' : 'Send report'}</button>
        </div>
      </div>
    </div>
  );
}
function DockBtn({ icon, label, onClick, heart = false, gold = false }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} style={{
      width: 42, height: 42, borderRadius: '50%', border: 'none', flexShrink: 0,
      background: gold ? 'linear-gradient(135deg, #F0A500, #F5C842)' : 'rgba(0,0,0,0.45)',
      color: heart ? '#ff3b5c' : gold ? '#1a1306' : '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    }}>
      <Icon name={icon} size={20} />
    </button>
  );
}
// Glass dock button rendering a founder icon asset (matches the Stream Preview).
function GlassDockBtn({ src, label, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} style={{
      width: 42, height: 42, borderRadius: '50%', flexShrink: 0, padding: 0, overflow: 'hidden', cursor: 'pointer',
      ...glass, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <img src={src} alt={label} style={{ width: 28, height: 28, objectFit: 'contain' }} />
    </button>
  );
}
// Half-drawer of other live streams (opened from the Explore pill when the host
// has no tip goal). Reads the app-wide live map; discoverable streams only.
function ExploreDrawer({ liveHosts, currentStreamId, onClose, onGo }) {
  const items = Array.from(liveHosts?.values?.() || [])
    .filter((h) => h.discoverable && h.streamId !== currentStreamId)
    .slice(0, 30);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 38 }}
        style={{ width: '100%', maxWidth: 480, maxHeight: '64vh', overflowY: 'auto', background: C.card, border: `1px solid ${C.border}`, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 16px)', color: C.text, fontFamily: '"Inter", system-ui, sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Icon name="explore" size={18} style={{ color: C.purpleLight }} />
          <div style={{ fontSize: 15, fontWeight: 800 }}>More live now</div>
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.06)', color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon name="close" size={16} /></button>
        </div>
        {items.length === 0 ? (
          <div style={{ fontSize: 13, color: C.textDim, padding: '12px 0 18px' }}>No other live streams right now.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {items.map((h) => (
              <button key={h.streamId} onClick={() => onGo(h.streamId)} style={{ textAlign: 'left', border: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.04)', borderRadius: 14, overflow: 'hidden', cursor: 'pointer', padding: 0 }}>
                <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000' }}>
                  {h.coverUrl
                    ? <img src={h.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <div style={{ position: 'absolute', inset: 0, backgroundImage: `url(${streamBg})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />}
                  <span style={pillSm({ position: 'absolute', top: 6, left: 6, background: C.red })}>● LIVE</span>
                  <span style={{ position: 'absolute', bottom: 6, right: 6, display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 999, fontSize: 10, fontWeight: 800, ...glassDark }}><Icon name="person" size={11} />{compactNum(h.viewerCount || 0)}</span>
                </div>
                <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <UserAvatar src={h.avatar} size="xs" />
                  <span style={{ minWidth: 0, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name || 'Live'}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
// Top-supporters cluster shown top-right: the 3 biggest coin senders this
// stream, each over their running total. Tap → full leaderboard sheet.
function TopGiftersCluster({ gifters, onClick }) {
  const top = gifters.slice(0, 3);
  return (
    <button type="button" onClick={onClick} aria-label="Top supporters" style={{
      display: 'flex', alignItems: 'flex-start', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
    }}>
      {top.map((g, i) => (
        <div key={g.uid} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginLeft: i ? -6 : 0, zIndex: 3 - i }}>
          <span style={{ display: 'inline-flex', borderRadius: '50%', border: '2px solid rgba(0,0,0,0.55)' }}>
            <UserAvatar src={g.avatar} size="xs" />
          </span>
          <span style={{
            marginTop: 2, fontSize: 8.5, fontWeight: 800, color: '#F5C842', fontFamily: 'DM Mono, monospace',
            background: 'rgba(0,0,0,0.55)', borderRadius: 6, padding: '0 4px', lineHeight: '13px',
          }}>{compactNum(g.coins)}</span>
        </div>
      ))}
    </button>
  );
}

function GiftersSheet({ gifters, hostName, onClose, onTip }) {
  const MEDAL = ['#F5C842', '#C0C0CF', '#CD7F32'];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, maxHeight: '72vh', overflowY: 'auto', background: C.card, border: `1px solid ${C.border}`, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 20px)', color: C.text, fontFamily: '"Inter", system-ui, sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Icon name="leaderboard" size={18} style={{ color: '#F5C842' }} />
          <div style={{ fontSize: 15, fontWeight: 800 }}>Top supporters{hostName ? ` · ${hostName}` : ''}</div>
        </div>
        {gifters.length === 0 ? (
          <div style={{ fontSize: 13, color: C.textDim, padding: '8px 0 16px' }}>No tips yet. Be the first to support the stream.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {gifters.map((g, i) => (
              <div key={g.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, background: 'rgba(255,255,255,0.04)' }}>
                <span style={{ width: 20, textAlign: 'center', fontSize: 13, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: MEDAL[i] || C.textMuted }}>{i + 1}</span>
                <UserAvatar src={g.avatar} size="sm" />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.displayName || 'Supporter'}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 800, fontFamily: 'DM Mono, monospace', color: '#F5C842' }}>
                  <Icon name="paid" size={13} />{compactNum(g.coins)}
                </span>
              </div>
            ))}
          </div>
        )}
        <button onClick={onTip} style={{ width: '100%', padding: 14, borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Send a tip</button>
      </div>
    </div>
  );
}

function GiftSoonSheet({ onClose, onTip }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: C.card, border: `1px solid ${C.border}`, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 24, paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 20px)', color: C.text, textAlign: 'center', fontFamily: '"Inter", system-ui, sans-serif' }}>
        <div style={{ width: 56, height: 56, margin: '0 auto 12px', borderRadius: 16, background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(180,79,255,0.3))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="redeem" size={28} style={{ color: C.purpleLight }} />
        </div>
        <div style={{ fontSize: 17, fontWeight: 800 }}>Gift Box is coming soon</div>
        <div style={{ fontSize: 12.5, color: C.textDim, marginTop: 6, marginBottom: 18, lineHeight: 1.5 }}>
          Animated gifts that pop on the broadcaster's stream are on the way. For now, you can show love with a coin tip, which still earns you VP.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={onTip} style={{ padding: 14, borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Send a tip instead</button>
          <button onClick={onClose} style={{ padding: 14, borderRadius: 12, border: `1px solid ${C.border}`, background: 'transparent', color: C.textDim, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Maybe later</button>
        </div>
      </div>
    </div>
  );
}

const iconBtn = { width: 34, height: 34, borderRadius: '50%', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, ...glassDark };
const pillBtn = { padding: '8px 14px', borderRadius: 99, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 };
function pillSm(extra = {}) { return { padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', color: '#fff', ...extra }; }
function TipModal({ amount, setAmount, message, setMessage, onClose, onSend, sending, host, tipCatalog }) {
  const PRESETS = [10, 50, 100, 500, 1000];
  const suggested = (tipCatalog || []).filter((e) => amount >= e.minCoins).sort((a, b) => b.minCoins - a.minCoins)[0];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: C.card, border: `1px solid ${C.border}`, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 20px)', color: C.text, fontFamily: '"Inter", system-ui, sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <UserAvatar src={host?.avatar} size="md" />
          <div><div style={{ fontSize: 12, color: C.textDim }}>Tip</div><div style={{ fontSize: 15, fontWeight: 800 }}>{host?.displayName || 'host'}</div></div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {PRESETS.map((p) => (
            <button key={p} onClick={() => setAmount(p)} style={{ padding: '8px 14px', borderRadius: 10, background: amount === p ? C.purpleSoft : 'rgba(255,255,255,0.04)', border: `1px solid ${amount === p ? C.purple : C.border}`, color: amount === p ? C.purpleLight : C.textDim, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{p}c</button>
          ))}
        </div>
        <input type="number" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value || '0', 10)))} style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: 12, padding: 13, color: C.text, fontSize: 15, outline: 'none', marginBottom: 10 }} />
        <input type="text" value={message} maxLength={80} onChange={(e) => setMessage(e.target.value)} placeholder={suggested ? `Optional message (default: "${suggested.message}")` : 'Optional message (up to 80 chars)'} style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: 12, padding: 13, color: C.text, fontSize: 14, outline: 'none', marginBottom: 6 }} />
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 14, lineHeight: 1.4 }}>Every message is moderated before broadcast. Vergr pays the host their revenue share of this tip.</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={sending} style={{ flex: 1, padding: 14, borderRadius: 12, border: `1px solid ${C.border}`, background: 'transparent', color: C.textDim, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
          <button onClick={onSend} disabled={sending} style={{ flex: 2, padding: 14, borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', opacity: sending ? 0.6 : 1 }}>{sending ? 'Sending…' : `Send ${amount}c`}</button>
        </div>
      </div>
    </div>
  );
}
