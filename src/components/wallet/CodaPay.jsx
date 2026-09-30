// Codapay checkout, EMBEDDED IN THE BASKET (founder, 2026-09-25).
//
// The buyer's country is already known (users.geoCountry, saved once from
// Cloudflare by functions/geo.js), so the basket lists the payment methods Coda
// offers there straight away: official logo, name, and the FULL price for that
// method. Selecting one shows its Taxes & fees breakdown; Pay opens Coda's own
// form in the same panel. No popup, no second step, no total that jumps at
// payment. A total that changes between the basket and the payment screen is the
// first reason buyers abandon.
//
//   useCodaOptions  loads the methods + per-method breakdown for this basket
//   CodaMethodList  the rows (logo, name, total)
//   CodaFees        "Includes X taxes & fees", tap for the lines
//   CodaPayPanel    creates the order and mounts Coda's form in place
//
// Every number comes from the server: the list, the breakdown and the charged
// price are computed by functions/codaPricing.js from the same inputs, so Vergr
// always receives the full web price whatever the method (founder rule: never
// lose money or have profit eaten).
//
// ⚠ NO GLASS. Every surface here is a solid colour: no see-through fills, no
// hairline outlines, no blur. The selected method is a lighter solid row with a
// filled radio, never an outline.
import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { WALLET_TOKENS as T } from './primitives';
import { auth } from '../../firebase/config';
import { createCheckout, getCheckoutStatus, getCheckoutOptions } from '../../firebase/firestore';
import { ensureAccountCountry } from '../../utils/geoBlocks';
import { blockGuestPurchase } from '../../utils/guestPrompt';

// ⚠ 8.8.0, NOT the 8.9.0 in Coda's own docs: that object does not exist on
// their CDN (HTTP 403 from S3, checked 2026-09-25). Both SDKs pick sandbox or
// live from the clientSecret itself.
const CARD_SDK = 'https://js.codapayments.com/8.8.0/coda-card.min.js';
const COMPONENT_SDK = 'https://hosted-component.codapayments.com/1.6.0/hosted-component.min.js';
const POLL_MS = 3000;
const TIMEOUT_MS = 12 * 60 * 1000;

const ROW = '#1C1C2B';        // a method row
const ROW_ON = '#2A2440';     // the selected method row
const PLATE = '#FFFFFF';      // logos are drawn for white grounds (Coda brand pack)

const scripts = {};
function loadScript(src) {
  if (!scripts[src]) {
    scripts[src] = new Promise((ok, no) => {
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = () => ok();
      el.onerror = () => { delete scripts[src]; no(new Error('Could not load the payment form.')); };
      document.head.appendChild(el);
    });
  }
  return scripts[src];
}

export function formatLocal(amount, currency, whole = Number.isInteger(amount)) {
  try {
    // The local symbol ("R 22.99", "£1.29", "₱66.99"), not the ISO code ("ZAR
    // 22.99"), which reads like a foreign price. Whole-unit currencies (rupiah,
    // yen, won) are priced in whole numbers by the server, so no decimals.
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency, currencyDisplay: 'narrowSymbol',
      ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

/**
 * The Coda methods for THIS basket (payload = { cart } | { subscriptionTier }).
 * Waits for the account's country first: a returning account that has never been
 * stamped gets it here, before any price is shown.
 */
export function useCodaOptions(payload, enabled, profile) {
  const sig = JSON.stringify(payload || {});
  const [state, setState] = useState({ loading: !!enabled, error: '', options: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) { setState({ loading: false, error: '', options: null }); return undefined; }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    // Wait for the basket or amount to settle: typing a custom amount must not
    // send one pricing request per keystroke.
    const t = setTimeout(() => (async () => {
      const user = auth.currentUser;
      // Resolves at once when the profile already has its country (no request).
      if (user && !user.isAnonymous) await ensureAccountCountry(user, profile).catch(() => null);
      return getCheckoutOptions(JSON.parse(sig));
    })()
      .then((r) => {
        if (!alive) return;
        if (!r?.methods?.length) setState({ loading: false, error: 'No payment methods are available in your country yet.', options: null });
        else setState({ loading: false, error: '', options: r });
      })
      .catch((e) => {
        if (alive) setState({ loading: false, error: e?.message || 'Could not load payment methods. Try again shortly.', options: null });
      }), 300);
    return () => { alive = false; clearTimeout(t); };
  }, [sig, enabled, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

// "+ free boost" on every option (founder, 2026-09-27). The server says whether
// a free boost comes with Coda orders (createCheckout options.freeBoost) and
// grants it on settlement, so this label can never promise what is not paid.
const FREE_BOOST_LABEL = { post: 'Post Boost', profile: 'Profile Boost', stream_boost: 'Stream Boost', squad: 'Squad Boost', lfg: 'Teammate Search Boost' };

export function CodaMethodList({ methods, value, onChange, refused = {}, freeBoost = null }) {
  const perk = freeBoost ? `+ free ${FREE_BOOST_LABEL[freeBoost] || 'boost'}` : null;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {methods.map((m) => {
        const on = value === m.payType;
        const off = !!refused[m.payType];
        return (
          <button
            key={m.payType}
            type="button"
            disabled={off}
            onClick={() => onChange(m.payType)}
            aria-pressed={on}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
              padding: '10px 12px', borderRadius: 12, border: 0, font: 'inherit',
              background: on ? ROW_ON : ROW, color: off ? T.textMuted : T.text,
              cursor: off ? 'default' : 'pointer',
            }}
          >
            <span style={{
              width: 18, height: 18, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
              background: on ? T.violet : '#2E2E40',
            }}>
              {on && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FFFFFF' }} />}
            </span>
            <span style={{
              width: 64, height: 36, borderRadius: 8, background: PLATE, flexShrink: 0,
              display: 'grid', placeItems: 'center', padding: '5px 7px', opacity: off ? 0.4 : 1,
            }}>
              {m.logo
                ? <img src={m.logo} alt="" draggable={false} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
                : <Icon name="credit_card" size={20} style={{ color: '#141018' }} />}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>{m.name}</span>
              {off && <span style={{ display: 'block', fontSize: 11.5, color: T.textMuted, marginTop: 2 }}>Not available right now</span>}
              {!off && perk && <span style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#F5C842', marginTop: 2 }}>{perk}</span>}
            </span>
            <span className="font-dmmono tabular-nums" style={{ fontWeight: 800, fontSize: 14, whiteSpace: 'nowrap' }}>
              {formatLocal(m.price, m.currency)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** "Includes X taxes & fees" for the selected method, itemised on tap. */
export function CodaFees({ method }) {
  const [open, setOpen] = useState(false);
  if (!method?.lines) return null;
  const { price, tax, fee, total } = method.lines;
  const extra = Math.max(0, total - price);
  // Decimals follow the currency (a whole-unit total), not each line, so a
  // R 5.00 fee never prints as "R 5".
  const f = (v) => formatLocal(v, method.currency, Number.isInteger(total));
  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
          background: 'none', border: 0, padding: '4px 0', cursor: 'pointer', font: 'inherit',
          fontSize: 13, color: T.textSecondary,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          Taxes &amp; fees
          <Icon name={open ? 'expand_less' : 'expand_more'} size={16} />
        </span>
        <span className="font-dmmono tabular-nums">{f(extra)}</span>
      </button>
      {open && (
        <div style={{ padding: '2px 0 4px' }}>
          {[
            ['Price', price],
            ...(tax > 0 ? [['Tax', tax]] : []),
            ['Payment method fee', fee],
          ].map(([label, v]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: T.textMuted, padding: '2px 0 2px 10px' }}>
              <span>{label}</span>
              <span className="font-dmmono tabular-nums">{f(v)}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 }}>
        <span style={{ fontWeight: 800, fontSize: 15 }}>Total</span>
        <span className="font-dmmono tabular-nums" style={{ fontWeight: 800, fontSize: 20 }}>{f(total)}</span>
      </div>
    </div>
  );
}

/**
 * Coda's form, mounted IN PLACE. Creates the order for the chosen method, loads
 * the right SDK, and reports only what the SERVER settled: success inside Coda's
 * iframe is not proof of payment.
 */
export function CodaPayPanel({ payload, method, onBack, onSettled, onRefused, preparePlay = null, presetPlay = null }) {
  const [phase, setPhase] = useState('starting'); // starting | form | confirming | done
  const [order, setOrder] = useState(null);
  const [ready, setReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const chargeRef = useRef(null);
  const pollRef = useRef(null);
  const aliveRef = useRef(true);
  const mountId = useRef(`coda-form-${Math.random().toString(36).slice(2)}`).current;

  useEffect(() => {
    aliveRef.current = true;
    const stop = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
    const refuse = (msg) => { stop(); if (aliveRef.current) onRefused?.(method.payType, msg); };

    (async () => {
      if (blockGuestPurchase()) { onBack?.(); return; }
      // Inside the Google Play app the order must carry Google's transaction
      // token (the server reports the sale to Google with it). Either Google
      // already handed one over on its own choice screen, or it is fetched now,
      // which also shows Google's required information dialog.
      let play = presetPlay;
      if (!play && preparePlay) {
        try {
          play = await preparePlay();
        } catch (e) {
          if (!aliveRef.current) return;
          if (e?.code === 'cancelled') { onBack?.(); return; }
          setError(e?.message || 'Google Play could not start this checkout.');
          setPhase('error');
          return;
        }
        if (!aliveRef.current) return;
      }
      let res;
      try {
        res = await createCheckout({ ...payload, payType: method.payType, ...(play ? { play } : {}) });
      } catch (e) {
        refuse(e?.message || 'This payment method is not available right now. Choose another one.');
        return;
      }
      if (!aliveRef.current) return;
      if (!res?.ok || !res.clientSecret) { refuse('This payment method is not available right now. Choose another one.'); return; }
      setOrder(res);
      setPhase('form');

      // Poll from the start: a wallet that hands off to its own app may never
      // return to this tab, and the order settles on the server regardless.
      const started = Date.now();
      pollRef.current = setInterval(async () => {
        if (Date.now() - started > TIMEOUT_MS) {
          stop();
          if (aliveRef.current) setError('Still waiting for the payment to confirm. If you paid, it will arrive shortly.');
          return;
        }
        let s;
        try { s = await getCheckoutStatus(res.referenceId); } catch { return; }
        if (!aliveRef.current) return;
        if (s?.status === 'settled') { stop(); setPhase('done'); onSettled?.(s); }
        else if (s?.status === 'expired') refuse('The payment did not go through. Choose a method to try again.');
      }, POLL_MS);

      try {
        await loadScript(res.sdk === 'card' ? CARD_SDK : COMPONENT_SDK);
        if (!aliveRef.current) return;
        if (res.sdk === 'card') {
          const charge = window.CodaCard().components({
            clientSecret: res.clientSecret,
            appearance: {
              customStyle: {
                backgroundColor: T.surface1,
                fontFamily: 'DM Sans, system-ui, sans-serif',
                fontSize: '15px',
                borderRadius: '10px',
                titleColor: T.text,
                fieldBackgroundColor: ROW,
                fieldLabelColor: T.textSecondary,
                fieldTextColor: T.text,
                fieldBorderColor: ROW,
                fieldFocusBorderColor: T.violetLight,
                fieldPlaceholderColor: T.textMuted,
                checkBoxActiveBackgroundColor: T.violet,
              },
            },
          }).create('charge', { withCardHolderName: true });
          charge.on('readyStateChange', (isReady) => setReady(!!isReady));
          charge.on('processingCard', (ok, msg) => {
            setPaying(false);
            if (ok) setPhase('confirming');
            else setError(msg || 'Your card was declined. Check the details or choose another method.');
          });
          charge.mount(`#${mountId}`);
          chargeRef.current = charge;
        } else {
          const charge = window.CodaComponent().components({ clientSecret: res.clientSecret }).create('charge');
          charge.on('success', () => setPhase('confirming'));
          charge.on('failed', () => refuse('The payment did not go through. Choose a method to try again.'));
          charge.on('userCancel', () => { stop(); onBack?.(); });
          charge.mount(`#${mountId}`);
          chargeRef.current = charge;
        }
      } catch (e) {
        refuse(e?.message || 'Could not load the payment form.');
      }
    })();

    return () => {
      aliveRef.current = false;
      stop();
      try { chargeRef.current?.unmount?.(); } catch { /* sdk gone */ }
      chargeRef.current = null;
    };
    // One order per mounted panel: a new method remounts it (key=payType).
  }, []);

  const pay = () => {
    if (!chargeRef.current || !ready || paying) return;
    setError('');
    setPaying(true);
    try { chargeRef.current.submit(); } catch { setPaying(false); }
  };

  const confirming = phase === 'confirming' || phase === 'done';
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <button
          type="button"
          onClick={onBack}
          disabled={paying || confirming}
          aria-label="Change payment method"
          style={{
            width: 34, height: 34, borderRadius: 10, border: 0, display: 'grid', placeItems: 'center',
            background: ROW, color: T.text, cursor: paying || confirming ? 'default' : 'pointer',
            opacity: paying || confirming ? 0.4 : 1, flexShrink: 0,
          }}
        >
          <Icon name="arrow_back" size={18} />
        </button>
        <span style={{
          width: 56, height: 32, borderRadius: 8, background: PLATE, display: 'grid', placeItems: 'center', padding: '4px 6px', flexShrink: 0,
        }}>
          {method.logo && <img src={method.logo} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 14 }}>{method.name}</span>
        <span className="font-dmmono tabular-nums" style={{ fontWeight: 800, fontSize: 16 }}>
          {formatLocal(method.price, method.currency)}
        </span>
      </div>

      {error && (
        <div role="alert" style={{ background: '#3A1520', color: '#FFC2CC', borderRadius: 10, padding: '9px 12px', fontSize: 12.5, marginBottom: 10 }}>
          {error}
        </div>
      )}

      {phase === 'starting' && <Waiting text="Opening secure payment…" />}
      {confirming && <Waiting text={phase === 'done' ? 'Payment complete' : 'Confirming your payment…'} done={phase === 'done'} />}

      {/* Coda replaces this div's contents with its own iframe. */}
      <div
        id={mountId}
        style={{ display: phase === 'form' ? 'block' : 'none', borderRadius: 12, overflow: 'hidden', background: T.surface1, minHeight: 134 }}
      />

      {phase === 'form' && order?.sdk === 'card' && (
        <button
          type="button"
          onClick={pay}
          disabled={!ready || paying}
          style={{
            width: '100%', marginTop: 12, padding: '13px 16px', borderRadius: 12, border: 0, font: 'inherit',
            fontWeight: 800, fontSize: 15,
            background: ready && !paying ? T.gold : '#2E2E40',
            color: ready && !paying ? '#141018' : T.textMuted,
            cursor: ready && !paying ? 'pointer' : 'default',
          }}
        >
          {paying ? 'Processing…' : `Pay ${formatLocal(method.price, method.currency)}`}
        </button>
      )}

      {phase === 'form' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 11.5, color: T.textMuted }}>
          <Icon name="lock" size={14} />
          <span>Secure payment powered by Coda. Vergr never sees your card or account details.</span>
        </div>
      )}
    </div>
  );
}

/**
 * The whole Coda checkout for one purchase, used by the basket, the Lite/Pro
 * panel and Custom amount so the three cannot drift:
 *   methods (logo, name, full price) -> Taxes & fees + Total -> Pay -> Coda's
 *   form in place -> the server settles.
 * summary: rows shown above the total (e.g. coins received). legal: terms below Pay.
 */
export function CodaCheckoutBlock({
  payload, enabled = true, profile, summary = null, legal = null, onSettled, onPayingChange, emptyText,
  // Google Play app only: fetch / carry Google's transaction token, and the
  // Google Play option drawn under Pay.
  preparePlay = null, presetPlay = null, alternative = null,
}) {
  const coda = useCodaOptions(payload, enabled, profile);
  const methods = coda.options?.methods || [];
  const [payType, setPayType] = useState(null);
  const [paying, setPayingState] = useState(false);
  const [refused, setRefused] = useState({});
  const [notice, setNotice] = useState('');
  const setPaying = (v) => { setPayingState(v); onPayingChange?.(v); };
  const method = methods.find((m) => m.payType === payType) || null;
  useEffect(() => {
    if (!methods.length) return;
    if (!method || refused[method.payType]) {
      const first = methods.find((m) => !refused[m.payType]);
      setPayType(first ? first.payType : null);
    }
  }, [coda.options, refused]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return emptyText ? <Plain>{emptyText}</Plain> : null;

  if (paying && method) {
    return (
      <CodaPayPanel
        key={method.payType}
        payload={payload}
        method={method}
        preparePlay={preparePlay}
        presetPlay={presetPlay}
        onBack={() => setPaying(false)}
        onSettled={(s) => { setPaying(false); onSettled?.(s); }}
        onRefused={(pt, msg) => { setNotice(msg || ''); setRefused((r) => ({ ...r, [pt]: true })); setPaying(false); }}
      />
    );
  }

  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textMuted, fontWeight: 700, marginBottom: 8 }}>
        Pay with
      </div>
      {notice && (
        <div role="alert" style={{ background: '#3A1520', color: '#FFC2CC', borderRadius: 10, padding: '9px 12px', fontSize: 12.5, marginBottom: 8 }}>
          {notice}
        </div>
      )}
      {coda.loading && !methods.length && (
        <div style={{ display: 'grid', gap: 6 }}>
          {[0, 1, 2].map((i) => <div key={i} style={{ height: 56, borderRadius: 12, background: ROW }} />)}
        </div>
      )}
      {!coda.loading && coda.error && (
        <Plain>
          {coda.error}{' '}
          <button type="button" onClick={coda.reload} style={{ background: 'none', border: 0, padding: 0, color: T.violetLight, font: 'inherit', cursor: 'pointer', fontWeight: 700 }}>
            Try again
          </button>
        </Plain>
      )}
      {methods.length > 0 && (
        <div style={{ maxHeight: '34vh', overflowY: 'auto', opacity: coda.loading ? 0.6 : 1 }}>
          <CodaMethodList methods={methods} freeBoost={coda.options?.freeBoost || null} value={method?.payType} onChange={(pt) => { setNotice(''); setPayType(pt); }} refused={refused} />
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {summary}
        {method ? <CodaFees method={method} /> : null}
      </div>

      <button
        type="button"
        onClick={() => setPaying(true)}
        disabled={!method || coda.loading}
        style={{
          position: 'sticky', bottom: 0, zIndex: 2,
          width: '100%', marginTop: 14, padding: '13px 16px', borderRadius: 12, border: 0, font: 'inherit',
          fontWeight: 800, fontSize: 15,
          background: method && !coda.loading ? T.gold : '#2E2E40',
          color: method && !coda.loading ? '#141018' : T.textMuted,
          cursor: method && !coda.loading ? 'pointer' : 'default',
        }}
      >
        {method ? `Pay ${formatLocal(method.price, method.currency)}` : 'Choose a payment method'}
      </button>
      {alternative}
      {legal}
    </div>
  );
}

function Plain({ children }) {
  return <div style={{ background: ROW, borderRadius: 12, padding: '12px 14px', fontSize: 13, color: T.textSecondary }}>{children}</div>;
}

function Waiting({ text, done }) {
  return (
    <div style={{ padding: '26px 8px', textAlign: 'center' }}>
      {done
        ? <Icon name="check_circle" size={34} style={{ color: T.success }} />
        : <div style={{ width: 26, height: 26, margin: '0 auto', borderRadius: '50%', border: '3px solid #2E2E40', borderTopColor: T.violetLight, animation: 'vgCodaSpin 0.9s linear infinite' }} />}
      <div style={{ fontWeight: 700, fontSize: 14, marginTop: 10 }}>{text}</div>
      <style>{'@keyframes vgCodaSpin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}
