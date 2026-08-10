// Native Squad Events — /squads/:squadId/events on the APK. Reuses the web
// EventCard + NewEventModal (exported from SquadEventsScreen) so the RSVP /
// create / delete behaviour never drifts.
import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  getSquad, getSquadMember, getSquadEvents, createSquadEvent, rsvpSquadEvent, deleteSquadEvent,
} from '../../../firebase/firestore';
import { useAuth } from '../../../context/AuthContext';
import { useUI } from '../../../context/UIContext';
import { EventCard, NewEventModal } from '../SquadEventsScreen';
import NativeSquadScaffold from './NativeSquadScaffold';

const tsMs = (t) => (t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : t ? new Date(t).getTime() : 0);

export default function NativeSquadEventsScreen() {
  const { squadId } = useParams();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const [squad, setSquad] = useState(null);
  const [role, setRole] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);

  const canManage = role === 'president' || role === 'vice_president';

  const load = async () => {
    if (!squadId) return;
    setLoading(true);
    try { setEvents(await getSquadEvents(squadId)); } catch (err) { console.warn('Events load failed:', err); }
    setLoading(false);
  };

  useEffect(() => {
    if (!squadId) return;
    getSquad(squadId).then(setSquad).catch(() => {});
    if (currentUser?.uid) getSquadMember(squadId, currentUser.uid).then((m) => setRole(m?.role || null)).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squadId, currentUser?.uid]);

  const handleCreate = async (data) => {
    setCreating(true);
    try { await createSquadEvent(squadId, currentUser.uid, data); showToast('Event created', 'success'); setShowNew(false); await load(); }
    catch (err) { showToast(err?.message || 'Failed to create event', 'error'); }
    setCreating(false);
  };
  const handleRsvp = async (event, going) => {
    try {
      await rsvpSquadEvent(squadId, event.id, currentUser.uid, going);
      setEvents((prev) => prev.map((e) => e.id === event.id ? { ...e, attendees: going ? [...(e.attendees || []), currentUser.uid] : (e.attendees || []).filter((u) => u !== currentUser.uid) } : e));
    } catch (err) { showToast(err?.message || 'RSVP failed (leaders only for now)', 'error'); }
  };
  const handleDelete = async (event) => {
    if (!window.confirm(`Delete "${event.title}"? Attendees will lose the RSVP.`)) return;
    try { await deleteSquadEvent(squadId, event.id); setEvents((prev) => prev.filter((e) => e.id !== event.id)); showToast('Event deleted', 'info'); }
    catch (err) { showToast(err?.message || 'Failed to delete', 'error'); }
  };

  const { upcoming, past } = useMemo(() => {
    const now = Date.now(); const up = []; const ps = [];
    for (const e of events) { const endMs = tsMs(e.endAt); const startMs = tsMs(e.startAt); const ended = endMs ? endMs < now : (startMs && startMs < now - 4 * 3600 * 1000); if (ended) ps.push(e); else up.push(e); }
    up.sort((a, b) => tsMs(a.startAt) - tsMs(b.startAt)); ps.sort((a, b) => tsMs(b.startAt) - tsMs(a.startAt));
    return { upcoming: up, past: ps };
  }, [events]);

  const actions = canManage ? <button className="icon-btn" title="New event" onClick={() => setShowNew(true)}><span className="material-symbols-outlined">add</span></button> : null;

  return (
    <NativeSquadScaffold mode="squad" title="Events" activeId="events" squadId={squadId} squadName={squad?.name} actions={actions}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {loading ? <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 60 }}>Loading…</div>
          : events.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', gap: 14, color: 'var(--t3)', textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px dashed rgba(255,255,255,.08)', borderRadius: 18 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 56, opacity: .45 }}>event</span>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 18, color: 'var(--t1)' }}>No events scheduled</div>
              <div style={{ fontSize: 13 }}>Plan your next scrim, tournament, or squad night. Members can RSVP.</div>
              {canManage && <button className="btn primary" onClick={() => setShowNew(true)}><span className="material-symbols-outlined">add</span> Schedule First Event</button>}
            </div>
          ) : (
            <>
              {upcoming.length > 0 && (
                <section>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--t3)', marginBottom: 10 }}>Upcoming</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{upcoming.map((e) => <EventCard key={e.id} event={e} currentUid={currentUser?.uid} canManage={canManage} onRsvp={handleRsvp} onDelete={handleDelete} />)}</div>
                </section>
              )}
              {past.length > 0 && (
                <section>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--t3)', marginBottom: 10 }}>Past</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{past.map((e) => <EventCard key={e.id} event={e} currentUid={currentUser?.uid} canManage={canManage} onRsvp={handleRsvp} onDelete={handleDelete} />)}</div>
                </section>
              )}
            </>
          )}
      </div>
      <NewEventModal open={showNew} onClose={() => setShowNew(false)} onCreate={handleCreate} busy={creating} />
    </NativeSquadScaffold>
  );
}
