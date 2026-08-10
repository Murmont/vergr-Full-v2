// SquadChampionVote — squad-member poll for electing tournament champions
// + backups. Wraps the deployed callables:
//   - startSquadChampionVote     (owner only, creates the poll)
//   - castSquadChampionVote      (members, multi-select up to slots+backups)
//   - finalizeSquadChampionVote  (owner, closes poll + stamps tournament)
//
// Three exports:
//   <StartSquadChampionVoteModal /> — owner opens a new vote
//   <ChampionBallot />              — member votes / sees live tally
//   <SquadChampionVoteEntry />      — single button rendered on SquadDetail
//                                     that auto-routes to the right surface.

import { useEffect, useMemo, useState } from 'react';
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase/config';
import Icon from '../Icon';
import UserAvatar from '../UserAvatar';

const C = {
  bg: '#0B0B14', surface: '#14141F', soft: '#1A1A2A',
  border: 'rgba(255,255,255,0.10)',
  text: '#fff', dim: 'rgba(255,255,255,0.65)', mute: 'rgba(255,255,255,0.45)',
  cyan: '#B44FFF', violet: '#7B1FFF', violetLt: '#B44FFF',
  gold: '#F0A500', green: '#22c55e',
};

const fns = () => getFunctions(undefined, 'europe-west1');

// Subscribe to the active champion-vote poll for (tournamentId, squadId).
// Returns { poll, loading }. Null poll = none open.
function useActiveChampionVote(tournamentId, squadId) {
  const [poll, setPoll] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId || !squadId) { setLoading(false); return; }
    setLoading(true);
    const q = query(
      collection(db, 'polls'),
      where('type', '==', 'tournament_champion_vote'),
      where('tournamentId', '==', tournamentId),
      where('squadId', '==', squadId),
      where('status', '==', 'active'),
    );
    return onSnapshot(q, (snap) => {
      if (snap.empty) setPoll(null);
      else {
        const d = snap.docs[0];
        setPoll({ id: d.id, ...d.data() });
      }
      setLoading(false);
    }, () => setLoading(false));
  }, [tournamentId, squadId]);

  return { poll, loading };
}

// ─── StartSquadChampionVoteModal ────────────────────────────────────────
export function StartSquadChampionVoteModal({
  tournamentId, squadId, tournamentName, slotsNeeded, defaultBackups = 2, onClose, onStarted, onToast,
}) {
  const [backupSlots, setBackupSlots] = useState(defaultBackups);
  const [durationHours, setDurationHours] = useState(24);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await httpsCallable(fns(), 'startSquadChampionVote')({
        tournamentId, squadId, slotsNeeded, backupSlots, durationHours,
      });
      onToast?.('Champion vote opened. Members can ballot now.', 'success');
      onStarted?.(data.pollId);
      onClose?.();
    } catch (e) {
      onToast?.(e?.message || 'Failed to open vote', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        maxWidth: 420, width: '100%', background: C.surface,
        border: `1px solid ${C.border}`, borderRadius: 16, padding: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Icon name="how_to_vote" size={20} style={{ color: C.violetLt }} />
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 18, color: C.text }}>
            Open Champion Vote
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 16, lineHeight: 1.5 }}>
          Let your squad pick which {slotsNeeded} members compete in <strong style={{ color: C.text }}>{tournamentName}</strong>.
          Top {slotsNeeded} by tally become champions; next batch become backups.
        </div>

        <label style={lbl}>Champion slots</label>
        <div style={{ ...inputBox, color: C.text }}>{slotsNeeded} (set by tournament)</div>

        <label style={lbl}>Backup slots</label>
        <input
          type="number" min={0} max={5} value={backupSlots}
          onChange={(e) => setBackupSlots(Math.max(0, Math.min(5, Number(e.target.value))))}
          style={inputBox}
        />

        <label style={lbl}>Vote duration (hours)</label>
        <input
          type="number" min={1} max={72} value={durationHours}
          onChange={(e) => setDurationHours(Math.max(1, Math.min(72, Number(e.target.value))))}
          style={inputBox}
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} disabled={busy} style={btnGhost}>Cancel</button>
          <button onClick={submit} disabled={busy} style={btnPrimary}>
            {busy ? 'Opening…' : 'Open vote'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ChampionBallot ─────────────────────────────────────────────────────
// Member ballot UI. Shows candidates, my picks (persisted), live tally,
// finalize button for owner.
export function ChampionBallot({ poll, currentUid, isOwner, members, onToast, onClose }) {
  const [picks, setPicks] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (poll?.voters?.[currentUid]) setPicks(poll.voters[currentUid]);
  }, [poll?.id, currentUid]); // eslint-disable-line

  const cap = (poll?.slotsNeeded || 0) + (poll?.backupSlots || 0);
  const totalVotes = useMemo(
    () => Object.values(poll?.voteTallies || {}).reduce((a, b) => a + (b || 0), 0),
    [poll?.voteTallies],
  );
  const memberById = useMemo(() => {
    const m = {};
    (members || []).forEach((u) => { m[u.id || u.uid] = u; });
    return m;
  }, [members]);

  const toggle = (uid) => {
    setPicks((prev) => {
      if (prev.includes(uid)) return prev.filter((x) => x !== uid);
      if (prev.length >= cap) {
        onToast?.(`Pick up to ${cap} candidates.`, 'info');
        return prev;
      }
      return [...prev, uid];
    });
  };

  const cast = async () => {
    if (busy || picks.length === 0) return;
    setBusy(true);
    try {
      await httpsCallable(fns(), 'castSquadChampionVote')({ pollId: poll.id, picks });
      onToast?.('Ballot recorded.', 'success');
    } catch (e) {
      onToast?.(e?.message || 'Vote failed', 'error');
    } finally { setBusy(false); }
  };

  const finalize = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await httpsCallable(fns(), 'finalizeSquadChampionVote')({ pollId: poll.id });
      onToast?.(`Champions locked: ${data.champions.length}. Backups: ${data.backups.length}.`, 'success');
      onClose?.();
    } catch (e) {
      onToast?.(e?.message || 'Finalize failed', 'error');
    } finally { setBusy(false); }
  };

  const expired = poll?.expiresAt?.toMillis && poll.expiresAt.toMillis() < Date.now();

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto',
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div>
            <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 18, color: C.text }}>
              {poll.title || 'Champion Vote'}
            </div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
              Pick up to {cap} · {poll.slotsNeeded} champions + {poll.backupSlots} backups
              {expired && <span style={{ color: C.gold, marginLeft: 6 }}>· EXPIRED</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, color: C.dim, cursor: 'pointer' }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <div style={{
          fontFamily: 'DM Mono, monospace', fontSize: 10, color: C.mute,
          marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em',
        }}>Candidates · {totalVotes} total votes</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(poll.candidateUids || []).map((uid) => {
            const votes = poll.voteTallies?.[uid] || 0;
            const pct = totalVotes > 0 ? Math.round((votes / Math.max(1, totalVotes)) * 100) : 0;
            const checked = picks.includes(uid);
            const u = memberById[uid] || {};
            const isMe = uid === currentUid;
            return (
              <button
                key={uid}
                onClick={() => toggle(uid)}
                disabled={expired}
                style={{
                  position: 'relative', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', borderRadius: 10,
                  background: checked ? `${C.violet}22` : C.soft,
                  border: `1px solid ${checked ? C.violet : C.border}`,
                  cursor: expired ? 'not-allowed' : 'pointer', overflow: 'hidden',
                  textAlign: 'left',
                }}
              >
                {/* Tally bar */}
                <div style={{
                  position: 'absolute', inset: 0,
                  background: `linear-gradient(to right, ${C.violetLt}11 0%, ${C.violetLt}11 ${pct}%, transparent ${pct}%)`,
                  pointerEvents: 'none',
                }} />
                <Icon name={checked ? 'check_box' : 'check_box_outline_blank'}
                  size={18} style={{ color: checked ? C.violetLt : C.mute, zIndex: 1 }} />
                <UserAvatar uid={uid} size="xs" />
                <div style={{ flex: 1, minWidth: 0, zIndex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {u.username || uid.slice(0, 8)}{isMe && <span style={{ color: C.cyan, marginLeft: 4 }}>· you</span>}
                  </div>
                </div>
                <div style={{
                  fontFamily: 'DM Mono, monospace', fontSize: 11, fontWeight: 800,
                  color: checked ? C.violetLt : C.dim, zIndex: 1,
                }}>{votes} · {pct}%</div>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {!expired && (
            <button onClick={cast} disabled={busy || picks.length === 0} style={{
              ...btnPrimary, flex: 1, opacity: (busy || picks.length === 0) ? 0.6 : 1,
            }}>
              {poll.voters?.[currentUid] ? 'Update ballot' : 'Cast ballot'}
              {picks.length > 0 && ` (${picks.length})`}
            </button>
          )}
          {isOwner && (
            <button onClick={finalize} disabled={busy} style={{
              ...btnGold, flex: expired ? 1 : 0,
            }}>
              {busy ? 'Closing…' : 'Finalize & lock'}
            </button>
          )}
        </div>
        <div style={{ fontSize: 10, color: C.mute, marginTop: 8, lineHeight: 1.4 }}>
          Top {poll.slotsNeeded} by tally become champions. Ties broken by squad-join order.
        </div>
      </div>
    </div>
  );
}

// ─── SquadChampionVoteEntry ─────────────────────────────────────────────
// Single button: opens StartSquadChampionVoteModal (owner, no active poll)
// OR ChampionBallot (member, active poll). Hides when not applicable.
export function SquadChampionVoteEntry({
  tournamentId, squadId, tournamentName, slotsNeeded, currentUid, isOwner, members, onToast,
}) {
  const { poll, loading } = useActiveChampionVote(tournamentId, squadId);
  const [showStart, setShowStart] = useState(false);
  const [showBallot, setShowBallot] = useState(false);
  const [tournament, setTournament] = useState(null);

  // Resolve slotsNeeded from tournament if not provided.
  useEffect(() => {
    if (slotsNeeded || !tournamentId) return;
    getDoc(doc(db, 'tournaments', tournamentId)).then((s) => {
      if (s.exists()) setTournament(s.data());
    });
  }, [tournamentId, slotsNeeded]);
  const slots = slotsNeeded || tournament?.squadSize || tournament?.teamSize || 5;

  if (loading) return null;

  // Tournament already has finalized champions for this squad — show locked badge.
  if (tournament?.squadChampions?.[squadId]?.length > 0 && !poll) {
    return (
      <div style={badgeLocked}>
        <Icon name="lock" size={12} />
        Champions locked
      </div>
    );
  }

  return (
    <>
      {poll ? (
        <button onClick={() => setShowBallot(true)} style={btnVote}>
          <Icon name="how_to_vote" size={14} />
          {poll.voters?.[currentUid] ? 'Ballot cast · update' : 'Cast champion ballot'}
        </button>
      ) : isOwner ? (
        <button onClick={() => setShowStart(true)} style={btnVote}>
          <Icon name="how_to_vote" size={14} />
          Open champion vote
        </button>
      ) : (
        <div style={{ fontSize: 11, color: C.mute, padding: '6px 0' }}>
          Squad owner hasn't opened champion voting yet.
        </div>
      )}

      {showStart && (
        <StartSquadChampionVoteModal
          tournamentId={tournamentId} squadId={squadId}
          tournamentName={tournamentName || tournament?.name || 'this tournament'}
          slotsNeeded={slots}
          onClose={() => setShowStart(false)}
          onToast={onToast}
        />
      )}
      {showBallot && poll && (
        <ChampionBallot
          poll={poll} currentUid={currentUid} isOwner={isOwner} members={members}
          onClose={() => setShowBallot(false)} onToast={onToast}
        />
      )}
    </>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────
const lbl = {
  display: 'block', fontFamily: 'DM Mono, monospace', fontSize: 10,
  color: C.mute, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 12, marginBottom: 4,
};
const inputBox = {
  width: '100%', padding: 10, borderRadius: 8,
  background: C.soft, border: `1px solid ${C.border}`,
  color: C.text, fontFamily: 'DM Sans', fontSize: 13, outline: 'none',
};
const btnPrimary = {
  flex: 1, padding: '10px 14px', borderRadius: 8, border: 'none',
  background: C.violet, color: C.text, fontSize: 13, fontWeight: 800, cursor: 'pointer',
};
const btnGold = {
  padding: '10px 14px', borderRadius: 8, border: 'none',
  background: C.gold, color: '#000', fontSize: 13, fontWeight: 800, cursor: 'pointer',
};
const btnGhost = {
  flex: 1, padding: '10px 14px', borderRadius: 8,
  border: `1px solid ${C.border}`, background: 'transparent',
  color: C.dim, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const btnVote = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 12px', borderRadius: 10,
  background: `${C.violet}22`, border: `1px solid ${C.violet}55`,
  color: C.violetLt, fontSize: 12, fontWeight: 800, cursor: 'pointer',
};
const badgeLocked = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '6px 10px', borderRadius: 999,
  background: C.gold + '15', border: `1px solid ${C.gold}44`,
  color: C.gold, fontSize: 11, fontWeight: 700,
};
