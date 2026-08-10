// VERGR desktop auto-update.
//
// Runs ONLY inside the Tauri desktop shell (no-op in browser / PWA / native
// Android). On launch the app asks the updater endpoint (latest.json on the
// CDN) whether a newer signed build exists.
//
// As of the loading-screen update banner, the UX is driven by
// DesktopUpdateGate: it calls checkDesktopUpdate() before the app renders and,
// if an update is available, shows "Update available" with Update now / Later
// (Later is hidden for REQUIRED updates). applyDesktopUpdate() downloads +
// installs the signed build and relaunches.
//
// Signature is verified against the embedded pubkey (tauri.conf.json
// plugins.updater.pubkey) before anything is applied, so a tampered manifest
// or installer is rejected.

import { isDesktopApp } from './platform';

// Returns the Tauri update handle if a newer signed build exists, else null.
// Never throws (offline / endpoint down / not desktop → null) so it can never
// block app boot.
export async function checkDesktopUpdate() {
  if (!isDesktopApp()) return null; // browser / PWA / native Android: nothing to do
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    return update?.available ? update : null;
  } catch (e) {
    console.warn('[updater] check skipped:', e?.message || e);
    return null;
  }
}

// Download + install the signed build, reporting byte progress, then relaunch
// into the new version. Throws on failure so the caller can recover (let the
// user into the current build rather than trapping them on the splash).
export async function applyDesktopUpdate(update, onProgress) {
  await update.downloadAndInstall((event) => {
    try { onProgress?.(event); } catch { /* progress UI is best-effort */ }
  });
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

// A REQUIRED (non-skippable) update is flagged by a leading [REQUIRED] /
// REQUIRED: token in the release notes (Tauri exposes the manifest `notes`
// field as update.body). make-update-manifest.mjs injects it at release time
// from the VERGR_UPDATE_REQUIRED env flag.
export function isUpdateRequired(update) {
  const body = (update && update.body) || '';
  return /^\s*(\[required\]|required:)/i.test(body);
}

// Back-compat shim. The gate now drives the normal UX; this only auto-applies a
// REQUIRED update if something calls it directly. Optional updates are left for
// the gate to prompt.
export async function runDesktopAutoUpdate() {
  const update = await checkDesktopUpdate();
  if (update && isUpdateRequired(update)) {
    try { await applyDesktopUpdate(update); }
    catch (e) { console.warn('[updater] required auto-apply skipped:', e?.message || e); }
  }
}
