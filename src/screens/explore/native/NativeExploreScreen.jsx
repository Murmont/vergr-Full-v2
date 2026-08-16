// NativeExploreScreen — dedicated phone-first Explore for the native APK.
// Reuses the exact Firestore queries + helpers as the web ExploreScreen, but
// is a mobile-first redesign: sticky search header, horizontal tab scroller,
// fixed intrinsic grids (2-up streams/creators/clips, single-column squads/news),
// no desktop max-w column or !isMobile branches. Routed IS_NATIVE_BUILD only.

import { useState, useEffect } from 'react';
import { isDiscoverableStream, streamPremium } from '../../../utils/streamVisibility';
import StreamStateBadge from '../../../components/streams/StreamStateBadge';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import { getSquads, searchUsers, followUser, unfollowUser } from '../../../firebase/firestore';
import { hiddenFromDiscovery } from '../../../utils/privacy';
import { TOURNAMENT_GAMES } from '../../../utils/tournamentGames';
import { compactNum } from '../../../components/creator/charts';
import { timeAgo } from '../../../utils/helpers';
import { useAuth } from '../../../context/AuthContext';
import { useUser } from '../../../context/UserContext';
import { viewerLocale, rankByLocale, langLabel } from '../../../utils/localePrefs';
import Icon from '../../../components/Icon';
import UserAvatar from '../../../components/UserAvatar';

const MAIN_TABS = ['All', 'Creators', 'Squads', 'Streams', 'Clips', 'News'];
const isBotAccount = (u) => /bot/i.test(String(u?.accountType || ''));
// Top games for the discovery carousel (same registry + cover art as web).
const TOP_GAME_LIST = TOURNAMENT_GAMES.slice(0, 12).map((g) => ({ id: g.id, name: g.label, category: g.category, coverArt: g.coverArt || null }));
const GAME_ACCENT = {
  'VALORANT': '#FF4655', 'Counter-Strike 2': '#F0A500', 'League of Legends': '#0BC6E3',
  'Dota 2': '#C23C2A', 'Apex Legends': '#DA292A', 'Fortnite': '#1F9BF0',
  'Overwatch 2': '#F99E1A', 'Rocket League': '#0B84CE',
};
const gameAccent = (label) => GAME_ACCENT[label] || '#7B1FFF';
const dedupeByUid = (rows) => {
  const seen = new Set();
  return rows.filter((r) => { const k = r.uid || r.id; if (!k || seen.has(k)) return false; seen.add(k); return true; });
};

const tagClass = (tag) => ({
  'VALORANT': 'bg-red-500/20 text-red-400', 'Valorant': 'bg-red-500/20 text-red-400',
  'Apex Legends': 'bg-orange-500/20 text-orange-400', 'Apex': 'bg-orange-500/20 text-orange-400',
  'FPS': 'bg-brand-violet/20 text-brand-violet-light', 'Comp': 'bg-brand-pink/20 text-brand-pink',
  'Warzone': 'bg-yellow-600/20 text-yellow-400', 'Fortnite': 'bg-blue-500/20 text-blue-400',
  'BR': 'bg-blue-500/20 text-blue-400', 'CS2': 'bg-yellow-500/20 text-yellow-400',
  'Multi': 'bg-emerald-500/20 text-emerald-400', 'Social': 'bg-pink-500/20 text-pink-400',
  'IRL': 'bg-pink-500/20 text-pink-400', 'VERGR': 'bg-brand-violet/20 text-brand-violet-light',
}[tag] || 'bg-white/10 text-white/60');

export default function NativeExploreScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const [activeTab, setActiveTab] = useState('All');
  const [search, setSearch] = useState('');
  const [userResults, setUserResults] = useState(null);
  const [realStreams, setRealStreams] = useState([]);
  const [realCreators, setRealCreators] = useState([]);
  const [realSquads, setRealSquads] = useState([]);
  const [realNews, setRealNews] = useState([]);
  const [followingLive, setFollowingLive] = useState([]);
  // Real follow state for the Creator cards (was a dead static button).
  const [followingSet, setFollowingSet] = useState(() => new Set());
  const [followBusy, setFollowBusy] = useState(() => new Set());
  useEffect(() => {
    if (!currentUser?.uid) { setFollowingSet(new Set()); return; }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'users', currentUser.uid, 'following'), limit(500)));
        if (!cancelled) setFollowingSet(new Set(snap.docs.map((d) => d.id)));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [currentUser?.uid]);
  const toggleFollow = async (uid) => {
    if (!uid || !currentUser?.uid || followBusy.has(uid)) return;
    const was = followingSet.has(uid);
    setFollowBusy((p) => new Set(p).add(uid));
    setFollowingSet((p) => { const n = new Set(p); was ? n.delete(uid) : n.add(uid); return n; });
    try { was ? await unfollowUser(currentUser.uid, uid) : await followUser(currentUser.uid, uid); }
    catch { setFollowingSet((p) => { const n = new Set(p); was ? n.add(uid) : n.delete(uid); return n; }); }
    finally { setFollowBusy((p) => { const n = new Set(p); n.delete(uid); return n; }); }
  };

  // Live streams
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'streams'), where('status', '==', 'live'), orderBy('viewerCount', 'desc'), limit(24)));
        if (cancelled) return;
        setRealStreams(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter(isDiscoverableStream).map((s) => {
          const d = { id: s.id };
          return {
            id: d.id, hostUid: s.hostUid || null, title: s.title || 'Live Stream',
            creator: s.hostUsername || s.hostUid?.slice(0, 6) || 'creator', game: s.game || 'Live',
            viewers: (s.viewerCount || 0).toLocaleString(), boosted: !!s.boosted,
            orientation: s.orientation || 'landscape',
            language: s.language || null, country: s.hostCountry || null,
            // A Premium Live is discoverable on purpose. The card must say it
            // costs coins, or the paywall is a surprise.
            ...streamPremium(s),
          };
        }));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);
  const liveHostSet = new Set(realStreams.map((r) => r.hostUid).filter(Boolean));

  // Top creators
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Founder rule: show every user EXCEPT guests + those opted out of public
        // discovery (Settings → Privacy). No onboarding/post/admin gate. Real
        // people ranked first, bots last (not excluded).
        const snap = await getDocs(query(collection(db, 'users'), limit(300)));
        if (cancelled) return;
        const rows = snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
          .filter((u) => u.username && u.isGuest !== true && !/^guest_/i.test(u.username)
            && u.hideFromEnumeration !== true && !hiddenFromDiscovery(u, 'suggested'))
          .sort((a, b) => {
            const ab = isBotAccount(a) ? 1 : 0, bb = isBotAccount(b) ? 1 : 0;
            if (ab !== bb) return ab - bb;
            return (b.followerCount || 0) - (a.followerCount || 0);
          });
        setRealCreators(rows.slice(0, 40).map((u) => ({
          uid: u.uid, name: u.username || u.displayName || 'Player', avatar: u.avatar || u.photoURL || null,
          followers: compactNum(u.followerCount || 0), verified: !!u.isVerified, live: liveHostSet.has(u.uid),
          country: u.country || null,
          tags: Array.isArray(u.favoriteGames) ? u.favoriteGames.slice(0, 2) : [],
        })));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [realStreams]);

  // Debounced user search
  useEffect(() => {
    const t = search.trim();
    if (!t) { setUserResults(null); return; }
    let cancelled = false;
    const tm = setTimeout(async () => {
      try {
        const found = await searchUsers(t, 20);
        if (cancelled) return;
        setUserResults(found.filter((u) => !isBotAccount(u)).map((u) => ({
          uid: u.id, name: u.username || u.displayName || 'Player', avatar: u.avatar || u.photoURL || null,
          followers: compactNum(u.followerCount || 0), verified: !!u.isVerified, live: false,
          tags: Array.isArray(u.favoriteGames) ? u.favoriteGames.slice(0, 2) : [],
        })));
      } catch { if (!cancelled) setUserResults([]); }
    }, 250);
    return () => { cancelled = true; clearTimeout(tm); };
  }, [search]);

  // Articles (news)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'posts'), where('type', '==', 'article'), orderBy('createdAt', 'desc'), limit(12)));
        if (cancelled) return;
        setRealNews(snap.docs.map((d) => {
          const p = d.data();
          return {
            id: d.id, category: 'Article', title: p.title || p.content?.slice(0, 80) || 'Untitled',
            tag: p.gameId || p.game || 'VERGR', time: p.createdAt?.toDate ? timeAgo(p.createdAt.toDate()) : '',
            hot: (p.likeCount || 0) > 25,
          };
        }));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  // Squads
  useEffect(() => {
    let cancelled = false;
    getSquads(12).then((list) => {
      if (cancelled) return;
      setRealSquads(list.map((s) => ({
        id: s.id, name: s.name || s.tag || 'Squad', members: compactNum(s.memberCount || s.memberIds?.length || 0),
        online: s.onlineCount || null, verified: !!s.verified, tags: Array.isArray(s.tags) ? s.tags.slice(0, 2) : [],
      })));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Following live
  useEffect(() => {
    if (!currentUser?.uid) { setFollowingLive([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const followingSnap = await getDocs(query(collection(db, 'users', currentUser.uid, 'following'), limit(300)));
        if (cancelled || followingSnap.empty) return;
        const uids = followingSnap.docs.map((d) => d.id);
        if (!uids.length) return;
        const chunks = [];
        for (let i = 0; i < uids.length; i += 30) chunks.push(uids.slice(i, i + 30));
        const liveDocs = (await Promise.all(chunks.map((c) => getDocs(query(
          collection(db, 'streams'), where('status', '==', 'live'), where('hostUid', 'in', c), limit(30),
        ))))).flatMap((s) => s.docs);
        if (cancelled) return;
        const enriched = await Promise.all(liveDocs.map(async (sd) => {
          const s = sd.data();
          let hostName = s.hostUsername || s.hostUid?.slice(0, 6); let hostAvatar = null;
          try {
            const u = await getDoc(doc(db, 'users', s.hostUid));
            if (u.exists()) { hostName = u.data().displayName || u.data().username || hostName; hostAvatar = u.data().avatar || null; }
          } catch {}
          return { id: sd.id, title: s.title || 'Live', game: s.game || '', viewers: s.viewerCount || 0, hostName, hostAvatar, ...streamPremium(s) };
        }));
        if (!cancelled) setFollowingLive(enriched);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [currentUser?.uid]);

  const term = search.trim().replace(/^@+/, '').toLowerCase();
  const searching = term.length > 0;
  const viewer = viewerLocale(profile);
  const creators = rankByLocale(
    searching
      ? dedupeByUid([...(userResults || []), ...realCreators.filter((c) => (c.name || '').toLowerCase().includes(term))])
      : realCreators,
    viewer,
    (c) => ({ country: c.country, language: undefined }),
  );
  const squads = searching ? realSquads.filter((s) => (s.name || '').toLowerCase().includes(term)) : realSquads;
  const streams = rankByLocale(
    searching ? realStreams.filter((s) => `${s.title} ${s.creator} ${s.game}`.toLowerCase().includes(term)) : realStreams,
    viewer,
    (s) => ({ country: s.country, language: s.language }),
  );
  const news = searching ? realNews.filter((n) => (n.title || '').toLowerCase().includes(term)) : realNews;

  return (
    <div className="min-h-screen pb-10">
      {/* Sticky native header: title + search + tab scroller */}
      <div className="sticky top-0 z-20 bg-bg-dark/95 backdrop-blur-md border-b border-surface-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}>
        <div className="px-4 pb-2 flex items-center justify-between">
          <h1 className="font-syne text-xl font-black text-text-primary">Explore</h1>
        </div>
        <div className="px-4 pb-3">
          <div className="relative">
            <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search creators, squads, streams..."
              className="w-full bg-surface-1 border border-surface-3 rounded-xl pl-10 pr-4 py-3 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-brand-violet-light/50" />
          </div>
        </div>
        <div className="flex gap-2 px-4 pb-2 overflow-x-auto no-scrollbar">
          {MAIN_TABS.map((t) => (
            <button key={t} onClick={() => setActiveTab(t)}
              className="px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap shrink-0"
              style={activeTab === t ? { background: '#7B1FFF', color: '#fff' } : { background: '#14141F', border: '1px solid #2A2A3E', color: '#9CA3AF' }}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-4">
        {followingLive.length > 0 && (activeTab === 'All' || activeTab === 'Streams') && (
          <FollowingLiveRail rows={followingLive} navigate={navigate} />
        )}

        {activeTab === 'All' && (
          <div className="space-y-7">
            {/* When nothing is live, lead with creators instead of an empty
                "Trending Now" block (founder: no ghost-town empty space). */}
            {streams.length > 0 && (
              <Section title="Trending Now" onMore={() => setActiveTab('Streams')}>
                <div className="grid grid-cols-2 gap-3">{streams.slice(0, 6).map((s) => <StreamCard key={s.id} stream={s} onClick={() => navigate(`/watch/${s.id}`)} />)}</div>
              </Section>
            )}
            {creators.length > 0 && (
              <Section title="Recommended Creators" onMore={() => setActiveTab('Creators')}>
                {/* One-row horizontal carousel (native). */}
                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1" style={{ scrollSnapType: 'x mandatory' }}>
                  {creators.map((c) => (
                    <div key={c.uid} className="shrink-0 w-36" style={{ scrollSnapAlign: 'start' }}>
                      <CreatorCard c={c} navigate={navigate} following={followingSet} followBusy={followBusy} onToggleFollow={toggleFollow} />
                    </div>
                  ))}
                </div>
              </Section>
            )}
            {squads.length > 0 && (
              <Section title="Suggested Squads" onMore={() => setActiveTab('Squads')}>
                <div className="space-y-2">{squads.slice(0, 4).map((s) => <SquadCard key={s.id} s={s} navigate={navigate} />)}</div>
              </Section>
            )}
            <Section title="Top Games" onMore={() => navigate('/tournaments')}>
              <GamesCarousel streams={streams} navigate={navigate} />
            </Section>
            {news.length > 0 && (
              <Section title="Latest News" onMore={() => setActiveTab('News')}>
                <div className="space-y-2">{news.slice(0, 3).map((n) => <NewsCard key={n.id} n={n} navigate={navigate} />)}</div>
              </Section>
            )}
          </div>
        )}

        {activeTab === 'Creators' && (creators.length === 0
          ? <Empty icon="group" text={searching ? 'No creators match your search.' : 'No creators to show yet.'} />
          : <div className="grid grid-cols-2 gap-3">{creators.map((c) => <CreatorCard key={c.uid} c={c} navigate={navigate} following={followingSet} followBusy={followBusy} onToggleFollow={toggleFollow} />)}</div>)}

        {activeTab === 'Squads' && (squads.length === 0
          ? <Empty icon="shield" text="No public squads yet. Create one!" />
          : <div className="space-y-2">{squads.map((s) => <SquadCard key={s.id} s={s} navigate={navigate} />)}</div>)}

        {activeTab === 'Streams' && <StreamsTab streams={streams} navigate={navigate} viewer={viewer} />}
        {activeTab === 'Clips' && <ClipsTab navigate={navigate} search={term} />}
        {activeTab === 'News' && (news.length === 0
          ? <Empty icon="article" text="No articles yet. Publish one from Create → Article." />
          : <div className="space-y-2">{news.map((n) => <NewsCard key={n.id} n={n} navigate={navigate} />)}</div>)}
      </div>
    </div>
  );
}

function Section({ title, onMore, children }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-syne font-bold text-base text-text-primary">{title}</h2>
        {onMore && <button onClick={onMore} className="text-brand-violet-light text-sm font-semibold">View All</button>}
      </div>
      {children}
    </section>
  );
}

function FollowingLiveRail({ rows, navigate }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-rose-500" style={{ boxShadow: '0 0 8px rgba(244,63,94,0.9)' }} />
        <h2 className="font-syne text-base font-bold text-text-primary">Following · Live now</h2>
        <span className="text-[11px] font-bold text-text-muted">{rows.length}</span>
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1" style={{ scrollSnapType: 'x mandatory' }}>
        {rows.map((r) => (
          <button key={r.id} onClick={() => navigate(`/watch/${r.id}`)} className="shrink-0 w-44 text-left" style={{ scrollSnapAlign: 'start' }}>
            <div className="relative aspect-video rounded-xl overflow-hidden" style={{ background: `linear-gradient(135deg, hsl(${(r.id.charCodeAt(0) * 7) % 360}, 45%, 18%), #0B0B14)` }}>
              <span className="absolute top-2 left-2">
                <StreamStateBadge isPremium={r.isPremium} priceCoins={r.priceCoins} size="sm" />
              </span>
              <div className="absolute bottom-2 right-2 flex items-center gap-1 text-[10px] font-bold text-white bg-black/55 px-1.5 py-0.5 rounded">
                <Icon name="visibility" size={10} className="text-white/80" />{r.viewers.toLocaleString()}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <UserAvatar src={r.hostAvatar} size="xs" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-text-primary truncate">{r.hostName}</div>
                <div className="text-[10px] text-text-muted truncate">{r.game || r.title}</div>
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
    <div className="cursor-pointer" onClick={onClick}>
      <div className={`relative rounded-xl overflow-hidden ${tall ? 'aspect-[9/16]' : 'aspect-video'}`}
        style={{ background: 'linear-gradient(135deg, hsl(275,50%,15%) 0%, #0B0B14 100%)' }}>
        <span className="absolute top-2 left-2">
          <StreamStateBadge isPremium={stream.isPremium} priceCoins={stream.priceCoins} />
        </span>
        <p className="absolute bottom-2 left-2 right-2 text-white/80 text-xs font-dmmono tabular-nums">{stream.viewers} viewers</p>
      </div>
      <p className="mt-2 font-bold text-sm text-text-primary truncate">{stream.title}</p>
      <p className="text-text-muted text-xs truncate">{stream.creator} • {stream.game}</p>
    </div>
  );
}

function GamesCarousel({ streams, navigate }) {
  return (
    <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1" style={{ scrollSnapType: 'x proximity' }}>
      {TOP_GAME_LIST.map((g) => {
        const liveForGame = streams.filter((s) => (s.game || '').toLowerCase() === g.name.toLowerCase());
        const watchers = liveForGame.reduce((sum, s) => sum + (parseInt(String(s.viewers).replace(/[^0-9]/g, '')) || 0), 0);
        const accent = gameAccent(g.name);
        return (
          <button key={g.id} onClick={() => navigate('/tournaments')}
            className="relative rounded-xl overflow-hidden text-left aspect-[3/4] w-24 shrink-0 border border-surface-3"
            style={{ background: `linear-gradient(160deg, ${accent}33 0%, #14141F 55%, #0B0B14 100%)`, scrollSnapAlign: 'start' }}>
            {g.coverArt && <img src={g.coverArt} alt={g.name} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />}
            {liveForGame.length > 0 && (
              <span className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-brand-ember text-white text-[8px] font-bold px-1 py-0.5 rounded">
                <span className="w-1 h-1 rounded-full bg-white animate-pulse" /> LIVE
              </span>
            )}
            <div className="absolute inset-x-0 bottom-0 p-1.5" style={{ background: 'linear-gradient(180deg, transparent, rgba(11,11,20,0.85))' }}>
              <p className="text-[11px] font-bold text-white leading-tight line-clamp-2">{g.name}</p>
              <p className="text-[9px] font-dmmono" style={{ color: watchers > 0 ? '#9CA3AF' : 'rgba(156,163,175,0.6)' }}>
                {watchers > 0 ? `${compactNum(watchers)} watching` : g.category}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function CreatorCard({ c, navigate, following, followBusy, onToggleFollow }) {
  const isFollowed = c.uid ? !!following?.has(c.uid) : false;
  const busy = c.uid ? !!followBusy?.has(c.uid) : false;
  return (
    <div className="bg-surface-1 rounded-2xl p-4 text-center border border-surface-3 cursor-pointer"
      onClick={() => navigate(c.uid ? `/user/${c.uid}` : `/u/${c.name}`)}>
      <div className="relative inline-block mb-2">
        <UserAvatar size={56} src={c.avatar} alt={c.name} />
        {c.live && <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-brand-ember border-2 border-surface-1" />}
      </div>
      <p className="font-bold text-sm text-text-primary truncate">{c.name}</p>
      <p className="text-text-muted text-xs mb-2">{c.followers} followers</p>
      <button
        onClick={(e) => { e.stopPropagation(); if (c.uid) onToggleFollow?.(c.uid); }}
        disabled={busy}
        className="w-full py-1.5 rounded-lg text-xs font-bold disabled:opacity-60"
        style={isFollowed
          ? { background: 'rgba(255,255,255,0.06)', border: '1px solid #B44FFF', color: '#D9B3FF' }
          : { background: '#7B1FFF', color: '#fff' }}>
        {isFollowed ? 'Following' : 'Follow'}
      </button>
    </div>
  );
}

function SquadCard({ s, navigate }) {
  return (
    <div className="bg-surface-1 rounded-xl p-4 border border-surface-3 cursor-pointer flex gap-3 items-center" onClick={() => navigate(`/squads/${s.id || ''}`)}>
      <div className="w-12 h-12 rounded-xl bg-brand-violet/20 flex items-center justify-center shrink-0">
        <Icon name="shield" size={20} className="text-brand-violet-light" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm text-text-primary truncate">{s.name}</p>
        <p className="text-text-muted text-xs">{s.members} Members</p>
        {s.online != null && <p className="text-emerald-400 text-xs flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {s.online} online</p>}
      </div>
      <button onClick={(e) => e.stopPropagation()} className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ border: '1px solid #B44FFF', color: '#B44FFF' }}>Join</button>
    </div>
  );
}

function NewsCard({ n, navigate }) {
  return (
    <div className="bg-surface-1 rounded-xl p-4 border border-surface-3 cursor-pointer" onClick={() => n.id && navigate(`/post/${n.id}`)}>
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

function StreamsTab({ streams, navigate, viewer }) {
  const [langFilter, setLangFilter] = useState('all');
  // Go Live entry point — always visible on the Streams tab, even with nothing live.
  const goLive = (
    <div className="flex items-center justify-between mb-4">
      <h2 className="font-syne font-bold text-base text-text-primary">Live now</h2>
      <button onClick={() => navigate('/go-live')}
        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-extrabold text-white"
        style={{ background: 'linear-gradient(90deg,#7B1FFF,#C87FFF)' }}>
        <Icon name="podcasts" size={16} /> Go Live
      </button>
    </div>
  );
  if (streams.length === 0) return <>{goLive}<Empty icon="podcasts" text="No live streams right now. Be the first to go live." /></>;
  const vLang = viewer?.language;
  const langsLive = Array.from(new Set(streams.map((s) => s.language).filter(Boolean)));
  const orderedLangs = [
    ...(vLang && langsLive.includes(vLang) ? [vLang] : []),
    ...langsLive.filter((l) => l !== vLang),
  ];
  const filtered = langFilter === 'all' ? streams : streams.filter((s) => s.language === langFilter);
  const desktop = filtered.filter((s) => s.orientation !== 'portrait');
  const mobile = filtered.filter((s) => s.orientation === 'portrait');
  const Chip = ({ code, label }) => (
    <button
      onClick={() => setLangFilter(code)}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${
        langFilter === code ? 'bg-brand-violet text-white' : 'bg-white/[0.06] text-text-secondary'
      }`}
    >{label}</button>
  );
  return (
    <div className="space-y-6">
      {goLive}
      {orderedLangs.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
          <Icon name="translate" size={15} className="text-text-muted shrink-0" />
          <Chip code="all" label="All" />
          {orderedLangs.map((code) => (
            <Chip key={code} code={code} label={code === vLang ? `${langLabel(code)} (yours)` : langLabel(code)} />
          ))}
        </div>
      )}
      {filtered.length === 0 && <Empty icon="translate" text="No live streams in that language right now." />}
      <Section title="Desktop Streams">
        {desktop.length === 0 ? <Empty icon="desktop_windows" text="No desktop streams live." />
          : <div className="grid grid-cols-2 gap-3">{desktop.map((s) => <StreamCard key={s.id} stream={s} onClick={() => navigate(`/watch/${s.id}`)} />)}</div>}
      </Section>
      <Section title="Mobile Streams">
        {mobile.length === 0 ? <Empty icon="smartphone" text="No mobile streams live." />
          : <div className="grid grid-cols-2 gap-3">{mobile.map((s) => <StreamCard key={s.id} stream={s} tall onClick={() => navigate(`/watch/${s.id}`)} />)}</div>}
      </Section>
    </div>
  );
}

function ClipsTab({ navigate, search }) {
  const [clips, setClips] = useState([]);
  const [loading, setLoading] = useState(true);
  const shown = search ? clips.filter((c) => (c.text || '').toLowerCase().includes(search)) : clips;
  useEffect(() => {
    setLoading(true);
    getDocs(query(collection(db, 'posts'), where('type', '==', 'clip'), orderBy('createdAt', 'desc'), limit(24)))
      // Clips = native, user-uploaded vertical video ONLY (mirrors web ExploreScreen
      // + ShortsScreen). YouTube-embed posts (news/shorts bots) can't play in this
      // grid and render as dead tiles, so exclude any embed-backed or bot-author post.
      .then((snap) => setClips(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => !r.youtubeVideoId && !r.embedVideoUrl
          && !String(r.authorAccountType || '').includes('bot'))))
      .catch(() => {}).finally(() => setLoading(false));
  }, []);
  if (loading) return <div className="grid grid-cols-2 gap-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="aspect-[9/16] rounded-xl bg-surface-2 animate-pulse" />)}</div>;
  if (shown.length === 0) return <Empty icon="movie" text={search ? 'No clips match your search.' : 'No clips yet — be the first to share one.'} />;
  return (
    <div className="grid grid-cols-2 gap-3">
      {shown.map((c) => (
        <div key={c.id} onClick={() => navigate(`/post/${c.id}`)} className="cursor-pointer">
          <div className="aspect-[9/16] rounded-xl overflow-hidden bg-surface-2 relative">
            {c.thumbnailUrl ? <img src={c.thumbnailUrl} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center"><Icon name="movie" size={32} className="text-text-muted/30" /></div>}
            <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 text-white/80 text-xs">
              <Icon name="favorite" size={11} /> {c.likeCount || 0}
              <Icon name="chat_bubble" size={11} /> {c.commentCount || 0}
            </div>
          </div>
          <p className="mt-2 text-[12.5px] font-semibold text-text-primary truncate">{c.text || 'Untitled clip'}</p>
        </div>
      ))}
    </div>
  );
}

function Empty({ icon, text }) {
  return (
    <div className="text-center py-12">
      <Icon name={icon} size={44} className="text-text-muted/25 mx-auto mb-3" />
      <p className="text-text-muted text-sm">{text}</p>
    </div>
  );
}
