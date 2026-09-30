// Engagement for the immersive clip viewer (ShortsDeck, which /shorts and
// /clip/:postId both render).
//
// ONE implementation, because the two copies it replaced had drifted into the
// same bugs, found 2026-09-12 when the founder asked whether likes and comments
// are counted:
//   - the heart kept its OWN state (useState(active) on first render), so it
//     ignored the clip it was drawn for: like clip 1, swipe, and clip 2's heart
//     was already filled. Double-tap never filled it at all.
//   - the number under it never moved, because nothing wrote the new count back.
//   - toggleLike() flips whatever the SERVER holds, and neither viewer ever
//     loaded "have I liked this". So a clip you had liked before showed an empty
//     heart, and tapping it REMOVED the like while the heart filled.
//   - a zero count rendered as nothing, so a new clip showed no numbers at all.
//   - the bookmark button had no handler: it filled and saved nothing.
//
// So every write says what the user SEES they are choosing (setPostLiked /
// setPostBookmarked take the wanted state) and the server's answer decides the
// icon and the count.
//
// Liked / saved state IS loaded when a clip becomes the one on screen (`load`),
// once per clip per session, because TikTok shows your heart filled the moment a
// clip you liked appears. Founder, 2026-09-13: get it to TikTok level, stop
// asking. Cost: two reads per clip viewed, the same two PostCard already pays for
// every card in the home feed. Signed-out viewers and live slides read nothing.
import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { setPostLiked, setPostBookmarked, isPostLiked, isBookmarked } from '../../firebase/firestore';
import { compactCount } from '../../utils/helpers';
import Icon from '../Icon';

export function useClipEngagement() {
  const { currentUser } = useAuth();
  const { showToast } = useUI();

  // Per-clip values layered over the post as loaded:
  // { isLiked, likeCount, isSaved, saveCount, commentCount, shareCount }
  const [over, setOver] = useState({});
  const overRef = useRef(over); overRef.current = over;
  const busy = useRef(new Set());
  const loaded = useRef(new Set());

  const view = useCallback((item) => (item ? { ...item, ...over[item.id] } : item), [over]);

  const patch = useCallback((id, next) => {
    setOver((p) => ({ ...p, [id]: { ...p[id], ...next } }));
  }, []);

  // Read whether this viewer already liked / saved the clip. Never overwrites a
  // value the viewer set by tapping while the read was in flight.
  const load = useCallback(async (item) => {
    const uid = currentUser?.uid;
    if (!uid || !item?.id || item._kind === 'live' || loaded.current.has(item.id)) return;
    loaded.current.add(item.id);
    try {
      const [liked, saved] = await Promise.all([isPostLiked(item.id, uid), isBookmarked(item.id, uid)]);
      setOver((p) => {
        const cur = p[item.id] || {};
        const next = { ...cur };
        if (cur.isLiked === undefined) next.isLiked = liked;
        if (cur.isSaved === undefined) next.isSaved = saved;
        // A clip you liked can never show 0 likes. Measured on the device: a
        // cached post said likeCount 0 while the server already held this
        // viewer's like, so the rail read "liked, 0".
        const likes = cur.likeCount ?? item.likeCount ?? 0;
        const saves = cur.saveCount ?? item.saveCount ?? 0;
        if (next.isLiked && likes < 1) next.likeCount = 1;
        if (next.isSaved && saves < 1) next.saveCount = 1;
        return { ...p, [item.id]: next };
      });
    } catch {
      loaded.current.delete(item.id);
    }
  }, [currentUser]);

  const set = useCallback(async (item, want, flag, count, write, verb) => {
    if (!item?.id) return null;
    const uid = currentUser?.uid;
    if (!uid) { showToast?.(`Sign in to ${verb} clips.`, 'info'); return null; }
    const key = `${flag}:${item.id}`;
    if (busy.current.has(key)) return null;

    const known = overRef.current[item.id]?.[flag] !== undefined;
    const cur = { ...item, ...overRef.current[item.id] };
    const shown = !!cur[flag];
    const target = want ?? !shown;
    // A double-tap on a heart we KNOW is filled has nothing to do.
    if (target === shown && known) return { on: shown, changed: false };
    const base = cur[count] || 0;

    busy.current.add(key);
    patch(item.id, { [flag]: target, [count]: Math.max(0, base + (target === shown ? 0 : target ? 1 : -1)) });
    try {
      const res = await write(item.id, uid, target);
      // Never "liked, 0": a stale cached count cannot undercount the viewer's own like.
      patch(item.id, { [flag]: res.on, [count]: Math.max(res.on ? 1 : 0, base + (res.changed ? (res.on ? 1 : -1) : 0)) });
      return res;
    } catch {
      patch(item.id, { [flag]: shown, [count]: base });
      showToast?.('That did not go through. Please try again.', 'error');
      return null;
    } finally {
      busy.current.delete(key);
    }
  }, [currentUser, showToast, patch]);

  const like = useCallback((item, want) => set(item, want, 'isLiked', 'likeCount', setPostLiked, 'like'), [set]);
  const save = useCallback((item) => set(item, undefined, 'isSaved', 'saveCount', setPostBookmarked, 'save'), [set]);

  // Counts the server owns (onNewComment, incrementShareCount): add the one the
  // user just made so the rail reflects it without a re-read.
  const bump = useCallback((item, count, delta = 1) => {
    if (!item?.id) return;
    setOver((p) => {
      const cur = { ...item, ...p[item.id] };
      return { ...p, [item.id]: { ...p[item.id], [count]: Math.max(0, (cur[count] || 0) + delta) } };
    });
  }, []);
  const commented = useCallback((item) => bump(item, 'commentCount'), [bump]);
  // A comment you deleted from the sheet (deleteComment brings the server
  // count down in the same batch).
  const uncommented = useCallback((item) => bump(item, 'commentCount', -1), [bump]);
  const shared = useCallback((item) => bump(item, 'shareCount'), [bump]);

  return { view, load, like, save, commented, uncommented, shared };
}

// Controlled on purpose: the icon state and the number come from the clip
// being shown, never from state the button keeps across swipes.
//
// Bare, filled, shadowed icons, the way TikTok, Reels and YouTube Shorts draw
// their rails. The previous version sat every icon on a translucent black disc,
// which is the fake glass the founder bans and which YouTube's own 2026 Shorts
// redesign removed for looking like "splotches on your windshield".
// variant 'bare' (default): a bare filled icon with a shadow, drawn OVER the video.
// variant 'circle': a SOLID 48px disc with a 24px icon, for the desktop rail that
// sits BESIDE the video on the page background (measured on tiktok.com web,
// 2026-09-13: 48px discs, 12px bold counts, 78px pitch). Solid, never a wash.
// glyph: an inline SVG path drawn instead of a Material icon (the phone rail's
// TikTok-shaped comment bubble and share arrow). showCount: false for ⋯.
export function EngageButton({ icon, glyph, label, count, active, activeColor, onTap, variant = 'bare', showCount = true }) {
  const circle = variant === 'circle';
  const toggles = active !== undefined;
  // A short pop when a toggle turns ON (a like, a save), never on the way off.
  // The keyframes live in ShortsDeck's style block.
  const [pop, setPop] = useState(false);
  const wasActive = useRef(!!active);
  useEffect(() => {
    if (active && !wasActive.current) {
      wasActive.current = true;
      setPop(true);
      const t = setTimeout(() => setPop(false), 340);
      return () => clearTimeout(t);
    }
    wasActive.current = !!active;
    return undefined;
  }, [active]);

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={label}
      aria-pressed={toggles ? !!active : undefined}
      className={`group flex flex-col items-center ${circle ? 'gap-[6px] w-14' : 'gap-[4px] w-[48px]'} rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white`}
    >
      <span
        className={`flex items-center justify-center transition-transform duration-150 group-active:scale-90 ${circle ? 'w-[48px] h-[48px] rounded-full group-hover:brightness-125' : 'w-[48px] h-[40px]'} ${active && activeColor ? activeColor : 'text-white'}`}
        style={circle ? { background: '#24242F' } : { filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.55))' }}
      >
        {glyph ? (
          <svg
            aria-hidden="true"
            width={circle ? 24 : 32}
            height={circle ? 24 : 32}
            viewBox="0 0 24 24"
            fill="currentColor"
            style={pop ? { animation: 'vgEngagePop 0.34s cubic-bezier(0.2, 0.9, 0.3, 1.4)' } : undefined}
          >
            {glyph}
          </svg>
        ) : (
          <Icon
            name={icon}
            filled
            size={circle ? 24 : 32}
            style={pop ? { animation: 'vgEngagePop 0.34s cubic-bezier(0.2, 0.9, 0.3, 1.4)' } : undefined}
          />
        )}
      </span>
      {showCount && (
        <span
          className={`font-bold tabular-nums leading-[16px] ${circle ? 'text-[12px] font-dmmono' : 'text-[13px] text-white'}`}
          style={circle ? { color: '#C9C9D2' } : { textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}
        >
          {compactCount(count)}
        </span>
      )}
    </button>
  );
}

// Phone rail glyphs, drawn to TikTok's shapes rather than Material's: a round
// speech bubble with three dots, and a curved share arrow.
export const COMMENT_GLYPH = (
  <path fillRule="evenodd" d="M12 3C6.48 3 2 6.94 2 11.8c0 2.62 1.3 4.97 3.37 6.58-.2 1.35-.85 2.62-1.9 3.62 2.33.03 4.3-.78 5.67-1.95.9.2 1.86.3 2.86.3 5.52 0 10-3.94 10-8.8S17.52 3 12 3Zm-4.5 10.3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm4.5 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm4.5 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
);
export const SHARE_GLYPH = (
  <path d="M13.5 4.5v4C6.8 9.2 3.4 13.7 3 19.8c2.2-3.4 5.4-5.1 10.5-5.1v4.2l8-7.2-8-7.2Z" />
);
