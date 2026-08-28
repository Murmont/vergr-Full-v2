// CoStreamingScreen — host pre-creates a co-stream session, invites up to 3
// publishers, then routes to /broadcast/:streamId?cohost=1 when ready.
//
// Flow:
//   1. Host hits "Create Co-Stream" → createStreamSession({ kind: 'co_stream', mode: 'browser' })
//   2. Search users + tap to invite (inviteToCoStream callable). Up to 3 invites.
//   3. Invitees get a notification → /co-stream/invite/<id> → accept → coHostUids[] grows.
//   4. Host watches the invite list update live; clicks "Start" when ready.
//   5. Both host + accepted co-hosts converge on /broadcast/<streamId>?cohost=1
//      where CoHostStage joins the SFU `ingest_<streamId>` room.

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  doc, onSnapshot, collection, query, where, orderBy,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { searchUsers } from '../../firebase/firestore';
import TopBar from '../../components/TopBar';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import UserName from '../../components/UserName';

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
  divider: 'rgba(255,255,255,0.06)',
};

const MAX_COHOSTS = 3;

export default function CoStreamingScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isDesktop } = useResponsive();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  // ── Stream provisioning ──────────────────────────────────────
  const [title, setTitle] = useState('');
  const [stream, setStream] = useState(null);
  const [creating, setCreating] = useState(false);

  // ── Search + invite state ────────────────────────────────────
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [invites, setInvites] = useState([]); // live from co_stream_invites
  const [busyUid, setBusyUid] = useState(null);

  // ── 1) Create co-stream session on demand ────────────────────
  const createSession = async () => {
    if (creating || stream) return;
    if (!title.trim()) {
      showToast('Give your co-stream a title first.', 'error');
      return;
    }
    setCreating(true);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'createStreamSession');
      const { data } = await fn({
        kind: 'co_stream',
        mode: 'browser',
        title: title.trim(),
        boost: null,
      });
      setStream(data);
    } catch (err) {
      showToast(err?.message || 'Could not create co-stream.', 'error');
    } finally {
      setCreating(false);
    }
  };

  // ── 2) Subscribe to invites once we have a streamId ──────────
  useEffect(() => {
    if (!stream?.streamId) return;
    const q = query(
      collection(db, 'co_stream_invites'),
      where('streamId', '==', stream.streamId),
      orderBy('createdAt', 'desc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setInvites(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (err) => console.warn('invites subscribe error:', err));
    return unsub;
  }, [stream?.streamId]);

  // ── 3) Subscribe to streams/{id} for coHostUids[] live update ─
  const [coHostUids, setCoHostUids] = useState([]);
  useEffect(() => {
    if (!stream?.streamId) return;
    const unsub = onSnapshot(doc(db, 'streams', stream.streamId), (snap) => {
      if (!snap.exists()) return;
      setCoHostUids(snap.data().coHostUids || []);
    });
    return unsub;
  }, [stream?.streamId]);

  // ── 4) User search ───────────────────────────────────────────
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

  // ── 5) Invite + cancel + start ───────────────────────────────
  const sendInvite = async (user) => {
    if (!stream?.streamId) return;
    setBusyUid(user.id);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'inviteToCoStream');
      await fn({ streamId: stream.streamId, inviteeUid: user.id });
      showToast(`Invite sent to @${user.username || user.id}`, 'success');
      setResults([]);
      setSearch('');
    } catch (err) {
      showToast(err?.message || 'Invite failed', 'error');
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
      showToast(err?.message || 'Cancel failed', 'error');
    } finally {
      setBusyUid(null);
    }
  };

  const removeCoHost = async (uid) => {
    if (!stream?.streamId) return;
    setBusyUid(uid);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'removeCoHost');
      await fn({ streamId: stream.streamId, removeUid: uid });
    } catch (err) {
      showToast(err?.message || 'Remove failed', 'error');
    } finally {
      setBusyUid(null);
    }
  };

  const goLive = () => {
    if (!stream?.streamId) return;
    navigate(`/broadcast/${stream.streamId}?cohost=1`);
  };

  // ── Derived ─────────────────────────────────────────────────
  const pendingInvites = useMemo(() => invites.filter((i) => i.status === 'pending'), [invites]);
  const acceptedInvites = useMemo(() => invites.filter((i) => i.status === 'accepted'), [invites]);
  const inviteCount = pendingInvites.length + coHostUids.length;
  const canInviteMore = inviteCount < MAX_COHOSTS;

  return (
    <div style={{
      background: C.bg, minHeight: '100%', color: C.text,
      fontFamily: '"Inter", "DM Sans", system-ui, sans-serif',
    }}>
      <TopBar title="Co-Stream Setup" showBack />

      <div style={{
        maxWidth: 720, margin: '0 auto', padding: '20px 16px 32px',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        {!stream ? (
          /* ── Stage 1: name + create ─────────────────────── */
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Start a co-stream</div>
            <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.5, marginBottom: 16 }}>
              Invite up to {MAX_COHOSTS} other creators. You'll all publish side-by-side; viewers see one composite stream. We'll provision a stream ID before you invite anyone.
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 140))}
              placeholder="Co-stream title…"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`,
                borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 14,
                outline: 'none', marginBottom: 14,
              }}
            />
            <button
              onClick={createSession}
              disabled={creating || !title.trim()}
              style={{
                width: '100%', padding: 12, borderRadius: 10, border: 'none',
                background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
                color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer',
                opacity: creating || !title.trim() ? 0.6 : 1,
              }}>
              {creating ? 'Creating…' : 'Create Co-Stream'}
            </button>
          </div>
        ) : (
          /* ── Stage 2: invite + manage ───────────────────── */
          <>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>{stream.title || title}</div>
                <span style={{
                  padding: '2px 8px', borderRadius: 99, background: C.purpleSoft,
                  color: C.purpleLight, fontSize: 10, fontWeight: 800, letterSpacing: '0.06em',
                }}>STAGED</span>
              </div>
              <div style={{ fontSize: 11, color: C.textDim, fontFamily: 'DM Mono, monospace' }}>
                {stream.streamId}
              </div>
            </div>

            {/* Accepted co-hosts (live publishers-to-be) */}
            {coHostUids.length > 0 && (
              <Section title={`Co-hosts (${coHostUids.length}/${MAX_COHOSTS})`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {coHostUids.map((uid) => (
                    <CoHostRow
                      key={uid}
                      uid={uid}
                      onRemove={() => removeCoHost(uid)}
                      busy={busyUid === uid}
                    />
                  ))}
                </div>
              </Section>
            )}

            {/* Pending invites */}
            {pendingInvites.length > 0 && (
              <Section title={`Pending (${pendingInvites.length})`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {pendingInvites.map((inv) => (
                    <InviteRow
                      key={inv.id}
                      invite={inv}
                      onCancel={() => cancelInvite(inv.id)}
                      busy={busyUid === inv.id}
                    />
                  ))}
                </div>
              </Section>
            )}

            {acceptedInvites.length > 0 && coHostUids.length === 0 && (
              <Section title="Recent">
                <div style={{ fontSize: 12, color: C.textDim }}>
                  {acceptedInvites.length} invitation{acceptedInvites.length === 1 ? '' : 's'} accepted.
                </div>
              </Section>
            )}

            {/* Search + invite */}
            <Section title="Invite a creator">
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
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`,
                      borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 13,
                      outline: 'none', marginBottom: 10,
                    }}
                  />
                  {searching && <div style={{ fontSize: 11, color: C.textDim }}>Searching…</div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {results.map((u) => {
                      const alreadyInvited = invites.some((i) => i.inviteeUid === u.id && i.status === 'pending');
                      const alreadyCoHost = coHostUids.includes(u.id);
                      const disabled = alreadyInvited || alreadyCoHost || busyUid === u.id;
                      return (
                        <button key={u.id} onClick={() => sendInvite(u)} disabled={disabled}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 10px', borderRadius: 8,
                            background: 'rgba(255,255,255,0.03)',
                            border: `1px solid ${C.border}`, color: C.text,
                            cursor: disabled ? 'default' : 'pointer',
                            opacity: disabled ? 0.5 : 1, textAlign: 'left',
                          }}>
                          <UserAvatar src={u.avatar} size="sm" />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700 }}><UserName user={u} masked /></div>
                            <div style={{ fontSize: 11, color: C.textDim }}><UserName user={u} masked handle /></div>
                          </div>
                          <span style={{ fontSize: 11, color: alreadyCoHost ? C.green : alreadyInvited ? C.amber : C.purpleLight, fontWeight: 700 }}>
                            {alreadyCoHost ? 'Joined' : alreadyInvited ? 'Pending' : 'Invite'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </Section>

            {/* Start */}
            <button
              onClick={goLive}
              style={{
                width: '100%', padding: 14, borderRadius: 12, border: 'none',
                background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
                color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer',
                boxShadow: '0 0 16px rgba(124,58,237,0.4)',
              }}>
              Go to Broadcaster {coHostUids.length === 0 ? '(solo for now)' : `with ${coHostUids.length} co-host${coHostUids.length === 1 ? '' : 's'}`}
            </button>
            <div style={{ fontSize: 11, color: C.textMuted, textAlign: 'center' }}>
              You can keep inviting from the broadcaster screen if more creators accept later.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14 }}>
      <div style={{
        fontSize: 11, fontWeight: 800, color: C.text, marginBottom: 10,
        textTransform: 'uppercase', letterSpacing: '0.08em',
      }}>{title}</div>
      {children}
    </div>
  );
}

function CoHostRow({ uid, onRemove, busy }) {
  const [user, setUser] = useState(null);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
      if (snap.exists()) setUser({ id: snap.id, ...snap.data() });
    });
    return unsub;
  }, [uid]);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 10px', borderRadius: 8, background: C.cardSoft,
      border: `1px solid ${C.border}`,
    }}>
      <UserAvatar src={user?.avatar} size="sm" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}><UserName user={user} masked fallback={uid.slice(0, 6)} /></div>
        <div style={{ fontSize: 11, color: C.green }}>● Joined</div>
      </div>
      <button onClick={onRemove} disabled={busy}
        style={{
          padding: '6px 10px', borderRadius: 6, border: `1px solid ${C.red}`,
          background: 'transparent', color: C.red, fontSize: 11, fontWeight: 700,
          cursor: 'pointer', opacity: busy ? 0.5 : 1,
        }}>Remove</button>
    </div>
  );
}

function InviteRow({ invite, onCancel, busy }) {
  const [user, setUser] = useState(null);
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'users', invite.inviteeUid), (snap) => {
      if (snap.exists()) setUser({ id: snap.id, ...snap.data() });
    });
    return unsub;
  }, [invite.inviteeUid]);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 10px', borderRadius: 8, background: C.cardSoft,
      border: `1px solid ${C.border}`,
    }}>
      <UserAvatar src={user?.avatar} size="sm" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          <UserName user={user} masked fallback={invite.inviteeUid.slice(0, 6)} />
        </div>
        <div style={{ fontSize: 11, color: C.amber }}>● Pending</div>
      </div>
      <button onClick={onCancel} disabled={busy}
        style={{
          padding: '6px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
          background: 'transparent', color: C.textDim, fontSize: 11, fontWeight: 700,
          cursor: 'pointer', opacity: busy ? 0.5 : 1,
        }}>Cancel</button>
    </div>
  );
}
