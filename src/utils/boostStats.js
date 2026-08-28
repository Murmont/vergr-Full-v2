// Counting boost impressions without going bankrupt.
//
// ⚠ ONE WRITE PER IMPRESSION IS UNAFFORDABLE. Spark gives 20,000 writes a day.
// A single item seen 20,000 times would consume the entire platform's daily
// write budget. Naive counting is not an option at any scale, which is why this
// batches and why it counts ONLY boosted items.
//
// ⚠ COUNTING IS SCOPED TO LIVE BOOSTS ON PURPOSE. You do not need view counts on
// 50,000 posts, only on the handful boosted right now. That bounds the cost by
// the number of live boosts — a business input we control and get paid for —
// instead of by content volume, which is unbounded.
// See docs/BOOST_DELIVERY_PLAN.md §6.3.

import { getFunctions, httpsCallable } from 'firebase/functions';

/** Flush window. Long enough to batch a scroll, short enough to survive a tab close. */
const FLUSH_MS = 20000;

/** id -> { target, targetId, impressions, views } */
const pending = new Map();

/**
 * ⚠ UNIQUE VIEWS ARE DEVICE-LOCAL AND IN MEMORY. A "view" is the first time THIS
 * session put the item in front of you; a re-render, a scroll back up or a
 * refresh must not count again, or the number is just a render counter with a
 * nicer name.
 */
const seenThisSession = new Set();

let timer = null;

const flush = async () => {
  timer = null;
  if (pending.size === 0) return;
  const entries = [...pending.values()];
  pending.clear();
  try {
    await httpsCallable(getFunctions(undefined, 'europe-west1'), 'recordBoostImpressions')({ entries });
  } catch {
    // Deliberately swallowed and NOT retried. A lost impression is a rounding
    // error on a display number; a retry storm on a flaky connection is not.
  }
};

const schedule = () => {
  if (timer) return;
  timer = setTimeout(flush, FLUSH_MS);
};

/**
 * Record that boosted items were shown to this viewer.
 *
 * @param {Array<{target:string, targetId:string}>} items already filtered to
 *   items with a LIVE boost — this does not check, because the caller has the
 *   document in hand and checking again would be a second read.
 */
export const recordBoostImpressions = (items) => {
  if (!Array.isArray(items) || items.length === 0) return;
  for (const it of items) {
    if (!it?.targetId || !it?.target) continue;
    const key = `${it.target}:${it.targetId}`;
    const row = pending.get(key) || { target: it.target, targetId: it.targetId, impressions: 0, views: 0 };
    row.impressions += 1;
    if (!seenThisSession.has(key)) { seenThisSession.add(key); row.views += 1; }
    pending.set(key, row);
  }
  schedule();
};

// Best-effort flush when the tab goes away, so a short session is not lost.
// `visibilitychange` rather than `unload`: mobile browsers often never fire unload.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pending.size > 0) {
      if (timer) { clearTimeout(timer); timer = null; }
      flush();
    }
  });
}
