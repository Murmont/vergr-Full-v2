// ProfileGrid — how a profile lays out what someone has posted, the way people
// already know it from the apps they use:
//
//   Posts  on a wide screen, a grid of fixed-shape post tiles (Instagram's grid:
//          one shape for every tile, so rows cannot misalign); on a phone, one
//          column of feed cards (X, Threads).
//   Clips  a 9:16 grid of covers (TikTok, Reels tab).
//   Media  a square grid (Instagram, X's Media tab).
//
// Founder, 2026-09-14, on the two-column grid it replaces: "if a user posts a clip
// without text then all the elements like the like comments share repost etc
// push up ... instagram does not have this problem". Two feed cards side by side
// can never line up, because each is as tall as its own text. Uniform tiles and a
// single timeline are the two layouts that cannot misalign, which is why every
// platform uses one or the other.
//
// ⚠ ONE COMPONENT FOR ALL FOUR PROFILE VIEWS (web own, web public, native own,
// native public). Doing a profile change on one view is how the avatar orbit
// shipped visible to nobody but its owner.
//
// ⚠ COSTS NOTHING. Every tile renders from posts the screen already loaded.
import { useNavigate } from 'react-router-dom';
import useResponsive from '../../hooks/useResponsive';
import Icon from '../Icon';
import PostCard from '../PostCard';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import { compactCount, isShortFormat } from '../../utils/helpers';

const VIDEO_RE = /\.(mp4|webm|mov|m4v|m3u8)(\?|#|$)/i;
// Solid values over media, never a wash (a wash turns to mud over the frame).
const TILE_BG = '#15151F';
const COUNT_SHADOW = '0 1px 3px rgba(0,0,0,0.8)';

const mediaOf = (post) => {
  if (post?.mediaUrls?.length) return post.mediaUrls;
  if (post?.mediaUrl) return [post.mediaUrl];
  return [post?.imageUrl, post?.videoUrl].filter(Boolean);
};

// A caption stores a picked mention as `@[name](uid)`. A tile shows the name.
export const captionOf = (post, fallback = 'Clip') => {
  const text = String(post?.content || post?.text || '')
    .replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')
    .trim();
  return text || fallback;
};

/**
 * The picture a tile shows. The uploaded cover first; a clip posted before covers
 * existed shows its own first frame (`preload="metadata"` fetches a few KB, not the
 * file); a locked post shows a lock, because its bytes are private by design.
 */
export function Cover({ post }) {
  if (post?.locked?.priceCoins > 0 && !post?.thumbnailUrl) {
    return (
      <span className="absolute inset-0 flex items-center justify-center" style={{ background: TILE_BG }}>
        <Icon name="lock" size={22} className="text-text-muted" />
      </span>
    );
  }
  if (post?.thumbnailUrl) {
    return <img src={post.thumbnailUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />;
  }
  const first = mediaOf(post)[0];
  if (!first) {
    return (
      <span className="absolute inset-0 flex items-center justify-center" style={{ background: TILE_BG }}>
        <Icon name="movie" size={22} className="text-text-muted" />
      </span>
    );
  }
  const isVideo = VIDEO_RE.test(first) || isShortFormat(post?.type) || post?.type === 'video';
  if (isVideo) {
    return (
      <video
        src={first.includes('#') ? first : `${first}#t=0.1`}
        muted playsInline preload="metadata" tabIndex={-1} aria-hidden
        className="absolute inset-0 w-full h-full object-cover pointer-events-none"
      />
    );
  }
  return <img src={first} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />;
}

/** Clips tab: 9:16 covers, the like count bottom left, tap opens the player. */
export function ClipGrid({ posts }) {
  const navigate = useNavigate();
  // The native WebView reports an inflated width, so `md:` would match on a phone.
  const cols = IS_NATIVE_BUILD ? 'grid-cols-3' : 'grid-cols-3 md:grid-cols-4 xl:grid-cols-5';
  return (
    <div className={`grid ${cols} gap-[3px]`}>
      {posts.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => navigate(`/clip/${p.id}`)}
          aria-label={`Open clip: ${captionOf(p)}`}
          className="group relative aspect-[9/16] overflow-hidden rounded-[4px] active:opacity-80"
          style={{ background: TILE_BG }}
        >
          <Cover post={p} />
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-2/5 pointer-events-none"
            style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.65) 100%)' }} />
          <span className="absolute left-2 bottom-1.5 flex items-center gap-1 text-white text-[12px] font-bold tabular-nums"
            style={{ textShadow: COUNT_SHADOW }}>
            <Icon name="favorite" size={14} filled /> {compactCount(p.likeCount)}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Media tab: square tiles. A stack or play mark top right, counts on hover. */
export function MediaGrid({ posts }) {
  const navigate = useNavigate();
  return (
    <div className="grid grid-cols-3 gap-[3px]">
      {posts.map((p) => {
        const urls = mediaOf(p);
        const mark = urls.length > 1 ? 'collections'
          : (VIDEO_RE.test(urls[0] || '') || p.type === 'video') ? 'play_arrow' : null;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => navigate(`/post/${p.id}`)}
            aria-label="Open post"
            className="group relative aspect-square overflow-hidden rounded-[4px] active:opacity-80"
            style={{ background: TILE_BG }}
          >
            <Cover post={p} />
            {mark && (
              <span className="absolute top-1.5 right-1.5 text-white" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}>
                <Icon name={mark} size={18} filled />
              </span>
            )}
            {/* Instagram's desktop hover: the counts over a dimmed tile. */}
            <span className="absolute inset-0 hidden md:flex items-center justify-center gap-5 opacity-0 group-hover:opacity-100 transition-opacity text-white text-[14px] font-bold tabular-nums"
              style={{ background: 'rgba(0,0,0,0.45)' }}>
              <span className="flex items-center gap-1.5"><Icon name="favorite" size={18} filled /> {compactCount(p.likeCount)}</span>
              <span className="flex items-center gap-1.5"><Icon name="chat_bubble" size={18} filled /> {compactCount(p.commentCount)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Tiles fill the column: as many 280px-minimum tracks as fit (3 across a desktop
// profile column of ~1014px, 2 on a narrower window or a tablet). `auto-fill`
// keeps empty tracks, so one or two posts stay tile-sized instead of stretching.
export const TILE_GRID_COLUMNS = 'repeat(auto-fill, minmax(280px, 1fr))';

/**
 * A profile tab's body. Clips and Media are grids. Posts, Likes, Bookmarks and
 * Tagged are a grid of fixed-shape post tiles on a wide screen, and one column of
 * feed cards on a phone, where every app uses a single full-width timeline.
 *
 * ⚠ The tile, not the feed card, is what goes side by side. A feed card is as
 * tall as its own text, so two in a row can never line up (the founder's
 * original report). PostCard variant="tile" has a fixed shape.
 */
export function ProfilePostList({ tab, posts, onDeleted }) {
  // Above every early return: a hook after one changes the hook count.
  const { isMobile } = useResponsive();
  if (tab === 'Clips') return <ClipGrid posts={posts} />;
  if (tab === 'Media') return <MediaGrid posts={posts} />;
  if (!IS_NATIVE_BUILD && !isMobile) {
    return (
      <div className="grid gap-3" style={{ gridTemplateColumns: TILE_GRID_COLUMNS }}>
        {posts.map((p) => <PostCard key={p.id} post={p} onDeleted={onDeleted} variant="tile" />)}
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {posts.map((p) => <PostCard key={p.id} post={p} onDeleted={onDeleted} />)}
    </div>
  );
}

/** The right rail's Top Clips: the clip's own cover and caption, tap to play. */
export function TopClipsList({ clips, loading = false }) {
  const navigate = useNavigate();
  // Before the posts arrive this said "No clips yet" to an account with clips.
  if (loading) {
    return (
      <div className="space-y-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2.5">
            <div className="w-10 aspect-[9/16] rounded-md shrink-0" style={{ background: '#1C1C29' }} />
            <div className="flex-1 space-y-1.5">
              <div className="h-2.5 w-3/4 rounded" style={{ background: '#1C1C29' }} />
              <div className="h-2.5 w-1/3 rounded" style={{ background: '#1C1C29' }} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (!clips.length) return <p className="text-[11px] text-text-muted">No clips yet</p>;
  return (
    <div className="space-y-1">
      {clips.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => navigate(`/clip/${c.id}`)}
          className="flex items-center gap-2.5 w-full text-left rounded-lg p-1.5 hover:bg-[#1C1C29] transition-colors"
        >
          <span className="relative w-[40px] aspect-[9/16] rounded-[4px] overflow-hidden shrink-0" style={{ background: TILE_BG }}>
            <Cover post={c} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[12px] font-semibold text-text-primary leading-snug line-clamp-2">{captionOf(c)}</span>
            <span className="flex items-center gap-2.5 text-[10px] text-text-muted mt-1 tabular-nums">
              <span className="flex items-center gap-0.5"><Icon name="favorite" size={11} filled /> {compactCount(c.likeCount)}</span>
              <span className="flex items-center gap-0.5"><Icon name="chat_bubble" size={11} filled /> {compactCount(c.commentCount)}</span>
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
