// GR6 — Coaching marketplace. Players list paid coaching slots; learners book
// and pay in coins (10% platform fee taken at book time — an exception to the
// revenue-share model, see FEE_RATE below — coach receives floor(price*0.9)).
//
//   coaching_listings/{uid} = { coachUid, active, game, title, pricePerSlot,
//     durationMin, blurb, coachName, coachUsername, coachAvatar, updatedAt }
//   coaching_bookings/{id}  = { coachUid, learnerUid, priceCoins, netCoins,
//     feeCoins, game, durationMin, status:'booked', threadId, createdAt }

const functions = require('firebase-functions/v2');
const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const MAX_PRICE = 100000;
// ⚠⚠ COACHING DOES NOT EXIST ON VERGR. This whole file is DEAD CODE from the
// retired tournaments build (it was GR6 in that punchlist). Verified 2026-09-02:
//   • `/coaching` is NOT routed in AppRouter
//   • `CoachingScreen` is imported by nothing
//   • none of these callables are exported from functions/index.js, so NOTHING
//     here is deployed — the 10% is charged to nobody because it never runs
//
// ⚠ SO THIS RATE IS NOT AN EXCEPTION TO THE REVENUE-SHARE MODEL AND MUST NOT BE
// CITED AS ONE. A previous session (mine, 2026-09-02) raised it to the founder as a
// live pricing decision; it is not one, and the evidence that it was dead was
// already on screen. **Check whether a thing is routed AND exported before calling
// its rate a policy.** The file stays on disk under the no-deletion rule.
//
// The comment that used to sit here also said “same as tips”, which was false
// independently: tips have no fee, `entitlements.feePctFor()` returns 0.
const FEE_RATE = 0.10;

exports.upsertCoachingListing = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const { game, title, pricePerSlot, durationMin, blurb, active = true } = request.data || {};
  const price = Math.floor(pricePerSlot || 0);
  const dur = Math.floor(durationMin || 0);
  if (!game || typeof game !== 'string') throw new HttpsError('invalid-argument', 'game required.');
  if (price <= 0 || price > MAX_PRICE) throw new HttpsError('invalid-argument', `Price must be 1–${MAX_PRICE} coins.`);
  if (dur <= 0 || dur > 480) throw new HttpsError('invalid-argument', 'Duration must be 1–480 minutes.');

  const u = (await db.collection('users').doc(uid).get()).data() || {};
  await db.collection('coaching_listings').doc(uid).set({
    coachUid: uid,
    active: !!active,
    game,
    title: String(title || '').slice(0, 80) || `${game} coaching`,
    pricePerSlot: price,
    durationMin: dur,
    blurb: String(blurb || '').slice(0, 400),
    coachName: u.displayName || u.username || 'Coach',
    coachUsername: u.username || null,
    coachAvatar: u.avatar || null,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true };
});

exports.setCoachingListingActive = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const { active } = request.data || {};
  await db.collection('coaching_listings').doc(uid).set(
    { active: !!active, updatedAt: FieldValue.serverTimestamp() }, { merge: true },
  );
  return { ok: true };
});

exports.bookCoaching = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const { coachUid } = request.data || {};
  if (!coachUid) throw new HttpsError('invalid-argument', 'coachUid required.');
  if (coachUid === uid) throw new HttpsError('failed-precondition', 'You cannot book yourself.');

  const threadId = [uid, coachUid].sort().join('_');
  const out = await db.runTransaction(async (tx) => {
    const lRef = db.collection('coaching_listings').doc(coachUid);
    const wRef = db.collection('wallets').doc(uid);
    const cwRef = db.collection('wallets').doc(coachUid);
    const [lSnap, wSnap] = await Promise.all([tx.get(lRef), tx.get(wRef)]);
    if (!lSnap.exists || !lSnap.data().active) throw new HttpsError('not-found', 'Coaching listing not available.');
    const listing = lSnap.data();
    const price = Math.floor(listing.pricePerSlot || 0);
    const bal = wSnap.exists ? (wSnap.data().balance || 0) : 0;
    if (bal < price) throw new HttpsError('failed-precondition', 'Insufficient coin balance.');

    const fee = Math.floor(price * FEE_RATE);
    const net = price - fee;

    tx.update(wRef, { balance: FieldValue.increment(-price), updatedAt: FieldValue.serverTimestamp() });
    tx.set(cwRef, {
      balance: FieldValue.increment(net),
      totalEarned: FieldValue.increment(net),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const bRef = db.collection('coaching_bookings').doc();
    tx.set(bRef, {
      coachUid, learnerUid: uid, priceCoins: price, netCoins: net, feeCoins: fee,
      game: listing.game || null, durationMin: listing.durationMin || null,
      status: 'booked', threadId, createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection('transactions').doc(), {
      userId: uid, type: 'coaching_payment', amount: -price,
      description: `Coaching: ${listing.title || listing.game}`, coachUid, createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection('transactions').doc(), {
      userId: coachUid, type: 'coaching_earning', amount: net,
      description: `Coaching booked (fee ${fee})`, learnerUid: uid, createdAt: FieldValue.serverTimestamp(),
    });
    return { bookingId: bRef.id, price, net };
  });

  // Open / tag a DM thread so the two can schedule the session.
  await db.collection('dm_threads').doc(threadId).set({
    participants: [uid, coachUid].sort(),
    coachingTags: FieldValue.arrayUnion(out.bookingId),
    lastActivity: FieldValue.serverTimestamp(),
  }, { merge: true });

  await db.collection('notifications').add({
    recipientId: coachUid, type: 'coaching_booked',
    title: 'New coaching booking',
    body: `${out.net} coins — open the chat to schedule the session.`,
    data: { bookingId: out.bookingId, threadId },
    actionUrl: `/messages/${threadId}`,
    read: false, createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, ...out, threadId };
});
