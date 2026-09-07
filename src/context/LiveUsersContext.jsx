// LiveUsersContext — one app-wide subscription to currently-live streams,
// exposing which users are live so any surface can stack a red LIVE indicator
// on their avatar (UserAvatar `isLive` prop) without each screen running its
// own query.
//
// Source of truth = the stream docs themselves (status === 'live'), so it's
// always accurate even where a surface only has a denormalized name/avatar.
// Keyed by hostUid → streamId (the streamId lets avatars deep-link to /watch).
//
// Cost: a single onSnapshot on `streams where status == live` (capped), shared
// across the whole app. Trivial at launch scale; capped at 300 live streams.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { isDiscoverableStream, streamPremium } from '../utils/streamVisibility';
import { collection, query, where, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';

const LiveUsersContext = createContext({
  isUserLive: () => false,
  liveStreamFor: () => null,
  liveHosts: new Map(),
  liveLoaded: false,
});

export const useLiveUsers = () => useContext(LiveUsersContext);

export function LiveUsersProvider({ children }) {
  const [liveMap, setLiveMap] = useState(() => new Map());   // hostUid -> streamId
  // Richer map for discovery surfaces (home live rail, /streams). Keyed by
  // hostUid so each host appears once, carrying the denormalized fields the
  // cards need. Driven by the SAME onSnapshot, so it updates in real time:
  // a stream starting/ending while the user sits on the feed appears/vanishes
  // within seconds (no one-shot getDocs that goes stale on mount).
  const [liveHosts, setLiveHosts] = useState(() => new Map());
  const [liveLoaded, setLiveLoaded] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, 'streams'),
      where('status', '==', 'live'),
      limit(300),
    );
    const unsub = onSnapshot(q, (snap) => {
      const m = new Map();
      const hosts = new Map();
      snap.forEach((d) => {
        const data = d.data() || {};
        // A private session must never light up an avatar as LIVE. The stream
        // doc has carried `unlisted`/`discoverable` all along; nothing read
        // them. See streamVisibility.js.
        if (!isDiscoverableStream(data)) return;
        const h = data.hostUid || data.hostId;
        if (!h) return;
        if (!m.has(h)) m.set(h, d.id);
        if (!hosts.has(h)) {
          hosts.set(h, {
            streamId: d.id,
            hostUid: h,
            streamKey: data.streamKey || null,
            name: data.hostUsername || data.hostName || null,
            avatar: data.hostAvatar || null,
            title: data.title || null,
            viewerCount: data.viewerCount || 0,
            orientation: data.orientation || null,
            boosted: !!data.boosted,
            // ⚠ CARRIED SO A RAID PICKER COSTS NOTHING. `functions/raids.js`
            // refuses an audio-only or gated target, so any surface offering
            // raid candidates must filter the same way or it renders buttons
            // the server will reject. Reading it here is free: it rides the one
            // snapshot this context already holds, and the alternative was a
            // fresh getDocs every time a host ended a stream.
            audioOnly: data.audioOnly === true,
            ticketed: data.audience === 'ticketed',
            coverUrl: data.coverUrl || data.thumbnailUrl || null,
            // Only publicly-discoverable streams belong on discovery rails.
            discoverable: data.discoverable !== false && data.unlisted !== true,
            // Premium Live: public, discoverable, paywalled. Carried so a ring
            // or a rail can label it before somebody taps into a paywall, and
            // so nothing autoplays a free preview of paid content.
            ...streamPremium(data),
          });
        }
      });
      setLiveMap(m);
      setLiveHosts(hosts);
      setLiveLoaded(true);
    }, () => { setLiveLoaded(true); /* best-effort indicator */ });
    return unsub;
  }, []);

  const value = useMemo(() => ({
    isUserLive: (uid) => !!uid && liveMap.has(uid),
    liveStreamFor: (uid) => (uid ? liveMap.get(uid) || null : null),
    liveHosts,
    liveLoaded,
  }), [liveMap, liveHosts, liveLoaded]);

  return (
    <LiveUsersContext.Provider value={value}>
      {children}
    </LiveUsersContext.Provider>
  );
}

export default LiveUsersContext;
