// Counting a post view on the client, cheaply and honestly.
//
// ⚠ A VIEW IS NOT A RENDER. The feed mounts far more posts than anyone looks at,
// so a view is counted only when the card is genuinely on screen (>=50% visible)
// and STAYS there for a moment. Anything looser is a render counter wearing a
// nicer label.
//
// ⚠ ONCE PER POST PER SESSION. Scrolling back up, a re-render or a tab switch
// must not count again.
//
// Cost: batched into one callable every ~20s, which writes to the REALTIME
// DATABASE (not billed per operation) and is rolled into Firestore every 6 hours.
// See functions/postViews.js for why that shape.

import { getFunctions, httpsCallable } from 'firebase/functions';

const FLUSH_MS = 20000;
/** How long a card must stay on screen before it counts. */
export const VIEW_DWELL_MS = 1000;
/** How much of it must be visible. */
export const VIEW_RATIO = 0.5;

const pending = new Map();      // postId -> views
const seenThisSession = new Set();
let timer = null;

const flush = async () => {
  timer = null;
  if (pending.size === 0) return;
  const entries = [...pending.entries()].map(([postId, views]) => ({ postId, views }));
  pending.clear();
  try {
    await httpsCallable(getFunctions(undefined, 'europe-west1'), 'recordPostViews')({ entries });
  } catch {
    // Swallowed and not retried: a lost view is a rounding error on a display
    // number, and a retry storm on a bad connection is not.
  }
};

const schedule = () => { if (!timer) timer = setTimeout(flush, FLUSH_MS); };

/** Count one view of a post, at most once per session. */
export const recordPostView = (postId) => {
  if (!postId || seenThisSession.has(postId)) return;
  seenThisSession.add(postId);
  pending.set(postId, (pending.get(postId) || 0) + 1);
  schedule();
};

/**
 * Observe an element and count a view once it has been properly on screen.
 * Returns a cleanup function.
 */
export const observePostView = (el, postId) => {
  if (!el || !postId || seenThisSession.has(postId)) return () => {};
  if (typeof IntersectionObserver === 'undefined') return () => {};

  let dwell = null;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && e.intersectionRatio >= VIEW_RATIO) {
        if (!dwell) {
          dwell = setTimeout(() => {
            recordPostView(postId);
            io.disconnect();
          }, VIEW_DWELL_MS);
        }
      } else if (dwell) {
        // Scrolled past before it counted — that is not a view.
        clearTimeout(dwell);
        dwell = null;
      }
    }
  }, { threshold: [VIEW_RATIO] });

  io.observe(el);
  return () => { if (dwell) clearTimeout(dwell); io.disconnect(); };
};

if (typeof document !== 'undefined') {
  // `visibilitychange`, not `unload`: mobile browsers frequently never fire unload.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && pending.size > 0) {
      if (timer) { clearTimeout(timer); timer = null; }
      flush();
    }
  });
}
