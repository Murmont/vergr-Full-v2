// chatCrypto — per-user X25519 keypair + authenticated box encryption for DMs.
//
// SUPERSEDED (2026-06-12, founder decision — docs/HANDOFF_CHAT_SERVER_STORE.md):
// DMs are NO LONGER end-to-end encrypted. The product moved to the Telegram
// cloud model — bodies are stored server-side (SQLite, infra/chat/store.go) so
// history survives reinstall on any device. E2E is parked (incompatible with
// cloud history). This module is now DEAD CODE: its only importer
// (chatSendOneOff.js) is itself unused. Kept for reference / a possible future
// "secret chat" mode. Do NOT wire it back into the live send path without
// revisiting the storage decision.
//
// PRIMITIVE: nacl.box (Curve25519 + XSalsa20 + Poly1305) — authenticated, so
// the recipient knows the sender's identity. Random 24-byte nonce per message.
// Wire format (base64): `<nonce(24)><ciphertext>` concatenated and b64-encoded.
//
// MULTI-DEVICE / REINSTALL POLICY (single-keypair-per-user):
//   - On first chat session ever, generate a keypair, store privkey in
//     IndexedDB, publish pubkey to users/{uid}.chatPubKey.
//   - On a new device with no privkey but the user already has a published
//     pubkey, we DO NOT auto-overwrite — we surface a banner in the messages
//     screen prompting "Import your chat backup, or start fresh (loses history)".
//   - Backup export wraps the privkey with a user-chosen passphrase and lets
//     the user restore on a new device. See chatBackup.js (phase 5).
//
// PUBKEY CACHE: recipient pubkeys are cached in Dexie (`chat_pubkeys` table) so
// repeated DMs to the same person don't refetch from Firestore.

import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import Dexie from 'dexie';
import { auth, db } from '../firebase/config';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

const KEY_DB_NAME = 'vergr-keys-v1';

const kdb = new Dexie(KEY_DB_NAME);
kdb.version(1).stores({
  // Local private key — never leaves the device unencrypted.
  keys:    'uid',     // { uid, secretKey:Uint8Array, publicKey:Uint8Array, createdAt:number }
  // Cache of OTHER users' public keys keyed by their uid.
  pubkeys: 'uid',     // { uid, publicKey:Uint8Array, cachedAt:number }
});

const PUBKEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// ============================================================
// Keypair lifecycle
// ============================================================

/** Returns the local user's keypair, generating + publishing it if absent.
 *  Throws if the user isn't signed in. */
export async function ensureKeypair() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('not-signed-in');

  const existing = await kdb.keys.get(uid);
  if (existing?.secretKey && existing?.publicKey) {
    return { publicKey: existing.publicKey, secretKey: existing.secretKey };
  }

  // Before generating fresh, check Firestore: if this user has ALREADY
  // published a pubkey from another device, we DO NOT generate a new one.
  // The caller (UI) should redirect to the import-backup flow.
  const remote = await getRemotePubKey(uid);
  if (remote) {
    const err = new Error('keypair-missing-but-published');
    err.code = 'PUBKEY_PUBLISHED_NO_LOCAL_SECRET';
    throw err;
  }

  const kp = nacl.box.keyPair();
  await kdb.keys.put({
    uid,
    secretKey: kp.secretKey,
    publicKey: kp.publicKey,
    createdAt: Date.now(),
  });
  await publishPubKey(uid, kp.publicKey);
  return kp;
}

/** Forces a fresh keypair, overwriting any existing one + publishing the new
 *  pubkey. ONLY call after explicit user consent ("start fresh, lose history"). */
export async function regenerateKeypair() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('not-signed-in');
  const kp = nacl.box.keyPair();
  await kdb.keys.put({
    uid,
    secretKey: kp.secretKey,
    publicKey: kp.publicKey,
    createdAt: Date.now(),
  });
  await publishPubKey(uid, kp.publicKey);
  // Anything previously cached for this uid is meaningless now.
  await kdb.pubkeys.delete(uid);
  return kp;
}

/** Returns true if a local secret exists for the current user. */
export async function hasLocalKeypair() {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  const row = await kdb.keys.get(uid);
  return !!row?.secretKey;
}

/** Imports a keypair from a restored backup (see chatBackup.js). */
export async function importKeypair(secretKey, publicKey) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('not-signed-in');
  await kdb.keys.put({
    uid,
    secretKey: ensureBytes(secretKey),
    publicKey: ensureBytes(publicKey),
    createdAt: Date.now(),
  });
  // Re-publish in case the remote pubkey diverged (e.g., user nuked + restored).
  await publishPubKey(uid, ensureBytes(publicKey));
}

/** Returns the local secret key bytes for backup export. Caller MUST encrypt
 *  with a passphrase before writing to disk. */
export async function exportLocalKeypair() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('not-signed-in');
  const row = await kdb.keys.get(uid);
  if (!row) throw new Error('no-local-keypair');
  return { secretKey: row.secretKey, publicKey: row.publicKey };
}

// ============================================================
// Pubkey publish + fetch
// ============================================================

async function publishPubKey(uid, publicKeyBytes) {
  const b64 = naclUtil.encodeBase64(publicKeyBytes);
  await setDoc(
    doc(db, 'users', uid),
    { chatPubKey: b64, chatPubKeyAt: serverTimestamp() },
    { merge: true },
  );
}

/** Fetch + cache another user's public key. Returns Uint8Array or null. */
export async function getRecipientPubKey(uid) {
  if (!uid) return null;
  const cached = await kdb.pubkeys.get(uid);
  if (cached && (Date.now() - cached.cachedAt) < PUBKEY_CACHE_TTL_MS) {
    return cached.publicKey;
  }
  const bytes = await getRemotePubKey(uid);
  if (!bytes) return null;
  await kdb.pubkeys.put({ uid, publicKey: bytes, cachedAt: Date.now() });
  return bytes;
}

async function getRemotePubKey(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  const b64 = snap.data()?.chatPubKey;
  if (!b64 || typeof b64 !== 'string') return null;
  try { return naclUtil.decodeBase64(b64); } catch { return null; }
}

/** Manually invalidate a cached pubkey (e.g., recipient rotated keys). */
export async function invalidatePubKeyCache(uid) {
  await kdb.pubkeys.delete(uid);
}

// ============================================================
// Encrypt / decrypt (authenticated, sender-known)
// ============================================================

/** Encrypts `plaintext` (string) for `recipientUid`. Returns a base64 string
 *  packing [nonce(24) || ciphertext]. Throws if recipient has no pubkey
 *  published (UI should show "this user hasn't set up encryption yet"). */
export async function encryptForRecipient(plaintext, recipientUid) {
  if (typeof plaintext !== 'string') plaintext = String(plaintext ?? '');
  const me = await ensureKeypair();
  const theirPub = await getRecipientPubKey(recipientUid);
  if (!theirPub) {
    const err = new Error('recipient-no-pubkey');
    err.code = 'RECIPIENT_NO_PUBKEY';
    throw err;
  }
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const msgBytes = naclUtil.decodeUTF8(plaintext);
  const ct = nacl.box(msgBytes, nonce, theirPub, me.secretKey);
  // Pack nonce || ct
  const packed = new Uint8Array(nonce.length + ct.length);
  packed.set(nonce, 0);
  packed.set(ct, nonce.length);
  return naclUtil.encodeBase64(packed);
}

/** Decrypts a base64 payload from `senderUid`. Returns string, or null on
 *  failure (bad ciphertext / wrong key / sender key rotated). Caller decides
 *  how to surface the failure (we suggest a "couldn't decrypt" placeholder
 *  bubble). */
export async function decryptFromSender(ciphertextB64, senderUid) {
  if (!ciphertextB64 || typeof ciphertextB64 !== 'string') return null;
  try {
    const me = await ensureKeypair();
    const theirPub = await getRecipientPubKey(senderUid);
    if (!theirPub) return null;
    const packed = naclUtil.decodeBase64(ciphertextB64);
    if (packed.length < nacl.box.nonceLength + nacl.box.overheadLength) return null;
    const nonce = packed.slice(0, nacl.box.nonceLength);
    const ct = packed.slice(nacl.box.nonceLength);
    const plain = nacl.box.open(ct, nonce, theirPub, me.secretKey);
    if (!plain) return null;
    return naclUtil.encodeUTF8(plain);
  } catch {
    return null;
  }
}

// ============================================================
// Helpers
// ============================================================

function ensureBytes(x) {
  if (x instanceof Uint8Array) return x;
  if (Array.isArray(x)) return new Uint8Array(x);
  if (typeof x === 'string') return naclUtil.decodeBase64(x);
  throw new Error('unsupported-key-format');
}

/** Wipe local keypair + pubkey cache. ONLY call on full account-delete or
 *  explicit "start fresh on this device". */
export async function wipeLocalCrypto() {
  await kdb.keys.clear();
  await kdb.pubkeys.clear();
}
