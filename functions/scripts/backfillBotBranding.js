// One-off backfill (2026-06-10):
//   1. Bot branding — every news_bot / shorts_bot account gets a favicon
//      avatar + its newest post image as profile banner (mirrors the
//      healBotBranding self-heal that now runs in the daily sync cron).
//   2. Follower-count audit — recomputes users.followerCount from the
//      `follows` collection (source of truth) and fixes any drift.
//
// Run from functions/:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/key.json node scripts/backfillBotBranding.js [--apply]
// Without --apply it's a dry run (prints what it would change).

const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
if (admin.apps.length === 0) admin.initializeApp();
// NOTE: admin.firestore(undefined, 'vgrdb') silently returns the DEFAULT
// (empty) database — getFirestore('vgrdb') is the correct named-DB accessor.
const db = getFirestore('vgrdb');

const APPLY = process.argv.includes('--apply');

const SHORTS_BOT_BRAND_SITE = {
  'yt-ign': 'https://www.ign.com',
  'yt-gamespot': 'https://www.gamespot.com',
  'yt-nintendo': 'https://www.nintendo.com',
  'yt-playstation': 'https://www.playstation.com',
  'yt-xbox': 'https://www.xbox.com',
  'yt-riotgames': 'https://www.riotgames.com',
};

function botFavicon(siteUrl) {
  try { return `https://www.google.com/s2/favicons?sz=128&domain=${new URL(siteUrl).hostname}`; }
  catch { return null; }
}

async function newestPostImage(uid) {
  const snap = await db.collection('posts')
    .where('authorId', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(8).get();
  for (const d of snap.docs) {
    const p = d.data();
    const img = p.linkPreview?.image || p.thumbnailUrl || (p.mediaUrls || [])[0];
    if (img && /^https:\/\//.test(img)) return img;
  }
  return null;
}

(async () => {
  // ── 1. Bot branding ────────────────────────────────────────────────
  for (const type of ['news_bot', 'shorts_bot']) {
    const bots = await db.collection('users').where('accountType', '==', type).get();
    for (const d of bots.docs) {
      const u = d.data();
      const updates = {};
      if (!u.avatar) {
        const site = SHORTS_BOT_BRAND_SITE[d.id] || u.website;
        const fav = site ? botFavicon(site) : null;
        if (fav) updates.avatar = fav;
      }
      if (!u.banner) {
        const img = await newestPostImage(d.id).catch((e) => {
          console.warn(`  post query failed for ${d.id}: ${e.message}`);
          return null;
        });
        if (img) updates.banner = img;
      }
      if (Object.keys(updates).length > 0) {
        console.log(`${APPLY ? 'FIX' : 'DRY'} ${type} ${d.id} (${u.username}): ${Object.keys(updates).join(', ')}`);
        if (APPLY) await d.ref.update({ ...updates, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      }
    }
  }

  // ── 2. Follower-count audit ────────────────────────────────────────
  const follows = await db.collection('follows').get();
  const actual = {};
  for (const f of follows.docs) {
    const t = f.data().followingId;
    if (t) actual[t] = (actual[t] || 0) + 1;
  }
  console.log(`follows collection: ${follows.size} docs across ${Object.keys(actual).length} followed users`);

  const users = await db.collection('users').get();
  let drift = 0;
  for (const d of users.docs) {
    const stored = d.data().followerCount;
    const real = actual[d.id] || 0;
    if ((stored ?? 0) !== real) {
      drift++;
      console.log(`${APPLY ? 'FIX' : 'DRY'} followerCount ${d.id} (${d.data().username || '?'}): stored=${stored ?? 'missing'} actual=${real}`);
      if (APPLY) await d.ref.update({ followerCount: real });
    }
  }
  console.log(`Done. ${drift} user(s) had follower-count drift.${APPLY ? '' : ' (dry run — rerun with --apply)'}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
