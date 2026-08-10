// Native Invite Members — /squads/:squadId/invite on the APK.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';
import { useUI } from '../../../context/UIContext';
import {
  searchUsers, getSquad, getSquadMembers, getSquadMember,
  inviteUserToSquad, getOutstandingSquadInvitations, cancelSquadInvitation,
} from '../../../firebase/firestore';
import { avatarClass, initials, nameOf } from '../../../components/squad/squadHelpers';
import NativeSquadScaffold from './NativeSquadScaffold';

export default function NativeInviteMembersScreen() {
  const { squadId } = useParams();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const [squad, setSquad] = useState(null);
  const [members, setMembers] = useState([]);
  const [role, setRole] = useState(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [invited, setInvited] = useState(new Set());
  const [searching, setSearching] = useState(false);
  const [outstanding, setOutstanding] = useState([]);

  const loadOutstanding = async () => {
    if (!squadId) return;
    try { setOutstanding(await getOutstandingSquadInvitations(squadId)); } catch (err) { console.warn('Outstanding invites load failed:', err?.message); }
  };

  useEffect(() => {
    if (!squadId) return;
    getSquad(squadId).then(setSquad).catch(() => {});
    getSquadMembers(squadId).then(setMembers).catch(() => {});
    if (currentUser?.uid) getSquadMember(squadId, currentUser.uid).then((m) => setRole(m?.role || null)).catch(() => {});
    loadOutstanding();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squadId, currentUser?.uid]);

  const canInvite = role === 'president' || role === 'vice_president';

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    let alive = true;
    setSearching(true);
    searchUsers(q.trim(), 12).then((users) => { if (alive) setResults(users || []); }).catch(() => {}).finally(() => { if (alive) setSearching(false); });
    return () => { alive = false; };
  }, [q]);

  const memberIds = new Set(members.map((m) => m.id));

  const onInvite = async (user) => {
    const uid = user.uid || user.id;
    try {
      await inviteUserToSquad(squadId, currentUser.uid, uid, `You're invited to ${squad?.name || 'this squad'}`);
      setInvited((s) => new Set([...s, uid])); showToast(`Invited ${user.displayName || user.username || 'player'}`, 'success'); loadOutstanding();
    } catch (e) { showToast(e?.message || 'Failed to invite', 'error'); }
  };
  const onCancel = async (inv) => {
    if (!window.confirm(`Cancel invite to ${inv.inviteeName || 'this player'}?`)) return;
    try { await cancelSquadInvitation(inv.id, currentUser.uid); setOutstanding((prev) => prev.filter((x) => x.id !== inv.id)); showToast('Invite cancelled', 'info'); }
    catch (e) { showToast(e?.message || 'Cancel failed', 'error'); }
  };

  return (
    <NativeSquadScaffold mode="squad" title="Invite Members" activeId="invite" squadId={squadId} squadName={squad?.name}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!canInvite && (
          <div style={{ padding: 12, background: 'rgba(240,165,0,.08)', border: '1px solid rgba(240,165,0,.25)', borderRadius: 12, fontSize: 12.5, color: 'var(--gold-light)' }}>
            Only the President or Vice President can send invites. You can still browse.
          </div>
        )}

        <div className="search-input" style={{ width: '100%' }}>
          <span className="material-symbols-outlined">search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by username or display name" />
        </div>

        {searching ? (
          <div style={{ textAlign: 'center', color: 'var(--t3)', padding: 40 }}>Searching…</div>
        ) : results.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 40, gap: 10, color: 'var(--t3)', textAlign: 'center' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 40, opacity: .45 }}>person_search</span>
            <div style={{ fontSize: 13 }}>{q.length < 2 ? 'Type at least 2 characters to search' : 'No matches'}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {results.map((u) => {
              const uid = u.uid || u.id;
              const isMember = memberIds.has(uid);
              const wasInvited = invited.has(uid);
              return (
                <div key={uid} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 12 }}>
                  <div className={`squad-avatar ${avatarClass(uid)}`} style={{ width: 36, height: 36, fontSize: 13 }}>{u.avatar ? <img src={u.avatar} alt="" /> : initials(nameOf(u))}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'Syne', fontWeight: 700, color: '#fff', fontSize: 13 }}>{u.displayName || u.username || 'Player'}</div>
                    <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: 'var(--t3)' }}>@{u.username || uid.slice(0, 6)}</div>
                  </div>
                  {isMember
                    ? <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: 'var(--violet-light)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Member</span>
                    : <button className={`btn ${wasInvited ? 'ghost' : 'primary'} sm`} disabled={!canInvite || wasInvited} onClick={() => onInvite(u)}>{wasInvited ? 'Invited' : 'Invite'}</button>}
                </div>
              );
            })}
          </div>
        )}

        {outstanding.length > 0 && (
          <section style={{ marginTop: 12 }}>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--t3)', marginBottom: 10 }}>Outstanding invites · {outstanding.length}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {outstanding.map((inv) => (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: 'rgba(255,255,255,.02)', border: '1px dashed rgba(255,255,255,.08)', borderRadius: 12 }}>
                  <div className={`squad-avatar ${avatarClass(inv.inviteeId)}`} style={{ width: 32, height: 32, fontSize: 12 }}>{inv.inviteeAvatar ? <img src={inv.inviteeAvatar} alt="" /> : initials(inv.inviteeName || inv.inviteeId)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'Syne', fontWeight: 700, color: '#fff', fontSize: 13 }}>{inv.inviteeName || `User ${(inv.inviteeId || '').slice(0, 6)}`}</div>
                    <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Pending response</div>
                  </div>
                  {canInvite && inv.inviterId === currentUser?.uid && <button onClick={() => onCancel(inv)} className="btn ghost sm"><span className="material-symbols-outlined">close</span> Cancel</button>}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </NativeSquadScaffold>
  );
}
