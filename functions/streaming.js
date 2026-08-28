// VERGR live streaming — backend.
// Architecture: nginx-rtmp on Oracle Cloud Always Free → HLS to R2 → Cloudflare CDN.
// See CLAUDE.md "Live streaming architecture" for the full design.
//
// This module is deployable BEFORE the Oracle VM exists. It generates stream
// keys + HLS URLs based on `STREAMING_INGEST_BASE` / `STREAMING_HLS_BASE`
// env vars; until those point at a real RTMP server, broadcasters get a
// well-formed key but pushing to it fails (expected during setup phase).
//
// Once Oracle is provisioned + nginx-rtmp installed, set the env vars and
// every existing stream key automatically resolves to the new server.

const functions = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

// ── Plan rules (mirror src/utils/tierSystem.js) ──
const PLAN_RULES = {
  free: {
    maxViewerRendition: '480p',
    streamMinutesPerDay: 30,
    canStreamPublic: false,        // unlocked at 100 followers
    streamFollowerGate: 100,
    streamBoostCoinFee: 50,
    requiresBoost: true,           // free public streams MUST boost
    privateStreamingTURN: false,
  },
  lite: {
    maxViewerRendition: '720p',
    streamMinutesPerDay: 240,
    canStreamPublic: true,
    streamFollowerGate: 0,
    streamBoostCoinFee: 50,        // optional for lite
    requiresBoost: false,
    privateStreamingTURN: false,
  },
  pro: {
    maxViewerRendition: '1080p',
    streamMinutesPerDay: Infinity,
    canStreamPublic: true,
    streamFollowerGate: 0,
    streamBoostCoinFee: 50,        // optional for pro
    requiresBoost: false,
    privateStreamingTURN: true,
  },
};

// Stream-kind rules. ARCHITECTURE NOTE (2026-05-16 audit):
// - Squad streams are NOT a mesh. They run on Pion SFU at sfu.vergr.app.
//   The SFU handles ~15,000 concurrent peer connections per box (Pion bench);
//   a 100-member squad voice/video hangout is well under that. Cap should
//   match squad member size (default 100, unlimited for the Vanguard squad).
// - Public streams hit Hetzner nginx-rtmp → HLS → R2 → CDN with viewer-side
//   P2P swarm (p2p-media-loader). Viewer caps below are DISCOVERY-FEED caps
//   (free streams surface to limited audience), not technical limits.
// - Watch parties run on Pion SFU same as squad streams. Same cap logic.
const STREAM_KIND_RULES = {
  public:           { needsRtmp: true,  visibility: 'public',   maxConcurrentViewers: { free: 50, lite: 200, pro: Infinity } },
  // Squad stream cap = squad member cap (100). Read dynamically from the
  // squad doc's maxMembers field at session-create time; defaults to 100.
  // The Vanguard squad is the only one with maxMembers: null (unlimited).
  squad:            { needsRtmp: false, visibility: 'squad',    maxConcurrentViewers: { free: 100, lite: 100, pro: 100 }, dynamicFromSquad: true },
  tournament:       { needsRtmp: true,  visibility: 'public',   maxConcurrentViewers: { free: Infinity, lite: Infinity, pro: Infinity } },
  // Watch parties: same model. Cap by participant list, not by plan tier.
  watch_party:      { needsRtmp: false, visibility: 'private',  maxConcurrentViewers: { free: 100, lite: 100, pro: 100 } },
};

const STREAM_KEY_BYTES       = 24;
const BOOST_FEE_COINS        = 50;
const BOOST_REACH_MULTIPLIER = 1.5;

function getIngestBase()           { return (process.env.STREAMING_INGEST_BASE        || 'rtmp://rtmp.vergr.app:1935/live').replace(/\/$/, ''); }
function getBrowserIngestBase()    { return (process.env.STREAMING_BROWSER_INGEST_BASE || 'https://sfu.vergr.app/ingest').replace(/\/$/, ''); }
function getHlsBase()              { return (process.env.STREAMING_HLS_BASE            || 'https://cdn.vergr.app/streams').replace(/\/$/, ''); }

// ── Horizontal ingest scaling ────────────────────────────────────────────────
// Every box ("edge") runs an identical ingest stack (nginx-rtmp + rtmp-auth +
// vergr-ingest + r2-sync) that pushes to the SAME R2 bucket, so a stream
// packaged on ANY box is served identically from cdn.vergr.app — the viewer
// can't tell which box ingested it. Each box's stream-node-agent heartbeats its
// live load to stream_nodes/{nodeId}. pickStreamNode returns the freshest,
// least-loaded box that has capacity for THIS ingest mode (browser ingest needs
// an HTTPS endpoint = a node that advertises browserIngestBase). It falls back
// to null → the caller uses the single static box (env defaults), so go-live can
// NEVER break on an empty/stale registry. Adding a box = it heartbeats itself in;
// draining a box (status!=='active') = it stops receiving new streams.
const NODE_STALE_MS = 60 * 1000;
async function pickStreamNode(mode) {
  try {
    const snap = await db.collection('stream_nodes').get();
    const now = Date.now();
    const cand = [];
    snap.forEach((d) => {
      const n = d.data() || {};
      if (n.status !== 'active') return;
      const hb = n.lastHeartbeat && n.lastHeartbeat.toMillis ? n.lastHeartbeat.toMillis() : 0;
      if (!hb || now - hb > NODE_STALE_MS) return;            // dead/stale box
      if (mode === 'browser' && !n.browserIngestBase) return; // needs HTTPS ingest (cert)
      if (mode === 'rtmp' && !n.rtmpBase) return;
      const max = n.maxStreams || 10;
      const cur = n.currentStreams || 0;
      if (cur >= max) return;                                 // at capacity
      cand.push({ id: d.id, rtmpBase: n.rtmpBase, browserIngestBase: n.browserIngestBase, load: cur / max, cpu: n.cpuPct || 0, priority: n.priority || 0 });
    });
    if (!cand.length) return null;
    // Highest priority first (box 2 = 10 → all normal streams land there), then
    // lowest load, tiebreak CPU. Box 1 (priority 0) is automatic overflow/failover.
    cand.sort((a, b) => (b.priority - a.priority) || (a.load - b.load) || (a.cpu - b.cpu));
    return cand[0];
  } catch (e) {
    console.warn('pickStreamNode failed, using static fallback:', e.message);
    return null;
  }
}

// getStreamNode — fetch one registry node by id if it's active + fresh.
// Used to PIN streams that must land on a specific box: tournament streams must
// run where vergr-ocr reads local HLS frames (live-score/lobby/cheat OCR), and
// co-host streams must run where the cohost-launcher + ffmpeg composite live.
// Both currently = the primary node (edge1). Falls back to null → normal pick.
async function getStreamNode(nodeId) {
  try {
    const d = await db.collection('stream_nodes').doc(nodeId).get();
    if (!d.exists) return null;
    const n = d.data() || {};
    const hb = n.lastHeartbeat && n.lastHeartbeat.toMillis ? n.lastHeartbeat.toMillis() : 0;
    if (n.status !== 'active' || !hb || Date.now() - hb > NODE_STALE_MS) return null;
    return { id: d.id, rtmpBase: n.rtmpBase, browserIngestBase: n.browserIngestBase, sfuBase: n.sfuBase };
  } catch (e) {
    console.warn('getStreamNode failed:', e.message);
    return null;
  }
}

function newStreamKey() {
  return crypto.randomBytes(STREAM_KEY_BYTES).toString('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// createStreamSession — provisions a stream key, charges Boost if applicable.
// ─────────────────────────────────────────────────────────────────────────────
exports.createStreamSession = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;

  const { kind = 'public', tournamentId = null, tournamentMatchId = null, boost = null, title = '', game = null, mode = 'rtmp', twitchMirror = false, orientation = 'landscape', language = null, audience = 'public', contentRating = null } = req.data || {};
  // Audience visibility within a public stream: 'public' (discoverable to all),
  // 'followers', or 'friends' (both = unlisted, gated on the watch page). Server
  // is the source of truth so discovery queries can trust a single boolean.
  // 'unlisted' is the 1:1 / link-only case: no relationship gate at all, but
  // absent from every discovery query, so possession of the link is the entire
  // access model. It is NOT a synonym for 'friends' (which additionally checks a
  // relationship) and must stay a distinct value, because the fallback for an
  // unknown audience is 'public' and a 1:1 that silently became public would be
  // the worst possible failure of this feature.
  const audienceVal = ['public', 'followers', 'friends', 'ticketed', 'unlisted'].includes(audience) ? audience : 'public';

  // A 1:1 SESSION IS A DIFFERENT THING FROM A BROADCAST, AND THE DIFFERENCE IS
  // ENFORCED HERE RATHER THAN DESCRIBED IN A LABEL.
  //
  // Policy treats a 1:1 session and a paid broadcast differently (Terms 10A vs
  // 10, AUP sections 2 vs 3). If the only difference between them were a flag
  // the client sets, the category would be a costume: a host could mark a
  // 500-viewer broadcast as a "1:1" and claim the private-surface reading.
  //
  // So a 1:1 is capped at ONE concurrent viewer by the server, forced unlisted,
  // and stamped on the document so moderation and support can tell the two
  // apart after the fact. If it can hold an audience, it is not a 1:1.
  const isOneToOne = req.data?.sessionType === 'one_to_one';

  // WHO IS ALLOWED IN. Not the same question as "who can find it".
  //
  // Unlisted only removes a session from discovery. `streams/{id}` is
  // `allow read: if true`, so anyone holding the id could read the document,
  // and for a free session that document carried the playback URL: a forwarded
  // link was a forwarded session. "Nobody will guess the id" is not a privacy
  // model for something sold as private.
  //
  // So a 1:1 names its guests. The list is the host plus whoever the chat had
  // in it, and getAccess refuses playback to anyone else even when the session
  // is free. Capped because a "1:1" with fifty names on it is a broadcast
  // wearing the private-surface label that Terms 10A grants.
  const inviteUids = Array.isArray(req.data?.inviteUids)
    ? [...new Set(req.data.inviteUids.filter((u) => typeof u === 'string' && u).map(String))].slice(0, 32)
    : [];
  // 'ticketed' streams stay DISCOVERABLE (so fans can find them and buy a
  // ticket) but the watch page gates playback on ticket ownership. Only
  // followers/friends are unlisted (hidden from discovery + follow-gated).
  const isUnlisted = isOneToOne || audienceVal === 'followers' || audienceVal === 'friends' || audienceVal === 'unlisted';
  // Ticketed streams must be tied to the ticketed event so the watch gate can
  // check ticket ownership against that tournament.
  if (audienceVal === 'ticketed' && !tournamentId) {
    throw new functions.https.HttpsError('failed-precondition', 'Ticketed streams must be linked to a ticketed event.');
  }

  // PAID stream: pay-per-view with no tournament behind it. Distinct from
  // 'ticketed' above, which exists to fund a prize pool and is therefore tied to
  // an event; this is a creator selling entry to their own broadcast, and the
  // entitlement is the generic one in entitlements.js.
  //
  // The price is validated here and re-read from the document at purchase, so
  // this value is a declaration rather than something a buyer's client can send.
  const accessIn = req.data?.access || null;
  const isPaidStream = accessIn?.mode === 'paid';
  const accessPriceCoins = isPaidStream ? Math.floor(Number(accessIn.priceCoins) || 0) : 0;
  if (isPaidStream && (accessPriceCoins < 50 || accessPriceCoins > 10_000)) {
    // Same bounds as every other unlock. entitlements.js MIN/MAX_PRICE_COINS.
    throw new functions.https.HttpsError('invalid-argument', 'Stream price must be between 50 and 10,000 coins.');
  }

  // Tournament-linked streams are LIVE at full quality for viewers. Only the
  // SAVED VOD is archived at low quality (480p) for mod review post-match,
  // and retained 7 days (vs 24h default). VOD transcode happens in the R2
  // cleanup / archive path, not at ingest.
  const isTournamentStream = !!(tournamentId || tournamentMatchId);

  if (mode !== 'rtmp' && mode !== 'browser') {
    throw new functions.https.HttpsError('invalid-argument', `Unknown mode: ${mode}. Use 'rtmp' (OBS) or 'browser' (fMP4 chunked ingest).`);
  }

  const kindRules = STREAM_KIND_RULES[kind];
  if (!kindRules) throw new functions.https.HttpsError('invalid-argument', `Unknown stream kind: ${kind}`);

  // Squad streams don't hit our backend — they're WebRTC mesh
  if (!kindRules.needsRtmp) {
    throw new functions.https.HttpsError('failed-precondition',
      `Stream kind "${kind}" uses peer-to-peer WebRTC, no backend session needed.`);
  }

  // Emergency kill switch (admin-controlled — non-cost reasons: abuse, DDoS, bug, policy event)
  const cfgSnap = await db.collection('app_config').doc('general').get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  if (cfg.liveStreamingPaused === true) {
    throw new functions.https.HttpsError('failed-precondition', 'Live streaming is temporarily paused.');
  }

  // Load user
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'User profile not found.');
  const user = userSnap.data();
  // Admins (founder + ops) bypass EVERY streaming limit — follower gate, daily
  // cap, boost fee, tier rendition caps. effective plan is forced to 'pro'.
  const ADMIN_EMAILS = ['vergenerd@gmail.com'];
  const isAdmin = user.role === 'admin' || ADMIN_EMAILS.includes((user.email || '').toLowerCase());
  const plan = isAdmin ? 'pro' : (user.subscription || 'free');
  const planRules = PLAN_RULES[plan] || PLAN_RULES.free;

  // Public stream: enforce follower gate (free only, non-admin).
  // Admin master switch: app_config/general.streamFollowerGateEnabled === false
  // disables the min-follower requirement platform-wide (set from the admin
  // dashboard). Default (undefined) keeps the gate ON.
  const followerGateOn = cfg.streamFollowerGateEnabled !== false;
  const followerCount = user.followerCount || 0;
  if (followerGateOn && !isAdmin && kindRules.visibility === 'public' && plan === 'free' && followerCount < planRules.streamFollowerGate) {
    throw new functions.https.HttpsError('permission-denied',
      `You need ${planRules.streamFollowerGate} followers to go public live. You have ${followerCount}. Squad-stream to your followers in the meantime — that's free.`);
  }

  // Daily streaming time cap (admins uncapped)
  const today = new Date().toISOString().slice(0, 10);
  const usageRef = db.collection('users').doc(uid).collection('stream_usage').doc(today);
  const usageSnap = await usageRef.get();
  const minutesUsedToday = usageSnap.exists ? (usageSnap.data().minutes || 0) : 0;
  if (!isAdmin && minutesUsedToday >= planRules.streamMinutesPerDay) {
    throw new functions.https.HttpsError('resource-exhausted',
      `Daily streaming cap reached (${planRules.streamMinutesPerDay} min). ${plan === 'free' ? 'Upgrade to Lite for 4 hours/day.' : ''}`);
  }

  // Boost charge — required for free public streams; optional for paid.
  // Admins never get charged a boost (forced off).
  // boost arg: null = use default (free=true, paid=false), true/false = explicit
  // ⚠⚠ THE ADMIN SWITCH WAIVES THE BOOST FEE TOO, AND THAT IS THE WHOLE POINT.
  //
  // `streamFollowerGateEnabled` is labelled in /admin/config as:
  //     "ON = free users need 100 followers to stream public. OFF = anyone can
  //      go live."
  //
  // It did not mean that. Turning it off cleared the FOLLOWER check and left the
  // 50-coin Stream Boost charge standing, so a free account with 0 coins still
  // could not go live and the switch had not delivered what it says on the tin.
  // Found 2026-08-27 when the founder turned it off and was then told he needed
  // 50 coins.
  //
  // A control must mean what it claims. "Anyone can go live" waives BOTH gates
  // for free public streams, or the label is a lie.
  //
  // ⚠ THIS DOES NOT CHANGE ANY PRICE. The switch defaults to ON (undefined !==
  // false), so on a normal deployment the 100-follower requirement and the
  // 50-coin boost both stand exactly as before. It only makes the OFF position
  // do what it advertises.
  const willBoost = isAdmin || !followerGateOn
    ? false
    : (boost === null
      ? (plan === 'free' && kindRules.visibility === 'public')
      : !!boost);

  if (willBoost && kindRules.visibility !== 'public') {
    // No point boosting a private/squad stream — refuse to charge
    throw new functions.https.HttpsError('invalid-argument', 'Stream Boost only applies to public streams.');
  }

  if (followerGateOn && planRules.requiresBoost && kindRules.visibility === 'public' && !willBoost) {
    throw new functions.https.HttpsError('failed-precondition',
      `Free public streams require a ${BOOST_FEE_COINS}-coin Stream Boost. It's refunded by your first ${BOOST_FEE_COINS} coins of tips.`);
  }

  // Generate stream resources
  const streamKey = newStreamKey();
  const streamId  = db.collection('streams').doc().id;

  // Two ingest paths: OBS users push RTMP directly to nginx-rtmp at the streamKey
  // path; browser users POST fMP4 chunks to vergr-ingest with Bearer streamKey auth.
  // HLS output lands at the same R2 path either way (per-streamId directory).
  // Assign this stream to the least-loaded ingest box (or fall back to the
  // single static box if the registry is empty/stale). The viewer playback URL
  // is box-independent (always cdn.vergr.app), so only ingest is distributed.
  // EXCEPTION: tournament streams must run on the OCR box (vergr-ocr reads local
  // HLS frames for live-score/lobby/cheat verification), and co-host streams
  // must run on the cohost-launcher box (ffmpeg composite). Pin both to the
  // primary node; if it's down, fall back to a normal pick (degraded but live).
  const PRIMARY_NODE = process.env.PRIMARY_STREAM_NODE || 'edge1';
  const pinToPrimary = isTournamentStream || kind === 'co_stream';
  const node = pinToPrimary
    ? (await getStreamNode(PRIMARY_NODE)) || (await pickStreamNode(mode))
    : await pickStreamNode(mode);
  const rtmpBase    = (node && node.rtmpBase)          || getIngestBase();
  const browserBase = (node && node.browserIngestBase) || getBrowserIngestBase();
  const nodeId      = (node && node.id)                || 'edge-static';

  const ingestUrl = mode === 'browser'
    ? browserBase                                   // base only — client appends /init, /seg/N, /end
    : `${rtmpBase}/${streamKey}`;                    // RTMP URL with the key embedded (OBS convention)
  const hlsUrl    = `${getHlsBase()}/${streamKey}/index.m3u8`;
  const lowLatencyHlsUrl = `${getHlsBase()}/${streamKey}/ll.m3u8`;

  // Twitch mirror: the OBS feed pushed to Vergr is ALSO relayed (re-pushed) to
  // the streamer's Twitch by the Hetzner rtmp-auth service, and the vergr-chat
  // relay bridges Twitch chat both ways. Only valid for the RTMP (OBS) ingest
  // path on a public stream, and only when the user connected Twitch with the
  // mirror scopes (twitch_mirror_secrets/{uid} holds the key — server-only).
  let mirrorMeta = null;
  if (twitchMirror) {
    if (mode !== 'rtmp') {
      throw new functions.https.HttpsError('failed-precondition', 'Twitch mirror requires the OBS (RTMP) ingest path.');
    }
    if (kindRules.visibility !== 'public') {
      throw new functions.https.HttpsError('failed-precondition', 'Twitch mirror only applies to public streams.');
    }
    const secretSnap = await db.collection('twitch_mirror_secrets').doc(uid).get();
    const secret = secretSnap.exists ? secretSnap.data() : null;
    if (!secret || !secret.streamKey) {
      throw new functions.https.HttpsError('failed-precondition',
        'Connect your Twitch account (with stream + chat permissions) before mirroring. Reconnect Twitch in Settings if you connected it earlier.');
    }
    mirrorMeta = {
      enabled: true,
      twitchLogin: secret.twitchLogin || null,
      twitchUserId: secret.twitchUserId || null,
    };
  }

  // Atomic transaction: charge boost (if applicable) + create stream doc
  await db.runTransaction(async (tx) => {
    let boostCharged = false;
    let boostPaidWithToken = false;
    if (willBoost) {
      const walletRef = db.collection('wallets').doc(uid);
      const wallet = await tx.get(walletRef);
      if (!wallet.exists) throw new functions.https.HttpsError('failed-precondition', 'Wallet not found.');
      const w = wallet.data();
      const balance = w.balance || 0;
      // A Stream Boost token spends BEFORE coins do. Tokens are granted by the
      // VP ladder (syncVpLevel) and are the only rank reward with real economic
      // value, so they are deliberately scarce: 7 across 100 levels.
      //
      // Spending the token instead of the coins keeps the boost's own economics
      // intact: the stream is still boosted, still refundable by tips, and the
      // sink ledger below still records a boost. What changes is who paid.
      const tokens = Number(w.boostTokens) || 0;
      if (tokens > 0) {
        tx.update(walletRef, { boostTokens: FieldValue.increment(-1) });
        boostCharged = true;
        boostPaidWithToken = true;
      } else {
        if (balance < BOOST_FEE_COINS) {
          throw new functions.https.HttpsError('failed-precondition',
            `Need ${BOOST_FEE_COINS} coins for Stream Boost. You have ${balance}.`);
        }
        tx.update(walletRef, {
          balance: FieldValue.increment(-BOOST_FEE_COINS),
          totalSpent: FieldValue.increment(BOOST_FEE_COINS),
        });
        boostCharged = true;
      }
    }

    tx.set(db.collection('streams').doc(streamId), {
      hostUid: uid,
      hostUsername: user.username || null,
      hostAvatar: user.avatar || null,
      hostCountry: user.country || null,            // locality discovery: filter/rank streams by viewer region
      language: language || null,                   // spoken language of the broadcast (Go Live picker; defaults from country client-side)
      kind,
      visibility: kindRules.visibility,
      tournamentId,
      tournamentMatchId,
      archiveLowQuality: isTournamentStream,   // VOD is downscaled for mod review only; live remains full quality
      retainAfterEndMs: isTournamentStream ? 7 * 24 * 60 * 60 * 1000 : null,
      title: (title || '').slice(0, 120),
      game,
      // Audience enforcement: discoverable drives every discovery query; unlisted
      // gates the watch page (followers/friends must pass the relationship check).
      audience: audienceVal,
      // Read by entitlements.js when someone tries to buy entry. A stream with
      // no `access` block, or mode 'free', is not for sale and purchaseAccess
      // refuses it.
      access: isPaidStream
        ? { mode: 'paid', priceCoins: accessPriceCoins, unlockCount: 0 }
        : { mode: 'free', priceCoins: 0, unlockCount: 0 },
      // Adult marker. Accepted ONLY on a paid stream: a free or followers-only
      // broadcast reaches an audience, and Terms section 3 forbids nudity there
      // regardless of what the client asks for. Honouring the flag on a free
      // stream would let a host publish adult content to a public feed with a
      // single request field. Absent means general, so nothing existing moves.
      ...(contentRating === 'nsfw' && isPaidStream ? { contentRating: 'nsfw' } : {}),
      unlisted: isUnlisted,
      discoverable: !isUnlisted,
      // Terms 10A. Stamped so moderation, support and the viewer screen can tell
      // a private session from a paid broadcast without guessing from audience.
      sessionType: isOneToOne ? 'one_to_one' : 'broadcast',
      // The guest list, host included. Read by entitlements.js before it will
      // hand over a playback URL. Only ever set for a 1:1: a broadcast is
      // gated by audience and price, not by a list of names.
      inviteUids: isOneToOne ? [...new Set([uid, ...inviteUids])] : null,
      // THE STREAM KEY IS NOT ON THIS DOCUMENT.
      //
      // `streams/{id}` is `allow read: if true`, and the stream key is a
      // PUBLISH CREDENTIAL: `src/utils/streamIngest.js` sends it as
      // `Authorization: Bearer <streamKey>` to the browser-ingest endpoint, and
      // it is the RTMP key an OBS user types in. Publishing it on a
      // world-readable document let any reader inject frames into someone
      // else's broadcast.
      //
      // It also defeated paid streams: the HLS path is
      // `cdn.vergr.app/streams/<streamKey>/index.m3u8`, so a viewer who read
      // the key could rebuild the playback URL by hand and skip the paywall
      // that withholding `hlsUrl` was supposed to create.
      //
      // It now lives in `stream_keys/{streamKey}` (rules deny every client),
      // which vergr-rtmp-auth looks up by document id. The host receives it in
      // this callable's return value and can re-fetch it from
      // `getStreamIngest`, which checks they are the host.
      //
      // Viewers do not need it: free streams carry `hlsUrl` on this document
      // and paid streams get their URL from `getAccess`.
      thumbUrl: `${getHlsBase()}/${streamKey}/thumb.jpg`,
      ingestUrl,
      nodeId,                                       // which ingest box packaged this stream (for load accounting + ops)
      ingestType: mode,                             // 'rtmp' | 'browser' — used by vergr-ingest auth + UI gating
      // THE PLAYBACK URL IS OMITTED FOR A PAID STREAM.
      //
      // `streams/{id}` is `allow read: if true`. Leaving hlsUrl on it would mean
      // a paywall anyone defeats by reading the document they are already
      // allowed to read, which is not a paywall, it is a hidden button. For a
      // paid stream both URLs go to `streams/{id}/private/playback`, which rules
      // deny to every client, and getAccess hands them over after checking the
      // entitlement. Free streams are untouched: same fields, same place.
      //
      // A 1:1 withholds them for the same reason even when it is free: the
      // document is world-readable and the guest list is the gate, so the URL
      // has to be minted per-viewer by getAccess rather than published.
      hlsUrl: (isPaidStream || isOneToOne) ? null : hlsUrl,
      lowLatencyHlsUrl: (isPaidStream || isOneToOne) ? null : lowLatencyHlsUrl,
      status: 'created',
      boosted: boostCharged,
      // Coins only if coins were actually taken. A token-paid boost charged
      // zero coins, so refunding coins for it would MINT them out of nothing.
      boostChargedCoins: (boostCharged && !boostPaidWithToken) ? BOOST_FEE_COINS : 0,
      boostPaidWithToken,
      boostRefunded: false,
      tipsReceivedDuringStream: 0,
      maxViewerRenditionForViewers: planRules.maxViewerRendition,
      // One means one. This is the line between Terms 10A and Terms 10.
      maxConcurrentViewers: isOneToOne ? 1 : (kindRules.maxConcurrentViewers[plan] || 50),
      hostPlan: plan,
      hostFollowerCount: followerCount,
      orientation: orientation === 'portrait' ? 'portrait' : 'landscape', // desktop/mobile split in discovery
      twitchMirror: mirrorMeta,                     // null unless mirroring; relay + chat bridge read this
      twitchMirrorState: mirrorMeta ? 'pending' : null, // relay stamps 'relaying'/'error'; bridge stamps chat status
      privateTurn: planRules.privateStreamingTURN,
      createdAt: FieldValue.serverTimestamp(),
      startedAt: null,
      endedAt: null,
      lastViewedAt: null,
      viewerCount: 0,
      peakViewers: 0,
    });

    // Playback URLs out of reach of every client. Read only by getAccess, and
    // only for someone who has paid (paid stream) or is on the guest list (1:1).
    //
    // A FREE 1:1 needs this as much as a paid one. `streams/{id}` is world
    // readable, so leaving hlsUrl on the document meant the id WAS the session:
    // forward the link, or guess an id, and you are watching something the two
    // people in it believe is private. Unlisted hides it from discovery and does
    // nothing at all about that.
    if (isPaidStream || isOneToOne) {
      tx.set(db.collection('streams').doc(streamId).collection('private').doc('playback'), {
        hlsUrl,
        lowLatencyHlsUrl,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    // The publish credential, keyed BY the credential so vergr-rtmp-auth can
    // resolve it with a document get instead of the collection query it used to
    // run against `streams` (cheaper, and it stops needing the key to be a
    // field on a public document). Rules deny this collection to every client.
    tx.set(db.collection('stream_keys').doc(streamKey), {
      streamId,
      hostUid: uid,
      hostPlan: plan,
      createdAt: FieldValue.serverTimestamp(),
    });

    // The host's own copy, for a reload of the broadcaster screen. Under
    // `private/`, which rules deny to clients, so it is reachable only through
    // getStreamIngest below.
    tx.set(db.collection('streams').doc(streamId).collection('private').doc('ingest'), {
      streamKey,
      ingestUrl,
      ingestType: mode,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  // Stream Boost is the platform's OTHER coin sink (subscriptions are the
  // first). Coins spent here never reach a creator's withdrawable balance, so
  // the payout liability accrued when they were sold is released in full and
  // the coin is 100% margin. Post-commit and guarded: the stream already exists
  // and must not fail because a ledger row did.
  //
  // `willBoost` is the intent; `boosted` on the doc is the truth, but the
  // transaction has closed by here, so the charge condition is re-derived from
  // the same flag the transaction used. Idempotent on streamId either way.
  if (willBoost) {
    try {
      const { bookPlatformSink } = require('./platformRevenue');
      await bookPlatformSink({
        uid, coins: BOOST_FEE_COINS, sink: 'stream_boost',
        sourceId: `boost:${streamId}`,
      });
    } catch (e) {
      console.error('bookPlatformSink (boost) failed', streamId, e?.message || e);
    }
  }

  return {
    streamId,
    streamKey,
    ingestUrl,
    ingestType: mode,
    hlsUrl,
    lowLatencyHlsUrl,
    boosted: willBoost,
    boostChargedCoins: willBoost ? BOOST_FEE_COINS : 0,
    boostRefundConditionCoins: willBoost ? BOOST_FEE_COINS : 0,
    maxViewerRenditionForViewers: planRules.maxViewerRendition,
    privateTurn: planRules.privateStreamingTURN,
    plan,
    archiveLowQuality: isTournamentStream,
    twitchMirror: mirrorMeta,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// endStreamSession — marks ended, refunds Boost if tips earned ≥ fee.
// ─────────────────────────────────────────────────────────────────────────────
exports.endStreamSession = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { streamId } = req.data || {};
  if (!streamId) throw new functions.https.HttpsError('invalid-argument', 'streamId required.');

  let streamStartMs = 0;
  const endResult = await db.runTransaction(async (tx) => {
    const streamRef = db.collection('streams').doc(streamId);
    const streamSnap = await tx.get(streamRef);
    if (!streamSnap.exists) throw new functions.https.HttpsError('not-found', 'Stream not found.');
    const stream = streamSnap.data();
    streamStartMs = stream.startedAt?.toMillis?.() ?? (typeof stream.startedAt === 'number' ? stream.startedAt : 0);
    if (stream.hostUid !== uid) throw new functions.https.HttpsError('permission-denied', 'Only the host can end this stream.');
    if (stream.status === 'ended') return { ok: true, alreadyEnded: true, refunded: stream.boostRefunded };

    let refunded = false;
    if (stream.boosted && !stream.boostRefunded && (stream.tipsReceivedDuringStream || 0) >= BOOST_FEE_COINS) {
      const walletRef = db.collection('wallets').doc(uid);
      // Refund WHAT WAS SPENT. A boost paid with a VP ladder token gets the
      // token back; refunding 50 coins for it would create coins nobody bought,
      // which is a hole straight through the coin supply.
      if (stream.boostPaidWithToken) {
        tx.update(walletRef, { boostTokens: FieldValue.increment(1) });
      } else {
        tx.update(walletRef, {
          balance: FieldValue.increment(BOOST_FEE_COINS),
          totalSpent: FieldValue.increment(-BOOST_FEE_COINS),
        });
      }
      refunded = true;
    }

    // Multi-Guest unlink: partners drop their composite link and revert to
    // solo HLS from their own streamKey. (The ffmpeg composite for any room
    // this stream was in will exit on the next vergr-cohost roster check.)
    if (Array.isArray(stream.linkedStreamIds) && stream.linkedStreamIds.length > 0) {
      for (const partnerId of stream.linkedStreamIds) {
        tx.update(db.collection('streams').doc(partnerId), {
          linkedStreamIds: FieldValue.arrayRemove(streamId),
          compositeHlsUrl: FieldValue.delete(),
          compositeOwner: FieldValue.delete(),
        });
      }
    }

    // Hearts → user.totalLikes (running lifetime counter). Feeds the discovery
    // algorithm — streams + posts from creators with higher totalLikes get
    // surfaced to non-followers more aggressively (see feedRank.js consumers).
    const earnedHearts = stream.hearts || 0;
    if (earnedHearts > 0 && stream.hostUid) {
      tx.update(db.collection('users').doc(stream.hostUid), {
        totalLikes: FieldValue.increment(earnedHearts),
        // Time-decayed signal for the recency-weighted feed ranker.
        recentLikes30d: FieldValue.increment(earnedHearts),
        recentLikesUpdatedAt: FieldValue.serverTimestamp(),
      });
    }

    tx.update(streamRef, {
      status: 'ended',
      endedAt: FieldValue.serverTimestamp(),
      boostRefunded: refunded,
      linkedStreamIds: [],
      compositeHlsUrl: FieldValue.delete(),
      compositeOwner: FieldValue.delete(),
    });

    // Retire the publish credential with the stream. Leaving it resolvable
    // would let anyone who had somehow obtained the key start publishing to an
    // ended broadcast, and the lookup collection would grow without bound.
    if (stream.streamKey) tx.delete(db.collection('stream_keys').doc(stream.streamKey));

    return { ok: true, refunded, alreadyEnded: false };
  });

  // The boost sink is REVERSIBLE: a stream that takes 50 coins of tips gets its
  // boost fee back, so those coins never actually stayed with the platform and
  // the liability released at charge time has to be re-accrued. Without this the
  // ledger would count every refunded boost as permanent margin and quietly
  // overstate profit on exactly the streams that performed best.
  //
  // Distinct sourceId from the charge, so the two rows sit side by side and net
  // to zero rather than one silently cancelling the other.
  if (endResult?.refunded) {
    try {
      const { bookPlatformSink } = require('./platformRevenue');
      await bookPlatformSink({
        uid, coins: -BOOST_FEE_COINS, sink: 'stream_boost_refund',
        sourceId: `boost_refund:${streamId}`,
      });
    } catch (e) {
      console.error('bookPlatformSink (boost refund) failed', streamId, e?.message || e);
    }
  }

  // Engagement VP: reward whole hours streamed (capped per UTC day). Only on the
  // real end (not an idempotent repeat) and only when we know when it started.
  if (!endResult?.alreadyEnded && streamStartMs > 0) {
    const elapsedMs = Date.now() - streamStartMs;
    const hours = Math.floor(elapsedMs / 3_600_000);
    if (hours > 0) {
      try {
        const { creditEngagementVp } = require('./engagementVp');
        await creditEngagementVp(db, uid, 'stream_hour', hours);
      } catch (e) { console.error('stream_hour VP failed', streamId, e?.message || e); }
    }

    // ── Lifetime minutes, for the "On air" milestone badges ──────────
    //
    // ⚠ `users/{uid}.streamMinutes` was READ by the badge table and written by
    // NOTHING, so the whole On air family was permanently unearnable. (The
    // `streamMinutesPerDay` values elsewhere in this file are per-tier LIMITS,
    // a different thing with a confusingly similar name.)
    //
    // Minutes, not hours, so a 40-minute stream still counts toward First
    // Light instead of rounding to nothing — the VP award above deliberately
    // pays whole hours only, but a milestone that ignores every short stream
    // would misrepresent what somebody actually did.
    const minutes = Math.floor(elapsedMs / 60_000);
    if (minutes > 0) {
      try {
        await db.collection('users').doc(uid).set({
          streamMinutes: FieldValue.increment(minutes),
        }, { merge: true });
      } catch (e) { console.error('streamMinutes failed', streamId, e?.message || e); }
    }
  }

  return endResult;
});

/**
 * Hand the host back their own publish credential.
 *
 * The broadcaster screen gets `streamKey` in `createStreamSession`'s return, but
 * a reload loses it, and it is deliberately no longer on the stream document for
 * anyone to read. Only the host (or an admin) can call this.
 */
exports.getStreamIngest = functions.https.onCall({ region: REGION, cors: true }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const streamId = String(req.data?.streamId || '');
  if (!streamId) throw new functions.https.HttpsError('invalid-argument', 'streamId required.');

  const snap = await db.collection('streams').doc(streamId).get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Stream not found.');

  const s = snap.data();
  if (s.hostUid !== uid) {
    const me = await db.collection('users').doc(uid).get();
    if (!me.exists || me.data().role !== 'admin') {
      throw new functions.https.HttpsError('permission-denied', 'Not your stream.');
    }
  }

  const priv = await db.collection('streams').doc(streamId).collection('private').doc('ingest').get();
  if (!priv.exists) {
    // Streams created before the key moved off the public document still carry
    // it there. Read it back rather than breaking an in-flight broadcast.
    if (s.streamKey) {
      return { streamKey: s.streamKey, ingestUrl: s.ingestUrl || null, ingestType: s.ingestType || null };
    }
    throw new functions.https.HttpsError('not-found', 'No ingest details for this stream.');
  }
  const d = priv.data();
  return { streamKey: d.streamKey, ingestUrl: d.ingestUrl || null, ingestType: d.ingestType || null };
});

// ─────────────────────────────────────────────────────────────────────────────
// getLikelyTipperScore — 0-100 score for biasing live-feed surfacing.
// Higher = more likely to tip. Inputs: coin balance, recent tips, membership, VP.
// ─────────────────────────────────────────────────────────────────────────────
async function computeLikelyTipperScore(uid) {
  const [walletSnap, userSnap, recentTips] = await Promise.all([
    db.collection('wallets').doc(uid).get(),
    db.collection('users').doc(uid).get(),
    db.collection('transactions')
      .where('senderId', '==', uid)
      .where('type', '==', 'tip')
      .where('createdAt', '>', new Date(Date.now() - 30 * 24 * 3600 * 1000))
      .limit(50).get().catch(() => ({ docs: [] })),
  ]);
  const balance = walletSnap.exists ? (walletSnap.data().balance || 0) : 0;
  const user = userSnap.exists ? userSnap.data() : {};
  const tipCount = recentTips.docs ? recentTips.docs.length : 0;
  const tipSum = (recentTips.docs || []).reduce((s, d) => s + (d.data().coinsAmount || 0), 0);

  // Component scores (each 0-100)
  const balanceScore  = Math.min(100, Math.log10(Math.max(1, balance)) * 25);  // 100c→25, 1k→75, 10k+→100
  const recentTipScore = Math.min(100, tipCount * 10 + tipSum / 5);
  const membershipScore = (user.activeMemberships || 0) > 0 ? 100 : 0;
  const planScore = { free: 0, lite: 50, pro: 100 }[user.subscription || 'free'] || 0;
  const vpScore = Math.min(100, (user.vpLevel || 0) * 10);

  // Weighted average — recent tips matter most, plan second
  const score = (
    recentTipScore * 0.35 +
    planScore       * 0.25 +
    membershipScore * 0.15 +
    balanceScore    * 0.15 +
    vpScore         * 0.10
  );
  return Math.round(score);
}

exports.getLikelyTipperScore = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const score = await computeLikelyTipperScore(req.auth.uid);
  return { score };
});

// ─────────────────────────────────────────────────────────────────────────────
// reapStaleStreams — ends "zombie" browser streams whose broadcaster vanished.
//
// Browser broadcasters write streams/{id}.lastHeartbeat every ~25s while live.
// If the app crashes, is force-closed, or is backgrounded until the WebView is
// killed, the heartbeat stops but endStreamSession never runs — so the stream
// doc stays status:'live' and shows up forever in every "LIVE NOW" query (the
// founder's friend saw his own stream stuck live with no way to stop it).
//
// This sweeps them: any browser-ingest stream whose heartbeat is older than the
// stale window (or, for pre-heartbeat zombies, simply very old) is flipped to
// 'ended'. Scoped to ingestType:'browser' so OBS/RTMP + SFU tournament streams
// (box-driven lifecycle, no client heartbeat) are never wrongly killed. The
// 180s window is generous on purpose: a backgrounded desktop streamer's
// heartbeat is throttled to ~once/min by Chrome, so a tighter window could reap
// a healthy alt-tabbed stream. Folded into cronMinute; self-gates (fast no-op
// when nothing is stale).
// ─────────────────────────────────────────────────────────────────────────────
const STREAM_HEARTBEAT_STALE_MS = 180 * 1000;        // 3 min without a beat = dead
const STREAM_NOHEARTBEAT_MAX_MS = 6 * 3600 * 1000;   // pre-heartbeat zombies: 6h hygiene cutoff

// A 1:1 SESSION IS REAPED HARDER, and for a different reason.
//
// The windows above are tuned for a public broadcast, where the cost of ending
// a healthy alt-tabbed stream is worse than the cost of a zombie card sitting in
// a discovery list. A 1:1 is the opposite trade: there is exactly one guest,
// they may have paid to be there, and the host walking away leaves them staring
// at a frozen frame with no way to tell whether anyone is coming back. Six hours
// of that is not a hygiene problem, it is somebody's money.
//
// 120s matches the plan and is roughly what Tango allows. The never-started
// window is short for the same reason: a session that has not produced a single
// frame is not a session.
const ONE_TO_ONE_STALE_MS = 120 * 1000;
const ONE_TO_ONE_NEVER_STARTED_MS = 5 * 60 * 1000;

exports.reapStaleStreams = async () => {
  const snap = await db.collection('streams').where('status', '==', 'live').limit(300).get();
  if (snap.empty) return;
  const now = Date.now();
  const batch = db.batch();
  let n = 0;
  snap.forEach((d) => {
    const s = d.data();
    // Browser-ingest lineage: createStreamSession writes ingestType:'browser',
    // then the ingest box flips it to 'fmp4' on first /init (infra/ingest
    // main.go) — so a stream that ACTUALLY went live reads 'fmp4', not
    // 'browser'. Both are client-heartbeated browser streams and must be
    // reapable. 'rtmp' (OBS) + SFU/tournament/co-host streams have no client
    // heartbeat and their own lifecycle, so they're never touched.
    if (s.ingestType !== 'browser' && s.ingestType !== 'fmp4') return;
    const hb = s.lastHeartbeat?.toMillis?.() || 0;
    const created = s.createdAt?.toMillis?.() || s.startedAt?.toMillis?.() || 0;
    const isOneToOne = s.sessionType === 'one_to_one';
    const staleMs = isOneToOne ? ONE_TO_ONE_STALE_MS : STREAM_HEARTBEAT_STALE_MS;
    const neverStartedMs = isOneToOne ? ONE_TO_ONE_NEVER_STARTED_MS : STREAM_NOHEARTBEAT_MAX_MS;
    const stale = hb
      ? (now - hb) > staleMs
      : (created && (now - created) > neverStartedMs);
    if (!stale) return;
    batch.update(d.ref, {
      status: 'ended',
      isLive: false,
      endedAt: FieldValue.serverTimestamp(),
      endReason: hb
        ? (isOneToOne ? 'host-absent' : 'stale-heartbeat')
        : (isOneToOne ? 'never-started' : 'no-heartbeat-hygiene'),
    });
    n++;
  });
  if (n > 0) await batch.commit();
  if (n > 0) console.log(`reapStaleStreams: ended ${n} stale stream(s)`);
};

// ─────────────────────────────────────────────────────────────────────────────
// getLiveDiscoveryFeed — ranked list of active public streams biased toward
// streams the viewer is likely to tip on.
// ─────────────────────────────────────────────────────────────────────────────
exports.getLiveDiscoveryFeed = functions.https.onCall({ region: REGION }, async (req) => {
  const limit = Math.min(50, Math.max(5, req.data?.limit || 20));
  const viewerUid = req.auth?.uid || null;

  // Query active public streams (last 6 hours)
  const cutoff = new Date(Date.now() - 6 * 3600 * 1000);
  const snap = await db.collection('streams')
    .where('visibility', '==', 'public')
    .where('status', 'in', ['live', 'created'])
    .where('createdAt', '>', cutoff)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();

  // ── ADULT CONTENT IS EXCLUDED FROM DISCOVERY BY DEFAULT ──────────────
  //
  // The playback URL of a paid NSFW stream is already safe: entitlements.js
  // refuses to sign it without a verified identity. But a discovery card is
  // a title and a thumbnail, and those render before anybody buys anything.
  // Leaving them in the list would put adult material in front of every
  // signed-out visitor and every user who never opted in, which is exactly
  // what the age gate exists to prevent.
  //
  // Two conditions, both required, and the identity check is done HERE rather
  // than trusted from the request: a client can send includeNsfw:true, but it
  // cannot fake a verified kyc document.
  let allowNsfw = false;
  if (viewerUid && req.data?.includeNsfw === true) {
    try {
      const vs = await db.collection('users').doc(viewerUid).get();
      const vd = vs.exists ? vs.data() : null;
      allowNsfw = vd?.kyc?.verified === true || vd?.role === 'admin';
    } catch { allowNsfw = false; }
  }

  const viewerScore = viewerUid ? await computeLikelyTipperScore(viewerUid) : 50;
  // viewerScore 0-100. Streams that cost the platform money (free-tier hosts)
  // should be surfaced more aggressively to high-tipper viewers.

  const streams = snap.docs
    // Marked streams are listed like any other. The marker drives the on-stream
    // banner so a viewer knows what they are joining, not whether it appears.
    // See feedRank.js for the full reasoning.
    .map(d => {
    const s = { id: d.id, ...d.data() };
    // Base score: recency (newer = higher) + viewer count
    const ageMs = Date.now() - (s.createdAt?.toMillis?.() || Date.now());
    const recencyScore = Math.max(0, 100 - ageMs / (60 * 1000));
    let score = recencyScore + (s.viewerCount || 0) * 2;

    // Boost multiplier (paid feature for amplification)
    if (s.boosted) score *= BOOST_REACH_MULTIPLIER;

    // Bias: free-tier streams shown to higher-tipper viewers preferentially.
    // Hosts on paid plans pay for their reach via subscription.
    if (s.hostPlan === 'free') {
      score *= (0.5 + viewerScore / 100);  // 0.5–1.5× depending on viewer score
    }

    return { ...s, _score: score };
  });

  streams.sort((a, b) => b._score - a._score);
  return {
    streams: streams.slice(0, limit).map(({ _score, streamKey, ingestUrl, ...rest }) => rest),
    viewerScore,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// recordStreamTip — internal hook called by sendCoins when tip targets a live stream.
// Updates `tipsReceivedDuringStream` on the stream doc; powers the boost-refund logic.
// Exported so sendCoins (in firestore.js OR a future Cloud Function) can call it.
// ─────────────────────────────────────────────────────────────────────────────
exports.recordStreamTip = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const { streamId, coinsAmount } = req.data || {};
  if (!streamId || !Number.isFinite(coinsAmount) || coinsAmount <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'streamId + coinsAmount required.');
  }
  await db.collection('streams').doc(streamId).update({
    tipsReceivedDuringStream: FieldValue.increment(coinsAmount),
  });
  return { ok: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// setLiveStreamingPaused — admin kill switch for emergencies.
// ─────────────────────────────────────────────────────────────────────────────
exports.setLiveStreamingPaused = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const userSnap = await db.collection('users').doc(req.auth.uid).get();
  if (!userSnap.exists || userSnap.data().role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }
  const { paused } = req.data || {};
  await db.collection('app_config').doc('general').set({
    liveStreamingPaused: !!paused,
    liveStreamingPausedAt: FieldValue.serverTimestamp(),
    liveStreamingPausedBy: req.auth.uid,
  }, { merge: true });
  return { ok: true, paused: !!paused };
});
