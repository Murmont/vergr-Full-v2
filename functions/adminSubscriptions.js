// adminSubscriptions.js — Admin → Subscriptions screen callables.
//
// Data model (functions/subscriptions.js, payram.js, playBilling.js, huaweiBilling.js):
//   users/{uid}.subscription                ∈ 'free'|'lite'|'pro'
//   users/{uid}.subscriptionPeriodStart     millis
//   users/{uid}.subscriptionPeriodEnd       millis
//   users/{uid}.subscriptionAutoRenew       bool
//   users/{uid}.subscriptionPreferredMethod 'coins'|'card'|'google_play'|'huawei_iap'|'comp'
//   subscriptions/{uid}_{ts}                one row per period granted, by every rail
//                                            { userId, tier, method, coinsCharged?, amountUSD?,
//                                              periodStart, periodEnd, createdAt }
//
// ⚠ 2026-09-21: everything here that did nothing was removed or made real.
// The "invoices" tab read a collection nothing writes; it is now the payments
// ledger built from subscriptions/. The Plans editor saved prices nothing
// charges (the real prices are tierSystem.js, payram.js and the store consoles),
// so Plans is read-only in the app and its callables are gone. The discount
// override was never applied at renewal while telling the user it would be;
// gone. Settings now holds only switches that are enforced
// (functions/subscriptionSettings.js).

const functions = require('firebase-functions/v2');
const { getFirestore, AggregateField, FieldValue } = require('firebase-admin/firestore');
const { authEmailsFor } = require('./authEmails');
const { requireAdminScreen } = require('./adminAccess');
const { requireFreshStepUp, adminRateLimit, auditAdminAction } = require('./adminSecurity');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

// LIST prices in USD, as printed on the plan cards (src/utils/tierSystem.js).
// What a buyer pays depends on the rail: coins (PRICE_COINS), the card checkout
// (a regional EUR base converted to USD, functions/payram.js), or the per-market
// store price in Play Console / AppGallery. So every money figure built from
// these is shown as "at list price", never as revenue.
const PRICE_USD = { lite: 4.99, pro: 9.99 };
const PRICE_COINS = { lite: 500, pro: 1000 };

// Rails that take money. 'comp' and 'cancellation' rows are admin actions.
const PAYMENT_METHODS = ['coins', 'card', 'google_play', 'huawei_iap'];

// createdAt on subscriptions/ is a server Timestamp. A range filter against a
// plain number matches NOTHING (Firestore ranges never cross types), which is
// why "New (7d)" and the trend chart could only ever read 0.
const tsFrom = (ms) => new Date(ms);

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
      db.collection('subscriptions').where('createdAt', '>=', tsFrom(weekAgo)).count().get()
        .then(r => r.data().count).catch(() => 0),
      // New subscriptions in last 30 days
      db.collection('subscriptions').where('createdAt', '>=', tsFrom(monthAgo)).count().get()
        .then(r => r.data().count).catch(() => 0),
      // Cancelled last 30 days = users with subscription=free who had a sub row in the last month
      // (approximation; full churn calc needs status field on the audit row)
      db.collection('subscriptions').where('createdAt', '>=', tsFrom(monthAgo)).where('method', '==', 'cancellation').count().get()
        .then(r => r.data().count).catch(() => 0),
    ]);

    const lite = liteCount?.count ?? 0;
    const pro  = proCount?.count  ?? 0;
    const active = lite + pro;
    // At LIST price. See PRICE_USD: store and card buyers pay other amounts.
    const mrrUSD = +(lite * PRICE_USD.lite + pro * PRICE_USD.pro).toFixed(2);
    const arrUSD = +(mrrUSD * 12).toFixed(2);

    // Who pays how. subscriptionPreferredMethod is the canonical rail field;
    // count queries cost one read per 1,000 matches.
    const railCount = (m) => users.where('subscription', 'in', ['lite', 'pro'])
      .where('subscriptionPreferredMethod', '==', m).count().get()
      .then(r => r.data().count).catch(() => 0);
    const railIds = [...PAYMENT_METHODS, 'comp'];
    const railCounts = await Promise.all(railIds.map(railCount));
    const byRail = Object.fromEntries(railIds.map((m, i) => [m, railCounts[i]]));

    return {
      activeSubscriptions: active,
      liteCount: lite,
      proCount: pro,
      freeCount: freeCount?.count ?? 0,
      newWeek,
      newMonth,
      cancelledMonth,
      mrrUSD,
      arrUSD,
      byRail,
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
      .where('createdAt', '>=', tsFrom(startMs))
      .orderBy('createdAt', 'asc')
      .limit(2000)
      .get()
      .catch(() => ({ docs: [] }));

    // Bucket by yyyy-mm-dd
    const buckets = {};
    snap.docs.forEach(d => {
      const data = d.data();
      if (data.method === 'cancellation') return; // a cancellation is not a new plan
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
      const [snaps, emails] = await Promise.all([
        Promise.all(uids.map(u => db.collection('users').doc(u).get())),
        authEmailsFor(uids), // sign-up emails live in Auth, not on the profile doc
      ]);
      snaps.forEach((s, i) => {
        if (s.exists) {
          const p = s.data();
          profiles[uids[i]] = {
            displayName: p.displayName || null,
            username: p.username || null,
            avatar: p.avatar || null,
            email: emails[uids[i]] || null,
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
    // At list price, averaged across plans: an estimate, labelled as one.
    const avg = (PRICE_USD.lite + PRICE_USD.pro) / 2;
    return {
      today:        { count: today, estimatedUSD: +(today * avg).toFixed(2) },
      thisWeek:     { count: week,  estimatedUSD: +(week  * avg).toFixed(2) },
      thisMonth:    { count: month, estimatedUSD: +(month * avg).toFixed(2) },
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
    const emails = await authEmailsFor(snap.docs.map(d => d.id));
    const rows = snap.docs
      .filter(d => {
        if (!search) return true;
        const data = d.data();
        const s = search.toLowerCase();
        return (data.username || '').toLowerCase().includes(s) ||
               (data.displayName || '').toLowerCase().includes(s) ||
               (emails[d.id] || '').toLowerCase().includes(s);
      })
      .map(d => {
        const u = d.data();
        return {
          id: d.id,
          username: u.username || null,
          displayName: u.displayName || null,
          email: emails[d.id] || null,
          avatar: u.avatar || null,
          tier: u.subscription,
          periodStart: toMs(u.subscriptionPeriodStart),
          periodEnd: toMs(u.subscriptionPeriodEnd),
          autoRenew: !!u.subscriptionAutoRenew,
          method: u.subscriptionPreferredMethod || u.subscriptionMethod || null,
          status: u.subscriptionStatus || 'active',
          listPriceUSD: PRICE_USD[u.subscription] || 0,
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
// PAYMENTS (the tab once called "Billing & Invoices")
// ════════════════════════════════════════════════════════════════════
//
// ⚠ Vergr issues no invoices, and nothing ever wrote the `invoices` collection
// this tab used to read, so it was permanently empty. The real record of a
// subscription payment is the subscriptions/{uid}_{ts} row every rail writes
// when it grants a period:
//   coins        subscriptions.js   subscribeWithCoins + coin auto-renewals
//   card         payram.js          settled PayRam order (amountUSD from 2026-09-21)
//   google_play  playBilling.js     redeemPlaySubscription
//   huawei_iap   huaweiBilling.js   redeemHuaweiSubscription (from 2026-09-21)
// The stores never tell us the price a buyer paid (it is set per market), so a
// store row carries the plan and the rail and NEVER an invented amount.
// Callable names are unchanged on purpose: a renamed callable is a new Cloud
// Function, and a new function is a new container image, i.e. money.

async function hydrateUsers(uids) {
  const out = {};
  const ids = [...new Set(uids.filter(Boolean))];
  if (!ids.length) return out;
  const [snaps, emails] = await Promise.all([
    Promise.all(ids.map(u => db.collection('users').doc(u).get())),
    authEmailsFor(ids), // sign-up emails live in Auth, not on the profile doc
  ]);
  snaps.forEach((snap, i) => {
    const p = snap.exists ? snap.data() : {};
    out[ids[i]] = {
      displayName: p.displayName || null,
      username: p.username || null,
      avatar: p.avatar || null,
      email: emails[ids[i]] || null,
    };
  });
  return out;
}

function paymentRow(id, d) {
  const method = d.method || null;
  let amount = null;
  if (method === 'coins') amount = { kind: 'coins', value: Number(d.coinsCharged) || 0 };
  else if (method === 'card' && typeof d.amountUSD === 'number') amount = { kind: 'usd', value: d.amountUSD };
  else if (method === 'google_play' || method === 'huawei_iap') amount = { kind: 'store' };
  return {
    id,
    userId: d.userId || null,
    tier: d.tier || null,
    method,
    amount,
    renewal: !!d.renewal,
    periodStart: toMs(d.periodStart),
    periodEnd: toMs(d.periodEnd),
    createdAt: toMs(d.createdAt),
  };
}

exports.adminGetBillingStats = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);

    const now = Date.now();
    const m = new Date(now);
    const monthStartMs = Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), 1);

    // One range, no composite index: this month's rows, grouped in memory.
    // Reads scale with payments made this month, which is the thing counted.
    const snap = await db.collection('subscriptions')
      .where('createdAt', '>=', tsFrom(monthStartMs))
      .limit(5000)
      .get()
      .catch(() => ({ docs: [] }));

    const byMethod = Object.fromEntries(PAYMENT_METHODS.map((k) => [k, { count: 0 }]));
    byMethod.coins.coins = 0;
    byMethod.card.usd = 0;
    let payments = 0;
    for (const doc of snap.docs) {
      const d = doc.data();
      if (!PAYMENT_METHODS.includes(d.method)) continue;
      payments += 1;
      byMethod[d.method].count += 1;
      if (d.method === 'coins') byMethod.coins.coins += Number(d.coinsCharged) || 0;
      if (d.method === 'card' && typeof d.amountUSD === 'number') byMethod.card.usd += d.amountUSD;
    }
    byMethod.card.usd = +byMethod.card.usd.toFixed(2);

    return { monthStartMs, payments, byMethod, capped: snap.docs.length >= 5000, asOf: now };
  }
);

exports.adminListInvoices = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { filters = {}, cursor = null, pageSize = 25 } = request.data || {};
    const limit = Math.min(100, Math.max(1, pageSize));
    const method = PAYMENT_METHODS.includes(filters.method) ? filters.method : null;
    const tier = ['lite', 'pro'].includes(filters.tier) ? filters.tier : null;

    // Filtered in memory rather than by a composite index: over-fetch in pages
    // until the page is full or the collection runs out. Admin-only, small.
    const rows = [];
    let after = null;
    if (cursor) {
      const cs = await db.collection('subscriptions').doc(cursor).get();
      if (cs.exists) after = cs;
    }
    let exhausted = false;
    for (let round = 0; round < 6 && rows.length < limit && !exhausted; round += 1) {
      let q = db.collection('subscriptions').orderBy('createdAt', 'desc').limit(limit * 2);
      if (after) q = q.startAfter(after);
      const snap = await q.get().catch(() => ({ docs: [] }));
      if (snap.docs.length < limit * 2) exhausted = true;
      for (const doc of snap.docs) {
        after = doc;
        const d = doc.data();
        if (!PAYMENT_METHODS.includes(d.method)) continue;
        if (method && d.method !== method) continue;
        if (tier && d.tier !== tier) continue;
        rows.push(paymentRow(doc.id, d));
        if (rows.length >= limit) break;
      }
    }

    const users = await hydrateUsers(rows.map(r => r.userId));
    const nextCursor = rows.length >= limit && after ? after.id : null;
    return {
      rows: rows.map(r => ({ ...r, user: users[r.userId] || null })),
      nextCursor,
    };
  }
);

// PLANS & PRICING callables (adminListPlans, adminUpsertPlan, adminDeletePlan,
// adminSchedulePriceChange, adminCancelScheduledPriceChange) and the daily
// applyScheduledPriceChanges job were DELETED 2026-09-21. They edited a
// plans/ collection that no checkout ever read, so a "price change" changed
// nothing a buyer paid. The Plans tab now renders the real prices straight
// from src/utils/tierSystem.js.

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
      const [snaps, emails] = await Promise.all([
        Promise.all(uids.map(u => db.collection('users').doc(u).get())),
        authEmailsFor(uids), // sign-up emails live in Auth, not on the profile doc
      ]);
      snaps.forEach((s, i) => {
        if (s.exists) {
          const p = s.data();
          profiles[uids[i]] = {
            displayName: p.displayName || null,
            username: p.username || null,
            avatar: p.avatar || null,
            email: emails[uids[i]] || null,
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
        // The CANONICAL rail field. Without it a comp given to someone whose
        // last plan came from Google Play keeps 'google_play' here, and the
        // daily Play sync then applies the lapsed Play subscription and ends
        // the comp.
        subscriptionPreferredMethod: 'comp',
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

    // Plan bonus for the comped period, now (functions/planBonus.js).
    await require('./planBonus').grantPlanBonus(db, userId, tier, periodEnd, 'comp');

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

// adminApplyOverride (per-user renewal discount) DELETED 2026-09-21. No renewal
// path ever read the override, yet the user was notified of a discount, so it
// promised money off that never came. A discount on a Play or AppGallery plan
// is not ours to give anyway: the store sets that price.

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
          subscriptionPreferredMethod: null,
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
// Only switches that something enforces live here now: see
// functions/subscriptionSettings.js for what reads each one.

const {
  SUBSCRIPTION_SETTINGS_DEFAULTS, MAX_GRACE_DAYS, normaliseSubscriptionSettings,
} = require('./subscriptionSettings');

const SUB_SETTING_VALIDATORS = {
  newSubscriptionsPaused: v => typeof v === 'boolean',
  gracePeriodDays: v => Number.isInteger(v) && v >= 0 && v <= MAX_GRACE_DAYS,
};

exports.adminGetSubscriptionSettings = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const snap = await db.collection('app_config').doc('general').get();
    return { settings: normaliseSubscriptionSettings((snap.exists ? snap.data() : {}).subscriptions) };
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
    const after = { ...SUBSCRIPTION_SETTINGS_DEFAULTS, ...normaliseSubscriptionSettings(before), ...next };
    // update(), not set(merge): it REPLACES the map, which is what drops the
    // seven retired flags (EUR, Cryptomus, trials...) still sitting in it.
    await ref.update({ subscriptions: after, _updatedAt: FieldValue.serverTimestamp(), _updatedBy: uid });

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
          subscriptionPreferredMethod: 'comp', // canonical rail field, see adminCompUser
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
      await require('./planBonus').grantPlanBonus(db, userId, tier, periodEnd, 'comp');
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
