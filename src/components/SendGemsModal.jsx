// SendGemsModal — the DM "Wallet": person-to-person GEM transfer.
//
// Distinct from SendCoinsModal (which is a TIP, 10%, and still powers the
// profile tip button). This sends gems — the withdrawable currency — at a flat
// 3% so the recipient gets something immediately useful instead of a balance
// that still has to run the conversion ladder.
//
// Money-first display: gems are an internal unit, so leading with USDC (what a
// withdrawal actually settles in) is what makes the amount legible. Tapping the
// USDC figure flips it to the user's own currency, since USDC means nothing to
// someone who thinks in rand or rupees.

import { useState, useEffect, useMemo } from 'react';
import Modal from './Modal';
import { useAuth } from '../context/AuthContext';
import { useUser } from '../context/UserContext';
import { useUI } from '../context/UIContext';
import { GEM_TO_EUR } from '../utils/vpSystem';
import { formatUsdc, eurToUsdc, usdcToEur, formatMoneyFromEur } from '../utils/currency';
import { useBuyCheckout } from '../screens/wallet/v2/buyCheckout';
import { IS_STORE_BUILD } from '../utils/platform';

// Mirrors TRANSFER_FEE_PCT in functions/gemTransfer.js — the server is
// authoritative; this is only so the user sees the split before sending.
const FEE_PCT = 0.03;
const MIN_GEMS = 10;
// Recipients can hold any amount but can't cash out below this, so it's shown
// rather than discovered later at the withdraw screen.
const MIN_PAYOUT_GEMS = 1000;

const gemsToEur = (g) => (Number(g) || 0) * GEM_TO_EUR;
const eurToGems = (e) => Math.floor((Number(e) || 0) / GEM_TO_EUR);

export default function SendGemsModal({ isOpen, onClose, recipient }) {
  const { currentUser } = useAuth();
  const { wallet, refreshWallet } = useUser();
  const { showToast } = useUI();

  // 'gems' | 'usdc' — which unit the user is typing in. The other is derived.
  const [mode, setMode] = useState('usdc');
  const [raw, setRaw] = useState('');
  const [showLocal, setShowLocal] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!isOpen) { setRaw(''); setSending(false); setShowLocal(false); }
  }, [isOpen]);

  const gemBalance = wallet?.gems || 0;

  // Whatever they typed, resolved to gems (the unit the server transacts in).
  const gems = useMemo(() => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (mode === 'gems') return Math.floor(n);
    const eur = usdcToEur(n);
    return eur == null ? 0 : eurToGems(eur);
  }, [raw, mode]);

  const eur = gemsToEur(gems);
  const usdc = formatUsdc(eur);
  const netGems = Math.floor(gems * (1 - FEE_PCT));
  const netEur = gemsToEur(netGems);

  const overBalance = gems > gemBalance;
  const belowMin = gems > 0 && gems < MIN_GEMS;
  // Short of gems? Don't dead-end — offer to pay for it. Gems can only be
  // bought AS a transfer (never as a standing balance), so this is the only
  // purchase path that exists.
  const needsPurchase = overBalance && gems >= MIN_GEMS;

  // BUY-AND-SEND IS OFF ON THE PLAY BUILD.
  // Sending gems you already hold is a genuine peer-to-peer transfer: no
  // money enters, balances just move. Buy-and-send is different — the sender
  // pays a card and WE mint gems for the recipient, so the counterparty is
  // Vergr, not the other user. That is buying in-app currency and gifting it,
  // which Play requires to go through Play Billing.
  //
  // Routing it through Play Billing does not fix it either: gems are
  // withdrawable, so that would recreate the exact "Play money becomes cash"
  // problem the earned/purchased split exists to prevent (see coinLedger.js).
  // Both doors are shut, so the path is simply not offered on Play.
  //
  // NOTE the contrast with tipping, which is fine: there the money entered
  // through Play Billing when the coins were bought, and the tip is just
  // in-app currency moving afterwards.
  const canBuyAndSend = !IS_STORE_BUILD;
  const canSend = gems >= MIN_GEMS && !overBalance && !sending;

  // Server-issued, time-locked price. The USD figure is only guaranteed until
  // it expires, so the countdown is shown and the button refuses a stale quote
  // rather than silently re-pricing what the user already agreed to.
  const [quote, setQuote] = useState(null);
  const [secsLeft, setSecsLeft] = useState(0);

  useEffect(() => {
    if (!quote) return;
    const tick = () => setSecsLeft(Math.max(0, Math.ceil((quote.expiresAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [quote]);

  // Any change to the amount invalidates a held quote — it was priced for a
  // specific number of gems.
  useEffect(() => { setQuote(null); }, [gems]);

  const call = async (name, payload) => {
    const { httpsCallable } = await import('firebase/functions');
    const { functions: fns } = await import('../firebase/config');
    return (await httpsCallable(fns, name)(payload)).data;
  };

  const send = async () => {
    if (!canSend || !recipient?.id) return;
    setSending(true);
    try {
      await call('sendGems', { recipientId: recipient.id, amount: gems });
      showToast(`Sent ${netGems.toLocaleString()} gems to @${recipient.username || 'user'}`, 'success');
      await refreshWallet();
      onClose();
    } catch (e) {
      showToast(e?.message || 'Could not send gems', 'error');
      setSending(false);
    }
  };

  const getQuote = async () => {
    if (!recipient?.id) return;
    setSending(true);
    try {
      const q = await call('quoteGemSend', { recipientId: recipient.id, gems });
      setQuote(q);
    } catch (e) {
      showToast(e?.message || 'Could not price that transfer', 'error');
    }
    setSending(false);
  };

  // Checkout runs through the ONE shared PayRam hook: a popup on web/PWA (the
  // user never leaves Vergr) and the system browser inside a Tauri shell. The
  // old `window.location.href = paymentUrl` navigated the whole SPA away, which
  // both felt slow (cold-loading PayRam) and destroyed the status polling, so a
  // completed payment had nothing left listening for it.
  const { checkout, startCheckout } = useBuyCheckout(showToast, {
    onSettled: async () => {
      showToast(`Sent gems to @${recipient?.username || 'user'}`, 'success');
      try { await refreshWallet(); } catch { /* ignore */ }
      onClose();
    },
  });

  const payAndSend = () => {
    if (!quote || secsLeft <= 0) return;
    startCheckout({ gemQuoteId: quote.quoteId }, 'Gem transfer');
  };

  // NO empty-state detour. An empty balance used to bounce the user to the
  // BUY COINS screen, which is the wrong currency and the wrong journey — they
  // came here to send someone gems, not to shop. Buy-and-send already covers a
  // zero balance (`needsPurchase` is just "more than I hold"), so the normal
  // amount entry is shown and the whole thing is paid by card in one step.

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Wallet">
      {/* Recipient */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-2 border border-white/[0.06] mb-4">
        <img
          src={recipient?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${recipient?.username || recipient?.id}`}
          alt="" className="w-10 h-10 rounded-full object-cover"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{recipient?.displayName || recipient?.username || 'User'}</p>
          <p className="text-xs text-text-muted truncate">@{recipient?.username || 'user'}</p>
        </div>
      </div>

      {/* Amount — the hero. Type in either unit; the other follows. */}
      <div className="relative rounded-2xl overflow-hidden mb-3 border border-white/[0.06]"
        style={{ background: 'radial-gradient(120% 100% at 50% 0%, rgba(61,127,255,0.16), rgba(20,20,31,0) 70%), #14141F' }}>

        <div className="flex justify-center gap-1 pt-3">
          {['usdc', 'gems'].map((m) => (
            <button
              key={m}
              onClick={() => {
                // Carry the value across so switching units doesn't wipe it.
                if (m !== mode) {
                  if (m === 'gems') setRaw(gems ? String(gems) : '');
                  else { const u = eurToUsdc(gemsToEur(gems)); setRaw(u ? u.toFixed(2) : ''); }
                  setMode(m);
                }
              }}
              className={`px-3 h-7 rounded-full text-[11px] font-bold uppercase tracking-wide transition ${
                mode === m ? 'bg-white/[0.10] text-text-primary' : 'text-text-muted'
              }`}
            >
              {m === 'usdc' ? 'USDC' : 'Gems'}
            </button>
          ))}
        </div>

        <div className="px-5 pt-2 pb-4 flex flex-col items-center">
          <div className="flex items-baseline gap-1.5">
            {mode === 'usdc' && <span className="text-2xl font-bold text-text-muted">$</span>}
            <input
              type="number"
              inputMode="decimal"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="0"
              className="bg-transparent border-none outline-none text-center font-dmmono font-bold text-text-primary placeholder:text-white/20 tabular-nums"
              style={{ fontSize: 42, lineHeight: 1.1, width: `${Math.max(3, String(raw || '0').length + 1)}ch` }}
              autoFocus
            />
          </div>

          {/* The other unit, tappable to reveal the user's own currency —
              "54.00 USDC" is precise but meaningless to someone in Rand. */}
          <button
            onClick={() => setShowLocal((s) => !s)}
            className="mt-1 text-[13px] font-bold"
            style={{ color: '#3D7FFF' }}
          >
            {showLocal
              ? formatMoneyFromEur(eur)
              : (mode === 'usdc'
                  ? `${gems.toLocaleString()} gems`
                  : (usdc || formatMoneyFromEur(eur)))}
          </button>
        </div>

        <div className="flex gap-1.5 px-3 pb-3">
          {[10, 25, 50].map((v) => (
            <button
              key={v}
              onClick={() => { setMode('usdc'); setRaw(String(v)); }}
              className="flex-1 h-9 rounded-lg text-[12px] font-bold bg-white/[0.05] text-text-secondary border border-white/[0.06] active:scale-95 transition"
            >
              ${v}
            </button>
          ))}
          <button
            onClick={() => { setMode('gems'); setRaw(String(gemBalance)); }}
            className="px-3 h-9 rounded-lg text-[12px] font-bold bg-gem-blue/15 border border-gem-blue/25 active:scale-95 transition"
            style={{ color: '#3D7FFF' }}
          >
            Max
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between px-1 mb-4">
        <span className="text-[11px] text-text-muted">Your gems</span>
        <span className="text-[12px] font-bold text-text-secondary tabular-nums">
          {gemBalance.toLocaleString()}
          <span className="text-text-muted font-normal"> · {formatUsdc(gemsToEur(gemBalance)) || formatMoneyFromEur(gemsToEur(gemBalance))}</span>
        </span>
      </div>

      {/* Enough gems → send from balance. Short → buy exactly this transfer. */}
      {!needsPurchase && (
        <button
          onClick={send}
          disabled={!canSend}
          className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all ${canSend ? 'text-white' : 'bg-surface-3 text-text-muted'}`}
          style={canSend ? { background: 'linear-gradient(135deg, #3D7FFF, #7B1FFF)' } : undefined}
        >
          {sending
            ? 'Sending…'
            : `Send ${gems.toLocaleString()} gems · ${formatUsdc(eur) || formatMoneyFromEur(eur)}`}
        </button>
      )}

      {needsPurchase && !canBuyAndSend && (
        <div className="w-full py-3.5 px-4 rounded-xl bg-surface-2 border border-white/[0.06] text-center">
          <p className="text-sm font-bold text-white">Not enough gems</p>
          <p className="text-[11px] text-text-muted mt-1 leading-snug">
            You have {gemBalance.toLocaleString()}. Convert some coins to gems in your
            wallet, or send a smaller amount.
          </p>
        </div>
      )}

      {needsPurchase && canBuyAndSend && !quote && (
        <>
          <button
            onClick={getQuote}
            disabled={sending}
            className="w-full py-3.5 rounded-xl font-bold text-sm text-white disabled:opacity-70"
            style={{ background: 'linear-gradient(135deg, #3D7FFF, #7B1FFF)' }}
          >
            {sending ? 'Getting price…' : `Buy & send ${gems.toLocaleString()} gems`}
          </button>
          <p className="text-[10.5px] text-text-muted text-center mt-2 leading-snug">
            You have {gemBalance.toLocaleString()} gems. The rest is paid by card and
            goes straight to them — it never sits in your balance.
          </p>
        </>
      )}

      {needsPurchase && canBuyAndSend && quote && (
        <>
          <button
            onClick={payAndSend}
            disabled={sending || secsLeft <= 0 || !!checkout}
            className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all ${secsLeft > 0 ? 'text-white' : 'bg-surface-3 text-text-muted'}`}
            style={secsLeft > 0 ? { background: 'linear-gradient(135deg, #3D7FFF, #7B1FFF)' } : undefined}
          >
            {checkout ? 'Waiting for payment…'
              : sending ? 'Opening checkout…'
              : secsLeft > 0 ? `Pay $${quote.usdTotal.toFixed(2)}` : 'Price expired'}
          </button>
          {checkout ? (
            <p className="text-[10.5px] text-center mt-2 leading-snug text-text-muted">
              Finish the payment in the checkout window — this updates automatically.
            </p>
          ) : (
            <p className="text-[10.5px] text-center mt-2 leading-snug"
              style={{ color: secsLeft > 10 ? 'var(--text-muted)' : '#F0A500' }}>
              {secsLeft > 0
                ? <>Price held for <span className="font-bold tabular-nums">{secsLeft}s</span> — they receive {quote.netGems.toLocaleString()} gems.</>
                : <>The rate moved. <button onClick={getQuote} className="font-bold underline">Get a new price</button></>}
            </p>
          )}
        </>
      )}
      {belowMin && (
        <p className="text-[11px] text-brand-ember text-center mt-2">
          Minimum transfer is {MIN_GEMS} gems.
        </p>
      )}

      {gems >= MIN_GEMS && !overBalance && (
        <p className="text-[10.5px] text-text-muted text-center mt-2.5 leading-snug">
          They receive{' '}
          <span className="text-text-secondary font-bold">
            {netGems.toLocaleString()} gems ({formatUsdc(netEur) || formatMoneyFromEur(netEur)})
          </span>{' '}
          after the 3% transfer fee.
          {netGems < MIN_PAYOUT_GEMS && (
            <> They'll need {MIN_PAYOUT_GEMS.toLocaleString()} gems total before they can withdraw.</>
          )}
        </p>
      )}
    </Modal>
  );
}
