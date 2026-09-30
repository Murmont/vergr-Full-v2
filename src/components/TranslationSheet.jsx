// Telegram-style translation panel. Opens as a bottom sheet when a chat message
// is tapped; auto-translates the message into the viewer's language and shows
// the original beneath. Handles the Lite/Pro gate (DM/squad/stream chat).
//
// Props: { text, kind, refId, onClose }  (kind: 'message' | 'streamchat')

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useUser } from '../context/UserContext';
import { translateContent } from '../firebase/firestore';
import { translateTarget, langLabel } from '../utils/localePrefs';
import Icon from './Icon';
import AnimatedEmojiUpsell from './premium/AnimatedEmojiUpsell';

export default function TranslationSheet({ text, kind = 'message', refId = null, onClose }) {
  const { profile } = useUser();
  const target = translateTarget(profile);
  const [status, setStatus] = useState('loading'); // loading | done | upgrade | error
  const [out, setOut] = useState(null);
  const [detected, setDetected] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await translateContent({ text: String(text), target, kind, refId });
        if (!alive) return;
        setOut(r.translatedText); setDetected(r.detected || null); setStatus('done');
      } catch (e) {
        if (!alive) return;
        setStatus(String(e?.message || '').includes('UPGRADE_REQUIRED') ? 'upgrade' : 'error');
      }
    })();
    return () => { alive = false; };
  }, [text, target, kind, refId]);

  // Gated (free tier): show the designed premium upsell popup instead of the
  // plain sheet. Same card used to sell animated emoji, retargeted to translate.
  if (status === 'upgrade') {
    return <AnimatedEmojiUpsell variant="translate" onClose={onClose} />;
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[9999] flex items-end justify-center"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <motion.div
          className="relative w-full max-w-lg bg-surface-1 border-t border-white/10 rounded-t-3xl p-5"
          style={{ paddingBottom: 'calc(var(--vg-safe-b, 0px) + 20px)' }}
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 400, damping: 36 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" />
          <div className="flex items-center gap-2 mb-3">
            <Icon name="translate" size={18} className="text-brand-violet-light" />
            <span className="text-sm font-bold text-text-primary">
              {status === 'done' && detected ? `Translated from ${langLabel(detected)}` : 'Translation'}
            </span>
            <button onClick={onClose} className="ml-auto text-text-muted hover:text-text-primary"><Icon name="close" size={20} /></button>
          </div>

          {status === 'loading' && (
            <div className="py-6 text-center text-text-muted text-sm">Translating…</div>
          )}
          {status === 'done' && (
            <>
              <p className="text-text-primary text-[15px] leading-relaxed whitespace-pre-wrap break-words">{out}</p>
              <div className="mt-4 pt-3 border-t border-white/[0.06]">
                <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted mb-1">Original</p>
                <p className="text-text-secondary text-sm leading-relaxed whitespace-pre-wrap break-words">{text}</p>
              </div>
            </>
          )}
          {status === 'error' && (
            <div className="py-6 text-center text-text-muted text-sm">Couldn't translate. Try again later.</div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
