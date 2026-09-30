// The active coin sale, for display. ONE place for the web buy screen and the
// phone's, so the two cannot drift (until 2026-09-27 only the web showed a sale,
// so a Play buyer received a bonus nobody had told them about).
//
// The server decides and credits (functions/coinPromos.js bonusFor). This only
// mirrors that decision so a pack card can say what it will get. Coin bonuses
// arrive as BOOST coins (boosts and VP packs only, never tips).
import { useEffect, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';

/** The live sale from the server, or null. One callable per screen open. */
export function useActiveCoinPromo() {
  const [promo, setPromo] = useState(null);
  useEffect(() => {
    let alive = true;
    httpsCallable(getFunctions(undefined, 'europe-west1'), 'getActiveCoinPromo')({})
      .then((r) => { if (alive) setPromo(r.data?.promo || null); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return promo;
}

/** What `pack` gets from `promo`: { amount, unit } or null. */
export function promoBonusForPack(promo, pack) {
  if (!promo || !pack) return null;
  if (promo.packIds && !promo.packIds.includes(pack.id)) return null;
  if (promo.minSpendUSD && (pack.priceUSD || 0) < promo.minSpendUSD) return null;
  const pct = promo.kind === 'coins_pct' || promo.kind === 'vp_pct';
  const amount = Math.floor(pct ? (pack.coins || 0) * (Number(promo.value) || 0) / 100 : (Number(promo.value) || 0));
  if (!(amount > 0)) return null;
  return { amount, unit: String(promo.kind || '').startsWith('vp_') ? 'VP' : 'boost coins' };
}
