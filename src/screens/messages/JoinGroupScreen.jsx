// Public landing for a group invite link: /messages/g/:token
//
// `:token` is EITHER a revocable invite code (new links) or a bare chatId
// (every link issued before invite codes existed). We resolve a code first and
// fall back to treating the token as a chatId, so old links keep working right
// up until an admin resets the group's link — which is exactly what "revoke"
// should mean.
//
// Public groups → instant join. Private groups → request-to-join (admin
// approves). Banned users are told plainly, rather than getting a silent
// permission error from the rules.
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getGroupForJoin, joinGroupChat, requestToJoinGroup,
  cancelJoinRequest, getMyJoinRequest, resolveGroupInvite, reportGroup,
} from '../../firebase/firestore';
import { auth } from '../../firebase/config';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import { useUI } from '../../context/UIContext';
import { IS_NATIVE_BUILD } from '../../utils/platform';

export default function JoinGroupScreen() {
  const { chatId: token } = useParams();
  const navigate = useNavigate();
  const { showToast } = useUI();
  const [group, setGroup] = useState(undefined); // undefined=loading, null=not found
  const [groupId, setGroupId] = useState(null);
  const [via, setVia] = useState(null);          // the invite code, when the link carried one
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reported, setReported] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!auth.currentUser) {
        // Stash the invite so a later signup→return step can resume it;
        // LoginScreen currently always lands on home.
        try { localStorage.setItem('vergr_pending_group_invite', token); } catch { /* ignore */ }
        navigate('/login', { replace: true });
        return;
      }
      try {
        // Is this token a live invite code? If it resolves, we also carry it
        // into the join write — the rules require the code to be presented.
        const fromCode = await resolveGroupInvite(token).catch(() => null);
        if (!alive) return;
        const id = fromCode || token;
        setGroupId(id);
        setVia(fromCode ? token : null);

        const g = await getGroupForJoin(id);
        if (!alive) return;
        if (g?.isMember) { navigate(`/messages/${id}`, { replace: true }); return; }
        // A group that requires an invite, reached WITHOUT a valid code, is a
        // revoked (or guessed) link. Say so instead of letting the join fail.
        if (g && g.requireInvite && !fromCode) { setGroup(null); return; }
        setGroup(g);
        if (g && g.visibility !== 'public' && !g.isBanned) {
          const mine = await getMyJoinRequest(id);
          if (alive) setRequested(!!mine);
        }
      } catch { if (alive) setGroup(null); }
    })();
    return () => { alive = false; };
  }, [token, navigate]);

  const join = async () => {
    setBusy(true);
    try {
      await joinGroupChat(groupId, via);
      navigate(`/messages/${groupId}`, { replace: true });
    } catch (err) {
      if (err?.code === 'group/private') {
        await request();
      } else {
        showToast(err?.message || 'Could not join', 'error');
      }
    } finally { setBusy(false); }
  };

  const request = async () => {
    setBusy(true);
    try {
      await requestToJoinGroup(groupId, via);
      setRequested(true);
      showToast('Request sent — an admin will approve you', 'success');
    } catch { showToast('Could not send request', 'error'); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    setBusy(true);
    try { await cancelJoinRequest(groupId); setRequested(false); }
    catch { showToast('Could not cancel', 'error'); }
    finally { setBusy(false); }
  };

  const report = async () => {
    try {
      await reportGroup(groupId);
      setReported(true);
      showToast('Reported — our moderators will review it', 'success');
    } catch { showToast('Could not send report', 'error'); }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center bg-bg-dark px-6 text-center"
      style={IS_NATIVE_BUILD ? { paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)' } : undefined}
    >
      {group === undefined && (
        <div className="text-text-muted text-sm flex items-center gap-2">
          <Icon name="hourglass_top" size={18} /> Loading invite…
        </div>
      )}

      {group === null && (
        <div className="max-w-sm">
          <Icon name="link_off" size={40} className="text-text-muted/40 mx-auto mb-4" />
          <h1 className="text-white font-syne font-extrabold text-xl mb-1">Invite no longer works</h1>
          <p className="text-text-muted text-sm mb-6">
            This link is invalid, has been reset by an admin, or the group no longer exists.
            Ask someone in the group for a fresh invite.
          </p>
          <button onClick={() => navigate('/messages')} className="px-5 py-2.5 rounded-xl bg-surface-2 text-white text-sm font-bold">
            Back to Messages
          </button>
        </div>
      )}

      {group && (
        <div className="max-w-sm w-full">
          <div className="mx-auto mb-5">
            <UserAvatar src={group.groupIcon} size={96} isGroup />
          </div>
          <p className="text-[10px] font-dmmono uppercase tracking-[0.2em] text-brand-violet-light mb-2">
            {group.visibility === 'public' ? 'Public group' : 'Private group'}
          </p>
          <h1 className="text-white font-syne font-extrabold text-2xl mb-1">{group.groupName}</h1>
          <p className="text-text-muted text-sm mb-8">
            {group.memberCount} member{group.memberCount === 1 ? '' : 's'}
            {group.visibility === 'public'
              ? ' · Anyone can join'
              : ' · An admin approves new members'}
          </p>
          {group.description && (
            <p className="text-text-secondary text-sm leading-relaxed -mt-4 mb-8 max-w-xs mx-auto">{group.description}</p>
          )}

          {group.isBanned ? (
            <div className="rounded-xl border border-brand-ember/30 bg-brand-ember/10 px-4 py-3 text-sm text-white flex items-center justify-center gap-2">
              <Icon name="block" size={18} className="text-brand-ember" /> You can no longer join this group
            </div>
          ) : requested ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-brand-violet/30 bg-brand-violet/10 px-4 py-3 text-sm text-white flex items-center justify-center gap-2">
                <Icon name="schedule" size={18} className="text-brand-violet-light" /> Request pending
              </div>
              <button onClick={cancel} disabled={busy} className="text-text-muted text-xs font-bold hover:text-white disabled:opacity-50">
                Cancel request
              </button>
            </div>
          ) : (
            <button
              onClick={group.visibility === 'public' ? join : request}
              disabled={busy}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white font-bold text-sm hover:brightness-110 disabled:opacity-50 shadow-lg shadow-brand-violet/30"
            >
              {busy ? 'Working…' : group.visibility === 'public' ? 'Join group' : 'Request to join'}
            </button>
          )}

          {/* A public group is the one messaging surface a stranger can walk
              into, so it needs a way out that isn't just "leave". */}
          {group.visibility === 'public' && (
            <button
              onClick={report}
              disabled={reported}
              className="mt-6 text-text-muted text-xs font-bold hover:text-brand-ember disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <Icon name="flag" size={14} />
              {reported ? 'Reported' : 'Report this group'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
