// src/hooks/usePresenceMap.js
import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { PRESENCE_FRESH_MS, isUserDocOnline } from '../utils/presence';

/**
 * usePresenceMap - live online presence for a LIST of users, read from
 * Firestore `users/{uid}`. Returns { [uid]: boolean }.
 *
 * Online = `lastSeen` within PRESENCE_FRESH_MS AND not explicitly signed out.
 * We read from Firestore (NOT RTDB) because the RTDB WebSocket does not connect
 * in the native Tauri Android WebView (so `/status/{uid}` is dead on native);
 * Firestore works on both platforms. The usePresence heartbeat refreshes
 * `lastSeen` every ~60s; a local timer re-evaluates freshness so a user who
 * silently dropped (no snapshot fires once their doc stops changing) still
 * flips to offline.
 */
export default function usePresenceMap(userIds = []) {
  const [raw, setRaw] = useState({}); // { uid: users-doc-data }
  const [, setTick] = useState(0);    // forces freshness re-eval on an interval
  const key = Array.from(new Set((userIds || []).filter(Boolean))).sort().join(',');

  useEffect(() => {
    if (!key) { setRaw({}); return; }
    const ids = key.split(',');
    const unsubs = ids.map((uid) =>
      onSnapshot(
        doc(db, 'users', uid),
        (snap) => setRaw((prev) => ({ ...prev, [uid]: snap.exists() ? snap.data() : null })),
        () => setRaw((prev) => ({ ...prev, [uid]: null })), // rules deny / error → offline
      ),
    );
    return () => unsubs.forEach((u) => u && u());
  }, [key]);

  // Re-evaluate freshness periodically so silently-dropped users go offline.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), PRESENCE_FRESH_MS / 3);
    return () => clearInterval(id);
  }, []);

  const map = {};
  for (const uid in raw) map[uid] = isUserDocOnline(raw[uid]);
  return map;
}
