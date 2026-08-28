// Native messaging screens for the APK. Phone-first, reusing the exact shared
// data layer (useNotifications conversations listener — no duplicate reads) and
// callables as the web screens. Routed IS_NATIVE_BUILD only; web untouched.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../../firebase/config';
import { useNotifications } from '../../../context/NotificationContext';
import { useUser } from '../../../context/UserContext';
import { resolveChatUsers, chatPartner, peekChatUser } from '../../../utils/chatIdentity';
import TypingIndicator from '../../../components/TypingIndicator';
import {
  isChatMutedFor, isChatPinnedFor, setChatPinned,
  isChatArchivedFor, setChatArchived, sortInboxChats,
} from '../../../utils/chatOps';
import { getDraft } from '../../../utils/chatDrafts';
import { freshTypers } from '../../../utils/typingFresh';
import { ensureSavedMessages, subscribeToUserVoiceChannels, updateUserSettings } from '../../../firebase/firestore';
import { activeVoiceMembers } from '../../../utils/voiceSession';
import useGlobalChatSearch from '../../../hooks/useGlobalChatSearch';
import { peekSharedText, clearSharedText, peekSharedMedia, clearSharedMedia } from '../../../utils/shareIn';
import UserAvatar from '../../../components/UserAvatar';
import Icon from '../../../components/Icon';
import SwipeableRow from '../../../components/SwipeableRow';
import CreateVoiceChannelModal from '../../../components/CreateVoiceChannelModal';
import MessagesMenuDrawer from '../../../components/messages/MessagesMenuDrawer';
import InboxFolderTabs, { computeFolderView } from '../../../components/messages/InboxFolderTabs';
import DiscordRejoinPrompt from '../../../components/messages/DiscordRejoinPrompt';
import ChatFolderEditor from '../../../components/messages/ChatFolderEditor';
import { timeAgo, getTier } from '../../../utils/helpers';
import { ListSkeleton } from '../../../components/skeletons/GlassSkeletons';
import useOnlineStatus from '../../../hooks/useOnlineStatus';
import {
  subscribeOfficialChannels, subscribeChannelState, buildOfficialRows,
  setChannelPinned, setChannelArchived, resolveChannelTarget, syncChannelPushSubscriptions,
} from '../../../firebase/officialChannels';
import { getPushToken } from '../../../utils/pushNotifications';

// Status-bar inset only. The extra +8px on top of the inset stacked with the
// header's own 52px row and read as a dead gap above "Messages".
const safeTop = { paddingTop: 'env(safe-area-inset-top, 0px)' };

// ── Inbox ───────────────────────────────────────────────────────────
export function NativeMessagesInboxScreen() {
  const navigate = useNavigate();
  const {
    conversations, squadUnreadCount = 0, missedCallCount = 0, requestCount = 0,
  } = useNotifications();
  // Count for everything reachable from the hamburger menu but NOT visible on
  // this screen: calls, squad activity and message requests. All Chats is
  // deliberately excluded because that list is what the user is already looking
  // at, so badging the menu for it would be telling them to go where they are.
  const menuBadgeCount = squadUnreadCount + missedCallCount + requestCount;
  const { profile } = useUser();
  const loading = !conversations;
  const [search, setSearch] = useState('');
  const [voiceChannels, setVoiceChannels] = useState([]);
  const [showCreateVoice, setShowCreateVoice] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Official Vergr channels. These were MISSING from the native inbox while web
  // had them, so the APK simply never showed a channel. Same synthetic rows and
  // the same helpers, so every filter, sort and folder below treats them as
  // ordinary chats.
  const [officialChannels, setOfficialChannels] = useState([]);
  const [channelState, setChannelState] = useState({});

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return undefined;
    const a = subscribeOfficialChannels(uid, setOfficialChannels);
    const b = subscribeChannelState(uid, setChannelState);
    return () => { a(); b(); };
  }, [profile?.uid]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const unsub = subscribeToUserVoiceChannels(uid, setVoiceChannels);
    return () => unsub();
  }, []);
  // Live identity (uid → user doc): the conversation metadata snapshot is
  // frozen at creation — stale names/avatars and no @username without this.
  const [liveUsers, setLiveUsers] = useState({});
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 60000); return () => clearInterval(t); }, []);

  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me || !conversations?.length) return;
    const otherIds = conversations
      .filter((c) => !c.isGroup)
      .map((c) => c.participants?.find((id) => id !== me))
      .filter(Boolean);
    if (!otherIds.length) return;
    let alive = true;
    resolveChatUsers(otherIds).then((map) => { if (alive) setLiveUsers((prev) => ({ ...prev, ...map })); });
    return () => { alive = false; };
  }, [conversations]);

  const officialRows = buildOfficialRows(officialChannels, channelState, auth.currentUser?.uid, profile);
  // See MessagesListPanel: the synthetic support row steps aside once a real
  // support ticket exists, so "Vergr Support" appears exactly once and the
  // surviving row is the one carrying unread state (audit A36).
  const hasSupportThread = (conversations || []).some(c => c.supportThread === true);
  const visibleOfficial = hasSupportThread
    ? officialRows.filter(r => r.kind !== 'support')
    : officialRows;
  const allChats = [...visibleOfficial, ...(conversations || [])];

  // Subscribe this device to each channel topic, and drop it on mute. Without
  // this a channel post reaches the thread and pushes to nobody.
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !officialChannels.length) return;
    const token = getPushToken();
    if (!token) return;
    syncChannelPushSubscriptions(officialChannels, channelState, token).catch(() => {});
  }, [officialChannels, channelState]);

  const searched = search
    ? allChats.filter((c) => {
        const { name, username } = chatPartner(c, auth.currentUser.uid, profile, liveUsers);
        const q = search.toLowerCase();
        return name?.toLowerCase().includes(q) || username.toLowerCase().includes(q);
      })
    : allChats;

  // Saved Messages renders as its own static row; archived chats collapse
  // behind a section; the rest is pinned-first then most-recent.
  const me = auth.currentUser?.uid;
  const visible = searched.filter((c) => !c.isSaved);
  const [activeFolder, setActiveFolder] = useState('all');
  const archived = sortInboxChats(visible.filter((c) => isChatArchivedFor(c, me)), me);
  const filtered = sortInboxChats(visible.filter((c) => !isChatArchivedFor(c, me)), me);
  // A support ticket is a group technically, not to the user. It lists with the
  // official channel row it replaces, never under GROUPS.
  const dms = filtered.filter((c) => !c.isGroup || c.supportThread === true);
  const groups = filtered.filter((c) => c.isGroup && c.supportThread !== true);
  // Folder tabs (Telegram-style, incl. user custom folders).
  const customFolders = profile?.settings?.chatFolders || [];
  const view = computeFolderView(activeFolder, customFolders);
  const isUnread = (c) => (c.unreadCount?.[me] || 0) > 0;
  const inFolder = (c) => !view.ids || view.ids.has(c.id);
  const dmRows = (view.unreadOnly ? dms.filter(isUnread) : dms).filter(inFolder);
  const groupRows = (view.unreadOnly ? groups.filter(isUnread) : groups).filter(inFolder);
  const totalUnread = filtered.filter(isUnread).length;
  const folderCounts = { unread: totalUnread };
  for (const f of customFolders) {
    const ids = new Set(f.chatIds || []);
    folderCounts[f.id] = filtered.filter((c) => ids.has(c.id) && isUnread(c)).length;
  }
  const [showArchived, setShowArchived] = useState(false);
  // Collapsible inbox sections (DMs / Groups / Voice), remembered across visits.
  const [collapsed, setCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('vergr_inbox_collapsed')) || {}; } catch { return {}; }
  });
  const toggleSection = (key) => setCollapsed((prev) => {
    const next = { ...prev, [key]: !prev[key] };
    try { localStorage.setItem('vergr_inbox_collapsed', JSON.stringify(next)); } catch {}
    return next;
  });
  // Custom folder editor (create/edit/delete → settings.chatFolders).
  const [folderEditorOpen, setFolderEditorOpen] = useState(false);
  const [folderToEdit, setFolderToEdit] = useState(null);
  const saveFolder = async (folder) => {
    const list = profile?.settings?.chatFolders || [];
    const next = list.some((f) => f.id === folder.id) ? list.map((f) => f.id === folder.id ? folder : f) : [...list, folder];
    try { await updateUserSettings(me, { chatFolders: next }); setActiveFolder(folder.id); }
    catch (e) { console.error('Save folder failed:', e); }
    setFolderEditorOpen(false);
  };
  const deleteFolder = async (id) => {
    const next = (profile?.settings?.chatFolders || []).filter((f) => f.id !== id);
    try { await updateUserSettings(me, { chatFolders: next }); } catch (e) { console.error('Delete folder failed:', e); }
    if (activeFolder === id) setActiveFolder('all');
    setFolderEditorOpen(false);
  };
  const openSaved = async () => {
    try { const id = await ensureSavedMessages(); if (id) navigate(`/messages/${id}`); }
    catch (e) { console.error('Saved Messages open failed:', e); }
  };

  // Global MESSAGE search: local Dexie hits paint instantly, then the relay's
  // server-side results merge in (covering chats never opened on this device).
  const { results: msgResults } = useGlobalChatSearch(search);

  // Text or media shared into Vergr from another app, waiting for a chat.
  const [pendingShare, setPendingShare] = useState(
    () => peekSharedText() || peekSharedMedia()?.name || '',
  );
  useEffect(() => {
    const sync = () => setPendingShare(peekSharedText() || peekSharedMedia()?.name || '');
    window.addEventListener('vergr:native-share-in', sync);
    window.addEventListener('vergr:native-share-media', sync);
    return () => {
      window.removeEventListener('vergr:native-share-in', sync);
      window.removeEventListener('vergr:native-share-media', sync);
    };
  }, []);

  const chatNameOf = (chatId) => {
    const c = (conversations || []).find((x) => x.id === chatId);
    if (!c) return 'Chat';
    if (c.isSaved) return 'Saved Messages';
    return chatPartner(c, me, profile, liveUsers).name;
  };

  return (
    <div className="min-h-screen pb-24 bg-bg-dark">
      {/* Share target: text/a link was shared into Vergr from another app and is
          waiting for a chat. Without this the app would just open on the inbox
          with no explanation. */}
      {pendingShare && (
        <div className="sticky top-0 z-50 flex items-center gap-2 px-4 py-2.5 bg-brand-violet/15 border-b border-brand-violet/30" style={safeTop}>
          <Icon name="reply" size={16} className="text-brand-violet-light shrink-0 scale-x-[-1]" />
          <p className="text-[12px] text-text-primary flex-1 min-w-0 truncate">
            Pick a chat to share into: <span className="text-text-muted">{pendingShare}</span>
          </p>
          <button
            onClick={() => { clearSharedText(); clearSharedMedia(); setPendingShare(''); }}
            className="text-[11px] font-bold text-text-muted active:text-white shrink-0"
          >
            Cancel
          </button>
        </div>
      )}
      <header className="sticky top-0 z-40 glass-header" style={safeTop}>
        <div className="flex items-center justify-between px-4 h-[52px]">
          <div className="flex items-center gap-2">
            {/* Same rule as web: a count for what is BEHIND the menu (calls,
                squads, requests), never for All Chats, which is this screen. */}
            <button onClick={() => setMenuOpen(true)} className="relative w-8 h-8 -ml-1 rounded-full flex items-center justify-center text-text-secondary active:text-text-primary" aria-label="Messages menu">
              <Icon name="menu" size={24} />
              {menuBadgeCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-brand-ember text-white flex items-center justify-center text-[9px] font-black tabular-nums leading-none">
                  {menuBadgeCount > 99 ? '99+' : menuBadgeCount}
                </span>
              )}
            </button>
            <h1 className="font-syne text-[19px] font-black text-text-primary">Messages</h1>
          </div>
          <div className="flex items-center gap-1">
            <HeaderBtn icon="call" onClick={() => navigate('/messages/calls')} />
            <HeaderBtn icon="mail" onClick={() => navigate('/messages/requests')} />
            <HeaderBtn icon="group_add" onClick={() => navigate('/messages/create-group')} />
            <HeaderBtn icon="edit_square" onClick={() => navigate('/messages/new')} />
          </div>
        </div>
        <div className="px-4 pb-2">
          <label className="block relative">
            <Icon name="search" size={18} className="absolute inset-y-0 left-3 my-auto h-[18px] text-text-muted pointer-events-none" />
            <input type="text" placeholder="Search conversations..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-surface-2 border border-white/[0.06] rounded-xl py-2.5 pl-9 pr-4 text-text-primary text-sm focus:border-brand-violet outline-none" />
          </label>
        </div>
        <div className="px-2 border-b border-white/[0.05]">
          <InboxFolderTabs active={activeFolder} onChange={setActiveFolder} counts={folderCounts}
            customFolders={customFolders}
            onCreateFolder={() => { setFolderToEdit(null); setFolderEditorOpen(true); }}
            onEditFolder={(f) => { setFolderToEdit(f); setFolderEditorOpen(true); }} />
        </div>

      </header>

      {/* Cloned-community rejoin net (renders nothing without offers) */}
      <DiscordRejoinPrompt />

      <div className="mt-1">
        {loading ? <ListSkeleton rows={6} /> : (
          <>
            {/* Saved Messages (self-chat) */}
            <button onClick={openSaved}
              className="w-full flex items-center gap-3.5 px-4 py-3 text-left border-b border-white/[0.04] active:bg-surface-1/40">
              <div className="w-[52px] h-[52px] rounded-full bg-brand-violet/15 border border-brand-violet/30 flex items-center justify-center shrink-0">
                <Icon name="bookmark" size={22} className="text-brand-violet-light" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-[15px] text-text-primary">Saved Messages</h3>
                <p className="text-sm text-text-muted truncate">Notes, links and files only you can see</p>
              </div>
            </button>

            {/* Archived (collapsed) */}
            {archived.length > 0 && (
              <>
                <button onClick={() => setShowArchived((s) => !s)}
                  className="w-full flex items-center gap-3.5 px-4 py-3 text-left border-b border-white/[0.04] active:bg-surface-1/40">
                  <div className="w-[52px] h-[52px] rounded-full bg-surface-1 flex items-center justify-center shrink-0">
                    <Icon name="archive" size={22} className="text-text-muted" />
                  </div>
                  <span className="flex-1 font-bold text-[15px] text-text-primary">Archived</span>
                  <span className="text-[11px] text-text-muted font-dmmono">{archived.length}</span>
                  <Icon name={showArchived ? 'expand_less' : 'expand_more'} size={18} className="text-text-muted" />
                </button>
                {showArchived && archived.map((conv) => (
                  <NativeInboxRow key={conv.id} conv={conv} me={me} liveUsers={liveUsers} profile={profile} navigate={navigate} archivedView />
                ))}
              </>
            )}

            {/* Direct Messages */}
            {view.dms && (dmRows.length > 0 || activeFolder === 'all') && (
              <>
                <NativeSectionHeader label="Direct Messages" count={dmRows.length} collapsed={collapsed.dms}
                  onToggle={() => toggleSection('dms')} onAdd={() => navigate('/messages/new')} />
                {!collapsed.dms && (dmRows.length > 0 ? (
                  dmRows.map((conv) => <NativeInboxRow key={conv.id} conv={conv} me={me} liveUsers={liveUsers} profile={profile} navigate={navigate} />)
                ) : activeFolder === 'all' ? (
                  <button onClick={() => navigate('/messages/new')} className="w-full text-left px-4 py-3 text-text-muted text-sm active:bg-surface-1/40">+ Start a conversation</button>
                ) : null)}
              </>
            )}

            {/* Groups */}
            {view.groups && (groupRows.length > 0 || activeFolder === 'all') && (
              <>
                <NativeSectionHeader label="Groups" count={groupRows.length} collapsed={collapsed.groups}
                  onToggle={() => toggleSection('groups')} onAdd={() => navigate('/messages/create-group')} />
                {!collapsed.groups && (groupRows.length > 0 ? (
                  groupRows.map((conv) => <NativeInboxRow key={conv.id} conv={conv} me={me} liveUsers={liveUsers} profile={profile} navigate={navigate} />)
                ) : activeFolder === 'all' ? (
                  <button onClick={() => navigate('/messages/create-group')} className="w-full text-left px-4 py-3 text-text-muted text-sm active:bg-surface-1/40">+ Create a group</button>
                ) : null)}
              </>
            )}

            {/* Empty state when a folder filters everything out */}
            {activeFolder !== 'all' && dmRows.length === 0 && groupRows.length === 0 && (
              <div className="px-4 py-16 text-center text-text-muted text-sm">
                {activeFolder === 'unread' ? (
                  "You're all caught up — no unread chats."
                ) : view.ids ? (
                  <>
                    <p>This folder is empty.</p>
                    <button onClick={() => { setFolderToEdit(customFolders.find((f) => f.id === activeFolder)); setFolderEditorOpen(true); }}
                      className="mt-2 text-brand-violet-light font-bold">Add chats</button>
                  </>
                ) : 'Nothing here yet.'}
              </div>
            )}

            {/* Voice Channels */}
            {view.voice && (
            <>
            <NativeSectionHeader label="Voice Channels" count={voiceChannels.length} collapsed={collapsed.voice}
              onToggle={() => toggleSection('voice')} onAdd={() => setShowCreateVoice(true)} />
            {!collapsed.voice && (voiceChannels.length > 0 ? (
              voiceChannels.map((v) => {
                const inChannel = activeVoiceMembers(v);
                return (
                  <button key={v.id} onClick={() => navigate(`/messages/voice/${v.id}`)}
                    className="w-full flex items-center gap-3.5 px-4 py-3 text-left border-b border-white/[0.04] active:bg-surface-1/40">
                    <div className="w-[52px] h-[52px] rounded-full bg-surface-1 flex items-center justify-center shrink-0">
                      <Icon name={v.visibility === 'private' ? 'lock' : 'volume_up'} size={22} className="text-text-muted" />
                    </div>
                    <span className="flex-1 font-bold text-[15px] text-text-primary truncate">{v.name}</span>
                    {inChannel.length > 0 && (
                      <span className="flex items-center gap-1 text-green-400 text-[11px] font-dmmono shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />{inChannel.length}
                      </span>
                    )}
                  </button>
                );
              })
            ) : (
              <button onClick={() => setShowCreateVoice(true)} className="w-full text-left px-4 py-3 text-text-muted text-sm active:bg-surface-1/40">+ Create a voice channel</button>
            ))}
            </>
            )}

            {/* Global message search results (Dexie, all chats) */}
            {msgResults.length > 0 && (
              <div className="mt-2">
                <div className="px-4 py-2 text-[10px] font-dmmono uppercase tracking-[0.16em] text-text-muted border-b border-white/[0.04]">
                  Messages · {msgResults.length}
                </div>
                {msgResults.map((r) => (
                  <button key={`${r.chatId}_${r.id}`} onClick={() => navigate(`/messages/${r.chatId}?msg=${encodeURIComponent(r.id)}`)}
                    className="w-full flex flex-col gap-0.5 px-4 py-3 text-left border-b border-white/[0.04] active:bg-surface-1/40">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-bold text-text-primary truncate">{chatNameOf(r.chatId)}</span>
                      <span className="text-[10px] text-text-muted shrink-0">{r.createdAt?.toDate ? timeAgo(r.createdAt.toDate()) : ''}</span>
                    </div>
                    <span className="text-sm text-text-muted truncate">{r.text}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showCreateVoice && <CreateVoiceChannelModal onClose={() => setShowCreateVoice(false)} />}
      {folderEditorOpen && (
        <ChatFolderEditor
          folder={folderToEdit}
          conversations={conversations || []}
          liveUsers={liveUsers}
          viewerProfile={profile}
          me={me}
          onSave={saveFolder}
          onDelete={deleteFolder}
          onClose={() => setFolderEditorOpen(false)}
        />
      )}
      <MessagesMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />

      <button onClick={() => navigate('/messages/new')} aria-label="Start new chat"
        className="fixed right-5 w-14 h-14 rounded-full bg-brand-violet text-white flex items-center justify-center z-30 shadow-lg shadow-brand-violet/30 active:scale-95"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)' }}>
        <Icon name="edit" size={22} />
      </button>
    </div>
  );
}

// Collapsible section header (tap the label to fold; "+" is a separate add).
function NativeSectionHeader({ label, count, collapsed, onToggle, onAdd }) {
  return (
    <div className="flex items-center justify-between px-4 pt-4 pb-1">
      <button onClick={onToggle} className="flex items-center gap-1.5 text-text-muted active:text-text-primary">
        <Icon name={collapsed ? 'chevron_right' : 'expand_more'} size={16} />
        <span className="text-[10px] font-dmmono uppercase tracking-[0.16em]">{label}</span>
        {count > 0 && <span className="text-[10px] font-dmmono text-text-muted/50">{count}</span>}
      </button>
      <button onClick={onAdd} className="text-text-muted active:text-text-primary"><Icon name="add" size={18} /></button>
    </div>
  );
}

function NativeInboxRow({ conv, me, liveUsers, profile, navigate, archivedView = false }) {
  // chatPartner reads the persisted identity cache SYNCHRONOUSLY, so the first
  // paint already carries the live name/avatar. This row used to read
  // `liveUsers[otherId]` only (async state, empty on the first render) and fall
  // back to the frozen conv.metadata snapshot, which is why old names and old
  // avatars flashed on every open. Do not reintroduce a direct metadata read.
  const d = chatPartner(conv, me, profile, liveUsers);
  const otherId = d.otherId;
  const uname = d.username;
  const tier = !conv.isGroup ? getTier(d.coinsSpent || 0) : null;
  const unread = conv.unreadCount?.[me] || 0;
  const mentioned = !!conv.mentions?.[me];
  const muted = isChatMutedFor(conv, me);
  const pinned = isChatPinnedFor(conv, me);
  const { isOnline: otherOnline } = useOnlineStatus(!conv.isGroup ? otherId : null);
  const isOnline = !conv.isGroup && otherOnline;
  const typers = freshTypers(conv.typingUsers, me);
  const official = !!conv.isOfficial;
  // A channel row does not always point at the channel thread: a support channel
  // opens the user's own conversation, a community channel opens the room.
  const openOfficial = async () => {
    try {
      const path = await resolveChannelTarget(conv);
      if (path) navigate(path);
    } catch {
      navigate(`/messages/c/${conv.channelId}`);
    }
  };
  return (
    <SwipeableRow
      rightIcon={pinned ? 'keep_off' : 'keep'} rightLabel={pinned ? 'Unpin' : 'Pin'}
      leftIcon={archivedView ? 'unarchive' : 'archive'} leftLabel={archivedView ? 'Unarchive' : 'Archive'}
      onSwipeRight={() => (official ? setChannelPinned(me, conv.channelId, !pinned) : setChatPinned(conv.id, !pinned)).catch(() => {})}
      onSwipeLeft={() => (official ? setChannelArchived(me, conv.channelId, !archivedView) : setChatArchived(conv.id, !archivedView)).catch(() => {})}
    >
      <button onClick={() => (official ? openOfficial() : navigate(`/messages/${conv.id}`))}
        className={`w-full flex items-center gap-3.5 px-4 py-3.5 text-left border-b border-white/[0.04] ${unread > 0 ? 'bg-brand-violet/[0.02]' : 'active:bg-surface-1/40'}`}>
        {/* `flex` matters: UserAvatar is inline-flex, so a block wrapper adds a
            baseline descender gap under it and the online dot (bottom-anchored)
            lands BELOW the avatar instead of on its edge. */}
        <div className="relative shrink-0 flex" onClick={(e) => { e.stopPropagation(); if (official) openOfficial(); else if (!conv.isGroup && otherId) navigate(`/user/${otherId}`); }}>
          <UserAvatar src={d.avatar} size={52} tier={tier} isGroup={conv.isGroup} />
          {official && (
            <div className="absolute bottom-0 right-0 z-20 w-4 h-4 rounded-full flex items-center justify-center border-2 border-bg-dark"
                 style={{ background: conv.accentColor || '#7B1FFF' }} title="Official Vergr channel">
              <Icon name="verified" size={9} className="text-white" />
            </div>
          )}
          {!official && isOnline && <div className="absolute bottom-0 right-0 z-20 w-3.5 h-3.5 bg-green-500 border-[2.5px] border-bg-dark rounded-full" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-baseline mb-0.5">
            <h3 className={`font-bold text-[15px] truncate ${unread > 0 ? 'text-white' : 'text-text-primary'}`}>
              {d.name}
              {uname && <span className="ml-1.5 font-normal text-[11px] text-text-muted">{uname}</span>}
            </h3>
            <span className={`text-[11px] ml-2 shrink-0 flex items-center gap-1 ${unread > 0 ? 'text-brand-violet-light font-bold' : 'text-text-muted'}`}>
              {pinned && <Icon name="keep" size={12} className="text-text-muted" />}
              {conv.lastMessageAt ? timeAgo(conv.lastMessageAt.toDate()) : ''}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {conv.lastMessageSenderId === me && !getDraft(conv.id) && <Icon name="done_all" size={14} className="text-brand-violet-light/50 shrink-0" />}
              {muted && <Icon name="notifications_off" size={13} className="text-text-muted/70 shrink-0" />}
              {typers.length > 0 ? (
                <TypingIndicator
                  variant="inline"
                  className="text-sm leading-none text-brand-violet-light"
                  users={typers}
                  typist={peekChatUser(typers[0]?.uid)}
                  label={conv.isGroup ? `${typers[0].name || 'Someone'} is typing…` : 'typing…'}
                />
              ) : getDraft(conv.id) ? (
                <p className="text-sm truncate leading-none"><span className="text-brand-ember font-semibold">Draft: </span><span className="text-text-muted">{getDraft(conv.id)}</span></p>
              ) : (
                <p className={`text-sm truncate leading-none ${unread > 0 ? 'text-text-secondary font-medium' : 'text-text-muted'}`}>{conv.lastMessageText || 'Tap to chat'}</p>
              )}
            </div>
            {mentioned && <span className="w-[22px] h-[22px] rounded-full bg-brand-violet text-white text-[12px] font-black flex items-center justify-center shrink-0" title="You were mentioned">@</span>}
            {unread > 0 && <span className={`min-w-[22px] h-[22px] rounded-full flex items-center justify-center text-[11px] font-black px-1.5 shrink-0 ${muted ? 'bg-surface-2 text-text-muted border border-white/10' : 'bg-brand-violet text-white'}`}>{unread > 99 ? '99+' : unread}</span>}
          </div>
        </div>
      </button>
    </SwipeableRow>
  );
}

function HeaderBtn({ icon, onClick }) {
  return (
    <button onClick={onClick} className="w-9 h-9 rounded-full flex items-center justify-center text-text-muted active:text-text-primary">
      <Icon name={icon} size={20} />
    </button>
  );
}
