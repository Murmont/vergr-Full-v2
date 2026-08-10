// Local-currency price. Two modes:
//   • primary  (fallback set): renders the local amount as THE price, falling
//     back to `fallback` (the EUR price) while rates load or when no conversion
//     applies (EUR users / feed down). prefix defaults to ''.
//   • estimate (no fallback):  renders "≈ £8.40" next to another price, or
//     nothing when no conversion applies.
//
// Currency + rates are resolved once at app start from the user's profile
// country (see UserContext / utils/currency.js); this reads them synchronously
// and re-renders via fxVersion when they become available. Checkout is always
// processed in USD/USDT regardless.
import { useUser } from '../context/UserContext';
import { convertFromEur } from '../utils/currency';

export default function LocalPrice({ eur, fallback = null, prefix, style, className }) {
  useUser(); // subscribe to fxVersion so we re-render when conversion is ready
  const c = convertFromEur(eur);
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
