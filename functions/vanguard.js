// Vanguard moderator program — server-side callables.
//
// Spec: CLAUDE.md → "Vanguard moderator program — LOCKED SPEC".
// Client helpers: src/utils/vanguard.js + src/firebase/firestore.js.
//
// Every state change to a user's Vanguard rank goes through one of these
// callables. The user doc's `vanguard` field is admin-SDK-only — clients
// cannot fabricate ranks, actions, or audit entries.
const functions = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { RANK_BY_ID, RANK_IDS } = require('./vanguardRanks');
// Shared admin guards — rate-limit, audit log, TOTP step-up.
// Used only when caller is `role === 'admin'` (founder); regular Vanguard
// ranks go through the existing vanguard_actions audit path.
const adminSecurity = require('./adminSecurity');

// Previous-month key in UTC. The 1st-of-month cron settles the JUST-CLOSED
// month, not the running one. Format: "YYYY-MM".
const previousMonthKey = () => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

// Core distribution logic. Pure function — runs the read-compute-write
// against the live DB. Returns a summary so admin-trigger callers can show
// results. Idempotent on `vanguard_payouts/{monthKey}` — second invocation
// for the same month is a no-op.
async function distributeMonth(db, monthKey) {
  // 1. Idempotency: if a payout doc already exists for this month, bail.
  const payoutRef = db.collection('vanguard_payouts').doc(monthKey);
  const existing = await payoutRef.get();
  if (existing.exists) {
    return { ok: true, monthKey, alreadyDistributed: true, ...existing.data() };
  }

  // 2. Get config: Vanguard squad id.
  const cfgSnap = await db.collection('app_config').doc('general').get();
  const vanguardSquadId = cfgSnap.exists ? cfgSnap.data().vanguardSquadId : null;
  if (!vanguardSquadId) {
    return { ok: false, monthKey, error: 'vanguardSquadId not configured' };
  }

  // 3. Read the treasury balance.
  const treasuryRef = db.collection('squads').doc(vanguardSquadId).collection('wallet').doc('main');
  const treasurySnap = await treasuryRef.get();
  const pool = treasurySnap.exists ? Number(treasurySnap.data().balance || 0) : 0;
  if (pool <= 0) {
    await payoutRef.set({
      monthKey, totalPool: 0, recipients: {}, weightTotal: 0,
      note: 'No funds in treasury for this period.',
      distributedAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, monthKey, totalPool: 0, distributed: 0 };
  }

  // 4. Find all active Vanguard members and their action counts for this month.
  const membersSnap = await db.collection('users')
    .where('vanguard.rank', 'in', ['recruit', 'vanguard', 'senior', 'commander', 'overseer'])
    .get();
  const eligible = [];
  for (const doc of membersSnap.docs) {
    const u = doc.data();
    const v = u.vanguard || {};
    if (v.status === 'suspended' || v.status === 'retired') continue;
    const rankMeta = RANK_BY_ID[v.rank];
    if (!rankMeta || rankMeta.treasuryWeight <= 0) continue; // Recruits earn 0× until promoted
    const actions = (v.monthlyActions && v.monthlyActions[monthKey]) || 0;
    if (actions <= 0) continue;
    eligible.push({
      uid: doc.id,
      rank: v.rank,
      weight: rankMeta.treasuryWeight * actions,
      actions,
    });
  }

  // 5. Compute share per recipient. If no eligible members, refund the
  // pool back to the platform — don't let it sit forever.
  const weightTotal = eligible.reduce((s, e) => s + e.weight, 0);
  if (weightTotal <= 0 || eligible.length === 0) {
    // Refund to platform: drain treasury, write a platform-ledger entry.
    const batch = db.batch();
    batch.update(treasuryRef, { balance: 0, updatedAt: FieldValue.serverTimestamp() });
    batch.set(db.collection('transactions').doc(), {
      userId: '__platform__',
      type: 'vanguard_treasury_refund',
      amount: pool,
      description: `Vanguard treasury refund — no eligible recipients in ${monthKey}`,
      monthKey,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(payoutRef, {
      monthKey, totalPool: pool, weightTotal: 0, recipients: {},
      refundedToPlatform: pool,
      note: 'No eligible recipients — refunded to platform.',
      distributedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return { ok: true, monthKey, totalPool: pool, distributed: 0, refundedToPlatform: pool };
  }

  // 6. Compute exact integer payouts using "largest-remainder" to ensure
  // the sum equals the pool to the coin.
  const computed = eligible.map((e) => {
    const exact = (pool * e.weight) / weightTotal;
    const floored = Math.floor(exact);
    return { ...e, exact, floored, rem: exact - floored };
  });
  let leftover = pool - computed.reduce((s, c) => s + c.floored, 0);
  computed.sort((a, b) => b.rem - a.rem);
  for (let i = 0; i < leftover; i++) computed[i % computed.length].floored += 1;

  // 7. Write distribution as a single batch.
  const batch = db.batch();
  batch.update(treasuryRef, {
    balance: FieldValue.increment(-pool),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const recipients = {};
  for (const c of computed) {
    if (c.floored <= 0) continue;
    recipients[c.uid] = { coins: c.floored, rank: c.rank, actions: c.actions, weight: c.weight };
    // Credit the recipient's wallet.
    batch.set(db.collection('wallets').doc(c.uid), {
      balance: FieldValue.increment(c.floored),
      // convertible: vanguard treasury distribution (received value) — see coinLedger.js
      earnedBalance: FieldValue.increment(c.floored),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    // Ledger entry.
    batch.set(db.collection('transactions').doc(), {
      userId: c.uid,
      type: 'vanguard_treasury_payout',
      amount: c.floored,
      currency: 'coins',
      description: `Vanguard treasury share — ${monthKey} (${c.actions} actions, ${c.rank})`,
      monthKey,
      rank: c.rank,
      actions: c.actions,
      createdAt: FieldValue.serverTimestamp(),
    });
    // Notification.
    batch.set(db.collection('notifications').doc(), {
      recipientId: c.uid,
      type: 'vanguard_treasury_payout',
      title: `+${c.floored} coins — Vanguard treasury (${monthKey})`,
      body: `Your share for ${monthKey}. ${c.actions} action${c.actions === 1 ? '' : 's'} taken this period at ${RANK_BY_ID[c.rank].label} rank.`,
      data: { monthKey, amount: c.floored, rank: c.rank, actions: c.actions },
      actionUrl: '/vanguard/me',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  batch.set(payoutRef, {
    monthKey,
    totalPool: pool,
    weightTotal,
    recipients,
    distributedAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return { ok: true, monthKey, totalPool: pool, recipientCount: Object.keys(recipients).length };
}

const DB = 'vgrdb';
const HttpsError = functions.https.HttpsError;

const requireAuth = (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  return req.auth.uid;
};

const requireAdmin = async (uid) => {
  const db = admin.firestore(undefined, DB);
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists || userSnap.data().role !== 'admin') {
    throw new HttpsError('permission-denied', 'Founder/admin only.');
  }
};

// True if caller has role === 'admin'. Used to conditionally apply admin
// guards (step-up + admin_actions audit) on callables that can also be
// invoked by lower-rank Vanguard mods.
const isFounderUid = async (uid) => {
  if (!uid) return false;
  const db = admin.firestore(undefined, DB);
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists && snap.data().role === 'admin';
};

// Dual-write a row to admin_actions/ for the alert pipeline + cross-callable
// audit search. The existing vanguard_actions/ row is unaffected.
const auditFounderAction = async ({ actor, action, target, before, after, reason, meta, req, stepUpEnforced }) => {
  const m = adminSecurity.extractRequestMeta(req);
  return adminSecurity.auditAdminAction({
    actor, action, target, before, after, reason, meta,
    ip: m.ip,
    userAgent: m.userAgent,
    stepUpEnforced: !!stepUpEnforced,
    stepUpFresh: !!stepUpEnforced,
  }).catch(() => {});
};

const getVanguardRank = async (db, uid) => {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return null;
  return snap.data().vanguard?.rank || null;
};

// Load caller context for any mod action. Founder (role === 'admin') gets
// FULL authority equivalent to Overseer, no rank restrictions, no exceptions.
// Founder actions are still logged to the audit trail (with rank='founder')
// but skip VP grant + monthly-action bump since founder isn't a moderator
// earning treasury share.
async function loadActor(db, uid) {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Caller user not found.');
  const u = snap.data();
  const isFounder = u.role === 'admin';
  const v = u.vanguard || {};
  if (isFounder) {
    // Synthetic Overseer-equivalent context. Founder bypasses status checks
    // because they ARE the highest authority on the platform.
    return {
      uid,
      isFounder: true,
      rank: 'founder',
      rankMeta: { ...RANK_BY_ID.overseer, label: 'Founder', actionVp: 0 },
      auditRank: 'founder',
    };
  }
  if (!v.rank || v.status === 'suspended' || v.status === 'retired') {
    throw new HttpsError('permission-denied', 'Active Vanguard members only.');
  }
  if (v.rank === 'recruit') {
    throw new HttpsError('permission-denied', 'Recruits cannot take moderation actions. Shadow your seniors until promoted.');
  }
  return {
    uid,
    isFounder: false,
    rank: v.rank,
    rankMeta: RANK_BY_ID[v.rank],
    auditRank: v.rank,
  };
}

// ───────────────────────────────────────────────────────────
// Send a Vanguard invitation (founder only)
// ───────────────────────────────────────────────────────────
exports.inviteToVanguard = functions.https.onCall(
  { region: 'europe-west1' },
  async (req) => {
    const callerUid = requireAuth(req);
    await requireAdmin(callerUid);
    // Inviting someone in is the entry point to mod authority. Step-up
    // when inviting straight to senior+ to stop "alt account promoted to
    // Commander" attacks if the founder's session is stolen.
    let founderStepUp = false;
    if (req.data?.startRank && ['senior', 'commander', 'overseer'].includes(req.data.startRank)) {
      await adminSecurity.requireFreshStepUp(callerUid);
      founderStepUp = true;
    }
    await adminSecurity.adminRateLimit(callerUid, 'invite_to_vanguard', { perHour: 10, perDay: 30 });

    const { inviteeId, startRank = 'recruit', message = '' } = req.data || {};
    if (!inviteeId) throw new HttpsError('invalid-argument', 'inviteeId required.');
    if (!RANK_IDS.includes(startRank)) throw new HttpsError('invalid-argument', `startRank must be one of ${RANK_IDS.join(', ')}`);

    const db = admin.firestore(undefined, DB);

    // The invitee must exist and not already be Vanguard.
    const userSnap = await db.collection('users').doc(inviteeId).get();
    if (!userSnap.exists) throw new HttpsError('not-found', 'User not found.');
    if (userSnap.data().vanguard?.rank) {
      throw new HttpsError('failed-precondition', 'User is already Vanguard.');
    }

    // Dedupe — no two pending invitations for the same user.
    const dupSnap = await db.collection('vanguard_invitations')
      .where('inviteeId', '==', inviteeId)
      .where('status', '==', 'pending')
      .limit(1).get();
    if (!dupSnap.empty) throw new HttpsError('already-exists', 'Pending invitation already sent.');

    const userData = userSnap.data();
    const ref = await db.collection('vanguard_invitations').add({
      inviteeId,
      inviteeName: userData.displayName || userData.username || '',
      inviteeEmail: userData.email || '',
      invitedBy: callerUid,
      startRank,
      message: String(message || '').slice(0, 400),
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });

    // Notify the invitee.
    await db.collection('notifications').add({
      recipientId: inviteeId,
      type: 'vanguard_invite',
      title: 'You\'ve been invited to join the Vanguard',
      body: 'VERGR is inviting you to become a moderator. Tap to review the program and accept or decline.',
      data: { invitationId: ref.id, startRank },
      actionUrl: '/vanguard/invitation',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    }).catch(() => null);

    await auditFounderAction({
      actor: callerUid, action: 'invite_to_vanguard',
      target: { type: 'user', id: inviteeId },
      after: { startRank, invitationId: ref.id },
      req, stepUpEnforced: founderStepUp,
    });

    return { ok: true, invitationId: ref.id };
  }
);

// ───────────────────────────────────────────────────────────
// Accept an invitation. Sets the user's vanguard.rank + joins the
// Vanguard squad. Idempotent — second call is a no-op.
// ───────────────────────────────────────────────────────────
exports.acceptVanguardInvitation = functions.https.onCall(
  { region: 'europe-west1' },
  async (req) => {
    const uid = requireAuth(req);
    const { invitationId, acceptedConductCode = false } = req.data || {};
    if (!invitationId) throw new HttpsError('invalid-argument', 'invitationId required.');
    if (!acceptedConductCode) throw new HttpsError('failed-precondition', 'You must accept the Vanguard Code of Conduct to proceed.');

    const db = admin.firestore(undefined, DB);
    const ref = db.collection('vanguard_invitations').doc(invitationId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Invitation not found.');
    const inv = snap.data();
    if (inv.inviteeId !== uid) throw new HttpsError('permission-denied', 'Not your invitation.');
    if (inv.status !== 'pending') throw new HttpsError('failed-precondition', `Already ${inv.status}.`);

    // Get the Vanguard squad ID from app_config — bail if not configured.
    const cfgSnap = await db.collection('app_config').doc('general').get();
    const vanguardSquadId = cfgSnap.exists ? cfgSnap.data().vanguardSquadId : null;

    const now = FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.update(db.collection('users').doc(uid), {
      vanguard: {
        rank: inv.startRank,
        status: 'active',
        joinedAt: now,
        promotedAt: now,
        promotedBy: inv.invitedBy,
        totalActions: 0,
        lastActionAt: null,
        monthlyActions: {},
        warnings: [],
        acceptedConductAt: now,
      },
    });
    batch.update(ref, { status: 'accepted', respondedAt: now });

    // Audit entry.
    batch.set(db.collection('vanguard_actions').doc(), {
      moderatorId: uid,
      action: 'accept_invitation',
      targetType: 'self',
      targetId: uid,
      rank: inv.startRank,
      takenAt: now,
    });

    if (vanguardSquadId) {
      const squadRef = db.collection('squads').doc(vanguardSquadId);
      const squadSnap = await squadRef.get();
      if (squadSnap.exists) {
        const data = squadSnap.data();
        if (!(data.memberIds || []).includes(uid)) {
          batch.update(squadRef, {
            memberIds: FieldValue.arrayUnion(uid),
            memberCount: FieldValue.increment(1),
            updatedAt: now,
          });
          batch.set(squadRef.collection('members').doc(uid), {
            userId: uid,
            role: 'member',
            joinedAt: now,
          });
        }
      }
    }

    await batch.commit();
    return { ok: true, rank: inv.startRank };
  }
);

exports.declineVanguardInvitation = functions.https.onCall(
  { region: 'europe-west1' },
  async (req) => {
    const uid = requireAuth(req);
    const { invitationId } = req.data || {};
    if (!invitationId) throw new HttpsError('invalid-argument', 'invitationId required.');
    const db = admin.firestore(undefined, DB);
    const ref = db.collection('vanguard_invitations').doc(invitationId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Invitation not found.');
    if (snap.data().inviteeId !== uid) throw new HttpsError('permission-denied', 'Not your invitation.');
    await ref.update({ status: 'declined', respondedAt: FieldValue.serverTimestamp() });
    return { ok: true };
  }
);

// ───────────────────────────────────────────────────────────
// Promote / demote. Founder or Commander+ depending on target rank.
// Spec rules:
//   - Founder can promote/demote anyone to anything.
//   - Overseer can promote/demote up to Commander (not Overseer).
//   - Commander can promote Recruit → Vanguard only.
// ───────────────────────────────────────────────────────────
exports.changeVanguardRank = functions.https.onCall(
  { region: 'europe-west1' },
  async (req) => {
    const callerUid = requireAuth(req);
    const { targetUid, newRank, reason = '' } = req.data || {};
    if (!targetUid || !RANK_IDS.includes(newRank)) {
      throw new HttpsError('invalid-argument', 'targetUid + valid newRank required.');
    }
    const db = admin.firestore(undefined, DB);

    const [callerSnap, targetSnap] = await Promise.all([
      db.collection('users').doc(callerUid).get(),
      db.collection('users').doc(targetUid).get(),
    ]);
    if (!targetSnap.exists) throw new HttpsError('not-found', 'Target user not found.');

    const isFounder = callerSnap.exists && callerSnap.data().role === 'admin';
    const callerRank = callerSnap.exists ? callerSnap.data().vanguard?.rank : null;
    const targetRank = targetSnap.data().vanguard?.rank;
    if (!targetRank) throw new HttpsError('failed-precondition', 'Target is not Vanguard.');

    // Founder paths: step-up + rate-limit. Promotions to Commander+ are
    // especially sensitive — they're privileged-action-grants.
    let founderStepUp = false;
    if (isFounder) {
      const isHighStakes = newRank === 'overseer' || newRank === 'commander' || targetRank === 'overseer';
      if (isHighStakes) {
        await adminSecurity.requireFreshStepUp(callerUid);
        founderStepUp = true;
      }
      await adminSecurity.adminRateLimit(callerUid, 'change_vanguard_rank', { perHour: 5, perDay: 20 });
    }

    // Authorisation
    if (!isFounder) {
      if (callerRank === 'overseer') {
        if (newRank === 'overseer') throw new HttpsError('permission-denied', 'Only the founder can grant Overseer rank.');
      } else if (callerRank === 'commander') {
        if (!(targetRank === 'recruit' && newRank === 'vanguard')) {
          throw new HttpsError('permission-denied', 'Commanders can only promote Recruit → Vanguard.');
        }
      } else {
        throw new HttpsError('permission-denied', 'Insufficient rank to change another member\'s rank.');
      }
    }

    const now = FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.update(db.collection('users').doc(targetUid), {
      'vanguard.rank': newRank,
      'vanguard.promotedAt': now,
      'vanguard.promotedBy': callerUid,
    });
    batch.set(db.collection('vanguard_actions').doc(), {
      moderatorId: callerUid,
      action: RANK_BY_ID[newRank].order > RANK_BY_ID[targetRank].order ? 'promote' : 'demote',
      targetType: 'vanguard_member',
      targetId: targetUid,
      fromRank: targetRank,
      toRank: newRank,
      reason: String(reason).slice(0, 400),
      takenAt: now,
    });
    await batch.commit();

    // Notify the target.
    await db.collection('notifications').add({
      recipientId: targetUid,
      type: 'vanguard_rank_change',
      title: RANK_BY_ID[newRank].order > RANK_BY_ID[targetRank].order
        ? `Promoted to ${RANK_BY_ID[newRank].label}`
        : `Rank changed to ${RANK_BY_ID[newRank].label}`,
      body: reason || '',
      data: { fromRank: targetRank, toRank: newRank },
      actionUrl: '/vanguard/me',
      read: false,
      createdAt: now,
    }).catch(() => null);

    if (isFounder) {
      await auditFounderAction({
        actor: callerUid, action: 'change_vanguard_rank',
        target: { type: 'user', id: targetUid },
        before: { rank: targetRank },
        after:  { rank: newRank },
        reason, req, stepUpEnforced: founderStepUp,
      });
    }

    return { ok: true, newRank };
  }
);

// ───────────────────────────────────────────────────────────
// Suspend / retire / restore. Founder + Overseer (no self-demotion).
// ───────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────
// Bootstrap: set the Vanguard squad ID + flip its member cap to null
// (unlimited). Founder one-time call. Idempotent.
// ───────────────────────────────────────────────────────────
exports.setVanguardSquadConfig = functions.https.onCall(
  { region: 'europe-west1' },
  async (req) => {
    const uid = requireAuth(req);
    await requireAdmin(uid);
    // Platform-wide config write — require fresh TOTP step-up + rate-limit.
    await adminSecurity.requireFreshStepUp(uid);
    await adminSecurity.adminRateLimit(uid, 'set_vanguard_squad_config', { perHour: 5, perDay: 10 });
    const { squadId } = req.data || {};
    if (!squadId) throw new HttpsError('invalid-argument', 'squadId required.');
    const db = admin.firestore(undefined, DB);
    const squadSnap = await db.collection('squads').doc(squadId).get();
    if (!squadSnap.exists) throw new HttpsError('not-found', 'Squad not found.');

    const cfgBefore = (await db.collection('app_config').doc('general').get()).data()?.vanguardSquadId || null;

    const batch = db.batch();
    batch.set(db.collection('app_config').doc('general'),
      { vanguardSquadId: squadId, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    batch.update(db.collection('squads').doc(squadId), {
      maxMembers: null,        // unlimited
      isVanguardSquad: true,   // flag for code-side special-casing
      updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
    await auditFounderAction({
      actor: uid, action: 'set_vanguard_squad_config',
      target: { type: 'app_config', id: 'general' },
      before: { vanguardSquadId: cfgBefore },
      after:  { vanguardSquadId: squadId },
      req, stepUpEnforced: true,
    });
    return { ok: true, squadId };
  }
);

exports.setVanguardStatus = functions.https.onCall(
  { region: 'europe-west1' },
  async (req) => {
    const callerUid = requireAuth(req);
    const { targetUid, status, reason = '' } = req.data || {};
    if (!targetUid || !['active', 'suspended', 'retired'].includes(status)) {
      throw new HttpsError('invalid-argument', 'targetUid + valid status required.');
    }
    if (callerUid === targetUid) throw new HttpsError('failed-precondition', 'Cannot change your own status.');
    const db = admin.firestore(undefined, DB);

    const callerSnap = await db.collection('users').doc(callerUid).get();
    const isFounder = callerSnap.exists && callerSnap.data().role === 'admin';
    const callerRank = callerSnap.exists ? callerSnap.data().vanguard?.rank : null;
    if (!isFounder && callerRank !== 'overseer') {
      throw new HttpsError('permission-denied', 'Founder or Overseer only.');
    }

    // Founder paths: suspend / retire is a privileged action against another
    // user — require fresh step-up + rate-limit.
    let founderStepUp = false;
    if (isFounder) {
      if (status === 'suspended' || status === 'retired') {
        await adminSecurity.requireFreshStepUp(callerUid);
        founderStepUp = true;
      }
      await adminSecurity.adminRateLimit(callerUid, 'set_vanguard_status', { perHour: 10, perDay: 30 });
    }

    const targetSnap = await db.collection('users').doc(targetUid).get();
    if (!targetSnap.exists) throw new HttpsError('not-found', 'Target user not found.');
    const beforeStatus = targetSnap.data().vanguard?.status || null;
    const now = FieldValue.serverTimestamp();
    const batch = db.batch();
    batch.update(db.collection('users').doc(targetUid), { 'vanguard.status': status });
    batch.set(db.collection('vanguard_actions').doc(), {
      moderatorId: callerUid,
      action: `set_status_${status}`,
      targetType: 'vanguard_member',
      targetId: targetUid,
      reason: String(reason).slice(0, 400),
      takenAt: now,
    });
    await batch.commit();
    if (isFounder) {
      await auditFounderAction({
        actor: callerUid, action: 'set_vanguard_status',
        target: { type: 'user', id: targetUid },
        before: { status: beforeStatus },
        after:  { status },
        reason, req, stepUpEnforced: founderStepUp,
      });
    }
    return { ok: true, status };
  }
);

// ───────────────────────────────────────────────────────────
// Shared helper for any moderation action callable. Validates the caller
// is active Vanguard with the required authority, then runs `mutator(db,
// callerUid, rankMeta)` inside a batch and tacks on the standard
// post-action bookkeeping (audit log + monthlyActions bump + per-rank VP
// grant). `requiredAuthority` is a key on rankMeta.authority — e.g.
// `'canMute'`, `'canTempBan'`, `'canPermaBan'`.
//
// `actionType` is the string written to the vanguard_actions audit row.
// `actionDetails` is a function returning extra fields to merge into
// that row (target ids, durations, etc.).
async function runVanguardAction({ uid, requiredAuthority, actionType, mutator, actionDetails }) {
  const db = admin.firestore(undefined, DB);
  const actor = await loadActor(db, uid);
  const { isFounder, rankMeta, auditRank } = actor;

  // Authority check — founder bypasses entirely, mods checked against their rank's authority bits.
  if (!isFounder && requiredAuthority && !rankMeta.authority?.[requiredAuthority]) {
    throw new HttpsError('permission-denied', `Your rank (${rankMeta.label}) cannot do this. Requires a higher rank.`);
  }

  const monthKey = (() => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  })();
  const now = FieldValue.serverTimestamp();

  // Run the caller's mutator (their specific action) — returns details to
  // include in the audit log.
  const details = await mutator(db, uid, rankMeta, now) || {};

  // Standard bookkeeping in a second batch.
  const batch = db.batch();
  batch.set(db.collection('vanguard_actions').doc(), {
    moderatorId: uid,
    action: actionType,
    rank: auditRank,
    takenAt: now,
    ...details,
    ...(actionDetails ? actionDetails(details) : {}),
  });

  // Founder actions don't bump moderator stats or grant VP — they're the
  // platform owner, not a paid mod earning treasury share. Mods get both.
  if (!isFounder) {
    batch.update(db.collection('users').doc(uid), {
      [`vanguard.monthlyActions.${monthKey}`]: FieldValue.increment(1),
      'vanguard.totalActions': FieldValue.increment(1),
      'vanguard.lastActionAt': now,
    });
    if (rankMeta.actionVp > 0) {
      batch.set(db.collection('wallets').doc(uid), {
        vp: FieldValue.increment(rankMeta.actionVp),
        updatedAt: now,
      }, { merge: true });
      batch.set(db.collection('transactions').doc(), {
        userId: uid,
        type: 'vanguard_action_vp',
        amount: rankMeta.actionVp,
        currency: 'vp',
        description: `Vanguard ${actionType.replace(/_/g, ' ')} (${rankMeta.label})`,
        ...details,
        createdAt: now,
      });
    }
  }
  await batch.commit();

  return {
    ok: true,
    vpGranted: isFounder ? 0 : rankMeta.actionVp,
    rank: auditRank,
    monthKey,
    ...details,
  };
}

// ───────────────────────────────────────────────────────────
// vanguardResolveReport — Approve / reject / escalate a user report.
// Approve = the reported content/user gets taken down (post hidden or
// user muted depending on report type). Reject = report dismissed.
// Escalate = bumps to Commander+ queue (changes status only).
// ───────────────────────────────────────────────────────────
exports.vanguardResolveReport = functions.https.onCall(
  { region: 'europe-west1' },
  async (req) => {
    const uid = requireAuth(req);
    const { reportId, decision, reason = '' } = req.data || {};
    if (!reportId || !['approve', 'reject', 'escalate'].includes(decision)) {
      throw new HttpsError('invalid-argument', 'reportId + decision (approve|reject|escalate) required.');
    }
    return runVanguardAction({
      uid,
      requiredAuthority: 'canApproveReject',
      actionType: `report_${decision}`,
      mutator: async (db, callerUid) => {
        const reportRef = db.collection('reports').doc(reportId);
        const snap = await reportRef.get();
        if (!snap.exists) throw new HttpsError('not-found', 'Report not found.');
        const r = snap.data();
        if (['resolved', 'rejected', 'actioned'].includes(r.status)) {
          throw new HttpsError('failed-precondition', `Report already ${r.status}.`);
        }
        const newStatus = decision === 'approve' ? 'actioned'
                       : decision === 'reject'   ? 'rejected'
                       : 'escalated';
        await reportRef.update({
          status: newStatus,
          resolvedBy: callerUid,
          resolvedAt: FieldValue.serverTimestamp(),
          resolutionReason: String(reason).slice(0, 400),
        });
        // If approving and the target is a post, hide it.
        if (decision === 'approve' && r.targetType === 'post' && r.targetId) {
          await db.collection('posts').doc(r.targetId).update({
            status: 'hidden',
            hiddenReason: 'vanguard_approved_report',
            hiddenAt: FieldValue.serverTimestamp(),
            hiddenBy: callerUid,
          }).catch(() => null);
        }
        return {
          reportId,
          targetType: r.targetType,
          targetId: r.targetId,
          decision,
          newStatus,
          reason: String(reason).slice(0, 400),
        };
      },
    });
  }
);

// ───────────────────────────────────────────────────────────
// vanguardReviewAiFlag — resolve a Gemini 'flag' verdict on a post.
// Posts the AI flags get moderationStatus 'pending_review'; a mod either
// CONFIRMS (violation → post hidden) or marks it CLEAN (AI was wrong).
// Either way the verdict is recorded on the post's aiReview field, giving
// prompt tuning real ground truth (11-doc P2.3).
// ───────────────────────────────────────────────────────────
exports.vanguardReviewAiFlag = functions.https.onCall(
  { region: 'europe-west1' },
  async (req) => {
    const uid = requireAuth(req);
    const { postId, verdict } = req.data || {};
    if (!postId || !['violation', 'clean'].includes(verdict)) {
      throw new HttpsError('invalid-argument', 'postId + verdict (violation|clean) required.');
    }
    return runVanguardAction({
      uid,
      requiredAuthority: 'canApproveReject',
      actionType: `ai_flag_${verdict}`,
      mutator: async (db, callerUid) => {
        const ref = db.collection('posts').doc(postId);
        const snap = await ref.get();
        if (!snap.exists) throw new HttpsError('not-found', 'Post not found.');
        const p = snap.data();
        if (p.moderationStatus !== 'pending_review') {
          throw new HttpsError('failed-precondition', 'Post is not awaiting AI-flag review.');
        }
        const patch = {
          moderationStatus: verdict === 'violation' ? 'reviewed_hidden' : 'clear',
          // Ground truth for prompt tuning: was the AI flag right?
          aiReview: {
            verdict: verdict === 'violation' ? 'confirmed' : 'wrong',
            by: callerUid,
            at: FieldValue.serverTimestamp(),
            aiCategory: p.aiVerdict?.results?.find?.((r) => r.verdict === 'flag')?.category || null,
          },
        };
        if (verdict === 'violation') {
          patch.hidden = true;
          patch.hiddenReason = 'vanguard_confirmed_ai_flag';
          patch.hiddenAt = FieldValue.serverTimestamp();
          patch.hiddenBy = callerUid;
        }
        await ref.update(patch);
        return { postId, verdict, targetType: 'post', targetId: postId };
      },
    });
  }
);

// ───────────────────────────────────────────────────────────
// vanguardMuteUser — Mute a user for `hours` (rank-capped).
// Vanguard ≤ 24h, Senior ≤ 168h (7d), Commander ≤ 720h (30d), Overseer
// unlimited. Writes `mutedUntil` timestamp on the user doc; client-side
// mute checks read this on chat send / post create.
// ───────────────────────────────────────────────────────────
exports.vanguardMuteUser = functions.https.onCall(
  { region: 'europe-west1' },
  async (req) => {
    const uid = requireAuth(req);
    const { targetUid, hours, reason = '' } = req.data || {};
    if (!targetUid || !hours || hours < 1) throw new HttpsError('invalid-argument', 'targetUid + hours (≥1) required.');
    if (targetUid === uid) throw new HttpsError('failed-precondition', 'Cannot mute yourself.');
    return runVanguardAction({
      uid,
      requiredAuthority: 'canMute',
      actionType: 'mute_user',
      mutator: async (db, callerUid, rankMeta) => {
        const cap = rankMeta.authority.muteMaxHours;
        if (cap !== null && hours > cap) {
          throw new HttpsError('permission-denied', `Your rank (${rankMeta.label}) can mute at most ${cap} hours. Request a Senior+ to extend.`);
        }
        const until = Date.now() + hours * 3600 * 1000;
        await db.collection('users').doc(targetUid).update({
          mutedUntil: new Date(until),
          mutedBy: callerUid,
          mutedAt: FieldValue.serverTimestamp(),
          muteReason: String(reason).slice(0, 400),
        });
        return { targetUid, hours, until, reason: String(reason).slice(0, 400) };
      },
    });
  }
);

// ───────────────────────────────────────────────────────────
// vanguardTempBanUser — Temp-ban a user for `days`. Senior+ only.
// Writes `banUntil` + `banned: true` flags. Auth context layer should
// reject signed-in sessions whose user doc has `banUntil > now`.
// ───────────────────────────────────────────────────────────
exports.vanguardTempBanUser = functions.https.onCall(
  { region: 'europe-west1' },
  async (req) => {
    const uid = requireAuth(req);
    const { targetUid, days, reason = '' } = req.data || {};
    if (!targetUid || !days || days < 1) throw new HttpsError('invalid-argument', 'targetUid + days (≥1) required.');
    if (targetUid === uid) throw new HttpsError('failed-precondition', 'Cannot ban yourself.');
    return runVanguardAction({
      uid,
      requiredAuthority: 'canTempBan',
      actionType: 'temp_ban_user',
      mutator: async (db, callerUid, rankMeta) => {
        const cap = rankMeta.authority.tempBanMaxDays;
        if (cap !== null && days > cap) {
          throw new HttpsError('permission-denied', `Your rank (${rankMeta.label}) can temp-ban for at most ${cap} days.`);
        }
        const until = Date.now() + days * 24 * 3600 * 1000;
        await db.collection('users').doc(targetUid).update({
          banned: true,
          banUntil: new Date(until),
          banReason: String(reason).slice(0, 400),
          bannedBy: callerUid,
          bannedAt: FieldValue.serverTimestamp(),
        });
        return { targetUid, days, until, reason: String(reason).slice(0, 400) };
      },
    });
  }
);

// ───────────────────────────────────────────────────────────
// vanguardPermaBanUser — Permaban. Commander+ only. Sets banned + clears
// any timed ban so this is irreversible without an Overseer/founder
// override.
// ───────────────────────────────────────────────────────────
exports.vanguardPermaBanUser = functions.https.onCall(
  { region: 'europe-west1' },
  async (req) => {
    const uid = requireAuth(req);
    const { targetUid, reason = '' } = req.data || {};
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');
    if (targetUid === uid) throw new HttpsError('failed-precondition', 'Cannot ban yourself.');
    return runVanguardAction({
      uid,
      requiredAuthority: 'canPermaBan',
      actionType: 'perma_ban_user',
      mutator: async (db, callerUid) => {
        await db.collection('users').doc(targetUid).update({
          banned: true,
          banUntil: null,  // permanent
          banReason: String(reason).slice(0, 400),
          bannedBy: callerUid,
          bannedAt: FieldValue.serverTimestamp(),
          permabanned: true,
        });
        return { targetUid, reason: String(reason).slice(0, 400) };
      },
    });
  }
);

// ───────────────────────────────────────────────────────────
// vanguardCallTournamentWinner — official moderator winner call for
// tournaments without an API to auto-decide. The caller must be Vanguard
// rank or above (Recruits are read-only). Effects:
//   1. Records the match result through the shared internal helper
//      (`_internal_recordMatchResult`) with source='vanguard' — that path
//      treats this as authoritative (same trust as admin/gsi/gameapi) and
//      advances the bracket if the match was the last open one.
//   2. Sets `vanguardModerated: true` on the tournament doc + appends the
//      caller's uid to `vanguardModerators[]`. The flag is what
//      `finalizeTournamentSecure` later reads to route the 5% mod cut
//      into the Vanguard treasury.
//   3. Writes a `vanguard_actions/` audit entry.
//   4. Bumps the caller's `users/{uid}.vanguard.monthlyActions[YYYY-MM]`
//      + `totalActions` + `lastActionAt`. The monthly-actions count is
//      what the treasury cron uses to weight the share.
//   5. Grants the caller +rank-specific VP (Vanguard +50, Senior +100,
//      Commander +200, Overseer +500).
// ───────────────────────────────────────────────────────────
exports.vanguardCallTournamentWinner = functions.https.onCall(
  { region: 'europe-west1' },
  async (req) => {
    const uid = requireAuth(req);
    const { tournamentId, matchId, winnerId, reason = '' } = req.data || {};
    if (!tournamentId || !matchId || !winnerId) {
      throw new HttpsError('invalid-argument', 'tournamentId + matchId + winnerId required.');
    }

    const db = admin.firestore(undefined, DB);

    // Authorisation: founder OR active non-Recruit Vanguard.
    const actor = await loadActor(db, uid);
    const { isFounder, rankMeta, auditRank } = actor;

    // Commander-override gate: if the auto-OCR cron stamped a HIGH confidence
    // suggestion onto the match AND this Vanguard (below Commander, non-
    // founder) is picking the opposite winner, route to Commander review
    // instead of recording the result. The mod could still be correct
    // (OCR can misread), but high-confidence disagreement = bias check.
    const matchSnap = await db.collection('tournaments').doc(tournamentId)
      .collection('matches').doc(matchId).get();
    const matchData = matchSnap.exists ? matchSnap.data() : {};
    const ai = matchData.aiSuggestion || null;
    const isCommanderPlus = isFounder || ['commander', 'overseer'].includes(rankMeta?.id);
    if (
      ai &&
      ai.confidence === 'high' &&
      ai.suggestedWinnerId &&
      ai.suggestedWinnerId !== winnerId &&
      !isCommanderPlus
    ) {
      await db.collection('tournaments').doc(tournamentId)
        .collection('matches').doc(matchId).set({
          commanderReviewRequired: true,
          modProposedWinnerId: winnerId,
          modProposedBy: uid,
          modProposedReason: String(reason).slice(0, 400),
          modProposedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      await db.collection('vanguard_actions').add({
        moderatorId: uid,
        action: 'tournament_winner_call_review_required',
        targetType: 'tournament_match',
        targetId: `${tournamentId}/${matchId}`,
        tournamentId,
        matchId,
        winnerId,
        aiSuggestedWinnerId: ai.suggestedWinnerId,
        rank: auditRank,
        reason: `High-confidence AI disagreement — awaiting Commander review. ${String(reason).slice(0, 200)}`,
        takenAt: FieldValue.serverTimestamp(),
      });
      return {
        ok: false,
        reviewRequired: true,
        message: 'AI suggestion disagrees with your pick at high confidence. A Commander will review.',
      };
    }

    // Delegate the actual match-result write to the existing internal
    // helper. It validates the winner is a participant, ensures the
    // tournament is active, and triggers `advanceBracketAfterMatch` on
    // completion (which can auto-finalize the tournament).
    const tournaments = require('./tournaments');
    await tournaments._internal_recordMatchResult({
      reporterUid: uid,
      tournamentId,
      matchId,
      winnerId,
      source: isFounder ? 'admin' : 'vanguard',
      evidenceUrl: null,
    });

    const monthKey = (() => {
      const d = new Date();
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    })();
    const now = FieldValue.serverTimestamp();
    const batch = db.batch();

    // Founder calls still flag the tournament as "moderated" so the 5%
    // mod cut routes to the Vanguard treasury (founder is choosing to
    // fund the mod program even when personally deciding the match).
    batch.update(db.collection('tournaments').doc(tournamentId), {
      vanguardModerated: true,
      vanguardModerators: FieldValue.arrayUnion(uid),
    });

    batch.set(db.collection('vanguard_actions').doc(), {
      moderatorId: uid,
      action: 'tournament_winner_call',
      targetType: 'tournament_match',
      targetId: `${tournamentId}/${matchId}`,
      tournamentId,
      matchId,
      winnerId,
      rank: auditRank,
      reason: String(reason).slice(0, 400),
      takenAt: now,
    });

    // Mod stats + VP grant — skipped for founder (not a paid mod).
    if (!isFounder) {
      batch.update(db.collection('users').doc(uid), {
        [`vanguard.monthlyActions.${monthKey}`]: FieldValue.increment(1),
        'vanguard.totalActions': FieldValue.increment(1),
        'vanguard.lastActionAt': now,
      });

      if (rankMeta.actionVp > 0) {
        batch.set(db.collection('wallets').doc(uid), {
          vp: FieldValue.increment(rankMeta.actionVp),
          updatedAt: now,
        }, { merge: true });
        batch.set(db.collection('transactions').doc(), {
          userId: uid,
          type: 'vanguard_action_vp',
          amount: rankMeta.actionVp,
          currency: 'vp',
          description: `Vanguard winner call — tournament match (${rankMeta.label})`,
          tournamentId,
          matchId,
          createdAt: now,
        });
      }
    }

    await batch.commit();

    return {
      ok: true,
      monthKey,
      vpGranted: isFounder ? 0 : rankMeta.actionVp,
      rank: auditRank,
    };
  }
);

// ───────────────────────────────────────────────────────────
// vanguardResolveQueueItem — resolves a Vanguard Review Queue item
// (AI Review / Anti-Cheat / Replay Request) with REAL consequences:
// audit log, status update, target notification, and (when the action
// warrants it) match forfeit + user flag bump.
//
// Authority: 'confirm' on Anti-Cheat RED requires canTempBan (Senior+)
// because it forfeits the player. All other paths require canApproveReject
// (Vanguard+). Recruits are blocked by loadActor.
// ───────────────────────────────────────────────────────────
exports.vanguardResolveQueueItem = functions.https.onCall(
  { region: 'europe-west1' },
  async (req) => {
    const uid = requireAuth(req);
    const { kind, itemId, action, notes = '' } = req.data || {};
    if (!['ai', 'ac', 'rp'].includes(kind)) {
      throw new HttpsError('invalid-argument', 'kind must be ai|ac|rp');
    }
    if (!itemId) throw new HttpsError('invalid-argument', 'itemId required');
    if (!['confirm', 'clear'].includes(action)) {
      throw new HttpsError('invalid-argument', 'action must be confirm|clear');
    }

    const COLLECTIONS = {
      ai: 'tournament_review_queue',
      ac: 'anti_cheat_alerts',
      rp: 'replay_review_requests',
    };
    const collName = COLLECTIONS[kind];
    const cleanNotes = String(notes || '').slice(0, 400);

    // Pre-fetch the queue item so we can decide required authority.
    const dbEarly = admin.firestore(undefined, DB);
    const itemSnap = await dbEarly.collection(collName).doc(itemId).get();
    if (!itemSnap.exists) throw new HttpsError('not-found', 'Queue item not found.');
    const item = itemSnap.data();
    if (item.status && item.status !== 'pending') {
      throw new HttpsError('failed-precondition', `Item already ${item.status}.`);
    }

    // AC RED confirm = forfeit + flag. Needs canTempBan. Everything else
    // is canApproveReject (Vanguard+).
    const forfeitPath = kind === 'ac' && action === 'confirm' && item.severity === 'red';
    const requiredAuthority = forfeitPath ? 'canTempBan' : 'canApproveReject';

    return runVanguardAction({
      uid,
      requiredAuthority,
      actionType: `queue_${kind}_${action}`,
      mutator: async (db, callerUid) => {
        const newStatus = action === 'confirm' ? 'confirmed' : 'cleared';
        const itemRef = db.collection(collName).doc(itemId);
        await itemRef.update({
          status: newStatus,
          resolverUid: callerUid,
          resolvedAt: FieldValue.serverTimestamp(),
          resolverNotes: cleanNotes,
        });

        const tournamentId = item.tournamentId || null;
        const matchId = item.matchId || null;
        const consequences = [];

        // ─── AI Review ────────────────────────────────────────────────
        if (kind === 'ai') {
          // Subject = the flagged player. Try item.flaggedUid, fall back
          // to the match's existing cheatFlag subject if any.
          let subjectUid = item.flaggedUid || item.uid || null;
          if (tournamentId && matchId) {
            const mRef = db.collection('tournaments').doc(tournamentId)
              .collection('matches').doc(matchId);
            await mRef.set({
              cheatFlag: {
                [action === 'confirm' ? 'confirmed' : 'cleared']: true,
                lastReviewAt: FieldValue.serverTimestamp(),
                lastReviewBy: callerUid,
                severity: item.severity || null,
                flags: item.flags || [],
                subjectUid: subjectUid || null,
              },
            }, { merge: true });
            consequences.push('match_flag_updated');
          }
          if (subjectUid && action === 'confirm') {
            await db.collection('users').doc(subjectUid).set({
              tournamentTrust: {
                confirmedFlags: FieldValue.increment(1),
                lastFlagAt: FieldValue.serverTimestamp(),
              },
            }, { merge: true });
            consequences.push('trust_flag_incremented');
          }
          if (subjectUid) {
            await db.collection('notifications').add({
              recipientId: subjectUid,
              type: action === 'confirm' ? 'tournament_flag_confirmed' : 'tournament_flag_cleared',
              title: action === 'confirm'
                ? 'AI-flagged tournament moment confirmed by a moderator'
                : 'Tournament review cleared',
              body: action === 'confirm'
                ? 'A Vanguard moderator reviewed flagged footage from your tournament match and confirmed an issue.'
                : 'A Vanguard moderator reviewed flagged footage from your tournament match and found no issue.',
              data: { tournamentId, matchId },
              actionUrl: tournamentId && matchId ? `/tournaments/${tournamentId}/match/${matchId}` : '/tournaments',
              read: false, createdAt: FieldValue.serverTimestamp(),
            }).catch(() => null);
            consequences.push('subject_notified');
          }
          return { kind, itemId, action, tournamentId, matchId, subjectUid, consequences };
        }

        // ─── Anti-Cheat ───────────────────────────────────────────────
        if (kind === 'ac') {
          const subjectUid = item.uid || null;
          if (action === 'confirm') {
            // RED severity = auto-forfeit current match + flag account.
            if (item.severity === 'red' && tournamentId && matchId && subjectUid) {
              const mSnap = await db.collection('tournaments').doc(tournamentId)
                .collection('matches').doc(matchId).get();
              if (mSnap.exists) {
                const m = mSnap.data();
                const opponentUid = m.player1 === subjectUid ? m.player2
                                   : m.player2 === subjectUid ? m.player1 : null;
                if (opponentUid && m.status !== 'completed') {
                  try {
                    const tournaments = require('./tournaments');
                    await tournaments._internal_recordMatchResult({
                      reporterUid: callerUid,
                      tournamentId, matchId,
                      winnerId: opponentUid,
                      source: 'admin',
                      evidenceUrl: null,
                    });
                    consequences.push('match_forfeited');
                  } catch (err) {
                    consequences.push(`forfeit_failed:${err?.code || 'unknown'}`);
                  }
                }
              }
            }
            // Flag account regardless of severity.
            await db.collection('users').doc(subjectUid).set({
              tournamentTrust: {
                confirmedCheatScans: FieldValue.increment(1),
                lastCheatScanAt: FieldValue.serverTimestamp(),
                lastCheatScanSeverity: item.severity || null,
              },
            }, { merge: true });
            consequences.push('account_flagged');
          }
          if (subjectUid) {
            await db.collection('notifications').add({
              recipientId: subjectUid,
              type: action === 'confirm' ? 'anti_cheat_confirmed' : 'anti_cheat_cleared',
              title: action === 'confirm'
                ? 'Anti-cheat alert confirmed'
                : 'Anti-cheat alert cleared',
              body: action === 'confirm'
                ? (item.severity === 'red'
                    ? 'A moderator confirmed a cheat-tool detection on your machine. The current match was forfeited.'
                    : 'A moderator flagged suspicious software detected on your machine during a tournament match.')
                : 'A moderator reviewed an anti-cheat alert on your account and dismissed it.',
              data: { tournamentId, matchId, severity: item.severity || null },
              actionUrl: tournamentId && matchId ? `/tournaments/${tournamentId}/match/${matchId}` : '/tournaments',
              read: false, createdAt: FieldValue.serverTimestamp(),
            }).catch(() => null);
            consequences.push('subject_notified');
          }
          return { kind, itemId, action, tournamentId, matchId, subjectUid, severity: item.severity, consequences };
        }

        // ─── Replay Review ────────────────────────────────────────────
        if (kind === 'rp') {
          const requesterUid = item.requesterUid || null;
          // On confirm, escalate the moment into the AI Review queue so
          // it gets a deeper VOD pass. On clear, just notify the requester.
          if (action === 'confirm' && tournamentId && matchId) {
            await db.collection('tournament_review_queue').add({
              status: 'pending',
              tournamentId, matchId,
              severity: 'medium',
              source: 'replay_escalation',
              originReplayId: itemId,
              flags: [{ type: 'replay_flagged', tSec: item.timestampSec || 0, severity: 3, note: item.reason || '' }],
              flaggedUid: item.targetUid || null,
              createdAt: FieldValue.serverTimestamp(),
            });
            consequences.push('escalated_to_ai_review');
          }
          if (requesterUid) {
            await db.collection('notifications').add({
              recipientId: requesterUid,
              type: action === 'confirm' ? 'replay_review_confirmed' : 'replay_review_cleared',
              title: action === 'confirm' ? 'Replay request escalated' : 'Replay request reviewed',
              body: action === 'confirm'
                ? 'A Vanguard moderator agreed with your replay request and escalated it for deeper review.'
                : 'A Vanguard moderator reviewed your replay request and found no violation.',
              data: { tournamentId, matchId, timestampSec: item.timestampSec || 0 },
              actionUrl: tournamentId && matchId ? `/tournaments/${tournamentId}/match/${matchId}` : '/tournaments',
              read: false, createdAt: FieldValue.serverTimestamp(),
            }).catch(() => null);
            consequences.push('requester_notified');
          }
          return { kind, itemId, action, tournamentId, matchId, requesterUid, consequences };
        }

        return { kind, itemId, action, consequences };
      },
    });
  }
);

// ───────────────────────────────────────────────────────────
// Scheduled: monthly Vanguard treasury distribution.
// Fires at 00:05 UTC on the 1st of every month. Settles the
// JUST-CLOSED previous month. Idempotent via vanguard_payouts/{monthKey}.
// ───────────────────────────────────────────────────────────
const defer = (_opts, fn) => fn; // cron-consolidation shim (see index.js cronMonthly)
exports.distributeVanguardTreasury = defer(
  { schedule: '5 0 1 * *', timeZone: 'UTC', region: 'europe-west1' },
  async () => {
    const db = admin.firestore(undefined, DB);
    const monthKey = previousMonthKey();
    const result = await distributeMonth(db, monthKey);
    console.log('[Vanguard treasury cron]', JSON.stringify(result));
    return result;
  }
);

// ───────────────────────────────────────────────────────────
// Admin-only: trigger a Vanguard treasury distribution NOW. Lets the
// founder run the cron mid-month for testing or to clear a stuck pool.
// Optional `monthKey` to settle a specific month (defaults to current).
// ───────────────────────────────────────────────────────────
exports.adminTriggerVanguardDistribution = functions.https.onCall(
  { region: 'europe-west1' },
  async (req) => {
    const uid = requireAuth(req);
    await requireAdmin(uid);
    // Moves money platform-wide — require fresh TOTP step-up + tight rate-limit.
    // Even if TOTP secret is stolen, attacker can fire at most once per hour.
    await adminSecurity.requireFreshStepUp(uid);
    await adminSecurity.adminRateLimit(uid, 'admin_trigger_vanguard_distribution',
      { perHour: 1, perDay: 3, perMonth: 12 });
    const db = admin.firestore(undefined, DB);
    // Default to the CURRENT running month so the founder can test before
    // the 1st-of-next-month cron fires. Pass an explicit `monthKey` to
    // settle a past month.
    let monthKey = req.data?.monthKey;
    if (!monthKey) {
      const d = new Date();
      monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    const result = await distributeMonth(db, monthKey);
    await auditFounderAction({
      actor: uid, action: 'admin_trigger_vanguard_distribution',
      target: { type: 'vanguard_payout', id: monthKey },
      after: { totalPool: result.totalPool, distributed: result.distributed, recipientCount: result.recipientCount },
      req, stepUpEnforced: true,
    });
    return result;
  }
);
