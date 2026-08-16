// functions/gemTransfer.js — person-to-person GEM transfer (DM "Wallet").
// ─────────────────────────────────────────────────────────────────────
// Deliberately SEPARATE from sendTip. Tipping is a 10% creator-support
// action wired into streams, posts and the VP system; a DM transfer is
// somebody handing value to somebody else. Forking sendTip to special-case
// the second would have put stream/post tipping at risk for no reason, so
// this is its own callable with its own fee, its own transaction type and
// its own notification type. sendTip is untouched.
//
// Gems (not coins) because gems are the withdrawable currency: the recipient
// gets something immediately useful rather than a balance that still has to
// run the conversion ladder. The 3% here is a per-transaction service fee in
// the same family as the 8% shop fee and the 10% tip fee.
//
// SELF-SEND GUARD: the fee difference between paths makes routing value
// through a second account attractive, so a transfer is refused when both
// sides resolve to the same human — same uid, same verified phone, or same
// KYC document identity. That last one is the strong signal: withdrawing
// already requires KYC, so two accounts sharing a document are provably one
// person. It is a hard block, not a heuristic score.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';

// Founder-set. A plain transfer is a lighter service than a marketplace sale
// (8%) or a creator tip (10%), so it is priced below both.
const TRANSFER_FEE_PCT = 0.03;
// Anti-dust floor only — not an economic lever. 10 gems = €0.10.
const MIN_TRANSFER_GEMS = 10;

const err = (code, msg) => new functions.https.HttpsError(code, msg);

/**
 * True when both accounts provably belong to the same person. Kept
 * deterministic on purpose: every signal here is an identity match, not a
 * behavioural guess, so a false positive would require two people to genuinely
 * share a phone number or a passport.
 */
async function sameHumanBehindBoth(senderSnap, recipientSnap) {
  const a = senderSnap.data() || {};
  const b = recipientSnap.data() || {};

  // Verified phone — already stored for contact matching.
  if (a.phoneHash && b.phoneHash && a.phoneHash === b.phoneHash) return 'phone';

  // KYC document identity. Only present on accounts verified after this was
  // added, so it strengthens over time rather than working retroactively.
  const aId = a.kyc?.identityHash;
  const bId = b.kyc?.identityHash;
  if (aId && bId && aId === bId) return 'identity';

  return null;
}

// ── Buy-and-send quotes ─────────────────────────────────────────────
// Gems are NOT sold as a standing balance. You can only buy them as payment for
// a transfer that leaves immediately on settlement, so there is no
// buy-then-withdraw route — the buyer never holds the gems at any point.
//
// The quote exists because the sale is priced in EUR internally but charged in
// USD: between showing "$54" and the card actually clearing, the rate can move.
// A short server-issued lock means the user pays exactly what they were shown
// and we can't be caught on the wrong side of a swing. Pricing runs through
// payram's priceEurToUsd, so it inherits the same rate source, cache and
// safety buffer as every other purchase.
const QUOTE_TTL_MS = 90 * 1000;
const GEM_TO_EUR = 0.01;

// ── DISABLED 2026-08-14 — founder decision 4, docs/REVENUE_SHARE_PLAN.md ──
//
// User-to-user transfer of CASHABLE value is the single most money-transmission
// -shaped feature in this codebase: value moves from one person to another and
// leaves as USDC at the other end, with Vergr taking a 3% cut for moving it.
// That is a worse fact pattern than the withdrawal itself, because a withdrawal
// is at least arguably Vergr paying its own supplier, and this is plainly not.
//
// Both callables now reject. The file is kept rather than deleted so the
// history, the fee constant and this reasoning stay findable, and so the
// deployed functions return a clear message instead of vanishing and giving
// callers an opaque internal error.
//
// The UI entry point was already gone: SendGemsModal.jsx is orphaned, replaced
// on the DM wallet button by SendCoinsModal (coins, which are spend-only and
// never cashable, so that one is fine and stays).
//
// Do NOT re-enable without a founder decision. Sending COINS is the supported
// path and is not affected.
const GEM_TRANSFER_DISABLED = () => err(
  'failed-precondition',
  'Sending gems to another person is no longer supported. You can send coins instead.',
);

exports.quoteGemSend = functions.https.onCall({ region: REGION }, async (request) => {
  throw GEM_TRANSFER_DISABLED();
  /* eslint-disable no-unreachable */
  const uid = request.auth?.uid;
  if (!uid) throw err('unauthenticated', 'Sign in first.');

  const recipientId = String(request.data?.recipientId || '');
  const gems = Math.floor(Number(request.data?.gems));
  if (!recipientId) throw err('invalid-argument', 'Pick someone to send to.');
  if (recipientId === uid) throw err('failed-precondition', 'You cannot send gems to yourself.');
  if (!Number.isFinite(gems) || gems < MIN_TRANSFER_GEMS) {
    throw err('invalid-argument', `Minimum transfer is ${MIN_TRANSFER_GEMS} gems.`);
  }

  const [senderSnap, recipientSnap] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('users').doc(recipientId).get(),
  ]);
  if (!recipientSnap.exists) throw err('not-found', 'That account no longer exists.');

  // Same identity check as a balance transfer — quoting is the earliest point
  // we can refuse, so the user never reaches a payment screen they can't use.
  const sameHuman = await sameHumanBehindBoth(senderSnap, recipientSnap);
  if (sameHuman) {
    throw err('permission-denied', 'These accounts belong to the same person, so gems cannot be moved between them.');
  }

  const eurTotal = +(gems * GEM_TO_EUR).toFixed(2);
  const { amountUSD, rate, buffer } = await require('./payram')._priceEurToUsd(eurTotal);
  const netGems = Math.floor(gems * (1 - TRANSFER_FEE_PCT));

  const quoteId = db.collection('gem_quotes').doc().id;
  const expiresAt = Date.now() + QUOTE_TTL_MS;
  await db.collection('gem_quotes').doc(quoteId).set({
    quoteId, uid, recipientId, gems, netGems, feePct: TRANSFER_FEE_PCT,
    eurTotal, usdTotal: amountUSD, eurUsdRate: rate, fxBufferPct: buffer,
    expiresAt, used: false, createdAt: new Date(),
  });

  return {
    quoteId, gems, netGems, eurTotal, usdTotal: amountUSD,
    feePct: TRANSFER_FEE_PCT, expiresAt, ttlMs: QUOTE_TTL_MS,
  };
});

/**
 * Redeem a quote at payment-creation time. Single-use and time-bound: an
 * expired or already-spent quote is refused rather than silently re-priced,
 * because re-pricing is exactly how a user ends up charged more than the figure
 * they agreed to. Called by createPayramPayment.
 */
exports.consumeGemQuote = async (uid, quoteId) => {
  const ref = db.collection('gem_quotes').doc(String(quoteId || ''));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw err('not-found', 'That quote no longer exists — please try again.');
    const q = snap.data();
    if (q.uid !== uid) throw err('permission-denied', 'That quote belongs to another account.');
    if (q.used) throw err('failed-precondition', 'That quote has already been used.');
    if (Date.now() > q.expiresAt) throw err('deadline-exceeded', 'The price expired — please refresh and try again.');
    tx.update(ref, { used: true, usedAt: new Date() });
    return {
      quoteId: q.quoteId, recipientId: q.recipientId, gems: q.gems,
      netGems: q.netGems, feePct: q.feePct, eurTotal: q.eurTotal, usdTotal: q.usdTotal,
    };
  });
};

exports.sendGems = functions.https.onCall({ region: REGION }, async (request) => {
  throw GEM_TRANSFER_DISABLED();  // see the note above quoteGemSend
  /* eslint-disable no-unreachable */
  const uid = request.auth?.uid;
  if (!uid) throw err('unauthenticated', 'Sign in to send gems.');

  const recipientId = String(request.data?.recipientId || '');
  const amount = Math.floor(Number(request.data?.amount));
  const note = String(request.data?.note || '').slice(0, 140);

  if (!recipientId) throw err('invalid-argument', 'Pick someone to send to.');
  if (recipientId === uid) throw err('failed-precondition', 'You cannot send gems to yourself.');
  if (!Number.isFinite(amount) || amount < MIN_TRANSFER_GEMS) {
    throw err('invalid-argument', `Minimum transfer is ${MIN_TRANSFER_GEMS} gems.`);
  }

  const senderRef = db.collection('users').doc(uid);
  const recipientRef = db.collection('users').doc(recipientId);
  const [senderSnap, recipientSnap] = await Promise.all([senderRef.get(), recipientRef.get()]);

  if (!recipientSnap.exists) throw err('not-found', 'That account no longer exists.');
  const rec = recipientSnap.data() || {};
  if (rec.accountType === 'news_bot') throw err('failed-precondition', 'You cannot send gems to a bot account.');
  if (rec.guest) throw err('failed-precondition', 'That account cannot receive gems yet.');

  const sameHuman = await sameHumanBehindBoth(senderSnap, recipientSnap);
  if (sameHuman) {
    functions.logger.warn('sendGems: self-send blocked', { uid, recipientId, via: sameHuman });
    throw err(
      'permission-denied',
      'These accounts belong to the same person, so gems cannot be moved between them.',
    );
  }

  const net = Math.floor(amount * (1 - TRANSFER_FEE_PCT));
  const platformCut = amount - net;

  const senderWalletRef = db.collection('wallets').doc(uid);
  const recipientWalletRef = db.collection('wallets').doc(recipientId);

  const result = await db.runTransaction(async (tx) => {
    const [sw, rw] = await Promise.all([tx.get(senderWalletRef), tx.get(recipientWalletRef)]);
    const senderGems = (sw.exists ? sw.data().gems : 0) || 0;
    if (senderGems < amount) {
      throw err('failed-precondition', `Not enough gems. You have ${senderGems}.`);
    }

    tx.update(senderWalletRef, { gems: senderGems - amount, updatedAt: new Date() });
    tx.set(recipientWalletRef, {
      gems: FieldValue.increment(net),
      updatedAt: new Date(),
    }, { merge: true });

    // Both sides get their own row so history reads correctly from either end,
    // and the type is distinct from 'tip' so DM transfers never get counted as
    // creator earnings in the Studio breakdowns.
    tx.set(db.collection('transactions').doc(), {
      userId: uid, type: 'gem_transfer_sent', currency: 'gems',
      amount: -amount, counterpartyId: recipientId,
      description: `Sent ${net} gems to @${rec.username || 'user'}`,
      meta: { gross: amount, net, platformCut, feePct: TRANSFER_FEE_PCT, note: note || null },
      createdAt: new Date(),
    });
    tx.set(db.collection('transactions').doc(), {
      userId: recipientId, type: 'gem_transfer_received', currency: 'gems',
      amount: net, counterpartyId: uid,
      description: `Received ${net} gems`,
      meta: { gross: amount, net, platformCut, feePct: TRANSFER_FEE_PCT, note: note || null },
      createdAt: new Date(),
    });

    tx.set(db.collection('notifications').doc(), {
      recipientId, type: 'gem_transfer',
      title: `+${net} gems received`,
      body: note || `${(senderSnap.data() || {}).username ? '@' + senderSnap.data().username : 'Someone'} sent you gems`,
      read: false,
      data: { type: 'gem_transfer', gems: net, fromUid: uid },
      createdAt: new Date(),
    });

    return { net, platformCut };
  });

  functions.logger.info('sendGems', { uid, recipientId, amount, ...result });
  return { ok: true, sent: amount, received: result.net, feePct: TRANSFER_FEE_PCT };
});
