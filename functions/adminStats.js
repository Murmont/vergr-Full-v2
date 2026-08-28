// adminStats.js — Admin → Live Stats screen callables.
//
// "Live" here means "what's currently happening" — not real-time websockets.
// The dashboard polls these callables on a 10s/30s rotation. Each callable
// is best-effort: aggregations may fail on empty/missing fields and we
// return zeros rather than throw, so the screen always renders.
//
// Callables:
//   adminGetLiveStatsOverview   — KPI tiles + 24h active-user chart points
//   adminGetSystemMetrics       — Hetzner/R2/Pion SFU/Firestore counters
//                                 (currently placeholders — real wiring P1)
//   adminGetGeographyStats      — country + region breakdown from user docs
//   adminGetActivityFeed        — most-recent app_events docs (live tail)

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue, AggregateField } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const axios = require('axios');
const { requireAdminScreen } = require('./adminAccess');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';

const HETZNER_API_TOKEN = defineSecret('HETZNER_API_TOKEN');
const VERGR_SYSINFO_TOKEN = defineSecret('VERGR_SYSINFO_TOKEN');
const SFU_HEALTH_URL = 'https://sfu.vergr.app/healthz';
const SYSINFO_URL = 'https://sfu.vergr.app/sysinfo';

// 30s in-memory cache for system metrics (the polling cron + admin reload
// both hit this; cache softens redundant API calls).
let systemCache = { at: 0, data: null };

const safeCount = (q) => q.count().get().then(r => r.data().count).catch(() => 0);
const toMs = (t) => t && typeof t.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : null);

let overviewCache = { at: 0, data: null };
let geoCache = { at: 0, data: null };

async function guardCaller(uid) { return await requireAdminScreen(uid, 'stats'); }

// ════════════════════════════════════════════════════════════════════
// OVERVIEW
// ════════════════════════════════════════════════════════════════════

exports.adminGetLiveStatsOverview = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const now = Date.now();
    if (overviewCache.data && (now - overviewCache.at) < 10_000) {
      return { ...overviewCache.data, cached: true };
    }

    const users = db.collection('users');
    const dayAgo  = now -      24 * 3600 * 1000;
    const weekAgo = now -  7 * 24 * 3600 * 1000;
    const monthAgo= now - 30 * 24 * 3600 * 1000;

    const [activeNow, totalUsers, newToday, liveStreams, weeklyActive, monthlyActive] = await Promise.all([
      safeCount(users.where('lastSeen', '>=', now - 5 * 60 * 1000)),     // active in last 5 min
      safeCount(users),
      safeCount(users.where('createdAt', '>=', dayAgo)),
      safeCount(db.collection('streams').where('status', '==', 'live')),
      safeCount(users.where('lastSeen', '>=', weekAgo)),
      safeCount(users.where('lastSeen', '>=', monthAgo)),
    ]);

    // 24h active-user chart — fetch presence_snapshots/ if it exists; if not,
    // synthesize a flat line at the current activeNow value.
    let chart = [];
    try {
      const snap = await db.collection('presence_snapshots')
        .where('at', '>=', dayAgo)
        .orderBy('at', 'asc')
        .limit(48)
        .get();
      chart = snap.docs.map(d => {
        const data = d.data();
        return { at: toMs(data.at), active: data.activeCount ?? data.active ?? 0 };
      });
    } catch { /* collection probably doesn't exist yet — leave empty */ }

    // Best-effort device breakdown — checks users.lastSeenDevice if set.
    let deviceCounts = { web: 0, ios: 0, android: 0, other: 0 };
    try {
      const r = await Promise.all([
        safeCount(users.where('lastSeen', '>=', now - 5 * 60 * 1000).where('lastSeenDevice', '==', 'web')),
        safeCount(users.where('lastSeen', '>=', now - 5 * 60 * 1000).where('lastSeenDevice', '==', 'ios')),
        safeCount(users.where('lastSeen', '>=', now - 5 * 60 * 1000).where('lastSeenDevice', '==', 'android')),
      ]);
      deviceCounts = { web: r[0], ios: r[1], android: r[2], other: Math.max(0, activeNow - r[0] - r[1] - r[2]) };
    } catch {}

    const data = {
      activeNow,
      totalUsers,
      newToday,
      liveStreams,
      weeklyActive,
      monthlyActive,
      chart,
      deviceCounts,
      asOf: now,
    };
    overviewCache = { at: now, data };
    return data;
  }
);

// ════════════════════════════════════════════════════════════════════
// EVENT LOAD — committed concurrent-viewer load from ticketed events.
//
// The `tournaments` COLLECTION is where ticketed events live: events are not
// tournaments (no competitors, no prize purse) but they reused the collection.
// So this query is live and must not be swept up with the tournament removal.
//
// Sum of ticket capacity (committed) + sold across open/active ticketed
// events, so the founder can see how much concurrent stream load is
// promised and when to add a box. `streamServerCapacity` (app_config) sets
// the headroom baseline; absent = headroom unknown.
// ════════════════════════════════════════════════════════════════════
exports.adminGetEventLoad = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    await guardCaller(request.auth?.uid);
    const now = Date.now();
    const snap = await db.collection('tournaments')
      .where('fundingModel', '==', 'ticketed')
      .limit(500).get();

    const events = [];
    let capacityCommitted = 0;
    let ticketsSold = 0;
    for (const d of snap.docs) {
      const t = d.data();
      if (!['open', 'active'].includes(t.status)) continue;
      const capacity = Math.floor(t.ticket?.capacity || 0);
      const sold = Math.floor(t.ticket?.sold || 0);
      capacityCommitted += capacity;
      ticketsSold += sold;
      events.push({
        id: d.id,
        name: t.name || 'Event',
        status: t.status,
        game: t.game || null,
        scheduledStart: toMs(t.scheduledStart),
        sold,
        capacity,
        utilization: capacity > 0 ? Math.round((sold / capacity) * 100) : 0,
      });
    }
    events.sort((a, b) => b.capacity - a.capacity);

    let serverCapacity = 0;
    try {
      const cfg = await db.collection('app_config').doc('general').get();
      serverCapacity = Math.floor(cfg.data()?.streamServerCapacity || 0);
    } catch { /* config optional */ }

    return {
      ticketsSold,
      capacityCommitted,
      commitmentUtilization: capacityCommitted > 0 ? Math.round((ticketsSold / capacityCommitted) * 100) : 0,
      eventCount: events.length,
      largest: events.slice(0, 20),
      serverCapacity,
      headroom: serverCapacity > 0 ? Math.max(0, serverCapacity - capacityCommitted) : null,
      asOf: now,
    };
  },
);

// ════════════════════════════════════════════════════════════════════
// SYSTEM METRICS — placeholders until Hetzner / R2 / Pion wiring lands.
// Anything we CAN reasonably measure from inside the function (Firestore
// counts) is real; the rest are honest-zero with `source: 'unwired'`.
// ════════════════════════════════════════════════════════════════════

// SFU healthcheck — hits https://sfu.vergr.app/healthz which returns
// { peers, rooms, status } per CLAUDE.md "vergr-sfu" section.
async function fetchSfuHealth() {
  try {
    const r = await axios.get(SFU_HEALTH_URL, { timeout: 5000 });
    if (r.status === 200 && r.data) {
      return {
        rooms: r.data.rooms ?? null,
        peers: r.data.peers ?? null,
        status: r.data.status === 'ok' ? 'healthy' : 'degraded',
      };
    }
  } catch (e) {
    return { rooms: null, peers: null, status: 'down', error: e?.message?.slice(0, 80) };
  }
  return { rooms: null, peers: null, status: 'down' };
}

// Hetzner Cloud API — fetches server metrics for the streaming box. Gated on
// HETZNER_API_TOKEN being set; returns 'unwired' when the secret is absent
// so callers always get a usable object. Pulls CPU, network, and disk IOPS
// from /v1/servers/{id}/metrics.
async function fetchHetznerStats() {
  let token;
  try { token = HETZNER_API_TOKEN.value(); } catch { token = null; }
  if (!token || token === 'placeholder') {
    return { cpuPct: null, status: 'unwired' };
  }
  try {
    // List servers — there's only one (vergr-stream-1) but the API requires it.
    const listResp = await axios.get('https://api.hetzner.cloud/v1/servers', {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 8000,
    });
    const server = (listResp.data?.servers || []).find(s => s.name === 'vergr-stream-1')
                || listResp.data?.servers?.[0];
    if (!server) return { cpuPct: null, status: 'unwired', error: 'no-server' };

    // Fetch CPU / network / disk metrics over the last 5 minutes.
    const endIso = new Date().toISOString();
    const startIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const metricsResp = await axios.get(
      `https://api.hetzner.cloud/v1/servers/${server.id}/metrics`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { type: 'cpu,disk,network', start: startIso, end: endIso },
        timeout: 8000,
      }
    ).catch(() => null);

    const ts = metricsResp?.data?.metrics?.time_series || {};
    const lastValue = (series) => {
      const vals = series?.values;
      if (!Array.isArray(vals) || vals.length === 0) return null;
      return Number(vals[vals.length - 1][1]);
    };

    return {
      cpuPct:     lastValue(ts['cpu']),
      // Network counters are bytes/sec averaged over the bucket window.
      networkInBps:  lastValue(ts['network.0.bandwidth.in']),
      networkOutBps: lastValue(ts['network.0.bandwidth.out']),
      diskReadIops:  lastValue(ts['disk.0.iops.read']),
      diskWriteIops: lastValue(ts['disk.0.iops.write']),
      // Server metadata (cheap nice-to-haves):
      serverType:    server.server_type?.name || null,
      cores:         server.server_type?.cores ?? null,
      memoryGb:      server.server_type?.memory ?? null,
      diskGb:        server.server_type?.disk ?? null,
      serverStatus:  server.status,
      datacenter:    server.datacenter?.location?.name || null,
      // Monthly outgoing-bandwidth usage vs. the free 20 TB allowance.
      includedTrafficBytes: server.included_traffic ?? null,
      outgoingTrafficBytes: server.outgoing_traffic ?? null,
      status: 'healthy',
    };
  } catch (e) {
    return { cpuPct: null, status: 'down', error: e?.message?.slice(0, 80) };
  }
}

// Memory / disk / load — fetched from the in-box vergr-sysinfo agent.
// Returns 'unwired' if the secret isn't set yet, 'down' if the agent is
// unreachable (e.g. service stopped or nginx misconfigured).
async function fetchHostSysinfo() {
  let token;
  try { token = VERGR_SYSINFO_TOKEN.value(); } catch { token = null; }
  if (!token || token === 'placeholder') {
    return { status: 'unwired' };
  }
  try {
    const r = await axios.get(SYSINFO_URL, {
      headers: { 'X-Vergr-Sysinfo-Token': token },
      timeout: 5000,
    });
    if (r.status !== 200 || !r.data) return { status: 'down' };
    return { ...r.data, status: 'healthy' };
  } catch (e) {
    return { status: 'down', error: e?.message?.slice(0, 80) };
  }
}

// Firebase / Firestore usage — counts across major collections. Cheap.
async function fetchFirebaseUsage() {
  const c = (name) => safeCount(db.collection(name));
  const [
    users, posts, tournaments, streams, transactions, reports,
    announcements, subscriptions, adminActions, notifications,
  ] = await Promise.all([
    c('users'), c('posts'), c('tournaments'), c('streams'), c('transactions'),
    c('reports'), c('announcements'), c('subscriptions'), c('admin_actions'),
    c('notifications'),
  ]);
  return {
    users, posts, tournaments, streams, transactions, reports,
    announcements, subscriptions, adminActions, notifications,
    status: 'healthy',
  };
}

exports.adminGetSystemMetrics = functions.https.onCall(
  { region: REGION, cors: true, secrets: [HETZNER_API_TOKEN, VERGR_SYSINFO_TOKEN] },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const now = Date.now();
    if (systemCache.data && (now - systemCache.at) < 30_000) {
      return { ...systemCache.data, cached: true };
    }

    const [errCount, sfu, hetzner, sysinfo, firebase] = await Promise.all([
      // client_errors = the real intake (clientTelemetry.js); error_log was a
      // dead collection name that never had a writer.
      safeCount(db.collection('client_errors')),
      fetchSfuHealth(),
      fetchHetznerStats(),
      fetchHostSysinfo(),
      fetchFirebaseUsage(),
    ]);

    const data = {
      hetzner,
      sysinfo,     // memory/disk/load from the in-box agent
      // Storage / CDN — Cloudflare API integration not yet wired.
      r2:  { storageGb: null, classAOps: null, classBOps: null, status: 'unwired' },
      cdn: { egressGbToday: null, status: 'unwired' },
      sfu,
      firebase,    // collection counts
      firestore: {
        // Kept for back-compat; same numbers, different shape.
        adminActions: firebase.adminActions,
        errorLog: errCount,
        status: 'healthy',
      },
      // Cryptomus wallet — pending underwriting approval.
      cryptomus: { balanceEur: null, status: 'unwired' },
      asOf: now,
    };
    systemCache = { at: now, data };
    return data;
  }
);

// ════════════════════════════════════════════════════════════════════
// USERS LIVE — recently-active + new-signup lists + tier counts.
// ════════════════════════════════════════════════════════════════════

const slimStatsUser = (d) => {
  const u = d.data();
  return {
    uid: d.id,
    username: u.username || null,
    displayName: u.displayName || u.username || d.id.slice(0, 6),
    avatar: u.avatar || null,
    tier: u.subscription || 'free',
    role: u.role || null,
    accountType: u.accountType || null,
    country: u.country || null,
    device: u.lastSeenDevice || null,
    lastSeen: toMs(u.lastSeen),
    createdAt: toMs(u.createdAt),
  };
};

exports.adminGetUsersLive = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    await guardCaller(request.auth?.uid);
    const users = db.collection('users');
    const [activeSnap, newSnap, liteCount, proCount, guestCount] = await Promise.all([
      users.orderBy('lastSeen', 'desc').limit(30).get().catch(() => ({ docs: [] })),
      users.orderBy('createdAt', 'desc').limit(15).get().catch(() => ({ docs: [] })),
      safeCount(users.where('subscription', '==', 'lite')),
      safeCount(users.where('subscription', '==', 'pro')),
      // Guests are flagged `isGuest: true` by signInAsGuest. Nothing has ever
      // written `accountType: 'guest'`, so this tile read 0 no matter how many
      // guest sessions existed.
      safeCount(users.where('isGuest', '==', true)),
    ]);
    return {
      active: activeSnap.docs.map(slimStatsUser),
      newest: newSnap.docs.map(slimStatsUser),
      tiers: { lite: liteCount, pro: proCount, guests: guestCount },
      asOf: Date.now(),
    };
  }
);

// ════════════════════════════════════════════════════════════════════
// ENGAGEMENT — content-creation counters + the daily_metrics trend.
// count() aggregations only (cheap), plus 14 pre-rolled daily docs.
// ════════════════════════════════════════════════════════════════════

exports.adminGetEngagementStats = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    await guardCaller(request.auth?.uid);
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 3600 * 1000);
    const weekAgo = new Date(now - 7 * 24 * 3600 * 1000);

    const [posts24h, posts7d, streams24h, streams7d, tournaments7d, tips24h, reportsPending] = await Promise.all([
      safeCount(db.collection('posts').where('createdAt', '>=', dayAgo)),
      safeCount(db.collection('posts').where('createdAt', '>=', weekAgo)),
      safeCount(db.collection('streams').where('createdAt', '>=', dayAgo)),
      safeCount(db.collection('streams').where('createdAt', '>=', weekAgo)),
      safeCount(db.collection('tournaments').where('createdAt', '>=', weekAgo)),
      safeCount(db.collection('platform_commissions').where('createdAt', '>=', dayAgo)),
      safeCount(db.collection('reports').where('status', '==', 'pending')),
    ]);

    // Pre-rolled daily metrics — one read per day, newest 14.
    let daily = [];
    try {
      const snap = await db.collection('daily_metrics').orderBy('date', 'desc').limit(14).get();
      daily = snap.docs.map(d => {
        const m = d.data();
        return {
          date: m.date,
          signups: m.signups?.total || 0,
          newPaid: (m.subscriptions?.newLite || 0) + (m.subscriptions?.newPro || 0),
          revenueEUR: m.revenue?.subscriptionEUR || 0,
          platformCoins: m.revenue?.totalPlatformCoins || 0,
        };
      }).reverse();
    } catch { /* rollup may not have run yet */ }

    return { posts24h, posts7d, streams24h, streams7d, tournaments7d, tips24h, reportsPending, daily, asOf: now };
  }
);

// ════════════════════════════════════════════════════════════════════
// ERROR LOG — reads `client_errors`, the collection the ALREADY-INSTALLED
// clientTelemetry.js intake writes (capped 5/session, deduped). NOTE: the
// old `error_log` count on the System tab was a dead collection name —
// nothing ever wrote there.
// ════════════════════════════════════════════════════════════════════

exports.adminGetErrorLog = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    await guardCaller(request.auth?.uid);
    const [snap, count24h] = await Promise.all([
      db.collection('client_errors').orderBy('ts', 'desc').limit(50).get().catch(() => ({ docs: [] })),
      safeCount(db.collection('client_errors').where('ts', '>=', Date.now() - 24 * 3600 * 1000)),
    ]);
    return {
      count24h,
      rows: snap.docs.map(d => {
        const e = d.data();
        return {
          id: d.id,
          kind: e.kind || 'error',
          message: (e.message || '').slice(0, 300),
          stack: (e.stack || '').slice(0, 600) || null,
          route: e.route || null,
          uid: e.uid || null,
          version: e.appVersion || null,
          ua: (e.ua || '').slice(0, 120) || null,
          ts: e.ts || 0,
        };
      }),
      asOf: Date.now(),
    };
  }
);

// ════════════════════════════════════════════════════════════════════
// COSTS — "what is Vergr costing right now" (11-doc 1.3).
// Hetzner is live (HETZNER_API_TOKEN). Cloudflare is DORMANT until the
// founder creates a read-only token (secret CLOUDFLARE_COST_TOKEN, seeded
// 'placeholder'). GCP stays honest-manual (no billing API access here; the
// audit method lives in the gcp-cost-drivers memory / docs). Cached in
// admin_stats/cost_snapshot with a daily history — NO cron, the fetch runs
// only when an admin opens the panel and the cache is stale (>6h).
// ════════════════════════════════════════════════════════════════════

const CLOUDFLARE_COST_TOKEN = defineSecret('CLOUDFLARE_COST_TOKEN');
const COST_DOC = db.collection('admin_stats').doc('cost_snapshot');

// Sum everything Hetzner bills for while it merely EXISTS: servers, volumes,
// snapshots, floating/primary IPs (founder lesson: power-off ≠ €0).
async function fetchHetznerCosts(token) {
  const H = { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 };
  const [pricingR, serversR, volumesR, imagesR, primaryIpsR] = await Promise.all([
    axios.get('https://api.hetzner.cloud/v1/pricing', H),
    axios.get('https://api.hetzner.cloud/v1/servers?per_page=50', H),
    axios.get('https://api.hetzner.cloud/v1/volumes?per_page=50', H).catch(() => ({ data: { volumes: [] } })),
    axios.get('https://api.hetzner.cloud/v1/images?type=snapshot&per_page=50', H).catch(() => ({ data: { images: [] } })),
    axios.get('https://api.hetzner.cloud/v1/primary_ips?per_page=50', H).catch(() => ({ data: { primary_ips: [] } })),
  ]);
  const pricing = pricingR.data?.pricing || {};
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

  // ── Hetzner bills HOURLY, capped at the monthly price ──────────────────
  // So the list "monthly rate" is NOT the bill: a resource created mid-month
  // is prorated, which is why a rate-only panel never matched the console
  // (founder, 2026-07-16: "that is not the current bill... it was not even
  // that price last month"). We reconstruct what the console shows —
  // accrued-so-far this month — as hours-existed × hourly, clamped to the cap.
  const now = Date.now();
  const d = new Date(now);
  const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  const HOUR = 3600e3;
  // Billed hours for a resource this month: from whichever is later, the
  // month's start or the resource's creation, up to `until`.
  const hoursSince = (createdIso, until) => {
    const created = Date.parse(createdIso || '') || monthStart;
    return Math.max(0, (until - Math.max(created, monthStart)) / HOUR);
  };
  const capped = (hours, hourly, cap) => Math.min(hours * hourly, cap || Infinity);

  // Location is `server.location`, NOT `server.datacenter.location` — the
  // servers endpoint has no `datacenter` field at all (verified against the
  // live API 2026-07-16). The old path was always undefined, so the per-region
  // price lookup never matched and silently fell back to prices[0]. That was
  // right only because every EU region is priced alike; it would have
  // understated a Singapore box by ~€15/mo.
  const TB = 1e12;
  const servers = (serversR.data?.servers || []).map((s) => {
    const loc = s.location?.name;
    const prices = s.server_type?.prices || [];
    const price = prices.find((p) => p.location === loc) || prices[0];
    const hourly = num(price?.price_hourly?.gross);
    const cap = num(price?.price_monthly?.gross);

    // Traffic: `outgoing_traffic` and `included_traffic` are already scoped to
    // the current billing month by Hetzner. Only egress past the allowance
    // bills, at price_per_tb_traffic.
    const outTb = (s.outgoing_traffic || 0) / TB;
    const inclTb = (s.included_traffic || 0) / TB;
    const overTb = Math.max(0, outTb - inclTb);
    const trafficEur = overTb * num(price?.price_per_tb_traffic?.gross);

    return {
      name: s.name,
      type: s.server_type?.name || null,
      location: loc || null,
      status: s.status,
      priceRegionGuessed: !prices.find((p) => p.location === loc),
      created: s.created || null,
      monthlyEur: cap,
      accruedEur: +(capped(hoursSince(s.created, now), hourly, cap) + trafficEur).toFixed(2),
      projectedEur: +(capped(hoursSince(s.created, monthEnd), hourly, cap) + trafficEur).toFixed(2),
      traffic: { outTb: +outTb.toFixed(3), includedTb: +inclTb.toFixed(1), overageEur: +trafficEur.toFixed(2) },
    };
  });

  // Primary IPv4s bill as their OWN hourly resource on top of the server:
  // "We charge € 0.50 / month (excl. VAT) for our Primary IPv4s"
  // (docs.hetzner.com/cloud/servers/primary-ips/overview). Being ATTACHED does
  // not exempt them — the old code counted only UNASSIGNED ones and so reported
  // €0.00 while every attached IPv4 was quietly billing. Unassigned ones are
  // still called out separately: those are pure waste.
  const ipv4Price = (pricing.primary_ips || []).find((p) => p.type === 'ipv4')?.prices?.[0];
  const ipHourly = num(ipv4Price?.price_hourly?.gross);
  const ipCap = num(ipv4Price?.price_monthly?.gross);
  const ipv4 = (primaryIpsR.data?.primary_ips || []).filter((ip) => ip.type === 'ipv4');
  const ipAccrued = ipv4.reduce((a, ip) => a + capped(hoursSince(ip.created, now), ipHourly, ipCap), 0);
  const ipProjected = ipv4.reduce((a, ip) => a + capped(hoursSince(ip.created, monthEnd), ipHourly, ipCap), 0);
  const unassignedIps = ipv4.filter((ip) => !ip.assignee_id).length;

  // Volumes + snapshots are per-GB-month. Nothing here is prorated by creation
  // date because we hold none of either today; if that changes, give them the
  // same hoursSince treatment as the servers above.
  const volumeGb = (volumesR.data?.volumes || []).reduce((a, v) => a + (v.size || 0), 0);
  const volumeTotal = volumeGb * num(pricing.volume?.price_per_gb_month?.gross);
  const snapshotGb = (imagesR.data?.images || []).reduce((a, i) => a + (i.image_size || 0), 0);
  const snapshotTotal = snapshotGb * num(pricing.image?.price_per_gb_month?.gross);

  const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0);
  const accrued = sum(servers, 'accruedEur') + ipAccrued + volumeTotal + snapshotTotal;
  const projected = sum(servers, 'projectedEur') + ipProjected + volumeTotal + snapshotTotal;
  const rate = sum(servers, 'monthlyEur') + ipv4.length * ipCap + volumeTotal + snapshotTotal;

  return {
    status: 'healthy',
    // accruedEur is THE number — what the console shows for this month so far.
    // `monthlyEur` stays as the full-month rate for the trend history, which
    // wants a stable figure rather than one that climbs all month.
    accruedEur: +accrued.toFixed(2),
    projectedEur: +projected.toFixed(2),
    monthlyEur: +rate.toFixed(2),
    vatRate: num(pricing.vat_rate),
    monthStart: new Date(monthStart).toISOString().slice(0, 10),
    pctOfMonthElapsed: Math.round(((now - monthStart) / (monthEnd - monthStart)) * 100),
    servers,
    volumes: { count: (volumesR.data?.volumes || []).length, gb: volumeGb, monthlyEur: +volumeTotal.toFixed(2) },
    snapshots: { count: (imagesR.data?.images || []).length, gb: +snapshotGb.toFixed(1), monthlyEur: +snapshotTotal.toFixed(2) },
    primaryIps: {
      count: ipv4.length, unassigned: unassignedIps,
      accruedEur: +ipAccrued.toFixed(2), projectedEur: +ipProjected.toFixed(2),
    },
  };
}

// R2 free-tier + overage rate, from Cloudflare's published R2 pricing.
// Storage is the only thing that can bill us: egress is $0 (the whole reason
// media lives on R2), and our Class A/B op volumes are nowhere near the free
// 1M/10M per month. Re-check against https://developers.cloudflare.com/r2/pricing/
// if a bill ever disagrees with this panel.
const R2_FREE_GB = 10;
const R2_USD_PER_GB_MONTH = 0.015;

// Storage actually stored, via the GraphQL analytics API (needs the token to
// carry `Account Analytics: Read`). The REST subscriptions endpoint only
// reports a plan's BASE price — R2 Paid's base is $0 and it bills on usage, so
// subscriptions ALONE would render "Cloudflare: $0.00" while storage silently
// accrued past the free tier. That reads as reassurance and would be a lie,
// which is worse than showing nothing. Hence this second call.
async function fetchR2Usage(accountId, H) {
  // Ask for a few days back and take the newest row: the current day's
  // aggregate can be absent or still settling early in the UTC day.
  const since = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  const query = `query($id:String!,$since:Date!){viewer{accounts(filter:{accountTag:$id}){
    r2StorageAdaptiveGroups(limit:100,filter:{date_geq:$since},orderBy:[date_DESC]){
      max{payloadSize,metadataSize,objectCount} dimensions{date,bucketName}}}}}`;
  const res = await axios.post('https://api.cloudflare.com/client/v4/graphql',
    { query, variables: { id: accountId, since } }, H);
  // GraphQL answers 200 with an `errors` array on authz failure — a bare
  // status check would read that as success.
  if (res.data?.errors?.length) {
    const msg = res.data.errors[0]?.message || 'graphql error';
    return { status: /authz|not authorized/i.test(msg)
      ? 'unwired' : 'down', error: msg.slice(0, 120) };
  }
  const rows = res.data?.data?.viewer?.accounts?.[0]?.r2StorageAdaptiveGroups || [];
  if (!rows.length) return { status: 'down', error: 'no storage rows returned' };

  // One row per (date, bucket). Keep each bucket's newest row, then sum.
  const newestPerBucket = new Map();
  for (const r of rows) {
    const b = r.dimensions?.bucketName || 'unknown';
    const prev = newestPerBucket.get(b);
    if (!prev || r.dimensions.date > prev.dimensions.date) newestPerBucket.set(b, r);
  }
  const buckets = [...newestPerBucket.values()].map((r) => ({
    name: r.dimensions.bucketName,
    gb: +(((r.max?.payloadSize || 0) + (r.max?.metadataSize || 0)) / 1e9).toFixed(2),
    objects: r.max?.objectCount || 0,
  })).sort((a, b) => b.gb - a.gb);

  const storedGb = +buckets.reduce((a, b) => a + b.gb, 0).toFixed(2);
  const billableGb = Math.max(0, storedGb - R2_FREE_GB);
  return {
    status: 'healthy',
    storedGb,
    freeGb: R2_FREE_GB,
    pctOfFree: Math.round((storedGb / R2_FREE_GB) * 100),
    billableGb: +billableGb.toFixed(2),
    monthlyUsd: +(billableGb * R2_USD_PER_GB_MONTH).toFixed(2),
    asOf: [...newestPerBucket.values()][0]?.dimensions?.date || null,
    buckets,
  };
}

// ── GCP ────────────────────────────────────────────────────────────────
// Google exposes no REST endpoint for "spend so far" (real cost data needs a
// BigQuery billing export), so this is a COUNTED ESTIMATE rather than a fetched
// bill — built from the two things that actually drive this project's GCP line,
// per the cost audit: Secret Manager versions and Cloud Scheduler jobs.
// Everything else (Firestore, Functions, Hosting) sits inside free tiers at our
// volume. Rates are Google's published list prices; re-check against
// cloud.google.com/secret-manager/pricing + /scheduler/pricing if a bill ever
// disagrees. Labelled 'estimate' in the UI — never call it a bill.
const GCP_PROJECT = process.env.GCLOUD_PROJECT || 'vergr-44494';
const SECRET_VERSION_USD = 0.06;   // per ACTIVE version per month
const SCHEDULER_JOB_USD = 0.10;    // per job per month
const SCHEDULER_FREE_JOBS = 3;

// Token for the function's own service account, straight off the metadata
// server — no key material anywhere.
async function metadataToken() {
  const res = await axios.get(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' }, timeout: 5000 },
  );
  return res.data?.access_token || null;
}

async function fetchGcpCosts() {
  const token = await metadataToken().catch(() => null);
  if (!token) return { status: 'down', error: 'no metadata token (running locally?)' };
  const H = { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 };

  // Secret Manager: every ENABLED version bills, including superseded ones
  // still sitting behind :latest. That's the usual quiet waste here.
  let secrets = [];
  let pageToken = '';
  do {
    const url = `https://secretmanager.googleapis.com/v1/projects/${GCP_PROJECT}/secrets?pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const r = await axios.get(url, { ...H, validateStatus: () => true });
    if (r.status >= 400) {
      return { status: 'down', error: `secrets list ${r.status}: ${(r.data?.error?.message || '').slice(0, 90)}` };
    }
    secrets = secrets.concat(r.data?.secrets || []);
    pageToken = r.data?.nextPageToken || '';
  } while (pageToken);

  let versions = 0;
  const stale = [];
  // Bounded: ~60 secrets today. Sequential to stay polite; the whole thing runs
  // at most once per 6h behind the cache.
  for (const s of secrets) {
    const r = await axios.get(`https://secretmanager.googleapis.com/v1/${s.name}/versions?pageSize=100`,
      { ...H, validateStatus: () => true });
    if (r.status >= 400) continue;
    const enabled = (r.data?.versions || []).filter((v) => v.state === 'ENABLED');
    versions += enabled.length;
    // >1 enabled version = older ones still billing for nothing.
    if (enabled.length > 1) stale.push({ name: s.name.split('/').pop(), versions: enabled.length });
  }
  stale.sort((a, b) => b.versions - a.versions);

  const jr = await axios.get(
    `https://cloudscheduler.googleapis.com/v1/projects/${GCP_PROJECT}/locations/${REGION}/jobs?pageSize=100`,
    { ...H, validateStatus: () => true },
  );
  const jobs = jr.status < 400 ? (jr.data?.jobs || []).length : null;

  const secretsUsd = versions * SECRET_VERSION_USD;
  const schedulerUsd = jobs == null ? 0 : Math.max(0, jobs - SCHEDULER_FREE_JOBS) * SCHEDULER_JOB_USD;
  const wastedVersions = stale.reduce((a, s) => a + (s.versions - 1), 0);

  return {
    status: 'estimate',
    monthlyUsd: +(secretsUsd + schedulerUsd).toFixed(2),
    secrets: {
      count: secrets.length, versions,
      monthlyUsd: +secretsUsd.toFixed(2),
      wastedVersions,
      wastedUsd: +(wastedVersions * SECRET_VERSION_USD).toFixed(2),
      worst: stale.slice(0, 5),
    },
    scheduler: jobs == null
      ? { error: 'jobs list denied' }
      : { count: jobs, billable: Math.max(0, jobs - SCHEDULER_FREE_JOBS), monthlyUsd: +schedulerUsd.toFixed(2) },
    note: 'Counted estimate at Google list prices — not a fetched bill (no billing API without a BigQuery export). Firestore/Functions/Hosting sit inside free tiers at current volume.',
  };
}

// Cloudflare cost = subscription base prices + metered R2 storage.
async function fetchCloudflareCosts(token) {
  const H = { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 };
  const accountsR = await axios.get('https://api.cloudflare.com/client/v4/accounts', H);
  const account = accountsR.data?.result?.[0];
  if (!account) return { status: 'down', error: 'no account visible to token' };
  const [subsR, r2] = await Promise.all([
    axios.get(`https://api.cloudflare.com/client/v4/accounts/${account.id}/subscriptions`, H)
      .catch(() => ({ data: { result: [] } })),
    fetchR2Usage(account.id, H).catch((e) => ({ status: 'down', error: e?.message?.slice(0, 100) })),
  ]);
  const subs = (subsR.data?.result || []).map((s) => ({
    product: s.rate_plan?.public_name || s.rate_plan?.id || 'subscription',
    monthly: s.price ?? null,
    currency: s.currency || 'USD',
  }));
  const subsUsd = subs.reduce((a, s) => a + (Number(s.monthly) || 0), 0);
  const r2Usd = r2.status === 'healthy' ? (r2.monthlyUsd || 0) : 0;
  return {
    status: 'healthy',
    account: account.name,
    monthlyUsd: +(subsUsd + r2Usd).toFixed(2),
    // Don't let the headline read $0.00 with quiet confidence when the metered
    // half is missing — the UI shows this caveat instead of a total.
    incomplete: r2.status !== 'healthy',
    subscriptions: subs,
    r2,
  };
}

exports.adminGetCostSnapshot = functions.https.onCall(
  { region: REGION, cors: true, secrets: [HETZNER_API_TOKEN, CLOUDFLARE_COST_TOKEN] },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const force = !!request.data?.force;
    const now = Date.now();

    // Serve the cached snapshot when fresh — the whole feature costs ~2 doc
    // ops/day plus the external API calls, only while an admin is looking.
    const cachedSnap = await COST_DOC.get().catch(() => null);
    const cached = cachedSnap?.exists ? cachedSnap.data() : null;
    // Cache is keyed on shape as well as age: a snapshot written by an older
    // build lacks fields this UI now renders (e.g. hetzner.accruedEur), which
    // would paint a confident €0.00 until the 6h TTL lapsed. Bump SNAPSHOT_V
    // whenever the returned shape changes.
    const SNAPSHOT_V = 3;
    const fresh = now - (cached?.latest?.asOf || 0) < 6 * 3600 * 1000;
    if (cached?.latest && !force && fresh && cached.latest.v === SNAPSHOT_V) {
      return { ...cached.latest, history: cached.history || [], cached: true };
    }

    // Trim on read: these go straight into Authorization headers, and a secret
    // set with `echo` (or any prompt that keeps the line terminator) carries a
    // trailing newline that makes the header invalid — the failure looks like
    // an auth problem, not a formatting one.
    const secretValue = (param) => {
      try { return (param.value() || '').trim() || null; } catch { return null; }
    };
    const hetznerToken = secretValue(HETZNER_API_TOKEN);
    const cfToken = secretValue(CLOUDFLARE_COST_TOKEN);

    const hetzner = (!hetznerToken || hetznerToken === 'placeholder')
      ? { status: 'unwired' }
      : await fetchHetznerCosts(hetznerToken).catch((e) => ({ status: 'down', error: e?.message?.slice(0, 100) }));
    const cloudflare = (!cfToken || cfToken === 'placeholder')
      ? { status: 'unwired', note: 'Founder: create a read-only Cloudflare API token (Account Settings + Billing read) and set secret CLOUDFLARE_COST_TOKEN.' }
      : await fetchCloudflareCosts(cfToken).catch((e) => ({ status: 'down', error: e?.message?.slice(0, 100) }));
    const gcp = await fetchGcpCosts().catch((e) => ({ status: 'down', error: e?.message?.slice(0, 100) }));

    const latest = { hetzner, cloudflare, gcp, asOf: now, v: SNAPSHOT_V };

    // Daily history point (one per calendar day, cap 90) for the trend line.
    const history = Array.isArray(cached?.history) ? [...cached.history] : [];
    const dayKey = new Date(now).toISOString().slice(0, 10);
    if (!history.some((h) => h.day === dayKey) && hetzner.status === 'healthy') {
      history.push({ day: dayKey, hetznerMonthlyEur: hetzner.monthlyEur, cloudflareMonthlyUsd: cloudflare.monthlyUsd ?? null });
      while (history.length > 90) history.shift();
    }

    await COST_DOC.set({ latest, history }, { merge: false }).catch(() => null);
    return { ...latest, history, cached: false };
  }
);

// ════════════════════════════════════════════════════════════════════
// GEOGRAPHY — derives country breakdown from users.lastSeenCountry.
// Falls back to "Unknown" bucket when the field isn't populated.
// ════════════════════════════════════════════════════════════════════

exports.adminGetGeographyStats = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const now = Date.now();
    if (geoCache.data && (now - geoCache.at) < 60_000) return { ...geoCache.data, cached: true };

    // Aggregate the most-recent 1000 active users by country in-memory.
    let docs = [];
    try {
      const snap = await db.collection('users')
        .where('lastSeen', '>=', now - 24 * 3600 * 1000)
        .orderBy('lastSeen', 'desc')
        .limit(1000)
        .get();
      docs = snap.docs;
    } catch {}

    const counts = {};
    docs.forEach(d => {
      const c = d.data().lastSeenCountry || d.data().country || 'Unknown';
      counts[c] = (counts[c] || 0) + 1;
    });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const countries = Object.entries(counts)
      .map(([country, active]) => ({
        country, active, pct: total > 0 ? (active / total) * 100 : 0,
      }))
      .sort((a, b) => b.active - a.active)
      .slice(0, 20);

    const data = { countries, totalSampled: docs.length, asOf: now };
    geoCache = { at: now, data };
    return data;
  }
);

// ════════════════════════════════════════════════════════════════════
// ACTIVITY FEED — live tail of app_events/ collection.
// If the collection doesn't exist yet, synthesize from admin_actions.
// ════════════════════════════════════════════════════════════════════

exports.adminGetLiveActivityFeed = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { limit = 20 } = request.data || {};

    let rows = [];
    try {
      const snap = await db.collection('app_events')
        .orderBy('createdAt', 'desc')
        .limit(Math.min(50, Math.max(1, limit)))
        .get();
      rows = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          type: data.type || 'event',
          message: data.message || null,
          createdAt: toMs(data.createdAt),
          source: 'app_events',
        };
      });
    } catch { /* doesn't exist */ }

    if (rows.length === 0) {
      // Fallback — synthesize from admin_actions so the UI has *something*.
      try {
        const snap = await db.collection('admin_actions')
          .orderBy('createdAt', 'desc')
          .limit(Math.min(50, Math.max(1, limit)))
          .get();
        rows = snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            type: data.action || 'admin',
            message: `${data.actor?.displayName || 'Admin'} → ${(data.action || 'action').replace(/_/g, ' ')}`,
            createdAt: toMs(data.createdAt),
            source: 'admin_actions',
          };
        });
      } catch {}
    }

    return { rows };
  }
);

// ════════════════════════════════════════════════════════════════════
// PRESENCE SNAPSHOTS — scheduled writer.
//
// Runs every 30 minutes and writes a single row to presence_snapshots/
// with the count of users active in the last 5 minutes. The Overview tab's
// 24h active-users chart reads from this collection.
//
// 48 rows/day = ~17,520 docs/year — cheap. Lifecycle pruning lands in a
// follow-up (TTL trigger when we have a TTL policy attached in the console).
// ════════════════════════════════════════════════════════════════════

const defer = (_opts, fn) => fn; // cron-consolidation shim (see index.js cronEvery6h)
exports.writePresenceSnapshot = defer(
  { schedule: 'every 30 minutes', region: REGION, timeZone: 'UTC' },
  async () => {
    const now = Date.now();
    const fiveMinAgo = now - 5 * 60 * 1000;
    const count = await db.collection('users')
      .where('lastSeen', '>=', fiveMinAgo)
      .count().get()
      .then(r => r.data().count).catch(() => 0);
    await db.collection('presence_snapshots').add({
      at: now,
      activeCount: count,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
);
