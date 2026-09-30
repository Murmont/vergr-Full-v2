import { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import { useParams, useNavigate, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { applyVanguardMask } from '../../utils/vanguard';
import VanguardBadge from '../../components/VanguardBadge';
import { FeedSkeleton } from '../../components/skeletons/GlassSkeletons';
import { getUser, getComments, addComment as addCommentToFirestore, getPostByIdOrSlug, toggleCommentLike, getLikedCommentIds, reportComment, COMMENT_BLOCKED } from '../../firebase/firestore';
import ReportSheet from '../../components/ReportSheet';
import { useUI } from '../../context/UIContext';
import { captureInterest } from '../../utils/feedRank';
import { uploadMediaFile } from '../../utils/mediaHelpers';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import PostCard from '../../components/PostCard';
import UserAvatar from '../../components/UserAvatar';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import InlineVideoPlayer from '../../components/media/InlineVideoPlayer';
import MediaPanel from '../../components/MediaPanel';
import EmojiPicker from '../../components/EmojiPicker';
import VergrAd from '../../components/VergrAd';
import { ADS_CONFIG } from '../../config/ads';
import { timeAgo, isShortFormat } from '../../utils/helpers';
import UserName from '../../components/UserName';
import RankBadge from '../../components/RankBadge';
import { AppealSheet, HiddenPostNotice } from '../../components/moderation/Appeal';

export default function PostDetailScreen() {
  const { postId } = useParams();
  const location = useLocation();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const { profile } = useUser();
  const navigate = useNavigate();
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const { setRightPanel } = useLayout();
  const { isMobile } = useResponsive();

  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [attachment, setAttachment] = useState(null); // { type, url, thumbnailUrl? }
  const [showMediaPanel, setShowMediaPanel] = useState(null); // 'gifs' | 'stickers' | 'clips' | null
  const [showEmoji, setShowEmoji] = useState(false);
  const [uploading, setUploading] = useState(false);
  // B5: 1-level replies + comment likes.
  const [replyingTo, setReplyingTo] = useState(null); // { id, name }
  const [reportingComment, setReportingComment] = useState(null); // comment being reported
  const [expandedReplies, setExpandedReplies] = useState(() => new Set()); // parentIds shown
  const [likedComments, setLikedComments] = useState(() => new Set());
  const [likeBusy, setLikeBusy] = useState(() => new Set());
  const [appealOpen, setAppealOpen] = useState(false);
  const inputRef = useRef(null);

  // Group the flat comment list into top-level + nested replies (1 level).
  // Legacy comments (no parentId) are all top-level, so nothing is dropped.
  const threaded = useMemo(() => {
    const tops = [];
    const repliesByParent = new Map();
    for (const c of comments) {
      if (c.parentId) {
        if (!repliesByParent.has(c.parentId)) repliesByParent.set(c.parentId, []);
        repliesByParent.get(c.parentId).push(c);
      } else {
        tops.push(c);
      }
    }
    const ms = (c) => (c.createdAt?.toMillis ? c.createdAt.toMillis() : new Date(c.createdAt || 0).getTime());
    for (const arr of repliesByParent.values()) arr.sort((a, b) => ms(a) - ms(b)); // replies oldest-first
    return tops.map(c => ({ ...c, replies: repliesByParent.get(c.id) || [] }));
  }, [comments]);

  const totalCount = comments.length;

  useEffect(() => {
    setRightPanel(null);
    return () => setRightPanel(null);
  }, [setRightPanel]);

  useEffect(() => {
    if (!postId) return;
    const load = async () => {
      setLoading(true);
      try {
        const postData = await getPostByIdOrSlug(postId);
        // A clip is not a post page: it redirects into the clip player (the early
        // return below), with comments in a sheet. Skip the author and comment reads.
        if (postData && isShortFormat(postData.type)) { setPost(postData); setLoading(false); return; }
        if (postData) {
          postData.author = await getUser(postData.authorId);
          setPost(postData);
        }
        // Comments live under the resolved doc id (postId may be a slug).
        const resolvedId = postData?.id || postId;
        const cmts = await getComments(resolvedId, 50);
        setComments(cmts);
        if (currentUser?.uid && cmts.length) {
          getLikedCommentIds(resolvedId, currentUser.uid, cmts)
            .then(setLikedComments).catch(() => {});
        }
      } catch (err) {
        console.error('Failed to load post:', err);
      }
      setLoading(false);
    };
    load();
  }, [postId]);

  const handleAddComment = async () => {
    if ((!input.trim() && !attachment) || posting || !currentUser) return;
    setPosting(true);
    const parentId = replyingTo?.id || null;
    const targetId = post?.id || postId;
    try {
      await addCommentToFirestore(targetId, currentUser.uid, input.trim(), attachment, parentId);
      if (post) captureInterest(post, 1); // commenting = an interest signal
      const cmts = await getComments(targetId, 50);
      setComments(cmts);
      if (parentId) setExpandedReplies(prev => new Set(prev).add(parentId)); // auto-expand the thread we replied to
      setInput('');
      setAttachment(null);
      setReplyingTo(null);
      setShowMediaPanel(null);
      setShowEmoji(false);
      if (!parentId) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 200);
    } catch (err) {
      // A comment refused by the owner's privacy setting has to SAY so. This
      // used to console.error and leave the user staring at their own text
      // wondering whether it sent (audit A18).
      if (err?.code === COMMENT_BLOCKED) showToast(err.message, 'info');
      else showToast('Could not post your comment. Please try again.', 'error');
      console.error('Failed to add comment:', err);
    }
    setPosting(false);
  };

  const startReply = (comment, rootId = null) => {
    const name = comment.author?.displayName || comment.author?.username || 'User';
    // Depth stays 1: a reply-to-a-reply attaches to the top-level root, not the reply.
    setReplyingTo({ id: rootId || comment.id, name });
    setShowMediaPanel(null);
    setShowEmoji(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleToggleCommentLike = async (comment) => {
    if (!currentUser?.uid || likeBusy.has(comment.id)) return;
    const id = comment.id;
    const wasLiked = likedComments.has(id);
    // Optimistic: flip the heart + count immediately.
    setLikedComments(prev => { const n = new Set(prev); wasLiked ? n.delete(id) : n.add(id); return n; });
    setComments(prev => prev.map(c => c.id === id ? { ...c, likeCount: Math.max(0, (c.likeCount || 0) + (wasLiked ? -1 : 1)) } : c));
    setLikeBusy(prev => new Set(prev).add(id));
    try {
      await toggleCommentLike(post?.id || postId, id, currentUser.uid);
    } catch (err) {
      // Roll back on failure.
      setLikedComments(prev => { const n = new Set(prev); wasLiked ? n.add(id) : n.delete(id); return n; });
      setComments(prev => prev.map(c => c.id === id ? { ...c, likeCount: Math.max(0, (c.likeCount || 0) + (wasLiked ? 1 : -1)) } : c));
    } finally {
      setLikeBusy(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleMediaSelect = (tab, url, item) => {
    // tab: 'gifs' | 'stickers' | 'clips'
    const type = tab === 'clips' ? 'clip' : tab === 'stickers' ? 'sticker' : 'gif';
    setAttachment({ type, url, thumbnailUrl: item?.preview || null });
    setShowMediaPanel(null);
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    try {
      const { url } = await uploadMediaFile(file, 'comment_media');
      const isVideo = file.type.startsWith('video/');
      setAttachment({ type: isVideo ? 'video' : 'image', url });
    } catch (err) {
      console.error('Upload failed:', err);
    }
    setUploading(false);
  };

  const closeAllPickers = () => {
    setShowMediaPanel(null);
    setShowEmoji(false);
  };

  const renderCommentMedia = (comment) => {
    if (!comment.mediaUrl) return null;
    const t = comment.mediaType;
    if (t === 'video' || t === 'clip') {
      return (
        <div className="mt-2 rounded-xl overflow-hidden border border-white/[0.06] max-w-[260px]">
          <InlineVideoPlayer src={comment.mediaUrl} maxHeightClass="max-h-[260px]" objectFit="contain" />
        </div>
      );
    }
    if (t === 'sticker') {
      return <img src={comment.mediaUrl} alt="" className="mt-2 w-28 h-28 object-contain" />;
    }
    return (
      <div className="mt-2 rounded-xl overflow-hidden border border-white/[0.06] max-w-[260px]">
        <img src={comment.mediaUrl} alt="" className="w-full h-auto max-h-[260px] object-cover" loading="lazy" />
      </div>
    );
  };

  // One comment row — shared by top-level comments and their replies (rootId is
  // the top-level parent so a reply-to-a-reply still threads at depth 1).
  const renderCommentRow = (comment, { isReply = false, rootId = null } = {}) => {
    const realAuthor = comment.author;
    const author = applyVanguardMask(realAuthor, profile);
    const isMasked = !!author?.isVanguardPersona;
    const vRank = realAuthor?.vanguard?.rank;
    const liked = likedComments.has(comment.id);
    return (
      <div className="flex gap-3">
        <button onClick={() => navigate(`/user/${realAuthor?.id || comment.authorId}`)} className="shrink-0">
          <UserAvatar src={author?.avatar} size={isReply ? 28 : 32} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-semibold text-sm"><UserName user={author} masked fallback={'User'} /></span>
            <RankBadge level={author?.vpLevel} role={author?.role} size={13} style={{ verticalAlign: '-2px' }} />
            {!isMasked && realAuthor?.isVerified && (
              <span className="w-3.5 h-3.5 rounded-full bg-brand-violet flex items-center justify-center">
                <Icon name="check" size={9} className="text-bg-dark" />
              </span>
            )}
            {vRank && <VanguardBadge rank={vRank} size={12} />}
            <span className="text-text-muted text-xs font-dmmono">{timeAgo(comment.createdAt?.toDate ? comment.createdAt.toDate() : comment.createdAt)}</span>
          </div>
          {comment.content && <p className="text-text-secondary text-sm break-words">{comment.content}</p>}
          {renderCommentMedia(comment)}
          <div className="flex items-center gap-4 mt-1.5">
            <button
              onClick={() => handleToggleCommentLike(comment)}
              className={`flex items-center gap-1 transition-colors ${liked ? 'text-brand-ember' : 'text-text-muted hover:text-brand-ember'}`}
            >
              <Icon name={liked ? 'favorite' : 'favorite_border'} size={14} filled={liked} />
              <span className="text-xs">{comment.likeCount || 0}</span>
            </button>
            <button
              onClick={() => startReply(comment, rootId)}
              className="text-text-muted text-xs hover:text-text-secondary transition-colors"
            >
              Reply
            </button>
            {currentUser && comment.authorId !== currentUser.uid && (
              <button
                onClick={() => setReportingComment(comment)}
                className="text-text-muted/60 text-xs hover:text-brand-ember transition-colors"
                title="Report comment"
              >
                Report
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="min-h-screen">
      <TopBar title="Post" showBack />
      <FeedSkeleton count={1} />
    </div>
  );

  // A clip opens in the clip player, never as a post page. Every /post link to a
  // clip (notifications, search, profile, old shares) lands here and is sent on,
  // keeping ?comments=1 so a comment link opens the comment sheet.
  if (post && isShortFormat(post.type)) {
    return <Navigate to={`/clip/${post.id}${location.search || ''}`} replace />;
  }

  if (!post) return (
    <div className="min-h-screen">
      <TopBar title="Post" showBack />
      <div className="flex flex-col items-center py-20">
        <Icon name="error_outline" size={48} className="text-text-muted/30 mb-3" />
        <p className="text-text-muted text-sm">Post not found</p>
      </div>
    </div>
  );

  // A hidden post (moderation) is for its author only. It used to stay readable
  // by anyone holding the link, so hiding it hid it from the feed and nowhere
  // else. The author sees it with the reason and a way to appeal.
  const hidden = post.status === 'hidden' || post.hidden === true;
  const isAuthor = !!currentUser && (post.userId === currentUser.uid || post.authorId === currentUser.uid);
  if (hidden && !isAuthor && profile?.staff !== true) return (
    <div className="min-h-screen">
      <TopBar title="Post" showBack />
      <div className="flex flex-col items-center py-20">
        <Icon name="visibility_off" size={48} className="text-text-muted/30 mb-3" />
        <p className="text-text-muted text-sm">This post is not available</p>
      </div>
    </div>
  );

  return (
    <div
      className={`flex flex-col overflow-hidden ${isMobile ? 'fixed inset-0 z-30 bg-bg-dark' : 'h-screen'}`}
      style={isMobile ? { paddingTop: 'env(safe-area-inset-top, 0px)' } : undefined}
    >
      <TopBar title="Post" showBack />

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {hidden && isAuthor && (
          <HiddenPostNotice post={post} onAppeal={() => setAppealOpen(true)} />
        )}
        {appealOpen && (
          <AppealSheet targetType="post" targetId={post.id} onClose={() => setAppealOpen(false)} />
        )}
        <PostCard post={post} onDeleted={() => navigate(-1)} />

        <div className="px-4 py-3 border-t border-white/[0.03]">
          <h3 className="font-syne font-bold text-sm mb-4">
            Comments {totalCount > 0 && `(${totalCount})`}
          </h3>

          {threaded.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-text-muted text-sm">No comments yet. Be the first!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {threaded.map((comment, ci) => {
                const showAd = (ci + 1) % ADS_CONFIG.commentAdInterval === 0 && ci < threaded.length - 1;
                const replies = comment.replies || [];
                const open = expandedReplies.has(comment.id);
                return (
                <Fragment key={comment.id}>
                {renderCommentRow(comment)}
                {replies.length > 0 && (
                  <div className="ml-11 space-y-3">
                    <button
                      onClick={() => setExpandedReplies(prev => { const n = new Set(prev); n.has(comment.id) ? n.delete(comment.id) : n.add(comment.id); return n; })}
                      className="flex items-center gap-1.5 text-text-muted text-xs font-semibold hover:text-text-secondary transition-colors"
                    >
                      <span className="w-6 h-px bg-white/[0.12]" />
                      {open ? 'Hide replies' : `View ${replies.length} ${replies.length > 1 ? 'replies' : 'reply'}`}
                    </button>
                    {open && replies.map(r => (
                      <Fragment key={r.id}>{renderCommentRow(r, { isReply: true, rootId: comment.id })}</Fragment>
                    ))}
                  </div>
                )}
                {showAd && <VergrAd zone="inpage" />}
                </Fragment>
                );
              })}
            </div>
          )}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* Media panel (GIFs/Stickers/Clips) */}
      {showMediaPanel && (
        <MediaPanel
          defaultTab={showMediaPanel}
          onSelect={handleMediaSelect}
          onClose={() => setShowMediaPanel(null)}
        />
      )}

      {/* Emoji picker */}
      {showEmoji && <EmojiPicker onSelect={(emoji) => setInput(prev => prev + emoji)} onClose={() => setShowEmoji(false)} />}

      {/* Input bar — pinned at the bottom of the fixed column (only the
          post→comments area above scrolls), above the home indicator. */}
      <div className="shrink-0 glass-header border-t border-white/[0.04] px-2 pt-2 overflow-x-hidden" style={{ paddingBottom: 'calc(8px + var(--vg-safe-b, 0px))' }}>
        {/* Replying-to bar (B5) */}
        {replyingTo && (
          <div className="flex items-center justify-between gap-2 mb-2 px-3 py-1.5 rounded-lg bg-surface-2 border border-white/[0.06]">
            <span className="text-xs text-text-muted truncate">Replying to <span className="text-text-secondary font-semibold">{replyingTo.name}</span></span>
            <button onClick={() => setReplyingTo(null)} className="w-5 h-5 rounded-full bg-black/40 flex items-center justify-center shrink-0">
              <Icon name="close" size={12} className="text-white" />
            </button>
          </div>
        )}
        {/* Attachment preview */}
        {attachment && (
          <div className="flex items-center gap-2 mb-2 px-2">
            <div className="relative rounded-lg overflow-hidden border border-white/[0.08] max-w-[100px]">
              {attachment.type === 'video' || attachment.type === 'clip' ? (
                <video src={attachment.url} muted className="w-20 h-20 object-cover bg-black" />
              ) : (
                <img src={attachment.thumbnailUrl || attachment.url} alt="" className="w-20 h-20 object-cover" />
              )}
              <button
                onClick={() => setAttachment(null)}
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center"
              >
                <Icon name="close" size={12} className="text-white" />
              </button>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={handleFileSelect}
        />

        <div className="flex items-center gap-1.5">
          <UserAvatar src={profile?.avatar} size={32} />

          <div className="flex-1 min-w-0 flex items-center bg-surface-2 border border-white/[0.06] rounded-full focus-within:border-brand-violet/40 transition-colors">
            <button
              onClick={() => { const on = !showEmoji; closeAllPickers(); if (on) setShowEmoji(true); }}
              className="w-9 h-9 shrink-0 flex items-center justify-center"
            >
              <Icon name={showEmoji ? 'keyboard' : 'sentiment_satisfied'} size={19} className={showEmoji ? 'text-brand-violet-light' : 'text-text-muted'} />
            </button>
            <input
              ref={inputRef}
              type="text"
              placeholder={replyingTo ? `Reply to ${replyingTo.name}...` : 'Add a comment...'}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddComment()}
              className="flex-1 bg-transparent py-2 pr-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none min-w-0"
            />
            <div className="flex items-center shrink-0 pr-1">
              {/* One button for GIFs / stickers / clips (tabbed in the panel) */}
              <button
                onClick={() => { const on = !showMediaPanel; closeAllPickers(); if (on) setShowMediaPanel('gifs'); }}
                className="w-9 h-9 flex items-center justify-center"
                aria-label="GIFs, stickers and clips"
              >
                <Icon name="gif_box" size={20} className={showMediaPanel ? 'text-brand-violet-light' : 'text-text-muted'} />
              </button>
              {/* One button for device media */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-9 h-9 flex items-center justify-center"
                aria-label="Add photo or video"
              >
                <Icon name={uploading ? 'hourglass_empty' : 'image'} size={20} className="text-text-muted" />
              </button>
            </div>
          </div>

          <button
            onClick={handleAddComment}
            disabled={(!input.trim() && !attachment) || posting}
            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all ${
              (input.trim() || attachment) && !posting ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-muted'
            }`}
          >
            <Icon name={posting ? 'hourglass_empty' : 'send'} size={18} />
          </button>
        </div>
      </div>

      <ReportSheet open={!!reportingComment} title="Report Comment" onClose={() => setReportingComment(null)}
        onSubmit={(reason) => {
          const c = reportingComment;
          setReportingComment(null);
          if (!c || !currentUser) return;
          reportComment(currentUser.uid, post?.id || postId, c.id, reason)
            .then(() => showToast?.('Report submitted — our moderators will review it', 'success'))
            .catch(() => showToast?.('Could not submit report', 'error'));
        }} />
    </div>
  );
}
