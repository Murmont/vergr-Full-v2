// Stale-guest purge.
//
// "Continue as guest" creates an anonymous Firebase Auth user + a minimal
// `users/{uid}` doc (`isGuest: true`, `guest_xxxxxx` handle) so a visitor can
// browse without the DOB + ToS + KYC funnel. Nothing ever deleted them, so
// abandoned browse sessions accumulated in the user table forever — 11 of 62
// user docs on 2026-07-23, 10 of them older than a week, none with any
// activity. They then leaked into every people list on the client.
//
// Founder decisions (2026-07-23):
//   - Retention: 7 days from `guestCreatedAt`.
//   - Delete BOTH the Firestore doc and the Firebase Auth user. Leaving the
//     Auth user behind would let a stale anonymous session sign back in with
//     no profile doc, which the app has no state for.
//   - NEVER delete a guest who did something (posts / followers / following)
//     or who supplied an email. That last one is the strongest signal that the
//     account converted to a real one, so it is checked on BOTH the user doc
//     and the Auth record.
//
// Deliberately conservative: every skip condition errs toward KEEPING the
// account. A guest kept one extra day costs one document; a wrongly deleted
// account is unrecoverable.

const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

const db = getFirestore('vgrdb');

const RETAIN_DAYS = 7;
// Bound the work per run. The population is tiny and this is a destructive
// job — a runaway loop is the failure mode worth designing against.
const MAX_PER_RUN = 200;

function tsMillis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (typeof v === 'number') return v;
  return 0;
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Reasons a guest must be kept, checked against the user doc alone.
 * Returns a string reason, or null when the doc looks purgeable.
 */
function keepReasonFromDoc(u) {
  if (!u) return 'missing-doc';
  // Re-assert the guest flag rather than trusting the query — this function
  // deletes accounts, so it verifies its own precondition.
  if (u.isGuest !== true) return 'not-a-guest';
  if (u.convertedFromGuestAt) return 'converted';
  if (u.email) return 'has-email';
  if (u.role === 'admin') return 'admin';
  if (num(u.postCount) > 0) return 'has-posts';
  if (num(u.followerCount) > 0) return 'has-followers';
  if (num(u.followingCount) > 0) return 'has-following';
  if (num(u.commentCount) > 0) return 'has-comments';
  return null;
}

/**
 * Content check that does not rely on denormalised counters — those are
 * maintained by triggers and can lag or be missing on old docs. One bounded
 * read per candidate, and there are only ever a handful of candidates.
 */
async function hasAnyContent(uid) {
  const probes = [
    db.collection('posts').where('authorId', '==', uid).limit(1).get(),
    db.collection('users').doc(uid).collection('following').limit(1).get(),
  ];
  const [posts, following] = await Promise.all(probes);
  return !posts.empty || !following.empty;
}

/**
 * Delete the Auth user first, then the Firestore doc (recursively, so
 * subcollections like private/fcm go too). Order matters: if the Auth delete
 * fails we leave the doc in place, so the account stays consistent and the
 * next run retries. A doc deleted without its Auth user would be the bad
 * half-state.
 *
 * `user-not-found` from Auth is a success, not a failure — it means the Auth
 * record is already gone and only the orphaned doc remains.
 */
async function purgeGuest(uid) {
  try {
    await getAuth().deleteUser(uid);
  } catch (e) {
    if (e?.errorInfo?.code !== 'auth/user-not-found' && e?.code !== 'auth/user-not-found') {
      throw e;
    }
  }
  // recursiveDelete also removes subcollections, which a plain doc delete
  // would orphan. Deleting the doc releases the guest_xxxxxx handle too —
  // maintainUsernameIndex frees the `usernames/` mapping on doc removal.
  await db.recursiveDelete(db.collection('users').doc(uid));
}

// Reused by the admin "Delete account" button (functions/adminUsers.js) so the
// manual path and the daily job delete an account exactly the same way: Auth
// user first, then a recursive doc delete. Two different delete routines for one
// account type is how you end up with half-deleted accounts.
exports._purgeGuest = purgeGuest;

/**
 * Daily job. Scans guest accounts, deletes the ones older than RETAIN_DAYS
 * that never did anything and never supplied an email.
 */
exports.purgeStaleGuests = async () => {
  const cutoff = Date.now() - RETAIN_DAYS * 86400 * 1000;

  // Single equality filter → no composite index. The date comparison happens
  // in code, which also lets a doc with a missing/unreadable guestCreatedAt be
  // KEPT rather than swept up by an inequality it can't satisfy meaningfully.
  const snap = await db.collection('users')
    .where('isGuest', '==', true)
    .limit(MAX_PER_RUN)
    .get();

  if (snap.empty) {
    console.log('purgeStaleGuests: no guest accounts');
    return;
  }

  let purged = 0;
  const kept = {};
  const keep = (reason) => { kept[reason] = (kept[reason] || 0) + 1; };

  for (const doc of snap.docs) {
    const u = doc.data();

    const reason = keepReasonFromDoc(u);
    if (reason) { keep(reason); continue; }

    // No readable creation time → keep. We cannot prove it is stale.
    const created = tsMillis(u.guestCreatedAt) || tsMillis(u.createdAt);
    if (!created) { keep('no-created-at'); continue; }
    if (created >= cutoff) { keep('too-recent'); continue; }

    // Auth record is the authority on whether an email/provider was ever
    // attached — a converted account may have the credential on Auth before
    // the doc flag catches up.
    try {
      const authUser = await getAuth().getUser(doc.id);
      if (authUser.email || (authUser.providerData || []).length > 0) {
        keep('auth-has-provider');
        continue;
      }
    } catch (e) {
      if (e?.errorInfo?.code === 'auth/user-not-found' || e?.code === 'auth/user-not-found') {
        // Orphaned doc, no Auth user — fall through and clean the doc up.
      } else {
        keep('auth-lookup-failed');
        continue;
      }
    }

    try {
      if (await hasAnyContent(doc.id)) { keep('has-content'); continue; }
    } catch (e) {
      keep('content-check-failed');
      continue;
    }

    try {
      await purgeGuest(doc.id);
      purged++;
    } catch (e) {
      console.error(`purgeStaleGuests: failed to purge ${doc.id}`, e?.message || e);
      keep('purge-failed');
    }
  }

  console.log(
    `purgeStaleGuests: scanned ${snap.size}, purged ${purged}, kept ${JSON.stringify(kept)}`,
  );
};
