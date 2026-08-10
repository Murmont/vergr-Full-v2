// Right rail for Home / Feed.
// Cards: Live Now · Trending · Who To Follow · Upcoming Cups · Active Squads
// Every section reads from Firestore. Empty sections render a short
// "nothing here yet" message instead of dummy content.
import { useEffect, useState } from 'react';
import { isDiscoverableStream } from '../../utils/streamVisibility';
import CachedImg from '../CachedImg';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import Icon from '../Icon';
import UserAvatar from '../UserAvatar';

function compact(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export default function HomeFeedRail() {
  const navigate = useNavigate();
  const [liveStreams, setLiveStreams] = useState([]);
  const [hashtags, setHashtags] = useState([]);
  const [creators, setCreators] = useState([]);
  const [squads, setSquads] = useState([]);
  const [loaded, setLoaded] = useState({ live: false, tags: false, creators: false, squads: false });

  useEffect(() => {
    let alive = true;
    const mark = (k) => alive && setLoaded(s => ({ ...s, [k]: true }));

    // Live streams currently airing.
    (async () => {
      try {
        const q = query(
          collection(db, 'streams'),
          where('status', '==', 'live'),
          orderBy('viewerCount', 'desc'),
          limit(3),
        );
        const snap = await getDocs(q);
        if (alive) setLiveStreams(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(isDiscoverableStream));
      } catch (err) {
        console.warn('Live streams query failed (likely composite index missing)', err.message);
      } finally { mark('live'); }
    })();

    // Trending hashtags.
    (async () => {
      try {
        const q = query(collection(db, 'hashtags'), orderBy('postCount', 'desc'), limit(6));
        const snap = await getDocs(q);
        if (alive) setHashtags(snap.docs.map(d => ({ tag: d.id, posts: d.data().postCount || 0 })));
      } catch {}
      finally { mark('tags'); }
    })();

    // Who to follow — verified creators sorted by follower count.
    (async () => {
      try {
        const q = query(collection(db, 'users'), where('isVerified', '==', true), orderBy('followerCount', 'desc'), limit(4));
        const snap = await getDocs(q);
        if (alive) setCreators(snap.docs.map(d => ({
          id: d.id,
          name: d.data().displayName || d.data().username,
          handle: '@' + (d.data().username || ''),
          followers: d.data().followerCount || 0,
          avatar: d.data().avatar,
          verified: d.data().isVerified,
        })));
      } catch {}
      finally { mark('creators'); }
    })();

    // Active public squads sorted by member count.
    (async () => {
      try {
        const q = query(
          collection(db, 'squads'),
          where('isPublic', '==', true),
          orderBy('memberCount', 'desc'),
          limit(3),
        );
        const snap = await getDocs(q);
        if (alive) setSquads(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.warn('Active squads query failed (likely composite index missing)', err.message);
      } finally { mark('squads'); }
    })();

    return () => { alive = false; };
  }, []);

  return (
    <div className="space-y-3 px-3">
      {/* Live Now */}
      <Card>
        <Header
          icon="podcasts" color="text-brand-ember" label="Live Now"
          action={liveStreams.length > 0 ? { label: 'More', onClick: () => navigate('/explore?live=1') } : null}
        />
        {!loaded.live ? <SkeletonRows count={2} />
          : liveStreams.length === 0 ? (
            <EmptyHint icon="podcasts" text="No live streams right now." />
          ) : (
            <div className="space-y-2">
              {liveStreams.map(l => (
                <button key={l.id} onClick={() => navigate(`/stream/${l.id}`)}
                  className="w-full flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-white/[0.04] text-left">
                  <div className="relative w-14 h-10 rounded-md bg-gradient-to-br from-brand-violet/50 to-brand-pink/30 shrink-0 overflow-hidden flex items-center justify-center">
                    {(l.coverUrl || l.thumbnailUrl)
                      ? <img src={l.coverUrl || l.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                      : <Icon name="play_arrow" size={16} className="text-white/90" />}
                    <span className="absolute top-0.5 left-0.5 px-1 py-[1px] rounded-sm bg-brand-ember text-[8px] font-dmmono font-bold text-white uppercase tracking-wider">Live</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-text-primary truncate">{l.title || l.hostName || 'Untitled stream'}</div>
                    <div className="text-[10px] text-text-muted font-dmmono truncate">{l.game || 'Stream'}</div>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] font-dmmono text-brand-ember shrink-0">
                    <Icon name="visibility" size={11} />
                    <span className="tabular-nums">{compact(l.viewerCount || 0)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
      </Card>

      {/* Trending hashtags */}
      <Card>
        <Header
          icon="trending_up" color="text-brand-violet-light" label="Trending"
          action={hashtags.length > 0 ? { label: 'See all', onClick: () => navigate('/trending-hashtags') } : null}
        />
        {!loaded.tags ? <SkeletonRows count={4} />
          : hashtags.length === 0 ? (
            <EmptyHint icon="tag" text="No trending tags yet. Use #tags in posts to start trends." />
          ) : (
            <div className="space-y-1">
              {hashtags.map((h, i) => (
                <button key={h.tag}
                  onClick={() => navigate(`/hashtag/${encodeURIComponent(h.tag)}`)}
                  className="w-full flex items-center gap-3 px-1.5 py-1.5 rounded-lg hover:bg-white/[0.04] text-left">
                  <span className="text-[10px] font-dmmono text-text-muted w-4 tabular-nums">{i+1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-text-primary font-semibold truncate">#{h.tag}</div>
                    <div className="text-[10px] text-text-muted font-dmmono">{compact(h.posts)} posts</div>
                  </div>
                  <Icon name="arrow_forward_ios" size={10} className="text-text-muted/50" />
                </button>
              ))}
            </div>
          )}
      </Card>

      {/* Who to follow */}
      <Card>
        <Header
          icon="group_add" color="text-brand-violet" label="Who To Follow"
          action={creators.length > 0 ? { label: 'Browse', onClick: () => navigate('/browse-creators') } : null}
        />
        {!loaded.creators ? <SkeletonRows count={3} />
          : creators.length === 0 ? (
            <EmptyHint icon="group_add" text="No creators to suggest yet." />
          ) : (
            <div className="space-y-2">
              {creators.map(c => (
                <div key={c.id} className="flex items-center gap-2.5">
                  <button onClick={() => navigate(`/user/${c.id}`)} className="shrink-0">
                    {c.avatar
                      ? <UserAvatar src={c.avatar} size={36} showTierRing={false} isVerified={c.verified} />
                      : <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-violet/40 to-brand-pink/20 flex items-center justify-center">
                          <span className="text-[12px] font-dmmono font-bold text-white/90">{c.name?.[0] || '?'}</span>
                        </div>}
                  </button>
                  <button onClick={() => navigate(`/user/${c.id}`)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-1">
                      <span className="text-[12px] font-semibold text-text-primary truncate">{c.name}</span>
                      {c.verified && <Icon name="verified" size={11} className="text-brand-violet-light shrink-0" />}
                    </div>
                    <div className="text-[10px] text-text-muted font-dmmono truncate">
                      {c.handle} · {compact(c.followers)}
                    </div>
                  </button>
                  <button
                    onClick={() => navigate(`/user/${c.id}`)}
                    className="text-[11px] font-bold px-3 py-1 rounded-full bg-gradient-to-r from-brand-violet to-brand-pink text-white hover:brightness-110 shrink-0">
                    Follow
                  </button>
                </div>
              ))}
            </div>
          )}
      </Card>

      {/* Active Squads */}
      <Card>
        <Header
          icon="shield" color="text-brand-violet-light" label="Active Squads"
          action={{ label: 'Find', onClick: () => navigate('/squads') }}
        />
        {!loaded.squads ? <SkeletonRows count={2} />
          : squads.length === 0 ? (
            <EmptyHint
              icon="shield"
              text="No active squads yet."
              cta={{ label: 'Create one', onClick: () => navigate('/squads/create') }}
            />
          ) : (
            <div className="space-y-2">
              {squads.map(s => (
                <button key={s.id} onClick={() => navigate(`/squads/${s.id}`)}
                  className="w-full flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-white/[0.04] text-left">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-violet/40 to-brand-pink/20 flex items-center justify-center shrink-0 overflow-hidden">
                    {s.avatar
                      ? <CachedImg src={s.avatar} permanent alt="" className="w-full h-full object-cover" />
                      : <span className="text-[12px] font-syne font-extrabold text-white/90">{s.name?.[0] || 'S'}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-text-primary truncate">{s.name}</div>
                    <div className="text-[10px] text-text-muted font-dmmono truncate">{s.memberCount || 0} members{s.game ? ` · ${s.game}` : ''}</div>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                </button>
              ))}
            </div>
          )}
      </Card>

      <div className="text-center pt-1 pb-3">
        <p className="text-[10px] text-text-muted font-dmmono leading-relaxed">
          Talk · Team Up · Belong<br/>
          <span className="text-text-muted/70">VERGR © 2026</span>
        </p>
      </div>
    </div>
  );
}

function Card({ children }) {
  return (
    <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-3.5">
      {children}
    </div>
  );
}

function Header({ icon, color, label, action }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Icon name={icon} size={15} className={color} />
        <div className="text-[10px] font-dmmono uppercase tracking-[0.14em] text-text-muted">{label}</div>
      </div>
      {action && (
        <button onClick={action.onClick}
          className="text-[10px] font-dmmono text-brand-violet-light hover:underline">
          {action.label}
        </button>
      )}
    </div>
  );
}

function SkeletonRows({ count = 2 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 p-1.5">
          <div className="w-9 h-9 rounded-full bg-white/[0.04] animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 w-3/4 rounded bg-white/[0.04] animate-pulse" />
            <div className="h-2 w-1/2 rounded bg-white/[0.03] animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyHint({ icon, text, cta }) {
  return (
    <div className="px-1 py-3 text-center">
      <Icon name={icon} size={20} className="text-text-muted/30 mx-auto mb-1.5" />
      <p className="text-[11px] text-text-muted leading-snug">{text}</p>
      {cta && (
        <button onClick={cta.onClick} className="mt-2 text-[11px] font-dmmono font-bold text-brand-violet-light hover:underline">
          {cta.label}
        </button>
      )}
    </div>
  );
}
