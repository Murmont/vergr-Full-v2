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
import { ReconnectingOverlay, StreamLoadingCover, PlaybackStateView, AudioStageView, HypeTrainView, LiveTrainBonus, MovableGoal } from './states';
import { RaidCountdown } from './RaidControls';
import { CoinIcon } from '../CoinIcon';
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
import { BoostTimer } from './BoostStreamSheet';
import BoostSheet from '../boost/BoostSheet';
import InlineVideoPlayer from '../media/InlineVideoPlayer';
import UserAvatar from '../UserAvatar';
import VanguardPresence from '../VanguardPresence';
import { getPlaybackUrl } from '../../utils/streamConfig';
import { captureStreamInterest } from '../../utils/feedRank';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { followUser, unfollowUser, isFollowing, sendCoins, getEventTicketStatus, getContentAccess, announceStreamJoin, getMembershipTiers, getMyMembershipFor } from '../../firebase/firestore';
import SupportTray from './SupportTray';
import SubscribeSheet from '../membership/SubscribeSheet';
import StreamPaywall from '../monetization/StreamPaywall';
import EventTicketCard from '../tournament/EventTicketCard';
import InStreamTicketWidget from './InStreamTicketWidget';
import StreamShareSheet from './StreamShareSheet';
import JoinAnnouncer from './JoinAnnouncer';
import UserQuickSheet from './UserQuickSheet';
import GiftSubSheet from './GiftSubSheet';
import ChatPanel from './ChatPanel';
import ReactionsFloor from './ReactionsFloor';
import ComboMeter, { HEART_COMBO_MAX } from './ComboMeter';
import NowPlayingCard from './NowPlayingCard';
import { StreamGoalBar, SubAlertOverlay } from './StreamGoalAndAlerts';
import { TipComboFeed, useLastTipCombo, useAboveChat } from './TipComboFeed';
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
import UserName from '../UserName';

// Frosted-glass surface tokens — match the Stream Preview design (the background
// image behind the blur is what makes the glass read).
// ⚠⚠ SOLID, NOT GLASS. Founder, 2026-09-03, for the third time: *"there are still
// pills and other things using the fake glass. and there are still buttons and ui using
// the gross outline that is lighter than the componenet/button background"*.
//
// Measured on the live page, these were BOTH violations at once:
//   glass      fill rgba(255,255,255,0.10)  border rgba(255,255,255,0.18)  — same white,
//              stroke ~2x the fill, so the hairline did all the separating
//   glassDark  fill rgba(10,8,22,0.42)      border rgba(255,255,255,0.12)  — ditto
//
// These are PILLS AND BUTTONS SITTING ON LIVE GAMEPLAY, which is the worst place for a
// wash: it has no value of its own, it changes with whatever is behind it, and over a
// bright frame it turns to mud. The exemption in the guard was for a full-bleed SCRIM,
// whose job IS to let the video through. A scrim is not a pill.
//
// `backdropFilter` goes with the transparency — it does nothing behind an opaque fill,
// and it was running on every chip in the header and dock.
const glass = { background: '#1E1A2E', border: 'none' };
const glassDark = { background: '#100C1C', border: 'none' };

const C = {
  bg: '#0a0a14', card: '#12121e',
  border: 'rgba(255,255,255,0.09)', text: '#e8e8f0', textDim: '#a0a0b8', textMuted: '#6b7280',
  purple: '#7c3aed', purpleLight: '#b44fff', purpleSoft: '#251A46',   // solid: the old rgba(124,58,237,0.18) flattened onto the sheet
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444', divider: 'rgba(255,255,255,0.06)',
  // ⚠ SOLID SURFACES. Every `rgba(255,255,255,0.0x)` fill below used to be a wash with
  // a BRIGHTER hairline around it, so the stroke did the separating a value step should.
  // A divider may stay translucent — it is a rule, not a surface.
  row: '#1A1A2A',      // a row or chip inside a sheet
  rowHi: '#22222F',    // the same, one step up (a close button on a header)
  field: '#191527',    // a text input — keeps its border, that IS the affordance
  dangerDim: '#3A1420',// an armed danger chip, solid
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
  const [hostDropped, setHostDropped] = useState(false);
  // ⚠⚠ A VIEWER WHOSE OWN NETWORK DROPS SAW "Reconnecting..." FOREVER. Nothing in
  // this file read navigator.onLine, so losing wifi looked identical to the
  // BROADCASTER having trouble: same spinner, no explanation, nothing to act on.
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
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
  const [appealKind, setAppealKind] = useState(null);
  const [giftTo, setGiftTo] = useState(null);


  // ⚠ HOW LONG THIS VIEWER ACTUALLY WATCHED, measured here because only the
  // client knows it. It accumulates ONLY while the stream is live, so arriving
  // after the end contributes nothing and the ended card stays silent rather than
  // claiming a session that did not happen.
  //
  // ⚠⚠ PEAK VIEWERS IS DELIBERATELY NOT SHOWN. `peakViewers` is maintained only
  // for Twitch-mirror streams (functions/twitchMirror.js:138); for a native stream
  // functions/streaming.js:500 initialises it to 0 and nothing ever raises it. It
  // would read 0 on every real stream, which is the same class of lie as a VP
  // figure nothing awards. It needs a server writer first.
  const watchedMsRef = useRef(0);
  const liveSinceRef = useRef(0);
  useEffect(() => {
    const live = streamDoc?.status === 'live';
    if (live && !liveSinceRef.current) liveSinceRef.current = Date.now();
    if (!live && liveSinceRef.current) {
      watchedMsRef.current += Date.now() - liveSinceRef.current;
      liveSinceRef.current = 0;
    }
  }, [streamDoc?.status]);
  const watchedMin = Math.floor((watchedMsRef.current
    + (liveSinceRef.current ? Date.now() - liveSinceRef.current : 0)) / 60000);
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
    // ⚠⚠ HOST DROPPED IS DERIVED HERE AND COSTS NOTHING. `PlaybackStateView`
    // has always been able to render `hostdropped`; what did not exist was a
    // SIGNAL. The obvious one, a heartbeat field on the stream doc, is a
    // Firestore write per stream per interval, which is spending money to learn
    // something the viewer's own video element already knows: `lastFrameAt` is
    // READ by one retired tournament file and WRITTEN by nothing, which is why
    // it looked available and is not.
    //
    // A stall that has lasted this long while the doc still says `live` is not
    // buffering, it is the host's uplink being gone. This adds NO listeners and
    // NO writes: it is a second timer on the events already bound below, the
    // same reuse that made post view counts affordable.
    //
    // ⚠ THE `playbackStalls` WRITE IS UNTOUCHED, still throttled to 30s. Nothing
    // here may raise the rate at which that fires.
    let dropTimer = 0;
    const onWaiting = () => {
      clearTimeout(stallTimer);
      clearTimeout(dropTimer);
      stallTimer = setTimeout(() => {
        setStalled(true);
        const now = Date.now();
        if (streamId && now - lastStallWriteRef.current > 30_000) {
          lastStallWriteRef.current = now;
          updateDoc(doc(db, 'streams', streamId), { playbackStalls: fsIncrement(1) }).catch(() => {});
        }
      }, 3500);
      dropTimer = setTimeout(() => setHostDropped(true), 20_000);
    };
    const onResume = () => { clearTimeout(stallTimer); clearTimeout(dropTimer); setStalled(false); setHostDropped(false); };
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('stalled', onWaiting);
    v.addEventListener('playing', onResume);
    v.addEventListener('timeupdate', onResume);
    v.addEventListener('canplay', onResume);
    return () => {
      clearTimeout(stallTimer);
      clearTimeout(dropTimer);
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
    // Identical hang to ViewerStreamScreen (audit A15): `loading` clears only
    // inside the snapshot callback, so an absent streamId left this spinning
    // forever. A15's sweep listed nine screens it had cleared, but not this
    // one — it is the mobile twin of the screen the finding is about, and it
    // had the same defect.
    if (!streamId) { setLoading(false); return; }
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
      if (joinAnnouncedRef.current) return;
      joinAnnouncedRef.current = true;
      // Server-owned: follower state, tier and VP rank are resolved in
      // `announceStreamJoin`, never sent from here. See
      // docs/ENTRY_ANNOUNCEMENTS_SPEC.md for why the client write was removed.
      try { await announceStreamJoin(streamDoc.id); } catch {}
    }).catch(() => {});
  }, [currentUser?.uid, streamDoc?.hostUid, streamDoc?.id, profile?.subscription]);

  const rawJoinEvents = useStreamJoinEvents(streamDoc?.id);
  const joinEvents = useMemo(() => rawJoinEvents.map((e) => ({
    id: e.id, kind: e.kind, tier: e.tier, level: e.level, rankId: e.rankId,
    user: { uid: e.uid, displayName: e.displayName, avatar: e.avatar },
  })), [rawJoinEvents]);

  // ⚠ ZERO-READ CANDIDATE POOL FOR BULK GIFTING. `topGifters` and the recent
  // join events are already in memory on this screen, so offering "gift to the
  // top 10" costs nothing. The tempting alternative, a user search inside the
  // sheet, is a Firestore query per keystroke to find people who are already on
  // screen, which is money spent on data we hold.
  //
  // Gifters come first because they are ordered by support, which is what makes
  // the quick picks deterministic rather than a draw.
  const giftCandidates = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const g of topGifters || []) {
      if (!g?.uid || seen.has(g.uid)) continue;
      seen.add(g.uid);
      out.push({ uid: g.uid, displayName: g.displayName, avatar: g.avatar });
    }
    for (const e of joinEvents || []) {
      const u = e?.user;
      if (!u?.uid || seen.has(u.uid)) continue;
      seen.add(u.uid);
      out.push({ uid: u.uid, displayName: u.displayName, avatar: u.avatar });
    }
    return out;
  }, [topGifters, joinEvents]);

  // ── Support tray: subscribe + gift subs (founder, 2026-09-10) ──
  // The creator's tiers decide whether the edge tab exists at all, the same rule
  // as the desktop Subscribe button: one read of the creator doc per stream. The
  // viewer's own membership is read only when the tray opens, so someone who
  // never opens it costs nothing extra.
  const [supportTiers, setSupportTiers] = useState([]);
  const [trayOpen, setTrayOpen] = useState(false);
  const [myMembership, setMyMembership] = useState(null);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [giftRoomOpen, setGiftRoomOpen] = useState(false);
  useEffect(() => {
    const host = streamDoc?.hostUid;
    if (!host) return undefined;
    let alive = true;
    getMembershipTiers(host).then(({ tiers }) => { if (alive) setSupportTiers(tiers || []); }).catch(() => {});
    return () => { alive = false; };
  }, [streamDoc?.hostUid]);
  useEffect(() => {
    if (!trayOpen || !currentUser?.uid || !streamDoc?.hostUid) return undefined;
    let alive = true;
    getMyMembershipFor(streamDoc.hostUid, currentUser.uid).then((m) => { if (alive) setMyMembership(m); }).catch(() => {});
    return () => { alive = false; };
  }, [trayOpen, currentUser?.uid, streamDoc?.hostUid]);

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
      // ⚠ NO CLIENT WRITE OF `lastTip` OR THE GOAL. sendTip stamps both
      // server-side, with the sender's uid and avatar. A viewer's write here was
      // denied by the rules; an admin's or moderator's SUCCEEDED, overwrote the
      // server's lastTip without the avatar and counted the tip toward the goal
      // twice.
      haptic.success();
      showToast(`Tipped ${amt} coins`, 'success');
      setTipMessage(''); setShowTip(false);
    } catch (err) { showToast(err?.message || 'Tip failed', 'error'); } finally { setTipping(false); }
  };

  // One-tap coin send — the TikTok rose pattern. Founder, 2026-08-30: "the coin
  // icon is supposed to send one coin like TikTok has with a rose."
  //
  // ⚠ NO MODAL AND NO SUCCESS TOAST, AND THAT IS THE POINT. The feedback is the
  // on-screen tip alert that `lastTip` drives, exactly as it is for a tip sent
  // from the sheet, so a tap reads as "that landed in the room" rather than as a
  // dialog you have to dismiss. A toast per tap would fight the alert it is
  // duplicating.
  //
  // ⚠ Shares the `tipping` in-flight flag with sendTip, so a rapid double-tap
  // cannot spend twice and cannot race the sheet.
  const sendCoinTap = async () => {
    if (tipping || !currentUser?.uid || !streamDoc?.hostUid) return;
    if (currentUser.uid === streamDoc.hostUid) return;   // no tipping yourself
    setTipping(true);
    try {
      await sendCoins(currentUser.uid, streamDoc.hostUid, 1, `Tip · ${streamDoc.title || 'live'}`, { streamId: streamDoc.id });
      // No client write of lastTip or the goal: see sendTip above.
      haptic.success();
    } catch (err) {
      showToast(err?.message || 'Could not send a coin', 'error');
    } finally { setTipping(false); }
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
  // Tips draw as the designed combo feed (the admin preview's tip rows), from
  // the server-written lastTip, which carries the sender's face. The feed sits
  // directly above the newest chat row, measured, as the preview places it.
  // Declared above the early returns so the hook order never changes.
  const { tips: tipDrops } = useLastTipCombo(streamDoc?.lastTip);
  const { setList: setChatList, setAnchor: setChatFrame, bottom: aboveChat } = useAboveChat(kb);
  // ⚠ THE GOAL CARD IS MEMOISED, AND THAT IS A PERFORMANCE FIX, NOT TIDINESS.
  // onDrift fires on every video `timeupdate`, so this screen re-renders about
  // four times a second for the whole stream, and MovableGoal's floor effect
  // walks every node on the stage with getComputedStyle each time it renders.
  // Keyed on the goal's own content, the element is reused until a tip moves it.
  const goalSig = streamDoc?.goal?.active ? JSON.stringify(streamDoc.goal) : '';
  const goalCard = useMemo(() => {
    const g = goalSig ? JSON.parse(goalSig) : null;
    return g ? <MovableGoal goal={g} box={null} editable={false} fallback={{ xPct: 3, yPct: 13, wPct: 62 }} /> : null;
  }, [goalSig]);

  if (loading) return <Centered label="Loading stream…" />;
  // /streams is the live list; '/' is the home feed.
  if (!streamDoc) return <Centered label="Stream not found." action={{ label: 'Browse live', onClick: () => navigate('/streams') }} />;

  const isHost = !!currentUser?.uid && streamDoc.hostUid === currentUser.uid;
  const isAdmin = profile?.staff === true || profile?.role === 'admin';

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
      <div style={{ minHeight: '100vh', background: `radial-gradient(circle at 50% 0%, #1a1030 0%, ${C.bg} 60%)`, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: '"DM Sans", system-ui, sans-serif' }}>
        <div style={{ width: 'min(420px, 100%)', background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: 24, textAlign: 'center' }}>
          <UserAvatar src={hostInfo?.avatar} size="lg" />
          <div style={{ fontSize: 16, fontWeight: 800, marginTop: 12 }}><UserName user={hostInfo} masked fallback={'The stream'} /> has ended</div>
          <div style={{ fontSize: 12, color: C.textDim, marginTop: 4, marginBottom: 18 }}>
            {replayUrl ? 'Catch the replay or follow for the next one.'
              : streamDoc.vodPending ? 'The replay is still processing. Check back in a few minutes.'
                : streamDoc.vodExpired ? 'The replay for this stream is no longer available.'
                  : 'Follow to get notified when they go live again.'}
          </div>
          {/* ⚠ PEAK IS A REAL FIELD, WRITTEN BY THE RELAY, NOT A NEW COST.
              `startPresence` in infra/chat/src/main.go already resolves the
              existing peak once per room and appends `peakViewers` to the SAME
              viewerCount update it was going to send anyway, so reading it here
              adds no write and no read. A grep of src/ and functions/ says
              nothing writes it, which is how it looked like a dead field: the
              writer is in Go.
              Both figures are guarded, because a room nobody watched should not
              be told it peaked at 0. */}
          {(watchedMin > 0 || streamDoc.peakViewers > 0) && (
            <div style={{ fontSize: 12, color: C.textDim, marginBottom: 14, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
              {streamDoc.peakViewers > 0 && (
                <span>Peaked at <b style={{ color: C.text }}>{streamDoc.peakViewers}</b> watching</span>
              )}
              {watchedMin > 0 && streamDoc.peakViewers > 0 && <span style={{ opacity: 0.5 }}>·</span>}
              {watchedMin > 0 && (
                <span>You watched <b style={{ color: C.text }}>{watchedMin}m</b></span>
              )}
            </div>
          )}
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
            {/* ⚠ SHARE THE REPLAY, ONLY WHEN THERE IS ONE. The ended screen offered Watch,
                Follow and Browse, so the single thing a viewer who just enjoyed something
                most wants to do had no button. Gated on replayUrl: a share button for a
                replay that does not exist sends people to a dead page, and the vodPending
                and vodExpired states above already say which of those it is. */}
            {replayUrl && (
              <button onClick={() => setShareOpen(true)} style={{ padding: 14, borderRadius: 12, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: 14, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Icon name="ios_share" size={15} /> Share the replay
              </button>
            )}
            <button onClick={() => navigate('/')} style={{ padding: 14, borderRadius: 12, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>Browse live</button>
          </div>

          {/* ⚠⚠ UP NEXT COSTS ZERO READS, AND THAT IS WHY IT IS BUILT THIS WAY.
              `LiveUsersContext` already holds one shared onSnapshot on
              `streams where status == live` (capped at 300) to light up avatars
              across the app, and this component already destructures
              `liveHosts` from it. Querying for somewhere-to-go-next here would
              have been a Firestore read per viewer per ended stream, which is a
              spending decision and not one to take quietly.

              ⚠ IT EXCLUDES THE HOST WHOSE STREAM JUST ENDED. Their own doc can
              still be in the snapshot for a few seconds, and offering the room
              a link back to the thing that just finished is worse than showing
              nothing. Premium and undiscoverable rooms are filtered too: the
              context already carries both flags. */}
          {(() => {
            const upNext = [...(liveHosts?.values?.() || [])]
              .filter((h) => h.discoverable && !h.premium && h.hostUid !== streamDoc.hostUid && h.streamId !== streamDoc.id)
              .sort((a, b) => (b.viewerCount || 0) - (a.viewerCount || 0))
              .slice(0, 3);
            if (!upNext.length) return null;
            return (
              <div style={{ marginTop: 20, textAlign: 'left' }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: C.textMuted, marginBottom: 8 }}>UP NEXT</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {upNext.map((h) => (
                    <button key={h.streamId} onClick={() => navigate(`/watch/${h.streamId}`)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        padding: 8, borderRadius: 12, border: 'none', cursor: 'pointer',
                        background: '#1A1A2A', color: C.text, textAlign: 'left',
                      }}>
                      <UserAvatar src={h.avatar} size="sm" />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {h.title || h.name || 'Live now'}
                        </span>
                        <span style={{ display: 'block', fontSize: 11, color: C.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {h.name}{h.viewerCount ? ` · ${h.viewerCount} watching` : ''}
                        </span>
                      </span>
                      <span style={{ flexShrink: 0, padding: '2px 7px', borderRadius: 4, fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', background: C.red, color: '#fff' }}>LIVE</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
        {/* ⚠⚠ THE SHEET MUST BE MOUNTED IN THIS BRANCH. The ended screen RETURNS
            EARLY, so the StreamShareSheet in the main return below is unreachable
            from here: "Share the replay" would have set state and rendered nothing,
            which is the dead-control shape this file has already produced twice. */}
        {shareOpen && (
          <StreamShareSheet streamId={streamDoc.id} streamTitle={streamDoc.title}
            hostName={hostInfo?.displayName || streamDoc.hostUsername} live={false}
            onClose={() => setShareOpen(false)} />
        )}
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
      <div style={{ minHeight: '100vh', background: `radial-gradient(circle at 50% 0%, #1a1030 0%, ${C.bg} 60%)`, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: '"DM Sans", system-ui, sans-serif' }}>
        <div style={{ width: 'min(420px, 100%)', background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, padding: 24, textAlign: 'center' }}>
          <UserAvatar src={hostInfo?.avatar} size="lg" />
          <div style={{ fontSize: 16, fontWeight: 800, marginTop: 12 }}>This stream is for followers</div>
          <div style={{ fontSize: 12, color: C.textDim, marginTop: 4, marginBottom: 18 }}>
            <UserName user={hostInfo} masked fallback={'The host'} /> made this stream {streamDoc.audience === 'friends' ? 'friends-only' : 'followers-only'}. Follow to watch.
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
      <div style={{ minHeight: '100vh', background: `radial-gradient(circle at 50% 0%, #1a1030 0%, ${C.bg} 60%)`, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: '"DM Sans", system-ui, sans-serif' }}>
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

  // The support tab, its tray and the two sheets it opens. Shared by both
  // layouts, so rotating to landscape never loses the way to subscribe.
  const hostLabel = hostInfo?.displayName || hostInfo?.username || streamDoc.hostUsername || 'this creator';
  const showSupportTab = supportTiers.length > 0 && currentUser?.uid !== streamDoc.hostUid;
  const supportLayer = (tabTop, hideTab) => (
    <>
      {showSupportTab && (
        <SupportTray
          open={trayOpen} top={tabTop} hideTab={hideTab}
          onOpen={() => setTrayOpen(true)} onClose={() => setTrayOpen(false)}
          hostName={hostLabel} hostAvatar={hostInfo?.avatar}
          tiers={supportTiers} membership={myMembership}
          onSubscribe={() => { setTrayOpen(false); setSubscribeOpen(true); }}
          onGiftSubs={() => { setTrayOpen(false); if (!currentUser) { navigate('/login'); return; } setGiftRoomOpen(true); }}
          onManage={() => { setTrayOpen(false); navigate('/memberships'); }}
        />
      )}
      {subscribeOpen && (
        <SubscribeSheet creatorId={streamDoc.hostUid} creatorName={hostLabel}
          onClose={() => setSubscribeOpen(false)}
          onSubscribed={(t) => setMyMembership({ tierId: t.id, tierName: t.name })} />
      )}
      {giftRoomOpen && (
        // A room gift has no named recipient, so the sheet opens on its picker,
        // fed by the zero-read candidates this screen already holds.
        <GiftSubSheet creatorId={streamDoc.hostUid} recipient={null}
          candidates={giftCandidates}
          onClose={() => setGiftRoomOpen(false)} showToast={showToast} />
      )}
    </>
  );

  // Rotate-to-landscape fullscreen — immersive full-bleed video with overlaid
  // chat + composer (matches the Stream Preview landscape design). Tap the video
  // to toggle focus mode (hide all chrome for a clean watch).
  if (fullscreen) {
    const fsComposerExtras = (
      <>
        <GlassDockBtn src={inviteIconAsset} label="Invite friends" onClick={() => setShareOpen(true)} />
        <GlassDockBtn src={vcCoinIconAsset} label="Send 1 coin" onClick={sendCoinTap} />
        <GlassDockBtn src={giftboxIconAsset} label="Tips & gifts" onClick={() => setShowTip(true)} />
      </>
    );
    return (
      <div style={{ position: 'fixed', inset: 0, background: `#000 url(${bgImage}) center/cover`, zIndex: 95, color: C.text, overflow: 'hidden' }}>
        {/* Video fills; tapping it toggles focus mode. */}
        <div onClick={() => setFsUiHidden((v) => !v)} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {hasVideo ? (
            <MainVideo isTwitch={isTwitchMirror} twitchChannel={streamDoc?.twitchChannel} src={playbackUrl} controls={false} autoPlay onMeta={onVideoMeta} onDrift={setDrift} style={{ width: '100%', height: '100%', objectFit: 'contain', background: 'transparent' }} videoElRef={videoElRef} />
          ) : <Centered label="Waiting for stream…" />}
          {/* offline wins over stalled: "Reconnecting" is a lie when the viewer's own
                connection is the thing that is down. */}
            {!online
            ? <PlaybackStateView state="offline" onRetry={() => safeReload()} onLeave={() => navigate(-1)} />
            : hostDropped && streamDoc.status === 'live'
              ? <PlaybackStateView state="hostdropped" onRetry={() => safeReload()} onLeave={() => navigate(-1)} />
              : (stalled && streamDoc.status === 'live' && <ReconnectingOverlay />)}
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
            <div style={{ position: 'absolute', right: 10, top: 'calc(env(safe-area-inset-top,0px) + 52px)', bottom: 'calc(var(--vg-safe-b, 0px) + 10px)', width: 'min(42%, 360px)', display: 'flex', flexDirection: 'column', minHeight: 0, zIndex: 5 }}>
              <ChatPanel
                streamId={streamDoc.id} layout="overlay" hostUid={streamDoc.hostUid}
                slowModeSec={streamDoc.slowModeSec || 0} followersOnly={!!streamDoc.followersOnly} subsOnly={!!streamDoc.subsOnly} mutedUids={streamDoc.mutedUids || null} ttsEnabled={!!streamDoc.ttsEnabled}
                onAppeal={(kind) => setAppealKind(kind)}
                pinnedMessage={streamDoc.pinnedMessage || null}
                composerExtras={fsComposerExtras}
              />
            </div>

            {/* Floating like button (bottom-left, away from the chat column). */}
            <button type="button" onClick={(e) => { e.stopPropagation(); sendHeart(); }} aria-label="Like"
              style={{ position: 'absolute', left: 10, bottom: 'calc(var(--vg-safe-b, 0px) + 10px)', width: 48, height: 48, borderRadius: 16, padding: 0, ...glass, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 6, boxShadow: '0 6px 18px rgba(0,0,0,0.45)' }}>
              <img src={likeIconAsset} alt="" style={{ width: 30, height: 30, objectFit: 'contain' }} />
            </button>

            {/* Clip — sits above the like button. Landscape is where the good
                moments happen, so it needs a one-tap entry, not a menu dive. */}
            {currentUser && !isTwitchMirror && (
              <button type="button" onClick={(e) => { e.stopPropagation(); if (!clipping) clip(); }} aria-label={`Clip the last ${clipSeconds} seconds`}
                disabled={clipping}
                style={{ position: 'absolute', left: 10, bottom: 'calc(var(--vg-safe-b, 0px) + 66px)', width: 48, height: 48, borderRadius: 16, padding: 0, ...glass, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: clipping ? 'default' : 'pointer', opacity: clipping ? 0.6 : 1, zIndex: 6, boxShadow: '0 6px 18px rgba(0,0,0,0.45)' }}>
                <Icon name="content_cut" size={20} />
              </button>
            )}
          </>
        )}

        {/* ⚠ A RAID ARRIVES THROUGH THE STREAM DOC. `functions/raids.js` writes
            `raid` onto the SOURCE stream, and this screen already holds an
            onSnapshot on it — so the fan-out costs nothing and needs no relay. */}
        {streamDoc?.raid?.toStreamId && (
          <RaidCountdown raid={streamDoc.raid} hostName={hostInfo?.displayName || streamDoc.hostName}
            onArrive={(r) => navigate(`/watch/${r.toStreamId}`)} />
        )}
        <ReactionsFloor events={reactions} position="right" />
        {/* The hype train and the tip rows were absent here too, so a viewer who
            rotated missed every tip. The train is unconditional like every other
            surface's (it is shared progress, not chrome) and stays clear of the
            right-hand chat column; the rows sit right of the like and clip
            buttons. */}
        <HypeTrainView train={streamDoc.hypeTrain} style={{ right: 'calc(min(42%, 360px) + 20px)' }} />
        <LiveTrainBonus bonus={streamDoc.hypeTrainBonus} train={streamDoc.hypeTrain} hostName={hostInfo?.displayName || hostInfo?.username || streamDoc.hostUsername} style={{ right: 'calc(min(42%, 360px) + 20px)' }} />
        <TipComboFeed tips={tipDrops} style={{ left: 68, bottom: 'calc(var(--vg-safe-b, 0px) + 10px)', zIndex: 6 }} />
        {/* Entry ribbons were absent from the fullscreen branch entirely, so a
            viewer watching in landscape silently missed every entrance. Anchored
            bottom-left, clear of the right-hand chat column. */}
        <JoinAnnouncer
          events={joinEvents} side="left"
          bottom="calc(var(--vg-safe-b, 0px) + 124px)"
        />
        {/* Landscape: the tab sits on the chat column's outer edge, where short
            left-aligned messages leave the column empty, and hides in focus mode. */}
        {supportLayer('46%', fsUiHidden)}
      </div>
    );
  }

  // When floating in a PiP window, hide all chrome and show only the video.
  // We fade (not unmount) so the ChatPanel relay socket / presence stays alive.
  const chromeHidden = pipActive ? { opacity: 0, pointerEvents: 'none', transition: 'opacity 0.15s' } : null;

  const composerExtras = (
    <>
      {/* ⚠ THE COIN AND THE GIFT BOX WERE THE WRONG WAY ROUND (founder, 2026-08-30).
          The coin opened the full tip sheet and the gift box opened a
          "gifts are coming" sheet, so the fast action needed two taps and the
          prominent button did nothing. Coin = send one coin instantly;
          gift box = the tip sheet, which is where amounts, catalogue messages
          and the boost tab live. GiftSoonSheet is left defined and unreferenced
          rather than deleted, so this is a one-line revert if that is wanted. */}
      <GlassDockBtn src={inviteIconAsset} label="Invite friends" onClick={() => setShareOpen(true)} />
      <GlassDockBtn src={vcCoinIconAsset} label="Send 1 coin" onClick={sendCoinTap} />
      <GlassDockBtn src={giftboxIconAsset} label="Tips & gifts" onClick={() => setShowTip(true)} />
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
    <div ref={setChatFrame} style={{
      position: 'fixed', top: 0, left: 0, right: 0,
      // Pin to the pre-keyboard height so adjustResize can't squash the video.
      height: baseH || '100%',
      // Default backdrop (host thumbnail/cover or the brand gradient) sits behind
      // the video so a thumbnail-less / still-loading stream is never bare black.
      background: `#000 url(${bgImage}) center/cover`,
      overflow: 'hidden', color: C.text, fontFamily: '"DM Sans", system-ui, sans-serif',
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
        {/* offline wins over stalled: "Reconnecting" is a lie when the viewer's own
                connection is the thing that is down. */}
            {!online
            ? <PlaybackStateView state="offline" onRetry={() => safeReload()} onLeave={() => navigate(-1)} />
            : hostDropped && streamDoc.status === 'live'
              ? <PlaybackStateView state="hostdropped" onRetry={() => safeReload()} onLeave={() => navigate(-1)} />
              : (stalled && streamDoc.status === 'live' && <ReconnectingOverlay />)}
        {/* ⚠⚠ AUDIO-ONLY REPLACES THE VIDEO, so it renders at the MEDIA layer and not in
            a blocking-state ternary. In the preview it once sat there as an opaque
            inset:0 layer mounted last and buried the chrome on six of seven surfaces:
            the broadcaster lost End stream and Mic, the desktop viewer lost Follow and
            the composer. z=1 keeps it under every control.
        
            The field is written by createStreamSession now; before this port it was READ
            in two places and written by nothing, so this could never draw. */}
        {streamDoc.audioOnly && (
          <AudioStageView avatar={hostInfo?.avatar} hostName={hostInfo?.displayName || streamDoc.hostUsername}
            title={streamDoc.title} live={streamDoc.status === 'live'} z={1} />
        )}
        <StreamLoadingCover
          thumb={bgImage}
          visible={hasVideo && !isTwitchMirror && !videoStarted && streamDoc.status === 'live'}
        />
        {/* TournamentOverlay removed 2026-08-19 — see the note in
            ViewerStreamScreen. Same component, same reasons. */}
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

          </div>
          <div style={{ minWidth: 0 }}>
            {/* ⚠⚠ THE TICK GOES BESIDE THE NAME, NEVER ON THE AVATAR. Pinned to the avatar's
                corner it overlapped the portrait and read as clipped — founder, 2026-09-03:
                "the verified tick is under the broadcasters avatar". PreviewViewerScreen and
                previewSoloParts already put it next to the name and even carry a comment
                saying so; these two never got the memo, which is how one component ends up
                with two placements. The name truncates, the tick never shrinks. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                <UserName user={hostInfo} masked fallback={'Live'} />
              </span>
              {hostInfo?.isVerified && (
                <span style={{ flexShrink: 0, width: 14, height: 14, borderRadius: '50%', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="check" size={9} />
                </span>
              )}
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
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
        bottom: 'calc(var(--vg-safe-b, 0px) + 10px)',
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
        {/* ⚠ WITH A GOAL SET, THE GOAL IS NOT HERE ANY MORE. It draws at the top of
            the stage (MovableGoal, further down), where the approved preview puts
            it: a goal is status, not conversation, and in this slot it sat on top
            of the chat. With no goal the slot keeps the Explore pill. */}
        {useSplit || streamDoc.goal?.active ? null : (
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
            slowModeSec={streamDoc.slowModeSec || 0} followersOnly={!!streamDoc.followersOnly} subsOnly={!!streamDoc.subsOnly} mutedUids={streamDoc.mutedUids || null} ttsEnabled={!!streamDoc.ttsEnabled}
            onAppeal={(kind) => setAppealKind(kind)}
            pinnedMessage={streamDoc.pinnedMessage || null}
            composerExtras={composerExtras}
            onListRef={setChatList}
          />
        </div>
      </div>

      {/* The goal sits at the top of the stage, where the approved preview draws
          it. Viewers cannot see a host's own placement (the broadcaster keeps it
          on their device), so this is the default spot, below whatever top
          chrome is showing. */}
      {!pipActive && !useSplit && goalCard}
      <HypeTrainView train={streamDoc.hypeTrain} />
      <LiveTrainBonus bonus={streamDoc.hypeTrainBonus} train={streamDoc.hypeTrain} hostName={hostInfo?.displayName || hostInfo?.username || streamDoc.hostUsername} />
      {!pipActive && (
        <TipComboFeed tips={tipDrops}
          style={{ bottom: aboveChat ?? `calc(var(--vg-safe-b, 0px) + ${CHAT_FEED_HEIGHT} + 24px)`, left: 10, zIndex: 9 }} />
      )}
      {!pipActive && <SubAlertOverlay lastSub={streamDoc.lastSub} anchor="bottom" bottom="calc(30vh + 84px)" />}

      {showTip && (
        <TipModal streamId={streamDoc?.id} stream={streamDoc} amount={tipAmount} setAmount={setTipAmount} message={tipMessage} setMessage={setTipMessage} onClose={() => setShowTip(false)} onSend={sendTip} sending={tipping} host={hostInfo} tipCatalog={hostInfo?.tipCatalog} />
      )}
      {shareOpen && (
        <StreamShareSheet streamId={streamDoc.id} streamTitle={streamDoc.title} hostName={hostInfo?.displayName || streamDoc.hostUsername} live={streamDoc.status === 'live'} onClose={() => setShareOpen(false)} />
      )}
      <ReactionsFloor events={reactions} position="right" />
      {/* Anchored to the LIVE chat height, not the constant. The chat feed
          collapses to 96px when the keyboard is open (see above), and pinning
          this to CHAT_FEED_HEIGHT left the ribbons floating detached over the
          video while typing. */}
      {!pipActive && (
        <JoinAnnouncer
          events={joinEvents} side="left"
          bottom={`calc(var(--vg-safe-b, 0px) + ${kb > 0 ? '96px' : CHAT_FEED_HEIGHT} + 24px)`}
        />
      )}
      {/* Portrait: 40% down the right edge, clear of the top bar, the hype train
          and the like button. Hidden in picture-in-picture with the rest of the chrome. */}
      {supportLayer('40%', pipActive)}
      <UserQuickSheet onGiftSub={(u) => { setQuickSheet(null); setGiftTo(u); }} open={!!quickSheet} uid={quickSheet?.uid} watchLiveStreamId={quickSheet?.streamId} onClose={() => setQuickSheet(null)} />
      {giftTo && (
        // ⚠ CANDIDATES ARE WHAT THIS SCREEN ALREADY HOLDS, NOT A QUERY.
        // `topGifters` and the join events are both in memory, so bulk gifting
        // costs zero reads. A search box here would be a Firestore query per
        // keystroke to find people already on screen.
        <GiftSubSheet creatorId={streamDoc.hostUid} recipient={giftTo}
          candidates={giftCandidates}
          onClose={() => setGiftTo(null)} showToast={showToast} />
      )}
      <VanguardPresence parentPath={`streams/${streamDoc.id}`} />

      {/* "…" sheet: fullscreen / report */}
      <AnimatePresence>
        {moreOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMoreOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 60 }}>
            <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: C.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '14px 14px calc(var(--vg-safe-b, 0px) + 14px)' }}>
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
      {appealKind && (
        <AppealSheet streamId={streamDoc.id} kind={appealKind} onClose={() => setAppealKind(null)} showToast={showToast} />
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
      background: C.row, color: danger ? C.red : '#fff',
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
// The appeal route for a viewer who has been timed out or banned from a chat.
//
// ⚠⚠ THE BANNER'S "Appeal" BUTTON HAD NOWHERE TO GO until this existed, and a
// route out that leads nowhere is worse than none: it reads as a way back and is
// not one. ChatStateBanner only draws that CTA when a handler is passed, so this
// component is what makes it appear at all.
//
// ⚠ THE LIMITS ARE THE SERVER'S, NOT THE DESIGN'S. adminModeration.submitAppeal
// rejects under 20 characters, truncates at 1500, and allows ONE pending appeal
// per target. The form enforces the same minimum so nobody writes an appeal and
// loses it to a server error, and the duplicate case is reported as the plain
// fact that one is already being looked at.
export function AppealSheet({ streamId, kind, onClose, showToast }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const MIN = 20;
  const timeout = kind === 'timeout';
  const short = text.trim().length < MIN;
  const send = async () => {
    if (busy || short) return;
    setBusy(true);
    try {
      await httpsCallable(getFunctions(undefined, 'europe-west1'), 'submitAppeal')({
        targetType: 'stream_chat', targetId: streamId, appealText: text.trim(),
      });
      showToast('Appeal sent. A moderator will look at it.', 'success');
      onClose();
    } catch (err) {
      const already = String(err?.code || '').includes('already-exists');
      showToast(already ? 'You already have an appeal being looked at.' : 'Could not send that appeal.', 'error');
      if (already) onClose();
    } finally { setBusy(false); }
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 120, display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: C.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 'calc(18px + var(--vg-safe-b, 0px))' }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>{timeout ? 'Appeal this timeout' : 'Appeal this ban'}</div>
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5, marginBottom: 12 }}>
          {timeout
            ? 'A timeout ends by itself. If you think it was a mistake, the channel moderators see this.'
            : 'If you think this was a mistake, the channel moderators see this.'}
        </div>
        <textarea value={text} maxLength={1500} onChange={(e) => setText(e.target.value)} rows={4}
          placeholder="What happened, in your own words?"
          style={{ width: '100%', boxSizing: 'border-box', background: C.field, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, color: C.text, fontSize: 13, outline: 'none', resize: 'none' }} />
        <div style={{ fontSize: 11, color: C.textMuted, margin: '6px 0 12px' }}>
          {short ? `${MIN - text.trim().length} more characters needed. You can still watch the stream while this is reviewed.`
            : 'You can still watch the stream while this is reviewed.'}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={busy} style={{ flex: 1, padding: 13, borderRadius: 12, border: `1px solid ${C.border}`, background: 'transparent', color: C.textDim, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
          <button onClick={send} disabled={busy || short} style={{ flex: 2, padding: 13, borderRadius: 12, border: 'none', background: C.purple, color: '#fff', fontSize: 13, fontWeight: 800, cursor: (busy || short) ? 'default' : 'pointer', opacity: (busy || short) ? 0.5 : 1 }}>{busy ? 'Sending…' : 'Send appeal'}</button>
        </div>
      </div>
    </div>
  );
}
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
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: C.card, border: `1px solid ${C.border}`, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, paddingBottom: 'calc(var(--vg-safe-b, 0px) + 20px)', color: C.text, fontFamily: '"DM Sans", system-ui, sans-serif' }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>Report this stream</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {REPORT_REASONS.map((r) => (
            <button key={r.id} onClick={() => setReason(r.id)} style={{
              padding: '8px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              background: reason === r.id ? C.dangerDim : C.row,
              border: `1px solid ${reason === r.id ? C.red : C.border}`,
              color: reason === r.id ? C.red : C.textDim,
            }}>{r.label}</button>
          ))}
        </div>
        <textarea value={details} maxLength={1000} onChange={(e) => setDetails(e.target.value)} placeholder="What happened? (optional)" rows={3}
          style={{ width: '100%', boxSizing: 'border-box', background: C.field, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, color: C.text, fontSize: 13, outline: 'none', resize: 'none', marginBottom: 12 }} />

        {/* ⚠ AN IN-APP PATH TO THE RULES, FROM THE PLACE THE RULES ARE BEING
            APPLIED. Google asks for one, and a report form is where somebody is
            already asking "is this allowed?". The route is the real one
            (AppRouter mounts /platform/acceptable-use); an invented help page
            would be worse than no link.

            Opens in a new tab on purpose: a viewer reporting a live stream should
            not lose the stream to read the policy. */}
        <a href="/platform/acceptable-use" target="_blank" rel="noopener noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12,
            color: C.textDim, textDecoration: 'none', marginBottom: 12 }}>
          <Icon name="gavel" size={13} />
          Read the community guidelines
        </a>
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
        style={{ width: '100%', maxWidth: 480, maxHeight: '64vh', overflowY: 'auto', background: C.card, border: `1px solid ${C.border}`, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 'calc(var(--vg-safe-b, 0px) + 16px)', color: C.text, fontFamily: '"DM Sans", system-ui, sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Icon name="explore" size={18} style={{ color: C.purpleLight }} />
          <div style={{ fontSize: 14, fontWeight: 800 }}>More live now</div>
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', width: 30, height: 30, borderRadius: '50%', border: 'none', background: C.rowHi, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Icon name="close" size={16} /></button>
        </div>
        {items.length === 0 ? (
          <div style={{ fontSize: 13, color: C.textDim, padding: '12px 0 18px' }}>No other live streams right now.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {items.map((h) => (
              <button key={h.streamId} onClick={() => onGo(h.streamId)} style={{ textAlign: 'left', border: 'none', background: C.row, borderRadius: 14, overflow: 'hidden', cursor: 'pointer', padding: 0 }}>
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
            marginTop: 2, fontSize: 9, fontWeight: 800, color: '#F5C842', fontFamily: 'DM Mono, monospace',
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
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, maxHeight: '72vh', overflowY: 'auto', background: C.card, border: `1px solid ${C.border}`, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, paddingBottom: 'calc(var(--vg-safe-b, 0px) + 20px)', color: C.text, fontFamily: '"DM Sans", system-ui, sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Icon name="leaderboard" size={18} style={{ color: '#F5C842' }} />
          <div style={{ fontSize: 14, fontWeight: 800 }}>Top supporters{hostName ? ` · ${hostName}` : ''}</div>
        </div>
        {gifters.length === 0 ? (
          <div style={{ fontSize: 13, color: C.textDim, padding: '8px 0 16px' }}>No tips yet. Be the first to support the stream.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {gifters.map((g, i) => (
              <div key={g.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, background: C.row }}>
                <span style={{ width: 20, textAlign: 'center', fontSize: 13, fontWeight: 900, fontFamily: 'DM Mono, monospace', color: MEDAL[i] || C.textMuted }}>{i + 1}</span>
                <UserAvatar src={g.avatar} size="sm" />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><UserName user={g} masked fallback={'Supporter'} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 800, fontFamily: 'DM Mono, monospace', color: '#F5C842' }}>
                  <CoinIcon size={13} />{compactNum(g.coins)}
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
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: C.card, border: `1px solid ${C.border}`, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 24, paddingBottom: 'calc(var(--vg-safe-b, 0px) + 20px)', color: C.text, textAlign: 'center', fontFamily: '"DM Sans", system-ui, sans-serif' }}>
        <div style={{ width: 56, height: 56, margin: '0 auto 12px', borderRadius: 16, background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(180,79,255,0.3))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="redeem" size={28} style={{ color: C.purpleLight }} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>Gift Box is coming soon</div>
        <div style={{ fontSize: 13, color: C.textDim, marginTop: 6, marginBottom: 18, lineHeight: 1.5 }}>
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
const pillBtn = { padding: '8px 14px', borderRadius: 999, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 };
function pillSm(extra = {}) { return { padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', color: '#fff', ...extra }; }
function TipModal({ amount, setAmount, message, setMessage, onClose, onSend, sending, host, tipCatalog, streamId, stream }) {
  // ⚠ TIP AND BOOST ARE THE SAME GESTURE — giving something to the person
  // streaming — so they share one surface. Founder, 2026-08-27: boost sits in
  // the gift menu like TikTok's, not as its own pill on the stream. Tip stays
  // the default; boost is the deliberate second step.
  const [giftTab, setGiftTab] = useState('tip');
  const PRESETS = [10, 50, 100, 500, 1000];
  const suggested = (tipCatalog || []).filter((e) => amount >= e.minCoins).sort((a, b) => b.minCoins - a.minCoins)[0];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: C.card, border: `1px solid ${C.border}`, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, paddingBottom: 'calc(var(--vg-safe-b, 0px) + 20px)', color: C.text, fontFamily: '"DM Sans", system-ui, sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <UserAvatar src={host?.avatar} size="md" />
          <div><div style={{ fontSize: 12, color: C.textDim }}>{giftTab === 'boost' ? 'Boost' : 'Tip'}</div><div style={{ fontSize: 14, fontWeight: 800 }}><UserName user={host} masked fallback={'host'} /></div></div>
        </div>        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[['tip', 'Tip'], ['boost', 'Boost']].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setGiftTab(id)}
              style={{
                flex: 1, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                border: 'none', fontSize: 13, fontWeight: 800,
                background: giftTab === id ? C.purple : C.row,
                color: giftTab === id ? '#fff' : C.textDim,
                boxShadow: giftTab === id ? 'inset 0 0 0 1px ' + C.purple : 'none',
              }}>{label}</button>
          ))}
        </div>

        {giftTab === 'boost' ? (
          <BoostSheet
                      target="stream"
                      targetId={streamId}
                      embedded
                      onClose={onClose}
                    />
        ) : (<>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {PRESETS.map((p) => (
            <button key={p} onClick={() => setAmount(p)} style={{ padding: '8px 14px', borderRadius: 10, background: amount === p ? C.purple : C.row, border: 'none', color: amount === p ? '#fff' : C.textDim, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{p}c</button>
          ))}
        </div>
        <input type="number" min={1} value={amount} onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value || '0', 10)))} style={{ width: '100%', boxSizing: 'border-box', background: C.field, border: `1px solid ${C.border}`, borderRadius: 12, padding: 13, color: C.text, fontSize: 14, outline: 'none', marginBottom: 10 }} />
        <input type="text" value={message} maxLength={80} onChange={(e) => setMessage(e.target.value)} placeholder={suggested ? `Optional message (default: "${suggested.message}")` : 'Optional message (up to 80 chars)'} style={{ width: '100%', boxSizing: 'border-box', background: C.field, border: `1px solid ${C.border}`, borderRadius: 12, padding: 13, color: C.text, fontSize: 14, outline: 'none', marginBottom: 6 }} />
        <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 14, lineHeight: 1.4 }}>Every message is moderated before broadcast. Vergr pays the host their revenue share of this tip.</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={sending} style={{ flex: 1, padding: 14, borderRadius: 12, border: `1px solid ${C.border}`, background: 'transparent', color: C.textDim, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>Cancel</button>
          {giftTab === 'tip' && (<button onClick={onSend} disabled={sending} style={{ flex: 2, padding: 14, borderRadius: 12, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', opacity: sending ? 0.6 : 1 }}>{sending ? 'Sending…' : `Send ${amount}c`}</button>)}
        </div>
      </>)}
      </div>
    </div>
  );
}

// ⚠ RE-EXPORTED, NOT REDEFINED. These two moved to ./states so the state layer
// owns them and MobileLiveViewer can import PlaybackStateView from there without a
// circular import. ViewerStreamScreen and the preview both import them from HERE,
// so the names stay live and neither call site had to change.
function Centered({ label, action }) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14, fontFamily: '"DM Sans", system-ui, sans-serif' }}>
      <div style={{ fontSize: 14, color: C.textDim }}>{label}</div>
      {action && <button onClick={action.onClick} style={{ padding: '12px 20px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>{action.label}</button>}
    </div>
  );
}

export { ReconnectingOverlay, StreamLoadingCover };
