// /vanguard/moderation-room/:assignmentId — the post-check-in command center
// for an active tournament a mod has claimed and checked into.
//
// Access:
//  - Mod assigned to this slot AND checked in → full access
//  - Senior+ rank or founder → full access (oversight / takeover)
//  - Anyone else → bounced to schedule with a toast
//
// Layout:
//  - Top bar: tournament name, game, prize pool, countdown, status pill
//  - Left rail: live match list (filterable: all / pending / disputed / completed)
//  - Center: selected match detail — players, reported scores, decision buttons,
//    reason textarea, evidence URL field
//  - Right rail: tournament info, mod presence list, escalate-to-Senior+ button,
//    Complete Assignment button (visible once status == 'completed' on tournament),
//    recent decisions log for this tournament

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import VanguardLayout, { VG_COLORS as C, VanguardPageHeader, VgCard } from '../../components/vanguard/VanguardLayout';
import Icon from '../../components/Icon';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { isVanguard } from '../../utils/vanguard';
import { db } from '../../firebase/config';
import { doc, getDoc, collection, getDocs, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { rankMeta } from '../../utils/vanguardRanks';

const callCallable = (name, payload) =>
  httpsCallable(getFunctions(undefined, 'europe-west1'), name)(payload).then((r) => r.data);
const vanguardCallTournamentWinner = (payload) => callCallable('vanguardCallTournamentWinner', payload);
const vanguardCompleteAssignment = (payload) => callCallable('vanguardCompleteAssignment', payload);
const analyzeTournamentMatch = (payload) => callCallable('analyzeTournamentMatch', payload);

const tsMs = (t) => {
  if (!t) return 0;
  if (t instanceof Date) return t.getTime();
  if (t?.toDate) return t.toDate().getTime();
  if (t?.seconds) return t.seconds * 1000;
  return Number(t) || 0;
};

const fmtCountdown = (ms) => {
  if (ms <= 0) return 'STARTED';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${(m % 60).toString().padStart(2, '0')}m`;
};

const fmtTime = (t) => {
  const m = tsMs(t);
  if (!m) return '—';
  return new Date(m).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

const MATCH_FILTERS = [
  { key: 'all',       label: 'All',           statuses: null },
  { key: 'pending',   label: 'Needs decision', statuses: ['pending', 'awaiting_confirmation', 'in_progress'] },
  { key: 'disputed',  label: 'Disputed',      statuses: ['disputed'] },
  { key: 'completed', label: 'Completed',     statuses: ['completed'] },
];

const STATUS_COLOR = {
  pending: C.violetLt,
  in_progress: C.violetLt,
  awaiting_confirmation: C.gold,
  disputed: C.ember,
  completed: C.success,
};

export default function VanguardModerationRoomScreen() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const { profile } = useUser();
  const { showToast } = useUI();

  const [assignment, setAssignment] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [matches, setMatches] = useState([]);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('pending');
  const [reason, setReason] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [tick, setTick] = useState(0);

  const isFounder = profile?.role === 'admin';
  const meIsVanguard = isVanguard(profile);
  const isMine = assignment && profile?.uid === assignment.moderatorId;
  const myRank = profile?.vanguard?.rank;
  const isSenior = ['senior', 'commander', 'overseer'].includes(myRank);
  const canAct = isMine || isSenior || isFounder;
  const isCheckedIn = assignment?.status === 'checked_in' || assignment?.status === 'in_progress';

  // Format-aware participant labels:
  //   - 1v1: player display name
  //   - Squad: squad name
  //   - Team: team name
  //   - Fallback: "Player N"
  const labelFor = (slot, m) => {
    if (!m) return slot === 1 ? 'Player 1' : 'Player 2';
    if (slot === 1) return m.squad1Name || m.team1Name || m.player1DisplayName || m.player1Name || 'Player 1';
    return m.squad2Name || m.team2Name || m.player2DisplayName || m.player2Name || 'Player 2';
  };
  const idFor = (slot, m) => {
    if (!m) return null;
    if (slot === 1) return m.squad1Id || m.team1Id || m.player1Id;
    return m.squad2Id || m.team2Id || m.player2Id;
  };

  // Live countdown ticker.
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Live-subscribe to the assignment doc so AI verdict updates push in real
  // time when the overlay submits new signals.
  useEffect(() => {
    if (!assignmentId) return;
    let firstLoad = true;
    const unsub = onSnapshot(doc(db, 'tournament_assignments', assignmentId), (snap) => {
      if (!snap.exists()) {
        showToast?.('Assignment not found.', 'error');
        navigate('/vanguard/schedule');
        return;
      }
      setAssignment({ id: snap.id, ...snap.data() });
      if (firstLoad) {
        firstLoad = false;
        // Fetch tournament once (won't change often).
        getDoc(doc(db, 'tournaments', snap.data().tournamentId)).then((tSnap) => {
          setTournament(tSnap.exists() ? { id: tSnap.id, ...tSnap.data() } : null);
          setLoading(false);
        }).catch(() => setLoading(false));
      }
    }, () => setLoading(false));
    return () => unsub();
  }, [assignmentId, navigate, showToast]);

  // Live match list subscription.
  useEffect(() => {
    if (!assignment?.tournamentId) return;
    const q = query(collection(db, 'tournaments', assignment.tournamentId, 'matches'), orderBy('matchNumber', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMatches(rows);
      // Auto-select first pending match if none selected.
      if (!selectedMatchId && rows.length) {
        const firstPending = rows.find((m) => ['pending', 'awaiting_confirmation', 'disputed', 'in_progress'].includes(m.status));
        setSelectedMatchId(firstPending?.id || rows[0].id);
      }
    });
    return () => unsub();
  }, [assignment?.tournamentId, selectedMatchId]);

  const selectedMatch = useMemo(() => matches.find((m) => m.id === selectedMatchId), [matches, selectedMatchId]);

  const filteredMatches = useMemo(() => {
    const f = MATCH_FILTERS.find((x) => x.key === filter);
    if (!f?.statuses) return matches;
    return matches.filter((m) => f.statuses.includes(m.status));
  }, [matches, filter]);

  const startMs = tsMs(assignment?.scheduledStart);
  const msToStart = startMs - Date.now();
  // tick is a refresh signal to keep countdown live
  void tick;

  const onCallWinner = useCallback(async (winnerId) => {
    if (!selectedMatch) return;
    if (busy) return;
    if (!canAct) {
      showToast?.('You are not authorized to make decisions in this room.', 'error');
      return;
    }
    setBusy(true);
    try {
      await vanguardCallTournamentWinner({
        tournamentId: assignment.tournamentId,
        matchId: selectedMatch.id,
        winnerId,
        reason: reason.trim(),
      });
      showToast?.('Decision recorded. Bracket advancing.', 'success');
      setReason('');
      setEvidenceUrl('');
    } catch (e) {
      showToast?.(e?.message || 'Failed to call winner', 'error');
    } finally {
      setBusy(false);
    }
  }, [selectedMatch, busy, canAct, assignment, reason, showToast]);

  const onAnalyze = useCallback(async () => {
    if (!assignment || busy) return;
    setBusy(true);
    try {
      const r = await analyzeTournamentMatch({ assignmentId: assignment.id });
      if (r.ok) {
        showToast?.(`AI analysis complete — confidence: ${r.consensus?.confidence || 'low'}`, 'success');
      } else {
        showToast?.(r.error || 'Analysis failed', 'error');
      }
    } catch (e) {
      showToast?.(e?.message || 'Analysis failed', 'error');
    } finally { setBusy(false); }
  }, [assignment, busy, showToast]);

  const onComplete = useCallback(async () => {
    if (!assignment) return;
    if (!window.confirm('Mark assignment complete? You will not be able to make further decisions on this tournament.')) return;
    setBusy(true);
    try {
      await vanguardCompleteAssignment({ assignmentId: assignment.id });
      showToast?.('Assignment completed. VP credit + treasury share locked in.', 'success');
      navigate('/vanguard/schedule');
    } catch (e) {
      showToast?.(e?.message || 'Failed to complete', 'error');
    } finally {
      setBusy(false);
    }
  }, [assignment, showToast, navigate]);

  if (loading || !assignment) {
    return (
      <VanguardLayout page="schedule">
        <VgCard style={{ textAlign: 'center', padding: 40, color: C.textMuted }}>Loading moderation room…</VgCard>
      </VanguardLayout>
    );
  }

  // Access gate
  if (!canAct) {
    return (
      <VanguardLayout page="schedule">
        <VanguardPageHeader title="Moderation Room" subtitle="Access restricted" />
        <VgCard style={{ textAlign: 'center', padding: 40 }}>
          <Icon name="lock" size={36} style={{ color: C.ember, marginBottom: 8 }} />
          <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: C.text }}>You are not authorized.</div>
          <div style={{ fontFamily: 'DM Sans', fontSize: 13, color: C.textMuted, marginTop: 6 }}>
            Only the assigned moderator, Senior+ Vanguard, or the founder can enter this room.
          </div>
          <button onClick={() => navigate('/vanguard/schedule')} style={{ marginTop: 18, padding: '10px 18px', background: C.violet, border: 0, borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            Back to schedule
          </button>
        </VgCard>
      </VanguardLayout>
    );
  }

  if (!isCheckedIn && isMine) {
    return (
      <VanguardLayout page="schedule">
        <VanguardPageHeader title="Moderation Room" subtitle="Check-in required" />
        <VgCard style={{ textAlign: 'center', padding: 40 }}>
          <Icon name="login" size={36} style={{ color: C.gold, marginBottom: 8 }} />
          <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 16, color: C.text }}>You haven't checked in yet.</div>
          <div style={{ fontFamily: 'DM Sans', fontSize: 13, color: C.textMuted, marginTop: 6 }}>
            Return to your schedule and press Check In to unlock this room. Check-in opens 15 min before start.
          </div>
          <button onClick={() => navigate('/vanguard/schedule')} style={{ marginTop: 18, padding: '10px 18px', background: C.violet, border: 0, borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            Go to schedule
          </button>
        </VgCard>
      </VanguardLayout>
    );
  }

  const tierColor = assignment.tier === 'large' ? C.ember : assignment.tier === 'medium' ? C.gold : C.violetLt;

  return (
    <VanguardLayout page="schedule">
      <VanguardPageHeader
        title="Moderation Room"
        subtitle={`Live command center for ${assignment.tournamentName}`}
        right={
          <button
            disabled={busy}
            onClick={onComplete}
            style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textDim, cursor: busy ? 'wait' : 'pointer', fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="task_alt" size={14} />
            Complete Assignment
          </button>
        }
      />

      {/* No-verdict-yet "Analyze frame now" prompt */}
      {(!assignment.aiVerdict || assignment.aiVerdict.confidence === 'none') && selectedMatch && selectedMatch.status !== 'completed' && (
        <VgCard style={{ marginBottom: 14, padding: 12, borderLeft: `3px solid ${C.violetLt}`, background: `linear-gradient(135deg, ${C.card}, rgba(180,79,255,.04))` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: `${C.violetLt}22`, color: C.violetLt, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Icon name="auto_awesome" size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 13, color: C.text }}>No AI verdict yet for this match</div>
              <div style={{ fontFamily: 'DM Sans', fontSize: 11.5, color: C.textDim, marginTop: 2 }}>Click Analyze to run Tesseract OCR on the current stream frame. Overlay signals also auto-arrive when the streamer presses their hotkey.</div>
            </div>
            <button
              disabled={busy}
              onClick={onAnalyze}
              style={{ padding: '8px 14px', background: C.violet, border: 0, borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontWeight: 700, fontSize: 12, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }}
            >
              {busy ? 'Analyzing…' : '✨ Analyze frame now'}
            </button>
          </div>
        </VgCard>
      )}

      {/* AI verdict banner — appears when consensus signals exist for the active match */}
      {assignment.aiVerdict && assignment.aiVerdict.confidence !== 'none' && (() => {
        const v = assignment.aiVerdict;
        const isActiveMatch = !selectedMatch || v.activeMatchId === selectedMatch.id;
        if (!isActiveMatch) return null;
        const winnerName = v.suggestedWinnerId === idFor(1, selectedMatch)
          ? labelFor(1, selectedMatch)
          : v.suggestedWinnerId === idFor(2, selectedMatch)
            ? labelFor(2, selectedMatch)
            : v.suggestedWinnerId === '__draw__' ? 'Draw' : 'Unknown';
        const confColor = v.confidence === 'high' ? C.success : v.confidence === 'medium' ? C.gold : C.violetLt;
        const confLabel = v.confidence === 'high' ? '✓ AI confident' : v.confidence === 'medium' ? '~ AI likely' : '? AI uncertain';
        const signalChips = [];
        if (v.signals?.overlay) signalChips.push({ name: 'OBS overlay', color: C.success });
        if (v.signals?.tesseract) signalChips.push({ name: 'Tesseract OCR', color: C.violetLt });
        if (v.signals?.vision) signalChips.push({ name: 'Google Vision', color: C.gold });
        return (
          <VgCard style={{
            marginBottom: 14, padding: 14,
            borderLeft: `3px solid ${confColor}`,
            background: `linear-gradient(135deg, ${C.card}, ${confColor}11)`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `${confColor}22`, color: confColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="auto_awesome" size={20} />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: 'DM Mono', fontSize: 10.5, fontWeight: 700, color: confColor, textTransform: 'uppercase', letterSpacing: '.12em' }}>{confLabel}</span>
                  <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted }}>{v.agreementCount}/{v.totalSignals} signal{v.totalSignals !== 1 ? 's' : ''} agree</span>
                </div>
                <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 16, color: C.text }}>
                  Suggested winner: <span style={{ color: confColor }}>{winnerName}</span>
                </div>
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {signalChips.map((s) => (
                    <span key={s.name} style={{ padding: '2px 8px', background: `${s.color}22`, border: `1px solid ${s.color}44`, color: s.color, borderRadius: 999, fontFamily: 'DM Mono', fontSize: 9.5, fontWeight: 700 }}>{s.name}</span>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {v.suggestedWinnerId && v.suggestedWinnerId !== '__draw__' && selectedMatch && selectedMatch.status !== 'completed' && (
                  <button
                    disabled={busy}
                    onClick={() => onCallWinner(v.suggestedWinnerId)}
                    style={{ padding: '10px 18px', background: confColor, border: 0, borderRadius: 8, color: '#0B0B14', fontFamily: 'DM Sans', fontWeight: 800, fontSize: 13, cursor: busy ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}
                  >
                    ✓ Confirm AI call
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={onAnalyze}
                  style={{ padding: '6px 14px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textDim, fontFamily: 'DM Sans', fontWeight: 600, fontSize: 11, cursor: busy ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}
                >
                  {busy ? 'Re-analyzing…' : '↻ Re-analyze'}
                </button>
              </div>
            </div>
            {v.confidence !== 'high' && (
              <div style={{ marginTop: 10, fontFamily: 'DM Sans', fontSize: 11.5, color: C.textDim, lineHeight: 1.5 }}>
                AI confidence is {v.confidence}. Review the match details below before confirming, or make your own call.
              </div>
            )}
          </VgCard>
        );
      })()}

      {/* Top status strip */}
      <VgCard style={{ marginBottom: 14, padding: 14, borderLeft: `3px solid ${tierColor}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ padding: '3px 9px', background: `${tierColor}22`, border: `1px solid ${tierColor}44`, borderRadius: 999, color: tierColor, fontFamily: 'DM Mono', fontSize: 10, fontWeight: 700 }}>{assignment.tierLabel} · {assignment.vpMultiplier}× VP</span>
              <span style={{ fontFamily: 'DM Mono', fontSize: 11, color: C.textDim }}>{assignment.game}</span>
            </div>
            <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 18, color: C.text }}>{assignment.tournamentName}</div>
            <div style={{ fontFamily: 'DM Mono', fontSize: 11.5, color: C.textDim, marginTop: 4, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <span>{assignment.participantCount} players</span>
              <span>{Number(assignment.prizePool || 0).toLocaleString()}c prize</span>
              <span>~{assignment.estimatedDurationMin} min duration</span>
              <span>{fmtTime(assignment.scheduledStart)} start</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'DM Mono', fontSize: 22, fontWeight: 800, color: msToStart < 0 ? C.success : C.gold, lineHeight: 1 }}>
              {fmtCountdown(msToStart)}
            </div>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, marginTop: 2 }}>{msToStart < 0 ? 'IN PROGRESS' : 'TO START'}</div>
          </div>
        </div>
      </VgCard>

      {/* 3-col grid: matches list / decision panel / info rail */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr) minmax(280px, 1fr)', gap: 12 }}>
        {/* Match list */}
        <VgCard style={{ padding: 0, overflow: 'hidden', alignSelf: 'flex-start' }}>
          <div style={{ padding: 10, borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {MATCH_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                style={{
                  padding: '5px 10px',
                  background: filter === f.key ? 'rgba(180,79,255,.12)' : 'transparent',
                  border: `1px solid ${filter === f.key ? 'rgba(180,79,255,.4)' : C.border}`,
                  borderRadius: 999,
                  color: filter === f.key ? C.violetLt : C.textDim,
                  fontFamily: 'DM Sans',
                  fontSize: 10.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >{f.label}</button>
            ))}
          </div>
          <div style={{ maxHeight: 600, overflowY: 'auto' }}>
            {filteredMatches.length === 0 ? (
              <div style={{ padding: 20, color: C.textMuted, fontFamily: 'DM Sans', fontSize: 12, textAlign: 'center' }}>No matches in this filter.</div>
            ) : filteredMatches.map((m) => {
              const sc = STATUS_COLOR[m.status] || C.textMuted;
              const isSel = m.id === selectedMatchId;
              return (
                <button
                  key={m.id}
                  onClick={() => { setSelectedMatchId(m.id); setReason(''); }}
                  style={{
                    width: '100%',
                    display: 'block',
                    textAlign: 'left',
                    padding: '10px 12px',
                    background: isSel ? 'rgba(180,79,255,.08)' : 'transparent',
                    border: 0,
                    borderBottom: `1px solid ${C.border}`,
                    borderLeft: isSel ? `2px solid ${C.violetLt}` : '2px solid transparent',
                    cursor: 'pointer',
                    color: C.text,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.textDim }}>Match #{m.matchNumber || '?'}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: sc, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em' }}>● {m.status || 'pending'}</span>
                  </div>
                  <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.text, fontWeight: 600 }}>
                    {labelFor(1, m).slice(0, 16)} vs {labelFor(2, m).slice(0, 16)}
                  </div>
                  {m.round && <div style={{ fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted, marginTop: 2 }}>Round {m.round}</div>}
                </button>
              );
            })}
          </div>
        </VgCard>

        {/* Decision panel */}
        <VgCard style={{ padding: 16 }}>
          {!selectedMatch ? (
            <div style={{ textAlign: 'center', color: C.textMuted, padding: 30 }}>
              <Icon name="touch_app" size={28} style={{ color: C.textMuted, marginBottom: 6 }} />
              <div style={{ fontFamily: 'DM Sans', fontSize: 13 }}>Pick a match from the list to make a decision.</div>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em' }}>Match #{selectedMatch.matchNumber || '?'}</div>
                <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 16, color: C.text, marginTop: 4 }}>
                  {labelFor(1, selectedMatch)}
                  <span style={{ color: C.textMuted, padding: '0 8px' }}>vs</span>
                  {labelFor(2, selectedMatch)}
                </div>
                <div style={{ fontFamily: 'DM Mono', fontSize: 10.5, color: C.textDim, marginTop: 4 }}>Status: {selectedMatch.status} {selectedMatch.round ? `· Round ${selectedMatch.round}` : ''}</div>
              </div>

              {/* Reported results */}
              <div style={{ padding: 10, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 14 }}>
                <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.12em' }}>Reported by players</div>
                <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.text }}>P1 says: <span style={{ color: C.textDim }}>{selectedMatch.player1Report || '(no report yet)'}</span></div>
                <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.text, marginTop: 4 }}>P2 says: <span style={{ color: C.textDim }}>{selectedMatch.player2Report || '(no report yet)'}</span></div>
                {selectedMatch.evidenceUrl && (
                  <a href={selectedMatch.evidenceUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, color: C.violetLt, fontFamily: 'DM Sans', fontSize: 11.5, fontWeight: 600 }}>View player-attached evidence ↗</a>
                )}
              </div>

              {selectedMatch.status === 'completed' ? (
                <div style={{ padding: 12, background: `${C.success}11`, border: `1px solid ${C.success}33`, borderRadius: 8, color: C.success, fontFamily: 'DM Sans', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
                  ✓ Resolved · Winner: {selectedMatch.winnerDisplayName || selectedMatch.winnerId || '—'}
                </div>
              ) : (
                <>
                  <label style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.12em', display: 'block', marginBottom: 4 }}>Reason (required, logged to audit)</label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why is this the correct call? Cite evidence."
                    rows={3}
                    style={{
                      width: '100%', padding: 10, background: C.card2, border: `1px solid ${C.border}`,
                      borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontSize: 12.5, outline: 'none',
                      resize: 'vertical', marginBottom: 10,
                    }}
                  />
                  <label style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.12em', display: 'block', marginBottom: 4 }}>Evidence URL (optional — VOD timestamp / screenshot)</label>
                  <input
                    value={evidenceUrl}
                    onChange={(e) => setEvidenceUrl(e.target.value)}
                    placeholder="https://..."
                    style={{
                      width: '100%', padding: 10, background: C.card2, border: `1px solid ${C.border}`,
                      borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontSize: 12.5, outline: 'none', marginBottom: 14,
                    }}
                  />

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      disabled={busy || !idFor(1, selectedMatch)}
                      onClick={() => onCallWinner(idFor(1, selectedMatch))}
                      style={{ flex: 1, padding: '12px 14px', background: C.violet, border: 0, borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontSize: 13, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}
                    >
                      {labelFor(1, selectedMatch)} wins
                    </button>
                    <button
                      disabled={busy || !idFor(2, selectedMatch)}
                      onClick={() => onCallWinner(idFor(2, selectedMatch))}
                      style={{ flex: 1, padding: '12px 14px', background: C.violet, border: 0, borderRadius: 8, color: C.text, fontFamily: 'DM Sans', fontSize: 13, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}
                    >
                      {labelFor(2, selectedMatch)} wins
                    </button>
                  </div>
                  <div style={{ marginTop: 10, fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textAlign: 'center' }}>
                    Decision is final + bracket advances immediately. You earn +{rankMeta(myRank).actionVp || 0} VP × {assignment.vpMultiplier}× tier multiplier.
                  </div>
                </>
              )}
            </>
          )}
        </VgCard>

        {/* Right rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <VgCard>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 10 }}>Tournament info</div>
            <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: C.textDim, lineHeight: 1.7 }}>
              <div>Format: <span style={{ color: C.text }}>{tournament?.type || tournament?.format || 'TBD'}</span></div>
              <div>Mode: <span style={{ color: C.text }}>{tournament?.mode || '—'}</span></div>
              <div>Bracket: <span style={{ color: C.text }}>{matches.length} match{matches.length !== 1 ? 'es' : ''}</span></div>
              <div>Decided: <span style={{ color: C.success }}>{matches.filter((m) => m.status === 'completed').length}</span> of {matches.length}</div>
              <div>Pending: <span style={{ color: C.violetLt }}>{matches.filter((m) => ['pending', 'awaiting_confirmation', 'in_progress'].includes(m.status)).length}</span></div>
              <div>Disputed: <span style={{ color: C.ember }}>{matches.filter((m) => m.status === 'disputed').length}</span></div>
            </div>
          </VgCard>

          <VgCard>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 10 }}>Need help?</div>
            <button
              onClick={() => showToast?.('Escalation requested. A Senior+ Vanguard will be notified.', 'success')}
              style={{ width: '100%', padding: '10px 12px', background: 'transparent', border: `1px solid rgba(245,200,66,.4)`, borderRadius: 8, color: C.gold, fontFamily: 'DM Sans', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginBottom: 8 }}
            >
              <Icon name="priority_high" size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Escalate to Senior+
            </button>
            <button
              onClick={() => navigate('/vanguard/chat')}
              style={{ width: '100%', padding: '10px 12px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textDim, fontFamily: 'DM Sans', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              <Icon name="chat" size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Ask in Vanguard Chat
            </button>
          </VgCard>

          <VgCard>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 10 }}>Recent decisions (this tournament)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {matches.filter((m) => m.status === 'completed').slice(0, 5).map((m) => (
                <div key={m.id} style={{ padding: 8, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted }}>Match #{m.matchNumber || '?'}</div>
                  <div style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.success, fontWeight: 600 }}>Winner: {m.winnerDisplayName || m.winnerId || '—'}</div>
                </div>
              ))}
              {matches.filter((m) => m.status === 'completed').length === 0 && (
                <div style={{ fontFamily: 'DM Sans', fontSize: 11.5, color: C.textMuted, padding: '6px 2px' }}>No decisions yet.</div>
              )}
            </div>
          </VgCard>
        </div>
      </div>
    </VanguardLayout>
  );
}
