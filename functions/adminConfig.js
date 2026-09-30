// adminConfig.js — Admin → App Config screen callables.
//
// Reads/writes app_config/general (and a sibling section doc per sub-tab when
// the field set gets large). Every write goes through requireAdminScreen('config'),
// is rate-limited, and writes an audit row to admin_actions/. A small set of
// "sensitive" fields additionally require a fresh TOTP step-up.
//
// Callables:
//   adminGetConfig({ section })   - returns the merged config for a sub-tab
//   adminSetConfigField({ key, value, section })
//                                 - writes one field, returns the new value
//   adminBulkSetConfig({ section, fields })
//                                 - writes many fields in one call (save-all)
//   adminListConfigHistory({ limit, cursor })
//                                 - paginated history of config changes
//   adminGetSystemHealth          - 5 real health checks (cached 30s in memory)
//
// Schema:
//   app_config/general            - the single doc that holds every flag.
//   app_config_history/{auto}     - { key, before, after, section, by, at }

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const {
  requireFreshStepUp, adminRateLimit, auditAdminAction, extractRequestMeta,
} = require('./adminSecurity');
const { requireAdminScreen } = require('./adminAccess');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

// Fields that require a fresh TOTP step-up before writing.
const SENSITIVE_FIELDS = new Set([
  // Codapay: who may pay through it. Moves money.
  'codaCheckout',
  'codaSaveCards',
  'playUserChoiceBilling',
  'maintenanceMode',
  'allowNewRegistrations',
  'allowDirectMessages',
  'liveStreamingPaused',
  'payoutsPaused',
  'conversionsPaused',
  'tipsPaused',
  'freeUploadsPaused',
  'botsPaused',
]);

// Sub-tab → whitelist of field keys that may be written.
// Anything not in here is rejected with invalid-argument.
//
// ⚠⚠ EVERY KEY HERE MUST HAVE A READER, OR IT IS A SWITCH THAT LIES.
// Until 2026-09-21 this list held 64 keys and 58 of them were read by NOTHING
// in src/, functions/ or infra/: "Maintenance Mode", "Allow New Registrations",
// an admin IP allowlist, a failed-login lockout, a minimum password length,
// "Custom CSS", quiet hours, retention periods. The operator saved them and
// nothing changed. They were removed from here AND from the screen, so they can
// no longer be written; old values stay inert in the stored doc.
// `scripts/admin-config-check.mjs` fails `npm run check` if a key here has no
// reader outside the config code, so this cannot quietly grow back.
const FIELD_WHITELIST = {
  general: new Set([
    // Read by src/hooks/useAppGate.js → MaintenanceGate (every app route).
    'maintenanceMode',
    // Read by src/hooks/useAppGate.js → every sign-up entry point.
    'allowNewRegistrations',
    // Read by the DM composer (useAppGate) and ENFORCED by the chat relay
    // (infra/chat/src/appconfig.go), which rejects DM sends while it is false.
    'allowDirectMessages',
    // DM/chat media expiry on R2. Both OFF/empty by default and deliberately so:
    // arming this DELETES users' photos and voice notes from the server, and the
    // on-device fallback is Android-only. `chatMediaRetentionDays` is a map
    // { free, lite, pro } in DAYS; a tier that is absent or null is kept forever.
    // Enforced by _cleanupExpiredMedia in functions/index.js.
    'chatMediaExpiryEnabled', 'chatMediaRetentionDays',
  ]),
  features: new Set([
    'liveStreamingPaused',          // functions/streaming.js
    'streamFollowerGateEnabled',    // functions/streaming.js
  ]),
  payments: new Set([
    'conversionsPaused',            // functions/coinLedger.js
    'payoutsPaused',                // functions/creatorPayouts.js
    'tipsPaused',                   // functions/index.js sendTip
    // Codapay browser checkout. Read by functions/payram.js startCodaOrder and
    // by the payment picker. Unset = 'on'.
    'codaCheckout',                 // 'on' | 'staff' | 'off'
    // functions/checkout.js codaExtras: Coda's saved-card list, once Coda enables it.
    'codaSaveCards',
    // src/hooks/useAppGate.js: ask Google for user choice billing in the Play app.
    'playUserChoiceBilling',
  ]),
};

const ALL_SECTIONS = Object.keys(FIELD_WHITELIST);

async function guardCaller(uid, { requireStepUp = false } = {}) {
  await requireAdminScreen(uid, 'config');
  if (requireStepUp) await requireFreshStepUp(uid);
}

// ════════════════════════════════════════════════════════════════════
// READ
// ════════════════════════════════════════════════════════════════════

exports.adminGetConfig = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { section } = request.data || {};
    if (section && !ALL_SECTIONS.includes(section)) {
      throw new HttpsError('invalid-argument', `Unknown section: ${section}`);
    }
    const snap = await db.collection('app_config').doc('general').get();
    const data = snap.exists ? snap.data() : {};
    // Normalize Firestore Timestamp metadata fields to millis for the client.
    if (data && data._updatedAt && typeof data._updatedAt.toMillis === 'function') {
      data._updatedAt = data._updatedAt.toMillis();
    }
    return { config: data || {}, section: section || 'all' };
  }
);

exports.adminListConfigHistory = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const { limit = 25, cursor = null, section = null } = request.data || {};
    let q = db.collection('app_config_history').orderBy('at', 'desc');
    if (section) q = q.where('section', '==', section);
    if (cursor) {
      const cs = await db.collection('app_config_history').doc(cursor).get();
      if (cs.exists) q = q.startAfter(cs);
    }
    const snap = await q.limit(Math.min(100, Math.max(1, limit))).get();
    const rows = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        key: data.key,
        before: data.before,
        after: data.after,
        section: data.section,
        by: data.by || null,
        byName: data.byName || null,
        at: data.at?.toMillis?.() || null,
      };
    });
    const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;
    return { rows, nextCursor };
  }
);

// ════════════════════════════════════════════════════════════════════
// WRITE
// ════════════════════════════════════════════════════════════════════

function findSection(key) {
  for (const sec of ALL_SECTIONS) {
    if (FIELD_WHITELIST[sec].has(key)) return sec;
  }
  return null;
}

async function writeOneField(uid, displayName, meta, key, value) {
  const section = findSection(key);
  if (!section) {
    throw new HttpsError('invalid-argument', `Unknown config field: ${key}`);
  }
  const isSensitive = SENSITIVE_FIELDS.has(key);
  // Values that move money are validated here, not only in the screen.
  if (key === 'codaCheckout' && !['off', 'staff', 'on'].includes(value)) {
    throw new HttpsError('invalid-argument', "codaCheckout must be 'off', 'staff' or 'on'.");
  }

  // Read current value for the before-snapshot.
  const ref = db.collection('app_config').doc('general');
  const before = (await ref.get()).data() || {};
  const beforeVal = before[key] ?? null;

  await ref.set({ [key]: value, _updatedAt: FieldValue.serverTimestamp(), _updatedBy: uid }, { merge: true });

  await db.collection('app_config_history').add({
    key, before: beforeVal, after: value, section,
    by: uid, byName: displayName || null,
    at: FieldValue.serverTimestamp(),
  });

  await auditAdminAction({
    actor:  { uid, displayName: displayName || null },
    action: 'admin_set_config_field',
    target: { type: 'app_config', id: 'general' },
    before: { [key]: beforeVal },
    after:  { [key]: value },
    ip: meta.ip, userAgent: meta.userAgent,
    stepUpEnforced: isSensitive,
    stepUpFresh: isSensitive,
    meta: { section, key, sensitive: isSensitive },
  });

  return { key, value, section, before: beforeVal };
}

exports.adminSetConfigField = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    const { key, value } = request.data || {};
    if (!key) throw new HttpsError('invalid-argument', 'key required');

    const sensitive = SENSITIVE_FIELDS.has(key);
    await guardCaller(uid, { requireStepUp: sensitive });
    await adminRateLimit(uid, 'admin_config_set', { perHour: 200, perDay: 1000 });

    // Look up display name for the history row.
    const u = await db.collection('users').doc(uid).get();
    const displayName = u.data()?.displayName || null;
    const meta = extractRequestMeta(request);

    return await writeOneField(uid, displayName, meta, key, value);
  }
);

exports.adminBulkSetConfig = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    const { fields } = request.data || {};
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      throw new HttpsError('invalid-argument', 'fields object required');
    }
    const keys = Object.keys(fields);
    if (keys.length === 0) return { count: 0, results: [] };
    if (keys.length > 50) throw new HttpsError('invalid-argument', 'Max 50 fields per call');

    const anySensitive = keys.some(k => SENSITIVE_FIELDS.has(k));
    await guardCaller(uid, { requireStepUp: anySensitive });
    await adminRateLimit(uid, 'admin_config_bulk', { perHour: 60, perDay: 300 });

    const u = await db.collection('users').doc(uid).get();
    const displayName = u.data()?.displayName || null;
    const meta = extractRequestMeta(request);

    const results = [];
    const errors = [];
    for (const k of keys) {
      try {
        results.push(await writeOneField(uid, displayName, meta, k, fields[k]));
      } catch (e) {
        errors.push({ key: k, error: e?.message || String(e) });
      }
    }
    return { count: results.length, results, errors };
  }
);

// ════════════════════════════════════════════════════════════════════
// SYSTEM HEALTH — 6 service pills shown in the App Config right rail
// and the Live Stats / Dashboard screens.
// ════════════════════════════════════════════════════════════════════

let healthCache = { at: 0, data: null };

exports.adminGetSystemHealth = functions.https.onCall(
  // R2_BUCKET must be declared as a secret here — without it `process.env.R2_BUCKET`
  // is undefined at runtime even though the secret exists, and the Storage tile
  // shows DOWN as a false negative.
  { region: REGION, cors: true, secrets: [] },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const now = Date.now();
    if (healthCache.data && (now - healthCache.at) < 30_000) {
      return { ...healthCache.data, cached: true };
    }

    const status = (name, ok, detail = '') => ({ name, status: ok ? 'healthy' : 'down', detail });

    // ⚠ Every pill is a real check now. Until 2026-09-21 four of the six
    // ("Cache", "Queue", "Search", "CDN") were the literal `true`: they read
    // healthy with the service on fire. A status light that cannot go red is
    // worse than no light.
    let dbOk = false;
    try { await db.collection('app_config').doc('general').get(); dbOk = true; } catch {}

    // Answers with 2xx inside 5s. No auth, no body kept; these are public
    // health endpoints on our own boxes, plus one small cached CDN object that
    // proves R2 AND Cloudflare in a single request.
    const probe = async (url, method = 'GET') => {
      try {
        const r = await fetch(url, { method, signal: AbortSignal.timeout(5000) });
        return r.ok;
      } catch { return false; }
    };
    const [cdnOk, streamOk, ingestOk, chatOk] = await Promise.all([
      probe('https://cdn.vergr.app/chat-patterns/arcade.png', 'HEAD'),
      probe('https://sfu.vergr.app/healthz'),
      probe('https://sfu.vergr.app/ingest-healthz'),
      probe('https://chat.vergr.app/healthz'),
    ]);
    const r2Configured = !!process.env.R2_BUCKET;

    const data = {
      services: [
        status('Database',        dbOk),
        status('Storage + CDN',   cdnOk && r2Configured, r2Configured ? 'R2 via cdn.vergr.app' : 'R2 secret missing'),
        status('Streaming (SFU)', streamOk),
        status('Browser ingest',  ingestOk),
        status('Chat relay',      chatOk),
      ],
      checkedAt: now,
    };
    healthCache = { at: now, data };
    return data;
  }
);
