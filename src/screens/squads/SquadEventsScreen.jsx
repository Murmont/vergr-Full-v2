// Squad Events — leaders schedule scrims/tournaments/squad nights, members
// RSVP. Auto-sorts upcoming → live → past. Wired to
// `squads/{id}/events` subcollection via helpers in firestore.js.
import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  getSquad, getSquadMembers, getSquadMember,
  getSquadEvents, createSquadEvent, rsvpSquadEvent, deleteSquadEvent,
} from '../../firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import SquadShell from '../../components/squad/SquadShell';
import SquadInfoRail from '../../components/squad/SquadInfoRail';
import Modal from '../../components/Modal';

const EVENT_TYPES = [
  { id: 'scrim',       label: 'Scrim',       icon: 'swords' },
  { id: 'tournament',  label: 'Tournament',  icon: 'emoji_events' },
  { id: 'practice',    label: 'Practice',    icon: 'fitness_center' },
  { id: 'social',      label: 'Social',      icon: 'celebration' },
  { id: 'review',      label: 'VOD Review',  icon: 'play_circle' },
];

const tsMs = (t) => (t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : t ? new Date(t).getTime() : 0);
const fmtDateTime = (t) => {
  const ms = tsMs(t);
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const fmtDateLocalInput = (d) => {
  // For <input type="datetime-local">: YYYY-MM-DDTHH:mm in local time.
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function EventCard({ event, currentUid, canManage, onRsvp, onDelete }) {
  const meta = EVENT_TYPES.find((t) => t.id === event.type) || EVENT_TYPES[0];
  const attendees = event.attendees || [];
  const going = currentUid ? attendees.includes(currentUid) : false;
  const startMs = tsMs(event.startAt);
  const endMs = tsMs(event.endAt);
  const now = Date.now();
  const isLive = startMs && (!endMs || endMs > now) && startMs <= now;
  const isPast = endMs ? endMs < now : (startMs && startMs < now - 4 * 3600 * 1000);

  return (
    <div style={{
      padding: 16, borderRadius: 14, background: 'rgba(255,255,255,.025)',
      border: `1px solid ${isLive ? 'rgba(240,64,96,.35)' : 'rgba(255,255,255,.06)'}`,
      opacity: isPast ? .55 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          display: 'grid', placeItems: 'center',
          background: 'rgba(180,79,255,.12)', border: '1px solid rgba(180,79,255,.25)',
        }}>
          <span className="material-symbols-outlined" style={{ color: 'var(--violet-light)', fontSize: 22 }}>
            {meta.icon}
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15, color: '#fff' }}>{event.title || 'Untitled'}</span>
            <span style={{ fontFamily: 'DM Mono', fontSize: 9.5, padding: '2px 7px', borderRadius: 4, background: 'rgba(180,79,255,.14)', color: 'var(--violet-light)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
              {meta.label}
            </span>
            {isLive && (
              <span style={{ fontFamily: 'DM Mono', fontSize: 9.5, padding: '2px 7px', borderRadius: 4, background: 'rgba(240,64,96,.18)', color: 'var(--ember)', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 700 }}>
                ● Live
              </span>
            )}
          </div>
          <div style={{ marginTop: 4, fontFamily: 'DM Mono', fontSize: 11, color: 'var(--t2)' }}>
            {fmtDateTime(event.startAt)}
            {event.endAt && <> · ends {fmtDateTime(event.endAt)}</>}
            {event.location && <> · {event.location}</>}
          </div>
          {event.description && (
            <div style={{ marginTop: 8, fontSize: 13, color: 'var(--t2)', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
              {event.description}
            </div>
          )}
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'DM Mono', fontSize: 11, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
              {attendees.length} going
            </span>
            {!isPast && (
              <button
                onClick={() => onRsvp(event, !going)}
                className={`btn sm ${going ? 'cyan' : 'primary'}`}
                style={{ minWidth: 90, justifyContent: 'center' }}
              >
                <span className="material-symbols-outlined">{going ? 'check' : 'add'}</span>
                {going ? 'Going' : 'RSVP'}
              </button>
            )}
            {canManage && (
              <button
                onClick={() => onDelete(event)}
                className="btn danger sm"
                style={{ marginLeft: 'auto' }}
                title="Delete event"
              >
                <span className="material-symbols-outlined">delete</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function NewEventModal({ open, onClose, onCreate, busy }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('scrim');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [startAt, setStartAt] = useState(() => {
    const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 2);
    return fmtDateLocalInput(d);
  });
  const [endAt, setEndAt] = useState('');

  const reset = () => { setTitle(''); setType('scrim'); setDescription(''); setLocation(''); setEndAt(''); };
  const submit = async () => {
    if (!title.trim() || !startAt) return;
    await onCreate({ title, type, description, location, startAt, endAt: endAt || null });
    reset();
  };

  return (
    <Modal isOpen={open} onClose={() => { reset(); onClose(); }} title="New Event">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--t3)', marginBottom: 6 }}>Type</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {EVENT_TYPES.map((t) => (
              <button key={t.id} onClick={() => setType(t.id)} className={`chip${type === t.id ? ' active' : ''}`}>
                <span className="material-symbols-outlined" style={{ fontSize: 13, marginRight: 4, verticalAlign: '-2px' }}>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--t3)', marginBottom: 6 }}>Title</div>
          <input
            value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80}
            placeholder="Friday night scrim vs. The Riders"
            style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, color: '#fff', fontSize: 14 }}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--t3)', marginBottom: 6 }}>Starts</div>
            <input
              type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, color: '#fff', fontSize: 13 }}
            />
          </div>
          <div>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--t3)', marginBottom: 6 }}>Ends <span style={{ opacity: .6 }}>(optional)</span></div>
            <input
              type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, color: '#fff', fontSize: 13 }}
            />
          </div>
        </div>
        <div>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--t3)', marginBottom: 6 }}>Location <span style={{ opacity: .6 }}>(optional)</span></div>
          <input
            value={location} onChange={(e) => setLocation(e.target.value)} maxLength={80}
            placeholder="Discord, Custom Lobby #4, etc."
            style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, color: '#fff', fontSize: 14 }}
          />
        </div>
        <div>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--t3)', marginBottom: 6 }}>Details</div>
          <textarea
            value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={400}
            placeholder="What to expect, who to bring, prep notes…"
            style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, color: '#fff', fontSize: 14, resize: 'vertical', minHeight: 70 }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn ghost" onClick={() => { reset(); onClose(); }}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy || !title.trim() || !startAt}>
            {busy ? 'Creating…' : 'Create Event'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function SquadEventsScreen() {
  const { squadId } = useParams();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const [squad, setSquad] = useState(null);
  const [members, setMembers] = useState([]);
  const [role, setRole] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);

  const canManage = role === 'president' || role === 'vice_president';

  const load = async () => {
    if (!squadId) return;
    setLoading(true);
    try { setEvents(await getSquadEvents(squadId)); }
    catch (err) { console.warn('Events load failed:', err); }
    setLoading(false);
  };

  useEffect(() => {
    if (!squadId) return;
    getSquad(squadId).then(setSquad).catch(() => {});
    getSquadMembers(squadId).then(setMembers).catch(() => {});
    if (currentUser?.uid) getSquadMember(squadId, currentUser.uid).then((m) => setRole(m?.role || null)).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squadId, currentUser?.uid]);

  const handleCreate = async (data) => {
    setCreating(true);
    try {
      await createSquadEvent(squadId, currentUser.uid, data);
      showToast('Event created', 'success');
      setShowNew(false);
      await load();
    } catch (err) {
      console.error('Create event failed:', err);
      showToast(err?.message || 'Failed to create event', 'error');
    }
    setCreating(false);
  };

  const handleRsvp = async (event, going) => {
    try {
      await rsvpSquadEvent(squadId, event.id, currentUser.uid, going);
      // Optimistic local update.
      setEvents((prev) => prev.map((e) => e.id === event.id ? {
        ...e,
        attendees: going
          ? [...(e.attendees || []), currentUser.uid]
          : (e.attendees || []).filter((u) => u !== currentUser.uid),
      } : e));
    } catch (err) {
      showToast(err?.message || 'RSVP failed (leaders only for now)', 'error');
    }
  };

  const handleDelete = async (event) => {
    if (!window.confirm(`Delete "${event.title}"? Attendees will lose the RSVP.`)) return;
    try {
      await deleteSquadEvent(squadId, event.id);
      setEvents((prev) => prev.filter((e) => e.id !== event.id));
      showToast('Event deleted', 'info');
    } catch (err) {
      showToast(err?.message || 'Failed to delete', 'error');
    }
  };

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const up = []; const ps = [];
    for (const e of events) {
      const endMs = tsMs(e.endAt);
      const startMs = tsMs(e.startAt);
      const ended = endMs ? endMs < now : (startMs && startMs < now - 4 * 3600 * 1000);
      if (ended) ps.push(e); else up.push(e);
    }
    up.sort((a, b) => tsMs(a.startAt) - tsMs(b.startAt));
    ps.sort((a, b) => tsMs(b.startAt) - tsMs(a.startAt));
    return { upcoming: up, past: ps };
  }, [events]);

  return (
    <SquadShell mode="squad" activeId="events" squadId={squadId} rightRail={<SquadInfoRail squad={squad} members={members} />}>
      <main className="main" style={{ overflowY: 'auto' }}>
        <header className="channel-header">
          <div className="channel-title">
            <span className="channel-name">Events</span>
            <span className="channel-divider" />
            <span className="channel-desc">Scrims, tournaments, and squad nights</span>
          </div>
          {canManage && (
            <button className="btn primary" onClick={() => setShowNew(true)}>
              <span className="material-symbols-outlined">add</span> New Event
            </button>
          )}
        </header>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 60 }}>Loading…</div>
          ) : events.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', gap: 14, color: 'var(--t3)', textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px dashed rgba(255,255,255,.08)', borderRadius: 18 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 56, opacity: .45 }}>event</span>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 18, color: 'var(--t1)' }}>No events scheduled</div>
              <div style={{ fontSize: 13, maxWidth: 380 }}>Plan your next scrim, tournament, or squad night. Members can RSVP and you can post follow-ups in chat.</div>
              {canManage && (
                <button className="btn primary" onClick={() => setShowNew(true)}>
                  <span className="material-symbols-outlined">add</span> Schedule First Event
                </button>
              )}
            </div>
          ) : (
            <>
              {upcoming.length > 0 && (
                <section>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--t3)', marginBottom: 10 }}>Upcoming</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {upcoming.map((e) => (
                      <EventCard key={e.id} event={e} currentUid={currentUser?.uid} canManage={canManage} onRsvp={handleRsvp} onDelete={handleDelete} />
                    ))}
                  </div>
                </section>
              )}
              {past.length > 0 && (
                <section>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--t3)', marginBottom: 10 }}>Past</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {past.map((e) => (
                      <EventCard key={e.id} event={e} currentUid={currentUser?.uid} canManage={canManage} onRsvp={handleRsvp} onDelete={handleDelete} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        <NewEventModal open={showNew} onClose={() => setShowNew(false)} onCreate={handleCreate} busy={creating} />
      </main>
    </SquadShell>
  );
}
