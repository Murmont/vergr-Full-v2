// ScheduleMessageSheet — pick a time to send the current message later, and
// manage already-scheduled messages for this chat (Lite/Pro). The send itself
// is executed server-side by the relay, so it goes out even if the phone is off.

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from '../Icon';

// datetime-local wants "YYYY-MM-DDTHH:mm" in LOCAL time.
function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtWhen(ms) {
  try {
    return new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

// Label a media row when it has no caption to show instead.
const MEDIA_LABEL = {
  image: '📷 Photo', video: '🎬 Video', clip: '🎬 Clip', videonote: '🎥 Video message',
  audio: '🎙 Audio', voice: '🎙 Voice', file: '📎 File', sticker: 'Sticker', giphy: 'GIF',
};
const MEDIA_ICON = {
  image: 'image', video: 'movie', clip: 'movie', videonote: 'videocam',
  audio: 'graphic_eq', voice: 'mic', file: 'description', sticker: 'sticky_note_2', giphy: 'gif',
};

export default function ScheduleMessageSheet({ open, draftText, media = null, onSchedule, pending = [], onCancel, onClose }) {
  const now = Date.now();
  const [when, setWhen] = useState(() => toLocalInput(new Date(now + 60 * 60 * 1000))); // default +1h
  const [busy, setBusy] = useState(false);
  const minInput = useMemo(() => toLocalInput(new Date(now + 60 * 1000)), [now]);

  if (!open) return null;

  const schedule = async () => {
    const ms = new Date(when).getTime();
    if (!Number.isFinite(ms) || ms < now + 60 * 1000) return;
    setBusy(true);
    await onSchedule(ms);
    setBusy(false);
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[220] bg-black/60 flex items-end sm:items-center justify-center"
      >
        <motion.div
          onClick={(e) => e.stopPropagation()}
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 380, damping: 38 }}
          className="w-full sm:max-w-sm bg-surface-1 border border-white/[0.08] rounded-t-2xl sm:rounded-2xl overflow-hidden"
          style={{ paddingBottom: 'var(--vg-safe-b, 0px)' }}
        >
          <div className="flex items-center gap-2 px-4 pt-4 pb-3">
            <Icon name="schedule" size={18} className="text-brand-violet-light" />
            <span className="text-sm font-bold text-white">Schedule message</span>
            <button onClick={onClose} className="ml-auto w-8 h-8 rounded-full bg-white/[0.06] text-text-secondary flex items-center justify-center">
              <Icon name="close" size={16} />
            </button>
          </div>

          {media || draftText ? (
            <div className="px-4 pb-3">
              {media ? (
                // Staged attachment: it's already uploaded, so show it (a thumb
                // for images, an icon otherwise) plus any caption.
                <div className="flex items-center gap-3 mb-3 p-2 rounded-xl bg-surface-2 border border-white/[0.06]">
                  {media.type === 'image' ? (
                    <img src={media.contentUrl} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="w-11 h-11 rounded-lg bg-surface-3 flex items-center justify-center shrink-0">
                      <Icon name={MEDIA_ICON[media.type] || 'attachment'} size={20} className="text-brand-violet-light" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{media.fileName || MEDIA_LABEL[media.type] || 'Attachment'}</p>
                    {media.caption
                      ? <p className="text-[11px] text-text-muted truncate">“{media.caption}”</p>
                      : <p className="text-[11px] text-text-muted">{MEDIA_LABEL[media.type] || 'Attachment'}</p>}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-text-muted mb-2 line-clamp-2">“{draftText}”</p>
              )}
              <input
                type="datetime-local"
                value={when}
                min={minInput}
                onChange={(e) => setWhen(e.target.value)}
                className="w-full bg-surface-2 border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-brand-violet-light [color-scheme:dark]"
              />
              <button
                onClick={schedule}
                disabled={busy}
                className="w-full mt-3 py-3 rounded-xl bg-brand-violet text-white font-bold text-sm disabled:opacity-60"
              >
                {busy ? 'Scheduling…' : 'Schedule'}
              </button>
            </div>
          ) : (
            <p className="px-4 pb-3 text-xs text-text-muted">Type a message (or attach a photo, video or file), then hold Send to schedule it.</p>
          )}

          {pending.length > 0 && (
            <div className="border-t border-white/[0.06] px-2 py-2">
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Scheduled ({pending.length})</p>
              <div className="max-h-[38vh] overflow-y-auto">
                {pending.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-2 py-2 rounded-lg">
                    {p.mediaKind && (
                      p.mediaKind === 'image' && p.contentUrl
                        ? <img src={p.contentUrl} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />
                        : (
                          <div className="w-9 h-9 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
                            <Icon name={MEDIA_ICON[p.mediaKind] || 'attachment'} size={16} className="text-brand-violet-light" />
                          </div>
                        )
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{p.text || MEDIA_LABEL[p.mediaKind] || 'Message'}</p>
                      <p className="text-[11px] text-text-muted mt-0.5">{fmtWhen(p.sendAt)}</p>
                    </div>
                    <button
                      onClick={() => onCancel(p.id)}
                      className="shrink-0 text-[12px] font-semibold text-brand-ember px-2 py-1 rounded-lg hover:bg-brand-ember/10"
                    >
                      Cancel
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
