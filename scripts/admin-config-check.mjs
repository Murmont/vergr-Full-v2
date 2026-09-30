// admin-config-check: every App Config switch must be READ by something.
//
// Until 2026-09-21 Admin → App Config offered 64 settings and 58 of them were
// read by nothing in src/, functions/ or infra/: "Maintenance Mode", "Allow New
// Registrations", an admin IP allowlist, a failed-login lockout, Custom CSS.
// The operator saved them and nothing changed. A switch that lies is worse than
// no switch, so this fails `npm run check` if any key the server will accept
// (functions/adminConfig.js FIELD_WHITELIST) has no reader outside the config
// code itself.
//
//   node scripts/admin-config-check.mjs             run the check
//   node scripts/admin-config-check.mjs --self-test prove it fails on an unread key

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const CONFIG = path.join(ROOT, 'functions', 'adminConfig.js');
// The files that WRITE or DISPLAY config are not readers.
const EXCLUDE = new Set([
  path.join(ROOT, 'functions', 'adminConfig.js'),
  path.join(ROOT, 'src', 'screens', 'admin', 'AdminConfigScreen.jsx'),
  path.join(ROOT, 'scripts', 'admin-config-check.mjs'),
]);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-admin', 'dist-vanguard', 'target', 'gen', '.git']);

function whitelistKeys(src) {
  const start = src.indexOf('const FIELD_WHITELIST');
  const end = src.indexOf('const ALL_SECTIONS');
  if (start < 0 || end < 0) throw new Error('FIELD_WHITELIST not found in functions/adminConfig.js');
  // Only the quoted strings, never the comments between them.
  const block = src.slice(start, end).split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  return [...block.matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1]);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs|cjs|go)$/.test(e.name) && !EXCLUDE.has(p)) out.push(p);
  }
  return out;
}

function unread(keys, texts) {
  return keys.filter((k) => {
    const re = new RegExp(`\\b${k}\\b`);
    return !texts.some((t) => re.test(t));
  });
}

const files = [
  ...walk(path.join(ROOT, 'src')),
  ...walk(path.join(ROOT, 'functions')),
  ...walk(path.join(ROOT, 'infra')),
];
const texts = files.map((f) => fs.readFileSync(f, 'utf8'));
const keys = whitelistKeys(fs.readFileSync(CONFIG, 'utf8'));

if (process.argv.includes('--self-test')) {
  const probe = 'zzUnreadProbeSwitch';
  const bad = unread([...keys, probe], texts);
  if (!bad.includes(probe)) { console.error('✗ self-test: an unread key was NOT caught'); process.exit(1); }
  const good = unread(keys, texts);
  if (good.length) { console.error('✗ self-test: real keys reported unread:', good.join(', ')); process.exit(1); }
  console.log(`✓ admin-config-check self-test: catches an unread key, passes the ${keys.length} real ones`);
  process.exit(0);
}

if (keys.length === 0) { console.error('✗ admin-config-check: read 0 keys from FIELD_WHITELIST'); process.exit(1); }
const missing = unread(keys, texts);
if (missing.length) {
  console.error(`✗ admin-config-check: App Config accepts ${missing.length} key(s) nothing reads: ${missing.join(', ')}`);
  console.error('  Wire a reader, or remove the key from FIELD_WHITELIST and from AdminConfigScreen.');
  process.exit(1);
}
console.log(`✓ admin-config-check: all ${keys.length} App Config keys have a reader`);
