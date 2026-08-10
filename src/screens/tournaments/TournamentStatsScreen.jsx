// TournamentStatsScreen — personal tournament dossier.
// Route: /tournaments/me/stats
//
// Aggregates over the user's match history:
//   - W/L per game · prize won · avg placement
//   - Rival list (faced ≥3 times)
//   - Trust score breakdown
//   - Recent completed matches with share buttons
//
// All client-side — uses existing tournament + match docs. For real scale
// (>1000 matches per user), move to a `user_tournament_stats/{uid}` rollup
// updated by a trigger; not built yet.

import { useEffect, useMemo, useState } from 'react';
import { collectionGroup, query, where, getDocs, limit } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase/config';
import { createPost } from '../../firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import TrustBadge from '../../components/tournament/TrustBadge';

const C = {
  bg: '#0B0B14', surface: '#14141F',
  border: 'rgba(255,255,255,0.10)',
  text: '#fff', dim: 'rgba(255,255,255,0.65)', mute: 'rgba(255,255,255,0.45)',
  gold: '#F0A500', cyan: '#B44FFF', green: '#22c55e', red: '#ef4444',
};

export default function TournamentStatsScreen() {
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const uid = currentUser?.uid;
  const [matches, setMatches] = useState([]);
  const [rivals, setRivals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) return;
    (async () => {
      setLoading(true);
      try {
        const [q1, q2] = await Promise.all([
          getDocs(query(collectionGroup(db, 'matches'),
            where('player1', '==', uid), where('status', '==', 'completed'), limit(200))),
          getDocs(query(collectionGroup(db, 'matches'),
            where('player2', '==', uid), where('status', '==', 'completed'), limit(200))),
        ]);
        const ms = [...q1.docs, ...q2.docs].map((d) => ({ id: d.id, path: d.ref.path, ...d.data() }));
        setMatches(ms);

        // Rival map.
        const rivalMap = {};
        for (const m of ms) {
          const opp = m.player1 === uid ? m.player2 : m.player1;
          if (!opp) continue;
          rivalMap[opp] = rivalMap[opp] || { uid: opp, matches: 0, wins: 0, losses: 0 };
          rivalMap[opp].matches++;
          if (m.winner === uid) rivalMap[opp].wins++;
          else if (m.winner === opp) rivalMap[opp].losses++;
        }
        setRivals(Object.values(rivalMap).filter((r) => r.matches >= 3).sort((a, b) => b.matches - a.matches));
      } catch (err) {
        console.error(err);
      } finally { setLoading(false); }
    })();
  }, [uid]);

  const stats = useMemo(() => {
    const wins = matches.filter((m) => m.winner === uid).length;
    const losses = matches.length - wins;
    const byGame = {};
    for (const m of matches) {
      const g = m.game || 'unknown';
      byGame[g] = byGame[g] || { game: g, wins: 0, losses: 0 };
      if (m.winner === uid) byGame[g].wins++; else byGame[g].losses++;
    }
    return {
      total: matches.length, wins, losses,
      winRate: matches.length ? Math.round((wins / matches.length) * 100) : 0,
      byGame: Object.values(byGame).sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses)),
    };
  }, [matches, uid]);

  // AG1 — VOD highlights playlist. Flatten the Gemini-cut clips
  // (match.highlights[]) across every match this user played that has an
  // archived VOD. Newest first.
  const highlights = useMemo(() => {
    const out = [];
    for (const m of matches) {
      if (!m.archiveVodUrl || !Array.isArray(m.highlights) || !m.highlights.length) continue;
      for (const clip of m.highlights) {
        if (clip?.startSec == null || clip?.endSec == null) continue;
        out.push({
          key: `${m.id}-${clip.startSec}`,
          vodUrl: m.archiveVodUrl,
          startSec: Math.floor(clip.startSec),
          endSec: Math.ceil(clip.endSec),
          title: clip.title || 'Highlight',
          reason: clip.reason || '',
          game: m.game || '',
          atMs: m.highlightsAtMs || 0,
        });
      }
    }
    return out.sort((a, b) => b.atMs - a.atMs).slice(0, 12);
  }, [matches]);

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text }}>
      <TopBar showBack title="Tournament Stats" />
      <div style={{ padding: 16, maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Kpi label="Matches" value={stats.total} color={C.text} />
          <Kpi label="Wins" value={stats.wins} color={C.green} />
          <Kpi label="Losses" value={stats.losses} color={C.red} />
          <Kpi label="Win Rate" value={`${stats.winRate}%`} color={C.gold} />
        </div>

        <Section title="Trust">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <UserAvatar uid={uid} size="lg" />
            <TrustBadge uid={uid} size="lg" />
          </div>
        </Section>

        <Section title={`Per Game (${stats.byGame.length})`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stats.byGame.map((g) => (
              <div key={g.game} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, fontSize: 13 }}>{g.game}</div>
                <div style={{ fontSize: 12, color: C.green, fontFamily: 'DM Mono, monospace' }}>{g.wins}W</div>
                <div style={{ fontSize: 12, color: C.red, fontFamily: 'DM Mono, monospace' }}>{g.losses}L</div>
              </div>
            ))}
            {stats.byGame.length === 0 && <div style={{ color: C.mute, fontSize: 12 }}>No matches yet.</div>}
          </div>
        </Section>

        <Section title={`Suggested moments (${highlights.length})`}>
          <div style={{ fontSize: 11, color: C.mute, marginBottom: 10, lineHeight: 1.5 }}>
            AI-suggested moments from your tournament VODs. Only you can see these.
            Save the ones you like as a clip on your profile — nothing is published until you choose to.
          </div>
          {highlights.length === 0 ? (
            <div style={{ color: C.mute, fontSize: 12 }}>
              No suggestions yet — they appear here after your matches are archived.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: IS_NATIVE_BUILD ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
              {highlights.map((h) => <HighlightCard key={h.key} clip={h} uid={uid} showToast={showToast} />)}
            </div>
          )}
        </Section>

        <Section title={`Rivals (${rivals.length})`}>
          {rivals.length === 0 ? (
            <div style={{ color: C.mute, fontSize: 12 }}>No rivalries yet — face someone ≥3 times to qualify.</div>
          ) : rivals.map((r) => (
            <div key={r.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
              <UserAvatar uid={r.uid} size="sm" />
              <div style={{ flex: 1, minWidth: 0, fontSize: 13,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.uid.slice(0, 12)}
              </div>
              <div style={{ fontSize: 11, color: C.dim, fontFamily: 'DM Mono, monospace' }}>
                {r.wins}W · {r.losses}L · {r.matches}m
              </div>
            </div>
          ))}
        </Section>

        {loading && <div style={{ color: C.dim, textAlign: 'center', padding: 20 }}>Loading…</div>}
      </div>
    </div>
  );
}

// AG1 — a single AI-suggested moment (private to the owner). Click-to-load
// video seeked to the clip range via a media fragment (#t=start,end). The
// owner can "Save as clip" to publish a user-chosen clip post — nothing is
// surfaced publicly until they do.
function HighlightCard({ clip, uid, showToast }) {
  const [play, setPlay] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dur = Math.max(1, clip.endSec - clip.startSec);

  const saveAsClip = async () => {
    if (saving || saved || !uid) return;
    setSaving(true);
    try {
      await createPost(uid, {
        content: clip.title || 'Tournament highlight',
        type: 'clip',
        mediaUrls: [`${clip.vodUrl}#t=${clip.startSec},${clip.endSec}`],
        hashtags: clip.game ? [String(clip.game).toLowerCase()] : [],
        visibility: 'public',
      });
      setSaved(true);
      showToast?.('Saved as a clip on your profile', 'success');
    } catch (err) {
      showToast?.(err?.message || 'Could not save clip', 'error');
    } finally { setSaving(false); }
  };

  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#000' }}>
        {play ? (
          <video
            src={`${clip.vodUrl}#t=${clip.startSec},${clip.endSec}`}
            controls autoPlay
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
          />
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
        <button onClick={saveAsClip} disabled={saving || saved} style={{
          marginTop: 8, width: '100%', padding: '6px 0', borderRadius: 8,
          border: `1px solid ${saved ? C.border : C.cyan + '66'}`,
          background: saved ? 'transparent' : `${C.cyan}1a`,
          color: saved ? C.mute : C.cyan, fontSize: 11, fontWeight: 800,
          cursor: saved ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
        }}>{saved ? '✓ Saved as clip' : saving ? 'Saving…' : 'Save as clip'}</button>
      </div>
    </div>
  );
}

function Kpi({ label, value, color }) {
  return (
    <div style={{ padding: 14, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12 }}>
      <div style={{ fontSize: 10, color: C.mute, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color, fontFamily: 'DM Mono, monospace', marginTop: 4 }}>{value}</div>
    </div>
  );
}
function Section({ title, children }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
      <div style={{ fontSize: 11, color: C.mute, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}
