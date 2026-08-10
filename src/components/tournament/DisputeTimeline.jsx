// DisputeTimeline — chronological list of every signal that fed a
// disputed match's resolution. Used by mod review screens; can also be
// shown to participants post-resolution for transparency.
//
// Pulls from the match doc + verifyState + aiSummary + lobbyVerification
// + vanguard_actions filtered by matchId.

import { useEffect, useState } from 'react';
import { collection, query, where, orderBy, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import Icon from '../Icon';

const C = {
  surface: '#14141F', border: 'rgba(255,255,255,0.10)',
  text: '#fff', dim: 'rgba(255,255,255,0.65)', mute: 'rgba(255,255,255,0.45)',
  cyan: '#B44FFF', green: '#22c55e', amber: '#f59e0b', red: '#ef4444',
};

export default function DisputeTimeline({ tournamentId, matchId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out = [];
      const mRef = doc(db, 'tournaments', tournamentId, 'matches', matchId);
      const m = (await getDoc(mRef)).data();
      if (m) {
        if (m.createdAt) out.push({ at: tsMs(m.createdAt), kind: 'created', text: 'Match created', icon: 'add_circle', color: C.dim });
        if (m.lobbyCode) out.push({ at: tsMs(m.createdAt), kind: 'lobby_code', text: `Lobby code ${m.lobbyCode} generated`, icon: 'qr_code', color: C.cyan });
        const vs = m.verifyState || {};
        for (const [uid, v] of Object.entries(vs)) {
          if (v.at) out.push({
            at: tsMs(v.at), kind: 'verify', text: `${uid.slice(0, 6)}… → ${v.status} via ${v.source || '?'}`,
            icon: v.status === 'verified' ? 'verified' : v.status === 'rejected' ? 'block' : 'pending',
            color: v.status === 'verified' ? C.green : v.status === 'rejected' ? C.red : C.amber,
          });
        }
        if (m.bothVerifiedAt) out.push({ at: tsMs(m.bothVerifiedAt), kind: 'play', text: 'Both sides verified — play started', icon: 'play_arrow', color: C.green });
        if (m.aiSummary?.computedAtMs) out.push({
          at: m.aiSummary.computedAtMs, kind: 'ai',
          text: `AI: ${m.aiSummary.verdict} (${Math.round((m.aiSummary.confidence || 0) * 100)}%) — ${m.aiSummary.text}`,
          icon: 'smart_toy', color: C.cyan,
        });
        if (m.disputedAt) out.push({ at: tsMs(m.disputedAt), kind: 'dispute', text: 'Disputed — reports disagreed', icon: 'warning', color: C.amber });
        if (m.completedAt) out.push({ at: tsMs(m.completedAt), kind: 'complete', text: `Completed — winner ${m.winner?.slice(0, 6)}… (${m.completedBy || 'manual'})`, icon: 'flag', color: C.green });
      }
      // Vanguard actions
      try {
        const q = query(collection(db, 'vanguard_actions'), where('matchId', '==', matchId));
        const snap = await getDocs(q);
        snap.forEach((d) => {
          const data = d.data();
          out.push({
            at: tsMs(data.createdAt), kind: 'mod',
            text: `Mod ${data.actorRank || ''}: ${data.action}${data.targetUid ? ` → ${data.targetUid.slice(0, 6)}…` : ''}`,
            icon: 'shield', color: '#7B1FFF',
          });
        });
      } catch { /* index missing — ignore */ }

      if (!cancelled) {
        setEvents(out.sort((a, b) => (a.at || 0) - (b.at || 0)));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tournamentId, matchId]);

  if (loading) {
    return <div style={{ padding: 16, color: C.dim, fontSize: 12 }}>Loading timeline…</div>;
  }
  if (events.length === 0) {
    return <div style={{ padding: 16, color: C.mute, fontSize: 12 }}>No events recorded.</div>;
  }
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
      <div style={{ fontSize: 11, color: C.mute, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>
        Dispute Timeline · {events.length} events
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {events.map((e, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Icon name={e.icon} size={16} className="" style={{ color: e.color, marginTop: 2, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: C.text, lineHeight: 1.4 }}>{e.text}</div>
              <div style={{ fontSize: 10, color: C.mute, fontFamily: 'DM Mono, monospace' }}>
                {e.at ? new Date(e.at).toLocaleTimeString() : '—'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function tsMs(t) {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (t.toMillis) return t.toMillis();
  if (t.seconds) return t.seconds * 1000;
  return 0;
}
