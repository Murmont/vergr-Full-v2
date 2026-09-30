// Redesigned Subscription page — current plan hero, billing history, change plan modal.
// Pulls plans from src/utils/tierSystem.js (source of truth, NOT the design's hardcoded list).
// A plan never changes your revenue share: the share is set by lifetime earnings only.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import useAppGate, { codaOfferedTo } from '../../hooks/useAppGate';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import TopBar from '../../components/TopBar';
import useResponsive from '../../hooks/useResponsive';
import { TIERS, resolveTier } from '../../utils/tierSystem';
import { IS_NATIVE_BUILD, IS_STORE_BUILD, IS_HUAWEI_BUILD, IS_PLAY_BUILD, STORE_NAME } from '../../utils/platform';
import { useAuth } from '../../context/AuthContext';
import { isPlayBillingSupported, buySubscription, fetchPlaySubPrices, playSubIdFor } from '../../utils/nativeBilling';
import { useBuyCheckout } from '../wallet/v2/buyCheckout';
import LocalPrice from '../../components/LocalPrice';
import { CodaCheckoutBlock } from '../../components/wallet/CodaPay';
import useSubscriptionsPaused from '../../hooks/useSubscriptionsPaused';
import { C, PageShell } from './_settingsUI';
import { getTransactions } from '../../firebase/firestore';
import { openExternalUrl } from '../../utils/externalBrowser';
import { PLAY_PACKAGE } from '../../utils/referral';

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
  // Every rail writes subscriptionPeriodEnd / subscriptionAutoRenew /
  // subscriptionPreferredMethod. This read `subscription.renewsAt` and
  // `profile.billingHistory`, which nothing writes, so the next billing date was
  // always a dash and the history always empty.
  const plan = planStatus(profile, currentTierId);
  const billing = useSubscriptionHistory(profile?.uid || profile?.id, plan.method);

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
                {plan.line}
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
              plan.method === 'google_play' ? (
                <div style={{ padding: '16px 12px', textAlign: 'center', color: C.textVeryDim, fontSize: 12, background: C.bg, borderRadius: 8 }}>
                  Google Play bills this plan and keeps its receipts.
                  <button type="button" onClick={() => openStoreUrl(PLAY_ORDERS_URL)} style={{ ...updateBtnStyle, margin: '8px auto 0' }}>
                    Open Google Play receipts <ChevSm/>
                  </button>
                </div>
              ) : (
                <div style={{ padding: '24px 12px', textAlign: 'center', color: C.textVeryDim, fontSize: 12, background: C.bg, borderRadius: 8 }}>
                  No billing history yet.
                </div>
              )
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, color: C.textSoft }}>{methodLabel(currentTierId, plan.method).title}</span>
                  <span style={{ fontSize: 11, color: C.textVeryDim }}>{methodLabel(currentTierId, plan.method).detail}</span>
                </div>
                {plan.method === 'google_play' && (
                  <button type="button" onClick={() => manageStoreSubscription(currentTierId)} style={updateBtnStyle}>
                    Manage <ChevSm/>
                  </button>
                )}
              </div>
            </Card>

            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>Billing details</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
                <div>
                  <div style={{ fontSize: 13, color: C.textSoft }}>Monthly billing</div>
                  <div style={{ fontSize: 11, color: C.textVeryDim, marginTop: 2 }}>
                    {currentTierId === 'free' ? 'No active subscription'
                      : !plan.date ? 'Active'
                        : plan.autoRenew ? `Renews automatically on ${plan.date}` : `Ends on ${plan.date}, no renewal`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => (plan.method === 'google_play' ? manageStoreSubscription(currentTierId) : setShowChangePlan(true))}
                  style={updateBtnStyle}
                >Manage <ChevSm/></button>
              </div>
            </Card>
          </div>
        </div>

        {showChangePlan && (
          <ChangePlanModal
            currentId={currentTierId}
            currentMethod={plan.method}
            onClose={() => setShowChangePlan(false)}
          />
        )}
      </PageShell>
    </div>
  );
}

function ChangePlanModal({ currentId, currentMethod, onClose }) {
  const { showToast } = useUI();
  const tiers = ['free', 'lite', 'pro'];
  const [pickedTier, setPickedTier] = useState(null);     // tier the user clicked
  const [methodOpen, setMethodOpen] = useState(false);    // confirm modal
  // Vergr Admin → Subscriptions → Settings. The only way to stop a Play or
  // AppGallery purchase is not to offer it; coins and card are also refused
  // on the server. Cancelling a plan is always allowed.
  const paused = useSubscriptionsPaused();
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

  // Codapay (founder, 2026-09-24): ONE month, paid once, no auto-renew. Coda
  // cannot charge a saved card without the buyer present yet, so there is no
  // renewal to promise. Settlement is the same one-period grant as the card row.
  const { profile: me } = useUser();
  const gate = useAppGate();
  const codaOffered = !IS_STORE_BUILD && codaOfferedTo(gate, me);
  // Codapay is listed IN the payment panel below (CodaPay.jsx): local methods
  // with logos and full prices, and Coda's form in the same panel. The plan
  // activates only when the SERVER settles the order.
  const onCodaSettled = () => {
    setMethodOpen(false);
    setPickedTier(null);
    showToast('Subscription activated!', 'success');
    onClose();
  };

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
   * ⚠ On the PLAY build the card option is not offered at all (founder,
   * 2026-09-11). Our own checkout inside a Play app is allowed only for US /
   * UK / EEA users of a developer ENROLLED in Google's alternative-billing
   * programs, and Vergr enrolls once the EIN arrives. An earlier comment here
   * said "Google may not compel Play Billing as the only option"; that holds
   * only inside those programs. Everywhere else the buyer's choice stands.
   *
   * Play Billing is chosen by `startPlayCheckout`.
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
      showToast(IS_STORE_BUILD
        ? `${STORE_NAME} billing is unavailable on this device.`
        : 'Google Play billing is unavailable on this device. Try paying by card.', 'error');
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
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
        paddingBottom: 'calc(var(--vg-safe-b) + 16px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
          padding: 24, width: 720, maxWidth: '95vw', maxHeight: '100%', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Change plan</div>
            <div style={{ fontSize: 12, color: C.textVeryDim, marginTop: 2 }}>Choose the plan that's right for you.</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 24, lineHeight: 1 }}>×</button>
        </div>

        {paused && (
          <div role="status" style={{
            marginTop: 14, padding: '12px 14px', borderRadius: 12, background: '#2a2008',
            display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 18, color: '#f5c842' }}>pause_circle</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f5c842' }}>New subscriptions are paused</div>
              <div style={{ fontSize: 12, color: C.textDim, marginTop: 2, lineHeight: 1.5 }}>
                You can't start a new plan right now. A plan you already have keeps working, and you can still cancel.
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: IS_NATIVE_BUILD ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 16 }}>
          {tiers.map(id => {
            const tier = TIERS[id];
            const isCurrent = id === currentId;
            const buyBlocked = paused && id !== 'free' && !isCurrent;
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
                    {/* Plans are priced in USD (tierSystem.js). They were passed in as euros
                        and printed with a euro sign. */}
                    {/* ⚠ Play app: Google's price or nothing, never our USD (Google
                        charges its own price, so "$4.99" would not match its sheet). */}
                    {tier.price === 0 ? '$0'
                      : (usePlaySubs && playPrices[playSubIdFor(tier.id)]?.price)
                        ? playPrices[playSubIdFor(tier.id)].price
                        : usePlaySubs ? '' : `$${tier.price}`}
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
                        : 'Your local price, tax included, is shown before you pay'}
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
                    disabled={isCurrent || buyBlocked}
                    onClick={() => {
                      if (isCurrent || buyBlocked) return;
                      if (id === 'free') {
                        // ⚠ A Google Play plan can only be cancelled in Google Play.
                        // cancelSubscription only flips Vergr's own renewal flag,
                        // so Google kept charging and the daily sync put it back.
                        if (currentMethod === 'google_play') { manageStoreSubscription(currentId); return; }
                        if (currentMethod === 'huawei_iap') {
                          showToast('Your plan is billed by AppGallery. Cancel it in AppGallery.', 'info');
                          return;
                        }
                        if (window.confirm('Stop renewing your plan? You keep it until the end of the period you paid for.')) {
                          import('firebase/functions')
                            .then(({ getFunctions, httpsCallable }) =>
                              httpsCallable(getFunctions(undefined, 'europe-west1'), 'cancelSubscription')())
                            .then(() => { showToast('Renewal stopped. Your plan stays on until the period ends.', 'success'); onClose(); })
                            .catch((e) => showToast(e?.message || 'Could not cancel. Try again in a moment.', 'error'));
                        }
                        return;
                      }
                      setPickedTier(id);
                      setMethodOpen(true);
                    }}
                    style={{
                      marginTop: 14, width: '100%', borderRadius: 8, padding: '9px',
                      fontSize: 13, fontWeight: 600,
                      cursor: isCurrent || buyBlocked ? 'default' : 'pointer',
                      background: buyBlocked ? '#26263a' : isCurrent
                        ? `linear-gradient(135deg,${C.purple},${C.purpleDeep})`
                        : id === 'free' ? 'transparent' : `linear-gradient(135deg,${C.purple},${C.purpleDeep})`,
                      color: buyBlocked ? C.textDim : '#fff',
                      border: id === 'free' && !isCurrent ? `1px solid ${C.borderHard}` : 'none',
                      opacity: isCurrent ? 0.85 : 1,
                    }}
                  >
                    {isCurrent ? 'Current plan' : buyBlocked ? 'Paused'
                      : (id === 'free' && currentMethod === 'google_play') ? 'Cancel in Google Play' : `Choose ${tier.name}`}
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
          All plans include access to VERGR core features. A plan never changes your creator revenue share. {IS_STORE_BUILD ? `Billed by ${STORE_NAME} in your local currency.` : 'Prices exclude VAT/tax; checkout is processed in USD/USDT.'}
        </div>
      </div>

      {methodOpen && pickedTier && (
        <PaymentMethodPicker
          tier={pickedTier}
          onCard={() => startCardCheckout(pickedTier)}
          onPlay={() => startPlayCheckout(pickedTier)}
          playOffered={usePlaySubs}
          codaOffered={codaOffered}
          onCodaSettled={onCodaSettled}
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
// PayRam's "Pay by card" is HIDDEN (founder, 2026-09-25): card, wallets and local
// methods are Codapay now. PayRam's server stays; flip this to show it again.
const SHOW_PAYRAM_CARD = false;

function PaymentMethodPicker({ tier, onCard, onCoins, onPlay, playOffered, codaOffered, onCodaSettled, onClose }) {
  const COIN_PRICE = { lite: 500, pro: 1000 }[tier];
  const EUR_PRICE = { lite: 4.99, pro: 9.99 }[tier];
  const { profile } = useUser();
  const payload = useMemo(() => ({ subscriptionTier: tier }), [tier]);
  const [paying, setPaying] = useState(false);

  const SOLID = '#1C1C2B';
  const rowBtn = {
    width: '100%', padding: 14, marginBottom: 8, borderRadius: 12, border: 'none',
    background: SOLID, color: C.text, textAlign: 'left', cursor: 'pointer',
  };
  return (
    <div onClick={paying ? undefined : onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(5,5,10,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, borderRadius: 16,
        padding: 20, width: 420, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>How do you want to pay?</div>
        <div style={{ fontSize: 12, color: C.textVeryDim, marginBottom: 14 }}>
          {/* Was "paid once, it does not renew on its own" for every rail: true
              for card and local payments only. Google Play renews monthly, and so
              does a coin plan until cancelled. */}
          {IS_STORE_BUILD
            ? `${tier === 'lite' ? 'Lite' : 'Pro'}, month by month.`
            : `One month of ${tier === 'lite' ? 'Lite' : 'Pro'}. Card and local payments are paid once and do not renew.`}
        </div>

        {/* Not on ANY store build. ⚠ IS_STORE_BUILD, not IS_PLAY_BUILD: the
            Huawei build sells through HUAWEI IAP, so offering our own checkout
            there is a Guideline 6.2 rejection. */}
        {!IS_STORE_BUILD && codaOffered && (
          <div style={{ marginBottom: paying ? 0 : 14 }}>
            <CodaCheckoutBlock
              payload={payload}
              profile={profile}
              onSettled={onCodaSettled}
              onPayingChange={setPaying}
            />
          </div>
        )}
        {!paying && (
          <>
            {SHOW_PAYRAM_CARD && !IS_STORE_BUILD && (
              <button onClick={onCard} style={rowBtn}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Pay by card</div>
                <div style={{ fontSize: 11, color: C.textDim }}>
                  <LocalPrice eur={EUR_PRICE} fallback={`€${EUR_PRICE}`} />/month
                </div>
              </button>
            )}
            {/* Google Play. Present ONLY on a Play build with a working bridge. */}
            {playOffered && (
              <button onClick={onPlay} style={rowBtn}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Google Play</div>
                <div style={{ fontSize: 11, color: C.textDim }}>
                  Billed by Google. Includes Google Play&rsquo;s service fee. Renews monthly until you cancel in Google Play.
                </div>
              </button>
            )}
            <button onClick={onCoins} style={rowBtn}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Pay with coins</div>
              <div style={{ fontSize: 11, color: C.textDim }}>{COIN_PRICE} coins from your wallet. Renews monthly from your coins until you cancel.</div>
            </button>
            <button onClick={onClose} style={{
              width: '100%', padding: 10, marginTop: 4, borderRadius: 10,
              background: 'transparent', color: C.textDim, border: 'none', cursor: 'pointer', fontSize: 12,
            }}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Plan status, from the fields every rail writes ─────────────────────────
const toMs = (t) => {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  const p = Date.parse(t);
  return Number.isNaN(p) ? 0 : p;
};
const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function planStatus(profile, tierId) {
  const end = toMs(profile?.subscriptionPeriodEnd);
  const autoRenew = profile?.subscriptionAutoRenew === true;
  const method = profile?.subscriptionPreferredMethod || profile?.subscriptionMethod || null;
  const date = end ? fmtDate(end) : null;
  let line;
  if (tierId === 'free') line = 'No billing. Upgrade to unlock perks.';
  else if (method === 'comp') line = date ? `Complimentary until ${date}.` : 'Complimentary.';
  else if (!date) line = 'Your plan is active.';
  else if (autoRenew) line = `Renews on ${date}${method === 'google_play' ? ' through Google Play' : method === 'coins' ? ' from your coins' : ''}.`;
  else line = `Ends on ${date}. It will not renew.`;
  return { end, autoRenew, method, date, line };
}

function methodLabel(tierId, method) {
  if (tierId === 'free') return { title: 'No payment method needed', detail: 'Free never bills you.' };
  switch (method) {
    case 'google_play': return { title: 'Google Play', detail: 'Google holds your card and bills you in your local currency.' };
    case 'huawei_iap': return { title: 'AppGallery', detail: 'Huawei bills this plan.' };
    case 'coins': return { title: 'Coins', detail: 'Taken from your wallet each month.' };
    case 'comp': return { title: 'Complimentary', detail: 'Nothing to pay.' };
    default: return { title: 'Paid once', detail: 'This period was paid in one payment and does not renew.' };
  }
}

const PLAY_ORDERS_URL = 'https://play.google.com/store/account/orderhistory';
const openStoreUrl = (url) => { if (!openExternalUrl(url)) window.open(url, '_blank', 'noopener'); };
function manageStoreSubscription(tierId) {
  openStoreUrl(`https://play.google.com/store/account/subscriptions?sku=${playSubIdFor(tierId)}&package=${PLAY_PACKAGE}`);
}

// Coin and card payments are ledger rows the user may read. Google Play keeps
// its own receipts, so a Play plan reads nothing here. At most 12 reads, only
// for a coin or card plan, only while this screen is open.
const HISTORY_TYPES = new Set(['subscription_coins', 'subscription_coins_renewal', 'subscription_payment']);
function useSubscriptionHistory(uid, method) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!uid || (method !== 'coins' && method !== 'card')) { setRows([]); return undefined; }
    let alive = true;
    getTransactions(uid, 12)
      .then((list) => {
        if (!alive) return;
        setRows(list.filter((t) => HISTORY_TYPES.has(t.type)).slice(0, 5).map((t) => ({
          date: toMs(t.createdAt) ? fmtDate(toMs(t.createdAt)) : '',
          desc: String(t.description || 'Subscription'),
          amount: t.currency === 'coins' ? `${Math.abs(Number(t.amount) || 0).toLocaleString()} coins` : '',
          status: 'Paid',
        })));
      })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [uid, method]);
  return rows;
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
