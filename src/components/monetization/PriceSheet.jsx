// src/components/monetization/PriceSheet.jsx
//
// ONE sheet for every "free or paid, and how much" decision in the app.
//
// It is used by locked posts, locked media in DMs / groups / squad chats, paid
// live streams, and starting a 1:1 session. That is deliberate: the founder's
// brief was that the same sheet appears wherever a price is being set, so the
// gesture is learned once. Do not fork a second price picker for a new surface,
// pass it different `title` / `subtitle` copy instead.
//
// ## Why the pills exist
//
// Typing a number is the slowest possible way to answer "how much", and on a
// phone it opens a keyboard over the sheet. The quick-pick pills cover the
// prices people actually choose; the field is there for everyone else and stays
// in sync with the pills in both directions.
//
// ## The bounds are not decoration
//
// 50 and 10,000 coins are enforced server-side in entitlements.js,
// lockedPosts.js, lockedMessages.js and streaming.js. They are mirrored here so
// the user finds out before uploading a file rather than after. If they ever
// change, change them in all five places (plan section 6.3).
import { useState, useEffect, useMemo } from 'react';
import Icon from '../Icon';

export const MIN_PRICE_COINS = 50;
export const MAX_PRICE_COINS = 10000;

/** The prices people actually pick. Spread wide rather than evenly: the gap
 *  between 50 and 500 gets used far more than the gap between 2k and 10k. */
const QUICK_PICKS = [50, 100, 250, 500, 1000, 2500];

/** Coins → a rough euro figure, at the locked €0.0090/coin floor. Shown as an
 *  aid, never as the price: the price is coins, and the floor moves. */
const eur = (coins) => `≈ €${(coins * 0.009).toFixed(2)}`;

/**
 * @param {boolean}  open
 * @param {function} onClose
 * @param {function} onConfirm      ({ isPaid, priceCoins }) => void | Promise
 * @param {string}   title
 * @param {string}   subtitle
 * @param {string}   confirmLabel
 * @param {boolean}  allowFree      false forces a price (paid streams do this)
 * @param {number}   initialPrice
 * @param {boolean}  initialPaid
 * @param {string}   feeNote        override the default fee explainer
 */
export default function PriceSheet({
  open,
  onClose,
  onConfirm,
  title = 'Set a price',
  subtitle = '',
  confirmLabel = 'Confirm',
  allowFree = true,
  initialPrice = 100,
  initialPaid = false,
  feeNote,
}) {
  // Free is the default everywhere it is allowed. Charging is a choice someone
  // makes on purpose, and a sheet that opens pre-armed with a price invites the
  // accidental paywall.
  const [isPaid, setIsPaid] = useState(allowFree ? initialPaid : true);
  const [price, setPrice] = useState(initialPrice);
  const [raw, setRaw] = useState(String(initialPrice));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setIsPaid(allowFree ? initialPaid : true);
    setPrice(initialPrice);
    setRaw(String(initialPrice));
    setErr('');
    setBusy(false);
  }, [open, allowFree, initialPaid, initialPrice]);

  const invalid = useMemo(
    () => isPaid && (!Number.isFinite(price) || price < MIN_PRICE_COINS || price > MAX_PRICE_COINS),
    [isPaid, price],
  );

  if (!open) return null;

  const setFromPill = (v) => { setPrice(v); setRaw(String(v)); setErr(''); };

  const onType = (e) => {
    // Digits only. A price is an integer count of coins, and letting through a
    // decimal produces a value the server floors, so the user is shown one
    // number and charged another.
    const v = e.target.value.replace(/[^\d]/g, '').slice(0, 5);
    setRaw(v);
    setPrice(v === '' ? NaN : parseInt(v, 10));
    setErr('');
  };

  const confirm = async () => {
    if (busy) return;
    if (invalid) {
      setErr(`Price must be between ${MIN_PRICE_COINS} and ${MAX_PRICE_COINS.toLocaleString()} coins.`);
      return;
    }
    setBusy(true);
    try {
      await onConfirm({ isPaid, priceCoins: isPaid ? price : 0 });
    } catch (e) {
      setErr(e?.message || 'Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-surface-1 border border-white/10 rounded-t-3xl sm:rounded-3xl p-5 pb-7 sm:pb-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 className="font-syne font-bold text-lg text-text-primary">{title}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary shrink-0" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {subtitle && <p className="text-[13px] text-text-secondary leading-relaxed mb-4">{subtitle}</p>}

        {allowFree && (
          <div className="grid grid-cols-2 gap-2 mb-4">
            <button
              onClick={() => setIsPaid(false)}
              className={`rounded-2xl border px-3 py-3 text-left transition ${
                !isPaid
                  ? 'border-brand-violet bg-brand-violet/15'
                  : 'border-white/10 bg-surface-2 hover:border-white/20'
              }`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <Icon name="lock_open" className="text-[18px] text-brand-violet" />
                <span className="font-semibold text-[14px] text-text-primary">Free</span>
              </div>
              <div className="text-[11.5px] text-text-muted">Anyone invited can see it</div>
            </button>
            <button
              onClick={() => setIsPaid(true)}
              className={`rounded-2xl border px-3 py-3 text-left transition ${
                isPaid
                  ? 'border-brand-gold bg-brand-gold/15'
                  : 'border-white/10 bg-surface-2 hover:border-white/20'
              }`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <Icon name="lock" className="text-[18px] text-brand-gold" />
                <span className="font-semibold text-[14px] text-text-primary">Paid</span>
              </div>
              <div className="text-[11.5px] text-text-muted">They pay coins to unlock</div>
            </button>
          </div>
        )}

        {isPaid && (
          <>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {QUICK_PICKS.map((v) => (
                <button
                  key={v}
                  onClick={() => setFromPill(v)}
                  className={`px-3 py-1.5 rounded-full text-[13px] font-dmmono font-bold tabular-nums border transition ${
                    price === v
                      ? 'border-brand-gold bg-brand-gold/20 text-brand-gold'
                      : 'border-white/10 bg-surface-2 text-text-secondary hover:border-white/25'
                  }`}
                >
                  {v.toLocaleString()}c
                </button>
              ))}
            </div>

            <label className="block">
              <span className="text-[12px] text-text-muted">Or set your own</span>
              <div className="mt-1 flex items-center gap-2 rounded-2xl border border-white/10 bg-surface-2 px-3 py-2.5 focus-within:border-brand-gold/60">
                <Icon name="paid" className="text-[18px] text-brand-gold shrink-0" />
                <input
                  value={raw}
                  onChange={onType}
                  inputMode="numeric"
                  placeholder="100"
                  className="flex-1 bg-transparent outline-none font-dmmono font-bold tabular-nums text-text-primary"
                />
                <span className="text-[13px] text-text-muted shrink-0">coins</span>
              </div>
            </label>

            <div className="mt-2 flex items-center justify-between text-[11.5px] text-text-muted">
              <span>{Number.isFinite(price) ? eur(price) : ` `}</span>
              <span>{MIN_PRICE_COINS}–{MAX_PRICE_COINS.toLocaleString()} coins</span>
            </div>

            <p className="mt-3 text-[11.5px] text-text-muted leading-relaxed">
              {feeNote ||
                'Vergr takes a flat 10% of the sale (8% on Pro). Converting your coins to Gems later carries the usual conversion commission.'}
            </p>
          </>
        )}

        {err && <p className="mt-3 text-[12.5px] text-brand-ember">{err}</p>}

        <button
          onClick={confirm}
          disabled={busy || invalid}
          className="mt-4 w-full rounded-2xl bg-brand-violet hover:bg-brand-violet-light disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 transition"
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </div>
  );
}
