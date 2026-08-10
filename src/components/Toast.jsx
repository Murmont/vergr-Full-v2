import { useUI } from '../context/UIContext';
import Icon from './Icon';

const TOAST_STYLES = {
  success: { bg: 'bg-brand-violet/10 border-brand-violet/30', icon: 'check_circle', iconColor: 'text-brand-violet-light' },
  error: { bg: 'bg-brand-ember/10 border-brand-ember/30', icon: 'error', iconColor: 'text-brand-ember' },
  info: { bg: 'bg-brand-violet/10 border-brand-violet/30', icon: 'info', iconColor: 'text-brand-violet' },
  coins: { bg: 'bg-brand-gold/10 border-brand-gold/30', icon: 'monetization_on', iconColor: 'text-brand-gold' },
};

export default function Toast() {
  const { toast } = useUI();
  if (!toast) return null;

  const style = TOAST_STYLES[toast.type] || TOAST_STYLES.info;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] animate-slide-down max-w-[440px] w-[calc(100%-2rem)]">
      <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border backdrop-blur-xl ${style.bg}`}>
        <Icon name={style.icon} filled size={22} className={style.iconColor} />
        <p className="text-sm text-text-primary font-medium flex-1">{toast.message}</p>
      </div>
    </div>
  );
}
