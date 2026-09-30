import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import Icon from './Icon';
import { haptic } from '../utils/haptics';
import {
  isNativeMediaAvailable, listDeviceMedia, resolveDeviceMedia, formatDuration,
} from '../utils/nativeMedia';

// Telegram-shaped attachment sheet.
//
// The old sheet was a 4-column icon grid: every path, including "send a photo",
// threw you out to the system picker. On native we can do better — MediaBridge
// reads MediaStore, so recent photos and videos are shown INLINE and are
// multi-selectable, with the other actions on a horizontal rail underneath.
//
// The icon rail is still the whole menu on web/desktop (no MediaStore there),
// and it is also the fallback whenever the gallery can't be read — permission
// declined, or an OS that hands us nothing. That fallback is deliberate: the
// user must always be able to attach something.

const ACTIONS = [
  { id: 'gallery',  icon: 'photo_library',        label: 'Gallery',  color: 'text-brand-violet',       bg: 'bg-brand-violet/10' },
  // Camera is deliberately NOT in this rail — it has its own pill above the
  // sheet, which doubles as the permission ask.
  // "Wallet", not "Send Coins" — it opens the wallet transfer sheet, and the
  // amount is shown with its real-money value inside.
  { id: 'wallet',   icon: 'account_balance_wallet', label: 'Wallet', color: 'text-brand-gold',         bg: 'bg-brand-gold/10' },
  { id: 'file',     icon: 'insert_drive_file',    label: 'File',     color: 'text-brand-violet-light', bg: 'bg-brand-violet/10' },
  { id: 'poll',     icon: 'bar_chart',            label: 'Poll',     color: 'text-brand-violet-light', bg: 'bg-brand-violet/10' },
  { id: 'music',    icon: 'music_note',           label: 'Audio',    color: 'text-brand-gold',         bg: 'bg-brand-gold/10' },
  { id: 'location', icon: 'location_on',          label: 'Location', color: 'text-green-400',          bg: 'bg-green-400/10' },
  { id: 'contact',  icon: 'person',               label: 'Contact',  color: 'text-brand-pink',         bg: 'bg-brand-pink/10' },
  { id: 'ticket',   icon: 'confirmation_number',  label: 'Event',   color: 'text-brand-violet-light', bg: 'bg-brand-violet/10' },
  // Priced media. Same PriceSheet as a locked post and a paid stream, so the
  // gesture is learned once and works everywhere a price is set.
  { id: 'locked',   icon: 'lock',                 label: 'Locked',   color: 'text-brand-gold',         bg: 'bg-brand-gold/10' },
  // A private 1:1 session: unlisted, link-only, free or paid.
  { id: 'oneToOne', icon: 'video_call',           label: '1:1',      color: 'text-brand-pink',         bg: 'bg-brand-pink/10' },
];

export default function AttachmentMenu({
  isOpen, onClose,
  onGallery, onCamera, onFile, onLocation, onContact, onMusic, onWallet, onSendTicket, onSendPoll,
  onLocked, onOneToOne,
  onPickedMedia, anchorRef,
}) {
  // Desktop: sit directly above the paperclip. The sheet used to be pinned to a
  // fixed viewport corner, which on the 3-column layout put it over the sidebar
  // instead of over the composer it belongs to. Mobile stays a bottom sheet.
  const [anchor, setAnchor] = useState(null);
  useEffect(() => {
    if (!isOpen) { setAnchor(null); return; }
    const measure = () => {
      const el = anchorRef?.current;
      if (!el || window.innerWidth < 1024) { setAnchor(null); return; }
      const r = el.getBoundingClientRect();
      setAnchor({ left: r.left, bottom: window.innerHeight - r.top + 10 });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isOpen, anchorRef]);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState([]); // ordered ids — the order IS the send order
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [galleryOff, setGalleryOff] = useState(false); // read failed / declined
  const [cameraGranted, setCameraGranted] = useState(false);

  // Whether the camera has already been granted decides the pill's wording.
  // Permissions.query is the only way to ask WITHOUT triggering a prompt; where
  // it isn't supported we say "Allow access", which is never a lie — the worst
  // case is offering permission to someone who already gave it.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const st = await navigator.permissions?.query({ name: 'camera' });
        if (!cancelled && st) setCameraGranted(st.state === 'granted');
      } catch { /* unsupported — leave as "Allow access to camera" */ }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  const canGrid = isNativeMediaAvailable() && !!onPickedMedia;

  // Load the strip when the sheet opens; reset everything when it closes so a
  // stale selection can never be sent into the next chat.
  useEffect(() => {
    if (!isOpen) { setSelected([]); setSending(false); return; }
    if (!canGrid) return;
    let cancelled = false;
    setLoading(true);
    setGalleryOff(false);
    listDeviceMedia(60)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch(() => { if (!cancelled) setGalleryOff(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, canGrid]);

  const toggle = useCallback((id) => {
    haptic.light?.();
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }, []);

  const send = async () => {
    if (!selected.length || sending) return;
    setSending(true);
    try {
      const files = await resolveDeviceMedia(selected);
      if (files.length) onPickedMedia(files);
      onClose();
    } catch {
      // Reading the originals failed — keep the sheet open with the selection
      // intact rather than closing on a silent failure.
      setSending(false);
    }
  };

  if (!isOpen) return null;

  const handlers = {
    camera: onCamera, gallery: onGallery, file: onFile, music: onMusic,
    location: onLocation, contact: onContact, wallet: onWallet,
    ticket: onSendTicket, poll: onSendPoll,
    locked: onLocked, oneToOne: onOneToOne,
  };
  // 'ticket'/'poll' only render where the caller wired them up.
  const actions = ACTIONS.filter((a) =>
    handlers[a.id] && (a.id !== 'ticket' || onSendTicket) && (a.id !== 'poll' || onSendPoll));

  const showGrid = canGrid && !galleryOff && (loading || items.length > 0);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 lg:bg-transparent" />

      <div
        className={`absolute flex flex-col items-center ${
          anchor ? 'lg:items-start' : 'bottom-0 left-0 right-0 lg:bottom-16 lg:left-16 lg:right-auto lg:items-start'
        }`}
        style={anchor ? { left: anchor.left, bottom: anchor.bottom } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Camera pill, floating just above the sheet. Before the user has
            granted camera access this is the ASK; afterwards it's the shortcut.
            Kept outside the sheet so it reads as an offer, not a menu row. */}
        {onCamera && (
          <button
            onClick={() => { onCamera(); onClose(); }}
            className="mb-2.5 flex items-center gap-2 px-4 h-10 rounded-full bg-surface-1/95 backdrop-blur-xl border border-white/[0.08] shadow-2xl active:scale-95 transition"
          >
            <Icon name="photo_camera" size={17} className="text-brand-violet-light" />
            <span className="text-[13px] font-semibold text-text-primary">
              {cameraGranted ? 'Use camera' : 'Allow access to camera'}
            </span>
          </button>
        )}
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          className="w-full max-w-md bg-surface-1 rounded-t-3xl border-t border-white/[0.06] lg:rounded-2xl lg:border lg:max-w-[280px] lg:shadow-2xl overflow-hidden"
          // Clears the Android gesture/nav bar — the sheet is bottom-anchored,
          // so without this the last row sits underneath the system bar.
          style={{ paddingBottom: 'calc(var(--vg-safe-b, 0px) + 10px)' }}
        >
          <div className="flex justify-center pt-2.5 pb-1 lg:hidden">
            <div className="w-9 h-1 rounded-full bg-white/[0.10]" />
          </div>

          {showGrid && (
            <div className="px-2 pt-1">
              <div className="grid grid-cols-3 gap-1 overflow-y-auto overscroll-contain" style={{ maxHeight: '38vh' }}>
                {loading && items.length === 0 && Array.from({ length: 9 }).map((_, i) => (
                  <div key={`sk-${i}`} className="aspect-square rounded-lg bg-surface-2/60 animate-pulse" />
                ))}
                {items.map((it) => {
                  const idx = selected.indexOf(it.id);
                  const on = idx >= 0;
                  return (
                    <button
                      key={it.id}
                      onClick={() => toggle(it.id)}
                      className="relative aspect-square rounded-lg overflow-hidden bg-surface-2 active:scale-[0.97] transition-transform"
                    >
                      <img
                        src={it.thumbSrc}
                        alt=""
                        loading="lazy"
                        className={`w-full h-full object-cover transition-opacity ${on ? 'opacity-70' : 'opacity-100'}`}
                      />
                      {it.isVideo && (
                        <span className="absolute bottom-1 left-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-black/65 text-[9px] font-bold text-white tabular-nums">
                          <Icon name="play_arrow" size={10} />
                          {formatDuration(it.durationMs)}
                        </span>
                      )}
                      <span
                        className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold ${
                          on ? 'bg-brand-violet border-brand-violet text-white' : 'border-white/70 bg-black/25'
                        }`}
                      >
                        {on ? idx + 1 : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Horizontal action rail — scrolls sideways so adding an action never
              squeezes the others into an unreadable 4-across grid. */}
          <div className="flex gap-1 overflow-x-auto px-2 pt-2 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:grid lg:grid-cols-3 lg:overflow-visible">
            {actions.map((a) => (
              <button
                key={a.id}
                onClick={() => { handlers[a.id]?.(); onClose(); }}
                className="flex flex-col items-center gap-1.5 py-2 px-1 rounded-xl shrink-0 w-[68px] lg:w-auto hover:bg-surface-2/50 active:scale-95 transition"
              >
                <div className={`w-11 h-11 rounded-full ${a.bg} flex items-center justify-center`}>
                  <Icon name={a.icon} size={21} className={a.color} />
                </div>
                <span className="text-[10px] text-text-secondary font-medium leading-tight">{a.label}</span>
              </button>
            ))}
          </div>

          {selected.length > 0 && (
            <div className="px-3 pt-1.5">
              <button
                onClick={send}
                disabled={sending}
                className="w-full h-12 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 disabled:opacity-70"
                style={{ background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)' }}
              >
                <Icon name={sending ? 'hourglass_top' : 'send'} size={18} />
                {sending ? 'Preparing…' : `Send ${selected.length} ${selected.length === 1 ? 'item' : 'items'}`}
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
