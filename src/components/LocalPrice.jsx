// Local-currency price. Two modes:
//   • primary  (fallback set): renders the local amount as THE price, falling
//     back to `fallback` (the sticker price) while rates load or when no
//     conversion applies (same-currency users / feed down). prefix defaults ''.
//   • estimate (no fallback):  renders "≈ £8.40" next to another price, or
//     nothing when no conversion applies.
//
// Pass EITHER `usd` or `eur`, not both:
//   usd  coin packs and anything else priced natively in USD (since 2026-08-11)
//   eur  subscriptions, which are still EUR-priced because they carry regional
//        multipliers, and gem/withdrawal surfaces
//
// The local figure is ALWAYS an estimate. The charged currency is USD, and the
// buyer is told so next to it. Never let this number become the one presented as
// what will be taken: two calculations of one price eventually disagree, and the
// one the user saw is the one they argue about.
//
// Currency + rates are resolved once at app start from the user's profile
// country (see UserContext / utils/currency.js); this reads them synchronously
// and re-renders via fxVersion when they become available.
import { useUser } from '../context/UserContext';
import { convertFromEur, convertFromUsd } from '../utils/currency';

export default function LocalPrice({ usd, eur, fallback = null, prefix, style, className }) {
  useUser(); // subscribe to fxVersion so we re-render when conversion is ready
  const c = usd != null ? convertFromUsd(usd) : convertFromEur(eur);
  if (!c) return fallback;
  const pfx = prefix != null ? prefix : (fallback != null ? '' : '≈ ');
  let formatted;
  try {
    formatted = new Intl.NumberFormat(navigator.language || 'en', {
      style: 'currency', currency: c.currency,
    }).format(c.amount);
  } catch {
    return fallback;
  }
  return <span className={className} style={style}>{pfx}{formatted}</span>;
}
