// Squad Pinned — every chat message flagged pinned == true. Click to jump.
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getSquad, getSquadMembers } from '../../firebase/firestore';
import SquadShell from '../../components/squad/SquadShell';
import SquadInfoRail from '../../components/squad/SquadInfoRail';
import { avatarClass, initials } from '../../components/squad/squadHelpers';

const tsMs = (t) => (t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : t ? new Date(t).getTime() : 0);
const dateLabel = (t) => {
  const ms = tsMs(t);
  if (!ms) return '';
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function SquadPinnedScreen() {
  const { squadId } = useParams();
  const navigate = useNavigate();
  const [squad, setSquad] = useState(null);
  const [members, setMembers] = useState([]);
  const [pinned, setPinned] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!squadId) return;
    getSquad(squadId).then(setSquad).catch(() => {});
    getSquadMembers(squadId).then(setMembers).catch(() => {});
  }, [squadId]);

  useEffect(() => {
    if (!squadId) return;
    const q = query(
      collection(db, 'squads', squadId, 'messages'),
      where('pinned', '==', true),
      orderBy('createdAt', 'desc'),
    );
    return onSnapshot(q, (snap) => {
      setPinned(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
  }, [squadId]);

  return (
    <SquadShell mode="squad" activeId="pinned" squadId={squadId} rightRail={<SquadInfoRail squad={squad} members={members} />}>
      <main className="main" style={{ overflowY: 'auto' }}>
        <header className="channel-header">
          <div className="channel-title">
            <span className="channel-name">Pinned Messages</span>
            <span className="channel-divider" />
            <span className="channel-desc">Important moments locked to the top</span>
          </div>
        </header>

        <div style={{ padding: 22 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 60 }}>Loading…</div>
          ) : pinned.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', gap: 12, color: 'var(--t3)', textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px dashed rgba(255,255,255,.08)', borderRadius: 18 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 48, opacity: .45 }}>push_pin</span>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: 'var(--t1)' }}>Nothing pinned yet</div>
              <div style={{ fontSize: 13, maxWidth: 380 }}>Hover over a chat message → click the pin icon to keep it here.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {pinned.map((m) => (
                <button
                  key={m.id}
                  onClick={() => navigate(`/squads/${squadId}/chat`)}
                  style={{ display: 'flex', gap: 12, padding: 14, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 14, textAlign: 'left', cursor: 'pointer' }}
                >
                  <div className={`squad-avatar ${avatarClass(m.senderId)}`} style={{ width: 36, height: 36, fontSize: 13 }}>
                    {m.senderAvatar ? <img src={m.senderAvatar} alt="" /> : initials(m.senderName)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                      <span style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 13, color: '#fff' }}>{m.senderName || 'User'}</span>
                      <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: 'var(--t3)' }}>{dateLabel(m.createdAt)}</span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 13, color: 'var(--t2)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                      {m.text || (m.type === 'image' ? '[image]' : m.type === 'voice' ? '[voice note]' : `[${m.type || 'media'}]`)}
                    </div>
                  </div>
                  <span className="material-symbols-outlined" style={{ color: 'var(--cyan)', fontSize: 18, alignSelf: 'center' }}>arrow_forward</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>
    </SquadShell>
  );
}
