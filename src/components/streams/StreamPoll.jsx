// StreamPoll — live polls for streams. Reuses the existing polls collection
// (createPoll / voteOnPoll). A stream poll is a poll doc with streamId set and
// type:'stream'. Host creates one mid-stream; viewers vote; results update live.
//
//   const { poll, myVote, closed } = useActiveStreamPoll(hostUid, currentUserUid);
//   <StreamPollCard poll={poll} myVote={myVote} closed={closed} onVote={...} />
//   <CreateStreamPollModal hostUid streamId onClose />

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  collection, query, where, orderBy, limit, onSnapshot, doc,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { createPoll, voteOnPoll } from '../../firebase/firestore';
import Icon from '../Icon';

const C = {
  bg: '#12121e', bgSoft: '#0f0f1a', border: 'rgba(255,255,255,0.10)',
  text: '#e8e8f0', textDim: '#a0a0b8', textMuted: '#6b7280',
  purple: '#7c3aed', purpleLight: '#b44fff', amber: '#F0A500',
};

const tsMs = (t) => t?.toMillis?.() ?? (typeof t === 'number' ? t : (t?.seconds ? t.seconds * 1000 : 0));

// Subscribe to the host's current active stream poll + this viewer's vote.
export function useActiveStreamPoll(hostUid, uid) {
  const [poll, setPoll] = useState(null);
  const [myVote, setMyVote] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!hostUid) { setPoll(null); return; }
    const q = query(
      collection(db, 'polls'),
      where('createdBy', '==', hostUid),
      where('type', '==', 'stream'),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc'),
      limit(1),
    );
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) { setPoll(null); return; }
      const d = snap.docs[0];
      setPoll({ id: d.id, ...d.data() });
    }, () => setPoll(null));
    return unsub;
  }, [hostUid]);

  useEffect(() => {
    if (!poll?.id || !uid) { setMyVote(null); return; }
    const unsub = onSnapshot(doc(db, 'polls', poll.id, 'votes', uid), (snap) => {
      setMyVote(snap.exists() ? (snap.data().optionIndex ?? null) : null);
    }, () => setMyVote(null));
    return unsub;
  }, [poll?.id, uid]);

  // Re-evaluate "closed" once per second (so an expiry flips the UI without a write).
  useEffect(() => {
    if (!poll) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [poll?.id]);

  const expMs = tsMs(poll?.expiresAt);
  const closed = !!poll && (poll.status !== 'active' || (expMs > 0 && Date.now() > expMs));
  return { poll, myVote, closed, tick };
}

export function StreamPollCard({ poll, myVote, closed, uid, onClose, compact = false }) {
  const [voting, setVoting] = useState(false);
  if (!poll) return null;
  const options = poll.options || [];
  const votes = poll.votes || {};
  const total = poll.totalVotes || options.reduce((s, _o, i) => s + (votes[i] || 0), 0);
  const showResults = closed || myVote != null || compact;
  const expMs = tsMs(poll.expiresAt);
  const remain = expMs ? Math.max(0, Math.round((expMs - Date.now()) / 1000)) : 0;

  const vote = async (i) => {
    if (voting || closed || myVote != null || !uid) return;
    setVoting(true);
    try { await voteOnPoll(poll.id, i, uid); } catch { /* ignore */ } finally { setVoting(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      style={{
        width: compact ? '100%' : 'min(320px, 86vw)',
        background: 'rgba(15,15,26,0.92)', backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)', border: `1px solid ${C.border}`,
        borderRadius: 14, padding: 14, color: C.text,
        fontFamily: '"Inter", system-ui, sans-serif',
        boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <Icon name="poll" size={15} className="" />
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', color: C.purpleLight }}>
          {closed ? 'POLL CLOSED' : 'LIVE POLL'}
        </span>
        {!closed && expMs > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: C.textMuted, fontFamily: 'DM Mono, monospace' }}>
            {remain}s
          </span>
        )}
        {onClose && (
          <button onClick={onClose} style={{ marginLeft: closed ? 'auto' : 8, background: 'transparent', border: 'none', color: C.textMuted, cursor: 'pointer', padding: 0 }}>
            <Icon name="close" size={14} className="" />
          </button>
        )}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{poll.question || poll.title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {options.map((opt, i) => {
          const count = votes[i] || 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const mine = myVote === i;
          return (
            <button
              key={i}
              onClick={() => vote(i)}
              disabled={showResults || voting}
              style={{
                position: 'relative', textAlign: 'left', padding: '9px 12px',
                borderRadius: 9, overflow: 'hidden', cursor: showResults ? 'default' : 'pointer',
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${mine ? C.purpleLight : C.border}`,
                color: C.text, fontSize: 12.5, fontWeight: 600,
              }}
            >
              {showResults && (
                <div style={{
                  position: 'absolute', inset: 0, width: `${pct}%`,
                  background: mine ? 'rgba(180,79,255,0.30)' : 'rgba(124,58,237,0.18)',
                  transition: 'width 0.4s',
                }} />
              )}
              <span style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
                {mine && <Icon name="check_circle" size={13} className="" />}
                <span style={{ flex: 1 }}>{opt}</span>
                {showResults && <span style={{ fontFamily: 'DM Mono, monospace', fontWeight: 800 }}>{pct}%</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: C.textMuted, marginTop: 8, textAlign: 'right' }}>
        {total} vote{total === 1 ? '' : 's'}{!showResults ? ' · tap to vote' : ''}
      </div>
    </motion.div>
  );
}

export function CreateStreamPollModal({ hostUid, streamId, onClose, showToast }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [duration, setDuration] = useState(60); // seconds
  const [busy, setBusy] = useState(false);

  const setOpt = (i, v) => setOptions((o) => o.map((x, j) => (j === i ? v : x)));
  const addOpt = () => setOptions((o) => (o.length >= 4 ? o : [...o, '']));
  const removeOpt = (i) => setOptions((o) => (o.length <= 2 ? o : o.filter((_, j) => j !== i)));

  const create = async () => {
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || opts.length < 2) { showToast?.('Add a question and at least 2 options', 'error'); return; }
    setBusy(true);
    try {
      await createPoll(hostUid, {
        question: question.trim().slice(0, 120),
        options: opts.slice(0, 4),
        type: 'stream',
        streamId,
        expiresAt: new Date(Date.now() + duration * 1000),
      });
      showToast?.('Poll started', 'success');
      onClose?.();
    } catch (e) {
      showToast?.(e?.message || 'Could not start poll', 'error');
    } finally { setBusy(false); }
  };

  const DURATIONS = [30, 60, 120, 300];

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 220,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 'min(400px, 100%)', background: C.bg, border: `1px solid ${C.border}`,
        borderRadius: 16, padding: 20, color: C.text, fontFamily: '"Inter", system-ui, sans-serif',
      }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>Start a poll</div>
        <input
          value={question} onChange={(e) => setQuestion(e.target.value.slice(0, 120))}
          placeholder="Ask your viewers…"
          style={inp}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0' }}>
          {options.map((o, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input value={o} onChange={(e) => setOpt(i, e.target.value.slice(0, 60))}
                placeholder={`Option ${i + 1}`} style={{ ...inp, margin: 0 }} />
              {options.length > 2 && (
                <button onClick={() => removeOpt(i)} style={iconBtn}><Icon name="close" size={14} className="" /></button>
              )}
            </div>
          ))}
          {options.length < 4 && (
            <button onClick={addOpt} style={{
              alignSelf: 'flex-start', background: 'transparent', border: 'none',
              color: C.purpleLight, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0,
            }}>+ Add option</button>
          )}
        </div>
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6 }}>Duration</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {DURATIONS.map((d) => (
            <button key={d} onClick={() => setDuration(d)} style={{
              padding: '6px 12px', borderRadius: 7, cursor: 'pointer',
              background: duration === d ? 'rgba(124,58,237,0.28)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${duration === d ? C.purpleLight : C.border}`,
              color: duration === d ? '#fff' : C.textDim, fontSize: 12, fontWeight: 700,
            }}>{d < 60 ? `${d}s` : `${d / 60}m`}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={busy} style={{
            flex: 1, padding: 11, borderRadius: 9, border: `1px solid ${C.border}`,
            background: 'transparent', color: C.textDim, fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={create} disabled={busy} style={{
            flex: 2, padding: 11, borderRadius: 9, border: 'none',
            background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
            color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', opacity: busy ? 0.6 : 1,
          }}>{busy ? 'Starting…' : 'Start poll'}</button>
        </div>
      </div>
    </div>
  );
}

const inp = {
  width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)',
  border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px',
  color: C.text, fontSize: 13, outline: 'none',
};
const iconBtn = {
  width: 30, height: 30, borderRadius: 7, border: `1px solid ${C.border}`,
  background: 'transparent', color: C.textMuted, cursor: 'pointer', flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

export default StreamPollCard;
