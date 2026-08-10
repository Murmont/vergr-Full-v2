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
//   adminGetSystemHealth          - 6 service pills (cached 30s in memory)
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
  'maintenanceMode',
  'allowNewRegistrations',
  'liveStreamingPaused',
  'payoutsPaused',
  'conversionsPaused',
  'tipsPaused',
  'freeUploadsPaused',
  'botsPaused',
  'customCss',
  'ipAllowlist',
]);

// Sub-tab → whitelist of field keys that may be written.
// Anything not in here is rejected with invalid-argument.
const FIELD_WHITELIST = {
  general: new Set([
    'appName', 'appTagline', 'supportEmail', 'defaultTimezone', 'dateFormat',
    'timeFormat', 'defaultLanguage', 'itemsPerPage',
    'maintenanceMode', 'allowNewRegistrations', 'allowGuestBrowsing',
    'requireEmailVerification', 'enforceTermsAcceptance', 'defaultLandingPage',
    'maxFileUploadSize', 'sessionTimeoutMin',
    'defaultLogoUrl', 'faviconUrl', 'defaultOgImageUrl',
    'brandPrimaryColor', 'brandSecondaryColor',
    'defaultAnnouncementVisibility', 'enableRichTextAnnouncements',
    'allowDirectMessages', 'maxMessageLength', 'enableUserMentions',
    'contentAutoModerate',
    'tosUrl', 'privacyUrl', 'refundUrl', 'guidelinesUrl', 'supportPageUrl',
    'dataRetentionPeriod', 'deleteInactiveAccountsAfter',
    'anonymizeDataAfterRetention', 'allowUserDataExport', 'logRetentionPeriod',
  ]),
  features: new Set([
    'liveStreamingPaused', 'tournamentsEnabled', 'squadsEnabled', 'newsBotsEnabled',
    'marketplaceEnabled', 'verificationEnabled', 'vergrMeEnabled',
    'streamBoostsEnabled', 'giftingEnabled', 'cohostEnabled',
    'streamFollowerGateEnabled',
  ]),
  security: new Set([
    'failedLoginThreshold', 'failedLoginLockoutMin',
    'minPasswordLength', 'allowedLoginCountries',
    'suspiciousAutoRevoke', 'stepUpWindowSec', 'ipAllowlist',
  ]),
  payments: new Set([
    'conversionsPaused', 'payoutsPaused', 'tipsPaused',
    'minPayoutGems', 'defaultPayoutCurrency',
  ]),
  notifications: new Set([
    'quietHoursStart', 'quietHoursEnd', 'maxNotificationsPerDay',
    'emailSenderName', 'emailReplyTo',
  ]),
  appearance: new Set([
    'theme', 'accentColor', 'customCss',
  ]),
  localization: new Set([
    'supportedLanguages',
  ]),
  system: new Set([
    'environment',
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
  { region: REGION, cors: true, secrets: ['R2_BUCKET'] },
  async (request) => {
    const uid = request.auth?.uid;
    await guardCaller(uid);
    const now = Date.now();
    if (healthCache.data && (now - healthCache.at) < 30_000) {
      return { ...healthCache.data, cached: true };
    }

    const status = (name, ok, detail = '') => ({ name, status: ok ? 'healthy' : 'down', detail });

    // Database — try a tiny read.
    let dbOk = false;
    try { await db.collection('app_config').doc('general').get(); dbOk = true; } catch {}

    // CDN / R2 — accept whatever R2_PUBLIC_BASE is set; we treat presence as "configured".
    const r2Configured = !!process.env.R2_BUCKET;

    const data = {
      services: [
        status('Database',   dbOk),
        status('Cache',      true),                    // Firestore is the cache layer
        status('Storage',    r2Configured, r2Configured ? 'R2' : 'unconfigured'),
        status('Queue',      true),                    // Cloud Functions auto-scaled
        status('Search',     true),                    // client-side; degraded = limited
        status('CDN',        true),                    // Cloudflare; no live check from here
      ],
      checkedAt: now,
    };
    healthCache = { at: now, data };
    return data;
  }
);
