import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import AnimatedNumber from './AnimatedNumber';
import { useAuth } from '../context/AuthContext';
import { useUser } from '../context/UserContext';
import { useUI } from '../context/UIContext';
import { useLiveUsers } from '../context/LiveUsersContext';
import { toggleLike, isPostLiked, toggleBookmark, isBookmarked, incrementShareCount, repost, undoRepost, isReposted, getPostWithAuthor, deletePost, reportPost } from '../firebase/firestore';
import { captureInterest } from '../utils/feedRank';
import { addNegativeAuthor, addNegativeTopic } from '../utils/feedPrefs';
import UserAvatar from './UserAvatar';
import VanguardBadge from './VanguardBadge';
import { applyVanguardMask } from '../utils/vanguard';
import Icon from './Icon';
import useTranslate from '../hooks/useTranslate';
import { langLabel } from '../utils/localePrefs';
import PollCard from './PollCard';
import PostRichText, { stripPostFormatting, truncateFormatted } from './PostRichText';
import TierBadge from './TierBadge';
import EmbedVideoPlayer from './EmbedVideoPlayer';
import InlineVideoPlayer from './media/InlineVideoPlayer';
import TipPostModal from './TipPostModal';
import CreateComposer from './composer/CreateComposer';
import { CoinIcon } from './CoinIcon';
import LockedMedia from './monetization/LockedMedia';
import { timeAgo } from '../utils/helpers';
import { withRef } from '../utils/shareRef';
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
function MediaRow({ items, onImageClick, onDoubleTapLike }) {
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
                <InlineVideoPlayer src={it.url} maxHeightClass="h-full" rounded={false} objectFit="contain" onDoubleTapLike={onDoubleTapLike} />
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

function MediaContent({ post, onImageClick, onDoubleTapLike }) {
  const { onTap, heartKey } = useMediaTap(onDoubleTapLike);
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
        <LockedMedia
          resourceType="post"
          resourceId={post.id}
          locked={post.locked}
          className="aspect-[4/5] max-h-[520px]"
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
    if (it.video) {
      return (
        <div className="mt-3 rounded-2xl overflow-hidden border border-white/[0.06] relative aspect-video bg-black" onClick={(e) => e.stopPropagation()}>
          <InlineVideoPlayer src={it.url} poster={post.thumbnailUrl} maxHeightClass="h-full" rounded={false} objectFit="contain" onDoubleTapLike={onDoubleTapLike} />
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

  return <MediaRow items={items} onImageClick={openImageLightbox} onDoubleTapLike={onDoubleTapLike} />;
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
        <span className="text-text-primary text-xs font-semibold">{author?.displayName || 'User'}</span>
        {author?.vanguardBadge && <VanguardBadge rank={post.author?.vanguard?.rank} size={12} />}
        <span className="text-text-muted text-xs">@{author?.username}</span>
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

export default function PostCard({ post, onDeleted, onLikeUpdate }) {
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
    const shareKind = (post.type === 'clip' || post.type === 'video') ? 'clip' : 'post';
    const postUrl = withRef(`${window.location.origin}/share/${shareKind}/${post.id}`);
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
    const shareKind = (post.type === 'clip' || post.type === 'video') ? 'clip' : 'post';
    navigator.clipboard?.writeText(`${window.location.origin}/share/${shareKind}/${post.id}`);
    setShowMenu(false);
  };

  const goToPost = () => {
    trackEvent('comment', {
      postId: post.id, authorId: post.authorId,
      contentType: post.type, tags: post.tags?.slice?.(0, 5), gameId: post.gameId,
    });
    if (post.type === 'clip' || post.type === 'video') navigate(`/clip/${post.id}`);
    else navigate(`/post/${post.id}`);
  };

  // Base content post, with any just-edited media applied so the card reflects
  // the edit in place (mediaOverride is only set after an own-post edit).
  const baseContentPost = isRepostType ? embeddedPost : post;
  const contentPost = mediaOverride && !isRepostType
    ? { ...baseContentPost, mediaUrls: mediaOverride, mediaUrl: mediaOverride[0] || null }
    : baseContentPost;

  // Vanguard identity mask for the author chip. If the author is an active
  // Vanguard and the viewer isn't allied, the author renders as
  // "@Vanguard" / "@Commander" with the rank avatar instead of the real
  // identity. Real author's `verified` + `tier` are also hidden under mask.
  const maskedAuthor = applyVanguardMask((contentPost || post)?.author, viewer);
  const isAuthorMasked = !!maskedAuthor?.isVanguardPersona;

  return (
    <motion.article
      ref={cardRef}
      data-post-id={post.id}
      layout="position"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
      className="w-full border-b border-white/[0.04] hover:bg-surface-1/30 transition-colors"
    >
      <div className="px-4 py-4">
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
              <button onClick={() => navigate(`/user/${(contentPost || post).authorId}`)} className="font-semibold text-text-primary text-sm hover:underline truncate">{maskedAuthor?.displayName || 'User'}</button>
              {!isAuthorMasked && (contentPost || post).author?.isVerified && <span className="w-4 h-4 rounded-full bg-brand-violet flex items-center justify-center shrink-0"><Icon name="check" size={10} className="text-white" /></span>}
              {(contentPost || post).author?.vanguard?.rank && <VanguardBadge rank={(contentPost || post).author?.vanguard?.rank} size={14} />}
              {!isAuthorMasked && <TierBadge tier={(contentPost || post).author?.tier} size="xs" />}
              <span className="text-text-muted text-sm truncate">@{maskedAuthor?.username}</span>
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
              <EmbedVideoPlayer
                videoId={post.youtubeVideoId}
                videoUrl={post.embedVideoUrl}
                onClickFullscreen={() => {
                  if (post.youtubeVideoId) navigate(`/clip/${post.id}`);
                }}
              />
            )}

            {!isRepostType && !(post.youtubeVideoId || post.embedVideoUrl) && (
              <>
                {(contentPost?.type === 'photo' || contentPost?.type === 'carousel' || contentPost?.type === 'video' || contentPost?.type === 'clip' || contentPost?.type === 'media') && (
                  <MediaContent post={contentPost} onImageClick={(urls, i) => setLightbox({ urls, index: i })} onDoubleTapLike={handleDoubleTapLike} />
                )}
                {contentPost?.type === 'text' && (contentPost?.mediaUrl || contentPost?.mediaUrls?.length > 0) && (
                  <MediaContent post={contentPost} onImageClick={(urls, i) => setLightbox({ urls, index: i })} onDoubleTapLike={handleDoubleTapLike} />
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
              <button onClick={handleLike} disabled={liking}
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

              <button onClick={goToPost} className="flex items-center gap-1.5 px-2 py-1.5 rounded-full text-text-muted hover:text-brand-violet-light transition-colors">
                <Icon name="chat_bubble_outline" size={20} />
                <span className="text-xs font-dmmono">{post.commentCount || 0}</span>
              </button>

              <div className="relative">
                <button onClick={(e) => { e.stopPropagation(); setShowRepostMenu(!showRepostMenu); }} disabled={reposting}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full transition-all ${reposted ? 'text-brand-violet' : 'text-text-muted hover:text-brand-violet'}`}>
                  <Icon name="repeat" size={20} />
                  <span className="text-xs font-dmmono">{shareCount}</span>
                </button>
                {showRepostMenu && (
                  <div className="absolute bottom-full left-0 mb-2 z-50 w-44 bg-surface-1 border border-white/[0.06] rounded-xl shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
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

              <button onClick={handleBookmark} disabled={bookmarking}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full transition-all ${bookmarked ? 'text-brand-gold' : 'text-text-muted hover:text-brand-gold'}`}>
                <Icon name={bookmarked ? 'bookmark' : 'bookmark_border'} filled={bookmarked} size={20} />
                {saveCount > 0 && <span className="text-xs font-dmmono">{saveCount}</span>}
              </button>

              {(post.viewCount || 0) > 0 && (
                <span className="flex items-center gap-1 px-2 py-1.5 text-text-muted text-xs font-dmmono">
                  <Icon name="visibility" size={16} /> {post.viewCount >= 1000 ? `${(post.viewCount / 1000).toFixed(1)}k` : post.viewCount}
                </span>
              )}

              <div className="flex-1" />

              <button
                onClick={(e) => { e.stopPropagation(); setShowTipModal(true); }}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-violet/12 border border-brand-violet/30 text-brand-violet hover:bg-brand-violet/20 transition-colors"
              >
                <CoinIcon size={13} />
                <span className="text-[11px] font-bold">Tip</span>
              </button>
            </div>
          </div>

          {/* Three dots menu */}
          <div className="relative">
            <button onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }} className="text-text-muted hover:text-text-secondary p-1">
              <Icon name="more_horiz" size={20} />
            </button>
            {showMenu && (
              <div className="absolute right-0 top-8 z-50 w-48 bg-surface-1 border border-white/[0.06] rounded-xl shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
                <button onClick={handleCopyLink} className="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-surface-2 transition-colors flex items-center gap-2.5">
                  <Icon name="link" size={16} className="text-text-muted" /> Copy link
                </button>
                <button onClick={() => { handleBookmark(); setShowMenu(false); }} className="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-surface-2 transition-colors flex items-center gap-2.5">
                  <Icon name={bookmarked ? 'bookmark' : 'bookmark_border'} size={16} className="text-text-muted" /> {bookmarked ? 'Remove bookmark' : 'Bookmark'}
                </button>
                {isOwnPost ? (
                  <>
                    <button onClick={handlePinToggle} className="w-full px-4 py-3 text-left text-sm text-text-primary hover:bg-surface-2 transition-colors flex items-center gap-2.5">
                      <Icon name="push_pin" size={16} className="text-text-muted" /> {isPinned ? 'Unpin from profile' : 'Pin to profile'}
                    </button>
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
        </div>

        {lightbox && (
          <ImageLightbox urls={lightbox.urls} startIndex={lightbox.index} onClose={() => setLightbox(null)} />
        )}

        {/* Report modal */}
        {showReportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowReportModal(false)}>
            <div className="bg-surface-1 border border-white/[0.06] rounded-2xl w-full max-w-sm mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="px-4 py-3 border-b border-white/[0.04] flex items-center justify-between">
                <h3 className="font-syne font-bold text-sm">Report Post</h3>
                <button onClick={() => setShowReportModal(false)} className="text-text-muted p-1"><Icon name="close" size={18} /></button>
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

      </div>

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
    </motion.article>
  );
}