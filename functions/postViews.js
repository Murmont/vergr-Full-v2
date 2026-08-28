// Public post view counts, without the write bill.
//
// ⚠ THE PROBLEM: Firestore's free tier is 20,000 WRITES a day. One write per view
// means a single popular post spends the entire platform's daily budget, which is
// why `incrementViewCount()` sat with zero callers since the day it was written
// and `viewCount` was always 0.
//
// ⚠ THE ANSWER IS THE REALTIME DATABASE, WHICH IS NOT BILLED PER OPERATION.
// RTDB's Spark limits are storage (1GB), bandwidth (10GB/month) and simultaneous
// connections (100) — there is no per-write quota. An increment costs a few dozen
// bytes. Firestore charges per document write; RTDB does not. So the hot counter
// lives in RTDB and only a periodic ROLLUP touches Firestore.
//
//   client (batched ~20s)  ->  this callable  ->  RTDB delta
//   cronEvery6h            ->  RTDB deltas    ->  ONE Firestore write per post
//
// Firestore writes therefore scale with ACTIVE POSTS x 4/day, not with views.
// 1,000 active posts is ~4,000 writes/day against a 20,000 budget, no matter
// whether those posts were seen a thousand times or ten million.
//
// ⚠ THE ADMIN SDK BYPASSES RTDB SECURITY RULES, which is why this is a callable
// rather than a client write. It also means `database.rules.json` does NOT need
// to change — and that matters, because this project has no database rules file
// checked in and deploying one blind would replace whatever presence relies on.

const functions = require('firebase-functions/v2');
const { HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = () => getFirestore('vgrdb');
const rtdb = () => admin.database();

/** Where the hot counters live. Deltas are drained into Firestore by the cron. */
const DELTA_PATH = 'postViewDeltas';

/** Most posts one batch may report. A client claiming more is not believed. */
const MAX_ENTRIES = 60;

/** Most views one post may gain from a single batch. */
const MAX_PER_POST = 50;

/**
 * Record a batch of post views.
 *
 * ⚠ Batched by the client (~20s) so invocations scale with SESSIONS, not views.
 * At 1,000 daily sessions flushing ten times each that is ~300k invocations a
 * month against a 2M free allowance.
 */
exports.recordPostViews = functions.https.onCall(
  { region: 'europe-west1' },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');

    const raw = (request.data && request.data.entries) || [];
    if (!Array.isArray(raw) || raw.length === 0) return { ok: true, counted: 0 };

    const updates = {};
    let counted = 0;
    for (const e of raw.slice(0, MAX_ENTRIES)) {
      const id = String((e && e.postId) || '').trim();
      // Firebase paths cannot contain . # $ [ ] /
      if (!id || /[.#$[\]/]/.test(id)) continue;
      const n = Math.max(1, Math.min(MAX_PER_POST, Math.floor(Number(e.views) || 1)));
      updates[`${DELTA_PATH}/${id}`] = admin.database.ServerValue.increment(n);
      counted += 1;
    }
    if (counted === 0) return { ok: true, counted: 0 };

    // One multi-location update: a single round trip regardless of batch size.
    await rtdb().ref().update(updates);
    return { ok: true, counted };
  },
);

/**
 * Drain the RTDB deltas into Firestore. Called from cronEvery6h — deliberately
 * NOT its own scheduled function, because a new Cloud Scheduler job is one of the
 * few things that actually costs money on this project.
 *
 * ⚠ SUBTRACTS what it applied rather than deleting the key. A view that arrives
 * mid-drain is then still counted on the next run; deleting would silently throw
 * it away.
 */
async function aggregatePostViews() {
  const root = rtdb().ref(DELTA_PATH);
  const snap = await root.once('value');
  const deltas = snap.val() || {};
  const ids = Object.keys(deltas);
  if (ids.length === 0) {
    // ⚠ SAY SO. _runJobs only logs FAILURES, so a healthy drain was completely
    // silent and "ran and had nothing to do" looked identical to "never ran" in
    // the logs. That ambiguity is why this job sat unverified after shipping.
    console.log('[aggregatePostViews] no pending deltas');
    return { posts: 0, views: 0 };
  }

  const d = db();
  let posts = 0, views = 0;

  // Firestore batches cap at 500 writes.
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const batch = d.batch();
    const applied = {};
    for (const id of chunk) {
      const n = Math.floor(Number(deltas[id]) || 0);
      if (n <= 0) continue;
      batch.set(d.collection('posts').doc(id), {
        viewCount: FieldValue.increment(n),
      }, { merge: true });
      applied[`${DELTA_PATH}/${id}`] = admin.database.ServerValue.increment(-n);
      posts += 1; views += n;
    }
    // ⚠ THIS CHUNK, not the running total. `posts` accumulates across chunks, so
    // after any chunk had written, a later all-zero chunk still fell through to
    // an empty batch.commit() and an rtdb().update({}) with no paths.
    if (Object.keys(applied).length === 0) continue;
    await batch.commit();
    // Only after the Firestore write lands, so a failure re-counts rather than
    // losing the views.
    await rtdb().ref().update(applied);
  }
  console.log(`[aggregatePostViews] drained ${views} views across ${posts} posts`);
  return { posts, views };
}

exports._internal = { aggregatePostViews, DELTA_PATH };
