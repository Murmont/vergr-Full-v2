import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { getBlockedUsers, unblockUser } from '../../firebase/firestore';
import TopBar from '../../components/TopBar';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

export default function BlockedUsersScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);
  const [blocked, setBlocked] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unblocking, setUnblocking] = useState(null);

  const { currentUser } = useAuth();
  const { showToast } = useUI();

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    getBlockedUsers(currentUser.uid)
      .then(setBlocked)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [currentUser]);

  const handleUnblock = async (userId, username) => {
    setUnblocking(userId);
    try {
      await unblockUser(currentUser.uid, userId);
      setBlocked(prev => prev.filter(u => u.id !== userId));
      showToast(`@${username} unblocked`, 'info');
    } catch (err) {
      console.error(err);
      showToast('Failed to unblock', 'error');
    }
    setUnblocking(null);
  };

  return (
    <div className={isDesktop ? "min-h-screen pb-8" : "screen-container min-h-screen pb-8"}>
      <TopBar title="Blocked Users" showBack />
      <div className="px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-surface-3 border-t-brand-violet rounded-full animate-spin" />
          </div>
        ) : blocked.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Icon name="shield" size={48} className="text-text-muted/30 mb-4" />
            <p className="text-text-muted text-sm font-medium">No blocked users</p>
            <p className="text-text-muted/60 text-xs mt-1">Users you block won't be able to message you or see your posts</p>
          </div>
        ) : (
          <div className="space-y-2">
            {blocked.map(user => (
              <div key={user.id} className="flex items-center gap-3 p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
                <UserAvatar src={user.avatar} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{user.displayName || user.username}</p>
                  <p className="text-xs text-text-muted">@{user.username}</p>
                </div>
                <button
                  onClick={() => handleUnblock(user.id, user.username)}
                  disabled={unblocking === user.id}
                  className="px-4 py-1.5 rounded-full bg-surface-2 border border-white/[0.06] text-text-secondary text-xs font-bold hover:bg-surface-3 transition-colors">
                  {unblocking === user.id ? '...' : 'Unblock'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
