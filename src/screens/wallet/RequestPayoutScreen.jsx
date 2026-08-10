import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { auth } from '../../firebase/config';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { GemIcon } from '../../components/CoinIcon';
import useResponsive from '../../hooks/useResponsive';

const MIN_PAYOUT_GEMS = 1000;
const SPREAD_PCT = 0.02;

export default function RequestPayoutScreen() {
  const { wallet, refreshWallet } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { isMobile } = useResponsive();
  const { setContentAlign } = useLayout();

  useEffect(() => {
    setContentAlign('left');
    return () => setContentAlign('center');
  }, [setContentAlign]);

  const gemBalance = wallet?.gems || 0;
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const numAmount = parseInt(amount, 10) || 0;
  const validAmount = numAmount >= MIN_PAYOUT_GEMS && numAmount <= gemBalance;
  const afterSpread = Math.floor(numAmount * (1 - SPREAD_PCT));
  const eurValue = (afterSpread * 0.01).toFixed(2);

  const setQuick = (pct) => setAmount(String(Math.floor(gemBalance * pct)));

  const handleSubmit = async () => {
    if (!validAmount || !address.trim() || submitting) return;
    setSubmitting(true);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error('Not signed in');
      const releasesAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
      await addDoc(collection(db, 'payout_requests'), {
        uid,
        gemsRequested: numAmount,
        gemsAfterSpread: afterSpread,
        eurEstimate: parseFloat(eurValue),
        walletAddress: address.trim(),
        status: 'on_hold',
        requestedAt: serverTimestamp(),
        releasesAt,
      });
      await refreshWallet?.();
      showToast('Payout request submitted — processed within 7 days', 'success');
      navigate('/wallet');
    } catch (err) {
      showToast(err?.message || 'Failed to submit request', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pb-10" style={{ background: '#0B0B14' }}>
      {isMobile && <TopBar title="Cash Out" showBack />}

      <div className="px-4 md:px-7 py-5 md:py-7 max-w-[760px] mx-auto">
        {!isMobile && (
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="font-syne text-3xl font-black text-text-primary">Cash Out Gems</h1>
              <p className="text-text-muted text-sm mt-1">Convert your gems to a payout sent to your wallet.</p>
            </div>
            <button onClick={() => navigate('/wallet')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12px] font-semibold transition-colors"
              style={{ background: '#14141F', border: '1px solid #1E1E2E', color: '#9CA3AF' }}>
              <Icon name="arrow_back" size={14} /> Back to Wallet
            </button>
          </div>
        )}

        {/* Balance hero */}
        <div className="rounded-2xl p-5 mb-5 flex items-center gap-4"
             style={{ background: '#14141F', border: '1px solid rgba(61,127,255,0.30)', boxShadow: '0 0 32px rgba(61,127,255,0.08)' }}>
          <GemIcon size={56} className="drop-shadow-[0_0_18px_rgba(61,127,255,0.55)]" />
          <div className="flex-1">
            <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: '#3D7FFF' }}>Cashable Gems</p>
            <p className="text-3xl font-black font-dmmono tabular-nums text-text-primary leading-none mt-1">{gemBalance.toLocaleString()}</p>
            <p className="text-text-muted text-[12px] mt-1">≈ €{(gemBalance * 0.01).toFixed(2)} · 1 gem = €0.01</p>
          </div>
        </div>

        {/* Below-min CTA */}
        {gemBalance < MIN_PAYOUT_GEMS && (
          <button onClick={() => navigate('/wallet/convert')}
            className="w-full mb-5 rounded-2xl p-4 flex items-center gap-3 text-left transition-colors hover:brightness-110"
            style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.40)' }}>
            <Icon name="info" size={20} style={{ color: '#F59E0B' }} />
            <div className="flex-1 text-[13px] text-text-primary">
              Need <span className="font-bold" style={{ color: '#F59E0B' }}>{(MIN_PAYOUT_GEMS - gemBalance).toLocaleString()} more gems</span> to withdraw — convert your coins now.
            </div>
            <Icon name="arrow_forward" size={16} className="text-text-muted" />
          </button>
        )}

        {/* 7-day hold notice */}
        <div className="rounded-2xl p-4 mb-5 flex items-start gap-3"
             style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.30)' }}>
          <Icon name="schedule" size={18} style={{ color: '#F59E0B', flexShrink: 0, marginTop: 1 }} />
          <p className="text-[12px] text-text-muted leading-relaxed">
            Payouts are processed in weekly batches to minimise network fees — batching means you pay less in fees than individual instant transfers. Requests are released after <span className="font-bold text-text-primary">7 days</span> and processed in the next batch.
          </p>
        </div>

        {/* Amount */}
        <p className="text-text-secondary text-[11px] font-dmmono uppercase tracking-wider font-bold mb-2">Amount in gems</p>
        <div className="rounded-2xl p-4 mb-4" style={{ background: '#14141F', border: '1px solid #1E1E2E' }}>
          <div className="relative mb-3">
            <GemIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder={`Min ${MIN_PAYOUT_GEMS.toLocaleString()} gems`}
              className="w-full bg-surface-2 border border-white/[0.06] rounded-xl py-3.5 pl-12 pr-4 text-2xl font-dmmono tabular-nums text-text-primary placeholder:text-text-muted focus:outline-none"
              style={{ borderColor: validAmount || numAmount === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(240,60,96,0.50)' }}
            />
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[0.25, 0.5, 0.75, 1].map(pct => (
              <button key={pct} onClick={() => setQuick(pct)}
                className="py-2 rounded-lg text-[12px] font-bold border transition-colors"
                style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)', color: '#9CA3AF' }}>
                {pct === 1 ? 'MAX' : `${pct * 100}%`}
              </button>
            ))}
          </div>
          {!validAmount && numAmount > 0 && (
            <p className="text-[11px] mt-2" style={{ color: '#F04060' }}>
              {numAmount < MIN_PAYOUT_GEMS ? `Min ${MIN_PAYOUT_GEMS.toLocaleString()} gems` : 'Insufficient gems'}
            </p>
          )}
          {validAmount && (
            <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-1 text-[12px]">
              <div className="flex justify-between">
                <span className="text-text-muted">Gems</span>
                <span className="font-dmmono text-text-secondary">{numAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Platform fee (2%)</span>
                <span className="font-dmmono text-text-secondary">−{numAmount - afterSpread} gems</span>
              </div>
              <div className="flex justify-between font-bold">
                <span className="text-text-primary">You receive</span>
                <span className="font-dmmono text-text-primary">≈ €{eurValue}</span>
              </div>
            </div>
          )}
        </div>

        {/* Wallet address */}
        <p className="text-text-secondary text-[11px] font-dmmono uppercase tracking-wider font-bold mb-2">Your payout wallet address</p>
        <div className="rounded-2xl p-4 mb-5" style={{ background: '#14141F', border: '1px solid #1E1E2E' }}>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value.trim())}
            placeholder="Paste your wallet address"
            className="w-full bg-surface-2 border border-white/[0.06] rounded-xl py-3 px-4 text-[13px] font-dmmono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-violet"
          />
          <p className="text-[10.5px] text-text-muted mt-2 leading-relaxed">
            Double-check your address — payouts sent to the wrong address cannot be recovered.
          </p>
        </div>

        <button
          onClick={handleSubmit}
          disabled={!validAmount || !address.trim() || submitting}
          className="w-full py-3.5 rounded-xl text-sm font-extrabold flex items-center justify-center gap-2 transition-all"
          style={(validAmount && address.trim() && !submitting)
            ? { background: 'linear-gradient(135deg, rgba(34,209,126,0.20), rgba(61,127,255,0.10))', border: '1px solid rgba(34,209,126,0.50)', color: '#22D17E' }
            : { background: 'rgba(255,255,255,0.04)', color: '#6B7280', border: '1px solid rgba(255,255,255,0.06)', cursor: 'not-allowed' }}
        >
          {submitting ? 'Submitting…' : <>Request Payout <Icon name="arrow_forward" size={14} /></>}
        </button>
      </div>
    </div>
  );
}
