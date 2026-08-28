// src/screens/creator/CreatorContentScreen.jsx
// Creator Studio — Content library. Filter/sort all posts with engagement stats.
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getUserPosts } from '../../firebase/firestore';
import { CardGridSkeleton } from '../../components/skeletons/GlassSkeletons';
import CreatorLayout from '../../components/creator/CreatorLayout';
import { Card, KpiCard, SectionHeader } from '../../components/creator/Widgets';
import { VerticalBarChart, PALETTE, compactNum } from '../../components/creator/charts';
import Icon from '../../components/Icon';

const TYPES = [
  { key: 'all',        label: 'All',          icon: 'apps' },
  { key: 'text',       label: 'Text',         icon: 'subject' },
  { key: 'photo',      label: 'Photo',        icon: 'photo_camera' },
  { key: 'clip',       label: 'Clip',         icon: 'movie' },
  { key: 'short',      label: 'Short',        icon: 'slow_motion_video' },
  { key: 'article',    label: 'Article',      icon: 'article' },
  { key: 'achievement',label: 'Achievement',  icon: 'emoji_events' },
  { key: 'lfg',        label: 'LFG',          icon: 'group_add' },
  { key: 'tierlist',   label: 'Tier List',    icon: 'leaderboard' },
  { key: 'quote',      label: 'Quote',        icon: 'format_quote' },
];

const SORTS = [
  { key: 'recent',    label: 'Newest' },
  { key: 'views',     label: 'Most viewed' },
  { key: 'likes',     label: 'Most liked' },
  { key: 'comments',  label: 'Most comments' },
  { key: 'engagement', label: 'Best engagement' },
];

function tsMs(t) {
  if (!t) return 0;
  if (t.toDate) return t.toDate().getTime();
  if (t.seconds) return t.seconds * 1000;
  return new Date(t).getTime() || 0;
}

export default function CreatorContentScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState('all');
  const [sort, setSort] = useState('recent');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!currentUser) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        // The author's OWN content library, so it keeps showing scheduled posts.
        // getUserPosts filters to published by default now, because it is also
        // used for other people's public profiles where an unpublished post must
        // not appear. This is the one place the opt-in is correct.
        const p = await getUserPosts(currentUser.uid, 200, { includeUnpublished: true });
        if (alive) setPosts(p || []);
      } catch (e) { console.error(e); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [currentUser]);

  const filtered = useMemo(() => {
    let arr = posts;
    if (type !== 'all') arr = arr.filter(p => (p.type || '').toLowerCase() === type);
    if (search) {
      const q = search.toLowerCase();
      arr = arr.filter(p => (p.content || '').toLowerCase().includes(q) || (p.title || '').toLowerCase().includes(q));
    }
    const engagement = (p) => {
      const v = p.viewCount || 0;
      return v ? ((p.likeCount || 0) + (p.commentCount || 0)) / v : 0;
    };
    const sorters = {
      recent: (a, b) => tsMs(b.createdAt) - tsMs(a.createdAt),
      views: (a, b) => (b.viewCount || 0) - (a.viewCount || 0),
      likes: (a, b) => (b.likeCount || 0) - (a.likeCount || 0),
      comments: (a, b) => (b.commentCount || 0) - (a.commentCount || 0),
      engagement: (a, b) => engagement(b) - engagement(a),
    };
    return [...arr].sort(sorters[sort]);
  }, [posts, type, sort, search]);

  const totals = useMemo(() => ({
    posts: posts.length,
    views: posts.reduce((s, p) => s + (p.viewCount || 0), 0),
    likes: posts.reduce((s, p) => s + (p.likeCount || 0), 0),
    comments: posts.reduce((s, p) => s + (p.commentCount || 0), 0),
  }), [posts]);

  // engagement breakdown by content type
  const byTypeData = useMemo(() => {
    const buckets = {};
    TYPES.slice(1).forEach(t => { buckets[t.key] = { label: t.label, Views: 0, Likes: 0, Comments: 0 }; });
    posts.forEach(p => {
      const t = (p.type || 'text').toLowerCase();
      if (!buckets[t]) buckets[t] = { label: t, Views: 0, Likes: 0, Comments: 0 };
      buckets[t].Views += p.viewCount || 0;
      buckets[t].Likes += p.likeCount || 0;
      buckets[t].Comments += p.commentCount || 0;
    });
    return Object.values(buckets).filter(b => b.Views || b.Likes || b.Comments);
  }, [posts]);

  return (
    <CreatorLayout page="content" title="Content library" subtitle="Every post you've ever made">
      {loading ? (
        <CardGridSkeleton count={9} columns={3} aspect="1/1" />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
            <KpiCard label="Posts"    value={totals.posts}    icon="photo_library" iconColor="text-brand-violet-light" />
            <KpiCard label="Views"    value={totals.views}    icon="visibility"    iconColor="text-brand-violet" />
            <KpiCard label="Likes"    value={totals.likes}    icon="favorite"      iconColor="text-brand-pink" />
            <KpiCard label="Comments" value={totals.comments} icon="chat_bubble"   iconColor="text-emerald-400" />
          </div>

          {byTypeData.length > 0 && (
            <Card className="p-4 md:p-5 mb-6">
              <SectionHeader title="Engagement by content type" subtitle="See what your audience loves" />
              <VerticalBarChart
                data={byTypeData}
                series={[
                  { key: 'Views', label: 'Views', color: PALETTE.violet },
                  { key: 'Likes', label: 'Likes', color: PALETTE.pink },
                  { key: 'Comments', label: 'Comments', color: PALETTE.emerald },
                ]}
                height={260}
              />
            </Card>
          )}

          <Card className="p-4 md:p-5">
            <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
              <div className="flex-1 flex items-center gap-2 px-3 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <Icon name="search" size={16} className="text-text-muted" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search your posts..."
                  className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted outline-none" />
              </div>
              <select value={sort} onChange={e => setSort(e.target.value)}
                className="h-10 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-sm text-text-primary outline-none">
                {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <button onClick={() => window.dispatchEvent(new CustomEvent('vergr:open-composer'))}
                className="h-10 px-4 rounded-xl bg-brand-violet text-white font-bold text-sm flex items-center gap-1.5 hover:brightness-110 transition-all">
                <Icon name="add" size={16} /> New post
              </button>
            </div>

            <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 mb-4">
              {TYPES.map(t => (
                <button key={t.key} onClick={() => setType(t.key)}
                  className={`flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all ${
                    type === t.key ? 'bg-brand-violet/15 text-brand-violet-light border border-brand-violet/30' : 'bg-white/[0.03] text-text-muted border border-white/[0.04] hover:text-text-primary'
                  }`}>
                  <Icon name={t.icon} size={12} /> {t.label}
                </button>
              ))}
            </div>

            {filtered.length === 0 ? (
              // "No posts match those filters" was shown even with NO filters
              // set, so a creator with an empty library was sent hunting for
              // something to clear (audit A34). Branch on whether a filter is
              // actually applied, and when it is not, invite the first post.
              // The `+ New post` button exists but sits in the toolbar above,
              // not where the user is looking.
              type === 'all' && !search ? (
                <div className="py-10 text-center">
                  <Icon name="photo_library" size={32} className="text-text-muted mb-2" />
                  <p className="text-text-primary text-sm font-semibold">You have not posted yet</p>
                  <p className="text-text-muted text-xs mt-1">Everything you publish shows up here.</p>
                  <button
                    onClick={() => navigate('/')}
                    className="mt-4 px-4 py-2 rounded-lg text-xs font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)' }}
                  >
                    Create your first post
                  </button>
                </div>
              ) : (
                <div className="py-10 text-center">
                  <Icon name="photo_library" size={32} className="text-text-muted mb-2" />
                  <p className="text-text-muted text-sm">No posts match those filters.</p>
                  <button
                    onClick={() => { setType('all'); setSearch(''); }}
                    className="mt-3 px-4 py-2 rounded-lg text-xs font-semibold text-text-secondary border border-white/10"
                  >
                    Clear filters
                  </button>
                </div>
              )
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {filtered.map(p => {
                  const eng = p.viewCount ? (((p.likeCount || 0) + (p.commentCount || 0)) / p.viewCount) * 100 : 0;
                  return (
                    <button key={p.id} onClick={() => navigate(`/post/${p.id}`)}
                      className="text-left p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.04] hover:border-white/[0.12] transition-all">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] uppercase tracking-widest font-bold text-brand-violet-light">{p.type || 'post'}</span>
                        <span className="text-[10px] text-text-muted">·</span>
                        <span className="text-[10px] text-text-muted">{new Date(tsMs(p.createdAt)).toLocaleDateString()}</span>
                      </div>
                      <p className="text-sm text-text-primary line-clamp-2 mb-3 min-h-[40px]">{p.content || p.title || 'Untitled'}</p>
                      <div className="flex items-center gap-3 text-[11px] text-text-muted">
                        <span className="flex items-center gap-1"><Icon name="visibility" size={12} /> {compactNum(p.viewCount || 0)}</span>
                        <span className="flex items-center gap-1"><Icon name="favorite" size={12} /> {compactNum(p.likeCount || 0)}</span>
                        <span className="flex items-center gap-1"><Icon name="chat_bubble" size={12} /> {compactNum(p.commentCount || 0)}</span>
                        <span className="ml-auto flex items-center gap-1 text-emerald-400 font-bold"><Icon name="trending_up" size={12} /> {eng.toFixed(1)}%</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </CreatorLayout>
  );
}
