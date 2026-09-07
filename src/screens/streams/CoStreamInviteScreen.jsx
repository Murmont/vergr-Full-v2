// CoStreamInviteScreen — invitee accepts/declines a co-stream invitation.
// Route: /co-stream/invite/:inviteId
// Reached from a `co_stream_invite` notification (data.actionUrl).

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import TopBar from '../../components/TopBar';
import UserAvatar from '../../components/UserAvatar';

const C = {
  bg: '#0a0a14',
  card: '#12121e',
  border: 'rgba(255,255,255,0.09)',
  text: '#e8e8f0',
  textDim: '#a0a0b8',
  purple: '#7c3aed',
  purpleLight: '#b44fff',
  green: '#22c55e',
  red: '#ef4444',
};

export default function CoStreamInviteScreen() {
  const { inviteId } = useParams();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showToast } = useUI();

  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(null); // 'accept' | 'decline'

  useEffect(() => {
    if (!inviteId) return;
    const unsub = onSnapshot(doc(db, 'co_stream_invites', inviteId), (snap) => {
      setLoading(false);
      setInvite(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    }, () => setLoading(false));
    return unsub;
  }, [inviteId]);

  const accept = async () => {
    if (working) return;
    setWorking('accept');
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'acceptCoHostInvite');
      const { data } = await fn({ inviteId });
      showToast('You\'re in. Joining co-stream…', 'success');
      navigate(`/broadcast/${data.streamId}?cohost=1`);
    } catch (err) {
      showToast(err?.message || 'Could not accept', 'error');
    } finally {
      setWorking(null);
    }
  };

  const decline = async () => {
    if (working) return;
    setWorking('decline');
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'declineCoHostInvite');
      await fn({ inviteId });
      showToast('Invitation declined.', 'info');
      navigate('/');
    } catch (err) {
      showToast(err?.message || 'Could not decline', 'error');
    } finally {
      setWorking(null);
    }
  };

  const wrap = (children) => (
    <div style={{
      background: C.bg, minHeight: '100%', color: C.text,
      fontFamily: '"DM Sans", system-ui, sans-serif',
    }}>
      <TopBar title="Co-Stream Invitation" showBack />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px' }}>{children}</div>
    </div>
  );

  if (loading) return wrap(<div style={{ textAlign: 'center', color: C.textDim }}>Loading…</div>);
  if (!invite) return wrap(<div style={{ textAlign: 'center', color: C.textDim }}>Invitation not found.</div>);
  if (invite.inviteeUid !== currentUser?.uid) {
    return wrap(<div style={{ textAlign: 'center', color: C.textDim }}>This invitation isn't for you.</div>);
  }
  if (invite.status !== 'pending') {
    return wrap(
      <div style={{ textAlign: 'center', color: C.textDim }}>
        Already {invite.status}.
      </div>
    );
  }

  return wrap(
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <UserAvatar src={invite.hostAvatar} size="lg" />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: C.textDim }}>Co-stream invite from</div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{invite.hostName || 'A creator'}</div>
        </div>
      </div>
      <div style={{ fontSize: 14, color: C.text, marginBottom: 8, fontWeight: 700 }}>
        {invite.streamTitle || 'Untitled stream'}
      </div>
      <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.5, marginBottom: 18 }}>
        Accepting joins you as a co-host publisher. Your camera + mic will be live alongside the host's, and viewers see the composite. You can leave at any time.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={decline} disabled={!!working}
          style={{
            flex: 1, padding: 12, borderRadius: 10, border: `1px solid ${C.border}`,
            background: 'transparent', color: C.textDim, fontSize: 13, fontWeight: 700,
            cursor: 'pointer', opacity: working ? 0.6 : 1,
          }}>{working === 'decline' ? 'Declining…' : 'Decline'}</button>
        <button onClick={accept} disabled={!!working}
          style={{
            flex: 2, padding: 12, borderRadius: 10, border: 'none',
            background: `linear-gradient(135deg, ${C.purple}, ${C.purpleLight})`,
            color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer',
            opacity: working ? 0.6 : 1,
          }}>{working === 'accept' ? 'Joining…' : 'Accept & Join'}</button>
      </div>
    </div>
  );
}
