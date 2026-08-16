// View-model that merges the two source-of-truth systems for the /prestige page:
//   - vpSystem.js  → level/commission/discount/reaction/prestige MATH (11 ranks)
//   - badgeSystem.js → badge ART + ring colours (30 .webp files)
// Both the web (PrestigeLevelsScreen) and native (NativePrestigeLevelsScreen)
// screens render the SAME PrestigeShowcase off this model, so they never drift.
import { RANK_TIERS, VP_LEVELS } from '../../utils/vpSystem';
import { BADGE_RANKS } from '../../utils/badgeSystem';

const lvlInfo = (n) => VP_LEVELS[Math.max(0, Math.min(99, n - 1))];

// Badge art for a vpSystem rank. The lower 9 ranks line up 1:1 with badgeSystem;
// Ascendant (L91-99) reuses the badgeSystem Ascendant band; Immortal (L100) shows
// the top Ascendant crest (per the badgeSystem comment) as its single crest.
function badgesForRank(rank) {
  const asc = BADGE_RANKS.find(r => r.id === 'ascendant');
  if (rank.name === 'Immortal') {
    const top = asc.tiers[asc.tiers.length - 1];
    return [{ art: top.art, label: 'L100', min: 100 }];
  }
  const band = BADGE_RANKS.find(r => r.minLevel === rank.min) || asc;
  return band.tiers.map(t => ({ art: t.art, label: t.label, min: t.min }));
}

// 11 rank view-models, ordered Rookie → Immortal.
export const RANK_VIEWS = RANK_TIERS.map((rank) => {
  const first = lvlInfo(rank.min);
  const last = lvlInfo(rank.max);
  return {
    id: rank.name.toLowerCase(),
    name: rank.name,
    min: rank.min,
    max: rank.max,
    ringColor: rank.ringColor,
    vpToEnter: first.vpRequired,
    commissionStart: first.commission,
    commissionEnd: last.commission,
    badges: badgesForRank(rank),
    // Top ranks get the looping shimmer (mirrors badgeSystem `animated`).
    animated: ['Mythic', 'Ascendant', 'Immortal'].includes(rank.name),
  };
});

export const getRankView = (level) => {
  const l = Math.max(1, Math.min(100, level || 1));
  return RANK_VIEWS.find(r => l >= r.min && l <= r.max) || RANK_VIEWS[0];
};

// Lifetime badge total across all ranks (3 per band × 10 bands).
export const TOTAL_BADGES = 30;

// Friendly labels + icons for the VP_ACTIONS earning table, highest-value first.
// `custom` overrides the flat "+N VP" amount for non-flat earners (e.g. gifting,
// which scales with coins sent and is capped daily — see GIFT_* in vpSystem).
export const EARN_ITEMS = [
  { key: 'host_event',       label: 'Host a live event', icon: 'confirmation_number' },
  { key: 'win_match',        label: 'Win a match',       icon: 'sports_esports' },
  { key: 'gift',             label: 'Gift / tip a creator', icon: 'redeem', custom: '+1 VP / 25c' },
  { key: 'go_live',          label: 'Go live',           icon: 'sensors' },
  { key: 'complete_quest',   label: 'Complete a quest',  icon: 'task_alt' },
  { key: 'purchase_coins',   label: 'Buy coins',         icon: 'paid' },
  { key: 'stream_hour',      label: 'Per hour streamed', icon: 'videocam' },
  { key: 'create_post',      label: 'Create a post',     icon: 'add_box' },
  { key: 'daily_streak_5',   label: '5-day login streak', icon: 'local_fire_department' },
  { key: 'boost_post',       label: 'Boost a post',      icon: 'rocket_launch' },
  { key: 'daily_login',      label: 'Daily login',       icon: 'login' },
  { key: 'get_comment',      label: 'Get a comment',     icon: 'chat_bubble' },
  { key: 'get_like',         label: 'Get a like',        icon: 'favorite' },
];
