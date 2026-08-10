// src/utils/gsiInstaller.js
// Cross-environment writer for Valve GSI .cfg files. Three paths in priority
// order:
//   1. Tauri desktop  — direct fs write after one-time consent dialog.
//   2. Chrome / Edge  — File System Access API (showDirectoryPicker).
//   3. Other browsers — download the .cfg + return manual instructions.
//
// Backend issues the file content + canonical install path via the
// `getSteamGsiConfig` callable. This helper just gets it onto disk.

import { isDesktopApp } from './platform';

export const GSI_METHOD = {
  TAURI: 'tauri',
  FSA: 'fsa',
  DOWNLOAD: 'download',
};

/** Detect the best available write method for the current runtime. */
export function detectGsiMethod() {
  // Direct .cfg disk writes via Tauri fs are DESKTOP-only (the mobile shell has
  // no filesystem plugin and Steam GSI is a PC-only concept). withGlobalTauri
  // means __TAURI__ is also present on mobile, so gate on the desktop shell.
  if (typeof window !== 'undefined' && (window.__TAURI__ || window.__TAURI_INTERNALS__)
      && isDesktopApp()) {
    return GSI_METHOD.TAURI;
  }
  if (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function') {
    return GSI_METHOD.FSA;
  }
  return GSI_METHOD.DOWNLOAD;
}

/**
 * Write the .cfg into the user's Steam folder. Throws on user cancel or
 * permission denial. Returns the method actually used.
 *
 * @param {object} config — output of `getSteamGsiConfig({ game })`
 *   { filename, installPath, installPathPosix, content }
 * @param {object} opts
 *   opts.method — force a specific method (defaults to detectGsiMethod()).
 *   opts.directoryHandle — pre-granted FSA directory handle (skip picker).
 */
export async function installGsiConfig(config, opts = {}) {
  const method = opts.method || detectGsiMethod();

  if (method === GSI_METHOD.TAURI) {
    return await installViaTauri(config);
  }
  if (method === GSI_METHOD.FSA) {
    return await installViaFsa(config, opts.directoryHandle);
  }
  return await installViaDownload(config);
}

// ─── Tauri ────────────────────────────────────────────────────────────
async function installViaTauri(config) {
  // Lazy-load the Tauri v2 fs/dialog plugins at runtime only. The specifiers
  // are built (not string literals) so Vite's dev import-analysis can't try to
  // resolve a desktop-only module when the SPA is served in a browser — a
  // literal + /* @vite-ignore */ still tripped the resolver. If the plugins
  // aren't in this build, fall back to the File System Access API, which the
  // desktop WebView2 also supports (so GSI still installs without them).
  let writeTextFile, open;
  try {
    const fsMod = '@tauri-apps/' + 'plugin-fs';
    const dialogMod = '@tauri-apps/' + 'plugin-dialog';
    ({ writeTextFile } = await import(/* @vite-ignore */ fsMod));
    ({ open } = await import(/* @vite-ignore */ dialogMod));
  } catch {
    if (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function') {
      return await installViaFsa(config);
    }
    throw new Error('Tauri filesystem APIs unavailable in this build');
  }

  const dir = await open({
    directory: true,
    multiple: false,
    title: `Pick the Steam cfg folder for ${config.filename}`,
  });
  if (!dir) throw new Error('User cancelled folder picker');

  const fullPath = `${dir}${dir.endsWith('/') || dir.endsWith('\\') ? '' : '/'}${config.filename}`;
  await writeTextFile(fullPath, config.content);
  return { method: GSI_METHOD.TAURI, path: fullPath };
}

// ─── File System Access API (Chrome / Edge / Brave / Opera) ──────────
async function installViaFsa(config, existingHandle) {
  if (typeof window === 'undefined' || typeof window.showDirectoryPicker !== 'function') {
    throw new Error('File System Access API not available in this browser');
  }
  let dirHandle = existingHandle;
  if (!dirHandle) {
    dirHandle = await window.showDirectoryPicker({
      id: 'vergr-steam-cfg',
      mode: 'readwrite',
      startIn: 'desktop',
    });
  }
  // Verify write permission.
  const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') {
    const req = await dirHandle.requestPermission({ mode: 'readwrite' });
    if (req !== 'granted') throw new Error('Write permission denied');
  }
  const fileHandle = await dirHandle.getFileHandle(config.filename, { create: true });
  const writer = await fileHandle.createWritable();
  await writer.write(config.content);
  await writer.close();
  return { method: GSI_METHOD.FSA, path: `${dirHandle.name}/${config.filename}`, dirHandle };
}

// ─── Plain download (fallback) ────────────────────────────────────────
async function installViaDownload(config) {
  const blob = new Blob([config.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = config.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return {
    method: GSI_METHOD.DOWNLOAD,
    path: null,
    needsManualInstall: true,
    instructions: `Move ${config.filename} into ${config.installPath}`,
  };
}
