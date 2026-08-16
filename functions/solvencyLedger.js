// Solvency ledger — how much of the money is ours, and how much is owed out.
//
// See docs/REVENUE_SHARE_PLAN.md §11. Under the revenue share model VERGR is the
// principal: a buyer's payment is VERGR revenue, and what a creator has accrued
// is a LIABILITY. The number that governs whether the business is solvent is:
//
//     float_held  >=  creator_payable
//
// If that ever fails, VERGR owes creators more than it holds.
//
// ## Why this is a reconciler and not an incremental counter
//
// The obvious design is to bump an aggregate every time gems move. It was
// rejected. There are sixteen gem-mutation sites across ten modules
// (coinLedger, economy, payram, nowpayments, vergrMeShop, gemBuyback,
// withdrawals, adminEconomy, creatorPayouts, gemTransfer), and any new earning
// surface adds another. Miss one and the aggregate drifts silently.
//
// A drifting solvency number is worse than no solvency number, because it gets
// trusted. So this recomputes from the wallets themselves, which cannot drift
// by construction: the sum IS the liability, by definition.
//
// ## When to revisit
//
// This scans every wallet with a non-zero gem balance. That is cheap at current
// scale and stays cheap for a long time, because most wallets hold zero gems
// and are filtered server-side. If the scan ever becomes expensive, the fix is
// a sharded counter maintained by a wallets/{uid} onWrite trigger, with THIS
// reconciler kept as the daily check against it. Do not replace the reconciler
// with the counter; keep both.

const functions = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const axios = require('axios');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';

const CIRCLE_API_KEY       = defineSecret('CIRCLE_API_KEY');
const CIRCLE_HOT_WALLET_ID = defineSecret('CIRCLE_HOT_WALLET_ID');

/**
 * Read a secret with trailing whitespace stripped.
 *
 * Not defensive padding: every R2 secret was once set with `echo` instead of
 * `printf` and carried a trailing newline, which silently broke the bucket name
 * for weeks (see the R2 section of CLAUDE.md). Same class of failure would make
 * a Circle key produce a 401 that this file would report as "unknown float".
 */
const trimEnv = (n) => (process.env[n] || '').replace(/[\s\r\n]+$/g, '').trim();

/** 1 gem = $0.01. Mirrors GEM_TO_MICRO_USD in creatorPayouts.js. */
const GEM_TO_MICRO_USD = 10_000;

const LEDGER_DOC = 'platform_ledger/totals';

/**
 * Sum every gem currently accrued to a creator and not yet paid.
 *
 * This is the exact liability. Paged rather than loaded at once so a large user
 * base cannot blow the function's memory, and ordered by document id so paging
 * is stable if a wallet is written mid-scan.
 */
async function computeCreatorPayable() {
  let payableGems = 0;
  let walletsWithBalance = 0;
  let scanned = 0;
  let cursor = null;

  for (;;) {
    let q = db.collection('wallets')
      .where('gems', '>', 0)
      .orderBy('gems')
      .orderBy('__name__')
      .limit(1000);
    if (cursor) q = q.startAfter(cursor);

    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const gems = Math.floor(doc.data().gems || 0);
      if (gems > 0) { payableGems += gems; walletsWithBalance++; }
      scanned++;
    }

    if (snap.size < 1000) break;
    cursor = snap.docs[snap.docs.length - 1];
  }

  return { payableGems, payableMicroUsd: payableGems * GEM_TO_MICRO_USD, walletsWithBalance, scanned };
}

/**
 * Decimal-string USDC amount to integer micro-USD, without floating point.
 *
 * Circle returns amounts as decimal strings ("1234.567891"). Doing
 * `Math.round(parseFloat(a) * 1e6)` is wrong at scale: binary floats cannot
 * represent most decimal cents exactly, so large balances drift by cents, and a
 * solvency check that drifts is a solvency check nobody can act on. Parse the
 * string instead.
 */
function usdcStringToMicro(amount) {
  const str = String(amount ?? '0').trim();
  if (!/^-?\d+(\.\d+)?$/.test(str)) return null;
  const neg = str.startsWith('-');
  const [whole, frac = ''] = str.replace('-', '').split('.');
  const micro = BigInt(whole) * 1_000_000n
    + BigInt((frac + '000000').slice(0, 6));
  const out = Number(neg ? -micro : micro);
  return Number.isSafeInteger(out) ? out : null;
}

/**
 * What VERGR actually holds, read from the Circle omnibus wallet.
 *
 * ## Why only Circle
 *
 * Per CLAUDE.md the Circle programmable wallet holds ALL float. PayRam funds in
 * transit and any balance sitting with a future payout partner are deliberately
 * NOT counted, which UNDERSTATES what we hold.
 *
 * That direction is chosen on purpose. Understating float makes the check alarm
 * more readily than reality warrants; overstating it would let a genuine
 * shortfall read as healthy. For a solvency alarm, a false positive costs a
 * founder five minutes and a false negative costs creators their money.
 *
 * ## Failure is "unknown", never "fine"
 *
 * Any failure — no API key, network error, unparseable amount, no USDC balance
 * in the response — returns known:false. It never falls back to zero and never
 * assumes solvency, because reconcile() alarms on unknown exactly as it alarms
 * on shortfall.
 */
async function readFloat() {
  const apiKey = trimEnv('CIRCLE_API_KEY');
  const walletId = trimEnv('CIRCLE_HOT_WALLET_ID');

  if (!apiKey || !walletId || apiKey.startsWith('placeholder')) {
    return { floatMicroUsd: null, known: false, sources: [], reason: 'circle_not_configured' };
  }

  try {
    const resp = await axios.get(
      `https://api.circle.com/v1/w3s/wallets/${encodeURIComponent(walletId)}/balances`,
      { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 15_000 },
    );

    const balances = resp?.data?.data?.tokenBalances || [];
    // Match USDC by symbol. A wallet can hold several tokens and only USDC is
    // the unit creators are owed in; counting anything else would inflate float
    // with an asset we cannot pay a creator with.
    const usdcRows = balances.filter(
      (b) => String(b?.token?.symbol || '').toUpperCase() === 'USDC',
    );

    if (!usdcRows.length) {
      return { floatMicroUsd: null, known: false, sources: [], reason: 'no_usdc_balance_returned' };
    }

    let total = 0;
    for (const row of usdcRows) {
      const micro = usdcStringToMicro(row.amount);
      if (micro === null) {
        return { floatMicroUsd: null, known: false, sources: [], reason: 'unparseable_amount' };
      }
      total += micro;
    }

    return {
      floatMicroUsd: total,
      known: true,
      sources: [{ name: 'circle_omnibus', walletId, micro: total }],
      // Recorded so a reader knows the figure excludes in-transit funds and is
      // therefore a floor, not the whole picture.
      excludes: ['payram_in_transit', 'payout_partner_balance'],
    };
  } catch (e) {
    console.error('readFloat: circle balance call failed', e?.response?.status, e?.message || e);
    return { floatMicroUsd: null, known: false, sources: [], reason: 'circle_call_failed' };
  }
}

/**
 * Recompute and persist the ledger, and alarm if it is not demonstrably solvent.
 */
async function reconcile() {
  const payable = await computeCreatorPayable();
  const float = await readFloat();

  const solvent = float.known && float.floatMicroUsd >= payable.payableMicroUsd;
  const shortfallMicroUsd = float.known
    ? Math.max(0, payable.payableMicroUsd - float.floatMicroUsd)
    : null;

  const status = !float.known ? 'unknown' : (solvent ? 'ok' : 'shortfall');

  const dayKey = new Date().toISOString().slice(0, 10);
  const payload = {
    creatorPayableGems: payable.payableGems,
    creatorPayableMicroUsd: payable.payableMicroUsd,
    walletsWithBalance: payable.walletsWithBalance,
    floatMicroUsd: float.floatMicroUsd,
    floatKnown: float.known,
    floatSources: float.sources,
    // WHY float is unknown, so the alert is actionable. "Cannot verify solvency"
    // with no cause just becomes an alert people learn to dismiss.
    floatReason: float.reason || null,
    floatExcludes: float.excludes || null,
    shortfallMicroUsd,
    status,
    checkedAt: FieldValue.serverTimestamp(),
  };

  await db.doc(LEDGER_DOC).set(payload, { merge: true });
  // Daily snapshot, so a shortfall can be traced to when it started rather than
  // only ever showing the current state.
  await db.collection('platform_ledger_daily').doc(dayKey).set(payload, { merge: true });

  if (status !== 'ok') {
    await raiseAlert(status, payload);
  }

  return payload;
}

/**
 * Alert admins. De-duped per day per status so a persistent unknown-float state
 * does not push a notification every run and train everyone to ignore it.
 */
async function raiseAlert(status, payload) {
  const dayKey = new Date().toISOString().slice(0, 10);
  const alertRef = db.collection('solvency_alerts').doc(`${dayKey}__${status}`);

  const created = await db.runTransaction(async (tx) => {
    const existing = await tx.get(alertRef);
    if (existing.exists) return false;
    tx.set(alertRef, { status, dayKey, payload, createdAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!created) return;

  const body = status === 'unknown'
    ? 'Cannot verify solvency: no float reader is configured, so we cannot confirm we hold what we owe creators.'
    : `Creator liabilities exceed held float by $${((payload.shortfallMicroUsd || 0) / 1e6).toFixed(2)}.`;

  const admins = await db.collection('users').where('role', '==', 'admin').limit(20).get();
  const batch = db.batch();
  for (const a of admins.docs) {
    batch.set(db.collection('notifications').doc(), {
      recipientId: a.id,
      type: 'solvency_alert',
      title: status === 'unknown' ? 'Solvency unverified' : 'Solvency shortfall',
      body,
      read: false,
      data: { status, ...payload, checkedAt: null },
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

exports.reconcileSolvency = functions.scheduler.onSchedule(
  {
    schedule: 'every day 05:00', timeZone: 'UTC', region: REGION,
    secrets: [CIRCLE_API_KEY, CIRCLE_HOT_WALLET_ID],
  },
  async () => {
    const out = await reconcile();
    console.log('reconcileSolvency', JSON.stringify({ ...out, checkedAt: undefined }));
  },
);

/** Admin on-demand recompute, for the finance dashboard. */
exports.getSolvencyLedger = functions.https.onCall(
  { region: REGION, secrets: [CIRCLE_API_KEY, CIRCLE_HOT_WALLET_ID] },
  async (request) => {
    const { requireAdmin } = require('./adminSecurity');
    await requireAdmin(request.auth?.uid);
    if (request.data?.recompute) return await reconcile();
    const snap = await db.doc(LEDGER_DOC).get();
    return snap.exists ? snap.data() : { status: 'never_run' };
  },
);

exports._internal = { computeCreatorPayable, readFloat, reconcile, usdcStringToMicro, GEM_TO_MICRO_USD, LEDGER_DOC };
