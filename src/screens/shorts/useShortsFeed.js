// useShortsFeed — the ONE loader behind every immersive clip surface:
// /shorts (web + native) and /clip/:postId.
//
// Why one: /clip/:postId used to be a separate, weaker player with its own
// loader, and the two drifted. That loader fetched each clip's author with an
// `await` inside a loop (30 sequential reads before anything showed), and when
// the opened clip was older than the newest 30 it silently played a DIFFERENT
// clip at index 0.
//
// What this does instead:
//   - one query for the newest short-form posts, authors fetched ONCE per
//     distinct author, in parallel (fewer reads than before, not more)
//   - a deep link opens the exact clip: if it is not in the first page it is
//     fetched by id and placed first; if it does not exist, `missing` is true
//     and the screen says so rather than playing something else
//   - live slides are interleaved, and when they arrive AFTER the clips have
//     painted, the clip on screen stays on screen. Before, the slides shifted
//     every index by one and the video under the viewer's thumb changed.
//   - authors the viewer marked "Not interested" are filtered out. The shorts
//     query is ordered by date, not ranked, so without this the choice would do
//     nothing here. Device-local, so it costs no reads.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getUser, getPost } from '../../firebase/firestore';
import { isDiscoverableStream } from '../../utils/streamVisibility';
import { readFeedCache, writeFeedCache } from '../../utils/feedCache';
import { getNegatives } from '../../utils/feedPrefs';
import { isShortFormat } from '../../utils/helpers';

const PAGE = 30;
const LIVE_EVERY = 4;

const prepare = (post) => {
  post.videoUrl = post.mediaUrls?.[0] || post.mediaUrl || null;
  post.isEmbed = !!(post.embedVideoUrl || post.youtubeVideoId);
  return post;
};

const playable = (p) => !!p.videoUrl && !p.isEmbed && !String(p.authorAccountType || '').includes('bot');

async function hydrateAuthors(posts) {
  const ids = [...new Set(posts.map((p) => p.authorId).filter(Boolean))];
  const users = await Promise.all(ids.map((id) => getUser(id).catch(() => null)));
  const byId = new Map(ids.map((id, i) => [id, users[i]]));
  posts.forEach((p) => { p.author = byId.get(p.authorId) || null; });
}

function interleave(shorts, live) {
  if (!live.length) return shorts;
  if (!shorts.length) return live;
  const out = [];
  let li = 0;
  shorts.forEach((s, i) => {
    if ((i === 2 || (i > 2 && (i - 2) % LIVE_EVERY === 0)) && li < live.length) { out.push(live[li]); li++; }
    out.push(s);
  });
  while (li < live.length) { out.push(live[li]); li++; }
  return out;
}

export default function useShortsFeed({ startId = null } = {}) {
  const [shorts, setShorts] = useState([]);
  const [liveStreams, setLiveStreams] = useState([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [missing, setMissing] = useState(false);

  // Has the deep-linked clip been placed yet? A plain /shorts open has nothing
  // to place.
  const placed = useRef(!startId);
  // The id on screen, so a feed that changes underneath keeps the same clip.
  const lastIdRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'streams'), where('status', '==', 'live'),
          orderBy('viewerCount', 'desc'), limit(10),
        ));
        if (!alive) return;
        setLiveStreams(snap.docs.map((d) => ({ id: d.id, _kind: 'live', ...d.data() })).filter(isDiscoverableStream));
      } catch { /* no live slides */ }
    })();
    return () => { alive = false; };
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const snap = await getDocs(query(
        collection(db, 'posts'),
        where('status', '==', 'published'),
        where('type', 'in', ['short', 'clip']),
        orderBy('createdAt', 'desc'),
        limit(PAGE),
      ));
      const muted = getNegatives().authors;
      let posts = snap.docs.map((d) => prepare({ id: d.id, ...d.data() }));
      let target = null;

      if (startId && !isRefresh) {
        target = posts.find((p) => p.id === startId || p.slug === startId) || null;
        if (!target) {
          const direct = await getPost(startId).catch(() => null);
          if (direct && direct.status === 'published' && isShortFormat(direct.type)) {
            target = prepare(direct);
            if (target.videoUrl || target.isEmbed) posts = [target, ...posts];
            else target = null;
          }
        }
        setMissing(!target);
      }

      // The clip someone explicitly opened is shown even if its author is muted
      // or it is an embed; everything else follows the feed rules.
      posts = posts.filter((p) => p === target || (playable(p) && !muted.has(p.authorId)));
      await hydrateAuthors(posts);

      if (isRefresh) lastIdRef.current = null;
      setShorts(posts);
      if (!startId) writeFeedCache('shorts', posts);
      if (isRefresh) { setIndex(0); try { navigator.vibrate?.(12); } catch { /* no haptics */ } }
    } catch (err) {
      console.error('Failed to load shorts:', err);
    }
    setLoading(false);
    setRefreshing(false);
  }, [startId]);

  useEffect(() => {
    placed.current = !startId;
    lastIdRef.current = null;
    setMissing(false);
    setIndex(0);
    const cached = startId ? null : readFeedCache('shorts');
    if (cached) {
      const muted = getNegatives().authors;
      setShorts(cached.filter((p) => !muted.has(p.authorId)));
      setLoading(false);
    } else {
      setLoading(true);
    }
    load(false);
  }, [load, startId]);

  const feed = useMemo(() => interleave(shorts, liveStreams), [shorts, liveStreams]);
  const safeIndex = Math.max(0, Math.min(index, feed.length - 1));

  // Remember what is on screen whenever the viewer moves.
  useEffect(() => { lastIdRef.current = feed[safeIndex]?.id ?? null; }, [safeIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the list changes underneath: place the deep-linked clip once, then
  // keep whatever was on screen on screen.
  useEffect(() => {
    if (!feed.length) return;
    if (!placed.current) {
      const i = feed.findIndex((x) => x.id === startId || x.slug === startId);
      if (i >= 0) { placed.current = true; setIndex(i); lastIdRef.current = feed[i].id; }
      return;
    }
    const id = lastIdRef.current;
    const i = id ? feed.findIndex((x) => x.id === id) : -1;
    if (i >= 0 && i !== safeIndex) setIndex(i);
    lastIdRef.current = feed[i >= 0 ? i : safeIndex]?.id ?? null;
  }, [feed]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Not interested": the clip leaves the list and the next one slides into
  // the same position.
  const remove = useCallback((id) => {
    lastIdRef.current = null;
    setShorts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const refresh = useCallback(() => load(true), [load]);

  return { feed, index: safeIndex, setIndex, loading, refreshing, refresh, remove, missing };
}
