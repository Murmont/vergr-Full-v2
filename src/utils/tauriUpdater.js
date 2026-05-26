// VERGR desktop auto-update.
//
// Runs ONLY inside the Tauri desktop shell (no-op in browser / PWA). On
// launch it asks the updater endpoint (latest.json on the CDN) whether a
// newer signed build exists. If so it downloads + installs it silently and
// relaunches, so the user never reinstalls and always has the latest app
// (new icon, features, fixes) the next time they open it.
//
// Signature is verified against the embedded pubkey (tauri.conf.json
// plugins.updater.pubkey) before anything is applied, so a tampered
// manifest or installer is rejected.

import { isTauri } from './tauriHud';

export async function runDesktopAutoUpdate() {
  if (!isTauri()) return; // browser / PWA: nothing to do
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update?.available) return;
    // Download + install in the background, then relaunch into the new build.
    await update.downloadAndInstall();
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (e) {
    // Never block app boot on an update problem (offline, endpoint down, etc.)
    console.warn('[updater] skipped:', e?.message || e);
  }
}
