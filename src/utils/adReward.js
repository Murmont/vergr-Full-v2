// Watch 3 ads, get boost coins. Client mirror of functions/admobReward.js
// (adRewardConfig). The SERVER decides and pays; this only draws the counter.
// scripts/ad-reward-check.mjs fails the build if the defaults drift apart.

export const DEFAULT_ADS_PER_REWARD = 3;
export const DEFAULT_REWARD_BOOST_COINS = 75;
export const DEFAULT_REWARDS_PER_DAY = 3;
export const DEFAULT_REWARD_COUNTRIES = [
  'US', 'CA', 'GB', 'IE', 'AU', 'NZ', 'DE', 'AT', 'CH', 'NL', 'BE', 'FR',
  'DK', 'SE', 'NO', 'FI', 'JP', 'KR', 'AE', 'SA', 'QA', 'KW',
];

export function adRewardConfig(d) {
  const c = d || {};
  const pos = (v, def) => (Number(v) > 0 ? Math.floor(Number(v)) : def);
  return {
    adsPerReward: pos(c.adAdsPerReward, DEFAULT_ADS_PER_REWARD),
    rewardCoins: pos(c.adRewardBoostCoins, DEFAULT_REWARD_BOOST_COINS),
    rewardsPerDay: pos(c.adRewardsPerDay, DEFAULT_REWARDS_PER_DAY),
    countries: Array.isArray(c.adRewardCountries) && c.adRewardCountries.length
      ? c.adRewardCountries.map((x) => String(x).toUpperCase())
      : DEFAULT_REWARD_COUNTRIES,
  };
}

const utcDay = () => new Date().toISOString().slice(0, 10);

// Today's state from wallets/{uid}.adProgress (a stale day reads as zero).
export function adProgressToday(adProgress, conf) {
  const p = adProgress && adProgress.day === utcDay() ? adProgress : null;
  const watched = Math.max(0, Number(p?.watched) || 0);
  const rewardsToday = Math.max(0, Number(p?.rewardsToday) || 0);
  return { watched, rewardsToday, doneForToday: rewardsToday >= conf.rewardsPerDay };
}

// Local time the counter resets (next UTC midnight), for "back at 02:00".
export function nextResetLabel() {
  const d = new Date();
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return new Date(next).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
