import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Icon from '../../components/Icon';
import useResponsive from '../../hooks/useResponsive';
import { useLayout } from '../../context/LayoutContext';
import RightSidebarPanel from '../../components/RightSidebarPanel';
import TopBar from '../../components/TopBar';

export default function PayoutSuccessScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { amount, eur, method } = location.state || {};
  const { isMobile } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(<RightSidebarPanel />);
    setContentAlign('left');
    return () => {
      setRightPanel(null);
      setContentAlign('center');
    };
  }, [setRightPanel, setContentAlign]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 pb-8">
      {isMobile && <TopBar title="Success" showBack />}
      {!isMobile && (
        <div className="absolute top-4 right-4">
          <button onClick={() => navigate(-1)} className="text-white/80 hover:text-white transition-colors" aria-label="Go back">
            <Icon name="arrow_back" size={24} />
          </button>
        </div>
      )}
      <div className="w-20 h-20 rounded-full bg-green-500/10 flex items-center justify-center mb-6 ">
        <Icon name="check_circle" filled size={48} className="text-green-500" />
      </div>

      <h1 className="font-syne text-2xl font-extrabold text-center mb-2">Payout Requested!</h1>
      <p className="text-text-secondary text-base text-center max-w-[280px] mb-2">
        Your payout of {amount ? `${amount.toLocaleString()} coins` : 'coins'}{eur ? ` (€${eur})` : ''} is being processed.
      </p>
      {method && (
        <p className="text-text-muted text-sm text-center mb-6">Via {method}</p>
      )}
      <p className="text-text-muted text-sm text-center mb-8">
        You'll receive it within 3-5 business days.
      </p>

      <button onClick={() => navigate('/wallet')} className="w-full max-w-xs py-4 rounded-2xl bg-brand-violet text-white font-bold text-lg mb-3">
        Back to Wallet
      </button>
      <button onClick={() => navigate('/')} className="w-full max-w-xs py-3 rounded-2xl bg-surface-2 text-text-secondary font-semibold text-sm">
        Go Home
      </button>
    </div>
  );
}