// Phase 4 — Withdrawal pipeline (USDC on Base via Circle Programmable Wallets).
//
// Spec: CLAUDE.md → "[Option 1] Self-custodied USDC wallet" + "Live streaming
// architecture" hard rules. Locked design:
//   - Gems debited atomically at request time (escrow)
//   - 3-day hold (changed from 7d on 2026-05-20 — see Edit history)
//   - 1-hour cancel window after submission
//   - Per-tx cap €5,000, per-24h cap €10,000, batch cap 20 / €20,000
//   - KYC tiers gate amounts (L0 blocked, L1 €50/mo, L2 €500/d €2.5k/mo, L3 €2.5k/d €15k/mo)
//   - 2% platform spread on every withdrawal
//   - Whitelisted destination addresses only (per-user list, 24h cooldown on add)
//   - Atomic gem ledger + audit row + Circle API call gated on idempotency key
//
// State machine on payout_requests/{id}.status:
//   pending     - submitted, in hold period (or first hour, cancellable)
//   processing  - submitted to Circle API, awaiting on-chain confirmation
//   sent        - Circle confirmed transactions.outbound.complete
//   failed      - Circle returned an error; gems refunded
//   cancelled   - user cancelled within 1h window; gems refunded
//
// Hard rule (CLAUDE.md): all amount math in integer micro-USDC. Never floats.
//   1 USDC  = 1,000,000 micro-USDC
//   1 gem   = €0.01 = 0.01 USDC = 10,000 micro-USDC (sandbox 1:1 EUR↔USD assumption)

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const crypto = require('node:crypto');
const axios = require('axios');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

// ── Secrets (declared at module scope per Gen2 conventions) ───────────
const CIRCLE_API_KEY        = defineSecret('CIRCLE_API_KEY');
const CIRCLE_ENTITY_SECRET  = defineSecret('CIRCLE_ENTITY_SECRET');
const CIRCLE_HOT_WALLET_ID  = defineSecret('CIRCLE_HOT_WALLET_ID');
const CIRCLE_BLOCKCHAIN     = defineSecret('CIRCLE_BLOCKCHAIN');

const trimEnv = (n) => (process.env[n] || '').replace(/[\s\r\n]+$/g, '').trim();
const isPlaceholder = (v) => !v || typeof v !== 'string' || v.startsWith('placeholder');

// ── Constants ─────────────────────────────────────────────────────────
const HOLD_DURATION_MS    = 3 * 24 * 60 * 60 * 1000;   // 3-day hold
const CANCEL_WINDOW_MS    = 60 * 60 * 1000;            // 1 hour cancel window
const PLATFORM_SPREAD_BPS = 200;                        // 2% (basis points)
const GEM_TO_MICRO_USDC   = 10_000;                     // 1 gem = 0.01 USDC

const PER_TX_MAX_MICRO    = 5_000_000_000;              // €5,000
const PER_24H_MAX_MICRO   = 10_000_000_000;             // €10,000
const BATCH_MAX_COUNT     = 20;
const BATCH_MAX_MICRO     = 20_000_000_000;             // €20,000 batch sum

// KYC tier monthly + daily caps (in micro-USDC)
const KYC_LIMITS = {
  0: { daily: 0,             monthly: 0,             cryptoOnly: true, blocked: true  },
  1: { daily: 0,             monthly: 5_000_000_000, cryptoOnly: true, blocked: false }, // €50/mo
  2: { daily: 500_000_000,   monthly: 2_500_000_000, cryptoOnly: false, blocked: false },// €500/d €2,500/mo
  3: { daily: 2_500_000_000, monthly: 15_000_000_000,cryptoOnly: false, blocked: false },// €2.5k/d €15k/mo
};

// ── Unlock token verification (mirror of functions/wallet.js) ─────────
const PIN_UNLOCK_TTL_SEC = 5 * 60;
function verifyUnlockToken(uid, token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [issuedAtStr, sig] = token.split('.');
  const issuedAt = parseInt(issuedAtStr, 10);
  if (!issuedAt || Date.now() - issuedAt > PIN_UNLOCK_TTL_SEC * 1000) return false;
  const secret = process.env.WALLET_UNLOCK_SECRET || 'dev-only-replace-me';
  const expectedSig = crypto.createHmac('sha256', secret).update(`${uid}:${issuedAt}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'));
  } catch { return false; }
}

function requireAuthUid(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be signed in.');
  if (request.auth.token?.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('permission-denied', 'Guest accounts cannot withdraw.');
  }
  return uid;
}

// ── Address validation ───────────────────────────────────────────────
function normalizeEvmAddress(addr) {
  if (typeof addr !== 'string') return null;
  const t = addr.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(t)) return null;
  return t.toLowerCase();
}

// ── KYC limit check ──────────────────────────────────────────────────
async function checkKycLimits(uid, kycLevel, requestedMicro, destinationType) {
  const tier = KYC_LIMITS[kycLevel] ?? KYC_LIMITS[0];
  if (tier.blocked) {
    throw new HttpsError('failed-precondition', 'Complete KYC verification to withdraw.');
  }
  if (tier.cryptoOnly && destinationType === 'bank') {
    throw new HttpsError('failed-precondition', 'Bank withdrawals require KYC Level 2.');
  }
  if (requestedMicro > PER_TX_MAX_MICRO) {
    throw new HttpsError('failed-precondition', `Per-transaction limit is €${(PER_TX_MAX_MICRO/1e6).toFixed(0)}.`);
  }

  // Sum recent withdrawals (status != cancelled/failed) in the rolling 24h + 30d windows.
  const now = Date.now();
  const day = now - 24 * 60 * 60 * 1000;
  const month = now - 30 * 24 * 60 * 60 * 1000;

  const snap = await db.collection('payout_requests')
    .where('userId', '==', uid)
    .where('requestedAt', '>=', new Date(month))
    .get();

  let used24h = 0;
  let used30d = 0;
  snap.forEach((d) => {
    const r = d.data();
    if (r.status === 'cancelled' || r.status === 'failed') return;
    const amt = r.amountMicroUSDC || 0;
    used30d += amt;
    if (r.requestedAt?.toMillis?.() >= day) used24h += amt;
  });

  if (tier.daily && used24h + requestedMicro > tier.daily) {
    throw new HttpsError('failed-precondition',
      `Daily KYC L${kycLevel} cap reached. €${((tier.daily - used24h) / 1e6).toFixed(2)} remaining today.`);
  }
  if (used30d + requestedMicro > tier.monthly) {
    throw new HttpsError('failed-precondition',
      `Monthly KYC L${kycLevel} cap reached. €${((tier.monthly - used30d) / 1e6).toFixed(2)} remaining this month.`);
  }
}

// ════════════════════════════════════════════════════════════════════
// CIRCLE API HELPERS — entity secret encryption + transfer call
// ════════════════════════════════════════════════════════════════════
//
// Circle requires a fresh `entitySecretCiphertext` per write. We fetch their
// RSA public key once, cache it in memory, then encrypt the hex-decoded
// entity secret with OAEP-SHA256 padding on every call.

let _entityPubKeyCache = { key: null, fetchedAt: 0 };
const ENTITY_PUBKEY_TTL_MS = 24 * 60 * 60 * 1000;

async function getCircleEntityPublicKey() {
  const now = Date.now();
  if (_entityPubKeyCache.key && (now - _entityPubKeyCache.fetchedAt < ENTITY_PUBKEY_TTL_MS)) {
    return _entityPubKeyCache.key;
  }
  const apiKey = trimEnv('CIRCLE_API_KEY');
  const resp = await axios.get('https://api.circle.com/v1/w3s/config/entity/publicKey', {
    headers: { Authorization: `Bearer ${apiKey}` },
    timeout: 10000,
  });
  const pem = resp.data?.data?.publicKey;
  if (!pem) throw new HttpsError('internal', 'Circle public key fetch returned no key');
  _entityPubKeyCache = { key: pem, fetchedAt: now };
  return pem;
}

async function makeEntitySecretCiphertext() {
  const entitySecretHex = trimEnv('CIRCLE_ENTITY_SECRET');
  if (isPlaceholder(entitySecretHex)) {
    throw new HttpsError('failed-precondition', 'CIRCLE_ENTITY_SECRET not configured');
  }
  const entitySecretBytes = Buffer.from(entitySecretHex, 'hex');
  if (entitySecretBytes.length !== 32) {
    throw new HttpsError('failed-precondition', 'CIRCLE_ENTITY_SECRET must be 32 bytes (64 hex chars)');
  }
  const pubKeyPem = await getCircleEntityPublicKey();
  const pubKey = crypto.createPublicKey(pubKeyPem);
  const ciphertext = crypto.publicEncrypt(
    { key: pubKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    entitySecretBytes
  );
  return ciphertext.toString('base64');
}

// USDC contract address on Base + Base Sepolia (same address by Circle convention).
const USDC_TOKEN_ADDRESS = {
  'BASE':         '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  'BASE-SEPOLIA': '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
};

async function circleTransferUSDC({ destAddress, amountUSDC, refId }) {
  const apiKey = trimEnv('CIRCLE_API_KEY');
  const walletId = trimEnv('CIRCLE_HOT_WALLET_ID');
  const blockchain = trimEnv('CIRCLE_BLOCKCHAIN') || 'BASE-SEPOLIA';
  if (isPlaceholder(apiKey) || !walletId) {
    throw new HttpsError('failed-precondition', 'Circle credentials not configured');
  }
  const tokenAddress = USDC_TOKEN_ADDRESS[blockchain];
  if (!tokenAddress) {
    throw new HttpsError('failed-precondition', `Unknown blockchain: ${blockchain}`);
  }

  const entitySecretCiphertext = await makeEntitySecretCiphertext();
  const idempotencyKey = crypto.randomUUID();

  const body = {
    idempotencyKey,
    walletId,
    destinationAddress: destAddress,
    amounts: [String(amountUSDC)],
    tokenAddress,
    blockchain,
    feeLevel: 'MEDIUM',
    entitySecretCiphertext,
    refId: refId || undefined,
  };

  const resp = await axios.post(
    'https://api.circle.com/v1/w3s/developer/transactions/transfer',
    body,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Request-Id': idempotencyKey,
      },
      timeout: 15000,
      validateStatus: () => true,
    }
  );

  if (resp.status >= 400) {
    const err = new Error(`Circle transfer failed (${resp.status}): ${JSON.stringify(resp.data)}`);
    err.circleStatus = resp.status;
    err.circleBody = resp.data;
    throw err;
  }
  return {
    circleTxId: resp.data?.data?.id || null,
    state: resp.data?.data?.state || null,
    idempotencyKey,
  };
}

// ════════════════════════════════════════════════════════════════════
// CALLABLE: requestWithdrawal
// ════════════════════════════════════════════════════════════════════
//
// Atomic transaction:
//   1. Verify unlock token (fresh PIN session).
//   2. Verify destination is a whitelisted address (crypto tab) or bank flag.
//   3. Verify KYC level allows the amount + destination type.
//   4. Read user wallet inside tx; check sufficient gems.
//   5. Debit gems atomically into escrow.
//   6. Write payout_requests/{auto} with status=pending.

exports.requestWithdrawal = functions.https.onCall(
  // VERGR_GEO_TOKEN: lets functions/geo.js verify that geo headers came from
  // the Cloudflare Worker rather than a forged direct call.
  { region: REGION, secrets: ['VERGR_GEO_TOKEN'] },
  async (request) => {
    const uid = requireAuthUid(request);
    const {
      gemsRequested,
      destinationType, // 'crypto' | 'bank'
      destinationAddress,
      unlockToken,
    } = request.data || {};

    if (!Number.isInteger(gemsRequested) || gemsRequested <= 0) {
      throw new HttpsError('invalid-argument', 'gemsRequested must be a positive integer.');
    }
    if (gemsRequested < 1000) {
      throw new HttpsError('failed-precondition', 'Minimum withdrawal is 1,000 gems.');
    }
    if (destinationType !== 'crypto' && destinationType !== 'bank') {
      throw new HttpsError('invalid-argument', 'destinationType must be "crypto" or "bank".');
    }

    if (!verifyUnlockToken(uid, unlockToken)) {
      throw new HttpsError('failed-precondition', 'Wallet unlock required.');
    }

    // ── Region gate ───────────────────────────────────────────────────
    // Blocks on the LIVE request country (founder decision 2026-07-28):
    // a VPN is tolerated for using the app, but a payout must not be
    // initiated from a sanctioned / crypto-prohibited jurisdiction.
    // This is the ONLY server-side geo check on the payout path — the
    // signup-time check in SignUpStep1 is client-side and bypassable,
    // so do not treat it as enforcement and do not remove this.
    // assertRegionAllowed throws for a blocked country and returns
    // { country: 'ZZ', founder: true } for the admin/founder bypass.
    // requireKnownCountry: a payout is the one place an unresolvable location
    // must be a refusal. Without it, bypassing the Cloudflare geo proxy and
    // calling the Functions origin directly would sail straight through.
    const { assertRegionAllowed } = require('./geo');
    const geo = await assertRegionAllowed(request, { requireKnownCountry: true });

    let normalizedDest = null;
    if (destinationType === 'crypto') {
      normalizedDest = normalizeEvmAddress(destinationAddress);
      if (!normalizedDest) {
        throw new HttpsError('invalid-argument', 'Invalid EVM destination address.');
      }
    }

    // Convert gems → micro-USDC + apply 2% platform spread
    const grossMicro    = gemsRequested * GEM_TO_MICRO_USDC;
    const spreadMicro   = Math.floor(grossMicro * PLATFORM_SPREAD_BPS / 10_000);
    const netMicro      = grossMicro - spreadMicro;

    // KYC limits check (reads recent payout history)
    const userSnap = await db.collection('users').doc(uid).get();
    const walletSnap = await db.collection('wallets').doc(uid).get();
    const userData = userSnap.data() || {};
    const walletData = walletSnap.data() || {};
    const kycLevel = walletData.kycLevel ?? userData.kycLevel ?? 0;

    // Admin bypass for sandbox testing (matches PIN bypass policy)
    const isAdmin = userData.role === 'admin';
    if (!isAdmin) {
      await checkKycLimits(uid, kycLevel, grossMicro, destinationType);
    }

    // Whitelist enforcement on crypto tab — verify the address is on the user's list
    if (destinationType === 'crypto') {
      const whitelist = Array.isArray(walletData.whitelistedAddresses) ? walletData.whitelistedAddresses : [];
      const match = whitelist.find((w) => normalizeEvmAddress(w.address) === normalizedDest);
      if (!match && !isAdmin) {
        throw new HttpsError('failed-precondition',
          'Destination address is not whitelisted. Add it from Security → Addresses first.');
      }
    }

    const now = Date.now();
    const releasesAt = new Date(now + HOLD_DURATION_MS);
    const cancelDeadline = new Date(now + CANCEL_WINDOW_MS);
    const payoutRef = db.collection('payout_requests').doc();

    // Atomic: debit gems + write payout doc
    await db.runTransaction(async (tx) => {
      const w = await tx.get(db.collection('wallets').doc(uid));
      if (!w.exists) throw new HttpsError('failed-precondition', 'Wallet not found.');
      const wd = w.data();
      if ((wd.gems || 0) < gemsRequested) {
        throw new HttpsError('failed-precondition', 'Insufficient gem balance.');
      }
      if (wd.walletFrozen) {
        throw new HttpsError('failed-precondition', 'Wallet is frozen.');
      }

      tx.update(db.collection('wallets').doc(uid), {
        gems: FieldValue.increment(-gemsRequested),
        gemsInEscrow: FieldValue.increment(gemsRequested),
        updatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(payoutRef, {
        userId: uid,
        status: 'pending',
        destinationType,
        destinationAddress: normalizedDest || null,
        gemsRequested,
        amountMicroUSDC: grossMicro,
        spreadMicroUSDC: spreadMicro,
        netMicroUSDC: netMicro,
        netUSDC: (netMicro / 1e6).toFixed(6),
        kycLevelAtRequest: kycLevel,
        // Compliance audit trail. requestCountry is where the payout was
        // initiated from (Cloudflare CF-IPCountry); kycCountry is the
        // country on the verified identity document. A mismatch does NOT
        // block — it is recorded so a screening question can be answered
        // after the fact rather than guessed at.
        requestCountry:  geo.country || null,
        requestRegion:   geo.region || null,
        kycCountry:      (userData.kyc && userData.kyc.country) || null,
        countryMismatch: Boolean(
          geo.country && !geo.founder &&
          userData.kyc && userData.kyc.country &&
          userData.kyc.country !== geo.country
        ),
        requestedAt: FieldValue.serverTimestamp(),
        releasesAt,
        cancelDeadline,
        circleTxId: null,
        circleTxHash: null,
        adminBypass: isAdmin || null,
      });

      tx.set(db.collection('transactions').doc(), {
        userId: uid,
        type: 'withdrawal_requested',
        amount: -gemsRequested,
        currency: 'gems',
        description: `Withdrawal requested: ${gemsRequested} gems`,
        meta: { payoutId: payoutRef.id, destinationType, grossMicro, spreadMicro, netMicro },
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    functions.logger.info('withdrawal requested', {
      uid, payoutId: payoutRef.id, gemsRequested, destinationType, netMicro,
    });

    return {
      ok: true,
      payoutId: payoutRef.id,
      cancelDeadline: cancelDeadline.toISOString(),
      releasesAt: releasesAt.toISOString(),
      netUSDC: (netMicro / 1e6).toFixed(6),
    };
  }
);

// ════════════════════════════════════════════════════════════════════
// CALLABLE: cancelWithdrawal
// ════════════════════════════════════════════════════════════════════
//
// Cancellable while status=pending AND now < cancelDeadline. Refunds escrowed
// gems atomically.

exports.cancelWithdrawal = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const uid = requireAuthUid(request);
    const { payoutId } = request.data || {};
    if (!payoutId || typeof payoutId !== 'string') {
      throw new HttpsError('invalid-argument', 'payoutId required.');
    }

    await db.runTransaction(async (tx) => {
      const ref = db.collection('payout_requests').doc(payoutId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError('not-found', 'Withdrawal not found.');
      const p = snap.data();
      if (p.userId !== uid) {
        throw new HttpsError('permission-denied', 'Not your withdrawal.');
      }
      if (p.status !== 'pending') {
        throw new HttpsError('failed-precondition', `Cannot cancel a ${p.status} withdrawal.`);
      }
      const cancelDeadline = p.cancelDeadline?.toMillis?.() || 0;
      if (Date.now() > cancelDeadline) {
        throw new HttpsError('failed-precondition', 'Cancel window expired.');
      }

      tx.update(ref, {
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
      });
      tx.update(db.collection('wallets').doc(uid), {
        gems: FieldValue.increment(p.gemsRequested),
        gemsInEscrow: FieldValue.increment(-p.gemsRequested),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('transactions').doc(), {
        userId: uid,
        type: 'withdrawal_cancelled',
        amount: p.gemsRequested,
        currency: 'gems',
        description: `Withdrawal cancelled — gems refunded`,
        meta: { payoutId },
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    functions.logger.info('withdrawal cancelled', { uid, payoutId });
    return { ok: true };
  }
);

// ════════════════════════════════════════════════════════════════════
// CALLABLE: getMyWithdrawals (paginated list for History tab)
// ════════════════════════════════════════════════════════════════════

exports.getMyWithdrawals = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const uid = requireAuthUid(request);
    const limit = Math.min(Math.max(parseInt(request.data?.limit, 10) || 25, 1), 100);
    const snap = await db.collection('payout_requests')
      .where('userId', '==', uid)
      .orderBy('requestedAt', 'desc')
      .limit(limit)
      .get();
    const rows = snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        status: x.status,
        destinationType: x.destinationType,
        destinationAddress: x.destinationAddress || null,
        gemsRequested: x.gemsRequested,
        netUSDC: x.netUSDC,
        requestedAt: x.requestedAt?.toMillis?.() || null,
        releasesAt: x.releasesAt?.toMillis?.() || null,
        cancelDeadline: x.cancelDeadline?.toMillis?.() || null,
        sentAt: x.sentAt?.toMillis?.() || null,
        cancelledAt: x.cancelledAt?.toMillis?.() || null,
        failedAt: x.failedAt?.toMillis?.() || null,
        circleTxHash: x.circleTxHash || null,
        failureReason: x.failureReason || null,
      };
    });
    return { ok: true, rows };
  }
);

// ════════════════════════════════════════════════════════════════════
// SCHEDULED: processReadyWithdrawals — every 15 min
// ════════════════════════════════════════════════════════════════════
//
// Picks up pending withdrawals past their releasesAt + crypto destination,
// caps the batch at BATCH_MAX_COUNT and BATCH_MAX_MICRO, calls Circle's
// transfer API for each, flips status to 'processing'. On API error we
// refund gems + mark failed. The outbound Circle webhook flips 'processing'
// → 'sent' on confirmation.

exports.processReadyWithdrawals = functions.scheduler.onSchedule(
  {
    schedule: 'every 15 minutes',
    region: REGION,
    timeZone: 'UTC',
    secrets: [CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_HOT_WALLET_ID, CIRCLE_BLOCKCHAIN],
    memory: '512MiB',
    timeoutSeconds: 540,
  },
  async () => {
    if (isPlaceholder(trimEnv('CIRCLE_API_KEY')) || isPlaceholder(trimEnv('CIRCLE_ENTITY_SECRET'))) {
      functions.logger.info('processReadyWithdrawals skipped — Circle creds not configured');
      return;
    }

    const now = new Date();
    const snap = await db.collection('payout_requests')
      .where('status', '==', 'pending')
      .where('destinationType', '==', 'crypto')
      .where('releasesAt', '<=', now)
      .orderBy('releasesAt', 'asc')
      .limit(BATCH_MAX_COUNT * 2) // overfetch; we'll cap by amount sum too
      .get();

    if (snap.empty) {
      functions.logger.info('processReadyWithdrawals: nothing ready');
      return;
    }

    let batchCount = 0;
    let batchMicroSum = 0;
    const results = [];

    for (const doc of snap.docs) {
      if (batchCount >= BATCH_MAX_COUNT || batchMicroSum >= BATCH_MAX_MICRO) break;
      const p = doc.data();
      const grossMicro = p.amountMicroUSDC || 0;
      const netMicro   = p.netMicroUSDC || grossMicro;
      if (batchMicroSum + grossMicro > BATCH_MAX_MICRO) continue;

      // Re-check 24h cap right at batch time (defense against accumulated drift).
      const dayAgo = new Date(Date.now() - 24*60*60*1000);
      const day = await db.collection('payout_requests')
        .where('userId', '==', p.userId)
        .where('requestedAt', '>=', dayAgo)
        .get();
      let used24h = 0;
      day.forEach((d) => {
        const r = d.data();
        if (r.status === 'cancelled' || r.status === 'failed') return;
        used24h += r.amountMicroUSDC || 0;
      });
      if (used24h > PER_24H_MAX_MICRO) {
        functions.logger.warn('processReadyWithdrawals: user over 24h cap, skipping',
          { uid: p.userId, used24h, cap: PER_24H_MAX_MICRO });
        continue;
      }

      // Mark processing FIRST so a retry won't double-send.
      try {
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(doc.ref);
          if (!fresh.exists || fresh.data().status !== 'pending') {
            throw new Error('race: status changed');
          }
          tx.update(doc.ref, {
            status: 'processing',
            processingStartedAt: FieldValue.serverTimestamp(),
          });
        });
      } catch (err) {
        functions.logger.info('processReadyWithdrawals: skip (status race)', { payoutId: doc.id });
        continue;
      }

      // Submit to Circle
      try {
        const amountUSDC = (netMicro / 1e6).toFixed(6);
        const res = await circleTransferUSDC({
          destAddress: p.destinationAddress,
          amountUSDC,
          refId: `vergr:payout:${doc.id}`,
        });
        await doc.ref.update({
          circleTxId: res.circleTxId,
          circleSubmittedAt: FieldValue.serverTimestamp(),
          circleState: res.state || 'UNKNOWN',
        });
        batchCount += 1;
        batchMicroSum += grossMicro;
        results.push({ payoutId: doc.id, circleTxId: res.circleTxId, ok: true });
      } catch (err) {
        // Circle rejected → refund gems, mark failed.
        functions.logger.error('processReadyWithdrawals: Circle transfer failed', {
          payoutId: doc.id,
          message: err.message,
          status: err.circleStatus || null,
          body: err.circleBody || null,
        });
        await refundFailedPayout(doc.id, err.message);
        results.push({ payoutId: doc.id, ok: false, error: err.message });
      }
    }

    functions.logger.info('processReadyWithdrawals batch done', {
      attempted: results.length,
      sent: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      batchMicroSum,
    });
  }
);

// ════════════════════════════════════════════════════════════════════
// SHARED: refund + mark failed
// ════════════════════════════════════════════════════════════════════
//
// Used both by processReadyWithdrawals on Circle API rejection AND by the
// outbound webhook when Circle reports an on-chain failure after submission.

async function refundFailedPayout(payoutId, reason) {
  await db.runTransaction(async (tx) => {
    const ref = db.collection('payout_requests').doc(payoutId);
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const p = snap.data();
    if (p.status === 'sent' || p.status === 'failed' || p.status === 'cancelled') return;

    tx.update(ref, {
      status: 'failed',
      failedAt: FieldValue.serverTimestamp(),
      failureReason: reason || 'unknown',
    });
    tx.update(db.collection('wallets').doc(p.userId), {
      gems: FieldValue.increment(p.gemsRequested),
      gemsInEscrow: FieldValue.increment(-p.gemsRequested),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection('transactions').doc(), {
      userId: p.userId,
      type: 'withdrawal_failed',
      amount: p.gemsRequested,
      currency: 'gems',
      description: `Withdrawal failed — gems refunded`,
      meta: { payoutId, reason },
      createdAt: FieldValue.serverTimestamp(),
    });
  });
}

exports._internal_refundFailedPayout = refundFailedPayout;

// ════════════════════════════════════════════════════════════════════
// SHARED: outbound webhook hook — flip processing → sent | failed
// ════════════════════════════════════════════════════════════════════
//
// Called by circleWallets.js when Circle pushes a transactions.outbound.*
// event. Matches by circleTxId; idempotent on terminal states.

async function handleOutboundWebhook(tx) {
  const circleTxId = tx.id || tx.transactionId || null;
  if (!circleTxId) return false;

  const state = (tx.state || tx.status || '').toUpperCase();
  // Find the matching payout. We expect refId to be `vergr:payout:<id>` from
  // our submit code, but fall back to a circleTxId index for safety.
  let payoutId = null;
  if (typeof tx.refId === 'string' && tx.refId.startsWith('vergr:payout:')) {
    payoutId = tx.refId.split(':')[2];
  }
  if (!payoutId) {
    const q = await db.collection('payout_requests')
      .where('circleTxId', '==', circleTxId)
      .limit(1)
      .get();
    if (q.empty) return false;
    payoutId = q.docs[0].id;
  }

  const ref = db.collection('payout_requests').doc(payoutId);

  if (state === 'COMPLETE' || state === 'COMPLETED' || state === 'CONFIRMED') {
    await ref.update({
      status: 'sent',
      sentAt: FieldValue.serverTimestamp(),
      circleTxHash: tx.txHash || tx.transactionHash || null,
      circleState: state,
    });
    // The user has already had gems debited at request time; nothing to refund.
    // Just clear the escrow counter.
    const snap = await ref.get();
    const p = snap.data() || {};
    if ((p.gemsRequested || 0) > 0) {
      await db.collection('wallets').doc(p.userId).update({
        gemsInEscrow: FieldValue.increment(-p.gemsRequested),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return true;
  }

  if (state === 'FAILED' || state === 'CANCELLED' || state === 'DENIED') {
    await refundFailedPayout(payoutId, `Circle reported state=${state}`);
    return true;
  }

  // Intermediate states (QUEUED, SENT, INITIATED, etc) — just record.
  await ref.update({ circleState: state });
  return true;
}

exports._internal_handleOutboundWebhook = handleOutboundWebhook;

// ════════════════════════════════════════════════════════════════════
// ADMIN: release withdrawal immediately (bypass 3-day hold + cron wait)
// ════════════════════════════════════════════════════════════════════
//
// Lets the founder approve a pending withdrawal and submit to Circle in one
// step. The 3-day hold is the user-protection layer — admin can bypass it
// when they've manually reviewed the user + withdrawal context. Audited.

exports.adminReleaseWithdrawalNow = functions.https.onCall(
  {
    region: REGION,
    secrets: [CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_HOT_WALLET_ID, CIRCLE_BLOCKCHAIN],
  },
  async (request) => {
    const adminUid = requireAuthUid(request);
    const { payoutId, reason } = request.data || {};
    if (!payoutId || typeof payoutId !== 'string') {
      throw new HttpsError('invalid-argument', 'payoutId required.');
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length < 4) {
      throw new HttpsError('invalid-argument', 'Reason required (min 4 chars).');
    }

    // Verify caller is admin (founder or scoped-economy sub-admin).
    const adminSnap = await db.collection('users').doc(adminUid).get();
    if (adminSnap.data()?.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin only.');
    }

    const ref = db.collection('payout_requests').doc(payoutId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Withdrawal not found.');
    const p = snap.data();
    if (p.status !== 'pending') {
      throw new HttpsError('failed-precondition', `Cannot release a ${p.status} withdrawal.`);
    }
    if (p.destinationType !== 'crypto') {
      throw new HttpsError('failed-precondition', 'Only crypto withdrawals can be released by this flow.');
    }

    // Mark processing FIRST so the cron doesn't double-submit.
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (!fresh.exists || fresh.data().status !== 'pending') {
        throw new HttpsError('failed-precondition', 'Status changed mid-flight.');
      }
      tx.update(ref, {
        status: 'processing',
        processingStartedAt: FieldValue.serverTimestamp(),
        releasedEarlyBy: adminUid,
        releasedEarlyReason: String(reason).slice(0, 400),
      });
    });

    // Submit to Circle. On failure, refund + mark failed.
    try {
      const netMicro = p.netMicroUSDC || p.amountMicroUSDC || 0;
      const amountUSDC = (netMicro / 1e6).toFixed(6);
      const res = await circleTransferUSDC({
        destAddress: p.destinationAddress,
        amountUSDC,
        refId: `vergr:payout:${payoutId}`,
      });
      await ref.update({
        circleTxId: res.circleTxId,
        circleSubmittedAt: FieldValue.serverTimestamp(),
        circleState: res.state || 'UNKNOWN',
      });
      // Audit
      await db.collection('admin_actions').add({
        actor: { uid: adminUid, role: 'admin' },
        action: 'withdrawal_released_early',
        target: { type: 'payout_request', id: payoutId, userId: p.userId },
        reason: String(reason).slice(0, 400),
        meta: {
          gemsRequested: p.gemsRequested,
          netMicroUSDC: netMicro,
          circleTxId: res.circleTxId,
          originalReleasesAt: p.releasesAt?.toMillis?.() || null,
        },
        createdAt: FieldValue.serverTimestamp(),
      });
      return { ok: true, circleTxId: res.circleTxId, state: res.state };
    } catch (err) {
      functions.logger.error('adminReleaseWithdrawalNow: Circle submit failed', {
        payoutId, message: err.message, status: err.circleStatus,
      });
      await refundFailedPayout(payoutId, `Admin release failed: ${err.message}`);
      throw new HttpsError('internal', `Circle transfer failed: ${err.message}`);
    }
  }
);

// ════════════════════════════════════════════════════════════════════
// ADMIN: nav-badge counts (pending payouts, reports, etc)
// ════════════════════════════════════════════════════════════════════

exports.adminGetNavBadges = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const uid = requireAuthUid(request);
    const userSnap = await db.collection('users').doc(uid).get();
    if (userSnap.data()?.role !== 'admin') {
      // Sub-admins also get this — they need it for their own scope.
      const adminUserSnap = await db.collection('admin_users').doc(uid).get();
      if (!adminUserSnap.exists || adminUserSnap.data()?.status !== 'active') {
        throw new HttpsError('permission-denied', 'Admin only.');
      }
    }

    // Counts. Each query is a count aggregation (1 read per metric).
    const safeCount = async (q) => {
      try { const r = await q.count().get(); return r.data().count; }
      catch { return 0; }
    };

    const [
      pendingPayouts,
      readyPayouts,
      pendingReports,
      unattributedDeposits,
    ] = await Promise.all([
      safeCount(db.collection('payout_requests').where('status', '==', 'pending')),
      safeCount(db.collection('payout_requests').where('status', '==', 'ready')),
      safeCount(db.collection('reports').where('status', '==', 'pending')),
      safeCount(db.collection('unattributed_deposits').where('reconciled', '==', false)),
    ]);

    return {
      ok: true,
      badges: {
        economy:    pendingPayouts + readyPayouts + unattributedDeposits,
        moderation: pendingReports,
      },
      breakdown: {
        pendingPayouts,
        readyPayouts,
        pendingReports,
        unattributedDeposits,
      },
    };
  }
);

// ════════════════════════════════════════════════════════════════════
// ADMIN: withdrawal context (for the manual-review modal)
// ════════════════════════════════════════════════════════════════════
//
// Returns a small dossier on a payout's user: account age, KYC level,
// gem balance, lifetime gems earned, lifetime withdrawals sent, banned
// status. Enough to make an "approve early" decision without leaving the
// withdrawals tab.

exports.adminGetWithdrawalContext = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const adminUid = requireAuthUid(request);
    const adminSnap = await db.collection('users').doc(adminUid).get();
    if (adminSnap.data()?.role !== 'admin') {
      const sub = await db.collection('admin_users').doc(adminUid).get();
      if (!sub.exists || sub.data()?.status !== 'active') {
        throw new HttpsError('permission-denied', 'Admin only.');
      }
    }

    const { payoutId } = request.data || {};
    if (!payoutId) throw new HttpsError('invalid-argument', 'payoutId required.');

    const payoutSnap = await db.collection('payout_requests').doc(payoutId).get();
    if (!payoutSnap.exists) throw new HttpsError('not-found', 'Withdrawal not found.');
    const p = payoutSnap.data();
    const targetUid = p.userId || p.uid;
    if (!targetUid) throw new HttpsError('failed-precondition', 'Payout has no user.');

    const [userSnap, walletSnap, priorPayoutsSnap, txSnap] = await Promise.all([
      db.collection('users').doc(targetUid).get(),
      db.collection('wallets').doc(targetUid).get(),
      db.collection('payout_requests')
        .where('userId', '==', targetUid)
        .where('status', '==', 'sent')
        .limit(50)
        .get(),
      db.collection('transactions')
        .where('userId', '==', targetUid)
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get(),
    ]);

    const u = userSnap.data() || {};
    const w = walletSnap.data() || {};

    const lifetimePayouts = priorPayoutsSnap.size;
    let lifetimePaidMicroUSDC = 0;
    priorPayoutsSnap.forEach(d => {
      lifetimePaidMicroUSDC += d.data().netMicroUSDC || 0;
    });

    const recentTransactions = txSnap.docs.map(d => {
      const x = d.data();
      return {
        type: x.type,
        amount: x.amount,
        currency: x.currency,
        description: x.description || '',
        createdAt: x.createdAt?.toMillis?.() || null,
      };
    });

    return {
      ok: true,
      payout: {
        id: payoutId,
        status: p.status,
        gemsRequested: p.gemsRequested,
        netUSDC: p.netUSDC,
        destinationAddress: p.destinationAddress,
        requestedAt: p.requestedAt?.toMillis?.() || null,
        releasesAt: p.releasesAt?.toMillis?.() || null,
      },
      user: {
        uid: targetUid,
        displayName: u.displayName || u.username || targetUid.slice(0, 8),
        username: u.username || null,
        avatar: u.avatar || null,
        email: u.email || null,
        createdAt: u.createdAt?.toMillis?.() || null,
        accountAgeDays: u.createdAt ? Math.floor((Date.now() - u.createdAt.toMillis()) / (24*60*60*1000)) : null,
        kycLevel: w.kycLevel ?? u.kycLevel ?? 0,
        banned: !!u.banned,
        mutedUntil: u.mutedUntil || null,
        followerCount: u.followerCount || 0,
        role: u.role || 'user',
        vp: w.vp || 0,
      },
      wallet: {
        gems: w.gems || 0,
        gemsInEscrow: w.gemsInEscrow || 0,
        balance: w.balance || 0,
        totalGemsEarned: w.totalGemsEarned || 0,
      },
      history: {
        lifetimePayouts,
        lifetimePaidUSDC: (lifetimePaidMicroUSDC / 1e6).toFixed(2),
        recentTransactions,
      },
    };
  }
);
