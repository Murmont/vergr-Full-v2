#!/usr/bin/env node
// ────────────────────────────────────────────────────────────
// publish-admin-update.mjs
// ────────────────────────────────────────────────────────────
// Publishes a Vergr Admin build (or, with --app vanguard, a Vergr Vanguard
// build) so every installed copy can update itself.
//
// ⚠⚠ WHY THIS EXISTS. Vergr Admin shipped with `createUpdaterArtifacts: false`
// and no updater block, so an installed console was frozen at whatever build it
// was handed. That is worse than a stale consumer app: a moderation console one
// build behind bans with old rules and renders screens the server has moved on
// from.
//
// ⚠⚠ THE UPDATE IS LOCKED, NOT HIDDEN (2026-09-21). Until then the installer
// sat on the public CDN at an unguessable path, so anyone handed that URL could
// download the admin console. It now goes to box 1 (/opt/vergr-ops/public/<app>/),
// where nginx serves /ops/ only to a request carrying a 15-minute download
// ticket (infra/ops-auth), minted by getMyAdminSecurityStatus
// (functions/adminSecurity.js). Box 1's traffic is already paid for, so this
// costs nothing. NEVER put either installer back on R2 or in public/.
//
// ⚠ TICKETS ARE SCOPED. An admin ticket opens /ops/admin/ only and a Vanguard
// ticket /ops/vanguard/ only, so a moderator cannot fetch the admin console.
//
// ⚠ IT REUSES THE CONSUMER SIGNING KEY. The signature proves the bytes came
// from us; who may FETCH them is the ticket, and who may USE the app is the
// server (the operator claim, admin_users, users/{uid}.vanguard).
//
// Run (Vergr Admin):
//   npm run admin:build          (the build step fails on "no private key": expected)
//   npx tauri signer sign -f src-tauri/.tauri/vergr-updater.key -p '' \
//     "src-tauri/target/release/bundle/nsis/Vergr Admin_<ver>_x64-setup.exe"   (FROM BASH)
//
// ⚠⚠ THE KEY IS src-tauri/.tauri/vergr-updater.key (public key id DDCB1292EE5ED3DA),
// the one BOTH tauri.conf.json and tauri.admin.conf.json trust. This line used
// to name C:/Users/damie/vergr-keystore/tauri-updater.key (B605D0C8BC33E610),
// and 1.0.219 + 1.0.220 were signed with it: every installed Vergr Admin
// rejected them, so admin auto-update was silently broken. This script now
// refuses a .sig whose key id is not the one the app trusts.
//   VERGR_ADMIN_UPDATE_NOTES="..." node scripts/publish-admin-update.mjs
//
// Run (Vergr Vanguard, the moderation app):
//   npm run vanguard:build, sign "Vergr Vanguard_<ver>_x64-setup.exe" the same way, then
//   VERGR_VANGUARD_UPDATE_NOTES="..." node scripts/publish-admin-update.mjs --app vanguard
import { readdirSync, statSync, readFileSync, existsSync, writeFileSync, copyFileSync, chmodSync, rmSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const NSIS_DIR = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis');

// One table, so the two apps can never share a directory, a file name or a
// manifest by accident.
const APPS = {
  admin: {
    conf: 'tauri.admin.conf.json', scope: 'admin', exePrefix: 'Vergr-Admin-Setup-',
    product: /^Vergr Admin_.*-setup\.exe$/i, notesEnv: 'VERGR_ADMIN_UPDATE_NOTES', label: 'Vergr Admin',
  },
  vanguard: {
    conf: 'tauri.vanguard.conf.json', scope: 'vanguard', exePrefix: 'Vergr-Vanguard-Setup-',
    product: /^Vergr Vanguard_.*-setup\.exe$/i, notesEnv: 'VERGR_VANGUARD_UPDATE_NOTES', label: 'Vergr Vanguard',
  },
};
const appArg = (() => { const i = process.argv.indexOf('--app'); return i >= 0 ? process.argv[i + 1] : 'admin'; })();
const APP = APPS[appArg];
if (!APP) {
  console.error(`[publish-update] unknown --app "${appArg}". Use one of: ${Object.keys(APPS).join(', ')}`);
  process.exit(1);
}
const TAG = `[publish-update:${appArg}]`;
const conf = JSON.parse(readFileSync(join(ROOT, 'src-tauri', APP.conf), 'utf8'));
const version = conf.version;

// The public URL is read from the endpoint the BINARY was built with, so the
// upload can never land somewhere the app is not looking.
const endpoint = conf.plugins?.updater?.endpoints?.[0] || '';
const expected = `https://sfu.vergr.app/ops/${APP.scope}/latest.json`;
if (endpoint !== expected) {
  console.error(`${TAG} ${APP.conf} does not point at the locked channel.`);
  console.error(`  expected ${expected}, got:`, endpoint || '(none)');
  process.exit(1);
}
const HOST = 'root@91.98.79.244';
const DIR = `/opt/vergr-ops/public/${APP.scope}`;
const EXE_NAME = `${APP.exePrefix}${version}.exe`;
const EXE_URL = `https://sfu.vergr.app/ops/${APP.scope}/${EXE_NAME}`;
const KEEP = 2; // installers kept on the box: this one and the previous one

// ⚠ THE NSIS DIRECTORY IS SHARED WITH THE CONSUMER BUILD AND THE OTHER APP, so
// "newest file" would happily publish VERGR-Setup.exe or the wrong console.
// Match the product name, and then assert the version too.
const isThisApp = (f) => APP.product.test(f);
function newest(pred) {
  if (!existsSync(NSIS_DIR)) return null;
  return readdirSync(NSIS_DIR)
    .filter(pred)
    .map((f) => ({ full: join(NSIS_DIR, f), name: f, mtime: statSync(join(NSIS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0] || null;
}
const exe = newest(isThisApp);
const sig = newest((f) => isThisApp(f.replace(/\.sig$/i, '')) && /\.sig$/i.test(f));

if (!exe) {
  console.error(`${TAG} No "${APP.label}_*-setup.exe" in`, NSIS_DIR);
  process.exit(1);
}
if (!exe.name.includes(version)) {
  console.error(`${TAG} Newest installer is ${exe.name}, but the config says ${version}.`);
  console.error('  Rebuild, or fix the version. Publishing a mismatch would advertise an update nobody receives.');
  process.exit(1);
}
if (!sig || !sig.name.includes(version)) {
  console.error(`${TAG} No matching .sig beside`, exe.name);
  console.error('  The updater verifies a detached signature before installing anything, so an');
  console.error('  unsigned build cannot ship. Sign it from BASH (see the header of this file).');
  process.exit(1);
}

const size = statSync(exe.full).size;
const sha256 = createHash('sha256').update(readFileSync(exe.full)).digest('hex');
const signature = readFileSync(sig.full, 'utf8').trim();

// The signing key must be the one the APP trusts. Both are minisign: the key id
// is bytes 2..10 of the decoded key/signature line, little-endian. A signature
// from any other key is rejected by every installed copy, silently, which is
// how 1.0.219 and 1.0.220 went out unusable.
function minisignKeyId(b64Blob) {
  const line = Buffer.from(b64Blob, 'base64').toString('utf8').split('\n')[1] || '';
  const raw = Buffer.from(line.trim(), 'base64');
  return raw.length >= 10 ? Buffer.from(raw.subarray(2, 10)).reverse().toString('hex').toUpperCase() : null;
}
const trustedKeyId = minisignKeyId(conf.plugins?.updater?.pubkey || '');
const signedKeyId = minisignKeyId(signature);
if (!trustedKeyId || trustedKeyId !== signedKeyId) {
  console.error(`${TAG} ${exe.name} is signed with key ${signedKeyId || '(unreadable)'}, but ${APP.conf} trusts ${trustedKeyId || '(none)'}.`);
  console.error('  Every installed copy would reject this update. Sign with src-tauri/.tauri/vergr-updater.key.');
  process.exit(1);
}

// ssh refuses a key readable by others, and Windows ACLs on ~/.ssh read as
// such, so work from a private temp copy.
const work = mkdtempSync(join(tmpdir(), 'vergr-ops-'));
const key = join(work, 'k');
copyFileSync(join(homedir(), '.ssh', 'vergr-streaming.key'), key);
chmodSync(key, 0o600);
const SSH_OPTS = ['-i', key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=20'];
const ssh = (cmd) => execFileSync('ssh', [...SSH_OPTS, HOST, cmd], { encoding: 'utf8' }).trim();
const scp = (from, to) => execFileSync('scp', [...SSH_OPTS, from, `${HOST}:${to}`], { stdio: 'inherit' });

try {
  console.log(`${TAG} v${version}, ${(size / 1_048_576).toFixed(1)} MB -> ${HOST}:${DIR}/${EXE_NAME}`);
  ssh(`mkdir -p ${DIR}`);
  // Upload under a temp name, then rename: an app must never be offered a
  // half-written file.
  scp(exe.full, `${DIR}/.${EXE_NAME}.part`);
  const remoteSize = Number(ssh(`stat -c %s ${DIR}/.${EXE_NAME}.part`));
  if (remoteSize !== size) throw new Error(`size mismatch on the box (${remoteSize} != ${size})`);
  ssh(`mv -f ${DIR}/.${EXE_NAME}.part ${DIR}/${EXE_NAME}`);

  // ⚠ THE MANIFEST GOES LAST. It is what tells an app an update exists;
  // writing it before the installer would advertise a build that is not there.
  const manifest = {
    version,
    notes: process.env[APP.notesEnv]?.trim() || `${APP.label} ${version}.`,
    size,
    sha256,
    pub_date: new Date().toISOString(),
    platforms: { 'windows-x86_64': { signature, url: EXE_URL } },
  };
  const manifestFile = join(work, 'latest.json');
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  scp(manifestFile, `${DIR}/.latest.json.part`);
  ssh(`mv -f ${DIR}/.latest.json.part ${DIR}/latest.json`);

  // Keep this installer and the one before it; older ones are just disk.
  ssh(`cd ${DIR} && ls -1t ${APP.exePrefix}*.exe | tail -n +${KEEP + 1} | xargs -r rm -f`);

  // Control: the channel must refuse a request with no ticket. A 200 here
  // would mean the app is publicly downloadable.
  const devNull = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const anon = execFileSync('curl', ['-s', '-o', devNull, '-w', '%{http_code}', endpoint], { encoding: 'utf8' }).trim();
  console.log(`  installer -> ${EXE_URL}`);
  console.log(`  sha256    -> ${sha256}`);
  console.log(`  no-ticket request to the manifest -> HTTP ${anon} (must be 401)`);
  if (anon !== '401') {
    console.error(`${TAG} ⚠ The channel did NOT refuse an anonymous request. Check nginx on box 1.`);
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
