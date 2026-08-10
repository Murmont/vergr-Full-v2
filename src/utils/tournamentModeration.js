// Tournament moderation — shared constants for the assignment system.
// Mirrored on the server at functions/tournamentModeration.js. Keep in sync.
//
// LOCKED 2026-05-16:
// - Games NOT in AUTO_DECIDED_GAMES require a manual Vanguard moderator.
// - Tournaments must be scheduled at least 1 hour in advance to allow claiming.
// - Mods claim slots; no auto-assignment. Founder is never auto-assigned.
// - VP + treasury-weight multipliers based on prize-pool tier.
// - Schedule conflict detection uses GAME_DURATION_MIN (approx) per game.

// Games auto-decided by GSI / community APIs — DO NOT need a mod present.
export const AUTO_DECIDED_GAMES = new Set([
  'Counter-Strike 2',
  'Dota 2',
  'Overwatch 2',
  'Apex Legends',
]);

// Estimated minutes per match for each game we support. Used for conflict
// detection: a mod claiming a tournament starting at 13:00 with a 60-min
// duration is blocked from claiming any tournament starting in [13:00, 14:00).
// Estimates are conservative — better to be over than under.
export const GAME_DURATION_MIN = {
  // First-person shooters
  'Counter-Strike 2':       60,   // MR12 BO1 ~45-60 min
  'VALORANT':               75,   // BO1 first to 13 ~60-75 min
  'Call of Duty':           60,   // 4-round series
  'Call of Duty: Warzone':  60,
  'Halo Infinite':          45,   // BO3 quick series
  'Rainbow Six Siege':      60,
  'Overwatch 2':            45,   // wrapped, but here for completeness
  'CrossFire':              45,
  // MOBA
  'Dota 2':                 60,
  'League of Legends':      45,
  // Battle royale / extraction
  'Apex Legends':           45,   // wrapped, but here for completeness
  'Fortnite':               45,
  'PUBG':                   45,
  // Racing / sports
  'Rocket League':          25,   // BO5
  'EA Sports FC':           20,   // 2 × 6-min halves + breaks
  'FIFA':                   20,
  'NBA 2K':                 30,
  // Fighters
  'Tekken':                 30,   // BO5
  'Street Fighter 6':       30,
  'Mortal Kombat':          30,
  'Brawlhalla':             20,
  // Platformers / party
  'Super Smash Bros. Ultimate': 30,
  'Fall Guys':              25,
  // Strategy
  'StarCraft II':           45,   // BO3
  'Age of Empires IV':      45,
  // Other competitive
  'World of Tanks':         20,
  'World of Warships':      30,
  'War Thunder':            30,
  // Card games — KEEP. NO board games.
  'Hearthstone':            30,
  'Magic: The Gathering Arena': 35,
};

// Default if a game isn't in the map. Conservative: 60 min.
export const DEFAULT_GAME_DURATION_MIN = 60;

export const gameDurationMin = (game) => GAME_DURATION_MIN[game] || DEFAULT_GAME_DURATION_MIN;

// Tier multipliers based on prize-pool size (in VERGR coins).
// Bigger pool = more attention required + bigger reward to the mod.
//   small  ≤ 5,000 coins                — local Friday lobby
//   medium 5,001 – 50,000 coins         — weekly cup
//   large  50,001+ coins                — championship / sponsored cup
export const TIER_BRACKETS = {
  small:  { maxPrize:    5_000, vpMult: 1.0, weightMult: 1.0, label: 'Standard' },
  medium: { maxPrize:   50_000, vpMult: 1.5, weightMult: 1.5, label: 'Weekly Cup' },
  large:  { maxPrize: Infinity, vpMult: 3.0, weightMult: 3.0, label: 'Championship' },
};

export const tierForPrizePool = (prizePool) => {
  const p = Number(prizePool || 0);
  if (p <= TIER_BRACKETS.small.maxPrize)  return 'small';
  if (p <= TIER_BRACKETS.medium.maxPrize) return 'medium';
  return 'large';
};

// Minimum scheduling buffer — tournaments starting sooner than this can't
// be assigned to a Vanguard (host either moderates themselves or platform
// auto-resolves).
export const MIN_SCHEDULING_BUFFER_MIN = 60;

// Check-in window — mod can check in starting N minutes before tournament start.
export const CHECK_IN_OPEN_MIN_BEFORE = 15;

// No-show threshold — if check-in hasn't happened within N minutes AFTER
// scheduled start, the assignment is flagged as no-show and reopens.
export const NO_SHOW_GRACE_MIN = 10;

// Concurrent assignment cap — max active or upcoming assignments a mod can
// hold at once (excluding completed/cancelled).
export const MAX_CONCURRENT_ASSIGNMENTS = 2;

// No-show consequences — count strikes in last 30 days.
//   1st miss → logged warning (just an audit entry)
//   2nd miss → formal warning + 50% VP debit for the month
//   3rd miss → suspension review queued
export const NO_SHOW_LADDER = {
  1: { type: 'logged_warning', label: 'Logged warning' },
  2: { type: 'formal_warning_50pct', label: 'Formal warning + 50% monthly VP debit' },
  3: { type: 'suspension_review',    label: 'Suspension review queued' },
};

// Helper: does this tournament require a manual mod?
export const requiresManualMod = (tournament) => {
  if (!tournament) return false;
  if (tournament.requiresManualMod === false) return false; // explicit opt-out
  if (tournament.vanguardModerated === true)  return true;  // explicit opt-in
  return !AUTO_DECIDED_GAMES.has(tournament.game);
};
