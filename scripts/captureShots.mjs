// Capture REAL app screenshots for the marketing landing hero.
//
// Drives the production-data preview (vite preview on :4173) with
// puppeteer-core + the installed system Chrome: becomes a guest via the
// public post screen's "Browse as guest" button, then captures the live
// app at desktop and phone viewports. Output: PNGs in scripts/.shots/
// (convert + place into public/brand/shots/ afterwards).
//
// Usage: npm run preview (separate terminal) then:
//   node scripts/captureShots.mjs
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '.shots');
mkdirSync(OUT, { recursive: true });

const BASE = process.env.SHOT_BASE || 'http://localhost:4173';
const POST_ID = process.env.SHOT_POST || '3DpU9EbL1sMA9QVfEipK';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Remove chrome that shouldn't appear in marketing shots (guest upsell bar,
// install banner).
async function tidy(page) {
  await page.evaluate(() => {
    const kill = (needle) => {
      // Pick the SMALLEST div containing the needle (querySelectorAll is
      // document order = parents first; a naive first-match removes the
      // whole app shell). Shortest textContent = the actual banner.
      let best = null;
      for (const el of document.querySelectorAll('div')) {
        if (el.textContent && el.textContent.includes(needle)) {
          if (!best || el.textContent.length < best.textContent.length) best = el;
        }
      }
      if (best) best.remove();
    };
    kill('browsing as a guest');
    kill('Get the VERGR app');
    kill('Daily Check-in');
  }).catch(() => {});
  // Privacy-choices modal (first-session): accept defaults to clear it.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Save my choices'));
    if (btn) btn.click();
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 600));
}

async function waitAppRendered(page, timeout = 30000) {
  await page.waitForFunction(
    () => document.body && document.body.innerText.replace(/\s+/g, ' ').length > 250,
    { timeout },
  ).catch(() => console.warn('  (app render wait timed out)'));
}

async function shoot(page, path, name, settle = 5000) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await waitAppRendered(page);
  await sleep(settle); // images/avatars/feeds
  await tidy(page);
  await sleep(400);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log('shot:', name);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars', '--mute-audio'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  // 1. Become a guest via the public post screen ("Browse as guest").
  await page.goto(`${BASE}/post/${POST_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Browse as guest')),
    { timeout: 45000 },
  );
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Browse as guest')).click();
  });
  // Guest auth flips ProtectedRoute to the full app; the upsell bar is the signal.
  await page.waitForFunction(
    () => document.body.innerText.includes('browsing as a guest'),
    { timeout: 45000 },
  );
  console.log('guest session active');

  // 2. Desktop shots.
  for (const [path, name] of [
    ['/', 'desktop-feed'],
    ['/explore', 'desktop-explore'],
    ['/tournaments', 'desktop-tournaments'],
    ['/leaderboard', 'desktop-leaderboard'],
  ]) {
    await shoot(page, path, name, 6000);
  }

  // 3. Phone shots (same session, phone viewport).
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  for (const [path, name] of [
    ['/', 'phone-feed'],
    ['/explore', 'phone-explore'],
    ['/tournaments', 'phone-tournaments'],
    ['/shorts', 'phone-shorts'],
    ['/leaderboard', 'phone-leaderboard'],
  ]) {
    await shoot(page, path, name, 6000);
  }

  await browser.close();
  console.log('done →', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
