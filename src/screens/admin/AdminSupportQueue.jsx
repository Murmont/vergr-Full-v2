// The support agent's queue: the list of people waiting, and the thread you
// answer them in.
//
// Deliberately shaped like a message list rather than a table, because that is
// what it is. Left column = who is waiting, sorted so the unanswered are on top.
// Right column = the conversation.
//
// The thread itself is NOT re-implemented here. A support thread is a real group
// conversation (see functions/supportChannel.js), so the agent opens it in the
// app's own chat screen, which already has the relay connection, history, media,
// read state and moderation. This screen is the queue and the triage controls.

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import { ADMIN_COLORS as C } from './AdminShell';
import { call, fmtRelative, useGuardedCall } from './_adminGuarded';

const STATES = [
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Closed' },
  { id: 'all', label: 'All' },
];

export default function AdminSupportQueue({ channelId = null, myUid = null }) {
  const { showToast } = useUI();
  const navigate = useNavigate();
  const guarded = useGuardedCall();
  const [state, setState] = useState('open');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminListSupportThreads', { channelId, state, pageSize: 60 });
      setRows(r.rows || []);
      // Keep the open thread selected across a refresh so claiming or closing
      // does not throw the agent back to the top of the list.
      setSelected((prev) => (prev ? (r.rows || []).find((x) => x.convoId === prev.convoId) || null : null));
    } catch (e) {
      showToast(e?.message || 'Could not load support threads', 'error');
    }
    setLoading(false);
  }, [channelId, state]);

  useEffect(() => { load(); }, [load]);

  const act = async (row, action) => {
    try {
      await guarded(() => call('adminSetSupportThreadState', { convoId: row.convoId, action }));
      load();
    } catch { /* guarded surfaces it */ }
  };

  const waiting = rows.filter((r) => r.waiting).length;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 340px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
      {/* QUEUE */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, flex: 1 }}>
            Inbox
            {waiting > 0 && (
              <span style={{
                marginLeft: 8, padding: '2px 8px', borderRadius: 999, fontSize: 11,
                background: '#f0a50022', color: '#f5c542', fontWeight: 800,
              }}>{waiting} waiting</span>
            )}
          </div>
          <button onClick={load} style={{ background: 'transparent', border: 0, color: C.textDim, cursor: 'pointer' }} title="Refresh">
            <Icon name="refresh" size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}>
          {STATES.map((s) => (
            <button key={s.id} onClick={() => setState(s.id)}
              style={{
                padding: '5px 12px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                background: state === s.id ? `${C.accent}28` : 'transparent',
                border: `1px solid ${state === s.id ? C.accent : C.border}`,
                color: state === s.id ? C.text : C.textDim,
              }}>
              {s.label}
            </button>
          ))}
        </div>

        <div style={{ maxHeight: 560, overflowY: 'auto' }}>
          {loading && <div style={{ padding: 18, fontSize: 12, color: C.textDim }}>Loading…</div>}
          {!loading && rows.length === 0 && (
            <div style={{ padding: 18, fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>
              {state === 'open'
                ? 'Nobody is waiting. When a user messages this channel their thread appears here.'
                : 'Nothing here.'}
            </div>
          )}
          {rows.map((r) => {
            const active = selected?.convoId === r.convoId;
            return (
              <button key={r.convoId} onClick={() => setSelected(r)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '11px 13px',
                  background: active ? `${C.accent}14` : 'transparent',
                  borderLeft: `2px solid ${active ? C.accent : 'transparent'}`,
                  borderTop: 0, borderRight: 0, borderBottom: `1px solid ${C.border}`,
                  cursor: 'pointer', textAlign: 'left',
                }}>
                <div style={{ position: 'relative', flexShrink: 0, display: 'flex' }}>
                  <UserAvatar src={r.user?.avatar} size={36} />
                  {/* zIndex 20: UserAvatar's img is `relative z-10` and paints
                      over any overlay left at z-auto. */}
                  {r.waiting && (
                    <span style={{
                      position: 'absolute', bottom: 0, right: 0, zIndex: 20,
                      width: 12, height: 12, borderRadius: '50%', background: '#f5c542',
                      border: '2px solid #12121e',
                    }} />
                  )}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.user?.displayName || 'User'}
                  </div>
                  <div style={{ fontSize: 11, color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.lastMessageText || 'No messages yet'}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 10, color: C.textDim }}>{fmtRelative(r.lastMessageAt)}</div>
                  {r.claimedBy && (
                    <div style={{ fontSize: 9.5, color: r.claimedBy === myUid ? C.accent : C.textDim, marginTop: 3, fontWeight: 700 }}>
                      {r.claimedBy === myUid ? 'YOURS' : 'TAKEN'}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* THREAD */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, minHeight: 300 }}>
        {!selected && (
          <div style={{ color: C.textDim, fontSize: 12.5, lineHeight: 1.7 }}>
            Pick someone on the left to read and answer their thread.
            <div style={{ marginTop: 10, fontSize: 11.5 }}>
              A gold dot means they spoke last and are still waiting on you.
              Claiming a thread tells other agents you have it; it does not lock
              them out.
            </div>
          </div>
        )}
        {selected && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <UserAvatar src={selected.user?.avatar} size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                  {selected.user?.displayName || 'User'}
                </div>
                <div style={{ fontSize: 11, color: C.textDim }}>
                  {selected.user?.username ? `@${selected.user.username} · ` : ''}
                  {selected.state === 'closed' ? 'Closed' : (selected.waiting ? 'Waiting for a reply' : 'Answered')}
                </div>
              </div>
              <button onClick={() => navigate(`/profile/${selected.userId}`)} style={btn(C.border)}>
                View profile
              </button>
            </div>

            <div style={{
              padding: 12, borderRadius: 8, background: '#0a0a14', border: `1px solid ${C.border}`,
              fontSize: 12, color: C.textDim, lineHeight: 1.6, marginBottom: 14,
            }}>
              <div style={{ color: C.text, fontWeight: 700, marginBottom: 4 }}>Last message</div>
              {selected.lastMessageText || 'Nothing said yet.'}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => navigate(`/messages/${selected.convoId}`)}
                style={{ ...btn(C.accent), padding: '10px 16px', fontSize: 13 }}>
                Open and reply
              </button>
              {selected.claimedBy === myUid
                ? <button onClick={() => act(selected, 'release')} style={btn(C.border)}>Release</button>
                : <button onClick={() => act(selected, 'claim')} style={btn(C.border)}>
                    {selected.claimedBy ? 'Take over' : 'Claim'}
                  </button>}
              {selected.state === 'closed'
                ? <button onClick={() => act(selected, 'reopen')} style={btn(C.border)}>Reopen</button>
                : <button onClick={() => act(selected, 'close')} style={btn('#22C55E')}>Mark resolved</button>}
            </div>

            <div style={{ marginTop: 12, fontSize: 11, color: C.textDim, lineHeight: 1.6 }}>
              Replies show to the user as the channel, not as you. Your account is
              recorded on the thread so it is always clear internally who answered.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const btn = (color) => ({
  padding: '8px 14px', borderRadius: 7, border: `1px solid ${color}`,
  background: `${color}22`, color: color === C.border ? C.textDim : color,
  fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
});
