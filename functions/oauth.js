// Generic OAuth2 sign-in for Connected Accounts. Handles Twitch and Discord,
// and nothing else.
//
// ⚠ EVERY OTHER PLATFORM ON THAT SCREEN IS A DISPLAY LINK, NOT A CONNECTION.
// Founder decision 2026-09-08: Steam, Riot, Battle.net, EA/Origin, Xbox,
// PlayStation, Epic and YouTube are a handle the user types and we show on
// their profile. They had an OAuth app, a client secret and in some cases an
// approval process, all to store a username nothing read afterwards. Three of
// them (Riot, EA, PlayStation) never had a provider entry at all and returned a
// raw "Unsupported platform" error when tapped.
//
// Twitch and Discord stayed because something genuinely consumes their token:
// Twitch drives the stream mirror and its chat bridge, Discord drives the
// server clone and role rewards.
//
// Flow:
//   1. Frontend calls `getOAuthStartUrl({ platform })` (callable). We mint a
//      single-use state CSRF token, persist it in `oauth_states/{token}` with
//      uid + platform + 10-min TTL, and return the provider's authorize URL.
//   2. Frontend does `window.location.href = url`. Provider authenticates the
//      user and redirects to `/auth/<platform>/callback?code=...&state=...`.
//   3. Hosting rewrites that path to the `oauthCallback` HTTP function. We
//      validate state, exchange the code for a token, fetch the provider's
//      profile, write `linkedAccounts.<platform>` on the user doc, then
//      303-redirect the browser back to /settings/linked.
//
// SECRETS — these are declared via defineSecret so values live ONLY in
// Google Secret Manager. The deploy step injects them as env vars at runtime.
// Set with: `firebase functions:secrets:set <NAME>`. Never commit values.
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const crypto = require('crypto');
const axios = require('axios');

const db = getFirestore('vgrdb');

// Twitch and Discord are the only real OAuth links left. Everything else on the
// Linked accounts screen is a display link the user types in, so YouTube,
// Battle.net, Epic and Xbox (OpenXBL) no longer have an app, a client secret or
// an approval process to keep alive. Their secrets were disabled after this
// shipped; do not re-add a defineSecret here without re-enabling the version
// first, or both functions below will fail to start.
const TWITCH_CLIENT_ID = defineString('TWITCH_CLIENT_ID');
const TWITCH_CLIENT_SECRET = defineSecret('TWITCH_CLIENT_SECRET');
const DISCORD_CLIENT_ID = defineString('DISCORD_CLIENT_ID');
const DISCORD_CLIENT_SECRET= defineSecret('DISCORD_CLIENT_SECRET');

// ⚠⚠ EVERY SECRET IN THIS ARRAY IS BOUND TO BOTH getOAuthStartUrl AND
// oauthCallback, so it is one shared blast radius: disabling any one of these
// secrets in Secret Manager stops BOTH functions from starting, for every
// provider, not just the one the secret belongs to. That is why the 2026-09-08
// display-link change had to remove providers from the code and redeploy BEFORE
// their secrets could be disabled, never the other way round.
//
// Twitch and Discord only. The rest became display links: the user types their
// handle and we show it, because nothing ever read those tokens afterwards.
const ALL_SECRETS = [TWITCH_CLIENT_SECRET, DISCORD_CLIENT_SECRET];

const APP_BASE = 'https://vergr-44494.web.app';
const REDIRECT = (platform) => `${APP_BASE}/auth/${platform}/callback`;
// Where we send the user AFTER the link is written. Must be the canonical
// vergr.app domain (NOT web.app): on web it returns the user to the origin they
// started on (so their Firebase session + the live profile listener are intact,
// instead of stranding them on web.app logged-out); on native it is a verified
// Android App Link, so the system browser hands control back to the app at
// /settings/linked where the live linkedAccounts update is already painted.
const RETURN_BASE = 'https://vergr.app';

// Per-provider config. `id` is the linkedAccounts key. `idEnv` / `secretEnv`
// reference the defineSecret handles above. `extractUser(token, clientId)`
// returns { id, username, avatar } pulled from the provider's profile API.
const PROVIDERS = {
  twitch: {
    id: 'twitch',
    authUrl: 'https://id.twitch.tv/oauth2/authorize',
    tokenUrl: 'https://id.twitch.tv/oauth2/token',
    // Mirror scopes:
    //   channel:read:stream_key — fetch the user's Twitch stream key so Vergr's
    //     nginx-rtmp can relay (re-push) the incoming OBS feed straight to Twitch.
    //   chat:read / chat:edit    — the vergr-chat relay joins the broadcaster's
    //     Twitch IRC channel to bridge chat both ways while mirrored.
    scopes: 'user:read:email channel:read:stream_key chat:read chat:edit',
    idEnv: TWITCH_CLIENT_ID,
    secretEnv: TWITCH_CLIENT_SECRET,
    extractUser: async (token, clientId) => {
      const r = await axios.get('https://api.twitch.tv/helix/users', {
        headers: { Authorization: `Bearer ${token}`, 'Client-Id': clientId },
      });
      const u = r.data?.data?.[0] || {};
      return {
        id: u.id,
        username: u.display_name || u.login,
        login: u.login || null,
        avatar: u.profile_image_url || null,
      };
    },
    // postLink runs AFTER linkedAccounts is written. For Twitch we capture the
    // stream key + tokens into a SERVER-ONLY secrets doc that the Hetzner relay
    // + chat bridge read via the Admin SDK (firestore.rules deny all client
    // access). Failure here is non-fatal: the account still links, mirroring
    // just stays unavailable until a re-connect succeeds.
    postLink: async ({ accessToken, refreshToken, profile, clientId, expiresIn, scope, uid, db, FieldValue, Timestamp }) => {
      let mirrorReady = false;
      try {
        const keyRes = await axios.get('https://api.twitch.tv/helix/streams/key', {
          params: { broadcaster_id: profile.id },
          headers: { Authorization: `Bearer ${accessToken}`, 'Client-Id': clientId },
        });
        const streamKey = keyRes.data?.data?.[0]?.stream_key || null;
        if (streamKey) {
          await db.collection('twitch_mirror_secrets').doc(uid).set({
            twitchUserId: profile.id,
            twitchLogin: profile.login || (profile.username || '').toLowerCase(),
            twitchDisplayName: profile.username || null,
            streamKey,
            accessToken,
            refreshToken: refreshToken || null,
            scope: Array.isArray(scope) ? scope.join(' ') : (scope || ''),
            expiresAt: expiresIn ? Timestamp.fromMillis(Date.now() + expiresIn * 1000) : null,
            obtainedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          mirrorReady = true;
        }
      } catch (err) {
        console.error('twitch postLink (stream key) failed', err?.response?.data || err?.message || err);
      }
      // Flag on the public linkedAccounts so the UI knows mirroring is wired
      // (NOT the key itself — that stays in the locked secrets doc).
      await db.collection('users').doc(uid).set({
        'linkedAccounts.twitch.mirrorReady': mirrorReady,
        'linkedAccounts.twitch.login': profile.login || (profile.username || '').toLowerCase() || null,
        // Auto-mirror: once Twitch is linked, going live on Twitch surfaces on
        // Vergr (pollTwitchMirrors). Detection works even without the chat/key
        // scopes; the user can opt out by flipping this off.
        twitchMirrorEnabled: true,
      }, { merge: true });
    },
  },
  discord: {
    id: 'discord',
    authUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scopes: 'identify',
    idEnv: DISCORD_CLIENT_ID,
    secretEnv: DISCORD_CLIENT_SECRET,
    extractUser: async (token) => {
      const r = await axios.get('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const u = r.data || {};
      return {
        id: u.id,
        username: u.global_name || u.username,
        avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png` : null,
      };
    },
  },
};

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Callable: returns the provider authorize URL with a fresh state token.
// For OpenXBL the flow is non-standard — xbl.io's /app/auth/{key} endpoint
// has no state/redirect_uri params; the redirect URL is configured on
// xbl.io's dashboard. We still mint a state row keyed by a token AND return
// it so the SPA can set a `vergr_oauth_state` cookie before redirecting; the
// callback reads the cookie to identify the user.
exports.getOAuthStartUrl = onCall({ secrets: ALL_SECRETS }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const platform = String(request.data?.platform || '').toLowerCase();

  const stateToken = crypto.randomBytes(32).toString('hex');
  await db.collection('oauth_states').doc(stateToken).set({
    uid, platform,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + STATE_TTL_MS),
  });

  const cfg = PROVIDERS[platform];
  if (!cfg) throw new HttpsError('invalid-argument', `Unsupported platform: ${platform}`);

  // Guard against un-provisioned providers: if the client_id secret is still a
  // placeholder (e.g. Epic = "PENDING_EPIC_APPROVAL" until Epic approves our
  // app), don't send the user to the provider's raw "invalid client" error
  // page — surface a friendly "coming soon" the client toasts instead. Resolves
  // automatically the moment a real client_id is set.
  const clientId = cfg.idEnv.value();
  if (!clientId || /^(PENDING|PLACEHOLDER|CHANGEME|TODO)/i.test(clientId)) {
    const label = platform === 'epicgames' ? 'Epic Games' : platform;
    throw new HttpsError('failed-precondition', `${label} connect is coming soon — we're finishing setup with ${label}.`);
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT(platform),
    response_type: 'code',
    scope: cfg.scopes,
    state: stateToken,
    ...(cfg.extraAuthParams || {}),
  });
  return { url: `${cfg.authUrl}?${params.toString()}` };
});

// ── HTTP: provider redirects the browser here. Validates state, exchanges
// the code for a token, persists the linked-account info, redirects back
// to the SPA. Wired via a hosting rewrite for /auth/<platform>/callback.
exports.oauthCallback = onRequest({ secrets: ALL_SECRETS, cors: false }, async (req, res) => {
  // Pull platform from the rewritten path: /auth/<platform>/callback.
  const m = (req.path || req.url || '').match(/^\/auth\/([^/]+)\/callback/);
  const platform = (m?.[1] || '').toLowerCase();
  const cfg = PROVIDERS[platform];
  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  const errParam = String(req.query.error || '');

  const redirectBack = (status, message) => {
    const u = new URL(`${RETURN_BASE}/settings/linked`);
    u.searchParams.set('linked', platform || 'unknown');
    u.searchParams.set('status', status);
    if (message) u.searchParams.set('msg', message);
    res.redirect(303, u.toString());
  };

  if (errParam) return redirectBack('error', errParam);

  if (!cfg)     return redirectBack('error', 'unsupported_platform');
  if (!code || !state) return redirectBack('error', 'missing_code_or_state');

  try {
    const stateRef = db.collection('oauth_states').doc(state);
    const stateSnap = await stateRef.get();
    if (!stateSnap.exists) return redirectBack('error', 'invalid_state');
    const sd = stateSnap.data();
    if (sd.platform !== platform) return redirectBack('error', 'state_platform_mismatch');
    if (sd.expiresAt?.toMillis() < Date.now()) {
      await stateRef.delete().catch(() => {});
      return redirectBack('error', 'state_expired');
    }
    const uid = sd.uid;
    await stateRef.delete().catch(() => {}); // single-use

    // Exchange code → access token.
    const tokenRes = await axios.post(
      cfg.tokenUrl,
      new URLSearchParams({
        client_id: cfg.idEnv.value(),
        client_secret: cfg.secretEnv.value(),
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT(platform),
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    const accessToken = tokenRes.data?.access_token;
    const refreshToken = tokenRes.data?.refresh_token || null;
    const expiresIn = tokenRes.data?.expires_in || null;
    const grantedScope = tokenRes.data?.scope || null;
    if (!accessToken) return redirectBack('error', 'no_access_token');

    const profile = await cfg.extractUser(accessToken, cfg.idEnv.value());
    if (!profile?.id) return redirectBack('error', 'no_profile');

    // Encrypt-at-rest is a separate hardening pass; for now we store the
    // refresh token as-is (Firestore is encrypted at rest by Google) but
    // gate access via the user's own document scope. TODO: KMS-encrypt.
    await db.collection('users').doc(uid).set({
      [`linkedAccounts.${platform}`]: {
        id: profile.id,
        username: profile.username || null,
        avatar: profile.avatar || null,
        connectedAt: FieldValue.serverTimestamp(),
        refreshToken: refreshToken,
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // Provider-specific post-link (e.g. Twitch captures the stream key + tokens
    // into the locked twitch_mirror_secrets doc). Non-fatal.
    if (typeof cfg.postLink === 'function') {
      try {
        await cfg.postLink({
          accessToken, refreshToken, profile,
          clientId: cfg.idEnv.value(),
          expiresIn, scope: grantedScope,
          uid, db, FieldValue, Timestamp,
        });
      } catch (e) {
        console.error('postLink error', platform, e?.message || e);
      }
    }

    return redirectBack('ok', null);
  } catch (err) {
    console.error('oauthCallback error', platform, err?.response?.data || err);
    return redirectBack('error', 'exchange_failed');
  }
});
