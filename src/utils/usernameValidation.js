// Shared username validation. Used by SignUpStep2 + EditProfileScreen so
// the rules can't drift.
//
// Rules:
//   - Format: 3–20 chars, alphanumeric + underscore.
//   - Reserved: Vanguard rank tags (Recruit, Vanguard, Senior Vanguard,
//     Commander, Overseer), Vergr brand names, common impersonation names.
//   - Uniqueness: case-insensitive Firestore lookup of users.username.
//
// Vanguard members' DISPLAYED username (Recruit / Vanguard / etc.) is a
// runtime persona — those usernames don't live in any user doc. Normal
// users can never register them, so when we show "@Vanguard" to a viewer
// it's unambiguous which kind of account they're looking at.

import { collection, query, where, limit, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

export const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

const HARD_RESERVED = [
  // Vanguard rank tags (case-insensitive, with/without spaces)
  'recruit', 'vanguard', 'seniorvanguard', 'commander', 'overseer',
  'vanguardrecruit', 'senior',
  // Brand
  'vergr', 'vergrofficial', 'vergrteam', 'vergradmin', 'vergrsupport',
  'vergrstaff', 'vergrhq', 'vergrhelp', 'vergrnews',
  // Generic impersonation
  'admin', 'administrator', 'mod', 'mods', 'moderator', 'staff',
  'support', 'helpdesk', 'system', 'official', 'team', 'root',
  'security', 'verified',
];

// Brand + founder identity: reserved if the handle CONTAINS any of these
// (founder 2026-07-17: nothing related to Vergr or Damien is claimable).
const RESERVED_SUBSTRINGS = ['vergr', 'damien', 'vergenerd'];

// Profanity/abuse blocklist. Substring entries are strings that can't appear
// innocently inside another word; ambiguous ones (which DO occur inside real
// names/words, e.g. hancock, grape, cassie) are exact-match only.
const BLOCKED_SUBSTRINGS = [
  'fuck', 'cunt', 'bitch', 'whore', 'slut', 'wank',
  'nigger', 'nigga', 'faggot', 'retard', 'hitler', 'pedo',
];
const BLOCKED_EXACT = [
  'ass', 'sex', 'cum', 'kys', 'rape', 'rapist', 'dick', 'cock',
  'porn', 'nazi', 'anal', 'shit',
];

const norm = (s) => String(s || '').toLowerCase().replace(/[\s_\-.]+/g, '');

// ── Lookalike defence (mirror of functions/usernameIndex.js) ──────────
// A substring test only catches the exact spelling, so v3rgr, verqr, vrgr and
// veregr all passed, and those are the handles an impersonator would pick.
// Fold confusable glyphs to a base letter, then allow one edit anywhere.
// Deliberately over-blocks: the brand has one spelling worth protecting.
const CONFUSABLE = {
  0: 'o', 1: 'i', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g',
  7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i',
  '+': 't', '(': 'c', q: 'g', j: 'i', y: 'i', z: 's', k: 'c',
};

const foldConfusables = (s) => {
  const base = String(s || '').toLowerCase().replace(/[^a-z0-9@$!|+(]/g, '');
  let out = '';
  for (const ch of base) out += (CONFUSABLE[ch] || ch);
  return out.replace(/(.)\1+/g, '$1');
};

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

const looksLike = (handle, target) => {
  const f = foldConfusables(handle);
  const t = foldConfusables(target);
  if (!f || !t) return false;
  if (f.includes(t)) return true;
  for (let len = Math.max(3, t.length - 1); len <= t.length + 1; len++) {
    for (let i = 0; i + len <= f.length; i++) {
      if (editDistance(f.slice(i, i + len), t, 1) <= 1) return true;
    }
  }
  return false;
};

export const isReservedUsername = (username) => {
  const n = norm(username);
  if (!n) return true;
  if (RESERVED_SUBSTRINGS.some(r => n.includes(r) || looksLike(username, r))) return true;
  return HARD_RESERVED.some(r => norm(r) === n);
};

export const isBlockedUsername = (username) => {
  const n = norm(username);
  if (!n) return false;
  return BLOCKED_SUBSTRINGS.some(w => n.includes(w)) || BLOCKED_EXACT.includes(n);
};

// Returns null if the username is available, or a string describing why not.
//
// `isAdmin` skips the RESERVED check only. The brand reservation exists to stop
// users passing themselves off as Vergr, and the founder is Vergr, so it must
// never lock him out of his own name. This mirrors the `isAdminAccount` exemption
// the server already has in `maintainUsernameIndex`; without it the client would
// reject a handle the server would happily accept. Obscenity and uniqueness
// still apply to everyone.
export const checkUsername = async (username, { isAdmin = false } = {}) => {
  if (!username) return 'Username required.';
  if (!USERNAME_REGEX.test(username)) return 'Use 3–20 letters, numbers, or underscore.';
  if (!isAdmin && isReservedUsername(username)) return 'That username is reserved.';
  if (isBlockedUsername(username)) return "That username isn't allowed.";
  // Case-insensitive uniqueness via the usernames/{lower} reservation index,
  // plus an exact-case fallback for any user not yet backfilled.
  try {
    const reserved = await getDoc(doc(db, 'usernames', username.toLowerCase()));
    if (reserved.exists()) return 'That username is already taken.';
    const q = query(collection(db, 'users'), where('username', '==', username), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) return 'That username is already taken.';
  } catch (e) {
    // If the query fails for any reason, don't block signup — Firestore
    // rules + a future Cloud Function check provide defence in depth.
    return null;
  }
  return null;
};
