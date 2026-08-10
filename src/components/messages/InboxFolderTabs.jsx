// Telegram-style inbox folder tabs (horizontal, scrollable, underline active).
// Built-in folders come from INBOX_FOLDERS; user-made custom folders are passed
// in via `customFolders` (persisted on the user doc at settings.chatFolders).
// A folder maps to a `view` (which sections show, unread-only, and an optional
// hand-picked chat-id set) via computeFolderView().
import { useRef } from 'react';
import Icon from '../Icon';

export const INBOX_FOLDERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'dms', label: 'DMs' },
  { id: 'groups', label: 'Groups' },
];

// Built-in scope. Kept tiny + pure.
export function folderScope(id) {
  switch (id) {
    case 'unread': return { dms: true, groups: true, voice: false, unreadOnly: true };
    case 'dms': return { dms: true, groups: false, voice: false, unreadOnly: false };
    case 'groups': return { dms: false, groups: true, voice: false, unreadOnly: false };
    default: return { dms: true, groups: true, voice: true, unreadOnly: false };
  }
}

// Resolve the active folder (built-in id OR custom folder) to a render view.
// Custom folders carry `ids` (a Set of chat ids) to restrict both sections to.
export function computeFolderView(activeId, customFolders = []) {
  const custom = (customFolders || []).find((f) => f.id === activeId);
  if (custom) {
    return { dms: true, groups: true, voice: false, unreadOnly: false, ids: new Set(custom.chatIds || []) };
  }
  return { ...folderScope(activeId), ids: null };
}

function Tab({ label, icon, active, badge, onClick, onLongPress }) {
  const timer = useRef(null);
  const longFired = useRef(false);
  const start = () => {
    if (!onLongPress) return;
    longFired.current = false;
    timer.current = setTimeout(() => { longFired.current = true; onLongPress(); }, 450);
  };
  const stop = () => { if (timer.current) clearTimeout(timer.current); };
  const click = () => { if (!longFired.current) onClick(); };
  return (
    <button
      onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onClick={click}
      onContextMenu={onLongPress ? (e) => { e.preventDefault(); onLongPress(); } : undefined}
      className={`relative shrink-0 px-3.5 py-2 text-[13px] font-bold whitespace-nowrap transition-colors ${
        active ? 'text-brand-violet-light' : 'text-text-muted hover:text-text-secondary active:text-text-secondary'
      }`}
    >
      <span className="flex items-center gap-1.5">
        {icon && <span className="text-[13px] leading-none">{icon}</span>}
        {label}
        {badge > 0 && (
          <span className={`min-w-[16px] h-4 px-1 rounded-full text-[10px] font-black flex items-center justify-center ${
            active ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-muted'
          }`}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      {active && <span className="absolute left-2.5 right-2.5 -bottom-px h-[2.5px] rounded-full bg-brand-violet" />}
    </button>
  );
}

export default function InboxFolderTabs({ active, onChange, counts = {}, customFolders = [], onCreateFolder, onEditFolder }) {
  return (
    <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
      {INBOX_FOLDERS.map((f) => (
        <Tab key={f.id} label={f.label} active={active === f.id} badge={counts[f.id] || 0} onClick={() => onChange(f.id)} />
      ))}
      {(customFolders || []).map((f) => (
        <Tab key={f.id} label={f.name} icon={f.icon} active={active === f.id} badge={counts[f.id] || 0}
          onClick={() => onChange(f.id)} onLongPress={onEditFolder ? () => onEditFolder(f) : undefined} />
      ))}
      {onCreateFolder && (
        <button onClick={onCreateFolder} title="New folder"
          className="shrink-0 px-2.5 py-2 text-text-muted/50 hover:text-brand-violet-light transition-colors" aria-label="New folder">
          <Icon name="add" size={18} />
        </button>
      )}
    </div>
  );
}
