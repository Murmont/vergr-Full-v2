import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { toggleLike, isPostLiked, toggleBookmark, isBookmarked, incrementShareCount, repost, undoRepost, isReposted, getPostWithAuthor, deletePost, reportPost } from '../firebase/firestore';
import UserAvatar from './UserAvatar';
import Icon from './Icon';
import PollCard from './PollCard';
import TierBadge from './TierBadge';
import EmbedVideoPlayer from './EmbedVideoPlayer';
import TipPostModal from './TipPostModal';
import { CoinIcon } from './CoinIcon';
import { timeAgo } from '../utils/helpers';
import { trackEvent } from '../utils/trackEvent';
import { useImpressionTracker } from '../hooks/useImpressionTracker';

function MediaContent({ post, onImageClick }) {
  const urls = post.mediaUrls?.length > 0 ? post.mediaUrls : (post.mediaUrl ? [post.mediaUrl] : []);
  if (urls.length === 0) return null;
  const isVideo = post.type === 'video' || post.type === 'clip';

  if (isVideo) {
    return (
      <div className="mt-3 rounded-2xl overflow-hidden border border-white/[0.06] relative aspect-video bg-black">
        <video
          src={urls[0]}
          controls
          playsInline
          muted
          preload="metadata"
          poster={post.thumbnailUrl}
          data-feed-video="1"
          className="w-full h-full object-cover"
          onClick={(e) => e.stopPropagation()}
        />
        {post.type === 'clip' && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-brand-ember/90 text-white text-[9px] font-bold uppercase tracking-wider">Clip</div>
        )}
      </div>
    );
  }

  const openAt = (i) => (e) => { e.stopPropagation(); onImageClick?.(urls, i); };

  if (urls.length > 1) {
    return (
      <div className="mt-3 flex gap-1 rounded-2xl overflow-hidden border border-white/[0.06] aspect-video bg-black">
        <img src={urls[0]} alt="" onClick={openAt(0)} className="flex-[2] h-full object-cover cursor-zoom-in" loading="lazy" />
        <div className="flex flex-col gap-1 flex-1">
          {urls.slice(1, 3).map((url, i) => <img key={i} src={url} alt="" onClick={openAt(i + 1)} className="flex-1 min-h-0 object-cover cursor-zoom-in" loading="lazy" />)}
          {urls.length > 3 && <div className="flex-1 bg-surface-2 flex items-center justify-center text-text-muted text-xs font-bold cursor-zoom-in" onClick={openAt(3)}>+{urls.length - 3}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl overflow-hidden border border-white/[0.06] aspect-video bg-black">
      <img src={urls[0]} alt="" onClick={openAt(0)} className="w-full h-full object-cover cursor-zoom-in" loading="lazy" />
    </div>
  );
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
  const COLORS = { win: '#F5C542', rank: '#4DFFD4', milestone: '#7B6FFF', record: '#FF4D6A', unlock: '#C87FFF', other: '#F5C542' };
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
  if (!post) return (
    <div className="rounded-2xl border border-white/[0.06] bg-surface-1/30 p-4 text-center">
      <p className="text-text-muted text-sm">Post unavailable</p>
    </div>
  );
  return (
    <button onClick={onClick} className="w-full rounded-2xl border border-white/[0.06] bg-surface-1/30 p-3.5 text-left hover:border-white/[0.06] transition-colors">
      <div className="flex items-center gap-2 mb-1.5">
        <UserAvatar src={post.author?.avatar} size={18} />
        <span className="text-text-primary text-xs font-semibold">{post.author?.displayName || 'User'}</span>
        <span className="text-text-muted text-xs">@{post.author?.username}</span>
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


export default function PostCard({ post, onDeleted, onLikeUpdate }) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
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
  const [embeddedPost, setEmbeddedPost] = useState(null);
  const [liking, setLiking] = useState(false);
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

  const fullContent = post.previewText || post.content || '';
  const shouldTruncate = fullContent.length > 300 && post.type !== 'poll' && post.type !== 'lfg' && post.type !== 'article' && post.type !== 'tierlist' && post.type !== 'achievement';
  const displayContent = shouldTruncate && !expanded ? fullContent.slice(0, 300) + '...' : fullContent;

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
    const newCount = wasLiked ? oldCount - 1 : oldCount + 1;
    setLikeCount(newCount);
    try {
      await toggleLike(post.id, currentUser.uid);
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

  const handleBookmark = async () => {
    if (!currentUser || bookmarking) return;
    setBookmarking(true);
    const wasBookmarked = bookmarked;
    setBookmarked(!wasBookmarked);
    setSaveCount(prev => wasBookmarked ? Math.max(0, prev - 1) : prev + 1);
    try {
      await toggleBookmark(post.id, currentUser.uid);
    } catch (err) {
      setBookmarked(wasBookmarked);
      setSaveCount(prev => wasBookmarked ? prev + 1 : Math.max(0, prev - 1));
    }
    setBookmarking(false);
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
    const postUrl = `${window.location.origin}/share/${shareKind}/${post.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: post.content?.slice(0, 50) || 'Check this out on VERGR', url: postUrl });
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

  const contentPost = isRepostType ? embeddedPost : post;

  return (
    <motion.article
      ref={cardRef}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
      className="w-full border-b border-white/[0.04] hover:bg-surface-1/30 transition-colors"
    >
      <div className="px-4 py-4">
        {/* Repost header */}
        {isRepostType && (
          <div className="flex items-center gap-2 mb-2 ml-12">
            <Icon name="repeat" size={14} className="text-brand-violet" />
            <button onClick={() => navigate(`/user/${post.authorId}`)} className="text-text-muted text-xs hover:text-text-secondary transition-colors">
              <span className="font-semibold">{post.author?.displayName || 'Someone'}</span> reposted
            </button>
          </div>
        )}

        <div className="flex items-start gap-3">
          <button onClick={() => navigate(`/user/${(contentPost || post).authorId}`)}>
            <UserAvatar src={(contentPost || post).author?.avatar} size={44} tier={(contentPost || post).author?.tier} isVerified={(contentPost || post).author?.isVerified} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <button onClick={() => navigate(`/user/${(contentPost || post).authorId}`)} className="font-semibold text-text-primary text-sm hover:underline truncate">{(contentPost || post).author?.displayName || 'User'}</button>
              {(contentPost || post).author?.isVerified && <span className="w-4 h-4 rounded-full bg-brand-cyan flex items-center justify-center shrink-0"><Icon name="check" size={10} className="text-bg-dark" /></span>}
              <TierBadge tier={(contentPost || post).author?.tier} size="xs" />
              <span className="text-text-muted text-sm truncate">@{(contentPost || post).author?.username}</span>
              <span className="text-text-muted text-xs shrink-0">· {timeAgo((contentPost || post).createdAt)}</span>
            </div>

            {!isRepostType && contentPost?.type !== 'article' && (
              <div className="mt-1.5">
                <p className="text-text-primary text-[15px] leading-relaxed whitespace-pre-wrap break-words cursor-pointer" onClick={goToPost}>
                  {displayContent}
                </p>
                {shouldTruncate && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                    className="text-brand-cyan text-xs font-semibold mt-1 hover:underline"
                  >
                    {expanded ? 'Show less' : 'Read more'}
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
                  <MediaContent post={contentPost} onImageClick={(urls, i) => setLightbox({ urls, index: i })} />
                )}
                {contentPost?.type === 'text' && (contentPost?.mediaUrl || contentPost?.mediaUrls?.length > 0) && (
                  <MediaContent post={contentPost} onImageClick={(urls, i) => setLightbox({ urls, index: i })} />
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
                  <p className="text-text-primary text-[15px] leading-relaxed mb-2 whitespace-pre-wrap cursor-pointer" onClick={() => navigate(`/post/${embeddedPost.id}`)}>{embeddedPost.content}</p>
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
                {contentPost.linkPreview.image && <img src={contentPost.linkPreview.image} alt="" className="w-20 h-16 object-cover rounded-lg shrink-0" />}
                <div className="flex-1 min-w-0">
                  <h4 className="text-white font-semibold text-sm truncate">{contentPost.linkPreview.title}</h4>
                  <p className="text-text-muted text-xs mt-0.5 line-clamp-1">{contentPost.linkPreview.description}</p>
                </div>
              </a>
            )}

            {((contentPost || post).hashtags?.length > 0) && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(contentPost || post).hashtags.map(tag => <span key={tag} className="text-brand-cyan text-xs hover:underline cursor-pointer">#{tag}</span>)}
              </div>
            )}

            {/* Engagement bar */}
            <div className="flex items-center justify-between mt-3 -ml-2">
              <button onClick={handleLike} disabled={liking}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full transition-all ${liked ? 'text-brand-ember' : 'text-text-muted hover:text-brand-ember'}`}>
                <motion.div
                  animate={liked ? { scale: [1, 1.3, 1] } : { scale: 1 }}
                  transition={{ type: 'spring', stiffness: 600, damping: 15 }}>
                  <Icon name={liked ? 'favorite' : 'favorite_border'} filled={liked} size={20} />
                </motion.div>
                <span className="text-xs font-dmmono">{likeCount}</span>
              </button>

              <button onClick={goToPost} className="flex items-center gap-1.5 px-2 py-1.5 rounded-full text-text-muted hover:text-brand-cyan transition-colors">
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
                  <button onClick={handleDelete} disabled={deleting} className="w-full px-4 py-3 text-left text-sm text-brand-ember hover:bg-brand-ember/10 transition-colors flex items-center gap-2.5">
                    <Icon name="delete" size={16} /> {deleting ? 'Deleting...' : 'Delete post'}
                  </button>
                ) : (
                  <>
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
      <TipPostModal
        isOpen={showTipModal}
        onClose={() => setShowTipModal(false)}
        post={post}
      />
    </motion.article>
  );
}