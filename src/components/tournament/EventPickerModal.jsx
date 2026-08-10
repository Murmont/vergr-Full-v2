// EventPickerModal — lets a host pick one of their ticketed events to share
// (into a DM / group / squad chat, or anywhere a ticket card is sent).
// Lists the caller's own tournaments that use the ticketed funding model and
// are still open or live.
import { useState, useEffect } from 'react';
import Icon from '../Icon';
import { useAuth } from '../../context/AuthContext';
import { getUserTournaments } from '../../firebase/firestore';

export default function EventPickerModal({ isOpen, onClose, onSelect }) {
  const { currentUser } = useAuth();
  const [events, setEvents] = useState(null);

  useEffect(() => {
    if (!isOpen || !currentUser) return;
    let alive = true;
    getUserTournaments(currentUser.uid)
      .then((list) => {
        if (!alive) return;
        const ticketed = (list || []).filter(
          (t) => t.fundingModel === 'ticketed' && ['open', 'active'].includes(t.status),
        );
        setEvents(ticketed);
      })
      .catch(() => { if (alive) setEvents([]); });
    return () => { alive = false; };
  }, [isOpen, currentUser]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-surface-1 border border-white/[0.08] rounded-t-3xl sm:rounded-2xl p-5 max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-syne text-lg font-bold text-white">Choose an event</h3>
          <button onClick={onClose} className="text-text-muted hover:text-white"><Icon name="close" size={20} /></button>
        </div>

        {events === null ? (
          <p className="text-text-muted text-sm text-center py-8">Loading your events…</p>
        ) : events.length === 0 ? (
          <div className="text-center py-8">
            <Icon name="confirmation_number" size={32} className="text-text-muted mx-auto mb-2" />
            <p className="text-text-secondary text-sm">You don't have any open ticketed events.</p>
            <p className="text-text-muted text-xs mt-1">Create one from the tournaments tab to sell tickets.</p>
          </div>
        ) : (
          <div className="space-y-2 overflow-y-auto">
            {events.map((t) => (
              <button key={t.id} onClick={() => onSelect(t)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:border-brand-violet/40 text-left transition-colors">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-brand-violet/40 to-brand-pink/20 overflow-hidden flex items-center justify-center shrink-0">
                  {t.bannerUrl
                    ? <img src={t.bannerUrl} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    : <Icon name="emoji_events" size={18} className="text-white/70" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary text-sm font-bold truncate">{t.name}</p>
                  <p className="text-text-muted text-[11px] truncate">
                    {t.game} · {t.ticket?.priceCoins ? `${t.ticket.priceCoins.toLocaleString()}c` : 'Free'} · {t.ticket?.sold || 0}/{t.ticket?.capacity || 0} sold
                  </p>
                </div>
                <Icon name="chevron_right" size={18} className="text-text-muted shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
