// DEV-CHANNEL APK build (the founder's private playground).
//
// WHAT THIS IS
// A store-identical build that can still update itself. `--mode native-dev`
// sets IS_STORE_BUILD *and* IS_DEV_CHANNEL, so the web layer applies every Play
// policy gate (Play Billing routing, no betting, no buy-and-send, withdrawals
// handed to the browser) while keeping the in-app updater pointed at a separate
// manifest and a separate R2 object.
//
// The point is that testing on the ordinary sideload build proves nothing about
// the bundle Play ships: the sideload build has no IS_STORE_BUILD, so the gated
// surfaces are live there and tree-shaken away in the AAB. A feature can pass
// on a sideload APK and be dead in the store bundle. This build closes that gap.
//
// THE TWO DELIBERATE DIVERGENCES FROM THE PLAY BUILD, both required:
//   1. REQUEST_INSTALL_PACKAGES is NOT stripped. The updater cannot install an
//      APK without it. We therefore do NOT set ORG_GRADLE_PROJECT_vergrStore,
//      so gradle uses the ordinary source manifest.
//   2. The in-app updater is enabled (see src/utils/platform.js IS_DEV_CHANNEL).
// Neither is a policy problem: this APK is never distributed through a store.
//
// STILL NOT PROVABLE HERE: a real Play Billing purchase, which needs a
// Play-installed build (internal testing track).
//
// Usage:  npm run android:build:dev -- --target aarch64
//         node scripts/publish-apk.mjs --channel dev
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);

// An AAB from here would land at the exact path the store build writes to and
// would silently replace a verified release bundle with an unreleased, dev
// channel, self-updating one. That has already burned a session once with the
// sideload build (see android-store-build.mjs). Refuse outright.
if (args.includes('--aab')) {
  console.error('[android-dev-build] --aab is not allowed on the dev channel.');
  console.error('[android-dev-build] It writes to the same path as the store bundle and would');
  console.error('[android-dev-build] overwrite it. Build store bundles with: npm run android:build:store');
  process.exit(1);
}

console.log('[android-dev-build] dev channel: store gates ON, self-updater ON, install permission KEPT');

const child = spawn(
  'npx',
  ['tauri', 'android', 'build', '--config', 'src-tauri/tauri.dev.conf.json', ...args],
  {
    stdio: 'inherit',
    shell: true, // npx resolution on Windows
    // Deliberately NO ORG_GRADLE_PROJECT_vergrStore: see divergence 1 above.
  }
);

child.on('exit', (code) => {
  if (code === 0) {
    console.log('\n[android-dev-build] done. Publish to the PRIVATE channel with:');
    console.log('[android-dev-build]   node scripts/publish-apk.mjs --channel dev');
    console.log('[android-dev-build] then log what changed in docs/DEV_CHANNEL_LOG.md');
  }
  process.exit(code ?? 1);
});
child.on('error', (err) => {
  console.error('[android-dev-build] failed to start tauri:', err.message);
  process.exit(1);
});
