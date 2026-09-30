import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import SuggestedPeopleBlock from '../../components/boost/SuggestedPeopleBlock';
import { isShortFormat, sharesToFeed } from '../../utils/helpers';
import ShortsShelf from '../../components/feed/ShortsShelf';
// How often a people-to-follow block appears in the feed. Deliberately not the
// same number as the ad interval, so the two never land together.
const SUGGEST_EVERY = 14;
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { haptic } from '../../utils/haptics';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { getFeedPosts, getTrendingPosts, getFollowingFeedPosts, getActiveFirestoreAds, getNewerFeedPosts, getVergrPinnedPosts, getVergrUid, getFollowing, getFeedPrefs, saveFeedPrefs } from '../../firebase/firestore';
import { buildForYouCtx, rankForYouStable, topicsFromText, inferPostTopics } from '../../utils/feedRank';
import { CONTENT_TOPICS } from '../../utils/constants';
import { viewerAllowsNsfw, getLocalNsfwPref } from '../../utils/nsfw';
import useNsfwPlatformFlag, { nsfwCfgFrom } from '../../hooks/useNsfwPlatformFlag';
import { setFollowingCache, isFollowingLoaded } from '../../utils/followingCache';
import { initPrefsSync, mergeRemotePrefs, flushNow } from '../../utils/feedPrefs';
import CachedImg from '../../components/CachedImg';
import { markSeen } from '../../utils/seenPosts';
import { updateUser } from '../../firebase/firestore';
import PostCard from '../../components/PostCard';
import UserAvatar from '../../components/UserAvatar';
import { FeedSkeleton } from '../../components/skeletons/GlassSkeletons';
import CoinDisplay from '../../components/CoinDisplay';
import Icon from '../../components/Icon';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import HomeFeedRail from '../../components/brand/HomeFeedRail';
import DesktopSidebar from '../../components/DesktopSidebar';
import BottomNav from '../../components/BottomNav';
import DailyRewardBanner from '../../components/DailyRewardBanner';
import SuggestionsCarousel from '../../components/SuggestionsCarousel';
import AdCard from '../../components/AdCard';
import VergrAd from '../../components/VergrAd';
import { ADS_CONFIG } from '../../config/ads';
import NewsPostCard from '../../components/NewsPostCard';
// Lazy: the composer is a modal that only exists once the user taps create, but
// it pulls in the rich-text editor, emoji picker and media compression, so as a
// static import it sat in the boot chunk on every cold start.
const CreateComposer = lazy(() => import('../../components/composer/CreateComposer'));
import useResponsive from '../../hooks/useResponsive';
import { useLayout } from '../../context/LayoutContext';
import { useLiveUsers } from '../../context/LiveUsersContext';
import { injectAdsRandomly } from '../../utils/feedInjections';
import { readFeedCache, writeFeedCache } from '../../utils/feedCache';
import { orderAdsByAffinity } from '../../utils/adMatcher';
import { doc, getDoc, collection, query, where, orderBy, limit as fbLimit, Timestamp, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getUser, loadFollowingStatuses } from '../../firebase/firestore';
import { isGroupSeen } from '../../utils/statusSeen';
import UserName from '../../components/UserName';

const FEED_TABS = ['For You', 'Following', 'Gaming News', 'Trending'];
export { FEED_TABS };

// Pull distance (post-resistance) at which a release triggers a refresh (B11-3).
const PULL_THRESHOLD = 60;

// RSS Proxy endpoint
export const RSS_PROXY_BASE = 'https://europe-west1-vergr-44494.cloudfunctions.net/rssProxy?url=';

// RSS sources with bot user IDs (to fetch avatars from Firestore)
export const NEWS_SOURCES = [
  // Major Gaming News Outlets
  { name: 'IGN', url: 'https://feeds.feedburner.com/ign/all', botId: 'news-ign' },
  { name: 'GameSpot', url: 'https://www.gamespot.com/feeds/mashup/', botId: 'news-gamespot' },
  { name: 'Kotaku', url: 'https://kotaku.com/rss', botId: 'news-kotaku' },
  { name: 'Polygon', url: 'https://www.polygon.com/rss/index.xml', botId: 'news-polygon' },
  { name: 'Eurogamer', url: 'https://www.eurogamer.net/?format=rss', botId: 'news-eurogamer' },
  { name: 'Destructoid', url: 'https://www.destructoid.com/feed/', botId: 'news-destructoid' },
  { name: 'PC Gamer', url: 'https://www.pcgamer.com/rss', botId: 'news-pcgamer' },
  { name: 'Rock Paper Shotgun', url: 'https://www.rockpapershotgun.com/feed', botId: 'news-rockpapershotgun' },
  { name: 'VG247', url: 'https://www.vg247.com/feed', botId: 'news-vg247' },
  { name: 'Nintendo Life', url: 'https://www.nintendolife.com/feed', botId: 'news-nintendolife' },
  { name: 'Push Square', url: 'https://www.pushsquare.com/feed', botId: 'news-pushsquare' },
  { name: 'Pure Xbox', url: 'https://www.purexbox.com/feed', botId: 'news-purexbox' },
  // Developer & Publisher Blogs
  { name: 'Blizzard News', url: 'https://news.blizzard.com/en-us/news?feed=rss', botId: 'news-blizzard' },
  { name: 'Xbox Wire', url: 'https://news.xbox.com/en-us/feed/', botId: 'news-xboxwire' },
  { name: 'PlayStation Blog', url: 'https://blog.playstation.com/feed/', botId: 'news-playstation' },
  { name: 'Ubisoft News', url: 'https://news.ubisoft.com/en-us/rss', botId: 'news-ubisoft' },
  { name: 'Epic Games News', url: 'https://www.epicgames.com/site/en-US/news?lang=en-US&feed=rss', botId: 'news-epicgames' },
  { name: 'Bethesda Blog', url: 'https://bethesda.net/en/dashboard?rss=news', botId: 'news-bethesda' },
  { name: 'Square Enix News', url: 'https://square-enix-games.com/en-us/news.rss', botId: 'news-squareenix' },
  { name: 'CD Projekt Red', url: 'https://www.cdprojektred.com/en/news/feed', botId: 'news-cdprojekt' },
  { name: 'Valve News', url: 'https://store.steampowered.com/news/rss/', botId: 'news-valve' },
  // Industry & Indie
  { name: 'Game Developer', url: 'https://www.gamedeveloper.com/feed', botId: 'news-gamedeveloper' },
  { name: 'Gematsu', url: 'https://www.gematsu.com/feed', botId: 'news-gematsu' },
  { name: 'Blue\'s News', url: 'https://www.bluesnews.com/rss.xml', botId: 'news-bluesnews' },
  { name: 'itch.io News', url: 'https://itch.io/games/feed', botId: 'news-itchio' },
];

export default function HomeFeedScreen({ initialTab, nativeFullWidth = false }) {
  const [activeTab, setActiveTab] = useState(
    FEED_TABS.includes(initialTab) ? initialTab : 'For You',
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createOrigin, setCreateOrigin] = useState(null);
  const openCreate = (e) => { try { setCreateOrigin(e.currentTarget.getBoundingClientRect()); } catch { setCreateOrigin(null); } setShowCreateModal(true); };
  const [ads, setAds] = useState([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const { profile, wallet } = useUser();

  // ⚠ The Gaming News tab is shown only to people who said they are into
  // games (an interest of Gaming or Esports, or games listed in Edit Profile).
  // Vergr is not only for gamers, and a Gaming News tab on everyone's home feed
  // told every creator who is not a gamer that this app was not for them. It
  // reads the profile the screen already has, so it costs nothing.
  const showGamingNews = useMemo(() => {
    const tags = profile?.gameTags || [];
    return tags.includes('Gaming') || tags.includes('Esports') || (profile?.games || []).length > 0;
  }, [profile?.gameTags, profile?.games]);
  const visibleTabs = useMemo(
    () => FEED_TABS.filter((t) => t !== 'Gaming News' || showGamingNews),
    [showGamingNews],
  );
  useEffect(() => {
    if (!showGamingNews && activeTab === 'Gaming News') setActiveTab('For You');
  }, [showGamingNews, activeTab]);
  // Remote kill switch for adult content on store builds. Defaults to false
  // while it loads, so the first frame is always the conservative one.
  const nsfwPlatformOk = useNsfwPlatformFlag();
  // Category narrowing. null = everything, which is the default and the only
  // state that existed before this shipped.
  const [activeTopic, setActiveTopic] = useState(null);
  const { currentUser } = useAuth();
  const { unreadNotifCount } = useNotifications();
  const navigate = useNavigate();
  const { isMobile: rawIsMobile, isDesktop: rawIsDesktop } = useResponsive();
  // Native app: the Android WebView reports an inflated width (~980px), which
  // makes useResponsive return the wrong tier (isMobile false, isDesktop false)
  // and hides the mobile header + FAB. Force the phone layout — never gate the
  // native layout on viewport width.
  const isMobile = nativeFullWidth ? true : rawIsMobile;
  const isDesktop = nativeFullWidth ? false : rawIsDesktop;
  const { setRightPanel, setContentAlign, setLayout } = useLayout();
  const { setNotificationsDrawerOpen } = useUI();

  // Per-tab cached state
  const [forYouPosts, setForYouPosts] = useState([]);
  const [forYouLoading, setForYouLoading] = useState(true);
  const [forYouHasMore, setForYouHasMore] = useState(true);
  const [forYouLoadingMore, setForYouLoadingMore] = useState(false);
  const forYouLastDocRef = useRef(null);
  // Ids in the order they were last committed to screen. rankForYouStable holds
  // these in place so ranking only ever positions NEW posts. Cleared on an
  // explicit refresh, which is the only time a full reshuffle is wanted.
  const shownOrderRef = useRef([]);
  const [vergrUid, setVergrUid] = useState(null); // official @Vergr account, pinned in For You
  // Cross-device prefs readiness: the FIRST For You ranking waits on this
  // (capped), exactly like TikTok/IG load the user model before the feed — so
  // the initial order already reflects the viewer's saved signal instead of
  // reshuffling after the fact. Created synchronously so the load effect can
  // await it regardless of effect order.
  const prefsReady = useRef(null);
  if (!prefsReady.current) { let r; const p = new Promise(res => { r = res; }); prefsReady.current = { p, resolve: r }; }

  const [followingPosts, setFollowingPosts] = useState([]);
  const [followingLoading, setFollowingLoading] = useState(true);
  const [followingHasMore, setFollowingHasMore] = useState(true);
  const [followingLoadingMore, setFollowingLoadingMore] = useState(false);
  const followingLastDocRef = useRef(null);

  const [trendingPosts, setTrendingPosts] = useState([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [trendingHasMore, setTrendingHasMore] = useState(true);
  const [trendingLoadingMore, setTrendingLoadingMore] = useState(false);
  const trendingLastDocRef = useRef(null);

  const [newsItems, setNewsItems] = useState([]);
  const [newsLoading, setNewsLoading] = useState(true);

  // "New posts" pill (B4): posts published since what's loaded, buffered so a tap
  // is instant (no refetch). Never auto-prepended — jumping the scroll position
  // under the user is the classic cheap-feel bug.
  const [newPending, setNewPending] = useState([]);

  // Pull-to-refresh state
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartY = useRef(0);
  const pullActive = useRef(false);
  const pullPastThreshold = useRef(false);
  const feedContainerRef = useRef(null); // MutationObserver target for feed observers (B11-7)
  const feedScrollRef = useRef(null);

  // Track which tabs have been fetched
  const fetched = useRef({ following: false, trending: false, news: false });

  // HomeFeedScreen owns its own layout — no LayoutContext plumbing.

  // Fetch ads once — Firestore ads only. Klipy ads live in the Messages media panel (GIFs/Stickers/Clips).
  useEffect(() => {
    const fetchAds = async () => {
      setAdsLoading(true);
      try {
        const firestoreAds = await getActiveFirestoreAds(10);
        // Re-order by affinity so high-relevance ads appear first
        const ordered = currentUser?.uid
          ? await orderAdsByAffinity(firestoreAds || [], currentUser.uid)
          : (firestoreAds || []);
        setAds(ordered);
      } catch {
        setAds([]);
      }
      setAdsLoading(false);
    };
    fetchAds();
  }, [currentUser?.uid]);

  // Warm the ranker's follow set once per session (For You boosts followed
  // authors). getFollowing is served from Firestore's on-device cache after the
  // first fetch, so this is cheap. Also resolve the @Vergr uid for pinning.
  useEffect(() => {
    if (currentUser?.uid && !isFollowingLoaded()) {
      getFollowing(currentUser.uid)
        .then(rows => setFollowingCache((rows || []).map(r => r.followingId)))
        .catch(() => {});
    }
    getVergrUid().then(uid => { if (uid) setVergrUid(uid); }).catch(() => {});
  }, [currentUser?.uid]);

  // Cross-device feed prefs (SLICE 3): merge the viewer's saved weight maps +
  // negatives (one owner-only read) into the local ranker, and register a
  // debounced flush so future signals persist back. Flush on tab-hide/unmount
  // so nothing is lost. Zero fan-out (own private subdoc).
  useEffect(() => {
    const uid = currentUser?.uid;
    if (!uid) { prefsReady.current.resolve(); return; }
    initPrefsSync((p) => saveFeedPrefs(uid, p));
    // Merge the saved model, THEN signal readiness (finally = resolves even on a
    // failed/empty read, so the feed can never hang waiting on prefs).
    getFeedPrefs(uid).then(mergeRemotePrefs).catch(() => {}).finally(() => prefsReady.current.resolve());
    const onHide = () => { if (document.visibilityState === 'hidden') flushNow(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); flushNow(); };
  }, [currentUser?.uid]);

  // One-time interest backfill: an account that never picked interests but has
  // listed games gets its gameTags seeded from those titles' genres (real,
  // defensible signal — not a wild guess), written to the profile so it's
  // visible + editable. Explicit interests always win: only runs when gameTags
  // is empty. Guarded per-uid so it fires at most once.
  useEffect(() => {
    const uid = currentUser?.uid;
    if (!uid || !profile) return;
    if ((profile.gameTags || []).length > 0) return;
    const key = `vergr_interest_backfill_${uid}`;
    try { if (localStorage.getItem(key)) return; } catch {}
    const topics = topicsFromText(profile.games || []);
    try { localStorage.setItem(key, '1'); } catch {}
    if (topics.length === 0) return; // nothing to infer → behavior-only, honest
    updateUser(uid, { gameTags: topics }).catch(() => {});
  }, [currentUser?.uid, profile?.gameTags, profile?.games]);

  // Fetch For You on mount. Overfetch 30 (vs 10) so the client re-ranker has a
  // real pool to personalize, and pin the latest @Vergr posts at the top for
  // every user (deduped). Hydrate from local cache first for instant paint.
  useEffect(() => {
    const cached = readFeedCache('forYou');
    if (cached) { setForYouPosts(cached); setForYouLoading(false); }
    const load = async () => {
      if (!cached) setForYouLoading(true);
      try {
        const [pinned, posts] = await Promise.all([
          getVergrPinnedPosts(3).catch(() => []),
          getFeedPosts(30).then(p => p || []),
        ]);
        const seen = new Set();
        const merged = [...pinned, ...posts].filter(p => p && !seen.has(p.id) && seen.add(p.id));
        merged._lastDoc = posts._lastDoc || null;
        // Wait for the cross-device model to merge before the first ranking so
        // the initial order is already correct (capped at 700ms so a slow read
        // can't stall the feed; the cache is on screen meanwhile → no blank, no
        // reshuffle-after-load).
        await Promise.race([prefsReady.current.p, new Promise(r => setTimeout(r, 700))]);
        // The network pool replaces the cached pool, so rank it from scratch
        // rather than pinning it behind the cached order. In the normal case
        // this is invisible: the cache now stores the RANKED 30 (same pool, same
        // weights), so the fresh ranking reproduces the order already on screen.
        shownOrderRef.current = [];
        setForYouPosts(merged);
        forYouLastDocRef.current = posts._lastDoc || null;
        setForYouHasMore(posts.length >= 30);
        // Cache is written from the ranked memo (see the effect below), not here.
      } catch { if (!cached) { setForYouPosts([]); setForYouHasMore(false); } }
      setForYouLoading(false);
    };
    load();
  }, [currentUser?.uid]);

  // Fetch Following when tab is first selected
  useEffect(() => {
    if (activeTab !== 'Following' || fetched.current.following || !currentUser?.uid) return;
    fetched.current.following = true;
    const cached = readFeedCache('following');
    if (cached) { setFollowingPosts(cached); setFollowingLoading(false); }
    const load = async () => {
      if (!cached) setFollowingLoading(true);
      try {
        const posts = await getFollowingFeedPosts(currentUser.uid, 10) || [];
        setFollowingPosts(posts);
        followingLastDocRef.current = posts._lastDoc || null;
        setFollowingHasMore(posts.length >= 10);
        writeFeedCache('following', posts);
      } catch { if (!cached) { setFollowingPosts([]); setFollowingHasMore(false); } }
      setFollowingLoading(false);
    };
    load();
  }, [activeTab, currentUser?.uid]);

  // Optimistic insert: the composer dispatches this the moment a post is
  // written, so it appears at the top of the feed instantly (X/Instagram feel)
  // instead of only showing up on the next refresh.
  useEffect(() => {
    const onCreated = (e) => {
      const post = e.detail;
      if (!post?.id) return;
      const prepend = (prev) => (prev.some(p => p.id === post.id) ? prev : [post, ...prev]);
      setForYouPosts(prepend);
      setFollowingPosts(prepend);
    };
    window.addEventListener('vergr:post-created', onCreated);
    return () => window.removeEventListener('vergr:post-created', onCreated);
  }, []);

  // ─── "New posts" pill (B4) ───
  // On refocus, check for posts newer than the newest loaded one. Buffer any hits
  // and surface a pill; DON'T prepend (would jump the scroll). One cheap query,
  // For You only. Passing a real Timestamp keeps the createdAt '>' comparison
  // type-correct (a millis number would silently match nothing).
  const checkForNewPosts = useCallback(async () => {
    if (activeTab !== 'For You' || !currentUser?.uid) return;
    let newestMs = 0;
    for (const p of forYouPosts) {
      const m = p?.createdAt?.toMillis ? p.createdAt.toMillis() : (p?.createdAt ? new Date(p.createdAt).getTime() : 0);
      if (m > newestMs) newestMs = m;
    }
    if (!newestMs) return;
    try {
      const newer = await getNewerFeedPosts(Timestamp.fromMillis(newestMs), 10) || [];
      if (!newer.length) return;
      setNewPending((prev) => {
        const have = new Set([...forYouPosts.map(p => p.id), ...prev.map(p => p.id)]);
        const add = newer.filter(p => p && !have.has(p.id));
        return add.length ? [...add, ...prev] : prev;
      });
    } catch {}
  }, [activeTab, currentUser?.uid, forYouPosts]);

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') checkForNewPosts(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', checkForNewPosts);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', checkForNewPosts); };
  }, [checkForNewPosts]);

  // Tapping the pill: prepend the buffered posts, scroll to top, clear. Ranking
  // (forYouRanked) re-runs on the new array — fresh posts naturally rank high.
  const applyNewPosts = useCallback(() => {
    setNewPending((pending) => {
      if (!pending.length) return pending;
      setForYouPosts((prev) => {
        const have = new Set(prev.map(p => p.id));
        return [...pending.filter(p => !have.has(p.id)), ...prev];
      });
      return [];
    });
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
    if (feedScrollRef.current) feedScrollRef.current.scrollTop = 0;
  }, []);

  // Fetch Trending when tab is first selected
  useEffect(() => {
    if (activeTab !== 'Trending' || fetched.current.trending) return;
    fetched.current.trending = true;
    const cached = readFeedCache('trending');
    if (cached) { setTrendingPosts(cached); setTrendingLoading(false); }
    const load = async () => {
      if (!cached) setTrendingLoading(true);
      try {
        const posts = await getTrendingPosts(10) || [];
        setTrendingPosts(posts);
        trendingLastDocRef.current = posts._lastDoc || null;
        setTrendingHasMore(posts.length >= 10);
        writeFeedCache('trending', posts);
      } catch { if (!cached) { setTrendingPosts([]); setTrendingHasMore(false); } }
      setTrendingLoading(false);
    };
    load();
  }, [activeTab]);

  // ─── Infinite scroll: load more when sentinel enters viewport ───
  const loadMoreForYou = useCallback(async () => {
    if (forYouLoadingMore || !forYouHasMore || !forYouLastDocRef.current) return;
    setForYouLoadingMore(true);
    try {
      const more = await getFeedPosts(10, forYouLastDocRef.current) || [];
      setForYouPosts(prev => {
        const have = new Set(prev.map(p => p.id));
        return [...prev, ...more.filter(p => !have.has(p.id))];
      });
      forYouLastDocRef.current = more._lastDoc || null;
      if (more.length < 10) setForYouHasMore(false);
    } catch {}
    setForYouLoadingMore(false);
  }, [forYouLoadingMore, forYouHasMore]);

  const loadMoreFollowing = useCallback(async () => {
    if (followingLoadingMore || !followingHasMore || !followingLastDocRef.current || !currentUser?.uid) return;
    setFollowingLoadingMore(true);
    try {
      const more = await getFollowingFeedPosts(currentUser.uid, 10, followingLastDocRef.current) || [];
      setFollowingPosts(prev => [...prev, ...more]);
      followingLastDocRef.current = more._lastDoc || null;
      if (more.length < 10) setFollowingHasMore(false);
    } catch {}
    setFollowingLoadingMore(false);
  }, [followingLoadingMore, followingHasMore, currentUser?.uid]);

  const loadMoreTrending = useCallback(async () => {
    if (trendingLoadingMore || !trendingHasMore || !trendingLastDocRef.current) return;
    setTrendingLoadingMore(true);
    try {
      const more = await getTrendingPosts(20, trendingLastDocRef.current) || [];
      setTrendingPosts(prev => [...prev, ...more]);
      trendingLastDocRef.current = more._lastDoc || null;
      if (more.length < 10) setTrendingHasMore(false);
    } catch {}
    setTrendingLoadingMore(false);
  }, [trendingLoadingMore, trendingHasMore]);

  // Sentinel observer — triggers loadMore for the active tab
  const sentinelRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      if (activeTab === 'For You') loadMoreForYou();
      else if (activeTab === 'Following') loadMoreFollowing();
      else if (activeTab === 'Trending') loadMoreTrending();
    }, { rootMargin: '400px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [activeTab, loadMoreForYou, loadMoreFollowing, loadMoreTrending]);

  // ─── Pull-to-refresh ───
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (activeTab === 'For You') {
        // An explicit pull is the ONE moment a full reshuffle is wanted, so drop
        // the held order and let everything be ranked fresh.
        shownOrderRef.current = [];
        // Get newest timestamp
        const newest = forYouPosts[0]?.createdAt;
        if (newest) {
          const newer = await getNewerFeedPosts(newest, 10);
          if (newer.length > 0) setForYouPosts(prev => [...newer, ...prev]);
        } else {
          const posts = await getFeedPosts(10) || [];
          setForYouPosts(posts);
          forYouLastDocRef.current = posts._lastDoc || null;
        }
        setNewPending([]); // pull-to-refresh already brings newer in → clear the pill
      } else if (activeTab === 'Following' && currentUser?.uid) {
        const posts = await getFollowingFeedPosts(currentUser.uid, 10) || [];
        setFollowingPosts(posts);
        followingLastDocRef.current = posts._lastDoc || null;
      } else if (activeTab === 'Trending') {
        const posts = await getTrendingPosts(10) || [];
        setTrendingPosts(posts);
        trendingLastDocRef.current = posts._lastDoc || null;
      }
    } catch {}
    setRefreshing(false);
  }, [activeTab, currentUser?.uid, forYouPosts]);

  // Pull-to-refresh touch handlers (mobile only)
  useEffect(() => {
    if (!isMobile) return;
    const onTouchStart = (e) => {
      if (window.scrollY <= 0 && !refreshing) {
        pullStartY.current = e.touches[0].clientY;
        pullActive.current = true;
      }
    };
    const onTouchMove = (e) => {
      if (!pullActive.current) return;
      const delta = e.touches[0].clientY - pullStartY.current;
      if (delta > 0) {
        // Resistance curve: 1:1 for the first 40px, then dampen to 0.5 so the
        // pull feels rubbery (native) instead of a linear finger-follow.
        const dist = delta <= 40 ? delta : 40 + (delta - 40) * 0.5;
        // Haptic once as the pull crosses the release threshold.
        if (dist >= PULL_THRESHOLD && !pullPastThreshold.current) { pullPastThreshold.current = true; haptic.light(); }
        else if (dist < PULL_THRESHOLD) pullPastThreshold.current = false;
        setPullDistance(Math.min(dist, 90));
      } else {
        pullActive.current = false;
        pullPastThreshold.current = false;
        setPullDistance(0);
      }
    };
    const onTouchEnd = () => {
      if (!pullActive.current) return;
      pullActive.current = false;
      if (pullPastThreshold.current) handleRefresh();
      pullPastThreshold.current = false;
      setPullDistance(0); // spring settle (the indicator has transition-all)
    };
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [isMobile, handleRefresh, refreshing]);

  // ─── Video autoplay on scroll ───
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const v = entry.target;
        if (!(v instanceof HTMLVideoElement)) continue;
        if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
          v.play().catch(() => {});
        } else {
          if (!v.paused) v.pause();
        }
      }
    }, { threshold: [0, 0.5, 1] });

    // Observe all feed videos. Re-attach as new cards render — driven by a
    // MutationObserver on the feed container (attaches on added nodes) instead
    // of a 1.5s idle poll that burned battery even with nothing new (B11-7).
    const attach = () => {
      document.querySelectorAll('video[data-feed-video="1"]').forEach(v => obs.observe(v));
    };
    attach();
    const root = feedContainerRef.current;
    const mo = root ? new MutationObserver(attach) : null;
    if (mo && root) mo.observe(root, { childList: true, subtree: true });
    return () => { mo?.disconnect(); obs.disconnect(); };
  }, [activeTab, forYouPosts, followingPosts, trendingPosts]);

  // ─── Seen tracking: mark a post seen after its card is ≥60% visible for ~1s.
  // Feeds feedRank's seen-demotion so the feed doesn't feel frozen between
  // sessions. Cheap: observes [data-post-id] roots, unobserves each after firing.
  useEffect(() => {
    const timers = new Map();
    const obs = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target;
        const id = el.getAttribute('data-post-id');
        if (!id) continue;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          if (!timers.has(id)) {
            timers.set(id, setTimeout(() => { markSeen(id); obs.unobserve(el); timers.delete(id); }, 1000));
          }
        } else {
          const t = timers.get(id);
          if (t) { clearTimeout(t); timers.delete(id); }
        }
      }
    }, { threshold: [0, 0.6, 1] });
    const attach = () => { document.querySelectorAll('[data-post-id]').forEach(el => obs.observe(el)); };
    attach();
    // Attach to newly-rendered cards via a MutationObserver (no idle poll, B11-7).
    const root = feedContainerRef.current;
    const mo = root ? new MutationObserver(attach) : null;
    if (mo && root) mo.observe(root, { childList: true, subtree: true });
    return () => { mo?.disconnect(); obs.disconnect(); for (const t of timers.values()) clearTimeout(t); };
  }, [activeTab, forYouPosts, followingPosts, trendingPosts]);

  // Fetch Gaming News when tab is first selected (using RSS proxy + bot avatars).
  // Bot avatars are persisted to localStorage with a 7-day TTL — these accounts
  // never change their avatar, so we should NOT pay 25 Firestore reads every time
  // someone opens this tab.
  useEffect(() => {
    if (activeTab !== 'Gaming News' || fetched.current.news) return;
    fetched.current.news = true;

    // B6: render last-seen news INSTANTLY from cache, then refresh in the
    // background. The slow part is 25 parallel RSS fetches (≤10s each) on every
    // open — caching the merged result kills the perceived wait the founder saw.
    const NEWS_ITEMS_CACHE_KEY = 'vergr_news_items_v1';
    let hadNewsCache = false;
    try {
      const raw = localStorage.getItem(NEWS_ITEMS_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.items?.length) {
          setNewsItems(parsed.items);
          setNewsLoading(false);
          hadNewsCache = true;
        }
      }
    } catch {}

    const fetchNews = async () => {
      if (!hadNewsCache) setNewsLoading(true);

      const NEWS_AVATAR_CACHE_KEY = 'vergr_news_bot_avatars_v1';
      const NEWS_AVATAR_TTL_MS = 7 * 24 * 60 * 60 * 1000;

      // 1. Try the localStorage cache first
      let avatarCache = {};
      let cacheStale = true;
      try {
        const raw = localStorage.getItem(NEWS_AVATAR_CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.savedAt && Date.now() - parsed.savedAt < NEWS_AVATAR_TTL_MS && parsed.avatars) {
            avatarCache = parsed.avatars;
            cacheStale = false;
          }
        }
      } catch {}

      // 2. Kick off RSS fetches in parallel — and only fetch avatars if cache is stale
      const [rssResults, avatarResults] = await Promise.all([
        Promise.allSettled(
          NEWS_SOURCES.map(async (source) => {
            const proxyUrl = `${RSS_PROXY_BASE}${encodeURIComponent(source.url)}`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            try {
              const res = await fetch(proxyUrl, { signal: controller.signal });
              clearTimeout(timeoutId);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const data = await res.json();
              return { source, items: data.items || [] };
            } catch (err) {
              clearTimeout(timeoutId);
              console.warn(`Failed to fetch ${source.name}:`, err.message);
              return { source, items: [] };
            }
          })
        ),
        cacheStale
          ? Promise.allSettled(
              NEWS_SOURCES.map(async (source) => {
                if (!source.botId) return { botId: null, avatar: null };
                try {
                  const userDoc = await getDoc(doc(db, 'users', source.botId));
                  return {
                    botId: source.botId,
                    avatar: userDoc.exists() ? userDoc.data().avatar || null : null,
                  };
                } catch {
                  return { botId: source.botId, avatar: null };
                }
              })
            )
          : Promise.resolve([]),
      ]);

      // 3. Refresh cache if we did fetch new avatars
      if (cacheStale) {
        for (const r of avatarResults) {
          if (r.status === 'fulfilled' && r.value.botId) {
            avatarCache[r.value.botId] = r.value.avatar;
          }
        }
        try {
          localStorage.setItem(
            NEWS_AVATAR_CACHE_KEY,
            JSON.stringify({ savedAt: Date.now(), avatars: avatarCache })
          );
        } catch {}
      }

      // Merge RSS items with avatars
      const allNews = [];
      for (const r of rssResults) {
        if (r.status !== 'fulfilled') continue;
        const { source, items } = r.value;
        for (const item of items) {
          allNews.push({
            ...item,
            source: source.name,
            avatar: avatarCache[source.botId] || null,
          });
        }
      }

      if (allNews.length === 0) {
        // Allow re-fetch if everything failed — keep any cached items showing.
        fetched.current.news = false;
        setNewsLoading(false);
        return;
      }

      const sorted = allNews.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate)).slice(0, 50);
      setNewsItems(sorted);
      setNewsLoading(false);
      try {
        localStorage.setItem(NEWS_ITEMS_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), items: sorted }));
      } catch {}
    };
    fetchNews();
  }, [activeTab]);

  const handleDeletePost = (tabSetter) => (id) => tabSetter(prev => prev.filter(p => p.id !== id));

  const createLikeUpdateHandler = (tabSetter) => (postId, newLikeCount) => {
    tabSetter(prev => prev.map(post => 
      post.id === postId ? { ...post, likeCount: newLikeCount } : post
    ));
  };

  const [newsVideoViewer, setNewsVideoViewer] = useState(null);

  const handleOpenNewsVideo = (item) => {
    // Collect all news items that have YouTube videos for the viewer
    const videoItems = newsItems.filter(n => n.youtubeVideoId);
    const idx = videoItems.findIndex(n => n === item || (n.youtubeVideoId === item.youtubeVideoId && n.title === item.title));
    setNewsVideoViewer({ items: videoItems, index: Math.max(0, idx) });
  };

  const renderGamingNews = () => {
    if (newsLoading) {
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-10 h-10 border-4 border-brand-violet border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-text-muted text-sm font-dmmono">Fetching gaming news...</p>
        </div>
      );
    }
    if (newsItems.length === 0) {
      return <div className="text-center py-20 px-6"><p className="text-text-muted">No news available</p></div>;
    }
    const newsEls = [];
    let newsSinceAd = 0;
    newsItems.forEach((item, idx) => {
      newsEls.push(<NewsPostCard key={`${item.source}-${idx}`} item={item} onOpenVideo={handleOpenNewsVideo} />);
      newsSinceAd++;
      if (newsSinceAd >= ADS_CONFIG.feedAdInterval) {
        newsEls.push(<VergrAd key={`vergrad-news-${idx}`} zone="inpage" />);
        newsSinceAd = 0;
      }
    });
    return newsEls;
  };

  // Client re-rank for "For You": recency + following + genre interest + locale
  // + @Vergr pin − seen − bots − "not interested".
  //
  // STABILITY: posts already on screen KEEP their position (rankForYouStable).
  // Ranking only ever decides where NEW posts land. Without this, appending
  // page 2 re-sorted page 1 above the user's scroll position, and the instant
  // cache paint was reshuffled the moment the network page arrived — both read
  // as "the feed keeps changing". shownOrderRef is cleared on an explicit
  // refresh (pull-to-refresh), which is the one moment a full re-rank is wanted.
  const forYouRanked = useMemo(() => {
    // Adult content is filtered OUT unless ALL THREE hold: the viewer asked
    // for it, the viewer is age-verified, and this build is permitted to show
    // it. The third comes from app_config so a store build can be made clean
    // remotely, and defaults to hidden while the flag is still loading.
    const allowNsfw = viewerAllowsNsfw({
      profile, pref: getLocalNsfwPref(), cfg: nsfwCfgFrom(nsfwPlatformOk),
    });
    const ctx = buildForYouCtx({ profile, vergrUid, allowNsfw });
    const out = rankForYouStable([...forYouPosts], ctx, shownOrderRef.current);
    shownOrderRef.current = out.map((p) => p.id);

    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forYouPosts, vergrUid, profile?.gameTags, profile?.games, nsfwPlatformOk]);

  // Category narrowing lives in its OWN memo, deliberately downstream of the one
  // above and of the cache write below it.
  //
  // It was briefly folded into forYouRanked, which was a bug: writeFeedCache
  // persists that value, so a viewer who filtered to "Music" and closed the app
  // would have had a Music-only feed restored on the next cold open, presented
  // as their whole feed with no chip selected to explain it.
  //
  // Applied AFTER ranking so the chips reorder nothing: picking a topic shows
  // the same feed with everything else removed, in the order it already had.
  //
  // `inferPostTopics` rather than a bare `post.topic` check, because the tag is
  // optional. Most posts carry no explicit topic and are matched from their text
  // and hashtags, so an equality check would make every chip look broken.
  const forYouVisible = useMemo(() => {
    if (!activeTopic) return forYouRanked;
    const want = activeTopic.toLowerCase();
    return forYouRanked.filter((p) => {
      for (const t of inferPostTopics(p)) {
        if (String(t).toLowerCase() === want) return true;
      }
      return false;
    });
  }, [forYouRanked, activeTopic]);

  // Persist the RANKED order (not the raw chronological merge) so the next cold
  // open paints in exactly the order it was left in and has nothing to correct.
  useEffect(() => {
    if (forYouRanked.length) writeFeedCache('forYou', forYouRanked);
  }, [forYouRanked]);

  const renderForYou = () => {
    if (forYouLoading) {
      return <FeedSkeleton count={3} />;
    }

    let feedItems = [...forYouVisible];
    if (ads.length > 0 && !adsLoading) {
      feedItems = injectAdsRandomly(feedItems, ads, 3, 6);
    }

    const elements = [];
    elements.push(<SuggestionsCarousel key="carousel-top" />);

    // A clip SHARED TO FEED sits inline, as Instagram shows a reel in the home
    // feed. A clip that is not shared goes to the Clips shelf instead, so it is
    // still discoverable here without being in the feed. Each clip renders in
    // exactly one of the two, never both (utils/helpers.js sharesToFeed).
    const shortForm = feedItems.filter((it) => !it.isAd && !sharesToFeed(it));
    const longForm = feedItems.filter((it) => it.isAd || sharesToFeed(it));
    void isShortFormat;
    // A few posts down, the way YouTube places it: at the very top it competes
    // with the suggestions carousel already sitting above.
    const SHELF_AFTER = 3;

    // Track real-post index separately so PropellerAds slots are spaced
     // by *content posts seen*, not by mixed (post + user-ad) positions.
    let postsSinceAd = 0;
    let postsSinceSuggest = 0;
    let realPosts = 0;
    longForm.forEach((item, index) => {
      if (item.isAd) {
        elements.push(<AdCard key={`ad-${item.id || index}`} ad={item} />);
      } else {
        elements.push(
          <PostCard
            key={item.id}
            post={item}
            onDeleted={handleDeletePost(setForYouPosts)}
            onLikeUpdate={createLikeUpdateHandler(setForYouPosts)}
          />
        );
        realPosts++;
        if (realPosts === SHELF_AFTER && shortForm.length) {
          elements.push(<ShortsShelf key="shorts-shelf" posts={shortForm} />);
        }
        postsSinceAd++;
        if (postsSinceAd >= ADS_CONFIG.feedAdInterval) {
          elements.push(<VergrAd key={`vergrad-${index}`} zone="inpage" />);
          postsSinceAd = 0;
        }
        // ⚠ THE ONLY BOOST INVENTORY THAT SCALES. A rail has four slots forever;
        // this appears again every SUGGEST_EVERY posts, so inventory grows with
        // scroll depth. Offset from the ad interval so a reader never gets an ad
        // and a suggestion block back to back.
        postsSinceSuggest++;
        if (postsSinceSuggest >= SUGGEST_EVERY) {
          elements.push(<SuggestedPeopleBlock key={`suggest-${index}`} slotKey={index} />);
          postsSinceSuggest = 0;
        }
      }
    });

    // Short feed: the loop never reached SHELF_AFTER, so the shelf would have
    // been dropped precisely when short-form is most of what exists.
    if (shortForm.length && !elements.some((e) => e?.key === 'shorts-shelf')) {
      elements.push(<ShortsShelf key="shorts-shelf" posts={shortForm} />);
    }

    if (elements.length <= 1) {
      elements.push(
        <div key="empty" className="text-center py-20 px-6">
          <div className="w-20 h-20 bg-surface-1 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-white/[0.06]"><Icon name="dynamic_feed" size={40} className="text-text-muted/30" /></div>
          <h3 className="font-syne font-bold text-text-primary text-xl mb-2">Your feed is empty</h3>
          <p className="text-text-muted max-w-xs mx-auto mb-6">Follow people and explore to see posts here.</p>
          <button onClick={() => navigate('/explore')} className="px-6 py-2.5 rounded-full bg-brand-violet text-white font-bold text-sm">Explore</button>
        </div>
      );
    }
    // Crossfade content in over the removed skeleton (B11-5).
    return <div className="feed-fade-in">{elements}</div>;
  };

  const renderFollowing = () => {
    if (followingLoading) {
      return <FeedSkeleton count={3} />;
    }
    if (followingPosts.length === 0) {
      return <div className="text-center py-20 px-6"><div className="w-20 h-20 bg-surface-1 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-white/[0.06]"><Icon name="person_add" size={40} className="text-text-muted/30" /></div><h3 className="font-syne font-bold text-text-primary text-xl mb-2">No followed posts</h3><p className="text-text-muted max-w-xs mx-auto mb-6">Follow people to see their posts here.</p><button onClick={() => navigate('/explore')} className="px-6 py-2.5 rounded-full bg-brand-violet text-white font-bold text-sm">Explore</button></div>;
    }
    const els = [];
    let sinceAd = 0;
    // A clip its creator did not share to feed belongs in Clips, not here.
    followingPosts.filter(sharesToFeed).forEach((post) => {
      els.push(
        <PostCard
          key={post.id}
          post={post}
          onDeleted={handleDeletePost(setFollowingPosts)}
          onLikeUpdate={createLikeUpdateHandler(setFollowingPosts)}
        />
      );
      sinceAd++;
      if (sinceAd >= ADS_CONFIG.feedAdInterval) {
        els.push(<VergrAd key={`vergrad-following-${post.id}`} zone="inpage" />);
        sinceAd = 0;
      }
    });
    return <div className="feed-fade-in">{els}</div>;
  };

  const renderTrending = () => {
    if (trendingLoading) {
      return <FeedSkeleton count={3} />;
    }
    if (trendingPosts.length === 0) {
      return <div className="text-center py-20 px-6"><p className="text-text-muted">No trending posts yet</p></div>;
    }
    const els = [];
    let sinceAd = 0;
    trendingPosts.filter(sharesToFeed).forEach((post) => {
      els.push(
        <PostCard
          key={post.id}
          post={post}
          onDeleted={handleDeletePost(setTrendingPosts)}
          onLikeUpdate={createLikeUpdateHandler(setTrendingPosts)}
        />
      );
      sinceAd++;
      if (sinceAd >= ADS_CONFIG.feedAdInterval) {
        els.push(<VergrAd key={`vergrad-trending-${post.id}`} zone="inpage" />);
        sinceAd = 0;
      }
    });
    return <div className="feed-fade-in">{els}</div>;
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'For You': return renderForYou();
      case 'Following': return renderFollowing();
      case 'Gaming News': return renderGamingNews();
      case 'Trending': return renderTrending();
      default: return renderForYou();
    }
  };

  const feedContent = (
    <div className="min-h-screen pb-20 lg:pb-0">
      {isMobile && (
        <header className="sticky top-0 z-40 glass-header px-4 flex items-center justify-between" style={{ minHeight: IS_NATIVE_BUILD ? 'calc(60px + env(safe-area-inset-top, 0px))' : 'calc(52px + env(safe-area-inset-top, 0px))', paddingTop: IS_NATIVE_BUILD ? 'calc(env(safe-area-inset-top, 0px) + 8px)' : 'env(safe-area-inset-top, 0px)' }}>
          <div className="flex items-center gap-3"><button onClick={() => window.dispatchEvent(new Event('vergr:open-nav-drawer'))} aria-label="Open menu" className="shrink-0"><CachedImg src={profile?.avatar || '/logo.png'} permanent alt="" className="w-8 h-8 rounded-full object-cover" /></button><h1 className="font-syne font-bold text-lg tracking-tight text-text-primary">VERGR</h1></div>
          <div className="flex items-center gap-3"><CoinDisplay amount={wallet?.balance || 0} size="sm" /><button onClick={() => setNotificationsDrawerOpen(true)} className="relative"><Icon name="notifications" size={22} className="text-text-secondary" />{unreadNotifCount > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-brand-ember text-[10px] flex items-center justify-center font-bold text-white border-2 border-bg-dark">{unreadNotifCount > 9 ? '9+' : unreadNotifCount}</span>}</button></div>
        </header>
      )}
      {/* Desktop composer row — narrower composer + New Post + bell, no
          page title or subtitle (the left sidebar already labels the
          section, and the feed itself is self-evident). */}
      {isDesktop && (
        <div className="px-6 pt-6 pb-4">
          {/* Centered cluster — re-centers into whatever width the main column
              has (e.g. when the left sidebar is collapsed), rather than hugging
              the left edge. */}
          <div className="max-w-[760px] mx-auto flex items-center gap-3">
            <button
              onClick={openCreate}
              className="flex-1 flex items-center gap-3 p-3 rounded-2xl bg-[#15151F] hover:bg-[#1A1A26] text-left">
              <CachedImg
                src={profile?.avatar || '/brand/logo.png'}
                permanent
                alt=""
                className="w-9 h-9 rounded-full object-cover shrink-0"
              />
              <span className="flex-1 text-[13px] text-text-muted">Share something with the squad…</span>
            </button>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-4 py-3 rounded-2xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-xs font-bold shadow-lg shadow-brand-violet/30 hover:brightness-110">
              <Icon name="add" size={15} /> New Post
            </button>
            <button
              onClick={() => setNotificationsDrawerOpen(true)}
              className="relative w-11 h-11 rounded-2xl bg-[#15151F] hover:bg-[#1A1A26] flex items-center justify-center text-text-secondary"
              title="Notifications">
              <Icon name="notifications" size={18} />
              {unreadNotifCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-brand-ember text-[10px] font-bold text-white flex items-center justify-center px-1">
                  {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                </span>
              )}
            </button>
          </div>
        </div>
      )}

      <div className="sticky z-30 glass-header px-2" style={{ top: isDesktop ? 0 : (IS_NATIVE_BUILD ? 'calc(60px + env(safe-area-inset-top, 0px))' : 'calc(52px + env(safe-area-inset-top, 0px))') }}>
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar px-2 py-2">
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-none px-4 py-1.5 text-[12px] font-semibold whitespace-nowrap rounded-full transition-colors relative ${
                activeTab === tab
                  ? 'text-white'
                  : 'text-text-muted hover:text-text-primary hover:bg-white/[0.04] rounded-full'
              }`}
            >
              {activeTab === tab && (
                <motion.span
                  layoutId="feedTabPill"
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  className="absolute inset-0 rounded-full bg-gradient-to-r from-brand-violet to-brand-pink shadow-md shadow-brand-violet/30"
                />
              )}
              <span className="relative z-10">{tab}</span>
            </button>
          ))}
        </div>
      </div>
      {/* Category row. A SEPARATE row under the tab bar rather than more chips
          inside it: the tab bar already scrolls horizontally, and folding twenty
          topics into it would push For You / Following out of view on a phone.
          Adult content is NOT a category here. It is a rating on its own axis
          (utils/nsfw.js), because a topic is an interest and mixing the two
          would make "likes Gaming" start pulling NSFW through the same weight
          map the ranker uses. */}
      <div className="sticky z-20 glass-header px-2" style={{ top: 'auto' }}>
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar px-2 py-1.5">
          <button
            onClick={() => setActiveTopic(null)}
            className={`flex-none px-3 py-1 text-[11px] font-semibold whitespace-nowrap rounded-full transition-colors ${
              activeTopic === null
                ? 'bg-[#262634] text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-white/[0.04]'
            }`}
          >
            All
          </button>
          {CONTENT_TOPICS.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTopic((prev) => (prev === t ? null : t))}
              className={`flex-none px-3 py-1 text-[11px] font-semibold whitespace-nowrap rounded-full transition-colors ${
                activeTopic === t
                  ? 'bg-[#262634] text-white'
                  : 'text-text-muted hover:text-text-primary hover:bg-white/[0.04]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      {/* "New posts" pill (B4) — For You only; drops in under the tab bar. */}
      {activeTab === 'For You' && newPending.length > 0 && (
        <button
          onClick={applyNewPosts}
          className="new-posts-pill fixed z-40 inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-gradient-to-r from-brand-violet to-brand-pink text-white text-[12px] font-bold shadow-lg shadow-brand-violet/40 hover:brightness-110 active:scale-95 transition-transform"
          style={{ top: isDesktop ? 124 : (IS_NATIVE_BUILD ? 'calc(env(safe-area-inset-top, 0px) + 104px)' : 'calc(env(safe-area-inset-top, 0px) + 96px)') }}
        >
          <Icon name="arrow_upward" size={15} />
          {newPending.length} new post{newPending.length > 1 ? 's' : ''}
        </button>
      )}
      <HomeStoriesStrip onNavigate={navigate} />
      <DailyRewardBanner />

      {/* Pull-to-refresh indicator */}
      {(pullDistance > 0 || refreshing) && (
        <div
          className="flex items-center justify-center overflow-hidden transition-all"
          style={{ height: refreshing ? 50 : pullDistance }}
        >
          <div className={`w-5 h-5 border-2 border-surface-3 border-t-brand-violet rounded-full ${refreshing ? 'animate-spin' : ''}`} />
        </div>
      )}

      {/* data-feed-root: the native in-feed ad watches this subtree so a slot
          re-reports its document position when posts load/prepend above it. */}
      <div ref={feedContainerRef} data-feed-root className="flex-1 w-full">{renderContent()}</div>

      {/* Infinite scroll sentinel + loader */}
      {(activeTab === 'For You' || activeTab === 'Following' || activeTab === 'Trending') && (
        <div ref={sentinelRef} className="py-6 flex justify-center">
          {(forYouLoadingMore && activeTab === 'For You') ||
           (followingLoadingMore && activeTab === 'Following') ||
           (trendingLoadingMore && activeTab === 'Trending') ? (
            <div className="w-5 h-5 border-2 border-surface-3 border-t-brand-violet rounded-full animate-spin" />
          ) : (
            (activeTab === 'For You' && !forYouHasMore && forYouPosts.length > 0) ||
            (activeTab === 'Following' && !followingHasMore && followingPosts.length > 0) ||
            (activeTab === 'Trending' && !trendingHasMore && trendingPosts.length > 0) ? (
              <p className="text-text-muted text-xs font-dmmono">You're all caught up</p>
            ) : null
          )}
        </div>
      )}
      {isMobile && <button aria-label="Create post" onClick={() => setShowCreateModal(true)} style={{ bottom: 'calc(72px + var(--vg-safe-b, 0px))' }} className="fixed right-4 w-14 h-14 rounded-full bg-brand-violet flex items-center justify-center z-40 shadow-lg shadow-black/40 hover:brightness-110 active:scale-95 transition-all"><Icon name="add" size={26} className="text-white" /></button>}
      {showCreateModal && (
        <Suspense fallback={null}>
          <CreateComposer onClose={() => setShowCreateModal(false)} originRect={createOrigin} />
        </Suspense>
      )}
      {newsVideoViewer && (
        <NewsVideoViewer
          items={newsVideoViewer.items}
          startIndex={newsVideoViewer.index}
          onClose={() => setNewsVideoViewer(null)}
        />
      )}
    </div>
  );

  // HomeFeedScreen owns its full chrome — no MainLayout / ResponsiveLayout wrapper.
  if (!isDesktop) {
    // Native app: fill the phone width. The Android WebView reports an inflated
    // viewport (~980px), so the 480px-centered web column leaves dead gutters on
    // a real phone — the native feed goes full-width instead.
    return (
      <div className="min-h-screen bg-bg-dark">
        <div className={`${nativeFullWidth ? 'w-full' : 'max-w-[480px] mx-auto'} min-h-screen relative pb-20`}>
          {feedContent}
          <BottomNav />
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-bg-dark">
      <DesktopSidebar />
      <DesktopHomeShell>
        <div className="flex-1 min-w-0">
          {feedContent}
        </div>
        {/* The rail is told which posts are already on screen, so its Clips and
            fallback Trending cards cost no read. */}
        <aside className="w-[300px] shrink-0 bg-[#0e0e1a] sticky top-0 h-screen overflow-y-auto no-scrollbar">
          <HomeFeedRail posts={forYouVisible} />
        </aside>
      </DesktopHomeShell>
    </div>
  );
}

// Shell that sits next to the fixed sidebar — listens for collapse events and
// shifts its left margin so the feed/rail fill the remaining viewport width
// with no empty gutters on either side.
function DesktopHomeShell({ children }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('vergr_sidebar_collapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    const handler = (e) => setCollapsed(e.detail?.collapsed ?? false);
    window.addEventListener('sidebar-toggle', handler);
    return () => window.removeEventListener('sidebar-toggle', handler);
  }, []);
  return (
    <div
      style={{ marginLeft: collapsed ? 72 : 240 }}
      className="flex min-h-screen transition-[margin] duration-200"
    >
      {children}
    </div>
  );
}

// Stories / Live strip — horizontal row of circular avatars with optional LIVE badge.
// Stories strip — real data only. Loads active statuses (last 24h) grouped
// by author from Firestore. Tap "Your Story" → if you have a status, opens
// the viewer at your status; if not, drops into the status create flow. Tap
// anyone else's avatar → opens the viewer at theirs.
export function HomeStoriesStrip({ onNavigate }) {
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const [groups, setGroups] = useState([]); // [{ uid, author, items[] }]
  const [myStatusCount, setMyStatusCount] = useState(0);
  // Live hosts come from the app-wide onSnapshot in LiveUsersContext, so the
  // strip updates in real time: a stream that starts while the user sits on
  // the feed appears here within seconds (no stale one-shot query on mount).
  const { liveHosts: allLiveHosts, isUserLive } = useLiveUsers();
  // Your OWN live status comes from the unfiltered map (isUserLive), so the ring
  // shows even when your stream is unlisted/followers-only and even before you
  // post a story — matching the ring on your profile (which the founder saw
  // while the home strip stayed blank).
  const selfLive = isUserLive(currentUser?.uid);
  const liveHosts = useMemo(() => {
    const m = new Map();
    for (const [uid, info] of allLiveHosts) {
      if (info.discoverable) m.set(uid, info);
    }
    return m;
  }, [allLiveHosts]);
  const liveHostIds = liveHosts; // .has(uid) works on a Map too

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    (async () => {
      try {
        // Only statuses from people I follow (+ my own), matching the viewer
        // scope enforced by the rules. The old global query showed strangers.
        const all = await loadFollowingStatuses(currentUser.uid);
        const grouped = new Map();
        for (const data of all) {
          if (!data.authorId) continue;
          if (!grouped.has(data.authorId)) grouped.set(data.authorId, { uid: data.authorId, items: [], author: null });
          grouped.get(data.authorId).items.push(data);
        }
        // Resolve authors in parallel (skip self — we use profile).
        await Promise.all(
          Array.from(grouped.keys())
            .filter(uid => uid !== currentUser.uid)
            .map(async uid => {
              const u = await getUser(uid).catch(() => null);
              if (u) grouped.get(uid).author = u;
            }),
        );
        if (cancelled) return;
        // Pull my statuses out and surface count separately.
        const mineGroup = grouped.get(currentUser.uid);
        setMyStatusCount(mineGroup ? mineGroup.items.length : 0);
        grouped.delete(currentUser.uid);
        // Unseen groups first (stories convention), then newest.
        const sorted = Array.from(grouped.values()).sort((a, b) => {
          const aSeen = isGroupSeen(currentUser.uid, a.uid, a.items[0]?.id);
          const bSeen = isGroupSeen(currentUser.uid, b.uid, b.items[0]?.id);
          if (aSeen !== bSeen) return aSeen ? 1 : -1;
          const at = a.items[0]?.createdAt?.toMillis?.() || 0;
          const bt = b.items[0]?.createdAt?.toMillis?.() || 0;
          return bt - at;
        });
        setGroups(sorted);
      } catch (err) {
        console.error('Stories strip load failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser]);

  const handleSelf = () => {
    if (myStatusCount > 0) {
      onNavigate('/status?viewing=me');
    } else {
      // First-time post: open the status screen with the composer flag so it
      // auto-opens the create UI (same behavior as Instagram / WhatsApp).
      onNavigate('/status?compose=1');
    }
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3 overflow-x-auto no-scrollbar">
        {/* Your Story — always first */}
        <button onClick={handleSelf} className="flex flex-col items-center gap-1.5 shrink-0 w-[64px]">
          <div className="relative">
            {(myStatusCount > 0 || selfLive) ? (
              // You have a story OR you're live — VP rank ring + live override.
              <UserAvatar
                src={profile?.avatar || profile?.photoURL}
                size={56}
                vpLevel={profile?.vpLevel || 1}
                isVerified={profile?.isVerified}
                isLive={selfLive}
              />
            ) : (
              <div className="w-[56px] h-[56px] rounded-full bg-surface-2 border-2 border-dashed border-white/[0.15] flex items-center justify-center hover:border-brand-violet/40 transition-colors">
                <Icon name="add" size={22} className="text-text-primary" />
              </div>
            )}
          </div>
          <span className="text-[10px] font-dmmono text-text-secondary truncate w-full text-center">
            {selfLive ? 'Live' : (myStatusCount > 0 ? 'Your Story' : 'Add Story')}
          </span>
        </button>

        {/* Live now — surfaced first, even if the streamer has no status. Taps
            straight into the watch page (mainstream "tap the live ring" UX). */}
        {Array.from(liveHosts.entries())
          .filter(([uid]) => uid !== currentUser?.uid)
          .map(([uid, info]) => (
            <button
              key={`live-${uid}`}
              onClick={() => onNavigate(`/watch/${info.streamId}`)}
              className="flex flex-col items-center gap-1.5 shrink-0 w-[64px]"
            >
              {/* A paid stream rings violet and reads PREMIUM, so the circle
                  itself says it costs coins before anyone taps in. */}
              <UserAvatar src={info.avatar} size={56} isLive isPremiumLive={info.isPremium} />
              <span className="text-[10px] font-dmmono text-text-secondary truncate w-full text-center">
                {info.name || 'Live'}
              </span>
            </button>
          ))}

        {/* Other users' stories (live hosts already shown above are excluded) */}
        {groups.filter(g => !liveHosts.has(g.uid)).map(g => {
          const a = g.author;
          const name = a?.displayName || a?.username || 'User';
          const seen = isGroupSeen(currentUser.uid, g.uid, g.items[0]?.id);
          return (
            <button
              key={g.uid}
              onClick={() => onNavigate(`/status?viewing=${g.uid}`)}
              className="flex flex-col items-center gap-1.5 shrink-0 w-[64px]"
            >
              <div className="relative flex">
                <UserAvatar
                  src={a?.avatar || a?.photoURL}
                  size={56}
                  vpLevel={a?.vpLevel || 1}
                  isVerified={a?.isVerified}
                  isLive={liveHostIds.has(g.uid)}
                  isPremiumLive={!!allLiveHosts.get(g.uid)?.isPremium}
                />
                {/* Story ring: bright violet = unseen, dim = already viewed.
                    z-20 so the avatar img (z-10) doesn't paint over it. */}
                {!liveHostIds.has(g.uid) && (
                  <div className={`absolute inset-0 z-20 rounded-full ring-2 ring-offset-2 ring-offset-bg-dark pointer-events-none ${seen ? 'ring-white/15' : 'ring-brand-violet-light'}`} />
                )}
              </div>
              <span className="text-[10px] font-dmmono text-text-secondary truncate w-full text-center"><UserName user={a} masked fallback={name} /></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Full-screen video viewer for news videos.
 * X/Twitter-style: swipe/scroll to next video, video controls, info overlay.
 */
export function NewsVideoViewer({ items, startIndex, onClose }) {
  const [index, setIndex] = useState(startIndex);
  const containerRef = useRef(null);
  const touchStartY = useRef(0);
  const item = items[index];

  const goNext = useCallback(() => { if (index < items.length - 1) setIndex(i => i + 1); }, [index, items.length]);
  const goPrev = useCallback(() => { if (index > 0) setIndex(i => i - 1); }, [index]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'j') goNext();
      else if (e.key === 'ArrowUp' || e.key === 'k') goPrev();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goNext, goPrev, onClose]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let wheelTimeout;
    const handleWheel = (e) => {
      e.preventDefault();
      clearTimeout(wheelTimeout);
      wheelTimeout = setTimeout(() => {
        if (e.deltaY > 30) goNext();
        else if (e.deltaY < -30) goPrev();
      }, 100);
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [goNext, goPrev]);

  if (!item) return null;

  const embedUrl = `https://www.youtube-nocookie.com/embed/${item.youtubeVideoId}?autoplay=1&controls=1&modestbranding=1&rel=0&playsinline=1`;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] bg-black select-none flex flex-col"
      onTouchStart={(e) => { touchStartY.current = e.touches[0].clientY; }}
      onTouchEnd={(e) => {
        const delta = touchStartY.current - e.changedTouches[0].clientY;
        if (Math.abs(delta) > 60) { delta > 0 ? goNext() : goPrev(); }
      }}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 pt-4 pb-8 bg-gradient-to-b from-black/60 to-transparent">
        <button onClick={onClose} className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <Icon name="arrow_back" size={22} className="text-white" />
        </button>
        <span className="text-white/60 text-xs font-dmmono">{index + 1} / {items.length}</span>
      </div>

      {/* Video iframe - full controls in fullscreen mode */}
      <div className="flex-1 flex items-center justify-center relative">
        <iframe
          key={item.youtubeVideoId}
          src={embedUrl}
          className="w-full h-full max-h-[80vh] pointer-events-auto"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          frameBorder="0"
          title={item.title}
        />
        {/* Swipe/scroll overlay — left and right edges catch swipes without blocking video controls */}
        <div
          className="absolute left-0 top-0 bottom-0 w-16 z-20"
          onTouchStart={(e) => { touchStartY.current = e.touches[0].clientY; }}
          onTouchEnd={(e) => {
            const delta = touchStartY.current - e.changedTouches[0].clientY;
            if (Math.abs(delta) > 60) { delta > 0 ? goNext() : goPrev(); }
          }}
        />
        <div
          className="absolute right-0 top-0 bottom-0 w-16 z-20"
          onTouchStart={(e) => { touchStartY.current = e.touches[0].clientY; }}
          onTouchEnd={(e) => {
            const delta = touchStartY.current - e.changedTouches[0].clientY;
            if (Math.abs(delta) > 60) { delta > 0 ? goNext() : goPrev(); }
          }}
        />
        {/* Prev/Next nav buttons (desktop + as tap targets) */}
        {index > 0 && (
          <button
            onClick={goPrev}
            className="absolute top-1/2 left-2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/80 transition"
          >
            <Icon name="keyboard_arrow_up" size={24} />
          </button>
        )}
        {index < items.length - 1 && (
          <button
            onClick={goNext}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 w-10 h-10 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/80 transition"
          >
            <Icon name="keyboard_arrow_down" size={24} />
          </button>
        )}
      </div>

      {/* Bottom info */}
      <div className="absolute bottom-0 left-0 right-0 z-10 px-4 pb-6 bg-gradient-to-t from-black/70 via-black/30 to-transparent">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-9 h-9 rounded-full overflow-hidden bg-surface-2 flex items-center justify-center border border-white/[0.08]">
            {item.avatar ? <img src={item.avatar} alt="" className="w-full h-full object-cover" /> : <span className="text-sm">📰</span>}
          </div>
          <div>
            <p className="text-white font-bold text-sm">{item.source}</p>
            <p className="text-white/50 text-xs font-dmmono">@{item.source?.toLowerCase().replace(/[^a-z0-9]/g, '')}</p>
          </div>
        </div>
        <h3 className="text-white font-syne font-bold text-sm leading-snug line-clamp-2">{item.title}</h3>
        <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-brand-violet-light text-xs font-semibold mt-1 inline-block hover:underline">
          Read full article →
        </a>
      </div>

      {/* Scroll hint */}
      {index === 0 && items.length > 1 && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10">
          <Icon name="keyboard_arrow_up" size={28} className="text-white/40" />
        </div>
      )}
    </div>
  );
}