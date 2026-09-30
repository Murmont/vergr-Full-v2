import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../Icon';
import BadgeGem from './BadgeGem';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { getMembershipTiers, getMyMembershipFor, subscribeMembership } from '../../firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import useResponsive from '../../hooks/useResponsive';

// The tier picker fans use to subscribe. One component, rendered as a centred modal
// on desktop and a bottom-sheet on mobile (B2 / B3 in the design). Handles the
// insufficient-balance state (B4) by routing to buy coins. Reads the creator's real
// published tiers and the fan's wallet; calls the secure subscribeMembership callable.
export default function SubscribeSheet({ creatorId, creatorName = 'this creator', onClose, onSubscribed }) {
  const { isDesktop } = useResponsive();
  const navigate = useNavigate();
  const { wallet } = useUser();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const [tiers, setTiers] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [already, setAlready] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ tiers: t }, mine] = await Promise.all([
        getMembershipTiers(creatorId),
        currentUser?.uid ? getMyMembershipFor(creatorId, currentUser.uid) : Promise.resolve(null),
      ]);
      if (!alive) return;
      setTiers(t);
      setAlready(mine);
      const popular = t.find((x) => x.popular) || t[0];
      setSelected(popular?.id || null);
    })();
    return () => { alive = false; };
  }, [creatorId, currentUser]);

  const balance = wallet?.balance || 0;
  const tier = (tiers || []).find((t) => t.id === selected) || null;
  const price = tier?.priceCoins || 0;
  const canAfford = balance >= price;

  const handleSubscribe = async () => {
    if (!currentUser?.uid) { navigate('/login'); return; }
    if (!tier) return;
    if (!canAfford) { onClose?.(); navigate('/wallet/buy'); return; }
    setBusy(true);
    try {
      await subscribeMembership({ creatorId, tierId: tier.id });
      showToast(`You're now a ${tier.name} member!`, 'success');
      onSubscribed?.(tier);
      onClose?.();
    } catch (err) {
      showToast(err?.message?.replace('FirebaseError: ', '') || 'Could not subscribe', 'error');
    }
    setBusy(false);
  };

  const panel = (
    <div className={`bg-bg-dark border border-white/10 overflow-hidden flex flex-col ${isDesktop ? 'w-[440px] max-h-[86vh] rounded-3xl' : 'w-full rounded-t-3xl max-h-[88vh] sheet-safe'}`}>
      {/* header */}
      <div className="relative px-6 pt-6 pb-4 shrink-0">
        {!isDesktop && <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-4" />}
        <button onClick={onClose} className="absolute top-5 right-5 text-text-muted hover:text-white"><Icon name="close" size={22} /></button>
        <div className="font-syne font-extrabold text-xl text-white">Support {creatorName}</div>
        <div className="text-sm text-text-secondary mt-1">Pick a tier. Cancel anytime, you keep access until the month ends.</div>
      </div>

      {/* tiers */}
      <div className="px-6 flex-1 overflow-y-auto space-y-3">
        {tiers === null ? (
          <div className="py-12 text-center text-text-muted"><Icon name="progress_activity" className="animate-spin" /></div>
        ) : tiers.length === 0 ? (
          <div className="py-12 text-center text-text-secondary text-sm">This creator hasn't set up memberships yet.</div>
        ) : tiers.map((t) => {
          const on = t.id === selected;
          return (
            <button key={t.id} onClick={() => setSelected(t.id)}
              className={`w-full text-left rounded-2xl p-4 border transition relative ${on ? 'border-brand-violet bg-brand-violet/10' : 'border-white/10 bg-surface-1 hover:border-white/20'}`}
              style={on && t.popular ? { boxShadow: '0 0 30px rgba(123,31,255,0.25)' } : undefined}>
              {t.popular && <span className="absolute -top-2.5 left-4 text-[10px] font-bold px-2 py-0.5 rounded-md bg-gradient-to-r from-brand-violet to-brand-pink text-white">★ MOST POPULAR</span>}
              <div className="flex items-center gap-3.5">
                <BadgeGem color={t.badge?.color} icon={t.badge?.icon} size={46} />
                <div className="flex-1 min-w-0">
                  <div className="font-syne font-bold text-white">{t.name}</div>
                  <div className="flex items-baseline gap-1 mt-0.5"><span className="text-brand-gold text-sm">●</span><span className="font-dmmono font-bold text-brand-gold tabular-nums">{t.priceCoins.toLocaleString()}</span><span className="text-text-muted text-xs font-dmmono">/mo</span></div>
                </div>
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${on ? 'border-brand-violet bg-brand-violet' : 'border-white/20'}`}>{on && <Icon name="check" size={13} className="text-white" />}</span>
              </div>
              {!!(t.perks || []).length && (
                <div className="mt-3 pl-[60px] space-y-1.5">
                  {t.perks.slice(0, 4).map((p, i) => (
                    <div key={i} className="flex items-center gap-2 text-[13px] text-text-secondary"><Icon name="check_circle" filled size={15} style={{ color: '#B44FFF' }} />{p}</div>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* footer */}
      <div className="px-6 pt-4 pb-6 shrink-0 border-t border-white/[0.06] mt-3">
        {already ? (
          <div className="text-center text-sm text-text-secondary py-2">You're already a <span className="text-brand-pink font-semibold">{already.tierName}</span> member. Manage it in <button onClick={() => { onClose?.(); navigate('/memberships'); }} className="text-brand-pink underline">My Memberships</button>.</div>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs mb-3">
              <span className="text-text-muted">Your balance</span>
              <span className="font-dmmono text-brand-gold">● {balance.toLocaleString()}</span>
            </div>
            <button onClick={handleSubscribe} disabled={busy || !tier}
              className="w-full py-3.5 rounded-2xl font-bold text-[15px] flex items-center justify-center gap-2 disabled:opacity-50 text-white"
              style={{ background: canAfford ? 'linear-gradient(135deg,#7B1FFF,#C87FFF)' : 'linear-gradient(135deg,#F0A500,#F5C842)', boxShadow: '0 10px 30px rgba(123,31,255,0.35)', color: canAfford ? '#fff' : '#3a2600' }}>
              {busy ? <Icon name="progress_activity" className="animate-spin" size={18} />
                : canAfford ? <>Subscribe — <span className="font-dmmono">● {price.toLocaleString()}</span> / month</>
                : <><Icon name="add_circle" size={17} />Buy coins to subscribe</>}
            </button>
            <div className="text-center text-[11px] text-text-muted mt-2.5">Renews monthly in coins. VERGR pays the creator a share of this revenue.</div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className={`fixed inset-0 z-[100] flex ${isDesktop ? 'items-center justify-center p-4' : 'items-end'} bg-black/70 backdrop-blur-sm`} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={isDesktop ? '' : 'w-full'}>{panel}</div>
    </div>
  );
}
