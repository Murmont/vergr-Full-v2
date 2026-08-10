// ReactorsSheet — "who reacted" list for a message. The reactor uids are already
// stored on the message (reactions = { emoji: [uid, ...] }), so this is purely a
// display: tabs per emoji (+ All) and a list of reactors resolved to their
// avatar + name. Opened by long-pressing a reaction chip (ReactionBubbles).

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import UserAvatar from '../UserAvatar';
import ReactionEmoji from '../ReactionEmoji';
import Icon from '../Icon';

const normalizeUsers = (val) => {
  if (Array.isArray(val)) return val;
  if (typeof val === 'number') return [];
  if (typeof val === 'object' && val !== null) return Object.keys(val);
  return [];
};

export default function ReactorsSheet({ reactions, activeEmoji, resolveUser, onClose }) {
  // [{ emoji, uid }] flat list + per-emoji counts.
  const { entries, tabs } = useMemo(() => {
    const list = [];
    const tabList = [];
    Object.entries(reactions || {}).forEach(([emoji, raw]) => {
      const uids = normalizeUsers(raw).filter((u) => u && u !== 'unknown');
      if (!uids.length) return;
      tabList.push({ emoji, count: uids.length });
      uids.forEach((uid) => list.push({ emoji, uid }));
    });
    return { entries: list, tabs: tabList };
  }, [reactions]);

  const [tab, setTab] = useState(() => (activeEmoji && tabs.some((t) => t.emoji === activeEmoji) ? activeEmoji : 'all'));
  const shown = tab === 'all' ? entries : entries.filter((e) => e.emoji === tab);

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
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div className="flex items-center gap-2 px-4 pt-4 pb-2">
            <span className="text-sm font-bold text-white">Reactions</span>
            <span className="text-xs text-text-muted font-dmmono">{entries.length}</span>
            <button onClick={onClose} className="ml-auto w-8 h-8 rounded-full bg-white/[0.06] text-text-secondary flex items-center justify-center">
              <Icon name="close" size={16} />
            </button>
          </div>

          {/* Emoji tabs */}
          <div className="flex gap-1 px-3 pb-2 overflow-x-auto no-scrollbar">
            <TabBtn active={tab === 'all'} onClick={() => setTab('all')}>All {entries.length}</TabBtn>
            {tabs.map((t) => (
              <TabBtn key={t.emoji} active={tab === t.emoji} onClick={() => setTab(t.emoji)}>
                <ReactionEmoji emoji={t.emoji} size={16} /> {t.count}
              </TabBtn>
            ))}
          </div>

          {/* Reactor list */}
          <div className="max-h-[46vh] overflow-y-auto px-2 pb-3">
            {shown.map(({ uid, emoji }, i) => {
              const u = resolveUser?.(uid) || {};
              return (
                <div key={`${uid}-${emoji}-${i}`} className="flex items-center gap-3 px-2 py-2 rounded-lg">
                  <UserAvatar src={u.avatar} size="sm" />
                  <span className="flex-1 min-w-0 text-sm text-white truncate">
                    {u.displayName || u.username || 'User'}
                  </span>
                  <ReactionEmoji emoji={emoji} size={18} />
                </div>
              );
            })}
            {shown.length === 0 && (
              <div className="text-center text-xs text-text-muted py-6">No reactions</div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap transition-colors ${
        active ? 'bg-brand-violet/30 border border-brand-violet/70 text-white' : 'bg-white/[0.05] border border-white/10 text-text-secondary'
      }`}
    >
      {children}
    </button>
  );
}
