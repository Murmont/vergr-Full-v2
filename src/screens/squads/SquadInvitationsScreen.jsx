// My Squad Invitations — reads from the dedicated `squad_invitations`
// collection (separate from `join_requests`). Accept joins the squad +
// flips status. Decline flips status. Snapshots of squad name/avatar are
// stored on each invitation doc so we don't need a separate squad fetch.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import {
  getMyInvitations, acceptSquadInvitation, declineSquadInvitation,
} from '../../firebase/firestore';
import SquadShell from '../../components/squad/SquadShell';
import { initials } from '../../components/squad/squadHelpers';

export default function SquadInvitationsScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    if (!currentUser?.uid) { setLoading(false); return; }
    setLoading(true);
    try {
      const list = await getMyInvitations(currentUser.uid, 'pending');
      setInvites(list);
    } catch (err) {
      console.warn('Invitations load failed (composite index may be missing):', err?.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [currentUser?.uid]);

  const onAccept = async (inv) => {
    setBusyId(inv.id);
    try {
      const sid = await acceptSquadInvitation(inv.id, currentUser.uid);
      showToast(`Joined ${inv.squadName || 'squad'}`, 'success');
      navigate(`/squads/${sid}`);
    } catch (err) {
      console.error('Accept invite failed:', err);
      showToast(err?.message || 'Could not accept invite', 'error');
    }
    setBusyId(null);
  };

  const onDecline = async (inv) => {
    setBusyId(inv.id);
    try {
      await declineSquadInvitation(inv.id, currentUser.uid);
      setInvites((prev) => prev.filter((x) => x.id !== inv.id));
      showToast('Invitation declined', 'info');
    } catch (err) {
      console.error('Decline invite failed:', err);
      showToast(err?.message || 'Could not decline invite', 'error');
    }
    setBusyId(null);
  };

  return (
    <SquadShell mode="global" activeId="invitations">
      <main className="main" style={{ overflowY: 'auto' }}>
        <header className="channel-header">
          <div className="channel-title">
            <span className="channel-name">Invitations</span>
            <span className="channel-divider" />
            <span className="channel-desc">Squads that want you on the roster</span>
          </div>
        </header>

        <div style={{ padding: 22 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 60 }}>Loading…</div>
          ) : invites.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', gap: 12, color: 'var(--t3)', textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px dashed rgba(255,255,255,.08)', borderRadius: 18 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 48, opacity: .45 }}>mail</span>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: 'var(--t1)' }}>No invitations</div>
              <div style={{ fontSize: 13, maxWidth: 380 }}>When a squad leader invites you, it'll show up here.</div>
              <button className="btn primary" onClick={() => navigate('/squads')}>
                <span className="material-symbols-outlined">search</span> Find a Squad
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {invites.map((inv) => (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 14 }}>
                  <div className="squad-avatar" style={{ width: 44, height: 44, fontSize: 15 }}>
                    {inv.squadAvatar ? <img src={inv.squadAvatar} alt="" /> : initials(inv.squadName)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'Syne', fontWeight: 700, color: '#fff', fontSize: 14 }}>{inv.squadName || 'A squad'}</div>
                    <div style={{ marginTop: 4, fontFamily: 'DM Mono', fontSize: 10.5, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                      {inv.squadGame || 'Multi-game'}
                      {inv.inviterName && <span> • Invited by {inv.inviterName}</span>}
                    </div>
                    {inv.message && (
                      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--t2)', lineHeight: 1.5 }}>“{inv.message}”</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn ghost sm" disabled={busyId === inv.id} onClick={() => onDecline(inv)}>Decline</button>
                    <button className="btn primary sm" disabled={busyId === inv.id} onClick={() => onAccept(inv)}>
                      {busyId === inv.id ? '…' : 'Accept'}
                    </button>
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
