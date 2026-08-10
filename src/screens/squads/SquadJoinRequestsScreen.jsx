// Squad Join Requests — leader/co-leader queue. Approve or decline.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useUI } from '../../context/UIContext';
import { useAuth } from '../../context/AuthContext';
import { getSquad, getSquadMembers, getSquadMember, getSquadJoinRequests, handleJoinRequest, getUser } from '../../firebase/firestore';
import SquadShell from '../../components/squad/SquadShell';
import SquadInfoRail from '../../components/squad/SquadInfoRail';
import { avatarClass, initials } from '../../components/squad/squadHelpers';

export default function SquadJoinRequestsScreen() {
  const { squadId } = useParams();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const [squad, setSquad] = useState(null);
  const [members, setMembers] = useState([]);
  const [role, setRole] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    if (!squadId) return;
    setLoading(true);
    try {
      const reqs = await getSquadJoinRequests(squadId);
      const withUser = await Promise.all(reqs.map(async (r) => ({ ...r, user: await getUser(r.userId).catch(() => null) })));
      setRequests(withUser);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    if (!squadId) return;
    getSquad(squadId).then(setSquad).catch(() => {});
    getSquadMembers(squadId).then(setMembers).catch(() => {});
    if (currentUser?.uid) getSquadMember(squadId, currentUser.uid).then((m) => setRole(m?.role || null)).catch(() => {});
    load();
  }, [squadId, currentUser?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const canManage = role === 'president' || role === 'vice_president';

  const onDecide = async (req, approved) => {
    setBusyId(req.id);
    try {
      await handleJoinRequest(squadId, req.id, req.userId, approved);
      showToast(approved ? 'Request approved' : 'Request declined', 'success');
      await load();
    } catch (e) {
      showToast(e?.message || 'Action failed', 'error');
    }
    setBusyId(null);
  };

  return (
    <SquadShell mode="squad" activeId="requests" squadId={squadId} rightRail={<SquadInfoRail squad={squad} members={members} />}>
      <main className="main" style={{ overflowY: 'auto' }}>
        <header className="channel-header">
          <div className="channel-title">
            <span className="channel-name">Join Requests</span>
            <span className="channel-divider" />
            <span className="channel-desc">Approve or decline players asking to join</span>
          </div>
        </header>

        <div style={{ padding: 22 }}>
          {!canManage ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', gap: 12, color: 'var(--t3)', textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px dashed rgba(255,255,255,.08)', borderRadius: 18 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 48, opacity: .45 }}>lock</span>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: 'var(--t1)' }}>Leaders only</div>
              <div style={{ fontSize: 13 }}>Only the President or Vice President can manage join requests.</div>
            </div>
          ) : loading ? (
            <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 60 }}>Loading…</div>
          ) : requests.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', gap: 12, color: 'var(--t3)', textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px dashed rgba(255,255,255,.08)', borderRadius: 18 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 48, opacity: .45 }}>inbox</span>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: 'var(--t1)' }}>No pending requests</div>
              <div style={{ fontSize: 13 }}>You're all caught up.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {requests.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 14 }}>
                  <div className={`squad-avatar ${avatarClass(r.userId)}`} style={{ width: 44, height: 44, fontSize: 16 }}>
                    {r.user?.avatar ? <img src={r.user.avatar} alt="" /> : initials(r.user?.displayName || r.user?.username || '?')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'Syne', fontWeight: 700, color: '#fff', fontSize: 14 }}>
                      {r.user?.displayName || r.user?.username || 'Player'}
                    </div>
                    {r.message && (
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--t2)', lineHeight: 1.5 }}>“{r.message}”</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn ghost sm" disabled={busyId === r.id} onClick={() => onDecide(r, false)}>Decline</button>
                    <button className="btn primary sm" disabled={busyId === r.id} onClick={() => onDecide(r, true)}>Approve</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </SquadShell>
  );
}
