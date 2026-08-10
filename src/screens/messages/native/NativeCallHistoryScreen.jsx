// NativeCallHistoryScreen — dedicated phone build of /messages/calls.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../../firebase/config';
import { getCallHistory } from '../../../firebase/firestore';
import { markCallsSeen } from '../../../utils/navBadges';
import { resolveChatUsers, chatDisplayName } from '../../../utils/chatIdentity';
import { useUser } from '../../../context/UserContext';
import TopBar from '../../../components/TopBar';
import UserAvatar from '../../../components/UserAvatar';
import Icon from '../../../components/Icon';
import { timeAgo } from '../../../utils/helpers';
import { ListSkeleton } from '../../../components/skeletons/GlassSkeletons';

const fmtDur = (s) => {
  if (!s) return '';
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
};

export default function NativeCallHistoryScreen() {
  const navigate = useNavigate();
  const { profile } = useUser();
  const me = auth.currentUser?.uid;
  const [rows, setRows] = useState(null);
  const [users, setUsers] = useState({});

  useEffect(() => {
    if (!me) return;
    let alive = true;
    markCallsSeen(); // opening the call log clears the missed-call nav badge
    getCallHistory(me).then(async (list) => {
      if (!alive) return;
      setRows(list);
      const otherIds = [...new Set(list.map(r => (r.participants || []).find(id => id !== me)).filter(Boolean))];
      if (otherIds.length) {
        const map = await resolveChatUsers(otherIds);
        if (alive) setUsers(map);
      }
    });
    return () => { alive = false; };
  }, [me]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-dark)', paddingBottom: 'calc(88px + env(safe-area-inset-bottom, 0px))' }}>
      <TopBar title="Calls" showBack />
      {rows === null ? (
        <ListSkeleton rows={6} />
      ) : rows.length === 0 ? (
        <div className="py-32 text-center px-10">
          <div className="w-20 h-20 bg-surface-1 rounded-full flex items-center justify-center mx-auto mb-6 border border-white/[0.04]">
            <Icon name="call" size={32} className="text-text-muted opacity-20" />
          </div>
          <h3 className="text-white font-bold mb-2">No calls yet</h3>
          <p className="text-text-muted text-xs leading-relaxed">Voice and video calls you make or receive will show up here.</p>
        </div>
      ) : (
        <div>
          {rows.map(r => {
            const otherId = (r.participants || []).find(id => id !== me);
            const u = users[otherId];
            const name = chatDisplayName(otherId, u, profile, 'Unknown');
            const outgoing = r.callerId === me;
            const missed = !r.answered;
            return (
              <button key={r.id}
                onClick={() => otherId && navigate(`/messages/${[me, otherId].sort().join('_')}`)}
                className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left border-b border-white/[0.04] active:bg-surface-1/40">
                <UserAvatar src={u?.avatar} size={46} />
                <div className="flex-1 min-w-0">
                  <h3 className={`font-bold text-[15px] truncate ${missed && !outgoing ? 'text-brand-ember' : 'text-text-primary'}`}>{name}</h3>
                  <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
                    <Icon name={outgoing ? 'call_made' : missed ? 'call_missed' : 'call_received'} size={14}
                      className={missed && !outgoing ? 'text-brand-ember' : outgoing ? 'text-brand-violet-light' : 'text-green-400'} />
                    <span>
                      {outgoing ? (missed ? 'No answer' : 'Outgoing') : (missed ? 'Missed' : 'Incoming')}
                      {r.answered && r.durationSec ? ` · ${fmtDur(r.durationSec)}` : ''}
                    </span>
                  </div>
                </div>
                <span className="text-[11px] text-text-muted shrink-0">{r.endedAt?.toDate ? timeAgo(r.endedAt.toDate()) : ''}</span>
                <Icon name={r.type === 'video' ? 'videocam' : 'call'} size={18} className="text-text-secondary shrink-0 ml-1" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
