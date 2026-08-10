// Frontend-side mirror of the server geo blocklists. Used for early UX
// signals — the authoritative check is server-side in `functions/geo.js`.
//
// Keep both lists in sync. See CLAUDE.md "Compliance + age + geo" section.

// 2026-07-08: unblocked the 11 skill-gaming-only countries after the ticketed-
// events pivot (see functions/geo.js for the reasoning). Remaining blocks are
// sanctions / crypto-illegal / MENA gambling law. Keep in sync with geo.js.
export const BLOCKED_COUNTRIES = new Set([
  'CN','KP','IR','SY','CU','RU','BY','VE',
  'SA','AE','QA','KW','IQ',
]);

// 2026-07-08: emptied (ticketed-events pivot). Keep in sync with geo.js.
export const BLOCKED_US_STATES = new Set([]);

export const COUNTRY_NAMES = {
  CN: 'China', KP: 'North Korea', IR: 'Iran', SY: 'Syria', CU: 'Cuba',
  RU: 'Russia', BY: 'Belarus', VE: 'Venezuela',
  SA: 'Saudi Arabia', AE: 'United Arab Emirates', QA: 'Qatar',
  KW: 'Kuwait', IQ: 'Iraq',
};

let cachedStatus = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60 * 1000;

// Fetches the region status from the server. The server is authoritative —
// this client helper is only used to drive the UI gate. Returns:
//   { blocked: boolean, country: string|null, region: string|null, reason: string }
export async function fetchRegionStatus({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedStatus && now - cachedAt < CACHE_TTL_MS) {
    return cachedStatus;
  }
  try {
    // MUST go through api.vergr.app, not the Functions origin directly. The
    // origin is not behind Cloudflare, so it cannot resolve a country and
    // always answers unknown_region — which is why the signup gate never
    // blocked anyone. See infra/cf-geo-proxy/README.md.
    const res = await fetch('https://api.vergr.app/getRegionStatus', {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('region check failed');
    const data = await res.json();
    cachedStatus = data;
    cachedAt = now;
    return data;
  } catch {
    // Fail-open in the UI — the server-side callable check is the real gate.
    return { blocked: false, country: null, region: null, reason: 'check_failed' };
  }
}

export function regionDisplayName(status) {
  if (!status) return 'your region';
  if (status.country === 'US' && status.region) return `${status.region}, US`;
  if (status.country && COUNTRY_NAMES[status.country]) return COUNTRY_NAMES[status.country];
  return status.country || 'your region';
}
