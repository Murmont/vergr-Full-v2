import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useNotifications } from '../../context/NotificationContext';
import { useMergedNotifications } from '../../hooks/useMergedNotifications';
import TopBar from '../../components/TopBar';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import { timeAgo } from '../../utils/helpers';
import { useLayout } from '../../context/LayoutContext';

const NOTIF_ICONS = {
  like: { icon: 'favorite', color: 'text-brand-ember', bg: 'bg-brand-ember/10' },
  follow: { icon: 'person_add', color: 'text-brand-violet-light', bg: 'bg-brand-violet/10' },
  coins: { icon: 'paid', color: 'text-brand-gold', bg: 'bg-brand-gold/10' },
  vp: { icon: 'auto_awesome', color: 'text-brand-violet', bg: 'bg-brand-violet/10' },
  gem_transfer: { icon: 'diamond', color: 'text-gem-blue', bg: 'bg-gem-blue/10' },
  tip: { icon: 'paid', color: 'text-brand-gold', bg: 'bg-brand-gold/10' },
  squad: { icon: 'groups', color: 'text-brand-violet', bg: 'bg-brand-violet/10' },
  comment: { icon: 'chat_bubble', color: 'text-brand-violet-light', bg: 'bg-brand-violet/10' },
  stream: { icon: 'live_tv', color: 'text-brand-ember', bg: 'bg-brand-ember/10' },
  message: { icon: 'chat', color: 'text-brand-ember', bg: 'bg-brand-ember/10' },
  request: { icon: 'mark_email_unread', color: 'text-brand-gold', bg: 'bg-brand-gold/10' },
  missed_call: { icon: 'call_missed', color: 'text-success-green', bg: 'bg-success-green/10' },
  system: { icon: 'info', color: 'text-brand-violet', bg: 'bg-brand-violet/10' },
};

export default function NotificationsScreen() {
  const { markAllRead, markRead } = useNotifications();
  const { items, routeFor } = useMergedNotifications();
  const navigate = useNavigate();
  const { setRightPanel } = useLayout();
  const loading = items == null;

  // Merged feed (real notifications + synthesized message/squad/request/call
  // rows). Falls back to a welcome row when there's genuinely nothing.
  const notifications = useMemo(() => {
    if (items && items.length > 0) return items;
    return [{
      id: 'welcome-system',
      type: 'system',
      content: 'Welcome to Vergr! Start by following creators or posting your first clip.',
      read: false,
      _ms: Date.now(),
    }];
  }, [items]);

  useEffect(() => {
    setRightPanel(null);
    return () => setRightPanel(null);
  }, [setRightPanel]);

  const handleNotifClick = async (notif) => {
    if (!notif.read && notif._kind === 'doc') markRead(notif.id);
    const path = routeFor(notif);
    if (path) navigate(path);
  };

  return (
    <div className="min-h-screen pb-8">
      <TopBar 
        title="Notifications" 
        showBack 
        actions={
          <button onClick={markAllRead} className="text-text-secondary text-xs font-medium hover:text-text-primary transition-colors">
            Mark all read
          </button>
        } 
      />

      <div className="divide-y divide-white/[0.04]">
        {loading ? (
          <div className="p-8 text-center text-text-muted">
            <div className="w-6 h-6 border-2 border-surface-3 border-t-brand-violet rounded-full animate-spin mx-auto mb-3" />
            <span className="text-xs font-dmmono">Loading</span>
          </div>
        ) : (
          notifications.map((notif, idx) => {
            const style = NOTIF_ICONS[notif.type] || NOTIF_ICONS.system;
            return (
              <motion.button
                key={notif.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(idx * 0.04, 0.4), duration: 0.2 }}
                onClick={() => handleNotifClick(notif)}
                className={`w-full flex items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-surface-1/30 ${!notif.read ? 'bg-brand-violet/[0.02]' : ''}`}
              >
                {notif.senderAvatar ? (
                  <UserAvatar src={notif.senderAvatar} size={40} />
                ) : (
                  <div className={`w-10 h-10 rounded-xl ${style.bg} flex items-center justify-center shrink-0`}>
                    <Icon name={style.icon} filled size={20} className={style.color} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {/* `notif.title` was never read here, and the title is the
                      part carrying the meaning: a quest claim writes
                      title "+300 VP earned!" and body "Profile banner", so the
                      page showed "Profile banner" with a coin icon and no
                      amount (audit A38). NotificationsDrawer already resolves it
                      the right way round; the two surfaces disagreed about the
                      same notification, which is how this survived. */}
                  <p className={`text-sm leading-relaxed ${!notif.read ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
                    {notif.senderName && <span className="font-bold text-white">{notif.senderName} </span>}
                    {notif.title || notif.content || 'Notification'}
                  </p>
                  {(notif.body || (notif.title && notif.content)) && (
                    <p className="text-text-secondary text-xs mt-0.5 leading-snug">
                      {notif.body || notif.content}
                    </p>
                  )}
                  <p className="text-text-muted text-xs mt-1 font-dmmono">
                    {timeAgo(notif._ms ? new Date(notif._ms) : (notif.createdAt?.toDate ? notif.createdAt.toDate() : notif.createdAt))}
                  </p>
                </div>
                {!notif.read && (
                  <div className="w-2 h-2 bg-brand-violet rounded-full mt-2 shrink-0" />
                )}
              </motion.button>
            );
          })
        )}
      </div>
    </div>
  );
}