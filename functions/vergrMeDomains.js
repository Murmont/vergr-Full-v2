// Self-serve custom domains for vergr.me pages. A Pro perk.
//
// WHY THIS EXISTS: the pricing page has sold "your own domain on vergr.me"
// since launch, and the only implementation was a line of UI copy reading
// "Contact support to point your domain at this page". Nobody could do it, and
// support had no runbook to do it with. This makes it a real self-serve flow.
//
// ⚠ THE ZONE IS vergr.app. VERGR DOES NOT OWN vergr.me. The feature is NAMED
// vergr.me, but the domain was never registered (NXDOMAIN, verified 2026-07-18)
// and every page serves at vergr.app/u/<handle>. See src/utils/vergrMeUrl.js,
// which documents the same thing and the flip to make if it is ever bought.
//
// HOW IT WORKS (Cloudflare for SaaS, a.k.a. Custom Hostnames):
//   1. The creator enters links.theirsite.com in the vergr.me editor.
//   2. We register it with Cloudflare as a custom hostname on the vergr.app
//      zone. Cloudflare issues and renews a TLS certificate for it.
//   3. We tell them to add ONE DNS record at their registrar:
//        CNAME  links  ->  cname.vergr.app
//   4. Cloudflare validates ownership over that CNAME, provisions the cert,
//      and starts proxying the hostname to our origin.
//   5. The browser lands on our SPA with Host: links.theirsite.com. The client
//      resolves that host through `vergrme_domains/{hostname}` and renders that
//      creator's page. See RootRoute in src/router/AppRouter.jsx.
//
// COST: Cloudflare for SaaS is available on the FREE plan and includes 100
// custom hostnames at no charge, then $0.10 per hostname per month (verified
// against Cloudflare's plans page 2026-08-19). At $9.99 for Pro, hostname 101
// onward costs 1% of the subscription that asked for it, so this scales with
// revenue rather than ahead of it. Do not swap this for a paid plan tier.
//
// NOT CONFIGURED YET: this needs a Cloudflare API token with
// "SSL and Certificates: Edit" on the vergr.app zone, plus that zone's id.
// Until both secrets exist every callable here refuses cleanly and the UI
// shows a "not available yet" state, rather than half-registering a domain and
// leaving the creator with a dead hostname. Same fail-closed shape as
// PAYOUT_PARTNER_CONFIGURED in functions/creatorPayouts.js.

const functions = require('firebase-functions/v2');
const { HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const CLOUDFLARE_API_TOKEN = defineSecret('CLOUDFLARE_API_TOKEN');
// The zone is vergr.app. ⚠ VERGR DOES NOT OWN vergr.me — the feature is NAMED
// vergr.me but the domain was never registered (NXDOMAIN, verified 2026-07-18,
// see src/utils/vergrMeUrl.js) and pages serve at vergr.app/u/<handle>. An
// earlier version of this file assumed a vergr.me zone; there is no such zone
// in the Cloudflare account and the token cannot be scoped to one.
const CLOUDFLARE_ZONE_ID = defineSecret('CLOUDFLARE_ZONE_ID');

const SECRETS = [CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID];

// What the creator points their CNAME at. Must be a hostname on OUR zone:
// Cloudflare validates ownership from this record and it is what carries the
// traffic. A dedicated subdomain rather than the apex, so the target can be
// re-pointed later without touching vergr.app itself.
const CNAME_TARGET = 'cname.vergr.app';

// Firebase will not deploy a function bound to a secret that does not exist, so
// both secrets are created up front holding the literal string `unset`. That
// keeps this module deployable before the Cloudflare credentials are issued,
// and means switching the feature on is a `functions:secrets:set` with NO code
// change and NO redeploy. Treat `unset` as absent everywhere.
const UNSET = 'unset';

function secretValue(secret) {
  try {
    const v = secret.value()?.trim();
    return !v || v === UNSET ? null : v;
  } catch {
    return null;
  }
}

function cfConfigured() {
  return Boolean(secretValue(CLOUDFLARE_API_TOKEN) && secretValue(CLOUDFLARE_ZONE_ID));
}

/**
 * Validate and normalise a hostname the creator typed.
 *
 * Deliberately strict. A custom hostname is registered with a third party and
 * shows up in our TLS config, so garbage in here is not a cosmetic problem.
 * Rejects: our own domains (someone claiming vergr.app would be handed traffic
 * meant for the platform), bare public suffixes, anything with a scheme, path,
 * port or credentials, and wildcards.
 */
function normalizeHostname(raw) {
  let h = String(raw || '').trim().toLowerCase();
  if (!h) throw new HttpsError('invalid-argument', 'Enter a domain.');

  // Tolerate a pasted URL rather than making them retype it.
  h = h.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  if (h.startsWith('www.')) h = h.slice(4);

  if (h.length > 253) throw new HttpsError('invalid-argument', 'That domain is too long.');
  if (h.includes('*')) throw new HttpsError('invalid-argument', 'Wildcard domains are not supported.');
  if (h.includes('@')) throw new HttpsError('invalid-argument', 'Enter a domain, not an email address.');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) {
    throw new HttpsError('invalid-argument', 'That does not look like a domain. Example: links.yoursite.com');
  }
  if (h.split('.').length < 2) {
    throw new HttpsError('invalid-argument', 'Include the full domain, for example links.yoursite.com');
  }
  // Never let a creator claim a Vergr hostname.
  if (/(^|\.)(vergr\.app|vergr\.me|web\.app|firebaseapp\.com)$/.test(h)) {
    throw new HttpsError('invalid-argument', 'That domain belongs to Vergr.');
  }
  return h;
}

async function cfRequest(path, init = {}) {
  const zone = secretValue(CLOUDFLARE_ZONE_ID);
  const token = secretValue(CLOUDFLARE_API_TOKEN);
  if (!zone || !token) throw new HttpsError('failed-precondition', 'Custom domains are not switched on yet.');
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const msg = body?.errors?.[0]?.message || `Cloudflare returned ${res.status}`;
    console.error('cloudflare custom hostname error', path, res.status, JSON.stringify(body?.errors || {}));
    throw new HttpsError('internal', msg);
  }
  return body.result;
}

/** Collapse Cloudflare's two status fields into one the UI can render. */
function readStatus(result) {
  const host = result?.status || 'pending';
  const ssl = result?.ssl?.status || 'pending';
  if (host === 'active' && ssl === 'active') return 'active';
  if (host === 'blocked' || ssl === 'blocked') return 'blocked';
  return 'pending';
}

async function requireProCaller(uid) {
  const snap = await db.collection('users').doc(uid).get();
  const u = snap.exists ? snap.data() : {};
  const sub = u.subscription;
  const tier = (typeof sub === 'string' ? sub : sub?.tier) || u.tier || 'free';
  // Admins bypass, matching useTier on the client.
  if (u.role === 'admin') return u;
  if (String(tier).toLowerCase() !== 'pro') {
    throw new HttpsError('permission-denied', 'A custom domain is a Pro feature.');
  }
  return u;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read the caller's domain + what they still have to do.
// ─────────────────────────────────────────────────────────────────────────────
exports.getVergrMeDomain = functions.https.onCall(
  { region: REGION, secrets: SECRETS },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');

    const configured = cfConfigured();
    const owned = await db.collection('vergrme_domains').where('uid', '==', uid).limit(1).get();
    if (owned.empty) return { configured, domain: null, cnameTarget: CNAME_TARGET };

    const doc = owned.docs[0];
    const data = doc.data();

    // Re-read Cloudflare so a domain that finished validating since last time
    // flips to active without the creator having to do anything.
    let status = data.status || 'pending';
    if (configured && status !== 'active' && data.cfId) {
      try {
        status = readStatus(await cfRequest(`/custom_hostnames/${data.cfId}`, { method: 'GET' }));
        if (status !== data.status) await doc.ref.update({ status, checkedAt: FieldValue.serverTimestamp() });
      } catch { /* keep the stored status; a Cloudflare blip is not an error here */ }
    }

    return {
      configured,
      cnameTarget: CNAME_TARGET,
      domain: { hostname: doc.id, status, createdAt: data.createdAt?.toMillis?.() || null },
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Claim a domain.
// ─────────────────────────────────────────────────────────────────────────────
exports.setVergrMeDomain = functions.https.onCall(
  { region: REGION, secrets: SECRETS },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
    if (!cfConfigured()) {
      throw new HttpsError('failed-precondition', 'Custom domains are not switched on yet. Check back shortly.');
    }

    const user = await requireProCaller(uid);
    const hostname = normalizeHostname(request.data?.hostname);
    const ref = db.collection('vergrme_domains').doc(hostname);

    // Claim the hostname in Firestore BEFORE calling Cloudflare. A transaction
    // is the only thing that stops two creators registering the same domain in
    // the same second, and an orphaned Firestore row is far easier to clean up
    // than an orphaned certificate.
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists && existing.data().uid !== uid) {
        throw new HttpsError('already-exists', 'That domain is already connected to another Vergr page.');
      }
      // One domain per creator. Re-pointing means replacing, which the caller
      // does by removing the old one first, so the Cloudflare side stays in
      // step with what we think we own.
      const mine = await tx.get(db.collection('vergrme_domains').where('uid', '==', uid).limit(1));
      if (!mine.empty && mine.docs[0].id !== hostname) {
        throw new HttpsError('failed-precondition', 'Remove your current domain before adding a different one.');
      }
      tx.set(ref, {
        uid,
        username: user.username || null,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    let result;
    try {
      result = await cfRequest('/custom_hostnames', {
        method: 'POST',
        body: JSON.stringify({
          hostname,
          ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
        }),
      });
    } catch (err) {
      // Do not leave a claim behind for a hostname Cloudflare refused.
      await ref.delete().catch(() => {});
      throw err;
    }

    const status = readStatus(result);
    await ref.update({ cfId: result.id, status, checkedAt: FieldValue.serverTimestamp() });
    await db.collection('users').doc(uid).update({ vergrMeDomain: hostname });

    return { hostname, status, cnameTarget: CNAME_TARGET };
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Release a domain.
// ─────────────────────────────────────────────────────────────────────────────
exports.removeVergrMeDomain = functions.https.onCall(
  { region: REGION, secrets: SECRETS },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');

    const owned = await db.collection('vergrme_domains').where('uid', '==', uid).limit(1).get();
    if (owned.empty) return { removed: false };

    const doc = owned.docs[0];
    // Delete at Cloudflare first. If that fails we keep the Firestore row so
    // the domain is still visibly owned and retryable, rather than dropping the
    // record and stranding a certificate nobody can see or remove.
    if (cfConfigured() && doc.data().cfId) {
      await cfRequest(`/custom_hostnames/${doc.data().cfId}`, { method: 'DELETE' });
    }
    await doc.ref.delete();
    await db.collection('users').doc(uid).update({ vergrMeDomain: FieldValue.delete() });
    return { removed: true };
  },
);

exports._internal = { normalizeHostname, cfConfigured, CNAME_TARGET };
