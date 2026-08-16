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
import { COIN_VALUE_USD } from '../../utils/vpSystem';

export const MIN_PRICE_COINS = 50;
export const MAX_PRICE_COINS = 10000;

/** The prices people actually pick. Spread wide rather than evenly (the gap
 *  between 50 and 500 gets used far more than the gap between 2k and 10k) and
 *  listed DESCENDING, which is the order Tango uses: on a phone the first pill
 *  is the one under the thumb, and the bigger ask should be the easy reach. */
const QUICK_PICKS = [2500, 1000, 500, 250, 100, 50];

/**
 * How much one tap of the stepper moves the price.
 *
 * Proportional rather than fixed: +50 is a sensible nudge at 100 coins and a
 * pointless one at 5,000. The result is snapped to the step so repeated taps
 * land on round numbers instead of drifting to 1,250 and then 1,300.
 */
function stepFor(v) {
  if (v < 250) return 25;
  if (v < 1000) return 50;
  if (v < 5000) return 250;
  return 500;
}

/** Coins -> a rough dollar figure, at the ladder's best per-coin rate. Shown as
 *  an aid, never as the price: the price is coins, and the rate moves.
 *  Was a hardcoded EUR 0.009, which understated every locked-content price by
 *  ~29% once the catalogue went native USD. */
const usd = (coins) => `≈ $${(coins * COIN_VALUE_USD).toFixed(2)}`;

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
 * @param {Array}    items          what is being priced: [{ id, url, isVideo }]
 * @param {function} onAddMore      shows the "+" tile; opens the picker again
 * @param {function} onRemoveItem   (index) => void; hidden when only one item
 * @param {boolean}  allowSaveAsPack  offers "save this set for reuse"
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
  items = [],
  onAddMore,
  onRemoveItem,
  allowSaveAsPack = false,
}) {
  // Saving the set as a reusable Content Pack. Off by default: most sends are
  // one-offs, and a creator who wants the shortcut will say so.
  const [saveAsPack, setSaveAsPack] = useState(false);
  const [packTitle, setPackTitle] = useState('');
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
    setSaveAsPack(false);
    setPackTitle('');
  }, [open, allowFree, initialPaid, initialPrice]);

  const invalid = useMemo(
    () => isPaid && (!Number.isFinite(price) || price < MIN_PRICE_COINS || price > MAX_PRICE_COINS),
    [isPaid, price],
  );

  if (!open) return null;

  const setFromPill = (v) => { setPrice(v); setRaw(String(v)); setErr(''); };

  /**
   * Move the price by one step, clamped to the bounds the server enforces.
   *
   * Snapped to the step so a run of taps produces round numbers: without the
   * rounding, starting at 175 and tapping up gives 225, 275, 325 rather than
   * 200, 250, 300.
   */
  const nudge = (dir) => {
    const base = Number.isFinite(price) ? price : MIN_PRICE_COINS;
    const step = stepFor(base);
    const snapped = dir > 0
      ? (Math.floor(base / step) + 1) * step
      : (Math.ceil(base / step) - 1) * step;
    const next = Math.min(MAX_PRICE_COINS, Math.max(MIN_PRICE_COINS, snapped));
    setPrice(next);
    setRaw(String(next));
    setErr('');
  };

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
    if (saveAsPack && !packTitle.trim()) {
      setErr('Give the pack a title, or turn off saving.');
      return;
    }
    setBusy(true);
    try {
      await onConfirm({
        isPaid,
        priceCoins: isPaid ? price : 0,
        saveAsPack: saveAsPack && isPaid,
        packTitle: packTitle.trim(),
      });
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

        {/* THE MEDIA STRIP. What is actually being priced, with a way to add
            more and a way to drop one. Without it the sender is setting a price
            on an abstraction and cannot check they picked the right files,
            which is exactly how a five-photo set goes out with one wrong photo
            in it. */}
        {items.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
            {items.map((it, i) => (
              <div key={it.id ?? i} className="relative shrink-0">
                <div className="w-14 h-14 rounded-xl overflow-hidden bg-surface-2">
                  {it.url ? (
                    <img src={it.url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full grid place-items-center">
                      <Icon name={it.isVideo ? 'movie' : 'image'} className="text-text-muted text-[20px]" />
                    </div>
                  )}
                </div>
                {it.isVideo && (
                  <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 grid place-items-center">
                    <Icon name="play_arrow" size={10} className="text-white" />
                  </span>
                )}
                {onRemoveItem && items.length > 1 && (
                  <button
                    onClick={() => onRemoveItem(i)}
                    aria-label="Remove"
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-black/80 border border-white/20 grid place-items-center text-white hover:bg-brand-ember transition"
                  >
                    <Icon name="close" size={12} />
                  </button>
                )}
              </div>
            ))}
            {onAddMore && (
              <button
                onClick={onAddMore}
                aria-label="Add more"
                className="shrink-0 w-14 h-14 rounded-xl border border-dashed border-white/20 grid place-items-center text-text-muted hover:border-white/40 hover:text-text-secondary transition"
              >
                <Icon name="add" size={20} />
              </button>
            )}
          </div>
        )}

        {/* Free / Premium as ONE segmented control rather than two cards. This
            is where "locked" is chosen, so it should read as a single either/or
            switch, which is what it is. */}
        {allowFree && (
          <div className="grid grid-cols-2 gap-1 p-1 mb-4 rounded-2xl bg-surface-2 border border-white/10">
            <button
              onClick={() => setIsPaid(false)}
              className={`rounded-xl py-2.5 text-[14px] font-bold transition ${
                !isPaid ? 'bg-white text-black' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Free
            </button>
            <button
              onClick={() => setIsPaid(true)}
              className={`rounded-xl py-2.5 text-[14px] font-bold transition ${
                isPaid ? 'bg-white text-black' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Premium
            </button>
          </div>
        )}


        {isPaid && (
          <>
            {/* Stepper and pills edit THE SAME NUMBER. The stepper nudges a
                chosen price, the pills jump to a common one, and typing covers
                everything else. */}
            <div className="flex items-center rounded-2xl border border-white/10 bg-surface-2 overflow-hidden mb-3">
              <button
                onClick={() => nudge(-1)}
                aria-label="Lower the price"
                className="w-12 h-12 grid place-items-center text-text-secondary hover:bg-white/5 hover:text-text-primary transition shrink-0"
              >
                <Icon name="remove" size={20} />
              </button>
              <div className="flex-1 flex items-center justify-center gap-1.5 px-2 min-w-0">
                <Icon name="paid" className="text-[18px] text-brand-gold shrink-0" />
                <input
                  value={raw}
                  onChange={onType}
                  inputMode="numeric"
                  placeholder="100"
                  aria-label="Price in coins"
                  className="w-full min-w-0 bg-transparent outline-none text-center font-dmmono font-bold tabular-nums text-[17px] text-text-primary"
                />
              </div>
              <button
                onClick={() => nudge(1)}
                aria-label="Raise the price"
                className="w-12 h-12 grid place-items-center text-text-secondary hover:bg-white/5 hover:text-text-primary transition shrink-0"
              >
                <Icon name="add" size={20} />
              </button>
            </div>

            {/* Descending, so the largest sits nearest the thumb. */}
            <div className="flex flex-wrap gap-1.5 mb-1">
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

            <div className="mt-2 flex items-center justify-between text-[11.5px] text-text-muted">
              <span>{Number.isFinite(price) ? usd(price) : ` `}</span>
              <span>{MIN_PRICE_COINS}–{MAX_PRICE_COINS.toLocaleString()} coins</span>
            </div>

            {/* SAVE AS A PACK. Offered only where the set can actually be
                re-sent (chat), and only when it is priced: a free set has
                nothing to reuse a price for. */}
            {allowSaveAsPack && (
              <div className="mt-3 rounded-2xl border border-white/10 bg-surface-2 p-3">
                <button
                  onClick={() => setSaveAsPack((v) => !v)}
                  className="w-full flex items-center gap-2.5 text-left"
                >
                  <span
                    className={`w-5 h-5 rounded-md border grid place-items-center shrink-0 transition ${
                      saveAsPack ? 'bg-brand-violet border-brand-violet' : 'border-white/25'
                    }`}
                  >
                    {saveAsPack && <Icon name="check" size={14} className="text-white" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-text-primary">
                      Save as a Content Pack
                    </span>
                    <span className="block text-[11.5px] text-text-muted">
                      Send this same set again without uploading it twice.
                    </span>
                  </span>
                </button>

                {saveAsPack && (
                  <input
                    value={packTitle}
                    onChange={(e) => { setPackTitle(e.target.value.slice(0, 60)); setErr(''); }}
                    placeholder="Pack name, e.g. Beach set"
                    className="mt-2.5 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-[13px] text-text-primary outline-none focus:border-brand-violet/60"
                  />
                )}
              </div>
            )}

            <p className="mt-3 text-[11.5px] text-text-muted leading-relaxed">
              {feeNote ||
                'The full price is revenue Vergr earns, and Vergr pays you a share of it: 50% to start, rising to 80% as your lifetime earnings grow. That share is the only deduction.'}
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
