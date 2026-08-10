import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import TopBar from '../../components/TopBar';
import useResponsive from '../../hooks/useResponsive';
import { useLayout } from '../../context/LayoutContext';
import RightSidebarPanel from '../../components/RightSidebarPanel';

export default function WalletSecurityScreen() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState({
    pinLock: true,
    biometric: false,
    txAlerts: true,
    withdrawalConfirm: true
  });

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

  const toggle = k => setSettings(p => ({ ...p, [k]: !p[k] }));

  return (
    <div className="min-h-screen flex flex-col">
      {isMobile && <TopBar title="Wallet Security" showBack />}
      {!isMobile && (
        <div className="flex justify-end px-4 pt-4">
          <button onClick={() => navigate(-1)} className="text-white/80 hover:text-white transition-colors" aria-label="Go back">
            <Icon name="arrow_back" size={24} />
          </button>
        </div>
      )}
      <header className="flex items-center gap-3 px-5 pt-4 pb-4">
        <h1 className="text-white font-syne font-bold text-lg flex-1">Security</h1>
      </header>
      <main className="flex-1 px-5 pb-8">
        {[
          { k: 'pinLock', icon: 'lock', label: 'PIN Lock', desc: 'Require PIN for transactions' },
          { k: 'biometric', icon: 'fingerprint', label: 'Biometric Auth', desc: 'Use fingerprint or face ID' },
          { k: 'txAlerts', icon: 'notifications', label: 'Transaction Alerts', desc: 'Get notified on every transaction' },
          { k: 'withdrawalConfirm', icon: 'shield', label: 'Withdrawal Confirmation', desc: 'Extra verification for payouts' }
        ].map(s => (
          <div key={s.k} className="flex items-center gap-3 py-4 border-b border-white/[0.03]">
            <Icon name={s.icon} size={20} className="text-brand-violet-light" />
            <div className="flex-1">
              <p className="text-white font-semibold text-sm">{s.label}</p>
              <p className="text-text-secondary text-xs">{s.desc}</p>
            </div>
            <button
              onClick={() => toggle(s.k)}
              className={`w-12 h-7 rounded-full relative transition-colors ${settings[s.k] ? 'bg-brand-violet' : 'bg-surface-3'}`}
            >
              <div className={`w-5 h-5 rounded-full bg-white absolute top-1 transition-transform ${settings[s.k] ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        ))}
      </main>
    </div>
  );
}