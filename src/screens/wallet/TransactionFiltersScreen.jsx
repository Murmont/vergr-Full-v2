import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import useResponsive from '../../hooks/useResponsive';
import { useLayout } from '../../context/LayoutContext';
import RightSidebarPanel from '../../components/RightSidebarPanel';
import TopBar from '../../components/TopBar';

export default function TransactionFiltersScreen() {
  const navigate = useNavigate();
  const [type, setType] = useState('all');
  const [period, setPeriod] = useState('30d');
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
    <div className="min-h-screen flex flex-col">
      {isMobile && <TopBar title="Filters" showBack />}
      {!isMobile && (
        <div className="flex justify-between items-center px-4 pt-4">
          <button onClick={() => navigate(-1)} className="text-white/80 hover:text-white transition-colors" aria-label="Go back">
            <Icon name="arrow_back" size={24} />
          </button>
          <button onClick={() => navigate(-1)} className="text-brand-violet-light font-semibold text-sm">Apply</button>
        </div>
      )}
      {isMobile && (
        <header className="flex items-center gap-3 px-5 pt-4 pb-4">
          <h1 className="text-white font-syne font-bold text-lg flex-1">Filters</h1>
          <button onClick={() => navigate(-1)} className="text-brand-violet-light font-semibold text-sm">Apply</button>
        </header>
      )}
      <main className="flex-1 px-5 pb-8">
        <p className="text-text-secondary text-xs font-bold uppercase tracking-wider mb-3">Transaction Type</p>
        <div className="flex flex-wrap gap-2 mb-6">
          {['all', 'purchases', 'earnings', 'tips', 'transfers'].map(t => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`px-4 py-2 rounded-full text-sm font-bold ${type === t ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-secondary'}`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <p className="text-text-secondary text-xs font-bold uppercase tracking-wider mb-3">Time Period</p>
        <div className="flex flex-wrap gap-2">
          {[['7d', '7 Days'], ['30d', '30 Days'], ['90d', '90 Days'], ['all', 'All Time']].map(([k, l]) => (
            <button
              key={k}
              onClick={() => setPeriod(k)}
              className={`px-4 py-2 rounded-full text-sm font-bold ${period === k ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-secondary'}`}
            >
              {l}
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}