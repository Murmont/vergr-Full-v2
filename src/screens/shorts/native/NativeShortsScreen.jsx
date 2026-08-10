// NativeShortsScreen — dedicated phone build of /shorts.
// Phone-only immersive TikTok feed: single full-screen column, no desktop shell
// or scroll-arrows. Reuses the shared ShortsDeck (drag engine + players +
// overlays) so the interaction logic lives in one place.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import { getUser } from '../../../firebase/firestore';
import { GlassSkeleton } from '../../../components/skeletons/GlassSkeletons';
import Icon from '../../../components/Icon';
import { readFeedCache, writeFeedCache } from '../../../utils/feedCache';
import ShortsDeck, { ShortsBackFab } from '../ShortsDeck';

export default function NativeShortsScreen() {
  const navigate = useNavigate();

  const [shorts, setShorts] = useState([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [liveStreams, setLiveStreams] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'streams'), where('status', '==', 'live'),
          orderBy('viewerCount', 'desc'), limit(10),
        ));
        if (!alive) return;
        setLiveStreams(snap.docs.map((d) => ({ id: d.id, _kind: 'live', ...d.data() })));
      } catch { /* no live slides */ }
    })();
    return () => { alive = false; };
  }, []);

  const loadShorts = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const q = query(
        collection(db, 'posts'),
        where('status', '==', 'published'),
        where('type', 'in', ['short', 'clip']),
        orderBy('createdAt', 'desc'),
        limit(30)
      );
      const snap = await getDocs(q);
      const posts = [];
      for (const d of snap.docs) {
        const post = { id: d.id, ...d.data() };
        post.videoUrl = post.mediaUrls?.[0] || post.mediaUrl || null;
        const isEmbed = !!(post.embedVideoUrl || post.youtubeVideoId);
        const isBotAuthor = String(post.authorAccountType || '').includes('bot');
        if (post.videoUrl && !isEmbed && !isBotAuthor) posts.push(post);
      }
      const authors = await Promise.all(posts.map((p) => getUser(p.authorId).catch(() => null)));
      posts.forEach((p, i) => { p.author = authors[i]; });
      setShorts(posts);
      writeFeedCache('shorts', posts);
      if (isRefresh) { setIndex(0); try { navigator.vibrate?.(12); } catch {} }
    } catch (err) {
      console.error('Failed to load shorts:', err);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    const cached = readFeedCache('shorts');
    if (cached) { setShorts(cached); setLoading(false); }
    else setLoading(true);
    loadShorts(false);
  }, [loadShorts]);

  const feed = useMemo(() => {
    if (!liveStreams.length) return shorts;
    if (!shorts.length) return liveStreams;
    const LIVE_EVERY = 4;
    const out = [];
    let li = 0;
    shorts.forEach((s, i) => {
      if ((i === 2 || (i > 2 && (i - 2) % LIVE_EVERY === 0)) && li < liveStreams.length) { out.push(liveStreams[li]); li++; }
      out.push(s);
    });
    while (li < liveStreams.length) { out.push(liveStreams[li]); li++; }
    return out;
  }, [shorts, liveStreams]);

  const goBack = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) navigate(-1);
    else navigate('/home');
  }, [navigate]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center">
        <ShortsBackFab onClick={goBack} />
        <GlassSkeleton variant="hero" style={{ width: 'min(420px, 92%)', aspectRatio: '9/16', borderRadius: 20 }} />
      </div>
    );
  }

  if (feed.length === 0) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center gap-4">
        <ShortsBackFab onClick={goBack} />
        <div className="w-20 h-20 rounded-3xl bg-surface-2/30 flex items-center justify-center">
          <Icon name="play_circle" size={44} className="text-text-muted" />
        </div>
        <div className="text-center">
          <p className="text-white font-syne font-bold text-lg">No new shorts or clips yet</p>
          <p className="text-text-muted text-sm mt-1">Be the first to upload one. Shorts show your community's vertical clips.</p>
        </div>
        <div className="flex gap-3 mt-2">
          <button onClick={() => navigate('/create/short')} className="px-6 py-3 rounded-full bg-brand-violet text-white font-bold text-sm active:scale-[0.97] transition-all">
            <span className="flex items-center gap-2"><Icon name="add" size={18} /> Create Short</span>
          </button>
          <button onClick={goBack} className="px-6 py-3 rounded-full bg-surface-2 text-text-primary text-sm font-semibold">Go Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black">
      <ShortsDeck
        feed={feed}
        index={Math.min(index, feed.length - 1)}
        setIndex={setIndex}
        isDesktop={false}
        onRefresh={() => loadShorts(true)}
        refreshing={refreshing}
        onBack={goBack}
      />
    </div>
  );
}
