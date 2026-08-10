// dailyMetricsRollup.js — nightly rollup that snapshots every metric the
// admin dashboard charts need into a single doc per day. Powers the
// Revenue Overview bar chart + User Growth line chart on /admin.
//
// Why a separate collection: live aggregation across users/, transactions/,
// subscriptions/ and platform_commissions/ every dashboard load is fine
// at our current scale BUT recomputing 30-90 days of charts every refresh
// burns reads. A pre-aggregated daily_metrics/{YYYY-MM-DD} doc is one read
// per day on the chart.
//
// Schema — `daily_metrics/{YYYY-MM-DD}`:
//   {
//     date: 'YYYY-MM-DD',
//     dayStartMs, dayEndMs,
//     signups: { total, free, lite, pro },
//     subscriptions: { newLite, newPro, cancellations },
//     tournaments: { created, totalPrizePoolCoins },
//     revenue: {
//       subscriptionEUR,        // newLite × 4.99 + newPro × 9.99
//       tipPlatformFeeCoins,    // sum of platformFee from platform_commissions
//       tournamentModCutCoins,  // sum of platform tournament transactions
//       totalPlatformCoins,     // tipPlatformFee + tournamentModCut
//     },
//     rolledUpAt, source: 'cron' | 'backfill'
//   }
//
// Rules — read public-but-admin-only via callable. No client write.
// Idempotent: re-rolling a day overwrites the existing doc.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { requireAdminScreen } = require('./adminAccess');
const { auditAdminAction } = require('./adminSecurity');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

const PRICE_EUR = { lite: 4.99, pro: 9.99 };

// Format a Date as YYYY-MM-DD in UTC.
function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

// Run the rollup for a single UTC calendar day.
// `targetDay` = Date at any time within the day; the helper snaps to UTC bounds.
async function rollupOneDay(targetDay, source = 'cron') {
  const dayStart = new Date(Date.UTC(
    targetDay.getUTCFullYear(), targetDay.getUTCMonth(), targetDay.getUTCDate(), 0, 0, 0, 0,
  ));
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();
  const key = dayKey(dayStart);

  // ── 1. Signups (users created within the window, grouped by tier) ──
  // Snapshot each user doc's `subscription` field as of NOW — at-creation
  // tier isn't stored. New users default to 'free' so this is accurate
  // for ~24h-old rows; older backfills may slightly over-attribute paid.
  const signupsSnap = await db.collection('users')
    .where('createdAt', '>=', dayStart)
    .where('createdAt', '<',  dayEnd)
    .limit(5000)
    .get()
    .catch(() => ({ docs: [] }));

  const signups = { total: 0, free: 0, lite: 0, pro: 0 };
  signupsSnap.docs.forEach(d => {
    signups.total += 1;
    const sub = d.data().subscription;
    if (sub === 'lite') signups.lite += 1;
    else if (sub === 'pro') signups.pro += 1;
    else signups.free += 1;
  });

  // ── 2. New subscriptions + cancellations ──
  const subSnap = await db.collection('subscriptions')
    .where('createdAt', '>=', dayStart)
    .where('createdAt', '<',  dayEnd)
    .limit(5000)
    .get()
    .catch(() => ({ docs: [] }));

  const subscriptions = { newLite: 0, newPro: 0, cancellations: 0 };
  subSnap.docs.forEach(d => {
    const data = d.data();
    if (data.method === 'cancellation') {
      subscriptions.cancellations += 1;
    } else if (data.tier === 'lite') {
      subscriptions.newLite += 1;
    } else if (data.tier === 'pro') {
      subscriptions.newPro += 1;
    }
  });

  // ── 3. Tournaments created + total prize pool ──
  const tournSnap = await db.collection('tournaments')
    .where('createdAt', '>=', dayStart)
    .where('createdAt', '<',  dayEnd)
    .limit(2000)
    .get()
    .catch(() => ({ docs: [] }));

  const tournaments = { created: 0, totalPrizePoolCoins: 0 };
  tournSnap.docs.forEach(d => {
    tournaments.created += 1;
    tournaments.totalPrizePoolCoins += Number(d.data().prizePool) || 0;
  });

  // ── 4. Tip platform fees ──
  const tipFeesSnap = await db.collection('platform_commissions')
    .where('createdAt', '>=', dayStart)
    .where('createdAt', '<',  dayEnd)
    .limit(5000)
    .get()
    .catch(() => ({ docs: [] }));

  let tipPlatformFeeCoins = 0;
  tipFeesSnap.docs.forEach(d => {
    const data = d.data();
    if (data.type === 'tip_platform_fee') tipPlatformFeeCoins += Number(data.platformFee) || 0;
  });

  // ── 5. Tournament mod-cut platform coins (transactions where userId='__platform__') ──
  // Indexed read on userId.
  const modCutSnap = await db.collection('transactions')
    .where('userId', '==', '__platform__')
    .where('createdAt', '>=', dayStart)
    .where('createdAt', '<',  dayEnd)
    .limit(5000)
    .get()
    .catch(() => ({ docs: [] }));

  let tournamentModCutCoins = 0;
  modCutSnap.docs.forEach(d => {
    const data = d.data();
    if (data.type === 'tournament_mod_cut') tournamentModCutCoins += Number(data.amount) || 0;
  });

  const subscriptionEUR =
    subscriptions.newLite * PRICE_EUR.lite +
    subscriptions.newPro  * PRICE_EUR.pro;
  const totalPlatformCoins = tipPlatformFeeCoins + tournamentModCutCoins;

  const data = {
    date: key,
    dayStartMs, dayEndMs,
    signups, subscriptions, tournaments,
    revenue: {
      subscriptionEUR,
      tipPlatformFeeCoins,
      tournamentModCutCoins,
      totalPlatformCoins,
    },
    source,
    rolledUpAt: FieldValue.serverTimestamp(),
  };

  await db.collection('daily_metrics').doc(key).set(data);
  return data;
}

// ════════════════════════════════════════════════════════════════════
// SCHEDULED CRON — runs daily at 02:30 UTC, rolls up the previous UTC day.
// (02:00 = price-change cron; 02:30 = rollup; well separated.)
// ════════════════════════════════════════════════════════════════════
const defer = (_opts, fn) => fn; // cron-consolidation shim (see index.js cronDaily)
exports.rollupDailyMetrics = defer(
  { schedule: 'every day 02:30', timeZone: 'UTC', region: REGION },
  async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
    try {
      const data = await rollupOneDay(yesterday, 'cron');
      console.log('[rollupDailyMetrics] wrote', data.date, JSON.stringify({
        signups: data.signups.total,
        newLite: data.subscriptions.newLite,
        newPro:  data.subscriptions.newPro,
        platformCoins: data.revenue.totalPlatformCoins,
      }));
    } catch (err) {
      console.error('[rollupDailyMetrics] failed:', err);
    }
    return null;
  }
);

// ════════════════════════════════════════════════════════════════════
// CALLABLE — admin reads N days of rollup for the dashboard charts.
// Cache 5 min in-memory.
// ════════════════════════════════════════════════════════════════════

let chartCache = { at: 0, key: null, data: null };

exports.adminGetDashboardCharts = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminScreen(uid, 'dashboard');

    const { days = 30 } = request.data || {};
    const safeDays = Math.min(90, Math.max(7, Number(days) || 30));
    const cacheKey = `d${safeDays}`;
    const now = Date.now();
    if (chartCache.key === cacheKey && (now - chartCache.at) < 5 * 60_000) {
      return { ...chartCache.data, cached: true };
    }

    // Build an array of YYYY-MM-DD keys for the last N days INCLUDING today
    // (today's row may not exist yet — chart renders it as null).
    const keys = [];
    for (let i = safeDays - 1; i >= 0; i--) {
      const d = new Date(now - i * 24 * 3600 * 1000);
      keys.push(dayKey(new Date(Date.UTC(
        d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0,
      ))));
    }

    const snaps = await Promise.all(keys.map(k => db.collection('daily_metrics').doc(k).get().catch(() => null)));
    const points = keys.map((k, i) => {
      const s = snaps[i];
      if (!s || !s.exists) {
        return {
          date: k,
          signups: { total: 0, free: 0, lite: 0, pro: 0 },
          subscriptions: { newLite: 0, newPro: 0, cancellations: 0 },
          revenue: { subscriptionEUR: 0, tipPlatformFeeCoins: 0, tournamentModCutCoins: 0, totalPlatformCoins: 0 },
          missing: true,
        };
      }
      const data = s.data();
      return {
        date: data.date || k,
        signups: data.signups || { total: 0, free: 0, lite: 0, pro: 0 },
        subscriptions: data.subscriptions || { newLite: 0, newPro: 0, cancellations: 0 },
        revenue: data.revenue || { subscriptionEUR: 0, tipPlatformFeeCoins: 0, tournamentModCutCoins: 0, totalPlatformCoins: 0 },
        missing: false,
      };
    });

    // Roll up totals across the window for the chart's header.
    const totals = points.reduce((acc, p) => {
      acc.signups += p.signups.total;
      acc.newLite += p.subscriptions.newLite;
      acc.newPro  += p.subscriptions.newPro;
      acc.subscriptionEUR     += p.revenue.subscriptionEUR;
      acc.tipPlatformFeeCoins += p.revenue.tipPlatformFeeCoins;
      acc.tournamentModCutCoins += p.revenue.tournamentModCutCoins;
      acc.totalPlatformCoins  += p.revenue.totalPlatformCoins;
      return acc;
    }, {
      signups: 0, newLite: 0, newPro: 0,
      subscriptionEUR: 0, tipPlatformFeeCoins: 0, tournamentModCutCoins: 0, totalPlatformCoins: 0,
    });

    const out = { points, totals, days: safeDays, asOf: now };
    chartCache = { at: now, key: cacheKey, data: out };
    return out;
  }
);

// ════════════════════════════════════════════════════════════════════
// BACKFILL CALLABLE — admin rebuilds the last N days from raw data.
// Useful: first deploy (cron hasn't run yet), or schema bugfix re-run.
// ════════════════════════════════════════════════════════════════════
exports.adminBackfillDailyMetrics = functions.https.onCall(
  { region: REGION, cors: true, timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminScreen(uid, 'dashboard');

    const { days = 30 } = request.data || {};
    const safeDays = Math.min(90, Math.max(1, Number(days) || 30));
    const now = new Date();
    const results = [];

    // Run sequentially (each day is ~5 reads). 90 days × ~150ms = ~13s — fine.
    for (let i = safeDays; i >= 1; i--) {
      const d = new Date(now.getTime() - i * 24 * 3600 * 1000);
      try {
        const data = await rollupOneDay(d, 'backfill');
        results.push({
          date: data.date,
          signups: data.signups.total,
          coins: data.revenue.totalPlatformCoins,
          eur: data.revenue.subscriptionEUR,
        });
      } catch (err) {
        results.push({ date: dayKey(d), error: err?.message || String(err) });
      }
    }

    // Invalidate chart cache so next dashboard refresh sees fresh data.
    chartCache = { at: 0, key: null, data: null };

    await auditAdminAction({
      actor: uid,
      action: 'admin_backfill_daily_metrics',
      target: { type: 'daily_metrics', id: `backfill_${safeDays}d` },
      after: { count: results.length, sample: results.slice(0, 3) },
    });

    return { ok: true, rolledUp: results.length, results };
  }
);

// Exported for tests + the backfill helper.
exports._internal_rollupOneDay = rollupOneDay;
