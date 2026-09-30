// EventTicketCard — spectator-ticket purchase widget for ticketed tournaments.
// Reused on the tournament lobby, the public /e/:id landing page, the go-live
// widget, and inline chat ticket cards. Renders nothing for non-ticketed events.
//
// variant:
//   'default'  — lobby / go-live card (price + bar + buy)
//   'landing'  — rich right-rail card for /e/:id (feature list when signed-out,
//                buying-as breakdown when signed-in, compete-for-free link)
//   'compact'  — tight padding for embeds
//
// LEGAL INVARIANT mirror: competitors can't buy tickets (server rejects it);
// this card hides the buy CTA for competitors and shows a neutral note.
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../Icon';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useUser } from '../../context/UserContext';
import { purchaseEventTicket, getEventTicketStatus, getTournament } from '../../firebase/firestore';

const LANDING_PERKS = [
  { icon: 'live_tv', label: 'Watch the event live' },
  { icon: 'volunteer_activism', label: 'Support the host directly' },
  { icon: 'bolt', label: 'Earn closer-watcher XP' },
];

export default function EventTicketCard({
  tournament, source = 'direct', variant = 'default', meta = null, onView, onPurchased,
}) {
  const { currentUser } = useAuth();
  const { wallet, profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [fetchedMeta, setFetchedMeta] = useState(null);
  const [busy, setBusy] = useState(false);

  const tid = tournament?.id;
  useEffect(() => {
    if (!tid) return;
    let alive = true;
    getEventTicketStatus(tid).then((s) => { if (alive) setStatus(s); }).catch(() => {});
    // Chat cards persist only the event id (relay strips nested objects), so
    // backfill name/game/banner for the header when they're missing.
    if (variant === 'chat' && (!meta?.game || !meta?.bannerUrl)) {
      getTournament(tid).then((t) => {
        if (alive && t) setFetchedMeta({ name: t.name, game: t.game, bannerUrl: t.bannerUrl || null });
      }).catch(() => {});
    }
    return () => { alive = false; };
  }, [tid, variant]); // eslint-disable-line

  if (!tournament || tournament.fundingModel !== 'ticketed') return null;

  const price = Number(status?.priceCoins ?? tournament?.ticket?.priceCoins ?? 0);
  const sold = Number(status?.sold ?? tournament?.ticket?.sold ?? 0);
  const capacity = Number(status?.capacity ?? tournament?.ticket?.capacity ?? 0);
  const soldOut = capacity > 0 && sold >= capacity;
  const hasTicket = !!status?.hasTicket;
  const isCompetitor = !!status?.isCompetitor;
  const balance = wallet?.balance ?? 0;
  const insufficient = price > 0 && balance < price;
  const pct = capacity > 0 ? Math.min(100, Math.round((sold / capacity) * 100)) : 0;
  const isLanding = variant === 'landing';
  const compact = variant === 'compact';

  const buy = async () => {
    if (!currentUser) { navigate('/login'); return; }
    setBusy(true);
    try {
      const r = await purchaseEventTicket({ tournamentId: tid, source });
      showToast(price > 0 ? 'Ticket purchased — enjoy the event!' : 'You\'re on the list!', 'success');
      setStatus((s) => ({ ...(s || {}), hasTicket: true, sold: (s?.sold ?? sold) + 1 }));
      onPurchased?.(r);
    } catch (e) {
      showToast(e?.message || 'Could not buy ticket', 'error');
    }
    setBusy(false);
  };

  const priceLabel = price > 0 ? `${price.toLocaleString()} coins` : 'Free';
  const progressBar = capacity > 0 && (
    <div className={isLanding ? 'mb-4' : 'mb-3'}>
      <div className="flex justify-between text-[11px] text-text-muted mb-1">
        <span>{sold.toLocaleString()} / {capacity.toLocaleString()} sold</span>
        {soldOut && <span className="text-brand-ember font-bold">Sold out</span>}
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
        <div className="h-full bg-gradient-to-r from-brand-violet to-brand-violet transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );

  // Shared CTA region (buy / owned / sold-out / competitor / signed-out).
  const cta = (() => {
    if (hasTicket) {
      return (
        <div className="py-2.5 rounded-xl bg-brand-violet/10 border border-brand-violet/30 text-brand-violet-light text-center text-sm font-bold flex items-center justify-center gap-2">
          <Icon name="check_circle" size={18} /> You have a ticket
        </div>
      );
    }
    if (isCompetitor) {
      return <p className="text-text-muted text-[11px] text-center py-2">You're part of this event.</p>;
    }
    if (soldOut) {
      return <div className="py-2.5 rounded-xl bg-surface-2 border border-white/[0.06] text-text-muted text-center text-sm font-bold">Sold out</div>;
    }
    if (!currentUser) {
      return (
        <button onClick={() => navigate('/login')}
          className="w-full py-3 rounded-xl bg-brand-violet text-white font-bold text-sm hover:brightness-110 active:scale-[0.98] transition-all">
          Sign in to buy
        </button>
      );
    }
    return (
      <>
        <button onClick={buy} disabled={busy || insufficient}
          className="w-full py-3 rounded-xl bg-brand-violet text-white font-bold text-sm hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-50">
          {busy ? 'Processing…' : price > 0 ? `Buy ticket — ${price.toLocaleString()}c` : 'Get free ticket'}
        </button>
        {price > 0 && (
          <p className="text-text-muted text-[10px] text-center mt-2">
            Balance: <span className="text-brand-gold font-dmmono">{balance.toLocaleString()}c</span>
            {insufficient && <span className="text-brand-ember ml-1">— insufficient</span>}
          </p>
        )}
      </>
    );
  })();

  if (isLanding) {
    return (
      <div className="rounded-2xl bg-surface-1 border border-white/[0.08] overflow-hidden">
        <div className="p-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Icon name="confirmation_number" size={18} className="text-brand-violet-light" />
            <span className="text-[10px] font-dmmono uppercase tracking-[0.16em] text-text-muted">Event Ticket</span>
          </div>
          <p className="text-text-muted text-xs mt-1">Watch live. Support the host.</p>
        </div>
        <div className="p-4">
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-3xl font-syne font-extrabold text-white">{price > 0 ? price.toLocaleString() : 'Free'}</span>
            {price > 0 && <span className="text-text-muted text-sm">coins</span>}
          </div>
          {progressBar}

          {!hasTicket && !isCompetitor && !soldOut && (
            <ul className="space-y-2 mb-4">
              {LANDING_PERKS.map(p => (
                <li key={p.icon} className="flex items-center gap-2.5 text-sm text-text-secondary">
                  <Icon name={p.icon} size={16} className="text-brand-violet-light" /> {p.label}
                </li>
              ))}
            </ul>
          )}

          {currentUser && !hasTicket && !isCompetitor && !soldOut && (
            <div className="mb-3 p-3 rounded-xl bg-bg-dark/50 border border-white/[0.06] space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-text-muted">Buying as</span>
                <span className="text-text-primary font-semibold">@{profile?.username || 'you'}</span>
              </div>
              {price > 0 && (
                <div className="flex justify-between text-[11px]">
                  <span className="text-text-muted">Balance after</span>
                  <span className={`font-dmmono ${insufficient ? 'text-brand-ember' : 'text-text-secondary'}`}>{Math.max(0, balance - price).toLocaleString()}c</span>
                </div>
              )}
            </div>
          )}

          {cta}

          <p className="text-text-muted text-[10px] text-center mt-3 flex items-center justify-center gap-1">
            <Icon name="lock" size={11} /> Secure checkout · coins held by VERGR
          </p>
        </div>
      </div>
    );
  }

  // Chat-embedded card (DM / group / squad). `meta` carries denormalized
  // display fields captured at send time so it renders without a fetch;
  // status/price still refresh live via getEventTicketStatus.
  if (variant === 'chat') {
    const d = { ...(fetchedMeta || {}), ...(meta || {}) };
    return (
      <div className="rounded-2xl bg-surface-1 border border-brand-violet/25 overflow-hidden w-[260px] max-w-full">
        <div className="h-20 relative bg-gradient-to-br from-brand-violet/40 to-brand-pink/20">
          {d.bannerUrl && (
            <img src={d.bannerUrl} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          )}
          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-bg-dark/70 text-brand-violet-light text-[9px] font-bold uppercase tracking-wider flex items-center gap-1">
            <Icon name="confirmation_number" size={11} /> Ticket
          </span>
        </div>
        <div className="p-3">
          <p className="text-text-primary text-sm font-bold leading-tight truncate">{d.name || 'Event'}</p>
          <p className="text-text-muted text-[11px] mb-2 truncate">{[d.game, d.hostName && `by ${d.hostName}`].filter(Boolean).join(' · ')}</p>
          <div className="flex items-center justify-between mb-2">
            <span className="text-brand-violet-light font-dmmono font-bold text-sm tabular-nums">{priceLabel}</span>
            {capacity > 0 && <span className="text-text-muted text-[10px]">{sold.toLocaleString()}/{capacity.toLocaleString()} sold</span>}
          </div>
          {capacity > 0 && (
            <div className="h-1 rounded-full bg-white/[0.08] overflow-hidden mb-2.5">
              <div className="h-full bg-gradient-to-r from-brand-violet to-brand-violet" style={{ width: `${pct}%` }} />
            </div>
          )}
          {cta}
          {onView && (
            <button onClick={onView} className="w-full mt-2 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-text-primary text-xs font-semibold">
              View event
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl bg-gradient-to-br from-brand-violet/10 to-brand-violet/5 border border-brand-violet/25 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon name="confirmation_number" size={18} className="text-brand-violet-light" />
        <span className="text-text-primary text-sm font-bold">Spectator ticket</span>
        <span className="ml-auto text-brand-violet-light font-dmmono font-bold tabular-nums">{priceLabel}</span>
      </div>
      {progressBar}
      {cta}
    </div>
  );
}
