// Post-build static prerender for the help center.
//
// This SPA has no SSR, so a raw fetch of /platform/help/<slug> would return the
// shell with an empty #root. Googlebot renders JS, but Bing + AI crawlers often
// do not, and reliable per-article indexing wants real content in the initial
// HTML. This script reads the built dist/index.html shell and writes a static
// HTML file per PUBLISHED help URL with: a unique <title>, meta description,
// canonical, Open Graph/Twitter tags, Article + Breadcrumb (+ FAQ/HowTo) JSON-LD,
// and the full article text baked into #root. The SPA still boots and takes over
// on load. Coming-soon (unpublished) titles are never prerendered or linked.
//
// Also (re)generates dist/sitemap.xml = the static marketing entries from
// public/sitemap.xml + the help index, each non-empty category, and every
// published article. Runs automatically via the `postbuild` npm hook.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { loadHelp } from './_helpData.mjs';
// legalContent.js is plain ESM data with zero imports, so Node can load it
// directly — no esbuild bundle needed the way helpContent.jsx requires one.
const { CHILD_SAFETY_STANDARDS } = await import(pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'screens', 'marketing', 'legal', 'legalContent.js'),
).href);

/** Render a legalContent document to static HTML for prerendering. */
function legalDocHtml(docObj) {
  const p = (s) => `<p>${escHtml(s)}</p>`;
  const intro = (Array.isArray(docObj.intro) ? docObj.intro : [docObj.intro]).map(p).join('');
  const body = docObj.sections.map((s) =>
    `<section id="${escHtml(s.id)}"><h2>${escHtml(s.title)}</h2>${s.body.map(p).join('')}</section>`).join('');
  return `<p>${escHtml(docObj.updated)}</p>${intro}${body}`;
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..');
const DIST = join(REPO, 'dist');
const SITE = 'https://vergr.app';
const OG_IMAGE = `${SITE}/og/share-poster.jpg`;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

// ── Head rewrite: override the shell's title/description/OG/canonical ──
function applyHead(html, { title, description, canonical, jsonld }) {
  let h = html;
  h = h.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  h = h.replace(/(<meta name="description" content=")[\s\S]*?("\s*\/>)/, `$1${escAttr(description)}$2`);
  h = h.replace(/(<meta property="og:title" content=")[\s\S]*?("\s*\/>)/, `$1${escAttr(title)}$2`);
  h = h.replace(/(<meta property="og:description" content=")[\s\S]*?("\s*\/>)/, `$1${escAttr(description)}$2`);
  h = h.replace(/(<meta property="og:url" content=")[\s\S]*?("\s*\/>)/, `$1${escAttr(canonical)}$2`);
  h = h.replace(/(<meta name="twitter:title" content=")[\s\S]*?("\s*\/>)/, `$1${escAttr(title)}$2`);
  h = h.replace(/(<meta name="twitter:description" content=")[\s\S]*?("\s*\/>)/, `$1${escAttr(description)}$2`);
  // Strip the shell's default canonical/robots so we don't emit duplicates.
  h = h.replace(/\s*<link rel="canonical"[^>]*\/>/g, '');
  h = h.replace(/\s*<meta name="robots"[^>]*\/>/g, '');
  const inject = `<link rel="canonical" href="${escAttr(canonical)}" />\n`
    + `<meta name="robots" content="index,follow" />\n`
    + `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>\n`;
  h = h.replace('</head>', inject + '</head>');
  return h;
}

function injectBody(html, bodyHtml) {
  // #root is no longer empty in index.html (the static boot splash lives
  // inside it since 2026-07-05), so match the opening tag only and place the
  // prerendered content right after it. The boot splash overlays it visually;
  // React clears #root on mount either way.
  if (!html.includes('<div id="root">')) {
    throw new Error('prerenderHelp: <div id="root"> not found in shell — body injection would be dropped');
  }
  return html.replace('<div id="root">', `<div id="root">${bodyHtml}`);
}

function write(relUrl, html) {
  const dir = join(DIST, relUrl.replace(/^\//, ''));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
}

// ── Block model -> semantic HTML ──────────────────────────────────────
function blocksToHtml(body, slugify) {
  const out = [];
  for (const b of body) {
    if (b.p != null) out.push(`<p>${esc(b.p)}</p>`);
    else if (b.h2 != null) out.push(`<h2 id="${escAttr(slugify(b.h2))}">${esc(b.h2)}</h2>`);
    else if (Array.isArray(b.list)) out.push(`<ul>${b.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
    else if (Array.isArray(b.steps)) out.push(`<ol>${b.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`);
    else if (Array.isArray(b.faq)) {
      out.push('<section>' + b.faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('') + '</section>');
    } else if (b.note != null) out.push(`<p class="vg-note">${esc(b.note)}</p>`);
    else if (Array.isArray(b.cta)) {
      out.push('<nav class="vg-related">' + b.cta.map((c) => `<a href="${escAttr(c.to)}">${esc(c.label)}</a>`).join('') + '</nav>');
    }
  }
  return out.join('\n');
}

function crumbsHtml(crumbs) {
  return '<nav aria-label="Breadcrumb">' + crumbs.map((c, i) => {
    const sep = i ? ' &rsaquo; ' : '';
    return c.path ? `${sep}<a href="${escAttr(c.path)}">${esc(c.name)}</a>` : `${sep}<span>${esc(c.name)}</span>`;
  }).join('') + '</nav>';
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('prerenderHelp: dist/index.html not found — run vite build first.');
    process.exit(1);
  }
  const shell = readFileSync(join(DIST, 'index.html'), 'utf8');
  const m = await loadHelp();
  const {
    slugify, HELP_CATEGORIES, HELP_CATEGORY_BY_ID, articlesInCategory, publishedArticles,
  } = m;

  // Schema builders (mirror src/utils/JsonLd.jsx, kept minimal here).
  const abs = (p) => (p?.startsWith('http') ? p : `${SITE}${p || ''}`);
  const breadcrumbSchema = (crumbs) => ({
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: abs(c.path) })),
  });
  const faqSchema = (qa) => ({
    '@type': 'FAQPage',
    mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  });
  const howToSchema = (name, description, steps) => ({
    '@type': 'HowTo', name, description,
    step: steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: `Step ${i + 1}`, text: s })),
  });
  const articleSchema = (a) => ({
    '@type': 'Article',
    headline: a.title,
    description: a.summary,
    mainEntityOfPage: { '@type': 'WebPage', '@id': abs(`/platform/help/${a.slug}`) },
    author: { '@type': 'Organization', name: 'VERGR', url: SITE },
    publisher: { '@type': 'Organization', name: 'VERGR', url: SITE, logo: { '@type': 'ImageObject', url: `${SITE}/icons/icon-512-v2.png` } },
    ...(a.updated ? { datePublished: a.updated, dateModified: a.updated } : {}),
  });
  const graph = (items) => ({ '@context': 'https://schema.org', '@graph': items });

  const pub = publishedArticles();
  let count = 0;

  // ── Per-article pages ──
  for (const a of pub) {
    const cat = HELP_CATEGORY_BY_ID[a.category];
    const crumbs = [
      { name: 'Home', path: '/platform' },
      { name: 'Help Center', path: '/platform/help' },
      ...(cat ? [{ name: cat.label, path: `/platform/help/category/${cat.id}` }] : []),
      { name: a.title, path: `/platform/help/${a.slug}` },
    ];
    const items = [articleSchema(a), breadcrumbSchema(crumbs)];
    const faqBlocks = a.body.filter((b) => Array.isArray(b.faq)).flatMap((b) => b.faq);
    if (faqBlocks.length) items.push(faqSchema(faqBlocks));
    const stepBlock = a.body.find((b) => Array.isArray(b.steps));
    if (stepBlock) items.push(howToSchema(a.title, a.summary, stepBlock.steps));

    const bodyHtml = `<main><article>${crumbsHtml(crumbs)}`
      + `<h1>${esc(a.title)}</h1><p>${esc(a.summary)}</p>`
      + blocksToHtml(a.body, slugify) + '</article></main>';

    let html = applyHead(shell, {
      title: `${a.title} | VERGR Help`,
      description: a.summary,
      canonical: `${SITE}/platform/help/${a.slug}`,
      jsonld: graph(items),
    });
    html = injectBody(html, bodyHtml);
    write(`/platform/help/${a.slug}`, html);
    count++;
  }

  // ── Category pages (only those with >=1 published article) ──
  const catsWithContent = [];
  for (const cat of HELP_CATEGORIES) {
    const arts = articlesInCategory(cat.id);
    const published = arts.filter((x) => x.published);
    if (!published.length) continue;
    catsWithContent.push(cat);
    const crumbs = [
      { name: 'Home', path: '/platform' },
      { name: 'Help Center', path: '/platform/help' },
      { name: cat.label, path: `/platform/help/category/${cat.id}` },
    ];
    const links = published.map((x) => `<li><a href="/platform/help/${x.slug}">${esc(x.title)}</a></li>`).join('');
    const bodyHtml = `<main>${crumbsHtml(crumbs)}<h1>${esc(cat.label)}</h1>`
      + `<p>${esc(cat.blurb)}</p><ul>${links}</ul></main>`;
    let html = applyHead(shell, {
      title: `${cat.label} | VERGR Help Center`,
      description: cat.blurb,
      canonical: `${SITE}/platform/help/category/${cat.id}`,
      jsonld: graph([breadcrumbSchema(crumbs)]),
    });
    html = injectBody(html, bodyHtml);
    write(`/platform/help/category/${cat.id}`, html);
    count++;
  }

  // ── Help index ──
  {
    const crumbs = [{ name: 'Home', path: '/platform' }, { name: 'Help Center', path: '/platform/help' }];
    const catLinks = catsWithContent.map((c) => `<li><a href="/platform/help/category/${c.id}">${esc(c.label)}</a></li>`).join('');
    const artLinks = pub.map((a) => `<li><a href="/platform/help/${a.slug}">${esc(a.title)}</a></li>`).join('');
    const bodyHtml = `<main><h1>VERGR Help Center</h1>`
      + `<p>Guides and answers for streaming, the coin economy, payouts, squads, and more.</p>`
      + `<h2>Browse by topic</h2><ul>${catLinks}</ul>`
      + `<h2>All guides</h2><ul>${artLinks}</ul></main>`;
    let html = applyHead(shell, {
      title: 'Help Center | VERGR',
      description: 'Guides and answers for VERGR: streaming, coins, gems, payouts, squads, and account help.',
      canonical: `${SITE}/platform/help`,
      jsonld: graph([breadcrumbSchema(crumbs)]),
    });
    html = injectBody(html, bodyHtml);
    write('/platform/help', html);
    count++;
  }

  // ── Growth / SEO money pages (pillar, legit hub, per-game) ──
  // Pure-data module, imported directly (no esbuild needed).
  const growth = await import(pathToFileURL(join(REPO, 'src', 'screens', 'marketing', 'growth', 'growthContent.js')).href);
  const growthBlocksHtml = (sections) => {
    const out = [];
    for (const s of sections) {
      out.push('<section>');
      if (s.h2) out.push(`<h2>${esc(s.h2)}</h2>`);
      for (const b of s.blocks) {
        if (b.p != null) out.push(`<p>${esc(b.p)}</p>`);
        else if (Array.isArray(b.tiles)) out.push(b.tiles.map((t) => `<h3>${esc(t.title)}</h3><p>${esc(t.body)}</p>`).join(''));
        else if (Array.isArray(b.list)) out.push(`<ul>${b.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
        else if (Array.isArray(b.steps)) out.push(`<ol>${b.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`);
        else if (Array.isArray(b.faq)) out.push('<section>' + b.faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('') + '</section>');
        else if (b.note != null) out.push(`<p class="vg-note">${esc(b.note)}</p>`);
        else if (Array.isArray(b.links)) out.push('<nav class="vg-related">' + b.links.map((l) => `<a href="${escAttr(l.to)}">${esc(l.label)}</a>`).join('') + '</nav>');
      }
      out.push('</section>');
    }
    return out.join('\n');
  };
  const growthFaq = (page) => page.sections.flatMap((s) => s.blocks.filter((b) => Array.isArray(b.faq)).flatMap((b) => b.faq));
  // The growth funnel (Make Money Gaming pillar, the "Is VERGR Legit?" hub and
  // the per-game /platform/play/* pages) is retired: an earnings-claim page, a
  // page arguing our own legitimacy, and per-game money pages all read badly to
  // a payment underwriter. The content module is kept; delete this guard to
  // bring the pages back.
  const GROWTH_PRERENDER_DISABLED = true;
  for (const page of (GROWTH_PRERENDER_DISABLED ? [] : growth.ALL_GROWTH_PAGES)) {
    const isGame = !!page.game;
    const crumbs = [
      { name: 'Home', path: '/platform' },
      ...(isGame ? [{ name: 'Make Money Gaming', path: growth.PILLAR_PAGE.path }] : []),
      { name: isGame ? page.game : page.h1, path: page.path },
    ];
    const items = [
      { '@type': 'WebPage', name: page.metaTitle, description: page.metaDescription, url: `${SITE}${page.path}` },
      breadcrumbSchema(crumbs),
    ];
    const qa = growthFaq(page);
    if (qa.length) items.push(faqSchema(qa));
    const bodyHtml = `<main><article>${crumbsHtml(crumbs)}`
      + `<h1>${esc(page.h1)}</h1><p>${esc(page.subtitle)}</p>`
      + growthBlocksHtml(page.sections)
      + (page.cta ? `<p><a href="/signup">${esc(page.cta.title)} ${esc(page.cta.label)}</a></p>` : '')
      + '</article></main>';
    let html = applyHead(shell, {
      title: page.metaTitle,
      description: page.metaDescription,
      canonical: `${SITE}${page.path}`,
      jsonld: graph(items),
    });
    html = injectBody(html, bodyHtml);
    write(page.path, html);
    count++;
  }

  // ── Marketing / info pages (head fix) ─────────────────────────────────
  // The raw SPA shell hardcodes <link rel="canonical" href="https://vergr.app/">,
  // so every non-prerendered route tells Google "I am the homepage" — Google
  // folds the whole site into ONE indexed page. These entries bake a correct
  // self-canonical + unique title/description (+ a minimal h1/p body so no-JS
  // clients and non-rendering crawlers see real content). The first ten mirror
  // the useSeo() calls in PublicMarketingScreens.jsx — keep them in sync.
  const MARKETING_PAGES = [
    { path: '/platform', h1: 'Live Streaming for Gamers & Creators',
      title: 'Vergr | Live Streaming for Gamers & Creators',
      description: 'Connect with gamers, live stream in high quality, and share clips on Vergr. Build your squad, follow creators, and support them with tips and memberships.' },
    { path: '/platform/store', h1: 'Shop — Buy VC Coins',
      title: 'Shop — Buy VC Coins | VERGR',
      description: 'Buy VC Coins to tip streamers, join creator memberships, unlock paid streams, and boost your reach. Eight pack sizes from €0.99 to €224.99. Pay with cryptocurrency or card.' },
    { path: '/platform/contact', h1: 'Contact VERGR',
      title: 'Contact — Get in Touch with VERGR',
      description: 'Send the VERGR team a message about support, privacy, legal, abuse, copyright, press, or partnerships. We reply within two business days.' },
    // Google Play links its Data safety form at this URL and checks that it
    // loads. It MUST stay in this list, and it must stay prerendered so it
    // resolves even if the SPA bundle fails.
    { path: '/platform/delete-account', h1: 'Delete your VERGR account',
      title: 'Delete Your VERGR Account & Data',
      description: 'How to permanently delete your VERGR account and associated data, what is removed, what is retained and for how long, and how to submit a deletion request.' },
    { path: '/platform/creators', h1: 'Keep 90% from your first fan',
      title: 'For Creators — Keep 90% From Your First Fan | VERGR',
      description: 'VERGR takes a flat 10% on tips and memberships — you keep 90% from day one, no points program, no tier ladder. Mirror your stream to Twitch while you grow here. Trying it costs nothing.' },
    { path: '/platform/monetization', h1: 'Make Money Gaming',
      title: 'Make Money Gaming — VERGR Creator Monetisation',
      description: 'Ways to earn on VERGR: tips, memberships, paid streams, and Stream Boost amplification. Flat 10% tip fee. Your conversion commission drops 30% → 10% as you climb the rank ladder.' },
    { path: '/platform/learn/live', h1: 'Stream Gameplay & Earn',
      title: 'Stream Gameplay & Earn — Live Streaming on VERGR',
      description: 'Go live in 30 seconds from your browser, no install. Earn real tips while you play, build memberships, and co-stream with a guest at 720p60 (Lite) or 1080p60 (Pro). The Twitch alternative built for gamer monetisation.' },
    { path: '/platform/learn/squads', h1: 'Squads — Gaming Crews with Shared Treasuries',
      title: 'Squads — Gaming Crews with Shared Treasuries | VERGR',
      description: 'Up to 100 members. Voice + video hangouts built in. Monthly elections, real roles (President, Vice President, Treasury), and a shared squad treasury. Discord meets gaming crew.' },
    { path: '/platform/learn/clips', h1: 'Gaming Clips — Upload, Share, Earn',
      title: 'Gaming Clips — Upload, Share, Earn | VERGR',
      description: 'Upload your clutch moments or embed YouTube/Twitch clips. Up to 60s (Free), 3min (Lite), or 10min (Pro). Earn VP from views and tips. Discover clips from squads and the global feed.' },
    { path: '/platform/learn/coins', h1: 'VC Coins — Gaming Currency You Can Cash Out',
      title: 'VC Coins — Gaming Currency You Can Cash Out | VERGR',
      description: 'Buy coins from €0.99 to €224.99 with crypto or card. Tip streamers, join memberships, unlock paid streams. Coins are spendable only inside VERGR; creators convert earnings to gems and withdraw.' },
    { path: '/linkinbio', h1: 'Get Your Free Link in Bio',
      title: 'Vergr.me | Get Your Free Link in Bio',
      description: 'Claim your free vergr.me link in bio page: unlimited links, 18+ block types, real design systems, analytics, QR codes and live stream integration. Free forever, no credit card.' },
    // Pages below have no useSeo() in their screens (shell canonical applied even
    // at runtime) — titles/descriptions authored here, self-canonical is the fix.
    { path: '/platform/streamer', h1: 'For Streamers',
      title: 'For Streamers — Go Live & Get Paid | VERGR',
      description: 'Stream from your browser or OBS, earn tips with a flat 10% fee, build channel memberships, and mirror to Twitch. Built for gamer monetisation.' },
    { path: '/platform/studio-tools', h1: 'Studio Tools',
      title: 'Studio Tools — Overlays, Clips & Creator Tools | VERGR',
      description: 'VERGR creator studio: stream overlays, clip tools, scheduling, analytics, and monetisation controls in one dashboard.' },
    { path: '/platform/partners', h1: 'Partners',
      title: 'Partners — Work with VERGR',
      description: 'Partner with VERGR: creator programs and brand collaborations on the live streaming platform.' },
    { path: '/platform/about', h1: 'About VERGR',
      title: 'About VERGR — The Live Streaming Platform',
      description: 'VERGR combines live streaming, clips, squads with shared treasuries, and creator monetisation in one platform.' },
    { path: '/platform/code-of-conduct', h1: 'Code of Conduct',
      title: 'Code of Conduct | VERGR',
      description: 'The VERGR community code of conduct: fair play, respectful behaviour, anti-cheat rules, and enforcement.' },
    { path: '/platform/download', h1: 'Download VERGR',
      title: 'Download VERGR — Windows, Android, iPhone & Web',
      description: 'Get VERGR on any device: Windows desktop app, Android APK, iPhone home-screen app, or straight in your browser.' },
    { path: '/platform/careers', h1: 'Careers',
      title: 'Careers at VERGR',
      description: 'Join the team building the live streaming platform: streaming, clips, squads, and creator monetisation.' },
    { path: '/platform/forums', h1: 'Forums',
      title: 'Forums — VERGR Community',
      description: 'The VERGR community forums: announcements, feedback, creator discussion, and squad recruitment.' },
    { path: '/platform/terms', h1: 'Terms of Service',
      title: 'Terms of Service | VERGR',
      description: 'The VERGR terms of service covering accounts, coins and gems, streaming, and payouts.' },
    { path: '/platform/privacy', h1: 'Privacy Policy',
      title: 'Privacy Policy | VERGR',
      description: 'How VERGR collects, uses, and protects your data, and the controls you have over it.' },
    { path: '/platform/acceptable-use', h1: 'Acceptable Use Policy',
      title: 'Acceptable Use Policy | VERGR',
      description: 'What is and is not allowed on VERGR: content rules, prohibited behaviour, and enforcement.' },
    { path: '/platform/cookies', h1: 'Cookie Policy',
      title: 'Cookie Policy | VERGR',
      description: 'How VERGR uses cookies and similar technologies, and how to manage them.' },
    // Payment providers expect a refund policy reachable without reading the
    // full Terms. Prerendered so it resolves even if the SPA bundle fails.
    { path: '/platform/refunds', h1: 'Refund and Cancellation Policy',
      title: 'Refund & Cancellation Policy | VERGR',
      description: 'When a VERGR purchase can be refunded, how to cancel a subscription, what happens if a paid stream is cancelled, and how to contact us about a charge.' },
    // Google Play's Child Safety Standards policy requires this URL to load
    // without error and to name the app or developer. Prerendering it means a
    // Play crawler gets real content, not the empty SPA shell.
    { path: '/platform/child-safety', h1: 'Child Safety Standards',
      title: 'Child Safety Standards | VERGR',
      description: 'VERGR is an 18+ service with zero tolerance for child sexual abuse and exploitation. How we detect it, how to report it, and who to contact.',
      // FULL text in the static HTML, not just a summary line. Play verifies
      // the URL is "relevant in scope" and "references the app or developer
      // name"; a reviewer or crawler that doesn't run JS must still see the
      // actual standards, not a one-line teaser plus an empty SPA shell.
      bodyHtml: legalDocHtml(CHILD_SAFETY_STANDARDS) },
  ];
  // Short crumb label for a marketing page: the h1 is a full sentence
  // ("Live Streaming for Gamers & Creators"), which reads badly in a
  // breadcrumb, so derive from the slug and override only where that loses
  // meaning.
  const CRUMB_OVERRIDES = {
    '/platform/store': 'Coins',
    '/platform/delete-account': 'Delete Account',
    '/platform/legit': 'Is VERGR Legit?',
    '/platform/streamer': 'Become a Streamer',
    '/platform/creators': 'For Creators',
    '/platform/partners': 'Partner Program',
    '/platform/linkinbio': 'Link in Bio',
    '/platform/play/fc25': 'EA Sports FC',
    '/platform/play/cs2': 'CS2',
    '/platform/play/nba2k': 'NBA 2K',
    '/platform/code-of-conduct': 'Code of Conduct',
    '/platform/acceptable-use': 'Acceptable Use',
    '/platform/child-safety': 'Child Safety',
  };
  const crumbLabel = (path) => CRUMB_OVERRIDES[path]
    || path.split('/').filter(Boolean).pop()
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (m) => m.toUpperCase());

  let marketingCount = 0;
  for (const page of MARKETING_PAGES) {
    // /platform IS the marketing home, so it gets no breadcrumb of its own.
    // Everything else is Home > Page: deliberately TWO levels, skipping
    // intermediate segments like /platform/learn, which return 200 but only
    // serve the generic SPA shell — a crumb pointing at a soft-404 is worse
    // than no crumb, and Google accepts a two-item trail.
    const crumbs = page.path === '/platform' ? null : [
      { name: 'Home', path: '/platform' },
      { name: crumbLabel(page.path), path: page.path },
    ];
    const items = [{ '@type': 'WebPage', name: page.title, description: page.description, url: `${SITE}${page.path}` }];
    if (crumbs) items.push(breadcrumbSchema(crumbs));

    let html = applyHead(shell, {
      title: page.title,
      description: page.description,
      canonical: `${SITE}${page.path}`,
      jsonld: graph(items),
    });
    // Visible trail alongside the markup — Google expects the structured data
    // to reflect a breadcrumb the user can actually see.
    html = injectBody(html, `<main>${crumbs ? crumbsHtml(crumbs) : ''}`
      + `<h1>${esc(page.h1)}</h1><p>${esc(page.description)}</p>`
      + (page.bodyHtml || '') + `</main>`);
    write(page.path, html);
    marketingCount++;
  }

  // ── Hub page: /platform/learn ──
  //
  // This path existed only as a URL segment: it returned 200 while serving the
  // generic SPA shell (a soft-404), and it's a breadcrumb target, so crawlers
  // reached it and found the homepage. Rather than 404 it, make it the real
  // topic hub its children imply — it consolidates internal links to the six
  // guides and is a legitimate ranking page in its own right.
  //
  // Note /platform/play is NOT given a hub: /platform/make-money-gaming is
  // already the pillar that links every game page, so a second hub would be
  // duplicate content competing with it. That one 301s instead (firebase.json).
  {
    const children = MARKETING_PAGES.filter((p) => p.path.startsWith('/platform/learn/'));
    const crumbs = [{ name: 'Home', path: '/platform' }, { name: 'Learn', path: '/platform/learn' }];
    const title = 'Learn VERGR — Live Streaming, Squads, Clips & Coins';
    const description = 'Guides to everything on VERGR: live streaming, squads with shared treasuries, gaming clips, and the VC coin economy.';
    const items = [
      { '@type': 'WebPage', name: title, description, url: `${SITE}/platform/learn` },
      breadcrumbSchema(crumbs),
    ];
    const links = children.map((c) => `<li><a href="${c.path}">${esc(c.h1)}</a> — ${esc(c.description)}</li>`).join('');
    const bodyHtml = `<main>${crumbsHtml(crumbs)}<h1>Learn VERGR</h1>`
      + `<p>${esc(description)}</p><ul>${links}</ul></main>`;
    let html = applyHead(shell, {
      title, description, canonical: `${SITE}/platform/learn`, jsonld: graph(items),
    });
    html = injectBody(html, bodyHtml);
    write('/platform/learn', html);
    marketingCount++;
  }

  // ── Sitemap: marketing entries (from public/sitemap.xml) + help URLs ──
  const srcSitemap = join(REPO, 'public', 'sitemap.xml');
  let marketing = '';
  if (existsSync(srcSitemap)) {
    const xml = readFileSync(srcSitemap, 'utf8');
    const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) || [];
    marketing = blocks.filter((b) => !b.includes('/platform/help')).join('\n');
  }
  const today = new Date().toISOString().slice(0, 10);
  const url = (loc, lastmod, priority, changefreq) =>
    `  <url>\n    <loc>${loc}</loc>\n`
    + (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : '')
    + (changefreq ? `    <changefreq>${changefreq}</changefreq>\n` : '')
    + (priority ? `    <priority>${priority}</priority>\n` : '')
    + '  </url>';
  const helpUrls = [
    url(`${SITE}/platform/help`, today, '0.8', 'weekly'),
    ...catsWithContent.map((c) => url(`${SITE}/platform/help/category/${c.id}`, today, '0.6', 'weekly')),
    ...pub.map((a) => url(`${SITE}/platform/help/${a.slug}`, a.updated || today, '0.7', 'monthly')),
  ].join('\n');
  const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + (marketing ? marketing + '\n' : '')
    + helpUrls + '\n'
    + '</urlset>\n';
  writeFileSync(join(DIST, 'sitemap.xml'), sitemap, 'utf8');

  console.log(`prerenderHelp: wrote ${count + marketingCount} static HTML pages (${pub.length} articles, ${catsWithContent.length} categories, 1 index, ${marketingCount} marketing).`);
  console.log(`prerenderHelp: sitemap.xml = ${(marketing.match(/<url>/g) || []).length} marketing + ${pub.length + catsWithContent.length + 1} help URLs.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
