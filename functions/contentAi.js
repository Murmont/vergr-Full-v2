// Content moderation orchestrator (Phase 2 — trimmed for 18+ adult platform).
//
// 4 surfaces, all powered by a single Gemini API key:
//   1. moderateChatMessage     — callable. PUBLIC chat only (live-stream chat,
//                                tournament spectator chat, public tip messages)
//                                before a message is shown to others.
//                                PRIVATE communication — 1:1 DMs and group/squad
//                                chats — is NEVER moderated and NEVER sent to
//                                Gemini (founder policy 2026-05-28). Private
//                                surfaces are hard-rejected below; do not wire
//                                this callable into any DM/group/squad send path.
//   2. moderatePostText        — Firestore trigger on post create. Scans body
//                                text for CSAM language, doxxing (phone /
//                                address / real-name leak), scam links.
//   3. moderatePostMedia       — same trigger. Scans attached images / clip
//                                keyframes for CSAM + nudity.
//
// Scope (per founder direction 2026-05-16):
//   - CSAM / underage: ZERO TOLERANCE, mandatory by law, auto-hide + alert
//   - Nudity (images/video): platform policy = NOT ALLOWED on the 18+ tier
//   - Doxxing (chat/text): auto-hide + mod review
//   - Scam links / off-platform sales: auto-hide + mod review
//   - General rudeness / mild harassment: NOT scanned — reports + mods handle
//
// Verdict format on every scan:
//   { verdict: 'pass' | 'flag' | 'block', category: string, confidence: 0-1, reason }
//   - 'pass'  → content stays visible
//   - 'flag'  → content stays visible BUT mod queue entry written (review later)
//   - 'block' → content auto-hidden, creator notified, mod queue entry written

const functions = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');

// Four separate Gemini API keys — one per surface so each shows separate
// usage + cost in the Google Cloud Console. Routes:
//   GEMINI_CHAT_KEY        → chat message moderation
//   GEMINI_POST_TEXT_KEY   → post body text scan
//   GEMINI_POST_IMAGE_KEY  → attached image scan
//   GEMINI_POST_VIDEO_KEY  → video thumbnail / frame scan
const GEMINI_CHAT_KEY       = defineSecret('GEMINI_CHAT_KEY');
const GEMINI_POST_TEXT_KEY  = defineSecret('GEMINI_POST_TEXT_KEY');
const GEMINI_POST_IMAGE_KEY = defineSecret('GEMINI_POST_IMAGE_KEY');
const GEMINI_POST_VIDEO_KEY = defineSecret('GEMINI_POST_VIDEO_KEY');
const LIBRETRANSLATE_KEY    = defineSecret('LIBRETRANSLATE_KEY');
const LT_BASE = process.env.LIBRETRANSLATE_BASE || 'https://archive.vergr.app/lt';

const DB = 'vgrdb';
const REGION = 'europe-west1';

// Detect the language of a post body via the self-hosted LibreTranslate box and
// stamp `posts/{id}.lang` so the client only offers "Translate" when the post is
// NOT already in the viewer's language. Best-effort + non-blocking.
async function detectAndStampPostLang(db, postId, text, key) {
  const body = String(text || '').trim().slice(0, 800);
  if (body.length < 8) return;
  try {
    const res = await fetch(`${LT_BASE}/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vergr-LT-Key': key },
      body: JSON.stringify({ q: body }),
    });
    if (!res.ok) return;
    const arr = await res.json();
    const top = Array.isArray(arr) ? arr[0] : null;
    if (top && top.language && (top.confidence ?? 0) >= 50) {
      await db.collection('posts').doc(postId).set({ lang: top.language }, { merge: true });
    }
  } catch (_) { /* non-fatal */ }
}
const HttpsError = functions.https.HttpsError;

// Gemini Flash is the right tier for moderation: cheap, fast (<800ms p95),
// good policy classification. We use the multimodal model for everything so
// the same call handles text + images + video frames.
// 'gemini-flash-latest' alias, NOT a pinned version: pinned models get
// retired (1.5-* now 404, 2.0-flash free tier zeroed 2026-07) and every
// hardcoded one silently killed its feature. The alias tracks the current
// stable flash so this can't rot again.
const GEMINI_MODEL = 'gemini-flash-latest';
const GEMINI_URL = (apiKey) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

// ─────────────────────────────────────────────────────────────
// Prompts — locked, returns strict JSON
// ─────────────────────────────────────────────────────────────
const COMMON_INSTRUCTIONS = `You are a content-moderation classifier for VERGR, an 18+ gaming platform. Your job is to detect ONLY these red-line violations and pass everything else through.

RED LINES:
- CSAM (any sexual content involving anyone who appears under 18) — ZERO TOLERANCE
- NUDITY (exposed genitalia, female nipples, sexually explicit poses) — platform policy
- DOXXING (personal identifying info: phone numbers, home addresses, full real names without consent)
- SCAMS (off-platform sales links: boosting services, account selling, real-money trading, "DM me" recruiting)
- REAL-WORLD GRAPHIC VIOLENCE (actual footage or images of gore, mutilation, killing, torture, execution, serious injury, suicide, or animal cruelty involving REAL people or REAL animals). This is about REAL life only. Video game violence is NOT this, no matter how bloody or realistic the graphics are — when in doubt whether footage is a game or reality, treat it as a game and pass.

DO NOT FLAG:
- Rude language, swearing, banter — adults can swear
- Disagreements, criticism of the platform or other users
- Bloody / violent video game content — it's a gaming platform, gore in games is fine
- Game cinematics, trailers and screenshots however realistic
- Sports injuries, stunts and fails that are not graphic
- Suggestive but non-explicit content
- Crypto / gambling content if not actively soliciting off-platform

OUTPUT (strict JSON, no markdown):
{
  "verdict": "pass" | "flag" | "block",
  "category": "csam" | "nudity" | "doxxing" | "scam" | "graphic_violence" | "none",
  "confidence": 0.0 to 1.0,
  "reason": "one short sentence explaining what you saw"
}

VERDICT RULES:
- "block" when confidence >= 0.85 on a red-line violation → content auto-hidden
- "flag" when confidence 0.50-0.84 OR ambiguous → content visible, mod reviews
- "pass" for everything else
- For CSAM: ANY suspicion (confidence >= 0.30) is "block" — fail-safe`;

function textPrompt(text) {
  return `${COMMON_INSTRUCTIONS}

Analyze this message text:
"""
${text}
"""`;
}

function imagePromptText() {
  return `${COMMON_INSTRUCTIONS}

Analyze this image for the red-line categories. Game-art, screenshots, memes are allowed, including violent ones. Real-world nudity, sexually explicit drawings, or any underage subject = "block". Real-world graphic violence (photographs of actual gore, mutilation, corpses, torture or animal cruelty) = "block"; in-game gore = "pass".`;
}

function videoFramesPromptText() {
  return `${COMMON_INSTRUCTIONS}

Analyze these video frames (sampled from a user-uploaded clip). Game footage is allowed however violent. Real-world nudity or CSAM in any frame = "block". Real-world graphic violence (actual gore, killing, torture, serious injury or animal cruelty filmed in real life) in any frame = "block". If the frames are ambiguous between gameplay and reality, treat them as gameplay and "pass" — a false block on a clip is worse than a missed edge case a human can report.`;
}

// ─────────────────────────────────────────────────────────────
// Gemini call helpers
// ─────────────────────────────────────────────────────────────
async function callGemini(parts, apiKeyParam) {
  const apiKey = apiKeyParam?.value?.() || apiKeyParam;
  if (!apiKey) {
    return { ok: false, error: 'Gemini API key not configured for this surface' };
  }
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0.1,
      max_output_tokens: 256,
    },
    safetySettings: [
      // We want to RECEIVE harmful content so the classifier can analyze it.
      // Block-none is intentional — we're the classifier, not the consumer.
      { category: 'HARM_CATEGORY_HARASSMENT',       threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',      threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  };
  try {
    const res = await fetch(GEMINI_URL(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text();
      return { ok: false, error: `Gemini HTTP ${res.status}: ${errBody.slice(0, 200)}` };
    }
    const json = await res.json();
    const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let verdict;
    try { verdict = JSON.parse(raw); } catch { verdict = { verdict: 'pass', category: 'none', confidence: 0, reason: 'parse error' }; }
    return { ok: true, verdict, raw };
  } catch (e) {
    return { ok: false, error: e?.message || 'network' };
  }
}

async function scanText(text, apiKey) {
  if (!text || text.length < 3) return { verdict: 'pass', category: 'none', confidence: 1, reason: 'empty' };
  const r = await callGemini([{ text: textPrompt(text) }], apiKey);
  if (!r.ok) return { verdict: 'pass', category: 'none', confidence: 0, reason: `gemini err: ${r.error}`, _error: true };
  return r.verdict;
}

async function scanImage(imageUrl, apiKey) {
  // Fetch the image, send to Gemini as inline data (Gemini Flash supports
  // up to ~20MB inline; for larger files we'd switch to the Files API).
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return { verdict: 'pass', category: 'none', confidence: 0, reason: 'fetch fail', _error: true };
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length > 18 * 1024 * 1024) return { verdict: 'flag', category: 'none', confidence: 0, reason: 'image too large to scan (>18MB)' };
    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
    const r = await callGemini([
      { text: imagePromptText() },
      { inline_data: { mime_type: mimeType, data: buf.toString('base64') } },
    ], apiKey);
    if (!r.ok) return { verdict: 'pass', category: 'none', confidence: 0, reason: `gemini err: ${r.error}`, _error: true };
    return r.verdict;
  } catch (e) {
    return { verdict: 'pass', category: 'none', confidence: 0, reason: e?.message || 'image scan failed', _error: true };
  }
}

// Video thumbnail scan — uses the dedicated VIDEO key (not IMAGE) so video
// costs are tracked separately. Real frame extraction (3-keyframe sample)
// lands when the Hetzner OCR service is built; for now we scan the thumbnail.
async function scanVideoThumbnail(thumbnailUrl, apiKey) {
  try {
    const imgRes = await fetch(thumbnailUrl);
    if (!imgRes.ok) return { verdict: 'pass', category: 'none', confidence: 0, reason: 'fetch fail', _error: true };
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length > 18 * 1024 * 1024) return { verdict: 'flag', category: 'none', confidence: 0, reason: 'thumbnail too large' };
    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
    const r = await callGemini([
      { text: videoFramesPromptText() },
      { inline_data: { mime_type: mimeType, data: buf.toString('base64') } },
    ], apiKey);
    if (!r.ok) return { verdict: 'pass', category: 'none', confidence: 0, reason: `gemini err: ${r.error}`, _error: true };
    return r.verdict;
  } catch (e) {
    return { verdict: 'pass', category: 'none', confidence: 0, reason: e?.message || 'video thumb scan failed', _error: true };
  }
}

// ─────────────────────────────────────────────────────────────
// 1. Chat message moderation — callable
//    Chat producer (live-stream chat / squad chat / DM) calls this BEFORE
//    showing the message. Returns within ~800ms.
// ─────────────────────────────────────────────────────────────
exports.moderateChatMessage = functions.https.onCall(
  { region: REGION, secrets: [GEMINI_CHAT_KEY] },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;
    const { text, surface = 'unknown', surfaceId = null } = req.data || {};
    if (typeof text !== 'string') throw new HttpsError('invalid-argument', 'text required.');
    if (text.length > 2000) throw new HttpsError('invalid-argument', 'message too long.');

    // Private communication is never scanned. 1:1 DMs and group/squad chats must
    // not reach Gemini (founder policy 2026-05-28). Return pass WITHOUT calling
    // Gemini or logging any text, so a future mis-wire still can't leak content.
    const PRIVATE_SURFACES = new Set([
      'dm', 'direct', 'direct_message', 'conversation', 'inbox',
      'squad', 'squad_chat', 'group', 'group_chat', 'private',
    ]);
    if (PRIVATE_SURFACES.has(String(surface).toLowerCase())) {
      return { verdict: 'pass', skipped: 'private_surface' };
    }

    const verdict = await scanText(text, GEMINI_CHAT_KEY);

    // Audit + mod queue write for any non-pass verdict.
    if (verdict.verdict !== 'pass') {
      const db = admin.firestore(undefined, DB);
      await db.collection('content_moderation_log').add({
        kind: 'chat',
        surface,
        surfaceId,
        senderId: uid,
        textPreview: text.slice(0, 200),
        verdict: verdict.verdict,
        category: verdict.category,
        confidence: verdict.confidence,
        reason: verdict.reason,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    return verdict;
  }
);

// ─────────────────────────────────────────────────────────────
// 2 + 3. Post moderation — Firestore trigger on post create
//    Scans body text + each attached image + clip thumbnail. Verdict 'block'
//    on ANY of them auto-hides the entire post.
// ─────────────────────────────────────────────────────────────
exports.moderateNewPost = functions.firestore.onDocumentCreated(
  { document: 'posts/{postId}', region: REGION, database: DB, secrets: [GEMINI_POST_TEXT_KEY, GEMINI_POST_IMAGE_KEY, GEMINI_POST_VIDEO_KEY, LIBRETRANSLATE_KEY] },
  async (event) => {
    const post = event.data?.data();
    if (!post) return;
    const postId = event.params.postId;
    const db = admin.firestore(undefined, DB);

    // Stamp the post's source language for translate-gating (non-blocking).
    const langText = [post.content, post.text, post.caption, post.title].filter(Boolean).join('\n');
    await detectAndStampPostLang(db, postId, langText, LIBRETRANSLATE_KEY.value());

    const scans = [];
    const bodyText = [post.content, post.text, post.caption, post.title].filter(Boolean).join('\n');
    if (bodyText) scans.push(scanText(bodyText, GEMINI_POST_TEXT_KEY).then((v) => ({ ...v, _subject: 'text' })));

    // Image attachments — handle common field names.
    const imageUrls = []
      .concat(post.imageUrl || [])
      .concat(post.images || [])
      .concat(post.media?.filter?.((m) => m.type === 'image').map((m) => m.url) || []);
    for (const url of imageUrls) {
      scans.push(scanImage(url, GEMINI_POST_IMAGE_KEY).then((v) => ({ ...v, _subject: 'image', _url: url })));
    }

    // Clip / video — scan thumbnail (real frame extraction lands in Phase 1B).
    if (post.thumbnailUrl) {
      scans.push(scanVideoThumbnail(post.thumbnailUrl, GEMINI_POST_VIDEO_KEY).then((v) => ({ ...v, _subject: 'video_thumb', _url: post.thumbnailUrl })));
    }

    if (scans.length === 0) return;

    const results = await Promise.all(scans);
    const blocks = results.filter((r) => r.verdict === 'block');
    const flags = results.filter((r) => r.verdict === 'flag');
    const overall = blocks.length > 0 ? 'block' : flags.length > 0 ? 'flag' : 'pass';

    // Always log a moderation row for the post (pass too — useful for audits + AI accuracy tracking).
    await db.collection('content_moderation_log').add({
      kind: 'post',
      surface: 'feed',
      surfaceId: postId,
      senderId: post.userId || post.authorId,
      textPreview: bodyText.slice(0, 200),
      verdict: overall,
      results,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (overall === 'block') {
      // Auto-hide the post immediately + notify creator.
      await db.collection('posts').doc(postId).update({
        hidden: true,
        hiddenReason: 'ai_moderation',
        hiddenAt: FieldValue.serverTimestamp(),
        aiVerdict: { overall, results },
      });
      const creatorId = post.userId || post.authorId;
      if (creatorId) {
        await db.collection('notifications').add({
          recipientId: creatorId,
          type: 'post_auto_hidden',
          title: 'Post hidden by AI review',
          body: 'Your post was hidden because the AI detected a possible policy violation. A moderator will review it. Only you can see it now. Open the post to appeal.',
          link: `/post/${postId}`,
          createdAt: FieldValue.serverTimestamp(),
          read: false,
        });
      }
    } else if (overall === 'flag') {
      // Visible, but mod review queued.
      await db.collection('posts').doc(postId).update({
        moderationStatus: 'pending_review',
        aiVerdict: { overall, results },
      });
    }
  }
);

// ─────────────────────────────────────────────────────────────
// 4. Manual re-scan callable for mods + appeal flow
// ─────────────────────────────────────────────────────────────
exports.rescanPost = functions.https.onCall(
  { region: REGION, secrets: [GEMINI_POST_TEXT_KEY, GEMINI_POST_IMAGE_KEY, GEMINI_POST_VIDEO_KEY] },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const { postId } = req.data || {};
    if (!postId) throw new HttpsError('invalid-argument', 'postId required.');
    const db = admin.firestore(undefined, DB);
    const callerSnap = await db.collection('users').doc(req.auth.uid).get();
    const u = callerSnap.data() || {};
    const isAdmin = u.role === 'admin';
    const isMod = !!(u.vanguard?.rank && u.vanguard?.status === 'active' && u.vanguard.rank !== 'recruit');
    if (!isAdmin && !isMod) throw new HttpsError('permission-denied', 'Mod / admin only.');

    const postSnap = await db.collection('posts').doc(postId).get();
    if (!postSnap.exists) throw new HttpsError('not-found', 'Post not found.');
    // Re-trigger by emitting an artificial doc-create event would be wrong;
    // instead just run the same logic inline.
    const post = postSnap.data();
    const scans = [];
    const bodyText = [post.text, post.caption, post.title].filter(Boolean).join('\n');
    if (bodyText) scans.push(scanText(bodyText, GEMINI_POST_TEXT_KEY).then((v) => ({ ...v, _subject: 'text' })));
    const imageUrls = []
      .concat(post.imageUrl || [])
      .concat(post.images || [])
      .concat(post.media?.filter?.((m) => m.type === 'image').map((m) => m.url) || []);
    for (const url of imageUrls) scans.push(scanImage(url, GEMINI_POST_IMAGE_KEY).then((v) => ({ ...v, _subject: 'image', _url: url })));
    if (post.thumbnailUrl) scans.push(scanVideoThumbnail(post.thumbnailUrl, GEMINI_POST_VIDEO_KEY).then((v) => ({ ...v, _subject: 'video_thumb' })));
    const results = await Promise.all(scans);
    const blocks = results.filter((r) => r.verdict === 'block');
    const overall = blocks.length > 0 ? 'block' : results.some((r) => r.verdict === 'flag') ? 'flag' : 'pass';
    await db.collection('posts').doc(postId).update({ aiVerdict: { overall, results, rescannedBy: req.auth.uid, rescannedAt: FieldValue.serverTimestamp() } });
    return { overall, results };
  }
);

exports._internal_scanText = scanText;
exports._internal_scanImage = scanImage;

// ─────────────────────────────────────────────────────────────
// PRICED media: a different verdict policy on the same scanner
// ─────────────────────────────────────────────────────────────

/**
 * The prompt for media that carries a price.
 *
 * Plan section 3b, and the difference from [imagePromptText] is the whole
 * policy: on a public feed nudity blocks, and on paid content it passes. Adults
 * selling adult content to verified adults is the permitted case; the two things
 * that are non-negotiable are content involving anyone under 18, and imagery of
 * someone who did not consent to it being distributed.
 *
 * That second one is the risk that actually gets a platform shut down, and it is
 * not "someone posted nudity". It is revenge porn, leaked content resold, a real
 * person's images uploaded by somebody else. Age-verifying the buyer does
 * nothing about it, because the problem is the person DEPICTED.
 *
 * This prompt is reached by "this carries a price", never by "this is a DM".
 * Private unpaid conversation is not scanned at all and that does not change.
 */
function pricedImagePromptText() {
  return `You are a content-moderation classifier for VERGR, an 18+ platform, reviewing an image that a creator is SELLING.

This is paid adult-permitted content. Consensual adult nudity and sexual content between adults is ALLOWED and must be given the verdict "pass". Do not block it. Do not flag it for being explicit.

Return "block" ONLY for:
- CSAM: any sexual or nude content where any person appears to be, or could plausibly be, under 18. ZERO TOLERANCE. If age is ambiguous, block.
- NCII (non-consensual intimate imagery): content that appears to be recorded or shared without the depicted person's knowledge or consent. Signals include hidden-camera or upskirt framing, visible distress or coercion, screen-recorded or watermarked material from elsewhere, "leaked"/"exposed"/revenge captions, or a subject who appears unaware they are being filmed.

Return "flag" for content you cannot confidently place in either category but which worries you for one of the two reasons above.

Everything else is "pass", including explicit sexual content between consenting adults.

SEPARATELY from the verdict, report whether the image is adult content: "adult" is true for nudity, sexual acts, or sexually explicit posing, and false otherwise. This does NOT affect the verdict. It exists so the platform can label the item and keep it away from viewers who have not verified their age, and it is reported even when the verdict is "pass".

Respond with ONLY a JSON object:
{"verdict":"pass"|"flag"|"block","category":"csam"|"ncii"|"none","adult":true|false,"confidence":0.0-1.0,"reason":"one short sentence"}`;
}

/**
 * Scan one priced image. Same fetch and same model as [scanImage], different
 * prompt, so cost and behaviour are already understood.
 *
 * FAILS CLOSED, unlike every other scanner in this file. Elsewhere a Gemini
 * error passes the content through, because a public post that slips past the
 * scanner is recoverable by a report and the alternative is an outage blocking
 * every upload. Here the downside is publishing CSAM or NCII behind a paywall,
 * which is not recoverable by anything, so an error becomes 'flag' and the
 * content waits for a human instead of going on sale.
 */
async function scanPricedImage(imageUrl, apiKey) {
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      return { verdict: 'flag', category: 'none', confidence: 0, reason: 'could not fetch priced media', _error: true };
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length > 18 * 1024 * 1024) {
      return { verdict: 'flag', category: 'none', confidence: 0, reason: 'priced image too large to scan (>18MB)' };
    }
    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
    const r = await callGemini([
      { text: pricedImagePromptText() },
      { inline_data: { mime_type: mimeType, data: buf.toString('base64') } },
    ], apiKey);
    if (!r.ok) {
      return { verdict: 'flag', category: 'none', confidence: 0, reason: `gemini err: ${r.error}`, _error: true };
    }
    return r.verdict;
  } catch (e) {
    return { verdict: 'flag', category: 'none', confidence: 0, reason: e?.message || 'priced scan failed', _error: true };
  }
}

exports.scanPricedImage = scanPricedImage;
