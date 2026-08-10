import { useNavigate } from 'react-router-dom';
import Icon from './Icon';
export default function UpgradeModal({ isOpen, onClose, feature = 'this feature' }) {
  const navigate = useNavigate();
  if (!isOpen) return null;
  return (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
    <div className="bg-surface-1 border border-white/[0.06] rounded-2xl w-full max-w-sm mx-4 p-6 text-center" onClick={e => e.stopPropagation()}>
      <Icon name="workspace_premium" size={40} className="text-brand-gold mx-auto mb-3" />
      <h3 className="font-syne text-lg font-bold mb-2">Upgrade Required</h3>
      <p className="text-text-secondary text-sm mb-5">Upgrade to Lite or Pro to access {feature}.</p>
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-surface-2 text-text-secondary text-sm font-bold">Later</button>
        <button onClick={() => { onClose(); navigate('/settings/subscription'); }} className="flex-1 py-2.5 rounded-xl bg-brand-violet text-white text-sm font-bold">Upgrade</button>
      </div>
    </div>
  </div>);
}
