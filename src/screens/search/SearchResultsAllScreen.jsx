import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { searchUsers, getSquads, getFeedPosts } from '../../firebase/firestore';
import { applyVanguardMask, isVanguard } from '../../utils/vanguard';
import { useLiveUsers } from '../../context/LiveUsersContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { ListSkeleton } from '../../components/skeletons/GlassSkeletons';
import TopBar from '../../components/TopBar';
import UserAvatar from '../../components/UserAvatar';
import VanguardBadge from '../../components/VanguardBadge';
import Icon from '../../components/Icon';
import BottomNav from '../../components/BottomNav';

export default function SearchResultsAllScreen() {
  const { profile: viewer } = useUser();
  const { isUserLive } = useLiveUsers();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [activeTab, setActiveTab] = useState('People');
  const [users, setUsers] = useState([]);
  const [squads, setSquads] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  const doSearch = useCallback(async (term) => {
    if (!term || term.length < 2) { setUsers([]); setSquads([]); setPosts([]); return; }
    setLoading(true);
    try {
      const [u, s, p] = await Promise.all([searchUsers(term, 10), getSquads(20), getFeedPosts(20)]);
      setUsers(u.filter(user => user.id !== currentUser?.uid));
      setSquads(s.filter(sq => sq.name?.toLowerCase().includes(term.toLowerCase())));
      setPosts(p.filter(post => post.content?.toLowerCase().includes(term.toLowerCase())));
    } catch (err) { console.error(err); }
    setLoading(false);
  }, [currentUser]);

  useEffect(() => {
    const q = searchParams.get('q');
    if (q) { setQuery(q); doSearch(q); }
  }, [searchParams, doSearch]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (query.trim()) { setSearchParams({ q: query.trim() }); doSearch(query.trim()); }
  };

  const tabs = ['People', 'Squads', 'Posts'];
  const currentResults = activeTab === 'People' ? users : activeTab === 'Squads' ? squads : posts;

  return (
    <div className={isDesktop ? 'pb-8' : 'screen-container min-h-screen pb-20'}>
      <div className="sticky top-0 z-40 glass-header">
        <form onSubmit={handleSearch} className="px-4 pt-3 pb-2 flex items-center gap-2">
          <button type="button" onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center shrink-0">
            <Icon name="arrow_back" size={20} />
          </button>
          <div className="flex-1 relative">
            <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people, squads, posts..."
              className="w-full bg-surface-2 border border-white/[0.06] rounded-full py-2.5 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-violet focus:outline-none"
              autoFocus />
          </div>
        </form>
        <div className="flex px-4 gap-4">
          {tabs.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`pb-2.5 text-sm font-bold relative transition-colors ${activeTab === tab ? 'text-brand-violet-light' : 'text-text-muted'}`}>
              {tab}{activeTab === tab && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-violet" />}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3">
        {loading ? (
          <ListSkeleton rows={6} />
        ) : !query.trim() ? (
          <div className="text-center py-16"><Icon name="search" size={48} className="text-text-muted/20 mx-auto mb-3" /><p className="text-text-muted text-sm">Search for people, squads, or posts</p></div>
        ) : currentResults.length === 0 ? (
          <div className="text-center py-16"><Icon name="search_off" size={48} className="text-text-muted/20 mx-auto mb-3" /><p className="text-text-muted text-sm">No {activeTab.toLowerCase()} found for "{query}"</p></div>
        ) : activeTab === 'People' ? (
          <div className={isDesktop ? 'grid grid-cols-2 gap-3' : 'space-y-2'}>
            {users.map(user => {
              const masked = applyVanguardMask(user, viewer);
              const isMasked = !!masked?.isVanguardPersona;
              const vRank = user.vanguard?.rank;
              return (
              <button key={user.id} onClick={() => navigate(`/user/${user.id}`)}
                className="flex items-center gap-3 w-full p-3 rounded-2xl bg-surface-1 border border-white/[0.06] text-left hover:border-white/[0.12] transition-colors">
                <UserAvatar src={masked.avatar} size="md" isLive={!isMasked && isUserLive(user.id)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <p className="text-sm font-semibold truncate">{masked.displayName || masked.username}</p>
                    {!isMasked && user.isVerified && <Icon name="verified" filled size={14} className="text-brand-violet-light" />}
                    {vRank && <VanguardBadge rank={vRank} size={13} />}
                  </div>
                  <p className="text-xs text-text-muted">@{masked.username}</p>
                </div>
                <Icon name="chevron_right" size={18} className="text-text-muted" />
              </button>
              );
            })}
          </div>
        ) : activeTab === 'Squads' ? (
          <div className={isDesktop ? 'grid grid-cols-2 gap-3' : 'space-y-2'}>
            {squads.map(squad => (
              <button key={squad.id} onClick={() => navigate(`/squads/${squad.id}`)}
                className="flex items-center gap-3 w-full p-3 rounded-2xl bg-surface-1 border border-white/[0.06] text-left hover:border-white/[0.12] transition-colors">
                <div className="w-12 h-12 rounded-xl bg-surface-3 flex items-center justify-center text-xl">{squad.avatar || '🎮'}</div>
                <div className="flex-1 min-w-0"><p className="text-sm font-semibold truncate">{squad.name}</p><p className="text-xs text-text-muted">{squad.game} · {squad.memberCount || 0} members</p></div>
                <Icon name="chevron_right" size={18} className="text-text-muted" />
              </button>
            ))}
          </div>
        ) : (
          <div className={isDesktop ? 'grid grid-cols-2 gap-3' : 'space-y-3'}>
            {posts.map(post => (
              <button key={post.id} onClick={() => navigate(`/post/${post.id}`)}
                className="w-full p-3 rounded-2xl bg-surface-1 border border-white/[0.06] text-left hover:border-white/[0.12] transition-colors">
                {(() => {
                  const a = applyVanguardMask(post.author, viewer);
                  return (
                    <div className="flex items-center gap-2 mb-1">
                      <UserAvatar src={a?.avatar} size="sm" />
                      <span className="text-xs font-semibold">{a?.displayName || a?.username}</span>
                      {post.author?.vanguard?.rank && <VanguardBadge rank={post.author.vanguard.rank} size={11} />}
                    </div>
                  );
                })()}
                <p className="text-sm text-text-primary line-clamp-2">{post.content}</p>
                <div className="flex gap-3 mt-2">
                  <span className="text-[10px] text-text-muted flex items-center gap-1"><Icon name="favorite" size={10} /> {post.likeCount || 0}</span>
                  <span className="text-[10px] text-text-muted flex items-center gap-1"><Icon name="chat_bubble" size={10} /> {post.commentCount || 0}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {!isDesktop && <BottomNav />}
    </div>
  );
}
