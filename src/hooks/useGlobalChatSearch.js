// Global cross-chat message search (02_MESSAGING 2.4).
//
// TWO sources, deliberately:
//   1. Dexie (searchAllMessages) — instant, but only sees messages THIS device
//      has cached, so it misses any chat you've never opened here.
//   2. The relay's /search endpoint — authoritative (it owns the bodies) and
//      covers every room you're in, but it's a network round-trip.
//
// So we show the local hits immediately and merge the server's in when they
// land. Rows are deduped by chatId+id, with the server row winning (it's the
// source of truth for text after an edit). If the network call fails, the local
// results still stand — search degrades, it never breaks.

import { useEffect, useState } from 'react';
import { searchAllMessages } from '../utils/messageCache';
import { searchMessages } from '../utils/chatHistoryApi';

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

// The existing result rows carry a Firestore-ish `createdAt` (has .toDate()),
// which the inbox renderers already know how to format. Give the relay's plain
// millisecond `ts` the same shape so both kinds render through one code path.
function tsShim(ms) {
  const d = new Date(ms);
  return { toDate: () => d, seconds: Math.floor(ms / 1000), nanoseconds: 0 };
}
function rowMs(r) {
  if (r?.createdAt?.toDate) { try { return r.createdAt.toDate().getTime(); } catch { return 0; } }
  return 0;
}

export default function useGlobalChatSearch(search) {
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = (search || '').trim();
    if (q.length < MIN_QUERY) { setResults([]); setSearching(false); return undefined; }

    let alive = true;
    const ctrl = new AbortController();
    setSearching(true);

    const t = setTimeout(async () => {
      // Local first — paints while the network call is still in flight.
      const local = await searchAllMessages(q).catch(() => []);
      if (!alive) return;
      const byKey = new Map();
      for (const r of local) byKey.set(`${r.chatId}_${r.id}`, r);
      setResults([...byKey.values()].sort((a, b) => rowMs(b) - rowMs(a)));

      const remote = await searchMessages(q, { signal: ctrl.signal });
      if (!alive) return;
      for (const r of remote) {
        byKey.set(`${r.convoId}_${r.id}`, {
          chatId: r.convoId,
          id: r.id,
          senderId: r.uid,
          text: r.text || '',
          type: r.mediaKind || 'text',
          createdAt: tsShim(r.ts),
        });
      }
      setResults([...byKey.values()].sort((a, b) => rowMs(b) - rowMs(a)));
      setSearching(false);
    }, DEBOUNCE_MS);

    return () => { alive = false; ctrl.abort(); clearTimeout(t); setSearching(false); };
  }, [search]);

  return { results, searching };
}
