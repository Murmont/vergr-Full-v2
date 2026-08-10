import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import { subscribeToNotifications, markNotificationRead, markAllNotificationsRead } from '../firebase/firestore';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { setupPushNotifications, onForegroundMessage } from '../utils/pushNotifications';
import { startOfflineQueue } from '../utils/offlineQueue';
import { getSquadReadMap, getCallsSeenAt, NAV_BADGES_EVENT } from '../utils/navBadges';

const NotificationContext = createContext(null);

// ──────────────────────────────────────────────────────────────
// Per-type notification sounds (foreground only — see note below).
// Maps a notification `type` to one of a few short tones in /public/sounds.
// We group many types onto a handful of distinct sounds so the user can tell
// "a message" from "a social interaction" from "something important" by ear.
//
// IMPORTANT (web platform limit): a CUSTOM per-type sound can only be played
// while the app is OPEN (foreground). When the app is closed/backgrounded the
// push is rendered by the OS, which plays the SYSTEM default notification
// sound — the web Notification API has no reliable way to attach a custom
// per-type sound to a background push. So this gives distinct sounds in-app;
// background pushes use the device's standard sound.
// ──────────────────────────────────────────────────────────────
const SOUND_FILES = {
  message: '/sounds/message.mp3',
  social: '/sounds/social.mp3',
  tournament: '/sounds/tournament.mp3',
  default: '/sounds/default.mp3',
};

function soundFileForType(type = '') {
  const t = String(type).toLowerCase();
  if (t.startsWith('dm') || t.includes('message') || t.includes('relay') || t.includes('chat')) return SOUND_FILES.message;
  if (t === 'like' || t === 'follow' || t === 'comment' || t.includes('mention') || t.includes('reply')) return SOUND_FILES.social;
  if (t.startsWith('tournament') || t.includes('match') || t.includes('won') || t.includes('cheat')) return SOUND_FILES.tournament;
  return SOUND_FILES.default;
}

const _audioCache = {};
function playNotificationSound(type) {
  try {
    if (typeof window === 'undefined') return;
    // Respect a user mute preference if one is set.
    if (localStorage.getItem('vergr.notifSound') === 'off') return;
    const src = soundFileForType(type);
    let a = _audioCache[src];
    if (!a) { a = new Audio(src); a.volume = 0.5; _audioCache[src] = a; }
    a.currentTime = 0;
    // play() can reject if there has been no user gesture yet — swallow it.
    a.play().catch(() => {});
  } catch {/* ignore */}
}

export function NotificationProvider({ children }) {
  const { currentUser } = useAuth();
  const [notifications, setNotifications] = useState([]);
  // null = NOT LOADED YET, [] = loaded and genuinely empty. The inboxes compute
  // `loading = !conversations`, so starting at [] made `loading` false before the
  // first snapshot and every cold open flashed the "Start a conversation" empty
  // state at someone who has chats. Consumers already guard with
  // `conversations || []`, so null is safe. Do not initialise this to [].
  const [conversations, setConversations] = useState(null);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [requestCount, setRequestCount] = useState(0);        // incoming message requests
  const [squadUnreadCount, setSquadUnreadCount] = useState(0); // squads with new chat activity
  const [missedCallCount, setMissedCallCount] = useState(0);   // unseen missed calls
  // Row data (not just counts) so the notifications feed can synthesize
  // message/squad/request/call entries with no extra reads.
  const [squadActivity, setSquadActivity] = useState([]); // [{id,name,avatar,lastMessageAt,lastMessageSenderId}]
  const [requests, setRequests] = useState([]);           // incoming pending conversation docs
  const [missedCalls, setMissedCalls] = useState([]);     // missed call docs (unanswered, not mine)
  const [toast, setToast] = useState(null);
  const pushSetupDone = useRef(false);
  // Raw docs held so we can recompute the localStorage-cutoff badges (squad /
  // calls) instantly when the user opens one of those screens, with no reread.
  const squadDocsRef = useRef([]);
  const callDocsRef = useRef([]);

  useEffect(() => {
    if (!currentUser) {
      setNotifications([]);
      setConversations([]);
      setUnreadChatCount(0);
      setRequestCount(0);
      setSquadUnreadCount(0);
      setMissedCallCount(0);
      setSquadActivity([]);
      setRequests([]);
      setMissedCalls([]);
      squadDocsRef.current = [];
      callDocsRef.current = [];
      pushSetupDone.current = false;
      return;
    }

    // 0. Kick off the offline message queue once the user is signed in.
    startOfflineQueue();

    // B5 (listener budget): the two app-wide Firestore listeners (notifications
    // + conversations) used to stream reads forever, including while the tab is
    // backgrounded/hidden — pure waste, since a closed/hidden app is woken by
    // push, not by a live snapshot. We now attach them only while the tab is
    // visible and tear them down after it has been hidden for a grace period.
    // On refocus they re-attach and the badge counts refresh immediately.
    const HIDDEN_GRACE_MS = 45 * 1000;
    const uid = currentUser.uid;
    let unsubNotifications = null;
    let unsubChats = null;
    let unsubRequests = null;
    let unsubSquads = null;
    let unsubCalls = null;
    let hiddenTimer = null;

    // Recompute the two cutoff-based badges from the raw docs we already hold
    // + the device-local read cutoffs. Called on each snapshot AND when the
    // user opens the squad/calls screen (which advances a cutoff).
    const recomputeSquadUnread = () => {
      const readMap = getSquadReadMap();
      let n = 0;
      for (const s of squadDocsRef.current) {
        const last = s.lastMessageAt?.toMillis?.() || 0;
        if (!last) continue;
        if (s.lastMessageSenderId === uid) continue; // my own send isn't "unread"
        if (last > (readMap[s.id] || 0)) n++;
      }
      setSquadUnreadCount(n);
    };
    const recomputeMissedCalls = () => {
      const seenAt = getCallsSeenAt();
      let n = 0;
      for (const c of callDocsRef.current) {
        if (c.answered) continue;
        if (c.callerId === uid) continue; // my outgoing no-answer isn't a missed call
        if ((c.startedAtMs || 0) > seenAt) n++;
      }
      setMissedCallCount(n);
    };
    const onBadgeCutoff = () => { recomputeSquadUnread(); recomputeMissedCalls(); };

    const attachListeners = () => {
      if (!unsubNotifications) {
        unsubNotifications = subscribeToNotifications(currentUser.uid, setNotifications);
      }
      if (!unsubChats) {
        const q = query(
          collection(db, 'conversations'),
          where('participants', 'array-contains', currentUser.uid),
          where('status', '==', 'active'),
          orderBy('lastMessageAt', 'desc')
        );
        unsubChats = onSnapshot(
          q,
          (snapshot) => {
            // Per-user "Delete chat" (Telegram parity): hiddenFor.{uid}=true
            // drops the convo from THIS user's inbox without touching the other
            // participant's copy. A new message clears the flag (resurrects it).
            const convos = snapshot.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .filter(c => c.hiddenFor?.[currentUser.uid] !== true);
            setConversations(convos);
            let count = 0;
            for (const c of convos) {
              if (c.unreadCount && c.unreadCount[currentUser.uid]) {
                count += c.unreadCount[currentUser.uid];
              }
            }
            setUnreadChatCount(count);
          },
          (err) => {
            if (err?.code !== 'permission-denied') console.warn('chats subscribe:', err);
          },
        );
      }
      // Incoming message requests (pending conversations I didn't start).
      if (!unsubRequests) {
        const rq = query(
          collection(db, 'conversations'),
          where('status', '==', 'pending'),
          where('participants', 'array-contains', uid),
        );
        unsubRequests = onSnapshot(
          rq,
          (snap) => {
            const list = snap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .filter(r => r.requestedBy !== uid); // incoming only
            setRequests(list);
            setRequestCount(list.length);
          },
          (err) => { if (err?.code !== 'permission-denied') console.warn('requests subscribe:', err); },
        );
      }
      // Squad chat activity (compared against a per-squad device-local cutoff).
      if (!unsubSquads) {
        const sq = query(collection(db, 'squads'), where('memberIds', 'array-contains', uid));
        unsubSquads = onSnapshot(
          sq,
          (snap) => {
            squadDocsRef.current = snap.docs.map(d => {
              const x = d.data();
              return { id: d.id, name: x.name, avatar: x.avatar, lastMessageAt: x.lastMessageAt, lastMessageSenderId: x.lastMessageSenderId };
            });
            setSquadActivity(squadDocsRef.current);
            recomputeSquadUnread();
          },
          (err) => { if (err?.code !== 'permission-denied') console.warn('squads subscribe:', err); },
        );
      }
      // Missed calls (compared against a device-local "calls seen" cutoff).
      if (!unsubCalls) {
        const cq = query(collection(db, 'calls_history'), where('participants', 'array-contains', uid));
        unsubCalls = onSnapshot(
          cq,
          (snap) => {
            // Keep only missed calls (unanswered, not my outgoing) — the feed +
            // badge both work off this slim set.
            callDocsRef.current = snap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .filter(c => !c.answered && c.callerId !== uid);
            setMissedCalls(callDocsRef.current);
            recomputeMissedCalls();
          },
          (err) => { if (err?.code !== 'permission-denied') console.warn('calls subscribe:', err); },
        );
      }
    };
    const detachListeners = () => {
      if (unsubNotifications) { unsubNotifications(); unsubNotifications = null; }
      if (unsubChats) { unsubChats(); unsubChats = null; }
      if (unsubRequests) { unsubRequests(); unsubRequests = null; }
      if (unsubSquads) { unsubSquads(); unsubSquads = null; }
      if (unsubCalls) { unsubCalls(); unsubCalls = null; }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
        attachListeners();
      } else if (!hiddenTimer) {
        hiddenTimer = setTimeout(() => { detachListeners(); hiddenTimer = null; }, HIDDEN_GRACE_MS);
      }
    };
    attachListeners();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(NAV_BADGES_EVENT, onBadgeCutoff);

    // 3. Setup push notifications (once per login)
    if (!pushSetupDone.current) {
      pushSetupDone.current = true;
      setupPushNotifications(currentUser.uid).catch(() => {});
    }

    // 4. Foreground push handler — show toast when app is open, or route
    //    silent control messages (e.g. message_deleted) to their listeners.
    const unsubForeground = onForegroundMessage(({ title, body, data }) => {
      if (data?.type === 'message_deleted') {
        window.dispatchEvent(new CustomEvent('vergr:message-deleted', {
          detail: { chatId: data.conversationId, messageId: data.messageId },
        }));
        return; // no toast for silent control messages
      }
      setToast({ title, body });
      playNotificationSound(data?.type);
      setTimeout(() => setToast(null), 4000);
    });

    // 5. Background push bridge — the service worker forwards silent control
    //    messages (message_deleted) via postMessage when the app is
    //    backgrounded. Convert to the same window event the foreground path
    //    uses so consumers only have to subscribe once.
    const swHandler = (event) => {
      const msg = event.data;
      if (msg?.type === 'message-deleted') {
        const d = msg.data || {};
        window.dispatchEvent(new CustomEvent('vergr:message-deleted', {
          detail: { chatId: d.conversationId, messageId: d.messageId },
        }));
        return;
      }
      // Notification was clicked while a VERGR tab was already open. The SW
      // focuses the tab and posts the target route; navigate via HashRouter
      // (set the hash — the router picks it up with no full reload). This is
      // the fix for "clicking a notification opens the home screen instead of
      // the message/post it was about".
      if (msg?.type === 'notification-click' && msg.targetHash) {
        window.location.hash = msg.targetHash;
      }
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', swHandler);
    }

    return () => {
      if (hiddenTimer) clearTimeout(hiddenTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(NAV_BADGES_EVENT, onBadgeCutoff);
      detachListeners();
      if (typeof unsubForeground === 'function') unsubForeground();
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', swHandler);
      }
    };
  }, [currentUser]);

  const unreadCount = notifications.filter(n => !n.read).length + unreadChatCount;
  const unreadNotifCount = notifications.filter(n => !n.read).length;

  const markRead = async (id) => { await markNotificationRead(id); };
  const markAllRead = async () => {
    if (!currentUser) return;
    await markAllNotificationsRead(currentUser.uid);
  };

  const value = {
    notifications, conversations, unreadCount, unreadChatCount, unreadNotifCount,
    requestCount, squadUnreadCount, missedCallCount,
    squadActivity, requests, missedCalls,
    markRead, markAllRead, toast,
  };
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export const useNotifications = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
};
