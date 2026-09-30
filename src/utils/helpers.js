export const TIERS = {
  BRONZE: { name: 'Bronze', min: 0, max: 99, color: '#CD7F32', ring: 'ring-amber-600', bg: 'bg-amber-600/10', text: 'text-amber-500' },
  SILVER: { name: 'Silver', min: 100, max: 499, color: '#C0C0C0', ring: 'ring-gray-400', bg: 'bg-gray-400/10', text: 'text-gray-400' },
  GOLD: { name: 'Gold', min: 500, max: 1499, color: '#F5C542', ring: 'ring-brand-gold', bg: 'bg-brand-gold/10', text: 'text-brand-gold' },
  PLATINUM: { name: 'Platinum', min: 1500, max: 1999, color: '#60A5FA', ring: 'ring-blue-400', bg: 'bg-blue-400/10', text: 'text-blue-400' },
  DIAMOND: { name: 'Diamond Apex Elite', min: 2000, max: Infinity, color: '#B44FFF', ring: 'ring-brand-violet', bg: 'bg-brand-violet/10', text: 'text-brand-violet-light', holographic: true },
};

export function getTier(coinsSpent = 0) {
  if (coinsSpent >= 2000) return TIERS.DIAMOND;
  if (coinsSpent >= 1500) return TIERS.PLATINUM;
  if (coinsSpent >= 500) return TIERS.GOLD;
  if (coinsSpent >= 100) return TIERS.SILVER;
  return TIERS.BRONZE;
}

export function getTierProgress(coinsSpent = 0) {
  const tier = getTier(coinsSpent);
  if (tier === TIERS.DIAMOND) return 100;
  const progress = ((coinsSpent - tier.min) / (tier.max - tier.min + 1)) * 100;
  return Math.min(progress, 100);
}

export function getNextTier(coinsSpent = 0) {
  if (coinsSpent >= 2000) return null;
  if (coinsSpent >= 1500) return TIERS.DIAMOND;
  if (coinsSpent >= 500) return TIERS.PLATINUM;
  if (coinsSpent >= 100) return TIERS.GOLD;
  return TIERS.SILVER;
}

export function formatCoins(amount) {
  // Ensure amount is a number
  const num = Number(amount) || 0;
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

// Engagement count under a button: 0, 999, 1.2K, 12K, 1M. Zero is printed, not
// hidden: a blank space under a heart reads as "no counter", which is exactly
// what the clip rails showed on every new clip. 999,950 becomes 1M, where the
// rails' own copies printed "1000.0K".
export function compactCount(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v < 1000) return String(v);
  const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (let i = 0; i < units.length; i++) {
    const [size, suffix] = units[i];
    if (v < size) continue;
    const r = Math.round((v / size) * 10) / 10;
    if (r >= 1000 && i > 0) {
      const [up, upSuffix] = units[i - 1];
      return String(Math.round((v / up) * 10) / 10).replace(/\.0$/, '') + upSuffix;
    }
    return String(r).replace(/\.0$/, '') + suffix;
  }
  return String(v);
}

export function timeAgo(date) {
  if (!date) return '';
  // Handle Firestore Timestamp objects
  const d = date?.toDate ? date.toDate() : (date instanceof Date ? date : new Date(date));
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const seconds = Math.floor((now - d) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
// Is this post SHORT-FORM (the immersive, vertically scrolled format) rather
// than a long-form video post?
//
// Founder, 2026-09-12: a YouTube Short and a YouTube video "are formatted and
// sized differently, one gets a screen with the user info and coments and
// related videos below it, and the other is a feed that gets scrolled like
// tiktok". A clip had been falling through every surface as a video post.
//
// ONE definition on purpose: PostCard decides the feed SHAPE from this, the
// Explore tiles decide the DESTINATION from it, and ShortsDeck queries the
// same two types. Three copies of this test is how they drift apart.
export const SHORT_FORMAT_TYPES = ['clip', 'short'];
export const isShortFormat = (type) => SHORT_FORMAT_TYPES.includes(type);

// Does this post belong in the FEED: the profile Posts tab and the home feeds?
//
// Instagram's model, founder 2026-09-14 ("keep it as close as possible to what
// they are already familiar with"): every clip lives in the Clips tab and the
// clips feed, and "Also share to feed" (on by default) ALSO puts it on the
// profile Posts tab and in followers' home feeds. Turned off, the clip is in
// Clips only. A clip with no field was posted before the choice existed and was
// already in the feed, so absent means shared.
//
// ONE definition: every Posts tab and every home feed filters through this.
export const sharesToFeed = (post) => !isShortFormat(post?.type) || post?.shareToFeed !== false;

// The profile Media tab: photos and long-form video. Clips have their own tab.
// ⚠ It used to test `imageUrl || videoUrl`, fields no current post writes
// (media lives in `mediaUrls`), so the tab was empty for almost everyone.
export const isMediaPost = (post) => !!post && !isShortFormat(post.type)
  && !!(post.mediaUrls?.length || post.mediaUrl || post.imageUrl || post.videoUrl);
