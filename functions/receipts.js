// Purchase receipts and refund notices, by email (founder, 2026-09-29).
//
// Sent over the SAME Spacemail mailbox as the verification email, rendered from
// the editable templates `receipt` and `refund` (functions/emailTemplates.js).
//
// ⚠ A RECEIPT MUST NEVER BREAK A PURCHASE. Every export here catches everything
// and returns; the credit has already been committed when these run. A function
// that calls them without SMTP_PASS bound simply sends nothing (logged), which
// is the safe way for a caller to be left out.
//
// Cost, stated rather than buried: one email per credited purchase or refund
// (Spacemail is paid, 500/hour/mailbox), plus for Coda/Codashop orders ONE
// Firestore read of the order to describe it. Nothing is written.

const functions = require('firebase-functions/v2');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const nodemailer = require('nodemailer');

// Resolved on first use, not at load: callers bind RECEIPT_SECRETS at module
// load time, before (in tests and guards) any Firebase app exists.
const db = { collection: (...a) => getFirestore('vgrdb').collection(...a) };

const SMTP_USER = functions.params.defineString('SMTP_USER');
const SMTP_PASS = functions.params.defineSecret('SMTP_PASS');
const SMTP_HOST = functions.params.defineString('SMTP_HOST', { default: 'mail.spacemail.com' });
const SMTP_PORT = functions.params.defineString('SMTP_PORT', { default: '465' });
const SMTP_FROM = functions.params.defineString('SMTP_FROM', { default: 'Vergr <noreply@vergr.app>' });

/** Bind this on any function that sends receipts: `secrets: RECEIPT_SECRETS`. */
const RECEIPT_SECRETS = [SMTP_PASS];

function smtpReady() {
  let u = '', p = '';
  try { u = SMTP_USER.value(); p = SMTP_PASS.value(); } catch { return false; }
  return !!u && !!p && u !== 'placeholder' && p !== 'placeholder';
}

const fmtDate = (ms = Date.now()) => new Date(ms).toUTCString().replace(/:\d\d GMT$/, ' UTC');

async function recipient(uid) {
  const u = await getAuth().getUser(uid).catch(() => null);
  if (!u?.email) return null;
  let name = 'there';
  try {
    const d = (await db.collection('users').doc(uid).get()).data() || {};
    name = d.displayName || d.username || 'there';
  } catch { /* name is cosmetic */ }
  return { email: u.email, name };
}

async function sendTemplate(templateId, to, vars) {
  // Required here, not at load: emailTemplates pulls in the admin modules and
  // Firestore, and callers load this file just to read RECEIPT_SECRETS.
  const r = await require('./emailTemplates').renderEmail(templateId, vars);
  const port = Number(SMTP_PORT.value() || 465);
  const t = nodemailer.createTransport({
    host: SMTP_HOST.value() || 'mail.spacemail.com', port, secure: port === 465,
    auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() },
  });
  await t.sendMail({ from: SMTP_FROM.value() || 'Vergr <noreply@vergr.app>', to, subject: r.subject, text: r.text, html: r.html });
}

const plural = (n, w) => `${Number(n).toLocaleString('en-US')} ${w}${Number(n) === 1 ? '' : 's'}`;

function describeItem({ coins, itemName, tier }) {
  if (tier) return `Vergr ${tier === 'pro' ? 'Pro' : 'Lite'}, one month`;
  if (itemName) return itemName;
  if (coins > 0) return plural(coins, 'coin');
  return 'Your purchase';
}

/**
 * @param {object} p
 *   uid, orderId, method ('Google Play' | 'AppGallery' | 'Coda' | 'Codashop' | ...)
 *   coins | itemName | tier     what was bought
 *   amountText                  e.g. "R 18.99" when we know it; otherwise the store's own receipt has it
 */
async function sendPurchaseReceipt(p) {
  try {
    if (!smtpReady()) { console.log('receipts: SMTP not bound here, receipt skipped', p.orderId || ''); return false; }
    const to = await recipient(p.uid);
    if (!to) return false;
    const paidLine = p.amountText
      ? `Paid ${p.amountText} with ${p.method}.`
      : `Paid through ${p.method}. ${p.method} sends its own receipt with the amount charged.`;
    await sendTemplate('receipt', to.email, {
      name: to.name, item: describeItem(p), paidLine,
      orderId: p.orderId || 'n/a', date: fmtDate(p.atMs),
    });
    return true;
  } catch (e) {
    console.error('receipts: purchase receipt failed', p.orderId || '', e?.message || e);
    return false;
  }
}

/** Receipt for a Coda / Codashop / card order settled by orders.settleOrder. */
async function sendOrderReceipt(collection, referenceId) {
  try {
    if (!smtpReady()) { console.log('receipts: SMTP not bound here, receipt skipped', referenceId); return false; }
    const snap = await db.collection(collection).doc(referenceId).get();
    if (!snap.exists) return false;
    const o = snap.data();
    const method = o.rail === 'codashop' ? 'Codashop' : o.rail === 'coda' ? (o.codaMethod ? `${o.codaMethod} (Coda)` : 'Coda') : 'card';
    const amountText = o.localPrice != null && o.localCurrency ? `${o.localPrice} ${o.localCurrency}`
      : o.amountUSD != null ? `$${Number(o.amountUSD).toFixed(2)}` : null;
    const lines = Array.isArray(o.lines) ? o.lines : [];
    const itemName = o.subscriptionTier ? null
      : lines.length > 1 ? `${lines.length} items` : null;
    return await sendPurchaseReceipt({
      uid: o.uid, orderId: referenceId, method, amountText,
      coins: Number(o.coinsToCredit) || 0, itemName, tier: o.subscriptionTier || null,
    });
  } catch (e) {
    console.error('receipts: order receipt failed', referenceId, e?.message || e);
    return false;
  }
}

/**
 * @param {object} p  uid, orderId, item, how ('refunded by Google Play' | 'charged back by your bank' | ...),
 *                    coinsRemoved, balanceAfter
 */
async function sendRefundNotice(p) {
  try {
    if (!smtpReady()) { console.log('receipts: SMTP not bound here, refund notice skipped', p.orderId || ''); return false; }
    const to = await recipient(p.uid);
    if (!to) return false;
    const coinsLine = p.coinsRemoved > 0
      ? `${plural(p.coinsRemoved, 'coin')} ${p.coinsRemoved === 1 ? 'was' : 'were'} removed from your account. Your balance is now ${Number(p.balanceAfter).toLocaleString('en-US')}${p.balanceAfter < 0 ? ', so your next purchase pays this back first' : ''}.`
      : 'Nothing was removed from your account.';
    await sendTemplate('refund', to.email, {
      name: to.name, item: p.item || 'A purchase', orderId: p.orderId || 'n/a', how: p.how, coinsLine,
    });
    return true;
  } catch (e) {
    console.error('receipts: refund notice failed', p.orderId || '', e?.message || e);
    return false;
  }
}

module.exports = { RECEIPT_SECRETS, sendPurchaseReceipt, sendOrderReceipt, sendRefundNotice };
