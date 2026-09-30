// Public (logged-out) read-only UGC screens — the share-to-grow loop.
//
// A logged-out visitor opening a shared /post, /clip, /user, or /watch link
// used to bounce to /login. Now they see the actual content, read-only, with
// a signup CTA and a one-tap "browse as guest" path (anonymous Firebase auth,
// already a first-class concept in this app — see AuthContext.signInAsGuest
// and GuestRouteGate). Crawlers that execute JS (Googlebot) render these too,
// so the indexed DOM matches the server HTML from the ugcRenderer function.
//
// Design decisions:
//   - Firestore reads here are UNAUTHENTICATED (rules: users/posts/streams/
//     comments are public-read). No guest account is auto-created on page
//     load; guests are only created on an explicit tap (keeps crawler hits
//     from minting junk anonymous accounts).
//   - Self-contained styling (no marketing-chunk imports, no app contexts
//     beyond useAuth) so this stays in the main bundle without dragging the
//     marketing module in, and can render with zero profile state.
//   - Respects visibility ('public' only), moderation (hidden), the Vanguard
//     identity mask, and enumeration hiding (admin/hideFromEnumeration).
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  doc, getDoc, collection, query, where, orderBy, limit, getDocs,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { applyVanguardMask } from '../../utils/vanguard';
import { shouldHideFromEnumeration } from '../../utils/enumerationFilter';
import { getPlaybackUrl } from '../../utils/streamConfig';
import HlsPlayer from '../../components/streams/HlsPlayer';
import useSeo from '../../utils/seo';
import UserName from '../../components/UserName';

const C = {
  bg: '#07080D', surface: '#0F1118', surface2: '#161922',
  border: 'rgba(255,255,255,0.08)', text: '#ECEFFE', text2: '#A8AEC9',
  text3: '#6B7290', cyan: '#B44FFF', violet: '#7B6FFF', ember: '#FF4D6A',
};

// ── Shared chrome ─────────────────────────────────────────────────────
function GuestButton({ style }) {
  const { signInAsGuest } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try { await signInAsGuest(); } catch (e) { console.warn('guest sign-in failed', e); setBusy(false); }
      }}
      style={{
        padding: '10px 18px', borderRadius: 999, cursor: 'pointer',
        background: 'transparent', color: C.text2, fontSize: 14, fontWeight: 600,
        border: `1px solid ${C.border}`, ...style,
      }}
    >
      {busy ? 'Opening…' : 'Browse as guest'}
    </button>
  );
}

function PublicShell({ children }) {
  return (
    <div style={{
      minHeight: '100vh', background: C.bg, color: C.text,
      fontFamily: "'DM Sans', sans-serif",
      backgroundImage: 'radial-gradient(800px 500px at 15% 0%, rgba(123,111,255,0.18), transparent 60%), radial-gradient(700px 500px at 90% 20%, rgba(180, 79, 255,0.10), transparent 60%)',
    }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px', borderBottom: `1px solid ${C.border}`,
        position: 'sticky', top: 0, background: 'rgba(7,8,13,0.85)', backdropFilter: 'blur(10px)', zIndex: 10,
      }}>
        <Link to="/platform" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: C.text }}>
          <img src="/icons/icon-512-v2.png" alt="VERGR" width={30} height={30} style={{ borderRadius: 8 }} />
          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, letterSpacing: '0.14em', fontSize: 16 }}>VERGR</span>
        </Link>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link to="/login" style={{ color: C.text2, fontSize: 14, textDecoration: 'none', padding: '8px 12px' }}>Log in</Link>
          <Link to="/signup" style={{
            color: '#0B0B14', background: C.cyan, fontSize: 14, fontWeight: 700,
            textDecoration: 'none', padding: '9px 18px', borderRadius: 999,
          }}>Sign up free</Link>
        </div>
      </header>
      <main style={{ maxWidth: 660, margin: '0 auto', padding: '24px 16px 80px' }}>
        {children}
      </main>
    </div>
  );
}

function CtaCard({ line }) {
  return (
    <div style={{
      marginTop: 24, padding: '22px 20px', borderRadius: 16, textAlign: 'center',
      background: C.surface, border: `1px solid ${C.border}`,
    }}>
      <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 18, marginBottom: 6 }}>
        {line || 'Join the players earning on VERGR'}
      </div>
      <div style={{ color: C.text2, fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
        {/* ⚠ No tournaments, prize pools, competitions or wagering may appear
            here. Tournaments were retired 2026-08-09 and public/llms.txt states
            outright that Vergr runs no prize competitions or games of chance,
            so this page contradicting that is a compliance problem, not just
            stale copy. This is an INDEXED page. */}
        Go live, post clips, and earn tips from day one. Build a squad, grow an audience, and keep a share of what your content makes. Free to join, 18+.
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Link to="/signup" style={{
          color: '#0B0B14', background: C.cyan, fontSize: 14, fontWeight: 700,
          textDecoration: 'none', padding: '10px 22px', borderRadius: 999,
        }}>Create my free account</Link>
        <GuestButton />
      </div>
      <div style={{ marginTop: 14, fontSize: 12.5 }}>
        <Link to="/platform/creators" style={{ color: C.text3, marginRight: 14 }}>How creators earn</Link>
        <Link to="/platform/about" style={{ color: C.text3 }}>About VERGR</Link>
      </div>
    </div>
  );
}

function NotAvailable({ what }) {
  return (
    <PublicShell>
      <div style={{ textAlign: 'center', padding: '60px 0 10px' }}>
        <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 22, marginBottom: 8 }}>
          This {what} isn't available
        </div>
        <div style={{ color: C.text2, fontSize: 14 }}>
          It may be private, removed, or visible to members only.
        </div>
      </div>
      <CtaCard />
    </PublicShell>
  );
}

const tsMs = (t) => {
  try {
    if (!t) return 0;
    if (typeof t.toDate === 'function') return t.toDate().getTime();
    if (typeof t === 'number') return t;
    if (t.seconds) return t.seconds * 1000;
  } catch {}
  return 0;
};
const fmtDate = (t) => {
  const ms = tsMs(t);
  return ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
};
const compact = (n) => {
  if (!n) return '0';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
};

function AuthorRow({ who, sub }) {
  const inner = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {who.avatar
        ? <img src={who.avatar} alt={who.displayName} width={44} height={44} style={{ borderRadius: '50%', objectFit: 'cover' }} />
        : <div style={{
            width: 44, height: 44, borderRadius: '50%', background: C.surface2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, color: C.violet, fontSize: 18,
          }}>{(who.displayName || 'V')[0].toUpperCase()}</div>}
      <div>
        <div style={{ fontWeight: 700, fontSize: 15 }}><UserName user={who} masked /></div>
        <div style={{ color: C.text3, fontSize: 13 }}>
          {who.username ? `@${who.username}` : ''}{sub ? `${who.username ? ' · ' : ''}${sub}` : ''}
        </div>
      </div>
    </div>
  );
  if (who.username && !who.hideProfileLink) {
    return <Link to={`/u/${who.username}`} style={{ textDecoration: 'none', color: C.text }}>{inner}</Link>;
  }
  return inner;
}

async function loadMaskedUser(uid) {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const u = { uid, ...snap.data() };
    if (shouldHideFromEnumeration(u)) return { hidden: true };
    return applyVanguardMask(u, null);
  } catch { return null; }
}

// ── /post/:postId + /clip/:postId ─────────────────────────────────────
export function PublicPostScreen() {
  const { postId } = useParams();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'posts', postId));
        if (!snap.exists()) return on && setState({ missing: true });
        const post = snap.data();
        if ((post.visibility || 'public') !== 'public' || post.hidden === true) {
          return on && setState({ missing: true });
        }
        const who = await loadMaskedUser(post.authorId || post.userId);
        if (who?.hidden) return on && setState({ missing: true });
        let comments = [];
        try {
          const cq = await getDocs(query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt', 'desc'), limit(8)));
          // A moderator-hidden comment never shows on the public page.
          comments = await Promise.all(cq.docs.filter((d) => d.data().hidden !== true).map(async (d) => {
            const c = d.data();
            const cw = await loadMaskedUser(c.authorId || c.userId);
            return { ...c, who: cw?.hidden ? null : cw };
          }));
        } catch {}
        on && setState({ post, who: who || { displayName: 'A VERGR player' }, comments });
      } catch (e) {
        console.warn('public post load failed', e);
        on && setState({ missing: true });
      }
    })();
    return () => { on = false; };
  }, [postId]);

  const { post, who, comments, loading, missing } = state;
  const text = (post?.content || '').trim();
  useSeo(post ? {
    title: text ? `${who?.displayName}: ${text.slice(0, 70)} | VERGR` : `${who?.displayName || 'A player'} on VERGR`,
    description: text.slice(0, 200) || `A ${post?.type || 'post'} on VERGR.`,
    canonical: `https://vergr.app/${post?.type === 'clip' || post?.type === 'short' ? 'clip' : 'post'}/${postId}`,
  } : {});

  if (loading) return <PublicShell><div style={{ color: C.text3, padding: 60, textAlign: 'center' }}>Loading…</div></PublicShell>;
  if (missing) return <NotAvailable what="post" />;

  const media = Array.isArray(post.mediaUrls) ? post.mediaUrls : (post.mediaUrl ? [post.mediaUrl] : []);
  const isVideo = post.type === 'clip' || post.type === 'short' || !!post.videoUrl;
  const videoSrc = post.videoUrl || (isVideo ? media[0] : null);

  return (
    <PublicShell>
      <article style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 18 }}>
        <AuthorRow who={who} sub={fmtDate(post.createdAt)} />
        {text ? <p style={{ fontSize: 15.5, lineHeight: 1.65, margin: '14px 0 0', whiteSpace: 'pre-wrap' }}>{text}</p> : null}
        {videoSrc ? (
          <video
            src={videoSrc} poster={post.thumbnailUrl || undefined} controls playsInline
            style={{ width: '100%', borderRadius: 12, marginTop: 14, background: '#000' }}
          />
        ) : media.length ? (
          <div style={{
            display: 'grid', gap: 6, marginTop: 14,
            gridTemplateColumns: media.length > 1 ? '1fr 1fr' : '1fr',
          }}>
            {media.slice(0, 4).map((m, i) => (
              <img key={i} src={m} alt="" style={{ width: '100%', borderRadius: 12, objectFit: 'cover' }} />
            ))}
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 18, marginTop: 16, color: C.text3, fontSize: 13.5 }}>
          <span>♥ {compact(post.likeCount)}</span>
          <span>💬 {compact(post.commentCount)}</span>
          {post.viewCount ? <span>{compact(post.viewCount)} views</span> : null}
        </div>
      </article>

      {comments?.length ? (
        <section style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.text2, margin: '0 0 10px 4px' }}>Comments</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {comments.filter((c) => c.who).map((c, i) => (
              <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ fontSize: 13, color: C.text3, marginBottom: 4 }}>
                  <strong style={{ color: C.text2 }}><UserName user={c.who} masked /></strong> · {fmtDate(c.createdAt)}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.55 }}>{(c.content || c.text || '').slice(0, 400)}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <CtaCard line={`Want to reply to ${who.displayName}?`} />
    </PublicShell>
  );
}

// ── /user/:id ─────────────────────────────────────────────────────────
export function PublicUserScreen() {
  const { id } = useParams();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', id));
        if (!snap.exists()) return on && setState({ missing: true });
        const raw = { uid: id, ...snap.data() };
        if (shouldHideFromEnumeration(raw)) return on && setState({ missing: true });
        const who = applyVanguardMask(raw, null);
        let posts = [];
        if (!who.isVanguardPersona) {
          try {
            const pq = await getDocs(query(
              collection(db, 'posts'), where('authorId', '==', id),
              orderBy('createdAt', 'desc'), limit(12),
            ));
            posts = pq.docs.map((d) => ({ id: d.id, ...d.data() }))
              .filter((p) => (p.visibility || 'public') === 'public' && p.hidden !== true);
          } catch {
            try {
              const pq2 = await getDocs(query(collection(db, 'posts'), where('authorId', '==', id), limit(12)));
              posts = pq2.docs.map((d) => ({ id: d.id, ...d.data() }))
                .filter((p) => (p.visibility || 'public') === 'public' && p.hidden !== true)
                .sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
            } catch {}
          }
        }
        on && setState({ who, raw: who.isVanguardPersona ? null : raw, posts });
      } catch (e) {
        console.warn('public profile load failed', e);
        on && setState({ missing: true });
      }
    })();
    return () => { on = false; };
  }, [id]);

  const { who, raw, posts, loading, missing } = state;
  useSeo(who ? {
    title: who.username ? `${who.displayName} (@${who.username}) on VERGR` : `${who.displayName} on VERGR`,
    description: (raw?.bio || `${who.displayName} creates, streams, and earns on VERGR.`).slice(0, 200),
    canonical: `https://vergr.app/user/${id}`,
  } : {});

  if (loading) return <PublicShell><div style={{ color: C.text3, padding: 60, textAlign: 'center' }}>Loading…</div></PublicShell>;
  if (missing) return <NotAvailable what="profile" />;

  return (
    <PublicShell>
      <section style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
        {raw?.banner ? <img src={raw.banner} alt="" style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }} /> : (
          <div style={{ height: 90, background: `linear-gradient(120deg, ${C.violet}33, ${C.cyan}22)` }} />
        )}
        <div style={{ padding: '0 18px 18px' }}>
          <div style={{ marginTop: -34 }}>
            {who.avatar
              ? <img src={who.avatar} alt={who.displayName} width={68} height={68} style={{ borderRadius: '50%', objectFit: 'cover', border: `3px solid ${C.bg}` }} />
              : <div style={{
                  width: 68, height: 68, borderRadius: '50%', background: C.surface2,
                  border: `3px solid ${C.bg}`, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontWeight: 800, color: C.violet, fontSize: 26,
                }}>{(who.displayName || 'V')[0].toUpperCase()}</div>}
          </div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 20, marginTop: 10 }}><UserName user={who} masked /></div>
          {who.username ? <div style={{ color: C.text3, fontSize: 14 }}><UserName user={who} masked handle /></div> : null}
          {raw?.bio ? <p style={{ color: C.text2, fontSize: 14.5, lineHeight: 1.6, margin: '10px 0 0' }}>{raw.bio}</p> : null}
          <div style={{ display: 'flex', gap: 18, marginTop: 12, fontSize: 13.5, color: C.text3 }}>
            <span><strong style={{ color: C.text }}>{compact(raw?.followerCount)}</strong> followers</span>
            <span><strong style={{ color: C.text }}>{compact(raw?.followingCount)}</strong> following</span>
            {posts?.length ? <span><strong style={{ color: C.text }}>{posts.length}</strong> recent posts</span> : null}
          </div>
          <div style={{ marginTop: 14 }}>
            <Link to="/signup" style={{
              color: '#0B0B14', background: C.cyan, fontSize: 13.5, fontWeight: 700,
              textDecoration: 'none', padding: '9px 20px', borderRadius: 999, display: 'inline-block',
            }}>Follow <UserName user={who} masked /></Link>
          </div>
        </div>
      </section>

      {posts?.length ? (
        <section style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.text2, margin: '0 0 10px 4px' }}>Recent posts</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {posts.slice(0, 8).map((p) => {
              const media = Array.isArray(p.mediaUrls) ? p.mediaUrls : [];
              const isVid = p.type === 'clip' || p.type === 'short';
              return (
                <Link key={p.id} to={`/${isVid ? 'clip' : 'post'}/${p.id}`} style={{
                  display: 'flex', gap: 12, alignItems: 'center', textDecoration: 'none',
                  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px',
                }}>
                  {(p.thumbnailUrl || media[0]) ? (
                    <img src={p.thumbnailUrl || media[0]} alt="" width={56} height={56} style={{ borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                  ) : null}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: C.text, fontSize: 14, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {(p.content || '').trim() || `${p.type || 'post'} by ${who.displayName}`}
                    </div>
                    <div style={{ color: C.text3, fontSize: 12.5, marginTop: 4 }}>
                      ♥ {compact(p.likeCount)} · 💬 {compact(p.commentCount)} · {fmtDate(p.createdAt)}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      <CtaCard line={`Follow ${who.displayName} and thousands of other players`} />
    </PublicShell>
  );
}

// ── /watch/:streamId ──────────────────────────────────────────────────
export function PublicWatchScreen() {
  const { streamId } = useParams();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'streams', streamId));
        if (!snap.exists()) return on && setState({ missing: true });
        const stream = snap.data();
        const who = await loadMaskedUser(stream.hostUid);
        if (who?.hidden) return on && setState({ missing: true });
        on && setState({ stream, who: who || { displayName: stream.hostUsername || 'A creator' } });
      } catch (e) {
        console.warn('public stream load failed', e);
        on && setState({ missing: true });
      }
    })();
    return () => { on = false; };
  }, [streamId]);

  const { stream, who, loading, missing } = state;
  useSeo(stream ? {
    title: `${stream.status === 'live' ? 'LIVE: ' : ''}${who?.displayName}${stream.title ? ` — ${stream.title}` : ''} | VERGR`,
    description: `${stream.status === 'live' ? 'Live now' : 'Stream'} on VERGR${stream.game ? `: ${stream.game}` : ''}. Watch free, tip the streamer.`,
    canonical: `https://vergr.app/watch/${streamId}`,
  } : {});

  if (loading) return <PublicShell><div style={{ color: C.text3, padding: 60, textAlign: 'center' }}>Loading…</div></PublicShell>;
  if (missing) return <NotAvailable what="stream" />;

  const live = stream.status === 'live';
  // This page is the signed-OUT view, so there is nobody to check a follow or a
  // ticket against. A restricted stream's replay stays behind the app's gates.
  const vodRestricted = !!stream.unlisted || stream.audience === 'ticketed';
  const vod = vodRestricted ? null : (stream.archiveVodUrl || stream.vodUrl || null);
  const hls = stream.source === 'twitch' ? null : (stream.compositeHlsUrl || stream.hlsUrl || null);
  const cover = stream.coverUrl || stream.thumbnailUrl || null;

  return (
    <PublicShell>
      <section style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
        {live && hls ? (
          <HlsPlayer src={hls} autoPlay muted controls disableP2P style={{ width: '100%', aspectRatio: '16/9', background: '#000', display: 'block' }} />
        ) : !live && vod ? (
          <video src={vod} poster={cover || undefined} controls playsInline style={{ width: '100%', aspectRatio: '16/9', background: '#000', display: 'block' }} />
        ) : (
          <div style={{
            width: '100%', aspectRatio: '16/9', background: cover ? `url(${cover}) center/cover` : C.surface2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              background: 'rgba(7,8,13,0.75)', padding: '12px 20px', borderRadius: 12,
              color: C.text2, fontSize: 14,
            }}>
              {live ? 'Sign up free to watch this stream' : 'This stream has ended'}
            </div>
          </div>
        )}
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {live ? (
              <span style={{
                background: C.ember, color: '#fff', fontSize: 11, fontWeight: 800,
                letterSpacing: '0.1em', padding: '3px 9px', borderRadius: 6,
              }}>LIVE</span>
            ) : null}
            <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 17 }}>
              {stream.title || `${who.displayName} is streaming`}
            </span>
          </div>
          <div style={{ marginTop: 10 }}>
            <AuthorRow who={who} sub={stream.game || null} />
          </div>
          {live && typeof stream.viewerCount === 'number' ? (
            <div style={{ color: C.text3, fontSize: 13, marginTop: 8 }}>{compact(stream.viewerCount)} watching now</div>
          ) : null}
        </div>
      </section>
      <CtaCard line={live ? 'Sign up to chat and tip the streamer' : `Follow ${who.displayName} for the next stream`} />
    </PublicShell>
  );
}
