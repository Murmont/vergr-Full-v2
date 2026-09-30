// KYC Cloud Functions.
//
// Exports (attached in functions/index.js):
//   reviewKyc({ uid })        — admin-only; decrypts the application, runs
//                               server-side face match, returns plaintext + images
//                               as base64, logs to kyc_audit_log.
//   decideKyc({ uid, decision, reason?, overrideThreshold? }) — admin; sets
//                               status, flips profile.verified on approve,
//                               triggers cleanup of ciphertext.
//   onKycUserDeleted           — auth.onDelete trigger: purges the whole
//                               /verification_applications/{uid} tree + all
//                               kyc-secure/{uid}/ storage objects + audit log.
//
// Private RSA key is fetched from Secret Manager (secret name: kyc-private-key)
// at cold-start, then held in memory for the lifetime of the function instance.

const functions    = require('firebase-functions/v2');
const functionsV1  = require('firebase-functions/v1');
const admin        = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const crypto       = require('crypto');

const db      = getFirestore('vgrdb');
const bucket  = () => admin.storage().bucket();

// ── Secret Manager cache ───────────────────────────────────────────────
let _privateKeyPem = null;
let _secretsClient = null;
async function getPrivateKey() {
  if (_privateKeyPem) return _privateKeyPem;
  if (!_secretsClient) _secretsClient = new SecretManagerServiceClient();
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  const [version] = await _secretsClient.accessSecretVersion({
    name: `projects/${project}/secrets/kyc-private-key/versions/latest`,
  });
  _privateKeyPem = version.payload.data.toString('utf8');
  return _privateKeyPem;
}

// ── Admin check ────────────────────────────────────────────────────────
// ⚠ This used to require users/{uid}.role to be 'admin' or 'moderator'. Since
// 2026-09-20 no account carries role 'admin' and the operator has no users
// document at all, so both callables refused EVERYONE. It is now the same guard
// every Vergr Admin screen uses: the operator, or a sub-admin granted the
// Creators screen, with the operator's 2FA session enforced.
const { requireAdminScreen } = require('./adminAccess');
const payoutVerification = require('./payoutVerification');

async function assertAdmin(auth) {
  if (!auth?.uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
  const access = await requireAdminScreen(auth.uid, 'creators');
  return access.isOperator ? 'operator' : 'admin';
}

// ── Crypto helpers ─────────────────────────────────────────────────────
function b64ToBuf(b64) { return Buffer.from(b64, 'base64'); }

async function unwrapDataKey(wrappedB64) {
  const pem = await getPrivateKey();
  const raw = crypto.privateDecrypt(
    { key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    b64ToBuf(wrappedB64),
  );
  return raw; // 32 bytes AES key
}

function aesGcmDecrypt(keyBuf, ivBuf, ctBuf) {
  // Web Crypto output = ciphertext || authTag (16 bytes tail)
  const tag = ctBuf.slice(ctBuf.length - 16);
  const data = ctBuf.slice(0, ctBuf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, ivBuf);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

// Server-side face re-match is deferred to v2 (pulls in heavy native deps).
// For now the reviewer visually confirms via decrypted images returned by reviewKyc,
// and the client-side euclidean distance is stored on the application record so
// we already auto-route borderline cases to `needsManualReview=true`.

async function writeAudit(actorUid, uid, action, meta = {}) {
  await db.collection('kyc_audit_log').add({
    actorUid, subjectUid: uid, action,
    meta, at: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ── reviewKyc ──────────────────────────────────────────────────────────
exports.reviewKyc = functions.https.onCall({ region: 'europe-west1', memory: '1GiB', timeoutSeconds: 120 }, async (req) => {
  const role = await assertAdmin(req.auth);
  // Payout limit (Level 2 / 3) review. See functions/payoutVerification.js.
  if (req.data?.kind === 'payout_level') {
    if (req.data.list) return payoutVerification.listRequests(req.data.status);
    return payoutVerification.openRequest(req.auth.uid, req.data.uid, req.data.fileIndex);
  }
  // ⚠ LEGACY identity branch below. It needs the Secret Manager secret
  // 'kyc-private-key', which does NOT exist (checked 2026-09-24: 404), so it
  // cannot decrypt anything. Identity verification is Didit.
  const { uid } = req.data || {};
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid required');

  const appSnap = await db.collection('verification_applications').doc(uid).get();
  if (!appSnap.exists) throw new functions.https.HttpsError('not-found', 'No application');
  const app = appSnap.data();

  const piiSnap = await db.collection('verification_applications').doc(uid).collection('private').doc('pii').get();
  if (!piiSnap.exists) throw new functions.https.HttpsError('not-found', 'No PII record');
  const pii = piiSnap.data();

  // Unwrap DK + decrypt PII JSON
  const dk = await unwrapDataKey(pii.wrappedKey);
  const piiPlain = JSON.parse(
    aesGcmDecrypt(dk, b64ToBuf(pii.iv), b64ToBuf(pii.ciphertext)).toString('utf8')
  );

  // Download + decrypt images
  const download = async (ref) => {
    if (!ref) return null;
    const [file] = await bucket().file(ref.path).download();
    return aesGcmDecrypt(dk, b64ToBuf(ref.iv), file);
  };
  const [frontBuf, backBuf, selfieBuf] = await Promise.all([
    download(pii.docs.front), download(pii.docs.back), download(pii.docs.selfie),
  ]);

  await writeAudit(req.auth.uid, uid, 'review_open', { role, clientDistance: app.clientFaceDistance });

  return {
    app,
    pii: piiPlain,
    images: {
      front:  frontBuf  ? `data:image/jpeg;base64,${frontBuf.toString('base64')}`  : null,
      back:   backBuf   ? `data:image/jpeg;base64,${backBuf.toString('base64')}`   : null,
      selfie: selfieBuf ? `data:image/jpeg;base64,${selfieBuf.toString('base64')}` : null,
    },
  };
});

// ── decideKyc ──────────────────────────────────────────────────────────
exports.decideKyc = functions.https.onCall({ region: 'europe-west1' }, async (req) => {
  const role = await assertAdmin(req.auth);
  if (req.data?.kind === 'payout_level') {
    const { uid, decision, reason = null, note = null } = req.data;
    return payoutVerification.decideRequest(req.auth.uid, uid, decision, reason, note);
  }
  const { uid, decision, reason = null, note = null } = req.data || {};
  if (!uid || !['approved', 'rejected'].includes(decision)) {
    throw new functions.https.HttpsError('invalid-argument', 'uid + decision (approved|rejected) required');
  }

  const appRef = db.collection('verification_applications').doc(uid);
  const piiRef = appRef.collection('private').doc('pii');
  const piiSnap = await piiRef.get();
  const docs = piiSnap.exists ? (piiSnap.data().docs || {}) : {};

  await appRef.update({
    status: decision,
    reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewedBy: req.auth.uid,
    rejectionReason: decision === 'rejected' ? (reason || 'Rejected') : null,
    reviewerNote: note,
  });

  if (decision === 'approved') {
    await db.collection('users').doc(uid).update({ verified: true, verifiedAt: admin.firestore.FieldValue.serverTimestamp() });
  }

  // Purge ciphertext immediately on decision — we only needed it for review.
  const purgeOne = async (ref) => {
    if (!ref?.path) return;
    try { await bucket().file(ref.path).delete({ ignoreNotFound: true }); } catch {}
  };
  await Promise.all([purgeOne(docs.front), purgeOne(docs.back), purgeOne(docs.selfie)]);
  try { await piiRef.delete(); } catch {}

  await writeAudit(req.auth.uid, uid, 'decision', { decision, role, reason, note });
  return { ok: true };
});

// ── Account-deletion cleanup (Article 17 — right to erasure) ────────────
// Called from the existing onUserDeleted auth trigger. Exported as a plain
// function so index.js can call it inline after its own cleanup.
async function purgeKycForUser(uid) {
  // Payout-limit documents and the request go too (right to erasure).
  await payoutVerification.purgeForUser(uid).catch(() => {});
  try {
    const appRef = db.collection('verification_applications').doc(uid);
    const piiRef = appRef.collection('private').doc('pii');
    const piiSnap = await piiRef.get();
    const docs = piiSnap.exists ? (piiSnap.data().docs || {}) : {};
    const files = [docs.front?.path, docs.back?.path, docs.selfie?.path].filter(Boolean);
    await Promise.all(files.map(p => bucket().file(p).delete({ ignoreNotFound: true }).catch(() => {})));

    // Also brute-purge the whole kyc-secure/{uid}/ prefix as a safety net
    try {
      const [stragglers] = await bucket().getFiles({ prefix: `kyc-secure/${uid}/` });
      await Promise.all(stragglers.map(f => f.delete({ ignoreNotFound: true }).catch(() => {})));
    } catch {}

    if (piiSnap.exists) await piiRef.delete();
    const appSnap = await appRef.get();
    if (appSnap.exists) await appRef.delete();

    await db.collection('kyc_audit_log').add({
      actorUid: 'system', subjectUid: uid, action: 'erasure',
      meta: { reason: 'user_deleted' },
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error('purgeKycForUser error', uid, e);
  }
}
exports.purgeKycForUser = purgeKycForUser;

// ── Scheduled retention enforcement (belt-and-braces TTL backup) ───────
const defer = (_opts, fn) => fn; // cron-consolidation shim (see index.js cronDaily)
exports.scheduledKycRetention = defer('0 3 * * *', async () => {
  const cutoff = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 90 * 86400 * 1000));
  const snap = await db.collection('verification_applications')
    .where('status', 'in', ['approved', 'rejected'])
    .where('reviewedAt', '<', cutoff)
    .limit(200)
    .get();
  for (const doc of snap.docs) {
    await purgeKycForUser(doc.id);
  }
  console.log(`KYC retention: purged ${snap.size} records older than 90d`);
});
