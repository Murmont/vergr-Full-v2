/**
 * Ticketed EVENTS.
 *
 * ## What an event is, and what it is NOT
 *
 * Founder ruling 2026-08-16: *"tickets should still exist but they are not about
 * tournaments anymore, they are live events or anything a user would want to
 * have an event"*.
 *
 * An event is ANY thing a user wants to host and sell a ticket to: a live show,
 * a watch party, a Q&A, a listening session, a launch, a class, a community
 * night. Fans buy a ticket to attend. That is the entire product.
 *
 * There are **no competitors, no prize purse, no brackets, no entry fees and no
 * winners**. Tournaments are retired and their money-moving callables throw
 * (`functions/tournaments.js`), which is exactly why this file exists rather
 * than reopening `createTournamentSecure`: an event must not be able to grow
 * back into a tournament through a shared code path.
 *
 * ## Why events still live in the `tournaments` collection
 *
 * They predate the rename and `purchaseEventTicket`, `EventLandingScreen`,
 * `EventPickerModal` and `getUserTournaments` all read from there. Migrating the
 * collection is a data move with no user-visible benefit, so the NAMES stay and
 * the product does not. Do not read `adminId` / `tournaments` / `purseSlicePct`
 * and conclude an event is a tournament, and never surface that vocabulary.
 *
 * ## Money
 *
 * The ticket price is gross revenue Vergr earns, and the host accrues their
 * revenue share of it (50-80% by lifetime earnings, `coinLedger.js`). There is
 * no per-surface fee. `purseSlicePct` is forced to 0 here: it funded a
 * competitor prize purse, which no longer exists.
 */

const functions = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

if (admin.apps.length === 0) admin.initializeApp();
const db = getFirestore('vgrdb');

const HttpsError = functions.https.HttpsError;
const REGION = 'europe-west1';

// Ticket price ceiling. Deliberately generous but finite: an unbounded price is
// a fat-finger away from a support ticket, and a cap is trivial to raise.
const MAX_TICKET_COINS = 100_000;
const MAX_CAPACITY = 100_000;

// What a host can say the event IS. Kept short on purpose: a long taxonomy
// invites the "which one is a tournament" question all over again.
const EVENT_KINDS = [
  'live',       // a live show / stream
  'watch',      // watch party
  'talk',       // Q&A, AMA, interview
  'music',      // listening session, DJ set, performance
  'class',      // workshop, coaching session, tutorial
  'community',  // meetup, hangout, community night
  'other',
];

const AUDIENCES = ['public', 'followers', 'subscribers', 'invite'];

function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  if (request.auth.token?.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('permission-denied', 'Guest accounts cannot host events.');
  }
  return uid;
}

const clampStr = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Create a ticketed event.
 *
 * Server-side rather than a client write, even though `firestore.rules` would
 * currently allow the create: the doc decides what a buyer is charged, so the
 * shape has to be built somewhere a user cannot set `prizePool`, `entryFee` or
 * an arbitrary `sold` count.
 */
exports.createEventSecure = functions.https.onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const d = request.data || {};

  const name = clampStr(d.name, 80);
  if (name.length < 3) throw new HttpsError('invalid-argument', 'Give your event a name (at least 3 characters).');

  const description = clampStr(d.description, 2000);
  const kind = EVENT_KINDS.includes(d.kind) ? d.kind : 'other';
  const audience = AUDIENCES.includes(d.audience) ? d.audience : 'public';

  const priceCoins = Math.max(0, Math.floor(Number(d.priceCoins) || 0));
  if (priceCoins > MAX_TICKET_COINS) {
    throw new HttpsError('invalid-argument', `Ticket price cannot exceed ${MAX_TICKET_COINS.toLocaleString()} coins.`);
  }
  // 0 capacity means unlimited, which is a real choice for an online event.
  const capacity = Math.max(0, Math.floor(Number(d.capacity) || 0));
  if (capacity > MAX_CAPACITY) {
    throw new HttpsError('invalid-argument', 'Capacity is too large.');
  }

  const startsAt = Number(d.startsAt) || 0;
  if (!startsAt) throw new HttpsError('invalid-argument', 'Pick a date and time for your event.');
  if (startsAt < Date.now() - 60 * 60 * 1000) {
    throw new HttpsError('invalid-argument', 'That start time is in the past.');
  }

  const bannerUrl = typeof d.bannerUrl === 'string' && /^https:\/\//.test(d.bannerUrl)
    ? d.bannerUrl.slice(0, 500)
    : null;

  const ref = db.collection('tournaments').doc();
  await ref.set({
    // ── identity ──
    name,
    description,
    eventKind: kind,
    isEvent: true,              // the honest flag; `tournaments` is a legacy path
    bannerUrl,

    // ── ownership. `adminId` is what purchaseEventTicket credits and what
    //    getUserTournaments queries; `organizerId` is what firestore.rules
    //    checks on update. Both must be the host. ──
    adminId: uid,
    organizerId: uid,
    hostUid: uid,

    // ── schedule ──
    scheduledStart: startsAt,
    status: 'open',

    // ── tickets ──
    fundingModel: 'ticketed',
    ticket: {
      priceCoins,
      capacity,
      sold: 0,
      audience,
      // Funded a competitor prize purse. There are no competitors and no purse,
      // so it is pinned at 0 and must stay there.
      purseSlicePct: 0,
    },
    invitedUserIds: [],

    // ── explicitly NOT a tournament ──
    // No entryFee, no prizePool, no bracket, no game requirement, no maxParticipants.
    // `participants` stays empty: an event has an audience, not competitors. It
    // exists only because purchaseEventTicket reads it.
    participants: [],

    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, eventId: ref.id };
});

/**
 * Close an event so it stops selling tickets. The host's own off-switch, so
 * they never have to ask support.
 */
exports.closeEventSecure = functions.https.onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const { eventId } = request.data || {};
  if (!eventId) throw new HttpsError('invalid-argument', 'eventId required');

  const ref = db.collection('tournaments').doc(String(eventId));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Event not found');
  const t = snap.data();
  if (t.adminId !== uid) throw new HttpsError('permission-denied', 'Only the host can close this event.');
  if (t.fundingModel !== 'ticketed') throw new HttpsError('failed-precondition', 'Not a ticketed event.');

  await ref.update({ status: 'completed', updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

exports.EVENT_KINDS = EVENT_KINDS;
