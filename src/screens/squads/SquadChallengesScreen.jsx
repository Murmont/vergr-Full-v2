// Squad Challenges — leader-created goals that reward shared VP/coins when
// hit. Two scopes: 'individual' (each member's own progress, multiple winners)
// and 'squad' (sum of everyone's progress, single team total).
// Wired to `squads/{id}/challenges` via firestore.js helpers.
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  getSquad, getSquadMembers, getSquadMember,
  getSquadChallenges, createSquadChallenge,
  incrementChallengeProgress, completeSquadChallenge, deleteSquadChallenge,
} from '../../firebase/firestore';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import SquadShell from '../../components/squad/SquadShell';
import SquadInfoRail from '../../components/squad/SquadInfoRail';
import Modal from '../../components/Modal';
import { compact } from '../../components/squad/squadHelpers';

const tsMs = (t) => (t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : t ? new Date(t).getTime() : 0);
const fmtDeadline = (t) => {
  const ms = tsMs(t);
  if (!ms) return 'No deadline';
  const remaining = ms - Date.now();
  if (remaining < 0) return 'Expired';
  const days = Math.floor(remaining / (24 * 3600 * 1000));
  if (days > 1) return `${days} days left`;
  const hours = Math.floor(remaining / (3600 * 1000));
  if (hours > 1) return `${hours} hours left`;
  const mins = Math.max(1, Math.floor(remaining / 60000));
  return `${mins} min left`;
};
const fmtDateLocalInput = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function ProgressBar({ value, max, color = 'var(--violet-light)' }) {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  return (
    <div style={{ height: 6, background: 'rgba(255,255,255,.06)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width .3s' }} />
    </div>
  );
}

export function ChallengeCard({ challenge, currentUid, canManage, onIncrement, onComplete, onDelete }) {
  const isSquad = challenge.scope === 'squad';
  const progressMap = challenge.progress || {};
  const myProgress = currentUid ? (progressMap[currentUid] || 0) : 0;
  const teamProgress = Object.values(progressMap).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
  const value = isSquad ? teamProgress : myProgress;
  const isCompleted = challenge.status === 'completed';
  const isExpired = challenge.deadline && tsMs(challenge.deadline) < Date.now();
  const hitGoal = value >= challenge.goal;

  return (
    <div style={{
      padding: 18, borderRadius: 14,
      background: 'rgba(255,255,255,.025)',
      border: `1px solid ${isCompleted ? 'rgba(34,209,126,.35)' : hitGoal ? 'rgba(240,165,0,.35)' : 'rgba(255,255,255,.06)'}`,
      opacity: isExpired && !isCompleted ? .55 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          display: 'grid', placeItems: 'center',
          background: isCompleted ? 'rgba(34,209,126,.12)' : 'rgba(240,165,0,.12)',
          border: `1px solid ${isCompleted ? 'rgba(34,209,126,.3)' : 'rgba(240,165,0,.3)'}`,
        }}>
          <span className="material-symbols-outlined" style={{ color: isCompleted ? 'var(--success)' : 'var(--gold-light)', fontSize: 22 }}>
            {isCompleted ? 'check_circle' : 'military_tech'}
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 15, color: '#fff' }}>
              {challenge.title || 'Untitled'}
            </span>
            <span style={{
              fontFamily: 'DM Mono', fontSize: 9.5, padding: '2px 7px', borderRadius: 4,
              background: isSquad ? 'rgba(180,79,255,.14)' : 'rgba(180,79,255,.12)',
              color: isSquad ? 'var(--violet-light)' : 'var(--cyan)',
              textTransform: 'uppercase', letterSpacing: '.1em',
            }}>{isSquad ? 'Squad' : 'Individual'}</span>
            {isCompleted && (
              <span style={{ fontFamily: 'DM Mono', fontSize: 9.5, padding: '2px 7px', borderRadius: 4, background: 'rgba(34,209,126,.18)', color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 700 }}>
                Completed
              </span>
            )}
          </div>
          {challenge.description && (
            <div style={{ marginTop: 6, fontSize: 13, color: 'var(--t2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {challenge.description}
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'DM Mono', fontSize: 11, color: 'var(--t2)', marginBottom: 4 }}>
              <span>{isSquad ? 'Team progress' : 'My progress'}</span>
              <span style={{ color: hitGoal ? 'var(--gold-light)' : 'var(--t1)', fontWeight: 700 }}>
                {compact(value)} / {compact(challenge.goal)}
              </span>
            </div>
            <ProgressBar value={value} max={challenge.goal} color={isCompleted ? 'var(--success)' : hitGoal ? 'var(--gold-light)' : 'var(--violet-light)'} />
          </div>

          {challenge.payoutNote && (
            <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(240,165,0,.08)', border: '1px solid rgba(240,165,0,.25)', borderRadius: 8, fontSize: 11.5, color: 'var(--gold-light)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 13, verticalAlign: '-2px', marginRight: 4 }}>warning</span>
              {challenge.payoutNote}
            </div>
          )}
          {challenge.rewardsPaid && challenge.paidOutTo && (
            <div style={{ marginTop: 8, fontFamily: 'DM Mono', fontSize: 10.5, color: 'var(--success)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 12, verticalAlign: '-2px', marginRight: 4 }}>check_circle</span>
              Paid {challenge.paidVp ? `${challenge.paidVp} VP` : ''}{challenge.paidVp && challenge.paidCoins ? ' + ' : ''}{challenge.paidCoins ? `${challenge.paidCoins} coins` : ''} to {challenge.paidOutTo.length} member{challenge.paidOutTo.length === 1 ? '' : 's'}
            </div>
          )}
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {(challenge.vpReward > 0 || challenge.coinReward > 0) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'DM Mono', fontSize: 11, color: 'var(--t2)' }}>
                {challenge.vpReward > 0 && (
                  <span><span className="gem" /><strong style={{ color: 'var(--violet-light)' }}>{compact(challenge.vpReward)}</strong> VP</span>
                )}
                {challenge.coinReward > 0 && (
                  <span><span className="coin" /><strong style={{ color: 'var(--gold-light)' }}>{compact(challenge.coinReward)}</strong></span>
                )}
              </div>
            )}
            <span style={{ fontFamily: 'DM Mono', fontSize: 11, color: isExpired ? 'var(--ember)' : 'var(--t3)' }}>
              {fmtDeadline(challenge.deadline)}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {canManage && !isCompleted && hitGoal && (
                <button onClick={() => onComplete(challenge)} className="btn primary sm">
                  <span className="material-symbols-outlined">check</span> Mark complete
                </button>
              )}
              {canManage && !isCompleted && (
                <button onClick={() => onIncrement(challenge, 1)} className="btn ghost sm" title="Increment your progress">
                  <span className="material-symbols-outlined">add</span> +1
                </button>
              )}
              {canManage && (
                <button onClick={() => onDelete(challenge)} className="btn danger sm" title="Delete">
                  <span className="material-symbols-outlined">delete</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function NewChallengeModal({ open, onClose, onCreate, busy }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState('squad');
  const [goal, setGoal] = useState(10);
  const [vpReward, setVpReward] = useState(100);
  const [coinReward, setCoinReward] = useState(0);
  const [deadline, setDeadline] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(23, 59, 0, 0);
    return fmtDateLocalInput(d);
  });
  const reset = () => { setTitle(''); setDescription(''); setScope('squad'); setGoal(10); setVpReward(100); setCoinReward(0); };
  const submit = async () => {
    if (!title.trim()) return;
    await onCreate({ title, description, scope, goal, vpReward, coinReward, deadline: deadline || null });
    reset();
  };
  return (
    <Modal isOpen={open} onClose={() => { reset(); onClose(); }} title="New Challenge">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--t3)', marginBottom: 6 }}>Scope</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setScope('squad')} className={`chip${scope === 'squad' ? ' active' : ''}`} style={{ flex: 1, padding: '12px 14px', borderRadius: 12, textAlign: 'left' }}>
              <div style={{ fontWeight: 700, fontSize: 12.5 }}>Squad</div>
              <div style={{ fontSize: 10.5, opacity: .8, marginTop: 2 }}>Sum across everyone, one team goal</div>
            </button>
            <button onClick={() => setScope('individual')} className={`chip${scope === 'individual' ? ' active' : ''}`} style={{ flex: 1, padding: '12px 14px', borderRadius: 12, textAlign: 'left' }}>
              <div style={{ fontWeight: 700, fontSize: 12.5 }}>Individual</div>
              <div style={{ fontSize: 10.5, opacity: .8, marginTop: 2 }}>Each member tracks their own</div>
            </button>
          </div>
        </div>
        <div>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--t3)', marginBottom: 6 }}>Title</div>
          <input
            value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80}
            placeholder="Win 25 ranked matches this week"
            style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, color: '#fff', fontSize: 14 }}
          />
        </div>
        <div>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--t3)', marginBottom: 6 }}>Details</div>
          <textarea
            value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={300}
            placeholder="How to track progress, special rules…"
            style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, color: '#fff', fontSize: 14, resize: 'vertical', minHeight: 60 }}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <div>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--t3)', marginBottom: 6 }}>Goal</div>
            <input type="number" min={1} value={goal} onChange={(e) => setGoal(Number(e.target.value) || 1)}
              style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, color: '#fff', fontSize: 14 }}
            />
          </div>
          <div>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--t3)', marginBottom: 6 }}>VP Reward</div>
            <input type="number" min={0} value={vpReward} onChange={(e) => setVpReward(Number(e.target.value) || 0)}
              style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, color: '#fff', fontSize: 14 }}
            />
          </div>
          <div>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--t3)', marginBottom: 6 }}>Coin Reward</div>
            <input type="number" min={0} value={coinReward} onChange={(e) => setCoinReward(Number(e.target.value) || 0)}
              style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, color: '#fff', fontSize: 14 }}
            />
          </div>
        </div>
        <div>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--t3)', marginBottom: 6 }}>Deadline</div>
          <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, color: '#fff', fontSize: 13 }}
          />
        </div>
        <div style={{ padding: 10, background: 'rgba(123,31,255,.06)', border: '1px solid rgba(180,79,255,.18)', borderRadius: 10, fontSize: 11.5, color: 'var(--t2)', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--t1)' }}>How payouts work:</strong> when you mark the challenge complete, every eligible contributor automatically gets the VP reward. Coin rewards come from the squad treasury — if the treasury can't cover the total cost, only VP pays out and the shortfall is flagged for manual top-up.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn ghost" onClick={() => { reset(); onClose(); }}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy || !title.trim() || goal < 1}>
            {busy ? 'Creating…' : 'Create Challenge'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function SquadChallengesScreen() {
  const { squadId } = useParams();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const [squad, setSquad] = useState(null);
  const [members, setMembers] = useState([]);
  const [role, setRole] = useState(null);
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);

  const canManage = role === 'president' || role === 'vice_president';

  const load = async () => {
    if (!squadId) return;
    setLoading(true);
    try { setChallenges(await getSquadChallenges(squadId)); }
    catch (err) { console.warn('Challenges load failed:', err); }
    setLoading(false);
  };

  useEffect(() => {
    if (!squadId) return;
    getSquad(squadId).then(setSquad).catch(() => {});
    getSquadMembers(squadId).then(setMembers).catch(() => {});
    if (currentUser?.uid) getSquadMember(squadId, currentUser.uid).then((m) => setRole(m?.role || null)).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squadId, currentUser?.uid]);

  const handleCreate = async (data) => {
    setCreating(true);
    try {
      await createSquadChallenge(squadId, currentUser.uid, data);
      showToast('Challenge created', 'success');
      setShowNew(false);
      await load();
    } catch (err) {
      console.error('Create challenge failed:', err);
      showToast(err?.message || 'Failed to create', 'error');
    }
    setCreating(false);
  };

  const handleIncrement = async (challenge, delta) => {
    try {
      await incrementChallengeProgress(squadId, challenge.id, currentUser.uid, delta);
      setChallenges((prev) => prev.map((c) => c.id === challenge.id ? {
        ...c,
        progress: { ...(c.progress || {}), [currentUser.uid]: (c.progress?.[currentUser.uid] || 0) + delta },
      } : c));
    } catch (err) {
      showToast(err?.message || 'Could not update progress', 'error');
    }
  };

  const handleComplete = async (challenge) => {
    try {
      await completeSquadChallenge(squadId, challenge.id);
      setChallenges((prev) => prev.map((c) => c.id === challenge.id ? { ...c, status: 'completed' } : c));
      showToast('Challenge marked complete', 'success');
    } catch (err) {
      showToast(err?.message || 'Failed to complete', 'error');
    }
  };

  const handleDelete = async (challenge) => {
    if (!window.confirm(`Delete "${challenge.title}"? Progress will be lost.`)) return;
    try {
      await deleteSquadChallenge(squadId, challenge.id);
      setChallenges((prev) => prev.filter((c) => c.id !== challenge.id));
      showToast('Challenge deleted', 'info');
    } catch (err) {
      showToast(err?.message || 'Failed to delete', 'error');
    }
  };

  const { active, archived } = useMemo(() => {
    const a = []; const ar = [];
    for (const c of challenges) {
      if (c.status === 'completed') ar.push(c);
      else if (c.deadline && tsMs(c.deadline) < Date.now()) ar.push(c);
      else a.push(c);
    }
    return { active: a, archived: ar };
  }, [challenges]);

  return (
    <SquadShell mode="squad" activeId="challenges" squadId={squadId} rightRail={<SquadInfoRail squad={squad} members={members} />}>
      <main className="main" style={{ overflowY: 'auto' }}>
        <header className="channel-header">
          <div className="channel-title">
            <span className="channel-name">Challenges</span>
            <span className="channel-divider" />
            <span className="channel-desc">Squad-wide goals that reward shared VP & coins</span>
          </div>
          {canManage && (
            <button className="btn primary" onClick={() => setShowNew(true)}>
              <span className="material-symbols-outlined">add</span> New Challenge
            </button>
          )}
        </header>

        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 60 }}>Loading…</div>
          ) : challenges.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', gap: 14, color: 'var(--t3)', textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px dashed rgba(255,255,255,.08)', borderRadius: 18 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 56, opacity: .45 }}>military_tech</span>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 18, color: 'var(--t1)' }}>No active challenges</div>
              <div style={{ fontSize: 13, maxWidth: 380 }}>Set squad-wide goals (win 25 ranked matches this week) or individual ones (each member streams 3 hours). Members earn shared VP & coins when the goal is hit.</div>
              {canManage && (
                <button className="btn primary" onClick={() => setShowNew(true)}>
                  <span className="material-symbols-outlined">add</span> Create First Challenge
                </button>
              )}
            </div>
          ) : (
            <>
              {active.length > 0 && (
                <section>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--t3)', marginBottom: 10 }}>Active</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {active.map((c) => (
                      <ChallengeCard key={c.id} challenge={c} currentUid={currentUser?.uid} canManage={canManage}
                        onIncrement={handleIncrement} onComplete={handleComplete} onDelete={handleDelete} />
                    ))}
                  </div>
                </section>
              )}
              {archived.length > 0 && (
                <section>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--t3)', marginBottom: 10 }}>Completed & Expired</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {archived.map((c) => (
                      <ChallengeCard key={c.id} challenge={c} currentUid={currentUser?.uid} canManage={canManage}
                        onIncrement={handleIncrement} onComplete={handleComplete} onDelete={handleDelete} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        <NewChallengeModal open={showNew} onClose={() => setShowNew(false)} onCreate={handleCreate} busy={creating} />
      </main>
    </SquadShell>
  );
}
