// SquadMembersScreen — roster grouped by role on the .sqd design system.
// Preserves moderation: mute / unmute, kick-vote, follow, message.

import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import {
  getSquad, getSquadMembers, muteSquadMember, unmuteSquadMember,
  createSquadVote, followUser, isFollowing, createConversation,
} from '../../firebase/firestore';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { MUTE_DURATIONS } from '../../utils/constants';
import Modal from '../../components/Modal';
import SquadShell from '../../components/squad/SquadShell';
import SquadInfoRail from '../../components/squad/SquadInfoRail';
import { roleKey, roleMeta, avatarClass, initials, nameOf, compact } from '../../components/squad/squadHelpers';
import usePresenceMap from '../../hooks/usePresenceMap';
import { presenceVisible } from '../../utils/presence';
import UserName from '../../components/UserName';

const GROUPS = [
  { key: 'leader', label: 'Leader', color: 'var(--gold-light)' },
  { key: 'co', label: 'Co-Leader', color: 'var(--violet-light)' },
  { key: 'officer', label: 'Officers', color: 'var(--cyan)' },
  { key: 'member', label: 'Members', color: 'var(--t2)' },
];

export default function SquadMembersScreen() {
  const { squadId } = useParams();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const navigate = useNavigate();

  const [squad, setSquad] = useState(null);
  const [members, setMembers] = useState([]);
  const presMap = usePresenceMap(members.map((m) => m.id));
  const [loading, setLoading] = useState(true);
  const [followingMap, setFollowingMap] = useState({});
  const [muteTarget, setMuteTarget] = useState(null);
  const [kickTarget, setKickTarget] = useState(null);
  const [kickReason, setKickReason] = useState('');

  const reload = async () => {
    const [s, m] = await Promise.all([getSquad(squadId), getSquadMembers(squadId)]);
    setSquad(s); setMembers(m);
  };

  useEffect(() => {
    if (!squadId || !currentUser) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try { await reload(); } catch (e) { /* ignore */ }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [squadId, currentUser]);

  useEffect(() => {
    if (!members.length || !currentUser) return;
    (async () => {
      const map = {};
      for (const m of members) {
        if (m.id === currentUser.uid) continue;
        map[m.id] = await isFollowing(currentUser.uid, m.id).catch(() => false);
      }
      setFollowingMap(map);
    })();
  }, [members, currentUser]);

  const myRole = members.find((m) => m.id === currentUser?.uid)?.role;
  const canModerate = ['president', 'vice_president', 'security'].includes(myRole);

  const grouped = useMemo(() => {
    const g = { leader: [], co: [], officer: [], member: [] };
    members.forEach((m) => g[roleKey(m.role)].push(m));
    return g;
  }, [members]);

  const isMuted = (m) =>
    m.mutedUntil && new Date(m.mutedUntil?.toDate ? m.mutedUntil.toDate() : m.mutedUntil) > new Date();

  const handleMute = async (duration) => {
    if (!muteTarget) return;
    try {
      await muteSquadMember(squadId, muteTarget.id, duration.ms, 'Muted by moderator');
      showToast(`${nameOf(muteTarget.user)} muted for ${duration.label}`, 'info');
      setMuteTarget(null);
      await reload();
    } catch { showToast('Failed to mute member', 'error'); }
  };
  const handleUnmute = async (m) => {
    try { await unmuteSquadMember(squadId, m.id); showToast(`${nameOf(m.user)} unmuted`, 'success'); await reload(); }
    catch { showToast('Failed to unmute', 'error'); }
  };
  const startKickVote = async () => {
    if (!kickTarget) return;
    try {
      const voteId = await createSquadVote(squadId, currentUser.uid, {
        title: `Kick @${kickTarget.user?.username} from squad?`,
        type: 'kick_member', options: ['Yes - Remove', 'No - Keep'],
        targetUserId: kickTarget.id, duration: 24, reason: kickReason.trim() || 'No reason provided',
      });
      await addDoc(collection(db, 'squads', squadId, 'messages'), {
        type: 'vote', voteId, senderId: currentUser.uid,
        senderName: currentUser.displayName || 'Anonymous', senderAvatar: currentUser.photoURL || '',
        createdAt: serverTimestamp(), readBy: [currentUser.uid],
      });
      showToast('Kick vote started — members can vote for 24h.', 'success');
      setKickTarget(null); setKickReason('');
    } catch (err) { showToast(`Failed to start vote: ${err?.message || 'error'}`, 'error'); }
  };
  const handleFollow = async (m) => {
    try { await followUser(currentUser.uid, m.id); setFollowingMap((p) => ({ ...p, [m.id]: true })); showToast(`Following ${nameOf(m.user)}`, 'success'); }
    catch { showToast('Failed to follow', 'error'); }
  };
  const handleMessage = async (m) => {
    try {
      const convoId = await createConversation(currentUser.uid, {
        id: m.id, username: m.user?.username, displayName: m.user?.displayName, avatar: m.user?.avatar,
      });
      navigate(`/messages/${convoId}`);
    } catch { showToast('Could not open chat', 'error'); }
  };

  const Row = (m) => {
    const meta = roleMeta(m.role);
    const isMe = m.id === currentUser?.uid;
    const muted = isMuted(m);
    return (
      <div className="m-row" key={m.id}>
        <div className={`m-av ${avatarClass(m.id)}`} onClick={() => navigate(`/user/${m.id}`)} style={{ cursor: 'pointer' }}>
          {m.user?.avatar ? <img src={m.user.avatar} alt="" /> : initials(nameOf(m.user))}
          <span className="st" style={{ background: (presenceVisible(m.user) && presMap[m.id]) ? 'var(--success)' : '#444' }} />
        </div>
        <div className="m-info">
          <div className="nm">
            {nameOf(m.user)}
            {isMe && <span style={{ fontSize: 9, color: 'var(--cyan)', fontWeight: 700 }}>(You)</span>}
            {m.user?.isVerified && <span className="material-symbols-outlined verified-tick">verified</span>}
          </div>
          <div className="handle"><UserName user={m.user} masked handle fallback={'user'} /></div>
        </div>
        <div className="m-cell">
          <div className="lbl">Role</div>
          <div className="v">
            <span className={`role-pill ${meta.pill}`}>
              {meta.icon && <span className="material-symbols-outlined">{meta.icon}</span>}{meta.label}
            </span>
          </div>
        </div>
        <div className="m-cell">
          <div className="lbl">Level</div>
          <div className="v mono">Lvl {m.user?.vpLevel || m.user?.level || 1}</div>
        </div>
        <div className="m-cell">
          <div className="lbl">Contribution</div>
          <div className="m-contrib">
            <div className="bar"><div style={{ width: `${Math.min(100, (m.totalContributed || 0) / 100)}%` }} /></div>
            <span className="v mono">{compact(m.totalContributed || 0)}</span>
          </div>
        </div>
        <div className="m-actions">
          {!isMe && (
            <>
              <button className="icon-btn" title="Message" onClick={() => handleMessage(m)}>
                <span className="material-symbols-outlined">chat</span>
              </button>
              <button className="icon-btn" title="View profile" onClick={() => navigate(`/user/${m.id}`)}>
                <span className="material-symbols-outlined">person</span>
              </button>
              {!followingMap[m.id] && (
                <button className="icon-btn" title="Follow" onClick={() => handleFollow(m)}>
                  <span className="material-symbols-outlined">person_add</span>
                </button>
              )}
              {canModerate && roleKey(m.role) === 'member' && (
                <>
                  {muted ? (
                    <button className="icon-btn" title="Unmute" onClick={() => handleUnmute(m)} style={{ color: 'var(--success)' }}>
                      <span className="material-symbols-outlined">volume_up</span>
                    </button>
                  ) : (
                    <button className="icon-btn" title="Mute" onClick={() => setMuteTarget(m)} style={{ color: 'var(--ember)' }}>
                      <span className="material-symbols-outlined">volume_off</span>
                    </button>
                  )}
                  <button className="icon-btn" title="Start kick vote" onClick={() => { setKickTarget(m); setKickReason(''); }}>
                    <span className="material-symbols-outlined">gavel</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const main = (
    <main className="main">
      <header className="page-header">
        <div>
          <div className="ttl">Members <span className="mono" style={{ fontSize: 14, color: 'var(--t2)', marginLeft: 8 }}>{members.length}</span></div>
          <div className="sub">Manage roles, moderate, and invite new members</div>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => navigate(`/squads/${squadId}/roles`)}>
            <span className="material-symbols-outlined">admin_panel_settings</span>Roles
          </button>
          <button className="btn primary" onClick={() => navigate(`/squads/${squadId}/invite`)}>
            <span className="material-symbols-outlined">person_add</span>Invite Members
          </button>
        </div>
      </header>

      <div className="scroll content">
        {loading ? (
          <div className="dim center" style={{ padding: 48 }}>Loading…</div>
        ) : (
          GROUPS.map((g) => grouped[g.key].length > 0 && (
            <div key={g.key}>
              <div className="role-header">
                <span style={{ color: g.color }}>{g.label}</span>
                <span className="count">{grouped[g.key].length}</span>
                <div className="line" />
              </div>
              <div className="list">{grouped[g.key].map(Row)}</div>
            </div>
          ))
        )}
      </div>

      <Modal isOpen={!!muteTarget} onClose={() => setMuteTarget(null)} title={`Mute @${muteTarget?.user?.username || ''}`}>
        <p className="text-text-secondary text-sm mb-4">Choose how long to mute this member from squad chat.</p>
        <div className="space-y-2">
          {MUTE_DURATIONS.map((d) => (
            <button key={d.label} onClick={() => handleMute(d)}
              className="w-full p-3 rounded-xl bg-surface-2 border border-white/[0.06] text-left hover:border-white/[0.12] transition-colors">
              <p className="text-sm font-semibold">{d.label}</p>
            </button>
          ))}
        </div>
      </Modal>

      <Modal isOpen={!!kickTarget} onClose={() => { setKickTarget(null); setKickReason(''); }} title={`Kick @${kickTarget?.user?.username || ''}`}>
        <p className="text-text-secondary text-sm mb-2">Provide a reason for the kick vote — visible to all members.</p>
        <textarea
          value={kickReason} onChange={(e) => setKickReason(e.target.value)}
          placeholder="Reason for kick (optional)" rows={3}
          className="w-full bg-surface-2 border border-white/[0.06] rounded-xl p-3 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-violet-light focus:outline-none mb-4"
        />
        <button onClick={startKickVote} className="w-full py-3 rounded-xl bg-brand-violet-light text-bg-dark font-bold text-sm">Start Kick Vote</button>
      </Modal>
    </main>
  );

  return (
    <SquadShell mode="squad" activeId="members" squadId={squadId}
      rightRail={<SquadInfoRail squad={squad} members={members} />}>
      {main}
    </SquadShell>
  );
}
