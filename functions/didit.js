// Didit.me KYC — government-ID age + identity verification.
//
// Didit is a free KYC provider. Verification flow:
//   1. Frontend calls `startKycVerification` (callable). We POST to Didit's
//      `/v3/session/` endpoint with our workflow_id + the user uid as
//      `vendor_data`, and Didit returns a `session_id` + redirect `url`.
//      Frontend redirects the user to that URL.
//   2. User completes Didit's hosted flow (ID photo + selfie + liveness).
//   3. Didit POSTs verification events to `diditWebhook` with
//      `X-Signature` and `X-Timestamp` headers (HMAC-SHA256 over raw body
//      using DIDIT_WEBHOOK_SECRET). We verify, look up the user by
//      `vendor_data` (= uid), and write the verification result onto
//      `users/{uid}.kyc`.
//   4. Every wallet/tournament/payout callable calls `assertKycVerified`
//      and rejects if not `verified === true`.
//
// Secrets (set via `firebase functions:secrets:set <NAME>`):
//   DIDIT_API_KEY            — server-side API key
//   DIDIT_WORKFLOW_ID        — workflow ID configured in Didit dashboard
//   DIDIT_WEBHOOK_SECRET     — webhook signing key from Didit dashboard

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const admin = require('firebase-admin');
const crypto = require('crypto');
const axios = require('axios');

if (admin.apps.length === 0) admin.initializeApp();
const db = getFirestore('vgrdb');

const DIDIT_API_KEY        = defineSecret('DIDIT_API_KEY');
const DIDIT_WORKFLOW_ID    = defineSecret('DIDIT_WORKFLOW_ID');
const DIDIT_WEBHOOK_SECRET = defineSecret('DIDIT_WEBHOOK_SECRET');

const DIDIT_BASE = 'https://verification.didit.me';
const REGION = 'europe-west1';
const MIN_AGE = 18;

// Mirror geo blocklist for defense-in-depth.
const { BLOCKED_COUNTRIES, evaluateBlock } = require('./geo');

// ── Identity fingerprint ────────────────────────────────────────────
// Didit's field names differ per verification module, so we try the common
// paths for a document number and fall back to a name+DOB composite. The raw
// values are hashed with the webhook secret as salt and NEVER stored, so this
// is a comparison key only — it cannot be reversed into someone's ID details.
// Returns null when nothing identifying is present, in which case the caller
// simply stores no hash (absent is handled everywhere as "unknown").
function buildIdentityHash(idv, decision, countryCode) {
  const pick = (...vals) => vals.find((v) => typeof v === 'string' && v.trim().length > 3) || null;
  const docNo = pick(
    idv.document_number, idv.documentNumber, idv.id_number,
    decision?.document_number, decision?.id_number,
  );
  const dob = pick(idv.date_of_birth, idv.birthdate, decision?.date_of_birth);
  const fullName = pick(
    idv.full_name, idv.fullName,
    [idv.first_name, idv.last_name].filter(Boolean).join(' ') || null,
  );

  // Prefer the document number (globally unique per country). Name+DOB is a
  // weaker fallback: it can collide between two genuinely different people,
  // so it is only used when no document number came through.
  const basis = docNo
    ? `doc:${countryCode || '??'}:${docNo}`
    : (fullName && dob ? `nd:${countryCode || '??'}:${fullName}:${dob}` : null);
  if (!basis) return null;

  const salt = process.env.DIDIT_WEBHOOK_SECRET || 'vergr-identity';
  return crypto.createHmac('sha256', salt)
    .update(basis.toLowerCase().replace(/\s+/g, ''))
    .digest('hex');
}

function computeAgeFromBirthdate(birthdate) {
  if (!birthdate) return null;
  const dob = new Date(birthdate);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

// ────────────────────────────────────────────────────────────────────────
// startKycVerification — frontend calls this when the user clicks "Verify".
// Creates a Didit session and returns the redirect URL.
// ────────────────────────────────────────────────────────────────────────

exports.startKycVerification = onCall(
  { region: REGION, secrets: [DIDIT_API_KEY, DIDIT_WORKFLOW_ID] },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to verify.');

    // Geo-block.
    const rawHeaders = (request.rawRequest && request.rawRequest.headers) || {};
    const country = String(rawHeaders['cf-ipcountry'] || '').toUpperCase();
    const region  = String(rawHeaders['cf-region-code'] || '').toUpperCase();
    const status  = evaluateBlock(country, region);
    if (status.blocked) {
      throw new HttpsError('permission-denied', 'Verification is not available in your region.');
    }

    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) throw new HttpsError('not-found', 'User not found.');
    const user = userSnap.data();

    if (user.kyc && user.kyc.verified === true) {
      return { alreadyVerified: true };
    }

    let res;
    try {
      res = await axios.post(
        `${DIDIT_BASE}/v3/session/`,
        {
          workflow_id: DIDIT_WORKFLOW_ID.value(),
          // vendor_data is echoed back in the webhook so we can find the user.
          vendor_data: uid,
          // Optional return URL — Didit can redirect the browser here when
          // the user finishes the flow. We send them to the wallet page.
          callback: 'https://vergr.app/wallet?kyc=done',
        },
        {
          headers: {
            'x-api-key': DIDIT_API_KEY.value(),
            'Content-Type': 'application/json',
          },
          timeout: 10_000,
          validateStatus: () => true,
        },
      );
    } catch (err) {
      console.error('[didit] session create network error', err.message);
      throw new HttpsError('internal', 'Could not start verification (network).');
    }

    if (res.status !== 200 && res.status !== 201) {
      console.error('[didit] session create failed', res.status, res.data);
      throw new HttpsError('internal', `Didit error ${res.status}: ${res.data?.message || res.statusText}`);
    }

    const { session_id, url } = res.data || {};
    if (!session_id || !url) {
      console.error('[didit] unexpected response shape', res.data);
      throw new HttpsError('internal', 'Bad Didit response');
    }

    await db.collection('users').doc(uid).set({
      kyc: {
        ...(user.kyc || {}),
        verified: false,
        provider: 'didit',
        lastSessionId: session_id,
        lastAttemptAt: FieldValue.serverTimestamp(),
        attempts: ((user.kyc && user.kyc.attempts) || 0) + 1,
      },
    }, { merge: true });

    return {
      alreadyVerified: false,
      sessionId: session_id,
      verificationUrl: url,
    };
  },
);

// ────────────────────────────────────────────────────────────────────────
// diditWebhook — Didit POSTs verification events here.
// Headers:
//   X-Signature: HMAC-SHA256(raw body) hex using DIDIT_WEBHOOK_SECRET
//   X-Timestamp: unix seconds (we don't enforce a freshness window in v1)
// Payload includes: webhook_type, session_id, vendor_data, decision (when
// session reached a terminal state), workflow_id, metadata.
// ────────────────────────────────────────────────────────────────────────

function verifyDiditSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}

exports.diditWebhook = onRequest(
  { region: REGION, secrets: [DIDIT_WEBHOOK_SECRET] },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('method'); return; }

    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
    const sig = req.get('X-Signature') || req.get('x-signature');
    if (!verifyDiditSignature(rawBody, sig, DIDIT_WEBHOOK_SECRET.value())) {
      console.warn('[didit] signature verification failed');
      res.status(401).send('invalid signature');
      return;
    }

    let body;
    try { body = JSON.parse(rawBody); }
    catch { res.status(400).send('bad json'); return; }

    const webhookType = body.webhook_type || '';
    const sessionId   = body.session_id || null;
    const vendorData  = body.vendor_data || null; // We set this to uid
    const decision    = body.decision || null;

    // Only act on status changes that carry a decision.
    if (!webhookType.startsWith('status.') && !webhookType.startsWith('user.status.')) {
      res.status(200).send('ignored');
      return;
    }

    if (!vendorData) {
      console.warn('[didit] missing vendor_data on event', webhookType, sessionId);
      res.status(200).send('no ref');
      return;
    }

    const userRef = db.collection('users').doc(vendorData);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      console.warn('[didit] user not found for vendor_data', vendorData);
      res.status(200).send('no user');
      return;
    }

    // Didit terminal statuses: Approved | Declined | In Review | Abandoned
    const status = (decision?.status || body.status || '').toLowerCase();

    let result;
    if (status === 'approved') {
      // Pull DOB + country from the decision payload. Field names vary across
      // Didit's verification modules — we check the most common paths.
      const idv = decision?.id_verification || decision?.kyc || {};
      const birthdate = idv.date_of_birth || idv.birthdate || decision?.date_of_birth || null;
      const countryCode = (idv.country_code || idv.country || decision?.country_code || '').toUpperCase() || null;
      const age = computeAgeFromBirthdate(birthdate);

      if (age == null || age < MIN_AGE) {
        result = { verified: false, failureReason: 'underage', sessionId, country: countryCode, checkedAt: FieldValue.serverTimestamp() };
      } else if (countryCode && BLOCKED_COUNTRIES.has(countryCode)) {
        result = { verified: false, failureReason: 'blocked_country', sessionId, country: countryCode, checkedAt: FieldValue.serverTimestamp() };
      } else {
        result = {
          verified: true,
          provider: 'didit',
          verifiedAt: FieldValue.serverTimestamp(),
          sessionId,
          age,
          country: countryCode,
        };
        // Stable per-PERSON fingerprint, salted and hashed — never the raw
        // document number. Two accounts that verify with the same government
        // ID produce the same hash, which is the only deterministic way to
        // know they are one human. Used to block moving value between your
        // own accounts (see gemTransfer.js). We keep no readable ID data.
        const identityHash = buildIdentityHash(idv, decision, countryCode);
        if (identityHash) result.identityHash = identityHash;
      }
    } else {
      result = {
        verified: false,
        provider: 'didit',
        failureReason: status || 'incomplete',
        sessionId,
        checkedAt: FieldValue.serverTimestamp(),
      };
    }

    // `kycLevel` is the NUMBER the rest of the platform gates on: creator
    // eligibility (creatorProgram.js measureRequired), the payout blocking
    // reason and the KYC payment caps (creatorPayouts.js) all read
    // `users/{uid}.kycLevel`, and the wallet tier screen reads the wallet copy.
    // Nothing wrote either field, so a creator could verify with Didit and stay
    // at level 0 forever, which made the creator program impossible to enter
    // and impossible to be paid from. Didit's flow is ID + selfie, which is
    // exactly the level 1 definition; levels 2 and 3 add proof of address and
    // source of funds and are set by an admin when those are collected, so this
    // only ever RAISES to 1 and never lowers an already-higher level.
    // `users/{uid}` is `allow read: if true` — world-readable, signed out
    // included. So the KYC result is SPLIT (audit A30): only the status the
    // rest of the app gates on stays on the public document, and the personal
    // details go to the owner-only private subcollection.
    //
    // What was leaking: `age` and the government-ID `country` of every
    // verified user, and `identityHash` — which the comment above describes
    // exactly right as a "stable per-PERSON fingerprint", deliberately equal
    // for two accounts verified by the same human. World-readable, that is an
    // alt-account correlation oracle for anyone who wants one, and it would
    // link a masked Vanguard moderator to their public account.
    //
    // `identityHash` and `age` have NO readers anywhere (identityHash's only
    // consumer, gemTransfer.js, was deleted). `country` is read by the owner's
    // own CreatorVerificationScreen, which now reads it from the private doc.
    const PRIVATE_KYC_FIELDS = ['age', 'country', 'sessionId', 'identityHash'];
    const publicKyc = {};
    const privateKyc = {};
    for (const [k, v] of Object.entries(result)) {
      (PRIVATE_KYC_FIELDS.includes(k) ? privateKyc : publicKyc)[k] = v;
    }

    const patch = { kyc: publicKyc };
    if (result.verified === true) {
      const current = Number(userSnap.data()?.kycLevel || 0);
      if (current < 1) {
        patch.kycLevel = 1;
        await db.collection('wallets').doc(vendorData).set({ kycLevel: 1 }, { merge: true });
      }
    }
    // update(), NOT set({merge:true}). merge DEEP-merges nested maps, so an
    // `age`/`country`/`identityHash` written by an earlier build would survive
    // on the public doc forever. update() replaces the `kyc` map wholesale,
    // which both writes the new status and migrates the leak away in one go.
    // The doc is known to exist: the !userSnap.exists branch above returns.
    await userRef.update(patch);
    await userRef.collection('private').doc('kyc').set(privateKyc, { merge: true });
    console.log('[didit] processed', sessionId, '→', result.verified ? 'verified' : 'rejected', status);
    res.status(200).send('ok');
  },
);

// ────────────────────────────────────────────────────────────────────────
// assertKycVerified — defense-in-depth callable guard. Same shape as the
// Persona helper it replaces, so existing imports keep working.
// ────────────────────────────────────────────────────────────────────────

exports.assertKycVerified = async function assertKycVerified(uid) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const snap = await db.collection('users').doc(uid).get();
  const data = snap.exists ? snap.data() : null;
  // Founder bypass — `role:'admin'` is the platform owner, not a user
  // subject to KYC. Lets the owner dogfood every gated flow without
  // re-verifying identity. Logged callers should never hit this in prod.
  if (data?.role === 'admin' || (data?.email || '').toLowerCase() === 'vergenerd@gmail.com') return { verified: true, founder: true };
  const kyc = data?.kyc || null;
  if (!kyc || kyc.verified !== true) {
    throw new HttpsError('failed-precondition', 'Identity verification required for this action.');
  }
  return kyc;
};
