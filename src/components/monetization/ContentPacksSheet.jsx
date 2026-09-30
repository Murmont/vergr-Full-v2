// src/components/monetization/ContentPacksSheet.jsx
//
// A creator's saved Content Packs, and the way to send one.
//
// ## What a pack is for
//
// Selling the same ten photos to forty fans, without reopening the gallery and
// reselecting those ten photos forty times. The set is uploaded once, titled and
// priced once, and sent in one tap after that.
//
// ## What it is NOT
//
// A subscription, or a thing anyone buys once and keeps across conversations.
// Sending a pack writes an ordinary locked message and the entitlement stays
// keyed to that message, so two sends are two independent sales. The server
// enforces that; this sheet just picks one.
import { useState, useEffect } from 'react';
import Icon from '../Icon';
import { getMyMediaPacks, deleteMediaPack, sendMediaPack } from '../../firebase/firestore';
import { useUI } from '../../context/UIContext';

/**
 * @param {boolean}  open
 * @param {function} onClose
 * @param {string}   chatId
 * @param {'conversation'|'squad'} scope
 * @param {function} onCreateNew  opens the ordinary "pick files" flow
 * @param {function} onSent       ({ messageId, previewUrl }) after a successful send
 */
export default function ContentPacksSheet({ open, onClose, chatId, scope = 'conversation', onCreateNew, onSent }) {
  const { showToast } = useUI();
  const [packs, setPacks] = useState(null); // null = loading
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setPacks(null);
    getMyMediaPacks()
      .then((rows) => { if (alive) setPacks(rows); })
      // An empty list and a failed read look the same to the user here, and the
      // recovery is identical: make one. Better than an error nobody can act on.
      .catch(() => { if (alive) setPacks([]); });
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;

  const send = async (pack) => {
    if (busyId) return;
    setBusyId(pack.id);
    try {
      // The client names the message so the relay frame and the Firestore
      // document agree on one id — the same reason `sendLockedMessage` takes
      // one. Without it the message exists but nothing renders it.
      const messageId = `lk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      await sendMediaPack({ packId: pack.id, chatId, scope, messageId });
      onSent?.({ messageId, previewUrl: pack.coverPreviewUrl || '' });
      onClose?.();
    } catch (e) {
      showToast?.(e?.message || 'Could not send that pack.', 'error');
    } finally {
      setBusyId('');
    }
  };

  const remove = async (pack) => {
    try {
      await deleteMediaPack(pack.id);
      setPacks((prev) => (prev || []).filter((p) => p.id !== pack.id));
    } catch (e) {
      showToast?.(e?.message || 'Could not delete that pack.', 'error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-surface-1 border border-white/10 rounded-t-3xl sm:rounded-3xl p-5 pb-7 sm:pb-5 max-h-[80vh] overflow-y-auto sheet-safe"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <h3 className="font-syne font-bold text-lg text-text-primary">Content Packs</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary shrink-0" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        {packs === null ? (
          <div className="py-10 text-center text-[13px] text-text-muted">Loading…</div>
        ) : packs.length === 0 ? (
          // The empty state IS the pitch. Somebody opening this for the first
          // time has never heard of a pack, so it says what one is for.
          <div className="py-8 text-center">
            <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-surface-2 grid place-items-center">
              <Icon name="photo_library" className="text-text-muted text-[26px]" />
            </div>
            <div className="font-syne font-bold text-[15px] text-text-primary">Create a Media Pack</div>
            <p className="text-[12.5px] text-text-muted mt-1 leading-relaxed max-w-[280px] mx-auto">
              Give your fans something to get excited about. Bundle photos or clips
              once, set a price, and send it to anyone in a tap.
            </p>
            <button
              onClick={() => { onClose?.(); onCreateNew?.(); }}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-white font-bold text-[13.5px]"
              style={{ background: 'linear-gradient(135deg, #C87FFF 0%, #7B1FFF 100%)' }}
            >
              <Icon name="add" size={18} />
              Create
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {packs.map((pack) => (
                <div
                  key={pack.id}
                  className="flex items-center gap-3 rounded-2xl bg-surface-2 border border-white/[0.06] p-2.5"
                >
                  <div className="w-14 h-14 rounded-xl overflow-hidden bg-black/40 shrink-0 relative">
                    {pack.coverPreviewUrl ? (
                      <img src={pack.coverPreviewUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full grid place-items-center">
                        <Icon name="lock" className="text-white/40 text-[20px]" />
                      </div>
                    )}
                    <span className="absolute bottom-0.5 right-0.5 rounded bg-black/75 px-1 text-[9px] font-dmmono font-bold text-white">
                      {pack.itemCount || 1}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-[13.5px] text-text-primary truncate">{pack.title}</div>
                    <div className="text-[11.5px] text-text-muted flex items-center gap-1 mt-0.5">
                      <Icon name="paid" size={12} className="text-brand-gold" />
                      <span className="font-dmmono tabular-nums">{(pack.priceCoins || 0).toLocaleString()}</span>
                      {pack.sendCount > 0 && <span>· sent {pack.sendCount}×</span>}
                    </div>
                  </div>

                  <button
                    onClick={() => remove(pack)}
                    aria-label="Delete pack"
                    className="w-8 h-8 grid place-items-center rounded-full text-text-muted hover:text-brand-ember transition shrink-0"
                  >
                    <Icon name="delete" size={17} />
                  </button>
                  <button
                    onClick={() => send(pack)}
                    disabled={!!busyId}
                    className="rounded-full px-4 py-2 text-white font-bold text-[12.5px] disabled:opacity-60 shrink-0"
                    style={{ background: 'linear-gradient(135deg, #C87FFF 0%, #7B1FFF 100%)' }}
                  >
                    {busyId === pack.id ? 'Sending…' : 'Send'}
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={() => { onClose?.(); onCreateNew?.(); }}
              className="w-full mt-3 rounded-2xl border border-dashed border-white/15 py-3 text-[13px] font-bold text-text-secondary hover:border-white/30 hover:text-text-primary transition flex items-center justify-center gap-1.5"
            >
              <Icon name="add" size={18} />
              New pack
            </button>
          </>
        )}
      </div>
    </div>
  );
}
