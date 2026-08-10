// huaweiPush.js — Huawei Push Kit (HMS) sender, the HMS counterpart to FCM.
//
// Huawei phones (2019+) ship WITHOUT Google Play Services, so an FCM token never
// registers there. The native Huawei build registers an HMS push token instead,
// stored in users/{uid}/private/fcm.hmsTokens[] (kept SEPARATE from the FCM
// `tokens` array). This module delivers a DATA-ONLY push to those tokens via the
// Push Kit REST API, mirroring the data-only FCM payload so the native
// HmsMessagingService renders the notification identically.
//
// Uses the PROJECT-LEVEL Push Kit API (AppGallery Connect → Project settings →
// Client info). Credentials (both Firebase secrets):
//   HUAWEI_PUSH_APP_ID        = the project's OAuth Client ID (client_id)
//   HUAWEI_PUSH_CLIENT_SECRET = the project's Client secret (client_secret)
// (The secret is NAMED "APP_ID" for historical reasons but holds the Client ID.)
// The project ID below is NOT secret (shown openly in AGC as Project ID / Sender
// ID). Until the two secrets hold REAL values (seeded to 'placeholder' like
// DISCORD_BOT_TOKEN), sendHuaweiPush is a no-op — so this is safe to deploy
// before AppGallery registration is finished, and it can NEVER throw into / slow
// down the FCM path (callers wrap it in try/catch anyway).
//
// Docs: https://developer.huawei.com/consumer/en/doc/development/HMS-References/push-sendapi

const OAUTH_URL = 'https://oauth-login.cloud.huawei.com/oauth2/v3/token';
// Project-level send endpoint: v2/{projectId}. Project ID is public config and
// MUST match the app's agconnect-services.json (client.project_id) so sends
// target the same project the device registered its HMS token under.
const HUAWEI_PROJECT_ID = '101653523864494762';
const PUSH_URL = `https://push-api.cloud.huawei.com/v2/${HUAWEI_PROJECT_ID}/messages:send`;

// Cached app-level access token (Huawei tokens live 3600s). Module-scoped so
// warm invocations reuse it instead of re-authing on every push.
let tokenCache = { token: null, exp: 0 };

function creds() {
  const clientId = (process.env.HUAWEI_PUSH_APP_ID || '').trim();
  const secret = (process.env.HUAWEI_PUSH_CLIENT_SECRET || '').trim();
  if (!clientId || !secret || clientId === 'placeholder' || secret === 'placeholder') return null;
  return { clientId, secret };
}

async function getAccessToken(clientId, secret) {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.exp) return tokenCache.token;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: secret,
  });
  const resp = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) throw new Error(`hms oauth ${resp.status}`);
  const j = await resp.json();
  if (!j.access_token) throw new Error('hms oauth: no access_token');
  const ttlMs = ((j.expires_in || 3600) - 60) * 1000;
  tokenCache = { token: j.access_token, exp: now + Math.max(ttlMs, 60_000) };
  return j.access_token;
}

/**
 * Send a data-only push to a list of HMS tokens.
 * @param {string[]} tokens  HMS push tokens (users/{uid}/private/fcm.hmsTokens)
 * @param {object} data      flat map — the SAME payload handed to FCM
 * @returns {Promise<{sent:number, failed:number, invalidTokens:string[], skipped?:boolean}>}
 */
async function sendHuaweiPush(tokens, data = {}) {
  const c = creds();
  if (!c || !Array.isArray(tokens) || tokens.length === 0) {
    return { sent: 0, failed: 0, invalidTokens: [], skipped: !c };
  }

  let access;
  try {
    access = await getAccessToken(c.clientId, c.secret);
  } catch (e) {
    return { sent: 0, failed: tokens.length, invalidTokens: [], error: String((e && e.message) || e) };
  }

  // Push Kit wants message.data as a STRING; stringify a fully-stringified map so
  // the native side reads the same key/values as the FCM data payload.
  const strData = {};
  for (const [k, v] of Object.entries(data)) strData[k] = String(v == null ? '' : v);

  let sent = 0;
  let failed = 0;
  const invalidTokens = [];

  // Push Kit accepts up to 1000 tokens/request; chunk at 500 to stay safe.
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    const message = {
      // DATA-ONLY (no `notification` / `android.notification`) so the native
      // HmsMessageService.onMessageReceived fires and our Kotlin builds the
      // VERGR notification — mirrors the FCM data-only design exactly.
      data: JSON.stringify(strData),
      android: { urgency: 'HIGH' }, // wake a Dozing app immediately (calls + IM latency)
      token: chunk,
    };
    try {
      const resp = await fetch(PUSH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ validate_only: false, message }),
      });
      const j = await resp.json().catch(() => ({}));
      // Push Kit result codes:
      //   80000000 = success (whole batch)
      //   80100000 = partial success (msg is JSON with illegal_tokens[])
      //   80300007 = all tokens invalid
      //   80200001 / 80200003 = auth expired → clear cache, this batch fails, next call re-auths
      const code = String(j.code || '');
      if (code === '80000000') {
        sent += chunk.length;
      } else if (code === '80100000') {
        let illegal = [];
        try { illegal = JSON.parse(j.msg || '{}').illegal_tokens || []; } catch { /* ignore */ }
        invalidTokens.push(...illegal);
        sent += chunk.length - illegal.length;
        failed += illegal.length;
      } else if (code === '80300007') {
        invalidTokens.push(...chunk);
        failed += chunk.length;
      } else if (code === '80200001' || code === '80200003') {
        tokenCache = { token: null, exp: 0 };
        failed += chunk.length;
      } else {
        failed += chunk.length;
      }
    } catch (e) {
      failed += chunk.length;
    }
  }

  return { sent, failed, invalidTokens };
}

module.exports = { sendHuaweiPush };
