import { useEffect, useMemo, useState } from 'react';
import { doc, collection, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { voteChatPoll, retractChatPollVote } from '../../firebase/firestore';
import Icon from '../Icon';

// Live poll card rendered inside a chat bubble (DM/group + squad chat share
// it). Telegram interaction model: tap an option to vote; tap your own
// choice again to retract; multi-choice polls toggle. Results animate as
// votes land (onSnapshot on the votes subcollection — chat-sized, cheap).
export default function ChatPollBubble({ pollId, isMe }) {
  const [poll, setPoll] = useState(undefined); // undefined=loading, null=gone
  const [votes, setVotes] = useState({});      // uid -> picks[]
  const [busy, setBusy] = useState(false);
  const me = auth.currentUser?.uid;

  useEffect(() => {
    if (!pollId) return undefined;
    const offPoll = onSnapshot(doc(db, 'chat_polls', pollId),
      (s) => setPoll(s.exists() ? { id: s.id, ...s.data() } : null),
      () => setPoll(null));
    const offVotes = onSnapshot(collection(db, 'chat_polls', pollId, 'votes'),
      (s) => {
        const v = {};
        s.forEach((d) => { v[d.id] = d.data().picks || []; });
        setVotes(v);
      }, () => {});
    return () => { offPoll(); offVotes(); };
  }, [pollId]);

  const { counts, total, myPicks } = useMemo(() => {
    const c = new Array(poll?.options?.length || 0).fill(0);
    let voters = 0;
    for (const picks of Object.values(votes)) {
      if (picks.length > 0) voters += 1;
      for (const i of picks) if (c[i] != null) c[i] += 1;
    }
    return { counts: c, total: voters, myPicks: votes[me] || [] };
  }, [votes, poll, me]);

  if (poll === undefined) {
    return <div className="w-60 px-4 py-3 text-xs text-text-muted flex items-center gap-2"><Icon name="bar_chart" size={14} /> Loading poll…</div>;
  }
  if (poll === null) {
    return <div className="w-60 px-4 py-3 text-xs text-text-muted">Poll unavailable</div>;
  }

  const tap = async (idx) => {
    if (busy || !me) return;
    setBusy(true);
    try {
      if (poll.multi) {
        const next = myPicks.includes(idx) ? myPicks.filter((i) => i !== idx) : [...myPicks, idx];
        if (next.length === 0) await retractChatPollVote(pollId);
        else await voteChatPoll(pollId, next);
      } else {
        if (myPicks.includes(idx)) await retractChatPollVote(pollId);
        else await voteChatPoll(pollId, [idx]);
      }
    } catch {}
    setBusy(false);
  };

  const maxCount = Math.max(1, ...counts);

  return (
    <div className="w-64 px-3.5 pt-3 pb-2">
      <div className="flex items-start gap-2 mb-2.5">
        <Icon name="bar_chart" size={16}
          className={isMe ? 'text-white/70' : ''}
          style={isMe ? undefined : { color: 'var(--vg-chat-accent, #B44FFF)' }} />
        <div className="min-w-0">
          <p className="text-[14px] font-bold leading-snug break-words">{poll.question}</p>
          <p className={`text-[10px] mt-0.5 ${isMe ? 'text-white/50' : 'text-text-muted'}`}>
            {poll.multi ? 'Multiple answers' : 'One answer'} · {total} vote{total === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      <div className="space-y-1.5">
        {poll.options.map((opt, idx) => {
          const n = counts[idx] || 0;
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          const mine = myPicks.includes(idx);
          const lead = n > 0 && n === maxCount;
          return (
            <button key={idx} onClick={() => tap(idx)} disabled={busy}
              className="relative w-full text-left rounded-xl overflow-hidden border transition-colors"
              style={{
                borderColor: mine ? 'var(--vg-chat-accent-70, rgba(180,79,255,0.7))' : 'rgba(255,255,255,0.12)',
                background: 'rgba(0,0,0,0.20)',
              }}>
              {/* Animated result fill */}
              <span className="absolute inset-y-0 left-0 transition-all duration-500 ease-out"
                style={{
                  width: `${total > 0 ? pct : 0}%`,
                  background: mine
                    ? 'var(--vg-chat-accent-45, rgba(123,31,255,0.45))'
                    : lead ? 'var(--vg-chat-accent-28, rgba(123,31,255,0.28))' : 'rgba(255,255,255,0.10)',
                }} />
              <span className="relative flex items-center gap-2 px-3 py-2">
                <Icon name={mine ? 'check_circle' : 'radio_button_unchecked'} size={15}
                  className={mine ? '' : (isMe ? 'text-white/40' : 'text-text-muted/60')}
                  style={mine ? { color: 'var(--vg-chat-accent, #B44FFF)' } : undefined} filled={mine} />
                <span className="flex-1 text-[13px] font-medium break-words">{opt}</span>
                {total > 0 && <span className="text-[11px] font-bold tabular-nums opacity-80">{pct}%</span>}
              </span>
            </button>
          );
        })}
      </div>
      {total === 0 && (
        <p className={`text-[10px] mt-1.5 ${isMe ? 'text-white/40' : 'text-text-muted/70'}`}>Tap an option to vote</p>
      )}
    </div>
  );
}
