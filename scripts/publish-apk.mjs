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
console.log(`APK: ${versionName} (code ${versionCode}), ${size} bytes`);

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
writeFileSync(VERSION_JSON, JSON.stringify(vj, null, 2) + '\n');
console.log(`${IS_DEV ? 'version-dev.json' : 'version.json'} -> androidVersionCode ${vj.androidVersionCode}, apkUrl ${vj.apkUrl}`);

console.log(`\nNext: firebase deploy --only hosting   (publishes the manifest; APK is on R2 only)`);
if (IS_DEV) {
  console.log('Then log what changed in docs/DEV_CHANNEL_LOG.md so the next AAB is not cut blind.');
  console.log(`First install on a new device is manual (the stable build cannot jump channels): ${CDN_URL}`);
}
