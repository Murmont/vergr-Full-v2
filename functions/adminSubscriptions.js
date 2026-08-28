// adminSubscriptions.js — Admin → Subscriptions screen callables (pass 1).
//
// Pass 1 covers: Overview / All Subscriptions / Billing & Invoices.
// Pass 2 (Plans & Pricing, Comp & Overrides, Settings, Logs) lands later.
//
// Data model — recall from CLAUDE.md + functions/subscriptions.js:
//   users/{uid}.subscription              ∈ 'free'|'lite'|'pro'
//   users/{uid}.subscriptionPeriodStart   millis
//   users/{uid}.subscriptionPeriodEnd     millis
//   users/{uid}.subscriptionAutoRenew     bool
//   subscriptions/{uid}_{ts}              audit trail per period
//                                          { userId, tier, method, coinsCharged?,
//                                            periodStart, periodEnd, createdAt }
//   invoices/{id}                          placeholder until Cryptomus wires
//                                          inbound — fields read defensively
//
// Tier B (coin-funded) subscriptions have method='coins' on the audit row;
// Tier A (card via Cryptomus/Tebex when live) will have method='card'.

const functions = require('firebase-functions/v2');
const { getFirestore, AggregateField, FieldValue } = require('firebase-admin/firestore');
const { requireAdminScreen } = require('./adminAccess');
const { requireFreshStepUp, adminRateLimit, auditAdminAction } = require('./adminSecurity');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

// NOTE: these are the FALLBACK prices used when plans/{id} doc is absent.
// Once Plans & Pricing tab is used, the plans collection becomes source of
// truth and these values are only consulted as a backstop.
const PRICE_EUR = { lite: 4.99, pro: 9.99 };
const PRICE_COINS = { lite: 500, pro: 1000 };

const KNOWN_PLAN_IDS = ['lite', 'pro'];

async function readPlanPrices() {
  try {
    const snap = await db.collection('plans').get();
    const out = { eur: { ...PRICE_EUR }, coins: { ...PRICE_COINS } };
    snap.docs.forEach(d => {
      const p = d.data();
      if (!p.active) return;
      if (typeof p.priceEUR === 'number')   out.eur[d.id]   = p.priceEUR;
      if (typeof p.priceCoins === 'number') out.coins[d.id] = p.priceCoins;
    });
    return out;
  } catch {
    return { eur: { ...PRICE_EUR }, coins: { ...PRICE_COINS } };
  }
}

async function guardCaller(uid) {
  return await requireAdminScreen(uid, 'subscriptions');
}

const safeAgg = async (q, fields) => {
  try { const r = await q.aggregate(fields).get(); return r.data(); }
  catch { return null; }
};

const toMs = (t) => {
  if (!t) return null;
  if (typeof t === 'number') return t;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (t._seconds) return t._seconds * 1000;
  return null;
};

// ════════════════════════════════════════════════════════════════════
// OVERVIEW
// ════════════════════════════════════════════════════════════════════

exports.adminGetSubscriptionStats = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);

    const users = db.collection('users');
    const now = Date.now();
    const monthAgo = now - 30 * 24 * 3600 * 1000;
    const weekAgo  = now -  7 * 24 * 3600 * 1000;

    const [liteCount, proCount, freeCount, newWeek, newMonth, cancelledMonth] = await Promise.all([
      safeAgg(users.where('subscription', '==', 'lite'), { count: AggregateField.count() }),
      safeAgg(users.where('subscription', '==', 'pro'),  { count: AggregateField.count() }),
      safeAgg(users.where('subscription', '==', 'free'), { count: AggregateField.count() }),
      // New subscriptions in the last 7 days (audit collection)
      db.collection('subscriptions').where('createdAt', '>=', weekAgo).count().get()
        .then(r => r.data().count).catch(() => 0),
      // New subscriptions in last 30 days
      db.collection('subscriptions').where('createdAt', '>=', monthAgo).count().get()
        .then(r => r.data().count).catch(() => 0),
      // Cancelled last 30 days = users with subscription=free who had a sub row in the last month
      // (approximation; full churn calc needs status field on the audit row)
      db.collection('subscriptions').where('createdAt', '>=', monthAgo).where('method', '==', 'cancellation').count().get()
        .then(r => r.data().count).catch(() => 0),
    ]);

    const lite = liteCount?.count ?? 0;
    const pro  = proCount?.count  ?? 0;
    const active = lite + pro;
    const mrrEUR = lite * PRICE_EUR.lite + pro * PRICE_EUR.pro;
    const arrEUR = mrrEUR * 12;

    return {
      activeSubscriptions: active,
      liteCount: lite,
      proCount: pro,
      freeCount: freeCount?.count ?? 0,
      newWeek,
      newMonth,
      cancelledMonth,
      mrrEUR,
      arrEUR,
      monthlyRevenueEUR: mrrEUR,   // proxy: assumes everyone billed monthly
      asOf: now,
    };
  }
);

// Trend chart — daily new + churned counts over the period.
exports.adminGetSubscriptionTrend = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { days = 30 } = request.data || {};
    const safeDays = Math.min(90, Math.max(7, days));
    const startMs = Date.now() - safeDays * 24 * 3600 * 1000;

    const snap = await db.collection('subscriptions')
      .where('createdAt', '>=', startMs)
      .orderBy('createdAt', 'asc')
      .limit(2000)
      .get()
      .catch(() => ({ docs: [] }));

    // Bucket by yyyy-mm-dd
    const buckets = {};
    snap.docs.forEach(d => {
      const data = d.data();
      const ms = toMs(data.createdAt) || data.createdAt;
      if (!ms) return;
      const day = new Date(ms).toISOString().slice(0, 10);
      if (!buckets[day]) buckets[day] = { lite: 0, pro: 0 };
      if (data.tier === 'lite') buckets[day].lite += 1;
      else if (data.tier === 'pro') buckets[day].pro += 1;
    });
    const points = Object.entries(buckets)
      .sort(([a], [b]) => a < b ? -1 : 1)
      .map(([day, v]) => ({ day, lite: v.lite, pro: v.pro }));

    return { points, days: safeDays };
  }
);

// Top of the dashboard: latest 10 subscription events (new/cancelled/renew/etc).
exports.adminGetRecentSubscriptionEvents = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { limit = 10 } = request.data || {};
    const snap = await db.collection('subscriptions')
      .orderBy('createdAt', 'desc')
      .limit(Math.min(50, Math.max(1, limit)))
      .get()
      .catch(() => ({ docs: [] }));

    const rows = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        userId: data.userId || null,
        tier: data.tier || null,
        method: data.method || null,
        coinsCharged: data.coinsCharged ?? null,
        periodStart: toMs(data.periodStart),
        periodEnd: toMs(data.periodEnd),
        createdAt: toMs(data.createdAt),
      };
    });

    // Hydrate user info
    const uids = [...new Set(rows.map(r => r.userId).filter(Boolean))];
    const profiles = {};
    if (uids.length > 0) {
      const snaps = await Promise.all(uids.map(u => db.collection('users').doc(u).get()));
      snaps.forEach((s, i) => {
        if (s.exists) {
          const p = s.data();
          profiles[uids[i]] = {
            displayName: p.displayName || null,
            username: p.username || null,
            avatar: p.avatar || null,
            email: p.email || null,
          };
        }
      });
    }
    return { rows: rows.map(r => ({ ...r, user: profiles[r.userId] || null })) };
  }
);

// Upcoming renewals — users with subscription != 'free' and subscriptionAutoRenew = true,
// bucketed by Today / This week / This month.
exports.adminGetUpcomingRenewals = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const now = Date.now();
    const dayEnd  = now + 24 * 3600 * 1000;
    const weekEnd = now +  7 * 24 * 3600 * 1000;
    const monthEnd = now + 30 * 24 * 3600 * 1000;

    const countBy = async (cap) =>
      db.collection('users')
        .where('subscription', 'in', ['lite', 'pro'])
        .where('subscriptionAutoRenew', '==', true)
        .where('subscriptionPeriodEnd', '<=', cap)
        .count().get().then(r => r.data().count).catch(() => 0);

    const [today, week, month] = await Promise.all([countBy(dayEnd), countBy(weekEnd), countBy(monthEnd)]);

    // Estimate revenue per bucket using avg tier price
    const avg = (PRICE_EUR.lite + PRICE_EUR.pro) / 2;
    return {
      today:        { count: today, estimatedEUR: today * avg },
      thisWeek:     { count: week,  estimatedEUR: week  * avg },
      thisMonth:    { count: month, estimatedEUR: month * avg },
    };
  }
);

// ════════════════════════════════════════════════════════════════════
// ALL SUBSCRIPTIONS
// ════════════════════════════════════════════════════════════════════

exports.adminListSubscriptions = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { filters = {}, cursor = null, pageSize = 25, search = '' } = request.data || {};
    const limit = Math.min(100, Math.max(1, pageSize));

    let q = db.collection('users')
      .where('subscription', 'in', ['lite', 'pro'])
      .orderBy('subscriptionPeriodStart', 'desc');

    if (filters.tier && ['lite', 'pro'].includes(filters.tier)) {
      q = db.collection('users').where('subscription', '==', filters.tier)
        .orderBy('subscriptionPeriodStart', 'desc');
    }

    if (cursor) {
      const cs = await db.collection('users').doc(cursor).get();
      if (cs.exists) q = q.startAfter(cs);
    }

    const snap = await q.limit(limit).get().catch(() => ({ docs: [] }));
    const rows = snap.docs
      .filter(d => {
        if (!search) return true;
        const data = d.data();
        const s = search.toLowerCase();
        return (data.username || '').toLowerCase().includes(s) ||
               (data.displayName || '').toLowerCase().includes(s) ||
               (data.email || '').toLowerCase().includes(s);
      })
      .map(d => {
        const u = d.data();
        return {
          id: d.id,
          username: u.username || null,
          displayName: u.displayName || null,
          email: u.email || null,
          avatar: u.avatar || null,
          tier: u.subscription,
          periodStart: toMs(u.subscriptionPeriodStart),
          periodEnd: toMs(u.subscriptionPeriodEnd),
          autoRenew: !!u.subscriptionAutoRenew,
          method: u.subscriptionMethod || null,
          status: u.subscriptionStatus || 'active',
          priceEUR: PRICE_EUR[u.subscription] || 0,
          // Convenience: derive a UI-friendly status pill
          uiStatus: deriveUiStatus(u),
        };
      });

    const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;
    return { rows, nextCursor };
  }
);

function deriveUiStatus(u) {
  const now = Date.now();
  const end = toMs(u.subscriptionPeriodEnd) || 0;
  if (!u.subscriptionAutoRenew && end < now) return 'cancelled';
  if (end && end < now)                       return 'past_due';
  if (u.subscriptionTrialUntil && toMs(u.subscriptionTrialUntil) > now) return 'trial';
  return 'active';
}

// ════════════════════════════════════════════════════════════════════
// BILLING & INVOICES
// ════════════════════════════════════════════════════════════════════

exports.adminGetBillingStats = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);

    const now = Date.now();
    const monthStart = new Date();
    monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const monthStartMs = monthStart.getTime();

    const invoices = db.collection('invoices');
    const safeCount = (q) => q.count().get().then(r => r.data().count).catch(() => 0);
    const safeSum = (q, f) => safeAgg(q, { total: AggregateField.sum(f) });

    const [totalBilled, collected, pending, overdue, refunded] = await Promise.all([
      safeSum(invoices.where('issueDate', '>=', monthStartMs), 'amount'),
      safeSum(invoices.where('status', '==', 'paid').where('paidAt', '>=', monthStartMs), 'amount'),
      safeSum(invoices.where('status', '==', 'pending'), 'amount'),
      safeSum(invoices.where('status', '==', 'overdue'), 'amount'),
      safeSum(invoices.where('status', '==', 'refunded').where('refundedAt', '>=', monthStartMs), 'amount'),
    ]);

    return {
      totalBilledEUR: totalBilled?.total ?? 0,
      collectedEUR:   collected?.total   ?? 0,
      pendingEUR:     pending?.total     ?? 0,
      overdueEUR:     overdue?.total     ?? 0,
      refundedEUR:    refunded?.total    ?? 0,
      asOf: now,
    };
  }
);

exports.adminListInvoices = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { filters = {}, cursor = null, pageSize = 25 } = request.data || {};
    const limit = Math.min(100, Math.max(1, pageSize));

    let q = db.collection('invoices').orderBy('issueDate', 'desc');
    if (filters.status) q = q.where('status', '==', filters.status);
    if (filters.tier)   q = q.where('plan', '==', filters.tier);

    if (cursor) {
      const cs = await db.collection('invoices').doc(cursor).get();
      if (cs.exists) q = q.startAfter(cs);
    }

    const snap = await q.limit(limit).get().catch(() => ({ docs: [] }));
    const rows = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        invoiceNumber: data.invoiceNumber || d.id,
        userId: data.userId || null,
        plan: data.plan || null,
        billingCycle: data.billingCycle || 'monthly',
        amount: data.amount ?? 0,
        currency: data.currency || 'EUR',
        status: data.status || 'pending',
        paymentMethod: data.paymentMethod || null,
        issueDate: toMs(data.issueDate),
        dueDate: toMs(data.dueDate),
        paidAt: toMs(data.paidAt),
        txRef: data.txRef || null,
      };
    });

    // Hydrate user info
    const uids = [...new Set(rows.map(r => r.userId).filter(Boolean))];
    const profiles = {};
    if (uids.length > 0) {
      const snaps = await Promise.all(uids.map(u => db.collection('users').doc(u).get()));
      snaps.forEach((s, i) => {
        if (s.exists) {
          const p = s.data();
          profiles[uids[i]] = {
            displayName: p.displayName || null,
            username: p.username || null,
            avatar: p.avatar || null,
            email: p.email || null,
          };
        }
      });
    }

    const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;
    return {
      rows: rows.map(r => ({ ...r, user: profiles[r.userId] || null })),
      nextCursor,
    };
  }
);

// ════════════════════════════════════════════════════════════════════
// PLANS & PRICING (Pass 2)
// ════════════════════════════════════════════════════════════════════
//
// plans/{planId} schema:
//   { id, name, displayName, priceEUR, priceCoins, periodDays, features[],
//     color, tagline, active, billingCycle: 'monthly',
//     scheduledPrice: { effectiveAt, priceEUR, priceCoins } | null,
//     updatedAt, updatedBy }
//
// First read seeds 'lite' + 'pro' from the in-code defaults if they don't exist
// yet so the UI always has rows to render.

const DEFAULT_PLAN_SEEDS = {
  lite: {
    id: 'lite', name: 'lite', displayName: 'VERGR Lite',
    priceEUR: 4.99, priceCoins: 500, periodDays: 30,
    billingCycle: 'monthly', color: '#7B6FFF', tagline: 'Level up faster',
    features: ['No ads', 'Stream publicly (720p)', '1.5× VP', '1GB uploads', 'Scheduled posts'],
    active: true, scheduledPrice: null,
  },
  pro: {
    id: 'pro', name: 'pro', displayName: 'VERGR Pro',
    priceEUR: 9.99, priceCoins: 1000, periodDays: 30,
    billingCycle: 'monthly', color: '#F5C542', tagline: 'Go all-in',
    // Keep in sync with TIERS.pro.features in src/utils/tierSystem.js. No
    // tournaments (retired) and no co-streaming (open to every plan).
    features: ['1080p, no daily limit', '2× VP', '90-day replays', '5GB uploads', 'Custom vergr.me domain'],
    active: true, scheduledPrice: null,
  },
};

exports.adminListPlans = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);

    const snap = await db.collection('plans').get();
    const found = new Map(snap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));

    // Lazy-seed defaults so a fresh project shows lite + pro out of the box.
    for (const id of KNOWN_PLAN_IDS) {
      if (!found.has(id)) {
        const seed = DEFAULT_PLAN_SEEDS[id];
        await db.collection('plans').doc(id).set({
          ...seed, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'system_seed',
        });
        found.set(id, seed);
      }
    }

    const rows = Array.from(found.values()).map(p => ({
      ...p,
      updatedAt: toMs(p.updatedAt),
      scheduledPrice: p.scheduledPrice ? {
        ...p.scheduledPrice, effectiveAt: toMs(p.scheduledPrice.effectiveAt),
      } : null,
    }));
    return { rows };
  }
);

exports.adminUpsertPlan = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    await requireFreshStepUp(uid);
    await adminRateLimit(uid, 'admin_upsert_plan', { perHour: 20, perDay: 60 });

    const data = request.data || {};
    const id = String(data.id || '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(id)) {
      throw new HttpsError('invalid-argument', 'Plan id must be 2-32 chars, lowercase letters/digits/_/-.');
    }
    const priceEUR = Number(data.priceEUR);
    const priceCoins = Number(data.priceCoins);
    const periodDays = Number(data.periodDays || 30);
    if (!isFinite(priceEUR) || priceEUR < 0 || priceEUR > 9999) {
      throw new HttpsError('invalid-argument', 'priceEUR must be 0..9999');
    }
    if (!isFinite(priceCoins) || priceCoins < 0 || priceCoins > 1_000_000) {
      throw new HttpsError('invalid-argument', 'priceCoins must be 0..1,000,000');
    }
    if (!isFinite(periodDays) || periodDays < 1 || periodDays > 365) {
      throw new HttpsError('invalid-argument', 'periodDays must be 1..365');
    }

    const ref = db.collection('plans').doc(id);
    const before = (await ref.get()).data() || null;

    const payload = {
      id,
      name: String(data.name || id),
      displayName: String(data.displayName || data.name || id).slice(0, 80),
      priceEUR, priceCoins, periodDays,
      billingCycle: String(data.billingCycle || 'monthly'),
      color: String(data.color || '#7B6FFF').slice(0, 16),
      tagline: String(data.tagline || '').slice(0, 120),
      features: Array.isArray(data.features) ? data.features.slice(0, 24).map(f => String(f).slice(0, 120)) : [],
      active: data.active !== false,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid,
    };
    await ref.set(payload, { merge: true });

    await auditAdminAction({
      actor: uid, action: before ? 'admin_update_plan' : 'admin_create_plan',
      target: { type: 'plan', id },
      before, after: payload,
      stepUpEnforced: true, stepUpFresh: true,
    });

    return { ok: true, id };
  }
);

exports.adminDeletePlan = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    await requireFreshStepUp(uid);
    await adminRateLimit(uid, 'admin_delete_plan', { perHour: 5, perDay: 10 });
    const id = String(request.data?.id || '').trim().toLowerCase();
    if (!id) throw new HttpsError('invalid-argument', 'id required');
    if (KNOWN_PLAN_IDS.includes(id)) {
      // We don't hard-delete lite/pro — that would orphan every paid user.
      // Deactivate instead.
      await db.collection('plans').doc(id).set({
        active: false, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid,
      }, { merge: true });
      await auditAdminAction({
        actor: uid, action: 'admin_deactivate_plan',
        target: { type: 'plan', id },
        reason: 'Built-in plan; deactivated rather than deleted.',
        stepUpEnforced: true, stepUpFresh: true,
      });
      return { ok: true, deactivated: true };
    }
    const ref = db.collection('plans').doc(id);
    const before = (await ref.get()).data() || null;
    if (!before) throw new HttpsError('not-found', 'Plan not found');
    await ref.delete();
    await auditAdminAction({
      actor: uid, action: 'admin_delete_plan',
      target: { type: 'plan', id }, before, after: null,
      stepUpEnforced: true, stepUpFresh: true,
    });
    return { ok: true, deleted: true };
  }
);

exports.adminSchedulePriceChange = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    await requireFreshStepUp(uid);
    await adminRateLimit(uid, 'admin_schedule_price_change', { perHour: 10, perDay: 30 });

    const { planId, priceEUR, priceCoins, effectiveAt } = request.data || {};
    const id = String(planId || '').trim().toLowerCase();
    const effMs = Number(effectiveAt);
    if (!id) throw new HttpsError('invalid-argument', 'planId required');
    if (!isFinite(effMs) || effMs < Date.now() + 60_000) {
      throw new HttpsError('invalid-argument', 'effectiveAt must be at least 1 minute in the future.');
    }
    if (priceEUR != null && (!isFinite(Number(priceEUR)) || priceEUR < 0)) {
      throw new HttpsError('invalid-argument', 'priceEUR invalid');
    }
    if (priceCoins != null && (!isFinite(Number(priceCoins)) || priceCoins < 0)) {
      throw new HttpsError('invalid-argument', 'priceCoins invalid');
    }

    const ref = db.collection('plans').doc(id);
    const before = (await ref.get()).data() || null;
    if (!before) throw new HttpsError('not-found', 'Plan not found');

    const scheduled = {
      effectiveAt: effMs,
      priceEUR: priceEUR != null ? Number(priceEUR) : null,
      priceCoins: priceCoins != null ? Number(priceCoins) : null,
      scheduledAt: Date.now(),
      scheduledBy: uid,
    };
    await ref.set({ scheduledPrice: scheduled, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid }, { merge: true });

    await auditAdminAction({
      actor: uid, action: 'admin_schedule_price_change',
      target: { type: 'plan', id },
      before: { scheduledPrice: before.scheduledPrice || null },
      after:  { scheduledPrice: scheduled },
      stepUpEnforced: true, stepUpFresh: true,
    });
    return { ok: true, scheduled };
  }
);

exports.adminCancelScheduledPriceChange = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const id = String(request.data?.planId || '').trim().toLowerCase();
    if (!id) throw new HttpsError('invalid-argument', 'planId required');
    const ref = db.collection('plans').doc(id);
    const before = (await ref.get()).data() || null;
    if (!before?.scheduledPrice) return { ok: true, noop: true };
    await ref.set({ scheduledPrice: null, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid }, { merge: true });
    await auditAdminAction({
      actor: uid, action: 'admin_cancel_scheduled_price_change',
      target: { type: 'plan', id },
      before: { scheduledPrice: before.scheduledPrice },
      after:  { scheduledPrice: null },
    });
    return { ok: true };
  }
);

// Daily cron: apply any scheduled price changes whose effectiveAt has passed.
const defer = (_opts, fn) => fn; // cron-consolidation shim (see index.js cronDaily)
exports.applyScheduledPriceChanges = defer(
  { schedule: 'every day 02:00', timeZone: 'UTC', region: REGION },
  async () => {
    const now = Date.now();
    const snap = await db.collection('plans').get();
    const batch = db.batch();
    let touched = 0;
    snap.docs.forEach(d => {
      const p = d.data();
      const sp = p.scheduledPrice;
      const effMs = toMs(sp?.effectiveAt);
      if (!sp || !effMs || effMs > now) return;
      const update = { scheduledPrice: null, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'cron_apply_price' };
      if (typeof sp.priceEUR === 'number')   update.priceEUR = sp.priceEUR;
      if (typeof sp.priceCoins === 'number') update.priceCoins = sp.priceCoins;
      batch.set(d.ref, update, { merge: true });
      touched += 1;
    });
    if (touched > 0) await batch.commit();
    return null;
  }
);

// ════════════════════════════════════════════════════════════════════
// COMP & OVERRIDES (Pass 2)
// ════════════════════════════════════════════════════════════════════
//
// subscription_overrides/{auto} schema:
//   { userId, type: 'comp' | 'discount',
//     tier: 'lite' | 'pro',
//     durationDays?: number       // for type='comp'
//     discountPercent?: number    // for type='discount' (1..100)
//     applyToCount?: number       // how many renewals the discount covers (default 1)
//     remainingUses?: number      // decremented as renewals consume it
//     expiresAt: ms,
//     reason, createdBy, createdAt,
//     status: 'active' | 'consumed' | 'revoked' | 'expired',
//     revokedAt?, revokedBy?, revokeReason? }

exports.adminListOverrides = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { filters = {}, cursor = null, pageSize = 25 } = request.data || {};
    const limit = Math.min(100, Math.max(1, pageSize));

    let q = db.collection('subscription_overrides').orderBy('createdAt', 'desc');
    if (filters.status) q = q.where('status', '==', filters.status);
    if (filters.type)   q = q.where('type', '==', filters.type);
    if (filters.userId) q = q.where('userId', '==', filters.userId);

    if (cursor) {
      const cs = await db.collection('subscription_overrides').doc(cursor).get();
      if (cs.exists) q = q.startAfter(cs);
    }

    const snap = await q.limit(limit).get().catch(() => ({ docs: [] }));
    const rows = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        userId: data.userId,
        type: data.type,
        tier: data.tier,
        durationDays: data.durationDays ?? null,
        discountPercent: data.discountPercent ?? null,
        applyToCount: data.applyToCount ?? null,
        remainingUses: data.remainingUses ?? null,
        expiresAt: toMs(data.expiresAt),
        reason: data.reason || null,
        status: data.status || 'active',
        createdBy: data.createdBy || null,
        createdAt: toMs(data.createdAt),
        revokedAt: toMs(data.revokedAt),
        revokedBy: data.revokedBy || null,
        revokeReason: data.revokeReason || null,
      };
    });

    // Hydrate users
    const uids = [...new Set(rows.map(r => r.userId).filter(Boolean))];
    const profiles = {};
    if (uids.length > 0) {
      const snaps = await Promise.all(uids.map(u => db.collection('users').doc(u).get()));
      snaps.forEach((s, i) => {
        if (s.exists) {
          const p = s.data();
          profiles[uids[i]] = {
            displayName: p.displayName || null,
            username: p.username || null,
            avatar: p.avatar || null,
            email: p.email || null,
          };
        }
      });
    }
    const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;
    return { rows: rows.map(r => ({ ...r, user: profiles[r.userId] || null })), nextCursor };
  }
);

// Comp a user — grants free Lite/Pro for N days. Updates user doc + writes
// audit row + creates an override record for accountability.
exports.adminCompUser = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    await requireFreshStepUp(uid);
    await adminRateLimit(uid, 'admin_comp_user', { perHour: 30, perDay: 100, perMonth: 1000 });

    const { userId, tier, durationDays, reason } = request.data || {};
    if (!userId) throw new HttpsError('invalid-argument', 'userId required');
    if (!['lite', 'pro'].includes(tier)) throw new HttpsError('invalid-argument', 'tier must be lite or pro');
    const days = Number(durationDays);
    if (!isFinite(days) || days < 1 || days > 3650) {
      throw new HttpsError('invalid-argument', 'durationDays must be 1..3650');
    }
    if (!reason || String(reason).trim().length < 4) {
      throw new HttpsError('invalid-argument', 'reason is required (min 4 chars)');
    }

    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) throw new HttpsError('not-found', 'User not found');
    const before = userSnap.data();

    const now = Date.now();
    const existingEnd = toMs(before.subscriptionPeriodEnd) || 0;
    // Extend if user is already on the same tier; otherwise start fresh.
    const baseFrom = (before.subscription === tier && existingEnd > now) ? existingEnd : now;
    const periodEnd = baseFrom + days * 24 * 3600 * 1000;

    const overrideRef = db.collection('subscription_overrides').doc();
    await db.runTransaction(async (tx) => {
      tx.update(userRef, {
        subscription: tier,
        subscriptionPeriodStart: now,
        subscriptionPeriodEnd: periodEnd,
        subscriptionAutoRenew: false,                // comps don't auto-renew
        subscriptionMethod: 'comp',
        subscriptionCompOverrideId: overrideRef.id,
      });
      tx.set(overrideRef, {
        userId, type: 'comp', tier, durationDays: days,
        expiresAt: periodEnd, reason: String(reason).slice(0, 500),
        status: 'active',
        createdBy: uid, createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('subscriptions').doc(`${userId}_${now}`), {
        userId, tier, method: 'comp',
        periodStart: now, periodEnd, status: 'active',
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('notifications').doc(), {
        recipientId: userId, type: 'subscription',
        title: `${tier === 'lite' ? 'Lite' : 'Pro'} comped`,
        body: `An admin granted you ${days} day${days === 1 ? '' : 's'} of ${tier === 'lite' ? 'Lite' : 'Pro'}.`,
        read: false, data: { tier, durationDays: days },
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    await auditAdminAction({
      actor: uid, action: 'admin_comp_user',
      target: { type: 'user', id: userId },
      before: { subscription: before.subscription, periodEnd: existingEnd },
      after:  { subscription: tier, periodEnd, overrideId: overrideRef.id },
      reason,
      stepUpEnforced: true, stepUpFresh: true,
    });

    return { ok: true, overrideId: overrideRef.id, periodEnd };
  }
);

// Apply a recurring discount — used at renewal time. Server reads remainingUses
// and discountPercent off the override at the next renewal event.
exports.adminApplyOverride = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    await requireFreshStepUp(uid);
    await adminRateLimit(uid, 'admin_apply_override', { perHour: 30, perDay: 100 });

    const { userId, tier, discountPercent, applyToCount, reason } = request.data || {};
    if (!userId) throw new HttpsError('invalid-argument', 'userId required');
    if (!['lite', 'pro'].includes(tier)) throw new HttpsError('invalid-argument', 'tier must be lite or pro');
    const pct = Number(discountPercent);
    if (!isFinite(pct) || pct < 1 || pct > 100) {
      throw new HttpsError('invalid-argument', 'discountPercent must be 1..100');
    }
    const count = Math.max(1, Math.min(36, Number(applyToCount || 1)));
    if (!reason || String(reason).trim().length < 4) {
      throw new HttpsError('invalid-argument', 'reason is required (min 4 chars)');
    }

    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) throw new HttpsError('not-found', 'User not found');

    const overrideRef = db.collection('subscription_overrides').doc();
    const expiresAt = Date.now() + count * 31 * 24 * 3600 * 1000; // safety expiry
    await overrideRef.set({
      userId, type: 'discount', tier,
      discountPercent: pct, applyToCount: count, remainingUses: count,
      expiresAt, reason: String(reason).slice(0, 500),
      status: 'active',
      createdBy: uid, createdAt: FieldValue.serverTimestamp(),
    });

    await db.collection('notifications').doc().set({
      recipientId: userId, type: 'subscription',
      title: 'Discount applied',
      body: `${pct}% off ${tier === 'lite' ? 'Lite' : 'Pro'} for your next ${count} renewal${count === 1 ? '' : 's'}.`,
      read: false, data: { tier, discountPercent: pct, applyToCount: count },
      createdAt: FieldValue.serverTimestamp(),
    });

    await auditAdminAction({
      actor: uid, action: 'admin_apply_override',
      target: { type: 'user', id: userId },
      after: { overrideId: overrideRef.id, tier, discountPercent: pct, applyToCount: count },
      reason,
      stepUpEnforced: true, stepUpFresh: true,
    });

    return { ok: true, overrideId: overrideRef.id };
  }
);

exports.adminRevokeOverride = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    await requireFreshStepUp(uid);
    await adminRateLimit(uid, 'admin_revoke_override', { perHour: 30, perDay: 100 });

    const { overrideId, reason } = request.data || {};
    if (!overrideId) throw new HttpsError('invalid-argument', 'overrideId required');
    if (!reason || String(reason).trim().length < 4) {
      throw new HttpsError('invalid-argument', 'reason is required (min 4 chars)');
    }

    const ref = db.collection('subscription_overrides').doc(overrideId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Override not found');
    const before = snap.data();
    if (before.status !== 'active') return { ok: true, noop: true };

    await db.runTransaction(async (tx) => {
      tx.update(ref, {
        status: 'revoked',
        revokedAt: FieldValue.serverTimestamp(),
        revokedBy: uid,
        revokeReason: String(reason).slice(0, 500),
      });
      // For comp overrides: also clear the user's free period.
      if (before.type === 'comp') {
        const userRef = db.collection('users').doc(before.userId);
        tx.update(userRef, {
          subscription: 'free',
          subscriptionPeriodEnd: Date.now(),
          subscriptionMethod: null,
          subscriptionCompOverrideId: null,
        });
        tx.set(db.collection('notifications').doc(), {
          recipientId: before.userId, type: 'subscription',
          title: 'Comp revoked',
          body: `Your comped ${before.tier === 'lite' ? 'Lite' : 'Pro'} access was revoked.`,
          read: false, data: { reason: String(reason).slice(0, 200) },
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    });

    await auditAdminAction({
      actor: uid, action: 'admin_revoke_override',
      target: { type: 'subscription_override', id: overrideId },
      before, after: { status: 'revoked' },
      reason,
      stepUpEnforced: true, stepUpFresh: true,
    });
    return { ok: true };
  }
);

// ════════════════════════════════════════════════════════════════════
// SETTINGS (Pass 2) — subscription-system flags on app_config/general
// ════════════════════════════════════════════════════════════════════
//
// All flags live under app_config/general.subscriptions = { ... } so we
// don't pollute the root with 8 separate fields. App Config screen still
// edits the kill-switches (which are at root level intentionally).

const SUB_SETTINGS_DEFAULTS = {
  enabled: true,
  allowFreeSignup: true,
  requirePaymentMethod: false,
  currency: 'EUR',
  trialDays: 0,
  gracePeriodDays: 3,
  checkoutMode: 'cryptomus', // 'cryptomus' | 'coins_only' | 'disabled'
};

const SUB_SETTING_VALIDATORS = {
  enabled: v => typeof v === 'boolean',
  allowFreeSignup: v => typeof v === 'boolean',
  requirePaymentMethod: v => typeof v === 'boolean',
  currency: v => typeof v === 'string' && /^[A-Z]{3}$/.test(v),
  trialDays: v => Number.isInteger(v) && v >= 0 && v <= 365,
  gracePeriodDays: v => Number.isInteger(v) && v >= 0 && v <= 60,
  checkoutMode: v => ['cryptomus', 'coins_only', 'disabled'].includes(v),
};

exports.adminGetSubscriptionSettings = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const snap = await db.collection('app_config').doc('general').get();
    const stored = (snap.exists ? snap.data() : {}).subscriptions || {};
    return { settings: { ...SUB_SETTINGS_DEFAULTS, ...stored } };
  }
);

exports.adminSetSubscriptionSettings = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    await requireFreshStepUp(uid);
    await adminRateLimit(uid, 'admin_set_subscription_settings', { perHour: 30, perDay: 100 });

    const incoming = request.data?.settings || {};
    const next = {};
    for (const [k, v] of Object.entries(incoming)) {
      const validate = SUB_SETTING_VALIDATORS[k];
      if (!validate) throw new HttpsError('invalid-argument', `Unknown setting: ${k}`);
      if (!validate(v)) throw new HttpsError('invalid-argument', `Invalid value for ${k}`);
      next[k] = v;
    }
    if (Object.keys(next).length === 0) throw new HttpsError('invalid-argument', 'No fields to update');

    const ref = db.collection('app_config').doc('general');
    const before = (await ref.get()).data()?.subscriptions || {};
    // Build the new full subscriptions object (merge defaults + before + next)
    const after = { ...SUB_SETTINGS_DEFAULTS, ...before, ...next };
    await ref.set({ subscriptions: after, _updatedAt: FieldValue.serverTimestamp(), _updatedBy: uid }, { merge: true });

    await auditAdminAction({
      actor: uid, action: 'admin_set_subscription_settings',
      target: { type: 'app_config', id: 'general' },
      before: { subscriptions: before },
      after:  { subscriptions: after },
      stepUpEnforced: true, stepUpFresh: true,
    });
    return { ok: true, settings: after };
  }
);

// ════════════════════════════════════════════════════════════════════
// LOGS (Pass 2) — subscription-system event stream
// ════════════════════════════════════════════════════════════════════
//
// Combines two sources, then unions + sorts:
//   1. admin_actions/ rows where action starts with 'admin_' AND target.type
//      is one of: plan, subscription_override, app_config (subscriptions key),
//      or action ∈ {admin_comp_user, admin_apply_override, admin_revoke_override,
//      admin_upsert_plan, admin_delete_plan, admin_schedule_price_change}
//   2. subscriptions/ rows (organic events — every renewal, comp, cancel)
//
// Returned as a single chronological feed with `source: 'admin_action' | 'subscription_event'`.

const SUB_ADMIN_ACTIONS = [
  'admin_comp_user', 'admin_apply_override', 'admin_revoke_override',
  'admin_upsert_plan', 'admin_create_plan', 'admin_update_plan',
  'admin_delete_plan', 'admin_deactivate_plan',
  'admin_schedule_price_change', 'admin_cancel_scheduled_price_change',
  'admin_set_subscription_settings', 'admin_bulk_cancel_subscriptions',
  'admin_bulk_comp_subscriptions',
];

exports.adminListSubscriptionLogs = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { limit = 50, sinceMs = null } = request.data || {};
    const lim = Math.min(200, Math.max(1, limit));
    const sinceCutoff = sinceMs ? Number(sinceMs) : Date.now() - 90 * 24 * 3600 * 1000;

    // Source 1: admin_actions filtered to subscription-relevant actions
    let actionRows = [];
    try {
      const snap = await db.collection('admin_actions')
        .where('action', 'in', SUB_ADMIN_ACTIONS)
        .orderBy('createdAt', 'desc')
        .limit(lim)
        .get();
      actionRows = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id, source: 'admin_action',
          createdAt: toMs(data.createdAt),
          action: data.action,
          actorUid: data.actor || null,
          target: data.target || null,
          reason: data.reason || null,
        };
      });
    } catch { /* index may be missing — fall through */ }

    // Source 2: subscriptions/ — organic events
    let subRows = [];
    try {
      const snap = await db.collection('subscriptions')
        .where('createdAt', '>=', sinceCutoff)
        .orderBy('createdAt', 'desc')
        .limit(lim)
        .get();
      subRows = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id, source: 'subscription_event',
          createdAt: toMs(data.createdAt) || data.createdAt,
          action: data.method === 'cancellation' ? 'cancelled' :
                  data.method === 'comp'         ? 'comped'    :
                  data.method === 'coins'        ? 'subscribed_with_coins' :
                  data.method === 'card'         ? 'subscribed_with_card'  :
                                                   data.method || 'event',
          actorUid: data.userId || null,
          target: { type: 'user', id: data.userId },
          tier: data.tier,
          coinsCharged: data.coinsCharged ?? null,
        };
      });
    } catch { /* might be empty */ }

    // Union + sort desc, cap at limit
    const merged = [...actionRows, ...subRows]
      .filter(r => r.createdAt)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, lim);

    // Hydrate actors
    const uids = [...new Set(merged.map(r => r.actorUid).filter(Boolean))];
    const profiles = {};
    if (uids.length > 0) {
      const snaps = await Promise.all(uids.map(u => db.collection('users').doc(u).get()));
      snaps.forEach((s, i) => {
        if (s.exists) {
          const p = s.data();
          profiles[uids[i]] = {
            displayName: p.displayName || null,
            username: p.username || null,
            avatar: p.avatar || null,
          };
        }
      });
    }
    return { rows: merged.map(r => ({ ...r, actor: profiles[r.actorUid] || null })) };
  }
);

// ════════════════════════════════════════════════════════════════════
// BULK ACTIONS (Pass 2)
// ════════════════════════════════════════════════════════════════════

exports.adminBulkCancelSubscriptions = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    await requireFreshStepUp(uid);
    await adminRateLimit(uid, 'admin_bulk_cancel_subscriptions', { perHour: 5, perDay: 20 });

    const { userIds = [], reason } = request.data || {};
    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new HttpsError('invalid-argument', 'userIds must be a non-empty array');
    }
    if (userIds.length > 50) throw new HttpsError('invalid-argument', 'Max 50 per call');
    if (!reason || String(reason).trim().length < 4) {
      throw new HttpsError('invalid-argument', 'reason is required (min 4 chars)');
    }

    const results = await Promise.allSettled(userIds.map(async (userId) => {
      const ref = db.collection('users').doc(userId);
      const snap = await ref.get();
      if (!snap.exists) throw new Error('not found');
      const before = snap.data();
      if (!['lite', 'pro'].includes(before.subscription)) {
        return { userId, skipped: true, reason: 'not a paid user' };
      }
      await ref.update({ subscriptionAutoRenew: false, subscriptionCancelledAt: Date.now() });
      await db.collection('subscriptions').doc(`${userId}_${Date.now()}`).set({
        userId, tier: before.subscription, method: 'cancellation',
        cancelledBy: uid, reason: String(reason).slice(0, 500),
        createdAt: FieldValue.serverTimestamp(),
      });
      await db.collection('notifications').doc().set({
        recipientId: userId, type: 'subscription',
        title: 'Subscription cancelled',
        body: `Your ${before.subscription === 'lite' ? 'Lite' : 'Pro'} subscription will not renew.`,
        read: false, createdAt: FieldValue.serverTimestamp(),
      });
      return { userId, ok: true };
    }));

    const succeeded = results.filter(r => r.status === 'fulfilled' && !r.value?.skipped).length;
    const skipped   = results.filter(r => r.status === 'fulfilled' && r.value?.skipped).length;
    const failed    = results.filter(r => r.status === 'rejected').length;

    await auditAdminAction({
      actor: uid, action: 'admin_bulk_cancel_subscriptions',
      target: { type: 'users', id: `bulk_${userIds.length}` },
      after: { succeeded, skipped, failed, userIds },
      reason,
      stepUpEnforced: true, stepUpFresh: true,
    });
    return { ok: true, succeeded, skipped, failed };
  }
);

exports.adminBulkCompSubscriptions = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    await requireFreshStepUp(uid);
    await adminRateLimit(uid, 'admin_bulk_comp_subscriptions', { perHour: 5, perDay: 20 });

    const { userIds = [], tier, durationDays, reason } = request.data || {};
    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new HttpsError('invalid-argument', 'userIds must be a non-empty array');
    }
    if (userIds.length > 50) throw new HttpsError('invalid-argument', 'Max 50 per call');
    if (!['lite', 'pro'].includes(tier)) throw new HttpsError('invalid-argument', 'tier must be lite or pro');
    const days = Number(durationDays);
    if (!isFinite(days) || days < 1 || days > 3650) {
      throw new HttpsError('invalid-argument', 'durationDays must be 1..3650');
    }
    if (!reason || String(reason).trim().length < 4) {
      throw new HttpsError('invalid-argument', 'reason is required (min 4 chars)');
    }

    const now = Date.now();
    const results = await Promise.allSettled(userIds.map(async (userId) => {
      const userRef = db.collection('users').doc(userId);
      const userSnap = await userRef.get();
      if (!userSnap.exists) throw new Error('not found');
      const before = userSnap.data();
      const existingEnd = toMs(before.subscriptionPeriodEnd) || 0;
      const baseFrom = (before.subscription === tier && existingEnd > now) ? existingEnd : now;
      const periodEnd = baseFrom + days * 24 * 3600 * 1000;

      const overrideRef = db.collection('subscription_overrides').doc();
      await db.runTransaction(async (tx) => {
        tx.update(userRef, {
          subscription: tier,
          subscriptionPeriodStart: now,
          subscriptionPeriodEnd: periodEnd,
          subscriptionAutoRenew: false,
          subscriptionMethod: 'comp',
          subscriptionCompOverrideId: overrideRef.id,
        });
        tx.set(overrideRef, {
          userId, type: 'comp', tier, durationDays: days,
          expiresAt: periodEnd, reason: String(reason).slice(0, 500),
          status: 'active', createdBy: uid, createdAt: FieldValue.serverTimestamp(),
        });
        tx.set(db.collection('subscriptions').doc(`${userId}_${now}`), {
          userId, tier, method: 'comp',
          periodStart: now, periodEnd, status: 'active',
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.set(db.collection('notifications').doc(), {
          recipientId: userId, type: 'subscription',
          title: `${tier === 'lite' ? 'Lite' : 'Pro'} comped`,
          body: `Admin granted you ${days} day${days === 1 ? '' : 's'} of ${tier === 'lite' ? 'Lite' : 'Pro'}.`,
          read: false, createdAt: FieldValue.serverTimestamp(),
        });
      });
      return { userId, overrideId: overrideRef.id };
    }));

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed    = results.filter(r => r.status === 'rejected').length;

    await auditAdminAction({
      actor: uid, action: 'admin_bulk_comp_subscriptions',
      target: { type: 'users', id: `bulk_${userIds.length}` },
      after: { succeeded, failed, tier, durationDays: days, userIds },
      reason,
      stepUpEnforced: true, stepUpFresh: true,
    });
    return { ok: true, succeeded, failed };
  }
);
