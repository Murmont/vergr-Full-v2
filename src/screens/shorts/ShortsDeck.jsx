// ShortsDeck — the ONE immersive vertical player. /shorts (web + native) and
// /clip/:postId both render it; the screens only own the shell and the loader
// (useShortsFeed). Two players used to exist and drifted apart.
//
// The bar it is built to, researched 2026-09-13 against TikTok, Instagram Reels
// and YouTube Shorts, which have converged on the same interaction model:
//   - swipe up/down pages, and the slide PHYSICALLY follows the thumb
//   - tap pauses; double-tap likes, with the heart drawn WHERE you tapped and
//     more hearts on repeated taps. The single tap waits a moment so a double
//     tap does not pause and resume underneath the like.
//   - press and hold an EDGE plays at 2x (TikTok; Reels since March 2025;
//     YouTube Shorts since June 2026). Press and hold the MIDDLE opens the
//     options menu (TikTok).
//   - a rail of bare icons with counts: avatar with a follow badge, like,
//     comment, save, share. Secondary actions (Not interested, Clear screen,
//     Copy link, Report) live in a menu, which is exactly where YouTube moved
//     them in 2026 because on-screen icons had become "splotches on your
//     windshield".
//   - clear-screen mode hides every overlay (TikTok, YouTube 2026)
//   - a thin progress line that thickens under the finger, with a draggable
//     dot and a timecode above it
//   - a dedicated mute control (YouTube 2026)
//
// House rules applied here: no translucent pill, chip or button background
// (chips over video are a solid value; only full-bleed scrims let video
// through), never crop the video (letterbox bands are filled with the clip's
// own colours instead), and every inset is explicit, because Android reports
// the bottom safe-area inset as 0 and `pb-8` + `.safe-bottom` on one element
// silently drop one of the two.
//
// The slides are keyed by item id so the browser REUSES the buffered <video>
// node across a window rotation (the next slide was already preloaded, so the
// commit plays instantly, and audio never doubles because only the active slot
// is unmuted).
import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { flushSync, createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import HlsPlayer from '../../components/streams/HlsPlayer';
import LadderPlayer from './LadderPlayer';
import TwitchMirrorPlayer from '../../components/streams/TwitchMirrorPlayer';
import { streamPremium } from '../../utils/streamVisibility';
import { withRef } from '../../utils/shareRef';
import { publicUrl } from '../../utils/publicUrl';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { applyVanguardMask } from '../../utils/vanguard';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import { timeAgo, sharesToFeed } from '../../utils/helpers';
import { trackEvent } from '../../utils/trackEvent';
import { captureInterest } from '../../utils/feedRank';
import { addNegativeAuthor } from '../../utils/feedPrefs';
import { isFollowingLoaded, isFollowingCached } from '../../utils/followingCache';
import { incrementShareCount, followUser, reportPost, setShareToFeed } from '../../firebase/firestore';
import { EngageButton, useClipEngagement, COMMENT_GLYPH, SHARE_GLYPH } from '../../components/clips/Engagement';
import { soundKeyFor, soundLineFor, layeredSoundFor } from '../../utils/sounds';
import UserName from '../../components/UserName';
import CommentSheet from '../../components/CommentSheet';
import { usePlayerControls, AmbientFill, PausedGlyph, useTopAnchor, useLayeredSound } from './playerParts';
import EditOverlays, { useContentRect } from '../../components/clips/EditOverlays';
import { playbackEdits } from '../../utils/clipEdits';

const SPRING = 'transform 0.26s cubic-bezier(0.2, 0.8, 0.2, 1)';
// A chip over video is a real value, never a wash: a wash turns to mud over
// whatever frame is behind it.
const SOLID = '#15151F';
const ICON_SHADOW = 'drop-shadow(0 1px 3px rgba(0,0,0,0.55))';
const TEXT_SHADOW = '0 1px 3px rgba(0,0,0,0.7)';
const TAP_WAIT_MS = 260;      // a single tap waits this long for a second one
// Press and hold. Android's own long-press timeout is 400-500ms; at 380 a slow
// but ordinary tap could open the menu.
const HOLD_MS = 450;
const EDGE = 0.28;            // outer 28% on each side is the 2x zone
// Desktop puts the rail BESIDE the video, the way YouTube Shorts and TikTok web
// do, instead of over it. The screens size their frame with this.
export const SHORTS_RAIL_W = 84;
// Desktop comments panel beside the video, and the gap before it.
export const SHORTS_PANEL_W = 420;
export const SHORTS_PANEL_GAP = 16;
const REPORT_REASONS = ['Spam or scam', 'Harassment or bullying', 'Hate speech', 'Inappropriate content', 'Cheating or exploiting', 'Impersonation', 'Other'];

const fmtTime = (s) => {
  const t = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export default function ShortsDeck({ feed, index, setIndex, isDesktop, onRefresh, refreshing, onBack, onRemove, openCommentsId = null, onSidePanel }) {
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();

  // Comments open OVER the playing clip, never a navigation (founder,
  // 2026-09-12). The menu is the same kind of overlay.
  const [commentsFor, setCommentsFor] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const [reporting, setReporting] = useState(false);
  // Your own clip's "Also share to feed", changed from the menu (by id).
  const [feedOverride, setFeedOverride] = useState({});
  const overlayOpenRef = useRef(false); overlayOpenRef.current = !!commentsFor || !!menuFor;

  // Like / save / counts for the rail. The ref is for the gesture engine, which
  // is attached once and must not read a stale closure.
  const engage = useClipEngagement();
  const engageRef = useRef(engage); engageRef.current = engage;

  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  // The video frame. Gestures measure IT (2x edges, where the heart lands), not
  // the whole deck, because on desktop the deck also holds the rail column.
  const stageRef = useRef(null);
  const railBeside = !!isDesktop;
  // The panel renders into the FRAME (the deck's parent), because the deck
  // clips its own overflow and the panel sits outside it.
  const [frameEl, setFrameEl] = useState(null);
  useLayoutEffect(() => { setFrameEl(viewportRef.current?.parentElement || null); }, []);
  const panelOpen = railBeside && !!commentsFor;
  const onSidePanelRef = useRef(onSidePanel); onSidePanelRef.current = onSidePanel;
  useEffect(() => { onSidePanelRef.current?.(panelOpen); }, [panelOpen]);
  useEffect(() => () => onSidePanelRef.current?.(false), []);
  // The ACTIVE player's API: toggle, seek, duration, time (playerParts.jsx).
  const controlsRef = useRef(null);

  // ── live refs so the once-attached pointer handlers never read stale state ──
  const indexRef = useRef(index); indexRef.current = index;
  const feedRef = useRef(feed); feedRef.current = feed;
  const currentUserRef = useRef(currentUser); currentUserRef.current = currentUser;
  const onRefreshRef = useRef(onRefresh); onRefreshRef.current = onRefresh;
  const refreshingRef = useRef(refreshing); refreshingRef.current = refreshing;

  // ── gesture state (all refs — a drag must NEVER trigger a React render) ──
  const pointerActive = useRef(false);
  const dragging = useRef(false);
  const downOnControl = useRef(false);
  // The finger travelled. A sideways drag across the video used to end as a
  // TAP and pause the clip (measured on the device, 2026-09-13).
  const moved = useRef(false);
  const startY = useRef(0);
  const startX = useRef(0);
  const lastY = useRef(0);
  const lastT = useRef(0);
  const vel = useRef(0);          // px/ms, +down
  const animating = useRef(false);
  const wheelCooldown = useRef(0);
  const holdTimer = useRef(0);
  const holdKind = useRef(null);  // 'speed' | 'menu' | null
  const swallowClick = useRef(false); // eat the synthesized click after a drag or a hold
  const tapTimer = useRef(0);
  const lastTap = useRef(0);
  const lastHeartAt = useRef(0);

  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem('vergr_shorts_muted') === '1'; } catch { return false; }
  });
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1); speedRef.current = speed;
  const [progress, setProgress] = useState(0);
  const [scrub, setScrub] = useState(null); // fraction while the finger is on the bar
  const [buffering, setBuffering] = useState(false);
  const bufferTimer = useRef(0);
  const [hearts, setHearts] = useState([]);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [captionClamped, setCaptionClamped] = useState(false);
  const captionRef = useRef(null);
  const [justFollowed, setJustFollowed] = useState(null);
  const [clear, setClear] = useState(() => {
    try { return sessionStorage.getItem('vergr_shorts_clear') === '1'; } catch { return false; }
  });
  // First open only: the one thing a new viewer does not know is that it scrolls.
  const [showHint, setShowHint] = useState(() => {
    try { return localStorage.getItem('vergr_shorts_swiped') !== '1'; } catch { return false; }
  });

  const current = feed[index];
  // The clip as the rail should show it: loaded counts plus what this viewer
  // just liked, saved, commented or shared.
  const shown = engage.view(current) || {};
  const isLiveSlide = current?._kind === 'live';
  // The rail avatar used to be the RAW author avatar, which showed a masked
  // Vanguard persona's real face. Mask it the same way the name already was.
  const author = current && !isLiveSlide ? applyVanguardMask(current.author, profile) : null;

  // Reset per-slide UI when the active slide changes.
  useEffect(() => {
    setProgress(0);
    setScrub(null);
    setCaptionOpen(false);
    clearTimeout(bufferTimer.current);
    setBuffering(false);
    clearTimeout(tapTimer.current);
  }, [index]);

  useEffect(() => {
    if (!showHint) return undefined;
    const t = setTimeout(() => setShowHint(false), 6000);
    return () => clearTimeout(t);
  }, [showHint]);

  // A link that was about a comment (the feed's comment button, a comment
  // notification, a /post link to a clip) opens the clip WITH its sheet up, once.
  const openedComments = useRef(false);
  useEffect(() => {
    if (!openCommentsId || openedComments.current || !current || isLiveSlide) return;
    if (current.id === openCommentsId || current.slug === openCommentsId) {
      openedComments.current = true;
      setCommentsFor(current);
    }
  }, [openCommentsId, current, isLiveSlide]);

  // Whether this viewer already liked / saved the clip on screen (Engagement.jsx).
  useEffect(() => {
    if (current && !isLiveSlide) engage.load(current);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Neighbours only start downloading in earnest once the video being WATCHED
  // has enough buffered. Reset on every swipe so the new active slide gets the
  // connection to itself first. See the note in VideoPlayer.
  const [canPrefetch, setCanPrefetch] = useState(false);
  useEffect(() => { setCanPrefetch(false); }, [index]);
  const markPrefetchOk = useCallback(() => setCanPrefetch(true), []);

  // A stall only shows once it has lasted long enough to be a stall; a
  // momentary `waiting` between segments must not flash the bar.
  const onBuffering = useCallback((b) => {
    clearTimeout(bufferTimer.current);
    if (b) bufferTimer.current = setTimeout(() => setBuffering(true), 450);
    else setBuffering(false);
  }, []);

  const haptic = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { /* no haptics */ } };

  // ── the single animated commit path (drag release, wheel, arrows, keys) ──
  const animateTo = useCallback((target, after) => {
    const t = trackRef.current;
    if (!t) { after?.(); return; }
    t.style.transition = SPRING;
    t.style.transform = typeof target === 'number' ? `translateY(${target}px)` : `translateY(${target})`;
    let done = false;
    const fin = () => {
      if (done) return;
      done = true;
      t.removeEventListener('transitionend', fin);
      after?.();
    };
    t.addEventListener('transitionend', fin);
    setTimeout(fin, 320); // fallback if transitionend never fires
  }, []);

  const settleBack = useCallback(() => {
    animateTo(0, () => { const t = trackRef.current; if (t) t.style.transition = 'none'; });
  }, [animateTo]);

  const commit = useCallback((dir) => {
    if (animating.current) return;
    const i = indexRef.current;
    const len = feedRef.current.length;
    const atEdge = (dir > 0 && i >= len - 1) || (dir < 0 && i <= 0);
    if (atEdge) { settleBack(); return; }
    animating.current = true;
    animateTo(dir > 0 ? '-100%' : '100%', () => {
      // Swap the window and reset the track to 0 in ONE synchronous tick so the
      // browser never paints the intermediate state (the classic snap-back
      // flash). flushSync commits the new slide offsets; we reset + reflow
      // before yielding, so the reused (now-centered) node stays centered.
      flushSync(() => setIndex(indexRef.current + dir));
      const t = trackRef.current;
      if (t) { t.style.transition = 'none'; t.style.transform = 'translateY(0px)'; void t.offsetHeight; }
      animating.current = false;
      haptic(8);
      try { localStorage.setItem('vergr_shorts_swiped', '1'); } catch { /* private mode */ }
      setShowHint(false);
    });
  }, [animateTo, settleBack, setIndex]);

  // Double-tap like, drawn at the tap point. Only ever LIKES: it used to call
  // toggleLike, which removed a like made in an earlier session.
  const likeAt = useCallback((x, y) => {
    const item = feedRef.current[indexRef.current];
    if (!item || item._kind === 'live') return;
    haptic(18);
    const id = `${Date.now()}-${Math.random()}`;
    const rot = Math.round(Math.random() * 36 - 18);
    setHearts((h) => [...h.slice(-5), { id, x, y, rot }]);
    setTimeout(() => setHearts((h) => h.filter((k) => k.id !== id)), 900);
    lastHeartAt.current = Date.now();
    engageRef.current.like(item, true).then((r) => {
      if (r?.changed && r.on) trackEvent('like', { postId: item.id, authorId: item.authorId || item.userId, contentType: 'short', tags: item.tags?.slice?.(0, 5), gameId: item.gameId });
    });
  }, []);

  // ── pointer gesture engine (attached once; reads refs) ──
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return undefined;

    // An overlay mounted INSIDE the viewport (comment sheet, menu, scrub bar,
    // an expanded caption) must not be read as a gesture. React delegates its
    // synthetic handlers to the ROOT, which sits ABOVE this element, so a
    // stopPropagation() inside the overlay fires AFTER these native listeners
    // have already run. Opting out at the source is the only thing that works.
    const inOverlay = (e) => !!e.target?.closest?.('[data-vg-noswipe]');
    // A press on a button is the button's, never a pause or a 2x hold.
    const isControl = (e) => !!e.target?.closest?.('button, a, input, textarea, [role="button"]');

    const onDown = (e) => {
      // Reset BEFORE the overlay check. A real long press fires no click, so a
      // swallow armed by the press that opened the menu used to eat the user's
      // next genuine tap, which lands INSIDE the menu (measured on the device:
      // the first tap on Cancel did nothing).
      swallowClick.current = false;
      moved.current = false;
      if (animating.current || inOverlay(e)) return;
      pointerActive.current = true;
      dragging.current = false;
      holdKind.current = null;
      downOnControl.current = isControl(e);
      startY.current = e.clientY; startX.current = e.clientX;
      lastY.current = e.clientY; lastT.current = performance.now();
      vel.current = 0;
      clearTimeout(holdTimer.current);
      if (downOnControl.current) return;
      holdTimer.current = setTimeout(() => {
        if (dragging.current || !pointerActive.current) return;
        const item = feedRef.current[indexRef.current];
        if (!item || item._kind === 'live') return;
        clearTimeout(tapTimer.current);
        const rect = (stageRef.current || vp).getBoundingClientRect();
        const rel = (startX.current - rect.left) / (rect.width || 1);
        if (rel < EDGE || rel > 1 - EDGE) {
          holdKind.current = 'speed'; setSpeed(2); haptic(10);
        } else {
          holdKind.current = 'menu'; haptic(14); setMenuFor(item);
        }
      }, HOLD_MS);
    };

    const onMove = (e) => {
      if (!pointerActive.current) return;
      const dy = e.clientY - startY.current;
      const dx = e.clientX - startX.current;
      if (!dragging.current) {
        if (holdKind.current === 'menu') return; // the menu is open; this press is spent
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) moved.current = true;
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
          dragging.current = true;
          clearTimeout(holdTimer.current);
          clearTimeout(tapTimer.current);
          if (speedRef.current !== 1) { holdKind.current = null; setSpeed(1); }
          try { vp.setPointerCapture(e.pointerId); } catch { /* capture unsupported */ }
          const t = trackRef.current; if (t) t.style.transition = 'none';
        } else if (Math.abs(dx) > 10) {
          clearTimeout(holdTimer.current); // horizontal drift — not our gesture
        }
      }
      if (dragging.current) {
        e.preventDefault();
        let px = dy;
        const i = indexRef.current, len = feedRef.current.length;
        if ((i <= 0 && px > 0) || (i >= len - 1 && px < 0)) px = px / 3; // rubber-band edges
        const t = trackRef.current; if (t) t.style.transform = `translateY(${px}px)`;
        const now = performance.now();
        const dt = now - lastT.current;
        if (dt > 0) vel.current = (e.clientY - lastY.current) / dt;
        lastY.current = e.clientY; lastT.current = now;
      }
    };

    const onUp = (e) => {
      clearTimeout(holdTimer.current);
      if (speedRef.current !== 1) setSpeed(1);
      if (!pointerActive.current) return;
      pointerActive.current = false;
      try { vp.releasePointerCapture(e.pointerId); } catch { /* not captured */ }

      if (dragging.current) {
        dragging.current = false;
        swallowClick.current = true; // a drag must never also pause the video
        const dy = e.clientY - startY.current;
        const i = indexRef.current;
        const h = viewportRef.current?.clientHeight || window.innerHeight || 1;
        // pull-to-refresh: at the very top, a strong downward pull reloads.
        if (i <= 0 && dy > 90 && onRefreshRef.current && !refreshingRef.current) {
          settleBack();
          onRefreshRef.current();
          return;
        }
        const passDist = Math.abs(dy) > h * 0.25;
        const passVel = Math.abs(vel.current) > 0.5;
        if (dy < 0 && (passDist || passVel)) commit(1);       // up → next
        else if (dy > 0 && (passDist || passVel)) commit(-1); // down → prev
        else settleBack();
      } else if (holdKind.current) {
        // A 2x release must not pause, and the menu that opened under the
        // finger must not receive this release as a tap on its scrim.
        swallowClick.current = true;
      } else if (!downOnControl.current && !moved.current) {
        const item = feedRef.current[indexRef.current];
        if (item && item._kind !== 'live') {
          const now = Date.now();
          const rect = (stageRef.current || vp).getBoundingClientRect();
          if (now - lastTap.current < TAP_WAIT_MS || now - lastHeartAt.current < 450) {
            clearTimeout(tapTimer.current);
            lastTap.current = 0;
            likeAt(e.clientX - rect.left, e.clientY - rect.top);
          } else {
            lastTap.current = now;
            clearTimeout(tapTimer.current);
            tapTimer.current = setTimeout(() => { controlsRef.current?.toggle?.(); }, TAP_WAIT_MS);
          }
        }
      }
      holdKind.current = null;
    };

    const onClickCapture = (e) => {
      if (swallowClick.current) { swallowClick.current = false; e.stopPropagation(); e.preventDefault(); }
    };

    vp.addEventListener('pointerdown', onDown);
    vp.addEventListener('pointermove', onMove, { passive: false });
    vp.addEventListener('pointerup', onUp);
    vp.addEventListener('pointercancel', onUp);
    vp.addEventListener('click', onClickCapture, true);
    return () => {
      vp.removeEventListener('pointerdown', onDown);
      vp.removeEventListener('pointermove', onMove);
      vp.removeEventListener('pointerup', onUp);
      vp.removeEventListener('pointercancel', onUp);
      vp.removeEventListener('click', onClickCapture, true);
      clearTimeout(holdTimer.current);
      clearTimeout(tapTimer.current);
    };
  }, [commit, likeAt, settleBack]);

  // ── wheel (desktop) ──
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (e.target?.closest?.('[data-vg-noswipe]')) return; // overlays scroll themselves
      e.preventDefault();
      const now = Date.now();
      if (now - wheelCooldown.current < 320) return;
      if (Math.abs(e.deltaY) < 24) return;
      wheelCooldown.current = now;
      commit(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [commit]);

  const toggleMute = useCallback(() => setMuted((m) => {
    const n = !m;
    try { localStorage.setItem('vergr_shorts_muted', n ? '1' : '0'); } catch { /* private mode */ }
    return n;
  }), []);

  // ── keyboard ──
  useEffect(() => {
    const onKey = (e) => {
      // A comment being typed owns the keyboard, and an open sheet or menu owns
      // Escape. Without this, "m" muted mid-sentence and "j"/"k" skipped clips.
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (overlayOpenRef.current) return;
      const c = controlsRef.current;
      if (e.key === 'ArrowDown' || e.key === 'j') commit(1);
      else if (e.key === 'ArrowUp' || e.key === 'k') commit(-1);
      else if (e.key === ' ') { e.preventDefault(); c?.toggle?.(); }
      else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && c?.duration()) {
        const d = c.duration();
        c.seek((c.time() + (e.key === 'ArrowRight' ? 5 : -5)) / d);
      } else if (e.key === 'Escape') onBack?.();
      else if (e.key === 'm' || e.key === 'M') toggleMute();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit, onBack, toggleMute]);

  // ── watch-through signal (strongest short-form signal) → For You ranker ──
  useEffect(() => {
    if (!current?.id || isLiveSlide) return undefined;
    const t = setTimeout(() => {
      trackEvent('short_watched', {
        postId: current.id, authorId: current.authorId || current.userId,
        contentType: 'short', tags: current.tags?.slice?.(0, 5), gameId: current.gameId, source: 'shorts',
      });
      captureInterest({
        authorId: current.authorId || current.userId,
        hashtags: current.hashtags || current.tags,
        content: current.content, topic: current.topic, game: current.game || current.gameId,
      }, 1);
    }, 1500);
    return () => clearTimeout(t);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show "more" only when the caption genuinely overflows two lines.
  useLayoutEffect(() => {
    const el = captionRef.current;
    if (!el || captionOpen) return;
    setCaptionClamped(el.scrollHeight > el.clientHeight + 1);
  }, [current?.id, current?.content, captionOpen]);

  const handleShare = async (post) => {
    // vergr.app, never window.location.origin: in the app that is
    // http://tauri.localhost (utils/publicUrl.js). A line of text rides with
    // the link, the way TikTok and Instagram share a video.
    const url = withRef(publicUrl(`/share/clip/${post.id}`));
    const who = post.author?.username ? `@${post.author.username}` : (post.author?.displayName || 'a creator');
    const line = `Watch ${who}'s clip on VERGR`;
    if (navigator.share) {
      try {
        await navigator.share({ title: line, text: line, url });
        incrementShareCount(post.id).catch(() => {});
        engage.shared(post);
        trackEvent('share', { postId: post.id, authorId: post.authorId || post.userId, contentType: 'short', tags: post.tags?.slice?.(0, 5), gameId: post.gameId });
      } catch { /* share dismissed */ }
    } else {
      try {
        await navigator.clipboard.writeText(url);
        incrementShareCount(post.id).catch(() => {});
        engage.shared(post);
        showToast?.('Link copied', 'success');
      } catch { /* clipboard unavailable */ }
    }
  };

  const likeCurrent = () => {
    haptic(12);
    if (!current) return;
    // Sets the state the viewer can SEE, never a blind server flip (Engagement.jsx).
    engage.like(current).then((r) => {
      if (r?.changed && r.on) trackEvent('like', { postId: current.id, authorId: current.authorId || current.userId, contentType: 'short', tags: current.tags?.slice?.(0, 5), gameId: current.gameId });
    });
  };

  // ── follow from the avatar ──
  // Reads the follow list the session already loaded (followingCache), so it
  // costs no read. When that list is NOT loaded the badge is hidden rather than
  // guessed: a "+" on someone you already follow is a lie.
  const authorId = current?.authorId;
  const isOwn = !!currentUser?.uid && authorId === currentUser.uid;
  const maskedPersona = !!current?.author?.vanguard?.rank;
  const followState = !current || isLiveSlide || !authorId || isOwn || maskedPersona
    ? null
    : justFollowed === authorId
      ? 'done'
      : (currentUser && isFollowingLoaded() && !isFollowingCached(authorId) ? 'follow' : null);

  const follow = async () => {
    if (!currentUser) { showToast?.('Sign in to follow creators.', 'info'); return; }
    const id = authorId;
    haptic(12);
    setJustFollowed(id);
    try {
      await followUser(currentUser.uid, id);
      setTimeout(() => setJustFollowed((j) => (j === id ? null : j)), 900);
    } catch {
      setJustFollowed(null);
      showToast?.('Could not follow. Please try again.', 'error');
    }
  };

  // ── the sound row and disc (utils/sounds.js) ──
  // A clip that picked no sound owns its original ("original sound – name"),
  // the way TikTok does. Embeds carry no audio we host, so they get no row.
  const soundKey = current && !isLiveSlide && !current.isEmbed ? soundKeyFor(current) : null;
  const soundLine = soundKey ? soundLineFor(current, author?.displayName || author?.username) : '';
  const soundAvatar = current?.soundId ? (current.sound?.authorAvatar || null) : (author?.avatar || null);
  const openSound = () => { if (soundKey) navigate(`/sound/${encodeURIComponent(soundKey)}`); };

  // ── menu actions ──
  const closeMenu = useCallback(() => { setMenuFor(null); setReporting(false); }, []);
  const notInterested = (item) => {
    addNegativeAuthor(item.authorId);
    closeMenu();
    onRemove?.(item.id);
    showToast?.("You won't see clips from this creator here.", 'success');
  };
  const copyLink = async (item) => {
    closeMenu();
    try {
      await navigator.clipboard.writeText(withRef(publicUrl(`/share/clip/${item.id}`)));
      showToast?.('Link copied', 'success');
    } catch {
      showToast?.('Could not copy the link.', 'error');
    }
  };
  const inFeed = (item) => (item && item.id in feedOverride ? feedOverride[item.id] : sharesToFeed(item));
  const toggleFeed = async (item) => {
    closeMenu();
    const next = !inFeed(item);
    try {
      await setShareToFeed(item.id, next);
      setFeedOverride((o) => ({ ...o, [item.id]: next }));
      showToast?.(next ? 'Shared to your profile and feed' : 'Removed from your profile and feed. It stays in Clips.', 'success');
    } catch {
      showToast?.('Could not update this clip. Please try again.', 'error');
    }
  };
  const report = (item, reason) => {
    closeMenu();
    if (!currentUser) { showToast?.('Sign in to report a clip.', 'info'); return; }
    reportPost(currentUser.uid, item.id, reason)
      .then(() => showToast?.('Thanks. Our moderators will review this clip.', 'success'))
      .catch(() => showToast?.('Could not send the report. Please try again.', 'error'));
  };
  const enterClear = () => {
    closeMenu();
    setClear(true);
    try { sessionStorage.setItem('vergr_shorts_clear', '1'); } catch { /* private mode */ }
  };
  const exitClear = () => {
    setClear(false);
    try { sessionStorage.removeItem('vergr_shorts_clear'); } catch { /* private mode */ }
  };

  // ── the 3-slide window (keyed by id so buffered nodes are reused on rotate) ──
  const windowItems = useMemo(() => {
    const out = [];
    for (let d = -1; d <= 1; d++) {
      const it = feed[index + d];
      if (it) out.push({ item: it, offset: d });
    }
    return out;
  }, [feed, index]);

  const renderSlot = (item, isActive) => {
    if (!item) return null;
    if (item._kind === 'live') return isActive ? <LiveSlide stream={item} navigate={navigate} /> : <LivePoster stream={item} />;
    if (item.isEmbed) return isActive ? <EmbedFullscreen post={item} /> : <EmbedPoster post={item} />;
    const common = {
      poster: item.thumbnailUrl,
      active: isActive,
      muted,
      speed: isActive ? speed : 1,
      onProgress: isActive ? setProgress : undefined,
      controlsRef,
      onBuffering: isActive ? onBuffering : undefined,
      tapToToggle: false, // the deck owns taps (see TAP_WAIT_MS)
      // A chosen sound plays beside the video (utils/sounds.js).
      sound: layeredSoundFor(item),
      // The creator's text, stickers, speed and sound mix (utils/clipEdits.js).
      edits: playbackEdits(item),
    };
    // An HLS ladder exists for this video: let the player choose the rendition
    // from the measured connection, which is the whole point of building it.
    if (item.hlsUrl) return <LadderPlayer src={item.hlsUrl} {...common} />;
    return (
      <VideoPlayer
        src={item.videoUrl}
        {...common}
        prefetch={canPrefetch}
        onReadyToPrefetch={isActive ? markPrefetchOk : undefined}
      />
    );
  };

  const bottomInset = 'var(--vg-safe-b, 0px)';
  const scrubbing = scrub != null;

  // The creator avatar and the like / comment / save / share column. Over the
  // video on a phone; beside it on desktop. No ring on the avatar (founder).
  const railEl = current && !isLiveSlide ? (
    <div
      className={`absolute z-20 flex flex-col items-center ${railBeside ? 'right-0 gap-[8px]' : 'right-[4px] gap-[18px]'}`}
      style={{ width: railBeside ? SHORTS_RAIL_W : undefined, bottom: railBeside ? 40 : `calc(${bottomInset} + 28px)`, opacity: scrubbing ? 0 : 1, transition: 'opacity 150ms' }}
    >
      <div className={`relative ${railBeside ? 'mb-5' : 'mb-[8px]'}`}>
        <button
          type="button"
          onClick={() => navigate(`/user/${current.authorId}`)}
          aria-label="Open creator profile"
          className="block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <UserAvatar src={author?.avatar} size={48} showLiftRing={false} />
        </button>
        {followState && (
          <button
            type="button"
            onClick={follow}
            disabled={followState === 'done'}
            aria-label={followState === 'done' ? 'Following' : 'Follow'}
            className={`absolute left-1/2 -translate-x-1/2 rounded-full flex items-center justify-center transition-transform active:scale-90 before:absolute before:-inset-2 before:content-[''] ${railBeside ? '-bottom-3 w-6 h-6' : 'w-[20px] h-[20px]'}`}
            style={{ background: followState === 'done' ? '#FFFFFF' : '#F04060', bottom: railBeside ? undefined : -10 }}
          >
            <Icon name={followState === 'done' ? 'check' : 'add'} size={railBeside ? 16 : 14} className={followState === 'done' ? 'text-brand-ember' : 'text-white'} />
          </button>
        )}
      </div>
      <EngageButton variant={railBeside ? 'circle' : 'bare'} icon="favorite" label={shown.isLiked ? 'Unlike' : 'Like'} count={shown.likeCount} active={!!shown.isLiked} activeColor="text-brand-ember" onTap={likeCurrent} />
      <EngageButton variant={railBeside ? 'circle' : 'bare'} icon="chat_bubble" glyph={railBeside ? undefined : COMMENT_GLYPH} label="Comments" count={shown.commentCount} onTap={() => setCommentsFor(current)} />
      <EngageButton variant={railBeside ? 'circle' : 'bare'} icon="bookmark" label={shown.isSaved ? 'Remove from saved' : 'Save'} count={shown.saveCount} active={!!shown.isSaved} activeColor="text-brand-gold-light" onTap={() => engage.save(current)} />
      <EngageButton variant={railBeside ? 'circle' : 'bare'} icon="share" glyph={railBeside ? undefined : SHARE_GLYPH} label="Share" count={shown.shareCount} onTap={() => handleShare(current)} />
      {/* Phone: secondary actions sit under the rail, where Reels and YouTube
          Shorts keep them. Desktop keeps its ⋯ in the top bar. */}
      {!railBeside && (
        <EngageButton variant="bare" icon="more_horiz" label="More options" showCount={false} onTap={() => setMenuFor(current)} />
      )}
      {/* The sound disc: the sound's owner, spinning, the way TikTok draws it. */}
      {soundKey && (
        <button
          type="button"
          onClick={openSound}
          aria-label={`Sound: ${soundLine}`}
          className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{ width: 44, height: 44 }}
        >
          <span className="vg-spin w-full h-full rounded-full grid place-items-center" style={{ background: '#161823', boxShadow: 'inset 0 0 0 6px #22242F' }}>
            {soundAvatar
              ? <UserAvatar src={soundAvatar} size={26} showLiftRing={false} />
              : <Icon name="music_note" size={18} className="text-white" />}
          </span>
        </button>
      )}
    </div>
  ) : null;

  return (
    <div ref={viewportRef} className={`absolute inset-0 overflow-hidden select-none ${railBeside ? '' : 'bg-black'}`} style={{ touchAction: 'none' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes vergrHeartPop { 0%{transform:scale(.2);opacity:0} 15%{transform:scale(1.15);opacity:1} 35%{transform:scale(.95)} 55%{transform:scale(1);opacity:1} 100%{transform:translateY(-70px) scale(1.25);opacity:0} }
        .vergr-heart-pop { animation: vergrHeartPop .9s ease-out forwards; filter: drop-shadow(0 4px 14px rgba(240,64,96,.55)); }
        @keyframes vgEngagePop { 0%{transform:scale(1)} 40%{transform:scale(1.3)} 100%{transform:scale(1)} }
        @keyframes vgBufferSweep { 0%{transform:translateX(-100%)} 100%{transform:translateX(100%)} }
        .vg-buffer-sweep { background: linear-gradient(90deg, transparent, rgba(255,255,255,.8), transparent); animation: vgBufferSweep 1s linear infinite; }
        html[data-reduced-motion="true"] .vg-buffer-sweep { animation: none; background: rgba(255,255,255,.45); }
        html[data-reduced-motion="true"] .vergr-heart-pop { animation: none; opacity: .95; }
        @keyframes vgSpin { to { transform: rotate(360deg); } }
        .vg-spin { animation: vgSpin 6s linear infinite; }
        @keyframes vgMarquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .vg-marquee { display: inline-flex; white-space: nowrap; animation: vgMarquee 9s linear infinite; }
        .vg-cap { display: flex; }
        .vg-cap-text { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
        .vg-cap-text::before { content: ''; float: right; height: calc(100% - var(--cap-lh, 20px)); }
        .vg-cap-more { float: right; clear: both; margin-left: 6px; }
        html[data-reduced-motion="true"] .vg-spin, html[data-reduced-motion="true"] .vg-marquee { animation: none; }
        @media (prefers-reduced-motion: reduce) {
          .vg-buffer-sweep { animation: none; background: rgba(255,255,255,.45); }
          .vergr-heart-pop { animation: none; opacity: .95; }
          .vg-spin, .vg-marquee { animation: none; }
        }
      ` }} />

      {/* The video and everything drawn ON it. On desktop the rail sits outside. */}
      <div ref={stageRef} className={`absolute inset-y-0 left-0 overflow-hidden bg-black ${railBeside ? 'group' : ''}`} style={{ right: railBeside ? SHORTS_RAIL_W : 0, borderRadius: railBeside ? 16 : 0 }}>
      {/* Sliding window — ONLY the players move under the thumb. */}
      <div ref={trackRef} className="absolute inset-0" style={{ willChange: 'transform' }}>
        {windowItems.map(({ item, offset }) => (
          <div key={item.id} className="absolute inset-0" style={{ transform: `translateY(${offset * 100}%)` }}>
            {renderSlot(item, offset === 0)}
          </div>
        ))}
      </div>

      {/* An embed's iframe swallows every pointer event, so without these edge
          strips a YouTube clip could never be swiped away. */}
      {current?.isEmbed && !isLiveSlide && (
        <>
          <div aria-hidden className="absolute left-0 w-14 z-[5]" style={{ top: 96, bottom: 160 }} />
          <div aria-hidden className="absolute w-14 z-[5]" style={{ right: railBeside ? 0 : 72, top: 96, bottom: 160 }} />
        </>
      )}

      {/* Top scrim + bar */}
      {!clear && (
        <>
          {/* Desktop: the video rests clean, like TikTok web. The controls and the
              scrim behind them fade in on hover (and on keyboard focus). */}
          <div aria-hidden className={`absolute top-0 inset-x-0 z-10 pointer-events-none bg-gradient-to-b to-transparent ${railBeside ? 'h-32 from-black/55' : 'h-24 from-black/35'} ${railBeside ? 'opacity-0 group-hover:opacity-100 transition-opacity duration-200' : ''}`} />
          <div
            className={`absolute top-0 inset-x-0 z-20 flex items-center justify-between px-3 ${railBeside ? 'opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200' : ''}`}
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
          >
            <IconButton icon="arrow_back" label="Back" onClick={onBack} />
            <div className="flex items-center gap-2">
              <IconButton icon={muted ? 'volume_off' : 'volume_up'} label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute} />
              {railBeside && !isLiveSlide && current && <IconButton icon="more_horiz" label="More options" onClick={() => setMenuFor(current)} />}
              {/* A plus in a rounded square (founder, 2026-09-14), the create
                  mark people already know from TikTok and Instagram. */}
              <IconButton icon="add_box" label="Create a clip" onClick={() => navigate('/create/clip')} />
            </div>
          </div>
        </>
      )}

      {/* 2x indicator */}
      {speed === 2 && (
        <div className="absolute left-1/2 -translate-x-1/2 z-30 pointer-events-none" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 64px)' }}>
          <span className="flex items-center gap-1 h-8 px-3 rounded-full text-white text-[13px] font-bold" style={{ background: SOLID }}>
            <Icon name="fast_forward" filled size={16} /> 2x speed
          </span>
        </div>
      )}

      {/* Pull-to-refresh indicator */}
      {refreshing && (
        <div className="absolute left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 h-8 px-3 rounded-full" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 64px)', background: SOLID }}>
          <span className="w-4 h-4 border-2 border-white/30 border-t-brand-violet-light rounded-full animate-spin" />
          <span className="text-white text-xs font-semibold">Refreshing</span>
        </div>
      )}

      {/* Bottom scrim, rail, caption */}
      {!isLiveSlide && current && !clear && (
        <>
          <div
            aria-hidden
            className="absolute bottom-0 inset-x-0 z-10 pointer-events-none"
            style={{
              height: captionOpen ? '64%' : '42%',
              background: `linear-gradient(to top, rgba(0,0,0,${captionOpen ? 0.88 : 0.62}) 0%, rgba(0,0,0,0.22) 60%, rgba(0,0,0,0) 100%)`,
              transition: 'height 200ms ease-out',
            }}
          />

          {!railBeside && railEl}

          <div
            className={`absolute left-0 z-20 ${railBeside ? 'pl-4 pr-2' : 'pl-[16px]'}`}
            style={{ right: railBeside ? 16 : 80, bottom: railBeside ? 22 : `calc(${bottomInset} + 28px)`, opacity: scrubbing ? 0 : 1, transition: 'opacity 150ms' }}
          >
            <button type="button" onClick={() => navigate(`/user/${current.authorId}`)} className="flex items-baseline gap-[6px] max-w-full text-left">
              <span className={`font-bold text-white ${railBeside ? 'text-[17px]' : 'text-[16px]'} truncate`} style={{ textShadow: TEXT_SHADOW }}>
                <UserName user={current.author} masked fallback={'User'} />
              </span>
              {current.createdAt && (
                <span className={`text-white/75 shrink-0 ${railBeside ? 'text-[12px]' : 'text-[13px]'}`} style={{ textShadow: TEXT_SHADOW }}>
                  {railBeside ? '' : '· '}{timeAgo(current.createdAt?.toDate ? current.createdAt.toDate() : current.createdAt)}
                </span>
              )}
            </button>
            {(current.content || current.hashtags?.length > 0) && (
              // Closed: two lines, with "more" at the END of the second line
              // (TikTok), not on a line of its own. The float keeps it there
              // without measuring any text. Open: the whole caption, scrollable.
              <div className={captionOpen ? 'mt-[4px]' : 'vg-cap mt-[4px]'}>
                <p
                  ref={captionRef}
                  data-vg-noswipe={captionOpen ? '' : undefined}
                  className={`text-white whitespace-pre-line break-words ${railBeside ? 'text-[14px] leading-[18px]' : 'text-[15px] leading-[20px]'} ${captionOpen ? 'overflow-y-auto overscroll-contain' : 'vg-cap-text'}`}
                  style={{ textShadow: TEXT_SHADOW, maxHeight: captionOpen ? '34vh' : undefined, touchAction: captionOpen ? 'pan-y' : undefined, '--cap-lh': railBeside ? '18px' : '20px' }}
                >
                  {!captionOpen && captionClamped && (
                    <button type="button" onClick={() => setCaptionOpen(true)} className="vg-cap-more text-white font-bold">more</button>
                  )}
                  <CaptionText text={current.content} tags={current.hashtags} />
                </p>
                {captionOpen && (
                  <button
                    type="button"
                    onClick={() => setCaptionOpen(false)}
                    className="text-white font-bold text-[14px] mt-0.5"
                    style={{ textShadow: TEXT_SHADOW }}
                  >
                    less
                  </button>
                )}
              </div>
            )}
            {soundKey && (
              <button type="button" onClick={openSound} aria-label={`Sound: ${soundLine}`} className="mt-[6px] flex items-center gap-[6px] max-w-[80%] text-left">
                <Icon name="music_note" size={14} className="text-white shrink-0" style={{ filter: ICON_SHADOW }} />
                <SoundMarquee text={soundLine} />
              </button>
            )}
          </div>
        </>
      )}

      {/* Progress / scrub. Stays in clear mode: it is the video's own timeline. */}
      {!isLiveSlide && current && !current.isEmbed && (
        <Scrubber progress={progress} scrub={scrub} setScrub={setScrub} controlsRef={controlsRef} buffering={buffering} bottomInset={bottomInset} thick={railBeside} />
      )}

      {clear && (
        <button
          type="button"
          onClick={exitClear}
          aria-label="Show controls"
          className="absolute right-3 z-20 flex items-center gap-1.5 h-9 px-3 rounded-full text-white text-[13px] font-semibold"
          style={{ bottom: `calc(${bottomInset} + 34px)`, background: SOLID }}
        >
          <Icon name="visibility" size={18} /> Show
        </button>
      )}

      {/* First-open swipe hint */}
      {showHint && index === 0 && feed.length > 1 && !clear && (
        <div className="absolute inset-x-0 z-20 flex justify-center pointer-events-none" style={{ top: '56%' }}>
          <span className="flex items-center gap-1.5 h-9 px-3.5 rounded-full text-white text-[13px] font-semibold animate-bounce" style={{ background: SOLID }}>
            <Icon name={railBeside ? 'mouse' : 'swipe_up'} size={18} /> {railBeside ? 'Scroll for more' : 'Swipe up for more'}
          </span>
        </div>
      )}

      {/* Double-tap hearts, where the finger landed */}
      {hearts.map((h) => (
        <div key={h.id} className="absolute z-30 pointer-events-none" style={{ left: h.x - 48, top: h.y - 64, transform: `rotate(${h.rot}deg)` }}>
          <Icon name="favorite" filled size={96} className="text-brand-ember vergr-heart-pop" />
        </div>
      ))}

      </div>

      {railBeside && !clear && railEl}

      {/* Comments, over the clip. The video keeps playing behind the sheet. */}
      {panelOpen && frameEl ? createPortal(
        <div className="absolute top-0 bottom-0 z-[40]" style={{ left: `calc(100% + ${SHORTS_PANEL_GAP}px)`, width: SHORTS_PANEL_W }}>
          <CommentSheet
            variant="panel"
            open
            post={engage.view(commentsFor)}
            onClose={() => setCommentsFor(null)}
            onCommentAdded={() => engage.commented(commentsFor)}
            onCommentRemoved={() => engage.uncommented(commentsFor)}
          />
        </div>,
        frameEl,
      ) : (
        <CommentSheet
          open={!!commentsFor}
          post={commentsFor ? engage.view(commentsFor) : null}
          onClose={() => setCommentsFor(null)}
          // Updates the RAIL too. This used to update only the sheet's own copy,
          // so the count under the comment button never moved after posting.
          onCommentAdded={() => engage.commented(commentsFor)}
            onCommentRemoved={() => engage.uncommented(commentsFor)}
        />
      )}

      {menuFor && (
        <ClipMenu
          popover={railBeside}
          popoverRight={SHORTS_RAIL_W + 8}
          item={menuFor}
          own={!!currentUser?.uid && menuFor.authorId === currentUser.uid}
          reporting={reporting}
          setReporting={setReporting}
          onClose={closeMenu}
          onNotInterested={() => notInterested(menuFor)}
          onClear={enterClear}
          onCopy={() => copyLink(menuFor)}
          onReport={(reason) => report(menuFor, reason)}
          inFeed={inFeed(menuFor)}
          onToggleFeed={() => toggleFeed(menuFor)}
        />
      )}
    </div>
  );
}

// ─── Top bar button: a solid disc ───
// It was a bare glyph with a drop shadow, which reads as see-through over a bright
// frame (founder, 2026-09-14: "the header buttons over the video are see-through;
// this should be fixed"). A solid value, never a wash: a wash turns to mud.
function IconButton({ icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      // Explicit px: the root font is 14px, so w-10 rendered 35px (measured).
      className="w-[40px] h-[40px] rounded-full flex items-center justify-center text-white transition-transform active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      style={{ background: SOLID }}
    >
      <Icon name={icon} size={22} />
    </button>
  );
}

// ─── Sound row text: scrolls sideways when it does not fit, like TikTok's ───
function SoundMarquee({ text }) {
  const boxRef = useRef(null);
  const innerRef = useRef(null);
  const [run, setRun] = useState(false);
  useLayoutEffect(() => { setRun(false); }, [text]);
  useLayoutEffect(() => {
    if (run) return;
    const b = boxRef.current, i = innerRef.current;
    if (b && i) setRun(i.scrollWidth > b.clientWidth + 1);
  }, [text, run]);
  return (
    <span ref={boxRef} className="block min-w-0 overflow-hidden text-[13px] font-medium" style={{ color: '#E5E5E5', textShadow: TEXT_SHADOW }}>
      <span ref={innerRef} className={run ? 'vg-marquee' : 'block truncate'}>
        {run ? (<><span className="pr-10">{text}</span><span className="pr-10" aria-hidden="true">{text}</span></>) : text}
      </span>
    </span>
  );
}

// ─── Caption: hashtags in bold, inline where the creator wrote them ───
// The old overlay printed post.hashtags as a separate row as well, so every tag
// written in the caption appeared twice. Tags only get appended when the text
// itself carries none.
function CaptionText({ text, tags }) {
  const parts = String(text || '').split(/(#[\p{L}\p{N}_]+)/u);
  const inline = parts.length > 1;
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <span key={i} className="font-bold">{p}</span> : p))}
      {!inline && Array.isArray(tags) && tags.length > 0 && (
        <>{text ? ' ' : ''}{tags.map((t, i) => <span key={t} className="font-bold">{i ? ' ' : ''}#{t}</span>)}</>
      )}
    </>
  );
}

// ─── Progress line that becomes a scrubber under the finger ───
function Scrubber({ progress, scrub, setScrub, controlsRef, buffering, bottomInset, thick = false }) {
  const barRef = useRef(null);
  const dragRef = useRef(false);
  const pending = useRef(0);
  const raf = useRef(0);

  const frac = (e) => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r || !r.width) return 0;
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  const apply = () => { raf.current = 0; controlsRef.current?.seek(pending.current); };
  const queue = () => { if (!raf.current) raf.current = requestAnimationFrame(apply); };

  const down = (e) => {
    const c = controlsRef.current;
    if (!c || !c.duration()) return;
    dragRef.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture unsupported */ }
    pending.current = frac(e);
    setScrub(pending.current);
    queue();
  };
  const move = (e) => {
    if (!dragRef.current) return;
    pending.current = frac(e);
    setScrub(pending.current);
    queue();
  };
  const up = (e) => {
    if (!dragRef.current) return;
    dragRef.current = false;
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; }
    controlsRef.current?.seek(pending.current);
    setScrub(null);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  };

  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  const active = scrub != null;
  const value = active ? scrub : Math.min(1, progress || 0);
  const dur = controlsRef.current?.duration?.() || 0;

  return (
    <div
      data-vg-noswipe=""
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className="absolute inset-x-0 z-[25]"
      style={{ bottom: bottomInset, height: 28, touchAction: 'none' }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {active && dur > 0 && (
        <div
          className="absolute inset-x-0 text-center text-white font-dmmono font-bold tabular-nums pointer-events-none"
          style={{ bottom: 44, fontSize: 22, textShadow: TEXT_SHADOW }}
        >
          {fmtTime(value * dur)}<span style={{ opacity: 0.6 }}> / {fmtTime(dur)}</span>
        </div>
      )}
      <div
        ref={barRef}
        className="absolute inset-x-0 bottom-0 overflow-hidden"
        style={{ height: active ? 6 : (thick ? 4 : 2), background: 'rgba(255,255,255,0.22)', transition: 'height 120ms ease-out' }}
      >
        <div className="h-full bg-white" style={{ width: `${value * 100}%` }} />
        {buffering && !active && <div className="absolute inset-0 vg-buffer-sweep" />}
      </div>
      {active && (
        <div
          className="absolute w-3.5 h-3.5 rounded-full bg-white pointer-events-none"
          style={{ left: `calc(${value * 100}% - 7px)`, bottom: -4, boxShadow: '0 1px 4px rgba(0,0,0,0.5)' }}
        />
      )}
    </div>
  );
}

// ─── Options menu (hold the middle of the clip, or ⋯) ───
// popover (desktop): a small dropdown under the ⋯ button, inside the video, the
// way TikTok web and YouTube open it. Sheet (phone): the bottom sheet.
function ClipMenu({ item, own, reporting, setReporting, onClose, onNotInterested, onClear, onCopy, onReport, inFeed = true, onToggleFeed, popover = false, popoverRight = 12 }) {
  const panelRef = useRef(null);

  // A modal is a modal: focus moves in, returns on close, Escape dismisses.
  useEffect(() => {
    const previous = document.activeElement;
    return () => { try { previous?.focus?.(); } catch { /* element gone */ } };
  }, []);
  useEffect(() => {
    panelRef.current?.querySelector('button')?.focus();
  }, [reporting]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const Row = ({ icon, label, sub, danger, onClick }) => (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center text-left outline-none active:bg-[#1E1E2C] focus-visible:bg-[#1E1E2C] ${popover ? 'gap-3 px-4 py-2.5 hover:bg-[#1E1E2C]' : 'gap-4 px-5 py-3.5'}`}
    >
      <Icon name={icon} size={22} className={danger ? 'text-brand-ember' : 'text-white'} />
      <span className="min-w-0">
        <span className={`block text-[15px] font-semibold ${danger ? 'text-brand-ember' : 'text-white'}`}>{label}</span>
        {sub && <span className="block text-[12px] text-text-muted mt-0.5 truncate">{sub}</span>}
      </span>
    </button>
  );

  return (
    <div
      data-vg-noswipe=""
      className={`absolute inset-0 z-[140] ${popover ? '' : 'flex flex-col justify-end'}`}
      role="dialog"
      aria-modal="true"
      aria-label={reporting ? 'Report clip' : 'Clip options'}
    >
      <button type="button" data-scrim="" className={`absolute inset-0 ${popover ? '' : 'bg-black/55'}`} onClick={onClose} aria-label="Close" />
      <div
        ref={panelRef}
        className={popover ? 'absolute w-[264px] rounded-2xl py-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.6)]' : 'relative rounded-t-2xl pt-2'}
        style={popover ? { background: '#14141F', top: 56, right: popoverRight } : { background: '#14141F', paddingBottom: 'calc(var(--vg-safe-b, 0px) + 10px)' }}
      >
        {!popover && <span aria-hidden className="block mx-auto mb-2 w-9 h-1 rounded-full" style={{ background: '#2E2E40' }} />}
        {reporting ? (
          <>
            <p className="px-5 pt-1 pb-2 text-[13px] font-semibold text-text-muted">Why are you reporting this clip?</p>
            {REPORT_REASONS.map((r) => <Row key={r} icon="flag" label={r} onClick={() => onReport(r)} />)}
            <Row icon="arrow_back" label="Back" onClick={() => setReporting(false)} />
          </>
        ) : (
          <>
            {!own && (
              <Row
                icon="visibility_off"
                label="Not interested"
                sub="Hide clips from this creator here"
                onClick={onNotInterested}
              />
            )}
            {own && onToggleFeed && (
              <Row
                icon={inFeed ? 'grid_off' : 'dynamic_feed'}
                label={inFeed ? 'Remove from profile & feed' : 'Also share to feed'}
                sub={inFeed ? 'It stays in Clips' : 'Show it on your profile and in home feeds'}
                onClick={onToggleFeed}
              />
            )}
            <Row icon="fullscreen" label="Clear screen" sub="Hide buttons and captions" onClick={onClear} />
            <Row icon="link" label="Copy link" onClick={onCopy} />
            {!own && <Row icon="flag" label="Report" danger onClick={() => setReporting(true)} />}
            <Row icon="close" label="Cancel" onClick={onClose} />
          </>
        )}
        <span className="sr-only">{item?.content || ''}</span>
      </div>
    </div>
  );
}

// ─── Floating back button (loading and empty states) ───
export function ShortsBackFab({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Go back"
      className="absolute left-3 z-[120] w-11 h-11 rounded-full flex items-center justify-center text-white active:scale-95 transition-transform"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
    >
      <Icon name="arrow_back" size={26} style={{ filter: ICON_SHADOW }} />
    </button>
  );
}

// ─── Live stream slide (interleaved into the Shorts/clips feed) ───
export function LiveSlide({ stream, navigate }) {
  const isTwitch = stream.source === 'twitch' && !!stream.twitchChannel;
  const playbackUrl = stream.compositeHlsUrl || stream.hlsUrl || null;
  const viewers = stream.viewerCount || 0;
  const enter = () => navigate(`/watch/${stream.id}`);

  // A PREMIUM live never autoplays here.
  //
  // Not merely because it cannot (the server withholds hlsUrl from a paid
  // stream, so there is nothing to play) but because it MUST NOT: a looping
  // preview of paid content is the paywall leaking, handing every scroller a
  // free sample of the thing they are being asked to buy. It shows a still and
  // a price instead, which is also how Tango presents these.
  const { isPremium, priceCoins } = streamPremium(stream);
  const still = stream.thumbnailUrl || stream.coverUrl || stream.thumbUrl || null;

  return (
    <div className="absolute inset-0 bg-black" onClick={enter}>
      {isPremium ? (
        <>
          {still
            ? <img src={still} alt="" className="w-full h-full object-cover opacity-60" />
            : <div className="w-full h-full bg-gradient-to-br from-brand-violet/30 via-black to-brand-pink/20" />}
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon name="lock" className="text-white/85 text-[56px] drop-shadow-lg" />
          </div>
        </>
      ) : isTwitch ? (
        <TwitchMirrorPlayer username={stream.twitchChannel} autoplay muted fill />
      ) : playbackUrl ? (
        <HlsPlayer src={playbackUrl} controls={false} muted autoPlay className="w-full h-full" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white/40 text-sm">Live</div>
      )}

      <div
        className="absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1 rounded-full text-white text-[11px] font-bold tracking-wider shadow-lg"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 64px)', background: isPremium ? 'linear-gradient(135deg, #C87FFF 0%, #7B1FFF 100%)' : '#F04060' }}
      >
        {isPremium ? (
          <>
            PREMIUM
            {priceCoins > 0 && (
              <>
                <Icon name="paid" size={12} className="text-brand-gold-light" />
                <span className="font-dmmono tabular-nums">{priceCoins.toLocaleString()}</span>
              </>
            )}
          </>
        ) : (
          <><span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE</>
        )}
      </div>

      <div
        className="absolute bottom-0 left-0 right-0 z-10 px-4 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
        style={{ paddingBottom: 'calc(var(--vg-safe-b, 0px) + 28px)', paddingTop: 48 }}
      >
        <div className="flex items-center gap-2.5 mb-3">
          <UserAvatar
            src={stream.hostAvatar}
            size={44}
            isLive
            isPremiumLive={isPremium}
            className={isPremium ? 'border-2 border-brand-violet-light' : 'border-2 border-brand-ember'}
          />
          <div className="min-w-0">
            <p className="text-white font-bold text-sm truncate">{stream.hostUsername || 'Live now'}</p>
            <p className="text-white/60 text-[11px] font-dmmono flex items-center gap-2">
              <span className="truncate">{stream.title || stream.game || 'Live stream'}</span>
              <span className="flex items-center gap-1 shrink-0"><Icon name="visibility" size={11} /> {viewers.toLocaleString()}</span>
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); enter(); }}
          className="w-full py-3 rounded-2xl text-white font-bold text-sm flex items-center justify-center gap-2"
          style={{ background: isPremium ? 'linear-gradient(135deg, #C87FFF 0%, #7B1FFF 100%)' : '#F04060' }}
        >
          {isPremium ? (
            <>
              <Icon name="lock_open" size={18} />
              {priceCoins > 0 ? `Join for ${priceCoins.toLocaleString()} coins` : 'Join'}
            </>
          ) : (
            <><Icon name="play_arrow" size={20} /> Tap to watch live</>
          )}
        </button>
      </div>
    </div>
  );
}

// Cheap placeholder for a live slide that is NOT the active slot (avoids
// spinning up extra HLS players in the prev/next window slots).
function LivePoster({ stream }) {
  const { isPremium, priceCoins } = streamPremium(stream);
  return (
    <div className="absolute inset-0 bg-black flex items-center justify-center">
      {stream.thumbnailUrl && <img src={stream.thumbnailUrl} alt="" className={`w-full h-full object-cover ${isPremium ? 'opacity-50' : 'opacity-70'}`} />}
      <div
        className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-full text-white text-[11px] font-bold tracking-wider"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 64px)', background: isPremium ? 'linear-gradient(135deg, #C87FFF 0%, #7B1FFF 100%)' : '#F04060' }}
      >
        {isPremium ? (
          <>
            PREMIUM
            {priceCoins > 0 && (
              <>
                <Icon name="paid" size={12} className="text-brand-gold-light" />
                <span className="font-dmmono tabular-nums">{priceCoins.toLocaleString()}</span>
              </>
            )}
          </>
        ) : (
          <><span className="w-1.5 h-1.5 rounded-full bg-white" /> LIVE</>
        )}
      </div>
    </div>
  );
}

// ─── Native vertical video player ───
export function VideoPlayer({
  src, poster, active = true, muted = false, speed = 1, onProgress, onReadyToPrefetch, prefetch = false,
  controlsRef, onBuffering, tapToToggle = true, sound = null, edits = null,
}) {
  const ref = useRef(null);
  const boxRef = useRef(null);
  // A chosen sound can replace the clip's own audio (utils/sounds.js).
  const videoMuted = muted || (!!sound && !sound.keepOriginal);
  const objectPosition = useTopAnchor(ref, src, poster);
  // The creator's edits: a base speed under hold-to-2x, the sound mix, and text
  // and stickers drawn over the picture (observed only when there are some).
  const baseSpeed = edits?.speed || 1;
  const overlays = edits?.overlays || [];
  const rect = useContentRect(boxRef, ref, objectPosition === 'center top', overlays.length > 0);
  useLayeredSound({ ref, active, muted, sound, volume: edits?.soundVolume ?? 1, timeScale: baseSpeed });
  useEffect(() => {
    const v = ref.current;
    if (v) v.volume = edits?.originalVolume ?? 1;
  }, [edits?.originalVolume]);
  const [paused, setPaused] = useState(false);
  const userPaused = useRef(false);
  const wasActive = useRef(false);
  const rafRef = useRef(0);

  // PREFETCH DISCIPLINE — why the neighbours do not start on "auto".
  //
  // Three mounted <video> elements all on preload="auto" means three downloads
  // competing for one connection, and the one that loses is the one the user is
  // actually watching. TikTok never shows a spinner precisely because upcoming
  // videos get what is left over rather than an equal share. So a neighbour
  // holds at "metadata" until the ACTIVE video reports it has enough buffered,
  // at which point the deck flips `prefetch` on and the next swipe is still
  // instant.
  useEffect(() => {
    if (!active) return undefined;
    const v = ref.current;
    if (!v || !onReadyToPrefetch) return undefined;
    // readyState 3 = HAVE_FUTURE_DATA: enough to keep playing, so spare
    // bandwidth now genuinely is spare.
    const check = () => { if (v.readyState >= 3) onReadyToPrefetch(); };
    check();
    v.addEventListener('canplay', check);
    v.addEventListener('progress', check);
    return () => {
      v.removeEventListener('canplay', check);
      v.removeEventListener('progress', check);
    };
  }, [active, onReadyToPrefetch]);

  // Play/pause + mute follow `active` (only the active slot has audio + plays).
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active) {
      v.muted = videoMuted;
      if (!wasActive.current) { try { v.currentTime = 0; } catch { /* not seekable yet */ } userPaused.current = false; setPaused(false); }
      if (!userPaused.current) { v.play().catch(() => {}); }
    } else {
      v.muted = true;
      v.pause();
    }
    wasActive.current = active;
  }, [active, videoMuted]);

  // Hold-to-2x (and reset), on top of the clip's own edited speed.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.defaultPlaybackRate = baseSpeed;
    v.playbackRate = (active ? speed : 1) * baseSpeed;
  }, [speed, active, baseSpeed]);

  // Progress → rAF-throttled callback (active slot only).
  useEffect(() => {
    const v = ref.current;
    if (!v || !active || !onProgress) return undefined;
    const onTime = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        onProgress(v.duration ? v.currentTime / v.duration : 0);
      });
    };
    v.addEventListener('timeupdate', onTime);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [active, onProgress]);

  // Pause when backgrounded (saves battery + mobile data), resume on return.
  useEffect(() => {
    const onVis = () => {
      const v = ref.current;
      if (!v || !active) return;
      if (document.hidden) v.pause();
      else if (!userPaused.current) v.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [active]);

  usePlayerControls({ ref, active, controlsRef, onBuffering, userPaused, setPaused });

  const toggle = () => {
    const v = ref.current;
    if (!v || !active) return;
    if (v.paused) { v.play().catch(() => {}); userPaused.current = false; setPaused(false); }
    else { v.pause(); userPaused.current = true; setPaused(true); }
  };

  return (
    <div ref={boxRef} className="absolute inset-0 flex items-center justify-center bg-black overflow-hidden" onClick={tapToToggle ? toggle : undefined}>
      <AmbientFill videoRef={ref} active={active} />
      <video
        ref={ref}
        src={src}
        poster={poster}
        loop
        playsInline
        preload={active || prefetch ? 'auto' : 'metadata'}
        muted={active ? videoMuted : true}
        className="relative z-[1] w-full h-full object-contain"
        style={{ objectPosition }}
      />
      <EditOverlays overlays={overlays} rect={rect} />
      {active && paused && <PausedGlyph />}
    </div>
  );
}

// ─── Embedded video fullscreen (a deep-linked embed clip opens here) ───
export function EmbedFullscreen({ post }) {
  const [loaded, setLoaded] = useState(false);
  let embedSrc = null;
  let posterUrl = null;
  if (post.youtubeVideoId) {
    embedSrc = `https://www.youtube-nocookie.com/embed/${post.youtubeVideoId}?autoplay=1&controls=1&modestbranding=1&rel=0&playsinline=1&mute=0`;
    posterUrl = `https://img.youtube.com/vi/${post.youtubeVideoId}/hqdefault.jpg`;
  } else if (post.embedVideoUrl) {
    const match = post.embedVideoUrl.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (match) {
      embedSrc = `https://www.youtube-nocookie.com/embed/${match[1]}?autoplay=1&controls=1&modestbranding=1&rel=0&playsinline=1&mute=0`;
      posterUrl = `https://img.youtube.com/vi/${match[1]}/hqdefault.jpg`;
    }
  }
  if (!embedSrc) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black">
      {posterUrl && <img src={posterUrl} alt="" className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 ${loaded ? 'opacity-0' : 'opacity-100'}`} />}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[2]">
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: SOLID }}>
            <div className="w-6 h-6 border-2 border-brand-violet-light border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      )}
      <iframe src={embedSrc} onLoad={() => setLoaded(true)} className="w-full h-full relative z-[1]"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen frameBorder="0" title="Short" />
    </div>
  );
}

function EmbedPoster({ post }) {
  const yid = post.youtubeVideoId || (post.embedVideoUrl && (post.embedVideoUrl.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/) || [])[1]);
  const poster = yid ? `https://img.youtube.com/vi/${yid}/hqdefault.jpg` : post.thumbnailUrl;
  return <div className="absolute inset-0 bg-black flex items-center justify-center">{poster && <img src={poster} alt="" className="w-full h-full object-contain" />}</div>;
}

// ─── Engagement button ───
// Kept as a named export because ShortsScreen re-exports it. The one
// implementation lives in components/clips/Engagement.jsx.
export { EngageButton as EngageBtn };
