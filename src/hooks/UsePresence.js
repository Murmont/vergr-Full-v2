import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref as rtdbRef, update as rtdbUpdate, serverTimestamp as rtdbTimestamp } from 'firebase/database';
import { db, rtdb } from '../firebase/config';

// Presence heartbeat. AuthContext writes RTDB `/status/{uid}` = online on every
// (re)connect; this hook keeps `last_changed` fresh while the app is open. There
// is NO `onDisconnect → offline` write anymore (it fired a FRESH `offline` on
// every mobile socket blip and stuck native users offline) — instead readers
// apply a freshness window (usePresenceMap / useOnlineStatus / isStatusOnline):
// online ONLY counts if `last_changed` is within ~3 min. When the app closes or
// backgrounds, the heartbeat stops, the timestamp goes stale, and the user
// shows offline on its own.
//
// Writes both RTDB `/status/{uid}.last_changed` (drives the freshness window
// everywhere) and Firestore `users/{uid}.lastSeen` (admin active-user stats):
// mount, every HEARTBEAT_MS, and the instant the app returns to foreground.
const HEARTBEAT_MS = 60 * 1000;

export default function usePresence() {
  const { currentUser } = useAuth();
  useEffect(() => {
    if (!currentUser) return;
    const uid = currentUser.uid;
    const fsRef = doc(db, 'users', uid);
    const statusRef = rtdb ? rtdbRef(rtdb, '/status/' + uid) : null;
    const ping = () => {
      // Firestore is the cross-platform presence source of truth (RTDB does not
      // connect in the native WebView). `lastSeen` drives the freshness window;
      // `status:'online'` is cleared to 'offline' only on explicit logout.
      updateDoc(fsRef, { status: 'online', lastSeen: serverTimestamp() }).catch(() => {});
      // RTDB write kept as a best-effort enhancement on web (no-op on native).
      if (statusRef) rtdbUpdate(statusRef, { state: 'online', last_changed: rtdbTimestamp() }).catch(() => {});
    };
    ping();
    const id = setInterval(ping, HEARTBEAT_MS);
    // Mobile WebViews (and backgrounded browser tabs) freeze setInterval while
    // backgrounded, so the heartbeat can be up to a minute stale on resume —
    // without this, a just-reopened app looks offline until the next beat.
    // Re-ping the instant we return to foreground. visibilitychange covers
    // app/tab switches; focus covers window refocus.
    const onResume = () => { if (document.visibilityState !== 'hidden') ping(); };
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onResume);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onResume);
    };
  }, [currentUser]);
}
