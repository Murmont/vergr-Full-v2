// All help-center article bodies, merged from the per-category folders.
// Each category folder has its own index.js listing that category's article files.
// helpContent.jsx imports this as the BODIES map (slug -> { summary, updated, body }).
import c0 from './account/index.js';
import c1 from './apps/index.js';
import c2 from './buying-coins/index.js';
import c5 from './creator-studio/index.js';
import c6 from './earning/index.js';
import c7 from './economy/index.js';
import c8 from './getting-started/index.js';
import cFeed from './feed-discovery/index.js';
import cClips from './clips-shorts/index.js';
import cNotif from './notifications/index.js';
import cStatus from './status/index.js';
import cSettings from './settings/index.js';
import c9 from './memberships/index.js';
import c10 from './messaging/index.js';
import c11 from './posting/index.js';
import c12 from './profile/index.js';
import c13 from './referrals/index.js';
import c14 from './safety/index.js';
import c15 from './security-privacy/index.js';
import c16 from './squads/index.js';
import c17 from './streaming/index.js';
import c18 from './tips/index.js';
import c20 from './trust/index.js';
import c21 from './twitch/index.js';
import c22 from './vanguard/index.js';
import c23 from './vergrme/index.js';
import c24 from './verification/index.js';
import c25 from './vp-ranks/index.js';
import c26 from './wallet/index.js';
import c27 from './watching/index.js';
import cTrouble from './troubleshooting/index.js';
import { IS_STORE_BUILD, IS_HUAWEI_BUILD } from '../../../../utils/platform.js';
import { PLAY_HIDDEN, PLAY_BODIES } from './playBuild.js';

/**
 * Rewrite the store-build help copy from Google Play to HUAWEI AppGallery.
 *
 * ⚠ A SUBSTITUTION, NOT A REWRITE, AND DELIBERATELY SO. `playBuild.js` copy is
 * already vetted against the steering rules — it never points at another way to
 * pay, never quotes a price and never links a hidden slug. Re-authoring 41
 * sentences for a second store would put unvetted copy in front of a reviewer
 * and double the surface that has to be re-checked whenever the rules move.
 * Swapping the store's NAME keeps every one of those properties.
 *
 * ⚠ ORDER MATTERS. "Google Play Store" has to go before "Google Play", or it
 * becomes "AppGallery Store", and the bare "Google" rule has to go last or it
 * turns "Google Play" into "Huawei Play".
 */
const HUAWEI_TERMS = [
  [/Google Play Store/g, 'AppGallery'],
  [/Google Play/g, 'AppGallery'],
  [/Google account/g, 'Huawei account'],
  [/\bGoogle\b/g, 'Huawei'],
];

/**
 * ⚠⚠ THREE PLAN ARTICLES OFFER A CARD ON EVERY STORE BUILD, AND THEY ARE NOT IN
 * PLAY_BODIES, so the Play rewrite never touched them:
 *   how-do-i-upgrade-my-plan, what-are-the-vergr-plans, what-does-each-plan-include
 * All three say "…with a card, through Google Play on the Android app, or with
 * Coins", which inside a store app is the app's own help centre pointing at a
 * different way to pay. That is steering, on BOTH stores.
 *
 * Rewritten by phrase rather than by re-authoring the three articles, because
 * the surrounding sentences differ and only this clause is the problem.
 */
const STORE_TERMS = [
  [/with a card, through Google Play on the Android app, or with Coins/g,
    (name) => `through ${name} or with Coins`],
  // The SUMMARY of how-do-i-upgrade-my-plan offers a card in its own shorter
  // phrasing, which the rule above does not reach. A summary is the first thing
  // both a user and a reviewer read.
  [/pay with a card or with Coins/g, (name) => `pay through ${name} or with Coins`],
  // Descriptive rather than an offer, but on a store build there IS no card
  // rail, so comparing to one is simply wrong.
  [/one bought with a card/g, (name) => `one bought through ${name}`],
];

/** Apply the store-build copy rules. `huawei` also swaps the store's name. */
function storeise(value, huawei) {
  if (typeof value === 'string') {
    let s = STORE_TERMS.reduce(
      (acc, [re, to]) => acc.replace(re, to(huawei ? 'AppGallery' : 'Google Play')),
      value,
    );
    if (huawei) s = HUAWEI_TERMS.reduce((acc, [re, to]) => acc.replace(re, to), s);
    return s;
  }
  if (Array.isArray(value)) return value.map((v) => storeise(v, huawei));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = storeise(value[k], huawei);
    return out;
  }
  return value;
}

const BODIES = {
  ...c0,
  ...c1,
  ...c2,
  ...c5,
  ...c6,
  ...c7,
  ...c8,
  ...c9,
  ...c10,
  ...c11,
  ...c12,
  ...c13,
  ...c14,
  ...c15,
  ...c16,
  ...c17,
  ...c18,
  ...c20,
  ...c21,
  ...c22,
  ...c23,
  ...c24,
  ...c25,
  ...c26,
  ...c27,
  ...cFeed,
  ...cClips,
  ...cNotif,
  ...cStatus,
  ...cSettings,
  ...cTrouble,
};

// A STORE build sells Coins through the store's own billing only, so the
// articles that describe our own card / crypto checkout are swapped for store
// versions and a few are hidden (an article with no body is not published).
// Compiled out of the web, desktop and sideload builds. See ./playBuild.js.
//
// ⚠⚠ IS_STORE_BUILD, NOT IS_PLAY_BUILD. Until 2026-09-17 this read
// IS_PLAY_BUILD, which is FALSE on Huawei — so the AppGallery build shipped the
// WEB articles, telling users inside a Huawei app to pay by card or crypto.
// That is steering away from HUAWEI IAP in the app's own help centre, which is
// the same rejection the Play rewrite exists to avoid.
if (IS_STORE_BUILD) {
  for (const slug of PLAY_HIDDEN) delete BODIES[slug];
  Object.assign(BODIES, PLAY_BODIES);
  // Applied to EVERY article, not just the swapped ones: the three plan
  // articles that offer a card are not in PLAY_BODIES. See STORE_TERMS.
  for (const slug of Object.keys(BODIES)) {
    BODIES[slug] = storeise(BODIES[slug], IS_HUAWEI_BUILD);
  }
}

export default BODIES;
