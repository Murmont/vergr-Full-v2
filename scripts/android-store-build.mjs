// Play Store AAB/APK build.
//
// Identical to `npm run android:build` except for two things, both required by
// Play policy and both driven from here so the sideload build can never pick
// them up by accident:
//
//   1. --mode native-store  (via tauri.store.conf.json's beforeBuildCommand)
//      sets IS_STORE_BUILD, which disables the in-app updater and the OTA
//      hotswap in the web layer, and routes purchases through Play Billing.
//
//   2. ORG_GRADLE_PROJECT_vergrStore makes build.gradle.kts strip
//      REQUEST_INSTALL_PACKAGES from the manifest. Gradle reads any
//      ORG_GRADLE_PROJECT_<name> env var as a project property, which is how
//      the flag crosses the tauri CLI without it needing a passthrough flag.
//
// The sideloaded APK on cdn.vergr.app keeps its self-updater. These are two
// separate distribution paths and this script is the only thing that makes the
// Play one different.
//
// Usage:  npm run android:build:store -- --aab --target aarch64 --target armv7
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeStoreManifest, assertMergedManifestsClean } from './lib/storeManifest.mjs';

const args = process.argv.slice(2);

// Must happen BEFORE gradle starts — see scripts/lib/storeManifest.mjs. Gradle
// used to write this at configuration time and a multi-target build could merge
// a stale manifest that still declared REQUEST_INSTALL_PACKAGES.
writeStoreManifest();

// Where gradle drops the bundle, and where the finished store build is kept.
//
// THESE MUST BE DIFFERENT PLACES, and that is the whole reason this copy exists.
// `npm run android:build` (the ordinary sideload build) ALSO emits an AAB, to
// the exact same path — so any sideload build run afterwards silently replaces a
// verified store bundle with one that still declares REQUEST_INSTALL_PACKAGES,
// is arm64-only, and carries the sideload web bundle (self-updater enabled,
// card checkout for digital goods, betting surfaces). It looks finished and Play
// would reject it. That has already burned a session: a stale sideload AAB sat
// in the output directory looking like the release candidate.
//
// So the store build archives itself the moment it succeeds. Do not remove this
// and rely on remembering to copy it by hand.
const BUILT = 'src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab';
const ARCHIVE_DIR = join(homedir(), 'Downloads');

function version() {
  try {
    return JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function archive() {
  if (!existsSync(BUILT)) {
    console.warn('[android-store-build] no AAB at', BUILT, '- nothing archived (did you pass --aab?)');
    return;
  }
  try {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
    const dest = join(ARCHIVE_DIR, `VERGR-${version()}.aab`);
    copyFileSync(BUILT, dest);
    const mb = (statSync(dest).size / 1024 / 1024).toFixed(1);
    console.log(`[android-store-build] archived -> ${dest} (${mb} MB)`);
    console.log('[android-store-build] upload THAT file. The one in build/outputs will be');
    console.log('[android-store-build] overwritten by the next sideload build.');
  } catch (err) {
    // Loud, because a silent failure here recreates exactly the problem this
    // function exists to prevent.
    console.error('[android-store-build] COULD NOT ARCHIVE THE AAB:', err.message);
    console.error('[android-store-build] copy it out of build/outputs yourself before the next build.');
  }
}

const child = spawn(
  'npx',
  ['tauri', 'android', 'build', '--config', 'src-tauri/tauri.store.conf.json', ...args],
  {
    stdio: 'inherit',
    shell: true, // npx resolution on Windows
    env: { ...process.env, ORG_GRADLE_PROJECT_vergrStore: '1' },
  }
);

child.on('exit', (code) => {
  if (code === 0) {
    // Check what the MERGER produced, not what we wrote. Stripping our own
    // manifest does nothing about a dependency that declares the same
    // permission — that is exactly how Petal Ads put REQUEST_INSTALL_PACKAGES
    // back into a Huawei build on 2026-08-04 while our manifest was spotless.
    // AdMob does not do this today, but the next SDK might.
    try {
      assertMergedManifestsClean();
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    archive();
  }
  process.exit(code ?? 1);
});
child.on('error', (err) => {
  console.error('[android-store-build] failed to start tauri:', err.message);
  process.exit(1);
});
