// Editable email templates (founder decision D3: no bulk email, but the emails
// we already send must be editable).
//
// WHAT ACTUALLY EXISTS, so nobody assumes more than there is:
//
//   verification    OURS. functions/emailVerification.js over Spacemail SMTP.
//                   Was hardcoded HTML; now renders from here.
//   password_reset  FIREBASE'S today. Taking it over means generating the link
//                   ourselves; the template is ready for that.
//   welcome         DID NOT EXIST. The "Welcome to Vergr" was an in-app
//                   notification, never an email.
//
// TWO RULES THIS FILE ENFORCES
//
// 1. A BAD EDIT MUST NEVER BREAK A TRANSACTIONAL EMAIL. Every template has a
//    shipped default in code, and rendering falls back to it whenever the stored
//    document is missing, malformed or renders empty. Somebody must always be
//    able to receive a verification code, whatever has been typed in the admin.
//
// 2. PLAIN TEXT IS GENERATED, NOT OPTIONAL. An HTML-only email is a spam signal.
//    Both parts come from the same blocks so they can never drift.
//
// There is deliberately NO video block. Email clients do not play video, and a
// block that implies otherwise lies about what the recipient sees.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { requireAdminScreen } = require('./adminAccess');
const { auditAdminAction, extractRequestMeta, adminRateLimit } = require('./adminSecurity');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;
const SCREEN = 'announcements';
const COL = 'email_templates';

const BLOCK_TYPES = ['heading', 'paragraph', 'code', 'button', 'divider', 'image'];

// ────────────────────────────────────────────────────────────────────
// SHIPPED DEFAULTS
// ────────────────────────────────────────────────────────────────────
// These are the safety net. They live in code, not in Firestore, precisely so
// that deleting or corrupting a document cannot stop an email going out.

const DEFAULTS = {
  verification: {
    name: 'Email verification code',
    description: 'Sent when someone verifies their email address.',
    subject: 'Your Vergr code: {{code}}',
    preheader: 'Your verification code expires in 10 minutes.',
    blocks: [
      { type: 'heading', text: 'Hey {{name}},' },
      { type: 'paragraph', text: 'Use this code to verify your email and secure your Vergr account.' },
      { type: 'code', text: '{{code}}' },
      { type: 'paragraph', text: 'This code expires in 10 minutes.', muted: true, align: 'center' },
      { type: 'paragraph', text: "If you didn't create a Vergr account, you can ignore this email.", muted: true, align: 'center' },
    ],
    tokens: ['name', 'code'],
  },
  password_reset: {
    name: 'Password reset',
    description: 'Sent when someone asks to reset their password.',
    subject: 'Reset your Vergr password',
    preheader: 'Use this link to set a new password.',
    blocks: [
      { type: 'heading', text: 'Hey {{name}},' },
      { type: 'paragraph', text: 'Someone asked to reset the password on your Vergr account. Tap the button to set a new one.' },
      { type: 'button', text: 'Set a new password', url: '{{resetLink}}' },
      { type: 'paragraph', text: 'This link expires in one hour and can only be used once.', muted: true },
      { type: 'paragraph', text: "If this wasn't you, ignore this email. Your password will not change.", muted: true },
    ],
    tokens: ['name', 'resetLink'],
  },
  welcome: {
    name: 'Welcome',
    description: 'Sent once, after someone finishes creating their account.',
    subject: 'Welcome to Vergr, {{name}}',
    preheader: 'Here is how to get started.',
    blocks: [
      { type: 'heading', text: 'Welcome, {{name}}' },
      { type: 'paragraph', text: 'Vergr is where gamers and creators stream, post and build an audience. Here is the quickest way in.' },
      { type: 'paragraph', text: 'Follow a few creators so your feed has something in it, then post your first clip.' },
      { type: 'button', text: 'Open Vergr', url: 'https://vergr.app' },
    ],
    tokens: ['name'],
  },
};

// ────────────────────────────────────────────────────────────────────
// RENDERING
// ────────────────────────────────────────────────────────────────────

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Substitute {{token}} values.
 *
 * The replacement is a FUNCTION on purpose: String.replace treats `$$`, `$&` and
 * `$1` in a replacement string as escapes, so a value containing a dollar sign
 * (a price, in an email about a coin sale) would be silently mangled.
 */
function fill(text, vars) {
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (
    Object.prototype.hasOwnProperty.call(vars || {}, k) ? String(vars[k]) : ''
  ));
}

/** One block as an email-safe table row. Inline styles only; clients strip <style>. */
function renderBlock(b, vars) {
  const F = "font-family:'Segoe UI',Arial,sans-serif";
  const align = b.align === 'center' ? 'center' : 'left';
  switch (b.type) {
    case 'heading':
      return `<tr><td style="padding:0 0 8px;${F};font-size:18px;font-weight:700;color:#ffffff;text-align:${align};">${esc(fill(b.text, vars))}</td></tr>`;
    case 'paragraph':
      return `<tr><td style="padding:0 0 16px;${F};font-size:${b.muted ? 13 : 15}px;line-height:1.6;color:${b.muted ? '#6B7280' : '#9CA3AF'};text-align:${align};">${esc(fill(b.text, vars))}</td></tr>`;
    case 'code':
      return `<tr><td align="center" style="padding:6px 0 22px;"><div style="display:inline-block;padding:16px 28px;background:rgba(123,31,255,0.14);border:1px solid rgba(180,79,255,0.45);border-radius:14px;font-family:'Courier New',monospace;font-size:34px;font-weight:800;letter-spacing:10px;color:#C87FFF;">${esc(fill(b.text, vars))}</div></td></tr>`;
    case 'button': {
      // A TABLE CELL, not a styled anchor. Outlook ignores padding and
      // background on an <a>, so a "button" built that way renders as bare
      // underlined text for a large share of recipients.
      const url = fill(b.url, vars);
      if (!url) return '';
      return `<tr><td align="center" style="padding:6px 0 22px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#7B1FFF;border-radius:12px;"><a href="${esc(url)}" style="display:inline-block;padding:14px 30px;${F};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">${esc(fill(b.text, vars) || 'Open')}</a></td></tr></table></td></tr>`;
    }
    case 'divider':
      return `<tr><td style="padding:6px 0 22px;"><div style="height:1px;background:rgba(255,255,255,0.08);"></div></td></tr>`;
    case 'image': {
      const src = fill(b.url, vars);
      if (!src) return '';
      // Alt text is required, not decorative: a large share of clients block
      // images by default and the alt is all the recipient sees.
      return `<tr><td align="center" style="padding:0 0 20px;"><img src="${esc(src)}" alt="${esc(b.alt || '')}" width="536" style="max-width:100%;height:auto;border-radius:12px;display:block;"></td></tr>`;
    }
    default:
      return '';
  }
}

/** The plain-text alternative, from the SAME blocks, so the two cannot drift. */
function renderText(tpl, vars) {
  const lines = [];
  for (const b of tpl.blocks || []) {
    if (b.type === 'divider') { lines.push('---'); continue; }
    if (b.type === 'image') continue;
    if (b.type === 'button') {
      const url = fill(b.url, vars);
      if (url) lines.push(`${fill(b.text, vars) || 'Open'}: ${url}`);
      continue;
    }
    const t = fill(b.text, vars);
    if (t) lines.push(t);
  }
  lines.push('');
  lines.push('Vergr, Where Gamers Converge');
  lines.push('This is an automated message from noreply@vergr.app, please do not reply.');
  return lines.join('\n\n');
}

function renderHtml(tpl, vars) {
  const body = (tpl.blocks || []).map((b) => renderBlock(b, vars)).join('');
  const preheader = fill(tpl.preheader, vars);
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0B0B14;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0B14;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#14141F;border:1px solid rgba(255,255,255,0.08);border-radius:20px;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#160a33 0%,#2d0a5a 55%,#3a0a6e 100%);padding:34px 32px 28px;text-align:center;">
          <img src="https://vergr.app/icons/icon-192-v2.png" width="52" height="52" alt="Vergr" style="border-radius:12px;display:block;margin:0 auto 12px;">
          <div style="font-family:'Segoe UI',Arial,sans-serif;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">VERGR</div>
        </td></tr>
        <tr><td style="padding:32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table></td></tr>
        <tr><td style="padding:18px 32px 26px;border-top:1px solid rgba(255,255,255,0.06);font-family:'Segoe UI',Arial,sans-serif;">
          <p style="margin:0;font-size:11px;color:#6B7280;text-align:center;">&copy; 2026 Vergr &middot; Where Gamers Converge<br>This is an automated message from noreply@vergr.app, please don't reply.</p>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

/**
 * Render a template by id.
 *
 * NEVER THROWS and never returns empty. Falls back to the shipped default when
 * the stored document is missing, malformed, or produces no body. A transactional
 * email is not allowed to fail because someone mis-edited it in the admin.
 */
async function renderEmail(templateId, vars = {}) {
  const fallback = DEFAULTS[templateId];
  let tpl = fallback;
  try {
    const snap = await db.collection(COL).doc(templateId).get();
    if (snap.exists) {
      const d = snap.data();
      if (Array.isArray(d.blocks) && d.blocks.length) {
        tpl = { ...fallback, ...d };
      }
    }
  } catch (e) {
    console.warn('renderEmail: falling back to default for', templateId, e?.message || e);
  }
  if (!tpl) return null;

  let html = renderHtml(tpl, vars);
  // A template that renders to a shell with no content is a broken edit. Use
  // the default rather than sending an empty card.
  if (fallback && !(tpl.blocks || []).some((b) => renderBlock(b, vars))) {
    tpl = fallback;
    html = renderHtml(tpl, vars);
  }
  return {
    subject: fill(tpl.subject, vars),
    html,
    text: renderText(tpl, vars),
  };
}

// ────────────────────────────────────────────────────────────────────
// ADMIN
// ────────────────────────────────────────────────────────────────────

exports.adminListEmailTemplates = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminScreen(uid, SCREEN);
    const snap = await db.collection(COL).get();
    const stored = {};
    snap.forEach((d) => { stored[d.id] = d.data(); });

    return {
      // Every known template is listed whether or not it has been edited, so
      // the screen shows what CAN be edited rather than only what has been.
      rows: Object.entries(DEFAULTS).map(([id, def]) => {
        const s = stored[id];
        return {
          templateId: id,
          name: def.name,
          description: def.description,
          tokens: def.tokens,
          edited: !!s,
          version: s?.version || 0,
          updatedAt: s?.updatedAt?.toMillis?.() || null,
          subject: s?.subject ?? def.subject,
          preheader: s?.preheader ?? def.preheader,
          blocks: (Array.isArray(s?.blocks) && s.blocks.length) ? s.blocks : def.blocks,
        };
      }),
      // Stated plainly, because "email is dormant" and "email is broken" look
      // identical from the outside and only one of them needs fixing in code.
      smtpConfigured: !!(process.env.SMTP_USER && process.env.SMTP_USER !== 'placeholder'),
    };
  },
);

exports.adminSaveEmailTemplate = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminScreen(uid, SCREEN);
    await adminRateLimit(uid, 'email_template_save', { perHour: 60, perDay: 200 });

    const { templateId, subject, preheader, blocks } = request.data || {};
    if (!DEFAULTS[templateId]) throw new HttpsError('invalid-argument', 'Unknown template.');
    if (!subject || !String(subject).trim()) {
      throw new HttpsError('invalid-argument', 'The email needs a subject line.');
    }
    if (!Array.isArray(blocks) || !blocks.length) {
      throw new HttpsError('invalid-argument', 'The email needs at least one block.');
    }
    const clean = blocks.slice(0, 30).map((b) => {
      if (!BLOCK_TYPES.includes(b?.type)) throw new HttpsError('invalid-argument', `Unknown block: ${b?.type}`);
      if (b.type === 'image' && !String(b.alt || '').trim()) {
        throw new HttpsError('invalid-argument',
          'An image needs alt text. Most email clients block images by default, so the alt text is what people actually read.');
      }
      return {
        type: b.type,
        text: String(b.text || '').slice(0, 1000),
        url: String(b.url || '').slice(0, 500),
        alt: String(b.alt || '').slice(0, 160),
        muted: b.muted === true,
        align: b.align === 'center' ? 'center' : 'left',
      };
    });

    // A required token that has been deleted would send a code-less code email.
    // Rejected rather than warned about, because the failure is invisible until
    // a real user cannot sign in.
    const required = DEFAULTS[templateId].tokens || [];
    const combined = `${subject} ${clean.map((b) => `${b.text} ${b.url}`).join(' ')}`;
    const missing = required.filter((t) => !combined.includes(`{{${t}}}`));
    // `name` is a nicety; the others carry the entire purpose of the email.
    const critical = missing.filter((t) => t !== 'name');
    if (critical.length) {
      throw new HttpsError('invalid-argument',
        `This email would be useless without {{${critical.join('}}, {{')}}}. Put it back somewhere in the subject or the blocks.`);
    }

    const ref = db.collection(COL).doc(templateId);
    const prior = await ref.get();
    // Keep the previous version so a bad edit can be restored.
    if (prior.exists) {
      await ref.collection('versions').doc(String(prior.data().version || 0)).set(prior.data());
    }
    await ref.set({
      subject: String(subject).slice(0, 200),
      preheader: String(preheader || '').slice(0, 200),
      blocks: clean,
      version: (prior.exists ? (prior.data().version || 0) : 0) + 1,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid,
    }, { merge: true });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid, action: 'email_template_save',
      target: { type: 'email_template', id: templateId },
      before: prior.exists ? { version: prior.data().version || 0 } : null,
      after: { subject: String(subject).slice(0, 120) },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: false, stepUpFresh: false,
    }).catch(() => {});

    return { ok: true };
  },
);

exports.adminResetEmailTemplate = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminScreen(uid, SCREEN);
    const { templateId } = request.data || {};
    if (!DEFAULTS[templateId]) throw new HttpsError('invalid-argument', 'Unknown template.');
    // Deleting the doc IS the reset: rendering falls back to the shipped default.
    await db.collection(COL).doc(templateId).delete();
    return { ok: true, ...DEFAULTS[templateId] };
  },
);

/**
 * Render a template with sample values, for the admin preview.
 *
 * Renders the SUBMITTED draft rather than the saved document, so the preview
 * shows what you are about to save rather than what you saved last time.
 */
exports.adminPreviewEmailTemplate = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminScreen(uid, SCREEN);
    const { templateId, subject, preheader, blocks } = request.data || {};
    const def = DEFAULTS[templateId];
    if (!def) throw new HttpsError('invalid-argument', 'Unknown template.');
    const sample = {
      name: 'Alex', code: '384712',
      resetLink: 'https://vergr.app/reset?token=sample',
    };
    const tpl = {
      ...def,
      subject: subject ?? def.subject,
      preheader: preheader ?? def.preheader,
      blocks: (Array.isArray(blocks) && blocks.length) ? blocks : def.blocks,
    };
    return {
      subject: fill(tpl.subject, sample),
      html: renderHtml(tpl, sample),
      text: renderText(tpl, sample),
    };
  },
);

module.exports.renderEmail = renderEmail;
module.exports.DEFAULTS = DEFAULTS;
module.exports._internal = { fill, renderHtml, renderText, renderBlock, BLOCK_TYPES };
