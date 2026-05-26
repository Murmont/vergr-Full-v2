#!/usr/bin/env node
// ────────────────────────────────────────────────────────────
// make-update-manifest.mjs
// ────────────────────────────────────────────────────────────
// After a signed `tauri build` (createUpdaterArtifacts: true), Tauri writes
// an NSIS updater artifact + its detached signature:
//   src-tauri/target/release/bundle/nsis/VERGR_<ver>_x64-setup.exe
//   src-tauri/target/release/bundle/nsis/VERGR_<ver>_x64-setup.exe.sig
//
// The auto-updater (endpoint https://vergr.app/downloads/latest.json) needs
// a manifest whose `signature` matches the exact installer bytes served at
// `url`. This script:
//   1. finds the newest NSIS setup .exe + its .sig
//   2. copies the installer to public/downloads/VERGR-Setup.exe (the URL the
//      manifest + the website download button both point at)
//   3. writes public/downloads/latest.json with the version + signature
//
// Run after build: `node scripts/make-update-manifest.mjs`
// (then `vite build` copies public/ → dist/, and `firebase deploy --only
// hosting` publishes it).

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const NSIS_DIR = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const DEST_DIR = join(ROOT, 'public', 'downloads');
const DEST_EXE = join(DEST_DIR, 'VERGR-Setup.exe');
const MANIFEST = join(DEST_DIR, 'latest.json');

const version = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8')).version;

function newest(dir, predicate) {
  if (!existsSync(dir)) return null;
  return readdirSync(dir)
    .filter(predicate)
    .map((f) => ({ full: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]?.full || null;
}

const setupExe = newest(NSIS_DIR, (f) => f.toLowerCase().endsWith('-setup.exe'));
const sigFile = newest(NSIS_DIR, (f) => f.toLowerCase().endsWith('-setup.exe.sig'));

if (!setupExe || !sigFile) {
  console.error('[make-update-manifest] Missing NSIS setup .exe or .sig in', NSIS_DIR);
  console.error('  Did you build with createUpdaterArtifacts + TAURI_SIGNING_PRIVATE_KEY set?');
  process.exit(1);
}

mkdirSync(DEST_DIR, { recursive: true });
copyFileSync(setupExe, DEST_EXE);

const signature = readFileSync(sigFile, 'utf8').trim();
const manifest = {
  version,
  notes: 'Latest VERGR desktop build.',
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: 'https://vergr.app/downloads/VERGR-Setup.exe',
    },
  },
};

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`[make-update-manifest] v${version}`);
console.log(`  installer -> ${DEST_EXE} (${(statSync(DEST_EXE).size / 1_048_576).toFixed(1)} MB)`);
console.log(`  manifest  -> ${MANIFEST}`);
