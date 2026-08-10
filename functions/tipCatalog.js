// VERGR tip catalog — host-configured tip-tier messages.
//
// Optional UX layer: a host pre-populates entries like:
//   { minCoins: 5,   message: "Hello" }
//   { minCoins: 50,  message: "Thanks for the support" }
//   { minCoins: 500, message: "Legend" }
//
// When a viewer sends a tip WITHOUT a custom message, the highest-matching
// catalog entry's message is used as the chat caption.
//
// Every catalog message is Gemini-moderated at save time. If any entry's
// verdict comes back as 'block', the callable refuses the entire save with
// the offending index in the error message.
//
// Storage: users/{uid}.tipCatalog = [{ minCoins, message }, ...]
//
// Limits: max 10 entries, each ≤ 80 chars, minCoins ∈ [1, 100000].

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const GEMINI_CHAT_KEY = defineSecret('GEMINI_CHAT_KEY');

const MAX_ENTRIES = 10;
const MAX_MSG_CHARS = 80;
const MIN_COINS = 1;
const MAX_COINS = 100000;

// Reuse contentAi's scanText via the _internal_ export so we don't pay an
// extra region hop. Both files load lazily.
let _scanText;
function getScanText() {
  if (!_scanText) {
    const ai = require('./contentAi');
    _scanText = ai._internal_scanText || (async () => ({ verdict: 'pass', reason: '' }));
  }
  return _scanText;
}

function validateEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new functions.https.HttpsError('invalid-argument', 'entries must be an array.');
  }
  if (entries.length > MAX_ENTRIES) {
    throw new functions.https.HttpsError('invalid-argument', `Max ${MAX_ENTRIES} entries.`);
  }
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || typeof e !== 'object') {
      throw new functions.https.HttpsError('invalid-argument', `Entry ${i} must be an object.`);
    }
    const coins = Number(e.minCoins);
    if (!Number.isFinite(coins) || coins < MIN_COINS || coins > MAX_COINS) {
      throw new functions.https.HttpsError('invalid-argument', `Entry ${i}: minCoins out of range.`);
    }
    if (typeof e.message !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', `Entry ${i}: message required.`);
    }
    const trimmed = e.message.trim();
    if (trimmed.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', `Entry ${i}: message empty.`);
    }
    if (trimmed.length > MAX_MSG_CHARS) {
      throw new functions.https.HttpsError('invalid-argument', `Entry ${i}: message too long (max ${MAX_MSG_CHARS}).`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// setTipCatalog — save the host's tip-tier messages. Gemini moderates each.
// ─────────────────────────────────────────────────────────────────────────────
exports.setTipCatalog = functions.https.onCall(
  { region: REGION, secrets: [GEMINI_CHAT_KEY] },
  async (req) => {
    if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;
    const { entries = [] } = req.data || {};
    validateEntries(entries);

    // Sort by minCoins ASC so lookups can short-circuit at the first
    // entry whose threshold exceeds the tip amount.
    const sorted = entries
      .map((e) => ({ minCoins: Math.floor(Number(e.minCoins)), message: e.message.trim() }))
      .sort((a, b) => a.minCoins - b.minCoins);

    // Moderate every message. Reject the WHOLE save if any block.
    const scan = getScanText();
    const verdicts = await Promise.all(
      sorted.map((e) => scan(e.message, GEMINI_CHAT_KEY))
    );
    for (let i = 0; i < verdicts.length; i++) {
      const v = verdicts[i];
      if (v?.verdict === 'block') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Entry ${i + 1} blocked by moderation: ${v.reason || 'policy violation'}`,
        );
      }
    }

    await db.collection('users').doc(uid).set({
      tipCatalog: sorted,
      tipCatalogUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { ok: true, entries: sorted };
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// clearTipCatalog — wipe the catalog.
// ─────────────────────────────────────────────────────────────────────────────
exports.clearTipCatalog = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  await db.collection('users').doc(req.auth.uid).update({
    tipCatalog: FieldValue.delete(),
    tipCatalogUpdatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});
