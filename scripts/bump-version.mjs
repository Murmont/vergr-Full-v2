// Bumps the release version in lockstep across the files that matter for a
// native APK + desktop release:
//   - src/utils/appVersion.js   (APP_VERSION + APP_VERSION_CODE)
//   - src-tauri/tauri.conf.json (version)
//   - public/sw.js              (CACHE_NAME vergr-vN — PWA cache bust)
// version.json is NOT touched here: scripts/publish-apk.mjs rewrites it from
// the real built APK versionCode.
//
// Usage: node scripts/bump-version.mjs   (increments the patch/code by 1)
import { readFileSync, writeFileSync } from 'fs';

const read = (p) => readFileSync(p, 'utf8');
const write = (p, s) => writeFileSync(p, s);

// --- appVersion.js: source of truth for the numeric code ---
const APP = 'src/utils/appVersion.js';
let app = read(APP);
const codeMatch = app.match(/APP_VERSION_CODE\s*=\s*(\d+)/);
if (!codeMatch) { console.error('Could not find APP_VERSION_CODE'); process.exit(1); }
const oldCode = parseInt(codeMatch[1], 10);
const newCode = oldCode + 1;
const newVersion = `1.0.${newCode}`;

app = app.replace(/APP_VERSION\s*=\s*'[^']*'/, `APP_VERSION = '${newVersion}'`);
app = app.replace(/APP_VERSION_CODE\s*=\s*\d+/, `APP_VERSION_CODE = ${newCode}`);
write(APP, app);

// --- tauri.conf.json: version string ---
const TAURI = 'src-tauri/tauri.conf.json';
let tauri = read(TAURI);
tauri = tauri.replace(/("version"\s*:\s*")[^"]*(")/, `$1${newVersion}$2`);
write(TAURI, tauri);

// --- sw.js: cache name ---
const SW = 'public/sw.js';
let sw = read(SW);
sw = sw.replace(/(CACHE_NAME\s*=\s*'vergr-v)(\d+)(')/, (_, a, n, c) => `${a}${parseInt(n, 10) + 1}${c}`);
write(SW, sw);

console.log(`Bumped ${oldCode} -> ${newCode}  (version ${newVersion})`);
