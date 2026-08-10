// Native Squad Media — /squads/:squadId/media on the APK. 3-col gallery.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { collection, query, orderBy, limit as fbLimit, onSnapshot, where } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import { getSquad } from '../../../firebase/firestore';
import NativeSquadScaffold from './NativeSquadScaffold';

const MEDIA_TYPES = ['image', 'gif', 'clip', 'video', 'meme'];

export default function NativeSquadMediaScreen() {
  const { squadId } = useParams();
  const [squad, setSquad] = useState(null);
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if (squadId) getSquad(squadId).then(setSquad).catch(() => {}); }, [squadId]);

  useEffect(() => {
    if (!squadId) return;
    const q = query(collection(db, 'squads', squadId, 'messages'), where('type', 'in', MEDIA_TYPES), orderBy('createdAt', 'desc'), fbLimit(60));
    return onSnapshot(q, (snap) => { setMedia(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); setLoading(false); }, () => setLoading(false));
  }, [squadId]);

  return (
    <NativeSquadScaffold mode="squad" title="Media" activeId="media" squadId={squadId} squadName={squad?.name}>
      <div style={{ padding: 16 }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 60 }}>Loading…</div>
        ) : media.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', gap: 12, color: 'var(--t3)', textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px dashed rgba(255,255,255,.08)', borderRadius: 18 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 48, opacity: .45 }}>photo_library</span>
            <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: 'var(--t1)' }}>No media yet</div>
            <div style={{ fontSize: 13 }}>Drop a screenshot, clip, or GIF in chat and it'll show up here.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
            {media.map((m) => (
              <div key={m.id} style={{ aspectRatio: '1', borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,.06)', background: '#0B0B14', position: 'relative' }}>
                {(m.type === 'clip' || m.type === 'video')
                  ? <video src={m.contentUrl} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <img src={m.contentUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                {(m.type === 'clip' || m.type === 'video') && <span className="material-symbols-outlined" style={{ position: 'absolute', top: 6, right: 6, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,.6)', fontSize: 18 }}>play_circle</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </NativeSquadScaffold>
  );
}
