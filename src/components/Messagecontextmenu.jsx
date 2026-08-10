import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import Icon from './Icon';
import EmojiPicker from './EmojiPicker';
import ReactionEmoji from './ReactionEmoji';
import { QUICK_REACTIONS } from '../utils/reactionAssets';

// Quick reaction bar inside context menu. When `onReact` is provided (the
// relay path — no Firestore message docs exist) the parent owns the write;
// otherwise fall back to the legacy per-message-doc update.
// Telegram-style quick set (shared source of truth). The trailing "+" opens
// the full picker so ANY emoji can be used as a reaction.
const QUICK_EMOJIS = QUICK_REACTIONS;

// Telegram-style: the picked emoji flies from the tap point to the message
// bubble and "lands" where the reaction chip appears. Raw DOM + WAAPI so the
// flight survives the menu unmounting right after the tap. Silently no-ops
// when the bubble isn't findable (e.g. a caller without msg-<id> anchors).
function flyEmojiToMessage(emoji, fromEl, messageId) {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const target = document.getElementById(`msg-${messageId}`);
    if (!fromEl || !target) return;
    const from = fromEl.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const el = document.createElement('div');
    // Clone the tapped Noto emoji render (img/svg/canvas) so the flyer looks
    // identical to the bar; fall back to the system glyph.
    const inner = fromEl.querySelector('img,svg,canvas');
    if (inner) el.appendChild(inner.cloneNode(true));
    else el.textContent = emoji;
    Object.assign(el.style, {
      position: 'fixed',
      left: `${from.left + from.width / 2 - 14}px`,
      top: `${from.top + from.height / 2 - 14}px`,
      width: '28px', height: '28px', fontSize: '24px', lineHeight: '28px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 10002, pointerEvents: 'none', willChange: 'transform',
    });
    document.body.appendChild(el);
    // Land near the bubble's bottom edge (where ReactionBubbles renders),
    // with a lifted mid-keyframe so the path arcs instead of beelining.
    const dx = (to.left + Math.min(to.width * 0.4, 110)) - (from.left + from.width / 2);
    const dy = (to.bottom - 6) - (from.top + from.height / 2);
    const anim = el.animate([
      { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 46}px) scale(1.25)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.55)`, opacity: 0.85 },
    ], { duration: 430, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    anim.onfinish = () => el.remove();
    setTimeout(() => { try { el.remove(); } catch {} }, 700);
  } catch {}
}

function QuickReactions({ chatId, messageId, onClose, onReact, onPickerToggle }) {
  const [showPicker, setShowPicker] = useState(false);
  // Animated emoji are FREE for everyone — no tier gate. Any emoji reacts
  // on any plan.
  const togglePicker = (open) => { setShowPicker(open); onPickerToggle?.(open); };

  const handleReact = async (emoji, fromEl) => {
    // Launch the flight immediately (before any network write) so the tap
    // feels instant; the chip pops in as the flyer lands.
    if (fromEl) flyEmojiToMessage(emoji, fromEl, messageId);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid || !chatId || !messageId) return;
      if (onReact) {
        await onReact(emoji);
      } else {
        const msgRef = doc(db, 'conversations', chatId, 'messages', messageId);
        await updateDoc(msgRef, {
          [`reactions.${emoji}`]: arrayUnion(uid),
        });
      }
    } catch (err) {
      console.error('Failed to add reaction:', err);
    }
    onClose?.();
  };

  // First 6 quick emojis + a chevron expander (Telegram-style). The bar runs
  // slightly WIDER than the menu below it (Telegram's does too) so the row
  // breathes instead of cramming.
  const BAR_EMOJIS = QUICK_EMOJIS.slice(0, 6);

  return (
    <>
      {/* Floating reaction bar — glass, with a chevron-down expander (not a
          "+") that opens the full picker. */}
      <div className="w-64 flex items-center justify-around mb-2 px-1.5 py-1.5 bg-surface-1/95 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl">
        {BAR_EMOJIS.map((e, i) => (
          <motion.button key={e} onClick={(ev) => handleReact(e, ev.currentTarget)}
            initial={{ scale: 0, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ delay: i * 0.03, type: 'spring', stiffness: 520, damping: 22 }}
            whileHover={{ scale: 1.3, y: -3 }}
            whileTap={{ scale: 0.8 }}
            className="w-8 h-8 rounded-full hover:bg-white/[0.08] flex items-center justify-center leading-none">
            <ReactionEmoji emoji={e} size={23} />
          </motion.button>
        ))}
        <motion.button onClick={() => togglePicker(true)}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: BAR_EMOJIS.length * 0.03, type: 'spring', stiffness: 520, damping: 22 }}
          whileHover={{ scale: 1.12 }}
          whileTap={{ scale: 0.8 }}
          title="More reactions"
          className="w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.14] flex items-center justify-center text-text-secondary hover:text-white">
          <Icon name="keyboard_arrow_down" size={20} />
        </motion.button>
      </div>

      {/* Full picker — rendered ABOVE the context menu (which hides itself
          while this is open via onPickerToggle) so every emoji is clickable.
          On mobile the sheet is lifted clear of the phone/app bottom nav. */}
      {showPicker && createPortal(
        <div
          className="fixed inset-0 z-[10001] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 pb-[calc(env(safe-area-inset-bottom)+4rem)] sm:pb-4"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); togglePicker(false); }}
        >
          <motion.div
            initial={{ y: 40, opacity: 0.6, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className="w-full max-w-sm bg-surface-1 border border-white/[0.08] rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <EmojiPicker onSelect={(emoji) => { togglePicker(false); handleReact(emoji); }} onClose={() => togglePicker(false)} />
          </motion.div>
        </div>,
        document.body
      )}
    </>
  );
}

// Display existing reactions below a message
export function ReactionBubbles({ reactions, chatId, messageId, isMe, onToggle, onShowReactors }) {
  // Long-press a chip → "who reacted" sheet (tap still toggles your reaction).
  // Refs declared before the early-return to keep hook order stable.
  const pressTimer = useRef(null);
  const longPressed = useRef(false);

  if (!reactions || typeof reactions !== 'object' || Object.keys(reactions).length === 0) return null;

  // Normalize reaction values — could be array, object, or number from Firestore
  const normalizeUsers = (val) => {
    if (Array.isArray(val)) return val;
    if (typeof val === 'number') return new Array(val).fill('unknown');
    if (typeof val === 'object' && val !== null) return Object.keys(val);
    return [];
  };

  const startPress = (emoji) => {
    if (!onShowReactors) return;
    longPressed.current = false;
    pressTimer.current = setTimeout(() => { longPressed.current = true; onShowReactors(emoji); }, 380);
  };
  const endPress = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } };

  const handleToggle = async (emoji) => {
    if (longPressed.current) { longPressed.current = false; return; }
    try {
      const uid = auth.currentUser?.uid;
      if (!uid || !chatId || !messageId) return;
      if (onToggle) { await onToggle(emoji); return; }
      const msgRef = doc(db, 'conversations', chatId, 'messages', messageId);
      const users = normalizeUsers(reactions[emoji]);
      if (users.includes(uid)) {
        await updateDoc(msgRef, { [`reactions.${emoji}`]: arrayRemove(uid) });
      } else {
        await updateDoc(msgRef, { [`reactions.${emoji}`]: arrayUnion(uid) });
      }
    } catch (err) {
      console.error('Failed to toggle reaction:', err);
    }
  };

  return (
    <div className={`flex flex-wrap gap-1 -mt-1 relative z-10 px-0.5 ${isMe ? 'justify-end' : 'justify-start'}`}>
      {Object.entries(reactions).map(([emoji, rawUsers]) => {
        const users = normalizeUsers(rawUsers);
        if (users.length === 0) return null;
        const isMine = users.includes(auth.currentUser?.uid);
        return (
          <motion.button key={emoji} onClick={() => handleToggle(emoji)}
            onPointerDown={() => startPress(emoji)}
            onPointerUp={endPress}
            onPointerLeave={endPress}
            onContextMenu={(e) => { if (onShowReactors) { e.preventDefault(); longPressed.current = true; onShowReactors(emoji); } }}
            layout
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 550, damping: 20 }}
            whileTap={{ scale: 0.85 }}
            className={`inline-flex items-center gap-1 pl-1.5 pr-2 py-[3px] rounded-full ${
              isMine
                ? 'bg-brand-violet/35 border border-brand-violet/70 shadow-[0_1px_3px_rgba(123,31,255,0.35)]'
                : 'bg-black/35 border border-white/15 backdrop-blur-sm'
            }`}>
            <motion.span key={users.length} initial={{ scale: 1.5 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 18 }} style={{ lineHeight: 1, display: 'inline-flex' }}><ReactionEmoji emoji={emoji} size={15} /></motion.span>
            <span className={`text-[11px] font-bold tabular-nums ${isMine ? 'text-white' : 'text-white/80'}`}>{users.length}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

/**
 * Renders as a fixed-position portal at (anchorX, anchorY), flipping toward
 * the opposite edge if it would overflow the viewport. A transparent
 * backdrop catches any click outside the menu and closes it.
 */
export function MessageContextMenu({ chatId, messageId, message, isMe, anchorX, anchorY, onClose, onReply, onEdit, onPin, onForward, onDelete, onTranslate, onReact, onSelect, onSaveMedia }) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ left: anchorX ?? 0, top: anchorY ?? 0, visible: false, origin: 'top left' });
  // Hide the menu + reaction pill while the full emoji picker is open so they
  // can't sit on top of it and block its clicks (they live at z-9999; the
  // picker portal is a DOM child of this tree only in React terms, not CSS).
  const [pickerOpen, setPickerOpen] = useState(false);
  // When the menu opens from a long-press, the user's finger is still down.
  // The release of that finger fires a cascade on the backdrop: pointerup,
  // then synthesised mousedown/mouseup/click at the release point — which
  // would close the menu instantly. We swallow all events for a grace
  // window, and until we've observed a fresh pointerdown on the backdrop.
  const mountedAt = useRef(Date.now());
  const sawFreshDown = useRef(false);

  const items = [
    onReply && { icon: 'reply', label: 'Reply', action: () => { onReply?.(message); onClose?.(); } },
    isMe && onEdit && { icon: 'edit', label: 'Edit', action: () => { onEdit?.(message); onClose?.(); } },
    onForward && { icon: 'forward', label: 'Forward', action: () => { onForward?.(message); onClose?.(); } },
    onSelect && { icon: 'check_circle', label: 'Select', action: () => { onSelect?.(message); onClose?.(); } },
    onTranslate && message?.text && { icon: 'translate', label: 'Translate', action: () => { onTranslate?.(message); onClose?.(); } },
    // Copy only when there's text to copy (media captions count; bare media
    // messages would copy an empty string).
    message?.text && { icon: 'content_copy', label: 'Copy', action: () => { navigator.clipboard?.writeText(message.text); onClose?.(); } },
    onSaveMedia && ['image', 'meme', 'giphy', 'video', 'clip'].includes(message?.type) && (message?.contentUrl || message?.videoUrl) &&
      { icon: 'download', label: 'Save to gallery', action: () => { onSaveMedia?.(message); onClose?.(); } },
    onPin && { icon: 'push_pin', label: message?.pinned ? 'Unpin' : 'Pin', action: () => { onPin?.(message); onClose?.(); } },
    isMe && { icon: 'delete', label: 'Delete', danger: true, action: () => { onDelete?.(message); onClose?.(); } },
  ].filter(Boolean);

  // Measure once mounted, then flip/clamp so the menu stays on screen.
  // offsetWidth/Height are layout sizes, unaffected by the scale-in transform,
  // so the flip math is correct even mid-animation.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 8;
    let left = anchorX ?? 0;
    let top = anchorY ?? 0;
    let flippedUp = false;
    if (left + w + pad > vw) left = vw - w - pad;
    if (left < pad) left = pad;
    if (top + h + pad > vh) { top = Math.max(pad, (anchorY ?? 0) - h); flippedUp = true; }
    if (top < pad) top = pad;
    // Grow from the corner nearest the message (Telegram-style).
    const originX = isMe ? 'right' : 'left';
    const originY = flippedUp ? 'bottom' : 'top';
    setPos({ left, top, visible: true, origin: `${originX} ${originY}` });
  }, [anchorX, anchorY, isMe]);

  // Close on ESC for keyboard users
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Telegram bubble lift: the pressed message rises ABOVE the dimmed
  // backdrop. The original bubble can't be z-lifted out of the chat's
  // stacking contexts, so we clone it onto a fixed layer that paints after
  // the backdrop (same z, later in DOM) and hide the original while open.
  // Skipped for video bubbles (a cloned <video> renders blank).
  useEffect(() => {
    let clone = null;
    let orig = null;
    try {
      orig = document.getElementById(`msg-${messageId}`);
      if (!orig || orig.querySelector('video')) return undefined;
      const rect = orig.getBoundingClientRect();
      if (!rect.width) return undefined;
      clone = orig.cloneNode(true);
      clone.removeAttribute('id');
      Object.assign(clone.style, {
        position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`, margin: '0',
        zIndex: 9998, pointerEvents: 'none', willChange: 'transform',
      });
      document.body.appendChild(clone);
      orig.style.visibility = 'hidden';
      if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        clone.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }],
          { duration: 220, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'forwards' }
        );
      }
    } catch {}
    return () => {
      try { if (orig) orig.style.visibility = ''; } catch {}
      try { clone?.remove(); } catch {}
    };
  }, [messageId]);

  const GRACE_MS = 350;

  // pointerdown / touchstart = the user actually initiated a new tap. This
  // is the *only* signal we trust as a close intent.
  const onDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() - mountedAt.current < GRACE_MS) return; // leftover from long-press
    sawFreshDown.current = true;
    onClose?.();
  };
  // Everything else (pointerup, mouseup, click, touchend) is only a close
  // if a matching down was seen first. Otherwise it's a stale release from
  // the long-press that opened us — swallow it.
  const onUp = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!sawFreshDown.current) return;
    onClose?.();
  };

  return createPortal(
    <>
      {/* Dimmed, softly-blurred backdrop (Telegram lifts the message over a
          dim). Close only on a FRESH press, and only after the grace window —
          otherwise the release of the long-press that opened us closes it
          again immediately. Hidden while the full picker is open. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: pos.visible && !pickerOpen ? 1 : 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-[2px]"
        style={{ pointerEvents: pickerOpen ? 'none' : 'auto' }}
        onPointerDown={onDown}
        onTouchStart={onDown}
        onMouseDown={onDown}
        onPointerUp={onUp}
        onTouchEnd={onUp}
        onMouseUp={onUp}
        onClick={onUp}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (Date.now() - mountedAt.current >= GRACE_MS) onClose?.(); }}
      />
      <motion.div
        ref={menuRef}
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: pos.visible && !pickerOpen ? 1 : 0, scale: pos.visible && !pickerOpen ? 1 : 0.85 }}
        transition={{ type: 'spring', stiffness: 460, damping: 30 }}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className="fixed z-[9999] flex flex-col"
        style={{ left: pos.left, top: pos.top, transformOrigin: pos.origin, alignItems: isMe ? 'flex-end' : 'flex-start', pointerEvents: pickerOpen ? 'none' : 'auto' }}
      >
        <QuickReactions chatId={chatId} messageId={messageId} onClose={onClose} onReact={onReact} onPickerToggle={setPickerOpen} />
        <div className="w-56 bg-surface-1/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
          {items.map((item, i) => (
            <button key={i} onClick={item.action}
              className={`w-full px-4 py-3 text-left text-[15px] flex items-center gap-3.5 active:scale-[0.98] transition-colors ${
                item.danger
                  ? 'text-brand-ember hover:bg-brand-ember/10 border-t border-white/[0.06]'
                  : 'text-text-primary hover:bg-white/[0.06]'
              }`}>
              <Icon name={item.icon} size={19} className={item.danger ? '' : 'text-text-muted'} />
              {item.label}
            </button>
          ))}
        </div>
      </motion.div>
    </>,
    document.body
  );
}
