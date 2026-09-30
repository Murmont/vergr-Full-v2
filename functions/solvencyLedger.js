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
// The obvious design is to bump an aggregate every time the payable moves. It
// was rejected. There are mutation sites across many modules (coinLedger,
// vergrMeShop, adminEconomy, creatorPayouts and every earning surface), and any new earning
// surface adds another. Miss one and the aggregate drifts silently.
//
// A drifting solvency number is worse than no solvency number, because it gets
// trusted. So this recomputes from the wallets themselves, which cannot drift
// by construction: the sum IS the liability, by definition.
//
// ## When to revisit
//
// This scans every wallet with a non-zero payable. That is cheap at current
// scale and stays cheap for a long time, because most wallets are owed nothing
// and are filtered server-side. If the scan ever becomes expensive, the fix is
// a sharded counter maintained by a wallets/{uid} onWrite trigger, with THIS
// reconciler kept as the daily check against it. Do not replace the reconciler
// with the counter; keep both.

const functions = require('firebase-functions/v2');
const { defineSecret, defineString } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const axios = require('axios');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';

const CIRCLE_API_KEY       = defineSecret('CIRCLE_API_KEY');
const CIRCLE_HOT_WALLET_ID = defineString('CIRCLE_HOT_WALLET_ID');

/**
 * Read a secret with trailing whitespace stripped.
 *
 * Not defensive padding: every R2 secret was once set with `echo` instead of
 * `printf` and carried a trailing newline, which silently broke the bucket name
 * for weeks (see the R2 section of CLAUDE.md). Same class of failure would make
 * a Circle key produce a 401 that this file would report as "unknown float".
 */
const trimEnv = (n) => (process.env[n] || '').replace(/[\s\r\n]+$/g, '').trim();


const LEDGER_DOC = 'platform_ledger/totals';

/**
 * Sum every dollar currently accrued to a creator and not yet paid.
 *
 * This is the exact liability. Paged rather than loaded at once so a large user
 * base cannot blow the function's memory, and ordered by document id so paging
 * is stable if a wallet is written mid-scan.
 */
async function computeCreatorPayable() {
  let payableMicroUsd = 0;
  let walletsWithBalance = 0;
  let scanned = 0;
  let cursor = null;

  for (;;) {
    // `owedMicroUsd` replaced `gems` on 2026-08-16. The liability is now held
    // directly in micro-USD, so there is no unit conversion in this sum.
    let q = db.collection('wallets')
      .where('owedMicroUsd', '>', 0)
      .orderBy('owedMicroUsd')
      .orderBy('__name__')
      .limit(1000);
    if (cursor) q = q.startAfter(cursor);

    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const owed = Math.floor(doc.data().owedMicroUsd || 0);
      if (owed > 0) { payableMicroUsd += owed; walletsWithBalance++; }
      scanned++;
    }

    if (snap.size < 1000) break;
    cursor = snap.docs[snap.docs.length - 1];
  }

  return { payableMicroUsd, walletsWithBalance, scanned };
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

    // AN EMPTY WALLET IS A KNOWN BALANCE OF ZERO, NOT AN UNREADABLE ONE.
    //
    // Circle omits token rows for balances of zero, so a wallet holding nothing
    // comes back with an empty `tokenBalances` array. Treating that as "cannot
    // determine float" raised a daily "Cannot verify solvency" alert on a
    // platform that owes creators $0.00 and is therefore trivially solvent, and
    // an alert that cries wolf every morning is one nobody reads by the time it
    // matters.
    //
    // The distinction that IS worth keeping: a response with no `tokenBalances`
    // field at all is a shape we did not expect, and guessing zero there could
    // mask a real balance behind an API change. That stays unknown.
    if (!Array.isArray(balances)) {
      return { floatMicroUsd: null, known: false, sources: [], reason: 'unexpected_balance_shape' };
    }
    if (!usdcRows.length) {
      return {
        floatMicroUsd: 0,
        known: true,
        sources: [{ name: 'circle_omnibus', walletId, micro: 0 }],
        reason: 'wallet_holds_no_usdc',
        excludes: ['payram_in_transit', 'payout_partner_balance'],
      };
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

  // The copy has to name the ACTUAL cause. It used to hardcode "no float reader
  // is configured" for every unknown status, which was simply false in the case
  // that fired daily: the reader was configured and working, the wallet was
  // empty. An alert that misstates its own cause sends you looking in the wrong
  // place, which is worse than one that says nothing.
  const WHY = {
    circle_not_configured: 'the Circle API keys are not set',
    circle_call_failed: 'the Circle balance call failed',
    unparseable_amount: 'Circle returned a balance we could not read',
    unexpected_balance_shape: 'Circle returned an unexpected response shape',
  };
  const why = WHY[payload.floatReason] || `float is unreadable (${payload.floatReason || 'no reason recorded'})`;

  const body = status === 'unknown'
    ? `Cannot confirm we hold what we owe creators: ${why}. Currently owed $${((payload.creatorPayableMicroUsd || 0) / 1e6).toFixed(2)}.`
    : `Creator liabilities exceed held float by $${((payload.shortfallMicroUsd || 0) / 1e6).toFixed(2)}.`;

  const admins = await db.collection('users').where('staff', '==', true).limit(20).get();
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

// Runs inside a dispatcher cron in index.js (it was its own Cloud Scheduler
// job, and every job past the first three is billed monthly).
exports.reconcileSolvency = async function reconcileSolvency() {
    const out = await reconcile();
    console.log('reconcileSolvency', JSON.stringify({ ...out, checkedAt: undefined }));
  };

/** Admin on-demand recompute, for the finance dashboard. */
exports.getSolvencyLedger = functions.https.onCall(
  { region: REGION, secrets: [CIRCLE_API_KEY] },
  async (request) => {
    const { requireAdmin } = require('./adminSecurity');
    await requireAdmin(request.auth?.uid);
    if (request.data?.recompute) return await reconcile();
    const snap = await db.doc(LEDGER_DOC).get();
    return snap.exists ? snap.data() : { status: 'never_run' };
  },
);

exports._internal = { computeCreatorPayable, readFloat, reconcile, usdcStringToMicro, LEDGER_DOC };
