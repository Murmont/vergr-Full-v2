// Support channels: one private, two-way thread per user, plus the agent-side
// queue that makes them answerable.
//
// WHY A THREAD IS A GROUP CONVERSATION
//
// The app already has a complete messaging stack: `conversations` docs in
// Firestore for metadata, the Hetzner `vergr-chat` relay for the messages
// themselves, plus the thread screen, unread counters, mute, media, history and
// moderation that hang off them. A support thread is a conversation, so it IS
// one. Nothing here re-implements messaging.
//
// It is a GROUP conversation rather than a DM for one specific reason: the DM
// relay path carries ciphertext (see chatCrypto.js), so only the two endpoints
// can read it. Support has to be readable by whichever agent picks it up, and by
// the next agent after them, so it takes the plaintext group path.
//
// Participants are the user plus every current support agent. That is what makes
// the existing security rules and the existing thread screen work for an agent
// with no special-casing: they are a participant, so they can read and write.
//
// `supportThread: true` keeps these OUT of an agent's personal message list.
// Without it, giving someone the support role would bury their own inbox.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const {
  adminRateLimit, auditAdminAction, extractRequestMeta,
} = require('./adminSecurity');
const { requireAdminScreen } = require('./adminAccess');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;
const SCREEN = 'support';

const toMs = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : null);

/** Every account that may answer support: the founder plus anyone granted the screen. */
async function listAgentUids() {
  const [admins, scoped] = await Promise.all([
    db.collection('users').where('role', '==', 'admin').get(),
    db.collection('admin_users').where('allowedScreens', 'array-contains', SCREEN).get(),
  ]);
  const set = new Set();
  admins.forEach((d) => set.add(d.id));
  scoped.forEach((d) => set.add(d.id));
  return [...set];
}

// The default support channel, created on demand.
//
// Contacting support must NEVER fail and must never push someone out to a web
// page: they are already in the app, and a help article is not a reply. So the
// only way "no support channel" can end is by there being one.
const DEFAULT_SUPPORT = {
  channelId: 'vergr_support',
  name: 'Vergr Support',
  handle: 'vergrsupport',
  // Was '#3D7FFF' (the gemBlue token). docs/CHANNEL_SEED.md records that being
  // changed to violet-light "because the brand rule is violet, pink and gold
  // only, and blue sits next to the cyan that was explicitly ruled off-brand" —
  // the doc was updated and the code never was.
  accentColor: '#B44FFF',
  order: 10,
};

// Built to the spec in docs/CHANNEL_SEED.md section 2 (speech bubble, white, on
// a violet-light gradient, nothing red). Support shipped with `avatarUrl: null`
// and no support image existed anywhere in the repo, so the row rendered
// UserAvatar's generic grey person silhouette — on the one channel a confused
// user is most likely to open, sitting next to Offers and Update Logs which
// both have real art.
const DEFAULT_SUPPORT_AVATAR = '/brand/channels/support.svg';

/**
 * Resolve the support channel to use. Falls back, in order, to: the id asked
 * for, any active support channel, then a freshly provisioned default.
 */
async function resolveSupportChannel(channelId) {
  if (channelId) {
    const snap = await db.collection('official_channels').doc(channelId).get();
    if (snap.exists) {
      const c = snap.data();
      if (c.kind === 'support' && c.active !== false) return { id: snap.id, ...c };
    }
  }

  const found = await db.collection('official_channels')
    .where('active', '==', true).where('kind', '==', 'support').limit(5).get();
  if (!found.empty) {
    const best = found.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))[0];
    return best;
  }

  // Nothing configured. Create it rather than telling the user to go away.
  const ref = db.collection('official_channels').doc(DEFAULT_SUPPORT.channelId);
  const existing = await ref.get();
  if (existing.exists) {
    // Present but not usable (wrong kind, or switched off). Make it usable.
    //
    // Also heals the avatar: the channel already exists in production, created
    // before there was one, so a create-time default would never reach it. Only
    // filled when absent, so real art uploaded through the channel editor is
    // never overwritten.
    const prev = existing.data() || {};
    const heal = { kind: 'support', oneWay: false, active: true };
    if (!prev.avatarUrl) heal.avatarUrl = DEFAULT_SUPPORT_AVATAR;
    await ref.set(heal, { merge: true });
    return { id: ref.id, ...prev, ...heal };
  }
  const fields = {
    name: DEFAULT_SUPPORT.name,
    handle: DEFAULT_SUPPORT.handle,
    handleLower: DEFAULT_SUPPORT.handle,
    avatarUrl: DEFAULT_SUPPORT_AVATAR,
    accentColor: DEFAULT_SUPPORT.accentColor,
    kind: 'support',
    oneWay: false,
    order: DEFAULT_SUPPORT.order,
    access: { mode: 'everyone', criteria: null },
    restricted: false,
    active: true,
    description: 'Message us and we will get back to you.',
    autoProvisioned: true,
    memberCount: 0,
    messageCount: 0,
    lastMessage: null,
    lastMessageAt: null,
    lastMessageId: null,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: 'system',
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.set(fields, { merge: true });
  return { id: ref.id, ...fields };
}

/**
 * The user's own thread with support, created on first use.
 *
 * Called by the USER (not an admin), so it is the one callable here that does
 * not go through requireAdminScreen. One thread per (user, channel), with a
 * deterministic id so a double tap cannot open two.
 */
exports.openSupportThread = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
    // channelId is OPTIONAL. "Contact support" from anywhere in the app calls
    // this with nothing and always lands in a thread.
    const channel = await resolveSupportChannel(String(request.data?.channelId || '').trim());
    const channelId = channel.id;

    const convoId = `support_${channelId}_${uid}`;
    const ref = db.collection('conversations').doc(convoId);
    const existing = await ref.get();
    const agents = await listAgentUids();

    if (existing.exists) {
      // Keep the agent roster current so someone hired today can answer a
      // thread opened last month. Never drops the user.
      const have = existing.data().participants || [];
      const want = [...new Set([uid, ...agents])];
      if (want.some((a) => !have.includes(a)) || have.length !== want.length) {
        await ref.update({ participants: want, supportAgents: agents });
      }
      return { ok: true, convoId, channelId, created: false };
    }

    await ref.set({
      // A group conversation in every respect the rest of the app cares about.
      isGroup: true,
      status: 'active',
      visibility: 'private',
      supportThread: true,
      supportChannelId: channelId,
      supportUserId: uid,
      supportState: 'open',
      supportClaimedBy: null,
      groupName: channel.name || 'Support',
      groupAvatar: channel.avatarUrl || null,
      participants: [...new Set([uid, ...agents])],
      supportAgents: agents,
      admins: agents,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      lastMessageText: '',
      lastMessageAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, convoId, channelId, created: true };
  },
);

/**
 * The agent queue. Newest activity first, with the unanswered ones first of all,
 * because a support queue sorted purely by time buries the person still waiting.
 */
exports.adminListSupportThreads = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminScreen(uid, SCREEN);

    const { channelId = null, state = 'open', pageSize = 40 } = request.data || {};
    let q = db.collection('conversations').where('supportThread', '==', true);
    if (channelId) q = q.where('supportChannelId', '==', channelId);
    if (state === 'open' || state === 'closed') q = q.where('supportState', '==', state);
    q = q.orderBy('lastMessageAt', 'desc').limit(Math.min(Number(pageSize) || 40, 100));

    const snap = await q.get();
    const rows = snap.docs.map((d) => {
      const c = d.data();
      return {
        convoId: d.id,
        channelId: c.supportChannelId || null,
        userId: c.supportUserId || null,
        state: c.supportState || 'open',
        claimedBy: c.supportClaimedBy || null,
        lastMessageText: c.lastMessageText || '',
        lastMessageAt: toMs(c.lastMessageAt),
        lastMessageFrom: c.lastMessageFrom || null,
        // "Waiting" means the last thing said came from the user. That is the
        // only signal an agent actually needs to triage the queue.
        waiting: !!c.supportUserId && c.lastMessageFrom === c.supportUserId,
      };
    });

    // Resolve the people behind the threads in one pass rather than N reads
    // from the client.
    const uids = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
    const users = {};
    for (let i = 0; i < uids.length; i += 30) {
      const chunk = uids.slice(i, i + 30);
      const us = await db.getAll(...chunk.map((u) => db.collection('users').doc(u)));
      us.forEach((s) => {
        if (!s.exists) return;
        const u = s.data();
        users[s.id] = {
          uid: s.id,
          displayName: u.displayName || u.username || 'User',
          username: u.username || null,
          avatar: u.photoURL || u.avatar || null,
        };
      });
    }
    rows.forEach((r) => { r.user = users[r.userId] || null; });
    rows.sort((a, b) => (b.waiting - a.waiting) || ((b.lastMessageAt || 0) - (a.lastMessageAt || 0)));
    return { rows };
  },
);

/**
 * Claim, release, close or reopen. Claiming exists so two agents do not answer
 * the same person; it is advisory and any agent can still take over, mirroring
 * the Vanguard match-claim model rather than inventing a second one.
 */
exports.adminSetSupportThreadState = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminScreen(uid, SCREEN);
    await adminRateLimit(uid, 'support_thread_state', { perHour: 400, perDay: 2000 });

    const { convoId, action } = request.data || {};
    if (!convoId) throw new HttpsError('invalid-argument', 'convoId required.');
    const ref = db.collection('conversations').doc(String(convoId));
    const snap = await ref.get();
    if (!snap.exists || snap.data().supportThread !== true) {
      throw new HttpsError('not-found', 'No such support thread.');
    }

    const patch = {};
    if (action === 'claim') patch.supportClaimedBy = uid;
    else if (action === 'release') patch.supportClaimedBy = null;
    else if (action === 'close') { patch.supportState = 'closed'; patch.supportClosedAt = FieldValue.serverTimestamp(); }
    else if (action === 'reopen') { patch.supportState = 'open'; patch.supportClosedAt = null; }
    else throw new HttpsError('invalid-argument', 'action must be claim, release, close or reopen.');

    await ref.update(patch);

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: `support_${action}`,
      target: { type: 'support_thread', id: String(convoId) },
      before: null,
      after: { userId: snap.data().supportUserId || null },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: false, stepUpFresh: false,
    }).catch(() => {});

    return { ok: true };
  },
);

/**
 * Keep the agent roster on every open thread in step with who currently holds
 * the support screen. Runs when an admin_users doc changes rather than on a
 * schedule, so it costs nothing until access actually changes.
 */
exports.syncSupportAgents = functions.firestore.onDocumentWritten(
  { document: 'admin_users/{uid}', region: REGION, database: 'vgrdb' },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const had = (before?.allowedScreens || []).includes(SCREEN);
    const has = (after?.allowedScreens || []).includes(SCREEN);
    if (had === has) return; // nothing about support changed

    const agents = await listAgentUids();
    const snap = await db.collection('conversations')
      .where('supportThread', '==', true)
      .where('supportState', '==', 'open')
      .get();

    // Batched, and capped per run: an agent change touching thousands of open
    // threads should not be one unbounded write burst.
    let batch = db.batch();
    let n = 0;
    for (const d of snap.docs) {
      const userId = d.data().supportUserId;
      batch.update(d.ref, {
        participants: [...new Set([userId, ...agents].filter(Boolean))],
        supportAgents: agents,
        admins: agents,
      });
      n += 1;
      if (n % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    if (n % 400 !== 0) await batch.commit();
  },
);

exports._internal = { listAgentUids };
