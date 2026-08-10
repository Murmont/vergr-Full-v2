// Native Squad Leaderboard — /squads/:squadId/leaderboard on the APK.
// Podium + "you" card + a compact ranked list (no wide desktop table).
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { getSquad, getSquadLeaderboard } from '../../../firebase/firestore';
import { roleMeta, avatarClass, initials, nameOf, compact } from '../../../components/squad/squadHelpers';
import NativeSquadScaffold from './NativeSquadScaffold';

export default function NativeSquadLeaderboardScreen() {
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
      try { const [s, r] = await Promise.all([getSquad(squadId), getSquadLeaderboard(squadId)]); if (!alive) return; setSquad(s); setRanked(r); }
      catch (e) { /* ignore */ }
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
        <div className={`pav ${avatarClass(m.id)}`}>{m.user?.avatar ? <img src={m.user.avatar} alt="" /> : initials(nameOf(m.user))}</div>
        <div className="nm">{nameOf(m.user)}</div>
        <div className="prole" style={{ color: `var(--${meta.name || 't3'})` }}>{meta.label}</div>
        <div className="vp">{compact(m.totalContributed || 0)}</div>
        <div className="vp-l">Contributed</div>
      </div>
    );
  };

  return (
    <NativeSquadScaffold mode="squad" title="Leaderboard" activeId="leaderboard" squadId={squadId} squadName={squad?.name}>
      <div style={{ padding: 16 }}>
        {loading ? <div className="dim center" style={{ padding: 48 }}>Loading…</div>
          : ranked.length === 0 ? (
            <div className="empty">
              <div className="ic"><span className="material-symbols-outlined">leaderboard</span></div>
              <div className="t">No rankings yet</div>
              <div className="d">Contribute coins to the squad treasury to climb the board.</div>
            </div>
          ) : (
            <>
              <div className="podium-row">{Podium(top[1], 2)}{Podium(top[0], 1)}{Podium(top[2], 3)}</div>

              {me && (
                <div className="you-card">
                  <div className={`yav ${avatarClass(me.id)}`}>{me.user?.avatar ? <img src={me.user.avatar} alt="" /> : initials(nameOf(me.user))}</div>
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
                {ranked.map((m, i) => {
                  const meta = roleMeta(m.role);
                  const pct = Math.round(((m.totalContributed || 0) / max) * 100);
                  const isMe = m.id === currentUser?.uid;
                  return (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, background: isMe ? 'rgba(123,31,255,.12)' : 'rgba(255,255,255,.025)', border: `1px solid ${isMe ? 'rgba(180,79,255,.3)' : 'rgba(255,255,255,.06)'}` }}>
                      <span style={{ width: 26, textAlign: 'center', fontFamily: 'DM Mono', fontWeight: 800, color: i === 0 ? 'var(--gold-light)' : 'var(--t2)' }}>#{i + 1}</span>
                      <div className={`squad-avatar ${avatarClass(m.id)}`} style={{ width: 36, height: 36, fontSize: 13 }}>{m.user?.avatar ? <img src={m.user.avatar} alt="" /> : initials(nameOf(m.user))}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOf(m.user)}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                          <span className={`role-pill ${meta.pill}`} style={{ fontSize: 9 }}>{meta.icon && <span className="material-symbols-outlined">{meta.icon}</span>}{meta.label}</span>
                          <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: 'var(--t3)' }}>Lvl {m.user?.vpLevel || m.user?.level || 1}</span>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: 'DM Mono', fontSize: 12.5, fontWeight: 700, color: 'var(--gold-light)' }}>{compact(m.totalContributed || 0)}</div>
                        <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: 'var(--t3)' }}>{pct}%</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
      </div>
    </NativeSquadScaffold>
  );
}
