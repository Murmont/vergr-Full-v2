// My Squads — squads the current user is a member of. Lives at /squads/mine.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUserSquads } from '../../firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import SquadShell from '../../components/squad/SquadShell';
import { compact, initials } from '../../components/squad/squadHelpers';

function MySquadCard({ squad, onOpen }) {
  return (
    <button className="sq-card" onClick={onOpen}>
      <div
        className="sq-banner"
        style={squad.banner ? { background: `url(${squad.banner}) center/cover, #1a0a3a` } : undefined}
      >
        {squad.unread > 0 && (
          <div className="unread"><span className="pulse" />{squad.unread} new</div>
        )}
        <div className="sq-avatar-wrap">
          <div>{squad.avatar ? <img src={squad.avatar} alt="" /> : initials(squad.name)}</div>
        </div>
      </div>
      <div className="sq-body">
        <div className="sq-name">{squad.name || 'Unnamed Squad'}</div>
        <div className="sq-line">
          <span>{squad.game || 'Multi-game'}</span>
          <span className="pip" />
          <span>{compact(squad.memberCount || squad.memberIds?.length || 0)} members</span>
        </div>
        <div className="sq-xp">
          <span className="lvl">LVL <span className="v">{squad.level || 1}</span></span>
          <div className="bar"><div style={{ width: `${Math.min(100, ((squad.xp || 0) / (squad.xpNext || 1000)) * 100)}%` }} /></div>
          <span className="pct">{Math.min(100, Math.round(((squad.xp || 0) / (squad.xpNext || 1000)) * 100))}%</span>
        </div>
      </div>
      <div className="sq-footer">
        <span className="sq-mcount">{squad.isPublic ? 'Public' : 'Private'}</span>
        <span className="open"><span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_forward</span> Open</span>
      </div>
    </button>
  );
}

export default function SquadsMineScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [squads, setSquads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!currentUser?.uid) return;
    getUserSquads(currentUser.uid)
      .then((list) => { if (alive) setSquads(list || []); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [currentUser?.uid]);

  return (
    <SquadShell mode="global" activeId="mine">
      <main className="main" style={{ overflowY: 'auto' }}>
        <header className="channel-header">
          <div className="channel-title">
            <span className="channel-name">My Squads</span>
            <span className="channel-divider" />
            <span className="channel-desc">Your active memberships</span>
          </div>
          <div className="header-actions">
            <button className="btn primary" onClick={() => navigate('/squads/create')}>
              <span className="material-symbols-outlined">add</span> Create Squad
            </button>
          </div>
        </header>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="stat-strip">
            <div className="stat"><div className="v violet">{squads.length}</div><div className="l">My Squads</div></div>
            <div className="stat"><div className="v cyan">{squads.reduce((a, s) => a + (s.memberCount || s.memberIds?.length || 0), 0)}</div><div className="l">Total Members</div></div>
            <div className="stat"><div className="v gold">{squads.filter((s) => s.ownerId === currentUser?.uid).length}</div><div className="l">Owned</div></div>
            <div className="stat"><div className="v">{squads.filter((s) => s.isPublic).length}</div><div className="l">Public</div></div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 60 }}>Loading…</div>
          ) : squads.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, gap: 12, color: 'var(--t3)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 48, opacity: .45 }}>group_add</span>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: 'var(--t2)' }}>You haven't joined a squad yet</div>
              <div style={{ fontSize: 13, textAlign: 'center', maxWidth: 360 }}>Browse open squads or create your own. Squads unlock voice chat, tournaments, shared earnings, and ranked leaderboards.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn ghost" onClick={() => navigate('/squads')}>Find Squads</button>
                <button className="btn primary" onClick={() => navigate('/squads/create')}>
                  <span className="material-symbols-outlined">add_circle</span> Create Squad
                </button>
              </div>
            </div>
          ) : (
            <div className="squad-grid">
              {squads.map((s) => (
                <MySquadCard key={s.id} squad={s} onOpen={() => navigate(`/squads/${s.id}`)} />
              ))}
            </div>
          )}
        </div>
      </main>
    </SquadShell>
  );
}
