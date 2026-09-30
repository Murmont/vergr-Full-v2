// WhatsApp group import (14_GROWTH_MIGRATION §2) — enqueue side.
//
// Platform reality: WhatsApp has NO API for groups or member lists. The only
// legitimate path is the Telegram-proven one: the group owner runs WhatsApp's
// own "Export chat" (a .txt), shares/uploads it to Vergr, and we import it.
// No scraping, no automation against WhatsApp.
//
// This CF validates and enqueues a `community_imports` job; the box worker
// (infra/community-import, whatsapp adapter) parses + bulk-inserts into the
// vergr-chat relay store. TEXT-ONLY v1 (founder decision 2026-07-15).
//
// Target: a NEW group named after the export (default) or an existing group
// the caller admins. 90-day default window, full history Pro-gated (same
// locked scope as Discord Phase 2).

const functions = require('firebase-functions/v2');
const { planOf } = require('./plan');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const admin = require('firebase-admin');
const { isStaffDoc } = require('./staff');

if (admin.apps.length === 0) admin.initializeApp();
const db = getFirestore('vgrdb');

const HttpsError = functions.https.HttpsError;
const REGION = 'europe-west1';

// args: { exportKey, groupName?, targetChatId?, fullHistory?, gdprAck }
exports.importWhatsAppExport = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');

    if (request.data?.gdprAck !== true) {
      throw new HttpsError('failed-precondition', 'gdpr_ack_required');
    }
    const exportKey = String(request.data?.exportKey || '');
    // The staging prefix is per-uid — a caller can only import a file THEY
    // uploaded (getImportUploadUrl keys on the caller's uid).
    if (!exportKey.startsWith(`imports/whatsapp/${uid}/`) || !exportKey.endsWith('.txt')) {
      throw new HttpsError('invalid-argument', 'Invalid export file reference.');
    }

    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const isAdmin = isStaffDoc(userData) || userData.role === 'admin';
    const tier = planOf(userData);
    const fullHistory = request.data?.fullHistory === true;
    if (fullHistory && tier !== 'pro' && !isAdmin) {
      throw new HttpsError('permission-denied', 'full_history_pro_only');
    }

    // Resolve the target group.
    let convoId = String(request.data?.targetChatId || '').trim();
    let groupName = String(request.data?.groupName || '').trim().slice(0, 60);
    if (convoId) {
      const convoSnap = await db.collection('conversations').doc(convoId).get();
      if (!convoSnap.exists) throw new HttpsError('not-found', 'Group not found.');
      const c = convoSnap.data();
      const amAdmin = c.createdBy === uid || (Array.isArray(c.admins) && c.admins.includes(uid));
      if (!c.isGroup || !amAdmin) {
        throw new HttpsError('permission-denied', 'You must be an admin of the target group.');
      }
      groupName = c.groupName || groupName;
    } else {
      if (!groupName) throw new HttpsError('invalid-argument', 'Group name required.');
      const me = { name: userData.displayName || userData.username || 'Member', avatar: userData.avatar || null };
      const ref = await db.collection('conversations').add({
        isGroup: true,
        status: 'active',
        visibility: 'private',
        groupName,
        participants: [uid],
        admins: [uid],
        createdBy: uid,
        metadata: { [uid]: me },
        clonedFrom: { source: 'whatsapp' },
        lastMessageText: 'Imported from WhatsApp',
        lastMessageAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      });
      convoId = ref.id;
    }

    // One import per target group at a time.
    const existing = await db.collection('community_imports')
      .where('convoId', '==', convoId)
      .where('status', 'in', ['queued', 'running'])
      .limit(1).get();
    if (!existing.empty) {
      return { ok: true, importId: existing.docs[0].id, convoId, alreadyRunning: true };
    }

    const jobRef = await db.collection('community_imports').add({
      type: 'whatsapp',
      convoId,
      exportKey,
      requestedBy: uid,
      fullHistory,
      cutoffMs: fullHistory ? 946684800000 : Date.now() - 90 * 24 * 3600 * 1000,
      status: 'queued',
      progress: {},
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, importId: jobRef.id, convoId, groupName };
  }
);

// Phone-claim (§2.4): a user with a VERIFIED phone claims the imported
// WhatsApp messages that were authored by that number. Claim is a USER action
// — never automatic (privacy). The worker relays it to the chat store.
// args: { chatId }
exports.claimWhatsAppMessages = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');
    const chatId = String(request.data?.chatId || '').trim();
    if (!chatId) throw new HttpsError('invalid-argument', 'chatId required.');

    const userSnap = await db.collection('users').doc(uid).get();
    const phoneHash = userSnap.data()?.phoneHash;
    if (!phoneHash) {
      throw new HttpsError('failed-precondition', 'verify_phone_first');
    }
    const convoSnap = await db.collection('conversations').doc(chatId).get();
    if (!convoSnap.exists || !(convoSnap.data().participants || []).includes(uid)) {
      throw new HttpsError('permission-denied', 'Join the group first.');
    }

    await db.collection('community_imports').add({
      type: 'claim',
      requestedBy: uid,
      claimUid: uid,
      authorId: `wp:${phoneHash}`,
      convoIds: [chatId],
      status: 'queued',
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  }
);
