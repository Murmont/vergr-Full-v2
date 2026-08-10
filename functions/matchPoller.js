// functions/matchPoller.js
// Per-tournament-match auto-result detection using the Tier B wrappers.
//
// Lifecycle:
//   1. When a match doc is created with status='pending' inside an active
//      tournament, the Firestore trigger `onMatchCreated` looks up the
//      tournament's game, finds the matching wrapper, resolves both
//      players' handles from `linkedAccounts`, and snapshots their stats.
//      → writes `tournaments/{tid}/matches/{mid}/wrapperState/state`.
//      Skipped silently when the game has no wrapper, no handles, or only
//      one player has a handle (auto-detection needs both sides).
//
//   2. The scheduled scanner `pollActiveWrapperMatches` runs every 5 min,
//      reads all `wrapperState` docs with status='polling' where the next
//      poll is due (cooldown), fetches fresh stats, computes deltas via
//      the wrapper's `statsDelta`, and:
//        - one player's wins ↑ and the other unchanged → resolve winner,
//          call `_internal_recordMatchResult` with source='gameapi'.
//        - both players' wins ↑ → ambiguous, fall back to manual.
//        - neither played → keep polling until timeout.
//        - timeout (default 2h) → mark 'timed_out', leave for manual.
//
// Trust level: wrapper-detected results are TRUSTED for advancing the
// bracket (same as GSI). The manual-confirmation step is bypassed because
// the wrapper read each player's authoritative game stats.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const admin = require('firebase-admin');

if (admin.apps.length === 0) admin.initializeApp();
const db = getFirestore('vgrdb');

const { getWrapperForGame, getHandleLocation, collectSecrets } = require('./wrappers');
const tournaments = require('./tournaments');

const WRAPPER_SECRETS = collectSecrets();

const POLL_INTERVAL_MS = 5 * 60 * 1000;        // 5 minutes between polls
const POLL_TIMEOUT_MS  = 2 * 60 * 60 * 1000;   // 2-hour ceiling per match

function stateRef(tournamentId, matchId) {
  return db.collection('tournaments').doc(tournamentId)
    .collection('matches').doc(matchId)
    .collection('wrapperState').doc('state');
}

// Look up a player's handle for a given wrapper. Returns null if missing.
async function resolveHandle(uid, wrapperId) {
  const loc = getHandleLocation(wrapperId);
  if (!loc) return null;
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return null;
  const linked = userSnap.data().linkedAccounts || {};
  const account = linked[loc.platformKey];
  if (!account) return null;
  if (loc.fieldOnAccount) return account[loc.fieldOnAccount] || null;
  // Account is either a bare string (legacy) or an object with username.
  if (typeof account === 'string') return account;
  return account.username || account.handle || null;
}

// ─── Firestore trigger: snapshot at match creation ────────────────────
exports.onMatchCreated = functions.firestore.onDocumentCreated(
  {
    document: 'tournaments/{tournamentId}/matches/{matchId}',
    region: 'europe-west1',
    database: 'vgrdb',
    secrets: WRAPPER_SECRETS,
  },
  async (event) => {
    const matchId = event.params.matchId;
    const tournamentId = event.params.tournamentId;
    const m = event.data?.data();
    if (!m) return;
    if (m.status !== 'pending') return;             // skip auto-completed byes
    if (!m.player1 || !m.player2) return;

    const tSnap = await db.collection('tournaments').doc(tournamentId).get();
    if (!tSnap.exists) return;
    const t = tSnap.data();
    const wrapper = getWrapperForGame(t.game);
    if (!wrapper) return;                           // no auto-detection for this game

    const [h1, h2] = await Promise.all([
      resolveHandle(m.player1, wrapper.id),
      resolveHandle(m.player2, wrapper.id),
    ]);
    if (!h1 || !h2) {
      await stateRef(tournamentId, matchId).set({
        wrapper: wrapper.id, status: 'no_handles',
        player1: { uid: m.player1, handle: h1 || null },
        player2: { uid: m.player2, handle: h2 || null },
        createdAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    let snap1 = null, snap2 = null;
    try {
      [snap1, snap2] = await Promise.all([
        wrapper.fetchPlayerStats(h1),
        wrapper.fetchPlayerStats(h2),
      ]);
    } catch (err) {
      console.error(`onMatchCreated snapshot failed for ${matchId}`, err?.message);
      await stateRef(tournamentId, matchId).set({
        wrapper: wrapper.id, status: 'snapshot_failed',
        error: err?.message || String(err),
        createdAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    const now = Date.now();
    await stateRef(tournamentId, matchId).set({
      wrapper: wrapper.id,
      status: 'polling',
      player1: { uid: m.player1, handle: h1, snapshot: snap1 },
      player2: { uid: m.player2, handle: h2, snapshot: snap2 },
      pollCount: 0,
      startedPollingAt: FieldValue.serverTimestamp(),
      lastPolledAt: null,
      timeoutAt: Timestamp.fromMillis(now + POLL_TIMEOUT_MS),
      createdAt: FieldValue.serverTimestamp(),
    });
  }
);

// ─── Scheduled poller (every 5 min) ───────────────────────────────────
exports.pollActiveWrapperMatches = functions.scheduler.onSchedule(
  { schedule: 'every 5 minutes', region: 'europe-west1', timeZone: 'UTC', secrets: WRAPPER_SECRETS },
  async () => {
    // Cross-tournament: collectionGroup query on the wrapperState subcoll.
    const dueBefore = Timestamp.fromMillis(Date.now() - POLL_INTERVAL_MS);
    const snap = await db.collectionGroup('wrapperState')
      .where('status', '==', 'polling')
      .where('lastPolledAt', '<', dueBefore)
      .limit(20)
      .get();

    // Fall through if no docs match (also covers the lastPolledAt=null case
    // which won't match `<` — separate fetch for first-time polls).
    const firstSnap = await db.collectionGroup('wrapperState')
      .where('status', '==', 'polling')
      .where('lastPolledAt', '==', null)
      .limit(20)
      .get();

    const allDocs = [...snap.docs, ...firstSnap.docs];
    if (allDocs.length === 0) {
      console.log('matchPoller: no active matches to poll');
      return;
    }

    for (const doc of allDocs) {
      try {
        await pollOne(doc);
      } catch (err) {
        console.error(`pollOne failed for ${doc.ref.path}`, err?.message);
      }
    }
  }
);

async function pollOne(stateDoc) {
  const state = stateDoc.data();
  const tournamentId = stateDoc.ref.parent.parent.parent.parent.id;
  const matchId      = stateDoc.ref.parent.parent.id;

  // Bail if status changed since query.
  if (state.status !== 'polling') return;

  // Timeout check.
  const timeoutMs = state.timeoutAt?.toMillis?.() || 0;
  if (timeoutMs && Date.now() > timeoutMs) {
    await stateDoc.ref.update({
      status: 'timed_out',
      timedOutAt: FieldValue.serverTimestamp(),
    });
    console.log(`matchPoller: ${matchId} timed out`);
    return;
  }

  const { getWrapper } = require('./wrappers');
  const wrapper = getWrapper(state.wrapper);
  if (!wrapper) {
    await stateDoc.ref.update({ status: 'wrapper_missing' });
    return;
  }

  const [now1, now2] = await Promise.all([
    wrapper.fetchPlayerStats(state.player1.handle),
    wrapper.fetchPlayerStats(state.player2.handle),
  ]);

  const d1 = wrapper.statsDelta(state.player1.snapshot, now1);
  const d2 = wrapper.statsDelta(state.player2.snapshot, now2);

  const p1Played = !!d1?.played;
  const p2Played = !!d2?.played;
  const p1Won = !!d1?.won;
  const p2Won = !!d2?.won;

  // Both players gained a win → played different matches → ambiguous.
  if (p1Won && p2Won) {
    await stateDoc.ref.update({
      status: 'ambiguous',
      ambiguousAt: FieldValue.serverTimestamp(),
      lastPolledAt: FieldValue.serverTimestamp(),
      pollCount: FieldValue.increment(1),
      lastDeltas: { p1: d1, p2: d2 },
    });
    console.log(`matchPoller: ${matchId} ambiguous — both players gained a win`);
    return;
  }

  // Neither played in the polling window → keep polling.
  if (!p1Played && !p2Played) {
    await stateDoc.ref.update({
      lastPolledAt: FieldValue.serverTimestamp(),
      pollCount: FieldValue.increment(1),
    });
    return;
  }

  // Exactly one player has a fresh win → resolve winner.
  // Edge case: both played, only one won → that's also a clean resolution
  // (the other player played and lost the same match).
  let winnerUid = null;
  if (p1Won && !p2Won) winnerUid = state.player1.uid;
  else if (p2Won && !p1Won) winnerUid = state.player2.uid;
  // Loss-only case: one player's gamesPlayed went up but no wins, AND
  // the other didn't play at all → can't safely conclude (the loser may
  // have been in a different match). Keep polling.
  if (!winnerUid) {
    await stateDoc.ref.update({
      lastPolledAt: FieldValue.serverTimestamp(),
      pollCount: FieldValue.increment(1),
      lastDeltas: { p1: d1, p2: d2 },
    });
    return;
  }

  try {
    await tournaments._internal_recordMatchResult({
      tournamentId,
      matchId,
      winnerId: winnerUid,
      reporterUid: winnerUid,    // self-report on behalf of the winner
      source: 'gameapi',
    });
    await stateDoc.ref.update({
      status: 'resolved',
      resolvedWinnerUid: winnerUid,
      resolvedAt: FieldValue.serverTimestamp(),
      lastPolledAt: FieldValue.serverTimestamp(),
      pollCount: FieldValue.increment(1),
    });
    console.log(`matchPoller: ${matchId} resolved → ${winnerUid}`);
  } catch (err) {
    console.error(`matchPoller: failed to record result for ${matchId}`, err?.message);
    await stateDoc.ref.update({
      lastPolledAt: FieldValue.serverTimestamp(),
      pollCount: FieldValue.increment(1),
      lastError: err?.message || String(err),
    });
  }
}
