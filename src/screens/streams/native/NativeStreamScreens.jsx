// NATIVE-APP streaming screens (Android/iOS Tauri shell ONLY).
//
// Dedicated mobile-FIRST native variants of the lighter streaming screens.
// Routed in AppRouter as `IS_NATIVE_BUILD ? <Native*> : <existing>` — they NEVER
// render on web/mobile-web (the build flag dead-code-eliminates them from the
// web bundle). The existing src/screens/streams/* screens are left untouched and
// keep serving desktop + mobile web.
//
// Layout rule: no width media queries / useResponsive — intrinsic phone layouts
// (full-width stacks, fixed 2-up grids, sticky CTAs, bottom-sheet actions, big
// tap targets). Top bars get the safe-area inset + breathing room.
//
// In this file:
//   NativeCoStreamingScreen      /go-live/co-stream
//   NativeCoStreamInviteScreen   /co-stream/invite/:inviteId
//   NativeStreamEndingScreen     /stream/ended
//   NativeStreamAnalyticsScreen  /stream/analytics

import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { doc, onSnapshot, collection, query, where, orderBy } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../../firebase/config';
import { useAuth } from '../../../context/AuthContext';
import { useUI } from '../../../context/UIContext';
import { searchUsers } from '../../../firebase/firestore';
import UserAvatar from '../../../components/UserAvatar';
import Icon from '../../../components/Icon';

const C = {
  bg: '#0a0a14',
  card: '#12121e',
  cardSoft: '#0f0f1a',
  border: 'rgba(255,255,255,0.09)',
  text: '#e8e8f0',
  textDim: '#a0a0b8',
  textMuted: '#6b7280',
  purple: '#7B1FFF',
  purpleLight: '#b44fff',
  purpleSoft: 'rgba(123,31,255,0.15)',
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  divider: 'rgba(255,255,255,0.06)',
};

const MAX_COHOSTS = 3;
const fn = (name) => httpsCallable(getFunctions(undefined, 'europe-west1'), name);

// ───────────────────────────────────────────── shared native chrome
// Sticky top bar with the founder safe-area + breathing-room rule. Single
// concise title line, back chevron conveys hierarchy.
function NativeHeader({ title, onBack, right }) {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 30,
      display: 'flex', alignItems: 'center', gap: 8,
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)',
      paddingLeft: 12, paddingRight: 12, paddingBottom: 10,
      background: 'rgba(10,10,20,0.86)', backdropFilter: 'blur(12px)',
      borderBottom: `1px solid ${C.divider}`,
    }}>
      <button type="button" onClick={onBack} aria-label="Back" style={{
        width: 38, height: 38, borderRadius: 12, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`,
        color: C.text, cursor: 'pointer',
      }}>
        <Icon name="arrow_back_ios_new" size={18} />
      </button>
      <div style={{ flex: 1, minWidth: 0, fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 18, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'clip' }}>
        {title}
      </div>
      {right}
    </div>
  );
}

const Shell = ({ title, onBack, right, children }) => (
  <div style={{ background: C.bg, minHeight: '100%', color: C.text, fontFamily: '"Inter","DM Sans",system-ui,sans-serif' }}>
    <NativeHeader title={title} onBack={onBack} right={right} />
    <div style={{ padding: '16px 14px calc(env(safe-area-inset-bottom, 0px) + 24px)', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {children}
    </div>
  </div>
);

// ═══════════════════════════════════════════════ CO-STREAM SETUP

export function NativeCoStreamingScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useUI();

  const [title, setTitle] = useState('');
  const [stream, setStream] = useState(null);
  const [creating, setCreating] = useState(false);

  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [invites, setInvites] = useState([]);
  const [coHostUids, setCoHostUids] = useState([]);
  const [busyUid, setBusyUid] = useState(null);

  const createSession = async () => {
    if (creating || stream) return;
    if (!title.trim()) { showToast('Give your co-stream a title first.', 'error'); return; }
    setCreating(true);
    try {
      const { data } = await fn('createStreamSession')({ kind: 'co_stream', mode: 'browser', title: title.trim(), boost: null });
      setStream(data);
    } catch (err) {
      showToast(err?.message || 'Could not create co-stream.', 'error');
    } finally { setCreating(false); }
  };

  useEffect(() => {
    if (!stream?.streamId) return;
    const q = query(collection(db, 'co_stream_invites'), where('streamId', '==', stream.streamId), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => setInvites(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => console.warn('invites sub:', e));
  }, [stream?.streamId]);

  useEffect(() => {
    if (!stream?.streamId) return;
    return onSnapshot(doc(db, 'streams', stream.streamId), (snap) => {
      if (snap.exists()) setCoHostUids(snap.data().coHostUids || []);
    });
  }, [stream?.streamId]);

  const handleSearch = async (term) => {
    setSearch(term);
    if (term.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const users = await searchUsers(term, 6);
      setResults((users || []).filter((u) => u.id !== currentUser?.uid));
    } catch (e) { console.warn('search failed:', e); } finally { setSearching(false); }
  };

  const sendInvite = async (user) => {
    if (!stream?.streamId) return;
    setBusyUid(user.id);
    try {
      await fn('inviteToCoStream')({ streamId: stream.streamId, inviteeUid: user.id });
      showToast(`Invite sent to @${user.username || user.id}`, 'success');
      setResults([]); setSearch('');
    } catch (err) { showToast(err?.message || 'Invite failed', 'error'); } finally { setBusyUid(null); }
  };

  const cancelInvite = async (inviteId) => {
    setBusyUid(inviteId);
    try { await fn('cancelCoHostInvite')({ inviteId }); }
    catch (err) { showToast(err?.message || 'Cancel failed', 'error'); }
    finally { setBusyUid(null); }
  };

  const removeCoHost = async (uid) => {
    if (!stream?.streamId) return;
    setBusyUid(uid);
    try { await fn('removeCoHost')({ streamId: stream.streamId, removeUid: uid }); }
    catch (err) { showToast(err?.message || 'Remove failed', 'error'); }
    finally { setBusyUid(null); }
  };

  const pendingInvites = useMemo(() => invites.filter((i) => i.status === 'pending'), [invites]);
  const inviteCount = pendingInvites.length + coHostUids.length;
  const canInviteMore = inviteCount < MAX_COHOSTS;

  return (
    <Shell title="Co-Stream" onBack={() => navigate(-1)}>
      {!stream ? (
        <div style={card}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Start a co-stream</div>
          <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.5, marginBottom: 16 }}>
            Invite up to {MAX_COHOSTS} creators. You each publish side-by-side; viewers see one composite. We provision a stream ID before you invite.
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 140))}
            placeholder="Co-stream title…"
            style={input}
          />
          <button onClick={createSession} disabled={creating || !title.trim()} style={{ ...cta, marginTop: 14, opacity: creating || !title.trim() ? 0.6 : 1 }}>
            {creating ? 'Creating…' : 'Create Co-Stream'}
          </button>
        </div>
      ) : (
        <>
          <div style={{ ...card, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 800, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stream.title || title}</div>
              <span style={{ padding: '3px 9px', borderRadius: 99, background: C.purpleSoft, color: C.purpleLight, fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', flexShrink: 0 }}>STAGED</span>
            </div>
            <div style={{ fontSize: 11, color: C.textDim, fontFamily: 'DM Mono, monospace' }}>{stream.streamId}</div>
          </div>

          {coHostUids.length > 0 && (
            <Section title={`Co-hosts (${coHostUids.length}/${MAX_COHOSTS})`}>
              {coHostUids.map((uid) => <PersonRow key={uid} uid={uid} statusText="Joined" statusColor={C.green} actionLabel="Remove" actionColor={C.red} onAction={() => removeCoHost(uid)} busy={busyUid === uid} />)}
            </Section>
          )}

          {pendingInvites.length > 0 && (
            <Section title={`Pending (${pendingInvites.length})`}>
              {pendingInvites.map((inv) => <PersonRow key={inv.id} uid={inv.inviteeUid} statusText="Pending" statusColor={C.amber} actionLabel="Cancel" actionColor={C.textDim} onAction={() => cancelInvite(inv.id)} busy={busyUid === inv.id} />)}
            </Section>
          )}

          <Section title="Invite a creator">
            {!canInviteMore ? (
              <div style={{ fontSize: 13, color: C.textDim }}>Co-host limit reached ({MAX_COHOSTS}). Remove someone to invite another.</div>
            ) : (
              <>
                <input value={search} onChange={(e) => handleSearch(e.target.value)} placeholder="Search username or name…" style={input} />
                {searching && <div style={{ fontSize: 12, color: C.textDim, marginTop: 8 }}>Searching…</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                  {results.map((u) => {
                    const alreadyInvited = invites.some((i) => i.inviteeUid === u.id && i.status === 'pending');
                    const alreadyCoHost = coHostUids.includes(u.id);
                    const disabled = alreadyInvited || alreadyCoHost || busyUid === u.id;
                    return (
                      <button key={u.id} onClick={() => sendInvite(u)} disabled={disabled} style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12,
                        background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, color: C.text,
                        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, textAlign: 'left', width: '100%',
                      }}>
                        <UserAvatar src={u.avatar} size="sm" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.displayName || u.username}</div>
                          <div style={{ fontSize: 12, color: C.textDim }}>@{u.username}</div>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 800, color: alreadyCoHost ? C.green : alreadyInvited ? C.amber : C.purpleLight }}>
                          {alreadyCoHost ? 'Joined' : alreadyInvited ? 'Pending' : 'Invite'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </Section>
        </>
      )}

      {stream && (
        <div style={{ position: 'sticky', bottom: 0, paddingTop: 10, paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 4px)', background: 'linear-gradient(to top, rgba(10,10,20,1) 60%, rgba(10,10,20,0))' }}>
          <button onClick={() => navigate(`/broadcast/${stream.streamId}?cohost=1`)} style={{ ...cta, boxShadow: '0 0 18px rgba(123,31,255,0.45)' }}>
            Go to Broadcaster {coHostUids.length === 0 ? '(solo for now)' : `· ${coHostUids.length} co-host${coHostUids.length === 1 ? '' : 's'}`}
          </button>
          <div style={{ fontSize: 11, color: C.textMuted, textAlign: 'center', marginTop: 8 }}>
            You can keep inviting from the broadcaster screen.
          </div>
        </div>
      )}
    </Shell>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ ...card, padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: C.text, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  );
}

function PersonRow({ uid, statusText, statusColor, actionLabel, actionColor, onAction, busy }) {
  const [user, setUser] = useState(null);
  useEffect(() => onSnapshot(doc(db, 'users', uid), (snap) => { if (snap.exists()) setUser({ id: snap.id, ...snap.data() }); }), [uid]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, background: C.cardSoft, border: `1px solid ${C.border}` }}>
      <UserAvatar src={user?.avatar} size="sm" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.displayName || user?.username || uid.slice(0, 6)}</div>
        <div style={{ fontSize: 12, color: statusColor }}>● {statusText}</div>
      </div>
      <button onClick={onAction} disabled={busy} style={{
        padding: '8px 14px', borderRadius: 10, border: `1px solid ${actionColor === C.red ? C.red : C.border}`,
        background: 'transparent', color: actionColor, fontSize: 12, fontWeight: 800, cursor: 'pointer', opacity: busy ? 0.5 : 1,
      }}>{actionLabel}</button>
    </div>
  );
}

// ═══════════════════════════════════════════════ CO-STREAM INVITE

export function NativeCoStreamInviteScreen() {
  const { inviteId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useUI();

  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(null);

  useEffect(() => {
    if (!inviteId) return;
    return onSnapshot(doc(db, 'co_stream_invites', inviteId), (snap) => {
      setLoading(false);
      setInvite(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    }, () => setLoading(false));
  }, [inviteId]);

  const accept = async () => {
    if (working) return;
    setWorking('accept');
    try {
      const { data } = await fn('acceptCoHostInvite')({ inviteId });
      showToast("You're in. Joining co-stream…", 'success');
      navigate(`/broadcast/${data.streamId}?cohost=1`);
    } catch (err) { showToast(err?.message || 'Could not accept', 'error'); } finally { setWorking(null); }
  };

  const decline = async () => {
    if (working) return;
    setWorking('decline');
    try {
      await fn('declineCoHostInvite')({ inviteId });
      showToast('Invitation declined.', 'info');
      navigate('/');
    } catch (err) { showToast(err?.message || 'Could not decline', 'error'); } finally { setWorking(null); }
  };

  const notice = (msg) => (
    <Shell title="Co-Stream Invite" onBack={() => navigate(-1)}>
      <div style={{ ...card, textAlign: 'center', color: C.textDim, padding: 28 }}>{msg}</div>
    </Shell>
  );

  if (loading) return notice('Loading…');
  if (!invite) return notice('Invitation not found.');
  if (invite.inviteeUid !== currentUser?.uid) return notice("This invitation isn't for you.");
  if (invite.status !== 'pending') return notice(`Already ${invite.status}.`);

  return (
    <Shell title="Co-Stream Invite" onBack={() => navigate(-1)}>
      <div style={{ ...card, padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
          <UserAvatar src={invite.hostAvatar} size="lg" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: C.textDim }}>Co-stream invite from</div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{invite.hostName || 'A creator'}</div>
          </div>
        </div>
        <div style={{ fontSize: 15, color: C.text, marginBottom: 8, fontWeight: 700 }}>{invite.streamTitle || 'Untitled stream'}</div>
        <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.5 }}>
          Accepting joins you as a co-host publisher. Your camera + mic go live alongside the host's, and viewers see the composite. You can leave at any time.
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, display: 'flex', gap: 10, paddingTop: 10, paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 4px)', background: 'linear-gradient(to top, rgba(10,10,20,1) 60%, rgba(10,10,20,0))' }}>
        <button onClick={decline} disabled={!!working} style={{ flex: 1, padding: 15, borderRadius: 14, border: `1px solid ${C.border}`, background: 'transparent', color: C.textDim, fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: working ? 0.6 : 1 }}>
          {working === 'decline' ? 'Declining…' : 'Decline'}
        </button>
        <button onClick={accept} disabled={!!working} style={{ flex: 2, padding: 15, borderRadius: 14, border: 'none', background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`, color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', opacity: working ? 0.6 : 1 }}>
          {working === 'accept' ? 'Joining…' : 'Accept & Join'}
        </button>
      </div>
    </Shell>
  );
}

// ═══════════════════════════════════════════════ STREAM ENDED

export function NativeStreamEndingScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const s = location.state || {};
  const stats = [
    { label: 'Duration', value: s.duration || '0m', icon: 'schedule' },
    { label: 'Peak viewers', value: s.peakViewers || '0', icon: 'visibility' },
    { label: 'New followers', value: s.newFollowers || '0', icon: 'person_add' },
    { label: 'Tips earned', value: `● ${s.tips || 0}`, icon: 'paid' },
  ];
  return (
    <div style={{ background: C.bg, minHeight: '100%', color: C.text, display: 'flex', flexDirection: 'column', fontFamily: '"Inter","DM Sans",system-ui,sans-serif' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 18px', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)' }}>
        <div style={{ width: 84, height: 84, borderRadius: '50%', background: 'rgba(180,79,255,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 22 }}>
          <Icon name="live_tv" size={42} className="text-brand-violet-light" />
        </div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 26, fontWeight: 800, marginBottom: 6 }}>Stream ended</h1>
        <p style={{ color: C.textDim, fontSize: 14, marginBottom: 26, textAlign: 'center' }}>Great stream! Here's your summary.</p>

        <div style={{ width: '100%', maxWidth: 420, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          {stats.map((st) => (
            <div key={st.label} style={{ ...card, padding: 18, textAlign: 'center' }}>
              <Icon name={st.icon} size={22} className="text-text-muted" />
              <p style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, fontSize: 18, margin: '6px 0 2px' }}>{st.value}</p>
              <p style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{st.label}</p>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: '0 18px calc(env(safe-area-inset-bottom, 0px) + 18px)' }}>
        <button onClick={() => navigate('/')} style={{ ...cta, padding: 16, fontSize: 15 }}>Back home</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════ STREAM ANALYTICS

export function NativeStreamAnalyticsScreen() {
  const navigate = useNavigate();
  return (
    <Shell title="Stream Analytics" onBack={() => navigate(-1)}>
      <div style={{ ...card, textAlign: 'center', padding: '52px 20px' }}>
        <Icon name="analytics" size={52} className="text-text-muted" />
        <p style={{ color: C.textDim, fontSize: 14, marginTop: 14, fontWeight: 700 }}>No stream data yet</p>
        <p style={{ color: C.textMuted, fontSize: 12, marginTop: 4 }}>Go live to start tracking your performance.</p>
        <button onClick={() => navigate('/go-live')} style={{ ...cta, marginTop: 22, maxWidth: 220, marginLeft: 'auto', marginRight: 'auto' }}>Go Live</button>
      </div>
    </Shell>
  );
}

// ───────────────────────────────────────────── shared styles
const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20, width: '100%', boxSizing: 'border-box' };
const input = {
  width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`,
  borderRadius: 12, padding: '13px 15px', color: C.text, fontSize: 15, outline: 'none',
};
const cta = {
  width: '100%', padding: 14, borderRadius: 14, border: 'none',
  background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
  color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer',
};
