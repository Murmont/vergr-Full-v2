import { useEffect, useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { useUI } from '../../context/UIContext';
import { getTournament } from '../../firebase/firestore';

// Reached two ways:
//   1. In-app navigate with { state: { amount, tournament } } (fast path).
//   2. Notification deep-link / shared URL /prize-receipt/:prizeId where
//      prizeId is the tournamentId — we self-load the prize from the doc.
export default function PrizeReceiptScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const location = useLocation();
  const { prizeId } = useParams();
  const tournamentId = prizeId || null;

  const stateAmount = location.state?.amount;
  const [amount, setAmount] = useState(stateAmount ?? null);
  const [name, setName] = useState(location.state?.tournament ?? null);

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  useEffect(() => {
    if (stateAmount != null || !tournamentId) return;
    let cancelled = false;
    (async () => {
      try {
        const t = await getTournament(tournamentId);
        if (cancelled || !t) return;
        setName(t.name || 'Tournament');
        const p1 = (t.payoutBreakdown?.payouts || []).find((p) => p.place === 1) || {};
        const isSquad = t.mode === 'squad';
        setAmount((p1.player || 0) + (isSquad ? (p1.treasury || 0) : 0));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [tournamentId, stateAmount]);

  const share = async () => {
    const url = `${window.location.origin}/#/prize-receipt/${tournamentId || ''}`;
    const text = `I won${amount ? ` ${amount.toLocaleString()} coins` : ''} in ${name || 'a tournament'} on VERGR!`;
    try {
      if (navigator.share) await navigator.share({ title: 'VERGR Prize', text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); showToast('Link copied to clipboard', 'success'); }
    } catch { /* user cancelled */ }
  };

  return (
    <div className={isDesktop ? "min-h-screen flex flex-col items-center justify-center px-6" : "screen-container min-h-screen flex flex-col items-center justify-center px-6"}>
      <div className="w-20 h-20 rounded-full bg-brand-gold/10 flex items-center justify-center mb-6 ">
        <Icon name="emoji_events" size={44} className="text-brand-gold" />
      </div>
      <h1 className="font-syne text-2xl font-bold mb-2">Prize Won!</h1>
      {amount != null && <p className="font-dmmono text-brand-gold text-xl font-bold mb-2">{amount.toLocaleString()} coins</p>}
      {name && <p className="text-text-muted text-sm mb-6">{name}</p>}
      <p className="text-text-muted text-xs text-center mb-8 max-w-sm">Prize coins have been added to your wallet. A 24-hour hold applies before you can cash out tournament winnings.</p>
      <button onClick={share} className="w-full max-w-xs py-4 rounded-2xl bg-brand-gold text-bg-dark font-bold mb-3 flex items-center justify-center gap-2">
        <Icon name="share" size={18} /> Share
      </button>
      <button onClick={() => navigate('/wallet')} className="w-full max-w-xs py-4 rounded-2xl bg-brand-cyan text-bg-dark font-bold mb-3">View Wallet</button>
      <button onClick={() => navigate('/')} className="text-text-secondary text-sm font-semibold">Home</button>
    </div>
  );
}
