// Payout verification (identity Level 2 / Level 3), client side.
// Server: functions/payoutVerification.js. The DOC_TYPES keys and the file
// limits MIRROR that file; scripts/mercury-payouts-check.mjs fails on drift.

import { ref, uploadBytes } from 'firebase/storage';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { storage, db } from '../firebase/config';

export const MAX_FILES = 3;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

/** What each level asks for, and what counts. Keys mirror the server. */
export const DOC_TYPES = {
  2: [
    { key: 'utility_bill',      label: 'Utility bill' },
    { key: 'bank_statement',    label: 'Bank statement' },
    { key: 'government_letter', label: 'Letter from a government office' },
    { key: 'tax_document',      label: 'Tax document' },
  ],
  3: [
    { key: 'bank_statements',  label: 'Bank statements' },
    { key: 'payslips',         label: 'Payslips' },
    { key: 'tax_return',       label: 'Tax return' },
    { key: 'business_records', label: 'Business records' },
  ],
};

export const LEVEL_ASK = {
  2: {
    title: 'Proof of address',
    body: 'A document from the last 3 months showing your name and home address.',
  },
  3: {
    title: 'Source of funds',
    body: 'Documents showing where your money comes from, in your name.',
  },
};

/** Creator-facing copy for a rejection. Keys mirror REJECT_REASONS on the server. */
export const REJECT_COPY = {
  unreadable: 'We could not read your document.',
  too_old: 'Your document is older than 3 months.',
  name_mismatch: 'The name on your document does not match your verified identity.',
  address_missing: 'Your document does not show your address.',
  wrong_document: 'That is not one of the accepted document types.',
  other: 'Your document could not be accepted.',
};

const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Null if the files are acceptable, else a message to show. */
export function fileProblem(files) {
  const list = Array.from(files || []);
  if (!list.length) return 'Choose at least one file.';
  if (list.length > MAX_FILES) return `Up to ${MAX_FILES} files.`;
  for (const f of list) {
    if (!ALLOWED_TYPES.includes(f.type)) return `${f.name} is not a PDF, JPG, PNG or WebP file.`;
    if (f.size >= MAX_FILE_BYTES) return `${f.name} is larger than 5 MB.`;
  }
  return null;
}

/**
 * Upload the documents, then file the request. Uploads first, so a request never
 * points at a file that is not there. Documents are not compressed: a
 * recompressed bill can become unreadable, which is the commonest rejection.
 */
export async function submitPayoutVerification(uid, { targetLevel, docType, files }) {
  const problem = fileProblem(files);
  if (problem) throw new Error(problem);
  const stamp = Date.now();
  const refs = [];
  let i = 0;
  for (const f of Array.from(files)) {
    const path = `upgrade-docs/${uid}/${stamp}-${i}.${EXT[f.type]}`;
    await uploadBytes(ref(storage, path), f, { contentType: f.type });
    refs.push({ path, contentType: f.type, size: f.size, name: String(f.name || '').slice(0, 80) });
    i += 1;
  }
  await setDoc(doc(db, 'kyc_upgrades', uid), {
    uid, targetLevel, docType, files: refs, status: 'pending', submittedAt: serverTimestamp(),
  });
}
