// Create / edit a custom inbox folder (Telegram-style). A folder is a named,
// icon-tagged, hand-picked set of conversations. Persisted on the user doc at
// settings.chatFolders (see MessagesInboxScreen/NativeMessageScreens saveFolder).
// Rendered as a bottom sheet on mobile, lifted clear of the bottom nav.
import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import Icon from '../Icon';
import UserAvatar from '../UserAvatar';
import { chatPartner } from '../../utils/chatIdentity';

const FOLDER_ICONS = ['📁', '🎮', '👥', '⭐', '🔥', '💬', '🏆', '🎯', '❤️', '🎧', '🌟', '🚀'];
const newId = () => (crypto?.randomUUID ? crypto.randomUUID() : `f_${Date.now().toString(36)}`);

export default function ChatFolderEditor({ folder, conversations = [], liveUsers = {}, viewerProfile, me, onSave, onDelete, onClose }) {
  const editing = !!folder;
  const [name, setName] = useState(folder?.name || '');
  const [icon, setIcon] = useState(folder?.icon || '📁');
  const [ids, setIds] = useState(() => new Set(folder?.chatIds || []));
  const [q, setQ] = useState('');

  // Real conversations to pick from (Saved Messages excluded).
  const rows = useMemo(() => (conversations || [])
    .filter((c) => !c.isSaved)
    .map((c) => {
      const { name, avatar } = chatPartner(c, me, viewerProfile, liveUsers);
      return { id: c.id, name, avatar, isGroup: c.isGroup };
    }), [conversations, liveUsers, viewerProfile, me]);

  const shown = q.trim() ? rows.filter((r) => r.name?.toLowerCase().includes(q.toLowerCase())) : rows;

  const toggle = (id) => setIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave({ id: folder?.id || newId(), name: trimmed, icon, chatIds: [...ids] });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10001] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 pb-[calc(var(--vg-safe-b,0px)+4rem)] sm:pb-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 60, opacity: 0.6 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-surface-1 border border-white/[0.08] rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col max-h-[80vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-white/[0.06]">
          <button onClick={onClose} className="text-text-muted hover:text-white text-sm font-medium">Cancel</button>
          <h2 className="font-syne text-[15px] font-bold text-text-primary">{editing ? 'Edit folder' : 'New folder'}</h2>
          <button onClick={save} disabled={!name.trim()} className={`text-sm font-bold ${name.trim() ? 'text-brand-violet-light' : 'text-text-muted/40'}`}>Save</button>
        </div>

        {/* Name + icon */}
        <div className="px-4 pt-3">
          <div className="flex items-center gap-2.5">
            <div className="w-11 h-11 rounded-xl bg-surface-2 border border-white/[0.06] flex items-center justify-center text-2xl shrink-0">{icon}</div>
            <input
              autoFocus={!editing} value={name} onChange={(e) => setName(e.target.value)} maxLength={24}
              placeholder="Folder name"
              className="flex-1 bg-surface-2 border border-white/[0.06] rounded-xl px-3 py-2.5 text-text-primary text-sm outline-none focus:border-brand-violet"
            />
          </div>
          <div className="flex items-center gap-1.5 mt-2.5 overflow-x-auto no-scrollbar pb-0.5">
            {FOLDER_ICONS.map((e) => (
              <button key={e} onClick={() => setIcon(e)}
                className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-lg transition-colors ${
                  icon === e ? 'bg-brand-violet/20 ring-1 ring-brand-violet' : 'bg-surface-2 hover:bg-surface-3'
                }`}>
                {e}
              </button>
            ))}
          </div>
        </div>

        {/* Chat picker */}
        <div className="px-4 pt-3 pb-1">
          <p className="text-[10px] font-dmmono uppercase tracking-[0.16em] text-text-muted mb-1.5">
            Included chats · {ids.size}
          </p>
          <label className="block relative">
            <Icon name="search" size={16} className="absolute inset-y-0 left-2.5 my-auto h-4 text-text-muted pointer-events-none" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats…"
              className="w-full bg-surface-2 border border-white/[0.06] rounded-lg py-2 pl-8 pr-3 text-sm text-text-primary outline-none focus:border-brand-violet" />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar px-2 pb-3">
          {shown.length === 0 ? (
            <p className="text-center text-text-muted text-sm py-8">No chats found</p>
          ) : shown.map((r) => {
            const on = ids.has(r.id);
            return (
              <button key={r.id} onClick={() => toggle(r.id)}
                className="w-full flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-surface-2/60 text-left">
                <UserAvatar src={r.avatar} size={40} isGroup={r.isGroup} />
                <span className="flex-1 min-w-0 truncate text-[14px] font-medium text-text-primary">{r.name}</span>
                <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                  on ? 'bg-brand-violet text-white' : 'border border-white/20'
                }`}>
                  {on && <Icon name="check" size={14} />}
                </span>
              </button>
            );
          })}
        </div>

        {/* Delete (edit mode only) */}
        {editing && (
          <div className="px-4 py-3 border-t border-white/[0.06]">
            <button onClick={() => onDelete(folder.id)}
              className="w-full py-2.5 rounded-xl text-brand-ember text-sm font-bold hover:bg-brand-ember/10 transition-colors">
              Delete folder
            </button>
          </div>
        )}
      </motion.div>
    </div>,
    document.body
  );
}
