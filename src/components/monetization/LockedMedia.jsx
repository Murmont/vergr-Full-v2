// src/components/monetization/LockedMedia.jsx
//
// The locked state, the unlock, and the unlocked state for anything sold
// through entitlements.js: a locked post, locked media in a DM / group / squad
// chat, whole-creator access. One component so the paywall looks and behaves
// identically wherever it appears.
//
// ## What "locked" actually means here
//
// The blurred image you see is a SEPARATE, deliberately destroyed file that the
// creator's own device produced before upload. The real bytes live on a private
// R2 prefix with no public URL, and the only route to them is `getAccess`
// minting a signed GET after it has proven this viewer paid.
//
// So there is nothing to un-blur here. Do not "improve" this by fetching the
// real media and applying a CSS filter: that ships the full-resolution file to
// every viewer and the paywall becomes a decoration anyone defeats with the
// network tab.
//
// ## The signed URL is short-lived on purpose
//
// Five minutes for a still, an hour for video (a five-minute URL cannot serve a
// twenty-minute clip). Either way it must not be cached across mounts: a stale
// one renders a broken image, which reads as a bug rather than as a paywall.
// Re-fetch on mount, and re-fetch AGAIN when opening full screen — by then the
// mount-time URL may be minutes old and the lightbox would open onto a 403.
//
// ## Layout
//
// The media is the bubble. No border, no forced square: the sender's device
// measured the real dimensions at upload and they travel on the `locked` block,
// so the shape is reserved before the preview image has even loaded and nothing
// jumps when it does. A cropped square was the single biggest reason this
// looked wrong.
import { useState, useEffect, useCallback } from 'react';
import Icon from '../Icon';
import MediaLightbox from '../MediaLightbox';
import InlineVideoPlayer from '../media/InlineVideoPlayer';
import { getContentAccess, purchaseContentAccess } from '../../firebase/firestore';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';

/** Portrait-ish, which is what most locked media turns out to be. */
const FALLBACK_RATIO = 4 / 5;

const fmtDuration = (ms) => {
  const total = Math.round((Number(ms) || 0) / 1000);
  if (total <= 0) return null;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

/**
 * @param {'post'|'stream'|'message'|'creator'} resourceType
 * @param {string}  resourceId   for a message this is `${chatId}:${messageId}`
 * @param {object}  locked       the resource's own `locked` block (price, preview, dimensions, counts)
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
  minRatio = 0,
  onUnlocked,
}) {
  const { wallet } = useUser();
  const { showToast } = useUI();

  const [state, setState] = useState({ loading: true, hasAccess: false, mediaUrl: null, mediaUrls: [], isOwner: false, priceCoins: 0, preview: null });
  // Which item of a set is showing. A locked set carousels its blurred previews
  // so a buyer can see how many there are and roughly what they are.
  const [page, setPage] = useState(0);
  const [buying, setBuying] = useState(false);
  // Full-screen viewing. `opening` covers the round trip for a fresh URL so a
  // slow network reads as "working" rather than as a dead tap.
  const [lightbox, setLightbox] = useState(null);
  const [opening, setOpening] = useState(false);

  // The SERVER is the authority on all of this, not the props. On the relay chat
  // path a message row carries no `locked` block at all (the relay persists a
  // fixed field set), so the local props are a first-paint hint and getAccess
  // fills in the truth a moment later.
  const meta = { ...(locked || {}), ...(state.preview || {}) };
  const price = Math.floor(state.priceCoins || locked?.priceCoins || 0);

  // A locked send can be a SET, bought once. Everything below indexes into it;
  // a single item is a set of length one so there is one code path, not two.
  const setItems = (Array.isArray(meta.items) && meta.items.length)
    ? meta.items
    : [{
      previewUrl: previewUrl || meta.previewUrl || null,
      isVideo: !!meta.isVideo,
      previewW: meta.previewW,
      previewH: meta.previewH,
      durationMs: meta.durationMs,
    }];
  const count = Math.max(setItems.length, Math.floor(meta.itemCount || 0) || 1);
  const multi = count > 1;
  const idx = Math.min(page, setItems.length - 1);
  const current = setItems[idx] || setItems[0];

  const isVideo = !!current.isVideo;
  const preview = current.previewUrl || previewUrl || meta.previewUrl || null;
  const duration = isVideo ? fmtDuration(current.durationMs) : null;

  // "3 PICS" / "5 VIDEOS", or the singular for one item. Read off the real set,
  // so a mixed set of photos and clips reads as ITEMS rather than lying.
  const allVideo = setItems.every((it) => it.isVideo);
  const allPhoto = setItems.every((it) => !it.isVideo);
  const countLabel = multi
    ? `${count} ${allVideo ? 'VIDEOS' : allPhoto ? 'PICS' : 'ITEMS'}`
    : (isVideo ? 'Video' : 'Photo');

  // Reserve the real shape up front. Falling back to a fixed ratio (rather than
  // to `auto`) matters: with no height the bubble collapses to nothing until the
  // preview loads and the whole thread jumps.
  //
  // `minRatio` is how a feed stops one 9:16 clip from filling the entire screen
  // and pushing every other post out of view. It is a floor on width/height, so
  // it only ever affects very tall portrait media, and it is a clamp rather than
  // a crop: the image inside still covers the box.
  //
  // The COVER decides the shape for the whole set, not the item currently on
  // screen: re-laying-out the bubble on every swipe would shove the rest of the
  // conversation up and down.
  const cover = setItems[0];
  const natural = (cover.previewW > 0 && cover.previewH > 0)
    ? cover.previewW / cover.previewH
    : FALLBACK_RATIO;
  const ratio = minRatio > 0 ? Math.max(natural, minRatio) : natural;

  const load = useCallback(async () => {
    try {
      const res = await getContentAccess(resourceType, resourceId);
      setState({
        loading: false,
        hasAccess: !!res?.hasAccess,
        isOwner: !!res?.isOwner,
        mediaUrl: res?.mediaUrl || null,
        mediaUrls: Array.isArray(res?.mediaUrls) && res.mediaUrls.length
          ? res.mediaUrls
          : (res?.mediaUrl ? [res.mediaUrl] : []),
        priceCoins: Math.floor(res?.priceCoins || 0),
        preview: res?.preview || null,
      });
    } catch {
      // A failed access check is not a failed paywall. Fall back to locked so a
      // transient error never hands content away.
      setState({ loading: false, hasAccess: false, isOwner: false, mediaUrl: null, mediaUrls: [], priceCoins: 0, preview: null });
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

  /**
   * Open full screen with a URL minted just now.
   *
   * Reusing the mount-time URL is the obvious shortcut and it is wrong: a
   * conversation left open for ten minutes hands the lightbox an expired
   * signature, and the viewer gets a black screen on content they paid for. The
   * mount-time URL is kept only as the fallback for a failed re-fetch, where it
   * might still be inside its window.
   */
  const openFullscreen = async (startAt = 0) => {
    if (opening) return;
    setOpening(true);
    let urls = state.mediaUrls;
    try {
      const res = await getContentAccess(resourceType, resourceId);
      if (Array.isArray(res?.mediaUrls) && res.mediaUrls.length) urls = res.mediaUrls;
      else if (res?.mediaUrl) urls = [res.mediaUrl];
    } catch {
      // Fall through to the URLs we already hold.
    }
    setOpening(false);
    if (!urls?.length) { showToast?.('Could not open this media.', 'error'); return; }
    // The whole set goes to the lightbox, opened at the item that was tapped,
    // so a buyer swipes through what they bought instead of reopening it once
    // per photo.
    setLightbox({
      items: urls.map((url, i) => ({
        url,
        type: setItems[i]?.isVideo ? 'video' : 'image',
      })),
      startIndex: Math.min(startAt, urls.length - 1),
    });
  };

  // ── unlocked, or the creator's own content ────────────────────────────────
  //
  // Tapping opens the same full-screen carousel every other medium in the app
  // uses (pinch-zoom, save to gallery, open original). Paying for something that
  // could only ever be viewed at thumbnail size was the worst defect here.
  if (state.hasAccess && state.mediaUrl) {
    // Once unlocked the set behaves like any other media bubble: the current
    // item fills it, arrows and dots move between them, and a tap opens the
    // full-screen carousel at whatever is showing.
    const unlockedUrl = state.mediaUrls[idx] || state.mediaUrl;
    return (
      <>
        <div className={`relative overflow-hidden rounded-2xl bg-black ${className}`} style={{ aspectRatio: ratio }}>
          {isVideo ? (
            <InlineVideoPlayer
              key={unlockedUrl}
              src={unlockedUrl}
              className="w-full h-full"
              videoClassName="w-full h-full"
              maxHeightClass=""
              objectFit="contain"
            />
          ) : (
            <img src={unlockedUrl} alt="" className="w-full h-full object-cover" />
          )}

          {/* Video already owns its surface for play/pause, so the expand
              affordance is an explicit button rather than a tap on the frame. */}
          {isVideo ? (
            <button
              onClick={() => openFullscreen(idx)}
              aria-label="View full screen"
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center text-white/90 hover:bg-black/75 transition"
            >
              <Icon name={opening ? 'progress_activity' : 'open_in_full'} className={`text-[16px] ${opening ? 'animate-spin' : ''}`} />
            </button>
          ) : (
            <button
              onClick={() => openFullscreen(idx)}
              aria-label="View full screen"
              className="absolute inset-0 w-full h-full"
            >
              {opening && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/35">
                  <Icon name="progress_activity" className="text-white text-[26px] animate-spin" />
                </span>
              )}
            </button>
          )}

          {multi && <Pager idx={idx} count={setItems.length} onPage={setPage} />}

          {!compact && (
            <div className="absolute bottom-2 left-2 rounded-full bg-black/55 backdrop-blur-sm px-2 py-0.5 flex items-center gap-1 text-[10.5px] font-bold text-brand-gold">
              <Icon name="lock_open" className="text-[13px]" />
              Unlocked
            </div>
          )}
        </div>

        {lightbox && (
          <MediaLightbox
            items={lightbox.items}
            startIndex={lightbox.startIndex}
            onClose={() => setLightbox(null)}
          />
        )}
      </>
    );
  }

  // Access granted but no bytes to show: a paid STREAM has no R2 object (its
  // playback URLs come back separately), and the viewer screen renders those.
  if (state.hasAccess && !state.mediaUrl && resourceType === 'stream') return null;

  // STILL CHECKING. Render the placeholder, never the paywall.
  //
  // Showing the locked state first meant an owner (or anyone who had already
  // paid) watched their own content sit behind an "Unlock for 100" button for a
  // beat and then pop open by itself. That reads as a paywall anyone can wait
  // out, which is the single worst thing this component could imply.
  if (state.loading) {
    return (
      <div className={`relative overflow-hidden rounded-2xl bg-surface-2 ${className}`} style={{ aspectRatio: ratio }}>
        {preview
          ? <img src={preview} alt="" className="w-full h-full object-cover opacity-60" aria-hidden />
          : <div className="w-full h-full bg-gradient-to-br from-brand-violet/20 via-surface-2 to-brand-gold/10" />}
      </div>
    );
  }

  // ── locked ────────────────────────────────────────────────────────────────
  return (
    <div className={`overflow-hidden rounded-2xl bg-surface-2 ${className}`}>
      {/* Media area: blurred preview at its real proportions, one padlock. */}
      <div className="relative w-full" style={{ aspectRatio: ratio }}>
        {preview ? (
          <img src={preview} alt="" className="absolute inset-0 w-full h-full object-cover" aria-hidden />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-brand-violet/25 via-surface-2 to-brand-gold/15" />
        )}

        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <Icon name="lock" className="text-white/85 text-[44px] drop-shadow-lg" />
        </div>

        {/* Duration over the blur, so a buyer knows how much video they are
            being asked to pay for before they pay for it. */}
        {duration && (
          <div className="absolute top-2 left-2 rounded-md bg-black/60 backdrop-blur-sm px-1.5 py-0.5 text-[11px] font-dmmono tabular-nums text-white/90">
            {duration}
          </div>
        )}

        {/* A set carousels its BLURRED previews. Nothing is given away — these
            are the same destroyed images the cover uses — and it answers the
            only question a buyer has: how much am I actually getting? */}
        {multi && <Pager idx={idx} count={setItems.length} onPage={setPage} />}
      </div>

      {/* Action panel. */}
      <div className="px-2.5 pt-2 pb-2.5 bg-black/25">
        <div className="text-[10.5px] font-bold tracking-wide text-white/55 text-center mb-1.5 uppercase">
          {countLabel}
        </div>

        <button
          onClick={unlock}
          disabled={buying}
          className="w-full rounded-full bg-white hover:bg-white/90 disabled:opacity-60 text-black font-bold text-[13.5px] py-2 transition flex items-center justify-center gap-1.5"
        >
          {buying ? (
            <>
              <Icon name="progress_activity" className="text-[17px] animate-spin" />
              Unlocking…
            </>
          ) : (
            <>
              <Icon name="lock" className="text-[16px]" />
              Unlock
              <span className="ml-1 flex items-center gap-1 font-dmmono tabular-nums">
                <Icon name="paid" className="text-[16px] text-brand-gold" />
                {price.toLocaleString()}
              </span>
            </>
          )}
        </button>

        {!compact && locked?.unlockCount > 0 && (
          <div className="mt-1.5 text-center text-[11px] text-white/50 font-dmmono tabular-nums">
            {locked.unlockCount.toLocaleString()} unlocked
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Carousel controls for a multi-item locked send: a chevron on each edge and a
 * row of page dots along the bottom.
 *
 * Rendered over the media in BOTH states, locked and unlocked, from one
 * component so the two cannot end up with different affordances. While locked
 * it pages through blurred previews, which gives away nothing and answers the
 * buyer's actual question: how many is "3 PICS", really?
 */
function Pager({ idx, count, onPage }) {
  const go = (e, dir) => {
    // The bubble sits inside a tappable message row and, once unlocked, on top
    // of a full-surface open-fullscreen button. Without this, paging also opens
    // the lightbox.
    e.stopPropagation();
    e.preventDefault();
    onPage(Math.min(count - 1, Math.max(0, idx + dir)));
  };

  return (
    <>
      {idx > 0 && (
        <button
          onClick={(e) => go(e, -1)}
          aria-label="Previous"
          className="absolute left-1.5 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-black/55 backdrop-blur-sm grid place-items-center text-white/90 hover:bg-black/75 transition"
        >
          <Icon name="chevron_left" size={18} />
        </button>
      )}
      {idx < count - 1 && (
        <button
          onClick={(e) => go(e, 1)}
          aria-label="Next"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-black/55 backdrop-blur-sm grid place-items-center text-white/90 hover:bg-black/75 transition"
        >
          <Icon name="chevron_right" size={18} />
        </button>
      )}
      <div className="absolute bottom-2 left-0 right-0 z-10 flex items-center justify-center gap-1 pointer-events-none">
        {Array.from({ length: count }).map((_, i) => (
          <span
            key={i}
            className={`rounded-full transition-all ${
              i === idx ? 'w-1.5 h-1.5 bg-white' : 'w-1 h-1 bg-white/45'
            }`}
          />
        ))}
      </div>
    </>
  );
}
