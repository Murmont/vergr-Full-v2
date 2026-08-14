// Mobile bundle pruning. With the bundled shell, Tauri embeds the WHOLE dist/
// into the native lib. Web/desktop-only heavy assets must NOT ship inside the
// Android APK. This runs right after `vite build` for the Android target and
// removes payloads a phone never renders. Hosting deploys rebuild dist fresh,
// so vergr.app still serves all of these — they're only stripped from the mobile
// embed. Keep this conservative: only remove assets that are genuinely never
// shown on a phone, so nothing 404s in the bundled app.
import { rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');

// Whole directories that are pure web/desktop distribution or crawler assets.
const PRUNE_DIRS = [
  'downloads', // desktop installers (.exe/.msi) + the APK itself — ~160MB
  'og',        // OpenGraph share image/video — only fetched by link crawlers
];

// Desktop-only background variants (bg_*_Desktop.png) — a phone only ever uses
// the mobile variant, so the desktop ones are dead weight on device.
async function pruneDesktopBackgrounds() {
  const bgDir = join(dist, 'backgrounds', 'static');
  let files = [];
  try { files = await readdir(bgDir); } catch { return; }
  for (const f of files) {
    if (/_Desktop\.(png|jpe?g|webp|avif)$/i.test(f)) {
      await rm(join(bgDir, f), { force: true });
      console.log(`[prune-mobile-dist] removed backgrounds/static/${f}`);
    }
  }
}

for (const dir of PRUNE_DIRS) {
  await rm(join(dist, dir), { recursive: true, force: true });
  console.log(`[prune-mobile-dist] removed dist/${dir}`);
}
await pruneDesktopBackgrounds();
