// MatchFlowExtras — match-side player tools:
//   <WarmupLobby />          pre-match voice + screen-share with opponent
//   <DoubleOrNothingPrompt /> winner accept/decline UI
//   <DoubleOrNothingButton /> loser-side challenge trigger
//   <ReplayOnDemandButton />  request mod review of a specific moment
//   <SchedulingDmButton />    open voice DM tagged to this match

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { IS_STORE_BUILD } from '../../utils/platform';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  collection, query, orderBy, limit, onSnapshot, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useUI } from '../../context/UIContext';
import { uploadToR2 } from '../../utils/r2Storage';
import { compressMedia } from '../../utils/mediaCompression';

const C = {
  surface: '#14141F', soft: '#1A1A2A', border: 'rgba(255,255,255,0.10)',
  text: '#fff', dim: 'rgba(255,255,255,0.65)',
  gold: '#F0A500', goldLight: '#F5C842', cyan: '#B44FFF',
  green: '#22c55e', red: '#ef4444',
};

const fns = () => getFunctions(undefined, 'europe-west1');

export function WarmupLobby({ tournamentId, matchId, opponentUid }) {
  const nav = useNavigate();
  return (
    <button onClick={() => nav(`/squads/warmup/${tournamentId}_${matchId}`)} style={{
      padding: '10px 14px', borderRadius: 10,
      background: `linear-gradient(135deg, ${C.cyan}33, ${C.cyan}11)`,
      border: `1px solid ${C.cyan}66`, color: C.cyan,
      fontWeight: 800, fontSize: 12, cursor: 'pointer',
    }}>🎙 Open warmup lobby</button>
  );
}

export function DoubleOrNothingButton({ tournamentId, matchId }) {
  // Double-or-nothing stakes coins on an outcome — same Play gambling policy
  // constraint as SpectatorBetPanel. Play build only; every other path keeps it.
  if (IS_STORE_BUILD) return null;
  const { showToast } = useUI();
  const [busy, setBusy] = useState(false);
  const fire = async () => {
    setBusy(true);
    try {
      const { data } = await httpsCallable(fns(), 'requestDoubleOrNothing')({ tournamentId, matchId });
      showToast(`Challenge sent · ${data.cost} coins on the line`, 'info');
    } catch (err) { showToast(err?.message || 'Challenge failed', 'error'); }
    finally { setBusy(false); }
  };
  return (
    <button onClick={fire} disabled={busy} style={{
      padding: '10px 14px', borderRadius: 10,
      background: 'transparent', border: `1px solid ${C.gold}66`, color: C.gold,
      fontWeight: 800, fontSize: 12, cursor: 'pointer',
    }}>{busy ? 'Sending…' : '🎰 Double or nothing'}</button>
  );
}

export function DoubleOrNothingPrompt({ tournamentId, matchId, cost, onResolved }) {
  // Double-or-nothing stakes coins on an outcome — same Play gambling policy
  // constraint as SpectatorBetPanel. Play build only; every other path keeps it.
  if (IS_STORE_BUILD) return null;
  const { showToast } = useUI();
  const [busy, setBusy] = useState(false);
  const respond = async (accept) => {
    setBusy(true);
    try {
      await httpsCallable(fns(), 'respondDoubleOrNothing')({ tournamentId, matchId, accept });
      showToast(accept ? 'Rematch on!' : 'Declined.', 'info');
      onResolved?.();
    } catch (err) { showToast(err?.message || 'Failed', 'error'); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ padding: 14, borderRadius: 12, background: `${C.gold}11`, border: `1px solid ${C.gold}66` }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.gold }}>Double or nothing challenge</div>
      <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>
        Your opponent wants a rematch for {cost} coins. Winner takes {cost * 2}.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={() => respond(true)} disabled={busy} style={primaryBtn}>Accept</button>
        <button onClick={() => respond(false)} disabled={busy} style={secondaryBtn}>Decline</button>
      </div>
    </div>
  );
}

export function ReplayOnDemandButton({ tournamentId, matchId, currentTimeSec }) {
  const { showToast } = useUI();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await httpsCallable(fns(), 'requestReplayReview')({
        tournamentId, matchId, timestampSec: currentTimeSec || 0, reason,
      });
      showToast('Mod review requested.', 'success');
      setOpen(false); setReason('');
    } catch (err) { showToast(err?.message || 'Failed', 'error'); }
    finally { setBusy(false); }
  };
  return (
    <>
      <button onClick={() => setOpen(true)} style={{
        padding: '8px 12px', borderRadius: 8, background: 'transparent',
        border: `1px solid ${C.red}66`, color: C.red, fontWeight: 800, fontSize: 11, cursor: 'pointer',
      }}>🚩 Request review</button>
      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: C.surface, borderRadius: 14, padding: 16, width: '100%', maxWidth: 420,
          }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>Request mod review</div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
              Timestamp: {Math.floor((currentTimeSec || 0) / 60)}m {Math.floor((currentTimeSec || 0) % 60)}s
            </div>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="What did you see?" maxLength={200} rows={3}
              style={{
                width: '100%', marginTop: 10, padding: 10, borderRadius: 8,
                background: C.soft, border: `1px solid ${C.border}`, color: C.text, resize: 'none',
              }} />
            <button onClick={send} disabled={busy || !reason.trim()} style={{
              ...primaryBtn, width: '100%', marginTop: 10,
            }}>{busy ? 'Sending…' : 'Send to mod'}</button>
          </div>
        </div>
      )}
    </>
  );
}

export function SchedulingDmButton({ tournamentId, matchId, otherUid }) {
  const { showToast } = useUI();
  const nav = useNavigate();
  const open = async () => {
    try {
      const { data } = await httpsCallable(fns(), 'openMatchSchedulingDm')({ tournamentId, matchId, otherUid });
      nav(`/dm/${data.threadId}`);
    } catch (err) { showToast(err?.message || 'Failed', 'error'); }
  };
  return (
    <button onClick={open} style={{
      padding: '8px 12px', borderRadius: 8, background: 'transparent',
      border: `1px solid ${C.border}`, color: C.text, fontWeight: 700, fontSize: 11, cursor: 'pointer',
    }}>📞 Voice DM opponent</button>
  );
}

// ─── RescheduleControls (NT2) ─────────────────────────────────────────────
// Either player proposes a delay; the other accepts/declines. On accept the
// match's auto-forfeit timer is paused until the agreed time (server honours
// `rescheduledUntil` in detectMatchTimeouts).
export function RescheduleControls({ tournamentId, matchId, match, myUid }) {
  const { showToast } = useUI();
  const [busy, setBusy] = useState(false);
  const prop = match?.rescheduleProposal;
  const pending = prop && prop.status === 'pending';
  const iProposed = pending && prop.byUid === myUid;
  const theyProposed = pending && prop.byUid !== myUid;

  const propose = async (mins) => {
    setBusy(true);
    try {
      await httpsCallable(fns(), 'proposeMatchReschedule')({
        tournamentId, matchId, proposedStartMs: Date.now() + mins * 60_000,
      });
      showToast(`Proposed +${mins} min. Waiting for opponent.`, 'info');
    } catch (err) { showToast(err?.message || 'Failed', 'error'); }
    finally { setBusy(false); }
  };
  const respond = async (accept) => {
    setBusy(true);
    try {
      await httpsCallable(fns(), 'respondMatchReschedule')({ tournamentId, matchId, accept });
      showToast(accept ? 'New time agreed.' : 'Declined.', 'info');
    } catch (err) { showToast(err?.message || 'Failed', 'error'); }
    finally { setBusy(false); }
  };

  if (theyProposed) {
    const when = new Date(prop.proposedStartMs);
    return (
      <div style={{ padding: 12, borderRadius: 12, background: `${C.cyan}11`, border: `1px solid ${C.cyan}55` }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.cyan }}>Opponent proposed a new time</div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 3 }}>
          Start at {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Agreeing pauses the forfeit timer.
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={() => respond(true)} disabled={busy} style={primaryBtn}>Accept</button>
          <button onClick={() => respond(false)} disabled={busy} style={secondaryBtn}>Decline</button>
        </div>
      </div>
    );
  }
  if (iProposed) {
    return (
      <div style={{ fontSize: 11, color: C.dim, padding: '6px 2px' }}>
        ⏳ Reschedule proposed — waiting for your opponent to respond.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, color: C.dim }}>Need more time?</span>
      <button onClick={() => propose(15)} disabled={busy} style={chipBtn}>+15 min</button>
      <button onClick={() => propose(30)} disabled={busy} style={chipBtn}>+30 min</button>
      <button onClick={() => propose(60)} disabled={busy} style={chipBtn}>+1 hour</button>
    </div>
  );
}

// ─── DisputeEvidenceUpload (NT6) ──────────────────────────────────────────
// Per-side result-screenshot upload for disputed matches. Compresses then
// uploads to R2, then records the URL via uploadDisputeEvidence.
export function DisputeEvidenceUpload({ tournamentId, matchId, match, myUid, opponentUid }) {
  const { showToast } = useUI();
  const [busy, setBusy] = useState(false);
  const mine = match?.disputeEvidence?.[myUid];
  const theirs = opponentUid ? match?.disputeEvidence?.[opponentUid] : null;

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const compressed = await compressMedia(file, 'free', 'post');
      const { url } = await uploadToR2(compressed, 'tournament');
      await httpsCallable(fns(), 'uploadDisputeEvidence')({ tournamentId, matchId, evidenceUrl: url });
      showToast('Evidence submitted. A mod will review.', 'success');
    } catch (err) { showToast(err?.message || 'Upload failed', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: 14, borderRadius: 12, background: C.surface, border: `1px solid ${C.gold}55` }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.gold }}>Result disputed</div>
      <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
        Upload a screenshot of the final result screen so a mod can resolve this fairly.
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 11 }}>
        <span style={{ color: mine ? C.green : C.dim }}>You: {mine ? '✓ submitted' : 'not yet'}</span>
        <span style={{ color: theirs ? C.green : C.dim }}>Opponent: {theirs ? '✓ submitted' : 'waiting'}</span>
      </div>
      <label style={{ ...primaryBtn, display: 'inline-block', marginTop: 10, opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Uploading…' : (mine ? 'Replace screenshot' : 'Upload result screenshot')}
        <input type="file" accept="image/*" onChange={pick} disabled={busy} style={{ display: 'none' }} />
      </label>
    </div>
  );
}

// ─── AppealReviewButton (NT5) ─────────────────────────────────────────────
// Lets a flagged player appeal an AI cheat-flag review via submitAppeal.
export function AppealReviewButton({ matchId }) {
  const { showToast } = useUI();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await httpsCallable(fns(), 'submitAppeal')({
        targetType: 'tournament_match_review', targetId: matchId, appealText: text,
      });
      showToast('Appeal submitted. A mod will review it.', 'success');
      setOpen(false); setText('');
    } catch (err) { showToast(err?.message || 'Failed', 'error'); }
    finally { setBusy(false); }
  };
  return (
    <>
      <button onClick={() => setOpen(true)} style={{
        padding: '8px 12px', borderRadius: 8, background: 'transparent',
        border: `1px solid ${C.cyan}66`, color: C.cyan, fontWeight: 800, fontSize: 11, cursor: 'pointer',
      }}>Appeal this review</button>
      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: C.surface, borderRadius: 14, padding: 16, width: '100%', maxWidth: 420,
          }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>Appeal review</div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
              Tell the mods why you believe the flag is a mistake (min 20 characters).
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Explain what happened…" maxLength={1000} rows={4}
              style={{
                width: '100%', marginTop: 10, padding: 10, borderRadius: 8,
                background: C.soft, border: `1px solid ${C.border}`, color: C.text, resize: 'none',
              }} />
            <button onClick={send} disabled={busy || text.trim().length < 20} style={{
              ...primaryBtn, width: '100%', marginTop: 10,
            }}>{busy ? 'Submitting…' : 'Submit appeal'}</button>
          </div>
        </div>
      )}
    </>
  );
}

// DS7 — spectator "Follow this match" toggle. On follow, the viewer gets a
// push when the match goes live (tournamentMatchFollowerPush). Shown only to
// non-participants.
export function FollowMatchButton({ tournamentId, matchId, match, myUid }) {
  const { showToast } = useUI();
  const [following, setFollowing] = useState(() => !!match?.spectatorFollowers?.includes(myUid));
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const next = !following;
    try {
      await httpsCallable(fns(), 'setMatchFollow')({ tournamentId, matchId, follow: next });
      setFollowing(next);
      showToast(next ? 'Following — we\'ll ping you when it starts' : 'Unfollowed match', next ? 'success' : 'info');
    } catch (err) { showToast(err?.message || 'Failed', 'error'); }
    finally { setBusy(false); }
  };
  return (
    <button onClick={toggle} disabled={busy} style={{
      padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontWeight: 800, fontSize: 12,
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: following ? `${C.cyan}1f` : 'transparent',
      border: `1px solid ${following ? C.cyan + '88' : C.border}`,
      color: following ? C.cyan : C.dim,
    }}>
      {following ? '★ Following match' : '☆ Follow this match'}
    </button>
  );
}

// IM3 — report your opponent directly from the match screen (previously only
// reachable via the long DMs flow). Files a 'user' report via submitReport,
// tagging the match in details so mods have context.
const REPORT_REASONS = [
  { key: 'cheating', label: 'Cheating / hacking' },
  { key: 'no_show', label: 'No-show / stalling' },
  { key: 'abuse', label: 'Harassment / abuse' },
  { key: 'wrong_result', label: 'Falsified result' },
  { key: 'other', label: 'Something else' },
];
export function ReportOpponentButton({ opponentUid, tournamentId, matchId, opponentName }) {
  const { showToast } = useUI();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('cheating');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  if (!opponentUid) return null;
  const send = async () => {
    setBusy(true);
    try {
      await httpsCallable(fns(), 'submitReport')({
        targetType: 'user', targetId: opponentUid, reason,
        details: `[tournament ${tournamentId} / match ${matchId}] ${details}`.slice(0, 1000),
      });
      showToast('Report sent to moderators.', 'success');
      setOpen(false); setDetails('');
    } catch (err) {
      showToast(err?.message === 'You already reported this' ? 'You already reported this player.' : (err?.message || 'Failed'), 'error');
    } finally { setBusy(false); }
  };
  return (
    <>
      <button onClick={() => setOpen(true)} style={{
        padding: '7px 12px', borderRadius: 8, background: 'transparent',
        border: `1px solid ${C.red}55`, color: C.red, fontWeight: 800, fontSize: 11, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>⚑ Report opponent</button>
      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: C.surface, borderRadius: 14, padding: 16, width: '100%', maxWidth: 420,
          }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>
              Report {opponentName || 'opponent'}
            </div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>
              Moderators review every report. False reports can affect your own trust score.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {REPORT_REASONS.map((r) => (
                <button key={r.key} onClick={() => setReason(r.key)} style={{
                  padding: '6px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  background: reason === r.key ? `${C.cyan}1f` : C.soft,
                  border: `1px solid ${reason === r.key ? C.cyan + '88' : C.border}`,
                  color: reason === r.key ? C.cyan : C.dim,
                }}>{r.label}</button>
              ))}
            </div>
            <textarea value={details} onChange={(e) => setDetails(e.target.value)}
              placeholder="Add any detail that helps the mod (optional)…" maxLength={800} rows={3}
              style={{
                width: '100%', marginTop: 10, padding: 10, borderRadius: 8,
                background: C.soft, border: `1px solid ${C.border}`, color: C.text, resize: 'none',
              }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={() => setOpen(false)} style={{ ...chipBtn, flex: 1 }}>Cancel</button>
              <button onClick={send} disabled={busy} style={{ ...primaryBtn, flex: 1 }}>
                {busy ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// IM4 — thank the moderator who called your match. Shows who decided it +
// a one-tap thank-you that pings the mod (thankMatchMod callable).
export function ModThankYou({ tournamentId, matchId, modUid, modName }) {
  const { showToast } = useUI();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!modUid) return null;
  const thank = async () => {
    if (sent || busy) return;
    setBusy(true);
    try {
      await httpsCallable(fns(), 'thankMatchMod')({ tournamentId, matchId });
      setSent(true);
      showToast('Thanks sent to the moderator.', 'success');
    } catch (err) { showToast(err?.message || 'Failed', 'error'); }
    finally { setBusy(false); }
  };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      padding: '10px 14px', borderRadius: 12, background: C.surface, border: `1px solid ${C.border}`,
    }}>
      <div style={{ fontSize: 12, color: C.dim }}>
        Decided by <span style={{ color: C.cyan, fontWeight: 800 }}>{modName || 'a Vanguard mod'}</span>
      </div>
      <button onClick={thank} disabled={sent || busy} style={{
        padding: '6px 12px', borderRadius: 8, fontWeight: 800, fontSize: 11, cursor: sent ? 'default' : 'pointer',
        background: sent ? C.soft : `${C.gold}1f`,
        border: `1px solid ${sent ? C.border : C.gold + '88'}`,
        color: sent ? C.dim : C.goldLight,
      }}>{sent ? '✓ Thanked' : 'Thanks for the call'}</button>
    </div>
  );
}

// IM1 — lightweight per-match opponent chat. Firestore subcollection
// `tournaments/{tId}/matches/{mId}/chat` (NOT the WS relay — that is for the
// high-volume stream-chat firehose; this is a 2-player, low-volume thread that
// also serves as a dispute trail, so persistence + zero new infra wins). Auto-
// closes the input when the match is over; history stays readable for mods.
const CHAT_CLOSED_STATUSES = ['completed', 'cancelled', 'disputed'];
export function MatchChat({ tournamentId, matchId, myUid, myName, opponentName, matchStatus }) {
  const { showToast } = useUI();
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);
  const closed = CHAT_CLOSED_STATUSES.includes(matchStatus);

  useEffect(() => {
    if (!tournamentId || !matchId) return;
    const q = query(
      collection(db, 'tournaments', tournamentId, 'matches', matchId, 'chat'),
      orderBy('createdAt', 'asc'), limit(200),
    );
    const unsub = onSnapshot(q, (snap) => {
      setMsgs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [tournamentId, matchId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending || closed) return;
    setSending(true);
    try {
      await addDoc(
        collection(db, 'tournaments', tournamentId, 'matches', matchId, 'chat'),
        { senderUid: myUid, senderName: myName || 'Player', text: body.slice(0, 500), createdAt: serverTimestamp() },
      );
      setText('');
    } catch (err) { showToast(err?.message || 'Could not send', 'error'); }
    finally { setSending(false); }
  };

  return (
    <div style={{ borderRadius: 12, background: C.surface, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
      <div style={{
        padding: '8px 12px', borderBottom: `1px solid ${C.border}`,
        fontSize: 11, fontWeight: 800, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.08em',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>Match chat{opponentName ? ` · vs ${opponentName}` : ''}</span>
        {closed && <span style={{ color: C.dim, fontWeight: 700, textTransform: 'none', letterSpacing: 0 }}>closed</span>}
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {msgs.length === 0 && (
          <div style={{ fontSize: 12, color: C.dim, textAlign: 'center', padding: '14px 0' }}>
            Coordinate the lobby with your opponent here. Messages are kept as a dispute record.
          </div>
        )}
        {msgs.map((m) => {
          const mine = m.senderUid === myUid;
          return (
            <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
              <div style={{
                padding: '6px 10px', borderRadius: 10, fontSize: 13, lineHeight: 1.35,
                background: mine ? `${C.cyan}1f` : C.soft,
                border: `1px solid ${mine ? C.cyan + '55' : C.border}`, color: C.text,
                wordBreak: 'break-word',
              }}>{m.text}</div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {!closed ? (
        <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: `1px solid ${C.border}` }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            maxLength={500}
            placeholder="Message your opponent…"
            style={{
              flex: 1, padding: '8px 10px', borderRadius: 8, fontSize: 13,
              background: C.soft, border: `1px solid ${C.border}`, color: C.text, outline: 'none',
            }}
          />
          <button onClick={send} disabled={sending || !text.trim()} style={{
            ...primaryBtn, opacity: sending || !text.trim() ? 0.5 : 1,
          }}>Send</button>
        </div>
      ) : (
        <div style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.dim, textAlign: 'center' }}>
          Match ended — chat is closed. History is kept for moderators.
        </div>
      )}
    </div>
  );
}

const chipBtn = {
  padding: '6px 10px', borderRadius: 999, border: `1px solid ${C.border}`,
  background: C.soft, color: C.text, fontWeight: 700, fontSize: 11, cursor: 'pointer',
};
const primaryBtn = {
  padding: '10px 14px', borderRadius: 8, border: 'none',
  background: `linear-gradient(135deg, ${C.gold}, ${C.goldLight})`,
  color: '#000', fontWeight: 900, fontSize: 12, cursor: 'pointer',
};
const secondaryBtn = {
  padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
  background: 'transparent', color: C.text, fontWeight: 700, fontSize: 12, cursor: 'pointer',
};
