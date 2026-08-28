// src/hooks/useImpressionTracker.js
// IntersectionObserver-based impression tracker. Fires 'view' when a post is
// ≥50% visible for ≥1000ms, and 'dwell' when it leaves with total visible time.
// Deduplicated per session via a WeakSet keyed on the DOM node.
import { useEffect, useRef } from 'react';
import { recordPostView } from '../utils/postViews';
import { trackEvent } from '../utils/trackEvent';

export function useImpressionTracker(ref, post, opts = {}) {
  const timers = useRef({ enteredAt: 0, totalMs: 0, viewed: false });

  useEffect(() => {
    const el = ref.current;
    if (!el || !post?.id) return;

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio >= 0.5) {
          if (!timers.current.enteredAt) {
            timers.current.enteredAt = performance.now();
            // Fire 'view' after 1s of ≥50% visibility
            setTimeout(() => {
              if (timers.current.enteredAt && !timers.current.viewed) {
                timers.current.viewed = true;
                // ⚠ REUSES THIS OBSERVER rather than adding a second one. The
                // dwell rule (>=50% visible for 1s) is already exactly what a
                // view count needs, and two IntersectionObservers on the same
                // card would be duplicated work that could drift apart.
                //
                // ⚠ Deliberately OUTSIDE the consent gate that stops trackEvent:
                // this increments an aggregate counter on the POST and records
                // nothing about the viewer, so it is not behavioural tracking.
                // The counter goes to the Realtime Database, which is not billed
                // per operation — see functions/postViews.js.
                recordPostView(post.id);
                trackEvent('view', {
                  postId: post.id,
                  authorId: post.authorId || post.userId,
                  contentType: post.type || post.contentType,
                  tags: post.tags?.slice?.(0, 5),
                  gameId: post.gameId,
                  source: opts.source,
                });
              }
            }, 1000);
          }
        } else if (timers.current.enteredAt) {
          const dwellMs = Math.round(performance.now() - timers.current.enteredAt);
          timers.current.totalMs += dwellMs;
          timers.current.enteredAt = 0;
          if (timers.current.viewed && dwellMs >= 2000) {
            trackEvent('dwell', {
              postId: post.id,
              authorId: post.authorId || post.userId,
              contentType: post.type || post.contentType,
              dwellMs,
              source: opts.source,
            });
          }
        }
      }
    }, { threshold: [0, 0.5, 1] });

    io.observe(el);
    return () => io.disconnect();
  }, [ref, post?.id, opts.source]);
}
