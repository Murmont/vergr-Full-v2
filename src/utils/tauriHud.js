// VERGR HUD bridge — frontend → Tauri.
//
// The HUD is a second Tauri webview window (`label: "hud"`) declared in
// tauri.conf.json as transparent, always-on-top, click-through-by-default,
// frameless, skip-taskbar. Native commands defined in src-tauri/src/lib.rs:
//
//   open_hud / close_hud
//   set_hud_click_through(bool)
//   set_hud_position(x, y)
//   scan_processes  → ProcessEntry[]
//
// Safe to call from any browser context: gracefully no-ops outside Tauri.
//
// IMPORTANT: the HUD + process-scan commands only exist in the DESKTOP shell
// (they are #[cfg(desktop)] in src-tauri/src/lib.rs). withGlobalTauri is on,
// so window.__TAURI__ is also present in the mobile shell — therefore "is this
// the HUD-capable Tauri runtime" must mean DESKTOP, not just "any Tauri".
import { isDesktopApp } from './platform';

const tauri = () => (typeof window !== 'undefined' ? window.__TAURI__ : null);
const invoke = async (cmd, args) => {
  const t = tauri();
  if (!t?.core?.invoke) return null;
  try { return await t.core.invoke(cmd, args); } catch (e) { console.warn(cmd, e); return null; }
};
// Desktop-only: callers (game launchers, updater, tournament HUD) use this to
// decide whether the native desktop commands are available.
export const isTauri = () => isDesktopApp();

export const openHud = () => invoke('open_hud');
export const closeHud = () => invoke('close_hud');
export const setHudClickThrough = (clickThrough) => invoke('set_hud_click_through', { clickThrough });
export const setHudPosition = (x, y) => invoke('set_hud_position', { x, y });

// Cross-window pub/sub via Tauri events. Survives webview restarts; works
// even when the HUD window was suspended. Falls back to localStorage on
// browsers so dev (npm run dev outside Tauri) still functions.
export async function emitHudMatch(tournamentId, matchId) {
  const t = tauri();
  if (t?.event?.emit) {
    try { await t.event.emit('vergr:hud:set-match', { tournamentId, matchId }); return; } catch {}
  }
  try { localStorage.setItem('vergr.hud.matchPath', `${tournamentId}|${matchId}`); } catch {}
}
export async function emitHudClear() {
  const t = tauri();
  if (t?.event?.emit) {
    try { await t.event.emit('vergr:hud:clear', {}); return; } catch {}
  }
  try { localStorage.removeItem('vergr.hud.matchPath'); } catch {}
}
export function listenHudMatch(handler) {
  const t = tauri();
  if (t?.event?.listen) {
    const p = t.event.listen('vergr:hud:set-match', (e) => handler(e.payload));
    return async () => { try { (await p)(); } catch {} };
  }
  const sHandler = (e) => {
    if (e.key !== 'vergr.hud.matchPath' || !e.newValue) return;
    const [tournamentId, matchId] = e.newValue.split('|');
    handler({ tournamentId, matchId });
  };
  window.addEventListener('storage', sHandler);
  return () => window.removeEventListener('storage', sHandler);
}
export function listenHudClear(handler) {
  const t = tauri();
  if (t?.event?.listen) {
    const p = t.event.listen('vergr:hud:clear', () => handler());
    return async () => { try { (await p)(); } catch {} };
  }
  return () => {};
}

// Returns { processes: [{ name, pid, exe_hash, cmd_join }], scanned_at_ms, process_count }
export const scanProcesses = () => invoke('scan_processes');

// Game-window capture — uses getDisplayMedia with displaySurface:'window' so
// the OS picker forces the user to choose a single window (not full desktop).
// We honour the chosen MediaStream and never touch the desktop.
export async function captureGameWindow() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Screen capture not supported in this browser.');
  }
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      displaySurface: 'window',         // OS-enforced: window-only, not desktop
      frameRate: { ideal: 30, max: 60 },
      width: { ideal: 1920 }, height: { ideal: 1080 },
    },
    audio: false,
    selfBrowserSurface: 'exclude',     // hide our own app from picker
    surfaceSwitching: 'exclude',
    systemAudio: 'exclude',
  });
}
