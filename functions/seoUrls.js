// THE single source of truth for a post's canonical URL.
//
// Why this module exists: a post is reachable at up to FOUR URLs — /post and
// /clip, each by doc id OR by the SEO `slug` field — and ugcRenderer's
// renderPost resolves every one of them to the SAME html. The canonical used
// to be derived from the REQUESTED route, so all four self-canonicalised and
// Google filed three of every four as "Duplicate, Google chose different
// canonical than user". That bucket kept climbing after the news-SEO rewrite
// landed, because the rewrite fixed publisher-vs-us duplication while this is
// us-vs-us duplication — a separate axis entirely.
//
// The formula was ALSO copy-pasted into the sitemap and IndexNow. Three copies
// of a URL rule is how they drift, and a sitemap URL that is not the declared
// canonical is a self-inflicted duplicate. So every producer now calls this.
//
// If you change this, every already-indexed URL changes with it — the old
// forms keep resolving (renderPost accepts them all), but Google has to
// reconsolidate, so do not churn it casually.

const SITE = 'https://vergr.app';

// isVideo must match renderSitemapPosts' old inline test exactly. Note it does
// NOT consider post.videoUrl: renderPost has a broader isVideo for choosing
// og:type/schema, but a broader test HERE would move existing /post/ URLs to
// /clip/ and invalidate what is already indexed.
function canonicalPostPath(docId, post) {
  const isVideo = post.type === 'clip' || post.type === 'short';
  return `/${isVideo ? 'clip' : 'post'}/${post.slug || docId}`;
}

function canonicalPostUrl(docId, post) {
  return `${SITE}${canonicalPostPath(docId, post)}`;
}

// Same problem, profile edition: a profile answers on /u/{username} AND
// /user/{uid}, and /u/ is matched case-insensitively via the lowercased
// `usernames` index, so /u/ign and /u/IGN both resolve too. /u/{username} is
// the public form and the one renderSitemapUsers emits, so it is the canonical.
// Uses the STORED casing (what the sitemap emits), not the lowercased lookup
// key, or the canonical and the sitemap would disagree.
// Returns null when there is no username to build one from — the caller then
// falls back to the requested route (those profiles render noindex anyway,
// since `index` in renderUser requires a username).
function canonicalUserUrl(username) {
  return username ? `${SITE}/u/${username}` : null;
}

module.exports = { SITE, canonicalPostPath, canonicalPostUrl, canonicalUserUrl };
