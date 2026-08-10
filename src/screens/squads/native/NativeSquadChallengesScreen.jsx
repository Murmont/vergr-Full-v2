// Native Squad Challenges — /squads/:squadId/challenges on the APK. Reuses the
// web ChallengeCard + NewChallengeModal so payout / progress logic never drifts.
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  getSquad, getSquadMember, getSquadChallenges, createSquadChallenge,
  incrementChallengeProgress, completeSquadChallenge, deleteSquadChallenge,
} from '../../../firebase/firestore';
import { useAuth } from '../../../context/AuthContext';
import { useUI } from '../../../context/UIContext';
import { ChallengeCard, NewChallengeModal } from '../SquadChallengesScreen';
import NativeSquadScaffold from './NativeSquadScaffold';

const tsMs = (t) => (t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : t ? new Date(t).getTime() : 0);

export default function NativeSquadChallengesScreen() {
  const { squadId } = useParams();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const [squad, setSquad] = useState(null);
  const [role, setRole] = useState(null);
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);

  const canManage = role === 'president' || role === 'vice_president';

  const load = async () => {
    if (!squadId) return;
    setLoading(true);
    try { setChallenges(await getSquadChallenges(squadId)); } catch (err) { console.warn('Challenges load failed:', err); }
    setLoading(false);
  };

  useEffect(() => {
    if (!squadId) return;
    getSquad(squadId).then(setSquad).catch(() => {});
    if (currentUser?.uid) getSquadMember(squadId, currentUser.uid).then((m) => setRole(m?.role || null)).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squadId, currentUser?.uid]);

  const handleCreate = async (data) => {
    setCreating(true);
    try { await createSquadChallenge(squadId, currentUser.uid, data); showToast('Challenge created', 'success'); setShowNew(false); await load(); }
    catch (err) { showToast(err?.message || 'Failed to create', 'error'); }
    setCreating(false);
  };
  const handleIncrement = async (challenge, delta) => {
    try {
      await incrementChallengeProgress(squadId, challenge.id, currentUser.uid, delta);
      setChallenges((prev) => prev.map((c) => c.id === challenge.id ? { ...c, progress: { ...(c.progress || {}), [currentUser.uid]: (c.progress?.[currentUser.uid] || 0) + delta } } : c));
    } catch (err) { showToast(err?.message || 'Could not update progress', 'error'); }
  };
  const handleComplete = async (challenge) => {
    try { await completeSquadChallenge(squadId, challenge.id); setChallenges((prev) => prev.map((c) => c.id === challenge.id ? { ...c, status: 'completed' } : c)); showToast('Challenge marked complete', 'success'); }
    catch (err) { showToast(err?.message || 'Failed to complete', 'error'); }
  };
  const handleDelete = async (challenge) => {
    if (!window.confirm(`Delete "${challenge.title}"? Progress will be lost.`)) return;
    try { await deleteSquadChallenge(squadId, challenge.id); setChallenges((prev) => prev.filter((c) => c.id !== challenge.id)); showToast('Challenge deleted', 'info'); }
    catch (err) { showToast(err?.message || 'Failed to delete', 'error'); }
  };

  const { active, archived } = useMemo(() => {
    const a = []; const ar = [];
    for (const c of challenges) { if (c.status === 'completed') ar.push(c); else if (c.deadline && tsMs(c.deadline) < Date.now()) ar.push(c); else a.push(c); }
    return { active: a, archived: ar };
  }, [challenges]);

  const actions = canManage ? <button className="icon-btn" title="New challenge" onClick={() => setShowNew(true)}><span className="material-symbols-outlined">add</span></button> : null;

  return (
    <NativeSquadScaffold mode="squad" title="Challenges" activeId="challenges" squadId={squadId} squadName={squad?.name} actions={actions}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {loading ? <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 60 }}>Loading…</div>
          : challenges.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px', gap: 14, color: 'var(--t3)', textAlign: 'center', background: 'rgba(255,255,255,.02)', border: '1px dashed rgba(255,255,255,.08)', borderRadius: 18 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 56, opacity: .45 }}>military_tech</span>
              <div style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: 18, color: 'var(--t1)' }}>No active challenges</div>
              <div style={{ fontSize: 13 }}>Set squad-wide or individual goals. Members earn shared VP & coins when the goal is hit.</div>
              {canManage && <button className="btn primary" onClick={() => setShowNew(true)}><span className="material-symbols-outlined">add</span> Create First Challenge</button>}
            </div>
          ) : (
            <>
              {active.length > 0 && (
                <section>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--t3)', marginBottom: 10 }}>Active</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{active.map((c) => <ChallengeCard key={c.id} challenge={c} currentUid={currentUser?.uid} canManage={canManage} onIncrement={handleIncrement} onComplete={handleComplete} onDelete={handleDelete} />)}</div>
                </section>
              )}
              {archived.length > 0 && (
                <section>
                  <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--t3)', marginBottom: 10 }}>Completed & Expired</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{archived.map((c) => <ChallengeCard key={c.id} challenge={c} currentUid={currentUser?.uid} canManage={canManage} onIncrement={handleIncrement} onComplete={handleComplete} onDelete={handleDelete} />)}</div>
                </section>
              )}
            </>
          )}
      </div>
      <NewChallengeModal open={showNew} onClose={() => setShowNew(false)} onCreate={handleCreate} busy={creating} />
    </NativeSquadScaffold>
  );
}
