// Redesigned Subscription page — current plan hero, billing history, change plan modal.
// Pulls plans from src/utils/tierSystem.js (source of truth, NOT the design's hardcoded list).
// A plan never changes your revenue share: the share is set by lifetime earnings only.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import TopBar from '../../components/TopBar';
import useResponsive from '../../hooks/useResponsive';
import { TIERS, resolveTier } from '../../utils/tierSystem';
import { IS_NATIVE_BUILD, IS_STORE_BUILD, IS_HUAWEI_BUILD } from '../../utils/platform';
import { useAuth } from '../../context/AuthContext';
import { isPlayBillingSupported, buySubscription, fetchPlaySubPrices, playSubIdFor } from '../../utils/nativeBilling';
import { useBuyCheckout } from '../wallet/v2/buyCheckout';
import LocalPrice from '../../components/LocalPrice';
import { C, PageShell } from './_settingsUI';

// (The local popup/openExternalUrl helpers lived here; checkout now goes
// through the shared useBuyCheckout hook, which owns both.)

export default function SubscriptionScreen() {
  const { profile } = useUser();
  const { showToast } = useUI();
  const { isMobile } = useResponsive();
  const navigate = useNavigate();
  const { setRightPanel, setContentAlign } = useLayout();
  const [showChangePlan, setShowChangePlan] = useState(false);

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  const currentTierId = resolveTier(profile);
  const current = TIERS[currentTierId] || TIERS.free;
  const renewsAt = profile?.subscription?.renewsAt
    ? new Date(profile.subscription.renewsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  const billing = profile?.billingHistory || [];

  return (
    <div style={{ background: C.bg, minHeight: '100%' }}>
      {isMobile && <TopBar title="Subscription" showBack />}
      <PageShell>
        {/* Hero */}
        <div style={{
          background: 'linear-gradient(135deg,#12121e 60%,rgba(124,58,237,0.06))',
          border: `1px solid ${C.border}`, borderRadius: 12, padding: 24,
          display: 'flex', alignItems: 'flex-start', gap: 16,
          flexDirection: isMobile ? 'column' : 'row',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, flex: 1, flexDirection: isMobile ? 'column' : 'row' }}>
            <div>
              <span style={{
                background: C.purple, color: '#fff', fontSize: 10, fontWeight: 700,
                padding: '2px 8px', borderRadius: 4, letterSpacing: '0.06em',
              }}>CURRENT PLAN</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                <span style={{ fontSize: 28, fontWeight: 800, color: C.text }}>{current.name}</span>
                <img
                  src={`/brand/plans/${currentTierId}-plan.webp`}
                  alt={`${current.name} plan`}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  style={{ width: 28, height: 28, objectFit: 'contain' }}
                />
              </div>
              <div style={{ fontSize: 12, color: C.textVeryDim, marginTop: 4 }}>You're on the {current.name} plan</div>
              <div style={{ fontSize: 12, color: C.textVeryDim, marginTop: 2 }}>
                {currentTierId === 'free' ? 'No billing — upgrade to unlock perks' : `Next billing date: ${renewsAt}`}
              </div>
              <button
                type="button"
                onClick={() => setShowChangePlan(true)}
                style={{
                  marginTop: 14, background: C.borderSoft, border: `1px solid ${C.borderHard}`,
                  borderRadius: 8, color: C.text, fontSize: 13, padding: '7px 16px', cursor: 'pointer',
                }}
              >Change plan</button>
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: C.textDim, marginBottom: 12 }}>Your monthly bonuses</div>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {current.features.slice(0, 5).map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckCircle/>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text, maxWidth: 220 }}>{f}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.green }}>
                <Dot color={C.green}/>
                {currentTierId === 'pro' ? "You're getting the most out of VERGR." : 'Upgrade for more perks.'}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: C.textVeryDim }}>
                Your plan never changes your revenue share. That is set by your lifetime earnings only.
              </div>
            </div>
          </div>

          {!isMobile && (
            <div style={{ width: 110, height: 110, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img
                src={`/brand/plans/${currentTierId}-plan.webp`}
                alt={`${current.name} plan`}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                style={{ width: 104, height: 104, objectFit: 'contain' }}
              />
            </div>
          )}
        </div>

        {/* Billing + payment */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 320px', gap: 12, marginTop: 12 }}>
          <Card>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>Billing history</div>
            <div style={{ fontSize: 12, color: C.textVeryDim, marginBottom: 14 }}>View your recent payments and invoices.</div>
            {billing.length === 0 ? (
              <div style={{
                padding: '24px 12px', textAlign: 'center', color: C.textVeryDim,
                fontSize: 12, border: `1px dashed ${C.border}`, borderRadius: 8,
              }}>
                No billing history yet.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['DATE','DESCRIPTION','AMOUNT','STATUS'].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {billing.slice(0, 5).map((row, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
                      <td style={tdStyle}>{row.date}</td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 14, color: C.textVeryDim }}>receipt_long</span>
                          <div>
                            <div>{row.desc}</div>
                            {row.range && <div style={{ fontSize: 10, color: C.textVeryDim }}>{row.range}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={tdStyle}>{row.amount}</td>
                      <td style={{ padding: '12px 4px' }}>
                        <span style={{
                          background: 'rgba(34,197,94,0.1)', color: C.green,
                          border: '1px solid rgba(34,197,94,0.2)', borderRadius: 6,
                          padding: '2px 8px', fontSize: 11,
                        }}>{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>Payment method</div>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 0', borderBottom: `1px solid ${C.borderSoft}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {profile?.paymentMethod?.brand ? (
                    <>
                      <div style={{ background: '#1a3a6a', borderRadius: 4, padding: '3px 6px', fontSize: 10, fontWeight: 800, color: '#4a9eff' }}>
                        {profile.paymentMethod.brand.toUpperCase()}
                      </div>
                      <span style={{ fontSize: 13, color: C.textSoft }}>•••• {profile.paymentMethod.last4}</span>
                    </>
                  ) : (
                    <span style={{ fontSize: 13, color: C.textVeryDim }}>No payment method on file</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => showToast('Payment method update — coming soon', 'info')}
                  style={updateBtnStyle}
                >
                  {profile?.paymentMethod ? 'Update' : 'Add'} <ChevSm/>
                </button>
              </div>
            </Card>

            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>Billing details</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
                <div>
                  <div style={{ fontSize: 13, color: C.textSoft }}>Monthly billing</div>
                  <div style={{ fontSize: 11, color: C.textVeryDim, marginTop: 2 }}>
                    {currentTierId === 'free' ? 'No active subscription' : `Renews automatically on ${renewsAt}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowChangePlan(true)}
                  style={updateBtnStyle}
                >Manage <ChevSm/></button>
              </div>
            </Card>
          </div>
        </div>

        {showChangePlan && (
          <ChangePlanModal
            currentId={currentTierId}
            onClose={() => setShowChangePlan(false)}
          />
        )}
      </PageShell>
    </div>
  );
}

function ChangePlanModal({ currentId, onClose }) {
  const { showToast } = useUI();
  const tiers = ['free', 'lite', 'pro'];
  const [pickedTier, setPickedTier] = useState(null);     // tier the user clicked
  const [methodOpen, setMethodOpen] = useState(false);    // confirm modal
  // Card subscription runs through the ONE shared PayRam checkout+polling hook
  // (buyCheckout.js explicitly forbids forking the money flow). This screen
  // used to carry a near-identical copy, which had drifted: it still branched
  // on IS_NATIVE_BUILD, so the Tauri DESKTOP app got a webview popup that
  // renders blank — i.e. you could not pay for a subscription from it.
  const { currentUser } = useAuth();
  const { checkout, startCheckout, cancelCheckout } = useBuyCheckout(showToast, {
    onSettled: () => {
      showToast('Subscription activated!', 'success');
      onClose();
    },
  });
  const cardWaiting = !!checkout;

  // On the Play build a platform subscription is a digital feature unlocked
  // inside the app, so it MUST go through Play Billing. PayRam card checkout
  // stays the path on web, desktop and sideload.
  const usePlaySubs = IS_STORE_BUILD && !IS_HUAWEI_BUILD && isPlayBillingSupported();

  // Play's OWN localized price strings, keyed by product id.
  //
  // ⚠ The Play price is NOT the web price. docs/play/play-prices-by-market.csv
  // sets it per market, grossed up for local VAT and Google's service fee so
  // the net matches the web sale (see storePricing.playSubPriceFor). US Lite is
  // $5.99 on Play against $4.99 on the web.
  //
  // So rendering TIERS[t].price on a store build shows a number Google will not
  // charge, which is both a lie to the buyer and a Play policy problem at
  // review. fetchPlaySubPrices() has existed since the bridge was written and
  // was never called; this is that wiring. Falls back to the web price if the
  // bridge is slow or the product is missing, because a price is better than a
  // blank, and only the Play path can ever use these strings anyway.
  const [playPrices, setPlayPrices] = useState({});
  useEffect(() => {
    if (!usePlaySubs) return;
    let cancelled = false;
    fetchPlaySubPrices(['lite', 'pro'])
      .then((map) => { if (!cancelled) setPlayPrices(map || {}); })
      .catch(() => { /* fall back to the web label */ });
    return () => { cancelled = true; };
  }, [usePlaySubs]);

  /**
   * CARD checkout for a subscription. This is the path the buyer picked.
   *
   * ⚠ It used to IGNORE that choice and force Play Billing on a store build,
   * on the belief that a card checkout for digital goods inside a Play app
   * "gets an app pulled". That is not the rule. Google may not compel Play
   * Billing as the only option; it requires a fair, unsteered comparison, which
   * is what the method chooser above presents.
   *
   * The buyer opening this function has already chosen card. Overriding them
   * here made the chooser decorative.
   *
   * Play Billing remains available and is chosen by `startPlayCheckout`.
   */
  /**
   * CARD rail = PayRam (Stripe removed 2026-08-13, account closed by Stripe).
   *
   * Note this modal's "Pay by card" used to open an in-page Stripe panel, and
   * the PayRam handler was passed as an `onPayram` prop the local picker never
   * accepted, so PayRam was unreachable from here. Card now goes straight to it.
   */
  const startCardCheckout = (tier) => {
    setMethodOpen(false);
    startCheckout({ subscriptionTier: tier }, `${tier} plan`);
  };

  /** PLAY BILLING checkout. The other half of the same choice. */
  const startPlayCheckout = async (tier) => {
    setMethodOpen(false);
    if (!isPlayBillingSupported()) {
      // Only THIS rail is unavailable. The card rail above still works, so this
      // is a row-level failure, not a blocked purchase.
      showToast('Google Play billing is unavailable on this device. Try paying by card.', 'error');
      return;
    }
    try {
      await buySubscription(tier, currentUser?.uid);
      showToast('Subscription activated!', 'success');
      onClose();
    } catch (err) {
      if (err?.code === 'cancelled') return;
      showToast(err?.message || 'Could not start the subscription', 'error');
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
          padding: 24, width: 720, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Change plan</div>
            <div style={{ fontSize: 12, color: C.textVeryDim, marginTop: 2 }}>Choose the plan that's right for you.</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 24, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: IS_NATIVE_BUILD ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 16 }}>
          {tiers.map(id => {
            const tier = TIERS[id];
            const isCurrent = id === currentId;
            const isRecommended = id === 'pro';
            return (
              <div key={id} style={{
                background: isCurrent ? 'linear-gradient(135deg,rgba(124,58,237,0.12),rgba(109,40,217,0.06))' : C.card,
                border: isCurrent ? '1px solid rgba(124,58,237,0.4)' : `1px solid ${C.border}`,
                borderRadius: 12, padding: 16, position: 'relative',
                display: 'flex', flexDirection: 'column',
              }}>
                {isRecommended && !isCurrent && (
                  <div style={{
                    position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)',
                    background: C.purple, color: '#fff', fontSize: 9, fontWeight: 700,
                    letterSpacing: '0.08em', padding: '2px 10px', borderRadius: '0 0 6px 6px',
                    textTransform: 'uppercase',
                  }}>RECOMMENDED</div>
                )}
                <div style={{ paddingTop: isRecommended ? 8 : 0, display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <img
                    src={`/brand/plans/${id}-plan.webp`}
                    alt={`${tier.name} plan`}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    style={{ width: 56, height: 56, objectFit: 'contain', marginBottom: 8 }}
                  />
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{tier.name}</div>
                  <div style={{
                    fontSize: 22, fontWeight: 800,
                    color: isCurrent ? C.purpleLight : C.text, marginTop: 4,
                  }}>
                    {tier.price === 0 ? '€0'
                      : (usePlaySubs && playPrices[playSubIdFor(tier.id)]?.price)
                        ? playPrices[playSubIdFor(tier.id)].price
                        : <LocalPrice eur={tier.price} fallback={`€${tier.price}`} />}
                    <span style={{ fontSize: 13, fontWeight: 400, color: C.textDim }}>/month</span>
                  </div>
                  {tier.price > 0 && (
                    <div style={{ fontSize: 10, color: C.textVeryDim, marginTop: 2 }}>
                      {/* Play's string is already tax-inclusive in every market
                          that charges VAT, and Google bills in local currency.
                          Saying "exc. VAT, billed in USD" over it would be
                          wrong on both counts. */}
                      {usePlaySubs && playPrices[playSubIdFor(tier.id)]?.price
                        ? 'incl. tax · billed by Google Play'
                        : 'exc. VAT/tax · billed in USD/USDT'}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: C.textVeryDim, marginTop: 4, marginBottom: 12 }}>{tier.tagline}</div>
                  <div style={{ flex: 1 }}>
                    {tier.features.map(f => (
                      <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ marginTop: 2, flexShrink: 0 }}>
                          <path d="M20 6L9 17l-5-5" stroke={C.purple} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span style={{ fontSize: 11, color: C.textMuted }}>{f}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={isCurrent}
                    onClick={() => {
                      if (isCurrent) return;
                      if (id === 'free') {
                        // Downgrade — separate flow (cancelSubscription)
                        if (window.confirm('Cancel paid plan? You keep your current tier until period end.')) {
                          import('firebase/functions').then(({ getFunctions, httpsCallable }) =>
                            httpsCallable(getFunctions(undefined, 'europe-west1'), 'cancelSubscription')()
                          );
                        }
                        return;
                      }
                      setPickedTier(id);
                      setMethodOpen(true);
                    }}
                    style={{
                      marginTop: 14, width: '100%', borderRadius: 8, padding: '9px',
                      fontSize: 13, fontWeight: 600,
                      cursor: isCurrent ? 'default' : 'pointer',
                      background: isCurrent
                        ? `linear-gradient(135deg,${C.purple},${C.purpleDeep})`
                        : id === 'free' ? 'transparent' : `linear-gradient(135deg,${C.purple},${C.purpleDeep})`,
                      color: '#fff',
                      border: id === 'free' && !isCurrent ? `1px solid ${C.borderHard}` : 'none',
                      opacity: isCurrent ? 0.85 : 1,
                    }}
                  >
                    {isCurrent ? 'Current plan' : `Choose ${tier.name}`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{
          textAlign: 'center', marginTop: 14, fontSize: 11, color: C.textVeryDim,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>shield</span>
          All plans include access to VERGR core features. A plan never changes your creator revenue share. Prices exclude VAT/tax; checkout is processed in USD/USDT.
        </div>
      </div>

      {methodOpen && pickedTier && (
        <PaymentMethodPicker
          tier={pickedTier}
          onCard={() => startCardCheckout(pickedTier)}
          onPlay={() => startPlayCheckout(pickedTier)}
          playOffered={usePlaySubs}
          onCoins={async () => {
            try {
              const { getFunctions, httpsCallable } = await import('firebase/functions');
              const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'subscribeWithCoins');
              await fn({ tier: pickedTier });
              setMethodOpen(false);
              setPickedTier(null);
              showToast('Subscription activated!', 'success');
              onClose();
            } catch (e) { showToast(e?.message || 'Subscription failed', 'error'); }
          }}
          onClose={() => { setMethodOpen(false); setPickedTier(null); }}
        />
      )}

      {cardWaiting && (
        <div onClick={(e) => e.stopPropagation()} style={{
          position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.82)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
            padding: 24, width: 380, maxWidth: '95vw', textAlign: 'center',
          }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 8 }}>Complete your payment</div>
            <div style={{ fontSize: 12, color: C.textVeryDim, marginBottom: 18, lineHeight: 1.5 }}>
              Finish paying in the checkout window. This page activates your plan automatically the moment payment confirms — keep it open.
            </div>
            {/* Was `stopPoll(); closePopup(); setCardWaiting(false);` — three
                identifiers that exist nowhere in this file, so Cancel on the
                "Complete your payment" modal threw a ReferenceError and, with no
                error boundary, blanked the app mid-checkout (audit A41 #3).
                `useBuyCheckout` already returns `cancelCheckout`, which does
                exactly those three things (stopPolling + closePopup +
                setCheckout(null)); this screen simply never destructured it.
                `cardWaiting` is derived from `checkout`, so a setter for it
                could never have existed. */}
            <button onClick={cancelCheckout} style={{
              width: '100%', padding: 11, borderRadius: 10, background: 'transparent',
              color: C.textDim, border: `1px solid ${C.borderHard}`, cursor: 'pointer', fontSize: 13,
            }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * @param {function} [onPlay]      Google Play Billing. Omitted where unavailable.
 * @param {boolean}  [playOffered] true only on a Play build with a live bridge.
 *
 * ⚠ FAIR COMPARISON. Google permits alternative billing but requires the options
 * be presented without steering. So the Play row carries the SAME padding, type
 * scale and tap target as the card row, no badge calls either one better, and
 * neither is pre-selected. Do not restyle one of these rows without the other.
 */
function PaymentMethodPicker({ tier, onCard, onCoins, onPlay, playOffered, onClose }) {
  const COIN_PRICE = { lite: 500, pro: 1000 }[tier];
  const EUR_PRICE = { lite: 4.99, pro: 9.99 }[tier];
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
        padding: 20, width: 380, maxWidth: '95vw',
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>How do you want to pay?</div>
        <div style={{ fontSize: 12, color: C.textVeryDim, marginBottom: 14 }}>One month of {tier === 'lite' ? 'Lite' : 'Pro'}.</div>
        <button onClick={onCard} style={{
          width: '100%', padding: 14, marginBottom: 8, borderRadius: 10,
          background: `linear-gradient(135deg,${C.purple},${C.purpleDeep})`, color: '#fff', border: 'none',
          textAlign: 'left', cursor: 'pointer',
        }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Pay by card</div>
          <div style={{ fontSize: 11, opacity: 0.85 }}>
            <LocalPrice eur={EUR_PRICE} fallback={`€${EUR_PRICE}`} />/month · Visa, Mastercard, Apple Pay
          </div>
          <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>exc. VAT/tax · billed in USD/USDT</div>
        </button>
        {/* Google Play. Present ONLY on a Play build with a working bridge, and
            styled identically to the card row above so neither is steered. It
            was missing entirely, which meant a Play user had no legitimate way
            to choose Play Billing even while the code was forcing them onto it. */}
        {playOffered && (
          <button onClick={onPlay} style={{
            width: '100%', padding: 14, marginBottom: 8, borderRadius: 10,
            background: 'transparent', color: C.text, border: `1px solid ${C.borderHard}`,
            textAlign: 'left', cursor: 'pointer',
          }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Google Play</div>
            <div style={{ fontSize: 11, color: C.textDim }}>
              Billed by Google. Includes Google Play&rsquo;s service fee
            </div>
          </button>
        )}
        <button onClick={onCoins} style={{
          width: '100%', padding: 14, marginBottom: 8, borderRadius: 10,
          background: 'transparent', color: C.text, border: `1px solid ${C.borderHard}`,
          textAlign: 'left', cursor: 'pointer',
        }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Pay with coins</div>
          <div style={{ fontSize: 11, color: C.textDim }}>{COIN_PRICE} coins from your wallet</div>
        </button>
        <button onClick={onClose} style={{
          width: '100%', padding: 10, marginTop: 4, borderRadius: 10,
          background: 'transparent', color: C.textDim, border: 'none', cursor: 'pointer', fontSize: 12,
        }}>Cancel</button>
      </div>
    </div>
  );
}

function Card({ children }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
      {children}
    </div>
  );
}

function VLogo({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <polygon points="12,2 22,20 2,20" fill="#7c3aed"/>
      <text x="12" y="17" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold" fontFamily="sans-serif">V</text>
    </svg>
  );
}

function CheckCircle() {
  return (
    <div style={{
      width: 16, height: 16, borderRadius: '50%',
      border: `1.5px solid ${C.purple}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
        <path d="M2 5l2 2 4-4" stroke={C.purple} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

function Dot({ color }) {
  return <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }}/>;
}

function ChevSm() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 18l6-6-6-6"/>
    </svg>
  );
}

const thStyle = {
  textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
  color: C.textVeryDim, padding: '6px 4px', borderBottom: `1px solid ${C.border}`,
  textTransform: 'uppercase',
};
const tdStyle = { fontSize: 12, color: C.textSoft, padding: '12px 4px' };
const updateBtnStyle = {
  background: 'transparent', border: 'none', color: C.purple,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 4,
};
