// Explore — discovery surface for streams, creators, squads, clips, news.
// Layout adapted from the Claude Design Explore mock. Real data is pulled
// from existing Firestore helpers where available; mock fallbacks fill the
// long tail until those endpoints land.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';

const MAIN_TABS = ['All', 'Creators', 'Squads', 'Streams', 'Clips', 'News'];

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
  { category: 'Tournament',  title: 'VERGR Spring Invitational — €10,000 Prize Pool open',          time: '2h ago', tag: 'VALORANT', hot: true },
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
          <button className="hidden sm:flex items-center gap-2 px-4 py-3 bg-surface-1 border border-surface-3 rounded-xl text-sm text-text-secondary hover:border-brand-violet-light/40 hover:text-text-primary transition-all">
            <Icon name="tune" size={16} /> Filters
          </button>
        </div>

        {/* Tab pills */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {MAIN_TABS.map(t => (
            <TabPill key={t} label={t} active={activeTab === t} onClick={() => setActiveTab(t)} />
          ))}
        </div>

        {activeTab === 'All'      && <AllTab navigate={navigate} setTab={setActiveTab} />}
        {activeTab === 'Creators' && <CreatorsTab navigate={navigate} />}
        {activeTab === 'Squads'   && <SquadsTab navigate={navigate} />}
        {activeTab === 'Streams'  && <StreamsTab />}
        {activeTab === 'Clips'    && <ClipsTab navigate={navigate} />}
        {activeTab === 'News'     && <NewsTab />}
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

function StreamCard({ stream, tall }) {
  return (
    <div className="cursor-pointer group">
      <div className={`relative rounded-xl overflow-hidden ${tall ? 'aspect-[9/16]' : 'aspect-video'}`}
           style={{ background: `linear-gradient(135deg, hsl(${260 + Math.random() * 60}, 50%, 15%) 0%, #0B0B14 100%)` }}>
        <div className="absolute top-2 left-2 flex items-center gap-1.5"><LiveBadge /></div>
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

function CreatorCard({ c, navigate }) {
  return (
    <div className="bg-surface-1 rounded-2xl p-4 text-center border border-surface-3 hover:border-brand-violet-light/30 transition-all cursor-pointer"
         onClick={() => navigate(`/u/${c.name}`)}>
      <div className="relative inline-block mb-2">
        <UserAvatar size={56} src={c.avatar} alt={c.name} />
        {c.live && <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-brand-ember border-2 border-surface-1" />}
      </div>
      <div className="flex items-center justify-center gap-1 mb-0.5">
        <p className="font-bold text-sm text-text-primary truncate max-w-full">{c.name}</p>
        {c.verified && <VerifiedBadge size={12} />}
      </div>
      <p className="text-text-muted text-xs mb-2">{c.followers} followers</p>
      <div className="flex flex-wrap justify-center gap-1 mb-3">
        {c.tags?.slice(0, 2).map(t => (
          <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full ${tagClass(t)}`}>{t}</span>
        ))}
      </div>
      <button onClick={e => e.stopPropagation()}
        className="w-full py-1.5 rounded-lg text-xs font-bold transition-all"
        style={{ background: '#7B1FFF', color: '#fff' }}>Follow</button>
    </div>
  );
}

function SquadCard({ s, navigate }) {
  return (
    <div className="bg-surface-1 rounded-xl p-4 border border-surface-3 hover:border-brand-violet-light/30 transition-all cursor-pointer flex gap-3 items-center"
         onClick={() => navigate(`/squads/${s.id || ''}`)}>
      <div className="w-12 h-12 rounded-xl bg-brand-violet/20 flex items-center justify-center shrink-0">
        <Icon name="shield" size={20} className="text-brand-violet-light" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <p className="font-bold text-sm text-text-primary truncate">{s.name}</p>
          {s.verified && <VerifiedBadge size={11} />}
        </div>
        <p className="text-text-muted text-xs">{s.members} Members</p>
        <p className="text-emerald-400 text-xs flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {s.online} online
        </p>
      </div>
      <button onClick={e => e.stopPropagation()}
        className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
        style={{ border: '1px solid #B44FFF', color: '#B44FFF' }}>Join</button>
    </div>
  );
}

function NewsCard({ n }) {
  return (
    <div className="bg-surface-1 rounded-xl p-4 border border-surface-3 hover:border-brand-violet-light/30 transition-all cursor-pointer">
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

function AllTab({ navigate, setTab }) {
  return (
    <div className="space-y-8">
      <section>
        <SectionHeader title="Trending Now" onViewAll={() => setTab('Streams')} />
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {MOCK_STREAMS.map((s, i) => <StreamCard key={i} stream={s} />)}
        </div>
      </section>

      <section>
        <SectionHeader title="Recommended Creators" onViewAll={() => setTab('Creators')} />
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
          {MOCK_CREATORS.map((c, i) => <CreatorCard key={i} c={c} navigate={navigate} />)}
        </div>
      </section>

      <section>
        <SectionHeader title="Suggested Squads" onViewAll={() => setTab('Squads')} />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {MOCK_SQUADS.map((s, i) => <SquadCard key={i} s={s} navigate={navigate} />)}
        </div>
      </section>

      <section>
        <SectionHeader title="Top Games" />
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          {TRENDING_GAMES.map(g => (
            <button key={g.name}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-surface-1 border border-surface-3 hover:border-brand-violet-light/30 transition-all text-left">
              <span className="w-2 h-2 rounded-full" style={{ background: g.color }} />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-bold text-text-primary truncate">{g.name}</p>
                <p className="text-[10px] text-text-muted font-dmmono">{g.viewers} watching</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="Latest News" onViewAll={() => setTab('News')} />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {MOCK_NEWS.slice(0, 3).map((n, i) => <NewsCard key={i} n={n} />)}
        </div>
      </section>
    </div>
  );
}

function CreatorsTab({ navigate }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
      {MOCK_CREATORS.map((c, i) => <CreatorCard key={i} c={c} navigate={navigate} />)}
    </div>
  );
}

function SquadsTab({ navigate }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {MOCK_SQUADS.map((s, i) => <SquadCard key={i} s={s} navigate={navigate} />)}
    </div>
  );
}

function StreamsTab() {
  return (
    <>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        {MOCK_STREAMS.map((s, i) => <StreamCard key={i} stream={s} />)}
      </div>
      <SectionHeader title="Mobile Streams" />
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
        {MOCK_STREAMS.map((s, i) => <StreamCard key={i} stream={s} tall />)}
      </div>
    </>
  );
}

function ClipsTab({ navigate }) {
  const [clips, setClips] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getDocs(query(
      collection(db, 'posts'),
      where('type', '==', 'clip'),
      orderBy('createdAt', 'desc'),
      limit(24),
    )).then(snap => setClips(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-5">
        {HASHTAGS.map(h => (
          <button key={h.tag}
            className="px-3 py-1.5 rounded-full bg-surface-1 border border-surface-3 hover:border-brand-violet-light/40 transition-all text-[12px] flex items-center gap-2">
            <span className="text-brand-violet-light font-bold">{h.tag}</span>
            <span className="text-text-muted font-dmmono text-[10.5px]">{h.clips}</span>
          </button>
        ))}
      </div>
      {loading ? (
        <div className="py-16 flex justify-center">
          <div className="w-6 h-6 rounded-full border-2 border-brand-violet-light border-t-transparent animate-spin" />
        </div>
      ) : clips.length === 0 ? (
        <div className="text-center py-12">
          <Icon name="movie" size={48} className="text-text-muted/30 mx-auto mb-3" />
          <p className="text-text-muted">No clips yet — be the first to share one.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          {clips.map(c => (
            <div key={c.id} onClick={() => navigate(`/post/${c.id}`)} className="group cursor-pointer">
              <div className="aspect-[9/16] rounded-xl overflow-hidden bg-surface-2 relative">
                {c.thumbnailUrl
                  ? <img src={c.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center"><Icon name="movie" size={32} className="text-text-muted/30" /></div>
                }
                <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 text-white/80 text-xs">
                  <Icon name="favorite" size={11} /> {c.likeCount || 0}
                  <Icon name="chat_bubble" size={11} /> {c.commentCount || 0}
                </div>
              </div>
              <p className="mt-2 text-[12.5px] font-semibold text-text-primary truncate">{c.text || 'Untitled clip'}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function NewsTab() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {MOCK_NEWS.map((n, i) => <NewsCard key={i} n={n} />)}
    </div>
  );
}
