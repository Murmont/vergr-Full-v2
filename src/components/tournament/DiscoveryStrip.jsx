// DiscoveryStrip — set of compact home-feed widgets:
//
//   <StartingSoonCarousel />      horizontal scroller of tournaments
//                                  starting in the next 15 min, with live
//                                  participant avatars.
//   <TournamentOfTheDayCard />    one tile, picked nightly by
//                                  tournamentOfTheDayCron, house-boosted.
//   <CrossTournamentLeaderboard /> top 10 players this week by tournamentWins.
//
// All read straight from Firestore; no extra Cloud Functions needed.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import UserAvatar from '../UserAvatar';
import Icon from '../Icon';

const C = {
  surface: '#14141F', border: 'rgba(255,255,255,0.10)',
  text: '#fff', dim: 'rgba(255,255,255,0.65)', mute: 'rgba(255,255,255,0.45)',
  gold: '#F0A500', goldLight: '#F5C842', cyan: '#B44FFF',
};

export function StartingSoonCarousel() {
  const nav = useNavigate();
  const [items, setItems] = useState([]);
  useEffect(() => {
    (async () => {
      const now = new Date();
      const in15 = new Date(now.getTime() + 15 * 60_000);
      try {
        const q = query(
          collection(db, 'tournaments'),
          where('scheduledStart', '>=', now),
          where('scheduledStart', '<=', in15),
          orderBy('scheduledStart', 'asc'), limit(8),
        );
        const snap = await getDocs(q);
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch { setItems([]); }
    })();
    const t = setInterval(() => {}, 60_000); // re-render labels
    return () => clearInterval(t);
  }, []);
  if (items.length === 0) return null;
  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{ padding: '0 12px', display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: C.gold, textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 900 }}>
          Starting soon
        </div>
        <button onClick={() => nav('/tournaments')} style={{
          background: 'none', border: 'none', color: C.dim, fontSize: 11, cursor: 'pointer',
        }}>See all</button>
      </div>
      <div style={{
        display: 'flex', gap: 10, overflowX: 'auto', padding: '0 12px',
        scrollSnapType: 'x mandatory',
      }}>
        {items.map((t) => {
          const mins = Math.max(0, Math.ceil((t.scheduledStart?.toMillis?.() - Date.now()) / 60_000));
          return (
            <button key={t.id} onClick={() => nav(`/match/${t.id}`)} style={{
              flex: '0 0 220px', textAlign: 'left',
              padding: 12, borderRadius: 14, scrollSnapAlign: 'start',
              background: C.surface, border: `1px solid ${C.border}`, cursor: 'pointer',
            }}>
              <div style={{ display: 'flex', gap: -8 }}>
                {(t.participants || []).slice(0, 4).map((uid, i) => (
                  <div key={uid} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                    <UserAvatar uid={uid} size="xs" />
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginTop: 6,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.name}
              </div>
              <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                {t.game} · {t.participants?.length || 0} players
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: C.gold, fontWeight: 800, fontFamily: 'DM Mono, monospace' }}>
                {mins === 0 ? 'Starting' : `${mins}m`}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TournamentOfTheDayCard() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const d = await getDoc(doc(db, 'featured', 'tournament_of_the_day'));
        if (d.exists()) setData(d.data());
      } catch { /* ignore */ }
    })();
  }, []);
  if (!data?.tournamentId) return null;
  return (
    <button onClick={() => nav(`/match/${data.tournamentId}`)} style={{
      width: '100%', padding: 18, borderRadius: 16, cursor: 'pointer',
      background: `linear-gradient(135deg, ${C.gold}33, ${C.goldLight}11)`,
      border: `1px solid ${C.gold}66`, textAlign: 'left',
    }}>
      <div style={{ fontSize: 10, color: C.gold, fontWeight: 900,
        textTransform: 'uppercase', letterSpacing: '0.2em' }}>Tournament of the Day</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: C.text, marginTop: 4 }}>{data.name}</div>
      <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{data.game}</div>
    </button>
  );
}

export function CrossTournamentLeaderboard() {
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  useEffect(() => {
    (async () => {
      try {
        const q = query(collection(db, 'users'),
          orderBy('tournamentWins', 'desc'), limit(10));
        const snap = await getDocs(q);
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .filter((u) => (u.tournamentWins || 0) > 0));
      } catch { /* ignore */ }
    })();
  }, []);
  if (rows.length === 0) return null;
  return (
    <div style={{ padding: 16, borderRadius: 14, background: C.surface, border: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: C.cyan, fontWeight: 900,
          textTransform: 'uppercase', letterSpacing: '0.14em' }}>Top Champions · Week</div>
        <button onClick={() => nav('/leaderboard?category=tournamentWins')} style={{
          background: 'none', border: 'none', color: C.dim, fontSize: 11, cursor: 'pointer',
        }}>See all</button>
      </div>
      {rows.map((u, i) => (
        <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
          <div style={{ width: 22, textAlign: 'center', fontFamily: 'DM Mono, monospace',
            color: i < 3 ? C.gold : C.mute, fontWeight: 900 }}>{i + 1}</div>
          <UserAvatar uid={u.id} size="sm" />
          <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: C.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</div>
          <div style={{ fontSize: 11, color: C.gold, fontFamily: 'DM Mono, monospace' }}>
            {u.tournamentWins || 0} W
          </div>
        </div>
      ))}
    </div>
  );
}
