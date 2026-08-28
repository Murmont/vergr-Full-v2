// Squad Analytics — quick stats roll-up from squad doc + members. Real backend
// dashboards land later; this is a useful snapshot today.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getSquad, getSquadMembers, getSquadWallet } from '../../firebase/firestore';
import SquadShell from '../../components/squad/SquadShell';
import SquadInfoRail from '../../components/squad/SquadInfoRail';
import { compact } from '../../components/squad/squadHelpers';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import usePresenceMap from '../../hooks/usePresenceMap';
import { presenceVisible } from '../../utils/presence';
import UserName from '../../components/UserName';

function Kpi({ label, value, accent }) {
  return (
    <div style={{ padding: 18, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 14 }}>
      <div style={{ fontFamily: 'DM Mono', fontSize: 26, fontWeight: 800, color: accent || '#fff' }}>{value}</div>
      <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--t3)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

export default function SquadAnalyticsScreen() {
  const { squadId } = useParams();
  const [squad, setSquad] = useState(null);
  const [members, setMembers] = useState([]);
  const [wallet, setWallet] = useState(null);

  useEffect(() => {
    if (!squadId) return;
    getSquad(squadId).then(setSquad).catch(() => {});
    getSquadMembers(squadId).then(setMembers).catch(() => {});
    getSquadWallet(squadId).then(setWallet).catch(() => {});
  }, [squadId]);

  const presMap = usePresenceMap(members.map((m) => m.id));
  const totalContributed = members.reduce((a, m) => a + (m.totalContributed || 0), 0);
  const onlineCount = members.filter((m) => presenceVisible(m.user) && presMap[m.id]).length;
  const leaderboard = [...members].sort((a, b) => (b.totalContributed || 0) - (a.totalContributed || 0)).slice(0, 5);

  return (
    <SquadShell mode="squad" activeId="analytics" squadId={squadId} rightRail={<SquadInfoRail squad={squad} members={members} />}>
      <main className="main" style={{ overflowY: 'auto' }}>
        <header className="channel-header">
          <div className="channel-title">
            <span className="channel-name">Analytics</span>
            <span className="channel-divider" />
            <span className="channel-desc">Snapshot of squad health and contributions</span>
          </div>
        </header>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: IS_NATIVE_BUILD ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <Kpi label="Members" value={squad?.memberCount ?? members.length} accent="#fff" />
            <Kpi label="Online Now" value={onlineCount} accent="var(--cyan)" />
            <Kpi label="Squad Level" value={squad?.level || 1} accent="var(--violet-light)" />
            <Kpi label="Treasury VC" value={compact(wallet?.balance || 0)} accent="var(--gold-light)" />
            <Kpi label="Total Contributed" value={compact(totalContributed)} accent="var(--violet-light)" />
          </div>

          <div style={{ padding: 18, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 14 }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 10 }}>Top Contributors</div>
            {leaderboard.length === 0 ? (
              <div style={{ color: 'var(--t3)', fontSize: 13 }}>No contributions yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {leaderboard.map((m, i) => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, background: 'rgba(255,255,255,.02)', borderRadius: 10 }}>
                    <span style={{ width: 22, textAlign: 'center', fontFamily: 'DM Mono', fontWeight: 800, color: i === 0 ? 'var(--gold-light)' : 'var(--t2)' }}>#{i + 1}</span>
                    <span style={{ flex: 1, fontSize: 13, color: '#fff' }}><UserName user={m.user} masked fallback={'Player'} /></span>
                    <span style={{ fontFamily: 'DM Mono', fontSize: 12, color: 'var(--gold-light)' }}>{compact(m.totalContributed || 0)} VC</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ padding: 14, background: 'rgba(123,31,255,.06)', border: '1px solid rgba(180,79,255,.18)', borderRadius: 14, color: 'var(--t2)', fontSize: 12.5 }}>
            Activity charts (messages/day, member growth, win rate) land in a future update once the squad metrics aggregator ships.
          </div>
        </div>
      </main>
    </SquadShell>
  );
}
