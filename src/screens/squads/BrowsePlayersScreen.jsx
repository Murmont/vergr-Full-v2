// Browse Players — recent users on the platform, surfaced as scouting targets
// for squad leaders. Uses the existing searchUsers helper as a quick way to
// page through users. Full LFG/availability filtering lands later.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, orderBy, limit as fbLimit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { searchUsers } from '../../firebase/firestore';
import { useUser } from '../../context/UserContext';
import { applyVanguardMask, isVanguard } from '../../utils/vanguard';
import { shouldHideFromEnumeration, isGuestAccount } from '../../utils/enumerationFilter';
import SquadShell from '../../components/squad/SquadShell';
import VanguardBadge from '../../components/VanguardBadge';
import { avatarClass, initials, nameOf } from '../../components/squad/squadHelpers';
import { IS_NATIVE_BUILD } from '../../utils/platform';

export default function BrowsePlayersScreen() {
  const { profile: viewer } = useUser();
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

  // Filter out: ALL bot accounts (news_bot, shorts_bot, and any future
  // *_bot type — match on 'bot' in accountType). Bots are followable for
  // their posts but are not real players and must never appear in
  // recruiting. Also drop Vanguard members (committed to moderation),
  // enumeration-hidden accounts (e.g. founder), and GUESTS — an anonymous
  // browse-without-signup session has no ToS/DOB and cannot be recruited,
  // followed or messaged, so it is never a scouting target.
  const display = useMemo(
    () => players.filter((u) =>
      !String(u.accountType || '').includes('bot')
      && !isVanguard(u) && !shouldHideFromEnumeration(u) && !isGuestAccount(u)),
    [players],
  );

  return (
    <SquadShell mode="global" activeId="players">
      <main className="main" style={{ overflowY: 'auto' }}>
        <header className="channel-header">
          <div className="channel-title">
            <span className="channel-name">Browse Players</span>
            <span className="channel-divider" />
            <span className="channel-desc">Find players to recruit or follow</span>
          </div>
          <div className="search-input" style={{ padding: '8px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="material-symbols-outlined" style={{ color: 'var(--t3)', fontSize: 18 }}>search</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players" style={{ background: 'transparent', border: 0, outline: 0, color: '#fff', fontSize: 13, width: 200 }} />
          </div>
        </header>

        <div style={{ padding: 22 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 60 }}>Loading…</div>
          ) : display.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 60 }}>No players found.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: IS_NATIVE_BUILD ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {display.map((u) => (
                <button
                  key={u.id || u.uid}
                  onClick={() => navigate(`/user/${u.uid || u.id}`)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 14, textAlign: 'left', cursor: 'pointer' }}
                >
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
      </main>
    </SquadShell>
  );
}
