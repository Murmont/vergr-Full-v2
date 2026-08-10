// ugcRenderer — server-rendered HTML for public user content.
//
// The viral-engine enabler (SEO_PLAN.md section 3/8): Bing + AI crawlers
// (GPTBot, ClaudeBot, PerplexityBot, Bingbot) do not run JavaScript, so a
// bare SPA shell at /post/:id reads as an empty page. Firebase Hosting
// rewrites /post/**, /clip/**, /user/**, /u/**, /watch/** to this function,
// which fetches the live SPA shell (so hashed asset URLs stay current),
// swaps in per-item title/description/OG/canonical/JSON-LD, injects the
// item's text content into #root, and serves it to EVERYONE with CDN cache
// headers. Humans still get the full SPA (it boots over the injected HTML;
// logged-out visitors are auto-signed-in as guests client-side).
//
// Index policy (thin-content guardrail, SEO_PLAN.md 3a): every public item
// RENDERS, but only items clearing a quality bar emit `index,follow`;
// everything else gets `noindex,follow`. Private/hidden items render the
// plain shell with noindex and no content.
//
// Privacy rules: public-visibility items only; Vanguard members are served
// masked (persona name, no real avatar, noindex); admin/hideFromEnumeration
// accounts render the plain shell; guests + bot accounts are noindexed.
// Syndicated posts (isNewsPost/sourceUrl/bot author) index ONLY via their
// original Gemini rewrite (seoHeadline/seoText, see newsSeoRewrite.js);
// verbatim publisher text is never served as indexable (GSC duplicate bug).
// Never expose emails, wallets, KYC, or any non-public field.
//
// Also serves /sitemap-ugc.xml (newest public posts/clips + established
// profiles), referenced from robots.txt.
const { onRequest } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');
const { RANK_BY_ID } = require('./vanguardRanks');
// One shared post-URL rule for the renderer, the sitemap and IndexNow — see
// seoUrls.js for why three copies of it caused a live duplicate-content bug.
const { canonicalPostPath, canonicalUserUrl } = require('./seoUrls');

const db = getFirestore('vgrdb');
const SITE = 'https://vergr.app';
const FALLBACK_IMAGE = `${SITE}/og/share-poster.jpg`;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ── SPA shell cache (per warm instance, 10 min TTL) ───────────────────
let shellCache = { html: null, at: 0 };
const MINIMAL_SHELL = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />'
  + '<title>VERGR</title><meta name="description" content="" /></head>'
  + '<body><div id="root"></div></body></html>';

async function getShell() {
  const now = Date.now();
  if (shellCache.html && now - shellCache.at < 10 * 60 * 1000) return shellCache.html;
  try {
    const r = await fetch(`${SITE}/`, { headers: { 'User-Agent': 'vergr-ugc-renderer' } });
    if (r.ok) {
      const html = await r.text();
      if (html.includes('<div id="root">')) {
        shellCache = { html, at: now };
        return html;
      }
    }
  } catch (e) {
    console.warn('ugcRenderer: shell fetch failed', e.message);
  }
  return shellCache.html || MINIMAL_SHELL;
}

// ── Head rewrite (same approach as scripts/prerenderHelp.mjs) ─────────
function applyHead(shell, { title, description, canonical, image, index, jsonld, ogType }) {
  let h = shell;
  const t = esc(title);
  const d = esc(description);
  h = h.replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`);
  h = h.replace(/(<meta name="description" content=")[\s\S]*?("\s*\/>)/, `$1${d}$2`);
  h = h.replace(/(<meta property="og:title" content=")[\s\S]*?("\s*\/>)/, `$1${t}$2`);
  h = h.replace(/(<meta property="og:description" content=")[\s\S]*?("\s*\/>)/, `$1${d}$2`);
  h = h.replace(/(<meta property="og:url" content=")[\s\S]*?("\s*\/>)/, `$1${esc(canonical)}$2`);
  h = h.replace(/(<meta property="og:image" content=")[\s\S]*?("\s*\/>)/, `$1${esc(image || FALLBACK_IMAGE)}$2`);
  h = h.replace(/(<meta property="og:type" content=")[\s\S]*?("\s*\/>)/, `$1${esc(ogType || 'article')}$2`);
  h = h.replace(/(<meta name="twitter:title" content=")[\s\S]*?("\s*\/>)/, `$1${t}$2`);
  h = h.replace(/(<meta name="twitter:description" content=")[\s\S]*?("\s*\/>)/, `$1${d}$2`);
  h = h.replace(/(<meta name="twitter:image" content=")[\s\S]*?("\s*\/>)/, `$1${esc(image || FALLBACK_IMAGE)}$2`);
  h = h.replace(/\s*<link rel="canonical"[^>]*\/>/g, '');
  h = h.replace(/\s*<meta name="robots"[^>]*\/>/g, '');
  const inject = `<link rel="canonical" href="${esc(canonical)}" />\n`
    + `<meta name="robots" content="${index ? 'index,follow' : 'noindex,follow'}" />\n`
    + (jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>\n` : '');
  h = h.replace('</head>', inject + '</head>');
  return h;
}

// #root has NOT been empty since the static boot splash shipped inside it
// (2026-07-05), so the old `<div id="root"></div>` literal matched nothing and
// String.replace silently returned the shell UNCHANGED — every /post, /clip,
// /user, /u and /watch page was served with a perfect <head> (title, canonical,
// index,follow, JSON-LD) wrapped around a body containing only the loading
// splash. Crawlers that don't run JS saw an indexable page with no content,
// which is the textbook "thin content" signal.
//
// prerenderHelp.mjs hit the identical bug and was fixed 2026-07-15; this is a
// SEPARATE copy of the same helper that was missed. Keep them in sync.
//
// Fails LOUD but degrades safely: a live renderer must not 500 over this, so
// an absent marker logs and still appends the content rather than dropping it.
const injectBody = (shell, bodyHtml) => {
  if (shell.includes('<div id="root">')) {
    return shell.replace('<div id="root">', `<div id="root">${bodyHtml}`);
  }
  console.error('ugcRenderer: <div id="root"> not found in shell — appending body instead');
  return shell.includes('</body>')
    ? shell.replace('</body>', `<div id="root">${bodyHtml}</div></body>`)
    : shell + bodyHtml;
};

const graph = (items) => ({ '@context': 'https://schema.org', '@graph': items });

const tsIso = (t) => {
  try {
    if (!t) return null;
    if (typeof t.toDate === 'function') return t.toDate().toISOString();
    if (typeof t === 'number') return new Date(t).toISOString();
    if (t.seconds) return new Date(t.seconds * 1000).toISOString();
  } catch {}
  return null;
};

// ── Author identity (Vanguard mask + privacy) ─────────────────────────
function isVanguardActive(u) {
  return !!(u && u.vanguard && u.vanguard.rank
    && u.vanguard.status !== 'retired' && u.vanguard.status !== 'suspended');
}
function publicIdentity(u) {
  if (!u) return { name: 'A VERGR player', username: null, avatar: null, masked: false, hidden: false };
  if (u.role === 'admin' || u.hideFromEnumeration === true) {
    return { name: 'VERGR', username: null, avatar: null, masked: false, hidden: true };
  }
  if (isVanguardActive(u)) {
    const meta = RANK_BY_ID[u.vanguard.rank] || {};
    return { name: meta.usernameTag || 'Vanguard', username: null, avatar: null, masked: true, hidden: false };
  }
  return {
    name: u.displayName || u.username || 'A VERGR player',
    username: u.username || null,
    avatar: u.avatar || u.photoURL || null,
    masked: false,
    hidden: false,
  };
}

const SIGNUP_CTA = `<p><a href="/signup">Join VERGR free</a> to like, comment, follow, compete in tournaments, and earn from your gameplay. <a href="/platform/make-money-gaming">How players earn on VERGR</a> · <a href="/platform/legit">Is VERGR legit?</a></p>`;

// ── Renderers per kind ────────────────────────────────────────────────
async function renderPost(id, route) {
  // Resolve by doc id first (regular posts + every legacy /post/<id> link),
  // then fall back to the SEO `slug` field (news/article pretty URLs).
  let snap = await db.collection('posts').doc(id).get();
  if (!snap.exists) {
    const q = await db.collection('posts').where('slug', '==', id).limit(1).get();
    if (!q.empty) snap = q.docs[0];
  }
  if (!snap.exists) return null;
  const post = snap.data();
  const isPublic = (post.visibility || 'public') === 'public' && post.hidden !== true;
  if (!isPublic) return { private: true };

  const authorId = post.authorId || post.userId;
  let author = null;
  if (authorId) {
    try { author = (await db.collection('users').doc(authorId).get()).data(); } catch {}
  }
  const who = publicIdentity(author);
  if (who.hidden) return { private: true };

  const isSyndicated = post.isNewsPost === true || !!post.sourceUrl
    || (typeof (author && author.accountType) === 'string' && author.accountType.includes('_bot'));
  // Syndicated posts carry publisher text (previewText) that Google refuses
  // as a duplicate of the original article ("Duplicate, Google chose
  // different canonical" — 1,449 pages, GSC 2026-07-16). newsSeoRewrite.js
  // gives each one an ORIGINAL Gemini write-up (seoHeadline/seoText); the
  // page serves THAT to search (index,follow + citation link). Until a
  // post's rewrite lands it stays noindex — a verbatim copy can never index
  // regardless of meta, so nothing is lost while the queue drains.
  const seoText = isSyndicated ? (post.seoText || '').trim() : '';
  const seoHeadline = isSyndicated ? (post.seoHeadline || '').trim() : '';
  const text = seoText || (post.content || post.previewText || '').trim();
  const media = Array.isArray(post.mediaUrls) ? post.mediaUrls : (post.mediaUrl ? [post.mediaUrl] : []);
  const isVideo = post.type === 'clip' || post.type === 'short' || !!post.videoUrl;
  const image = post.thumbnailUrl || (!isVideo && media[0]) || FALLBACK_IMAGE;
  const created = tsIso(post.createdAt);

  const title = seoText
    ? `${seoHeadline || (post.content || '').trim().slice(0, 90)} | VERGR`
    : text
      ? `${who.name}: ${text.slice(0, 70)}${text.length > 70 ? '…' : ''} | VERGR`
      : `${who.name} on VERGR`;
  const description = (text || `A ${post.type || 'post'} by ${who.name} on VERGR, the competitive gaming platform.`).slice(0, 200);

  // Thin-content quality bar: meaningful text or media required to index.
  // Syndicated posts index only once they have their original rewrite.
  const index = isSyndicated ? seoText.length >= 400 : (text.length >= 30 || media.length > 0);
  const canonical = `${SITE}${canonicalPostPath(snap.id, post)}`;

  const schema = [{
    '@type': isVideo ? 'VideoObject' : 'SocialMediaPosting',
    ...(isVideo ? {
      name: title,
      description,
      thumbnailUrl: post.thumbnailUrl || image,
      ...(media[0] ? { contentUrl: media[0] } : {}),
      ...(created ? { uploadDate: created } : {}),
    } : {
      headline: (seoHeadline || text.slice(0, 110)) || title,
      text: text.slice(0, 500),
      ...(created ? { datePublished: created } : {}),
      ...(media[0] ? { image: media[0] } : {}),
      ...(seoText && post.sourceUrl ? { isBasedOn: post.sourceUrl } : {}),
    }),
    // Canonical, not the requested route: JSON-LD that disagrees with the
    // canonical tag is a second duplicate signal.
    url: canonical,
    author: { '@type': 'Person', name: who.name, ...(who.username ? { url: `${SITE}/u/${who.username}` } : {}) },
    ...(typeof post.likeCount === 'number' ? {
      interactionStatistic: [{
        '@type': 'InteractionCounter',
        interactionType: { '@type': 'LikeAction' },
        userInteractionCount: post.likeCount,
      }],
    } : {}),
  }];

  const textHtml = text
    ? text.split(/\n{2,}|\n/).map(s => s.trim()).filter(Boolean)
        .map(p => `<p>${esc(p)}</p>`).join('')
    : '';
  const citation = seoText && post.sourceUrl
    ? `<p>Originally reported by <a href="${esc(post.sourceUrl)}" rel="noopener">${esc((() => { try { return new URL(post.sourceUrl).hostname.replace(/^www\./, ''); } catch { return 'the source'; } })())}</a>.</p>`
    : '';
  const body = `<main><article>`
    + `<h1>${esc(title.replace(' | VERGR', ''))}</h1>`
    + (created ? `<p><time datetime="${esc(created)}">${esc(created.slice(0, 10))}</time></p>` : '')
    + textHtml
    + citation
    + (media[0] && !isVideo ? `<p><img src="${esc(media[0])}" alt="${esc(`Post media by ${who.name}`)}" /></p>` : '')
    + (who.username ? `<p>By <a href="/u/${esc(who.username)}">@${esc(who.username)}</a></p>` : `<p>By ${esc(who.name)}</p>`)
    + SIGNUP_CTA
    + `</article></main>`;

  return {
    title, description, image, index,
    // Always the post's ONE canonical URL, never the requested one — this page
    // answers on up to four routes (see canonicalPostPath).
    canonical,
    ogType: isVideo ? 'video.other' : 'article',
    jsonld: graph(schema),
    body,
  };
}

async function renderUser(uid, route) {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return null;
  const u = snap.data();
  const who = publicIdentity(u);
  if (who.hidden) return { private: true };
  const isGuest = u.isGuest === true;
  const isBot = typeof u.accountType === 'string' && u.accountType.includes('_bot');

  const bio = (u.bio || '').trim();
  const followers = u.followerCount || 0;

  // Latest public posts (also the "has at least one public item" signal).
  // Vanguard-masked profiles never list real posts (identity protection).
  let posts = [];
  if (!who.masked) {
    try {
      const q = await db.collection('posts')
        .where('authorId', '==', uid)
        .orderBy('createdAt', 'desc').limit(8).get();
      posts = q.docs.map((d) => d.data())
        .filter((p) => (p.visibility || 'public') === 'public' && p.hidden !== true);
    } catch (e) {
      try {
        const q2 = await db.collection('posts').where('authorId', '==', uid).limit(8).get();
        posts = q2.docs.map((d) => d.data())
          .filter((p) => (p.visibility || 'public') === 'public' && p.hidden !== true);
      } catch {}
    }
  }

  const title = who.username
    ? `${who.name} (@${who.username}) on VERGR`
    : `${who.name} on VERGR`;
  const description = bio
    ? `${who.name} on VERGR: ${bio}`.slice(0, 200)
    : `${who.name} competes, streams, and earns on VERGR, the skill-based gaming platform.`;

  // Bot profiles are deliberately NOT indexed (bot POSTS are — they carry the
  // original rewrite; the bot's profile page carries nothing original).
  const index = !who.masked && !isGuest && !isBot && !!who.username && (bio.length > 0 || posts.length > 0);
  // /u/{username} is the public form and the one the user sitemap emits, so it
  // wins over the /user/{uid} alias and over /u/ case variants. Falls back to
  // the route only for usernameless profiles, which never index anyway.
  const canonical = canonicalUserUrl(who.username) || `${SITE}${route}`;

  const schema = [{
    '@type': 'ProfilePage',
    url: canonical,
    mainEntity: {
      '@type': 'Person',
      name: who.name,
      ...(who.username ? { alternateName: `@${who.username}` } : {}),
      ...(bio ? { description: bio } : {}),
      ...(who.avatar ? { image: who.avatar } : {}),
      ...(followers ? {
        interactionStatistic: [{
          '@type': 'InteractionCounter',
          interactionType: { '@type': 'FollowAction' },
          userInteractionCount: followers,
        }],
      } : {}),
    },
  }];

  const postLinks = posts.slice(0, 6).map((p, i) => {
    const t = (p.content || '').trim().slice(0, 80) || `${p.type || 'post'} by ${who.name}`;
    return `<li>${esc(t)}</li>`;
  }).join('');

  const body = `<main><article>`
    + `<h1>${esc(title)}</h1>`
    + (bio ? `<p>${esc(bio)}</p>` : '')
    + (followers ? `<p>${esc(String(followers))} followers</p>` : '')
    + (postLinks ? `<h2>Recent posts</h2><ul>${postLinks}</ul>` : '')
    + SIGNUP_CTA
    + `</article></main>`;

  return {
    title, description, image: who.avatar || FALLBACK_IMAGE, index,
    canonical,
    ogType: 'profile', jsonld: graph(schema), body,
  };
}

async function renderStream(id, route) {
  const snap = await db.collection('streams').doc(id).get();
  if (!snap.exists) return null;
  const s = snap.data();
  let host = null;
  if (s.hostUid) {
    try { host = (await db.collection('users').doc(s.hostUid).get()).data(); } catch {}
  }
  const who = publicIdentity(host);
  if (who.hidden) return { private: true };
  const live = s.status === 'live';
  const vod = s.archiveVodUrl || s.vodUrl || null;
  const streamTitle = (s.title || '').trim();
  const started = tsIso(s.startedAt) || tsIso(s.createdAt);

  const title = `${live ? 'LIVE: ' : ''}${who.name}${streamTitle ? ` — ${streamTitle}` : ' is streaming'}${s.game ? ` (${s.game})` : ''} | VERGR`;
  const description = s.game
    ? `${live ? 'Live now' : 'Stream'} on VERGR: ${who.name} playing ${s.game}.${streamTitle ? ` ${streamTitle}.` : ''} Watch free, tip the streamer, follow for go-live alerts.`
    : `${who.name} streams on VERGR. Watch free, tip the streamer, follow for go-live alerts.`;
  const image = s.coverUrl || s.thumbnailUrl || FALLBACK_IMAGE;

  // Index live streams + ended streams with a replay; created/ended-no-vod = noindex.
  const index = live || !!vod;

  const schema = [];
  if (live) {
    schema.push({
      '@type': 'BroadcastEvent',
      name: title.replace(' | VERGR', ''),
      description,
      isLiveBroadcast: true,
      ...(started ? { startDate: started } : {}),
      url: `${SITE}${route}`,
    });
  } else if (vod) {
    schema.push({
      '@type': 'VideoObject',
      name: title.replace(' | VERGR', ''),
      description,
      thumbnailUrl: image,
      contentUrl: vod,
      ...(started ? { uploadDate: started } : {}),
      url: `${SITE}${route}`,
    });
  }

  const body = `<main><article>`
    + `<h1>${esc(title.replace(' | VERGR', ''))}</h1>`
    + `<p>${esc(description)}</p>`
    + SIGNUP_CTA
    + `</article></main>`;

  return {
    title, description, image, index,
    ogType: 'video.other',
    jsonld: schema.length ? graph(schema) : null,
    body,
    cacheSeconds: live ? 30 : 600,
  };
}

// ── UGC sitemap ───────────────────────────────────────────────────────
//
// PAGINATED, deliberately. A single sitemap used to take the newest 1,000
// posts, which silently evicted older content as new posts arrived — an
// article would be discoverable for a while, then quietly drop out of the
// index surface with nothing in the logs. Reach needs BOTH: fresh posts and
// the whole back catalogue.
//
//   /sitemap-ugc.xml      → sitemap INDEX (lists the pages below)
//   /sitemap-ugc-N.xml    → page N, newest-first, PAGE_SIZE posts per page
//   /sitemap-ugc-users.xml → public profiles
//
// The protocol cap is 50,000 URLs / 50MB per file; PAGE_SIZE is far below
// that so each page stays a fast, small function response. Pages are edge
// cached 6h, so the offset() reads cost effectively nothing.
const PAGE_SIZE = 1000;

const xmlUrl = (loc, lastmod) =>
  `  <url>\n    <loc>${esc(loc)}</loc>\n${lastmod ? `    <lastmod>${esc(lastmod.slice(0, 10))}</lastmod>\n` : ''}  </url>`;

function sendXml(res, body) {
  res.set('Content-Type', 'application/xml');
  res.set('Cache-Control', 'public, max-age=600, s-maxage=21600');
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?>\n' + body);
}

function urlset(urls) {
  return '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.join('\n') + (urls.length ? '\n' : '') + '</urlset>\n';
}

// Index: one <sitemap> per post page, plus the profiles page.
async function renderSitemapIndex(res) {
  let pages = 1;
  try {
    const agg = await db.collection('posts').count().get();
    pages = Math.max(1, Math.ceil((agg.data().count || 0) / PAGE_SIZE));
  } catch (e) { console.warn('sitemap-ugc index count failed', e.message); }
  const entries = [];
  for (let i = 1; i <= pages; i++) {
    entries.push(`  <sitemap>\n    <loc>${esc(`${SITE}/sitemap-ugc-${i}.xml`)}</loc>\n  </sitemap>`);
  }
  entries.push(`  <sitemap>\n    <loc>${esc(`${SITE}/sitemap-ugc-users.xml`)}</loc>\n  </sitemap>`);
  sendXml(res, '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + entries.join('\n') + '\n</sitemapindex>\n');
}

// One page of posts, newest-first. Filters match renderPost's index decision
// exactly — a URL that would render noindex must never enter the sitemap.
async function renderSitemapPosts(res, page) {
  const urls = [];
  try {
    let q = db.collection('posts').orderBy('createdAt', 'desc');
    if (page > 1) q = q.offset((page - 1) * PAGE_SIZE);
    const posts = await q.limit(PAGE_SIZE).get();
    for (const d of posts.docs) {
      const p = d.data();
      if ((p.visibility || 'public') !== 'public' || p.hidden === true) continue;
      const text = (p.content || '').trim();
      const media = Array.isArray(p.mediaUrls) ? p.mediaUrls : (p.mediaUrl ? [p.mediaUrl] : []);
      if (text.length < 30 && media.length === 0) continue; // same quality bar
      // Syndicated posts enter the sitemap once their original rewrite
      // exists (same gate as renderPost's index decision).
      if ((p.isNewsPost === true || p.sourceUrl) && !((p.seoText || '').length >= 400)) continue;
      // Prefer the SEO slug (news/article posts) over the raw doc id so the
      // sitemap shows e.g. /post/werewolf-metroidvania-revealed-5k8ymm instead
      // of /post/news-pcgamer-5k8ymm. Regular user posts have no slug → opaque
      // doc id (IG/Twitch model). renderPost resolves either form.
      // Shares canonicalPostPath with the renderer + IndexNow: a sitemap URL
      // that is not the declared canonical is a self-inflicted duplicate.
      urls.push(xmlUrl(`${SITE}${canonicalPostPath(d.id, p)}`, tsIso(p.createdAt)));
    }
  } catch (e) { console.warn(`sitemap-ugc page ${page} failed`, e.message); }
  sendXml(res, urlset(urls));
}

// "Does this profile have a post the renderer would count?" — mirrors
// renderUser's own posts query (same order, same limit, same in-code
// public/hidden filter, same fallback when the composite index is missing) so
// the sitemap and the page can't reach different answers. Runs only for users
// that already passed the cheap field checks, and only when they have no bio.
// Errs toward EXCLUDING on a read failure: listing a url that then renders
// noindex is worse than omitting one that would have indexed.
async function hasPublicPost(uid) {
  const isPublic = (p) => (p.visibility || 'public') === 'public' && p.hidden !== true;
  try {
    const q = await db.collection('posts').where('authorId', '==', uid)
      .orderBy('createdAt', 'desc').limit(8).get();
    return q.docs.some((d) => isPublic(d.data()));
  } catch {
    try {
      const q2 = await db.collection('posts').where('authorId', '==', uid).limit(8).get();
      return q2.docs.some((d) => isPublic(d.data()));
    } catch { return false; }
  }
}

async function renderSitemapUsers(res) {
  const urls = [];
  try {
    const users = await db.collection('users').orderBy('followerCount', 'desc').limit(300).get();
    for (const d of users.docs) {
      const u = d.data();
      if (!u.username || u.isGuest === true || u.role === 'admin' || u.hideFromEnumeration === true) continue;
      if (typeof u.accountType === 'string' && u.accountType.includes('_bot')) continue;
      if (isVanguardActive(u)) continue;
      // MUST mirror renderUser's `index` exactly. It used to test
      // `bio || followerCount > 0` while the renderer tests
      // `bio || has a public post`, so a follower-but-no-content account was
      // listed in the sitemap and then served noindex — 3 of the 4 entries
      // here were doing that. A sitemap advertising noindex urls is the same
      // self-inflicted-signal mistake as submitting them to IndexNow.
      if (!(u.bio || '').trim() && !(await hasPublicPost(d.id))) continue;
      // Shared with the renderer's canonical, same reason as posts.
      urls.push(xmlUrl(canonicalUserUrl(u.username)));
    }
  } catch (e) { console.warn('sitemap-ugc users failed', e.message); }
  sendXml(res, urlset(urls));
}

// ── HTTP entry ────────────────────────────────────────────────────────
exports.ugcRenderer = onRequest({ memory: '256MiB', maxInstances: 5 }, async (req, res) => {
  try {
    const path = req.path || '/';
    if (path.endsWith('/sitemap-ugc.xml')) return await renderSitemapIndex(res);
    if (path.endsWith('/sitemap-ugc-users.xml')) return await renderSitemapUsers(res);
    const pageMatch = path.match(/\/sitemap-ugc-(\d+)\.xml$/);
    if (pageMatch) return await renderSitemapPosts(res, Math.max(1, Number(pageMatch[1])));

    // Parse "<kind>/<id>" from the END of the path (hosting rewrites can
    // pass the full original path; be tolerant like shareLink is).
    const seg = path.split('/').filter(Boolean);
    const id = decodeURIComponent(seg[seg.length - 1] || '');
    const kind = seg[seg.length - 2] || seg[0];
    if (!id || !['post', 'clip', 'user', 'u', 'watch'].includes(kind)) {
      return res.status(404).send('Not found');
    }
    const route = `/${kind}/${id}`;

    let data = null;
    if (kind === 'post' || kind === 'clip') data = await renderPost(id, route);
    else if (kind === 'user') data = await renderUser(id, route);
    else if (kind === 'watch') data = await renderStream(id, route);
    else if (kind === 'u') {
      // Resolve username -> uid via the usernames index, then render profile.
      const uname = id.toLowerCase().replace(/^@/, '');
      const idx = await db.collection('usernames').doc(uname).get();
      const uid = idx.exists ? (idx.data().uid || idx.data().userId) : null;
      if (uid) {
        const [userData, meSnap] = await Promise.all([
          renderUser(uid, route),
          db.collection('users').doc(uid).collection('vergrMe').doc('page').get(),
        ]);
        data = userData;
        // /u/ is primarily the vergr.me page: when one is published, its
        // custom SEO fields (or its own name/bio) win over the profile meta
        // so link previews show what the creator authored.
        const me = meSnap.exists ? meSnap.data() : null;
        if (data && !data.private && me?.isPublic) {
          const meTitle = (me.seoTitle || '').trim();
          const meDesc = (me.seoDescription || me.bio || '').trim();
          if (meTitle) data.title = meTitle.slice(0, 120);
          // vergr.me is the FEATURE name; the domain is not registered, so the
          // title must not advertise a URL that does not resolve.
          else if (me.displayName) data.title = `${me.displayName} · vergr.app/u/${uname}`;
          if (meDesc) data.description = meDesc.slice(0, 200);
        }
      }
    }

    const shell = await getShell();
    // A renderer that answers on more than one URL returns its OWN canonical;
    // echoing the requested route would make every alias self-canonical and
    // therefore a duplicate of its siblings. Route is only the fallback for
    // single-URL kinds (/watch) and the not-found shell.
    const canonical = data?.canonical || `${SITE}${route}`;

    if (!data || data.private) {
      // Missing or non-public: plain shell, generic meta, noindex. The SPA
      // still boots, so an authorized human (e.g. the author) lands in the app.
      let html = applyHead(shell, {
        title: 'VERGR — Where Gamers Converge',
        description: 'Compete, create, earn and shop with the gaming community.',
        canonical, image: FALLBACK_IMAGE, index: false, jsonld: null,
      });
      res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
      return res.status(200).send(html);
    }

    let html = applyHead(shell, {
      title: data.title,
      description: data.description,
      canonical,
      image: data.image,
      index: data.index,
      jsonld: data.jsonld,
      ogType: data.ogType,
    });
    html = injectBody(html, data.body);
    const secs = data.cacheSeconds || 600;
    res.set('Cache-Control', `public, max-age=${Math.min(secs, 120)}, s-maxage=${secs}`);
    return res.status(200).send(html);
  } catch (e) {
    console.error('ugcRenderer failed:', e);
    // Never hard-fail a content URL: fall back to the plain shell.
    const shell = await getShell();
    res.set('Cache-Control', 'no-store');
    return res.status(200).send(shell);
  }
});
