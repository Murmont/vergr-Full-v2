import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { StackSkeleton } from '../../components/skeletons/GlassSkeletons';
import { collection, query, where, orderBy, limit, getDocs, addDoc, serverTimestamp, Timestamp, updateDoc, doc, arrayUnion, increment } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { getUser, loadFollowingStatuses, createConversation } from '../../firebase/firestore';
import { sendRelayMessageTo } from '../../utils/relaySend';
import { isGroupSeen, markGroupSeen } from '../../utils/statusSeen';
import { openArCamera, isArCameraSupported } from '../../utils/nativeArCamera';
import Icon from '../../components/Icon';
import StatusCanvasEditor from '../../components/status/StatusCanvasEditor';
import StatusCanvasView from '../../components/status/StatusCanvasView';
import { canvasHasContent, canvasText, emptyCanvas, flattenCanvas } from '../../utils/statusCanvas';
import UserAvatar from '../../components/UserAvatar';
import TopBar from '../../components/TopBar';
import { useLayout } from '../../context/LayoutContext';
import { useUI } from '../../context/UIContext';
import useResponsive from '../../hooks/useResponsive';
import { timeAgo } from '../../utils/helpers';
import { resolveTier } from '../../utils/tierSystem';

const STATUS_COLORS = [
  'bg-gradient-to-br from-brand-violet-light to-brand-violet',
  'bg-gradient-to-br from-brand-violet to-brand-pink',
  'bg-gradient-to-br from-brand-gold to-orange-500',
  'bg-gradient-to-br from-brand-ember to-pink-500',
  'bg-gradient-to-br from-green-500 to-emerald-800',
  'bg-gradient-to-br from-blue-600 to-brand-violet',
  'bg-gradient-to-br from-brand-pink to-brand-gold',
  'bg-[#1a1a2e]',
];

export default function StatusScreen() {
  const [statuses, setStatuses] = useState([]); // grouped by user
  const [myStatuses, setMyStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewingUser, setViewingUser] = useState(null); // which user's statuses are being viewed
  const [viewingIndex, setViewingIndex] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();
  const { showToast } = useUI();

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  useEffect(() => {
    if (!currentUser) return;
    const load = async () => {
      setLoading(true);
      try {
        // Only my own statuses + those of people I follow (rules enforce the
        // same scope). Newest-first already.
        const all = await loadFollowingStatuses(currentUser.uid);

        // Group by author.
        const grouped = {};
        for (const s of all) {
          if (!grouped[s.authorId]) {
            grouped[s.authorId] = { userId: s.authorId, items: [], author: null };
          }
          grouped[s.authorId].items.push(s);
        }
        // Resolve authors in parallel (skip self — we use `profile`).
        await Promise.all(
          Object.keys(grouped)
            .filter((uid) => uid !== currentUser.uid)
            .map(async (uid) => { grouped[uid].author = await getUser(uid).catch(() => null); }),
        );

        const mine = grouped[currentUser.uid]?.items || [];
        delete grouped[currentUser.uid];

        // Unseen groups first — that's the whole point of the ring signal.
        const others = Object.values(grouped).sort((a, b) => {
          const aSeen = isGroupSeen(currentUser.uid, a.userId, a.items[0]?.id);
          const bSeen = isGroupSeen(currentUser.uid, b.userId, b.items[0]?.id);
          if (aSeen !== bSeen) return aSeen ? 1 : -1; // unseen (false) first
          const at = a.items[0]?.createdAt?.toMillis?.() || 0;
          const bt = b.items[0]?.createdAt?.toMillis?.() || 0;
          return bt - at;
        });

        setMyStatuses(mine);
        setStatuses(others);
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    load();
  }, [currentUser]);

  // Honor ?compose=1 and ?viewing=<uid> deep links so the home stories
  // strip can drop users into the create flow or a specific user's viewer.
  useEffect(() => {
    if (loading || !currentUser) return;
    const compose = searchParams.get('compose');
    const viewing = searchParams.get('viewing');
    if (compose === '1') {
      setShowCreate(true);
      // Clear the param so a refresh doesn't reopen the modal.
      searchParams.delete('compose');
      setSearchParams(searchParams, { replace: true });
      return;
    }
    if (viewing) {
      if (viewing === 'me' && myStatuses.length > 0) {
        setViewingUser({ userId: currentUser.uid, items: myStatuses, author: profile });
        setViewingIndex(0);
      } else if (viewing !== 'me') {
        const target = statuses.find(g => g.userId === viewing);
        if (target) {
          setViewingUser(target);
          setViewingIndex(0);
        }
      }
      searchParams.delete('viewing');
      setSearchParams(searchParams, { replace: true });
    }
  }, [loading, currentUser, searchParams, setSearchParams, myStatuses, statuses, profile]);

  const openViewer = (userGroup, startIndex = 0) => {
    setViewingUser(userGroup);
    setViewingIndex(startIndex);
    // Opening a group marks it seen up to its newest status → its ring dims and
    // it sinks below still-unseen groups on the next load.
    if (userGroup?.userId && userGroup.userId !== currentUser?.uid) {
      markGroupSeen(currentUser?.uid, userGroup.userId, userGroup.items?.[0]?.id);
    }
  };

  const closeViewer = () => {
    setViewingUser(null);
    setViewingIndex(0);
  };

  // Status list (left panel on desktop, full screen on mobile)
  const statusList = (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <h2 className="font-syne text-xl font-bold">Status</h2>
        <button onClick={() => setShowCreate(true)} className="w-9 h-9 rounded-full bg-brand-violet/15 flex items-center justify-center hover:bg-brand-violet/25 transition-colors" title="Create status">
          <Icon name="add" size={20} className="text-brand-violet-light" />
        </button>
      </div>

      {/* My status */}
      <div className="px-4 mt-2">
        <button onClick={() => myStatuses.length > 0 ? openViewer({ userId: currentUser?.uid, items: myStatuses, author: profile }) : setShowCreate(true)}
          className="w-full flex items-center gap-3 p-3 rounded-2xl bg-surface-1 border border-white/[0.06] hover:border-white/[0.12] transition-all text-left">
          {/* Two things this wrapper has to get right, both of which put the
              badge visually "under" the avatar when missed:
              1. `flex`, not the default block — UserAvatar is inline-flex, so a
                 block wrapper adds a baseline descender gap and anything
                 bottom-anchored drops below the circle.
              2. `z-20` on the overlays — UserAvatar's <img> is `relative z-10`,
                 so a z-auto badge/ring is PAINTED OVER by the avatar and only
                 the sliver poking past the corner survives. */}
          <div className="relative flex">
            <UserAvatar src={profile?.avatar} size={48} />
            {myStatuses.length === 0 && (
              <div className="absolute bottom-0 right-0 z-20 w-5 h-5 bg-brand-violet rounded-full flex items-center justify-center border-2 border-bg-dark">
                <Icon name="add" size={12} className="text-white" />
              </div>
            )}
            {myStatuses.length > 0 && (
              <div className="absolute inset-0 z-20 rounded-full ring-2 ring-brand-violet-light ring-offset-2 ring-offset-bg-dark pointer-events-none" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-text-primary">My Status</p>
            <p className="text-text-muted text-[10px]">
              {myStatuses.length > 0 ? `${myStatuses.length} update${myStatuses.length > 1 ? 's' : ''} · ${timeAgo(myStatuses[0]?.createdAt)}` : 'Tap to add a status update'}
            </p>
          </div>
        </button>
      </div>

      {/* Others' statuses */}
      <div className="flex-1 px-4 mt-4 overflow-y-auto">
        <p className="text-[10px] text-text-muted uppercase font-bold tracking-wider mb-2">Recent updates</p>
        {loading ? (
          <StackSkeleton rows={4} height={64} />
        ) : statuses.length === 0 ? (
          <div className="text-center py-10">
            <Icon name="amp_stories" size={40} className="text-text-muted/20 mx-auto mb-2" />
            <p className="text-text-muted text-sm">No status updates yet</p>
          </div>
        ) : (
          <div className="space-y-1">
            {statuses.map(group => {
              const seen = isGroupSeen(currentUser?.uid, group.userId, group.items[0]?.id);
              return (
              <button key={group.userId} onClick={() => openViewer(group)}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-surface-2/50 transition-colors text-left">
                <div className="relative flex">
                  <UserAvatar src={group.author?.avatar} size={44} />
                  {/* z-20: the avatar <img> is z-10 and would paint over the ring.
                      Unseen = bright violet ring; seen = dim neutral so "new" reads
                      at a glance (the stories-ring convention). */}
                  <div className={`absolute inset-0 z-20 rounded-full ring-2 ring-offset-2 ring-offset-bg-dark pointer-events-none ${seen ? 'ring-white/15' : 'ring-brand-violet-light'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">{group.author?.displayName || 'User'}</p>
                  <p className="text-text-muted text-[10px]">{group.items.length} update{group.items.length > 1 ? 's' : ''} · {timeAgo(group.items[0]?.createdAt)}</p>
                </div>
              </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  if (!isDesktop) {
    return (
      <div className="min-h-screen pb-20">
        <TopBar title="Status" showBack />
        {statusList}
        {viewingUser && <StatusViewer userGroup={viewingUser} startIndex={viewingIndex} onClose={closeViewer} currentUser={currentUser} navigate={navigate} onReplySent={() => showToast("Reply sent", "success")} onReplyError={(m) => showToast(m, "error")} />}
        {showCreate && <CreateStatusModal onClose={() => setShowCreate(false)} currentUser={currentUser} profile={profile} onCreated={(s) => { setMyStatuses(prev => [s, ...prev]); setShowCreate(false); }} />}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      <div className="w-[380px] border-r border-white/[0.04] bg-bg-dark flex flex-col">
        {statusList}
      </div>
      <div className="flex-1 bg-bg-dark flex items-center justify-center">
        {viewingUser ? (
          <StatusViewer userGroup={viewingUser} startIndex={viewingIndex} onClose={closeViewer} currentUser={currentUser} navigate={navigate} isDesktop onReplySent={() => showToast("Reply sent", "success")} onReplyError={(m) => showToast(m, "error")} />
        ) : (
          <div className="text-center px-8">
            <Icon name="amp_stories" size={56} className="text-text-muted/20 mx-auto mb-4" />
            <p className="text-text-secondary text-sm">Click a status to view it here</p>
            <button onClick={() => setShowCreate(true)} className="mt-4 px-5 py-2.5 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-sm font-bold">
              Create Status
            </button>
          </div>
        )}
      </div>
      {showCreate && <CreateStatusModal onClose={() => setShowCreate(false)} currentUser={currentUser} profile={profile} onCreated={(s) => { setMyStatuses(prev => [s, ...prev]); setShowCreate(false); }} />}
    </div>
  );
}

// Full-screen status viewer with swipe/arrow navigation + reply bar
function StatusViewer({ userGroup, startIndex = 0, onClose, currentUser, navigate, isDesktop, onReplySent, onReplyError }) {
  const [index, setIndex] = useState(startIndex);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const timerRef = useRef(null);
  const items = userGroup.items;
  const current = items[index];

  // Auto-advance every 5 seconds
  useEffect(() => {
    timerRef.current = setTimeout(() => {
      if (index < items.length - 1) setIndex(i => i + 1);
      else onClose();
    }, 5000);
    return () => clearTimeout(timerRef.current);
  }, [index, items.length, onClose]);

  // Track view
  useEffect(() => {
    if (!current?.id || !currentUser?.uid || userGroup.userId === currentUser.uid) return;
    updateDoc(doc(db, 'statuses', current.id), {
      viewerIds: arrayUnion(currentUser.uid),
      viewCount: increment(1),
    }).catch(() => {});
  }, [current?.id, currentUser?.uid, userGroup.userId]);

  const prev = () => { clearTimeout(timerRef.current); if (index > 0) setIndex(i => i - 1); };
  const next = () => { clearTimeout(timerRef.current); if (index < items.length - 1) setIndex(i => i + 1); else onClose(); };

  const handleReply = async () => {
    if (!reply.trim() || sending || !currentUser) return;
    setSending(true);
    // Deliver as a REAL DM. The old path wrote to a flat `messages` collection
    // that nothing reads (chat runs on the relay + `conversations`), so every
    // status reply was silently lost. Now: open/create the 1:1 conversation,
    // then send over the relay like Forward does — guaranteed delivery on web
    // AND native. Context is prepended as a short quote line since the relay
    // frame only carries plain text.
    try {
      const author = userGroup.author || { id: userGroup.userId };
      const target = {
        id: userGroup.userId,
        displayName: author.displayName || author.username || 'Vergr Member',
        username: author.username,
        avatar: author.avatar || null,
      };
      const convoId = await createConversation(currentUser.uid, target);
      const quote = current?.text ? `↩︎ "${String(current.text).slice(0, 60)}"\n` : '↩︎ Replied to your status\n';
      await sendRelayMessageTo(convoId, { text: quote + reply.trim() });
      setReply('');
      onReplySent?.();
    } catch (err) {
      console.error('status reply failed', err);
      onReplyError?.(err?.message || "Couldn't send reply");
    }
    setSending(false);
  };

  const containerClass = isDesktop ? 'relative w-full max-w-md mx-auto h-[calc(100vh-100px)] rounded-3xl overflow-hidden' : 'fixed inset-0 z-[100]';

  return (
    <div className={containerClass}>
      {/* Background */}
      <div className={`absolute inset-0 ${current?.bgColor || STATUS_COLORS[0]}`}>
        {current?.mediaUrl && (
          current.mediaType === 'video' 
            ? <video src={current.mediaUrl} className="w-full h-full object-cover" autoPlay muted loop />
            : <img src={current.mediaUrl} className="w-full h-full object-cover" alt="" />
        )}
      </div>

      {/* Dark overlay for text readability */}
      <div className="absolute inset-0 bg-black/20" />

      {/* Progress bars */}
      <div className="absolute top-0 left-0 right-0 flex gap-1 px-3 pt-3 z-10">
        {items.map((_, i) => (
          <div key={i} className="flex-1 h-0.5 rounded-full bg-white/30 overflow-hidden">
            <div className={`h-full bg-white rounded-full transition-all duration-[5000ms] ease-linear ${i < index ? 'w-full' : i === index ? 'w-full animate-none' : 'w-0'}`}
              style={i === index ? { animation: 'fillBar 5s linear forwards' } : undefined} />
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="absolute top-6 left-0 right-0 flex items-center gap-3 px-4 z-10">
        <UserAvatar src={userGroup.author?.avatar} size={32} />
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-bold truncate drop-shadow">{userGroup.author?.displayName}</p>
          <p className="text-white/70 text-[10px] drop-shadow">{current?.createdAt ? timeAgo(current.createdAt) : ''}</p>
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-full bg-black/30 flex items-center justify-center">
          <Icon name="close" size={20} className="text-white" />
        </button>
      </div>

      {/* Navigation zones */}
      <button onClick={prev} className="absolute left-0 top-0 bottom-16 w-1/3 z-10" />
      <button onClick={next} className="absolute right-0 top-0 bottom-16 w-1/3 z-10" />

      {/* Desktop arrows */}
      {isDesktop && (
        <>
          {index > 0 && <button onClick={prev} className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 flex items-center justify-center z-20 hover:bg-black/60"><Icon name="chevron_left" size={24} className="text-white" /></button>}
          {index < items.length - 1 && <button onClick={next} className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 flex items-center justify-center z-20 hover:bg-black/60"><Icon name="chevron_right" size={24} className="text-white" /></button>}
        </>
      )}

      {/* Status content — text overlay */}
      <div className="absolute inset-0 flex items-center justify-center px-8 z-[5]">
        {current?.text && (
          <p className="text-white text-xl font-bold text-center leading-relaxed drop-shadow-lg line-clamp-3 max-w-[85%] mx-auto" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
            {current.text}
          </p>
        )}
      </div>

      {/* Caption */}
      {current?.caption && (
        <div className="absolute bottom-16 left-0 right-0 px-8 z-10">
          <p className="text-white text-sm text-center drop-shadow line-clamp-2 leading-relaxed">{current.caption}</p>
        </div>
      )}

      {/* Viewer count — shown on own statuses */}
      {userGroup.userId === currentUser?.uid && (
        <div className="absolute bottom-16 left-4 z-10 flex items-center gap-1.5">
          <Icon name="visibility" size={14} className="text-white/60" />
          <span className="text-white/60 text-xs font-dmmono">{current?.viewCount || 0}</span>
        </div>
      )}

      {/* Reply bar */}
      {userGroup.userId !== currentUser?.uid && (
        <div className="absolute bottom-0 left-0 right-0 px-4 py-3 bg-gradient-to-t from-black/60 to-transparent z-10">
          <div className="flex items-center gap-2">
            <input type="text" value={reply} onChange={e => setReply(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleReply()}
              placeholder="Reply..." className="flex-1 bg-white/20 backdrop-blur-md border border-white/20 rounded-full px-4 py-2.5 text-sm text-white placeholder:text-white/50 outline-none" />
            {reply.trim() && (
              <button onClick={handleReply} disabled={sending} className="w-10 h-10 rounded-full bg-brand-violet flex items-center justify-center shrink-0">
                <Icon name="send" size={18} className="text-white" />
              </button>
            )}
          </div>
        </div>
      )}

      <style>{`@keyframes fillBar { from { width: 0; } to { width: 100%; } }`}</style>
    </div>
  );
}

// Create status modal
function CreateStatusModal({ onClose, currentUser, profile, onCreated }) {
  const [text, setText] = useState('');
  const [bgIndex, setBgIndex] = useState(0);
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [caption, setCaption] = useState('');
  const [posting, setPosting] = useState(false);
  // The blank status is a full canvas now: stacked layers the user positions,
  // draws, styles and animates. Photo/video statuses keep the simple path.
  const [canvas, setCanvas] = useState(() => emptyCanvas());
  // Followers-only by default (the documented promise); a poster can opt into
  // Public reach. Stamped as `audience` and enforced by the read rule.
  const [audience, setAudience] = useState('followers');
  const fileRef = useRef(null);

  const handleMedia = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { alert('Max 50MB'); return; }
    setMediaFile(file);
    setMediaPreview(URL.createObjectURL(file));
  };

  // Native AR camera (on-device background effects). Only offered where the
  // Kotlin bridge exists; everywhere else this button doesn't render and the
  // normal picker is unchanged. Returns a File, so it joins the SAME path a
  // picked photo takes — no separate upload branch to keep in sync.
  const openEffectsCamera = async () => {
    const file = await openArCamera();
    if (!file) return; // cancelled or unavailable — leave the composer as-is
    setMediaFile(file);
    setMediaPreview(URL.createObjectURL(file));
  };

  const removeMedia = () => {
    setMediaFile(null);
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaPreview(null);
  };

  const handlePost = async () => {
    if ((!text.trim() && !mediaFile && !canvasHasContent(canvas)) || posting || !currentUser) return;
    setPosting(true);
    try {
      let mediaUrl = null;
      let mediaType = null;

      // Upload media to R2 if selected
      if (mediaFile) {
        const { uploadToR2 } = await import('../../utils/r2Storage');

        let uploadFile = mediaFile;
        const tier = resolveTier(profile);
        if (mediaFile.type.startsWith('image/')) {
          try {
            const { compressImage } = await import('../../utils/mediaCompression');
            uploadFile = await compressImage(mediaFile, 'post');
          } catch { /* fall through with original */ }
        } else if (mediaFile.type.startsWith('video/')) {
          try {
            const { compressVideo } = await import('../../utils/mediaCompression');
            uploadFile = await compressVideo(mediaFile, tier);
          } catch { /* fall through with original */ }
        }

        const { url } = await uploadToR2(uploadFile, 'post');
        mediaUrl = url;
        mediaType = mediaFile.type.startsWith('video') ? 'video' : 'image';
      }

      const statusData = {
        authorId: currentUser.uid,
        text: text.trim() || null,
        bgColor: mediaFile ? null : STATUS_COLORS[bgIndex],
        mediaUrl,
        mediaType,
        caption: caption.trim() || null,
        audience: audience === 'public' ? 'public' : 'followers',
        viewerIds: [],
        viewCount: 0,
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
      };
      const docRef = await addDoc(collection(db, 'statuses'), statusData);
      onCreated({ id: docRef.id, ...statusData, createdAt: new Date() });
    } catch (err) {
      console.error(err);
    }
    setPosting(false);
  };

  return (
    // FULL-SCREEN editor, not a floating card. The canvas is sized by height
    // (see StatusCanvasEditor), so it needs a parent with real height to fill —
    // and a status deserves the whole screen rather than a small panel with the
    // controls stacked underneath it. `dvh` survives the mobile URL bar, and the
    // safe-area inset keeps the Share row clear of the Android nav bar.
    <div className="fixed inset-0 z-[100] bg-bg-dark" onClick={e => e.stopPropagation()}>
      <div
        className="flex flex-col h-full px-3 pt-3"
        style={{ height: '100dvh', paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
      >
        {/* Close + media source. Everything else lives ON the canvas. */}
        <div className="flex items-center justify-between mb-2 shrink-0">
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-surface-1 flex items-center justify-center">
            <Icon name="close" size={20} className="text-white" />
          </button>
          <div className="flex gap-2">
            {mediaPreview ? (
              <button onClick={removeMedia} className="w-9 h-9 rounded-full bg-surface-1 flex items-center justify-center">
                <Icon name="delete" size={18} className="text-brand-ember" />
              </button>
            ) : (
              <>
                {isArCameraSupported() && (
                  <button onClick={openEffectsCamera} title="Camera effects"
                    className="w-9 h-9 rounded-full bg-brand-violet flex items-center justify-center">
                    <Icon name="auto_awesome" size={17} className="text-white" />
                  </button>
                )}
                <button onClick={() => fileRef.current?.click()} title="Photo or video"
                  className="w-9 h-9 rounded-full bg-surface-1 flex items-center justify-center">
                  <Icon name="videocam" size={18} className="text-white" />
                </button>
              </>
            )}
          </div>
        </div>

        {mediaPreview ? (
          <div className="relative flex-1 min-h-0 mx-auto rounded-3xl overflow-hidden bg-black"
            style={{ height: 'min(calc(100dvh - 168px), calc(min(100vw - 24px, 430px) * 16 / 9))', aspectRatio: '9 / 16' }}>
            {mediaFile?.type?.startsWith('video')
              ? <video src={mediaPreview} className="absolute inset-0 w-full h-full object-cover" autoPlay muted loop />
              : <img src={mediaPreview} className="absolute inset-0 w-full h-full object-cover" alt="" />}
            <div className="absolute inset-0 bg-black/20" />
            <div className="absolute inset-0 flex items-center justify-center px-8">
              <textarea value={text} onChange={e => { if (e.target.value.length <= 200) setText(e.target.value); }}
                placeholder="Type your status..."
                className="w-full bg-transparent text-white text-xl font-bold text-center placeholder:text-white/40 outline-none resize-none leading-relaxed"
                style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}
                rows={3} maxLength={200} />
            </div>
          </div>
        ) : (
          <StatusCanvasEditor value={canvas} onChange={setCanvas} className="flex-1 min-h-0" />
        )}

        <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleMedia} />

        {/* Compact footer: caption and audience share one row so the canvas
            keeps the height. The canvas is the subject of this screen; the
            controls should not compete with it. */}
        <div className="shrink-0 mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <input type="text" value={caption} onChange={e => { if (e.target.value.length <= 100) setCaption(e.target.value); }}
              placeholder="Add a caption..."
              className="flex-1 min-w-0 bg-surface-2 border border-white/[0.06] rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none" />
            {/* Followers by default; one tap opts into public reach. */}
            <button onClick={() => setAudience(audience === 'public' ? 'followers' : 'public')}
              title="Who can see this"
              className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-surface-2 border border-white/[0.06] text-xs font-bold text-text-secondary">
              <Icon name={audience === 'public' ? 'public' : 'group'} size={15} />
              {audience === 'public' ? 'Public' : 'Followers'}
            </button>
          </div>

          {/* Post button */}
          <button onClick={handlePost} disabled={posting || (!text.trim() && !mediaFile && !canvasHasContent(canvas))}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white font-bold text-sm disabled:opacity-40">
            {posting ? 'Uploading...' : 'Share Status'}
          </button>
        </div>
      </div>
    </div>
  );
}
