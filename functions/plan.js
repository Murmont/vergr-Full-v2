// functions/plan.js — the ONE server-side reader of a user's paid plan.
//
// ⚠⚠ Every purchase path writes the plan as a TOP-LEVEL STRING:
//   users/{uid}.subscription = 'free' | 'lite' | 'pro'
// (subscriptions.js, playBilling.js, huaweiBilling.js, orders.js,
// adminSubscriptions.js). Eight readers looked for `subscription.tier`, an old
// nested shape nothing writes, so every paying user was read as FREE: the Lite
// 1.5x / Pro 2x VP multiplier never paid, quest VP was never multiplied, Pro
// lead webhooks never fired and the Pro full-history imports were refused.
// Found 2026-09-27 auditing the Lite/Pro claims. Read the plan through this
// function, never off the doc by hand.
//
// Mirrors resolveTier() in src/utils/tierSystem.js: the string first, then the
// legacy nested/alias shapes, and anything unknown is free.

const PLANS = new Set(['free', 'lite', 'pro']);

function planOf(u) {
  const d = u || {};
  const raw = typeof d.subscription === 'string'
    ? d.subscription
    : (d.subscription?.tier || d.tier || d.plan || 'free');
  const t = String(raw || 'free').toLowerCase();
  return PLANS.has(t) ? t : 'free';
}

module.exports = { planOf };
