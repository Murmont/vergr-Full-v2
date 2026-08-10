// VERGR tournament participant Summons.
//
// Mirrors infra/vanguardAssignments.js but for the players themselves. The
// existing flow notifies participants ONCE when startTournamentSecure runs —
// by then they're already at risk of being marked no-show. This module adds:
//
//   1. tournamentParticipantCheckIn — callable, marks them ready.
//   2. getTournamentPreflight — callable, returns the per-game readiness
//      checklist (Steam connected? Riot ID set? Vergr handle visible?).
//   3. summonsParticipants cron (every 1 min) — fires 15-min / 5-min / 1-min
//      "Tournament starting" pushes to anyone who hasn't checked in.
//   4. detectParticipantNoShows cron (every 5 min) — past start + grace,
//      mark stragglers as no-show and refund their entry pro-rata.
//
// Data model addition on `tournaments/{id}`:
//   - participantState: {
//       [uid]: { checkedInAt, summonsStage, summonsLastSentAt, noShowAt, refundedAt }
//     }

const functions = require('firebase-functions/v2');
// Cron-consolidation shim: drops the schedule wrapper, exports the raw handler
// so index.js's cronMinute dispatcher invokes it (one Scheduler job, same cadence).
const defer = (_opts, fn) => fn;
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const { gameById } = require('./games');

// Wrapper IDs for Tier-B community-stats games. Keep in sync with
// functions/wrappers/.
const WRAPPER_ID = {
  overwatch2: 'overwatch2',
  apex:       'apex',
};

const DETECTION_COPY = {
  gsi:     'Result detected by Valve Game State Integration (auto).',
  wrapper: 'Result detected by the game\'s stats API (auto).',
  ocr:     'Result verified by AI OCR of your live stream + a Vanguard mod.',
  manual:  'Result reported by both players; mod resolves disagreements.',
};

const DETECTION_INSTRUCTIONS = {
  gsi:     'Install the GSI config (Settings → Linked Accounts → Install GSI), then launch the game with VERGR open in the background.',
  wrapper: 'Make sure your platform profile is set to PUBLIC so the stats wrapper can read your career wins.',
  ocr:     'Start a live stream to VERGR before the match starts. Two AI OCR signals read your scoreboard and a Vanguard mod confirms the winner.',
  manual:  'After the match, both players hit "I won" / "they won". A Vanguard mod resolves disagreements.',
};

function reqForGame(game) {
  const g = gameById(game);
  if (!g) return { detection: 'manual', platforms: [], wrapperId: null };
  return {
    detection: g.detection,
    platforms: g.linkedPlatform ? [g.linkedPlatform] : [],
    wrapperId: WRAPPER_ID[g.id] || null,
    verifyMethod: g.verifyMethod,
  };
}

async function loadTournament(tournamentId) {
  if (!tournamentId) throw new functions.https.HttpsError('invalid-argument', 'tournamentId required.');
  const ref = db.collection('tournaments').doc(tournamentId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Tournament not found.');
  return { ref, data: snap.data() };
}

// ─────────────────────────────────────────────────────────────────────────────
// getTournamentPreflight — what does the user need to do to be ready?
// Returns: { ready, requirements: [{key, label, ok, hint}], detection, ... }
// ─────────────────────────────────────────────────────────────────────────────
exports.getTournamentPreflight = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { tournamentId } = req.data || {};
  const { data: t } = await loadTournament(tournamentId);

  if (!(t.participants || []).includes(uid)) {
    throw new functions.https.HttpsError('permission-denied', 'Not a participant in this tournament.');
  }

  const userSnap = await db.collection('users').doc(uid).get();
  const userData = userSnap.exists ? userSnap.data() : {};
  const linkedAccounts = userData.linkedAccounts || {};

  const game = t.game || t.gameId || 'other';
  const requirement = reqForGame(game);

  const checks = [];

  // ── GSI heartbeat check (CS2 / Dota 2) ──────────────────────────────
  // Don't just check that Steam is linked — check that the GSI .cfg is
  // genuinely installed and pinging us. Heartbeat freshness is the truth.
  if (requirement.detection === 'gsi') {
    const steam = linkedAccounts.steam;
    const gsiToken = steam?.gsiToken || null;
    let gsiHeartbeatMs = null;
    if (gsiToken) {
      try {
        const tk = await db.collection('gsi_tokens').doc(gsiToken).get();
        if (tk.exists) {
          gsiHeartbeatMs = tk.data().lastSeenAt?.toMillis?.() || null;
        }
      } catch { /* swallow */ }
    }
    const steamLinked = !!steam?.steamId64;
    const gsiAlive = !!gsiHeartbeatMs && (Date.now() - gsiHeartbeatMs) < 24 * 60 * 60 * 1000;
    checks.push({
      key: 'steam:linked',
      label: 'Steam account linked',
      ok: steamLinked,
      hint: steamLinked ? null : 'Connect Steam in Settings → Linked Accounts.',
      action: steamLinked ? null : { kind: 'link', platform: 'steam' },
    });
    checks.push({
      key: 'gsi:installed',
      label: gsiAlive ? 'GSI config installed (live)' : 'GSI config not detected',
      ok: gsiAlive,
      hint: gsiAlive ? null
        : (steamLinked
          ? 'Open Settings → Linked Accounts and tap "Install GSI" for this game. Then launch the game once so it pings VERGR.'
          : 'Link Steam first, then install GSI.'),
      action: gsiAlive ? null : { kind: 'gsi-install', game },
    });
  }

  // ── Wrapper check (Tier B: OW2 / Apex) ──────────────────────────────
  if (requirement.detection === 'wrapper') {
    const platform = requirement.platforms[0];
    const acc = linkedAccounts[platform];
    const handle = acc ? (acc.username || acc.handle || (typeof acc === 'string' ? acc : null)) : null;
    checks.push({
      key: `account:${platform}`,
      label: `${platformLabel(platform)} handle set`,
      ok: !!handle,
      hint: handle ? null : `Add your ${platformLabel(platform)} handle in Settings → Linked Accounts.`,
      action: handle ? null : { kind: 'link', platform },
    });
    // Wrapper health.
    let wrapperOk = true; let wrapperReason = null;
    try {
      const alertSnap = await db.collection('wrapper_alerts')
        .where('wrapperId', '==', requirement.wrapperId)
        .where('resolved', '==', false)
        .limit(1).get();
      if (!alertSnap.empty) {
        wrapperOk = false;
        wrapperReason = alertSnap.docs[0].data().reason || 'Wrapper reported unhealthy';
      }
    } catch { /* missing index — treat as ok */ }
    checks.push({
      key: 'wrapper:health',
      label: wrapperOk ? 'Stats API is live' : 'Stats API is offline',
      ok: wrapperOk,
      hint: wrapperOk ? null : (wrapperReason + ' — Vanguard mod will verify your result manually instead.'),
      action: null,
    });
  }

  // ── OCR-tier check: requires being live on VERGR during the match ───
  if (requirement.detection === 'ocr') {
    // Look up an active stream for this user (status created/live). We can't
    // require it to be "live" right now since the match hasn't started.
    let hasStream = false;
    try {
      const sSnap = await db.collection('streams')
        .where('hostUid', '==', uid)
        .where('status', 'in', ['created', 'live'])
        .limit(1).get();
      hasStream = !sSnap.empty;
    } catch { /* fall through */ }
    checks.push({
      key: 'stream:provisioned',
      label: hasStream ? 'Stream session ready' : 'Stream to VERGR not started',
      ok: hasStream,
      hint: hasStream ? null : 'OCR verification requires you to be streaming to VERGR. Tap Go Live before your match starts.',
      action: hasStream ? null : { kind: 'go-live' },
    });
    // Account is optional for OCR detection but useful for the mod's identity
    // stamp. We surface as a soft suggestion, not a blocker.
    for (const platform of requirement.platforms) {
      const acc = linkedAccounts[platform];
      const ok = !!(acc && (acc.id || acc.steamId64 || acc.username || acc.handle));
      checks.push({
        key: `account:${platform}`,
        label: `${platformLabel(platform)} handle (recommended)`,
        ok: true, // never block on this
        hint: ok ? null : `Optional: adding your ${platformLabel(platform)} handle helps mods verify you.`,
        soft: true,
        action: ok ? null : { kind: 'link', platform },
      });
    }
  }

  // ── Display name ─────────────────────────────────────────────────────
  const displayName = userData.displayName || userData.username;
  checks.push({
    key: 'profile:displayName',
    label: 'Vergr handle set',
    ok: !!displayName,
    hint: displayName ? null : 'Set a display name in Settings → Profile.',
    action: displayName ? null : { kind: 'profile' },
  });

  // ── Check-in flag ────────────────────────────────────────────────────
  const state = (t.participantState && t.participantState[uid]) || {};
  const alreadyCheckedIn = !!state.checkedInAt;
  checks.push({
    key: 'checkin',
    label: alreadyCheckedIn ? "You're checked in" : 'Check in to confirm you\'re ready',
    ok: alreadyCheckedIn,
    hint: alreadyCheckedIn ? null : 'Tap "I\'m ready" to confirm.',
    action: alreadyCheckedIn ? null : { kind: 'check-in' },
  });

  const startMs = t.scheduledStart?.toMillis?.() || (t.scheduledStart ? new Date(t.scheduledStart).getTime() : null);
  const timeUntilStartMs = startMs ? Math.max(0, startMs - Date.now()) : null;

  // Non-soft checks determine "ready". Soft ones are advisory.
  const hardChecks = checks.filter((c) => !c.soft);

  return {
    ready: hardChecks.every((c) => c.ok),
    game,
    detection: requirement.detection,
    detectionLabel: DETECTION_COPY[requirement.detection],
    instructions: DETECTION_INSTRUCTIONS[requirement.detection],
    requirements: checks,
    timeUntilStartMs,
    scheduledStartMs: startMs,
    status: t.status || 'registration',
  };
});

function platformLabel(p) {
  return ({
    steam: 'Steam',
    riot: 'Riot',
    battlenet: 'Battle.net',
    origin: 'EA / Origin',
    epic: 'Epic Games',
    xbox: 'Xbox',
    psn: 'PlayStation',
    twitch: 'Twitch',
    youtube: 'YouTube',
    discord: 'Discord',
  })[p] || p;
}

// ─────────────────────────────────────────────────────────────────────────────
// tournamentParticipantCheckIn — participant signals "I'm ready".
// ─────────────────────────────────────────────────────────────────────────────
exports.tournamentParticipantCheckIn = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { tournamentId } = req.data || {};
  const { ref, data: t } = await loadTournament(tournamentId);
  if (!(t.participants || []).includes(uid)) {
    throw new functions.https.HttpsError('permission-denied', 'Not a participant.');
  }
  if (t.status === 'cancelled' || t.status === 'completed') {
    throw new functions.https.HttpsError('failed-precondition', `Tournament already ${t.status}.`);
  }
  await ref.update({
    [`participantState.${uid}.checkedInAt`]: FieldValue.serverTimestamp(),
    [`participantState.${uid}.summonsStage`]: 'checked-in',
  });
  return { ok: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// summonsParticipants — cron every 1 min. Pings participants at 15/5/1 min
// before scheduledStart if they haven't checked in.
// ─────────────────────────────────────────────────────────────────────────────
exports.summonsParticipants = defer(
  { region: REGION, schedule: 'every 1 minutes', timeZone: 'UTC' },
  async () => {
    const now = Date.now();
    // Find tournaments scheduled to start within next 16 minutes that are not
    // yet active/completed/cancelled.
    const upper = new Date(now + 16 * 60_000);
    const lower = new Date(now);
    const snap = await db.collection('tournaments')
      .where('scheduledStart', '>=', lower)
      .where('scheduledStart', '<=', upper)
      .get();
    for (const sd of snap.docs) {
      const t = sd.data();
      if (['active', 'completed', 'cancelled', 'in_progress'].includes(t.status)) continue;
      const startMs = t.scheduledStart?.toMillis?.() || new Date(t.scheduledStart).getTime();
      const minsAway = (startMs - now) / 60_000;
      let stage = null;
      if (minsAway <= 1.2 && minsAway > -0.8)  stage = '1min';
      else if (minsAway <= 5.2 && minsAway > 1.2) stage = '5min';
      else if (minsAway <= 15.2 && minsAway > 5.2) stage = '15min';
      if (!stage) continue;

      const updates = {};
      const notifBatch = [];
      for (const uid of (t.participants || [])) {
        const state = (t.participantState && t.participantState[uid]) || {};
        if (state.checkedInAt) continue;
        if (state.summonsStage === stage) continue;
        updates[`participantState.${uid}.summonsStage`] = stage;
        updates[`participantState.${uid}.summonsLastSentAt`] = FieldValue.serverTimestamp();
        notifBatch.push({ uid, stage });
      }
      if (notifBatch.length === 0) continue;

      await sd.ref.update(updates);
      const batch = db.batch();
      for (const { uid, stage } of notifBatch) {
        const ref = db.collection('notifications').doc();
        const label = stage === '1min' ? '1 minute' : stage === '5min' ? '5 minutes' : '15 minutes';
        batch.set(ref, {
          recipientId: uid,
          type: 'tournament_summons',
          title: `${t.name || 'Tournament'} starts in ${label}`,
          body: 'Tap to check in and run pre-flight checks.',
          data: { tournamentId: sd.id, stage, scheduledStartMs: startMs },
          actionUrl: `/tournaments/${sd.id}/summons`,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// detectParticipantNoShows — cron every 5 min. Past start + grace, mark
// stragglers as no-show + refund their entry fee.
//
// Grace window: 5 minutes after scheduledStart. After that, if the tournament
// has NOT yet been started by the host and the participant hasn't checked in,
// we refund their entry + remove them from participants[]. If the tournament
// IS already active (host hit Start), no-shows forfeit per the bracket logic
// and entries are NOT refunded.
// ─────────────────────────────────────────────────────────────────────────────
exports.detectParticipantNoShows = defer(
  { region: REGION, schedule: 'every 5 minutes', timeZone: 'UTC' },
  async () => {
    const now = Date.now();
    const upper = new Date(now);            // started already
    const lower = new Date(now - 6 * 60_000); // within last 6 minutes
    const snap = await db.collection('tournaments')
      .where('scheduledStart', '>=', lower)
      .where('scheduledStart', '<=', upper)
      .get();
    for (const sd of snap.docs) {
      const t = sd.data();
      // Only auto-refund pre-start no-shows. Once host hit Start, treat as forfeit.
      if (['active', 'in_progress', 'completed', 'cancelled'].includes(t.status)) continue;
      const startMs = t.scheduledStart?.toMillis?.() || new Date(t.scheduledStart).getTime();
      if (now - startMs < 5 * 60_000) continue; // still in grace window

      const noShows = [];
      for (const uid of (t.participants || [])) {
        const state = (t.participantState && t.participantState[uid]) || {};
        if (state.checkedInAt) continue;
        if (state.noShowAt) continue;
        noShows.push(uid);
      }
      if (noShows.length === 0) continue;

      // Refund + remove. Best-effort per participant; tournament-level
      // transaction would be safer but participants list mutations are
      // already serialized by other callables.
      const entryFee = t.entryFee || 0;
      for (const uid of noShows) {
        try {
          await db.runTransaction(async (tx) => {
            const tSnap = await tx.get(sd.ref);
            if (!tSnap.exists) return;
            const td = tSnap.data();
            if (!(td.participants || []).includes(uid)) return;
            const cur = (td.participantState && td.participantState[uid]) || {};
            if (cur.noShowAt) return;
            tx.update(sd.ref, {
              participants: FieldValue.arrayRemove(uid),
              [`participantState.${uid}.noShowAt`]: FieldValue.serverTimestamp(),
              [`participantState.${uid}.refundedAt`]: FieldValue.serverTimestamp(),
              currentPlayers: FieldValue.increment(-1),
            });
            if (entryFee > 0) {
              tx.update(db.collection('wallets').doc(uid), {
                balance: FieldValue.increment(entryFee),
                totalSpent: FieldValue.increment(-entryFee),
              });
              // Refunded fees must leave the pool too — otherwise finalize
              // pays the winner coins that were already handed back.
              tx.update(sd.ref, { prizePool: FieldValue.increment(-entryFee) });
            }
            tx.set(db.collection('notifications').doc(), {
              recipientId: uid,
              type: 'tournament_no_show',
              title: 'No-show — entry refunded',
              body: `${td.name || 'Tournament'} started without you. ${entryFee} coins refunded.`,
              data: { tournamentId: sd.id },
              read: false,
              createdAt: FieldValue.serverTimestamp(),
            });
          });
        } catch (err) {
          console.warn(`no-show refund failed for ${uid}/${sd.id}:`, err);
        }
      }
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// autoStartTournaments — cron every 1 min. A tournament must never depend on
// the host pressing Start: at scheduledStart + grace it either starts itself
// (≥2 checked-in players; non-checked-in entrants pruned + refunded) or
// cancels itself with full refunds. Before this, a host who walked away left
// checked-in players' entry fees escrowed forever.
//
// Scope: solo/FFA tournaments only. Squad-mode check-in is squad-keyed and
// champion rosters must be locked first, so squad events keep manual start.
// Hosts can opt out with tournaments/{id}.autoStart === false, and can always
// start earlier manually.
// ─────────────────────────────────────────────────────────────────────────────
const AUTO_START_GRACE_MS = 6 * 60_000;   // wait past start for stragglers
const AUTO_START_LOOKBACK_MS = 60 * 60_000; // ignore events >1h past start

exports.autoStartTournaments = defer(
  { region: REGION, schedule: 'every 1 minutes', timeZone: 'UTC' },
  async () => {
    const now = Date.now();
    const upper = new Date(now - AUTO_START_GRACE_MS);
    const lower = new Date(now - AUTO_START_LOOKBACK_MS);
    const snap = await db.collection('tournaments')
      .where('scheduledStart', '>=', lower)
      .where('scheduledStart', '<=', upper)
      .get();

    const tournaments = require('./tournaments');

    for (const sd of snap.docs) {
      const t = sd.data();
      if (t.status !== 'open') continue;
      if (t.autoStart === false) continue;
      if (t.mode === 'squad') continue;
      if (t.autoStartHandledAt) continue; // idempotence across cron runs

      const participants = t.participants || [];
      const checkedIn = participants.filter(
        (uid) => (t.participantState && t.participantState[uid])?.checkedInAt,
      );
      const stragglers = participants.filter((uid) => !checkedIn.includes(uid));

      // Claim the tournament for this pass first so a slow run + the next
      // cron tick can't double-process it.
      try {
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(sd.ref);
          const fd = fresh.data() || {};
          if (fd.status !== 'open' || fd.autoStartHandledAt) {
            throw new Error('already handled');
          }
          tx.update(sd.ref, { autoStartHandledAt: FieldValue.serverTimestamp() });
        });
      } catch { continue; }

      try {
        if (checkedIn.length >= 2) {
          // Prune + refund stragglers (same shape as detectParticipantNoShows,
          // run inline so auto-start never depends on the other cron's window).
          const entryFee = t.entryFee || 0;
          for (const uid of stragglers) {
            try {
              await db.runTransaction(async (tx) => {
                const fresh = await tx.get(sd.ref);
                const fd = fresh.data() || {};
                if (!(fd.participants || []).includes(uid)) return;
                if ((fd.participantState && fd.participantState[uid])?.noShowAt) return;
                tx.update(sd.ref, {
                  participants: FieldValue.arrayRemove(uid),
                  [`participantState.${uid}.noShowAt`]: FieldValue.serverTimestamp(),
                  [`participantState.${uid}.refundedAt`]: FieldValue.serverTimestamp(),
                  currentPlayers: FieldValue.increment(-1),
                });
                if (entryFee > 0) {
                  tx.update(db.collection('wallets').doc(uid), {
                    balance: FieldValue.increment(entryFee),
                    totalSpent: FieldValue.increment(-entryFee),
                  });
                  tx.update(sd.ref, { prizePool: FieldValue.increment(-entryFee) });
                }
                tx.set(db.collection('notifications').doc(), {
                  recipientId: uid,
                  type: 'tournament_no_show',
                  title: 'No-show — entry refunded',
                  body: `${fd.name || 'Tournament'} started without you. ${entryFee} coins refunded.`,
                  data: { tournamentId: sd.id },
                  read: false,
                  createdAt: FieldValue.serverTimestamp(),
                });
              });
            } catch (err) {
              console.warn(`autoStart prune failed ${uid}/${sd.id}:`, err);
            }
          }
          await tournaments._internal_startTournament(sd.id, { uid: null });
          console.log(`autoStart: started ${sd.id} with ${checkedIn.length} players`);
        } else {
          // Not enough players showed — cancel + refund everyone left.
          await cancelAndRefundAll(sd.ref, t, checkedIn.length === 0
            ? 'auto_cancel_no_checkins'
            : 'auto_cancel_not_enough_players');
          console.log(`autoStart: cancelled ${sd.id} (${checkedIn.length} checked in)`);
        }
      } catch (err) {
        console.error(`autoStart failed for ${sd.id}:`, err?.message || err);
      }
    }
  },
);

// Cancel an unstarted tournament + refund every remaining participant's
// entry fee in one transaction. Solo mode only (squad events are excluded
// from auto-start above).
async function cancelAndRefundAll(tRef, t, reason) {
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(tRef);
    if (!fresh.exists) return;
    const fd = fresh.data();
    if (fd.status !== 'open') return;
    const entryFee = fd.entryFee || 0;
    let refunded = 0;
    for (const uid of (fd.participants || [])) {
      if (entryFee > 0) {
        tx.update(db.collection('wallets').doc(uid), {
          balance: FieldValue.increment(entryFee),
          totalSpent: FieldValue.increment(-entryFee),
        });
        refunded += entryFee;
      }
      tx.set(db.collection('notifications').doc(), {
        recipientId: uid,
        type: 'tournament_cancelled',
        title: 'Tournament cancelled',
        body: `${fd.name || 'Tournament'} didn't get enough checked-in players${entryFee > 0 ? ` — ${entryFee} coins refunded` : ''}.`,
        data: { tournamentId: tRef.id },
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    tx.update(tRef, {
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: 'system_auto_start',
      cancelReason: reason,
      refundedCoins: refunded,
      prizePool: 0,
    });
  });
}
