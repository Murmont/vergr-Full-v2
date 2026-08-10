// useMergedNotifications — one time-sorted feed = real notification docs +
// synthesized rows for new messages, squad-chat activity, message requests and
// missed calls. All synthesized rows are derived from data NotificationContext
// already holds in memory (its existing listeners), so this adds NO Firestore
// reads or writes. Message rows reflect live unread state, so they disappear on
// their own once the thread is opened (no "mark read" bookkeeping needed).

import { useMemo, useState, useEffect } from 'react';
import { useNotifications } from '../context/NotificationContext';
import { useUser } from '../context/UserContext';
import { useAuth } from '../context/AuthContext';
import { resolveChatUsers, peekChatUser, chatDisplayName } from '../utils/chatIdentity';
import { getSquadReadMap, getCallsSeenAt } from '../utils/navBadges';
import { applyVanguardMask } from '../utils/vanguard';

const toMs = (t) => {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  const d = new Date(t);
  return isNaN(d.getTime()) ? 0 : d.getTime();
};

const otherOf = (participants, me) => (participants || []).find((p) => p !== me) || null;

// Where a feed row navigates when tapped. Returns a path or null.
export function routeForNotification(item) {
  if (!item) return null;
  if (item._kind === 'message') return `/messages/${item.chatId}`;
  if (item._kind === 'squad_message') return `/squads/${item.squadId}/chat`;
  if (item._kind === 'request') return '/messages/requests';
  if (item._kind === 'missed_call') return '/calls';

  // Real notification docs — mirror the drawer's existing routing.
  const d = item;
  const squadId = d.squadId || d.data?.squadId;
  if (d.type === 'squad_invite') return '/squads/invitations';
  if (d.type === 'squad_challenge_reward' && squadId) return `/squads/${squadId}/challenges`;
  const chatId = d.chatId || d.data?.chatId || d.convoId || d.data?.convoId;
  if (chatId && String(d.type || '').includes('relay')) return `/messages/${chatId}`;
  const postId = d.postId || d.data?.postId;
  const orderId = d.data?.orderId;
  const userId = d.senderId || d.userId || d.data?.senderId;
  if (postId) return `/post/${postId}`;
  if (orderId) return `/orders/${orderId}`;
  if (squadId) return `/squads/${squadId}`;
  if (userId) return `/user/${userId}`;
  if (d.actionUrl) return d.actionUrl;
  return null;
}

export function useMergedNotifications() {
  const { currentUser } = useAuth();
  const me = currentUser?.uid;
  const { profile } = useUser();
  const {
    notifications, conversations, squadActivity, requests, missedCalls,
  } = useNotifications();

  // Resolve names/avatars for the uids that appear as message/request/call rows
  // (a handful). peek serves cached identities instantly; the async fill covers
  // any misses. Same source of truth as the inbox, so names never go stale.
  const [userMap, setUserMap] = useState({});
  useEffect(() => {
    const ids = new Set();
    for (const c of (conversations || [])) {
      if (!c.isGroup && (c.unreadCount?.[me] || 0) > 0) {
        const o = otherOf(c.participants, me); if (o) ids.add(o);
      }
    }
    for (const r of (requests || [])) { const o = otherOf(r.participants, me); if (o) ids.add(o); }
    for (const c of (missedCalls || [])) { const o = otherOf(c.participants, me) || c.callerId; if (o) ids.add(o); }
    const arr = [...ids];
    if (!arr.length) return;
    let alive = true;
    resolveChatUsers(arr).then((m) => { if (alive) setUserMap((prev) => ({ ...prev, ...m })); });
    return () => { alive = false; };
  }, [conversations, requests, missedCalls, me]);

  const items = useMemo(() => {
    const out = [];

    for (const n of (notifications || [])) {
      out.push({ ...n, _kind: 'doc', _ms: toMs(n.createdAt) });
    }

    // New DM / group messages (one row per unread conversation).
    for (const c of (conversations || [])) {
      const unread = c.unreadCount?.[me] || 0;
      if (unread <= 0) continue;
      const otherId = otherOf(c.participants, me);
      // Vanguard identity mask — a masked mod's row must show the persona,
      // not the real name/avatar the metadata snapshot leaked.
      const live = !c.isGroup ? applyVanguardMask(userMap[otherId] || peekChatUser(otherId) || {}, profile) : null;
      const name = c.isGroup ? (c.groupName || 'Group')
        : (live?.isVanguardPersona ? live.displayName : chatDisplayName(otherId, live, profile, c.metadata?.[otherId]?.name));
      const avatar = c.isGroup ? c.groupIcon
        : (live?.isVanguardPersona ? live.avatar : (live?.avatar || c.metadata?.[otherId]?.avatar || null));
      out.push({
        id: `msg_${c.id}`, _kind: 'message', type: 'message',
        title: c.isGroup ? `${name}` : name,
        body: c.isGroup ? (c.lastMessageText || 'New message') : (c.lastMessageText || 'sent you a message'),
        senderName: name, senderAvatar: avatar, unread,
        chatId: c.id, isGroup: !!c.isGroup, read: false,
        createdAt: c.lastMessageAt, _ms: toMs(c.lastMessageAt),
      });
    }

    // Squad chat activity (device-local read cutoff, same as the nav badge).
    const squadRead = getSquadReadMap();
    for (const s of (squadActivity || [])) {
      const last = toMs(s.lastMessageAt);
      if (!last || s.lastMessageSenderId === me) continue;
      if (last <= (squadRead[s.id] || 0)) continue;
      out.push({
        id: `sq_${s.id}`, _kind: 'squad_message', type: 'squad',
        title: s.name || 'Squad', body: 'New messages in your squad',
        senderName: s.name, senderAvatar: s.avatar || null,
        squadId: s.id, read: false, createdAt: s.lastMessageAt, _ms: last,
      });
    }

    // Incoming message requests.
    for (const r of (requests || [])) {
      const otherId = otherOf(r.participants, me);
      const live = applyVanguardMask(userMap[otherId] || peekChatUser(otherId) || {}, profile);
      const name = live?.isVanguardPersona ? live.displayName : chatDisplayName(otherId, live, profile, r.metadata?.[otherId]?.name);
      out.push({
        id: `req_${r.id}`, _kind: 'request', type: 'request',
        title: name, body: 'wants to send you a message',
        senderName: name, senderAvatar: live?.isVanguardPersona ? live.avatar : (live?.avatar || r.metadata?.[otherId]?.avatar || null),
        read: false, createdAt: r.createdAt || r.lastMessageAt, _ms: toMs(r.createdAt || r.lastMessageAt),
      });
    }

    // Unseen missed calls.
    const callsSeenAt = getCallsSeenAt();
    for (const c of (missedCalls || [])) {
      if ((c.startedAtMs || 0) <= callsSeenAt) continue;
      const otherId = otherOf(c.participants, me) || c.callerId;
      const live = applyVanguardMask(userMap[otherId] || peekChatUser(otherId) || {}, profile);
      const name = live?.isVanguardPersona ? live.displayName : chatDisplayName(otherId, live, profile, 'Someone');
      out.push({
        id: `call_${c.id}`, _kind: 'missed_call', type: 'missed_call',
        title: name, body: c.type === 'video' ? 'Missed video call' : 'Missed voice call',
        senderName: name, senderAvatar: live?.avatar || null,
        read: false, createdAt: c.startedAtMs, _ms: c.startedAtMs || 0,
      });
    }

    out.sort((a, b) => (b._ms || 0) - (a._ms || 0));
    return out;
  }, [notifications, conversations, squadActivity, requests, missedCalls, userMap, me, profile]);

  return { items, routeFor: routeForNotification };
}
