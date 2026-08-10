/**
 * Regional pricing — SUBSCRIPTIONS ONLY. NEVER COINS.
 *
 * ## Read this before you widen it
 *
 * A coin is not a product, it is a claim. It converts to Gems and withdraws at
 * a rate that does not care what was paid for it or where. So discounting what
 * a coin is SOLD at does not make coins cheaper for that market, it opens an
 * arbitrage: buy 100 coins for EUR 0.36 in a discount region, tip them to a
 * creator, and that creator withdraws against the full EUR 0.0090 per coin.
 * Vergr funds the gap on every transaction, and the only skill needed to farm
 * it is setting a VPN and a profile country.
 *
 * This module was briefly applied to coin packs. That was wrong, it would have
 * cost real money, and the founder caught it. Before reusing `regionalPrice` on
 * anything new, the test is: can the thing being bought be converted back into
 * money at a fixed rate? If yes, it cannot be priced regionally. A subscription
 * is consumed rather than redeemed, so Lite and Pro price regionally exactly as
 * Spotify and Netflix do.
 *
 * Affordability in cheaper markets comes from SMALLER PACKS at the same
 * per-coin rate: a lower entry point, never a cheaper coin.
 *
 * ## The server is authoritative
 *
 * The multiplier that is actually charged is resolved here, from the buyer's
 * own profile country, at the moment the payment is created. A client that lies
 * about its country changes what it draws on screen and nothing about what it
 * pays.
 *
 * ## Where the tiers come from
 *
 * World Bank income classifications, collapsed to four bands. That is a real,
 * citable basis rather than a number somebody felt like — see
 * [[feedback-no-unilateral-financial-choices]]. They are STARTING VALUES and
 * the founder owns them: `app_config/general.geoPricing` overrides any part of
 * this at runtime with no deploy, and an empty/missing config means everyone
 * pays the base price.
 *
 * ## The coin floor is not negotiable
 *
 * CLAUDE.md sets a hard floor of EUR 0.0090 per coin, and that floor holds
 * WORLDWIDE because it is the rate the coin redeems at. Nothing here touches
 * it: coins never pass through this module.
 */
const { getFirestore } = require('firebase-admin/firestore');

const db = getFirestore('vgrdb');

/**
 * Multiplier applied to the base EUR price, by band.
 *
 * 1.00 is the reference (western Europe, the currency the catalogue is written
 * in). Nothing is priced above the base by default: charging more than the
 * sticker price to some countries is a support problem and a press problem, and
 * the upside is small. Discounts only.
 */
const TIER_MULTIPLIER = {
  standard: 1.00,   // High income: EU, UK, US, CA, AU, JP, KR, SG, gulf states
  upper:    0.75,   // Upper-middle income: BR, MX, ZA, TR, MY, TH, CN, RU
  lower:    0.55,   // Lower-middle income: IN, ID, PH, VN, EG, NG, PK, UA
  low:      0.40,   // Low income
};

/**
 * ISO-2 → band. Anything not listed falls to `standard`, which is the safe
 * default: an unknown country pays the normal price rather than accidentally
 * receiving the deepest discount.
 */
const COUNTRY_TIER = {
  // Upper-middle
  BR: 'upper', MX: 'upper', AR: 'upper', CO: 'upper', CL: 'upper', PE: 'upper',
  ZA: 'upper', TR: 'upper', MY: 'upper', TH: 'upper', CN: 'upper', RU: 'upper',
  RS: 'upper', BA: 'upper', AL: 'upper', MK: 'upper', GE: 'upper', AM: 'upper',
  DO: 'upper', EC: 'upper', PY: 'upper', JM: 'upper', BW: 'upper', NA: 'upper',
  // Lower-middle
  IN: 'lower', ID: 'lower', PH: 'lower', VN: 'lower', EG: 'lower', NG: 'lower',
  PK: 'lower', BD: 'lower', UA: 'lower', MA: 'lower', KE: 'lower', GH: 'lower',
  LK: 'lower', NP: 'lower', KH: 'lower', MM: 'lower', BO: 'lower', HN: 'lower',
  NI: 'lower', SV: 'lower', GT: 'lower', TN: 'lower', DZ: 'lower', JO: 'lower',
  UZ: 'lower', KG: 'lower', MN: 'lower', ZW: 'lower', ZM: 'lower', SN: 'lower',
  CI: 'lower', CM: 'lower', TZ: 'lower', UG: 'lower',
  // Low
  ET: 'low', RW: 'low', MW: 'low', MZ: 'low', NE: 'low', ML: 'low', BF: 'low',
  TD: 'low', CD: 'low', MG: 'low', SL: 'low', LR: 'low', TG: 'low', BJ: 'low',
  AF: 'low', YE: 'low', HT: 'low',
};

const DEFAULT_TIER = 'standard';

let _cfg = null;
let _cfgAt = 0;
const CFG_TTL_MS = 5 * 60 * 1000;

/**
 * Founder overrides from `app_config/general.geoPricing`:
 *   { enabled?: boolean, multipliers?: {tier: number}, countries?: {ISO2: tier} }
 * Cached briefly, because this runs on the payment path and a config read per
 * checkout is a cost with no benefit.
 */
async function loadConfig() {
  const now = Date.now();
  if (_cfg && now - _cfgAt < CFG_TTL_MS) return _cfg;
  try {
    const snap = await db.collection('app_config').doc('general').get();
    _cfg = (snap.exists ? snap.data()?.geoPricing : null) || {};
  } catch {
    _cfg = {};
  }
  _cfgAt = now;
  return _cfg;
}

function tierFor(country, cfg) {
  const cc = String(country || '').trim().toUpperCase().slice(0, 2);
  if (!cc) return DEFAULT_TIER;
  return (cfg.countries && cfg.countries[cc]) || COUNTRY_TIER[cc] || DEFAULT_TIER;
}

function multiplierFor(tier, cfg) {
  if (cfg.enabled === false) return 1;
  const m = (cfg.multipliers && cfg.multipliers[tier]) ?? TIER_MULTIPLIER[tier];
  const n = Number(m);
  // A broken config must never make coins free or cost ten times the sticker.
  if (!Number.isFinite(n) || n <= 0 || n > 1) return 1;
  return n;
}

/**
 * Resolve the regional price for one buyer.
 *
 * The country comes from the buyer's PROFILE, not from a header or a client
 * argument: profile country is what the rest of the app already localises on
 * (see [[project-currency-localization]]), it is what the user chose, and it
 * cannot be spoofed by editing a request.
 *
 * Returns the multiplier alongside the price so a caller can show "Regional
 * pricing applied" rather than silently charging a different number than the
 * catalogue says.
 */
async function regionalPrice(uid, baseEUR) {
  const cfg = await loadConfig();
  let country = null;
  try {
    const snap = await db.collection('users').doc(uid).get();
    country = snap.exists ? (snap.data().country || null) : null;
  } catch { /* unknown country pays the base price */ }

  const tier = tierFor(country, cfg);
  const multiplier = multiplierFor(tier, cfg);
  // Rounded to the cent the buyer is actually charged, so the figure shown and
  // the figure billed are the same number rather than one being a rounding of
  // the other.
  const priceEUR = Math.round(baseEUR * multiplier * 100) / 100;

  return { country, tier, multiplier, baseEUR, priceEUR, discounted: multiplier < 1 };
}

module.exports = { regionalPrice, tierFor, multiplierFor, TIER_MULTIPLIER, COUNTRY_TIER };
