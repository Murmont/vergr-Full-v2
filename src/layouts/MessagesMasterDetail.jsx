import { Outlet, useMatch, useSearchParams } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import useResponsive from '../hooks/useResponsive';
import DesktopSidebar from '../components/DesktopSidebar';
import BottomNav from '../components/BottomNav';
import MessagesListPanel from '../components/MessagesListPanel';
import ChatMembersRail from '../components/brand/ChatMembersRail';
import { ChatDetailsPanel } from '../screens/messages/ChatDetailScreen';
import { useLayout } from '../context/LayoutContext';
import { useNotifications } from '../context/NotificationContext';
import { useUI } from '../context/UIContext';
import { getUserById } from '../firebase/firestore';
import { publicUrl } from '../utils/publicUrl';

// Shape a conversation doc into the rail's member rows. Owner/admins are
// labeled so the rail's role buckets render; presence isn't tracked here so
// everyone shows offline until a presence source is wired. `profiles` is a
// uid->user cache: the LIVE profile wins over the conversation `metadata`
// snapshot, which is frozen at join time and goes stale when a member later
// renames or changes their avatar. Metadata is only the instant-render
// fallback while the profile is still loading.
function buildMembers(convo, profiles = {}) {
  if (!convo) return [];
  const meta = convo.metadata || {};
  const admins = convo.admins || [];
  return (convo.participants || []).map((uid) => {
    const m = meta[uid] || {};
    const p = profiles[uid] || {};
    const role = convo.createdBy === uid ? 'Owner' : admins.includes(uid) ? 'Admin' : 'Member';
    const name = p.displayName || p.username || m.name || 'Member';
    const avatar = p.avatar || p.photoURL || m.avatar || null;
    return { id: uid, name, avatar, role, online: false };
  });
}

export default function MessagesMasterDetail() {
  const { isDesktop } = useResponsive();
  const { showToast } = useUI();
  const matchChat = useMatch('/messages/:chatId');
  const matchVoice = useMatch('/messages/voice/:slug');
  const matchBrowse = useMatch('/messages/browse');
  const matchFriends = useMatch('/messages/friends');
  // Communication-hub sections (Calls/Status/Squads). These render full-region
  // (their own list column + main) so the hub rail stays pinned but the chat
  // list is replaced by the section's own nav.
  const matchHub = useMatch('/messages/hub/*');
  const { setRightPanel } = useLayout(); // <-- use context
  const { conversations } = useNotifications();
  // uid -> user doc cache, backfills member rows whose convo metadata lacks
  // a name/avatar (so the rail shows real usernames, not "Member").
  const [profiles, setProfiles] = useState({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('vergr_sidebar_collapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    const handler = (e) => setSidebarCollapsed(!!e?.detail?.collapsed);
    window.addEventListener('sidebar-toggle', handler);
    return () => window.removeEventListener('sidebar-toggle', handler);
  }, []);

  // Voice + browse + friends routes all match :chatId — exclude them so
  // we don't try to look the path segment up as a conversation id.
  const isSubroute = !!(matchVoice || matchBrowse || matchFriends);
  const chatId = isSubroute ? null : matchChat?.params?.chatId;
  const currentConvo = chatId ? (conversations || []).find(c => c.id === chatId) : null;
  // Show the members rail only for group chats. 1-to-1 DMs get nothing —
  // the right rail listed roles that don't apply to a 2-person chat.
  // Support tickets ARE group conversations (functions/supportChannel.js needs
  // them readable by whichever agent picks the ticket up), so they inherited
  // the whole group UI. The members rail exposed support STAFFING, with
  // OWNER/ADMIN roles, to the person raising the ticket, and its Invite button
  // let them add a stranger to their own private support conversation, who
  // would then read the entire history. Audit A4.
  const showMembersRail = !!(currentConvo && currentConvo.isGroup && currentConvo.supportThread !== true);

  // Contact-info side drawer (Telegram/WhatsApp style) for 1-to-1 DMs.
  // Open BY DEFAULT when a DM is selected; `?info=0` marks it closed. Switching
  // chats drops the query (the list panel navigates to a bare /messages/:id),
  // so each newly-opened DM shows the drawer again — the founder's spec.
  const [searchParams, setSearchParams] = useSearchParams();
  const showDetailsDrawer = !!(currentConvo && !currentConvo.isGroup && chatId && searchParams.get('info') !== '0');
  const closeDetailsDrawer = () => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('info', '0');
      return p;
    }, { replace: true });
  };

  // Fetch the LIVE profile for every group member so the rail shows current
  // names/avatars (the metadata snapshot in the convo doc goes stale on rename).
  // `requestedRef` dedupes so we don't refetch on every render; it is
  // intentionally NOT in the effect deps (and `profiles` is not either) so our
  // own setProfiles can't re-trigger + cancel the in-flight fetch.
  const requestedRef = useRef(new Set());
  useEffect(() => {
    if (!showMembersRail) return;
    const missing = (currentConvo.participants || []).filter(
      (uid) => !requestedRef.current.has(uid)
    );
    if (!missing.length) return;
    for (const uid of missing) requestedRef.current.add(uid);
    (async () => {
      const fetched = await Promise.all(
        missing.map(async (uid) => {
          try { return [uid, await getUserById(uid)]; }
          catch { return [uid, null]; }
        })
      );
      setProfiles((prev) => {
        const next = { ...prev };
        for (const [uid, user] of fetched) next[uid] = user || null;
        return next;
      });
    })();
  }, [showMembersRail, currentConvo]);

  // Copy a shareable invite link. Public groups → recipient joins instantly;
  // private groups → recipient lands on a request-to-join screen.
  const inviteToGroup = async () => {
    if (!chatId) return;
    const url = publicUrl(`/messages/g/${chatId}`);
    try {
      await navigator.clipboard.writeText(url);
      showToast('Invite link copied', 'success');
    } catch {
      showToast(url, 'info');
    }
  };

  // Clear any global right panel when entering messages section
  useEffect(() => {
    setRightPanel(null);
    return () => setRightPanel(null);
  }, [setRightPanel]);

  if (!isDesktop) {
    return (
      <div className="min-h-screen bg-bg-dark">
        {/* NO `safe-top` here. Every child of this route owns its status-bar
            inset already — the siblings via TopBar, the inbox via its own
            sticky glass header — and a header MUST carry its own inset or it
            slides under the status bar once it sticks. Insetting here as well
            stacked a second inset (+8px) on top, which is the dead gap that
            appeared above "Messages". Same trap ResponsiveLayout documents. */}
        <div className="max-w-[480px] mx-auto min-h-screen relative">
          <Outlet />
          {!matchChat && <BottomNav />}
        </div>
      </div>
    );
  }

  // Tracks the live width of the collapsible left sidebar so the messages
  // pane fills the freed space when it collapses.
  const sidebarOffset = sidebarCollapsed ? 72 : 240;

  return (
    <div className="h-screen bg-bg-dark overflow-hidden">
      <DesktopSidebar />
      <div
        className="h-full flex transition-[margin] duration-200"
        style={{ marginLeft: `${sidebarOffset}px` }}
      >
        {/* Hub sections (Calls/Status/Squads) take over the whole content
            region — they render their own list column + main, replacing the
            chat list, while the hub rail on the left stays pinned. */}
        {matchHub ? (
          <div className="flex-1 h-full min-w-0 overflow-hidden">
            <Outlet />
          </div>
        ) : (
        <>
        {/* Channel / DM list */}
        <div className="w-[280px] h-full border-r border-white/[0.06] flex flex-col bg-[#0B0E1A]">
          <MessagesListPanel />
        </div>

        {/* Main content */}
        <div className="flex-1 h-full flex flex-col min-w-0">
          {(matchChat || matchVoice || matchBrowse || matchFriends) ? (
            <Outlet />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <img src="/brand/logo.png" alt="VERGR" className="w-20 h-20 mb-6 rounded-2xl opacity-80" />
              <h1 className="font-syne text-4xl font-extrabold tracking-tight text-text-primary mb-2">CONNECT</h1>
              <p className="text-text-muted text-sm max-w-xs">Talk. Team up. Belong. Choose a conversation from the left panel to start chatting.</p>
            </div>
          )}
        </div>

        {/* Members rail — only for group chats (1-to-1 DMs don't need a
            roles list, and voice channels have their own UI). */}
        {showMembersRail && (
          <ChatMembersRail members={buildMembers(currentConvo, profiles)} onInvite={inviteToGroup} />
        )}

        {/* Contact-info drawer — 1-to-1 DMs. Push (flex sibling), not overlay,
            so the thread reflows beside it like Telegram desktop. */}
        {showDetailsDrawer && (
          <div className="w-[360px] h-full border-l border-white/[0.06] flex flex-col bg-bg-dark shrink-0 animate-fade-in">
            <ChatDetailsPanel chatId={chatId} variant="drawer" onClose={closeDetailsDrawer} />
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}