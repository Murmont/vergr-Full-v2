// VERGR tournament games registry — server-side mirror.
// If you change this, mirror src/utils/tournamentGames.js exactly.

const TOURNAMENT_GAMES = [
  { id: 'cs2',         label: 'Counter-Strike 2',  detection: 'gsi',     verifyMethod: 'chat',  linkedPlatform: 'steam' },
  { id: 'dota2',       label: 'Dota 2',            detection: 'gsi',     verifyMethod: 'chat',  linkedPlatform: 'steam' },
  { id: 'overwatch2',  label: 'Overwatch 2',       detection: 'wrapper', verifyMethod: 'chat',  linkedPlatform: 'battlenet' },
  { id: 'apex',        label: 'Apex Legends',      detection: 'wrapper', verifyMethod: 'chat',  linkedPlatform: 'origin' },
  { id: 'valorant',    label: 'VALORANT',          detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'riot' },
  { id: 'lol',         label: 'League of Legends', detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'riot' },
  { id: 'rocketleague',label: 'Rocket League',     detection: 'ocr',     verifyMethod: 'lobby_name', linkedPlatform: 'epic' },
  { id: 'fortnite',    label: 'Fortnite',          detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'epic' },
  { id: 'pubg',        label: 'PUBG: Battlegrounds', detection: 'ocr',   verifyMethod: 'chat',  linkedPlatform: 'steam' },
  { id: 'warzone',     label: 'Call of Duty: Warzone', detection: 'ocr', verifyMethod: 'name',  linkedPlatform: 'activision' },
  { id: 'cod_mw3',     label: 'Call of Duty: Modern Warfare III', detection: 'ocr', verifyMethod: 'name', linkedPlatform: 'activision' },
  { id: 'r6s',         label: 'Rainbow Six Siege', detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'ubisoft' },
  { id: 'sc2',         label: 'StarCraft II',      detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'battlenet' },
  { id: 'aoe4',        label: 'Age of Empires IV', detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'steam' },
  { id: 'aoe2de',      label: 'Age of Empires II: DE', detection: 'ocr', verifyMethod: 'chat',  linkedPlatform: 'steam' },
  { id: 'sf6',         label: 'Street Fighter 6',  detection: 'ocr',     verifyMethod: 'name',  linkedPlatform: 'steam' },
  { id: 'tekken8',     label: 'Tekken 8',          detection: 'ocr',     verifyMethod: 'name',  linkedPlatform: 'steam' },
  { id: 'mk1',         label: 'Mortal Kombat 1',   detection: 'ocr',     verifyMethod: 'name',  linkedPlatform: 'steam' },
  { id: 'ssbu',        label: 'Smash Bros Ultimate', detection: 'ocr',   verifyMethod: 'match_screen', linkedPlatform: 'nintendo' },
  { id: 'gg_strive',   label: 'Guilty Gear Strive',detection: 'ocr',     verifyMethod: 'name',  linkedPlatform: 'steam' },
  { id: 'fc25',        label: 'EA Sports FC 25 (FIFA)', detection: 'ocr', verifyMethod: 'match_screen', linkedPlatform: 'ea' },
  { id: 'nba2k',       label: 'NBA 2K',            detection: 'ocr',     verifyMethod: 'match_screen', linkedPlatform: 'steam' },
  { id: 'madden',      label: 'Madden NFL',        detection: 'ocr',     verifyMethod: 'match_screen', linkedPlatform: 'ea' },
  { id: 'nhl',         label: 'NHL',               detection: 'ocr',     verifyMethod: 'match_screen', linkedPlatform: 'ea' },
  { id: 'pes_efootball', label: 'eFootball',       detection: 'ocr',     verifyMethod: 'match_screen', linkedPlatform: 'steam' },
  { id: 'f1_25',       label: 'F1 25',             detection: 'ocr',     verifyMethod: 'match_screen', linkedPlatform: 'steam' },
  { id: 'gt7',         label: 'Gran Turismo 7',    detection: 'ocr',     verifyMethod: 'match_screen', linkedPlatform: 'psn' },
  { id: 'forza',       label: 'Forza Motorsport',  detection: 'ocr',     verifyMethod: 'match_screen', linkedPlatform: 'xbox' },
  { id: 'iracing',     label: 'iRacing',           detection: 'ocr',     verifyMethod: 'match_screen', linkedPlatform: 'steam' },
  { id: 'hearthstone', label: 'Hearthstone',       detection: 'ocr',     verifyMethod: 'name',  linkedPlatform: 'battlenet' },
  { id: 'lor',         label: 'Legends of Runeterra', detection: 'ocr',  verifyMethod: 'name',  linkedPlatform: 'riot' },
  { id: 'mtg_arena',   label: 'Magic: The Gathering Arena', detection: 'ocr', verifyMethod: 'name', linkedPlatform: 'wizards' },
  { id: 'tft',         label: 'Teamfight Tactics', detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'riot' },
  { id: 'brawlhalla',  label: 'Brawlhalla',        detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'steam' },
  { id: 'smite',       label: 'SMITE',             detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'steam' },
  { id: 'wow_arena',   label: 'WoW Arena',         detection: 'ocr',     verifyMethod: 'name',  linkedPlatform: 'battlenet' },
  { id: 'other',       label: 'Other (manual report)', detection: 'manual', verifyMethod: 'chat', linkedPlatform: null },
];

function gameById(idOrLabel) {
  if (!idOrLabel) return null;
  const needle = String(idOrLabel).toLowerCase().trim();
  return TOURNAMENT_GAMES.find((g) =>
    g.id === needle ||
    g.label.toLowerCase() === needle ||
    g.label.toLowerCase().replace(/[^a-z0-9]/g, '') === needle.replace(/[^a-z0-9]/g, '')
  ) || null;
}

const LOBBY_CAP_BY_GAME = {
  fortnite: 100, pubg: 100, warzone: 150, apex: 60,
  cs2: 10, valorant: 10, overwatch2: 12, r6s: 10, cod_mw3: 12,
  dota2: 10, lol: 10,
  fc25: 2, sf6: 2, tekken8: 2, mk1: 2, gg_strive: 2, ssbu: 8,
  rocketleague: 8,
  sc2: 8, aoe4: 8, aoe2de: 8,
};
const LOBBY_CAP_BY_CATEGORY = { BR: 100, FPS: 10, MOBA: 10, Fighting: 2, Sports: 2, RTS: 8 };

function getMaxLobbySize(gameId) {
  const explicit = LOBBY_CAP_BY_GAME[gameId];
  if (explicit) return explicit;
  const g = gameById(gameId);
  if (g && LOBBY_CAP_BY_CATEGORY[g.category]) return LOBBY_CAP_BY_CATEGORY[g.category];
  return 10;
}

function supportsBattleRoyale(gameId) {
  const g = gameById(gameId);
  return !!(g && g.category === 'BR') && getMaxLobbySize(gameId) >= 32;
}

module.exports = { TOURNAMENT_GAMES, gameById, getMaxLobbySize, supportsBattleRoyale };
