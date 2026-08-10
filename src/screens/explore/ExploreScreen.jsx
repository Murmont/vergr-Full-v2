// Explore — discovery surface for streams, creators, squads, clips, news.
// Layout adapted from the Claude Design Explore mock. Real data is pulled
// from existing Firestore helpers where available; mock fallbacks fill the
// long tail until those endpoints land.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore';
import { CardGridSkeleton } from '../../components/skeletons/GlassSkeletons';
import { db } from '../../firebase/config';
import { getSquads, searchUsers, followUser, unfollowUser } from '../../firebase/firestore';
import { hiddenFromDiscovery } from '../../utils/privacy';
import { compactNum } from '../../components/creator/charts';
import { timeAgo } from '../../utils/helpers';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import { viewerLocale, rankByLocale, langLabel } from '../../utils/localePrefs';
import { TOURNAMENT_GAMES } from '../../utils/tournamentGames';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';

// Brand accents for the Top Games cards (used as the card gradient until real
// cover art is supplied). Falls back to a violet gradient for anything unmapped.
const GAME_ACCENT = {
  'VALORANT': '#FF4655', 'Counter-Strike 2': '#F0A500', 'League of Legends': '#0BC6E3',
  'Dota 2': '#C23C2A', 'Apex Legends': '#DA292A', 'Fortnite': '#1F9BF0',
  'Overwatch 2': '#F99E1A', 'Rocket League': '#0B84CE', 'PUBG: Battlegrounds': '#F2A900',
  'Call of Duty: Warzone': '#C8A84B', 'Call of Duty: Modern Warfare III': '#3A7D44',
  'Rainbow Six Siege': '#3B5BA5', 'StarCraft II': '#2A6FB8', 'Age of Empires IV': '#B07A2E',
};
const gameAccent = (label) => GAME_ACCENT[label] || '#7B1FFF';
// The dozen most relevant tournament games to surface as discovery cards.
const TOP_GAME_LIST = TOURNAMENT_GAMES.slice(0, 12).map((g) => ({ id: g.id, name: g.label, category: g.category, coverArt: g.coverArt || null }));

// Native app: the WebView reports ~980px so Tailwind sm:/md: (640/768) fire and
// render too many columns on a phone, while xl: (1280) never fires. Strip the
// responsive grid-col bumps on native, leaving the mobile base (grid-cols-N).
// Build-time constant — dead-code-eliminated on web.
const gx = (cls) => (IS_NATIVE_BUILD ? cls.replace(/\b(sm|md|lg|xl):grid-cols-\S+/g, '').replace(/\s+/g, ' ').trim() : cls);
import UserAvatar from '../../components/UserAvatar';

const MAIN_TABS = ['All', 'Creators', 'Squads', 'Streams', 'Clips', 'News'];

// Automated content accounts (news_bot / yt_bot / shorts bots) are NOT people —
// they must never appear in Creators / people discovery.
const isBotAccount = (u) => /bot/i.test(String(u?.accountType || ''));

const dedupeByUid = (rows) => {
  const seen = new Set();
  return rows.filter((r) => {
    const k = r.uid || r.id;
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

// ── Mock fallbacks (only used when Firestore returns nothing) ─────────
const MOCK_CREATORS = [
  { name: 'NightHawk',    followers: '142K',  tags: ['FPS','Valorant'],     live: true,  verified: true },
  { name: 'PhoenixRise',  followers: '98.7K', tags: ['VALORANT','IRL'],     live: true,  verified: true },
  { name: 'ShadowSlayer', followers: '250K',  tags: ['Apex Legends','FPS'], live: false, verified: true },
  { name: 'ViperX',       followers: '74.2K', tags: ['Fortnite','BR'],      live: true,  verified: true },
  { name: 'RazeMain',     followers: '61.3K', tags: ['VALORANT','FPS'],     live: false, verified: true },
];
const MOCK_SQUADS = [
  { name: 'Phoenix Rising', members: '1,245', online: 312, tags: ['VALORANT','Comp'], verified: true },
  { name: 'Wolves Den',     members: '987',   online: 215, tags: ['Warzone','FPS'],   verified: true },
  { name: 'Apex Predators', members: '2,341', online: 478, tags: ['Apex','Comp'],     verified: true },
  { name: 'Royalty Esports',members: '1,876', online: 289, tags: ['Multi','Social'],  verified: true },
];
const MOCK_STREAMS = [
  { title: 'RANK PUSH TO RADIANT',     creator: 'NightHawk',    game: 'VALORANT',      viewers: '12.4K' },
  { title: 'WARZONE VIBES',             creator: 'ShadowSlayer', game: 'Warzone',       viewers: '8.7K'  },
  { title: 'CHILL LATE NIGHT STREAM',   creator: 'AceKnight',    game: 'Just Chatting', viewers: '5.2K'  },
  { title: 'APEX PRED LOBBIES',         creator: 'ViperX',       game: 'Apex Legends',  viewers: '3.2K'  },
];
const MOCK_NEWS = [
  { category: 'Streaming',   title: 'Co-streaming is now live for Pro creators',                    time: '2h ago', tag: 'VERGR',    hot: true },
  { category: 'Game Update', title: 'Apex Legends Season 23 drops new map and legend today',        time: '4h ago', tag: 'Apex',     hot: false },
  { category: 'Community',   title: 'Weekly squad challenge results — Phoenix Rising takes the crown', time: '6h ago', tag: 'VERGR', hot: false },
  { category: 'Esports',     title: 'CS2 Major qualifiers open registration — team size 5v5',       time: '8h ago', tag: 'CS2',      hot: true },
  { category: 'Platform',    title: 'VERGR drops VP boost weekend — earn 2x VP on all activities',  time: '1d ago', tag: 'VERGR',    hot: true },
];
const HASHTAGS = [
  { tag: '#Clutch', clips: '12.4K' }, { tag: '#1v5', clips: '8.7K' },
  { tag: '#ApexMovement', clips: '6.2K' }, { tag: '#Warzone', clips: '5.1K' },
  { tag: '#Headshot', clips: '4.3K' }, { tag: '#Fortnite', clips: '3.9K' },
];
const TRENDING_GAMES = [
  { name: 'Valorant',     viewers: '24.8K', color: '#FF4655' },
  { name: 'Warzone',      viewers: '18.3K', color: '#C8A84B' },
  { name: 'Apex Legends', viewers: '12.7K', color: '#DA292A' },
  { name: 'Fortnite',     viewers: '10.9K', color: '#00C6FF' },
  { name: 'CS2',          viewers: '8.2K',  color: '#F0A500' },
];

const tagClass = (tag) => {
  const map = {
    'VALORANT':     'bg-red-500/20 text-red-400',
    'Valorant':     'bg-red-500/20 text-red-400',
    'Apex Legends': 'bg-orange-500/20 text-orange-400',
    'Apex':         'bg-orange-500/20 text-orange-400',
    'FPS':          'bg-brand-violet/20 text-brand-violet-light',
    'Comp':         'bg-brand-pink/20 text-brand-pink',
    'Warzone':      'bg-yellow-600/20 text-yellow-400',
    'Fortnite':     'bg-blue-500/20 text-blue-400',
    'BR':           'bg-blue-500/20 text-blue-400',
    'CS2':          'bg-yellow-500/20 text-yellow-400',
    'Multi':        'bg-emerald-500/20 text-emerald-400',
    'Social':       'bg-pink-500/20 text-pink-400',
    'IRL':          'bg-pink-500/20 text-pink-400',
    'VERGR':        'bg-brand-violet/20 text-brand-violet-light',
  };
  return map[tag] || 'bg-white/10 text-white/60';
};

export default function ExploreScreen() {
  const { setRightPanel, setContentAlign } = useLayout();
  const { isMobile } = useResponsive();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('All');
  const [search, setSearch] = useState('');
  // Backend user-search results (finds ANY user by username, case-insensitive),
  // null when not searching. Plus discovery filters (verified / live only).
  const [userResults, setUserResults] = useState(null);
  const [filters, setFilters] = useState({ verifiedOnly: false, liveOnly: false });
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Real live streams, sorted by boost + viewerCount + recent-likes signal.
  // Falls back to MOCK_STREAMS if Firestore returns nothing.
  const [realStreams, setRealStreams] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const q = query(
          collection(db, 'streams'),
          where('status', '==', 'live'),
          orderBy('viewerCount', 'desc'),
          limit(24),
        );
        const snap = await getDocs(q);
        if (cancelled) return;
        setRealStreams(snap.docs.map((d) => {
          const s = d.data();
          return {
            id: d.id,
            hostUid: s.hostUid || null,
            title: s.title || 'Live Stream',
            creator: s.hostUsername || s.hostUid?.slice(0, 6) || 'creator',
            game: s.game || 'Live',
            viewers: (s.viewerCount || 0).toLocaleString(),
            boosted: !!s.boosted,
            source: s.source || null,
            // Orientation drives the desktop (16:9) vs mobile (9:16) split below.
            // Twitch mirrors + OBS default to landscape; missing = landscape.
            orientation: s.orientation || 'landscape',
            // Locality: spoken language + host country for the language/region filter + locale rank.
            language: s.language || null,
            country: s.hostCountry || null,
          };
        }));
      } catch (e) { /* honest empty state below */ }
    })();
    return () => { cancelled = true; };
  }, []);
  // Real-only — no mock streams. Empty states handle "nothing live".
  const streamsToShow = realStreams;
  const liveHostSet = new Set(realStreams.map((r) => r.hostUid).filter(Boolean));

  // Real top creators (by followerCount), founder/hidden filtered out.
  const [realCreators, setRealCreators] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch a batch WITHOUT orderBy and sort client-side. orderBy
        // followerCount dropped real users missing that field AND returned only
        // bot docs that happen to carry it (both hid the creators list).
        const snap = await getDocs(query(collection(db, 'users'), limit(300)));
        if (cancelled) return;
        // Founder rule (2026-06-29): a user shows in Creators UNLESS they're a
        // GUEST or they OPTED OUT of public discovery in Settings → Privacy.
        // No onboarding / post-count / admin gate (those wrongly hid real
        // accounts like @Verion isOnboarded:false and @Friz1k3). `hideFromEnumeration`
        // is the explicit opt-out flag; hiddenFromDiscovery reads the privacy toggle.
        const rows = snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
          .filter((u) => u.username
            && u.isGuest !== true
            && !/^guest_/i.test(u.username)
            && u.hideFromEnumeration !== true
            && !hiddenFromDiscovery(u, 'suggested'))
          // Real PEOPLE first, automated bot accounts last (founder: real users
          // first, not bots). Bots carry a followerCount while most humans have
          // 0/missing, so a pure follower sort floated every bot to the top.
          .sort((a, b) => {
            const ab = isBotAccount(a) ? 1 : 0, bb = isBotAccount(b) ? 1 : 0;
            if (ab !== bb) return ab - bb;
            return (b.followerCount || 0) - (a.followerCount || 0);
          });
        setRealCreators(rows.slice(0, 40).map((u) => ({
          uid: u.uid,
          name: u.username || u.displayName || 'Player',
          avatar: u.avatar || u.photoURL || null,
          banner: u.banner || null,
          cardBackground: u.cardBackground || null,
          followers: compactNum(Math.max(0, u.followerCount || 0)),
          verified: !!u.isVerified,
          live: liveHostSet.has(u.uid),
          country: u.country || null,   // locality: suggest same-region creators first
          tags: Array.isArray(u.favoriteGames) ? u.favoriteGames.slice(0, 2) : [],
        })));
      } catch (e) { /* empty state */ }
    })();
    return () => { cancelled = true; };
  }, [realStreams]);

  // Debounced backend user search — finds ANY user by username (case-insensitive
  // via usernameLower), bots excluded. Drives Creators results while typing.
  useEffect(() => {
    const term = search.trim();
    if (!term) { setUserResults(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const found = await searchUsers(term, 20);
        if (cancelled) return;
        setUserResults(found.map((u) => ({
          uid: u.id,
          name: u.username || u.displayName || 'Player',
          avatar: u.avatar || u.photoURL || null,
          banner: u.banner || null,
          cardBackground: u.cardBackground || null,
          followers: compactNum(Math.max(0, u.followerCount || 0)),
          verified: !!u.isVerified,
          live: false,
          tags: Array.isArray(u.favoriteGames) ? u.favoriteGames.slice(0, 2) : [],
        })));
      } catch { if (!cancelled) setUserResults([]); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search]);

  // Real "news" = Article-type posts (a first-class VERGR content type) +
  // platform announcements, newest first. No dedicated editorial CMS exists,
  // so Articles are the real source; empty state when none.
  const [realNews, setRealNews] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'posts'),
          where('type', '==', 'article'),
          orderBy('createdAt', 'desc'),
          limit(12),
        ));
        if (cancelled) return;
        setRealNews(snap.docs.map((d) => {
          const p = d.data();
          return {
            id: d.id,
            category: 'Article',
            title: p.title || p.content?.slice(0, 80) || 'Untitled',
            tag: p.gameId || p.game || 'VERGR',
            time: p.createdAt?.toDate ? timeAgo(p.createdAt.toDate()) : '',
            hot: (p.likeCount || 0) > 25,
          };
        }));
      } catch (e) { /* empty state */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Real public squads (by member count).
  const [realSquads, setRealSquads] = useState([]);
  useEffect(() => {
    let cancelled = false;
    getSquads(12).then((list) => {
      if (cancelled) return;
      setRealSquads(list.map((s) => ({
        id: s.id,
        name: s.name || s.tag || 'Squad',
        avatar: s.avatar || s.logo || null,
        banner: s.banner || s.bannerUrl || null,
        members: compactNum(s.memberCount || s.memberIds?.length || 0),
        online: s.onlineCount || null,
        verified: !!s.verified,
        tags: Array.isArray(s.tags) ? s.tags.slice(0, 2) : [],
      })));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // "Following Live" — the single biggest viewer complaint on TikTok/Twitch
  // (can't see which of your follows are live). Direct read off the user's
  // following list crossed with currently-live streams.
  const { currentUser } = useAuth();
  const { profile } = useUser();

  // Real follow state for the Creator cards. Load the viewer's following set
  // ONCE so every card shows the correct Follow/Following label, and toggling
  // on Explore (or anywhere else) reflects back here on remount. Without this
  // the card was a dead static "Follow" button (founder: quick-follow did
  // nothing and never flipped to "Following").
  const [followingSet, setFollowingSet] = useState(() => new Set());
  const [followBusy, setFollowBusy] = useState(() => new Set());
  useEffect(() => {
    if (!currentUser?.uid) { setFollowingSet(new Set()); return; }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'users', currentUser.uid, 'following'), limit(500),
        ));
        if (!cancelled) setFollowingSet(new Set(snap.docs.map((d) => d.id)));
      } catch { /* leave empty — cards default to Follow */ }
    })();
    return () => { cancelled = true; };
  }, [currentUser?.uid]);

  const toggleFollow = async (uid) => {
    if (!uid || !currentUser?.uid || followBusy.has(uid)) return;
    const wasFollowing = followingSet.has(uid);
    setFollowBusy((p) => new Set(p).add(uid));
    setFollowingSet((p) => {
      const n = new Set(p);
      if (wasFollowing) n.delete(uid); else n.add(uid);
      return n;
    });
    try {
      if (wasFollowing) await unfollowUser(currentUser.uid, uid);
      else await followUser(currentUser.uid, uid);
    } catch {
      setFollowingSet((p) => {
        const n = new Set(p);
        if (wasFollowing) n.add(uid); else n.delete(uid);
        return n;
      });
    } finally {
      setFollowBusy((p) => { const n = new Set(p); n.delete(uid); return n; });
    }
  };

  const [followingLive, setFollowingLive] = useState([]);
  useEffect(() => {
    if (!currentUser?.uid) { setFollowingLive([]); return; }
    let cancelled = false;
    (async () => {
      try {
        // Get the user's following list (lightweight subcollection — at most a few hundred docs).
        const followingSnap = await getDocs(query(
          collection(db, 'users', currentUser.uid, 'following'),
          limit(300),
        ));
        if (cancelled || followingSnap.empty) return;
        const followingUids = followingSnap.docs.map((d) => d.id);
        if (followingUids.length === 0) return;
        // Firestore "in" query supports 30 values. Chunk the list and merge.
        const chunks = [];
        for (let i = 0; i < followingUids.length; i += 30) chunks.push(followingUids.slice(i, i + 30));
        const liveDocs = (await Promise.all(chunks.map((uids) => getDocs(query(
          collection(db, 'streams'),
          where('status', '==', 'live'),
          where('hostUid', 'in', uids),
          limit(30),
        ))))).flatMap((s) => s.docs);
        if (cancelled) return;
        // Enrich with host display name + avatar (small parallel reads).
        const enriched = await Promise.all(liveDocs.map(async (sd) => {
          const s = sd.data();
          let hostName = s.hostUsername || s.hostUid?.slice(0, 6);
          let hostAvatar = null;
          try {
            const u = await getDoc(doc(db, 'users', s.hostUid));
            if (u.exists()) {
              hostName = u.data().displayName || u.data().username || hostName;
              hostAvatar = u.data().avatar || null;
            }
          } catch {}
          return {
            id: sd.id,
            title: s.title || 'Live',
            game: s.game || '',
            viewers: s.viewerCount || 0,
            hostName, hostAvatar,
          };
        }));
        if (!cancelled) setFollowingLive(enriched);
      } catch (err) { /* silent — feature is optional */ }
    })();
    return () => { cancelled = true; };
  }, [currentUser?.uid]);

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  const placeholders = {
    All: 'Search creators, squads, games, streams...',
    Creators: 'Search creators...',
    Squads: 'Search squads, games, tags...',
    Streams: 'Search streams, games, creators...',
    Clips: 'Search clips, games, creators...',
    News: 'Search news, topics...',
  };

  // Search + filter aware lists. Searching the Creators surface hits the backend
  // (any user, case-insensitive) merged with local displayName matches.
  const term = search.trim().replace(/^@+/, '').toLowerCase();
  const searching = term.length > 0;
  const applyCreatorFilters = (list) => list.filter(
    (c) => (!filters.verifiedOnly || c.verified) && (!filters.liveOnly || c.live),
  );
  // Locality: viewer's country/language drives same-region-first ordering for
  // streams + suggested creators (reduces foreign-language content surfaced).
  const viewer = viewerLocale(profile);
  const creatorsForDisplay = rankByLocale(
    applyCreatorFilters(
      searching
        ? dedupeByUid([
            ...(userResults || []),
            ...realCreators.filter((c) => (c.name || '').toLowerCase().includes(term)),
          ])
        : realCreators,
    ),
    viewer,
    (c) => ({ country: c.country, language: undefined }),
  );
  const squadsForDisplay = searching
    ? realSquads.filter((s) => (s.name || '').toLowerCase().includes(term))
    : realSquads;
  // Locality: float streams in the viewer's language/region first (streams carry
  // language + country from createStreamSession). getUser maps the lightweight
  // stream row to the {country, language} shape rankByLocale expects.
  const streamsForDisplay = rankByLocale(
    searching
      ? streamsToShow.filter((s) => `${s.title} ${s.creator} ${s.game}`.toLowerCase().includes(term))
      : streamsToShow,
    viewer,
    (s) => ({ country: s.country, language: s.language }),
  );
  const newsForDisplay = searching
    ? realNews.filter((n) => (n.title || '').toLowerCase().includes(term))
    : realNews;

  return (
    <div className="pb-10">
      {isMobile && <TopBar title="Explore" />}

      <div className="px-4 md:px-7 py-5 md:py-6 max-w-[1400px] mx-auto">
        {!isMobile && <h1 className="font-syne text-2xl font-black text-text-primary mb-5">Explore</h1>}

        {/* Search + Filter */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 relative">
            <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={placeholders[activeTab]}
              className="w-full bg-surface-1 border border-surface-3 rounded-xl pl-10 pr-4 py-3 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-brand-violet-light/50 transition-colors" />
          </div>
          <div className="relative">
            <button
              onClick={() => setFiltersOpen((o) => !o)}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm transition-all border ${
                (filters.verifiedOnly || filters.liveOnly)
                  ? 'bg-brand-violet/20 border-brand-violet-light/50 text-text-primary'
                  : 'bg-surface-1 border-surface-3 text-text-secondary hover:border-brand-violet-light/40 hover:text-text-primary'
              }`}>
              <Icon name="tune" size={16} /> Filters
              {(filters.verifiedOnly || filters.liveOnly) && (
                <span className="ml-1 w-1.5 h-1.5 rounded-full bg-brand-violet-light" />
              )}
            </button>
            {filtersOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setFiltersOpen(false)} />
                <div className="absolute right-0 mt-2 z-20 w-52 bg-surface-1 border border-surface-3 rounded-xl p-3 shadow-2xl">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2">Filter creators</p>
                  {[
                    { key: 'verifiedOnly', label: 'Verified only', icon: 'verified' },
                    { key: 'liveOnly', label: 'Live now', icon: 'sensors' },
                  ].map((f) => (
                    <button key={f.key}
                      onClick={() => setFilters((p) => ({ ...p, [f.key]: !p[f.key] }))}
                      className="w-full flex items-center justify-between py-2 text-sm text-text-secondary hover:text-text-primary">
                      <span className="flex items-center gap-2"><Icon name={f.icon} size={15} /> {f.label}</span>
                      <span className={`w-9 h-5 rounded-full transition-colors relative ${filters[f.key] ? 'bg-brand-violet' : 'bg-surface-3'}`}>
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${filters[f.key] ? 'left-4' : 'left-0.5'}`} />
                      </span>
                    </button>
                  ))}
                  {(filters.verifiedOnly || filters.liveOnly) && (
                    <button onClick={() => setFilters({ verifiedOnly: false, liveOnly: false })}
                      className="mt-2 w-full text-center text-xs text-brand-violet-light hover:underline">Clear filters</button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Tab pills */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {MAIN_TABS.map(t => (
            <TabPill key={t} label={t} active={activeTab === t} onClick={() => setActiveTab(t)} />
          ))}
        </div>

        {/* Following Live — surfaces ONLY when at least one of the user's
            follows is currently live. Hidden otherwise (no empty state). */}
        {followingLive.length > 0 && (activeTab === 'All' || activeTab === 'Streams') && (
          <FollowingLiveRail rows={followingLive} navigate={navigate} />
        )}

        {activeTab === 'All'      && <AllTab navigate={navigate} setTab={setActiveTab} streamsToShow={streamsForDisplay} creators={creatorsForDisplay} squads={squadsForDisplay} news={newsForDisplay} following={followingSet} followBusy={followBusy} onToggleFollow={toggleFollow} />}
        {activeTab === 'Creators' && <CreatorsTab navigate={navigate} creators={creatorsForDisplay} searching={searching} following={followingSet} followBusy={followBusy} onToggleFollow={toggleFollow} />}
        {activeTab === 'Squads'   && <SquadsTab navigate={navigate} squads={squadsForDisplay} />}
        {activeTab === 'Streams'  && <StreamsTab navigate={navigate} streamsToShow={streamsForDisplay} viewer={viewer} />}
        {activeTab === 'Clips'    && <ClipsTab navigate={navigate} search={term} />}
        {activeTab === 'News'     && <NewsTab navigate={navigate} news={newsForDisplay} />}
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function TabPill({ label, active, onClick }) {
  return (
    <button onClick={onClick}
      className="px-4 py-2 rounded-xl text-sm font-semibold transition-all whitespace-nowrap"
      style={active
        ? { background: '#7B1FFF', color: '#fff' }
        : { background: '#14141F', border: '1px solid #2A2A3E', color: '#9CA3AF' }}>
      {label}
    </button>
  );
}

function SectionHeader({ title, onViewAll }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="font-syne font-bold text-base text-text-primary">{title}</h2>
      {onViewAll && (
        <button onClick={onViewAll} className="text-brand-violet-light text-sm font-semibold hover:underline">View All</button>
      )}
    </div>
  );
}

// Horizontal carousel wrapper: visible left/right arrow buttons (so mouse users
// don't have to know about shift+wheel / middle-click pan) + click-drag to
// scroll. `innerClassName` is the scroll-row layout (flex or 2-row grid).
function Carousel({ children, innerClassName, style }) {
  const ref = useRef(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const drag = useRef({ down: false, startX: 0, startScroll: 0, moved: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 2);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [update, children]);

  const scrollBy = (dir) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 200), behavior: 'smooth' });
  };

  // Click-drag to pan (desktop). Suppress the click that follows a real drag so
  // a drag doesn't also open a card.
  //
  // This sits in front of every card link, so the two failure modes both look
  // like "cards stopped working": a 4px threshold trips on the drift of an
  // ordinary click, and `moved` cleared only inside the click handler, so a
  // drag released outside the rail left it set and ate the NEXT real click.
  // 8px is normal drag slop; the reset is deferred one tick, which still lands
  // after the click that ends the drag but cannot leak past it.
  const DRAG_SLOP = 8;
  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth) return; // nothing to pan
    if (drag.current.resetTimer) clearTimeout(drag.current.resetTimer);
    drag.current = { down: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false, resetTimer: null };
  };
  const onMove = (e) => {
    if (!drag.current.down || !ref.current) return;
    const dx = e.clientX - drag.current.startX;
    if (Math.abs(dx) > DRAG_SLOP) drag.current.moved = true;
    if (drag.current.moved) ref.current.scrollLeft = drag.current.startScroll - dx;
  };
  const endDrag = () => {
    if (!drag.current.down) return;
    drag.current.down = false;
    if (drag.current.moved) {
      drag.current.resetTimer = setTimeout(() => { drag.current.moved = false; drag.current.resetTimer = null; }, 0);
    }
  };
  const onClickCapture = (e) => { if (drag.current.moved) { e.preventDefault(); e.stopPropagation(); } };

  return (
    <div className="relative group/carousel">
      <div
        ref={ref}
        className={innerClassName}
        style={{ ...style, cursor: 'grab' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
      {!atStart && (
        <button
          aria-label="Scroll left"
          onClick={() => scrollBy(-1)}
          className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 z-10 w-9 h-9 items-center justify-center rounded-full bg-surface-2/90 border border-surface-3 text-white shadow-lg backdrop-blur opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:bg-surface-3">
          <Icon name="chevron_left" size={22} />
        </button>
      )}
      {!atEnd && (
        <button
          aria-label="Scroll right"
          onClick={() => scrollBy(1)}
          className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 z-10 w-9 h-9 items-center justify-center rounded-full bg-surface-2/90 border border-surface-3 text-white shadow-lg backdrop-blur opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:bg-surface-3">
          <Icon name="chevron_right" size={22} />
        </button>
      )}
    </div>
  );
}

function VerifiedBadge({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="7" fill="#7B1FFF" />
      <path d="M4 7l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LiveBadge() {
  return (
    <span className="flex items-center gap-1 bg-brand-ember text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE
    </span>
  );
}

/** FollowingLiveRail — horizontal scroll rail of "people you follow who are
    live right now". Sits at the top of Explore when populated. Single biggest
    discovery complaint on TikTok/Twitch — they bury this. */
function FollowingLiveRail({ rows, navigate }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-rose-500"
            style={{ boxShadow: '0 0 8px rgba(244,63,94,0.9)' }} />
          <h2 className="font-syne text-base font-bold text-text-primary">
            Following · Live now
          </h2>
          <span className="text-[11px] font-bold text-text-muted">
            {rows.length}
          </span>
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1"
        style={{ scrollbarWidth: 'thin', scrollSnapType: 'x mandatory' }}>
        {rows.map((r) => (
          <button
            key={r.id}
            onClick={() => navigate(`/watch/${r.id}`)}
            className="shrink-0 w-44 group text-left"
            style={{ scrollSnapAlign: 'start' }}
          >
            <div className="relative aspect-video rounded-xl overflow-hidden"
              style={{
                background: `linear-gradient(135deg, hsl(${(r.id.charCodeAt(0) * 7) % 360}, 45%, 18%), #0B0B14)`,
              }}>
              <div className="absolute top-2 left-2 flex items-center gap-1.5">
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-rose-500 text-white">
                  ● LIVE
                </span>
              </div>
              <div className="absolute bottom-2 right-2 flex items-center gap-1 text-[10px] font-bold text-white bg-black/55 px-1.5 py-0.5 rounded">
                <Icon name="visibility" size={10} className="text-white/80" />
                {r.viewers.toLocaleString()}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <UserAvatar src={r.hostAvatar} size="xs" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-text-primary truncate">
                  {r.hostName}
                </div>
                <div className="text-[10px] text-text-muted truncate">
                  {r.game || r.title}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function StreamCard({ stream, tall, onClick }) {
  return (
    <div className="cursor-pointer group" onClick={onClick}>
      <div className={`relative rounded-xl overflow-hidden ${tall ? 'aspect-[9/16]' : 'aspect-video'}`}
           style={{ background: `linear-gradient(135deg, hsl(${260 + Math.random() * 60}, 50%, 15%) 0%, #0B0B14 100%)` }}>
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <LiveBadge />
          {stream.boosted && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-gradient-to-r from-brand-violet/80 to-brand-pink/80 backdrop-blur-md">
              <span className="material-symbols-outlined text-white" style={{ fontSize: 10 }}>bolt</span>
              <span className="text-white text-[9px] font-bold tracking-wider">BOOSTED</span>
            </div>
          )}
        </div>
        <div className="absolute bottom-2 left-2 right-2">
          <p className="text-white/80 text-xs font-dmmono tabular-nums">{stream.viewers} viewers</p>
        </div>
      </div>
      <div className="mt-2.5">
        <p className="font-bold text-sm text-text-primary truncate">{stream.title}</p>
        <p className="text-text-muted text-xs">{stream.creator} • {stream.game}</p>
      </div>
    </div>
  );
}

function CreatorCard({ c, navigate, following, followBusy, onToggleFollow }) {
  const isFollowed = c.uid ? !!following?.has(c.uid) : false;
  const busy = c.uid ? !!followBusy?.has(c.uid) : false;
  // Full-bleed card background: dedicated card background (profile settings →
  // Cover Banner tab) wins, else the profile banner, else the brand gradient.
  // Content overlays a bottom-heavy scrim so text stays readable.
  const bg = c.cardBackground || c.banner || null;
  return (
    <div className="relative rounded-2xl overflow-hidden text-center border border-surface-3 hover:border-brand-violet-light/30 transition-all cursor-pointer group"
         onClick={() => navigate(c.uid ? `/user/${c.uid}` : `/u/${c.name}`)}
         style={{ background: 'linear-gradient(135deg,#1a0a3a,#2d0a5a)' }}>
      {bg && (
        <img src={bg} alt="" loading="lazy"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
      )}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,rgba(11,11,20,0.15) 0%,rgba(11,11,20,0.5) 50%,rgba(11,11,20,0.9) 100%)' }} />
      <div className="relative z-10 px-4 pt-6 pb-4">
        <div className="relative inline-block mb-2 rounded-full p-[3px]" style={{ background: 'rgba(11,11,20,0.6)', backdropFilter: 'blur(4px)' }}>
          <UserAvatar size={56} src={c.avatar} alt={c.name} />
          {c.live && <div className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-brand-ember border-2 border-surface-1" />}
        </div>
        <div className="flex items-center justify-center gap-1 mb-0.5">
          <p className="font-bold text-sm text-white truncate max-w-full" style={{ textShadow: '0 1px 6px rgba(0,0,0,0.6)' }}>{c.name}</p>
          {c.verified && <VerifiedBadge size={12} />}
        </div>
        <p className="text-xs mb-2" style={{ color: 'rgba(255,255,255,0.78)', textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>{c.followers} followers</p>
        <div className="flex flex-wrap justify-center gap-1 mb-3">
          {c.tags?.slice(0, 2).map(t => (
            <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full ${tagClass(t)}`}>{t}</span>
          ))}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); if (c.uid) onToggleFollow?.(c.uid); }}
          disabled={busy}
          className="w-full py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-60"
          style={isFollowed
            ? { background: 'rgba(11,11,20,0.55)', backdropFilter: 'blur(6px)', border: '1px solid #B44FFF', color: '#D9B3FF' }
            : { background: '#7B1FFF', color: '#fff', boxShadow: '0 2px 12px rgba(123,31,255,0.45)' }}>
          {isFollowed ? 'Following' : 'Follow'}
        </button>
      </div>
    </div>
  );
}

function SquadCard({ s, navigate }) {
  // Banner = the WHOLE card background (full-bleed) with a readability
  // scrim; content sits above it (z-10). The old split layout let the
  // positioned banner strip paint OVER the static avatar/name/Join row.
  return (
    <div className="relative rounded-xl overflow-hidden border border-surface-3 hover:border-brand-violet-light/30 transition-all cursor-pointer group"
         onClick={() => navigate(`/squads/${s.id || ''}`)}
         style={{ background: 'linear-gradient(135deg,#1a0a3a,#2d0a5a)' }}>
      {s.banner && (
        <img src={s.banner} alt="" loading="lazy"
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
      )}
      {/* Scrim — keeps text readable over any banner */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,rgba(11,11,20,0.15) 0%,rgba(11,11,20,0.45) 55%,rgba(11,11,20,0.88) 100%)' }} />
      <div className="relative z-10 px-4 pt-12 pb-4 flex gap-3 items-end">
        {/* Squad avatar */}
        <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 border-2" style={{ borderColor: 'rgba(255,255,255,0.25)', background: 'rgba(123,31,255,0.35)' }}>
          {s.avatar
            ? <img src={s.avatar} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center"><Icon name="shield" size={20} className="text-brand-violet-light" /></div>}
        </div>
        <div className="flex-1 min-w-0 pb-0.5">
          <div className="flex items-center gap-1">
            <p className="font-bold text-sm text-white truncate" style={{ textShadow: '0 1px 6px rgba(0,0,0,0.6)' }}>{s.name}</p>
            {s.verified && <VerifiedBadge size={11} />}
          </div>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.75)', textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
            {s.members} Members{s.online != null ? ` · ${s.online} online` : ''}
          </p>
        </div>
        <button onClick={e => e.stopPropagation()}
          className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
          style={{ background: 'rgba(11,11,20,0.55)', backdropFilter: 'blur(6px)', border: '1px solid #B44FFF', color: '#D9B3FF' }}>Join</button>
      </div>
    </div>
  );
}

function NewsCard({ n, navigate }) {
  return (
    <div className="bg-surface-1 rounded-xl p-4 border border-surface-3 hover:border-brand-violet-light/30 transition-all cursor-pointer"
         onClick={() => n.id && navigate?.(`/post/${n.id}`)}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-brand-violet-light">{n.category}</span>
        {n.hot && <span className="text-[10px] font-bold uppercase tracking-wider text-brand-ember">🔥 Hot</span>}
      </div>
      <p className="font-bold text-sm text-text-primary leading-snug mb-2">{n.title}</p>
      <div className="flex items-center justify-between text-xs">
        <span className={`px-2 py-0.5 rounded-full text-[10px] ${tagClass(n.tag)}`}>{n.tag}</span>
        <span className="text-text-muted">{n.time}</span>
      </div>
    </div>
  );
}

// ─── Tab content ───────────────────────────────────────────────────

function AllTab({ navigate, setTab, streamsToShow, creators, squads, news, following, followBusy, onToggleFollow }) {
  // When nothing is live, lead with Recommended Creators instead of an empty
  // "Trending Now" block (founder: empty space makes it look like a ghost town).
  const hasStreams = streamsToShow.length > 0;
  return (
    <div className="space-y-8">
      {hasStreams && (
        <section>
          <SectionHeader title="Trending Now" onViewAll={() => setTab('Streams')} />
          <div className={gx("grid grid-cols-2 xl:grid-cols-4 gap-4")}>
            {streamsToShow.map((s, i) => <StreamCard key={s.id || i} stream={s} onClick={s.id ? () => navigate(`/watch/${s.id}`) : undefined} />)}
          </div>
        </section>
      )}

      {creators.length > 0 && (
        <section>
          <SectionHeader title="Recommended Creators" onViewAll={() => setTab('Creators')} />
          {/* Two-row horizontal carousel (web/desktop). grid-flow-col + grid-rows-2
              fills top→bottom then advances columns, so it scrolls sideways in 2 rows.
              Carousel adds visible arrow buttons + click-drag (mouse users). */}
          <Carousel
            innerClassName="grid grid-flow-col grid-rows-2 auto-cols-[160px] gap-4 overflow-x-auto no-scrollbar pb-2 -mx-1 px-1"
            style={{ scrollSnapType: 'x proximity' }}>
            {creators.map((c) => (
              <div key={c.uid} style={{ scrollSnapAlign: 'start' }}>
                <CreatorCard c={c} navigate={navigate} following={following} followBusy={followBusy} onToggleFollow={onToggleFollow} />
              </div>
            ))}
          </Carousel>
        </section>
      )}

      {squads.length > 0 && (
        <section>
          <SectionHeader title="Suggested Squads" onViewAll={() => setTab('Squads')} />
          <div className={gx("grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4")}>
            {squads.map((s) => <SquadCard key={s.id} s={s} navigate={navigate} />)}
          </div>
        </section>
      )}

      <section>
        <SectionHeader title="Top Games" onViewAll={() => navigate('/tournaments')} />
        <Carousel innerClassName="flex gap-3 overflow-x-auto no-scrollbar pb-2 -mx-1 px-1" style={{ scrollSnapType: 'x proximity' }}>
          {TOP_GAME_LIST.map((g) => {
            // Real live signal only — count currently-live streams for this game.
            const liveForGame = streamsToShow.filter((s) => (s.game || '').toLowerCase() === g.name.toLowerCase());
            const watchers = liveForGame.reduce((sum, s) => sum + (parseInt(String(s.viewers).replace(/[^0-9]/g, '')) || 0), 0);
            const accent = gameAccent(g.name);
            return (
              <button key={g.id}
                onClick={() => navigate('/tournaments')}
                className="relative rounded-xl overflow-hidden group text-left aspect-[3/4] w-28 shrink-0 border border-surface-3 hover:border-brand-violet-light/40 transition-all"
                style={{ background: `linear-gradient(160deg, ${accent}33 0%, #14141F 55%, #0B0B14 100%)`, scrollSnapAlign: 'start' }}>
                {/* Official cover art (publisher CDN). Gradient base stays
                    visible while loading / for games without art. */}
                {g.coverArt && (
                  <img src={g.coverArt} alt={g.name} loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                )}
                <div className="absolute inset-0 flex items-start justify-end p-2">
                  {liveForGame.length > 0 && (
                    <span className="flex items-center gap-1 bg-brand-ember text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE
                    </span>
                  )}
                </div>
                <div className="absolute inset-x-0 bottom-0 p-2.5"
                     style={{ background: 'linear-gradient(180deg, transparent, rgba(11,11,20,0.85))' }}>
                  <p className="text-[12px] font-bold text-white leading-tight line-clamp-2">{g.name}</p>
                  <p className="text-[10px] font-dmmono" style={{ color: watchers > 0 ? '#9CA3AF' : 'rgba(156,163,175,0.6)' }}>
                    {watchers > 0 ? `${compactNum(watchers)} watching` : g.category}
                  </p>
                </div>
              </button>
            );
          })}
        </Carousel>
      </section>

      {news.length > 0 && (
        <section>
          <SectionHeader title="Latest News" onViewAll={() => setTab('News')} />
          <div className={gx("grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3")}>
            {news.slice(0, 3).map((n) => <NewsCard key={n.id} n={n} navigate={navigate} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function CreatorsTab({ navigate, creators, searching, following, followBusy, onToggleFollow }) {
  if (creators.length === 0) return <EmptyRow icon="group" text={searching ? 'No creators match your search.' : 'No creators to show yet.'} />;
  return (
    <div className={gx("grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4")}>
      {creators.map((c) => <CreatorCard key={c.uid} c={c} navigate={navigate} following={following} followBusy={followBusy} onToggleFollow={onToggleFollow} />)}
    </div>
  );
}

function SquadsTab({ navigate, squads }) {
  if (squads.length === 0) return <EmptyRow icon="shield" text="No public squads yet. Create one!" />;
  return (
    <div className={gx("grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4")}>
      {squads.map((s) => <SquadCard key={s.id} s={s} navigate={navigate} />)}
    </div>
  );
}

function StreamsTab({ navigate, streamsToShow, viewer }) {
  // Language filter chips: 'all', the viewer's own language, then every other
  // language currently live. Lets a single-language viewer watch only streams
  // they understand. Default 'all' (streams are already locale-ranked).
  const [langFilter, setLangFilter] = useState('all');
  const langsLive = Array.from(new Set(streamsToShow.map((s) => s.language).filter(Boolean)));
  // Order chips: viewer's language first if it's live, then the rest.
  const vLang = viewer?.language;
  const orderedLangs = [
    ...(vLang && langsLive.includes(vLang) ? [vLang] : []),
    ...langsLive.filter((l) => l !== vLang),
  ];
  const filtered = langFilter === 'all'
    ? streamsToShow
    : streamsToShow.filter((s) => s.language === langFilter);

  // Split by orientation so viewers can pick desktop (landscape) vs mobile
  // (portrait) streams — different viewing experiences.
  const desktop = filtered.filter(s => s.orientation !== 'portrait');
  const mobile  = filtered.filter(s => s.orientation === 'portrait');
  // Go Live entry point lives at the top of the Streams tab — shown even when
  // nothing is live (that's exactly when a creator wants to start one).
  const GoLiveBtn = (
    <div className="flex items-center justify-between mb-5">
      <h2 className="font-syne font-bold text-base text-text-primary">Live now</h2>
      <button
        onClick={() => navigate('/go-live')}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-extrabold text-white hover:brightness-110 transition-all"
        style={{ background: 'linear-gradient(90deg,#7B1FFF,#C87FFF)', boxShadow: '0 2px 14px rgba(123,31,255,0.4)' }}>
        <Icon name="podcasts" size={16} /> Go Live
      </button>
    </div>
  );
  if (streamsToShow.length === 0) return (
    <>
      {GoLiveBtn}
      <EmptyRow icon="podcasts" text="No live streams right now. Be the first to go live." />
    </>
  );
  return (
    <>
      {GoLiveBtn}
      {orderedLangs.length > 0 && (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <Icon name="translate" size={15} className="text-text-muted" />
          <TabPill label="All languages" active={langFilter === 'all'} onClick={() => setLangFilter('all')} />
          {orderedLangs.map((code) => (
            <TabPill
              key={code}
              label={code === vLang ? `${langLabel(code)} (yours)` : langLabel(code)}
              active={langFilter === code}
              onClick={() => setLangFilter(code)}
            />
          ))}
        </div>
      )}
      {filtered.length === 0 && (
        <EmptyRow icon="translate" text="No live streams in that language right now." />
      )}
      <SectionHeader title="Desktop Streams" />
      {desktop.length === 0 ? (
        <EmptyRow icon="desktop_windows" text="No desktop streams live right now." />
      ) : (
        <div className={gx("grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8")}>
          {desktop.map((s, i) => <StreamCard key={s.id || i} stream={s} onClick={s.id ? () => navigate(`/watch/${s.id}`) : undefined} />)}
        </div>
      )}
      <SectionHeader title="Mobile Streams" />
      {mobile.length === 0 ? (
        <EmptyRow icon="smartphone" text="No mobile streams live right now." />
      ) : (
        <div className={gx("grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4")}>
          {mobile.map((s, i) => <StreamCard key={s.id || i} stream={s} tall onClick={s.id ? () => navigate(`/watch/${s.id}`) : undefined} />)}
        </div>
      )}
    </>
  );
}

function EmptyRow({ icon, text }) {
  return (
    <div className="text-center py-12">
      <Icon name={icon} size={44} className="text-text-muted/25 mx-auto mb-3" />
      <p className="text-text-muted text-sm">{text}</p>
    </div>
  );
}

function ClipsTab({ navigate, search }) {
  const { currentUser } = useAuth();
  const [clips, setClips] = useState([]);
  const [authors, setAuthors] = useState({});   // uid -> { username, avatar }
  const [loading, setLoading] = useState(true);
  const shown = search ? clips.filter((c) => (c.text || '').toLowerCase().includes(search)) : clips;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getDocs(query(
      collection(db, 'posts'),
      where('type', '==', 'clip'),
      orderBy('createdAt', 'desc'),
      limit(24),
    )).then(async (snap) => {
      if (cancelled) return;
      // Clips = native, user-uploaded vertical video ONLY (mirrors ShortsScreen).
      // YouTube-embed posts (news/shorts bots) can't play in this TikTok-style
      // grid and rendered as dead grey tiles, so exclude any embed-backed post,
      // and any bot author, so news bots never appear in the clips grid.
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(r => !r.youtubeVideoId && !r.embedVideoUrl
          && !String(r.authorAccountType || '').includes('bot'));
      setClips(rows);
      // Resolve author display info (avatar + handle) for the TikTok-style overlay.
      const uids = [...new Set(rows.map(r => r.authorId).filter(Boolean))];
      const map = {};
      await Promise.all(uids.map(async (uid) => {
        try {
          const u = await getDoc(doc(db, 'users', uid));
          if (u.exists()) map[uid] = { username: u.data().username || u.data().displayName || 'player', avatar: u.data().avatar || null };
        } catch {}
      }));
      if (!cancelled) setAuthors(map);
    }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <CardGridSkeleton count={9} columns={3} aspect="4/5" />;
  if (shown.length === 0) return (
    <div className="text-center py-12">
      <Icon name="movie" size={48} className="text-text-muted/30 mx-auto mb-3" />
      <p className="text-text-muted">{search ? 'No clips match your search.' : 'No clips yet — be the first to share one.'}</p>
    </div>
  );
  return (
    <div className={gx("grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3")}>
      {shown.map(c => {
        const author = authors[c.authorId] || {};
        const isOwn = c.authorId === currentUser?.uid;
        return (
          <div key={c.id} onClick={() => navigate(`/post/${c.id}`)} className="group cursor-pointer relative aspect-[9/16] rounded-xl overflow-hidden bg-surface-2">
            {c.thumbnailUrl
              ? <img src={c.thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
              : <div className="absolute inset-0 flex items-center justify-center"><Icon name="movie" size={32} className="text-text-muted/30" /></div>}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.05) 40%, rgba(0,0,0,0.75) 100%)' }} />

            {/* Right-side action rail (TikTok-style) */}
            <div className="absolute right-1.5 bottom-12 flex flex-col items-center gap-3 text-white">
              <button onClick={(e) => { e.stopPropagation(); navigate(author.username ? `/user/${c.authorId}` : `/post/${c.id}`); }}
                      className="relative">
                <UserAvatar size={34} src={author.avatar} alt={author.username} />
                {!isOwn && (
                  <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full flex items-center justify-center text-white"
                        style={{ background: '#FF4655' }}>
                    <Icon name="add" size={11} />
                  </span>
                )}
              </button>
              <div className="flex flex-col items-center">
                <Icon name="favorite" size={20} filled className="drop-shadow" />
                <span className="text-[10px] font-bold font-dmmono">{compactNum(c.likeCount || 0)}</span>
              </div>
              <div className="flex flex-col items-center">
                <Icon name="chat_bubble" size={19} className="drop-shadow" />
                <span className="text-[10px] font-bold font-dmmono">{compactNum(c.commentCount || 0)}</span>
              </div>
            </div>

            {/* Title + handle bottom-left */}
            <div className="absolute left-2.5 right-12 bottom-2.5">
              {author.username && <p className="text-[11px] font-bold text-white/90 mb-0.5 truncate">@{author.username}</p>}
              <p className="text-[12px] font-semibold text-white line-clamp-2 leading-snug drop-shadow">{c.text || 'Untitled clip'}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NewsTab({ navigate, news }) {
  if (!news || news.length === 0) return <EmptyRow icon="article" text="No articles yet. Publish one from Create → Article." />;
  return (
    <div className={gx("grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3")}>
      {news.map((n) => <NewsCard key={n.id} n={n} navigate={navigate} />)}
    </div>
  );
}
