// ShortsDeck — the interactive TikTok-style immersive Shorts player (B6).
//
// This is the SHARED engine for both the web (ShortsScreen) and native
// (NativeShortsScreen) shells. Those screens own data-loading + the sizing
// shell; the deck owns everything the finger touches:
//   • a 3-slide window (prev / current / next) that PHYSICALLY follows the
//     thumb and settles with a spring (no hard remount — the old flick-detector
//     was the single biggest "cheap vs TikTok" tell),
//   • pointer-driven drag written DIRECTLY to the DOM node (never React state
//     per frame, so a drag never re-renders),
//   • release commit on distance (>25% viewport) OR flick velocity (>0.5 px/ms),
//   • the same commit path for wheel / arrows / on-screen buttons,
//   • double-tap like + heart burst, tap = pause/play, long-press = 2x speed,
//     a top progress bar, and a persisted mute toggle.
//
// The slides are keyed by item id so the browser REUSES the buffered <video>
// node across a window rotation (the next slide was already preloaded → the
// commit plays instantly, and audio never doubles because only the active slot
// is unmuted).
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import HlsPlayer from '../../components/streams/HlsPlayer';
import LadderPlayer from './LadderPlayer';
import TwitchMirrorPlayer from '../../components/streams/TwitchMirrorPlayer';
import { getPlaybackUrl } from '../../utils/streamConfig';
import { withRef } from '../../utils/shareRef';
import { useAuth } from '../../context/AuthContext';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import { timeAgo } from '../../utils/helpers';
import { trackEvent } from '../../utils/trackEvent';
import { captureInterest } from '../../utils/feedRank';
import { toggleLike, incrementShareCount } from '../../firebase/firestore';

const SPRING = 'transform 0.26s cubic-bezier(0.2, 0.8, 0.2, 1)';

export default function ShortsDeck({ feed, index, setIndex, isDesktop, onRefresh, refreshing, onBack }) {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const viewportRef = useRef(null);
  const trackRef = useRef(null);

  // ── live refs so the once-attached pointer handlers never read stale state ──
  const indexRef = useRef(index); indexRef.current = index;
  const feedRef = useRef(feed); feedRef.current = feed;
  const currentUserRef = useRef(currentUser); currentUserRef.current = currentUser;
  const onRefreshRef = useRef(onRefresh); onRefreshRef.current = onRefresh;
  const refreshingRef = useRef(refreshing); refreshingRef.current = refreshing;

  // ── drag state (all refs — a drag must NEVER trigger a React render) ──
  const pointerActive = useRef(false);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startX = useRef(0);
  const lastY = useRef(0);
  const lastT = useRef(0);
  const vel = useRef(0);          // px/ms, +down
  const animating = useRef(false);
  const wheelCooldown = useRef(0);
  const holdTimer = useRef(0);
  const speedEngaged = useRef(false); // suppress tap-like after a 2x-hold release
  const swallowClick = useRef(false); // eat the synthesized click after a drag / 2x-hold
  const lastTap = useRef(0);

  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem('vergr_shorts_muted') === '1'; } catch { return false; }
  });
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1); speedRef.current = speed;
  const [progress, setProgress] = useState(0);
  const [heartBurst, setHeartBurst] = useState(0);

  const current = feed[index];
  const isLiveSlide = current?._kind === 'live';

  // reset the progress bar when the active slide changes
  useEffect(() => { setProgress(0); }, [index]);

  // Neighbours only start downloading in earnest once the video being WATCHED
  // has enough buffered. Reset on every swipe so the new active slide gets the
  // connection to itself first. See the note in VideoPlayer.
  const [canPrefetch, setCanPrefetch] = useState(false);
  useEffect(() => { setCanPrefetch(false); }, [index]);
  const markPrefetchOk = useCallback(() => setCanPrefetch(true), []);

  const haptic = (ms = 8) => { try { navigator.vibrate?.(ms); } catch {} };

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
    });
  }, [animateTo, settleBack, setIndex]);

  const doubleTapLike = useCallback(() => {
    const i = indexRef.current;
    const item = feedRef.current[i];
    const user = currentUserRef.current;
    if (!item || item._kind === 'live') return;
    haptic(18);
    setHeartBurst(Date.now());
    if (user && !item.isLiked) {
      toggleLike?.(item.id, user.uid);
      item.isLiked = true;
      trackEvent('like', { postId: item.id, authorId: item.authorId || item.userId, contentType: 'short', tags: item.tags?.slice?.(0, 5), gameId: item.gameId });
    }
  }, []);

  // ── pointer drag engine (attached once; reads refs) ──
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    const onDown = (e) => {
      if (animating.current) return;
      pointerActive.current = true;
      dragging.current = false;
      speedEngaged.current = false;
      swallowClick.current = false;
      startY.current = e.clientY; startX.current = e.clientX;
      lastY.current = e.clientY; lastT.current = performance.now();
      vel.current = 0;
      // long-press → 2x speed (TikTok). Cancelled the moment a drag begins.
      clearTimeout(holdTimer.current);
      holdTimer.current = setTimeout(() => {
        if (!dragging.current && pointerActive.current) {
          const item = feedRef.current[indexRef.current];
          if (item && item._kind !== 'live') { speedEngaged.current = true; setSpeed(2); haptic(10); }
        }
      }, 350);
    };

    const onMove = (e) => {
      if (!pointerActive.current) return;
      const dy = e.clientY - startY.current;
      const dx = e.clientX - startX.current;
      if (!dragging.current) {
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
          dragging.current = true;
          clearTimeout(holdTimer.current);
          if (speedRef.current !== 1) { speedEngaged.current = false; setSpeed(1); }
          try { vp.setPointerCapture(e.pointerId); } catch {}
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
      try { vp.releasePointerCapture(e.pointerId); } catch {}

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
          speedEngaged.current = false;
          return;
        }
        const passDist = Math.abs(dy) > h * 0.25;
        const passVel = Math.abs(vel.current) > 0.5;
        if (dy < 0 && (passDist || passVel)) commit(1);       // up → next
        else if (dy > 0 && (passDist || passVel)) commit(-1); // down → prev
        else settleBack();
      } else if (speedEngaged.current) {
        swallowClick.current = true; // 2x-hold release shouldn't pause
      } else {
        // tap (no drag). Single tap = the video's own onClick pause/play; here we
        // only add double-tap-to-like.
        const now = Date.now();
        if (now - lastTap.current < 300) { doubleTapLike(); lastTap.current = 0; }
        else lastTap.current = now;
      }
      speedEngaged.current = false;
    };

    // Eat the synthesized click after a drag or a 2x-hold so the video's own
    // onClick (pause/play) doesn't fire from a gesture.
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
    };
  }, [commit, doubleTapLike, settleBack]);

  // ── wheel (desktop) ──
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e) => {
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

  // ── keyboard ──
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'j') commit(1);
      else if (e.key === 'ArrowUp' || e.key === 'k') commit(-1);
      else if (e.key === 'Escape') onBack?.();
      else if (e.key === 'm' || e.key === 'M') toggleMute();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit, onBack]);

  // ── watch-through signal (strongest short-form signal) → For You ranker ──
  useEffect(() => {
    if (!current?.id || isLiveSlide) return;
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

  const toggleMute = () => setMuted((m) => {
    const n = !m;
    try { localStorage.setItem('vergr_shorts_muted', n ? '1' : '0'); } catch {}
    return n;
  });

  const handleShare = async (post) => {
    const url = withRef(`${window.location.origin}/share/clip/${post.id}`);
    if (navigator.share) {
      try {
        await navigator.share({ title: post.content?.slice(0, 50) || 'Check this on VERGR', url });
        incrementShareCount(post.id).catch(() => {});
        trackEvent('share', { postId: post.id, authorId: post.authorId || post.userId, contentType: 'short', tags: post.tags?.slice?.(0, 5), gameId: post.gameId });
      } catch {}
    } else {
      try { await navigator.clipboard.writeText(url); incrementShareCount(post.id).catch(() => {}); } catch {}
    }
  };

  const likeCurrent = () => {
    haptic(12);
    if (currentUser && current) {
      toggleLike?.(current.id, currentUser.uid);
      trackEvent('like', { postId: current.id, authorId: current.authorId || current.userId, contentType: 'short', tags: current.tags?.slice?.(0, 5), gameId: current.gameId });
    }
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
    // An HLS ladder exists for this video: let the player choose the rendition
    // from the measured connection, which is the whole point of building it.
    if (item.hlsUrl) {
      return (
        <LadderPlayer
          src={item.hlsUrl} poster={item.thumbnailUrl}
          active={isActive} muted={muted}
          speed={isActive ? speed : 1}
          onProgress={isActive ? setProgress : undefined}
        />
      );
    }
    return (
      <VideoPlayer
        src={item.videoUrl} poster={item.thumbnailUrl}
        active={isActive} muted={muted}
        speed={isActive ? speed : 1}
        onProgress={isActive ? setProgress : undefined}
        prefetch={canPrefetch}
        onReadyToPrefetch={isActive ? markPrefetchOk : undefined}
      />
    );
  };

  return (
    <div ref={viewportRef} className="absolute inset-0 overflow-hidden bg-black select-none" style={{ touchAction: 'none' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes vergrHeartPop { 0%{transform:scale(.3);opacity:0} 15%{transform:scale(1.1);opacity:.95} 40%{transform:scale(1);opacity:.9} 100%{transform:scale(1.3);opacity:0} }
        .vergr-heart-pop { animation: vergrHeartPop .8s ease-out forwards; filter: drop-shadow(0 0 18px rgba(240,64,96,.7)); }
      ` }} />

      {/* Sliding window — ONLY the players move under the thumb. */}
      <div ref={trackRef} className="absolute inset-0" style={{ willChange: 'transform' }}>
        {windowItems.map(({ item, offset }) => (
          <div key={item.id} className="absolute inset-0" style={{ transform: `translateY(${offset * 100}%)` }}>
            {renderSlot(item, offset === 0)}
          </div>
        ))}
      </div>

      {/* Top progress bar (active video) */}
      {!isLiveSlide && (
        <div className="absolute top-0 left-0 right-0 h-[3px] z-30 bg-white/10 pointer-events-none">
          <div className="h-full bg-white/85" style={{ width: `${Math.min(100, progress * 100)}%` }} />
        </div>
      )}

      {/* 2x speed pill */}
      {speed === 2 && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
          <span className="px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm text-white text-sm font-bold flex items-center gap-1">
            <Icon name="fast_forward" size={16} /> 2x
          </span>
        </div>
      )}

      {/* Desktop scroll affordance */}
      {isDesktop && (
        <div className="absolute right-4 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-3">
          <button onClick={() => commit(-1)} disabled={index === 0}
            className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 flex items-center justify-center text-white transition-colors" title="Previous">
            <Icon name="keyboard_arrow_up" size={26} />
          </button>
          <button onClick={() => commit(1)} disabled={index >= feed.length - 1}
            className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 flex items-center justify-center text-white transition-colors" title="Next">
            <Icon name="keyboard_arrow_down" size={26} />
          </button>
        </div>
      )}

      {/* Pull-to-refresh indicator */}
      {refreshing && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm">
          <span className="w-4 h-4 border-2 border-white/30 border-t-brand-violet-light rounded-full animate-spin" />
          <span className="text-white text-xs font-semibold">Refreshing</span>
        </div>
      )}

      {/* Double-tap heart burst */}
      {heartBurst > 0 && (
        <div key={heartBurst} className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <Icon name="favorite" filled size={120} className="text-brand-ember vergr-heart-pop" />
        </div>
      )}

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 pt-4 pb-10 bg-gradient-to-b from-black/70 to-transparent safe-top">
        <button onClick={onBack} className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center">
          <Icon name="arrow_back" size={22} className="text-white" />
        </button>
        <h2 className="font-syne font-bold text-white text-base tracking-tight">Shorts</h2>
        <div className="flex items-center gap-2">
          <button onClick={toggleMute} className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center" title={muted ? 'Unmute' : 'Mute'}>
            <Icon name={muted ? 'volume_off' : 'volume_up'} size={20} className="text-white" />
          </button>
          <button onClick={() => navigate('/create/short')} className="w-10 h-10 rounded-full bg-brand-violet/25 backdrop-blur-md flex items-center justify-center">
            <Icon name="videocam" size={20} className="text-brand-violet-light" />
          </button>
        </div>
      </div>

      {/* Counter pill */}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
        <span className="px-3 py-1 rounded-full bg-black/40 backdrop-blur-sm text-white/50 text-[10px] font-dmmono">
          {index + 1} / {feed.length}
        </span>
      </div>

      {/* Right engagement bar (shorts only) */}
      {!isLiveSlide && current && (
        <div className="absolute right-3 bottom-36 z-10 flex flex-col items-center gap-5">
          <button onClick={() => navigate(`/user/${current.authorId}`)} className="relative mb-1">
            <UserAvatar src={current.author?.avatar} size={44} className="border-2 border-white" />
          </button>
          <EngageBtn icon="favorite" count={current.likeCount} active={current.isLiked} activeColor="text-brand-ember" onTap={likeCurrent} />
          <EngageBtn icon="chat_bubble" count={current.commentCount} onTap={() => navigate(`/post/${current.id}`)} />
          <EngageBtn icon="bookmark" count={current.saveCount} />
          <EngageBtn icon="share" count={current.shareCount} onTap={() => handleShare(current)} />
        </div>
      )}

      {/* Bottom info (shorts only) */}
      {!isLiveSlide && current && (
        <div className="absolute bottom-0 left-0 right-16 z-10 px-4 pb-8 bg-gradient-to-t from-black/80 via-black/40 to-transparent safe-bottom">
          <button onClick={() => navigate(`/user/${current.authorId}`)} className="flex items-center gap-2.5 mb-2">
            <div className="text-left">
              <p className="text-white font-bold text-sm">{current.author?.displayName || 'User'}</p>
              <p className="text-white/50 text-[11px] font-dmmono">@{current.author?.username}
                {current.createdAt && <span className="ml-2 text-white/30">· {timeAgo(current.createdAt?.toDate ? current.createdAt.toDate() : current.createdAt)}</span>}
              </p>
            </div>
          </button>
          {current.content && <p className="text-white/90 text-sm leading-relaxed line-clamp-2">{current.content}</p>}
          {current.hashtags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {current.hashtags.map((tag) => <span key={tag} className="text-brand-violet-light text-xs font-semibold">#{tag}</span>)}
            </div>
          )}
        </div>
      )}

      {/* First-slide scroll hint */}
      {index === 0 && feed.length > 1 && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10 animate-bounce pointer-events-none">
          <Icon name="expand_less" size={28} className="text-white/30" />
        </div>
      )}
    </div>
  );
}

// ─── Floating back button (always visible, clears the status bar) ───
export function ShortsBackFab({ onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label="Go back"
      className="absolute left-4 z-[120] w-10 h-10 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center active:scale-95 transition-transform"
      style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}
    >
      <Icon name="arrow_back" size={22} className="text-white" />
    </button>
  );
}

// ─── Live stream slide (interleaved into the Shorts/clips feed) ───
export function LiveSlide({ stream, navigate }) {
  const isTwitch = stream.source === 'twitch' && !!stream.twitchChannel;
  const playbackUrl = stream.compositeHlsUrl || (stream.streamKey ? getPlaybackUrl(stream.streamKey) : null);
  const viewers = stream.viewerCount || 0;
  const enter = () => navigate(`/watch/${stream.id}`);

  return (
    <div className="absolute inset-0 bg-black" onClick={enter}>
      {isTwitch ? (
        <TwitchMirrorPlayer username={stream.twitchChannel} autoplay muted fill />
      ) : playbackUrl ? (
        <HlsPlayer src={playbackUrl} controls={false} muted autoPlay className="w-full h-full" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white/40 text-sm">Live</div>
      )}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-ember text-white text-[11px] font-bold tracking-wider shadow-lg">
        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE
      </div>
      <div className="absolute bottom-0 left-0 right-0 z-10 px-4 pb-10 bg-gradient-to-t from-black/85 via-black/40 to-transparent safe-bottom">
        <div className="flex items-center gap-2.5 mb-3">
          <UserAvatar src={stream.hostAvatar} size={44} isLive className="border-2 border-brand-ember" />
          <div className="min-w-0">
            <p className="text-white font-bold text-sm truncate">{stream.hostUsername || 'Live now'}</p>
            <p className="text-white/60 text-[11px] font-dmmono flex items-center gap-2">
              <span className="truncate">{stream.title || stream.game || 'Live stream'}</span>
              <span className="flex items-center gap-1 shrink-0"><Icon name="visibility" size={11} /> {viewers.toLocaleString()}</span>
            </p>
          </div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); enter(); }} className="w-full py-3 rounded-2xl bg-brand-ember text-white font-bold text-sm flex items-center justify-center gap-2">
          <Icon name="play_arrow" size={20} /> Tap to watch live
        </button>
      </div>
    </div>
  );
}

// Cheap placeholder for a live slide that is NOT the active slot (avoids
// spinning up extra HLS players in the prev/next window slots).
function LivePoster({ stream }) {
  return (
    <div className="absolute inset-0 bg-black flex items-center justify-center">
      {stream.thumbnailUrl && <img src={stream.thumbnailUrl} alt="" className="w-full h-full object-cover opacity-70" />}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-ember text-white text-[11px] font-bold tracking-wider">
        <span className="w-1.5 h-1.5 rounded-full bg-white" /> LIVE
      </div>
    </div>
  );
}

// ─── Native vertical video player ───
export function VideoPlayer({ src, poster, active = true, muted = false, speed = 1, onProgress, onReadyToPrefetch, prefetch = false }) {
  const ref = useRef(null);
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
    if (!active) return;
    const v = ref.current;
    if (!v || !onReadyToPrefetch) return;
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
      v.muted = muted;
      if (!wasActive.current) { try { v.currentTime = 0; } catch {} userPaused.current = false; setPaused(false); }
      if (!userPaused.current) { v.play().catch(() => {}); }
    } else {
      v.muted = true;
      v.pause();
    }
    wasActive.current = active;
  }, [active, muted]);

  // Long-press 2x (and reset).
  useEffect(() => {
    const v = ref.current;
    if (v) v.playbackRate = active ? speed : 1;
  }, [speed, active]);

  // Progress → rAF-throttled callback (active slot only).
  useEffect(() => {
    const v = ref.current;
    if (!v || !active || !onProgress) return;
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

  const toggle = () => {
    const v = ref.current;
    if (!v || !active) return;
    if (v.paused) { v.play(); userPaused.current = false; setPaused(false); }
    else { v.pause(); userPaused.current = true; setPaused(true); }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black" onClick={toggle}>
      <video
        ref={ref}
        src={src}
        poster={poster}
        loop
        playsInline
        preload={active || prefetch ? 'auto' : 'metadata'}
        muted={active ? muted : true}
        className="w-full h-full object-contain"
      />
      {active && paused && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
            <Icon name="play_arrow" size={40} className="text-white" />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Embedded video fullscreen (kept for safety; embeds are filtered out of the
// loaded feed, but the branch must never be lost) ───
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
          <div className="w-12 h-12 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
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
export function EngageBtn({ icon, count, active, activeColor, onTap }) {
  const [on, setOn] = useState(active);
  return (
    <button onClick={() => { setOn(!on); onTap?.(); }} className="flex flex-col items-center gap-0.5">
      <div className={`w-11 h-11 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center ${on && activeColor ? activeColor : 'text-white'}`}>
        <Icon name={icon} filled={on} size={24} />
      </div>
      <span className="text-white text-[10px] font-dmmono font-bold">
        {count ? (count >= 1000 ? (count / 1000).toFixed(1) + 'K' : count) : ''}
      </span>
    </button>
  );
}
