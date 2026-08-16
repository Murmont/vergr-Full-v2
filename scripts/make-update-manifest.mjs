#!/usr/bin/env node
// ────────────────────────────────────────────────────────────
// make-update-manifest.mjs
// ────────────────────────────────────────────────────────────
// After a signed `tauri build` (createUpdaterArtifacts: true), Tauri writes
// an NSIS updater artifact + its detached signature:
//   src-tauri/target/release/bundle/nsis/VERGR_<ver>_x64-setup.exe
//   src-tauri/target/release/bundle/nsis/VERGR_<ver>_x64-setup.exe.sig
//
// The installer is ~80MB+ and must NOT be served from Firebase Hosting (Spark
// free transfer is 360MB/day — one download nearly exhausts it) and must NEVER
// be copied into public/ (vite would copy it into dist/, and the desktop build
// bundles all of dist/ into the NEXT installer — that recursive bake-in is what
// ballooned the installer 20MB -> 326MB). So big binaries live ONLY on R2,
// behind cdn.vergr.app ($0 egress), exactly like the Android APK (publish-apk.mjs).
//
// This script:
//   1. finds the newest NSIS setup .exe + its .sig
//   2. uploads the installer to R2 key downloads/VERGR-Setup.exe
//      (-> https://cdn.vergr.app/downloads/VERGR-Setup.exe)
//   3. writes public/downloads/latest.json (small, OK on Hosting) whose `url`
//      points at the CDN and whose `signature` matches the uploaded bytes
//
// Run after build: `node scripts/make-update-manifest.mjs`
// (then `vite build` copies public/ -> dist/, and `firebase deploy --only
// hosting` publishes the small manifest). Requires the `firebase` CLI logged in
// (it pulls the R2 secrets).

import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const NSIS_DIR = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const DEST_DIR = join(ROOT, 'public', 'downloads');
const MANIFEST = join(DEST_DIR, 'latest.json');
const R2_KEY = 'downloads/VERGR-Setup.exe';
const CDN_URL = 'https://cdn.vergr.app/downloads/VERGR-Setup.exe';

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

const size = statSync(setupExe).size;
// SHA-256 of the exact bytes uploaded to R2. Published on the download page
// so a user (or anyone looking at a Safe Browsing report) can verify the file
// they got is the file we shipped. Provenance only, NOT the update trust
// root (that stays the Tauri detached signature).
const sha256 = createHash('sha256').update(readFileSync(setupExe)).digest('hex');

// --- upload the installer to R2 (the CDN origin, $0 egress) ---
const require = createRequire(join(ROOT, 'functions', 'package.json'));
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const sec = (name) => execFileSync('firebase', ['functions:secrets:access', name], { encoding: 'utf8', shell: true }).trim();
const accountId = sec('R2_ACCOUNT_ID');
const Bucket = sec('R2_BUCKET');
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: sec('R2_ACCESS_KEY_ID'), secretAccessKey: sec('R2_SECRET_ACCESS_KEY') },
});
console.log(`[make-update-manifest] uploading ${(size / 1_048_576).toFixed(1)} MB -> ${Bucket}/${R2_KEY} ...`);
await s3.send(new PutObjectCommand({
  Bucket, Key: R2_KEY, Body: readFileSync(setupExe),
  ContentType: 'application/x-msdownload',
  CacheControl: 'public, max-age=300',
}));
const head = await s3.send(new HeadObjectCommand({ Bucket, Key: R2_KEY }));
if (head.ContentLength !== size) { console.error(`R2 size mismatch (${head.ContentLength} != ${size})`); process.exit(1); }
console.log(`[make-update-manifest] R2 OK (ETag ${head.ETag}).`);

// --- write the small manifest (Hosting-safe), pointing at the CDN ---
mkdirSync(DEST_DIR, { recursive: true });
const signature = readFileSync(sigFile, 'utf8').trim();
// Release notes (Tauri exposes this as update.body). DesktopUpdateGate treats a
// leading [REQUIRED] token as a non-skippable update (hides "Later"). Set the
// notes via VERGR_UPDATE_NOTES, and force-required via VERGR_UPDATE_REQUIRED=1.
const baseNotes = process.env.VERGR_UPDATE_NOTES?.trim() || 'Latest VERGR desktop build.';
const required = /^(1|true|yes)$/i.test(process.env.VERGR_UPDATE_REQUIRED || '');
const notes = required && !/^\s*\[required\]/i.test(baseNotes) ? `[REQUIRED] ${baseNotes}` : baseNotes;
const manifest = {
  version,
  notes,
  // Installer byte size — DesktopUpdateGate fetches this (display only, not
  // trust-sensitive) to show the download size on the "update available" screen
  // before the signed download begins. Tauri's update.body carries the notes;
  // size is NOT exposed on the update handle, hence the extra manifest field.
  size,
  // Published on /platform/download/desktop for user-verifiable provenance.
  sha256,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': { signature, url: CDN_URL },
  },
};
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
console.log(`[make-update-manifest] v${version}`);
console.log(`  installer -> ${CDN_URL} (R2, ${(size / 1_048_576).toFixed(1)} MB)`);
console.log(`  sha256    -> ${sha256}`);
console.log(`  manifest  -> ${MANIFEST} (url -> CDN, no installer on Hosting)`);
