// Messaging left panel — restyled per the design mock.
// Splits conversations into DIRECT MESSAGES and GROUPS with Discord-style
// section headers. Compact 280px width to match the new 3-col layout.
import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ListSkeleton, StackSkeleton } from './skeletons/GlassSkeletons';
import { auth } from '../firebase/config';
import { useNotifications } from '../context/NotificationContext';
import { useLiveUsers } from '../context/LiveUsersContext';
import { useUser } from '../context/UserContext';
import {
  subscribeToUserVoiceChannels, ensureSavedMessages,
  getFollowing, getFollowers, searchUsers, createConversation,
  updateUserSettings,
} from '../firebase/firestore';
import InboxFolderTabs, { computeFolderView } from './messages/InboxFolderTabs';
import DiscordRejoinPrompt from './messages/DiscordRejoinPrompt';
import ChatFolderEditor from './messages/ChatFolderEditor';
import { useUI } from '../context/UIContext';
import { resolveChatUsers, chatPartner, peekChatUser } from '../utils/chatIdentity';
import TypingIndicator from './TypingIndicator';
import {
  isChatMutedFor, isChatPinnedFor, setChatPinned,
  isChatArchivedFor, setChatArchived, sortInboxChats,
} from '../utils/chatOps';
import { getDraft } from '../utils/chatDrafts';
import { freshTypers } from '../utils/typingFresh';
import { activeVoiceMembers } from '../utils/voiceSession';
import useGlobalChatSearch from '../hooks/useGlobalChatSearch';
import UserAvatar from './UserAvatar';
import Icon from './Icon';
import CreateVoiceChannelModal from './CreateVoiceChannelModal';
import CreateGroupModal from './messages/CreateGroupModal';
import { timeAgo, getTier } from '../utils/helpers';
import useOnlineStatus from '../hooks/useOnlineStatus';
import {
  subscribeOfficialChannels, subscribeChannelState, buildOfficialRows,
  setChannelPinned, setChannelArchived, resolveChannelTarget, syncChannelPushSubscriptions,
} from '../firebase/officialChannels';
import { getPushToken } from '../utils/pushNotifications';
import UserName from './UserName';

export default function MessagesListPanel({ hideSearch = false }) {
  const { conversations } = useNotifications();
  const { profile } = useUser();
  const loading = !conversations;
  const [search, setSearch] = useState('');
  const [voiceChannels, setVoiceChannels] = useState([]);
  const [showCreateVoice, setShowCreateVoice] = useState(false);
  const [showNewDm, setShowNewDm] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [dmsCollapsed, setDmsCollapsed] = useState(false);
  const [activeFolder, setActiveFolder] = useState('all');
  const [folderEditorOpen, setFolderEditorOpen] = useState(false);
  const [folderToEdit, setFolderToEdit] = useState(null);
  // Official Vergr channels. This DESKTOP panel is what /messages actually
  // renders on a wide screen, and it had no channel support at all: channels
  // created in admin were invisible here while the mobile and native inboxes
  // showed them. Same helpers, same synthetic row shape, so every filter,
  // sort and folder below treats them as ordinary chats.
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
    if (!uid || !officialChannels.length) return;
    const token = getPushToken();
    if (token) syncChannelPushSubscriptions(officialChannels, channelState, token).catch(() => {});
  }, [officialChannels, channelState]);
  // Live identity map (uid → user doc). The conversation `metadata` snapshot
  // is taken ONCE at creation and never updated — stale names/avatars forever
  // and no @username. Resolve live docs instead (module-level TTL cache).
  const [liveUsers, setLiveUsers] = useState({});
  const navigate = useNavigate();
  const location = useLocation();

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

  // Live-subscribe to the current user's voice channels (owner OR invited).
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const unsub = subscribeToUserVoiceChannels(uid, setVoiceChannels);
    return () => unsub();
  }, []);

  const meUid = auth.currentUser?.uid;

  // Where a row goes when clicked. An official channel is not a conversation
  // id: support opens the user's own thread, community opens the room, a
  // broadcast opens the channel thread, so the destination is resolved.
  const openRow = async (conv) => {
    if (!conv.isOfficial) { navigate(`/messages/${conv.id}`); return; }
    try {
      const path = await resolveChannelTarget(conv);
      if (path) navigate(path);
    } catch {
      navigate(`/messages/c/${conv.channelId}`);
    }
  };

  // Channels are merged in BEFORE the search and folder filters so they behave
  // as ordinary chats from here down: searchable by name, sortable by recency,
  // pinnable and archivable through the same helpers.
  const officialRows = buildOfficialRows(officialChannels, channelState, meUid, profile);
  // "Vergr Support" appeared TWICE, under two headings (audit A36): once as the
  // synthetic official channel row and again under GROUPS, because the ticket
  // resolveSupportChannel provisions is a real group conversation. Same name,
  // same call to action, and no way to tell which one reaches a human.
  //
  // Once a real ticket exists it is the row that matters: it carries the unread
  // count and the actual last message, while the synthetic row cannot. So the
  // official row is the entry point only UNTIL the thread exists, then it steps
  // aside. Keeping the synthetic one instead would have made users miss replies.
  const hasSupportThread = (conversations || []).some(c => c.supportThread === true);
  const visibleOfficial = hasSupportThread
    ? officialRows.filter(r => r.kind !== 'support')
    : officialRows;
  const allChats = [...visibleOfficial, ...(conversations || [])];

  const filtered = search
    ? allChats.filter(c => {
        const { name, username } = chatPartner(c, auth.currentUser?.uid, profile, liveUsers);
        const q = search.toLowerCase();
        return name?.toLowerCase().includes(q) || username.toLowerCase().includes(q);
      })
    : allChats;

  // Saved Messages renders as its own static row (created lazily on first
  // open) — keep the convo doc out of the DM list.
  const visible = filtered.filter(c => !c.isSaved);
  // Archived chats collapse into their own section; active lists are
  // pinned-first then most-recent.
  const archived = sortInboxChats(visible.filter(c => isChatArchivedFor(c, meUid)), meUid);
  const active   = visible.filter(c => !isChatArchivedFor(c, meUid));
  // A support ticket is technically a group, but it is not one to the user, and
  // listing it under GROUPS is what produced the duplicate. It belongs with the
  // official channel row it replaces, in DIRECT MESSAGES.
  const groups = sortInboxChats(active.filter(c => c.isGroup && c.supportThread !== true), meUid);
  const dms    = sortInboxChats(active.filter(c => !c.isGroup || c.supportThread === true), meUid);
  // Folder tabs (Telegram-style, incl. user custom folders) — same
  // settings.chatFolders store as the mobile inbox, so folders sync across
  // desktop/mobile. Scopes which sections show + unread + hand-picked chat set.
  const customFolders = profile?.settings?.chatFolders || [];
  const view = computeFolderView(activeFolder, customFolders);
  const isUnread = c => (c.unreadCount?.[meUid] || 0) > 0;
  const inFolder = c => !view.ids || view.ids.has(c.id);
  const dmRows    = (view.unreadOnly ? dms.filter(isUnread) : dms).filter(inFolder);
  const groupRows = (view.unreadOnly ? groups.filter(isUnread) : groups).filter(inFolder);
  const folderCounts = { unread: active.filter(isUnread).length };
  for (const f of customFolders) {
    const ids = new Set(f.chatIds || []);
    folderCounts[f.id] = active.filter(c => ids.has(c.id) && isUnread(c)).length;
  }
  const saveFolder = async (folder) => {
    const list = profile?.settings?.chatFolders || [];
    const next = list.some(f => f.id === folder.id) ? list.map(f => f.id === folder.id ? folder : f) : [...list, folder];
    try { await updateUserSettings(meUid, { chatFolders: next }); setActiveFolder(folder.id); }
    catch (e) { console.error('Save folder failed:', e); }
    setFolderEditorOpen(false);
  };
  const deleteFolder = async (id) => {
    const next = (profile?.settings?.chatFolders || []).filter(f => f.id !== id);
    try { await updateUserSettings(meUid, { chatFolders: next }); } catch (e) { console.error('Delete folder failed:', e); }
    if (activeFolder === id) setActiveFolder('all');
    setFolderEditorOpen(false);
  };
  const openSaved = async () => {
    try { const id = await ensureSavedMessages(); if (id) navigate(`/messages/${id}`); }
    catch (e) { console.error('Saved Messages open failed:', e); }
  };

  // Global MESSAGE search: local Dexie hits paint instantly, then the relay's
  // server-side results merge in (they cover chats never opened on this device).
  const { results: msgResults, searching } = useGlobalChatSearch(search);

  const chatNameOf = (chatId) => {
    const c = (conversations || []).find(x => x.id === chatId);
    if (!c) return 'Chat';
    if (c.isSaved) return 'Saved Messages';
    return chatPartner(c, meUid, profile, liveUsers).name;
  };
  const [showArchived, setShowArchived] = useState(false);

  if (loading) {
    return <ListSkeleton rows={6} />;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header: title + quick actions */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-syne text-lg font-extrabold tracking-tight text-text-primary">Messages</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate('/messages/calls')}
              className="w-8 h-8 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-text-primary flex items-center justify-center"
              title="Call history"
            >
              <Icon name="call" size={16} />
            </button>
            <button
              onClick={() => navigate('/messages/new')}
              className="w-8 h-8 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-text-primary flex items-center justify-center"
              title="New message"
            >
              <Icon name="edit_square" size={16} />
            </button>
            <button
              onClick={() => setShowCreateGroup(true)}
              className="w-8 h-8 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-text-primary flex items-center justify-center"
              title="New group"
            >
              <Icon name="group_add" size={16} />
            </button>
          </div>
        </div>

        {!hideSearch && (
          <label className="relative block">
            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-text-muted">
              <Icon name="search" size={15} />
            </div>
            <input
              type="text"
              placeholder="Search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg py-1.5 pl-8 pr-3 text-text-primary text-xs focus:border-brand-violet/40 outline-none"
            />
          </label>
        )}

        {/* Folder tabs (All / Unread / DMs / Groups + custom folders). Synced
            with mobile via settings.chatFolders. */}
        <div className="mt-2 -mx-0">
          <InboxFolderTabs active={activeFolder} onChange={setActiveFolder} counts={folderCounts}
            customFolders={customFolders}
            onCreateFolder={() => { setFolderToEdit(null); setFolderEditorOpen(true); }}
            onEditFolder={(f) => { setFolderToEdit(f); setFolderEditorOpen(true); }} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-2 pb-4">
        {/* Cloned-community rejoin net (renders nothing without offers) */}
        <DiscordRejoinPrompt />
        {/* Quick links (Browse Groups / Friends / Requests) were duplicated
            with the left sidebar — removed here. Left sidebar is the single
            source of truth for those. */}

        {/* Saved Messages (self-chat, Telegram-style) */}
        <button
          onClick={openSaved}
          className={`w-full flex items-center gap-2.5 px-3 py-2 mt-2 rounded-lg text-left transition-colors ${
            location.pathname === `/messages/saved_${meUid}` ? 'bg-brand-violet/20 text-white' : 'text-text-secondary hover:bg-white/[0.04] hover:text-text-primary'
          }`}
        >
          <div className="w-[34px] h-[34px] rounded-full bg-brand-violet/15 border border-brand-violet/30 flex items-center justify-center shrink-0">
            <Icon name="bookmark" size={16} className="text-brand-violet-light" />
          </div>
          <span className="text-[13px] font-medium">Saved Messages</span>
        </button>

        {/* DMs */}
        {view.dms && (
        <div className="mt-4">
          <div className="px-3 pb-1 flex items-center justify-between">
            <button
              onClick={() => setDmsCollapsed(c => !c)}
              className="flex items-center gap-1 text-text-muted hover:text-text-primary"
              title={dmsCollapsed ? 'Expand' : 'Collapse'}
            >
              <Icon name={dmsCollapsed ? 'chevron_right' : 'expand_more'} size={14} />
              <span className="text-[9px] font-dmmono uppercase tracking-[0.18em]">Direct Messages</span>
            </button>
            <button
              onClick={() => setShowNewDm(true)}
              className="text-text-muted hover:text-text-primary"
              title="New direct message"
            >
              <Icon name="add" size={14} />
            </button>
          </div>
          {!dmsCollapsed && (
            dmRows.length > 0 ? (
              <div className="space-y-0.5">
                {dmRows.map(conv => <DmRow key={conv.id} conv={conv} liveUsers={liveUsers} viewerProfile={profile} active={location.pathname === `/messages/${conv.id}`} onClick={() => openRow(conv)} />)}
              </div>
            ) : (activeFolder === 'all' || activeFolder === 'dms') ? (
              <button
                onClick={() => setShowNewDm(true)}
                className="w-full px-3 py-2 rounded-lg text-text-muted/70 hover:bg-white/[0.03] hover:text-text-secondary text-[12px] text-left"
              >
                + Start a conversation
              </button>
            ) : null
          )}
        </div>
        )}

        {/* Groups */}
        {view.groups && groupRows.length > 0 && (
          <div className="mt-4">
            <div className="px-3 pb-1 flex items-center justify-between">
              <span className="text-[9px] font-dmmono uppercase tracking-[0.18em] text-text-muted">Groups</span>
              <button
                onClick={() => setShowCreateGroup(true)}
                className="text-text-muted hover:text-text-primary"
                title="New group"
              >
                <Icon name="add" size={14} />
              </button>
            </div>
            <div className="space-y-0.5">
              {groupRows.map(conv => <GroupRow key={conv.id} conv={conv} active={location.pathname === `/messages/${conv.id}`} onClick={() => openRow(conv)} />)}
            </div>
          </div>
        )}

        {/* Filtered folder with no matching chats. Custom → prompt to add
            chats; built-in (Unread) → "all caught up". */}
        {activeFolder !== 'all' && activeFolder !== 'dms' && dmRows.length === 0 && groupRows.length === 0 && (
          <div className="mt-6 text-center px-4">
            <Icon name={view.ids ? 'folder_open' : 'mark_chat_read'} size={32} className="text-text-muted/30 mx-auto mb-2" />
            {view.ids ? (
              <>
                <p className="text-text-muted text-xs mb-2">This folder is empty</p>
                <button
                  onClick={() => { setFolderToEdit(customFolders.find(f => f.id === activeFolder)); setFolderEditorOpen(true); }}
                  className="text-brand-violet-light text-xs font-bold hover:underline"
                >
                  Add chats
                </button>
              </>
            ) : (
              <p className="text-text-muted text-xs">You're all caught up</p>
            )}
          </div>
        )}

        {/* Archived */}
        {archived.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowArchived(s => !s)}
              className="w-full px-3 pb-1 flex items-center justify-between text-left"
            >
              <span className="text-[9px] font-dmmono uppercase tracking-[0.18em] text-text-muted">Archived · {archived.length}</span>
              <Icon name={showArchived ? 'expand_less' : 'expand_more'} size={14} className="text-text-muted" />
            </button>
            {showArchived && (
              <div className="space-y-0.5">
                {archived.map(conv => conv.isGroup
                  ? <GroupRow key={conv.id} conv={conv} archivedView active={location.pathname === `/messages/${conv.id}`} onClick={() => openRow(conv)} />
                  : <DmRow key={conv.id} conv={conv} archivedView liveUsers={liveUsers} viewerProfile={profile} active={location.pathname === `/messages/${conv.id}`} onClick={() => openRow(conv)} />)}
              </div>
            )}
          </div>
        )}

        {/* Global message search results */}
        {msgResults.length > 0 && (
          <div className="mt-4">
            <div className="px-3 pb-1 flex items-center gap-1.5">
              <span className="text-[9px] font-dmmono uppercase tracking-[0.18em] text-text-muted">Messages · {msgResults.length}</span>
              {searching && <span className="text-[9px] text-text-muted/60">searching…</span>}
            </div>
            <div className="space-y-0.5">
              {msgResults.map(r => (
                <button
                  key={`${r.chatId}_${r.id}`}
                  onClick={() => navigate(`/messages/${r.chatId}?msg=${encodeURIComponent(r.id)}`)}
                  className="w-full flex flex-col gap-0.5 px-3 py-2 rounded-lg text-left text-text-secondary hover:bg-white/[0.04] hover:text-text-primary"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] font-semibold truncate">{chatNameOf(r.chatId)}</span>
                    <span className="text-[9px] text-text-muted shrink-0">{r.createdAt?.toDate ? timeAgo(r.createdAt.toDate()) : ''}</span>
                  </div>
                  <span className="text-[11px] text-text-muted truncate">{r.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {dms.length === 0 && groups.length === 0 && archived.length === 0 && msgResults.length === 0 && (
          <div className="py-12 text-center px-4">
            <Icon name="chat_bubble_outline" size={36} className="text-text-muted/30 mx-auto mb-2" />
            <p className="text-text-muted text-xs">{search ? 'No matches' : 'No conversations yet'}</p>
          </div>
        )}

        {/* Voice channels — user-created rooms. Owner or invited members
            see them here. Clicking joins the SFU room. Hidden in filtered
            folders (voice belongs to the "All" view). */}
        {view.voice && (
        <div className="mt-5">
          <div className="px-3 pb-1 flex items-center justify-between">
            <span className="text-[9px] font-dmmono uppercase tracking-[0.18em] text-text-muted">Voice Channels</span>
            <button
              onClick={() => setShowCreateVoice(true)}
              className="text-text-muted hover:text-text-primary"
              title="Create voice channel"
            >
              <Icon name="add" size={14} />
            </button>
          </div>
          {voiceChannels.length === 0 ? (
            <button
              onClick={() => setShowCreateVoice(true)}
              className="w-full px-3 py-2 rounded-lg text-text-muted/70 hover:bg-white/[0.03] hover:text-text-secondary text-[12px] text-left"
            >
              + Create a voice channel
            </button>
          ) : (
            <div className="space-y-0.5">
              {voiceChannels.map(v => {
                const active = location.pathname === `/messages/voice/${v.id}`;
                // Presence: `active.{uid}=ms` heartbeated by voiceSession;
                // stale (>2min) entries are ignored.
                const inChannel = activeVoiceMembers(v);
                return (
                  <button
                    key={v.id}
                    onClick={() => navigate(`/messages/voice/${v.id}`)}
                    className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-left transition-colors text-[13px] ${
                      active
                        ? 'bg-brand-violet/20 text-white'
                        : 'text-text-muted hover:bg-white/[0.04] hover:text-text-primary'
                    }`}
                  >
                    <Icon name={v.visibility === 'private' ? 'lock' : 'volume_up'} size={15} />
                    <span className="flex-1 truncate">{v.name}</span>
                    {inChannel.length > 0 && (
                      <span className="flex items-center gap-1 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                        <span className="text-[10px] font-dmmono text-green-400">{inChannel.length}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        )}
      </div>

      {showCreateVoice && (
        <CreateVoiceChannelModal onClose={() => setShowCreateVoice(false)} />
      )}
      {showNewDm && <NewDmModal onClose={() => setShowNewDm(false)} />}
      {showCreateGroup && <CreateGroupModal onClose={() => setShowCreateGroup(false)} />}
      {folderEditorOpen && (
        <ChatFolderEditor
          folder={folderToEdit}
          conversations={active}
          liveUsers={liveUsers}
          viewerProfile={profile}
          me={meUid}
          onSave={saveFolder}
          onDelete={deleteFolder}
          onClose={() => setFolderEditorOpen(false)}
        />
      )}
    </div>
  );
}

// New-DM popup: searchable user picker (your network first, then username
// search). Picking a user opens/creates the 1:1 conversation.
function NewDmModal({ onClose }) {
  const navigate = useNavigate();
  const { showToast } = useUI();
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState([]);   // your follows + followers
  const [results, setResults] = useState(null); // username search results
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = auth.currentUser.uid;
        const [following, followers] = await Promise.all([getFollowing(me), getFollowers(me)]);
        const ids = [
          ...following.map(f => f.followingId),
          ...followers.map(f => f.followerId),
        ].filter(id => id && id !== me);
        const profiles = await resolveChatUsers(ids);
        if (alive) setPeople(Object.entries(profiles).map(([uid, u]) => ({ uid, ...u })));
      } catch { /* ignore */ }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); return; }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await searchUsers(q);
        if (alive) setResults((res || []).filter(u => (u.uid || u.id) !== auth.currentUser.uid).map(u => ({ uid: u.uid || u.id, ...u })));
      } catch { if (alive) setResults([]); }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  const start = async (user) => {
    if (busyId) return;
    setBusyId(user.uid);
    try {
      const convoId = await createConversation(auth.currentUser.uid, { id: user.uid, ...user });
      onClose();
      navigate(`/messages/${convoId}`);
    } catch (err) {
      showToast(err?.message || 'Could not start chat', 'error');
      setBusyId(null);
    }
  };

  const list = results !== null ? results : people;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 pt-[12vh]"
    >
      <div className="w-full max-w-md rounded-2xl bg-surface-1 border border-white/[0.08] overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="font-syne text-lg font-extrabold text-text-primary">New message</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><Icon name="close" size={20} /></button>
        </div>
        <div className="px-5 pb-3">
          <label className="relative block">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
              <Icon name="search" size={16} />
            </div>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name or @username…"
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg py-2.5 pl-9 pr-3 text-text-primary text-sm outline-none focus:border-brand-violet/40"
            />
          </label>
        </div>
        <div className="max-h-[50vh] overflow-y-auto no-scrollbar px-2 pb-3">
          {loading && results === null && <p className="text-text-muted text-xs px-3 py-3">Loading your people…</p>}
          {!loading && list.length === 0 && (
            <p className="text-text-muted text-xs px-3 py-3">
              {results !== null ? 'No users found.' : 'Follow some players, or search by username above.'}
            </p>
          )}
          {list.map(u => (
            <button
              key={u.uid}
              onClick={() => start(u)}
              disabled={!!busyId}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/[0.04] text-left disabled:opacity-50"
            >
              <UserAvatar src={u.avatar} size={40} />
              <div className="flex-1 min-w-0">
                <p className="text-text-primary font-bold text-sm truncate">{/* `u.name` is the legacy shape some member rows still carry. UserName tries
    username before reaching the fallback, which is a better answer than
    "Member" whenever a handle exists. */}
<UserName user={u} masked fallback={u.name || 'Member'} /></p>
                {u.username && <p className="text-text-muted text-xs truncate"><UserName user={u} masked handle /></p>}
              </div>
              {busyId === u.uid && <Icon name="hourglass_top" size={16} className="text-text-muted" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Hover ⋮ menu: pin/unpin + archive/unarchive (desktop has no swipe gesture).
function RowActions({ conv, archivedView }) {
  const [open, setOpen] = useState(false);
  const me = auth.currentUser?.uid;
  const pinned = isChatPinnedFor(conv, me);
  const official = !!conv.isOfficial;
  return (
    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-white/[0.08] transition-opacity ${open ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'}`}
        title="Chat options"
      >
        <Icon name="more_vert" size={15} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-7 z-50 w-36 bg-surface-1 border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden">
            {/* An official row has a synthetic id (`official:<channelId>`) and no
                conversation document behind it, so pin and archive must go to the
                channel helpers. Calling setChatPinned here would write to a
                conversation that does not exist and silently do nothing. */}
            <button
              onClick={() => {
                (official
                  ? setChannelPinned(me, conv.channelId, !pinned)
                  : setChatPinned(conv.id, !pinned)).catch(() => {});
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] text-text-primary hover:bg-surface-2"
            >
              <Icon name={pinned ? 'keep_off' : 'keep'} size={14} className="text-text-secondary" />
              {pinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              onClick={() => {
                (official
                  ? setChannelArchived(me, conv.channelId, !archivedView)
                  : setChatArchived(conv.id, !archivedView)).catch(() => {});
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] text-text-primary hover:bg-surface-2 border-t border-white/[0.04]"
            >
              <Icon name={archivedView ? 'unarchive' : 'archive'} size={14} className="text-text-secondary" />
              {archivedView ? 'Unarchive' : 'Archive'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function DmRow({ conv, active, onClick, liveUsers, viewerProfile, archivedView = false }) {
  const { isUserLive } = useLiveUsers();
  const me = auth.currentUser?.uid;
  // chatPartner reads the persisted identity cache synchronously, so the first
  // paint after a refresh already shows the real name/avatar rather than the
  // frozen conversation snapshot.
  const { otherId, name, username: uname, avatar, coinsSpent } = chatPartner(conv, me, viewerProfile, liveUsers);
  const tier = getTier(coinsSpent || 0);
  const unread = conv.unreadCount?.[me] || 0;
  const { isOnline: online } = useOnlineStatus(otherId);
  const muted = isChatMutedFor(conv, me);
  const draft = !active ? getDraft(conv.id) : '';
  const typers = freshTypers(conv.typingUsers, me);
  const preview = conv.lastMessageText || conv.lastMessage || '';
  const when = conv.lastMessageAt?.toDate ? timeAgo(conv.lastMessageAt.toDate()) : '';
  const pinned = isChatPinnedFor(conv, me);
  const official = !!conv.isOfficial;
  return (
    <div
      role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
      className={`group/row w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer ${
        active ? 'bg-brand-violet/20 text-white' : 'text-text-secondary hover:bg-white/[0.04] hover:text-text-primary'
      }`}
    >
      {/* `flex`: UserAvatar is inline-flex, so a block wrapper leaves a baseline
          gap under it and the bottom-anchored online dot falls off the avatar. */}
      <div className="relative shrink-0 flex">
        <UserAvatar src={avatar} size={34} tier={tier} showTierRing={false} isLive={!official && isUserLive(otherId)} />
        {/* zIndex above the avatar image, which UserAvatar renders as
             and which would otherwise paint over this. */}
        {official && (
          <span
            className="absolute bottom-0 right-0 z-20 w-3 h-3 rounded-full flex items-center justify-center border-2 border-[#0B0E1A]"
            style={{ background: conv.accentColor || '#7B1FFF' }}
            title="Official Vergr channel"
          >
            <Icon name="verified" size={7} className="text-white" />
          </span>
        )}
        {!official && online && <span className="absolute bottom-0 right-0 z-20 w-2 h-2 rounded-full bg-green-500 border border-[#0B0E1A]" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`text-[13px] truncate ${unread > 0 ? 'text-white font-semibold' : ''}`}>{name}</span>
          <span className="flex items-center gap-1 shrink-0">
            {pinned && <Icon name="keep" size={11} className="text-text-muted/80" />}
            {when && <span className="text-[9px] text-text-muted">{when}</span>}
          </span>
        </div>
        <div className="flex items-center gap-1 min-w-0">
          {muted && <Icon name="notifications_off" size={11} className="text-text-muted/70 shrink-0" />}
          {typers.length > 0 ? (
            <TypingIndicator
              variant="inline"
              className="text-[11px] text-brand-violet-light"
              users={typers}
              typist={liveUsers?.[typers[0]?.uid] || peekChatUser(typers[0]?.uid)}
              label="typing…"
            />
          ) : draft ? (
            <span className="text-[11px] truncate"><span className="text-brand-ember font-semibold">Draft: </span><span className="text-text-muted">{draft}</span></span>
          ) : (
            <span className={`text-[11px] truncate ${unread > 0 ? 'text-text-secondary' : 'text-text-muted'}`}>
              {preview || uname}
            </span>
          )}
        </div>
      </div>
      {unread > 0 && (
        <span className={`min-w-[16px] h-4 rounded-full text-[9px] font-bold text-white flex items-center justify-center px-1 ${muted ? 'bg-surface-2 border border-white/10' : 'bg-brand-ember'}`}>
          {unread > 9 ? '9+' : unread}
        </span>
      )}
      <RowActions conv={conv} archivedView={archivedView} />
    </div>
  );
}

function GroupRow({ conv, active, onClick, archivedView = false }) {
  const me = auth.currentUser?.uid;
  const unread = conv.unreadCount?.[me] || 0;
  const mentioned = !!conv.mentions?.[me];
  const muted = isChatMutedFor(conv, me);
  const typers = freshTypers(conv.typingUsers, me);
  const preview = conv.lastMessageText || conv.lastMessage || '';
  const when = conv.lastMessageAt?.toDate ? timeAgo(conv.lastMessageAt.toDate()) : '';
  const pinned = isChatPinnedFor(conv, me);
  return (
    <div
      role="button" tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick(); }}
      className={`group/row w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer ${
        active ? 'bg-brand-violet/20 text-white' : 'text-text-secondary hover:bg-white/[0.04] hover:text-text-primary'
      }`}
    >
      <Icon name="tag" size={15} className="text-text-muted shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`text-[13px] truncate ${unread > 0 ? 'text-white font-semibold' : ''}`}>{conv.groupName || 'Group'}</span>
          <span className="flex items-center gap-1 shrink-0">
            {pinned && <Icon name="keep" size={11} className="text-text-muted/80" />}
            {when && <span className="text-[9px] text-text-muted">{when}</span>}
          </span>
        </div>
        {(typers.length > 0 || preview) && (
          <div className="flex items-center gap-1 min-w-0">
            {muted && <Icon name="notifications_off" size={11} className="text-text-muted/70 shrink-0" />}
            {typers.length > 0 ? (
              // Was a plain interpolated string, so a group row could never
              // show the typist's style. Same sentence, now with the glyph.
              <TypingIndicator
                variant="inline"
                className="text-[11px] text-brand-violet-light"
                users={typers}
                typist={peekChatUser(typers[0]?.uid)}
                label={`${typers[0].name || 'Someone'} is typing…`}
              />
            ) : (
              <span className={`text-[11px] truncate ${unread > 0 ? 'text-text-secondary' : 'text-text-muted'}`}>{preview}</span>
            )}
          </div>
        )}
      </div>
      {mentioned && (
        <span className="w-4 h-4 rounded-full bg-brand-violet text-white text-[10px] font-black flex items-center justify-center shrink-0" title="You were mentioned">@</span>
      )}
      {unread > 0 && (
        <span className={`min-w-[16px] h-4 rounded-full text-[9px] font-bold text-white flex items-center justify-center px-1 ${muted ? 'bg-surface-2 border border-white/10' : 'bg-brand-ember'}`}>
          {unread > 9 ? '9+' : unread}
        </span>
      )}
      <RowActions conv={conv} archivedView={archivedView} />
    </div>
  );
}
