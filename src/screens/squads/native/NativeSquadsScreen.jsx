// Native Find Squads — /squads on the APK. Single-column discovery list.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot, orderBy, limit as fbLimit } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import { compact, initials } from '../../../components/squad/squadHelpers';
import NativeSquadScaffold from './NativeSquadScaffold';

const GAMES = ['All Games', 'Valorant', 'Apex Legends', 'Call of Duty', 'Fortnite', 'Rocket League', 'CS2', 'Dota 2'];

function SquadGridCard({ squad, onOpen }) {
  const full = (squad.memberCount || squad.memberIds?.length || 0) >= (squad.maxMembers || 50);
  return (
    <button className="sq-card" onClick={onOpen}>
      <div className="sq-banner" style={squad.banner ? { background: `url(${squad.banner}) center/cover, #1a0a3a` } : undefined}>
        <div className="sq-avatar-wrap"><div>{squad.avatar ? <img src={squad.avatar} alt="" /> : initials(squad.name)}</div></div>
      </div>
      <div className="sq-body">
        <div className="sq-name">{squad.name || 'Unnamed Squad'}</div>
        <div className="sq-line">
          <span>{squad.game || 'Multi-game'}</span><span className="pip" /><span>{full ? 'Full' : 'Recruiting'}</span>
        </div>
        <div className="sq-xp">
          <span className="lvl">LVL <span className="v">{squad.level || 1}</span></span>
          <div className="bar"><div style={{ width: `${Math.min(100, ((squad.xp || 0) / (squad.xpNext || 1000)) * 100)}%` }} /></div>
          <span className="pct">{compact(squad.memberCount || squad.memberIds?.length || 0)} members</span>
        </div>
      </div>
      <div className="sq-footer">
        <span className="sq-mcount">{squad.isPublic ? 'Public' : 'Private'}</span>
        <span className="open"><span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_forward</span> Open</span>
      </div>
    </button>
  );
}

export default function NativeSquadsScreen() {
  const navigate = useNavigate();
  const [squads, setSquads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [game, setGame] = useState('All Games');
  const [q, setQ] = useState('');

  useEffect(() => {
    const qref = query(collection(db, 'squads'), where('isPublic', '==', true), orderBy('memberCount', 'desc'), fbLimit(60));
    return onSnapshot(qref, (snap) => {
      setSquads(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = squads;
    if (game !== 'All Games') list = list.filter((s) => (s.game || '').toLowerCase().includes(game.toLowerCase()));
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((s) => (s.name || '').toLowerCase().includes(needle) || (s.description || '').toLowerCase().includes(needle));
    }
    return list;
  }, [squads, game, q]);

  return (
    <NativeSquadScaffold mode="global" title="Find Squads" activeId="find">
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="search-input" style={{ width: '100%' }}>
          <span className="material-symbols-outlined">search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search squads" />
        </div>
        <button className="btn primary" style={{ justifyContent: 'center' }} onClick={() => navigate('/squads/create')}>
          <span className="material-symbols-outlined">add</span> Create Squad
        </button>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
          {GAMES.map((g) => (
            <button key={g} onClick={() => setGame(g)} className={`chip${game === g ? ' active' : ''}`} style={{ flexShrink: 0 }}>{g}</button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 60 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, gap: 12, color: 'var(--t3)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 48, opacity: .45 }}>groups_2</span>
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: 'var(--t2)' }}>No squads match</div>
            <div style={{ fontSize: 13, textAlign: 'center' }}>Try a different game filter or create your own squad.</div>
            <button className="btn primary" onClick={() => navigate('/squads/create')}>
              <span className="material-symbols-outlined">add_circle</span> Create Squad
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            {filtered.map((s) => <SquadGridCard key={s.id} squad={s} onOpen={() => navigate(`/squads/${s.id}`)} />)}
          </div>
        )}
      </div>
    </NativeSquadScaffold>
  );
}
