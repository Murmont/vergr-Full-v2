// ModWallScreen — Vanguard mod ops surface.
//
// Live grid of every in-progress tournament stream the mod is assigned to.
// Each tile shows a live HLS preview, both players' verifyState, AI summary
// verdict, and cheat-flag overall.
//
// Keyboard shortcuts (focused tile):
//   V  → verify focused side
//   R  → reject focused side
//   D  → mark match disputed
//   ←/→ navigate sides within a tile
//   ↑/↓ navigate tiles
//   J  → jump VOD scrubber back 30s (on the embedded review player)
//   Space → toggle live/recorded view
//
// Route: /vanguard/wall  (mod-only — VanguardRouteGate)

import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, query, where, onSnapshot, collectionGroup, getDocs, limit } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import HlsPlayer from '../../components/streams/HlsPlayer';
import UserAvatar from '../../components/UserAvatar';
import { MatchClaimButton } from '../../components/tournament/MatchClaimAndAi';

const C = {
  bg: '#0B0B14', surface: '#14141F', soft: '#1A1A2A',
  border: 'rgba(255,255,255,0.10)',
  text: '#fff', dim: 'rgba(255,255,255,0.65)', mute: 'rgba(255,255,255,0.45)',
  cyan: '#B44FFF', green: '#22c55e', amber: '#f59e0b', red: '#ef4444',
  violet: '#7B1FFF',
};

export default function ModWallScreen() {
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const fns = getFunctions(undefined, 'europe-west1');
  const [matches, setMatches] = useState([]);
  const [focus, setFocus] = useState({ row: 0, side: 0 });
  const [aiByMatch, setAiByMatch] = useState({});

  // Subscribe to:
  //   1. tournament_review_queue (AI flags + mod-routed escalations)
  //   2. all in-progress matches via collectionGroup (live grid)
  //   3. each match's stream doc for live HLS URL
  useEffect(() => {
    const unsubs = [];
    // 1. Review queue.
    unsubs.push(onSnapshot(
      query(collection(db, 'tournament_review_queue'), where('status', '==', 'pending')),
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setMatches((prev) => mergeReviewItems(prev, items));
      },
    ));
    // 2. In-progress matches across all active tournaments. collectionGroup
    // lets us subscribe to every match doc without iterating tournament IDs.
    unsubs.push(onSnapshot(
      query(
        collectionGroup(db, 'matches'),
        where('status', 'in', ['pending', 'in_progress']),
        limit(60),
      ),
      async (snap) => {
        const items = snap.docs.map((d) => {
          const m = d.data();
          // Path: tournaments/{tId}/matches/{mId}
          const parts = d.ref.path.split('/');
          return {
            matchId: d.id, tournamentId: parts[1],
            player1: m.player1, player2: m.player2,
            verifyState: m.verifyState, lobbyCode: m.lobbyCode,
            round: m.round, matchNumber: m.matchNumber,
            cheatFlag: m.cheatFlag,
            aiSuggestion: m.aiSuggestion,
            claimedModeratorId: m.claimedModeratorId,
            commanderReviewRequired: m.commanderReviewRequired,
          };
        });
        setMatches((prev) => mergeLiveMatches(prev, items));
        // 3. Resolve HLS URLs via the linked stream docs.
        for (const it of items.slice(0, 20)) {
          for (const uid of [it.player1, it.player2]) {
            if (!uid) continue;
            try {
              const sQ = await getDocs(query(
                collection(db, 'streams'),
                where('hostUid', '==', uid),
                where('status', '==', 'live'),
                limit(1),
              ));
              if (!sQ.empty) {
                const s = sQ.docs[0].data();
                setMatches((prev) => prev.map((row) =>
                  row.matchId === it.matchId ? { ...row, hlsUrl: row.hlsUrl || s.hlsUrl } : row));
              }
            } catch { /* missing index — skip */ }
          }
        }
      },
    ));
    return () => unsubs.forEach((u) => u());
  }, []);

  // Mod heartbeat — fires every 20s while this screen is open, per active
  // tournament in the grid. Powers the HUD's MOD light.
  useEffect(() => {
    if (matches.length === 0) return;
    const tIds = Array.from(new Set(matches.map((m) => m.tournamentId).filter(Boolean)));
    const ping = async () => {
      for (const tid of tIds) {
        try { await httpsCallable(fns, 'vanguardHeartbeat')({ tournamentId: tid }); } catch { /* ignore */ }
      }
    };
    ping();
    const i = setInterval(ping, 20_000);
    return () => clearInterval(i);
    // eslint-disable-next-line
  }, [matches.map((m) => m.tournamentId).join(',')]);

  // Keyboard handlers.
  useEffect(() => {
    const handler = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      const tile = matches[focus.row];
      if (!tile) return;
      const sideUid = focus.side === 0 ? tile.player1 : tile.player2;
      if (e.key === 'v' || e.key === 'V') doVerify(tile, sideUid, 'verified');
      else if (e.key === 'r' || e.key === 'R') doVerify(tile, sideUid, 'rejected');
      else if (e.key === 'd' || e.key === 'D') doDispute(tile);
      else if (e.key === 'ArrowRight') setFocus((f) => ({ ...f, side: 1 }));
      else if (e.key === 'ArrowLeft') setFocus((f) => ({ ...f, side: 0 }));
      else if (e.key === 'ArrowDown') setFocus((f) => ({ row: Math.min(f.row + 1, matches.length - 1), side: f.side }));
      else if (e.key === 'ArrowUp') setFocus((f) => ({ row: Math.max(f.row - 1, 0), side: f.side }));
      else if (e.key === 'j' || e.key === 'J') rewind30s(tile);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [matches, focus]); // eslint-disable-line

  const doVerify = async (tile, sideUid, verdict) => {
    if (!tile.tournamentId || !tile.matchId || !sideUid) return;
    try {
      await httpsCallable(fns, 'modVerifyMatchPlayer')({
        tournamentId: tile.tournamentId, matchId: tile.matchId, sideUid, verdict,
      });
      showToast(`${verdict === 'verified' ? '✓' : '✗'} ${sideUid.slice(0, 6)}`, 'success');
    } catch (err) {
      showToast(err?.message || 'Action failed', 'error');
    }
  };

  const doDispute = async (tile) => {
    showToast('Dispute marker — open match for full resolution.', 'info');
  };

  const rewind30s = (tile) => {
    const el = document.getElementById(`mod-vid-${tile.matchId}`);
    if (el && typeof el.currentTime === 'number') {
      el.currentTime = Math.max(0, el.currentTime - 30);
      showToast('-30s', 'info');
    }
  };

  const fetchAiSummary = async (tile) => {
    if (aiByMatch[tile.matchId]) return;
    try {
      const { data } = await httpsCallable(fns, 'aiSummarizeMatch')({
        tournamentId: tile.tournamentId, matchId: tile.matchId,
      });
      setAiByMatch((m) => ({ ...m, [tile.matchId]: data }));
    } catch { /* ignore */ }
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text }}>
      <TopBar showBack title="Mod Wall" subtitle="V verify · R reject · D dispute · J -30s" />
      <div style={{ padding: 12 }}>
        <div style={{
          display: 'grid', gap: 12,
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
        }}>
          {matches.length === 0 && (
            <div style={{ padding: 40, color: C.dim, textAlign: 'center', gridColumn: '1/-1' }}>
              No active matches to review.
            </div>
          )}
          {matches.map((m, idx) => (
            <ModTile
              key={m.matchId || m.id}
              tile={m} focused={focus.row === idx}
              focusSide={focus.row === idx ? focus.side : -1}
              ai={aiByMatch[m.matchId]}
              currentUid={currentUser?.uid}
              onFocus={() => setFocus({ row: idx, side: 0 })}
              onAi={() => fetchAiSummary(m)}
              onVerify={doVerify}
              onToast={showToast}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ModTile({ tile, focused, focusSide, ai, currentUid, onFocus, onAi, onVerify, onToast }) {
  const accent = focused ? C.cyan : C.border;
  return (
    <div onClick={onFocus} style={{
      background: C.surface, border: `2px solid ${accent}`, borderRadius: 14,
      overflow: 'hidden', cursor: 'pointer', transition: 'border-color .15s',
    }}>
      <div style={{ position: 'relative', aspectRatio: '16/9', background: '#000' }}>
        {tile.hlsUrl ? (
          <HlsPlayer src={tile.hlsUrl} videoId={`mod-vid-${tile.matchId}`} muted autoPlay />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: C.mute, fontSize: 12 }}>No live stream</div>
        )}
        {/* Severity badge */}
        {tile.severity && (
          <div style={{
            position: 'absolute', top: 8, right: 8, padding: '4px 8px', borderRadius: 6,
            background: tile.severity === 'likely_cheat' ? C.red
                       : tile.severity === 'suspicious' ? C.amber : C.green,
            color: '#000', fontSize: 10, fontWeight: 900,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>{tile.severity}</div>
        )}
      </div>
      <div style={{ padding: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <PlayerStrip uid={tile.player1} state={tile.verifyState?.[tile.player1]}
            focused={focused && focusSide === 0}
            onVerify={(v) => onVerify(tile, tile.player1, v)} />
          <PlayerStrip uid={tile.player2} state={tile.verifyState?.[tile.player2]}
            focused={focused && focusSide === 1}
            onVerify={(v) => onVerify(tile, tile.player2, v)} />
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={(e) => { e.stopPropagation(); onAi(); }} style={{
            padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.violet}66`,
            background: 'transparent', color: C.violet, fontSize: 10, fontWeight: 800,
            fontFamily: 'DM Mono, monospace', cursor: 'pointer',
          }}>AI Summary</button>
          <MatchClaimButton
            tournamentId={tile.tournamentId} matchId={tile.matchId}
            currentUid={currentUid} compact onToast={onToast}
          />
          {ai && <div style={{ fontSize: 10, color: C.dim, flex: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ai.verdict} · {ai.text}
          </div>}
        </div>
        {/* Live AI suggestion (from autoSuggestMatchWinners cron) */}
        {tile.aiSuggestion?.suggestedWinnerId && (
          <div style={{
            marginTop: 6, padding: '4px 8px', borderRadius: 6,
            background: C.violet + '22', border: `1px solid ${C.violet}55`,
            fontSize: 10, color: C.violet, fontFamily: 'DM Mono, monospace',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <Icon name="auto_awesome" size={10} className="" />
            AI → {tile.aiSuggestion.suggestedWinnerId.slice(0, 6)} ({(tile.aiSuggestion.confidence || 'low').toUpperCase()})
          </div>
        )}
        <div style={{ marginTop: 6, fontSize: 9, color: C.mute, fontFamily: 'DM Mono, monospace' }}>
          R{tile.round || '?'}·M{tile.matchNumber || '?'} · {tile.lobbyCode || ''}
        </div>
      </div>
    </div>
  );
}

function PlayerStrip({ uid, state, focused, onVerify }) {
  const status = state?.status || 'pending';
  const color = status === 'verified' ? C.green : status === 'rejected' ? C.red : C.amber;
  return (
    <div style={{
      flex: 1, padding: 6, borderRadius: 8,
      background: focused ? `${C.cyan}22` : C.soft,
      border: `1px solid ${focused ? C.cyan : color + '44'}`,
      display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
    }}>
      <UserAvatar uid={uid} size="xs" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {uid?.slice(0, 8) || '—'}
        </div>
        <div style={{ fontSize: 9, color, textTransform: 'uppercase', fontFamily: 'DM Mono, monospace' }}>
          {status}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        <button onClick={(e) => { e.stopPropagation(); onVerify('verified'); }} style={iconBtn(C.green)}>
          <Icon name="check" size={12} className="" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onVerify('rejected'); }} style={iconBtn(C.red)}>
          <Icon name="close" size={12} className="" />
        </button>
      </div>
    </div>
  );
}

const iconBtn = (color) => ({
  width: 22, height: 22, borderRadius: 4, border: `1px solid ${color}66`,
  background: 'transparent', color, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
});

function mergeReviewItems(prev, next) {
  const map = new Map(prev.map((p) => [p.matchId || p.id, p]));
  for (const it of next) {
    map.set(it.matchId || it.id, {
      ...(map.get(it.matchId || it.id) || {}),
      tournamentId: it.tournamentId, matchId: it.matchId,
      severity: it.severity, flags: it.flags,
    });
  }
  return Array.from(map.values());
}
// Merge live-match snapshot into the existing tile list. Preserves any
// already-fetched HLS URL or AI summary so on-screen tiles don't flicker.
function mergeLiveMatches(prev, next) {
  const map = new Map(prev.map((p) => [p.matchId, p]));
  for (const it of next) {
    const existing = map.get(it.matchId) || {};
    map.set(it.matchId, { ...existing, ...it });
  }
  // Drop entries that no longer appear in the live list (match completed).
  const live = new Set(next.map((n) => n.matchId));
  return Array.from(map.values()).filter((row) => live.has(row.matchId) || row.severity);
}
