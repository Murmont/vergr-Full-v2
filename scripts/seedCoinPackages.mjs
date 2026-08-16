// Seed coin packages into Firestore.
// Usage: node scripts/seedCoinPackages.mjs
// Requires: GOOGLE_APPLICATION_CREDENTIALS env var or Firebase CLI login
//
// ⚠ WHAT THIS IS AND IS NOT
//
// `coin_packages` is a DISPLAY/CMS collection. NOTHING in the live buy path
// reads it: the ladder is compiled into `src/utils/vpSystem.js` (client) and
// mirrored in `functions/payram.js` (server, authoritative), and every price a
// buyer sees or is charged comes from `getCoinPriceQuote`.
//
// So this script cannot change what anyone is charged. It CAN mislead the next
// person who reads the collection, which is the only reason it is kept in sync
// rather than left stale.
//
// ⚠ THE LADDER IS NATIVE USD since 2026-08-11. Editing prices here changes
// nothing that matters. Edit vpSystem.js AND payram.js together, then rerun this.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore('vgrdb');

// Mirrors src/utils/vpSystem.js → COIN_PACKS exactly.
// Per-coin rate falls monotonically from $0.01269 (Starter) to $0.01163
// (Ascendant): a +9% bulk curve.
const PACKAGES = [
  { id: 'starter',   name: 'Starter Pack',   coins: 78,    priceUSD: 0.99,   vpBonus: 0,    sortOrder: 1, active: true, tagline: 'Get started for less than a coffee' },
  { id: 'gamer',     name: 'Gamer Pack',     coins: 400,   priceUSD: 4.99,   vpBonus: 0,    sortOrder: 2, active: true, tagline: 'Better value per coin than Starter' },
  { id: 'pro',       name: 'Pro Pack',       coins: 815,   priceUSD: 9.99,   vpBonus: 0,    sortOrder: 3, active: true, badgeStyle: 'popular', badge: 'MOST POPULAR', tagline: 'Enough to tip 16 creators' },
  { id: 'elite',     name: 'Elite Pack',     coins: 1650,  priceUSD: 19.99,  vpBonus: 0,    sortOrder: 4, active: true, badgeStyle: 'value',   badge: 'BEST VALUE',   tagline: 'Headroom for streaks and locked content' },
  { id: 'legend',    name: 'Legend Pack',    coins: 4180,  priceUSD: 49.99,  vpBonus: 0,    sortOrder: 5, active: true, tagline: 'For serious players and squads' },
  { id: 'champion',  name: 'Champion Pack',  coins: 8450,  priceUSD: 99.99,  vpBonus: 0,    sortOrder: 6, active: true, tagline: 'Deep bulk discount' },
  { id: 'titan',     name: 'Titan Pack',     coins: 12800, priceUSD: 149.99, vpBonus: 1500, sortOrder: 7, active: true, badgeStyle: 'vp',      badge: '+1,500 VP BONUS',  tagline: 'Skip ranks faster, earn more on every conversion' },
  { id: 'ascendant', name: 'Ascendant Pack', coins: 21500, priceUSD: 249.99, vpBonus: 3000, sortOrder: 8, active: true, badgeStyle: 'vp',      badge: 'BIGGEST VP BONUS', tagline: 'For top creators and squad leaders' },
];

async function seed() {
  // Guard the invariant rather than trusting the table above was typed right.
  // A pack that is worse value per coin than a smaller one inverts the bulk
  // curve, which is the one property of the ladder a buyer can check at a glance.
  let prev = Infinity;
  for (const p of PACKAGES) {
    const rate = p.priceUSD / p.coins;
    if (rate > prev) {
      console.error(`✗ ${p.name} is WORSE value per coin than the pack above it ` +
                    `($${rate.toFixed(5)} vs $${prev.toFixed(5)}). Refusing to seed.`);
      process.exit(1);
    }
    prev = rate;
  }

  console.log('Seeding coin packages (native USD)...');
  for (const pack of PACKAGES) {
    const { id, ...data } = pack;
    await db.collection('coin_packages').doc(id).set({
      ...data,
      // The old EUR field is explicitly cleared rather than left behind, so a
      // reader cannot pick up a stale price that has not been true since
      // 2026-08-11.
      priceEUR: null,
      createdAt: new Date(),
    });
    console.log(`  ✓ ${data.name} — ${data.coins} coins for $${data.priceUSD} ` +
                `($${(data.priceUSD / data.coins * 100).toFixed(2)}/100 coins)`);
  }
  console.log('Done. Remember: nothing in the buy path reads this collection.');
}

seed().catch((e) => { console.error(e); process.exit(1); });
