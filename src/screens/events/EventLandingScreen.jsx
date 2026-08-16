// Public event landing page — route /e/:id. The shareable destination behind
// every ticket link. Works logged-out (read-only tournament data + ticket
// status), converts visitors via the EventTicketCard. Non-ticketed events
// redirect to the normal lobby.
import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getTournament, getUser } from '../../firebase/firestore';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import EventTicketCard from '../../components/tournament/EventTicketCard';
import SeasonPassCard from '../../components/tournament/SeasonPassCard';
import { EventShareRow } from '../../components/tournament/EventShareSheet';
import { getBracketType } from '../../utils/tournamentTypes';

const STATUS_PILL = {
  open: { label: 'Registration Open', cls: 'bg-brand-violet/15 text-brand-violet-light' },
  active: { label: 'Live Now', cls: 'bg-brand-ember/15 text-brand-ember' },
  completed: { label: 'Finished', cls: 'bg-white/10 text-text-muted' },
  cancelled: { label: 'Cancelled', cls: 'bg-brand-ember/10 text-brand-ember' },
};

function fmtDate(ts) {
  if (!ts) return null;
  const ms = ts?.toMillis ? ts.toMillis() : (ts?.seconds ? ts.seconds * 1000 : ts);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function EventLandingScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState(null);
  const [host, setHost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const t = await getTournament(id);
        if (!alive) return;
        if (!t) { setNotFound(true); setLoading(false); return; }
        // Non-ticketed events use the standard lobby.
        if (t.fundingModel !== 'ticketed') { navigate(`/match/${id}`, { replace: true }); return; }
        setTournament({ ...t, id });
        document.title = `${t.name} — VERGR Event`;
        if (t.adminId) getUser(t.adminId).then((u) => { if (alive) setHost(u); }).catch(() => {});
      } catch {
        if (alive) setNotFound(true);
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [id, navigate]);

  if (loading) {
    return <div className="min-h-screen bg-bg-dark flex items-center justify-center text-text-muted">Loading event…</div>;
  }
  if (notFound || !tournament) {
    return (
      <div className="min-h-screen bg-bg-dark flex flex-col items-center justify-center gap-3 text-center px-6">
        <Icon name="confirmation_number" size={40} className="text-text-muted" />
        <p className="text-text-primary font-bold">Event not found</p>
        <Link to="/" className="text-brand-violet-light text-sm font-semibold">Go to Vergr</Link>
      </div>
    );
  }

  const cfg = getBracketType(tournament.type);
  const pill = STATUS_PILL[tournament.status] || STATUS_PILL.open;
  const purse = tournament.declaredPurse || 0;
  const ticketPrice = tournament.ticket?.priceCoins || 0;
  const sold = tournament.ticket?.sold || 0;
  const capacity = tournament.ticket?.capacity || 0;
  const startLabel = fmtDate(tournament.scheduledStart);

  return (
    <div className="min-h-screen bg-bg-dark text-white">
      {/* Minimal public chrome */}
      <header className="flex items-center justify-between px-4 sm:px-8 py-3 border-b border-white/[0.06]">
        <Link to="/" className="font-syne text-lg font-extrabold tracking-tight">VERGR</Link>
        <Link to="/login" className="px-3.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-sm font-semibold">Sign in</Link>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6 grid lg:grid-cols-3 gap-6">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Hero */}
          <div className="rounded-2xl overflow-hidden border border-white/[0.06] bg-surface-1">
            <div className="h-44 sm:h-60 relative bg-gradient-to-br from-brand-violet/40 to-brand-pink/20">
              {tournament.bannerUrl && (
                <img src={tournament.bannerUrl} alt="" className="absolute inset-0 w-full h-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-bg-dark via-transparent" />
              <span className={`absolute top-3 left-3 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest ${pill.cls}`}>{pill.label}</span>
            </div>
            <div className="p-5">
              <p className="text-text-muted text-xs uppercase tracking-wider mb-1">{tournament.game}</p>
              <h1 className="font-syne text-2xl sm:text-3xl font-extrabold mb-3">{tournament.name}</h1>
              {host && (
                <div className="flex items-center gap-2">
                  <UserAvatar user={host} size={28} />
                  <span className="text-text-secondary text-sm">Hosted by <span className="text-text-primary font-semibold">{host.username || host.displayName || 'a creator'}</span></span>
                </div>
              )}
            </div>
          </div>

          {/* Stat strip */}
          <div className="grid grid-cols-3 gap-3">
            <Stat icon="emoji_events" color="text-brand-gold" value={purse.toLocaleString()} label="Prize Purse" />
            <Stat icon="confirmation_number" color="text-brand-violet-light" value={ticketPrice ? ticketPrice.toLocaleString() : 'Free'} label="Ticket" />
            <Stat icon="visibility" color="text-brand-violet-light" value={`${sold.toLocaleString()}/${capacity.toLocaleString()}`} label="Tickets" />
          </div>

          {/* About + what's a ticket */}
          <div className="grid sm:grid-cols-2 gap-4">
            {tournament.description && (
              <Section title="About the event">
                <p className="text-text-secondary text-sm leading-relaxed whitespace-pre-line">{tournament.description}</p>
              </Section>
            )}
            <Section title="What's a ticket?">
              <p className="text-text-secondary text-sm leading-relaxed">
                A ticket lets you watch the event live and support the host. You're not entering the competition — players compete for free.
              </p>
            </Section>
          </div>

          {/* Event details */}
          <Section title="Event details">
            <DetailRow label="Format" value={cfg?.label || tournament.eventKind || 'Event'} />
            <DetailRow label="Players" value={`${tournament.participants?.length || 0} / ${tournament.maxParticipants}`} />
            {startLabel && <DetailRow label="Starts" value={startLabel} />}
            <DetailRow label="Tickets sold" value={`${sold.toLocaleString()} / ${capacity.toLocaleString()}`} />
          </Section>

          {/* Share */}
          <Section title="Share the event">
            <EventShareRow tournament={tournament} />
          </Section>
        </div>

        {/* Ticket rail */}
        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-6 space-y-4">
            <EventTicketCard tournament={tournament} variant="landing" source="sharelink"
              onCompete={() => navigate(`/match/${id}`)} />
            {tournament.adminId && <SeasonPassCard hostUid={tournament.adminId} hostName={host?.username || host?.displayName} />}
            <Link to={`/match/${id}`} className="block text-center text-text-muted hover:text-brand-violet-light text-xs font-semibold">
              Open the full tournament lobby →
            </Link>
          </div>
        </div>
      </div>

      <footer className="text-center py-6 text-text-muted text-xs border-t border-white/[0.06]">
        Powered by <Link to="/" className="text-brand-violet-light font-semibold">VERGR</Link>
      </footer>
    </div>
  );
}

function Stat({ icon, color, value, label }) {
  return (
    <div className="p-3 rounded-xl bg-surface-1 border border-white/[0.06] text-center">
      <Icon name={icon} size={20} className={`${color} mx-auto mb-1`} />
      <p className={`${color} font-dmmono font-bold text-lg tabular-nums`}>{value}</p>
      <p className="text-text-muted text-[9px] uppercase tracking-wider">{label}</p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="rounded-2xl bg-surface-1 border border-white/[0.06] p-4">
      <p className="text-[10px] font-dmmono uppercase tracking-[0.16em] text-text-muted mb-2">{title}</p>
      {children}
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04] last:border-0">
      <span className="text-text-muted text-sm">{label}</span>
      <span className="text-text-primary text-sm font-semibold">{value}</span>
    </div>
  );
}
