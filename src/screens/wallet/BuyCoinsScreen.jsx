// Buy VC Coins screen.
// Pack catalog + economy floor lives in src/utils/vpSystem.js (single source
// of truth). HARD FLOOR: €0.0090 per coin — never drop below it on any pack
// or promo. New users get a one-shot 20% discount (cap €3) on their first
// paid pack to drive activation; server enforces via wallet.firstPurchaseUsed.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import { COIN_PACKS, FIRST_PURCHASE_DISCOUNT, applyFirstPurchaseDiscount, REFERRAL_VP_REFERRER } from '../../utils/vpSystem';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { CoinIcon, VPIcon } from '../../components/CoinIcon';
import Modal from '../../components/Modal';
import useResponsive from '../../hooks/useResponsive';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config';

// Custom amount priced at the Starter per-coin rate (no bulk discount).
const PER_COIN_RATE = 0.0099;
const CUSTOM_MIN    = 100;

// Each catalog pack expects a graphic at /public/brand/packs/<id>-pack.png.
const slugFor = (id) => `${id}-pack`;

export default function BuyCoinsScreen() {
  const { wallet } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { isMobile } = useResponsive();
  const { setContentAlign } = useLayout();

  // Use the full content width (no 680px cap) — pack grid needs the room.
  useEffect(() => {
    setContentAlign('left');
    return () => setContentAlign('center');
  }, [setContentAlign]);

  // First-purchase eligibility: server flips wallet.firstPurchaseUsed to true
  // inside the same tx that records the purchase. Until set, the user is on
  // their first pack and qualifies for the 20%/€3-cap discount.
  const firstPurchase = !wallet?.firstPurchaseUsed;

  const [selectedPack, setSelectedPack] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [customAmount, setCustomAmount] = useState('200');

  const customNum = Number.parseInt(customAmount, 10) || 0;
  const customValid = customNum >= CUSTOM_MIN;
  const customRawPrice = +(customNum * PER_COIN_RATE).toFixed(2);
  const customDiscount = firstPurchase ? applyFirstPurchaseDiscount(customRawPrice) : null;
  const customFinalPrice = customDiscount?.finalPrice ?? customRawPrice;

  const handleBuy = (pack) => {
    setSelectedPack(pack);
    setShowPaymentModal(true);
  };

  const handleCustomBuy = () => {
    if (!customValid) return;
    handleBuy({
      id: 'custom',
      name: `${customNum.toLocaleString()} Coins`,
      coins: customNum,
      priceEUR: customRawPrice,
      vpBonus: 0,
    });
  };

  return (
    <div className="pb-10" style={{ background: '#0B0B14' }}>
      {isMobile && <TopBar title="Buy VC Coins" showBack />}

      <div className="px-4 md:px-7 py-5 md:py-7">
        {/* Header */}
        {!isMobile && (
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="font-syne text-3xl font-black text-text-primary">Buy VC Coins</h1>
              <p className="text-text-muted text-sm mt-1">Choose a pack to top up your wallet — bigger packs offer better value</p>
            </div>
            <button
              onClick={() => navigate('/wallet')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12px] font-semibold transition-colors"
              style={{ background: '#14141F', border: '1px solid #1E1E2E', color: '#9CA3AF' }}
            >
              <Icon name="arrow_back" size={14} /> Back to Wallet
            </button>
          </div>
        )}

        {/* First-purchase discount banner */}
        {firstPurchase && (
          <div
            className="rounded-2xl px-5 md:px-6 py-4 mb-5 flex items-center gap-4"
            style={{
              background: 'linear-gradient(90deg, rgba(240,60,96,0.12), rgba(245,158,11,0.10))',
              border: '1px solid rgba(245,158,11,0.40)',
              boxShadow: '0 0 32px rgba(240,60,96,0.10)',
            }}
          >
            <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
                 style={{ background: 'linear-gradient(135deg, #F59E0B, #EF4444)' }}>
              <Icon name="local_offer" size={22} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-text-primary font-extrabold text-[15px]">
                {Math.round(FIRST_PURCHASE_DISCOUNT.pct * 100)}% OFF your first pack
              </p>
              <p className="text-text-muted text-[12px] mt-0.5">
                One-time welcome discount — applied automatically at checkout. Every pack after this is full price.
              </p>
            </div>
            <span className="hidden md:inline px-3 py-1 rounded-full text-[10px] font-extrabold tracking-wider uppercase whitespace-nowrap"
                  style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.35)' }}>
              One-time offer
            </span>
          </div>
        )}

        {/* Hero */}
        <div
          className="rounded-2xl px-5 md:px-7 py-5 mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
          style={{
            background: 'linear-gradient(135deg, rgba(123,31,255,0.12) 0%, rgba(61,127,255,0.06) 100%)',
            border: '1px solid rgba(123,31,255,0.20)',
          }}
        >
          <div>
            <h2 className="text-text-primary text-lg md:text-xl font-extrabold flex items-center gap-2">
              <CoinIcon size={22} /> Top Up Your VC Coins
            </h2>
            <p className="text-text-muted text-[13px] mt-1.5 max-w-[460px] leading-relaxed">
              VC Coins fuel everything on VERGR — tip creators, join memberships, unlock paid streams, boost posts, and reward your squad. Coins are spendable only inside VERGR.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <BalanceTile graphic={<CoinIcon size={56} className="drop-shadow-[0_0_18px_rgba(240,165,0,0.55)]" />} label="Balance" value={`${(wallet?.balance || 0).toLocaleString()} VC`} valColor="#F0A500" />
            <BalanceTile graphic={<VPIcon size={56} className="drop-shadow-[0_0_18px_rgba(180,79,255,0.55)]" />} label="VP" value={`${(wallet?.vp || 0).toLocaleString()} VP`} valColor="#B44FFF" />
          </div>
        </div>

        {/* Section header */}
        <div className="flex items-baseline gap-3 mb-4">
          <h3 className="text-text-primary font-bold text-base">All Packs</h3>
          <span className="text-text-muted text-xs">{COIN_PACKS.length} packs available</span>
        </div>

        {/* Pack grid */}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {COIN_PACKS.map(pack => (
            <PackCard
              key={pack.id}
              pack={pack}
              firstPurchase={firstPurchase}
              onBuy={handleBuy}
            />
          ))}
        </div>

        {/* Custom amount card */}
        <div
          className="mt-6 rounded-2xl flex flex-col md:flex-row md:items-center gap-5 p-5 md:py-5 md:px-6"
          style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <CoinIcon size={64} className="shrink-0 drop-shadow-[0_0_18px_rgba(240,165,0,0.5)]" />
          <div className="flex-1 min-w-0">
            <p className="text-text-primary font-extrabold text-[15px]">Custom Amount</p>
            <p className="text-text-muted text-[12px] mt-0.5">Enter any amount over {CUSTOM_MIN} VC — priced at €{PER_COIN_RATE.toFixed(4)} per coin</p>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="relative">
              <CoinIcon size={18} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="number"
                min={CUSTOM_MIN}
                step={10}
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder={`Min ${CUSTOM_MIN}`}
                className="w-[140px] pl-9 pr-3 py-2.5 rounded-[10px] text-[15px] font-bold font-dmmono outline-none"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: customValid ? '1px solid rgba(240,165,0,0.30)' : '1px solid rgba(240,60,96,0.50)',
                  color: '#fff',
                }}
              />
            </div>
            <span className="text-text-muted text-[13px]">VC =</span>
            <span className="flex flex-col items-start min-w-[80px]">
              {customDiscount && customDiscount.saving > 0 && customValid && (
                <span className="text-[10px] line-through text-text-muted/70 font-dmmono">€{customRawPrice.toFixed(2)}</span>
              )}
              <span
                className="font-black tabular-nums font-dmmono text-lg"
                style={{ color: '#F0A500', opacity: customValid ? 1 : 0.3 }}
              >
                €{customFinalPrice.toFixed(2)}
              </span>
            </span>
            <button
              onClick={handleCustomBuy}
              disabled={!customValid}
              className="px-5 py-2.5 rounded-[10px] text-[14px] font-bold whitespace-nowrap transition-all hover:brightness-125"
              style={customValid
                ? { background: 'rgba(240,165,0,0.10)', border: '1px solid rgba(240,165,0,0.40)', color: '#F0A500' }
                : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: '#6B7280', cursor: 'not-allowed' }}
            >
              Buy Now
            </button>
            {!customValid && (
              <span className="text-[11px]" style={{ color: '#F04060' }}>Min. {CUSTOM_MIN} VC</span>
            )}
          </div>
        </div>

        {/* Referral CTA — drives growth without subsidising coin price */}
        <button
          onClick={() => navigate('/earn/refer')}
          className="mt-5 w-full rounded-2xl px-5 py-4 flex items-center gap-4 text-left transition-colors hover:brightness-110"
          style={{
            background: 'linear-gradient(90deg, rgba(123,31,255,0.10), rgba(61,127,255,0.06))',
            border: '1px solid rgba(123,31,255,0.30)',
          }}
        >
          <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
               style={{ background: 'rgba(180,79,255,0.20)' }}>
            <Icon name="person_add" size={20} style={{ color: '#B44FFF' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-text-primary font-extrabold text-[14px]">Invite friends, earn up to {REFERRAL_VP_REFERRER.toLocaleString()} VP</p>
            <p className="text-text-muted text-[12px] mt-0.5">Higher VP = lower commission when you convert coins → gems. They get 3,000 VP too.</p>
          </div>
          <Icon name="arrow_forward" size={18} className="text-text-muted shrink-0" />
        </button>

        {/* Trust strip */}
        <div className="mt-6 flex items-center justify-center gap-5 text-text-muted/60">
          {[
            { icon: 'lock', label: 'Secure' },
            { icon: 'bolt', label: 'Instant delivery' },
            { icon: 'shield', label: 'Protected' },
          ].map(t => (
            <div key={t.label} className="flex items-center gap-1.5 text-xs">
              <Icon name={t.icon} size={14} /> <span>{t.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Payment modal */}
      <Modal isOpen={showPaymentModal} onClose={() => setShowPaymentModal(false)} title="Complete Purchase">
        {selectedPack && (
          <PaymentSummary
            pack={selectedPack}
            firstPurchase={firstPurchase}
            onClose={() => setShowPaymentModal(false)}
            showToast={showToast}
          />
        )}
      </Modal>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function BalanceTile({ graphic, label, value, valColor }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1.5 px-5 py-3 rounded-xl min-w-[120px]"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <div className="h-14 flex items-center justify-center">{graphic}</div>
      <span className="text-text-muted text-[10px] font-bold uppercase tracking-wider">{label}</span>
      <span className="font-extrabold tabular-nums font-dmmono text-[15px] leading-none" style={{ color: valColor }}>{value}</span>
    </div>
  );
}

function PackCard({ pack, firstPurchase, onBuy }) {
  const isVP   = (pack.vpBonus || 0) > 0;
  const slug   = slugFor(pack.id);

  // Pricing — apply first-purchase discount for the preview if eligible
  const discount = firstPurchase ? applyFirstPurchaseDiscount(pack.priceEUR) : null;
  const finalPrice = discount?.finalPrice ?? pack.priceEUR;
  const showStrikethrough = discount && discount.saving > 0;

  // Badge selection: badgeStyle is set in vpSystem catalog.
  const badgeStyles = {
    popular: { background: 'linear-gradient(90deg, #F59E0B, #EF4444)', color: '#fff' },
    value:   { background: 'linear-gradient(90deg, #10B981, #3B82F6)', color: '#fff' },
    vp:      { background: 'linear-gradient(90deg, #7B1FFF, #B44FFF)', color: '#fff' },
  };
  const badgeStyle = pack.badgeStyle ? badgeStyles[pack.badgeStyle] : null;

  // Container styling: VP packs get the violet gradient; "popular" gets the violet-tinted bg
  const cardStyle = isVP
    ? {
        background: 'linear-gradient(160deg, rgba(123,31,255,0.10) 0%, rgba(61,127,255,0.05) 100%)',
        border: '1px solid rgba(180,79,255,0.40)',
        boxShadow: '0 0 40px rgba(123,31,255,0.15)',
      }
    : pack.badgeStyle === 'popular'
      ? { background: 'rgba(123,31,255,0.07)', border: '1px solid rgba(123,31,255,0.45)', boxShadow: '0 0 30px rgba(123,31,255,0.12)' }
      : pack.badgeStyle === 'value'
        ? { background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.35)', boxShadow: '0 0 30px rgba(16,185,129,0.10)' }
        : { background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' };

  const imgFilter = isVP
    ? 'drop-shadow(0 8px 28px rgba(123,31,255,0.45))'
    : 'drop-shadow(0 8px 24px rgba(240,165,0,0.25))';

  const btnStyle = isVP
    ? { background: 'linear-gradient(135deg, rgba(123,31,255,0.35), rgba(61,127,255,0.20))', border: '1px solid rgba(180,79,255,0.60)', color: '#fff', boxShadow: '0 4px 20px rgba(123,31,255,0.20)' }
    : pack.badgeStyle === 'popular'
      ? { background: 'rgba(123,31,255,0.15)', border: '1px solid rgba(180,79,255,0.50)', color: '#B44FFF' }
      : pack.badgeStyle === 'value'
        ? { background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.45)', color: '#22D17E' }
        : { background: 'rgba(240,165,0,0.10)', border: '1px solid rgba(240,165,0,0.40)', color: '#F0A500' };

  // Optional promo VP-bonus pill (server-set on the pack doc as `promoVPBonus` + `promoLabel`)
  const promo = pack.promoVPBonus > 0 ? pack : null;

  return (
    <button
      onClick={() => onBuy(pack)}
      className="relative rounded-2xl px-4 pt-5 pb-4 flex flex-col items-center text-center transition-all hover:-translate-y-1"
      style={cardStyle}
    >
      {pack.badge && badgeStyle && (
        <span
          className="absolute -top-3 left-1/2 -translate-x-1/2 px-3.5 py-1 rounded-full whitespace-nowrap text-[9px] font-extrabold tracking-wider uppercase z-10"
          style={badgeStyle}
        >
          {pack.badge}
        </span>
      )}

      {/* Pack image */}
      <div className="w-[130px] h-[130px] flex items-center justify-center mb-3.5">
        <img
          src={`/brand/packs/${slug}.png`}
          alt={pack.name}
          className="w-full h-full object-contain"
          style={{ filter: imgFilter }}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          draggable={false}
        />
      </div>

      <p className="text-[15px] font-extrabold text-text-primary mb-1.5">{pack.name}</p>
      <p className="inline-flex items-center gap-1.5 text-[13px] font-bold mb-1" style={{ color: '#F0A500' }}>
        <CoinIcon size={15} /> {pack.coins.toLocaleString()} VC Coins
      </p>
      {(pack.vpBonus > 0) && (
        <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold mb-1" style={{ color: '#B44FFF' }}>
          <VPIcon size={13} /> + {pack.vpBonus.toLocaleString()} VP Points Bonus
        </p>
      )}
      {promo && (
        <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider mb-1 px-2 py-0.5 rounded-full"
           style={{ background: 'rgba(180,79,255,0.15)', color: '#B44FFF', border: '1px solid rgba(180,79,255,0.35)' }}>
          <VPIcon size={11} /> {pack.promoLabel || `+${pack.promoVPBonus.toLocaleString()} bonus VP`}
        </p>
      )}
      <p className="text-text-muted text-[11px] leading-relaxed mb-3.5 px-1">{pack.tagline}</p>

      {/* Price button (with strikethrough when first-purchase discount applies) */}
      <span
        className="w-full py-2.5 rounded-[10px] text-[15px] font-extrabold flex items-center justify-center gap-1.5 mt-auto"
        style={btnStyle}
      >
        {showStrikethrough && (
          <span className="text-[11px] line-through opacity-60 font-dmmono">€{pack.priceEUR.toFixed(2)}</span>
        )}
        €{finalPrice.toFixed(2)}
      </span>
      {showStrikethrough && (
        <span className="text-[10px] mt-1.5 font-bold" style={{ color: '#F59E0B' }}>
          Save €{discount.saving.toFixed(2)} · first purchase
        </span>
      )}
    </button>
  );
}

function PaymentSummary({ pack, firstPurchase, onClose, showToast }) {
  const slug = slugFor(pack.id);
  const discount = firstPurchase ? applyFirstPurchaseDiscount(pack.priceEUR) : null;
  const finalPrice = discount?.finalPrice ?? pack.priceEUR;
  const saving = discount?.saving ?? 0;
  const [working, setWorking] = useState(false);

  const handlePay = async () => {
    if (working || pack.id === 'custom') {
      if (pack.id === 'custom') showToast('Custom amount purchase coming soon', 'info');
      return;
    }
    setWorking(true);
    try {
      const fn = httpsCallable(functions, 'createPurchaseInvoice');
      const res = await fn({ packId: pack.id, appUrl: window.location.origin });
      const url = res.data?.invoiceUrl;
      if (!url) throw new Error('No invoice URL returned');
      // Open NOWPayments hosted checkout in a new tab — works on mobile too
      window.open(url, '_blank', 'noopener,noreferrer');
      showToast('Invoice opened in new tab — complete payment there', 'info');
      onClose();
    } catch (err) {
      console.error('Invoice creation failed', err);
      showToast(err?.message || 'Could not create invoice', 'error');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-2xl text-center" style={{ background: '#1A1A2A', border: '1px solid #1E1E2E' }}>
        <img
          src={`/brand/packs/${slug}.png`}
          alt={pack.name}
          className="w-20 h-20 object-contain mx-auto mb-2 drop-shadow-[0_8px_24px_rgba(240,165,0,0.35)]"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          draggable={false}
        />
        <h3 className="font-extrabold text-lg text-text-primary">{pack.name}</h3>
        <p className="font-dmmono text-sm flex items-center justify-center gap-1.5 mt-1" style={{ color: '#F0A500' }}>
          <CoinIcon size={14} /> {pack.coins?.toLocaleString()} VC Coins
        </p>
        {(pack.vpBonus > 0) && (
          <p className="font-dmmono text-xs flex items-center justify-center gap-1.5 mt-1" style={{ color: '#B44FFF' }}>
            <VPIcon size={12} /> + {pack.vpBonus.toLocaleString()} VP Points bonus
          </p>
        )}
        <div className="mt-2 flex items-baseline justify-center gap-2">
          {saving > 0 && (
            <span className="text-text-muted line-through font-dmmono">€{pack.priceEUR.toFixed(2)}</span>
          )}
          <span className="text-2xl font-black text-text-primary">€{finalPrice.toFixed(2)}</span>
        </div>
        {saving > 0 && (
          <p className="text-[11px] mt-1 font-bold" style={{ color: '#F59E0B' }}>
            First-purchase discount: −€{saving.toFixed(2)}
          </p>
        )}
      </div>

      <div className="p-3.5 rounded-xl space-y-2" style={{ background: '#14141F', border: '1px solid #1E1E2E' }}>
        <p className="text-text-secondary text-[11px] font-bold uppercase tracking-wider">Pay with</p>
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg" style={{ background: 'rgba(61,127,255,0.06)', border: '1px solid rgba(61,127,255,0.30)' }}>
          <Icon name="account_balance_wallet" size={18} style={{ color: '#3D7FFF' }} />
          <div className="flex-1">
            <p className="text-sm font-bold text-text-primary">Crypto or Card</p>
            <p className="text-[10.5px] text-text-muted">BTC, ETH, USDT + 30 more · Card via Banxa · powered by NOWPayments</p>
          </div>
        </div>
        <p className="text-[10.5px] text-text-muted leading-relaxed">
          You'll be redirected to NOWPayments' secure checkout. Coins land in your wallet automatically once payment confirms on-chain.
        </p>
      </div>

      <button
        onClick={handlePay}
        disabled={working}
        className="w-full py-3.5 rounded-xl text-sm font-extrabold flex items-center justify-center gap-2 transition-colors hover:brightness-125"
        style={working
          ? { background: 'rgba(255,255,255,0.04)', color: '#6B7280', border: '1px solid rgba(255,255,255,0.06)', cursor: 'wait' }
          : { background: 'linear-gradient(135deg, rgba(240,165,0,0.20), rgba(245,158,11,0.10))', color: '#F0A500', border: '1px solid rgba(240,165,0,0.50)' }}
      >
        {working ? 'Creating invoice…' : <>Pay €{finalPrice.toFixed(2)} <Icon name="open_in_new" size={14} /></>}
      </button>
    </div>
  );
}
