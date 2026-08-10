// translateContent — on-demand translation via the self-hosted LibreTranslate
// box (box 2, reached through archive.vergr.app/lt over the private net,
// secret-header gated). Zero per-call cost.
//
// Gating (founder, 2026-06-07):
//   kind 'post' | 'comment'  → free for everyone (the parity/growth hook).
//   kind 'message'           → caller must be Lite/Pro (DM / group / squad chat).
//   kind 'streamchat'        → the STREAM HOST's plan unlocks it for viewers,
//                              so we check the stream's hostPlan, not the caller.
// Admins bypass every gate.
//
// Posts/comments are CACHED on the doc (translations.<target>) so repeat views
// cost nothing. Messages are never persisted server-side (private/relay chat) —
// the client caches those locally.

const functions = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');
const LIBRETRANSLATE_KEY = defineSecret('LIBRETRANSLATE_KEY');
const LT_BASE = process.env.LIBRETRANSLATE_BASE || 'https://archive.vergr.app/lt';

const SUPPORTED = new Set(['en', 'es', 'pt', 'de', 'uk', 'it', 'nl', 'pl', 'tr']);
const ADMIN_EMAILS = ['vergenerd@gmail.com'];
const isPaid = (sub) => sub === 'lite' || sub === 'pro';

// LibreTranslate's `source:'auto'` detector silently fails on short or
// transliterated text (returns confidence 0 and defaults to English), which
// makes it "translate" en->en and echo the original back unchanged. We can't
// trust auto-detect alone. Cheaply infer the writing system server-side: the
// ONLY non-Latin language we support is Ukrainian (Cyrillic), so Cyrillic-
// dominant text → force source 'uk' instead of 'auto'.
function dominantScriptIsCyrillic(text) {
  const s = String(text || '');
  let latin = 0, cyrillic = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0x24f)) latin++;
    else if (c >= 0x400 && c <= 0x4ff) cyrillic++;
  }
  return cyrillic > latin;
}

// Call the box once with a given source ('auto' or an explicit code).
async function ltTranslate(body, source, target, key) {
  const res = await fetch(`${LT_BASE}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Vergr-LT-Key': key },
    body: JSON.stringify({ q: body, source, target, format: 'text' }),
  });
  if (!res.ok) throw new Error(`lt_${res.status}`);
  const data = await res.json();
  return {
    translatedText: data?.translatedText || '',
    detected: data?.detectedLanguage?.language || null,
  };
}

exports.translateContent = functions.https.onCall(
  { region: REGION, secrets: [LIBRETRANSLATE_KEY] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');

    const { text, target, kind = 'post', refId = null, knownLang = null } = request.data || {};
    const body = String(text || '').slice(0, 5000).trim();
    if (!body) throw new functions.https.HttpsError('invalid-argument', 'No text to translate.');
    if (!SUPPORTED.has(target)) {
      throw new functions.https.HttpsError('invalid-argument', `Unsupported target language: ${target}`);
    }

    // Resolve caller (subscription + admin).
    const userSnap = await db.collection('users').doc(uid).get();
    const user = userSnap.exists ? userSnap.data() : {};
    const isAdmin = user.role === 'admin' || ADMIN_EMAILS.includes((user.email || '').toLowerCase());

    // ── Subscription gating ──
    if (!isAdmin) {
      if (kind === 'message') {
        if (!isPaid(user.subscription)) {
          throw new functions.https.HttpsError('permission-denied', 'UPGRADE_REQUIRED');
        }
      } else if (kind === 'streamchat') {
        // The stream host's plan unlocks chat translation for viewers.
        if (!refId) throw new functions.https.HttpsError('invalid-argument', 'streamId required for streamchat.');
        const sSnap = await db.collection('streams').doc(refId).get();
        const host = sSnap.exists ? sSnap.data() : null;
        if (!host || !isPaid(host.hostPlan)) {
          throw new functions.https.HttpsError('permission-denied', 'UPGRADE_REQUIRED');
        }
      }
      // 'post' / 'comment' are free — no gate.
    }

    // ── Serve a cached post/comment translation if present ──
    let docRef = null;
    if (kind === 'post' && refId) docRef = db.collection('posts').doc(refId);
    if (kind === 'comment' && refId && refId.includes('/')) docRef = db.doc(refId); // posts/{pid}/comments/{cid}
    if (docRef) {
      try {
        const snap = await docRef.get();
        const cached = snap.exists ? snap.data()?.translations?.[target] : null;
        // Ignore a poisoned cache (an earlier bug stored the ORIGINAL text as the
        // "translation"): only serve a cache entry that actually differs from the
        // source, otherwise fall through and translate live.
        if (cached && cached.trim() && cached.trim() !== body) {
          return { translatedText: cached, target, cached: true };
        }
      } catch (_) { /* fall through to live translate */ }
    }

    // ── Live translate ──
    // Pick the most reliable source language: a stored/known lang hint, else a
    // script-inferred source (Cyrillic → uk), else 'auto'. This avoids the
    // auto-detect-fails-and-echoes-original bug on short/transliterated text.
    const key = LIBRETRANSLATE_KEY.value();
    const cyrillic = dominantScriptIsCyrillic(body);
    const hint = SUPPORTED.has(knownLang) && knownLang !== target ? knownLang : null;
    let source = hint || (cyrillic ? 'uk' : 'auto');

    let translatedText = '';
    let detected = null;
    try {
      ({ translatedText, detected } = await ltTranslate(body, source, target, key));
      // If 'auto' produced a no-op (detector failed and echoed the original) but
      // the text is clearly Cyrillic, retry forcing the supported Cyrillic source.
      const noop = translatedText.trim() && translatedText.trim() === body;
      if (noop && source === 'auto' && cyrillic) {
        ({ translatedText, detected } = await ltTranslate(body, 'uk', target, key));
        detected = detected || 'uk';
      }
      if (source !== 'auto') detected = detected || source;
    } catch (e) {
      throw new functions.https.HttpsError('unavailable', 'Translation service unreachable.');
    }
    if (!translatedText) throw new functions.https.HttpsError('internal', 'Empty translation.');

    // Cache post/comment results so repeat views are free — but never cache a
    // no-op (translation === original); that would poison the cache.
    if (docRef && translatedText.trim() !== body) {
      try { await docRef.set({ translations: { [target]: translatedText } }, { merge: true }); } catch (_) {}
    }

    return { translatedText, detected, target, cached: false };
  },
);
