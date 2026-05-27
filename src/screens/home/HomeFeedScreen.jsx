import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { getFeedPosts, getTrendingPosts, getFollowingFeedPosts, getActiveFirestoreAds, getNewerFeedPosts } from '../../firebase/firestore';
import PostCard from '../../components/PostCard';
import CoinDisplay from '../../components/CoinDisplay';
import Icon from '../../components/Icon';
import HomeFeedRail from '../../components/brand/HomeFeedRail';
import DesktopSidebar from '../../components/DesktopSidebar';
import BottomNav from '../../components/BottomNav';
import DailyRewardBanner from '../../components/DailyRewardBanner';
import SuggestionsCarousel from '../../components/SuggestionsCarousel';
import AdCard from '../../components/AdCard';
import VergrAd from '../../components/VergrAd';
import { ADS_CONFIG } from '../../config/ads';
import NewsPostCard from '../../components/NewsPostCard';
import CreateComposer from '../../components/composer/CreateComposer';
import useResponsive from '../../hooks/useResponsive';
import { useLayout } from '../../context/LayoutContext';
import { injectAdsRandomly } from '../../utils/feedInjections';
import { orderAdsByAffinity } from '../../utils/adMatcher';
import { doc, getDoc, collection, query, where, orderBy, limit as fbLimit, Timestamp, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getUser } from '../../firebase/firestore';

const FEED_TABS = ['For You', 'Following', 'Gaming News', 'Trending'];

// RSS Proxy endpoint
const RSS_PROXY_BASE = 'https://europe-west1-vergr-44494.cloudfunctions.net/rssProxy?url=';

// RSS sources with bot user IDs (to fetch avatars from Firestore)
const NEWS_SOURCES = [
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

export default function HomeFeedScreen({ initialTab }) {
  const [activeTab, setActiveTab] = useState(
    FEED_TABS.includes(initialTab) ? initialTab : 'For You',
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createOrigin, setCreateOrigin] = useState(null);
  const openCreate = (e) => { try { setCreateOrigin(e.currentTarget.getBoundingClientRect()); } catch { setCreateOrigin(null); } setShowCreateModal(true); };
  const [ads, setAds] = useState([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const { profile, wallet } = useUser();
  const { currentUser } = useAuth();
  const { unreadNotifCount } = useNotifications();
  const navigate = useNavigate();
  const { isMobile, isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign, setLayout } = useLayout();

  // Per-tab cached state
  const [forYouPosts, setForYouPosts] = useState([]);
  const [forYouLoading, setForYouLoading] = useState(true);
  const [forYouHasMore, setForYouHasMore] = useState(true);
  const [forYouLoadingMore, setForYouLoadingMore] = useState(false);
  const forYouLastDocRef = useRef(null);

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

  // Pull-to-refresh state
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartY = useRef(0);
  const pullActive = useRef(false);
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

  // Fetch For You on mount
  useEffect(() => {
    const load = async () => {
      setForYouLoading(true);
      try {
        const posts = await getFeedPosts(10) || [];
        setForYouPosts(posts);
        forYouLastDocRef.current = posts._lastDoc || null;
        setForYouHasMore(posts.length >= 10);
      } catch { setForYouPosts([]); setForYouHasMore(false); }
      setForYouLoading(false);
    };
    load();
  }, []);

  // Fetch Following when tab is first selected
  useEffect(() => {
    if (activeTab !== 'Following' || fetched.current.following || !currentUser?.uid) return;
    fetched.current.following = true;
    const load = async () => {
      setFollowingLoading(true);
      try {
        const posts = await getFollowingFeedPosts(currentUser.uid, 10) || [];
        setFollowingPosts(posts);
        followingLastDocRef.current = posts._lastDoc || null;
        setFollowingHasMore(posts.length >= 10);
      } catch { setFollowingPosts([]); setFollowingHasMore(false); }
      setFollowingLoading(false);
    };
    load();
  }, [activeTab, currentUser?.uid]);

  // Fetch Trending when tab is first selected
  useEffect(() => {
    if (activeTab !== 'Trending' || fetched.current.trending) return;
    fetched.current.trending = true;
    const load = async () => {
      setTrendingLoading(true);
      try {
        const posts = await getTrendingPosts(10) || [];
        setTrendingPosts(posts);
        trendingLastDocRef.current = posts._lastDoc || null;
        setTrendingHasMore(posts.length >= 10);
      } catch { setTrendingPosts([]); setTrendingHasMore(false); }
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
      setForYouPosts(prev => [...prev, ...more]);
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
        setPullDistance(Math.min(delta, 100));
      } else {
        pullActive.current = false;
        setPullDistance(0);
      }
    };
    const onTouchEnd = () => {
      if (!pullActive.current) return;
      pullActive.current = false;
      if (pullDistance > 70) {
        handleRefresh();
      }
      setPullDistance(0);
    };
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [isMobile, pullDistance, handleRefresh, refreshing]);

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

    // Observe all feed videos
    const attach = () => {
      document.querySelectorAll('video[data-feed-video="1"]').forEach(v => obs.observe(v));
    };
    attach();
    const timer = setInterval(attach, 1500); // re-attach as new posts render
    return () => { clearInterval(timer); obs.disconnect(); };
  }, [activeTab, forYouPosts, followingPosts, trendingPosts]);

  // Fetch Gaming News when tab is first selected (using RSS proxy + bot avatars).
  // Bot avatars are persisted to localStorage with a 7-day TTL — these accounts
  // never change their avatar, so we should NOT pay 25 Firestore reads every time
  // someone opens this tab.
  useEffect(() => {
    if (activeTab !== 'Gaming News' || fetched.current.news) return;
    fetched.current.news = true;
    const fetchNews = async () => {
      setNewsLoading(true);

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
        // Allow re-fetch if everything failed
        fetched.current.news = false;
      }

      setNewsItems(
        allNews.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate)).slice(0, 50)
      );
      setNewsLoading(false);
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
          <div className="w-10 h-10 border-4 border-brand-cyan border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-text-muted text-sm font-dmmono">Fetching gaming news...</p>
        </div>
      );
    }
    if (newsItems.length === 0) {
      return <div className="text-center py-20 px-6"><p className="text-text-muted">No news available</p></div>;
    }
    return newsItems.map((item, idx) => (
      <NewsPostCard key={`${item.source}-${idx}`} item={item} onOpenVideo={handleOpenNewsVideo} />
    ));
  };

  const renderForYou = () => {
    if (forYouLoading) {
      return (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-surface-3 border-t-brand-cyan rounded-full animate-spin mb-4" />
          <p className="text-text-muted text-xs font-dmmono">Loading posts...</p>
        </div>
      );
    }

    let feedItems = [...forYouPosts];
    if (ads.length > 0 && !adsLoading) {
      feedItems = injectAdsRandomly(feedItems, ads, 3, 6);
    }

    const elements = [];
    elements.push(<SuggestionsCarousel key="carousel-top" />);

    // Track real-post index separately so PropellerAds slots are spaced
     // by *content posts seen*, not by mixed (post + user-ad) positions.
    let postsSinceAd = 0;
    feedItems.forEach((item, index) => {
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
        postsSinceAd++;
        if (postsSinceAd >= ADS_CONFIG.feedAdInterval) {
          elements.push(<VergrAd key={`vergrad-${index}`} zone="inpage" />);
          postsSinceAd = 0;
        }
      }
    });

    if (elements.length <= 1) {
      elements.push(
        <div key="empty" className="text-center py-20 px-6">
          <div className="w-20 h-20 bg-surface-1 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-white/[0.06]"><Icon name="dynamic_feed" size={40} className="text-text-muted/30" /></div>
          <h3 className="font-syne font-bold text-text-primary text-xl mb-2">Your feed is empty</h3>
          <p className="text-text-muted max-w-xs mx-auto mb-6">Follow gamers and explore to see posts here.</p>
          <button onClick={() => navigate('/explore')} className="px-6 py-2.5 rounded-full bg-brand-cyan text-bg-dark font-bold text-sm">Explore</button>
        </div>
      );
    }
    return elements;
  };

  const renderFollowing = () => {
    if (followingLoading) {
      return <div className="flex flex-col items-center justify-center py-20"><div className="w-8 h-8 border-2 border-surface-3 border-t-brand-cyan rounded-full animate-spin mb-4" /><p className="text-text-muted text-xs font-dmmono">Loading followed posts...</p></div>;
    }
    if (followingPosts.length === 0) {
      return <div className="text-center py-20 px-6"><div className="w-20 h-20 bg-surface-1 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-white/[0.06]"><Icon name="person_add" size={40} className="text-text-muted/30" /></div><h3 className="font-syne font-bold text-text-primary text-xl mb-2">No followed posts</h3><p className="text-text-muted max-w-xs mx-auto mb-6">Follow gamers to see their posts here.</p><button onClick={() => navigate('/explore')} className="px-6 py-2.5 rounded-full bg-brand-cyan text-bg-dark font-bold text-sm">Explore</button></div>;
    }
    return followingPosts.map((post) => (
      <PostCard 
        key={post.id} 
        post={post} 
        onDeleted={handleDeletePost(setFollowingPosts)} 
        onLikeUpdate={createLikeUpdateHandler(setFollowingPosts)}
      />
    ));
  };

  const renderTrending = () => {
    if (trendingLoading) {
      return <div className="flex flex-col items-center justify-center py-20"><div className="w-8 h-8 border-2 border-surface-3 border-t-brand-cyan rounded-full animate-spin mb-4" /><p className="text-text-muted text-xs font-dmmono">Loading trending posts...</p></div>;
    }
    if (trendingPosts.length === 0) {
      return <div className="text-center py-20 px-6"><p className="text-text-muted">No trending posts yet</p></div>;
    }
    return trendingPosts.map((post) => (
      <PostCard 
        key={post.id} 
        post={post} 
        onDeleted={handleDeletePost(setTrendingPosts)} 
        onLikeUpdate={createLikeUpdateHandler(setTrendingPosts)}
      />
    ));
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
        <header className="sticky top-0 z-40 glass-header px-4 h-[52px] flex items-center justify-between">
          <div className="flex items-center gap-3"><img src={profile?.avatar || '/logo.png'} alt="" className="w-8 h-8 rounded-full object-cover border border-white/[0.08]" /><h1 className="font-syne font-bold text-lg tracking-tight text-text-primary">VERGR</h1></div>
          <div className="flex items-center gap-3"><CoinDisplay amount={wallet?.balance || 0} size="sm" /><button onClick={() => navigate('/notifications')} className="relative"><Icon name="notifications" size={22} className="text-text-secondary" />{unreadNotifCount > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-brand-ember text-[10px] flex items-center justify-center font-bold text-white border-2 border-bg-dark">{unreadNotifCount > 9 ? '9+' : unreadNotifCount}</span>}</button></div>
        </header>
      )}
      {/* Desktop composer row — narrower composer + New Post + bell, no
          page title or subtitle (the left sidebar already labels the
          section, and the feed itself is self-evident). */}
      {isDesktop && (
        <div className="px-6 pt-6 pb-4 flex items-center gap-3">
          <button
            onClick={openCreate}
            className="flex-1 max-w-[640px] flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] text-left">
            <img
              src={profile?.avatar || '/brand/logo.png'}
              alt=""
              className="w-9 h-9 rounded-full object-cover border border-white/[0.08] shrink-0"
            />
            <span className="flex-1 text-[13px] text-text-muted">Share something with the squad…</span>
            <span className="flex items-center gap-1.5">
              <span className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center text-brand-cyan">
                <Icon name="photo_camera" size={15} />
              </span>
              <span className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center text-brand-violet">
                <Icon name="videocam" size={15} />
              </span>
              <span className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center text-brand-ember">
                <Icon name="podcasts" size={15} />
              </span>
            </span>
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-3 rounded-2xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-xs font-bold shadow-lg shadow-brand-violet/30 hover:brightness-110">
            <Icon name="add" size={15} /> New Post
          </button>
          <button
            onClick={() => navigate('/notifications')}
            className="relative w-11 h-11 rounded-2xl bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.07] flex items-center justify-center text-text-secondary"
            title="Notifications">
            <Icon name="notifications" size={18} />
            {unreadNotifCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-brand-ember text-[10px] font-bold text-white flex items-center justify-center px-1">
                {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
              </span>
            )}
          </button>
        </div>
      )}

      <div className="sticky top-[52px] lg:top-0 z-30 glass-header px-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar px-2 py-2">
          {FEED_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-none px-4 py-1.5 text-[12px] font-semibold whitespace-nowrap rounded-full transition-colors relative ${
                activeTab === tab
                  ? 'bg-gradient-to-r from-brand-violet to-brand-pink text-white shadow-md shadow-brand-violet/30'
                  : 'text-text-muted hover:text-text-primary hover:bg-white/[0.04]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>
      <HomeStoriesStrip onNavigate={navigate} />
      <DailyRewardBanner />

      {/* Pull-to-refresh indicator */}
      {(pullDistance > 0 || refreshing) && (
        <div
          className="flex items-center justify-center overflow-hidden transition-all"
          style={{ height: refreshing ? 50 : pullDistance }}
        >
          <div className={`w-5 h-5 border-2 border-surface-3 border-t-brand-cyan rounded-full ${refreshing ? 'animate-spin' : ''}`} />
        </div>
      )}

      <div className="flex-1 w-full">{renderContent()}</div>

      {/* Infinite scroll sentinel + loader */}
      {(activeTab === 'For You' || activeTab === 'Following' || activeTab === 'Trending') && (
        <div ref={sentinelRef} className="py-6 flex justify-center">
          {(forYouLoadingMore && activeTab === 'For You') ||
           (followingLoadingMore && activeTab === 'Following') ||
           (trendingLoadingMore && activeTab === 'Trending') ? (
            <div className="w-5 h-5 border-2 border-surface-3 border-t-brand-cyan rounded-full animate-spin" />
          ) : (
            (activeTab === 'For You' && !forYouHasMore && forYouPosts.length > 0) ||
            (activeTab === 'Following' && !followingHasMore && followingPosts.length > 0) ||
            (activeTab === 'Trending' && !trendingHasMore && trendingPosts.length > 0) ? (
              <p className="text-text-muted text-xs font-dmmono">You're all caught up</p>
            ) : null
          )}
        </div>
      )}
      {isMobile && <button onClick={() => setShowCreateModal(true)} className="fixed bottom-20 right-4 w-13 h-13 rounded-full bg-brand-cyan flex items-center justify-center z-30 hover:brightness-110 active:scale-95 transition-all shadow-black/30"><Icon name="add" size={26} className="text-bg-dark" /></button>}
      {showCreateModal && <CreateComposer onClose={() => setShowCreateModal(false)} originRect={createOrigin} />}
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
    return (
      <div className="min-h-screen bg-bg-dark">
        <div className="max-w-[480px] mx-auto min-h-screen relative pb-20">
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
        <div className="flex-1 min-w-0 border-r border-white/[0.06]">
          {feedContent}
        </div>
        <aside className="w-[300px] shrink-0 bg-[#0e0e1a] border-l border-white/[0.06] sticky top-0 h-screen overflow-y-auto no-scrollbar">
          <HomeFeedRail />
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
function HomeStoriesStrip({ onNavigate }) {
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const [groups, setGroups] = useState([]); // [{ uid, author, items[] }]
  const [myStatusCount, setMyStatusCount] = useState(0);
  const [liveHostIds, setLiveHostIds] = useState(new Set());

  // Pull the set of uids currently live-streaming so the stories strip can
  // flip those avatars to the red LIVE ring.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const q = query(collection(db, 'streams'), where('status', '==', 'live'), fbLimit(50));
        const snap = await getDocs(q);
        if (!alive) return;
        const ids = new Set();
        for (const d of snap.docs) {
          const data = d.data();
          if (data.hostId) ids.add(data.hostId);
          else if (data.hostUid) ids.add(data.hostUid);
        }
        setLiveHostIds(ids);
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    (async () => {
      try {
        const cutoff = Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
        const q = query(
          collection(db, 'statuses'),
          where('createdAt', '>=', cutoff),
          orderBy('createdAt', 'desc'),
          fbLimit(50),
        );
        const snap = await getDocs(q);
        const grouped = new Map();
        for (const d of snap.docs) {
          const data = { id: d.id, ...d.data() };
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
        // Sort other groups by their newest status (already desc within each).
        const sorted = Array.from(grouped.values()).sort((a, b) => {
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
    <div className="px-4 py-3 border-b border-white/[0.04]">
      <div className="flex items-start gap-3 overflow-x-auto no-scrollbar">
        {/* Your Story — always first */}
        <button onClick={handleSelf} className="flex flex-col items-center gap-1.5 shrink-0 w-[64px]">
          <div className="relative">
            {myStatusCount > 0 ? (
              // You have a story — VP rank ring + live override if streaming.
              <UserAvatar
                src={profile?.avatar || profile?.photoURL}
                size={56}
                vpLevel={profile?.vpLevel || 1}
                isVerified={profile?.isVerified}
                isLive={liveHostIds.has(currentUser?.uid)}
              />
            ) : (
              <div className="w-[56px] h-[56px] rounded-full bg-surface-2 border-2 border-dashed border-white/[0.15] flex items-center justify-center hover:border-brand-cyan/40 transition-colors">
                <Icon name="add" size={22} className="text-text-primary" />
              </div>
            )}
          </div>
          <span className="text-[10px] font-dmmono text-text-secondary truncate w-full text-center">
            {myStatusCount > 0 ? 'Your Story' : 'Add Story'}
          </span>
        </button>

        {/* Other users' stories */}
        {groups.map(g => {
          const a = g.author;
          const name = a?.displayName || a?.username || 'User';
          return (
            <button
              key={g.uid}
              onClick={() => onNavigate(`/status?viewing=${g.uid}`)}
              className="flex flex-col items-center gap-1.5 shrink-0 w-[64px]"
            >
              <UserAvatar
                src={a?.avatar || a?.photoURL}
                size={56}
                vpLevel={a?.vpLevel || 1}
                isVerified={a?.isVerified}
                isLive={liveHostIds.has(g.uid)}
              />
              <span className="text-[10px] font-dmmono text-text-secondary truncate w-full text-center">{name}</span>
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
function NewsVideoViewer({ items, startIndex, onClose }) {
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
        <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-brand-cyan text-xs font-semibold mt-1 inline-block hover:underline">
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