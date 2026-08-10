import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from './Icon';

export default function Modal({ isOpen, onClose, title, children, fullScreen = false }) {
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center" onClick={onClose}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 35, mass: 0.8 }}
            className={`relative w-full max-w-[480px] bg-surface-1 border-t border-white/[0.06] ${
              fullScreen ? 'h-full rounded-none' : 'rounded-t-2xl max-h-[85vh]'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle bar */}
            {!fullScreen && (
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-9 h-1 rounded-full bg-white/[0.08]" />
              </div>
            )}
            {/* Header */}
            {title && (
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
                <h2 className="font-syne text-base font-bold">{title}</h2>
                <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary transition-colors">
                  <Icon name="close" size={18} />
                </button>
              </div>
            )}
            {/* Bottom-anchored sheet: without the safe-area allowance the last
                control (usually the primary button) sits under the Android
                gesture/nav bar and cannot be tapped. */}
            <div
              className="overflow-y-auto p-4"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
            >
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
