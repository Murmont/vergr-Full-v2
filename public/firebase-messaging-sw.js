// ────────────────────────────────────────────────────────────
// Firebase Cloud Messaging Service Worker
// ────────────────────────────────────────────────────────────
// Handles push notifications when the VERGR PWA is in the background
// or closed. Companion file: public/sw.js (general PWA cache) and
// src/utils/pushNotifications.js (foreground handler).
//
// Design decisions (do NOT relax these without reading the FCM docs):
//
//   1. We read title/body/type/ids from `payload.data`, NOT from
//      `payload.notification`. Reason: when the sender includes a
//      top-level `notification` field, Chrome auto-displays a system
//      notification BEFORE `onBackgroundMessage` even fires — and if
//      the sender also uses `webpush.notification`, the `notification`
//      field arrives on this side partially stripped, which is how we
//      ended up with ghost "New notification from VERGR" bubbles with
//      no body text. The backend is now data-only; this handler is the
//      single source of truth for what the user sees.
//
//   2. If the data is missing or malformed, we show NOTHING. Better to
//      drop a push than to produce an empty "New notification from VERGR"
//      ghost with no way for the user to figure out what it was about.
//
//   3. The notification `data` object is stringified into the click
//      handler's `event.notification.data` — we use it to route the user
//      straight to the relevant post / chat / squad / profile. The SPA uses
//      BrowserRouter (real paths), so routes are `/post/...` NOT `/#/post/...`.

importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCuwlEMPFzhmXx_FqdWiYWlshuRT_EIkoI',
  authDomain: 'vergr-44494.firebaseapp.com',
  projectId: 'vergr-44494',
  storageBucket: 'vergr-44494.firebasestorage.app',
  messagingSenderId: '674096624319',
  appId: '1:674096624319:web:a01744f81795f15b354c0a',
});

const messaging = firebase.messaging();

// ──────────────────────────────────────────────────────────────
// Force this SW to take over immediately on update.
// Without skipWaiting, an INSTALLED app (PWA / home-screen) keeps
// running the OLD cached copy of this file until every window is
// fully closed — which is why a badge/click-handler change here
// never reached the user's phone. skipWaiting + clients.claim make
// a freshly fetched version activate and control open clients at
// once, so future fixes land on the next app launch (not "never").
// ──────────────────────────────────────────────────────────────
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ──────────────────────────────────────────────────────────────
// Background push handler
// ──────────────────────────────────────────────────────────────
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};

  // Silent control messages — no visible notification, just forward to any
  // open VERGR client so the SPA can mutate its local Dexie cache.
  if (data.type === 'message_deleted') {
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) c.postMessage({ type: 'message-deleted', data });
    });
    return;
  }

  // If FCM included a top-level `notification` field, Chrome has ALREADY
  // auto-displayed the notification before this handler ran. Calling
  // showNotification again would produce a duplicate. Bail.
  if (payload.notification) return;

  // Title + body come from the data payload (see design note #1).
  // Fallback chain: explicit title → displayName → legacy notification.title
  const title =
    data.title ||
    data.displayName ||
    (payload.notification && payload.notification.title) ||
    '';
  const body =
    data.body ||
    data.message ||
    (payload.notification && payload.notification.body) ||
    '';

  // If we genuinely have no information, drop the push silently rather
  // than showing a ghost "New notification from VERGR" bubble.
  if (!title && !body) return;

  // Sender avatar (if present) becomes the big notification icon —
  // matches WhatsApp's UX where you see WHO messaged you. The small
  // monochrome badge in the status bar always stays as the VERGR logo.
  const senderAvatar = data.senderAvatar || data.avatar || null;

  // Message-class pushes (DM / group / squad relay, legacy message) should
  // look like a chat notification: the SENDER's avatar as the big left icon,
  // and NO large `image` preview (a stray image renders as the black square
  // on the right that doesn't belong on a message). Non-message types (e.g.
  // a post with media) may still carry a hero image.
  const t = String(data.type || '').toLowerCase();
  const isMessageClass =
    t.includes('relay') || t.includes('message') || t.includes('chat') || t.startsWith('dm');

  const options = {
    body: body || title,
    icon: senderAvatar || '/icons/icon-192-v2.png',
    // `badge` is the small monochrome status-bar/pulldown glyph. Android masks
    // it by ALPHA and tints it, so it MUST be a transparent silhouette — a
    // solid square (like the app icon) renders as a plain white square. This
    // is a transparent PNG containing only the white "V".
    badge: '/icons/badge-v.png',
    image: isMessageClass ? undefined : (data.image || undefined),
    data, // preserved so notificationclick can route the user
    // `tag` collapses successive notifications from the same chat /
    // notif id into one bubble instead of stacking dozens of them.
    tag: data.chatId || data.conversationId || data.notifId || data.postId || undefined,
    renotify: !!(data.chatId || data.conversationId),
    vibrate: [100, 50, 100],
    requireInteraction: false,
  };

  self.registration.showNotification(title || 'VERGR', options);
});

// ──────────────────────────────────────────────────────────────
// Click handler — route to the right screen
// ──────────────────────────────────────────────────────────────
//
// The app uses HashRouter, so in-app routes are under /#/... . If a
// VERGR window is already open, we focus it and post a message so the
// running SPA can navigate without a full reload. Otherwise we open a
// new window pointed at the target hash route.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = (event.notification && event.notification.data) || {};

  // Resolve the target route from the data payload. Order matters —
  // the first match wins. Keep in sync with NotificationsDrawer's
  // handleNavigate() function.
  let targetHash = '/';
  if (data.postId) targetHash = `/post/${data.postId}`;
  else if (data.conversationId) targetHash = `/chat/${data.conversationId}`;
  else if (data.chatId) targetHash = `/chat/${data.chatId}`;
  else if (data.squadId) targetHash = `/squads/${data.squadId}`;
  else if (data.orderId) targetHash = `/orders/${data.orderId}`;
  // actionUrl must win over the generic senderId fallback — e.g. an
  // incoming_call push carries BOTH senderId (caller) and actionUrl
  // (/call/...); without this, taps opened the caller's profile instead of
  // answering. Specific ids above still take priority over a generic actionUrl.
  else if (data.actionUrl) targetHash = data.actionUrl;
  else if (data.type === 'follow' && data.senderId) targetHash = `/user/${data.senderId}`;
  else if (data.senderId) targetHash = `/user/${data.senderId}`;

  // The app is on BrowserRouter (real paths), NOT HashRouter. Build a clean
  // path URL — the old `/#${targetHash}` form sent every tap to the home feed
  // because BrowserRouter ignores the hash fragment.
  const targetUrl = `${self.location.origin}${targetHash}`;

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If a VERGR window is already open, focus it AND drive it to the
        // target route ourselves. We do NOT rely solely on postMessage:
        // a backgrounded app that only gets re-focused never reloads, so
        // stale in-memory app code can silently ignore the message (this
        // is why taps were landing on the home feed). `client.navigate()`
        // forces the route (hash-only change = no reload, SPA just routes);
        // the postMessage is kept as a belt-and-suspenders fallback for
        // browsers that restrict navigate().
        for (const client of clientList) {
          if (client.url.includes(self.location.origin)) {
            client.postMessage({ type: 'notification-click', targetHash, data });
            if ('focus' in client) {
              const focused = client.focus();
              if ('navigate' in client) {
                return Promise.resolve(focused)
                  .then(() => client.navigate(targetUrl).catch(() => client))
                  .catch(() => client);
              }
              return focused;
            }
          }
        }
        // Otherwise, open a new window at the target route directly.
        return clients.openWindow(targetUrl);
      })
  );
});
