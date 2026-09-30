import { useState, useEffect, useRef, useMemo } from 'react';

// Below this a post shows no view count at all. See the note at the render site.
const PUBLIC_VIEW_FLOOR = 50;
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import AnimatedNumber from './AnimatedNumber';
import { useAuth } from '../context/AuthContext';
import { useUser } from '../context/UserContext';
import { useUI } from '../context/UIContext';
import { useLiveUsers } from '../context/LiveUsersContext';
import { toggleLike, isPostLiked, toggleBookmark, isBookmarked, incrementShareCount, repost, undoRepost, isReposted, getPostWithAuthor, deletePost, reportPost, setShareToFeed } from '../firebase/firestore';
import { captureInterest } from '../utils/feedRank';
import { addNegativeAuthor, addNegativeTopic } from '../utils/feedPrefs';
import UserAvatar from './UserAvatar';
import UserName from './UserName';
import RankBadge from './RankBadge';
import VanguardBadge from './VanguardBadge';
import { applyVanguardMask } from '../utils/vanguard';
import Icon from './Icon';
import useTranslate from '../hooks/useTranslate';
import { langLabel } from '../utils/localePrefs';
import PollCard from './PollCard';
import PostRichText, { stripPostFormatting, truncateFormatted } from './PostRichText';
import TierBadge from './TierBadge';
import EmbedVideoPlayer, { parseVideoUrl, getThumbnailUrl } from './EmbedVideoPlayer';
import Ambilight from './effects/visual/Ambilight';
import InlineVideoPlayer from './media/InlineVideoPlayer';
import TipPostModal from './TipPostModal';
import CreateComposer from './composer/CreateComposer';
import { CoinIcon } from './CoinIcon';
import BoostSheet from './boost/BoostSheet';
import { isBoosted, boostRemainingMs, formatBoostRemaining } from '../utils/promoBoost';
import LockedMedia from './monetization/LockedMedia';
import PostTileStage, { tileStageShowsText } from './profile/PostTileStage';
import { timeAgo, isShortFormat, sharesToFeed } from '../utils/helpers';
import { withRef } from '../utils/shareRef';
import { publicUrl } from '../utils/publicUrl';
import { trackEvent } from '../utils/trackEvent';
import { useImpressionTracker } from '../hooks/useImpressionTracker';

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogg)(\?|#|$)/i;
const isVideoUrl = (u) => typeof u === 'string' && VIDEO_EXT_RE.test(u);

// Tiny particle burst on like (B11-1): 7 hearts/sparks fly out on random
// vectors for ~420ms. Keyed remount (triggerKey) replays it. Reduced-motion
// safe (the global html[data-reduced-motion] rule zeroes the animation).
function HeartBurst({ triggerKey }) {
  const particles = useMemo(() => Array.from({ length: 7 }, () => {
    const ang = Math.random() * Math.PI * 2;
    const dist = 12 + Math.random() * 16;
    return {
      px: Math.cos(ang) * dist,
      py: Math.sin(ang) * dist - 6, // bias upward
      s: 6 + Math.round(Math.random() * 4),
      spark: Math.random() > 0.55,
    };
  }), [triggerKey]);
  if (!triggerKey) return null;
  return (
    <span key={triggerKey} className="pointer-events-none absolute left-1/2 top-1/2 z-10" aria-hidden>
      {particles.map((p, i) => (
        <span key={i} className="like-particle absolute" style={{ left: 0, top: 0, '--px': `${p.px}px`, '--py': `${p.py}px` }}>
          <Icon name={p.spark ? 'star' : 'favorite'} filled size={p.s} className="text-brand-ember" />
        </span>
      ))}
    </span>
  );
}

// Handles the media tap gestures (B11-2): a single tap runs the element's own
// action (open lightbox) but is DEFERRED 250ms so a second tap can cancel it and
// register a double-tap like instead — with a centered heart pop, Instagram-style.
function useMediaTap(onDoubleTapLike) {
  const [heartKey, setHeartKey] = useState(0);
  const tap = useRef({ timer: null, last: 0 });
  const onTap = (singleAction) => (e) => {
    e.stopPropagation();
    const now = Date.now();
    const t = tap.current;
    if (now - t.last < 300) {
      if (t.timer) { clearTimeout(t.timer); t.timer = null; }
      t.last = 0;
      onDoubleTapLike?.();
      setHeartKey((k) => k + 1);
    } else {
      t.last = now;
      if (t.timer) clearTimeout(t.timer);
      t.timer = setTimeout(() => { t.timer = null; singleAction?.(); }, 250);
    }
  };
  return { onTap, heartKey };
}

function MediaHeart({ heartKey }) {
  if (!heartKey) return null;
  return (
    <span key={heartKey} className="media-heart-pop pointer-events-none absolute left-1/2 top-1/2 z-20" aria-hidden>
      <Icon name="favorite" filled size={84} className="text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]" />
    </span>
  );
}

// Multi-media = a horizontal row of fixed-height tiles (like X / Telegram):
// each tile keeps its own aspect ratio (width auto at a shared height) so
// several show at once, the next peeks in, and nothing is ever cropped.
// Handles images + videos in any mix.
// `renditions` was read off `post` in here, but MediaRow never received a
// `post` prop, so the multi-media branch threw `ReferenceError: post is not
// defined` on any post containing a video (audit A41 #2). MediaContent, its
// only caller, has the post and just was not passing it down.
//
// ⚠ `post?.adaptiveRenditions` looked defensive and was not: optional chaining
// guards against a null VALUE, never against an undeclared IDENTIFIER. `post?.x`
// with no `post` binding in scope still throws.
function MediaRow({ items, post, onImageClick, onDoubleTapLike }) {
  const scrollerRef = useRef(null);
  const { onTap, heartKey } = useMediaTap(onDoubleTapLike);
  const scrollBy = (dir) => { const el = scrollerRef.current; if (el) el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: 'smooth' }); };
  return (
    <div className="mt-3 relative group" onClick={(e) => e.stopPropagation()}>
      <MediaHeart heartKey={heartKey} />
      <div ref={scrollerRef} className="flex gap-2 overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((it, i) => (
          <div key={i} className="snap-start shrink-0 h-[280px] md:h-[340px] rounded-xl overflow-hidden border border-white/[0.06] bg-black flex items-center justify-center">
            {it.video ? (
              <div className="h-full w-[min(560px,80vw)] flex items-center justify-center">
                <InlineVideoPlayer src={it.url} renditions={post?.adaptiveRenditions} maxHeightClass="h-full" rounded={false} objectFit="contain" onDoubleTapLike={onDoubleTapLike} />
              </div>
            ) : (
              <img src={it.url} alt="" onClick={onTap(() => onImageClick(i))} className="h-full w-auto max-w-[85vw] object-contain cursor-zoom-in" loading="lazy" />
            )}
          </div>
        ))}
      </div>
      <button onClick={() => scrollBy(-1)} className="hidden md:flex absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
        <Icon name="chevron_left" size={22} />
      </button>
      <button onClick={() => scrollBy(1)} className="hidden md:flex absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
        <Icon name="chevron_right" size={22} />
      </button>
      <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-[11px] font-dmmono flex items-center gap-1 pointer-events-none">
        <Icon name="collections" size={12} /> {items.length}
      </div>
    </div>
  );
}

// Anchors the ambilight to the MEDIA, not to the card.
//
// ⚠ THE MISTAKE THIS EXISTS TO PREVENT. A previous version put one glow at
// `inset: 0` on the whole post card. That stretches a 16:9 sample across a tall
// card, so the light loses any resemblance to the picture it came from and
// floods the entire card with one colour. The founder's words: "it shouldn't
// keep a resemblance of the share, not stretch out over the entire card."
//
// This wrapper is sized by the media inside it, so the glow box is
// media + BLEED on every side and keeps the media's aspect ratio. The post card
// sets `overflow: hidden`, which is what stops it reaching a neighbouring card
// — containment comes from the clip, not from padding.
//
// `isolation: isolate` makes this a stacking context so the z-index:-1 glow
// paints above this wrapper and below the media (00-RULES R6).
//
// ⚠ BESIDE THE MEDIA ONLY, AND FADED TO ZERO BEFORE ITS OWN EDGE. Measured in
// Chrome, 2026-09-14: a 56px bleed on every side washed the author name above
// the media and the like row below it, and the card's overflow clip cut the
// light off in a straight line at the card edge, on desktop and phone. Now there
// is no vertical bleed, every edge fades through a mask, and the sideways bleed
// ends inside the card: a clip tile has the avatar column's width to its left,
// full-width media only the card's 14px padding.
const GLOW_BLEED_TILE = 40;
const GLOW_BLEED_WIDE = 14;

function MediaGlow({ src, children, fit = false }) {
  if (!src) return children;
  return (
    // `fit` hugs a clip's portrait tile, so its glow is the tile's own light and
    // not a colour wash across the whole width of the card (founder, 2026-09-14:
    // "on desktop view it really does not look professional").
    <div className={fit ? 'relative w-fit max-w-full' : 'relative'} style={{ isolation: 'isolate' }}>
      <Ambilight src={src} enabled bleedX={fit ? GLOW_BLEED_TILE : GLOW_BLEED_WIDE} bleedY={0} edgeFade intensity={0.45} feather={false} />
      {children}
    </div>
  );
}

function MediaContent({ post, onImageClick, onDoubleTapLike }) {
  const { onTap, heartKey } = useMediaTap(onDoubleTapLike);
  // Own hook, and it sits ABOVE every early return below. MediaContent is a
  // SIBLING of the component that already holds a navigate, and a const in a
  // sibling component is invisible here: that exact shape has crashed this app
  // four times (myVpLevel, accentHex, tsMs, joinEvents).
  const navigate = useNavigate();
  // A hotlink-protected source image (news bots hotlink gematsu.com etc., which
  // 403s off-origin) would render a broken big image with no way to recover.
  // Drop the whole media block on error so the post reads as a clean text card
  // rather than a broken picture.
  const [imgFailed, setImgFailed] = useState(false);
  const rawUrls = post.mediaUrls?.length > 0 ? post.mediaUrls : (post.mediaUrl ? [post.mediaUrl] : []);

  // A locked post carries NO mediaUrl by design (functions/lockedPosts.js): the
  // real bytes sit on a private R2 prefix and the only route to them is a signed
  // URL minted after purchase. So the paywall is checked before the url list,
  // and a locked post can never fall through to a normal <img>.
  if (post.locked?.priceCoins > 0) {
    return (
      <div className="mt-3" onClick={(e) => e.stopPropagation()}>
        {/* No aspect class: the post's own dimensions were measured at upload
            and travel on `locked`, so the card reserves the real shape. A fixed
            4:5 cropped every landscape post to portrait. The floor stops a 9:16
            clip from filling the whole viewport. */}
        <LockedMedia
          resourceType="post"
          resourceId={post.id}
          locked={post.locked}
          minRatio={0.72}
        />
      </div>
    );
  }

  if (rawUrls.length === 0) return null;

  // Aspect placeholder (B11-4): if the post stored per-image dimensions at
  // upload time, reserve the exact box so the image paints with ZERO layout
  // shift. Legacy posts (no mediaMeta) keep the old max-height behavior.
  const meta0 = Array.isArray(post.mediaMeta) ? post.mediaMeta[0] : null;
  const aspect0 = meta0?.w > 0 && meta0?.h > 0 ? meta0.w / meta0.h : null;

  // The post stores only a single `type` + a flat url list, so infer per-item:
  // a single clip/video post is a video even if the url has no extension; in a
  // mixed set each url is judged by extension (R2 clips are .webm, giphy = webp
  // image). This is what makes an images+videos carousel render correctly.
  const items = rawUrls.map((u, i) => ({
    url: u,
    video: isVideoUrl(u) || ((post.type === 'clip' || post.type === 'video') && rawUrls.length === 1 && i === 0),
  }));

  // Open the lightbox on the image-only subset (videos play inline instead).
  const openImageLightbox = (globalIndex) => {
    const imgUrls = items.filter(it => !it.video).map(it => it.url);
    const start = Math.max(0, imgUrls.indexOf(items[globalIndex].url));
    onImageClick?.(imgUrls, start);
  };

  if (items.length === 1) {
    const it = items[0];

    // A CLIP IS A DIFFERENT FORMAT FROM A VIDEO POST, AND THE FEED MUST SAY SO.
    //
    // Founder, 2026-09-12: "is a youtube short the same thing as a youtube
    // video? no it is not, they are formatted and sized differently, one gets a
    // screen with the user info and coments and related videos below it, and the
    // other is a feed that gets scrolled like tiktok ... the clip i told you to
    // create is showing up as a reguar post with a video".
    //
    // He was right. A clip fell through to the SAME full-width 16:9
    // InlineVideoPlayer as a video post, with a small "Clip" badge as the only
    // difference, so it read as a video post in every way that matters: shape,
    // size and behaviour. A clip now renders as a PORTRAIT COVER TILE that opens
    // the immersive scroller, which is what a Short is; a `video` keeps the
    // inline 16:9 player and its own detail screen, which is what a video is.
    if (isShortFormat(post.type)) {
      return (
        // Left-aligned under the caption, the way X lays out a vertical video.
        // Centred in a wide card it floated in empty space with the action bar
        // stranded below nothing.
        <div className="mt-3 flex" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => navigate(`/clip/${post.id}`)}
            aria-label="Open clip"
            className="relative w-[260px] max-w-full aspect-[9/16] rounded-2xl overflow-hidden bg-surface-2 active:scale-[0.98] transition-transform"
          >
            {post.thumbnailUrl
              ? <img src={post.thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
              : <video src={it.url} muted playsInline preload="metadata" tabIndex={-1} aria-hidden className="absolute inset-0 w-full h-full object-cover pointer-events-none" />}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.10) 45%, rgba(0,0,0,0.72) 100%)' }} />
            {/* One label for both types: a legacy `short` IS a clip. Solid, no
                hairline, and the play glyph sits on a solid disc. The old one was
                black/45 with a blur, measured half yellow and half blue over the
                test clip's colour bars. */}
            <span className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-brand-ember text-white text-[9px] font-bold uppercase tracking-wider">
              Clip
            </span>
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: '#15151F' }}>
                <Icon name="play_arrow" size={26} className="text-white" filled />
              </span>
            </span>
          </button>
        </div>
      );
    }

    if (it.video) {
      return (
        <div className="mt-3 rounded-2xl overflow-hidden border border-white/[0.06] relative aspect-video bg-black" onClick={(e) => e.stopPropagation()}>
          <InlineVideoPlayer src={it.url} renditions={post?.adaptiveRenditions} poster={post.thumbnailUrl} maxHeightClass="h-full" rounded={false} objectFit="contain" onDoubleTapLike={onDoubleTapLike} />
          {post.type === 'clip' && (
            <div className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-brand-ember/90 text-white text-[9px] font-bold uppercase tracking-wider">Clip</div>
          )}
        </div>
      );
    }
    // A broken source image → render nothing (the card keeps its text/embed).
    if (imgFailed) return null;
    // Single image — shown uncropped (contained) up to 75vh, blurred backdrop.
    // When dimensions are known, the box is reserved via aspect-ratio (capped at
    // 75vh tall) so nothing below jumps when the image finishes loading.
    return (
      <div
        className="mt-3 relative rounded-2xl overflow-hidden border border-white/[0.06] bg-black"
        style={aspect0 ? { aspectRatio: aspect0, maxHeight: '75vh' } : undefined}
      >
        <MediaHeart heartKey={heartKey} />
        <img src={it.url} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-30" loading="lazy" />
        <img src={it.url} alt="" onError={() => setImgFailed(true)} onClick={onTap(() => onImageClick?.([it.url], 0))} className={`relative mx-auto ${aspect0 ? 'h-full w-full' : 'max-h-[75vh] w-auto max-w-full'} object-contain cursor-zoom-in`} loading="lazy" />
      </div>
    );
  }

  return <MediaRow items={items} post={post} onImageClick={openImageLightbox} onDoubleTapLike={onDoubleTapLike} />;
}

function ImageLightbox({ urls, startIndex, onClose }) {
  const [i, setI] = useState(startIndex);
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setI(x => Math.min(x + 1, urls.length - 1));
      else if (e.key === 'ArrowLeft') setI(x => Math.max(x - 1, 0));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [urls.length, onClose]);
  return (
    <div className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white"><Icon name="close" size={22} /></button>
      <img src={urls[i]} alt="" className="max-w-full max-h-full object-contain" onClick={e => e.stopPropagation()} />
      {urls.length > 1 && (
        <>
          {i > 0 && <button onClick={e => { e.stopPropagation(); setI(i - 1); }} className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white"><Icon name="chevron_left" size={24} /></button>}
          {i < urls.length - 1 && <button onClick={e => { e.stopPropagation(); setI(i + 1); }} className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white"><Icon name="chevron_right" size={24} /></button>}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/70 text-xs font-dmmono">{i + 1} / {urls.length}</div>
        </>
      )}
    </div>
  );
}

function LFGContent({ data }) {
  if (!data) return null;
  return (
    <div className="mt-3 p-3.5 rounded-2xl bg-brand-gold/5 border border-brand-gold/20">
      <div className="flex items-center gap-2 mb-2.5">
        <Icon name="group_add" size={16} className="text-brand-gold" />
        <span className="text-brand-gold text-[10px] font-bold uppercase tracking-widest">Looking for Group</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {data.game && <div className="px-2.5 py-1.5 rounded-lg bg-surface-2/60 border border-white/[0.04]"><p className="text-text-muted text-[9px] uppercase">Game</p><p className="text-text-primary text-xs font-bold">{data.game}</p></div>}
        {data.platform && <div className="px-2.5 py-1.5 rounded-lg bg-surface-2/60 border border-white/[0.04]"><p className="text-text-muted text-[9px] uppercase">Platform</p><p className="text-text-primary text-xs font-bold">{data.platform}</p></div>}
        {data.region && <div className="px-2.5 py-1.5 rounded-lg bg-surface-2/60 border border-white/[0.04]"><p className="text-text-muted text-[9px] uppercase">Region</p><p className="text-text-primary text-xs font-bold">{data.region}</p></div>}
        {data.rank && <div className="px-2.5 py-1.5 rounded-lg bg-surface-2/60 border border-white/[0.04]"><p className="text-text-muted text-[9px] uppercase">Rank</p><p className="text-text-primary text-xs font-bold">{data.rank}</p></div>}
      </div>
      {(data.mic !== null && data.mic !== undefined) && (
        <div className="flex items-center gap-3 mt-2.5">
          <span className="flex items-center gap-1 text-text-muted text-[10px]"><Icon name={data.mic ? 'mic' : 'mic_off'} size={12} />{data.mic ? 'Mic required' : 'No mic needed'}</span>
          {data.playersNeeded && <span className="text-text-muted text-[10px]">Need {data.playersNeeded} player{data.playersNeeded > 1 ? 's' : ''}</span>}
        </div>
      )}
    </div>
  );
}

function ArticleContent({ data }) {
  if (!data) return null;
  return (
    <div className="mt-3 p-4 rounded-2xl bg-brand-pink/5 border border-brand-pink/20">
      <div className="flex items-center gap-2 mb-2">
        <Icon name="article" size={14} className="text-brand-pink" />
        <span className="text-brand-pink text-[10px] font-bold uppercase tracking-widest">Article</span>
        <span className="text-text-muted text-[10px] ml-auto font-dmmono">{data.readTime || 1} min read</span>
      </div>
      <h3 className="font-syne font-bold text-base text-text-primary leading-snug">{data.title}</h3>
      {data.body && <p className="text-text-secondary text-sm mt-1.5 line-clamp-3 leading-relaxed">{data.body}</p>}
      <span className="text-brand-pink text-xs font-semibold mt-2 inline-block">Read full article →</span>
    </div>
  );
}

function TierListContent({ data }) {
  const tiers = Array.isArray(data?.tiers) ? data.tiers : [];
  if (tiers.length === 0) return null;
  return (
    <div className="mt-3 rounded-2xl border border-white/[0.06] overflow-hidden">
      <div className="px-3 py-2 bg-surface-1/50 border-b border-white/[0.04] flex items-center gap-2">
        <Icon name="format_list_numbered" size={14} className="text-brand-violet" />
        <span className="text-brand-violet text-[10px] font-bold uppercase tracking-widest">Tier List</span>
      </div>
      {tiers.filter(t => t.items?.length > 0).map(tier => (
        <div key={tier.label} className="flex items-stretch border-b border-white/[0.04] last:border-b-0">
          <div className="w-10 shrink-0 flex items-center justify-center font-syne font-black text-sm text-white" style={{ background: `${tier.color}25`, borderRight: `2px solid ${tier.color}` }}>{tier.label}</div>
          <div className="flex flex-wrap gap-1 p-1.5 flex-1">
            {tier.items.map((item, i) => <span key={i} className="px-2 py-0.5 rounded text-[10px] font-semibold text-white" style={{ background: `${tier.color}30`, border: `1px solid ${tier.color}40` }}>{item}</span>)}
          </div>
        </div>
      ))}
    </div>
  );
}

function AchievementContent({ data }) {
  if (!data) return null;
  const COLORS = { win: '#F5C542', rank: '#B44FFF', milestone: '#7B6FFF', record: '#FF4D6A', unlock: '#C87FFF', other: '#F5C542' };
  const ICONS = { win: 'emoji_events', rank: 'military_tech', milestone: 'flag', record: 'speed', unlock: 'lock_open', other: 'star' };
  const color = COLORS[data.achievementType] || '#F5C542';
  return (
    <div className="mt-3 p-4 rounded-2xl border" style={{ background: `${color}08`, borderColor: `${color}25` }}>
      <div className="flex items-center gap-2.5 mb-2">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${color}20` }}>
          <Icon name={ICONS[data.achievementType] || 'star'} size={22} style={{ color }} />
        </div>
        <div className="flex-1">
          <p className="font-syne font-bold text-sm text-text-primary">{data.title}</p>
          {data.game && <p className="text-text-muted text-[10px] font-dmmono">{data.game}</p>}
        </div>
      </div>
      {data.description && <p className="text-text-secondary text-sm leading-relaxed">{data.description}</p>}
    </div>
  );
}

function EmbeddedPost({ post, onClick }) {
  const { profile: viewer } = useUser();
  if (!post) return (
    <div className="rounded-2xl border border-white/[0.06] bg-surface-1/30 p-4 text-center">
      <p className="text-text-muted text-sm">Post unavailable</p>
    </div>
  );
  // Mask the author if they're a Vanguard member and the viewer isn't.
  const author = applyVanguardMask(post.author, viewer);
  return (
    <button onClick={onClick} className="w-full rounded-2xl border border-white/[0.06] bg-surface-1/30 p-3.5 text-left hover:border-white/[0.06] transition-colors">
      <div className="flex items-center gap-2 mb-1.5">
        <UserAvatar src={author?.avatar} size={18} />
        <span className="text-text-primary text-xs font-semibold"><UserName user={author} masked fallback={'User'} /></span>
        <RankBadge level={author?.vpLevel} role={author?.role} size={12} style={{ verticalAlign: '-2px' }} />
        {author?.vanguardBadge && <VanguardBadge rank={post.author?.vanguard?.rank} size={12} />}
        <span className="text-text-muted text-xs"><UserName user={author} masked handle /></span>
        <span className="text-text-muted text-xs">· {timeAgo(post.createdAt)}</span>
      </div>
      {post.content && <p className="text-text-secondary text-sm leading-relaxed line-clamp-3">{post.content}</p>}
      {post.mediaUrls?.length > 0 && (
        <div className="mt-2 rounded-xl overflow-hidden border border-white/[0.04] max-h-[120px]">
          <img src={post.mediaUrls[0]} alt="" className="w-full h-full object-cover" loading="lazy" />
        </div>
      )}
    </button>
  );
}


// Link-preview thumbnail that removes itself if the image can't load. Many news
// sources (e.g. gematsu.com) hotlink-protect their images and return 403 from
// any other origin, and some feeds store dead/entity-mangled URLs — either way
// a bare <img> shows the browser's broken-image glyph. Hiding it keeps the card
// clean (title + description still render and it stays clickable) instead of
// deleting real news content over a missing thumbnail.
function LinkPreviewImage({ src }) {
  const [failed, setFailed] = useState(false);
  // A URL that arrived HTML-entity-encoded (&amp; → &) would 404 on strict
  // CDNs; decode before use so we don't hide an image that was only mis-stored.
  const clean = useMemo(() => String(src || '').replace(/&amp;/g, '&'), [src]);
  if (failed || !clean) return null;
  return (
    <img
      src={clean}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="w-20 h-16 object-cover rounded-lg shrink-0"
    />
  );
}

/**
 * The visible proof a boost is running.
 *
 * ⚠ Shown to EVERYONE, not just the buyer. Two reasons: the person who paid
 * needs to see the thing they bought actually working, and labelling promoted
 * content is the honest default rather than hiding that reach was purchased.
 *
 * Ticks once a second and stops itself the moment the boost lapses — a
 * countdown still running on an expired boost is a wrong number on screen.
 */
function BoostedPill({ post }) {
  const [ms, setMs] = useState(() => boostRemainingMs(post));
  useEffect(() => {
    if (!isBoosted(post)) return undefined;
    const id = setInterval(() => {
      const left = boostRemainingMs(post);
      setMs(left);
      if (left <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [post]);

  if (ms <= 0) return null;
  return (
    <span
      title={`Boosted — shown to more people for another ${formatBoostRemaining(ms)}`}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
      style={{ background: 'rgba(240,64,96,0.15)', color: '#F04060' }}
    >
      <Icon name="rocket_launch" size={11} />
      Boosted
      <span style={{ opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>
        {formatBoostRemaining(ms)}
      </span>
    </span>
  );
}

// variant: 'feed' (default) is the timeline card; 'tile' is the fixed-shape card a
// profile grid uses on a wide screen (see the tile branch before the render).
export default function PostCard({ post, onDeleted, onLikeUpdate, variant = 'feed' }) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { isUserLive } = useLiveUsers();
  const { profile: viewer, updateProfile } = useUser();
  const { showToast } = useUI();
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likeCount || 0);
  const [bookmarked, setBookmarked] = useState(false);
  const [saveCount, setSaveCount] = useState(post.saveCount || 0);
  const [shareCount, setShareCount] = useState(post.shareCount || 0);
  const [reposted, setReposted] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  // Boosts are tokens you own and may spend on ANYONE's post, so this is not
  // gated on authorship — the sheet handles buying one if you have none.
  const [showBoost, setShowBoost] = useState(false);
  const [showRepostMenu, setShowRepostMenu] = useState(false);
  const [showTipModal, setShowTipModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [contentOverride, setContentOverride] = useState(null); // set after a successful edit
  const [mediaOverride, setMediaOverride] = useState(null);
  const [embeddedPost, setEmbeddedPost] = useState(null);
  const [liking, setLiking] = useState(false);
  const [burstKey, setBurstKey] = useState(0); // like particle burst (B11-1)
  const [bookmarking, setBookmarking] = useState(false);
  const [reposting, setReposting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [lightbox, setLightbox] = useState(null); // { urls, index }
  const cardRef = useRef(null);
  useImpressionTracker(cardRef, post, { source: 'feed' });

  const originalPostId = post.repostOf || post.quotedPostId;
  const isRepostType = post.type === 'repost';
  const isQuoteType = post.type === 'quote';
  const isOwnPost = currentUser?.uid === post.authorId;

  const fullContent = contentOverride ?? (post.previewText || post.content || '');
  const isEdited = !!(contentOverride !== null || post.editedAt);
  // Measure the VISIBLE length (markup stripped) so a heavily-formatted caption
  // isn't truncated too early, and truncate on a marker-safe boundary so a
  // "Read more" preview never leaks raw "{{c:…}}" / "**".
  const shouldTruncate = stripPostFormatting(fullContent).length > 300 && post.type !== 'poll' && post.type !== 'lfg' && post.type !== 'article' && post.type !== 'tierlist' && post.type !== 'achievement';
  const displayContent = shouldTruncate && !expanded ? truncateFormatted(fullContent, 300) + '…' : fullContent;
  // On-demand translation (native/desktop app only; hidden when already in the
  // viewer's language). When showing, the translated text REPLACES the original.
  const tr = useTranslate(fullContent, { kind: 'post', refId: post.id, knownLang: post.lang });

  useEffect(() => {
    setLikeCount(post.likeCount || 0);
  }, [post.likeCount]);

  useEffect(() => {
    if (!currentUser?.uid || !post.id) return;
    isPostLiked(post.id, currentUser.uid).then(setLiked).catch(() => {});
    isBookmarked(post.id, currentUser.uid).then(setBookmarked).catch(() => {});
    const checkId = originalPostId || post.id;
    isReposted(currentUser.uid, checkId).then(setReposted).catch(() => {});
  }, [currentUser?.uid, post.id, originalPostId]);

  useEffect(() => {
    if (originalPostId) {
      getPostWithAuthor(originalPostId).then(setEmbeddedPost).catch(() => {});
    }
  }, [originalPostId]);

  useEffect(() => {
    if (!showMenu && !showRepostMenu) return;
    const close = () => { setShowMenu(false); setShowRepostMenu(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showMenu, showRepostMenu]);

  const handleLike = async () => {
    if (!currentUser || liking) return;
    setLiking(true);
    const wasLiked = liked;
    const oldCount = likeCount;
    setLiked(!wasLiked);
    if (!wasLiked) setBurstKey((k) => k + 1); // fire the particle burst on like
    const newCount = wasLiked ? oldCount - 1 : oldCount + 1;
    setLikeCount(newCount);
    try {
      await toggleLike(post.id, currentUser.uid);
      if (!wasLiked) captureInterest(post, 1); // positive interest signal
      trackEvent(wasLiked ? 'unlike' : 'like', {
        postId: post.id, authorId: post.authorId,
        contentType: post.type, tags: post.tags?.slice?.(0, 5), gameId: post.gameId,
      });
      if (onLikeUpdate) {
        onLikeUpdate(post.id, newCount, !wasLiked);
      }
    } catch (err) {
      setLiked(wasLiked);
      setLikeCount(oldCount);
      console.error('Like error:', err);
    }
    setLiking(false);
  };

  // Double-tap on media (B11-2): always LIKES, never unlikes (Instagram model).
  // The centered heart pop is handled inside MediaContent; here we just commit
  // the like when it isn't already liked.
  const handleDoubleTapLike = () => {
    if (!currentUser || liking || liked) return;
    handleLike();
  };

  const handleBookmark = async () => {
    if (!currentUser || bookmarking) return;
    setBookmarking(true);
    const wasBookmarked = bookmarked;
    setBookmarked(!wasBookmarked);
    setSaveCount(prev => wasBookmarked ? Math.max(0, prev - 1) : prev + 1);
    try {
      await toggleBookmark(post.id, currentUser.uid);
      if (!wasBookmarked) captureInterest(post, 1); // saving is a strong signal
    } catch (err) {
      setBookmarked(wasBookmarked);
      setSaveCount(prev => wasBookmarked ? prev + 1 : Math.max(0, prev - 1));
    }
    setBookmarking(false);
  };

  // "Not interested" / "See less" — record a negative feed signal and remove the
  // card from view (local only; does NOT delete the post). onDeleted just filters
  // it out of the feed list.
  const primaryTag = Array.isArray(post.hashtags) ? post.hashtags[0] : null;
  const handleNotInterested = ({ author, tag } = {}) => {
    if (author) addNegativeAuthor(post.authorId);
    if (tag && primaryTag) addNegativeTopic(primaryTag);
    setShowMenu(false);
    onDeleted?.(post.id);
    showToast?.("Thanks — we'll show less like this", 'success');
  };

  const handleRepost = async () => {
    if (!currentUser || reposting) return;
    setReposting(true);
    const targetId = originalPostId || post.id;
    const wasReposted = reposted;
    setReposted(!wasReposted);
    setShareCount(prev => wasReposted ? Math.max(0, prev - 1) : prev + 1);
    try {
      if (wasReposted) {
        await undoRepost(currentUser.uid, targetId);
      } else {
        await repost(currentUser.uid, targetId);
        trackEvent('repost', {
          postId: targetId, authorId: post.authorId,
          contentType: post.type, tags: post.tags?.slice?.(0, 5), gameId: post.gameId,
        });
      }
    } catch (err) {
      setReposted(wasReposted);
      setShareCount(prev => wasReposted ? prev + 1 : Math.max(0, prev - 1));
    }
    setReposting(false);
    setShowRepostMenu(false);
  };

  const handleQuote = () => {
    const targetId = originalPostId || post.id;
    navigate(`/create/quote?post=${targetId}`);
    setShowRepostMenu(false);
  };

  const handleShareLink = async () => {
    // /share/post/:id is server-rendered with Open Graph tags so messengers
    // (WhatsApp, Discord, etc.) show a real preview card with title + image
    // instead of our SPA's default tags.
    const shareKind = (isShortFormat(post.type) || post.type === 'video') ? 'clip' : 'post';
    const postUrl = withRef(publicUrl(`/share/${shareKind}/${post.id}`));
    if (navigator.share) {
      try {
        await navigator.share({ title: stripPostFormatting(post.content)?.slice(0, 50) || 'Check this out on VERGR', url: postUrl });
        incrementShareCount(post.id);
        trackEvent('share', {
          postId: post.id, authorId: post.authorId,
          contentType: post.type, tags: post.tags?.slice?.(0, 5), gameId: post.gameId,
        });
      } catch (err) { /* user cancelled */ }
    } else {
      try { await navigator.clipboard.writeText(postUrl); } catch (err) {}
    }
    setShowRepostMenu(false);
  };

  const handleDelete = async () => {
    if (!isOwnPost || deleting) return;
    if (!window.confirm('Delete this post? This cannot be undone.')) { setShowMenu(false); return; }
    setDeleting(true);
    try {
      await deletePost(post.id, post.authorId);
      if (onDeleted) onDeleted(post.id);
    } catch (err) {
      console.error('Delete failed:', err);
    }
    setDeleting(false);
    setShowMenu(false);
  };

  const openEdit = () => {
    setShowEditModal(true);
    setShowMenu(false);
  };

  // Pin/unpin to profile — pinnedPostIds[] on the user doc, cap 3 (IG model).
  const isPinned = (viewer?.pinnedPostIds || []).includes(post.id);
  const handlePinToggle = async () => {
    if (!isOwnPost) return;
    const cur = viewer?.pinnedPostIds || [];
    if (!isPinned && cur.length >= 3) {
      showToast('You can pin up to 3 posts — unpin one first', 'info');
      setShowMenu(false);
      return;
    }
    const next = isPinned ? cur.filter(pid => pid !== post.id) : [...cur, post.id];
    try {
      await updateProfile?.({ pinnedPostIds: next });
      showToast(isPinned ? 'Unpinned from profile' : 'Pinned to your profile', 'success');
    } catch (err) {
      showToast(err?.message || 'Could not update pins', 'error');
    }
    setShowMenu(false);
  };

  // The composer saved the edit; reflect the new content/media in place so the
  // card updates without a refetch (likes/comments untouched on the server).
  const handleEdited = (fields) => {
    if (fields.content !== undefined) setContentOverride(fields.content);
    if (Array.isArray(fields.mediaUrls)) setMediaOverride(fields.mediaUrls);
    setExpanded(false);
  };

  const handleReport = (reason) => {
    if (!currentUser) return;
    reportPost(currentUser.uid, post.id, reason).catch(console.error);
    setShowReportModal(false);
    setShowMenu(false);
  };

  const handleCopyLink = () => {
    const shareKind = (isShortFormat(post.type) || post.type === 'video') ? 'clip' : 'post';
    navigator.clipboard?.writeText(withRef(publicUrl(`/share/${shareKind}/${post.id}`)));
    setShowMenu(false);
  };

  // "Also share to feed", changeable after posting, the way Instagram lets you
  // remove a reel from your grid. The clip stays in Clips either way.
  const [feedOverride, setFeedOverride] = useState(null);
  const inFeed = feedOverride ?? sharesToFeed(post);
  const handleToggleFeed = async () => {
    setShowMenu(false);
    const next = !inFeed;
    try {
      await setShareToFeed(post.id, next);
      setFeedOverride(next);
      showToast(next ? 'Shared to your profile and feed' : 'Removed from your profile and feed. It stays in Clips.', 'success');
    } catch {
      showToast('Could not update this clip. Please try again.', 'error');
    }
  };

  const goToPost = () => {
    trackEvent('comment', {
      postId: post.id, authorId: post.authorId,
      contentType: post.type, tags: post.tags?.slice?.(0, 5), gameId: post.gameId,
    });
    // Short-form opens the immersive scroller; a VIDEO post opens its own
    // detail screen with the author, the comments and the rest below it. Sending
    // a video post into the TikTok scroller was the same conflation as rendering
    // a clip as a video card.
    if (isShortFormat(post.type)) navigate(`/clip/${post.id}`);
    else navigate(`/post/${post.id}`);
  };

  // The comment button. On a clip it opens the clip WITH its comment sheet up,
  // never a separate page (founder, 2026-09-12 and again 2026-09-13).
  const goToComments = () => {
    if (!isShortFormat(post.type)) { goToPost(); return; }
    trackEvent('comment', {
      postId: post.id, authorId: post.authorId,
      contentType: post.type, tags: post.tags?.slice?.(0, 5), gameId: post.gameId,
    });
    navigate(`/clip/${post.id}?comments=1`);
  };

  // Base content post, with any just-edited media applied so the card reflects
  // the edit in place (mediaOverride is only set after an own-post edit).
  const baseContentPost = isRepostType ? embeddedPost : post;
  const contentPost = mediaOverride && !isRepostType
    ? { ...baseContentPost, mediaUrls: mediaOverride, mediaUrl: mediaOverride[0] || null }
    : baseContentPost;

  // ── The one image the card's ambilight samples ────────────────────────
  //
  // Resolved here, once, rather than by each media component, because the card
  // draws ONE glow behind everything (see the render). Priority is the frame a
  // viewer actually sees first:
  //   1. an uploaded video's poster
  //   2. a YouTube/Twitch embed's poster — the ONLY thing reachable for an
  //      embed, because a cross-origin iframe's pixels cannot be sampled
  //   3. the first image
  // A text-only post resolves to null and draws no glow at all, so an ordinary
  // feed of text posts costs exactly what it did before.
  const cardPosterUrl = useMemo(() => {
    const p = contentPost || post;
    if (p?.thumbnailUrl) return p.thumbnailUrl;
    if (p?.youtubeVideoId || p?.embedVideoUrl) {
      const parsed = p.youtubeVideoId
        ? { platform: 'youtube', videoId: p.youtubeVideoId }
        : parseVideoUrl(p.embedVideoUrl);
      const t = getThumbnailUrl(parsed);
      if (t) return t;
    }
    const urls = p?.mediaUrls?.length ? p.mediaUrls : (p?.mediaUrl ? [p.mediaUrl] : []);
    const firstImage = urls.find((u) => typeof u === 'string' && !/\.(mp4|webm|mov|m3u8)(\?|$)/i.test(u));
    return firstImage || null;
  }, [contentPost, post]);

  // Vanguard identity mask for the author chip. If the author is an active
  // Vanguard and the viewer isn't allied, the author renders as
  // "@Vanguard" / "@Commander" with the rank avatar instead of the real
  // identity. Real author's `verified` + `tier` are also hidden under mask.
  const maskedAuthor = applyVanguardMask((contentPost || post)?.author, viewer);
  const isAuthorMasked = !!maskedAuthor?.isVanguardPersona;

  // ── Shared pieces. The feed card and the profile tile render the SAME
  // controls, menu and sheets from these, so the two can never drift apart. ──
  const likeControl = (
    <button onClick={handleLike} disabled={liking} aria-label={liked ? 'Unlike' : 'Like'}
      className={`relative flex items-center gap-1.5 px-2 py-1.5 rounded-full transition-all ${liked ? 'text-brand-ember' : 'text-text-muted hover:text-brand-ember'}`}>
      <span className="relative flex items-center justify-center">
        <HeartBurst triggerKey={burstKey} />
        <motion.div
          animate={liked ? { scale: [1, 1.3, 1] } : { scale: 1 }}
          transition={{ type: 'spring', stiffness: 600, damping: 15 }}>
          <Icon name={liked ? 'favorite' : 'favorite_border'} filled={liked} size={20} />
        </motion.div>
      </span>
      <AnimatedNumber value={likeCount} className="text-xs font-dmmono" />
    </button>
  );

  const commentControl = (
    <button onClick={goToComments} aria-label="Comments" className="flex items-center gap-1.5 px-2 py-1.5 rounded-full text-text-muted hover:text-brand-violet-light transition-colors">
      <Icon name="chat_bubble_outline" size={20} />
      <span className="text-xs font-dmmono">{post.commentCount || 0}</span>
    </button>
  );

  const repostControl = (
    <div className="relative">
      <button onClick={(e) => { e.stopPropagation(); setShowRepostMenu(!showRepostMenu); }} disabled={reposting} aria-label="Repost or share"
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full transition-all ${reposted ? 'text-brand-violet' : 'text-text-muted hover:text-brand-violet'}`}>
        <Icon name="repeat" size={20} />
        <span className="text-xs font-dmmono">{shareCount}</span>
      </button>
      {showRepostMenu && (
        <div className="absolute bottom-full left-0 mb-2 z-50 w-44 bg-surface-1 rounded-xl shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <button onClick={handleRepost}
            className={`w-full px-4 py-3 text-left text-sm hover:bg-surface-2 transition-colors flex items-center gap-2.5 ${reposted ? 'text-brand-violet' : 'text-text-primary'}`}>
            <Icon name="repeat" size={16} className={reposted ? 'text-brand-violet' : 'text-text-muted'} />
            {reposted ? 'Undo repost' : 'Repost'}
          </button>
          <button onClick={handleQuote} className="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-surface-2 transition-colors flex items-center gap-2.5">
            <Icon name="edit_note" size={16} className="text-text-muted" /> Quote
          </button>
          <button onClick={handleShareLink} className="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-surface-2 transition-colors flex items-center gap-2.5">
            <Icon name="share" size={16} className="text-text-muted" /> Share link
          </button>
        </div>
      )}
    </div>
  );

  const bookmarkControl = (
    <button onClick={handleBookmark} disabled={bookmarking} aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark'}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full transition-all ${bookmarked ? 'text-brand-gold' : 'text-text-muted hover:text-brand-gold'}`}>
      <Icon name={bookmarked ? 'bookmark' : 'bookmark_border'} filled={bookmarked} size={20} />
      {saveCount > 0 && <span className="text-xs font-dmmono">{saveCount}</span>}
    </button>
  );

  // ⚠ ONLY THE AUTHOR SEES BOOST HERE. Founder, 2026-08-28: a boost button on
  // your own post, while everyone else reaches it from the three-dot menu. It
  // sits in the slot Tip uses on other people's posts, which is free here
  // because you cannot tip yourself.
  const boostOrTipControl = isOwnPost ? (
    <button
      onClick={(e) => { e.stopPropagation(); setShowBoost(true); }}
      className="flex items-center gap-1.5 px-3 py-1 rounded-full text-brand-ember hover:brightness-125 transition"
      style={{ background: '#2A1520' }}
    >
      <Icon name="rocket_launch" size={13} />
      <span className="text-[11px] font-bold">Boost</span>
    </button>
  ) : (
    <button
      onClick={(e) => { e.stopPropagation(); setShowTipModal(true); }}
      // Solid, no hairline: a tinted wash with a matching stroke is the cheap
      // pill the founder has ruled out.
      className="flex items-center gap-1.5 px-3 py-1 rounded-full text-brand-violet-light hover:brightness-125 transition"
      style={{ background: '#1F1636' }}
    >
      <CoinIcon size={13} />
      <span className="text-[11px] font-bold">Tip</span>
    </button>
  );

  const moreMenu = (
    <div className="relative shrink-0">
      <button onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }} aria-label="More options" className="text-text-muted hover:text-text-secondary p-1">
        <Icon name="more_horiz" size={20} />
      </button>
      {showMenu && (
        <div className="absolute right-0 top-8 z-50 w-48 bg-surface-1 rounded-xl shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <button onClick={handleCopyLink} className="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-surface-2 transition-colors flex items-center gap-2.5">
            <Icon name="link" size={16} className="text-text-muted" /> Copy link
          </button>
          <button onClick={() => { handleBookmark(); setShowMenu(false); }} className="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-surface-2 transition-colors flex items-center gap-2.5">
            <Icon name={bookmarked ? 'bookmark' : 'bookmark_border'} size={16} className="text-text-muted" /> {bookmarked ? 'Remove bookmark' : 'Bookmark'}
          </button>
          <button onClick={() => { setShowBoost(true); setShowMenu(false); }} className="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-surface-2 transition-colors flex items-center gap-2.5">
            <Icon name="rocket_launch" size={16} className="text-text-muted" /> Boost this post
          </button>
          {isOwnPost ? (
            <>
              <button onClick={handlePinToggle} className="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-surface-2 transition-colors flex items-center gap-2.5">
                <Icon name="push_pin" size={16} className="text-text-muted" /> {isPinned ? 'Unpin from profile' : 'Pin to profile'}
              </button>
              {isShortFormat(post.type) && (
                <button onClick={handleToggleFeed} className="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-surface-2 transition-colors flex items-center gap-2.5">
                  <Icon name={inFeed ? 'grid_off' : 'dynamic_feed'} size={16} className="text-text-muted" /> {inFeed ? 'Remove from profile & feed' : 'Also share to feed'}
                </button>
              )}
              <button onClick={openEdit} className="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-surface-2 transition-colors flex items-center gap-2.5">
                <Icon name="edit" size={16} className="text-text-muted" /> Edit post
              </button>
              <button onClick={handleDelete} disabled={deleting} className="w-full px-4 py-3 text-left text-sm text-brand-ember hover:bg-brand-ember/10 transition-colors flex items-center gap-2.5">
                <Icon name="delete" size={16} /> {deleting ? 'Deleting...' : 'Delete post'}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => handleNotInterested({ author: true })} className="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-surface-2 transition-colors flex items-center gap-2.5">
                <Icon name="do_not_disturb_on" size={16} className="text-text-muted" /> Not interested
              </button>
              {primaryTag && (
                <button onClick={() => handleNotInterested({ tag: true })} className="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-surface-2 transition-colors flex items-center gap-2.5">
                  <Icon name="tag" size={16} className="text-text-muted" /> See less of #{String(primaryTag).replace(/^#/, '')}
                </button>
              )}
              <button onClick={() => { navigate(`/user/${post.authorId}`); setShowMenu(false); }} className="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-surface-2 transition-colors flex items-center gap-2.5">
                <Icon name="person" size={16} className="text-text-muted" /> View profile
              </button>
              <button onClick={() => { setShowReportModal(true); setShowMenu(false); }} className="w-full px-4 py-3 text-left text-sm text-brand-ember hover:bg-brand-ember/10 transition-colors flex items-center gap-2.5">
                <Icon name="flag" size={16} /> Report post
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );

  const cardOverlays = (
    <>
      {showBoost && (
        <BoostSheet
          target="post"
          targetId={post.id}
          isLfg={post.type === 'lfg'}
          targetLabel={isOwnPost ? 'your post' : 'this post'}
          onClose={() => setShowBoost(false)}
        />
      )}

      {lightbox && (
        <ImageLightbox urls={lightbox.urls} startIndex={lightbox.index} onClose={() => setLightbox(null)} />
      )}

      {/* Report modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowReportModal(false)}>
          <div className="bg-surface-1 rounded-2xl w-full max-w-sm mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 flex items-center justify-between">
              <h3 className="font-syne font-bold text-sm">Report Post</h3>
              <button onClick={() => setShowReportModal(false)} aria-label="Close" className="text-text-muted p-1"><Icon name="close" size={18} /></button>
            </div>
            <div className="py-1">
              {['Spam or scam', 'Harassment or bullying', 'Hate speech', 'Inappropriate content', 'Cheating or exploiting', 'Impersonation', 'Other'].map(reason => (
                <button key={reason} onClick={() => handleReport(reason)}
                  className="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-surface-2 transition-colors">
                  {reason}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Edit reuses the full create composer, prefilled with this post */}
      {showEditModal && (
        <CreateComposer
          editingPost={post}
          onEdited={handleEdited}
          onClose={() => setShowEditModal(false)}
        />
      )}
      <TipPostModal
        isOpen={showTipModal}
        onClose={() => setShowTipModal(false)}
        post={post}
      />
    </>
  );

  // ── THE PROFILE TILE ─────────────────────────────────────────────────
  //
  // Founder, 2026-09-14, on the one-column fix: "your lazy as fuck solution on the
  // profile screen was to make it one column". A profile grid needs a card whose
  // SHAPE does not depend on its content. Every section here has a fixed height:
  //   header 52 · stage 4:5 · caption 48 (two lines, always reserved) · actions 46
  // so every tile in a row is the same height and every action row sits on the
  // same line, whether the post is a clip with no caption, a photo or 300
  // characters of text. The stage (PostTileStage) fills the same box for every
  // post type. Clicking the stage opens the post, or the player for a clip.
  if (variant === 'tile') {
    const tilePost = contentPost || null;
    const tileText = stripPostFormatting(isRepostType ? (tilePost?.content || '') : fullContent).trim();
    const tileTags = (Array.isArray(tilePost?.hashtags) ? tilePost.hashtags : [])
      .map((t) => `#${String(t).replace(/^#/, '')}`).join(' ');
    const stageHasText = tileStageShowsText(tilePost);
    const caption = stageHasText ? tileTags : (tileText || tileTags);
    const authorId = tilePost?.authorId || post.authorId;
    return (
      <motion.article
        ref={cardRef}
        data-post-id={post.id}
        data-vg-tile=""
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
        className="relative flex flex-col h-full rounded-[14px] transition-colors hover:bg-[#191927]"
        style={{ background: '#14141F' }}
      >
        <div className="flex items-center gap-2.5 pl-3 pr-1.5 h-[52px] shrink-0">
          <button onClick={() => navigate(`/user/${authorId}`)} className="shrink-0" aria-label="Open profile">
            <UserAvatar
              src={maskedAuthor?.avatar}
              size={30}
              isVerified={!isAuthorMasked && tilePost?.author?.isVerified}
              isLive={!isAuthorMasked && isUserLive(authorId)}
            />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 min-w-0">
              <button onClick={() => navigate(`/user/${authorId}`)} className="min-w-0 truncate text-[13px] font-semibold text-text-primary hover:underline text-left">
                <UserName user={maskedAuthor} masked context="feed" />
              </button>
              <RankBadge level={maskedAuthor?.vpLevel} role={maskedAuthor?.role} size={12} style={{ verticalAlign: '-2px' }} />
            </div>
            <p className="flex items-center gap-1 text-[11px] text-text-muted truncate">
              {isRepostType && <><Icon name="repeat" size={12} className="text-brand-violet" /> Reposted ·</>}
              {timeAgo((tilePost || post).createdAt)}{isEdited ? ' · edited' : ''}
            </p>
          </div>
          <BoostedPill post={post} />
          {moreMenu}
        </div>

        <button
          type="button"
          onClick={goToPost}
          aria-label={isShortFormat(tilePost?.type) ? 'Open clip' : 'Open post'}
          className="relative block w-full aspect-[4/5] overflow-hidden shrink-0"
          style={{ background: '#0E0E17' }}
        >
          <PostTileStage post={tilePost} text={tileText} />
        </button>

        <div className="px-3.5 pt-2.5 h-[48px] shrink-0">
          <p className={`text-[13px] leading-[19px] line-clamp-2 break-words ${stageHasText ? 'text-brand-violet-light' : 'text-text-secondary'}`}>
            {caption}
          </p>
        </div>

        <div className="mt-auto flex items-center pl-1.5 pr-3 h-[46px] shrink-0">
          {likeControl}
          {commentControl}
          {repostControl}
          {bookmarkControl}
          <div className="flex-1" />
          {boostOrTipControl}
        </div>

        {cardOverlays}
      </motion.article>
    );
  }

  return (
    <motion.article
      ref={cardRef}
      data-post-id={post.id}
      layout="position"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
      // No divider line between posts. Founder, 2026-09-14: the thin dividers had
      // to go. Posts are separated by space (the py-5 below), not a hairline.
      className="w-full hover:bg-surface-1/30 transition-colors relative"
      // `isolation: isolate` makes the card a stacking context, so the
      // z-index:-1 glow below paints ABOVE the card's own background and BELOW
      // every piece of card content. Without it the glow escapes to an ancestor
      // context and is covered by the first opaque background above it
      // (docs/effects/00-RULES.md R6).
      //
      // `overflow: hidden` is what CONTAINS the glow. The glow is anchored to
      // the media and bleeds past it, so the clip — not padding — is what stops
      // it reaching the card above or below.
      style={{ isolation: 'isolate', overflow: 'hidden' }}
    >
      <div className="px-4 py-5">
        {/* Repost header — masked author */}
        {isRepostType && (
          <div className="flex items-center gap-2 mb-2 ml-12">
            <Icon name="repeat" size={14} className="text-brand-violet" />
            <button onClick={() => navigate(`/user/${post.authorId}`)} className="text-text-muted text-xs hover:text-text-secondary transition-colors">
              <span className="font-semibold">{applyVanguardMask(post.author, viewer)?.displayName || 'Someone'}</span> reposted
            </button>
          </div>
        )}

        <div className="flex items-start gap-3">
          <button onClick={() => navigate(`/user/${(contentPost || post).authorId}`)}>
            <UserAvatar
              src={maskedAuthor?.avatar}
              size={44}
              tier={isAuthorMasked ? null : (contentPost || post).author?.tier}
              isVerified={!isAuthorMasked && (contentPost || post).author?.isVerified}
              isLive={!isAuthorMasked && isUserLive((contentPost || post).authorId)}
            />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <button onClick={() => navigate(`/user/${(contentPost || post).authorId}`)} className="font-semibold text-text-primary text-sm hover:underline truncate"><UserName user={maskedAuthor} masked context="feed" /></button>
              {/* Rank crest, after the name. Static: only live chat asks for
                  the sweep. Free — _hydrateAuthors already loads the full user
                  doc, so vpLevel is in hand with no extra read. */}
              <RankBadge level={maskedAuthor?.vpLevel} role={maskedAuthor?.role} size={13} style={{ verticalAlign: '-2px' }} />
              {!isAuthorMasked && (contentPost || post).author?.isVerified && <span className="w-4 h-4 rounded-full bg-brand-violet flex items-center justify-center shrink-0"><Icon name="check" size={10} className="text-white" /></span>}
              {(contentPost || post).author?.vanguard?.rank && <VanguardBadge rank={(contentPost || post).author?.vanguard?.rank} size={14} />}
              {!isAuthorMasked && <TierBadge tier={(contentPost || post).author?.tier} size="xs" />}
              <span className="text-text-muted text-sm truncate"><UserName user={maskedAuthor} masked handle context="feed" /></span>
              <span className="text-text-muted text-xs shrink-0">· {timeAgo((contentPost || post).createdAt)}</span>
              {!isRepostType && isEdited && <span className="text-text-muted text-xs shrink-0">· edited</span>}
            </div>

            {!isRepostType && contentPost?.type !== 'article' && (
              <div className="mt-1.5">
                <p className="text-text-primary text-[15px] leading-relaxed whitespace-pre-wrap break-words cursor-pointer" onClick={goToPost}>
                  <PostRichText text={tr.showing && tr.translated ? tr.translated : displayContent} />
                </p>
                {!tr.showing && shouldTruncate && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                    className="text-brand-violet-light text-xs font-semibold mt-1 hover:underline"
                  >
                    {expanded ? 'Show less' : 'Read more'}
                  </button>
                )}
                {tr.canTranslate && (
                  <button
                    onClick={(e) => { e.stopPropagation(); tr.upgrade ? navigate('/settings/subscription') : tr.toggle(); }}
                    className="block text-brand-violet-light text-xs font-semibold mt-1 hover:underline"
                  >
                    {tr.busy ? 'Translating…'
                      : tr.showing ? `Translated${tr.detected ? ' from ' + langLabel(tr.detected) : ''} · Show original`
                      : tr.error ? 'Retry translate'
                      : 'Translate post'}
                  </button>
                )}
              </div>
            )}

            {!isRepostType && (post.youtubeVideoId || post.embedVideoUrl) && (
              <MediaGlow src={cardPosterUrl}>
              <EmbedVideoPlayer
                videoId={post.youtubeVideoId}
                videoUrl={post.embedVideoUrl}
                onClickFullscreen={() => {
                  if (post.youtubeVideoId) navigate(`/clip/${post.id}`);
                }}
              />
              </MediaGlow>
            )}

            {!isRepostType && !(post.youtubeVideoId || post.embedVideoUrl) && (
              <>
                {/* ⚠ `isShortFormat`, not a hand-listed 'clip'. A post of type
                    'short' was missing from this list, so its video never
                    rendered and it showed as a text-only card (both "Sound test"
                    posts on @Vergr, 2026-09-14). */}
                {(contentPost?.type === 'photo' || contentPost?.type === 'carousel' || contentPost?.type === 'video' || isShortFormat(contentPost?.type) || contentPost?.type === 'media') && (
                  <MediaGlow src={cardPosterUrl} fit={isShortFormat(contentPost?.type) && !(contentPost?.locked?.priceCoins > 0)}><MediaContent post={contentPost} onImageClick={(urls, i) => setLightbox({ urls, index: i })} onDoubleTapLike={handleDoubleTapLike} /></MediaGlow>
                )}
                {contentPost?.type === 'text' && (contentPost?.mediaUrl || contentPost?.mediaUrls?.length > 0) && (
                  <MediaGlow src={cardPosterUrl}><MediaContent post={contentPost} onImageClick={(urls, i) => setLightbox({ urls, index: i })} onDoubleTapLike={handleDoubleTapLike} /></MediaGlow>
                )}
                {contentPost?.type === 'poll' && <PollCard post={contentPost} />}
                {contentPost?.type === 'lfg' && <LFGContent data={contentPost?.lfgData} />}
                {contentPost?.type === 'article' && <div className="cursor-pointer" onClick={goToPost}><ArticleContent data={contentPost?.articleData} /></div>}
                {contentPost?.type === 'tierlist' && <TierListContent data={contentPost?.tierListData} />}
                {contentPost?.type === 'achievement' && <AchievementContent data={contentPost?.achievementData} />}
              </>
            )}

            {isQuoteType && (
              <div className="mt-3">
                <EmbeddedPost post={embeddedPost} onClick={() => embeddedPost && navigate(`/post/${embeddedPost.id}`)} />
              </div>
            )}

            {isRepostType && embeddedPost && (
              <div className="mt-1">
                {embeddedPost.content && (
                  <p className="text-text-primary text-[15px] leading-relaxed mb-2 whitespace-pre-wrap cursor-pointer" onClick={() => navigate(`/post/${embeddedPost.id}`)}><PostRichText text={embeddedPost.content} /></p>
                )}
                {embeddedPost.mediaUrls?.length > 0 && (
                  <div className="cursor-pointer rounded-2xl overflow-hidden border border-white/[0.06] mb-2" onClick={() => navigate(`/post/${embeddedPost.id}`)}>
                    <img src={embeddedPost.mediaUrls[0]} alt="" className="w-full max-h-[300px] object-cover" loading="lazy" />
                  </div>
                )}
              </div>
            )}

            {contentPost?.linkPreview && (
              <a href={contentPost.linkPreview.url} target="_blank" rel="noopener noreferrer"
                className="mt-3 p-3 rounded-xl border border-white/[0.06] bg-surface-1 flex gap-3 hover:border-white/[0.12] transition-colors block">
                {contentPost.linkPreview.image && (
                  <LinkPreviewImage src={contentPost.linkPreview.image} />
                )}
                <div className="flex-1 min-w-0">
                  <h4 className="text-white font-semibold text-sm truncate">{contentPost.linkPreview.title}</h4>
                  <p className="text-text-muted text-xs mt-0.5 line-clamp-1">{contentPost.linkPreview.description}</p>
                </div>
              </a>
            )}

            {((contentPost || post).hashtags?.length > 0) && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(contentPost || post).hashtags.map(tag => <span key={tag} className="text-brand-violet-light text-xs hover:underline cursor-pointer">#{tag}</span>)}
              </div>
            )}

            {/* Engagement bar */}
            <div className="flex items-center justify-between mt-3 -ml-2">
              {likeControl}
              {commentControl}
              {repostControl}
              {bookmarkControl}

              {/* ⚠ A DISPLAY FLOOR, NOT A ZERO CHECK. Founder, 2026-08-28: a
                  view counter was hidden originally because the first users would
                  see tiny numbers and be discouraged. The fix is a floor, not
                  concealment — below it the post simply shows no count.

                  ⚠ `viewCount` IS STILL NEVER WRITTEN. incrementViewCount() has
                  no callers, and counting every post is the thing we cannot afford
                  (docs/BOOST_DELIVERY_PLAN.md §6.3). Only BOOSTED items are
                  counted, and those numbers are private to the buyer. This floor
                  exists so that if public counting is ever built, it cannot ship
                  showing "3 views". */}
              {(post.viewCount || 0) >= PUBLIC_VIEW_FLOOR && (
                <span className="flex items-center gap-1 px-2 py-1.5 text-text-muted text-xs font-dmmono">
                  <Icon name="visibility" size={16} /> {post.viewCount >= 1000 ? `${(post.viewCount / 1000).toFixed(1)}k` : post.viewCount}
                </span>
              )}

              <BoostedPill post={post} />
              <div className="flex-1" />

              {boostOrTipControl}
            </div>
          </div>

          {moreMenu}
        </div>
      </div>

      {cardOverlays}
    </motion.article>
  );
}