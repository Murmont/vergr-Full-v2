// Single source of truth for the Vanguard rank ladder.
// Spec lives in CLAUDE.md → "Vanguard moderator program — LOCKED SPEC".
//
// Don't import from outside `src/` directly — both the client and the
// Cloud Functions need this metadata. Cloud Functions import via a small
// mirror at `functions/vanguardRanks.js` (CommonJS shim) — keep both files
// in sync when you change anything.
//
// Economics (locked 2026-05-16):
// - `vpThreshold` is cumulative lifetime VP needed for auto-eligibility. Commander
//   and Overseer are gated by founder approval regardless of VP.
// - `treasuryWeight` is the share multiplier in the monthly treasury split.
//   Self-funded by the 5% tournament mod cut on tournaments the mod presided over.
// - `stipendCoinsByMrr` is the Tier B coin stipend ladder keyed by platform
//   MRR thresholds (in EUR). Funded from `app_revenue/tournaments` first, then
//   `app_revenue/tips` as a fallback. Activates ONLY when `app_config/general
//   .tierBPerksActive === true` AND the lookup MRR bracket is reached.

export const VANGUARD_RANKS = [
  {
    id: 'recruit',
    order: 1,
    label: 'Recruit',
    usernameTag: 'Recruit',
    avatar: '/vanguard/recruit-avatar.webp',
    badge:  '/vanguard/recruit-badge.webp',
    join:   '/vanguard/recruit-join.webp',
    actionVp: 10,
    treasuryWeight: 0, // Recruits don't get a share until promoted
    vpThreshold: 0,
    stipendCoinsByMrr: { 10000: 0, 25000: 0, 50000: 0, 100000: 0 },
    authority: {
      readOnly: true,
      canApproveReject: false,
      canMute: false,
      canTempBan: false,
      canPermaBan: false,
      canPromote: false,
      canSeeAuditLog: false,
      canSeeRealIdentities: true,   // can see other Vanguard members' real id
      announcesJoin: true,
      canRemoveModerator: false,
      canSpawnUnlimitedSquad: false,
    },
    blurb: 'Shadow seniors in the moderation queue and tournament rooms. No live actions until promoted.',
  },
  {
    id: 'vanguard',
    order: 2,
    label: 'Vanguard',
    usernameTag: 'Vanguard',
    avatar: '/vanguard/vanguard-avatar.webp',
    badge:  '/vanguard/vanguard-badge.webp',
    join:   '/vanguard/vanguard-join.webp',
    actionVp: 50,
    treasuryWeight: 1.0,
    vpThreshold: 25_000,
    stipendCoinsByMrr: { 10000: 0, 25000: 0, 50000: 0, 100000: 0 },
    authority: {
      readOnly: false,
      canApproveReject: true,
      canMute: true,           // ≤ 24 hours
      muteMaxHours: 24,
      canTempBan: false,
      canPermaBan: false,
      canPromote: false,
      canSeeAuditLog: false,
      canSeeRealIdentities: true,
      announcesJoin: true,
      canRemoveModerator: false,
      canSpawnUnlimitedSquad: false,
    },
    blurb: 'Approve / reject reports, call manual tournament winners, mute users up to 24 hours.',
  },
  {
    id: 'senior',
    order: 3,
    label: 'Senior Vanguard',
    usernameTag: 'Senior Vanguard',
    avatar: '/vanguard/senior-avatar.webp',
    badge:  '/vanguard/senior-badge.webp',
    join:   '/vanguard/senior-join.webp',
    actionVp: 100,
    treasuryWeight: 2.0,
    vpThreshold: 250_000,
    stipendCoinsByMrr: { 10000: 10_000, 25000: 15_000, 50000: 20_000, 100000: 30_000 },
    authority: {
      readOnly: false,
      canApproveReject: true,
      canMute: true,
      muteMaxHours: 168,           // 7 days
      canTempBan: true,
      tempBanMaxDays: 30,
      canPermaBan: false,
      canPromote: false,
      canSeeAuditLog: false,
      canSeeRealIdentities: true,
      announcesJoin: true,
      canRemoveModerator: false,
      canSpawnUnlimitedSquad: false,
    },
    blurb: 'Temp-ban up to 30 days, resolve mod-vs-mod disputes, assign cases to Recruits.',
  },
  {
    id: 'commander',
    order: 4,
    label: 'Commander',
    usernameTag: 'Commander',
    avatar: '/vanguard/commander-avatar.webp',
    badge:  '/vanguard/commander-badge.webp',
    join:   '/vanguard/commander-join.webp',
    actionVp: 200,
    treasuryWeight: 4.0,
    vpThreshold: 1_000_000,            // founder approval also required
    stipendCoinsByMrr: { 10000: 30_000, 25000: 45_000, 50000: 60_000, 100000: 90_000 },
    authority: {
      readOnly: false,
      canApproveReject: true,
      canMute: true,
      muteMaxHours: 720,           // 30 days
      canTempBan: true,
      tempBanMaxDays: 365,
      canPermaBan: true,
      canPromote: true,            // can promote Recruit → Vanguard (not above)
      maxPromoteRank: 'vanguard',
      canSeeAuditLog: true,
      canSeeRealIdentities: true,
      announcesJoin: true,
      canRemoveModerator: true,    // can yank a Vanguard from a stream/match
      canSpawnUnlimitedSquad: false,
    },
    blurb: 'Permaban, promote Recruit → Vanguard, approve high-stakes rulings, remove moderators from streams.',
  },
  {
    id: 'overseer',
    order: 5,
    label: 'Overseer',
    usernameTag: 'Overseer',
    avatar: '/vanguard/overseer-avatar.webp',
    badge:  '/vanguard/overseer-badge.webp',
    join:   '/vanguard/overseer-join.webp',
    actionVp: 500,
    treasuryWeight: 8.0,
    vpThreshold: 5_000_000,            // founder approval also required
    stipendCoinsByMrr: { 10000: 75_000, 25000: 110_000, 50000: 150_000, 100000: 225_000 },
    authority: {
      readOnly: false,
      canApproveReject: true,
      canMute: true,
      muteMaxHours: null,          // unlimited
      canTempBan: true,
      tempBanMaxDays: null,
      canPermaBan: true,
      canPromote: true,            // can promote up to Commander (only founder makes Overseers)
      maxPromoteRank: 'commander',
      canSeeAuditLog: true,
      canSeeRealIdentities: true,
      announcesJoin: false,        // joins SILENTLY — they audit other mods
      canRemoveModerator: true,
      canSpawnUnlimitedSquad: true,
    },
    blurb: 'Full control. Promote/demote any rank. Audit other moderators. Spawn unlimited-cap squads.',
  },
];

export const RANK_BY_ID = Object.fromEntries(VANGUARD_RANKS.map(r => [r.id, r]));
export const RANK_IDS = VANGUARD_RANKS.map(r => r.id);

// Tags that normal users CANNOT use as their username (case-insensitive).
// Defended in createSquad + signup flow.
export const RESERVED_USERNAMES = VANGUARD_RANKS.map(r => r.usernameTag.toLowerCase());

export const rankMeta = (rankId) => RANK_BY_ID[rankId] || RANK_BY_ID.recruit;
export const isHigherRank = (a, b) => (RANK_BY_ID[a]?.order || 0) > (RANK_BY_ID[b]?.order || 0);
export const rankAtOrAbove = (a, b) => (RANK_BY_ID[a]?.order || 0) >= (RANK_BY_ID[b]?.order || 0);

// Referral VP milestones — paid-referral gating (locked 2026-05-16).
// Stops free-signup farming dead. One referee can earn all three.
export const REFERRAL_VP_MILESTONES = {
  signup:       500,    // referee creates account
  firstPurchase: 2_500, // referee buys ANY coin pack
  subscription:  5_000, // referee starts Lite or Pro
};

// MRR thresholds (EUR) for the Tier B stipend ladder. The cron picks the
// HIGHEST bracket the platform has reached. Below €10k MRR no stipend pays.
export const STIPEND_MRR_BRACKETS = [10_000, 25_000, 50_000, 100_000];

// Helpers ────────────────────────────────────────────────────────────────────
export function nextRankForVp(currentRankId, vp) {
  const cur = RANK_BY_ID[currentRankId];
  if (!cur) return null;
  const next = VANGUARD_RANKS.find((r) => r.order === cur.order + 1);
  if (!next) return null;
  return { rank: next, eligible: vp >= next.vpThreshold };
}

export function stipendForRank(rankId, mrrEur) {
  const rank = RANK_BY_ID[rankId];
  if (!rank) return 0;
  // Pick the highest bracket whose key ≤ current MRR.
  const ladder = rank.stipendCoinsByMrr || {};
  const reached = STIPEND_MRR_BRACKETS.filter((m) => mrrEur >= m).sort((a, b) => b - a)[0];
  if (!reached) return 0;
  return ladder[reached] || 0;
}

// Default reserved squad names. Editable at runtime via
// `app_config/reservedSquadNames.names` for the founder dashboard.
export const DEFAULT_RESERVED_SQUAD_NAMES = [
  'vanguard', 'vergr', 'vergr admin', 'admin', 'staff',
  'moderator', 'mod', 'support', 'team vergr',
];
