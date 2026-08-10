// SquadLeaderboardScreen — members ranked by squad contribution.
// Podium for the top 3 + a "you" callout + full table. Route:
// /squads/:squadId/leaderboard.

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getSquad, getSquadLeaderboard } from '../../firebase/firestore';
import SquadShell from '../../components/squad/SquadShell';
import SquadInfoRail from '../../components/squad/SquadInfoRail';
import { roleMeta, avatarClass, initials, nameOf, compact } from '../../components/squad/squadHelpers';

export default function SquadLeaderboardScreen() {
  const { squadId } = useParams();
  const { currentUser } = useAuth();
  const [squad, setSquad] = useState(null);
  const [ranked, setRanked] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!squadId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [s, r] = await Promise.all([getSquad(squadId), getSquadLeaderboard(squadId)]);
        if (!alive) return;
        setSquad(s); setRanked(r);
      } catch (e) { /* ignore */ }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [squadId]);

  const top = ranked.slice(0, 3);
  const max = ranked[0]?.totalContributed || 1;
  const myIndex = ranked.findIndex((m) => m.id === currentUser?.uid);
  const me = myIndex >= 0 ? ranked[myIndex] : null;

  const Podium = (m, place) => {
    if (!m) return <div />;
    const meta = roleMeta(m.role);
    return (
      <div className={`podium p${place}`}>
        <span className="rank">#{place}</span>
        <span className="crown"><span className="material-symbols-outlined">{place === 1 ? 'workspace_premium' : 'military_tech'}</span></span>
        <div className={`pav ${avatarClass(m.id)}`}>
          {m.user?.avatar ? <img src={m.user.avatar} alt="" /> : initials(nameOf(m.user))}
        </div>
        <div className="nm">{nameOf(m.user)}</div>
        <div className="prole" style={{ color: `var(--${meta.name || 't3'})` }}>{meta.label}</div>
        <div className="vp">{compact(m.totalContributed || 0)}</div>
        <div className="vp-l">Contributed</div>
      </div>
    );
  };

  const main = (
    <main className="main">
      <header className="page-header">
        <div>
          <div className="ttl">Leaderboard</div>
          <div className="sub">Squad members ranked by total contribution</div>
        </div>
      </header>

      <div className="scroll content">
        {loading ? (
          <div className="dim center" style={{ padding: 48 }}>Loading…</div>
        ) : ranked.length === 0 ? (
          <div className="empty">
            <div className="ic"><span className="material-symbols-outlined">leaderboard</span></div>
            <div className="t">No rankings yet</div>
            <div className="d">Contribute coins to the squad treasury to climb the board.</div>
          </div>
        ) : (
          <>
            {/* Podium — visual order 2 · 1 · 3 */}
            <div className="podium-row">
              {Podium(top[1], 2)}
              {Podium(top[0], 1)}
              {Podium(top[2], 3)}
            </div>

            {/* You */}
            {me && (
              <div className="you-card">
                <div className={`yav ${avatarClass(me.id)}`}>
                  {me.user?.avatar ? <img src={me.user.avatar} alt="" /> : initials(nameOf(me.user))}
                </div>
                <div>
                  <div className="nm">{nameOf(me.user)} (you)</div>
                  <div className="hd">Ranked #{myIndex + 1} of {ranked.length}</div>
                </div>
                <div className="stats">
                  <div className="s"><div className="v">{compact(me.totalContributed || 0)}</div><div className="l">Contributed</div></div>
                  <div className="s"><div className="v" style={{ color: 'var(--violet-light)' }}>{me.user?.vpLevel || me.user?.level || 1}</div><div className="l">Level</div></div>
                </div>
              </div>
            )}

            {/* Table */}
            <div className="tbl">
              <div className="tbl-h">
                <div>Rank</div><div>Member</div><div>Role</div><div>Contributed</div><div>Level</div><div>Share</div>
              </div>
              {ranked.map((m, i) => {
                const meta = roleMeta(m.role);
                const pct = Math.round(((m.totalContributed || 0) / max) * 100);
                return (
                  <div className={`tbl-r${m.id === currentUser?.uid ? ' you' : ''}`} key={m.id}>
                    <div className="tbl-rank">#{i + 1}</div>
                    <div className="tbl-name">
                      <div className={`tav ${avatarClass(m.id)}`}>
                        {m.user?.avatar ? <img src={m.user.avatar} alt="" /> : initials(nameOf(m.user))}
                      </div>
                      <div>
                        <div className="nm">{nameOf(m.user)}</div>
                        <div className="hd">@{m.user?.username || 'user'}</div>
                      </div>
                    </div>
                    <div>
                      <span className={`role-pill ${meta.pill}`}>
                        {meta.icon && <span className="material-symbols-outlined">{meta.icon}</span>}{meta.label}
                      </span>
                    </div>
                    <div className="tbl-cell gold">{compact(m.totalContributed || 0)}</div>
                    <div className="tbl-cell">{m.user?.vpLevel || m.user?.level || 1}</div>
                    <div className="contrib-bar">
                      <div className="bar"><div style={{ width: `${pct}%` }} /></div>
                      <span className="tbl-cell">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </main>
  );

  return (
    <SquadShell mode="squad" activeId="leaderboard" squadId={squadId}
      rightRail={<SquadInfoRail squad={squad} members={ranked} />}>
      {main}
    </SquadShell>
  );
}
