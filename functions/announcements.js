// VERGR platform announcements — the official @Vergr account can broadcast a
// post to EVERY device at once via a single FCM topic send (no per-user
// fan-out), and this channel deliberately ignores the per-user "posts from
// others" notification preference because it's a platform announcement, not a
// creator-post notification.
//
// - subscribeAnnouncements : every install subscribes its FCM token to the
//   `announcements` topic (called from pushNotifications.js after token save).
// - postAnnouncement       : @Vergr/admin only; sends ONE topic push for a post
//   flagged isAnnouncement. Idempotent (announcementSentAt marker).
//
// Zero-cost: topic send = one message regardless of audience size; no new
// Firestore trigger fires per post (this is an explicit callable, only invoked
// when @Vergr posts an announcement).

const functions = require('firebase-functions/v2');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { isStaffDoc } = require('./staff');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');
const TOPIC = 'announcements';

// Subscribe one FCM registration token to the announcements topic. Works for
// both web and native tokens (Admin messaging treats them identically).
exports.subscribeAnnouncements = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const token = String(request.data?.token || '').trim();
    if (!token) throw new functions.https.HttpsError('invalid-argument', 'token required.');
    try {
      await getMessaging().subscribeToTopic([token], TOPIC);
      return { ok: true };
    } catch (e) {
      // Non-fatal: a bad/expired token just isn't subscribed.
      return { ok: false };
    }
  }
);

// Unsubscribe one token from the announcements topic, on sign-out.
//
// Without this, subscribeAnnouncements was one-way: a token joined the topic on
// first sign-in and stayed on it forever. Removing the token from
// users/{uid}/private/fcm stops the per-user pushes but does NOTHING about the
// topic, so a signed-out device kept receiving every platform announcement with
// no way to stop short of uninstalling.
//
// Deliberately NOT auth-gated the same way as subscribe. Sign-out races the
// auth state: by the time this runs the client may already have no valid token,
// and an unauthenticated caller can only ever remove a token they physically
// hold from a public broadcast topic. Refusing here would mean the common case
// (sign out, then unsubscribe) silently fails, which is the bug we are fixing.
exports.unsubscribeAnnouncements = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const token = String(request.data?.token || '').trim();
    if (!token) throw new functions.https.HttpsError('invalid-argument', 'token required.');
    try {
      await getMessaging().unsubscribeFromTopic([token], TOPIC);
      return { ok: true };
    } catch (e) {
      // Non-fatal, same as subscribe: an expired token is already off the topic.
      return { ok: false };
    }
  }
);

// Strip post markup ({{c:#hex}} colour tokens + *_~` formatting) to a plain
// notification body.
const toPlain = (s) => String(s || '')
  .replace(/\{\{c:#[0-9a-fA-F]{3,8}\}\}/g, '')
  .replace(/[*_~`]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

// Broadcast a flagged @Vergr post to the announcements topic.
exports.postAnnouncement = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const postId = String(request.data?.postId || '').trim();
    if (!postId) throw new functions.https.HttpsError('invalid-argument', 'postId required.');

    // Authorize: caller must be the official @Vergr account or an admin.
    const userSnap = await db.collection('users').doc(uid).get();
    const u = userSnap.exists ? userSnap.data() : {};
    const isVergr = String(u.username || '').toLowerCase() === 'vergr';
    const isAdmin = isStaffDoc(u) || u.role === 'admin';
    if (!isVergr && !isAdmin) {
      throw new functions.https.HttpsError('permission-denied', 'Announcements are restricted to VERGR.');
    }

    const postSnap = await db.collection('posts').doc(postId).get();
    if (!postSnap.exists) throw new functions.https.HttpsError('not-found', 'Post not found.');
    const post = postSnap.data();
    if (post.authorId !== uid) throw new functions.https.HttpsError('permission-denied', 'Not your post.');
    if (post.isAnnouncement !== true) throw new functions.https.HttpsError('failed-precondition', 'Post is not flagged as an announcement.');
    if (post.announcementSentAt) return { ok: true, already: true }; // idempotent

    const body = toPlain(post.content).slice(0, 140) || 'New announcement from VERGR';
    try {
      await getMessaging().send({
        topic: TOPIC,
        notification: { title: '📣 VERGR Announcement', body },
        data: { type: 'announcement', postId, url: `/post/${postId}` },
        android: { priority: 'high', notification: { channelId: 'default', color: '#7B1FFF' } },
        webpush: { fcmOptions: { link: `https://vergr.app/post/${postId}` } },
      });
    } catch (e) {
      throw new functions.https.HttpsError('internal', 'Failed to send announcement.');
    }
    await postSnap.ref.update({ announcementSentAt: Date.now() });
    return { ok: true };
  }
);
