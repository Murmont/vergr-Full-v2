// VERGR tournament games registry — single source of truth for which games
// can be played in tournaments + how each one is verified.
//
// Non-mobile only (per founder mandate 2026-05-24): mobile devices can WATCH
// tournaments but cannot participate. So we exclude mobile-exclusive titles.
//
// Each entry tells the rest of the system:
//   - `detection`        result detection tier: 'gsi' | 'wrapper' | 'ocr' | 'manual'
//   - `verifyMethod`     how the participant displays the lobbyCode pre-match:
//                          'chat'        — type in lobby/in-game chat
//                          'name'        — temporarily set in-game name
//                          'lobby_name'  — set as custom lobby name (host)
//                          'match_screen'— OCR detects opponent's gamertag in
//                                          the match-setup / friend-invite UI
//   - `linkedPlatform`   recommended platform to connect for handle stamping
//   - `comingSoon`       block creation until we finish that integration
//   - `liveScore`        AC1 in-match scoreboard crop region (fractions 0-1 of
//                          the frame: {x,y,w,h}). The vergr-ocr box reads its
//                          own mirror of these and OCRs the cropped region every
//                          10s, writing match.liveScore.{uid}. Only the few
//                          calibrated games have it. Refine vs a real broadcast
//                          frame; the Go mirror lives in infra/vergr-ocr/main.go.
//
// See `functions/games.js` for the matching CommonJS mirror used by callables.

export const TOURNAMENT_GAMES = [
  // ── Tier-A: Valve GSI (real-time game-end events) ────────────────────
  { id: 'cs2',         label: 'Counter-Strike 2',  category: 'FPS',     detection: 'gsi',     verifyMethod: 'chat',  linkedPlatform: 'steam', liveScore: { x: 0.43, y: 0.00, w: 0.14, h: 0.08 } },
  { id: 'dota2',       label: 'Dota 2',            category: 'MOBA',    detection: 'gsi',     verifyMethod: 'chat',  linkedPlatform: 'steam' },

  // ── Tier-B: community stats APIs (post-match polling) ────────────────
  { id: 'overwatch2',  label: 'Overwatch 2',       category: 'FPS',     detection: 'wrapper', verifyMethod: 'chat',  linkedPlatform: 'battlenet' },
  { id: 'apex',        label: 'Apex Legends',      category: 'BR',      detection: 'wrapper', verifyMethod: 'chat',  linkedPlatform: 'origin' },

  // ── Tier-OCR: live-stream scoreboard read (works for any visible HUD) ─
  { id: 'valorant',    label: 'VALORANT',          category: 'FPS',     detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'riot' },
  { id: 'lol',         label: 'League of Legends', category: 'MOBA',    detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'riot' },
  { id: 'rocketleague',label: 'Rocket League',     category: 'Sports',  detection: 'ocr',     verifyMethod: 'lobby_name', linkedPlatform: 'epic' },
  { id: 'fortnite',    label: 'Fortnite',          category: 'BR',      detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'epic' },
  { id: 'pubg',        label: 'PUBG: Battlegrounds', category: 'BR',    detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'steam' },
  { id: 'warzone',     label: 'Call of Duty: Warzone', category: 'BR',  detection: 'ocr',     verifyMethod: 'name',  linkedPlatform: 'activision' },
  { id: 'cod_mw3',     label: 'Call of Duty: Modern Warfare III', category: 'FPS', detection: 'ocr', verifyMethod: 'name', linkedPlatform: 'activision' },
  { id: 'r6s',         label: 'Rainbow Six Siege', category: 'FPS',     detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'ubisoft' },
  { id: 'sc2',         label: 'StarCraft II',      category: 'RTS',     detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'battlenet' },
  { id: 'aoe4',        label: 'Age of Empires IV', category: 'RTS',     detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'steam' },
  { id: 'aoe2de',      label: 'Age of Empires II: DE', category: 'RTS', detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'steam' },

  // ── Fighting games (round-based, OCR works great on score panel) ─────
  { id: 'sf6',         label: 'Street Fighter 6',  category: 'Fighting',detection: 'ocr',     verifyMethod: 'name',  linkedPlatform: 'steam' },
  { id: 'tekken8',     label: 'Tekken 8',          category: 'Fighting',detection: 'ocr',     verifyMethod: 'name',  linkedPlatform: 'steam' },
  { id: 'mk1',         label: 'Mortal Kombat 1',   category: 'Fighting',detection: 'ocr',     verifyMethod: 'name',  linkedPlatform: 'steam' },
  { id: 'ssbu',        label: 'Smash Bros Ultimate', category: 'Fighting', detection: 'ocr',  verifyMethod: 'match_screen', linkedPlatform: 'nintendo' },
  { id: 'gg_strive',   label: 'Guilty Gear Strive',category: 'Fighting',detection: 'ocr',     verifyMethod: 'name',  linkedPlatform: 'steam' },

  // ── Sports games (FIFA-style — invite via platform friends list) ────
  { id: 'fc25',        label: 'EA Sports FC 25 (FIFA)', category: 'Sports', detection: 'ocr', verifyMethod: 'match_screen', linkedPlatform: 'ea', liveScore: { x: 0.02, y: 0.02, w: 0.30, h: 0.09 } },
  { id: 'nba2k',       label: 'NBA 2K',            category: 'Sports',  detection: 'ocr',     verifyMethod: 'match_screen', linkedPlatform: 'steam', liveScore: { x: 0.36, y: 0.02, w: 0.28, h: 0.10 } },
  { id: 'madden',      label: 'Madden NFL',        category: 'Sports',  detection: 'ocr',     verifyMethod: 'match_screen', linkedPlatform: 'ea' },
  { id: 'nhl',         label: 'NHL',               category: 'Sports',  detection: 'ocr',     verifyMethod: 'match_screen', linkedPlatform: 'ea' },
  { id: 'pes_efootball',label: 'eFootball',        category: 'Sports',  detection: 'ocr',     verifyMethod: 'match_screen', linkedPlatform: 'steam' },

  // ── Racing ───────────────────────────────────────────────────────────
  { id: 'f1_25',       label: 'F1 25',             category: 'Racing',  detection: 'ocr',     verifyMethod: 'match_screen', linkedPlatform: 'steam' },
  { id: 'gt7',         label: 'Gran Turismo 7',    category: 'Racing',  detection: 'ocr',     verifyMethod: 'match_screen', linkedPlatform: 'psn' },
  { id: 'forza',       label: 'Forza Motorsport',  category: 'Racing',  detection: 'ocr',     verifyMethod: 'match_screen', linkedPlatform: 'xbox' },
  { id: 'iracing',     label: 'iRacing',           category: 'Racing',  detection: 'ocr',     verifyMethod: 'match_screen', linkedPlatform: 'steam' },

  // ── Card / strategy ──────────────────────────────────────────────────
  { id: 'hearthstone', label: 'Hearthstone',       category: 'Card',    detection: 'ocr',     verifyMethod: 'name',  linkedPlatform: 'battlenet' },
  { id: 'lor',         label: 'Legends of Runeterra', category: 'Card', detection: 'ocr',     verifyMethod: 'name',  linkedPlatform: 'riot' },
  { id: 'mtg_arena',   label: 'Magic: The Gathering Arena', category: 'Card', detection: 'ocr', verifyMethod: 'name', linkedPlatform: 'wizards' },

  // ── Other ────────────────────────────────────────────────────────────
  { id: 'tft',         label: 'Teamfight Tactics', category: 'AutoBattler', detection: 'ocr', verifyMethod: 'chat', linkedPlatform: 'riot' },
  { id: 'brawlhalla',  label: 'Brawlhalla',        category: 'Fighting',detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'steam' },
  { id: 'smite',       label: 'SMITE',             category: 'MOBA',    detection: 'ocr',     verifyMethod: 'chat',  linkedPlatform: 'steam' },
  { id: 'wow_arena',   label: 'WoW Arena',         category: 'MMO',     detection: 'ocr',     verifyMethod: 'name',  linkedPlatform: 'battlenet' },

  // ── Fallback ─────────────────────────────────────────────────────────
  { id: 'other',       label: 'Other (manual report)', category: 'Other', detection: 'manual', verifyMethod: 'chat', linkedPlatform: null },
];

// ── Official cover art (frontend-only field, NOT mirrored in functions/games.js) ──
// Publisher-uploaded portrait box art served straight from Valve's official
// Steam CDN per appid (the same assets the Steam store renders — hotlinked,
// never rehosted, so it's the legit original artwork). Every URL below was
// verified live (HTTP 200 image/jpeg) on 2026-06-10. Games without a Steam
// presence (VALORANT, LoL, Fortnite, console titles, Battle.net titles) have
// no entry and fall back to the branded gradient card until official art is
// supplied (e.g. press-kit images dropped into public/games/).
const steamCover = (appid) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`;
// Non-Steam titles use Twitch's public box-art CDN — the official IGDB box
// art (publisher-managed, the same image Twitch's directory shows). All URLs
// verified live + visually confirmed as the real key art 2026-06-10.
const twitchBoxArt = (gameId) => `https://static-cdn.jtvnw.net/ttv-boxart/${gameId}-600x800.jpg`;
const COVER_ART = {
  // Riot / Epic / Blizzard / Nintendo (no Steam presence)
  valorant: twitchBoxArt(516575),
  lol: twitchBoxArt(21779),
  fortnite: twitchBoxArt(33214),
  tft: twitchBoxArt(513143),
  lor: twitchBoxArt(514790),
  hearthstone: twitchBoxArt(138585),
  sc2: twitchBoxArt(490422),
  wow_arena: twitchBoxArt(18122),
  ssbu: twitchBoxArt(504461),
  cs2: steamCover(730),
  dota2: steamCover(570),
  overwatch2: steamCover(2357570),
  apex: steamCover(1172470),
  rocketleague: steamCover(252950),
  pubg: steamCover(578080),
  warzone: steamCover(1962663),
  cod_mw3: steamCover(2519060),
  r6s: steamCover(359550),
  aoe4: steamCover(1466860),
  aoe2de: steamCover(813780),
  sf6: steamCover(1364780),
  tekken8: steamCover(1778820),
  mk1: steamCover(1971870),
  gg_strive: steamCover(1384160),
  fc25: steamCover(2669320),
  nba2k: steamCover(2338770),
  madden: steamCover(2582560),
  pes_efootball: steamCover(1665460),
  // F1 25 uses Steam's newer hashed asset paths — portrait art isn't at the
  // static path, so we use its verified official header image (landscape).
  f1_25: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3059520/76dc8ac45f1bd6dec26e04434ca1c8814e7bb330/header.jpg',
  forza: steamCover(2440510),
  iracing: steamCover(266410),
  mtg_arena: steamCover(2141910),
  brawlhalla: steamCover(291550),
  smite: steamCover(386360),
};
TOURNAMENT_GAMES.forEach((g) => { g.coverArt = COVER_ART[g.id] || null; });

export const VERIFY_METHOD_LABEL = {
  chat:         'Type the code in your in-game lobby chat',
  name:         'Temporarily set your in-game name to include the code',
  lobby_name:   'Create a custom lobby named with the code',
  match_screen: "Show your opponent's gamertag on screen — both names must be visible in the match-setup screen",
};

export const PLATFORM_LABEL = {
  steam:     'Steam',
  riot:      'Riot',
  battlenet: 'Battle.net',
  activision: 'Activision',
  origin:    'EA / Origin',
  ea:        'EA Account',
  epic:      'Epic Games',
  ubisoft:   'Ubisoft Connect',
  xbox:      'Xbox',
  psn:       'PlayStation Network',
  nintendo:  'Nintendo',
  wizards:   'Wizards Account',
};

export function gameById(id) {
  return TOURNAMENT_GAMES.find((g) => g.id === id) || TOURNAMENT_GAMES.find((g) => g.label === id) || null;
}

export const GAMES_BY_CATEGORY = TOURNAMENT_GAMES.reduce((acc, g) => {
  if (!acc[g.category]) acc[g.category] = [];
  acc[g.category].push(g);
  return acc;
}, {});

// Max per-lobby player count per game. BR titles host 60-150, most arena
// games cap at 10. Used to validate `brGameCount` x lobby-size in BR
// tournaments and to prevent users from setting unrealistic FFA counts.
// Defaults by category if a game isn't listed explicitly.
const LOBBY_CAP_BY_GAME = {
  // BR — true large-lobby titles
  fortnite: 100,
  pubg: 100,
  warzone: 150,
  apex: 60,
  // FPS — 5v5 / 6v6
  cs2: 10, valorant: 10, overwatch2: 12, r6s: 10, cod_mw3: 12,
  // MOBA
  dota2: 10, lol: 10,
  // Sports / 1v1
  fc25: 2, sf6: 2, tekken8: 2, mk1: 2, gg_strive: 2, ssbu: 8,
  rocketleague: 8,
  // RTS
  sc2: 8, aoe4: 8, aoe2de: 8,
};

const LOBBY_CAP_BY_CATEGORY = {
  BR: 100, FPS: 10, MOBA: 10, Fighting: 2, Sports: 2, RTS: 8,
};

export function getMaxLobbySize(gameId) {
  const explicit = LOBBY_CAP_BY_GAME[gameId];
  if (explicit) return explicit;
  const g = gameById(gameId);
  if (g && LOBBY_CAP_BY_CATEGORY[g.category]) return LOBBY_CAP_BY_CATEGORY[g.category];
  return 10; // safe default
}

export function supportsBattleRoyale(gameId) {
  const g = gameById(gameId);
  return !!(g && g.category === 'BR') && getMaxLobbySize(gameId) >= 32;
}
