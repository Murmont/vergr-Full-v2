// adminEconomy.js — server callables for the Admin → Economy screen.
//
// Every callable goes through `requireAdminScreen('economy')` so sub-admins
// with the economy scope can use this without being founder. Destructive
// money-moving actions also require a fresh TOTP step-up.
//
// Callables:
//   adminGetEconomyStats        — KPI counts (coins/gems/VP in circulation, pending withdrawals, total paid)
//   adminListTopWallets         — top earners by coins / gems
//   adminGrantCoins             — credit user wallet + ledger entry
//   adminGrantVp                — credit user VP + ledger entry
//   adminGrantGems              — credit gems (rare; usually admin reversal of a fee)
//   adminDeductCoins            — debit user wallet (corrections, anti-fraud)
//   adminListTransactions       — paginated transactions ledger
//   adminListPayoutRequests     — payout queue
//   adminUpdatePayoutStatus     — flip a payout status (approve / mark paid / reject)
//                                  Rejecting a queued withdrawal returns the held gems
//                                  to the user wallet. There is no concept of refunding
//                                  an already-sent withdrawal — once funds are out, they
//                                  are out. Sent payouts can only be left as-is.
//   adminGetEconomyConfig       — current app_config/general economy flags
//   adminSetEconomyConfig       — update flags (free uploads paused, etc.)

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue, AggregateField } = require('firebase-admin/firestore');
const {
  requireFreshStepUp,
  adminRateLimit,
  auditAdminAction,
  extractRequestMeta,
} = require('./adminSecurity');
const { requireAdminScreen } = require('./adminAccess');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

async function guardCaller(uid, { requireStepUp = false } = {}) {
  await requireAdminScreen(uid, 'economy');
  if (requireStepUp) await requireFreshStepUp(uid);
}

const toMs = (t) => t && typeof t.toMillis === 'function' ? t.toMillis() : null;

// ════════════════════════════════════════════════════════════════════
// READ — stats / lists
// ════════════════════════════════════════════════════════════════════

exports.adminGetEconomyStats = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);

    const wallets = db.collection('wallets');
    const payouts = db.collection('payout_requests');

    // Defensive: aggregate sums may fail if collection is empty / fields missing.
    const safeAgg = async (q, fields) => {
      try {
        const r = await q.aggregate(fields).get();
        return r.data();
      } catch (e) { return null; }
    };

    const [coinSum, gemSum, vpSum, pendingSum, paidSum, payoutsCount] = await Promise.all([
      safeAgg(wallets, { total: AggregateField.sum('balance'), count: AggregateField.count() }),
      safeAgg(wallets, { total: AggregateField.sum('gems') }),
      safeAgg(wallets, { total: AggregateField.sum('vp') }),
      // Phase 4 status names: `pending`, `processing`. Keep legacy `requested`/
      // `on_hold`/`ready`/`queued_placeholder` so older test rows still count.
      safeAgg(payouts.where('status', 'in', ['pending', 'requested', 'on_hold', 'ready', 'processing', 'queued_placeholder']),
              { total: AggregateField.sum('gemsRequested'), count: AggregateField.count() }),
      // `netUSDC` is the actual EUR-equivalent the user receives (gems - 2% spread).
      // Legacy rows wrote `amountEUR`; we sum both via two queries below.
      safeAgg(payouts.where('status', '==', 'sent'),
              { totalNet: AggregateField.sum('netMicroUSDC'), totalLegacy: AggregateField.sum('amountEUR'), count: AggregateField.count() }),
      payouts.count().get().then(r => r.data().count).catch(() => 0),
    ]);

    return {
      coinsInCirculation:  coinSum?.total ?? 0,
      gemsInCirculation:   gemSum?.total  ?? 0,
      vpInCirculation:     vpSum?.total   ?? 0,
      walletCount:         coinSum?.count ?? 0,
      gemsPendingPayout:   pendingSum?.total ?? 0,
      pendingPayoutCount:  pendingSum?.count ?? 0,
      // Sum net USDC across paid withdrawals. Phase 4 rows use `netMicroUSDC`
      // (integer micro-USDC). Legacy rows used `amountEUR` (float EUR). Combine.
      totalPaidEUR:        ((paidSum?.totalNet || 0) / 1e6) + (paidSum?.totalLegacy || 0),
      totalPayoutsCount:   paidSum?.count ?? 0,
      allPayoutRequestsCount: payoutsCount,
    };
  }
);

exports.adminListTopWallets = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { sortBy = 'balance', limit = 10 } = request.data || {};
    const allowed = ['balance', 'gems', 'vp', 'totalEarned'];
    if (!allowed.includes(sortBy)) {
      throw new HttpsError('invalid-argument', `sortBy must be one of: ${allowed.join(', ')}`);
    }
    const snap = await db.collection('wallets')
      .orderBy(sortBy, 'desc')
      .limit(Math.min(Number(limit), 50))
      .get();

    // Hydrate with display name + avatar.
    const rows = await Promise.all(snap.docs.map(async (d) => {
      const u = await db.collection('users').doc(d.id).get().catch(() => null);
      const ud = u?.exists ? u.data() : {};
      return {
        uid: d.id,
        balance: d.data().balance || 0,
        gems: d.data().gems || 0,
        vp: d.data().vp || 0,
        totalEarned: d.data().totalEarned || 0,
        displayName: ud.displayName || ud.username || '(no name)',
        username: ud.username || null,
        avatar: ud.avatar || null,
      };
    }));
    return { rows };
  }
);

exports.adminListTransactions = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { targetUid, type, currency, cursor, pageSize = 30 } = request.data || {};
    let q = db.collection('transactions');
    if (targetUid) q = q.where('userId', '==', targetUid);
    if (type)      q = q.where('type', '==', type);
    if (currency)  q = q.where('currency', '==', currency);
    q = q.orderBy('createdAt', 'desc');
    if (cursor) q = q.startAfter(new Date(cursor));
    q = q.limit(Math.min(Number(pageSize), 100));

    const snap = await q.get();
    const rows = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
      createdAt: toMs(d.data().createdAt),
    }));
    // Hydrate user names for the unique uid set.
    const uids = [...new Set(rows.map(r => r.userId).filter(Boolean))];
    const users = {};
    await Promise.all(uids.map(async (u) => {
      try {
        const us = await db.collection('users').doc(u).get();
        if (us.exists) users[u] = {
          displayName: us.data().displayName || us.data().username || u.slice(0, 6),
          username: us.data().username || null,
          avatar: us.data().avatar || null,
        };
      } catch {}
    }));
    const nextCursor = snap.docs.length === Number(pageSize) ? toMs(snap.docs[snap.docs.length - 1].data().createdAt) : null;
    return { rows, users, nextCursor };
  }
);

exports.adminListPayoutRequests = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { status, cursor, pageSize = 25 } = request.data || {};
    let q = db.collection('payout_requests');
    if (status && status !== 'all') q = q.where('status', '==', status);
    // Phase 4 schema uses requestedAt; older placeholder rows may have createdAt.
    // Order by requestedAt with a fallback in row hydration below.
    q = q.orderBy('requestedAt', 'desc');
    if (cursor) q = q.startAfter(new Date(cursor));
    q = q.limit(Math.min(Number(pageSize), 100));

    const snap = await q.get();
    const rows = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        // Field name harmonization: Phase 4 writes `userId`, legacy rows wrote `uid`.
        uid: data.userId || data.uid || null,
        createdAt: toMs(data.requestedAt || data.createdAt),
        requestedAt: toMs(data.requestedAt),
        releasesAt: toMs(data.releasesAt),
        cancelDeadline: toMs(data.cancelDeadline),
        sentAt: toMs(data.sentAt),
        cancelledAt: toMs(data.cancelledAt),
        failedAt: toMs(data.failedAt),
      };
    });
    const uids = [...new Set(rows.map(r => r.uid).filter(Boolean))];
    const users = {};
    await Promise.all(uids.map(async (u) => {
      try {
        const us = await db.collection('users').doc(u).get();
        if (us.exists) users[u] = {
          displayName: us.data().displayName || us.data().username || u.slice(0, 6),
          username: us.data().username || null,
          avatar: us.data().avatar || null,
          email: us.data().email || null,
        };
      } catch {}
    }));
    const nextCursor = snap.docs.length === Number(pageSize) ? toMs(snap.docs[snap.docs.length - 1].data().createdAt) : null;
    return { rows, users, nextCursor };
  }
);

// ════════════════════════════════════════════════════════════════════
// WRITE — grants / deductions
// ════════════════════════════════════════════════════════════════════

async function grantCurrency({ callerUid, targetUid, amount, currency, reason, type, ip, userAgent }) {
  if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');
  if (!Number.isFinite(amount) || amount === 0) {
    throw new HttpsError('invalid-argument', 'amount must be a non-zero number.');
  }
  const fieldMap = { coins: 'balance', gems: 'gems', vp: 'vp' };
  const totalMap = { coins: 'totalEarned', gems: 'totalGemsEarned', vp: null };
  const field = fieldMap[currency];
  if (!field) throw new HttpsError('invalid-argument', 'currency must be coins/gems/vp.');

  const walletRef = db.collection('wallets').doc(targetUid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(walletRef);
    const cur = snap.exists ? (snap.data()[field] || 0) : 0;
    if (cur + amount < 0) {
      throw new HttpsError('failed-precondition', `Insufficient ${currency}: balance would go negative.`);
    }
    const updates = {
      [field]: FieldValue.increment(amount),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (amount > 0 && totalMap[currency]) {
      updates[totalMap[currency]] = FieldValue.increment(amount);
    }
    tx.set(walletRef, updates, { merge: true });

    tx.set(db.collection('transactions').doc(), {
      userId: targetUid,
      type,
      amount,
      currency,
      description: reason || `Admin ${amount > 0 ? 'grant' : 'deduction'} of ${Math.abs(amount)} ${currency}`,
      meta: { adminUid: callerUid },
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  // Notify the user.
  await db.collection('notifications').add({
    recipientId: targetUid,
    type: amount > 0 ? 'admin_grant' : 'admin_deduction',
    title: amount > 0
      ? `+${amount.toLocaleString()} ${currency} from admin`
      : `${amount.toLocaleString()} ${currency} adjustment`,
    body: reason || (amount > 0 ? 'Manual grant.' : 'Manual deduction.'),
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  await auditAdminAction({
    actor: callerUid,
    action: amount > 0 ? `admin_grant_${currency}` : `admin_deduct_${currency}`,
    target: { type: 'user', id: targetUid },
    after: { amount, currency },
    reason: String(reason || '').slice(0, 400),
    ip, userAgent,
    stepUpEnforced: true, stepUpFresh: true,
  });
}

exports.adminGrantCoins = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_grant_coins', { perHour: 30, perDay: 100, perMonth: 500 });
    const { targetUid, amount, reason = '' } = request.data || {};
    const amt = Math.floor(Number(amount));
    if (!reason.trim()) throw new HttpsError('invalid-argument', 'reason required.');
    if (Math.abs(amt) > 1_000_000) throw new HttpsError('invalid-argument', 'Max 1,000,000 coins per grant.');
    const meta = extractRequestMeta(request);
    await grantCurrency({ callerUid: uid, targetUid, amount: amt, currency: 'coins', reason, type: 'admin_grant', ...meta });
    return { ok: true };
  }
);

exports.adminGrantVp = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_grant_vp', { perHour: 30, perDay: 100, perMonth: 500 });
    const { targetUid, amount, reason = '' } = request.data || {};
    const amt = Math.floor(Number(amount));
    if (!reason.trim()) throw new HttpsError('invalid-argument', 'reason required.');
    if (Math.abs(amt) > 100_000) throw new HttpsError('invalid-argument', 'Max 100,000 VP per grant.');
    const meta = extractRequestMeta(request);
    await grantCurrency({ callerUid: uid, targetUid, amount: amt, currency: 'vp', reason, type: 'admin_grant', ...meta });
    return { ok: true };
  }
);

exports.adminGrantGems = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_grant_gems', { perHour: 10, perDay: 30, perMonth: 100 });
    const { targetUid, amount, reason = '' } = request.data || {};
    const amt = Math.floor(Number(amount));
    if (!reason.trim()) throw new HttpsError('invalid-argument', 'reason required.');
    if (Math.abs(amt) > 100_000) throw new HttpsError('invalid-argument', 'Max 100,000 gems per grant.');
    const meta = extractRequestMeta(request);
    await grantCurrency({ callerUid: uid, targetUid, amount: amt, currency: 'gems', reason, type: 'admin_grant', ...meta });
    return { ok: true };
  }
);

exports.adminDeductCoins = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_deduct_coins', { perHour: 20, perDay: 50 });
    const { targetUid, amount, reason = '' } = request.data || {};
    const amt = Math.floor(Number(amount));
    if (!reason.trim()) throw new HttpsError('invalid-argument', 'reason required.');
    if (amt <= 0) throw new HttpsError('invalid-argument', 'amount must be > 0 (deduction).');
    if (amt > 1_000_000) throw new HttpsError('invalid-argument', 'Max 1,000,000 coins per deduction.');
    const meta = extractRequestMeta(request);
    await grantCurrency({ callerUid: uid, targetUid, amount: -amt, currency: 'coins', reason, type: 'admin_deduction', ...meta });
    return { ok: true };
  }
);

// ════════════════════════════════════════════════════════════════════
// PAYOUT QUEUE — approve / reject / mark paid / refund
// ════════════════════════════════════════════════════════════════════

// Phase 4 schema uses `pending` (instead of separate `requested`/`on_hold`)
// and adds terminal states `cancelled` + `failed`. Admin can still take
// manual action — useful when the automated cron is stuck or for support
// overrides. `reject` here maps to the same effect as the user-side
// `cancelWithdrawal` callable (status=cancelled + gem refund).
const PAYOUT_ALLOWED_TRANSITIONS = {
  approve:         { from: ['pending', 'requested', 'on_hold', 'queued_placeholder'],         to: 'ready' },
  mark_processing: { from: ['pending', 'ready', 'requested', 'queued_placeholder'],           to: 'processing' },
  mark_paid:       { from: ['processing', 'ready', 'pending', 'queued_placeholder', 'requested'], to: 'sent' },
  reject:          { from: ['pending', 'requested', 'on_hold', 'ready', 'processing', 'queued_placeholder'], to: 'cancelled' },
};

exports.adminUpdatePayoutStatus = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_payout_status', { perHour: 60, perDay: 300 });

    const { payoutId, action, reason = '', txHash = null } = request.data || {};
    if (!payoutId || !action) throw new HttpsError('invalid-argument', 'payoutId + action required.');
    const cfg = PAYOUT_ALLOWED_TRANSITIONS[action];
    if (!cfg) throw new HttpsError('invalid-argument', `action must be one of: ${Object.keys(PAYOUT_ALLOWED_TRANSITIONS).join(', ')}`);

    const ref = db.collection('payout_requests').doc(payoutId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Payout not found.');
    const p = snap.data();
    if (!cfg.from.includes(p.status)) {
      throw new HttpsError('failed-precondition', `Cannot ${action} a payout in status "${p.status}".`);
    }

    const update = {
      status: cfg.to,
      [`${action}At`]: FieldValue.serverTimestamp(),
      [`${action}By`]: uid,
    };
    if (reason)  update.adminNote = String(reason).slice(0, 400);
    if (txHash)  update.txHash = String(txHash).slice(0, 200);

    // If cancelling a queued withdrawal, return the held gems to the user wallet.
    // (Withdrawal requests debit the wallet at request time — cancelling means
    // the withdrawal didn't happen, so the user keeps their gems. This is NOT a
    // refund, since refunds don't exist on this platform.)
    // Field harmonization: Phase 4 writes `userId`; legacy rows wrote `uid`.
    const targetUid = p.userId || p.uid;
    if (action === 'reject' && targetUid && p.gemsRequested) {
      await db.runTransaction(async (tx) => {
        const walletRef = db.collection('wallets').doc(targetUid);
        tx.update(walletRef, {
          gems: FieldValue.increment(Number(p.gemsRequested) || 0),
          gemsInEscrow: FieldValue.increment(-(Number(p.gemsRequested) || 0)),
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.set(db.collection('transactions').doc(), {
          userId: targetUid, type: 'withdrawal_cancelled',
          amount: Number(p.gemsRequested) || 0,
          currency: 'gems',
          description: `Withdrawal #${payoutId.slice(0, 8)} cancelled by admin — gems returned`,
          meta: { payoutId, reason: String(reason).slice(0, 400), adminUid: uid },
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.update(ref, update);
      });
    } else {
      await ref.update(update);
    }

    if (targetUid) {
      const titles = {
        approve: 'Your withdrawal is approved',
        mark_processing: 'Your withdrawal is processing',
        mark_paid: 'Your withdrawal has been sent',
        reject: 'Your withdrawal was cancelled',
      };
      await db.collection('notifications').add({
        recipientId: targetUid,
        type: `payout_${action}`,
        title: titles[action],
        body: reason || (action === 'mark_paid' && txHash ? `tx ${txHash}` : ''),
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: `admin_payout_${action}`,
      target: { type: 'payout_request', id: payoutId },
      before: { status: p.status },
      after:  { status: cfg.to, txHash },
      reason: String(reason).slice(0, 400),
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    });

    return { ok: true, status: cfg.to };
  }
);

// NOTE: there is intentionally no `adminRefundPayout` / equivalent callable.
// Refunds are not a concept on VERGR — once a withdrawal is sent, it is
// settled. The "Reject" action above handles the only legitimate reversal
// (cancelling a still-queued withdrawal and returning the held gems).

// ════════════════════════════════════════════════════════════════════
// ECONOMY CONFIG — app_config/general flags
// ════════════════════════════════════════════════════════════════════

const ECONOMY_CONFIG_KEYS = [
  'liveStreamingPaused',
  'freeUploadsPaused',
  'botsPaused',
  'conversionsPaused',
  'payoutsPaused',
  'tipsPaused',
];

exports.adminGetEconomyConfig = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const snap = await db.collection('app_config').doc('general').get();
    const d = snap.exists ? snap.data() : {};
    const cfg = {};
    for (const k of ECONOMY_CONFIG_KEYS) cfg[k] = !!d[k];
    return cfg;
  }
);

exports.adminSetEconomyConfig = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_set_economy_config', { perHour: 30, perDay: 100 });
    const { key, value } = request.data || {};
    if (!ECONOMY_CONFIG_KEYS.includes(key)) {
      throw new HttpsError('invalid-argument', `key must be one of: ${ECONOMY_CONFIG_KEYS.join(', ')}`);
    }
    const ref = db.collection('app_config').doc('general');
    const before = (await ref.get()).data() || {};
    await ref.set({ [key]: !!value, [`${key}UpdatedAt`]: FieldValue.serverTimestamp(), [`${key}UpdatedBy`]: uid }, { merge: true });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'admin_set_economy_config',
      target: { type: 'app_config', id: 'general' },
      before: { [key]: !!before[key] },
      after:  { [key]: !!value },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    });
    return { ok: true };
  }
);
