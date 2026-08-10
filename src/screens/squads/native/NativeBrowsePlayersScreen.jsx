// Native Browse Players — /squads/players on the APK. 2-col scouting grid.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, orderBy, limit as fbLimit, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import { searchUsers } from '../../../firebase/firestore';
import { isVanguard } from '../../../utils/vanguard';
import { shouldHideFromEnumeration } from '../../../utils/enumerationFilter';
import { avatarClass, initials, nameOf } from '../../../components/squad/squadHelpers';
import NativeSquadScaffold from './NativeSquadScaffold';

export default function NativeBrowsePlayersScreen() {
  const navigate = useNavigate();
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const ref = query(collection(db, 'users'), orderBy('createdAt', 'desc'), fbLimit(40));
        const snap = await getDocs(ref);
        setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) { /* ignore */ }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) return;
    let alive = true;
    searchUsers(q.trim(), 30).then((users) => { if (alive) setPlayers(users || []); }).catch(() => {});
    return () => { alive = false; };
  }, [q]);

  const display = useMemo(
    () => players.filter((u) => !String(u.accountType || '').includes('bot') && !isVanguard(u) && !shouldHideFromEnumeration(u)),
    [players],
  );

  return (
    <NativeSquadScaffold mode="global" title="Browse Players" activeId="players">
      <div style={{ padding: 16 }}>
        <div className="search-input" style={{ width: '100%', marginBottom: 14 }}>
          <span className="material-symbols-outlined">search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players" />
        </div>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 60 }}>Loading…</div>
        ) : display.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 60 }}>No players found.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            {display.map((u) => (
              <button key={u.id || u.uid} onClick={() => navigate(`/user/${u.uid || u.id}`)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 14, textAlign: 'left', cursor: 'pointer' }}>
                <div className={`squad-avatar ${avatarClass(u.uid || u.id)}`} style={{ width: 44, height: 44, fontSize: 16 }}>
                  {u.avatar ? <img src={u.avatar} alt="" /> : initials(nameOf(u))}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'Syne', fontWeight: 700, color: '#fff', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOf(u)}</div>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>LVL {u.vpLevel || u.level || 1}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </NativeSquadScaffold>
  );
}
