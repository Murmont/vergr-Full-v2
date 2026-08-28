// NativeJoinGroupScreen — dedicated phone build of /messages/g/:chatId.
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getGroupForJoin, joinGroupChat, requestToJoinGroup,
  cancelJoinRequest, getMyJoinRequest,
} from '../../../firebase/firestore';
import { auth } from '../../../firebase/config';
import Icon from '../../../components/Icon';
import UserAvatar from '../../../components/UserAvatar';
import { useUI } from '../../../context/UIContext';

export default function NativeJoinGroupScreen() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useUI();
  const [group, setGroup] = useState(undefined);
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!auth.currentUser) {
        try { localStorage.setItem('vergr_pending_group_invite', chatId); } catch { /* ignore */ }
        navigate('/login', { replace: true });
        return;
      }
      try {
        const g = await getGroupForJoin(chatId);
        if (!alive) return;
        if (g?.isMember) { navigate(`/messages/${chatId}`, { replace: true }); return; }
        setGroup(g);
        if (g && g.visibility !== 'public') {
          const mine = await getMyJoinRequest(chatId);
          if (alive) setRequested(!!mine);
        }
      } catch { if (alive) setGroup(null); }
    })();
    return () => { alive = false; };
  }, [chatId, navigate]);

  const join = async () => {
    setBusy(true);
    try {
      await joinGroupChat(chatId);
      navigate(`/messages/${chatId}`, { replace: true });
    } catch (err) {
      if (err?.code === 'group/private') await request();
      else showToast(err?.message || 'Could not join', 'error');
    } finally { setBusy(false); }
  };

  const request = async () => {
    setBusy(true);
    try {
      await requestToJoinGroup(chatId);
      setRequested(true);
      showToast('Request sent — an admin will approve you', 'success');
    } catch { showToast('Could not send request', 'error'); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    setBusy(true);
    try { await cancelJoinRequest(chatId); setRequested(false); }
    catch { showToast('Could not cancel', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bg-dark px-6 text-center"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)' }}>
      {group === undefined && (
        <div className="text-text-muted text-sm flex items-center gap-2">
          <Icon name="hourglass_top" size={18} /> Loading invite…
        </div>
      )}

      {group === null && (
        <div className="max-w-sm">
          <Icon name="link_off" size={40} className="text-text-muted/40 mx-auto mb-4" />
          <h1 className="text-white font-syne font-extrabold text-xl mb-1">Invite not found</h1>
          <p className="text-text-muted text-sm mb-6">This group link is invalid or the group no longer exists.</p>
          <button onClick={() => navigate('/messages')} className="px-6 py-3 rounded-xl bg-surface-2 text-white text-sm font-bold active:scale-95 transition-transform">
            Back to Messages
          </button>
        </div>
      )}

      {group && (
        <div className="max-w-sm w-full">
          <div className="mx-auto mb-5">
            <UserAvatar src={group.groupIcon || group.groupAvatar} size={96} isGroup />
          </div>
          <p className="text-[10px] font-dmmono uppercase tracking-[0.2em] text-brand-violet-light mb-2">
            {group.visibility === 'public' ? 'Public group' : 'Private group'}
          </p>
          <h1 className="text-white font-syne font-extrabold text-2xl mb-1">{group.groupName}</h1>
          <p className="text-text-muted text-sm mb-8">
            {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
            {group.visibility === 'public' ? ' · Anyone can join' : ' · An admin approves new members'}
          </p>

          {requested ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-brand-violet/30 bg-brand-violet/10 px-4 py-3.5 text-sm text-white flex items-center justify-center gap-2">
                <Icon name="schedule" size={18} className="text-brand-violet-light" /> Request pending
              </div>
              <button onClick={cancel} disabled={busy} className="py-2 text-text-muted text-xs font-bold active:text-white disabled:opacity-50">
                Cancel request
              </button>
            </div>
          ) : (
            <button onClick={group.visibility === 'public' ? join : request} disabled={busy}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white font-bold text-sm active:brightness-110 disabled:opacity-50 shadow-lg shadow-brand-violet/30 active:scale-[0.98] transition-all">
              {busy ? 'Working…' : group.visibility === 'public' ? 'Join group' : 'Request to join'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
