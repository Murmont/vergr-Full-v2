// src/screens/messages/ChatDetailScreen.jsx
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { doc, onSnapshot, collection, query, orderBy, where, getDocs, updateDoc, writeBatch, limit } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import Icon from '../../components/Icon';
import InlineAudioPlayer from '../../components/media/InlineAudioPlayer';
import MediaLightbox from '../../components/MediaLightbox';
import { RoundVideoOverlay } from '../../components/media/RoundVideoPlayer';
import UserAvatar from '../../components/UserAvatar';
import useResponsive from '../../hooks/useResponsive';
import useOnlineStatus from '../../hooks/useOnlineStatus';
import useChatRelayFlag from '../../hooks/useChatRelayFlag';
import { useUser } from '../../context/UserContext';
import { isChatMutedFor, setChatMuted, markChatCleared, deleteChatForMe, getChatClearedAt } from '../../utils/chatOps';
import { clearChatCache, getCachedMessages } from '../../utils/messageCache';
import { setContactNickname } from '../../firebase/firestore';
import { peekChatUser } from '../../utils/chatIdentity';
import UserName from '../../components/UserName';

// A shared-media photo tile. A dead/expired URL used to render the browser's
// broken-image glyph (what the founder saw); now it degrades to a quiet
// placeholder instead.
function SharedPhotoTile({ url, onOpen }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className="aspect-square rounded-lg bg-surface-2 border border-white/[0.05] flex items-center justify-center">
        <Icon name="broken_image" size={20} className="text-text-muted/40" />
      </div>
    );
  }
  return (
    <button type="button" onClick={onOpen} className="aspect-square overflow-hidden rounded-lg bg-surface-2 block w-full">
      <img src={url} alt="" onError={() => setFailed(true)}
        className="w-full h-full object-cover hover:opacity-80 transition-opacity" loading="lazy" />
    </button>
  );
}

// A shared-media video tile. `preload="metadata"` leaves the surface BLACK in
// the Android WebView (and often elsewhere) until a frame is decoded, so we
// nudge currentTime to paint a real first frame as the thumbnail. We never
// far-seek for duration — that downloads the whole file.
function SharedVideoTile({ url, poster, onOpen, round }) {
  const ref = useRef(null);
  return (
    <button type="button" onClick={onOpen}
      className={`aspect-square overflow-hidden relative group bg-black block w-full ${round ? 'rounded-full' : 'rounded-lg'}`}>
      {poster
        ? <img src={poster} alt="" className="w-full h-full object-cover" loading="lazy" />
        : (
          <video
            ref={ref}
            src={url}
            muted
            playsInline
            preload="metadata"
            className="w-full h-full object-cover"
            onLoadedMetadata={() => {
              const v = ref.current;
              if (v && v.currentTime === 0) { try { v.currentTime = 0.01; } catch { /* ignore */ } }
            }}
          />
        )}
      <div className={`absolute inset-0 flex items-center justify-center bg-black/25 group-hover:bg-black/45 transition-colors ${round ? 'rounded-full' : ''}`}>
        <Icon name="play_circle" size={32} className="text-white/85" />
      </div>
    </button>
  );
}

// Message timestamp in ms, whatever shape it arrives in (Firestore Timestamp,
// hydrated cache object, or a raw number).
const tsOf = (m) => {
  const t = m?.createdAt;
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  if (typeof t === 'string') return new Date(t).getTime() || 0;
  return 0;
};

// Best-effort display name for a file whose message carries no fileName
// (relay messages don't have the field). Strips the query/fragment and the
// upload's timestamp_hash prefix so it reads like a name, not an object key.
const fileNameFromUrl = (url) => {
  try {
    const last = String(url || '').split(/[?#]/)[0].split('/').pop() || '';
    const decoded = decodeURIComponent(last);
    const stripped = decoded.replace(/^\d{10,}_[0-9a-f]{6,}\.?/i, '');
    return stripped || decoded || 'File';
  } catch {
    return 'File';
  }
};

const MEDIA_TABS = [
  { id: 'photos', label: 'Photos', icon: 'photo' },
  { id: 'videos', label: 'Videos', icon: 'videocam' },
  { id: 'files', label: 'Files', icon: 'description' },
  { id: 'links', label: 'Links', icon: 'link' },
  { id: 'voice', label: 'Voice', icon: 'mic' },
];

// Thin route wrapper — keeps the standalone /messages/:chatId/details route
// working (deep links, mobile full-screen, group redirect fallback). On
// desktop the SAME panel is rendered inline as a side drawer by
// MessagesMasterDetail via the named ChatDetailsPanel export below.
export default function ChatDetailScreen() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  return <ChatDetailsPanel chatId={chatId} variant="page" onClose={() => navigate(-1)} />;
}

// chatId    — conversation id to render details for
// variant   — 'page' (full route, mobile TopBar / desktop header) | 'drawer' (right-side panel)
// onClose   — invoked by the back / X affordance
export function ChatDetailsPanel({ chatId, variant = 'page', onClose }) {
  const navigate = useNavigate();
  const { profile } = useUser();
  const relayEnabled = useChatRelayFlag();
  const isDrawer = variant === 'drawer';

  const [chatInfo, setChatInfo] = useState(null);
  const [otherProfile, setOtherProfile] = useState(null);
  const [mediaTab, setMediaTab] = useState('photos');
  const [mediaItems, setMediaItems] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  // In-app viewer for the media grid. Tapping a tile used to open the raw CDN
  // file in a browser tab (leaving the app, and showing a video note as the
  // bare square it is recorded as — the circle is a CSS mask).
  const [viewer, setViewer] = useState(null);
  const [roundVideo, setRoundVideo] = useState(null); // videonote → circle player
  const [muted, setMuted] = useState(false);
  const [toast, setToast] = useState(null);
  const [showMenu, setShowMenu] = useState(false);

  const otherUserId = chatInfo?.participants?.find(id => id !== auth.currentUser?.uid);
  const { isOnline, lastSeen } = useOnlineStatus(otherUserId);

  // Load conversation
  useEffect(() => {
    if (!chatId) return;
    const unsub = onSnapshot(doc(db, 'conversations', chatId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setChatInfo(data);
        setMuted(isChatMutedFor(data, auth.currentUser?.uid));
      }
    });
    return () => unsub();
  }, [chatId]);

  // Load other user's full profile
  useEffect(() => {
    if (!otherUserId) return;
    const unsub = onSnapshot(doc(db, 'users', otherUserId), (snap) => {
      if (snap.exists()) setOtherProfile({ id: snap.id, ...snap.data() });
    });
    return () => unsub();
  }, [otherUserId]);

  // Load shared media based on tab
  useEffect(() => {
    if (!chatId) return;
    setMediaLoading(true);
    setMediaItems([]);
    setViewer(null); // stale index would point into the previous tab's list
    setRoundVideo(null);

    // Media kinds per tab. These must match the message `type` values the chat
    // actually sends — photos arrive as image/meme/giphy and videos as
    // video/clip/videonote, so listing only 'image'/'video' hid most of them.
    const typeMap = {
      photos: ['image', 'meme', 'giphy'],
      videos: ['video', 'clip', 'videonote'],
      files: ['file', 'audio'],
      links: ['text'],
      voice: ['voice'],
    };
    const types = typeMap[mediaTab] || [];
    const urlRegex = /https?:\/\/[^\s<]+/gi;

    const withLinks = (rows) => {
      if (mediaTab !== 'links') return rows;
      return rows
        .filter(m => m.text && new RegExp(urlRegex.source, 'i').test(m.text))
        .map(m => ({ ...m, extractedUrl: m.text.match(new RegExp(urlRegex.source, 'gi'))?.[0] }));
    };

    const loadMedia = async () => {
      try {
        // RELAY PATH: message bodies are NEVER written to Firestore, so the old
        // Firestore query only ever returned pre-relay history (which is why
        // this panel looked almost empty). The local cache is the real store.
        if (relayEnabled) {
          // getCachedMessages returns oldest-first; reverse for newest-first
          // (hydrate() strips createdAtMs, so we can't re-sort on it here).
          //
          // CRITICAL: apply the SAME cleared-chat watermark the thread applies
          // when it hydrates. The thread hides everything at/older than the
          // watermark; reading Dexie raw bypassed that, so cleared and deleted
          // media reappeared here even though the conversation was empty.
          const clearedAt = getChatClearedAt(chatId);
          const cached = await getCachedMessages(chatId, 500);
          const rows = (cached || [])
            .filter((m) => {
              if (!m || m.deleted) return false;
              if (clearedAt && tsOf(m) <= clearedAt) return false;
              return mediaTab === 'links' ? (m.type === 'text' || !m.type) : types.includes(m.type);
            })
            .reverse();
          setMediaItems(withLinks(rows).slice(0, 200));
          setMediaLoading(false);
          return;
        }

        const msgsRef = collection(db, 'conversations', chatId, 'messages');
        const q = mediaTab === 'links'
          ? query(msgsRef, orderBy('createdAt', 'desc'), limit(200))
          : query(msgsRef, where('type', 'in', types), orderBy('createdAt', 'desc'), limit(100));
        const snap = await getDocs(q);
        setMediaItems(withLinks(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
      } catch (err) {
        console.error('Load media error:', err);
      }
      setMediaLoading(false);
    };
    loadMedia();
  }, [chatId, mediaTab, relayEnabled]);

  const handleMuteToggle = async () => {
    try {
      // Per-user mute (muted.{uid}) — the old shared boolean silenced both sides.
      await setChatMuted(chatId, !muted);
      setMuted(!muted);
      showToast(muted ? 'Notifications unmuted' : 'Notifications muted');
    } catch (err) { console.error('Mute toggle error:', err); }
  };

  const handleClearChat = async () => {
    if (!window.confirm('Clear all messages in this chat on THIS device?')) return;
    try {
      if (relayEnabled) {
        // Relay path: history only exists locally — wipe the Dexie cache AND
        // set the cleared watermark (otherwise the relay's 7-day backlog
        // replays everything on the next open).
        markChatCleared(chatId);
        await clearChatCache(chatId);
      } else {
        const snap = await getDocs(collection(db, 'conversations', chatId, 'messages'));
        const batch = writeBatch(db);
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      showToast('Chat cleared');
    } catch (err) { console.error('Clear chat error:', err); }
  };

  const handleSetNickname = async () => {
    const current = profile?.contactNicknames?.[otherUserId] || '';
    const next = window.prompt(
      `Nickname for ${otherProfile?.displayName || 'this user'} (only you see it — leave empty to remove):`,
      current,
    );
    if (next === null) return; // cancelled
    try {
      await setContactNickname(otherUserId, next);
      showToast(next.trim() ? 'Nickname saved' : 'Nickname removed');
    } catch (err) { console.error('Nickname error:', err); }
  };

  const handleDeleteChat = async () => {
    if (!window.confirm('Delete this chat? It will be removed from your inbox.')) return;
    try {
      // Local wipe + watermark first: the convo id is deterministic, so a new
      // chat with the same user resurrects this doc — without this the old
      // messages come straight back (Dexie + relay backlog replay).
      markChatCleared(chatId);
      await clearChatCache(chatId);
      // Telegram parity: delete-for-me (per-user hiddenFor + server deleteForMe
      // watermark), NOT the shared status:'deleted' that nuked the other
      // person's inbox too.
      await deleteChatForMe(chatId);
      navigate('/messages');
    } catch (err) { console.error('Delete chat error:', err); }
  };

  const handleBlockUser = async () => {
    if (!otherUserId || !window.confirm(`Block ${otherProfile?.displayName || 'this user'}?`)) return;
    try {
      const { setDoc } = await import('firebase/firestore');
      await setDoc(doc(db, 'users', auth.currentUser.uid, 'blocked', otherUserId), {
        blockedAt: new Date(),
        userId: otherUserId,
      });
      showToast('User blocked');
    } catch (err) { console.error('Block error:', err); }
  };

  const formatLastSeen = () => {
    if (isOnline) return 'online';
    if (lastSeen) {
      const diff = Date.now() - lastSeen;
      if (diff < 60000) return 'last seen just now';
      if (diff < 3600000) return `last seen ${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `last seen ${Math.floor(diff / 3600000)}h ago`;
      return `last seen ${lastSeen.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    }
    return 'offline';
  };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  // peekChatUser (persisted identity cache, synchronous) sits between the live
  // profile fetch and the frozen conversation snapshot, so opening contact info
  // never flashes the name/avatar this chat was created with while the real
  // profile loads.
  const cachedUser = peekChatUser(otherUserId);
  const otherMeta = cachedUser || chatInfo?.metadata?.[otherUserId];
  const nickname = profile?.contactNicknames?.[otherUserId];
  const displayName = nickname || otherProfile?.displayName || otherMeta?.displayName || otherMeta?.name || 'User';
  const username = otherProfile?.username || cachedUser?.username;
  const bio = otherProfile?.bio;
  const avatar = otherProfile?.avatar || otherMeta?.avatar;
  const banner = otherProfile?.banner;
  const memberSince = otherProfile?.createdAt?.toDate?.();

  // Frosted-glass quick-action button (founder design: white icons, no cyan).
  const glassActionStyle = {
    background: 'rgba(255,255,255,0.14)',
    backdropFilter: 'blur(14px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(14px) saturate(1.4)',
    border: '1px solid rgba(255,255,255,0.22)',
  };
  const headerInset = isDrawer ? 0 : 'env(safe-area-inset-top, 0px)';

  return (
    <div className="flex flex-col h-full bg-bg-dark">
     <div className="flex-1 overflow-y-auto no-scrollbar">
      {/* ── TOP SECTION (founder design): the contact's profile banner as the
          background, with the header, avatar, identity + glass quick-actions
          all overlaid on top. Scrolls with the rest of the content. ── */}
      <div className="relative overflow-hidden" style={{ paddingTop: headerInset }}>
        {/* Banner image (or brand-gradient fallback — never bare). */}
        <div className="absolute inset-0">
          {banner ? (
            <img src={banner} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-brand-violet via-[#2A1147] to-bg-dark" />
          )}
          {/* Scrims: darken the top for header legibility + fade the bottom into
              the dark content below. */}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(7,8,13,0.55) 0%, rgba(7,8,13,0.10) 28%, rgba(7,8,13,0.45) 70%, var(--bg-dark, #0B0B14) 100%)' }} />
        </div>

        <div className="relative z-10">
          {/* Header row */}
          <div className="flex items-center justify-between px-3 h-[52px]">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={() => onClose?.()} className="text-white/90 hover:text-white shrink-0"><Icon name={isDrawer ? 'close' : 'arrow_back'} size={22} /></button>
              <h1 className="text-base font-bold text-white truncate">Contact Info</h1>
            </div>
            <div className="relative shrink-0">
              <button onClick={() => setShowMenu(s => !s)} className="text-white/90 hover:text-white p-1"><Icon name="more_vert" size={22} /></button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 top-9 z-50 w-48 bg-surface-1 border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden animate-fade-in">
                    <button onClick={() => { setShowMenu(false); handleMuteToggle(); }} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-2 text-left">
                      <Icon name={muted ? 'notifications' : 'notifications_off'} size={18} className="text-text-secondary" />
                      <span className="text-sm text-text-primary">{muted ? 'Unmute' : 'Mute'}</span>
                    </button>
                    <button onClick={() => { setShowMenu(false); handleClearChat(); }} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-2 text-left border-t border-white/[0.04]">
                      <Icon name="cleaning_services" size={18} className="text-text-secondary" />
                      <span className="text-sm text-text-primary">Clear Chat</span>
                    </button>
                    <button onClick={() => { setShowMenu(false); handleBlockUser(); }} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-500/5 text-left border-t border-white/[0.04]">
                      <Icon name="block" size={18} className="text-brand-ember" />
                      <span className="text-sm text-brand-ember">Block</span>
                    </button>
                    <button onClick={() => { setShowMenu(false); handleDeleteChat(); }} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-500/5 text-left border-t border-white/[0.04]">
                      <Icon name="delete" size={18} className="text-brand-ember" />
                      <span className="text-sm text-brand-ember">Delete Chat</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Avatar + identity */}
          <div className="flex flex-col items-center px-4 pt-3 pb-4">
            <div className="relative mb-3">
              {/* Soft purple glow (not a hard ring) to make the avatar pop. */}
              <span className="block rounded-full" style={{ filter: 'drop-shadow(0 0 9px #8A12CA) drop-shadow(0 0 3px #8A12CA)' }}>
                <UserAvatar src={avatar} size={104} />
              </span>
              {isOnline && <div className="absolute bottom-2 right-2 w-4 h-4 bg-green-500 border-2 border-bg-dark rounded-full" />}
            </div>
            {/* A nickname is YOUR private label for someone, not their identity,
                so it must never pick up their cosmetics. Only the real name
                goes through UserName; the line below already shows the real
                name underneath whenever a nickname is overriding it. */}
            <h2 className="text-white font-bold text-2xl drop-shadow-sm">
              {nickname ? displayName : <UserName user={otherProfile} masked fallback={displayName} />}
            </h2>
            {nickname && otherProfile?.displayName && otherProfile.displayName !== nickname && (
              <p className="text-white/60 text-xs mt-0.5"><UserName user={otherProfile} masked /></p>
            )}
            {username && <p className="text-white/80 text-sm mt-0.5">@{username}</p>}
            <p className={`text-xs mt-1 font-medium ${isOnline ? 'text-green-400' : 'text-white/60'}`}>{formatLastSeen()}</p>
          </div>

          {/* Glass quick actions */}
          <div className="flex justify-center gap-5 px-4 pb-6">
            <button onClick={() => navigate(`/messages/${chatId}`)} className="flex flex-col items-center gap-1.5">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={glassActionStyle}><Icon name="chat" size={22} className="text-white" /></div>
              <span className="text-[10px] text-white/90 font-bold">Message</span>
            </button>
            <button onClick={() => navigate(`/call/${chatId}/voice`)} className="flex flex-col items-center gap-1.5">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={glassActionStyle}><Icon name="call" size={22} className="text-white" /></div>
              <span className="text-[10px] text-white/90 font-bold">Call</span>
            </button>
            <button onClick={() => navigate(`/call/${chatId}/video`)} className="flex flex-col items-center gap-1.5">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={glassActionStyle}><Icon name="videocam" size={22} className="text-white" /></div>
              <span className="text-[10px] text-white/90 font-bold">Video</span>
            </button>
            <button onClick={() => navigate(`/user/${otherUserId}`)} className="flex flex-col items-center gap-1.5">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={glassActionStyle}><Icon name="person" size={22} className="text-white" /></div>
              <span className="text-[10px] text-white/90 font-bold">Profile</span>
            </button>
          </div>
        </div>
      </div>

        {/* Bio */}
        <div className="mx-4 mt-4 mb-4">
          <h3 className="text-white text-sm font-bold mb-2">Bio</h3>
          {bio
            ? <p className="text-text-secondary text-sm leading-relaxed">{bio}</p>
            : <p className="text-text-muted text-sm">No bio yet</p>}
          <div className="mt-4 h-px bg-white/[0.06]" />
        </div>

        {/* Info section */}
        {(otherProfile?.email || memberSince) && (
          <div className="mx-4 mb-4">
            <div className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
              {otherProfile?.email && (
                <div className="flex items-center gap-3 px-4 py-3">
                  <Icon name="email" size={20} className="text-text-secondary" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary">{otherProfile.email}</p>
                    <p className="text-[10px] text-text-muted">Email</p>
                  </div>
                </div>
              )}
              {memberSince && (
                <div className={`flex items-center gap-3 px-4 py-3 ${otherProfile?.email ? 'border-t border-white/[0.03]' : ''}`}>
                  <Icon name="calendar_today" size={20} className="text-text-secondary" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary">{memberSince.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
                    <p className="text-[10px] text-text-muted">Member since</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Settings */}
        <div className="mx-4 mb-4">
          <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 px-1">Settings</h3>
          <div className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
            <button onClick={handleMuteToggle} className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2 transition-colors text-left">
              <Icon name={muted ? 'notifications_off' : 'notifications'} size={20} className="text-text-secondary" />
              <span className="flex-1 text-sm text-text-primary">{muted ? 'Unmute Notifications' : 'Mute Notifications'}</span>
              <div className={`w-10 h-6 rounded-full flex items-center px-0.5 transition-colors ${muted ? 'bg-brand-violet justify-end' : 'bg-surface-3 justify-start'}`}>
                <div className="w-5 h-5 bg-white rounded-full shadow" />
              </div>
            </button>
            <button onClick={handleSetNickname} className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2 transition-colors text-left border-t border-white/[0.03]">
              <Icon name="badge" size={20} className="text-text-secondary" />
              <div className="flex-1 min-w-0">
                <span className="block text-sm text-text-primary">Nickname</span>
                {nickname && <span className="block text-[10px] text-text-muted truncate">{nickname}</span>}
              </div>
              <Icon name="chevron_right" size={18} className="text-text-muted" />
            </button>
            <button onClick={() => navigate(`/messages/${chatId}/settings`)} className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2 transition-colors text-left border-t border-white/[0.03]">
              <Icon name="wallpaper" size={20} className="text-text-secondary" />
              <span className="flex-1 text-sm text-text-primary">Change Wallpaper</span>
              <Icon name="chevron_right" size={18} className="text-text-muted" />
            </button>
          </div>
        </div>

        {/* Shared media */}
        <div className="mx-4 mb-4">
          <h3 className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2 px-1">Shared Media</h3>
          <div className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
            {/* Media tabs */}
            <div className="flex overflow-x-auto no-scrollbar border-b border-white/[0.03]">
              {MEDIA_TABS.map(t => (
                <button key={t.id} onClick={() => setMediaTab(t.id)}
                  className={`flex-1 min-w-0 py-2.5 flex flex-col items-center gap-0.5 transition-colors relative ${mediaTab === t.id ? 'text-brand-violet' : 'text-text-muted hover:text-text-secondary'}`}>
                  <Icon name={t.icon} size={18} />
                  <span className="text-[8px] font-bold uppercase tracking-wider">{t.label}</span>
                  {mediaTab === t.id && <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-brand-violet rounded-full" />}
                </button>
              ))}
            </div>

            {/* Media grid */}
            <div className="p-2 min-h-[120px]">
              {mediaLoading && (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-brand-violet border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              {!mediaLoading && mediaItems.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8">
                  <Icon name={MEDIA_TABS.find(t => t.id === mediaTab)?.icon || 'photo'} size={28} className="text-text-muted/20 mb-2" />
                  <p className="text-xs text-text-muted">No {mediaTab} shared yet</p>
                </div>
              )}

              {!mediaLoading && mediaItems.length > 0 && (
                <>
                  {(mediaTab === 'photos') && (
                    <div className="grid grid-cols-3 gap-1">
                      {mediaItems.map((m, i) => (
                        <SharedPhotoTile key={m.id} url={m.contentUrl} onOpen={() => setViewer({ index: i })} />
                      ))}
                    </div>
                  )}

                  {(mediaTab === 'videos') && (
                    <div className="grid grid-cols-3 gap-1">
                      {mediaItems.map((m, i) => (
                        <SharedVideoTile
                          key={m.id}
                          url={m.type === 'clip' ? (m.videoUrl || m.contentUrl) : m.contentUrl}
                          poster={m.type === 'clip' ? m.contentUrl : null}
                          round={m.type === 'videonote'}
                          // A video note stays a CIRCLE everywhere (it's only
                          // recorded square); a gallery video goes full-screen.
                          onOpen={() => (m.type === 'videonote'
                            ? setRoundVideo(m.contentUrl)
                            : setViewer({ index: i }))}
                        />
                      ))}
                    </div>
                  )}

                  {(mediaTab === 'files') && (
                    <div className="space-y-1">
                      {mediaItems.map(m => (
                        <a key={m.id} href={m.contentUrl} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-2 transition-colors">
                          <div className="w-9 h-9 rounded-lg bg-brand-violet/10 flex items-center justify-center shrink-0">
                            <Icon name="description" size={18} className="text-brand-violet" />
                          </div>
                          <div className="flex-1 min-w-0">
                            {/* Relay messages carry no fileName field, so fall
                                back to the object name in the URL rather than
                                labelling every row a bare "File". */}
                            <p className="text-sm text-text-primary truncate">{m.fileName || fileNameFromUrl(m.contentUrl)}</p>
                            <p className="text-[10px] text-text-muted">{m.fileSize ? (m.fileSize < 1048576 ? `${(m.fileSize / 1024).toFixed(1)} KB` : `${(m.fileSize / 1048576).toFixed(1)} MB`) : ''}</p>
                          </div>
                          <Icon name="download" size={16} className="text-text-muted" />
                        </a>
                      ))}
                    </div>
                  )}

                  {(mediaTab === 'links') && (
                    <div className="space-y-1">
                      {mediaItems.map(m => (
                        <a key={m.id} href={m.extractedUrl} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-2 transition-colors">
                          <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
                            <Icon name="link" size={18} className="text-purple-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-brand-violet truncate">{m.extractedUrl}</p>
                            <p className="text-[10px] text-text-muted truncate">{m.text}</p>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}

                  {(mediaTab === 'voice') && (
                    <div className="space-y-1">
                      {mediaItems.map(m => (
                        <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-2 transition-colors">
                          <div className="w-9 h-9 rounded-lg bg-brand-violet/10 flex items-center justify-center shrink-0">
                            <Icon name="mic" size={18} className="text-brand-violet-light" />
                          </div>
                          <InlineAudioPlayer src={m.contentUrl} className="flex-1" />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Danger zone */}
        <div className="mx-4 mb-8">
          <div className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
            <button onClick={handleClearChat} className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2 transition-colors text-left">
              <Icon name="cleaning_services" size={20} className="text-text-secondary" />
              <span className="flex-1 text-sm text-text-primary">Clear Chat History</span>
            </button>
            <button onClick={handleBlockUser} className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-red-500/5 transition-colors text-left border-t border-white/[0.03]">
              <Icon name="block" size={20} className="text-brand-ember" />
              <span className="flex-1 text-sm text-brand-ember">Block {displayName}</span>
            </button>
            <button onClick={handleDeleteChat} className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-red-500/5 transition-colors text-left border-t border-white/[0.03]">
              <Icon name="delete" size={20} className="text-brand-ember" />
              <span className="flex-1 text-sm text-brand-ember">Delete Chat</span>
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-surface-2 text-white text-sm font-medium px-5 py-2.5 rounded-full border border-white/[0.06] shadow-xl z-50 animate-fade-in">
          {toast}
        </div>
      )}

      {roundVideo && <RoundVideoOverlay src={roundVideo} onClose={() => setRoundVideo(null)} />}

      {viewer && (mediaTab === 'photos' || mediaTab === 'videos') && (
        <MediaLightbox
          items={mediaItems.map(m => (
            mediaTab === 'videos'
              ? { url: m.type === 'clip' ? (m.videoUrl || m.contentUrl) : m.contentUrl, type: 'video', poster: m.type === 'clip' ? m.contentUrl : undefined }
              : { url: m.contentUrl, type: 'image' }
          ))}
          startIndex={viewer.index}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}