// functions/eventTickets.js
// Ticketed-event commerce for tournaments. This is the NON-GAMBLING funding
// model: spectators (fans) buy tickets to watch/support an event; competitors
// never pay and ticket buyers can never win money.
//
// LEGAL INVARIANT (enforced here, not just in the UI):
//   - Ticket buyers are written to `event_tickets` ONLY. They are NEVER added
//     to `tournament.participants[]` and are NEVER read by the finalize payout
//     loop. A buyer who is already a competitor is rejected.
//   - Competitors register through the free path (joinTournamentSecure with
//     entryFee === 0) and are the only prize-eligible entries.
//
// Money model (mirrors sendTip in index.js):
//   platformFee     = floor(price * 0.10)        — flat 10% platform cut
//   purseContribution = floor(price * purseSlicePct/100) — host-set slice that
//                       funds the competitor prize purse (tournament.declaredPurse)
//   hostNet         = price - platformFee - purseContribution  — host's earnings
//
// All coin movement runs server-side inside a transaction so the client SDK
// can't credit balances directly.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const admin = require('firebase-admin');

if (admin.apps.length === 0) admin.initializeApp();
const db = getFirestore('vgrdb');

const HttpsError = functions.https.HttpsError;
const { settleEarnedShare, earnedCoinCredit } = require('./coinLedger');

const REGION = 'europe-west1';

function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');
  return uid;
}

// Deterministic doc id → one ticket per buyer per tournament (idempotent).
const ticketDocId = (tournamentId, uid) => `${tournamentId}_${uid}`;

// Audience gate. 'public' = anyone; 'followers' = buyer must follow the host;
// 'subscribers' = buyer must hold an active membership to the host. Reuses the
// existing `users/{host}/followers/{buyer}` subcollection + `member_subscriptions`.
async function assertAudienceAllowed(audience, buyerUid, hostUid, invitedUserIds = []) {
  if (!audience || audience === 'public') return;
  if (buyerUid === hostUid) return; // host always allowed
  if (audience === 'invite') {
    // Invite-only spectators: the host wants a private guest list buying
    // tickets, not the open public. Reuses the tournament's invitedUserIds.
    if (!Array.isArray(invitedUserIds) || !invitedUserIds.includes(buyerUid)) {
      throw new HttpsError('permission-denied', 'Tickets for this event are limited to invited guests.');
    }
    return;
  }
  if (audience === 'followers') {
    const f = await db.collection('users').doc(hostUid)
      .collection('followers').doc(buyerUid).get();
    if (!f.exists) {
      throw new HttpsError('permission-denied', 'Tickets are limited to followers — follow the host first.');
    }
    return;
  }
  if (audience === 'subscribers') {
    const sub = await db.collection('member_subscriptions')
      .where('userId', '==', buyerUid)
      .where('creatorId', '==', hostUid)
      .where('status', '==', 'active')
      .limit(1).get();
    if (sub.empty) {
      throw new HttpsError('permission-denied', 'Tickets are limited to the host\'s members.');
    }
  }
}

// ─── purchaseEventTicket ───────────────────────────────────────────────
// Buyer purchases a spectator ticket for a ticketed tournament.
exports.purchaseEventTicket = functions.https.onCall(
  { region: REGION, cors: true, secrets: ['VERGR_GEO_TOKEN'] },
  async (request) => {
    const uid = requireAuth(request);
    const { tournamentId, source = 'direct', kind = 'single' } = request.data || {};
    if (!tournamentId) throw new HttpsError('invalid-argument', 'tournamentId required');
    if (!['single', 'season_pass'].includes(kind)) {
      throw new HttpsError('invalid-argument', 'kind must be single | season_pass');
    }
    const validSources = ['direct', 'dm', 'squad', 'group', 'sharelink'];
    const src = validSources.includes(source) ? source : 'direct';

    const tRef = db.collection('tournaments').doc(tournamentId);

    // Pre-read for compliance + audience gates (can't run queries inside tx).
    const preSnap = await tRef.get();
    if (!preSnap.exists) throw new HttpsError('not-found', 'Event not found');
    const pre = preSnap.data();
    if (pre.fundingModel !== 'ticketed') {
      throw new HttpsError('failed-precondition', 'This event does not sell tickets.');
    }
    const price = Math.floor(pre.ticket?.priceCoins || 0);
    if (price <= 0) throw new HttpsError('failed-precondition', 'Event has no ticket price set.');

    await assertAudienceAllowed(pre.ticket?.audience || 'public', uid, pre.adminId, pre.invitedUserIds || []);

    // Paid action → KYC + region gate (same as paid tournament entry).
    const { assertRegionAllowed } = require('./geo');
    const { assertKycVerified }   = require('./didit');
    await assertRegionAllowed(request);
    await assertKycVerified(uid);

    return db.runTransaction(async (tx) => {
      const tSnap = await tx.get(tRef);
      if (!tSnap.exists) throw new HttpsError('not-found', 'Event not found');
      const t = tSnap.data();

      // Event must still be accepting tickets.
      if (!['open', 'active'].includes(t.status)) {
        throw new HttpsError('failed-precondition', 'Ticket sales are closed for this event.');
      }
      // LEGAL INVARIANT: a competitor can never buy a (prize-funding) ticket.
      if ((t.participants || []).includes(uid)) {
        throw new HttpsError('failed-precondition', 'Competitors can\'t buy spectator tickets for their own event.');
      }
      // Capacity.
      const capacity = Math.floor(t.ticket?.capacity || 0);
      const sold = Math.floor(t.ticket?.sold || 0);
      if (capacity > 0 && sold >= capacity) {
        throw new HttpsError('failed-precondition', 'Sold out.');
      }

      // Idempotency — one active ticket per buyer.
      const ticketRef = db.collection('event_tickets').doc(ticketDocId(tournamentId, uid));
      const existing = await tx.get(ticketRef);
      if (existing.exists && existing.data().status === 'active') {
        throw new HttpsError('already-exists', 'You already have a ticket for this event.');
      }

      const curPrice = Math.floor(t.ticket?.priceCoins || 0);
      const purseSlicePct = Math.max(0, Math.min(100, Math.floor(t.ticket?.purseSlicePct || 0)));

      // Wallets.
      const buyerWalletRef = db.collection('wallets').doc(uid);
      const hostWalletRef  = db.collection('wallets').doc(t.adminId);
      const buyerWallet = await tx.get(buyerWalletRef);
      if (!buyerWallet.exists) throw new HttpsError('failed-precondition', 'Wallet not found');
      const buyerBalance = buyerWallet.data().balance || 0;
      if (buyerBalance < curPrice) throw new HttpsError('failed-precondition', 'Insufficient coin balance');

      // ONE RATE (2026-08-14). The 10% surface fee is gone: the ticket price is
      // gross revenue and Vergr's share is taken once, at the revenue-share step
      // in coinLedger.js, when the host's earned coins become gems.
      //
      // The purse contribution is NOT a fee and stays exactly as it was. It is
      // the host voluntarily allocating a slice of their own revenue to the
      // prize pool, so it comes out of the host's side, not ours.
      const platformFee       = 0;
      const purseContribution = Math.floor(curPrice * (purseSlicePct / 100));
      const hostNet           = curPrice - purseContribution;

      // Debit buyer.
      tx.update(buyerWalletRef, {
        balance: FieldValue.increment(-curPrice),
        totalSpent: FieldValue.increment(curPrice),
        updatedAt: FieldValue.serverTimestamp(),
      });
      // Credit host net earnings.
      if (hostNet > 0) {
        tx.set(hostWalletRef, {
          // earnedCoinCredit supplies balance + earnedBalance +
          // totalEarnedCoinsGross. That last field is the input to the revenue
          // share ladder, and hand-rolling this write used to omit it, so
          // ticket revenue never moved a host up a tier.
          ...earnedCoinCredit(hostNet),
          totalEarned: FieldValue.increment(hostNet),
          totalReceived: FieldValue.increment(hostNet),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      // Grow the competitor prize purse + ticket counter.
      tx.update(tRef, {
        declaredPurse: FieldValue.increment(purseContribution),
        'ticket.sold': FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Ticket record (overwrites a prior 'refunded' doc for same buyer).
      tx.set(ticketRef, {
        tournamentId,
        buyerUid: uid,
        hostUid: t.adminId,
        pricePaid: curPrice,
        platformFee,
        hostNet,
        purseContribution,
        kind,
        source: src,
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
      });

      // Ledger + host notification.
      tx.set(db.collection('transactions').doc(), {
        userId: uid, type: 'event_ticket_purchase', amount: -curPrice,
        balance: buyerBalance - curPrice,
        tournamentId, hostId: t.adminId,
        description: `Ticket: ${t.name || 'Event'}`,
        createdAt: FieldValue.serverTimestamp(),
      });
      if (hostNet > 0) {
        tx.set(db.collection('transactions').doc(), {
          userId: t.adminId, type: 'event_ticket_sale', amount: hostNet,
          buyerId: uid, tournamentId, platformFee, purseContribution,
          description: `Ticket sale: ${t.name || 'Event'} (${curPrice} - ${platformFee} fee - ${purseContribution} purse)`,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      tx.set(db.collection('notifications').doc(), {
        recipientId: t.adminId, type: 'event_ticket', title: 'Ticket sold!',
        body: `Someone bought a ticket to ${t.name || 'your event'}.`,
        senderId: uid, read: false,
        data: { tournamentId }, actionUrl: `/tournaments/${tournamentId}`,
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        ok: true, ticketId: ticketRef.id,
        pricePaid: curPrice, platformFee, hostNet, purseContribution,
        soldAfter: sold + 1, capacity,
        hostUid: t.adminId,
      };
    }).then(async (r) => {
      // AUTO-CONVERT AT RECEIPT: the host's net becomes gems at their current
      // rate. Post-commit because the transaction writes the host wallet with
      // set/merge and never reads it, so there is no VP in scope to price with.
      if (r?.hostNet > 0 && r.hostUid) {
        await settleEarnedShare(db, {
          uid: r.hostUid, coins: r.hostNet,
          source: 'event_ticket', sourceId: `ticket:${r.ticketId}`,
        });
      }
      return r;
    });
  });

// ─── getEventTicketStatus ──────────────────────────────────────────────
// Read whether the caller holds a ticket + current sold/capacity. Used by
// the buy widget and the ticketed-stream watch gate.
exports.getEventTicketStatus = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    const { tournamentId } = request.data || {};
    if (!tournamentId) throw new HttpsError('invalid-argument', 'tournamentId required');
    const tSnap = await db.collection('tournaments').doc(tournamentId).get();
    if (!tSnap.exists) throw new HttpsError('not-found', 'Event not found');
    const t = tSnap.data();
    let hasTicket = false;
    if (uid) {
      const tk = await db.collection('event_tickets').doc(ticketDocId(tournamentId, uid)).get();
      hasTicket = tk.exists && tk.data().status === 'active';
    }
    // Season-pass holders of the host get access to all the host's ticketed
    // events without buying a per-event ticket.
    let viaSeasonPass = false;
    if (uid && !hasTicket && t.adminId && t.adminId !== uid) {
      const sp = await db.collection('event_season_passes').doc(`${t.adminId}_${uid}`).get();
      viaSeasonPass = sp.exists && (sp.data().expiresAt?.toMillis?.() || 0) > Date.now();
    }
    return {
      hasTicket: hasTicket || viaSeasonPass,
      viaSeasonPass,
      isCompetitor: !!uid && (t.participants || []).includes(uid),
      fundingModel: t.fundingModel || 'ticketed',
      priceCoins: Math.floor(t.ticket?.priceCoins || 0),
      sold: Math.floor(t.ticket?.sold || 0),
      capacity: Math.floor(t.ticket?.capacity || 0),
      audience: t.ticket?.audience || 'public',
      seasonPassEnabled: !!t.ticket?.seasonPassEnabled,
    };
  });

// ─── purchaseSeasonPass ────────────────────────────────────────────────
// A host-level pass granting access to ALL of a host's ticketed events for a
// window. Host config lives on `creators/{hostUid}.seasonPass` (set from the
// membership-tiers screen). Same 10%-fee money model as tickets.
exports.purchaseSeasonPass = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = requireAuth(request);
    const { hostUid } = request.data || {};
    if (!hostUid) throw new HttpsError('invalid-argument', 'hostUid required');
    if (uid === hostUid) throw new HttpsError('failed-precondition', 'You can\'t buy your own season pass.');

    const cSnap = await db.collection('creators').doc(hostUid).get();
    const sp = cSnap.exists ? cSnap.data().seasonPass : null;
    if (!sp || !sp.enabled) throw new HttpsError('failed-precondition', 'This host doesn\'t offer a season pass.');
    const price = Math.max(0, Math.floor(sp.priceCoins || 0));
    const durationDays = Math.max(1, Math.min(365, Math.floor(sp.durationDays || 30)));

    if (price > 0) {
      const { assertRegionAllowed } = require('./geo');
      const { assertKycVerified }   = require('./didit');
      await assertRegionAllowed(request);
      await assertKycVerified(uid);
    }

    const passRef = db.collection('event_season_passes').doc(`${hostUid}_${uid}`);
    return db.runTransaction(async (tx) => {
      const now = Date.now();
      const existing = await tx.get(passRef);
      if (existing.exists && (existing.data().expiresAt?.toMillis?.() || 0) > now) {
        throw new HttpsError('already-exists', 'You already have an active season pass.');
      }
      const buyerWalletRef = db.collection('wallets').doc(uid);
      const hostWalletRef = db.collection('wallets').doc(hostUid);
      const bw = await tx.get(buyerWalletRef);
      const balance = bw.exists ? (bw.data().balance || 0) : 0;
      if (balance < price) throw new HttpsError('failed-precondition', 'Insufficient coin balance');

      // ONE RATE (2026-08-14) — see the ticket path above. No surface fee; the
      // full pass price is gross revenue and the share is taken at conversion.
      const platformFee = 0;
      const hostNet = price;
      const expiresAt = new Date(now + durationDays * 86400000);

      tx.update(buyerWalletRef, {
        balance: FieldValue.increment(-price), totalSpent: FieldValue.increment(price),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (hostNet > 0) {
        tx.set(hostWalletRef, {
          // See the ticket-sale write above: earnedCoinCredit is what keeps
          // totalEarnedCoinsGross correct. This object also used to declare
          // totalEarned twice.
          ...earnedCoinCredit(hostNet),
          totalEarned: FieldValue.increment(hostNet),
          totalReceived: FieldValue.increment(hostNet), updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      tx.set(passRef, {
        hostUid, buyerUid: uid, pricePaid: price, platformFee, hostNet,
        name: sp.name || 'Season Pass', durationDays, expiresAt,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('transactions').doc(), {
        userId: uid, type: 'season_pass_purchase', amount: -price, hostId: hostUid,
        balance: balance - price, description: `Season pass: ${sp.name || 'pass'}`,
        createdAt: FieldValue.serverTimestamp(),
      });
      if (hostNet > 0) {
        tx.set(db.collection('transactions').doc(), {
          userId: hostUid, type: 'season_pass_sale', amount: hostNet, buyerId: uid,
          description: `Season pass sale (${price} - ${platformFee} fee)`,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      tx.set(db.collection('notifications').doc(), {
        recipientId: hostUid, type: 'season_pass', title: 'Season pass sold!',
        body: 'A fan bought your season pass.', senderId: uid, read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { ok: true, expiresAt: expiresAt.getTime(), hostUid, hostNet, passId: passRef.id };
    }).then(async (r) => {
      // Same rule as a single ticket: the host's share converts at receipt.
      if (r?.hostNet > 0 && r.hostUid) {
        await settleEarnedShare(db, {
          uid: r.hostUid, coins: r.hostNet,
          source: 'season_pass', sourceId: `pass:${r.passId}`,
        });
      }
      return r;
    });
  });

// Shared with `entitlements.js`, which sells access to posts, streams and
// messages and needs exactly the same follower/subscriber/invite rules. Exported
// rather than copied so a change to what "subscribers" means cannot apply to
// tickets and quietly not apply to unlocks.
exports.assertAudienceAllowed = assertAudienceAllowed;
