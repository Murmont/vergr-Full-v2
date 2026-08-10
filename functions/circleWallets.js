// functions/circleWallets.js — Phase 3 deposit detection
// ─────────────────────────────────────────────────────────────────────
// Locked architecture (CLAUDE.md → "[Option 1 / Path B locked]"):
//   - Hot wallet = single Circle Programmable Wallet (developer-controlled, MPC)
//     on Base USDC. Receives every inbound deposit.
//   - Attribution = PayRam order reference. Direct user deposits without a
//     reference land in unattributed_deposits/ for manual admin reconciliation.
//   - Idempotency = circle_deposits/{txId} doc. Both webhook and poll route
//     through processInboundDeposit() which short-circuits on existing doc.
//
// Two entry points:
//   1. circleWalletsWebhook (HTTPS) — Circle Notifications POSTs here. HMAC-SHA256
//      signature verified against CIRCLE_WEBHOOK_TOKEN. Once the function is
//      deployed, the founder registers the URL in console.circle.com and saves
//      the signing key as that secret.
//   2. pollCircleDeposits (scheduled, every 5 min) — belt-and-suspenders. Reads
//      recent inbound txs via Circle REST and pipes each through the same
//      processInboundDeposit() helper. Catches anything the webhook missed.
//
// Required Firebase secrets (per CLAUDE.md → Circle sandbox provisioning):
//   CIRCLE_API_KEY            (sandbox: TEST_API_KEY:..., mainnet: LIVE_API_KEY:...)
//   CIRCLE_HOT_WALLET_ID      (UUID of the omnibus developer-controlled wallet)
//   CIRCLE_HOT_WALLET_ADDRESS (on-chain address — used by reconciliation, not here)
//   CIRCLE_BLOCKCHAIN         (BASE-SEPOLIA in sandbox, BASE in production)
//   CIRCLE_WEBHOOK_TOKEN      (set AFTER first deploy, once subscription is created)
//
// Not in this file:
//   - Withdrawal pipeline (Phase 4 — outbound transfers signed via Circle API)
//   - Reconciliation drift detection (Phase 6)
//   - PayRam onramp wiring (separate session — this file expects payram_orders/
//     to be populated by the PayRam handler once it ships)

const functions = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('node:crypto');
const axios = require('axios');
const { creditReferralPurchaseBonus } = require('./referralRevenue');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';

// Secrets must be declared at module scope so Cloud Functions Gen2 grants the
// function's service account access at deploy time and binds the values into
// process.env at runtime.
const CIRCLE_API_KEY                  = defineSecret('CIRCLE_API_KEY');
const CIRCLE_HOT_WALLET_ID            = defineSecret('CIRCLE_HOT_WALLET_ID');
const CIRCLE_BLOCKCHAIN               = defineSecret('CIRCLE_BLOCKCHAIN');
// PEM-formatted ECDSA public key for verifying Circle webhook signatures.
// Founder pastes this from the Circle Console (Notifications / Webhook
// settings — exact location varies). When unset, the function probes a
// list of candidate API endpoints; if those also 404, signature
// verification is skipped with a warning (sandbox bring-up only).
const CIRCLE_NOTIFICATIONS_PUBLIC_KEY = defineSecret('CIRCLE_NOTIFICATIONS_PUBLIC_KEY');

// ── Secret accessors ─────────────────────────────────────────────────
// CLAUDE.md flags a recurring bug: secrets set via `echo "x" | firebase ...`
// land with a trailing \n that breaks HTTP headers + signed URLs. Trim every
// secret read just in case.
const trimEnv = (name) => (process.env[name] || '').replace(/[\s\r\n]+$/g, '').trim();

const circleApiBase       = () => 'https://api.circle.com';
const circleApiKey        = () => trimEnv('CIRCLE_API_KEY');
const circleHotWalletId   = () => trimEnv('CIRCLE_HOT_WALLET_ID');
const circleBlockchain    = () => trimEnv('CIRCLE_BLOCKCHAIN') || 'BASE-SEPOLIA';

// Detection of placeholder secrets — same pattern as functions/cryptomus.js.
const isPlaceholder = (v) => !v || typeof v !== 'string' || v.startsWith('placeholder');

// ── Notification public-key cache ─────────────────────────────────────
// Circle's Programmable Wallets webhook uses asymmetric ECDSA-P-256-SHA256
// signing. Each notification carries TWO headers:
//   X-Circle-Key-Id    — UUID identifying which key signed this notification
//   X-Circle-Signature — base64-encoded DER ECDSA signature over the raw body
//
// To verify: GET /v2/notifications/publicKey/{X-Circle-Key-Id} with the API
// key as Bearer auth. The response.data.publicKey is base64-encoded DER (SPKI).
// We cache resolved keys per-keyId in module memory; entries auto-expire.
//
// Manual override: CIRCLE_NOTIFICATIONS_PUBLIC_KEY (PEM) — if set, every
// notification is verified against that single PEM, bypassing the API
// fetch. Useful when Circle rotates infrequently and the founder wants to
// pin the key.

const _circlePubKeyCache = new Map(); // keyId → { keyObject, fetchedAt }
const PUBKEY_CACHE_MS = 60 * 60 * 1000;
let _manualPubKeyObject = null;

// Convert Circle's response (base64 DER SPKI) to a Node KeyObject.
function publicKeyObjectFromBase64Der(b64) {
  const der = Buffer.from(b64, 'base64');
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function loadManualPublicKey() {
  if (_manualPubKeyObject) return _manualPubKeyObject;
  const manual = trimEnv('CIRCLE_NOTIFICATIONS_PUBLIC_KEY');
  if (isPlaceholder(manual)) return null;
  try {
    // Tolerate \n-escaped one-liner secrets, raw multi-line PEMs, or a
    // bare base64 DER string (no PEM header).
    let pem = manual.includes('\\n') ? manual.replace(/\\n/g, '\n') : manual;
    if (pem.includes('BEGIN PUBLIC KEY')) {
      _manualPubKeyObject = crypto.createPublicKey({ key: pem, format: 'pem' });
    } else {
      _manualPubKeyObject = publicKeyObjectFromBase64Der(pem.trim());
    }
    functions.logger.info('circle publicKey loaded from CIRCLE_NOTIFICATIONS_PUBLIC_KEY secret');
    return _manualPubKeyObject;
  } catch (err) {
    functions.logger.error('circle publicKey: manual secret parse failed', err.message);
    return null;
  }
}

async function getCirclePublicKey(keyId, { force = false } = {}) {
  // Manual override takes precedence — single pinned key for all webhooks.
  const manual = loadManualPublicKey();
  if (manual) return manual;

  if (!keyId) {
    functions.logger.warn('circle publicKey: no X-Circle-Key-Id header provided');
    return null;
  }

  const now = Date.now();
  const cached = _circlePubKeyCache.get(keyId);
  if (!force && cached && (now - cached.fetchedAt < PUBKEY_CACHE_MS)) {
    return cached.keyObject;
  }

  const apiKey = circleApiKey();
  if (isPlaceholder(apiKey)) {
    functions.logger.warn('circle publicKey: CIRCLE_API_KEY not configured');
    return null;
  }

  const url = `${circleApiBase()}/v2/notifications/publicKey/${encodeURIComponent(keyId)}`;
  try {
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000,
      validateStatus: () => true,
    });
    if (resp.status >= 400) {
      functions.logger.error('circle publicKey fetch non-2xx', {
        url, status: resp.status, body: resp.data,
      });
      return null;
    }
    const b64 = resp.data?.data?.publicKey || resp.data?.publicKey || null;
    if (!b64) {
      functions.logger.warn('circle publicKey 2xx but no publicKey field', { body: resp.data });
      return null;
    }
    const keyObject = publicKeyObjectFromBase64Der(b64);
    _circlePubKeyCache.set(keyId, { keyObject, fetchedAt: now });
    functions.logger.info('circle publicKey fetched', {
      keyId, algorithm: resp.data?.data?.algorithm || null,
    });
    return keyObject;
  } catch (err) {
    functions.logger.error('circle publicKey fetch threw', {
      url, message: err.message, code: err.code,
    });
    return null;
  }
}

// Verifies the X-Circle-Signature header (base64 ECDSA-P-256-SHA256 DER
// signature over the raw body bytes) against the public key resolved from
// X-Circle-Key-Id. Returns true on success. Retries once with a forced
// refresh of the cached key on failure (covers Circle key rotation mid-flight).
async function verifyCircleSignature(rawBody, signatureB64, keyId) {
  if (!signatureB64) return false;
  let sigBytes;
  try { sigBytes = Buffer.from(signatureB64, 'base64'); }
  catch { return false; }
  if (!sigBytes.length) return false;

  for (const force of [false, true]) {
    const keyObject = await getCirclePublicKey(keyId, { force });
    if (!keyObject) return false;
    try {
      const ok = crypto.verify(
        'sha256',
        Buffer.from(rawBody, 'utf8'),
        { key: keyObject, dsaEncoding: 'der' },
        sigBytes
      );
      if (ok) return true;
    } catch (err) {
      functions.logger.warn('circle verify threw', err.message);
    }
    // First pass uses cache; second pass forces refresh. If both fail, give up.
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════
// WEBHOOK HANDLER (HTTPS)
// ════════════════════════════════════════════════════════════════════
//
// Circle Notifications signs the body with HMAC-SHA256 using the
// subscription's signing key. Header: `X-Circle-Signature` (may be prefixed
// `sha256=`). Body is JSON.
//
// Initial subscription confirmation: Circle sends a small "test" notification
// when the subscription is first created. We accept it and 200. After that,
// every state change on a transaction fires a notification with
// `notificationType` like `transactions.inbound.received`,
// `transactions.inbound.complete`, `transactions.outbound.*`, etc.

exports.circleWalletsWebhook = functions.https.onRequest(
  {
    region: REGION,
    cors: false,
    maxInstances: 4,
    memory: '256MiB',
    secrets: [CIRCLE_API_KEY, CIRCLE_HOT_WALLET_ID, CIRCLE_BLOCKCHAIN, CIRCLE_NOTIFICATIONS_PUBLIC_KEY],
  },
  async (req, res) => {
    if (req.method === 'HEAD') {
      // Circle pings the endpoint with a HEAD request when the webhook is first
      // added in the console; it must 2XX or the subscription won't register.
      res.status(200).end();
      return;
    }
    if (req.method === 'GET') {
      // Some webhook validators do a GET probe. Respond 200 so they don't fail.
      res.status(200).send('ok');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).send('method not allowed');
      return;
    }

    // Raw body needed for signature verification. onRequest v2 provides
    // req.rawBody as a Buffer.
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
    const sigHeader = (
      req.headers['x-circle-signature'] ||
      req.headers['X-Circle-Signature'] ||
      ''
    ).toString().trim();
    const keyIdHeader = (
      req.headers['x-circle-key-id'] ||
      req.headers['X-Circle-Key-Id'] ||
      ''
    ).toString().trim();

    // Debug breadcrumb during bring-up so we can see Circle's exact headers
    // in the function log. Drop this once the pipe is verified working.
    functions.logger.info('circleWebhook headers', {
      hasSig: !!sigHeader,
      sigPrefix: sigHeader.slice(0, 16),
      keyId: keyIdHeader || null,
      contentType: (req.headers['content-type'] || '').toString(),
      userAgent: (req.headers['user-agent'] || '').toString(),
    });

    const apiKeyConfigured = !isPlaceholder(circleApiKey());

    if (apiKeyConfigured && sigHeader) {
      const ok = await verifyCircleSignature(raw, sigHeader, keyIdHeader);
      if (!ok) {
        functions.logger.warn('circleWebhook signature verification FAILED', {
          sigPrefix: sigHeader.slice(0, 16),
          keyId: keyIdHeader || null,
        });
        res.status(401).send('bad signature');
        return;
      }
      functions.logger.info('circleWebhook signature verified', { keyId: keyIdHeader });
    } else if (!apiKeyConfigured) {
      functions.logger.warn('circleWebhook: CIRCLE_API_KEY not configured, accepting unsigned (sandbox bring-up only)');
    } else {
      functions.logger.warn('circleWebhook: no X-Circle-Signature header present, accepting (sandbox bring-up only)');
    }

    let body;
    try { body = JSON.parse(raw); }
    catch { res.status(400).send('bad json'); return; }

    // Subscription confirmation — Circle sends this when you first add a
    // subscription. Spec evolves; we accept on a few possible shapes.
    if (
      body.notificationType === 'webhooks.subscriptionConfirmation' ||
      body.subscriptionConfirmation ||
      body.type === 'subscription_confirmation'
    ) {
      functions.logger.info('circleWebhook subscription confirmation acked', {
        subscriptionId: body.subscriptionId || null,
      });
      res.status(200).json({ ok: true });
      return;
    }

    const ntype = (body.notificationType || body?.notification?.type || '').toString();
    const tx    = body.notification || body.data || body;

    try {
      if (ntype.startsWith('transactions.inbound')) {
        await processInboundDeposit(tx, { source: 'webhook', ntype });
      } else if (ntype.startsWith('transactions.outbound')) {
        await logOutboundEvent(tx, { source: 'webhook', ntype });
      } else {
        functions.logger.info('circleWebhook ignoring event', { ntype });
      }
    } catch (err) {
      // Idempotency tolerates retries, so 200 is safer than a 5xx retry storm.
      functions.logger.error('circleWebhook handler error', err);
    }

    res.status(200).json({ ok: true });
  }
);

// ════════════════════════════════════════════════════════════════════
// DEPOSIT PROCESSOR — shared by webhook + poll
// ════════════════════════════════════════════════════════════════════
//
// One inbound USDC transaction → one of:
//   (a) attributed coin credit (PayRam-funded purchase, attribute by refId)
//   (b) unattributed_deposits/ (direct power-user transfer or refId mismatch)
//
// Idempotent via circle_deposits/{txId}. Re-runs are no-ops.

async function processInboundDeposit(tx, ctx = {}) {
  // Field-name tolerance — webhook payload vs REST poll shape differ slightly.
  const txId       = tx.id || tx.transactionId || tx.txId || null;
  const state      = (tx.state || tx.status || '').toString().toUpperCase();
  const txHash     = tx.txHash || tx.transactionHash || null;
  const sourceAddr = tx.sourceAddress || tx.fromAddress || null;
  const destAddr   = tx.destinationAddress || tx.toAddress || null;
  const walletId   = tx.walletId || null;
  const blockchain = tx.blockchain || circleBlockchain();
  const amounts    = tx.amounts || tx.amount || [];
  const amountStr  = Array.isArray(amounts) ? (amounts[0] || null) : amounts;
  const tokenId    = tx.tokenId || tx.token?.id || null;
  const refId      = tx.refId || tx.reference || tx.metadata?.reference || tx?.metadata?.refId || null;

  if (!txId) {
    functions.logger.warn('circle inbound missing txId', { keys: Object.keys(tx || {}) });
    return;
  }

  // Only act once the tx is final. INITIATED / PENDING / QUEUED will re-fire later.
  const finalStates = new Set(['COMPLETE', 'COMPLETED', 'CONFIRMED']);
  if (!finalStates.has(state)) {
    functions.logger.info('circle inbound non-final state, skipping', { txId, state });
    return;
  }

  // Ignore deposits to wallets other than our omnibus (defence-in-depth in
  // case the same webhook subscription ever covers multiple wallets).
  const hotId = circleHotWalletId();
  if (walletId && hotId && walletId !== hotId) {
    functions.logger.info('circle inbound to non-omnibus wallet, ignoring', { txId, walletId });
    return;
  }

  const depRef = db.collection('circle_deposits').doc(txId);

  const outcome = await db.runTransaction(async (t) => {
    const snap = await t.get(depRef);
    if (snap.exists) return; // already processed — idempotency win

    // ── Attribution ──
    // PayRam funded purchase → payram_orders/{refId} holds the uid + coin amount
    // the user is owed. Until PayRam wires, every deposit will fall through to
    // the unattributed branch below.
    let attributed = null;
    if (refId) {
      const payramRef = db.collection('payram_orders').doc(refId);
      const payram = await t.get(payramRef);
      if (
        payram.exists &&
        payram.data().status === 'awaiting_settlement' &&
        payram.data().uid &&
        payram.data().kind !== 'subscription' &&   // subs settle only via PayRam webhook/poll
        typeof payram.data().coinsToCredit === 'number' &&
        payram.data().coinsToCredit > 0
      ) {
        attributed = {
          uid: payram.data().uid,
          coinsToCredit: payram.data().coinsToCredit,
          vpBonus: typeof payram.data().vpBonus === 'number' ? payram.data().vpBonus : 0,
          payramOrderId: refId,
        };
      }
    }

    if (attributed) {
      // Credit the user's coin balance + ledger row + mark the PayRam order.
      const walletRef = db.doc(`wallets/${attributed.uid}`);
      t.update(walletRef, {
        balance: FieldValue.increment(attributed.coinsToCredit),
        lastDepositAt: FieldValue.serverTimestamp(),
      });
      // VP bonus packs (titan/ascendant) — credit VP too so a Circle-path
      // fallback settlement matches what the PayRam webhook would have done.
      if (attributed.vpBonus > 0) {
        t.update(walletRef, { vp: FieldValue.increment(attributed.vpBonus) });
      }
      t.create(db.collection('transactions').doc(), {
        userId: attributed.uid,
        type: 'coin_purchase',
        currency: 'coins',
        amount: attributed.coinsToCredit,
        source: 'payram',
        circleTxId: txId,
        circleTxHash: txHash,
        payramOrderId: attributed.payramOrderId,
        createdAt: FieldValue.serverTimestamp(),
      });
      t.update(db.collection('payram_orders').doc(refId), {
        status: 'settled',
        settledAt: FieldValue.serverTimestamp(),
        circleTxId: txId,
        circleTxHash: txHash,
      });
      t.set(depRef, {
        txId, txHash, walletId, blockchain,
        sourceAddress: sourceAddr, destinationAddress: destAddr,
        amount: amountStr, tokenId, refId,
        attributedTo: attributed.uid,
        coinsCredited: attributed.coinsToCredit,
        status: 'attributed',
        source: ctx.source || 'unknown',
        ntype: ctx.ntype || null,
        processedAt: FieldValue.serverTimestamp(),
      });
      return { credited: true, uid: attributed.uid, coins: attributed.coinsToCredit, orderId: refId };
    } else {
      // No PayRam match — park for manual admin reconciliation. The user can
      // file a support ticket including their tx hash and the founder matches
      // it up against their identity.
      t.set(depRef, {
        txId, txHash, walletId, blockchain,
        sourceAddress: sourceAddr, destinationAddress: destAddr,
        amount: amountStr, tokenId, refId,
        status: 'unattributed',
        source: ctx.source || 'unknown',
        ntype: ctx.ntype || null,
        processedAt: FieldValue.serverTimestamp(),
      });
      t.create(db.collection('unattributed_deposits').doc(), {
        circleTxId: txId,
        txHash, walletId, blockchain,
        sourceAddress: sourceAddr,
        destinationAddress: destAddr,
        amount: amountStr,
        tokenId, refId,
        reason: refId ? 'refId-not-in-payram_orders' : 'no-refId',
        receivedAt: FieldValue.serverTimestamp(),
      });
    }
  });

  // Post-commit, guarded: referral coin revenue-share for the buyer's referrer.
  // Same `order:<id>` source key as the PayRam rail so the two can't double-pay.
  if (outcome?.credited && outcome.coins > 0 && outcome.orderId) {
    await creditReferralPurchaseBonus({
      buyerUid: outcome.uid, coins: outcome.coins, sourceId: `order:${outcome.orderId}`,
    });
  }

  functions.logger.info('circle inbound processed', { txId, hash: txHash, source: ctx.source });
}

// Outbound events: Phase 4 hook. We log every event for audit AND delegate to
// withdrawals.handleOutboundWebhook which flips the matching payout_requests
// row to 'sent' or 'failed' based on Circle's reported state.
async function logOutboundEvent(tx, ctx = {}) {
  const txId = tx.id || tx.transactionId || null;
  if (!txId) return;
  await db.collection('wallet_op_log').doc(`circle-outbound-${txId}`).set({
    kind: 'circle_outbound',
    txId,
    state: tx.state || tx.status || null,
    txHash: tx.txHash || tx.transactionHash || null,
    sourceAddress: tx.sourceAddress || null,
    destinationAddress: tx.destinationAddress || null,
    amount: Array.isArray(tx.amounts) ? tx.amounts[0] : tx.amount,
    source: ctx.source || 'unknown',
    ntype: ctx.ntype || null,
    recordedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // Update payout_requests row if this tx belongs to a tracked withdrawal.
  try {
    const { _internal_handleOutboundWebhook } = require('./withdrawals');
    const handled = await _internal_handleOutboundWebhook(tx);
    if (handled) functions.logger.info('outbound webhook updated payout', { txId });
  } catch (err) {
    functions.logger.error('outbound webhook payout update failed', { txId, message: err.message });
  }
}

// ════════════════════════════════════════════════════════════════════
// POLLING CRON — every 5 minutes
// ════════════════════════════════════════════════════════════════════
//
// Reads Circle's REST API for recent inbound txs and pipes each through
// processInboundDeposit. Idempotency stops double-credit on overlap with the
// webhook. Cursor stored at system/circle_cursor.lastCheckedISO.

exports.pollCircleDeposits = functions.scheduler.onSchedule(
  {
    schedule: 'every 5 minutes',
    region: REGION,
    timeZone: 'UTC',
    secrets: [CIRCLE_API_KEY, CIRCLE_HOT_WALLET_ID, CIRCLE_BLOCKCHAIN, CIRCLE_NOTIFICATIONS_PUBLIC_KEY],
  },
  async () => {
    const apiKey = circleApiKey();
    if (isPlaceholder(apiKey)) {
      functions.logger.info('pollCircleDeposits skipped — CIRCLE_API_KEY not configured');
      return;
    }
    const walletId = circleHotWalletId();
    if (!walletId) {
      functions.logger.warn('pollCircleDeposits skipped — CIRCLE_HOT_WALLET_ID not configured');
      return;
    }

    const cursorRef = db.doc('system/circle_cursor');
    const cursorSnap = await cursorRef.get();
    const lastChecked = cursorSnap.exists ? cursorSnap.data().lastCheckedISO : null;
    const since = lastChecked || new Date(Date.now() - 30 * 60 * 1000).toISOString();

    let txs = [];
    try {
      const response = await axios.get(`${circleApiBase()}/v1/w3s/transactions`, {
        params: {
          walletIds: walletId,
          txType: 'INBOUND',
          state: 'COMPLETE',
          from: since,
          pageSize: 50,
        },
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15000,
      });
      txs = response.data?.data?.transactions || response.data?.transactions || [];
    } catch (err) {
      functions.logger.error('pollCircleDeposits fetch failed', err?.response?.data || err.message);
      return;
    }

    functions.logger.info(`pollCircleDeposits scanned ${txs.length} txs since ${since}`);

    for (const tx of txs) {
      try {
        await processInboundDeposit(tx, { source: 'poll' });
      } catch (err) {
        functions.logger.error('pollCircleDeposits process tx failed', { id: tx.id }, err);
      }
    }

    await cursorRef.set({
      lastCheckedISO: new Date().toISOString(),
      lastProcessedCount: txs.length,
    }, { merge: true });
  }
);

// Exposed for admin tools + future reconciliation cron.
exports._processInboundDeposit = processInboundDeposit;
exports._logOutboundEvent = logOutboundEvent;
