// src/hooks/useOnlineStatus.js
import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { PRESENCE_FRESH_MS, isUserDocOnline } from '../utils/presence';

/**
 * useOnlineStatus - one user's online/offline status, read from Firestore
 * `users/{uid}`.
 *
 * Online = `lastSeen` within PRESENCE_FRESH_MS AND not explicitly signed out.
 * We read from Firestore (NOT RTDB) because the Firebase RTDB WebSocket does
 * not connect inside the native Tauri Android WebView, so RTDB `/status/{uid}`
 * is never written or read on native — every native session showed offline.
 * Firestore works on both web and native, and the usePresence heartbeat keeps
 * `lastSeen` fresh (~60s) while the user is present. A local timer re-checks
 * freshness so a user who closed/backgrounded the app flips to offline on its
 * own once the heartbeat goes stale.
 *
 * Returns: { isOnline, lastSeen }  (lastSeen = Date | null)
 */
export default function useOnlineStatus(userId) {
  const [data, setData] = useState(null); // users/{uid} doc data
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!userId) { setData(null); return; }
    const unsub = onSnapshot(
      doc(db, 'users', userId),
      (snap) => setData(snap.exists() ? snap.data() : null),
      () => setData(null), // rules deny / error → offline
    );
    return () => unsub();
  }, [userId]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), PRESENCE_FRESH_MS / 3);
    return () => clearInterval(id);
  }, []);

  const isOnline = isUserDocOnline(data);
  const ls = data?.lastSeen;
  const lastSeen = ls
    ? (typeof ls?.toDate === 'function' ? ls.toDate() : new Date(typeof ls === 'number' ? ls : Date.parse(ls)))
    : null;
  return { isOnline, lastSeen: (lastSeen && !Number.isNaN(lastSeen.getTime())) ? lastSeen : null };
}
