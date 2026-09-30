// dmNotify — HTTP endpoint called by the vergr-chat relay when a new
// DM / group / squad message is broadcast, so we can fan out FCM pushes to
// offline recipients.
//
// FOUNDER MANDATE (CLAUDE.md): no message body ever lives in Firestore.
// The push payload is DATA-ONLY. For DMs, the relay forwards the original
// ciphertext to us; we add sender display name/avatar + sender pubkey, and
// hand the full bundle to the service worker. The SW decrypts locally using
// the recipient's private key from IndexedDB and renders the real text.
// For groups + squad rooms, text is plaintext (per founder policy on groups),
// so we just relay it.
//
// AUTH: shared secret header `X-Notify-Key` — must match secret DM_NOTIFY_KEY.
//
// ENV on the Hetzner relay box must set:
//   DM_NOTIFY_HOOK=https://europe-west1-vergr-44494.cloudfunctions.net/notifyDmDelivery
//   DM_NOTIFY_KEY=<same value as the Firebase secret DM_NOTIFY_KEY>

const functions = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { defineSecret, defineString } = require('firebase-functions/params');
const { getFirestore } = require('firebase-admin/firestore');

const DM_NOTIFY_KEY = defineSecret('DM_NOTIFY_KEY');
// Huawei Push Kit (HMS) — reaches Huawei devices, which have no FCM. No-op until
// the secrets hold real AppGallery-Connect values (see functions/huaweiPush.js).
const HUAWEI_PUSH_APP_ID = defineString('HUAWEI_PUSH_APP_ID');
const HUAWEI_PUSH_CLIENT_SECRET = defineSecret('HUAWEI_PUSH_CLIENT_SECRET');
const { sendHuaweiPush } = require('./huaweiPush');
const { RANK_BY_ID } = require('./vanguardRanks');

if (admin.apps.length === 0) admin.initializeApp();
const db = getFirestore('vgrdb');

// Tiny TTL cache for sender profiles + pubkeys (saves a couple Firestore reads
// per chat burst). Keyed by uid.
const senderCache = new Map();
const SENDER_CACHE_TTL = 60_000;

async function getSenderProfile(uid) {
  const cached = senderCache.get(uid);
  if (cached && (Date.now() - cached.cachedAt) < SENDER_CACHE_TTL) return cached.value;
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return { uid };
  const d = snap.data() || {};
  // Vanguard identity mask at WRITE time: an active Vanguard's push must
  // carry the rank persona, never their real name/avatar. (The old
  // d.vanguardRank read was a dead field — rank lives at d.vanguard.rank.)
  const vg = d.vanguard || {};
  const vgActive = !!(vg.rank && vg.status !== 'retired' && vg.status !== 'suspended');
  const persona = vgActive ? (RANK_BY_ID[vg.rank] || null) : null;
  const val = {
    uid,
    displayName: persona ? persona.usernameTag : (d.displayName || d.username || 'Anonymous'),
    // Real username stays: it is ONLY used internally for @mention matching
    // (never sent in a push payload), and masking it would break the
    // mention-punches-through-mute path for Vanguard recipients.
    username: d.username || '',
    // Persona pushes send NO avatar — the client falls back to a plain circle,
    // which is safer than shipping the real face.
    avatar: persona ? '' : (d.avatar || ''),
    chatPubKey: d.chatPubKey || '',
    vanguardRank: persona ? vg.rank : '',
    vanguardAlias: persona ? persona.usernameTag : '',
  };
  senderCache.set(uid, { value: val, cachedAt: Date.now() });
  return val;
}

function asArray(x) { return Array.isArray(x) ? x : []; }

// Per-user mute map cache (conversations/{id}.muted.{uid} = true | untilMs;
// legacy data may be a plain boolean which the old UI applied to BOTH sides —
// honour it for both until the user rewrites it via the new toggle).
const muteCache = new Map();
const MUTE_CACHE_TTL = 60_000;

async function getMutedMap(convoId) {
  const cached = muteCache.get(convoId);
  if (cached && (Date.now() - cached.cachedAt) < MUTE_CACHE_TTL) return cached.value;
  let value = null;
  try {
    const snap = await db.collection('conversations').doc(convoId).get();
    value = snap.exists ? (snap.data().muted ?? null) : null;
  } catch { value = null; }
  muteCache.set(convoId, { value, cachedAt: Date.now() });
  return value;
}

function isMutedFor(mutedVal, uid) {
  if (mutedVal == null) return false;
  // Legacy shared boolean: could have been set by EITHER participant (the old
  // bug), so it must never suppress someone else's pushes. Display-only.
  if (typeof mutedVal === 'boolean') return false;
  const v = mutedVal[uid];
  if (v === true) return true;
  if (typeof v === 'number') return v > Date.now();
  return false;
}

exports.notifyDmDelivery = functions.https.onRequest(
  { secrets: [DM_NOTIFY_KEY, HUAWEI_PUSH_CLIENT_SECRET], cors: false, region: 'europe-west1' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('method'); return; }
    const expected = DM_NOTIFY_KEY.value();
    const got = req.get('X-Notify-Key') || '';
    if (!expected || got !== expected) { res.status(401).send('auth'); return; }

    let body;
    try { body = req.body || {}; } catch { res.status(400).send('bad-json'); return; }

    const {
      convoId, isGroup, isSquad, senderUid, msgId,
      mediaKind, hasMedia, ct, contentUrl,
      members: rawMembers, onlineUids: rawOnline,
      text: groupText, // populated for groups/squads (plaintext)
    } = body;

    if (!convoId || !senderUid || !msgId) {
      res.status(400).send('missing-fields'); return;
    }
    const members = asArray(rawMembers);
    const online = new Set(asArray(rawOnline));
    // Recipients = members minus sender minus anyone already connected to the
    // relay room (they already received the message via WS).
    let recipients = members.filter(u => u && u !== senderUid && !online.has(u));

    // Resolve group @mentions ONCE (groups only, gated on a literal '@'). Drives
    // two things: (a) punching a mention through the recipient's mute, and (b)
    // the inbox @-badge (conversations/{id}.mentions.{uid}) so a mentioned member
    // who is away/offline sees the @ marker on the chat row — group bodies never
    // hit Firestore, so the CF is the only place that can set this.
    const isGroupConvo = isGroup && !isSquad && !String(convoId).startsWith('squad:');
    const mentionText = String(groupText || '');
    const mentionedUids = new Set();
    if (isGroupConvo && mentionText.includes('@')) {
      for (const u of members) {
        if (!u || u === senderUid) continue;
        try {
          const p = await getSenderProfile(u); // cached user read
          const safe = (p.username || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (safe && new RegExp(`@${safe}\\b`, 'i').test(mentionText)) mentionedUids.add(u);
        } catch {/* skip */}
      }
    }

    // Per-user mute: skip pushes for recipients who muted this conversation.
    // EXCEPTION (Telegram behaviour): an @mention of YOUR username punches
    // through the mute in group chats.
    if (recipients.length && isGroupConvo) {
      const mutedVal = await getMutedMap(convoId);
      if (mutedVal != null) {
        const before = recipients.length;
        recipients = recipients.filter(u => !isMutedFor(mutedVal, u) || mentionedUids.has(u));
        if (recipients.length < before) console.log('notifyDmDelivery: muted-suppressed', before - recipients.length, 'for', convoId);
      }
    }

    // Persist the inbox @-badge for every mentioned member (independent of mute /
    // online state — even an online member on another screen should see it). The
    // ChatThreadScreen clears mentions.{uid} when that user opens the chat.
    if (mentionedUids.size) {
      const upd = {};
      for (const u of mentionedUids) upd[`mentions.${u}`] = true;
      try { await db.collection('conversations').doc(convoId).update(upd); }
      catch (e) { console.log('notifyDmDelivery: mention-badge write failed', e?.message || e); }
    }
    if (!recipients.length) { res.status(200).send('no-recipients'); return; }

    let sender = await getSenderProfile(senderUid);

    // SUPPORT MASK, at write time, for the same reason the Vanguard mask above
    // exists: the push must never carry the name or face of the member of staff
    // who answered. A user asking for help should get "Vergr Support", not a
    // notification that looks like a stranger messaging them out of nowhere.
    //
    // Applied here rather than only in the thread UI because a push is the one
    // surface the app does not render, so masking in the client alone would
    // leak the agent's identity on the lock screen.
    if (isGroup) {
      try {
        const cs = await db.collection('conversations').doc(convoId).get();
        const c = cs.exists ? cs.data() : null;
        if (c?.supportThread === true && senderUid !== c.supportUserId) {
          sender = {
            ...sender,
            displayName: c.groupName || 'Support',
            avatar: c.groupAvatar || '',
          };
        }
      } catch { /* unreadable convo: fall through unmasked rather than not push */ }
    }

    // Plaintext preview (v1: no encryption — DMs and groups both ship the
    // text in cleartext through the relay; SW renders it directly).
    const plainText = (groupText || '').toString().slice(0, 240);
    const mediaLabel = ({ image:'📷 Photo', video:'🎬 Video', audio:'🎙 Voice', voice:'🎙 Voice', file:'📎 File', sticker:'Sticker', giphy:'GIF' })[String(mediaKind||'').toLowerCase()] || 'New media';
    const bodyPreview = plainText || (hasMedia ? mediaLabel : 'New message');

    // Build the data payload once — same for all recipients. We set BOTH
    // `title`/`body` (so the existing SW generic handler can render the
    // notification with no custom code path) AND the relay-specific fields
    // (in case a custom handler is wired later).
    const data = {
      type: isSquad ? 'squad_relay' : (isGroup ? 'group_relay' : 'dm_relay'),
      title: String(sender.displayName || 'New message'),
      body: bodyPreview,
      displayName: String(sender.displayName || ''),
      senderAvatar: String(sender.avatar || ''),
      convoId: String(convoId),
      chatId: String(convoId),   // SW notification-click handler reads this
      msgId: String(msgId),
      senderUid: String(senderUid),
      senderId: String(senderUid),
      isGroup: isGroup ? '1' : '0',
      isSquad: isSquad ? '1' : '0',
      hasMedia: hasMedia ? '1' : '0',
      mediaKind: String(mediaKind || ''),
    };
    // Photo preview: for image-type messages pass the CDN url so the native
    // notification can render the actual picture (BigPictureStyle). Only image
    // kinds (a clip's contentUrl is its poster image); videos/files skip it.
    const IMG_KINDS = new Set(['image', 'giphy', 'sticker', 'meme', 'clip']);
    if (contentUrl && IMG_KINDS.has(String(mediaKind || '').toLowerCase())) {
      data.mediaImageUrl = String(contentUrl);
    }
    if (!isGroup && !isSquad && ct) {
      // Reserved for future encrypted path — not used in v1.
      data.ct = String(ct);
    }

    // Resolve FCM tokens per recipient. The client (src/utils/pushNotifications.js)
    // writes tokens to users/{uid}/private/fcm.tokens[] — NOT the top-level user doc.
    // NOTE: message notifications deliver ALWAYS here (original behaviour restored).
    // A previous attempt to gate DMs on notification-settings toggles broke message
    // pushes, so suppression is removed. The per-category DM/squad opt-out will be
    // re-added only after it is verified against real settings data. Diagnostic
    // logging kept so any future "no notification" report is traceable.
    const tokensByUid = await Promise.all(recipients.map(async (uid) => {
      try {
        const snap = await db.collection('users').doc(uid).collection('private').doc('fcm').get();
        const d = snap.exists ? (snap.data() || {}) : {};
        const t = d.tokens || [];
        const h = d.hmsTokens || [];   // Huawei (HMS) tokens
        if (!t.length && !h.length) console.log('notifyDmDelivery: no push token for', uid);
        return { uid, tokens: Array.isArray(t) ? t : [], hmsTokens: Array.isArray(h) ? h : [] };
      } catch (e) {
        console.error('notifyDmDelivery: token resolve failed', uid, e?.message);
        return { uid, tokens: [], hmsTokens: [] };
      }
    }));

    let sent = 0, failed = 0;
    const cleanupByUid = new Map();
    const cleanupHmsByUid = new Map();
    for (const { uid, tokens, hmsTokens } of tokensByUid) {
      if (!tokens.length && !hmsTokens.length) continue;
      // Per-recipient data: also include recipientUid so the SW knows whose
      // private key to use (multiple users may share a device).
      const perRecipient = { ...data, recipientUid: String(uid) };
      if (tokens.length) try {
        // DATA-ONLY push. Do NOT add a top-level `notification`, an
        // `android.notification`, or a `webpush.notification` field here.
        // Reason (see public/firebase-messaging-sw.js design note #1): when a
        // `notification` field is present, Chrome auto-renders the bubble
        // ITSELF — showing the generic "Google Chrome • <site url>" chrome and
        // the browser's default body — and our onBackgroundMessage handler
        // bails (it detects payload.notification and returns to avoid a
        // duplicate). The result is the wrong-looking "Chrome / new message /
        // url" notification. By staying data-only, our service worker is the
        // single source of truth: it renders the VERGR badge, the sender's
        // avatar as the icon, the sender's name as the title, the real message
        // text as the body, and routes the click to /#/chat/<convoId>.
        // (`android`/`apns` blocks are dropped too — these tokens are web/PWA
        // VAPID tokens; native blocks are ignored for them and only risk
        // re-introducing a double-render on a future native client.)
        const resp = await admin.messaging().sendEachForMulticast({
          tokens,
          // DATA-ONLY (no `notification` field) so our SW / native service is the
          // single renderer. `android.priority:'high'` makes FCM deliver the data
          // message to the NATIVE app IMMEDIATELY (wakes it out of Doze) instead
          // of batching it — required for instant-messaging latency. It's ignored
          // by web/VAPID tokens, and `webpush` is ignored by native tokens, so a
          // mixed token array is safe.
          data: perRecipient,
          android: { priority: 'high' },
          webpush: {
            headers: { Urgency: 'high' },
            // fcmOptions.link is only used if the browser (not our SW) handles
            // the click; kept as a correct fallback target (BrowserRouter route).
            // The SW's notificationclick handler is the primary router.
            fcmOptions: {
              link: `https://vergr.app/messages/${data.convoId}`,
            },
          },
        });
        sent += resp.successCount;
        failed += resp.failureCount;
        // Surface stale-token cleanup.
        resp.responses.forEach((r, i) => {
          if (!r.success) {
            const code = r.error?.code || '';
            if (
              code === 'messaging/invalid-registration-token' ||
              code === 'messaging/registration-token-not-registered'
            ) {
              const arr = cleanupByUid.get(uid) || [];
              arr.push(tokens[i]);
              cleanupByUid.set(uid, arr);
            }
          }
        });
      } catch (err) {
        failed += tokens.length;
      }
      // Huawei (HMS) push for this recipient's Huawei devices — isolated from the
      // FCM send above, no-op until the HUAWEI_PUSH_* secrets are real.
      if (hmsTokens.length) {
        try {
          const r = await sendHuaweiPush(hmsTokens, perRecipient);
          sent += r.sent; failed += r.failed;
          if (r.invalidTokens && r.invalidTokens.length) cleanupHmsByUid.set(uid, r.invalidTokens);
        } catch (_) {/* never let HMS affect the response */}
      }
    }

    // Best-effort stale-token pruning at the real path.
    await Promise.all(Array.from(cleanupByUid.entries()).map(async ([uid, dead]) => {
      try {
        await db.collection('users').doc(uid).collection('private').doc('fcm').update({
          tokens: admin.firestore.FieldValue.arrayRemove(...dead),
        });
      } catch {/* ignore */}
    }));
    // Prune dead HMS tokens too.
    await Promise.all(Array.from(cleanupHmsByUid.entries()).map(async ([uid, dead]) => {
      try {
        await db.collection('users').doc(uid).collection('private').doc('fcm').update({
          hmsTokens: admin.firestore.FieldValue.arrayRemove(...dead),
        });
      } catch {/* ignore */}
    }));

    res.status(200).json({ sent, failed, recipients: recipients.length });
  },
);
