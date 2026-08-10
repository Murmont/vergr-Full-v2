import { motion, AnimatePresence } from 'framer-motion';
import Icon from './Icon';

/**
 * MessageStatus - Shows delivery status with crossfade transitions.
 * - sending: clock icon
 * - sent: single check  
 * - delivered: double check, muted
 * - read: double check, cyan (crossfades from muted)
 */
export default function MessageStatus({ status = 'sent', read = false }) {
  const getState = () => {
    if (status === 'sending') return 'sending';
    if (read) return 'read';
    if (status === 'delivered') return 'delivered';
    return 'sent';
  };

  const state = getState();

  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={state}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ duration: 0.12 }}
        className="inline-flex"
      >
        {state === 'sending' && <Icon name="schedule" size={13} className="text-text-muted/40" />}
        {state === 'sent' && <Icon name="done" size={13} className="text-text-muted/40" />}
        {state === 'delivered' && <Icon name="done_all" size={13} className="text-text-muted/50" />}
        {state === 'read' && <Icon name="done_all" size={13} className="text-brand-violet-light" />}
      </motion.span>
    </AnimatePresence>
  );
}