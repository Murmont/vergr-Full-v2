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
const { defineSecret, defineString } = require('firebase-functions/params');
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
const CIRCLE_HOT_WALLET_ID = defineString('CIRCLE_HOT_WALLET_ID');
const CIRCLE_BLOCKCHAIN = defineString('CIRCLE_BLOCKCHAIN');
// PEM-formatted ECDSA public key for verifying Circle webhook signatures.
// Founder pastes this from the Circle Console (Notifications / Webhook
// settings — exact location varies). When unset, the function probes a
// list of candidate API endpoints; if those also 404, signature
// verification is skipped with a warning (sandbox bring-up only).
const CIRCLE_NOTIFICATIONS_PUBLIC_KEY = defineString('CIRCLE_NOTIFICATIONS_PUBLIC_KEY');

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
    secrets: [CIRCLE_API_KEY],
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

  // ── Known internal sources ───────────────────────────────────────────
  // PayRam forwards settled payments to its cold wallet, and that cold wallet
  // IS the Circle omnibus. A per-payment forward carries the order's refId and
  // is matched below. A BATCHED forward carries no refId at all, and there is
  // no reason to expect PayRam to sweep one payment at a time: batching is
  // cheaper for them in gas and is the normal design.
  //
  // Without this allowlist every batch sweep would land in
  // `unattributed_deposits` as if it were a stranger's transfer, which is both
  // wrong and the exact noise that hides a real mis-attribution. Matching on the
  // SOURCE ADDRESS is the only signal a batch sweep carries.
  //
  // Config, not a constant, so the PayRam deposit-contract address can be added
  // the moment it is deployed without shipping code:
  //   app_config/general.internalSweepAddresses = ["0x...", ...]
  //
  // ⚠ Only ever list addresses WE control. An address on this list can move USDC
  // into the omnibus without appearing in the reconciliation queue, so a
  // mistaken entry hides money rather than losing it.
  let isInternalSweepSource = false;
  try {
    const cfgSnap = await db.doc('app_config/general').get();
    const list = cfgSnap.exists ? cfgSnap.data()?.internalSweepAddresses : null;
    if (Array.isArray(list) && sourceAddr) {
      const needle = String(sourceAddr).toLowerCase();
      isInternalSweepSource = list.some((a) => String(a || '').toLowerCase() === needle);
    }
  } catch { /* absent config means "no known internal sources", the safe default */ }

  const outcome = await db.runTransaction(async (t) => {
    const snap = await t.get(depRef);
    if (snap.exists) return; // already processed — idempotency win

    // ── Attribution ──
    // PayRam funded purchase → payram_orders/{refId} holds the uid + coin amount
    // the user is owed. Until PayRam wires, every deposit will fall through to
    // the unattributed branch below.
    let attributed = null;
    // A PayRam order that has ALREADY settled is not an anomaly, it is the
    // routine case. See the settlement-sweep branch below for why this is
    // tracked separately instead of being dumped in the anomaly queue.
    let settledOrder = null;
    if (refId) {
      const payramRef = db.collection('payram_orders').doc(refId);
      const payram = await t.get(payramRef);
      if (payram.exists && payram.data().status === 'settled') {
        settledOrder = {
          uid: payram.data().uid || null,
          amountUSD: Number(payram.data().amountUSD) || 0,
          buyerFeesUSD: Number(payram.data().buyerFeesUSD) || 0,
          coins: Number(payram.data().coinsToCredit) || 0,
        };
      }
      if (
        payram.exists &&
        payram.data().status === 'awaiting_settlement' &&
        payram.data().uid &&
        payram.data().kind !== 'subscription' &&   // subs settle only via PayRam webhook/poll
        // ⚠ AN ORDER CARRYING STORE ITEMS SETTLES ONLY VIA settlePayramOrder,
        // for the same reason a subscription does: this branch knows how to
        // credit coins and nothing else. Without the guard a mixed basket would
        // be marked settled here with the coins credited and the VP bonus or
        // boost silently dropped, and the order can only be settled once.
        !(Array.isArray(payram.data().items) && payram.data().items.length) &&
        // Same for a promo bonus: it is credited as boost coins by
        // settlePayramOrder, which this branch knows nothing about.
        !(Number(payram.data().promoBoostCoins) > 0) &&
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
    } else if (settledOrder || isInternalSweepSource) {
      // ── PayRam SETTLEMENT SWEEP ──────────────────────────────────────
      // PayRam is configured to forward settled payments to its cold wallet,
      // and that cold wallet IS the Circle omnibus
      // (0xbb1b1445d73cad5df9925b484996dc1f7f032240 — CIRCLE_HOT_WALLET_ADDRESS
      // and the PayRam cold wallet are the same address by design). So every
      // sweep arrives here as an inbound USDC transfer carrying a refId whose
      // order the PayRam webhook already settled.
      //
      // This is our own float moving between two places we control. It is NOT a
      // deposit, NOT a coin purchase, and above all NOT an anomaly. Before this
      // branch existed it fell into the `else` below and filed an
      // `unattributed_deposits` row on EVERY successful purchase, with the
      // reason string "refId-not-in-payram_orders" — which was actively
      // misleading, because the order is in payram_orders, it is simply already
      // settled. An admin reconciling would have gone looking for an order that
      // was there all along, while the routine sweeps buried the genuine
      // mis-attributions the queue exists to surface.
      //
      // Coins are NOT credited here. The `awaiting_settlement` guard above is
      // what makes that safe, and it stays the only crediting path.
      t.set(depRef, {
        txId, txHash, walletId, blockchain,
        sourceAddress: sourceAddr, destinationAddress: destAddr,
        amount: amountStr, tokenId, refId,
        status: 'settlement_sweep',
        payramOrderId: settledOrder ? refId : null,
        // Which signal identified it. A batch sweep can only ever be matched by
        // source address, so the two are worth telling apart when reconciling.
        sweepMatchedBy: settledOrder ? 'settled-order-refid' : 'internal-source-address',
        source: ctx.source || 'unknown',
        ntype: ctx.ntype || null,
        processedAt: FieldValue.serverTimestamp(),
      });
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
        // Distinguish the two genuinely different failures. "not in
        // payram_orders" used to be claimed for orders that WERE in
        // payram_orders and merely already settled; those are now handled above,
        // so this string is finally accurate.
        reason: refId ? 'refId-not-in-payram_orders' : 'no-refId',
        receivedAt: FieldValue.serverTimestamp(),
      });
    }

    if (settledOrder) return { sweep: true, orderId: refId, settledOrder };
  });

  // Post-commit, guarded: referral coin revenue-share for the buyer's referrer.
  // Same `order:<id>` source key as the PayRam rail so the two can't double-pay.
  if (outcome?.credited && outcome.coins > 0 && outcome.orderId) {
    await creditReferralPurchaseBonus({
      buyerUid: outcome.uid, coins: outcome.coins, sourceId: `order:${outcome.orderId}`,
    });
  }

  // ── Reconcile the PayRam settlement fee against what ACTUALLY landed ──
  //
  // At purchase time platformRevenue.js books an ESTIMATED settlement fee, using
  // app_config/general.payramSettlementFeePct (default 3%, the middle of the
  // 1-5% band PayRam publishes). An estimate is the best that can be done there,
  // because the sweep has not happened yet.
  //
  // The sweep is the only place the TRUE fee is observable: PayRam charges it on
  // the way to the cold wallet, so the difference between what the buyer was
  // charged and what arrived in the Circle omnibus IS the fee, net of nothing
  // else. Booking a correction row here means the ledger converges on the real
  // number instead of trusting a constant nobody has verified against an invoice.
  //
  // Guarded and idempotent (distinct sourceId, and `circle_deposits/{txId}`
  // already stopped a repeat before we got here). A reconciliation failure must
  // never affect a sweep that has already landed on-chain.
  if (outcome?.sweep && outcome.orderId && outcome.settledOrder) {
    try {
      const { bookRevenue, _config } = require('./platformRevenue');
      const charged = outcome.settledOrder.amountUSD + outcome.settledOrder.buyerFeesUSD;
      const arrived = Number(amountStr) || 0;
      if (charged > 0 && arrived > 0) {
        const actualFee = charged - arrived;
        const estimatedFee = charged * _config.DEFAULT_PAYRAM_SETTLEMENT_PCT;
        const correction = estimatedFee - actualFee; // +ve: we over-provisioned
        // Only book a correction worth reading. Sub-cent noise is dust, and a
        // ledger full of $0.001 rows is harder to audit than one without them.
        if (Math.abs(correction) >= 0.01) {
          await bookRevenue({
            kind: 'payram_settlement_fee_correction',
            usd: correction,
            sourceId: `sweep:${txId}`,
            uid: outcome.settledOrder.uid,
            meta: {
              payramOrderId: outcome.orderId,
              chargedUsd: charged, arrivedUsd: arrived,
              actualFee, estimatedFee,
              actualPct: charged > 0 ? actualFee / charged : null,
            },
          });
        }
      }
    } catch (e) {
      functions.logger.error('settlement fee reconciliation failed', { txId, err: e?.message || e });
    }
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

  // The outbound leg used to update a `payout_requests` row here. That queue
  // belonged to the user-initiated withdrawal pipeline, deleted 2026-08-16 with
  // the gem unit. Outbound transactions are still RECORDED above; there is just
  // no user-facing request for them to settle against. When a payout partner is
  // wired, creatorPayouts.js owns that reconciliation through its own
  // statements, not through this webhook.
}

// ════════════════════════════════════════════════════════════════════
// POLLING CRON — every 5 minutes
// ════════════════════════════════════════════════════════════════════
//
// Reads Circle's REST API for recent inbound txs and pipes each through
// processInboundDeposit. Idempotency stops double-credit on overlap with the
// webhook. Cursor stored at system/circle_cursor.lastCheckedISO.

// Runs inside a dispatcher cron in index.js (it was its own Cloud Scheduler
// job, and every job past the first three is billed monthly).
exports.pollCircleDeposits = async function pollCircleDeposits() {
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
  };

// Exposed for admin tools + future reconciliation cron.
exports._processInboundDeposit = processInboundDeposit;
exports._logOutboundEvent = logOutboundEvent;
