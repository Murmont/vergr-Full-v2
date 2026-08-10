// Game launcher deep-links.
//
// Each game knows which launchers can start it. Click → OS hands the URL
// scheme off to the registered handler app (Steam, Battle.net, EA App,
// Ubisoft Connect, Epic, Xbox PC, Riot Client). If the launcher isn't
// installed the OS no-ops or prompts the user.
//
// For games we can't deep-link directly (Riot games, Epic without
// per-game IDs), we open the launcher home instead — better than nothing.
//
// Also supports a per-game custom .exe path the user pastes in once.
// Persisted to localStorage. Tauri desktop uses @tauri-apps/plugin-shell
// to spawn it; in a plain browser we can't run local executables and
// the EXE option is hidden.

import { isTauri } from './tauriHud';

// Each launcher knows its scheme + a function that builds the launch URL
// given the per-game `launcherIds` map. `home` is the fallback when we
// can't deep-link to a specific title.
export const LAUNCHERS = {
  steam:     { label: 'Steam',           home: 'steam://open/main',     build: (id) => `steam://run/${id}` },
  battlenet: { label: 'Battle.net',      home: 'battlenet://',          build: (id) => `battlenet://${id}` },
  ea:        { label: 'EA App',          home: 'eaapp://',              build: (id) => `link2ea://launchgame/${id}` },
  origin:    { label: 'EA App',          home: 'eaapp://',              build: (id) => `link2ea://launchgame/${id}` },
  epic:      { label: 'Epic Games',      home: 'com.epicgames.launcher://store/home', build: (id) => `com.epicgames.launcher://apps/${id}?action=launch&silent=true` },
  ubisoft:   { label: 'Ubisoft Connect', home: 'uplay://',              build: (id) => `uplay://launch/${id}/0` },
  xbox:      { label: 'Xbox',            home: 'xbox://',               build: (id) => `xbox://launch/?id=${id}` },
  gog:       { label: 'GOG Galaxy',      home: 'goggalaxy://',          build: (id) => `goggalaxy://openGameView/${id}` },
  riot:      { label: 'Riot Client',     home: 'riotclient://',         build: () => 'riotclient://' },
  // Nintendo / PlayStation / Xbox-console launchers don't exist on PC.
  // Vergr tournaments are PC-only, so console-exclusive games render no
  // launch button at all (LaunchGameDropdown returns null when launchers=[]).
};

// Per-game launcher IDs. Only games with verified IDs get a deep-link;
// the rest fall back to launcher home (still 1-click into the launcher,
// just not the game inside it). Cross-launcher games (Apex on Steam +
// EA + Epic + Xbox) list every option so users pick whichever they own.
//
// Steam appids are well-known (Valve publishes them). Battle.net + EA
// + Epic codes are harder to discover — leave them empty rather than
// guessing wrong and shipping broken deep-links.
export const GAME_LAUNCHER_IDS = {
  cs2:         { steam: '730' },
  dota2:       { steam: '570' },
  overwatch2:  { steam: '2357570', battlenet: 'Pro' },
  apex:        { steam: '1172470', ea: null, epic: null, xbox: null },
  valorant:    { riot: null },
  lol:         { riot: null },
  rocketleague:{ epic: null, steam: '252950' },
  fortnite:    { epic: null },
  pubg:        { steam: '578080' },
  warzone:     { battlenet: 'VIPR', steam: '1962663' },
  cod_mw3:     { battlenet: 'VIPR', steam: '2519060' },
  r6s:         { steam: '359550', ubisoft: '635' },
  sc2:         { battlenet: 'S2' },
  aoe4:        { steam: '1466860' },
  aoe2de:      { steam: '813780' },
  sf6:         { steam: '1364780' },
  tekken8:     { steam: '1778820' },
  mk1:         { steam: '1971870' },
  gg_strive:   { steam: '1384160' },
  fc25:        { ea: null, steam: '2669320' },
  nba2k:       { steam: null },
  madden:      { ea: null },
};

// Build the ordered list of launch options for a game. Primary option is
// the game's `linkedPlatform`; siblings come after. Each option includes
// the OS URL we'd open + a label.
export function getLaunchersForGame(game) {
  if (!game) return [];
  const ids = GAME_LAUNCHER_IDS[game.id] || {};
  const primary = game.linkedPlatform;
  const order = [primary, ...Object.keys(ids).filter((k) => k !== primary)];
  return order
    .filter((k) => k && LAUNCHERS[k])
    .map((k) => {
      const spec = LAUNCHERS[k];
      const id = ids[k];
      const url = (id && spec.build) ? spec.build(id) : spec.home;
      return {
        key: k,
        label: spec.label,
        url,
        hasDeepLink: !!(id && spec.build && spec.build(id)),
        primary: k === primary,
      };
    })
    .filter((opt) => opt.url);
}

// ─── EXE fallback ──────────────────────────────────────────────────────

const EXE_KEY = (gameId) => `vergr.gameExe.${gameId}`;

export function getCachedExePath(gameId) {
  try { return localStorage.getItem(EXE_KEY(gameId)) || ''; } catch { return ''; }
}
export function setCachedExePath(gameId, path) {
  try {
    if (path) localStorage.setItem(EXE_KEY(gameId), path);
    else localStorage.removeItem(EXE_KEY(gameId));
  } catch {}
}

export function exeOptionAvailable() {
  return isTauri();
}

// Spawn an arbitrary .exe via Tauri's shell plugin. Throws if not in Tauri
// or if the plugin call fails. Caller must validate the path.
export async function launchExe(path) {
  if (!isTauri()) throw new Error('Local .exe launch requires the desktop app.');
  const { Command } = await import('@tauri-apps/plugin-shell');
  // `program` = absolute path, `args` = []. `spawn()` is fire-and-forget;
  // we don't track the child process — the game owns its own lifecycle.
  const child = Command.create(path, []);
  await child.spawn();
}

// Open a URL via the OS. Tauri uses the opener plugin; browsers use
// window.location (which respects custom URL schemes too).
export async function openLauncherUrl(url) {
  if (!url) return;
  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
      return;
    } catch {
      // Fall through to window.location.
    }
  }
  // Plain browser: setting location to a custom scheme triggers the OS
  // handler. The browser may prompt "Allow this site to open X?" once.
  window.location.href = url;
}
