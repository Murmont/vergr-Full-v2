import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
export default function DisconnectAccountScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);
  const navigate = useNavigate();
  const { platform } = useParams();
  return (
    <div className={isDesktop ? "min-h-screen flex flex-col items-center justify-center p-6" : "screen-container min-h-screen flex flex-col items-center justify-center p-6"}>
      <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-6"><Icon name="link_off" size={36} className="text-red-400"/></div>
      <h1 className="font-syne text-text-primary text-2xl font-extrabold text-center mb-3">Disconnect {platform || 'Account'}?</h1>
      <p className="text-text-secondary text-sm text-center max-w-[280px] mb-8">This will remove the connection. You can reconnect at any time from settings.</p>
      <button onClick={()=>navigate(-1)} className="w-full max-w-[320px] py-3 rounded-xl bg-red-500 text-white font-bold mb-3">Disconnect</button>
      <button onClick={()=>navigate(-1)} className="text-text-secondary font-semibold text-sm">Cancel</button>
    </div>);
}
