import { Fragment, useMemo, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../context/NotificationContext';
import { useUI } from '../context/UIContext';
import Icon from './Icon';
import { timeAgo } from '../utils/helpers';

// Custom .webp icons live in /public/notif-icons/ (sourced from design upload).
// Falls back to Material Symbols for types without a custom icon.
const NOTIF_ICONS = {
  follow:     { icon: 'person_add',       color: 'text-brand-cyan',   bg: 'bg-brand-cyan/15' },
  like:       { icon: 'favorite',         color: 'text-brand-ember',  bg: 'bg-brand-ember/15',  webp: '/notif-icons/like.webp' },
  comment:    { icon: 'chat_bubble',      color: 'text-brand-violet', bg: 'bg-brand-violet/15', webp: '/notif-icons/comment.webp' },
  tip:        { icon: 'monetization_on',  color: 'text-brand-gold',   bg: 'bg-brand-gold/15',   webp: '/notif-icons/coins.webp' },
  coins:      { icon: 'paid',             color: 'text-brand-gold',   bg: 'bg-brand-gold/15',   webp: '/notif-icons/coins.webp' },
  vp:         { icon: 'auto_awesome',     color: 'text-brand-violet', bg: 'bg-brand-violet/15', webp: '/notif-icons/vp.webp' },
  security:   { icon: 'security',         color: 'text-brand-ember',  bg: 'bg-brand-ember/15',  webp: '/notif-icons/security.webp' },
  system:     { icon: 'info',             color: 'text-brand-cyan',   bg: 'bg-brand-cyan/15',   webp: '/notif-icons/system.webp' },
  update:     { icon: 'campaign',         color: 'text-brand-violet', bg: 'bg-brand-violet/15', webp: '/notif-icons/system.webp' },
  membership: { icon: 'card_membership',  color: 'text-brand-pink',   bg: 'bg-brand-pink/15' },
  order:      { icon: 'shopping_bag',     color: 'text-brand-violet', bg: 'bg-brand-violet/15' },
  tournament: { icon: 'emoji_events',     color: 'text-brand-gold',   bg: 'bg-brand-gold/15' },
  squad:      { icon: 'shield',           color: 'text-brand-cyan',   bg: 'bg-brand-cyan/15' },
  message:    { icon: 'chat',             color: 'text-brand-violet', bg: 'bg-brand-violet/15' },
};

const FILTERS = [
  { id: 'all',     label: 'All',     match: () => true },
  { id: 'tips',    label: 'Tips',    match: n => ['tip','coins','vp'].includes(n.type) },
  { id: 'social',  label: 'Social',  match: n => ['follow','like','comment','message','squad'].includes(n.type) },
  { id: 'system',  label: 'System',  match: n => ['system','update','security'].includes(n.type) },
];

function bucketLabel(ts) {
  if (!ts) return 'Earlier';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return 'Earlier';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return 'Today';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if ((now - d) / (1000 * 60 * 60 * 24) < 7) return 'This Week';
  return 'Earlier';
}

export default function NotificationsDrawer() {
  const { notificationsDrawerOpen, setNotificationsDrawerOpen } = useUI();
  const { notifications, markRead, markAllRead, unreadNotifCount } = useNotifications();
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState(null);
  const [filterId, setFilterId] = useState('all');

  const closeDrawer = () => { setNotificationsDrawerOpen(false); setExpandedId(null); setFilterId('all'); };
  const getStyle = (type) => NOTIF_ICONS[type] || NOTIF_ICONS.system;

  const activeFilter = FILTERS.find(f => f.id === filterId) || FILTERS[0];
  const filtered = useMemo(() => notifications.filter(activeFilter.match), [notifications, activeFilter]);

  // Group by bucket while preserving order
  const grouped = useMemo(() => {
    const out = [];
    let lastBucket = null;
    for (const n of filtered) {
      const b = bucketLabel(n.createdAt);
      if (b !== lastBucket) { out.push({ bucket: b, items: [] }); lastBucket = b; }
      out[out.length - 1].items.push(n);
    }
    return out;
  }, [filtered]);

  const formatDate = (ts) => {
    if (!ts) return '';
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    return isNaN(d.getTime()) ? '' : timeAgo(d);
  };

  const handleClick = (notif) => {
    if (!notif.read) markRead(notif.id);
    setExpandedId(expandedId === notif.id ? null : notif.id);
  };

  const handleNavigate = (notif) => {
    closeDrawer();
    const postId = notif.postId || notif.data?.postId;
    const userId = notif.senderId || notif.userId || notif.data?.senderId;
    const squadId = notif.squadId || notif.data?.squadId;
    const orderId = notif.data?.orderId;
    if (postId) navigate(`/post/${postId}`);
    else if (orderId) navigate(`/orders/${orderId}`);
    else if (squadId) navigate(`/squads/${squadId}`);
    else if (userId) navigate(`/user/${userId}`);
    else if (notif.actionUrl) navigate(notif.actionUrl);
  };

  const hasLink = (notif) => !!(notif.postId || notif.data?.postId || notif.senderId || notif.data?.senderId || notif.squadId || notif.data?.squadId || notif.data?.orderId || notif.actionUrl);

  return (
    <Transition show={notificationsDrawerOpen} as={Fragment}>
      <Dialog onClose={closeDrawer} className="relative z-50">
        <Transition.Child as={Fragment}
          enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0">
          <div className="fixed inset-0 bg-black/50" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
              <Transition.Child as={Fragment}
                enter="transform transition ease-in-out duration-300" enterFrom="translate-x-full" enterTo="translate-x-0"
                leave="transform transition ease-in-out duration-300" leaveFrom="translate-x-0" leaveTo="translate-x-full">
                <Dialog.Panel className="pointer-events-auto w-screen max-w-md">
                  <div className="flex h-full flex-col bg-bg-dark border-l border-white/[0.04] shadow-xl">
                    {/* Header */}
                    <div className="px-4 py-3.5 glass-header sticky top-0 z-10">
                      <div className="flex items-center justify-between">
                        <Dialog.Title className="flex items-center gap-2">
                          <span className="text-base font-syne font-bold text-text-primary">Notifications</span>
                          {unreadNotifCount > 0 && (
                            <span className="text-[10px] bg-brand-ember px-2 py-0.5 rounded-full font-bold text-white">
                              {unreadNotifCount}
                            </span>
                          )}
                        </Dialog.Title>
                        <div className="flex items-center gap-2">
                          {unreadNotifCount > 0 && (
                            <button onClick={markAllRead}
                              className="text-text-secondary text-xs font-medium hover:text-text-primary transition-colors px-2 py-1 rounded-lg hover:bg-surface-2/50">
                              Mark all read
                            </button>
                          )}
                          <button onClick={closeDrawer} className="text-text-muted hover:text-text-primary p-1 transition-colors">
                            <Icon name="close" size={20} />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Filter pills */}
                    <div className="px-4 pt-2 pb-2.5 border-b border-white/[0.04] flex items-center gap-1.5 overflow-x-auto">
                      {FILTERS.map(f => {
                        const active = filterId === f.id;
                        return (
                          <button
                            key={f.id}
                            onClick={() => setFilterId(f.id)}
                            className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                              active
                                ? 'bg-brand-violet/20 text-brand-violet border border-brand-violet/30'
                                : 'bg-surface-1/40 text-text-muted border border-white/[0.04] hover:text-text-secondary'
                            }`}
                          >
                            {f.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* List */}
                    <div className="flex-1 overflow-y-auto">
                      {filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-text-muted">
                          <Icon name="notifications_none" size={48} className="mb-4 opacity-20" />
                          <p className="text-sm">{notifications.length === 0 ? 'No notifications yet' : `No ${activeFilter.label.toLowerCase()} notifications`}</p>
                          <p className="text-xs text-text-muted/50 mt-1">You'll see updates here</p>
                        </div>
                      ) : (
                        <div>
                          {grouped.map(group => (
                            <div key={group.bucket}>
                              <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-widest font-bold text-text-muted/70">
                                {group.bucket}
                              </div>
                              {group.items.map((notif) => {
                            const style = getStyle(notif.type);
                            const title = notif.title || notif.content || 'Notification';
                            const body = notif.body || '';
                            const isExpanded = expandedId === notif.id;

                            return (
                              <div key={notif.id}>
                                <button onClick={() => handleClick(notif)}
                                  className={`w-full px-4 py-3 text-left transition-colors flex items-start gap-3 ${
                                    !notif.read ? 'bg-brand-cyan/5 hover:bg-brand-cyan/8' : 'hover:bg-surface-1/50'
                                  }`}>
                                  {style.webp ? (
                                    <img src={style.webp} alt="" className="w-9 h-9 object-contain shrink-0 mt-0.5" />
                                  ) : (
                                    <div className={`w-9 h-9 rounded-xl ${style.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                                      <Icon name={style.icon} size={18} className={style.color} />
                                    </div>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className={`text-sm leading-snug ${!notif.read ? 'text-white font-semibold' : 'text-text-primary'}`}>
                                      {title}
                                    </p>
                                    {body && !isExpanded && (
                                      <p className="text-xs text-text-secondary mt-0.5 line-clamp-1">{body}</p>
                                    )}
                                    <p className="text-[10px] text-text-muted font-dmmono mt-1">{formatDate(notif.createdAt)}</p>
                                  </div>
                                  {!notif.read && <div className="w-2 h-2 rounded-full bg-brand-cyan shrink-0 mt-2" />}
                                </button>

                                {isExpanded && (
                                  <div className="px-4 pb-3 pl-16 border-b border-white/[0.03] bg-surface-1/20">
                                    {body && <p className="text-sm text-text-secondary mb-3">{body}</p>}
                                    {notif.data?.amount && (
                                      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-gold/10 border border-brand-gold/15 mb-3">
                                        <span className="text-brand-gold text-xs font-dmmono font-bold">+{notif.data.amount} coins</span>
                                      </div>
                                    )}
                                    <div className="flex gap-2">
                                      {hasLink(notif) && (
                                        <button onClick={() => handleNavigate(notif)}
                                          className="px-3 py-1.5 rounded-lg bg-brand-cyan/10 border border-brand-cyan/15 text-brand-cyan text-xs font-semibold hover:bg-brand-cyan/15 transition-colors">
                                          View
                                        </button>
                                      )}
                                      {!notif.read && (
                                        <button onClick={(e) => { e.stopPropagation(); markRead(notif.id); }}
                                          className="px-3 py-1.5 rounded-lg bg-surface-2 border border-white/[0.06] text-text-muted text-xs font-semibold hover:text-text-secondary transition-colors">
                                          Mark read
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
