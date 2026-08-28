// Free, key-less geo helpers for location sharing in chat.
//
// Everything here uses OpenStreetMap services, which are free and require no API
// key (unlike the Google Maps JS API the old picker loaded, which is paid). The
// app CSP already allows https: for connect-src/img-src, so no CSP change is
// needed. Respect Nominatim's usage policy: low volume only (a human sharing a
// location), one request per action.

/** Human address for coordinates, split into a TITLE (street + area) and a
 *  SUBTITLE (city, postcode, country) to match the map widget mockup. Falls back
 *  to the raw pair so the caller never has to show "undefined".
 *  `address` = title, kept for callers that want a single string (inbox preview). */
export async function reverseGeocode(lat, lng) {
  const coords = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': navigator.language || 'en' } });
    if (!res.ok) return { title: coords, subtitle: '', address: coords, coords };
    const j = await res.json();
    const a = j.address || {};
    const line1 = [a.house_number, a.road].filter(Boolean).join(' ');
    const area = a.suburb || a.neighbourhood || a.quarter || a.village || a.town || a.city_district;
    const title = [line1, area].filter(Boolean).join(', ') || j.name || a.city || (j.display_name || '').split(',')[0] || coords;
    const city = a.city || a.town || a.municipality || a.county || '';
    const region = [a.state_district, a.state].filter(Boolean)[0];
    const sub = [ [city, a.postcode].filter(Boolean).join(' '), (city ? a.country : region || a.country) ].filter(Boolean);
    const subtitle = [...new Set(sub)].join(', ');
    return { title, subtitle, address: title, coords };
  } catch {
    return { title: coords, subtitle: '', address: coords, coords };
  }
}

/** A free map thumbnail built from ONE canonical OSM tile
 *  (tile.openstreetmap.org — reliable, unlike the staticmap.* aggregator, which
 *  is a flaky community box that frequently never responds). Returns the tile
 *  URL plus the point's fractional position INSIDE that tile (0..1), so the
 *  caller can drop a pin exactly on the location rather than guessing the
 *  centre. `onError`-fallback in the UI covers the rare tile miss. */
export function osmTile(lat, lng, zoom = 15) {
  const n = 2 ** zoom;
  const latRad = (Number(lat) * Math.PI) / 180;
  const xf = ((Number(lng) + 180) / 360) * n;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const xt = Math.floor(xf);
  const yt = Math.floor(yf);
  return {
    url: `https://tile.openstreetmap.org/${zoom}/${xt}/${yt}.png`,
    xPct: (xf - xt) * 100,
    yPct: (yf - yt) * 100,
  };
}

/** The relay SERVER whitelists frame fields and DROPS unknown objects like
 *  `location` (proven by inspecting the echo), but it DOES forward `contentUrl`.
 *  So a location rides its coordinates in contentUrl as `geo:lat,lng`, and the
 *  recipient parses them back with this. Returns null for anything else. */
export function parseGeo(contentUrl) {
  const m = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:\|([^|]*)\|(.*))?$/.exec(contentUrl || '');
  if (!m) return null;
  const dec = (s) => { try { return decodeURIComponent(s || ''); } catch { return ''; } };
  return { lat: Number(m[1]), lng: Number(m[2]), title: dec(m[3]), subtitle: dec(m[4]) };
}
export function geoContentUrl(lat, lng, title, subtitle) {
  return `geo:${lat},${lng}|${encodeURIComponent(title || '')}|${encodeURIComponent(subtitle || '')}`;
}

/** Open a coordinate in the best available map:
 *  - native (phone): a `geo:` URI, which hands off to the device's own map app
 *    (Google Maps / whatever the user has), exactly what a phone user expects.
 *  - web: OpenStreetMap in a new tab. */
export function openInMaps(lat, lng, label = '', isNative = false) {
  if (isNative) {
    const q = label ? `${lat},${lng}(${encodeURIComponent(label)})` : `${lat},${lng}`;
    try { window.location.href = `geo:${lat},${lng}?q=${q}`; return; } catch { /* fall through */ }
  }
  const url = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
