// adminTournaments.js — Admin → Tournaments screen callables.
//
// Wraps existing tournament internals (finalizeInternal,
// _internal_recordMatchResult) with admin-screen auth + audit + step-up.
//
// Callables (pass 1):
//   adminGetTournamentStats            — KPI tiles
//   adminListTournaments               — paginated + filtered list
//   adminListDisputedMatches           — every match in 'disputed' status
//                                         across all tournaments (collectionGroup)
//   adminResolveTournamentDispute      — pick a winner for a disputed match
//   adminCancelTournament              — cancel + refund all participants
//   adminListCancelledTournaments      — recent cancellations / refund history
//
// Pass 2 (deferred):
//   adminCreateVgtTournament, adminSendTournamentAnnouncement,
//   adminAddParticipant, adminRemoveParticipant, adminReseedBracket,
//   adminGetTournamentHealth (full)

const functions = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue, AggregateField } = require('firebase-admin/firestore');
const { S3Client, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const {
  requireFreshStepUp, adminRateLimit, auditAdminAction, extractRequestMeta,
} = require('./adminSecurity');
const { requireAdminScreen } = require('./adminAccess');

// R2 secrets — used by adminPurgeMatchEvidence to early-delete proof
// chunks + archived VOD when a match is fully settled.
const R2_ACCESS_KEY_ID     = defineSecret('R2_ACCESS_KEY_ID');
const R2_SECRET_ACCESS_KEY = defineSecret('R2_SECRET_ACCESS_KEY');
const R2_ACCOUNT_ID        = defineSecret('R2_ACCOUNT_ID');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

const MOD_CUT_PCT = 0.05;
const toMs = (t) => t && typeof t.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : null);

async function guardCaller(uid, { requireStepUp = false } = {}) {
  await requireAdminScreen(uid, 'tournaments');
  if (requireStepUp) await requireFreshStepUp(uid);
}

const safeAgg = async (q, fields) => {
  try { const r = await q.aggregate(fields).get(); return r.data(); }
  catch { return null; }
};

// ════════════════════════════════════════════════════════════════════
// READ
// ════════════════════════════════════════════════════════════════════

exports.adminGetTournamentStats = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);

    const t = db.collection('tournaments');
    const [open, live, completed, cancelled, totalPool] = await Promise.all([
      t.where('status', '==', 'open').count().get().then(r => r.data().count).catch(() => 0),
      t.where('status', '==', 'live').count().get().then(r => r.data().count).catch(() => 0),
      t.where('status', '==', 'completed').count().get().then(r => r.data().count).catch(() => 0),
      t.where('status', '==', 'cancelled').count().get().then(r => r.data().count).catch(() => 0),
      safeAgg(t.where('status', 'in', ['open', 'live', 'completed']),
              { total: AggregateField.sum('prizePool') }),
    ]);

    // Disputed matches across all tournaments
    const disputed = await db.collectionGroup('matches')
      .where('status', '==', 'disputed').count().get()
      .then(r => r.data().count).catch(() => 0);

    return {
      open,
      live,
      completed,
      cancelled,
      totalPrizePool: totalPool?.total ?? 0,
      disputedMatchCount: disputed,
      total: open + live + completed + cancelled,
    };
  }
);

exports.adminListTournaments = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { filters = {}, cursor = null, pageSize = 25 } = request.data || {};
    const limit = Math.min(100, Math.max(1, pageSize));

    let q = db.collection('tournaments').orderBy('createdAt', 'desc');
    if (filters.status) q = q.where('status', '==', filters.status);
    if (filters.game)   q = q.where('game', '==', filters.game);
    if (filters.type)   q = q.where('type', '==', filters.type);

    if (cursor) {
      const cs = await db.collection('tournaments').doc(cursor).get();
      if (cs.exists) q = q.startAfter(cs);
    }

    const snap = await q.limit(limit).get().catch(() => ({ docs: [] }));
    const rows = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name || 'Untitled',
        game: data.game || null,
        type: data.type || null,
        mode: data.mode || null,
        status: data.status || 'open',
        bannerUrl: data.bannerUrl || null,
        adminId: data.adminId || null,
        entryFee: data.entryFee ?? 0,
        prizePool: data.prizePool ?? 0,
        maxParticipants: data.maxParticipants ?? 0,
        participantCount: (data.participants || []).length,
        visibility: data.visibility || 'public',
        startDate: toMs(data.startDate),
        endDate: toMs(data.endDate),
        createdAt: toMs(data.createdAt),
        finalizedAt: toMs(data.finalizedAt),
        payoutStatus: data.payoutStatus || null,
        vanguardModerated: !!data.vanguardModerated,
      };
    });

    const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;
    return { rows, nextCursor };
  }
);

exports.adminListDisputedMatches = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { limit = 50 } = request.data || {};

    const snap = await db.collectionGroup('matches')
      .where('status', '==', 'disputed')
      .limit(Math.min(200, Math.max(1, limit)))
      .get().catch(() => ({ docs: [] }));

    // For each match doc, parent ref is tournaments/{tid}/matches/{mid}.
    const rows = await Promise.all(snap.docs.map(async (d) => {
      const data = d.data();
      const tRef = d.ref.parent.parent;
      let tournament = null;
      if (tRef) {
        const tSnap = await tRef.get().catch(() => null);
        if (tSnap?.exists) {
          const tData = tSnap.data();
          tournament = {
            id: tRef.id,
            name: tData.name || 'Untitled',
            game: tData.game || null,
            prizePool: tData.prizePool ?? 0,
          };
        }
      }
      return {
        id: d.id,
        tournament,
        player1: data.player1 || null,
        player2: data.player2 || null,
        round: data.round ?? null,
        matchNumber: data.matchNumber ?? null,
        player1ReportedWinner: data.player1ReportedWinner || null,
        player2ReportedWinner: data.player2ReportedWinner || null,
        reporterIds: data.reporterIds || [],
        disputedAt: toMs(data.disputedAt) || toMs(data.updatedAt),
      };
    }));

    return { rows };
  }
);

exports.adminListCancelledTournaments = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { limit = 50 } = request.data || {};

    const snap = await db.collection('tournaments')
      .where('status', '==', 'cancelled')
      .orderBy('cancelledAt', 'desc')
      .limit(Math.min(100, Math.max(1, limit)))
      .get().catch(() => ({ docs: [] }));

    const rows = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        name: data.name,
        game: data.game,
        entryFee: data.entryFee ?? 0,
        participantCount: (data.participants || []).length,
        refundedCoins: data.refundedCoins ?? 0,
        cancelledAt: toMs(data.cancelledAt),
        cancelReason: data.cancelReason || null,
        cancelledBy: data.cancelledBy || null,
      };
    });
    return { rows };
  }
);

// ════════════════════════════════════════════════════════════════════
// WRITE
// ════════════════════════════════════════════════════════════════════

// Resolve a disputed match — admin picks a winner, the existing internal
// helper advances the bracket. Re-implements the auth path of
// resolveTournamentDispute under the admin-screen guard so sub-admins
// with the 'tournaments' scope can use it without role=admin.
exports.adminResolveTournamentDispute = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_resolve_dispute', { perHour: 30, perDay: 100 });

    const { tournamentId, matchId, winnerId, note = '' } = request.data || {};
    if (!tournamentId || !matchId || !winnerId) {
      throw new HttpsError('invalid-argument', 'tournamentId, matchId, winnerId required');
    }

    const tRef = db.collection('tournaments').doc(tournamentId);
    const matchRef = tRef.collection('matches').doc(matchId);
    const dRef = tRef.collection('disputes').doc(matchId);

    let before = null;
    await db.runTransaction(async (tx) => {
      const mSnap = await tx.get(matchRef);
      if (!mSnap.exists) throw new HttpsError('not-found', 'Match not found');
      const m = mSnap.data();
      before = { status: m.status, winner: m.winner || null };
      if (winnerId !== m.player1 && winnerId !== m.player2) {
        throw new HttpsError('invalid-argument', 'Winner must be one of the match players');
      }
      const loser = winnerId === m.player1 ? m.player2 : m.player1;
      tx.update(matchRef, {
        winner: winnerId, loser, status: 'completed',
        completedAt: FieldValue.serverTimestamp(),
        completedBy: 'admin_resolution',
      });
      tx.set(dRef, {
        status: 'resolved',
        resolvedBy: uid,
        resolvedWinnerId: winnerId,
        adminNote: note || '',
        resolvedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    // Advance bracket via existing internal helper (require lazily to avoid
    // circular requires at module load).
    const tournaments = require('./tournaments');
    if (typeof tournaments._internal_advanceBracket === 'function') {
      await tournaments._internal_advanceBracket(tournamentId, matchId);
    } else if (typeof tournaments._internal_recordMatchResult === 'function') {
      // Fallback: see resolveTournamentDispute path.
    }

    // Spectator picks were retired with predictions, so there is nothing left
    // to settle here. This used to call settleMatchBets, which no longer
    // exists: the require returned undefined and the resulting TypeError was
    // swallowed by its own catch, which logged and looked healthy. Outstanding
    // stakes are returned in one sweep by refundOutstandingPicks.

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: { uid },
      action: 'admin_resolve_tournament_dispute',
      target: { type: 'tournament_match', id: `${tournamentId}/${matchId}` },
      before, after: { status: 'completed', winner: winnerId },
      reason: note || null,
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    });

    return { ok: true, winnerId };
  }
);

// Cancel a tournament and refund every participant their entry fee. Idempotent
// on already-cancelled tournaments.
exports.adminCancelTournament = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_cancel_tournament', { perHour: 10, perDay: 30 });

    const { tournamentId, reason = '' } = request.data || {};
    if (!tournamentId) throw new HttpsError('invalid-argument', 'tournamentId required');
    if (!reason || reason.trim().length < 4) {
      throw new HttpsError('invalid-argument', 'Reason required (min 4 chars)');
    }

    const tRef = db.collection('tournaments').doc(tournamentId);
    let refundedCoins = 0;
    let participantsRefunded = 0;
    let before = null;
    let cancelledName = 'Event';

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(tRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Tournament not found');
      const t = snap.data();
      cancelledName = t.name || 'Event';
      before = { status: t.status, prizePool: t.prizePool ?? 0 };
      if (t.status === 'cancelled') {
        throw new HttpsError('failed-precondition', 'Tournament already cancelled');
      }
      if (t.status === 'completed' && t.payoutStatus === 'paid') {
        throw new HttpsError('failed-precondition', 'Cannot cancel — prizes already paid');
      }

      const participants = Array.isArray(t.participants) ? t.participants : [];
      const fee = Math.floor(t.entryFee || 0);

      // Refund each participant
      for (const pid of participants) {
        if (!pid) continue;
        const wRef = db.collection('wallets').doc(pid);
        tx.set(wRef, { balance: FieldValue.increment(fee) }, { merge: true });
        const txRef = db.collection('transactions').doc();
        tx.set(txRef, {
          recipientId: pid,
          type: 'tournament_refund',
          amount: fee,
          description: `Refund: ${t.name || 'Tournament'} cancelled`,
          tournamentId,
          createdAt: FieldValue.serverTimestamp(),
        });
        const nRef = db.collection('notifications').doc();
        tx.set(nRef, {
          recipientId: pid,
          type: 'tournament_cancelled',
          title: 'Tournament cancelled',
          body: `${t.name || 'Tournament'} was cancelled — ${fee} coins refunded to your wallet.`,
          tournamentId,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
        refundedCoins += fee;
        participantsRefunded += 1;
      }

      // Ticketed events: return the host's own purse top-up. Per-ticket
      // refunds to buyers happen post-tx below (can be many docs).
      const hostTopUp = Math.floor(t.hostTopUpCoins || 0);
      if (hostTopUp > 0 && t.adminId) {
        const hostWalletRef = db.collection('wallets').doc(t.adminId);
        tx.set(hostWalletRef, { balance: FieldValue.increment(hostTopUp) }, { merge: true });
        tx.set(db.collection('transactions').doc(), {
          userId: t.adminId,
          type: 'tournament_purse_topup_refund',
          amount: hostTopUp,
          description: `Top-up refund: ${t.name || 'Tournament'} cancelled`,
          tournamentId,
          createdAt: FieldValue.serverTimestamp(),
        });
        refundedCoins += hostTopUp;
      }

      tx.update(tRef, {
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: uid,
        cancelReason: reason,
        refundedCoins,
        participantsRefunded,
        prizePool: 0,
        declaredPurse: 0,
      });
    });

    // Same as above: refundMatchBets went with predictions, so this call did
    // nothing but log. Outstanding stakes are returned by
    // refundOutstandingPicks rather than per-cancellation.

    // Ticketed events: refund every active ticket buyer the full price they
    // paid, and claw back the host's net earnings on those sales. The platform
    // absorbs the 10% fee on a cancellation. Done outside the main tx (can be
    // many docs); marking each ticket 'refunded' makes re-runs idempotent.
    try {
      const ticketsSnap = await db.collection('event_tickets')
        .where('tournamentId', '==', tournamentId)
        .where('status', '==', 'active')
        .get();
      const chunks = [];
      let batch = db.batch();
      let ops = 0;
      const flush = () => { chunks.push(batch.commit()); batch = db.batch(); ops = 0; };
      for (const td of ticketsSnap.docs) {
        const tk = td.data();
        const price = Math.floor(tk.pricePaid || 0);
        const hostNet = Math.floor(tk.hostNet || 0);
        // Refund buyer.
        batch.set(db.collection('wallets').doc(tk.buyerUid),
          { balance: FieldValue.increment(price) }, { merge: true });
        batch.set(db.collection('transactions').doc(), {
          userId: tk.buyerUid, type: 'event_ticket_refund', amount: price,
          tournamentId, description: `Ticket refund: ${cancelledName} cancelled`,
          createdAt: FieldValue.serverTimestamp(),
        });
        // Claw back host earnings on this sale.
        if (hostNet > 0 && tk.hostUid) {
          batch.set(db.collection('wallets').doc(tk.hostUid),
            { balance: FieldValue.increment(-hostNet) }, { merge: true });
          batch.set(db.collection('transactions').doc(), {
            userId: tk.hostUid, type: 'event_ticket_sale_reversal', amount: -hostNet,
            tournamentId, description: 'Ticket sale reversed: event cancelled',
            createdAt: FieldValue.serverTimestamp(),
          });
        }
        batch.update(td.ref, { status: 'refunded', refundedAt: FieldValue.serverTimestamp() });
        ops += 4;
        if (ops >= 400) flush();
      }
      if (ops > 0) flush();
      await Promise.all(chunks);
    } catch (err) {
      console.error('event_ticket refunds failed (cancel)', tournamentId, err);
    }

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: { uid },
      action: 'admin_cancel_tournament',
      target: { type: 'tournament', id: tournamentId },
      before,
      after: { status: 'cancelled', refundedCoins, participantsRefunded },
      reason,
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    });

    return { ok: true, refundedCoins, participantsRefunded };
  }
);

// ════════════════════════════════════════════════════════════════════
// PASS 2 — VGT / ANNOUNCEMENTS / OVERRIDES / SETTINGS / LOGS
// ════════════════════════════════════════════════════════════════════

// ── VGT ─────────────────────────────────────────────────────────────
//
// Vergr Grand Tournaments are platform-hosted high-stakes events.
// They share the same tournaments/ collection but carry `isVgt: true`
// and an extended `vgt` sub-object with sponsor info + prize guarantee.

exports.adminCreateVgtTournament = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_create_vgt', { perHour: 5, perDay: 20 });

    const {
      name, game, type = 'single_elim', maxParticipants = 32, entryFee = 0,
      prizePoolGuarantee = 0, scheduledStart, bannerUrl = null,
      sponsorName = null, sponsorUrl = null, sponsorLogoUrl = null,
      note = null, description = '',
    } = request.data || {};

    if (!name || String(name).trim().length < 3) {
      throw new HttpsError('invalid-argument', 'name required (min 3 chars)');
    }
    if (!game) throw new HttpsError('invalid-argument', 'game required');
    const max = Math.max(2, Math.min(256, Number(maxParticipants) || 32));
    const fee = Math.max(0, Math.min(10_000, Number(entryFee) || 0));
    const guarantee = Math.max(0, Math.min(500_000, Number(prizePoolGuarantee) || 0));
    const startMs = scheduledStart ? new Date(scheduledStart).getTime() : null;
    if (startMs && (!Number.isFinite(startMs) || startMs < Date.now() - 60_000)) {
      throw new HttpsError('invalid-argument', 'scheduledStart must be a valid future date');
    }

    const { requiresManualMod } = require('./tournamentModeration');
    const needsManualMod = requiresManualMod({ game });
    const overlayToken = require('crypto').randomBytes(32).toString('hex');

    const ref = db.collection('tournaments').doc();
    await ref.set({
      adminId: uid,
      squadId: null,
      name: String(name).trim(),
      description: String(description || '').trim(),
      game,
      entryFee: fee,
      maxParticipants: max,
      type,
      mode: 'single_elim',
      streamRequired: true,           // VGT always streams
      status: 'open',
      prizePool: guarantee,           // Seed the pool with the guaranteed amount
      participants: [],
      bracketData: null,
      brResults: [],
      visibility: 'public',
      bannerUrl,
      invitedUserIds: [],
      scheduledStart: startMs ? new Date(startMs) : null,
      requiresManualMod: needsManualMod,
      overlayToken,
      isVgt: true,
      vgt: {
        prizePoolGuarantee: guarantee,
        sponsorName: sponsorName ? String(sponsorName).slice(0, 80) : null,
        sponsorUrl:  sponsorUrl  ? String(sponsorUrl).slice(0, 200) : null,
        sponsorLogoUrl: sponsorLogoUrl ? String(sponsorLogoUrl).slice(0, 500) : null,
        note: note ? String(note).slice(0, 500) : null,
        createdBy: uid,
      },
      createdAt: FieldValue.serverTimestamp(),
    });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: { uid },
      action: 'admin_create_vgt',
      target: { type: 'tournament', id: ref.id },
      after: { name, game, prizePoolGuarantee: guarantee },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    });

    return { ok: true, tournamentId: ref.id, overlayToken };
  }
);

exports.adminListVgtTournaments = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { limit = 50, status = null } = request.data || {};

    let q = db.collection('tournaments').where('isVgt', '==', true).orderBy('createdAt', 'desc');
    if (status) q = q.where('status', '==', status);
    const snap = await q.limit(Math.min(100, Math.max(1, limit))).get().catch(() => ({ docs: [] }));

    const rows = snap.docs.map(d => {
      const t = d.data();
      return {
        id: d.id,
        name: t.name, game: t.game, status: t.status,
        bannerUrl: t.bannerUrl || null,
        prizePool: t.prizePool ?? 0,
        prizePoolGuarantee: t.vgt?.prizePoolGuarantee ?? 0,
        sponsorName: t.vgt?.sponsorName ?? null,
        sponsorUrl: t.vgt?.sponsorUrl ?? null,
        sponsorLogoUrl: t.vgt?.sponsorLogoUrl ?? null,
        participantCount: (t.participants || []).length,
        maxParticipants: t.maxParticipants,
        scheduledStart: toMs(t.scheduledStart),
        createdAt: toMs(t.createdAt),
      };
    });
    return { rows };
  }
);

// ── ANNOUNCEMENTS ───────────────────────────────────────────────────
//
// Tournament-specific announcement. Writes to tournament_announcements/
// and fans out push notifications to the chosen audience.

exports.adminSendTournamentAnnouncement = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_send_tournament_announcement', { perHour: 20, perDay: 100 });

    const { tournamentId, audience = 'participants', title, body, bannerUrl = null } = request.data || {};
    if (!tournamentId) throw new HttpsError('invalid-argument', 'tournamentId required');
    if (!title || String(title).trim().length < 3) {
      throw new HttpsError('invalid-argument', 'title required (min 3 chars)');
    }
    if (!body || String(body).trim().length < 3) {
      throw new HttpsError('invalid-argument', 'body required (min 3 chars)');
    }
    if (!['participants', 'hosts', 'spectators', 'all'].includes(audience)) {
      throw new HttpsError('invalid-argument', 'audience must be participants|hosts|spectators|all');
    }

    const tSnap = await db.collection('tournaments').doc(tournamentId).get();
    if (!tSnap.exists) throw new HttpsError('not-found', 'Tournament not found');
    const t = tSnap.data();

    // Determine recipients
    let recipientIds = [];
    if (audience === 'participants' || audience === 'all') {
      recipientIds.push(...(t.participants || []));
    }
    if (audience === 'hosts' || audience === 'all') {
      if (t.adminId) recipientIds.push(t.adminId);
    }
    // Spectators (current viewers) — out of scope for v1; emit to participants
    // as a safe fallback so the audience is never empty.
    if (audience === 'spectators') {
      recipientIds = [...(t.participants || []), t.adminId].filter(Boolean);
    }
    recipientIds = [...new Set(recipientIds)].filter(Boolean);

    const annRef = db.collection('tournament_announcements').doc();
    await annRef.set({
      tournamentId,
      tournamentName: t.name || null,
      audience,
      title: String(title).trim().slice(0, 160),
      body: String(body).trim().slice(0, 1500),
      bannerUrl,
      recipientCount: recipientIds.length,
      sentBy: uid,
      sentAt: FieldValue.serverTimestamp(),
    });

    // Fan out notifications (chunked, no batching of >500 per request).
    const chunkSize = 400;
    for (let i = 0; i < recipientIds.length; i += chunkSize) {
      const chunk = recipientIds.slice(i, i + chunkSize);
      const batch = db.batch();
      chunk.forEach(rid => {
        const nRef = db.collection('notifications').doc();
        batch.set(nRef, {
          recipientId: rid,
          type: 'tournament_announcement',
          title: `${t.name || 'Tournament'}: ${String(title).slice(0, 80)}`,
          body: String(body).slice(0, 200),
          tournamentId,
          announcementId: annRef.id,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
    }

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: { uid },
      action: 'admin_send_tournament_announcement',
      target: { type: 'tournament', id: tournamentId },
      after: { audience, recipientCount: recipientIds.length, announcementId: annRef.id },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    });

    return { ok: true, announcementId: annRef.id, recipientCount: recipientIds.length };
  }
);

exports.adminListTournamentAnnouncements = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { tournamentId = null, limit = 50 } = request.data || {};

    let q = db.collection('tournament_announcements').orderBy('sentAt', 'desc');
    if (tournamentId) q = q.where('tournamentId', '==', tournamentId);
    const snap = await q.limit(Math.min(100, Math.max(1, limit))).get().catch(() => ({ docs: [] }));

    return {
      rows: snap.docs.map(d => {
        const a = d.data();
        return {
          id: d.id,
          tournamentId: a.tournamentId,
          tournamentName: a.tournamentName,
          audience: a.audience,
          title: a.title,
          body: a.body,
          bannerUrl: a.bannerUrl,
          recipientCount: a.recipientCount,
          sentBy: a.sentBy,
          sentAt: toMs(a.sentAt),
        };
      }),
    };
  }
);

// ── PARTICIPANT OVERRIDES ───────────────────────────────────────────

exports.adminAddParticipant = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_add_participant', { perHour: 30, perDay: 100 });

    const { tournamentId, userId, reason } = request.data || {};
    if (!tournamentId || !userId) throw new HttpsError('invalid-argument', 'tournamentId, userId required');
    if (!reason || String(reason).trim().length < 4) {
      throw new HttpsError('invalid-argument', 'reason required (min 4 chars)');
    }

    const tRef = db.collection('tournaments').doc(tournamentId);
    let before = null;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(tRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Tournament not found');
      const t = snap.data();
      before = { participantCount: (t.participants || []).length, status: t.status };
      if (t.status !== 'open') throw new HttpsError('failed-precondition', 'Tournament not open for registration');
      const participants = t.participants || [];
      if (participants.includes(userId)) {
        throw new HttpsError('already-exists', 'User already registered');
      }
      if (participants.length >= (t.maxParticipants || 0)) {
        throw new HttpsError('failed-precondition', 'Tournament full');
      }
      // Force-adds skip the entry-fee debit. Prize pool not bumped — host
      // can adjust manually via VGT prize-guarantee field if needed.
      tx.update(tRef, {
        participants: FieldValue.arrayUnion(userId),
        forceAddedBy: FieldValue.arrayUnion(uid),
      });
      tx.set(db.collection('notifications').doc(), {
        recipientId: userId,
        type: 'tournament_force_added',
        title: 'Added to tournament',
        body: `An admin added you to "${t.name || 'a tournament'}".`,
        tournamentId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: { uid }, action: 'admin_add_participant',
      target: { type: 'tournament', id: tournamentId },
      before, after: { addedUserId: userId },
      reason,
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    });
    return { ok: true };
  }
);

exports.adminRemoveParticipant = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_remove_participant', { perHour: 30, perDay: 100 });

    const { tournamentId, userId, refund = true, reason } = request.data || {};
    if (!tournamentId || !userId) throw new HttpsError('invalid-argument', 'tournamentId, userId required');
    if (!reason || String(reason).trim().length < 4) {
      throw new HttpsError('invalid-argument', 'reason required (min 4 chars)');
    }

    const tRef = db.collection('tournaments').doc(tournamentId);
    let refundedCoins = 0;
    let before = null;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(tRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Tournament not found');
      const t = snap.data();
      before = { participantCount: (t.participants || []).length, status: t.status };
      const participants = t.participants || [];
      if (!participants.includes(userId)) {
        throw new HttpsError('not-found', 'User is not a participant');
      }
      if (t.status === 'completed' && t.payoutStatus === 'paid') {
        throw new HttpsError('failed-precondition', 'Tournament already paid out');
      }
      tx.update(tRef, { participants: FieldValue.arrayRemove(userId) });

      if (refund && t.status === 'open') {
        const fee = Math.floor(t.entryFee || 0);
        if (fee > 0) {
          const wRef = db.collection('wallets').doc(userId);
          tx.set(wRef, { balance: FieldValue.increment(fee) }, { merge: true });
          tx.set(db.collection('transactions').doc(), {
            recipientId: userId, type: 'tournament_refund',
            amount: fee, description: `Removed from ${t.name || 'tournament'} — entry refunded`,
            tournamentId, createdAt: FieldValue.serverTimestamp(),
          });
          refundedCoins = fee;
        }
      }

      tx.set(db.collection('notifications').doc(), {
        recipientId: userId, type: 'tournament_removed',
        title: 'Removed from tournament',
        body: refundedCoins > 0
          ? `You were removed from "${t.name || 'a tournament'}". ${refundedCoins} coins refunded.`
          : `You were removed from "${t.name || 'a tournament'}".`,
        tournamentId, read: false, createdAt: FieldValue.serverTimestamp(),
      });
    });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: { uid }, action: 'admin_remove_participant',
      target: { type: 'tournament', id: tournamentId },
      before, after: { removedUserId: userId, refundedCoins },
      reason,
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    });
    return { ok: true, refundedCoins };
  }
);

exports.adminReseedBracket = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_reseed_bracket', { perHour: 5, perDay: 10 });

    const { tournamentId, reason } = request.data || {};
    if (!tournamentId) throw new HttpsError('invalid-argument', 'tournamentId required');
    if (!reason || String(reason).trim().length < 4) {
      throw new HttpsError('invalid-argument', 'reason required (min 4 chars)');
    }

    const tRef = db.collection('tournaments').doc(tournamentId);
    let before = null;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(tRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Tournament not found');
      const t = snap.data();
      before = { status: t.status, hasBracket: !!t.bracketData };
      // Only safe BEFORE round 1 — once matches are played, reseeding would
      // void real outcomes. Restrict to status='open' OR (status='live' AND
      // currentRound=0/1 with all matches still pending).
      if (t.status === 'completed' || t.status === 'cancelled') {
        throw new HttpsError('failed-precondition', `Cannot reseed — status=${t.status}`);
      }
      tx.update(tRef, {
        bracketData: null,
        brResults: [],
        status: 'open',
        reseededAt: FieldValue.serverTimestamp(),
        reseededBy: uid,
      });
    });

    // Also wipe any existing match docs from this tournament so the
    // bracket generator starts clean. Cap at 256 deletes to stay safe.
    const matchesSnap = await tRef.collection('matches').limit(256).get().catch(() => ({ docs: [] }));
    if (matchesSnap.docs.length > 0) {
      const batch = db.batch();
      matchesSnap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: { uid }, action: 'admin_reseed_bracket',
      target: { type: 'tournament', id: tournamentId },
      before, after: { status: 'open', wipedMatches: matchesSnap.docs?.length || 0 },
      reason,
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    });
    return { ok: true, wipedMatches: matchesSnap.docs?.length || 0 };
  }
);

// ── SETTINGS ────────────────────────────────────────────────────────
//
// Stored on app_config/general.tournaments. The Riot-disclosed caps
// (entry fee 10k, prize pool 500k, mod cut 5%) are display-only here
// — the source of truth is src/utils/tournamentTypes.js and changing
// them requires re-notifying Riot. Editable defaults live alongside.

const TOURNAMENT_SETTINGS_DEFAULTS = {
  matchConfirmTimeoutHours: 24,
  checkInWindowHours: 1,
  autoFinalizeIntervalMin: 5,
  defaultEntryFee: 100,
  defaultMaxParticipants: 8,
  // Display-only mirrors (read from tournamentTypes.js at runtime;
  // included here so the UI shows them in one place).
  riotMaxEntryFee: 10_000,
  riotMaxPrizePool: 500_000,
  modCutPct: 0.05,
};

const TOURNAMENT_SETTING_VALIDATORS = {
  matchConfirmTimeoutHours: v => Number.isInteger(v) && v >= 1 && v <= 168,
  checkInWindowHours: v => Number.isInteger(v) && v >= 0 && v <= 24,
  autoFinalizeIntervalMin: v => Number.isInteger(v) && v >= 1 && v <= 60,
  defaultEntryFee: v => Number.isInteger(v) && v >= 0 && v <= 10_000,
  defaultMaxParticipants: v => Number.isInteger(v) && v >= 2 && v <= 256,
};

exports.adminGetTournamentSettings = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const snap = await db.collection('app_config').doc('general').get();
    const stored = (snap.exists ? snap.data() : {}).tournaments || {};
    return { settings: { ...TOURNAMENT_SETTINGS_DEFAULTS, ...stored } };
  }
);

exports.adminSetTournamentSettings = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_set_tournament_settings', { perHour: 30, perDay: 100 });

    const incoming = request.data?.settings || {};
    const next = {};
    for (const [k, v] of Object.entries(incoming)) {
      const validate = TOURNAMENT_SETTING_VALIDATORS[k];
      if (!validate) throw new HttpsError('invalid-argument', `Unknown or locked setting: ${k}`);
      if (!validate(v)) throw new HttpsError('invalid-argument', `Invalid value for ${k}`);
      next[k] = v;
    }
    if (Object.keys(next).length === 0) throw new HttpsError('invalid-argument', 'No fields to update');

    const ref = db.collection('app_config').doc('general');
    const before = (await ref.get()).data()?.tournaments || {};
    const after = { ...TOURNAMENT_SETTINGS_DEFAULTS, ...before, ...next };
    await ref.set({ tournaments: after, _updatedAt: FieldValue.serverTimestamp(), _updatedBy: uid }, { merge: true });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: { uid }, action: 'admin_set_tournament_settings',
      target: { type: 'app_config', id: 'general' },
      before: { tournaments: before }, after: { tournaments: after },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    });
    return { ok: true, settings: after };
  }
);

// ── LOGS ────────────────────────────────────────────────────────────
//
// Thin wrapper over admin_actions/ filtered to tournament-relevant
// actions. Pulls latest N entries in chronological order.

const TOURNAMENT_ADMIN_ACTIONS = [
  'admin_resolve_tournament_dispute', 'admin_cancel_tournament',
  'admin_create_vgt', 'admin_send_tournament_announcement',
  'admin_add_participant', 'admin_remove_participant', 'admin_reseed_bracket',
  'admin_set_tournament_settings',
];

exports.adminListTournamentLogs = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { limit = 100 } = request.data || {};
    const lim = Math.min(200, Math.max(1, limit));

    let rows = [];
    try {
      const snap = await db.collection('admin_actions')
        .where('action', 'in', TOURNAMENT_ADMIN_ACTIONS)
        .orderBy('createdAt', 'desc')
        .limit(lim)
        .get();
      rows = snap.docs.map(d => {
        const data = d.data();
        const actor = data.actor || {};
        return {
          id: d.id,
          action: data.action,
          actorUid: typeof actor === 'string' ? actor : (actor.uid || null),
          target: data.target || null,
          before: data.before || null,
          after: data.after || null,
          reason: data.reason || null,
          createdAt: toMs(data.createdAt),
        };
      });
    } catch { /* missing index — return empty */ }

    // Hydrate actor profiles
    const uids = [...new Set(rows.map(r => r.actorUid).filter(Boolean))];
    const profiles = {};
    if (uids.length > 0) {
      const snaps = await Promise.all(uids.map(u => db.collection('users').doc(u).get()));
      snaps.forEach((s, i) => {
        if (s.exists) {
          const p = s.data();
          profiles[uids[i]] = {
            displayName: p.displayName || null,
            username: p.username || null,
            avatar: p.avatar || null,
          };
        }
      });
    }

    return { rows: rows.map(r => ({ ...r, actor: profiles[r.actorUid] || null })) };
  }
);

// ────────────────────────────────────────────────────────────────────────────
// adminPurgeMatchEvidence — early R2 cleanup for a fully-settled match.
//
// Normal retention: proof chunks 30d, tournament VOD 7d (handled by crons in
// streamingCleanup.js). This callable lets a founder/admin reclaim that R2
// space NOW once the match outcome is finalised and beyond dispute.
//
// Required match state (server-enforced — admin can't bypass):
//   status === 'completed'                          // not active / disputed
//   status !== 'disputed' && !disputeOpenAt         // no open dispute
//   commanderReviewRequired !== true                // no pending Commander call
//   cheatFlag?.confirmed !== undefined              // either confirmed or cleared
//   (no cheatFlagPass === 'pending')                // VOD AI pass not pending
//
// Deletes:
//   - Every chunk url under match.proofFeed[uid].chunks[]
//   - match.archiveVodUrl (the 480p archived VOD)
//   - match.highlights[] highlight clip urls (if present)
//
// Clears the corresponding fields on the match doc + audits via
// admin_actions. Idempotent: re-running on an already-purged match is a noop.
// ────────────────────────────────────────────────────────────────────────────
exports.adminPurgeMatchEvidence = functions.https.onCall(
  { region: REGION, secrets: [R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID] },
  async (req) => {
    const uid = req.auth?.uid;
    await guardCaller(uid);                          // admin-only via screen scope
    await adminRateLimit(uid, 'purge_match_evidence', { perHour: 60, perDay: 200 });

    const { tournamentId, matchId } = req.data || {};
    if (!tournamentId || !matchId) {
      throw new HttpsError('invalid-argument', 'tournamentId + matchId required.');
    }

    const mRef = db.collection('tournaments').doc(tournamentId)
      .collection('matches').doc(matchId);
    const mSnap = await mRef.get();
    if (!mSnap.exists) throw new HttpsError('not-found', 'Match not found.');
    const m = mSnap.data();

    // Hard preconditions — admin can't purge evidence on a live or disputed
    // match. Force them to resolve disputes / Commander reviews first.
    if (m.status !== 'completed') {
      throw new HttpsError('failed-precondition', 'Match must be completed before evidence purge.');
    }
    if (m.status === 'disputed' || m.disputeOpenAt) {
      throw new HttpsError('failed-precondition', 'Match has an open dispute — resolve it first.');
    }
    if (m.commanderReviewRequired === true) {
      throw new HttpsError('failed-precondition', 'Match has a pending Commander review.');
    }
    if (m.cheatFlagPass === 'pending') {
      throw new HttpsError('failed-precondition', 'AI cheat-flag pass is still pending — wait for it to finish.');
    }
    if (m.cheatFlag && m.cheatFlag.confirmed !== true && m.cheatFlag.cleared !== true) {
      throw new HttpsError('failed-precondition', 'Cheat flag still unresolved — confirm or clear it first.');
    }

    // Gather every R2 key to delete. Public URLs look like
    //   https://cdn.vergr.app/<key>
    // strip the prefix to get the key.
    const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE || 'https://cdn.vergr.app').replace(/\/$/, '');
    const toKey = (url) => {
      if (!url || typeof url !== 'string') return null;
      if (!url.startsWith(PUBLIC_BASE + '/')) return null;
      return url.slice(PUBLIC_BASE.length + 1);
    };

    const keys = [];
    for (const uidKey of Object.keys(m.proofFeed || {})) {
      for (const c of (m.proofFeed[uidKey]?.chunks || [])) {
        if (c.key) keys.push(c.key);
        else { const k = toKey(c.url); if (k) keys.push(k); }
      }
    }
    if (m.archiveVodUrl) {
      const k = toKey(m.archiveVodUrl); if (k) keys.push(k);
    }
    for (const h of (m.highlights || [])) {
      const k = toKey(h?.url); if (k) keys.push(k);
    }

    const accountId = (process.env.R2_ACCOUNT_ID || '').trim();
    const accessKey = (process.env.R2_ACCESS_KEY_ID || '').trim();
    const secret    = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
    let deleted = 0;
    if (keys.length && accountId && accessKey && secret) {
      const s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: accessKey, secretAccessKey: secret },
        requestChecksumCalculation: 'WHEN_REQUIRED',
      });
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000).map((Key) => ({ Key }));
        try {
          await s3.send(new DeleteObjectsCommand({
            Bucket: 'vergr-media',
            Delete: { Objects: batch, Quiet: true },
          }));
          deleted += batch.length;
        } catch (err) {
          console.error('R2 delete batch failed', err?.message || err);
          // Continue — partial purge is fine, we still clear the doc fields
          // for keys we successfully deleted in earlier batches.
        }
      }
    }

    // Clear the doc references regardless. If the R2 delete fails, the
    // daily cron will pick up the orphaned chunks via LastModified TTL.
    await mRef.update({
      proofFeed: FieldValue.delete(),
      archiveVodUrl: FieldValue.delete(),
      archiveDurationSec: FieldValue.delete(),
      archiveSizeBytes: FieldValue.delete(),
      highlights: FieldValue.delete(),
      evidencePurgedAt: FieldValue.serverTimestamp(),
      evidencePurgedBy: uid,
      evidencePurgedCount: deleted,
    });

    await auditAdminAction({
      actor: uid,
      action: 'purge_match_evidence',
      target: { type: 'tournament_match', id: `${tournamentId}/${matchId}` },
      after: { tournamentId, matchId, deletedR2Keys: deleted, attemptedKeys: keys.length },
      req,
    });

    return { ok: true, deletedR2Keys: deleted, attemptedKeys: keys.length };
  }
);

// ────────────────────────────────────────────────────────────────────────────
// adminListMatchesWithEvidence — paginated list of COMPLETED matches that
// still hold proof / VOD / highlight evidence in R2 (i.e. not yet purged
// by the cron and not yet manually purged). Powers the Admin →
// Tournaments → Evidence tab so the admin can reclaim space proactively.
// ────────────────────────────────────────────────────────────────────────────
exports.adminListMatchesWithEvidence = functions.https.onCall(
  { region: REGION, cors: true },
  async (req) => {
    const uid = req.auth?.uid;
    await guardCaller(uid);
    const { limit = 50 } = req.data || {};

    // collectionGroup query — every match doc across every tournament.
    // We can't AND multiple `where` clauses cheaply without composite
    // indexes, so we filter post-fetch on the doc-level flags.
    const snap = await db.collectionGroup('matches')
      .where('status', '==', 'completed')
      .limit(Math.min(200, Math.max(1, limit) * 4))   // overfetch + client filter
      .get().catch(() => ({ docs: [] }));

    const rows = [];
    for (const d of snap.docs) {
      const data = d.data();
      if (data.evidencePurgedAt) continue;             // already purged
      const hasProof = !!(data.proofFeed && Object.keys(data.proofFeed).length);
      const hasVod   = !!data.archiveVodUrl;
      const hasHl    = Array.isArray(data.highlights) && data.highlights.length > 0;
      if (!hasProof && !hasVod && !hasHl) continue;    // nothing to purge

      const tRef = d.ref.parent.parent;
      let tournamentName = null;
      let entryFee = 0;
      if (tRef) {
        const tSnap = await tRef.get().catch(() => null);
        if (tSnap?.exists) {
          tournamentName = tSnap.data().name || null;
          entryFee = tSnap.data().entryFee || 0;
        }
      }

      // Per-match approximate R2 footprint (bytes). Proof chunks vary;
      // estimate from chunk count + avg WebM 10s chunk size (~1MB).
      let approxBytes = data.archiveSizeBytes || 0;
      for (const u of Object.keys(data.proofFeed || {})) {
        approxBytes += (data.proofFeed[u]?.chunks?.length || 0) * 1_000_000;
      }
      for (const h of (data.highlights || [])) approxBytes += h?.sizeBytes || 0;

      rows.push({
        tournamentId: tRef?.id || null,
        tournamentName,
        matchId: d.id,
        round: data.round ?? null,
        matchNumber: data.matchNumber ?? null,
        entryFee,
        hasProof, hasVod, hasHl,
        approxBytes,
        completedAt: toMs(data.completedAt) || toMs(data.updatedAt),
        commanderReviewRequired: !!data.commanderReviewRequired,
        cheatFlagPass: data.cheatFlagPass || null,
        cheatFlagState: data.cheatFlag
          ? (data.cheatFlag.confirmed ? 'confirmed' : data.cheatFlag.cleared ? 'cleared' : 'unresolved')
          : null,
      });

      if (rows.length >= limit) break;
    }

    // Newest-settled first.
    rows.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    return { rows, count: rows.length };
  }
);
