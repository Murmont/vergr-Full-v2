import { useNotifications } from '../context/NotificationContext';
import Icon from './Icon';

export default function PushToast() {
  const { toast } = useNotifications();
  if (!toast) return null;

  return (
    <div className="fixed top-4 right-4 z-[60] animate-slide-in-right max-w-sm">
      <div className="flex items-start gap-3 p-4 rounded-2xl bg-surface-1 border border-white/[0.08] backdrop-blur-xl shadow-xl shadow-black/20">
        <div className="w-9 h-9 rounded-xl bg-brand-violet/15 flex items-center justify-center shrink-0">
          <Icon name="notifications_active" size={18} className="text-brand-violet-light" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{toast.title || 'VERGR'}</p>
          {toast.body && <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">{toast.body}</p>}
        </div>
      </div>
    </div>
  );
}
