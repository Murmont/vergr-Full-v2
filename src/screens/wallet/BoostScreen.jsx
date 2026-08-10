import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { doc, updateDoc, addDoc, collection, serverTimestamp, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { awardVP } from '../../firebase/firestore';
import Icon from '../../components/Icon';
import { CoinIcon } from '../../components/CoinIcon';
import TopBar from '../../components/TopBar';
import InfoTooltip from '../../components/InfoTooltip';
import { BOOST_COSTS } from '../../utils/vpSystem';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

export default function BoostScreen() {
  const [purchasing, setPurchasing] = useState(null);
  const { currentUser } = useAuth();
  const { wallet } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  const preselectedType = params.get('type');
  const targetId = params.get('id');

  useEffect(() => {
    setRightPanel(null);
    setContentAlign(isDesktop ? 'left' : 'center');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  const balance = wallet?.balance || 0;

  const handleBoost = async (type) => {
    const boost = BOOST_COSTS[type];
    if (!boost || !currentUser) return;
    if (balance < boost.coins) {
      showToast('Not enough coins — buy more first', 'error');
      return;
    }

    setPurchasing(type);
    try {
      const walletRef = doc(db, 'wallets', currentUser.uid);
      const walletSnap = await getDoc(walletRef);
      const currentBalance = walletSnap.exists() ? (walletSnap.data().balance || 0) : 0;
      if (currentBalance < boost.coins) {
        showToast('Not enough coins', 'error');
        setPurchasing(null);
        return;
      }

      await updateDoc(walletRef, {
        balance: currentBalance - boost.coins,
        totalSpent: (walletSnap.data().totalSpent || 0) + boost.coins,
      });

      const boostUntil = new Date(Date.now() + boost.duration * 3600000);

      await addDoc(collection(db, 'boosts'), {
        userId: currentUser.uid,
        type,
        targetId: targetId || null,
        coins: boost.coins,
        duration: boost.duration,
        boostUntil,
        status: 'active',
        createdAt: serverTimestamp(),
      });

      await addDoc(collection(db, 'transactions'), {
        userId: currentUser.uid,
        type: 'boost',
        amount: -boost.coins,
        description: `${boost.label} (${boost.duration}h)`,
        createdAt: serverTimestamp(),
      });

      await awardVP(currentUser.uid, 10);
      showToast(`${boost.label} activated! +10 VP`, 'success');
      navigate(-1);
    } catch (err) {
      console.error(err);
      showToast('Boost failed', 'error');
    }
    setPurchasing(null);
  };

  const BOOST_ICONS = { post: 'trending_up', profile: 'person_search', lfg: 'group_add', squad: 'shield', tournament: 'emoji_events' };
  const BOOST_COLORS = { post: '#FF4D6A', profile: '#7B6FFF', lfg: '#B44FFF', squad: '#C87FFF', tournament: '#F5C542' };

  return (
    <div className="min-h-screen pb-20 lg:pb-8">
      <TopBar title="Boost" showBack />

      <div className={`px-4 py-4 ${isDesktop ? 'max-w-lg' : ''}`}>
        <InfoTooltip id="boost_intro" icon="rocket_launch" color="#7B6FFF" title="Boost your visibility">
          Pay coins to promote your content. Your post, profile, or listing gets shown to more people for the duration. Boosts also earn you 10 VP each.
        </InfoTooltip>

        {/* Balance */}
        <div className="flex items-center gap-2 mb-4 px-1">
          <CoinIcon size={16} />
          <span className="text-brand-gold font-bold font-dmmono text-sm">{balance.toLocaleString()}</span>
          <span className="text-text-muted text-xs">coins available</span>
        </div>

        {/* Boost options */}
        <div className="space-y-2">
          {Object.entries(BOOST_COSTS).map(([type, boost]) => {
            const canAfford = balance >= boost.coins;
            const isHighlighted = preselectedType === type;
            const color = BOOST_COLORS[type];
            return (
              <div key={type} className={`p-4 rounded-2xl border transition-all ${isHighlighted ? 'border-brand-violet/40 bg-brand-violet/5' : 'border-white/[0.04] bg-surface-1'}`}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}15` }}>
                    <Icon name={BOOST_ICONS[type]} size={20} style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary text-sm font-bold">{boost.label}</p>
                    <p className="text-text-secondary text-xs mt-0.5">{boost.desc}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-brand-gold text-xs font-bold font-dmmono">{boost.coins} coins</span>
                      <span className="text-text-muted text-[10px]">€{(boost.coins * 0.01).toFixed(2)}</span>
                    </div>
                  </div>
                  <button onClick={() => handleBoost(type)} disabled={!canAfford || purchasing === type}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
                      canAfford ? 'bg-brand-violet text-white' : 'bg-surface-3 text-text-muted'
                    } disabled:opacity-50`}>
                    {purchasing === type ? '...' : canAfford ? 'Boost' : 'Need coins'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {balance < 25 && (
          <button onClick={() => navigate('/buy-coins')} className="w-full mt-4 py-3 rounded-xl bg-brand-gold/10 border border-brand-gold/20 text-brand-gold text-sm font-bold">
            Buy Coins to Boost
          </button>
        )}
      </div>
    </div>
  );
}
