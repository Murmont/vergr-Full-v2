import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

export default function AccountDataExportScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const [requested, setRequested] = useState(false);

  const dataTypes = [
    { icon: 'person', label: 'Profile Information' },
    { icon: 'edit_note', label: 'Posts & Comments' },
    { icon: 'chat_bubble', label: 'Messages' },
    { icon: 'groups', label: 'Squad Data' },
    { icon: 'paid', label: 'Transaction History' },
    { icon: 'settings', label: 'Account Settings' },
  ];

  const handleRequest = () => {
    setRequested(true);
    showToast('Data export requested. You will receive an email when ready.', 'success');
  };

  return (
    <div className={isDesktop ? "min-h-screen pb-8" : "screen-container min-h-screen pb-8"}>
      <TopBar title="Export My Data" showBack />
      <div className="px-4 py-4">
        <p className="text-text-secondary text-sm mb-6">Request a copy of all your VERGR data. This includes:</p>
        <div className="space-y-2 mb-6">
          {dataTypes.map(d => (
            <div key={d.label} className="flex items-center gap-3 p-3 rounded-xl bg-surface-1 border border-white/[0.06]">
              <Icon name={d.icon} size={20} className="text-text-secondary" />
              <span className="text-sm">{d.label}</span>
            </div>
          ))}
        </div>
        <div className="p-3 rounded-xl bg-surface-1 border border-white/[0.06] mb-6">
          <div className="flex items-start gap-2">
            <Icon name="info" size={14} className="text-brand-violet-light mt-0.5" />
            <p className="text-text-muted text-xs">Your data export will be sent to <span className="text-brand-violet-light">{currentUser?.email}</span> within 48 hours.</p>
          </div>
        </div>
        <button onClick={handleRequest} disabled={requested}
          className={`w-full py-4 rounded-2xl font-bold ${requested ? 'bg-surface-3 text-text-muted' : 'bg-brand-violet text-white'}`}>
          {requested ? 'Export Requested ✓' : 'Request Data Export'}
        </button>
      </div>
    </div>
  );
}
