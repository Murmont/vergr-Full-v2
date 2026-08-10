import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { contributeToSquad } from '../../firebase/firestore';
import TopBar from '../../components/TopBar';
import CoinDisplay from '../../components/CoinDisplay';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

export default function ContributeScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);
  const location = useLocation();
  const { squadId, squadName } = location.state || {};
  const { currentUser } = useAuth();
  const { wallet } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();

  const [amount, setAmount] = useState('');
  const [contributing, setContributing] = useState(false);

  const balance = wallet?.balance || 0;
  const numAmount = parseInt(amount) || 0;
  const isValid = numAmount > 0 && numAmount <= balance;
  const presets = [50, 100, 250, 500];

  const handleContribute = async () => {
    if (!isValid || contributing || !squadId) return;
    setContributing(true);
    try {
      await contributeToSquad(squadId, currentUser.uid, numAmount);
      navigate('/contribution-success', { state: { amount: numAmount, squadName } });
    } catch (err) {
      console.error('Contribution failed:', err);
      showToast(err.message || 'Contribution failed', 'error');
    }
    setContributing(false);
  };

  if (!squadId) {
    return (
      <div className={isDesktop ? "min-h-screen" : "screen-container min-h-screen"}>
        <TopBar title="Contribute" showBack />
        <div className="flex flex-col items-center py-20">
          <Icon name="error_outline" size={48} className="text-text-muted/30 mb-3" />
          <p className="text-text-muted text-sm">No squad selected</p>
        </div>
      </div>
    );
  }

  return (
    <div className={isDesktop ? "min-h-screen pb-8" : "screen-container min-h-screen pb-8"}>
      <TopBar title="Contribute" showBack />

      <div className="px-4 py-4">
        <div className="text-center mb-6">
          <p className="text-text-secondary text-sm">Contributing to</p>
          <h2 className="font-syne text-xl font-bold text-brand-violet-light">{squadName || 'Squad'}</h2>
        </div>

        {/* Balance */}
        <div className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06] text-center mb-6">
          <p className="text-text-muted text-xs mb-1">Your Balance</p>
          <CoinDisplay amount={balance} size="lg" clickable={false} />
        </div>

        {/* Preset amounts */}
        <p className="text-text-muted text-xs font-bold uppercase mb-2">Quick Select</p>
        <div className="grid grid-cols-4 gap-2 mb-6">
          {presets.map(p => (
            <button key={p} onClick={() => setAmount(String(p))}
              className={`py-3 rounded-xl text-center font-bold text-sm transition-all ${
                String(p) === amount ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-secondary border border-white/[0.06]'
              }`}>
              {p}
            </button>
          ))}
        </div>

        {/* Custom amount */}
        <label className="block mb-2">
          <span className="text-text-muted text-xs font-bold uppercase mb-2 block">Custom Amount</span>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="Enter coins..."
            className="w-full bg-surface-2 border border-white/[0.06] rounded-xl px-4 py-4 text-text-primary text-xl font-bold font-dmmono focus:border-brand-violet focus:outline-none text-center"
          />
        </label>
        {numAmount > balance && (
          <p className="text-brand-ember text-xs text-center mb-4">Exceeds your balance</p>
        )}

        {/* Info */}
        <div className="p-3 rounded-xl bg-brand-gold/5 border border-brand-gold/20 flex items-start gap-2 mb-6">
          <Icon name="info" size={14} className="text-brand-gold mt-0.5 shrink-0" />
          <p className="text-text-secondary text-xs">Contributions go to the squad wallet and are used for tournament entry fees. Contributing members receive a share of tournament winnings.</p>
        </div>

        <button
          onClick={handleContribute}
          disabled={!isValid || contributing}
          className={`w-full py-4 rounded-2xl text-lg font-bold transition-all ${
            isValid && !contributing ? 'bg-brand-violet text-white' : 'bg-surface-3 text-text-muted'
          }`}>
          {contributing ? 'Contributing...' : `Contribute ${numAmount > 0 ? `${numAmount} Coins` : ''}`}
        </button>
      </div>
    </div>
  );
}
