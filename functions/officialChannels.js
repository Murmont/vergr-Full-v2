// Official channels: admin-to-user broadcast threads that appear in the user's
// message list as chats, the way Tango's own accounts do.
//
// See docs/ANNOUNCEMENTS_PLAN.md section 2 for the design and the reasoning.
// The two things to understand before changing anything here:
//
// 1. ONE shared channel doc + ONE shared messages subcollection serve EVERY
//    user. A send is one message write plus one denormalisation update on the
//    channel doc, at any audience size. The old `sendAnnouncement` wrote one
//    notification doc per user, which is ~4N Firestore operations per send once
//    the trigger and the push reads are counted.
//
// 2. Because the messages are shared they are WORLD-READABLE. Nothing
//    personalised, private or sensitive may ever be posted to a channel. Anything
//    per-user is a notification or a real DM. `assertNotPersonal()` below is a
//    guard against the obvious mistakes, not a licence to get close to the line.
//
// Per-user state (read / mute / clear / delete) lives in `channel_state/{uid}`,
// written by the client. There is deliberately NO unsubscribe: founder decision
// D1 is that a user may mute, clear or delete their own view, but cannot stop
// delivery. Notification is optional, delivery is not.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const {
  requireFreshStepUp,
  adminRateLimit,
  auditAdminAction,
  extractRequestMeta,
} = require('./adminSecurity');
const { requireAdminScreen } = require('./adminAccess');
const { isObsceneHandle, normHandle } = require('./usernameIndex');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

const SCREEN = 'announcements';
const SUPPORT_SCREEN = 'support';

// A channel is one of three SHAPES, and the shape decides where its messages
// live. Modelling this as a single `oneWay` boolean was wrong: the off state
// implied replies existed and nothing carried them.
//
//   broadcast : Vergr posts, everyone reads, nobody replies.
//               ONE shared thread in official_channels/{id}/messages.
//
//   support   : one PRIVATE thread per user, two-way. Each thread is a normal
//               group conversation (participants = that user + the support
//               agents) so it rides the existing relay, thread screen, unread
//               counters, media and history with no new messaging code. Flagged
//               `supportThread` so agent personal inboxes are not flooded by it.
//
//   community : everyone in the channel reads AND writes to one room. A normal
//               group conversation whose membership is kept in step with the
//               channel's own access rules.
const CHANNEL_KINDS = ['broadcast', 'support', 'community'];

// Body cap. Long enough for a real announcement, short enough that the inbox
// preview and the push body are not lies about what the message contains.
const MAX_BODY = 2000;
const MAX_NAME = 40;
const MAX_CTA_LABEL = 30;

async function guardCaller(uid, { requireStepUp = false } = {}) {
  await requireAdminScreen(uid, SCREEN);
  if (requireStepUp) await requireFreshStepUp(uid);
}

const toMs = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : null);

// ────────────────────────────────────────────────────────────────────
// VALIDATION
// ────────────────────────────────────────────────────────────────────

/** Channel ids are used in document paths and in the synthetic row id, so they
 *  are restricted to a slug rather than sanitised after the fact. */
function assertValidChannelId(id) {
  if (typeof id !== 'string' || !/^[a-z][a-z0-9_]{1,29}$/.test(id)) {
    throw new HttpsError('invalid-argument',
      'channelId must be lowercase letters, digits and underscores, 2 to 30 chars, starting with a letter.');
  }
}

/**
 * A channel handle must be unique and not obscene. It does NOT have to satisfy
 * the user username policy.
 *
 * Founder ruling 2026-08-17: the brand reservations exist to stop users passing
 * themselves off as Vergr. Holding Vergr's own channels to that rule blocked
 * @vergroffers, which is absurd. Uniqueness is still enforced against the live
 * `usernames/` index and against other channels, because two identities sharing
 * a handle is a real collision rather than a policy preference.
 */
async function assertHandleAvailable(handle, channelId) {
  const raw = String(handle || '').trim().replace(/^@/, '');
  if (!/^[a-z0-9_]{3,20}$/.test(raw)) {
    throw new HttpsError('invalid-argument',
      'handle must be 3 to 20 lowercase letters, digits or underscores.');
  }
  // Deliberately NOT the full username policy. That policy reserves anything
  // containing "vergr" to stop users impersonating the platform; a channel IS
  // the platform, so it must be free to be @vergr, @vergroffers or @vergrsupport.
  // Only the obscenity list carries over. See isObsceneHandle.
  if (isObsceneHandle(raw)) {
    throw new HttpsError('invalid-argument', `"@${raw}" is not an acceptable handle.`);
  }
  // Taken by a real user?
  const userHandle = await db.doc(`usernames/${raw}`).get();
  if (userHandle.exists) {
    throw new HttpsError('already-exists', `"@${raw}" belongs to a user account.`);
  }
  // Taken by another channel?
  const clash = await db.collection('official_channels')
    .where('handleLower', '==', normHandle(raw)).limit(2).get();
  for (const d of clash.docs) {
    if (d.id !== channelId) {
      throw new HttpsError('already-exists', `"@${raw}" is already used by channel "${d.id}".`);
    }
  }
  return raw;
}

/**
 * Cheap guard against posting something personal to a world-readable thread.
 *
 * Catches the mistakes that actually happen: pasting an email address, a payout
 * amount for one person, or a raw uid into a broadcast. It is a seatbelt, not a
 * classifier, and it fails LOUD so the author has to think rather than silently
 * rewriting their copy.
 */
function assertNotPersonal(body) {
  const text = String(body || '');

  // Our own addresses are fine and will legitimately appear ("email
  // support@vergr.app"). Anyone else's is a user's address in a public thread.
  const foreignEmail = text
    .replace(/[\w.+-]+@vergr\.app\b/gi, '')
    .match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/);
  if (foreignEmail) {
    throw new HttpsError('invalid-argument',
      `This looks like it contains an email address ("${foreignEmail[0]}"). Channel messages are `
      + 'readable by every user, so anything about one person has to be sent as a direct message instead.');
  }

  // A uid or token, not a long word. Firebase uids are ~28 chars of MIXED
  // letters and digits, so requiring both classes avoids blocking a legitimately
  // long word or slug, which a bare length check would do.
  const token = text.match(/\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{20,}\b/);
  if (token) {
    throw new HttpsError('invalid-argument',
      `"${token[0]}" looks like a user id or a token. Channel messages are readable by every user, `
      + 'so anything identifying one person has to be sent as a direct message instead.');
  }

  // Deliberately NOT checking for card numbers. Vergr never handles a PAN:
  // PayRam takes card entry on web, Play Billing on Android, and no card number
  // exists anywhere in our data, so there is nothing an admin could paste one
  // from. A digit-run check would only have produced false positives on
  // legitimate long references like an order id.
}

// ────────────────────────────────────────────────────────────────────
// CHANNEL REGISTRY
// ────────────────────────────────────────────────────────────────────

/**
 * Create or edit a channel. Channels are DATA, not code, so the founder can add
 * a fifth without a deploy (founder decision D1). The four launch channels are
 * seeded through this same callable rather than a migration script, so the
 * creation path is exercised by its first real use.
 */
exports.adminUpsertChannel = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    await adminRateLimit(uid, 'admin_upsert_channel', { perHour: 30, perDay: 100 });

    const {
      channelId, name, handle, avatarUrl = null, accentColor = '#7B1FFF',
      kind = 'broadcast', order = 100, visibility = null, active = true,
      description = null,
    } = request.data || {};

    assertValidChannelId(channelId);
    if (!CHANNEL_KINDS.includes(kind)) {
      throw new HttpsError('invalid-argument', `kind must be one of ${CHANNEL_KINDS.join(', ')}.`);
    }
    if (!name || String(name).trim().length < 2 || String(name).length > MAX_NAME) {
      throw new HttpsError('invalid-argument', `name must be 2 to ${MAX_NAME} characters.`);
    }
    const cleanHandle = await assertHandleAvailable(handle, channelId);

    const ref = db.collection('official_channels').doc(channelId);
    const existing = await ref.get();
    const before = existing.exists ? existing.data() : null;

    // Three access modes, and everything except 'everyone' is genuinely private:
    // rules gate the channel doc, its messages AND its preview on a membership
    // row, so a non-member cannot read the content or learn the channel exists.
    //
    //   everyone : open to all.
    //   auto     : membership is EVALUATED per user against `criteria`, every app
    //              open, by resolveMyChannels. Someone who becomes a creator gets
    //              in without anyone doing anything; someone who stops qualifying
    //              loses access.
    //   invite   : an explicit list the admin maintains. No criteria.
    //
    // `restricted` is what the security rules read, and it is DERIVED here rather
    // than accepted from the client.
    const access = request.data?.access || visibility || {};
    const mode = access.mode || 'everyone';
    if (!['everyone', 'auto', 'invite'].includes(mode)) {
      throw new HttpsError('invalid-argument', 'access.mode must be everyone, auto or invite.');
    }
    if (mode === 'auto' && !access.criteria) {
      throw new HttpsError('invalid-argument', 'An automatic channel needs criteria.');
    }
    const restricted = mode !== 'everyone';

    const fields = {
      name: String(name).trim(),
      handle: cleanHandle,
      handleLower: normHandle(cleanHandle),
      avatarUrl: avatarUrl || null,
      accentColor: String(accentColor || '#7B1FFF').slice(0, 9),
      kind,
      // `oneWay` is kept in sync so anything still reading it keeps working.
      // Only a broadcast is one-way; support and community are both two-way.
      oneWay: kind === 'broadcast',
      order: Number(order) || 100,
      access: { mode, criteria: mode === 'auto' ? (access.criteria || null) : null },
      restricted,
      active: !!active,
      description: description ? String(description).slice(0, 200) : null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid,
    };
    if (!existing.exists) {
      fields.memberCount = 0;
      fields.messageCount = 0;
      fields.lastMessage = null;
      fields.lastMessageAt = null;
      fields.lastMessageId = null;
      fields.createdAt = FieldValue.serverTimestamp();
      fields.createdBy = uid;
    }
    await ref.set(fields, { merge: true });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: existing.exists ? 'channel_update' : 'channel_create',
      target: { type: 'official_channel', id: channelId },
      before: before ? { name: before.name, handle: before.handle, active: before.active } : null,
      after: { name: fields.name, handle: fields.handle, active: fields.active },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: false, stepUpFresh: false,
    }).catch(() => {});

    return { ok: true, channelId, created: !existing.exists };
  },
);

exports.adminListChannels = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    await guardCaller(request.auth?.uid);
    const snap = await db.collection('official_channels').orderBy('order').get();
    return {
      rows: snap.docs.map((d) => {
        const c = d.data();
        return {
          channelId: d.id,
          name: c.name || d.id,
          handle: c.handle || null,
          avatarUrl: c.avatarUrl || null,
          accentColor: c.accentColor || '#7B1FFF',
          oneWay: c.oneWay !== false,
          order: c.order ?? 100,
          active: c.active !== false,
          description: c.description || null,
          access: c.access || { mode: 'everyone', criteria: null },
          // Absent means open. Rules treat "not true" as open, so the default
          // here has to match or the admin UI would misreport an old channel.
          restricted: c.restricted === true,
          memberCount: c.memberCount || 0,
          messageCount: c.messageCount || 0,
          lastMessage: c.lastMessage || null,
          lastMessageAt: toMs(c.lastMessageAt),
          createdAt: toMs(c.createdAt),
        };
      }),
    };
  },
);

/** Deactivate rather than delete. A deleted channel would strand its messages
 *  and every user's read state; an inactive one simply stops being rendered and
 *  can be turned back on. */
exports.adminSetChannelActive = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { channelId, active } = request.data || {};
    assertValidChannelId(channelId);
    const ref = db.collection('official_channels').doc(channelId);
    if (!(await ref.get()).exists) throw new HttpsError('not-found', 'Channel not found.');
    await ref.set({ active: !!active, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid }, { merge: true });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: active ? 'channel_activate' : 'channel_deactivate',
      target: { type: 'official_channel', id: channelId },
      after: { active: !!active },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: false, stepUpFresh: false,
    }).catch(() => {});
    return { ok: true };
  },
);

// ────────────────────────────────────────────────────────────────────
// MEMBERSHIP (closed channels only)
// ────────────────────────────────────────────────────────────────────
//
// Two writes per member, both tiny: the membership row the rules check, and an
// entry in that user's `channel_members` index so their client can find the
// channel at all. The index exists because a broad query for closed channels can
// never satisfy a membership rule: Firestore requires a query to be provably
// allowed across its whole result set, so it would be denied outright rather
// than filtered.
//
// This is the ONLY fan-out in the channel system, it is bounded by the number of
// members in restricted channels rather than by the user table, and the messages
// themselves are still one shared write no matter how many members there are.

const MAX_MEMBER_BATCH = 400;

async function addMembers(channelId, uids, addedBy, source) {
  const unique = [...new Set(uids.filter(Boolean))].slice(0, MAX_MEMBER_BATCH);
  if (!unique.length) return 0;

  const chanRef = db.collection('official_channels').doc(channelId);
  let added = 0;
  // Chunked so one call cannot exceed the 500-op batch limit (2 writes each).
  for (let i = 0; i < unique.length; i += 200) {
    const slice = unique.slice(i, i + 200);
    const batch = db.batch();
    for (const uid of slice) {
      batch.set(chanRef.collection('members').doc(uid), {
        addedAt: FieldValue.serverTimestamp(), addedBy, source: source || 'manual',
      }, { merge: true });
      batch.set(db.collection('channel_members').doc(uid), {
        channels: FieldValue.arrayUnion(channelId),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      added++;
    }
    await batch.commit();
  }
  // Recount rather than increment: adds are idempotent (merge), so incrementing
  // by the request size would drift every time an existing member is re-added.
  const count = await chanRef.collection('members').count().get().catch(() => null);
  if (count) await chanRef.set({ memberCount: count.data().count }, { merge: true });
  return added;
}

exports.adminAddChannelMembers = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    await adminRateLimit(uid, 'admin_channel_members', { perHour: 60, perDay: 300 });
    const { channelId, uids } = request.data || {};
    assertValidChannelId(channelId);
    if (!Array.isArray(uids) || !uids.length) {
      throw new HttpsError('invalid-argument', 'uids must be a non-empty array.');
    }
    const snap = await db.collection('official_channels').doc(channelId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Channel not found.');
    if (snap.data().restricted !== true) {
      throw new HttpsError('failed-precondition',
        'This channel is open to everyone, so it has no member list. Set its access to Automatic or Invite only first.');
    }

    const added = await addMembers(channelId, uids, uid, 'manual');
    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid, action: 'channel_members_add',
      target: { type: 'official_channel', id: channelId },
      after: { count: added },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: false, stepUpFresh: false,
    }).catch(() => {});
    return { ok: true, added };
  },
);

exports.adminRemoveChannelMember = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { channelId, targetUid } = request.data || {};
    assertValidChannelId(channelId);
    if (!targetUid) throw new HttpsError('invalid-argument', 'targetUid required.');

    const chanRef = db.collection('official_channels').doc(channelId);
    await chanRef.collection('members').doc(targetUid).delete();
    await db.collection('channel_members').doc(targetUid).set({
      channels: FieldValue.arrayRemove(channelId),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    const count = await chanRef.collection('members').count().get().catch(() => null);
    if (count) await chanRef.set({ memberCount: count.data().count }, { merge: true });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid, action: 'channel_member_remove',
      target: { type: 'official_channel', id: channelId },
      after: { targetUid },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: false, stepUpFresh: false,
    }).catch(() => {});
    return { ok: true };
  },
);

exports.adminListChannelMembers = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    await guardCaller(request.auth?.uid);
    const { channelId, pageSize = 50 } = request.data || {};
    assertValidChannelId(channelId);
    const snap = await db.collection('official_channels').doc(channelId)
      .collection('members').limit(Math.min(Number(pageSize) || 50, 200)).get();

    const rows = await Promise.all(snap.docs.map(async (d) => {
      const u = await db.collection('users').doc(d.id).get().catch(() => null);
      const ud = u?.exists ? u.data() : {};
      return {
        uid: d.id,
        displayName: ud.displayName || ud.username || d.id.slice(0, 8),
        username: ud.username || null,
        avatar: ud.avatar || null,
        source: d.data().source || 'manual',
        addedAt: toMs(d.data().addedAt),
      };
    }));
    return { rows, count: rows.length };
  },
);

// ────────────────────────────────────────────────────────────────────
// AUTOMATIC MEMBERSHIP
// ────────────────────────────────────────────────────────────────────
//
// A criteria channel ("creators only") must stay correct as people change. A
// creator who enrols tomorrow has to get in, and someone who stops qualifying has
// to lose access, or a private channel silently leaks to the wrong audience.
//
// So membership is EVALUATED, not stamped. `resolveMyChannels` runs for the
// CALLER on app open, checks that one user against every criteria channel, and
// grants or revokes their own membership row accordingly.
//
// Why this shape rather than the obvious alternatives:
//   - A one-time bulk add drifts the moment anyone's status changes. That was the
//     first attempt and it was wrong.
//   - A scheduled sweep of the user table costs money forever and is still stale
//     between runs.
//   - Evaluating in security rules alone cannot work, because Firestore must be
//     able to prove a QUERY is allowed across its whole result set, so a channel
//     list query would be denied outright rather than filtered.
//
// Per call this reads at most three documents about the caller plus the channel
// list, and only writes when the answer actually changed.

/** Attributes a channel can gate on. Read once per call, reused for every channel. */
async function loadViewerFacts(uid) {
  const [userSnap, payoutSnap, walletSnap] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('payout_accounts').doc(uid).get().catch(() => null),
    db.collection('wallets').doc(uid).get().catch(() => null),
  ]);
  const u = userSnap.exists ? userSnap.data() : {};
  const p = payoutSnap?.exists ? payoutSnap.data() : {};
  const w = walletSnap?.exists ? walletSnap.data() : {};
  return {
    exists: userSnap.exists,
    tier: u.subscription || 'free',
    role: u.role || 'user',
    isGuest: u.isGuest === true,
    isBot: typeof u.accountType === 'string' && u.accountType.includes('bot'),
    banned: u.banned === true,
    vanguardRank: u.vanguard?.rank || null,
    // Two independent creator signals. Enrolled for payouts is the strongest,
    // but someone can be earning before they enrol, and a channel about earnings
    // should reach them.
    payoutEnrolled: p.enrolled === true,
    hasEarned: Number(w.totalEarnedCoinsGross || 0) > 0,
    createdAtMs: toMs(u.createdAt),
  };
}

/** Does this viewer meet a channel's criteria? Pure, so it is unit-testable. */
function criteriaMet(criteria, f) {
  const c = criteria || {};
  // Guests, bots and banned accounts are never an audience for anything.
  if (f.isGuest || f.isBot || f.banned) return false;

  if (c.creator === true && !(f.payoutEnrolled || f.hasEarned)) return false;
  if (Array.isArray(c.tiers) && c.tiers.length && !c.tiers.includes(f.tier)) return false;
  if (Array.isArray(c.roles) && c.roles.length && !c.roles.includes(f.role)) return false;
  if (c.vanguard === true && !f.vanguardRank) return false;
  if (Number(c.minAccountAgeDays) > 0) {
    if (!f.createdAtMs) return false;
    if ((Date.now() - f.createdAtMs) < Number(c.minAccountAgeDays) * 86_400_000) return false;
  }
  return true;
}

/**
 * Resolve which restricted channels the CALLER can see, granting or revoking
 * their own membership rows so the security rules agree.
 *
 * Called by the client on app open. Idempotent and cheap: it only writes when
 * membership actually changes.
 *
 * A manually invited member is NEVER revoked here. Only rows this function
 * granted (`source: 'auto'`) are withdrawn, so an explicit invite always outranks
 * the criteria.
 */
exports.resolveMyChannels = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

    const [chanSnap, facts] = await Promise.all([
      db.collection('official_channels')
        .where('active', '==', true).where('restricted', '==', true).get(),
      loadViewerFacts(uid),
    ]);
    if (!facts.exists) return { channels: [], changed: 0 };

    const granted = [];
    const revoked = [];

    await Promise.all(chanSnap.docs.map(async (d) => {
      const ch = d.data();
      const mode = ch.access?.mode || ch.visibility?.mode || 'invite';
      const memberRef = d.ref.collection('members').doc(uid);
      const memberSnap = await memberRef.get();
      const isMember = memberSnap.exists;
      const source = memberSnap.exists ? (memberSnap.data().source || 'manual') : null;

      if (mode !== 'auto') {
        // Invite-only: nothing to evaluate, the admin decides.
        if (isMember) granted.push(d.id);
        return;
      }

      const shouldBeMember = criteriaMet(ch.access?.criteria, facts);

      if (shouldBeMember && !isMember) {
        await memberRef.set({
          addedAt: FieldValue.serverTimestamp(), addedBy: 'auto', source: 'auto',
        });
        await db.collection('channel_members').doc(uid).set({
          channels: FieldValue.arrayUnion(d.id), updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        granted.push(d.id);
      } else if (!shouldBeMember && isMember && source === 'auto') {
        // Only withdraw what this function granted. A manual invite stands.
        await memberRef.delete();
        await db.collection('channel_members').doc(uid).set({
          channels: FieldValue.arrayRemove(d.id), updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        revoked.push(d.id);
      } else if (isMember) {
        granted.push(d.id);
      }
    }));

    // A COMMUNITY channel is a real group conversation, so qualifying for it has
    // to put the caller in that conversation's participants or they would see a
    // room in the admin list that does not exist in their messages. Same rule as
    // above: only ever act on the caller, never scan the user table.
    await Promise.all(chanSnap.docs
      .filter((d) => d.data().kind === 'community' && d.data().roomConvoId)
      .map(async (d) => {
        const room = db.collection('conversations').doc(d.data().roomConvoId);
        const inChannel = granted.includes(d.id);
        try {
          await room.update({
            participants: inChannel ? FieldValue.arrayUnion(uid) : FieldValue.arrayRemove(uid),
          });
        } catch { /* room deleted; the channel row is harmless without it */ }
      }));

    return { channels: granted, granted: granted.length, revoked: revoked.length };
  },
);

/**
 * Create (or re-point) the group conversation behind a COMMUNITY channel.
 *
 * Split from `adminUpsertChannel` on purpose: the room is a conversation with
 * its own lifetime and its own members, and silently creating one every time a
 * channel is saved would leave orphaned rooms behind every edit.
 */
exports.adminEnsureCommunityRoom = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const channelId = String(request.data?.channelId || '').trim();
    const ref = db.collection('official_channels').doc(channelId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'No such channel.');
    const ch = snap.data();
    if (ch.kind !== 'community') {
      throw new HttpsError('failed-precondition', 'Only a community channel has a room.');
    }
    if (ch.roomConvoId) {
      const existing = await db.collection('conversations').doc(ch.roomConvoId).get();
      if (existing.exists) return { ok: true, convoId: ch.roomConvoId, created: false };
    }

    const convoId = `community_${channelId}`;
    await db.collection('conversations').doc(convoId).set({
      isGroup: true,
      status: 'active',
      visibility: 'private',
      communityChannelId: channelId,
      groupName: ch.name || 'Community',
      groupAvatar: ch.avatarUrl || null,
      // Starts with the founder alone. Everyone else arrives through
      // resolveMyChannels as they qualify, or through the members panel.
      participants: [uid],
      admins: [uid],
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      lastMessageText: '',
      lastMessageAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await ref.update({ roomConvoId: convoId });
    return { ok: true, convoId, created: true };
  },
);

// ────────────────────────────────────────────────────────────────────
// SENDING
// ────────────────────────────────────────────────────────────────────

/** Inbox preview text. Strips markdown and collapses whitespace so the row
 *  reads as a sentence rather than as source. */
function previewOf(body, hasImage, hasVideo) {
  const plain = String(body || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain) return plain.slice(0, 140);
  if (hasVideo) return 'Video';
  if (hasImage) return 'Photo';
  return 'New message';
}

/**
 * Post one message to a channel.
 *
 * ONE transaction: the message document plus the denormalised preview on the
 * channel doc, so the inbox row can render without reading the subcollection.
 * Two writes total, regardless of how many users will read it.
 *
 * Step-up required: this reaches every user on the platform and cannot be
 * unsent from anyone's push tray.
 */
exports.adminSendChannelMessage = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    await adminRateLimit(uid, 'admin_send_channel_message', { perHour: 20, perDay: 60 });

    const {
      channelId, body = '', imageUrl = null, videoUrl = null, videoPosterUrl = null,
      ctaLabel = null, ctaUrl = null, segment = null, campaignId = null,
    } = request.data || {};

    assertValidChannelId(channelId);
    const text = String(body || '').trim();
    if (!text && !imageUrl && !videoUrl) {
      throw new HttpsError('invalid-argument', 'A message needs text, an image or a video.');
    }
    if (text.length > MAX_BODY) {
      throw new HttpsError('invalid-argument', `Message body is limited to ${MAX_BODY} characters.`);
    }
    assertNotPersonal(text);
    if (ctaLabel && String(ctaLabel).length > MAX_CTA_LABEL) {
      throw new HttpsError('invalid-argument', `CTA label is limited to ${MAX_CTA_LABEL} characters.`);
    }
    if (ctaUrl && !/^(\/|https:\/\/)/.test(String(ctaUrl))) {
      throw new HttpsError('invalid-argument', 'ctaUrl must be an internal path or an https URL.');
    }

    // Global kill switch, same pattern as the other economy/streaming switches.
    const cfg = await db.collection('app_config').doc('general').get();
    if (cfg.exists && cfg.data()?.announcementsPaused === true) {
      throw new HttpsError('failed-precondition', 'Announcements are paused in App Config.');
    }

    const chanRef = db.collection('official_channels').doc(channelId);
    const msgRef = chanRef.collection('messages').doc();

    const preview = previewOf(text, !!imageUrl, !!videoUrl);

    await db.runTransaction(async (tx) => {
      const chan = await tx.get(chanRef);
      if (!chan.exists) throw new HttpsError('not-found', 'Channel not found.');
      if (chan.data()?.active === false) {
        throw new HttpsError('failed-precondition', 'Channel is inactive. Activate it first.');
      }

      tx.set(msgRef, {
        body: text || null,
        imageUrl: imageUrl || null,
        videoUrl: videoUrl || null,
        videoPosterUrl: videoPosterUrl || null,
        ctaLabel: ctaLabel || null,
        ctaUrl: ctaUrl || null,
        segment: segment || null,
        campaignId: campaignId || null,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: uid,
      });

      tx.set(chanRef, {
        messageCount: FieldValue.increment(1),
        lastMessage: preview,
        lastMessageAt: FieldValue.serverTimestamp(),
        lastMessageId: msgRef.id,
      }, { merge: true });
    });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'channel_message_send',
      target: { type: 'official_channel_message', id: `${channelId}/${msgRef.id}` },
      after: { channelId, preview, hasImage: !!imageUrl, hasVideo: !!videoUrl, campaignId },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    }).catch(() => {});

    return { ok: true, messageId: msgRef.id, preview };
  },
);

exports.adminListChannelMessages = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    await guardCaller(request.auth?.uid);
    const { channelId, pageSize = 30, cursor = null } = request.data || {};
    assertValidChannelId(channelId);
    let q = db.collection('official_channels').doc(channelId).collection('messages')
      .orderBy('createdAt', 'desc');
    if (cursor) q = q.startAfter(new Date(cursor));
    const lim = Math.min(Number(pageSize) || 30, 100);
    const snap = await q.limit(lim + 1).get();

    const docs = snap.docs.slice(0, lim);
    const rows = docs.map((d) => ({ id: d.id, ...d.data(), createdAt: toMs(d.data().createdAt) }));
    const hasMore = snap.docs.length > lim;
    return {
      rows,
      nextCursor: hasMore && rows.length ? rows[rows.length - 1].createdAt : null,
    };
  },
);

/**
 * Remove a message from a channel.
 *
 * This genuinely deletes it, because a channel message is a broadcast and the
 * only way to retract one is for it to stop existing. It cannot recall a push
 * that already went out, and the admin UI has to say so rather than implying
 * otherwise.
 *
 * The channel's denormalised preview is rebuilt from the newest surviving
 * message, so deleting the latest message does not leave a stale row in every
 * user's inbox pointing at content that is gone.
 */
exports.adminDeleteChannelMessage = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid, { requireStepUp: true });
    const { channelId, messageId } = request.data || {};
    assertValidChannelId(channelId);
    if (!messageId) throw new HttpsError('invalid-argument', 'messageId required.');

    const chanRef = db.collection('official_channels').doc(channelId);
    const msgRef = chanRef.collection('messages').doc(messageId);
    const msgSnap = await msgRef.get();
    if (!msgSnap.exists) throw new HttpsError('not-found', 'Message not found.');
    const wasLatest = (await chanRef.get()).data()?.lastMessageId === messageId;

    await msgRef.delete();

    // Rebuild the preview only when the deleted message was the one on display.
    if (wasLatest) {
      const newest = await chanRef.collection('messages')
        .orderBy('createdAt', 'desc').limit(1).get();
      if (newest.empty) {
        await chanRef.set({
          lastMessage: null, lastMessageAt: null, lastMessageId: null,
          messageCount: FieldValue.increment(-1),
        }, { merge: true });
      } else {
        const d = newest.docs[0];
        const m = d.data();
        await chanRef.set({
          lastMessage: previewOf(m.body, !!m.imageUrl, !!m.videoUrl),
          lastMessageAt: m.createdAt,
          lastMessageId: d.id,
          messageCount: FieldValue.increment(-1),
        }, { merge: true });
      }
    } else {
      await chanRef.set({ messageCount: FieldValue.increment(-1) }, { merge: true });
    }

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: 'channel_message_delete',
      target: { type: 'official_channel_message', id: `${channelId}/${messageId}` },
      before: { preview: previewOf(msgSnap.data().body, false, false) },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    }).catch(() => {});

    return { ok: true, wasLatest };
  },
);

// ────────────────────────────────────────────────────────────────────
// PUSH: one topic send per channel message
// ────────────────────────────────────────────────────────────────────
//
// Per-channel FCM topics rather than a per-user fan-out. This is better than the
// token-list approach the plan originally sketched for Phase 1, for two reasons:
//
//   Cost: a channel message is ONE FCM call at any audience size, instead of two
//   Firestore reads plus a multicast per user.
//
//   Correctness: MUTE BECOMES REAL AT THE TRANSPORT LAYER. A muted user is
//   unsubscribed from the topic, so no push is even addressed to them. The old
//   design read a preference per user at send time, which is both expensive and
//   easy to get wrong.
//
// The thread remains the source of truth. A push is best effort: if a
// subscription has drifted, the user still gets the message in their inbox,
// which is exactly the founder's D1 split (delivery always, notification
// optional). Subscriptions are re-asserted on app open, which is idempotent.

const CHANNEL_TOPIC = (channelId) => `chan_${channelId}`;

/**
 * Subscribe or unsubscribe this device's FCM token to a channel's topic.
 *
 * Called by the client on app open (assert), and on mute / unmute / notification
 * toggle. Same shape as the existing `subscribeAnnouncements` callable.
 */
exports.setChannelPushSubscription = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
    const token = String(request.data?.token || '').trim();
    const channelId = String(request.data?.channelId || '').trim();
    const subscribe = request.data?.subscribe !== false;
    if (!token) throw new HttpsError('invalid-argument', 'token required.');
    assertValidChannelId(channelId);

    const { getMessaging } = require('firebase-admin/messaging');
    try {
      if (subscribe) await getMessaging().subscribeToTopic([token], CHANNEL_TOPIC(channelId));
      else await getMessaging().unsubscribeFromTopic([token], CHANNEL_TOPIC(channelId));
      return { ok: true };
    } catch (e) {
      // A stale or invalid token simply is not subscribed. Never fatal: the
      // message still lands in the thread.
      return { ok: false };
    }
  },
);

/**
 * Fire the push when a channel message is created.
 *
 * ONE trigger invocation per send, not one per user, because it fires on the
 * single shared message document.
 *
 * Deliberately does NOT push for a message carrying a `segment`: a segment is a
 * soft client-side render filter, and a topic send cannot honour it, so pushing
 * would notify people who will not see the message. Those land silently in the
 * thread instead.
 */
exports.onChannelMessageCreated = functions.firestore.onDocumentCreated(
  { document: 'official_channels/{channelId}/messages/{messageId}', database: 'vgrdb', region: REGION },
  async (event) => {
    const m = event.data?.data();
    if (!m) return;
    const { channelId } = event.params;
    if (m.segment) return; // see the note above

    const chanSnap = await db.collection('official_channels').doc(channelId).get();
    if (!chanSnap.exists) return;
    const chan = chanSnap.data();
    if (chan.active === false) return;

    const title = chan.name || 'Vergr';
    const body = previewOf(m.body, !!m.imageUrl, !!m.videoUrl);

    const { getMessaging } = require('firebase-admin/messaging');
    try {
      await getMessaging().send({
        topic: CHANNEL_TOPIC(channelId),
        // Data-only, matching sendPushToUser: the service worker and the native
        // notification builder construct the visible notification, which is how
        // routing and styling stay under our control.
        data: {
          type: `channel_${channelId}`,
          title,
          body,
          channelId,
          actionUrl: `/messages/c/${channelId}`,
          ...(m.imageUrl ? { image: m.imageUrl } : {}),
        },
        android: { priority: 'high' },
      });
    } catch (e) {
      console.warn('onChannelMessageCreated push failed', channelId, e?.message || e);
    }
  },
);

exports._internal = { previewOf, assertNotPersonal, assertValidChannelId, CHANNEL_TOPIC };
