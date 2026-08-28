// Premium upsell sheet (Telegram-Premium-style violet glass card with the
// brand glow). Animated emoji are now FREE for everyone, so the ONLY live use
// of this designed popup is the translation gate (variant="translate"). The
// legacy emoji variant is kept for reference / reuse.
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import Icon from '../Icon';
import ReactionEmoji from '../ReactionEmoji';

const SUPPORT_EMOJIS = ['🔥', '😂', '🎉'];

const VARIANTS = {
  emoji: {
    badge: 'VERGR Lite',
    title: 'Bring your reactions to life',
    body: 'Animated emoji are a Lite perk. Upgrade and every reaction you send moves, for everyone who sees it.',
    perks: [
      { icon: 'magic_button', text: 'React with living, animated emoji' },
      { icon: 'all_inclusive', text: '880+ animated emoji, everywhere' },
      { icon: 'bolt', text: 'Plus 720p streaming, 1.5× VP and no ads' },
    ],
  },
  translate: {
    badge: 'VERGR Lite',
    title: 'Translate any message',
    body: 'In-chat translation is a Lite perk. Upgrade to read every message in your own language, instantly.',
    perks: [
      { icon: 'translate', text: 'One-tap translation in any chat' },
      { icon: 'language', text: 'Auto-detects the language, shows the original' },
      { icon: 'bolt', text: 'Plus 720p streaming, 1.5× VP and no ads' },
    ],
  },
};

export default function AnimatedEmojiUpsell({ emoji = '❤️', variant = 'emoji', onClose }) {
  const navigate = useNavigate();
  const cfg = VARIANTS[variant] || VARIANTS.emoji;

  const goUpgrade = () => {
    onClose?.();
    navigate('/settings/subscription');
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10002] bg-black/70 backdrop-blur-md flex items-end sm:items-center justify-center sm:p-4 pb-[calc(env(safe-area-inset-bottom)+4rem)] sm:pb-4"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClose?.(); }}
    >
      <motion.div
        initial={{ y: 60, opacity: 0, scale: 0.96 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm rounded-t-3xl sm:rounded-3xl overflow-hidden"
        style={{
          background: 'linear-gradient(180deg, #1B1030 0%, #14141F 55%)',
          boxShadow: '0 0 0 1px rgba(180,79,255,0.45), 0 0 40px rgba(123,31,255,0.35), 0 24px 60px rgba(0,0,0,0.6)',
        }}
      >
        {/* Ambient glow behind the hero */}
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(157,78,255,0.35) 0%, rgba(123,31,255,0.12) 45%, transparent 70%)' }} />

        <button onClick={onClose} className="absolute top-3.5 right-3.5 z-10 w-8 h-8 rounded-full bg-white/[0.07] hover:bg-white/[0.14] flex items-center justify-center text-text-secondary hover:text-white transition-colors">
          <Icon name="close" size={16} />
        </button>

        {/* Hero — the feature, alive, over the brand glow */}
        <div className="relative pt-10 pb-2 flex items-end justify-center gap-3">
          {variant === 'translate' ? (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.08 }}
              className="w-24 h-24 rounded-3xl flex items-center justify-center drop-shadow-[0_0_18px_rgba(157,78,255,0.55)]"
              style={{ background: 'linear-gradient(160deg, rgba(157,78,255,0.35), rgba(200,127,255,0.15))', boxShadow: 'inset 0 0 0 1px rgba(180,79,255,0.4)' }}
            >
              <Icon name="translate" size={52} className="text-brand-violet-light" />
            </motion.div>
          ) : (
            <>
              {SUPPORT_EMOJIS.slice(0, 1).map((e) => (
                <motion.div key={e} animate={{ y: [0, -7, 0] }} transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }} className="opacity-80 mb-1.5">
                  <ReactionEmoji emoji={e} size={40} />
                </motion.div>
              ))}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.08 }}
                className="drop-shadow-[0_0_18px_rgba(157,78,255,0.55)]"
              >
                <ReactionEmoji emoji={emoji} size={84} />
              </motion.div>
              {SUPPORT_EMOJIS.slice(1).map((e, i) => (
                <motion.div key={e} animate={{ y: [0, -6, 0] }} transition={{ duration: 2.2 + i * 0.5, repeat: Infinity, ease: 'easeInOut', delay: 0.4 * (i + 1) }} className="opacity-80 mb-1.5">
                  <ReactionEmoji emoji={e} size={40} />
                </motion.div>
              ))}
            </>
          )}
        </div>

        <div className="relative px-6 pb-6 pt-3 text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full mb-3"
            style={{ background: 'rgba(157,78,255,0.14)', boxShadow: 'inset 0 0 0 1px rgba(180,79,255,0.35)' }}>
            <Icon name="workspace_premium" size={14} className="text-brand-violet-light" />
            <span className="text-[11px] font-bold tracking-wide text-brand-violet-light uppercase">{cfg.badge}</span>
          </div>

          <h2 className="font-syne text-[22px] font-extrabold text-white leading-tight mb-1.5">
            {cfg.title}
          </h2>
          <p className="text-[13px] text-text-secondary leading-relaxed mb-5">
            {cfg.body}
          </p>

          <div className="space-y-2.5 mb-6 text-left">
            {cfg.perks.map((p, i) => (
              <motion.div key={p.text}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.08 }}
                className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'linear-gradient(160deg, rgba(157,78,255,0.25), rgba(200,127,255,0.12))', boxShadow: 'inset 0 0 0 1px rgba(180,79,255,0.3)' }}>
                  <Icon name={p.icon} size={16} className="text-brand-violet-light" />
                </div>
                <span className="text-[13px] text-text-primary font-medium">{p.text}</span>
              </motion.div>
            ))}
          </div>

          <motion.button
            onClick={goUpgrade}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            className="w-full py-3.5 rounded-2xl font-syne font-extrabold text-[15px] text-white mb-2.5"
            style={{
              background: 'linear-gradient(135deg, #7B1FFF 0%, #B44FFF 55%, #C87FFF 100%)',
              boxShadow: '0 6px 24px rgba(123,31,255,0.45), inset 0 1px 0 rgba(255,255,255,0.25)',
            }}
          >
            Upgrade from $4.99/mo
          </motion.button>
          <button onClick={onClose} className="w-full py-2 text-[13px] font-medium text-text-muted hover:text-text-secondary transition-colors">
            Maybe later
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
