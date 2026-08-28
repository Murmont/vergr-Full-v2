// adminDashboard.js — Admin → Dashboard landing page bundler.
//
// One callable that fetches every metric the dashboard needs in a single
// round-trip. Cached 30s in-memory to soften reload spam.

const functions = require('firebase-functions/v2');
const { getFirestore, AggregateField } = require('firebase-admin/firestore');
const { requireAdminScreen } = require('./adminAccess');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';

const PRICE_EUR = { lite: 4.99, pro: 9.99 };
const safeAgg = async (q, fields) => {
  try { const r = await q.aggregate(fields).get(); return r.data(); }
  catch { return null; }
};
const toMs = (t) => t && typeof t.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : null);

let cache = { at: 0, data: null };

exports.adminGetDashboardSummary = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminScreen(uid, 'dashboard');

    const now = Date.now();
    if (cache.data && (now - cache.at) < 30_000) return { ...cache.data, cached: true };

    const users = db.collection('users');
    const reports = db.collection('reports');
    const streams = db.collection('streams');
    const weekAgo = now - 7 * 24 * 3600 * 1000;
    const monthAgo = now - 30 * 24 * 3600 * 1000;

    const [
      totalUsers, activeWeek, liteCount, proCount,
      liveStreams,
      pendingReports, actionedToday,
      owedAgg, creatorsOwed,
      recentActions, recentUsers, topGamesSnap,
      guestCount, newsBotCount, shortsBotCount,
    ] = await Promise.all([
      users.count().get().then(r => r.data().count).catch(() => 0),
      // `lastSeen` is a Firestore Timestamp and `weekAgo` was a raw number of
      // millis. Firestore compares across types by type order, never by value, so
      // this filter matched NOTHING and "Active (7d)" read 0 no matter what.
      users.where('lastSeen', '>=', new Date(weekAgo)).count().get().then(r => r.data().count).catch(() => 0),
      users.where('subscription', '==', 'lite').count().get().then(r => r.data().count).catch(() => 0),
      users.where('subscription', '==', 'pro').count().get().then(r => r.data().count).catch(() => 0),
      streams.where('status', '==', 'live').count().get().then(r => r.data().count).catch(() => 0),
      reports.where('status', '==', 'pending').count().get().then(r => r.data().count).catch(() => 0),
      reports.where('actionedAt', '>=', new Date(now - 24 * 3600 * 1000))
        .count().get().then(r => r.data().count).catch(() => 0),
      // What Vergr owes its creators. This is a LIABILITY, not a balance they can
      // call on, and it is the number that replaced the tournaments count.
      db.collection('wallets').aggregate({ total: AggregateField.sum('owedMicroUsd') })
        .get().then(r => r.data().total || 0).catch(() => 0),
      db.collection('wallets').where('owedMicroUsd', '>', 0).count().get()
        .then(r => r.data().count).catch(() => 0),
      db.collection('admin_actions').orderBy('createdAt', 'desc').limit(8).get().catch(() => ({ docs: [] })),
      users.orderBy('createdAt', 'desc').limit(5).get().catch(() => ({ docs: [] })),
      // Top games — group by `game` field on streams currently live.
      streams.where('status', '==', 'live').limit(50).get().catch(() => ({ docs: [] })),
      // Netted out of totalUsers so this agrees with the Users screen instead of
      // quietly reporting a bigger number on the landing page of the same app.
      users.where('isGuest', '==', true).count().get().then(r => r.data().count).catch(() => 0),
      users.where('accountType', '==', 'news_bot').count().get().then(r => r.data().count).catch(() => 0),
      users.where('accountType', '==', 'shorts_bot').count().get().then(r => r.data().count).catch(() => 0),
    ]);

    const mrrEUR = liteCount * PRICE_EUR.lite + proCount * PRICE_EUR.pro;

    // Top games aggregation (in-memory, capped at 50 live streams)
    const gameCounts = {};
    topGamesSnap.docs.forEach(d => {
      const g = d.data().game || 'Unknown';
      gameCounts[g] = (gameCounts[g] || 0) + 1;
    });
    const topGames = Object.entries(gameCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([game, streams]) => ({ game, streams }));

    const activity = recentActions.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        actorName: data.actor?.displayName || data.actor?.uid?.slice(0, 8) || '—',
        action: data.action || 'unknown',
        target: data.target?.id || null,
        targetType: data.target?.type || null,
        createdAt: toMs(data.createdAt),
      };
    });

    const newUsers = recentUsers.docs.map(d => ({
      id: d.id,
      displayName: d.data().displayName || d.data().username || d.id.slice(0, 8),
      avatar: d.data().avatar || null,
      createdAt: toMs(d.data().createdAt),
    }));

    const data = {
      totalUsers: Math.max(0, totalUsers - guestCount - newsBotCount - shortsBotCount),
      totalUsersRaw: totalUsers,
      guestCount,
      activeWeek,
      paidSubscriptions: liteCount + proCount,
      liteCount, proCount,
      liveStreams,
      mrrEUR,
      pendingReports,
      actionedToday,
      owedMicroUsd: owedAgg,
      creatorsOwed,
      topGames,
      activity,
      newUsers,
      asOf: now,
    };
    cache = { at: now, data };
    return data;
  }
);
