// Hosting predeploy guard. A deploy whose dist/ lacks the prerendered SEO
// pages (help articles + marketing heads from scripts/prerenderHelp.mjs)
// would wipe the site's entire indexable surface — every route would serve
// the SPA shell whose canonical points at the homepage, collapsing Google's
// index to 1 page (this happened; caught 2026-07-02). prerenderHelp runs as
// the npm `postbuild` hook, so it is skipped whenever `vite build` is invoked
// directly. This check makes `firebase deploy --only hosting` fail loudly
// instead of silently shipping a shell-only build.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const checks = [
  ['platform/help/index.html', 'help index'],
  ['platform/index.html', 'marketing /platform head'],
  ['sitemap.xml', 'sitemap'],
];
let bad = false;
for (const [rel, label] of checks) {
  if (!existsSync(join(DIST, rel))) { console.error(`checkPrerender: MISSING dist/${rel} (${label})`); bad = true; }
}
if (!bad) {
  const locs = (readFileSync(join(DIST, 'sitemap.xml'), 'utf8').match(/<loc>/g) || []).length;
  if (locs < 100) { console.error(`checkPrerender: sitemap.xml has only ${locs} URLs — prerender did not run.`); bad = true; }
  else console.log(`checkPrerender: OK (prerendered pages present, sitemap ${locs} URLs).`);
}
if (!bad) {
  // Body-content guard: titles/canonicals bake into <head> via a separate
  // code path, so they can be present while the visible article body is
  // silently dropped (happened 2026-07-05 → AdSense "low value content"
  // rejection: every prerendered page served zero readable text). Assert the
  // rendered pages actually carry an <h1> inside #root.
  for (const [rel, label] of [
    ['platform/help/index.html', 'help index'],
    ['platform/index.html', 'marketing /platform'],
  ]) {
    const h = readFileSync(join(DIST, rel), 'utf8');
    const root = h.slice(h.indexOf('<div id="root">'));
    if (!/<h1[ >]/.test(root)) {
      console.error(`checkPrerender: dist/${rel} (${label}) has NO <h1> in #root — prerendered body was dropped (injectBody no longer matches the shell).`);
      bad = true;
    }
  }
  if (!bad) console.log('checkPrerender: OK (prerendered bodies carry <h1> content).');
}
if (bad) {
  console.error('checkPrerender: run `npm run build` (its postbuild hook runs scripts/prerenderHelp.mjs), then deploy.');
  process.exit(1);
}
