// How Cloud Functions reach Mercury: through the relay on box 1
// (infra/mercury-relay/server.cjs), because Mercury only accepts our tokens from
// box 1's whitelisted IP.
//
// Authentication is a Google-signed OIDC identity token for this function's own
// service account, fetched from the metadata server. It is free, lasts an hour,
// and needs no stored secret. The relay verifies it against Google's keys.
//
// Pure apart from `fetchImpl`, which the guard injects. Imports nothing from
// firebase.

const RELAY_BASE = 'https://sfu.vergr.app/payouts';
/** Must equal MERCURY_RELAY_AUDIENCE in /etc/vergr-payouts/mercury.env on box 1. */
const RELAY_AUDIENCE = 'https://sfu.vergr.app/payouts';
const METADATA_IDENTITY =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';

async function identityToken(fetchImpl) {
  const url = `${METADATA_IDENTITY}?audience=${encodeURIComponent(RELAY_AUDIENCE)}&format=full`;
  const res = await fetchImpl(url, { headers: { 'Metadata-Flavor': 'Google' } });
  if (res.status !== 200) throw new Error(`relay_identity_unavailable_${res.status}`);
  const token = (await res.text()).trim();
  if (token.split('.').length !== 3) throw new Error('relay_identity_malformed');
  return token;
}

/**
 * POST one relay route. Resolves `{ ok, httpStatus, error, mercuryStatus, body,
 * classification }` and never throws on an HTTP status: 503 `token_b_missing`
 * is a normal answer the caller turns into a message.
 *
 * The relay replies 200 with `{ status, body }` where `status` is MERCURY's
 * HTTP status. So `ok` means "the relay reached Mercury", and the caller still
 * reads `mercuryStatus`.
 */
async function relayCall(route, body = {}, { fetchImpl = globalThis.fetch } = {}) {
  const token = await identityToken(fetchImpl);
  const res = await fetchImpl(`${RELAY_BASE}/v1/${route}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = JSON.parse(await res.text()); } catch { json = null; }
  if (res.status !== 200) {
    return { ok: false, httpStatus: res.status, error: json?.error || `relay_http_${res.status}` };
  }
  return {
    ok: true,
    httpStatus: 200,
    mercuryStatus: json?.status ?? null,
    body: json?.body ?? null,
    classification: json?.classification ?? null,
  };
}

module.exports = { relayCall, RELAY_BASE, RELAY_AUDIENCE };
