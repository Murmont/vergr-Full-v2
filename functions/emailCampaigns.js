// Admin email campaigns: designed emails sent to chosen users.
//
// A MODULE, not a Cloud Function. Every op rides adminListEmailTemplates
// (op: 'campaign.*'), which already exists and has SMTP_PASS bound, because a
// new function is a new Artifact Registry image. The unsubscribe link rides
// verifyEmailCode (op: 'unsubscribe' / 'resubscribe') for the same reason.
//
// DATA
//   email_campaigns/{id}                     the design + audience + counters
//   email_campaigns/{id}/recipients/{uid}    one row per person: address, status,
//                                            and the hash of their unsubscribe token
//   users/{uid}.emailOptOut                  true = never send a campaign again
//
// Server-only: firestore.rules denies clients both collections. Addresses come
// from Firebase Auth, never from users/{uid} (that doc is publicly listable).
//
// SENDING. The admin queues the campaign (resolves the audience into recipient
// rows), then the screen calls 'campaign.sendBatch' repeatedly; each call sends
// up to BATCH queued rows and reports what is left. No cron, no queue service.
// A lease on the campaign doc stops two open screens sending the same batch.
//
// COST, stated rather than hidden: resolving an audience reads every users doc
// once (one read per account), queueing writes one row per recipient, and each
// send updates that row. SMTP is the existing Spacemail mailbox.

const crypto = require('crypto');
const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const nodemailer = require('nodemailer');
const emailTemplates = require('./emailTemplates');
const { planOf } = require('./plan');
const { auditAdminAction, extractRequestMeta, adminRateLimit, requireFreshStepUp } = require('./adminSecurity');

const db = getFirestore('vgrdb');
const HttpsError = functions.https.HttpsError;
const COL = 'email_campaigns';
const BATCH = 40;
const LEASE_MS = 4 * 60 * 1000;
const DAY = 86400000;

const SMTP_USER = functions.params.defineString('SMTP_USER');
const SMTP_PASS = functions.params.defineSecret('SMTP_PASS');
const SMTP_HOST = functions.params.defineString('SMTP_HOST', { default: 'mail.spacemail.com' });
const SMTP_PORT = functions.params.defineString('SMTP_PORT', { default: '465' });
const SMTP_FROM = functions.params.defineString('SMTP_FROM', { default: 'Vergr <noreply@vergr.app>' });

const { fill, renderHtml, renderText } = emailTemplates._internal;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const toMs = (t) => (t?.toMillis ? t.toMillis() : (typeof t === 'number' ? t : (t instanceof Date ? t.getTime() : 0)));

// Categories an admin can pick. Several may be picked; the audience is their UNION.
const SEGMENTS = {
  verified:   { label: 'Verified email',       test: (u, a) => a.emailVerified },
  unverified: { label: 'Unverified email',     test: (u, a) => !a.emailVerified },
  free:       { label: 'Free plan',            test: (u) => planOf(u) === 'free' },
  lite:       { label: 'Lite plan',            test: (u) => planOf(u) === 'lite' },
  pro:        { label: 'Pro plan',             test: (u) => planOf(u) === 'pro' },
  creators:   { label: 'Creators',             test: (u) => u.creator?.status === 'active' },
  active30:   { label: 'Active in last 30 days', test: (u) => Date.now() - toMs(u.lastSeen) < 30 * DAY },
  inactive30: { label: 'Not seen in 30 days',  test: (u) => Date.now() - toMs(u.lastSeen) >= 30 * DAY },
  new30:      { label: 'Joined in last 30 days', test: (u) => Date.now() - toMs(u.createdAt) < 30 * DAY },
  staff:      { label: 'Staff accounts',       test: (u) => u.staff === true },
};

function smtpReady() {
  try {
    const u = SMTP_USER.value(); const p = SMTP_PASS.value();
    return !!(u && p && u !== 'placeholder' && p !== 'placeholder');
  } catch { return false; }
}
function transport() {
  const port = Number(SMTP_PORT.value() || 465);
  return nodemailer.createTransport({
    host: SMTP_HOST.value() || 'mail.spacemail.com', port, secure: port === 465,
    auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() },
    pool: true, maxConnections: 1,
  });
}

const varsFor = (u) => ({
  name: u?.displayName || u?.username || 'there',
  username: u?.username || '',
});
const unsubUrl = (cid, uid, token) =>
  `https://vergr.app/unsubscribe?c=${encodeURIComponent(cid)}&u=${encodeURIComponent(uid)}&t=${encodeURIComponent(token)}`;

function render(design, vars, unsubscribeUrl) {
  const tpl = { ...design };
  return {
    subject: fill(tpl.subject, vars),
    html: renderHtml(tpl, vars, { unsubscribeUrl }),
    text: renderText(tpl, vars, { unsubscribeUrl }),
  };
}

async function sendOne(t, to, msg, unsubscribeUrl) {
  await t.sendMail({
    from: SMTP_FROM.value() || 'Vergr <noreply@vergr.app>',
    to, subject: msg.subject, text: msg.text, html: msg.html,
    headers: unsubscribeUrl ? { 'List-Unsubscribe': `<${unsubscribeUrl}>` } : undefined,
  });
}

/** Everyone who could receive an email, with the facts the segments need. */
async function loadPeople({ uids = null } = {}) {
  const auth = new Map();
  if (uids) {
    for (let i = 0; i < uids.length; i += 100) {
      const r = await getAuth().getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
      for (const a of r.users) auth.set(a.uid, a);
    }
  } else {
    let token;
    do {
      const page = await getAuth().listUsers(1000, token);
      for (const a of page.users) auth.set(a.uid, a);
      token = page.pageToken;
    } while (token);
  }
  const docs = new Map();
  if (uids) {
    for (let i = 0; i < uids.length; i += 300) {
      const refs = uids.slice(i, i + 300).map((id) => db.collection('users').doc(id));
      const snaps = await db.getAll(...refs);
      for (const s of snaps) if (s.exists) docs.set(s.id, s.data());
    }
  } else {
    const snap = await db.collection('users').select(
      'displayName', 'username', 'subscription', 'tier', 'plan', 'isGuest', 'accountType',
      'banned', 'emailOptOut', 'staff', 'creator', 'lastSeen', 'createdAt',
    ).get();
    for (const s of snap.docs) docs.set(s.id, s.data());
  }
  return { auth, docs };
}

/**
 * Resolve an audience into recipients plus a count of who was left out and why.
 * audience: { mode: 'all' | 'segments' | 'pick', segments: [id], uids: [uid] }
 */
async function resolveAudience(audience = {}) {
  const mode = ['all', 'segments', 'pick'].includes(audience.mode) ? audience.mode : 'all';
  const segs = (Array.isArray(audience.segments) ? audience.segments : []).filter((s) => SEGMENTS[s]);
  const picked = mode === 'pick'
    ? [...new Set((Array.isArray(audience.uids) ? audience.uids : []).map(String))].slice(0, 5000)
    : null;
  if (mode === 'segments' && !segs.length) throw new HttpsError('invalid-argument', 'Pick at least one category.');
  if (mode === 'pick' && !picked.length) throw new HttpsError('invalid-argument', 'Pick at least one person.');

  const { auth, docs } = await loadPeople({ uids: picked });
  const out = [];
  const skipped = { noEmail: 0, optedOut: 0, banned: 0, bot: 0 };
  const ids = picked || [...auth.keys()];
  for (const uid of ids) {
    const a = auth.get(uid);
    const u = docs.get(uid) || {};
    // No users doc = not a Vergr member (the operator and profile-less staff
    // consoles). Never a recipient.
    if (!docs.has(uid)) continue;
    if (typeof u.accountType === 'string' && u.accountType.includes('bot')) { skipped.bot++; continue; }
    // Category first, so 'left out' counts only people who were in the audience.
    if (mode === 'segments' && !segs.some((s) => SEGMENTS[s].test(u, a || {}))) continue;
    if (!a?.email) { skipped.noEmail++; continue; }
    if (a.disabled || u.banned === true) { skipped.banned++; continue; }
    if (u.emailOptOut === true) { skipped.optedOut++; continue; }
    out.push({ uid, email: a.email, name: varsFor(u).name, username: u.username || '' });
  }
  return { mode, segments: segs, recipients: out, skipped };
}

async function loadCampaign(id) {
  if (!id || typeof id !== 'string') throw new HttpsError('invalid-argument', 'Missing campaign.');
  const ref = db.collection(COL).doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Campaign not found.');
  return { ref, c: snap.data() };
}

const designOf = (c) => ({ subject: c.subject, preheader: c.preheader, hero: c.hero, theme: c.theme, blocks: c.blocks });

function shape(id, c) {
  return {
    id,
    name: c.name || '',
    subject: c.subject, preheader: c.preheader, hero: c.hero, theme: c.theme, blocks: c.blocks,
    audience: c.audience || { mode: 'all', segments: [], uids: [] },
    pickedPeople: c.pickedPeople || [],
    status: c.status || 'draft',
    counts: c.counts || { total: 0, sent: 0, failed: 0 },
    createdAt: toMs(c.createdAt) || null,
    updatedAt: toMs(c.updatedAt) || null,
    sentAt: toMs(c.sentAt) || null,
    lastTest: c.lastTest || null,
  };
}

async function handleCampaignOp(op, request) {
  const uid = request.auth?.uid;
  const data = request.data || {};
  const meta = extractRequestMeta(request);
  const audit = (action, target, after) => auditAdminAction({
    actor: uid, action, target, before: null, after,
    ip: meta.ip, userAgent: meta.userAgent, stepUpEnforced: false, stepUpFresh: false,
  }).catch(() => {});

  switch (op) {
    case 'campaign.meta':
      return {
        segments: Object.entries(SEGMENTS).map(([id, s]) => ({ id, label: s.label })),
        themes: Object.entries(emailTemplates.THEMES).map(([id, t]) => ({ id, label: t.label, hero: t.hero, btn: t.btn })),
        smtpConfigured: smtpReady(),
      };

    case 'campaign.list': {
      const snap = await db.collection(COL).orderBy('updatedAt', 'desc').limit(50).get();
      return { rows: snap.docs.map((d) => shape(d.id, d.data())) };
    }

    case 'campaign.get': {
      const { c } = await loadCampaign(data.id);
      return shape(data.id, c);
    }

    case 'campaign.save': {
      await adminRateLimit(uid, 'email_campaign_save', { perHour: 200, perDay: 1000 });
      const design = emailTemplates.cleanDesign(data.design || {});
      const audience = {
        mode: ['all', 'segments', 'pick'].includes(data.audience?.mode) ? data.audience.mode : 'all',
        segments: (data.audience?.segments || []).filter((s) => SEGMENTS[s]).slice(0, 20),
        uids: (data.audience?.uids || []).map(String).slice(0, 5000),
      };
      // Names shown on the picked chips, so reopening a draft shows who is in it
      // without a read per person.
      const pickedPeople = (Array.isArray(data.pickedPeople) ? data.pickedPeople : [])
        .slice(0, 5000).map((p) => ({ uid: String(p.uid || ''), label: String(p.label || '').slice(0, 60) }))
        .filter((p) => audience.uids.includes(p.uid));
      const row = {
        ...design,
        name: String(data.name || design.subject).slice(0, 80),
        audience, pickedPeople,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
      };
      if (data.id) {
        const { ref, c } = await loadCampaign(data.id);
        if ((c.status || 'draft') !== 'draft') {
          throw new HttpsError('failed-precondition', 'This campaign has already been sent. Duplicate it to change it.');
        }
        await ref.set(row, { merge: true });
        return { id: data.id };
      }
      const ref = await db.collection(COL).add({
        ...row, status: 'draft', counts: { total: 0, sent: 0, failed: 0 },
        createdAt: FieldValue.serverTimestamp(), createdBy: uid,
      });
      return { id: ref.id };
    }

    case 'campaign.delete': {
      const { ref, c } = await loadCampaign(data.id);
      if (c.status === 'sending') throw new HttpsError('failed-precondition', 'Stop the send first.');
      if ((c.status || 'draft') !== 'draft') {
        throw new HttpsError('failed-precondition', 'A sent campaign is kept as a record and cannot be deleted.');
      }
      await ref.delete();
      return { ok: true };
    }

    case 'campaign.preview': {
      const design = { ...(data.design || {}) };
      if (!Array.isArray(design.blocks)) design.blocks = [];
      return render(design, { name: 'Alex', username: 'alex' }, 'https://vergr.app/unsubscribe');
    }

    case 'campaign.audience': {
      const r = await resolveAudience(data.audience || {});
      return {
        count: r.recipients.length,
        sample: r.recipients.slice(0, 12).map((p) => (p.username ? '@' + p.username : p.name)),
        skipped: r.skipped,
      };
    }

    case 'campaign.test': {
      await adminRateLimit(uid, 'email_campaign_test', { perHour: 40, perDay: 200 });
      if (!smtpReady()) throw new HttpsError('failed-precondition', 'Email is not configured (SMTP).');
      const design = emailTemplates.cleanDesign(data.design || {});
      const handle = String(data.handle || 'Verion').replace(/^@/, '').trim().toLowerCase();
      const hit = await db.collection('users').where('usernameLower', '==', handle).limit(1).get();
      if (hit.empty) throw new HttpsError('not-found', `No account @${handle}.`);
      const doc = hit.docs[0];
      const a = await getAuth().getUser(doc.id).catch(() => null);
      if (!a?.email) throw new HttpsError('failed-precondition', `@${handle} has no email address on the account.`);
      const msg = render(design, varsFor(doc.data()), 'https://vergr.app/unsubscribe?test=1');
      msg.subject = '[Test] ' + msg.subject;
      const t = transport();
      try { await sendOne(t, a.email, msg, null); } finally { t.close(); }
      const lastTest = { handle, at: Date.now() };
      if (data.id) await db.collection(COL).doc(String(data.id)).set({ lastTest }, { merge: true }).catch(() => {});
      await audit('email_campaign_test', { type: 'email_campaign', id: data.id || null }, { handle });
      return { ok: true, handle };
    }

    case 'campaign.queue': {
      // Sending to real people is the one irreversible step: needs a fresh
      // authenticator code, like every other bulk admin action.
      await requireFreshStepUp(uid);
      await adminRateLimit(uid, 'email_campaign_queue', { perHour: 10, perDay: 30 });
      if (!smtpReady()) throw new HttpsError('failed-precondition', 'Email is not configured (SMTP).');
      const { ref, c } = await loadCampaign(data.id);
      if ((c.status || 'draft') !== 'draft') throw new HttpsError('failed-precondition', 'This campaign was already sent.');
      emailTemplates.cleanDesign(designOf(c));
      const r = await resolveAudience(c.audience || {});
      if (!r.recipients.length) throw new HttpsError('failed-precondition', 'Nobody in this audience can receive email.');

      for (let i = 0; i < r.recipients.length; i += 400) {
        const batch = db.batch();
        for (const p of r.recipients.slice(i, i + 400)) {
          batch.set(ref.collection('recipients').doc(p.uid), {
            email: p.email, name: p.name, username: p.username, status: 'queued',
          });
        }
        await batch.commit();
      }
      await ref.set({
        status: 'sending', queuedAt: FieldValue.serverTimestamp(), queuedBy: uid,
        counts: { total: r.recipients.length, sent: 0, failed: 0 }, skipped: r.skipped,
      }, { merge: true });
      await audit('email_campaign_send', { type: 'email_campaign', id: data.id },
        { subject: String(c.subject).slice(0, 120), recipients: r.recipients.length });
      return { ok: true, total: r.recipients.length, skipped: r.skipped };
    }

    case 'campaign.sendBatch': {
      if (!smtpReady()) throw new HttpsError('failed-precondition', 'Email is not configured (SMTP).');
      const { ref } = await loadCampaign(data.id);
      // Lease so two open screens never send the same rows.
      const got = await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        const d = s.data() || {};
        if (d.status !== 'sending') return { stop: d.status || 'draft' };
        if ((d.leaseUntil || 0) > Date.now()) return { busy: true };
        tx.update(ref, { leaseUntil: Date.now() + LEASE_MS });
        return { d };
      });
      if (got.stop) return { done: true, status: got.stop };
      if (got.busy) return { done: false, busy: true };

      const c = got.d;
      const design = designOf(c);
      const q = await ref.collection('recipients').where('status', '==', 'queued').limit(BATCH).get();
      let sent = 0; let failed = 0;
      const t = transport();
      try {
        for (const r of q.docs) {
          const p = r.data();
          const token = crypto.randomBytes(18).toString('base64url');
          const url = unsubUrl(data.id, r.id, token);
          try {
            await sendOne(t, p.email, render(design, { name: p.name || 'there', username: p.username || '' }, url), url);
            await r.ref.update({ status: 'sent', sentAt: FieldValue.serverTimestamp(), tokenHash: sha(token) });
            sent++;
          } catch (e) {
            await r.ref.update({ status: 'failed', error: String(e?.message || e).slice(0, 300) });
            failed++;
          }
        }
      } finally { t.close(); }

      const left = await ref.collection('recipients').where('status', '==', 'queued').count().get();
      const remaining = left.data().count;
      await ref.update({
        'counts.sent': FieldValue.increment(sent),
        'counts.failed': FieldValue.increment(failed),
        leaseUntil: 0,
        ...(remaining === 0 ? { status: 'sent', sentAt: FieldValue.serverTimestamp() } : {}),
      });
      return { done: remaining === 0, sent, failed, remaining };
    }

    case 'campaign.stop': {
      const { ref, c } = await loadCampaign(data.id);
      if (c.status !== 'sending') return { ok: true };
      await ref.update({ status: 'stopped', stoppedAt: FieldValue.serverTimestamp(), leaseUntil: 0 });
      await audit('email_campaign_stop', { type: 'email_campaign', id: data.id }, null);
      return { ok: true };
    }

    case 'campaign.resume': {
      await requireFreshStepUp(uid);
      const { ref, c } = await loadCampaign(data.id);
      if (c.status !== 'stopped') throw new HttpsError('failed-precondition', 'Only a stopped send can resume.');
      await ref.update({ status: 'sending', leaseUntil: 0 });
      return { ok: true };
    }

    case 'campaign.duplicate': {
      const { c } = await loadCampaign(data.id);
      const ref = await db.collection(COL).add({
        ...designOf(c), name: ((c.name || c.subject) + ' (copy)').slice(0, 80),
        audience: c.audience || { mode: 'all', segments: [], uids: [] },
        pickedPeople: c.pickedPeople || [],
        status: 'draft', counts: { total: 0, sent: 0, failed: 0 },
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), createdBy: uid,
      });
      return { id: ref.id };
    }

    default:
      throw new HttpsError('invalid-argument', 'Unknown operation.');
  }
}

/**
 * The unsubscribe link. No sign-in: it is opened from an inbox. The token is
 * random per email and only its hash is stored, so a guessed uid cannot
 * unsubscribe anyone. Never returns the address.
 */
async function handleUnsubscribe(data) {
  const cid = String(data.c || ''); const uid = String(data.u || ''); const token = String(data.t || '');
  if (!cid || !uid || cid.length > 64 || uid.length > 128 || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
    throw new HttpsError('invalid-argument', 'This link is not valid.');
  }
  const r = await db.collection(COL).doc(cid).collection('recipients').doc(uid).get();
  if (!r.exists || !r.data().tokenHash || r.data().tokenHash !== sha(token)) {
    throw new HttpsError('permission-denied', 'This link is not valid.');
  }
  const optOut = data.op !== 'resubscribe';
  await db.collection('users').doc(uid).set({ emailOptOut: optOut }, { merge: true });
  await r.ref.update({ unsubscribed: optOut });
  return { ok: true, optedOut: optOut };
}

module.exports = { handleCampaignOp, handleUnsubscribe, SEGMENTS };
