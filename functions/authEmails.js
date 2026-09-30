// authEmails — the ONE place server code gets an account's sign-up email.
//
// The sign-up email lives in Firebase Auth only. It is NOT copied onto
// `users/{uid}`: that collection is listable by anyone (Explore, search and the
// leaderboard bulk-query it), so a copy there published every account's address.
// Founder, 2026-09-16: an email shows on a profile only when the person adds it
// themselves as a contact link in Edit Profile, like any other social link.
//
// Admin lookups are not billed per call.
const { getAuth } = require('firebase-admin/auth');

/** { [uid]: email | null } for up to any number of uids (100 per Auth call). */
async function authEmailsFor(uids) {
  const out = {};
  const list = [...new Set((uids || []).filter(Boolean))];
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    try {
      const res = await getAuth().getUsers(chunk.map((uid) => ({ uid })));
      for (const u of res.users) out[u.uid] = u.email || null;
    } catch { /* a failed lookup leaves those emails blank, never breaks the screen */ }
  }
  return out;
}

async function authEmailFor(uid) {
  if (!uid) return null;
  try { return (await getAuth().getUser(uid)).email || null; } catch { return null; }
}

async function uidForEmail(email) {
  if (!email || !String(email).includes('@')) return null;
  try { return (await getAuth().getUserByEmail(String(email).trim())).uid; } catch { return null; }
}

module.exports = { authEmailsFor, authEmailFor, uidForEmail };
