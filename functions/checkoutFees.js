// Checkout fees + tax — what the buyer is charged ON TOP of the sticker price.
//
// FOUNDER DECISION 2026-08-11: fees are ADDED to the buyer, not absorbed.
//
// This is a reversal of the older "no visible checkout service fee" rule, and it
// is deliberate. The reason it matters is the flat component of card pricing:
// a typical card rate of 2.9% + $0.30 means, on a $0.99 pack, that 30 cents is
// the entire margin. Absorbed, the Starter pack nets $0.66 against a worst-case
// payout of $0.63 — about 5%. Added, we net the full $0.99 and it is 36%.
//
// The model is Tango's checkout: the shelf shows the sticker price ($4.99), a
// single line underneath shows the real total ("Amount inclusive of Fees:
// $5.84"), and the itemised breakdown is one tap away. The buyer is never
// surprised at the statement, and the pack grid stays readable.
//
// ── WHAT IS AND IS NOT KNOWABLE ──────────────────────────────────────
//
// PayRam's card rail is NOT knowable in advance: their API accepts `amountInUSD` and returns
// `{host, reference_id, url}` with no fee field anywhere, and their docs state
// plainly that "all onramp related commercials are directly applied by the
// third-party onramp partners" without naming the partners or the rates
// (verified against docs.payram.com 2026-08-11). That fee IS disclosed, but by
// the provider inside their own widget, before the buyer confirms. So this
// module returns what we DO know for that rail (PayRam's own published 1-5%
// settlement fee) and marks the partner fee as provider-disclosed rather than
// inventing a number. A fee line that is confidently wrong is worse than one
// that honestly says where the number appears.
//
// Google Play cannot be surcharged at all — Play forbids adding anything to an
// IAP price. Its fee is already inside the price `playPriceFor()` computes, so
// this module refuses to itemise it rather than implying a second charge.

const { getFirestore } = require('firebase-admin/firestore');

const db = getFirestore('vgrdb');

// ── VAT / GST ────────────────────────────────────────────────────────
//
// ⚠ MIRRORS src/utils/storePricing.js → TAX_INCLUSIVE_MARKETS. Keep the two in
// sync; functions/ cannot import from src/ (different module system, and src is
// not packaged into the deploy). Same mirroring rule as games.js.
//
// ⚠⚠ THESE RATES ONLY BECOME REAL MONEY IF SOMETHING ACTUALLY REMITS THEM.
// On Google Play, Google is merchant of record and remits VAT for us. On the
// card rail WE are merchant of record, and nothing in the PayRam path
// calculates, collects or files VAT on our behalf. Showing tax here with no
// registration behind it would collect money we then hold, which is worse than
// not showing it. `taxEnabled` below is the switch, and it is OFF until the
// founder confirms the registrations exist.
const VAT_RATES = {
  AT: 0.20, BE: 0.21, BG: 0.20, HR: 0.25, CY: 0.19, CZ: 0.21,
  DK: 0.25, EE: 0.24, FI: 0.255, FR: 0.20, DE: 0.19, GR: 0.24,
  HU: 0.27, IE: 0.23, IT: 0.22, LV: 0.21, LT: 0.21, LU: 0.17,
  MT: 0.18, NL: 0.21, PL: 0.23, PT: 0.23, RO: 0.21, SK: 0.23,
  SI: 0.22, ES: 0.21, SE: 0.25,
  GB: 0.20, NO: 0.25, CH: 0.081, AU: 0.10, NZ: 0.15,
  JP: 0.10, KR: 0.10, ZA: 0.15, SG: 0.09, IN: 0.18,
  TR: 0.20, MX: 0.16,
};


/** PayRam's own published settlement band is 1-5%; 3% is the midpoint. */
const PAYRAM_SETTLEMENT_DEFAULT = 0.03;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function vatFor(country) {
  const cc = String(country || '').trim().toUpperCase().slice(0, 2);
  return VAT_RATES[cc] || 0;
}

/**
 * Gross up so that AFTER a percentage-plus-flat fee we still net `net`.
 *
 *   paid - (pct*paid + flat) = net   =>   paid = (net + flat) / (1 - pct)
 *
 * Solving it rather than adding pct*net matters more than it looks: adding the
 * fee to the net under-recovers, because the processor charges its percentage on
 * the grossed-up amount too. On $0.99 at 2.9%+$0.30 the naive version leaves
 * about a cent on the table every sale, which is small until it is every sale.
 */
function grossUp(net, pct, flat) {
  if (pct >= 1) return net; // nonsense config; never divide by <= 0
  return (net + flat) / (1 - pct);
}

/**
 * Full breakdown for a checkout.
 *
 * @param {object} p
 * @param {number} p.subtotalUsd  the ladder price, what we intend to net
 * @param {string} p.method       'card' | 'payram_card' | 'payram_crypto' | 'googlePlay'
 * @param {string} [p.uid]        buyer, for the profile country
 * @returns {Promise<object>} lines the cart renders verbatim
 */
async function quoteCheckout({ subtotalUsd, method, uid }) {
  const subtotal = round2(subtotalUsd);
  if (!(subtotal > 0)) throw new Error('subtotalUsd must be positive');

  let cfg = {};
  try {
    const snap = await db.doc('app_config/general').get();
    cfg = snap.exists ? (snap.data() || {}) : {};
  } catch { /* defaults below */ }

  // Play is charged and taxed entirely by Google. We never restate its price and
  // never add to it: an itemised fee here would imply a charge we do not make,
  // and surcharging an IAP is a policy violation on top of that.
  if (method === 'googlePlay') {
    return {
      method, currency: 'USD', subtotal,
      lines: [], total: null, feesIncludedInPrice: true,
      note: 'Google Play sets the final price and collects any tax. The Play sheet shows your exact total.',
    };
  }

  // Country from the buyer's PROFILE, never a client argument or a header —
  // same rule as regionalPrice(). A client that lies about its country changes
  // what it draws on screen and nothing about what it is charged.
  let country = null;
  if (uid) {
    try {
      const snap = await db.collection('users').doc(uid).get();
      country = snap.exists ? (snap.data().country || null) : null;
    } catch { /* unknown country -> no tax line */ }
  }

  // OFF until the founder confirms a tax registration exists and something
  // actually remits. Collecting tax we are not registered to remit is a
  // liability, not revenue, so this fails to "do not charge it" rather than
  // "charge it anyway".
  const taxEnabled = cfg.checkoutTaxEnabled === true;
  const vatRate = taxEnabled ? vatFor(country) : 0;

  // 'card' MEANS PAYRAM (founder, 2026-08-13). Stripe was the default card rail
  // from 2026-08-11 until Stripe closed the account; that rail is gone and every
  // trace of it was removed rather than left dormant, because a half-wired
  // processor is the kind of thing that gets re-enabled by accident.
  //
  // PayRam is the incumbent again: self-hosted, settling in USDC, no merchant
  // KYB. `payram_crypto` is the same processor paid in USDC direct.
  //
  // Google Play is the other live rail and is handled above, untouched by this.
  const rail = (method === 'card' || method === 'payram') ? 'payram_card' : method;

  const lines = [];
  let processingFee = 0;
  let providerDisclosed = false;

  if (rail === 'payram_card') {
    const pct = Number.isFinite(cfg.payramSettlementFeePct)
      ? cfg.payramSettlementFeePct : PAYRAM_SETTLEMENT_DEFAULT;
    processingFee = round2(grossUp(subtotal, pct, 0) - subtotal);
    providerDisclosed = true;
    lines.push({
      key: 'processing', label: 'Payment processing', amount: processingFee,
      detail: `${(pct * 100).toFixed(1)}%`,
    });
    lines.push({
      key: 'provider', label: 'Card provider fee', amount: null,
      detail: 'Shown by the payment provider before you confirm',
    });
  } else if (rail === 'payram_crypto') {
    // Paying in USDC direct: no card rail, no partner. Only PayRam's own
    // settlement fee applies, and the network fee is the payer's wallet's
    // business, not something we can or should quote.
    const pct = Number.isFinite(cfg.payramSettlementFeePct)
      ? cfg.payramSettlementFeePct : PAYRAM_SETTLEMENT_DEFAULT;
    processingFee = round2(grossUp(subtotal, pct, 0) - subtotal);
    lines.push({
      key: 'processing', label: 'Settlement', amount: processingFee,
      detail: `${(pct * 100).toFixed(1)}%`,
    });
  } else {
    throw new Error(`Unknown payment method: ${method} (rail ${rail})`);
  }

  // VAT applies to the total consideration, which includes any surcharge, not
  // to the sticker price alone.
  const taxable = round2(subtotal + processingFee);
  const tax = round2(taxable * vatRate);
  if (vatRate > 0) {
    lines.push({
      key: 'tax', label: 'VAT / GST', amount: tax,
      detail: `${(vatRate * 100).toFixed(1)}%${country ? ` (${country})` : ''}`,
    });
  }

  lines.unshift({ key: 'subtotal', label: 'Coins', amount: subtotal, detail: null });
  lines.push({ key: 'vergr', label: 'Vergr fee', amount: 0, detail: 'We add nothing' });

  return {
    method, rail, currency: 'USD', country,
    subtotal, processingFee, tax,
    total: round2(taxable + tax),
    taxEnabled, providerDisclosed,
    feesIncludedInPrice: false,
    lines,
  };
}

module.exports = {
  quoteCheckout,
  vatFor,
  grossUp,
  _config: { VAT_RATES, PAYRAM_SETTLEMENT_DEFAULT },
};
