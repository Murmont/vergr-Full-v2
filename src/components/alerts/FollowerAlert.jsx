import Icon from '../Icon';
import UserAvatar from '../UserAvatar';

export default function FollowerAlert({ username = 'GhostSniper', tier = 'Gold', onClose }) {
  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 animate-slide-down">
      <div className="bg-surface border border-surface-border rounded-2xl px-4 py-3 flex items-center gap-3 shadow-xl shadow-black/40 min-w-[300px]">
        <UserAvatar username={username} tier={tier} size={36} />
        <div className="flex-1">
          <p className="text-white text-sm font-semibold">@{username}</p>
          <p className="text-text-secondary text-xs">started following you</p>
        </div>
        <button onClick={onClose} className="text-text-secondary"><Icon name="close" size={16} /></button>
      </div>
    </div>
  );
}
