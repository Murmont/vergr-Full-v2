// Campaigns: one document per announcement, every surface derived from it.
//
// THE SHAPE THAT MATTERS
//
// The old `sendAnnouncement` wrote one notification document per user, so a send
// cost about 4N Firestore operations and had no record of itself afterwards: you
// could not edit, recall, re-send or measure one. This replaces it.
//
// Every surface here is a SHARED document that clients read, not a fan-out:
//
//   thread  -> one message in official_channels/{id}/messages
//   drawer  -> the campaign doc itself, read by the client
//   popup   -> the campaign doc itself, read by the client
//   push    -> one FCM topic send
//
// So a campaign to a million users costs the same handful of writes as a
// campaign to ten. Per-user state (read, dismissed, clicked) is written by the
// CLIENT when it happens, one document per user who actually engaged, which is
// also where the metrics come from, so tracking is free rather than a second
// system.
//
// THE CALLABLE NEVER SENDS. It validates, writes and returns. A worker does the
// delivery, which is what makes scheduling, pause, recall and honest metrics
// possible. Same shape as the creator payout run that already exists.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const {
  requireFreshStepUp, adminRateLimit, auditAdminAction, extractRequestMeta,
} = require('./adminSecurity');
const { requireAdminScreen } = require('./adminAccess');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;
const SCREEN = 'announcements';

const COL = 'announcements';
const READS = 'announcement_reads';

const MAX_HEADING = 90;
const MAX_BODY = 2000;
const MAX_CTA = 30;

const toMs = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : null);

const SURFACES = ['thread', 'drawer', 'popup', 'push'];

// ────────────────────────────────────────────────────────────────────
// VALIDATION
// ────────────────────────────────────────────────────────────────────

function cleanContent(raw) {
  const c = raw || {};
  const heading = String(c.heading || '').trim();
  const body = String(c.body || '').trim();
  if (!heading && !body) {
    throw new HttpsError('invalid-argument', 'A campaign needs a heading or a body.');
  }
  if (heading.length > MAX_HEADING) {
    throw new HttpsError('invalid-argument', `heading must be ${MAX_HEADING} characters or fewer.`);
  }
  if (body.length > MAX_BODY) {
    throw new HttpsError('invalid-argument', `body must be ${MAX_BODY} characters or fewer.`);
  }
  const ctaLabel = String(c.ctaLabel || '').trim().slice(0, MAX_CTA);
  const ctaUrl = String(c.ctaUrl || '').trim().slice(0, 500);
  if (ctaLabel && !ctaUrl) throw new HttpsError('invalid-argument', 'A button needs a link.');
  if (ctaUrl && !ctaLabel) throw new HttpsError('invalid-argument', 'A link needs a button label.');
  return {
    heading,
    body,
    imageUrl: c.imageUrl || null,
    videoUrl: c.videoUrl || null,
    videoPosterUrl: c.videoPosterUrl || null,
    ctaLabel: ctaLabel || null,
    ctaUrl: ctaUrl || null,
  };
}

/**
 * Normalise the surfaces map, dropping anything unrecognised.
 *
 * A campaign with no surface is a draft with nowhere to go, and sending one
 * would silently do nothing, so it is rejected rather than accepted as a no-op.
 */
function cleanSurfaces(raw) {
  const s = raw || {};
  const out = {};
  if (s.thread?.channelId) out.thread = { channelId: String(s.thread.channelId) };
  if (s.drawer) out.drawer = true;
  if (s.popup) out.popup = true;
  if (s.push) out.push = { quietHours: s.push.quietHours !== false };
  // What's New is PUBLIC and indexed, so it is the one surface that is never
  // implied: nothing appears there unless it is explicitly selected and given a
  // slug. `noindex` is per entry so a single post can be pulled from search
  // without touching the section.
  if (s.whatsNew?.slug) {
    const slug = String(s.whatsNew.slug).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (slug.length >= 3) {
      out.whatsNew = {
        slug: slug.slice(0, 80),
        category: String(s.whatsNew.category || 'update').slice(0, 40),
        noindex: s.whatsNew.noindex === true,
      };
    }
  }
  return out;
}

/**
 * Segment rules.
 *
 * Guests, bots and banned accounts are excluded server-side and the flags are
 * not client-settable. A guest is an anonymous session, not a person who asked
 * to hear from us, and a banned account should not be receiving marketing.
 */
function cleanSegment(raw) {
  const inc = raw?.include || {};
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 20) : []);
  return {
    include: {
      tiers: arr(inc.tiers),
      platforms: arr(inc.platforms),
      roles: arr(inc.roles),
      creatorEnrolled: inc.creatorEnrolled === true,
      minAccountAgeDays: Math.max(0, Number(inc.minAccountAgeDays) || 0),
    },
    exclude: { guests: true, bots: true, banned: true },
  };
}

/**
 * Does this viewer match the segment?
 *
 * Exported and pure so the client can apply the SAME rule when deciding whether
 * to render a drawer row or a popup. A campaign doc is readable by everyone (it
 * is a shared document), so the segment is curation, never secrecy: anything
 * genuinely private belongs in a restricted channel, not a campaign.
 */
function segmentMatches(segment, facts) {
  if (!segment) return true;
  if (facts.isGuest || facts.isBot || facts.banned) return false;
  const inc = segment.include || {};
  if (inc.tiers?.length && !inc.tiers.includes(facts.tier || 'free')) return false;
  if (inc.roles?.length && !inc.roles.includes(facts.role || 'user')) return false;
  if (inc.creatorEnrolled && !facts.creatorEnrolled) return false;
  if (inc.minAccountAgeDays > 0) {
    if (!facts.accountAgeDays || facts.accountAgeDays < inc.minAccountAgeDays) return false;
  }
  return true;
}

// ────────────────────────────────────────────────────────────────────
// ADMIN
// ────────────────────────────────────────────────────────────────────

exports.adminUpsertCampaign = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminScreen(uid, SCREEN);
    await adminRateLimit(uid, 'campaign_upsert', { perHour: 60, perDay: 300 });

    const { campaignId = null, title, content, surfaces, segment, scheduleAt = null } = request.data || {};
    if (!title || String(title).trim().length < 2) {
      throw new HttpsError('invalid-argument', 'Give the campaign an internal name.');
    }

    const ref = campaignId ? db.collection(COL).doc(String(campaignId)) : db.collection(COL).doc();
    const existing = await ref.get();
    // A campaign that has gone out is a record of what was sent. Editing it
    // afterwards would make the record a lie, so it is frozen.
    if (existing.exists && ['sending', 'sent'].includes(existing.data().status)) {
      throw new HttpsError('failed-precondition',
        'This campaign has already gone out and cannot be edited. Duplicate it instead.');
    }

    const fields = {
      title: String(title).trim().slice(0, 80),
      content: { en: cleanContent(content) },
      surfaces: cleanSurfaces(surfaces),
      segment: cleanSegment(segment),
      scheduleAt: scheduleAt ? new Date(Number(scheduleAt)) : null,
      status: existing.exists ? existing.data().status : 'draft',
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid,
    };
    if (!existing.exists) {
      fields.createdAt = FieldValue.serverTimestamp();
      fields.createdBy = uid;
      fields.stats = { impressions: 0, opens: 0, clicks: 0, dismissals: 0, pushSent: 0 };
      fields.delivery = null;
    }
    await ref.set(fields, { merge: true });
    return { ok: true, campaignId: ref.id };
  },
);

exports.adminListCampaigns = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminScreen(uid, SCREEN);
    const { status = null, pageSize = 40 } = request.data || {};
    let q = db.collection(COL);
    if (status) q = q.where('status', '==', status);
    q = q.orderBy('createdAt', 'desc').limit(Math.min(Number(pageSize) || 40, 100));
    const snap = await q.get();
    return {
      rows: snap.docs.map((d) => {
        const c = d.data();
        return {
          campaignId: d.id,
          title: c.title,
          status: c.status,
          heading: c.content?.en?.heading || '',
          body: (c.content?.en?.body || '').slice(0, 160),
          surfaces: Object.keys(c.surfaces || {}),
          threadChannelId: c.surfaces?.thread?.channelId || null,
          slug: c.surfaces?.whatsNew?.slug || null,
          category: c.surfaces?.whatsNew?.category || 'update',
          noindex: c.surfaces?.whatsNew?.noindex === true,
          imageUrl: c.content?.en?.imageUrl || null,
          ctaLabel: c.content?.en?.ctaLabel || '',
          ctaUrl: c.content?.en?.ctaUrl || '',
          scheduleAt: toMs(c.scheduleAt),
          createdAt: toMs(c.createdAt),
          stats: c.stats || {},
          delivery: c.delivery ? { completedAt: toMs(c.delivery.completedAt), errors: c.delivery.errors || [] } : null,
        };
      }),
    };
  },
);

/**
 * Send, or schedule.
 *
 * Flips status and returns. Delivery happens in the trigger below, which is what
 * makes a timeout recoverable: the callable finishing is not the send.
 *
 * Step-up required, because this reaches everyone and a push cannot be recalled
 * from a tray once delivered.
 */
exports.adminSendCampaign = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminScreen(uid, SCREEN);
    await requireFreshStepUp(uid);
    await adminRateLimit(uid, 'campaign_send', { perHour: 20, perDay: 60 });

    const campaignId = String(request.data?.campaignId || '');
    const ref = db.collection(COL).doc(campaignId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'No such campaign.');
    const c = snap.data();
    if (['sending', 'sent'].includes(c.status)) {
      throw new HttpsError('failed-precondition', 'This campaign has already gone out.');
    }
    if (!Object.keys(c.surfaces || {}).length) {
      throw new HttpsError('failed-precondition',
        'Pick at least one place for this to appear, or it goes nowhere.');
    }

    const due = c.scheduleAt ? toMs(c.scheduleAt) : null;
    const scheduled = due && due > Date.now() + 30_000;

    await ref.update({
      status: scheduled ? 'scheduled' : 'sending',
      sentBy: uid,
      sentAt: FieldValue.serverTimestamp(),
    });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: scheduled ? 'campaign_schedule' : 'campaign_send',
      target: { type: 'campaign', id: campaignId },
      before: null,
      after: { title: c.title, surfaces: Object.keys(c.surfaces || {}) },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: true, stepUpFresh: true,
    }).catch(() => {});

    return { ok: true, scheduled: !!scheduled, sendAtMs: due || Date.now() };
  },
);

/**
 * Stop showing a campaign.
 *
 * Honest about its limits in the return value: the in-app surfaces disappear
 * immediately because they are read live from this document, but a push that has
 * already been delivered to a device cannot be taken back by anyone.
 */
exports.adminRecallCampaign = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminScreen(uid, SCREEN);
    const campaignId = String(request.data?.campaignId || '');
    const ref = db.collection(COL).doc(campaignId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'No such campaign.');
    await ref.update({ status: 'recalled', recalledAt: FieldValue.serverTimestamp(), recalledBy: uid });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid, action: 'campaign_recall',
      target: { type: 'campaign', id: campaignId },
      before: { status: snap.data().status }, after: { status: 'recalled' },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: false, stepUpFresh: false,
    }).catch(() => {});

    return { ok: true, pushAlreadyDelivered: !!snap.data().delivery?.perSurface?.push };
  },
);

// ────────────────────────────────────────────────────────────────────
// DELIVERY
// ────────────────────────────────────────────────────────────────────

/**
 * Do the work for one campaign.
 *
 * Every unit is keyed by {campaignId, surface} in `delivery.perSurface`, so a
 * retry after a timeout resumes rather than re-sending. That is the whole reason
 * delivery is separate from the callable.
 */
async function deliver(ref, c) {
  const done = { ...(c.delivery?.perSurface || {}) };
  const errors = [...(c.delivery?.errors || [])];
  const surfaces = c.surfaces || {};
  const en = c.content?.en || {};

  // 1. Thread: one message into the channel. Reuses the channel message shape so
  //    it renders in the thread the user already has.
  if (surfaces.thread?.channelId && !done.thread) {
    try {
      const chanRef = db.collection('official_channels').doc(surfaces.thread.channelId);
      const msgRef = chanRef.collection('messages').doc();
      const preview = (en.body || en.heading || 'New message').replace(/\s+/g, ' ').trim().slice(0, 140);
      const batch = db.batch();
      batch.set(msgRef, {
        body: [en.heading, en.body].filter(Boolean).join('\n\n').slice(0, MAX_BODY),
        imageUrl: en.imageUrl || null,
        videoUrl: en.videoUrl || null,
        ctaLabel: en.ctaLabel || null,
        ctaUrl: en.ctaUrl || null,
        campaignId: ref.id,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: c.sentBy || 'system',
      });
      batch.set(chanRef, {
        lastMessage: preview,
        lastMessageAt: FieldValue.serverTimestamp(),
        lastMessageId: msgRef.id,
        messageCount: FieldValue.increment(1),
      }, { merge: true });
      await batch.commit();
      done.thread = true;
    } catch (e) {
      errors.push(`thread: ${e?.message || e}`);
    }
  }

  // 2, 3 and 5. Drawer, popup and What's New need NO delivery work at all. They
  //    are read live from this campaign document by the client, which is the
  //    entire point of the design: a campaign to everyone costs zero extra
  //    writes here. What's New additionally stamps its publish time, which is
  //    what the public page sorts and dates by.
  if (surfaces.drawer) done.drawer = true;
  if (surfaces.popup) done.popup = true;
  if (surfaces.whatsNew && !done.whatsNew) {
    try {
      await ref.update({ 'surfaces.whatsNew.publishedAt': FieldValue.serverTimestamp() });
      done.whatsNew = true;
    } catch (e) {
      errors.push(`whatsNew: ${e?.message || e}`);
    }
  }

  // 4. Push: one topic send. A segmented campaign deliberately does NOT push,
  //    because a topic send cannot honour a segment and pushing to everyone
  //    about something most of them cannot see is worse than not pushing.
  if (surfaces.push && !done.push) {
    const seg = c.segment?.include || {};
    const segmented = !!(seg.tiers?.length || seg.roles?.length || seg.creatorEnrolled || seg.minAccountAgeDays);
    if (segmented) {
      done.push = 'skipped_segmented';
    } else {
      try {
        const { getMessaging } = require('firebase-admin/messaging');
        await getMessaging().send({
          topic: 'announcements',
          data: {
            type: 'updates',
            title: en.heading || 'Vergr',
            body: (en.body || '').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Tap to read',
            campaignId: ref.id,
            actionUrl: surfaces.thread?.channelId ? `/messages/c/${surfaces.thread.channelId}` : '/notifications',
            ...(en.imageUrl ? { image: en.imageUrl } : {}),
          },
          android: { priority: 'high' },
        });
        done.push = true;
      } catch (e) {
        errors.push(`push: ${e?.message || e}`);
      }
    }
  }

  await ref.update({
    status: errors.length && !Object.keys(done).length ? 'failed' : 'sent',
    delivery: {
      startedAt: c.delivery?.startedAt || FieldValue.serverTimestamp(),
      completedAt: FieldValue.serverTimestamp(),
      perSurface: done,
      errors: errors.slice(0, 20),
    },
  });
}

/** Deliver as soon as a campaign flips to `sending`. No cron, no polling. */
exports.onCampaignSending = functions.firestore.onDocumentWritten(
  { document: `${COL}/{campaignId}`, region: REGION, database: 'vgrdb' },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after || after.status !== 'sending') return;
    if (before?.status === 'sending') return; // already handled; avoid a loop
    await deliver(event.data.after.ref, after);
  },
);

/**
 * Release scheduled campaigns whose time has come.
 *
 * Folded into the existing cron dispatcher rather than adding a Cloud Scheduler
 * job: a new schedule is a recurring bill, and this self-gates to nothing when
 * there is no scheduled work.
 */
exports.releaseScheduledCampaigns = async () => {
  const snap = await db.collection(COL)
    .where('status', '==', 'scheduled')
    .where('scheduleAt', '<=', new Date())
    .limit(20)
    .get();
  if (snap.empty) return;
  for (const d of snap.docs) {
    await d.ref.update({ status: 'sending' }).catch(() => {});
  }
};

// ────────────────────────────────────────────────────────────────────
// METRICS
// ────────────────────────────────────────────────────────────────────

/**
 * Record that this user saw, opened, clicked or dismissed a campaign.
 *
 * One document per user who ENGAGED, rather than one per user targeted, so
 * measurement costs nothing for people who never see it. The read document is
 * also what suppresses a popup on every other device, so tracking and
 * suppression are the same write instead of two systems.
 */
exports.recordCampaignEvent = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
    const campaignId = String(request.data?.campaignId || '');
    const event = String(request.data?.event || '');
    if (!campaignId) throw new HttpsError('invalid-argument', 'campaignId required.');
    const FIELD = { impression: 'impressions', open: 'opens', click: 'clicks', dismiss: 'dismissals' }[event];
    if (!FIELD) throw new HttpsError('invalid-argument', 'Unknown event.');

    const readRef = db.collection(READS).doc(`${campaignId}__${uid}`);
    const prior = await readRef.get();
    // Count each event once per user. Without this a popup that re-renders would
    // inflate impressions and the number would be worthless.
    if (prior.exists && prior.data()?.[event]) return { ok: true, duplicate: true };

    await readRef.set({
      campaignId, uid, [event]: true, [`${event}At`]: FieldValue.serverTimestamp(),
    }, { merge: true });
    await db.collection(COL).doc(campaignId)
      .update({ [`stats.${FIELD}`]: FieldValue.increment(1) })
      .catch(() => {});
    return { ok: true };
  },
);

exports._internal = { cleanContent, cleanSurfaces, cleanSegment, segmentMatches, SURFACES };

/**
 * The public What's New list.
 *
 * Deliberately a callable rather than a direct client read, for two reasons:
 * the section has a global kill switch that must work without a deploy, and the
 * public page must never see a draft. It runs unauthenticated because the page
 * is public.
 */
exports.getWhatsNew = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    let cfg = {};
    try {
      const c = await db.doc('app_config/general').get();
      cfg = c.exists ? (c.data() || {}) : {};
    } catch { /* a missing config must not take the page down */ }
    // Off means off, in seconds, with no deploy. Founder decision D4: full
    // control, never boxed in.
    if (cfg.whatsNewEnabled === false) return { enabled: false, entries: [] };

    const slug = request.data?.slug ? String(request.data.slug) : null;
    const snap = await db.collection(COL)
      .where('status', '==', 'sent')
      .orderBy('createdAt', 'desc')
      .limit(slug ? 100 : 40)
      .get();

    const entries = snap.docs
      .map((d) => ({ campaignId: d.id, ...d.data() }))
      .filter((c) => c.surfaces?.whatsNew?.slug)
      .filter((c) => (slug ? c.surfaces.whatsNew.slug === slug : true))
      .map((c) => ({
        campaignId: c.campaignId,
        slug: c.surfaces.whatsNew.slug,
        category: c.surfaces.whatsNew.category || 'update',
        // The section can be de-indexed globally OR an entry individually.
        // Either one wins, because the stricter answer is the safe one.
        noindex: c.surfaces.whatsNew.noindex === true || cfg.whatsNewIndexable === false,
        heading: c.content?.en?.heading || '',
        body: slug ? (c.content?.en?.body || '') : (c.content?.en?.body || '').slice(0, 200),
        imageUrl: c.content?.en?.imageUrl || null,
        ctaLabel: c.content?.en?.ctaLabel || null,
        ctaUrl: c.content?.en?.ctaUrl || null,
        publishedAt: toMs(c.surfaces.whatsNew.publishedAt) || toMs(c.createdAt),
      }));

    return { enabled: true, entries };
  },
);

/**
 * Edit a What's New entry AFTER it has gone out (founder decision D4: full
 * control, never boxed in).
 *
 * A sent campaign is otherwise frozen, because it is the record of what was
 * delivered and editing it would make that record a lie. This is the deliberate
 * exception: the What's New page is a living public page, not a delivery
 * receipt, so its copy can be corrected. What it CANNOT do is change what was
 * pushed or posted to a thread, because those already happened.
 *
 * The edit is stamped so the difference between "as sent" and "as it reads now"
 * is always recoverable.
 */
exports.adminUpdateWhatsNew = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminScreen(uid, SCREEN);
    const { campaignId, heading, body, category, noindex, unpublish } = request.data || {};
    const ref = db.collection(COL).doc(String(campaignId || ''));
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'No such entry.');
    const c = snap.data();
    if (!c.surfaces?.whatsNew) {
      throw new HttpsError('failed-precondition', 'That campaign is not on What\'s New.');
    }

    if (unpublish) {
      // Removing the surface is the unpublish. The campaign itself survives, so
      // the record of what was sent is intact and it can be put back.
      await ref.update({
        'surfaces.whatsNew': FieldValue.delete(),
        whatsNewUnpublishedAt: FieldValue.serverTimestamp(),
      });
      return { ok: true, unpublished: true };
    }

    const patch = { whatsNewEditedAt: FieldValue.serverTimestamp(), whatsNewEditedBy: uid };
    if (typeof heading === 'string') patch['content.en.heading'] = heading.trim().slice(0, MAX_HEADING);
    if (typeof body === 'string') patch['content.en.body'] = body.trim().slice(0, MAX_BODY);
    if (typeof category === 'string') patch['surfaces.whatsNew.category'] = category.slice(0, 40);
    if (typeof noindex === 'boolean') patch['surfaces.whatsNew.noindex'] = noindex;
    await ref.update(patch);

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid, action: 'whats_new_edit',
      target: { type: 'campaign', id: String(campaignId) },
      before: { heading: c.content?.en?.heading || '' },
      after: { heading: patch['content.en.heading'] ?? (c.content?.en?.heading || '') },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: false, stepUpFresh: false,
    }).catch(() => {});

    return { ok: true };
  },
);
