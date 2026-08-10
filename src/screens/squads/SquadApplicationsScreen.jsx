// My Squad Applications — public join requests the user has submitted.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collectionGroup, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import SquadShell from '../../components/squad/SquadShell';

const STATUS_META = {
  pending:  { label: 'Pending',  color: 'var(--gold-light)' },
  approved: { label: 'Approved', color: 'var(--cyan)' },
  declined: { label: 'Declined', color: 'var(--ember)' },
};

export default function SquadApplicationsScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser?.uid) { setLoading(false); return; }
    (async () => {
      try {
        const q = query(collectionGroup(db, 'join_requests'), where('userId', '==', currentUser.uid));
        const snap = await getDocs(q);
        setApps(snap.docs.map((d) => ({ id: d.id, squadId: d.ref.parent.parent?.id, ...d.data() })).filter((a) => a.status !== 'invited'));
      } catch (e) { /* ignore */ }
      setLoading(false);
    })();
  }, [currentUser?.uid]);

  return (
    <SquadShell mode="global" activeId="applications">
      <main className="main" style={{ overflowY: 'auto' }}>
        <header className="channel-header">
          <div className="channel-title">
            <span className="channel-name">Applications</span>
            <span className="channel-divider" />
            <span className="channel-desc">Squads you've applied to join</span>
          </div>
        </header>

        <div style={{ padding: 22 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 60 }}>Loading…</div>
          ) : apps.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', gap: 12, color: 'var(--t3)', textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px dashed rgba(255,255,255,.08)', borderRadius: 18 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 48, opacity: .45 }}>description</span>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: 'var(--t1)' }}>No applications</div>
              <div style={{ fontSize: 13, maxWidth: 380 }}>When you request to join a squad, the status will show up here.</div>
              <button className="btn primary" onClick={() => navigate('/squads')}>
                <span className="material-symbols-outlined">search</span> Find a Squad
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {apps.map((a) => {
                const meta = STATUS_META[a.status] || STATUS_META.pending;
                return (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 14 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'Syne', fontWeight: 700, color: '#fff', fontSize: 14 }}>{a.squadName || 'A squad'}</div>
                      {a.message && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--t2)' }}>“{a.message}”</div>}
                    </div>
                    <span style={{ fontFamily: 'DM Mono', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: meta.color }}>{meta.label}</span>
                    <button className="btn ghost sm" onClick={() => navigate(`/squads/${a.squadId}`)}>View</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </SquadShell>
  );
}
