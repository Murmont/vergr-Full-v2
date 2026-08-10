/**
 * Put the native (Kotlin) build on the founder's phone.
 *
 * A local build lives at a path on the PC, which a phone obviously cannot open.
 * This uploads it to an unlisted R2 object and prints the URL to type into the
 * phone browser.
 *
 * SEPARATE FROM BOTH APK CHANNELS ON PURPOSE. `scripts/publish-apk.mjs` handles
 * the WebView app's stable and dev channels. This is a different application id
 * (`com.vergr.desktop.dev`) with its own manifest, and it never touches the
 * store build.
 *
 * IT SELF-UPDATES. Alongside the APK this writes `vergr-native-preview.json`
 * carrying the APK file's own modification time. The installed dev build polls
 * that file while it is in the foreground and offers the install as soon as
 * `builtAt` is newer than when the running copy was installed (see
 * `dev/DevUpdateGate.kt`). So a rebuild published mid-session shows an Install
 * bar on the phone without anyone typing a URL again.
 *
 * The time comparison is deliberate: it means no versionCode has to be bumped
 * per build. Forgetting to bump one would be silent, and a dev updater that
 * quietly stops firing is worse than not having one.
 *
 * Run (from repo root, after `cd android-native && ./gradlew :androidApp:assembleDebug`):
 *   node scripts/publish-native-apk.mjs
 *
 * Requires the `firebase` CLI logged in (it pulls the R2 secrets).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, '..');
const require = createRequire(join(repo, 'functions', 'package.json'));
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

const APK = join(repo, 'android-native/androidApp/build/outputs/apk/debug/androidApp-debug.apk');
const R2_KEY = 'downloads/vergr-native-preview.apk';
const MANIFEST_KEY = 'downloads/vergr-native-preview.json';

// NOTHING GETS PUBLISHED UNTIL IT HAS RUN.
//
// alpha04 went out, installed, and crashed on launch, and because it crashed it
// could not show the update banner either, so the fix could not reach the phone
// the way every other fix does. The APK had never been executed anywhere between
// this machine and his hand. `scripts/smoke-native.mjs` is that missing step:
// emulator, real install, every class initialised.
//
// `--skip-smoke` exists for when the emulator itself is the thing that is
// broken. It is a decision to publish something unverified, so it says so.
if (process.argv.includes('--skip-smoke')) {
  console.warn('\n!! Publishing WITHOUT the on-device smoke test. Nothing has run this build.\n');
} else {
  console.log('Running on-device smoke tests before publishing...');
  try {
    execFileSync(process.execPath, [join(__dirname, 'smoke-native.mjs')], { stdio: 'inherit' });
  } catch {
    console.error('\nSmoke tests failed. Not publishing.');
    console.error('Fix it, or publish anyway with:  node scripts/publish-native-apk.mjs --skip-smoke');
    process.exit(1);
  }
}

// After the smoke run, which builds it. Only reachable with --skip-smoke on a
// tree that was never built.
if (!existsSync(APK)) {
  console.error(`No APK at ${APK}`);
  console.error('Build it first:  cd android-native && ./gradlew :androidApp:assembleDebug');
  process.exit(1);
}

const stat = statSync(APK);
const size = stat.size;
// The APK's own mtime, NOT Date.now(): publishing an older APK a second time
// must not read as "newer than what is installed".
const builtAt = Math.floor(stat.mtimeMs);
console.log(`APK: ${(size / 1024 / 1024).toFixed(1)} MB, built ${new Date(builtAt).toISOString()}`);

const sec = (name) =>
  execFileSync('firebase', ['functions:secrets:access', name], { encoding: 'utf8', shell: true }).trim();
const accountId = sec('R2_ACCOUNT_ID');
const Bucket = sec('R2_BUCKET');
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: sec('R2_ACCESS_KEY_ID'), secretAccessKey: sec('R2_SECRET_ACCESS_KEY') },
});

console.log(`Uploading -> ${Bucket}/${R2_KEY} ...`);
await s3.send(new PutObjectCommand({
  Bucket,
  Key: R2_KEY,
  Body: readFileSync(APK),
  ContentType: 'application/vnd.android.package-archive',
  // Short TTL: this object is replaced often during the rewrite and a stale
  // cached copy would look like "my change did not build".
  CacheControl: 'public, max-age=60',
}));

const head = await s3.send(new HeadObjectCommand({ Bucket, Key: R2_KEY }));
if (head.ContentLength !== size) {
  console.error(`R2 size mismatch (${head.ContentLength} != ${size})`);
  process.exit(1);
}

// Cache-bust on BUILD TIME, not size.
//
// It used to be size, and size is not a content hash: two different builds can
// be byte-identical in length, which produces the same URL for different bytes
// and a phone that quietly reinstalls the copy it already has. That is
// indistinguishable from "the fix did not work", and it cost an hour once.
// builtAt is monotonic and unique per publish.
const url = `https://cdn.vergr.app/${R2_KEY}?v=${builtAt}`;

// The update manifest goes up AFTER the APK is verified, so a phone can never
// be told about a build whose bytes are not there yet.
await s3.send(new PutObjectCommand({
  Bucket,
  Key: MANIFEST_KEY,
  Body: JSON.stringify({ builtAt, size, url }),
  ContentType: 'application/json',
  // Must not be cached at all. A stale manifest is the one failure that would
  // make the updater look broken while working perfectly.
  CacheControl: 'no-cache, no-store, must-revalidate',
}));

console.log(`\nOpen this on the phone:\n  ${url}\n`);
console.log('Installed dev builds pick this up on their own within a minute (foreground only).');
console.log('DEBUG build: no R8, no baseline profiles. Slower than the real thing by design.');
console.log('Judge smoothness on a release build (android-native/UI_RULES.md), never on this one.');
