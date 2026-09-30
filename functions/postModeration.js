// postModeration.js: hiding a post, in ONE place. A module, not a Cloud Function.
//
// ⚠ Three paths hid posts and none of them told the author: an admin approving
// a report (adminModeration.js), a Vanguard approving one (vanguard.js) and the
// automatic hide after enough reports (submitReport). The post vanished for
// everyone else and its author was never told why or how to appeal. Only the
// AI hide (contentAi.js) notified anyone.
//
// Writes BOTH hidden markers. The AI path sets `hidden: true`, the others set
// `status: 'hidden'`; readers check one or the other, so a post hidden by one
// path and restored by the other could stay half-hidden. Both are set here and
// both are cleared on restore (adminResolveAppeal).

const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore('vgrdb');

const AUTHOR_COPY = {
  admin_approved_report: 'A moderator reviewed a report about your post and hid it.',
  vanguard_approved_report: 'A moderator reviewed a report about your post and hid it.',
  auto_mod_reports: 'Several people reported your post, so it is hidden while a moderator reviews it.',
  vanguard_confirmed_ai_flag: 'A moderator reviewed your post and hid it.',
};

/**
 * @param {object} p
 * @param {string} p.postId
 * @param {string} p.reasonCode  one of AUTHOR_COPY's keys (stored as hiddenReason)
 * @param {string} [p.byUid]     who hid it; null for automatic
 */
async function hidePost({ postId, reasonCode, byUid = null }) {
  if (!postId) return { ok: false };
  const ref = db.collection('posts').doc(postId);
  const snap = await ref.get().catch(() => null);
  if (!snap || !snap.exists) return { ok: false };
  const post = snap.data() || {};
  // Every report after the auto-hide threshold calls this again; the author is
  // told once.
  if (post.status === 'hidden' || post.hidden === true) return { ok: true, already: true };
  await ref.update({
    status: 'hidden',
    hidden: true,
    hiddenReason: reasonCode,
    hiddenAt: FieldValue.serverTimestamp(),
    // ⚠ No actor uid here: this document is publicly readable, and a moderator's
    // identity (Vanguard anonymity, the operator's uid) must not ride on it. The
    // actor is recorded privately in admin_actions / vanguard_actions.
  }).catch(() => null);

  const authorId = post.userId || post.authorId;
  if (authorId) {
    await db.collection('notifications').add({
      recipientId: authorId,
      type: 'post_hidden',
      title: 'Your post was hidden',
      body: `${AUTHOR_COPY[reasonCode] || 'Your post was hidden.'} Only you can see it now. Open it to appeal.`,
      link: `/post/${postId}`,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    }).catch(() => null);
  }
  return { ok: true, authorId: authorId || null };
}

const COMMENT_COPY = {
  admin_approved_report: 'A moderator reviewed a report about your comment and hid it.',
  vanguard_approved_report: 'A moderator reviewed a report about your comment and hid it.',
};

/**
 * Hide ONE comment. Readers (getComments, the public post page) skip a hidden
 * comment for everyone but its author, and the author is told and can appeal.
 * Until 2026-09-21 approving a comment report changed the report and nothing
 * else: the comment stayed up.
 *
 * @param {object} p
 * @param {string} p.postId
 * @param {string} p.commentId
 * @param {string} p.reasonCode  one of COMMENT_COPY's keys
 * @param {string} [p.byUid]
 */
async function hideComment({ postId, commentId, reasonCode, byUid = null }) {
  if (!postId || !commentId) return { ok: false };
  const ref = db.collection('posts').doc(postId).collection('comments').doc(commentId);
  const snap = await ref.get().catch(() => null);
  if (!snap || !snap.exists) return { ok: false };
  const c = snap.data() || {};
  if (c.hidden === true) return { ok: true, already: true };
  await ref.update({
    hidden: true,
    hiddenReason: reasonCode,
    hiddenAt: FieldValue.serverTimestamp(),
    // ⚠ No actor uid here: this document is publicly readable, and a moderator's
    // identity (Vanguard anonymity, the operator's uid) must not ride on it. The
    // actor is recorded privately in admin_actions / vanguard_actions.
  }).catch(() => null);
  const authorId = c.authorId || c.userId;
  if (authorId) {
    await db.collection('notifications').add({
      recipientId: authorId,
      type: 'comment_hidden',
      title: 'Your comment was hidden',
      body: `${COMMENT_COPY[reasonCode] || 'Your comment was hidden.'} Only you can see it now. Tap to appeal.`,
      link: `/appeal?type=comment&id=${postId}:${commentId}`,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    }).catch(() => null);
  }
  return { ok: true, authorId: authorId || null };
}

module.exports = { hidePost, hideComment };
