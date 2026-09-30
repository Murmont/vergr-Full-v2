// Vergr Admin builds from admin.html and Vergr Vanguard from vanguard.html
// (each its own shell, separate from the app's index.html). Tauri loads
// index.html from frontendDist, so the built entry is copied into place here
// rather than renaming the source file, which would make `vite --mode admin`
// (or `--mode vanguard`) serve the consumer app in dev.
//
//   node scripts/admin-entry.mjs                 -> dist-admin/index.html from admin.html
//   node scripts/admin-entry.mjs --app vanguard  -> dist-vanguard/index.html from vanguard.html
import fs from 'fs';
import path from 'path';

const i = process.argv.indexOf('--app');
const app = i >= 0 ? process.argv[i + 1] : 'admin';
const APPS = { admin: 'dist-admin', vanguard: 'dist-vanguard' };
if (!APPS[app]) {
  console.error(`[${app}-entry] unknown --app "${app}"`);
  process.exit(1);
}

const dir = path.resolve(process.cwd(), APPS[app]);
const src = path.join(dir, `${app}.html`);
if (!fs.existsSync(src)) {
  console.error(`[${app}-entry] ${APPS[app]}/${app}.html is missing: did \`vite build --mode ${app}\` run?`);
  process.exit(1);
}
fs.copyFileSync(src, path.join(dir, 'index.html'));
console.log(`[${app}-entry] ${APPS[app]}/index.html written from ${app}.html`);
