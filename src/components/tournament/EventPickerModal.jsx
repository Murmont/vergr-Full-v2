// EventPickerModal — pick one of your ticketed events to share (into a DM,
// group, squad chat, or a go-live setup), or create one.
//
// An event is anything a user wants to host and sell a ticket to: a live show,
// a watch party, a Q&A, a class, a community night. NOT a tournament: no
// competitors, no prize purse, no entry fee. Founder ruling 2026-08-16.
//
// ⚠ This used to dead-end. The empty state said "create one from the tournaments
// tab", and there is no tournaments tab, so a host with no events had nowhere to
// go from here. Every path out of this modal now leads somewhere real.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../Icon';
import { useAuth } from '../../context/AuthContext';
import { getUserTournaments } from '../../firebase/firestore';

export default function EventPickerModal({ isOpen, onClose, onSelect }) {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState(null);

  useEffect(() => {
    if (!isOpen || !currentUser) return;
    let alive = true;
    getUserTournaments(currentUser.uid)
      .then((list) => {
        if (!alive) return;
        // Only events the caller HOSTS can be shared as a ticket: sharing one
        // you merely attend would offer a ticket you do not sell.
        const ticketed = (list || []).filter(
          (t) => t.fundingModel === 'ticketed'
            && ['open', 'active'].includes(t.status)
            && t.adminId === currentUser.uid,
        );
        ticketed.sort((a, b) => (a.scheduledStart || 0) - (b.scheduledStart || 0));
        setEvents(ticketed);
      })
      .catch(() => { if (alive) setEvents([]); });
    return () => { alive = false; };
  }, [isOpen, currentUser]);

  if (!isOpen) return null;

  const goCreate = () => { onClose?.(); navigate('/events/create'); };

  const fmtWhen = (ms) => {
    if (!ms) return null;
    try {
      return new Date(ms).toLocaleString(undefined, {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      });
    } catch { return null; }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-surface-1 border border-white/[0.08] rounded-t-3xl sm:rounded-2xl p-5 max-h-[70vh] flex flex-col sheet-safe">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-syne text-lg font-bold text-white">Share an event</h3>
          <button onClick={onClose} className="text-text-muted hover:text-white"><Icon name="close" size={20} /></button>
        </div>

        {events === null ? (
          <p className="text-text-muted text-sm text-center py-8">Loading your events…</p>
        ) : events.length === 0 ? (
          <div className="text-center py-7">
            <Icon name="confirmation_number" size={32} className="text-text-muted mx-auto mb-2" />
            <p className="text-text-secondary text-sm">You are not hosting any events yet.</p>
            <p className="text-text-muted text-xs mt-1 mb-4 leading-relaxed">
              Host a live show, a watch party, a Q&amp;A, a class, anything.<br />Sell tickets to it in coins.
            </p>
            <button onClick={goCreate}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-violet text-white text-sm font-extrabold hover:bg-brand-violet-light transition-colors">
              <Icon name="add" size={18} /> Create an event
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-2 overflow-y-auto">
              {events.map((t) => {
                const when = fmtWhen(t.scheduledStart);
                const cap = t.ticket?.capacity || 0;
                return (
                  <button key={t.id} onClick={() => onSelect(t)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:border-brand-violet/40 text-left transition-colors">
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-brand-violet/40 to-brand-pink/20 overflow-hidden flex items-center justify-center shrink-0">
                      {t.bannerUrl
                        ? <img src={t.bannerUrl} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                        : <Icon name="confirmation_number" size={18} className="text-white/70" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary text-sm font-bold truncate">{t.name}</p>
                      <p className="text-text-muted text-[11px] truncate">
                        {when ? `${when} · ` : ''}
                        {t.ticket?.priceCoins ? `${t.ticket.priceCoins.toLocaleString()}c` : 'Free'}
                        {cap > 0 ? ` · ${t.ticket?.sold || 0}/${cap}` : ''}
                      </p>
                    </div>
                    <Icon name="chevron_right" size={18} className="text-text-muted shrink-0" />
                  </button>
                );
              })}
            </div>

            {/* Always reachable, not just from the empty state: the second event
                is the one a host is most likely to want next. */}
            <button onClick={goCreate}
              className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-white/15 text-text-secondary text-sm font-bold hover:border-brand-violet/40 hover:text-white transition-colors">
              <Icon name="add" size={18} /> Create another event
            </button>
          </>
        )}
      </div>
    </div>
  );
}
