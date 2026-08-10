// newsSeoRewrite — makes syndicated news posts INDEXABLE by giving each one
// an ORIGINAL write-up.
//
// Why: the news/shorts bots ingest publisher articles verbatim (title +
// first paragraphs in previewText). Google compares that text to the
// original publisher's page and refuses to index ours ("Duplicate, Google
// chose different canonical than user" — 1,449 pages in GSC 2026-07-16).
// No meta tag can fix a verbatim copy; the only path into the index is
// unique content. So: each news post gets a Gemini-written original
// summary/analysis (own words, added context, no copied phrasing) stored as
// `seoHeadline` + `seoText`. ugcRenderer serves THAT as the page article
// (with a citation link to the source) and indexes it; posts still waiting
// for a rewrite stay noindex until their rewrite lands.
//
// Cost: $0 — Gemini free tier (reuses GEMINI_POST_TEXT_KEY), NO polling and
// NO new Scheduler job (founder directive 2026-07-16: bots post when HE says
// so, don't poll). Two triggers only:
//   1. cronDaily, right after syncNewsBotFeeds/enrichNewsPosts — covers the
//      automatic daily bot posts (~54/day).
//   2. adminRewriteNewsSeo callable — "Run SEO rewrites" button on
//      /admin/bots, for after a manual "Run sync now" and for draining the
//      one-time backlog. Each call processes up to ~100 (paced to the
//      Gemini free-tier 15 RPM) and reports how many remain.
//
// Queue = `needsSeoRewrite: true` on the post doc (single-field where, no
// index). Ingestion stamps it on every new bot post; backfillNewsSeoQueue
// stamps the existing backlog once.
//
// Kill switch: app_config/general.newsSeoRewritePaused === true.
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { submitToIndexNow, postUrl } = require('./indexNow');

const db = getFirestore('vgrdb');

// Same secret contentAi.js uses for post-text scans (already deployed).
const GEMINI_POST_TEXT_KEY = defineSecret('GEMINI_POST_TEXT_KEY');
exports.GEMINI_POST_TEXT_KEY = GEMINI_POST_TEXT_KEY;

// Aliases, not pinned versions — pinned models get retired (see contentAi.js).
// flash-lite FIRST: each model has its OWN free-tier daily bucket, and
// flash-latest's is tiny (20 RPD — it 429'd the whole backlog run on
// 2026-07-16). flash-lite has real headroom and is plenty for a rewrite;
// flash-latest is the fallback for when lite's bucket runs out.
const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
const GEMINI_URL = (model, apiKey) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

const MAX_ATTEMPTS = 3;
// Gemini free tier is ~15 requests/min on flash-lite. 4.1s = 14.6/min sat right
// on that line and clipped it intermittently; 4.6s = 13/min leaves headroom.
const PACE_MS = 4600;
// A 429 is TWO different things: per-MINUTE throttling (transient, retry and it
// passes) or the per-DAY bucket being spent (rotate or stop). They are not
// distinguishable by status code alone, so treat a 429 as transient first and
// only rotate models after this many consecutive failures on one model.
// Getting this wrong is expensive in both directions: the original code rotated
// on the FIRST 429 and so mistook RPM throttling for an exhausted daily quota,
// which is what made a paced run look like it hit a hard ~500/day ceiling.
const RATE_LIMIT_RETRIES = 3;
const RETRY_BACKOFF_MS = [8000, 20000, 45000];

function rewritePrompt({ title, preview, sourceName }) {
  return `You are a gaming-news editor for VERGR, a competitive gaming platform. Below is a news item another outlet reported. Write an ORIGINAL news brief about it for VERGR's readers.

HARD RULES:
- Write ENTIRELY in your own words. Do not reuse sentences or distinctive phrasing from the input.
- Use ONLY facts present in the input. Do NOT invent names, dates, numbers, or quotes.
- Add value beyond the input: brief context and why it matters to gamers (general knowledge is fine, invented specifics are not).
- Body: 180-280 words, 2-4 short paragraphs, plain text (no markdown, no headings, no links).
- Headline: fresh wording (not the input title), under 90 characters, no clickbait.

INPUT TITLE: ${title}
INPUT SUMMARY: ${preview || '(none — write from the title only, keep it shorter, 120-180 words)'}
ORIGINALLY REPORTED BY: ${sourceName || 'another outlet'}

OUTPUT (strict JSON, no markdown fences):
{"headline": "...", "body": "..."}`;
}

// Pull Google's own RetryInfo out of a 429 body when present — it tells us how
// long to wait, which beats guessing.
function retryDelayMs(bodyText) {
  try {
    const details = JSON.parse(bodyText)?.error?.details || [];
    const info = details.find((d) => String(d['@type'] || '').includes('RetryInfo'));
    const m = /^(\d+(?:\.\d+)?)s$/.exec(info?.retryDelay || '');
    return m ? Math.ceil(parseFloat(m[1]) * 1000) : null;
  } catch { return null; }
}

async function callGeminiRewrite(input, apiKey, modelIdx = 0, rateTry = 0) {
  const model = GEMINI_MODELS[modelIdx];
  const mkBody = (withThinkingOff) => JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: rewritePrompt(input) }] }],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0.7,
      // These are THINKING models: reasoning tokens count against the output
      // budget, so 900 truncated the JSON mid-body (failed=16 run,
      // 2026-07-16). Disable thinking (rewrites don't need it) and leave
      // generous headroom.
      max_output_tokens: 4096,
      ...(withThinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  });
  let res = await fetch(GEMINI_URL(model, apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: mkBody(true),
  });
  // If a future model/alias rejects thinkingConfig, retry once without it
  // rather than bricking every call on a 400.
  if (res.status === 400) {
    res = await fetch(GEMINI_URL(model, apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: mkBody(false),
    });
  }
  // 429: assume per-MINUTE throttling first and wait it out on the SAME model.
  // Only after RATE_LIMIT_RETRIES consecutive failures do we treat this model's
  // daily bucket as spent and move to the next (each model has its own bucket).
  // Rotating on the first 429 — what this used to do — silently converts a
  // transient rate limit into "the free tier is exhausted".
  if (res.status === 429) {
    const body = await res.text();
    if (rateTry < RATE_LIMIT_RETRIES) {
      const wait = retryDelayMs(body) || RETRY_BACKOFF_MS[rateTry] || 45000;
      console.log(`[rewriteNewsForSeo] ${model} 429 (try ${rateTry + 1}/${RATE_LIMIT_RETRIES}), waiting ${wait}ms`);
      await sleep(wait);
      return callGeminiRewrite(input, apiKey, modelIdx, rateTry + 1);
    }
    if (modelIdx < GEMINI_MODELS.length - 1) {
      console.log(`[rewriteNewsForSeo] ${model} still 429 after ${RATE_LIMIT_RETRIES} retries — likely daily bucket spent, trying ${GEMINI_MODELS[modelIdx + 1]}`);
      return callGeminiRewrite(input, apiKey, modelIdx + 1, 0);
    }
    const err = new Error(`Gemini 429 on all models: ${body.slice(0, 160)}`);
    err.status = 429;
    throw err;
  }
  if (!res.ok) {
    const t = await res.text();
    const err = new Error(`Gemini HTTP ${res.status} (${model}): ${t.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const cand = json?.candidates?.[0];
  // A thinking model can emit a thought part before the answer part —
  // take the last text part, not the first.
  const parts = cand?.content?.parts || [];
  const raw = [...parts].reverse().find((p) => typeof p.text === 'string')?.text || '';
  let out;
  try { out = JSON.parse(raw); } catch {
    console.warn(`[rewriteNewsForSeo] reject: unparseable (finish=${cand?.finishReason}) ${raw.slice(0, 120)}`);
    return null;
  }
  const headline = (out?.headline || '').trim();
  const body = (out?.body || '').trim();
  // Reject junk: too short to be a real article, or headline missing.
  if (!headline || headline.length < 15 || body.length < 400) {
    console.warn(`[rewriteNewsForSeo] reject: thin (finish=${cand?.finishReason}, h=${headline.length}, b=${body.length})`);
    return null;
  }
  return { headline: headline.slice(0, 140), body };
}

function sourceNameFromUrl(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function queueRemaining() {
  try {
    const agg = await db.collection('posts').where('needsSeoRewrite', '==', true).count().get();
    return agg.data().count;
  } catch { return null; }
}

// Core worker: processes up to maxCount queued posts, paced to the free-tier
// rate limit. Self-gates (one cheap query when the queue is empty).
async function rewriteBatch(maxCount) {
  const cfg = await db.collection('app_config').doc('general').get();
  if (cfg.exists && cfg.data()?.newsSeoRewritePaused === true) {
    console.log('[rewriteNewsForSeo] PAUSED via app_config.newsSeoRewritePaused');
    return { rewritten: 0, failed: 0, paused: true };
  }
  const snap = await db.collection('posts')
    .where('needsSeoRewrite', '==', true).limit(maxCount).get();
  if (snap.empty) return { rewritten: 0, failed: 0, empty: true };

  const apiKey = GEMINI_POST_TEXT_KEY.value();
  if (!apiKey || apiKey === 'placeholder') {
    console.warn('[rewriteNewsForSeo] GEMINI_POST_TEXT_KEY not configured — skipping');
    return { rewritten: 0, failed: 0, unconfigured: true };
  }

  // Hard deadline: both callers run inside a 540s function. Backoff sleeps on a
  // throttled 429 can add ~70s to a single post, so a fixed count × pace no
  // longer predicts runtime — stop cleanly and report instead of being killed
  // mid-write (the queue keeps whatever is left, so this is safe to resume).
  const deadline = Date.now() + 480_000;
  let done = 0, failed = 0, stopped = null;
  // A syndicated post is served noindex until its rewrite exists, so the
  // write below is the exact moment its URL becomes indexable — that's when
  // IndexNow should hear about it. Collected and pushed once per run.
  const freshUrls = [];
  for (let i = 0; i < snap.docs.length; i++) {
    if (Date.now() > deadline) {
      stopped = 'time budget reached — click again to continue';
      break;
    }
    const d = snap.docs[i];
    const p = d.data();
    const title = (p.content || '').trim();
    const preview = (p.previewText || '').trim();
    const attempts = (p.seoRewriteAttempts || 0) + 1;
    try {
      const out = await callGeminiRewrite({
        title: title || (p.slug || d.id).replace(/-/g, ' '),
        preview: preview !== title ? preview.slice(0, 2000) : '',
        sourceName: sourceNameFromUrl(p.sourceUrl),
      }, apiKey);
      if (out) {
        await d.ref.update({
          seoHeadline: out.headline,
          seoText: out.body,
          seoRewrittenAt: FieldValue.serverTimestamp(),
          needsSeoRewrite: false,
        });
        done++;
        freshUrls.push(postUrl(d.id, p));
      } else if (attempts >= MAX_ATTEMPTS) {
        // Give up: post stays noindexed (it was never indexable as a copy).
        await d.ref.update({ needsSeoRewrite: false, seoRewriteAttempts: attempts });
        failed++;
      } else {
        await d.ref.update({ seoRewriteAttempts: attempts });
        failed++;
      }
    } catch (e) {
      // Rate limit / transient: stop this run, the queue keeps the rest.
      stopped = e.message;
      console.warn(`[rewriteNewsForSeo] stopping run: ${e.message}`);
      break;
    }
    if (i < snap.docs.length - 1) await sleep(PACE_MS);
  }
  if (done || failed) console.log(`[rewriteNewsForSeo] rewritten=${done} failed=${failed}`);
  // Fire-and-forget: the rewrites are already committed, so a ping failure
  // must never turn a successful run into a failed one.
  if (freshUrls.length) {
    await submitToIndexNow(freshUrls).catch((e) => console.warn('[rewriteNewsForSeo] indexnow', e.message));
  }
  return { rewritten: done, failed, stopped };
}

// cronDaily hook — runs right after syncNewsBotFeeds/enrichNewsPosts so the
// day's automatic bot posts get their rewrite in the same daily pass.
// 55 × 4.1s ≈ 4 min inside cronDaily's 540s budget.
exports.rewriteNewsForSeo = () => rewriteBatch(55);

// Admin button on /admin/bots — run rewrites NOW (after a manual bot sync,
// or to drain the backlog). Processes up to 100/call (~7 min paced); the
// response tells the founder how many are left so he can click again.
exports.adminRewriteNewsSeo = onCall(
  { region: 'europe-west1', timeoutSeconds: 540, secrets: [GEMINI_POST_TEXT_KEY] },
  async (request) => {
    const { requireAdmin } = require('./adminSecurity');
    await requireAdmin(request.auth?.uid);
    const limit = Math.max(1, Math.min(Number(request.data?.limit) || 100, 100));
    const result = await rewriteBatch(limit);
    if (result.unconfigured) throw new HttpsError('failed-precondition', 'Gemini key not configured');
    const remaining = await queueRemaining();
    return { ok: true, ...result, remaining };
  },
);

// One-time backlog stamp: flag every syndicated post that has no rewrite
// yet. Idempotent; safe to re-run. Paginates the full posts collection.
exports.backfillNewsSeoQueue = onRequest({ region: 'europe-west1', timeoutSeconds: 540 }, async (req, res) => {
  let flagged = 0, scanned = 0, cursor = null;
  for (;;) {
    let q = db.collection('posts').where('isNewsPost', '==', true)
      .orderBy('__name__').limit(400);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const d of snap.docs) {
      scanned++;
      const p = d.data();
      if (!p.seoText && p.needsSeoRewrite !== true) {
        batch.update(d.ref, { needsSeoRewrite: true });
        flagged++;
      }
    }
    await batch.commit();
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < 400) break;
  }
  res.status(200).json({ scanned, flagged });
});
