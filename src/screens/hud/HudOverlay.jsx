// HudOverlay — the in-game overlay that renders in the secondary Tauri
// window (label="hud"). Transparent, click-through-by-default, always on top.
//
// 4-light status strip:
//   REC  · vergr-ingest receiving chunks
//   OCR  · vergr-ocr scoreboard reads matching
//   MOD  · a Vanguard mod is watching (avatar pulse)
//   OPP  · opponent verified + heartbeating
//
// Heartbeat micro-pulse every 30s proves the system isn't frozen.
// Hovering the HUD disables click-through so the user can interact;
// moving off re-enables it.

import { useEffect, useState } from 'react';
import { doc, onSnapshot, collection, query, where, limit } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { setHudClickThrough, listenHudMatch, listenHudClear } from '../../utils/tauriHud';

const C = {
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444',
  cyan: '#B44FFF', violet: '#7B6FFF',
  bg: 'rgba(11,11,20,0.78)', border: 'rgba(255,255,255,0.10)',
  text: '#fff', dim: 'rgba(255,255,255,0.65)', mute: 'rgba(255,255,255,0.40)',
};

export default function HudOverlay() {
  const [matchPath, setMatchPath] = useState(localStorage.getItem('vergr.hud.matchPath') || null);
  const [match, setMatch] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [modAssignment, setModAssignment] = useState(null);
  const [heartbeat, setHeartbeat] = useState(0);
  const [expanded, setExpanded] = useState(false);

  // Subscribe to match doc when path is set.
  useEffect(() => {
    if (!matchPath) return;
    const [tId, mId] = matchPath.split('|');
    if (!tId || !mId) return;
    const unsubM = onSnapshot(doc(db, 'tournaments', tId, 'matches', mId), (s) => setMatch({ id: s.id, ...s.data() }));
    const unsubT = onSnapshot(doc(db, 'tournaments', tId), (s) => setTournament({ id: s.id, ...s.data() }));
    return () => { unsubM(); unsubT(); };
  }, [matchPath]);

  // Cross-window pub/sub via Tauri events (falls back to storage in browser).
  useEffect(() => {
    const offSet = listenHudMatch(({ tournamentId, matchId }) => {
      setMatchPath(`${tournamentId}|${matchId}`);
    });
    const offClear = listenHudClear(() => { setMatchPath(null); setMatch(null); });
    return () => {
      Promise.resolve(offSet).then((f) => f && f());
      Promise.resolve(offClear).then((f) => f && f());
    };
  }, []);

  // Subscribe to assigned Vanguard mod presence.
  useEffect(() => {
    if (!tournament?.id) return;
    const q = query(
      collection(db, 'tournament_assignments'),
      where('tournamentId', '==', tournament.id),
      where('status', '==', 'active'), limit(1),
    );
    const unsub = onSnapshot(q, (snap) => {
      const d = snap.docs[0];
      setModAssignment(d ? { id: d.id, ...d.data() } : null);
    });
    return () => unsub();
  }, [tournament?.id]);

  // 30s heartbeat pulse.
  useEffect(() => {
    const i = setInterval(() => setHeartbeat((h) => h + 1), 30_000);
    return () => clearInterval(i);
  }, []);

  // Light states.
  const recOk = !!(match?.lobbyCode); // proxy until we wire streaming session here
  const ocrOk = match?.bothVerifiedAt
    || Object.values(match?.verifyState || {}).some((v) => v.source === 'ocr');
  const modOk = !!modAssignment && (Date.now() - (modAssignment.lastSeenAt?.toMillis?.() || 0) < 60_000);
  const oppOk = (() => {
    if (!match) return false;
    const s = match.verifyState || {};
    return Object.values(s).every((v) => v.status === 'verified' || v.status === 'self_attested');
  })();

  // Click-through toggle on hover.
  const handleMouseEnter = () => setHudClickThrough(false);
  const handleMouseLeave = () => setHudClickThrough(true);

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        position: 'fixed', inset: 0, padding: 8,
        fontFamily: '"DM Sans", system-ui, sans-serif',
        userSelect: 'none', cursor: 'default',
      }}>
      {!matchPath && (
        <div style={{
          padding: 10, background: C.bg, border: `1px solid ${C.border}`,
          borderRadius: 12, color: C.dim, fontSize: 11,
          backdropFilter: 'blur(12px)',
        }}>VERGR HUD · idle</div>
      )}
      {matchPath && (
        <div style={{
          background: C.bg, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: 10, backdropFilter: 'blur(12px)',
          minWidth: 220,
        }}>
          {/* Top row: 4-light status strip */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Light label="REC" ok={recOk} pulseKey={heartbeat} />
            <Light label="OCR" ok={ocrOk} pulseKey={heartbeat} />
            <Light label="MOD" ok={modOk} pulseKey={heartbeat} />
            <Light label="OPP" ok={oppOk} pulseKey={heartbeat} />
            <button onClick={() => setExpanded(!expanded)} style={{
              marginLeft: 'auto', background: 'transparent', border: 'none',
              color: C.dim, fontSize: 16, cursor: 'pointer', lineHeight: 1,
            }}>{expanded ? '–' : '+'}</button>
          </div>

          {/* Match label */}
          {match && (
            <div style={{
              marginTop: 6, fontSize: 10, color: C.mute, fontFamily: 'DM Mono, monospace',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              R{match.round}·M{match.matchNumber} · {tournament?.game}
            </div>
          )}

          {/* Lobby code (pre-match only) */}
          {match?.lobbyCode && !match?.bothVerifiedAt && (
            <div style={{
              marginTop: 6, padding: '6px 8px', borderRadius: 6,
              background: 'rgba(240,165,0,0.10)', border: '1px solid rgba(240,165,0,0.30)',
              fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 900,
              color: '#F5C842', textAlign: 'center', letterSpacing: '0.05em',
            }}>{match.lobbyCode}</div>
          )}

          {/* Expanded: mod avatar + click-to-chat hint + transparency */}
          {expanded && (
            <div style={{ marginTop: 8, fontSize: 10, color: C.dim, lineHeight: 1.5 }}>
              {modOk && modAssignment ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: 4, background: C.violet,
                    animation: 'modPulse 2s ease-in-out infinite',
                  }} />
                  <span>Mod watching · click VERGR app to chat</span>
                </div>
              ) : (
                <div style={{ color: C.mute }}>No mod assigned yet.</div>
              )}
              <div style={{ marginTop: 6, color: C.mute }}>
                Match integrity is being monitored.
              </div>
              <button onClick={() => window.location.reload()} style={{
                marginTop: 6, padding: '4px 8px', borderRadius: 4,
                background: 'transparent', border: `1px solid ${C.border}`,
                color: C.dim, fontSize: 9, cursor: 'pointer',
              }}>Reload</button>
            </div>
          )}
        </div>
      )}
      <style>{`
        @keyframes modPulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
        @keyframes lightPulse { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.4); opacity: 0; } }
      `}</style>
    </div>
  );
}

function Light({ label, ok, pulseKey }) {
  const color = ok ? C.green : C.amber;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div style={{ position: 'relative', width: 10, height: 10 }}>
        <div style={{
          width: 10, height: 10, borderRadius: 5, background: color,
          boxShadow: `0 0 6px ${color}`,
        }} />
        {ok && (
          <div key={pulseKey} style={{
            position: 'absolute', inset: 0, borderRadius: 5, background: color,
            animation: 'lightPulse 1.4s ease-out',
          }} />
        )}
      </div>
      <div style={{
        fontSize: 8, fontWeight: 900, color: ok ? color : C.mute,
        fontFamily: 'DM Mono, monospace', letterSpacing: '0.06em',
      }}>{label}</div>
    </div>
  );
}
