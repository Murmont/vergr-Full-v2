import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

export default function ContributionSuccessScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);
  const navigate = useNavigate();
  const location = useLocation();
  const { amount, squadName } = location.state || {};

  return (
    <div className={isDesktop ? "min-h-screen flex flex-col items-center justify-center p-6" : "screen-container min-h-screen flex flex-col items-center justify-center p-6"}>
      <div className="w-20 h-20 rounded-full bg-green-500/10 flex items-center justify-center mb-6 ">
        <Icon name="volunteer_activism" size={44} className="text-green-500" />
      </div>
      <h1 className="font-syne text-2xl font-extrabold text-center mb-2">Thank You!</h1>
      {amount && (
        <p className="font-dmmono text-brand-gold text-xl font-bold mb-2">{amount.toLocaleString()} coins</p>
      )}
      <p className="text-text-secondary text-sm text-center max-w-[280px] mb-2">
        Your contribution to {squadName || 'the squad'} helps the team compete in tournaments.
      </p>
      <p className="text-text-muted text-xs text-center mb-8">Contributing members receive a share of tournament winnings proportional to their contribution.</p>

      <button onClick={() => navigate(-2)} className="w-full max-w-[360px] py-4 rounded-2xl bg-brand-violet text-white text-lg font-bold mb-3">
        Back to Squad
      </button>
      <button onClick={() => navigate('/')} className="text-text-secondary font-semibold text-sm">
        Go Home
      </button>
    </div>
  );
}
