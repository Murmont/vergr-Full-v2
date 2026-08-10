// Huawei AppGallery build.
//
// Same policy posture as the Play store build — ORG_GRADLE_PROJECT_vergrStore
// strips REQUEST_INSTALL_PACKAGES, because AppGallery forbids self-updating
// apps exactly like Play does — but a DIFFERENT web bundle:
// `vite build --mode native-huawei` sets IS_HUAWEI_BUILD, which routes coin and
// subscription purchases through PayRam. Huawei devices have no Google Play
// Services, so Play Billing can never connect there; the Play build's
// fail-closed behaviour would leave a Huawei user staring at a coin pack that
// says "temporarily unavailable" forever.
//
// Output is an APK, not an AAB: AppGallery Connect's normal upload path is an
// APK and it is what their review tooling expects.
//
// THE ARCHIVE STEP IS NOT OPTIONAL. Every android build in this repo writes to
// the same outputs directory, so the next sideload or store build silently
// replaces this APK with one that has the self-updater enabled. That has
// already burned a session once. The finished build is copied out immediately.
//
// Usage:  npm run android:build:huawei -- --target aarch64 --target armv7
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeStoreManifest, assertMergedManifestsClean } from './lib/storeManifest.mjs';

const args = process.argv.slice(2);

// Must happen BEFORE gradle starts — see scripts/lib/storeManifest.mjs for the
// ordering bug this prevents.
writeStoreManifest({ huawei: true });

const BUILT = 'src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk';
const ARCHIVE_DIR = join(homedir(), 'Downloads');

function version() {
  try {
    return JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
}

// Anything older than this was produced by a PREVIOUS build.
const START = Date.now();

function archive() {
  if (!existsSync(BUILT)) {
    console.error('[android-huawei-build] no APK at', BUILT);
    console.error('[android-huawei-build] `tauri android build` emits an AAB unless --apk is passed.');
    process.exitCode = 1;
    return;
  }
  // STALENESS GUARD. Without this the script will happily archive an APK left
  // behind by an earlier build: that happened on 2026-08-04, when a run that
  // emitted only an AAB copied the previous run's APK and reported success at
  // the identical byte size. A stale artifact is worse than none — it looks
  // verified. Refuse rather than ship the wrong file.
  const builtAt = statSync(BUILT).mtimeMs;
  if (builtAt < START) {
    console.error('[android-huawei-build] REFUSING TO ARCHIVE: the APK at');
    console.error('[android-huawei-build]', BUILT);
    console.error('[android-huawei-build] predates this build — it is left over from a previous run.');
    console.error('[android-huawei-build] Did this build emit an AAB instead? Pass --apk.');
    process.exitCode = 1;
    return;
  }
  try {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
    const dest = join(ARCHIVE_DIR, `VERGR-huawei-${version()}.apk`);
    copyFileSync(BUILT, dest);
    const mb = (statSync(dest).size / 1024 / 1024).toFixed(1);
    console.log(`[android-huawei-build] archived -> ${dest} (${mb} MB)`);
    console.log('[android-huawei-build] upload THAT file to AppGallery Connect. The one in');
    console.log('[android-huawei-build] build/outputs will be overwritten by the next build.');
  } catch (err) {
    console.error('[android-huawei-build] COULD NOT ARCHIVE THE APK:', err.message);
    console.error('[android-huawei-build] copy it out of build/outputs yourself before the next build.');
  }
}

const child = spawn(
  'npx',
  // --apk is NOT optional: `tauri android build` emits an AAB by default, and
  // AppGallery Connect's upload path expects an APK. Without it the build
  // "succeeds" while producing nothing this script can ship.
  ['tauri', 'android', 'build', '--apk', '--config', 'src-tauri/tauri.huawei.conf.json', ...args],
  {
    stdio: 'inherit',
    shell: true, // npx resolution on Windows
    // vergrStore strips REQUEST_INSTALL_PACKAGES (AppGallery forbids
    // self-updating apps too); vergrHuawei adds the Petal Ads SDK and the
    // Huawei-only Kotlin under app/src/huawei/java.
    env: { ...process.env, ORG_GRADLE_PROJECT_vergrStore: '1', ORG_GRADLE_PROJECT_vergrHuawei: '1' },
  }
);

child.on('exit', (code) => {
  if (code === 0) {
    // Petal Ads re-declares both of these, so check what the merger actually
    // produced rather than what we wrote. Runs BEFORE archiving so a dirty
    // build never reaches Downloads looking finished.
    try {
      assertMergedManifestsClean([
        'android.permission.REQUEST_INSTALL_PACKAGES',
        'android.permission.QUERY_ALL_PACKAGES',
      ]);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    archive();
  }
  process.exit(code ?? 1);
});
child.on('error', (err) => {
  console.error('[android-huawei-build] failed to start tauri:', err.message);
  process.exit(1);
});
