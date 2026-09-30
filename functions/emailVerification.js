// Email verification: REQUIRED since 2026-09-29 (founder). An account whose
// email is not verified can browse but cannot post, comment, message or buy.
//
// The email carries a one-tap "Verify my email" button (a signed link to
// vergr.app/verify-email) plus a 6-digit code as the fallback, sent from our own
// Spacemail mailbox (SMTP_USER in functions/.env, SMTP_PASS secret).
//
// Verified = Firebase Auth's own emailVerified flag, set here with the Admin
// SDK, so it rides every ID token as `email_verified` and firestore.rules, the
// chat relay and checkout read it at no cost. Google sign-ins arrive verified.
//
// Addresses are checked before anything is sent (functions/emailAddressCheck.js):
// shape, common typos, throwaway domains, and whether the domain has a mail server.

const functions = require('firebase-functions/v2');
const { getFirestore } = require('firebase-admin/firestore');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const emailTemplates = require('./emailTemplates');
const { getAuth } = require('firebase-admin/auth');
const { checkEmailAddress } = require('./emailAddressCheck');

const db = getFirestore('vgrdb');

// Real secrets (set via `firebase functions:secrets:set`). HOST/PORT/FROM are
// plain string params with sensible Spacemail defaults so only the mailbox
// login has to be secret.
const SMTP_USER = functions.params.defineString('SMTP_USER');
const SMTP_PASS = functions.params.defineSecret('SMTP_PASS');
const SMTP_HOST = functions.params.defineString('SMTP_HOST', { default: 'mail.spacemail.com' });
const SMTP_PORT = functions.params.defineString('SMTP_PORT', { default: '465' });
const SMTP_FROM = functions.params.defineString('SMTP_FROM', { default: 'Vergr <noreply@vergr.app>' });
const EMAIL_SECRETS = [SMTP_PASS];

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
          <p style="margin:0;font-size:11px;color:#6B7280;text-align:center;">© 2026 Vergr · Go Live. Hang Out. Share the Moment.<br>This is an automated message from noreply@vergr.app — please don't reply.</p>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

// ────────────────────────────────────────────────────────────────────
// Required verification (founder, 2026-09-29): an account whose email is not
// verified cannot post, comment, message or buy. EVERY account is asked,
// existing ones included; Google sign-ins arrive verified by Google.
//
// "Verified" is Firebase Auth's OWN emailVerified flag, set here with the Admin
// SDK. It rides every ID token as `email_verified`, so firestore.rules, the chat
// relay and checkout all read it for FREE (no document read anywhere).
// users/{uid}.emailVerified is kept as a mirror for the admin screens.
//
// Two ways to prove it, same callable:
//   - one tap: the email's "Verify my email" button opens
//     vergr.app/verify-email?u=<uid>&t=<token>, which calls verifyEmailCode
//     with { uid, token }. Works signed out, on any device the email is read on.
//   - the 6-digit code, kept as the fallback.
// ────────────────────────────────────────────────────────────────────

const LINK_TTL_MS = 24 * 60 * 60 * 1000; // a link stays valid for a day

async function markVerified(uid, email) {
  await getAuth().updateUser(uid, { emailVerified: true });
  await db.collection('users').doc(uid).set({ emailVerified: true, emailVerifiedAt: Date.now() }, { merge: true });
  await db.collection('email_verifications').doc(uid).delete().catch(() => {});
  return { verified: true, email };
}

exports.sendEmailVerificationCode = functions.https.onCall({ secrets: EMAIL_SECRETS }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  if (!isConfigured()) throw new functions.https.HttpsError('failed-precondition', 'email_unconfigured');

  // Change the address first ({ newEmail }): an account whose address cannot
  // receive mail could otherwise never verify. The client re-enters the
  // password first (reauthenticateWithCredential), and the server insists the
  // sign-in is under 5 minutes old, because this changes the login email.
  // Password accounts only: a Google account's email is Google's.
  const newEmail = String(request.data?.newEmail || '').trim().toLowerCase();
  if (newEmail) {
    const authTime = Number(request.auth.token?.auth_time || 0) * 1000;
    if (!authTime || Date.now() - authTime > 5 * 60 * 1000) {
      throw new functions.https.HttpsError('failed-precondition', 'requires_recent_login: Enter your password again to change your email.');
    }
    if (request.auth.token?.firebase?.sign_in_provider !== 'password') {
      throw new functions.https.HttpsError('failed-precondition', 'This account signs in with Google, so its email is managed by Google.');
    }
    const ok = await checkEmailAddress(newEmail);
    if (!ok.ok) {
      throw new functions.https.HttpsError('invalid-argument', `email_undeliverable: ${ok.message}`,
        { reason: ok.reason, suggestion: ok.suggestion || null });
    }
    try {
      await getAuth().updateUser(uid, { email: newEmail, emailVerified: false });
    } catch (e) {
      if (e?.code === 'auth/email-already-exists') {
        throw new functions.https.HttpsError('already-exists', 'Another account already uses that email.');
      }
      throw e;
    }
    await db.collection('users').doc(uid).set({ emailVerified: false }, { merge: true });
    // A code or link issued for the old address must not verify the new one.
    await db.collection('email_verifications').doc(uid).delete().catch(() => {});
  }

  return deliverVerificationEmail(uid);
});

/**
 * Send the verification email for one account. Shared by the callable and by
 * one-off operator sends, so both go through identical code.
 * opts.preview: send even to an already-verified account (a design preview;
 * its link then just confirms the account is verified). Rate limits still apply.
 */
async function deliverVerificationEmail(uid, opts = {}) {
  // Read Auth, not the token: the token can be up to an hour stale either way.
  const authUser = await getAuth().getUser(uid);
  const email = authUser.email;
  if (!email) throw new functions.https.HttpsError('failed-precondition', 'This account has no email address.');
  if (authUser.emailVerified && !opts.preview) {
    await db.collection('users').doc(uid).set({ emailVerified: true }, { merge: true });
    return { sent: false, alreadyVerified: true, email };
  }

  // An address that cannot receive mail can never be verified: say so now
  // rather than let someone wait for an email that will never arrive.
  const check = await checkEmailAddress(email);
  if (!check.ok) {
    throw new functions.https.HttpsError('failed-precondition', `email_undeliverable: ${check.message}`,
      { reason: check.reason, suggestion: check.suggestion || null });
  }

  const ref = db.collection('email_verifications').doc(uid);
  const snap = await ref.get();
  const now = Date.now();
  let hourStart = now, sentCountHour = 0;
  if (snap.exists) {
    const d = snap.data();
    if (d.lastSentAt && now - d.lastSentAt < RESEND_COOLDOWN_MS) {
      throw new functions.https.HttpsError('resource-exhausted', 'Please wait a moment before requesting another email.');
    }
    if (d.hourStart && now - d.hourStart < 3600000) {
      hourStart = d.hourStart; sentCountHour = d.sentCountHour || 0;
      if (sentCountHour >= MAX_SENDS_PER_HOUR) {
        throw new functions.https.HttpsError('resource-exhausted', 'Too many emails requested. Try again later.');
      }
    }
  }

  const code = String(crypto.randomInt(100000, 1000000));
  const linkToken = crypto.randomBytes(24).toString('base64url');
  const verifyLink = `https://vergr.app/verify-email?u=${encodeURIComponent(uid)}&t=${linkToken}`;
  await ref.set({
    codeHash: sha(code), linkHash: sha(linkToken), email,
    expiresAt: now + CODE_TTL_MS, linkExpiresAt: now + LINK_TTL_MS, attempts: 0,
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
  // Rendered from the editable template. renderEmail never throws and falls
  // back to the shipped default. A stored template edited before the one-tap
  // link existed would silently drop the button, so a render without the link
  // is replaced by the shipped default, which has it.
  const vars = { name, code, verifyLink };
  let rendered = null;
  try {
    rendered = await emailTemplates.renderEmail('verification', vars);
    if (rendered && !String(rendered.html || '').includes(linkToken)) {
      const t = emailTemplates.DEFAULTS.verification;
      rendered = {
        subject: emailTemplates._internal.fill(t.subject, vars),
        html: emailTemplates._internal.renderHtml(t, vars),
        text: emailTemplates._internal.renderText(t, vars),
      };
    }
  } catch (e) {
    console.warn('emailVerification: template render failed, using built-in', e?.message || e);
  }

  await transporter.sendMail({
    from: SMTP_FROM.value() || 'Vergr <noreply@vergr.app>',
    to: email,
    subject: rendered?.subject || 'Verify your Vergr email',
    text: rendered?.text
      || `Hi ${name}, verify your Vergr email: ${verifyLink}\nOr enter this code: ${code} (expires in 10 minutes). If you did not create a Vergr account, ignore this email.`,
    html: rendered?.html || buildEmail(code, name),
  });
  return { sent: true, email };
}
exports._deliverVerificationEmail = deliverVerificationEmail;

exports.verifyEmailCode = functions.https.onCall({ secrets: EMAIL_SECRETS }, async (request) => {
  const data = request.data || {};

  // Sign-up check, before the account exists (no auth needed): can this
  // address receive mail? Hosted here so no new Cloud Function is needed.
  if (data.op === 'check') {
    return checkEmailAddress(data.email);
  }

  // Campaign unsubscribe link (functions/emailCampaigns.js). Hosted here so no
  // new Cloud Function is needed; it takes a per-email token, not a sign-in.
  if (data.op === 'unsubscribe' || data.op === 'resubscribe') {
    return require('./emailCampaigns').handleUnsubscribe(data);
  }

  // One tap from the email: { uid, token }. No sign-in needed, because the link
  // is often opened on a different device or browser than the app.
  if (data.token) {
    const uid = String(data.uid || '');
    const token = String(data.token || '');
    if (!uid || uid.length > 128 || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
      throw new functions.https.HttpsError('invalid-argument', 'This link is not valid.');
    }
    const snap = await db.collection('email_verifications').doc(uid).get();
    if (!snap.exists) {
      // Already used (the doc is deleted on success) or never sent.
      const u = await getAuth().getUser(uid).catch(() => null);
      // Re-opening a link that was already used. NEVER return the address:
      // anyone can call this with any uid, and emails are private.
      if (u?.emailVerified) return { verified: true };
      throw new functions.https.HttpsError('not-found', 'This link has expired. Request a new one in the app.');
    }
    const d = snap.data();
    if (!d.linkHash || sha(token) !== d.linkHash) throw new functions.https.HttpsError('permission-denied', 'This link is not valid.');
    if (Date.now() > (d.linkExpiresAt || 0)) throw new functions.https.HttpsError('deadline-exceeded', 'This link has expired. Request a new one in the app.');
    const u = await getAuth().getUser(uid);
    if (String(u.email || '').toLowerCase() !== String(d.email || '').toLowerCase()) {
      throw new functions.https.HttpsError('failed-precondition', 'The email on this account has changed. Request a new link.');
    }
    await markVerified(uid, u.email);
    return { verified: true };
  }

  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  const code = String(data.code || '').trim();
  if (!/^\d{6}$/.test(code)) throw new functions.https.HttpsError('invalid-argument', 'Enter the 6-digit code.');

  const ref = db.collection('email_verifications').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'No code pending. Request a new one.');
  const d = snap.data();
  if (Date.now() > d.expiresAt) throw new functions.https.HttpsError('deadline-exceeded', 'That code expired. Request a new one.');
  if ((d.attempts || 0) >= MAX_ATTEMPTS) { await ref.delete(); throw new functions.https.HttpsError('resource-exhausted', 'Too many attempts. Request a new code.'); }
  if (sha(code) !== d.codeHash) {
    await ref.update({ attempts: (d.attempts || 0) + 1 });
    throw new functions.https.HttpsError('invalid-argument', 'Incorrect code. Try again.');
  }
  const u = await getAuth().getUser(uid);
  if (String(u.email || '').toLowerCase() !== String(d.email || '').toLowerCase()) {
    throw new functions.https.HttpsError('failed-precondition', 'The email on this account has changed. Request a new code.');
  }
  return markVerified(uid, u.email);
});
