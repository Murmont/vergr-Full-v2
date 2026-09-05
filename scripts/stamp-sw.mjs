/**
 * Stamp the service worker's CACHE_NAME with the hash of the build it shipped with.
 *
 * ⚠⚠ WHY THIS EXISTS. `CACHE_NAME` was a hand-maintained literal (`vergr-v196`) bumped
 * only when someone remembered to run `scripts/bump-version.mjs`. It sat at v196 while the
 * app was at 1.0.205 — NINE releases without a bump — and `activate` only deletes caches
 * whose key differs from CACHE_NAME, so NOTHING was evicted across all of them.
 *
 * The failure that produces, observed repeatedly on 2026-09-04:
 *
 *   1. a deploy replaces every content-hashed chunk and DELETES the old ones
 *   2. a navigation fetch throws — a connection reset moments after a deploy is exactly
 *      when it does — so the SW falls back to `cacheOrOffline(req, { shell: true })`
 *   3. that serves the CACHED `/index.html`, which references the OLD chunk hashes
 *   4. those chunks are 404 now, the dynamic import fails, and a failed module load is
 *      NOT a React error, so there is no ErrorBoundary: the app hangs on the splash
 *
 * The user's escape is a hard refresh they have no reason to know about. Three times in
 * one session it took unregistering the worker by hand.
 *
 * ⚠ VERSION ALONE IS NOT ENOUGH as the cache key: a release ships many builds at the same
 * APP_VERSION (fifteen in one night here), and each one rewrites the chunk hashes. The key
 * is therefore the ENTRY CHUNK HASH, which changes exactly when the output changes: a
 * rebuild with identical output keeps the cache, a rebuild with changed code busts it.
 *
 * Runs in `postbuild` against `dist/`, so `public/sw.js` stays readable in source.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SW = 'dist/sw.js';
const INDEX = 'dist/index.html';

if (!existsSync(SW) || !existsSync(INDEX)) {
  console.error('stamp-sw: dist/sw.js or dist/index.html missing — did vite build run?');
  process.exit(1);
}

const html = readFileSync(INDEX, 'utf8');
// the entry chunk vite injects, e.g. /assets/index-CxGK5QY4.js
const m = html.match(/\/assets\/index-([A-Za-z0-9_-]+)\.js/);
if (!m) {
  console.error('stamp-sw: no /assets/index-<hash>.js in dist/index.html — cannot key the cache to this build');
  process.exit(1);
}
const hash = m[1];

let sw = readFileSync(SW, 'utf8');
const before = sw.match(/const CACHE_NAME = '([^']+)'/);
if (!before) {
  console.error('stamp-sw: CACHE_NAME literal not found in dist/sw.js');
  process.exit(1);
}
const next = `vergr-${hash}`;
sw = sw.replace(/const CACHE_NAME = '[^']+'/, `const CACHE_NAME = '${next}'`);

// ⚠ A STALE SHELL MUST NOT SURVIVE THE BUILD THAT MADE IT. Belt and braces alongside the
// cache key: when the shell is served from cache as a fallback, the entry it points at may
// no longer exist. Record the hash the shell was built with so the SW can tell.
sw = sw.replace(/const CACHE_NAME = '[^']+';/, (line) => `${line}\nconst BUILD_ENTRY = '${hash}';`);

writeFileSync(SW, sw);
console.log(`stamp-sw: CACHE_NAME ${before[1]} -> ${next}`);
