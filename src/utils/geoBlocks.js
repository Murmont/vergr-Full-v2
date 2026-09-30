// Frontend-side mirror of the server geo blocklists. Used for early UX
// signals — the authoritative check is server-side in `functions/geo.js`.
//
// Keep both lists in sync. See CLAUDE.md "Compliance + age + geo" section.

// SANCTIONED COUNTRIES ONLY (founder rule). China and the five MENA countries
// are not sanctioned and are not blocked. Keep in sync with functions/geo.js,
// which is the list that actually enforces.
export const BLOCKED_COUNTRIES = new Set([
  'KP','IR','SY','CU','RU','BY','VE',
]);

// 2026-07-08: emptied (ticketed-events pivot). Keep in sync with geo.js.
export const BLOCKED_US_STATES = new Set([]);

export const COUNTRY_NAMES = {
  KP: 'North Korea', IR: 'Iran', SY: 'Syria', CU: 'Cuba',
  RU: 'Russia', BY: 'Belarus', VE: 'Venezuela',
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

// SAVE THIS ACCOUNT'S COUNTRY, ONCE (functions/geo.js stampAccountCountry).
// Checkout needs it for payment methods, local prices and tax. Called only while
// the already-loaded profile has no geoCountry, so it is one request per
// account, ever, and it reads nothing. The server takes the country from
// Cloudflare, never from here. Resolves the saved country code or null.
const stampInFlight = new Map();
export function ensureAccountCountry(user, profile) {
  if (!user || user.isAnonymous) return Promise.resolve(null);
  if (profile?.geoCountry) return Promise.resolve(profile.geoCountry);
  if (stampInFlight.has(user.uid)) return stampInFlight.get(user.uid);
  const p = (async () => {
    try {
      const token = await user.getIdToken();
      const res = await fetch('https://api.vergr.app/getRegionStatus?stamp=1', {
        method: 'GET',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.stamped ? data.country : null;
    } catch {
      return null;
    }
  })();
  stampInFlight.set(user.uid, p);
  // A failed attempt may retry later in the session (e.g. from the basket).
  p.then((c) => { if (!c) stampInFlight.delete(user.uid); });
  return p;
}

export function regionDisplayName(status) {
  if (!status) return 'your region';
  if (status.country === 'US' && status.region) return `${status.region}, US`;
  if (status.country && COUNTRY_NAMES[status.country]) return COUNTRY_NAMES[status.country];
  return status.country || 'your region';
}
