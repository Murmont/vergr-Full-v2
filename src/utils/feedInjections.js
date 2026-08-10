// src/utils/feedInjections.js
//
// Ad placement must be DETERMINISTIC. This used to call Math.random() for each
// gap, and the caller invokes it inside render (not in a memo), so every single
// re-render produced a different layout: ads hopped between slots and every post
// below a moved ad shifted with them. That was a large part of the "the home
// feed changes a lot" report, and it had nothing to do with the ranker.
//
// The gap sequence is now derived from the ids of the posts it is placed
// between, so the same feed always yields the same layout, across re-renders and
// across sessions, while still looking irregular rather than every-Nth.

// FNV-1a. Small, fast, no dependency; we only need spread, not crypto strength.
const hashStr = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** Insert `ads` into `posts` at stable, content-derived positions.
 *  Same inputs always produce the same output. */
export const injectAdsRandomly = (posts, ads, minGap = 4, maxGap = 8) => {
  if (!ads.length || !posts.length) return posts;
  const span = maxGap - minGap + 1;
  const result = [...posts];
  let adIndex = 0;
  // Seed off the post the ad will follow, so inserting/removing content
  // elsewhere in the list does not reshuffle the ads that came before it.
  let gap = minGap + (hashStr(String(posts[0]?.id || '0')) % span);
  let currentPos = gap;
  while (currentPos < result.length && adIndex < ads.length) {
    result.splice(currentPos, 0, { ...ads[adIndex], isAd: true });
    adIndex++;
    const anchor = String(result[currentPos - 1]?.id || currentPos);
    gap = minGap + (hashStr(anchor) % span);
    currentPos += gap + 1; // +1 because we inserted an ad
  }
  // If still have ads left, append at the end
  if (adIndex < ads.length) {
    result.push(...ads.slice(adIndex).map(ad => ({ ...ad, isAd: true })));
  }
  return result;
};
