import { useUI } from '../context/UIContext';
import Icon from './Icon';

// Solid fills: a see-through toast shows whatever is scrolling behind it.
const TOAST_STYLES = {
  success: { bg: 'bg-[#1E1035]', icon: 'check_circle', iconColor: 'text-brand-violet-light' },
  error: { bg: 'bg-[#2A1219]', icon: 'error', iconColor: 'text-brand-ember' },
  info: { bg: 'bg-[#1E1035]', icon: 'info', iconColor: 'text-brand-violet-light' },
  coins: { bg: 'bg-[#2A2210]', icon: 'monetization_on', iconColor: 'text-brand-gold' },
};

export default function Toast() {
  const { toast } = useUI();
  if (!toast) return null;

  const style = TOAST_STYLES[toast.type] || TOAST_STYLES.info;

  return (
    // Below the status bar on the phone: top-4 alone put every toast under the
    // clock, because the app draws edge to edge. env() is 0 on web.
    <div className="fixed left-1/2 -translate-x-1/2 z-[100] animate-slide-down max-w-[440px] w-[calc(100%-2rem)]"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}>
      <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl shadow-lg shadow-black/40 ${style.bg}`}>
        <Icon name={style.icon} filled size={22} className={style.iconColor} />
        <p className="text-sm text-text-primary font-medium flex-1">{toast.message}</p>
      </div>
    </div>
  );
}
