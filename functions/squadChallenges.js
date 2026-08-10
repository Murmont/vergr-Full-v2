// Squad challenges — reward distribution.
//
// When a challenge doc transitions to `status: 'completed'` we grant the
// configured VP (and coin) rewards to every eligible contributor and write
// a transactions ledger entry per recipient.
//
// Eligibility:
//   - scope === 'squad'      → every uid with progress > 0
//   - scope === 'individual' → every uid whose progress >= goal
//
// Idempotent: once paid we set `rewardsPaid: true` + `paidOutTo: [uids]` on
// the challenge doc. A second status-flip is a no-op.
//
// Coin rewards: per the platform's hard rules, coins must come from somewhere
// real (not printed). For now we pay coins out of the squad's treasury
// (`squads/{id}/wallet/main`). If the treasury can't cover the total cost,
// we degrade gracefully — pay VP, log the shortfall, and leave the challenge
// flagged so an admin can top up + retry.
const functions = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const DB_NAME = 'vgrdb';

exports.onSquadChallengeCompleted = functions.firestore.onDocumentUpdated(
  { document: 'squads/{squadId}/challenges/{challengeId}', region: 'europe-west1', database: DB_NAME },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;
    if (after.rewardsPaid) return; // idempotent
    const wentToCompleted = before.status !== 'completed' && after.status === 'completed';
    if (!wentToCompleted) return;

    const { squadId, challengeId } = event.params;
    const db = admin.firestore(undefined, DB_NAME);
    const challengeRef = db.collection('squads').doc(squadId).collection('challenges').doc(challengeId);

    // Determine recipients
    const progress = after.progress || {};
    const goal = Number(after.goal) || 1;
    const scope = after.scope === 'individual' ? 'individual' : 'squad';
    const recipients = Object.entries(progress)
      .filter(([uid, val]) => {
        if (!uid || typeof val !== 'number' || val <= 0) return false;
        return scope === 'squad' ? true : val >= goal;
      })
      .map(([uid]) => uid);

    if (recipients.length === 0) {
      await challengeRef.update({ rewardsPaid: true, paidOutTo: [], paidAt: FieldValue.serverTimestamp(), payoutNote: 'No eligible recipients.' });
      return;
    }

    const vpReward = Math.max(0, Math.floor(Number(after.vpReward) || 0));
    const coinReward = Math.max(0, Math.floor(Number(after.coinReward) || 0));
    const totalCoinCost = coinReward * recipients.length;

    // Treasury check (only matters if coins are involved)
    let payCoins = coinReward > 0;
    let treasuryShortfall = null;
    if (payCoins) {
      const treasuryRef = db.collection('squads').doc(squadId).collection('wallet').doc('main');
      const treasurySnap = await treasuryRef.get();
      const treasuryBalance = treasurySnap.exists ? (treasurySnap.data().balance || 0) : 0;
      if (treasuryBalance < totalCoinCost) {
        payCoins = false;
        treasuryShortfall = `treasury has ${treasuryBalance} coins, needed ${totalCoinCost} (${coinReward} × ${recipients.length} recipients)`;
      }
    }

    // Single transaction: debit treasury (if applicable), credit each wallet,
    // write per-recipient ledger entries, mark challenge paid.
    const now = FieldValue.serverTimestamp();
    await db.runTransaction(async (tx) => {
      if (payCoins) {
        const treasuryRef = db.collection('squads').doc(squadId).collection('wallet').doc('main');
        tx.update(treasuryRef, {
          balance: FieldValue.increment(-totalCoinCost),
          updatedAt: now,
        });
      }
      for (const uid of recipients) {
        const walletRef = db.collection('wallets').doc(uid);
        const walletSnap = await tx.get(walletRef);
        const updates = { updatedAt: now };
        if (vpReward > 0) updates.vp = FieldValue.increment(vpReward);
        if (payCoins && coinReward > 0) updates.balance = FieldValue.increment(coinReward);
        if (walletSnap.exists) {
          tx.update(walletRef, updates);
        } else {
          tx.set(walletRef, { balance: payCoins ? coinReward : 0, gems: 0, vp: vpReward, ...updates });
        }
        const txRef = db.collection('transactions').doc();
        tx.set(txRef, {
          userId: uid,
          type: 'squad_challenge_reward',
          squadId,
          challengeId,
          challengeTitle: after.title || '',
          vp: vpReward,
          coins: payCoins ? coinReward : 0,
          scope,
          createdAt: now,
        });
      }
      tx.update(challengeRef, {
        rewardsPaid: true,
        paidOutTo: recipients,
        paidVp: vpReward,
        paidCoins: payCoins ? coinReward : 0,
        paidAt: now,
        payoutNote: treasuryShortfall
          ? `VP only — ${treasuryShortfall}. Top up treasury and an admin can manually distribute coins.`
          : null,
      });
    });

    // Send notifications outside the transaction. Field name `recipientId`
    // matches what `firestore.rules` reads ON (resource.data.recipientId).
    const rewardBits = [];
    if (vpReward > 0) rewardBits.push(`+${vpReward} VP`);
    if (payCoins && coinReward > 0) rewardBits.push(`+${coinReward} coins`);
    const body = `Challenge complete: "${after.title || 'Untitled'}". You earned ${rewardBits.join(' & ') || 'rewards'}.`;
    const notifyPromises = recipients.map(uid =>
      db.collection('notifications').add({
        recipientId: uid,
        type: 'squad_challenge_reward',
        squadId,
        title: 'Squad challenge reward',
        body,
        data: { challengeId, vp: vpReward, coins: payCoins ? coinReward : 0 },
        read: false,
        createdAt: now,
      }).catch((e) => { console.warn('notif write failed:', e?.message); return null; })
    );
    await Promise.all(notifyPromises);
  }
);

// ───────────────────────────────────────────────────────────
// Squad invitation notifications.
// Fires when a `squad_invitations/{id}` doc is created. Drops a
// notification into the invitee's inbox. Cloud-function-only because
// firestore.rules blocks client writes to `notifications`.
// ───────────────────────────────────────────────────────────
exports.onSquadInvitationCreated = functions.firestore.onDocumentCreated(
  { document: 'squad_invitations/{invitationId}', region: 'europe-west1', database: DB_NAME },
  async (event) => {
    const inv = event.data?.data();
    if (!inv || !inv.inviteeId) return;
    const db = admin.firestore(undefined, DB_NAME);
    try {
      await db.collection('notifications').add({
        recipientId: inv.inviteeId,
        type: 'squad_invite',
        squadId: inv.squadId,
        title: `${inv.inviterName || 'A squad leader'} invited you to ${inv.squadName || 'a squad'}`,
        body: inv.message || 'Tap to view and respond.',
        data: { invitationId: event.params.invitationId },
        actionUrl: '/squads/invitations',
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.warn('squad invite notif write failed:', e?.message);
    }
  }
);
