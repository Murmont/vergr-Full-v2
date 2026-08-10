// useStreamJoinEvents — subscribes to recent join events for a stream.
//
// Events are written by the viewer's own client when a follower/subscriber
// joins (see ViewerStreamScreen presence effect). Plain (non-follower) joins
// do NOT write events here — they appear in chat as a system "joined" line
// (emitted by the Phase 7 WS chat relay). This keeps Firestore write costs
// proportional to value: only the meaningful joins land in /joins.
//
// We only return events created in the last `windowMs` (default 8s) so
// reloaded clients don't replay old joins. Each event auto-prunes server-side
// after a TTL (handled by a Firestore TTL policy on `expiresAt` — TODO when
// the policy lands; until then a once-per-day cron can sweep).

import { useEffect, useState } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';

export function useStreamJoinEvents(streamId, { windowMs = 8000, max = 12 } = {}) {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    if (!streamId) return;
    const cutoff = Date.now() - windowMs;
    const q = query(
      collection(db, 'streams', streamId, 'joins'),
      orderBy('ts', 'desc'),
      limit(max),
    );
    const unsub = onSnapshot(q, (snap) => {
      const now = Date.now();
      const list = snap.docChanges()
        .filter((ch) => ch.type === 'added')
        .map((ch) => ({ id: ch.doc.id, ...ch.doc.data() }))
        .filter((e) => {
          const tsMs = typeof e.ts === 'number'
            ? e.ts
            : (e.ts?.toMillis?.() || 0);
          return tsMs >= cutoff && tsMs <= now + 1000;
        });
      if (list.length) {
        setEvents((prev) => [...prev, ...list].slice(-max));
      }
    }, (err) => console.warn('joins subscribe:', err));
    return unsub;
  }, [streamId, windowMs, max]);

  return events;
}
