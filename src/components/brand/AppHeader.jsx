// Top-of-page header for redesigned screens.
//   [Title + subtitle]                     [search] [VC chip] [VP chip] [bell] [avatar]
//
// Responsive: hides the wallet chips on narrow widths.
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { useNotifications } from '../../context/NotificationContext';
import { useUI } from '../../context/UIContext';
import Icon from '../Icon';
import UserAvatar from '../UserAvatar';
import WalletChip from './WalletChip';
import UserName from '../UserName';

export default function AppHeader({ title, subtitle, actions, showSearch = true }) {
  const navigate = useNavigate();
  const { profile, wallet } = useUser();
  const { unreadCount } = useNotifications();
  const { setNotificationsDrawerOpen } = useUI();

  const vc = wallet?.balance ?? wallet?.coins ?? 0;
  const vp = wallet?.vp ?? profile?.vp ?? 0;

  return (
    <header className="flex items-center gap-3 py-5 px-6 border-b border-white/[0.04]">
      <div className="flex-1 min-w-0">
        {title && (
          <h1 className="font-syne text-2xl md:text-[28px] font-extrabold tracking-tight text-text-primary leading-tight">
            {title}
          </h1>
        )}
        {subtitle && (
          <p className="text-text-muted text-sm mt-0.5">{subtitle}</p>
        )}
      </div>

      {actions}

      {showSearch && (
        <div className="hidden md:flex items-center gap-2 w-64 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06] focus-within:border-brand-violet/40 transition-colors">
          <Icon name="search" size={16} className="text-text-muted" />
          <input
            type="text"
            placeholder="Search"
            className="flex-1 bg-transparent outline-none text-sm text-text-primary placeholder-text-muted"
          />
        </div>
      )}

      <WalletChip type="vc" amount={vc} />
      <WalletChip type="vp" amount={vp} />

      <button
        onClick={() => setNotificationsDrawerOpen(true)}
        className="relative w-9 h-9 rounded-full bg-white/[0.04] border border-white/[0.06] text-text-secondary flex items-center justify-center hover:text-text-primary hover:bg-white/[0.08]"
        title="Notifications"
      >
        <Icon name="notifications" size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-brand-ember rounded-full text-[10px] flex items-center justify-center font-bold text-white px-1">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <button
        onClick={() => navigate('/profile')}
        className="shrink-0"
        title={profile?.displayName || 'Profile'}
      >
        <UserAvatar src={profile?.avatar || profile?.photoURL} size={36} isVerified={profile?.isVerified} />
      </button>
    </header>
  );
}
