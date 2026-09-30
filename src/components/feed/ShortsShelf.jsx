// ShortsShelf — short-form gets its own shelf, the way YouTube does it.
//
// Founder, 2026-09-12: "is a youtube short the same thing as a youtube video? no
// it is not, they are formated and sized differently, one gets a screen with the
// user info and coments and related videos below it, and the other is a feed that
// gets scrolled like tiktok".
//
// Making a clip render as a portrait tile fixed its SHAPE. This fixes its PLACE:
// YouTube does not put Shorts in the main feed at all, they live in a dedicated
// horizontal shelf and tapping one enters the immersive scroller. A clip sitting
// inline in the chronological list still reads as "a post that happens to be
// vertical", however well the tile is drawn.
//
// ⚠ COSTS NOTHING. The clips come from the posts the feed ALREADY loaded, pulled
// out by the caller before it renders the list. A dedicated query would be one
// more Firestore read on every feed load, and the founder's standing rule is that
// correctness is not a reason to spend his money.
//
// ⚠ CONSEQUENCE OF THAT, stated rather than hidden: the shelf can only show
// short-form that happens to be in the loaded page. It is not a curated or
// ranked Shorts feed. "See all" goes to the real one.
import { useNavigate } from 'react-router-dom';
import Icon from '../Icon';
import UserName from '../UserName';

export default function ShortsShelf({ posts }) {
  const navigate = useNavigate();
  if (!posts?.length) return null;

  return (
    <section className="mt-3 mb-1" aria-label="Clips">
      <div className="flex items-center justify-between px-4 mb-2">
        <h2 className="flex items-center gap-1.5 font-syne font-bold text-[15px]">
          <Icon name="slow_motion_video" size={18} className="text-brand-ember" />
          Clips
        </h2>
        <button
          onClick={() => navigate('/shorts')}
          className="text-brand-violet-light text-xs font-bold px-2 py-1"
        >
          See all
        </button>
      </div>

      {/* Horizontal, edge to edge, with the scrollbar hidden the same way the
          other rails in this app do it. */}
      <div className="flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {posts.map((p) => (
          <button
            key={p.id}
            onClick={() => navigate(`/clip/${p.id}`)}
            aria-label={`Open ${p.type === 'short' ? 'short' : 'clip'}`}
            className="relative shrink-0 w-[132px] aspect-[9/16] rounded-xl overflow-hidden bg-surface-2 border border-white/[0.06] active:scale-[0.97] transition-transform"
          >
            {p.thumbnailUrl ? (
              <img src={p.thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
            ) : (
              // Older clips carry no cover (nothing set thumbnailUrl until
              // 2026-09-12). preload="metadata" is enough for the WebView to
              // paint a frame without downloading the file.
              <video
                src={p.mediaUrls?.[0] || p.mediaUrl}
                muted
                playsInline
                preload="metadata"
                tabIndex={-1}
                aria-hidden
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              />
            )}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.05) 45%, rgba(0,0,0,0.78) 100%)' }} />
            <span className="absolute inset-x-0 bottom-0 p-2 text-left">
              <span className="block text-white text-[10px] font-bold leading-tight line-clamp-2">
                {p.content?.trim() || 'Clip'}
              </span>
              <span className="block text-white/60 text-[9px] font-dmmono mt-0.5 truncate">
                <UserName user={p.author} masked handle fallback={'user'} />
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
