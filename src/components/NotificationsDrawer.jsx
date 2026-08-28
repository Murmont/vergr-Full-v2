import { Fragment, useMemo, useState } from 'react';
import CachedImg from './CachedImg';
import { Dialog, Transition } from '@headlessui/react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../context/NotificationContext';
import { useMergedNotifications } from '../hooks/useMergedNotifications';
import { useUI } from '../context/UIContext';
import Icon from './Icon';
import { timeAgo } from '../utils/helpers';

// Custom .webp icons live in /public/notif-icons/ (sourced from design upload).
// Falls back to Material Symbols for types without a custom icon.
const NOTIF_ICONS = {
  follow:     { icon: 'person_add',       color: 'text-brand-violet-light',   bg: 'bg-brand-violet/15' },
  like:       { icon: 'favorite',         color: 'text-brand-ember',  bg: 'bg-brand-ember/15',  webp: '/notif-icons/like.webp' },
  comment:    { icon: 'chat_bubble',      color: 'text-brand-violet', bg: 'bg-brand-violet/15', webp: '/notif-icons/comment.webp' },
  tip:        { icon: 'monetization_on',  color: 'text-brand-gold',   bg: 'bg-brand-gold/15',   webp: '/notif-icons/coins.webp' },
  vp_level_up:{ icon: 'military_tech',    color: 'text-brand-violet-light', bg: 'bg-brand-violet/15', webp: null },
  coins:      { icon: 'paid',             color: 'text-brand-gold',   bg: 'bg-brand-gold/15',   webp: '/notif-icons/coins.webp' },
  vp:         { icon: 'auto_awesome',     color: 'text-brand-violet', bg: 'bg-brand-violet/15', webp: '/notif-icons/vp.webp' },
  gem_transfer: { icon: 'diamond',       color: 'text-gem-blue',     bg: 'bg-gem-blue/15' },
  security:   { icon: 'security',         color: 'text-brand-ember',  bg: 'bg-brand-ember/15',  webp: '/notif-icons/security.webp' },
  system:     { icon: 'info',             color: 'text-brand-violet-light',   bg: 'bg-brand-violet/15',   webp: '/notif-icons/system.webp' },
  update:     { icon: 'campaign',         color: 'text-brand-violet', bg: 'bg-brand-violet/15', webp: '/notif-icons/system.webp' },
  membership: { icon: 'card_membership',  color: 'text-brand-pink',   bg: 'bg-brand-pink/15' },
  order:      { icon: 'shopping_bag',     color: 'text-brand-violet', bg: 'bg-brand-violet/15' },
  tournament: { icon: 'emoji_events',     color: 'text-brand-gold',   bg: 'bg-brand-gold/15' },
  squad:      { icon: 'shield',           color: 'text-brand-violet-light', bg: 'bg-brand-violet-light/15' },
  squad_invite:            { icon: 'mail',           color: 'text-brand-violet-light', bg: 'bg-brand-violet-light/15' },
  squad_challenge_reward:  { icon: 'military_tech',  color: 'text-brand-gold',   bg: 'bg-brand-gold/15', webp: '/notif-icons/vp.webp' },
  message:     { icon: 'chat',            color: 'text-brand-ember',  bg: 'bg-brand-ember/15' },
  request:     { icon: 'mark_email_unread', color: 'text-brand-gold', bg: 'bg-brand-gold/15' },
  missed_call: { icon: 'call_missed',     color: 'text-success-green', bg: 'bg-success-green/15' },
};

const FILTERS = [
  { id: 'all',      label: 'All',      match: () => true },
  { id: 'messages', label: 'Messages', match: n => ['message','squad','request','missed_call'].includes(n.type) || n._kind === 'squad_message' },
  { id: 'tips',     label: 'Tips',     match: n => ['tip','coins','vp','gem_transfer'].includes(n.type) },
  { id: 'social',   label: 'Social',   match: n => ['follow','like','comment','squad_invite','squad_challenge_reward'].includes(n.type) },
  { id: 'system',   label: 'System',   match: n => ['system','update','security'].includes(n.type) },
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
  const { markRead, markAllRead, unreadNotifCount } = useNotifications();
  const { items: notifications, routeFor } = useMergedNotifications();
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

  const handleNavigate = (notif) => {
    closeDrawer();
    const path = routeFor(notif);
    if (path) navigate(path);
  };

  const handleClick = (notif) => {
    // Synthetic rows (messages / squad / request / call) open their target
    // directly — there's no doc to expand or mark read; they clear when the
    // thread is opened.
    if (notif._kind && notif._kind !== 'doc') { handleNavigate(notif); return; }
    if (!notif.read) markRead(notif.id);
    setExpandedId(expandedId === notif.id ? null : notif.id);
  };

  const hasLink = (notif) => !!routeFor(notif);

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
                                    !notif.read ? 'bg-brand-violet/5 hover:bg-brand-violet/8' : 'hover:bg-surface-1/50'
                                  }`}>
                                  {notif._kind && notif._kind !== 'doc' && notif.senderAvatar ? (
                                    <div className="relative shrink-0 mt-0.5">
                                      <CachedImg src={notif.senderAvatar} permanent alt="" className="w-9 h-9 rounded-full object-cover" />
                                      <span className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full ${style.bg} flex items-center justify-center ring-2 ring-bg-dark`}>
                                        <Icon name={style.icon} size={10} className={style.color} />
                                      </span>
                                    </div>
                                  ) : style.webp ? (
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
                                  {!notif.read && <div className="w-2 h-2 rounded-full bg-brand-violet shrink-0 mt-2" />}
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
                                          className="px-3 py-1.5 rounded-lg bg-brand-violet/10 border border-brand-violet/15 text-brand-violet-light text-xs font-semibold hover:bg-brand-violet/15 transition-colors">
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
