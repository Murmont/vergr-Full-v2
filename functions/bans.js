// Bans, in one place, because until 2026-09-20 a ban did almost nothing.
//
// What a ban USED to do: write `banned: true` on users/{uid}, and (for the two
// admin callables only) revoke refresh tokens. Nothing read that field. Not the
// client, not firestore.rules, not any callable. The Vanguard ban paths did not
// even revoke tokens, and the comment above vanguardTempBanUser said "Auth
// context layer should reject signed-in sessions" — a layer nobody ever built.
// So a banned user signed straight back in and carried on posting.
//
// What a ban does NOW, and each piece exists because the others are not enough:
//   1. Firebase Auth `disabled: true`. This is the real lock: it blocks every
//      future sign-in, on every device and provider, and it is enforced by
//      Google rather than by our code.
//   2. revokeRefreshTokens, so a session already open cannot mint a new ID
//      token (within the hour its current one expires).
//   3. The fields on users/{uid}, which the CLIENT now reads off the snapshot
//      it already holds (UserContext), so an open session is gated instantly
//      instead of waiting for its token to expire. Zero extra reads.
//
// ⚠ NOTHING HERE IS A CLOUD FUNCTION. It is a module the ban callables and the
// existing cron dispatcher require, so it adds no deployed function and no
// billable resource.

const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { HttpsError } = require('firebase-functions/v2/https');
const { isOperator } = require('./operator');
const { isStaffDoc } = require('./staff');

const db = getFirestore('vgrdb');

// Refuses to moderate the people who do the moderating. The founder check was
// already in adminUsers.js; the Operator check is new and matters more, because
// disabling the admin account is the one ban nobody could undo from inside the
// product.
async function assertBannable(targetUid) {
  if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');
  if (await isOperator(targetUid)) {
    throw new HttpsError('permission-denied', 'Cannot moderate an operator account.');
  }
  const snap = await db.collection('users').doc(targetUid).get();
  // ⚠ `staff` is the founder's own account since role:'admin' came off it
  // (2026-09-20). Checking role alone would let a moderator ban the founder.
  if (snap.exists && (isStaffDoc(snap.data()) || snap.data().role === 'admin')) {
    throw new HttpsError('permission-denied', 'Cannot moderate the platform owner.');
  }
  return snap.exists ? snap.data() : null;
}

// Disabling the Auth account is what actually stops them. It is deliberately
// NOT fatal to the ban: if Auth is having a bad minute the flags and the client
// gate still land, and the sweep below reconciles.
async function setAuthDisabled(uid, disabled) {
  try {
    await getAuth().updateUser(uid, { disabled });
    return true;
  } catch (e) {
    console.error('[bans] setAuthDisabled failed', uid, disabled, e?.message);
    return false;
  }
}

/**
 * Apply a ban. Used by every ban path: adminBanUser, vanguardTempBanUser,
 * vanguardPermaBanUser.
 * @param {string} targetUid
 * @param {{ byUid: string, permanent?: boolean, untilMs?: number|null,
 *           reason?: string, notify?: boolean }} opts
 */
async function applyBan(targetUid, opts) {
  const { byUid, permanent = false, untilMs = null, reason = '', notify = true } = opts || {};
  const before = await assertBannable(targetUid);
  const banUntil = permanent ? null : (untilMs ? new Date(untilMs) : null);
  if (!permanent && !banUntil) {
    throw new HttpsError('invalid-argument', 'A temporary ban needs an end time.');
  }

  await db.collection('users').doc(targetUid).update({
    banned: true,
    banUntil,
    permabanned: !!permanent,
    banReason: String(reason).slice(0, 400),
    bannedAt: FieldValue.serverTimestamp(),
  });

  const disabled = await setAuthDisabled(targetUid, true);
  try { await getAuth().revokeRefreshTokens(targetUid); } catch { /* best effort */ }

  if (notify) {
    // They cannot read this until they are back, and that is the point: it is
    // the record waiting for them, not the delivery mechanism.
    await db.collection('notifications').add({
      recipientId: targetUid,
      type: 'admin_ban',
      title: permanent ? 'Your account has been permanently banned' : 'Your account has been banned',
      body: reason || 'Contact support if you believe this is in error.',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  return { before, banUntil, authDisabled: disabled };
}

/**
 * Lift a ban: clears the flags AND re-enables the Auth account, which is the
 * half that was missing. Unbanning without this leaves them locked out for good.
 */
async function liftBan(targetUid, opts) {
  const { byUid = null, notify = true, reason = '' } = opts || {};
  const ref = db.collection('users').doc(targetUid);
  const before = (await ref.get()).data() || null;

  await ref.update({
    banned: false,
    banUntil: null,
    permabanned: false,
    banReason: null,
    unbannedAt: FieldValue.serverTimestamp(),
  });
  await setAuthDisabled(targetUid, false);

  if (notify) {
    await db.collection('notifications').add({
      recipientId: targetUid,
      type: 'admin_unban',
      title: 'Your account has been reinstated',
      body: reason || 'Welcome back to VERGR.',
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return { before };
}

/**
 * Releases temporary bans whose time is up. Runs inside the EXISTING cronEvery6h
 * dispatcher, so it adds no Cloud Scheduler job.
 *
 * ⚠ A temp ban NEEDS this. Disabling the Auth account is what makes the ban
 * real, and a disabled account cannot sign in again on its own when the clock
 * runs out. Without the sweep, "7 days" would mean "forever".
 *
 * Cost, stated rather than buried: ONE query per run, four runs a day, reading
 * only the accounts that are currently banned (a handful), against a free tier
 * of 50,000 reads a day.
 *
 * ⚠ It filters banned == true ONLY, and checks the expiry in memory. That uses
 * the single-field index Firestore maintains anyway, so it adds NO composite
 * index. Adding banUntil to the query would need one, and would also be wrong:
 * an unbanned account carries banUntil: null, and null sorts before every
 * timestamp, so "banUntil <= now" would match every user on the platform.
 */
async function sweepExpiredBans() {
  const now = Date.now();
  const snap = await db.collection('users')
    .where('banned', '==', true)
    .limit(500)
    .get();
  let lifted = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.permabanned) continue;
    const until = d.banUntil && typeof d.banUntil.toMillis === 'function' ? d.banUntil.toMillis() : 0;
    if (!until || until > now) continue;
    try {
      await liftBan(doc.id, { byUid: null, reason: 'Your temporary ban has ended.' });
      lifted++;
    } catch (e) {
      console.error('[bans] sweep failed for', doc.id, e?.message);
    }
  }
  console.log(`[sweepExpiredBans] checked ${snap.size}, lifted ${lifted}`);
  return { checked: snap.size, lifted };
}

/**
 * Puts the mute on the ID TOKEN as a custom claim, which firestore.rules can
 * read for free (`request.auth.token.get('mutedUntil', 0)`).
 *
 * ⚠⚠ A MUTE USED TO DO NOTHING. `users/{uid}.mutedUntil` was written by
 * adminMuteUser and vanguardMuteUser and read by exactly two admin screens,
 * for display. Nothing stopped a muted person posting, commenting or messaging.
 *
 * ⚠ The claim, not a rules `get()`, because get()/exists() in a rule is a
 * BILLED read — one per post, comment and message written on the platform.
 * The token costs nothing.
 *
 * ⚠ MERGES the existing claims. Overwriting them would strip `operator` and
 * lock the admin out of their own console.
 *
 * ⚠ A token refresh takes up to an hour, so this is what makes a mute REAL,
 * while the client gate (which reads the profile snapshot it already holds) is
 * what makes it immediate.
 */
async function setMuteClaim(uid, untilMs) {
  try {
    const user = await getAuth().getUser(uid);
    const claims = { ...(user.customClaims || {}) };
    if (untilMs && untilMs > Date.now()) claims.mutedUntil = untilMs;
    else delete claims.mutedUntil;
    await getAuth().setCustomUserClaims(uid, claims);
    return true;
  } catch (e) {
    console.error('[bans] setMuteClaim failed', uid, e?.message);
    return false;
  }
}

module.exports = { applyBan, liftBan, sweepExpiredBans, assertBannable, setAuthDisabled, setMuteClaim };
