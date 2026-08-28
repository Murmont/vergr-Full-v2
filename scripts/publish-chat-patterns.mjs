// Uploads the chat-theme pattern tiles to Cloudflare R2, behind cdn.vergr.app.
//
//   node scripts/build-chat-patterns.mjs     # generate
//   node scripts/publish-chat-patterns.mjs   # then publish
//
// ⚠ WHY R2 AND NOT FIREBASE HOSTING. Founder, 2026-08-25: hosting egress is
// billed, R2 egress is $0. A tile is ~300KB and exactly one is fetched per
// themed conversation, so on Hosting a few thousand chat opens would eat the
// daily transfer allowance by themselves. `firebase.json` lists
// `chat-patterns/**` under hosting `ignore`, so the files are in the repo and
// in dist/ but are never uploaded to Hosting. Same reasoning as the desktop
// installer and the sideload APK (publish-apk.mjs, make-update-manifest.mjs).
//
// ⚠ THE TILES ARE A MASK, NOT AN IMAGE THE USER SEES. Cross-origin is fine and
// needs no CORS header, because CSS mask-image never exposes pixels to script.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

// The AWS SDK lives in functions/node_modules, not the root one. Resolved the
// same way publish-apk.mjs does it, so both R2 publishers share one install.
const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'functions', 'package.json'));
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = `${repo}/chat-pattern-tiles`;

// Read the theme ids from the source of truth rather than a second list here.
const themes = readFileSync(`${repo}/src/utils/chatThemes.js`, 'utf8')
  .split(/\r?\n/)
  .map((l) => /pattern:\s*'([a-z0-9_-]+)'/.exec(l))
  .filter(Boolean)
  .map((m) => m[1]);

if (!themes.length) {
  console.error('No themes found in src/utils/chatThemes.js');
  process.exit(1);
}

const missing = themes.filter((t) => !existsSync(`${SRC}/${t}.png`));
if (missing.length) {
  console.error(`Missing tiles: ${missing.join(', ')}`);
  console.error('Run: node scripts/build-chat-patterns.mjs');
  process.exit(1);
}

const sec = (name) => execFileSync('firebase', ['functions:secrets:access', name], { encoding: 'utf8', shell: true }).trim();
const accountId = sec('R2_ACCOUNT_ID');
const Bucket = sec('R2_BUCKET');
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: sec('R2_ACCESS_KEY_ID'), secretAccessKey: sec('R2_SECRET_ACCESS_KEY') },
});

let uploaded = 0;
for (const t of themes) {
  const Key = `chat-patterns/${t}.png`;
  const Body = readFileSync(`${SRC}/${t}.png`);
  const sha = createHash('sha256').update(Body).digest('hex').slice(0, 12);

  await s3.send(new PutObjectCommand({
    Bucket,
    Key,
    Body,
    ContentType: 'image/png',
    // A tile only changes when someone deliberately regenerates it, so it is
    // safe to cache hard. This replaces the firebase.json header entry that
    // used to do the same job while the files were on Hosting.
    CacheControl: 'public, max-age=604800, s-maxage=2592000, immutable',
  }));

  // ⚠ VERIFY FROM THE STORED OBJECT, not from the fact that PUT returned 200.
  const head = await s3.send(new HeadObjectCommand({ Bucket, Key }));
  if (head.ContentLength !== Body.length) {
    console.error(`SIZE MISMATCH on ${Key}: sent ${Body.length}, stored ${head.ContentLength}`);
    process.exit(1);
  }
  console.log(`  ${t.padEnd(9)} ${(Body.length / 1024).toFixed(0).padStart(4)}KB  sha ${sha}  -> ${Key}`);
  uploaded++;
}

console.log(`\nPublished ${uploaded} tiles to ${Bucket}/chat-patterns/`);
console.log('Verify: curl -sI https://cdn.vergr.app/chat-patterns/arcade.png');
