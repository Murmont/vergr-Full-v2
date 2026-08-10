// CommonJS mirror of src/utils/tournamentModeration.js — keep in sync.

const AUTO_DECIDED_GAMES = new Set([
  'Counter-Strike 2',
  'Dota 2',
  'Overwatch 2',
  'Apex Legends',
]);

const GAME_DURATION_MIN = {
  'Counter-Strike 2': 60, 'VALORANT': 75, 'Call of Duty': 60, 'Call of Duty: Warzone': 60,
  'Halo Infinite': 45, 'Rainbow Six Siege': 60, 'Overwatch 2': 45, 'CrossFire': 45,
  'Dota 2': 60, 'League of Legends': 45,
  'Apex Legends': 45, 'Fortnite': 45, 'PUBG': 45,
  'Rocket League': 25, 'EA Sports FC': 20, 'FIFA': 20, 'NBA 2K': 30,
  'Tekken': 30, 'Street Fighter 6': 30, 'Mortal Kombat': 30, 'Brawlhalla': 20,
  'Super Smash Bros. Ultimate': 30, 'Fall Guys': 25,
  'StarCraft II': 45, 'Age of Empires IV': 45,
  'World of Tanks': 20, 'World of Warships': 30, 'War Thunder': 30,
  'Hearthstone': 30, 'Magic: The Gathering Arena': 35,
};

const DEFAULT_GAME_DURATION_MIN = 60;
const gameDurationMin = (game) => GAME_DURATION_MIN[game] || DEFAULT_GAME_DURATION_MIN;

const TIER_BRACKETS = {
  small:  { maxPrize:    5_000, vpMult: 1.0, weightMult: 1.0, label: 'Standard' },
  medium: { maxPrize:   50_000, vpMult: 1.5, weightMult: 1.5, label: 'Weekly Cup' },
  large:  { maxPrize: Infinity, vpMult: 3.0, weightMult: 3.0, label: 'Championship' },
};

const tierForPrizePool = (prizePool) => {
  const p = Number(prizePool || 0);
  if (p <= TIER_BRACKETS.small.maxPrize)  return 'small';
  if (p <= TIER_BRACKETS.medium.maxPrize) return 'medium';
  return 'large';
};

const MIN_SCHEDULING_BUFFER_MIN = 60;
const CHECK_IN_OPEN_MIN_BEFORE = 15;
const NO_SHOW_GRACE_MIN = 10;
const MAX_CONCURRENT_ASSIGNMENTS = 2;

const requiresManualMod = (tournament) => {
  if (!tournament) return false;
  if (tournament.requiresManualMod === false) return false;
  if (tournament.vanguardModerated === true)  return true;
  return !AUTO_DECIDED_GAMES.has(tournament.game);
};

module.exports = {
  AUTO_DECIDED_GAMES,
  GAME_DURATION_MIN,
  DEFAULT_GAME_DURATION_MIN,
  gameDurationMin,
  TIER_BRACKETS,
  tierForPrizePool,
  MIN_SCHEDULING_BUFFER_MIN,
  CHECK_IN_OPEN_MIN_BEFORE,
  NO_SHOW_GRACE_MIN,
  MAX_CONCURRENT_ASSIGNMENTS,
  requiresManualMod,
};
