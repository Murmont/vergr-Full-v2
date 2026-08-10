#!/usr/bin/env node
// One-time backfill: give existing news/article posts a readable SEO `slug`
// so their sitemap + share URLs become /post/<title-slug>-<hash> instead of
// /post/news-pcgamer-<hash>. New posts get a slug at ingest (functions/index.js
// newsSlug()); this catches everything created before that shipped.
//
// Safe to re-run (idempotent — skips posts that already have a slug). Reads the
// existing hash straight off the doc id (`<botId>-<hash>`), so the slug's
// uniqueness suffix matches what newsSlug() would have produced.
//
// Run AFTER deploying the functions, against prod:
//   node scripts/backfill-news-slugs.mjs           (dry run, prints a sample)
//   node scripts/backfill-news-slugs.mjs --write    (actually writes)
//
// Requires the admin key at the documented path + the named DB `vgrdb`.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// firebase-admin lives in functions/node_modules (not the repo root).
const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(__dirname, '..', 'functions', 'package.json'));
const admin = require('firebase-admin');

const KEY = 'C:/Users/damie/Downloads/vergr-44494-firebase-adminsdk-fbsvc-a8600cfe54.json';
const WRITE = process.argv.includes('--write');

function newsSlug(title, hash) {
  const base = String(title || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base ? `${base}-${hash}` : `post-${hash}`;
}

admin.initializeApp({ credential: admin.credential.cert(require(KEY)) });
const db = admin.firestore();
db.settings({ databaseId: 'vgrdb' });

const snap = await db.collection('posts').where('isNewsPost', '==', true).get();
let updated = 0, skipped = 0;
const batchSize = 400;
let batch = db.batch(), inBatch = 0;
const samples = [];

for (const d of snap.docs) {
  const p = d.data();
  if (p.slug) { skipped++; continue; }
  const hash = d.id.slice(d.id.lastIndexOf('-') + 1) || 'x';
  const slug = newsSlug(p.content || p.previewText || '', hash);
  if (samples.length < 8) samples.push(`${d.id}  ->  /post/${slug}`);
  if (WRITE) {
    batch.update(d.ref, { slug });
    if (++inBatch >= batchSize) { await batch.commit(); batch = db.batch(); inBatch = 0; }
  }
  updated++;
}
if (WRITE && inBatch) await batch.commit();

console.log(`news posts: ${snap.size}, already-slugged: ${skipped}, ${WRITE ? 'updated' : 'would update'}: ${updated}`);
console.log('sample:\n' + samples.join('\n'));
if (!WRITE) console.log('\nDry run. Re-run with --write to apply.');
process.exit(0);
