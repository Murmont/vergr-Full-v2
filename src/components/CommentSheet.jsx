// CommentSheet — comments INSIDE an immersive viewer, never a navigation.
//
// Founder, 2026-09-12: tapping comments must not leave the clip ("that is not
// how any of the other platforms do it"). Founder, 2026-09-14, on the first
// version: "There is no way to add an emoji to text, the whole comment sheet
// design looks cheap and isnt even 10% as good as tiktok".
//
// Built to TikTok's comment sheet, which Instagram Reels and YouTube Shorts
// mirror closely:
//   - a tall sheet over the clip, which keeps playing and is NOT dimmed
//   - a centred "N comments" title and a close button
//   - rows: avatar with no ring, the name in grey with a Creator label on the
//     creator's own comments, the comment in white, time and Reply under it, and
//     the heart with its count on the right
//   - replies folded under "View N replies"
//   - press and hold a comment for Reply / Copy / Report (or Delete your own)
//   - the comment bar: a row of quick emoji, and @, photo and emoji buttons in
//     the field; the send button appears once there is something to send
//
// ⚠ AN @MENTION COSTS NO READ (founder: "a mention shouldn't cost a read ... all
// it does is highlight the user mentioned and notifies them"). Suggestions come
// from people this device already knows: the clip's creator, everyone in the
// thread, and the people in the local identity cache. A picked name is stored as
// @[username](uid), the post format PostRichText already highlights, and its uid
// rides the comment write as `mentionedUids`, so onNewComment writes the "you
// were mentioned" notice without looking anybody up. A name typed without
// picking it stays plain text, which is how TikTok and Instagram behave too.
//
// Photos go through the same compress-then-R2 path as chat media, under the
// `comment/` prefix.
//
// ONE component for /shorts and /clip/:id, on the phone (a sheet) and the
// desktop (a panel beside the video).
import { blockUnverified } from '../utils/emailGate';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useUser } from '../context/UserContext';
import { useUI } from '../context/UIContext';
import { applyVanguardMask } from '../utils/vanguard';
import {
  getComments, addComment, toggleCommentLike, getLikedCommentIds, deleteComment, reportComment, COMMENT_BLOCKED,
} from '../firebase/firestore';
import { captureInterest } from '../utils/feedRank';
import { timeAgo, compactCount } from '../utils/helpers';
import { getFollowingSet } from '../utils/followingCache';
import { peekChatUser, peekChatUsers } from '../utils/chatIdentity';
import { uploadMediaFile } from '../utils/mediaHelpers';
import { resolveTier } from '../utils/tierSystem';
import UserAvatar from './UserAvatar';
import UserName from './UserName';
import RankBadge from './RankBadge';
import VanguardBadge from './VanguardBadge';
import PostRichText, { stripPostFormatting } from './PostRichText';
import EmojiPicker from './EmojiPicker';
import Icon from './Icon';
import VergrAd from './VergrAd';
import { ADS_CONFIG } from '../config/ads';

const ms = (t) => (t?.toMillis ? t.toMillis() : new Date(t || 0).getTime());

// Solid values only. No hairlines, no see-through fills except marked scrims.
const C = {
  sheet: '#14141F',
  field: '#1E1E2C',
  menu: '#1A1A26',
  violet: '#7B1FFF',
  muted: '#9CA3AF',
  faint: '#6B7280',
  creator: '#2B1D47',
  creatorText: '#D4B8FF',
  skeleton: '#1E1E2C',
};
const QUICK_EMOJI = ['😂', '😍', '🔥', '👏', '😮', '😢', '💯', '🙌'];
const MAX_LEN = 2000;
const HOLD_MS = 450;
// "@" followed by the start of a handle, right before the caret.
const MENTION_RE = /(^|\s)@([\w.]{0,30})$/;

// Picked "@username" words become @[username](uid) tokens. Longest names first,
// so "@sam" never eats the start of "@samuel".
function encodeMentions(text, picks) {
  const uids = [];
  let out = text;
  const names = Object.keys(picks).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^\\w@\\[])@${esc}(?![\\w.])`, 'g');
    let hit = false;
    out = out.replace(re, (_m, pre) => { hit = true; return `${pre}@[${name}](${picks[name]})`; });
    if (hit) uids.push(picks[name]);
  }
  return { content: out, uids: [...new Set(uids)] };
}

const plainText = (s) => stripPostFormatting(String(s || '').replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1'));

function FieldButton({ icon, label, onClick, active = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="shrink-0 w-9 h-9 grid place-items-center rounded-full active:scale-90 transition-transform"
      style={{ color: active ? '#FFFFFF' : C.muted }}
    >
      <Icon name={icon} size={22} />
    </button>
  );
}

function ActionRow({ icon, label, danger = false, onClick }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-4 px-5 py-3.5 text-left active:bg-[#232333]">
      <Icon name={icon} size={22} className={danger ? 'text-brand-ember' : 'text-white'} />
      <span className={`text-[15px] font-semibold ${danger ? 'text-brand-ember' : 'text-white'}`}>{label}</span>
    </button>
  );
}

// variant 'sheet' (default): a bottom sheet over the playing video (phone).
// variant 'panel': a full-height column BESIDE the video on desktop, the way
// YouTube Shorts and TikTok web open comments. No scrim: the video stays in view.
export default function CommentSheet({ open, post, onClose, onCommentAdded, onCommentRemoved, variant = 'sheet' }) {
  const panel = variant === 'panel';
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();

  const postId = post?.id || null;
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [posting, setPosting] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null); // { id, name }
  const [liked, setLiked] = useState(() => new Set());
  const [likeBusy, setLikeBusy] = useState(() => new Set());
  const [expanded, setExpanded] = useState(() => new Set());
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mention, setMention] = useState(null); // { start, end, query }
  const [attach, setAttach] = useState(null); // { file, preview }
  const [actionFor, setActionFor] = useState(null);
  const picksRef = useRef({});
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const holdRef = useRef(0);

  // Same 1-level threading the post screen uses, so a reply written here reads
  // the same way over there.
  const threaded = useMemo(() => {
    const tops = [];
    const byParent = new Map();
    for (const c of comments) {
      if (c.parentId) {
        if (!byParent.has(c.parentId)) byParent.set(c.parentId, []);
        byParent.get(c.parentId).push(c);
      } else tops.push(c);
    }
    for (const arr of byParent.values()) arr.sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
    return tops.map((c) => ({ ...c, replies: byParent.get(c.id) || [] }));
  }, [comments]);

  useEffect(() => {
    if (!open || !postId) return undefined;
    let alive = true;
    setLoading(true);
    setReplyingTo(null);
    setExpanded(new Set());
    setEmojiOpen(false);
    setActionFor(null);
    getComments(postId, 50)
      .then((list) => {
        if (!alive) return;
        setComments(list);
        if (currentUser?.uid && list.length) {
          getLikedCommentIds(postId, currentUser.uid, list)
            .then((s) => { if (alive) setLiked(s); })
            .catch(() => {});
        }
      })
      .catch(() => { if (alive) setComments([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, postId, currentUser?.uid]);

  // A chosen photo's preview URL is released when it is replaced or sent.
  useEffect(() => () => { if (attach?.preview) URL.revokeObjectURL(attach.preview); }, [attach]);

  // The field grows with the text, up to about four lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 100)}px`;
  }, [input, open]);

  // Escape closes the innermost thing first, like every other overlay here.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (actionFor) setActionFor(null);
      else if (emojiOpen) setEmojiOpen(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, actionFor, emojiOpen]);

  // ── mentions ──────────────────────────────────────────────────────
  const people = useMemo(() => {
    if (!open) return [];
    const byUid = new Map();
    const add = (u, uid) => {
      const id = uid || u?.uid || u?.id;
      // A masked Vanguard persona is never offered: naming them would unmask them.
      if (!id || id === currentUser?.uid || !u?.username || u?.vanguard?.rank) return;
      if (!byUid.has(id)) {
        byUid.set(id, { uid: id, username: u.username, displayName: u.displayName || u.username, avatar: u.avatar || u.photoURL || null });
      }
    };
    if (post?.author) add(post.author, post.authorId);
    for (const c of comments) add(c.author, c.authorId);
    for (const id of getFollowingSet()) add(peekChatUser(id), id);
    for (const u of peekChatUsers()) add(u, u.uid);
    return [...byUid.values()];
  }, [open, post, comments, currentUser?.uid]);

  const suggestions = useMemo(() => {
    if (!mention) return [];
    const q = mention.query;
    return people
      .filter((p) => !q || p.username.toLowerCase().startsWith(q) || String(p.displayName).toLowerCase().startsWith(q))
      .slice(0, 8);
  }, [mention, people]);

  const updateMention = (value, caret) => {
    const m = MENTION_RE.exec(value.slice(0, caret));
    setMention(m ? { start: caret - m[2].length - 1, end: caret, query: m[2].toLowerCase() } : null);
  };

  const insertAtCaret = (text, focus = true) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? input.length;
    const next = (input.slice(0, start) + text + input.slice(end)).slice(0, MAX_LEN);
    const caret = Math.min(next.length, start + text.length);
    setInput(next);
    requestAnimationFrame(() => {
      if (!el) return;
      if (focus) el.focus();
      try { el.setSelectionRange(caret, caret); } catch { /* not focusable yet */ }
      updateMention(next, caret);
    });
  };

  const startMention = () => {
    const el = inputRef.current;
    const at = el?.selectionStart ?? input.length;
    const needsSpace = at > 0 && !/\s/.test(input[at - 1]);
    setEmojiOpen(false);
    insertAtCaret(needsSpace ? ' @' : '@');
  };

  const pickMention = (p) => {
    if (!mention) return;
    const next = `${input.slice(0, mention.start)}@${p.username} ${input.slice(mention.end)}`.slice(0, MAX_LEN);
    picksRef.current[p.username] = p.uid;
    const caret = Math.min(next.length, mention.start + p.username.length + 2);
    setInput(next);
    setMention(null);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      try { el.setSelectionRange(caret, caret); } catch { /* ignore */ }
    });
  };

  // ── sending ───────────────────────────────────────────────────────
  const canSend = (!!input.trim() || !!attach) && !posting && !!currentUser;

  const submit = useCallback(async () => {
    const raw = input.trim();
    if ((!raw && !attach) || posting || !postId) return;
    if (!currentUser) { showToast?.('Sign in to comment.', 'info'); return; }
    if (blockUnverified('comment')) return;
    setPosting(true);
    try {
      let media = null;
      if (attach) {
        const url = await uploadMediaFile(attach.file, 'comment_media', resolveTier(profile), 7, 'chat');
        media = { type: 'image', url };
      }
      const { content, uids } = encodeMentions(raw, picksRef.current);
      await addComment(postId, currentUser.uid, content, media, replyingTo?.id || null, uids);
      if (post) captureInterest(post, 1);
      if (replyingTo?.id) setExpanded((s) => new Set(s).add(replyingTo.id));
      const list = await getComments(postId, 50);
      setComments(list);
      // +1, not list.length: the list is capped at 50 and onNewComment counts
      // every comment, so reporting the page size shrank a busy clip's count.
      onCommentAdded?.();
      setInput('');
      setReplyingTo(null);
      setAttach(null);
      setEmojiOpen(false);
      setMention(null);
      picksRef.current = {};
    } catch (err) {
      if (err?.code === COMMENT_BLOCKED) showToast?.(err.message, 'info');
      else showToast?.('Could not post your comment. Please try again.', 'error');
    }
    setPosting(false);
  }, [input, attach, posting, postId, currentUser, profile, replyingTo, post, onCommentAdded, showToast]);

  const onPickFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type?.startsWith('image/')) { showToast?.('Choose a photo.', 'error'); return; }
    setAttach({ file, preview: URL.createObjectURL(file) });
  };

  const likeComment = useCallback(async (c) => {
    if (!currentUser?.uid) { showToast?.('Sign in to like comments.', 'info'); return; }
    if (likeBusy.has(c.id) || !postId) return;
    const was = liked.has(c.id);
    setLiked((p) => { const n = new Set(p); was ? n.delete(c.id) : n.add(c.id); return n; });
    setComments((p) => p.map((x) => x.id === c.id
      ? { ...x, likeCount: Math.max(0, (x.likeCount || 0) + (was ? -1 : 1)) } : x));
    setLikeBusy((p) => new Set(p).add(c.id));
    try {
      await toggleCommentLike(postId, c.id, currentUser.uid);
    } catch {
      setLiked((p) => { const n = new Set(p); was ? n.add(c.id) : n.delete(c.id); return n; });
      setComments((p) => p.map((x) => x.id === c.id
        ? { ...x, likeCount: Math.max(0, (x.likeCount || 0) + (was ? 1 : -1)) } : x));
    } finally {
      setLikeBusy((p) => { const n = new Set(p); n.delete(c.id); return n; });
    }
  }, [currentUser, liked, likeBusy, postId, showToast]);

  // Replying to a reply keeps the thread one level deep (the root) and starts
  // the text with the person you are answering, picked, so they are notified.
  const startReply = (c, rootId = null) => {
    const author = applyVanguardMask(c.author, profile);
    const name = author?.displayName || author?.username || 'User';
    setReplyingTo({ id: rootId || c.id, name });
    if (rootId && c.author?.username && c.authorId !== currentUser?.uid && !author?.isVanguardPersona) {
      picksRef.current[c.author.username] = c.authorId;
      setInput((v) => (v.startsWith(`@${c.author.username} `) ? v : `@${c.author.username} ${v}`));
    }
    setEmojiOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const removeComment = async (c) => {
    setActionFor(null);
    try {
      await deleteComment(postId, c.id);
      setComments((p) => p.filter((x) => x.id !== c.id && x.parentId !== c.id));
      onCommentRemoved?.();
      showToast?.('Comment deleted', 'success');
    } catch {
      showToast?.('Could not delete the comment.', 'error');
    }
  };

  const reportIt = async (c) => {
    setActionFor(null);
    if (!currentUser) { showToast?.('Sign in to report a comment.', 'info'); return; }
    try {
      await reportComment(currentUser.uid, postId, c.id, 'Reported from comments');
      showToast?.('Thanks. Our moderators will review this comment.', 'success');
    } catch {
      showToast?.('Could not send the report. Please try again.', 'error');
    }
  };

  const copyText = async (c) => {
    setActionFor(null);
    try { await navigator.clipboard.writeText(plainText(c.content)); showToast?.('Copied', 'success'); }
    catch { showToast?.('Could not copy.', 'error'); }
  };

  if (!open || !post) return null;

  const hold = (c) => ({
    onPointerDown: () => { clearTimeout(holdRef.current); holdRef.current = setTimeout(() => setActionFor(c), HOLD_MS); },
    onPointerUp: () => clearTimeout(holdRef.current),
    onPointerLeave: () => clearTimeout(holdRef.current),
    onPointerCancel: () => clearTimeout(holdRef.current),
    onContextMenu: (e) => { e.preventDefault(); clearTimeout(holdRef.current); setActionFor(c); },
  });

  const row = (c, isReply = false, rootId = null) => {
    const real = c.author;
    const author = applyVanguardMask(real, profile);
    const isLiked = liked.has(c.id);
    const isCreator = !!post.authorId && c.authorId === post.authorId && !author?.isVanguardPersona;
    return (
      <div key={c.id} className={`flex gap-3 select-none ${isReply ? 'mt-4' : ''}`} style={{ WebkitTouchCallout: 'none' }} {...hold(c)}>
        <button
          type="button"
          onClick={() => { onClose?.(); navigate(`/user/${real?.id || c.authorId}`); }}
          className="shrink-0"
          aria-label="Open profile"
        >
          <UserAvatar src={author?.avatar} size={isReply ? 28 : 36} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[13px] font-semibold truncate" style={{ color: C.muted }}>
              <UserName user={author} masked fallback="User" />
            </span>
            <RankBadge level={author?.vpLevel} role={author?.role} size={12} style={{ verticalAlign: '-2px' }} />
            {real?.vanguard?.rank && <VanguardBadge rank={real.vanguard.rank} size={11} />}
            {isCreator && (
              <span className="shrink-0 px-1.5 rounded text-[10px] font-bold leading-[16px]" style={{ background: C.creator, color: C.creatorText }}>
                Creator
              </span>
            )}
          </div>
          {c.content && (
            <div className="mt-0.5 text-[15px] leading-[20px] text-white break-words">
              <PostRichText text={c.content} />
            </div>
          )}
          {c.mediaUrl && c.mediaType !== 'video' && c.mediaType !== 'clip' && (
            <img
              src={c.mediaUrl}
              alt=""
              loading="lazy"
              className="mt-2 rounded-xl max-w-[180px] max-h-[240px] object-cover"
              style={{ background: C.field }}
            />
          )}
          <div className="flex items-center gap-4 mt-1.5 text-[12px]" style={{ color: C.faint }}>
            <span>{timeAgo(c.createdAt?.toDate ? c.createdAt.toDate() : c.createdAt)}</span>
            <button type="button" onClick={() => startReply(c, rootId)} className="font-semibold" style={{ color: C.muted }}>
              Reply
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => likeComment(c)}
          className="shrink-0 w-10 flex flex-col items-center pt-1 active:scale-90 transition-transform"
          aria-label={isLiked ? 'Unlike comment' : 'Like comment'}
          aria-pressed={isLiked}
        >
          <Icon name="favorite" size={18} filled={isLiked} className={isLiked ? 'text-brand-ember' : ''} style={isLiked ? undefined : { color: C.faint }} />
          <span className="text-[12px] mt-0.5 tabular-nums min-h-[16px]" style={{ color: C.faint }}>
            {c.likeCount ? compactCount(c.likeCount) : ''}
          </span>
        </button>
      </div>
    );
  };

  const count = Math.max(post.commentCount || 0, threaded.length);
  const actionOwn = !!actionFor && actionFor.authorId === currentUser?.uid;
  const showSuggestions = !!mention && suggestions.length > 0;

  return (
    // z-[130] clears ShortsBackFab (z-[120]); the video keeps playing behind it.
    <div
      data-vg-noswipe=""
      className={`absolute inset-0 z-[130] flex flex-col ${panel ? '' : 'justify-end'}`}
      role="dialog"
      aria-modal={panel ? 'false' : 'true'}
      aria-label="Comments"
    >
      {/* Tap the clip above to close. Deliberately NOT dimmed: TikTok keeps the
          video bright behind its comments. */}
      {!panel && (
        <button type="button" data-scrim="" className="absolute inset-0" onClick={onClose} aria-label="Close comments" />
      )}
      <div
        className={`relative w-full flex flex-col overflow-hidden ${panel ? 'h-full rounded-2xl' : 'h-[72%] rounded-t-[18px] shadow-[0_-8px_32px_rgba(0,0,0,0.55)]'}`}
        style={{ background: C.sheet }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative shrink-0 flex items-center justify-center px-12" style={{ height: panel ? 56 : 50 }}>
          {!panel && <span aria-hidden className="absolute left-1/2 -translate-x-1/2 top-[6px] w-9 h-1 rounded-full" style={{ background: '#2E2E40' }} />}
          <h3 className="text-[15px] font-bold text-white tabular-nums">
            {compactCount(count)} {count === 1 ? 'comment' : 'comments'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comments"
            className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 grid place-items-center text-white"
          >
            <Icon name="close" size={22} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3" style={{ overscrollBehavior: 'contain' }}>
          {loading ? (
            <div className="space-y-5 pt-2" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3">
                  <span className="w-9 h-9 rounded-full shrink-0" style={{ background: C.skeleton }} />
                  <div className="flex-1 space-y-2 pt-1">
                    <span className="block h-3 w-24 rounded" style={{ background: C.skeleton }} />
                    <span className="block h-3.5 rounded" style={{ background: C.skeleton, width: `${80 - i * 12}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : threaded.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10">
              <p className="text-white text-[16px] font-bold">Be the first to comment</p>
              <p className="text-[13px] mt-1" style={{ color: C.muted }}>Say something, or tap an emoji below.</p>
            </div>
          ) : (
            <div className="space-y-5 pt-1">
              {threaded.map((c, ci) => {
                const open = expanded.has(c.id);
                return (
                  <div key={c.id}>
                    {row(c)}
                    {c.replies.length > 0 && (
                      <div className="ml-[48px]">
                        {open && c.replies.map((r) => row(r, true, c.id))}
                        <button
                          type="button"
                          onClick={() => setExpanded((s) => { const n = new Set(s); open ? n.delete(c.id) : n.add(c.id); return n; })}
                          className="mt-3 flex items-center gap-1 text-[12px] font-semibold"
                          style={{ color: C.muted }}
                        >
                          {open ? 'Hide replies' : `View ${c.replies.length} ${c.replies.length === 1 ? 'reply' : 'replies'}`}
                          <Icon name={open ? 'expand_less' : 'expand_more'} size={16} />
                        </button>
                      </div>
                    )}
                    {/* The clip drawer this replaced carried an in-comment ad; keeping it
                        so moving comments into the viewer does not quietly drop revenue. */}
                    {(ci + 1) % ADS_CONFIG.commentAdInterval === 0 && ci < threaded.length - 1 && (
                      <div className="mt-4"><VergrAd zone="inpage" /></div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Comment bar */}
        <div className="shrink-0 px-3 pt-2" style={{ background: C.sheet, paddingBottom: panel ? 12 : 'calc(var(--vg-safe-b, 0px) + 10px)' }}>
          {showSuggestions ? (
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2" role="listbox" aria-label="Mention someone">
              {suggestions.map((p) => (
                <button
                  key={p.uid}
                  type="button"
                  role="option"
                  aria-selected="false"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pickMention(p)}
                  className="shrink-0 flex items-center gap-2 h-10 pl-1 pr-3 rounded-full"
                  style={{ background: C.field }}
                >
                  <UserAvatar src={p.avatar} size={30} />
                  <span className="text-[13px] text-white font-semibold">@{p.username}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex justify-between pb-1" aria-label="Quick emoji">
              {QUICK_EMOJI.map((em) => (
                <button
                  key={em}
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => insertAtCaret(em, !emojiOpen)}
                  className="w-10 h-10 grid place-items-center text-[24px] leading-none rounded-full active:scale-90 transition-transform"
                  aria-label={`Add ${em}`}
                >
                  {em}
                </button>
              ))}
            </div>
          )}

          {replyingTo && (
            <div className="flex items-center justify-between px-1 pb-2">
              <span className="text-[12px] truncate" style={{ color: C.muted }}>
                Replying to <span className="text-white font-semibold">{replyingTo.name}</span>
              </span>
              <button type="button" onClick={() => setReplyingTo(null)} className="w-8 h-8 grid place-items-center" style={{ color: C.muted }} aria-label="Cancel reply">
                <Icon name="close" size={16} />
              </button>
            </div>
          )}

          {attach && (
            <div className="relative w-[64px] h-[64px] mb-2 rounded-xl overflow-hidden" style={{ background: C.field }}>
              <img src={attach.preview} alt="" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => setAttach(null)}
                aria-label="Remove photo"
                className="absolute top-1 right-1 w-6 h-6 rounded-full grid place-items-center"
                style={{ background: '#15151F' }}
              >
                <Icon name="close" size={14} className="text-white" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="shrink-0 pb-1"><UserAvatar src={profile?.avatar} size={32} /></div>
            <div className="flex-1 min-w-0 flex items-end rounded-[20px] pl-4 pr-1" style={{ background: C.field, minHeight: 40 }}>
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => { const v = e.target.value.slice(0, MAX_LEN); setInput(v); updateMention(v, e.target.selectionStart ?? v.length); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
                onClick={(e) => updateMention(input, e.currentTarget.selectionStart ?? input.length)}
                onFocus={() => setEmojiOpen(false)}
                placeholder={currentUser ? (replyingTo ? 'Add a reply…' : 'Add a comment…') : 'Sign in to comment'}
                disabled={!currentUser}
                aria-label="Comment"
                // No focus ring: the field's own fill already shows where you
                // type. A global focus style drew a violet ring here (measured).
                style={{ outline: 'none', boxShadow: 'none', border: 0 }}
                className="flex-1 min-w-0 bg-transparent py-[10px] text-[15px] leading-[20px] text-white outline-none resize-none placeholder:text-[#6B7280] disabled:text-[#6B7280]"
              />
              <div className="flex items-center self-end pb-[2px]">
                <FieldButton icon="alternate_email" label="Mention someone" onClick={startMention} />
                <FieldButton icon="image" label="Add a photo" onClick={() => fileRef.current?.click()} />
                <FieldButton
                  icon={emojiOpen ? 'keyboard' : 'sentiment_satisfied'}
                  label={emojiOpen ? 'Show keyboard' : 'Add an emoji'}
                  active={emojiOpen}
                  onClick={() => {
                    if (emojiOpen) { setEmojiOpen(false); inputRef.current?.focus(); }
                    else { inputRef.current?.blur(); setMention(null); setEmojiOpen(true); }
                  }}
                />
              </div>
            </div>
            {canSend && (
              <button
                type="button"
                onClick={submit}
                disabled={posting}
                className="shrink-0 w-10 h-10 rounded-full grid place-items-center active:scale-90 transition-transform"
                style={{ background: C.violet }}
                aria-label="Post comment"
              >
                {posting
                  ? <span className="w-4 h-4 rounded-full border-2 border-t-white animate-spin" style={{ borderColor: '#B89BFF', borderTopColor: '#FFFFFF' }} />
                  : <Icon name="arrow_upward" size={20} className="text-white" />}
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />

          {emojiOpen && (
            <div className="mt-2 -mx-3">
              <EmojiPicker height={260} onSelect={(em) => insertAtCaret(em, false)} onClose={() => setEmojiOpen(false)} />
            </div>
          )}
        </div>

        {/* Press-and-hold options */}
        {actionFor && (
          <div className="absolute inset-0 z-10 flex flex-col justify-end" role="dialog" aria-label="Comment options">
            <button type="button" data-scrim="" className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setActionFor(null)} aria-label="Close" />
            <div className="relative rounded-t-[18px] pt-2" style={{ background: C.menu, paddingBottom: panel ? 8 : 'calc(var(--vg-safe-b, 0px) + 8px)' }}>
              <span aria-hidden className="block mx-auto mb-1 w-9 h-1 rounded-full" style={{ background: '#2E2E40' }} />
              <ActionRow icon="reply" label="Reply" onClick={() => { const c = actionFor; setActionFor(null); startReply(c, c.parentId || null); }} />
              {actionFor.content && <ActionRow icon="content_copy" label="Copy" onClick={() => copyText(actionFor)} />}
              {actionOwn
                ? <ActionRow icon="delete" label="Delete" danger onClick={() => removeComment(actionFor)} />
                : <ActionRow icon="flag" label="Report" danger onClick={() => reportIt(actionFor)} />}
              <ActionRow icon="close" label="Cancel" onClick={() => setActionFor(null)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
