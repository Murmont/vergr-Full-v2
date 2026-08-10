// CommonJS mirror of src/utils/vanguardRanks.js — Cloud Functions need the
// same metadata for the inviteToVanguard callable, the treasury cron, the
// convertCoinsToGems waiver, the stipend cron, the VP rank-up check, and
// the paid-referral milestone grants. Keep both files in sync.
//
// Economics locked 2026-05-16. Treasury weights widened (1/2/4/8), VP
// thresholds set, stipend ladder keyed by platform MRR brackets.

const VANGUARD_RANKS = [
  {
    id: 'recruit', order: 1, label: 'Recruit', usernameTag: 'Recruit',
    actionVp: 10, treasuryWeight: 0, silentJoin: false,
    vpThreshold: 0,
    stipendCoinsByMrr: { 10000: 0, 25000: 0, 50000: 0, 100000: 0 },
  },
  {
    id: 'vanguard', order: 2, label: 'Vanguard', usernameTag: 'Vanguard',
    actionVp: 50, treasuryWeight: 1.0, silentJoin: false,
    vpThreshold: 25_000,
    stipendCoinsByMrr: { 10000: 0, 25000: 0, 50000: 0, 100000: 0 },
  },
  {
    id: 'senior', order: 3, label: 'Senior Vanguard', usernameTag: 'Senior Vanguard',
    actionVp: 100, treasuryWeight: 2.0, silentJoin: false,
    vpThreshold: 250_000,
    stipendCoinsByMrr: { 10000: 10_000, 25000: 15_000, 50000: 20_000, 100000: 30_000 },
  },
  {
    id: 'commander', order: 4, label: 'Commander', usernameTag: 'Commander',
    actionVp: 200, treasuryWeight: 4.0, silentJoin: false,
    vpThreshold: 1_000_000,
    stipendCoinsByMrr: { 10000: 30_000, 25000: 45_000, 50000: 60_000, 100000: 90_000 },
  },
  {
    id: 'overseer', order: 5, label: 'Overseer', usernameTag: 'Overseer',
    actionVp: 500, treasuryWeight: 8.0, silentJoin: true,
    vpThreshold: 5_000_000,
    stipendCoinsByMrr: { 10000: 75_000, 25000: 110_000, 50000: 150_000, 100000: 225_000 },
  },
];

const RANK_BY_ID = Object.fromEntries(VANGUARD_RANKS.map(r => [r.id, r]));
const RANK_IDS = VANGUARD_RANKS.map(r => r.id);

const REFERRAL_VP_MILESTONES = {
  signup:        500,
  firstPurchase: 2_500,
  subscription:  5_000,
};

const STIPEND_MRR_BRACKETS = [10_000, 25_000, 50_000, 100_000];

function stipendForRank(rankId, mrrEur) {
  const rank = RANK_BY_ID[rankId];
  if (!rank) return 0;
  const ladder = rank.stipendCoinsByMrr || {};
  const reached = STIPEND_MRR_BRACKETS.filter(m => mrrEur >= m).sort((a, b) => b - a)[0];
  if (!reached) return 0;
  return ladder[reached] || 0;
}

module.exports = {
  VANGUARD_RANKS,
  RANK_BY_ID,
  RANK_IDS,
  REFERRAL_VP_MILESTONES,
  STIPEND_MRR_BRACKETS,
  stipendForRank,
};
