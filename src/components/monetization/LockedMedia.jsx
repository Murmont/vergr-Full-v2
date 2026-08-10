// src/components/monetization/LockedMedia.jsx
//
// The locked state, and the unlock, for anything sold through entitlements.js:
// a locked post, locked media in a DM / group / squad chat, whole-creator
// access. One component so the paywall looks and behaves identically wherever
// it appears.
//
// ## What "locked" actually means here
//
// The blurred image you see is a SEPARATE, deliberately destroyed file that the
// creator's own device produced before upload. The real bytes live on a private
// R2 prefix with no public URL, and the only route to them is `getAccess`
// minting a five-minute signed GET after it has proven this viewer paid.
//
// So there is nothing to un-blur here. Do not "improve" this by fetching the
// real media and applying a CSS filter: that ships the full-resolution file to
// every viewer and the paywall becomes a decoration anyone defeats with the
// network tab.
//
// ## The signed URL is short-lived on purpose
//
// Five minutes. Long enough to start playing, short enough that a URL pasted
// into a group chat is dead on arrival. That means it must not be cached across
// mounts: a stale one renders a broken image, which reads as a bug rather than
// as a paywall. Re-fetch on mount, every time.
import { useState, useEffect, useCallback } from 'react';
import Icon from '../Icon';
import { getContentAccess, purchaseContentAccess } from '../../firebase/firestore';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';

/**
 * @param {'post'|'stream'|'message'|'creator'} resourceType
 * @param {string}  resourceId   for a message this is `${chatId}:${messageId}`
 * @param {object}  locked       the resource's own `locked` block (price, preview, counts)
 * @param {string}  className    sizing comes from the parent; this fills it
 * @param {boolean} compact      chat bubbles are small; drops the counter row
 * @param {function} onUnlocked  told after a successful purchase
 */
export default function LockedMedia({
  resourceType,
  resourceId,
  locked = {},
  className = '',
  compact = false,
  previewUrl = null,
  onUnlocked,
}) {
  const { wallet } = useUser();
  const { showToast } = useUI();

  const [state, setState] = useState({ loading: true, hasAccess: false, mediaUrl: null, isOwner: false, priceCoins: 0 });
  const [buying, setBuying] = useState(false);

  // The price comes from the SERVER first. On the relay chat path a message row
  // carries no `locked` block at all (the relay persists a fixed field set), so
  // the local prop is a hint and getAccess is the authority.
  const price = Math.floor(state.priceCoins || locked?.priceCoins || 0);
  const isVideo = !!locked?.isVideo;
  const preview = previewUrl || locked?.previewUrl || null;

  const load = useCallback(async () => {
    try {
      const res = await getContentAccess(resourceType, resourceId);
      setState({
        loading: false,
        hasAccess: !!res?.hasAccess,
        isOwner: !!res?.isOwner,
        mediaUrl: res?.mediaUrl || null,
        priceCoins: Math.floor(res?.priceCoins || 0),
      });
    } catch {
      // A failed access check is not a failed paywall. Fall back to locked so a
      // transient error never hands content away.
      setState({ loading: false, hasAccess: false, isOwner: false, mediaUrl: null, priceCoins: 0 });
    }
  }, [resourceType, resourceId]);

  useEffect(() => { load(); }, [load]);

  const unlock = async () => {
    if (buying) return;
    const balance = wallet?.balance ?? 0;
    if (balance < price) {
      showToast?.(`You need ${(price - balance).toLocaleString()} more coins.`, 'error');
      return;
    }
    setBuying(true);
    try {
      await purchaseContentAccess(resourceType, resourceId);
      // Re-fetch rather than trusting the purchase response: the signed media
      // URL is minted by getAccess and only by getAccess.
      await load();
      showToast?.('Unlocked', 'success');
      onUnlocked?.();
    } catch (e) {
      showToast?.(e?.message || 'Could not unlock.', 'error');
    } finally {
      setBuying(false);
    }
  };

  // ── unlocked, or the creator's own content ────────────────────────────────
  if (state.hasAccess && state.mediaUrl) {
    return isVideo ? (
      <video
        src={state.mediaUrl}
        controls
        playsInline
        className={`w-full rounded-2xl bg-black ${className}`}
      />
    ) : (
      <img src={state.mediaUrl} alt="" className={`w-full rounded-2xl object-cover ${className}`} />
    );
  }

  // Access granted but no bytes to show: a paid STREAM has no R2 object (its
  // playback URLs come back separately), and the viewer screen renders those.
  if (state.hasAccess && !state.mediaUrl && resourceType === 'stream') return null;

  // STILL CHECKING. Render the placeholder, never the paywall.
  //
  // Showing the locked state first meant an owner (or anyone who had already
  // paid) watched their own content sit behind a "Unlock for 100" button for a
  // beat and then pop open by itself. That reads as a paywall anyone can wait
  // out, which is the single worst thing this component could imply.
  if (state.loading) {
    return (
      <div className={`relative overflow-hidden rounded-2xl bg-surface-2 ${className}`}>
        {preview
          ? <img src={preview} alt="" className="w-full h-full object-cover opacity-60" aria-hidden />
          : <div className="w-full h-full min-h-[180px] bg-gradient-to-br from-brand-violet/20 via-surface-2 to-brand-gold/10" />}
      </div>
    );
  }

  // ── locked ────────────────────────────────────────────────────────────────
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-surface-2 ${className}`}>
      {preview ? (
        <img src={preview} alt="" className="w-full h-full object-cover" aria-hidden />
      ) : (
        <div className="w-full h-full min-h-[180px] bg-gradient-to-br from-brand-violet/25 via-surface-2 to-brand-gold/15" />
      )}

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-4 text-center bg-black/45">
        <div className="w-11 h-11 rounded-full bg-brand-gold/20 border border-brand-gold/40 flex items-center justify-center">
          <Icon name="lock" className="text-brand-gold text-[22px]" />
        </div>

        {!compact && (
          <div className="text-[13px] text-white/85 font-medium">
            {isVideo ? 'Locked video' : 'Locked photo'}
          </div>
        )}

        <button
          onClick={unlock}
          disabled={buying || state.loading}
          className="rounded-full bg-brand-gold hover:bg-brand-gold-light disabled:opacity-60 text-black font-bold text-[13.5px] px-4 py-2 transition flex items-center gap-1.5"
        >
          <Icon name="paid" className="text-[17px]" />
          {buying ? 'Unlocking…' : `Unlock for ${price.toLocaleString()}`}
        </button>

        {!compact && locked?.unlockCount > 0 && (
          <div className="text-[11.5px] text-white/60 font-dmmono tabular-nums">
            {locked.unlockCount.toLocaleString()} unlocked
          </div>
        )}
      </div>
    </div>
  );
}
