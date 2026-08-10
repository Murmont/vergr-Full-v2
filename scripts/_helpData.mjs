// Shared loader: bundle the help-center data module (helpContent.jsx + its
// per-article .jsx files) into one ESM blob with esbuild (a Vite dependency,
// no new install) and import it in Node. The article files are pure data
// (export default {...}) and helpContent.jsx has no React imports, so the
// bundle is plain JS. Used by the verify, prerender, and sitemap scripts.
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..');
const ENTRY = join(REPO, 'src', 'screens', 'marketing', 'help', 'helpContent.jsx');

export async function loadHelp() {
  const res = await build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    loader: { '.jsx': 'jsx' },
    jsx: 'transform',
    logLevel: 'silent',
  });
  const code = res.outputFiles[0].text;
  const tmp = join(here, `_help_bundle_${process.pid}.mjs`);
  writeFileSync(tmp, code, 'utf8');
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    rmSync(tmp, { force: true });
  }
}
