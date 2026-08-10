import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../firebase/config';
import { useNotifications } from '../../context/NotificationContext';
import { useUser } from '../../context/UserContext';
import { resolveChatUsers, chatPartner } from '../../utils/chatIdentity';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import { timeAgo, getTier } from '../../utils/helpers';
import useResponsive from '../../hooks/useResponsive';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import { ListSkeleton } from '../../components/skeletons/GlassSkeletons';
import {
  isChatPinnedFor, setChatPinned, isChatArchivedFor, setChatArchived, sortInboxChats,
} from '../../utils/chatOps';
import { ensureSavedMessages, subscribeToUserVoiceChannels } from '../../firebase/firestore';
import { activeVoiceMembers } from '../../utils/voiceSession';
import useGlobalChatSearch from '../../hooks/useGlobalChatSearch';
import { peekSharedText, clearSharedText, peekSharedMedia, clearSharedMedia } from '../../utils/shareIn';
import SwipeableRow from '../../components/SwipeableRow';
import CreateVoiceChannelModal from '../../components/CreateVoiceChannelModal';
import MessagesMenuDrawer from '../../components/messages/MessagesMenuDrawer';
import InboxFolderTabs, { computeFolderView } from '../../components/messages/InboxFolderTabs';
import DiscordRejoinPrompt from '../../components/messages/DiscordRejoinPrompt';
import ChatFolderEditor from '../../components/messages/ChatFolderEditor';
import { updateUserSettings } from '../../firebase/firestore';
import useOnlineStatus from '../../hooks/useOnlineStatus';
import { freshTypers } from '../../utils/typingFresh';

export default function MessagesInboxScreen() {
  const { isDesktop } = useResponsive();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  // Conversations come from the single shared NotificationContext listener.
  // The screen used to mount its own onSnapshot, doubling Firestore reads.
  const { conversations } = useNotifications();
  const { profile } = useUser();
  const loading = !conversations;
  const [search, setSearch] = useState('');
  const [, setTick] = useState(0);
  const [voiceChannels, setVoiceChannels] = useState([]);
  const [showCreateVoice, setShowCreateVoice] = useState(false);
  // Live identity (uid -> user doc). The conversation `metadata` snapshot is
  // frozen at creation, so it shows stale names/avatars after a rename. Resolve
  // the live docs (module-level TTL cache) and prefer them everywhere.
  const [liveUsers, setLiveUsers] = useState({});

  useEffect(() => {
    const me = auth.currentUser?.uid;
    if (!me || !conversations?.length) return;
    const otherIds = conversations
      .filter(c => !c.isGroup)
      .map(c => c.participants?.find(id => id !== me))
      .filter(Boolean);
    if (!otherIds.length) return;
    let alive = true;
    resolveChatUsers(otherIds).then(map => { if (alive) setLiveUsers(prev => ({ ...prev, ...map })); });
    return () => { alive = false; };
  }, [conversations]);

  // Voice channels the user owns or was invited to (same source as desktop).
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const unsub = subscribeToUserVoiceChannels(uid, setVoiceChannels);
    return () => unsub();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  const me = auth.currentUser?.uid;

  // Warm the avatar cache: fire a no-op image load for every conversation's
  // avatar so the service worker (vergr-avatars cache) holds them — rows then
  // paint their pictures instantly on this and future visits.
  useEffect(() => {
    if (!conversations?.length) return;
    for (const c of conversations) {
      const url = chatPartner(c, me, profile, liveUsers).avatar;
      if (url) { const img = new Image(); img.src = url; }
    }
  }, [conversations, me, liveUsers]);

  const [showArchived, setShowArchived] = useState(false);
  const [activeFolder, setActiveFolder] = useState('all');
  // Collapsible inbox sections (DMs / Groups / Voice), remembered across visits.
  const [collapsed, setCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('vergr_inbox_collapsed')) || {}; } catch { return {}; }
  });
  const toggleSection = (key) => setCollapsed(prev => {
    const next = { ...prev, [key]: !prev[key] };
    try { localStorage.setItem('vergr_inbox_collapsed', JSON.stringify(next)); } catch {}
    return next;
  });

  const searched = search
    ? (conversations || []).filter(c => {
        const { name, username } = chatPartner(c, auth.currentUser.uid, profile, liveUsers);
        const q = search.toLowerCase();
        return name?.toLowerCase().includes(q) || username.toLowerCase().includes(q);
      })
    : (conversations || []);
  // Saved Messages gets its own static row — keep the convo doc out of the list.
  const visible = searched.filter(c => !c.isSaved);
  // Archived chats live behind a collapsed section; everything else is
  // pinned-first then most-recent (sortInboxChats).
  const archived = sortInboxChats(visible.filter(c => isChatArchivedFor(c, me)), me);
  const filtered = sortInboxChats(visible.filter(c => !isChatArchivedFor(c, me)), me);
  // Split into DMs and Groups so the mobile inbox matches the desktop rail
  // (separate sections, each with its own "+" action).
  const dms = filtered.filter(c => !c.isGroup);
  const groups = filtered.filter(c => c.isGroup);
  // Folder tabs (Telegram-style, incl. user custom folders) drive which
  // sections show + unread scoping + hand-picked chat restriction.
  const customFolders = profile?.settings?.chatFolders || [];
  const view = computeFolderView(activeFolder, customFolders);
  const isUnread = c => (c.unreadCount?.[me] || 0) > 0;
  const inFolder = c => !view.ids || view.ids.has(c.id);
  const dmRows = (view.unreadOnly ? dms.filter(isUnread) : dms).filter(inFolder);
  const groupRows = (view.unreadOnly ? groups.filter(isUnread) : groups).filter(inFolder);
  const totalUnread = filtered.filter(isUnread).length;
  const folderCounts = { unread: totalUnread };
  for (const f of customFolders) {
    const ids = new Set(f.chatIds || []);
    folderCounts[f.id] = filtered.filter(c => ids.has(c.id) && isUnread(c)).length;
  }
  const openSaved = async () => {
    try { const id = await ensureSavedMessages(); if (id) navigate(`/messages/${id}`); }
    catch (e) { console.error('Saved Messages open failed:', e); }
  };

  // Custom folder editor (create/edit/delete → settings.chatFolders).
  const [folderEditorOpen, setFolderEditorOpen] = useState(false);
  const [folderToEdit, setFolderToEdit] = useState(null);
  const saveFolder = async (folder) => {
    const list = profile?.settings?.chatFolders || [];
    const next = list.some(f => f.id === folder.id) ? list.map(f => f.id === folder.id ? folder : f) : [...list, folder];
    try { await updateUserSettings(me, { chatFolders: next }); setActiveFolder(folder.id); }
    catch (e) { console.error('Save folder failed:', e); }
    setFolderEditorOpen(false);
  };
  const deleteFolder = async (id) => {
    const next = (profile?.settings?.chatFolders || []).filter(f => f.id !== id);
    try { await updateUserSettings(me, { chatFolders: next }); } catch (e) { console.error('Delete folder failed:', e); }
    if (activeFolder === id) setActiveFolder('all');
    setFolderEditorOpen(false);
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
    const c = (conversations || []).find(x => x.id === chatId);
    if (!c) return 'Chat';
    if (c.isSaved) return 'Saved Messages';
    return chatPartner(c, me, profile, liveUsers).name;
  };

  if (isDesktop) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-surface-2 flex items-center justify-center">
            <span className="text-4xl">💬</span>
          </div>
          <h3 className="text-lg font-bold text-text-primary mb-2">Select a chat</h3>
          <p className="text-sm">Choose a conversation from the left panel</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 lg:pb-0 bg-bg-dark">
      {/* Share target: something was shared into Vergr from another app and is
          waiting for a chat to land in. Tell the user what to do — otherwise
          the app just opens on the inbox for no visible reason. */}
      {pendingShare && (
        <div className="sticky top-0 z-50 flex items-center gap-2 px-4 py-2.5 bg-brand-violet/15 border-b border-brand-violet/30">
          <Icon name="reply" size={16} className="text-brand-violet-light shrink-0 scale-x-[-1]" />
          <p className="text-[12px] text-text-primary flex-1 min-w-0 truncate">
            Pick a chat to share into: <span className="text-text-muted">{pendingShare}</span>
          </p>
          <button
            onClick={() => { clearSharedText(); clearSharedMedia(); setPendingShare(''); }}
            className="text-[11px] font-bold text-text-muted hover:text-white shrink-0"
          >
            Cancel
          </button>
        </div>
      )}
      {/* Sticky header with search (mobile only) */}
      <header className="sticky top-0 z-40 glass-header" style={IS_NATIVE_BUILD ? { paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' } : undefined}>
        <div className="flex items-center justify-between px-4 h-[52px]">
          <div className="flex items-center gap-2">
            <button onClick={() => setMenuOpen(true)} className="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors" aria-label="Messages menu">
              <Icon name="menu" size={22} />
            </button>
            <h1 className="font-syne text-[17px] font-bold text-text-primary">Messages</h1>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate('/messages/calls')}
              className="w-9 h-9 rounded-full flex items-center justify-center text-text-muted hover:text-text-secondary transition-colors"
              title="Call History"
            >
              <Icon name="call" size={20} />
            </button>
            <button
              onClick={() => navigate('/messages/requests')}
              className="w-9 h-9 rounded-full flex items-center justify-center text-text-muted hover:text-text-secondary transition-colors relative"
              title="Message Requests"
            >
              <Icon name="mail" size={20} />
            </button>
            <button
              onClick={() => navigate('/messages/create-group')}
              className="w-9 h-9 rounded-full flex items-center justify-center text-text-muted hover:text-text-secondary transition-colors"
              title="New Group Chat"
            >
              <Icon name="group_add" size={20} />
            </button>
            <button
              onClick={() => navigate('/messages/new')}
              className="w-9 h-9 rounded-full flex items-center justify-center text-text-muted hover:text-text-secondary transition-colors"
              title="New Message"
            >
              <Icon name="edit_square" size={20} />
            </button>
          </div>
        </div>

        {/* Search bar inside sticky header */}
        <div className="px-4 pb-2">
          <label className="block relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
              <Icon name="search" size={18} />
            </div>
            <input
              type="text" placeholder="Search conversations..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full bg-surface-2 border border-white/[0.06] rounded-xl py-2.5 pl-9 pr-4 text-text-primary text-sm focus:border-brand-violet transition-colors outline-none"
            />
          </label>
        </div>
        {/* Folder tabs (Telegram-style, incl. custom folders) */}
        <div className="px-2 border-b border-white/[0.05]">
          <InboxFolderTabs active={activeFolder} onChange={setActiveFolder} counts={folderCounts}
            customFolders={customFolders}
            onCreateFolder={() => { setFolderToEdit(null); setFolderEditorOpen(true); }}
            onEditFolder={(f) => { setFolderToEdit(f); setFolderEditorOpen(true); }} />
        </div>

      </header>

      {/* Cloned-community rejoin net (renders nothing without offers) */}
      <DiscordRejoinPrompt />

      {/* Conversation list */}
      <div className="mt-1">
        {loading ? (
          <ListSkeleton rows={6} />
        ) : (
          <div>
            {/* Saved Messages (self-chat, Telegram-style) */}
            <button
              onClick={openSaved}
              className="w-full flex items-center gap-3.5 px-4 py-3 text-left border-b border-white/[0.04] hover:bg-surface-1/40"
            >
              <div className="w-[52px] h-[52px] rounded-full bg-brand-violet/15 border border-brand-violet/30 flex items-center justify-center shrink-0">
                <Icon name="bookmark" size={22} className="text-brand-violet-light" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-[15px] text-text-primary">Saved Messages</h3>
                <p className="text-sm text-text-muted truncate">Notes, links and files only you can see</p>
              </div>
            </button>

            {/* Archived section (collapsed row, WhatsApp-style) */}
            {archived.length > 0 && (
              <>
                <button
                  onClick={() => setShowArchived(s => !s)}
                  className="w-full flex items-center gap-3.5 px-4 py-3 text-left border-b border-white/[0.04] hover:bg-surface-1/40"
                >
                  <div className="w-[52px] h-[52px] rounded-full bg-surface-1 flex items-center justify-center shrink-0">
                    <Icon name="archive" size={22} className="text-text-muted" />
                  </div>
                  <span className="flex-1 font-bold text-[15px] text-text-primary">Archived</span>
                  <span className="text-[11px] text-text-muted font-dmmono">{archived.length}</span>
                  <Icon name={showArchived ? 'expand_less' : 'expand_more'} size={18} className="text-text-muted" />
                </button>
                {showArchived && archived.map(conv => (
                  <InboxRow key={conv.id} conv={conv} me={me} navigate={navigate} liveUsers={liveUsers} viewerProfile={profile} archivedView />
                ))}
              </>
            )}

            {/* Direct Messages */}
            {view.dms && (dmRows.length > 0 || activeFolder === 'all') && (
              <>
                <SectionHeader label="Direct Messages" count={dmRows.length} collapsed={collapsed.dms}
                  onToggle={() => toggleSection('dms')} onAdd={() => navigate('/messages/new')} addTitle="New direct message" />
                {!collapsed.dms && (dmRows.length > 0 ? (
                  dmRows.map(conv => <InboxRow key={conv.id} conv={conv} me={me} navigate={navigate} liveUsers={liveUsers} viewerProfile={profile} />)
                ) : activeFolder === 'all' ? (
                  <button onClick={() => navigate('/messages/new')} className="w-full text-left px-4 py-3 text-text-muted text-sm hover:bg-surface-1/40">+ Start a conversation</button>
                ) : null)}
              </>
            )}

            {/* Groups */}
            {view.groups && (groupRows.length > 0 || activeFolder === 'all') && (
              <>
                <SectionHeader label="Groups" count={groupRows.length} collapsed={collapsed.groups}
                  onToggle={() => toggleSection('groups')} onAdd={() => navigate('/messages/create-group')} addTitle="New group" />
                {!collapsed.groups && (groupRows.length > 0 ? (
                  groupRows.map(conv => <InboxRow key={conv.id} conv={conv} me={me} navigate={navigate} liveUsers={liveUsers} viewerProfile={profile} />)
                ) : activeFolder === 'all' ? (
                  <button onClick={() => navigate('/messages/create-group')} className="w-full text-left px-4 py-3 text-text-muted text-sm hover:bg-surface-1/40">+ Create a group</button>
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
                    <button onClick={() => { setFolderToEdit(customFolders.find(f => f.id === activeFolder)); setFolderEditorOpen(true); }}
                      className="mt-2 text-brand-violet-light font-bold">Add chats</button>
                  </>
                ) : 'Nothing here yet.'}
              </div>
            )}

            {/* Voice Channels */}
            {view.voice && (
            <>
            <SectionHeader label="Voice Channels" count={voiceChannels.length} collapsed={collapsed.voice}
              onToggle={() => toggleSection('voice')} onAdd={() => setShowCreateVoice(true)} addTitle="Create voice channel" />
            {!collapsed.voice && (voiceChannels.length > 0 ? (
              voiceChannels.map(v => {
                const inChannel = activeVoiceMembers(v);
                return (
                  <button
                    key={v.id}
                    onClick={() => navigate(`/messages/voice/${v.id}`)}
                    className="w-full flex items-center gap-3.5 px-4 py-3 text-left border-b border-white/[0.04] hover:bg-surface-1/40"
                  >
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
              <button onClick={() => setShowCreateVoice(true)} className="w-full text-left px-4 py-3 text-text-muted text-sm hover:bg-surface-1/40">+ Create a voice channel</button>
            ))}
            </>
            )}

            {/* Global message search results (Dexie, all chats) */}
            {msgResults.length > 0 && (
              <div className="mt-2">
                <div className="px-4 py-2 text-[10px] font-dmmono uppercase tracking-[0.16em] text-text-muted border-b border-white/[0.04]">
                  Messages · {msgResults.length}
                </div>
                {msgResults.map(r => (
                  <button
                    key={`${r.chatId}_${r.id}`}
                    onClick={() => navigate(`/messages/${r.chatId}?msg=${encodeURIComponent(r.id)}`)}
                    className="w-full flex flex-col gap-0.5 px-4 py-3 text-left border-b border-white/[0.04] hover:bg-surface-1/40"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-bold text-text-primary truncate">{chatNameOf(r.chatId)}</span>
                      <span className="text-[10px] text-text-muted shrink-0">
                        {r.createdAt?.toDate ? timeAgo(r.createdAt.toDate()) : ''}
                      </span>
                    </div>
                    <span className="text-sm text-text-muted truncate">{r.text}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* FAB for new message (mobile only) */}
      <button 
        onClick={() => navigate('/messages/new')}
        className="fixed bottom-24 right-5 lg:bottom-6 lg:right-6 w-14 h-14 rounded-full bg-brand-violet text-white flex items-center justify-center z-30 shadow-lg shadow-brand-violet/30 hover:brightness-110 active:scale-95 transition-all"
        aria-label="Start new chat"
      >
        <Icon name="edit" size={22} />
      </button>

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
    </div>
  );
}

// Collapsible section header (tap the label to fold the section; "+" stays a
// separate add action). Collapse state is remembered in localStorage.
function SectionHeader({ label, count, collapsed, onToggle, onAdd, addTitle }) {
  return (
    <div className="flex items-center justify-between px-4 pt-4 pb-1">
      <button onClick={onToggle} className="flex items-center gap-1.5 text-text-muted hover:text-text-primary transition-colors" title={collapsed ? 'Expand' : 'Collapse'}>
        <Icon name={collapsed ? 'chevron_right' : 'expand_more'} size={16} />
        <span className="text-[10px] font-dmmono uppercase tracking-[0.16em]">{label}</span>
        {count > 0 && <span className="text-[10px] font-dmmono text-text-muted/50">{count}</span>}
      </button>
      <button onClick={onAdd} className="text-text-muted hover:text-text-primary" title={addTitle}><Icon name="add" size={18} /></button>
    </div>
  );
}

function InboxRow({ conv, me, navigate, liveUsers, viewerProfile, archivedView = false }) {
  // One shared resolver for every chat surface (see chatIdentity.chatPartner).
  const displayData = chatPartner(conv, me, viewerProfile, liveUsers);
  const otherId = displayData.otherId;
  const tier = !conv.isGroup ? getTier(displayData.coinsSpent || 0) : null;
  const unread = conv.unreadCount?.[me] || 0;
  const mentioned = !!conv.mentions?.[me]; // group @mention awaiting open
  const { isOnline: otherOnline } = useOnlineStatus(!conv.isGroup ? otherId : null);
  const isOnline = !conv.isGroup && otherOnline;
  const pinned = isChatPinnedFor(conv, me);
  // Live "typing…" — typingUsers rides the conversation doc, so this is free.
  // freshTypers drops stale ghosts (backgrounded-WebView never cleared them).
  const typers = freshTypers(conv.typingUsers, me);

  return (
    <SwipeableRow
      rightIcon={pinned ? 'keep_off' : 'keep'} rightLabel={pinned ? 'Unpin' : 'Pin'}
      leftIcon={archivedView ? 'unarchive' : 'archive'} leftLabel={archivedView ? 'Unarchive' : 'Archive'}
      onSwipeRight={() => setChatPinned(conv.id, !pinned).catch(() => {})}
      onSwipeLeft={() => setChatArchived(conv.id, !archivedView).catch(() => {})}
    >
      <button
        onClick={() => navigate(`/messages/${conv.id}`)}
        className={`w-full flex items-center gap-3.5 px-4 py-3.5 transition-all text-left group border-b border-white/[0.04] ${
          unread > 0 ? 'bg-brand-violet/[0.02]' : 'hover:bg-surface-1/40'
        }`}
      >
        {/* `flex` matters: UserAvatar is inline-flex, so a block wrapper adds a
            baseline descender gap under it and the online dot (bottom-anchored)
            lands BELOW the avatar instead of on its edge. */}
        <div
          className="relative cursor-pointer shrink-0 flex"
          onClick={(e) => {
            e.stopPropagation();
            if (!conv.isGroup && otherId) navigate(`/user/${otherId}`);
          }}
        >
          <UserAvatar
            src={displayData.avatar}
            size={52}
            tier={tier}
            isGroup={conv.isGroup}
          />
          {isOnline && (
            <div className="absolute bottom-0 right-0 z-20 w-3.5 h-3.5 bg-green-500 border-[2.5px] border-bg-dark rounded-full"  />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-baseline mb-0.5">
            <h3 className={`font-bold text-[15px] truncate tracking-tight ${
              unread > 0 ? 'text-white' : 'text-text-primary group-hover:text-white'
            }`}>
              {displayData.name}
            </h3>
            <span className={`text-[11px] ml-2 shrink-0 flex items-center gap-1 ${
              unread > 0 ? 'text-brand-violet-light font-bold' : 'text-text-muted'
            }`}>
              {pinned && <Icon name="keep" size={12} className="text-text-muted" />}
              {conv.lastMessageAt ? timeAgo(conv.lastMessageAt.toDate()) : ''}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {conv.lastMessageSenderId === me && (
                <Icon name="done_all" size={14} className="text-brand-violet-light/50 shrink-0" />
              )}
              {typers.length > 0 ? (
                <p className="text-sm truncate leading-none text-brand-violet-light animate-pulse">
                  {conv.isGroup ? `${typers[0].name || 'Someone'} is typing…` : 'typing…'}
                </p>
              ) : (
                <p className={`text-sm truncate leading-none ${
                  unread > 0 ? 'text-text-secondary font-medium' : 'text-text-muted'
                }`}>
                  {conv.lastMessageText || 'Tap to chat'}
                </p>
              )}
            </div>
            {mentioned && (
              <span className="w-[22px] h-[22px] bg-brand-violet rounded-full flex items-center justify-center text-[12px] text-white font-black shrink-0" title="You were mentioned">
                @
              </span>
            )}
            {unread > 0 && (
              <span className="min-w-[22px] h-[22px] bg-brand-violet rounded-full flex items-center justify-center text-[11px] text-white font-black px-1.5 shrink-0 ">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </div>
        </div>
      </button>
    </SwipeableRow>
  );
}