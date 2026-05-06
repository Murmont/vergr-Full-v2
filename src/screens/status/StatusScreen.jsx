import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, orderBy, limit, getDocs, addDoc, serverTimestamp, Timestamp, updateDoc, doc, arrayUnion, increment } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { getUser } from '../../firebase/firestore';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import TopBar from '../../components/TopBar';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { timeAgo } from '../../utils/helpers';

const STATUS_COLORS = [
  'bg-gradient-to-br from-brand-cyan to-brand-violet',
  'bg-gradient-to-br from-brand-violet to-brand-pink',
  'bg-gradient-to-br from-brand-gold to-orange-500',
  'bg-gradient-to-br from-brand-ember to-pink-500',
  'bg-gradient-to-br from-green-500 to-brand-cyan',
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
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

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
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const q = query(
          collection(db, 'statuses'),
          where('createdAt', '>=', Timestamp.fromDate(cutoff)),
          orderBy('createdAt', 'desc'),
          limit(100)
        );
        const snap = await getDocs(q);
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Group by user
        const grouped = {};
        for (const s of all) {
          if (!grouped[s.authorId]) {
            grouped[s.authorId] = { userId: s.authorId, items: [], author: null };
          }
          grouped[s.authorId].items.push(s);
        }
        // Load authors
        for (const uid of Object.keys(grouped)) {
          grouped[uid].author = await getUser(uid).catch(() => null);
        }

        // Separate my statuses
        const mine = grouped[currentUser.uid]?.items || [];
        delete grouped[currentUser.uid];

        setMyStatuses(mine);
        setStatuses(Object.values(grouped));
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    load();
  }, [currentUser]);

  const openViewer = (userGroup, startIndex = 0) => {
    setViewingUser(userGroup);
    setViewingIndex(startIndex);
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
        <button onClick={() => setShowCreate(true)} className="w-9 h-9 rounded-full bg-brand-cyan/10 flex items-center justify-center hover:bg-brand-cyan/20 transition-colors" title="Create status">
          <Icon name="add" size={20} className="text-brand-cyan" />
        </button>
      </div>

      {/* My status */}
      <div className="px-4 mt-2">
        <button onClick={() => myStatuses.length > 0 ? openViewer({ userId: currentUser?.uid, items: myStatuses, author: profile }) : setShowCreate(true)}
          className="w-full flex items-center gap-3 p-3 rounded-2xl bg-surface-1 border border-white/[0.06] hover:border-white/[0.12] transition-all text-left">
          <div className="relative">
            <UserAvatar src={profile?.avatar} size={48} />
            {myStatuses.length === 0 && (
              <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-brand-cyan rounded-full flex items-center justify-center border-2 border-bg-dark">
                <Icon name="add" size={12} className="text-bg-dark" />
              </div>
            )}
            {myStatuses.length > 0 && (
              <div className="absolute inset-0 rounded-full ring-2 ring-brand-cyan ring-offset-2 ring-offset-bg-dark pointer-events-none" />
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
          <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-surface-3 border-t-brand-cyan rounded-full animate-spin" /></div>
        ) : statuses.length === 0 ? (
          <div className="text-center py-10">
            <Icon name="amp_stories" size={40} className="text-text-muted/20 mx-auto mb-2" />
            <p className="text-text-muted text-sm">No status updates yet</p>
          </div>
        ) : (
          <div className="space-y-1">
            {statuses.map(group => (
              <button key={group.userId} onClick={() => openViewer(group)}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-surface-2/50 transition-colors text-left">
                <div className="relative">
                  <UserAvatar src={group.author?.avatar} size={44} />
                  <div className="absolute inset-0 rounded-full ring-2 ring-brand-cyan ring-offset-2 ring-offset-bg-dark pointer-events-none" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">{group.author?.displayName || 'User'}</p>
                  <p className="text-text-muted text-[10px]">{group.items.length} update{group.items.length > 1 ? 's' : ''} · {timeAgo(group.items[0]?.createdAt)}</p>
                </div>
              </button>
            ))}
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
        {viewingUser && <StatusViewer userGroup={viewingUser} startIndex={viewingIndex} onClose={closeViewer} currentUser={currentUser} navigate={navigate} />}
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
          <StatusViewer userGroup={viewingUser} startIndex={viewingIndex} onClose={closeViewer} currentUser={currentUser} navigate={navigate} isDesktop />
        ) : (
          <div className="text-center px-8">
            <Icon name="amp_stories" size={56} className="text-text-muted/20 mx-auto mb-4" />
            <p className="text-text-secondary text-sm">Click a status to view it here</p>
            <button onClick={() => setShowCreate(true)} className="mt-4 px-5 py-2.5 rounded-xl bg-brand-cyan text-bg-dark text-sm font-bold">
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
function StatusViewer({ userGroup, startIndex = 0, onClose, currentUser, navigate, isDesktop }) {
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
    try {
      // Send as a message with quoted status
      await addDoc(collection(db, 'messages'), {
        senderId: currentUser.uid,
        recipientId: userGroup.userId,
        type: 'status_reply',
        text: reply.trim(),
        quotedStatus: { id: current.id, text: current.text, bgColor: current.bgColor, mediaUrl: current.mediaUrl },
        createdAt: serverTimestamp(),
      });
      setReply('');
    } catch (err) { console.error(err); }
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
              <button onClick={handleReply} disabled={sending} className="w-10 h-10 rounded-full bg-brand-cyan flex items-center justify-center shrink-0">
                <Icon name="send" size={18} className="text-bg-dark" />
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
  const fileRef = useRef(null);

  const handleMedia = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { alert('Max 50MB'); return; }
    setMediaFile(file);
    setMediaPreview(URL.createObjectURL(file));
  };

  const removeMedia = () => {
    setMediaFile(null);
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaPreview(null);
  };

  const handlePost = async () => {
    if ((!text.trim() && !mediaFile) || posting || !currentUser) return;
    setPosting(true);
    try {
      let mediaUrl = null;
      let mediaType = null;

      // Upload media to R2 if selected
      if (mediaFile) {
        const { uploadToR2 } = await import('../../utils/r2Storage');

        let uploadFile = mediaFile;
        const tier = profile?.tier || 'free';
        if (mediaFile.type.startsWith('image/')) {
          try {
            const { compressImage } = await import('../../utils/Mediacompression');
            uploadFile = await compressImage(mediaFile, 'post');
          } catch { /* fall through with original */ }
        } else if (mediaFile.type.startsWith('video/')) {
          try {
            const { compressVideo } = await import('../../utils/Mediacompression');
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        {/* Preview */}
        <div className={`relative w-full aspect-[9/16] max-h-[70vh] rounded-3xl overflow-hidden ${mediaPreview ? 'bg-black' : STATUS_COLORS[bgIndex]}`}>
          {mediaPreview && (
            mediaFile?.type?.startsWith('video')
              ? <video src={mediaPreview} className="absolute inset-0 w-full h-full object-cover" autoPlay muted loop />
              : <img src={mediaPreview} className="absolute inset-0 w-full h-full object-cover" alt="" />
          )}
          {mediaPreview && <div className="absolute inset-0 bg-black/20" />}
          <div className="absolute inset-0 flex items-center justify-center px-8">
            <textarea value={text} onChange={e => { if (e.target.value.length <= 200) setText(e.target.value); }}
              placeholder="Type your status..."
              className="w-full bg-transparent text-white text-xl font-bold text-center placeholder:text-white/40 outline-none resize-none leading-relaxed"
              style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}
              rows={3} maxLength={200} />
          </div>

          {/* Close */}
          <button onClick={onClose} className="absolute top-4 left-4 w-8 h-8 rounded-full bg-black/30 flex items-center justify-center">
            <Icon name="close" size={20} className="text-white" />
          </button>

          {/* Media button */}
          <div className="absolute top-4 right-4 flex gap-2">
            {mediaPreview ? (
              <button onClick={removeMedia} className="w-8 h-8 rounded-full bg-black/30 flex items-center justify-center">
                <Icon name="delete" size={18} className="text-brand-ember" />
              </button>
            ) : (
              <button onClick={() => fileRef.current?.click()} className="w-8 h-8 rounded-full bg-black/30 flex items-center justify-center">
                <Icon name="add_photo_alternate" size={18} className="text-white" />
              </button>
            )}
          </div>

          {/* Character count */}
          <div className="absolute bottom-4 right-4">
            <span className={`text-[10px] font-dmmono ${text.length > 180 ? 'text-brand-ember' : 'text-white/50'}`}>{text.length}/200</span>
          </div>

          <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleMedia} />
        </div>

        {/* Controls */}
        <div className="mt-3 space-y-3">
          {/* Color picker — only when no media */}
          {!mediaPreview && (
            <div className="flex items-center gap-2 justify-center">
              {STATUS_COLORS.map((color, i) => (
                <button key={i} onClick={() => setBgIndex(i)}
                  className={`w-7 h-7 rounded-full ${color} border-2 transition-all ${bgIndex === i ? 'border-white scale-110' : 'border-transparent'}`} />
              ))}
            </div>
          )}

          {/* Caption */}
          <div className="relative">
            <input type="text" value={caption} onChange={e => { if (e.target.value.length <= 100) setCaption(e.target.value); }}
              placeholder="Add a caption..."
              className="w-full bg-surface-2 border border-white/[0.06] rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-text-muted font-dmmono">{caption.length}/100</span>
          </div>

          {/* Post button */}
          <button onClick={handlePost} disabled={posting || (!text.trim() && !mediaFile)}
            className="w-full py-3 rounded-xl bg-brand-cyan text-bg-dark font-bold text-sm disabled:opacity-40">
            {posting ? 'Uploading...' : 'Share Status'}
          </button>
        </div>
      </div>
    </div>
  );
}
