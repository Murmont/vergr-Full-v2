// subscriptionSettings.js — the two subscription switches that are ENFORCED.
//
// Admin → Subscriptions → Settings used to save seven flags (EUR currency,
// Cryptomus checkout, trials, "require payment method", a master switch) that
// nothing in the app read, so changing one changed nothing. Replaced
// 2026-09-21 by these two, each with a real reader:
//
//   newSubscriptionsPaused  refuses a NEW paid plan on the rails we control
//                           (subscribeWithCoins, the PayRam card checkout) and
//                           hides the buy buttons in the app. The app side is
//                           the only way to stop a Google Play or AppGallery
//                           purchase: the store charges before we are asked,
//                           so refusing on the server would take the money and
//                           grant nothing. Renewals and existing plans carry on.
//   gracePeriodDays         how long a coin or card subscriber keeps the plan
//                           after the period ends before the daily renewal job
//                           downgrades them (0..14). Store subscriptions are
//                           owned by their own daily syncs and never use it.
//
// Stored at app_config/general.subscriptions. Written only by
// adminSetSubscriptionSettings; clients may read app_config/general.

const { getFirestore } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');

const db = getFirestore('vgrdb');

const SUBSCRIPTION_SETTINGS_DEFAULTS = Object.freeze({
  newSubscriptionsPaused: false,
  gracePeriodDays: 3,
});
const MAX_GRACE_DAYS = 14;

const PAUSED_MESSAGE = 'New subscriptions are paused right now. A plan you already have is not affected.';

function normaliseSubscriptionSettings(raw) {
  const x = raw || {};
  const grace = Number.isInteger(x.gracePeriodDays)
    ? Math.min(MAX_GRACE_DAYS, Math.max(0, x.gracePeriodDays))
    : SUBSCRIPTION_SETTINGS_DEFAULTS.gracePeriodDays;
  return {
    newSubscriptionsPaused: x.newSubscriptionsPaused === true,
    gracePeriodDays: grace,
  };
}

async function readSubscriptionSettings() {
  try {
    const snap = await db.collection('app_config').doc('general').get();
    return normaliseSubscriptionSettings((snap.exists ? snap.data() : {}).subscriptions);
  } catch {
    return { ...SUBSCRIPTION_SETTINGS_DEFAULTS };
  }
}

// Throws the buyer-facing message when new plans are paused.
async function assertNewSubscriptionsOpen() {
  const s = await readSubscriptionSettings();
  if (s.newSubscriptionsPaused) throw new HttpsError('failed-precondition', PAUSED_MESSAGE);
}

module.exports = {
  SUBSCRIPTION_SETTINGS_DEFAULTS,
  MAX_GRACE_DAYS,
  PAUSED_MESSAGE,
  normaliseSubscriptionSettings,
  readSubscriptionSettings,
  assertNewSubscriptionsOpen,
};
