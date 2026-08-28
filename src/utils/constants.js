// App-wide constants - no dummy data

export const GAMING_INTERESTS = [
  'FPS', 'RPG', 'Battle Royale', 'MOBA', 'MMO', 'Sports', 'Racing',
  'Fighting', 'Strategy', 'Simulation', 'Horror', 'Indie', 'Puzzle',
  'Platformer', 'Survival', 'Open World', 'Esports', 'Speedrunning',
  'Retro Gaming', 'Mobile Gaming', 'VR Gaming', 'Streaming', 'Game Dev',
];

// Broad content taxonomy — Vergr is a general social platform, not everything is
// gaming. These are the declared-interest topics (signup + Edit Profile) and the
// scoring-time topic buckets for the For You feed. Gaming is ONE topic here; the
// ranking is behavioral-first (author + hashtag affinity) so untagged/non-gaming
// posts still personalize. Keep this list stable — changing labels breaks stored
// interests.
export const CONTENT_TOPICS = [
  'Gaming', 'Esports', 'Just Chatting', 'IRL', 'Music', 'Art & Creative',
  'Tech', 'Memes & Comedy', 'Sports', 'Anime & Manga', 'Movies & TV',
  'Lifestyle', 'Food & Cooking', 'Fitness & Health', 'Fashion & Beauty',
  'Science & Education', 'News', 'Cars & Motors', 'Travel', 'Crypto & Finance',
];

export const GAMING_PLATFORMS = [
  'PC', 'PlayStation', 'Xbox', 'Nintendo Switch', 'Mobile',
];

export const SQUAD_ROLES = {
  president: { label: 'President', desc: 'Makes final decisions. Can veto any representative choice.', icon: '👑', canDistribute: true, canVeto: true },
  vice_president: { label: 'Vice President', desc: 'Can start a vote for new president if inactive 4+ days.', icon: '⭐', canDistribute: false, canVeto: false },
  treasury: { label: 'Treasury Secretary', desc: 'Manages squad wallet, coin distribution, and event entry fees.', icon: '💰', canDistribute: true, canVeto: false },
  security: { label: 'Security / General', desc: 'Moderates squad chat. Can mute members and start kick votes.', icon: '🛡️', canDistribute: false, canVeto: false },
  member: { label: 'Member', desc: 'Standard squad member. Can vote, contribute coins, and participate.', icon: '⚔️', canDistribute: false, canVeto: false },
};

// Squad economics
// When a squad member wins a tournament, this % auto-goes to squad treasury
export const SQUAD_CONTRIBUTION_RATE = 0.10; // 10% of tournament winnings

// Tournament economics
// Prize pool split AFTER moderator fee is taken
export const TOURNAMENT_MOD_FEE_RATE = 0.05; // 5% to tournament admin/moderator
export const TOURNAMENT_PRIZE_SPLITS = {
  first: 0.60,   // 60% of remaining pool
  second: 0.25,  // 25%
  third: 0.075,  // 7.5% each for 3rd/4th
};

// Moderator earnings (how mods make money):
// 1. Tournament moderation fee: 5% of prize pool for running a tournament
// 2. Platform can pay mods per-report reviewed (future — admin sets rate)
// 3. Squad security role earns nothing automatic — it's a volunteer position
// Revenue stays positive because:
// - Mod fee comes from the prize pool (player entry fees), not from the platform
// - Platform earns from: coin purchases, its revenue share (50-80% goes to the creator), subscription fees
// - Mods earn from: tournament fees (already player-funded)

export const MUTE_DURATIONS = [
  { label: '1 hour', ms: 3600000 },
  { label: '8 hours', ms: 28800000 },
  { label: '3 days', ms: 259200000 },
  { label: '1 week', ms: 604800000 },
  { label: '1 month', ms: 2592000000 },
];

export const COIN_TO_EUR = 0.01; // 1 coin = €0.008

export const MAX_SQUADS_PER_USER = 1; // User can be in 1 squad + create their own
export const MAX_SQUAD_OWN = 1; // User can own 1 squad

export const REPORT_REASONS = [
  'Spam or scam',
  'Harassment or bullying',
  'Hate speech',
  'Inappropriate content',
  'Cheating or exploiting',
  'Impersonation',
  'Other',
];
