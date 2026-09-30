// Right rail for Home / Feed.
// Cards: Live Now · Trending · Who To Follow · Upcoming Cups · Active Squads
// Every section reads from Firestore. Empty sections render a short
// "nothing here yet" message instead of dummy content.
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { readFeedCache } from '../../utils/feedCache';
import { isShortFormat, compactCount } from '../../utils/helpers';
import { Cover, captionOf } from '../profile/ProfileGrid';
import { isDiscoverableStream, streamPremium } from '../../utils/streamVisibility';
import CachedImg from '../CachedImg';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { mergeBoostedFirst } from '../../utils/promoBoost';
import { boostSlotsFor } from '../../utils/boostDelivery';
import { getBoostedUsers } from '../../firebase/firestore';
import { rankStreams, hasFeedRail } from '../../utils/streamBoost';
import { inferStreamTopics } from '../../utils/feedRank';
import { getTopicWeights } from '../../utils/feedPrefs';
import Icon from '../Icon';
import UserAvatar from '../UserAvatar';

function compact(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

// `posts` are the feed posts already on screen (HomeFeedScreen passes them), so
// the Clips card and the Trending fallback cost no read.
export default function HomeFeedRail({ posts = [] }) {
  // Needed so a boosted profile is never suggested to itself.
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [liveStreams, setLiveStreams] = useState([]);
  const [hashtags, setHashtags] = useState([]);
  const [creators, setCreators] = useState([]);
  const [squads, setSquads] = useState([]);
  const [loaded, setLoaded] = useState({ live: false, tags: false, creators: false, squads: false });

  // Clips, from posts already loaded: the feed page, plus the Clips feed if this
  // device has opened it. ⚠ NO QUERY. A clips read on every desktop home load is
  // exactly the kind of read the founder asked not to add. Founder, 2026-09-14:
  // "No clips are shown on the home page side bar ... which makes me think that
  // it isnt working" — the rail had no clips card at all.
  const clips = useMemo(() => {
    const pool = new Map();
    const take = (p) => {
      if (p?.id && isShortFormat(p.type) && (p.thumbnailUrl || p.mediaUrls?.length || p.mediaUrl)) pool.set(p.id, p);
    };
    posts.forEach(take);
    (readFeedCache('shorts') || []).forEach(take);
    const score = (p) => (p.likeCount || 0) + (p.commentCount || 0) * 3;
    const ranked = [...pool.values()].sort((a, b) => score(b) - score(a)).slice(0, 6);
    // Whole rows only. Five tiles in a three-column grid left a hole in the
    // second row (measured 2026-09-14), which reads as a missing clip.
    return ranked.length >= 3 ? ranked.slice(0, ranked.length - (ranked.length % 3)) : ranked;
  }, [posts]);

  // Tags in the posts already on screen. Shown only when the server's trending
  // list is empty: that job counts the last 24 hours, so a quiet day leaves it
  // blank and the card would say "no trending tags" above posts full of them.
  const feedTags = useMemo(() => {
    const counts = new Map();
    for (const p of posts) {
      for (const raw of (Array.isArray(p?.hashtags) ? p.hashtags : [])) {
        const tag = String(raw || '').replace(/^#/, '').trim();
        if (!tag) continue;
        const row = counts.get(tag) || { tag, posts: 0, score: 0 };
        row.posts += 1;
        row.score += 10 + (p.likeCount || 0) + (p.commentCount || 0) * 3;
        counts.set(tag, row);
      }
    }
    return [...counts.values()].sort((a, b) => b.score - a.score).slice(0, 6);
  }, [posts]);
  const shownTags = hashtags.length ? hashtags : feedTags;

  useEffect(() => {
    let alive = true;
    const mark = (k) => alive && setLoaded(s => ({ ...s, [k]: true }));

    // Live streams currently airing.
    (async () => {
      try {
        // ⚠ THIS RAIL IS WHAT MEGA BOOST BUYS. Three slots, previously handed
        // to the three biggest audiences — so the top tier advertised "a slot in
        // the live rail on the home feed" and could not deliver one. The second
        // query fetches boosted streams regardless of viewer count; hasFeedRail
        // decides which of them have actually paid for this surface.
        const [snap, boostSnap] = await Promise.all([
          getDocs(query(
            collection(db, 'streams'),
            where('status', '==', 'live'),
            orderBy('viewerCount', 'desc'),
            limit(3),
          )),
          getDocs(query(
            collection(db, 'streams'),
            where('boostExpiresAt', '>', Date.now()),
            limit(8),
          )).catch(() => ({ docs: [] })),
        ]);
        const seen = new Map();
        for (const d of [...snap.docs, ...boostSnap.docs]) {
          const data = { id: d.id, ...d.data() };
          if (data.status === 'live') seen.set(d.id, data);
        }
        const all = [...seen.values()].filter(isDiscoverableStream);
        // A mega-boosted stream takes a slot first; the rest of the rail is
        // filled by the normal ranking, so the rail is never left short.
        const railed = all.filter((s) => hasFeedRail(s));
        const rest = rankStreams(all.filter((s) => !hasFeedRail(s)), {
          topicAffinity: getTopicWeights(),
          topicsOf: inferStreamTopics,
        });
        if (alive) setLiveStreams([...railed, ...rest].slice(0, 3));
      } catch (err) {
        console.warn('Live streams query failed (likely composite index missing)', err.message);
      } finally { mark('live'); }
    })();

    // Trending hashtags. ⚠ ONE DOC, NOT A QUERY, AND THE QUERY WAS WHY TRENDING
    // WAS ALWAYS EMPTY. It asked `hashtags` for orderBy('postCount'), a field the
    // server never writes (_updateTrending in functions/index.js writes
    // postCount24h and trendScore), and Firestore leaves out every doc that lacks
    // the field being ordered on. The same job writes its ranked list to
    // trending/hashtags, which the composer already reads: one read, not six.
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'trending', 'hashtags'));
        const tags = snap.exists() ? (snap.data().tags || []) : [];
        if (alive) {
          setHashtags(tags.slice(0, 6)
            .map((t) => (typeof t === 'string' ? { tag: t, posts: 0 } : { tag: t?.tag, posts: t?.count || 0 }))
            .filter((t) => t.tag));
        }
      } catch {}
      finally { mark('tags'); }
    })();

    // Who to follow — verified creators sorted by follower count.
    (async () => {
      try {
        // ⚠ ONE shared query for every suggestion surface (getBoostedUsers):
        // fair bucket rotation, interest ranking, and the viewer excluded from
        // their own suggestions. Never hand-roll a boost query here again —
        // doing that is how four of six surfaces silently ignored a paid boost.
        // boostSlotsFor(4) = 1: a rail that is mostly paid is not a recommendation.
        let boostedUsers = [];
        try {
          boostedUsers = await getBoostedUsers({
            viewerUid: currentUser?.uid, want: boostSlotsFor(4),
          });
        } catch { /* a boost must never empty the rail */ }

        const q = query(collection(db, 'users'), where('isVerified', '==', true), orderBy('followerCount', 'desc'), limit(4));
        const snap = await getDocs(q);
        // Boosted first, then verified-by-followers, deduped and capped at the
        // 4 slots this rail has always shown.
        const shaped = (d) => ({
          id: d.id,
          name: d.displayName || d.username,
          handle: '@' + (d.username || ''),
          followers: d.followerCount || 0,
          avatar: d.avatar,
          verified: d.isVerified,
        });
        const organic = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (alive) setCreators(mergeBoostedFirst(boostedUsers, organic, 4).map(shaped));
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
                    {/* A paid stream is discoverable on purpose, so the tile has
                        to say so before the tap, not after it. */}
                    {streamPremium(l).isPremium ? (
                      <span
                        className="absolute top-0.5 left-0.5 px-1 py-[1px] rounded-sm text-[8px] font-dmmono font-bold text-white uppercase tracking-wider"
                        style={{ background: 'linear-gradient(135deg, #C87FFF 0%, #7B1FFF 100%)' }}
                      >
                        Premium
                      </span>
                    ) : (
                      <span className="absolute top-0.5 left-0.5 px-1 py-[1px] rounded-sm bg-brand-ember text-[8px] font-dmmono font-bold text-white uppercase tracking-wider">Live</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-text-primary truncate">{l.title || l.hostName || 'Untitled stream'}</div>
                    <div className="text-[10px] text-text-muted font-dmmono truncate flex items-center gap-1">
                      {streamPremium(l).isPremium && streamPremium(l).priceCoins > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-brand-gold-light">
                          <Icon name="paid" size={10} />
                          <span className="tabular-nums">{streamPremium(l).priceCoins.toLocaleString()}</span>
                          <span className="text-text-muted">·</span>
                        </span>
                      )}
                      {l.game || 'Stream'}
                    </div>
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

      {/* Clips */}
      <Card>
        <Header
          icon="slow_motion_video" color="text-brand-ember" label="Clips"
          action={clips.length > 0 ? { label: 'See all', onClick: () => navigate('/shorts') } : null}
        />
        {clips.length === 0 ? (
          <EmptyHint icon="slow_motion_video" text="No clips yet." cta={{ label: 'Post a clip', onClick: () => navigate('/create/clip') }} />
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {clips.map((c) => (
              <button key={c.id} onClick={() => navigate(`/clip/${c.id}`)} aria-label={`Open clip: ${captionOf(c)}`}
                className="relative aspect-[9/16] rounded-md overflow-hidden active:opacity-80" style={{ background: '#15151F' }}>
                <Cover post={c} />
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none"
                  style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.7) 100%)' }} />
                <span className="absolute left-1.5 bottom-1 flex items-center gap-0.5 text-white text-[10px] font-bold tabular-nums"
                  style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>
                  <Icon name="favorite" size={11} filled /> {compactCount(c.likeCount)}
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Trending hashtags */}
      <Card>
        <Header
          icon="trending_up" color="text-brand-violet-light" label="Trending"
          action={shownTags.length > 0 ? { label: 'See all', onClick: () => navigate('/trending-hashtags') } : null}
        />
        {!loaded.tags && !feedTags.length ? <SkeletonRows count={4} />
          : shownTags.length === 0 ? (
            <EmptyHint icon="tag" text="No trending tags yet. Use #tags in posts to start trends." />
          ) : (
            <div className="space-y-1">
              {shownTags.map((h, i) => (
                <button key={h.tag}
                  onClick={() => navigate(`/hashtag/${encodeURIComponent(h.tag)}`)}
                  className="w-full flex items-center gap-3 px-1.5 py-1.5 rounded-lg hover:bg-[#1C1C29] text-left">
                  <span className="text-[10px] font-dmmono text-text-muted w-4 tabular-nums">{i+1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-text-primary font-semibold truncate">#{h.tag}</div>
                    {h.posts > 0 && (
                      <div className="text-[10px] text-text-muted font-dmmono">{compact(h.posts)} {h.posts === 1 ? 'post' : 'posts'}</div>
                    )}
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
                      {/* ⚠ HANDLE ONLY. A follower count belongs on the public
                          profile, not on a suggestion card. Founder, 2026-08-28: it is
                          not appropriate here, number nor label. A bare count next to
                          a handle also reads as an unlabelled mystery number, and on a
                          small platform it mostly advertises that nobody has followers
                          yet. Do not put a metric back on this card. */}
                      {c.handle}
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
    // Solid, no hairline: a see-through card with a stroke is the look the
    // founder has ruled out.
    <div className="rounded-2xl p-3.5" style={{ background: '#15151F' }}>
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
