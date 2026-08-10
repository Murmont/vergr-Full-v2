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