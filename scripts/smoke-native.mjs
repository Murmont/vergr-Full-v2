/**
 * Run the Kotlin app's on-device smoke tests before it is allowed out.
 *
 * ## Why this exists
 *
 * 2.0.0-alpha04 was published, installed, and crashed on launch for the only
 * user it had. The cause was a regex that the desktop JVM compiles and ICU (what
 * Android actually uses) rejects, in a top-level `val`, so the class it lived in
 * could never initialise. `./gradlew test` was green throughout, and it was
 * right to be: it runs on the JVM.
 *
 * Nothing in the pipeline had ever EXECUTED the app between it being built here
 * and being run on the founder's phone. This is that missing step. It boots an
 * emulator, installs the same debug APK that gets published, and forces every
 * class in the app through its static initialiser on a real Android runtime.
 *
 * ## What it runs
 *
 *  - `ClassInitSmokeTest`  every class the module compiles, initialised. This is
 *    the general net: any static initialiser that cannot run on Android fails
 *    here rather than on the phone, with no login and no navigation needed.
 *  - `PostRichTextSmokeTest`  the markup renderer against ICU, checking it still
 *    matches and has not fallen back to printing raw markup.
 *
 * ## Usage
 *
 *   node scripts/smoke-native.mjs                  uses a connected device
 *   node scripts/smoke-native.mjs --boot-emulator  boots one if none is there
 *
 * `publish-native-apk.mjs` calls this first and refuses to publish if it FAILS.
 * It does not refuse if the gate was SKIPPED for want of hardware, which is the
 * common case on the founder's laptop. Pass `--skip-smoke` there to bypass it
 * entirely, which is a decision, not a shortcut.
 *
 * **The best device here is his phone on USB.** It is free, it is the hardware
 * that actually matters, and unlike an emulator it does not compete with the
 * gradle daemons for memory on a machine that is also running his desktop app.
 * An emulator is only booted when explicitly asked for.
 *
 * When one is booted it is left running on purpose: booting is most of the wall
 * time and the next run reuses it. Kill it when done, it is not free.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = join(__dirname, '..');
const native = join(repo, 'android-native');

const SDK =
  process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || 'C:/Android/sdk';
const ADB = join(SDK, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const EMULATOR = join(SDK, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator');
const GRADLEW = join(native, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');

const CLASS_LIST_ON_DEVICE = '/data/local/tmp/vergr-classes.txt';

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts });

const step = (msg) => console.log(`\n[smoke] ${msg}`);

// ---------------------------------------------------------------- emulator

/** Serials of every device adb currently calls `device` (i.e. booted enough). */
function onlineDevices() {
  try {
    return run(ADB, ['devices'])
      .split('\n')
      .slice(1)
      .map((l) => l.trim().split(/\s+/))
      .filter(([serial, state]) => serial && state === 'device')
      .map(([serial]) => serial);
  } catch {
    return [];
  }
}

async function waitForBoot(timeoutMs = 240000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [serial] = onlineDevices();
    if (serial) {
      try {
        const booted = run(ADB, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']).trim();
        if (booted === '1') return serial;
      } catch {
        // adb can drop the connection while the device is still coming up.
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(
    'Emulator did not finish booting within 4 minutes. The usual cause is an ' +
      'AVD whose system image is not installed. Set VERGR_SMOKE_AVD to pick a ' +
      'different one, or check it in Android Studio.',
  );
}

async function ensureDevice() {
  const existing = onlineDevices();
  if (existing.length) {
    step(`using device ${existing[0]}`);
    return existing[0];
  }

  // AN EMULATOR IS NEVER BOOTED UNLESS ASKED FOR.
  //
  // This machine is the founder's daily driver, and it is not a build server.
  // Booting a headless emulator alongside the gradle daemons took enough memory
  // to crash the desktop app he was talking to me in. A verification step that
  // takes down the machine it runs on is not a verification step.
  //
  // The good path is a real phone on USB, which is both free and a better test
  // than any emulator. Failing that this returns null and the caller decides:
  // publishing with a loud warning beats publishing after a crash.
  if (!process.argv.includes('--boot-emulator')) {
    step('no device on adb, and --boot-emulator was not passed');
    return null;
  }

  if (!existsSync(EMULATOR)) {
    throw new Error(
      `No device connected and no emulator at ${EMULATOR}.\n` +
        'Set ANDROID_HOME, or connect a phone with USB debugging on.',
    );
  }

  const avds = run(EMULATOR, ['-list-avds']).split('\n').map((s) => s.trim()).filter(Boolean);
  if (!avds.length) {
    throw new Error(
      'No AVD exists. Create one in Android Studio (any API 30+ x86_64 image; ' +
        'the x86_64 images translate the arm64 libraries the dev build ships).',
    );
  }
  // Not `avds[0]`. That picked up a stale Pixel_2_API_30 whose system image is
  // not installed, and spent four minutes failing to boot it. Prefer the AVD
  // made for this project, which is known to have its image.
  const avd =
    process.env.VERGR_SMOKE_AVD ||
    avds.find((a) => a.toLowerCase().includes('vergr')) ||
    avds[0];
  step(`booting emulator ${avd} (headless, of ${avds.length}: ${avds.join(', ')})`);

  // Detached and unpiped: the emulator runs for the whole session and must not
  // die with this script, and its stdout never ends.
  spawn(
    EMULATOR,
    ['-avd', avd, '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot', '-gpu', 'swiftshader_indirect'],
    { detached: true, stdio: 'ignore' },
  ).unref();

  const serial = await waitForBoot();
  step(`emulator ready (${serial})`);
  return serial;
}

// -------------------------------------------------------------- class list

/**
 * Every class this module compiles, as JVM binary names.
 *
 * Read from the Kotlin compiler's own output tree rather than from the dex or
 * from source: the tree holds this module's classes and nothing else (no
 * Compose, no Firebase, no `:shared`), and a file-level `val` shows up here
 * under the synthetic `…Kt` name it will really have at runtime, which is the
 * name that has to be initialised.
 */
function collectClassNames() {
  const candidates = [
    join(native, 'androidApp/build/tmp/kotlin-classes/debug'),
    join(native, 'androidApp/build/intermediates/javac/debug/compileDebugJavaWithJavac/classes'),
  ];
  const roots = candidates.filter((p) => existsSync(p));
  if (!roots.length) {
    throw new Error(
      `Found no compiled classes. Looked in:\n  ${candidates.join('\n  ')}\n` +
        'Build first: cd android-native && ./gradlew :androidApp:assembleDebug',
    );
  }

  const names = new Set();
  const walk = (root, dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(root, full);
      } else if (entry.endsWith('.class')) {
        names.add(
          full
            .slice(root.length + 1)
            .replace(/\\/g, '/')
            .replace(/\.class$/, '')
            .replace(/\//g, '.'),
        );
      }
    }
  };
  roots.forEach((root) => walk(root, root));

  // BuildConfig is generated per build and R holds nothing but ints; both are
  // noise, and R in particular is thousands of entries.
  return [...names]
    .filter((n) => !/(^|\.)R(\$|$)/.test(n) && !n.endsWith('.BuildConfig'))
    .sort();
}

// ------------------------------------------------------------------- main

let device;
try {
  device = await ensureDevice();

  if (!device) {
    console.warn(
      '\n[smoke] SKIPPED. Nothing ran the app.\n' +
        '  Plug in a phone with USB debugging and run this again, or pass\n' +
        '  --boot-emulator if this machine has memory to spare.\n' +
        '  Exiting 0 so a publish is not blocked by the absence of hardware.\n',
    );
    process.exit(0);
  }

  step('building app + test APKs');
  execFileSync(GRADLEW, ['--quiet', ':androidApp:assembleDebug', ':androidApp:assembleDebugAndroidTest'], {
    cwd: native,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  const classes = collectClassNames();
  step(`${classes.length} classes to initialise`);
  const listPath = join(native, 'androidApp/build/smoke/vergr-classes.txt');
  mkdirSync(dirname(listPath), { recursive: true });
  writeFileSync(listPath, classes.join('\n'));
  run(ADB, ['-s', device, 'push', listPath, CLASS_LIST_ON_DEVICE]);

  step('running on-device smoke tests');
  // No `-Pandroid.testInstrumentationRunnerArguments.classList`: passing a
  // runner argument on the command line disables Gradle's configuration cache,
  // and the test already defaults to the path pushed above. The argument is
  // still read if someone wants to point it somewhere else.
  execFileSync(GRADLEW, [':androidApp:connectedDebugAndroidTest'], {
    cwd: native,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  console.log('\n[smoke] PASS. The app initialises on Android.');
} catch (err) {
  console.error(`\n[smoke] FAIL. ${err.message?.split('\n')[0] ?? err}`);
  console.error(
    'Full report: android-native/androidApp/build/reports/androidTests/connected/debug/index.html',
  );
  process.exit(1);
}
