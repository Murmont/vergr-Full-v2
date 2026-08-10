// Tournament moderator assignment system.
//
// Flow:
//   1. onTournamentCreated  — when a tournament is created with a no-API
//      game + scheduled ≥1h ahead, create a `tournament_assignments` doc
//      with status='open'. Otherwise skip (auto-decided OR too-soon).
//   2. Mods CLAIM open slots via vanguardClaimTournament (validates schedule
//      conflicts, concurrent-cap, scheduled time ≥1h ahead).
//   3. Mods can RELEASE a claim via vanguardReleaseTournamentAssignment if
//      they cancel ≥1h before start (later than that = no-show).
//   4. vanguardCheckIn — mod confirms presence, activates 15 min before start.
//   5. notifyUpcomingAssignments cron — fires 15-min + 5-min reminders.
//   6. detectTournamentNoShows cron — runs every 5 min. If check-in not
//      received within 10 min after start, flips status to 'no_show',
//      reopens the slot, increments mod's strike count.
//
// Reward: at check-in, mod earns base actionVp × tournament tier multiplier.
// Treasury weight bonus applied at month-end during distribute cron via
// `assignmentWeightBonus` stamped on user doc.

const functions = require('firebase-functions/v2');
const defer = (_opts, fn) => fn; // cron-consolidation shim (see index.js cron5Min)
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { RANK_BY_ID } = require('./vanguardRanks');
const {
  AUTO_DECIDED_GAMES,
  gameDurationMin,
  tierForPrizePool,
  TIER_BRACKETS,
  MIN_SCHEDULING_BUFFER_MIN,
  CHECK_IN_OPEN_MIN_BEFORE,
  NO_SHOW_GRACE_MIN,
  MAX_CONCURRENT_ASSIGNMENTS,
  requiresManualMod,
} = require('./tournamentModeration');

const DB = 'vgrdb';
const HttpsError = functions.https.HttpsError;
const REGION = 'europe-west1';

const tsMs = (t) => {
  if (!t) return 0;
  if (t.toMillis) return t.toMillis();
  if (t.seconds) return t.seconds * 1000;
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  return 0;
};

// ───────────────────────────────────────────────────────────
// onTournamentCreated — Firestore trigger. Creates an assignment doc when
// the tournament needs a manual mod AND there's enough lead time.
// ───────────────────────────────────────────────────────────
exports.onTournamentCreated = functions.firestore.onDocumentCreated(
  { document: 'tournaments/{tournamentId}', region: REGION, database: DB },
  async (event) => {
    const tournament = event.data?.data();
    if (!tournament) return;
    const tournamentId = event.params.tournamentId;

    // Skip if auto-decided.
    if (!requiresManualMod(tournament)) return;

    // Need a scheduledStart in the future, with min buffer.
    const startMs = tsMs(tournament.startDate || tournament.scheduledStart);
    if (!startMs) return;
    const now = Date.now();
    const minStart = now + MIN_SCHEDULING_BUFFER_MIN * 60_000;
    if (startMs < minStart) {
      // Tournament starts too soon to assign a mod. Skip — host moderates
      // themselves or platform auto-resolves.
      return;
    }

    const game = tournament.game || 'Unknown';
    const durationMin = gameDurationMin(game) * (tournament.matchEstimate || 1);
    const tierKey = tierForPrizePool(tournament.prizePool);
    const tier = TIER_BRACKETS[tierKey];

    const db = admin.firestore(undefined, DB);
    await db.collection('tournament_assignments').add({
      tournamentId,
      tournamentName: tournament.name || 'Tournament',
      game,
      prizePool: Number(tournament.prizePool || 0),
      entryFee: Number(tournament.entryFee || 0),
      participantCount: Number(tournament.maxParticipants || 0),
      bannerUrl: tournament.bannerUrl || null,
      hostId: tournament.adminId || tournament.hostId || null,
      requiresManualMod: true,
      scheduledStart: tournament.startDate || tournament.scheduledStart,
      scheduledEnd:   new Date(startMs + durationMin * 60_000),
      estimatedDurationMin: durationMin,
      status: 'open',
      moderatorId: null,
      backupModeratorId: null,
      tier: tierKey,
      tierLabel: tier.label,
      vpMultiplier: tier.vpMult,
      weightMultiplier: tier.weightMult,
      claimedAt: null,
      checkedInAt: null,
      completedAt: null,
      noShowFlaggedAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
);

// ───────────────────────────────────────────────────────────
// vanguardClaimTournament — mod claims an open slot.
// ───────────────────────────────────────────────────────────
exports.vanguardClaimTournament = functions.https.onCall(
  { region: REGION },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;
    const { assignmentId } = req.data || {};
    if (!assignmentId) throw new HttpsError('invalid-argument', 'assignmentId required.');

    const db = admin.firestore(undefined, DB);

    // Caller must be active Vanguard (NOT Recruit, NOT founder — founder
    // picks own tournaments by another path).
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) throw new HttpsError('not-found', 'User not found.');
    const user = userSnap.data();
    const v = user.vanguard || {};
    if (!v.rank || v.status !== 'active') {
      throw new HttpsError('permission-denied', 'Active Vanguard members only.');
    }
    if (v.rank === 'recruit') {
      throw new HttpsError('permission-denied', 'Recruits cannot claim tournaments. Shadow your seniors.');
    }

    const aRef = db.collection('tournament_assignments').doc(assignmentId);

    return db.runTransaction(async (tx) => {
      const aSnap = await tx.get(aRef);
      if (!aSnap.exists) throw new HttpsError('not-found', 'Assignment not found.');
      const a = aSnap.data();
      if (a.status !== 'open') {
        throw new HttpsError('failed-precondition', `Already ${a.status}.`);
      }

      const startMs = tsMs(a.scheduledStart);
      const endMs = tsMs(a.scheduledEnd);
      const now = Date.now();
      if (startMs < now + MIN_SCHEDULING_BUFFER_MIN * 60_000) {
        throw new HttpsError('failed-precondition', `Tournament starts in less than ${MIN_SCHEDULING_BUFFER_MIN} minutes — too late to claim.`);
      }

      // Concurrent-cap + schedule-conflict check. Read all of caller's
      // upcoming/in-progress assignments — should be small (cap is 2).
      const mineSnap = await tx.get(
        db.collection('tournament_assignments')
          .where('moderatorId', '==', uid)
          .where('status', 'in', ['assigned', 'checked_in', 'in_progress'])
      );
      const active = mineSnap.docs.map(d => d.data());

      if (active.length >= MAX_CONCURRENT_ASSIGNMENTS) {
        throw new HttpsError('failed-precondition', `You already have ${active.length} active assignments (cap is ${MAX_CONCURRENT_ASSIGNMENTS}). Release one first.`);
      }

      // Schedule overlap?
      for (const other of active) {
        const oStart = tsMs(other.scheduledStart);
        const oEnd = tsMs(other.scheduledEnd);
        if (oStart < endMs && oEnd > startMs) {
          throw new HttpsError('failed-precondition', `Conflicts with your existing assignment for "${other.tournamentName}" (${new Date(oStart).toISOString()}).`);
        }
      }

      tx.update(aRef, {
        moderatorId: uid,
        status: 'assigned',
        claimedAt: FieldValue.serverTimestamp(),
      });

      // Notify host that a mod has claimed the slot.
      if (a.hostId) {
        tx.set(db.collection('notifications').doc(), {
          recipientId: a.hostId,
          type: 'tournament_moderator_assigned',
          title: 'A Vanguard claimed your tournament',
          body: `A Vanguard moderator will preside over "${a.tournamentName}" at the scheduled time.`,
          link: `/match/${a.tournamentId}`,
          createdAt: FieldValue.serverTimestamp(),
          read: false,
        });
      }

      return { ok: true, status: 'assigned' };
    });
  }
);

// ───────────────────────────────────────────────────────────
// vanguardReleaseTournamentAssignment — mod releases their claim. Must be
// done ≥1h before start (later = treat as no-show).
// ───────────────────────────────────────────────────────────
exports.vanguardReleaseTournamentAssignment = functions.https.onCall(
  { region: REGION },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;
    const { assignmentId, reason = '' } = req.data || {};
    if (!assignmentId) throw new HttpsError('invalid-argument', 'assignmentId required.');

    const db = admin.firestore(undefined, DB);
    const aRef = db.collection('tournament_assignments').doc(assignmentId);

    return db.runTransaction(async (tx) => {
      const aSnap = await tx.get(aRef);
      if (!aSnap.exists) throw new HttpsError('not-found', 'Assignment not found.');
      const a = aSnap.data();
      if (a.moderatorId !== uid) {
        throw new HttpsError('permission-denied', 'Not your assignment.');
      }
      if (a.status === 'completed' || a.status === 'no_show') {
        throw new HttpsError('failed-precondition', `Already ${a.status}.`);
      }

      const startMs = tsMs(a.scheduledStart);
      const cutoff = startMs - MIN_SCHEDULING_BUFFER_MIN * 60_000;
      const tooLate = Date.now() > cutoff;

      tx.update(aRef, {
        moderatorId: null,
        status: 'open',
        claimedAt: null,
        checkedInAt: null,
        lastReleaseReason: String(reason).slice(0, 300),
        lastReleasedBy: uid,
        lastReleasedAt: FieldValue.serverTimestamp(),
      });

      if (tooLate) {
        // Treated as no-show — log strike against the mod.
        tx.set(db.collection('vanguard_actions').doc(), {
          moderatorId: uid,
          action: 'tournament_no_show',
          targetType: 'tournament',
          targetId: a.tournamentId,
          rank: 'auto',
          reason: `Released within 1h of start: ${reason || '(no reason)'}`,
          takenAt: FieldValue.serverTimestamp(),
        });
        tx.update(db.collection('users').doc(uid), {
          'vanguard.noShowStrikes': FieldValue.increment(1),
          'vanguard.lastNoShowAt': FieldValue.serverTimestamp(),
        });
      }
      return { ok: true, status: 'open', flaggedAsNoShow: tooLate };
    });
  }
);

// ───────────────────────────────────────────────────────────
// vanguardCheckIn — mod confirms presence at the tournament. Activates
// 15 min before start.
// ───────────────────────────────────────────────────────────
exports.vanguardCheckIn = functions.https.onCall(
  { region: REGION },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;
    const { assignmentId } = req.data || {};
    if (!assignmentId) throw new HttpsError('invalid-argument', 'assignmentId required.');

    const db = admin.firestore(undefined, DB);
    const aRef = db.collection('tournament_assignments').doc(assignmentId);

    return db.runTransaction(async (tx) => {
      const aSnap = await tx.get(aRef);
      if (!aSnap.exists) throw new HttpsError('not-found', 'Assignment not found.');
      const a = aSnap.data();
      if (a.moderatorId !== uid) {
        throw new HttpsError('permission-denied', 'Not your assignment.');
      }
      if (a.status !== 'assigned' && a.status !== 'in_progress') {
        throw new HttpsError('failed-precondition', `Already ${a.status}.`);
      }

      const startMs = tsMs(a.scheduledStart);
      const checkInOpen = startMs - CHECK_IN_OPEN_MIN_BEFORE * 60_000;
      if (Date.now() < checkInOpen) {
        const minsToOpen = Math.ceil((checkInOpen - Date.now()) / 60_000);
        throw new HttpsError('failed-precondition', `Check-in opens ${CHECK_IN_OPEN_MIN_BEFORE} min before start. Try again in ${minsToOpen} min.`);
      }

      // Grant VP at check-in (tier-multiplied per-action grant). The mod
      // earns more for their actual decisions later, but this is the
      // turn-up reward so showing up is always paid.
      const userSnap = await tx.get(db.collection('users').doc(uid));
      const u = userSnap.data() || {};
      const rankMeta = RANK_BY_ID[u.vanguard?.rank];
      const baseVp = rankMeta?.actionVp || 0;
      const vpAward = Math.round(baseVp * (a.vpMultiplier || 1));

      tx.update(aRef, {
        status: 'checked_in',
        checkedInAt: FieldValue.serverTimestamp(),
      });

      // Treasury-weight bonus stamp for the month — picked up by the
      // monthly cron when computing share.
      const monthKey = (() => {
        const d = new Date();
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      })();
      tx.set(db.collection('users').doc(uid), {
        vanguard: {
          assignmentWeightBonus: { [monthKey]: FieldValue.increment(a.weightMultiplier || 1) },
        },
      }, { merge: true });

      if (vpAward > 0) {
        tx.set(db.collection('wallets').doc(uid), {
          vp: FieldValue.increment(vpAward),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        tx.set(db.collection('transactions').doc(), {
          userId: uid,
          type: 'vanguard_assignment_checkin_vp',
          amount: vpAward,
          currency: 'vp',
          description: `Tournament check-in — ${a.tournamentName} (${a.tierLabel}, ${a.vpMultiplier}×)`,
          assignmentId,
          tournamentId: a.tournamentId,
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      tx.set(db.collection('vanguard_actions').doc(), {
        moderatorId: uid,
        action: 'tournament_checkin',
        targetType: 'tournament',
        targetId: a.tournamentId,
        assignmentId,
        rank: u.vanguard?.rank,
        tier: a.tier,
        vpAwarded: vpAward,
        takenAt: FieldValue.serverTimestamp(),
      });

      return { ok: true, status: 'checked_in', vpGranted: vpAward };
    });
  }
);

// ───────────────────────────────────────────────────────────
// vanguardCompleteAssignment — mod marks assignment complete after
// tournament finalizes. (Auto-called when tournament status flips to
// 'completed' via a different trigger — this manual callable is a
// fallback for stuck assignments.)
// ───────────────────────────────────────────────────────────
exports.vanguardCompleteAssignment = functions.https.onCall(
  { region: REGION },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;
    const { assignmentId } = req.data || {};
    if (!assignmentId) throw new HttpsError('invalid-argument', 'assignmentId required.');

    const db = admin.firestore(undefined, DB);
    const aRef = db.collection('tournament_assignments').doc(assignmentId);
    const aSnap = await aRef.get();
    if (!aSnap.exists) throw new HttpsError('not-found', 'Assignment not found.');
    const a = aSnap.data();
    if (a.moderatorId !== uid) throw new HttpsError('permission-denied', 'Not your assignment.');
    if (a.status === 'completed') return { ok: true, alreadyCompleted: true };

    await aRef.update({
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  }
);

// ───────────────────────────────────────────────────────────
// detectTournamentNoShows — scheduled function. Every 5 min, finds
// assignments whose scheduledStart was >NO_SHOW_GRACE_MIN ago and status
// is still 'assigned' (i.e. mod never checked in). Flips to 'no_show',
// reopens slot.
// ───────────────────────────────────────────────────────────
exports.detectTournamentNoShows = defer(
  { schedule: 'every 5 minutes', timeZone: 'UTC', region: REGION },
  async () => {
    const db = admin.firestore(undefined, DB);
    const cutoff = new Date(Date.now() - NO_SHOW_GRACE_MIN * 60_000);
    const snap = await db.collection('tournament_assignments')
      .where('status', '==', 'assigned')
      .where('scheduledStart', '<', cutoff)
      .limit(100)
      .get();

    if (snap.empty) return;
    const batch = db.batch();
    for (const doc of snap.docs) {
      const a = doc.data();
      const modUid = a.moderatorId;

      // Flip assignment back to 'open', remove the mod, stamp no-show.
      batch.update(doc.ref, {
        status: 'open',
        moderatorId: null,
        claimedAt: null,
        noShowFlaggedAt: FieldValue.serverTimestamp(),
        noShowModeratorId: modUid,
      });

      if (modUid) {
        // Strike count bump.
        batch.set(db.collection('users').doc(modUid), {
          vanguard: {
            noShowStrikes: FieldValue.increment(1),
            lastNoShowAt: FieldValue.serverTimestamp(),
          },
        }, { merge: true });

        // Audit trail.
        batch.set(db.collection('vanguard_actions').doc(), {
          moderatorId: modUid,
          action: 'tournament_no_show',
          targetType: 'tournament_assignment',
          targetId: doc.id,
          tournamentId: a.tournamentId,
          rank: 'auto',
          takenAt: FieldValue.serverTimestamp(),
        });

        // Notify the no-show mod.
        batch.set(db.collection('notifications').doc(), {
          recipientId: modUid,
          type: 'tournament_no_show',
          title: `Missed assignment: ${a.tournamentName}`,
          body: `You didn't check in within ${NO_SHOW_GRACE_MIN} min of the scheduled start. A strike has been logged on your record.`,
          link: '/vanguard/schedule',
          createdAt: FieldValue.serverTimestamp(),
          read: false,
        });
      }
    }
    await batch.commit();
  }
);

// ───────────────────────────────────────────────────────────
// notifyUpcomingAssignments — every 15 min, send 15-min + 5-min reminders.
// (Idempotent via flags on the assignment doc.)
// ───────────────────────────────────────────────────────────
exports.notifyUpcomingAssignments = defer(
  { schedule: 'every 15 minutes', timeZone: 'UTC', region: REGION },
  async () => {
    const db = admin.firestore(undefined, DB);
    const now = Date.now();
    const horizon = new Date(now + 30 * 60_000); // anything starting in next 30 min
    const snap = await db.collection('tournament_assignments')
      .where('status', '==', 'assigned')
      .where('scheduledStart', '<=', horizon)
      .limit(100)
      .get();

    if (snap.empty) return;
    const batch = db.batch();
    let writes = 0;
    for (const doc of snap.docs) {
      const a = doc.data();
      if (!a.moderatorId) continue;
      const startMs = tsMs(a.scheduledStart);
      const minsToStart = Math.round((startMs - now) / 60_000);

      // 15-min ping (open window: 10-20 min before start).
      if (minsToStart >= 10 && minsToStart <= 20 && !a.notified15) {
        batch.update(doc.ref, { notified15: true });
        batch.set(db.collection('notifications').doc(), {
          recipientId: a.moderatorId,
          type: 'tournament_assignment_reminder',
          title: `${minsToStart} min until ${a.tournamentName}`,
          body: 'Your assigned tournament starts soon. Open it now to check in.',
          link: '/vanguard/schedule',
          createdAt: FieldValue.serverTimestamp(),
          read: false,
        });
        writes++;
      }
      // 5-min ping.
      if (minsToStart >= 0 && minsToStart <= 6 && !a.notified5) {
        batch.update(doc.ref, { notified5: true });
        batch.set(db.collection('notifications').doc(), {
          recipientId: a.moderatorId,
          type: 'tournament_assignment_reminder',
          title: `${a.tournamentName} starts in ${Math.max(0, minsToStart)} min`,
          body: `Check in NOW. After +${NO_SHOW_GRACE_MIN} min you'll be flagged as a no-show.`,
          link: '/vanguard/schedule',
          createdAt: FieldValue.serverTimestamp(),
          read: false,
        });
        writes++;
      }
    }
    if (writes > 0) await batch.commit();
  }
);
