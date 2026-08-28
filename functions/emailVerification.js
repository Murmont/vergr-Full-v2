// Email verification via a 6-digit CODE sent from our own domain over
// Spacemail SMTP (support/noreply@vergr.app). We roll our own instead of
// Firebase's built-in verification LINK because the founder wants a branded,
// code-based email — Firebase's template can't be fully designed.
//
// DORMANT until the SMTP secrets hold real values: sendEmailVerificationCode
// throws `email_unconfigured` while SMTP_USER/SMTP_PASS are 'placeholder', and
// the client treats that as "skip verification" so the live app is never
// blocked. Activate by creating a noreply@vergr.app mailbox in Spacemail and
// setting SMTP_USER + SMTP_PASS (see docs/EMAIL_VERIFICATION.md).
//
// Zero added cost: SMTP is included in the existing Spacemail plan; these are
// explicit callables (no per-doc trigger), so they only run when a user asks.

const functions = require('firebase-functions/v2');
const { getFirestore } = require('firebase-admin/firestore');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const emailTemplates = require('./emailTemplates');

const db = getFirestore('vgrdb');

// Real secrets (set via `firebase functions:secrets:set`). HOST/PORT/FROM are
// plain string params with sensible Spacemail defaults so only the mailbox
// login has to be secret.
const SMTP_USER = functions.params.defineSecret('SMTP_USER');
const SMTP_PASS = functions.params.defineSecret('SMTP_PASS');
const SMTP_HOST = functions.params.defineString('SMTP_HOST', { default: 'mail.spacemail.com' });
const SMTP_PORT = functions.params.defineString('SMTP_PORT', { default: '465' });
const SMTP_FROM = functions.params.defineString('SMTP_FROM', { default: 'Vergr <noreply@vergr.app>' });
const EMAIL_SECRETS = [SMTP_USER, SMTP_PASS];

const CODE_TTL_MS = 10 * 60 * 1000;      // code valid for 10 minutes
const RESEND_COOLDOWN_MS = 45 * 1000;    // 1 send / 45s
const MAX_SENDS_PER_HOUR = 6;
const MAX_ATTEMPTS = 5;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const isConfigured = () => {
  const u = SMTP_USER.value(), p = SMTP_PASS.value();
  return !!u && !!p && u !== 'placeholder' && p !== 'placeholder';
};

// Branded HTML email. Table + inline-styles layout for email-client compat;
// dark violet card, the code in a big monospaced pill. The logo is a public
// CDN image with a text fallback if the client blocks images.
function buildEmail(code, name) {
  const safeName = String(name || 'there').replace(/[<>]/g, '');
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0B0B14;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0B14;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#14141F;border:1px solid rgba(255,255,255,0.08);border-radius:20px;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#160a33 0%,#2d0a5a 55%,#3a0a6e 100%);padding:34px 32px 28px;text-align:center;">
          <img src="https://vergr.app/icons/icon-192-v2.png" width="52" height="52" alt="Vergr" style="border-radius:12px;display:block;margin:0 auto 12px;">
          <div style="font-family:'Segoe UI',Arial,sans-serif;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">VERGR</div>
        </td></tr>
        <tr><td style="padding:32px;font-family:'Segoe UI',Arial,sans-serif;">
          <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#ffffff;">Hey ${safeName},</p>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#9CA3AF;">Use this code to verify your email and secure your Vergr account.</p>
          <div style="text-align:center;margin:0 0 22px;">
            <div style="display:inline-block;padding:16px 28px;background:rgba(123,31,255,0.14);border:1px solid rgba(180,79,255,0.45);border-radius:14px;font-family:'Courier New',monospace;font-size:34px;font-weight:800;letter-spacing:10px;color:#C87FFF;">${code}</div>
          </div>
          <p style="margin:0 0 4px;font-size:13px;color:#6B7280;text-align:center;">This code expires in 10 minutes.</p>
          <p style="margin:0;font-size:13px;color:#6B7280;text-align:center;">If you didn't create a Vergr account, you can ignore this email.</p>
        </td></tr>
        <tr><td style="padding:18px 32px 26px;border-top:1px solid rgba(255,255,255,0.06);font-family:'Segoe UI',Arial,sans-serif;">
          <p style="margin:0;font-size:11px;color:#6B7280;text-align:center;">© 2026 Vergr · Where Gamers Converge<br>This is an automated message from noreply@vergr.app — please don't reply.</p>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

exports.sendEmailVerificationCode = functions.https.onCall({ secrets: EMAIL_SECRETS }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  if (!isConfigured()) throw new functions.https.HttpsError('failed-precondition', 'email_unconfigured');

  const email = request.auth.token?.email;
  if (!email) throw new functions.https.HttpsError('failed-precondition', 'This account has no email address.');

  const ref = db.collection('email_verifications').doc(uid);
  const snap = await ref.get();
  const now = Date.now();
  let hourStart = now, sentCountHour = 0;
  if (snap.exists) {
    const d = snap.data();
    if (d.lastSentAt && now - d.lastSentAt < RESEND_COOLDOWN_MS) {
      throw new functions.https.HttpsError('resource-exhausted', 'Please wait a moment before requesting another code.');
    }
    if (d.hourStart && now - d.hourStart < 3600000) {
      hourStart = d.hourStart; sentCountHour = d.sentCountHour || 0;
      if (sentCountHour >= MAX_SENDS_PER_HOUR) {
        throw new functions.https.HttpsError('resource-exhausted', 'Too many codes requested. Try again later.');
      }
    }
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await ref.set({
    codeHash: sha(code), email, expiresAt: now + CODE_TTL_MS, attempts: 0,
    lastSentAt: now, hourStart, sentCountHour: sentCountHour + 1,
  }, { merge: true });

  let name = 'there';
  try { const u = await db.collection('users').doc(uid).get(); name = u.data()?.displayName || u.data()?.username || 'there'; } catch {}

  const port = Number(SMTP_PORT.value() || 465);
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST.value() || 'mail.spacemail.com',
    port, secure: port === 465,
    auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() },
  });
  // Rendered from the editable template (founder decision D3). renderEmail
  // NEVER throws and falls back to its own shipped default, so a bad edit in the
  // admin cannot stop someone verifying their email. `buildEmail` below is kept
  // as a second net for the case where the module itself is unavailable.
  let rendered = null;
  try {
    rendered = await emailTemplates.renderEmail('verification', { name, code });
  } catch (e) {
    console.warn('emailVerification: template render failed, using built-in', e?.message || e);
  }

  await transporter.sendMail({
    from: SMTP_FROM.value() || 'Vergr <noreply@vergr.app>',
    to: email,
    subject: rendered?.subject || `${code} is your Vergr verification code`,
    text: rendered?.text
      || `Hi ${name}, your Vergr verification code is ${code}. It expires in 10 minutes. If you didn't create a Vergr account, ignore this email.`,
    html: rendered?.html || buildEmail(code, name),
  });
  return { sent: true, email };
});

exports.verifyEmailCode = functions.https.onCall({ secrets: EMAIL_SECRETS }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  const code = String(request.data?.code || '').trim();
  if (!/^\d{6}$/.test(code)) throw new functions.https.HttpsError('invalid-argument', 'Enter the 6-digit code.');

  const ref = db.collection('email_verifications').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'No code pending — request a new one.');
  const d = snap.data();
  if (Date.now() > d.expiresAt) { await ref.delete(); throw new functions.https.HttpsError('deadline-exceeded', 'That code expired — request a new one.'); }
  if ((d.attempts || 0) >= MAX_ATTEMPTS) { await ref.delete(); throw new functions.https.HttpsError('resource-exhausted', 'Too many attempts — request a new code.'); }
  if (sha(code) !== d.codeHash) {
    await ref.update({ attempts: (d.attempts || 0) + 1 });
    throw new functions.https.HttpsError('invalid-argument', 'Incorrect code — try again.');
  }
  await db.collection('users').doc(uid).set({ emailVerified: true, emailVerifiedAt: Date.now() }, { merge: true });
  await ref.delete();
  return { verified: true };
});
