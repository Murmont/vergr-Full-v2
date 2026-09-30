// Editable email templates, plus the shared renderer the admin email campaigns
// use (functions/emailCampaigns.js). D3 originally ruled out bulk email; the
// founder asked for designed campaigns on 2026-09-30, so they now exist, and
// every campaign carries an unsubscribe link.
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

const BLOCK_TYPES = ['heading', 'paragraph', 'code', 'button', 'chips', 'divider', 'image'];

// Colour themes. SOLID values only (founder design rule): every gradient on the
// hero and the button has a solid bgcolor fallback for Outlook.
const THEMES = {
  violet:   { label: 'Violet',   hero: '#2B0D5E', heroImg: 'radial-gradient(120% 90% at 20% 0%,#5A1FB5 0%,#2B0D5E 55%,#170A33 100%)', eyebrow: '#D9C6FF', sub: '#DCCEFA', btn: '#7B1FFF', btnImg: 'linear-gradient(135deg,#7B1FFF 0%,#A43BFF 100%)', btnText: '#FFFFFF', code: '#221A38', codeText: '#EADCFF', chipText: '#E4DAFB', link: '#B9A3E8' },
  ember:    { label: 'Ember',    hero: '#4A0E1C', heroImg: 'radial-gradient(120% 90% at 20% 0%,#B52A48 0%,#4A0E1C 55%,#22070E 100%)', eyebrow: '#FFC9D3', sub: '#FFD9E0', btn: '#E0304F', btnImg: 'linear-gradient(135deg,#E0304F 0%,#FF6A7F 100%)', btnText: '#FFFFFF', code: '#3A1620', codeText: '#FFD9E0', chipText: '#FFD9E0', link: '#F59AAB' },
  gold:     { label: 'Gold',     hero: '#4A3208', heroImg: 'radial-gradient(120% 90% at 20% 0%,#B9851A 0%,#4A3208 55%,#1F1504 100%)', eyebrow: '#FCE7AE', sub: '#FBEAC2', btn: '#E9A517', btnImg: 'linear-gradient(135deg,#E9A517 0%,#F5C842 100%)', btnText: '#1A1204', code: '#33260C', codeText: '#FCEFB4', chipText: '#FBEAC2', link: '#E8C77A' },
  blue:     { label: 'Blue',     hero: '#0C1F52', heroImg: 'radial-gradient(120% 90% at 20% 0%,#2F61D6 0%,#0C1F52 55%,#061030 100%)', eyebrow: '#C9D8FF', sub: '#D6E1FF', btn: '#3D7FFF', btnImg: 'linear-gradient(135deg,#3D7FFF 0%,#6A9BFF 100%)', btnText: '#FFFFFF', code: '#16223F', codeText: '#D6E1FF', chipText: '#D6E1FF', link: '#9DB7F5' },
  midnight: { label: 'Midnight', hero: '#1A1A2A', heroImg: 'radial-gradient(120% 90% at 20% 0%,#34344F 0%,#1A1A2A 55%,#0E0E17 100%)', eyebrow: '#D0D0E4', sub: '#D8D8EA', btn: '#7B1FFF', btnImg: 'linear-gradient(135deg,#7B1FFF 0%,#A43BFF 100%)', btnText: '#FFFFFF', code: '#22223A', codeText: '#E4E4F4', chipText: '#E4E4F4', link: '#B9A3E8' },
};
const themeOf = (id) => THEMES[id] || THEMES.violet;

/**
 * Validate a design submitted from the admin. Shared by template saves and
 * campaigns so both keep the same fields: the old save path dropped the chips'
 * items and the hero, which silently emptied those blocks.
 */
function cleanDesign(d = {}) {
  const subject = String(d.subject || '').trim();
  if (!subject) throw new HttpsError('invalid-argument', 'The email needs a subject line.');
  if (!Array.isArray(d.blocks) || !d.blocks.length) {
    throw new HttpsError('invalid-argument', 'The email needs at least one block.');
  }
  const blocks = d.blocks.slice(0, 40).map((b) => {
    if (!BLOCK_TYPES.includes(b?.type)) throw new HttpsError('invalid-argument', 'Unknown block: ' + b?.type);
    if (b.type === 'image' && !String(b.alt || '').trim()) {
      throw new HttpsError('invalid-argument',
        'An image needs alt text. Most email clients block images by default, so the alt text is what people actually read.');
    }
    const url = String(b.url || '').trim().slice(0, 500);
    if ((b.type === 'button' || b.type === 'image') && url && !/^(https:\/\/|mailto:|\{\{)/i.test(url)) {
      throw new HttpsError('invalid-argument', 'Links and images must start with https://.');
    }
    return {
      type: b.type,
      text: String(b.text || '').slice(0, 2000),
      url,
      alt: String(b.alt || '').slice(0, 160),
      items: Array.isArray(b.items) ? b.items.slice(0, 4).map((x) => String(x || '').slice(0, 40)) : [],
      muted: b.muted === true,
      align: b.align === 'center' ? 'center' : 'left',
    };
  });
  const hero = d.hero && typeof d.hero === 'object'
    ? { title: String(d.hero.title || '').slice(0, 80), subtitle: String(d.hero.subtitle || '').slice(0, 140) }
    : { title: '', subtitle: '' };
  return {
    subject: subject.slice(0, 200),
    preheader: String(d.preheader || '').slice(0, 200),
    hero,
    theme: THEMES[d.theme] ? d.theme : 'violet',
    blocks,
  };
}

// ────────────────────────────────────────────────────────────────────
// SHIPPED DEFAULTS
// ────────────────────────────────────────────────────────────────────
// These are the safety net. They live in code, not in Firestore, precisely so
// that deleting or corrupting a document cannot stop an email going out.

const DEFAULTS = {
  verification: {
    name: 'Email verification',
    description: 'Sent when someone verifies their email address. One-tap button plus a code.',
    subject: 'Verify your Vergr email',
    preheader: 'One tap and you can post, message and buy on Vergr.',
    hero: { title: 'Verify your email', subtitle: 'One tap and you’re all set.' },
    blocks: [
      { type: 'heading', text: 'Hey {{name}},' },
      { type: 'paragraph', text: 'Confirm this is your email so you can post, message and buy on Vergr. Until then you can still look around.' },
      { type: 'button', text: 'Verify my email', url: '{{verifyLink}}' },
      { type: 'chips', items: ['Post', 'Message', 'Buy'] },
      { type: 'paragraph', text: 'On a different device? Enter this code in the app instead.', muted: true, align: 'center' },
      { type: 'code', text: '{{code}}' },
      { type: 'paragraph', text: 'The button works for 24 hours, the code for 10 minutes.', muted: true, align: 'center' },
      { type: 'paragraph', text: "Didn't sign up for Vergr? You can ignore this email and nothing will happen.", muted: true, align: 'center' },
    ],
    tokens: ['name', 'code', 'verifyLink'],
  },
  receipt: {
    name: 'Purchase receipt',
    description: 'Sent after a purchase is credited to the account.',
    subject: 'Your Vergr receipt: {{item}}',
    preheader: 'Your purchase is on your account.',
    hero: { title: 'Thanks for your purchase', subtitle: 'It’s already on your account.' },
    blocks: [
      { type: 'heading', text: 'Thanks, {{name}}' },
      { type: 'paragraph', text: 'Your purchase went through and is already on your account.' },
      { type: 'paragraph', text: '{{item}}' },
      { type: 'paragraph', text: '{{paidLine}}' },
      { type: 'paragraph', text: 'Order {{orderId}} · {{date}}', muted: true },
      { type: 'paragraph', text: 'Coins are a licence to use Vergr features. They have no cash value and cannot be exchanged for money.', muted: true },
      { type: 'button', text: 'Open Vergr', url: 'https://vergr.app/wallet' },
      { type: 'paragraph', text: 'Questions about this purchase? Email support@vergr.app with the order number.', muted: true },
    ],
    tokens: ['name', 'item', 'paidLine', 'orderId', 'date'],
  },
  refund: {
    name: 'Refund notice',
    description: 'Sent when a purchase is refunded or charged back.',
    subject: 'Your Vergr purchase was refunded',
    preheader: 'A purchase on your account was refunded.',
    hero: { title: 'A purchase was refunded', subtitle: 'Here’s what changed on your account.' },
    blocks: [
      { type: 'heading', text: 'Hey {{name}},' },
      { type: 'paragraph', text: '{{item}} (order {{orderId}}) was {{how}}.' },
      { type: 'paragraph', text: '{{coinsLine}}' },
      { type: 'paragraph', text: 'If you did not ask for this, email support@vergr.app with the order number.', muted: true },
    ],
    tokens: ['name', 'item', 'orderId', 'how', 'coinsLine'],
  },
  password_reset: {
    name: 'Password reset',
    description: 'Sent when someone asks to reset their password.',
    subject: 'Reset your Vergr password',
    preheader: 'Use this link to set a new password.',
    hero: { title: 'Reset your password', subtitle: 'It only takes a moment.' },
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
    hero: { title: 'Welcome to Vergr', subtitle: 'Go live, share clips, hang out.' },
    blocks: [
      { type: 'heading', text: 'Welcome, {{name}}' },
      { type: 'paragraph', text: 'Vergr is where you go live, share clips and hang out with your people in voice chats and DMs, all in one app. Here is the quickest way in.' },
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
function renderBlock(b, vars, th = THEMES.violet) {
  // Email-safe: tables, inline styles, SOLID colours (no rgba washes and no
  // hairline borders: founder design rule). Fonts degrade to system sans.
  const F = "font-family:'DM Sans','Segoe UI',Helvetica,Arial,sans-serif";
  const align = b.align === 'center' ? 'center' : 'left';
  switch (b.type) {
    case 'heading':
      return `<tr><td style="padding:0 0 10px;${F};font-size:19px;line-height:26px;font-weight:700;color:#FFFFFF;text-align:${align};">${esc(fill(b.text, vars))}</td></tr>`;
    case 'paragraph': {
      const t = fill(b.text, vars);
      if (!t) return '';
      return `<tr><td style="padding:0 0 ${b.muted ? 12 : 18}px;${F};font-size:${b.muted ? 13 : 15}px;line-height:${b.muted ? 20 : 24}px;color:${b.muted ? '#7C7C95' : '#C3C3D4'};text-align:${align};">${esc(t).replace(/\n/g, '<br>')}</td></tr>`;
    }
    case 'code':
      return `<tr><td align="center" style="padding:4px 0 22px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="${th.code}" style="background:${th.code};border-radius:16px;padding:18px 26px 18px 38px;font-family:'DM Mono','SFMono-Regular',Menlo,Consolas,monospace;font-size:34px;line-height:40px;font-weight:700;letter-spacing:12px;color:${th.codeText};text-align:center;">${esc(fill(b.text, vars))}</td></tr></table></td></tr>`;
    case 'button': {
      // A TABLE CELL, not a styled anchor. Outlook ignores padding and
      // background on an <a>, so a "button" built that way renders as bare
      // underlined text for a large share of recipients. Full width so it is
      // an easy thumb target; bgcolor is the fallback where gradients fail.
      const url = fill(b.url, vars);
      if (!url) return '';
      return `<tr><td style="padding:6px 0 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="${th.btn}" style="background:${th.btn};background-image:${th.btnImg};border-radius:14px;"><a href="${esc(url)}" style="display:block;padding:17px 24px;${F};font-size:16px;line-height:20px;font-weight:700;color:${th.btnText};text-decoration:none;text-align:center;">${esc(fill(b.text, vars) || 'Open')}</a></td></tr></table></td></tr>`;
    }
    case 'chips': {
      // A row of solid tiles ("what this unlocks"). Up to four.
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 4).map((x) => fill(x, vars)).filter(Boolean);
      if (!items.length) return '';
      const w = Math.floor(100 / items.length);
      const cells = items.map((t, i) => `<td width="${w}%" style="padding:0 ${i === items.length - 1 ? 0 : 8}px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="#1C1C2B" style="background:#1C1C2B;border-radius:12px;padding:12px 6px;${F};font-size:13px;line-height:18px;font-weight:600;color:${th.chipText};text-align:center;">${esc(t)}</td></tr></table></td>`).join('');
      return `<tr><td style="padding:2px 0 26px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table></td></tr>`;
    }
    case 'divider':
      // A band of space, not a rule.
      return '<tr><td style="padding:0 0 22px;font-size:0;line-height:0;">&nbsp;</td></tr>';
    case 'image': {
      const src = fill(b.url, vars);
      if (!src) return '';
      // Alt text is required, not decorative: a large share of clients block
      // images by default and the alt is all the recipient sees.
      return `<tr><td align="center" style="padding:0 0 20px;"><img src="${esc(src)}" alt="${esc(b.alt || '')}" width="480" style="max-width:100%;height:auto;border-radius:14px;display:block;"></td></tr>`;
    }
    default:
      return '';
  }
}

/** The plain-text alternative, from the SAME blocks, so the two cannot drift. */
function renderText(tpl, vars, opts = {}) {
  const lines = [];
  const heroTitle = fill(tpl.hero && tpl.hero.title, vars);
  if (heroTitle) lines.push(heroTitle.toUpperCase());
  for (const b of tpl.blocks || []) {
    if (b.type === 'divider') { lines.push('---'); continue; }
    if (b.type === 'image') continue;
    if (b.type === 'chips') {
      const items = (b.items || []).map((x) => fill(x, vars)).filter(Boolean);
      if (items.length) lines.push(items.join(' · '));
      continue;
    }
    if (b.type === 'button') {
      const url = fill(b.url, vars);
      if (url) lines.push(`${fill(b.text, vars) || 'Open'}: ${url}`);
      continue;
    }
    const t = fill(b.text, vars);
    if (t) lines.push(t);
  }
  lines.push('');
  lines.push('Vergr LLC, 212 N. 2nd St, Ste 100, Richmond, KY 40475, USA');
  lines.push('This is an automated message. Replies are not read; write to support@vergr.app instead.');
  if (opts.unsubscribeUrl) lines.push('Unsubscribe from Vergr emails: ' + opts.unsubscribeUrl);
  return lines.join('\n\n');
}

function renderHtml(tpl, vars, opts = {}) {
  const th = themeOf(tpl.theme);
  const body = (tpl.blocks || []).map((b) => renderBlock(b, vars, th)).join('');
  const unsub = opts.unsubscribeUrl
    ? `<br><br>You're getting this because you have a Vergr account. <a href="${esc(opts.unsubscribeUrl)}" style="color:${th.link};text-decoration:underline;">Unsubscribe</a>`
    : '';
  const preheader = fill(tpl.preheader, vars);
  const heroTitle = fill(tpl.hero && tpl.hero.title, vars);
  const heroSub = fill(tpl.hero && tpl.hero.subtitle, vars);
  const F = "font-family:'DM Sans','Segoe UI',Helvetica,Arial,sans-serif";
  const D = "font-family:'Syne','DM Sans','Segoe UI',Helvetica,Arial,sans-serif";
  const pre = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>`
    : '';
  const title = heroTitle
    ? `<div class="vg-title" style="${D};font-size:30px;line-height:36px;font-weight:800;color:#FFFFFF;margin-top:22px;">${esc(heroTitle)}</div>`
    : '';
  const sub = heroSub
    ? `<div style="${F};font-size:16px;line-height:24px;color:${th.sub};margin-top:8px;">${esc(heroSub)}</div>`
    : '';
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=DM+Mono:wght@500&family=Syne:wght@800&display=swap" rel="stylesheet">
<title>${esc(fill(tpl.subject, vars))}</title>
<style>@media (max-width:620px){.vg-pad{padding-left:24px!important;padding-right:24px!important}.vg-hero{padding:36px 24px 30px!important}.vg-title{font-size:25px!important;line-height:31px!important}}</style>
</head><body style="margin:0;padding:0;background:#08080F;-webkit-text-size-adjust:100%;">
${pre}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#08080F" style="background:#08080F;">
    <tr><td align="center" style="padding:28px 12px 40px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
        <tr><td bgcolor="#14141F" style="background:#14141F;border-radius:24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td class="vg-hero" align="center" bgcolor="${th.hero}" style="background:${th.hero};background-image:${th.heroImg};padding:44px 40px 38px;border-radius:24px 24px 0 0;">
              <img src="https://vergr.app/icons/icon-192-v2.png" width="64" height="64" alt="Vergr" style="display:block;border-radius:18px;margin:0 auto 14px;">
              <div style="${D};font-size:14px;line-height:18px;font-weight:800;letter-spacing:4px;color:${th.eyebrow};text-transform:uppercase;">Vergr</div>
              ${title}
              ${sub}
            </td></tr>
            <tr><td class="vg-pad" style="padding:36px 40px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table></td></tr>
            <tr><td class="vg-pad" bgcolor="#101019" style="background:#101019;padding:22px 40px 26px;border-radius:0 0 24px 24px;${F};font-size:12px;line-height:19px;color:#6E6E86;text-align:center;">
              <a href="https://vergr.app/platform/help" style="color:${th.link};text-decoration:none;">Help centre</a>&nbsp;&middot;&nbsp;<a href="https://vergr.app/platform/privacy" style="color:${th.link};text-decoration:none;">Privacy</a>&nbsp;&middot;&nbsp;<a href="mailto:support@vergr.app" style="color:${th.link};text-decoration:none;">support@vergr.app</a><br>
              Vergr LLC &middot; 212 N. 2nd St, Ste 100, Richmond, KY 40475, USA<br>
              This is an automated message. Replies are not read; write to support@vergr.app instead.${unsub}
            </td></tr>
          </table>
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

// Email campaigns ride THIS callable (op: 'campaign.*') rather than a new Cloud
// Function: a new function is a new Artifact Registry image. SMTP_PASS is bound
// here for test and batch sends; binding a secret adds no secret version.
const SMTP_PASS = functions.params.defineSecret('SMTP_PASS');

exports.adminListEmailTemplates = functions.https.onCall(
  { region: REGION, cors: true, secrets: [SMTP_PASS], timeoutSeconds: 300 },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminScreen(uid, SCREEN);
    const op = String(request.data?.op || '');
    if (op.startsWith('campaign.')) {
      return require('./emailCampaigns').handleCampaignOp(op, request);
    }
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
          hero: s?.hero || def.hero || { title: '', subtitle: '' },
          theme: s?.theme || def.theme || 'violet',
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

    const { templateId } = request.data || {};
    if (!DEFAULTS[templateId]) throw new HttpsError('invalid-argument', 'Unknown template.');
    const design = cleanDesign(request.data || {});
    const { subject } = design;
    const clean = design.blocks;

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
      subject: design.subject,
      preheader: design.preheader,
      hero: design.hero,
      theme: design.theme,
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
    const { templateId, subject, preheader, blocks, hero, theme } = request.data || {};
    const def = DEFAULTS[templateId];
    if (!def) throw new HttpsError('invalid-argument', 'Unknown template.');
    const sample = {
      name: 'Alex', code: '384712',
      resetLink: 'https://vergr.app/reset?token=sample',
      verifyLink: 'https://vergr.app/verify-email',
      item: '1,200 Coins', paidLine: 'Paid $9.99', orderId: 'VG-1042', date: '30 Sep 2026',
      how: 'refunded', coinsLine: '1,200 Coins were removed from your balance.',
    };
    const tpl = {
      ...def,
      subject: subject ?? def.subject,
      preheader: preheader ?? def.preheader,
      hero: hero || def.hero,
      theme: theme || def.theme,
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
module.exports.THEMES = THEMES;
module.exports.cleanDesign = cleanDesign;
module.exports._internal ={ fill, renderHtml, renderText, renderBlock, BLOCK_TYPES };
