/**
 * Publish the built Android release APK to the place the in-app updater actually
 * reads from: the Cloudflare R2 bucket behind cdn.vergr.app (NOT just Firebase
 * Hosting's public/downloads copy).
 *
 * ROOT CAUSE this fixes (2026-06-01): the 1.0.5 build was copied into
 * public/downloads (Hosting) but never uploaded to R2, so cdn.vergr.app kept
 * serving the 1.0.4 APK. NativeUpdateBanner downloads from cdn.vergr.app, so
 * Android saw the same versionCode it already had and refused to upgrade.
 *
 * This script makes "publish" mean: upload to R2 + write version.json with a
 * cache-bust token keyed to the APK's real versionCode (so Cloudflare can't
 * serve a stale object on a reused URL, and every release auto-busts).
 *
 * TWO CHANNELS (2026-08-04). The public one and the founder's private playground
 * must never share an object or a manifest:
 *
 *   stable (default)  downloads/VERGR.apk      + public/version.json
 *                     The /platform download and every existing sideload install.
 *   dev  (--channel dev)  downloads/VERGR-dev.apk + public/version-dev.json
 *                     Only devices already running a dev-channel build poll this.
 *                     Unlisted: nothing on the site links to it.
 *
 * Publishing a dev build to the stable channel would push unreleased code to
 * everyone who has ever sideloaded the app AND replace the public download,
 * which is exactly what the split exists to prevent. The channel is an explicit
 * argument for that reason: there is no "guess from the bundle" heuristic here.
 *
 * Run (from repo root, after `npm run android:build`):
 *   node scripts/publish-apk.mjs                 # stable / public
 *   node scripts/publish-apk.mjs --channel dev   # private playground
 *
 * Requires the `firebase` CLI logged in (it pulls R2 secrets) + aapt on PATH or
 * in the Android SDK build-tools.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, '..');
const require = createRequire(join(repo, 'functions', 'package.json'));
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

const APK = join(repo, 'src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk');

const argv = process.argv.slice(2);
const channelArg = argv.includes('--channel') ? argv[argv.indexOf('--channel') + 1] : 'stable';
if (!['stable', 'dev'].includes(channelArg)) {
  console.error(`Unknown --channel "${channelArg}". Use "stable" or "dev".`);
  process.exit(1);
}
const IS_DEV = channelArg === 'dev';

const VERSION_JSON = join(repo, IS_DEV ? 'public/version-dev.json' : 'public/version.json');
const R2_KEY = IS_DEV ? 'downloads/VERGR-dev.apk' : 'downloads/VERGR.apk';
const CDN_URL = `https://cdn.vergr.app/${R2_KEY}`;

console.log(`Channel: ${channelArg}${IS_DEV ? '  (PRIVATE — unlisted, founder device only)' : '  (PUBLIC)'}`);

if (!existsSync(APK)) {
  console.error(`No release APK at ${APK}\nRun: npm run android:build  (or  npx tauri android build)`);
  process.exit(1);
}

// --- read the APK's real versionCode/versionName (source of truth, not a const) ---
function aaptPath() {
  const root = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || 'C:/Android/sdk';
  const bt = join(root, 'build-tools');
  if (!existsSync(bt)) return 'aapt';
  const dirs = require('node:fs').readdirSync(bt).sort();
  for (const d of dirs.reverse()) {
    for (const exe of ['aapt.exe', 'aapt']) {
      const p = join(bt, d, exe);
      if (existsSync(p)) return p;
    }
  }
  return 'aapt';
}
const badging = execFileSync(aaptPath(), ['dump', 'badging', APK], { encoding: 'utf8' });
const versionCode = /versionCode='(\d+)'/.exec(badging)?.[1];
const versionName = /versionName='([^']+)'/.exec(badging)?.[1];
if (!versionCode || !versionName) { console.error('Could not read versionCode/versionName from APK.'); process.exit(1); }
const size = statSync(APK).size;
// SHA-256 of the exact APK bytes uploaded to R2, published on
// /platform/download/mobile. A sideloaded APK has no store vouching for it,
// so a checksum the user can actually check is the only provenance on offer.
const apkBytes = readFileSync(APK);
const sha256 = createHash('sha256').update(apkBytes).digest('hex');
console.log(`APK: ${versionName} (code ${versionCode}), ${size} bytes`);

// THE SIDELOAD APK IS ARM64-ONLY. A universal build ships the whole embedded
// web payload once PER ABI, which is what took 1.0.193 to 282MB against the
// ~85MB this artifact is supposed to be. `npm run android:build` passes
// --target aarch64 for exactly this reason; this guard catches a build run by
// hand without it, because the only symptom otherwise is a number nobody
// looks at until a user complains about the download.
//
// The store AAB is different and SHOULD carry both ABIs: Play splits it per
// device, so nobody downloads the other one. Only the direct-download APK,
// which has no splitting, pays for every ABI it contains.
const abis = [...(/native-code: (.*)/.exec(badging)?.[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
const extraAbis = abis.filter((a) => a !== 'arm64-v8a');
if (extraAbis.length && !process.argv.includes('--allow-multi-abi')) {
  console.error(`\nRefusing to publish: APK contains ${abis.join(", ")} (expected arm64-v8a only).`);
  console.error('  Rebuild with:  npm run android:build');
  console.error('  Or pass --allow-multi-abi if every ABI is genuinely intended.');
  process.exit(1);
}

// THE APK MUST EMBED THE NATIVE WEB BUNDLE, NOT THE WEB ONE.
//
// Tauri auto-merges src-tauri/tauri.android.conf.json, and that file is the
// ONLY thing pointing the android build at `npm run build:android`
// (`vite build --mode native`). Without it the build silently falls back to
// tauri.conf.json's beforeBuildCommand, `npm run build`, so __VERGR_NATIVE__
// is false and every IS_NATIVE_BUILD branch compiles out: no native screens,
// no status-bar insets, and useResponsive returns the broken ~980px tablet
// tier. It still builds, installs and runs, which is why 1.0.193 shipped that
// way and read on the phone as a pile of unrelated UI regressions.
//
// Checked against the ARTIFACT, not the command that was typed: the embedded
// asset keys sit uncompressed in libvergr_desktop_lib.so, which is STORED in
// the APK, so these paths are literal bytes in the file. build:android runs
// prune-mobile-dist.mjs, which deletes dist/og and the desktop background
// variants, so either key surviving proves the pruner never ran.
//
// A marker has to be a path NOTHING ELSE in the build mentions. '/downloads/
// latest.json' looked ideal and is not: it is also the desktop updater endpoint
// in tauri.conf.json, so it is baked into every APK and flagged a clean build.
const UNPRUNED_MARKERS = ['/og/share.mp4', 'bg_1_Desktop.png'];
const leaked = UNPRUNED_MARKERS.filter((m) => apkBytes.includes(Buffer.from(m, 'latin1')));
if (leaked.length) {
  console.error('\nRefusing to publish: this APK embeds the WEB bundle, not the native one.');
  console.error(`  Found unpruned asset key(s): ${leaked.join(', ')}`);
  console.error('  Check src-tauri/tauri.android.conf.json exists and sets');
  console.error('    "beforeBuildCommand": "npm run build:android"');
  console.error('  then rebuild with:  npm run android:build');
  process.exit(1);
}

// THE ASSET PROTOCOL MUST BE ENABLED AND SCOPED.
//
// Every native file the WebView renders, gallery-grid thumbnails, the
// on-device media cache behind avatars and video notes, transcoder output,
// share-in payloads, is handed to the DOM as a convertFileSrc() URL. Those
// URLs only resolve when app.security.assetProtocol is enabled and its scope
// covers the app's private storage; that config lives in
// tauri.android.conf.json. With it missing, Tauri defaults to
// {enable:false, scope:[]} and every one of those elements silently renders
// nothing: blank gallery tiles, a video note stuck on the play glyph. Nothing
// logs, nothing fails the build. 1.0.193 shipped exactly that.
//
// tauri writes the MERGED config it built with into assets/tauri.conf.json, so
// this reads the decision the artifact was actually built from.
function apkEntry(name) {
  const marker = Buffer.from(`PK\x03\x04`, 'latin1');
  const want = Buffer.from(name, 'latin1');
  let at = 0;
  for (;;) {
    at = apkBytes.indexOf(marker, at);
    if (at < 0) return null;
    const nameLen = apkBytes.readUInt16LE(at + 26);
    const extraLen = apkBytes.readUInt16LE(at + 28);
    const nameAt = at + 30;
    if (apkBytes.subarray(nameAt, nameAt + nameLen).equals(want)) {
      const method = apkBytes.readUInt16LE(at + 8);
      const compSize = apkBytes.readUInt32LE(at + 18);
      const body = apkBytes.subarray(nameAt + nameLen + extraLen, nameAt + nameLen + extraLen + compSize);
      return method === 0 ? body : inflateRawSync(body);
    }
    at += 4;
  }
}
try {
  const merged = JSON.parse(apkEntry('assets/tauri.conf.json').toString('utf8'));
  const ap = merged?.app?.security?.assetProtocol || {};
  if (!ap.enable || !(ap.scope?.length || ap.scope?.allow?.length)) {
    console.error('\nRefusing to publish: the asset protocol is off in this APK.');
    console.error(`  Built with assetProtocol = ${JSON.stringify(ap)}`);
    console.error('  Native thumbnails, cached media and video notes cannot render.');
    console.error('  Restore app.security.assetProtocol in src-tauri/tauri.android.conf.json,');
    console.error('  then rebuild with:  npm run android:build');
    process.exit(1);
  }
} catch (err) {
  // A guard that cannot read the artifact must not wave it through.
  console.error(`\nRefusing to publish: could not read assets/tauri.conf.json from the APK (${err.message}).`);
  process.exit(1);
}

// --- pull R2 creds via firebase CLI (so the script is one command) ---
const sec = (name) => execFileSync('firebase', ['functions:secrets:access', name], { encoding: 'utf8', shell: true }).trim();
const accountId = sec('R2_ACCOUNT_ID');
const Bucket = sec('R2_BUCKET');
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: sec('R2_ACCESS_KEY_ID'), secretAccessKey: sec('R2_SECRET_ACCESS_KEY') },
});

// --- upload to R2 (the CDN origin the updater reads) ---
console.log(`Uploading -> ${Bucket}/${R2_KEY} ...`);
await s3.send(new PutObjectCommand({
  Bucket, Key: R2_KEY, Body: readFileSync(APK),
  ContentType: 'application/vnd.android.package-archive',
  CacheControl: 'public, max-age=300',
}));
const head = await s3.send(new HeadObjectCommand({ Bucket, Key: R2_KEY }));
if (head.ContentLength !== size) { console.error(`R2 size mismatch (${head.ContentLength} != ${size})`); process.exit(1); }
console.log(`R2 OK (ETag ${head.ETag}).`);

// NOTE: deliberately NOT copied to public/downloads/VERGR.apk. The APK is served
// ONLY from R2 (cdn.vergr.app) — every consumer (NativeUpdateBanner, the marketing
// download cards, InstallAppBanner) points at the CDN URL. A public/ copy is dead
// weight that (a) bakes 87MB into the desktop NSIS installer via dist/ and (b)
// ships 87MB on every Firebase Hosting deploy (Spark 360MB/day). Big binaries live
// ONLY on R2 — same rule make-update-manifest.mjs follows for the installer.

// --- rewrite version.json: cache-bust token = versionCode (unique + monotonic) ---
const vj = JSON.parse(readFileSync(VERSION_JSON, 'utf8'));
vj.androidVersion = versionName;
// NativeUpdateBanner compares androidVersionCode against the installed app's
// APP_VERSION_CODE (the small 1,2,3… scheme in src/utils/appVersion.js) — keep
// them in lockstep or the banner never offers the update.
const appCode = /APP_VERSION_CODE\s*=\s*(\d+)/.exec(readFileSync(join(repo, 'src/utils/appVersion.js'), 'utf8'))?.[1];
if (appCode) vj.androidVersionCode = Number(appCode);
vj.apkUrl = `${CDN_URL}?v=${versionCode}`;
vj.apkSize = size;
vj.apkSha256 = sha256;
vj.apkPublishedAt = new Date().toISOString();
writeFileSync(VERSION_JSON, JSON.stringify(vj, null, 2) + '\n');
console.log(`${IS_DEV ? 'version-dev.json' : 'version.json'} -> androidVersionCode ${vj.androidVersionCode}, apkUrl ${vj.apkUrl}`);

console.log(`\nNext: firebase deploy --only hosting   (publishes the manifest; APK is on R2 only)`);
if (IS_DEV) {
  console.log('Then log what changed in docs/DEV_CHANNEL_LOG.md so the next AAB is not cut blind.');
  console.log(`First install on a new device is manual (the stable build cannot jump channels): ${CDN_URL}`);
}
