// Payout verification: how a creator moves from identity Level 1 to Level 2
// (proof of address) or Level 3 (source of funds). Founder decision 2026-09-24:
// reviewed by a person in Vergr Admin, not a paid provider.
//
// WHY THIS EXISTS. The published levels (AML policy section 2, Identity policy
// section 3, ToS 8.3) cap what a creator is paid per calendar month: Level 1
// $50, Level 2 $2,500, Level 3 $15,000, and the faster payout schedules need
// Level 2. Didit only ever grants Level 1 and nothing wrote Level 2 or 3, so
// those caps and schedules were unreachable.
//
// STORAGE AND PRIVACY.
//   kyc_upgrades/{uid}           the request (creator writes a pending request;
//                                every decision field is server-only)
//   upgrade-docs/{uid}/{file}    the uploaded documents. storage.rules lets the
//                                OWNER create and NOBODY read, not even the owner.
//                                Only the Admin SDK reads them, here.
// Documents are DELETED the moment a decision is made. What is kept is the
// outcome, the document type, the date and the reviewer, which is what the
// Privacy Policy says VERGR retains ("we retain only the result ... and
// limited derived attributes").
//
// NO NEW CLOUD FUNCTION. This module is called from the EXISTING reviewKyc and
// decideKyc callables (functions/kyc.js) with `kind: 'payout_level'`.

const functions = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore('vgrdb');
const bucket = () => admin.storage().bucket();
const HttpsError = functions.https.HttpsError;

/** Mirrors src/utils/payoutVerification.js. The guard fails the build on drift. */
const DOC_TYPES = {
  2: ['utility_bill', 'bank_statement', 'government_letter', 'tax_document'],
  3: ['bank_statements', 'payslips', 'tax_return', 'business_records'],
};
const REJECT_REASONS = ['unreadable', 'too_old', 'name_mismatch', 'address_missing', 'wrong_document', 'other'];
const MAX_FILES = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

/**
 * Pure: is this request something an admin may APPROVE right now?
 * Levels move one step at a time, and only from Level 1 upwards: Level 1 is the
 * Didit identity check and can never be granted by a document upload.
 */
function approvalProblem(request, currentLevel) {
  if (!request) return 'no_request';
  if (request.status !== 'pending') return 'not_pending';
  const target = Number(request.targetLevel);
  if (target !== 2 && target !== 3) return 'bad_target';
  if (Number(currentLevel || 0) !== target - 1) return 'level_changed';
  if (!DOC_TYPES[target].includes(request.docType)) return 'bad_doc_type';
  const files = Array.isArray(request.files) ? request.files : [];
  if (!files.length || files.length > MAX_FILES) return 'bad_files';
  if (!files.every((f) => validFileRef(request.uid, f))) return 'bad_files';
  return null;
}

/** A file ref is only trusted if it points inside this creator's own prefix. */
function validFileRef(uid, f) {
  return !!f && typeof f.path === 'string'
    && f.path.startsWith(`upgrade-docs/${uid}/`)
    && !f.path.includes('..')
    && ALLOWED_TYPES.includes(f.contentType);
}

async function purgeUpgradeFiles(uid) {
  try {
    const [files] = await bucket().getFiles({ prefix: `upgrade-docs/${uid}/` });
    await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true }).catch(() => {})));
    return files.length;
  } catch (e) {
    console.error('[payoutVerification] purge failed', uid, String(e?.message || e).slice(0, 200));
    return 0;
  }
}

async function audit(actorUid, uid, action, meta = {}) {
  await db.collection('kyc_audit_log').add({
    actorUid, subjectUid: uid, action, meta, at: FieldValue.serverTimestamp(),
  });
}

const tsMs = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : null));

/** Admin: list requests by status. Called by reviewKyc({ kind, list: true }). */
async function listRequests(status = 'pending') {
  const allowed = ['pending', 'approved', 'rejected'];
  const s = allowed.includes(status) ? status : 'pending';
  const snap = await db.collection('kyc_upgrades').where('status', '==', s).limit(100).get();
  const rows = await Promise.all(snap.docs.map(async (d) => {
    const r = d.data();
    const u = await db.collection('users').doc(d.id).get();
    const ud = u.exists ? u.data() : {};
    return {
      uid: d.id,
      username: ud.username || null,
      displayName: ud.displayName || null,
      avatar: ud.avatar || ud.photoURL || null,
      kycLevel: Number(ud.kycLevel || 0),
      targetLevel: r.targetLevel,
      docType: r.docType,
      fileCount: Array.isArray(r.files) ? r.files.length : 0,
      submittedAtMs: tsMs(r.submittedAt),
      reviewedAtMs: tsMs(r.reviewedAt),
      rejectionReason: r.rejectionReason || null,
    };
  }));
  rows.sort((a, b) => (a.submittedAtMs || 0) - (b.submittedAtMs || 0));
  return { requests: rows };
}

/**
 * Admin: open one request. Returns the request, the Didit-verified name and
 * country to compare the document against, and ONE file as a data URL
 * (a callable response is capped at 10 MB, and a file is capped at 5 MB).
 */
async function openRequest(actorUid, uid, fileIndex = 0) {
  if (!uid) throw new HttpsError('invalid-argument', 'uid required');
  const [reqSnap, userSnap, kycSnap] = await Promise.all([
    db.collection('kyc_upgrades').doc(uid).get(),
    db.collection('users').doc(uid).get(),
    db.collection('users').doc(uid).collection('private').doc('kyc').get(),
  ]);
  if (!reqSnap.exists) throw new HttpsError('not-found', 'No request');
  const r = reqSnap.data();
  const files = Array.isArray(r.files) ? r.files : [];
  const i = Math.max(0, Math.min(Number(fileIndex) || 0, files.length - 1));
  let file = null;
  if (r.status === 'pending' && files[i] && validFileRef(uid, files[i])) {
    const [buf] = await bucket().file(files[i].path).download();
    file = { index: i, contentType: files[i].contentType, name: files[i].name || null, dataUrl: `data:${files[i].contentType};base64,${buf.toString('base64')}` };
  }
  await audit(actorUid, uid, 'payout_level_review_open', { targetLevel: r.targetLevel, fileIndex: i });
  const priv = kycSnap.exists ? kycSnap.data() : {};
  return {
    request: {
      uid, targetLevel: r.targetLevel, docType: r.docType, status: r.status,
      fileCount: files.length, submittedAtMs: tsMs(r.submittedAt),
    },
    currentLevel: Number(userSnap.exists ? (userSnap.data().kycLevel || 0) : 0),
    verifiedLegalName: priv.legalName || null,
    verifiedCountry: priv.country || null,
    profileCountry: userSnap.exists ? (userSnap.data().country || null) : null,
    file,
  };
}

/** Admin: approve or reject. Files are deleted either way. */
async function decideRequest(actorUid, uid, decision, reasonCode = null, note = null) {
  if (!uid || !['approved', 'rejected'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'uid + decision (approved|rejected) required');
  }
  if (decision === 'rejected' && !REJECT_REASONS.includes(reasonCode)) {
    throw new HttpsError('invalid-argument', `reason must be one of ${REJECT_REASONS.join(', ')}`);
  }
  const reqRef = db.collection('kyc_upgrades').doc(uid);
  const userRef = db.collection('users').doc(uid);

  const result = await db.runTransaction(async (tx) => {
    const [reqSnap, userSnap] = await Promise.all([tx.get(reqRef), tx.get(userRef)]);
    if (!reqSnap.exists) throw new HttpsError('not-found', 'No request');
    const r = { ...reqSnap.data(), uid };
    if (r.status !== 'pending') throw new HttpsError('failed-precondition', 'Already decided');
    const current = Number(userSnap.exists ? (userSnap.data().kycLevel || 0) : 0);
    if (decision === 'approved') {
      const problem = approvalProblem(r, current);
      if (problem) throw new HttpsError('failed-precondition', `Cannot approve: ${problem}`);
      // Only ever RAISES, one level, and only through here.
      tx.update(userRef, { kycLevel: r.targetLevel, kycLevelUpdatedAt: FieldValue.serverTimestamp() });
      tx.set(db.collection('wallets').doc(uid), { kycLevel: r.targetLevel }, { merge: true });
    }
    tx.update(reqRef, {
      status: decision,
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedBy: actorUid,
      rejectionReason: decision === 'rejected' ? reasonCode : null,
      reviewerNote: note ? String(note).slice(0, 500) : null,
      // The file list goes with the files: nothing left points at a document.
      files: [],
    });
    return { targetLevel: r.targetLevel, docType: r.docType, previousLevel: current };
  });

  const purged = await purgeUpgradeFiles(uid);
  await audit(actorUid, uid, 'payout_level_decision', { decision, reasonCode, targetLevel: result.targetLevel, docType: result.docType, filesDeleted: purged });

  const approved = decision === 'approved';
  await db.collection('notifications').add({
    recipientId: uid,
    type: approved ? 'payout_level_approved' : 'payout_level_rejected',
    title: approved ? `Payout limit raised to Level ${result.targetLevel}` : 'Your document was not accepted',
    body: approved
      ? (result.targetLevel === 2
        ? 'You can now be paid up to $2,500 a month, and faster payout schedules are open to you.'
        : 'You can now be paid up to $15,000 a month.')
      : `${REJECT_COPY[reasonCode] || 'It could not be accepted.'} Your document has been deleted. You can upload a new one from your payout settings.`,
    read: false,
    data: { targetLevel: result.targetLevel, reason: reasonCode || null },
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, decision, targetLevel: result.targetLevel, filesDeleted: purged };
}

const REJECT_COPY = {
  unreadable: 'We could not read it.',
  too_old: 'It is older than 3 months.',
  name_mismatch: 'The name on it does not match your verified identity.',
  address_missing: 'It does not show your address.',
  wrong_document: 'It is not one of the accepted document types.',
  other: 'It could not be accepted.',
};

/** Account deletion: remove the request and any documents. */
async function purgeForUser(uid) {
  await purgeUpgradeFiles(uid);
  try { await db.collection('kyc_upgrades').doc(uid).delete(); } catch { /* absent */ }
}

module.exports = {
  DOC_TYPES, REJECT_REASONS, MAX_FILES, MAX_FILE_BYTES, ALLOWED_TYPES,
  approvalProblem, validFileRef,
  listRequests, openRequest, decideRequest, purgeForUser,
};
