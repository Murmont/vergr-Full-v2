// Native Squad Join Requests — /squads/:squadId/requests on the APK.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useUI } from '../../../context/UIContext';
import { useAuth } from '../../../context/AuthContext';
import { getSquad, getSquadMember, getSquadJoinRequests, handleJoinRequest, getUser } from '../../../firebase/firestore';
import { avatarClass, initials } from '../../../components/squad/squadHelpers';
import NativeSquadScaffold from './NativeSquadScaffold';

export default function NativeSquadJoinRequestsScreen() {
  const { squadId } = useParams();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const [squad, setSquad] = useState(null);
  const [role, setRole] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    if (!squadId) return;
    setLoading(true);
    try {
      const reqs = await getSquadJoinRequests(squadId);
      setRequests(await Promise.all(reqs.map(async (r) => ({ ...r, user: await getUser(r.userId).catch(() => null) }))));
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    if (!squadId) return;
    getSquad(squadId).then(setSquad).catch(() => {});
    if (currentUser?.uid) getSquadMember(squadId, currentUser.uid).then((m) => setRole(m?.role || null)).catch(() => {});
    load();
  }, [squadId, currentUser?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const canManage = role === 'president' || role === 'vice_president';

  const onDecide = async (req, approved) => {
    setBusyId(req.id);
    try { await handleJoinRequest(squadId, req.id, req.userId, approved); showToast(approved ? 'Request approved' : 'Request declined', 'success'); await load(); }
    catch (e) { showToast(e?.message || 'Action failed', 'error'); }
    setBusyId(null);
  };

  const empty = (icon, title, sub) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', gap: 12, color: 'var(--t3)', textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px dashed rgba(255,255,255,.08)', borderRadius: 18 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 48, opacity: .45 }}>{icon}</span>
      <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: 'var(--t1)' }}>{title}</div>
      <div style={{ fontSize: 13 }}>{sub}</div>
    </div>
  );

  return (
    <NativeSquadScaffold mode="squad" title="Join Requests" activeId="requests" squadId={squadId} squadName={squad?.name}>
      <div style={{ padding: 16 }}>
        {!canManage ? empty('lock', 'Leaders only', 'Only the President or Vice President can manage join requests.')
          : loading ? <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 60 }}>Loading…</div>
          : requests.length === 0 ? empty('inbox', 'No pending requests', "You're all caught up.")
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {requests.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 14 }}>
                  <div className={`squad-avatar ${avatarClass(r.userId)}`} style={{ width: 44, height: 44, fontSize: 16 }}>{r.user?.avatar ? <img src={r.user.avatar} alt="" /> : initials(r.user?.displayName || r.user?.username || '?')}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'Syne', fontWeight: 700, color: '#fff', fontSize: 14 }}>{r.user?.displayName || r.user?.username || 'Player'}</div>
                    {r.message && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--t2)', lineHeight: 1.5 }}>“{r.message}”</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button className="btn primary sm" disabled={busyId === r.id} onClick={() => onDecide(r, true)}>Approve</button>
                    <button className="btn ghost sm" disabled={busyId === r.id} onClick={() => onDecide(r, false)}>Decline</button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </NativeSquadScaffold>
  );
}
