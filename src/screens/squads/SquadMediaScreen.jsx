// Squad Media — reads media-type messages from the squad chat for a quick
// gallery. No separate media collection yet.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { collection, query, orderBy, limit as fbLimit, onSnapshot, where } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getSquad, getSquadMembers } from '../../firebase/firestore';
import SquadShell from '../../components/squad/SquadShell';
import SquadInfoRail from '../../components/squad/SquadInfoRail';
import { IS_NATIVE_BUILD } from '../../utils/platform';

const MEDIA_TYPES = ['image', 'gif', 'clip', 'video', 'meme'];

export default function SquadMediaScreen() {
  const { squadId } = useParams();
  const [squad, setSquad] = useState(null);
  const [members, setMembers] = useState([]);
  const [media, setMedia] = useState([]);
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
      where('type', 'in', MEDIA_TYPES),
      orderBy('createdAt', 'desc'),
      fbLimit(60),
    );
    return onSnapshot(q, (snap) => {
      setMedia(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
  }, [squadId]);

  return (
    <SquadShell mode="squad" activeId="media" squadId={squadId} rightRail={<SquadInfoRail squad={squad} members={members} />}>
      <main className="main" style={{ overflowY: 'auto' }}>
        <header className="channel-header">
          <div className="channel-title">
            <span className="channel-name">Media</span>
            <span className="channel-divider" />
            <span className="channel-desc">Every image, clip, and GIF shared in chat</span>
          </div>
        </header>

        <div style={{ padding: 22 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 60 }}>Loading…</div>
          ) : media.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', gap: 12, color: 'var(--t3)', textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px dashed rgba(255,255,255,.08)', borderRadius: 18 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 48, opacity: .45 }}>photo_library</span>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: 'var(--t1)' }}>No media yet</div>
              <div style={{ fontSize: 13, maxWidth: 380 }}>Drop a screenshot, clip, or GIF in chat and it'll show up here.</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: IS_NATIVE_BUILD ? 'repeat(3, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
              {media.map((m) => (
                <div key={m.id} style={{ aspectRatio: '1', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,.06)', background: '#0B0B14', position: 'relative' }}>
                  {(m.type === 'clip' || m.type === 'video') ? (
                    <video src={m.contentUrl} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <img src={m.contentUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  )}
                  {(m.type === 'clip' || m.type === 'video') && (
                    <span className="material-symbols-outlined" style={{ position: 'absolute', top: 8, right: 8, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,.6)', fontSize: 18 }}>play_circle</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </SquadShell>
  );
}
