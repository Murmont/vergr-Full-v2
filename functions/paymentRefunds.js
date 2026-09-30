// Google Play refunds and chargebacks, applied to Vergr wallets.
//
// Until 2026-09-29 nothing read Google's voided-purchases list, so a buyer
// refunded by Google (a refund request, a bank chargeback, Google's own fraud
// cancellation) KEPT the coins, and a buyer who tipped them first left Vergr
// owing a creator's revenue share on money it never kept.
//
// Runs inside the EXISTING cronDaily (no new Scheduler job). Google keeps 30
// days of voided purchases, so a missed day loses nothing.
//
// FOUNDER RULES (2026-09-29, docs/PAYMENTS_ADMIN_PLAN.md §9.3):
//   • take the coins back; if already spent the wallet goes NEGATIVE, and the
//     next purchase repays it first (no tipping or spending until it is >= 0)
//   • flag it on the Payments tab
//   • block the account from buying coins (default 90 days, admin-adjustable)
//   • tell every creator who received tips from those coins, naming the buyer,
//     in FACTUAL wording (never "fraud": a chargeback can be the real card owner)
//
// A refund WE issued (voidedSource 1, from the Payments tab) is not penalised:
// the admin who issued it already decided what to do with the coins.

const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const PR = require('./paymentRecords');

const db = getFirestore('vgrdb');
const STATE_DOC = 'payment_system/play_voided';
const BAN_DAYS = 90;

const REASONS = ['other', 'remorse', 'not_received', 'defective', 'accidental_purchase',
  'fraud', 'friendly_fraud', 'chargeback', 'unacknowledged_purchase'];
const SOURCES = ['buyer', 'developer', 'google'];
// Reasons that are the buyer taking money back after using what they bought.
const HOSTILE = new Set(['fraud', 'friendly_fraud', 'chargeback']);

async function listVoided(sinceMs) {
  const pb = require('./playBilling');
  const token = await pb._androidPublisherToken();
  const out = [];
  let page = '';
  for (let i = 0; i < 20; i++) {
    const u = new URL(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(pb._PACKAGE_NAME)}/purchases/voidedpurchases`);
    u.searchParams.set('type', '1');          // one-time AND subscription purchases
    u.searchParams.set('maxResults', '1000');
    if (page) u.searchParams.set('token', page);
    else u.searchParams.set('startTime', String(sinceMs));
    const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.text();
    if (!res.ok) throw new Error(`voidedpurchases ${res.status}: ${body.slice(0, 300)}`);
    const j = JSON.parse(body || '{}');
    out.push(...(j.voidedPurchases || []));
    page = j.tokenPagination?.nextPageToken || '';
    if (!page) break;
  }
  return out;
}

/**
 * Tips the buyer sent after the purchase, newest first, until `coins` are
 * accounted for. Those are the creators whose tip came out of refunded money.
 * Uses the existing (userId, createdAt) index and filters the type here.
 */
async function tipsFrom(uid, sinceMs, coins) {
  const snap = await db.collection('transactions')
    .where('userId', '==', uid)
    .where('createdAt', '>=', new Date(sinceMs || 0))
    .orderBy('createdAt', 'desc')
    .limit(300)
    .get();
  const byCreator = new Map();
  let left = coins;
  for (const d of snap.docs) {
    const t = d.data();
    if (t.type !== 'tip_sent' || !t.recipientId || left <= 0) continue;
    const amt = Math.min(Math.abs(Number(t.amount) || 0), left);
    left -= amt;
    byCreator.set(t.recipientId, (byCreator.get(t.recipientId) || 0) + amt);
  }
  return byCreator;
}

async function applyOne(v) {
  const reason = REASONS[Number(v.voidedReason)] || 'other';
  const source = SOURCES[Number(v.voidedSource)] || 'buyer';
  const key = v.orderId || PR.tokenHash(v.purchaseToken || '');
  // Idempotent per voided order: the list is re-read every day for 30 days.
  const seenRef = db.collection('payment_voided').doc(key.replace(/\//g, '_'));
  try {
    await seenRef.create({ ...v, reason, source, seenAt: FieldValue.serverTimestamp() });
  } catch (e) {
    if (e && e.code === 6) return 'seen';
    throw e;
  }

  const ledgerRef = v.purchaseToken ? db.collection('play_purchases').doc(v.purchaseToken) : null;
  const ledger = ledgerRef ? await ledgerRef.get() : null;
  const label = reason === 'chargeback' ? 'charged back' : 'refunded';

  // Not a coin purchase we credited: a subscription (the daily subscription
  // sync handles the plan), an item, or a purchase that never reached us.
  if (!ledger || !ledger.exists || !(ledger.data().coins > 0)) {
    const item = ledger?.exists ? ledger.data() : null;
    await PR.recordIncident({
      route: PR.ROUTES.GOOGLE_PLAY, uid: item?.uid || null, productId: item?.productId || null,
      purchaseToken: v.purchaseToken || null, orderId: v.orderId || null,
      stage: 'refund_detected', source: 'provider',
      status: reason === 'chargeback' ? 'charged_back' : 'refunded',
      attention: item?.itemKind ? `Google ${label} a ${item.itemKind} purchase (${reason}, by ${source}); the item was not taken back automatically` : null,
      detail: `Google ${label} order ${v.orderId || ''}: reason ${reason}, started by ${source}`,
    });
    if (ledger?.exists) await ledgerRef.set({ refundedAt: FieldValue.serverTimestamp(), refundReason: reason, refundSource: source }, { merge: true });
    return 'recorded';
  }

  const L = ledger.data();
  const uid = L.uid;
  const coins = Number(L.coins) || 0;
  if (source === 'developer') {
    // We issued it from the Payments tab; the admin handled the coins there.
    await ledgerRef.set({ refundedAt: FieldValue.serverTimestamp(), refundReason: reason, refundSource: source }, { merge: true });
    return 'developer';
  }

  // Take the coins back, allowing negative (founder rule).
  const walletRef = db.collection('wallets').doc(uid);
  let before = 0;
  await db.runTransaction(async (t) => {
    const w = await t.get(walletRef);
    before = w.exists ? Number(w.data().balance || 0) : 0;
    t.set(walletRef, { balance: FieldValue.increment(-coins), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    t.set(ledgerRef, { refundedAt: FieldValue.serverTimestamp(), refundReason: reason, refundSource: source, coinsReversed: coins }, { merge: true });
    t.create(db.collection('transactions').doc(), {
      userId: uid, type: 'coin_purchase_reversal', currency: 'coins', amount: -coins,
      description: `Google Play ${label} coin pack ${L.productId} (${reason})`,
      gateway: 'google_play', playOrderId: v.orderId || null,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  const spent = Math.max(0, coins - Math.max(0, before));
  const penalise = spent > 0 || HOSTILE.has(reason);

  const userSnap = await db.collection('users').doc(uid).get();
  const username = userSnap.exists ? (userSnap.data().username || 'a user') : 'a user';

  let notified = 0;
  if (penalise) {
    const until = Date.now() + BAN_DAYS * 86400000;
    await db.collection('users').doc(uid).set({
      purchaseBanUntil: until,
      purchaseBanReason: `Google Play ${label} a coin purchase (${reason})`,
    }, { merge: true });

    if (spent > 0) {
      const creators = await tipsFrom(uid, Number(L.purchaseTimeMillis) || 0, spent);
      const how = reason === 'chargeback' ? 'they charged the payment back with their bank' : 'they were refunded by Google Play';
      const batch = db.batch();
      for (const [creatorUid, amt] of creators) {
        batch.set(db.collection('notifications').doc(), {
          recipientId: creatorUid, type: 'tip_reversed', read: false,
          title: 'A tip to you was reversed',
          body: `@${username}'s ${amt}-coin tip to you was reversed: ${how}.`,
          senderId: uid, createdAt: FieldValue.serverTimestamp(),
        });
        notified++;
      }
      if (notified) await batch.commit();
    }
  }

  await PR.recordIncident({
    route: PR.ROUTES.GOOGLE_PLAY, uid, productId: L.productId, purchaseToken: v.purchaseToken, orderId: v.orderId || L.orderId,
    stage: 'refund_detected', source: 'provider',
    status: reason === 'chargeback' ? 'charged_back' : 'refunded',
    attention: penalise ? `Google ${label} ${coins} coins (${reason}); ${spent} had been spent, wallet now ${before - coins}` : null,
    detail: `Google ${label} order ${v.orderId || ''}: reason ${reason}, started by ${source}. ${coins} coins taken back (balance ${before} → ${before - coins}).`
      + (penalise ? ` Buying blocked ${BAN_DAYS} days.` : '')
      + (notified ? ` ${notified} creator(s) told their tip was reversed.` : ''),
  });
  // Tell the buyer, by email, what happened to their account. Never throws.
  await require('./receipts').sendRefundNotice({
    uid, orderId: v.orderId || L.orderId, item: `${coins.toLocaleString('en-US')} coins`,
    how: reason === 'chargeback' ? 'charged back through your bank' : 'refunded by Google Play',
    coinsRemoved: coins, balanceAfter: before - coins,
  });
  return penalise ? 'penalised' : 'reversed';
}

/** cronDaily job. */
async function syncVoidedPurchases() {
  const stateRef = db.doc(STATE_DOC);
  const state = (await stateRef.get()).data() || {};
  const now = Date.now();
  // Google keeps 30 days; start a day before the last run to cover clock skew.
  const since = Math.max(now - 29 * 86400000, (Number(state.lastRunMs) || 0) - 86400000);
  const voided = await listVoided(since);
  const tally = {};
  for (const v of voided) {
    try {
      const r = await applyOne(v);
      tally[r] = (tally[r] || 0) + 1;
    } catch (e) {
      tally.error = (tally.error || 0) + 1;
      console.error('syncVoidedPurchases: failed on', v.orderId || '', e && e.message);
    }
  }
  await stateRef.set({ lastRunMs: now, lastResult: tally, lastCount: voided.length }, { merge: true });
  console.log('syncVoidedPurchases', JSON.stringify({ voided: voided.length, ...tally }));
  return tally;
}

module.exports = { syncVoidedPurchases, _applyOne: applyOne };
