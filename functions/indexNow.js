// IndexNow — push new/updated URLs to Bing, Yandex, Naver, Seznam (and any
// other participating engine) the moment they become indexable, instead of
// waiting for a sitemap recrawl.
//
// Google does NOT participate in IndexNow. Google discovery still relies on
// the sitemaps + recrawl; this is purely the Bing-family fast path. Do not
// remove the sitemap work on the assumption this replaces it.
//
// THE KEY IS PUBLIC BY DESIGN, not a leaked secret: the protocol verifies
// domain ownership by requiring the same key to be readable at
// https://vergr.app/<key>.txt. That file lives in public/ and ships with
// hosting. If the key file 404s, every submission returns 403 — so the file
// and this constant MUST be changed together.
const { onRequest } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');
const { canonicalPostUrl } = require('./seoUrls');

const db = getFirestore('vgrdb');

const HOST = 'vergr.app';
const KEY = '1b405a5f5d334c838cdcc504eae82bb5';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const ENDPOINT = 'https://api.indexnow.org/IndexNow';

// Protocol cap is 10,000 URLs per request.
const MAX_PER_REQUEST = 10000;

/**
 * Submit URLs to IndexNow. Never throws — a failed submission must never
 * break the caller (these are all fire-and-forget side effects of work that
 * has already been committed).
 *
 * @param {string[]} urls absolute https://vergr.app/... URLs
 * @returns {Promise<{submitted:number, batches:number, errors:string[]}>}
 */
async function submitToIndexNow(urls) {
  const clean = [...new Set((urls || []).filter(
    (u) => typeof u === 'string' && u.startsWith(`https://${HOST}/`),
  ))];
  if (!clean.length) return { submitted: 0, batches: 0, errors: [] };

  const errors = [];
  let submitted = 0;
  let batches = 0;

  for (let i = 0; i < clean.length; i += MAX_PER_REQUEST) {
    const urlList = clean.slice(i, i + MAX_PER_REQUEST);
    batches++;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
      });
      // 200 = accepted, 202 = accepted pending key validation. Both are wins.
      if (res.ok || res.status === 202) {
        submitted += urlList.length;
      } else {
        // 403 = key file unreachable/mismatched; 422 = host mismatch;
        // 429 = throttled. All are actionable, so surface the code.
        const body = await res.text().catch(() => '');
        errors.push(`HTTP ${res.status} ${body.slice(0, 200)}`);
      }
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (errors.length) console.warn('[indexNow] submit errors:', errors.join(' | '));
  else console.log(`[indexNow] submitted ${submitted} url(s) in ${batches} batch(es)`);
  return { submitted, batches, errors };
}

/** Canonical public URL for a post doc (mirrors the sitemap's rule). */
// Submitting a non-canonical alias is asking Google/Bing to index a duplicate,
// so this MUST be the same URL the page declares as its canonical.
const postUrl = (id, data) => canonicalPostUrl(id, data);

/**
 * One-time / on-demand: push every currently indexable post to IndexNow.
 * Same filters as the sitemap, so a URL that would render noindex is never
 * submitted (submitting noindex URLs is how a host gets rate-limited).
 */
exports.indexNowBacklog = onRequest({ region: 'europe-west1', timeoutSeconds: 540 }, async (req, res) => {
  const urls = [];
  let cursor = null;
  let scanned = 0;
  for (;;) {
    let q = db.collection('posts').orderBy('__name__').limit(500);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      scanned++;
      const p = d.data();
      if ((p.status || 'published') !== 'published') continue;
      if ((p.visibility || 'public') !== 'public' || p.hidden === true) continue;
      const text = (p.content || '').trim();
      const media = Array.isArray(p.mediaUrls) ? p.mediaUrls : (p.mediaUrl ? [p.mediaUrl] : []);
      if (text.length < 30 && media.length === 0) continue;
      // Syndicated posts are noindex and are not in the sitemap either.
      if ((p.isNewsPost === true || p.sourceUrl) && !((p.seoText || '').length >= 400)) continue;
      urls.push(postUrl(d.id, p));
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < 500) break;
  }
  const out = await submitToIndexNow(urls);
  res.status(200).json({ scanned, eligible: urls.length, ...out });
});

module.exports.submitToIndexNow = submitToIndexNow;
module.exports.postUrl = postUrl;
module.exports.indexNowBacklog = exports.indexNowBacklog;
