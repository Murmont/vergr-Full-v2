import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

export default function StreamEndingScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);
  const navigate = useNavigate();
  const location = useLocation();
  const stats = location.state || {};

  return (
    <div className={isDesktop ? "min-h-screen flex flex-col items-center justify-center px-6 pb-8" : "screen-container min-h-screen flex flex-col items-center justify-center px-6 pb-8"}>
      <div className="w-20 h-20 rounded-full bg-brand-violet/10 flex items-center justify-center mb-6">
        <Icon name="live_tv" size={40} className="text-brand-violet-light" />
      </div>
      <h1 className="font-syne text-2xl font-bold mb-2">Stream Ended</h1>
      <p className="text-text-muted text-sm mb-6">Great stream! Here is your summary.</p>

      <div className="w-full grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {[
          { label: 'Duration', value: stats.duration || '0m', icon: 'schedule' },
          { label: 'Peak Viewers', value: stats.peakViewers || '0', icon: 'visibility' },
          { label: 'New Followers', value: stats.newFollowers || '0', icon: 'person_add' },
          { label: 'Tips Earned', value: `● ${stats.tips || 0}`, icon: 'paid' },
        ].map(s => (
          <div key={s.label} className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06] text-center">
            <Icon name={s.icon} size={20} className="text-text-muted mx-auto mb-1" />
            <p className="font-dmmono font-bold text-base">{s.value}</p>
            <p className="text-[10px] text-text-muted uppercase">{s.label}</p>
          </div>
        ))}
      </div>

      <button onClick={() => navigate('/')} className="w-full py-4 rounded-2xl bg-brand-violet text-white font-bold">Back Home</button>
    </div>
  );
}
