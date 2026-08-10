import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

export default function TeamFundingScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);
  const { teamId } = useParams();
  const navigate = useNavigate();
  return (
    <div className={isDesktop ? "min-h-screen pb-8" : "screen-container min-h-screen pb-8"}>
      <TopBar showBack title="Team Funding" />
      <div className="px-4 py-4 text-center py-16">
        <Icon name="account_balance_wallet" size={48} className="text-text-muted/30 mx-auto mb-3" />
        <p className="text-text-muted text-sm">Team funding is managed through the squad wallet</p>
        <button onClick={() => navigate(-1)} className="mt-4 px-5 py-2.5 rounded-full bg-brand-violet text-white text-sm font-bold">Go to Squad</button>
      </div>
    </div>
  );
}
