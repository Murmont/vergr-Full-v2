// CoHostInviteModal — invite co-hosts WHILE LIVE from the broadcaster screen.
//
// TikTok Multi-Guest model: the host is already broadcasting; they open this to
// search + invite creators on the fly. Invitees accept via CoStreamInviteScreen;
// when they accept, coHostUids[] grows and CoHostStage pulls them into the SFU
// composite. This is the ONLY co-host entry point now (the pre-broadcast
// GoLiveSetupScreen no longer carries a co-stream button — you go live first).
//
// Reuses the same callables as CoStreamingScreen against the LIVE streamId:
//   inviteToCoStream / cancelCoHostInvite / removeCoHost.

import { useState, useEffect, useMemo } from 'react';
import {
  doc, onSnapshot, collection, query, where, orderBy,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { searchUsers } from '../../firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import UserAvatar from '../UserAvatar';
import Icon from '../Icon';
import UserName from '../UserName';

const C = {
  bg: '#0a0a14',
  card: '#12121e',
  cardSoft: '#0f0f1a',
  border: 'rgba(255,255,255,0.09)',
  text: '#e8e8f0',
  textDim: '#a0a0b8',
  textMuted: '#6b7280',
  purple: '#7c3aed',
  purpleLight: '#b44fff',
  purpleSoft: 'rgba(124,58,237,0.15)',
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
};

const MAX_COHOSTS = 3;

export default function CoHostInviteModal({ streamId, coHostUids = [], onClose, showToast }) {
  const { currentUser } = useAuth();

  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [invites, setInvites] = useState([]);
  const [busyUid, setBusyUid] = useState(null);

  // Live pending/accepted invites for this stream.
  useEffect(() => {
    if (!streamId) return;
    const q = query(
      collection(db, 'co_stream_invites'),
      where('streamId', '==', streamId),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setInvites(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (err) => console.warn('invites subscribe error:', err));
    return unsub;
  }, [streamId]);

  const handleSearch = async (term) => {
    setSearch(term);
    if (term.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const users = await searchUsers(term, 6);
      setResults((users || []).filter((u) => u.id !== currentUser?.uid));
    } catch (err) {
      console.warn('search failed:', err);
    } finally {
      setSearching(false);
    }
  };

  const sendInvite = async (user) => {
    if (!streamId) return;
    setBusyUid(user.id);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'inviteToCoStream');
      await fn({ streamId, inviteeUid: user.id });
      showToast?.(`Invite sent to @${user.username || user.id}`, 'success');
      setResults([]);
      setSearch('');
    } catch (err) {
      showToast?.(err?.message || 'Invite failed', 'error');
    } finally {
      setBusyUid(null);
    }
  };

  const cancelInvite = async (inviteId) => {
    setBusyUid(inviteId);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'cancelCoHostInvite');
      await fn({ inviteId });
    } catch (err) {
      showToast?.(err?.message || 'Cancel failed', 'error');
    } finally {
      setBusyUid(null);
    }
  };

  const removeCoHost = async (uid) => {
    if (!streamId) return;
    setBusyUid(uid);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'removeCoHost');
      await fn({ streamId, removeUid: uid });
    } catch (err) {
      showToast?.(err?.message || 'Remove failed', 'error');
    } finally {
      setBusyUid(null);
    }
  };

  const pendingInvites = useMemo(() => invites.filter((i) => i.status === 'pending'), [invites]);
  const inviteCount = pendingInvites.length + coHostUids.length;
  const canInviteMore = inviteCount < MAX_COHOSTS;

  return (
    <AnimatePresence>
      <motion.div
        key="cohost-invite-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 120,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}>
        <motion.div
          key="cohost-invite-sheet"
          initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 38 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 520, maxHeight: '82vh', overflowY: 'auto',
            background: C.bg, border: `1px solid ${C.border}`,
            borderRadius: '16px 16px 0 0', padding: 18,
            paddingBottom: 'calc(18px + var(--vg-safe-b))',
            display: 'flex', flexDirection: 'column', gap: 14,
            color: C.text, fontFamily: '"DM Sans", system-ui, sans-serif',
          }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>Invite a co-host</div>
              <div style={{ fontSize: 12, color: C.textDim }}>
                You're live. Invited creators join your composite when they accept.
              </div>
            </div>
            <button onClick={onClose} style={{
              width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`,
              background: 'transparent', color: C.textDim, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Icon name="close" size={18} /></button>
          </div>

          {/* Current co-hosts */}
          {coHostUids.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Label>Co-hosts ({coHostUids.length}/{MAX_COHOSTS})</Label>
              {coHostUids.map((uid) => (
                <PersonRow key={uid} uid={uid} status="joined"
                  busy={busyUid === uid} onAction={() => removeCoHost(uid)} actionLabel="Remove" />
              ))}
            </div>
          )}

          {/* Pending invites */}
          {pendingInvites.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Label>Pending ({pendingInvites.length})</Label>
              {pendingInvites.map((inv) => (
                <PersonRow key={inv.id} uid={inv.inviteeUid} status="pending"
                  busy={busyUid === inv.id} onAction={() => cancelInvite(inv.id)} actionLabel="Cancel" />
              ))}
            </div>
          )}

          {/* Search + invite */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Label>Add a creator</Label>
            {!canInviteMore ? (
              <div style={{ fontSize: 12, color: C.textDim }}>
                Co-host limit reached ({MAX_COHOSTS}). Remove someone to invite another.
              </div>
            ) : (
              <>
                <input
                  value={search}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search by username or display name…"
                  autoFocus
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`,
                    borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 13, outline: 'none',
                  }}
                />
                {searching && <div style={{ fontSize: 11, color: C.textDim }}>Searching…</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {results.map((u) => {
                    const alreadyInvited = invites.some((i) => i.inviteeUid === u.id && i.status === 'pending');
                    const alreadyCoHost = coHostUids.includes(u.id);
                    const disabled = alreadyInvited || alreadyCoHost || busyUid === u.id;
                    return (
                      <button key={u.id} onClick={() => sendInvite(u)} disabled={disabled} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                        borderRadius: 8, background: 'rgba(255,255,255,0.03)',
                        border: `1px solid ${C.border}`, color: C.text,
                        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, textAlign: 'left',
                      }}>
                        <UserAvatar src={u.avatar} size="sm" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}><UserName user={u} masked /></div>
                          <div style={{ fontSize: 11, color: C.textDim }}><UserName user={u} masked handle /></div>
                        </div>
                        <span style={{
                          fontSize: 11, fontWeight: 700,
                          color: alreadyCoHost ? C.green : alreadyInvited ? C.amber : C.purpleLight,
                        }}>
                          {alreadyCoHost ? 'Joined' : alreadyInvited ? 'Pending' : 'Invite'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function Label({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 800, color: C.text,
      textTransform: 'uppercase', letterSpacing: '0.08em',
    }}>{children}</div>
  );
}

function PersonRow({ uid, status, busy, onAction, actionLabel }) {
  const [user, setUser] = useState(null);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
      if (snap.exists()) setUser({ id: snap.id, ...snap.data() });
    });
    return unsub;
  }, [uid]);
  const dotColor = status === 'joined' ? C.green : C.amber;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
      borderRadius: 8, background: C.cardSoft, border: `1px solid ${C.border}`,
    }}>
      <UserAvatar src={user?.avatar} size="sm" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}><UserName user={user} masked fallback={uid.slice(0, 6)} /></div>
        <div style={{ fontSize: 11, color: dotColor }}>● {status === 'joined' ? 'Joined' : 'Pending'}</div>
      </div>
      <button onClick={onAction} disabled={busy} style={{
        padding: '6px 10px', borderRadius: 6,
        border: `1px solid ${status === 'joined' ? C.red : C.border}`,
        background: 'transparent', color: status === 'joined' ? C.red : C.textDim,
        fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.5 : 1,
      }}>{actionLabel}</button>
    </div>
  );
}
