// Generate the permission-stripped store manifest BEFORE Gradle is invoked.
//
// WHY THIS IS NOT DONE IN GRADLE ANY MORE (2026-08-04):
// build.gradle.kts used to write this file at configuration time. A multi-target
// build (`--target aarch64 --target armv7`) drives Gradle more than once, and on
// at least one run the manifest merger consumed a STALE merged manifest that
// still declared REQUEST_INSTALL_PACKAGES — the file was observed being written
// nine seconds AFTER the APK it was supposed to have shaped. The stripped
// manifest looked correct on disk while the shipped APK carried the permission.
//
// Writing it here removes the ordering hazard entirely: the file is complete on
// disk before Gradle configures anything. The gradle-side `check()` stays as a
// second line of defence.
//
// NEVER trust the gradle log or this script as proof. Verify the built artifact:
//   aapt2 dump permissions <apk> | grep INSTALL_PACKAGES     -> must be empty
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Permissions that must never reach a store build. Add here, not in a fork. */
export const STORE_STRIPPED_PERMISSIONS = [
  'android.permission.REQUEST_INSTALL_PACKAGES',
];

const SOURCE = 'src-tauri/gen/android/app/src/main/AndroidManifest.xml';
const OUT = 'src-tauri/gen/android/app/build/generated/vergr/store/AndroidManifest.xml';

/**
 * Permissions a LIBRARY contributes that we must not ship.
 *
 * Deleting our own declaration is not enough: the manifest merger re-adds
 * anything a dependency declares. `com.huawei.hms:ads-base` (pulled in by Petal
 * Ads) declares BOTH of these, which is how a Huawei APK ended up carrying
 * REQUEST_INSTALL_PACKAGES on 2026-08-04 despite our manifest being clean —
 * confirmed in build/outputs/logs/manifest-merger-*-report.txt as
 * "ADDED from [com.huawei.hms:ads-base]".
 *
 * `tools:node="remove"` is the only thing that overrides a library.
 */
const LIBRARY_CONTRIBUTED_REMOVALS = [
  'android.permission.REQUEST_INSTALL_PACKAGES',
  'android.permission.QUERY_ALL_PACKAGES',
];

export function writeStoreManifest({ huawei = false } = {}) {
  let out = readFileSync(SOURCE, 'utf8')
    .split('\n')
    .filter((line) => !STORE_STRIPPED_PERMISSIONS.some((p) => line.includes(p)))
    .join('\n');

  for (const perm of STORE_STRIPPED_PERMISSIONS) {
    if (out.includes(perm)) {
      throw new Error(`[storeManifest] ${perm} survived stripping — refusing to build`);
    }
  }

  if (huawei) {
    if (!out.includes('xmlns:tools')) {
      out = out.replace(
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n          xmlns:tools="http://schemas.android.com/tools"'
      );
      if (!out.includes('xmlns:tools')) {
        throw new Error('[storeManifest] could not add the tools namespace — manifest root changed?');
      }
    }
    const removals = LIBRARY_CONTRIBUTED_REMOVALS
      .map((p) => `    <uses-permission android:name="${p}" tools:node="remove" />`)
      .join('\n');
    out = out.replace('</manifest>', `${removals}\n</manifest>`);
    console.log(
      `[storeManifest] huawei: suppressing ${LIBRARY_CONTRIBUTED_REMOVALS.length} library-contributed permission(s)`
    );
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, out);
  console.log(
    `[storeManifest] wrote ${OUT} (stripped ${STORE_STRIPPED_PERMISSIONS.length} permission(s))`
  );
  return OUT;
}

const MERGED_DIR = 'src-tauri/gen/android/app/build/intermediates/merged_manifest';

/**
 * Assert the MERGED manifest is clean, after the build.
 *
 * Stripping our own manifest is only half the job: the merger re-adds anything a
 * DEPENDENCY declares, and nothing was checking that. `com.huawei.hms:ads-base`
 * declares REQUEST_INSTALL_PACKAGES and QUERY_ALL_PACKAGES, so adding Petal Ads
 * silently put both back into a build whose own manifest was spotless
 * (2026-08-04). The gradle-side check could never have seen it.
 *
 * This reads what the merger actually produced, which is the only thing that
 * reflects the shipped APK. Still not a substitute for checking the artifact —
 * run `aapt2 dump permissions` on the APK too.
 */
export function assertMergedManifestsClean(permissions = STORE_STRIPPED_PERMISSIONS) {
  if (!existsSync(MERGED_DIR)) {
    console.warn('[storeManifest] no merged manifests found - skipping merged check');
    return;
  }
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === 'AndroidManifest.xml') {
        const text = readFileSync(p, 'utf8');
        for (const perm of permissions) {
          if (text.includes(perm)) found.push(`${perm} in ${p}`);
        }
      }
    }
  };
  walk(MERGED_DIR);

  if (found.length) {
    console.error('[storeManifest] MERGED MANIFEST IS NOT CLEAN:');
    for (const f of found) console.error('  ' + f);
    console.error('[storeManifest] a dependency is re-declaring it. Suppress with');
    console.error('[storeManifest] tools:node="remove" - stripping our manifest is not enough.');
    throw new Error('[storeManifest] merged manifest still declares a stripped permission');
  }
  console.log('[storeManifest] merged manifests verified clean');
}
