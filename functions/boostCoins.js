// functions/boostCoins.js — boost coins: earned by watching rewarded ads,
// spendable ONLY on boosts and VP packs.
//
// Why a separate balance (founder, 2026-09-26): a normal coin can be tipped, and
// a tipped coin becomes revenue share Vergr owes a creator (up to $0.008 each).
// A boost or a VP pack is provided by Vergr itself and costs nothing to grant,
// so a coin that can ONLY buy those can be given out in a quantity that feels
// worth watching ads for.
//
// ⚠ ONLY THESE CALLERS MAY SPEND `boostCoins`: purchaseBoostPack, purchaseBoost,
// boostStream, purchaseVpBonus, requestStreamQualityBoost and the quality-boost
// minute charge. Anything that pays a creator (tips, gifts, unlocks,
// memberships, tickets) must never read it. scripts/ad-reward-check.mjs fails the
// build if another file references it.

const { FieldValue } = require('firebase-admin/firestore');

function spendable(w) {
  const data = w || {};
  return {
    coins: Math.max(0, Math.floor(Number(data.balance) || 0)),
    boost: Math.max(0, Math.floor(Number(data.boostCoins) || 0)),
  };
}

// Boost coins go first, normal coins cover the rest.
function planSpend(w, cost) {
  const have = spendable(w);
  const fromBoost = Math.min(have.boost, cost);
  const fromCoins = cost - fromBoost;
  return {
    ok: fromCoins <= have.coins,
    fromBoost,
    fromCoins,
    total: have.coins + have.boost,
  };
}

// Wallet fields for a planned spend. `totalSpent` only counts normal coins,
// because it tracks money the user bought.
function debitFields(plan) {
  const out = {};
  if (plan.fromCoins > 0) {
    out.balance = FieldValue.increment(-plan.fromCoins);
    out.totalSpent = FieldValue.increment(plan.fromCoins);
  }
  if (plan.fromBoost > 0) out.boostCoins = FieldValue.increment(-plan.fromBoost);
  return out;
}

module.exports = { spendable, planSpend, debitFields };
