// mapThumb — a server-side proxy for Google Maps Static API.
//
// Why a proxy and not a client-side key: a Maps key in the browser/APK is
// visible, and an HTTP-referrer restriction (the usual guard) does not work in
// the Tauri WebView (no vergr.app referrer), so it would either break on the
// phone or be extractable and abusable. Here the key lives ONLY in Secret
// Manager, is restricted to Maps Static API, and never reaches a client.
//
// Cost control: the response is cached hard (30d, immutable) by the Firebase
// CDN via the /maptile hosting rewrite + headers, so each distinct location
// costs at most ONE Google Static Maps call, ever. The client also falls back
// to free OSM tiles if this ever errors, so the map is never blank.

const functions = require('firebase-functions');
const { defineSecret } = require('firebase-functions/params');

const REGION = 'europe-west1';
const GOOGLE_MAPS_KEY = defineSecret('GOOGLE_MAPS_KEY');

// Dark style tuned to the founder's mockup: deep charcoal ground, blue water,
// green parks, violet POIs, muted labels. NO marker is drawn — the client
// overlays its own glowing gradient pin, centred on the point.
const DARK_STYLE = [
  'element:geometry|color:0x1d2230',
  'element:labels.text.fill|color:0x9198ad',
  'element:labels.text.stroke|color:0x11141d',
  'feature:administrative|element:geometry|color:0x2a3350',
  'feature:administrative.land_parcel|visibility:off',
  'feature:water|element:geometry|color:0x18305c',
  'feature:landscape|element:geometry|color:0x232838',
  'feature:road|element:geometry|color:0x2c3452',
  'feature:road|element:geometry.stroke|color:0x1a2030',
  'feature:road.highway|element:geometry|color:0x3c477a',
  'feature:road.highway|element:geometry.stroke|color:0x232a4a',
  'feature:poi|element:geometry|color:0x263247',
  'feature:poi.park|element:geometry|color:0x1f3b2e',
  'feature:poi.business|element:labels.icon|color:0x8b5cf6',
  'feature:transit|element:geometry|color:0x2a3350',
];

exports.mapThumb = functions.https.onRequest(
  { region: REGION, cors: true, maxInstances: 10, memory: '256MiB', secrets: [GOOGLE_MAPS_KEY] },
  async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      res.status(400).send('bad coords');
      return;
    }
    const w = Math.min(640, Math.max(80, parseInt(req.query.w, 10) || 400));
    const h = Math.min(640, Math.max(80, parseInt(req.query.h, 10) || 200));
    const zoom = Math.min(20, Math.max(1, parseInt(req.query.z, 10) || 15));
    const key = GOOGLE_MAPS_KEY.value();
    const styleParams = DARK_STYLE.map((s) => `style=${encodeURIComponent(s)}`).join('&');
    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}`
      + `&zoom=${zoom}&size=${w}x${h}&scale=2&${styleParams}&key=${key}`;
    try {
      const r = await fetch(url);
      if (!r.ok) {
        res.status(502).send(`map upstream ${r.status}`);
        return;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      res.set('Cache-Control', 'public, max-age=2592000, s-maxage=2592000, immutable');
      res.set('Content-Type', 'image/png');
      res.status(200).send(buf);
    } catch (e) {
      res.status(502).send('map error');
    }
  },
);
