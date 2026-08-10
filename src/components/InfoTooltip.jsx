import { useState } from 'react';
import Icon from './Icon';

// Dismissible info box for explaining features
export default function InfoTooltip({ id, icon = 'info', color = '#B44FFF', title, children, dismissible = true, rightImage }) {
  const storageKey = `vergr_tooltip_${id}`;
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(storageKey) === '1'; } catch { return false; }
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(storageKey, '1'); } catch {}
  };

  return (
    <div className="p-3.5 rounded-2xl border mb-3" style={{ background: `${color}08`, borderColor: `${color}25` }}>
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}15` }}>
          <Icon name={icon} size={16} style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          {title && <p className="text-text-primary text-xs font-bold mb-0.5">{title}</p>}
          <div className="text-text-secondary text-[11px] leading-relaxed">{children}</div>
        </div>
        {rightImage && (
          <img src={rightImage} alt="" className="w-16 sm:w-20 h-auto shrink-0 self-center -my-2 pointer-events-none select-none" draggable={false} />
        )}
        {dismissible && (
          <button onClick={handleDismiss} className="text-text-muted hover:text-text-secondary p-0.5 shrink-0">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// Inline help link that navigates to How It Works
export function LearnMoreLink({ section, navigate }) {
  return (
    <button onClick={() => navigate('/settings/how-it-works')}
      className="text-brand-violet-light text-[10px] font-bold hover:underline inline-flex items-center gap-0.5">
      Learn more <Icon name="arrow_forward" size={10} />
    </button>
  );
}
