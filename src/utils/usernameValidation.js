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

export const isReservedUsername = (username) => {
  const n = norm(username);
  if (!n) return true;
  if (RESERVED_SUBSTRINGS.some(r => n.includes(r))) return true;
  return HARD_RESERVED.some(r => norm(r) === n);
};

export const isBlockedUsername = (username) => {
  const n = norm(username);
  if (!n) return false;
  return BLOCKED_SUBSTRINGS.some(w => n.includes(w)) || BLOCKED_EXACT.includes(n);
};

// Returns null if the username is available, or a string describing why not.
export const checkUsername = async (username) => {
  if (!username) return 'Username required.';
  if (!USERNAME_REGEX.test(username)) return 'Use 3–20 letters, numbers, or underscore.';
  if (isReservedUsername(username)) return 'That username is reserved.';
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
