// Publishes scheduled posts + polls when their time arrives, and honours the
// per-post schedule options (early posting, author reminder, squad auto-share).
const functions = require('firebase-functions/v2');
const defer = (_opts, fn) => fn; // cron-consolidation shim (see index.js cron5Min)
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';

const toMs = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v.seconds) return v.seconds * 1000;
  return null;
};

async function afterPublish(id, p, kind) {
  const opts = p.scheduleOptions || {};
  const authorId = p.authorId || p.createdBy;
  if (!authorId) return;

  if (opts.reminder) {
    await db.collection('notifications').add({
      recipientId: authorId,
      type: 'scheduled_published',
      title: `Your scheduled ${kind === 'poll' ? 'poll' : 'post'} is live`,
      body: (p.content || p.question || '').slice(0, 80) || 'It just went live.',
      link: kind === 'poll' ? '/feed' : `/post/${id}`,
      actionUrl: kind === 'poll' ? '/feed' : `/post/${id}`,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    }).catch((e) => console.error('reminder notif failed', e));
  }

  if (opts.autoShareSquad) {
    try {
      const userSnap = await db.collection('users').doc(authorId).get();
      const u = userSnap.exists ? userSnap.data() : {};
      const squads = await db.collection('squads').where('memberIds', 'array-contains', authorId).get();
      await Promise.all(squads.docs.map((sq) =>
        db.collection('squads').doc(sq.id).collection('messages').add({
          senderId: authorId,
          senderName: u.displayName || u.username || 'Member',
          senderAvatar: u.avatar || null,
          text: (p.content || p.question || 'Check out my new post'),
          type: 'post_share',
          postId: id,
          createdAt: FieldValue.serverTimestamp(),
        }).catch(() => {})
      ));
    } catch (e) { console.error('autoShareSquad failed', e); }
  }
}

exports.publishScheduledPosts = defer(
  { schedule: 'every 5 minutes', region: REGION, timeZone: 'UTC' },
  async () => {
    const now = Date.now();
    let published = 0;

    // Posts: status 'scheduled' → 'published'
    const posts = await db.collection('posts').where('status', '==', 'scheduled').get();
    for (const docSnap of posts.docs) {
      const p = docSnap.data();
      const sfMs = toMs(p.scheduledFor);
      if (sfMs == null) continue;
      const early = p.scheduleOptions && p.scheduleOptions.allowEarly ? 15 * 60 * 1000 : 0;
      if (sfMs - now > early) continue; // not due yet
      await docSnap.ref.update({ status: 'published', publishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      await afterPublish(docSnap.id, p, 'post');
      published += 1;
    }

    // Polls: status 'scheduled' → 'active'
    const polls = await db.collection('polls').where('status', '==', 'scheduled').get();
    for (const docSnap of polls.docs) {
      const p = docSnap.data();
      const sfMs = toMs(p.scheduledFor);
      if (sfMs == null) continue;
      const early = p.scheduleOptions && p.scheduleOptions.allowEarly ? 15 * 60 * 1000 : 0;
      if (sfMs - now > early) continue;
      await docSnap.ref.update({ status: 'active', publishedAt: FieldValue.serverTimestamp() });
      await afterPublish(docSnap.id, p, 'poll');
      published += 1;
    }

    if (published) console.log(`publishScheduledPosts: released ${published}`);
  }
);
