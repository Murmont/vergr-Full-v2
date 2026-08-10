// InStreamTicketWidget — floating "buy a ticket" widget shown on a live
// stream that's promoting a ticketed event (streams/{id}.promotedEventId).
// Collapsible: a small pill that expands to the full ticket card. Hides for
// viewers who already hold a ticket / are competing / aren't ticketed events.
import { useState, useEffect } from 'react';
import Icon from '../Icon';
import EventTicketCard from '../tournament/EventTicketCard';
import { getEventTicketStatus } from '../../firebase/firestore';

export default function InStreamTicketWidget({ tournamentId }) {
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!tournamentId) return;
    let alive = true;
    getEventTicketStatus(tournamentId).then((s) => { if (alive) setStatus(s); }).catch(() => {});
    return () => { alive = false; };
  }, [tournamentId]);

  if (!tournamentId || !status || status.fundingModel !== 'ticketed') return null;
  if (status.hasTicket || status.isCompetitor) return null; // already in
  const price = status.priceCoins || 0;

  return (
    <div style={{ position: 'fixed', right: 12, bottom: 88, zIndex: 60, width: open ? 280 : 'auto', maxWidth: '92vw' }}>
      {open ? (
        <div style={{ position: 'relative' }}>
          <button onClick={() => setOpen(false)}
            aria-label="Collapse"
            style={{ position: 'absolute', top: -8, right: -8, zIndex: 1, width: 24, height: 24, borderRadius: 12, border: 'none', background: '#1A1A2A', color: '#fff', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
            <Icon name="close" size={14} />
          </button>
          <EventTicketCard
            tournament={{ id: tournamentId, fundingModel: 'ticketed', ticket: { priceCoins: status.priceCoins, sold: status.sold, capacity: status.capacity } }}
            source="stream"
            onPurchased={() => setStatus((s) => ({ ...(s || {}), hasTicket: true }))}
          />
        </div>
      ) : (
        <button onClick={() => setOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 999, border: '1px solid rgba(180,79,255,0.4)', background: 'linear-gradient(135deg, rgba(123,31,255,0.95), rgba(180,79,255,0.85))', color: '#0B0B14', fontSize: 13, fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
          <Icon name="confirmation_number" size={16} />
          Get a ticket{price ? ` · ${price.toLocaleString()}c` : ''}
        </button>
      )}
    </div>
  );
}
