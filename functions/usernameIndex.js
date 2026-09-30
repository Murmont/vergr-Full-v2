// Username index — the single source of truth that makes username search and
// vergr.me (/u/:username) actually work.
//
// Two problems this fixes (both confirmed against production data):
//   1. `searchUsers` lowercases the query and range-matches `users.username`,
//      but usernames are stored with original case, so anyone with a capital
//      letter was unfindable. We maintain a lowercase `usernameLower` field and
//      search against that.
//   2. vergr.me resolves a handle via `usernames/{lowercase}` -> uid, but that
//      collection was never populated, so every vergr.me page 404'd. We
//      maintain that reservation here.
//
// `maintainUsernameIndex` keeps both in sync on every user write (signup,
// rename, delete). `backfillUsernameIndex` is a one-time admin job for the
// users that already exist.
const functions = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { isStaffDoc } = require('./staff');

const REGION = 'europe-west1';
const DB_NAME = 'vgrdb';
const db = getFirestore(DB_NAME);

// Token gate for the one-time backfill HTTP endpoint.
const USERNAME_BACKFILL_TOKEN = defineSecret('USERNAME_BACKFILL_TOKEN');

const lowerOf = (u) => (typeof u === 'string' ? u.toLowerCase() : null);

// Reserved handles that auto-assignment must never produce (mirror of the
// client HARD_RESERVED list — brand + impersonation + Vanguard rank tags).
const RESERVED = new Set([
  'recruit', 'vanguard', 'seniorvanguard', 'commander', 'overseer', 'senior',
  'vergr', 'vergrofficial', 'vergrteam', 'vergradmin', 'vergrsupport', 'vergrstaff',
  'vergrhq', 'vergrhelp', 'vergrnews', 'admin', 'administrator', 'mod', 'mods',
  'moderator', 'staff', 'support', 'helpdesk', 'system', 'official', 'team', 'root',
  'security', 'verified', 'player',
]);

// Server-side mirror of the client policy in src/utils/usernameValidation.js
// (keep the three lists in sync). Client validation covers the UI flows;
// this catches a direct Firestore write of users/{uid}.username.
const RESERVED_SUBSTRINGS = ['vergr', 'damien', 'vergenerd'];
const BLOCKED_SUBSTRINGS = [
  'fuck', 'cunt', 'bitch', 'whore', 'slut', 'wank',
  'nigger', 'nigga', 'faggot', 'retard', 'hitler', 'pedo',
];
const BLOCKED_EXACT = [
  'ass', 'sex', 'cum', 'kys', 'rape', 'rapist', 'dick', 'cock',
  'porn', 'nazi', 'anal', 'shit',
];
const normHandle = (s) => String(s || '').toLowerCase().replace(/[\s_\-.]+/g, '');

// ── Lookalike defence ────────────────────────────────────────────────
// A plain substring test only catches the exact spelling, so v3rgr, verqr,
// ver9r, vrgr and veregr all sailed through, and those are the handles an
// impersonator would actually pick. Two passes:
//
//   1. FOLD confusables to a base letter (digits, symbols, and the glyphs that
//      read the same at avatar-row size) and test for the brand again.
//   2. EDIT DISTANCE against the brand over short windows, so one added,
//      dropped, swapped or substituted character is still caught.
//
// This deliberately over-blocks. Someone losing "verge" has twenty characters
// of alternatives; the brand has one spelling worth protecting.
const CONFUSABLE = {
  0: 'o', 1: 'i', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g',
  7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i',
  '+': 't', '(': 'c', q: 'g', j: 'i', y: 'i', z: 's', k: 'c',
};

/** Lowercase, drop separators, fold confusables, collapse runs (verrgr -> vergr). */
function foldConfusables(s) {
  const base = String(s || '').toLowerCase().replace(/[^a-z0-9@$!|+(]/g, '');
  let out = '';
  for (const ch of base) out += (CONFUSABLE[ch] || ch);
  return out.replace(/(.)\1+/g, '$1');
}

/** Damerau-Levenshtein, capped: bails out as soon as it cannot beat `max`. */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = [];
  const prev = [];
  const cur = [];
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      // A transposition (rg -> gr) is one mistake, not two.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      }
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    for (let j = 0; j <= b.length; j++) { prev2[j] = prev[j]; prev[j] = cur[j]; }
  }
  return prev[b.length];
}

/** True when `handle` reads as `target` to a human: same once folded, or one edit away. */
function looksLike(handle, target) {
  const f = foldConfusables(handle);
  const t = foldConfusables(target);
  if (!f || !t) return false;
  if (f.includes(t)) return true;
  // Slide a window so an impersonation buried in a longer handle is caught
  // (xv3rgrx). Windows are sized around the target so an unrelated long handle
  // cannot accumulate a match by chance.
  for (let len = Math.max(3, t.length - 1); len <= t.length + 1; len++) {
    for (let i = 0; i + len <= f.length; i++) {
      if (editDistance(f.slice(i, i + len), t, 1) <= 1) return true;
    }
  }
  return false;
}

function isDisallowedUsername(username) {
  const n = normHandle(username);
  if (!n) return true;
  // Brand + founder identity: not claimable, and neither is anything that reads
  // as it. Founder ruling 2026-08-17, "anything close to it".
  if (RESERVED_SUBSTRINGS.some((r) => n.includes(r) || looksLike(username, r))) return true;
  if (RESERVED.has(n)) return true;
  if (BLOCKED_SUBSTRINGS.some((w) => n.includes(w))) return true;
  return BLOCKED_EXACT.includes(n);
}

// Derive a clean base handle from the best available signal (display name, then
// email local-part), sanitized to the username charset. Falls back to 'player'.
function baseHandle(data) {
  const src = (data.displayName && data.displayName.trim())
    || (data.email ? String(data.email).split('@')[0] : '')
    || 'player';
  let base = String(src).toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (base.length < 3) base = 'player';
  return base.slice(0, 12);
}

const rand4 = () => Math.random().toString(36).slice(2, 6);

// Find a unique handle: try the base, then base+random suffixes, then a uid-based
// fallback that is effectively guaranteed unique. `taken` lets a batch reserve
// names that aren't committed to Firestore yet.
async function generateUniqueUsername(base, uid, taken = new Set()) {
  for (let i = 0; i < 15; i++) {
    let cand = (i === 0 ? base : `${base}${rand4()}`).slice(0, 20);
    if (cand.length < 3) cand = `player${rand4()}`.slice(0, 20);
    const lower = cand.toLowerCase();
    if (RESERVED.has(lower) || taken.has(lower) || isDisallowedUsername(lower)) continue;
    const snap = await db.doc(`usernames/${lower}`).get();
    if (!snap.exists) { taken.add(lower); return cand; }
  }
  const fallback = `player_${String(uid).slice(0, 6)}`.toLowerCase().slice(0, 20);
  taken.add(fallback);
  return fallback;
}

async function deleteMappingIfOwned(lower, uid) {
  if (!lower) return;
  const ref = db.doc(`usernames/${lower}`);
  const snap = await ref.get();
  if (snap.exists && snap.data().uid === uid) await ref.delete();
}

exports.isDisallowedUsername = isDisallowedUsername;
exports.normHandle = normHandle;

/**
 * Obscenity check ONLY, with the brand reservations deliberately left out.
 *
 * `isDisallowedUsername` blocks anything containing "vergr" because its job is
 * to stop a USER passing themselves off as Vergr. An official channel IS Vergr,
 * so applying that rule to channels is backwards: it blocks @vergroffers,
 * @vergrsupport and @vergr, which are exactly the handles these channels should
 * have. Same for RESERVED ("official", "support", "admin").
 *
 * What still applies to a channel is the profanity and slur list, because an
 * official channel with an obscene handle is wrong no matter who owns it.
 *
 * Uniqueness is NOT policy and is checked separately: a channel still cannot
 * take a handle a real user already holds, or one another channel is using.
 */
function isObsceneHandle(handle) {
  const n = normHandle(handle);
  if (!n) return true;
  if (BLOCKED_SUBSTRINGS.some((w) => n.includes(w))) return true;
  return BLOCKED_EXACT.includes(n);
}
exports.isObsceneHandle = isObsceneHandle;
exports.looksLike = looksLike;
exports.foldConfusables = foldConfusables;

// Keep usernameLower + usernames/{lower} in sync with users/{uid}.username.
// Loop-safe: the only self-write is setting usernameLower, and it is guarded so
// the re-triggered run sees usernameLower already correct and does nothing.
exports.maintainUsernameIndex = functions.firestore.onDocumentWritten(
  { document: 'users/{uid}', region: REGION, database: DB_NAME },
  async (event) => {
    const uid = event.params.uid;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    // User deleted -> release the handle.
    if (!after) {
      await deleteMappingIfOwned(before?.usernameLower || lowerOf(before?.username), uid);
      return;
    }

    let username = after.username;
    // Enforcement: every account MUST have a username. If none was set (Google
    // sign-up, abandoned onboarding, legacy), auto-assign a unique TikTok-style
    // handle. The user can change it later in Settings. Setting it re-triggers
    // this function, which then maintains the index normally.
    if (!username || typeof username !== 'string' || !username.trim()) {
      // Guests must read as "guest", never the generic "player" fallback that
      // baseHandle produces when a doc has no displayName yet (a guest seed can
      // race / fail before its username is written). Deterministic per uid.
      const assigned = after.isGuest === true
        ? `guest_${String(uid).slice(0, 6)}`.toLowerCase().slice(0, 20)
        : await generateUniqueUsername(baseHandle(after), uid);
      await db.doc(`users/${uid}`).set(
        { username: assigned, usernameLower: assigned.toLowerCase(), usernameAutoAssigned: true },
        { merge: true },
      );
      await db.doc(`usernames/${assigned.toLowerCase()}`).set(
        { uid, username: assigned, autoAssigned: true, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      return;
    }
    const newLower = lowerOf(username);
    const indexCurrent = after.usernameLower === newLower;
    const usernameChanged = before?.username !== username;

    // Enforcement: a newly CHOSEN handle that violates the reserved/blocked
    // policy is reverted before it ever reaches the index. Fires only on a
    // CHANGE so pre-existing holders (incl. the founder's own vergr accounts)
    // are never touched; admins and guest seeds are exempt.
    const isAdminAccount = isStaffDoc(after) || after.role === 'admin';
    if (usernameChanged && !isAdminAccount && after.isGuest !== true && isDisallowedUsername(username)) {
      const prev = before?.username;
      if (prev && typeof prev === 'string' && prev.trim() && !isDisallowedUsername(prev)) {
        // Revert to the previous handle (re-triggers this fn, which then
        // re-indexes the old name — idempotent).
        await db.doc(`users/${uid}`).set({ username: prev, usernameLower: lowerOf(prev) }, { merge: true });
      } else {
        // No safe previous handle (fresh account written directly) -> assign one.
        const assigned = await generateUniqueUsername(baseHandle(after), uid);
        await db.doc(`users/${uid}`).set(
          { username: assigned, usernameLower: assigned.toLowerCase(), usernameAutoAssigned: true },
          { merge: true },
        );
        await db.doc(`usernames/${assigned.toLowerCase()}`).set(
          { uid, username: assigned, autoAssigned: true, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
      }
      return;
    }

    // 1) Maintain usernameLower on the user doc (guarded against re-trigger loop).
    if (!indexCurrent) {
      await db.doc(`users/${uid}`).set({ usernameLower: newLower }, { merge: true });
    }

    // 2) Maintain the handle reservation when the username changed or the
    //    mapping was missing. Idempotent set + cleanup of the old handle.
    if (usernameChanged || !indexCurrent) {
      await db.doc(`usernames/${newLower}`).set(
        { uid, username, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      const oldLower = before?.usernameLower || lowerOf(before?.username);
      if (oldLower && oldLower !== newLower) await deleteMappingIfOwned(oldLower, uid);
    }
  },
);

// One-time (re-runnable) backfill for existing users. Token-gated HTTP endpoint
// so it can be run from an ops shell: GET ...?token=<USERNAME_BACKFILL_TOKEN>.
exports.backfillUsernameIndex = functions.https.onRequest(
  { region: REGION, secrets: [USERNAME_BACKFILL_TOKEN] },
  async (req, res) => {
    const token = String(req.query.token || req.get('x-backfill-token') || '').trim();
    const expected = String(USERNAME_BACKFILL_TOKEN.value() || '').trim();
    if (!token || !expected || token !== expected) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    const pageSize = 400;
    let processed = 0, indexed = 0, assigned = 0, skipped = 0, last = null;
    const taken = new Set();  // handles reserved during this run (pre-commit)
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let q = db.collection('users').orderBy('__name__').limit(pageSize);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      const batch = db.batch();
      for (const d of snap.docs) {
        const data = d.data();
        let username = data.username;
        // Enforce: every account gets a username. Auto-assign a unique handle
        // to any account that has none.
        if (!username || typeof username !== 'string' || !username.trim()) {
          username = await generateUniqueUsername(baseHandle(data), d.id, taken);
          batch.set(d.ref, { username, usernameLower: username.toLowerCase(), usernameAutoAssigned: true }, { merge: true });
          assigned++;
        }
        const lower = username.toLowerCase();
        // Guard: a doc id can't contain '/' or be '.'/'..'.
        if (lower.includes('/') || lower === '.' || lower === '..') { skipped++; continue; }
        taken.add(lower);
        if (data.usernameLower !== lower) batch.set(d.ref, { usernameLower: lower }, { merge: true });
        batch.set(
          db.doc(`usernames/${lower}`),
          { uid: d.id, username, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
        indexed++;
      }
      await batch.commit();
      processed += snap.docs.length;
      last = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < pageSize) break;
    }
    res.json({ ok: true, processed, indexed, assigned, skipped });
  },
);
