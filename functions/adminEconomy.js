// adminEconomy.js — server callables for the Admin → Economy screen.
//
// Every callable goes through `requireAdminScreen('economy')` so sub-admins
// with the economy scope can use this without being founder. Destructive
// money-moving actions also require a fresh TOTP step-up.
//
// Callables:
//   adminGetEconomyStats       , KPI counts (coins/VP in circulation, revenue share owed, total paid)
//   adminListTopWallets        , top earners by coins / revenue share owed
//   adminGrantCoins             — credit user wallet + ledger entry
//   adminGrantVp                — credit user VP + ledger entry
//   adminGrantOwed             , credit the revenue-share payable directly (rare)
//   adminDeductCoins            — debit user wallet (corrections, anti-fraud)
//   adminListTransactions       — paginated transactions ledger
//   adminGetPayoutOverview     , creator-payout pipeline state (the REAL outbound path)
//   adminListPayoutStatements  , per-creator remittance advices from each run
//   adminListPayoutRequests    , LEGACY user-initiated withdrawal queue, read-only
//                                  history. That flow was deleted 2026-08-16; these
//                                  rows only exist for pre-deletion test data.
//   adminUpdatePayoutStatus    , flip a LEGACY payout row's status. Cancel returns the
//                                  held amount to the wallet. A sent row can never be
//                                  reversed: once funds are out they are out.
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
    // LEGACY. The user-initiated withdrawal queue was deleted 2026-08-16; these
    // rows are pre-deletion test data and exist only so the history is not a
    // blank screen. The live outbound path is payout_runs / payout_statements.
    const payouts = db.collection('payout_requests');
    const statements = db.collection('payout_statements');
    const accounts = db.collection('payout_accounts');

    // Defensive: aggregate sums may fail if collection is empty / fields missing.
    const safeAgg = async (q, fields) => {
      try {
        const r = await q.aggregate(fields).get();
        return r.data();
      } catch (e) { return null; }
    };

    const safeCount = async (q) => {
      try { return (await q.count().get()).data().count; } catch { return 0; }
    };

    const [coinSum, owedSum, vpSum, pendingSum, paidSum, payoutsCount,
           paidStatements, enrolledCount, statementsPaidCount] = await Promise.all([
      safeAgg(wallets, { total: AggregateField.sum('balance'), count: AggregateField.count() }),
      safeAgg(wallets, { total: AggregateField.sum('owedMicroUsd') }),
      safeAgg(wallets, { total: AggregateField.sum('vp') }),
      // Phase 4 status names: `pending`, `processing`. Keep legacy `requested`/
      // `on_hold`/`ready`/`queued_placeholder` so older test rows still count.
      safeAgg(payouts.where('status', 'in', ['pending', 'requested', 'on_hold', 'ready', 'processing', 'queued_placeholder']),
              { total: AggregateField.sum('gemsRequested'), count: AggregateField.count() }),
      // Legacy rows wrote `amountEUR`; we sum both via two queries below.
      safeAgg(payouts.where('status', '==', 'sent'),
              { totalNet: AggregateField.sum('netMicroUSDC'), totalLegacy: AggregateField.sum('amountEUR'), count: AggregateField.count() }),
      payouts.count().get().then(r => r.data().count).catch(() => 0),
      // The REAL money-out figure: statements written by runCreatorPayouts.
      safeAgg(statements.where('status', '==', 'paid'),
              { total: AggregateField.sum('amountMicroUsd') }),
      safeCount(accounts.where('enrolled', '==', true)),
      safeCount(statements.where('status', '==', 'paid')),
    ]);

    return {
      coinsInCirculation:  coinSum?.total ?? 0,
      // Revenue share accrued and not yet paid, in micro-USD.
      owedMicroUsd:        owedSum?.total  ?? 0,
      vpInCirculation:     vpSum?.total   ?? 0,
      walletCount:         coinSum?.count ?? 0,
      legacyPendingPayout: pendingSum?.total ?? 0,
      pendingPayoutCount:  pendingSum?.count ?? 0,
      // Sum net USDC across paid withdrawals. Phase 4 rows use `netMicroUSDC`
      // (integer micro-USDC). Legacy rows used `amountEUR` (float EUR). Combine.
      totalPaidEUR:        ((paidSum?.totalNet || 0) / 1e6) + (paidSum?.totalLegacy || 0),
      totalPayoutsCount:   paidSum?.count ?? 0,
      allPayoutRequestsCount: payoutsCount,
      // Creator-payout pipeline (the live path).
      paidMicroUsd:        paidStatements?.total ?? 0,
      paidStatementCount:  statementsPaidCount,
      enrolledForPayout:   enrolledCount,
    };
  }
);

exports.adminListTopWallets = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { sortBy = 'balance', limit = 10 } = request.data || {};
    const allowed = ['balance', 'owedMicroUsd', 'vp', 'totalEarned'];
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
        owedMicroUsd: d.data().owedMicroUsd || 0,
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
  // `owed` grants credit the revenue-share payable directly, in micro-USD.
  // This replaced the `gems` currency when that unit was removed.
  const fieldMap = { coins: 'balance', owed: 'owedMicroUsd', vp: 'vp' };
  // An admin grant is NOT revenue and must never land in an earnings total.
  // It used to increment totalEarned / totalGemsEarned, which meant every
  // support credit, comp and test grant was reported to the user as money they
  // had EARNED. That is how the founder's account came to show $10.01 of
  // earnings having earned nothing. Grants are tracked separately so the figure
  // is not lost, just not counted as income.
  const totalMap = { coins: 'totalGrantedCoins', owed: 'totalGrantedMicroUsd', vp: null };
  const field = fieldMap[currency];
  if (!field) throw new HttpsError('invalid-argument', 'currency must be coins/owed/vp.');

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

/**
 * Adjust the revenue-share payable directly, in micro-USD.
 *
 * Was `adminGrantGems`. The rename is not cosmetic: the gem unit was deleted on
 * 2026-08-16 and the cap came across untranslated, so the limit read
 * "100,000", which was 100,000 GEMS ($1,000) before the change and 100,000
 * MICRO-USD ($0.10) after it. Any real correction was rejected as too large.
 */
const MAX_OWED_GRANT_MICRO_USD = 1_000 * 1_000_000;   // $1,000, matching the old intent

exports.adminGrantOwed = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_grant_owed', { perHour: 10, perDay: 30, perMonth: 100 });
    const { targetUid, amount, reason = '' } = request.data || {};
    const amt = Math.floor(Number(amount));
    if (!reason.trim()) throw new HttpsError('invalid-argument', 'reason required.');
    if (Math.abs(amt) > MAX_OWED_GRANT_MICRO_USD) {
      throw new HttpsError('invalid-argument', 'Max $1,000 per adjustment.');
    }
    const meta = extractRequestMeta(request);
    await grantCurrency({ callerUid: uid, targetUid, amount: amt, currency: 'owed', reason, type: 'admin_grant', ...meta });
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
        const heldMicro = (Number(p.gemsRequested) || 0) * 10_000;
        tx.update(walletRef, {
          owedMicroUsd: FieldValue.increment(heldMicro),
          microUsdInEscrow: FieldValue.increment(-heldMicro),
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.set(db.collection('transactions').doc(), {
          userId: targetUid, type: 'withdrawal_cancelled',
          amount: heldMicro,
          amountMicroUsd: heldMicro,
          currency: 'usd',
          description: `Withdrawal #${payoutId.slice(0, 8)} cancelled by admin, amount returned`,
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

// ════════════════════════════════════════════════════════════════════
// ADMIN: nav badge counts
// ════════════════════════════════════════════════════════════════════
//
// Moved here from functions/withdrawals.js on 2026-08-16 when that module was
// deleted with the gem unit. It never had anything to do with withdrawals
// beyond counting a queue; AdminShell calls it on every load, so it had to
// survive the deletion.
exports.adminGetNavBadges = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
    const userSnap = await db.collection('users').doc(uid).get();
    if (userSnap.data()?.role !== 'admin') {
      // Sub-admins also get this, they need it for their own scope.
      const adminUserSnap = await db.collection('admin_users').doc(uid).get();
      if (!adminUserSnap.exists || adminUserSnap.data()?.status !== 'active') {
        throw new HttpsError('permission-denied', 'Admin only.');
      }
    }

    // Counts. Each query is a count aggregation (1 read per metric).
    const safeCount = async (q) => {
      try { const r = await q.count().get(); return r.data().count; }
      catch { return 0; }
    };

    const [pendingReports, unattributedDeposits] = await Promise.all([
      safeCount(db.collection('reports').where('status', '==', 'pending')),
      safeCount(db.collection('unattributed_deposits').where('reconciled', '==', false)),
    ]);

    return {
      ok: true,
      badges: {
        // `payout_requests` counts are gone with the user-initiated withdrawal
        // queue that produced them. Creator payouts run on a schedule and have
        // their own admin surface, so there is no queue here to badge.
        economy: unattributedDeposits,
        moderation: pendingReports,
      },
      breakdown: {
        pendingReports,
        unattributedDeposits,
      },
    };
  },
);

// ════════════════════════════════════════════════════════════════════
// CREATOR PAYOUTS, the real outbound path
// ════════════════════════════════════════════════════════════════════
//
// Distinct from adminListPayoutRequests above, which reads the LEGACY
// user-initiated withdrawal queue (deleted 2026-08-16). Money leaves Vergr in
// exactly one way now: runCreatorPayouts computes what Vergr owes its suppliers
// and pays them on Vergr's schedule. This surfaces that pipeline so the Economy
// screen stops describing a flow that no longer exists.

/** Pipeline state: partner wiring, enrolment funnel, run history, liability. */
exports.adminGetPayoutOverview = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);

    const accounts = db.collection('payout_accounts');
    const statements = db.collection('payout_statements');

    const safeCount = async (q) => {
      try { return (await q.count().get()).data().count; } catch { return 0; }
    };
    const safeAgg = async (q, fields) => {
      try { return (await q.aggregate(fields).get()).data(); } catch { return null; }
    };

    const [
      enrolled, frozen, runsSnap, paidAgg, paidCount, pendingCount,
      failedCount, legacyOpen, owedAgg, owedWallets,
    ] = await Promise.all([
      safeCount(accounts.where('enrolled', '==', true)),
      safeCount(accounts.where('frozen', '==', true)),
      db.collection('payout_runs').orderBy('startedAt', 'desc').limit(12).get()
        .catch(() => ({ docs: [] })),
      safeAgg(statements.where('status', '==', 'paid'), { total: AggregateField.sum('amountMicroUsd') }),
      safeCount(statements.where('status', '==', 'paid')),
      safeCount(statements.where('status', '==', 'pending')),
      safeCount(statements.where('status', '==', 'failed')),
      // Any legacy withdrawal row that is not in a terminal state. If this is
      // non-zero the founder needs to know: nothing processes them any more.
      safeCount(db.collection('payout_requests')
        .where('status', 'in', ['pending', 'requested', 'on_hold', 'ready', 'processing', 'queued_placeholder'])),
      safeAgg(db.collection('wallets'), { total: AggregateField.sum('owedMicroUsd') }),
      safeCount(db.collection('wallets').where('owedMicroUsd', '>', 0)),
    ]);

    const runs = runsSnap.docs.map(d => {
      const r = d.data();
      return {
        id: d.id,
        status: r.status || 'unknown',
        startedAt: toMs(r.startedAt),
        completedAt: toMs(r.completedAt),
        paidCount: Number(r.paidCount || 0),
        paidMicroUsd: Number(r.paidMicroUsd || 0),
        failedCount: Number(r.failedCount || 0),
        wouldPay: Number(r.wouldPay || 0),
        blockedReason: r.blockedReason || null,
      };
    });

    // Read the live flag out of the payout module rather than restating it here,
    // so this can never claim a partner is wired when the code says otherwise.
    let partnerConfigured = false;
    let minPayoutMicroUsd = 100 * 1_000_000;
    let minAccountAgeDays = 30;
    try {
      const cp = require('./creatorPayouts');
      const internals = cp._internal || {};
      if (typeof internals.PAYOUT_PARTNER_CONFIGURED === 'boolean') {
        partnerConfigured = internals.PAYOUT_PARTNER_CONFIGURED;
      }
      if (Number(internals.MIN_PAYOUT_MICRO_USD)) minPayoutMicroUsd = Number(internals.MIN_PAYOUT_MICRO_USD);
      if (Number(internals.MIN_ACCOUNT_AGE_DAYS)) minAccountAgeDays = Number(internals.MIN_ACCOUNT_AGE_DAYS);
    } catch { /* keep the documented defaults */ }

    return {
      partnerConfigured,
      minPayoutMicroUsd,
      minAccountAgeDays,
      accounts: { enrolled, frozen },
      statements: { paidCount, pendingCount, failedCount, paidMicroUsd: paidAgg?.total || 0 },
      liability: { owedMicroUsd: owedAgg?.total || 0, creditorCount: owedWallets },
      legacyOpenWithdrawals: legacyOpen,
      runs,
    };
  },
);

/** Per-creator remittance advices. `runId` scopes to one run. */
exports.adminListPayoutStatements = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { runId = null, status = null, pageSize = 50 } = request.data || {};

    let q = db.collection('payout_statements');
    if (runId) q = q.where('runId', '==', runId);
    if (status) q = q.where('status', '==', status);
    let snap;
    try {
      snap = await q.orderBy('createdAt', 'desc').limit(Math.min(Number(pageSize) || 50, 200)).get();
    } catch {
      // Missing composite index -> unordered fallback rather than a dead tab.
      snap = await q.limit(Math.min(Number(pageSize) || 50, 200)).get();
    }

    const rows = snap.docs.map(d => {
      const s = d.data();
      return {
        id: d.id,
        uid: s.uid || (d.id.includes('__') ? d.id.split('__')[1] : null),
        runId: s.runId || null,
        amountMicroUsd: Number(s.amountMicroUsd || 0),
        status: s.status || 'unknown',
        cadence: s.cadence || null,
        createdAt: toMs(s.createdAt),
        periodFromMs: toMs(s.periodFrom) || Number(s.periodFromMs) || null,
        reference: s.reference || null,
        failureReason: s.failureReason || null,
        sources: s.sources || null,
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
        };
      } catch { /* ignore */ }
    }));

    return { rows, users, count: rows.length };
  },
);
