// getTurnCredentials — short-lived HMAC creds for our self-hosted coturn
// (running on the Hetzner vergr-stream-1 box at 91.98.79.244:3478).
//
// Pattern: coturn `use-auth-secret` mode. Username = `${expiryUnix}:${uid}`,
// password = base64(HMAC-SHA1(COTURN_SECRET, username)). Server validates
// the HMAC and accepts the credential until `expiryUnix` passes. The secret
// never leaves the server.
//
// Auth: signed-in users only. Anonymous guests don't get TURN — they can
// still attempt P2P via STUN, fallback only for registered accounts.

const functions = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const crypto = require('crypto');

const REGION = 'europe-west1';
const COTURN_SECRET = defineSecret('COTURN_SECRET');

const TURN_HOST = '91.98.79.244';
const TURN_PORT = 3478;
const TTL_SECONDS = 24 * 60 * 60;   // 24h — fits a typical session

exports.getTurnCredentials = functions.https.onCall(
  { region: REGION, secrets: [COTURN_SECRET] },
  async (req) => {
    if (!req.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    }
    const secret = COTURN_SECRET.value();
    if (!secret) {
      throw new functions.https.HttpsError('failed-precondition', 'TURN not configured.');
    }
    const expiry = Math.floor(Date.now() / 1000) + TTL_SECONDS;
    const username = `${expiry}:${req.auth.uid}`;
    const password = crypto.createHmac('sha1', secret).update(username).digest('base64');

    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
          urls: [
            `turn:${TURN_HOST}:${TURN_PORT}?transport=udp`,
            `turn:${TURN_HOST}:${TURN_PORT}?transport=tcp`,
          ],
          username,
          credential: password,
        },
      ],
      ttlSeconds: TTL_SECONDS,
    };
  }
);
