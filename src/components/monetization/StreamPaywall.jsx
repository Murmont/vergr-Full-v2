// src/components/monetization/StreamPaywall.jsx
//
// The join gate. ONE screen, used by a Premium Live and by a 1:1 session.
//
// The two are different products — a Premium Live is public, discoverable and
// paywalled; a 1:1 is private and invite-only — but the moment before you enter
// is the same moment, so it is the same screen. Two screens would be two places
// for the price to be wrong.
//
// ## This is a real gate, not a hidden button
//
// `createStreamSession` writes no `hlsUrl` onto a paid stream's document (that
// document is world-readable), and puts both playback URLs in
// `streams/{id}/private/playback`, which firestore rules deny to every client
// including the host. A 1:1 is withheld the same way even when it is free,
// because unlisted is not privacy. The URL reaches the player only after
// `getAccess` has confirmed the purchase or the guest list, so there is nothing
// on this page to un-hide.
//
// ## Layout
//
// Read off the founder's Tango screenshots (plan section 22): the stream's own
// still behind everything, blurred and dimmed; the host's avatar centred; a
// state line saying which kind of session this is; the coin price under a tip
// glyph; and one full-width gradient pill. "Tip to Join" when it costs coins,
// plain "Join" when it does not.
import { useState } from 'react';
import Icon from '../Icon';
import UserAvatar from '../UserAvatar';
import { purchaseContentAccess } from '../../firebase/firestore';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';

/**
 * @param {string}  streamId
 * @param {number}  priceCoins   0 for a free private session
 * @param {string}  title
 * @param {string}  hostName
 * @param {string}  hostAvatar
 * @param {string}  stillUrl     the stream's thumbnail, used as the backdrop
 * @param {boolean} isOneToOne   changes the state line only
 * @param {number}  viewerCount  shown for a Premium Live, meaningless for a 1:1
 * @param {function} onUnlocked
 * @param {function} onBack
 */
export default function StreamPaywall({
  streamId,
  priceCoins = 0,
  title,
  hostName,
  hostAvatar,
  stillUrl,
  isOneToOne = false,
  viewerCount = 0,
  onUnlocked,
  onBack,
}) {
  const { wallet } = useUser();
  const { showToast } = useUI();
  const [busy, setBusy] = useState(false);

  const price = Math.floor(priceCoins || 0);
  const balance = wallet?.balance ?? 0;
  const short = Math.max(0, price - balance);

  const join = async () => {
    if (busy) return;
    // A free 1:1 has nothing to buy: the guest list already decided, so the
    // button just enters. Calling purchaseAccess here would fail on a zero
    // price and read as a broken door.
    if (price <= 0) { onUnlocked?.(); return; }
    if (short > 0) {
      showToast?.(`You need ${short.toLocaleString()} more coins.`, 'error');
      return;
    }
    setBusy(true);
    try {
      await purchaseContentAccess('stream', streamId);
      showToast?.('You are in', 'success');
      onUnlocked?.();
    } catch (e) {
      showToast?.(e?.message || 'Could not join.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative w-full h-full min-h-[380px] overflow-hidden flex items-center justify-center">
      {/* The stream's own still, blurred hard. Enough to show a room exists and
          who is in it; nowhere near enough to be a free preview of what is
          being sold. */}
      {stillUrl ? (
        <img
          src={stillUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: 'blur(28px) brightness(0.45)', transform: 'scale(1.15)' }}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-brand-violet/35 via-black to-brand-pink/25" />
      )}
      <div className="absolute inset-0 bg-black/35" />

      {onBack && (
        <button
          onClick={onBack}
          aria-label="Back"
          className="absolute top-3 left-3 z-10 w-9 h-9 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center text-white/90 hover:bg-black/65 transition"
        >
          <Icon name="arrow_back" size={18} />
        </button>
      )}

      <div className="relative z-10 text-center px-6 max-w-sm w-full">
        <div className="flex justify-center mb-3">
          <UserAvatar src={hostAvatar} size={84} />
        </div>

        <div className="font-syne font-bold text-lg text-white leading-tight">
          {hostName || 'Private session'}
        </div>
        {title && (
          <div dir="auto" className="text-[12.5px] text-white/55 mt-0.5 truncate">{title}</div>
        )}

        {/* The state line. The only thing that differs between the two
            products, and it belongs here where somebody is deciding. */}
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold text-white/85">
          <Icon name={isOneToOne ? 'lock' : 'stars'} size={13} />
          {isOneToOne ? '1:1 session' : 'In Premium'}
          {!isOneToOne && viewerCount > 0 && (
            <>
              <span className="text-white/35">·</span>
              <span className="font-dmmono tabular-nums">{viewerCount.toLocaleString()}</span>
              watching
            </>
          )}
        </div>

        {price > 0 && (
          <div className="mt-5 flex flex-col items-center gap-1.5">
            <Icon name="volunteer_activism" className="text-brand-pink text-[34px]" />
            <div className="flex items-center gap-1.5">
              <Icon name="paid" className="text-brand-gold text-[22px]" />
              <span className="font-dmmono tabular-nums font-bold text-2xl text-white">
                {price.toLocaleString()}
              </span>
            </div>
          </div>
        )}

        <button
          onClick={join}
          disabled={busy}
          className="w-full mt-5 rounded-full disabled:opacity-60 text-white font-bold py-3.5 text-[15px] transition"
          style={{ background: 'linear-gradient(135deg, #C87FFF 0%, #7B1FFF 100%)' }}
        >
          {busy ? 'Joining…' : price > 0 ? 'Tip to Join' : 'Join'}
        </button>

        <p className="mt-3 text-[11.5px] text-white/45 leading-relaxed">
          {price > 0 ? (
            <>
              One payment for this session. Your balance is{' '}
              <span className="font-dmmono tabular-nums">{balance.toLocaleString()}</span> coins.
              You can leave at any time.
            </>
          ) : (
            'You can leave at any time.'
          )}
        </p>
      </div>
    </div>
  );
}
