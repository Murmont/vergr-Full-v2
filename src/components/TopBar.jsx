import { useNavigate } from 'react-router-dom';
import Icon from './Icon';
import { CoinIcon } from './CoinIcon';
import { IS_NATIVE_BUILD } from '../utils/platform';

export default function TopBar({
  title,
  showBack = false,
  actions,
  transparent = false,
  showWallet = false,
  balance = 0
}) {
  const navigate = useNavigate();

  // Native top-bar rule (founder): breathing room above so the title doesn't
  // hug the status bar. The Android status bar overlays the WebView, so add the
  // safe-area inset + an 8px buffer on the native build (0 on web/desktop).
  const nativeBarStyle = IS_NATIVE_BUILD
    ? { minHeight: 'calc(52px + env(safe-area-inset-top, 0px))', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }
    : undefined;

  return (
    <header
      style={nativeBarStyle}
      className={`sticky top-0 z-40 flex items-center justify-between px-4 ${IS_NATIVE_BUILD ? '' : 'h-[52px]'} ${
      transparent ? 'bg-transparent' : 'glass-header'
    }`}>
      <div className="flex items-center gap-3">
        {showBack && (
          <button
            onClick={() => navigate(-1)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors active:scale-95"
          >
            <Icon name="arrow_back" size={20} />
          </button>
        )}
        {title && (
          <h1 className="font-syne text-[17px] font-bold text-text-primary">{title}</h1>
        )}
      </div>
      
      <div className="flex items-center gap-2">
        {showWallet && (
          <button 
            onClick={() => navigate('/wallet')} 
            className="flex items-center gap-1.5 bg-surface-2 px-3 py-1.5 rounded-full hover:bg-surface-3 transition-colors"
          >
            <CoinIcon size={14} />
            <span className="text-xs font-bold text-text-primary font-dmmono">{balance.toLocaleString()}</span>
          </button>
        )}
        {actions && <div className="flex items-center gap-1.5">{actions}</div>}
      </div>
    </header>
  );
}
