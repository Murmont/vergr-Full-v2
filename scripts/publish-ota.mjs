/**
 * Publish an OTA frontend bundle for the native mobile shell (tauri-plugin-hotswap).
 *
 * This is the update path for WEB-only releases — no APK, no Play Store. It ships
 * ONLY the changed code (index.html + assets/, ~2MB gzipped); the heavy bundled
 * media (brand/backgrounds/fonts/sounds) is NOT in the bundle — hotswap falls
 * through to the embedded assets for any file the bundle omits, so the app never
 * re-downloads the 72MB of media or the native shell.
 *
 * Flow: vite build -> stage code-only dir -> tar.gz -> minisign sign -> upload
 * bundle to R2 (cdn.vergr.app, $0 egress) -> write manifest to public/ota +
 * dist/ota -> you run `firebase deploy --only hosting` to publish the manifest.
 *
 * Run from repo root:
 *   node scripts/publish-ota.mjs --notes "Fixed the message thread bug"
 *   firebase deploy --only hosting
 *
 * A native-code change (new Rust/Kotlin bridge) still needs a full APK via
 * scripts/publish-apk.mjs — bump MIN_BINARY_VERSION here to the new APK version
 * so old shells don't pull a bundle that needs a bridge they lack.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, '..');
const require = createRequire(join(repo, 'functions', 'package.json'));
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// Lowest APK binary version that can run this OTA bundle. This MUST equal the
// CURRENT app version (from appVersion.js), NOT an old floor like 1.0.6.
//
// Why: the hotswap plugin's default binary-cache policy is `DiscardOnUpgrade`,
// which discards any cached OTA bundle when `binary_version > min_binary_version`.
// If min_binary is an old value (e.g. 1.0.6) then EVERY newer binary discards
// the bundle on EVERY cold start -> the patch never persists (it silently
// reverts to the embedded assets). Setting min_binary = current app version
// means `binary == min` on the matching APK (NOT discarded -> persists), while a
// future APK with a higher version correctly supersedes old patches (discarded),
// and older binaries correctly refuse a patch that needs a newer shell.
const MIN_BINARY_VERSION = (
  /APP_VERSION\s*=\s*'([^']+)'/.exec(
    readFileSync(join(repo, 'src/utils/appVersion.js'), 'utf8'),
  )?.[1] || '0.0.0'
);
const SECRET_KEY = join(homedir(), 'vergr-keystore', 'hotswap.key');
const RSIGN = join(homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'rsign.exe' : 'rsign');

// OTA ships ONLY the code: the hashed `assets/` dir (JS/CSS) + the small root
// files (index.html, sw.js, manifests). EVERY other top-level dir is heavy static
// media (brand/backgrounds/models/badges/vanguard/fonts/og/icons/downloads…) and
// stays EMBEDDED — hotswap falls through to the embedded copy for anything the
// bundle omits, so none of that ~80MB is ever re-downloaded. Allowlist (not a
// denylist) so a NEW media dir is auto-excluded without remembering to add it.
const OTA_DIRS = new Set(['assets']);

const notesArg = (() => {
  const i = process.argv.indexOf('--notes');
  return i >= 0 ? (process.argv[i + 1] || '') : '';
})();

// npm/firebase are .cmd on Windows and need a shell; tar/rsign are real .exe and
// MUST NOT go through cmd.exe (which would pick System32 bsdtar over GNU tar).
function run(cmd, args, opts = {}) {
  const shell = opts.shell ?? (process.platform === 'win32');
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts, shell });
}

// --- 1. fresh web build (full dist; we select code-only from it) ---
console.log('Building web...');
run('npm', ['run', 'build'], { cwd: repo });

const dist = join(repo, 'dist');
const stage = join(repo, '.ota-stage');
const bundlePath = join(repo, '.ota-bundle.tar.gz');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// --- 2. stage code-only (root files + assets/, minus heavy dirs) ---
let staged = 0;
for (const entry of readdirSync(dist, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    if (!OTA_DIRS.has(entry.name)) continue; // heavy media: stays embedded
    cpSync(join(dist, entry.name), join(stage, entry.name), { recursive: true });
    staged++;
  } else {
    cpSync(join(dist, entry.name), join(stage, entry.name));
    staged++;
  }
}
if (!existsSync(join(stage, 'index.html'))) { console.error('staged bundle missing index.html'); process.exit(1); }

// --- 3. tar.gz with index.html at the ROOT (hotswap requirement) ---
console.log('Packing bundle...');
rmSync(bundlePath, { force: true });
// Run tar FROM the stage dir with relative paths so no absolute "C:\..." appears
// in the args — GNU tar would treat the drive colon as a remote host:path spec.
// `..` resolves the output back to bundlePath (repo/.ota-bundle.tar.gz).
run('tar', ['-czf', '../.ota-bundle.tar.gz', '.'], { shell: false, cwd: stage });
const bundleSize = statSync(bundlePath).size;
console.log(`Bundle: ${(bundleSize / 1048576).toFixed(2)} MB (${staged} top-level entries)`);

// --- 4. minisign sign (canonical .minisig, what minisign-verify expects) ---
if (!existsSync(SECRET_KEY)) { console.error(`Missing signing key: ${SECRET_KEY}`); process.exit(1); }
const sigPath = bundlePath + '.minisig';
rmSync(sigPath, { force: true });
console.log('Signing...');
// -W matches the passwordless key (generated with -W) so signing never prompts.
run(RSIGN, ['sign', '-W', '-s', SECRET_KEY, '-x', sigPath, bundlePath], { shell: false });
const signature = readFileSync(sigPath, 'utf8');

// --- 5. sequence: monotonic, read+increment from the live manifest ---
const manifestDir = join(repo, 'public', 'ota', 'android');
const manifestPath = join(manifestDir, 'latest.json');
mkdirSync(manifestDir, { recursive: true });
let prevSeq = 0;
if (existsSync(manifestPath)) {
  try { prevSeq = Number(JSON.parse(readFileSync(manifestPath, 'utf8')).sequence) || 0; } catch { /* fresh */ }
}
const sequence = prevSeq + 1;
const appVersion = /APP_VERSION\s*=\s*'([^']+)'/.exec(readFileSync(join(repo, 'src/utils/appVersion.js'), 'utf8'))?.[1] || '0.0.0';
const version = `${appVersion}-ota.${sequence}`;
const r2Key = `ota/android/seq-${sequence}/frontend.tar.gz`;
const bundleUrl = `https://cdn.vergr.app/${r2Key}`;

// --- 6. upload signed bundle to R2 ---
const t = (s) => (s || '').trim();
const sec = (name) => execFileSync('firebase', ['functions:secrets:access', name], { encoding: 'utf8', shell: true }).trim();
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${t(sec('R2_ACCOUNT_ID'))}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: t(sec('R2_ACCESS_KEY_ID')), secretAccessKey: t(sec('R2_SECRET_ACCESS_KEY')) },
});
const Bucket = t(sec('R2_BUCKET'));
console.log(`Uploading -> ${Bucket}/${r2Key} ...`);
await s3.send(new PutObjectCommand({
  Bucket, Key: r2Key, Body: readFileSync(bundlePath),
  ContentType: 'application/gzip', CacheControl: 'public, max-age=31536000, immutable',
}));

// --- 7. write the manifest (served from vergr.app/ota/android/latest.json) ---
const manifest = {
  version,
  sequence,
  min_binary_version: MIN_BINARY_VERSION,
  url: bundleUrl,
  signature,
  notes: notesArg || `VERGR ${version}`,
  pub_date: new Date().toISOString(),
  mandatory: false,
  bundle_size: bundleSize,
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
// also drop into dist so a deploy right now picks it up without a rebuild
const distManifestDir = join(dist, 'ota', 'android');
mkdirSync(distManifestDir, { recursive: true });
writeFileSync(join(distManifestDir, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');

rmSync(stage, { recursive: true, force: true });
rmSync(bundlePath, { force: true });
rmSync(sigPath, { force: true });

console.log(`\nOTA seq ${sequence} (${version}) published to R2.`);
console.log('Manifest written to public/ota/android/latest.json + dist/.');
console.log('Now run:  firebase deploy --only hosting');
