// functions/discordClone.js
// Discord-server → Vergr clone (Phase 1: STRUCTURE only).
//
// Lets a Discord server OWNER clone their server's structure into Vergr to
// reduce migration friction. We map:
//   Discord text/announcement channel  → a Vergr GROUP (conversations isGroup)
//   Discord voice/stage channel        → a Vergr VOICE CHANNEL (voice_channels)
// Category names are prefixed onto the group/channel name for organization
// (Vergr has no category container yet).
//
// We CANNOT migrate members — they must re-join via the group invite links
// (see the group invite/join flow). The caller is the sole initial member of
// every cloned group, as owner+admin.
//
// Authorization model (no `guilds` OAuth scope needed): the caller must have
// linked their Discord account (linkedAccounts.discord.id), and that id must
// equal the guild's owner_id (fetched with the bot token). So only the real
// Discord owner can clone, and only after they've added the Vergr bot.
//
// Phase 2 (message import, last 90d default / full-history Pro) is separate and
// writes into the vergr-chat relay store, NOT here.

const functions = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const admin = require('firebase-admin');
const axios = require('axios');

if (admin.apps.length === 0) admin.initializeApp();
const db = getFirestore('vgrdb');

const HttpsError = functions.https.HttpsError;
const REGION = 'europe-west1';

const DISCORD_BOT_TOKEN = defineSecret('DISCORD_BOT_TOKEN');
const DISCORD_CLIENT_ID = defineSecret('DISCORD_CLIENT_ID');

const DISCORD_API = 'https://discord.com/api/v10';
// Bot install permissions: View Channels (1<<10) + Read Message History (1<<16)
// for structure + history pull, plus Send Messages (1<<11) + Embed Links
// (1<<14) so the OWNER can trigger the one-time migration notice (3.2 in the
// growth doc). Still no admin/moderation permissions.
const BOT_PERMISSIONS = (1 << 10) | (1 << 16) | (1 << 11) | (1 << 14); // 84992
const MAX_CHANNELS = 60; // safety cap per clone

// Discord channel types we care about.
const TEXT_TYPES = new Set([0, 5]);       // GUILD_TEXT, GUILD_ANNOUNCEMENT
const VOICE_TYPES = new Set([2, 13]);     // GUILD_VOICE, GUILD_STAGE_VOICE
const CATEGORY_TYPE = 4;

function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');
  return uid;
}

function botInstallUrl() {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) return null;
  return `https://discord.com/oauth2/authorize?client_id=${clientId}` +
    `&scope=bot&permissions=${BOT_PERMISSIONS}`;
}

async function botGet(path) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || token === 'placeholder') {
    throw new HttpsError('failed-precondition', 'discord_bot_unconfigured');
  }
  return axios.get(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bot ${token}` },
    validateStatus: () => true,
  });
}

// Returns whether the bot is configured + the install URL the owner clicks to
// add the bot to their server. Cheap, no Discord call.
exports.getDiscordCloneSetup = functions.https.onCall(
  { region: REGION, cors: true, secrets: [DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID] },
  async (request) => {
    requireAuth(request);
    const token = process.env.DISCORD_BOT_TOKEN;
    return {
      configured: !!token && token !== 'placeholder',
      botInstallUrl: botInstallUrl(),
      botPermissions: BOT_PERMISSIONS,
    };
  }
);

// Clone a guild's structure. args: { guildId }
exports.cloneDiscordServerStructure = functions.https.onCall(
  { region: REGION, cors: true, secrets: [DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID] },
  async (request) => {
    const uid = requireAuth(request);
    const guildId = String(request.data?.guildId || '').trim();
    if (!/^\d{5,25}$/.test(guildId)) {
      throw new HttpsError('invalid-argument', 'Enter a valid Discord server ID.');
    }

    // Caller must have a linked Discord account.
    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const myDiscordId = userData.linkedAccounts?.discord?.id;
    if (!myDiscordId) {
      throw new HttpsError('failed-precondition', 'Link your Discord account first (Settings → Linked Accounts).');
    }

    // Fetch the guild — also tells us if the bot is in the server.
    const guildRes = await botGet(`/guilds/${guildId}`);
    if (guildRes.status === 401 || guildRes.status === 403 || guildRes.status === 404) {
      throw new HttpsError('failed-precondition', JSON.stringify({
        reason: 'bot_not_in_server',
        botInstallUrl: botInstallUrl(),
      }));
    }
    if (guildRes.status !== 200) {
      throw new HttpsError('internal', `Discord error (${guildRes.status}).`);
    }
    const guild = guildRes.data;

    // Authorization: only the Discord server owner may clone it.
    if (String(guild.owner_id) !== String(myDiscordId)) {
      throw new HttpsError('permission-denied', 'Only the Discord server owner can clone this server.');
    }

    // Fetch channels.
    const chRes = await botGet(`/guilds/${guildId}/channels`);
    if (chRes.status !== 200) throw new HttpsError('internal', `Could not read channels (${chRes.status}).`);
    const channels = Array.isArray(chRes.data) ? chRes.data : [];

    // Category id → name, for prefixing.
    const categoryName = {};
    for (const c of channels) {
      if (c.type === CATEGORY_TYPE) categoryName[c.id] = c.name;
    }

    // Order channels by category then position for stable creation order.
    const usable = channels
      .filter(c => TEXT_TYPES.has(c.type) || VOICE_TYPES.has(c.type))
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .slice(0, MAX_CHANNELS);

    const me = {
      name: userData.displayName || userData.username || 'Member',
      avatar: userData.avatar || null,
    };
    const labelFor = (c) => {
      const cat = c.parent_id ? categoryName[c.parent_id] : null;
      return cat ? `${cat} · ${c.name}` : c.name;
    };

    let groups = 0, voiceChannels = 0;
    const groupList = []; // returned so the invite sheet can share each group
    // Batch writes (chunk to stay under the 500-op limit).
    let batch = db.batch();
    let ops = 0;
    const flush = async () => { if (ops > 0) { await batch.commit(); batch = db.batch(); ops = 0; } };

    for (const c of usable) {
      if (TEXT_TYPES.has(c.type)) {
        const ref = db.collection('conversations').doc();
        batch.set(ref, {
          isGroup: true,
          status: 'active',
          visibility: 'private',
          groupName: labelFor(c),
          topic: c.topic || '',
          participants: [uid],
          admins: [uid],
          createdBy: uid,
          metadata: { [uid]: me },
          clonedFrom: { source: 'discord', guildId, guildName: guild.name || null, channelId: c.id },
          lastMessageText: 'Cloned from Discord',
          lastMessageAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        });
        groups++; ops++;
        groupList.push({ id: ref.id, name: labelFor(c) });
      } else if (VOICE_TYPES.has(c.type)) {
        const ref = db.collection('voice_channels').doc();
        batch.set(ref, {
          name: labelFor(c).slice(0, 40),
          ownerId: uid,
          visibility: 'private',
          allowedUserIds: [uid],
          clonedFrom: { source: 'discord', guildId, channelId: c.id },
          createdAt: FieldValue.serverTimestamp(),
        });
        voiceChannels++; ops++;
      }
      if (ops >= 400) await flush();
    }
    await flush();

    return {
      ok: true,
      guildName: guild.name || 'Discord server',
      created: { groups, voiceChannels },
      groupList,
      skipped: Math.max(0, channels.filter(c => TEXT_TYPES.has(c.type) || VOICE_TYPES.has(c.type)).length - usable.length),
    };
  }
);

// ============================================================
// Phase 2: message import (locked scope — 90d default, full history Pro,
// import goes into the vergr-chat RELAY store via the box worker, never
// Firestore). This CF only validates + enqueues a `community_imports` job;
// infra/community-import on box1 does the long-running work (a CF would
// time out and cost money doing it here).
// args: { guildId, fullHistory?, gdprAck }
// ============================================================
exports.importDiscordMessages = functions.https.onCall(
  { region: REGION, cors: true, secrets: [DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID] },
  async (request) => {
    const uid = requireAuth(request);
    const guildId = String(request.data?.guildId || '').trim();
    if (!/^\d{5,25}$/.test(guildId)) {
      throw new HttpsError('invalid-argument', 'Invalid Discord server ID.');
    }
    // GDPR notice must be explicitly acknowledged (imported messages carry
    // other people's names + content; original authors can delete theirs).
    if (request.data?.gdprAck !== true) {
      throw new HttpsError('failed-precondition', 'gdpr_ack_required');
    }

    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const myDiscordId = userData.linkedAccounts?.discord?.id;
    if (!myDiscordId) {
      throw new HttpsError('failed-precondition', 'Link your Discord account first (Settings → Linked Accounts).');
    }

    // Owner check (same model as the clone: bot token reads the guild).
    const guildRes = await botGet(`/guilds/${guildId}`);
    if (guildRes.status !== 200) {
      throw new HttpsError('failed-precondition', JSON.stringify({
        reason: 'bot_not_in_server', botInstallUrl: botInstallUrl(),
      }));
    }
    if (String(guildRes.data.owner_id) !== String(myDiscordId)) {
      throw new HttpsError('permission-denied', 'Only the Discord server owner can import its messages.');
    }

    // Full history is a Pro perk (locked scope). Admin bypasses like every gate.
    const fullHistory = request.data?.fullHistory === true;
    const isAdmin = userData.role === 'admin' || request.auth.token?.email === 'vergenerd@gmail.com';
    const tier = userData.subscription?.tier || 'free';
    if (fullHistory && tier !== 'pro' && !isAdmin) {
      throw new HttpsError('permission-denied', 'full_history_pro_only');
    }

    // The import targets the groups the CLONE created for this guild.
    const groupsSnap = await db.collection('conversations')
      .where('clonedFrom.guildId', '==', guildId)
      .where('createdBy', '==', uid)
      .limit(100).get();
    const channels = [];
    groupsSnap.forEach((d) => {
      const chId = d.data()?.clonedFrom?.channelId;
      if (chId && d.data()?.isGroup) channels.push({ channelId: chId, convoId: d.id });
    });
    if (!channels.length) {
      throw new HttpsError('failed-precondition', 'clone_first');
    }

    // One import per guild at a time.
    const existing = await db.collection('community_imports')
      .where('guildId', '==', guildId)
      .where('status', 'in', ['queued', 'running'])
      .limit(1).get();
    if (!existing.empty) {
      return { ok: true, importId: existing.docs[0].id, alreadyRunning: true };
    }

    const ref = await db.collection('community_imports').add({
      type: 'discord',
      guildId,
      channels,
      requestedBy: uid,
      fullHistory,
      cutoffMs: fullHistory ? 1420070400000 : Date.now() - 90 * 24 * 3600 * 1000,
      status: 'queued',
      progress: {},
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, importId: ref.id, channels: channels.length };
  }
);

// ============================================================
// Invite loops (14_GROWTH_MIGRATION §3)
// ============================================================

async function botPost(path, body) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token || token === 'placeholder') {
    throw new HttpsError('failed-precondition', 'discord_bot_unconfigured');
  }
  return axios.post(`${DISCORD_API}${path}`, body, {
    headers: { Authorization: `Bot ${token}` },
    validateStatus: () => true,
  });
}

// 3.2 — Owner-triggered ONE-TIME migration notice in the source server.
// The bot posts a single rich embed (never DMs members — Discord ToS).
// args: { guildId }
exports.postDiscordMigrationNotice = functions.https.onCall(
  { region: REGION, cors: true, secrets: [DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID] },
  async (request) => {
    const uid = requireAuth(request);
    const guildId = String(request.data?.guildId || '').trim();
    if (!/^\d{5,25}$/.test(guildId)) throw new HttpsError('invalid-argument', 'Invalid server ID.');

    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const myDiscordId = userData.linkedAccounts?.discord?.id;
    if (!myDiscordId) throw new HttpsError('failed-precondition', 'Link your Discord account first.');

    const guildRes = await botGet(`/guilds/${guildId}`);
    if (guildRes.status !== 200) {
      throw new HttpsError('failed-precondition', JSON.stringify({ reason: 'bot_not_in_server', botInstallUrl: botInstallUrl() }));
    }
    if (String(guildRes.data.owner_id) !== String(myDiscordId)) {
      throw new HttpsError('permission-denied', 'Only the server owner can post the migration notice.');
    }

    // Once per guild — a repeated notice is spam.
    const markRef = db.collection('discord_migration_notices').doc(guildId);
    if ((await markRef.get()).exists) {
      throw new HttpsError('already-exists', 'notice_already_posted');
    }

    // The cloned groups become the embed's join links (cap the list so the
    // embed stays under Discord's limits). Ref link pays the owner for every
    // member who signs up through it.
    const groupsSnap = await db.collection('conversations')
      .where('clonedFrom.guildId', '==', guildId)
      .where('createdBy', '==', uid)
      .limit(100).get();
    if (groupsSnap.empty) throw new HttpsError('failed-precondition', 'clone_first');
    const links = [];
    groupsSnap.forEach((d) => {
      if (d.data()?.isGroup) links.push({ name: d.data().groupName || 'group', url: `https://vergr.app/messages/g/${d.id}?ref=${uid}` });
    });
    const listed = links.slice(0, 12);
    const desc = [
      `**${guildRes.data.name || 'This community'}** is moving to Vergr — same channels, same people, new home.`,
      '',
      ...listed.map((l) => `• [${l.name}](${l.url})`),
      links.length > listed.length ? `…and ${links.length - listed.length} more channels.` : '',
    ].filter(Boolean).join('\n');

    // Target channel: the guild's system channel, else the first cloned text
    // channel the bot can see.
    let channelId = guildRes.data.system_channel_id;
    if (!channelId) channelId = groupsSnap.docs[0].data()?.clonedFrom?.channelId;
    if (!channelId) throw new HttpsError('failed-precondition', 'no_target_channel');

    const postRes = await botPost(`/channels/${channelId}/messages`, {
      embeds: [{
        title: 'We\'re moving to Vergr',
        description: desc.slice(0, 4000),
        color: 0x7B1FFF,
        footer: { text: 'Posted by the server owner via Vergr' },
      }],
    });
    if (postRes.status === 403) {
      // Bot installed before Send Messages was added to the install URL.
      throw new HttpsError('failed-precondition', JSON.stringify({ reason: 'bot_needs_reinstall', botInstallUrl: botInstallUrl() }));
    }
    if (postRes.status !== 200) throw new HttpsError('internal', `Discord error (${postRes.status}).`);

    await markRef.set({ postedBy: uid, channelId, postedAt: FieldValue.serverTimestamp() });
    return { ok: true, channelId };
  }
);

// 3.3 — Auto-rejoin: when a user has linked Discord, find cloned communities
// they were a member of (bot confirms membership) and offer one-tap rejoin.
// Negative lookups cached on users/{uid}/private/discordRejoin.
exports.checkDiscordRejoin = functions.https.onCall(
  { region: REGION, cors: true, secrets: [DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID] },
  async (request) => {
    const uid = requireAuth(request);
    const userSnap = await db.collection('users').doc(uid).get();
    const myDiscordId = userSnap.data()?.linkedAccounts?.discord?.id;
    if (!myDiscordId) return { offers: [] };

    const cacheRef = db.collection('users').doc(uid).collection('private').doc('discordRejoin');
    const cache = (await cacheRef.get()).data() || {};
    const now = Date.now();
    // Re-check at most daily (cached negatives included), unless forced by a
    // fresh link (client passes force right after linking).
    if (!request.data?.force && cache.checkedAt && now - cache.checkedAt < 24 * 3600 * 1000) {
      return { offers: cache.offers || [], cached: true };
    }

    // All cloned Discord groups on the platform, grouped by guild.
    const snap = await db.collection('conversations')
      .where('clonedFrom.source', '==', 'discord')
      .limit(500).get();
    const guilds = new Map(); // guildId → { guildName, groups: [{id,name,joined}] }
    snap.forEach((d) => {
      const v = d.data();
      if (!v.isGroup) return;
      const gid = v.clonedFrom?.guildId;
      if (!gid) return;
      let g = guilds.get(gid);
      if (!g) { g = { guildId: gid, guildName: v.clonedFrom?.guildName || 'Discord server', groups: [] }; guilds.set(gid, g); }
      g.groups.push({ id: d.id, name: v.groupName || 'group', joined: (v.participants || []).includes(uid) });
    });

    const offers = [];
    for (const g of guilds.values()) {
      const unjoined = g.groups.filter((x) => !x.joined);
      if (!unjoined.length) continue;
      const memRes = await botGet(`/guilds/${g.guildId}/members/${myDiscordId}`);
      if (memRes.status === 200) {
        offers.push({ guildId: g.guildId, guildName: g.guildName, groups: unjoined.map(({ id, name }) => ({ id, name })) });
      }
      // 404 = not a member, 403 = bot gone — both are negatives, cached below.
    }

    await cacheRef.set({ checkedAt: now, offers }, { merge: true });
    return { offers };
  }
);

// 3.3 — One-tap claim: joins the caller into every cloned group of a guild
// they're verifiably a member of, and queues the imported-message claim so
// their Discord history reattaches to their Vergr account.
exports.claimDiscordRejoin = functions.https.onCall(
  { region: REGION, cors: true, secrets: [DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID] },
  async (request) => {
    const uid = requireAuth(request);
    const guildId = String(request.data?.guildId || '').trim();
    if (!/^\d{5,25}$/.test(guildId)) throw new HttpsError('invalid-argument', 'Invalid server ID.');

    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const myDiscordId = userData.linkedAccounts?.discord?.id;
    if (!myDiscordId) throw new HttpsError('failed-precondition', 'Link your Discord account first.');

    // Server-side membership re-verification — never trust the cached offer.
    const memRes = await botGet(`/guilds/${guildId}/members/${myDiscordId}`);
    if (memRes.status !== 200) {
      throw new HttpsError('permission-denied', 'not_a_member');
    }

    const snap = await db.collection('conversations')
      .where('clonedFrom.guildId', '==', guildId)
      .limit(100).get();
    const me = { name: userData.displayName || userData.username || 'Member', avatar: userData.avatar || null };
    let joined = 0;
    const convoIds = [];
    const batch = db.batch();
    snap.forEach((d) => {
      const v = d.data();
      if (!v.isGroup) return;
      convoIds.push(d.id);
      if ((v.participants || []).includes(uid)) return;
      if ((v.banned || []).includes(uid)) return;
      batch.update(d.ref, {
        participants: FieldValue.arrayUnion(uid),
        [`metadata.${uid}`]: me,
      });
      joined++;
    });
    if (joined > 0) await batch.commit();

    // Reattach their imported Discord messages (worker → relay /internal/claim).
    if (convoIds.length) {
      await db.collection('community_imports').add({
        type: 'claim',
        requestedBy: uid,
        claimUid: uid,
        authorId: `d:${myDiscordId}`,
        convoIds,
        status: 'queued',
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    return { ok: true, joined };
  }
);
