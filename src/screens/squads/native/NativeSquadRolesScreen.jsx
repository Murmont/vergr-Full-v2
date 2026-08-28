// Native Squad Roles & Permissions — /squads/:squadId/roles on the APK.
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSquad, getSquadMembers } from '../../../firebase/firestore';
import { roleMeta, avatarClass, initials, nameOf } from '../../../components/squad/squadHelpers';
import NativeSquadScaffold from './NativeSquadScaffold';

const ROLES = [
  { id: 'president',      blurb: 'Sets squad direction, accepts members, manages treasury. One per squad.' },
  { id: 'vice_president', blurb: 'Assists the President. Can approve join requests and post announcements.' },
  { id: 'treasury',       blurb: 'Manages squad coin pool: event entries, member rewards, payouts.' },
  { id: 'security',       blurb: 'Mod tools: mute, kick votes, and conflict resolution.' },
  { id: 'member',         blurb: 'Standard squad member.' },
];

export default function NativeSquadRolesScreen() {
  const { squadId } = useParams();
  const navigate = useNavigate();
  const [squad, setSquad] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!squadId) return;
    let alive = true;
    Promise.all([getSquad(squadId), getSquadMembers(squadId)])
      .then(([s, m]) => { if (alive) { setSquad(s); setMembers(m); } })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [squadId]);

  const byRole = (rid) => members.filter((m) => (m.role || 'member') === rid || (rid === 'vice_president' && m.role === 'co-leader') || (rid === 'security' && m.role === 'officer'));

  const actions = <button className="icon-btn" title="Start a vote" onClick={() => navigate(`/squads/${squadId}/chat`)}><span className="material-symbols-outlined">how_to_vote</span></button>;

  return (
    <NativeSquadScaffold mode="squad" title="Roles" activeId="roles" squadId={squadId} squadName={squad?.name} actions={actions}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ padding: 14, background: 'rgba(123,31,255,.08)', border: '1px solid rgba(180,79,255,.22)', borderRadius: 14, color: 'var(--t2)', fontSize: 12.5, lineHeight: 1.6 }}>
          <strong style={{ color: '#fff' }}>Role changes are democratic.</strong> Send <code>/vote</code> in chat — when half the squad seconds it within 12 hours, an election starts automatically. Voting lasts 48 hours.
        </div>
        {loading ? <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 40 }}>Loading…</div> : (
          ROLES.map((r) => {
            const meta = roleMeta(r.id);
            const holders = byRole(r.id);
            return (
              <div key={r.id} style={{ padding: 16, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span className={`role-pill ${meta.pill}`}>{meta.icon && <span className="material-symbols-outlined">{meta.icon}</span>}{meta.label}</span>
                  <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: 'var(--t3)' }}>{holders.length} holder{holders.length === 1 ? '' : 's'}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 12 }}>{r.blurb}</div>
                {holders.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {holders.map((m) => (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px 6px', background: 'rgba(255,255,255,.03)', borderRadius: 999, border: '1px solid rgba(255,255,255,.06)' }}>
                        <div className={`squad-avatar ${avatarClass(m.id)}`} style={{ width: 24, height: 24, fontSize: 10 }}>{m.user?.avatar ? <img src={m.user.avatar} alt="" /> : initials(nameOf(m.user))}</div>
                        <span style={{ fontSize: 12, color: '#fff' }}>{nameOf(m.user)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </NativeSquadScaffold>
  );
}
