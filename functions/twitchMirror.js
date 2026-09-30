// VERGR Twitch mirror — Twitch → Vergr direction.
//
// When a user who has linked Twitch goes live ON TWITCH, this surfaces them as
// a NATIVE-looking Vergr live stream: a `streams/{id}` doc (source:'twitch')
// is created/flipped to `live`, and the viewer renders Twitch's official embed
// inside Vergr's player chrome (Vergr header, chat, tips, LIVE ring, discovery
// all apply). Detection = polling the Twitch Helix API with an app token
// (client-credentials — no per-user scope needed for detection).
//
// This is the legitimate way to put a Twitch broadcast on Vergr: we never pull
// or rehost Twitch's video, we embed their sanctioned player + wrap our UI.
//
// The reverse direction (OBS → Vergr → relay-out to Twitch) lives in
// functions/streaming.js + the Hetzner vergr-rtmp-auth relay.

const functions = require('firebase-functions/v2');
const { defineSecret, defineString } = require('firebase-functions/params');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const axios = require('axios');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const TWITCH_CLIENT_ID = defineString('TWITCH_CLIENT_ID');
const TWITCH_CLIENT_SECRET = defineSecret('TWITCH_CLIENT_SECRET');

// ── Twitch app access token (client-credentials), cached in app_config. ──
async function getAppToken() {
  const ref = db.collection('app_config').doc('twitch_app_token');
  const snap = await ref.get();
  const now = Date.now();
  if (snap.exists) {
    const d = snap.data();
    if (d.token && d.expiresAt && d.expiresAt > now + 60_000) return d.token;
  }
  const res = await axios.post('https://id.twitch.tv/oauth2/token', null, {
    params: {
      client_id: TWITCH_CLIENT_ID.value(),
      client_secret: TWITCH_CLIENT_SECRET.value(),
      grant_type: 'client_credentials',
    },
  });
  const token = res.data?.access_token;
  const expiresIn = res.data?.expires_in || 3600;
  if (!token) throw new Error('no app token');
  await ref.set({ token, expiresAt: now + expiresIn * 1000, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return token;
}

// Resolve which Twitch user_ids are live RIGHT NOW (batched ≤100 per call).
async function fetchLive(userIds, token) {
  const live = new Map(); // twitchUserId -> stream info
  for (let i = 0; i < userIds.length; i += 100) {
    const batch = userIds.slice(i, i + 100);
    const params = new URLSearchParams();
    batch.forEach((id) => params.append('user_id', id));
    const res = await axios.get(`https://api.twitch.tv/helix/streams?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}`, 'Client-Id': TWITCH_CLIENT_ID.value() },
    });
    for (const s of (res.data?.data || [])) {
      live.set(String(s.user_id), s);
    }
  }
  return live;
}

function thumb(url, w = 640, h = 360) {
  if (!url) return null;
  return String(url).replace('{width}', String(w)).replace('{height}', String(h));
}

// Core reconcile: compares Twitch-live set against the Vergr mirror docs and
// creates / ends streams accordingly. Returns a small summary.
async function reconcile() {
  // Users who have Twitch linked + auto-mirror on (set when they connect).
  const usersSnap = await db.collection('users').where('twitchMirrorEnabled', '==', true).limit(500).get();
  const tracked = [];
  usersSnap.forEach((d) => {
    const u = d.data();
    const tw = u.linkedAccounts?.twitch || {};
    if (tw.id) tracked.push({
      uid: d.id,
      twitchUserId: String(tw.id),
      login: (tw.login || '').toLowerCase() || null,
      username: u.username || tw.username || 'Streamer',
      avatar: u.avatar || tw.avatar || null,
    });
  });
  if (tracked.length === 0) return { tracked: 0, live: 0 };

  const token = await getAppToken();
  const liveMap = await fetchLive(tracked.map((t) => t.twitchUserId), token);

  // Currently-live Vergr mirror docs (so we know what to END when Twitch drops).
  const liveDocsSnap = await db.collection('streams')
    .where('source', '==', 'twitch').where('status', '==', 'live').limit(500).get();
  const liveDocByUid = new Map();
  liveDocsSnap.forEach((d) => liveDocByUid.set(d.data().hostUid, d));

  let started = 0, ended = 0;
  for (const t of tracked) {
    const s = liveMap.get(t.twitchUserId);
    const docId = `twitchmirror_${t.uid}`;
    const ref = db.collection('streams').doc(docId);
    if (s) {
      // Live on Twitch → ensure a live Vergr mirror doc exists.
      const existing = liveDocByUid.get(t.uid);
      if (!existing) {
        await ref.set({
          hostUid: t.uid,
          hostUsername: t.username,
          hostAvatar: t.avatar,
          kind: 'public',
          visibility: 'public',
          status: 'live',
          source: 'twitch',
          orientation: 'landscape', // Twitch is 16:9 → Desktop Streams section
          twitchChannel: t.login || s.user_login || null,
          twitchUserId: t.twitchUserId,
          title: s.title || `${t.username} on Twitch`,
          game: s.game_name || null,
          thumbnailUrl: thumb(s.thumbnail_url),
          coverUrl: thumb(s.thumbnail_url),
          viewerCount: s.viewer_count || 0,
          peakViewers: s.viewer_count || 0,
          startedAt: s.started_at ? new Date(s.started_at).getTime() : Date.now(),
          endedAt: null,
          createdAt: FieldValue.serverTimestamp(),
          boosted: false,
        }, { merge: true });
        started++;
      } else {
        // Refresh title/game/viewer count cheaply.
        await existing.ref.update({
          title: s.title || existing.data().title || null,
          game: s.game_name || existing.data().game || null,
          viewerCount: s.viewer_count || 0,
          peakViewers: Math.max(existing.data().peakViewers || 0, s.viewer_count || 0),
          thumbnailUrl: thumb(s.thumbnail_url),
          coverUrl: thumb(s.thumbnail_url),
        });
      }
    } else {
      // Not live on Twitch → end any live mirror doc.
      const existing = liveDocByUid.get(t.uid);
      if (existing) {
        await existing.ref.update({ status: 'ended', endedAt: FieldValue.serverTimestamp() });
        ended++;
      }
    }
  }
  return { tracked: tracked.length, live: liveMap.size, started, ended };
}

// Scheduled poll — every minute. Founder's friend going live on Twitch shows
// on Vergr within ~60s. Cheap: 1 user query + ≤N/100 Helix calls + a couple
// writes only on state change.
// Runs inside a dispatcher cron in index.js (it was its own Cloud Scheduler
// job, and every job past the first three is billed monthly).
exports.pollTwitchMirrors = async function pollTwitchMirrors() {
    try {
      const r = await reconcile();
      console.log('pollTwitchMirrors', JSON.stringify(r));
    } catch (e) {
      console.error('pollTwitchMirrors error', e?.response?.data || e?.message || e);
    }
  };

// ── Token refresh ──────────────────────────────────────────────────────────
// The detection path (getAppToken) self-refreshes the APP token. This refreshes
// the per-broadcaster USER token in twitch_mirror_secrets/{uid} — the ~4h token
// (it rotates on refresh) the chat bridge (infra/chat/twitch.go) reads to send
// Vergr→Twitch messages AS the broadcaster. Without keeping it fresh, a long
// mirror session silently drops to read-only chat once the token expires.
// Proactive: refresh any secret with <75 min of life left (or no/expired
// expiry) so whatever the relay reads at connect-time is always valid for the
// next session. (A single continuous >4h session with non-stop viewers keeps
// the relay's in-memory copy until the room empties + reconnects — bounded
// residual, acceptable; the stored token stays fresh either way.)
async function refreshExpiringTokens() {
  const snap = await db.collection('twitch_mirror_secrets').limit(500).get();
  if (snap.empty) return { total: 0, checked: 0, refreshed: 0, failed: 0 };
  const now = Date.now();
  const BUFFER_MS = 75 * 60 * 1000;
  let checked = 0, refreshed = 0, failed = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (!d.refreshToken) continue;
    const expMs = d.expiresAt?.toMillis ? d.expiresAt.toMillis()
      : (typeof d.expiresAt === 'number' ? d.expiresAt : 0);
    if (expMs && expMs > now + BUFFER_MS) continue; // still fresh enough
    checked++;
    try {
      const res = await axios.post('https://id.twitch.tv/oauth2/token', null, {
        params: {
          grant_type: 'refresh_token',
          refresh_token: d.refreshToken,
          client_id: TWITCH_CLIENT_ID.value(),
          client_secret: TWITCH_CLIENT_SECRET.value(),
        },
      });
      const accessToken = res.data?.access_token;
      const newRefresh = res.data?.refresh_token || d.refreshToken; // Twitch may rotate it
      const expiresIn = res.data?.expires_in || 14400;
      const scope = Array.isArray(res.data?.scope) ? res.data.scope.join(' ') : (d.scope || '');
      if (accessToken) {
        await doc.ref.set({
          accessToken,
          refreshToken: newRefresh,
          scope,
          expiresAt: Timestamp.fromMillis(now + expiresIn * 1000),
          refreshFailed: FieldValue.delete(),
          refreshFailedAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        refreshed++;
      }
    } catch (e) {
      failed++;
      const status = e?.response?.status;
      // 400/401 = revoked/invalid refresh token (user disconnected Twitch on
      // their side). Flag it so we stop retrying every tick + the UI can prompt
      // a reconnect. Keep the doc (streamKey is still valid for RTMP relay-out).
      if (status === 400 || status === 401) {
        await doc.ref.set({ refreshFailed: true, refreshFailedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      console.error('twitch token refresh failed', doc.id, status, e?.response?.data || e?.message || e);
    }
  }
  return { total: snap.size, checked, refreshed, failed };
}

// Scheduled every 30 min — keeps user tokens valid well ahead of their ~4h life.
// Runs inside a dispatcher cron in index.js (it was its own Cloud Scheduler
// job, and every job past the first three is billed monthly).
exports.refreshTwitchMirrorTokens = async function refreshTwitchMirrorTokens() {
    try {
      const r = await refreshExpiringTokens();
      console.log('refreshTwitchMirrorTokens', JSON.stringify(r));
    } catch (e) {
      console.error('refreshTwitchMirrorTokens error', e?.response?.data || e?.message || e);
    }
  };

// Twitch import onboarding (14_GROWTH_MIGRATION §4.2): after linking Twitch,
// one tap pulls the channel identity via Helix and sets the user up on Vergr:
//   - profile prefill (ONLY fields that are still empty: bio, displayName,
//     avatar, banner — never overwrites anything the user set)
//   - a starter vergr.me page with their existing VODs + clips as EMBED
//     blocks. Embedding is the safe path: we never download or re-host
//     Twitch video (rights + no official download API); a creator who wants
//     a clip ON Vergr re-uploads their own file (user-authored-clips rule).
// If a vergr.me page already exists it is left untouched.
exports.twitchChannelImport = functions.https.onCall(
  { region: REGION, secrets: [TWITCH_CLIENT_SECRET] },
  async (req) => {
    if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    const user = userSnap.exists ? userSnap.data() : {};
    const twitchId = user.linkedAccounts?.twitch?.id;
    if (!twitchId) throw new functions.https.HttpsError('failed-precondition', 'link_twitch_first');

    const token = await getAppToken();
    const h = { Authorization: `Bearer ${token}`, 'Client-Id': TWITCH_CLIENT_ID.value() };
    const uRes = await axios.get(`https://api.twitch.tv/helix/users?id=${twitchId}`, { headers: h });
    const ch = uRes.data?.data?.[0];
    if (!ch) throw new functions.https.HttpsError('not-found', 'Twitch channel not found.');

    // 1. Profile prefill — empty fields only.
    const patch = {};
    if (!user.bio && ch.description) patch.bio = String(ch.description).slice(0, 300);
    if (!user.displayName && ch.display_name) patch.displayName = String(ch.display_name).slice(0, 40);
    if (!user.avatar && !user.photoURL && ch.profile_image_url) patch.avatar = ch.profile_image_url;
    if (!user.banner && ch.offline_image_url) patch.banner = ch.offline_image_url;
    if (Object.keys(patch).length) await userRef.set(patch, { merge: true });

    // 2. Starter vergr.me page (skip if one exists — never clobber).
    const pageRef = userRef.collection('vergrMe').doc('page');
    const pageSnap = await pageRef.get();
    let pageCreated = false;
    let vods = 0;
    let clips = 0;
    if (!pageSnap.exists) {
      const [vRes, cRes] = await Promise.all([
        axios.get(`https://api.twitch.tv/helix/videos?user_id=${twitchId}&first=4&type=archive`, { headers: h }).catch(() => null),
        axios.get(`https://api.twitch.tv/helix/clips?broadcaster_id=${twitchId}&first=4`, { headers: h }).catch(() => null),
      ]);
      let seq = 0;
      const mk = (type, fields) => ({
        id: `b${Date.now().toString(36)}${(seq++).toString(36)}`,
        type, enabled: true, clicks: 0, order: seq - 1, ...fields,
      });
      const blocks = [
        mk('message', { label: 'Message on Vergr' }),
        mk('socials', { socials: { twitch: `https://twitch.tv/${ch.login}` } }),
        mk('link', { title: 'My Twitch channel', url: `https://twitch.tv/${ch.login}`, icon: 'live_tv' }),
      ];
      for (const v of (vRes?.data?.data || [])) {
        blocks.push(mk('video', { provider: 'twitch', url: v.url, title: (v.title || 'Past broadcast').slice(0, 80) }));
        vods++;
      }
      for (const c of (cRes?.data?.data || [])) {
        blocks.push(mk('video', { provider: 'twitch', url: c.url, title: (c.title || 'Clip').slice(0, 80) }));
        clips++;
      }
      await pageRef.set({
        username: user.username || ch.login,
        displayName: user.displayName || ch.display_name || ch.login,
        bio: user.bio || ch.description || '',
        useProfileAvatar: true,
        customAvatarUrl: null,
        theme: 'dark',
        accentColor: '#7B1FFF',
        background: { type: 'gradient', overlayOpacity: 0.35 },
        colors: {},
        font: 'vergr',
        blockStyle: { shape: 'rounded', shadow: false, outline: false },
        linkStyle: 'classic',
        headerStyle: { layout: 'centered', variant: 'banner' },
        blocks,
        showMessageBtn: true, showFollowers: true, showSocials: true,
        showEmail: false, contactEmail: null,
        socials: { twitch: `https://twitch.tv/${ch.login}` },
        links: [], tipJarEnabled: false, tipJarLabel: 'Buy me a coffee',
        showShare: true, showSubscribe: true, hideBranding: false, isPublic: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      pageCreated = true;
    }

    return {
      ok: true,
      profileUpdated: Object.keys(patch),
      pageCreated, vods, clips,
      login: ch.login,
    };
  },
);

// Per-platform recap sampling for OUTBOUND mirrors ("stream to both"): the
// broadcaster's client polls this ~every 60s while live, and we stamp the
// current + peak Twitch viewer counts onto the stream doc so the stream-end
// summary can show "X on Vergr · Y on Twitch". Client-driven on purpose — no
// cron, it only runs while a mirrored broadcast is actually up.
exports.getTwitchMirrorViewers = functions.https.onCall(
  { region: REGION, secrets: [TWITCH_CLIENT_SECRET] },
  async (req) => {
    if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const streamId = String(req.data?.streamId || '');
    if (!streamId) throw new functions.https.HttpsError('invalid-argument', 'streamId required.');
    const snap = await db.collection('streams').doc(streamId).get();
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Stream not found.');
    const s = snap.data();
    const host = s.hostUid || s.streamerId;
    if (host !== req.auth.uid) throw new functions.https.HttpsError('permission-denied', 'Host only.');
    const twitchUserId = s.twitchMirror?.twitchUserId;
    if (!twitchUserId) return { mirrored: false, viewers: 0 };
    try {
      const token = await getAppToken();
      const res = await axios.get(`https://api.twitch.tv/helix/streams?user_id=${twitchUserId}`, {
        headers: { Authorization: `Bearer ${token}`, 'Client-Id': TWITCH_CLIENT_ID.value() },
      });
      const live = res.data?.data?.[0];
      const viewers = live ? (live.viewer_count || 0) : 0;
      const peak = Math.max(viewers, s.twitchPeakViewers || 0);
      await snap.ref.set({ twitchViewerCount: viewers, twitchPeakViewers: peak }, { merge: true });
      return { mirrored: true, viewers, peak };
    } catch (e) {
      console.error('getTwitchMirrorViewers', e?.response?.data || e?.message);
      return { mirrored: true, viewers: 0, error: true };
    }
  },
);

// Manual trigger — lets the user (or founder) force an immediate sync instead
// of waiting up to 60s for the next poll tick. Returns the reconcile summary.
exports.syncTwitchMirrorNow = functions.https.onCall(
  { region: REGION, secrets: [TWITCH_CLIENT_SECRET] },
  async (req) => {
    if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    try {
      const r = await reconcile();
      return { ok: true, ...r };
    } catch (e) {
      console.error('syncTwitchMirrorNow error', e?.response?.data || e?.message || e);
      throw new functions.https.HttpsError('internal', 'Twitch sync failed.');
    }
  },
);
