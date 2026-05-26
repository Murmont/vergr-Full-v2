// AG3 — a user's auto-cut tournament VOD highlights, surfaced on their public
// profile. Self-queries the user's completed matches (collectionGroup, same
// index the tournament-stats screen uses) and flattens the Gemini-cut clips
// (match.highlights[] written by autoCutVodHighlights). Newest first.
//
// Each card is click-to-load: it plays the archived VOD seeked to the clip
// range via a media fragment (#t=start,end) so the profile stays light.

import { useEffect, useMemo, useState } from 'react';
import { collectionGroup, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../../firebase/config';
import Icon from '../Icon';

const C = {
  bg: '#0B0B14', border: 'rgba(255,255,255,0.10)',
  text: '#fff', mute: 'rgba(255,255,255,0.45)', cyan: '#4DFFD4',
};

export default function UserHighlightsReel({ uid, max = 9 }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [q1, q2] = await Promise.all([
          getDocs(query(collectionGroup(db, 'matches'),
            where('player1', '==', uid), where('status', '==', 'completed'), limit(150))),
          getDocs(query(collectionGroup(db, 'matches'),
            where('player2', '==', uid), where('status', '==', 'completed'), limit(150))),
        ]);
        if (cancelled) return;
        setMatches([...q1.docs, ...q2.docs].map((d) => ({ id: d.id, ...d.data() })));
      } catch { /* missing index / perms — show empty */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  const clips = useMemo(() => {
    const out = [];
    for (const m of matches) {
      if (!m.archiveVodUrl || !Array.isArray(m.highlights) || !m.highlights.length) continue;
      for (const c of m.highlights) {
        if (c?.startSec == null || c?.endSec == null) continue;
        out.push({
          key: `${m.id}-${c.startSec}`, vodUrl: m.archiveVodUrl,
          startSec: Math.floor(c.startSec), endSec: Math.ceil(c.endSec),
          title: c.title || 'Highlight', game: m.game || '', atMs: m.highlightsAtMs || 0,
        });
      }
    }
    return out.sort((a, b) => b.atMs - a.atMs).slice(0, max);
  }, [matches, max]);

  if (loading) return <div style={{ color: C.mute, fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</div>;
  if (clips.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: C.mute }}>
        <Icon name="movie" size={40} className="mx-auto mb-3" style={{ opacity: 0.3 }} />
        <p style={{ fontSize: 13 }}>No tournament highlights yet.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
      {clips.map((c) => <Clip key={c.key} clip={c} />)}
    </div>
  );
}

function Clip({ clip }) {
  const [play, setPlay] = useState(false);
  const dur = Math.max(1, clip.endSec - clip.startSec);
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#000' }}>
        {play ? (
          <video src={`${clip.vodUrl}#t=${clip.startSec},${clip.endSec}`} controls autoPlay
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />
        ) : (
          <button onClick={() => setPlay(true)} style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none', cursor: 'pointer',
          }}>
            <div style={{
              width: 46, height: 46, borderRadius: 23, background: `${C.cyan}cc`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="play_arrow" style={{ color: '#000' }} />
            </div>
          </button>
        )}
        <div style={{
          position: 'absolute', bottom: 6, right: 6, padding: '2px 6px', borderRadius: 6,
          background: 'rgba(0,0,0,0.7)', fontSize: 10, color: '#fff', fontFamily: 'DM Mono, monospace',
        }}>{dur}s</div>
      </div>
      <div style={{ padding: '8px 10px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clip.title}</div>
        {clip.game && <div style={{ fontSize: 10, color: C.mute, marginTop: 2 }}>{clip.game}</div>}
      </div>
    </div>
  );
}
